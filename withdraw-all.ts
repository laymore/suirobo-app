import { SuiJsonRpcClient as SuiClient, getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { DeepBookClient } from '@mysten/deepbook-v3';
import fs from 'fs';
import path from 'path';

async function run() {
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

  const owner = keypair.toSuiAddress();
  console.log('Owner:', owner);

  const suiClient = new SuiClient({ url: getFullnodeUrl('mainnet') });
  
  const structType = '0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809::balance_manager::BalanceManager';
  const res = await suiClient.getOwnedObjects({
    owner,
    filter: { StructType: structType },
    options: { showContent: true }
  });
  
  const managerIds = res.data.map(obj => obj.data?.objectId).filter(Boolean) as string[];
  console.log(`Found ${managerIds.length} BalanceManagers`);

  const deepbook = new DeepBookClient({ 
    client: suiClient as any, 
    network: 'mainnet', 
    address: owner
  });

  for (const id of managerIds) {
    console.log(`\nChecking Vault ${id}:`);
    const suiBal = await deepbook.checkManagerBalanceWithAddress(id, 'SUI');
    const usdcBal = await deepbook.checkManagerBalanceWithAddress(id, 'USDC');
    const suiAmount = suiBal?.balance || 0;
    const usdcAmount = usdcBal?.balance || 0;
    
    console.log('SUI:', suiAmount);
    console.log('USDC:', usdcAmount);

    if (suiAmount > 0 || usdcAmount > 0) {
      console.log('Withdrawing funds from', id);
      const tx = new Transaction();
      const db = new DeepBookClient({ 
        client: suiClient as any, 
        network: 'mainnet', 
        address: owner,
        balanceManagers: {
          'temp_manager': { address: id }
        }
      });
      
      if (suiAmount > 0) {
        db.balanceManager.withdrawFromManager('temp_manager', 'SUI', suiAmount)(tx as any);
      }
      if (usdcAmount > 0) {
        db.balanceManager.withdrawFromManager('temp_manager', 'USDC', usdcAmount)(tx as any);
      }

      tx.setSender(owner);
      const bytes = await tx.build({ client: suiClient as any });
      const { signature, bytes: signedBytes } = await keypair.signTransaction(bytes);
      const result = await suiClient.executeTransactionBlock({
        transactionBlock: signedBytes,
        signature,
        options: { showEffects: true, showEvents: true }
      });
      console.log('Withdraw Status:', result.effects?.status?.status);
    }
  }
}

run().catch(console.error);
