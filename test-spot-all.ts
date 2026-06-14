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
  console.log('Testing Spot DeepBook V3 for:', owner);

  // Use the manager we successfully created and funded in test-limit.ts
  const managerId = '0x34f2e6d0dbb38e15efa8424bed5562c5fdd224f494c7d52a3586b06f646b7603';
  console.log('Found BalanceManager:', managerId);

  const deepbook = new DeepBookClient({ 
    client: suiClient as any, 
    network: 'mainnet', 
    address: owner,
    balanceManagers: {
      'my_manager': { address: managerId }
    }
  });

  console.log('\n--- Test 0: Nạp 2.5 SUI vào Vault ---');
  try {
    const tx = new Transaction();
    
    // Deposit 2.5 SUI
    deepbook.balanceManager.depositIntoManager('my_manager', 'SUI', 2.5)(tx as any);

    tx.setSender(owner);
    const bytes = await tx.build({ client: suiClient as any });
    const { signature, bytes: signedBytes } = await keypair.signTransaction(bytes);
    const result = await suiClient.executeTransactionBlock({
      transactionBlock: signedBytes,
      signature,
      options: { showEffects: true }
    });
    console.log('Deposit Status:', result.effects?.status?.status);
    if (result.effects?.status?.status !== 'success') {
      console.log('Deposit Error:', result.effects?.status?.error);
    }
  } catch(e: any) {
    console.error('Deposit Error:', e.message);
  }

  // Sleep
  console.log('Waiting 3s for network indexing...');
  await new Promise(r => setTimeout(r, 3000));

  // Test 1: MARKET ORDER
  console.log('\n--- Test 1: Market Order (Sell 1 SUI) ---');
  try {
    const tx = new Transaction();
    
    deepbook.deepBook.placeMarketOrder({
      poolKey: 'SUI_USDC',
      balanceManagerKey: 'my_manager',
      clientOrderId: '7771',
      quantity: 1, // Sell 1 SUI
      isBid: false, // Sell SUI
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
    console.log('Market Order Status:', result.effects?.status?.status);
    console.log('TX Digest:', result.digest);
    if (result.effects?.status?.status !== 'success') {
      console.log('Market Order Failed:', result.effects?.status?.error);
    }
  } catch(e: any) {
    console.error('Market Order Error:', e.message);
  }

  // Sleep to avoid object version issues
  console.log('Waiting 3s for network indexing...');
  await new Promise(r => setTimeout(r, 3000));

  // Test 2: PLACE LIMIT ORDER
  console.log('\n--- Test 2: Place Limit Order (Sell 1 SUI at $1.5) ---');
  let placedOrderId: string | null = null;
  try {
    const tx = new Transaction();
    const expire = Date.now() + 1000 * 60 * 60 * 24; 
    
    deepbook.deepBook.placeLimitOrder({
      poolKey: 'SUI_USDC',
      balanceManagerKey: 'my_manager',
      clientOrderId: '9998',
      price: 1.5, 
      quantity: 1,
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
      options: { showEffects: true, showEvents: true }
    });
    console.log('Place Limit Order Status:', result.effects?.status?.status);
    console.log('TX Digest:', result.digest);

    if (result.effects?.status?.status !== 'success') {
      console.log('Limit Order Error:', result.effects?.status?.error);
    }

    if (result.events && result.events.length > 0) {
      const orderPlacedEvent = result.events.find((e: any) => e.type.includes('OrderPlaced'));
      if (orderPlacedEvent && orderPlacedEvent.parsedJson) {
        placedOrderId = orderPlacedEvent.parsedJson.order_id;
        console.log('✅ Found Order ID from event:', placedOrderId);
      }
    }
  } catch(e: any) {
    console.error('Place Limit Order Error:', e.message);
  }

  // Sleep
  console.log('Waiting 3s for network indexing...');
  await new Promise(r => setTimeout(r, 3000));

  if (placedOrderId) {
    // Test 3: CANCEL LIMIT ORDER
    console.log('\n--- Test 3: Cancel Limit Order ---');
    try {
      const tx = new Transaction();
      deepbook.deepBook.cancelOrder('SUI_USDC', 'my_manager', placedOrderId)(tx as any);

      tx.setSender(owner);
      const bytes = await tx.build({ client: suiClient as any });
      const { signature, bytes: signedBytes } = await keypair.signTransaction(bytes);
      const result = await suiClient.executeTransactionBlock({
        transactionBlock: signedBytes,
        signature,
        options: { showEffects: true }
      });
      console.log('Cancel Limit Order Status:', result.effects?.status?.status);
      console.log('TX Digest:', result.digest);
      if (result.effects?.status?.status === 'success') {
        console.log('✅ Limit Order successfully canceled on-chain!');
      } else {
        console.log('Cancel Limit Order Failed:', result.effects?.status?.error);
      }
    } catch(e: any) {
      console.error('Cancel Limit Order Error:', e.message);
    }
  } else {
    console.log('Skipping cancel test because order_id was not found.');
  }

  console.log('\n=== TEST SUITE FINISHED ===');
}

run().catch(console.error);
