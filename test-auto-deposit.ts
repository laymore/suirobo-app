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

  const activeAddress = keypair.toSuiAddress();
  console.log('Owner:', activeAddress);

  const suiClient = new SuiClient({ url: getFullnodeUrl('mainnet') });
  
  // Find BalanceManager
  const structType = '0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809::balance_manager::BalanceManager';
  const res = await suiClient.getOwnedObjects({
    owner: activeAddress,
    filter: { StructType: structType }
  });
  
  let activeVaultId = res.data[0]?.data?.objectId;
  const tx = new Transaction();

  if (!activeVaultId) {
    console.log('Creating new BalanceManager...');
    const packageId = '0x0e735f8c93a95722efd73521aca7a7652c0bb71ed1daf41b26dfd7d1ff71f748';
    const manager = tx.moveCall({
      target: `${packageId}::balance_manager::new`,
      arguments: []
    });
    tx.transferObjects([manager], tx.pure.address(activeAddress));
    
    tx.setSender(activeAddress);
    const bytes = await tx.build({ client: suiClient as any });
    const signed = await keypair.signTransaction(bytes);
    const initResult = await suiClient.executeTransactionBlock({
      transactionBlock: signed.bytes, signature: signed.signature,
      options: { showEffects: true, showObjectChanges: true }
    });
    const created = initResult.objectChanges?.find((c: any) => c.type === 'created' && c.objectType.includes('BalanceManager'));
    activeVaultId = (created as any).objectId;
    console.log('Created Vault:', activeVaultId);
  } else {
    console.log('Using existing Vault:', activeVaultId);
  }

  const db = new DeepBookClient({
    client: suiClient as any,
    network: 'mainnet',
    address: activeAddress,
    balanceManagers: { 'my_vault': { address: activeVaultId } }
  });

  const isBid = true;
  const amount = 1.0;
  const price = 0.95; // 0.95 USDC for 1 SUI
  const poolKey = 'SUI_USDC';

  // We check balance inside the Vault
  const usdcBalInfo = await db.checkManagerBalanceWithAddress(activeVaultId, 'USDC');
  const vaultUsdc = usdcBalInfo?.balance || 0;
  
  const txTrade = new Transaction();
  const usdcNeeded = amount * price;
  const missingUsdc = usdcNeeded - vaultUsdc;
  
  console.log(`Vault USDC: ${vaultUsdc}, Needed: ${usdcNeeded}, Missing: ${missingUsdc}`);

  if (missingUsdc > 0.0001) {
    console.log('Using db.balanceManager.depositIntoManager with amount...');
    db.balanceManager.depositIntoManager('my_vault', 'USDC', missingUsdc)(txTrade as any);
  }

  const expire = Date.now() + 1000 * 60 * 60 * 24 * 7;
  db.deepBook.placeLimitOrder({
    poolKey,
    balanceManagerKey: 'my_vault',
    clientOrderId: Math.floor(Math.random() * 1000000).toString(),
    price,
    quantity: amount,
    isBid,
    expiration: expire,
    orderType: 0, // NO_RESTRICTION
    payWithDeep: false
  })(txTrade as any);

  txTrade.setSender(activeAddress);
  console.log('Building transaction...');
  const bytes = await txTrade.build({ client: suiClient as any });
  console.log('Signing transaction...');
  const signed = await keypair.signTransaction(bytes);
  console.log('Executing transaction...');
  const result = await suiClient.executeTransactionBlock({
    transactionBlock: signed.bytes,
    signature: signed.signature,
    options: { showEffects: true }
  });

  console.log('Trade Status:', result.effects?.status?.status);
  console.log('Error:', result.effects?.status?.error);
}

run().catch(console.error);
