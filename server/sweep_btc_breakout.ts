/**
 * BTC Range-Breakout EA sweep — REAL Binance BTCUSDT M15, FULL YEAR 2025.
 * Blueprint from "Phát triển EA Giao dịch Bitcoin Từ Vàng":
 *   range-breakout entry · risk-% sizing (≤2%) · time-stop (anti-fakeout)
 *   session liquidity filter · trailing/BE defenses · NO martingale
 *   honest costs: 0.05% fee + 0.05% adverse slippage per side.
 * Same unified engine the live bot runs.
 * Run: npx tsx server/sweep_btc_breakout.ts
 */
import fs from 'fs';
import path from 'path';
import { runBacktest, type BacktestConfig, type Candle } from '../src/agent/backtestEngine.js';

const data: Candle[] = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), 'server', 'data', 'btc_full_2025_M15.json'), 'utf8'));
console.log(`Candles: ${data.length}  ${data[0].date} -> ${data[data.length - 1].date}`);

const MONTHS = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`);

function monthly(trades: { entryDate: string; profitVal: number }[]) {
  const m: Record<string, number> = {};
  for (const k of MONTHS) m[k] = 0;
  for (const t of trades) { const k = t.entryDate.slice(0, 7); if (k in m) m[k] += t.profitVal; }
  return m;
}

interface Row { cfg: BacktestConfig; netPct: number; maxDD: number; pf: number; wr: number; trades: number; monthsPos: number; m: Record<string, number>; }

const base: BacktestConfig = {
  initialCapital: 10_000, leverage: 3, orderPct: 50,
  commission: 0.05, slippagePct: 0.05,
  sizingMode: 'risk_pct', riskPct: 2,        // PDF: ≤2% risk per trade
  takeProfitPct: 4, stopLossPct: 1.5, trailingStopPct: 0,
  enableTrailing: false, enableDefense: true,
  indicator: 'range_breakout', direction: 'both',
};

type Patch = { tag: string; p: Partial<BacktestConfig> };
const EXITS: Patch[] = [
  // TP/SL grids (BTC trends: generous TP, BTC chops: tight SL)
  ...[
    { tp: 2, sl: 1 }, { tp: 3, sl: 1 }, { tp: 4, sl: 1.5 }, { tp: 6, sl: 2 }, { tp: 8, sl: 2 }, { tp: 10, sl: 3 },
  ].flatMap(({ tp, sl }) => [0, 0.8].map(be => ({
    tag: `tp${tp}sl${sl}be${be}`,
    p: { takeProfitPct: tp, stopLossPct: sl, breakEvenTriggerPct: be || undefined } as Partial<BacktestConfig>,
  }))),
  // SL + trailing runner (no TP cap — let breakouts run, per PDF profit-scaling idea)
  ...[0.8, 1.5].flatMap(tr => [1, 2].map(sl => ({
    tag: `run-sl${sl}-tr${tr}`,
    p: { takeProfitPct: 999, stopLossPct: sl, enableTrailing: true, trailingStopPct: tr } as Partial<BacktestConfig>,
  }))),
];

const SESSIONS = [
  { tag: '24/7', s: undefined as number | undefined, e: undefined as number | undefined },
  { tag: 'LDN+NY 07-21', s: 7, e: 21 },
  { tag: 'NY 13-21', s: 13, e: 21 },
  { tag: 'Asia 00-08', s: 0, e: 8 },
];

const grid = {
  period:   [24, 48, 96, 192],          // M15 bars: 6h / 12h / 24h / 48h range
  dir:      ['both', 'long_only', 'short_only'] as const,
  timeStop: [0, 48, 96],                // bars (12h / 24h)
  cooldown: [0, 8],
  lev:      [2, 3, 5],
};

const rows: Row[] = [];
let n = 0; const t0 = Date.now();
for (const period of grid.period)
for (const exit of EXITS)
for (const ses of SESSIONS)
for (const dir of grid.dir)
for (const ts of grid.timeStop)
for (const cd of grid.cooldown)
for (const lev of grid.lev) {
  const cfg: BacktestConfig = {
    ...base, ...exit.p, breakoutPeriod: period, direction: dir, leverage: lev,
    maxBarsInTrade: ts || undefined, cooldownBars: cd || undefined,
    sessionStartHour: ses.s, sessionEndHour: ses.e,
  };
  const r = runBacktest(data, cfg);
  n++;
  if (n % 1000 === 0) console.log(`  ${n} combos, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  const s = r.stats;
  if (s.totalTrades < 30) continue;
  const m = monthly(r.trades);
  rows.push({ cfg, netPct: s.netProfitPct, maxDD: s.maxDrawdownPct, pf: s.profitFactor, wr: s.winRate, trades: s.totalTrades, monthsPos: MONTHS.filter(k => m[k] > 0).length, m });
}
console.log(`Swept ${n} combos in ${((Date.now() - t0) / 1000).toFixed(0)}s, ${rows.length} kept`);

const good = rows.filter(r => r.netPct > 0 && r.maxDD < 25)
  .sort((a, b) => (b.monthsPos - a.monthsPos) || (b.netPct / Math.max(b.maxDD, 1) - a.netPct / Math.max(a.maxDD, 1)));

console.log(`\nProfitable (net>0, DD<25%): ${good.length}`);
for (const k of [12, 11, 10, 9, 8]) console.log(`  ${k}/12 months positive: ${good.filter(r => r.monthsPos >= k).length}`);

function fmt(r: Row) {
  const c = r.cfg;
  const exit = c.enableTrailing ? `run-sl${c.stopLossPct}-tr${c.trailingStopPct}` :
    `tp${c.takeProfitPct}/sl${c.stopLossPct}${c.breakEvenTriggerPct ? `/be${c.breakEvenTriggerPct}` : ''}`;
  const ses = c.sessionStartHour !== undefined ? `${c.sessionStartHour}-${c.sessionEndHour}h` : '24/7';
  return `BO(${c.breakoutPeriod}) ${c.direction} ${exit} ses=${ses} ts=${c.maxBarsInTrade ?? 0} cd=${c.cooldownBars ?? 0} lev=${c.leverage}` +
    ` | net=${r.netPct.toFixed(1)}% dd=${r.maxDD.toFixed(1)}% pf=${r.pf.toFixed(2)} wr=${r.wr.toFixed(1)}% n=${r.trades} m+=${r.monthsPos}/12`;
}

console.log('\nTOP 20 PROFITABLE:');
for (const r of good.slice(0, 20)) console.log('  ' + fmt(r));
const all = rows.sort((a, b) => b.netPct - a.netPct);
console.log('\nTOP 8 RAW NET:');
for (const r of all.slice(0, 8)) console.log('  ' + fmt(r));

fs.writeFileSync(path.join(process.cwd(), 'server', 'data', 'sweep_btc_breakout_results.json'),
  JSON.stringify(good.slice(0, 50), null, 1));
console.log('\nsaved server/data/sweep_btc_breakout_results.json');
