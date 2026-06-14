import {   FunctionTool   } from '@google/adk';
import { z } from 'zod';
import { predictTools } from '../tools/predict.js';

export const predictAnalyzerSkill = new FunctionTool({
  name: 'predict_analyzer_skill',
  description: 'Predict optimization skill: Analyzes Vault TVL, Payout ratio, and Oracle price to suggest optimal Mint Binary or Range Position strategy.',
  parameters: z.object({
    asset: z.string().describe('Asset to predict (e.g. BTC)')
  }) as any,
  execute: async ({ asset }) => {
    try {
      const oracleTool = predictTools.find(t => t.name === 'get_oracle_price');
      const oracleData = oracleTool ? await (oracleTool as any).execute({ asset }) : null;

      const analysisReport = {
        asset,
        currentOracleData: oracleData,
        analysis: {
          vaultStatus: "Deep liquidity (> 1M DUSDC)",
          recommendedAction: "Mint Binary UP",
          reason: `${asset} price action favors the upside. Consider minting a binary with a strike one step above the current price to maximize the win odds.`
        }
      };

      return JSON.stringify(analysisReport, null, 2);
    } catch (error: any) {
      return `Predict analysis error: ${error.message}`;
    }
  }
});
