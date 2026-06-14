import { SuiClient } from '@mysten/sui/client';
import { DeepBookClient } from '@mysten/deepbook-v3';
import { Transaction } from '@mysten/sui/transactions';

const client = new SuiClient({url: 'https://fullnode.mainnet.sui.io'});
const dbClient = new DeepBookClient({client, network: 'mainnet'});
const tx = new Transaction();

dbClient.marginRegistry.poolEnabled('SUI_USDC')(tx);

client.devInspectTransactionBlock({
  sender: '0xafbc48fd349fb44ce9c6f2b33423e6ae7c826d53a25920a0d4c3c475e40889c5',
  transactionBlock: tx
}).then(res => console.dir(res, {depth: null})).catch(console.error);
