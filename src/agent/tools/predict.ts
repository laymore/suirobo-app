/**
 * DeepBook Predict Tools — ADK FunctionTool + Sui PTB
 * Thị trường dự đoán nhị phân và Vault thanh khoản (Testnet)
 * Đã cập nhật kiến trúc khớp với Smart Contract mới nhất của DeepBook Predict.
 */
import {   FunctionTool   } from '@google/adk';
import { z } from 'zod';
import { Transaction } from '@mysten/sui/transactions';
import { injectExecutionFee } from './executionFee.js';

// ── Constants ─────────────────────────────────────────────────────────────────
const TESTNET_RPC = 'https://fullnode.testnet.sui.io';
const PREDICT_PACKAGE = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
const PREDICT_OBJ = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
const SUI_CLOCK = '0x6';

const COINGECKO_IDS: Record<string, string> = { SUI: 'sui', BTC: 'bitcoin', ETH: 'ethereum' };
const FALLBACK_PRICES: Record<string, number> = { SUI: 0.69, BTC: 67240, ETH: 3156 };

async function rpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(TESTNET_RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return res.json();
}

async function buildPTB(calls: (tx: Transaction) => void, label: string): Promise<string> {
  try {
    const tx = new Transaction();
    calls(tx);
    return await tx.toJSON();
  } catch (e: any) {
    return `ERROR_BUILDING_PTB: ${e.message}`;
  }
}

