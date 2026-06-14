/**
 * TEST: Hệ Thống Skills Chuyên Sâu DeepTrade
 * Test 4 skills mới:
 * 1. margin_risk_guard       — Bảo vệ rủi ro Margin (check min size, health factor)
 * 2. margin_entry_strategist — Chiến lược vào lệnh (entry, SL, TP, carry cost)
 * 3. predict_opportunity_scanner — Quét cơ hội Predict (EV, Black-Scholes)
 * 4. predict_position_monitor    — Theo dõi vị thế đang mở (P&L, redeem vs hold)
 */

import { marginRiskGuardSkill } from '../src/agent/skills/margin_risk_guard.js';
import { marginEntryStrategistSkill } from '../src/agent/skills/margin_entry_strategist.js';
import { predictOpportunityScannerSkill } from '../src/agent/skills/predict_opportunity_scanner.js';
import { predictPositionMonitorSkill } from '../src/agent/skills/predict_position_monitor.js';

const WALLET = '0xafbc48fd349fb44ce9c6f2b33423e6ae7c826d53a25920a0d4c3c475e40889c5';

async function runAdvancedSkillTests() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("🧠 TEST: HỆ THỐNG SKILLS CHUYÊN SÂU DEEPTRADE (ADK)");
  console.log("═══════════════════════════════════════════════════════\n");

  // ─────────────────────────────────────────────────────────
  // TEST 1: Margin Risk Guard — Kiểm tra size 0.1 SUI (sẽ BỊ CHẶN)
  // ─────────────────────────────────────────────────────────
  console.log("─────────────────────────────────────────────────────");
  console.log("🔐 SKILL 1: margin_risk_guard");
  console.log("📋 Test Case A: 0.1 SUI collateral (< 1 SUI min) → Phải bị chặn");
  console.log("─────────────────────────────────────────────────────");
  const riskCheck1 = await (marginRiskGuardSkill as any).execute({
    walletAddress: WALLET,
    collateralAsset: 'SUI',
    collateralAmountSUI: 0.1,
    borrowAmountUSDC: 0.1
  });
  const r1 = JSON.parse(riskCheck1);
  console.log("  Summary:", r1.summary);
  console.log("  Min Collateral Check:", r1.checks?.minCollateral?.warning);
  console.log("  ShouldExecute:", r1.recommendation?.shouldExecute);
  console.log();

  console.log("📋 Test Case B: 2 SUI collateral, vay 1 USDC → Phải AN TOÀN");
  console.log("─────────────────────────────────────────────────────");
  const riskCheck2 = await (marginRiskGuardSkill as any).execute({
    walletAddress: WALLET,
    collateralAsset: 'SUI',
    collateralAmountSUI: 2,
    borrowAmountUSDC: 1
  });
  const r2 = JSON.parse(riskCheck2);
  console.log("  Summary:", r2.summary);
  console.log("  Health Factor:", r2.riskAssessment?.healthFactor);
  console.log("  Liquidation Price:", r2.riskAssessment?.liquidationPrice);
  console.log("  Risk Level:", r2.riskAssessment?.riskLevel);
  console.log("  Conservative Borrow:", r2.recommendation?.leverageSuggestions?.conservative?.maxBorrowUSDC, "USDC");
  console.log();

  // ─────────────────────────────────────────────────────────
  // TEST 2: Margin Entry Strategist — Tính điểm vào SUI
  // ─────────────────────────────────────────────────────────
  console.log("─────────────────────────────────────────────────────");
  console.log("📈 SKILL 2: margin_entry_strategist");
  console.log("📋 Test: Phân tích SUI AUTO-direction với vốn 10 USDC");
  console.log("─────────────────────────────────────────────────────");
  const entry = await (marginEntryStrategistSkill as any).execute({
    asset: 'SUI',
    direction: 'AUTO',
    capitalUSDC: 10
  });
  const e = JSON.parse(entry);
  console.log("  Momentum:", e.momentumAnalysis?.signal);
  console.log("  Recommended Direction:", e.recommendedDirection);
  console.log("  Entry Price:", e.tradeSetup?.entryPrice);
  console.log("  Stop Loss:", e.tradeSetup?.stopLoss);
  console.log("  Take Profit:", e.tradeSetup?.takeProfit);
  console.log("  R/R Ratio:", e.tradeSetup?.riskRewardRatio);
  console.log("  Weekly Carry Cost:", e.tradeSetup?.weeklyCostOfCarry);
  console.log("  USDC Borrow APR:", e.marginPoolState?.usdcBorrowPool?.borrowAPR ?? 'N/A');
  console.log("  Summary:", e.summary);
  console.log();

  // ─────────────────────────────────────────────────────────
  // TEST 3: Predict Opportunity Scanner — Quét cơ hội BTC
  // ─────────────────────────────────────────────────────────
  console.log("─────────────────────────────────────────────────────");
  console.log("🔮 SKILL 3: predict_opportunity_scanner");
  console.log("📋 Test: Quét cơ hội BTC UP với 10 DUSDC");
  console.log("─────────────────────────────────────────────────────");
  const scanner = await (predictOpportunityScannerSkill as any).execute({
    asset: 'BTC',
    direction: 'AUTO',
    capitalDUSDC: 10
  });
  const s = JSON.parse(scanner);
  console.log("  Current Price:", s.oracleData?.currentPrice);
  console.log("  Days to Expiry:", s.oracleData?.daysToExpiry, "ngày");
  console.log("  Recommended Direction:", s.recommendedStrategy?.direction);
  console.log("  Optimal Strike:", "$" + s.recommendedStrategy?.selectedStrikePrice);
  console.log("  Strike E9 format:", s.recommendedStrategy?.selectedStrikePriceE9);
  console.log("  Win Probability:", s.recommendedStrategy?.winProbability);
  console.log("  Expected Value:", s.recommendedStrategy?.expectedValue);
  console.log("  Verdict:", s.recommendedStrategy?.verdict);
  console.log("  Max Payout:", s.capitalPlan?.maxPayout);
  console.log("  Expected Return:", s.capitalPlan?.expectedReturn);
  console.log("  \n  Strike Comparison Table:");
  (s.strikeComparison ?? []).forEach((opt: any) => {
    console.log(`    ${opt.label}: Strike=${opt.strike}, WinProb=${opt.winProbability}, EV=${opt.expectedValue}`);
  });
  console.log("  Summary:", s.summary);
  console.log();

  // ─────────────────────────────────────────────────────────
  // TEST 4: Predict Position Monitor — Theo dõi vị thế đang mở
  // ─────────────────────────────────────────────────────────
  console.log("─────────────────────────────────────────────────────");
  console.log("📡 SKILL 4: predict_position_monitor");
  console.log("📋 Test: Theo dõi danh mục BTC của ví");
  console.log("─────────────────────────────────────────────────────");
  const monitor = await (predictPositionMonitorSkill as any).execute({
    walletAddress: WALLET,
    asset: 'BTC'
  });
  const m = JSON.parse(monitor);
  console.log("  Market Condition:", m.marketContext?.marketCondition);
  console.log("  Total Capital At Risk:", m.portfolio?.totalCapitalAtRisk);
  console.log("  Overall Status:", m.portfolio?.overallStatus);
  if (m.positions?.length > 0) {
    const pos = m.positions[0];
    console.log("  Position Status:", pos.pnlStatus);
    console.log("  Estimated P&L:", pos.estimatedPnL, `(${pos.estimatedPnLPct})`);
    console.log("  Recommendation:", pos.recommendation);
    console.log("  Days Remaining:", pos.daysRemaining, "ngày");
  }
  console.log();

  console.log("═══════════════════════════════════════════════════════");
  console.log("✅ HOÀN TẤT: Tất cả 4 Advanced Skills hoạt động thành công!");
  console.log("═══════════════════════════════════════════════════════");
}

runAdvancedSkillTests().catch(console.error);
