/** List ALL margin managers of the wallet with their type + assets + debt. */
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { DeepBookClient } from '@mysten/deepbook-v3';
import { getMarginManagerDetail } from '../src/utils/marginDetail';

const WALLET = '0xafbc48fd349fb44ce9c6f2b33423e6ae7c826d53a25920a0d4c3c475e40889c5';
const suiClient = new SuiJsonRpcClient({ url: 'https://fullnode.mainnet.sui.io', network: 'mainnet' as any });

async function main() {
  const discover = new DeepBookClient({ client: suiClient as any, network: 'mainnet', address: WALLET });
  const ids = await discover.getMarginManagerIdsForOwner(WALLET);
  console.log(`${ids.length} margin manager(s):\n`);

  for (const id of ids) {
    const obj = await (suiClient as any).getObject({ id, options: { showType: true } });
    const t: string = obj?.data?.type ?? '?';
    const pair = t.match(/MarginManager<([^,]+),\s*([^>]+)>/);
    const base = pair?.[1].split('::').pop() ?? '?';
    const quote = pair?.[2].split('::').pop() ?? '?';
    let detailStr = '';
    if (base === 'SUI' && quote === 'USDC') {
      const db = new DeepBookClient({
        client: suiClient as any, network: 'mainnet', address: WALLET,
        marginManagers: { [id]: { marginManagerKey: id, address: id, poolKey: 'SUI_USDC' } } as any,
      });
      const d = await getMarginManagerDetail(suiClient, db, id);
      detailStr = ` | liquid ${d.withdrawableSui} SUI + ${d.withdrawableUsdc} USDC | total ${d.totalSui} SUI + ${d.totalUsdc} USDC | debt base=${d.debtBaseShares} quote=${d.debtQuoteShares}`;
    }
    console.log(`${id.slice(0, 12)}…${id.slice(-6)}  ${base}/${quote}${detailStr}`);
  }
}
main().catch(console.error);
