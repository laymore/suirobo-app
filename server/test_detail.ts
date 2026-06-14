import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { DeepBookClient } from '@mysten/deepbook-v3';
import { getMarginManagerDetail } from '../src/utils/marginDetail';
const W = '0xafbc48fd349fb44ce9c6f2b33423e6ae7c826d53a25920a0d4c3c475e40889c5';
const M = '0xb3e0535c24065c3c0b72c19669a68eb447805951ef1c0f30c3d7e0fb1b9372b6';
const sc = new SuiJsonRpcClient({ url: 'https://fullnode.mainnet.sui.io', network: 'mainnet' as any });
const db = new DeepBookClient({ client: sc as any, network: 'mainnet', address: W, marginManagers: { [M]: { marginManagerKey: M, address: M, poolKey: 'SUI_USDC' } } as any });
getMarginManagerDetail(sc, db, M).then(d => {
  console.log('withdrawableSui :', d.withdrawableSui);
  console.log('withdrawableUsdc:', d.withdrawableUsdc);
  console.log('debtBaseShares  :', d.debtBaseShares.toString());
  console.log('debtQuoteShares :', d.debtQuoteShares.toString());
  console.log('totalSui        :', d.totalSui);
  console.log('totalUsdc       :', d.totalUsdc);
}).catch(e => console.error('ERR', e));
