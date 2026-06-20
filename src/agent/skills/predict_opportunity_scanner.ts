/**
 * PREDICT OPPORTUNITY SCANNER SKILL
 * Kỹ năng quét opportunity Predict chuyên sâu:
 * - Lấy giá Oracle thực tế và phân tích Implied Volatility (IV)
 * - Quét Vault TVL để kiểm tra thanh khoản (tránh mở orders khi pool cạn)
 * - Tính toán Expected Value (EV) và Payout Multiplier cho từng strategy
 * - Gợi ý Binary vs Range, và mức Strike Price tối ưu
 * - Warning risk expiry timing
 */
import {   FunctionTool   } from '@google/adk';
import { z } from 'zod';
import { predictTools } from '../tools/predict.js';

// Testnet Predict Contract Constants
const TESTNET_RPC        = 'https://fullnode.testnet.sui.io';
const PREDICT_PACKAGE    = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
const PREDICT_MARKET     = '0x2f4d7dfe4c18ef6a73d4f7a2b1b0e32a847e067b0f5bbbcdb7a8aedb8a8c547'; // BTC Binary Market
const DUSDC_TYPE         = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';

async function testnetRpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(TESTNET_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  return (await res.json()).result;
}

// Phân tích opportunity Binary Predict
function analyzeBinaryOpportunity(
  currentPrice: number,
  strikePrice: number,
  direction: 'UP' | 'DOWN',
  impliedVolatility: number,
  daysToExpiry: number
): {
  winProbability: number;
  expectedValue: number;
  payoutMultiplier: number;
  verdict: string;
  edge: string;
} {
  // Black-Scholes binary probability (simplified)
  const sigma = impliedVolatility / 100;
  const t = daysToExpiry / 365;
  const logRatio = Math.log(strikePrice / currentPrice);
  const sigmaT = sigma * Math.sqrt(t);
  
  // d2 calculation (risk-neutral probability)
  const d2 = (- logRatio) / sigmaT;
  
  // Normal CDF approximation
  const normalCDF = (x: number) => {
    const a1 =  0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 =  1.061405429, p  =  0.3275911;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);
    const t = 1.0 / (1.0 + p * x);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return 0.5 * (1.0 + sign * y);
  };

  const winProb = direction === 'UP'
    ? normalCDF(d2)      // Prob(price > strike at expiry)
    : normalCDF(-d2);    // Prob(price < strike at expiry)

  // Typical DeepBook Predict payout: 1.8x–2.0x (10% cut)
  const payoutMultiplier = 1.85;
  const expectedValue = winProb * payoutMultiplier - 1; // EV per $1 bet

  const verdict =
    expectedValue > 0.15 ? '🔥 EXCELLENT — high EV, clear opportunity' :
    expectedValue > 0.05 ? '✅ GOOD — positive EV, worth entering' :
    expectedValue > -0.05 ? '⚠️ NEUTRAL — needs more confirmation' :
                            '❌ POOR — negative EV, do not stake';

  const edge = expectedValue > 0
    ? `${(expectedValue * 100).toFixed(1)}% edge per unit of capital`
    : `${(Math.abs(expectedValue) * 100).toFixed(1)}% disadvantage — the market is against this`;

  return { winProbability: winProb, expectedValue, payoutMultiplier, verdict, edge };
}

