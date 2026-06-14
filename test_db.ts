import { SuiClient } from '@mysten/sui/client';
import { deepbook } from '@mysten/deepbook-v3';

async function main() {
  const client = new SuiClient({ url: 'https://fullnode.mainnet.sui.io:443' });
  (client as any).network = 'mainnet';
  
  const dbConfig = deepbook({ address: '0x0000000000000000000000000000000000000000000000000000000000000000' });
  const db = (client as any).$extend?.(dbConfig);
  
  console.log("Keys of db:", Object.keys(db));
  if (db.deepBook) {
    console.log("Keys of db.deepBook:", Object.keys(db.deepBook));
  }
}

main().catch(console.error);
