import { SuiJsonRpcClient as SuiClient, getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { DeepBookClient } from '@mysten/deepbook-v3';
import fs from 'fs';
import path from 'path';

import { usePythOracle } from './src/hooks/usePythOracle';

async function testMarginTrade() {
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
  console.log('Testing Margin Trade for Owner:', activeAddress);

  const suiClient = new SuiClient({ url: getFullnodeUrl('mainnet') });
  const db = new DeepBookClient({
    client: suiClient as any,
    network: 'mainnet',
    address: activeAddress
  });

  const { fetchAndInjectVAA } = usePythOracle(suiClient as any);

  const poolKey = 'SUI_USDC';
  const amountToDeposit = 5.0; // Deposit 5.0 USDC
  const amountToBorrow = 1.0; // Borrow 1.0 SUI
  const amountToTrade = 1.0; // Trade 1.0 SUI

  let managerIdsRaw = await db.getMarginManagerIdsForOwner(activeAddress);
  let managerIds: string[] = [];
  
  if (managerIdsRaw.length > 0) {
    const objs = await suiClient.multiGetObjects({ ids: managerIdsRaw, options: { showType: true } });
    managerIds = objs.filter(o => o.data?.type?.includes('sui::SUI') && o.data?.type?.includes('MarginManager')).map(o => o.data!.objectId);
  }

  let managerKey = managerIds[0];

  if (!managerKey) {
    console.error('No MarginManager found! Run test-margin-vault.ts first!');
    return;
  }

  const marginDb = new DeepBookClient({
    client: suiClient as any,
    network: 'mainnet',
    address: activeAddress,
    marginManagers: { 'my_margin': { address: managerKey, poolKey } }
  });

  const tx = new Transaction();

  console.log(`1. Depositing ${amountToDeposit} SUI as Collateral...`);
  marginDb.marginManager.depositBase({ managerKey: 'my_margin', amount: amountToDeposit })(tx);

  console.log(`1.5. Fetching and Injecting VAA from Pyth...`);
  await fetchAndInjectVAA(tx, poolKey);
  marginDb.poolProxy.updateCurrentPrice(poolKey)(tx);

  console.log(`2. Placing Limit Order (SELL SUI for USDC at $1.2)...`);
  marginDb.poolProxy.placeLimitOrder({
    poolKey,
    marginManagerKey: 'my_margin',
    clientOrderId: Date.now().toString(),
    quantity: amountToTrade, 
    price: 1.2,
    isBid: false, // SELL
    payWithDeep: false 
  })(tx);

  tx.setSender(activeAddress);
  const bytes = await tx.build({ client: suiClient as any });
  const signed = await keypair.signTransaction(bytes);
  
  console.log(`- Executing Margin Trade transaction...`);
  try {
    const result = await suiClient.executeTransactionBlock({
      transactionBlock: signed.bytes,
      signature: signed.signature,
      options: { showEffects: true, showObjectChanges: true }
    });
    console.log(`  Success! Transaction digest: ${result.digest}`);
    // console.log(JSON.stringify(result.objectChanges, null, 2));
  } catch (e: any) {
    console.error(`  Error in Margin Trade: ${e.message}`);
  }
}

testMarginTrade().catch(console.error);
