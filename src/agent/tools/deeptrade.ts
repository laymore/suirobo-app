/**
 * Deeptrade Tools — DeepBook V3 DeFi với Human-in-the-Loop
 * Agent soạn thảo transaction nhưng KHÔNG tự ký — user phải confirm
 */
import {   FunctionTool   } from '@google/adk';
import { z } from 'zod';

// ── Tool: Quote giá swap ──────────────────────────────────────────────────────
export const getSwapQuote = new FunctionTool({
  name: 'get_swap_quote',
  description:
    'Computes a quote for a token swap on DeepBook V3. ' +
    'Returns the received amount, slippage and trading fee. ' +
    'MUST be called before placing an order.',
  parameters: z.object({
    tokenIn: z.enum(['SUI', 'USDC', 'WAL', 'DEEP']).describe('Token to swap from'),
    tokenOut: z.enum(['SUI', 'USDC', 'WAL', 'DEEP']).describe('Token to receive'),
    amountIn: z.number().min(0).describe('Input token amount'),
    slippagePct: z.number().min(0.1).max(5).default(0.5).describe('Max slippage (%)'),
  }) as any,
  execute: async ({ tokenIn, tokenOut, amountIn, slippagePct }) => {
    // Mock price oracle — thực tế gọi DeepBook V3 SDK
    const prices: Record<string, number> = { SUI: 3.45, USDC: 1.0, WAL: 0.12, DEEP: 0.85 };
    const priceIn = prices[tokenIn] ?? 1;
    const priceOut = prices[tokenOut] ?? 1;
    const rate = priceIn / priceOut;
    const amountOutGross = amountIn * rate;
    const feeRate = 0.003; // 0.3% taker fee
    const amountOutAfterFee = amountOutGross * (1 - feeRate);
    const minAmountOut = amountOutAfterFee * (1 - slippagePct / 100);

    return {
      status: 'success',
      quote: {
        tokenIn, tokenOut, amountIn,
        amountOut: amountOutAfterFee.toFixed(6),
        minAmountOut: minAmountOut.toFixed(6),
        exchangeRate: rate.toFixed(6),
        fee: (amountOutGross * feeRate).toFixed(6),
        slippagePct,
        note: '⚠️ Estimate only. The real price depends on DeepBook V3 liquidity.',
      },
    };
  },
});

// ── Tool: Chuẩn bị orders Limit Order ─────────────────────────────────────────
export const prepareLimitOrder = new FunctionTool({
  name: 'prepare_limit_order',
  description:
    'Prepares a limit order on DeepBook V3. ' +
    'This tool does NOT execute — it only builds the transaction payload for the user to review and sign. ' +
    'The agent must show full details and wait for user confirmation.',
  parameters: z.object({
    poolId: z.string().default('SUI_USDC').describe('Pool ID (vd: SUI_USDC)'),
    price: z.number().min(0).describe('Order price (USD)'),
    quantity: z.number().min(0).describe('Token amount to buy/sell'),
    isBid: z.boolean().describe('true = buy (BID), false = sell (ASK)'),
    clientOrderId: z.number().optional().describe('Custom order ID (optional)'),
  }) as any,
  execute: async ({ poolId, price, quantity, isBid }) => {
    const side = isBid ? 'BUY (BID)' : 'SELL (ASK)';
    const total = (price * quantity).toFixed(4);
    const orderId = `0x${Math.random().toString(16).slice(2, 18)}`;

    return {
      status: 'pending_confirmation',
      order: {
        type: 'Limit Order',
        pool: poolId,
        side,
        price: `${price} USDC`,
        quantity: `${quantity} SUI`,
        total: `${total} USDC`,
        estimatedFee: '~0.003 SUI',
        orderId,
      },
      action_required:
        '🔐 NOT EXECUTED. Confirm this order in your Sui wallet to sign the transaction.',
      sdk_call: `placeLimitOrder({ poolId: "${poolId}", price: ${price}, quantity: ${quantity}, isBid: ${isBid} })`,
    };
  },
});

