/**
 * LiveTradeDashboard — Hai mode bot rõ ràng:
 *
 *  🤖 AI Auto Bot  — Bot phát signal → Agent AI tạo orders → Frontend ký xác nhận
 *  ⚡ Auto Bot      — Bot phát signal → Ký keypair → Execute thẳng Sui (không cần AI, không confirm)
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSignAndExecuteTransaction, useCurrentAccount, useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { DeepBookClient } from '@mysten/deepbook-v3';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { IS_DESKTOP } from '../platform';

// Native OS notification for bot trade events — works natively in the Electron
// desktop app; on the web it asks for permission once. Silent no-op if blocked.
let __notifyAsked = false;
function notify(title: string, body: string) {
  try {
    if (!getNotifyEnabled()) return;            // user turned trade alerts off in Settings
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') { new Notification(title, { body }); return; }
    if (Notification.permission !== 'denied' && !__notifyAsked) {
      __notifyAsked = true;
      Notification.requestPermission().then(p => { if (p === 'granted') new Notification(title, { body }); }).catch(() => {});
    }
  } catch { /* no-op */ }
}

/** Pick the wallet's margin manager that belongs to the SUI/USDC pool.
 *  A wallet can own managers from multiple pools — using the wrong one
 *  triggers TypeMismatch on chain. Returns null if no SUI_USDC manager exists. */
const SUI_TYPE_FULL  = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const USDC_TYPE_FULL = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
async function pickSuiUsdcManager(suiClient: any, managerIds: string[]): Promise<string | null> {
  for (const id of managerIds) {
    try {
      const obj = await suiClient.getObject({ id, options: { showType: true } });
      const type: string = obj?.data?.type ?? '';
      console.log('[LT·pickSuiUsdcManager] id=', id, 'type=', type);
      // Substring match handles BOTH short (`0x2::sui::SUI`) and canonical
      // (`0x00…02::sui::SUI`) address forms — Sui RPC may return either.
      const isMarginManager = /::margin_manager::MarginManager</.test(type);
      const hasSui  = /::sui::SUI[,>]/.test(type);
      const hasUsdc = /::usdc::USDC[,>]/.test(type);
      if (isMarginManager && hasSui && hasUsdc) {
        console.log('[LT·pickSuiUsdcManager] ✓ MATCH', id);
        return normalizeSuiAddress(id);
      }
    } catch (e) {
      console.warn('[LT·pickSuiUsdcManager] getObject failed', id, e);
    }
  }
  return null;
}
import { loadBotSkills, PRESET_SKILLS, type BotSkillConfig, SIGNAL_LABELS } from '../types/botSkill';
import type { LiveBotConfig } from '../../server/live_trade_agent';
import { AGENT_URL, AGENT_WS_URL } from '../agent/agentUrl';
import { useUserConfig } from '../hooks/useUserConfig';
import { usePythOracle } from '../hooks/usePythOracle';
import { getMarginManagerDetail, pickBestSuiUsdcManager } from '../utils/marginDetail';
import { getNotifyEnabled } from '../prefs';

// ─── Types ─────────────────────────────────────────────────────────────────────

type BotMode = 'ai_agent' | 'direct';

interface BotState {
  active:      boolean;
  mode:        BotMode;
  config:      any;
  position:    ActivePos | null;
  price:       number;
  signal:      'BUY' | 'SELL' | 'HOLD';
  indicators:  Indicators;
  tradeCount:  number;
  totalPnl:    number;
  logs:        LogEntry[];
  lastUpdate:  string;
}
interface ActivePos {
  type: 'LONG' | 'SHORT'; entryPrice: number; entryTime: string;
  tpPrice: number; slPrice: number; borrowAsset: string; borrowAmount: number;
  unrealizedPnl: number; unrealizedPct: number;
}
interface Indicators { rsi: number; ema9: number; ema21: number; macdHist: number; bbUpper: number; bbLower: number; }
interface LogEntry { id: number; time: string; type: 'info'|'signal'|'trade'|'error'|'warning'; msg: string; price?: number; pnl?: number; txDigest?: string; }

// Only 3 timeframes for live trading
const TF_OPTIONS = ['5m', '15m', '30m', '1h'];

// Supported trading pairs. BTC/USDC is temporarily under maintenance — blocked
// from Live Trade (not selectable, bot won't trade it) until DeepTrade xBTC is re-enabled.
const PAIR_OPTIONS: { value: string; label: string; tag: string; color: string; disabled?: boolean }[] = [
  { value: 'XBTC_USDC', label: 'BTC/USDC', tag: 'DeepTrade', color: '#f59e0b', disabled: true },
  { value: 'SUI_USDC',  label: 'SUI/USDC', tag: 'DeepBook',  color: '#00d4ff' },
];
const PAIR_LABEL = (p: string) => PAIR_OPTIONS.find(o => o.value === p)?.label ?? p.replace('_', '/');
const isXbtcPair = (p: string) => p === 'XBTC_USDC';
const LOG_COLORS: Record<string,string> = { info:'#64748b', signal:'#00d4ff', trade:'#22c55e', error:'#ef4444', warning:'#f59e0b' };
const LOG_ICONS:  Record<string,string> = { info:'🔍', signal:'📡', trade:'✅', error:'❌', warning:'⚠️' };
const EXIT_REASON_COLORS: Record<string, string> = {
  TP: '#22c55e', SL: '#ef4444', Trailing: '#00d4ff', Signal: '#a78bfa', Manual: '#f59e0b', BE: '#94a3b8', Time: '#64748b',
};

// ─── Mini helpers ─────────────────────────────────────────────────────────────

const Sparkline: React.FC<{ data: number[]; color: string }> = ({ data, color }) => {
  if (data.length < 2) return <div style={{ height: 48 }} />;
  const min = Math.min(...data), max = Math.max(...data), r = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 200},${44 - ((v - min) / r) * 40}`).join(' ');
  return (
    <svg width="100%" viewBox={`0 0 200 48`} preserveAspectRatio="none" style={{ display: 'block', height: 48 }}>
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={pts} />
    </svg>
  );
};

// ─── Live Candlestick Chart ───────────────────────────────────────────────────
// Canvas-drawn candles from the bot's OWN kline feed (/api/livebot/candles),
// overlaid with the open position's Entry/TP/SL lines + ▲▼ trade markers from
// trade history. Same rendering approach as the Backtest chart — no TradingView
// embed, no extra dependency.

interface ChartCandle { date: string; open: number; high: number; low: number; close: number; volume?: number }
interface ChartTradeMark { time: string; side: 'LONG' | 'SHORT'; price: number; isClose?: boolean }

// Which overlay indicators are drawn over the candles (user-toggled).
type OverlayFlags = { ema: boolean; ma: boolean; boll: boolean; st: boolean };

// ── Indicator math — computed client-side from the SAME candles the bot trades ──
function emaSeries(vals: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1); const out: (number | null)[] = []; let prev: number | null = null;
  for (let i = 0; i < vals.length; i++) {
    if (prev == null) {
      if (i >= period - 1) { let s = 0; for (let j = i - period + 1; j <= i; j++) s += vals[j]; prev = s / period; out.push(prev); }
      else out.push(null);
    } else { prev = vals[i] * k + prev * (1 - k); out.push(prev); }
  }
  return out;
}
function smaSeries(vals: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < vals.length; i++) {
    if (i >= period - 1) { let s = 0; for (let j = i - period + 1; j <= i; j++) s += vals[j]; out.push(s / period); }
    else out.push(null);
  }
  return out;
}
function bollSeries(vals: number[], period = 20, mult = 2) {
  const mid = smaSeries(vals, period); const upper: (number | null)[] = []; const lower: (number | null)[] = [];
  for (let i = 0; i < vals.length; i++) {
    const m = mid[i];
    if (m == null) { upper.push(null); lower.push(null); continue; }
    let v = 0; for (let j = i - period + 1; j <= i; j++) v += (vals[j] - m) ** 2;
    const sd = Math.sqrt(v / period);
    upper.push(m + mult * sd); lower.push(m - mult * sd);
  }
  return { mid, upper, lower };
}
function atrSeries(candles: ChartCandle[], period: number): (number | null)[] {
  const tr: number[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    if (i === 0) tr.push(c.high - c.low);
    else { const pc = candles[i - 1].close; tr.push(Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc))); }
  }
  const atr: (number | null)[] = []; let prev: number | null = null;
  for (let i = 0; i < tr.length; i++) {
    if (i < period - 1) atr.push(null);
    else if (i === period - 1) { let s = 0; for (let j = 0; j < period; j++) s += tr[j]; prev = s / period; atr.push(prev); }
    else { prev = (prev! * (period - 1) + tr[i]) / period; atr.push(prev); }
  }
  return atr;
}
// Classic Supertrend(10,3): line below price (green, dir=1) in an uptrend, above
// price (red, dir=-1) in a downtrend; flips when close crosses the final band.
function supertrendSeries(candles: ChartCandle[], period = 10, mult = 3) {
  const atr = atrSeries(candles, period); const n = candles.length;
  const fU: (number | null)[] = new Array(n).fill(null);
  const fL: (number | null)[] = new Array(n).fill(null);
  const st: (number | null)[] = new Array(n).fill(null);
  const dir: number[] = new Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    const a = atr[i]; if (a == null) continue;
    const hl2 = (candles[i].high + candles[i].low) / 2;
    const bU = hl2 + mult * a, bL = hl2 - mult * a;
    const pU = fU[i - 1], pL = fL[i - 1], pc = candles[i - 1]?.close;
    fU[i] = (pU == null || bU < pU || (pc != null && pc > pU)) ? bU : pU;
    fL[i] = (pL == null || bL > pL || (pc != null && pc < pL)) ? bL : pL;
    const pSt = st[i - 1];
    if (pSt == null) {
      if (candles[i].close <= (fU[i] as number)) { dir[i] = -1; st[i] = fU[i]; }
      else { dir[i] = 1; st[i] = fL[i]; }
    } else if (pSt === pU) {
      if (candles[i].close > (fU[i] as number)) { dir[i] = 1; st[i] = fL[i]; }
      else { dir[i] = -1; st[i] = fU[i]; }
    } else {
      if (candles[i].close < (fL[i] as number)) { dir[i] = -1; st[i] = fU[i]; }
      else { dir[i] = 1; st[i] = fL[i]; }
    }
  }
  return { st, dir };
}

const CandleChart: React.FC<{
  candles: ChartCandle[];
  position: ActivePos | null;
  marks: ChartTradeMark[];
  overlays: OverlayFlags;
  height?: number;
}> = ({ candles, position, marks, overlays, height = 220 }) => {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || candles.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.scale(dpr, dpr);

    const PAD_L = 4, PAD_R = 56, PAD_T = 8, PAD_B = 18;
    const view = candles.slice(-90);                  // last ~90 candles
    const chartW = W - PAD_L - PAD_R, chartH = H - PAD_T - PAD_B;

    let lo = Math.min(...view.map(c => c.low));
    let hi = Math.max(...view.map(c => c.high));
    // Widen range so position lines stay visible
    if (position) {
      lo = Math.min(lo, position.slPrice, position.entryPrice);
      hi = Math.max(hi, position.tpPrice, position.entryPrice);
    }
    const span = (hi - lo) || 1; lo -= span * 0.04; hi += span * 0.04;

    const x = (i: number) => PAD_L + (i + 0.5) * (chartW / view.length);
    const y = (p: number) => PAD_T + chartH - ((p - lo) / (hi - lo)) * chartH;

    ctx.fillStyle = '#060e1e'; ctx.fillRect(0, 0, W, H);

    // Horizontal gridlines + right-side price labels
    ctx.strokeStyle = '#0f172a'; ctx.fillStyle = '#334155';
    ctx.font = '9px monospace'; ctx.textAlign = 'left';
    for (let g = 0; g <= 4; g++) {
      const p = lo + ((hi - lo) * g) / 4, gy = y(p);
      ctx.beginPath(); ctx.moveTo(PAD_L, gy); ctx.lineTo(W - PAD_R, gy); ctx.stroke();
      ctx.fillText(p.toFixed(4), W - PAD_R + 4, gy + 3);
    }

    // Candles
    const cw = Math.max(1.5, (chartW / view.length) * 0.65);
    view.forEach((c, i) => {
      const cx = x(i), up = c.close >= c.open;
      ctx.strokeStyle = ctx.fillStyle = up ? '#10b981' : '#ef4444';
      ctx.beginPath(); ctx.moveTo(cx, y(c.high)); ctx.lineTo(cx, y(c.low)); ctx.stroke();
      const top = y(Math.max(c.open, c.close)), bh = Math.max(1, Math.abs(y(c.open) - y(c.close)));
      ctx.fillRect(cx - cw / 2, top, cw, bh);
    });

    // ── Indicator overlays (computed on full history, drawn over the visible window) ──
    const N = view.length;
    const tail = <T,>(arr: T[]) => arr.slice(-N);
    const fullCloses = candles.map(c => c.close);
    const polyline = (vals: (number | null)[], color: string, width = 1.2, dash: number[] = []) => {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.beginPath();
      let started = false;
      vals.forEach((v, i) => {
        if (v == null) { started = false; return; }
        const px = x(i), py = y(v);
        if (!started) { ctx.moveTo(px, py); started = true; } else ctx.lineTo(px, py);
      });
      ctx.stroke(); ctx.setLineDash([]);
    };
    if (overlays.boll) {
      const b = bollSeries(fullCloses, 20, 2);
      polyline(tail(b.upper), '#64748b', 1);
      polyline(tail(b.lower), '#64748b', 1);
      polyline(tail(b.mid), '#475569', 1, [3, 3]);
    }
    if (overlays.ma) polyline(tail(smaSeries(fullCloses, 20)), '#a855f7', 1.4);
    if (overlays.ema) {
      polyline(tail(emaSeries(fullCloses, 9)), '#f59e0b', 1.4);
      polyline(tail(emaSeries(fullCloses, 21)), '#3b82f6', 1.4);
    }
    if (overlays.st) {
      const { st, dir } = supertrendSeries(candles, 10, 3);
      const stV = tail(st), dirV = tail(dir);
      ctx.lineWidth = 1.8; ctx.setLineDash([]);
      for (let i = 1; i < stV.length; i++) {
        if (stV[i] == null || stV[i - 1] == null || dirV[i] !== dirV[i - 1]) continue; // break line at trend flip
        ctx.strokeStyle = dirV[i] > 0 ? '#22c55e' : '#ef4444';
        ctx.beginPath(); ctx.moveTo(x(i - 1), y(stV[i - 1] as number)); ctx.lineTo(x(i), y(stV[i] as number)); ctx.stroke();
      }
    }

    // Overlay legend (top-left)
    const legend: [boolean, string, string][] = [
      [overlays.ema, '#f59e0b', 'EMA9'], [overlays.ema, '#3b82f6', 'EMA21'],
      [overlays.ma, '#a855f7', 'MA20'], [overlays.boll, '#64748b', 'BOLL'],
      [overlays.st, '#22c55e', 'ST(10,3)'],
    ];
    let lx = PAD_L + 2;
    ctx.font = 'bold 8px monospace'; ctx.textAlign = 'left';
    legend.filter(l => l[0]).forEach(([, color, label]) => {
      ctx.fillStyle = color; ctx.fillRect(lx, PAD_T + 1, 7, 3);
      ctx.fillStyle = '#94a3b8'; ctx.fillText(label, lx + 9, PAD_T + 5);
      lx += 9 + ctx.measureText(label).width + 8;
    });

    // Position lines: Entry (white dashed) / TP (green) / SL (red)
    if (position) {
      const line = (p: number, color: string, label: string) => {
        const ly = y(p);
        ctx.setLineDash([4, 3]); ctx.strokeStyle = color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(PAD_L, ly); ctx.lineTo(W - PAD_R, ly); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = color; ctx.font = 'bold 9px monospace';
        ctx.fillText(`${label} ${p.toFixed(4)}`, W - PAD_R + 4, ly - 3);
      };
      line(position.entryPrice, '#e2e8f0', 'EN');
      line(position.tpPrice,    '#22c55e', 'TP');
      line(position.slPrice,    '#ef4444', 'SL');
    }

    // Trade markers ▲ open-long / ▼ open-short (hollow = close)
    const t0 = new Date(view[0].date).getTime();
    const t1 = new Date(view[view.length - 1].date).getTime();
    marks.forEach(m => {
      const t = new Date(m.time).getTime();
      if (isNaN(t) || t < t0 || t > t1 || t1 === t0) return;
      const mi = ((t - t0) / (t1 - t0)) * (view.length - 1);
      const mx = x(mi), my = y(m.price);
      const up = m.side === 'LONG' ? !m.isClose : !!m.isClose; // arrow direction = trade action
      ctx.fillStyle = m.isClose ? '#94a3b8' : (m.side === 'LONG' ? '#22c55e' : '#ef4444');
      ctx.beginPath();
      if (up) { ctx.moveTo(mx, my - 9); ctx.lineTo(mx - 5, my - 1); ctx.lineTo(mx + 5, my - 1); }
      else    { ctx.moveTo(mx, my + 9); ctx.lineTo(mx - 5, my + 1); ctx.lineTo(mx + 5, my + 1); }
      ctx.closePath(); ctx.fill();
    });

    // Time labels (first / mid / last)
    ctx.fillStyle = '#334155'; ctx.font = '8px monospace'; ctx.textAlign = 'center';
    [0, Math.floor(view.length / 2), view.length - 1].forEach(i => {
      const d = new Date(view[i].date);
      ctx.fillText(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`, x(i), H - 5);
    });
  }, [candles, position, marks, overlays]);

  if (candles.length < 2) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1e293b', fontSize: '0.72rem', background: '#060e1e', borderRadius: 8 }}>
        Start the bot to stream candles…
      </div>
    );
  }
  return <canvas ref={ref} style={{ width: '100%', height, display: 'block', borderRadius: 8 }} />;
};

