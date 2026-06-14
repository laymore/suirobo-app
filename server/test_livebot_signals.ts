/**
 * test_livebot_signals.ts — New-user style test of the Live Trade "Auto Bot"
 * signal brain for the two new SUI skills, WITHOUT placing any real trade.
 *
 * It exercises exactly the pipeline the Auto Bot runs each tick:
 *   fetchCandles(SUI/USDC) → detectLiveSignal(skill.signal, direction) → TP/SL calc
 * against LIVE Binance SUIUSDT candles, for both:
 *   • sui_alpha_m30  (rsi_macd, M30→30m, both, TP10/SL0.5, 5x)
 *   • sui_ema_h1     (ema_cross, H1→1h, both, TP15/SL1, 2x)
 *
 * Run: npx tsx server/test_livebot_signals.ts
 */
import { detectLiveSignal, type Candle, type IndicatorType } from '../src/agent/backtestEngine.js';

const SKILLS = [
  { name: 'sui_alpha_m30', signal: 'rsi_macd' as IndicatorType, tf: '30m', dir: 'both' as const, tp: 10, sl: 0.5, lev: 5 },
  { name: 'sui_ema_h1',    signal: 'ema_cross' as IndicatorType, tf: '1h', dir: 'both' as const, tp: 15, sl: 1,   lev: 2 },
];

async function fetchCandles(symbol: string, tf: string, limit = 200): Promise<Candle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=${limit}`;
  const res = await fetch(url);
  const data = await res.json() as any[];
  if (!Array.isArray(data)) throw new Error('Binance data invalid: ' + JSON.stringify(data).slice(0, 120));
  return data.map((k: any[]) => ({
    date: new Date(k[0]).toISOString(),
    open: parseFloat(k[1]), high: parseFloat(k[2]),
    low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]),
  }));
}

/** Replay the last N candles tick-by-tick, count signals the Auto Bot WOULD fire. */
function replaySignals(candles: Candle[], signal: IndicatorType, dir: 'both'|'long_only'|'short_only') {
  let buys = 0, sells = 0;
  const events: string[] = [];
  // Need a warmup window; detectLiveSignal expects the full candle slice up to "now"
  for (let i = 60; i < candles.length; i++) {
    const slice = candles.slice(0, i + 1);
    const { buy, sell } = detectLiveSignal(slice, signal, dir);
    if (buy)  { buys++;  events.push(`  🟢 BUY  @ ${slice[i].date}  $${slice[i].close}`); }
    if (sell) { sells++; events.push(`  🔴 SELL @ ${slice[i].date}  $${slice[i].close}`); }
  }
  return { buys, sells, events };
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  🤖 LIVE TRADE — AUTO BOT (no AI) signal test · SUI/USDC');
  console.log('  Dry-run: detects signals only, NO real trades placed');
  console.log('═══════════════════════════════════════════════════════════════\n');

  for (const sk of SKILLS) {
    console.log(`▶ Skill: ${sk.name}`);
    console.log(`  Strategy=${sk.signal} · TF=${sk.tf} · dir=${sk.dir} · TP ${sk.tp}% / SL ${sk.sl}% · ${sk.lev}x`);
    try {
      const candles = await fetchCandles('SUIUSDT', sk.tf, 200);
      const last = candles[candles.length - 1];
      console.log(`  📡 Live SUI price feed OK: ${candles.length} candles · last close $${last.close} @ ${last.date}`);

      // The signal the bot sees RIGHT NOW (the actual decision each tick)
      const now = detectLiveSignal(candles, sk.signal, sk.dir);
      const liveSig = now.buy ? 'BUY' : now.sell ? 'SELL' : 'HOLD';
      console.log(`  🎯 Current tick decision: ${liveSig}`);

      // Historical replay over the visible window
      const { buys, sells, events } = replaySignals(candles, sk.signal, sk.dir);
      console.log(`  📊 Replay last ${candles.length - 60} candles → ${buys} BUY / ${sells} SELL signals`);
      if (events.length) {
        console.log(`  Last few signals:`);
        events.slice(-4).forEach(e => console.log(e));
      }

      // Show TP/SL the bot would set on a hypothetical entry at the live price
      const tpL = (last.close * (1 + sk.tp / 100)).toFixed(4);
      const slL = (last.close * (1 - sk.sl / 100)).toFixed(4);
      console.log(`  🛡️  If LONG @ $${last.close}: TP $${tpL} / SL $${slL}  (margin PnL ±${(sk.tp*sk.lev).toFixed(0)}% / ${(sk.sl*sk.lev).toFixed(1)}%)`);
      console.log(`  ✅ Pipeline OK — bot brain produces valid decisions for ${sk.name}\n`);
    } catch (e: any) {
      console.error(`  ❌ FAILED: ${e.message}\n`);
    }
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Done. To go fully live (real autonomous margin trades), the');
  console.log('  user presses "⚡ Start Auto Bot" in the UI with their own key.');
  console.log('═══════════════════════════════════════════════════════════════');
}

main();
