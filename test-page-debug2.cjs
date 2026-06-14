const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  const requests = [];
  page.on('response', async r => {
    if (r.url().includes('autobots') || r.url().includes('walrus') || r.url().includes('aggregator')) {
      requests.push({
        url: r.url().substring(0, 100),
        status: r.status(),
        type: r.headers()['content-type'] || '?',
        size: r.headers()['content-length'] || '?',
      });
    }
  });
  
  await page.goto('https://autobots.wal.app', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2000));
  
  console.log('=== REQUESTS (' + requests.length + ') ===');
  requests.forEach(r => console.log(`[${r.status}] ${r.url} (${r.size}b)`));
  
  await browser.close();
})();
