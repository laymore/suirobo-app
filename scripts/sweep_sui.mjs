/**
 * SUI Strategy Sweep — tìm combo tốt nhất trên SUI/USDT Jan-Jun 2025
 * Chạy: node scripts/sweep_sui.mjs
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));

// ─── Copy inline backtestEngine (không import TS) ─────────────────────────────

function computeIndicators(data) {
  const n = data.length;
  const ema9=new Array(n).fill(0), ema21=new Array(n).fill(0), rsi=new Array(n).fill(50);
  const macdLine=new Array(n).fill(0), signalLine=new Array(n).fill(0), histogram=new Array(n).fill(0);
  const bbUpper=new Array(n).fill(0), bbBasis=new Array(n).fill(0), bbLower=new Array(n).fill(0);

  const k9=2/10, k21=2/22;
  let e9=data[0].close, e21=data[0].close;
  ema9[0]=e9; ema21[0]=e21;
  for(let i=1;i<n;i++){
    e9=data[i].close*k9+e9*(1-k9); e21=data[i].close*k21+e21*(1-k21);
    ema9[i]=e9; ema21[i]=e21;
  }

  if(n>15){
    let ag=0,al=0;
    for(let i=1;i<=14;i++){const d=data[i].close-data[i-1].close; if(d>0)ag+=d; else al-=d;}
    ag/=14; al/=14; rsi[14]=al===0?100:100-100/(1+ag/al);
    for(let i=15;i<n;i++){
      const d=data[i].close-data[i-1].close;
      ag=(ag*13+Math.max(d,0))/14; al=(al*13+Math.max(-d,0))/14;
      rsi[i]=al===0?100:100-100/(1+ag/al);
    }
  }

  const k12=2/13,k26=2/27,ks=2/10;
  let e12=data[0].close,e26=data[0].close,sig=0;
  for(let i=1;i<n;i++){
    e12=data[i].close*k12+e12*(1-k12); e26=data[i].close*k26+e26*(1-k26);
    macdLine[i]=e12-e26; sig=macdLine[i]*ks+sig*(1-ks);
    signalLine[i]=sig; histogram[i]=macdLine[i]-sig;
  }

  for(let i=19;i<n;i++){
    let sum=0; for(let j=i-19;j<=i;j++) sum+=data[j].close;
    const mean=sum/20; let vsum=0;
    for(let j=i-19;j<=i;j++) vsum+=(data[j].close-mean)**2;
    const std=Math.sqrt(vsum/20);
    bbBasis[i]=mean; bbUpper[i]=mean+2*std; bbLower[i]=mean-2*std;
  }
  return {ema9,ema21,rsi,macdLine,signalLine,histogram,bbUpper,bbBasis,bbLower};
}

function getSignal(i,data,ind,indicator){
  if(i<30) return {buy:false,sell:false};
  switch(indicator){
    case 'ema_cross': return {buy:ind.ema9[i-1]<=ind.ema21[i-1]&&ind.ema9[i]>ind.ema21[i], sell:ind.ema9[i-1]>=ind.ema21[i-1]&&ind.ema9[i]<ind.ema21[i]};
    case 'rsi':       return {buy:ind.rsi[i-1]<30&&ind.rsi[i]>=30, sell:ind.rsi[i-1]>70&&ind.rsi[i]<=70};
    case 'macd':      return {buy:ind.histogram[i-1]<=0&&ind.histogram[i]>0, sell:ind.histogram[i-1]>=0&&ind.histogram[i]<0};
    case 'bb':        return {buy:data[i-1].close<=ind.bbLower[i-1]&&data[i].close>ind.bbLower[i], sell:data[i-1].close>=ind.bbUpper[i-1]&&data[i].close<ind.bbUpper[i]};
    case 'rsi_macd':  return {buy:ind.rsi[i]<40&&ind.histogram[i-1]<=0&&ind.histogram[i]>0, sell:ind.rsi[i]>60&&ind.histogram[i-1]>=0&&ind.histogram[i]<0};
    default: return {buy:false,sell:false};
  }
}

function runBacktest(data, cfg) {
  const indicators = computeIndicators(data);
  const n = data.length;
  const equityByIndex = new Array(n).fill(cfg.initialCapital);
  let capital = cfg.initialCapital, tradeId = 0;
  const trades = [];
  let pos = null;

  for(let i=1;i<n;i++){
    const candle = data[i];
    if(pos){
      if(pos.type==='LONG'&&candle.high>pos.peakPrice) pos.peakPrice=candle.high;
      if(pos.type==='SHORT'&&candle.low<pos.peakPrice) pos.peakPrice=candle.low;
      let exited=false, exitPrice=candle.close, reason='Signal';

      if(!exited&&pos.type==='LONG'&&candle.low<=pos.liqPrice){exitPrice=pos.liqPrice;reason='Liquidation';exited=true;}
      if(!exited&&pos.type==='SHORT'&&candle.high>=pos.liqPrice){exitPrice=pos.liqPrice;reason='Liquidation';exited=true;}

      if(!exited&&cfg.enableDefense){
        if(pos.type==='LONG'){
          if(candle.high>=pos.tpPrice){exitPrice=pos.tpPrice;reason='TP';exited=true;}
          else if(candle.low<=pos.slPrice){exitPrice=pos.slPrice;reason='SL';exited=true;}
        } else {
          if(candle.low<=pos.tpPrice){exitPrice=pos.tpPrice;reason='TP';exited=true;}
          else if(candle.high>=pos.slPrice){exitPrice=pos.slPrice;reason='SL';exited=true;}
        }
      }
      if(!exited&&cfg.enableTrailing){
        const trail=cfg.trailingStopPct/100;
        if(pos.type==='LONG'){const tp2=pos.peakPrice*(1-trail);if(pos.peakPrice>pos.entryPrice*1.005&&candle.low<=tp2){exitPrice=tp2;reason='Trailing';exited=true;}}
        else{const tp2=pos.peakPrice*(1+trail);if(pos.peakPrice<pos.entryPrice*0.995&&candle.high>=tp2){exitPrice=tp2;reason='Trailing';exited=true;}}
      }
      if(!exited){
        const {buy,sell}=getSignal(i,data,indicators,cfg.indicator);
        if((pos.type==='LONG'&&sell)||(pos.type==='SHORT'&&buy)){exitPrice=candle.close;reason='Signal';exited=true;}
      }
      if(exited){
        const pd=pos.type==='LONG'?exitPrice-pos.entryPrice:pos.entryPrice-exitPrice;
        const comm=pos.sizeUSD*(cfg.commission/100)*2;
        const net=pd*pos.sizeCoins-comm;
        capital=Math.max(1,capital+net);
        trades.push({type:pos.type,profitVal:Math.round(net*100)/100,profitPct:pos.sizeUSD/cfg.leverage>0?Math.round((net/(pos.sizeUSD/cfg.leverage))*1000)/10:0,exitReason:reason,commissionPaid:Math.round(comm*100)/100});
        pos=null;
      }
    }
    equityByIndex[i]=capital;

    if(!pos&&capital>1){
      let{buy,sell}=getSignal(i,data,indicators,cfg.indicator);
      if(cfg.direction==='long_only') sell=false;
      if(cfg.direction==='short_only') buy=false;
      if(buy||sell){
        const type=buy?'LONG':'SHORT';
        const margin=capital*(cfg.orderPct/100);
        const sizeUSD=margin*cfg.leverage;
        const sizeCoins=sizeUSD/candle.close;
        const liqBuf=1/cfg.leverage;
        pos={type,entryPrice:candle.close,sizeCoins,sizeUSD,peakPrice:candle.close,
          liqPrice:type==='LONG'?candle.close*(1-liqBuf*0.9):candle.close*(1+liqBuf*0.9),
          tpPrice:type==='LONG'?candle.close*(1+cfg.takeProfitPct/100):candle.close*(1-cfg.takeProfitPct/100),
          slPrice:type==='LONG'?candle.close*(1-cfg.stopLossPct/100):candle.close*(1+cfg.stopLossPct/100)};
      }
    }
  }

  const wins=trades.filter(t=>t.profitVal>0), losses=trades.filter(t=>t.profitVal<=0);
  const grossProfit=wins.reduce((s,t)=>s+t.profitVal,0);
  const grossLoss=Math.abs(losses.reduce((s,t)=>s+t.profitVal,0));
  const netProfit=grossProfit-grossLoss;
  let peak=cfg.initialCapital, maxDd=0;
  for(const eq of equityByIndex){if(eq>peak)peak=eq;const dd=peak>0?(peak-eq)/peak*100:0;if(dd>maxDd)maxDd=dd;}
  const winRate=trades.length>0?wins.length/trades.length*100:0;
  const pf=grossLoss>0?grossProfit/grossLoss:grossProfit>0?999:0;
  return {
    netProfitPct:Math.round(netProfit/cfg.initialCapital*1000)/10,
    winRate:Math.round(winRate*10)/10,
    maxDd:Math.round(maxDd*10)/10,
    pf:Math.round(pf*100)/100,
    trades:trades.length,
    wins:wins.length,
  };
}

// ─── Load data ────────────────────────────────────────────────────────────────

function loadData(tf, monthSlice) {
  const file = join(__dir,'..','public','data',`sui_2025_${tf}.json`);
  const all = JSON.parse(readFileSync(file,'utf8'));
  const cpd = {'M15':96,'M30':48,'H1':24}[tf]||96;
  return all.slice(0, (monthSlice||1)*cpd*30 + 30);
}

// ─── Sweep ────────────────────────────────────────────────────────────────────

const indicators = ['ema_cross','rsi','macd','bb','rsi_macd'];
const timeframes  = ['M15','M30','H1'];
const tpList      = [1,2,3,5,7,10,15];
const slList      = [0.5,1,1.5,2,3];
const leverages   = [1,2,3,5];
const directions  = ['both','long_only','short_only'];
const orderPcts   = [25,50];

const results = [];
let combos = 0;

for(const tf of timeframes){
  const data1m = loadData(tf, 1); // 1 tháng đầu (Jan 2025)

  for(const indicator of indicators){
    for(const tp of tpList){
      for(const sl of slList){
        if(sl >= tp) continue; // SL phải nhỏ hơn TP
        for(const lev of leverages){
          for(const dir of directions){
            for(const opct of orderPcts){
              combos++;
              const cfg = {
                initialCapital:10000, leverage:lev, orderPct:opct,
                commission:0.05, takeProfitPct:tp, stopLossPct:sl,
                trailingStopPct:0, enableTrailing:false, enableDefense:true,
                indicator, direction:dir,
              };
              const r = runBacktest(data1m, cfg);
              if(r.trades >= 3 && r.netProfitPct > 0 && r.maxDd < 30){
                results.push({tf,indicator,tp,sl,lev,dir,opct,...r});
              }
            }
          }
        }
      }
    }
  }
}

// ─── Sort & Print top 20 ──────────────────────────────────────────────────────

results.sort((a,b)=>{
  // Score = profit% / sqrt(maxDd) * log(pf+1) * sqrt(trades/5)
  const score=(r)=>r.maxDd>0?r.netProfitPct/Math.sqrt(r.maxDd)*Math.log(r.pf+1)*Math.sqrt(r.trades/5):0;
  return score(b)-score(a);
});

console.log(`\n✅ Swept ${combos.toLocaleString()} combos → ${results.length} profitable (>0% net, maxDD<30%, ≥3 trades)\n`);
console.log('TOP 20 SUI/USDC strategies (Jan 2025, 1 month):\n');
console.log('Rank | TF   | Indicator  | TP%  | SL%  | Lev | Dir        | Ord% | Profit%  | WR%   | MaxDD% | PF   | Trades');
console.log('─'.repeat(110));

const top20 = results.slice(0,20);
top20.forEach((r,i)=>{
  const profit = r.netProfitPct.toFixed(1).padStart(7);
  const wr     = r.winRate.toFixed(1).padStart(5);
  const dd     = r.maxDd.toFixed(1).padStart(6);
  const pf     = r.pf.toFixed(2).padStart(5);
  console.log(
    `${String(i+1).padStart(4)} | ${r.tf.padEnd(4)} | ${r.indicator.padEnd(10)} | ${String(r.tp).padEnd(4)} | ${String(r.sl).padEnd(4)} | ${String(r.lev).padEnd(3)} | ${r.dir.padEnd(10)} | ${String(r.opct).padEnd(4)} | ${profit}% | ${wr}% | ${dd}% | ${pf} | ${r.trades}`
  );
});

// ─── Also test top strategies over 3 months & 6 months ───────────────────────
console.log('\n\n📊 TOP 5 validated on 3 months (Jan-Mar 2025):\n');
console.log('Rank | TF   | Indicator  | TP%  | SL%  | Lev | Dir        | 1m%     | 3m%     | 6m%     | MaxDD% | WR%');
console.log('─'.repeat(100));

top20.slice(0,5).forEach((r,i)=>{
  const data3m = loadData(r.tf, 3);
  const data6m = loadData(r.tf, 6);
  const cfg={initialCapital:10000,leverage:r.lev,orderPct:r.opct,commission:0.05,
    takeProfitPct:r.tp,stopLossPct:r.sl,trailingStopPct:0,enableTrailing:false,
    enableDefense:true,indicator:r.indicator,direction:r.dir};
  const r3=runBacktest(data3m,cfg);
  const r6=runBacktest(data6m,cfg);
  console.log(
    `${String(i+1).padStart(4)} | ${r.tf.padEnd(4)} | ${r.indicator.padEnd(10)} | ${String(r.tp).padEnd(4)} | ${String(r.sl).padEnd(4)} | ${String(r.lev).padEnd(3)} | ${r.dir.padEnd(10)} | ${r.netProfitPct.toFixed(1).padStart(6)}% | ${r3.netProfitPct.toFixed(1).padStart(6)}% | ${r6.netProfitPct.toFixed(1).padStart(6)}% | ${r6.maxDd.toFixed(1).padStart(6)}% | ${r6.winRate.toFixed(1)}%`
  );
});

console.log('\n');
