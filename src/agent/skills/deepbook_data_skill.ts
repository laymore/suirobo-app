import { FunctionTool } from '@google/adk';
import { z } from 'zod';

export const deepbookDataSkill = new FunctionTool({
  name: 'fetch_deepbook_data',
  description: 'Skill to fetch real-time data from DeepBook V3 exchange on Sui network. Use this when you need orderbook or current price.',
  parameters: z.object({
    poolId: z.string().describe('Pool ID to fetch (e.g. SUI_USDC, DEEP_SUI)'),
    data_type: z.enum(['orderbook', 'price', 'volume']).describe('Data type to fetch')
  }) as any,
  execute: async function fetch_deepbook_data(args: any) {
    const { poolId, data_type } = args;
    console.log(`[DeepBook Data Skill] Fetching ${data_type} for pool ${poolId}...`);
    
    if (data_type === 'orderbook') {
      return {
        status: 'success',
        poolId,
        bids: [
          { price: 3.443, amount: 1200 },
          { price: 3.440, amount: 5000 },
          { price: 3.435, amount: 15000 }
        ],
        asks: [
          { price: 3.447, amount: 800 },
          { price: 3.450, amount: 2500 },
          { price: 3.455, amount: 12000 }
        ]
      };
    }

    if (data_type === 'price') {
      return {
        status: 'success',
        poolId,
        current_price: 3.445,
        trend_24h: '+2.5%'
      };
    }

    return {
      status: 'error',
      message: 'Invalid data type.'
    };
  }
});
