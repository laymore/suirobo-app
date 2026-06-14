/**
 * Upload Suirobo Agent .exe lên Walrus + cập nhật manifest
 *
 * Sử dụng:
 *   node publish_agent.cjs
 *
 * Output:
 *   dist-agent/manifest.json (đã có Blob ID)
 *   public/agent-manifest.json (copy cho web app fetch)
 */
const cp   = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const ROOT     = process.cwd();
const DIST_DIR = path.join(ROOT, 'dist-agent');
const EXE      = path.join(DIST_DIR, 'suirobo-agent.exe');
const MANIFEST = path.join(DIST_DIR, 'manifest.json');

if (!fs.existsSync(EXE)) {
  console.error('❌ Không thấy', EXE);
  console.error('Chạy `node build_agent.cjs` trước.');
  process.exit(1);
}

// Dùng walrus CLI từ Walgo (đã verify hoạt động)
const WALRUS_BIN = path.join(os.homedir(), '.walgo', 'bin',
  process.platform === 'win32' ? 'walrus.exe' : 'walrus');

if (!fs.existsSync(WALRUS_BIN)) {
  console.error('❌ Walrus CLI không tồn tại tại:', WALRUS_BIN);
  console.error('Cài Walgo trước hoặc cài walrus CLI thủ công.');
  process.exit(1);
}

const EPOCHS = parseInt(process.argv[2] || '50'); // ~50 ngày (max allowed 53)

console.log(`📤 Uploading ${(fs.statSync(EXE).size / 1024 / 1024).toFixed(1)} MB to Walrus...`);
console.log(`   Epochs: ${EPOCHS} (~${EPOCHS} ngày)`);
console.log(`   Bin:    ${WALRUS_BIN}`);
console.log();

const startTime = Date.now();
let output = '';

try {
  output = cp.execSync(
    `"${WALRUS_BIN}" store "${EXE}" --epochs ${EPOCHS} --json`,
    { encoding: 'utf-8', stdio: ['inherit', 'pipe', 'inherit'] }
  );
} catch (e) {
  // Walrus có khi in JSON ra stderr; thử dùng human-readable output
  console.log('JSON mode failed, retrying with human output...');
  try {
    output = cp.execSync(
      `"${WALRUS_BIN}" store "${EXE}" --epochs ${EPOCHS}`,
      { encoding: 'utf-8', stdio: ['inherit', 'pipe', 'inherit'] }
    );
  } catch (e2) {
    console.error('❌ Walrus upload failed:', e2.message);
    process.exit(1);
  }
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`✅ Upload xong sau ${elapsed}s`);
console.log();

// Parse blob ID từ output
let blobId = '';
const m1 = output.match(/Blob ID:\s*([A-Za-z0-9_-]+)/);
const m2 = output.match(/"blobId":\s*"([A-Za-z0-9_-]+)"/);
blobId = (m1 && m1[1]) || (m2 && m2[1]) || '';

if (!blobId) {
  console.error('❌ Không parse được Blob ID từ output:');
  console.error(output.slice(-500));
  process.exit(1);
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  📦 SUIROBO AGENT — PUBLISHED ON WALRUS');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Blob ID:  ${blobId}`);
console.log(`  Read URL: https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${blobId}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

// Cập nhật manifest
const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf-8'));
manifest.blob_id = blobId;
manifest.download_url = `https://aggregator.walrus-mainnet.walrus.space/v1/blobs/${blobId}`;
manifest.published_at = new Date().toISOString();
manifest.epochs = EPOCHS;
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

// Copy manifest sang public/ để web app fetch
const publicManifest = path.join(ROOT, 'public', 'agent-manifest.json');
fs.writeFileSync(publicManifest, JSON.stringify(manifest, null, 2));

// ── Tự động prepend vào agent-history.json (track all versions) ─────────────
const historyFile = path.join(ROOT, 'public', 'agent-history.json');
let history = [];
try {
  if (fs.existsSync(historyFile)) {
    history = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
    if (!Array.isArray(history)) history = [];
  }
} catch { history = []; }

// Tránh duplicate version (replace nếu trùng)
history = history.filter(v => v.version !== manifest.version);
history.unshift({ ...manifest });

// Sort theo published_at desc, keep latest 20
history.sort((a, b) =>
  new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime()
);
history = history.slice(0, 20);

fs.writeFileSync(historyFile, JSON.stringify(history, null, 2));
console.log(`✅ History updated: ${history.length} versions in ${historyFile}`);

console.log();
console.log('✅ Manifest updated:');
console.log('   -', MANIFEST);
console.log('   -', publicManifest);
console.log();
console.log('User có thể download từ:');
console.log('  https://aggregator.walrus-mainnet.walrus.space/v1/blobs/' + blobId);
