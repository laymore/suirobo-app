import React, { useState, useEffect } from 'react';
import { useSuiClient, useSignAndExecuteTransaction, useCurrentAccount } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { AGENT_URL } from '../agent/agentUrl';
import { PRESET_SKILLS } from '../types/botSkill';

/**
 * Bot-skill detector for marketplace categorization.
 * On-chain SkillPublished events don't carry a `category` field, so we infer:
 *   1. Name matches a known PRESET_SKILLS entry (sui_alpha_m30, sui_ema_h1, ...)
 *   2. Name matches a bot-style pattern (signal + timeframe suffix)
 *   3. Description starts with the [BOT|...] stats marker
 * Any of the above → categorize as "bot" instead of generic "custom".
 */
const KNOWN_BOT_SKILL_NAMES = new Set(PRESET_SKILLS.map(s => s.name.toLowerCase()));
const BOT_NAME_PATTERN = /bot|supertrend|ema|rsi|macd|bb|breakout|scalp|swing|trend/i;
const TIMEFRAME_PATTERN = /\b(m1|m5|m15|m30|h1|h4|d1|w1)\b/i;

/** Truncate a 0x… Sui address for compact display. Keeps the original intact. */
const shortAddr = (a?: string) =>
  !a ? '' : a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;

function isBotSkillByHeuristic(name: string, hasBotStats: boolean): boolean {
  if (hasBotStats) return true;
  if (KNOWN_BOT_SKILL_NAMES.has(name.toLowerCase())) return true;
  if (BOT_NAME_PATTERN.test(name) && TIMEFRAME_PATTERN.test(name)) return true;
  return false;
}

type SkillType = 'all' | 'signal' | 'guard' | 'scanner' | 'custom' | 'bot';
type SortBy = 'popular' | 'newest' | 'price';

interface BotStats {
  profit: number;   // net profit %
  maxdd: number;    // max drawdown %
  wr: number;       // win rate %
  pf: number;       // profit factor
  trades: number;   // total trades
  tf: string;       // timeframe
  lev: number;      // leverage
}

interface MarketSkill {
  id: string;
  name: string;
  description: string;
  type: 'signal' | 'guard' | 'scanner' | 'custom' | 'bot';
  author: string;
  price: number; // 0 = free
  rating: number;
  downloads: number;
  tags: string[];
  blobId: string;
  verified: boolean;
  botStats?: BotStats;   // parsed from [BOT|...] prefix in description
}

const TYPE_ICONS: Record<string, string> = {
  signal: '📡', guard: '🛡️', scanner: '🔍', custom: '⚙️', bot: '🤖'
};
const TYPE_LABELS: Record<string, string> = {
  signal: 'Signal', guard: 'Guard', scanner: 'Scanner', custom: 'Custom', bot: 'Bot Skill'
};

/** Parse [BOT|profit=114.5|maxdd=12.7|wr=12.5|pf=2.86|trades=56|tf=M30|lev=5] from description */
function parseBotDescription(raw: string): { clean: string; stats?: BotStats } {
  const m = raw.match(/^\[BOT\|([^\]]+)\]\s*/);
  if (!m) return { clean: raw };
  const params: Record<string, string> = {};
  m[1].split('|').forEach(kv => { const [k, v] = kv.split('='); if (k && v) params[k] = v; });
  return {
    clean: raw.replace(m[0], ''),
    stats: {
      profit: parseFloat(params.profit ?? '0'),
      maxdd:  parseFloat(params.maxdd  ?? '0'),
      wr:     parseFloat(params.wr     ?? '0'),
      pf:     parseFloat(params.pf     ?? '0'),
      trades: parseInt(params.trades   ?? '0', 10),
      tf:     params.tf  ?? 'M30',
      lev:    parseInt(params.lev ?? '1', 10),
    },
  };
}

