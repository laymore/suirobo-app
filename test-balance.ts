import { SuiJsonRpcClient as SuiClient, getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc';
import { DeepBookClient } from '@mysten/deepbook-v3';

async function run() {
  const suiClient = new SuiClient({ url: getFullnodeUrl('mainnet'), network: 'mainnet' as any });
  const deepbook = new DeepBookClient({ 
    client: suiClient as any, 
    network: 'mainnet',
    address: '0xafbc48fd349fb44ce9c6f2b33423e6ae7c826d53a25920a0d4c3c475e40889c5'
  });

  const managerId = '0x34f2e6d0dbb38e15efa8424bed5562c5fdd224f494c7d52a3586b06f646b7603';
  
  try {
    const balSUI = await deepbook.checkManagerBalanceWithAddress(managerId, 'SUI');
    console.log('SUI Balance:', balSUI);
  } catch (e: any) {
    console.error('Error fetching SUI:', e.message);
  }

  try {
    const balUSDC = await deepbook.checkManagerBalanceWithAddress(managerId, 'USDC');
    console.log('USDC Balance:', balUSDC);
  } catch (e: any) {
    console.error('Error fetching USDC:', e.message);
  }
}
run();
