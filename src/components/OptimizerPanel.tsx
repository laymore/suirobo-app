// Strategy Optimizer — MT5-style parameter sweep over the pure runBacktest.
// Sweeps 1 or 2 numeric inputs across a range, runs a backtest per combo on a
// chunked (UI-yielding) loop, and shows a sortable results table. Click a row to
// load that parameter set into the Tester.
import React, { useState, useCallback } from 'react';
import { runBacktest, type BacktestConfig, type Candle } from '../agent/backtestEngine';

type ParamKey =
  | 'emaFast' | 'emaSlow' | 'maFast' | 'maSlow'
  | 'rsiPeriod' | 'rsiOversold' | 'rsiOverbought'
  | 'bbPeriod' | 'bbStdDev' | 'supertrendPeriod' | 'supertrendMult'
  | 'breakoutPeriod' | 'takeProfitPct' | 'stopLossPct' | 'leverage' | 'trailingStopPct';

const PARAMS: { key: ParamKey; label: string; min: number; max: number; step: number }[] = [
  { key: 'emaFast', label: 'Fast EMA', min: 3, max: 30, step: 1 },
  { key: 'emaSlow', label: 'Slow EMA', min: 10, max: 100, step: 5 },
  { key: 'maFast', label: 'Fast SMA', min: 5, max: 50, step: 5 },
  { key: 'maSlow', label: 'Slow SMA', min: 20, max: 200, step: 10 },
  { key: 'rsiPeriod', label: 'RSI period', min: 5, max: 30, step: 1 },
  { key: 'rsiOversold', label: 'RSI oversold', min: 10, max: 40, step: 5 },
  { key: 'rsiOverbought', label: 'RSI overbought', min: 60, max: 90, step: 5 },
  { key: 'bbPeriod', label: 'BB period', min: 10, max: 40, step: 2 },
  { key: 'bbStdDev', label: 'BB std-dev', min: 1, max: 3, step: 0.5 },
  { key: 'supertrendPeriod', label: 'ST ATR period', min: 5, max: 50, step: 5 },
  { key: 'supertrendMult', label: 'ST multiplier', min: 1, max: 6, step: 0.5 },
  { key: 'breakoutPeriod', label: 'Breakout bars', min: 10, max: 120, step: 10 },
  { key: 'takeProfitPct', label: 'Take Profit %', min: 1, max: 15, step: 1 },
  { key: 'stopLossPct', label: 'Stop Loss %', min: 0.5, max: 5, step: 0.5 },
  { key: 'leverage', label: 'Leverage', min: 1, max: 5, step: 1 },
  { key: 'trailingStopPct', label: 'Trailing %', min: 0, max: 5, step: 0.5 },
];

const MAX_COMBOS = 2500;
const range = (min: number, max: number, step: number) => {
  const out: number[] = []; const s = Math.abs(step) || 1;
  for (let v = min; v <= max + 1e-9; v += s) out.push(Math.round(v * 1000) / 1000);
  return out;
};

interface Row { vals: Partial<Record<ParamKey, number>>; net: number; pf: number; sharpe: number; dd: number; trades: number }
type SortKey = 'net' | 'pf' | 'sharpe' | 'dd' | 'trades';

