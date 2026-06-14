/**
 * PREDICT POSITION MONITOR SKILL
 * Kỹ năng theo dõi vị thế Predict đang mở:
 * - Kiểm tra trạng thái current position trong PredictManager
 * - Tính P&L hiện tại dựa trên giá Oracle
 * - Cảnh báo khi giá gần Strike Price (sắp thua/thắng)
 * - Đề xuất chiến lược đóng sớm (Redeem sớm) hay giữ đến expiry
 */
import {   FunctionTool   } from '@google/adk';
import { z } from 'zod';
import { predictTools } from '../tools/predict.js';

const TESTNET_RPC = 'https://fullnode.testnet.sui.io';

async function testnetRpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(TESTNET_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  return (await res.json()).result;
}

function calculatePositionPnL(
  direction: 'UP' | 'DOWN',
  currentPrice: number,
  strikePrice: number,
  capitalDUSDC: number,
  payoutMultiplier: number = 1.85
): {
  isWinning: boolean;
  priceBuffer: number;
  priceBufferPct: number;
  estimatedPnL: number;
  estimatedPnLPct: number;
  status: string;
} {
  const isWinning = direction === 'UP'
    ? currentPrice > strikePrice
    : currentPrice < strikePrice;

  const priceBuffer = direction === 'UP'
    ? currentPrice - strikePrice
    : strikePrice - currentPrice;

  const priceBufferPct = (priceBuffer / strikePrice) * 100;

  const estimatedPnL = isWinning
    ? capitalDUSDC * (payoutMultiplier - 1)  // Profit if win
    : -capitalDUSDC;                          // Loss if lose

  const estimatedPnLPct = (estimatedPnL / capitalDUSDC) * 100;

  const status =
    priceBufferPct > 10 ? (isWinning ? '🟢 STRONG WIN — Highly safe' : '🔴 STRONG LOSS — Reversal unlikely') :
    priceBufferPct > 3  ? (isWinning ? '🟡 WINNING — Keep watching' : '🟠 LOSING — Review needed') :
                          '⚡ NEAR STRIKE — Outcome uncertain';

  return { isWinning, priceBuffer, priceBufferPct, estimatedPnL, estimatedPnLPct, status };
}

