/**
 * Fetch REAL Binance SUIUSDT klines for FULL YEAR 2025 (UTC) in 4 timeframes
 * and save them for both research (server/data) and the Backtest Simulator UI
 * (public/data — shipped with the Walrus site).
 * Run: npx tsx server/fetch_btc_2025.ts
 */
import fs from 'fs';
import path from 'path';
import type { Candle } from '../src/agent/backtestEngine.js';

const START = Date.parse('2025-01-01T00:00:00Z');
const END   = Date.parse('2026-01-01T00:00:00Z'); // exclusive
const TFS: Array<{ binance: string; tag: string; ms: number }> = [
  { binance: '5m',  tag: 'M5',  ms: 300_000 },
  { binance: '15m', tag: 'M15', ms: 900_000 },
  { binance: '30m', tag: 'M30', ms: 1_800_000 },
  { binance: '1h',  tag: 'H1',  ms: 3_600_000 },
];

async function fetchTf(binanceTf: string): Promise<Candle[]> {
  const out: Candle[] = [];
  let cursor = START;
  while (cursor < END) {
    const url = `https://api.binance.com/api/v3/klines?symbol=SUIUSDT&interval=${binanceTf}&startTime=${cursor}&endTime=${END - 1}&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance ${res.status}: ${await res.text()}`);
    const rows = (await res.json()) as any[];
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const k of rows) {
      out.push({
        date: new Date(k[0]).toISOString(),
        open: parseFloat(k[1]), high: parseFloat(k[2]),
        low: parseFloat(k[3]), close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      });
    }
    cursor = rows[rows.length - 1][0] + 1;
    await new Promise(r => setTimeout(r, 120));
  }
  return out;
}

async function main() {
  fs.mkdirSync(path.join(process.cwd(), 'server', 'data'), { recursive: true });
  for (const tf of TFS) {
    const candles = await fetchTf(tf.binance);
    const expected = (END - START) / tf.ms;
    const json = JSON.stringify(candles);
    const pub = path.join(process.cwd(), 'public', 'data', `sui_full_2025_${tf.tag}.json`);
    const srv = path.join(process.cwd(), 'server', 'data', `sui_full_2025_${tf.tag}.json`);
    fs.writeFileSync(pub, json);
    fs.writeFileSync(srv, json);
    console.log(`${tf.tag}: ${candles.length} candles (expected ~${expected}, missing ${expected - candles.length})  ` +
      `${candles[0]?.date.slice(0, 10)} -> ${candles[candles.length - 1]?.date.slice(0, 10)}  ${(json.length / 1e6).toFixed(1)}MB`);
  }
  console.log('DONE');
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
