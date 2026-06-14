import { runBacktest, configFromBotSkill, type Candle } from './src/agent/backtestEngine.js';
import fs from 'fs';
import path from 'path';

const TF = 'M5';
const DURATION_DAYS = 90; // Jan to March is approx 90 days

const dataFile = path.join(process.cwd(), 'public', 'data', `btc_2025_${TF}.json`);
console.log(`📂 Loading ${dataFile}`);
const allData: Candle[] = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

const cpd = 288; // M5 = 288 candles/day
const sliceSize = Math.min(allData.length, DURATION_DAYS * cpd);
const data = allData.slice(0, sliceSize);

console.log(`📊 Test data: ${data.length} candles (${TF}, ${DURATION_DAYS} days)`);
console.log(`   First: ${data[0].date} @ $${data[0].close}`);
console.log(`   Last:  ${data[data.length - 1].date} @ $${data[data.length - 1].close}`);
console.log();

const botSkill = {
  signal: 'supertrend' as const,
  takeProfitPct: 5,
  stopLossPct: 2,
  trailingStopPct: 1.5,
  enableTrailing: false, // Turn off trailing for pure comparison
  enableDefense: true,
  leverage: 3,
  orderPct: 50,
  commission: 0.05,
  direction: 'both' as const,
};

const cfg = configFromBotSkill(botSkill, 10000);

console.log('🤖 Bot Config (SUPERTREND):');
console.log(`   Signal: ${cfg.indicator}`);
console.log(`   Leverage: ${cfg.leverage}x | Order: ${cfg.orderPct}%`);
console.log(`   TP/SL: ${cfg.takeProfitPct}% / ${cfg.stopLossPct}%`);
console.log();

console.log('⚙️  Running backtest...');
const t0 = performance.now();
const result = runBacktest(data, cfg);
const elapsed = performance.now() - t0;

console.log(`✅ Done in ${elapsed.toFixed(1)}ms`);
console.log();
console.log('📈 STATS:');
const s = result.stats;
console.log(`   Net Profit:        ${s.netProfitVal >= 0 ? '+' : ''}$${s.netProfitVal} (${s.netProfitPct}%)`);
console.log(`   Total Trades:      ${s.totalTrades} (W: ${s.winTrades} / L: ${s.lossTrades})`);
console.log(`   Win Rate:          ${s.winRate}%`);
console.log(`   Profit Factor:     ${s.profitFactor}`);
console.log(`   Expectancy:        $${s.expectancy} per trade`);
console.log(`   Max Drawdown:      ${s.maxDrawdownPct}% ($${s.maxDrawdownVal})`);
console.log(`   Max Consec W/L:    ${s.maxConsecWins} / ${s.maxConsecLosses}`);
console.log();