const RsiBar: React.FC<{ value: number }> = ({ value }) => {
  const c = value < 30 ? '#22c55e' : value > 70 ? '#ef4444' : '#00d4ff';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', color: '#334155' }}>
        <span>0</span><span>30</span><span>50</span><span>70</span><span>100</span>
      </div>
      <div style={{ height: 5, background: '#1e293b', borderRadius: 3, position: 'relative' }}>
        <div style={{ position: 'absolute', height: '100%', width: `${Math.min(100, Math.max(0, value))}%`, background: c, borderRadius: 3, transition: 'width 0.4s' }} />
      </div>
      <div style={{ textAlign: 'center', fontSize: '0.9rem', fontWeight: 800, color: c, fontFamily: 'monospace' }}>{value.toFixed(1)}</div>
    </div>
  );
};

const Toggle: React.FC<{ val: boolean; onChange: () => void; color?: string }> = ({ val, onChange, color = '#10b981' }) => (
  <button onClick={onChange} style={{ width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer', background: val ? color : '#334155', position: 'relative', flexShrink: 0 }}>
    <div style={{ width: 16, height: 16, borderRadius: '50%', background: '#fff', position: 'absolute', top: 2, left: val ? 18 : 2, transition: 'left 0.15s' }} />
  </button>
);

const inp = { background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 6, padding: '7px 10px', color: '#e2e8f0', fontSize: '0.78rem', width: '100%', boxSizing: 'border-box' as const };

// ─── Main Component ───────────────────────────────────────────────────────────

interface LiveTradeProps {
  /** Opens the Manual Trade view — used for "Manage in Manual Trade" link in margin panel. */
  onOpenManualTrade?: () => void;
  /** Opens the Setup Wizard at the Private Key step — used when key is missing. */
  onOpenSetupWizard?: () => void;
}

export const LiveTradeDashboard: React.FC<LiveTradeProps> = ({ onOpenManualTrade, onOpenSetupWizard }) => {
  const userConfig = useUserConfig();
  const { fetchAndInjectVAA } = usePythOracle(useSuiClient());
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const suiClient = useSuiClient();

  // ── Mode ── (AI Auto Bot removed — Live Trade is Auto Bot / no-AI only)
  const mode: BotMode = 'direct';

  // ── Shared config ──
  const [botSkills,     setBotSkills]     = useState<BotSkillConfig[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<BotSkillConfig | null>(null);
  const [pair,          setPair]          = useState('SUI_USDC'); // BTC/USDC under maintenance
  const [timeframe,     setTimeframe]     = useState('15m');
  const [capitalSUI,    setCapitalSUI]    = useState(0.5);
  const [showConfig,    setShowConfig]    = useState(true);

  // ── DeepTrade (xBTC/USDC) per-user objects — created once via setup ──
  const [dtBalanceManager, setDtBalanceManager] = useState(() => localStorage.getItem('dt_balance_manager') || '');
  const [dtFeeManager,     setDtFeeManager]     = useState(() => localStorage.getItem('dt_fee_manager') || '');
  const [dtSettingUp,      setDtSettingUp]      = useState(false);
  useEffect(() => { localStorage.setItem('dt_balance_manager', dtBalanceManager); }, [dtBalanceManager]);
  useEffect(() => { localStorage.setItem('dt_fee_manager', dtFeeManager); }, [dtFeeManager]);

  // ── SUI/USDC DeepBook Margin account (created once via setup) ──
  const [suiMarginId,       setSuiMarginId]       = useState<string | null>(null);
  const [suiMarginChecking, setSuiMarginChecking] = useState(false);
  const [suiMarginBusy,     setSuiMarginBusy]     = useState(false);
  const [suiCollateral,     setSuiCollateral]     = useState(10);         // USDC amount to deposit
  // Bot only deposits/uses USDC — simpler mental model + matches "capital in USDC" UX.
  const suiCollateralAsset: 'USDC' = 'USDC';
  // Pool assets (queried from chain) — base = SUI side, quote = USDC the bot will trade with.
  const [poolAssets, setPoolAssets] = useState<{
    baseAsset: number; quoteAsset: number;      // LIQUID (withdrawable / bot-usable)
    totalBase?: number; totalQuote?: number;    // total valuation incl. locked
    hasDebt?: boolean;                          // outstanding borrow exists
  } | null>(null);

  /** Minimum USDC the bot needs in the margin pool to safely place a leveraged position. */
  const MIN_POOL_USDC = 10;

  // ── AI Auto Bot config (legacy state, kept for the future AI-mode revival) ──
  const [autoConfirm,setAutoConfirm]= useState(false);

  // ── Optional AI safety check (opt-in, off by default → $0 LLM cost) ──
  // AI cannot create trades — it only approves/rejects the bot's pre-computed signal.
  const [aiCheckEnabled,  setAiCheckEnabled]  = useState(() => localStorage.getItem('lt_ai_check_enabled') === '1');
  const [aiCheckProvider, setAiCheckProvider] = useState<'gemini'|'deepseek'|'openclaw'>(() =>
    (localStorage.getItem('lt_ai_check_provider') as any) || 'gemini');
  const [aiCheckApiKey,   setAiCheckApiKey]   = useState(() => localStorage.getItem('lt_ai_check_apikey') || '');
  useEffect(() => { localStorage.setItem('lt_ai_check_enabled',  aiCheckEnabled ? '1' : '0'); }, [aiCheckEnabled]);
  useEffect(() => { localStorage.setItem('lt_ai_check_provider', aiCheckProvider); }, [aiCheckProvider]);
  useEffect(() => { localStorage.setItem('lt_ai_check_apikey',   aiCheckApiKey); }, [aiCheckApiKey]);

  // ── Auto Bot (Direct) config ──
  // Private key now lives in userConfig (entered once in SetupWizard step 4).
  // We DON'T re-collect it here — Live Trade only checks status and reads it on Start.
  const isDesktop = IS_DESKTOP;
  const wizardHasKey = userConfig.config.hasPrivateKey;
  // Legacy local state — kept ONLY because the dev-wallet (.env) path still writes
  // through it. Manual-key entry path is removed and these stay default.
  const privateKey = '';
  const setPrivateKey = (_: string) => { /* removed — use wizard */ };
  const [keyLoaded, setKeyLoaded] = useState(false);
  const [devWallet,   setDevWallet]   = useState<{ address: string; label: string } | null>(null);
  const [usingDevKey, setUsingDevKey] = useState(false);

  // ── Runtime ──
  const [botState, setBotState] = useState<BotState>({
    active: false, mode: 'ai_agent', config: null, position: null,
    price: 0, signal: 'HOLD',
    indicators: { rsi: 50, ema9: 0, ema21: 0, macdHist: 0, bbUpper: 0, bbLower: 0 },
    tradeCount: 0, totalPnl: 0, logs: [], lastUpdate: '',
  });
  const [wsConnected,    setWsConnected]    = useState(false);
  const [pendingTx,      setPendingTx]      = useState<any>(null);
  const [pendingIntent,  setPendingIntent]  = useState<'open'|'close'>('open');
  const [priceHistory,   setPriceHistory]   = useState<number[]>([]);

  // Auto-collapse the (very tall) config panel while the bot is running —
  // the dashboard + chart become the focus. Re-opens manually via the Config button.
  const prevActiveRef = useRef(false);
  useEffect(() => {
    if (botState.active && !prevActiveRef.current) setShowConfig(false);
    prevActiveRef.current = botState.active;
  }, [botState.active]);

  // ── Chart + Trade History data (from the agent's own endpoints) ──
  const [chartCandles, setChartCandles] = useState<ChartCandle[]>([]);
  // Indicator overlays drawn over the live candles (Supertrend on by default).
  const [overlays, setOverlays] = useState<OverlayFlags>({ ema: false, ma: false, boll: false, st: true });
  const [tradeHistory, setTradeHistory] = useState<any[]>([]);
  const [closingNow,   setClosingNow]   = useState(false);

  const refreshChartData = useCallback(async () => {
    try {
      const [cr, hr] = await Promise.all([
        fetch(`${AGENT_URL}/api/livebot/candles`).then(r => r.ok ? r.json() : null),
        fetch(`${AGENT_URL}/api/livebot/history`).then(r => r.ok ? r.json() : null),
      ]);
      if (cr?.candles?.length) setChartCandles(cr.candles);
      if (hr?.history) setTradeHistory(hr.history);
    } catch { /* agent offline — keep last data */ }
  }, []);

  // Poll every 30s + once on mount; trade events refresh immediately via WS handler.
  useEffect(() => {
    refreshChartData();
    const t = setInterval(refreshChartData, 30_000);
    return () => clearInterval(t);
  }, [refreshChartData]);

  const wsRef     = useRef<WebSocket | null>(null);
  const logsRef   = useRef<HTMLDivElement>(null);

  // ── Load skills + dev wallet ──
  useEffect(() => {
    // Merge AI-researched presets so a brand-new user always sees the two
    // proven SUI bot skills (sui_alpha_m30, sui_ema_h1) without having to add
    // them manually. Presets first, then any user/server skills (deduped by name).
    const mergePresets = (list: BotSkillConfig[]): BotSkillConfig[] => {
      const byName = new Map<string, BotSkillConfig>();
      for (const p of PRESET_SKILLS) byName.set(p.name, p);
      for (const s of list) byName.set(s.name, s); // user override wins
      return Array.from(byName.values());
    };
    // Default selection — same star preset as the Web Bot, so both tiers agree.
    const pickDefault = (list: BotSkillConfig[]) =>
      list.find(s => /sui_supertrend_m5_v2/i.test(s.name)) ||
      list.find(s => /sui_alpha_m30/i.test(s.name)) ||
      list.find(s => /sui_ema_h1/i.test(s.name)) ||
      list[0] || null;
    const local = mergePresets(loadBotSkills());
    setBotSkills(local);
    setSelectedSkill(prev => prev || pickDefault(local));
    fetch(`${AGENT_URL}/api/skills/bot`).then(r => r.json())
      .then(d => { if (d.skills?.length) { const merged = mergePresets(d.skills); setBotSkills(merged); setSelectedSkill(prev => prev || pickDefault(merged)); } }).catch(() => {});

    // Kiểm tra server có dev wallet không
    fetch(`${AGENT_URL}/api/dev/wallet`).then(r => r.json())
      .then(d => {
        if (d.hasKey && d.address) {
          setDevWallet({ address: d.address, label: d.label });
          // Auto dùng dev key cho Direct Mode
          setUsingDevKey(true);
          setKeyLoaded(true);
          // Private key thực tế không cần truyền từ frontend vì server đã có từ .env
          setPrivateKey('__DEV_KEY_FROM_ENV__');
        }
      }).catch(() => {});
  }, []);

  // ── Auto-align pair + timeframe to the selected skill's preferences ──
  // SUI presets → SUI_USDC pair + their tested timeframe; keeps a new user
  // from accidentally running a SUI-tuned strategy on the BTC pair.
  useEffect(() => {
    if (!selectedSkill) return;
    // BTC/USDC is under maintenance → never auto-switch to it; keep SUI_USDC.
    if (selectedSkill.preferredAsset === 'sui') setPair('SUI_USDC');
    else if (selectedSkill.preferredAsset === 'btc' && !PAIR_OPTIONS.find(o => o.value === 'XBTC_USDC')?.disabled) setPair('XBTC_USDC');
    // Map backtest TF label (M30/H1) → live TF (30m/1h)
    const tfMap: Record<string, string> = { M5: '5m', M15: '15m', M30: '30m', H1: '1h' };
    const pref = selectedSkill.preferredTimeframe;
    if (pref && tfMap[pref]) setTimeframe(tfMap[pref]);
  }, [selectedSkill]);

  // ── WebSocket ──
  const connectWS = useCallback(() => {
    const ws = new WebSocket(`${AGENT_WS_URL}`);
    wsRef.current = ws;
    ws.onopen  = () => { setWsConnected(true); ws.send(JSON.stringify({ type: 'GET_STATE' })); };
    ws.onclose = () => { setWsConnected(false); setTimeout(connectWS, 3000); };
    ws.onmessage = evt => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type === 'BOT_STATE') {
          setBotState(prev => ({ ...prev, ...msg }));
          if (msg.price) setPriceHistory(h => [...h.slice(-80), msg.price]);
        }
        if (msg.type === 'PRICE_UPDATE') {
          setBotState(prev => ({ ...prev, price: msg.price, signal: msg.signal, indicators: msg.indicators || prev.indicators, lastUpdate: msg.lastUpdate || '' }));
          setPriceHistory(h => [...h.slice(-80), msg.price]);
        }
        if (msg.type === 'SIGNAL_DETECTED') setBotState(prev => ({ ...prev, signal: msg.signalType }));
        if (msg.type === 'POSITION_UPDATE') {
          setBotState(prev => ({ ...prev, position: msg.position, price: msg.price, indicators: msg.indicators || prev.indicators }));
          if (msg.price) setPriceHistory(h => [...h.slice(-80), msg.price]);
        }
        if (msg.type === 'PENDING_TX') {
          if (autoConfirm) { handleConfirmTx(msg.pendingTx, msg.intent); return; }
          setPendingTx(msg.pendingTx); setPendingIntent(msg.intent || 'open');
        }
        if (msg.type === 'TRADE_OPENED') {
          setBotState(prev => ({ ...prev, position: prev.position }));
          notify('🟢 Position opened', `${msg.position?.type ?? ''} @ $${msg.position?.entryPrice ?? ''}`.trim());
          refreshChartData();
        }
        if (msg.type === 'TRADE_CLOSED') {
          setBotState(prev => ({ ...prev, position: null }));
          const pnl = msg.pnlApprox;
          notify('🔴 Position closed', `${msg.reason ?? ''} · Est. PnL ${pnl >= 0 ? '+' : ''}${pnl ?? ''} (${msg.pnlPct ?? 0}%)`);
          refreshChartData();
        }
      } catch { /* ignore */ }
    };
  }, [autoConfirm, refreshChartData]);

  useEffect(() => { connectWS(); return () => wsRef.current?.close(); }, []);

  // ── Confirm TX (AI Agent Mode) ──
  const handleConfirmTx = useCallback(async (tx: any, intent: string) => {
    if (!tx?.txBytes && !tx?.serializedTx) return;
    try {
      const src = tx.txBytes
        ? Transaction.from(Uint8Array.from(atob(tx.txBytes), c => c.charCodeAt(0)))
        : Transaction.from(tx.serializedTx);
      const res = await signAndExecute({ transaction: src });
      wsRef.current?.send(JSON.stringify({ type: 'TX_RESULT', success: true, digest: res.digest, intent }));
    } catch (err: any) {
      wsRef.current?.send(JSON.stringify({ type: 'TX_RESULT', success: false, error: err.message, intent }));
    }
    setPendingTx(null);
  }, [signAndExecute]);

  // ── One-time DeepTrade setup: create BalanceManager + FeeManager, save IDs ──
  const handleDeeptradeSetup = useCallback(async () => {
    const addr = account?.address;
    if (!addr) { alert('Connect your wallet first.'); return; }
    setDtSettingUp(true);
    try {
      const PKG_DT = '0xc10d536b6580d809711b9bb8eee3945d5e96f92a346c84d74ff7a0697e664695';
      const PKG_DB = '0x0e735f8c93a95722efd73521aca7a7652c0bb71ed1daf41b26dfd7d1ff71f748';
      const tx = new Transaction();
      const bm = tx.moveCall({ target: `${PKG_DB}::balance_manager::new` });
      tx.moveCall({
        target: '0x2::transfer::public_share_object',
        typeArguments: [`${PKG_DB}::balance_manager::BalanceManager`],
        arguments: [bm],
      });
      const fm = tx.moveCall({ target: `${PKG_DT}::fee_manager::new` });
      tx.moveCall({ target: `${PKG_DT}::fee_manager::share_fee_manager`, arguments: [fm[0], fm[2]] });
      tx.transferObjects([fm[1]], addr);
      const res = await signAndExecute({ transaction: tx });
      // Wait for the RPC node to index the transaction before querying.
      await suiClient.waitForTransaction({ digest: res.digest, timeout: 30_000 });
      const full = await suiClient.getTransactionBlock({ digest: res.digest, options: { showObjectChanges: true } });
      const changes: any[] = (full.objectChanges as any[]) || [];
      const bmObj = changes.find((c) => c.type === 'created' && /::balance_manager::BalanceManager$/.test(c.objectType || ''));
      const fmObj = changes.find((c) => c.type === 'created' && /::fee_manager::FeeManager$/.test(c.objectType || ''));
      if (bmObj?.objectId) setDtBalanceManager(bmObj.objectId);
      if (fmObj?.objectId) setDtFeeManager(fmObj.objectId);
      if (bmObj?.objectId && fmObj?.objectId) alert('DeepTrade setup complete. BalanceManager + FeeManager saved.');
      else alert('Setup signed, but could not auto-detect the new object IDs. Paste them manually from your explorer.');
    } catch (err: any) {
      alert('DeepTrade setup failed: ' + (err?.message || err));
    } finally {
      setDtSettingUp(false);
    }
  }, [account, signAndExecute, suiClient]);

  // ── SUI/USDC DeepBook Margin: check if the wallet already has a margin account ──
  // Also fetches the on-chain settled balances (USDC + SUI) sitting in the margin pool
  // so the user sees exactly how much capital the bot has to work with.
  const checkSuiMargin = useCallback(async () => {
    const addr = account?.address || devWallet?.address;
    if (!addr) { setSuiMarginId(null); setPoolAssets(null); return; }
    setSuiMarginChecking(true);
    try {
      const discover = new DeepBookClient({ client: suiClient as any, network: 'mainnet', address: addr });
      const ids = await discover.getMarginManagerIdsForOwner(addr);
      if (!ids.length) {
        setSuiMarginId(null); setPoolAssets(null);
        return;
      }
      // Pick the SUI/USDC-pool manager (the wallet may own managers from
      // other pools too — picking the wrong one causes TypeMismatch later).
      const managerKey = await pickBestSuiUsdcManager(suiClient, ids);
      if (!managerKey) {
        setSuiMarginId(null); setPoolAssets(null);
        return;
      }
      setSuiMarginId(managerKey);

      // Re-init with the marginManagers map, then read the REAL liquid balances
      // (the internal bag) — not just calculateAssets, which includes collateral
      // locked against open borrows and misled the min-capital gate before.
      try {
        const poolKey = 'SUI_USDC'; // hardcoded — SDK circular dep on getMarginManager
        const db = new DeepBookClient({
          client: suiClient as any, network: 'mainnet', address: addr,
          marginManagers: { [managerKey]: { marginManagerKey: managerKey, address: managerKey, poolKey } } as any,
        });
        const d = await getMarginManagerDetail(suiClient, db, managerKey);
        // baseAsset/quoteAsset = LIQUID withdrawable amounts (what the bot can size against)
        setPoolAssets({
          baseAsset:  d.withdrawableSui,
          quoteAsset: d.withdrawableUsdc,
          totalBase:  d.totalSui,
          totalQuote: d.totalUsdc,
          hasDebt:    d.debtBaseShares > 0n || d.debtQuoteShares > 0n,
        });
      } catch (e) {
        // Asset query may fail right after account creation while the indexer catches up —
        // leave poolAssets null; UI shows "checking..." until next refresh.
        setPoolAssets(null);
      }
    } catch {
      setSuiMarginId(null); setPoolAssets(null);
    } finally {
      setSuiMarginChecking(false);
    }
  }, [account, devWallet, suiClient]);

  // Auto-check whenever the SUI pair becomes active or the wallet changes
  useEffect(() => {
    if (pair === 'SUI_USDC') checkSuiMargin();
  }, [pair, account, devWallet, checkSuiMargin]);

  // ── Create a Margin Account + deposit initial collateral (browser-signed) ──
  const handleSuiMarginSetup = useCallback(async () => {
    const addr = account?.address;
    if (!addr) { alert('Connect your wallet first to create a SUI margin account.'); return; }
    if (suiCollateral <= 0) { alert('Enter a collateral amount greater than 0.'); return; }
    setSuiMarginBusy(true);
    try {
      // Pre-flight USDC balance check — bot only uses USDC as collateral.
      const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
      const need      = BigInt(Math.floor(suiCollateral * 1e6));
      const bal       = await suiClient.getBalance({ owner: addr, coinType: USDC_TYPE });
      const have      = BigInt(bal.totalBalance || '0');
      if (have < need) {
        const haveHuman = Number(have) / 1e6;
        throw new Error(`Insufficient USDC: wallet has ${haveHuman.toFixed(4)}, need ${suiCollateral}. Get more USDC first.`);
      }

      const db = new DeepBookClient({ client: suiClient as any, network: 'mainnet', address: addr });
      const tx = new Transaction();
      tx.setSender(addr);
      const { manager, initializer } = db.marginManager.newMarginManagerWithInitializer('SUI_USDC')(tx);
      db.marginManager.depositDuringInitialization({
        manager, poolKey: 'SUI_USDC', coinType: 'USDC', amount: suiCollateral,
      })(tx);
      db.marginManager.shareMarginManager('SUI_USDC', manager, initializer)(tx);
      const res = await signAndExecute({ transaction: tx });
      await suiClient.waitForTransaction({ digest: res.digest, timeout: 30_000 });
      await checkSuiMargin();
      alert(`Margin account created and ${suiCollateral} ${suiCollateralAsset} deposited as collateral.`);
    } catch (err: any) {
      const msg = err?.message || String(err);
      const friendly =
        /InsufficientCoinBalance|insufficient/i.test(msg)
          ? `Insufficient ${suiCollateralAsset} balance in the wallet.`
        : /TypeMismatch/i.test(msg)
          ? `Type mismatch — the wrong coin type was used. Make sure the wallet holds the asset you selected (SUI or USDC).`
        : msg;
      alert('Margin setup failed: ' + friendly);
    } finally {
      setSuiMarginBusy(false);
    }
  }, [account, signAndExecute, suiClient, suiCollateral, suiCollateralAsset, checkSuiMargin]);

  // ── Deposit additional collateral into the existing margin account ──
  // Mirrors Manual Trade's working mainnet pattern verbatim:
  //   1. Fresh DeepBookClient at deposit time (no cached marginManagers map)
  //   2. Fresh getMarginManagerIdsForOwner() call (don't trust stale state.suiMarginId)
  //   3. Plain depositBase / depositQuote with the freshly-resolved managerKey
  // Also pre-flights the user's coin balance so we fail with a clear message
  // instead of a cryptic on-chain TypeMismatch / InsufficientCoinBalance error.
  const handleSuiDeposit = useCallback(async () => {
    const addr = account?.address;
    if (!addr) { alert('Connect your wallet first.'); return; }
    if (suiCollateral <= 0) { alert('Enter a deposit amount greater than 0.'); return; }
    setSuiMarginBusy(true);
    try {
      // 1) Plain client to discover the user's margin manager id + its pool key
      const discoverClient = new DeepBookClient({ client: suiClient as any, network: 'mainnet', address: addr });
      const managerIds = await discoverClient.getMarginManagerIdsForOwner(addr);
      if (managerIds.length === 0) {
        throw new Error('No Margin Account on this wallet — create one first using the button above.');
      }
      const managerKey = await pickBestSuiUsdcManager(suiClient, managerIds);
      if (!managerKey) {
        throw new Error('No SUI/USDC margin account on this wallet. Create one first using the button above.');
      }
      const poolKey = 'SUI_USDC';

      // 2) Pre-flight USDC balance check — bot only deposits USDC.
      const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
      const need      = BigInt(Math.floor(suiCollateral * 1e6));
      const bal       = await suiClient.getBalance({ owner: addr, coinType: USDC_TYPE });
      const have      = BigInt(bal.totalBalance || '0');
      if (have < need) {
        const haveHuman = Number(have) / 1e6;
        throw new Error(`Insufficient USDC: wallet has ${haveHuman.toFixed(4)}, need ${suiCollateral}. Get more USDC first.`);
      }

      // 3) Re-init DeepBookClient WITH the marginManagers map — required by the SDK.
      //    Without it, marginManager.depositBase/depositQuote throws MARGIN_MANAGER_NOT_FOUND
      //    because internally it calls config.getMarginManager(managerKey) which expects
      //    the manager to be registered up-front. This matches the production-tested
      //    pattern in src/agent/tools/margin.ts getDeepBookClient().
      const dbClient = new DeepBookClient({
        client: suiClient as any, network: 'mainnet', address: addr,
        marginManagers: { [normalizeSuiAddress(managerKey)]: { marginManagerKey: normalizeSuiAddress(managerKey), address: normalizeSuiAddress(managerKey), poolKey } } as any,
      });

      const tx = new Transaction();
      // Bot only uses USDC — always depositQuote.
      dbClient.marginManager.depositQuote({ managerKey, amount: suiCollateral })(tx);
      const res = await signAndExecute({ transaction: tx });
      await suiClient.waitForTransaction({ digest: res.digest, timeout: 30_000 });
      setSuiMarginId(managerKey);
      // Refresh pool assets so the UI shows the new balance immediately
      await checkSuiMargin();
      alert(`Deposited ${suiCollateral} USDC into the margin account.`);
    } catch (err: any) {
      const msg = err?.message || String(err);
      // Surface common on-chain failure modes in plain English
      const friendly =
        /InsufficientCoinBalance|insufficient/i.test(msg)
          ? `Insufficient ${suiCollateralAsset} balance in the wallet.`
        : /TypeMismatch/i.test(msg)
          ? `Type mismatch — the wrong coin type was used. Make sure you picked the correct asset (SUI vs USDC) and that the wallet holds it.`
        : /MarginManager|manager/i.test(msg)
          ? `Margin Account lookup failed. Click "↻ Refresh" and try again.`
        : msg;
      alert('Deposit failed: ' + friendly);
    } finally {
      setSuiMarginBusy(false);
    }
  }, [account, signAndExecute, suiClient, suiCollateral, suiCollateralAsset]);

  // ── Withdraw USDC from the SUI/USDC margin pool back to the wallet ──
  // Uses the same SDK pattern as deposit. Bot only operates in USDC, so this
  // pulls quote-side balance back to the user. Withdraw is blocked if the
  // pool would drop below MIN_POOL_USDC AND the bot is currently active.
  const handleSuiWithdraw = useCallback(async () => {
    const addr = account?.address;
    if (!addr) { alert('Connect your wallet first.'); return; }
    if (!suiMarginId) { alert('No margin account to withdraw from. Create one first.'); return; }
    if (suiCollateral <= 0) { alert('Enter a withdraw amount greater than 0.'); return; }
    if (poolAssets && suiCollateral > poolAssets.quoteAsset) {
      alert(`Cannot withdraw ${suiCollateral} USDC — pool only holds ${poolAssets.quoteAsset.toFixed(2)} USDC.`);
      return;
    }
    setSuiMarginBusy(true);
    try {
      const dbClient = new DeepBookClient({
        client: suiClient as any, network: 'mainnet', address: addr,
        marginManagers: { [suiMarginId]: { marginManagerKey: suiMarginId, address: suiMarginId, poolKey: 'SUI_USDC' } } as any,
      });
      const tx = new Transaction();
      // Inject fresh Pyth price update — withdraw_with_proof aborts with code 3
      // (EInvalidProof) when price feeds are stale. Without this, a second
      // withdraw in the same session fails.
      await fetchAndInjectVAA(tx, 'SUI_USDC');
      // withdrawQuote returns the Coin<USDC> — must transfer to user wallet
      // or the tx fails with `UnusedValueWithoutDrop`.
      const coin = dbClient.marginManager.withdrawQuote(suiMarginId, suiCollateral)(tx);
      tx.transferObjects([coin], tx.pure.address(addr));
      const res = await signAndExecute({ transaction: tx });
      await suiClient.waitForTransaction({ digest: res.digest, timeout: 30_000 });
      await checkSuiMargin();
      alert(`Withdrew ${suiCollateral} USDC from the margin account back to your wallet.`);
    } catch (err: any) {
      const msg = err?.message || String(err);
      const friendly = /InsufficientFunds|insufficient/i.test(msg)
        ? `Insufficient balance in the margin pool — pool may hold less than ${suiCollateral} USDC.`
        : msg;
      alert('Withdraw failed: ' + friendly);
    } finally {
      setSuiMarginBusy(false);
    }
  }, [account, signAndExecute, suiClient, suiMarginId, suiCollateral, poolAssets, checkSuiMargin]);

  const isSuiPair = pair === 'SUI_USDC';

  // ── Start / Stop ──
  const handleStart = async () => {
    if (!selectedSkill) { alert('Select a Bot Skill first.'); return; }
    if (!usingDevKey) {
      if (!wizardHasKey) {
        const goWizard = confirm('No private key configured yet.\n\nThe Auto Bot needs a key to self-sign trades. Set one up in the Setup Wizard (step 4).\n\nOpen the Wizard now?');
        if (goWizard && onOpenSetupWizard) onOpenSetupWizard();
        return;
      } else if (!userConfig.getPrivateKey()) {
        const goWizard = confirm('Your private key session has expired (tab was reloaded).\n\nThe Auto Bot needs a key to self-sign trades. Please re-enter it in the Setup Wizard.\n\nOpen the Wizard now?');
        if (goWizard && onOpenSetupWizard) onOpenSetupWizard();
        return;
      }
    }

    // Pre-flight: if user opted into AI safety check, make sure we have credentials.
    if (aiCheckEnabled && aiCheckProvider !== 'openclaw' && !aiCheckApiKey.trim()) {
      alert(`AI safety check is ON but no ${aiCheckProvider} API key is set.\n\nEither paste a key in the "🤖 AI Safety Check" section, switch to OpenClaw, or turn the check off to run pure Auto Bot ($0 cost).`);
      return;
    }

    // Pre-flight: SUI/USDC trades need a DeepBook margin account with collateral.
    if (isSuiPair && !suiMarginId) {
      alert('No DeepBook Margin Account found for SUI/USDC.\n\nCreate one and deposit USDC in the "💧 DeepBook Margin Account" panel above before starting the bot — otherwise it cannot open a position.');
      return;
    }
    // Pre-flight: minimum USDC in the margin pool. Below this the bot can't safely
    // size a leveraged position so we refuse to start instead of silently failing on chain.
    if (isSuiPair && poolAssets !== null && poolAssets.quoteAsset < MIN_POOL_USDC) {
      alert(`Margin pool has only ${poolAssets.quoteAsset.toFixed(2)} USDC — minimum required is ${MIN_POOL_USDC} USDC for the bot to trade safely.\n\nDeposit more USDC in the "💧 DeepBook Margin Account" panel before starting.`);
      return;
    }

    const cfg: LiveBotConfig = {
      botSkillName: selectedSkill.name, signal: selectedSkill.signal,
      direction: selectedSkill.direction, takeProfitPct: selectedSkill.takeProfitPct,
      stopLossPct: selectedSkill.stopLossPct, trailingStopPct: selectedSkill.trailingStopPct,
      enableTrailing: selectedSkill.enableTrailing, enableDefense: selectedSkill.enableDefense,
      leverage: selectedSkill.leverage, orderPct: selectedSkill.orderPct, commission: selectedSkill.commission,
      // Supertrend EA inputs + EA money-management — same fields the backtester ran with
      supertrendPeriod:    selectedSkill.supertrendPeriod,
      supertrendMult:      selectedSkill.supertrendMult,
      breakoutPeriod:      selectedSkill.breakoutPeriod,
      maxBarsInTrade:      selectedSkill.maxBarsInTrade,
      htfMinutes:          selectedSkill.htfMinutes,
      htfSupertrendPeriod: selectedSkill.htfSupertrendPeriod,
      htfSupertrendMult:   selectedSkill.htfSupertrendMult,
      sizingMode:          selectedSkill.sizingMode,
      riskPct:             selectedSkill.riskPct,
      breakEvenTriggerPct: selectedSkill.breakEvenTriggerPct,
      cooldownBars:        selectedSkill.cooldownBars,
      maxConsecLosses:     selectedSkill.maxConsecLosses,
      maxDailyLossPct:     selectedSkill.maxDailyLossPct,
      sessionStartHour:    selectedSkill.sessionStartHour,
      sessionEndHour:      selectedSkill.sessionEndHour,
      timeframe, pair, capitalSUI,
      walletAddress: account?.address || devWallet?.address || '',
      // No AI — Auto Bot only
      apiKey:    undefined,
      provider:  undefined,
      sessionId: undefined,
      // Direct Mode — if using the dev key from .env, no key is passed (server uses it);
      // otherwise pull from the wizard-saved sessionStorage entry.
      directMode: true,
      privateKey: !usingDevKey ? (userConfig.getPrivateKey() || undefined) : undefined,
      // DeepTrade spot (xBTC/USDC) per-user objects
      balanceManagerId: dtBalanceManager.trim() || undefined,
      feeManagerId:     dtFeeManager.trim() || undefined,
      // Author of the bot skill being used — receives the 0.005 SUI per-OPEN author share.
      // Deterministic (no random pick): every open pays this exact wallet.
      skillAuthor: selectedSkill.authorAddress || undefined,
      // Optional AI safety check — only sent if user opted in
      aiValidation: aiCheckEnabled
        ? { enabled: true, provider: aiCheckProvider, apiKey: aiCheckProvider === 'openclaw' ? undefined : aiCheckApiKey.trim() || undefined }
        : undefined,
    };
    setShowConfig(false);
    try {
      const r = await fetch(`${AGENT_URL}/api/livebot/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: cfg }),
      });
      if (!r.ok) throw new Error(`Agent returned ${r.status}`);
    } catch (err: any) {
      // Agent REST not reachable — fall back to WebSocket if open, else tell the user.
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'SET_CONFIG', config: cfg }));
        wsRef.current.send(JSON.stringify({ type: 'TOGGLE_BOT', active: true }));
      } else {
        setShowConfig(true);
        alert('Cannot reach the Local Agent.\n\nThe bot runs inside the agent on your machine. Download & start the Suirobo Agent (header → "Download Agent"), wait for the green "WS" indicator, then press Start again.');
      }
    }
  };

  const handleStop = async () => {
    try {
      const r = await fetch(`${AGENT_URL}/api/livebot/stop`, { method: 'POST' });
      if (!r.ok) throw new Error(`Agent returned ${r.status}`);
    } catch {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'TOGGLE_BOT', active: false }));
      } else {
        // Optimistic local stop so the UI doesn't get stuck if the agent is gone.
        setBotState(prev => ({ ...prev, active: false }));
      }
    }
  };

  // Panic button: stop the bot AND market-close any open position in one call.
  const [killing, setKilling] = useState(false);
  const handleKillSwitch = async () => {
    if (!window.confirm('KILL SWITCH\n\nStop the bot and immediately close (flatten) any open position at market?')) return;
    setKilling(true);
    try {
      const r = await fetch(`${AGENT_URL}/api/livebot/killswitch`, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      setBotState(prev => ({ ...prev, active: false }));
      alert(j?.message || (r.ok ? 'Bot stopped and flattened.' : 'Kill switch failed — check the bot log.'));
    } catch {
      // Agent unreachable → best-effort optimistic stop so the UI isn't stuck.
      setBotState(prev => ({ ...prev, active: false }));
      alert('Could not reach the agent. If a position is still open, close it from the position card or on-chain.');
    } finally {
      setKilling(false);
    }
  };

  // Today's REALISED P&L (sum of closed-trade percents, UTC day) — mirrors the
  // agent's daily-loss breaker so the user sees how close they are to the cap.
  const todayKey = new Date().toISOString().slice(0, 10);
  const dailyPnlPct = tradeHistory
    .filter((r: any) => r.closeTime && String(r.closeTime).slice(0, 10) === todayKey)
    .reduce((s: number, r: any) => s + (r.pnlPct ?? 0), 0);
  const dailyLossCap = botState.config?.maxDailyLossPct ?? 0;

  // Bot can start when a skill is picked AND we have a key (either the wizard
  // saved one, or the agent loaded one from .env) AND — for SUI margin — the
  // pool has enough USDC to size a position safely.
  const poolHasEnoughUsdc = !isSuiPair || (poolAssets !== null && poolAssets.quoteAsset >= MIN_POOL_USDC);
  const canStart = !!selectedSkill && (wizardHasKey || usingDevKey) && poolHasEnoughUsdc;

  const s   = botState;
  const pos = s.position;
  const ind = s.indicators;
  const sc  = s.signal === 'BUY' ? '#22c55e' : s.signal === 'SELL' ? '#ef4444' : '#475569';
  const activeMode: BotMode = (s as any).mode || mode;

  // The agent only writes an "open" trade record in direct mode; the agent-sign /
  // xBTC paths don't. So if there's a live open position that isn't already in the
  // fetched history, synthesize an "open" row from it so the user always sees the
  // currently-open trade in Trade History (and as an entry marker on the chart).
  const displayHistory = (() => {
    if (!pos) return tradeHistory;
    if (tradeHistory.some((r: any) => r.closeTime == null)) return tradeHistory; // agent already recorded it
    const openRow = {
      id: 'live-open', openTime: pos.entryTime, closeTime: null,
      side: pos.type, pair: s.config?.pair ?? '',
      entry: pos.entryPrice, exit: null,
      pnlPct: pos.unrealizedPct ?? null, pnlVal: pos.unrealizedPnl ?? null,
      reason: null, openTx: null, closeTx: null,
      skill: s.config?.botSkillName ?? s.config?.skillName ?? '',
    };
    return [openRow, ...tradeHistory];
  })();

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', background: '#060e1e', minHeight: '100vh', fontFamily: "'Inter',sans-serif" }}>

      {/* ═══════════════════════ TOP BAR ═══════════════════════ */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 20px', background: '#0a101d', borderBottom: '1px solid #1e293b' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: '1.1rem' }}>📈</span>
          <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#e2e8f0' }}>Live Trade</span>
          {s.config?.botSkillName && (
            <span style={{ fontSize: '0.7rem', color: '#818cf8', background: 'rgba(99,102,241,0.1)', padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(99,102,241,0.2)' }}>
              🤖 {s.config.botSkillName}
            </span>
          )}
          {/* Status */}
          <span style={{
            fontSize: '0.65rem', fontWeight: 700, padding: '2px 8px', borderRadius: 4,
            background: s.active ? 'rgba(16,185,129,0.1)' : 'rgba(71,85,105,0.2)',
            color: s.active ? '#10b981' : '#475569',
            border: `1px solid ${s.active ? 'rgba(16,185,129,0.3)' : '#1e293b'}`,
            animation: s.active ? 'none' : 'none',
          }}>
            {s.active ? '● RUNNING' : '■ STOPPED'}
          </span>
          {/* Today's realised P&L vs the daily-loss circuit-breaker cap */}
          {(dailyLossCap > 0 || dailyPnlPct !== 0) && (
            <span style={{
              fontSize: '0.62rem', fontWeight: 700, padding: '2px 8px', borderRadius: 4,
              fontFamily: 'monospace',
              background: dailyPnlPct < 0 ? 'rgba(239,68,68,0.10)' : 'rgba(16,185,129,0.10)',
              color: dailyPnlPct < 0 ? '#f87171' : '#34d399',
              border: `1px solid ${dailyPnlPct < 0 ? 'rgba(239,68,68,0.25)' : 'rgba(16,185,129,0.25)'}`,
            }} title="Today's realised P&L (sum of closed-trade %), and the daily-loss limit that flattens + halts the bot">
              Day {dailyPnlPct >= 0 ? '+' : ''}{dailyPnlPct.toFixed(1)}%{dailyLossCap > 0 ? ` / cap -${dailyLossCap}%` : ''}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: '0.62rem', color: wsConnected ? '#22c55e' : '#ef4444' }}>{wsConnected ? '● WS' : '○ WS'}</span>
          <button onClick={() => setShowConfig(v => !v)} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #1e293b', background: showConfig ? '#1e293b' : 'transparent', color: '#64748b', fontSize: '0.73rem', cursor: 'pointer' }}>
            ⚙️ {showConfig ? 'Hide Config' : 'Config'}
          </button>
          {/* Kill switch — visible whenever there is something to stop/flatten */}
          {(s.active || pos) && (
            <button onClick={handleKillSwitch} disabled={killing}
              title="Stop the bot and flatten all positions immediately"
              style={{
                padding: '8px 14px', borderRadius: 7, cursor: killing ? 'wait' : 'pointer',
                border: '1px solid #ef4444', background: 'rgba(239,68,68,0.12)',
                color: '#fca5a5', fontWeight: 800, fontSize: '0.78rem', whiteSpace: 'nowrap',
              }}>
              {killing ? '⏳ Flattening…' : '🛑 Kill switch'}
            </button>
          )}
          {s.active
            ? <button onClick={handleStop} style={{ padding: '8px 20px', borderRadius: 7, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#ef4444,#dc2626)', color: '#fff', fontWeight: 700, fontSize: '0.8rem' }}>⏹ Stop Bot</button>
            : <button onClick={handleStart} disabled={!canStart} style={{ padding: '8px 20px', borderRadius: 7, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.8rem', color: canStart ? 'var(--sui-blue-ink)' : '#64748b', background: canStart ? 'var(--sui-blue)' : '#1e293b' }}>
                ⚡ Start Auto Bot
              </button>
          }
        </div>
      </div>

      {/* ═══════════════════════ CONFIG PANEL ═══════════════════════ */}
      {showConfig && (
        <div style={{ background: '#080d1a', borderBottom: '1px solid #1e293b', padding: '20px 20px 16px' }}>

          {/* ── Auto Bot info (slim strip) ── */}
          <div style={{
            marginBottom: 16, borderRadius: 8, padding: '8px 14px',
            background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
            display: 'flex', alignItems: 'center', gap: 10, rowGap: 4, flexWrap: 'wrap',
            fontSize: '0.7rem', color: '#94a3b8',
          }}>
            <span style={{ fontSize: '1rem' }}>⚡</span>
            <span style={{ fontWeight: 700, color: '#f87171' }}>Auto Bot · self-signs 24/7</span>
            <span style={{ color: '#334155' }}>·</span>
            <span>SUI/USDC (DeepBook Margin) + BTC/USDC (DeepTrade)</span>
            <span style={{ color: '#334155' }}>·</span>
            <span style={{ color: aiCheckEnabled ? 'var(--sui-blue)' : '#22c55e' }}>{aiCheckEnabled ? '🤖 AI check ON (API cost)' : '$0 LLM'}</span>
            <span style={{ color: '#334155' }}>·</span>
            <span>fee 0.01 SUI/open (0.005 author + 0.005 market), close free</span>
          </div>

          {/* ── SHARED CONFIG ── */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            {/* Bot Skill */}
            <div>
              <label style={{ fontSize: '0.68rem', color: '#64748b', display: 'block', marginBottom: 4 }}>🤖 Bot Skill *</label>
              <select value={selectedSkill?.name || ''} onChange={e => setSelectedSkill(botSkills.find(s => s.name === e.target.value) || null)}
                style={{ ...inp, border: `1px solid ${selectedSkill ? 'rgba(99,102,241,0.5)' : '#1e293b'}` }}>
                <option value="">— Select Bot Skill —</option>
                {botSkills.length === 0 && <option disabled value="">No skills — create one in Skill Factory</option>}
                {botSkills.map(s => <option key={s.name} value={s.name}>🤖 {s.name}</option>)}
              </select>
              {selectedSkill && (
                <div style={{ marginTop: 4, fontSize: '0.6rem', color: '#6366f1', lineHeight: 1.5 }}>
                  {SIGNAL_LABELS[selectedSkill.signal]} · {selectedSkill.leverage}x · TP {selectedSkill.takeProfitPct}% / SL {selectedSkill.stopLossPct}%
                  {selectedSkill.direction !== 'both' && ` · ${selectedSkill.direction === 'long_only' ? '↑Long' : '↓Short'}`}
                </div>
              )}
            </div>

            {/* Pair — BTC/USDC and SUI/USDC */}
            <div>
              <label style={{ fontSize: '0.68rem', color: '#64748b', display: 'block', marginBottom: 4 }}>Trading Pair</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {PAIR_OPTIONS.map(p => (
                  <button key={p.value}
                    onClick={() => { if (!p.disabled) setPair(p.value); }}
                    disabled={p.disabled}
                    title={p.disabled ? 'BTC/USDC is temporarily under maintenance' : undefined}
                    style={{
                    flex: 1, padding: '6px 4px', borderRadius: 6,
                    cursor: p.disabled ? 'not-allowed' : 'pointer',
                    opacity: p.disabled ? 0.45 : 1,
                    border: `1px solid ${pair === p.value ? p.color + '88' : '#1e293b'}`,
                    background: pair === p.value ? p.color + '18' : 'transparent',
                    color: pair === p.value ? p.color : '#475569',
                    fontSize: '0.7rem', fontWeight: pair === p.value ? 700 : 400,
                  }}>
                    <div>{p.label}</div>
                    <div style={{ fontSize: '0.55rem', opacity: 0.7 }}>{p.disabled ? '🛠 Maintenance' : p.tag}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Timeframe — 5m / 15m / 30m / 1h */}
            <div>
              <label style={{ fontSize: '0.68rem', color: '#64748b', display: 'block', marginBottom: 4 }}>Timeframe</label>
              <div style={{ display: 'flex', gap: 4 }}>
                {TF_OPTIONS.map(t => (
                  <button key={t} onClick={() => setTimeframe(t)} style={{
                    flex: 1, padding: '6px 0', borderRadius: 5,
                    border: `1px solid ${timeframe === t ? '#6366f1' : '#1e293b'}`,
                    background: timeframe === t ? 'rgba(99,102,241,0.15)' : 'transparent',
                    color: timeframe === t ? '#818cf8' : '#475569', fontSize: '0.72rem',
                    fontWeight: timeframe === t ? 700 : 400, cursor: 'pointer',
                  }}>{t}</button>
                ))}
              </div>
            </div>

            {/* Capital */}
            <div>
              <label style={{ fontSize: '0.68rem', color: '#64748b', display: 'block', marginBottom: 4 }}>
                Capital ({isXbtcPair(pair) ? 'USDC' : 'USDC'})
              </label>
              <input type="number" step="0.1" min="0.01" value={capitalSUI}
                onChange={e => setCapitalSUI(Math.max(0.01, parseFloat(e.target.value) || 0.01))} style={inp} />
              {selectedSkill && (
                <div style={{ fontSize: '0.6rem', color: '#334155', marginTop: 3 }}>
                  Order size: {(capitalSUI * selectedSkill.orderPct / 100).toFixed(3)} × {selectedSkill.leverage}x leverage
                </div>
              )}
            </div>
          </div>

          {/* ── DeepTrade (xBTC/USDC) setup — only shown for BTC pair ── */}
          {isXbtcPair(pair) && <div style={{
            borderRadius: 10, padding: 14, marginTop: 4,
            border: '1px solid rgba(245,158,11,0.25)', background: 'rgba(245,158,11,0.04)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: '0.72rem', color: '#f59e0b', fontWeight: 600 }}>⚡ DeepTrade Account (xBTC/USDC)</span>
              <button onClick={handleDeeptradeSetup} disabled={dtSettingUp || !account}
                style={{
                  padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(245,158,11,0.4)',
                  background: 'rgba(245,158,11,0.1)', color: '#f59e0b', fontSize: '0.65rem',
                  cursor: dtSettingUp || !account ? 'not-allowed' : 'pointer', opacity: dtSettingUp || !account ? 0.5 : 1,
                }}>
                {dtSettingUp ? 'Setting up…' : (dtBalanceManager && dtFeeManager ? '✓ Re-run Setup' : 'Run One-Time Setup')}
              </button>
            </div>
            <div style={{ fontSize: '0.6rem', color: '#64748b', marginBottom: 8 }}>
              Real xBTC/USDC orders need a one-time BalanceManager + FeeManager. Click setup to create &amp; sign, or paste existing IDs.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: '0.6rem', color: '#64748b', display: 'block', marginBottom: 3 }}>BalanceManager ID</label>
                <input value={dtBalanceManager} onChange={e => setDtBalanceManager(e.target.value.trim())}
                  placeholder="0x…" style={{ ...inp, fontSize: '0.62rem' }} />
              </div>
              <div>
                <label style={{ fontSize: '0.6rem', color: '#64748b', display: 'block', marginBottom: 3 }}>FeeManager ID</label>
                <input value={dtFeeManager} onChange={e => setDtFeeManager(e.target.value.trim())}
                  placeholder="0x…" style={{ ...inp, fontSize: '0.62rem' }} />
              </div>
            </div>
          </div>}

          {/* ── SUI/USDC DeepBook Margin setup — only shown for the SUI pair ── */}
          {isSuiPair && <div style={{
            borderRadius: 10, padding: 14, marginTop: 4,
            border: '1px solid rgba(77,162,255,0.25)', background: 'rgba(77,162,255,0.04)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: '0.72rem', color: '#00d4ff', fontWeight: 600 }}>
                💧 DeepBook Margin Account (SUI/USDC)
              </span>
              <span style={{ fontSize: '0.62rem', color: suiMarginId ? '#22c55e' : '#f59e0b' }}>
                {suiMarginChecking ? 'Checking…'
                  : suiMarginId ? `✓ Account: ${suiMarginId.slice(0, 8)}…${suiMarginId.slice(-6)}`
                  : '⚠️ No margin account yet'}
              </span>
            </div>
            {/* Prominent banner — explains EXACTLY what funds the bot uses + the min threshold.
                Was previously a small grey caption that users skipped right past. */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(245,158,11,0.10), rgba(245,158,11,0.04))',
              border: '1px solid rgba(245,158,11,0.4)',
              borderLeft: '4px solid #f59e0b',
              borderRadius: 8, padding: '12px 14px', marginBottom: 12,
              display: 'flex', gap: 10, alignItems: 'flex-start',
            }}>
              <span style={{ fontSize: '1.2rem', flexShrink: 0, lineHeight: 1 }}>💰</span>
              <div style={{ fontSize: '0.78rem', color: '#fde68a', lineHeight: 1.55, fontWeight: 500 }}>
                The bot trades with the <strong style={{ color: '#fff' }}>USDC you deposit into this margin pool</strong> —
                it borrows SUI/USDC on DeepBook against your collateral.
                <div style={{ marginTop: 4, fontSize: '0.74rem', color: '#fbbf24', fontWeight: 700 }}>
                  ⚠️ Minimum {MIN_POOL_USDC} USDC required to start the bot.
                </div>
              </div>
            </div>

            {/* Asset Management box — clearly framed so it's obvious this is where
                the bot's capital lives and can be deposited/withdrawn. */}
            {suiMarginId && (
              <div style={{
                background: 'linear-gradient(135deg, #060e1e, #080d1a)',
                borderRadius: 10, padding: '12px 14px', marginBottom: 12,
                border: `1px solid ${poolAssets && poolAssets.quoteAsset < MIN_POOL_USDC ? 'rgba(245,158,11,0.45)' : 'rgba(34,197,94,0.25)'}`,
              }}>
                <div style={{
                  fontSize: '0.62rem', color: '#94a3b8', fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  💎 Asset Management — Margin Pool
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: '0.58rem', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Bot capital (USDC)
                    </div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: poolAssets ? (poolAssets.quoteAsset >= MIN_POOL_USDC ? '#10b981' : '#f59e0b') : '#475569', fontFamily: 'monospace' }}>
                      {poolAssets ? `$${poolAssets.quoteAsset.toFixed(2)}` : '—'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.58rem', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      SUI in pool
                    </div>
                    <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#94a3b8', fontFamily: 'monospace' }}>
                      {poolAssets ? `${poolAssets.baseAsset.toFixed(4)}` : '—'}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: '0.58rem', color: '#475569', marginTop: 6, fontFamily: 'monospace' }}>
                  Account: {suiMarginId.slice(0, 10)}…{suiMarginId.slice(-6)} (shared with Manual Trade)
                </div>
                {/* Locked-collateral note — total > liquid means part is pledged against a borrow */}
                {poolAssets?.hasDebt && (
                  <div style={{ fontSize: '0.6rem', color: '#fbbf24', marginTop: 4, lineHeight: 1.4 }}>
                    ⚠️ Outstanding borrow — total assets ({(poolAssets.totalQuote ?? 0).toFixed(2)} USDC / {(poolAssets.totalBase ?? 0).toFixed(2)} SUI) exceed the liquid amounts above. Repay in Manual Trade to unlock.
                  </div>
                )}
              </div>
            )}

            {/* Low-balance warning */}
            {suiMarginId && poolAssets !== null && poolAssets.quoteAsset < MIN_POOL_USDC && (
              <div style={{
                background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)',
                borderRadius: 6, padding: '8px 12px', marginBottom: 10,
                fontSize: '0.66rem', color: '#fbbf24', lineHeight: 1.5,
              }}>
                ⚠️ Low capital — pool has <strong>${poolAssets.quoteAsset.toFixed(2)} USDC</strong> but the bot needs at least <strong>${MIN_POOL_USDC} USDC</strong> to size a leveraged position safely. Deposit more below — the Start Bot button stays disabled until then.
              </div>
            )}

            {/* Deposit input — USDC only */}
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: '0.6rem', color: '#64748b', display: 'block', marginBottom: 3 }}>
                Deposit amount (USDC)
              </label>
              <input type="number" step="1" min="0" value={suiCollateral}
                onChange={e => setSuiCollateral(Math.max(0, parseFloat(e.target.value) || 0))}
                style={{ ...inp, fontSize: '0.72rem' }} />
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              {!suiMarginId ? (
                <button onClick={handleSuiMarginSetup} disabled={suiMarginBusy || !account}
                  style={{
                    flex: 1, padding: '9px', borderRadius: 7, border: 'none',
                    cursor: suiMarginBusy || !account ? 'not-allowed' : 'pointer',
                    background: account ? 'linear-gradient(135deg,#00d4ff,#0891b2)' : '#1e293b',
                    color: '#fff', fontWeight: 700, fontSize: '0.75rem', opacity: suiMarginBusy ? 0.6 : 1,
                  }}>
                  {suiMarginBusy ? 'Creating…' : `＋ Create Margin Account + Deposit ${suiCollateral} USDC`}
                </button>
              ) : (
                <>
                  <button onClick={handleSuiDeposit} disabled={suiMarginBusy || !account}
                    style={{
                      flex: 1, padding: '9px', borderRadius: 7, border: '1px solid rgba(34,197,94,0.4)',
                      cursor: suiMarginBusy ? 'not-allowed' : 'pointer', background: 'rgba(34,197,94,0.1)',
                      color: '#22c55e', fontWeight: 700, fontSize: '0.72rem', opacity: suiMarginBusy ? 0.6 : 1,
                    }}>
                    {suiMarginBusy ? '…' : `↓ Deposit ${suiCollateral} USDC`}
                  </button>
                  <button onClick={handleSuiWithdraw}
                    disabled={suiMarginBusy || !account || (s.active && poolAssets !== null && (poolAssets.quoteAsset - suiCollateral) < MIN_POOL_USDC)}
                    title={s.active && poolAssets !== null && (poolAssets.quoteAsset - suiCollateral) < MIN_POOL_USDC
                      ? `Stop the bot first — withdrawing would drop pool below $${MIN_POOL_USDC} minimum.`
                      : 'Withdraw USDC back to your wallet'}
                    style={{
                      flex: 1, padding: '9px', borderRadius: 7, border: '1px solid rgba(239,68,68,0.4)',
                      cursor: suiMarginBusy ? 'not-allowed' : 'pointer', background: 'rgba(239,68,68,0.08)',
                      color: '#ef4444', fontWeight: 700, fontSize: '0.72rem', opacity: suiMarginBusy ? 0.6 : 1,
                    }}>
                    {suiMarginBusy ? '…' : `↑ Withdraw ${suiCollateral} USDC`}
                  </button>
                  <button onClick={checkSuiMargin} disabled={suiMarginChecking}
                    style={{
                      padding: '9px 12px', borderRadius: 7, border: '1px solid #1e293b',
                      background: 'transparent', color: '#64748b', fontSize: '0.72rem', cursor: 'pointer',
                    }}>↻</button>
                </>
              )}
            </div>
            {!account && (
              <div style={{ marginTop: 6, fontSize: '0.6rem', color: '#f59e0b' }}>
                ⚠️ Connect a Sui wallet to create the margin account and deposit collateral.
              </div>
            )}
            {/* Cross-link: Manual Trade already has the full margin manager UI (deposit / withdraw /
                open / close positions). Live Trade is the same plumbing, just bot-driven. */}
            {onOpenManualTrade && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #1e293b', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '0.62rem', color: '#475569' }}>
                  Want the full margin UI (deposit / withdraw / borrow / repay)?
                </span>
                <button onClick={onOpenManualTrade}
                  style={{
                    padding: '5px 10px', borderRadius: 6, border: '1px solid #1e293b',
                    background: 'transparent', color: '#00d4ff', fontSize: '0.66rem',
                    cursor: 'pointer', fontWeight: 600,
                  }}>
                  📈 Manage in Manual Trade →
                </button>
              </div>
            )}
          </div>}

          {/* ── AUTO BOT CONFIG (no AI) ── */}
          <div style={{
            borderRadius: 10, padding: 16, border: '1px solid rgba(239,68,68,0.25)',
            background: 'rgba(239,68,68,0.04)',
          }}>

            {/* ─── AUTO BOT (DIRECT) CONFIG ─── */}
            {mode === 'direct' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#f87171' }}>⚡ Auto Bot Config (no AI needed)</div>
                    <div style={{ fontSize: '0.65rem', color: '#64748b', marginTop: 2 }}>Bot emits signal → self-signs with keypair → executes directly on DeepBook Margin</div>
                  </div>
                </div>

                {/* Warning box */}
                <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 8, padding: '10px 14px', fontSize: '0.7rem', color: '#fca5a5', lineHeight: 1.7 }}>
                  <strong>⚠️ Private Key security:</strong><br/>
                  {isDesktop
                    ? <>• Key is stored <strong>in this app on your machine</strong>, never sent to a server<br/></>
                    : <>• Key is kept in RAM only, <strong>never written to disk</strong><br/></>}
                  • Bot self-signs every trade — <strong>no confirmation prompts</strong><br/>
                  • Only use a wallet with small capital for testing. Risk is entirely yours.
                </div>

                {/* Dev Wallet từ .env — hiển thị nếu server có */}
                {usingDevKey && devWallet ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                        <div>
                          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#10b981', display: 'flex', alignItems: 'center', gap: 6 }}>
                            🔑 {devWallet.label}
                            <span style={{ fontSize: '0.6rem', background: 'rgba(16,185,129,0.15)', color: '#34d399', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>DEV</span>
                          </div>
                          <div style={{ fontSize: '0.65rem', color: '#334155', marginTop: 3, fontFamily: 'monospace' }}>
                            {devWallet.address.slice(0, 20)}...{devWallet.address.slice(-8)}
                          </div>
                        </div>
                        <span style={{ fontSize: '0.62rem', color: '#22c55e', background: 'rgba(34,197,94,0.1)', padding: '2px 8px', borderRadius: 4 }}>
                          {isDesktop ? '✓ Loaded from app' : '✓ Loaded from .env'}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.65rem', color: '#475569', lineHeight: 1.6 }}>
                        {isDesktop
                          ? <>Key loaded from this app on your machine · No manual entry needed</>
                          : <>Key auto-loaded from <code style={{ color: '#f59e0b' }}>.env</code> · No manual entry needed</>}
                      </div>
                    </div>
                    <button onClick={() => {
                      // Drop the .env dev key — falls back to wizard-saved key (or none).
                      setUsingDevKey(false); setKeyLoaded(false);
                      fetch(`${AGENT_URL}/api/livebot/clearkey`, { method: 'POST' }).catch(() => {});
                      if (!wizardHasKey && onOpenSetupWizard) onOpenSetupWizard();
                    }} style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #334155', background: 'transparent', color: '#475569', fontSize: '0.7rem', cursor: 'pointer', alignSelf: 'flex-start' }}>
                      Use a different key (opens Wizard)
                    </button>
                  </div>
                ) : wizardHasKey ? (
                  /* Key already set up in the Setup Wizard — read-only status card */
                  <div style={{
                    background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)',
                    borderRadius: 8, padding: '12px 14px',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                  }}>
                    <div>
                      <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 6 }}>
                        ✅ Private key configured
                        <span style={{ fontSize: '0.58rem', background: 'rgba(34,197,94,0.15)', color: '#86efac', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>FROM WIZARD</span>
                      </div>
                      <div style={{ fontSize: '0.63rem', color: '#475569', marginTop: 3, lineHeight: 1.5 }}>
                        Loaded from your Setup Wizard. Bot is ready to self-sign trades.
                      </div>
                    </div>
                    {onOpenSetupWizard && (
                      <button onClick={onOpenSetupWizard} style={{
                        padding: '6px 12px', borderRadius: 6, border: '1px solid #1e293b',
                        background: 'transparent', color: '#64748b', fontSize: '0.66rem',
                        cursor: 'pointer', flexShrink: 0,
                      }}>
                        🔧 Manage in Wizard
                      </button>
                    )}
                  </div>
                ) : (
                  /* No key — point user to the Wizard */
                  <div style={{
                    background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)',
                    borderRadius: 8, padding: '14px 16px',
                    display: 'flex', flexDirection: 'column', gap: 10,
                  }}>
                    <div>
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#fca5a5' }}>
                        🔑 No private key configured
                      </div>
                      <div style={{ fontSize: '0.66rem', color: '#94a3b8', marginTop: 4, lineHeight: 1.6 }}>
                        Auto Bot needs a Sui private key to self-sign trades. Set it up once in the
                        Setup Wizard — {isDesktop
                          ? "it's stored in this app on your machine, never sent to a server."
                          : "it's stored in your browser's sessionStorage only, never sent to a server."}
                      </div>
                    </div>
                    <button
                      onClick={() => onOpenSetupWizard?.()}
                      disabled={!onOpenSetupWizard}
                      style={{
                        alignSelf: 'flex-start',
                        padding: '8px 16px', borderRadius: 7, border: 'none',
                        background: 'linear-gradient(135deg,#ef4444,#dc2626)',
                        color: '#fff', fontWeight: 700, fontSize: '0.75rem',
                        cursor: onOpenSetupWizard ? 'pointer' : 'not-allowed',
                      }}>
                      🔧 Set up private key in Wizard →
                    </button>
                  </div>
                )}

                {/* ── Optional AI safety check ── off by default → $0 LLM cost ── */}
                <div style={{
                  display: isDesktop ? 'none' : undefined,   // desktop app = pure Auto Bot, no AI/API-key layer
                  marginTop: 4, borderRadius: 8, border: '1px solid #1e293b',
                  background: aiCheckEnabled ? 'rgba(77,162,255,0.04)' : '#080d1a',
                }}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 14px',
                  }}>
                    <div onClick={() => setAiCheckEnabled(v => !v)} style={{ cursor: 'pointer', flex: 1 }}>
                      <div style={{ fontSize: '0.74rem', fontWeight: 700, color: aiCheckEnabled ? 'var(--sui-blue)' : '#94a3b8' }}>
                        🤖 AI Safety Check {aiCheckEnabled ? '· ON' : '· OFF (default)'}
                      </div>
                      <div style={{ fontSize: '0.62rem', color: '#475569', marginTop: 2 }}>
                        {aiCheckEnabled
                          ? 'Every signal goes through an LLM verdict before signing. Uses API credits.'
                          : 'Pure Auto Bot — $0 LLM cost. Toggle on to add an extra approve/reject layer.'}
                      </div>
                    </div>
                    <Toggle val={aiCheckEnabled} onChange={() => setAiCheckEnabled(v => !v)} color="#00d4ff" />
                  </div>

                  {aiCheckEnabled && (
                    <div style={{ padding: '0 14px 12px', display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid #1e293b' }}>
                      <div style={{ fontSize: '0.65rem', color: '#64748b', marginTop: 10, lineHeight: 1.5 }}>
                        AI is a <strong style={{ color: '#94a3b8' }}>veto layer only</strong> — it cannot create or modify trades, only approve/reject what the bot computed. On error it defaults to approve.
                      </div>

                      {/* Provider tabs */}
                      <div style={{ display: 'flex', gap: 4 }}>
                        {(['gemini','deepseek','openclaw'] as const).map(p => (
                          <button key={p} onClick={() => setAiCheckProvider(p)} style={{
                            flex: 1, padding: '6px', borderRadius: 6,
                            border: `1px solid ${aiCheckProvider === p ? '#00d4ff66' : '#1e293b'}`,
                            background: aiCheckProvider === p ? 'rgba(77,162,255,0.08)' : 'transparent',
                            color: aiCheckProvider === p ? 'var(--sui-blue)' : '#475569',
                            fontSize: '0.68rem', fontWeight: aiCheckProvider === p ? 700 : 400, cursor: 'pointer',
                          }}>
                            {p === 'gemini' ? '🔷 Gemini' : p === 'deepseek' ? '🔮 DeepSeek' : '🐾 OpenClaw'}
                          </button>
                        ))}
                      </div>

                      {/* API key — hidden for openclaw (reads openclaw.json) */}
                      {aiCheckProvider !== 'openclaw' ? (
                        <div>
                          <label style={{ fontSize: '0.62rem', color: '#64748b', display: 'block', marginBottom: 3 }}>
                            {aiCheckProvider === 'gemini' ? 'Gemini API Key' : 'DeepSeek API Key'} <span style={{ color: '#ef4444' }}>*</span>
                          </label>
                          <input type="password"
                            placeholder={aiCheckProvider === 'gemini' ? 'AIza...' : 'sk-...'}
                            value={aiCheckApiKey} onChange={e => setAiCheckApiKey(e.target.value)}
                            style={{ ...inp, fontSize: '0.7rem' }} />
                          <div style={{ fontSize: '0.58rem', color: '#334155', marginTop: 4 }}>
                            Stored locally only. Sent direct from your agent to {aiCheckProvider === 'gemini' ? 'Google' : 'DeepSeek'}.
                          </div>
                        </div>
                      ) : (
                        <div style={{ fontSize: '0.62rem', color: '#818cf8', background: 'rgba(99,102,241,0.06)', borderRadius: 5, padding: '6px 10px', border: '1px solid rgba(99,102,241,0.15)' }}>
                          🐾 OpenClaw reads its config from <code style={{ color: '#f59e0b' }}>openclaw.json</code> in the agent folder. No key needed here.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════ DASHBOARD ═══════════════════════ */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 0, padding: '12px 12px 0' }}>

        {/* ── Card 1: Live Candlestick Chart ── */}
        <div style={{ background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 12, padding: 14, margin: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
            <div style={{ fontSize: '0.6rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
              📈 {PAIR_LABEL(s.config?.pair || pair)} · {s.config?.timeframe || timeframe} · LIVE
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
              background: `${sc}15`, border: `1px solid ${sc}44`, borderRadius: 20, padding: '2px 10px' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: sc, boxShadow: s.signal !== 'HOLD' ? `0 0 6px ${sc}` : 'none' }} />
              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: sc }}>{s.signal}</span>
            </div>
          </div>

          <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#e2e8f0', fontFamily: 'monospace', letterSpacing: -1, marginBottom: 8 }}>
            ${s.price > 0 ? s.price.toLocaleString()
              : chartCandles.length > 0 ? chartCandles[chartCandles.length - 1].close.toLocaleString() : '---'}
          </div>

          {/* Indicator overlay toggles — EMA / MA / Bollinger / Supertrend */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            {([
              ['ema', 'EMA', '#f59e0b'],
              ['ma', 'MA', '#a855f7'],
              ['boll', 'BOLL', '#64748b'],
              ['st', 'Supertrend', '#22c55e'],
            ] as const).map(([key, label, color]) => {
              const on = overlays[key];
              return (
                <button key={key} onClick={() => setOverlays(o => ({ ...o, [key]: !o[key] }))}
                  style={{
                    fontSize: '0.62rem', fontWeight: 700, padding: '3px 10px', borderRadius: 14, cursor: 'pointer',
                    border: `1px solid ${on ? color : '#1e293b'}`,
                    background: on ? `${color}22` : 'transparent',
                    color: on ? color : '#475569', transition: 'all 0.15s',
                  }}>
                  {label}
                </button>
              );
            })}
          </div>

          {/* Candles + Entry/TP/SL lines + ▲▼ trade markers — same data the bot trades on */}
          <CandleChart
            candles={chartCandles}
            position={pos}
            overlays={overlays}
            marks={displayHistory.flatMap((r: any) => {
              const m: ChartTradeMark[] = [];
              if (r.openTime)  m.push({ time: r.openTime,  side: r.side, price: r.entry });
              if (r.closeTime && r.exit != null) m.push({ time: r.closeTime, side: r.side, price: r.exit, isClose: true });
              return m;
            })}
            height={230}
          />

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: '0.62rem', color: '#334155' }}>
            <span>BB: {ind.bbLower > 0 ? ind.bbLower.toFixed(4) : '---'} – {ind.bbUpper > 0 ? ind.bbUpper.toFixed(4) : '---'}</span>
            <span>🕒 {s.lastUpdate || 'Not updated'}</span>
          </div>
        </div>

        {/* ── Card 2: Indicators ── */}
        <div style={{ background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 12, padding: 14, margin: 4, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: '0.6rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>📊 Technical Indicators</div>

          {/* RSI */}
          <div>
            <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginBottom: 6 }}>RSI (14)</div>
            <RsiBar value={ind.rsi} />
          </div>

          {/* EMA */}
          <div>
            <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginBottom: 4 }}>EMA Cross</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ background: '#060e1e', borderRadius: 5, padding: '4px 8px', border: '1px solid #1e293b' }}>
                <span style={{ fontSize: '0.6rem', color: '#475569' }}>EMA9 </span>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#00d4ff', fontFamily: 'monospace' }}>${ind.ema9 > 0 ? Math.round(ind.ema9).toLocaleString() : '--'}</span>
              </div>
              <span style={{ fontSize: '1.1rem', color: ind.ema9 > ind.ema21 ? '#22c55e' : '#ef4444', fontWeight: 900 }}>
                {ind.ema9 > ind.ema21 ? '▲' : '▼'}
              </span>
              <div style={{ background: '#060e1e', borderRadius: 5, padding: '4px 8px', border: '1px solid #1e293b' }}>
                <span style={{ fontSize: '0.6rem', color: '#475569' }}>EMA21 </span>
                <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#f59e0b', fontFamily: 'monospace' }}>${ind.ema21 > 0 ? Math.round(ind.ema21).toLocaleString() : '--'}</span>
              </div>
            </div>
          </div>

          {/* MACD */}
          <div>
            <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginBottom: 4 }}>MACD Histogram</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                height: 8, flex: 1, borderRadius: 4, position: 'relative', background: '#1e293b', overflow: 'hidden',
              }}>
                <div style={{
                  position: 'absolute', height: '100%', width: `${Math.min(100, Math.abs(ind.macdHist) * 10)}%`,
                  background: ind.macdHist >= 0 ? '#22c55e' : '#ef4444',
                  left: ind.macdHist >= 0 ? '50%' : `${50 - Math.min(50, Math.abs(ind.macdHist) * 10)}%`,
                  borderRadius: 4,
                }} />
              </div>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: ind.macdHist >= 0 ? '#22c55e' : '#ef4444', fontFamily: 'monospace', minWidth: 60, textAlign: 'right' }}>
                {ind.macdHist >= 0 ? '+' : ''}{ind.macdHist}
              </span>
            </div>
          </div>

          {/* Strategy label */}
          {s.config && (
            <div style={{ marginTop: 'auto', fontSize: '0.65rem', color: '#334155', background: '#080d1a', borderRadius: 5, padding: '5px 8px', border: '1px solid #1e293b' }}>
              📡 {SIGNAL_LABELS[s.config.signal as any] || s.config.signal}
            </div>
          )}
        </div>

        {/* ── Card 3: Position ── */}
        <div style={{ background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 12, padding: 14, margin: 4 }}>
          <div style={{ fontSize: '0.6rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>📈 Current Position</div>

          {pos ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Type + Time */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{
                  fontSize: '0.88rem', fontWeight: 800, padding: '4px 14px', borderRadius: 20,
                  background: pos.type === 'LONG' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                  color: pos.type === 'LONG' ? '#22c55e' : '#ef4444',
                  border: `1px solid ${pos.type === 'LONG' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                }}>{pos.type}</span>
                <span style={{ fontSize: '0.62rem', color: '#334155' }}>{new Date(pos.entryTime).toLocaleTimeString('en-US')}</span>
              </div>

              {/* Price grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {[
                  ['Entry', `$${pos.entryPrice.toLocaleString()}`, '#94a3b8'],
                  ['Current', `$${s.price.toLocaleString()}`, s.price >= pos.entryPrice ? '#22c55e' : '#ef4444'],
                  ['Take Profit', `$${pos.tpPrice.toLocaleString()}`, '#22c55e'],
                  ['Stop Loss', `$${pos.slPrice.toLocaleString()}`, '#ef4444'],
                ].map(([l, v, c]) => (
                  <div key={l} style={{ background: '#080d1a', borderRadius: 7, padding: '7px 8px', border: '1px solid #1e293b' }}>
                    <div style={{ fontSize: '0.58rem', color: '#334155' }}>{l}</div>
                    <div style={{ fontSize: '0.76rem', fontWeight: 700, color: c, fontFamily: 'monospace', marginTop: 2 }}>{v}</div>
                  </div>
                ))}
              </div>

              {/* PnL */}
              <div style={{
                borderRadius: 8, padding: '10px 14px', textAlign: 'center',
                background: pos.unrealizedPct >= 0 ? 'rgba(34,197,94,0.07)' : 'rgba(239,68,68,0.07)',
                border: `1px solid ${pos.unrealizedPct >= 0 ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
              }}>
                <div style={{ fontSize: '0.6rem', color: '#475569', marginBottom: 2 }}>Unrealized P&L</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 900, fontFamily: 'monospace', color: pos.unrealizedPct >= 0 ? '#22c55e' : '#ef4444' }}>
                  {pos.unrealizedPct >= 0 ? '+' : ''}{pos.unrealizedPct.toFixed(2)}%
                </div>
              </div>

              {/* Progress bar TP/SL (chỉ LONG) */}
              {s.price > 0 && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.58rem', color: '#334155', marginBottom: 3 }}>
                    <span>SL</span><span>Entry</span><span>TP</span>
                  </div>
                  <div style={{ height: 5, background: '#1e293b', borderRadius: 3, position: 'relative' }}>
                    <div style={{ height: '100%', borderRadius: 3, background: 'linear-gradient(90deg, #ef444440, #22c55e40)' }} />
                    {(() => {
                      const lo = pos.type === 'LONG' ? pos.slPrice : pos.tpPrice;
                      const hi = pos.type === 'LONG' ? pos.tpPrice : pos.slPrice;
                      const pct = Math.min(100, Math.max(0, ((s.price - lo) / (hi - lo)) * 100));
                      return <div style={{ position: 'absolute', top: -2.5, left: `${pct}%`, transform: 'translateX(-50%)', width: 10, height: 10, borderRadius: '50%', background: '#00d4ff', boxShadow: '0 0 6px #00d4ff' }} />;
                    })()}
                  </div>
                </div>
              )}

              {/* Emergency manual close — bypasses TP/SL/signal logic */}
              <button
                onClick={async () => {
                  if (!confirm(`Close the ${pos.type} position NOW at market price?\n\nThis bypasses TP/SL and executes immediately on chain.`)) return;
                  setClosingNow(true);
                  try {
                    const r = await fetch(`${AGENT_URL}/api/livebot/closenow`, { method: 'POST' });
                    const j = await r.json().catch(() => ({}));
                    if (!r.ok) alert(j.message || 'Close failed — check the bot log.');
                  } catch { alert('Cannot reach the Local Agent.'); }
                  finally { setClosingNow(false); }
                }}
                disabled={closingNow}
                style={{
                  width: '100%', padding: '9px', borderRadius: 7, border: '1px solid rgba(239,68,68,0.5)',
                  background: 'rgba(239,68,68,0.12)', color: '#f87171', fontWeight: 700,
                  fontSize: '0.74rem', cursor: closingNow ? 'not-allowed' : 'pointer',
                }}>
                {closingNow ? 'Closing…' : '✋ Close position now (market)'}
              </button>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#1e293b' }}>
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>😴</div>
              <div style={{ fontSize: '0.75rem', color: '#334155' }}>{s.active ? 'Waiting for signal...' : 'Start the bot to begin'}</div>
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════ TRADE HISTORY ═══════════════════════ */}
      <div style={{ padding: '0 12px' }}>
        <div style={{ background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 12, padding: 14, margin: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: '0.6rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
              📜 Trade History ({displayHistory.length})
            </div>
            <button onClick={refreshChartData}
              style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid #1e293b', background: 'transparent', color: '#334155', fontSize: '0.62rem', cursor: 'pointer' }}>
              ↻ Refresh
            </button>
          </div>

          {displayHistory.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '14px 0', fontSize: '0.72rem', color: '#1e293b' }}>
              No trades yet — records appear here when the bot opens its first position.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.68rem' }}>
                <thead>
                  <tr style={{ color: '#475569', textAlign: 'left' }}>
                    {['Time', 'Side', 'Pair', 'Entry', 'Exit', 'PnL', 'Reason', 'Skill', 'Tx'].map(h => (
                      <th key={h} style={{ padding: '4px 8px', borderBottom: '1px solid #1e293b', fontWeight: 600, fontSize: '0.6rem', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayHistory.slice(0, 25).map((r: any) => (
                    <tr key={r.id} style={{ color: '#94a3b8' }}>
                      <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontSize: '0.62rem', whiteSpace: 'nowrap' }}>
                        {new Date(r.openTime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ padding: '5px 8px' }}>
                        <span style={{
                          padding: '1px 7px', borderRadius: 4, fontWeight: 700, fontSize: '0.62rem',
                          background: r.side === 'LONG' ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
                          color: r.side === 'LONG' ? '#22c55e' : '#ef4444',
                        }}>{r.side}</span>
                      </td>
                      <td style={{ padding: '5px 8px', fontSize: '0.62rem' }}>{(r.pair || '').replace('_', '/')}</td>
                      <td style={{ padding: '5px 8px', fontFamily: 'monospace' }}>${Number(r.entry).toFixed(4)}</td>
                      <td style={{ padding: '5px 8px', fontFamily: 'monospace' }}>
                        {r.exit != null ? `$${Number(r.exit).toFixed(4)}` : <span style={{ color: '#00d4ff' }}>open</span>}
                      </td>
                      <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontWeight: 700,
                        color: r.pnlPct == null ? '#475569' : r.pnlPct >= 0 ? '#22c55e' : '#ef4444' }}>
                        {r.pnlPct == null ? '—' : `${r.pnlPct >= 0 ? '+' : ''}${Number(r.pnlPct).toFixed(1)}%`}
                      </td>
                      <td style={{ padding: '5px 8px', fontSize: '0.62rem' }}>
                        <span style={{ color: EXIT_REASON_COLORS[r.reason as string] ?? '#475569' }}>{r.reason ?? '—'}</span>
                      </td>
                      <td style={{ padding: '5px 8px', fontSize: '0.6rem', color: '#475569' }}>{r.skill}</td>
                      <td style={{ padding: '5px 8px', fontSize: '0.6rem' }}>
                        {(r.closeTx || r.openTx) ? (
                          <a href={`https://suiscan.xyz/mainnet/tx/${r.closeTx || r.openTx}`} target="_blank" rel="noreferrer"
                            style={{ color: '#00d4ff', textDecoration: 'none', fontFamily: 'monospace' }}>
                            {(r.closeTx || r.openTx).slice(0, 8)}…↗
                          </a>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ═══════════════════════ STATS + LOG ═══════════════════════ */}
      <div style={{ display: 'grid', gridTemplateColumns: '260px 1fr', gap: 0, padding: '0 12px 12px' }}>

        {/* Stats */}
        <div style={{ background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 12, padding: 14, margin: 4 }}>
          <div style={{ fontSize: '0.6rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>📊 Summary</div>
          {[
            { l: 'Total Trades',  v: s.tradeCount,                                 c: '#e2e8f0' },
            { l: 'Total PnL',   v: `${s.totalPnl >= 0 ? '+' : ''}${s.totalPnl} SUI`, c: s.totalPnl >= 0 ? '#22c55e' : '#ef4444' },
            { l: 'Mode',     v: activeMode === 'direct' ? '⚡ Auto Bot' : '🤖 AI Bot', c: activeMode === 'direct' ? '#f87171' : '#00d4ff' },
            { l: 'Timeframe',  v: s.config?.timeframe || timeframe,               c: '#f59e0b' },
            { l: 'Leverage',    v: s.config?.leverage ? `${s.config.leverage}x` : '--', c: '#818cf8' },
          ].map(x => (
            <div key={x.l} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #0d1525' }}>
              <span style={{ fontSize: '0.7rem', color: '#475569' }}>{x.l}</span>
              <span style={{ fontSize: '0.73rem', fontWeight: 700, color: x.c, fontFamily: 'monospace' }}>{x.v}</span>
            </div>
          ))}

          {/* Mode info */}
          <div style={{ marginTop: 10, fontSize: '0.65rem', lineHeight: 1.7, color: '#334155' }}>
            {mode === 'direct'
              ? (wizardHasKey || usingDevKey) ? '🔑 Key loaded → bot runs fully autonomously' : '⚠️ Private key required — set up in Wizard'
              : autoConfirm ? '⚡ Auto-confirm ON → orders auto-confirm' : '✋ Each order needs popup confirmation'
            }
          </div>
        </div>

        {/* Log */}
        <div style={{ background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 12, padding: 14, margin: 4, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontSize: '0.6rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>📋 Bot Log ({s.logs.length})</div>
            <button onClick={() => wsRef.current?.send(JSON.stringify({ type: 'GET_STATE' }))}
              style={{ padding: '2px 8px', borderRadius: 4, border: '1px solid #1e293b', background: 'transparent', color: '#334155', fontSize: '0.62rem', cursor: 'pointer' }}>
              ↻ Refresh
            </button>
          </div>
          <div ref={logsRef} style={{ flex: 1, overflowY: 'auto', maxHeight: 200, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {s.logs.length === 0
              ? <div style={{ textAlign: 'center', padding: '20px 0', fontSize: '0.75rem', color: '#1e293b' }}>Start the bot to see logs...</div>
              : s.logs.map(log => (
                <div key={log.id} style={{
                  display: 'flex', gap: 8, padding: '4px 6px', borderRadius: 4, alignItems: 'flex-start',
                  background: log.type === 'trade' ? 'rgba(34,197,94,0.03)' : log.type === 'error' ? 'rgba(239,68,68,0.03)' : 'transparent',
                }}>
                  <span style={{ fontSize: '0.7rem', flexShrink: 0 }}>{LOG_ICONS[log.type]}</span>
                  <span style={{ fontSize: '0.6rem', color: '#334155', flexShrink: 0, fontFamily: 'monospace' }}>{log.time}</span>
                  <span style={{ fontSize: '0.68rem', color: LOG_COLORS[log.type], flex: 1, lineHeight: 1.4 }}>{log.msg}</span>
                  {log.pnl !== undefined && (
                    <span style={{ fontSize: '0.65rem', fontFamily: 'monospace', flexShrink: 0, fontWeight: 700, color: log.pnl >= 0 ? '#22c55e' : '#ef4444' }}>
                      {log.pnl >= 0 ? '+' : ''}{log.pnl}
                    </span>
                  )}
                </div>
              ))
            }
          </div>
        </div>
      </div>

      {/* ═══════════════════════ PENDING TX MODAL (AI Mode — removed) ═══════════════════════ */}
    </div>
  );
};
