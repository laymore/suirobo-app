import React, { useState } from 'react';
import { AgentDownloadModal } from './AgentDownloadModal';

/**
 * ClientBotLanding — the "Client Bot" rung on the web app.
 *
 * On the web there is no local agent and no key entry: you connect your Slush
 * wallet and trade (Manual or Web Bot, signing each trade yourself). Fully
 * hands-off 24/7 automation lives only in the full Autobots Desktop app, where
 * your key is entered locally and the bot self-signs. This panel introduces that
 * desktop app and links the download — it does NOT run a bot in the browser.
 */
const FEATURES: { icon: string; title: string; desc: string }[] = [
  { icon: '🔄', title: 'Auto-sign 24/7', desc: 'The bot opens and closes positions on its own, around the clock — no per-trade signing, no babysitting.' },
  { icon: '🔑', title: 'Your key stays local', desc: 'Enter your key once into the desktop app on your own machine. It never leaves your device and never touches a server.' },
  { icon: '🛡️', title: 'Hard safety interlocks', desc: 'Kill-switch + max-daily-loss breaker, liquidation guard, and TP/SL on every position — deterministic, not AI-gated.' },
  { icon: '🧪', title: 'Full pro toolkit', desc: 'Parameter Optimizer, Robustness Lab, anchored walk-forward, and on-chain DeepBook candles + order-book imbalance filter.' },
  { icon: '🌊', title: 'Sui-native execution', desc: 'DeepBook margin + DeepTrade spot, Pyth prices, source verified on Walrus — self-custody end to end.' },
  { icon: '🏪', title: 'Marketplace bots', desc: 'Install backtested Auto Bots from the on-chain marketplace, or publish your own and earn a creator fee.' },
];

export const ClientBotLanding: React.FC = () => {
  const [showDownload, setShowDownload] = useState(false);

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', color: '#e2e8f0' }}>
      {/* Hero */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(0,212,255,0.08), rgba(37,99,235,0.05))',
        border: '1px solid #1e293b', borderRadius: 16, padding: 28, marginBottom: 22,
        display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap',
      }}>
        <div style={{ flex: '1 1 420px' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 800, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            💻 Client Bot · full desktop app
          </div>
          <h2 style={{ fontSize: '1.9rem', fontWeight: 800, color: '#fff', margin: '0 0 12px', lineHeight: 1.2 }}>
            Hands-off 24/7 trading,<br />on your own machine
          </h2>
          <p style={{ fontSize: '0.95rem', color: '#94a3b8', lineHeight: 1.6, maxWidth: '56ch', marginBottom: 20 }}>
            The web app lets you trade manually or run the <strong style={{ color: '#cbd5e1' }}>Web Bot</strong> — you sign each
            trade with your wallet. To let an Auto Bot run on its own around the clock, download the full
            <strong style={{ color: '#cbd5e1' }}> Autobots Desktop app</strong>: your key is entered locally and the bot self-signs.
          </p>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button onClick={() => setShowDownload(true)} style={{
              padding: '13px 26px', borderRadius: 11, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #00d4ff, #2563eb)', color: '#031018', fontWeight: 800, fontSize: '0.95rem',
            }}>
              ⬇ Download Desktop App
            </button>
            <span style={{ alignSelf: 'center', fontSize: '0.78rem', color: '#64748b' }}>
              Free · Windows · keys never leave your device
            </span>
          </div>
        </div>
      </div>

      {/* Feature grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
        {FEATURES.map(f => (
          <div key={f.title} style={{
            background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 12, padding: 18,
          }}>
            <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>{f.icon}</div>
            <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', margin: '0 0 6px' }}>{f.title}</h3>
            <p style={{ fontSize: '0.84rem', color: '#94a3b8', lineHeight: 1.55, margin: 0 }}>{f.desc}</p>
          </div>
        ))}
      </div>

      <div style={{
        marginTop: 20, padding: '14px 18px', borderRadius: 12,
        background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.25)',
        fontSize: '0.85rem', color: '#86efac', lineHeight: 1.55,
      }}>
        💡 Want to trade right now without downloading anything? Switch to <strong>Manual</strong> or <strong>Web Bot</strong> above —
        connect your Slush wallet and go. No key, no install.
      </div>

      <AgentDownloadModal isOpen={showDownload} onClose={() => setShowDownload(false)} />
    </div>
  );
};
