import { SuiJsonRpcClient as SuiClient, getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { DeepBookClient } from '@mysten/deepbook-v3';
import fs from 'fs';
import path from 'path';

async function run() {
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
  const suiClient = new SuiClient({ url: getFullnodeUrl('mainnet') });
  const managerId = '0x34f2e6d0dbb38e15efa8424bed5562c5fdd224f494c7d52a3586b06f646b7603';
  
  const deepbook = new DeepBookClient({ 
    client: suiClient as any, 
    network: 'mainnet', 
    address: owner,
    balanceManagers: {
      'my_manager': { address: managerId }
    }
  });

  const tx = new Transaction();
  const expire = Date.now() + 1000 * 60 * 60 * 24 * 7;
  
  deepbook.deepBook.placeLimitOrder({
    poolKey: 'SUI_USDC',
    balanceManagerKey: 'my_manager',
    clientOrderId: '112233',
    price: 0.95,
    quantity: 1,
    isBid: true,
    expiration: expire,
    orderType: 0,
    payWithDeep: false
  })(tx as any);

  tx.setSender(owner);
  const bytes = await tx.build({ client: suiClient as any });
  console.log('Transaction built successfully, dry running...');
  
  const dryRun = await suiClient.dryRunTransactionBlock({ transactionBlock: bytes });
  console.log('Dry Run Status:', dryRun.effects.status.status);
  if (dryRun.effects.status.error) {
    console.log('Dry Run Error:', dryRun.effects.status.error);
  }
}

run().catch(console.error);
