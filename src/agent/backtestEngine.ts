/**
 * Pure Backtest Engine — không React, không side effects
 * Input: candles[] + config → Output: BacktestResult
 * Toàn bộ tính toán chạy trong 1 vòng lặp đồng bộ (< 200ms cho 60k nến)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type IndicatorType = 'ema_cross' | 'rsi' | 'macd' | 'bb' | 'rsi_macd' | 'supertrend' | 'supertrend_flip' | 'range_breakout';

export interface BacktestConfig {
  initialCapital: number;
  leverage: number;
  orderPct: number;        // % vốn mỗi lệnh (25 / 50 / 100)
  commission: number;      // % phí mỗi chiều, e.g. 0.05
  takeProfitPct: number;
  stopLossPct: number;
  trailingStopPct: number;
  enableTrailing: boolean;
  enableDefense: boolean;
  indicator: IndicatorType;
  filters?: FilterBlock[];   // EA-style AND-gates on top of the entry signal
  direction?: 'both' | 'long_only' | 'short_only'; // bộ lọc hướng

  // Supertrend EA inputs (ATR period + multiplier) — the standard tunables of
  // every Supertrend EA. Apply to 'supertrend' and 'supertrend_flip' signals.
  supertrendPeriod?: number;  // default 10
  supertrendMult?: number;    // default 3

  // Range-breakout EA inputs ('range_breakout' signal): enter when the close
  // breaks the prior N-bar high (buy) / low (sell) — Donchian-style momentum.
  breakoutPeriod?: number;    // default 20 bars

  // Time-stop (EA "maxTimeInPosition"): force-close after N bars in a trade.
  // Anti-fakeout defense for breakout systems (0/undefined = off).
  maxBarsInTrade?: number;

  // ── Higher-timeframe trend filter (classic MTF EA) ────────────────────────
  // A Supertrend computed on aggregated HTF candles gates entry DIRECTION:
  // HTF green → only BUY entries allowed; HTF red → only SELL. Only CLOSED
  // HTF candles are used (no lookahead). undefined = filter off.
  htfMinutes?: number;             // HTF candle size in minutes (e.g. 240 = H4)
  htfSupertrendPeriod?: number;    // default 10
  htfSupertrendMult?: number;      // default 3

  // ── EA money-management module (MT4/MT5-style; all optional) ──────────────
  /** 'fixed_pct' (default): margin = capital × orderPct%.
   *  'risk_pct': size so a stop-loss hit loses exactly riskPct% of capital. */
  sizingMode?: 'fixed_pct' | 'risk_pct';
  riskPct?: number;              // % of capital risked per trade (risk_pct mode)
  breakEvenTriggerPct?: number;  // price moves X% in favor → SL jumps to entry (0 = off)
  cooldownBars?: number;         // bars to wait after a closed trade before re-entry
  maxConsecLosses?: number;      // stop entering after N consecutive losses (0 = off)
  maxDailyLossPct?: number;      // stop entering for the day when day PnL ≤ -X% (0 = off)
  sessionStartHour?: number;     // UTC hour (0-23) — entries allowed from this hour
  sessionEndHour?: number;       // UTC hour (0-23) — entries allowed before this hour (wrap ok)
  slippagePct?: number;          // adverse slippage applied on entry + stop/market exits
}

export interface Trade {
  id: number;
  type: 'LONG' | 'SHORT';
  entryDate: string;
  entryPrice: number;
  entryIndex: number;
  exitDate: string;
  exitPrice: number;
  exitIndex: number;
  sizeCoins: number;       // khối lượng BTC
  profitVal: number;       // lời/lỗ USD
  profitPct: number;       // % so với margin
  exitReason: 'TP' | 'SL' | 'Trailing' | 'Signal' | 'Liquidation' | 'BE' | 'Time';
  commissionPaid: number;
}

// ─── Shared trade management (used by BOTH backtest and live bot) ─────────────
// Mirrors an MT4/MT5 EA's order-management block: breakeven → TP/SL → trailing
// → opposite signal. Backtest feeds candle high/low; live feeds the tick price
// for all three so the exact same rules run in both places.

export interface ManagedPosition {
  type: 'LONG' | 'SHORT';
  entryPrice: number;
  tpPrice: number;
  slPrice: number;
  peakPrice: number;     // trailing reference (favorable extreme)
  beApplied?: boolean;   // breakeven already moved the SL to entry
}

export interface ManageCfg {
  takeProfitPct: number;
  stopLossPct: number;
  trailingStopPct: number;
  enableTrailing: boolean;
  enableDefense: boolean;
  breakEvenTriggerPct?: number;
}

export type ExitReason = 'TP' | 'SL' | 'Trailing' | 'Signal' | 'BE' | 'Time';

/** Evaluate one tick/candle against an open position. Mutates pos.peakPrice /
 *  pos.slPrice (breakeven) in place. Returns the exit, or null to keep holding. */
