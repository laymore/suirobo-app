import fs from 'fs';
import path from 'path';
import { runBacktest, type BacktestConfig, type Candle } from '../src/agent/backtestEngine.js';
const data: Candle[] = JSON.parse(fs.readFileSync(path.join(process.cwd(),'server','data','btc_full_2025_M15.json'),'utf8'));
const CFG: BacktestConfig = {
  initialCapital: 10_000, leverage: 2, orderPct: 50,
  commission: 0.05, slippagePct: 0.05,
  sizingMode: 'risk_pct', riskPct: 2,
  indicator: 'range_breakout', breakoutPeriod: 96,
  direction: 'short_only',
  takeProfitPct: 2, stopLossPct: 1, trailingStopPct: 0,
  enableTrailing: false, enableDefense: true,
  cooldownBars: 8, sessionStartHour: 0, sessionEndHour: 8,
};
const r = runBacktest(data, CFG);
const s = r.stats;
const M = Array.from({length:12},(_,i)=>`2025-${String(i+1).padStart(2,'0')}`);
const m: Record<string,number> = {}; for (const k of M) m[k]=0;
for (const t of r.trades){ const k=t.entryDate.slice(0,7); if(k in m) m[k]+=t.profitVal; }
console.log(`net=${s.netProfitPct}% maxDD=${s.maxDrawdownPct}% PF=${s.profitFactor} WR=${s.winRate}% sharpe=${s.sharpeRatio} expectancy=$${s.expectancy}`);
console.log(`trades=${s.totalTrades} (L${s.longTrades}/S${s.shortTrades}) fees=$${s.totalCommission}`);
console.log('monthly:', M.map(k=>`${k.slice(5)}:${m[k].toFixed(0)}`).join(' '));
console.log('exits:', ['TP','SL','BE','Trailing','Signal','Time','Liquidation'].map(x=>`${x}=${r.trades.filter(t=>t.exitReason===x).length}`).join(' '));
