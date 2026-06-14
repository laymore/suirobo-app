import fetch from 'node-fetch';

const TESTNET_RPC = 'https://fullnode.testnet.sui.io';
const ADDRESS = '0x09010f48156a184a1c21b59b62cfa60a80656f07f773def8b8a95d8fdb764f8e';

async function rpc(method: string, params: any[]) {
  const res = await fetch(TESTNET_RPC, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  });
  return res.json();
}

async function main() {
  console.log(`🔍 Checking address ${ADDRESS} on Sui Testnet...`);
  try {
    const balRes = await rpc('suix_getBalance', [ADDRESS, '0x2::sui::SUI']) as any;
    const balance = balRes.result;
    const sui = (parseInt(balance?.totalBalance ?? '0') / 1e9).toFixed(4);
    console.log(`💰 SUI Balance: ${sui} SUI (${balance?.totalBalance ?? 0} mist)`);

    const objRes = await rpc('suix_getOwnedObjects', [ADDRESS, { filter: null, options: { showType: true, showOwner: true } }, null, 50]) as any;
    const objects = objRes?.result?.data ?? [];
    console.log(`📦 Total Owned Objects: ${objects.length}`);
    for (const obj of objects) {
      console.log(`- ID: ${obj.data?.objectId} | Type: ${obj.data?.type}`);
    }
  } catch (err: any) {
    console.error('Error querying Sui Testnet RPC:', err);
  }
}

main();
