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

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
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
      n: '1', title: 'Download Autobots Desktop',
      desc: 'The free desktop app that holds your keys on your own machine and runs bots 24/7. Nothing touches our servers.',
      cta: 'Download desktop', action: () => setShowDownload(true),
    },
    {
      n: '2', title: 'Pick an Auto Bot',
      desc: 'Backtested Auto Bots from the marketplace, source verified on Walrus. Most are free.',
      cta: 'Browse Auto Bots', action: () => onNavigate?.('factory'),
    },
    {
      n: '3', title: 'Fund and start',
      desc: 'Deposit 10 USDC into your margin pool and press Start. The bot trades 24/7 with TP/SL.',
      cta: 'Open Live Trade', action: () => onNavigate?.('livetrade'),
    },
  ];

  const topSkills = [
    { name: 'SUI MTF Supertrend M5', desc: 'H4 Supertrend gates direction; M5 Supertrend-flip entries with a trailing runner (no TP cap). ~+5.4%/mo avg, Mar–Sep 2025.', tag: 'MTF' },
    { name: 'SUI Supertrend M5', desc: 'Classic Supertrend-flip EA, short-side, US session, TP3 / SL1.5. Profitable every month Jan–May 2026 on real M5 data.', tag: 'Recommended' },
    { name: 'BTC Breakout M15', desc: 'Donchian range-breakout EA, Asia session, 2% risk-per-trade. +45.9% over full-year 2025 on real BTC M15 data.', tag: 'Breakout' },
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
            Connect your wallet and trade right away, or run the Web Bot — you sign each trade. For hands-off 24/7
            automation, the <em style={{ fontStyle: 'normal', color: '#cbd5e1' }}>Autobots Desktop</em> app runs bots on your
            own machine — your key never leaves your device, and every Auto Bot's source is verifiable on Walrus.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button onClick={() => onNavigate?.('livetrade')} style={{
              padding: '13px 26px', borderRadius: 11, border: 'none', cursor: 'pointer',
              background: 'var(--sui-blue)', color: 'var(--sui-blue-ink)', fontWeight: 600, fontSize: '0.95rem',
            }}>
              Open Live Trade
            </button>
            <button onClick={() => setShowDownload(true)} style={{
              padding: '13px 26px', borderRadius: 11, cursor: 'pointer',
              background: 'transparent', border: '1px solid var(--sui-blue)', color: 'var(--sui-blue)',
              fontWeight: 600, fontSize: '0.95rem',
            }}>
              Download Autobots Desktop
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
          Desktop app <span style={{ fontFamily: 'monospace', color: '#fff' }}>{agentVersion ? `v${agentVersion}` : '—'}</span>
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
        <h2 style={{ ...heading, fontSize: '1.4rem' }}>Auto Bots to start with</h2>
        <button onClick={() => onNavigate?.('factory')} style={{
          background: 'none', border: 'none', color: 'var(--sui-blue)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500,
        }}>
          View all in Autobots Factory →
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

      {/* ── Why Suirobo ── */}
      <h2 style={{ ...heading, fontSize: '1.4rem', marginBottom: 6 }}>Why Suirobo</h2>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: 18, maxWidth: 760 }}>
        Always-on AI agents burn huge LLM inference costs that quietly eat the profit. Suirobo uses AI where it's
        worth it — research, audit, backtest — then hands execution to lean robots that run 24/7 at near-zero cost.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 18, marginBottom: 44 }}>
        {[
          { icon: '⚡', title: 'Cheaper than always-on AI', desc: 'AI agents design & backtest the strategy once; deterministic robots execute it 24/7 — no endless per-trade API bills draining your returns.' },
          { icon: '🔑', title: 'Self-custody by design', desc: 'Your private key and assets never leave your machine. Suirobo is a tool, not a custodian — no central vault for hackers to target.' },
          { icon: '📊', title: 'Backtested discipline', desc: 'Every strategy is EA-style and rules-based, validated month-by-month on real historical market data before it ever goes live.' },
          { icon: '💰', title: 'A creator economy', desc: 'Publish a winning strategy to the on-chain marketplace and earn a creator fee — 0.005 SUI for every position your bot opens, paid automatically.' },
        ].map(c => (
          <div key={c.title} style={{ ...card, display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: 10 }}>{c.icon}</div>
            <h3 style={{ ...heading, fontSize: '1.02rem', marginBottom: 8 }}>{c.title}</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', lineHeight: 1.55 }}>{c.desc}</p>
          </div>
        ))}
      </div>

      {/* ── Trust footer ── */}
      <div style={{
        borderTop: '1px solid #1e293b', paddingTop: 22, marginBottom: 8,
        display: 'flex', gap: 26, flexWrap: 'wrap', fontSize: '0.8rem', color: 'var(--text-secondary)',
      }}>
        <span>🔑 Self-custody — keys stay on your machine</span>
        <span>🌊 Autobots + Auto Bot source hosted on Walrus</span>
        <span>🧾 Build a bot people trade — earn 0.005 SUI per opened position</span>
      </div>

      <AgentDownloadModal isOpen={showDownload} onClose={() => setShowDownload(false)} />
    </div>
  );
};
