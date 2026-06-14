/**
 * Supertrend M5 v2 research sweep (round 2) — REAL SUI/USDT data Jan–May 2026.
 * Tests the classic EA flip entry (supertrend_flip) alongside the legacy
 * wick-catch entry, with EA-style exit variants:
 *   pure flip-to-flip (no TP/SL) · trailing-only · TP/SL grids · breakeven.
 * Same unified engine (runBacktest) the live bot runs.
 *
 * Run: npx tsx server/sweep_supertrend_v2.ts
 */
import fs from 'fs';
import path from 'path';
import { runBacktest, type BacktestConfig, type Candle, type IndicatorType } from '../src/agent/backtestEngine.js';

const DATA = path.join(process.cwd(), 'server', 'data', 'sui_m5_2026_jan_may.json');
const data: Candle[] = JSON.parse(fs.readFileSync(DATA, 'utf8'));
console.log(`Candles: ${data.length}  ${data[0].date} → ${data[data.length - 1].date}`);

const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];

function monthlyPnl(trades: { entryDate: string; profitVal: number }[]) {
  const m: Record<string, number> = {};
  for (const k of MONTHS) m[k] = 0;
  for (const t of trades) {
    const k = t.entryDate.slice(0, 7);
    if (k in m) m[k] += t.profitVal;
  }
  return m;
}

interface Row {
  cfg: BacktestConfig;
  netPct: number; maxDD: number; pf: number; wr: number; trades: number;
  monthsPos: number; monthly: Record<string, number>; sharpe: number;
}

const base: BacktestConfig = {
  initialCapital: 10_000,
  leverage: 5, orderPct: 50,
  commission: 0.05,           // realistic taker side
  slippagePct: 0.05,          // adverse fill on entries + stops (EA realism)
  takeProfitPct: 4, stopLossPct: 1.5, trailingStopPct: 0,
  enableTrailing: false, enableDefense: true,
  indicator: 'supertrend_flip', direction: 'both',
};

// Exit-style variants (classic EA shapes)
type ExitVariant = { tag: string; patch: Partial<BacktestConfig> };
const EXITS: ExitVariant[] = [
  // pure flip-to-flip: no TP/SL, exit only on opposite signal
  { tag: 'flip-only', patch: { enableDefense: false, enableTrailing: false } },
  // flip + wide trailing (lock trend profits)
  ...[1, 1.5, 2.5].map(t => ({ tag: `trail${t}`, patch: { enableDefense: false, enableTrailing: true, trailingStopPct: t } })),
  // flip + TP/SL grids (+ optional BE)
  ...[
    { tp: 3, sl: 1.5 }, { tp: 5, sl: 2 }, { tp: 8, sl: 2 }, { tp: 8, sl: 3 }, { tp: 12, sl: 3 }, { tp: 15, sl: 4 },
  ].flatMap(({ tp, sl }) => [0, 1].map(be => ({
    tag: `tp${tp}sl${sl}be${be}`,
    patch: { enableDefense: true, takeProfitPct: tp, stopLossPct: sl, breakEvenTriggerPct: be || undefined } as Partial<BacktestConfig>,
  }))),
];

const SESSIONS: Array<{ tag: string; s?: number; e?: number }> = [
  { tag: '24/7' },
  { tag: '08-16', s: 8, e: 16 }, { tag: '16-24', s: 16, e: 0 },
];

const grid = {
  indicator: ['supertrend_flip'] as IndicatorType[],
  stPeriod:  [10, 14, 20, 30, 50],
  stMult:    [2, 3, 4, 5],
  direction: ['both', 'long_only', 'short_only'] as const,
  cooldown:  [0, 6],
  lev:       [3, 5],
};

const rows: Row[] = [];
let n = 0;
const t0 = Date.now();
for (const indicator of grid.indicator)
for (const stPeriod of grid.stPeriod)
for (const stMult of grid.stMult)
for (const exit of EXITS)
for (const ses of SESSIONS)
for (const direction of grid.direction)
for (const cooldown of grid.cooldown)
for (const lev of grid.lev) {
  const cfg: BacktestConfig = {
    ...base, ...exit.patch, indicator, direction, leverage: lev,
    supertrendPeriod: stPeriod, supertrendMult: stMult,
    cooldownBars: cooldown || undefined,
    sessionStartHour: ses.s, sessionEndHour: ses.e === 0 ? 0 : ses.e,
  };
  const r = runBacktest(data, cfg);
  n++;
  if (n % 500 === 0) console.log(`  ${n} combos, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const s = r.stats;
  if (s.totalTrades < 25) continue;
  const monthly = monthlyPnl(r.trades);
  const monthsPos = MONTHS.filter(k => monthly[k] > 0).length;
  rows.push({
    cfg, netPct: s.netProfitPct, maxDD: s.maxDrawdownPct, pf: s.profitFactor,
    wr: s.winRate, trades: s.totalTrades, monthsPos, monthly, sharpe: s.sharpeRatio,
  });
}
console.log(`Swept ${n} combos in ${((Date.now() - t0) / 1000).toFixed(0)}s, ${rows.length} with ≥30 trades`);

const good = rows
  .filter(r => r.netPct > 0 && r.maxDD < 30)
  .sort((a, b) => (b.monthsPos - a.monthsPos) || (b.netPct / Math.max(b.maxDD, 1) - a.netPct / Math.max(a.maxDD, 1)));

console.log(`\nProfitable (net>0, DD<30%): ${good.length}`);
console.log(`All-5-months-positive: ${good.filter(r => r.monthsPos === 5).length}`);
console.log(`4+/5 months positive: ${good.filter(r => r.monthsPos >= 4).length}`);

function fmt(r: Row) {
  const c = r.cfg;
  const exit = !c.enableDefense
    ? (c.enableTrailing ? `trail${c.trailingStopPct}` : 'flip-only')
    : `tp${c.takeProfitPct}/sl${c.stopLossPct}${c.breakEvenTriggerPct ? `/be${c.breakEvenTriggerPct}` : ''}`;
  const ses = c.sessionStartHour !== undefined ? `${c.sessionStartHour}-${c.sessionEndHour}h` : '24/7';
  return `ST(${c.supertrendPeriod ?? 10},${c.supertrendMult ?? 3}) ${c.direction} ${exit} ses=${ses} cd=${c.cooldownBars ?? 0} lev=${c.leverage}` +
    ` | net=${r.netPct.toFixed(1)}% dd=${r.maxDD.toFixed(1)}% pf=${r.pf.toFixed(2)} wr=${r.wr.toFixed(1)}% n=${r.trades} m+=${r.monthsPos}` +
    ` | ${MONTHS.map(k => r.monthly[k].toFixed(0)).join('/')}`;
}

console.log('\nTOP 20 PROFITABLE:');
for (const r of good.slice(0, 20)) console.log('  ' + fmt(r));

// Even if nothing is profitable, show the least-bad to direct the next iteration
const all = rows.sort((a, b) => b.netPct - a.netPct);
console.log('\nTOP 10 BY RAW NET (any sign):');
for (const r of all.slice(0, 10)) console.log('  ' + fmt(r));

fs.writeFileSync(path.join(process.cwd(), 'server', 'data', 'sweep_supertrend_v2_results.json'),
  JSON.stringify(good.slice(0, 50), null, 1));
console.log('\nTop-50 saved to server/data/sweep_supertrend_v2_results.json');
