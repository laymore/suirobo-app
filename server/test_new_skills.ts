/**
 * Test 2 Advanced Skills Mới:
 * 1. margin_portfolio_guardian — Giám sát danh mục Margin
 * 2. predict_multi_asset_allocator — Phân bổ vốn Kelly Criterion
 */

import { marginPortfolioGuardianSkill } from '../src/agent/skills/margin_portfolio_guardian.js';
import { predictMultiAssetAllocatorSkill } from '../src/agent/skills/predict_multi_asset_allocator.js';

const WALLET = '0xafbc48fd349fb44ce9c6f2b33423e6ae7c826d53a25920a0d4c3c475e40889c5';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🧪 TEST 2 NEW ADVANCED SKILLS');
  console.log('═══════════════════════════════════════════════════════════\n');

  // ── Test 1: Margin Portfolio Guardian ──────────────────────────────────────
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│ SKILL 1: margin_portfolio_guardian (Mainnet)           │');
  console.log('└─────────────────────────────────────────────────────────┘');
  try {
    const raw1 = await (marginPortfolioGuardianSkill as any).execute({
      walletAddress: WALLET
    });
    const report1 = JSON.parse(raw1);
    console.log(`  📊 Market Snapshot:`);
    console.log(`     SUI Price: ${report1.marketSnapshot.suiPrice}`);
    console.log(`     Trend 1h: ${report1.marketSnapshot.trend1h}`);
    console.log(`     Trend 24h: ${report1.marketSnapshot.trend24h}`);
    console.log(`     Momentum: ${report1.marketSnapshot.momentum}`);
    console.log(`     Base Pool Util: ${report1.marketSnapshot.basePoolUtilization ?? 'N/A'}`);
    console.log(`     Base Pool Liq: ${report1.marketSnapshot.basePoolLiquidity ?? 'N/A'}`);
    console.log(`  🗂️ Portfolio Heat Map:`);
    console.log(`     ${JSON.stringify(report1.portfolioHeatMap, null, 2).split('\n').join('\n     ')}`);
    if (report1.positions.length > 0) {
      console.log(`  📌 Active Positions:`);
      for (const pos of report1.positions) {
        console.log(`     • Manager: ${pos.managerId?.slice(0,16)}...`);
        console.log(`       Collateral: ${pos.collateral} | Debt: ${pos.debt}`);
        console.log(`       LTV: ${pos.ltv} | HF: ${pos.healthFactor}`);
        console.log(`       Action: ${pos.action} — ${pos.actionReason}`);
        console.log(`       Safe Time: ${pos.safeTimeEstimate}`);
      }
    }
    if (report1.alerts.length > 0) {
      console.log(`  ⚠️ Alerts: ${report1.alerts.map((a: any) => `${a.level}: ${a.message}`).join(' | ')}`);
    }
    console.log(`  📝 Summary: ${report1.summary}`);
  } catch (e: any) {
    console.log(`  ❌ Error: ${e.message}`);
  }

  console.log('\n');

  // ── Test 2: Predict Multi-Asset Allocator ─────────────────────────────────
  console.log('┌─────────────────────────────────────────────────────────┐');
  console.log('│ SKILL 2: predict_multi_asset_allocator (Testnet)       │');
  console.log('└─────────────────────────────────────────────────────────┘');
  try {
    const raw2 = await (predictMultiAssetAllocatorSkill as any).execute({
      totalCapitalDUSDC: 50,
      riskProfile: 'moderate'
    });
    const report2 = JSON.parse(raw2);
    
    console.log(`  📡 Market Scan (${report2.marketScan.length} assets):`);
    for (const m of report2.marketScan) {
      console.log(`     ${m.asset}: ${m.price} (${m.trend}) | IV: ${m.iv} | Dir: ${m.optimalDirection} | Strike: ${m.optimalStrike} | WP: ${m.winProbability} | EV: ${m.ev} | ${m.verdict}`);
    }
    
    console.log(`  💰 Portfolio Allocation (${report2.portfolioAllocation.strategy}):`);
    for (const a of report2.portfolioAllocation.allocations) {
      console.log(`     ${a.asset} ${a.direction} @ ${a.strikePrice}: ${a.allocatedDUSDC} DUSDC (${a.weight}) | EV: ${a.ev} | WP: ${a.winProbability}`);
    }
    console.log(`     Cash Reserve: ${report2.portfolioAllocation.cashReserve}`);
    console.log(`     Total Expected Return: ${report2.portfolioAllocation.totalExpectedReturn}`);

    console.log(`  ⚔️ Single vs Diversified:`);
    console.log(`     Single Best: ${report2.comparison.singleBest.strategy} → ${report2.comparison.singleBest.expectedReturn}`);
    console.log(`     Diversified: ${report2.comparison.diversified.strategy} → ${report2.comparison.diversified.expectedReturn}`);
    console.log(`     Winner: ${report2.comparison.winner}`);
    
    console.log(`  📝 Summary: ${report2.summary}`);
  } catch (e: any) {
    console.log(`  ❌ Error: ${e.message}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('✅ TEST HOÀN TẤT');
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch(console.error);
