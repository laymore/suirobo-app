import { SuiJsonRpcClient as SuiClient, getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { DeepBookClient } from '@mysten/deepbook-v3';
import fs from 'fs';
import path from 'path';

async function testMarginVault() {
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
  console.log('Testing Margin Vault for Owner:', activeAddress);

  const suiClient = new SuiClient({ url: getFullnodeUrl('mainnet') });
  const db = new DeepBookClient({
    client: suiClient as any,
    network: 'mainnet',
    address: activeAddress
  });

  const poolKey = 'SUI_USDC';
  const amountToDeposit = 0.01;

  console.log(`\n1. Checking existing MarginManagers...`);
  let managerIdsRaw = await db.getMarginManagerIdsForOwner(activeAddress);
  let managerIds: string[] = [];
  
  if (managerIdsRaw.length > 0) {
    const objs = await suiClient.multiGetObjects({
      ids: managerIdsRaw,
      options: { showType: true }
    });
    managerIds = objs
      .filter(o => o.data?.type?.includes('sui::SUI') && o.data?.type?.includes('MarginManager'))
      .map(o => o.data!.objectId);
  }

  let managerKey = '';

  const tx = new Transaction();

  if (managerIds.length === 0) {
    console.log(`No MarginManager found. Creating one and depositing ${amountToDeposit} SUI...`);
    const { manager, initializer } = db.marginManager.newMarginManagerWithInitializer(poolKey)(tx);
    db.marginManager.depositDuringInitialization({
      manager, poolKey, coinType: '0x2::sui::SUI', amount: amountToDeposit
    })(tx);
    db.marginManager.shareMarginManager(poolKey, manager, initializer)(tx);
  } else {
    managerKey = managerIds[0];
    
    // Create a new DeepBookClient with the margin manager configured
    const marginDb = new DeepBookClient({
      client: suiClient as any,
      network: 'mainnet',
      address: activeAddress,
      marginManagers: { 'my_margin': { address: managerKey, poolKey } }
    });
    
    console.log(`Found MarginManager: ${managerKey}. Depositing ${amountToDeposit} SUI...`);
    marginDb.marginManager.depositBase({ managerKey: 'my_margin', amount: amountToDeposit })(tx);
  }

  // Also withdraw the same amount after depositing just to test withdrawal.
  // Wait, if it's newly created, managerKey isn't known yet. 
  // Let's do it in two separate transactions to test properly.

  tx.setSender(activeAddress);
  const bytes = await tx.build({ client: suiClient as any });
  const signed = await keypair.signTransaction(bytes);
  
  console.log(`- Executing Deposit transaction...`);
  try {
    const result = await suiClient.executeTransactionBlock({
      transactionBlock: signed.bytes,
      signature: signed.signature,
      options: { showEffects: true }
    });
    console.log(`  Success! Transaction digest: ${result.digest}`);
    await new Promise(r => setTimeout(r, 2000));
  } catch (e: any) {
    console.error(`  Error depositing to Vault: ${e.message}`);
    return;
  }

  // Refetch manager ids if it was created
  if (managerIds.length === 0) {
    let raw = await db.getMarginManagerIdsForOwner(activeAddress);
    const objs = await suiClient.multiGetObjects({ ids: raw, options: { showType: true } });
    managerIds = objs.filter(o => o.data?.type?.includes('sui::SUI') && o.data?.type?.includes('MarginManager')).map(o => o.data!.objectId);
    managerKey = managerIds[0];
  }

  const marginDb2 = new DeepBookClient({
    client: suiClient as any,
    network: 'mainnet',
    address: activeAddress,
    marginManagers: { 'my_margin': { address: managerKey, poolKey } }
  });

  console.log(`\n2. Withdrawing ${amountToDeposit} SUI from MarginManager: ${managerKey}...`);
  const tx2 = new Transaction();
  const withdrawnCoin = marginDb2.marginManager.withdrawBase('my_margin', amountToDeposit)(tx2);
  tx2.transferObjects([withdrawnCoin], activeAddress);
  tx2.setSender(activeAddress);
  const bytes2 = await tx2.build({ client: suiClient as any });
  const signed2 = await keypair.signTransaction(bytes2);
  
  console.log(`- Executing Withdraw transaction...`);
  try {
    const result2 = await suiClient.executeTransactionBlock({
      transactionBlock: signed2.bytes,
      signature: signed2.signature,
      options: { showEffects: true }
    });
    console.log(`  Success! Transaction digest: ${result2.digest}`);
  } catch (e: any) {
    console.error(`  Error withdrawing from Vault: ${e.message}`);
  }

  console.log('\n✅ Margin Vault Deposit/Withdraw test complete!');
}

testMarginVault().catch(console.error);
