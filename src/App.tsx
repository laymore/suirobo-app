import { useState, useCallback, useEffect } from 'react';
import { ConnectButton, useCurrentAccount, useSuiClientQuery } from '@mysten/dapp-kit';
import { useDeepTradeAgent, type LlmProvider } from './hooks/useDeepTradeAgent';
import { TxConfirmModal } from './components/TxConfirmModal';
import { Sidebar, type ViewType } from './components/Sidebar';
import { DashboardView } from './components/views/DashboardView';
import { AgentView } from './components/views/AgentView';
import { FactoryView } from './components/views/FactoryView';
import { ManualTradeView } from './components/views/ManualTradeView';
import { BacktestSimulator } from './components/BacktestSimulator';
import { LiveTradeDashboard } from './components/LiveTradeDashboard';
import { WebBotPanel } from './components/WebBotPanel';
import { SetupWizard } from './components/SetupWizard';
import type { BotSkillConfig } from './types/botSkill';
import { useUserConfig } from './hooks/useUserConfig';
import { useI18n } from './i18n';

import './App.css';

export default function App() {
  const [currentView, setCurrentView] = useState<ViewType>('dashboard');
  const [showApiSetup, setShowApiSetup] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<LlmProvider>('gemini');
  const [isAutonomous, setIsAutonomous] = useState(false);
  const [dashboardData, setDashboardData] = useState<any>(null);
  const [pendingBotSkill, setPendingBotSkill] = useState<BotSkillConfig | undefined>(undefined);

  // ── User Config & Setup Wizard ──
  const userConfig = useUserConfig();
  const [showSetup, setShowSetup] = useState(false);
  // Live Trade tier ladder (increasing automation): 'manual' (you sign each) →
  // 'web' (no-install bot, you sign) → 'agent' (downloaded Client Bot, auto-sign 24/7).
  // The 4th rung — AI Agent (auto) — lives in the AI Assistant view, reached via the switch.
  const [liveTier, setLiveTier] = useState<'manual' | 'web' | 'agent'>('web');
  const { t } = useI18n();

  // Check whether setup is required once the app has loaded
  useEffect(() => {
    // Delay 500ms to avoid a flash render
    const timer = setTimeout(() => {
      if (userConfig.needsSetup) setShowSetup(true);
      else {
        // Auto-fill API key from saved config
        const savedKey = userConfig.getApiKey();
        if (savedKey) {
          setApiKey(savedKey);
          setSelectedProvider(userConfig.config.provider as LlmProvider);
        }
      }
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  const {
    status, provider, error,
    messages, pendingTx, sessions, currentSessionId,
    initAgent, sendMessage,
    confirmTx, rejectTx,
    syncMemwal, syncSkillAuthors, createNewSession, switchSession,
  } = useDeepTradeAgent();

  const account = useCurrentAccount();
  
  useEffect(() => {
    if (account?.address && status === 'ready') {
      syncMemwal(account.address);
    }
  }, [account?.address, status, syncMemwal]);

  // Sync skill authors to backend for execution fee distribution
  useEffect(() => {
    if (account?.address) {
      try {
        const stored = localStorage.getItem('installedSkillAuthors');
        const authors: string[] = stored ? JSON.parse(stored) : [];
        syncSkillAuthors(account.address, authors);
      } catch { /* ignore */ }
    }
  }, [account?.address, syncSkillAuthors]);

  // Dashboard positions start empty — real margin/predict positions are populated from
  // on-chain queries when a wallet is connected (no fabricated demo positions/PnL).
  useEffect(() => {
    setDashboardData({
      margin: { positions: [] },
      predict: { positions: [] },
    });
  }, []);

  const { data: balanceData } = useSuiClientQuery(
    'getCoins',
    { owner: account?.address ?? '', coinType: '0x2::sui::SUI' },
    { enabled: !!account?.address }
  );
  const suiBalance = balanceData
    ? (balanceData.data.reduce((s: number, c: any) => s + Number(c.balance), 0) / 1e9).toFixed(4)
    : null;

  const handleActivate = useCallback(() => {
    const k = apiKey.trim();
    if (!k) return;
    initAgent(selectedProvider, k);
    setShowApiSetup(false);
    setApiKey('');
  }, [apiKey, selectedProvider, initAgent]);

  const handleAskFromManual = useCallback((text: string) => {
    setCurrentView('agent');
    setTimeout(() => sendMessage(text), 100);
  }, [sendMessage]);

  // If autonomous is ON, auto-confirm transactions!
  useEffect(() => {
    if (isAutonomous && pendingTx) {
      console.log('Autonomous Mode Active: Auto-confirming transaction', pendingTx);
      confirmTx();
    }
  }, [isAutonomous, pendingTx, confirmTx]);

  const statusDot = {
    idle:         '#475569',
    initializing: '#f59e0b',
    ready:        '#22c55e',
    thinking:     '#00d4ff',
    error:        '#ef4444',
  }[status];

  return (
    <div style={{
      height: '100vh', background: '#060e1e',
      display: 'flex', flexDirection: 'column',
      fontFamily: "'Inter', -apple-system, sans-serif",
    }}>
      {/* ── Header ── */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 20px', height: 64,
        background: '#0a101d', borderBottom: '1px solid #1e293b',
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 16 }}>
          {account && (
            <div style={{
              background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8,
              padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 12,
              fontSize: '0.75rem', color: '#94a3b8', fontFamily: 'monospace',
            }}>
              <span>💎 {account.address.slice(0, 10)}...{account.address.slice(-6)}</span>
              {suiBalance && <span style={{ color: '#00d4ff' }}>⚡ {suiBalance} SUI</span>}
              <span style={{ color: '#22c55e' }}>● Mainnet</span>
            </div>
          )}
        </div>

        {/* Setup Wizard button */}
        <button onClick={() => setShowSetup(true)} title="Open Setup Wizard" style={{
          padding: '6px 10px', borderRadius: 8,
          background: 'transparent',
          border: `1px solid ${userConfig.needsSetup ? 'rgba(245,158,11,0.4)' : '#334155'}`,
          color: userConfig.needsSetup ? '#f59e0b' : '#475569',
          fontSize: '0.78rem', cursor: 'pointer',
        }}>
          {userConfig.needsSetup ? '⚠️' : '🔧'}
        </button>

        {/* AI settings (status dot folded into the button) */}
        <button onClick={() => setShowApiSetup(s => !s)}
          title={status === 'ready'
            ? t('header.aiConnected', { provider: provider === 'gemini' ? 'Gemini' : 'DeepSeek' })
            : t('header.aiDisconnected')}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '8px 16px', borderRadius: 8,
            background: status === 'ready' ? 'transparent' : 'rgba(77,162,255,0.1)',
            border: `1px solid ${status === 'ready' ? '#334155' : 'rgba(77,162,255,0.35)'}`,
            color: status === 'ready' ? '#94a3b8' : 'var(--sui-blue)',
            fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s'
          }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: statusDot, display: 'inline-block', flexShrink: 0 }} />
          {t('header.aiSettings')}
        </button>

        {/* Wallet */}
        <ConnectButton style={{
          background: 'var(--sui-blue)',
          border: 'none', borderRadius: 8, color: 'var(--sui-blue-ink)',
          fontSize: '0.8rem', fontWeight: 600, padding: '8px 16px',
        }} />
      </header>

      {/* ── API Setup Dropdown ── */}
      {showApiSetup && (
        <div style={{
          position: 'fixed', top: 70, right: 20, zIndex: 200,
          background: '#0f172a', border: '1px solid #334155',
          borderRadius: 12, padding: 16, width: 320,
          boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
        }}>
          <h4 style={{ margin: '0 0 12px', color: '#e2e8f0', fontSize: '0.9rem' }}>🔑 Connect AI Agent</h4>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            {(['gemini', 'deepseek', 'openclaw'] as LlmProvider[]).map(p => (
              <button key={p} onClick={() => {
                setSelectedProvider(p);
                if (p === 'openclaw') setApiKey('openclaw');
                else setApiKey('');
              }} style={{
                flex: 1, padding: '8px', borderRadius: 8,
                border: `1px solid ${selectedProvider === p ? 'var(--sui-blue)' : '#334155'}`,
                background: selectedProvider === p ? 'rgba(77,162,255,0.1)' : 'transparent',
                color: selectedProvider === p ? 'var(--sui-blue)' : '#94a3b8',
                fontWeight: 600, fontSize: '0.75rem', cursor: 'pointer',
              }}>
                {p === 'gemini' ? '🤖 Gemini' : p === 'deepseek' ? '🔮 DeepSeek' : '🐾 OpenClaw'}
              </button>
            ))}
          </div>
          <input
            type="password"
            disabled={selectedProvider === 'openclaw'}
            placeholder={
              selectedProvider === 'gemini' 
                ? 'AIza... (Google AI Studio)' 
                : selectedProvider === 'deepseek'
                ? 'sk-... (DeepSeek)'
                : 'Auto-loads the key from openclaw.json'
            }
            value={selectedProvider === 'openclaw' ? '••••••••••••••••' : apiKey}
            onChange={e => setApiKey(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleActivate()}
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 8,
              background: selectedProvider === 'openclaw' ? '#090d16' : '#1e293b', 
              border: '1px solid #334155',
              color: selectedProvider === 'openclaw' ? '#10b981' : '#fff', 
              fontSize: '0.85rem', outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <div style={{ fontSize: '0.7rem', color: '#64748b', margin: '8px 0 12px' }}>
            The Local Agent guarantees your key never leaves your device.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={handleActivate} disabled={!apiKey.trim()} style={{
              flex: 1, padding: '10px', borderRadius: 8, border: 'none',
              background: apiKey.trim() ? 'var(--sui-blue)' : '#1e293b',
              color: apiKey.trim() ? 'var(--sui-blue-ink)' : '#64748b', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
            }}>Connect</button>
            <button onClick={() => setShowApiSetup(false)} style={{
              flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #334155',
              background: 'transparent', color: '#94a3b8', fontSize: '0.85rem', cursor: 'pointer',
            }}>Cancel</button>
          </div>
        </div>
      )}

      {/* ── Sidebar layout ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Sidebar Layout */}
        <Sidebar 
          currentView={currentView} 
          onChangeView={setCurrentView} 
          sessions={sessions}
          currentSessionId={currentSessionId}
          onCreateNewSession={createNewSession}
          onSwitchSession={switchSession}
          agentOnline={userConfig.agentOnline}
          onRecheckAgent={() => userConfig.checkAgent()}
        />

        {/* Main Content */}
        <div style={{ flex: 1, position: 'relative', overflowY: 'auto', backgroundColor: '#060e1e' }}>
          {currentView === 'dashboard' && <DashboardView onNavigate={setCurrentView} agentOnline={userConfig.agentOnline} />}
          {currentView === 'agent' && (
            <AgentView
              messages={messages}
              status={status}
              provider={selectedProvider}
              onSend={(text) => sendMessage(text, undefined, undefined, isAutonomous ? 'autonomous' : 'manual')}
              isAutonomous={isAutonomous}
              onToggleAutonomous={() => setIsAutonomous(!isAutonomous)}
            />
          )}
          {currentView === 'factory' && (
            <FactoryView
              onRequestBacktest={(skill) => {
                setPendingBotSkill(skill);
                setCurrentView('backtest');
              }}
            />
          )}
          {currentView === 'manual' && (
            <ManualTradeView 
              onAskAgent={handleAskFromManual} 
              disabled={status !== 'ready'} 
              dashboardData={dashboardData} 
            />
          )}
          {currentView === 'backtest' && (
            <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
              <BacktestSimulator preloadedBotSkill={pendingBotSkill} />
            </div>
          )}
          {currentView === 'livetrade' && (
            <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
              {/* 4-rung automation ladder. Manual / Web / Client render inline here;
                  AI Agent routes to the AI Assistant view in autonomous (auto) mode. */}
              {(() => {
                const TIERS = [
                  { id: 'manual', icon: '✍️', title: 'Manual',     sub: 'You decide & sign every trade',        nav: false },
                  { id: 'web',    icon: '🌐', title: 'Web Bot',    sub: 'No install · bot signals, you sign',    nav: false },
                  { id: 'agent',  icon: '💻', title: 'Client Bot', sub: 'Download agent · auto-sign 24/7',       nav: false },
                  { id: 'ai',     icon: '🤖', title: 'AI Agent',   sub: 'AI decides · opens in AI Assistant (auto)', nav: true },
                ];
                const idx = Math.max(0, TIERS.findIndex(t => t.id === liveTier));
                const pick = (t: typeof TIERS[number]) => {
                  if (t.nav) { setIsAutonomous(true); setCurrentView('agent'); }
                  else { setLiveTier(t.id as 'manual' | 'web' | 'agent'); }
                };
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
                    <span style={{ color: '#64748b', fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Trading Mode
                    </span>
                    {/* Sliding segmented switch (4 rungs) */}
                    <div style={{
                      position: 'relative', display: 'inline-flex', background: '#0a0f1d',
                      border: '1px solid #1e293b', borderRadius: 999, padding: 4, userSelect: 'none',
                    }}>
                      {/* sliding highlight — tracks the active inline tier (1/4 width) */}
                      <div style={{
                        position: 'absolute', top: 4, bottom: 4, left: 4, width: 'calc(25% - 4px)',
                        borderRadius: 999, background: 'linear-gradient(135deg, #00d4ff, #2563eb)',
                        transform: `translateX(${idx * 100}%)`, transition: 'transform 0.22s cubic-bezier(.4,0,.2,1)',
                        boxShadow: '0 2px 10px rgba(0,212,255,0.35)',
                      }} />
                      {TIERS.map(t => {
                        const active = liveTier === t.id;
                        return (
                          <button key={t.id} onClick={() => pick(t)} title={t.sub}
                            style={{
                              position: 'relative', zIndex: 1, cursor: 'pointer', border: 'none', background: 'transparent',
                              padding: '8px 12px', borderRadius: 999, display: 'flex', alignItems: 'center', gap: 5,
                              fontWeight: 800, fontSize: '0.8rem', transition: 'color 0.2s', whiteSpace: 'nowrap',
                              color: active ? '#031018' : '#94a3b8', minWidth: 96, justifyContent: 'center',
                            }}>
                            <span style={{ fontSize: '1rem' }}>{t.icon}</span>{t.title}
                            {t.nav && <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>↗</span>}
                          </button>
                        );
                      })}
                    </div>
                    <span style={{ color: '#475569', fontSize: '0.72rem' }}>
                      {(TIERS.find(t => t.id === liveTier) || TIERS[1]).sub}
                    </span>
                  </div>
                );
              })()}

              {liveTier === 'manual' ? (
                <ManualTradeView
                  onAskAgent={handleAskFromManual}
                  disabled={status !== 'ready'}
                  dashboardData={dashboardData}
                />
              ) : liveTier === 'web' ? (
                <WebBotPanel />
              ) : (
                <LiveTradeDashboard
                  onOpenManualTrade={() => setLiveTier('manual')}
                  onOpenSetupWizard={() => setShowSetup(true)}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Setup Wizard ── */}
      {showSetup && (
        <SetupWizard
          userConfig={userConfig}
          onComplete={() => {
            setShowSetup(false);
            // Apply saved config
            const savedKey = userConfig.getApiKey();
            if (savedKey) {
              setApiKey(savedKey);
              setSelectedProvider(userConfig.config.provider as LlmProvider);
              initAgent(userConfig.config.provider as LlmProvider, savedKey);
            }
          }}
        />
      )}

      {/* ── HITL Popup (Trừ khi Autonomous) ── */}
      {pendingTx && !isAutonomous && (
        <TxConfirmModal
          tx={pendingTx}
          onConfirm={confirmTx}
          onReject={rejectTx}
        />
      )}
    </div>
  );
}
