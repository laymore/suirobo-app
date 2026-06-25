/**
 * PreferencesView — single place for desktop app settings.
 *
 * Consolidates the controls that were previously scattered (or implicit):
 *   • Notifications — toggle the native trade alerts (P0 feature) on/off.
 *   • Agent        — connection status + re-check probe.
 *   • Security     — wipe the bot's in-memory key from the agent; re-run Setup.
 *   • About        — app identity + version.
 *
 * Desktop-only (wired behind IS_DESKTOP in the sidebar). AI-free build, so there
 * are no provider/API-key controls here.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { AGENT_URL } from '../../agent/agentUrl';
import { getNotifyEnabled, setNotifyEnabled } from '../../prefs';

interface Props {
  agentOnline: boolean | null;
  onRecheckAgent: () => void;
  onOpenSetup: () => void;
}

const Card: React.FC<{ title: string; desc?: string; children: React.ReactNode }> = ({ title, desc, children }) => (
  <section style={{
    background: '#0a0f1d', border: '1px solid #1e293b', borderRadius: 12,
    padding: 18, display: 'flex', flexDirection: 'column', gap: 12,
  }}>
    <div>
      <h3 style={{ margin: 0, color: '#e2e8f0', fontSize: '0.95rem', fontWeight: 700 }}>{title}</h3>
      {desc && <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.78rem' }}>{desc}</p>}
    </div>
    {children}
  </section>
);

const Toggle: React.FC<{ on: boolean; onChange: (v: boolean) => void }> = ({ on, onChange }) => (
  <button onClick={() => onChange(!on)} style={{
    width: 46, height: 26, borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0,
    background: on ? 'linear-gradient(135deg,#10b981,#059669)' : '#334155',
    position: 'relative', transition: 'background 0.18s',
  }}>
    <span style={{
      position: 'absolute', top: 3, left: on ? 23 : 3, width: 20, height: 20, borderRadius: '50%',
      background: '#fff', transition: 'left 0.18s',
    }} />
  </button>
);

const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>{children}</div>
);

export const PreferencesView: React.FC<Props> = ({ agentOnline, onRecheckAgent, onOpenSetup }) => {
  const [notify, setNotify] = useState(getNotifyEnabled());
  const [version, setVersion] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearedMsg, setClearedMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/agent-manifest.json').then(r => r.json())
      .then(m => setVersion(m?.version ?? null)).catch(() => {});
  }, []);

  const toggleNotify = useCallback((v: boolean) => {
    setNotify(v);
    setNotifyEnabled(v);
    // Asking once here means the OS prompt fires from a Settings click rather than
    // surprising the user mid-trade.
    if (v && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  const clearBotKey = useCallback(async () => {
    if (!window.confirm('Wipe the bot’s trading key from the agent’s memory? The bot will stop until you re-enter it.')) return;
    setClearing(true); setClearedMsg(null);
    try {
      const r = await fetch(`${AGENT_URL}/api/livebot/clearkey`, { method: 'POST' });
      setClearedMsg(r.ok ? '✓ Key wiped from agent memory.' : '✗ Agent did not confirm — is it running?');
    } catch {
      setClearedMsg('✗ Could not reach the agent.');
    } finally {
      setClearing(false);
    }
  }, []);

  const dot = agentOnline ? '#22c55e' : agentOnline === null ? '#64748b' : '#ef4444';
  const dotLabel = agentOnline ? 'Connected' : agentOnline === null ? 'Checking…' : 'Offline';

  const btn = (bg: string, color: string, border = 'none'): React.CSSProperties => ({
    padding: '8px 14px', borderRadius: 8, border: border === 'none' ? 'none' : `1px solid ${border}`,
    background: bg, color, fontWeight: 700, fontSize: '0.78rem', cursor: 'pointer', whiteSpace: 'nowrap',
  });

  return (
    <div style={{ padding: 24, maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ marginBottom: 4 }}>
        <h2 style={{ color: '#fff', fontSize: '1.6rem', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg,#475569,#1e293b)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem',
          }}>⚙️</span>
          Settings
        </h2>
        <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: 0 }}>Preferences for this desktop app. Stored locally on your machine.</p>
      </div>

      <Card title="Notifications" desc="Native desktop alerts when the bot opens or closes a position.">
        <Row>
          <span style={{ color: '#cbd5e1', fontSize: '0.85rem' }}>Trade notifications</span>
          <Toggle on={notify} onChange={toggleNotify} />
        </Row>
      </Card>

      <Card title="Local Agent" desc="The bundled agent that holds your key and signs trades on your machine.">
        <Row>
          <span style={{ display: 'flex', alignItems: 'center', gap: 9, color: '#cbd5e1', fontSize: '0.85rem' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: dot }} />
            {dotLabel}
            <span style={{ color: '#475569', fontFamily: 'monospace', fontSize: '0.72rem' }}>{AGENT_URL}</span>
          </span>
          <button onClick={onRecheckAgent} style={btn('rgba(0,212,255,0.08)', '#00d4ff', '#00d4ff')}>Re-check</button>
        </Row>
      </Card>

      <Card title="Security" desc="Your trading key lives only inside the agent on this machine — never on any server.">
        <Row>
          <span style={{ color: '#cbd5e1', fontSize: '0.85rem' }}>Wipe bot key from agent memory</span>
          <button onClick={clearBotKey} disabled={clearing} style={btn('rgba(239,68,68,0.10)', '#f87171', '#ef444455')}>
            {clearing ? 'Wiping…' : 'Wipe key'}
          </button>
        </Row>
        {clearedMsg && <div style={{ fontSize: '0.76rem', color: clearedMsg.startsWith('✓') ? '#22c55e' : '#f59e0b' }}>{clearedMsg}</div>}
        <Row>
          <span style={{ color: '#cbd5e1', fontSize: '0.85rem' }}>Re-run the setup wizard</span>
          <button onClick={onOpenSetup} style={btn('transparent', '#94a3b8', '#334155')}>Open Setup</button>
        </Row>
      </Card>

      <Card title="About">
        <Row>
          <span style={{ color: '#cbd5e1', fontSize: '0.85rem' }}>Autobots Desktop</span>
          <span style={{ color: '#64748b', fontFamily: 'monospace', fontSize: '0.78rem' }}>{version ? `agent v${version}` : '—'}</span>
        </Row>
        <div style={{ fontSize: '0.74rem', color: '#475569', lineHeight: 1.6 }}>
          Self-custody DeepBook trading bots. Your keys, your machine, deterministic Auto-Bot only.
        </div>
      </Card>
    </div>
  );
};

export default PreferencesView;
