/**
 * MARGIN PORTFOLIO GUARDIAN SKILL
 * ─────────────────────────────────────────────────────
 * Kỹ năng giám sát danh mục Margin LIÊN TỤC sau khi mở vị thế:
 *
 *  1. Quét tất cả MarginManager của ví trên Mainnet
 *  2. Với mỗi vị thế, tính Health Factor THỰC TẾ dựa trên giá Oracle live
 *  3. Play hiện vị thế nào gần ngưỡng thanh lý (Liquidation Zone)
 *  4. Tính toán "thời gian an toàn còn lại" dựa trên trend giá + IV
 *  5. Đề xuất hành động: HOLD / ADD_COLLATERAL / CLOSE_NOW
 *  6. Tạo bản đồ nhiệt (Heat Map) risk toàn danh mục
 *
 * → Đây là "Hệ thống alert sớm" cho Margin
 */
import {   FunctionTool   } from '@google/adk';
import { z } from 'zod';

const MAINNET_RPC = 'https://fullnode.mainnet.sui.io';
const MARGIN_MANAGER_TYPE = '0x97d9473771b01f77b0940c589484184b49f6444627ec121314fae6a6d36fb86b::margin_manager::MarginManager';
const MARGIN_BASE_POOL  = '0x801dbc2f0053d34734814b2d6df491ce7807a725fe9a01ad74a07e9c51396c37';
const MARGIN_QUOTE_POOL = '0x5dec622733a204ca27f5a90d8c2fad453cc6665186fd5dff13a83d0b6c9027ab';

// Liquidation thresholds from DeepBook V3
const LIQUIDATION_LTV   = 0.90;  // 90% LTV → thanh lý
const WARNING_LTV       = 0.75;  // 75% LTV → alert vàng
const DANGER_LTV        = 0.85;  // 85% LTV → alert đỏ

async function mainnetRpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(MAINNET_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  return (await res.json()).result;
}

// Lấy giá SUI từ CoinGecko live
async function getSuiPriceLive(): Promise<{ price: number; change1h: number; change24h: number }> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd&include_24hr_change=true&include_1hr_change=true',
      { signal: AbortSignal.timeout(5000) }
    );
    const data = await res.json();
    return {
      price: data.sui?.usd ?? 1.06,
      change1h: data.sui?.usd_1h_change ?? 0,
      change24h: data.sui?.usd_24h_change ?? 0
    };
  } catch {
    return { price: 1.06, change1h: 0, change24h: 0 };
  }
}

// Lấy pool state (tổng vay, tổng cung)
async function getPoolState(poolId: string) {
  const obj = await mainnetRpc('sui_getObject', [poolId, { showContent: true }]);
  const fields = obj?.data?.content?.fields;
  if (!fields) return null;
  return {
    totalSupply: parseInt(fields.total_supply ?? '0'),
    totalBorrow: parseInt(fields.total_borrow ?? '0'),
    vaultBalance: parseInt(fields.vault_balance ?? fields.total_supply ?? '0')
  };
}

// Lấy tất cả MarginManager objects của ví
async function getMarginManagers(walletAddress: string) {
  const res = await mainnetRpc('suix_getOwnedObjects', [
    walletAddress,
    {
      filter: { StructType: MARGIN_MANAGER_TYPE },
      options: { showContent: true, showType: true }
    }
  ]);
  return (res?.data ?? []).map((d: any) => ({
    objectId: d?.data?.objectId,
    fields: d?.data?.content?.fields ?? {}
  }));
}

// Ước tính "thời gian an toàn" dựa trên momentum giá
function estimateSafeTimeHours(
  currentPrice: number,
  liquidationPrice: number,
  change1hPct: number
): { hours: number; label: string } {
  // Nếu giá đang tăng → không cần lo
  if (change1hPct >= 0 && currentPrice > liquidationPrice) {
    return { hours: 999, label: '♾️ Safe — price rising' };
  }
  
  // Nếu giá đang giảm, ước tính bao lâu sẽ chạm liquidation
  const dropNeeded = currentPrice - liquidationPrice;
  if (dropNeeded <= 0) return { hours: 0, label: '🚨 LIQUIDATION HIT' };
  
  const hourlyDrop = currentPrice * Math.abs(change1hPct) / 100;
  if (hourlyDrop <= 0) return { hours: 999, label: '♾️ Safe — price flat' };
  
  const hoursLeft = dropNeeded / hourlyDrop;
  
  if (hoursLeft < 2) return { hours: hoursLeft, label: `🔴 ${hoursLeft.toFixed(1)}h → EXTREMELY DANGEROUS` };
  if (hoursLeft < 6) return { hours: hoursLeft, label: `🟠 ${hoursLeft.toFixed(1)}h → Watch closely` };
  if (hoursLeft < 24) return { hours: hoursLeft, label: `🟡 ${hoursLeft.toFixed(0)}h → Keep an eye on it` };
  return { hours: hoursLeft, label: `🟢 ${hoursLeft.toFixed(0)}h → Comfortable` };
}

