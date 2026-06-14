/**
 * Inspect the SUI/USDC margin manager's on-chain state to understand
 * why withdraw aborts EBalanceTooLow despite assets showing 1 SUI.
 */
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { DeepBookClient } from '@mysten/deepbook-v3';
import { Transaction } from '@mysten/sui/transactions';

const WALLET = '0xafbc48fd349fb44ce9c6f2b33423e6ae7c826d53a25920a0d4c3c475e40889c5';
const MANAGER = '0xb3e0535c24065c3c0b72c19669a68eb447805951ef1c0f30c3d7e0fb1b9372b6';
const suiClient = new SuiJsonRpcClient({ url: 'https://fullnode.mainnet.sui.io', network: 'mainnet' as any });

async function main() {
  // 1. Full object content of the margin manager
  const obj = await (suiClient as any).getObject({
    id: MANAGER,
    options: { showContent: true, showType: true },
  });
  console.log('=== MarginManager object ===');
  console.log('type:', obj?.data?.type);
  console.log(JSON.stringify(obj?.data?.content, null, 2).slice(0, 3000));

  // 2. SDK-level views
  const db = new DeepBookClient({
    client: suiClient as any, network: 'mainnet', address: WALLET,
    marginManagers: { [MANAGER]: { marginManagerKey: MANAGER, address: MANAGER, poolKey: 'SUI_USDC' } } as any,
  });

  try {
    const assets = await db.getMarginManagerAssets(MANAGER);
    console.log('\n=== getMarginManagerAssets ===', assets);
  } catch (e: any) { console.log('assets err:', e.message); }

  try {
    const shares = await (db as any).getMarginManagerBorrowedShares?.(MANAGER);
    console.log('=== borrowedShares ===', shares);
  } catch (e: any) { console.log('shares err:', e.message); }

  // 3. Try smaller withdraw amounts to find the threshold
  for (const amt of [0.5, 0.9, 0.99, 1.0]) {
    try {
      const tx = new Transaction();
      tx.setSender(WALLET);
      const coin = db.marginManager.withdrawBase(MANAGER, amt)(tx);
      tx.transferObjects([coin], tx.pure.address(WALLET));
      const bytes = await tx.build({ client: suiClient as any });
      const res = await (suiClient as any).dryRunTransactionBlock({ transactionBlock: bytes });
      const st = res?.effects?.status;
      console.log(`withdraw ${amt} SUI →`, st?.status, st?.error ? st.error.slice(0, 100) : '');
    } catch (e: any) {
      console.log(`withdraw ${amt} SUI → build error:`, e.message.slice(0, 100));
    }
  }

  // 4. Try realistic borrow amounts to find min borrow
  for (const amt of [0.5, 1, 5]) {
    try {
      const tx = new Transaction();
      tx.setSender(WALLET);
      db.marginManager.borrowQuote(MANAGER, amt)(tx);
      const bytes = await tx.build({ client: suiClient as any });
      const res = await (suiClient as any).dryRunTransactionBlock({ transactionBlock: bytes });
      const st = res?.effects?.status;
      console.log(`borrow ${amt} USDC →`, st?.status, st?.error ? st.error.slice(0, 100) : '');
    } catch (e: any) {
      console.log(`borrow ${amt} USDC → build error:`, e.message.slice(0, 100));
    }
  }
}

main().catch(e => console.error(e));
