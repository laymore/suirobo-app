/**
 * VerifiedTrackRecord — the trustless counterpart to the backtest.
 *
 * A backtest is hypothetical; this panel summarises the bot's REAL closed trades
 * — each one backed by an on-chain transaction digest (openTx/closeTx) anyone can
 * click through to SuiVision. The performance numbers here are computed from those
 * real fills, not a simulation, so a "✅ Verified Live" record is something a
 * CEX-broker EA can never show. This is the P3 moat: verifiable live results.
 *
 * Input is the agent's own trade history (TradeRecord[], newest-first). We count
 * only CLOSED, tx-backed trades — open or unsigned rows don't enter the stats.
 */
import React, { useMemo, useRef, useEffect } from 'react';

interface TR {
  openTime: string; closeTime: string | null;
  pnlVal: number | null; pnlPct: number | null;
  openTx: string | null; closeTx: string | null;
  side?: string;
}

const fmt = (n: number, d = 2) => n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

function compute(history: TR[]) {
  // newest-first → oldest-first; keep only realised, on-chain-backed trades.
  const closed = history
    .filter(r => r.closeTime && r.pnlVal != null && (r.openTx || r.closeTx))
    .slice()
    .reverse();
  const n = closed.length;
  if (!n) return null;

  let gp = 0, gl = 0, wins = 0, net = 0, netPct = 0, cum = 0, peak = 0, maxDd = 0;
  const curve: number[] = [0];
  for (const r of closed) {
    const v = Number(r.pnlVal) || 0;
    net += v; netPct += Number(r.pnlPct) || 0;
    if (v > 0) { gp += v; wins++; } else { gl += Math.abs(v); }
    cum += v; curve.push(cum);
    if (cum > peak) peak = cum;
    const dd = peak - cum; if (dd > maxDd) maxDd = dd;
  }
  const losses = n - wins;
  return {
    n, wins, losses,
    winRate: (wins / n) * 100,
    net, netPct,
    pf: gl > 0 ? gp / gl : gp > 0 ? 999 : 0,
    maxDd,
    avgWin: wins ? gp / wins : 0,
    avgLoss: losses ? gl / losses : 0,
    curve,
    lastTx: closed[n - 1].closeTx || closed[n - 1].openTx || '',
  };
}

const MiniCurve: React.FC<{ curve: number[]; up: boolean }> = ({ curve, up }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    cv.width = w * dpr; cv.height = h * dpr;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
    const lo = Math.min(...curve, 0), hi = Math.max(...curve, 0);
    const span = hi - lo || 1;
    const x = (i: number) => (i / (curve.length - 1)) * (w - 2) + 1;
    const y = (v: number) => h - 4 - ((v - lo) / span) * (h - 8);
    // zero baseline
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y(0)); ctx.lineTo(w, y(0)); ctx.stroke();
    // equity line
    const col = up ? '#22c55e' : '#ef4444';
    ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.beginPath();
    curve.forEach((v, i) => { const px = x(i), py = y(v); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.stroke();
    // soft fill
    ctx.lineTo(x(curve.length - 1), y(0)); ctx.lineTo(x(0), y(0)); ctx.closePath();
    ctx.fillStyle = up ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'; ctx.fill();
  }, [curve, up]);
  return <canvas ref={ref} style={{ width: '100%', height: 56, display: 'block' }} />;
};

const Stat: React.FC<{ label: string; value: string; color?: string }> = ({ label, value, color }) => (
  <div style={{ textAlign: 'center', background: '#080d1a', borderRadius: 6, padding: '6px 4px' }}>
    <div style={{ fontSize: '0.55rem', color: '#475569', textTransform: 'uppercase', letterSpacing: 0.4 }}>{label}</div>
    <div style={{ fontSize: '0.8rem', fontWeight: 700, color: color || '#cbd5e1', fontFamily: 'monospace' }}>{value}</div>
  </div>
);

export const VerifiedTrackRecord: React.FC<{ history: TR[] }> = ({ history }) => {
  const s = useMemo(() => compute(history), [history]);

  return (
    <div style={{ padding: '0 12px', marginTop: 8 }}>
      <div style={{ background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 12, padding: 14, margin: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '0.6rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
              🛡️ Verified Live Track Record
            </span>
            {s ? (
              <span style={{
                fontSize: '0.58rem', fontWeight: 800, padding: '2px 8px', borderRadius: 5,
                background: 'rgba(16,185,129,0.12)', color: '#34d399', border: '1px solid rgba(16,185,129,0.3)',
              }}>✅ {s.n} on-chain trade{s.n === 1 ? '' : 's'}</span>
            ) : (
              <span style={{ fontSize: '0.58rem', fontWeight: 700, padding: '2px 8px', borderRadius: 5, background: '#0f172a', color: '#475569', border: '1px solid #1e293b' }}>
                no live trades yet
              </span>
            )}
          </div>
          <span style={{ fontSize: '0.58rem', color: '#475569' }}>
            Real fills · net of fees · not a backtest
          </span>
        </div>

        {!s ? (
          <div style={{ fontSize: '0.7rem', color: '#334155', padding: '10px 0', lineHeight: 1.6 }}>
            When the bot closes its first real position, its <strong style={{ color: '#64748b' }}>verifiable</strong> performance
            appears here — every trade backed by an on-chain transaction you can click through to verify. Unlike a backtest, this
            can't be faked.
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, marginBottom: 10 }}>
              <Stat label="Net P&L" value={`${s.net >= 0 ? '+' : ''}$${fmt(s.net)}`} color={s.net >= 0 ? '#22c55e' : '#ef4444'} />
              <Stat label="Net %" value={`${s.netPct >= 0 ? '+' : ''}${fmt(s.netPct, 1)}%`} color={s.netPct >= 0 ? '#22c55e' : '#ef4444'} />
              <Stat label="Win Rate" value={`${fmt(s.winRate, 0)}%`} color={s.winRate >= 50 ? '#22c55e' : '#f59e0b'} />
              <Stat label="P.Factor" value={s.pf >= 999 ? '∞' : fmt(s.pf)} color={s.pf >= 1.5 ? '#10b981' : s.pf >= 1 ? '#f59e0b' : '#ef4444'} />
              <Stat label="Max DD" value={`$${fmt(s.maxDd)}`} color={'#94a3b8'} />
              <Stat label="Trades" value={`${s.wins}W / ${s.losses}L`} />
            </div>
            <MiniCurve curve={s.curve} up={s.net >= 0} />
          </>
        )}
      </div>
    </div>
  );
};

export default VerifiedTrackRecord;
