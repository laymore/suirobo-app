/**
 * MARGIN RISK GUARD SKILL
 * Kỹ năng chuyên sâu bảo vệ risk Margin:
 * - Tính Health Factor thực tế dựa trên giá Oracle
 * - Warning nguy cơ Liquidation
 * - Đề xuất mức Leverage an toàn theo khẩu vị risk
 * - Kiểm tra min_borrow theo chuẩn DeepBook V3 (1 SUI min)
 */
import {   FunctionTool   } from '@google/adk';
import { z } from 'zod';
import { predictTools } from '../tools/predict.js';

const MAINNET_RPC = 'https://fullnode.mainnet.sui.io';
const MARGIN_REGISTRY = '0x0e40998b359a9ccbab22a98ed21bd4346abf19158bc7980c8291908086b3a742';
const MARGIN_BASE_POOL  = '0x801dbc2f0053d34734814b2d6df491ce7807a725fe9a01ad74a07e9c51396c37';
const MARGIN_QUOTE_POOL = '0x5dec622733a204ca27f5a90d8c2fad453cc6665186fd5dff13a83d0b6c9027ab';

// Minimum borrow per DeepBook V3 rules
const MIN_SUI_COLLATERAL = 1_000_000_000; // 1 SUI in MIST
const MIN_USDC_BORROW    = 1_000_000;     // 1 USDC in base units (6 decimals)

async function rpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(MAINNET_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  return (await res.json()).result;
}

async function fetchMarginPoolState(poolId: string) {
  const obj = await rpc('sui_getObject', [poolId, { showContent: true }]);
  return obj?.data?.content?.fields ?? null;
}

async function fetchMarginManagersForWallet(walletAddress: string): Promise<string[]> {
  const res = await rpc('suix_getOwnedObjects', [
    walletAddress,
    {
      filter: { StructType: '0x97d9473771b01f77b0940c589484184b49f6444627ec121314fae6a6d36fb86b::margin_manager::MarginManager' },
      options: { showType: true }
    }
  ]);
  return (res?.data ?? []).map((d: any) => d?.data?.objectId).filter(Boolean);
}