export function manageExit(
  cfg: ManageCfg,
  pos: ManagedPosition,
  tick: { high: number; low: number; close: number },
  opposite: { buy: boolean; sell: boolean },
): { price: number; reason: ExitReason } | null {
  const long = pos.type === 'LONG';

  // 1. Trailing reference
  if (long  && tick.high > pos.peakPrice) pos.peakPrice = tick.high;
  if (!long && tick.low  < pos.peakPrice) pos.peakPrice = tick.low;

  // 2. Breakeven: once price has moved breakEvenTriggerPct% in our favor,
  //    move the SL to entry (+ a hair in profit to cover fees). Classic EA move.
  const beTrig = cfg.breakEvenTriggerPct ?? 0;
  if (beTrig > 0 && cfg.enableDefense && !pos.beApplied) {
    const favorable = long
      ? (tick.high - pos.entryPrice) / pos.entryPrice
      : (pos.entryPrice - tick.low)  / pos.entryPrice;
    if (favorable >= beTrig / 100) {
      pos.slPrice  = long ? pos.entryPrice * 1.0005 : pos.entryPrice * 0.9995;
      pos.beApplied = true;
    }
  }

  // 3. TP / SL (SL may be the breakeven level)
  if (cfg.enableDefense) {
    if (long) {
      if (tick.high >= pos.tpPrice) return { price: pos.tpPrice, reason: 'TP' };
      if (tick.low  <= pos.slPrice) return { price: pos.slPrice, reason: pos.beApplied && pos.slPrice >= pos.entryPrice ? 'BE' : 'SL' };
    } else {
      if (tick.low  <= pos.tpPrice) return { price: pos.tpPrice, reason: 'TP' };
      if (tick.high >= pos.slPrice) return { price: pos.slPrice, reason: pos.beApplied && pos.slPrice <= pos.entryPrice ? 'BE' : 'SL' };
    }
  }

  // 4. Trailing stop (armed only after a small favorable move, as before)
  if (cfg.enableTrailing) {
    const trail = cfg.trailingStopPct / 100;
    if (long) {
      const trailPrice = pos.peakPrice * (1 - trail);
      if (pos.peakPrice > pos.entryPrice * 1.005 && tick.low <= trailPrice)
        return { price: trailPrice, reason: 'Trailing' };
    } else {
      const trailPrice = pos.peakPrice * (1 + trail);
      if (pos.peakPrice < pos.entryPrice * 0.995 && tick.high >= trailPrice)
        return { price: trailPrice, reason: 'Trailing' };
    }
  }

  // 5. Opposite signal
  if ((long && opposite.sell) || (!long && opposite.buy))
    return { price: tick.close, reason: 'Signal' };

  return null;
}

/** Higher-timeframe Supertrend direction per BASE bar (classic MTF EA filter).
 *  Aggregates base candles into htfMinutes buckets (timestamp-aligned, gap
 *  proof), runs Supertrend on them, and maps each base bar to the direction of
 *  the LAST CLOSED HTF candle — the forming bucket is never used (no
 *  lookahead). Returns +1 (green/buy-only), -1 (red/sell-only), 0 (warmup). */
export function computeHtfTrendDirs(
  data: Candle[], htfMinutes: number, period = 10, mult = 3,
): number[] {
  const bucketMs = htfMinutes * 60_000;
  const htf: Candle[] = [];
  const bucketIdxOfBase = new Array<number>(data.length);
  let curBucket = NaN;
  for (let i = 0; i < data.length; i++) {
    const b = Math.floor(Date.parse(data[i].date) / bucketMs);
    if (b !== curBucket) {
      curBucket = b;
      htf.push({ date: new Date(b * bucketMs).toISOString(), open: data[i].open, high: data[i].high, low: data[i].low, close: data[i].close, volume: data[i].volume ?? 0 });
    } else {
      const h = htf[htf.length - 1];
      if (data[i].high > h.high) h.high = data[i].high;
      if (data[i].low  < h.low)  h.low  = data[i].low;
      h.close = data[i].close;
      h.volume += data[i].volume ?? 0;
    }
    bucketIdxOfBase[i] = htf.length - 1;
  }
  const dirs = computeIndicators(htf, mult, period).superTrendDir;
  const out = new Array<number>(data.length).fill(0);
  for (let i = 0; i < data.length; i++) {
    const prev = bucketIdxOfBase[i] - 1;          // last CLOSED HTF candle
    out[i] = prev > period ? (dirs[prev] || 0) : 0; // 0 during warmup → no entries
  }
  return out;
}

/** Entry-session filter: true when the candle/tick hour (UTC) is inside the
 *  configured trading session. Supports overnight sessions (start > end). */
export function inSession(dateIso: string | number, cfg: { sessionStartHour?: number; sessionEndHour?: number }): boolean {
  const s = cfg.sessionStartHour, e = cfg.sessionEndHour;
  if (s === undefined || e === undefined || s === e) return true; // 24/7
  const h = new Date(dateIso).getUTCHours();
  return s < e ? (h >= s && h < e) : (h >= s || h < e);
}

/** EA position sizing. Returns the margin (own capital) to commit.
 *  risk_pct mode: a full SL hit costs exactly riskPct% of capital. */
export function calcMargin(
  cfg: { sizingMode?: 'fixed_pct' | 'risk_pct'; riskPct?: number; orderPct: number; stopLossPct: number; leverage: number; enableDefense: boolean },
  capital: number,
): number {
  if (cfg.sizingMode === 'risk_pct' && (cfg.riskPct ?? 0) > 0 && cfg.stopLossPct > 0 && cfg.enableDefense) {
    const sizeUSD = capital * (cfg.riskPct! / 100) / (cfg.stopLossPct / 100);
    return Math.min(sizeUSD / cfg.leverage, capital);
  }
  return capital * (cfg.orderPct / 100);
}

export interface Indicators {
  ema9: number[];
  ema21: number[];
  rsi: number[];
  macdLine: number[];
  signalLine: number[];
  histogram: number[];
  bbUpper: number[];
  bbBasis: number[];
  bbLower: number[];
  superTrend: number[];
  superTrendDir: number[]; // 1 for UP (Buy), -1 for DOWN (Sell)
  donchianHigh: number[]; // rolling N-bar high (range_breakout)
  donchianLow: number[];  // rolling N-bar low
}

export interface BacktestStats {
  netProfitVal: number;
  netProfitPct: number;
  grossProfit: number;
  grossLoss: number;
  profitFactor: number;
  winRate: number;
  totalTrades: number;
  winTrades: number;
  lossTrades: number;
  maxDrawdownPct: number;
  maxDrawdownVal: number;
  avgTradeProfit: number;
  avgWin: number;
  avgLoss: number;
  maxConsecWins: number;
  maxConsecLosses: number;
  sharpeRatio: number;
  totalCommission: number;
  longTrades: number;
  shortTrades: number;
  expectancy: number;
}

