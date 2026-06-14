/**
 * DeepTrade Core — xBTC/USDC real order execution (Sui Mainnet)
 * ----------------------------------------------------------------------------
 * DeepTrade Core is a DeepBook V3 fee-abstraction wrapper for SPOT orders.
 * This module builds REAL Programmable Transaction Blocks (PTBs) that call the
 * audited on-chain `deeptrade-core` package to place / cancel limit & market
 * orders on the xBTC_USDC pool, plus a one-time bootstrap that creates the
 * per-user BalanceManager (DeepBook) and FeeManager (DeepTrade).
 *
 * ⚠️ MAINNET, REAL FUNDS. Every order tool returns a `pending_confirmation`
 * transaction that the user MUST review and sign in their wallet. There is no
 * autonomous (server-signed) path here on purpose — real money should not move
 * without explicit per-order approval.
 *
 * All addresses below were verified on-chain (DeepTrade examples/constants.ts,
 * DeepBook indexer /get_pools, @mysten/deepbook-v3 mainnet config).
 */
import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import { Transaction } from '@mysten/sui/transactions';

// ── Verified mainnet constants ──────────────────────────────────────────────
const MAINNET_RPC = 'https://fullnode.mainnet.sui.io';

// DeepTrade Core (v2.0.0) shared objects
const DEEPTRADE_PKG        = '0xc10d536b6580d809711b9bb8eee3945d5e96f92a346c84d74ff7a0697e664695';
const TREASURY             = '0xb90e2d3de41817016b7d39f49c724c5b0616bd30f1d5e6383048efafabe6232b';
const TRADING_FEE_CONFIG   = '0xcb757e55db3a502dc826c40b8ced507d017b41d926c5bf554e69855510bb855e';
const LOYALTY_PROGRAM      = '0x6a06100001533356fb2e9f68ee299c15565777dfb28c741ec440cb08b168cbff';

// DeepBook V3 (mainnet) package — BalanceManager lives here
const DEEPBOOK_PKG         = '0x0e735f8c93a95722efd73521aca7a7652c0bb71ed1daf41b26dfd7d1ff71f748';

// xBTC_USDC pool + coin types
const XBTC_USDC_POOL = '0x20b9a3ec7a02d4f344aa1ebc5774b7b0ccafa9a5d76230662fdc0300bb215307';
const XBTC_TYPE = '0x876a4b7bce8aeaef60464c11f4026903e9afacab79b9b142686158aa86560b50::xbtc::XBTC';
const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

// Pool params (from indexer /get_pools)
const BASE_DECIMALS = 8;   // xBTC
const QUOTE_DECIMALS = 6;  // USDC
const BASE_SCALAR = 10 ** BASE_DECIMALS;   // 1e8
const QUOTE_SCALAR = 10 ** QUOTE_DECIMALS; // 1e6
const FLOAT_SCALAR = 1e9;
const LOT_SIZE = 1000;     // base raw units
const MIN_SIZE = 1000;     // base raw units
const TICK_SIZE = 10_000_000; // price raw units

// DeepBook order enums / sentinels
const MAX_TIMESTAMP = BigInt("1844674407370955161"); // expire_timestamp (good-till-cancelled)
const ORDER_TYPE_NO_RESTRICTION = 0;
const SELF_MATCHING_ALLOWED = 0;
const CLOCK_ID = '0x6';

const DEEPBOOK_INDEXER = 'https://deepbook-indexer.mainnet.mystenlabs.com';

// ── Scaling (mirrors @mysten/deepbook-v3 conversion helpers) ────────────────
/** Human price (USDC per xBTC) → on-chain u64. price * FLOAT_SCALAR * quoteScalar / baseScalar. */
function scalePrice(price: number): bigint {
  const raw = Math.round((price * FLOAT_SCALAR * QUOTE_SCALAR) / BASE_SCALAR);
  // Round to the pool tick to avoid contract rejection.
  return BigInt(Math.max(TICK_SIZE, Math.round(raw / TICK_SIZE) * TICK_SIZE));
}
/** Human quantity (xBTC) → on-chain u64, floored to lot size. */
function scaleQty(qty: number): bigint {
  let raw = Math.round(qty * BASE_SCALAR);
  raw = Math.floor(raw / LOT_SIZE) * LOT_SIZE;
  return BigInt(raw);
}
/** Human USDC amount → on-chain u64 (quote units). */
function scaleQuote(usdc: number): bigint {
  return BigInt(Math.round(usdc * QUOTE_SCALAR));
}

async function rpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(MAINNET_RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(10000),
  });
  return res.json();
}

