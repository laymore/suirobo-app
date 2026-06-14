/**
 * Test Backtest Engine — Verify Bot Skill chạy đúng trên data BTC 2025
 */
import { runBacktest, configFromBotSkill, type Candle } from './src/agent/backtestEngine.js';
import fs from 'fs';
import path from 'path';

const TF = process.argv[2] || 'H4';
const DURATION_DAYS = parseInt(process.argv[3] || '92');

// Load BTC data
const dataFile = path.join(process.cwd(), 'public', 'data', `btc_2025_${TF}.json`);
console.log(`📂 Loading ${dataFile}`);
const allData: Candle[] = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

// Slice theo duration
const TF_MAP: Record<string, number> = { D1: 1, H4: 6, H1: 24, M30: 48, M15: 96, M5: 288 };
const cpd = TF_MAP[TF] || 1;
const sliceSize = Math.min(allData.length, DURATION_DAYS * cpd + 30);
const data = allData.slice(0, sliceSize);

console.log(`📊 Test data: ${data.length} candles (${TF}, ${DURATION_DAYS} days)`);
console.log(`   First: ${data[0].date} @ $${data[0].close}`);
console.log(`   Last:  ${data[data.length - 1].date} @ $${data[data.length - 1].close}`);
console.log();

// Bot Skill từ Task 2
const botSkill = {
  signal: 'ema_cross' as const,
  takeProfitPct: 5,
  stopLossPct: 2,
  trailingStopPct: 1.5,
  enableTrailing: true,
  enableDefense: true,
  leverage: 3,
  orderPct: 50,
  commission: 0.05,
  direction: 'both' as const,
};

const cfg = configFromBotSkill(botSkill, 10000); // 10,000 USD vốn

console.log('🤖 Bot Config:');
console.log(`   Signal: ${cfg.indicator}`);
console.log(`   Leverage: ${cfg.leverage}x | Order: ${cfg.orderPct}%`);
console.log(`   TP/SL: ${cfg.takeProfitPct}% / ${cfg.stopLossPct}%`);
console.log(`   Trailing: ${cfg.enableTrailing ? cfg.trailingStopPct + '%' : 'OFF'}`);
console.log();

console.log('⚙️  Running backtest...');
const t0 = performance.now();
const result = runBacktest(data, cfg);
const elapsed = performance.now() - t0;

console.log(`✅ Done in ${elapsed.toFixed(1)}ms (engine reported: ${result.durationMs}ms)`);
console.log();
console.log('📈 STATS:');
const s = result.stats;
console.log(`   Net Profit:        ${s.netProfitVal >= 0 ? '+' : ''}$${s.netProfitVal} (${s.netProfitPct}%)`);
console.log(`   Total Trades:      ${s.totalTrades} (W: ${s.winTrades} / L: ${s.lossTrades})`);
console.log(`   Win Rate:          ${s.winRate}%`);
console.log(`   Profit Factor:     ${s.profitFactor}`);
console.log(`   Expectancy:        $${s.expectancy} per trade`);
console.log(`   Max Drawdown:      ${s.maxDrawdownPct}% ($${s.maxDrawdownVal})`);
console.log(`   Sharpe Ratio:      ${s.sharpeRatio}`);
console.log(`   Max Consec W/L:    ${s.maxConsecWins} / ${s.maxConsecLosses}`);
console.log(`   Avg Win/Loss:      $${s.avgWin} / $${s.avgLoss}`);
console.log(`   Long/Short:        ${s.longTrades} / ${s.shortTrades}`);
console.log(`   Total Commission:  $${s.totalCommission}`);
console.log();

console.log('📋 SAMPLE TRADES (first 5):');
for (const t of result.trades.slice(0, 5)) {
  const winLoss = t.profitVal > 0 ? '✅' : '❌';
  console.log(`   ${winLoss} #${t.id} ${t.type} @ $${t.entryPrice} → $${t.exitPrice} [${t.exitReason}] = ${t.profitVal > 0 ? '+' : ''}$${t.profitVal} (${t.profitPct}%)`);
}
console.log();

console.log('🎯 VERIFICATION:');
const issues: string[] = [];
if (s.totalTrades === 0) issues.push('⚠️  Zero trades — strategy may not trigger');
if (s.totalTrades > 0 && s.winRate === 0) issues.push('⚠️  0% win rate — possible logic bug');
if (s.totalTrades > 0 && s.winRate === 100) issues.push('⚠️  100% win rate — too good to be true?');
if (Math.abs(s.netProfitVal - (s.grossProfit - s.grossLoss)) > 1) issues.push('⚠️  Net profit ≠ Gross profit - Gross loss');
if (result.finalCapital < 10) issues.push('⚠️  Account blown up!');

if (issues.length === 0) {
  console.log('   ✅ All sanity checks passed');
} else {
  for (const i of issues) console.log(`   ${i}`);
}

// Verify indicator computation
console.log();
console.log('📡 INDICATOR SAMPLE (last candle):');
const lastIdx = data.length - 1;
console.log(`   EMA9:      ${Math.round(result.indicators.ema9[lastIdx])}`);
console.log(`   EMA21:     ${Math.round(result.indicators.ema21[lastIdx])}`);
console.log(`   RSI:       ${result.indicators.rsi[lastIdx].toFixed(1)}`);
console.log(`   MACD Hist: ${result.indicators.histogram[lastIdx].toFixed(2)}`);
console.log(`   BB Upper:  ${Math.round(result.indicators.bbUpper[lastIdx])}`);
console.log(`   BB Lower:  ${Math.round(result.indicators.bbLower[lastIdx])}`);