export interface BacktestResult {
  trades: Trade[];
  equityByIndex: number[];   // equity tại mỗi chỉ số nến
  finalCapital: number;
  stats: BacktestStats;
  indicators: Indicators;
  durationMs: number;        // thời gian tính toán
}

// ─── Indicator Computations ───────────────────────────────────────────────────

export function computeIndicators(data: Candle[], supertrendMult = 3, supertrendPeriod = 10, breakoutPeriod = 20): Indicators {
  const n = data.length;
  const ema9      = new Array(n).fill(0);
  const ema21     = new Array(n).fill(0);
  const rsi       = new Array(n).fill(50);
  const macdLine  = new Array(n).fill(0);
  const signalLine= new Array(n).fill(0);
  const histogram = new Array(n).fill(0);
  const bbUpper   = new Array(n).fill(0);
  const bbBasis   = new Array(n).fill(0);
  const bbLower   = new Array(n).fill(0);

  // EMA 9 & 21
  const k9 = 2 / 10, k21 = 2 / 22;
  let e9 = data[0].close, e21 = data[0].close;
  ema9[0] = e9; ema21[0] = e21;
  for (let i = 1; i < n; i++) {
    e9  = data[i].close * k9  + e9  * (1 - k9);
    e21 = data[i].close * k21 + e21 * (1 - k21);
    ema9[i] = e9;
    ema21[i] = e21;
  }

  // RSI 14
  if (n > 15) {
    let ag = 0, al = 0;
    for (let i = 1; i <= 14; i++) {
      const d = data[i].close - data[i - 1].close;
      if (d > 0) ag += d; else al -= d;
    }
    ag /= 14; al /= 14;
    rsi[14] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (let i = 15; i < n; i++) {
      const d = data[i].close - data[i - 1].close;
      ag = (ag * 13 + Math.max(d, 0)) / 14;
      al = (al * 13 + Math.max(-d, 0)) / 14;
      rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
  }

  // MACD (12, 26, 9)
  const k12 = 2 / 13, k26 = 2 / 27, ks = 2 / 10;
  let e12 = data[0].close, e26 = data[0].close, sig = 0;
  for (let i = 1; i < n; i++) {
    e12 = data[i].close * k12 + e12 * (1 - k12);
    e26 = data[i].close * k26 + e26 * (1 - k26);
    macdLine[i]  = e12 - e26;
    sig = macdLine[i] * ks + sig * (1 - ks);
    signalLine[i] = sig;
    histogram[i]  = macdLine[i] - sig;
  }

  // Bollinger Bands (20 period, 2σ)
  for (let i = 19; i < n; i++) {
    let sum = 0;
    for (let j = i - 19; j <= i; j++) sum += data[j].close;
    const mean = sum / 20;
    let vsum = 0;
    for (let j = i - 19; j <= i; j++) vsum += (data[j].close - mean) ** 2;
    const std = Math.sqrt(vsum / 20);
    bbBasis[i] = mean;
    bbUpper[i] = mean + 2 * std;
    bbLower[i] = mean - 2 * std;
  }

  // SuperTrend (10, 3 or custom)
  const superTrend = new Array(n).fill(0);
  const superTrendDir = new Array(n).fill(1);
  const atrPeriod = supertrendPeriod;
  const stMult = supertrendMult;

  if (n > atrPeriod) {
    let atr = 0;
    for (let i = 1; i <= atrPeriod; i++) {
      const tr = Math.max(
        data[i].high - data[i].low,
        Math.abs(data[i].high - data[i - 1].close),
        Math.abs(data[i].low - data[i - 1].close)
      );
      atr += tr;
    }
    atr /= atrPeriod;

    let finalUpper = (data[atrPeriod].high + data[atrPeriod].low) / 2 + stMult * atr;
    let finalLower = (data[atrPeriod].high + data[atrPeriod].low) / 2 - stMult * atr;
    let dir = 1;

    for (let i = atrPeriod; i < n; i++) {
      if (i > atrPeriod) {
        const tr = Math.max(
          data[i].high - data[i].low,
          Math.abs(data[i].high - data[i - 1].close),
          Math.abs(data[i].low - data[i - 1].close)
        );
        atr = (atr * (atrPeriod - 1) + tr) / atrPeriod; // Wilder's smoothing
      }

      const hl2 = (data[i].high + data[i].low) / 2;
      const basicUpper = hl2 + stMult * atr;
      const basicLower = hl2 - stMult * atr;

      if (i === atrPeriod) {
        finalUpper = basicUpper;
        finalLower = basicLower;
      } else {
        if (basicUpper < finalUpper || data[i - 1].close > finalUpper) finalUpper = basicUpper;
        if (basicLower > finalLower || data[i - 1].close < finalLower) finalLower = basicLower;
      }

      if (dir === 1 && data[i].close < finalLower) {
        dir = -1;
      } else if (dir === -1 && data[i].close > finalUpper) {
        dir = 1;
      }

      superTrend[i] = dir === 1 ? finalLower : finalUpper;
      superTrendDir[i] = dir;
    }
  }

  // Donchian rolling high/low over breakoutPeriod bars (monotonic deque, O(n))
  const donchianHigh = new Array(n).fill(Infinity);
  const donchianLow  = new Array(n).fill(-Infinity);
  {
    const dqH: number[] = [], dqL: number[] = [];
    for (let i = 0; i < n; i++) {
      while (dqH.length && data[dqH[dqH.length - 1]].high <= data[i].high) dqH.pop();
      dqH.push(i);
      while (dqH[0] <= i - breakoutPeriod) dqH.shift();
      while (dqL.length && data[dqL[dqL.length - 1]].low >= data[i].low) dqL.pop();
      dqL.push(i);
      while (dqL[0] <= i - breakoutPeriod) dqL.shift();
      if (i >= breakoutPeriod - 1) {
        donchianHigh[i] = data[dqH[0]].high;
        donchianLow[i]  = data[dqL[0]].low;
      }
    }
  }

  return { ema9, ema21, rsi, macdLine, signalLine, histogram, bbUpper, bbBasis, bbLower, superTrend, superTrendDir, donchianHigh, donchianLow };
}

// ─── Entry Filters (EA-style "1 entry + N filters" model) ─────────────────────
// A bot's entry signal still fires the trade; each filter is an extra AND-gate
// that must pass. Oscillator filters (rsi/adx/stoch/atr_pct/macd_hist) compare a
// value vs a threshold (same gate for long & short). MA filters (sma/ema) are
// trend-direction aware: `align` = price on the trade's side of the MA.

export type FilterIndicator = 'rsi' | 'adx' | 'stoch' | 'macd_hist' | 'atr_pct' | 'sma' | 'ema';
export type FilterOp = '>' | '<' | 'align' | 'against';

export interface FilterBlock {
  id: string;
  indicator: FilterIndicator;
  period: number;            // lookback (RSI 14, ADX 14, SMA 200, …)
  op: FilterOp;              // >/< for oscillators; align/against for MAs
  value?: number;            // threshold for >/< (e.g. ADX > 25, RSI < 70)
}

const seriesKey = (f: FilterBlock) => `${f.indicator}:${f.period}`;

function smaSeries(data: Candle[], p: number): number[] {
  const n = data.length, out = new Array(n).fill(0); let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += data[i].close;
    if (i >= p) sum -= data[i - p].close;
    out[i] = i >= p - 1 ? sum / p : data[i].close;
  }
  return out;
}
function emaSeriesF(data: Candle[], p: number): number[] {
  const n = data.length, out = new Array(n).fill(0), k = 2 / (p + 1);
  let e = data[0].close; out[0] = e;
  for (let i = 1; i < n; i++) { e = data[i].close * k + e * (1 - k); out[i] = e; }
  return out;
}
function rsiSeries(data: Candle[], p: number): number[] {
  const n = data.length, out = new Array(n).fill(50);
  let ag = 0, al = 0;
  for (let i = 1; i <= p && i < n; i++) {
    const d = data[i].close - data[i - 1].close;
    if (d >= 0) ag += d; else al -= d;
  }
  ag /= p; al /= p;
  if (p < n) out[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = p + 1; i < n; i++) {
    const d = data[i].close - data[i - 1].close;
    ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p;
    al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}
function atrSeries(data: Candle[], p: number): number[] {
  const n = data.length, out = new Array(n).fill(0); let atr = 0;
  for (let i = 1; i < n; i++) {
    const tr = Math.max(
      data[i].high - data[i].low,
      Math.abs(data[i].high - data[i - 1].close),
      Math.abs(data[i].low - data[i - 1].close),
    );
    atr = i <= p ? (atr * (i - 1) + tr) / i : (atr * (p - 1) + tr) / p;
    out[i] = atr;
  }
  return out;
}
function atrPctSeries(data: Candle[], p: number): number[] {
  const atr = atrSeries(data, p);
  return atr.map((a, i) => (data[i].close > 0 ? (a / data[i].close) * 100 : 0));
}
function stochSeries(data: Candle[], p: number): number[] {
  const n = data.length, out = new Array(n).fill(50);
  for (let i = p - 1; i < n; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - p + 1; j <= i; j++) { if (data[j].high > hi) hi = data[j].high; if (data[j].low < lo) lo = data[j].low; }
    out[i] = hi === lo ? 50 : ((data[i].close - lo) / (hi - lo)) * 100;
  }
  return out;
}
function adxSeries(data: Candle[], p: number): number[] {
  const n = data.length, out = new Array(n).fill(0);
  if (n < p + 2) return out;
  let tr14 = 0, pdm14 = 0, ndm14 = 0;
  for (let i = 1; i <= p; i++) {
    const up = data[i].high - data[i - 1].high, dn = data[i - 1].low - data[i].low;
    pdm14 += up > dn && up > 0 ? up : 0;
    ndm14 += dn > up && dn > 0 ? dn : 0;
    tr14 += Math.max(data[i].high - data[i].low, Math.abs(data[i].high - data[i - 1].close), Math.abs(data[i].low - data[i - 1].close));
  }
  let adx = 0, dxSum = 0, count = 0;
  for (let i = p + 1; i < n; i++) {
    const up = data[i].high - data[i - 1].high, dn = data[i - 1].low - data[i].low;
    const pdm = up > dn && up > 0 ? up : 0, ndm = dn > up && dn > 0 ? dn : 0;
    const tr = Math.max(data[i].high - data[i].low, Math.abs(data[i].high - data[i - 1].close), Math.abs(data[i].low - data[i - 1].close));
    tr14 = tr14 - tr14 / p + tr;
    pdm14 = pdm14 - pdm14 / p + pdm;
    ndm14 = ndm14 - ndm14 / p + ndm;
    const pdi = tr14 ? (pdm14 / tr14) * 100 : 0, ndi = tr14 ? (ndm14 / tr14) * 100 : 0;
    const dx = pdi + ndi ? (Math.abs(pdi - ndi) / (pdi + ndi)) * 100 : 0;
    if (count < p) { dxSum += dx; adx = dxSum / (count + 1); }
    else adx = (adx * (p - 1) + dx) / p;
    count++; out[i] = adx;
  }
  return out;
}

