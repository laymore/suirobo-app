import { SuiJsonRpcClient as SuiClient, getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc';

async function run() {
  const suiClient = new SuiClient({ url: getFullnodeUrl('mainnet') });
  const res = await suiClient.getObject({ 
    id: '0x34f2e6d0dbb38e15efa8424bed5562c5fdd224f494c7d52a3586b06f646b7603',
    options: { showType: true }
  });
  console.log('Type:', res.data?.type);
}
run();
