import { SuiJsonRpcClient as SuiClient, getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import fs from 'fs';
import path from 'path';

async function testPredictMint() {
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
  console.log('Testing Predict Mint for Owner:', activeAddress);

  const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
  const tx = new Transaction();

  // Constants
  const DUSDC_COIN = '0x30c1c0238d619110c8ab1e8519449ce96b60894b965e9a17ff8990c7246f61ed';
  const PREDICT_MANAGER = '0x84ba496a7c8d0c5ab4b98bfdc99099f68712613187d3b6c72fe0645c0ef48e2c';
  const ORACLE_ID = '0x195833aeee071530d2bdcd2e03916b7458d57c81ed540b82d6e1cb594bdf41f2';
  const PREDICT_OBJ = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
  const DUSDC_TYPE = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';

  const amount = 10000000; // 1 DUSDC

  // 1. Split coin
  const [splitCoin] = tx.splitCoins(tx.object(DUSDC_COIN), [tx.pure.u64(amount)]);

  // 2. Deposit into PredictManager
  tx.moveCall({
    target: '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138::predict_manager::deposit',
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PREDICT_MANAGER),
      splitCoin
    ]
  });

  // 3. Create MarketKey
  const marketKey = tx.moveCall({
    target: '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138::market_key::up',
    arguments: [
      tx.pure.id(ORACLE_ID),
      tx.pure.u64(1781251200000), // Active Oracle Expiry
      tx.pure.u64(73000000000000) // Strike for BTC ($73k)
    ]
  });

  // 4. Mint
  tx.moveCall({
    target: '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138::predict::mint',
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PREDICT_OBJ),
      tx.object(PREDICT_MANAGER),
      tx.object(ORACLE_ID),
      marketKey,
      tx.pure.u64(amount),
      tx.object('0x6') // SUI_CLOCK
    ]
  });

  tx.setSender(activeAddress);
  const bytes = await tx.build({ client: suiClient as any });
  const signed = await keypair.signTransaction(bytes);
  
  console.log(`- Executing Predict Mint transaction...`);
  try {
    const result = await suiClient.executeTransactionBlock({
      transactionBlock: signed.bytes,
      signature: signed.signature,
      options: { showEffects: true, showObjectChanges: true }
    });
    console.log(`  Success! Transaction digest: ${result.digest}`);
    if (result.effects?.status.status === 'success') {
      console.log('Minted Predict position successfully!');
    } else {
      console.log('Mint failed:', result.effects?.status.error);
    }
  } catch (e: any) {
    console.error(`  Error: ${e.message}`);
  }
}

testPredictMint().catch(console.error);
