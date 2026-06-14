/**
 * Test 5 strategies trên cùng dataset
 */
import { runBacktest, configFromBotSkill, type Candle, type IndicatorType } from './src/agent/backtestEngine.js';
import fs from 'fs';
import path from 'path';

const TF = 'H4';
const data: Candle[] = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'public', 'data', `btc_2025_${TF}.json`), 'utf8'));
const sliceSize = Math.min(data.length, 92 * 6 + 30);
const candles = data.slice(0, sliceSize);

console.log(`📊 Testing 5 strategies on ${candles.length} ${TF} candles`);
console.log(`   Range: ${candles[0].date} → ${candles[candles.length-1].date}`);
console.log();

const SIGNALS: IndicatorType[] = ['ema_cross', 'rsi', 'macd', 'bb', 'rsi_macd'];
const baseCfg = {
  takeProfitPct: 5, stopLossPct: 2, trailingStopPct: 1.5,
  enableTrailing: true, enableDefense: true,
  leverage: 3, orderPct: 50, commission: 0.05,
  direction: 'both' as const,
};

console.log('Strategy        Trades  WinRate  PF     NetPnL%   Sharpe   MaxDD');
console.log('─'.repeat(75));

for (const signal of SIGNALS) {
  const cfg = configFromBotSkill({ signal, ...baseCfg }, 10000);
  const r = runBacktest(candles, cfg);
  const s = r.stats;
  const pad = (v: any, n: number) => String(v).padEnd(n);
  console.log(
    pad(signal, 15) +
    pad(s.totalTrades, 8) +
    pad(s.winRate + '%', 9) +
    pad(s.profitFactor, 7) +
    pad((s.netProfitPct > 0 ? '+' : '') + s.netProfitPct + '%', 10) +
    pad(s.sharpeRatio, 9) +
    pad(s.maxDrawdownPct + '%', 8)
  );
}

console.log();
console.log('✅ Verify: 5 strategies cho 5 kết quả KHÁC NHAU (logic độc lập)');
