/**
 * BotSkillBuilder — Create Bot Skill qua form trực quan
 * Save localStorage + server API
 * Export ADK-FunctionTool-compatible SKILL.md + index.js
 */
import React, { useState, useEffect, useMemo } from 'react';
import {
  type BotSkillConfig,
  SIGNAL_LABELS, DIRECTION_LABELS,
  loadBotSkills, upsertBotSkill, deleteBotSkill,
  generateSkillMd, generateIndexJs,
  PRESET_SKILLS,
} from '../types/botSkill';
import type { IndicatorType } from '../agent/backtestEngine';
import { AGENT_URL } from '../agent/agentUrl';
import { useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SIGNALS: IndicatorType[] = ['ema_cross', 'rsi', 'macd', 'bb', 'rsi_macd', 'supertrend', 'supertrend_flip', 'range_breakout'];

const SIGNAL_DESC: Record<IndicatorType, string> = {
  ema_cross: 'EMA9 crosses above EMA21 → Buy | EMA9 crosses below → Sell',
  ma_cross:  'Fast SMA crosses above slow SMA → Buy | crosses below → Sell',
  rsi:       'RSI crosses above 30 → Buy | RSI drops below 70 → Sell',
  macd:      'MACD histogram crossing negative → positive = BUY | reverse = SELL',
  bb:        'Price bounces off lower Bollinger band → Buy | off upper band → Sell',
  rsi_macd:  'RSI < 40 + positive MACD histogram → Buy | RSI > 60 + negative MACD → Sell',
  supertrend:'Price pulls back to rising Supertrend → Buy | price taps falling Supertrend → Sell',
  supertrend_flip:'Classic EA entry: trend flips UP → Buy | flips DOWN → Sell. One trade per trend leg; opposite flip closes it.',
  range_breakout:'Donchian momentum: close breaks the prior N-bar HIGH → Buy | prior N-bar LOW → Sell. Fires once per breakout.',
};

// Default = bb_meanrev_m15: the backtest-winning Bollinger Bands mean-reversion preset
// (+10.29% / month, 62.7% win, PF 1.25 on M15). Users can still change any field.
const defaultConfig = (): BotSkillConfig => ({
  name: '',
  description: '',
  version: '1.0.0',
  createdAt: new Date().toISOString().split('T')[0],
  signal: 'bb',
  takeProfitPct: 5,
  stopLossPct: 1.5,
  trailingStopPct: 0,
  enableTrailing: false,
  enableDefense: true,
  leverage: 3,
  orderPct: 50,
  commission: 0.01,
  direction: 'both',
});

// ─── Sub-components ───────────────────────────────────────────────────────────

const Field: React.FC<{
  label: string; hint?: string;
  children: React.ReactNode;
}> = ({ label, hint, children }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    <label style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>{label}</label>
    {children}
    {hint && <span style={{ fontSize: '0.65rem', color: '#475569' }}>{hint}</span>}
  </div>
);

const NumberInput: React.FC<{
  value: number; min?: number; max?: number; step?: number;
  onChange: (v: number) => void;
}> = ({ value, min = 0, max, step = 0.1, onChange }) => (
  <input
    type="number" value={value} min={min} max={max} step={step}
    onChange={e => onChange(Math.max(min, parseFloat(e.target.value) || 0))}
    style={{
      background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6,
      padding: '6px 10px', color: '#e2e8f0', fontSize: '0.8rem', width: '100%',
    }}
  />
);

const Toggle: React.FC<{ val: boolean; onChange: () => void; label: string }> = ({ val, onChange, label }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{label}</span>
    <button onClick={onChange} style={{
      width: 36, height: 20, borderRadius: 10, border: 'none', cursor: 'pointer',
      background: val ? '#10b981' : '#334155', position: 'relative', flexShrink: 0,
    }}>
      <div style={{
        width: 16, height: 16, borderRadius: '50%', background: '#fff',
        position: 'absolute', top: 2, left: val ? 18 : 2, transition: 'left 0.15s',
      }} />
    </button>
  </div>
);

// ─── Strategy Preview ─────────────────────────────────────────────────────────

const StrategyPreview: React.FC<{ cfg: BotSkillConfig }> = ({ cfg }) => {
  const rr = cfg.stopLossPct > 0 ? (cfg.takeProfitPct / cfg.stopLossPct).toFixed(1) : '∞';
  const marginPct = cfg.orderPct;
  const effectivePnlTP = cfg.takeProfitPct * cfg.leverage;
  const effectivePnlSL = cfg.stopLossPct * cfg.leverage;

  return (
    <div style={{
      background: '#080d1a', border: '1px solid #1e293b', borderRadius: 10,
      padding: 14, display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
        📋 Strategy preview
      </div>

      {/* Signal box */}
      <div style={{ background: '#0a1020', borderRadius: 8, padding: '10px 12px', border: '1px solid #1e293b' }}>
        <div style={{ fontSize: '0.68rem', color: '#64748b', marginBottom: 4 }}>📡 ENTRY SIGNAL</div>
        <div style={{ fontSize: '0.78rem', color: '#00d4ff', fontWeight: 600 }}>{SIGNAL_LABELS[cfg.signal]}</div>
        <div style={{ fontSize: '0.68rem', color: '#475569', marginTop: 4 }}>{SIGNAL_DESC[cfg.signal]}</div>
        <div style={{ marginTop: 6, fontSize: '0.72rem', color: '#94a3b8' }}>
          Direction: <span style={{ color: '#f59e0b', fontWeight: 600 }}>{DIRECTION_LABELS[cfg.direction]}</span>
        </div>
      </div>

      {/* Risk/reward */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{ background: 'rgba(34,197,94,0.08)', borderRadius: 8, padding: '8px 10px', border: '1px solid rgba(34,197,94,0.2)' }}>
          <div style={{ fontSize: '0.65rem', color: '#64748b' }}>Take Profit</div>
          <div style={{ fontSize: '0.85rem', color: '#22c55e', fontWeight: 700 }}>+{cfg.takeProfitPct}%</div>
          <div style={{ fontSize: '0.65rem', color: '#475569' }}>≈ +{effectivePnlTP.toFixed(1)}% margin</div>
        </div>
        <div style={{ background: 'rgba(239,68,68,0.08)', borderRadius: 8, padding: '8px 10px', border: '1px solid rgba(239,68,68,0.2)' }}>
          <div style={{ fontSize: '0.65rem', color: '#64748b' }}>Stop Loss</div>
          <div style={{ fontSize: '0.85rem', color: '#ef4444', fontWeight: 700 }}>-{cfg.stopLossPct}%</div>
          <div style={{ fontSize: '0.65rem', color: '#475569' }}>≈ -{effectivePnlSL.toFixed(1)}% margin</div>
        </div>
      </div>

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 8 }}>
        {[
          { label: 'R:R Ratio', val: `1 : ${rr}`, c: parseFloat(rr) >= 2 ? '#10b981' : '#f59e0b' },
          { label: 'Leverage', val: `${cfg.leverage}x`, c: '#00d4ff' },
          { label: 'Capital/Trade', val: `${marginPct}%`, c: '#a78bfa' },
        ].map(s => (
          <div key={s.label} style={{ flex: 1, textAlign: 'center', background: '#0a1020', borderRadius: 7, padding: '6px 4px', border: '1px solid #1e293b' }}>
            <div style={{ fontSize: '0.6rem', color: '#475569' }}>{s.label}</div>
            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: s.c }}>{s.val}</div>
          </div>
        ))}
      </div>

      {cfg.enableTrailing && (
        <div style={{ fontSize: '0.7rem', color: '#00d4ff', background: 'rgba(77,162,255,0.05)', borderRadius: 6, padding: '6px 10px', border: '1px solid rgba(77,162,255,0.15)' }}>
          🔄 Trailing Stop {cfg.trailingStopPct}% — moves SL automatically with price
        </div>
      )}
    </div>
  );
};

