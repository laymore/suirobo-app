import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';

const client = new SuiClient({ url: getFullnodeUrl('testnet') });

async function checkPredictModule() {
  try {
    const res = await client.getNormalizedMoveModulesByPackage({
      package: '0xdee9',
    });
    console.log("Modules in 0xdee9:", Object.keys(res));
    if (res['predict']) {
      console.log("predict module exists!");
    } else {
      console.log("predict module DOES NOT exist on 0xdee9 testnet.");
    }
  } catch (e) {
    console.error(e);
  }
}

checkPredictModule();
