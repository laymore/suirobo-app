const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--ignore-certificate-errors'] });
  const p = await b.newPage();
  await p.goto('https://autobots.wal.app', { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));
  const r = await p.evaluate(async () => {
    try {
      const res = await fetch('https://localhost:3002/health');
      return { ok: res.ok, status: res.status, body: await res.text() };
    } catch (e) { return { error: e.message }; }
  });
  console.log('Result:', JSON.stringify(r));
  await b.close();
})();
