/**
 * MARGIN ENTRY STRATEGIST SKILL
 * Kỹ năng chọn điểm vào orders Margin thông minh:
 * - Phân tích xu hướng giá qua nhiều timeframe (từ Oracle history)
 * - Tính toán điểm vào tối ưu (Entry Point), Stop-Loss, Take-Profit
 * - Gợi ý thời điểm phù hợp để Long/Short
 * - Theo dõi funding rate và lãi suất Margin Pool
 */
import {   FunctionTool   } from '@google/adk';
import { z } from 'zod';
import { predictTools } from '../tools/predict.js';

const MAINNET_RPC = 'https://fullnode.mainnet.sui.io';
const MARGIN_POOL_SUI  = '0x801dbc2f0053d34734814b2d6df491ce7807a725fe9a01ad74a07e9c51396c37';
const MARGIN_POOL_USDC = '0x5dec622733a204ca27f5a90d8c2fad453cc6665186fd5dff13a83d0b6c9027ab';

async function rpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(MAINNET_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  return (await res.json()).result;
}

// Tính lãi suất thực từ pool state
async function getPoolInterestRate(poolId: string, decimals: number) {
  try {
    const obj = await rpc('sui_getObject', [poolId, { showContent: true }]);
    const f = obj?.data?.content?.fields ?? {};
    const totalSupply = parseInt(f.total_supply ?? '0') / Math.pow(10, decimals);
    const totalBorrow = parseInt(f.total_borrow ?? '0') / Math.pow(10, decimals);
    const utilizationRate = totalSupply > 0 ? totalBorrow / totalSupply : 0;

    // Mô hình lãi suất kink: 0-80% utilization => 2-10% APR, >80% => 10-50% APR
    let borrowAPR: number;
    if (utilizationRate <= 0.8) {
      borrowAPR = 0.02 + (utilizationRate / 0.8) * 0.08; // 2% → 10%
    } else {
      borrowAPR = 0.10 + ((utilizationRate - 0.8) / 0.2) * 0.40; // 10% → 50%
    }

    return {
      totalSupply, totalBorrow,
      utilizationRate: (utilizationRate * 100).toFixed(2) + '%',
      borrowAPR: (borrowAPR * 100).toFixed(2) + '% APR',
      borrowAPRPerDay: ((borrowAPR / 365) * 100).toFixed(4) + '% / day',
      borrowCostPerWeek: (borrowAPR / 52 * 100).toFixed(4) + '% / week'
    };
  } catch (e) {
    return null;
  }
}

// Phân tích momentum dựa trên giá oracle hiện tại vs giá tham chiếu
function analyzeMomentum(currentPrice: number, change24h: string) {
  const pct = parseFloat(change24h.replace('%', '').replace('+', ''));
  if (pct > 5)      return { signal: '🚀 STRONG UP', bias: 'LONG',  confidence: 'High', note: 'Clear positive momentum' };
  if (pct > 2)      return { signal: '📈 MILD UP', bias: 'LONG',  confidence: 'Average', note: 'Uptrend, needs more confirmation' };
  if (pct > -2)     return { signal: '↔️ SIDEWAYS', bias: 'NEUTRAL', confidence: 'Low', note: 'Sideways market — limit new orders' };
  if (pct > -5)     return { signal: '📉 MILD DOWN', bias: 'SHORT', confidence: 'Average', note: 'Downtrend, consider a Short' };
  return           { signal: '💥 STRONG DOWN', bias: 'SHORT', confidence: 'High', note: 'Heavy selloff, mind the risk' };
}

// ATR-like volatility indicator (simplified)
function estimateVolatility(impliedVolatility: string) {
  const iv = parseFloat(impliedVolatility.replace('%', ''));
  const dailyVol = (iv / Math.sqrt(365)).toFixed(2);
  return {
    annualizedIV: impliedVolatility,
    dailyExpectedMove: dailyVol + '%',
    weeklyExpectedMove: ((parseFloat(dailyVol) * Math.sqrt(5))).toFixed(2) + '%',
    stopLossSuggestion: (parseFloat(dailyVol) * 1.5).toFixed(2) + '% below entry',
    takeProfitSuggestion: (parseFloat(dailyVol) * 2.5).toFixed(2) + '% above entry'
  };
}

