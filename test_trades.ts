import { getFullnodeUrl, SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import fs from 'fs';
import os from 'os';

async function run() {
  const client = new SuiClient({ url: getFullnodeUrl('testnet') });
  
  const keystorePath = process.env.HOME ? process.env.HOME + '/.sui/sui_config/sui.keystore' : os.homedir() + '/.sui/sui_config/sui.keystore';
  const keystore = JSON.parse(fs.readFileSync(keystorePath, 'utf8'));
  const rawKey = Buffer.from(keystore[0], 'base64');
  const keypair = Ed25519Keypair.fromSecretKey(rawKey.slice(1));
  
  console.log('Using address:', keypair.getPublicKey().toSuiAddress());

  for(let i=0; i<5; i++) {
    const tx = new Transaction();
    const [feeCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(50000000)]);
    tx.moveCall({
      target: '0x0a75f0b57015f967e3cb336585695a5c2e89f5ec9a74fec711361b9453d71a10::suirobo_factory::pay_execution_fee',
      arguments: [
        tx.object('0x2a0cd8d4b09602dcf2dba2b0a254c8f1de4a9ce9e69ad98368339e11b710e823'),
        feeCoin,
        tx.makeMoveVec({ elements: [tx.pure.address('0xafbc48fd349fb44ce9c6f2b33423e6ae7c826d53a25920a0d4c3c475e40889c5')] }),
        tx.object('0x8')
      ]
    });
    const result = await client.signAndExecuteTransaction({ signer: keypair, transaction: tx, options: { showEffects: true } });
    console.log('Trade', i+1, 'done:', result.digest, result.effects?.status.status);
  }
}
run().catch(console.error);
