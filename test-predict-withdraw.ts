import { SuiJsonRpcClient as SuiClient, getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import fs from 'fs';
import path from 'path';

async function withdrawDUSDC() {
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
  console.log('Withdrawing DUSDC for Owner:', activeAddress);

  const suiClient = new SuiClient({ url: 'https://fullnode.testnet.sui.io:443' });
  const tx = new Transaction();

  // Withdraw exactly 95477906 DUSDC from the PredictManager that has the balance
  const coin = tx.moveCall({
    target: '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138::predict_manager::withdraw',
    typeArguments: ['0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC'],
    arguments: [
      tx.object('0x84ba496a7c8d0c5ab4b98bfdc99099f68712613187d3b6c72fe0645c0ef48e2c'), // PredictManager
      tx.pure.u64(95477906) // Amount
    ]
  });

  // Transfer the withdrawn coin to the user
  tx.transferObjects([coin], activeAddress);

  tx.setSender(activeAddress);
  const bytes = await tx.build({ client: suiClient as any });
  const signed = await keypair.signTransaction(bytes);
  
  console.log(`- Executing Withdraw transaction...`);
  try {
    const result = await suiClient.executeTransactionBlock({
      transactionBlock: signed.bytes,
      signature: signed.signature,
      options: { showEffects: true, showObjectChanges: true }
    });
    console.log(`  Success! Transaction digest: ${result.digest}`);
  } catch (e: any) {
    console.error(`  Error: ${e.message}`);
  }
}

withdrawDUSDC().catch(console.error);
