import { Transaction } from '@mysten/sui/transactions';
import {
  SuiPriceServiceConnection,
  SuiPythClient,
  mainnetPythConfigs,
  mainnetCoins
} from '@mysten/deepbook-v3';

export function usePythOracle(suiClient: any) {
  /**
   * Fetches the latest VAA from Pyth Hermes and injects the update command into the transaction.
   * @param tx The transaction block
   * @param poolKey The DeepBook V3 pool key (e.g., 'SUI_USDC')
   */
  const fetchAndInjectVAA = async (tx: Transaction, poolKey: string) => {
    try {
      const [baseCoin, quoteCoin] = poolKey.split('_');
      
      // Get the price feed IDs from the mainnetCoins config
      const baseFeed = (mainnetCoins as any)[baseCoin]?.feed;
      const quoteFeed = (mainnetCoins as any)[quoteCoin]?.feed;

      if (!baseFeed || !quoteFeed) {
        throw new Error(`Feed ID not found for ${poolKey}`);
      }

      const feedIds = [baseFeed, quoteFeed];

      // Setup Pyth connection
      const connection = new SuiPriceServiceConnection('https://hermes.pyth.network');
      
      // Setup Pyth client
      const pythClient = new SuiPythClient(
        suiClient as any,
        mainnetPythConfigs.pythStateId,
        mainnetPythConfigs.wormholeStateId
      );

      // 1. Fetch VAAs
      const updates = await connection.getPriceFeedsUpdateData(feedIds);
      
      if (!updates || updates.length === 0) {
        throw new Error('Failed to fetch VAA updates from Hermes');
      }

      // 2. Inject updates into the Transaction Block
      await pythClient.updatePriceFeeds(tx, updates, feedIds);
      
      return true;
    } catch (error) {
      console.error('Error fetching/injecting VAA:', error);
      throw error;
    }
  };

  return { fetchAndInjectVAA };
}
