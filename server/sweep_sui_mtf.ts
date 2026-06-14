/**
 * MTF Supertrend research — H4 Supertrend gates direction (green=BUY only,
 * red=SELL only), M5 Supertrend fires entries. REAL SUI/USDT 2025.
 * Months tested STANDALONE (fresh capital each) over a CLI window, score =
 * mean of monthly net %. Honest costs 0.05% fee + 0.05% slippage per side.
 * Run: npx tsx server/sweep_sui_mtf.ts [startMonth] [endMonth]   (default 3 9)
 */
import fs from 'fs';
import path from 'path';
import { runBacktest, type BacktestConfig, type Candle } from '../src/agent/backtestEngine.js';

const MSTART = parseInt(process.argv[2] || '3');
const MEND   = parseInt(process.argv[3] || '9');
const data: Candle[] = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), 'server', 'data', 'sui_full_2025_M5.json'), 'utf8'));
const MONTHS = Array.from({ length: MEND - MSTART + 1 }, (_, i) => `2025-${String(MSTART + i).padStart(2, '0')}`);
console.log(`M5 candles: ${data.length} · months ${MONTHS[0]}..${MONTHS[MONTHS.length - 1]} standalone`);

const byMonth: Record<string, Candle[]> = {};
for (const k of MONTHS) byMonth[k] = [];
for (const c of data) { const k = c.date.slice(0, 7); if (k in byMonth) byMonth[k].push(c); }

interface Row {
  cfg: BacktestConfig; meanPct: number; monthsPos: number;
  monthlyPct: number[]; monthlyN: number[]; worstDD: number; totN: number;
}

const base: BacktestConfig = {
  initialCapital: 10_000, leverage: 3, orderPct: 50,
  commission: 0.05, slippagePct: 0.05,
  takeProfitPct: 2, stopLossPct: 1, trailingStopPct: 0,
  enableTrailing: false, enableDefense: true,
  indicator: 'supertrend', direction: 'both',   // both — the H4 filter decides
  htfMinutes: 240,                              // H4 trend gate (user spec)
};

const ENTRIES: Array<Partial<BacktestConfig>> = [
  // Ultra-slow M5 supertrends — single-digit trades/month territory
  { indicator: 'supertrend_flip', supertrendPeriod: 50, supertrendMult: 5 },
  { indicator: 'supertrend_flip', supertrendPeriod: 100, supertrendMult: 5 },
  { indicator: 'supertrend_flip', supertrendPeriod: 100, supertrendMult: 6 },
  { indicator: 'supertrend_flip', supertrendPeriod: 200, supertrendMult: 6 },
];

const HTF: Array<Partial<BacktestConfig>> = [
  { htfSupertrendPeriod: 10, htfSupertrendMult: 3 },   // classic ST(10,3) on H4
  { htfSupertrendPeriod: 10, htfSupertrendMult: 2 },
  { htfSupertrendPeriod: 14, htfSupertrendMult: 3 },
];

const EXITS: Array<Partial<BacktestConfig>> = [
  { takeProfitPct: 3,   stopLossPct: 1 },
  { takeProfitPct: 4,   stopLossPct: 1.5 },
  { takeProfitPct: 6,   stopLossPct: 2 },
  { takeProfitPct: 4,   stopLossPct: 1.5, breakEvenTriggerPct: 1 },
  { takeProfitPct: 999, stopLossPct: 1.5, enableTrailing: true, trailingStopPct: 1.5 },
  { takeProfitPct: 999, stopLossPct: 2, enableTrailing: true, trailingStopPct: 2.5 },
];

const grid = { lev: [2, 3], cooldown: [48, 96, 192] };

const rows: Row[] = [];
let n = 0; const t0 = Date.now();
for (const entry of ENTRIES)
for (const htf of HTF)
for (const exit of EXITS)
for (const lev of grid.lev)
for (const cd of grid.cooldown) {
  const cfg: BacktestConfig = { ...base, ...entry, ...htf, ...exit, leverage: lev, cooldownBars: cd || undefined };
  const pct: number[] = [], cnt: number[] = [];
  let monthsPos = 0, worstDD = 0, totN = 0, ok = true;
  for (const k of MONTHS) {
    const r = runBacktest(byMonth[k], cfg);
    const s = r.stats;
    if (s.totalTrades < 3) { ok = false; break; }   // statistical floor per month
    pct.push(s.netProfitPct); cnt.push(s.totalTrades);
    if (s.netProfitPct > 0) monthsPos++;
    worstDD = Math.max(worstDD, s.maxDrawdownPct);
    totN += s.totalTrades;
  }
  n++;
  if (n % 150 === 0) console.log(`  ${n} combos, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (!ok) continue;
  rows.push({ cfg, meanPct: pct.reduce((a, b) => a + b, 0) / MONTHS.length, monthsPos, monthlyPct: pct, monthlyN: cnt, worstDD, totN });
}
console.log(`Swept ${n} combos in ${((Date.now() - t0) / 1000).toFixed(0)}s; ${rows.length} with ≥8 trades/month`);

const ranked = rows.sort((a, b) => b.meanPct - a.meanPct);
console.log(`Positive mean: ${ranked.filter(r => r.meanPct > 0).length}`);
console.log(`All months positive: ${ranked.filter(r => r.monthsPos === MONTHS.length).length}`);

function fmt(r: Row) {
  const c = r.cfg;
  const exit = c.enableTrailing ? `run-sl${c.stopLossPct}-tr${c.trailingStopPct}`
    : `tp${c.takeProfitPct}/sl${c.stopLossPct}${c.breakEvenTriggerPct ? `/be${c.breakEvenTriggerPct}` : ''}`;
  return `${c.indicator}(${c.supertrendPeriod},${c.supertrendMult}) H4ST(${c.htfSupertrendPeriod},${c.htfSupertrendMult}) ${exit} cd=${c.cooldownBars ?? 0} lev=${c.leverage}` +
    ` | meanMo=${r.meanPct.toFixed(2)}% m+=${r.monthsPos}/${MONTHS.length} totN=${r.totN} worstDD=${r.worstDD.toFixed(1)}%` +
    `\n      pnl%: ${r.monthlyPct.map(p => p.toFixed(1)).join(' / ')}   n: ${r.monthlyN.join('/')}`;
}

console.log('\nTOP 12 BY MEAN MONTHLY PNL:');
for (const r of ranked.slice(0, 12)) console.log('  ' + fmt(r));

fs.writeFileSync(path.join(process.cwd(), 'server', 'data', 'sweep_sui_mtf_results.json'),
  JSON.stringify(ranked.slice(0, 30), null, 1));
console.log('\nsaved server/data/sweep_sui_mtf_results.json');
