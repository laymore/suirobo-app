import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { DeepBookClient } from '@mysten/deepbook-v3';
import { pickBestSuiUsdcManager } from '../src/utils/marginDetail';
const W = '0xafbc48fd349fb44ce9c6f2b33423e6ae7c826d53a25920a0d4c3c475e40889c5';
const sc = new SuiJsonRpcClient({ url: 'https://fullnode.mainnet.sui.io', network: 'mainnet' as any });
(async () => {
  const db = new DeepBookClient({ client: sc as any, network: 'mainnet', address: W });
  const ids = await db.getMarginManagerIdsForOwner(W);
  const best = await pickBestSuiUsdcManager(sc, ids);
  console.log('candidates:', ids.length);
  console.log('best pick :', best);
  console.log('expected  : 0xdb548514a9... (the one holding 10 USDC liquid)');
  console.log(best?.startsWith('0xdb548514') ? 'CORRECT ✓' : 'WRONG ✗');
})();
