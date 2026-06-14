const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--ignore-certificate-errors'],
  });
  const p = await b.newPage();
  
  // Listen errors
  const errors = [], consoleErrors = [];
  p.on('pageerror', e => errors.push('PAGE: ' + e.message));
  p.on('requestfailed', r => errors.push(`FAIL: ${r.url().substring(0,70)} - ${r.failure().errorText}`));
  p.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().substring(0,150)); });
  
  console.log('▶ Loading https://autobots.wal.app ...');
  await p.goto('https://autobots.wal.app?nc=' + Date.now(), { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));
  
  // Check render
  const ui = await p.evaluate(() => ({
    root: document.getElementById('root')?.children.length || 0,
    title: document.title,
    htmlLang: document.documentElement.lang,
    headings: Array.from(document.querySelectorAll('h1,h2,h3')).slice(0,5).map(h => h.innerText.substring(0,50)),
    menuItems: Array.from(document.querySelectorAll('button')).slice(0,15).map(b => b.innerText.trim()).filter(t => t.length > 0 && t.length < 40),
    hasAgentManifest: !!document.querySelector('[data-manifest]') || performance.getEntriesByName('/agent-manifest.json').length > 0,
  }));
  
  console.log('\n=== UI STATE ===');
  console.log('Root children:', ui.root, ui.root > 0 ? '✅ React rendered' : '❌ Empty');
  console.log('Title:', ui.title);
  console.log('HTML lang:', ui.htmlLang);
  console.log('\nHeadings detected:');
  ui.headings.forEach(h => console.log('  •', h));
  console.log('\nVisible buttons (sample):');
  ui.menuItems.slice(0, 12).forEach(b => console.log('  •', b));
  
  // Test fetch agent from page context
  const agentTest = await p.evaluate(async () => {
    try {
      const r = await fetch('https://localhost:3002/health');
      return { ok: r.ok, status: r.status, body: await r.text() };
    } catch (e) { return { error: e.message }; }
  });
  console.log('\n=== Agent fetch from HTTPS context ===');
  console.log(JSON.stringify(agentTest));
  
  // Test agent manifest loaded
  const manifestTest = await p.evaluate(async () => {
    const r = await fetch('/agent-manifest.json');
    return { status: r.status, version: (await r.json()).version };
  });
  console.log('\n=== Agent manifest ===');
  console.log(JSON.stringify(manifestTest));
  
  console.log('\n=== ERRORS (' + errors.length + ') ===');
  errors.slice(0, 5).forEach(e => console.log('  ', e));
  console.log('\n=== CONSOLE ERRORS (' + consoleErrors.length + ') ===');
  consoleErrors.slice(0, 5).forEach(e => console.log('  ', e));
  
  await b.close();
})();
