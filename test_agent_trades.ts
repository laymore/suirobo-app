import { SuiJsonRpcClient as SuiClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import fs from 'fs';
import path from 'path';

async function runTrades() {
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
  console.log('Testing Agent Trades for Owner:', activeAddress);

  const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
  
  const FACTORY_PACKAGE = '0x0a75f0b57015f967e3cb336585695a5c2e89f5ec9a74fec711361b9453d71a10';
  const MARKETPLACE_OBJ = '0x2a0cd8d4b09602dcf2dba2b0a254c8f1de4a9ce9e69ad98368339e11b710e823';

  // DUSDC Predict Variables
  const DUSDC_COIN = '0x30c1c0238d619110c8ab1e8519449ce96b60894b965e9a17ff8990c7246f61ed';
  const PREDICT_MANAGER = '0x84ba496a7c8d0c5ab4b98bfdc99099f68712613187d3b6c72fe0645c0ef48e2c';
  const ORACLE_ID = '0x195833aeee071530d2bdcd2e03916b7458d57c81ed540b82d6e1cb594bdf41f2';
  const PREDICT_OBJ = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
  const DUSDC_TYPE = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';

  for(let i=0; i<5; i++) {
    const tx = new Transaction();
    
    // 1. Split 1 DUSDC (10,000,000) for Mint
    const [dusdcCoin] = tx.splitCoins(tx.object(DUSDC_COIN), [tx.pure.u64(10000000)]);

    // 2. Deposit into PredictManager
    tx.moveCall({
      target: '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138::predict_manager::deposit',
      typeArguments: [DUSDC_TYPE],
      arguments: [tx.object(PREDICT_MANAGER), dusdcCoin]
    });

    // 3. Create MarketKey
    const marketKey = tx.moveCall({
      target: '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138::market_key::up',
      arguments: [tx.pure.id(ORACLE_ID), tx.pure.u64(1781251200000), tx.pure.u64(73000000000000)]
    });

    // 4. Predict Mint
    tx.moveCall({
      target: '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138::predict::mint',
      typeArguments: [DUSDC_TYPE],
      arguments: [tx.object(PREDICT_OBJ), tx.object(PREDICT_MANAGER), tx.object(ORACLE_ID), marketKey, tx.pure.u64(10000000), tx.object('0x6')]
    });

    // 5. Pay execution fee (MUST BE LAST because of Random object)
    const [feeCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(50000000)]);
    tx.moveCall({
      target: `${FACTORY_PACKAGE}::suirobo_factory::pay_execution_fee`,
      arguments: [
        tx.object(MARKETPLACE_OBJ),
        feeCoin,
        tx.pure(bcs.vector(bcs.Address).serialize([activeAddress])),
        tx.object('0x8')
      ]
    });

    tx.setSender(activeAddress);
    const bytes = await tx.build({ client: suiClient as any });
    const signed = await keypair.signTransaction(bytes);
    
    console.log(`[Trade ${i+1}] Executing Agent Predict Mint + Execution Fee...`);
    try {
      const result = await suiClient.executeTransactionBlock({
        transactionBlock: signed.bytes,
        signature: signed.signature,
        options: { showEffects: true, showObjectChanges: true, showEvents: true }
      });
      console.log(`  -> Success! Digest: ${result.digest}, Status: ${result.effects?.status.status}`);
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

runTrades().catch(console.error);
