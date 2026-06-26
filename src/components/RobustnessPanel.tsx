/**
 * RobustnessPanel — stress-test a backtest config so users don't ship over-fit bots.
 *
 * The Optimizer finds parameters that look great on the WHOLE period — which is
 * exactly how strategies get curve-fit. This panel re-uses the pure runBacktest to
 * ask three harder questions on the CURRENT config:
 *   1. Period stability (walk-forward-lite): run the config on K consecutive slices
 *      of the data. If the edge is real it shows up across periods, not just one.
 *   2. Monte-Carlo: resample the trade P&L sequence 1000× → a distribution of final
 *      return + max drawdown. Exposes how much the headline depends on trade luck.
 *   3. Verdict: Robust / Caution / Overfit-risk from the above.
 *
 * All client-side, synchronous, no network. Approximations are labelled.
 */
import React, { useState } from 'react';
import { runBacktest, type BacktestConfig, type Candle } from '../agent/backtestEngine';

const K = 6;       // walk-forward slices
const MC_RUNS = 1000;

interface SegResult { netPct: number; trades: number }
interface McResult { median: number; p5: number; p95: number; ddMed: number; ddP95: number; profitable: number }
interface Analysis {
  headlineNet: number; totalTrades: number;
  segments: SegResult[];
  mc: McResult | null;
  verdict: 'robust' | 'caution' | 'overfit' | 'insufficient';
  reasons: string[];
}

function analyze(data: Candle[], cfg: BacktestConfig): Analysis {
  const initCap = cfg.initialCapital || 1000;
  const full = runBacktest(data, cfg);
  const trades = full.trades;

  // ── 1. Period stability — K consecutive slices ──
  const segments: SegResult[] = [];
  const segLen = Math.floor(data.length / K);
  if (segLen >= 60) {
    for (let i = 0; i < K; i++) {
      const slice = data.slice(i * segLen, i === K - 1 ? data.length : (i + 1) * segLen);
      const r = runBacktest(slice, cfg);
      segments.push({ netPct: r.stats.netProfitPct, trades: r.stats.totalTrades });
    }
  }

  // ── 2. Monte-Carlo — resample trade $ P&L with replacement ──
  const rets = trades.map(t => t.profitVal);
  let mc: McResult | null = null;
  if (rets.length >= 5) {
    const n = rets.length;
    const finals: number[] = new Array(MC_RUNS);
    const dds: number[] = new Array(MC_RUNS);
    for (let r = 0; r < MC_RUNS; r++) {
      let eq = 0, peak = 0, dd = 0;
      for (let k = 0; k < n; k++) {
        eq += rets[(Math.random() * n) | 0];
        if (eq > peak) peak = eq;
        const d = peak - eq; if (d > dd) dd = d;
      }
      finals[r] = (eq / initCap) * 100;
      dds[r] = (dd / initCap) * 100;
    }
    finals.sort((a, b) => a - b); dds.sort((a, b) => a - b);
    const q = (arr: number[], p: number) => arr[Math.min(arr.length - 1, Math.floor(p * (arr.length - 1)))];
    mc = {
      median: q(finals, 0.5), p5: q(finals, 0.05), p95: q(finals, 0.95),
      ddMed: q(dds, 0.5), ddP95: q(dds, 0.95),
      profitable: (finals.filter(x => x > 0).length / MC_RUNS) * 100,
    };
  }

  // ── 3. Verdict ──
  const reasons: string[] = [];
  let verdict: Analysis['verdict'] = 'caution';
  if (!segments.length || trades.length < 5) {
    verdict = 'insufficient';
    reasons.push('Not enough data/trades to judge — use a longer period or a more active config.');
  } else {
    const profSegs = segments.filter(s => s.netPct > 0).length;
    const posSum = segments.reduce((s, x) => s + Math.max(0, x.netPct), 0);
    const maxSeg = Math.max(...segments.map(s => s.netPct), 0);
    const concentration = posSum > 0 ? maxSeg / posSum : 1;  // 1 ⇒ all profit from one slice
    const mcOk = !mc || mc.profitable >= 60;
    const mcBad = mc && mc.profitable < 40;

    if (profSegs >= Math.ceil(K * 0.66) && concentration < 0.6 && mcOk) verdict = 'robust';
    else if (profSegs <= Math.floor(K * 0.34) || concentration > 0.85 || mcBad) verdict = 'overfit';
    else verdict = 'caution';

    reasons.push(`${profSegs}/${K} periods profitable`);
    if (concentration >= 0.6) reasons.push(`${Math.round(concentration * 100)}% of the gains come from a single period`);
    if (mc) reasons.push(`${Math.round(mc.profitable)}% of Monte-Carlo runs end profitable`);
  }

  return { headlineNet: full.stats.netProfitPct, totalTrades: trades.length, segments, mc, verdict, reasons };
}

