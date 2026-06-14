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

  if (!keypair) {
    console.log('Address 0xafbc... not found in keystore');
    return;
  }
  
  console.log('Testing with Address:', keypair.toSuiAddress());
  const { totalBalance } = await suiClient.getBalance({ owner: keypair.toSuiAddress() });
  console.log('SUI Balance:', Number(totalBalance) / 1e9);

  if (Number(totalBalance) < 100000000) {
    console.log('Not enough balance to run test (need at least 0.1 SUI)');
    return;
  }

  const deepbook = new DeepBookClient({ client: suiClient as any, network: 'mainnet', address: keypair.toSuiAddress() });

  // Order 1: Swap Exact SUI for USDC (Market Sell SUI)
  console.log('\n--- Test Lệnh 1: Bán 0.01 SUI sang USDC ---');
  try {
    const tx = new Transaction();
    const [b1, q1, d1] = deepbook.deepBook.swapExactBaseForQuote({
      poolKey: 'SUI_USDC',
      amount: 0.01,
      deepAmount: 0.01,
      minOut: 0,
    })(tx as any);
    tx.transferObjects([b1, q1, d1], tx.pure.address(keypair.toSuiAddress()));

    console.log('Đang ký và gửi lệnh 1...');
    tx.setSender(keypair.toSuiAddress());
    const bytes = await tx.build({ client: suiClient as any });
    const { signature, bytes: signedBytes } = await keypair.signTransaction(bytes);
    const result = await suiClient.executeTransactionBlock({
      transactionBlock: signedBytes,
      signature: signature,
      options: { showEffects: true },
    });
    console.log(`Lệnh 1 thành công! TX: ${result.digest}`);
  } catch (err: any) {
    console.error('Lệnh 1 thất bại:', err.message);
  }

  // Order 2: Buy SUI with USDC
  console.log('\n--- Test Lệnh 2: Mua SUI bằng USDC ---');
  try {
    const tx = new Transaction();
    // Use 0.01 USDC
    const [b2, q2, d2] = deepbook.deepBook.swapExactQuoteForBase({
      poolKey: 'SUI_USDC',
      amount: 0.01,
      deepAmount: 0.01,
      minOut: 0,
    })(tx as any);
    tx.transferObjects([b2, q2, d2], tx.pure.address(keypair.toSuiAddress()));

    console.log('Đang ký và gửi lệnh 2...');
    tx.setSender(keypair.toSuiAddress());
    const bytes = await tx.build({ client: suiClient as any });
    const { signature, bytes: signedBytes } = await keypair.signTransaction(bytes);
    const result = await suiClient.executeTransactionBlock({
      transactionBlock: signedBytes,
      signature: signature,
      options: { showEffects: true },
    });
    console.log(`Lệnh 2 thành công! TX: ${result.digest}`);
  } catch (err: any) {
    console.error('Lệnh 2 thất bại:', err.message);
  }

  // Order 3: Sell a tiny bit more SUI
  console.log('\n--- Test Lệnh 3: Đặt lệnh Spot Market (Sell) ---');
  try {
    const tx = new Transaction();
    const [b3, q3, d3] = deepbook.deepBook.swapExactBaseForQuote({
      poolKey: 'SUI_USDC',
      amount: 0.005,
      deepAmount: 0.01,
      minOut: 0,
    })(tx as any);
    tx.transferObjects([b3, q3, d3], tx.pure.address(keypair.toSuiAddress()));

    console.log('Đang ký và gửi lệnh 3...');
    tx.setSender(keypair.toSuiAddress());
    const bytes = await tx.build({ client: suiClient as any });
    const { signature, bytes: signedBytes } = await keypair.signTransaction(bytes);
    const result = await suiClient.executeTransactionBlock({
      transactionBlock: signedBytes,
      signature: signature,
      options: { showEffects: true },
    });
    console.log(`Lệnh 3 thành công! TX: ${result.digest}`);
  } catch (err: any) {
    console.error('Lệnh 3 thất bại:', err.message);
  }
}

run().catch(console.error);
