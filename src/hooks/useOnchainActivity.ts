/**
 * useOnchainActivity — trustless "verified live activity" per skill creator.
 *
 * Every Auto-Bot OPEN pays the 0.01 SUI skill fee through
 * suirobo_factory::pay_execution_fee, which emits an ExecutionFeePaid event
 * carrying { rewarded_creator, creator_reward, payer, ... }. Counting those events
 * per `rewarded_creator` gives the number of REAL positions opened on mainnet by
 * bots running that creator's skills — a fact anyone can re-derive from chain, and
 * something a seller can't fake (unlike a claimed backtest).
 *
 * Used to stamp a "✅ Verified live" badge on marketplace cards. Read-only; no key.
 */
import { useState, useEffect } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';
import { normalizeSuiAddress } from '@mysten/sui/utils';

// Type-origin package of ExecutionFeePaid — keeps this defining id even after the
// v2 fee upgrade (events emitted by 0x02faed0d… still carry this type). Same id the
// Leaderboard queries.
const FEE_PKG = '0x888f919f64154138f6e21a2341515f68d472be54c45eb9c70e628cfb5458958a';

export interface CreatorActivity {
  opens: number;     // real on-chain bot opens attributed to this creator
  rewards: number;   // SUI earned from those opens (0.005 each)
  lastMs: number;    // timestamp of the most recent open (0 if unknown)
}

export function useOnchainActivity() {
  const suiClient = useSuiClient();
  const [activity, setActivity] = useState<Record<string, CreatorActivity>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      const acc: Record<string, CreatorActivity> = {};
      try {
        let cursor: any = null;
        // Page through all fee events (cap pages so a busy future can't hang the UI).
        for (let page = 0; page < 20; page++) {
          const res: any = await suiClient.queryEvents({
            query: { MoveEventType: `${FEE_PKG}::suirobo_factory::ExecutionFeePaid` },
            cursor, limit: 50, order: 'descending',
          });
          for (const ev of res.data ?? []) {
            const p = ev.parsedJson as any;
            const raw = p?.rewarded_creator;
            if (!raw || typeof raw !== 'string') continue;
            let key = raw;
            try { key = normalizeSuiAddress(raw); } catch { /* keep raw */ }
            const a = (acc[key] ||= { opens: 0, rewards: 0, lastMs: 0 });
            a.opens += 1;
            a.rewards += Number(p.creator_reward ?? 0) / 1e9;
            const ms = Number(ev.timestampMs ?? 0);
            if (ms > a.lastMs) a.lastMs = ms;
          }
          if (!res.hasNextPage || !res.nextCursor) break;
          cursor = res.nextCursor;
        }
      } catch { /* leave whatever aggregated */ }
      if (alive) { setActivity(acc); setLoading(false); }
    })();
    return () => { alive = false; };
  }, [suiClient]);

  /** Lookup helper that tolerates short/un-normalised author addresses. */
  const opensFor = (author?: string): number => {
    if (!author) return 0;
    let key = author;
    try { key = normalizeSuiAddress(author); } catch { /* keep */ }
    return activity[key]?.opens ?? 0;
  };

  return { activity, opensFor, loading };
}
