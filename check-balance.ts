import { SuiJsonRpcClient as SuiClient, getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc';
import { DeepBookClient } from '@mysten/deepbook-v3';

async function check() {
  const suiClient = new SuiClient({ url: getFullnodeUrl('mainnet') });
  const activeAddress = '0xafbc48fd349fb44ce9c6f2b33423e6ae7c826d53a25920a0d4c3c475e40889c5';
  
  // Check Wallet Balances
  const suiBal = await suiClient.getBalance({ owner: activeAddress, coinType: '0x2::sui::SUI' });
  const usdcBal = await suiClient.getBalance({ owner: activeAddress, coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC' });
  
  console.log('--- WALLET BALANCES ---');
  console.log(`SUI: ${Number(suiBal.totalBalance) / 1e9}`);
  console.log(`USDC: ${Number(usdcBal.totalBalance) / 1e6}`);

  // Check Vaults Balances
  const packageId = '0x0e735f8c93a95722efd73521aca7a7652c0bb71ed1daf41b26dfd7d1ff71f748';
  const structType = `0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809::balance_manager::BalanceManager`;
  
  let res = await suiClient.getOwnedObjects({
    owner: activeAddress,
    filter: { StructType: structType }
  });

  console.log(`\n--- VAULTS BALANCES (${res.data.length} Vaults) ---`);
  
  for (const vault of res.data) {
    const vaultId = vault.data?.objectId;
    if (!vaultId) continue;
    
    const db = new DeepBookClient({
      client: suiClient as any,
      network: 'mainnet',
      address: activeAddress,
      balanceManagers: { 'my_vault': { address: vaultId } }
    });
    
    try {
      const b_sui = await db.checkManagerBalanceWithAddress(vaultId, 'SUI');
      const b_usdc = await db.checkManagerBalanceWithAddress(vaultId, 'USDC');
      
      if (b_sui?.balance > 0 || b_usdc?.balance > 0) {
        console.log(`Vault ${vaultId} - SUI: ${b_sui?.balance || 0} | USDC: ${b_usdc?.balance || 0}`);
      }
    } catch (e: any) {
      console.log(`Vault ${vaultId} - Error checking balance: ${e.message}`);
    }
  }
}

check().catch(console.error);
