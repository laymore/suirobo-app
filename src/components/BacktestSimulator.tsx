/**
 * BacktestSimulator — MT5-style Backtest
 * Two modes:
 *  1. Instant (Strategy Tester): tính toàn bộ 1 lần, kết quả tức thì
 *  2. Visual Replay: replay candles one by one after computation
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  runBacktest, configFromBotSkill,
  type Candle, type BacktestConfig, type BacktestResult,
  type IndicatorType, type Trade,
  type FilterBlock, type FilterIndicator, type FilterOp,
} from '../agent/backtestEngine';
import {
  loadBotSkills, upsertBotSkill, PRESET_SKILLS, TEMPLATE_SKILLS,
  type BotSkillConfig,
} from '../types/botSkill';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { AGENT_URL } from '../agent/agentUrl';

// ─── Constants ────────────────────────────────────────────────────────────────

const VISIBLE_CANDLES = 80;

// Asset configs for data loading & display
const ASSET_CONFIGS = {
  btc: {
    label:  'BTC/USDT',
    flag:   '₿',
    file:   (tf: string, year: string) => year === '2026' ? `/data/btc_2026_${tf}.json` : `/data/btc_full_2025_${tf}.json`,
    period: 'Full year 2025',
    color:  '#f59e0b',
  },
  sui: {
    label:  'SUI/USDT',
    flag:   '💧',
    file:   (tf: string, year: string) => year === '2026' ? `/data/sui_2026_${tf}.json` : `/data/sui_full_2025_${tf}.json`,
    period: 'Full year 2025',
    color:  '#00d4ff',
  },
} as const;
// 2026 dataset covers Jan–May only (real Binance data fetched mid-2026).
const MONTHS_BY_YEAR: Record<string, number> = { '2025': 12, '2026': 5 };

type AssetKey = keyof typeof ASSET_CONFIGS;

// Only 4 timeframes as requested
const TF_OPTIONS_BACKTEST = [
  ['M5',  'M5'],
  ['M15', 'M15'],
  ['M30', 'M30'],
  ['H1',  'H1'],
] as const;

const INDICATOR_LABELS: Record<IndicatorType, string> = {
  ema_cross: 'EMA Cross (9/21)',
  ma_cross:  'MA Cross (SMA 20/50)',
  rsi:       'RSI Momentum (30/70)',
  macd:      'MACD Histogram',
  bb:        'Bollinger Bands',
  rsi_macd:  'RSI + MACD Hybrid',
  supertrend:'Supertrend wick-catch',
  supertrend_flip:'Supertrend Flip — EA',
  range_breakout:'Range Breakout — EA'
};

// EA-style entry-filter catalogue. `osc` filters compare a value vs a threshold
// (>/<); `ma` filters are trend-direction aware (price above/below the MA).
const FILTER_META: Record<FilterIndicator, { label: string; hasPeriod: boolean; kind: 'osc' | 'ma'; defPeriod: number; defValue: number; hint: string }> = {
  adx:       { label: 'ADX (trend strength)', hasPeriod: true,  kind: 'osc', defPeriod: 14,  defValue: 25, hint: '> 25 = strong trend' },
  rsi:       { label: 'RSI',                   hasPeriod: true,  kind: 'osc', defPeriod: 14,  defValue: 50, hint: '0-100' },
  stoch:     { label: 'Stochastic %K',         hasPeriod: true,  kind: 'osc', defPeriod: 14,  defValue: 50, hint: '0-100' },
  atr_pct:   { label: 'ATR % (volatility)',    hasPeriod: true,  kind: 'osc', defPeriod: 14,  defValue: 1,  hint: '% of price' },
  macd_hist: { label: 'MACD histogram',        hasPeriod: false, kind: 'osc', defPeriod: 0,   defValue: 0,  hint: '> 0 bullish' },
  sma:       { label: 'Price vs SMA',          hasPeriod: true,  kind: 'ma',  defPeriod: 200, defValue: 0,  hint: 'trend gate' },
  ema:       { label: 'Price vs EMA',          hasPeriod: true,  kind: 'ma',  defPeriod: 200, defValue: 0,  hint: 'trend gate' },
};

const EXIT_COLORS: Record<string, string> = {
  TP:          '#22c55e',
  SL:          '#ef4444',
  Trailing:    '#00d4ff',
  Signal:      '#a78bfa',
  Liquidation: '#ff6b00',
};

// ─── Canvas Drawing ────────────────────────────────────────────────────────────

function drawChart(
  canvas: HTMLCanvasElement,
  data: Candle[],
  result: BacktestResult,
  replayIdx: number,  // -1 = show all (instant mode)
  cfg: BacktestConfig,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const endIdx   = replayIdx >= 0 ? replayIdx : data.length - 1;
  const startIdx = Math.max(0, endIdx - VISIBLE_CANDLES + 1);
  const slice    = data.slice(startIdx, endIdx + 1);
  if (slice.length === 0) return;

  const { indicators, trades } = result;

  // ── Layout ──
  const PAD_L = 8, PAD_R = 64, PAD_T = 16, PAD_B = 20;
  const mainH  = Math.round(H * 0.62);
  const rsiH   = Math.round(H * 0.18);
  const macdH  = H - mainH - rsiH - 2;
  const mainY  = PAD_T;
  const rsiY   = mainY + mainH + 4;
  const macdY  = rsiY + rsiH + 4;
  const chartW = W - PAD_L - PAD_R;

  // ── Price range ──
  const highs = slice.map(c => c.high);
  const lows  = slice.map(c => c.low);
  let priceMax = Math.max(...highs) * 1.012;
  let priceMin = Math.min(...lows)  * 0.988;

  // Widen range if active position has TP/SL outside visible range
  // (we'll add those lines later)

  const scaleY = (p: number, yTop: number, height: number, min: number, max: number) =>
    yTop + height - ((p - min) / (max - min)) * height;

  const scaleX = (i: number) => PAD_L + (i / (VISIBLE_CANDLES - 1)) * chartW;

  // ── Background ──
  ctx.fillStyle = '#060e1e';
  ctx.fillRect(0, 0, W, H);

  // Separator lines
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, rsiY - 2); ctx.lineTo(W, rsiY - 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, macdY - 2); ctx.lineTo(W, macdY - 2); ctx.stroke();

  // ── Grid lines (main) ──
  ctx.strokeStyle = '#1a2540';
  ctx.setLineDash([3, 5]);
  ctx.lineWidth = 0.5;
  for (let g = 0; g <= 4; g++) {
    const y = mainY + (g / 4) * mainH;
    ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R + 4, y); ctx.stroke();
    const price = priceMax - (g / 4) * (priceMax - priceMin);
    ctx.setLineDash([]);
    ctx.fillStyle = '#475569';
    ctx.font = '9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText('$' + Math.round(price).toLocaleString(), W - PAD_R + 6, y + 3);
    ctx.setLineDash([3, 5]);
  }
  ctx.setLineDash([]);

  // ── Bollinger Bands ──
  if (cfg.indicator === 'bb' || cfg.indicator === 'ema_cross') {
    ctx.lineWidth = 0.8;
    for (const [key, color] of [['bbUpper', '#374151'], ['bbLower', '#374151'], ['bbBasis', '#2d3f55']] as const) {
      ctx.strokeStyle = color;
      ctx.setLineDash(key === 'bbBasis' ? [4, 4] : []);
      ctx.beginPath();
      let first = true;
      for (let i = 0; i < slice.length; i++) {
        const gi = startIdx + i;
        const val = (indicators as any)[key][gi];
        if (!val) continue;
        const x = scaleX(i);
        const y = scaleY(val, mainY, mainH, priceMin, priceMax);
        first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        first = false;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // ── EMA lines ──
  for (const [arr, color] of [[indicators.ema9, '#00d4ff'], [indicators.ema21, '#f59e0b']] as const) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    let first = true;
    for (let i = 0; i < slice.length; i++) {
      const v = arr[startIdx + i];
      if (!v) continue;
      const x = scaleX(i);
      const y = scaleY(v, mainY, mainH, priceMin, priceMax);
      first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      first = false;
    }
    ctx.stroke();
  }

  // ── Candles ──
  const cw = Math.max(2, chartW / VISIBLE_CANDLES * 0.7);
  for (let i = 0; i < slice.length; i++) {
    const c     = slice[i];
    const isUp  = c.close >= c.open;
    const color = isUp ? '#22c55e' : '#ef4444';
    const x     = scaleX(i);
    const yH    = scaleY(c.high,  mainY, mainH, priceMin, priceMax);
    const yL    = scaleY(c.low,   mainY, mainH, priceMin, priceMax);
    const yO    = scaleY(c.open,  mainY, mainH, priceMin, priceMax);
    const yC    = scaleY(c.close, mainY, mainH, priceMin, priceMax);

    ctx.strokeStyle = color;
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(x, yH); ctx.lineTo(x, yL); ctx.stroke();

    ctx.fillStyle = color;
    const bodyTop = Math.min(yO, yC);
    const bodyH   = Math.max(1.5, Math.abs(yO - yC));
    ctx.fillRect(x - cw / 2, bodyTop, cw, bodyH);
  }

  // ── Trade markers on candles ──
  const visibleTrades = trades.filter(t =>
    (t.entryIndex >= startIdx && t.entryIndex <= endIdx) ||
    (t.exitIndex  >= startIdx && t.exitIndex  <= endIdx)
  );
  for (const t of visibleTrades) {
    // Entry arrow
    if (t.entryIndex >= startIdx && t.entryIndex <= endIdx) {
      const ix = t.entryIndex - startIdx;
      const x  = scaleX(ix);
      const c  = data[t.entryIndex];
      if (t.type === 'LONG') {
        const y = scaleY(c.low, mainY, mainH, priceMin, priceMax) + 18;
        ctx.fillStyle = '#22c55e';
        ctx.beginPath(); ctx.moveTo(x, y - 10); ctx.lineTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.closePath(); ctx.fill();
      } else {
        const y = scaleY(c.high, mainY, mainH, priceMin, priceMax) - 18;
        ctx.fillStyle = '#ef4444';
        ctx.beginPath(); ctx.moveTo(x, y + 10); ctx.lineTo(x - 5, y); ctx.lineTo(x + 5, y); ctx.closePath(); ctx.fill();
      }
    }
    // Exit marker (X)
    if (t.exitIndex >= startIdx && t.exitIndex <= endIdx) {
      const ix = t.exitIndex - startIdx;
      const x  = scaleX(ix);
      const c  = data[t.exitIndex];
      const y  = scaleY(c.close, mainY, mainH, priceMin, priceMax);
      const color = EXIT_COLORS[t.exitReason] || '#94a3b8';
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1.5;
      ctx.beginPath(); ctx.moveTo(x - 4, y - 4); ctx.lineTo(x + 4, y + 4); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 4, y - 4); ctx.lineTo(x - 4, y + 4); ctx.stroke();
    }
  }

  // ── Active position lines (only in replay mode) ──
  if (replayIdx >= 0) {
    const activeTrade = trades.find(t => t.entryIndex <= replayIdx && t.exitIndex > replayIdx);
    if (activeTrade) {
      const ep = activeTrade.entryPrice;
      const tp = activeTrade.type === 'LONG'
        ? ep * (1 + cfg.takeProfitPct / 100)
        : ep * (1 - cfg.takeProfitPct / 100);
      const sl = activeTrade.type === 'LONG'
        ? ep * (1 - cfg.stopLossPct / 100)
        : ep * (1 + cfg.stopLossPct / 100);

      for (const [price, color, label] of [
        [ep, '#94a3b8', `Entry $${ep.toLocaleString()}`],
        [tp, '#22c55e', `TP $${Math.round(tp).toLocaleString()}`],
        [sl, '#ef4444', `SL $${Math.round(sl).toLocaleString()}`],
      ] as [number, string, string][]) {
        const y = scaleY(price, mainY, mainH, priceMin, priceMax);
        if (y < mainY || y > mainY + mainH) continue;
        ctx.strokeStyle = color;
        ctx.lineWidth   = 0.8;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle  = color;
        ctx.font       = '9px monospace';
        ctx.textAlign  = 'left';
        ctx.fillText(label, W - PAD_R + 6, y + 3);
      }
    }
  }

  // ── RSI Subchart ──
  const rsiMin = 0, rsiMax = 100;
  ctx.fillStyle = '#0a1020';
  ctx.fillRect(PAD_L, rsiY, chartW + PAD_R - 4, rsiH);

  // Grid lines for RSI
  ctx.strokeStyle = '#1a2540'; ctx.setLineDash([2, 4]); ctx.lineWidth = 0.5;
  for (const lvl of [30, 50, 70]) {
    const y = scaleY(lvl, rsiY, rsiH, rsiMin, rsiMax);
    ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R + 4, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#374151'; ctx.font = '8px monospace'; ctx.textAlign = 'left';
    ctx.fillText(String(lvl), W - PAD_R + 6, y + 3);
    ctx.setLineDash([2, 4]);
  }
  ctx.setLineDash([]);

  // Label
  ctx.fillStyle = '#64748b'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('RSI(14)', PAD_L + 2, rsiY + 10);

  // RSI fill zone
  ctx.beginPath();
  for (let i = 0; i < slice.length; i++) {
    const v = indicators.rsi[startIdx + i];
    const x = scaleX(i);
    const y = scaleY(v, rsiY, rsiH, rsiMin, rsiMax);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#818cf8'; ctx.lineWidth = 1.2; ctx.stroke();

  // Overbought/oversold fills
  for (let i = 1; i < slice.length; i++) {
    const v = indicators.rsi[startIdx + i];
    const x = scaleX(i);
    const y = scaleY(v, rsiY, rsiH, rsiMin, rsiMax);
    const y30 = scaleY(30, rsiY, rsiH, rsiMin, rsiMax);
    const y70 = scaleY(70, rsiY, rsiH, rsiMin, rsiMax);
    if (v < 30) { ctx.fillStyle = 'rgba(34,197,94,0.15)'; ctx.fillRect(x - 2, y, 4, y30 - y); }
    if (v > 70) { ctx.fillStyle = 'rgba(239,68,68,0.15)';  ctx.fillRect(x - 2, y70, 4, y - y70); }
  }

  // ── MACD Subchart ──
  const macdVals = indicators.histogram.slice(startIdx, endIdx + 1).filter(Boolean);
  const macdMax  = Math.max(Math.abs(Math.max(...macdVals, 0.01)), Math.abs(Math.min(...macdVals, -0.01))) * 1.2;
  const macdMin  = -macdMax;

  ctx.fillStyle = '#0a1020';
  ctx.fillRect(PAD_L, macdY, chartW + PAD_R - 4, macdH);
  ctx.fillStyle = '#64748b'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText('MACD', PAD_L + 2, macdY + 10);

  // Zero line
  const macdZeroY = scaleY(0, macdY, macdH, macdMin, macdMax);
  ctx.strokeStyle = '#334155'; ctx.lineWidth = 0.5;
  ctx.beginPath(); ctx.moveTo(PAD_L, macdZeroY); ctx.lineTo(W - PAD_R, macdZeroY); ctx.stroke();

  // Histogram bars
  const bw = Math.max(1, chartW / VISIBLE_CANDLES * 0.6);
  for (let i = 0; i < slice.length; i++) {
    const h = indicators.histogram[startIdx + i];
    if (!h) continue;
    const x   = scaleX(i);
    const yH  = scaleY(h, macdY, macdH, macdMin, macdMax);
    ctx.fillStyle = h >= 0 ? 'rgba(34,197,94,0.7)' : 'rgba(239,68,68,0.7)';
    ctx.fillRect(x - bw / 2, Math.min(yH, macdZeroY), bw, Math.abs(yH - macdZeroY));
  }

  // MACD & Signal lines
  for (const [arr, color] of [
    [indicators.macdLine, '#818cf8'],
    [indicators.signalLine, '#f59e0b'],
  ] as const) {
    ctx.strokeStyle = color; ctx.lineWidth = 0.9;
    ctx.beginPath();
    let first = true;
    for (let i = 0; i < slice.length; i++) {
      const v = arr[startIdx + i];
      if (!v && v !== 0) continue;
      const x = scaleX(i);
      const y = scaleY(v, macdY, macdH, macdMin, macdMax);
      first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      first = false;
    }
    ctx.stroke();
  }

  // ── Current candle date label ──
  if (slice.length > 0) {
    ctx.fillStyle = '#475569'; ctx.font = '9px monospace'; ctx.textAlign = 'right';
    ctx.fillText(slice[slice.length - 1].date, W - 2, H - 4);
  }
}

// ─── Stats Card ───────────────────────────────────────────────────────────────

// Equity curve + drawdown shading — the headline MT5-style report visual.
// Data (equityByIndex per candle, net of fees+slippage) is precomputed by the engine.
const EquityCurve: React.FC<{ equity: number[]; initialCapital: number; maxDdPct: number }> =
  ({ equity, initialCapital, maxDdPct }) => {
    const ref = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
      const cv = ref.current;
      if (!cv || equity.length < 2) return;
      const dpr = window.devicePixelRatio || 1;
      const W = cv.clientWidth || 600, H = cv.clientHeight || 110;
      cv.width = W * dpr; cv.height = H * dpr;
      const ctx = cv.getContext('2d'); if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const lo = Math.min(initialCapital, ...equity), hi = Math.max(initialCapital, ...equity);
      const pad = 8, span = (hi - lo) || 1;
      const X = (i: number) => pad + (i / (equity.length - 1)) * (W - 2 * pad);
      const Y = (v: number) => H - pad - ((v - lo) / span) * (H - 2 * pad);
      // baseline at starting capital
      ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(pad, Y(initialCapital)); ctx.lineTo(W - pad, Y(initialCapital)); ctx.stroke();
      ctx.setLineDash([]);
      // running peak → drawdown region (shaded red where equity < peak)
      const peaks: number[] = []; let pk = equity[0];
      for (const e of equity) { pk = Math.max(pk, e); peaks.push(pk); }
      ctx.fillStyle = 'rgba(239,68,68,0.12)';
      ctx.beginPath(); ctx.moveTo(X(0), Y(equity[0]));
      for (let i = 1; i < equity.length; i++) ctx.lineTo(X(i), Y(equity[i]));
      for (let i = equity.length - 1; i >= 0; i--) ctx.lineTo(X(i), Y(peaks[i]));
      ctx.closePath(); ctx.fill();
      // equity line (green if ending above start, else red)
      const up = equity[equity.length - 1] >= initialCapital;
      ctx.strokeStyle = up ? '#10b981' : '#ef4444'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(X(0), Y(equity[0]));
      for (let i = 1; i < equity.length; i++) ctx.lineTo(X(i), Y(equity[i]));
      ctx.stroke();
    }, [equity, initialCapital]);
    return (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: '0.62rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>📈 Equity Curve</span>
          <span style={{ fontSize: '0.6rem', color: '#ef4444' }}>max drawdown {maxDdPct}%</span>
        </div>
        <div style={{ background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 8, padding: 4 }}>
          <canvas ref={ref} style={{ width: '100%', height: 110, display: 'block' }} />
        </div>
      </div>
    );
  };

const StatCard: React.FC<{ label: string; value: string | number; sub?: string; color?: string }> =
  ({ label, value, sub, color = '#e2e8f0' }) => (
    <div style={{
      background: '#0a0f1d', borderRadius: 10, padding: '10px 12px',
      border: `1px solid ${color}22`, textAlign: 'center',
    }}>
      <div style={{ fontSize: '0.6rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: '0.95rem', fontWeight: 800, color, fontFamily: 'monospace' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.6rem', color: '#475569', marginTop: 2 }}>{sub}</div>}
    </div>
  );

// A compact labeled number input for an indicator parameter (MT5 "inputs" style).
const ParamRow: React.FC<{ label: string; value: number; onChange: (n: number) => void; step?: number }> =
  ({ label, value, onChange, step = 1 }) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ flex: 1, fontSize: '0.66rem', color: '#64748b' }}>{label}</span>
      <input type="number" step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value) || 0)}
        style={{ width: 70, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 5, padding: '3px 6px', color: '#e2e8f0', fontSize: '0.7rem', textAlign: 'right' }} />
    </div>
  );

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  preloadedBotSkill?: BotSkillConfig; // từ Factory "Backtest now"
}

export const BacktestSimulator: React.FC<Props> = ({ preloadedBotSkill }) => {
  const account = useCurrentAccount();
  // ── Bot Skills ──
  const [botSkills,      setBotSkills]      = useState<BotSkillConfig[]>([]);
  const [activeBotSkill, setActiveBotSkill] = useState<BotSkillConfig | null>(null);
  // True once the user edits a loaded skill — keeps the dropdown showing what they
  // started from (no jarring reset) while suppressing auto-stat-save onto a preset.
  const [dirty,          setDirty]          = useState(false);

  // ── Config ──
  // Defaults preset to the backtest-winning bb_meanrev_m15 strategy
  // (Bollinger Bands mean-reversion, M15, +10.29%/month). All fields remain editable.
  const [initialCapital, setInitialCapital] = useState(10000);
  const [leverage,       setLeverage]       = useState(3);
  const [orderPct,       setOrderPct]       = useState(50);
  const [commission,     setCommission]     = useState(0.05);
  const [indicator,      setIndicator]      = useState<IndicatorType>('bb');
  const [takeProfitPct,  setTakeProfitPct]  = useState(5);
  const [stopLossPct,    setStopLossPct]    = useState(1.5);
  const [trailingStopPct,setTrailingStopPct]= useState(0);
  const [enableTrailing, setEnableTrailing] = useState(false);
  const [enableDefense,  setEnableDefense]  = useState(true);
  const [direction,      setDirection]      = useState<'both'|'long_only'|'short_only'>('both');
  // EA-style extra AND-filters layered on top of the entry signal.
  const [filters,        setFilters]        = useState<FilterBlock[]>([]);
  // Tunable entry-indicator inputs (shown per selected indicator).
  const [emaFast, setEmaFast] = useState(9);   const [emaSlow, setEmaSlow] = useState(21);
  const [maFast,  setMaFast]  = useState(20);  const [maSlow,  setMaSlow]  = useState(50);
  const [rsiPeriod, setRsiPeriod] = useState(14); const [rsiOversold, setRsiOversold] = useState(30); const [rsiOverbought, setRsiOverbought] = useState(70);
  const [bbPeriod, setBbPeriod] = useState(20); const [bbStdDev, setBbStdDev] = useState(2);
  const [stPeriod, setStPeriod] = useState(10); const [stMult, setStMult] = useState(3);
  const [bkPeriod, setBkPeriod] = useState(20);
  const [timeframe,      setTimeframe]      = useState('M15');
  // 'm1'..'m12' = one calendar month tested standalone (no full-year option)
  const [duration,       setDuration]       = useState<string>('m1');
  // Dataset year: 2025 (full year) or 2026 (real Jan–May).
  const [year,           setYear]           = useState<'2025' | '2026'>('2025');

  // ── Asset selection ──
  const [asset, setAsset] = useState<AssetKey>('sui');

  // ── Data ──
  const [btcData,      setBtcData]      = useState<Candle[]>([]);
  const [isLoading,    setIsLoading]    = useState(true);

  // ── Result ──
  const [result,       setResult]       = useState<BacktestResult | null>(null);
  const [isRunning,    setIsRunning]    = useState(false);

  // ── Mode: instant vs replay ──
  const [mode,         setMode]         = useState<'instant' | 'replay'>('instant');

  // ── Replay state ──
  const [replayIdx,    setReplayIdx]    = useState(30);
  const [isPlaying,    setIsPlaying]    = useState(false);
  const [replaySpeed,  setReplaySpeed]  = useState(80);
  const replayTimer    = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Trade list sort ──
  const [sortBy,       setSortBy]       = useState<'id' | 'profit'>('id');

  // ── Canvas refs ──
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // ── Load bot skills ─────────────────────────────────────────────────
  useEffect(() => {
    const mergePresets = (list: BotSkillConfig[]): BotSkillConfig[] => {
      const merged = [...TEMPLATE_SKILLS, ...PRESET_SKILLS];
      for (const s of list) {
        if (!merged.find(x => x.name === s.name)) merged.push(s);
      }
      return merged;
    };
    const local = mergePresets(loadBotSkills());
    setBotSkills(local);

    fetch(`${AGENT_URL}/api/skills/bot`)
      .then(r => r.json())
      .then(d => {
        if (d.skills?.length) {
          const fetchedMerged = mergePresets(d.skills);
          // Merge with local to not lose unpublished ones
          const finalList = [...fetchedMerged];
          for (const ls of local) {
            if (!finalList.find(x => x.name === ls.name)) finalList.push(ls);
          }
          setBotSkills(finalList);
        }
      }).catch(() => {});
  }, []);

  // ── Apply preloaded skill từ Factory ──────────────────────────────
  useEffect(() => {
    if (preloadedBotSkill) applyBotSkill(preloadedBotSkill);
  }, [preloadedBotSkill]);

  // ── Apply bot skill → fill the whole config ─────────────────────
  const applyBotSkill = (skill: BotSkillConfig) => {
    setActiveBotSkill(skill);
    setDirty(false);
    setIndicator(skill.signal);
    setFilters(skill.filters ? skill.filters.map(f => ({ ...f })) : []);
    // Tunable entry-indicator inputs (fall back to classic defaults)
    setEmaFast(skill.emaFast ?? 9); setEmaSlow(skill.emaSlow ?? 21);
    setMaFast(skill.maFast ?? 20);  setMaSlow(skill.maSlow ?? 50);
    setRsiPeriod(skill.rsiPeriod ?? 14); setRsiOversold(skill.rsiOversold ?? 30); setRsiOverbought(skill.rsiOverbought ?? 70);
    setBbPeriod(skill.bbPeriod ?? 20); setBbStdDev(skill.bbStdDev ?? 2);
    setStPeriod(skill.supertrendPeriod ?? 10); setStMult(skill.supertrendMult ?? 3);
    setBkPeriod(skill.breakoutPeriod ?? 20);
    setTakeProfitPct(skill.takeProfitPct);
    setStopLossPct(skill.stopLossPct);
    setTrailingStopPct(skill.trailingStopPct);
    setEnableTrailing(skill.enableTrailing);
    setEnableDefense(skill.enableDefense);
    setLeverage(skill.leverage);
    setOrderPct(skill.orderPct);
    setCommission(skill.commission);
    setDirection(skill.direction);
    // Apply preferred timeframe / asset from research presets
    if (skill.preferredTimeframe) setTimeframe(skill.preferredTimeframe);
    if (skill.preferredAsset && (skill.preferredAsset === 'btc' || skill.preferredAsset === 'sui'))
      setAsset(skill.preferredAsset as AssetKey);
    setResult(null);
  };

  // ── Save backtest stats vào Bot Skill ─────────────────────────────
  const saveStatsToBotSkill = (res: BacktestResult) => {
    if (!activeBotSkill) return;
    const updated = upsertBotSkill({
      ...activeBotSkill,
      lastStats: {
        winRate:        res.stats.winRate,
        profitFactor:   res.stats.profitFactor,
        sharpeRatio:    res.stats.sharpeRatio,
        netProfitPct:   res.stats.netProfitPct,
        maxDrawdownPct: res.stats.maxDrawdownPct,
        totalTrades:    res.stats.totalTrades,
        testedAt:       new Date().toISOString().split('T')[0],
        timeframe,
        duration,
        asset: ASSET_CONFIGS[asset].label,
      },
    });
    setBotSkills(updated);
  };

  // ── Save the currently-tested config as a NEW local bot (→ My Bot) ──
  const handleSaveAsBot = () => {
    if (!result) { alert('Run a backtest first, then save the result as a bot.'); return; }
    // Presets & starter templates are read-only — and an edited copy of any skill
    // should become a NEW bot, so suggest a fresh name in those cases.
    const isLocked = activeBotSkill && (
      PRESET_SKILLS.some(p => p.name === activeBotSkill.name) ||
      TEMPLATE_SKILLS.some(t => t.name === activeBotSkill.name));
    const suggested = activeBotSkill && !isLocked && !dirty
      ? activeBotSkill.name
      : `${indicator}_${timeframe.toLowerCase()}_${Date.now().toString().slice(-4)}`;
    const input = window.prompt('Save as Bot — name (lowercase letters, numbers, underscores):', suggested);
    if (input == null) return;
    const name = input.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
    if (!name) { alert('Invalid name.'); return; }

    const skill: BotSkillConfig = {
      name,
      description: activeBotSkill?.description
        || `${indicator} · ${direction} · TP${takeProfitPct}/SL${stopLossPct} · ${leverage}x (saved from backtest)`,
      version: '1.0.0',
      createdAt: new Date().toISOString(),
      signal: indicator,
      filters: filters.length ? filters : undefined,
      direction,
      takeProfitPct, stopLossPct, trailingStopPct, enableTrailing, enableDefense,
      leverage, orderPct, commission,
      // Tunable entry-indicator inputs (now editable in the form).
      emaFast, emaSlow, maFast, maSlow,
      rsiPeriod, rsiOversold, rsiOverbought, bbPeriod, bbStdDev,
      supertrendPeriod:    stPeriod,
      supertrendMult:      stMult,
      breakoutPeriod:      bkPeriod,
      maxBarsInTrade:      activeBotSkill?.maxBarsInTrade,
      htfMinutes:          activeBotSkill?.htfMinutes,
      htfSupertrendPeriod: activeBotSkill?.htfSupertrendPeriod,
      htfSupertrendMult:   activeBotSkill?.htfSupertrendMult,
      sizingMode:          activeBotSkill?.sizingMode,
      riskPct:             activeBotSkill?.riskPct,
      breakEvenTriggerPct: activeBotSkill?.breakEvenTriggerPct,
      cooldownBars:        activeBotSkill?.cooldownBars,
      maxConsecLosses:     activeBotSkill?.maxConsecLosses,
      maxDailyLossPct:     activeBotSkill?.maxDailyLossPct,
      sessionStartHour:    activeBotSkill?.sessionStartHour,
      sessionEndHour:      activeBotSkill?.sessionEndHour,
      slippagePct:         activeBotSkill?.slippagePct,
      authorAddress:       account?.address || activeBotSkill?.authorAddress,
      preferredTimeframe:  timeframe,
      preferredAsset:      asset,
      lastStats: {
        winRate:        result.stats.winRate,
        profitFactor:   result.stats.profitFactor,
        sharpeRatio:    result.stats.sharpeRatio,
        netProfitPct:   result.stats.netProfitPct,
        maxDrawdownPct: result.stats.maxDrawdownPct,
        totalTrades:    result.stats.totalTrades,
        testedAt:       new Date().toISOString().split('T')[0],
        timeframe,
        duration,
        asset: ASSET_CONFIGS[asset].label,
      },
    };
    const updated = upsertBotSkill(skill);
    setBotSkills(updated);
    setActiveBotSkill(skill);
    alert(`✅ Saved bot "${name}" locally.\n\nFind it in Autobots Factory → 📦 My Bot, where you can publish it to the marketplace.`);
  };

  // ── Load data ──────────────────────────────────────────────────────
  useEffect(() => {
    setIsLoading(true);
    setResult(null);
    const url = ASSET_CONFIGS[asset].file(timeframe, year);
    fetch(url)
      .then(r => r.json())
      .then((d: Candle[]) => {
        setBtcData(d);              // real dates as-is (2025 file = 2025, 2026 file = 2026)
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, [timeframe, asset, year]);

  // ── Filtered data by duration (single calendar month or full dataset) ──
  const filteredData = useMemo(() => {
    if (duration.startsWith('m')) {
      const mm = String(parseInt(duration.slice(1))).padStart(2, '0');
      return btcData.filter(c => c.date.slice(5, 7) === mm);
    }
    if (duration === 'all') return btcData;
    if (btcData.length === 0) return [];
    const TF: Record<string, number> = { D1: 1, H4: 6, H1: 24, M30: 48, M15: 96, M5: 288 };
    const cpd = TF[timeframe] || 1;
    if (duration === '1m')  return btcData.slice(0, Math.min(btcData.length, 31 * cpd + 30));
    if (duration === '2m')  return btcData.slice(0, Math.min(btcData.length, 59 * cpd + 30));
    if (duration === '3m')  return btcData.slice(0, Math.min(btcData.length, 90 * cpd + 30));
    return btcData;
  }, [btcData, duration, timeframe]);

  // ── Build config ──
  const cfg: BacktestConfig = {
    initialCapital, leverage, orderPct, commission,
    takeProfitPct, stopLossPct, trailingStopPct,
    enableTrailing, enableDefense, indicator, direction,
    filters: filters.length ? filters : undefined,
    emaFast, emaSlow, maFast, maSlow,
    rsiPeriod, rsiOversold, rsiOverbought, bbPeriod, bbStdDev,
    supertrendPeriod: stPeriod, supertrendMult: stMult, breakoutPeriod: bkPeriod,
  };

  // ── Run backtest (instant) ──────────────────────────────────────────
  const handleRun = useCallback(() => {
    if (filteredData.length < 35) return;
    setIsRunning(true);
    // Dùng setTimeout(0) để UI cập nhật loading indicator trước
    setTimeout(() => {
      const res = runBacktest(filteredData, cfg);
      setResult(res);
      setReplayIdx(30);
      setIsPlaying(false);
      setIsRunning(false);
      // Auto-save stats to the Bot Skill if active
      // Only write stats back to the loaded skill when it's unchanged — once the
      // user edits, the config has diverged so the stats no longer describe it.
      if (activeBotSkill && !dirty) saveStatsToBotSkill(res);
    }, 10);
  }, [filteredData, cfg, activeBotSkill, dirty]);

  // ── Draw chart ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!result || !canvasRef.current || filteredData.length === 0) return;
    const idx = mode === 'replay' ? replayIdx : filteredData.length - 1;
    drawChart(canvasRef.current, filteredData, result, mode === 'replay' ? idx : -1, cfg);
  }, [result, replayIdx, mode, filteredData]);

  // Resize observer to redraw when the container changes size
  useEffect(() => {
    if (!canvasRef.current || !result) return;
    const ro = new ResizeObserver(() => {
      if (!canvasRef.current || !result) return;
      const idx = mode === 'replay' ? replayIdx : filteredData.length - 1;
      drawChart(canvasRef.current, filteredData, result, mode === 'replay' ? idx : -1, cfg);
    });
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [result, mode, replayIdx, filteredData]);

  // ── Replay controls ────────────────────────────────────────────────
  const stopReplay = useCallback(() => {
    if (replayTimer.current) { clearInterval(replayTimer.current); replayTimer.current = null; }
    setIsPlaying(false);
  }, []);

  const startReplay = useCallback(() => {
    if (!result) return;
    setIsPlaying(true);
    replayTimer.current = setInterval(() => {
      setReplayIdx(prev => {
        const next = prev + 1;
        if (next >= filteredData.length) { stopReplay(); return prev; }
        return next;
      });
    }, replaySpeed);
  }, [result, filteredData.length, replaySpeed, stopReplay]);

  useEffect(() => { return () => stopReplay(); }, [stopReplay]);

  const handlePlayPause = () => { isPlaying ? stopReplay() : startReplay(); };
  const handleNextCandle = () => {
    if (replayIdx < filteredData.length - 1) setReplayIdx(r => r + 1);
  };
  const handleReplayReset = () => { stopReplay(); setReplayIdx(30); };

  // ── Active candle info for replay ──
  const currentCandle = filteredData[mode === 'replay' ? replayIdx : filteredData.length - 1];

  // ── Sorted trades ──
  const displayTrades = useMemo(() => {
    if (!result) return [];
    const t = [...result.trades];
    if (sortBy === 'profit') t.sort((a, b) => b.profitVal - a.profitVal);
    return t;
  }, [result, sortBy]);

  // ── Toggle switch component ──
  const Toggle = ({ val, onToggle, color = '#10b981' }: { val: boolean; onToggle: () => void; color?: string }) => (
    <button onClick={onToggle} style={{
      width: 34, height: 18, borderRadius: 9, border: 'none',
      background: val ? color : '#334155', cursor: 'pointer', position: 'relative', flexShrink: 0,
    }}>
      <div style={{
        width: 14, height: 14, borderRadius: '50%', background: '#fff',
        position: 'absolute', top: 2, left: val ? 18 : 2, transition: 'left 0.15s',
      }} />
    </button>
  );

  const s = result?.stats;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 0,
      background: '#060e1e', minHeight: '100vh',
      fontFamily: "'Inter', monospace, sans-serif",
    }}>

      {/* ── HEADER ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 20px', background: '#0a101d', borderBottom: '1px solid #1e293b',
      }}>
        <div>
          <h3 style={{ margin: 0, color: '#10b981', fontSize: '1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            📊 STRATEGY TESTER — MT5 Style
          </h3>
          <p style={{ margin: 0, color: '#475569', fontSize: '0.72rem', marginTop: 2 }}>
            Pure Engine · Instant Compute · Visual Replay ·{' '}
            <span style={{ color: ASSET_CONFIGS[asset].color, fontWeight: 700 }}>
              {ASSET_CONFIGS[asset].flag} {ASSET_CONFIGS[asset].label}
            </span>
            {' · '}{ASSET_CONFIGS[asset].period}
          </p>
        </div>

        {/* Mode Tabs */}
        <div style={{ display: 'flex', gap: 4, background: '#0f172a', padding: 4, borderRadius: 10, border: '1px solid #1e293b' }}>
          {(['instant', 'replay'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              padding: '6px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700,
              background: mode === m ? (m === 'instant' ? '#10b981' : '#6366f1') : 'transparent',
              color: mode === m ? '#fff' : '#64748b',
            }}>
              {m === 'instant' ? '⚡ Instant' : '▶ Visual Replay'}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {activeBotSkill && (
            <span style={{
              background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.3)',
              borderRadius: 6, padding: '3px 8px', fontSize: '0.68rem', fontWeight: 700,
            }}>
              🤖 {activeBotSkill.name}
            </span>
          )}
          {result && (
            <div style={{ fontSize: '0.7rem', color: '#475569', fontFamily: 'monospace' }}>
              ⏱ <strong style={{ color: '#10b981' }}>{result.durationMs}ms</strong>
              {' · '}{filteredData.length.toLocaleString()} candles
            </div>
          )}
        </div>
      </div>

      {/* ── MAIN LAYOUT ── */}
      <div style={{ display: 'flex', flex: 1, gap: 0 }}>

        {/* ── LEFT CONFIG PANEL ── */}
        <div style={{
          width: 220, flexShrink: 0, background: '#080d1a', borderRight: '1px solid #1e293b',
          padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 14, overflowY: 'auto',
        }}>

          {/* Asset & Timeframe & Duration */}
          <section>
            <div style={{ fontSize: '0.62rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>📅 Data</div>

            {/* Asset Picker — BTC vs SUI */}
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: '0.68rem', color: '#64748b', display: 'block', marginBottom: 4 }}>Asset</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {(Object.entries(ASSET_CONFIGS) as [AssetKey, typeof ASSET_CONFIGS[AssetKey]][]).map(([key, cfg]) => {
                  // BTC unlocked — full-year 2025 M5/M15/M30/H1 datasets now ship with the site
                  const isBlocked = false;
                  return (
                  <button key={key} disabled={isBlocked} onClick={() => { if (!isBlocked) { setAsset(key); setResult(null); } }} style={{
                    flex: 1, padding: '7px 4px', borderRadius: 7,
                    border: `1px solid ${asset === key ? cfg.color + '66' : '#1e293b'}`,
                    background: asset === key ? cfg.color + '18' : 'transparent',
                    color: isBlocked ? '#334155' : (asset === key ? cfg.color : '#475569'),
                    cursor: isBlocked ? 'not-allowed' : 'pointer', fontSize: '0.72rem', fontWeight: asset === key ? 700 : 400,
                    opacity: isBlocked ? 0.5 : 1,
                  }}>
                    {cfg.flag} {cfg.label.split('/')[0]} {isBlocked ? '🔒' : ''}
                  </button>
                )})}
              </div>
              <div style={{ fontSize: '0.6rem', color: '#334155', marginTop: 3, textAlign: 'center' }}>
                {ASSET_CONFIGS[asset].period}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* Timeframe — only M15 / M30 / H1 */}
              <div>
                <label style={{ fontSize: '0.68rem', color: '#64748b' }}>Timeframe</label>
                <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                  {TF_OPTIONS_BACKTEST.map(([v, l]) => (
                    <button key={v} onClick={() => setTimeframe(v)} style={{
                      flex: 1, padding: '5px 0', borderRadius: 6, fontSize: '0.72rem', fontWeight: timeframe === v ? 700 : 400,
                      border: `1px solid ${timeframe === v ? '#10b981' : '#1e293b'}`,
                      background: timeframe === v ? 'rgba(16,185,129,0.15)' : 'transparent',
                      color: timeframe === v ? '#10b981' : '#475569', cursor: 'pointer',
                    }}>{l}</button>
                  ))}
                </div>
              </div>
              {/* Year — 2025 (full) or 2026 (real Jan–May) */}
              <div>
                <label style={{ fontSize: '0.68rem', color: '#64748b' }}>Year</label>
                <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                  {(['2025', '2026'] as const).map(y => (
                    <button key={y} onClick={() => {
                      setYear(y); setResult(null);
                      // clamp month if the new year has fewer months
                      const max = MONTHS_BY_YEAR[y];
                      if (duration.startsWith('m') && parseInt(duration.slice(1)) > max) setDuration('m1');
                    }} style={{
                      flex: 1, padding: '5px 2px', borderRadius: 6,
                      border: `1px solid ${year === y ? '#00d4ff' : '#1e293b'}`,
                      background: year === y ? 'rgba(0,212,255,0.12)' : 'transparent',
                      color: year === y ? '#00d4ff' : '#475569', fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
                    }}>{y}{y === '2026' ? ' · Jan–May' : ''}</button>
                  ))}
                </div>
              </div>

              {/* Range — pick a single calendar month (each tested standalone) */}
              <div>
                <label style={{ fontSize: '0.68rem', color: '#64748b' }}>Month</label>
                <select value={duration} onChange={e => { setDuration(e.target.value as any); setResult(null); }}
                  style={{ width: '100%', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, padding: '5px 8px', color: '#e2e8f0', fontSize: '0.75rem', marginTop: 3 }}>
                  {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].slice(0, MONTHS_BY_YEAR[year]).map((m, i) => (
                    <option key={m} value={`m${i + 1}`}>{m} {year}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* Bot Skills Selector */}
          {botSkills.length > 0 && (
            <section style={{ background: 'rgba(99,102,241,0.06)', borderRadius: 8, padding: 10, border: '1px solid rgba(99,102,241,0.2)' }}>
              <div style={{ fontSize: '0.62rem', color: '#818cf8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>🤖 Bot Skills</div>
              <select
                value={activeBotSkill?.name ?? ''}
                onChange={e => {
                  const s = botSkills.find(x => x.name === e.target.value);
                  if (s) applyBotSkill(s);
                  else { setActiveBotSkill(null); }
                }}
                style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 6, padding: '5px 8px', color: '#e2e8f0', fontSize: '0.73rem' }}
              >
                <option value=''>— Select Bot Skill —</option>
                {botSkills.map(s => (
                  <option key={s.name} value={s.name}>
                    🤖 {s.name}{s.lastStats ? ` (WR ${s.lastStats.winRate}%)` : ''}
                  </option>
                ))}
              </select>
              {activeBotSkill && (
                <div style={{ marginTop: 6, fontSize: '0.65rem', color: dirty ? '#f59e0b' : '#6366f1', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{dirty ? `✎ ${activeBotSkill.name} · edited (Save makes a new bot)` : `✅ ${activeBotSkill.name}`}</span>
                  <button onClick={() => { setActiveBotSkill(null); setDirty(false); }}
                    style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: '0.65rem' }}>✕</button>
                </div>
              )}
            </section>
          )}

          {/* Indicator */}
          <section>
            <div style={{ fontSize: '0.62rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>📡 Indicator</div>
            <select value={indicator} onChange={e => { setIndicator(e.target.value as IndicatorType); setDirty(true); }}
              style={{ width: '100%', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, padding: '5px 8px', color: '#e2e8f0', fontSize: '0.73rem' }}>
              {(Object.entries(INDICATOR_LABELS) as [IndicatorType, string][]).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            {/* Indicator parameters (editable, per selected indicator) */}
            {(() => { const chg = (s: (n: number) => void) => (n: number) => { s(n); setDirty(true); }; return (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 5, background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 6, padding: '8px 10px' }}>
              {indicator === 'ema_cross' && (<><ParamRow label="Fast EMA" value={emaFast} onChange={chg(setEmaFast)} /><ParamRow label="Slow EMA" value={emaSlow} onChange={chg(setEmaSlow)} /></>)}
              {indicator === 'ma_cross' && (<><ParamRow label="Fast SMA" value={maFast} onChange={chg(setMaFast)} /><ParamRow label="Slow SMA" value={maSlow} onChange={chg(setMaSlow)} /></>)}
              {indicator === 'rsi' && (<><ParamRow label="RSI period" value={rsiPeriod} onChange={chg(setRsiPeriod)} /><ParamRow label="Oversold" value={rsiOversold} onChange={chg(setRsiOversold)} /><ParamRow label="Overbought" value={rsiOverbought} onChange={chg(setRsiOverbought)} /></>)}
              {indicator === 'bb' && (<><ParamRow label="BB period" value={bbPeriod} onChange={chg(setBbPeriod)} /><ParamRow label="Std Dev (σ)" value={bbStdDev} onChange={chg(setBbStdDev)} step={0.1} /></>)}
              {(indicator === 'supertrend' || indicator === 'supertrend_flip') && (<><ParamRow label="ATR period" value={stPeriod} onChange={chg(setStPeriod)} /><ParamRow label="Multiplier" value={stMult} onChange={chg(setStMult)} step={0.1} /></>)}
              {indicator === 'range_breakout' && <ParamRow label="Breakout bars" value={bkPeriod} onChange={chg(setBkPeriod)} />}
              {indicator === 'macd' && <div style={{ fontSize: '0.6rem', color: '#475569' }}>MACD 12 / 26 / 9 (standard)</div>}
              {indicator === 'rsi_macd' && <div style={{ fontSize: '0.6rem', color: '#475569' }}>RSI 14 + MACD 12/26/9 hybrid</div>}
            </div>
            ); })()}
            {/* Direction filter */}
            <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
              {(['both','long_only','short_only'] as const).map(d => (
                <button key={d} onClick={() => setDirection(d)} style={{
                  flex: 1, padding: '4px 2px', borderRadius: 5, border: `1px solid ${direction === d ? '#6366f1' : '#1e293b'}`,
                  background: direction === d ? 'rgba(99,102,241,0.15)' : 'transparent',
                  color: direction === d ? '#818cf8' : '#334155', fontSize: '0.6rem', cursor: 'pointer',
                }}>
                  {d === 'both' ? '↕' : d === 'long_only' ? '↑ Long' : '↓ Short'}
                </button>
              ))}
            </div>
          </section>

          {/* Entry Filters (EA-style 1 entry + N filters AND) */}
          <section>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: '0.62rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>🧩 Entry Filters · AND</span>
              <button
                onClick={() => { setFilters(f => [...f, { id: `f${f.length}_${Date.now().toString().slice(-4)}`, indicator: 'adx', period: 14, op: '>', value: 25 }]); setDirty(true); }}
                style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid #6366f1', color: '#818cf8', borderRadius: 5, padding: '2px 8px', fontSize: '0.62rem', cursor: 'pointer', fontWeight: 700 }}>
                + Add
              </button>
            </div>
            {filters.length === 0 && (
              <div style={{ fontSize: '0.62rem', color: '#475569', fontStyle: 'italic' }}>No filters — the entry signal fires alone. Add filters to gate entries (e.g. ADX&gt;25, price above SMA200).</div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filters.map((f, idx) => {
                const meta = FILTER_META[f.indicator];
                const update = (patch: Partial<FilterBlock>) => { setFilters(arr => arr.map((x, i) => i === idx ? { ...x, ...patch } : x)); setDirty(true); };
                const ops: FilterOp[] = meta.kind === 'ma' ? ['align', 'against'] : ['>', '<'];
                return (
                  <div key={f.id} style={{ background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 6, padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <select value={f.indicator} onChange={e => { const ni = e.target.value as FilterIndicator; const m = FILTER_META[ni]; update({ indicator: ni, period: m.defPeriod, op: m.kind === 'ma' ? 'align' : '>', value: m.defValue }); }}
                        style={{ flex: 1, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 5, padding: '3px 5px', color: '#e2e8f0', fontSize: '0.66rem' }}>
                        {(Object.keys(FILTER_META) as FilterIndicator[]).map(k => <option key={k} value={k}>{FILTER_META[k].label}</option>)}
                      </select>
                      <button onClick={() => { setFilters(arr => arr.filter((_, i) => i !== idx)); setDirty(true); }}
                        style={{ background: 'transparent', border: '1px solid #7f1d1d', color: '#ef4444', borderRadius: 5, padding: '2px 7px', fontSize: '0.7rem', cursor: 'pointer' }}>✕</button>
                    </div>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      {meta.hasPeriod && (
                        <input type="number" value={f.period} title="Period" onChange={e => update({ period: Math.max(2, parseInt(e.target.value) || 2) })}
                          style={{ width: 52, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 5, padding: '3px 5px', color: '#e2e8f0', fontSize: '0.66rem' }} />
                      )}
                      <select value={f.op} onChange={e => update({ op: e.target.value as FilterOp })}
                        style={{ flex: meta.kind === 'ma' ? 1 : 'none', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 5, padding: '3px 5px', color: '#e2e8f0', fontSize: '0.66rem' }}>
                        {ops.map(o => <option key={o} value={o}>{o === 'align' ? 'price aligned (trend)' : o === 'against' ? 'price against' : o}</option>)}
                      </select>
                      {meta.kind === 'osc' && (
                        <input type="number" value={f.value ?? 0} title="Threshold" onChange={e => update({ value: parseFloat(e.target.value) || 0 })}
                          style={{ width: 64, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 5, padding: '3px 5px', color: '#e2e8f0', fontSize: '0.66rem' }} />
                      )}
                      <span style={{ fontSize: '0.55rem', color: '#475569', flex: 1, textAlign: 'right' }}>{meta.hint}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Defense */}
          <section>
            <div style={{ fontSize: '0.62rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>🛡️ Protection</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>TP/SL/Liq</span>
                <Toggle val={enableDefense} onToggle={() => setEnableDefense(v => !v)} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Trailing Stop</span>
                <Toggle val={enableTrailing} onToggle={() => setEnableTrailing(v => !v)} color='#00d4ff' />
              </div>
              {[
                ['Take Profit', takeProfitPct, setTakeProfitPct, '%'],
                ['Stop Loss',   stopLossPct,   setStopLossPct,   '%'],
                ['Trailing',    trailingStopPct, setTrailingStopPct, '%'],
              ].map(([label, val, setter, unit]: any) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ flex: 1, fontSize: '0.68rem', color: '#64748b' }}>{label}</span>
                  <input type="number" value={val} onChange={e => setter(Math.max(0.1, parseFloat(e.target.value)||0))}
                    style={{ width: 52, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 5, padding: '4px 6px', color: '#fff', fontSize: '0.75rem', textAlign: 'center' }} />
                  <span style={{ fontSize: '0.68rem', color: '#475569' }}>{unit}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Capital */}
          <section>
            <div style={{ fontSize: '0.62rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>💰 Capital & Leverage</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <label style={{ fontSize: '0.68rem', color: '#64748b' }}>Capital ($)</label>
                <input type="number" value={initialCapital}
                  onChange={e => setInitialCapital(Math.max(100, parseInt(e.target.value)||100))}
                  style={{ width: '100%', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, padding: '5px 8px', color: '#fff', fontSize: '0.75rem', marginTop: 3 }} />
              </div>
              {[
                ['Leverage', leverage, setLeverage, [[1,'1x'],[3,'3x'],[5,'5x'],[10,'10x'],[20,'20x']]],
                ['Order Size', orderPct, setOrderPct, [[25,'25%'],[50,'50%'],[100,'100%']]],
              ].map(([label, val, setter, opts]: any) => (
                <div key={label}>
                  <label style={{ fontSize: '0.68rem', color: '#64748b' }}>{label}</label>
                  <select value={val} onChange={e => setter(parseInt(e.target.value))}
                    style={{ width: '100%', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, padding: '5px 8px', color: '#e2e8f0', fontSize: '0.75rem', marginTop: 3 }}>
                    {opts.map(([v, l]: any) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              ))}
              <div>
                <label style={{ fontSize: '0.68rem', color: '#64748b' }}>Fee (%/side)</label>
                <input type="number" step="0.01" value={commission}
                  onChange={e => setCommission(Math.max(0, parseFloat(e.target.value)||0))}
                  style={{ width: '100%', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, padding: '5px 8px', color: '#fff', fontSize: '0.75rem', marginTop: 3 }} />
              </div>
            </div>
          </section>

          {/* Run Button */}
          <button
            onClick={handleRun}
            disabled={isLoading || isRunning || filteredData.length < 35}
            style={{
              padding: '11px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: isLoading || isRunning
                ? '#1e293b'
                : 'linear-gradient(135deg, #10b981, #059669)',
              color: '#fff', fontWeight: 800, fontSize: '0.85rem',
              boxShadow: '0 4px 12px rgba(16,185,129,0.3)',
            }}
          >
            {isLoading ? '⏳ Loading...' : isRunning ? '⚙️ Computing...' : '⚡ RUN BACKTEST'}
          </button>

          {/* Save the tested config as a local bot → My Bot */}
          <button
            onClick={handleSaveAsBot}
            disabled={!result}
            title={result ? 'Save these settings as a bot in My Bot' : 'Run a backtest first'}
            style={{
              padding: '10px', borderRadius: 8, cursor: result ? 'pointer' : 'not-allowed',
              border: `1px solid ${result ? '#818cf8' : '#1e293b'}`,
              background: result ? 'rgba(99,102,241,0.1)' : 'transparent',
              color: result ? '#818cf8' : '#475569', fontWeight: 700, fontSize: '0.8rem',
            }}
          >
            💾 Save as Bot {result ? '→ My Bot' : ''}
          </button>

          {/* Replay speed (replay mode only) */}
          {mode === 'replay' && (
            <div>
              <label style={{ fontSize: '0.68rem', color: '#64748b' }}>Replay speed</label>
              <select value={replaySpeed} onChange={e => { stopReplay(); setReplaySpeed(parseInt(e.target.value)); }}
                style={{ width: '100%', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, padding: '5px 8px', color: '#e2e8f0', fontSize: '0.75rem', marginTop: 3 }}>
                <option value={500}>Slow (0.5s)</option>
                <option value={200}>Average (0.2s)</option>
                <option value={80}>Nhanh (0.08s)</option>
                <option value={20}>Turbo (0.02s)</option>
              </select>
            </div>
          )}
        </div>

        {/* ── RIGHT CONTENT ── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Replay Controls Bar */}
          {mode === 'replay' && result && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px',
              background: '#0a0f1d', borderBottom: '1px solid #1e293b',
            }}>
              <button onClick={handlePlayPause} style={{
                padding: '7px 18px', borderRadius: 7, border: 'none', cursor: 'pointer',
                background: isPlaying ? 'linear-gradient(135deg,#f59e0b,#d97706)' : 'linear-gradient(135deg,#6366f1,#4f46e5)',
                color: '#fff', fontWeight: 700, fontSize: '0.78rem',
              }}>
                {isPlaying ? '⏸ Pause' : '▶ Play'}
              </button>
              <button onClick={handleNextCandle} disabled={isPlaying || replayIdx >= filteredData.length - 1}
                style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: '0.78rem', cursor: 'pointer' }}>
                ⏭ +1
              </button>
              <button onClick={handleReplayReset}
                style={{ padding: '7px 12px', borderRadius: 7, border: '1px solid #ef444433', background: 'transparent', color: '#ef4444', fontSize: '0.78rem', cursor: 'pointer' }}>
                🔄 Reset
              </button>

              {/* Progress bar */}
              <div style={{ flex: 1, height: 4, background: '#1e293b', borderRadius: 2, position: 'relative' }}>
                <div style={{
                  height: '100%', borderRadius: 2, background: '#6366f1',
                  width: `${((replayIdx - 30) / Math.max(filteredData.length - 31, 1)) * 100}%`,
                  transition: 'width 0.08s linear',
                }} />
              </div>

              {currentCandle && (
                <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                  📅 {currentCandle.date} &nbsp;
                  💲 <span style={{ color: '#00d4ff' }}>${currentCandle.close.toLocaleString()}</span> &nbsp;
                  <span style={{ color: '#475569' }}>{replayIdx}/{filteredData.length - 1}</span>
                </div>
              )}
            </div>
          )}

          {/* Chart Canvas */}
          <div style={{ flex: '0 0 420px', position: 'relative', background: '#060e1e', borderBottom: '1px solid #1e293b' }}>
            {!result && !isRunning && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexDirection: 'column', gap: 12, color: '#334155',
              }}>
                <div style={{ fontSize: '2.5rem' }}>📊</div>
                <div style={{ fontSize: '0.85rem', fontWeight: 600 }}>Configure and press ⚡ RUN BACKTEST</div>
                <div style={{ fontSize: '0.72rem', color: '#1e293b' }}>{filteredData.length.toLocaleString()} candles loaded ({ASSET_CONFIGS[asset].label} · {timeframe})</div>
              </div>
            )}
            {isRunning && (
              <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(6,14,30,0.85)', zIndex: 10,
              }}>
                <div style={{ color: '#10b981', fontSize: '0.9rem', fontWeight: 700 }}>
                  ⚙️ Computing {filteredData.length.toLocaleString()} candles...
                </div>
              </div>
            )}
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
          </div>

          {/* ── STATS GRID (MT5-style) ── */}
          {result && s && (
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #1e293b' }}>
              {/* Equity curve + drawdown */}
              {result.equityByIndex && result.equityByIndex.length > 1 && (
                <div style={{ marginBottom: 12 }}>
                  <EquityCurve equity={result.equityByIndex} initialCapital={initialCapital} maxDdPct={s.maxDrawdownPct} />
                </div>
              )}
              {/* Row 1: Performance */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 8 }}>
                <StatCard label="Net Profit" color={s.netProfitVal >= 0 ? '#10b981' : '#ef4444'}
                  value={`${s.netProfitVal >= 0 ? '+' : ''}$${s.netProfitVal.toLocaleString()}`}
                  sub={`${s.netProfitPct}% vs capital`} />
                <StatCard label="Gross Profit" color="#22c55e" value={`+$${s.grossProfit.toLocaleString()}`} sub={`${s.winTrades} winning trades`} />
                <StatCard label="Gross Loss"   color="#ef4444" value={`-$${s.grossLoss.toLocaleString()}`} sub={`${s.lossTrades} losing trades`} />
                <StatCard label="Profit Factor" color={s.profitFactor >= 1.5 ? '#10b981' : s.profitFactor >= 1 ? '#f59e0b' : '#ef4444'}
                  value={s.profitFactor === 999 ? '∞' : s.profitFactor} sub="Gross P/L" />
                <StatCard label="Expectancy" color={s.expectancy >= 0 ? '#10b981' : '#ef4444'}
                  value={`$${s.expectancy}`} sub="Expectancy/trade" />
              </div>
              {/* Row 2: Risk & Stats */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                <StatCard label="Win Rate" color={s.winRate >= 55 ? '#10b981' : s.winRate >= 45 ? '#f59e0b' : '#ef4444'}
                  value={`${s.winRate}%`} sub={`${s.totalTrades} total trades`} />
                <StatCard label="Max Drawdown" color={s.maxDrawdownPct <= 15 ? '#10b981' : '#ef4444'}
                  value={`${s.maxDrawdownPct}%`} sub={`-$${s.maxDrawdownVal.toLocaleString()}`} />
                <StatCard label="Sharpe Ratio" color={s.sharpeRatio >= 1 ? '#10b981' : s.sharpeRatio >= 0 ? '#f59e0b' : '#ef4444'}
                  value={s.sharpeRatio} sub="Annualized" />
                <StatCard label="Max Consec." color="#a78bfa"
                  value={`${s.maxConsecWins}W / ${s.maxConsecLosses}L`} sub="Max consec. W/L" />
                <StatCard label="Trading fee" color="#64748b"
                  value={`-$${s.totalCommission}`} sub={`${s.longTrades}L ${s.shortTrades}S`} />
              </div>
            </div>
          )}

          {/* ── TRADE LIST ── */}
          {result && result.trades.length > 0 && (
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 16px', borderBottom: '1px solid #1e293b',
              }}>
                <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 700 }}>
                  📋 TRADE LIST ({result.trades.length} trades)
                </span>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[['id','By Time'],['profit','By P&L']].map(([v, l]) => (
                    <button key={v} onClick={() => setSortBy(v as any)} style={{
                      padding: '3px 10px', borderRadius: 5, border: '1px solid #1e293b',
                      background: sortBy === v ? '#1e293b' : 'transparent',
                      color: sortBy === v ? '#e2e8f0' : '#475569', fontSize: '0.7rem', cursor: 'pointer',
                    }}>{l}</button>
                  ))}
                </div>
              </div>

              <div style={{ overflowY: 'auto', flex: 1 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem', fontFamily: 'monospace' }}>
                  <thead style={{ position: 'sticky', top: 0 }}>
                    <tr style={{ background: '#0a0f1d', color: '#475569', borderBottom: '1px solid #1e293b' }}>
                      {['#','Type','Entry','Entry price','Exit','Exit price','Reason','P&L ($)','P&L (%)'].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: h === 'P&L ($)' || h === 'P&L (%)' ? 'right' : 'left', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {displayTrades.map(t => {
                      const isWin = t.profitVal > 0;
                      return (
                        <tr key={t.id} style={{ borderBottom: '1px solid #0d1525', color: '#cbd5e1' }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#0a0f1d')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                          <td style={{ padding: '7px 10px', color: '#475569' }}>#{t.id}</td>
                          <td style={{ padding: '7px 10px', color: t.type === 'LONG' ? '#22c55e' : '#f87171', fontWeight: 700 }}>{t.type}</td>
                          <td style={{ padding: '7px 10px', color: '#64748b' }}>{t.entryDate}</td>
                          <td style={{ padding: '7px 10px' }}>${t.entryPrice.toLocaleString()}</td>
                          <td style={{ padding: '7px 10px', color: '#64748b' }}>{t.exitDate}</td>
                          <td style={{ padding: '7px 10px' }}>${t.exitPrice.toLocaleString()}</td>
                          <td style={{ padding: '7px 10px' }}>
                            <span style={{
                              background: `${EXIT_COLORS[t.exitReason]}22`,
                              color: EXIT_COLORS[t.exitReason],
                              padding: '2px 7px', borderRadius: 4, fontWeight: 700, fontSize: '0.68rem',
                            }}>{t.exitReason}</span>
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'right', color: isWin ? '#22c55e' : '#f87171', fontWeight: 700 }}>
                            {isWin ? '+' : ''}{t.profitVal.toLocaleString()}
                          </td>
                          <td style={{ padding: '7px 10px', textAlign: 'right', color: isWin ? '#22c55e' : '#f87171' }}>
                            {t.profitPct}%
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Empty state */}
          {result && result.trades.length === 0 && (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: '2rem' }}>🤷</div>
              <div>No trades — try a different indicator or adjust TP/SL</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
