/**
 * deepbookTape — Sui-Native Data Spine (increment 1).
 *
 * Builds OHLC candles from DeepBook V3's on-chain trade tape instead of a CEX REST
 * feed. Every match emits an `OrderFilled` event with { price, base_quantity,
 * timestamp }; aggregating those by time bucket gives candles whose every tick is a
 * consensus-signed on-chain trade — no Binance/third-party REST in the critical path.
 * A self-custody DEX bot can run entirely off its own Sui RPC.
 *
 * Read-only (queryEvents devInspect-style) — no key. Aggregator is pure + testable.
 *
 * NOTE: the OrderFilled type keeps its TYPE-ORIGIN package id even after DeepBook V3
 * upgrades, so we query against the original publish (0x2c8d603b…), not the current
 * package — verified on mainnet (the live pool object's type carries this id).
 */
import type { Candle } from './backtestEngine';

// DeepBook V3 type-origin package (where OrderFilled is defined) + the SUI/USDC pool.
export const DEEPBOOK_TAPE_PKG = '0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809';
export const SUI_USDC_POOL = '0xe05dafb5133bcffb8d59f4e12465dc0e9faeaa05e3e342a08fe135800e3e4407';
const PRICE_SCALE = 1e6;   // USDC quote = 6 decimals → raw price / 1e6 = USDC per SUI
const BASE_SCALE = 1e9;    // SUI base = 9 decimals

const TF_MS: Record<string, number> = { '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000 };

export interface DeepBookFill { price: number; qty: number; ts: number }

/**
 * Fetch recent DeepBook SUI/USDC fills, newest pages first, returned oldest→newest.
 * `pages` × 50 events scanned across all pools, filtered to the target pool.
 */
export async function fetchDeepBookFills(
  suiClient: any,
  opts: { pool?: string; pages?: number } = {},
): Promise<DeepBookFill[]> {
  const pool = opts.pool ?? SUI_USDC_POOL;
  const pages = Math.max(1, opts.pages ?? 20);
  const out: DeepBookFill[] = [];
  let cursor: any = null;
  for (let p = 0; p < pages; p++) {
    const res: any = await suiClient.queryEvents({
      query: { MoveEventType: `${DEEPBOOK_TAPE_PKG}::order_info::OrderFilled` },
      cursor, limit: 50, order: 'descending',
    });
    for (const ev of res.data ?? []) {
      const j = ev.parsedJson as any;
      if (!j || j.pool_id !== pool) continue;
      const price = Number(j.price) / PRICE_SCALE;
      const qty = Number(j.base_quantity) / BASE_SCALE;
      const ts = Number(j.timestamp);
      if (price > 0 && qty > 0 && ts > 0) out.push({ price, qty, ts });
    }
    if (!res.hasNextPage || !res.nextCursor) break;
    cursor = res.nextCursor;
  }
  out.sort((a, b) => a.ts - b.ts);   // oldest → newest
  return out;
}

/**
 * Aggregate fills (oldest→newest) into OHLCV candles. Pure — no network.
 * `tf` = '5m'|'15m'|'30m'|'1h' or a bucket size in ms.
 */
export function fillsToCandles(fills: DeepBookFill[], tf: string | number): Candle[] {
  const tfMs = typeof tf === 'number' ? tf : (TF_MS[tf] ?? 900_000);
  if (!fills.length) return [];
  const buckets = new Map<number, Candle>();
  for (const f of fills) {
    const k = Math.floor(f.ts / tfMs) * tfMs;
    const c = buckets.get(k);
    if (!c) {
      buckets.set(k, { date: new Date(k).toISOString(), open: f.price, high: f.price, low: f.price, close: f.price, volume: f.qty });
    } else {
      if (f.price > c.high) c.high = f.price;
      if (f.price < c.low) c.low = f.price;
      c.close = f.price;        // fills are chronological → last in bucket is the close
      c.volume += f.qty;
    }
  }
  return Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]).map(([, c]) => c);
}

/** Convenience: fetch + aggregate in one call. */
export async function fetchDeepBookCandles(
  suiClient: any,
  tf: string,
  opts: { pool?: string; pages?: number } = {},
): Promise<Candle[]> {
  return fillsToCandles(await fetchDeepBookFills(suiClient, opts), tf);
}

/**
 * OnchainCandleFeed — stateful, accumulating DeepBook candle source for the LIVE bot.
 *
 * The live loop needs ~100+ lookback candles but can't re-page hours of fills every
 * tick. So: bootstrap once (seed a fill buffer), then each `update()` pages back only
 * to the last-seen fill and appends the new ones. The buffer grows over time, so the
 * usable history deepens the longer the bot runs — and `candles()` re-aggregates the
 * buffer to any timeframe on demand. Pure Sui RPC, no CEX REST.
 */
export class OnchainCandleFeed {
  private fills: DeepBookFill[] = [];
  private lastTs = 0;
  private readonly pool: string;
  private readonly cap: number;

  constructor(opts: { pool?: string; cap?: number } = {}) {
    this.pool = opts.pool ?? SUI_USDC_POOL;
    this.cap = opts.cap ?? 60_000;   // ~ a few days of SUI/USDC fills, bounded
  }

  /** Seed the buffer with recent fills (call once on start). */
  async bootstrap(suiClient: any, pages = 120): Promise<number> {
    const fills = await fetchDeepBookFills(suiClient, { pool: this.pool, pages });
    this.fills = fills;
    this.lastTs = fills.length ? fills[fills.length - 1].ts : 0;
    return fills.length;
  }

  /** Page back only to the last-seen fill, append the new ones. Returns #new fills. */
  async update(suiClient: any, maxPages = 12): Promise<number> {
    const fresh: DeepBookFill[] = [];
    let cursor: any = null;
    for (let p = 0; p < maxPages; p++) {
      const res: any = await suiClient.queryEvents({
        query: { MoveEventType: `${DEEPBOOK_TAPE_PKG}::order_info::OrderFilled` },
        cursor, limit: 50, order: 'descending',
      });
      let reachedSeen = false;
      for (const ev of res.data ?? []) {
        const j = ev.parsedJson as any;
        if (!j || j.pool_id !== this.pool) continue;
        const ts = Number(j.timestamp);
        if (ts <= this.lastTs) { reachedSeen = true; break; }
        const price = Number(j.price) / PRICE_SCALE;
        const qty = Number(j.base_quantity) / BASE_SCALE;
        if (price > 0 && qty > 0) fresh.push({ price, qty, ts });
      }
      if (reachedSeen || !res.hasNextPage || !res.nextCursor) break;
      cursor = res.nextCursor;
    }
    if (fresh.length) {
      fresh.sort((a, b) => a.ts - b.ts);
      this.fills.push(...fresh);
      this.lastTs = this.fills[this.fills.length - 1].ts;
      if (this.fills.length > this.cap) this.fills = this.fills.slice(-this.cap);
    }
    return fresh.length;
  }

  /** Re-aggregate the accumulated buffer into candles at the given timeframe. */
  candles(tf: string | number): Candle[] {
    return fillsToCandles(this.fills, tf);
  }

  get size(): number { return this.fills.length; }
}