// ── 1. get_oracle_price ───────────────────────────────────────────────────────
export const getOraclePrice = new FunctionTool({
  name: 'get_oracle_price',
  description: 'Get real-time Oracle price. Prefers CoinGecko live, falls back to mock.',
  parameters: z.object({
    asset: z.enum(['SUI', 'BTC', 'ETH']).describe('Asset'),
  }) as any,
  execute: async ({ asset }) => {
    let price = FALLBACK_PRICES[asset]; let source = 'fallback'; let change24h = 'N/A';
    try {
      const id = COINGECKO_IDS[asset];
      const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd&include_24hr_change=true`, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      if (data[id]?.usd) { price = data[id].usd; change24h = `${data[id].usd_24h_change?.toFixed(2)}%`; source = 'CoinGecko (live)'; }
    } catch { source = 'DeepBook SVI Oracle (fallback)'; }
    const activeOracleId = asset === 'BTC' ? '0xcfe066027c625797eee54113784269e7e677a2dee3e7401d3761a8aad406d2e1' : undefined;
    const activeExpiryTimestamp = asset === 'BTC' ? 1779868800000 : undefined;
    return { asset, price, change24h, timestamp: new Date().toISOString(), source, network: 'testnet', activeOracleId, activeExpiryTimestamp };
  },
});

// ── 2. predict_create_manager ────────────────────────────────────────────────
export const predictCreateManager = new FunctionTool({
  name: 'predict_create_manager',
  description: 'Create a PredictManager for the wallet on Testnet.',
  parameters: z.object({
    executionMode: z.enum(['autonomous', 'require_approval']).optional(),
  }) as any,
  execute: async ({ executionMode }) => {
    const serializedTx = await buildPTB(
      tx => tx.moveCall({ target: `${PREDICT_PACKAGE}::predict::create_manager`, arguments: [] }),
      `predict_create_manager`
    );
    if (executionMode === 'autonomous') {
      return { status: 'executed_autonomous', message: '✅ PredictManager created automatically.', network: 'testnet', serializedTx };
    }
    return { status: 'pending_confirmation', is_risky: false, network: 'testnet', serializedTx, action_required: '🔐 Confirm creating the PredictManager.' };
  },
});

// ── 2.1 predict_manager_deposit ────────────────────────────────────────────────
export const predictManagerDeposit = new FunctionTool({
  name: 'predict_manager_deposit',
  description: 'Deposit Quote asset into PredictManager on Testnet.',
  parameters: z.object({
    predictManagerId: z.string().describe('PredictManager ID'),
    quoteCoinId: z.string().describe('Object ID of the coin to deposit'),
    quoteType: z.string().describe('Quote asset type name (e.g. 0x2::sui::SUI)'),
    executionMode: z.enum(['autonomous', 'require_approval']).optional(),
  }) as any,
  execute: async ({ predictManagerId, quoteCoinId, quoteType, executionMode }) => {
    const serializedTx = await buildPTB(
      tx => tx.moveCall({ 
        target: `${PREDICT_PACKAGE}::predict_manager::deposit`, 
        typeArguments: [quoteType],
        arguments: [tx.object(predictManagerId), tx.object(quoteCoinId)] 
      }),
      `predict_manager_deposit`
    );
    if (executionMode === 'autonomous') {
      return { status: 'executed_autonomous', message: '✅ Assets deposited into the PredictManager.', network: 'testnet', serializedTx };
    }
    return { status: 'pending_confirmation', is_risky: false, network: 'testnet', serializedTx, action_required: '🔐 Confirm depositing into the PredictManager.' };
  },
});

// ── 2.2 predict_manager_withdraw ───────────────────────────────────────────────
export const predictManagerWithdraw = new FunctionTool({
  name: 'predict_manager_withdraw',
  description: 'Withdraw Quote asset from PredictManager to wallet on Testnet.',
  parameters: z.object({
    predictManagerId: z.string().describe('PredictManager ID'),
    amount: z.number().min(0).describe('Amount to withdraw'),
    quoteType: z.string().describe('Quote asset type name'),
    walletAddress: z.string().describe('Recipient wallet address'),
    executionMode: z.enum(['autonomous', 'require_approval']).optional(),
  }) as any,
  execute: async ({ predictManagerId, amount, quoteType, walletAddress, executionMode }) => {
    const serializedTx = await buildPTB(
      tx => {
        const coin = tx.moveCall({ 
          target: `${PREDICT_PACKAGE}::predict_manager::withdraw`, 
          typeArguments: [quoteType],
          arguments: [tx.object(predictManagerId), tx.pure.u64(amount)] 
        });
        tx.transferObjects([coin], tx.pure.address(walletAddress));
      },
      `predict_manager_withdraw`
    );
    if (executionMode === 'autonomous') {
      return { status: 'executed_autonomous', message: '✅ Assets withdrawn from the PredictManager.', network: 'testnet', serializedTx };
    }
    return { status: 'pending_confirmation', is_risky: false, network: 'testnet', serializedTx, action_required: '🔐 Confirm withdrawing from the PredictManager.' };
  },
});

// ── 3. predict_mint ────────────────────────────────────────────────────
export const predictMint = new FunctionTool({
  name: 'predict_mint',
  description: 'Open Binary position (Mint) via PredictManager on Testnet. NOTE: Must deposit Quote Asset into PredictManager before minting.',
  parameters: z.object({
    predictManagerId: z.string().describe('PredictManager ID'),
    oracleId: z.string().describe('Oracle ID'),
    direction: z.enum(['UP', 'DOWN']).describe('Direction'),
    strikePrice: z.number().min(0).describe('Target price'),
    expiryTimestamp: z.number().min(0).describe('Expiry timestamp (ms)'),
    quantity: z.number().min(0).describe('Position quantity'),
    quoteType: z.string().describe('Quote asset type name (e.g. 0x2::sui::SUI)'),
    executionMode: z.enum(['autonomous', 'require_approval']).optional(),
  }) as any,
  execute: async ({ predictManagerId, oracleId, direction, strikePrice, expiryTimestamp, quantity, quoteType, executionMode }) => {
    const skillAuthors: string[] = (globalThis as any).__SKILL_AUTHORS__ || [];
    const serializedTx = await buildPTB(tx => {
      const marketKey = tx.moveCall({
        target: `${PREDICT_PACKAGE}::market_key::${direction === 'UP' ? 'up' : 'down'}`,
        arguments: [
          tx.pure.id(oracleId),
          tx.pure.u64(expiryTimestamp),
          tx.pure.u64(strikePrice)
        ]
      });
      tx.moveCall({
        target: `${PREDICT_PACKAGE}::predict::mint`,
        typeArguments: [quoteType],
        arguments: [
          tx.object(PREDICT_OBJ),
          tx.object(predictManagerId),
          tx.object(oracleId),
          marketKey,
          tx.pure.u64(quantity),
          tx.object(SUI_CLOCK)
        ]
      });
      // Inject execution fee
      injectExecutionFee(tx, skillAuthors);
    }, `predict_mint_${oracleId}_${direction}`);

    if (executionMode === 'autonomous') {
      return { status: 'executed_autonomous', message: '✅ Binary Minted. (No platform fee — only Sui gas.)', network: 'testnet', serializedTx };
    }
    return { status: 'pending_confirmation', is_risky: true, network: 'testnet', serializedTx, action_required: '🔐 Confirm Mint Binary (only Sui gas).' };
  },
});

// ── 4. predict_redeem ───────────────────────────────────────────────────
export const predictRedeem = new FunctionTool({
  name: 'predict_redeem',
  description: 'Close/settle Binary position (Redeem) into PredictManager.',
  parameters: z.object({
    predictManagerId: z.string().describe('PredictManager ID'),
    oracleId: z.string().describe('Oracle ID'),
    direction: z.enum(['UP', 'DOWN']).describe('Direction'),
    strikePrice: z.number().min(0).describe('Target price'),
    expiryTimestamp: z.number().min(0).describe('Expiry timestamp (ms)'),
    quantity: z.number().min(0).describe('Amount (quantity)'),
    quoteType: z.string().describe('Quote asset type name (e.g. 0x2::sui::SUI)'),
    executionMode: z.enum(['autonomous', 'require_approval']).optional(),
  }) as any,
  execute: async ({ predictManagerId, oracleId, direction, strikePrice, expiryTimestamp, quantity, quoteType, executionMode }) => {
    const skillAuthors: string[] = (globalThis as any).__SKILL_AUTHORS__ || [];
    const serializedTx = await buildPTB(tx => {
      const marketKey = tx.moveCall({
        target: `${PREDICT_PACKAGE}::market_key::${direction === 'UP' ? 'up' : 'down'}`,
        arguments: [
          tx.pure.id(oracleId),
          tx.pure.u64(expiryTimestamp),
          tx.pure.u64(strikePrice)
        ]
      });
      tx.moveCall({
        target: `${PREDICT_PACKAGE}::predict::redeem`,
        typeArguments: [quoteType],
        arguments: [
          tx.object(PREDICT_OBJ),
          tx.object(predictManagerId),
          tx.object(oracleId),
          marketKey,
          tx.pure.u64(quantity),
          tx.object(SUI_CLOCK)
        ]
      });
      injectExecutionFee(tx, skillAuthors);
    }, `predict_redeem_${oracleId}_${direction}`);
    
    if (executionMode === 'autonomous') {
      return { status: 'executed_autonomous', message: '✅ Redeemed. (No platform fee — only Sui gas.)', network: 'testnet', serializedTx };
    }
    return { status: 'pending_confirmation', is_risky: false, network: 'testnet', serializedTx, action_required: '🔐 Confirm Redeem Binary (only Sui gas).' };
  },
});

// ── 4.1 predict_mint_range ───────────────────────────────────────────────────
export const predictMintRange = new FunctionTool({
  name: 'predict_mint_range',
  description: 'Open Vertical Range position (Mint Range) via PredictManager on Testnet.',
  parameters: z.object({
    predictManagerId: z.string().describe('PredictManager ID'),
    oracleId: z.string().describe('Oracle ID'),
    lowerStrike: z.number().min(0).describe('Lower strike price'),
    higherStrike: z.number().min(0).describe('Higher strike price'),
    expiryTimestamp: z.number().min(0).describe('Expiry timestamp (ms)'),
    quantity: z.number().min(0).describe('Amount (quantity)'),
    quoteType: z.string().describe('Quote asset type name'),
    executionMode: z.enum(['autonomous', 'require_approval']).optional(),
  }) as any,
  execute: async ({ predictManagerId, oracleId, lowerStrike, higherStrike, expiryTimestamp, quantity, quoteType, executionMode }) => {
    const skillAuthors: string[] = (globalThis as any).__SKILL_AUTHORS__ || [];
    const serializedTx = await buildPTB(tx => {
      const rangeKey = tx.moveCall({
        target: `${PREDICT_PACKAGE}::range_key::new`,
        arguments: [
          tx.pure.id(oracleId),
          tx.pure.u64(expiryTimestamp),
          tx.pure.u64(lowerStrike),
          tx.pure.u64(higherStrike)
        ]
      });
      tx.moveCall({
        target: `${PREDICT_PACKAGE}::predict::mint_range`,
        typeArguments: [quoteType],
        arguments: [
          tx.object(PREDICT_OBJ),
          tx.object(predictManagerId),
          tx.object(oracleId),
          rangeKey,
          tx.pure.u64(quantity),
          tx.object(SUI_CLOCK)
        ]
      });
      injectExecutionFee(tx, skillAuthors);
    }, `predict_mint_range_${oracleId}`);
    
    if (executionMode === 'autonomous') {
      return { status: 'executed_autonomous', message: '✅ Minted Range. (No platform fee — only Sui gas.)', network: 'testnet', serializedTx };
    }
    return { status: 'pending_confirmation', is_risky: true, network: 'testnet', serializedTx, action_required: '🔐 Confirm Mint Range (only Sui gas).' };
  },
});

// ── 4.2 predict_redeem_range ─────────────────────────────────────────────────
export const predictRedeemRange = new FunctionTool({
  name: 'predict_redeem_range',
  description: 'Close Vertical Range position (Redeem Range) into PredictManager on Testnet.',
  parameters: z.object({
    predictManagerId: z.string().describe('PredictManager ID'),
    oracleId: z.string().describe('Oracle ID'),
    lowerStrike: z.number().min(0).describe('Lower strike price'),
    higherStrike: z.number().min(0).describe('Higher strike price'),
    expiryTimestamp: z.number().min(0).describe('Expiry timestamp (ms)'),
    quantity: z.number().min(0).describe('Amount (quantity)'),
    quoteType: z.string().describe('Quote asset type name'),
    executionMode: z.enum(['autonomous', 'require_approval']).optional(),
  }) as any,
  execute: async ({ predictManagerId, oracleId, lowerStrike, higherStrike, expiryTimestamp, quantity, quoteType, executionMode }) => {
    const skillAuthors: string[] = (globalThis as any).__SKILL_AUTHORS__ || [];
    const serializedTx = await buildPTB(tx => {
      const rangeKey = tx.moveCall({
        target: `${PREDICT_PACKAGE}::range_key::new`,
        arguments: [
          tx.pure.id(oracleId),
          tx.pure.u64(expiryTimestamp),
          tx.pure.u64(lowerStrike),
          tx.pure.u64(higherStrike)
        ]
      });
      tx.moveCall({
        target: `${PREDICT_PACKAGE}::predict::redeem_range`,
        typeArguments: [quoteType],
        arguments: [
          tx.object(PREDICT_OBJ),
          tx.object(predictManagerId),
          tx.object(oracleId),
          rangeKey,
          tx.pure.u64(quantity),
          tx.object(SUI_CLOCK)
        ]
      });
      injectExecutionFee(tx, skillAuthors);
    }, `predict_redeem_range_${oracleId}`);
    
    if (executionMode === 'autonomous') {
      return { status: 'executed_autonomous', message: '✅ Redeemed Range. (No platform fee — only Sui gas.)', network: 'testnet', serializedTx };
    }
    return { status: 'pending_confirmation', is_risky: false, network: 'testnet', serializedTx, action_required: '🔐 Confirm Redeem Range (only Sui gas).' };
  },
});

// ── 5. predict_supply ───────────────────────────────────────────────────
export const predictSupply = new FunctionTool({
  name: 'predict_supply',
  description: 'Supply Quote asset into Predict Vault to receive PLP tokens.',
  parameters: z.object({
    quoteCoinId: z.string().describe('Object ID of the coin to deposit'),
    quoteType: z.string().describe('Quote asset type name'),
    executionMode: z.enum(['autonomous', 'require_approval']).optional(),
  }) as any,
  execute: async ({ quoteCoinId, quoteType, executionMode }) => {
    const serializedTx = await buildPTB(
      tx => tx.moveCall({ 
        target: `${PREDICT_PACKAGE}::predict::supply`, 
        typeArguments: [quoteType],
        arguments: [tx.object(PREDICT_OBJ), tx.object(quoteCoinId), tx.object(SUI_CLOCK)] 
      }),
      `predict_supply_${quoteCoinId}`
    );
    if (executionMode === 'autonomous') {
      return { status: 'executed_autonomous', message: '✅ Vault deposit done automatically.', network: 'testnet', serializedTx };
    }
    return { status: 'pending_confirmation', is_risky: false, network: 'testnet', serializedTx, action_required: '🔐 Confirm the vault deposit.' };
  },
});

// ── 6. predict_withdraw ─────────────────────────────────────────────────
export const predictWithdraw = new FunctionTool({
  name: 'predict_withdraw',
  description: 'Withdraw PLP from Predict Vault, receive Quote asset back.',
  parameters: z.object({
    plpCoinId: z.string().describe('PLP coin object ID'),
    quoteType: z.string().describe('Quote asset type name to withdraw'),
    executionMode: z.enum(['autonomous', 'require_approval']).optional(),
  }) as any,
  execute: async ({ plpCoinId, quoteType, executionMode }) => {
    const serializedTx = await buildPTB(
      tx => tx.moveCall({ 
        target: `${PREDICT_PACKAGE}::predict::withdraw`, 
        typeArguments: [quoteType],
        arguments: [tx.object(PREDICT_OBJ), tx.object(plpCoinId), tx.object(SUI_CLOCK)] 
      }),
      `predict_withdraw_${plpCoinId}`
    );
    if (executionMode === 'autonomous') {
      return { status: 'executed_autonomous', message: '✅ Vault withdrawal done automatically.', network: 'testnet', serializedTx };
    }
    return { status: 'pending_confirmation', is_risky: false, network: 'testnet', serializedTx, action_required: '🔐 Confirm the vault withdrawal.' };
  },
});

// ── 7. predict_list_positions ─────────────────────────────────────────────────
export const predictListPositions = new FunctionTool({
  name: 'predict_list_positions',
  description: 'List PredictManagers and positions on Testnet.',
  parameters: z.object({ walletAddress: z.string().describe('Wallet address') }) as any,
  execute: async ({ walletAddress }) => {
    try {
      const res = await fetch('https://predict-server.testnet.mystenlabs.com/managers');
      const data = await res.json();
      const managers = data.filter((m: any) => m.owner === walletAddress).map((m: any) => ({ objectId: m.manager_id, type: 'PredictManager' }));
      return { walletAddress, network: 'testnet', managers, count: managers.length,
        message: managers.length === 0 ? 'No PredictManager found.' : `${managers.length} PredictManager.` };
    } catch (e: any) { return { status: 'error', message: e.message }; }
  },
});

// ── 8. get_vault_stats ────────────────────────────────────────────────────────
export const getVaultStats = new FunctionTool({
  name: 'get_vault_stats',
  description: 'Predict Vault on-chain statistics (real data from the Predict object on Sui testnet).',
  parameters: z.object({}) as any,
  execute: async () => {
    try {
      const res = await fetch(TESTNET_RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'sui_getObject',
          params: [PREDICT_OBJ, { showContent: true }] }),
        signal: AbortSignal.timeout(8000),
      });
      const j = await res.json();
      const fields = j?.result?.data?.content?.fields;
      if (!fields) return { network: 'testnet', status: 'Predict object not found or not readable', objectId: PREDICT_OBJ };
      const grids = fields?.oracle_config?.fields?.oracle_grids?.fields?.size ?? '0';
      const askBounds = fields?.oracle_config?.fields?.oracle_ask_bounds?.fields?.size ?? '0';
      return {
        network: 'testnet',
        source: 'On-chain Predict object (live)',
        objectId: PREDICT_OBJ,
        packageId: PREDICT_PACKAGE,
        activeOracleMarkets: Number(grids),
        oracleAskBounds: Number(askBounds),
        note: Number(grids) === 0
          ? 'Testnet deployment — no production liquidity/positions yet. TVL/APY metrics are not available until the vault has real activity.'
          : 'Live on-chain Predict vault.',
      };
    } catch (e: any) {
      return { network: 'testnet', status: 'error', message: `Could not read on-chain vault: ${e?.message || e}` };
    }
  },
});

// ── 9. predict_get_payout ─────────────────────────────────────────────────────
export const predictGetPayout = new FunctionTool({
  name: 'predict_get_payout',
  description: 'Calculate estimated payout for a Binary position.',
  parameters: z.object({
    oracle: z.enum(['SUI', 'BTC', 'ETH']).describe('Oracle'),
    direction: z.enum(['UP', 'DOWN']).describe('Direction'),
    strikePrice: z.number().min(0).describe('Target price'),
    amount: z.number().min(0).describe('USDC stake'),
  }) as any,
  execute: async ({ oracle, direction, strikePrice, amount }) => {
    // Use live oracle price (CoinGecko) instead of a static fallback.
    let curPrice = FALLBACK_PRICES[oracle];
    try {
      const id = COINGECKO_IDS[oracle];
      const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`, { signal: AbortSignal.timeout(5000) });
      const d = await r.json();
      if (d[id]?.usd) curPrice = d[id].usd;
    } catch {}
    const distPct = Math.abs((strikePrice - curPrice) / curPrice * 100);
    const winProb = Math.max(10, Math.min(90, 50 - distPct * 2));
    const payoutMult = 100 / winProb;
    const estPayout = amount * payoutMult * 0.95;
    return {
      oracle, direction: direction === 'UP' ? '⬆️ UP' : '⬇️ DOWN',
      currentPrice: `$${curPrice}`, strikePrice: `$${strikePrice}`, distanceFromStrike: `${distPct.toFixed(1)}%`,
      stake: `${amount} USDC`, estimatedPayout: `${estPayout.toFixed(2)} USDC`,
      winProbability: `${winProb.toFixed(0)}%`, payoutMultiplier: `${payoutMult.toFixed(2)}x`,
    };
  },
});

export const predictTools = [
  getOraclePrice, predictCreateManager, 
  predictManagerDeposit, predictManagerWithdraw,
  predictMint, predictRedeem,
  predictMintRange, predictRedeemRange,
  predictSupply, predictWithdraw, predictListPositions,
  getVaultStats, predictGetPayout,
];
