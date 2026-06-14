import fs from 'fs';
import path from 'path';
import https from 'https';

const START_TIME = 1748736000000; // 2025-06-01 00:00:00 UTC
const END_TIME = 1767225599000;   // 2025-12-31 23:59:59 UTC

const timeframes = [
  { tf: '1d', name: 'D1', ms: 24 * 60 * 60 * 1000 },
  { tf: '4h', name: 'H4', ms: 4 * 60 * 60 * 1000 },
  { tf: '1h', name: 'H1', ms: 60 * 60 * 1000 },
  { tf: '30m', name: 'M30', ms: 30 * 60 * 1000 },
  { tf: '15m', name: 'M15', ms: 15 * 60 * 1000 },
  { tf: '5m', name: 'M5', ms: 5 * 60 * 1000 }
];

const fetchKlines = (symbol: string, interval: string, start: number, end: number): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${start}&endTime=${end}&limit=1000`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (Array.isArray(parsed)) resolve(parsed);
          else reject(parsed);
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
};

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

async function downloadAll() {
  const dir = path.join(process.cwd(), 'public/data');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  for (const { tf, name, ms } of timeframes) {
    console.log(`Downloading ${name} (${tf})...`);
    let currentStart = START_TIME;
    let allData: any[] = [];
    
    while (currentStart <= END_TIME) {
      try {
        const klines = await fetchKlines('BTCUSDT', tf, currentStart, END_TIME);
        if (klines.length === 0) break;
        
        const mapped = klines.map(k => {
          const d = new Date(k[0]);
          const dateStr = name === 'D1' ? d.toISOString().split('T')[0] : d.toISOString().slice(0, 16).replace('T', ' ');
          return {
            date: dateStr,
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5])
          };
        });
        
        allData = allData.concat(mapped);
        
        const lastCandleTime = klines[klines.length - 1][0];
        currentStart = lastCandleTime + ms; // next candle start time
        
        if (klines.length < 1000) break; // Reached the end
        
        // Anti rate-limit
        await delay(100);
      } catch (err) {
        console.error(`Error fetching ${name}:`, err);
        break;
      }
    }
    
    const filePath = path.join(dir, `btc_2025_${name}.json`);
    fs.writeFileSync(filePath, JSON.stringify(allData));
    console.log(`Saved ${allData.length} candles for ${name} to ${filePath}`);
  }
}

downloadAll();
