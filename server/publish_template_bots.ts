/**
 * Publish the 3 research bots to the on-chain marketplace as FREE templates.
 * Each bot's full BotSkillConfig is uploaded to Walrus (real, forkable artifact)
 * and registered via 0xb54499…::suirobo_factory::publish_skill at price 0.
 * Signs with the dev wallet (the bots' author). CLI is too old → SDK path.
 *
 * Run: npx tsx server/publish_template_bots.ts
 */
import 'dotenv/config';
import fs from 'fs';
import os from 'os';
import path from 'path';
import cp from 'child_process';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { PRESET_SKILLS } from '../src/types/botSkill.js';

// The package the marketplace UI actually queries/buys from (mainnet).
const MARKET_PKG = '0xb54499501253333c25eadc6fe17def9cb6cfb5af81f265e9f9b0536ec92813bc';
const WALRUS_BIN = path.join(os.homedir(), '.walgo', 'bin', process.platform === 'win32' ? 'walrus.exe' : 'walrus');
const EPOCHS = 50;

const NAMES = ['sui_supertrend_m5_v2', 'btc_breakout_m15', 'sui_mtf_supertrend_m5'];

function walrusStore(file: string): string {
  const out = cp.execSync(`"${WALRUS_BIN}" store "${file}" --epochs ${EPOCHS}`, { encoding: 'utf-8', stdio: ['inherit', 'pipe', 'inherit'] });
  const m = out.match(/Blob ID:\s*([A-Za-z0-9_-]+)/);
  if (!m) throw new Error('could not parse Walrus blob id from output');
  return m[1];
}

(async () => {
  const raw = process.env.SUIROBO_DEV_WALLET;
  if (!raw) throw new Error('SUIROBO_DEV_WALLET missing from .env');
  const kp = Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(raw.trim()).secretKey);
  const addr = kp.toSuiAddress();
  console.log('Publisher (author):', addr);

  const bots = NAMES.map(n => {
    const s = PRESET_SKILLS.find(p => p.name === n);
    if (!s) throw new Error(`preset ${n} not found`);
    return s;
  });

  // 1. Upload each config JSON to Walrus → real forkable artifact
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'suirobo-tpl-'));
  const blobs: Record<string, string> = {};
  for (const b of bots) {
    const f = path.join(tmp, `${b.name}.json`);
    fs.writeFileSync(f, JSON.stringify(b, null, 2));
    process.stdout.write(`Uploading ${b.name} config to Walrus… `);
    blobs[b.name] = walrusStore(f);
    console.log(blobs[b.name]);
  }

  // 2. One PTB: publish all 3 at price 0
  const client = new SuiJsonRpcClient({ url: 'https://fullnode.mainnet.sui.io', network: 'mainnet' });
  const tx = new Transaction();
  tx.setSender(addr);
  tx.setGasBudget(200_000_000);
  for (const b of bots) {
    tx.moveCall({
      target: `${MARKET_PKG}::suirobo_factory::publish_skill`,
      arguments: [
        tx.pure.string(b.name),
        tx.pure.string(b.description),
        tx.pure.string(blobs[b.name]),
        tx.pure.string(b.version),
        tx.pure.u64(0),              // FREE
      ],
    });
  }

  console.log('\nSubmitting publish_skill ×3 (price 0)…');
  const res = await client.signAndExecuteTransaction({
    signer: kp, transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
  });
  console.log('Status:', res.effects?.status?.status);
  if (res.effects?.status?.status !== 'success') {
    console.error('FAILED:', JSON.stringify(res.effects?.status)); process.exit(1);
  }
  const created = (res.objectChanges || []).filter((c: any) => c.type === 'created' && c.objectType?.includes('::Skill'));
  console.log('Digest:', res.digest);
  console.log('Skill objects created:', created.length);
  for (const c of created as any[]) console.log('  ', c.objectId);
  fs.writeFileSync(path.join(process.cwd(), 'server', 'data', 'template_bots_published.json'),
    JSON.stringify({ digest: res.digest, blobs, skills: created.map((c: any) => c.objectId) }, null, 2));
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