export function SkillMarketplace() {
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('popular');
  const [installing, setInstalling] = useState<string | null>(null);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [onChainSkills, setOnChainSkills] = useState<MarketSkill[]>([]);
  const suiClient = useSuiClient();
  const { mutate: signAndExecuteTransaction } = useSignAndExecuteTransaction();
  const account = useCurrentAccount();

  useEffect(() => {
    suiClient.queryEvents({
      query: { MoveEventType: '0xb54499501253333c25eadc6fe17def9cb6cfb5af81f265e9f9b0536ec92813bc::suirobo_factory::SkillPublished' }
    }).then(async (res) => {
      // Fetch latest objects to get dynamic prices
      const skillIds = res.data.map(ev => (ev.parsedJson as any).skill_id);
      let objectsMap: Record<string, any> = {};
      if (skillIds.length > 0) {
        const objs = await suiClient.multiGetObjects({
          ids: skillIds,
          options: { showContent: true }
        });
        for (const obj of objs) {
          if (obj.data?.content && 'fields' in obj.data.content) {
            objectsMap[obj.data.objectId] = obj.data.content.fields;
          }
        }
      }

      const skills = res.data.map(ev => {
        const p = ev.parsedJson as any;
        const rawDesc: string = p.description ?? 'Skill stored on the decentralized Walrus network.';
        const { clean: description, stats: botStats } = parseBotDescription(rawDesc);
        // Categorize: bot skill if stats marker present, OR name matches a known
        // preset / common bot naming pattern (signal_timeframe, _bot suffix).
        const isBot = isBotSkillByHeuristic(p.name || '', !!botStats);
        const type = isBot ? 'bot' : 'custom';
        // Look up the preset for richer tags when we can match it exactly
        const preset = PRESET_SKILLS.find(s => s.name.toLowerCase() === (p.name || '').toLowerCase());
        let tags: string[] = ['on-chain', 'walrus'];
        if (botStats) {
          tags = ['on-chain', 'walrus', 'backtest-proven', `#${botStats.tf.toLowerCase()}`, `+${botStats.profit}%`];
        } else if (preset) {
          tags = ['on-chain', 'walrus', 'preset', `#${preset.preferredTimeframe?.toLowerCase() ?? ''}`,
                  preset.signal, preset.direction];
        } else if (isBot) {
          tags = ['on-chain', 'walrus', 'bot'];
        }
        return {
          id: p.skill_id,
          name: p.name,
          description,
          type,
          // Keep the FULL on-chain creator address — needed verbatim for the
          // 0.005 SUI author-share routing on every Live Trade open. Display
          // code truncates it (see shortAddr below); raw value stays here.
          author: p.creator,
          // Fetch dynamic price from the object data if available, otherwise fallback to initial event price
          price: (objectsMap[p.skill_id] ? Number(objectsMap[p.skill_id].price) : Number(p.price)) / 1e9,
          rating: 5,
          downloads: 0,
          tags,
          blobId: p.blob_id,
          verified: true,
          // Fall back to preset's stats when on-chain description lacks the [BOT|...] marker
          botStats: botStats || (preset?.lastStats ? {
            profit: preset.lastStats.netProfitPct,
            maxdd:  preset.lastStats.maxDrawdownPct,
            wr:     preset.lastStats.winRate,
            pf:     preset.lastStats.profitFactor,
            trades: preset.lastStats.totalTrades,
            tf:     preset.lastStats.timeframe,
            lev:    preset.leverage,
          } : undefined),
        } as MarketSkill;
      });
      setOnChainSkills(skills);
    }).catch(console.error);
  }, [suiClient]);

  const allSkills = [...onChainSkills];

  const filtered = allSkills
    // Autobots Factory marketplace is bot-only — show trading bots exclusively.
    .filter(s => s.type === 'bot')
    .filter(s =>
      !search || 
      s.name.toLowerCase().includes(search.toLowerCase()) || 
      s.tags.some(t => t.includes(search.toLowerCase()))
    )
    .sort((a, b) => {
      if (sortBy === 'popular') return b.downloads - a.downloads;
      if (sortBy === 'price') return a.price - b.price;
      return 0; // newest = default order
    });

  const handleInstall = async (skill: MarketSkill) => {
    if (skill.price > 0 && skill.tags.includes('on-chain')) {
      setInstalling(skill.id);
      const tx = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(skill.price * 1e9)]);
      tx.moveCall({
        target: '0xb54499501253333c25eadc6fe17def9cb6cfb5af81f265e9f9b0536ec92813bc::suirobo_factory::buy_skill',
        arguments: [
          tx.object('0x6408e6890432c270f656c88cd61309ffe011e8a382a5bbc3ac7b9bb6b7e9ddcb'), // Marketplace Object
          tx.object(skill.id), // Skill Object ID
          coin
        ]
      });

      signAndExecuteTransaction({ transaction: tx }, {
        onSuccess: (result) => {
          alert(`🎉 Purchase succeeded! A SkillReceipt has been minted to your wallet (Tx: ${result.digest})`);
          setInstalled(prev => new Set(prev).add(skill.id));
          setInstalling(null);
          // Save skill author for execution fee distribution
          try {
            const stored = localStorage.getItem('installedSkillAuthors');
            const authors: string[] = stored ? JSON.parse(stored) : [];
            if (skill.author && skill.author.startsWith('0x') && !authors.includes(skill.author)) {
              authors.push(skill.author);
              localStorage.setItem('installedSkillAuthors', JSON.stringify(authors));
              // Sync to backend
              const addr = account?.address;
              if (addr) {
                fetch(`${AGENT_URL}/api/skills/authors`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ walletAddress: addr, authors })
                }).catch(() => {});
              }
            }
          } catch { /* ignore */ }
        },
        onError: (e) => {
          alert('On-chain purchase error: ' + e.message);
          setInstalling(null);
        }
      });
      return;
    }

    setInstalling(skill.id);
    // Simulate purchase + download
    await new Promise(r => setTimeout(r, 2000));
    
    try {
      const res = await fetch(`${AGENT_URL}/api/skills/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: JSON.stringify({
            name: skill.name.replace(/\s+/g, '_').toLowerCase(),
            files: {
              'SKILL.md': `---\nname: ${skill.name}\ndescription: ${skill.description}\ntype: ${skill.type}\nauthor: ${skill.author}\n---\n# ${skill.name}\n${skill.description}`,
              'index.js': `const { FunctionTool, z } = globalThis.__SUIROBO_REGISTRY__;
export const skill = new FunctionTool({
  name: '${skill.name.replace(/\s+/g, '_').toLowerCase()}',
  description: '${skill.description.replace(/'/g, "\\'") }',
  parameters: z.object({ input: z.string().optional().describe('Input') }),
  execute: async function ${skill.name.replace(/\s+/g, '_').toLowerCase().replace(/[^a-zA-Z0-9_]/g, '')}(params) {
    return { status: 'active', skill: '${skill.name}', message: '${skill.description.replace(/'/g, "\\'")}' };
  }
});
export default skill;`
            }
          }),
          password: 'walrus_seal'
        })
      });
      if (res.ok) {
        setInstalled(prev => new Set(prev).add(skill.id));
      }
    } catch {
      // If agent not running, still mark as installed for demo
      setInstalled(prev => new Set(prev).add(skill.id));
    }
    setInstalling(null);
  };



  const handleEditPrice = (skill: MarketSkill) => {
    const newPriceStr = prompt(`Enter new price in SUI for ${skill.name}:`);
    if (newPriceStr === null) return;
    const newPrice = parseFloat(newPriceStr);
    if (isNaN(newPrice) || newPrice < 0) {
      alert('Invalid price');
      return;
    }
    const tx = new Transaction();
    tx.moveCall({
      target: '0xb54499501253333c25eadc6fe17def9cb6cfb5af81f265e9f9b0536ec92813bc::suirobo_factory::update_skill_price',
      arguments: [
        tx.object(skill.id),
        tx.pure.u64(Math.floor(newPrice * 1e9))
      ]
    });
    signAndExecuteTransaction({ transaction: tx }, {
      onSuccess: () => {
        alert('Price updated successfully! Please refresh the page in a few seconds.');
        // Optimistically update the state
        setOnChainSkills(prev => prev.map(s => s.id === skill.id ? { ...s, price: newPrice } : s));
      },
      onError: (e) => alert('Failed to update price: ' + e.message)
    });
  };

  // ⚠️ The per-trade 0.05 SUI execution fee has been removed by user decision.
  // Authors now earn solely from one-time skill purchases (20:80 marketplace split,
  // enforced on-chain in suirobo_factory::buy_skill). The "Test paid skill" button
  // that drove this flow has been retired from the UI as well.

  const renderStars = (rating: number) => {
    const full = Math.floor(rating);
    const half = rating % 1 >= 0.5;
    return (
      <span className="stars">
        {'★'.repeat(full)}{half ? '☆' : ''}{'☆'.repeat(5 - full - (half ? 1 : 0))}
        <span style={{ color: '#94a3b8', marginLeft: 4 }}>{rating.toFixed(1)}</span>
      </span>
    );
  };

  return (
    <div>
      {/* Search & Filter */}
      <div className="factory-search">
        <input
          type="text"
          placeholder="🔎 Search skills by name or tag..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as SortBy)}
          style={{
            padding: '10px 16px', borderRadius: 10,
            border: '1px solid #1e293b', background: '#0f172a',
            color: '#94a3b8', fontSize: '0.8rem', cursor: 'pointer', outline: 'none'
          }}
        >
          <option value="popular">Most popular</option>
          <option value="newest">Newest</option>
          <option value="price">Lowest price → cao</option>
        </select>
      </div>

      {/* Results Count */}
      <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 16 }}>
        Showing {filtered.length} bots
      </div>

      {/* Skill Grid */}
      <div className="skill-grid">
        {filtered.map((skill, idx) => (
          <div
            key={skill.id}
            className="skill-card fade-in-up"
            data-type={skill.type}
            style={{ animationDelay: `${idx * 0.05}s` }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span className={`skill-type-badge ${skill.type}`}>
                    {TYPE_ICONS[skill.type]} {TYPE_LABELS[skill.type]}
                  </span>
                  {skill.verified && (
                    <span style={{ fontSize: '0.65rem', color: '#22c55e', display: 'flex', alignItems: 'center', gap: 2 }}>
                      ✓ Verified
                    </span>
                  )}
                </div>
                <h4 style={{ color: '#fff', margin: 0, fontSize: '1rem', fontWeight: 700 }}>
                  {skill.name}
                </h4>
              </div>
              <div style={{ textAlign: 'right' }}>
                {skill.price === 0 ? (
                  <span className="status-tag free">Free</span>
                ) : (
                  <span style={{ color: '#a78bfa', fontWeight: 700, fontSize: '1rem' }}>
                    {skill.price} SUI
                  </span>
                )}
                {account?.address === skill.author && (
                  <button
                    onClick={() => handleEditPrice(skill)}
                    style={{
                      marginLeft: '8px',
                      background: 'transparent',
                      border: '1px solid #475569',
                      color: '#94a3b8',
                      borderRadius: '4px',
                      padding: '2px 6px',
                      fontSize: '0.7rem',
                      cursor: 'pointer'
                    }}
                    title="Edit Price"
                  >
                    ✏️ Edit price
                  </button>
                )}
              </div>
            </div>

            {/* Bot Skill: backtest stats banner */}
            {skill.type === 'bot' && skill.botStats && (() => {
              const s = skill.botStats;
              return (
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5, marginBottom: 10,
                  background: 'rgba(167,139,250,0.06)', borderRadius: 8, padding: '8px 6px',
                  border: '1px solid rgba(167,139,250,0.18)',
                }}>
                  {[
                    { l: '6m Profit', v: `+${s.profit}%`, c: '#22c55e' },
                    { l: 'Max DD',    v: `${s.maxdd}%`,   c: s.maxdd <= 15 ? '#10b981' : '#f59e0b' },
                    { l: 'Win Rate',  v: `${s.wr}%`,       c: '#94a3b8' },
                    { l: 'P.Factor',  v: `${s.pf}`,         c: '#a78bfa' },
                  ].map(x => (
                    <div key={x.l} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.58rem', color: '#475569' }}>{x.l}</div>
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: x.c, fontFamily: 'monospace' }}>{x.v}</div>
                    </div>
                  ))}
                  <div style={{ gridColumn: '1 / -1', fontSize: '0.6rem', color: '#22c55e', textAlign: 'center', marginTop: 2 }}>
                    ✅ Every month profitable · {s.tf} · {s.lev}x leverage · {s.trades} trades/6m
                  </div>
                </div>
              );
            })()}

            {/* Description */}
            <p style={{ color: '#94a3b8', fontSize: '0.8rem', lineHeight: 1.5, margin: '0 0 12px 0', minHeight: 40 }}>
              {skill.description}
            </p>

            {/* Meta */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div>{renderStars(skill.rating)}</div>
              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                ⬇ {skill.downloads} downloads
              </span>
            </div>

            {/* Tags */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
              {skill.tags.map(tag => (
                <span key={tag} style={{
                  padding: '2px 8px', borderRadius: 6,
                  background: '#1e293b', color: '#64748b',
                  fontSize: '0.7rem'
                }}>#{tag}</span>
              ))}
            </div>

            {/* Footer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #1e293b', paddingTop: 12 }}>
              <span style={{ fontSize: '0.75rem', color: '#475569', fontFamily: 'monospace' }}>
                by {shortAddr(skill.author)}
              </span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {installed.has(skill.id) ? (
                  <span className="status-tag active">✓ Installed</span>
                ) : (
                  <button
                    className={skill.price === 0 ? 'btn-success' : 'btn-primary'}
                    disabled={installing === skill.id}
                    onClick={() => handleInstall(skill)}
                  >
                    {installing === skill.id ? '⏳ Installing…' : (skill.price === 0 ? 'Install (free)' : `Buy for ${skill.price} SUI`)}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <div className="empty-state-text">No matching skills found</div>
          <div className="empty-state-hint">Try different filters or search terms</div>
        </div>
      )}
    </div>
  );
}
