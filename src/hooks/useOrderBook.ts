/**
 * useOrderBook — live DeepBook SUI/USDC microstructure, read on-chain.
 *
 * A CEX-broker EA only sees OHLC candles; the exchange order book is a black box.
 * On DeepBook the book is ON-CHAIN, so we can read L2 depth around the mid and
 * compute the order-book imbalance (OBI) — a real microstructure signal a
 * CEX EA can't access. This is the start of the P3 "on-chain alpha" pillar.
 *
 *   OBI = (Σ bid qty − Σ ask qty) / (Σ bid qty + Σ ask qty)   ∈ [-1, +1]
 *   > 0  bid-heavy → buy pressure ;  < 0  ask-heavy → sell pressure
 *
 * Read-only (devInspect) — no key, works on web + desktop. Refreshes on an interval.
 */
import { useState, useEffect } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import { DeepBookClient } from '@mysten/deepbook-v3';

const READ_ADDR = '0x0000000000000000000000000000000000000000000000000000000000000001';
const LEVELS = 10;

export interface OrderBookSnap {
  mid: number;
  bestBid: number; bestAsk: number;
  spread: number; spreadBps: number;
  bidVol: number; askVol: number;   // summed quantity over the top LEVELS (base = SUI)
  obi: number;                       // order-book imbalance, [-1, +1]
}

export function useOrderBook(pollMs = 15000): { book: OrderBookSnap | null; loading: boolean } {
  const suiClient = useSuiClient();
  const [book, setBook] = useState<OrderBookSnap | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const db = new DeepBookClient({ client: suiClient as any, network: 'mainnet', address: READ_ADDR });
    const sum = (a: number[]) => a.reduce((s, x) => s + (Number(x) || 0), 0);

    const read = async () => {
      try {
        const [mid, lvl] = await Promise.all([
          db.midPrice('SUI_USDC'),
          db.getLevel2TicksFromMid('SUI_USDC', LEVELS),
        ]);
        const bidVol = sum(lvl.bid_quantities);
        const askVol = sum(lvl.ask_quantities);
        const bestBid = Number(lvl.bid_prices?.[0]) || 0;
        const bestAsk = Number(lvl.ask_prices?.[0]) || 0;
        const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;
        const tot = bidVol + askVol;
        if (alive) {
          setBook({
            mid, bestBid, bestAsk, spread,
            spreadBps: mid > 0 ? (spread / mid) * 10000 : 0,
            bidVol, askVol,
            obi: tot > 0 ? (bidVol - askVol) / tot : 0,
          });
          setLoading(false);
        }
      } catch {
        if (alive) setLoading(false);   // keep last good snapshot
      }
    };

    read();
    const id = setInterval(read, pollMs);
    return () => { alive = false; clearInterval(id); };
  }, [suiClient, pollMs]);

  return { book, loading };
}
