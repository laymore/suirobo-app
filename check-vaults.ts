import { SuiJsonRpcClient as SuiClient, getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
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

  const owner = keypair!.toSuiAddress();
  console.log('Owner:', owner);

  const deepbook = new DeepBookClient({ 
    client: suiClient as any, 
    network: 'mainnet', 
    address: owner
  });

  const ids = await deepbook.getBalanceManagerIds(owner);
  console.log('Found Vaults:', ids);

  for (const id of ids) {
    console.log(`\nChecking Vault ${id}:`);
    const suiBal = await deepbook.checkManagerBalanceWithAddress(id, 'SUI');
    console.log('SUI:', suiBal?.balance);
    const usdcBal = await deepbook.checkManagerBalanceWithAddress(id, 'USDC');
    console.log('USDC:', usdcBal?.balance);
  }
}

run().catch(console.error);
