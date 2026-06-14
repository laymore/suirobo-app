import puppeteer from 'puppeteer';

(async () => {
  console.log('Starting browser...');
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.error('BROWSER ERROR:', err));
  
  page.on('workercreated', worker => {
    console.log('WORKER CREATED:', worker.url());
    worker.on('console', msg => console.log('WORKER LOG:', msg.text()));
    worker.on('error', err => console.log('WORKER ERROR:', err));
  });
  page.on('requestfailed', req => console.log('REQUEST FAILED:', req.url(), req.failure()?.errorText));

  try {
    console.log('Navigating to http://localhost:5173...');
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });

    console.log('Clicking Connect AI...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const connectBtn = btns.find(b => b.innerText.includes('Connect AI'));
      if (connectBtn) connectBtn.click();
    });

    await new Promise(r => setTimeout(r, 500));

    console.log('Selecting DeepSeek provider...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const deepBtn = btns.find(b => b.innerText.includes('DeepSeek'));
      if (deepBtn) deepBtn.click();
    });

    console.log('Entering API Key...');
    await page.type('input[type="password"]', (process.env.DEEPSEEK_API_KEY || ''));

    console.log('Clicking Kết nối...');
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const activateBtn = btns.find(b => b.innerText.includes('Kết nối'));
      if (activateBtn) activateBtn.click();
    });

    console.log('Waiting for Agent to be ready...');
    await new Promise(r => setTimeout(r, 2000));

    console.log('Sending message to agent...');
    // Type into the chat input. It's likely a text input or textarea.
    const inputSelector = 'textarea';
    await page.type(inputSelector, 'Mở vị thế Margin USDC thế chấp bằng SUI, tôi muốn tự động thực thi không cần duyệt (quyền tự trị).');
    await page.keyboard.press('Enter');

    console.log('Waiting for response...');
    await new Promise(r => setTimeout(r, 6000));

    // Get the chat history
    const text = await page.evaluate(() => document.body.innerText);
    console.log('--- PAGE TEXT ---');
    console.log(text.substring(0, 1500));
    console.log('-----------------');
    
  } catch (err) {
    console.error('Test error:', err);
  } finally {
    await browser.close();
  }
})();
