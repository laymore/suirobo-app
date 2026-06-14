import fs from 'fs';
import path from 'path';
import { runBacktest, type BacktestConfig, type Candle } from '../src/agent/backtestEngine.js';
const data: Candle[] = JSON.parse(fs.readFileSync(path.join(process.cwd(),'server','data','sui_full_2025_M5.json'),'utf8'));
const MONTHS = Array.from({length:12},(_,i)=>`2025-${String(i+1).padStart(2,'0')}`);
const byMonth: Record<string,Candle[]> = {}; for (const k of MONTHS) byMonth[k]=[];
for (const c of data){ const k=c.date.slice(0,7); if(k in byMonth) byMonth[k].push(c); }
function table(tag: string, lev: number) {
  const CFG: BacktestConfig = {
    initialCapital: 10_000, leverage: lev, orderPct: 50,
    commission: 0.05, slippagePct: 0.05,
    indicator: 'supertrend_flip', supertrendPeriod: 200, supertrendMult: 6,
    htfMinutes: 240, htfSupertrendPeriod: 10, htfSupertrendMult: 3,
    direction: 'both',
    takeProfitPct: 999, stopLossPct: 2, trailingStopPct: 2.5,
    enableTrailing: true, enableDefense: true,
    cooldownBars: 192,
  };
  const rows = MONTHS.map(k => { const r = runBacktest(byMonth[k], CFG); return { k, p: r.stats.netProfitPct, n: r.stats.totalTrades, dd: r.stats.maxDrawdownPct, w: r.stats.winRate }; });
  const win = rows.slice(2, 9); // Mar..Sep
  console.log(`\n=== ${tag} (lev ${lev}) ===`);
  for (const r of rows) console.log(`  ${r.k}: ${r.p>=0?'+':''}${r.p.toFixed(1)}%  n=${r.n} dd=${r.dd}% wr=${r.w}%`);
  console.log(`  Mar-Sep mean: ${(win.reduce((a,b)=>a+b.p,0)/7).toFixed(2)}%/mo  (${win.filter(r=>r.p>0).length}/7 months positive)`);
  console.log(`  FULL-12 mean: ${(rows.reduce((a,b)=>a+b.p,0)/12).toFixed(2)}%/mo  (${rows.filter(r=>r.p>0).length}/12 months positive)`);
}
table('MTF: M5 flip ST(200,6) × H4 ST(10,3) gate, runner SL2/TR2.5, cd192', 2);
table('same, leverage 3', 3);
