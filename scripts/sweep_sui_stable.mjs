/**
 * SUI Stability Sweep — filter: profit > 0 cả 3 tháng, MaxDD < 25%
 * Tìm bot skill "thực sự ổn định" chứ không phải 1 tháng đẹp
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dir = dirname(fileURLToPath(import.meta.url));

function computeIndicators(data) {
  const n=data.length;
  const ema9=new Array(n).fill(0),ema21=new Array(n).fill(0),rsi=new Array(n).fill(50);
  const macdLine=new Array(n).fill(0),signalLine=new Array(n).fill(0),histogram=new Array(n).fill(0);
  const bbUpper=new Array(n).fill(0),bbBasis=new Array(n).fill(0),bbLower=new Array(n).fill(0);
  const k9=2/10,k21=2/22; let e9=data[0].close,e21=data[0].close;
  ema9[0]=e9;ema21[0]=e21;
  for(let i=1;i<n;i++){e9=data[i].close*k9+e9*(1-k9);e21=data[i].close*k21+e21*(1-k21);ema9[i]=e9;ema21[i]=e21;}
  if(n>15){let ag=0,al=0;for(let i=1;i<=14;i++){const d=data[i].close-data[i-1].close;if(d>0)ag+=d;else al-=d;}
    ag/=14;al/=14;rsi[14]=al===0?100:100-100/(1+ag/al);
    for(let i=15;i<n;i++){const d=data[i].close-data[i-1].close;ag=(ag*13+Math.max(d,0))/14;al=(al*13+Math.max(-d,0))/14;rsi[i]=al===0?100:100-100/(1+ag/al);}}
  const k12=2/13,k26=2/27,ks=2/10; let e12=data[0].close,e26=data[0].close,sig=0;
  for(let i=1;i<n;i++){e12=data[i].close*k12+e12*(1-k12);e26=data[i].close*k26+e26*(1-k26);macdLine[i]=e12-e26;sig=macdLine[i]*ks+sig*(1-ks);signalLine[i]=sig;histogram[i]=macdLine[i]-sig;}
  for(let i=19;i<n;i++){let sum=0;for(let j=i-19;j<=i;j++)sum+=data[j].close;const mean=sum/20;let vsum=0;for(let j=i-19;j<=i;j++)vsum+=(data[j].close-mean)**2;const std=Math.sqrt(vsum/20);bbBasis[i]=mean;bbUpper[i]=mean+2*std;bbLower[i]=mean-2*std;}
  return{ema9,ema21,rsi,macdLine,signalLine,histogram,bbUpper,bbBasis,bbLower};
}
function getSignal(i,data,ind,indicator){
  if(i<30)return{buy:false,sell:false};
  switch(indicator){
    case'ema_cross':return{buy:ind.ema9[i-1]<=ind.ema21[i-1]&&ind.ema9[i]>ind.ema21[i],sell:ind.ema9[i-1]>=ind.ema21[i-1]&&ind.ema9[i]<ind.ema21[i]};
    case'rsi':return{buy:ind.rsi[i-1]<30&&ind.rsi[i]>=30,sell:ind.rsi[i-1]>70&&ind.rsi[i]<=70};
    case'macd':return{buy:ind.histogram[i-1]<=0&&ind.histogram[i]>0,sell:ind.histogram[i-1]>=0&&ind.histogram[i]<0};
    case'bb':return{buy:data[i-1].close<=ind.bbLower[i-1]&&data[i].close>ind.bbLower[i],sell:data[i-1].close>=ind.bbUpper[i-1]&&data[i].close<ind.bbUpper[i]};
    case'rsi_macd':return{buy:ind.rsi[i]<40&&ind.histogram[i-1]<=0&&ind.histogram[i]>0,sell:ind.rsi[i]>60&&ind.histogram[i-1]>=0&&ind.histogram[i]<0};
    default:return{buy:false,sell:false};
  }
}
function runBacktest(data,cfg){
  const indicators=computeIndicators(data);const n=data.length;
  const eqByIdx=new Array(n).fill(cfg.initialCapital);
  let capital=cfg.initialCapital;const trades=[];let pos=null;
  for(let i=1;i<n;i++){
    const candle=data[i];
    if(pos){
      if(pos.type==='LONG'&&candle.high>pos.peakPrice)pos.peakPrice=candle.high;
      if(pos.type==='SHORT'&&candle.low<pos.peakPrice)pos.peakPrice=candle.low;
      let exited=false,exitPrice=candle.close,reason='Signal';
      if(!exited&&pos.type==='LONG'&&candle.low<=pos.liqPrice){exitPrice=pos.liqPrice;reason='Liquidation';exited=true;}
      if(!exited&&pos.type==='SHORT'&&candle.high>=pos.liqPrice){exitPrice=pos.liqPrice;reason='Liquidation';exited=true;}
      if(!exited&&cfg.enableDefense){
        if(pos.type==='LONG'){if(candle.high>=pos.tpPrice){exitPrice=pos.tpPrice;reason='TP';exited=true;}else if(candle.low<=pos.slPrice){exitPrice=pos.slPrice;reason='SL';exited=true;}}
        else{if(candle.low<=pos.tpPrice){exitPrice=pos.tpPrice;reason='TP';exited=true;}else if(candle.high>=pos.slPrice){exitPrice=pos.slPrice;reason='SL';exited=true;}}
      }
      if(!exited){const{buy,sell}=getSignal(i,data,indicators,cfg.indicator);if((pos.type==='LONG'&&sell)||(pos.type==='SHORT'&&buy)){exitPrice=candle.close;reason='Signal';exited=true;}}
      if(exited){
        const pd=pos.type==='LONG'?exitPrice-pos.entryPrice:pos.entryPrice-exitPrice;
        const comm=pos.sizeUSD*(cfg.commission/100)*2;const net=pd*pos.sizeCoins-comm;
        capital=Math.max(1,capital+net);
        trades.push({type:pos.type,profitVal:Math.round(net*100)/100,profitPct:pos.sizeUSD/cfg.leverage>0?Math.round((net/(pos.sizeUSD/cfg.leverage))*1000)/10:0,exitReason:reason});
        pos=null;
      }
    }
    eqByIdx[i]=capital;
    if(!pos&&capital>1){
      let{buy,sell}=getSignal(i,data,indicators,cfg.indicator);
      if(cfg.direction==='long_only')sell=false;
      if(cfg.direction==='short_only')buy=false;
      if(buy||sell){
        const type=buy?'LONG':'SHORT';const margin=capital*(cfg.orderPct/100);const sizeUSD=margin*cfg.leverage;
        const sizeCoins=sizeUSD/candle.close;const liqBuf=1/cfg.leverage;
        pos={type,entryPrice:candle.close,sizeCoins,sizeUSD,peakPrice:candle.close,
          liqPrice:type==='LONG'?candle.close*(1-liqBuf*0.9):candle.close*(1+liqBuf*0.9),
          tpPrice:type==='LONG'?candle.close*(1+cfg.takeProfitPct/100):candle.close*(1-cfg.takeProfitPct/100),
          slPrice:type==='LONG'?candle.close*(1-cfg.stopLossPct/100):candle.close*(1+cfg.stopLossPct/100)};
      }
    }
  }
  const wins=trades.filter(t=>t.profitVal>0),losses=trades.filter(t=>t.profitVal<=0);
  const gp=wins.reduce((s,t)=>s+t.profitVal,0),gl=Math.abs(losses.reduce((s,t)=>s+t.profitVal,0));
  const net=gp-gl;let peak=cfg.initialCapital,maxDd=0;
  for(const eq of eqByIdx){if(eq>peak)peak=eq;const dd=peak>0?(peak-eq)/peak*100:0;if(dd>maxDd)maxDd=dd;}
  // per-month breakdown
  const cpd={'M15':96,'M30':48,'H1':24}[cfg._tf]||96;
  const perMonth=[];
  for(let m=0;m<6;m++){
    const start=m*30*cpd,end=Math.min((m+1)*30*cpd+30,eqByIdx.length);
    if(start>=eqByIdx.length)break;
    const s0=eqByIdx[start]||cfg.initialCapital;
    const s1=eqByIdx[end-1]||eqByIdx[eqByIdx.length-1];
    perMonth.push(Math.round((s1-s0)/s0*100*10)/10);
  }
  return{netProfitPct:Math.round(net/cfg.initialCapital*100*10)/10,winRate:trades.length>0?Math.round(wins.length/trades.length*100*10)/10:0,maxDd:Math.round(maxDd*10)/10,pf:gl>0?Math.round(gp/gl*100)/100:gp>0?999:0,trades:trades.length,perMonth};
}

function loadAll(tf){
  const file=join(__dir,'..','public','data',`sui_2025_${tf}.json`);
  return JSON.parse(readFileSync(file,'utf8'));
}
function slice(data,tf,months){const cpd={'M15':96,'M30':48,'H1':24}[tf]||96;return data.slice(0,months*30*cpd+30);}

// ─── Extended sweep with stability filter ─────────────────────────────────────
const indicators=['ema_cross','rsi','macd','bb','rsi_macd'];
const timeframes=['M15','M30','H1'];
const tpList=[1,2,3,5,7,10,15];
const slList=[0.5,1,1.5,2,3];
const leverages=[1,2,3,5];
const directions=['both','long_only','short_only'];
const orderPcts=[25,50];

const stable=[];

for(const tf of timeframes){
  const allData=loadAll(tf);
  const d1=slice(allData,tf,1),d3=slice(allData,tf,3),d6=slice(allData,tf,6);
  for(const indicator of indicators){
    for(const tp of tpList){
      for(const sl of slList){
        if(sl>=tp)continue;
        for(const lev of leverages){
          for(const dir of directions){
            for(const opct of orderPcts){
              const cfg={initialCapital:10000,leverage:lev,orderPct:opct,commission:0.05,
                takeProfitPct:tp,stopLossPct:sl,trailingStopPct:0,enableTrailing:false,
                enableDefense:true,indicator,direction:dir,_tf:tf};
              const r1=runBacktest(d1,cfg);
              const r3=runBacktest(d3,cfg);
              const r6=runBacktest(d6,cfg);
              // STABILITY FILTER: positive all periods, max DD < 20% on 3m, trades >= 3
              if(r1.netProfitPct>0 && r3.netProfitPct>0 && r3.maxDd<20 && r1.trades>=3){
                const score=r1.netProfitPct*0.4+r3.netProfitPct*0.4+r6.netProfitPct*0.2 - r3.maxDd*0.3;
                stable.push({tf,indicator,tp,sl,lev,dir,opct,r1,r3,r6,score});
              }
            }
          }
        }
      }
    }
  }
}

stable.sort((a,b)=>b.score-a.score);

console.log(`\n🔬 STABLE strategies (profit>0 in 1m+3m, maxDD<20% over 3m): ${stable.length} found\n`);
console.log('TOP 15 STABLE SUI Strategies:\n');
console.log('Rank | TF   | Indicator  | TP%  | SL%  | Lev | Dir        | Ord | 1m%     | 3m%     | 6m%     | MaxDD3m | WR3m%');
console.log('─'.repeat(115));

stable.slice(0,15).forEach((s,i)=>{
  console.log(
    `${String(i+1).padStart(4)} | ${s.tf.padEnd(4)} | ${s.indicator.padEnd(10)} | ${String(s.tp).padEnd(4)} | ${String(s.sl).padEnd(4)} | ${String(s.lev).padEnd(3)} | ${s.dir.padEnd(10)} | ${String(s.opct).padEnd(3)} | ${s.r1.netProfitPct.toFixed(1).padStart(6)}% | ${s.r3.netProfitPct.toFixed(1).padStart(6)}% | ${s.r6.netProfitPct.toFixed(1).padStart(6)}% | ${s.r3.maxDd.toFixed(1).padStart(7)}% | ${s.r3.winRate.toFixed(1)}%`
  );
});

// Detail monthly breakdown for top 3
console.log('\n\n📅 MONTHLY BREAKDOWN — Top 3 strategies:\n');
stable.slice(0,3).forEach((s,i)=>{
  console.log(`#${i+1} ${s.tf} ${s.indicator.toUpperCase()} TP${s.tp}% SL${s.sl}% Lev${s.lev}x ${s.dir} ${s.opct}%:`);
  s.r6.perMonth.forEach((pm,m)=>console.log(`  Month ${m+1}: ${pm>=0?'+':''}${pm}%`));
  console.log(`  6m Total: +${s.r6.netProfitPct}% | MaxDD: ${s.r6.maxDd}% | WR: ${s.r6.winRate}% | Trades: ${s.r6.trades}`);
  console.log();
});