export function computeFilterSeries(data: Candle[], filters?: FilterBlock[]): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const f of filters ?? []) {
    const key = seriesKey(f);
    if (out[key]) continue;
    const p = Math.max(2, Math.round(f.period || 14));
    switch (f.indicator) {
      case 'sma':       out[key] = smaSeries(data, p); break;
      case 'ema':       out[key] = emaSeriesF(data, p); break;
      case 'rsi':       out[key] = rsiSeries(data, p); break;
      case 'stoch':     out[key] = stochSeries(data, p); break;
      case 'adx':       out[key] = adxSeries(data, p); break;
      case 'atr_pct':   out[key] = atrPctSeries(data, p); break;
      case 'macd_hist': out[key] = computeIndicators(data).histogram; break;
    }
  }
  return out;
}

/** All filters must pass for the bar `i` and trade `side`. */
export function passesFilters(
  series: Record<string, number[]>,
  data: Candle[],
  i: number,
  filters: FilterBlock[] | undefined,
  side: 'LONG' | 'SHORT',
): boolean {
  if (!filters?.length) return true;
  for (const f of filters) {
    const s = series[seriesKey(f)];
    if (!s) continue;                 // unknown/uncomputed → don't block
    const v = s[i];
    if (f.indicator === 'sma' || f.indicator === 'ema') {
      const above = data[i].close > v;
      const want  = f.op === 'against' ? !(side === 'LONG' ? above : !above)
                                       : (side === 'LONG' ? above : !above);
      if (!want) return false;
    } else {
      const thr = f.value ?? 0;
      if (f.op === '>' && !(v > thr)) return false;
      if (f.op === '<' && !(v < thr)) return false;
    }
  }
  return true;
}

