import { SuiJsonRpcClient as SuiClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { DeepBookClient } from '@mysten/deepbook-v3';
import fs from 'fs';
import path from 'path';

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

  const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
  
  const poolKey = 'SUI_DBUSDC';
  const managerKey = '0xee88211a762342f23659717130742467fb791771e57ba9593a53273b1c598ac7';

  const marginDb = new DeepBookClient({
    client: suiClient as any,
    network: 'testnet',
    address: activeAddress,
    marginManagers: { 'my_margin': { address: managerKey, poolKey } }
  });

  const FACTORY_PACKAGE = '0x0a75f0b57015f967e3cb336585695a5c2e89f5ec9a74fec711361b9453d71a10';
  const MARKETPLACE_OBJ = '0x2a0cd8d4b09602dcf2dba2b0a254c8f1de4a9ce9e69ad98368339e11b710e823';
  const CREATOR_ADDR = activeAddress; 

  for(let i=0; i<5; i++) {
    const tx = new Transaction();

    // 1. Pay execution fee (Agent simulation)
    const [feeCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(50000000)]);
    tx.moveCall({
      target: `${FACTORY_PACKAGE}::suirobo_factory::pay_execution_fee`,
      arguments: [
        tx.object(MARKETPLACE_OBJ),
        feeCoin,
        tx.makeMoveVec({ elements: [tx.pure.address(CREATOR_ADDR)] }),
        tx.object('0x8') // Clock
      ]
    });

    // 2. Margin Limit Order
    console.log(`[Trade ${i+1}] Placing Limit Order with execution fee...`);
    marginDb.poolProxy.placeLimitOrder({
      poolKey,
      marginManagerKey: 'my_margin',
      clientOrderId: Date.now().toString(),
      quantity: 1.0, 
      price: 1.1 + Math.random()*0.2, // Some price
      isBid: true, 
      payWithDeep: false 
    })(tx);

    tx.setSender(activeAddress);
    const bytes = await tx.build({ client: suiClient as any });
    const signed = await keypair.signTransaction(bytes);
    
    try {
      const result = await suiClient.executeTransactionBlock({
        transactionBlock: signed.bytes,
        signature: signed.signature,
        options: { showEffects: true, showObjectChanges: true, showEvents: true }
      });
      console.log(`  -> Success! Digest: ${result.digest}, Effects: ${result.effects?.status.status}`);
      // Find fee event
      const feeEvent = result.events?.find(e => e.type.includes('ExecutionFeePaid'));
      if(feeEvent) {
        console.log(`  -> Fee Paid Event Verified:`, feeEvent.parsedJson);
      }
    } catch (e: any) {
      console.error(`  Error in Trade ${i+1}: ${e.message}`);
    }
  }
}

testMarginTrade().catch(console.error);
