import { SuiJsonRpcClient as SuiClient, getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import fs from 'fs';
import path from 'path';

async function testPredictTrade() {
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
  console.log('Testing Predict Trade for Owner:', activeAddress);

  const suiClient = new SuiClient({ url: getFullnodeUrl('testnet') });

  const PREDICT_PACKAGE = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
  const PREDICT_OBJ = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
  const SUI_CLOCK = '0x6';
  const DUSDC_TYPE = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
  const SUI_ORACLE_ID = '0x1ebb295c789cc42b3b2a1606482cd1c7124076a0f5676718501fda8c7fd075a0';
  const EXPIRY = 1779868800000;

  // We already know the predict manager ID for the active address
  const predictManagerId = '0xcd0da5793b6093bf8b132d0466c337aff40273c9a0adb26ea2550fd1c0aa2e16';

  const tx = new Transaction();

  const suiPrice = 1.05; // Mock current price of SUI
  const predictAmount = 50; // Predict 50 DUSDC
  const predictDir = 'UP';

  const strikePriceE9 = Math.floor(suiPrice * 1e9);
  const quantityE6 = Math.floor(predictAmount * 1e6);

  console.log(`1. Generating Market Key (Strike: ${suiPrice}, Dir: ${predictDir})`);
  const marketKey = tx.moveCall({
    target: `${PREDICT_PACKAGE}::market_key::${predictDir === 'UP' ? 'up' : 'down'}`,
    arguments: [
      tx.pure.id(SUI_ORACLE_ID),
      tx.pure.u64(EXPIRY),
      tx.pure.u64(strikePriceE9)
    ]
  });

  console.log(`2. Minting Predict Position...`);
  tx.moveCall({
    target: `${PREDICT_PACKAGE}::predict::mint`,
    typeArguments: [DUSDC_TYPE],
    arguments: [
      tx.object(PREDICT_OBJ),
      tx.object(predictManagerId),
      tx.object(SUI_ORACLE_ID),
      marketKey,
      tx.pure.u64(quantityE6),
      tx.object(SUI_CLOCK)
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
  } catch (e: any) {
    console.error(`  Error in Predict Trade: ${e.message}`);
  }
}

testPredictTrade().catch(console.error);