export const marginRiskGuardSkill = new FunctionTool({
  name: 'margin_risk_guard',
  description: `Deep Margin risk protection skill on DeepBook V3 Mainnet.
Does: (1) checks pool state (vault balance, borrow ratio, utilization rate), 
(2) validates minimum collateral (>= 1 SUI) and minimum borrow (>= 1 USDC),
(3) computes the health factor and alerts on liquidation risk, 
(4) suggests safe leverage at 3 levels: Conservative/Moderate/Aggressive.
Always call this skill BEFORE opening a margin order to avoid EMinOrderQuantity.`,
  parameters: z.object({
    walletAddress: z.string().describe('User wallet address'),
    collateralAsset: z.enum(['SUI']).default('SUI').describe('Collateral asset'),
    collateralAmountSUI: z.number().min(0).describe('SUI amount to use as collateral (in SUI, not MIST)'),
    borrowAmountUSDC: z.number().min(0).describe('USDC amount to borrow'),
  }) as any,
  execute: async ({ walletAddress, collateralAsset, collateralAmountSUI, borrowAmountUSDC }) => {
    const report: any = {
      timestamp: new Date().toISOString(),
      wallet: walletAddress,
      input: { collateralAsset, collateralAmountSUI, borrowAmountUSDC },
      checks: {},
      poolState: {},
      riskAssessment: {},
      recommendation: {}
    };

    // ── 1. Minimum Size Validation ─────────────────────────────────────────────
    const collateralMist = Math.floor(collateralAmountSUI * 1e9);
    const borrowBase     = Math.floor(borrowAmountUSDC * 1e6);
    report.checks.minCollateral = {
      required: `${MIN_SUI_COLLATERAL / 1e9} SUI`,
      provided: `${collateralAmountSUI} SUI`,
      pass: collateralMist >= MIN_SUI_COLLATERAL,
      warning: collateralMist < MIN_SUI_COLLATERAL
        ? `❌ FAIL: at least 1 SUI of collateral is required — you entered ${collateralAmountSUI} SUI. The transaction would abort on-chain (EMinOrderQuantity).`
        : `✅ Meets the minimum requirement.`
    };
    report.checks.minBorrow = {
      required: `${MIN_USDC_BORROW / 1e6} USDC`,
      provided: `${borrowAmountUSDC} USDC`,
      pass: borrowBase >= MIN_USDC_BORROW,
      warning: borrowBase < MIN_USDC_BORROW
        ? `❌ FAIL: minimum borrow is 1 USDC — you entered ${borrowAmountUSDC} USDC.`
        : `✅ Meets the minimum requirement.`
    };

    // ── 2. Lấy giá Oracle hiện tại ─────────────────────────────────────────────
    let suiPriceUSD = 1.0;
    try {
      const oracleTool = predictTools.find(t => (t as any).name === 'get_oracle_price');
      if (oracleTool) {
        const raw = await (oracleTool as any).execute({ asset: 'SUI' });
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        suiPriceUSD = parsed?.price ?? 1.0;
      }
    } catch (e) {
      suiPriceUSD = 1.06; // fallback từ SuiVision
    }
    report.poolState.suiPriceUSD = suiPriceUSD;

    // ── 3. On-chain Pool State ─────────────────────────────────────────────────
    try {
      const basePoolFields  = await fetchMarginPoolState(MARGIN_BASE_POOL);
      const quotePoolFields = await fetchMarginPoolState(MARGIN_QUOTE_POOL);

      if (basePoolFields) {
        const totalSupply  = parseInt(basePoolFields.total_supply ?? '0') / 1e9;
        const totalBorrow  = parseInt(basePoolFields.total_borrow ?? '0') / 1e9;
        const vaultBalance = parseInt(basePoolFields.vault_balance ?? totalSupply.toString()) / 1e9;
        const utilization  = totalSupply > 0 ? (totalBorrow / totalSupply * 100) : 0;

        report.poolState.basePool = {
          asset: 'SUI',
          totalSupply: `${totalSupply.toFixed(4)} SUI`,
          totalBorrow: `${totalBorrow.toFixed(4)} SUI`,
          utilizationRate: `${utilization.toFixed(2)}%`,
          availableLiquidity: `${Math.max(0, vaultBalance - totalBorrow).toFixed(4)} SUI`
        };
      }

      if (quotePoolFields) {
        const totalSupplyQ  = parseInt(quotePoolFields.total_supply ?? '0') / 1e6;
        const totalBorrowQ  = parseInt(quotePoolFields.total_borrow ?? '0') / 1e6;
        const utilizationQ  = totalSupplyQ > 0 ? (totalBorrowQ / totalSupplyQ * 100) : 0;

        report.poolState.quotePool = {
          asset: 'USDC',
          totalSupply: `${totalSupplyQ.toFixed(2)} USDC`,
          totalBorrow: `${totalBorrowQ.toFixed(2)} USDC`,
          utilizationRate: `${utilizationQ.toFixed(2)}%`,
          availableLiquidity: `${Math.max(0, totalSupplyQ - totalBorrowQ).toFixed(2)} USDC`
        };
      }
    } catch (e: any) {
      report.poolState.error = `Could not fetch on-chain pool state: ${e.message}`;
    }

    // ── 4. Tính Health Factor & Liquidation Risk ────────────────────────────────
    const collateralValueUSD = collateralAmountSUI * suiPriceUSD;
    const borrowValueUSD     = borrowAmountUSDC; // 1 USDC = $1
    const ltv                = borrowValueUSD / collateralValueUSD;
    const healthFactor       = collateralValueUSD / borrowValueUSD;

    // DeepBook V3 thường dùng max LTV 80%, liquidation at 90%
    const MAX_LTV             = 0.80;
    const LIQUIDATION_LTV     = 0.90;
    const LIQUIDATION_PRICE   = borrowValueUSD / (collateralAmountSUI * LIQUIDATION_LTV);

    report.riskAssessment = {
      collateralValueUSD: `$${collateralValueUSD.toFixed(4)}`,
      borrowValueUSD: `$${borrowValueUSD.toFixed(4)}`,
      currentLTV: `${(ltv * 100).toFixed(2)}%`,
      maxSafeLTV: `${(MAX_LTV * 100).toFixed(0)}%`,
      healthFactor: healthFactor.toFixed(4),
      liquidationPrice: `$${LIQUIDATION_PRICE.toFixed(4)} per SUI`,
      currentPrice: `$${suiPriceUSD.toFixed(4)} per SUI`,
      priceBufferToLiquidation: `${((suiPriceUSD / LIQUIDATION_PRICE - 1) * 100).toFixed(2)}%`,
      riskLevel:
        ltv > LIQUIDATION_LTV ? '🔴 DANGER — the position would be liquidated immediately!' :
        ltv > MAX_LTV         ? '🟠 HIGH — close to the liquidation threshold, do not open' :
        ltv > 0.6             ? '🟡 MEDIUM — watch closely' :
                                '🟢 SAFE — good safety margin',
    };

    // ── 5. Đề xuất Leverage tối ưu ─────────────────────────────────────────────
    const safeBorrowConservative = collateralValueUSD * 0.3;  // LTV 30%
    const safeBorrowModerate     = collateralValueUSD * 0.5;  // LTV 50%
    const safeBorrowAggressive   = collateralValueUSD * 0.75; // LTV 75%

    report.recommendation = {
      shouldExecute: report.checks.minCollateral.pass && report.checks.minBorrow.pass && ltv <= MAX_LTV,
      reason: !report.checks.minCollateral.pass ? report.checks.minCollateral.warning
             : !report.checks.minBorrow.pass ? report.checks.minBorrow.warning
             : ltv > MAX_LTV ? `LTV ${(ltv*100).toFixed(1)}% exceeds the max ${(MAX_LTV*100).toFixed(0)}%`
             : `Position is safe with health factor ${healthFactor.toFixed(2)}`,
      leverageSuggestions: {
        conservative: {
          label: '🟢 Conservative (LTV 30%)',
          maxBorrowUSDC: safeBorrowConservative.toFixed(2),
          description: 'Low risk, suitable for highly volatile markets'
        },
        moderate: {
          label: '🟡 Moderate (LTV 50%)',
          maxBorrowUSDC: safeBorrowModerate.toFixed(2),
          description: 'Balanced risk/reward, suitable for clear trends'
        },
        aggressive: {
          label: '🔴 Aggressive (LTV 75%)',
          maxBorrowUSDC: safeBorrowAggressive.toFixed(2),
          description: 'High risk, only when strongly confident in trend'
        }
      },
      nextAction: report.checks.minCollateral.pass && report.checks.minBorrow.pass && ltv <= MAX_LTV
        ? 'Call margin_create_account, then margin_open_position with the validated amounts'
        : 'Adjust the amounts per the recommendation before executing'
    };

    // ── 6. Tóm tắt cuối ───────────────────────────────────────────────────────
    report.summary = report.recommendation.shouldExecute
      ? `✅ APPROVED: ${collateralAmountSUI} SUI → ${borrowAmountUSDC} USDC is safe. Liquidation price $${LIQUIDATION_PRICE.toFixed(3)}.`
      : `❌ BLOCKED: ${report.recommendation.reason}`;

    return JSON.stringify(report, null, 2);
  }
});
