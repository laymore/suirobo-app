const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--ignore-certificate-errors'] });
  const p = await b.newPage();
  const errors = [], consoleErrors = [];
  p.on('pageerror', e => errors.push('PAGE: ' + e.message));
  p.on('requestfailed', r => errors.push(`FAIL [${r.failure().errorText}]: ${r.url().substring(0,80)}`));
  p.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text().substring(0, 250)); });
  await p.goto('https://autobots.wal.app?nc=' + Date.now(), { waitUntil: 'networkidle2', timeout: 45000 });
  await new Promise(r => setTimeout(r, 3000));
  const state = await p.evaluate(() => ({
    root: document.getElementById('root')?.children.length || 0,
    title: document.title,
    bodyText: document.body.innerText.substring(0, 150),
  }));
  console.log('STATE:', JSON.stringify(state));
  console.log('\nERRORS (' + errors.length + '):');
  errors.slice(0, 12).forEach(e => console.log('  ' + e));
  console.log('\nCONSOLE (' + consoleErrors.length + '):');
  consoleErrors.slice(0, 6).forEach(e => console.log('  ' + e));
  await b.close();
})();
