import { SuiJsonRpcClient as SuiClient } from '@mysten/sui/jsonRpc';
import { DeepBookClient } from '@mysten/deepbook-v3';

async function check() {
  const suiClient = new SuiClient({ url: 'https://fullnode.mainnet.sui.io:443' });
  const address = '0xafbc48fd349fb44ce9c6f2b33423e6ae7c826d53a25920a0d4c3c475e40889c5';
  
  const dbClient = new DeepBookClient({ client: suiClient as any, network: 'mainnet', address });
  try {
    const managers = await dbClient.getMarginManagerIdsForOwner(address);
    console.log('Managers:', managers);
  } catch (e: any) {
    console.log('No managers found or error:', e.message);
  }
}
check().catch(console.error);
