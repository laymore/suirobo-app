import { computeIndicators, type Candle } from './src/agent/backtestEngine.js';
import fs from 'fs';
import path from 'path';

// Custom SuperTrend "Holy Grail" Backtest Engine

const dataFile = path.join(process.cwd(), 'public', 'data', `sui_2025_M5.json`);
console.log(`📂 Loading ${dataFile}`);
const allData: Candle[] = JSON.parse(fs.readFileSync(dataFile, 'utf8'));

// Jan 01 - Mar 31 is roughly 90 days.
// 1 Day = 288 M5 candles.
// 90 days * 288 = 25920 candles.
const sliceSize = Math.min(allData.length, 90 * 288);
const data = allData.slice(0, sliceSize);

console.log(`📊 Test data: ${data.length} candles (SUI M5, Jan-Mar)`);
console.log(`   First: ${data[0].date} @ $${data[0].close}`);
console.log(`   Last:  ${data[data.length - 1].date} @ $${data[data.length - 1].close}`);
console.log();

// Config
const INITIAL_CAPITAL = 1000;
const LEVERAGE = 5;
const ORDER_PCT = 20; // 20% of capital
const COMMISSION = 0.001; // 0.1% per trade side (standard fee), we will also calculate 0.01%
const TP_PCT = 0.02; // +2% asset movement => +10% ROE

console.log('🤖 Bot Config (SUI M5 SUPERTREND Bắt Râu):');
console.log(`   Supertrend: Period 10, Multiplier 5`);
console.log(`   Leverage: ${LEVERAGE}x | Order: ${ORDER_PCT}%`);
console.log(`   TP: +2% (10% ROE), SL: Supertrend Line`);
console.log();

const t0 = performance.now();

// Pass supertrendMult = 5
const ind = computeIndicators(data, 5);

let capital = INITIAL_CAPITAL;
let capitalVip = INITIAL_CAPITAL;
let wins = 0;
let losses = 0;
let totalTrades = 0;
let peakCapital = INITIAL_CAPITAL;
let maxDrawdown = 0;

let pos: {
  type: 'LONG' | 'SHORT';
  entryPrice: number;
  sizeCoins: number;
  sizeCoinsVip: number;
  sizeUSD: number;
  tpPrice: number;
} | null = null;

for (let i = 1; i < data.length; i++) {
  const candle = data[i];
  const st = ind.superTrend[i-1];
  const dir = ind.superTrendDir[i-1];

  // 1. Manage existing position
  if (pos) {
    let raed = false;
    let exitPrice = candle.close;
    let isWin = false;

    // Check Stop Loss (if price breaches SuperTrend line of current candle or previous candle)
    // Wait, dynamic stop loss is at Supertrend. If LONG and Low <= ST, we are stopped out at ST.
    if (pos.type === 'LONG') {
      if (candle.low <= st) {
        exitPrice = st;
        raed = true;
      } else if (candle.high >= pos.tpPrice) {
        exitPrice = pos.tpPrice;
        raed = true;
        isWin = true;
      }
    } else { // SHORT
      if (candle.high >= st) {
        exitPrice = st;
        raed = true;
      } else if (candle.low <= pos.tpPrice) {
        exitPrice = pos.tpPrice;
        raed = true;
        isWin = true;
      }
    }

    if (raed) {
      totalTrades++;
      if (isWin) wins++; else losses++;

      // Standard Fee Calculation
      const priceDiff = pos.type === 'LONG' ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice;
      const rawProfit = priceDiff * pos.sizeCoins;
      const commission = pos.sizeUSD * COMMISSION * 2;
      const netProfit = rawProfit - commission;
      capital = Math.max(1, capital + netProfit);
      if (capital > peakCapital) peakCapital = capital;
      const dd = (peakCapital - capital) / peakCapital * 100;
      if (dd > maxDrawdown) maxDrawdown = dd;

      // VIP Fee Calculation
      const rawProfitVip = priceDiff * pos.sizeCoinsVip;
      const commissionVip = (capitalVip * (ORDER_PCT / 100) * LEVERAGE) * 0.0001 * 2;
      const netProfitVip = rawProfitVip - commissionVip;
      capitalVip = Math.max(1, capitalVip + netProfitVip);

      pos = null;
    }
  }

  // 2. Check entry signal
  if (!pos && i > 20 && capital > 10) {
    // Pullback logic: 
    // LONG: trend is UP, low is within 1% above supertrend
    // SHORT: trend is DOWN, high is within 1% below supertrend
    const margin = capital * (ORDER_PCT / 100);
    const sizeUSD = margin * LEVERAGE;

    const marginVip = capitalVip * (ORDER_PCT / 100);
    const sizeUSDVip = marginVip * LEVERAGE;

    if (dir === 1 && candle.low <= st * 1.01 && candle.low > st) {
      // Bắt râu Long
      const entryPrice = candle.low; // assume filled at the low
      pos = {
        type: 'LONG',
        entryPrice,
        sizeCoins: sizeUSD / entryPrice,
        sizeCoinsVip: sizeUSDVip / entryPrice,
        sizeUSD,
        tpPrice: entryPrice * (1 + TP_PCT)
      };
    } else if (dir === -1 && candle.high >= st * 0.99 && candle.high < st) {
      // Bắt râu Short
      const entryPrice = candle.high; // assume filled at the high
      pos = {
        type: 'SHORT',
        entryPrice,
        sizeCoins: sizeUSD / entryPrice,
        sizeCoinsVip: sizeUSDVip / entryPrice,
        sizeUSD,
        tpPrice: entryPrice * (1 - TP_PCT)
      };
    }
  }
}

const elapsed = performance.now() - t0;

const winRate = (wins / totalTrades) * 100;
const roiStandard = ((capital - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100;
const roiVip = ((capitalVip - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100;

console.log(`✅ Done in ${elapsed.toFixed(1)}ms`);
console.log();
console.log('📈 KẾT QUẢ BACKTEST THỰC TẾ (SUI M5 Bắt râu):');
console.log(`   Số lượng giao dịch: ${totalTrades} lệnh`);
console.log(`   Tỉ lệ thắng:        ${winRate.toFixed(2)}% (W: ${wins} / L: ${losses})`);
console.log(`   Vốn ban đầu:        $${INITIAL_CAPITAL.toFixed(2)}`);
console.log();
console.log(`   [Phí phổ thông 0.1%]`);
console.log(`   Lợi nhuận ròng:     +${roiStandard.toFixed(2)}% (Tài khoản X${(capital/INITIAL_CAPITAL).toFixed(1)} lần)`);
console.log(`   Vốn cuối kỳ:        $${capital.toFixed(2)}`);
console.log(`   Max Drawdown:       ${maxDrawdown.toFixed(2)}%`);
console.log();
console.log(`   [Phí VIP 0.01%]`);
console.log(`   Lợi nhuận ròng:     +${roiVip.toFixed(2)}% (Tài khoản X${(capitalVip/INITIAL_CAPITAL).toFixed(1)} lần)`);
console.log(`   Vốn cuối kỳ:        $${capitalVip.toFixed(2)}`);
console.log();