// ─── Signal Detection ─────────────────────────────────────────────────────────

function getSignal(i: number, data: Candle[], ind: Indicators, indicator: IndicatorType) {
  if (i < 30) return { buy: false, sell: false };
  switch (indicator) {
    case 'ema_cross':
      return {
        buy:  ind.ema9[i-1] <= ind.ema21[i-1] && ind.ema9[i] > ind.ema21[i],
        sell: ind.ema9[i-1] >= ind.ema21[i-1] && ind.ema9[i] < ind.ema21[i],
      };
    case 'rsi':
      return {
        buy:  ind.rsi[i-1] < 30 && ind.rsi[i] >= 30,
        sell: ind.rsi[i-1] > 70 && ind.rsi[i] <= 70,
      };
    case 'macd':
      return {
        buy:  ind.histogram[i-1] <= 0 && ind.histogram[i] > 0,
        sell: ind.histogram[i-1] >= 0 && ind.histogram[i] < 0,
      };
    case 'bb':
      return {
        buy:  data[i-1].close <= ind.bbLower[i-1] && data[i].close > ind.bbLower[i],
        sell: data[i-1].close >= ind.bbUpper[i-1] && data[i].close < ind.bbUpper[i],
      };
    case 'rsi_macd':
      return {
        buy:  ind.rsi[i] < 40 && ind.histogram[i-1] <= 0 && ind.histogram[i] > 0,
        sell: ind.rsi[i] > 60 && ind.histogram[i-1] >= 0 && ind.histogram[i] < 0,
      };
    case 'supertrend':
      return {
        // Bắt râu Long: Trend UP, giá low lùi về sát hoặc chạm Supertrend (<= 1% khoảng cách)
        buy: ind.superTrendDir[i] === 1 && data[i].low <= ind.superTrend[i] * 1.01,
        // Bắt râu Short: Trend DOWN, giá high nảy lên sát hoặc chạm Supertrend (<= 1% khoảng cách)
        sell: ind.superTrendDir[i] === -1 && data[i].high >= ind.superTrend[i] * 0.99,
      };
    case 'supertrend_flip':
      // Classic Supertrend EA entry: trade only the trend FLIP bar (direction
      // change), one signal per trend leg — not every bar near the band. The
      // opposite flip also closes the position via the shared Signal exit.
      return {
        buy:  ind.superTrendDir[i - 1] === -1 && ind.superTrendDir[i] === 1,
        sell: ind.superTrendDir[i - 1] === 1  && ind.superTrendDir[i] === -1,
      };
    case 'range_breakout':
      // Donchian momentum breakout (EA pending-order style): fire on the bar
      // whose CLOSE crosses the prior N-bar extreme — once per breakout, not
      // on every bar that stays beyond the band.
      return {
        buy:  data[i].close > ind.donchianHigh[i - 1] && data[i - 1].close <= ind.donchianHigh[i - 2],
        sell: data[i].close < ind.donchianLow[i - 1]  && data[i - 1].close >= ind.donchianLow[i - 2],
      };
    default:
      return { buy: false, sell: false };
  }
}

// ─── Stats Computation ────────────────────────────────────────────────────────

