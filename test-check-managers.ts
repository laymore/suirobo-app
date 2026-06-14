import 'dotenv/config';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { DeepBookClient } from '@mysten/deepbook-v3';

const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(process.env.SUIROBO_DEV_WALLET!).secretKey);
const addr = kp.toSuiAddress();
const suiClient = new SuiJsonRpcClient({ url: 'https://fullnode.mainnet.sui.io', network: 'mainnet' as any });
const c = new DeepBookClient({ client: suiClient as any, network: 'mainnet', address: addr });

async function main() {
  const ids = await c.getMarginManagerIdsForOwner(addr);
  console.log(`Found ${ids.length} margin managers:`);
  for (const id of ids) {
    try {
      const pool = await c.getMarginManagerDeepbookPool(id);
      console.log(`  ${id} → Pool: ${pool}`);
    } catch (e: any) {
      console.log(`  ${id} → ERROR: ${e.message}`);
    }
  }
}
main().catch(e => console.error('FAIL:', e.message));
