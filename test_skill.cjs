const http = require('http');

async function test() {
  console.log('1. Khởi động Agent tĩnh (chưa có Skill VIP)...');
  const agentProcess = require('child_process').spawn('node', ['dist-server/agent.cjs'], { stdio: 'inherit' });
  await new Promise(r => setTimeout(r, 4000));

  console.log('\n2. Hỏi Agent cắt lỗ Margin...');
  let res = await fetch('http://localhost:3001/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: 'Hãy thiết lập Cắt lỗ và Chốt lời cho vị thế Margin của tôi (ID: pos123, rủi ro: low).',
      sessionId: 'test_session',
      provider: 'gemini',
      apiKey: process.env.GEMINI_API_KEY || 'fake_key'
    })
  });
  let data = await res.json();
  console.log('Agent trả lời:', data.response);

  console.log('\n3. Nạp động (Inject) SKILL.md từ Walrus Store...');
  const fs = require('fs');
  const enc = fs.readFileSync('public/premium_auto_sl_tp.enc', 'utf8');
  const payload = Buffer.from(enc, 'base64').toString('utf8');
  await fetch('http://localhost:3001/api/skills/load', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: payload, password: 'walrus_seal_xyz' })
  });
  await new Promise(r => setTimeout(r, 2000));

  console.log('\n4. Hỏi lại Agent...');
  res = await fetch('http://localhost:3001/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: 'Bây giờ hãy thiết lập Cắt lỗ và Chốt lời cho vị thế Margin của tôi (ID: pos123, rủi ro: low).',
      sessionId: 'test_session_2',
      provider: 'gemini',
      apiKey: process.env.GEMINI_API_KEY || 'fake_key'
    })
  });
  data = await res.json();
  console.log('Agent trả lời:', data.response);
  console.log('Giao dịch PTB:', data.pendingTx);
  
  agentProcess.kill();
}
test().catch(console.error);
