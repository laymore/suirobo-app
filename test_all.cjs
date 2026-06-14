const fetch = require('node-fetch');
const API = 'http://localhost:3001';

let passed = 0, failed = 0;

async function test(name, text) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`📋 TEST: ${name}`);
  console.log(`💬 Lệnh: "${text}"`);
  console.log('─'.repeat(70));
  
  try {
    const res = await fetch(`${API}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, sessionId: `test_${Date.now()}_${Math.random()}` })
    });
    const data = await res.json();
    
    if (!data.success) {
      console.log(`❌ FAILED: ${data.message}`);
      failed++;
      return null;
    }

    // Truncate long responses
    const respText = (data.text || '').substring(0, 600);
    console.log(`🤖 Response: ${respText}${data.text?.length > 600 ? '...' : ''}`);
    
    if (data.pendingTx) {
      console.log(`🔐 Pending TX: ${JSON.stringify(data.pendingTx).substring(0, 300)}...`);
    }
    
    console.log(`✅ PASSED`);
    passed++;
    return data;
  } catch (e) {
    console.log(`❌ ERROR: ${e.message}`);
    failed++;
    return null;
  }
}

async function run() {
  console.log('🚀 SUIROBO DeepTrade Agent — Full Test Suite');
  console.log('═'.repeat(70));

  // Init DeepSeek
  const initRes = await fetch(`${API}/api/init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'deepseek', apiKey: (process.env.DEEPSEEK_API_KEY || '') })
  });
  const initData = await initRes.json();
  console.log(`✅ Init: ${initData.message}\n`);

  // ═══════════ MARGIN TESTS (Testnet) ═══════════
  console.log('\n🏦 ══════════ MARGIN TESTS (Testnet) ══════════');

  await test('MARGIN-1: Mở vị thế Margin (Autonomous)',
    'Mở vị thế Margin pool SUI_USDC: vay 100 USDC, thế chấp 50 SUI. Tự động thực thi quyền tự trị.');

  await test('MARGIN-2: Mở vị thế Margin (Require Approval)',
    'Mở vị thế Margin pool SUI_USDC: vay 200 USDC, thế chấp 80 SUI. Chuẩn bị lệnh cho tôi duyệt.');

  await test('MARGIN-3: Đóng vị thế Margin (Autonomous)',
    'Đóng vị thế Margin pool SUI_USDC, trả nợ 100 USDC. Tự động thực thi.');

  await test('MARGIN-4: Đóng vị thế Margin (Require Approval)',
    'Đóng vị thế Margin pool SUI_USDC, trả nợ 50 USDC. Gửi lệnh để tôi ký duyệt.');

  await test('MARGIN-5: Kiểm tra Margin Health',
    'Kiểm tra sức khỏe Margin của ví 0x0000000000000000000000000000000000000000000000000000000000000001');

  await test('MARGIN-6: Tính giá thanh lý',
    'Tính giá thanh lý nếu tôi thế chấp 100 SUI và vay 200 USDC.');

  await test('MARGIN-7: Lãi suất vay',
    'Lãi suất vay hiện tại của pool SUI_USDC Margin là bao nhiêu?');

  // ═══════════ PREDICT TESTS (Testnet) ═══════════
  console.log('\n🎯 ══════════ PREDICT TESTS (Testnet) ══════════');

  await test('PREDICT-1: Mở Binary UP (Autonomous)',
    'Mở lệnh Binary SUI hướng UP, strike $4.0, expiry 2026-06-01T00:00:00Z, đặt 50 USDC. Tự động thực thi.');

  await test('PREDICT-2: Mở Binary DOWN (Require Approval)',
    'Mở lệnh Binary SUI hướng DOWN, strike $3.0, expiry 2026-06-01T00:00:00Z, đặt 100 USDC. Chuẩn bị cho tôi duyệt.');

  await test('PREDICT-3: Supply Vault (Autonomous)',
    'Cung cấp 500 USDC vào Predict Vault. Tự động thực thi.');

  await test('PREDICT-4: Withdraw Vault (Require Approval)',
    'Rút 200 PLP từ Predict Vault. Gửi lệnh cho tôi duyệt.');

  await test('PREDICT-5: Giá Oracle',
    'Giá Oracle SUI hiện tại là bao nhiêu?');

  await test('PREDICT-6: Vault Stats',
    'Thống kê Predict Vault hiện tại?');

  await test('PREDICT-7: Tính Payout',
    'Tính payout nếu tôi đặt 100 USDC Binary SUI UP strike $4.0.');

  // ═══════════ SPOT TESTS (Mainnet) ═══════════
  console.log('\n💱 ══════════ SPOT TESTS (Mainnet) ══════════');

  await test('SPOT-1: Pool Info',
    'Thông tin pool SUI/USDC trên DeepBook V3?');

  await test('SPOT-2: Swap Quote',
    'Quote swap 10 SUI sang USDC, slippage 0.5%.');

  await test('SPOT-3: Deposit BalanceManager',
    'Nạp 100 SUI vào BalanceManager DeepBook. Tự động thực thi.');

  await test('SPOT-4: Withdraw BalanceManager',
    'Rút 50 USDC từ BalanceManager. Chuẩn bị lệnh cho tôi duyệt.');

  // ═══════════ SUMMARY ═══════════
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`📊 KẾT QUẢ: ${passed} PASSED / ${failed} FAILED / ${passed + failed} TOTAL`);
  console.log('═'.repeat(70));
}

run().catch(console.error);
