import React, { useEffect, useState } from 'react';
import type { ViewType } from '../Sidebar';
import { AgentDownloadModal } from '../AgentDownloadModal';
import { LogoMark } from '../Logo';

/**
 * Home, designed around the new-user trust ladder (inversion: kill every reason
 * to bounce in the first 60 seconds):
 *   1. Test a strategy  (no wallet, nothing at risk)  ← the ONE primary CTA
 *   2. Trade from your wallet (you sign every trade)
 *   3. Go 24/7 with the desktop app (key stays local)
 * Numbers are real backtest results, jargon gets a plain-language gloss inline,
 * and the fee is stated once, the same way everywhere.
 */

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
  const [appVersion, setAppVersion] = useState<string | null>(null);

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
    fetch('/agent-manifest.json').then(r => r.json()).then(m => { if (alive) setAppVersion(m?.version ?? null); }).catch(() => {});
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // The trust ladder: each step tells the user what they get AND what they risk.
  const steps: { n: string; title: string; risk: string; desc: string; cta: string; action: () => void }[] = [
    {
      n: '1', title: 'Test a strategy', risk: 'Nothing at risk',
      desc: 'Run a real backtest on real market data and see the profit, drawdown, and every trade it would have made. No wallet, no sign-up.',
      cta: 'Test a strategy free', action: () => onNavigate?.('backtest'),
    },
    {
      n: '2', title: 'Trade from your wallet', risk: 'You approve each trade',
      desc: 'Connect your Sui wallet and trade by hand, or let the in-tab bot suggest trades. Nothing happens without your signature.',
      cta: 'Open Live Trade', action: () => onNavigate?.('livetrade'),
    },
    {
      n: '3', title: 'Go fully automatic', risk: 'Key stays on your machine',
      desc: 'The free desktop app runs your bot 24/7 and signs by itself. You enter your key once, locally. It never leaves your computer.',
      cta: 'Download the desktop app', action: () => setShowDownload(true),
    },
  ];

  // Real backtest results, shown as data (not adjectives). Clicking opens the
  // backtester so the user can reproduce the numbers themselves.
  const strategies: {
    name: string; tag: string; blurb: string;
    stats: [string, string, boolean?][];
  }[] = [
    {
      name: 'SUI Supertrend M5', tag: 'Start here',
      blurb: 'Trend-following on SUI, tested month by month on real data.',
      stats: [['Return', '+12.0%', true], ['Period', 'Jan to May 2026'], ['Max drawdown', '12.6%']],
    },
    {
      name: 'SUI MTF Supertrend', tag: 'Trend',
      blurb: 'Two-timeframe trend filter with a trailing exit.',
      stats: [['Avg return', '+5.4%/mo', true], ['Positive months', '6 of 7'], ['Period', 'Mar to Sep 2025']],
    },
    {
      name: 'BTC Breakout M15', tag: 'Breakout',
      blurb: 'Trades BTC range breakouts during the Asian session.',
      stats: [['Return', '+45.9%', true], ['Period', 'Full year 2025'], ['Max drawdown', '15.2%']],
    },
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
            Rule-based trading bots for DeepBook, Sui's on-chain order book. Test any strategy
            on real market data before risking anything, then trade from your own wallet.
            We never hold your funds: there is no deposit address.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <button onClick={() => onNavigate?.('backtest')} style={{
              padding: '13px 26px', borderRadius: 11, border: 'none', cursor: 'pointer',
              background: 'var(--sui-blue)', color: 'var(--sui-blue-ink)', fontWeight: 600, fontSize: '0.95rem',
            }}>
              Test a strategy free
            </button>
            <button onClick={() => setShowDownload(true)} style={{
              padding: '13px 26px', borderRadius: 11, cursor: 'pointer',
              background: 'transparent', border: '1px solid #334155', color: '#cbd5e1',
              fontWeight: 600, fontSize: '0.95rem',
            }}>
              Download the desktop app
            </button>
            <span style={{ fontSize: '0.78rem', color: '#64748b' }}>No wallet needed to try it.</span>
          </div>
        </div>
        <div style={{ flex: '0 0 auto', opacity: 0.95 }}>
          <LogoMark size={150} bg="var(--bg-base)" />
        </div>
      </div>

      {/* ── Live market strip (proof the app is alive, kept lean) ── */}
      <div style={{
        display: 'flex', gap: 28, alignItems: 'center', flexWrap: 'wrap',
        padding: '14px 20px', borderRadius: 12, background: 'var(--bg-card)', border: '1px solid #1e293b',
        marginBottom: 40, fontSize: '0.85rem',
      }}>
        <span style={{ color: 'var(--text-secondary)' }}>
          SUI{' '}
          <span style={{ fontFamily: 'monospace', color: '#fff', fontWeight: 600 }}>
            {sui ? `$${sui.price.toFixed(4)}` : '—'}
          </span>{' '}
          {sui && (
            <span style={{ fontFamily: 'monospace', color: up ? 'var(--profit)' : 'var(--loss)' }}>
              {up ? '+' : ''}{sui.changePct.toFixed(2)}% today
            </span>
          )}
        </span>
        <span style={{ color: '#1e293b' }}>|</span>
        <span style={{ color: 'var(--text-secondary)' }}>Markets: SUI/USDC · BTC/USDC</span>
        <span style={{ color: '#1e293b' }}>|</span>
        <span style={{ color: 'var(--text-secondary)' }}>
          Desktop app <span style={{ fontFamily: 'monospace', color: '#fff' }}>{appVersion ? `v${appVersion}` : '—'}</span>
        </span>
      </div>

      {/* ── The trust ladder (a real ordered sequence: commitment grows per step) ── */}
      <h2 style={{ ...heading, fontSize: '1.4rem', marginBottom: 18 }}>Start with zero risk</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18, marginBottom: 44 }}>
        {steps.map(s => (
          <div key={s.n} style={{ ...card, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
              <div style={{
                width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                background: 'rgba(77,162,255,0.15)', color: 'var(--sui-blue)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: '0.9rem',
              }}>{s.n}</div>
              <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--profit)' }}>{s.risk}</span>
            </div>
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

      {/* ── Strategies with reproducible numbers ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <h2 style={{ ...heading, fontSize: '1.4rem' }}>Strategies to try first</h2>
        <button onClick={() => onNavigate?.('factory')} style={{
          background: 'none', border: 'none', color: 'var(--sui-blue)', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 500,
        }}>
          Browse all strategies →
        </button>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginBottom: 18 }}>
        These numbers come from backtests on real historical data. Click one and run the same test yourself.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18, marginBottom: 44 }}>
        {strategies.map(s => (
          <div key={s.name} style={{ ...card, cursor: 'pointer', transition: 'border-color 0.15s' }}
            onClick={() => onNavigate?.('backtest')}
            onMouseOver={e => { e.currentTarget.style.borderColor = 'var(--sui-blue)'; }}
            onMouseOut={e => { e.currentTarget.style.borderColor = '#1e293b'; }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ ...heading, fontSize: '1rem' }}>{s.name}</h3>
              <span style={{
                fontSize: '0.68rem', fontWeight: 600, padding: '3px 10px', borderRadius: 10,
                background: 'rgba(77,162,255,0.13)', color: 'var(--sui-blue)', whiteSpace: 'nowrap',
              }}>{s.tag}</span>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', lineHeight: 1.5, marginBottom: 14 }}>{s.blurb}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {s.stats.map(([label, value, isProfit]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                  <span style={{ color: '#64748b' }}>{label}</span>
                  <span style={{ fontFamily: 'monospace', fontWeight: 600, color: isProfit ? 'var(--profit)' : '#e2e8f0' }}>{value}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--sui-blue)' }}>
              Free · run this backtest yourself →
            </div>
          </div>
        ))}
      </div>

      {/* ── Trust band: three concrete facts, stated plainly ── */}
      <div style={{
        borderTop: '1px solid #1e293b', paddingTop: 22, marginBottom: 8,
        display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.55,
      }}>
        <span>🔑 <strong style={{ color: '#cbd5e1' }}>Self-custody.</strong> Funds stay in your wallet or your own on-chain margin account. There is no deposit address and we hold no keys.</span>
        <span>📜 <strong style={{ color: '#cbd5e1' }}>Nothing hidden.</strong> Every strategy's source is stored on Walrus, Sui's public storage network, and its results are reproducible in the backtester.</span>
        <span>🧾 <strong style={{ color: '#cbd5e1' }}>One fee.</strong> 0.01 SUI each time a bot opens a trade, half of it paid to the strategy's author. Closing a trade is free.</span>
      </div>

      <AgentDownloadModal isOpen={showDownload} onClose={() => setShowDownload(false)} />
    </div>
  );
};
