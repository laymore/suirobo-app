/**
 * Brand Suirobo Agent .exe với metadata + self-signed certificate
 *
 * Output:
 *  - Properties → Details hiển thị "Team Autobots"
 *  - File icon đẹp (favicon.svg → icon.ico)
 *  - Self-signed cert (optional — chỉ giúp khi user import vào Trusted Root)
 */
const { rcedit } = require('rcedit');
const fs   = require('fs');
const path = require('path');
const cp   = require('child_process');

const EXE = path.join(__dirname, 'dist-agent', 'suirobo-agent.exe');
const ICO = path.join(__dirname, 'dist-agent', 'suirobo.ico');

if (!fs.existsSync(EXE)) {
  console.error('❌ Không thấy exe:', EXE);
  process.exit(1);
}

async function main() {
  console.log('🎨 Branding Suirobo Agent...');
  console.log(`   File: ${EXE}`);
  console.log(`   Size: ${(fs.statSync(EXE).size / 1024 / 1024).toFixed(1)} MB`);

  // ─── 1. Set metadata ─────────────────────────────────────────────────────
  const options = {
    'version-string': {
      ProductName:      'Suirobo Agent',
      CompanyName:      'Team Autobots',
      FileDescription:  'Suirobo — Decentralized AI Trading Agent on Sui',
      LegalCopyright:   '© 2026 Team Autobots. Open Source — MIT License.',
      OriginalFilename: 'suirobo-agent.exe',
      InternalName:     'suirobo-agent',
      Comments:         'Self-custody AI agent for Sui blockchain. https://autobots.wal.app',
    },
    'file-version':    '1.0.1.0',
    'product-version': '1.0.1',
  };

  // Set icon nếu có
  if (fs.existsSync(ICO)) {
    options.icon = ICO;
    console.log('   ✓ Icon: suirobo.ico');
  } else {
    console.log('   ⚠️  Không có icon — bỏ qua (chạy `node make_icon.cjs` trước)');
  }

  try {
    await rcedit(EXE, options);
    console.log('✅ Metadata đã update');
  } catch (e) {
    console.error('❌ rcedit error:', e.message);
    process.exit(1);
  }

  // ─── 2. Verify metadata ─────────────────────────────────────────────────
  console.log('\n📋 Verify metadata:');
  try {
    const ps = `(Get-Item '${EXE.replace(/\\/g, '\\\\')}').VersionInfo | Format-List CompanyName, ProductName, FileDescription, FileVersion`;
    const out = cp.execSync(`powershell -NoProfile -Command "${ps}"`, { encoding: 'utf-8' });
    console.log(out);
  } catch {}

  // ─── 3. Hướng dẫn signing ───────────────────────────────────────────────
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  📜 ĐỂ BYPASS SMARTSCREEN HOÀN TOÀN, CẦN CODE SIGNING');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  3 lựa chọn:');
  console.log();
  console.log('  1. EV Code Signing Certificate ($300-500/năm)');
  console.log('     → Bypass SmartScreen ngay lập tức');
  console.log('     → Hiển thị "Team Autobots" trong popup');
  console.log('     Vendor: DigiCert, Sectigo, GlobalSign');
  console.log();
  console.log('  2. Standard Code Signing ($150-300/năm)');
  console.log('     → SmartScreen vẫn warn lúc đầu');
  console.log('     → Sau khi nhiều user click "Run anyway" → Microsoft tự whitelist');
  console.log('     → Hiển thị "Team Autobots" trong popup');
  console.log();
  console.log('  3. Self-signed (miễn phí)');
  console.log('     → SmartScreen vẫn warn');
  console.log('     → User PHẢI import cert vào Trusted Root → mới hiện "Team Autobots"');
  console.log('     → Chạy `node make_self_signed.cjs` để tạo');
  console.log();
  console.log('  Hiện tại: Properties của file đã hiện "Team Autobots"');
  console.log('  → User click "Chạy dù thế nào" thì sẽ thấy đầy đủ branding sau khi mở');
}

main().catch(e => { console.error(e); process.exit(1); });
