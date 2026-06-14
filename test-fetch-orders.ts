import { SuiJsonRpcClient as SuiClient, getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { DeepBookClient } from '@mysten/deepbook-v3';

async function run() {
  const suiClient = new SuiClient({ url: getFullnodeUrl('mainnet'), network: 'mainnet' as any });
  const owner = '0xafbc48fd349fb44ce9c6f2b33423e6ae7c826d53a25920a0d4c3c475e40889c5';
  
  const packageId = '0x0e735f8c93a95722efd73521aca7a7652c0bb71ed1daf41b26dfd7d1ff71f748';
  const ownedObjects = await suiClient.getOwnedObjects({
    owner,
    filter: { StructType: `${packageId}::balance_manager::BalanceManager` },
    options: { showContent: true }
  });
  const managerId = ownedObjects.data[0]?.data?.objectId;

  if (!managerId) {
    console.log("No manager");
    return;
  }

  console.log("Manager:", managerId);

  const deepbook = new DeepBookClient({ 
    client: suiClient as any, 
    network: 'mainnet', 
    address: owner,
    balanceManagers: {
      'my_manager': { address: managerId }
    }
  });

  const tx = new Transaction();
  deepbook.deepBook.accountOpenOrders('SUI_USDC', 'my_manager')(tx as any);

  tx.setSender(owner);
  const result = await suiClient.devInspectTransactionBlock({
    transactionBlock: await tx.build({ client: suiClient as any }),
    sender: owner
  });

  console.log(JSON.stringify(result.results, null, 2));
}
run();
