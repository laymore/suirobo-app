/**
 * PREDICT MULTI-ASSET ALLOCATOR SKILL
 * ─────────────────────────────────────────────────────
 * Kỹ năng phân bổ vốn thông minh qua nhiều assets Predict:
 *
 *  1. Quét đồng thời BTC, ETH, SUI trên Oracle
 *  2. Tính Expected Value (EV) cho TỪNG asset bằng Black-Scholes
 *  3. Apply Kelly Criterion để phân bổ vốn tối ưu
 *  4. Tạo danh mục Predict đa dạng hóa (Portfolio Diversification)
 *  5. Đề xuất bảng phân bổ chi tiết: asset nào, bao nhiêu DUSDC, strike nào
 *  6. So sánh "Single Bet" vs "Diversified" để chứng minh lợi thế
 *
 * → Đây là "Quỹ đầu tư mini" cho Predict Market
 */
import {   FunctionTool   } from '@google/adk';
import { z } from 'zod';

const COINGECKO_IDS: Record<string, string> = { BTC: 'bitcoin', ETH: 'ethereum', SUI: 'sui' };

// Tick sizes cho mỗi asset (từ bài học assert_valid_strike)
const TICK_SIZES: Record<string, number> = { BTC: 100, ETH: 10, SUI: 0.05 };

// Oracle Object IDs trên Testnet (chỉ BTC đã xác nhận hoạt động)
const ORACLE_IDS: Record<string, string | null> = {
  BTC: '0xcfe066027c625797eee54113784269e7e677a2dee3e7401d3761a8aad406d2e1',
  ETH: null,  // No  Oracle trên testnet
  SUI: null,  // No  Oracle trên testnet
};

// Black-Scholes binary probability
function binaryWinProb(
  currentPrice: number,
  strikePrice: number,
  direction: 'UP' | 'DOWN',
  iv: number,
  daysToExpiry: number
): number {
  const sigma = iv / 100;
  const t = daysToExpiry / 365;
  const sigmaT = sigma * Math.sqrt(t);
  if (sigmaT === 0) return 0.5;
  const d2 = (-Math.log(strikePrice / currentPrice)) / sigmaT;

  // Normal CDF
  const normalCDF = (x: number) => {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    x = Math.abs(x) / Math.sqrt(2);
    const t = 1.0 / (1.0 + p * x);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
    return 0.5 * (1.0 + sign * y);
  };

  return direction === 'UP' ? normalCDF(d2) : normalCDF(-d2);
}

// Strike Price tối ưu (có round theo Tick Size)
function optimalStrike(
  asset: string,
  currentPrice: number,
  direction: 'UP' | 'DOWN',
  iv: number,
  daysToExpiry: number,
  targetWinProb: number
): number {
  const sigma = iv / 100;
  const t = daysToExpiry / 365;
  const sigmaT = sigma * Math.sqrt(t);

  // Probit approximation
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
  let strike = currentPrice * Math.exp(-d2 * sigmaT);
  
  // Round to tick size
  const tick = TICK_SIZES[asset] ?? 1;
  strike = Math.round(strike / tick) * tick;
  return strike;
}

// Kelly Criterion: phân bổ vốn tối ưu
function kellyFraction(winProb: number, payoutMultiplier: number): number {
  // f* = (p * b - q) / b  where p=win prob, q=1-p, b=payout-1
  const p = winProb;
  const q = 1 - p;
  const b = payoutMultiplier - 1;
  if (b <= 0) return 0;
  const kelly = (p * b - q) / b;
  // Half-Kelly for safety
  return Math.max(0, Math.min(0.25, kelly * 0.5)); // Cap at 25%
}

