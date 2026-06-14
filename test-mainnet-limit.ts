import { SuiJsonRpcClient as SuiClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { DeepBookClient } from '@mysten/deepbook-v3';
import fs from 'fs';
import path from 'path';

async function testMainnetMarginTrade() {
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
  console.log('Testing Margin Trade (MAINNET) for Owner:', activeAddress);

  const suiClient = new SuiClient({ url: 'https://fullnode.mainnet.sui.io:443' });
  
  const poolKey = 'SUI_USDC';
  const managerKey = '0xb3e0535c24065c3c0b72c19669a68eb447805951ef1c0f30c3d7e0fb1b9372b6';

  const FACTORY_PACKAGE = '0x0a75f0b57015f967e3cb336585695a5c2e89f5ec9a74fec711361b9453d71a10';
  const MARKETPLACE_OBJ = '0x2a0cd8d4b09602dcf2dba2b0a254c8f1de4a9ce9e69ad98368339e11b710e823';
  const CREATOR_ADDR = activeAddress; 

  const marginDb = new DeepBookClient({
    client: suiClient as any,
    network: 'mainnet',
    address: activeAddress,
    marginManagers: { 'my_margin': { address: managerKey, marginManagerKey: managerKey, poolKey } as any }
  });

  const tx = new Transaction();

  // 1. Deposit 1.0 SUI to Margin Manager
  console.log(`- Depositing 1.0 SUI to Margin Manager...`);
  const [depositCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(1000000000)]); // 1.0 SUI
  marginDb.marginManager.depositBase({
    managerKey: 'my_margin',
    coin: depositCoin
  })(tx);

  // 2. Place Limit Order (ASK SUI at $10.0 to keep it open)
  const clientOrderId = Date.now().toString();
  console.log(`- Agent Skill Signal: Place Limit Order (ASK SUI at $10.0)...`);
  marginDb.poolProxy.placeLimitOrder({
    poolKey,
    marginManagerKey: 'my_margin',
    clientOrderId,
    quantity: 1.0, 
    price: 10.0,
    isBid: false, // Sell
    payWithDeep: false 
  })(tx);

  // 3. (Skipped Execution Fee because suirobo_factory is only on Testnet)

  tx.setSender(activeAddress);
  const bytes = await tx.build({ client: suiClient as any });
  const signed = await keypair.signTransaction(bytes);
  
  console.log(`- Executing Mainnet Transaction...`);
  try {
    const result = await suiClient.executeTransactionBlock({
      transactionBlock: signed.bytes,
      signature: signed.signature,
      options: { showEffects: true, showObjectChanges: true, showEvents: true }
    });
    console.log(`  -> Success! Digest: ${result.digest}`);
    
    // 4. Check if order exists
    console.log(`- Verifying open orders in DeepBook...`);
    const openOrders = await marginDb.poolProxy.listOpenOrders({
      poolKey,
      marginManagerKey: 'my_margin'
    });
    console.log(`  -> Open Orders found:`, openOrders.length);
    console.log(openOrders);
    
  } catch (e: any) {
    console.error(`  Error: ${e.message}`);
  }
}

testMainnetMarginTrade().catch(console.error);
