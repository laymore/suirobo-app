/**
 * Build Suirobo Agent với Node SEA (Single Executable Application)
 *
 * SEA là cách Node.js 20+ chính thức hỗ trợ build single .exe.
 * Khác pkg: SEA copy node.exe nguyên, chỉ inject bundle vào RCDATA section.
 * → rcedit, signtool đều hoạt động bình thường (vì exe vẫn là PE chuẩn).
 *
 * Output: dist-agent/suirobo-agent.exe
 */
const cp   = require('child_process');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const ROOT      = __dirname;
const DIST      = path.join(ROOT, 'dist-agent');
const BUNDLE    = path.join(DIST, 'agent-bundle.cjs');
const SEA_CONFIG= path.join(DIST, 'sea-config.json');
const SEA_BLOB  = path.join(DIST, 'agent-sea.blob');
const EXE       = path.join(DIST, 'suirobo-agent.exe');
const NODE_BIN  = process.execPath;

if (!fs.existsSync(BUNDLE)) {
  console.error('❌ Không thấy bundle:', BUNDLE);
  console.error('Chạy esbuild trước!');
  process.exit(1);
}

console.log('🔨 Building Suirobo Agent với Node SEA');
console.log(`   Node binary: ${NODE_BIN}`);
console.log(`   Bundle:      ${BUNDLE} (${(fs.statSync(BUNDLE).size / 1024 / 1024).toFixed(1)} MB)`);

// ─── 1. Tạo sea-config.json ──────────────────────────────────────────────
const config = {
  main: BUNDLE.replace(/\\/g, '/'),
  output: SEA_BLOB.replace(/\\/g, '/'),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
};
fs.writeFileSync(SEA_CONFIG, JSON.stringify(config, null, 2));
console.log('✓ sea-config.json');

// ─── 2. Build SEA blob ────────────────────────────────────────────────────
console.log('\n📦 Step 1: node --experimental-sea-config...');
try {
  cp.execSync(`node --experimental-sea-config "${SEA_CONFIG}"`, { stdio: 'inherit' });
  console.log(`   ✓ Blob: ${SEA_BLOB} (${(fs.statSync(SEA_BLOB).size / 1024 / 1024).toFixed(1)} MB)`);
} catch (e) {
  console.error('❌ SEA blob build failed:', e.message);
  process.exit(1);
}

// ─── 3. Copy node.exe → suirobo-agent.exe ─────────────────────────────────
console.log('\n📋 Step 2: Copy node.exe → suirobo-agent.exe...');
fs.copyFileSync(NODE_BIN, EXE);
console.log(`   ✓ ${EXE} (${(fs.statSync(EXE).size / 1024 / 1024).toFixed(1)} MB)`);

// ─── 4. Inject SEA blob bằng postject ─────────────────────────────────────
console.log('\n💉 Step 3: Inject blob với postject...');
try {
  cp.execSync(
    `npx postject "${EXE}" NODE_SEA_BLOB "${SEA_BLOB}" --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`,
    { stdio: 'inherit' }
  );
  console.log(`   ✓ Injected. Final size: ${(fs.statSync(EXE).size / 1024 / 1024).toFixed(1)} MB`);
} catch (e) {
  console.error('❌ postject failed:', e.message);
  process.exit(1);
}

// ─── 5. Set metadata với rcedit ───────────────────────────────────────────
console.log('\n🎨 Step 4: Set metadata Team Autobots...');
try {
  cp.execSync(`node "${path.join(ROOT, 'brand_agent.cjs')}"`, { stdio: 'inherit' });
} catch (e) {
  console.error('⚠️  rcedit warning:', e.message);
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log('  ✅ BUILD COMPLETE');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  EXE:  ${EXE}`);
console.log(`  Size: ${(fs.statSync(EXE).size / 1024 / 1024).toFixed(1)} MB`);
console.log();
console.log('Next: chạy `powershell -ExecutionPolicy Bypass -File sign_agent.ps1` để sign');
