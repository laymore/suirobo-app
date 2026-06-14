import React, { useState, useEffect, useCallback } from 'react';
import { useSuiClient } from '@mysten/dapp-kit';

type LeaderTab = 'creators' | 'skills' | 'trending';

// Marketplace package (mainnet) — emits SkillPurchased when buy_skill runs.
const MARKET_PKG = '0xb54499501253333c25eadc6fe17def9cb6cfb5af81f265e9f9b0536ec92813bc';
// Fee contract type-origin package — ExecutionFeePaid keeps this defining id
// even after the v2 fee upgrade (events emitted by 0x02faed0d… match it).
const FEE_PKG = '0x888f919f64154138f6e21a2341515f68d472be54c45eb9c70e628cfb5458958a';

interface CreatorData {
  wallet: string;
  skillRevenue: number;
  feeRewards: number;
  totalRevenue: number;
  tradeCount: number;
  purchaseCount: number;
}

const RANK_STYLES: Record<number, { color: string; emoji: string }> = {
  1: { color: '#fbbf24', emoji: '🥇' },
  2: { color: '#d1d5db', emoji: '🥈' },
  3: { color: '#b45309', emoji: '🥉' },
};

export const Leaderboard: React.FC = () => {
  const [tab, setTab] = useState<LeaderTab>('creators');
  const [creators, setCreators] = useState<CreatorData[]>([]);
  const [loading, setLoading] = useState(true);
  const suiClient = useSuiClient();

  const fetchData = useCallback(async () => {
    setLoading(true);
    const aggregation = new Map<string, CreatorData>();

    const getOrInit = (wallet: string): CreatorData => {
      if (!aggregation.has(wallet)) {
        aggregation.set(wallet, {
          wallet,
          skillRevenue: 0,
          feeRewards: 0,
          totalRevenue: 0,
          tradeCount: 0,
          purchaseCount: 0,
        });
      }
      return aggregation.get(wallet)!;
    };

    try {
      // Fetch SkillPurchased events
      const purchaseRes = await suiClient.queryEvents({
        query: { MoveEventType: `${MARKET_PKG}::suirobo_factory::SkillPurchased` },
        limit: 50,
      });
      for (const ev of purchaseRes.data) {
        const p = ev.parsedJson as any;
        const creator = p.creator ?? p.skill_creator ?? '';
        if (!creator) continue;
        const entry = getOrInit(creator);
        const revenue = Number(p.creator_revenue ?? 0) / 1e9;
        entry.skillRevenue += revenue;
        entry.purchaseCount += 1;
      }

      // Fetch ExecutionFeePaid events
      const feeRes = await suiClient.queryEvents({
        query: { MoveEventType: `${FEE_PKG}::suirobo_factory::ExecutionFeePaid` },
        limit: 50,
      });
      for (const ev of feeRes.data) {
        const p = ev.parsedJson as any;
        const creator = p.rewarded_creator ?? '';
        if (!creator) continue;
        const entry = getOrInit(creator);
        const reward = Number(p.creator_reward ?? 0) / 1e9;
        entry.feeRewards += reward;
        entry.tradeCount += 1;
      }
    } catch (e) {
      console.error('Leaderboard fetch error:', e);
    }

    // Compute totals
    for (const entry of aggregation.values()) {
      entry.totalRevenue = entry.skillRevenue + entry.feeRewards;
    }

    setCreators(Array.from(aggregation.values()));
    setLoading(false);
  }, [suiClient]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const sortedByRevenue = [...creators].sort((a, b) => b.totalRevenue - a.totalRevenue);
  const sortedByTrades = [...creators].sort((a, b) => (b.tradeCount + b.purchaseCount) - (a.tradeCount + a.purchaseCount));
  const sortedByFeeRewards = [...creators].sort((a, b) => b.feeRewards - a.feeRewards);

  const displayData = tab === 'creators' ? sortedByRevenue
    : tab === 'skills' ? sortedByTrades
    : sortedByFeeRewards;

  const totalRevenue = creators.reduce((sum, c) => sum + c.totalRevenue, 0);
  const totalTrades = creators.reduce((sum, c) => sum + c.tradeCount + c.purchaseCount, 0);

  const shortenWallet = (addr: string) =>
    addr.length > 12 ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : addr;

  return (
    <div>
      {/* Stats Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 24 }}>
        <div style={{ background: '#0f172a', padding: '16px 20px', borderRadius: 12, border: '1px solid #1e293b' }}>
          <div style={{ color: '#64748b', fontSize: '0.75rem', marginBottom: 4 }}>Total Revenue</div>
          <div style={{ color: '#22c55e', fontSize: '1.4rem', fontWeight: 800 }}>{totalRevenue.toFixed(2)} SUI</div>
        </div>
        <div style={{ background: '#0f172a', padding: '16px 20px', borderRadius: 12, border: '1px solid #1e293b' }}>
          <div style={{ color: '#64748b', fontSize: '0.75rem', marginBottom: 4 }}>Total Trading</div>
          <div style={{ color: '#00d4ff', fontSize: '1.4rem', fontWeight: 800 }}>{totalTrades.toLocaleString()}</div>
        </div>
        <div style={{ background: '#0f172a', padding: '16px 20px', borderRadius: 12, border: '1px solid #1e293b' }}>
          <div style={{ color: '#64748b', fontSize: '0.75rem', marginBottom: 4 }}>Profit share</div>
          <div style={{ color: '#f59e0b', fontSize: '1.4rem', fontWeight: 800 }}>80/20</div>
          <div style={{ color: '#475569', fontSize: '0.7rem' }}>Creator / Treasury</div>
        </div>
      </div>

      {/* Sub-tabs + Refresh */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {([
            { id: 'creators' as LeaderTab, label: '💰 Top Revenue' },
            { id: 'skills' as LeaderTab, label: '📈 Top Trading' },
            { id: 'trending' as LeaderTab, label: '⭐ Top rated' },
          ]).map(t => (
            <button
              key={t.id}
              className={`factory-filter-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          className="btn-outline"
          onClick={fetchData}
          disabled={loading}
          style={{ fontSize: '0.75rem', padding: '6px 14px' }}
        >
          {loading ? '⏳ Loading...' : '🔄 Refresh'}
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: '#64748b', fontSize: '0.9rem' }}>
          ⏳ Querying on-chain events…
        </div>
      )}

      {/* Empty state */}
      {!loading && creators.length === 0 && (
        <div style={{
          background: 'rgba(77,162,255, 0.05)', border: '1px solid rgba(77,162,255, 0.2)',
          borderRadius: 12, padding: '24px 20px', textAlign: 'center',
          color: '#94a3b8', fontSize: '0.85rem', lineHeight: 1.6,
        }}>
          📡 Waiting for on-chain data… The leaderboard updates as real trades happen.
        </div>
      )}

      {/* Table */}
      {!loading && creators.length > 0 && (
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Creator</th>
              <th>Skill Sales</th>
              <th>Fee Rewards</th>
              <th>{tab === 'creators' ? 'Total Revenue' : tab === 'skills' ? 'Trading' : 'Fee Rewards'}</th>
            </tr>
          </thead>
          <tbody>
            {displayData.map((creator, idx) => {
              const rank = idx + 1;
              const rs = RANK_STYLES[rank];
              return (
                <tr key={creator.wallet} className="leaderboard-row fade-in-up" style={{ animationDelay: `${idx * 0.04}s` }}>
                  <td style={{ fontWeight: 700, color: rs?.color || '#e2e8f0', fontSize: '1rem' }}>
                    {rs?.emoji || `#${rank}`}
                  </td>
                  <td>
                    <span style={{ color: '#00d4ff', fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      {shortenWallet(creator.wallet)}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontSize: '0.8rem' }}>
                      <span style={{ color: '#22c55e' }}>{creator.skillRevenue.toFixed(2)} SUI</span>
                      <span style={{ color: '#475569', marginLeft: 6 }}>({creator.purchaseCount} time)</span>
                    </div>
                  </td>
                  <td>
                    <div style={{ fontSize: '0.8rem' }}>
                      <span style={{ color: '#fbbf24' }}>{creator.feeRewards.toFixed(2)} SUI</span>
                      <span style={{ color: '#475569', marginLeft: 6 }}>({creator.tradeCount} time)</span>
                    </div>
                  </td>
                  <td style={{ fontWeight: 700 }}>
                    {tab === 'creators'
                      ? <span style={{ color: creator.totalRevenue > 0 ? '#22c55e' : '#64748b' }}>
                          {creator.totalRevenue > 0 ? `+${creator.totalRevenue.toFixed(2)} SUI` : '0 SUI'}
                        </span>
                      : tab === 'skills'
                      ? <span style={{ color: '#00d4ff' }}>🔄 {creator.tradeCount + creator.purchaseCount}</span>
                      : <span style={{ color: '#fbbf24' }}>{creator.feeRewards.toFixed(2)} SUI</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};
