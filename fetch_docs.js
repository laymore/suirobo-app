import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const baseUrl = 'https://raw.githubusercontent.com/MystenLabs/sui/main/docs/content/onchain-finance/deepbook-predict';

const files = [
  '/design.mdx',
  '/contract-information.mdx',
  '/contract-information/predict.mdx',
  '/contract-information/predict-manager.mdx',
  '/contract-information/market-keys.mdx',
  '/contract-information/oracle.mdx',
  '/contract-information/vault.mdx',
  '/contract-information/registry.mdx'
];

async function main() {
  const dir = path.join(process.cwd(), 'scratch_docs');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);

  for (const file of files) {
    const url = baseUrl + file;
    console.log(`Fetching ${url}...`);
    try {
      const res = await fetch(url);
      if (res.ok) {
        const text = await res.text();
        const dest = path.join(dir, file.replace(/\//g, '_'));
        fs.writeFileSync(dest, text);
        console.log(`Saved to ${dest}`);
      } else {
        console.error(`Failed to fetch ${url}: ${res.statusText}`);
      }
    } catch (e) {
      console.error(`Error on ${url}:`, e);
    }
  }
}

main();
