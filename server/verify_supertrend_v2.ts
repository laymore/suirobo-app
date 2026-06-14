/** Final verification of the chosen sui_supertrend_m5_v2 config on REAL
 *  SUI/USDT M5 data (Jan–May 2026) + comparison vs the legacy v1 signal.
 *  Run: npx tsx server/verify_supertrend_v2.ts */
import fs from 'fs';
import path from 'path';
import { runBacktest, type BacktestConfig, type Candle } from '../src/agent/backtestEngine.js';

const data: Candle[] = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), 'server', 'data', 'sui_m5_2026_jan_may.json'), 'utf8'));

const V2: BacktestConfig = {
  initialCapital: 10_000, leverage: 3, orderPct: 50,
  commission: 0.05, slippagePct: 0.05,
  indicator: 'supertrend_flip', supertrendPeriod: 20, supertrendMult: 5,
  direction: 'short_only',
  takeProfitPct: 3, stopLossPct: 1.5, trailingStopPct: 0,
  enableTrailing: false, enableDefense: true,
  cooldownBars: 6, sessionStartHour: 16, sessionEndHour: 0,
};

const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];
function report(tag: string, cfg: BacktestConfig) {
  const r = runBacktest(data, cfg);
  const s = r.stats;
  const monthly: Record<string, number> = {};
  for (const k of MONTHS) monthly[k] = 0;
  for (const t of r.trades) { const k = t.entryDate.slice(0, 7); if (k in monthly) monthly[k] += t.profitVal; }
  console.log(`\n=== ${tag} ===`);
  console.log(`net=${s.netProfitPct}%  maxDD=${s.maxDrawdownPct}%  PF=${s.profitFactor}  WR=${s.winRate}%  sharpe=${s.sharpeRatio}`);
  console.log(`trades=${s.totalTrades} (L${s.longTrades}/S${s.shortTrades})  expectancy=$${s.expectancy}  fees=$${s.totalCommission}`);
  console.log(`monthly $: ${MONTHS.map(k => `${k.slice(5)}:${monthly[k].toFixed(0)}`).join('  ')}`);
  console.log(`exit mix: ${['TP','SL','BE','Trailing','Signal','Liquidation'].map(x => `${x}=${r.trades.filter(t => t.exitReason === x).length}`).join(' ')}`);
}

report('V2 — supertrend_flip ST(20,5) short 16-24h TP3/SL1.5 cd6 lev3', V2);
report('V1 signal, same everything (wick-catch entry)', { ...V2, indicator: 'supertrend' });
report('V1 preset as shipped (ST(10,3) both tp8/sl1.5 lev10 24/7)', {
  ...V2, indicator: 'supertrend', supertrendPeriod: 10, supertrendMult: 3,
  direction: 'both', takeProfitPct: 8, stopLossPct: 1.5, leverage: 10,
  cooldownBars: undefined, sessionStartHour: undefined, sessionEndHour: undefined,
});