const OptimizerPanel: React.FC<{
  baseCfg: BacktestConfig;
  data: Candle[];
  onApply: (patch: Partial<Record<ParamKey, number>>) => void;
  onClose: () => void;
}> = ({ baseCfg, data, onApply, onClose }) => {
  const [p1, setP1] = useState<ParamKey>('emaFast');
  const [r1, setR1] = useState({ min: 3, max: 20, step: 1 });
  const [use2, setUse2] = useState(false);
  const [p2, setP2] = useState<ParamKey>('takeProfitPct');
  const [r2, setR2] = useState({ min: 2, max: 10, step: 2 });
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [rows, setRows] = useState<Row[]>([]);
  const [sort, setSort] = useState<SortKey>('net');

  const meta = (k: ParamKey) => PARAMS.find(p => p.key === k)!;
  const pickP1 = (k: ParamKey) => { setP1(k); const m = meta(k); setR1({ min: m.min, max: m.max, step: m.step }); };
  const pickP2 = (k: ParamKey) => { setP2(k); const m = meta(k); setR2({ min: m.min, max: m.max, step: m.step }); };

  const run = useCallback(() => {
    if (data.length < 35) return;
    const v1 = range(r1.min, r1.max, r1.step);
    const v2 = use2 ? range(r2.min, r2.max, r2.step) : [undefined];
    const combos: Partial<Record<ParamKey, number>>[] = [];
    for (const a of v1) for (const b of v2) {
      const c: any = { [p1]: a }; if (b !== undefined) c[p2] = b;
      combos.push(c);
    }
    if (combos.length > MAX_COMBOS) { alert(`Too many combinations (${combos.length}). Max ${MAX_COMBOS} — widen the step or narrow the range.`); return; }
    setRunning(true); setRows([]); setProgress(0);
    const out: Row[] = [];
    let i = 0;
    const chunk = () => {
      const end = Math.min(i + 12, combos.length);
      for (; i < end; i++) {
        const cfg = { ...baseCfg, ...combos[i] } as BacktestConfig;
        const res = runBacktest(data, cfg);
        out.push({ vals: combos[i], net: res.stats.netProfitPct, pf: res.stats.profitFactor, sharpe: res.stats.sharpeRatio, dd: res.stats.maxDrawdownPct, trades: res.stats.totalTrades });
      }
      setProgress(Math.round((i / combos.length) * 100));
      if (i < combos.length) { setTimeout(chunk, 0); }
      else { out.sort((a, b) => b.net - a.net); setRows(out); setRunning(false); setProgress(100); }
    };
    setTimeout(chunk, 0);
  }, [baseCfg, data, p1, r1, use2, p2, r2]);

  const sorted = [...rows].sort((a, b) => sort === 'dd' ? a.dd - b.dd : (b as any)[sort] - (a as any)[sort]);
  const keys = Array.from(new Set(rows.flatMap(r => Object.keys(r.vals)))) as ParamKey[];

  const RangeRow = (p: ParamKey, r: typeof r1, setR: (x: typeof r1) => void) => (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {(['min', 'max', 'step'] as const).map(f => (
        <label key={f} style={{ fontSize: '0.62rem', color: '#64748b' }}>{f}
          <input type="number" step={r.step} value={(r as any)[f]} onChange={e => setR({ ...r, [f]: parseFloat(e.target.value) || 0 })}
            style={{ width: 56, marginLeft: 4, background: '#0a101d', border: '1px solid #1e293b', borderRadius: 5, padding: '3px 5px', color: '#e2e8f0', fontSize: '0.66rem' }} />
        </label>
      ))}
      <span style={{ fontSize: '0.6rem', color: '#475569' }}>{meta(p) && range(r.min, r.max, r.step).length} steps</span>
    </div>
  );
  const Sel = (val: ParamKey, on: (k: ParamKey) => void) => (
    <select value={val} onChange={e => on(e.target.value as ParamKey)}
      style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6, padding: '5px 8px', color: '#e2e8f0', fontSize: '0.72rem', minWidth: 150 }}>
      {PARAMS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
    </select>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'rgba(2,8,20,0.97)', color: '#e2e8f0', fontFamily: "'Inter',sans-serif", padding: 22, overflow: 'auto' }}>
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ color: '#00d4ff', margin: 0 }}>🔬 Strategy Optimizer</h2>
          <button onClick={onClose} style={{ background: '#1e293b', border: '1px solid #334155', color: '#e2e8f0', borderRadius: 6, padding: '6px 12px', cursor: 'pointer' }}>✕ Close</button>
        </div>
        <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginTop: 2 }}>
          Sweep parameters over the current strategy + data ({data.length.toLocaleString()} candles). Results net-of-fees. Click a row to load it into the Tester.
        </p>

        <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: 14, margin: '10px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700, width: 70 }}>Param 1</span>
            {Sel(p1, pickP1)} {RangeRow(p1, r1, setR1)}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700, width: 70, display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={use2} onChange={e => setUse2(e.target.checked)} /> Param 2
            </label>
            {use2 && <>{Sel(p2, pickP2)} {RangeRow(p2, r2, setR2)}</>}
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button onClick={run} disabled={running}
              style={{ background: running ? '#1e293b' : 'linear-gradient(135deg,#10b981,#059669)', border: 'none', color: '#fff', fontWeight: 800, borderRadius: 8, padding: '9px 18px', fontSize: '0.82rem', cursor: running ? 'wait' : 'pointer' }}>
              {running ? `Running… ${progress}%` : '▶ Run optimization'}
            </button>
            {rows.length > 0 && <span style={{ fontSize: '0.72rem', color: '#475569' }}>{rows.length} combinations · sorted by Net %</span>}
          </div>
        </div>

        {rows.length > 0 && (
          <div style={{ background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
              <thead>
                <tr style={{ background: '#0f172a', color: '#94a3b8' }}>
                  {keys.map(k => <th key={k} style={{ padding: '7px 8px', textAlign: 'left' }}>{meta(k).label}</th>)}
                  {([['net', 'Net %'], ['pf', 'PF'], ['sharpe', 'Sharpe'], ['dd', 'MaxDD %'], ['trades', 'Trades']] as [SortKey, string][]).map(([k, l]) => (
                    <th key={k} onClick={() => setSort(k)} style={{ padding: '7px 8px', textAlign: 'right', cursor: 'pointer', color: sort === k ? '#00d4ff' : '#94a3b8' }}>{l}{sort === k ? ' ▾' : ''}</th>
                  ))}
                  <th style={{ padding: '7px 8px' }}></th>
                </tr>
              </thead>
              <tbody>
                {sorted.slice(0, 200).map((row, idx) => (
                  <tr key={idx} style={{ borderTop: '1px solid #1e293b' }}>
                    {keys.map(k => <td key={k} style={{ padding: '6px 8px', fontFamily: 'monospace' }}>{row.vals[k] ?? '—'}</td>)}
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', color: row.net >= 0 ? '#4ade80' : '#f87171', fontWeight: 700 }}>{row.net.toFixed(1)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', color: row.pf >= 1.5 ? '#4ade80' : row.pf >= 1 ? '#f59e0b' : '#f87171' }}>{row.pf.toFixed(2)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{row.sharpe.toFixed(2)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', color: row.dd <= 15 ? '#4ade80' : '#f87171' }}>{row.dd.toFixed(1)}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'monospace', color: '#94a3b8' }}>{row.trades}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                      <button onClick={() => { onApply(row.vals); onClose(); }}
                        style={{ background: 'rgba(0,212,255,0.12)', border: '1px solid #00d4ff', color: '#00d4ff', borderRadius: 5, padding: '2px 8px', fontSize: '0.64rem', cursor: 'pointer', fontWeight: 700 }}>Apply</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {sorted.length > 200 && <div style={{ padding: '6px 8px', fontSize: '0.62rem', color: '#475569' }}>Showing top 200 of {sorted.length}.</div>}
          </div>
        )}
      </div>
    </div>
  );
};

export default OptimizerPanel;
