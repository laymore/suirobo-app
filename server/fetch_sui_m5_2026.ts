/**
 * Fetch REAL Binance SUI/USDT 5m klines for 2026-01-01 → 2026-05-31 (UTC)
 * and cache them as server/data/sui_m5_2026_jan_may.json (Candle[] shape used
 * by backtestEngine). Run: npx tsx server/fetch_sui_m5_2026.ts
 */
import fs from 'fs';
import path from 'path';
import type { Candle } from '../src/agent/backtestEngine.js';

const OUT = path.join(process.cwd(), 'server', 'data', 'sui_m5_2026_jan_may.json');
const START = Date.parse('2026-01-01T00:00:00Z');
const END   = Date.parse('2026-06-01T00:00:00Z'); // exclusive — end of May

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const out: Candle[] = [];
  let cursor = START;
  let req = 0;
  while (cursor < END) {
    const url = `https://api.binance.com/api/v3/klines?symbol=SUIUSDT&interval=5m&startTime=${cursor}&endTime=${END - 1}&limit=1000`;
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
    cursor = rows[rows.length - 1][0] + 300_000; // next bar after last open time
    req++;
    if (req % 10 === 0) console.log(`  ${req} requests, ${out.length} candles, at ${new Date(cursor).toISOString()}`);
    await new Promise(r => setTimeout(r, 150)); // stay way under rate limits
  }
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log(`DONE: ${out.length} candles → ${OUT}`);
  console.log(`First: ${out[0]?.date}  Last: ${out[out.length - 1]?.date}`);
  // integrity: expect ~ (END-START)/300000 bars
  const expected = (END - START) / 300_000;
  console.log(`Expected ~${expected}, missing ${expected - out.length} (exchange downtime gaps are normal)`);
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
