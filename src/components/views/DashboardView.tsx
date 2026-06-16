import React, { useEffect, useState } from 'react';
import type { ViewType } from '../Sidebar';
import { AgentDownloadModal } from '../AgentDownloadModal';
import { LogoMark } from '../Logo';

interface DashboardViewProps {
  onNavigate?: (view: ViewType) => void;
  agentOnline?: boolean | null;
}

interface Ticker { price: number; changePct: number }

const card: React.CSSProperties = {
  background: 'var(--bg-card)', border: '1px solid #1e293b',
  borderRadius: 14, padding: 24,
};

const heading: React.CSSProperties = {
  fontFamily: "'Space Grotesk', Inter, sans-serif", color: '#fff', fontWeight: 600,
};

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate, agentOnline }) => {
  const [showDownload, setShowDownload] = useState(false);
  const [sui, setSui] = useState<Ticker | null>(null);
  const [agentVersion, setAgentVersion] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=SUIUSDT')
        .then(r => r.json())
        .then(d => { if (alive && d?.lastPrice) setSui({ price: +d.lastPrice, changePct: +d.priceChangePercent }); })
        .catch(() => {});
    };
    load();
    const iv = setInterval(load, 30_000);
    fetch('/agent-manifest.json').then(r => r.json()).then(m => { if (alive) setAgentVersion(m?.version ?? null); }).catch(() => {});
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const steps: { n: string; title: string; desc: string; cta: string; action: () => void }[] = [
    {
      n: '1', title: 'Download the agent',
      desc: 'A free local app that holds your keys on your own machine. Nothing touches our servers.',
      cta: 'Download agent', action: () => setShowDownload(true),
    },
    {
      n: '2', title: 'Pick a bot skill',
      desc: 'Backtested strategies from the marketplace, source verified on Walrus. Most are free.',
      cta: 'Browse skills', action: () => onNavigate?.('factory'),
    },
    {
      n: '3', title: 'Fund and start',
      desc: 'Deposit 10 USDC into your margin pool and press Start. The bot trades 24/7 with TP/SL.',
      cta: 'Open Live Trade', action: () => onNavigate?.('livetrade'),
    },
  ];

  const topSkills = [
    { name: 'BB MeanRev M15', desc: 'Bollinger mean-reversion, 15-minute candles. Default pick from our backtest sweep.', tag: 'Recommended' },
    { name: 'SUI Alpha M30', desc: 'RSI + MACD hybrid on 30-minute candles, trend-filtered entries.', tag: 'Hybrid' },
    { name: 'SUI EMA H1', desc: 'EMA crossover on hourly candles. Fewer trades, wider stops.', tag: 'Trend' },
  ];

  const up = (sui?.changePct ?? 0) >= 0;

  return (
    <div style={{ padding: '36px 40px', maxWidth: 1040, margin: '0 auto', color: 'var(--text-primary)' }}>

      {/* ── Hero ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 32, marginBottom: 18, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 420px' }}>
          <h1 style={{ ...heading, fontSize: '2.6rem', lineHeight: 1.15, marginBottom: 14 }}>
            Own your bot.<br />Own your keys.
          </h1>
          <p style={{ fontSize: '1.05rem', color: 'var(--text-secondary)', lineHeight: 1.6, maxWidth: '58ch', marginBottom: 22 }}>
            Suirobo runs automated DeepBook trading bots from an agent on <em style={{ fontStyle: 'normal', color: '#cbd5e1' }}>your</em> computer.
            Your private key never leaves your machine, and every skill's source is verifiable on Walrus.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {agentOnline ? (
              <button onClick={() => onNavigate?.('livetrade')} style={{
                padding: '13px 26px', borderRadius: 11, border: 'none', cursor: 'pointer',
                background: 'var(--sui-blue)', color: 'var(--sui-blue-ink)', fontWeight: 600, fontSize: '0.95rem',
              }}>
                Open Live Trade
              </button>
            ) : (
              <button onClick={() => setShowDownload(true)} style={{
                padding: '13px 26px', borderRadius: 11, border: 'none', cursor: 'pointer',
                background: 'var(--sui-blue)', color: 'var(--sui-blue-ink)', fontWeight: 600, fontSize: '0.95rem',
              }}>
                Download agent (free)
              </button>
            )}
            <button onClick={() => onNavigate?.('factory')} style={{
              padding: '13px 26px', borderRadius: 11, cursor: 'pointer',
              background: 'transparent', border: '1px solid var(--sui-blue)', color: 'var(--sui-blue)',
              fontWeight: 600, fontSize: '0.95rem',
            }}>
              Explore skills
            </button>
          </div>
        </div>
        <div style={{ flex: '0 0 auto', opacity: 0.95 }}>
          <LogoMark size={150} bg="var(--bg-base)" />
        </div>
      </div>

      {/* ── Live stats strip ── */}
      <div style={{
        display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap',
        padding: '14px 20px', borderRadius: 12, background: 'var(--bg-card)', border: '1px solid #1e293b',
        marginBottom: 40, fontSize: '0.85rem',
      }}>
        <span style={{ color: 'var(--text-secondary)' }}>
          SUI/USDT{' '}
          <span style={{ fontFamily: 'monospace', color: '#fff', fontWeight: 600 }}>
            {sui ? `$${sui.price.toFixed(4)}` : '—'}
          </span>{' '}
          {sui && (
            <span style={{ fontFamily: 'monospace', color: up ? 'var(--profit)' : 'var(--loss)' }}>
              {up ? '+' : ''}{sui.changePct.toFixed(2)}%
            </span>
          )}
        </span>
        <span style={{ color: '#1e293b' }}>|</span>
        <span style={{ color: 'var(--text-secondary)' }}>
          Agent <span style={{ fontFamily: 'monospace', color: '#fff' }}>{agentVersion ? `v${agentVersion}` : '—'}</span>
        </span>
        <span style={{ color: '#1e293b' }}>|</span>
        <span style={{ color: 'var(--text-secondary)' }}>Pairs: SUI/USDC margin · xBTC/USDC</span>
        <span style={{ color: '#1e293b' }}>|</span>
        <span style={{ color: 'var(--text-secondary)' }}>Creators earn 0.005 SUI per opened position</span>
      </div>

      {/* ── How it works ── */}
      <h2 style={{ ...heading, fontSize: '1.4rem', marginBottom: 18 }}>How it works</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18, marginBottom: 44 }}>
        {steps.map(s => (
          <div key={s.n} style={{ ...card, display: 'flex', flexDirection: 'column' }}>
            <div style={{
              width: 30, height: 30, borderRadius: '50%', marginBottom: 14,
              background: 'rgba(77,162,255,0.15)', color: 'var(--sui-blue)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: '0.9rem',
            }}>{s.n}</div>
            <h3 style={{ ...heading, fontSize: '1.05rem', marginBottom: 8 }}>{s.title}</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', lineHeight: 1.55, flex: 1, marginBottom: 16 }}>
              {s.desc}
            </p>
            <button onClick={s.action} style={{
              alignSelf: 'flex-start', padding: '8px 16px', borderRadius: 9, cursor: 'pointer',
              background: 'transparent', border: '1px solid #334155', color: '#cbd5e1',
              fontSize: '0.82rem', fontWeight: 500, transition: 'border-color 0.15s, color 0.15s',
            }}
            onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--sui-blue)'; e.currentTarget.style.color = 'var(--sui-blue)'; }}
            onMouseOut={e => { e.currentTarget.style.borderColor = '#334155'; e.currentTarget.style.color = '#cbd5e1'; }}>
              {s.cta} →
            </button>
          </div>
        ))}
      </div>

      {/* ── Top skills ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 18 }}>
        <h2 style={{ ...heading, fontSize: '1.4rem' }}>Bot skills to start with</h2>
        <button onClick={() => onNavigate?.('factory')} style={{
          background: 'none', border: 'none', color: 'var(--sui-blue)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500,
        }}>
          View all in Skill Factory →
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18, marginBottom: 44 }}>
        {topSkills.map(s => (
          <div key={s.name} style={{ ...card, cursor: 'pointer', transition: 'border-color 0.15s' }}
            onClick={() => onNavigate?.('backtest')}
            onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--sui-blue)'; }}
            onMouseOut={e => { e.currentTarget.style.borderColor = '#1e293b'; }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <h3 style={{ ...heading, fontSize: '1rem' }}>{s.name}</h3>
              <span style={{
                fontSize: '0.68rem', fontWeight: 600, padding: '3px 10px', borderRadius: 10,
                background: 'rgba(77,162,255,0.13)', color: 'var(--sui-blue)',
              }}>{s.tag}</span>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.5, marginBottom: 12 }}>{s.desc}</p>
            <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
              Free · backtest before you run it
            </div>
          </div>
        ))}
      </div>

      {/* ── Trust footer ── */}
      <div style={{
        borderTop: '1px solid #1e293b', paddingTop: 22, marginBottom: 8,
        display: 'flex', gap: 26, flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--text-secondary)',
      }}>
        <span>🔑 Self-custody — keys stay on your machine</span>
        <span>🌊 Agent + skills source hosted on Walrus</span>
        <span>🧾 Build a bot people trade — earn 0.005 SUI per opened position</span>
      </div>

      <AgentDownloadModal isOpen={showDownload} onClose={() => setShowDownload(false)} />
    </div>
  );
};
