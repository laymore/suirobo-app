import { execSync } from 'child_process';
import * as fs from 'fs';

async function main() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log(' 🚀 AUTO DEPLOY TO WALRUS & LINK SuiNS');
  console.log('═══════════════════════════════════════════════════════════');
  
  try {
    console.log('\n[1/4] 📦 Building React App...');
    execSync('npm run build', { stdio: 'inherit' });

    console.log('\n[2/4] 🌐 Publishing to Walrus Sites (50 epochs)...');
    console.log('Vui lòng đợi 1-2 phút, hệ thống đang upload file lên Walrus...');
    
    // Run site-builder and capture its output
    const output = execSync('site-builder publish dist --epochs 50').toString();
    console.log(output);

    // Extract the new Site Object ID using Regex
    const match = output.match(/New site object ID: (0x[a-f0-9]+)/);
    if (!match) {
      throw new Error('Không tìm thấy "New site object ID" trong kết quả trả về của site-builder.');
    }
    const newSiteId = match[1];
    console.log(`✅ Đã bắt được Site ID mới: ${newSiteId}`);

    console.log('\n[3/4] 📝 Cập nhật script link-suins-walrus.ts...');
    const linkScriptPath = 'link-suins-walrus.ts';
    let linkScript = fs.readFileSync(linkScriptPath, 'utf8');
    linkScript = linkScript.replace(
      /const WALRUS_SITE_ID = '0x[a-f0-9]+';/,
      `const WALRUS_SITE_ID = '${newSiteId}';`
    );
    fs.writeFileSync(linkScriptPath, linkScript);
    console.log('✅ Đã cập nhật xong file link-suins-walrus.ts.');

    console.log('\n[4/4] 🔗 Đang liên kết Domain autobots.sui với Site ID mới...');
    execSync('npx tsx link-suins-walrus.ts', { stdio: 'inherit' });
    
    console.log('\n🎉 HOÀN TẤT TẤT CẢ QUY TRÌNH!');
  } catch (err: any) {
    console.error('\n❌ LỖI TRONG QUÁ TRÌNH DEPLOY:', err.message);
    process.exit(1);
  }
}

main();
