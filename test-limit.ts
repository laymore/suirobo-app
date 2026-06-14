import { SuiJsonRpcClient as SuiClient, getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { DeepBookClient } from '@mysten/deepbook-v3';
import fs from 'fs';
import path from 'path';

async function run() {
  const suiClient = new SuiClient({ url: getFullnodeUrl('mainnet'), network: 'mainnet' as any });
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

  const owner = keypair.toSuiAddress();
  console.log('Testing Limit Orders for:', owner);

  const packageId = '0x0e735f8c93a95722efd73521aca7a7652c0bb71ed1daf41b26dfd7d1ff71f748';

  console.log('1. Looking for existing BalanceManager...');
  let managerId: string | undefined;
  
  // Retry fetch until found if we just created it
  for (let i = 0; i < 3; i++) {
    const ownedObjects = await suiClient.getOwnedObjects({
      owner,
      filter: { StructType: `${packageId}::balance_manager::BalanceManager` },
      options: { showContent: true }
    });
    managerId = ownedObjects.data[0]?.data?.objectId;
    if (managerId) break;
    await new Promise(r => setTimeout(r, 2000));
  }

  if (!managerId) {
    console.log('No BalanceManager found. Creating one...');
    const tx = new Transaction();
    const manager = tx.moveCall({
      target: `${packageId}::balance_manager::new`,
      arguments: []
    });
    tx.transferObjects([manager], tx.pure.address(owner));

    tx.setSender(owner);
    const bytes = await tx.build({ client: suiClient as any });
    const { signature, bytes: signedBytes } = await keypair.signTransaction(bytes);
    const result = await suiClient.executeTransactionBlock({
      transactionBlock: signedBytes,
      signature,
      options: { showEffects: true, showObjectChanges: true }
    });
    
    const created = result.objectChanges?.find(c => c.type === 'created' && c.objectType.includes('BalanceManager'));
    if (created && 'objectId' in created) {
      managerId = created.objectId;
      console.log('Created BalanceManager:', managerId);
      console.log('Waiting for network indexer to catch up...');
      await new Promise(r => setTimeout(r, 5000));
    } else {
      console.error('Failed to create BalanceManager', result.objectChanges);
      return;
    }
  } else {
    console.log('Found existing BalanceManager:', managerId);
  }

  const deepbook = new DeepBookClient({ 
    client: suiClient as any, 
    network: 'mainnet', 
    address: owner,
    balanceManagers: {
      'my_manager': { address: managerId }
    }
  });

  console.log('\n--- Test 1: Nạp 0.1 SUI và 0.1 USDC vào Vault ---');
  try {
    const tx = new Transaction();
    
    // Deposit SUI
    deepbook.balanceManager.depositIntoManager('my_manager', 'SUI', 0.1)(tx as any);
    
    // Deposit USDC
    deepbook.balanceManager.depositIntoManager('my_manager', 'USDC', 0.1)(tx as any);

    tx.setSender(owner);
    const bytes = await tx.build({ client: suiClient as any });
    const { signature, bytes: signedBytes } = await keypair.signTransaction(bytes);
    const result = await suiClient.executeTransactionBlock({
      transactionBlock: signedBytes,
      signature,
      options: { showEffects: true }
    });
    console.log('Deposit Status:', result.effects?.status);
    console.log('TX Digest:', result.digest);
  } catch(e: any) {
    console.error('Deposit Failed:', e.message);
  }

  console.log('\n--- Test 2: Sell Limit 0.05 SUI (Giá 5.0 USDC - Rất cao để treo lệnh) ---');
  try {
    const tx = new Transaction();
    const expire = Date.now() + 1000 * 60 * 60 * 24; // 1 day
    
    deepbook.deepBook.placeLimitOrder({
      poolKey: 'SUI_USDC',
      balanceManagerKey: 'my_manager',
      clientOrderId: '9991',
      price: 5.0, // Sell at $5.0
      quantity: 0.05,
      isBid: false,
      expiration: expire,
      orderType: 0,
      payWithDeep: false 
    })(tx as any);

    tx.setSender(owner);
    const bytes = await tx.build({ client: suiClient as any });
    const { signature, bytes: signedBytes } = await keypair.signTransaction(bytes);
    const result = await suiClient.executeTransactionBlock({
      transactionBlock: signedBytes,
      signature,
      options: { showEffects: true }
    });
    console.log('Sell Limit Order Status:', result.effects?.status);
    console.log('TX Digest:', result.digest);
  } catch(e: any) {
    console.error('Sell Limit Order Failed:', e.message);
  }

  console.log('\n--- Test 3: Buy Limit 0.05 SUI (Giá 0.1 USDC - Rất thấp để treo lệnh) ---');
  try {
    const tx = new Transaction();
    const expire = Date.now() + 1000 * 60 * 60 * 24;
    
    deepbook.deepBook.placeLimitOrder({
      poolKey: 'SUI_USDC',
      balanceManagerKey: 'my_manager',
      clientOrderId: '9992',
      price: 0.1, // Buy at $0.1
      quantity: 0.05,
      isBid: true,
      expiration: expire,
      orderType: 0,
      payWithDeep: false 
    })(tx as any);

    tx.setSender(owner);
    const bytes = await tx.build({ client: suiClient as any });
    const { signature, bytes: signedBytes } = await keypair.signTransaction(bytes);
    const result = await suiClient.executeTransactionBlock({
      transactionBlock: signedBytes,
      signature,
      options: { showEffects: true }
    });
    console.log('Buy Limit Order Status:', result.effects?.status);
    console.log('TX Digest:', result.digest);
  } catch(e: any) {
    console.error('Buy Limit Order Failed:', e.message);
  }
}
run();