// ── Tool: Chuẩn bị closed orders vị thế ─────────────────────────────────────────
export const prepareReduceOnlyOrder = new FunctionTool({
  name: 'prepare_reduce_only_order',
  description:
    'Prepares a reduce-only order to close an existing margin position. ' +
    'Opens nothing new — only reduces/closes the open position. Needs user confirmation.',
  parameters: z.object({
    poolId: z.string().describe('Pool ID'),
    price: z.number().min(0).describe('Order price'),
    quantity: z.number().min(0).describe('Amount to close'),
    isBid: z.boolean().describe('Side of the closing order (opposite of the original position)'),
  }) as any,
  execute: async ({ poolId, price, quantity, isBid }) => {
    return {
      status: 'pending_confirmation',
      order: {
        type: 'Reduce-Only Limit Order',
        pool: poolId,
        side: isBid ? 'BUY to close a SHORT' : 'SELL to close a LONG',
        price: `${price} USDC`,
        quantity: `${quantity} SUI`,
      },
      action_required: '🔐 NOT EXECUTED. Confirm to close the position.',
      sdk_call: `placeReduceOnlyLimitOrder({ poolId: "${poolId}", price: ${price}, quantity: ${quantity}, isBid: ${isBid} })`,
    };
  },
});

// ── Tool: Chuẩn bị Binary Position (Options) ─────────────────────────────────
export const prepareBinaryPosition = new FunctionTool({
  name: 'prepare_binary_position',
  description:
    'Prepares a binary position (Yes/No) order on DeepBook Predict. ' +
    'Stakes on whether SUI reaches the strike before expiry. Needs user confirmation.',
  parameters: z.object({
    strikePrice: z.number().min(0).describe('Target price (USD) — e.g. 4.0'),
    expiry: z.string().describe('Expiry — e.g. "2026-05-25T00:00:00Z"'),
    isYes: z.boolean().describe('true = stake the price reaches it, false = stake it does not'),
    amount: z.number().min(0).describe('USDC amount to stake'),
  }) as any,
  execute: async ({ strikePrice, expiry, isYes, amount }) => {
    return {
      status: 'pending_confirmation',
      position: {
        type: 'Binary Position',
        market: `SUI-${strikePrice}`,
        side: isYes ? '✅ YES (price ≥ $' + strikePrice + ')' : '❌ NO (price < $' + strikePrice + ')',
        expiry,
        stake: `${amount} USDC`,
        maxProfit: `${(amount * 1.95).toFixed(2)} USDC (if you win)`,
        maxLoss: `${amount} USDC (if you lose)`,
      },
      action_required: '🔐 NOT EXECUTED. Confirm to buy the position.',
      sdk_call: `mintBinaryPosition({ strikePrice: ${strikePrice}, expiry: "${expiry}", isYes: ${isYes}, amount: ${amount} })`,
    };
  },
});

// ── Tool: Thông tin Pool DeepBook ─────────────────────────────────────────────
export const getPoolInfo = new FunctionTool({
  name: 'get_pool_info',
  description: 'Get current price and liquidity of a DeepBook V3 pool.',
  parameters: z.object({
    poolId: z.enum(['SUI_USDC', 'WAL_SUI', 'DEEP_SUI']).describe('Pool ID on DeepBook V3'),
  }) as any,
  execute: async ({ poolId }) => {
    // Mock data — thực tế query từ DeepBook V3 smart contract
    const pools: Record<string, object> = {
      SUI_USDC: { pair: 'SUI/USDC', bid: 3.443, ask: 3.447, spread: '0.12%', volume24h: '$2.4M', liquidity: '$8.1M' },
      WAL_SUI: { pair: 'WAL/SUI', bid: 0.0347, ask: 0.0349, spread: '0.58%', volume24h: '$340K', liquidity: '$1.2M' },
      DEEP_SUI: { pair: 'DEEP/SUI', bid: 0.2461, ask: 0.2465, spread: '0.16%', volume24h: '$890K', liquidity: '$3.4M' },
    };
    return { status: 'success', pool: pools[poolId] ?? { error: 'Pool does not exist' } };
  },
});

// Note: manage_balance, margin_open_position, margin_close_position, and predict_supply_vault have been removed as they are fully implemented in their domain-specific files (margin.ts, predict.ts, deepbookV3.ts).