// ─── Skill Card ───────────────────────────────────────────────────────────────

const SkillCard: React.FC<{
  skill: BotSkillConfig;
  onEdit: () => void;
  onDelete: () => void;
  onBacktest: () => void;
  onPublish: () => void;
  isPublishing: boolean;
}> = ({ skill, onEdit, onDelete, onBacktest, onPublish, isPublishing }) => {
  const s = skill.lastStats;
  return (
    <div style={{
      background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 12, padding: 14,
      display: 'flex', flexDirection: 'column', gap: 10,
      transition: 'border-color 0.15s',
    }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = '#334155')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = '#1e293b')}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e2e8f0' }}>🤖 {skill.name}</div>
          <div style={{ fontSize: '0.7rem', color: '#475569', marginTop: 2 }}>{skill.description}</div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={onEdit}
            style={{ padding: '4px 8px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: '0.68rem', cursor: 'pointer' }}>
            ✏️
          </button>
          <button onClick={onDelete}
            style={{ padding: '4px 8px', borderRadius: 5, border: '1px solid #ef444433', background: 'transparent', color: '#ef4444', fontSize: '0.68rem', cursor: 'pointer' }}>
            🗑️
          </button>
        </div>
      </div>

      {/* Config badges */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {[
          SIGNAL_LABELS[skill.signal],
          DIRECTION_LABELS[skill.direction],
          `${skill.leverage}x`,
          `TP ${skill.takeProfitPct}% / SL ${skill.stopLossPct}%`,
        ].map(t => (
          <span key={t} style={{ fontSize: '0.62rem', background: '#1e293b', color: '#94a3b8', padding: '2px 7px', borderRadius: 4 }}>{t}</span>
        ))}
      </div>

      {/* Backtest stats */}
      {s ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
          {[
            { l: 'Net P&L', v: `${s.netProfitPct > 0 ? '+' : ''}${s.netProfitPct}%`, c: s.netProfitPct >= 0 ? '#22c55e' : '#ef4444' },
            { l: 'Win Rate', v: `${s.winRate}%`, c: s.winRate >= 50 ? '#22c55e' : '#f59e0b' },
            { l: 'P.Factor', v: s.profitFactor, c: s.profitFactor >= 1.5 ? '#10b981' : '#f59e0b' },
            { l: 'Drawdown', v: `${s.maxDrawdownPct}%`, c: s.maxDrawdownPct <= 15 ? '#10b981' : '#ef4444' },
          ].map(x => (
            <div key={x.l} style={{ textAlign: 'center', background: '#080d1a', borderRadius: 6, padding: '5px 4px' }}>
              <div style={{ fontSize: '0.58rem', color: '#475569' }}>{x.l}</div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, color: x.c, fontFamily: 'monospace' }}>{x.v}</div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: '0.68rem', color: '#334155', fontStyle: 'italic' }}>No backtest results yet</div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button onClick={onBacktest} style={{
          flex: 1, padding: '8px', borderRadius: 7, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
          color: '#fff', fontWeight: 700, fontSize: '0.75rem',
        }}>
          ⚡ Backtest
        </button>
        <button onClick={onPublish} disabled={isPublishing} style={{
          flex: 1, padding: '8px', borderRadius: 7, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg, #10b981, #059669)',
          color: '#fff', fontWeight: 700, fontSize: '0.75rem',
        }}>
          {isPublishing ? '⏳ Publishing...' : '🚀 Publish'}
        </button>
      </div>
    </div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props {
  onRequestBacktest?: (skill: BotSkillConfig) => void; // callback để navigate sang backtest
}

export const BotSkillBuilder: React.FC<Props> = ({ onRequestBacktest }) => {
  const [skills,     setSkills]    = useState<BotSkillConfig[]>([]);
  const [editing,    setEditing]   = useState<BotSkillConfig | null>(null);
  const [showForm,   setShowForm]  = useState(false);
  const [saving,     setSaving]    = useState(false);
  const [saved,      setSaved]     = useState(false);
  const [tab,        setTab]       = useState<'list' | 'form'>('list');
  const [codeView,   setCodeView]  = useState<'skill' | 'index' | null>(null);

  const { mutate: signAndExecuteTransaction } = useSignAndExecuteTransaction();
  const [publishing, setPublishing] = useState<string | null>(null);

  useEffect(() => { setSkills(loadBotSkills()); }, []);

  const handleNew = () => {
    setEditing(defaultConfig());
    setTab('form');
    setShowForm(true);
    setSaved(false);
  };

  const handleEdit = (skill: BotSkillConfig) => {
    setEditing({ ...skill });
    setTab('form');
    setShowForm(true);
    setSaved(false);
  };

  const handlePublish = async (skill: BotSkillConfig, priceInSui: number) => {
    setPublishing(skill.name);
    try {
      const payload: any = {
        name: skill.name,
        description: skill.description || 'Bot Skill',
        type: 'bot',
        version: '1.0.0',
        source: 'suirobo-factory',
        files: {
          'SKILL.md': generateSkillMd(skill),
          'index.js': generateIndexJs(skill)
        }
      };

      const res = await fetch('https://publisher.walrus-testnet.walrus.space/v1/store?epochs=5', {
        method: 'PUT',
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        const blobId = data.newlyCreated?.blobObject?.blobId || data.alreadyCertified?.blobId;
        
        const tx = new Transaction();
        tx.moveCall({
          target: '0xb54499501253333c25eadc6fe17def9cb6cfb5af81f265e9f9b0536ec92813bc::suirobo_factory::publish_skill',
          arguments: [
            tx.pure.string(skill.name),
            tx.pure.string(skill.description || 'Skill on Walrus'),
            tx.pure.string(blobId),
            tx.pure.string('1.0.0'),
            tx.pure.u64(priceInSui * 1000000000)
          ]
        });

        signAndExecuteTransaction({ transaction: tx }, {
          onSuccess: (result) => {
            alert(`🎉 Published to the Suirobo marketplace (mainnet) & Walrus!\nBlob ID: ${blobId}\nTx: ${result.digest}`);
            setPublishing(null);
          },
          onError: (e) => {
            alert('Error writing to the Sui chain: ' + e.message);
            setPublishing(null);
          }
        });
        return; 
      } else {
        alert('Error uploading to Walrus. Please try again.');
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
    setPublishing(null);
  };

  const handleSave = async () => {
    if (!editing || !editing.name.trim()) return;
    setSaving(true);

    const skill: BotSkillConfig = {
      ...editing,
      name: editing.name.replace(/\s+/g, '_').toLowerCase(),
      version: '1.0.0',
      createdAt: editing.createdAt || new Date().toISOString().split('T')[0],
    };

    // 1. Save localStorage
    const updated = upsertBotSkill(skill);
    setSkills(updated);

    // 2. Save server (SKILL.md + index.js)
    try {
      await fetch(`${AGENT_URL}/api/skills/bot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: skill.name,
          config: skill,
          skill_md: generateSkillMd(skill),
          index_js: generateIndexJs(skill),
        }),
      });
    } catch { /* server offline — đã lưu localStorage rồi */ }

    setSaving(false);
    setSaved(true);
    setTimeout(() => { setShowForm(false); setTab('list'); setSaved(false); }, 800);
  };

  const handleDelete = (name: string) => {
    if (!confirm(`Delete bot skill "${name}"?`)) return;
    setSkills(deleteBotSkill(name));
    fetch(`${AGENT_URL}/api/skills/bot/${name}`, { method: 'DELETE' }).catch(() => {});
  };

  const update = (key: keyof BotSkillConfig, val: any) => {
    setEditing(prev => prev ? { ...prev, [key]: val } : prev);
  };

  const inputStyle = {
    background: '#0f172a', border: '1px solid #1e293b', borderRadius: 6,
    padding: '6px 10px', color: '#e2e8f0', fontSize: '0.8rem', width: '100%',
    boxSizing: 'border-box' as const,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* ── Header bar ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '12px 0', borderBottom: '1px solid #1e293b', marginBottom: 16,
      }}>
        <div>
          <h4 style={{ margin: 0, color: '#e2e8f0', fontSize: '0.95rem', fontWeight: 800 }}>
            🤖 Bot Skill Builder
          </h4>
          <p style={{ margin: '3px 0 0', fontSize: '0.72rem', color: '#475569' }}>
            Build custom Buy/Sell/TP/SL strategies · Backtest instantly · Deploy to Agent
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {showForm && (
            <button onClick={() => { setShowForm(false); setTab('list'); }}
              style={{ padding: '8px 14px', borderRadius: 7, border: '1px solid #334155', background: 'transparent', color: '#94a3b8', fontSize: '0.8rem', cursor: 'pointer' }}>
              ← List
            </button>
          )}
          <button onClick={handleNew} style={{
            padding: '8px 16px', borderRadius: 7, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, #10b981, #059669)',
            color: '#fff', fontWeight: 700, fontSize: '0.8rem',
          }}>
            + Create New Bot Skill
          </button>
        </div>
      </div>

      {/* ── LIST view ── */}
      {!showForm && (
        <>
          {/* ── AI Research Presets ── */}
          <div style={{ marginBottom: 20 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
            }}>
              <span style={{ fontSize: '0.68rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>
                🔬 AI-Researched Presets
              </span>
              <span style={{ fontSize: '0.6rem', color: '#334155', background: '#0f172a', border: '1px solid #1e293b', borderRadius: 4, padding: '1px 6px' }}>
                10,080 combos tested · Jan–Jun 2025 SUI data
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
              {PRESET_SKILLS.map(preset => {
                const s = preset.lastStats!;
                const alreadySaved = skills.some(sk => sk.name === preset.name);
                return (
                  <div key={preset.name} style={{
                    background: 'linear-gradient(135deg, #060f1e, #0a0f1d)',
                    border: '1px solid rgba(77,162,255,0.2)',
                    borderRadius: 12, padding: 14,
                    display: 'flex', flexDirection: 'column', gap: 10,
                    position: 'relative', overflow: 'hidden',
                  }}>
                    {/* Glow accent */}
                    <div style={{
                      position: 'absolute', top: 0, left: 0, right: 0, height: 2,
                      background: 'linear-gradient(90deg, #00d4ff, #6366f1)',
                    }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#00d4ff' }}>
                          🤖 {preset.name}
                        </div>
                        <div style={{ fontSize: '0.63rem', color: '#475569', marginTop: 3, lineHeight: 1.4 }}>
                          {preset.description}
                        </div>
                      </div>
                      <span style={{
                        fontSize: '0.58rem', padding: '2px 6px', borderRadius: 4,
                        background: 'rgba(77,162,255,0.1)', color: '#00d4ff', border: '1px solid rgba(77,162,255,0.2)',
                        whiteSpace: 'nowrap', flexShrink: 0, marginLeft: 6,
                      }}>AI Pick</span>
                    </div>

                    {/* Stat row */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5 }}>
                      {[
                        { l: '6m Profit', v: `+${s.netProfitPct}%`, c: '#22c55e' },
                        { l: 'Max DD', v: `${s.maxDrawdownPct}%`, c: s.maxDrawdownPct <= 15 ? '#10b981' : '#f59e0b' },
                        { l: 'Win Rate', v: `${s.winRate}%`, c: '#94a3b8' },
                        { l: 'P.Factor', v: `${s.profitFactor}`, c: '#a78bfa' },
                      ].map(x => (
                        <div key={x.l} style={{ textAlign: 'center', background: '#080d1a', borderRadius: 6, padding: '4px 3px' }}>
                          <div style={{ fontSize: '0.55rem', color: '#475569' }}>{x.l}</div>
                          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: x.c, fontFamily: 'monospace' }}>{x.v}</div>
                        </div>
                      ))}
                    </div>

                    {/* Config badges */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {[
                        SIGNAL_LABELS[preset.signal],
                        `${preset.preferredTimeframe} · ${preset.leverage}x`,
                        `TP ${preset.takeProfitPct}% / SL ${preset.stopLossPct}%`,
                        DIRECTION_LABELS[preset.direction],
                      ].map(t => (
                        <span key={t} style={{ fontSize: '0.6rem', background: '#1e293b', color: '#64748b', padding: '2px 6px', borderRadius: 4 }}>{t}</span>
                      ))}
                    </div>

                    {/* Monthly: every month positive badge */}
                    <div style={{ fontSize: '0.62rem', color: '#22c55e', background: 'rgba(34,197,94,0.07)', borderRadius: 5, padding: '4px 8px', border: '1px solid rgba(34,197,94,0.15)' }}>
                      ✅ Every month profitable · Jan Feb Mar Apr May Jun 2025
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        onClick={() => {
                          const skill = { ...preset };
                          upsertBotSkill(skill);
                          setSkills(loadBotSkills());
                        }}
                        style={{
                          flex: 1, padding: '7px', borderRadius: 7, cursor: 'pointer',
                          background: alreadySaved ? '#1e293b' : 'linear-gradient(135deg,#00d4ff22,#6366f122)',
                          color: alreadySaved ? '#475569' : '#00d4ff',
                          border: `1px solid ${alreadySaved ? '#1e293b' : 'rgba(77,162,255,0.3)'}`,
                          fontSize: '0.72rem', fontWeight: 700,
                        }}>
                        {alreadySaved ? '✓ Saved' : '＋ Add to My Skills'}
                      </button>
                      <button
                        onClick={() => onRequestBacktest?.(preset)}
                        style={{
                          flex: 1, padding: '7px', borderRadius: 7, border: 'none', cursor: 'pointer',
                          background: 'linear-gradient(135deg,#6366f1,#4f46e5)',
                          color: '#fff', fontSize: '0.72rem', fontWeight: 700,
                        }}>
                        ⚡ Backtest Now
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Divider */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1, height: 1, background: '#1e293b' }} />
            <span style={{ fontSize: '0.65rem', color: '#334155', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>My Bot Skills</span>
            <div style={{ flex: 1, height: 1, background: '#1e293b' }} />
          </div>

          {skills.length === 0 ? (
            <div style={{
              textAlign: 'center', padding: '48px 24px', color: '#334155',
              border: '2px dashed #1e293b', borderRadius: 12,
            }}>
              <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>🤖</div>
              <div style={{ fontWeight: 700, color: '#475569' }}>No Bot Skill yet</div>
              <div style={{ fontSize: '0.8rem', marginTop: 6 }}>Click "Create New Bot Skill" or add a preset above</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
              {skills.map(s => (
                <SkillCard
                  key={s.name}
                  skill={s}
                  onEdit={() => handleEdit(s)}
                  onDelete={() => handleDelete(s.name)}
                  onBacktest={() => onRequestBacktest?.(s)}
                  onPublish={() => {
                    const priceStr = window.prompt(
                      'Set skill price in SUI:\n\n' +
                      '  • Enter 0 to publish for free\n' +
                      '  • Or any positive amount (e.g. 1.5)\n\n' +
                      'On sale, the marketplace takes 20% and you receive 80%.',
                      '0'
                    );
                    if (priceStr === null) return;
                    const price = parseFloat(priceStr);
                    if (isNaN(price) || price < 0) {
                      alert('Invalid price. Enter 0 for free or any positive number.');
                      return;
                    }
                    handlePublish(s, price);
                  }}
                  isPublishing={publishing === s.name}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ── FORM view ── */}
      {showForm && editing && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

          {/* ── Left: Form ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* Basic info */}
            <section style={{ background: '#0a0f1d', borderRadius: 10, padding: 14, border: '1px solid #1e293b' }}>
              <div style={{ fontSize: '0.68rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>📝 Basic info</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Field label="Bot Skill Name *" hint="Lowercase with underscores (e.g. ema_scalp_v1)">
                  <input value={editing.name} onChange={e => update('name', e.target.value)}
                    placeholder="ema_scalp_v1" style={inputStyle} />
                </Field>
                <Field label="Description">
                  <textarea value={editing.description} onChange={e => update('description', e.target.value)}
                    placeholder="Describe your strategy..." rows={2}
                    style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
                </Field>
              </div>
            </section>

            {/* Signal */}
            <section style={{ background: '#0a0f1d', borderRadius: 10, padding: 14, border: '1px solid #1e293b' }}>
              <div style={{ fontSize: '0.68rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>📡 Entry signal</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Field label="Signal Type">
                  <select value={editing.signal} onChange={e => update('signal', e.target.value as IndicatorType)}
                    style={{ ...inputStyle, cursor: 'pointer' }}>
                    {SIGNALS.map(s => <option key={s} value={s}>{SIGNAL_LABELS[s]}</option>)}
                  </select>
                </Field>
                <div style={{ fontSize: '0.7rem', color: '#00d4ff', background: 'rgba(77,162,255,0.05)', borderRadius: 6, padding: '8px 10px', border: '1px solid rgba(77,162,255,0.1)' }}>
                  💡 {SIGNAL_DESC[editing.signal]}
                </div>
                <Field label="MTF trend filter (HTF Supertrend)" hint="Off = trade both ways · On: HTF green = buys only, red = sells only">
                  <select value={editing.htfMinutes ?? 0} onChange={e => update('htfMinutes', parseInt(e.target.value) || undefined)}
                    style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value={0}>Off</option>
                    <option value={60}>H1 filter</option>
                    <option value={240}>H4 filter</option>
                    <option value={1440}>D1 filter</option>
                  </select>
                </Field>
                {!!editing.htfMinutes && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Field label="HTF ATR period" hint="default 10">
                      <NumberInput value={editing.htfSupertrendPeriod ?? 10} min={5} step={1}
                        onChange={v => update('htfSupertrendPeriod', Math.max(5, Math.round(v)))} />
                    </Field>
                    <Field label="HTF ATR multiplier" hint="default 3">
                      <NumberInput value={editing.htfSupertrendMult ?? 3} min={1} step={0.5}
                        onChange={v => update('htfSupertrendMult', v)} />
                    </Field>
                  </div>
                )}
                {editing.signal === 'range_breakout' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Field label="Breakout period (bars)" hint="EA input · prior N-bar high/low (default 20)">
                      <NumberInput value={editing.breakoutPeriod ?? 20} min={5} step={1}
                        onChange={v => update('breakoutPeriod', Math.max(5, Math.round(v)))} />
                    </Field>
                    <Field label="Time-stop (bars)" hint="0 = off · force-close stale trades (anti-fakeout)">
                      <NumberInput value={editing.maxBarsInTrade ?? 0} min={0} step={1}
                        onChange={v => update('maxBarsInTrade', Math.max(0, Math.round(v)))} />
                    </Field>
                  </div>
                )}
                {editing.signal.startsWith('supertrend') && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <Field label="ATR period" hint="EA input · higher = fewer flips (default 10)">
                      <NumberInput value={editing.supertrendPeriod ?? 10} min={5} step={1}
                        onChange={v => update('supertrendPeriod', Math.max(5, Math.round(v)))} />
                    </Field>
                    <Field label="ATR multiplier" hint="EA input · wider band = fewer whipsaws (default 3)">
                      <NumberInput value={editing.supertrendMult ?? 3} min={1} step={0.5}
                        onChange={v => update('supertrendMult', v)} />
                    </Field>
                  </div>
                )}
                <Field label="Trade Direction">
                  <div style={{ display: 'flex', gap: 6 }}>
                    {(['both', 'long_only', 'short_only'] as const).map(d => (
                      <button key={d} onClick={() => update('direction', d)} style={{
                        flex: 1, padding: '6px 4px', borderRadius: 6, border: `1px solid ${editing.direction === d ? '#6366f1' : '#1e293b'}`,
                        background: editing.direction === d ? 'rgba(99,102,241,0.15)' : 'transparent',
                        color: editing.direction === d ? '#818cf8' : '#475569', fontSize: '0.65rem', cursor: 'pointer', fontWeight: 600,
                      }}>
                        {d === 'both' ? '↕ Both' : d === 'long_only' ? '↑ Long only' : '↓ Short only'}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
            </section>

            {/* Risk Management */}
            <section style={{ background: '#0a0f1d', borderRadius: 10, padding: 14, border: '1px solid #1e293b' }}>
              <div style={{ fontSize: '0.68rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>🛡️ Risk management</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <Toggle val={editing.enableDefense} onChange={() => update('enableDefense', !editing.enableDefense)} label="Enable TP / SL / Liquidation Guard" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field label="Take Profit (%)">
                    <NumberInput value={editing.takeProfitPct} min={0.5} onChange={v => update('takeProfitPct', v)} />
                  </Field>
                  <Field label="Stop Loss (%)">
                    <NumberInput value={editing.stopLossPct} min={0.5} onChange={v => update('stopLossPct', v)} />
                  </Field>
                </div>
                <Toggle val={editing.enableTrailing} onChange={() => update('enableTrailing', !editing.enableTrailing)} label="Trailing Stop" />
                {editing.enableTrailing && (
                  <Field label="Trailing Stop (%)" hint="Distance from peak/trough">
                    <NumberInput value={editing.trailingStopPct} min={0.1} onChange={v => update('trailingStopPct', v)} />
                  </Field>
                )}
              </div>
            </section>

            {/* Capital */}
            <section style={{ background: '#0a0f1d', borderRadius: 10, padding: 14, border: '1px solid #1e293b' }}>
              <div style={{ fontSize: '0.68rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>💰 Capital & Leverage</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Leverage (x)">
                  <select value={editing.leverage} onChange={e => update('leverage', parseInt(e.target.value))}
                    style={{ ...inputStyle, cursor: 'pointer' }}>
                    {[1,2,3,5,10,20].map(v => <option key={v} value={v}>{v}x{v === 1 ? ' (Spot)' : ''}</option>)}
                  </select>
                </Field>
                <Field label="Order Size (% capital)">
                  <select value={editing.orderPct} onChange={e => update('orderPct', parseInt(e.target.value))}
                    style={{ ...inputStyle, cursor: 'pointer' }}>
                    {[25,50,75,100].map(v => <option key={v} value={v}>{v}%</option>)}
                  </select>
                </Field>
                <Field label="Fee (% per side)" hint="DeepTrade/Binance ≈ 0.01%">
                  <NumberInput value={editing.commission} min={0} step={0.01} onChange={v => update('commission', v)} />
                </Field>
              </div>
            </section>

            {/* EA money management (MT4/MT5-style, optional) */}
            <section style={{ background: '#0a0f1d', borderRadius: 10, padding: 14, border: '1px solid #1e293b' }}>
              <div style={{ fontSize: '0.68rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>🎛 EA money management</div>
              <div style={{ fontSize: '0.65rem', color: '#475569', marginBottom: 10 }}>
                MT4/MT5-style risk module. Applies identically in Backtest and Live Trade. Leave at 0 / defaults to disable.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <Field label="Position sizing" hint="risk % sizes so an SL hit loses exactly Risk%">
                  <select value={editing.sizingMode || 'fixed_pct'} onChange={e => update('sizingMode', e.target.value as any)}
                    style={{ ...inputStyle, cursor: 'pointer' }}>
                    <option value="fixed_pct">Fixed % of capital</option>
                    <option value="risk_pct">Risk % per trade (EA)</option>
                  </select>
                </Field>
                {(editing.sizingMode === 'risk_pct') && (
                  <Field label="Risk per trade (%)">
                    <NumberInput value={editing.riskPct ?? 1} min={0.1} step={0.1} onChange={v => update('riskPct', v)} />
                  </Field>
                )}
                <Field label="Breakeven trigger (%)" hint="0 = off · SL jumps to entry after +X%">
                  <NumberInput value={editing.breakEvenTriggerPct ?? 0} min={0} step={0.1} onChange={v => update('breakEvenTriggerPct', v)} />
                </Field>
                <Field label="Cooldown (bars)" hint="0 = off · wait after each closed trade">
                  <NumberInput value={editing.cooldownBars ?? 0} min={0} step={1} onChange={v => update('cooldownBars', Math.round(v))} />
                </Field>
                <Field label="Max consecutive losses" hint="0 = off · pause entries after N losses">
                  <NumberInput value={editing.maxConsecLosses ?? 0} min={0} step={1} onChange={v => update('maxConsecLosses', Math.round(v))} />
                </Field>
                <Field label="Daily loss limit (%)" hint="0 = off · stop entering for the day">
                  <NumberInput value={editing.maxDailyLossPct ?? 0} min={0} step={0.5} onChange={v => update('maxDailyLossPct', v)} />
                </Field>
                <Field label="Session start (UTC h)" hint="equal to end = 24/7">
                  <NumberInput value={editing.sessionStartHour ?? 0} min={0} step={1} onChange={v => update('sessionStartHour', Math.max(0, Math.min(23, Math.round(v))))} />
                </Field>
                <Field label="Session end (UTC h)">
                  <NumberInput value={editing.sessionEndHour ?? 0} min={0} step={1} onChange={v => update('sessionEndHour', Math.max(0, Math.min(23, Math.round(v))))} />
                </Field>
                <Field label="Slippage (%)" hint="backtest realism on entries + stops">
                  <NumberInput value={editing.slippagePct ?? 0} min={0} step={0.01} onChange={v => update('slippagePct', v)} />
                </Field>
              </div>
            </section>

            {/* Code Preview toggle */}
            <div style={{ display: 'flex', gap: 6 }}>
              {(['skill', 'index'] as const).map(t => (
                <button key={t} onClick={() => setCodeView(codeView === t ? null : t)} style={{
                  flex: 1, padding: '6px', borderRadius: 6, border: `1px solid ${codeView === t ? '#334155' : '#1e293b'}`,
                  background: codeView === t ? '#1e293b' : 'transparent',
                  color: '#64748b', fontSize: '0.7rem', cursor: 'pointer',
                }}>
                  {t === 'skill' ? '📄 SKILL.md' : '⚡ index.js'}
                </button>
              ))}
            </div>

            {codeView && (
              <pre style={{
                background: '#030712', borderRadius: 8, padding: 12, border: '1px solid #1e293b',
                fontSize: '0.65rem', color: '#64748b', overflow: 'auto', maxHeight: 200,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
              }}>
                {codeView === 'skill' ? generateSkillMd(editing) : generateIndexJs(editing)}
              </pre>
            )}

            {/* Save button */}
            <button onClick={handleSave} disabled={saving || !editing.name.trim()} style={{
              padding: '12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: '0.9rem',
              background: saved
                ? 'linear-gradient(135deg,#22c55e,#16a34a)'
                : editing.name.trim()
                ? 'linear-gradient(135deg,#10b981,#059669)'
                : '#1e293b',
              color: '#fff',
            }}>
              {saving ? '⏳ Saving…' : saved ? '✅ Saved!' : '💾 Save Bot Skill'}
            </button>
          </div>

          {/* ── Right: Preview ── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <StrategyPreview cfg={editing} />

            {/* Quick action after save */}
            {saved && editing && (
              <button onClick={() => onRequestBacktest?.({ ...editing, name: editing.name.replace(/\s+/g, '_').toLowerCase() })}
                style={{
                  padding: '12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
                  background: 'linear-gradient(135deg,#6366f1,#4f46e5)', color: '#fff',
                  animation: 'fadeIn 0.3s',
                }}>
                ⚡ Backtest this skill now →
              </button>
            )}

            {/* Info box */}
            <div style={{ background: '#080d1a', borderRadius: 10, padding: 14, border: '1px solid #1e293b', fontSize: '0.72rem', color: '#475569', lineHeight: 1.7 }}>
              <div style={{ color: '#64748b', fontWeight: 700, marginBottom: 8 }}>ℹ️ About Bot Skills</div>
              <div>✅ <strong style={{ color: '#94a3b8' }}>Backtest</strong> — Use the Engine to test against BTC 2025 history</div>
              <div>✅ <strong style={{ color: '#94a3b8' }}>Live Agent</strong> — Deploy to the Agent for live trading</div>
              <div>✅ <strong style={{ color: '#94a3b8' }}>Marketplace</strong> — publish to Walrus & sell to other users</div>
              <div style={{ marginTop: 8, color: '#334155' }}>Auto-generated files: SKILL.md + index.js (ADK FunctionTool)</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
