import { SuiJsonRpcClient as SuiClient, getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc';
const client = new SuiClient({ url: getFullnodeUrl('mainnet') });
client.queryTransactionBlocks({ filter: { FromAddress: '0xafbc48fd349fb44ce9c6f2b33423e6ae7c826d53a25920a0d4c3c475e40889c5' }, options: { showEffects: true, showEvents: true }, limit: 5 }).then(r => console.log(JSON.stringify(r.data, null, 2)));
