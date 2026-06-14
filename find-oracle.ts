import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
async function run() {
  const sui = new SuiJsonRpcClient({ url: 'https://fullnode.testnet.sui.io:443' });
  const res = await sui.queryEvents({
    query: {
      MoveModule: {
        package: '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138',
        module: 'oracle'
      }
    },
    limit: 20,
    order: 'descending'
  });
  console.log(JSON.stringify(res.data, null, 2));
}
run().catch(console.error);