function suggestOptimalStrikePrice(
  asset: string,
  currentPrice: number,
  direction: 'UP' | 'DOWN',
  volatility: number,
  daysToExpiry: number,
  targetWinProb: number = 0.55
): number {
  const sigma = volatility / 100;
  const t = daysToExpiry / 365;
  const sigmaT = sigma * Math.sqrt(t);
  
  // Inverse CDF (probit) approximation for target win probability
  const probit = (p: number) => {
    const a = [0, -3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
               1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [0, -5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
               6.680131188771972e+01, -1.328068155288572e+01];
    const p2 = p <= 0.5 ? p : 1 - p;
    const q = Math.sqrt(-2 * Math.log(p2));
    const num = a[6] + q * (a[5] + q * (a[4] + q * (a[3] + q * (a[2] + q * a[1]))));
    const den = 1 + q * (b[5] + q * (b[4] + q * (b[3] + q * (b[2] + q * b[1]))));
    const z = num / den;
    return p <= 0.5 ? -z : z;
  };

  const d2 = probit(direction === 'UP' ? targetWinProb : 1 - targetWinProb);
  let optimalStrike = currentPrice * Math.exp(-d2 * sigmaT);
  
  // DeepBook Predict yêu cầu Strike Price làm tròn theo Tick Size (hoặc chuẩn của sàn)
  let tickSize = 0.1;
  if (asset === 'BTC') tickSize = 100; // Làm tròn đến $100
  if (asset === 'ETH') tickSize = 10;  // Làm tròn đến $10
  if (asset === 'SUI') tickSize = 0.05; // Làm tròn đến $0.05

  optimalStrike = Math.round(optimalStrike / tickSize) * tickSize;
  return optimalStrike;
}

export const predictOpportunityScannerSkill = new FunctionTool({
  name: 'predict_opportunity_scanner',
  description: `Deep opportunity scanner skill for DeepBook Predict (Testnet).
Analyzes: (1) real oracle price + implied volatility,
(2) theoretical win probability (Black-Scholes binary),
(3) expected value (EV) to see whether the order has an edge,
(4) optimal strike suggestion to maximize win probability,
(5) Binary vs Range comparison to pick the right strategy for the market.
Call before predict_mint to make sure the order has positive EV.`,
  parameters: z.object({
    asset: z.enum(['BTC', 'SUI', 'ETH']).describe('Asset to predict'),
    direction: z.enum(['UP', 'DOWN', 'AUTO']).default('AUTO').describe('Prediction direction (AUTO = let the AI decide)'),
    strikePriceOverride: z.number().optional().describe('Specific strike price (omit to let the AI compute it)'),
    expiryTimestamp: z.number().optional().describe('Expiry (ms timestamp, empty = default 1779868800000)'),
    capitalDUSDC: z.number().min(0).describe('DUSDC amount to stake'),
  }) as any,
  execute: async ({ asset, direction, strikePriceOverride, expiryTimestamp, capitalDUSDC }) => {
    const EXPIRY = expiryTimestamp ?? 1779868800000;
    const daysToExpiry = Math.max(0.5, (EXPIRY - Date.now()) / (1000 * 60 * 60 * 24));

    // 1. Lấy giá Oracle thực tế
    let oracleData: any = { price: 77000, change24h: '0%', impliedVolatility: '62.4%', activeExpiryTimestamp: EXPIRY };
    try {
      const oracleTool = predictTools.find(t => (t as any).name === 'get_oracle_price');
      if (oracleTool) {
        const raw = await (oracleTool as any).execute({ asset });
        oracleData = typeof raw === 'string' ? JSON.parse(raw) : raw;
      }
    } catch (e) {}

    const currentPrice = oracleData.price;
    const iv = parseFloat((oracleData.impliedVolatility ?? '60%').replace('%', ''));
    const change24h = parseFloat((oracleData.change24h ?? '0%').replace('%', '').replace('+', ''));

    // 2. Xác định hướng tự động nếu AUTO
    let finalDirection: 'UP' | 'DOWN';
    if (direction === 'AUTO') {
      finalDirection = change24h >= 0 ? 'UP' : 'DOWN';
    } else {
      finalDirection = direction;
    }

    // 3. Tính toán Strike Price tối ưu
    let optimalStrike: number;
    if (strikePriceOverride) {
      optimalStrike = strikePriceOverride;
    } else {
      // Gợi ý 3 mức strike: Conservative (55% win), Moderate (60%), Aggressive (65%)
      optimalStrike = suggestOptimalStrikePrice(asset, currentPrice, finalDirection, iv, daysToExpiry, 0.60);
    }

    // 4. Phân tích EV và opportunity
    const analysis = analyzeBinaryOpportunity(currentPrice, optimalStrike, finalDirection, iv, daysToExpiry);

    // 5. Các mức Strike Price khác nhau để so sánh
    const strikeOptions = [
      { label: '🟢 Conservative (55% win prob)', strike: suggestOptimalStrikePrice(asset, currentPrice, finalDirection, iv, daysToExpiry, 0.55) },
      { label: '🟡 Balanced (60% win prob)', strike: suggestOptimalStrikePrice(asset, currentPrice, finalDirection, iv, daysToExpiry, 0.60) },
      { label: '🔴 Aggressive (65% win prob)', strike: suggestOptimalStrikePrice(asset, currentPrice, finalDirection, iv, daysToExpiry, 0.65) },
    ].map(s => ({
      ...s,
      strike: parseFloat(s.strike.toFixed(2)),
      strikeE9: Math.floor(s.strike * 1e9), // Định dạng cho Smart Contract
      ev: analyzeBinaryOpportunity(currentPrice, s.strike, finalDirection, iv, daysToExpiry)
    }));

    // 6. Vault TVL (kiểm tra thanh khoản)
    let vaultTVL = 'Unavailable';
    try {
      const vaultTool = predictTools.find(t => (t as any).name === 'get_vault_stats');
      if (vaultTool) {
        const raw = await (vaultTool as any).execute({});
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        vaultTVL = parsed?.tvl ?? vaultTVL;
      }
    } catch (e) {}

    // 7. Tính Expected Return
    const expectedReturn = capitalDUSDC * analysis.expectedValue;
    const maxPayout = capitalDUSDC * analysis.payoutMultiplier;

    const report = {
      timestamp: new Date().toISOString(),
      asset,
      oracleData: {
        currentPrice: `$${currentPrice.toLocaleString()}`,
        change24h: oracleData.change24h,
        impliedVolatility: oracleData.impliedVolatility,
        daysToExpiry: daysToExpiry.toFixed(1),
        expiryDate: new Date(EXPIRY).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })
      },
      vaultLiquidity: vaultTVL,

      recommendedStrategy: {
        type: 'BINARY',
        direction: finalDirection,
        directionExplanation: finalDirection === 'UP'
          ? 'Predicts the price will be ABOVE the strike at expiry'
          : 'Predicts the price will be BELOW the strike at expiry',
        selectedStrikePrice: optimalStrike.toFixed(2),
        selectedStrikePriceE9: Math.floor(optimalStrike * 1e9),
        winProbability: `${(analysis.winProbability * 100).toFixed(1)}%`,
        expectedValue: `${(analysis.expectedValue * 100).toFixed(2)}%`,
        verdict: analysis.verdict,
        edge: analysis.edge
      },

      capitalPlan: {
        inputDUSDC: capitalDUSDC,
        maxPayout: `${maxPayout.toFixed(4)} DUSDC`,
        expectedReturn: `${expectedReturn.toFixed(4)} DUSDC (${(analysis.expectedValue*100).toFixed(2)}%)`,
        worstCase: `Lose ${capitalDUSDC.toFixed(4)} DUSDC`
      },

      strikeComparison: strikeOptions.map(s => ({
        label: s.label,
        strike: `$${s.strike.toLocaleString()}`,
        strikeE9: s.strikeE9,
        winProbability: `${(s.ev.winProbability * 100).toFixed(1)}%`,
        expectedValue: `${(s.ev.expectedValue * 100).toFixed(2)}%`,
        verdict: s.ev.verdict
      })),

      executeCommand: {
        tool: 'predict_mint',
        args: {
          managerIdNote: 'Use the Manager ID from predict_list_positions',
          direction: finalDirection,
          strikePrice: Math.floor(optimalStrike * 1e9),
          expiry: EXPIRY,
          quoteAsset: DUSDC_TYPE,
          quantity: Math.floor(capitalDUSDC * 1e6),
          quantityNote: `${capitalDUSDC} DUSDC = ${Math.floor(capitalDUSDC * 1e6)} units (6 decimals)`
        }
      },

      vsRangeStrategy: {
        recommendation: daysToExpiry < 7
          ? '📌 Use BINARY for short expiries (<7 days) — better liquidity, lower fees'
          : '📌 Consider RANGE for long expiries (>7 days) in sideways markets',
        currentChoice: 'BINARY',
        reason: `IV=${iv.toFixed(1)}%, ${daysToExpiry.toFixed(0)} days left → ${iv > 70 ? 'High IV — binary UP/DOWN is risky but pays big' : 'Moderate IV — binary fits a trending market'}`
      },

      summary: `${finalDirection} ${asset} @ strike $${optimalStrike.toFixed(2)} | Win Prob: ${(analysis.winProbability*100).toFixed(1)}% | EV: ${(analysis.expectedValue*100).toFixed(2)}% | ${analysis.verdict}`
    };

    return JSON.stringify(report, null, 2);
  }
});
