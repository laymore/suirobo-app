const { execSync } = require('child_process');
const PACKAGE_ID = '0x888f919f64154138f6e21a2341515f68d472be54c45eb9c70e628cfb5458958a';
const SKILLS = [
  ['auto_sl_tp_manager','Smart automatic take-profit & stop-loss. Self-adapts to actual asset volatility.','walrus-auto-sl-tp-blob'],
  ['deepbook_data_skill','Scan SUI/USDC liquidity depth and calculate spread to suggest optimal trading strategy.','walrus-deepbook-data-blob'],
  ['margin_analyzer','Evaluate leverage risk, warn on margin position liquidation, and calculate safe liquidation price.','walrus-margin-analyzer-blob'],
  ['margin_entry_strategist','Find optimal entry points by analyzing supply/demand on DeepBook V3 limit order book.','walrus-margin-entry-blob'],
  ['margin_portfolio_guardian','Monitor all your Margin accounts and auto-rebalance collateral to prevent liquidation.','walrus-portfolio-guardian-blob'],
  ['margin_risk_guard','Smart leverage insurance. Auto-suggests reducing leverage or adding collateral when market drops sharply.','walrus-risk-guard-blob'],
  ['predict_analyzer','Evaluate price volatility chains to predict winning opportunities in Binary Options cycles.','walrus-predict-analyzer-blob'],
  ['predict_multi_asset_allocator','Optimal multi-asset capital allocation using Kelly Criterion to maximize long-term account growth.','walrus-multi-asset-blob'],
  ['predict_opportunity_scanner','Auto-scan price discrepancies between Spot and Predict using Black-Scholes to find mispricing.','walrus-opportunity-scanner-blob'],
  ['predict_position_monitor','Real-time P&L monitoring of Predict positions, auto-suggests early option sell-back to recover capital.','walrus-position-monitor-blob'],
  ['token_analyzer','Analyze advanced momentum indicators (RSI, MACD, Volume) of SUI, CETUS, DEEP tokens on-chain.','walrus-token-analyzer-blob'],
];
const results = [];
for (const [name, desc, blob] of SKILLS) {
  process.stdout.write(`Publishing ${name} @ 0 SUI... `);
  try {
    const cmd = `sui client call --package ${PACKAGE_ID} --module suirobo_factory --function publish_skill --args "${name}" "${desc}" "${blob}" "1.0.0" 0 --gas-budget 50000000 --json`;
    const out = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe','pipe','pipe'] });
    const j = JSON.parse(out);
    const created = (j.objectChanges||[]).filter(c=>c.type==='created'&&c.objectType&&c.objectType.includes('::Skill'));
    const skillId = created[0]?.objectId || '?';
    const digest = j.digest;
    console.log(`OK  skillId=${skillId}`);
    results.push({name, skillId, digest, status:'ok'});
  } catch (e) {
    console.log(`FAIL`);
    console.error('  err:', (e.stderr||e.message||'').toString().slice(0,200));
    results.push({name, status:'fail', err:(e.stderr||e.message||'').toString().slice(0,150)});
  }
}
require('fs').writeFileSync('zero_skills_result.json', JSON.stringify(results,null,2));
const ok = results.filter(r=>r.status==='ok').length;
console.log(`\n=== DONE: ${ok}/${SKILLS.length} published at 0 SUI ===`);
