import {   FunctionTool   } from '@google/adk';
import { z } from 'zod';
import { Transaction } from '@mysten/sui/transactions';
import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { DeepBookClient, SuiPriceServiceConnection, SuiPythClient, mainnetPythConfigs, mainnetCoins } from '@mysten/deepbook-v3';
import { SuiJsonRpcClient as SuiClient, getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc';
import { injectExecutionFee } from './executionFee.js';

/**
 * Inject a fresh Pyth price update for SUI + USDC into the tx.
 * Margin borrow/withdraw verify health against these feeds and abort with
 * code 3 (EInvalidProof) when the on-chain price object is stale (~30s TTL).
 * MUST be called before the borrow/withdraw moveCall is added.
 */
async function injectPythUpdate(tx: Transaction, suiClient: any): Promise<void> {
  const feeds = [(mainnetCoins as any).SUI.feed, (mainnetCoins as any).USDC.feed];
  const connection = new SuiPriceServiceConnection('https://hermes.pyth.network');
  const pythClient = new SuiPythClient(suiClient, mainnetPythConfigs.pythStateId, mainnetPythConfigs.wormholeStateId);
  const updates = await connection.getPriceFeedsUpdateData(feeds);
  if (!updates?.length) throw new Error('Pyth Hermes returned no price updates');
  await pythClient.updatePriceFeeds(tx, updates, feeds);
}

const MAINNET_RPC = 'https://fullnode.mainnet.sui.io';

async function getDeepBookClient(walletAddress: string): Promise<{ client: DeepBookClient, managerIds: string[], suiClient: any }> {
  const suiClient = new SuiClient({ url: MAINNET_RPC, network: 'mainnet' as any });
  let dbClient = new DeepBookClient({ client: suiClient as any, network: 'mainnet', address: walletAddress });
  let managerIds: string[] = [];
  try {
    managerIds = await dbClient.getMarginManagerIdsForOwner(walletAddress);
  } catch (e) {
    // If user has no margin manager or simulate fails, default to empty
  }
  
  if (managerIds.length > 0) {
    // Pick the BEST SUI/USDC manager (most liquid, no-debt preferred) — the wallet
    // may own several for the same pool plus managers from other pools, and the
    // wrong pick either aborts TypeMismatch or uses a stale empty account.
    const { pickBestSuiUsdcManager } = await import('../../utils/marginDetail.js');
    const managerId = await pickBestSuiUsdcManager(suiClient, managerIds);
    if (!managerId) {
      // No SUI/USDC manager — treat as "no margin account" so callers prompt creation.
      return { client: dbClient, managerIds: [], suiClient };
    }
    // Replace the id list with only the matched manager so callers' managerIds[0] is correct.
    managerIds = [managerId];
    const poolKey = 'SUI_USDC';
    dbClient = new DeepBookClient({
      client: suiClient as any,
      network: 'mainnet',
      address: walletAddress,
      marginManagers: {
        [managerId]: {
          marginManagerKey: managerId,
          address: managerId,
          poolKey: poolKey
        }
      } as any
    });
  }
  
  return { client: dbClient, managerIds, suiClient };
}

async function buildPTB(calls: (tx: Transaction) => void | Promise<void>, sender: string, client: any): Promise<{ serializedTx: string, txBytes: string | null }> {
  try {
    const tx = new Transaction();
    tx.setSender(sender);
    await calls(tx);
    
    let serializedTx = '';
    try {
      serializedTx = await tx.toJSON({ client });
    } catch (e) {
      console.log("Failed toJSON with client, fallback to simple toJSON");
      serializedTx = await tx.toJSON();
    }
    
    let txBytesBase64: string | null = null;
    try {
      const builtBytes = await tx.build({ client });
      txBytesBase64 = Buffer.from(builtBytes).toString('base64');
    } catch (e: any) {
      console.log("MockClient Build Error:", e);
    }
    
    return { serializedTx, txBytes: txBytesBase64 };
  } catch (e: any) {
    throw new Error(`ERROR_BUILDING_PTB: ${e.message}`);
  }
}

// ── 1. margin_create_account ──────────────────────────────────────────────────
export const marginCreateAccount = new FunctionTool({
  name: 'margin_create_account',
  description: 'Initialize Margin Account (MarginManager) on DeepBook V3 Mainnet. Requires initial collateral deposit.',
  parameters: z.object({
    pool: z.enum(['SUI_USDC', 'DEEP_SUI']).describe('Margin pool to link'),
    asset: z.string().describe('Collateral asset (e.g. SUI or USDC)'),
    amount: z.number().min(0).describe('Collateral amount'),
    walletAddress: z.string().describe("User's wallet address"),
    executionMode: z.enum(['autonomous', 'require_approval']).optional(),
  }) as any,
  execute: async ({ pool, asset, amount, walletAddress, executionMode }) => {
    if (!walletAddress) throw new Error('Missing walletAddress');

    const { client, managerIds, suiClient } = await getDeepBookClient(walletAddress);
    if (managerIds.length > 0) {
      return { status: 'error', message: `This wallet already has a margin account: ${managerIds[0]}` };
    }

    const { serializedTx, txBytes } = await buildPTB(tx => {
      const { manager, initializer } = client.marginManager.newMarginManagerWithInitializer(pool)(tx);
      client.marginManager.depositDuringInitialization({
        manager, poolKey: pool, coinType: asset, amount
      })(tx);
      client.marginManager.shareMarginManager(pool, manager, initializer)(tx);
    }, walletAddress, suiClient);

    const info = { action: 'Create Margin Account & Deposit', pool, asset, amount };

    if (executionMode === 'autonomous') {
      return {
        status: 'executed_autonomous',
        message: `✅ Margin account created and ${amount} ${asset} deposited automatically.`,
        network: 'mainnet', info, serializedTx, txBytes,
      };
    }
    return {
      status: 'pending_confirmation', is_risky: false,
      network: 'mainnet', info, serializedTx, txBytes,
      action_required: `🔐 Confirm creating the margin account and depositing ${amount} ${asset}.`,
    };
  },
});

// ── 2. margin_deposit_to_pool ─────────────────────────────────────────────────
export const marginDepositToPool = new FunctionTool({
  name: 'margin_deposit_to_pool',
  description: 'Deposit additional asset into Margin Pool.',
  parameters: z.object({
    pool: z.enum(['SUI_USDC', 'DEEP_SUI']).describe('Margin pool'),
    asset: z.string().describe('Asset to deposit'),
    amount: z.number().min(0).describe('Amount'),
    walletAddress: z.string().describe('Wallet address'),
    executionMode: z.enum(['autonomous', 'require_approval']).optional(),
  }) as any,
  execute: async ({ pool, asset, amount, walletAddress, executionMode }) => {
    if (!walletAddress) throw new Error('Missing walletAddress');

    const { client, managerIds, suiClient } = await getDeepBookClient(walletAddress);
    if (managerIds.length === 0) return { status: 'error', message: 'You have no margin account yet. Use margin_create_account first.' };

    const managerKey = managerIds[0];
    const { serializedTx, txBytes } = await buildPTB(tx => {
      if (asset === 'SUI') {
        client.marginManager.depositBase({ managerKey, amount })(tx);
      } else if (asset === 'USDC') {
        client.marginManager.depositQuote({ managerKey, amount })(tx);
      }
    }, walletAddress, suiClient);

    if (executionMode === 'autonomous') {
      return {
        status: 'executed_autonomous',
        message: `✅ ${amount} ${asset} deposited into the margin account automatically.`,
        network: 'mainnet', serializedTx, txBytes,
      };
    }
    return {
      status: 'pending_confirmation', is_risky: false,
      network: 'mainnet', serializedTx, txBytes,
    };
  },
});

// ── 3. margin_open_position (Borrow) ──────────────────────────────────────────
export const marginOpenPosition = new FunctionTool({
  name: 'margin_open_position',
  description: 'Open Margin position (borrow asset). No platform fee — only Sui network gas.',
  parameters: z.object({
    pool: z.enum(['SUI_USDC', 'DEEP_SUI']).describe('Margin Pool'),
    borrowAsset: z.string().describe('Asset to borrow'),
    borrowAmount: z.number().min(0).describe('Amount vay'),
    collateralAsset: z.string().describe('Existing collateral asset'),
    collateralAmount: z.number().min(0).describe('Collateral amount'),
    walletAddress: z.string().describe('Wallet address'),
    executionMode: z.enum(['autonomous', 'require_approval']).optional(),
  }) as any,
  execute: async ({ pool, borrowAsset, borrowAmount, walletAddress, executionMode }) => {
    if (!walletAddress) throw new Error('Missing walletAddress');

    const { client, managerIds, suiClient } = await getDeepBookClient(walletAddress);
    if (managerIds.length === 0) return { status: 'error', message: 'You have no margin account yet.' };

    // Get skill authors from global context (set by server)
    const skillAuthors: string[] = (globalThis as any).__SKILL_AUTHORS__ || [];

    const managerKey = managerIds[0];
    const { serializedTx, txBytes } = await buildPTB(async tx => {
      // Fresh Pyth feeds FIRST — borrow health-checks against them.
      await injectPythUpdate(tx, suiClient);
      if (borrowAsset === 'SUI') {
        client.marginManager.borrowBase(managerKey, borrowAmount)(tx);
      } else {
        client.marginManager.borrowQuote(managerKey, borrowAmount)(tx);
      }
      // No platform fee — only Sui gas (kept call for back-compat, now no-op)
      injectExecutionFee(tx, skillAuthors);
    }, walletAddress, suiClient);

    if (executionMode === 'autonomous') {
      return {
        status: 'executed_autonomous',
        message: `✅ Borrowed ${borrowAmount} ${borrowAsset} on Margin. (No platform fee — only Sui gas.)`,
        network: 'mainnet', serializedTx, txBytes,
      };
    }
    return {
      status: 'pending_confirmation', is_risky: true,
      network: 'mainnet', serializedTx, txBytes,
    };
  },
});

// ── 4. get_margin_health ──────────────────────────────────────────────────────
export const getMarginHealth = new FunctionTool({
  name: 'get_margin_health',
  description: 'Check Margin account health on DeepBook V3 Mainnet.',
  parameters: z.object({
    walletAddress: z.string().describe("User's Sui address"),
  }) as any,
  execute: async ({ walletAddress }) => {
    const { client, managerIds } = await getDeepBookClient(walletAddress);
    if (managerIds.length === 0) {
      return { hasAccount: false, status: 'No Margin Account found.' };
    }

    const managerKey = managerIds[0];
    const state = await client.getMarginManagerState(managerKey);
    return {
      hasAccount: true,
      managerId: managerKey,
      state,
      message: `Margin account found: ${managerKey}. The current margin ratio can be derived from state.`,
    };
  },
});

// ── 5. margin_withdraw_from_pool ──────────────────────────────────────────────
export const marginWithdrawFromPool = new FunctionTool({
  name: 'margin_withdraw_from_pool',
  description: 'Withdraw asset from Margin Pool back to personal wallet.',
  parameters: z.object({
    pool: z.enum(['SUI_USDC', 'DEEP_SUI']).describe('Margin Pool'),
    asset: z.string().describe('Asset to withdraw (e.g. SUI or USDC)'),
    amount: z.number().min(0).describe('Amount to withdraw'),
    walletAddress: z.string().describe('Wallet address'),
    executionMode: z.enum(['autonomous', 'require_approval']).optional(),
  }) as any,
  execute: async ({ pool, asset, amount, walletAddress, executionMode }) => {
    if (!walletAddress) throw new Error('Missing walletAddress');
    const { client, managerIds, suiClient } = await getDeepBookClient(walletAddress);
    if (managerIds.length === 0) return { status: 'error', message: 'You have no margin account yet.' };

    const managerKey = managerIds[0];
    const { serializedTx, txBytes } = await buildPTB(async tx => {
      // Fresh Pyth feeds — withdraw_with_proof aborts code 3 on stale prices.
      await injectPythUpdate(tx, suiClient);
      // withdrawBase/Quote return the Coin — must transfer to the user or the
      // tx fails with UnusedValueWithoutDrop.
      if (asset === 'SUI') {
        const coin = client.marginManager.withdrawBase(managerKey, amount)(tx);
        tx.transferObjects([coin], tx.pure.address(walletAddress));
      } else {
        const coin = client.marginManager.withdrawQuote(managerKey, amount)(tx);
        tx.transferObjects([coin], tx.pure.address(walletAddress));
      }
    }, walletAddress, suiClient);

    if (executionMode === 'autonomous') {
      return {
        status: 'executed_autonomous',
        message: `✅ ${amount} ${asset} withdrawn from the margin account to your wallet.`,
        network: 'mainnet', serializedTx, txBytes,
      };
    }
    return {
      status: 'pending_confirmation', is_risky: false,
      network: 'mainnet', serializedTx, txBytes,
    };
  },
});

// ── 6. margin_close_position ──────────────────────────────────────────────────
export const marginClosePosition = new FunctionTool({
  name: 'margin_close_position',
  description: 'Close Margin position (repay borrowed asset). No platform fee — only Sui network gas.',
  parameters: z.object({
    pool: z.enum(['SUI_USDC', 'DEEP_SUI']).describe('Margin Pool'),
    asset: z.string().describe('Asset to repay (e.g. SUI or USDC)'),
    amount: z.number().min(0).describe('Debt amount to repay'),
    walletAddress: z.string().describe('Wallet address'),
    executionMode: z.enum(['autonomous', 'require_approval']).optional(),
  }) as any,
  execute: async ({ pool, asset, amount, walletAddress, executionMode }) => {
    if (!walletAddress) throw new Error('Missing walletAddress');
    const { client, managerIds, suiClient } = await getDeepBookClient(walletAddress);
    if (managerIds.length === 0) return { status: 'error', message: 'You have no margin account yet.' };

    // Get skill authors from global context
    const skillAuthors: string[] = (globalThis as any).__SKILL_AUTHORS__ || [];

    const managerKey = managerIds[0];
    const { serializedTx, txBytes } = await buildPTB(async tx => {
      // Fresh Pyth feeds first — repay-side health accounting reads them.
      await injectPythUpdate(tx, suiClient);
      if (asset === 'SUI') {
        client.marginManager.repayBase(managerKey, amount)(tx);
      } else {
        client.marginManager.repayQuote(managerKey, amount)(tx);
      }
      // No platform fee — only Sui gas (kept call for back-compat, now no-op)
      injectExecutionFee(tx, skillAuthors);
    }, walletAddress, suiClient);

    if (executionMode === 'autonomous') {
      return {
        status: 'executed_autonomous',
        message: `✅ Repaid ${amount} ${asset} to the Margin Account. (No platform fee — only Sui gas.)`,
        network: 'mainnet', serializedTx, txBytes,
      };
    }
    return {
      status: 'pending_confirmation', is_risky: true,
      network: 'mainnet', serializedTx, txBytes,
    };
  },
});

export const marginTools = [
  marginCreateAccount,
  marginDepositToPool,
  marginOpenPosition,
  getMarginHealth,
  marginWithdrawFromPool,
  marginClosePosition,
];
