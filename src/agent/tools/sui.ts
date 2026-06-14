/**
 * Sui Blockchain Tools — Gọi Sui RPC mainnet
 */
import {   FunctionTool   } from '@google/adk';
import { z } from 'zod';

const SUI_RPC = 'https://fullnode.mainnet.sui.io';

async function rpc(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(SUI_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return res.json();
}

// ── Tool: Lấy số dư SUI ──────────────────────────────────────────────────────
export const getSuiBalance = new FunctionTool({
  name: 'get_sui_balance',
  description: 'Get current SUI balance of a Sui mainnet wallet address.',
  parameters: z.object({
    address: z.string().describe('Wallet address Sui (0x...)'),
  }) as any,
  execute: async ({ address }) => {
    try {
      const data = await rpc('suix_getBalance', [address, '0x2::sui::SUI']) as any;
      const mist = parseInt(data?.result?.totalBalance ?? '0');
      const sui = (mist / 1_000_000_000).toFixed(4);
      return { status: 'success', sui, mist, address };
    } catch (e: any) {
      return { status: 'error', message: e.message };
    }
  },
});

// ── Tool: Tất cả token trong ví ──────────────────────────────────────────────
export const getAllBalances = new FunctionTool({
  name: 'get_all_balances',
  description: 'List all tokens/coins in a Sui wallet.',
  parameters: z.object({
    address: z.string().describe('Wallet address Sui'),
  }) as any,
  execute: async ({ address }) => {
    try {
      const data = await rpc('suix_getAllBalances', [address]) as any;
      const balances = (data?.result ?? []).map((b: any) => ({
        coin: b.coinType.split('::').pop(),
        balance: b.totalBalance,
      }));
      return { status: 'success', balances, count: balances.length };
    } catch (e: any) {
      return { status: 'error', message: e.message };
    }
  },
});

// ── Tool: Giá token từ CoinGecko ─────────────────────────────────────────────
export const getTokenPrice = new FunctionTool({
  name: 'get_token_price',
  description: 'Get current USD price and 24h change of Sui ecosystem tokens.',
  parameters: z.object({
    symbol: z.enum(['SUI', 'WAL', 'DEEP', 'NS']).describe('Token symbol'),
  }) as any,
  execute: async ({ symbol }) => {
    const idMap: Record<string, string> = {
      SUI: 'sui', WAL: 'walrus-protocol', DEEP: 'deepbook', NS: 'navi-protocol',
    };
    const fallback: Record<string, number> = { SUI: 0.69, WAL: 0.035, DEEP: 0.016, NS: 0.10 };
    try {
      const id = idMap[symbol];
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`,
        { signal: AbortSignal.timeout(8000) }
      );
      const data = await res.json();
      const info = data[id];
      return {
        status: 'success', symbol,
        price_usd: info?.usd ?? fallback[symbol],
        change_24h: info?.usd_24h_change?.toFixed(2) ?? 'N/A',
      };
    } catch {
      return { status: 'success', symbol, price_usd: fallback[symbol], change_24h: 'N/A (offline)' };
    }
  },
});

// ── Tool: Send token to another wallet ───────────────────────────────────────
// The ONLY write tool available in Manual sign mode — lets the AI Assistant
// move SUI or any Coin<T> to another address. Returns a pending tx for the
// user to sign in their browser wallet (manual approval).
export const sendToken = new FunctionTool({
  name: 'send_token',
  description:
    'Build a transaction to send any Sui token (SUI or any Coin<T>) from the user\'s wallet ' +
    'to another address. Returns a pending_confirmation transaction the user MUST sign in their ' +
    'wallet — this moves real funds. Always confirm recipient + amount with the user before calling. ' +
    'Default coinType is 0x2::sui::SUI when sending SUI.',
  parameters: z.object({
    walletAddress: z.string().describe('Sender Sui wallet (the connected user).'),
    recipient:     z.string().describe('Destination Sui wallet address (0x…). Must be a valid hex address.'),
    amount:        z.number().positive().describe('Amount in human units (e.g. 1.5 for 1.5 SUI). Decimals applied per coin type.'),
    coinType:      z.string().optional().describe('Full coin type, e.g. "0x2::sui::SUI" (default) or USDC type. Default: 0x2::sui::SUI'),
    decimals:      z.number().int().min(0).max(18).optional().describe('Token decimals (SUI=9, USDC=6). Default 9.'),
  }) as any,
  execute: async ({ walletAddress, recipient, amount, coinType, decimals }) => {
    try {
      if (!walletAddress) return { status: 'error', message: 'Missing walletAddress.' };
      if (!recipient || !recipient.startsWith('0x')) return { status: 'error', message: 'recipient must be a 0x… Sui address.' };
      if (amount <= 0) return { status: 'error', message: 'amount must be > 0.' };

      const coin = coinType || '0x2::sui::SUI';
      const dec  = typeof decimals === 'number' ? decimals : (coin === '0x2::sui::SUI' ? 9 : 6);
      const rawAmount = BigInt(Math.floor(amount * 10 ** dec));

      // Build a PTB using @mysten/sui Transaction. SUI uses tx.gas as source; others
      // need a coin object — for non-SUI we leave coin selection to the wallet's PTB
      // adapter via splitCoins on the first owned coin object (resolved client-side).
      const { Transaction } = await import('@mysten/sui/transactions');
      const tx = new Transaction();
      tx.setSender(walletAddress);

      if (coin === '0x2::sui::SUI') {
        const [c] = tx.splitCoins(tx.gas, [tx.pure.u64(rawAmount)]);
        tx.transferObjects([c], tx.pure.address(recipient));
      } else {
        // Resolve owner coins of this type via RPC and merge if needed
        const data = await rpc('suix_getCoins', [walletAddress, coin, null, 50]) as any;
        const coins: any[] = data?.result?.data || [];
        if (!coins.length) return { status: 'error', message: `No ${coin} coins in wallet ${walletAddress}.` };
        const total = coins.reduce((s, c) => s + BigInt(c.balance), 0n);
        if (total < rawAmount) return { status: 'error', message: `Insufficient balance: have ${total}, need ${rawAmount}.` };
        const primary = tx.object(coins[0].coinObjectId);
        if (coins.length > 1) tx.mergeCoins(primary, coins.slice(1).map(c => tx.object(c.coinObjectId)));
        const [c] = tx.splitCoins(primary, [tx.pure.u64(rawAmount)]);
        tx.transferObjects([c], tx.pure.address(recipient));
      }

      const serializedTx = await tx.toJSON();
      return {
        status: 'pending_confirmation',
        is_risky: true,
        network: 'mainnet',
        transfer: { from: walletAddress, to: recipient, amount, coinType: coin, decimals: dec, raw: rawAmount.toString() },
        action_required: `🔐 Sign to send ${amount} ${coin.split('::').pop()} to ${recipient.slice(0, 10)}…${recipient.slice(-6)}. REAL FUNDS.`,
        serializedTx,
      };
    } catch (e: any) {
      return { status: 'error', message: e.message || String(e) };
    }
  },
});

// ── Tool: Giao dịch gần nhất ─────────────────────────────────────────────────
export const getRecentTransactions = new FunctionTool({
  name: 'get_recent_transactions',
  description: 'Get recent transactions for a wallet address.',
  parameters: z.object({
    address: z.string().describe('Wallet address Sui'),
    limit: z.number().min(1).max(10).default(5).describe('Number of trades (1-10)'),
  }) as any,
  execute: async ({ address, limit }) => {
    try {
      const data = await rpc('suix_queryTransactionBlocks', [
        { filter: { FromAddress: address } }, null, limit, true,
      ]) as any;
      const txs = (data?.result?.data ?? []).map((tx: any) => ({
        digest: tx.digest,
        short: `${tx.digest.slice(0, 12)}...`,
      }));
      return { status: 'success', transactions: txs, count: txs.length };
    } catch (e: any) {
      return { status: 'error', message: e.message };
    }
  },
});