function computeStats(
  trades: Trade[],
  equityByIndex: number[],
  initialCapital: number
): BacktestStats {
  const n = trades.length;
  const empty: BacktestStats = {
    netProfitVal: 0, netProfitPct: 0, grossProfit: 0, grossLoss: 0,
    profitFactor: 0, winRate: 0, totalTrades: 0, winTrades: 0, lossTrades: 0,
    maxDrawdownPct: 0, maxDrawdownVal: 0, avgTradeProfit: 0, avgWin: 0, avgLoss: 0,
    maxConsecWins: 0, maxConsecLosses: 0, sharpeRatio: 0, totalCommission: 0,
    longTrades: 0, shortTrades: 0, expectancy: 0,
  };
  if (n === 0) return empty;

  const wins   = trades.filter(t => t.profitVal > 0);
  const losses = trades.filter(t => t.profitVal <= 0);
  const grossProfit = wins.reduce((s, t) => s + t.profitVal, 0);
  const grossLoss   = Math.abs(losses.reduce((s, t) => s + t.profitVal, 0));
  const netProfitVal = grossProfit - grossLoss;

  // Max drawdown
  let peak = initialCapital, maxDdPct = 0, maxDdVal = 0;
  for (const eq of equityByIndex) {
    if (eq > peak) peak = eq;
    const dd    = peak - eq;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (ddPct > maxDdPct) { maxDdPct = ddPct; maxDdVal = dd; }
  }

  // Consecutive wins/losses
  let maxCW = 0, maxCL = 0, cw = 0, cl = 0;
  for (const t of trades) {
    if (t.profitVal > 0) { cw++; cl = 0; if (cw > maxCW) maxCW = cw; }
    else                 { cl++; cw = 0; if (cl > maxCL) maxCL = cl; }
  }

  // Sharpe ratio (annualised)
  const returns: number[] = [];
  for (let i = 1; i < equityByIndex.length; i++) {
    const prev = equityByIndex[i - 1];
    if (prev > 0) returns.push((equityByIndex[i] - prev) / prev);
  }
  let sharpe = 0;
  if (returns.length > 1) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const std  = Math.sqrt(returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length);
    sharpe = std > 0 ? (mean / std) * Math.sqrt(252) : 0;
  }

  const winRate  = (wins.length / n) * 100;
  const avgWin   = wins.length   > 0 ? grossProfit / wins.length   : 0;
  const avgLoss  = losses.length > 0 ? grossLoss   / losses.length : 0;
  const expectancy = (winRate / 100) * avgWin - (1 - winRate / 100) * avgLoss;

  const r = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

  return {
    netProfitVal:   r(netProfitVal),
    netProfitPct:   r((netProfitVal / initialCapital) * 100),
    grossProfit:    r(grossProfit),
    grossLoss:      r(grossLoss),
    profitFactor:   grossLoss > 0 ? r(grossProfit / grossLoss) : grossProfit > 0 ? 999 : 0,
    winRate:        r(winRate, 1),
    totalTrades:    n,
    winTrades:      wins.length,
    lossTrades:     losses.length,
    maxDrawdownPct: r(maxDdPct, 1),
    maxDrawdownVal: r(maxDdVal),
    avgTradeProfit: r(netProfitVal / n),
    avgWin:         r(avgWin),
    avgLoss:        r(avgLoss),
    maxConsecWins:  maxCW,
    maxConsecLosses:maxCL,
    sharpeRatio:    r(sharpe),
    totalCommission:r(trades.reduce((s, t) => s + t.commissionPaid, 0)),
    longTrades:     trades.filter(t => t.type === 'LONG').length,
    shortTrades:    trades.filter(t => t.type === 'SHORT').length,
    expectancy:     r(expectancy),
  };
}

// ─── Main Engine ──────────────────────────────────────────────────────────────