const VERDICT_UI: Record<Analysis['verdict'], { label: string; color: string; bg: string }> = {
  robust:       { label: '✅ Robust',          color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  caution:      { label: '⚠️ Use with caution', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)' },
  overfit:      { label: '🚩 Overfit risk',     color: '#ef4444', bg: 'rgba(239,68,68,0.12)' },
  insufficient: { label: '— Inconclusive',      color: '#64748b', bg: 'rgba(100,116,139,0.12)' },
};

const fmt = (n: number, d = 1) => `${n >= 0 ? '+' : ''}${n.toFixed(d)}%`;

const RobustnessPanel: React.FC<{ baseCfg: BacktestConfig; data: Candle[]; onClose: () => void }> = ({ baseCfg, data, onClose }) => {
  const [running, setRunning] = useState(false);
  const [res, setRes] = useState<Analysis | null>(null);

  const run = () => {
    setRunning(true);
    setTimeout(() => {
      try { setRes(analyze(data, baseCfg)); } catch { /* leave null */ }
      setRunning(false);
    }, 20);
  };

  const v = res ? VERDICT_UI[res.verdict] : null;

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(2,6,18,0.7)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', overflowY: 'auto',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: '100%', maxWidth: 560, background: '#0a0f1d', border: '1px solid #1e293b',
        borderRadius: 16, padding: 20, boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0, color: '#fff', fontSize: '1.25rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 10 }}>
            🧪 Robustness Lab
          </h2>
          <button onClick={onClose} style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #334155', background: '#0f172a', color: '#94a3b8', fontSize: '0.85rem', cursor: 'pointer' }}>✕ Close</button>
        </div>
        <p style={{ margin: '0 0 16px', color: '#64748b', fontSize: '0.78rem', lineHeight: 1.5 }}>
          Stress-tests the <strong style={{ color: '#94a3b8' }}>current Tester config</strong> so you don't ship an over-fit
          bot. Walk-forward across {K} periods + {MC_RUNS}-run Monte-Carlo on the trade sequence.
        </p>

        {!res ? (
          <button onClick={run} disabled={running || data.length < 120} style={{
            width: '100%', padding: 12, borderRadius: 10, border: 'none', cursor: data.length < 120 ? 'not-allowed' : 'pointer',
            background: running ? '#1e293b' : 'linear-gradient(135deg,#8b5cf6,#6366f1)', color: '#fff', fontWeight: 800, fontSize: '0.9rem',
          }}>
            {running ? '⚙️ Stress-testing…' : data.length < 120 ? 'Need a longer data window' : '▶ Run robustness analysis'}
          </button>
        ) : (
          <>
            {/* Verdict */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, background: v!.bg, border: `1px solid ${v!.color}55`, marginBottom: 14 }}>
              <span style={{ color: v!.color, fontWeight: 800, fontSize: '1rem' }}>{v!.label}</span>
              <span style={{ color: '#64748b', fontSize: '0.72rem', marginLeft: 'auto' }}>
                full period {fmt(res.headlineNet)} · {res.totalTrades} trades
              </span>
            </div>
            <ul style={{ margin: '0 0 16px', paddingLeft: 18, color: '#94a3b8', fontSize: '0.76rem', lineHeight: 1.7 }}>
              {res.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>

            {/* Period stability */}
            {res.segments.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: '0.6rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  Walk-forward · {K} periods (oldest → newest)
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {res.segments.map((s, i) => {
                    const pos = s.netPct >= 0;
                    return (
                      <div key={i} title={`Period ${i + 1}: ${fmt(s.netPct)} · ${s.trades} trades`} style={{ flex: 1, textAlign: 'center' }}>
                        <div style={{
                          height: 40, borderRadius: 5, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                          background: pos ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
                          border: `1px solid ${pos ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                          color: pos ? '#22c55e' : '#ef4444', fontSize: '0.62rem', fontWeight: 700, fontFamily: 'monospace', paddingBottom: 4,
                        }}>{fmt(s.netPct, 0)}</div>
                        <div style={{ fontSize: '0.55rem', color: '#475569', marginTop: 3 }}>{s.trades}t</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Monte-Carlo */}
            {res.mc && (
              <div>
                <div style={{ fontSize: '0.6rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
                  Monte-Carlo · {MC_RUNS} resamples of the trade sequence
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                  {[
                    { l: 'Return p5 (bad)', v: fmt(res.mc.p5), c: res.mc.p5 >= 0 ? '#22c55e' : '#ef4444' },
                    { l: 'Return median', v: fmt(res.mc.median), c: res.mc.median >= 0 ? '#22c55e' : '#ef4444' },
                    { l: 'Return p95 (good)', v: fmt(res.mc.p95), c: '#22c55e' },
                    { l: '% runs profitable', v: `${Math.round(res.mc.profitable)}%`, c: res.mc.profitable >= 60 ? '#22c55e' : res.mc.profitable >= 40 ? '#f59e0b' : '#ef4444' },
                    { l: 'Max DD median', v: `-${res.mc.ddMed.toFixed(1)}%`, c: '#94a3b8' },
                    { l: 'Max DD p95 (bad)', v: `-${res.mc.ddP95.toFixed(1)}%`, c: '#f59e0b' },
                  ].map(x => (
                    <div key={x.l} style={{ textAlign: 'center', background: '#080d1a', borderRadius: 6, padding: '6px 4px' }}>
                      <div style={{ fontSize: '0.52rem', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.3 }}>{x.l}</div>
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: x.c, fontFamily: 'monospace' }}>{x.v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: '0.62rem', color: '#475569', marginTop: 8, lineHeight: 1.5 }}>
                  Additive resampling of realised trade P&L — a fixed-stake approximation. "p5" = the unlucky 5% tail.
                </div>
              </div>
            )}

            <button onClick={() => setRes(null)} style={{
              width: '100%', marginTop: 16, padding: 10, borderRadius: 8, border: '1px solid #334155',
              background: 'transparent', color: '#94a3b8', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
            }}>↻ Run again</button>
          </>
        )}
      </div>
    </div>
  );
};

export default RobustnessPanel;
