/**
 * Fetch historical OHLCV data from Binance API
 * Assets: BTCUSDT + SUIUSDT  |  Period: Jan 1 2025 → Jul 1 2025
 * Timeframes: D1 H4 H1 M30 M15 M5
 * Output: public/data/{asset}_2025_{TF}.json
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dir, '..', 'public', 'data');
mkdirSync(OUT_DIR, { recursive: true });

// Jan 1 2025 00:00 UTC  →  Jul 1 2025 00:00 UTC
const START = 1735689600000;
const END   = 1751328000000;

const TF_MAP = {
  D1: '1d',
  H4: '4h',
  H1: '1h',
  M30: '30m',
  M15: '15m',
  M5:  '5m',
};

function pad(n) { return String(n).padStart(2, '0'); }

function tsToDate(ts, interval) {
  const d = new Date(ts);
  const base = `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`;
  if (interval === '1d') return base;
  return `${base} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

async function fetchKlines(symbol, interval) {
  const candles = [];
  let from = START;
  let batchCount = 0;

  while (from < END) {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${from}&endTime=${END}&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 120)}`);
    }
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;

    for (const k of data) {
      const ts = k[0];
      if (ts >= END) break;
      candles.push({
        date:   tsToDate(ts, interval),
        open:   +parseFloat(k[1]).toFixed(6),
        high:   +parseFloat(k[2]).toFixed(6),
        low:    +parseFloat(k[3]).toFixed(6),
        close:  +parseFloat(k[4]).toFixed(6),
        volume: +parseFloat(k[5]).toFixed(5),
      });
    }

    from = data[data.length - 1][6] + 1; // closeTime + 1ms
    batchCount++;

    if (data.length < 1000) break;
    await new Promise(r => setTimeout(r, 150)); // respect rate limits
  }

  process.stdout.write(` (${batchCount} batches, ${candles.length} candles)`);
  return candles;
}

const ASSETS = [
  { symbol: 'SUIUSDT', prefix: 'sui' },
  { symbol: 'BTCUSDT', prefix: 'btc_jan_jun' },
];

let totalFiles = 0;
for (const { symbol, prefix } of ASSETS) {
  for (const [tf, interval] of Object.entries(TF_MAP)) {
    process.stdout.write(`Fetching ${symbol} ${tf}...`);
    try {
      const candles = await fetchKlines(symbol, interval);
      const outFile = join(OUT_DIR, `${prefix}_2025_${tf}.json`);
      writeFileSync(outFile, JSON.stringify(candles));
      console.log(` → saved ${outFile.split(/[\\/]/).slice(-3).join('/')}`);
      totalFiles++;
    } catch (e) {
      console.error(`\n  ❌ Error: ${e.message}`);
    }
  }
  console.log('');
}

console.log(`\n✅ Done. ${totalFiles} files written to public/data/`);