export function runBacktest(data: Candle[], cfg: BacktestConfig): BacktestResult {
  const t0 = performance.now();
  const indicators = computeIndicators(data, cfg.supertrendMult ?? 3, cfg.supertrendPeriod ?? 10, cfg.breakoutPeriod ?? 20);
  const filterSeries = computeFilterSeries(data, cfg.filters);
  // MTF filter: direction of the last CLOSED HTF Supertrend per base bar
  const htfDir = cfg.htfMinutes
    ? computeHtfTrendDirs(data, cfg.htfMinutes, cfg.htfSupertrendPeriod ?? 10, cfg.htfSupertrendMult ?? 3)
    : null;
  const n = data.length;

  const trades: Trade[] = [];
  const equityByIndex = new Array(n).fill(cfg.initialCapital);

  let capital = cfg.initialCapital;
  let tradeId = 0;

  // EA money-management state
  const slip          = (cfg.slippagePct ?? 0) / 100;
  let lastExitIndex   = -1;
  let consecLosses    = 0;
  let dayKey          = '';
  let dayStartCapital = capital;
  let dayHalted       = false;

  // Active position
  let pos: (ManagedPosition & {
    entryIndex: number;
    sizeCoins: number;
    sizeUSD: number;
    liqPrice: number;
  }) | null = null;

  for (let i = 1; i < n; i++) {
    const candle = data[i];

    // Day rollover (daily-loss limit resets at UTC midnight, like an EA)
    const d = candle.date.slice(0, 10);
    if (d !== dayKey) { dayKey = d; dayStartCapital = capital; dayHalted = false; }

    // ── 1. Manage open position ──────────────────────────────────────
    if (pos) {
      let raed   = false;
      let exitPrice = candle.close;
      let reason: Trade['exitReason'] = 'Signal';

      // Liquidation (engine-specific — checked before regular management)
      if (pos.type === 'LONG'  && candle.low  <= pos.liqPrice) {
        exitPrice = pos.liqPrice; reason = 'Liquidation'; raed = true;
      } else if (pos.type === 'SHORT' && candle.high >= pos.liqPrice) {
        exitPrice = pos.liqPrice; reason = 'Liquidation'; raed = true;
      }

      // EA time-stop (maxTimeInPosition): force-close stale trades — the
      // standard anti-fakeout defense for breakout systems.
      if (!raed && (cfg.maxBarsInTrade ?? 0) > 0 && i - pos.entryIndex >= cfg.maxBarsInTrade!) {
        exitPrice = candle.close; reason = 'Time'; raed = true;
      }

      // Shared EA management block — identical code path to the live bot.
      if (!raed) {
        const opp  = getSignal(i, data, indicators, cfg.indicator);
        const exit = manageExit(cfg, pos, candle, opp);
        if (exit) { exitPrice = exit.price; reason = exit.reason; raed = true; }
      }

      // Adverse slippage on stop/market exits (TP is a resting order → exact fill)
      if (raed && slip > 0 && reason !== 'TP') {
        exitPrice = pos.type === 'LONG' ? exitPrice * (1 - slip) : exitPrice * (1 + slip);
      }

      if (raed) {
        const priceDiff  = pos.type === 'LONG'
          ? exitPrice - pos.entryPrice
          : pos.entryPrice - exitPrice;
        const rawProfit  = priceDiff * pos.sizeCoins;
        const commission = pos.sizeUSD * (cfg.commission / 100) * 2; // cả 2 chiều
        const netProfit  = rawProfit - commission;
        const margin     = pos.sizeUSD / cfg.leverage;

        capital = Math.max(1, capital + netProfit);

        trades.push({
          id: ++tradeId,
          type:         pos.type,
          entryDate:    data[pos.entryIndex].date,
          entryPrice:   pos.entryPrice,
          entryIndex:   pos.entryIndex,
          exitDate:     candle.date,
          exitPrice,
          exitIndex:    i,
          sizeCoins:    pos.sizeCoins,
          profitVal:    Math.round(netProfit * 100) / 100,
          profitPct:    margin > 0 ? Math.round((netProfit / margin) * 1000) / 10 : 0,
          exitReason:   reason,
          commissionPaid: Math.round(commission * 100) / 100,
        });
        // EA loss-streak / cooldown bookkeeping
        consecLosses  = netProfit < 0 ? consecLosses + 1 : 0;
        lastExitIndex = i;
        if ((cfg.maxDailyLossPct ?? 0) > 0 &&
            (capital - dayStartCapital) / dayStartCapital * 100 <= -(cfg.maxDailyLossPct!)) {
          dayHalted = true;
        }
        pos = null;
      }
    }

    equityByIndex[i] = capital;

    // ── 2. Check entry signals (gated by the EA filters) ─────────────
    const consecHalt = (cfg.maxConsecLosses ?? 0) > 0 && consecLosses >= cfg.maxConsecLosses!;
    const coolingDown = lastExitIndex >= 0 && (cfg.cooldownBars ?? 0) > 0 &&
                        i - lastExitIndex <= cfg.cooldownBars!;

    if (!pos && capital > 1 && !dayHalted && !consecHalt && !coolingDown && inSession(candle.date, cfg)) {
      let { buy, sell } = getSignal(i, data, indicators, cfg.indicator);
      // Direction filter
      if (cfg.direction === 'long_only')  sell = false;
      if (cfg.direction === 'short_only') buy  = false;
      // MTF filter: HTF green → buys only · HTF red → sells only · warmup → none
      if (htfDir) {
        if (htfDir[i] === 1)       sell = false;
        else if (htfDir[i] === -1) buy = false;
        else { buy = false; sell = false; }
      }
      // EA-style indicator filters (AND): every filter must pass for the side.
      if (buy  && !passesFilters(filterSeries, data, i, cfg.filters, 'LONG'))  buy  = false;
      if (sell && !passesFilters(filterSeries, data, i, cfg.filters, 'SHORT')) sell = false;

      if (buy || sell) {
        const type    = buy ? 'LONG' : 'SHORT';
        const margin  = calcMargin(cfg, capital);
        const sizeUSD = margin * cfg.leverage;
        // Adverse slippage on market entry
        const entryPrice = slip > 0
          ? (type === 'LONG' ? candle.close * (1 + slip) : candle.close * (1 - slip))
          : candle.close;
        const sizeCoins = sizeUSD / entryPrice;
        const liqBuf  = 1 / cfg.leverage;

        pos = {
          type,
          entryPrice,
          entryIndex:  i,
          sizeCoins,
          sizeUSD,
          peakPrice:   entryPrice,
          liqPrice:    type === 'LONG'
            ? entryPrice * (1 - liqBuf * 0.9)
            : entryPrice * (1 + liqBuf * 0.9),
          tpPrice:     type === 'LONG'
            ? entryPrice * (1 + cfg.takeProfitPct / 100)
            : entryPrice * (1 - cfg.takeProfitPct / 100),
          slPrice:     type === 'LONG'
            ? entryPrice * (1 - cfg.stopLossPct / 100)
            : entryPrice * (1 + cfg.stopLossPct / 100),
        };
      }
    }
  }

  // Đóng vị thế mở cuối kỳ (tính vào kết quả)
  if (pos) {
    const last = data[n - 1];
    const pd   = pos.type === 'LONG'
      ? last.close - pos.entryPrice
      : pos.entryPrice - last.close;
    const comm = pos.sizeUSD * (cfg.commission / 100) * 2;
    const net  = pd * pos.sizeCoins - comm;
    const mgn  = pos.sizeUSD / cfg.leverage;
    capital    = Math.max(1, capital + net);
    trades.push({
      id: ++tradeId,
      type:         pos.type,
      entryDate:    data[pos.entryIndex].date,
      entryPrice:   pos.entryPrice,
      entryIndex:   pos.entryIndex,
      exitDate:     last.date,
      exitPrice:    last.close,
      exitIndex:    n - 1,
      sizeCoins:    pos.sizeCoins,
      profitVal:    Math.round(net * 100) / 100,
      profitPct:    mgn > 0 ? Math.round((net / mgn) * 1000) / 10 : 0,
      exitReason:   'Signal',
      commissionPaid: Math.round(comm * 100) / 100,
    });
    equityByIndex[n - 1] = capital;
  }

  // Điền equity cho các khoảng trống
  for (let i = 1; i < n; i++) {
    if (equityByIndex[i] === cfg.initialCapital && i > 1)
      equityByIndex[i] = equityByIndex[i - 1];
  }

  const stats = computeStats(trades, equityByIndex, cfg.initialCapital);
  return {
    trades,
    equityByIndex,
    finalCapital: capital,
    stats,
    indicators,
    durationMs: Math.round(performance.now() - t0),
  };
}

