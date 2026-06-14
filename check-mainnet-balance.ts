import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
const client = new SuiJsonRpcClient({ url: 'https://fullnode.mainnet.sui.io:443' });
client.getBalance({ owner: '0xafbc48fd349fb44ce9c6f2b33423e6ae7c826d53a25920a0d4c3c475e40889c5' }).then(console.log).catch(console.error);