// Lấy giá live nhiều asset
async function getMultiAssetPrices(): Promise<Record<string, { price: number; change24h: number; iv: number }>> {
  const result: Record<string, { price: number; change24h: number; iv: number }> = {};
  const defaultIVs: Record<string, number> = { BTC: 55, ETH: 65, SUI: 80 };
  const fallbackPrices: Record<string, number> = { BTC: 76000, ETH: 2500, SUI: 1.06 };

  for (const [asset, cgId] of Object.entries(COINGECKO_IDS)) {
    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd&include_24hr_change=true`,
        { signal: AbortSignal.timeout(5000) }
      );
      const data = await res.json();
      result[asset] = {
        price: data[cgId]?.usd ?? fallbackPrices[asset],
        change24h: data[cgId]?.usd_24h_change ?? 0,
        iv: defaultIVs[asset]
      };
    } catch {
      result[asset] = { price: fallbackPrices[asset], change24h: 0, iv: defaultIVs[asset] };
    }
  }
  return result;
}

export const predictMultiAssetAllocatorSkill = new FunctionTool({
  name: 'predict_multi_asset_allocator',
  description: `Smart capital allocation skill across MULTIPLE Predict assets (BTC/ETH/SUI) on DeepBook Predict Testnet.
Does: (1) scans live oracle prices for all 3 assets at once,
(2) computes each asset's expected value (EV) via Black-Scholes,
(3) picks the optimal direction (UP/DOWN) per asset from the 24h trend,
(4) applies the KELLY CRITERION (half-Kelly) for optimal capital allocation,
(5) rounds strikes to the venue tick size (avoids assert_valid_strike),
(6) compares an all-in single-asset strategy vs a diversified portfolio,
(7) outputs the detailed allocation: how much DUSDC into which asset at which strike.
Call when you have capital for Predict and want to optimize returns.`,
  parameters: z.object({
    totalCapitalDUSDC: z.number().min(0).describe('Total DUSDC capital to allocate'),
    expiryTimestamp: z.number().optional().describe('Expiry timestamp (ms). Default: 1779868800000'),
    riskProfile: z.enum(['conservative', 'moderate', 'aggressive']).default('moderate')
      .describe('Risk appetite: conservative (55% win), moderate (60%), aggressive (65%)'),
    excludeAssets: z.array(z.enum(['BTC', 'ETH', 'SUI'])).optional()
      .describe('Assets to exclude (skip)'),
  }) as any,
  execute: async ({ totalCapitalDUSDC, expiryTimestamp, riskProfile, excludeAssets }) => {
    const EXPIRY = expiryTimestamp ?? 1779868800000;
    const daysToExpiry = Math.max(0.5, (EXPIRY - Date.now()) / (1000 * 60 * 60 * 24));
    const PAYOUT_MULTIPLIER = 1.85; // DeepBook Predict typical payout

    const targetWinProbs: Record<string, number> = {
      conservative: 0.55,
      moderate: 0.60,
      aggressive: 0.65
    };
    const targetWP = targetWinProbs[riskProfile];

    // ── 1. Lấy giá tất cả assets ─────────────────────────────────────────────
    const prices = await getMultiAssetPrices();
    const excludeSet = new Set(excludeAssets ?? []);
    const activeAssets = Object.keys(prices).filter(a => !excludeSet.has(a as any));

    // ── 2. Phân tích EV cho mỗi asset ─────────────────────────────────────────
    const assetAnalysis: any[] = [];

    for (const asset of activeAssets) {
      const { price, change24h, iv } = prices[asset];
      
      // Xác định hướng dựa trên trend
      const direction: 'UP' | 'DOWN' = change24h >= 0 ? 'UP' : 'DOWN';
      
      // Tính strike tối ưu
      const strike = optimalStrike(asset, price, direction, iv, daysToExpiry, targetWP);
      
      // Tính EV
      const winProb = binaryWinProb(price, strike, direction, iv, daysToExpiry);
      const ev = winProb * PAYOUT_MULTIPLIER - 1;
      
      // Kelly fraction
      const kelly = kellyFraction(winProb, PAYOUT_MULTIPLIER);

      const oracleId = ORACLE_IDS[asset] ?? null;

      assetAnalysis.push({
        asset,
        currentPrice: price,
        change24h: `${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%`,
        iv: `${iv}%`,
        direction,
        strikePrice: strike,
        strikePriceE9: Math.floor(strike * 1e9),
        winProbability: winProb,
        expectedValue: ev,
        kellyFraction: kelly,
        oracleId,
        hasOracle: !!oracleId,
        verdict: ev > 0.15 ? '🔥 EXCELLENT' : ev > 0.05 ? '✅ GOOD' : ev > -0.05 ? '⚠️ NEUTRAL' : '❌ POOR'
      });
    }

    // Sort theo EV giảm dần
    assetAnalysis.sort((a, b) => b.expectedValue - a.expectedValue);

    // ── 3. Phân bổ vốn Kelly Criterion ────────────────────────────────────────
    // Chỉ phân bổ cho các asset có EV > 0 VÀ có Oracle trên testnet
    const positiveEVAssets = assetAnalysis.filter(a => a.expectedValue > 0 && a.hasOracle);
    const totalKelly = positiveEVAssets.reduce((s, a) => s + a.kellyFraction, 0);

    const allocations = positiveEVAssets.map(a => {
      const weight = totalKelly > 0 ? a.kellyFraction / totalKelly : 1 / positiveEVAssets.length;
      const allocatedDUSDC = Math.floor(totalCapitalDUSDC * weight * 100) / 100;
      const allocatedUnits = Math.floor(allocatedDUSDC * 1e6); // 6 decimals

      return {
        asset: a.asset,
        direction: a.direction,
        strikePrice: `$${a.strikePrice.toLocaleString()}`,
        strikePriceE9: a.strikePriceE9,
        oracleId: a.oracleId,
        allocatedDUSDC: allocatedDUSDC,
        allocatedUnits: allocatedUnits,
        weight: `${(weight * 100).toFixed(1)}%`,
        expectedReturn: `${(a.expectedValue * allocatedDUSDC).toFixed(2)} DUSDC`,
        maxPayout: `${(allocatedDUSDC * PAYOUT_MULTIPLIER).toFixed(2)} DUSDC`,
        winProbability: `${(a.winProbability * 100).toFixed(1)}%`,
        ev: `${(a.expectedValue * 100).toFixed(2)}%`,
        verdict: a.verdict
      };
    });

    // Nếu không dùng hết vốn, phần còn lại giữ cash
    const totalAllocated = allocations.reduce((s, a) => s + a.allocatedDUSDC, 0);
    const cashReserve = totalCapitalDUSDC - totalAllocated;

    // ── 4. So sánh Single vs Diversified ──────────────────────────────────────
    const bestSingle = assetAnalysis[0];
    const singleEV = bestSingle ? bestSingle.expectedValue * totalCapitalDUSDC : 0;
    const diversifiedEV = allocations.reduce((s, a) => {
      const asset = assetAnalysis.find(x => x.asset === a.asset)!;
      return s + asset.expectedValue * a.allocatedDUSDC;
    }, 0);

    // Portfolio variance reduction (simplified)
    const singleVariance = bestSingle ? totalCapitalDUSDC * totalCapitalDUSDC * (1 - bestSingle.winProbability) * bestSingle.winProbability : 0;
    const diversifiedVariance = allocations.reduce((s, a) => {
      const asset = assetAnalysis.find(x => x.asset === a.asset)!;
      return s + a.allocatedDUSDC * a.allocatedDUSDC * (1 - asset.winProbability) * asset.winProbability;
    }, 0);
    const riskReduction = singleVariance > 0 ? ((1 - diversifiedVariance / singleVariance) * 100) : 0;

    // ── 5. Build report ───────────────────────────────────────────────────────
    const report = {
      timestamp: new Date().toISOString(),
      network: 'testnet',
      config: {
        totalCapitalDUSDC,
        riskProfile,
        targetWinProbability: `${(targetWP * 100).toFixed(0)}%`,
        expiryDate: new Date(EXPIRY).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
        daysToExpiry: daysToExpiry.toFixed(1),
        excludedAssets: excludeAssets ?? []
      },

      marketScan: assetAnalysis.map(a => ({
        asset: a.asset,
        price: `$${a.currentPrice.toLocaleString()}`,
        trend: a.change24h,
        iv: a.iv,
        optimalDirection: a.direction,
        optimalStrike: `$${a.strikePrice.toLocaleString()}`,
        winProbability: `${(a.winProbability * 100).toFixed(1)}%`,
        ev: `${(a.expectedValue * 100).toFixed(2)}%`,
        kellyWeight: `${(a.kellyFraction * 100).toFixed(2)}%`,
        verdict: a.verdict
      })),

      portfolioAllocation: {
        strategy: 'KELLY CRITERION (Half-Kelly)',
        allocations,
        cashReserve: `${cashReserve.toFixed(2)} DUSDC (${(cashReserve/totalCapitalDUSDC*100).toFixed(1)}%)`,
        totalAllocated: `${totalAllocated.toFixed(2)} DUSDC`,
        totalExpectedReturn: `${diversifiedEV.toFixed(4)} DUSDC`,
        totalMaxPayout: `${(totalAllocated * PAYOUT_MULTIPLIER).toFixed(2)} DUSDC`
      },

      comparison: {
        singleBest: {
          asset: bestSingle?.asset ?? 'N/A',
          strategy: `All-in ${bestSingle?.asset ?? 'N/A'} ${bestSingle?.direction ?? ''} @ $${bestSingle?.strikePrice?.toLocaleString() ?? 0}`,
          expectedReturn: `${singleEV.toFixed(4)} DUSDC`,
          risk: '⚠️ Lose everything if one order is wrong'
        },
        diversified: {
          strategy: `${allocations.length} assets (Kelly optimized)`,
          expectedReturn: `${diversifiedEV.toFixed(4)} DUSDC`,
          risk: `✅ ${riskReduction.toFixed(1)}% less variance vs all-in`
        },
        winner: riskReduction > 10
          ? '🏆 DIVERSIFIED — much less risk at similar EV'
          : '🏆 SINGLE — concentrate on the best opportunity when EV is very large'
      },

      executeCommands: allocations.map(a => ({
        tool: 'predict_mint',
        args: {
          oracleId: a.oracleId,
          direction: a.direction,
          strikePrice: a.strikePriceE9,
          expiry: EXPIRY,
          quantity: a.allocatedUnits,
          quoteAsset: '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC'
        },
        note: `${a.asset} ${a.direction} @ ${a.strikePrice} — ${a.allocatedDUSDC} DUSDC`
      })),

      summary: allocations.length > 0
        ? `📊 Allocated ${totalAllocated.toFixed(2)}/${totalCapitalDUSDC} DUSDC across ${allocations.length} assets: ${allocations.map(a => `${a.asset} ${a.direction}(${a.weight})`).join(', ')}. Total EV: ${(diversifiedEV/totalCapitalDUSDC*100).toFixed(2)}%. Risk down ${riskReduction.toFixed(1)}%.`
        : `❌ No asset has positive EV. Keep your capital.`
    };

    return JSON.stringify(report, null, 2);
  }
});