// ─── Live Signal Detection ────────────────────────────────────────────────────
// Dùng cho Live Trade: tính toán tín hiệu từ N nến gần nhất

export function detectLiveSignal(
  candles: Candle[],
  indicator: IndicatorType,
  direction: 'both' | 'long_only' | 'short_only' = 'both',
  opts?: {
    supertrendMult?: number; supertrendPeriod?: number; breakoutPeriod?: number;
    htfMinutes?: number; htfSupertrendPeriod?: number; htfSupertrendMult?: number;
    filters?: FilterBlock[];
  },
): {
  buy: boolean;
  sell: boolean;
  indicators: Indicators;
  lastValues: {
    rsi: number; ema9: number; ema21: number;
    macdHist: number; bbUpper: number; bbLower: number;
  };
} {
  const ind = computeIndicators(candles, opts?.supertrendMult ?? 3, opts?.supertrendPeriod ?? 10, opts?.breakoutPeriod ?? 20);
  const n   = candles.length;
  if (n < 32) return {
    buy: false, sell: false, indicators: ind,
    lastValues: { rsi: 50, ema9: 0, ema21: 0, macdHist: 0, bbUpper: 0, bbLower: 0 },
  };

  let { buy, sell } = getSignal(n - 1, candles, ind, indicator);
  if (direction === 'long_only')  sell = false;
  if (direction === 'short_only') buy  = false;
  // MTF filter — identical rule to the backtester (closed HTF candles only)
  if (opts?.htfMinutes) {
    const htfDir = computeHtfTrendDirs(candles, opts.htfMinutes, opts.htfSupertrendPeriod ?? 10, opts.htfSupertrendMult ?? 3);
    const d = htfDir[n - 1];
    if (d === 1)       sell = false;
    else if (d === -1) buy = false;
    else { buy = false; sell = false; }
  }
  // EA-style indicator filters (AND) — same gate as the backtester.
  if (opts?.filters?.length) {
    const fs = computeFilterSeries(candles, opts.filters);
    if (buy  && !passesFilters(fs, candles, n - 1, opts.filters, 'LONG'))  buy  = false;
    if (sell && !passesFilters(fs, candles, n - 1, opts.filters, 'SHORT')) sell = false;
  }

  return {
    buy, sell, indicators: ind,
    lastValues: {
      rsi:      Math.round(ind.rsi[n - 1] * 10) / 10,
      // Giữ 4 chữ số thập phân — phù hợp cho cả SUI ($0.82) và BTC ($100k+)
      ema9:     Math.round(ind.ema9[n - 1] * 10000) / 10000,
      ema21:    Math.round(ind.ema21[n - 1] * 10000) / 10000,
      macdHist: Math.round(ind.histogram[n - 1] * 10000) / 10000,
      bbUpper:  Math.round(ind.bbUpper[n - 1] * 10000) / 10000,
      bbLower:  Math.round(ind.bbLower[n - 1] * 10000) / 10000,
    },
  };
}

// ─── Converter: BotSkillConfig → BacktestConfig ───────────────────────────────
// Import động để tránh circular dependency

export function configFromBotSkill(
  skill: {
    signal: IndicatorType;
    takeProfitPct: number;
    stopLossPct: number;
    trailingStopPct: number;
    enableTrailing: boolean;
    enableDefense: boolean;
    leverage: number;
    orderPct: number;
    commission: number;
    direction: 'both' | 'long_only' | 'short_only';
    filters?: FilterBlock[];
    // Supertrend EA inputs (optional)
    supertrendPeriod?: number;
    supertrendMult?: number;
    breakoutPeriod?: number;
    maxBarsInTrade?: number;
    htfMinutes?: number;
    htfSupertrendPeriod?: number;
    htfSupertrendMult?: number;
    // EA module (optional)
    sizingMode?: 'fixed_pct' | 'risk_pct';
    riskPct?: number;
    breakEvenTriggerPct?: number;
    cooldownBars?: number;
    maxConsecLosses?: number;
    maxDailyLossPct?: number;
    sessionStartHour?: number;
    sessionEndHour?: number;
    slippagePct?: number;
  },
  initialCapital = 10000
): BacktestConfig {
  return {
    initialCapital,
    leverage:        skill.leverage,
    orderPct:        skill.orderPct,
    commission:      skill.commission,
    takeProfitPct:   skill.takeProfitPct,
    stopLossPct:     skill.stopLossPct,
    trailingStopPct: skill.trailingStopPct,
    enableTrailing:  skill.enableTrailing,
    enableDefense:   skill.enableDefense,
    indicator:       skill.signal,
    filters:         skill.filters,
    direction:       skill.direction,
    supertrendPeriod: skill.supertrendPeriod,
    supertrendMult:   skill.supertrendMult,
    breakoutPeriod:   skill.breakoutPeriod,
    maxBarsInTrade:   skill.maxBarsInTrade,
    htfMinutes:           skill.htfMinutes,
    htfSupertrendPeriod:  skill.htfSupertrendPeriod,
    htfSupertrendMult:    skill.htfSupertrendMult,
    // EA module passthrough — backtest runs the same rules the live bot will
    sizingMode:          skill.sizingMode,
    riskPct:             skill.riskPct,
    breakEvenTriggerPct: skill.breakEvenTriggerPct,
    cooldownBars:        skill.cooldownBars,
    maxConsecLosses:     skill.maxConsecLosses,
    maxDailyLossPct:     skill.maxDailyLossPct,
    sessionStartHour:    skill.sessionStartHour,
    sessionEndHour:      skill.sessionEndHour,
    slippagePct:         skill.slippagePct,
  };
}
