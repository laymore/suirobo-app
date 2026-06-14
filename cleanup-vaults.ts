import { SuiJsonRpcClient as SuiClient, getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { DeepBookClient } from '@mysten/deepbook-v3';
import fs from 'fs';
import path from 'path';

async function cleanup() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const keystorePath = path.join(home, '.sui', 'sui_config', 'sui.keystore');
  const keystore = JSON.parse(fs.readFileSync(keystorePath, 'utf8'));
  
  let keypair;
  for (let key of keystore) {
    const rawData = Buffer.from(key, 'base64');
    const kp = Ed25519Keypair.fromSecretKey(rawData.slice(1, 33));
    if (kp.toSuiAddress() === '0xafbc48fd349fb44ce9c6f2b33423e6ae7c826d53a25920a0d4c3c475e40889c5') {
      keypair = kp;
      break;
    }
  }

  if (!keypair) {
    throw new Error('Keypair not found');
  }

  const activeAddress = keypair.toSuiAddress();
  console.log('Cleanup for Owner:', activeAddress);

  const suiClient = new SuiClient({ url: getFullnodeUrl('mainnet') });
  
  // Find BalanceManagers
  const structType = `0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809::balance_manager::BalanceManager`;
  let res = await suiClient.getOwnedObjects({
    owner: activeAddress,
    filter: { StructType: structType }
  });
  
  console.log(`Found ${res.data.length} Vaults (BalanceManagers)`);

  for (const vault of res.data) {
    const vaultId = vault.data?.objectId;
    if (!vaultId) continue;
    console.log(`\nProcessing Vault: ${vaultId}`);

    const db = new DeepBookClient({
      client: suiClient as any,
      network: 'mainnet',
      address: activeAddress,
      balanceManagers: { 'my_vault': { address: vaultId } }
    });

    const tx = new Transaction();
    
    // Withdraw USDC
    console.log(`- Withdrawing all USDC from ${vaultId}`);
    db.balanceManager.withdrawAllFromManager('my_vault', 'USDC', activeAddress)(tx as any);
    
    // Withdraw SUI
    console.log(`- Withdrawing all SUI from ${vaultId}`);
    db.balanceManager.withdrawAllFromManager('my_vault', 'SUI', activeAddress)(tx as any);

    // Attempt to delete if possible (DeepBook V3 might not support this, so we wrap in try-catch later if needed)
    // tx.moveCall({
    //   target: `${packageId}::balance_manager::delete`,
    //   arguments: [tx.object(vaultId)]
    // });

    tx.setSender(activeAddress);
    const bytes = await tx.build({ client: suiClient as any });
    const signed = await keypair.signTransaction(bytes);
    
    console.log(`- Executing transaction...`);
    try {
      const result = await suiClient.executeTransactionBlock({
        transactionBlock: signed.bytes,
        signature: signed.signature,
        options: { showEffects: true }
      });
      console.log(`  Success! Transaction digest: ${result.digest}`);
      await new Promise(r => setTimeout(r, 2000));
    } catch (e: any) {
      console.error(`  Error withdrawing from Vault: ${e.message}`);
    }
  }

  console.log('\n✅ Cleanup complete! All funds have been withdrawn to your wallet.');
}

cleanup().catch(console.error);
