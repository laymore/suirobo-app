const puppeteer = require('puppeteer');
(async () => {
  const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  await p.goto('https://autobots.wal.app', { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 3000));
  
  const state = await p.evaluate(() => {
    const root = document.getElementById('root');
    const text = document.body.innerText;
    return {
      rootChildren: root.children.length,
      hasReact: !!root.querySelector('div'),
      title: document.title,
      bodyTextSample: text.substring(0, 500),
      visibleHeadings: Array.from(document.querySelectorAll('h1,h2,h3,h4')).map(h => h.innerText).slice(0, 5),
    };
  });
  console.log(JSON.stringify(state, null, 2));
  await b.close();
})();
