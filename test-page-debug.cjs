const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  const errors = [];
  const consoleMsgs = [];
  
  page.on('pageerror', e => errors.push('PAGE ERROR: ' + e.message));
  page.on('error', e => errors.push('ERROR: ' + e.message));
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      consoleMsgs.push(`[${msg.type()}] ${msg.text()}`);
    }
  });
  page.on('requestfailed', req => {
    errors.push(`REQ FAIL: ${req.url()} - ${req.failure().errorText}`);
  });
  
  try {
    await page.goto('https://autobots.wal.app', { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Đợi React render
    await new Promise(r => setTimeout(r, 3000));
    
    // Check DOM
    const rootHtml = await page.evaluate(() => {
      const root = document.getElementById('root');
      return {
        rootExists: !!root,
        rootChildren: root ? root.children.length : 0,
        rootInner: root ? root.innerHTML.substring(0, 300) : 'null',
        bodyText: document.body.innerText.substring(0, 200),
      };
    });
    
    console.log('=== DOM STATE ===');
    console.log(JSON.stringify(rootHtml, null, 2));
    console.log('\n=== ERRORS (' + errors.length + ') ===');
    errors.slice(0, 10).forEach(e => console.log(e));
    console.log('\n=== CONSOLE WARNINGS/ERRORS (' + consoleMsgs.length + ') ===');
    consoleMsgs.slice(0, 15).forEach(m => console.log(m));
  } catch (e) {
    console.log('NAVIGATION ERROR:', e.message);
  }
  await browser.close();
})();
