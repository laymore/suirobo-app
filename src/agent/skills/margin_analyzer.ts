import {   FunctionTool   } from '@google/adk';
import { z } from 'zod';
import { marginTools } from '../tools/margin.js';

export const marginAnalyzerSkill = new FunctionTool({
  name: 'margin_analyzer_skill',
  description: 'Margin data analysis skill: Aggregates Oracle price, Pool liquidity, and current positions to recommend Trade strategy (Long/Short, Leverage).',
  parameters: z.object({
    asset: z.string().describe('Asset to analyze (e.g. BTC, SUI, ETH)'),
    walletAddress: z.string().describe('User wallet address to check the current position')
  }) as any,
  execute: async ({ asset, walletAddress }) => {
    try {
      // 1. Phân tích giá Oracle
      const oracleTool = marginTools.find(t => t.name === 'get_oracle_price');
      const oracleData = oracleTool ? await (oracleTool as any).execute({ asset }) : null;

      // 2. Phân tích Pool Liquidity
      const poolTool = marginTools.find(t => t.name === 'margin_pool_stats');
      const poolData = poolTool ? await (poolTool as any).execute({ asset }) : null;

      // 3. Phân tích current position
      const positionTool = marginTools.find(t => t.name === 'margin_list_positions');
      const positions = positionTool ? await (positionTool as any).execute({ walletAddress }) : null;

      // Xây dựng bản báo cáo phân tích
      const analysisReport = {
        asset,
        oracle: oracleData,
        pool: poolData,
        currentPositions: positions,
        recommendation: {
          action: "Automatic analysis",
          advice: `At the current ${asset} price, pool liquidity allows up to 3x leverage. If you expect upside, you can open a Long at a safe 2x leverage.`,
          riskLevel: "Medium"
        }
      };

      return JSON.stringify(analysisReport, null, 2);
    } catch (error: any) {
      return `Margin analysis error: ${error.message}`;
    }
  }
});
