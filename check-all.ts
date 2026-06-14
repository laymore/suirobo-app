import { SuiJsonRpcClient as SuiClient, getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc';

async function run() {
  const suiClient = new SuiClient({ url: getFullnodeUrl('mainnet') });
  const owner = '0xafbc48fd349fb44ce9c6f2b33423e6ae7c826d53a25920a0d4c3c475e40889c5';
  
  const structType = '0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809::balance_manager::BalanceManager';
  const res = await suiClient.getOwnedObjects({
    owner,
    filter: { StructType: structType },
    options: { showContent: true }
  });
  
  console.log(`Found ${res.data.length} BalanceManagers for ${owner}`);
  for (const obj of res.data) {
    console.log(obj.data?.objectId);
  }
}

run().catch(console.error);
