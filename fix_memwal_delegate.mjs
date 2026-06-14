// Add a VERIFIED delegate key to the existing MemWal account.
// Derives the public key via the MemWal client (same code path that signs requests),
// so the on-chain key is guaranteed to match what the SDK sends.
import 'dotenv/config';
import { addDelegateKey } from '@mysten-incubation/memwal/account';
import { MemWal } from '@mysten-incubation/memwal';
import { SuiJsonRpcClient as SuiClient, getJsonRpcFullnodeUrl as getFullnodeUrl } from '@mysten/sui/jsonRpc';
import fs from 'fs';

const PACKAGE_ID = '0xcf6ad755a1cdff7217865c796778fabe5aa399cb0cf2eba986f4b582047229c6';
const NETWORK = 'testnet';
const SERVER = 'https://relayer.staging.memwal.ai';
const SUI_KEY = process.env.SUIROBO_DEV_WALLET;
const ACCOUNT_ID = process.env.MEMWAL_ACCOUNT_ID;
const suiClient = new SuiClient({ url: getFullnodeUrl(NETWORK) });

// 1) Generate a fresh 32-byte Ed25519 private key
const privBytes = new Uint8Array(32);
globalThis.crypto.getRandomValues(privBytes);
const privHex = Buffer.from(privBytes).toString('hex');

// 2) Derive the public key the WAY THE CLIENT WILL when signing requests
const mw = MemWal.create({ key: privHex, accountId: ACCOUNT_ID, serverUrl: SERVER });
const pubBytes = await mw.getPublicKey();
const pubHex = Buffer.from(pubBytes).toString('hex');
console.log('delegate privateKey:', privHex);
console.log('delegate publicKey :', pubHex, '(derived via client)');

// 3) Add this exact public key to the existing account
const add = await addDelegateKey({
  packageId: PACKAGE_ID,
  accountId: ACCOUNT_ID,
  publicKey: pubHex,           // pass hex; SDK hexToBytes → same 32 bytes
  label: 'Suirobo Local Agent v2',
  suiPrivateKey: SUI_KEY,
  suiNetwork: NETWORK,
  suiClient,
});
console.log('added on-chain | tx:', add.digest);
console.log('on-chain publicKey:', add.publicKey, '| match:', add.publicKey === pubHex);

// 4) Persist the matching private key
let env = fs.readFileSync('.env', 'utf8');
env = env.replace(/^MEMWAL_PRIVATE_KEY=.*$/m, 'MEMWAL_PRIVATE_KEY=' + privHex);
fs.writeFileSync('.env', env);
const acc = JSON.parse(fs.readFileSync('.memwal_account.json', 'utf8'));
acc.delegatePrivateKey = privHex;
acc.delegatePublicKey = pubHex;
fs.writeFileSync('.memwal_account.json', JSON.stringify(acc, null, 2));
console.log('Saved matching private key to .env + .memwal_account.json');
