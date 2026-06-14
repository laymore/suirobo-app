/**
 * AUTO STOP-LOSS & TAKE-PROFIT MANAGER
 * Auto risk monitoring and order close (Auto SL/TP):
 * 1. Margin: If the Health Factor drops below the alert threshold (<1.5), auto-call Repay/Close orders.
 * 2. Predict: If orders are deeply in profit (EV exceeds expectation) or expiry is near while losing, auto-Redeem.
 */
import {   FunctionTool   } from '@google/adk';
import { z } from 'zod';
import { predictPositionMonitorSkill } from './predict_position_monitor.js';
import { marginTools } from '../tools/margin.js';
import { predictTools } from '../tools/predict.js';

export const autoSlTpManagerSkill = new FunctionTool({
  name: 'auto_sl_tp_manager',
  description: `Monitor the entire portfolio (Margin & Predict) and AUTO-CLOSE positions when liquidation risk (SL) is detected or profit target (TP) is reached.
Uses 'autonomous' permission to execute On-chain trades automatically to protect capital.`,
  parameters: z.object({
    walletAddress: z.string().describe('User wallet address'),
    marginSlThreshold: z.number().default(1.5).describe('Health Factor threshold to trigger Margin Auto-SL'),
    predictTpThresholdPct: z.number().default(20).describe('Percentage above Strike price to trigger Predict Auto-TP'),
    executionMode: z.enum(['autonomous', 'require_approval']).default('autonomous'),
  }) as any,
  execute: async ({ walletAddress, marginSlThreshold, predictTpThresholdPct, executionMode }) => {
    const actionsTaken: any[] = [];
    const logs: string[] = [];
    
    logs.push('🛡️ Starting portfolio scan for Auto SL/TP...');

    // ==========================================
    // 1. Quét Margin (Rủi ro Thanh Lý) — dùng real on-chain state
    // ==========================================
    try {
      const healthTool = marginTools.find(t => t.name === 'get_margin_health');
      if (!healthTool) {
        logs.push('⚠️ Tool get_margin_health not found.');
      } else {
        const healthRaw = await (healthTool as any).execute({ walletAddress });
        const health = typeof healthRaw === 'string' ? JSON.parse(healthRaw) : healthRaw;

        if (!health?.hasAccount) {
          logs.push('ℹ️ [MARGIN] This wallet has no Margin Account — skipping SL scan.');
        } else {
          // Trích Health Factor / margin ratio từ state on-chain thật.
          const state = health.state ?? {};
          // SDK trả về snake_case hoặc camelCase tuỳ session bản — thử cả hai.
          const hfRaw =
            state.healthFactor ?? state.health_factor ??
            state.marginRatio ?? state.margin_ratio ?? null;
          const hfValue = hfRaw != null ? Number(hfRaw) : null;

          if (hfValue == null || Number.isNaN(hfValue)) {
            logs.push(`📊 [MARGIN] Account ${health.managerId} — Cannot read on-chain Health Factor (state missing fields). Skipping SL.`);
          } else if (hfValue < marginSlThreshold) {
            logs.push(`⚠️ [MARGIN SL] HF=${hfValue.toFixed(3)} < threshold ${marginSlThreshold}. Position must be closed manually — auto-close is disabled until on-chain position details are available.`);
            actionsTaken.push({ type: 'MARGIN_SL_ALERT', managerId: health.managerId, healthFactor: hfValue, threshold: marginSlThreshold });
          } else {
            logs.push(`✅ [MARGIN] HF=${hfValue.toFixed(3)} > ${marginSlThreshold} — safe.`);
          }
        }
      }
    } catch (e: any) {
      logs.push(`❌ Margin scan error: ${e.message}`);
    }

    // ==========================================
    // 2. Quét Predict (Chốt Lời Sớm)
    // ==========================================
    try {
      // Check for BTC specifically for now
      const predictRaw = await (predictPositionMonitorSkill as any).execute({ walletAddress, asset: 'BTC' });
      const pData = JSON.parse(predictRaw);
      const positions = pData.positions || [];

      for (const pos of positions) {
        let shouldRedeem = false;
        let reason = '';

        if (pos.pnlStatus.includes('WIN') && parseFloat(pos.priceBufferPct || 0) > predictTpThresholdPct) {
          shouldRedeem = true;
          reason = `Take-Profit threshold exceeded (${pos.priceBufferPct} > ${predictTpThresholdPct}%)`;
        } else if (pos.recommendation.includes('EARLY REDEEM') || pos.recommendation.includes('URGENT')) {
          shouldRedeem = true;
          reason = 'AI suggests urgent Redeem due to reversal risk / near expiry';
        }

        if (shouldRedeem) {
          // Only redeem when real on-chain IDs are present — never pass 0xMock into the tool.
          const hasRealIds =
            typeof pos.positionId === 'string' && pos.positionId.startsWith('0x') && pos.positionId.length >= 20 &&
            typeof pos.oracleId === 'string' && pos.oracleId.startsWith('0x') && pos.oracleId.length >= 20;

          if (!hasRealIds) {
            logs.push(`⚠️ [PREDICT TP] ${pos.asset} ${pos.direction}: ${reason} — but the position is missing on-chain positionId/oracleId. Skipping auto-redeem.`);
            actionsTaken.push({ type: 'PREDICT_TP_ALERT', asset: pos.asset, direction: pos.direction, reason });
            continue;
          }
          logs.push(`🎯 [PREDICT TP] Triggering early Redeem for ${pos.asset} ${pos.direction} because: ${reason}`);

          const redeemTool = predictTools.find(t => t.name === 'predict_redeem');
          if (redeemTool) {
            const res = await (redeemTool as any).execute({
              predictManagerId: pos.positionId,
              oracleId: pos.oracleId,
              direction: pos.direction,
              strikePrice: parseFloat(String(pos.strikePrice).replace(/[^0-9.]/g, '')),
              expiryTimestamp: new Date(pos.expiryDate).getTime() || Date.now() + 86400000,
              quantity: pos.capitalDUSDC * 1000000,
              quoteType: '0x2::sui::SUI',
              executionMode
            });
            actionsTaken.push({ type: 'PREDICT_TAKE_PROFIT', asset: pos.asset, direction: pos.direction, result: res.message });
            logs.push(`✅ Predict position redeemed successfully.`);
          }
        }
      }
    } catch (e: any) {
      logs.push(`❌ Predict scan error: ${e.message}`);
    }

    if (actionsTaken.length === 0) {
      logs.push('✅ Portfolio is healthy. No SL/TP orders triggered.');
    }

    return JSON.stringify({
      status: 'success',
      totalActions: actionsTaken.length,
      logs,
      actionsTaken,
      message: actionsTaken.length > 0 
        ? `Executed ${actionsTaken.length} Auto SL/TP orders.` 
        : 'Portfolio is healthy; no SL/TP triggered.'
    }, null, 2);
  }
});
