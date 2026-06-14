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

  const deepbook = new DeepBookClient({ client: suiClient as any, network: 'mainnet', address: keypair.toSuiAddress() });

  console.log('\n--- Test: Bán Spot 0.05 SUI -> USDC ---');
  try {
    const tx = new Transaction();
    const amountFloat = 0.05;
    const deepAmountFloat = 0.01;
    
    // Test the exact UI logic
    const coinsToTransfer = deepbook.deepBook.swapExactBaseForQuote({
      poolKey: 'SUI_USDC',
      amount: amountFloat,
      deepAmount: deepAmountFloat,
      minOut: 0,
    })(tx as any);

    tx.transferObjects(coinsToTransfer as any, tx.pure.address(keypair.toSuiAddress()));

    tx.setSender(keypair.toSuiAddress());
    const bytes = await tx.build({ client: suiClient as any });
    const { signature, bytes: signedBytes } = await keypair.signTransaction(bytes);
    console.log('Sending to Mainnet...');
    const result = await suiClient.executeTransactionBlock({
      transactionBlock: signedBytes,
      signature: signature,
      options: { showEffects: true },
    });
    console.log('Result Status:', result.effects?.status);
    console.log(`TX Digest: ${result.digest}`);
    
    if (result.effects?.status?.status === 'success') {
      console.log('✅ THÀNH CÔNG THỰC TẾ TRÊN CHUỖI!');
    } else {
      console.log('❌ THẤT BẠI!');
    }
  } catch (err: any) {
    console.error('Error:', err.message);
  }
}
run();