/** Fetch a user's coin object-ids for a given type (largest first). */
async function getCoinObjects(owner: string, coinType: string): Promise<{ ids: string[]; total: bigint }> {
  const r = await rpc('suix_getCoins', [owner, coinType, null, 50]);
  const coins = (r?.result?.data ?? []) as any[];
  coins.sort((a, b) => (BigInt(b.balance) > BigInt(a.balance) ? 1 : -1));
  const total = coins.reduce((s, c) => s + BigInt(c.balance), BigInt(0));
  return { ids: coins.map((c) => c.coinObjectId), total };
}

/** Build a single input coin Argument of `coinType`, merging the user's coins. */
function inputCoin(tx: Transaction, coinIds: string[]): any {
  const primary = tx.object(coinIds[0]);
  if (coinIds.length > 1) tx.mergeCoins(primary, coinIds.slice(1).map((id) => tx.object(id)));
  return primary;
}

/** Serialize a PTB for wallet signing. */
async function serialize(tx: Transaction, sender: string): Promise<string> {
  tx.setSender(sender);
  return await tx.toJSON();
}

// ── Live pool info (real, read-only — safe to test now) ─────────────────────
async function fetchPoolSummary(): Promise<any | null> {
  try {
    const res = await fetch(`${DEEPBOOK_INDEXER}/summary`, { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    return (data as any[]).find((p) => p?.trading_pairs === 'XBTC_USDC') || null;
  } catch { return null; }
}

export const deeptradeXbtcPoolInfo = new FunctionTool({
  name: 'deeptrade_xbtc_pool_info',
  description: 'Live xBTC/USDC market data on DeepTrade (DeepBook V3 pool): last price, 24h volume, bid/ask. Read-only, no signing.',
  parameters: z.object({}) as any,
  execute: async () => {
    const p = await fetchPoolSummary();
    return {
      market: 'xBTC/USDC',
      venue: 'DeepTrade (DeepBook V3)',
      pool_id: XBTC_USDC_POOL,
      last_price: p?.last_price ? Number(p.last_price) : null,
      base_volume_24h: p?.base_volume ? Number(p.base_volume) : null,
      quote_volume_24h: p?.quote_volume ? Number(p.quote_volume) : null,
      highest_bid: p?.highest_bid ? Number(p.highest_bid) : null,
      lowest_ask: p?.lowest_ask ? Number(p.lowest_ask) : null,
      tick_size: TICK_SIZE, lot_size: LOT_SIZE, min_size: MIN_SIZE,
      source: p ? 'deepbook-indexer (live)' : 'unavailable',
    };
  },
});

// ── One-time bootstrap: create BalanceManager + FeeManager ──────────────────
export const deeptradeXbtcSetup = new FunctionTool({
  name: 'deeptrade_xbtc_setup',
  description:
    'ONE-TIME setup before trading xBTC/USDC on DeepTrade. Builds a transaction that creates and shares a DeepBook BalanceManager AND a DeepTrade FeeManager for the user. ' +
    'After the user signs, the frontend must read the created shared-object IDs from the tx effects and save them — they are required by deeptrade_xbtc_order. Returns a pending transaction for wallet signing.',
  parameters: z.object({
    walletAddress: z.string().describe('User Sui wallet address (owner of the new managers).'),
  }) as any,
  execute: async ({ walletAddress }: any) => {
    const tx = new Transaction();
    // DeepBook BalanceManager
    const bm = tx.moveCall({ target: `${DEEPBOOK_PKG}::balance_manager::new` });
    tx.moveCall({
      target: '0x2::transfer::public_share_object',
      typeArguments: [`${DEEPBOOK_PKG}::balance_manager::BalanceManager`],
      arguments: [bm],
    });
    // DeepTrade FeeManager
    const fm = tx.moveCall({ target: `${DEEPTRADE_PKG}::fee_manager::new` });
    // fee_manager::new returns (FeeManager, FeeManagerOwnerCap, FeeManagerShareTicket)
    tx.moveCall({
      target: `${DEEPTRADE_PKG}::fee_manager::share_fee_manager`,
      arguments: [fm[0], fm[2]],
    });
    tx.transferObjects([fm[1]], walletAddress); // owner cap → user
    const serializedTx = await serialize(tx, walletAddress);
    return {
      status: 'pending_confirmation',
      network: 'mainnet',
      action_required: '🔐 Sign to create your DeepBook BalanceManager + DeepTrade FeeManager (one-time).',
      note: 'After signing, save the two created shared-object IDs (BalanceManager + FeeManager) — they are needed for every order.',
      serializedTx,
    };
  },
});

// ── Place a limit order via DeepTrade fee-abstraction ───────────────────────
export async function buildOrderTx(opts: {
  walletAddress: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;
  balanceManagerId: string;
  feeManagerId: string;
  marketOrder?: boolean;
}): Promise<{ serializedTx: string; scaledPrice: string; scaledQty: string; tx: Transaction }> {
  const { walletAddress, side, price, quantity, balanceManagerId, feeManagerId, marketOrder } = opts;
  const isBid = side === 'buy';
  const scaledPrice = scalePrice(price);
  const scaledQty = scaleQty(quantity);
  if (scaledQty < BigInt(MIN_SIZE)) {
    throw new Error(`Quantity ${quantity} xBTC is below the pool minimum (${MIN_SIZE / BASE_SCALAR} xBTC).`);
  }

  const tx = new Transaction();
  // Input coin: BID pays USDC, ASK delivers xBTC. The other side is a zero coin.
  const inType = isBid ? USDC_TYPE : XBTC_TYPE;
  const { ids, total } = await getCoinObjects(walletAddress, inType);
  if (ids.length === 0) throw new Error(`No ${isBid ? 'USDC' : 'xBTC'} coins found in wallet ${walletAddress}.`);

  let baseCoinArg: any, quoteCoinArg: any;
  if (isBid) {
    quoteCoinArg = inputCoin(tx, ids);
    baseCoinArg = tx.moveCall({ target: '0x2::coin::zero', typeArguments: [XBTC_TYPE] });
  } else {
    baseCoinArg = inputCoin(tx, ids);
    quoteCoinArg = tx.moveCall({ target: '0x2::coin::zero', typeArguments: [USDC_TYPE] });
  }

  // Market order_amount is in QUOTE tokens for bids, BASE tokens for asks.
  const marketAmount = isBid ? scaleQuote(price * quantity) : scaleQty(quantity);
  const fn = marketOrder ? 'create_market_order_input_fee' : 'create_limit_order_input_fee';
  const args = marketOrder
    ? [
        tx.object(TREASURY), tx.object(feeManagerId), tx.object(TRADING_FEE_CONFIG),
        tx.object(LOYALTY_PROGRAM), tx.object(XBTC_USDC_POOL), tx.object(balanceManagerId),
        baseCoinArg, quoteCoinArg,
        tx.pure.u64(marketAmount), tx.pure.bool(isBid),
        tx.pure.u8(SELF_MATCHING_ALLOWED), tx.pure.u64(BigInt(0) /* client_order_id */),
        tx.object(CLOCK_ID),
      ]
    : [
        tx.object(TREASURY), tx.object(feeManagerId), tx.object(TRADING_FEE_CONFIG),
        tx.object(LOYALTY_PROGRAM), tx.object(XBTC_USDC_POOL), tx.object(balanceManagerId),
        baseCoinArg, quoteCoinArg,
        tx.pure.u64(scaledPrice), tx.pure.u64(scaledQty), tx.pure.bool(isBid),
        tx.pure.u64(MAX_TIMESTAMP), tx.pure.u8(ORDER_TYPE_NO_RESTRICTION),
        tx.pure.u8(SELF_MATCHING_ALLOWED), tx.pure.u64(BigInt(0) /* client_order_id */),
        tx.object(CLOCK_ID),
      ];

  const ret = tx.moveCall({
    target: `${DEEPTRADE_PKG}::order::${fn}`,
    typeArguments: [XBTC_TYPE, USDC_TYPE],
    arguments: args,
  });
  // ret = (OrderInfo, Coin<XBTC> leftover, Coin<USDC> leftover). OrderInfo has drop.
  tx.transferObjects([ret[1], ret[2]], walletAddress);

  const serializedTx = await serialize(tx, walletAddress);
  return { serializedTx, scaledPrice: scaledPrice.toString(), scaledQty: scaledQty.toString(), tx };
}

export const deeptradeXbtcOrder = new FunctionTool({
  name: 'deeptrade_xbtc_order',
  description:
    'Place a REAL spot order on the xBTC/USDC pool via DeepTrade (DeepBook V3) on Sui mainnet. ' +
    'side=buy spends USDC to buy xBTC; side=sell delivers xBTC for USDC. ' +
    'Requires the user\'s balanceManagerId and feeManagerId (from deeptrade_xbtc_setup). ' +
    'Set marketOrder=true for an immediate fill at best price (price is ignored). ' +
    'Returns a pending_confirmation transaction the user must sign — this moves real funds. Always confirm price/quantity with the user first.',
  parameters: z.object({
    walletAddress: z.string().describe('User Sui wallet address.'),
    side: z.enum(['buy', 'sell']).describe('buy = long xBTC (pay USDC); sell = short/close (deliver xBTC).'),
    price: z.number().describe('Limit price in USDC per xBTC. For market orders pass the current price; it is not used on-chain.'),
    quantity: z.number().describe('xBTC amount (e.g. 0.001).'),
    balanceManagerId: z.string().describe('User DeepBook BalanceManager object id (from setup).'),
    feeManagerId: z.string().describe('User DeepTrade FeeManager object id (from setup).'),
    marketOrder: z.boolean().optional().describe('true = market order (immediate). Default false = limit (good-till-cancelled).'),
  }) as any,
  execute: async (p: any) => {
    try {
      const { serializedTx, scaledPrice, scaledQty } = await buildOrderTx(p);
      return {
        status: 'pending_confirmation',
        network: 'mainnet',
        venue: 'DeepTrade (DeepBook V3)',
        order: {
          market: 'xBTC/USDC', side: p.side,
          type: p.marketOrder ? 'market' : 'limit',
          price: p.marketOrder ? 'market' : p.price,
          quantity: p.quantity,
          scaled: { price: scaledPrice, quantity: scaledQty },
        },
        is_risky: true,
        action_required: `🔐 Sign to ${p.side === 'buy' ? 'BUY' : 'SELL'} ${p.quantity} xBTC ${p.marketOrder ? 'at market' : `@ ${p.price} USDC`} on DeepTrade. REAL FUNDS.`,
        serializedTx,
      };
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (/BalanceManager|FeeManager|No (USDC|xBTC)/i.test(msg)) {
        return {
          status: 'setup_required',
          error: msg,
          hint: 'Run deeptrade_xbtc_setup first to create your BalanceManager + FeeManager, and make sure the wallet holds the input coin (USDC to buy, xBTC to sell).',
        };
      }
      return { status: 'error', error: msg };
    }
  },
});

// ── Cancel an open order ────────────────────────────────────────────────────
export const deeptradeXbtcCancel = new FunctionTool({
  name: 'deeptrade_xbtc_cancel',
  description: 'Cancel an open xBTC/USDC order on DeepTrade and settle its protocol fees. Returns a pending transaction to sign.',
  parameters: z.object({
    walletAddress: z.string(),
    orderId: z.string().describe('The order_id returned when the order was placed.'),
    balanceManagerId: z.string(),
    feeManagerId: z.string(),
    side: z.enum(['buy', 'sell']).describe('Side of the original order (buy paid USDC, sell delivered xBTC) — determines the unsettled fee coin type.'),
  }) as any,
  execute: async ({ walletAddress, orderId, balanceManagerId, feeManagerId, side }: any) => {
    try {
      const tx = new Transaction();
      // Input-fee orders accrue the unsettled fee in the order's INPUT coin.
      const feeCoinType = side === 'buy' ? USDC_TYPE : XBTC_TYPE;
      const refund = tx.moveCall({
        target: `${DEEPTRADE_PKG}::order::cancel_order_and_settle_fees`,
        typeArguments: [XBTC_TYPE, USDC_TYPE, feeCoinType],
        arguments: [
          tx.object(TREASURY), tx.object(feeManagerId), tx.object(XBTC_USDC_POOL),
          tx.object(balanceManagerId), tx.pure.u128(BigInt(orderId)), tx.object(CLOCK_ID),
        ],
      });
      tx.transferObjects([refund], walletAddress); // return settled-fee refund coin
      const serializedTx = await serialize(tx, walletAddress);
      return {
        status: 'pending_confirmation', network: 'mainnet',
        action_required: `🔐 Sign to cancel order ${orderId} on xBTC/USDC.`,
        serializedTx,
      };
    } catch (e: any) {
      return { status: 'error', error: String(e?.message || e) };
    }
  },
});

export const deeptradeXbtcTools = [
  deeptradeXbtcPoolInfo,
  deeptradeXbtcSetup,
  deeptradeXbtcOrder,
  deeptradeXbtcCancel,
];

// Exported constants for reuse (e.g. live_trade_agent execution path).
export const DEEPTRADE_XBTC = {
  DEEPTRADE_PKG, TREASURY, TRADING_FEE_CONFIG, LOYALTY_PROGRAM, DEEPBOOK_PKG,
  XBTC_USDC_POOL, XBTC_TYPE, USDC_TYPE, CLOCK_ID, MAX_TIMESTAMP,
  ORDER_TYPE_NO_RESTRICTION, SELF_MATCHING_ALLOWED, scalePrice, scaleQty, buildOrderTx,
};
