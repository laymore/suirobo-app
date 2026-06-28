/**
 * Build Suirobo Agent → Single .exe distributable
 *
 * Output: dist-agent/suirobo-agent.exe (~61 MB)
 *
 * Steps:
 *  1. Đọc version từ argv hoặc package.json
 *  2. esbuild bundle agent_bootstrap.ts → CJS (inject version)
 *  3. @yao-pkg/pkg → wrap into single .exe with Node 22 runtime
 *  4. Generate SHA-256 + manifest
 */
const cp     = require('child_process');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const ROOT     = process.cwd();
const DIST_DIR = path.join(ROOT, 'dist-agent');
const BUNDLE   = path.join(DIST_DIR, 'agent-bundle.cjs');
const EXE      = path.join(DIST_DIR, 'suirobo-agent.exe');

// Version: argv[2] > package.json > 1.0.0
const PKG_VERSION = require('./package.json').version || '1.0.0';
const VERSION = process.argv[2] || PKG_VERSION;

console.log(`📦 Building Suirobo Agent v${VERSION}`);

if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });

// ─── 1. esbuild bundle (inject version) ───────────────────────────────────
console.log('⚙️  Step 1/3: Bundling with esbuild...');
const externalLibs = [
  'libsql', 'better-sqlite3', 'mysql', 'mysql2',
  'oracledb', 'pg', 'pg-query-stream', 'sqlite3', 'tedious',
].map(l => `--external:${l}`).join(' ');

// Windows cmd: escape " bằng \" và outer wrap với "..."
// Esbuild --define: NAME=VALUE (VALUE phải là JSON-encodable)
const cmd = `npx esbuild server/agent_bootstrap.ts --bundle --platform=node --format=cjs ${externalLibs} ` +
  `--define:import.meta.url=\\"file:///C:/agent.cjs\\" ` +
  `--define:BUILD_VERSION=\\"${VERSION}\\" ` +
  `--outfile=${BUNDLE.replace(/\\/g, '/')}`;
cp.execSync(cmd, { stdio: 'inherit', shell: 'cmd.exe' });
console.log(`   ✓ Bundle: ${(fs.statSync(BUNDLE).size / 1024 / 1024).toFixed(1)} MB`);

// ─── 2. Pkg → .exe ───────────────────────────────────────────────────────
console.log('⚙️  Step 2/3: Packaging into .exe with @yao-pkg/pkg (node22)...');
try {
  cp.execSync(
    `npx @yao-pkg/pkg ${BUNDLE} --target node22-win-x64 --output ${EXE} --compress GZip`,
    { stdio: 'inherit' }
  );
  console.log(`   ✓ EXE: ${(fs.statSync(EXE).size / 1024 / 1024).toFixed(1)} MB`);
} catch (e) {
  console.error('pkg failed:', e.message);
  process.exit(1);
}

// ─── 3. SHA-256 + manifest ────────────────────────────────────────────────
console.log('⚙️  Step 3/3: Generating manifest...');
const exeBuf = fs.readFileSync(EXE);
const sha256 = crypto.createHash('sha256').update(exeBuf).digest('hex');

const manifest = {
  name: 'Autobots',
  publisher: 'Team Autobots',
  version: VERSION,
  built_at: new Date().toISOString(),
  size_bytes: exeBuf.length,
  size_mb: +(exeBuf.length / 1024 / 1024).toFixed(2),
  sha256,
  platform: 'win-x64',
  node_version: 'node22',
};

fs.writeFileSync(path.join(DIST_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log();
console.log('═══════════════════════════════════════════════════════════');
console.log('  ✅ BUILD COMPLETE');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  Version:   ${VERSION}`);
console.log(`  Output:    ${EXE}`);
console.log(`  Size:      ${manifest.size_mb} MB`);
console.log(`  SHA-256:   ${sha256.slice(0, 32)}...`);
console.log();
console.log('Next: `node publish_agent.cjs <epochs>` để upload Walrus');
