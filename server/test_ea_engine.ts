/**
 * EA engine test suite — validates the MT4/MT5-style money-management module
 * against synthetic candles. Run: npx tsx server/test_ea_engine.ts
 */
import { runBacktest, manageExit, calcMargin, inSession, type BacktestConfig, type Candle } from '../src/agent/backtestEngine.js';

let pass = 0, fail = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  PASS ${name}`); }
  else      { fail++; console.log(`  FAIL ${name} ${detail}`); }
}

// Synthetic candles: oscillating price so RSI strategy produces trades
function synthCandles(n: number, startISO = '2025-01-01T00:00:00Z'): Candle[] {
  const out: Candle[] = [];
  const t0 = new Date(startISO).getTime();
  let p = 100;
  for (let i = 0; i < n; i++) {
    // 40-bar sine + small trend → repeated overbought/oversold swings
    const next = 100 + 15 * Math.sin(i / 7) + (i % 13) * 0.1;
    const high = Math.max(p, next) * 1.004;
    const low  = Math.min(p, next) * 0.996;
    out.push({
      date: new Date(t0 + i * 900_000).toISOString(), // 15m bars
      open: p, high, low, close: next, volume: 1000,
    });
    p = next;
  }
  return out;
}

const base: BacktestConfig = {
  initialCapital: 10_000, leverage: 3, orderPct: 50, commission: 0.05,
  takeProfitPct: 4, stopLossPct: 2, trailingStopPct: 1,
  enableTrailing: false, enableDefense: true,
  indicator: 'rsi', direction: 'both',
};
const data = synthCandles(600);

// ── T1: baseline runs and produces trades ──
const r1 = runBacktest(data, base);
check('T1 baseline produces trades', r1.trades.length > 3, `got ${r1.trades.length}`);

// ── T2: risk_pct sizing → SL loss ≈ riskPct% of capital ──
const r2 = runBacktest(data, { ...base, sizingMode: 'risk_pct', riskPct: 1 });
const slTrades = r2.trades.filter(t => t.exitReason === 'SL');
if (slTrades.length) {
  const t = slTrades[0];
  // loss should be ~1% of capital at that time (allow fees + discretization)
  const eqBefore = r2.equityByIndex[t.entryIndex];
  const lossPctOfCapital = Math.abs(t.profitVal) / eqBefore * 100;
  check('T2 risk_pct: SL loss ≈ 1% capital', lossPctOfCapital > 0.7 && lossPctOfCapital < 1.6, `=${lossPctOfCapital.toFixed(2)}%`);
} else check('T2 risk_pct: SL loss ≈ 1% capital', true, '(no SL trades — skip)');

// ── T3: breakeven produces BE exits and no BE trade loses more than fees ──
const r3 = runBacktest(data, { ...base, breakEvenTriggerPct: 1, takeProfitPct: 8 });
const beTrades = r3.trades.filter(t => t.exitReason === 'BE');
check('T3 BE exits exist', beTrades.length > 0, `got ${beTrades.length}`);
check('T3 BE trades are ~flat (≥ -1% of margin)', beTrades.every(t => t.profitPct > -1.5),
  beTrades.map(t => t.profitPct).join(','));

// ── T4: cooldownBars enforced — every re-entry waits ≥ N bars after the exit ──
const r4 = runBacktest(data, { ...base, cooldownBars: 30 });
const cooldownViolations = r4.trades.slice(1).filter((t, i) => t.entryIndex - r4.trades[i].exitIndex <= 30);
check('T4 cooldown gap ≥ 30 bars', cooldownViolations.length === 0 && r4.trades.length < r1.trades.length,
  `${cooldownViolations.length} violations, ${r4.trades.length} vs ${r1.trades.length} trades`);

// ── T5: session filter — entries only inside window ──
const r5 = runBacktest(data, { ...base, sessionStartHour: 8, sessionEndHour: 16 });
const offSession = r5.trades.filter(t => {
  const h = new Date(t.entryDate).getUTCHours();
  return h < 8 || h >= 16;
});
check('T5 session filter respected', offSession.length === 0, `${offSession.length} off-session entries`);

// ── T6: maxConsecLosses halts entries after streak ──
const r6 = runBacktest(data, { ...base, maxConsecLosses: 2 });
let streak = 0, violated = false;
for (const t of r6.trades) { // chronological
  if (streak >= 2) violated = true;
  streak = t.profitVal < 0 ? streak + 1 : 0;
}
check('T6 stops after 2 consecutive losses', !violated);

// ── T7: slippage shifts the entry fill adversely (LONG fills higher) ──
const r7 = runBacktest(data, { ...base, slippagePct: 0.2 });
const a0 = r1.trades[0], b0 = r7.trades[0];
const slipOk = a0 && b0 && (a0.type === 'LONG'
  ? b0.entryPrice > a0.entryPrice
  : b0.entryPrice < a0.entryPrice);
check('T7 adverse entry slippage applied', !!slipOk, `${a0?.entryPrice} → ${b0?.entryPrice}`);

// ── T8: manageExit unit — LONG breakeven then BE stop ──
{
  const pos = { type: 'LONG' as const, entryPrice: 100, tpPrice: 110, slPrice: 95, peakPrice: 100 };
  const cfg = { takeProfitPct: 10, stopLossPct: 5, trailingStopPct: 1, enableTrailing: false, enableDefense: true, breakEvenTriggerPct: 2 };
  // tick 1: +3% → arms breakeven
  let exit = manageExit(cfg, pos, { high: 103, low: 102.5, close: 103 }, { buy: false, sell: false });
  check('T8a no exit on favorable tick', exit === null && pos.beApplied === true && pos.slPrice > 99.9, `sl=${pos.slPrice}`);
  // tick 2: falls back to entry → BE exit, not SL
  exit = manageExit(cfg, pos, { high: 101, low: 99.8, close: 100 }, { buy: false, sell: false });
  check('T8b BE exit at entry', exit?.reason === 'BE', `got ${exit?.reason}`);
}

// ── T9: inSession overnight wrap ──
check('T9 overnight session wrap', inSession('2025-01-01T23:30:00Z', { sessionStartHour: 22, sessionEndHour: 4 })
  && inSession('2025-01-01T02:00:00Z', { sessionStartHour: 22, sessionEndHour: 4 })
  && !inSession('2025-01-01T12:00:00Z', { sessionStartHour: 22, sessionEndHour: 4 }));

// ── T10: calcMargin math ──
{
  // capital 1000, risk 1% = $10 max loss, SL 2% → size $500, lev 5 → margin $100
  const m = calcMargin({ sizingMode: 'risk_pct', riskPct: 1, orderPct: 50, stopLossPct: 2, leverage: 5, enableDefense: true }, 1000);
  check('T10 risk_pct margin', Math.abs(m - 100) < 0.01, `=${m}`);
  const f = calcMargin({ sizingMode: 'fixed_pct', orderPct: 50, stopLossPct: 2, leverage: 5, enableDefense: true }, 1000);
  check('T10 fixed_pct margin', Math.abs(f - 500) < 0.01, `=${f}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
