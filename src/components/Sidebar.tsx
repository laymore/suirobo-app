import React, { useEffect, useState } from 'react';
import type { ChatSession } from '../hooks/useDeepTradeAgent';
import { AgentDownloadModal } from './AgentDownloadModal';
import { LogoLockup } from './Logo';
import { AGENT_CERT_ACCEPT_URL } from '../agent/agentUrl';
import { useI18n } from '../i18n';

const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';

export type ViewType = 'dashboard' | 'agent' | 'factory' | 'manual' | 'backtest' | 'livetrade';

interface SidebarProps {
  currentView: ViewType;
  onChangeView: (view: ViewType) => void;
  sessions?: ChatSession[];
  currentSessionId?: string | null;
  onCreateNewSession?: () => void;
  onSwitchSession?: (id: string) => void;
  /** agent reachability from useUserConfig: null = checking */
  agentOnline?: boolean | null;
  /** re-run the agent /health probe (after the user accepts the cert) */
  onRecheckAgent?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView, onChangeView, sessions = [], currentSessionId, onCreateNewSession, onSwitchSession,
  agentOnline = null, onRecheckAgent,
}) => {
  const [showDownload, setShowDownload] = useState(false);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [acceptingCert, setAcceptingCert] = useState(false);
  const { t } = useI18n();

  // HTTPS site → HTTP agent is blocked, so we call the agent over HTTPS with a
  // self-signed cert. The browser refuses it until the user opens the cert URL
  // once. Open it, then re-probe a few times so the status flips automatically.
  const handleAcceptCert = () => {
    window.open(AGENT_CERT_ACCEPT_URL, '_blank', 'noopener,noreferrer');
    setAcceptingCert(true);
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      onRecheckAgent?.();
      if (tries >= 12) { clearInterval(iv); setAcceptingCert(false); }
    }, 2500);
  };

  useEffect(() => {
    fetch('/agent-manifest.json')
      .then(r => r.json())
      .then(m => setLatestVersion(m?.version ?? null))
      .catch(() => {});
  }, []);

  // Ordered along the user journey: home → trade → build → test.
  // Manual Trade + AI Assistant are no longer top-level items — they're reached
  // via the Live Trade "Trading Mode" switch (Manual rung / AI Agent rung). The
  // AI chat also stays reachable through the Chat History section below.
  const menuItems: { id: ViewType; icon: string; label: string }[] = [
    { id: 'dashboard', icon: '⌂', label: t('sidebar.nav.dashboard') },
    { id: 'livetrade', icon: '⚡', label: t('sidebar.nav.livetrade') },
    { id: 'factory',   icon: '🏭', label: t('sidebar.nav.factory') },
    { id: 'backtest',  icon: '🧪', label: t('sidebar.nav.backtest') },
  ];

  return (
    <div style={{
      width: '260px',
      backgroundColor: '#0a101d',
      borderRight: '1px solid #1e293b',
      display: 'flex',
      flexDirection: 'column',
      padding: '24px 16px',
    }}>
      <div style={{ marginBottom: 36, paddingLeft: 8 }}>
        <LogoLockup markSize={38} bg="#0a101d" />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, paddingLeft: 8 }}>
          {t('sidebar.mainMenu')}
        </div>

        {menuItems.map(item => {
          const isActive = currentView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onChangeView(item.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '11px 16px', borderRadius: 10,
                backgroundColor: isActive ? 'rgba(77, 162, 255, 0.12)' : 'transparent',
                border: isActive ? '1px solid rgba(77, 162, 255, 0.3)' : '1px solid transparent',
                color: isActive ? 'var(--sui-blue)' : '#94a3b8',
                cursor: 'pointer', transition: 'all 0.2s',
                fontWeight: isActive ? 600 : 400, fontSize: '0.9rem',
                textAlign: 'left'
              }}
              onMouseOver={e => { if (!isActive) e.currentTarget.style.backgroundColor = '#16293F'; }}
              onMouseOut={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              <span style={{ fontSize: '1.1rem', width: 22, textAlign: 'center' }}>{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </div>

      {/* ── Chat History (Recent Chats) ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 24, flex: 1, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingLeft: 8, paddingRight: 8, marginBottom: 8 }}>
          <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>
            {t('sidebar.chatHistory')}
          </div>
          <button
            onClick={() => {
              onCreateNewSession?.();
              onChangeView('agent');
            }}
            style={{
              background: 'transparent', border: '1px solid #334155', borderRadius: 12,
              padding: '4px 8px', color: '#e2e8f0', fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer'
            }}
          >
            {t('sidebar.newChat')}
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {sessions.map(s => {
            const isChatActive = currentSessionId === s.id && currentView === 'agent';
            return (
              <div
                key={s.id}
                onClick={() => {
                  onSwitchSession?.(s.id);
                  onChangeView('agent');
                }}
                style={{
                  padding: '8px 12px', borderRadius: 8,
                  background: isChatActive ? 'rgba(77, 162, 255, 0.12)' : 'transparent',
                  color: isChatActive ? 'var(--sui-blue)' : '#94a3b8',
                  fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap',
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  display: 'flex', alignItems: 'center', gap: 8, transition: 'background 0.2s'
                }}
                onMouseOver={e => { if (!isChatActive) e.currentTarget.style.background = '#1e293b'; }}
                onMouseOut={e => { if (!isChatActive) e.currentTarget.style.background = 'transparent'; }}
              >
                💬 {s.title}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Agent status + download ── */}
      <div style={{ flex: 'none', marginTop: 16 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 12px', borderRadius: 10, marginBottom: 10,
          backgroundColor: '#0f172a', border: '1px solid #1e293b',
        }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%',
            backgroundColor: agentOnline ? 'var(--profit)' : agentOnline === null ? '#64748b' : 'var(--loss)',
            flexShrink: 0,
          }} />
          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
            {agentOnline ? 'Agent connected' : agentOnline === null ? 'Checking agent…' : 'Agent offline'}
          </span>
          {latestVersion && (
            <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: '#64748b', fontFamily: 'monospace' }}>
              v{latestVersion}
            </span>
          )}
        </div>

        {!agentOnline && isHttps && (
          // Most common cause when the agent IS installed: the browser hasn't
          // trusted the agent's self-signed HTTPS cert yet. Offer that first.
          <>
            <button style={{
              width: '100%', padding: '11px 0', borderRadius: 10,
              background: 'var(--sui-blue)', color: 'var(--sui-blue-ink)',
              border: 'none', fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer',
              transition: 'transform 0.15s, filter 0.15s',
            }}
            onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.filter = 'brightness(1.08)'; }}
            onMouseOut={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.filter = 'none'; }}
            onClick={handleAcceptCert}>
              {acceptingCert ? '⏳ Waiting — accept the cert…' : '🔓 Connect running agent'}
            </button>
            <div style={{ fontSize: '0.66rem', color: '#64748b', textAlign: 'center', margin: '6px 0 8px', lineHeight: 1.5 }}>
              Agent installed &amp; running but offline here?<br />
              Click above, then <strong style={{ color: '#94a3b8' }}>Advanced → Proceed</strong> to trust localhost.
            </div>
            <button style={{
              width: '100%', padding: '8px 0', borderRadius: 10,
              background: 'transparent', color: '#94a3b8',
              border: '1px solid #334155', fontWeight: 500, fontSize: '0.78rem', cursor: 'pointer',
            }}
            onClick={() => setShowDownload(true)}>
              {t('sidebar.downloadAgent')}
            </button>
          </>
        )}

        {!agentOnline && !isHttps && (
          <button style={{
            width: '100%', padding: '11px 0', borderRadius: 10,
            background: 'var(--sui-blue)',
            color: 'var(--sui-blue-ink)', border: 'none', fontWeight: 600, fontSize: '0.85rem',
            cursor: 'pointer', transition: 'transform 0.15s, filter 0.15s',
          }}
          onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.filter = 'brightness(1.08)'; }}
          onMouseOut={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.filter = 'none'; }}
          onClick={() => setShowDownload(true)}>
            {t('sidebar.downloadAgent')}
          </button>
        )}
      </div>

      {/* Download modal */}
      <AgentDownloadModal isOpen={showDownload} onClose={() => setShowDownload(false)} />
    </div>
  );
};