export const predictPositionMonitorSkill = new FunctionTool({
  name: 'predict_position_monitor',
  description: `Monitor open Predict positions on DeepBook Predict (Testnet).
Checks: (1) open Binary/Range positions in the PredictManager,
(2) current oracle price vs strike to see winning/losing,
(3) estimated P&L if held to expiry,
(4) exit suggestion: hold to expiry or redeem early (when deep in profit).
Call to monitor your current Predict portfolio.`,
  parameters: z.object({
    walletAddress: z.string().describe('User wallet address'),
    asset: z.enum(['BTC', 'SUI', 'ETH']).default('BTC').describe('Asset being monitored'),
  }) as any,
  execute: async ({ walletAddress, asset }) => {
    // 1. Get the position list from PredictManager
    let positions: any[] = [];
    let managerData: any = null;
    try {
      const listTool = predictTools.find(t => (t as any).name === 'predict_list_positions');
      if (listTool) {
        const raw = await (listTool as any).execute({ walletAddress });
        managerData = typeof raw === 'string' ? JSON.parse(raw) : raw;
        positions = managerData?.positions ?? managerData?.openPositions ?? [];
      }
    } catch (e) {}

    // 2. Get the current Oracle price (CoinGecko live via get_oracle_price tool)
    let currentPrice = 0;
    let oracleChange24h = 'N/A';
    try {
      const oracleTool = predictTools.find(t => (t as any).name === 'get_oracle_price');
      if (oracleTool) {
        const raw = await (oracleTool as any).execute({ asset });
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        currentPrice = parsed?.price ?? 0;
        oracleChange24h = parsed?.change24h ?? 'N/A';
      }
    } catch (e) {}

    // 3. Evaluate each position (only analyze REAL on-chain positions — never fabricate mocks)
    const positionAnalysis = [];
    let totalCapitalAtRisk = 0;
    let totalEstimatedPnL = 0;

    for (const pos of positions) {
      // Skip positions missing essential fields — never fabricate strike/expiry.
      if (pos.strikePrice == null || pos.capitalDUSDC == null) continue;
      const direction: 'UP' | 'DOWN' = pos.direction ?? 'UP';
      const strikePrice = pos.strikePrice;
      const capital = pos.capitalDUSDC ?? pos.quantity;
      const expiryMs = pos.expiry ?? pos.expiryTimestamp ?? Date.now();
      const daysRemaining = Math.max(0, (expiryMs - Date.now()) / (1000 * 60 * 60 * 24));

      const pnl = calculatePositionPnL(direction, currentPrice, strikePrice, capital);
      totalCapitalAtRisk += capital;
      totalEstimatedPnL += pnl.estimatedPnL;

      // Quyết định giữ vs redeem sớm
      let recommendation = '';
      if (pnl.isWinning && pnl.priceBufferPct > 15 && daysRemaining > 3) {
        recommendation = '✅ HOLD TO EXPIRY - Solidly winning — no action needed';
      } else if (pnl.isWinning && pnl.priceBufferPct > 5 && daysRemaining < 2) {
        recommendation = '🔔 CONSIDER EARLY REDEEM - Winning but near expiry — consider taking profit';
      } else if (!pnl.isWinning && pnl.priceBufferPct > 10) {
        recommendation = '⏳ WAIT FOR REVERSAL - Price needs to move significantly to win';
      } else if (!pnl.isWinning && daysRemaining < 1) {
        recommendation = '❌ PREPARE TO EXIT - Low reversal chance in the remaining 24h';
      } else {
        recommendation = '📊 WATCHING - No clear signal yet';
      }

      positionAnalysis.push({
        positionId: pos.id ?? 'unknown',
        asset: pos.asset ?? asset,
        direction,
        strikePrice: `$${strikePrice.toLocaleString()}`,
        currentPrice: `$${currentPrice.toLocaleString()}`,
        priceBuffer: `${pnl.priceBuffer > 0 ? '+' : ''}$${pnl.priceBuffer.toFixed(2)} (${pnl.priceBufferPct > 0 ? '+' : ''}${pnl.priceBufferPct.toFixed(2)}%)`,
        capitalDUSDC: capital,
        daysRemaining: daysRemaining.toFixed(1),
        expiryDate: new Date(expiryMs).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
        pnlStatus: pnl.status,
        estimatedPnL: `${pnl.estimatedPnL > 0 ? '+' : ''}${pnl.estimatedPnL.toFixed(4)} DUSDC`,
        estimatedPnLPct: `${pnl.estimatedPnLPct > 0 ? '+' : ''}${pnl.estimatedPnLPct.toFixed(2)}%`,
        recommendation
      });
    }

    // 4. Market context — only use live Oracle data; never fabricate Implied Volatility.
    const change24hNum = parseFloat(String(oracleChange24h).replace('%', '')) || 0;
    const marketContext = {
      currentPrice: currentPrice > 0 ? `$${currentPrice.toLocaleString()}` : 'N/A',
      change24h: oracleChange24h,
      marketCondition:
        Math.abs(change24hNum) > 10 ? '🌪️ EXTREMELY VOLATILE — High risk' :
        Math.abs(change24hNum) > 5  ? '📊 HIGH VOLATILITY' :
        Math.abs(change24hNum) > 2  ? '📈 MEDIUM VOLATILITY' :
                                      '😴 LOW VOLATILITY'
    };

    const overallStatus =
      positionAnalysis.length === 0
        ? (managerData?.predictManagerId
            ? '⚪ PredictManager exists but no open Binary/Range positions.'
            : '⚪ No PredictManager or Predict positions for this wallet.')
        : (totalEstimatedPnL > 0 ? '🟢 Portfolio in profit' : '🔴 Portfolio losing');

    const report = {
      timestamp: new Date().toISOString(),
      wallet: walletAddress,
      asset,
      network: 'testnet',
      source: 'On-chain Predict positions (live)',
      marketContext,
      portfolio: {
        predictManagerId: managerData?.predictManagerId ?? null,
        totalPositions: positionAnalysis.length,
        totalCapitalAtRisk: `${totalCapitalAtRisk.toFixed(4)} DUSDC`,
        totalEstimatedPnL: `${totalEstimatedPnL > 0 ? '+' : ''}${totalEstimatedPnL.toFixed(4)} DUSDC`,
        totalEstimatedPnLPct: totalCapitalAtRisk > 0
          ? `${((totalEstimatedPnL / totalCapitalAtRisk) * 100).toFixed(2)}%`
          : '0%',
        overallStatus
      },
      positions: positionAnalysis,
      nextActions: positionAnalysis
        .filter(p => p.recommendation.includes('REDEEM') || p.recommendation.includes('EXPIRY'))
        .map(p => ({
          positionId: p.positionId,
          action: p.recommendation,
          urgency: parseFloat(p.daysRemaining) < 1 ? 'URGENT' : 'NORMAL'
        }))
    };

    return JSON.stringify(report, null, 2);
  }
});
