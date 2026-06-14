const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  
  const errors = [], requests = [];
  p.on('pageerror', e => errors.push('PAGE: ' + e.message));
  p.on('requestfailed', r => errors.push(`FAIL: ${r.url().substring(0,60)} - ${r.failure().errorText}`));
  p.on('response', r => {
    if (r.url().includes('localhost')) {
      requests.push(`[${r.status()}] ${r.method?.()||'?'} ${r.url()}`);
    }
  });
  
  // Load page autobots.wal.app
  await p.goto('https://autobots.wal.app', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));
  
  // Eval fetch /health từ context HTTPS
  const result = await p.evaluate(async () => {
    try {
      const r = await fetch('http://localhost:3001/health');
      return { ok: r.ok, status: r.status, text: await r.text() };
    } catch (e) { return { error: e.message, name: e.name }; }
  });
  
  console.log('=== FETCH RESULT từ https://autobots.wal.app ===');
  console.log(JSON.stringify(result, null, 2));
  console.log();
  console.log('=== REQUESTS TO LOCALHOST ===');
  requests.forEach(r => console.log(r));
  console.log();
  console.log('=== ERRORS ===');
  errors.forEach(e => console.log(e));
  
  await b.close();
})();
