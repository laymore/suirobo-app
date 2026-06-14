/**
 * Upgrade suirobo_factory on mainnet via the TS SDK (local sui CLI is too old
 * for protocol v124). Reads compiled bytecode from build_dump.json and the dev
 * key from ../.env (SUIROBO_DEV_WALLET — never hardcoded/committed).
 *
 * Run:  node upgrade_factory.cjs
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { SuiJsonRpcClient } = require('@mysten/sui/jsonRpc');
const { Transaction, UpgradePolicy } = require('@mysten/sui/transactions');
const { Ed25519Keypair } = require('@mysten/sui/keypairs/ed25519');
const { decodeSuiPrivateKey } = require('@mysten/sui/cryptography');
const { bcs } = require('@mysten/sui/bcs');

const PACKAGE_ID = '0x888f919f64154138f6e21a2341515f68d472be54c45eb9c70e628cfb5458958a';
const UPGRADE_CAP = '0xbaac1822eea4801d91292c96a90169caec4aa5e0204af720aec5ee32fd073bc3';

(async () => {
  const raw = process.env.SUIROBO_DEV_WALLET;
  if (!raw) throw new Error('SUIROBO_DEV_WALLET missing from .env');
  const { secretKey } = decodeSuiPrivateKey(raw.trim());
  const kp = Ed25519Keypair.fromSecretKey(secretKey);
  const addr = kp.toSuiAddress();
  console.log('Signer:', addr);

  const dump = JSON.parse(fs.readFileSync(path.join(__dirname, 'build_dump.json'), 'utf8'));
  const { modules, dependencies, digest } = dump;
  console.log(`Modules: ${modules.length}  Deps: ${dependencies.length}  Digest bytes: ${digest.length}`);

  const client = new SuiJsonRpcClient({ url: 'https://fullnode.mainnet.sui.io', network: 'mainnet' });

  const tx = new Transaction();
  tx.setSender(addr);
  tx.setGasBudget(200_000_000); // 0.2 SUI ceiling

  // authorize → upgrade → commit (standard package-upgrade flow)
  const ticket = tx.moveCall({
    target: '0x2::package::authorize_upgrade',
    arguments: [
      tx.object(UPGRADE_CAP),
      tx.pure.u8(UpgradePolicy.COMPATIBLE),
      tx.pure(bcs.vector(bcs.u8()).serialize(digest)),
    ],
  });
  const receipt = tx.upgrade({
    modules,
    dependencies,
    package: PACKAGE_ID,
    ticket,
  });
  tx.moveCall({
    target: '0x2::package::commit_upgrade',
    arguments: [tx.object(UPGRADE_CAP), receipt],
  });

  console.log('Submitting upgrade…');
  const res = await client.signAndExecuteTransaction({
    signer: kp,
    transaction: tx,
    options: { showObjectChanges: true, showEffects: true },
  });

  console.log('Status:', res.effects?.status?.status);
  if (res.effects?.status?.status !== 'success') {
    console.error('FAILED:', JSON.stringify(res.effects?.status));
    process.exit(1);
  }
  const published = (res.objectChanges || []).find(c => c.type === 'published');
  console.log('Digest:', res.digest);
  console.log('NEW PACKAGE ID:', published?.packageId);
  fs.writeFileSync(path.join(__dirname, 'upgrade_result.json'),
    JSON.stringify({ digest: res.digest, newPackageId: published?.packageId }, null, 2));
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