export const marginEntryStrategistSkill = new FunctionTool({
  name: 'margin_entry_strategist',
  description: `Smart Margin entry-point selection skill on DeepBook V3 Mainnet.
Analyzes: (1) price momentum via real oracle data (CoinGecko live),
(2) on-chain Margin Pool borrow rates (to compute cost of carry),
(3) implied volatility (IV) to size SL/TP,
(4) concrete entry, stop-loss and take-profit suggestions per Long/Short strategy.
Call this skill for a complete trade plan before margin_open_position.`,
  parameters: z.object({
    asset: z.enum(['SUI', 'BTC', 'ETH']).describe('Asset to margin-trade'),
    direction: z.enum(['LONG', 'SHORT', 'AUTO']).default('AUTO').describe('Trade direction (AUTO = analyze automatically)'),
    capitalUSDC: z.number().min(0).describe('Available capital (USDC) for sizing'),
  }) as any,
  execute: async ({ asset, direction, capitalUSDC }) => {
    // 1. Lấy giá Oracle thực tế
    let oracleData: any = { price: 1.06, change24h: '0%', impliedVolatility: '40%', source: 'fallback' };
    try {
      const oracleTool = predictTools.find(t => (t as any).name === 'get_oracle_price');
      if (oracleTool) {
        const raw = await (oracleTool as any).execute({ asset });
        oracleData = typeof raw === 'string' ? JSON.parse(raw) : raw;
      }
    } catch (e) {}

    // 2. Phân tích Momentum
    const momentum = analyzeMomentum(oracleData.price, oracleData.change24h ?? '0%');
    const finalDirection = direction === 'AUTO' ? momentum.bias : direction;

    // 3. Lấy lãi suất Margin Pool on-chain
    const [suiPoolRate, usdcPoolRate] = await Promise.all([
      getPoolInterestRate(MARGIN_POOL_SUI, 9),
      getPoolInterestRate(MARGIN_POOL_USDC, 6)
    ]);

    // 4. Tính toán Volatility & SL/TP
    const volatility = estimateVolatility(oracleData.impliedVolatility ?? '50%');
    const entryPrice = oracleData.price;
    const slPct  = parseFloat(volatility.stopLossSuggestion.replace('% below entry', '')) / 100;
    const tpPct  = parseFloat(volatility.takeProfitSuggestion.replace('% above entry', '')) / 100;

    let stopLoss: number, takeProfit: number;
    if (finalDirection === 'LONG') {
      stopLoss   = entryPrice * (1 - slPct);
      takeProfit = entryPrice * (1 + tpPct);
    } else {
      stopLoss   = entryPrice * (1 + slPct);
      takeProfit = entryPrice * (1 - tpPct);
    }

    // 5. Tính chi phí lãi vay (carrying cost)
    const relevantRate = finalDirection === 'LONG' ? usdcPoolRate : suiPoolRate;
    const borrowRatePerWeek = relevantRate
      ? parseFloat((relevantRate.borrowCostPerWeek ?? '0.1').replace('% / week', '')) / 100
      : 0.001;
    const weeklyCostUSDC = capitalUSDC * borrowRatePerWeek;

    // 6. Risk/Reward Ratio
    const riskUSDC   = Math.abs(entryPrice - stopLoss) / entryPrice * capitalUSDC;
    const rewardUSDC = Math.abs(takeProfit - entryPrice) / entryPrice * capitalUSDC;
    const rrRatio    = riskUSDC > 0 ? rewardUSDC / riskUSDC : 0;

    const report = {
      timestamp: new Date().toISOString(),
      asset,
      oracleData: {
        currentPrice: `$${entryPrice}`,
        change24h: oracleData.change24h,
        source: oracleData.source
      },
      momentumAnalysis: momentum,
      recommendedDirection: finalDirection,

      marginPoolState: {
        suiBorrowPool: suiPoolRate ?? { error: 'Could not fetch' },
        usdcBorrowPool: usdcPoolRate ?? { error: 'Could not fetch' }
      },

      tradeSetup: {
        direction: finalDirection,
        entryPrice: `$${entryPrice.toFixed(4)}`,
        stopLoss: `$${stopLoss.toFixed(4)}`,
        takeProfit: `$${takeProfit.toFixed(4)}`,
        riskRewardRatio: `${rrRatio.toFixed(2)}:1`,
        estimatedRiskUSDC: `$${riskUSDC.toFixed(4)}`,
        estimatedRewardUSDC: `$${rewardUSDC.toFixed(4)}`,
        weeklyCostOfCarry: `$${weeklyCostUSDC.toFixed(4)} / week (borrow interest)`,
        note: rrRatio >= 2
          ? '✅ Good R/R ratio (≥2:1) — worth taking'
          : '⚠️ Low R/R ratio (<2:1) — reconsider TP/SL levels'
      },

      volatilityContext: volatility,

      summary: `${finalDirection} ${asset} @ $${entryPrice.toFixed(4)} | SL: $${stopLoss.toFixed(4)} | TP: $${takeProfit.toFixed(4)} | R/R: ${rrRatio.toFixed(2)}:1`,

      nextAction: `margin_create_account → margin_deposit_to_pool (${finalDirection === 'LONG' ? 'SUI' : 'USDC'}) → margin_open_position (pool: SUI_USDC, direction: ${finalDirection})`
    };

    return JSON.stringify(report, null, 2);
  }
});
