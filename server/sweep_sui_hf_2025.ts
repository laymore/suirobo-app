/**
 * High-frequency SUI bot research — REAL Binance SUIUSDT, FULL YEAR 2025.
 * HARD CONSTRAINT: ≥ 50 trades in EVERY month (user requirement).
 * SCORE: arithmetic mean of the 12 standalone monthly PnLs (each month is
 * backtested in isolation with fresh capital, exactly like the UI month picker
 * will run it) — positive mean = win.
 * Honest costs: 0.05% fee + 0.05% adverse slippage per side.
 * Run: npx tsx server/sweep_sui_hf_2025.ts <M5|M15>
 */
import fs from 'fs';
import path from 'path';
import { runBacktest, type BacktestConfig, type Candle, type IndicatorType } from '../src/agent/backtestEngine.js';

const TF = (process.argv[2] || 'M5') as 'M5' | 'M15';
const data: Candle[] = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), 'server', 'data', `sui_full_2025_${TF}.json`), 'utf8'));
console.log(`TF=${TF}  Candles: ${data.length}  ${data[0].date} -> ${data[data.length - 1].date}`);

// Pre-split candles per month (standalone month tests, like the UI will do)
// Month window via CLI: <TF> [startMonth] [endMonth] (defaults 1..12)
const MSTART = parseInt(process.argv[3] || '1');
const MEND   = parseInt(process.argv[4] || '12');
const MONTHS = Array.from({ length: MEND - MSTART + 1 }, (_, i) => `2025-${String(MSTART + i).padStart(2, '0')}`);
console.log(`Months tested standalone: ${MONTHS[0]} .. ${MONTHS[MONTHS.length - 1]} (${MONTHS.length} months)`);
const byMonth: Record<string, Candle[]> = {};
for (const k of MONTHS) byMonth[k] = [];
for (const c of data) { const k = c.date.slice(0, 7); if (k in byMonth) byMonth[k].push(c); }

interface Row {
  cfg: BacktestConfig;
  meanPct: number;          // mean of 12 standalone monthly net %
  monthsPos: number;
  minTrades: number;        // worst month's trade count
  monthlyPct: number[];
  worstDD: number;          // worst single-month maxDD
  totTrades: number;
}

const base: BacktestConfig = {
  initialCapital: 10_000, leverage: 3, orderPct: 50,
  commission: 0.05, slippagePct: 0.05,
  takeProfitPct: 2, stopLossPct: 1, trailingStopPct: 0,
  enableTrailing: false, enableDefense: true,
  indicator: 'bb', direction: 'both',
};

// High-frequency signal pool (must produce ≥50 entries/month)
const SIGNALS: Array<{ ind: IndicatorType; extra?: Partial<BacktestConfig> }> = [
  { ind: 'bb' },
  { ind: 'rsi' },
  { ind: 'macd' },
  { ind: 'supertrend', extra: { supertrendPeriod: 10, supertrendMult: 2 } },   // wick-catch = high freq
  { ind: 'supertrend', extra: { supertrendPeriod: 14, supertrendMult: 3 } },
  { ind: 'range_breakout', extra: { breakoutPeriod: 12 } },                    // short lookback = frequent
  { ind: 'range_breakout', extra: { breakoutPeriod: 24 } },
];

const EXITS: Array<Partial<BacktestConfig>> = [
  { takeProfitPct: 0.8, stopLossPct: 0.5 },
  { takeProfitPct: 1.2, stopLossPct: 0.6 },
  { takeProfitPct: 1.5, stopLossPct: 0.8 },
  { takeProfitPct: 2,   stopLossPct: 1 },
  { takeProfitPct: 3,   stopLossPct: 1 },
  { takeProfitPct: 1.5, stopLossPct: 0.8, breakEvenTriggerPct: 0.6 },
  { takeProfitPct: 2,   stopLossPct: 1,   breakEvenTriggerPct: 0.8 },
];

const grid = {
  dir: ['both', 'long_only', 'short_only'] as const,
  lev: [2, 3, 5],
  cooldown: [0, 3],
};

const rows: Row[] = [];
let n = 0; const t0 = Date.now();
for (const sig of SIGNALS)
for (const exit of EXITS)
for (const dir of grid.dir)
for (const lev of grid.lev)
for (const cd of grid.cooldown) {
  const cfg: BacktestConfig = { ...base, ...sig.extra, ...exit, indicator: sig.ind, direction: dir, leverage: lev, cooldownBars: cd || undefined };
  // Standalone month-by-month runs (fresh 10k each month)
  const pct: number[] = []; let minTrades = Infinity, monthsPos = 0, worstDD = 0, tot = 0;
  let ok = true;
  for (const k of MONTHS) {
    const r = runBacktest(byMonth[k], cfg);
    const s = r.stats;
    if (s.totalTrades < 50) { ok = false; break; }   // HARD: ≥50 trades this month
    pct.push(s.netProfitPct);
    if (s.netProfitPct > 0) monthsPos++;
    minTrades = Math.min(minTrades, s.totalTrades);
    worstDD = Math.max(worstDD, s.maxDrawdownPct);
    tot += s.totalTrades;
  }
  n++;
  if (n % 200 === 0) console.log(`  ${n} combos, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (!ok) continue;
  const meanPct = pct.reduce((a, b) => a + b, 0) / MONTHS.length;
  rows.push({ cfg, meanPct, monthsPos, minTrades, monthlyPct: pct, worstDD, totTrades: tot });
}
console.log(`Swept ${n} combos in ${((Date.now() - t0) / 1000).toFixed(0)}s; ${rows.length} satisfy ≥50 trades/month`);

const ranked = rows.sort((a, b) => b.meanPct - a.meanPct);
const winners = ranked.filter(r => r.meanPct > 0);
console.log(`Positive 12-month average: ${winners.length}`);

function fmt(r: Row) {
  const c = r.cfg;
  const sig = c.indicator === 'supertrend' ? `ST(${c.supertrendPeriod},${c.supertrendMult})`
    : c.indicator === 'range_breakout' ? `BO(${c.breakoutPeriod})` : c.indicator;
  return `${sig} ${c.direction} tp${c.takeProfitPct}/sl${c.stopLossPct}${c.breakEvenTriggerPct ? `/be${c.breakEvenTriggerPct}` : ''} cd=${c.cooldownBars ?? 0} lev=${c.leverage}` +
    ` | meanMo=${r.meanPct.toFixed(2)}% m+=${r.monthsPos}/${MONTHS.length} minN=${r.minTrades} totN=${r.totTrades} worstDD=${r.worstDD.toFixed(1)}%` +
    `\n      months%: ${r.monthlyPct.map(p => p.toFixed(1)).join(' / ')}`;
}

console.log('\nTOP 12 BY MEAN MONTHLY PNL:');
for (const r of ranked.slice(0, 12)) console.log('  ' + fmt(r));

fs.writeFileSync(path.join(process.cwd(), 'server', 'data', `sweep_sui_hf_${TF}_results.json`),
  JSON.stringify(ranked.slice(0, 30), null, 1));
console.log(`\nsaved server/data/sweep_sui_hf_${TF}_results.json`);