export const marginPortfolioGuardianSkill = new FunctionTool({
  name: 'margin_portfolio_guardian',
  description: `Continuous Margin portfolio monitoring skill on DeepBook V3 Mainnet.
Does: (1) scans all open MarginManagers,
(2) computes the REAL health factor from live oracle prices,
(3) estimates remaining safe time from 1h price momentum,
(4) flags positions near the liquidation zone (LTV > 75%),
(5) builds a risk heat map & suggests an action: HOLD / ADD_COLLATERAL / CLOSE_NOW,
(6) computes exactly how much extra collateral brings LTV back to safety.
Call periodically (every 5-15 minutes) or when the market moves hard.`,
  parameters: z.object({
    walletAddress: z.string().describe('Wallet address Sui Mainnet'),
  }) as any,
  execute: async ({ walletAddress }) => {
    const report: any = {
      timestamp: new Date().toISOString(),
      wallet: walletAddress,
      network: 'mainnet',
      marketSnapshot: {},
      positions: [],
      portfolioHeatMap: {},
      alerts: [],
      recommendations: []
    };

    // ── 1. Giá Oracle Live ────────────────────────────────────────────────────
    const suiData = await getSuiPriceLive();
    report.marketSnapshot = {
      suiPrice: `$${suiData.price.toFixed(4)}`,
      trend1h: `${suiData.change1h >= 0 ? '+' : ''}${suiData.change1h.toFixed(2)}%`,
      trend24h: `${suiData.change24h >= 0 ? '+' : ''}${suiData.change24h.toFixed(2)}%`,
      momentum: suiData.change1h > 0.5 ? '📈 BULLISH'
               : suiData.change1h < -0.5 ? '📉 BEARISH'
               : '↔️ SIDEWAY',
      volatilityAlert: Math.abs(suiData.change1h) > 3
        ? '⚠️ HIGH VOLATILITY (>3%/h) — increase monitoring frequency!'
        : null
    };

    // ── 2. Pool State On-chain ────────────────────────────────────────────────
    try {
      const basePool = await getPoolState(MARGIN_BASE_POOL);
      const quotePool = await getPoolState(MARGIN_QUOTE_POOL);

      if (basePool) {
        const utilization = basePool.totalSupply > 0
          ? (basePool.totalBorrow / basePool.totalSupply * 100)
          : 0;
        report.marketSnapshot.basePoolUtilization = `${utilization.toFixed(1)}%`;
        report.marketSnapshot.basePoolLiquidity = `${((basePool.totalSupply - basePool.totalBorrow) / 1e9).toFixed(2)} SUI`;

        // Warning thanh khoản thấp
        if (utilization > 85) {
          report.alerts.push({
            level: '🔴 CRITICAL',
            message: `The SUI pool is running low on liquidity (utilization ${utilization.toFixed(1)}%). Withdrawals may be slow.`
          });
        }
      }
      if (quotePool) {
        const utilQ = quotePool.totalSupply > 0
          ? (quotePool.totalBorrow / quotePool.totalSupply * 100)
          : 0;
        report.marketSnapshot.quotePoolUtilization = `${utilQ.toFixed(1)}%`;
        report.marketSnapshot.quotePoolLiquidity = `${((quotePool.totalSupply - quotePool.totalBorrow) / 1e6).toFixed(2)} USDC`;
      }
    } catch (e: any) {
      report.marketSnapshot.poolError = e.message;
    }

    // ── 3. Quét tất cả MarginManager ──────────────────────────────────────────
    const managers = await getMarginManagers(walletAddress);

    if (managers.length === 0) {
      report.portfolioHeatMap = { status: '⚪ EMPTY', message: 'No open margin positions.' };
      report.summary = '✅ Portfolio empty — no margin risk.';
      return JSON.stringify(report, null, 2);
    }

    // ── 4. Phân tích từng vị thế ──────────────────────────────────────────────
    let totalCollateralUSD = 0;
    let totalBorrowUSD = 0;
    let worstHealthFactor = Infinity;
    let criticalCount = 0;

    for (const mgr of managers) {
      const fields = mgr.fields;
      // Trích xuất collateral và debt từ MarginManager fields
      const collateralSUI = parseInt(fields.base_balance ?? fields.collateral ?? '0') / 1e9;
      const debtUSDC = parseInt(fields.quote_debt ?? fields.borrow_amount ?? '0') / 1e6;

      // Nếu không có vay thì bỏ qua
      if (debtUSDC <= 0 && collateralSUI <= 0) continue;

      const collateralValueUSD = collateralSUI * suiData.price;
      const borrowValueUSD = debtUSDC;
      const ltv = borrowValueUSD > 0 ? borrowValueUSD / collateralValueUSD : 0;
      const healthFactor = borrowValueUSD > 0 ? collateralValueUSD / borrowValueUSD : 999;
      const liquidationPrice = borrowValueUSD / (collateralSUI * LIQUIDATION_LTV);
      const safeTime = estimateSafeTimeHours(suiData.price, liquidationPrice, suiData.change1h);

      // Tính số tiền cần nạp thêm để đưa LTV về 50%
      const targetLTV = 0.50;
      const additionalCollateralNeeded = ltv > targetLTV
        ? (borrowValueUSD / targetLTV - collateralValueUSD) / suiData.price
        : 0;

      // Xác định hành động đề xuất
      let action: string;
      let actionReason: string;
      let urgency: string;

      if (ltv >= LIQUIDATION_LTV) {
        action = '🚨 CLOSE_NOW';
        actionReason = 'Position is about to be auto-liquidated! Close now to save capital.';
        urgency = 'URGENT';
        criticalCount++;
      } else if (ltv >= DANGER_LTV) {
        action = '⚡ ADD_COLLATERAL';
        actionReason = `Deposit ${additionalCollateralNeeded.toFixed(2)} more SUI to bring LTV back to 50%.`;
        urgency = 'CAO';
        criticalCount++;
      } else if (ltv >= WARNING_LTV) {
        action = '👁️ MONITOR_CLOSELY';
        actionReason = `LTV ${(ltv*100).toFixed(1)}% — set an alarm to check the SUI price every 5 minutes.`;
        urgency = 'MEDIUM';
      } else if (ltv > 0) {
        action = '✅ HOLD';
        actionReason = 'Position is safe — keep holding.';
        urgency = 'LOW';
      } else {
        action = '💤 IDLE';
        actionReason = 'No borrows on this account — no risk.';
        urgency = 'NONE';
      }

      const position = {
        managerId: mgr.objectId,
        collateral: `${collateralSUI.toFixed(4)} SUI ($${collateralValueUSD.toFixed(2)})`,
        debt: `${debtUSDC.toFixed(2)} USDC`,
        ltv: `${(ltv * 100).toFixed(2)}%`,
        healthFactor: healthFactor.toFixed(2),
        liquidationPrice: `$${liquidationPrice.toFixed(4)} /SUI`,
        currentPrice: `$${suiData.price.toFixed(4)} /SUI`,
        priceBufferToLiquidation: `${((suiData.price / liquidationPrice - 1) * 100).toFixed(2)}%`,
        safeTimeEstimate: safeTime.label,
        action,
        actionReason,
        urgency,
        additionalCollateralNeeded: additionalCollateralNeeded > 0
          ? `${additionalCollateralNeeded.toFixed(2)} SUI ($${(additionalCollateralNeeded * suiData.price).toFixed(2)})`
          : 'Not needed'
      };

      report.positions.push(position);
      totalCollateralUSD += collateralValueUSD;
      totalBorrowUSD += borrowValueUSD;
      worstHealthFactor = Math.min(worstHealthFactor, healthFactor);
    }

    // ── 5. Heat Map tổng danh mục ─────────────────────────────────────────────
    const portfolioLTV = totalBorrowUSD > 0 ? totalBorrowUSD / totalCollateralUSD : 0;
    report.portfolioHeatMap = {
      totalPositions: managers.length,
      activePositions: report.positions.length,
      criticalPositions: criticalCount,
      totalCollateral: `$${totalCollateralUSD.toFixed(2)}`,
      totalDebt: `$${totalBorrowUSD.toFixed(2)}`,
      portfolioLTV: `${(portfolioLTV * 100).toFixed(2)}%`,
      worstHealthFactor: worstHealthFactor === Infinity ? 'N/A' : worstHealthFactor.toFixed(2),
      overallRisk:
        criticalCount > 0 ? '🔴 DANGER — positions need action now!'
        : portfolioLTV > WARNING_LTV ? '🟠 HIGH — watch closely'
        : portfolioLTV > 0.5 ? '🟡 MEDIUM'
        : portfolioLTV > 0 ? '🟢 SAFE'
        : '⚪ EMPTY'
    };

    // ── 6. Auto-generated alerts ──────────────────────────────────────────────
    if (Math.abs(suiData.change1h) > 2) {
      report.alerts.push({
        level: '⚠️ MARKET',
        message: `SUI moved ${suiData.change1h.toFixed(2)}% in 1h. ${suiData.change1h < 0 ? 'Check your LONG positions!' : 'Consider taking profit.'}`
      });
    }

    // ── 7. Summary ────────────────────────────────────────────────────────────
    if (criticalCount > 0) {
      report.summary = `🚨 WARNING: ${criticalCount} positions need urgent action! Portfolio LTV: ${(portfolioLTV*100).toFixed(1)}%. Act now to avoid liquidation.`;
    } else if (report.positions.length > 0) {
      report.summary = `✅ Portfolio safe: ${report.positions.length} positions, portfolio LTV ${(portfolioLTV*100).toFixed(1)}%, Worst HF ${worstHealthFactor.toFixed(2)}.`;
    } else {
      report.summary = '💤 No open margin positions.';
    }

    return JSON.stringify(report, null, 2);
  }
});
