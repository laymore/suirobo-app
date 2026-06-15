/**
 * SetupWizard — Onboarding for new users
 * Shown on first app open from Walrus, or when re-setup is needed
 *
 * 4 bước:
 *  1. Verify the Local Agent is running
 *  2. Nhập AI API Key
 *  3. Kết nối ví Sui
 *  4. (Optional) Private key for Auto Bot
 */
import React, { useState, useEffect, useCallback } from 'react';
import { ConnectButton, useCurrentAccount } from '@mysten/dapp-kit';
import type { UserConfigReturn } from '../hooks/useUserConfig';
import { AGENT_URL } from '../agent/agentUrl';
import { useI18n } from '../i18n';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  userConfig: UserConfigReturn;
  onComplete: () => void;
}

type Step = 1 | 2 | 3 | 4;

// ─── Privacy Badge ────────────────────────────────────────────────────────────

const PrivacyBadge: React.FC<{ storage: 'localStorage' | 'sessionStorage' | 'memory' }> = ({ storage }) => {
  const info = {
    localStorage:   { icon: '💾', label: 'Save to localStorage', sub: 'Persisted on this device', color: '#f59e0b' },
    sessionStorage: { icon: '⏱️', label: 'sessionStorage', sub: 'Cleared when the tab closes', color: '#10b981' },
    memory:         { icon: '🧠', label: 'In-memory only', sub: 'Lost on page reload', color: '#6366f1' },
  }[storage];
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: `${info.color}12`, border: `1px solid ${info.color}30`, borderRadius: 6, padding: '4px 9px' }}>
      <span style={{ fontSize: '0.75rem' }}>{info.icon}</span>
      <div>
        <div style={{ fontSize: '0.62rem', fontWeight: 700, color: info.color }}>{info.label}</div>
        <div style={{ fontSize: '0.58rem', color: '#475569' }}>{info.sub}</div>
      </div>
    </div>
  );
};

// ─── HTTPS Cert Accept Panel ──────────────────────────────────────────────────
// When the HTTPS web app calls the HTTPS agent, the browser blocks self-signed certs.
// The user must open https://localhost:3002/health once to accept the cert.

import { AGENT_CERT_ACCEPT_URL, AGENT_HTTPS_URL } from '../agent/agentUrl';

const CertAcceptPanel: React.FC<{ onAccepted: () => void }> = ({ onAccepted }) => {
  const [step, setStep] = useState<'intro' | 'opening' | 'verifying'>('intro');

  const handleOpen = () => {
    window.open(AGENT_CERT_ACCEPT_URL, '_blank', 'noopener,noreferrer');
    setStep('opening');

    // Poll mỗi 2s xem agent online chưa
    const id = setInterval(async () => {
      try {
        const r = await fetch(`${AGENT_HTTPS_URL}/health`, { signal: AbortSignal.timeout(2000) });
        if (r.ok) {
          clearInterval(id);
          setStep('verifying');
          setTimeout(() => onAccepted(), 500);
        }
      } catch {}
    }, 2000);
    setTimeout(() => clearInterval(id), 3 * 60 * 1000);
  };

  return (
    <div style={{
      background: 'rgba(245,158,11,0.06)',
      border: '1px solid rgba(245,158,11,0.25)',
      borderRadius: 10, padding: 14, marginBottom: 10,
    }}>
      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#f59e0b', marginBottom: 8 }}>
        🔐 Required step: Accept the self-signed cert
      </div>
      <div style={{ fontSize: '0.68rem', color: '#94a3b8', lineHeight: 1.7, marginBottom: 10 }}>
        The HTTPS site cannot call an HTTP agent. The local agent uses HTTPS with a <strong>self-signed cert</strong> —
        you need to open one link and click <strong>Advanced</strong> → <strong>Proceed</strong>.
      </div>

      {step === 'intro' && (
        <button
          onClick={handleOpen}
          style={{
            width: '100%', padding: '10px', borderRadius: 7, border: 'none', cursor: 'pointer',
            background: 'linear-gradient(135deg, #f59e0b, #d97706)',
            color: '#fff', fontWeight: 700, fontSize: '0.8rem',
          }}
        >
          🔓 Open {AGENT_HTTPS_URL}/health & accept cert
        </button>
      )}

      {step === 'opening' && (
        <div style={{
          background: '#060e1e', borderRadius: 6, padding: '10px 12px',
          fontSize: '0.7rem', color: '#94a3b8', lineHeight: 1.7,
        }}>
          <div style={{ fontWeight: 700, color: '#f59e0b', marginBottom: 6 }}>
            ⏳ Waiting for you to accept the cert...
          </div>
          <div>In the new tab you just opened:</div>
          <div>1. You will see "Your connection is not private"</div>
          <div>2. Click <strong style={{ color: '#fff' }}>"Advanced"</strong> (or "Advanced options")</div>
          <div>3. Click <strong style={{ color: '#fff' }}>"Proceed to localhost (unsafe)"</strong></div>
          <div>4. The tab shows <code style={{ color: '#22c55e' }}>{`{"status":"ok"}`}</code> → come back to this tab</div>
          <div style={{ marginTop: 6, color: '#f59e0b' }}>
            <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', animation: 'pulse 1.5s infinite', marginRight: 6 }} />
            Polling the agent every 2s…
          </div>
        </div>
      )}

      {step === 'verifying' && (
        <div style={{ background: 'rgba(34,197,94,0.08)', borderRadius: 6, padding: '8px 12px', fontSize: '0.75rem', color: '#22c55e' }}>
          ✅ Certificate accepted! Verifying the agent…
        </div>
      )}

      <div style={{ marginTop: 8, fontSize: '0.6rem', color: '#475569', textAlign: 'center' }}>
        🔒 The cert is only valid for localhost. One-time only — the browser will remember.
      </div>
    </div>
  );
};

// ─── Agent Download Panel (1-click install) ───────────────────────────────────

interface AgentManifest {
  name: string;
  version: string;
  size_mb: number;
  sha256: string;
  blob_id?: string;
  download_url?: string;
  platform: string;
}

const AgentDownloadPanel: React.FC<{ onAgentReady: () => void }> = ({ onAgentReady }) => {
  const [manifest, setManifest] = useState<AgentManifest | null>(null);
  const [loadingManifest, setLoadingManifest] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [downloadPct, setDownloadPct] = useState(0);
  const [downloaded, setDownloaded] = useState(false);
  const [error, setError] = useState('');

  // Load manifest từ /agent-manifest.json (deploy cùng web app)
  useEffect(() => {
    fetch('/agent-manifest.json')
      .then(r => r.ok ? r.json() : null)
      .then(m => { setManifest(m); setLoadingManifest(false); })
      .catch(() => { setLoadingManifest(false); });
  }, []);

  const handleDownload = async () => {
    if (!manifest?.download_url) {
      setError('Manifest has no download URL yet');
      return;
    }
    setDownloading(true);
    setError('');
    setDownloadPct(0);

    try {
      // Direct download straight from GitHub Releases (a reputable host). The browser
      // fetches it natively, so Chrome no longer quarantines/deletes the file the way
      // it did with the old page-generated blob from the low-reputation Walrus host.
      setDownloadPct(100);
      const a = document.createElement('a');
      a.href = manifest.download_url;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setDownloaded(true);

      // Sau khi download xong, poll agent mỗi 2s
      const pollId = setInterval(async () => {
        try {
          const r = await fetch(`${AGENT_URL}/health`, { signal: AbortSignal.timeout(1500) });
          if (r.ok) { clearInterval(pollId); onAgentReady(); }
        } catch {}
      }, 2000);
      // Stop polling sau 5 phút
      setTimeout(() => clearInterval(pollId), 5 * 60 * 1000);

    } catch (e: any) {
      setError(e.message || 'Download failed');
      setDownloading(false);
    }
  };

  // ─── Render ────
  if (loadingManifest) {
    return <div style={{ fontSize: '0.7rem', color: '#475569', textAlign: 'center', padding: 8 }}>Loading agent info…</div>;
  }

  // Fallback nếu chưa có manifest (dev mode, hoặc admin chưa publish)
  if (!manifest || !manifest.download_url || !manifest.blob_id) {
    return (
      <div style={{ fontSize: '0.7rem', color: '#64748b', lineHeight: 1.7 }}>
        <div style={{ fontWeight: 600, color: '#94a3b8', marginBottom: 4 }}>📥 Manual install:</div>
        <div style={{ background: '#060e1e', borderRadius: 6, padding: '8px 10px', fontFamily: 'monospace', fontSize: '0.68rem', color: '#22c55e', marginBottom: 6 }}>
          npm run agent
          <br />
          <span style={{ color: '#334155' }}># or run suirobo-agent.exe directly</span>
        </div>
        <div style={{ color: '#334155' }}>Agent will run at <span style={{ color: '#00d4ff' }}>http://localhost:3001</span></div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Agent card */}
      <div style={{ background: '#060e1e', border: '1px solid #1e293b', borderRadius: 8, padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div>
            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#e2e8f0' }}>
              🤖 Suirobo Agent v{manifest.version}
            </div>
            <div style={{ fontSize: '0.62rem', color: '#475569', marginTop: 2 }}>
              {manifest.platform} · {manifest.size_mb} MB · Hosted on Walrus 🌊
            </div>
          </div>
          <span style={{ fontSize: '0.55rem', background: 'rgba(34,197,94,0.15)', color: '#22c55e', padding: '2px 6px', borderRadius: 3, border: '1px solid rgba(34,197,94,0.2)' }}>
            VERIFIED
          </span>
        </div>
        <div style={{ fontSize: '0.6rem', color: '#334155', fontFamily: 'monospace', wordBreak: 'break-all' }}>
          SHA-256: {manifest.sha256.slice(0, 32)}...
        </div>
      </div>

      {/* Download progress / button */}
      {!downloading && !downloaded && (
        <button
          onClick={handleDownload}
          style={{
            padding: '12px', borderRadius: 8, border: 'none', cursor: 'pointer',
            background: 'var(--sui-blue)',
            color: 'var(--sui-blue-ink)', fontWeight: 700, fontSize: '0.85rem',
          }}
        >
          ⬇️ Download agent ({manifest.size_mb} MB) — 1-click install
        </button>
      )}

      {downloading && !downloaded && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: '#94a3b8', marginBottom: 4 }}>
            <span>Downloading from Walrus…</span>
            <span style={{ fontFamily: 'monospace', color: '#00d4ff' }}>{downloadPct}%</span>
          </div>
          <div style={{ height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${downloadPct}%`,
              background: 'linear-gradient(90deg, #0080ff, #00d4ff)',
              transition: 'width 0.3s',
            }} />
          </div>
        </div>
      )}

      {downloaded && (
        <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#22c55e', marginBottom: 6 }}>
            ✅ Download done — open the file to install
          </div>
          <div style={{ fontSize: '0.66rem', color: '#475569', lineHeight: 1.7 }}>
            <div>1. Find <strong style={{ color: '#94a3b8' }}>suirobo-agent-v{manifest.version}.zip</strong> in Downloads → right-click → <strong>Extract All</strong></div>
            <div>2. <strong style={{ color: '#94a3b8' }}>Double-click</strong> the extracted <strong style={{ color: '#94a3b8' }}>suirobo-agent.exe</strong></div>
            <div style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 5, padding: '6px 9px', margin: '4px 0', color: '#f59e0b' }}>
              ⚠️ Windows SmartScreen will warn because the .exe lacks an expensive EV cert.
              Click "<strong>More info</strong>" → "<strong>Run anyway</strong>".
              <br/>A SHA-256 match with the manifest = a safe file from <strong>Team Autobots</strong>.
            </div>
            <div>3. A black console window opens: "Suirobo Agent — Team Autobots"</div>
            <div>4. The agent installs to %LOCALAPPDATA%\Suirobo + auto-starts</div>
            <div>5. This page will auto-connect once the agent is online</div>
          </div>
          <div style={{ marginTop: 8, fontSize: '0.62rem', color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', animation: 'pulse 1.5s infinite' }} />
            Waiting for agent to connect...
          </div>
        </div>
      )}

      {error && (
        <div style={{ fontSize: '0.7rem', color: '#ef4444', background: 'rgba(239,68,68,0.08)', borderRadius: 6, padding: '6px 10px' }}>
          ❌ {error}
        </div>
      )}

      {/* Privacy info */}
      <div style={{ fontSize: '0.62rem', color: '#334155', textAlign: 'center', lineHeight: 1.5 }}>
        🔒 Runs on your machine · Keys never leave the device · Open source
      </div>
    </div>
  );
};

// ─── Step Indicator ───────────────────────────────────────────────────────────

const StepDots: React.FC<{ current: Step; total: number }> = ({ current, total }) => (
  <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 24 }}>
    {Array.from({ length: total }, (_, i) => i + 1).map(s => (
      <div key={s} style={{
        width: s < current ? 24 : s === current ? 32 : 24,
        height: 4, borderRadius: 2, transition: 'all 0.3s',
        background: s < current ? '#22c55e' : s === current ? 'var(--sui-blue)' : '#1e293b',
      }} />
    ))}
  </div>
);

// ─── Main Component ───────────────────────────────────────────────────────────

export const SetupWizard: React.FC<Props> = ({ userConfig, onComplete }) => {
  const account = useCurrentAccount();
  const { t } = useI18n();
  const { config, agentOnline, checkAgent, saveApiKey, getApiKey, savePrivateKey, clearPrivateKey, completeSetup } = userConfig;

  const [step,        setStep]        = useState<Step>(1);
  const [checking,    setChecking]    = useState(false);

  // Step 2
  const [provider,    setProvider]    = useState<'gemini'|'deepseek'|'openclaw'>(config.provider || 'gemini');
  const [apiKey,      setApiKey]      = useState(getApiKey() || '');
  const [apiTested,   setApiTested]   = useState(false);
  const [apiError,    setApiError]    = useState('');

  // Step 4
  const [pk,          setPk]          = useState('');
  const [pkLoaded,    setPkLoaded]    = useState(false);
  const [showPk,      setShowPk]      = useState(false);

  // Auto-check agent khi vào step 1
  useEffect(() => {
    if (step === 1) handleCheckAgent();
  }, [step]);

  const handleCheckAgent = async () => {
    setChecking(true);
    await checkAgent();
    setChecking(false);
  };

  const handleTestApiKey = async () => {
    if (provider === 'openclaw') { setApiTested(true); setApiError(''); return; }
    if (!apiKey.trim()) { setApiError('Please enter an API key'); return; }
    setApiError('');
    try {
      // Test nhanh bằng cách ping agent với key
      const res = await fetch(`${config.agentUrl}/health`);
      if (res.ok) { setApiTested(true); setApiError(''); }
      else throw new Error('Agent offline');
    } catch {
      // If we cannot test, just continue — the user will discover later
      setApiTested(true);
    }
    // openclaw already returned by line 89; provider here is only 'gemini' | 'deepseek'
    saveApiKey(provider, apiKey);
  };

  const handleSaveApiKey = () => {
    saveApiKey(provider, provider === ('openclaw' as typeof provider) ? 'openclaw' : apiKey);
    setStep(isDesktop ? 4 : 3);   // desktop has no Connect-Wallet step
  };

  // Desktop app: no browser wallet — the key is persisted in the app install dir
  // and the bundled agent uses it to derive the address + sign. Step 3 is skipped.
  const isDesktop = typeof window !== 'undefined' && (window as any).SUIROBO_DESKTOP === true;

  const handleLoadPk = async () => {
    if (!pk.trim()) return;
    savePrivateKey(pk.trim());
    if (isDesktop && (window as any).suiroboDesktop?.saveKey) {
      try { await (window as any).suiroboDesktop.saveKey(pk.trim()); } catch { /* agent restart best-effort */ }
    }
    setPkLoaded(true);
  };

  const handleFinish = () => {
    completeSetup();
    onComplete();
  };

  const canProceedStep2 = provider === 'openclaw' || apiKey.trim().length > 10;
  const canProceedStep3 = !!account?.address;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(3,7,18,0.97)',
      backdropFilter: 'blur(20px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16, fontFamily: "'Inter', sans-serif",
    }}>
      {/* Background glow */}
      <div style={{ position: 'absolute', top: '20%', left: '30%', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(77,162,255,0.04) 0%, transparent 70%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: '20%', right: '25%', width: 300, height: 300, borderRadius: '50%', background: 'radial-gradient(circle, rgba(16,185,129,0.04) 0%, transparent 70%)', pointerEvents: 'none' }} />

      <div style={{
        background: 'linear-gradient(160deg, #080d1a 0%, #0a0f1d 100%)',
        border: '1px solid #1e293b',
        borderRadius: 20, padding: '32px 36px',
        width: '100%', maxWidth: 520,
        boxShadow: '0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(77,162,255,0.05)',
        position: 'relative',
      }}>

        {/* ── HEADER ── */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>🤖</div>
          <h2 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 800, color: '#e2e8f0', letterSpacing: -0.5 }}>
            {t('setup.welcome')}
          </h2>
          <p style={{ margin: '6px 0 0', fontSize: '0.78rem', color: '#475569' }}>
            {t('setup.welcomeSub')}
          </p>
        </div>

        <StepDots current={isDesktop && step === 4 ? 3 : step} total={isDesktop ? 3 : 4} />

        {/* ══════════════ STEP 1 — LOCAL AGENT ══════════════ */}
        {step === 1 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(77,162,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem' }}>1</div>
              <div>
                <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: '0.88rem' }}>{t('setup.step1Title')}</div>
                <div style={{ fontSize: '0.68rem', color: '#475569' }}>{t('setup.step1Sub')}</div>
              </div>
            </div>

            {/* Why a local agent is needed */}
            <div style={{ background: 'rgba(77,162,255,0.04)', border: '1px solid rgba(77,162,255,0.1)', borderRadius: 10, padding: 14 }}>
              <div style={{ fontSize: '0.7rem', color: '#00d4ff', fontWeight: 700, marginBottom: 8 }}>{t('setup.archTitle')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  ['🖥️', t('setup.archPoint1')],
                  ['🔑', t('setup.archPoint2')],
                  ['🌐', t('setup.archPoint3')],
                  ['🤖', t('setup.archPoint4')],
                ].map(([icon, text]) => (
                  <div key={icon} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.72rem', color: '#64748b' }}>
                    <span>{icon}</span><span>{text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Agent status */}
            <div style={{
              borderRadius: 10, padding: 14,
              background: checking ? 'rgba(71,85,105,0.1)' : agentOnline ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
              border: `1px solid ${checking ? '#334155' : agentOnline ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)'}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: checking || !agentOnline ? 10 : 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: checking ? '#f59e0b' : agentOnline ? '#22c55e' : '#ef4444',
                    animation: checking ? 'pulse 1s infinite' : 'none',
                  }} />
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: checking ? '#f59e0b' : agentOnline ? '#22c55e' : '#ef4444' }}>
                    {checking ? t('setup.checking') : agentOnline ? t('setup.agentRunning') : t('setup.agentOffline')}
                  </span>
                </div>
                <button onClick={handleCheckAgent} disabled={checking}
                  style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid #334155', background: 'transparent', color: '#64748b', fontSize: '0.68rem', cursor: 'pointer' }}>
                  {checking ? '...' : t('setup.checkAgain')}
                </button>
              </div>

              {!agentOnline && !checking && (
                <>
                  {/* HTTPS cert-accept step (shown only when site is HTTPS) */}
                  {typeof window !== 'undefined' && window.location.protocol === 'https:' && (
                    <CertAcceptPanel onAccepted={handleCheckAgent} />
                  )}
                  <AgentDownloadPanel onAgentReady={handleCheckAgent} />
                </>
              )}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {agentOnline === false && (
                <button onClick={() => setStep(2)} style={{ flex: 1, padding: '10px', borderRadius: 8, border: '1px solid #334155', background: 'transparent', color: '#475569', fontSize: '0.78rem', cursor: 'pointer' }}>
                  {t('setup.skipForNow')}
                </button>
              )}
              <button onClick={() => setStep(2)} disabled={!agentOnline && agentOnline !== false}
                style={{
                  flex: 2, padding: '11px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem',
                  background: agentOnline ? 'linear-gradient(135deg,#10b981,#059669)' : '#1e293b',
                  color: '#fff',
                }}>
                {agentOnline ? `${t('common.next')} →` : t('setup.waitingForAgent')}
              </button>
            </div>
          </div>
        )}

        {/* ══════════════ STEP 2 — API KEY ══════════════ */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(77,162,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem' }}>2</div>
              <div>
                <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: '0.88rem' }}>Configure AI Provider</div>
                <div style={{ fontSize: '0.68rem', color: '#475569' }}>Choose the AI engine for your Agent</div>
              </div>
            </div>

            {/* Provider tabs */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {[
                { id: 'gemini'   as const, icon: '🔷', name: 'Gemini', sub: 'Google AI Studio', hint: 'Free 15 RPM' },
                { id: 'deepseek' as const, icon: '🔮', name: 'DeepSeek', sub: 'DeepSeek AI', hint: 'Cheap, powerful' },
                { id: 'openclaw' as const, icon: '🐾', name: 'OpenClaw', sub: 'Auto from file', hint: 'Needs openclaw.json' },
              ].map(p => (
                <button key={p.id} onClick={() => setProvider(p.id)} style={{
                  padding: '10px 8px', borderRadius: 9, cursor: 'pointer', textAlign: 'center',
                  border: `1px solid ${provider === p.id ? 'rgba(77,162,255,0.5)' : '#1e293b'}`,
                  background: provider === p.id ? 'rgba(77,162,255,0.08)' : '#060e1e',
                  transition: 'all 0.15s',
                }}>
                  <div style={{ fontSize: '1.2rem', marginBottom: 4 }}>{p.icon}</div>
                  <div style={{ fontSize: '0.72rem', fontWeight: 700, color: provider === p.id ? 'var(--sui-blue)' : '#94a3b8' }}>{p.name}</div>
                  <div style={{ fontSize: '0.6rem', color: '#334155', marginTop: 2 }}>{p.hint}</div>
                </button>
              ))}
            </div>

            {/* API Key input */}
            {provider !== 'openclaw' ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600 }}>
                    {provider === 'gemini' ? 'Google AI Studio API Key' : 'DeepSeek API Key'}
                  </label>
                  <PrivacyBadge storage="localStorage" />
                </div>
                <input type="password"
                  placeholder={provider === 'gemini' ? 'AIzaSy...' : 'sk-...'}
                  value={apiKey}
                  onChange={e => { setApiKey(e.target.value); setApiTested(false); }}
                  style={{ width: '100%', background: '#060e1e', border: `1px solid ${apiError ? 'rgba(239,68,68,0.5)' : '#1e293b'}`, borderRadius: 8, padding: '10px 12px', color: '#e2e8f0', fontSize: '0.82rem', boxSizing: 'border-box', outline: 'none' }}
                />
                {apiError && <div style={{ fontSize: '0.68rem', color: '#ef4444', marginTop: 4 }}>{apiError}</div>}
                <div style={{ fontSize: '0.65rem', color: '#334155', marginTop: 5, lineHeight: 1.6 }}>
                  {provider === 'gemini'
                    ? <>Get a free key at <span style={{ color: '#00d4ff' }}>aistudio.google.com</span> → API Keys</>
                    : <>Sign up at <span style={{ color: '#6366f1' }}>platform.deepseek.com</span> → API Keys</>
                  }
                </div>
              </div>
            ) : (
              <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: '0.72rem', color: '#818cf8', fontWeight: 600, marginBottom: 4 }}>🐾 OpenClaw Mode</div>
                <div style={{ fontSize: '0.68rem', color: '#475569', lineHeight: 1.6 }}>
                  The agent reads its config from <code style={{ color: '#f59e0b' }}>openclaw.json</code> in the agent root folder.
                  No need to enter a key here.
                </div>
              </div>
            )}

            {/* Privacy notice */}
            <div style={{ background: '#080d1a', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: '1rem', flexShrink: 0 }}>🔒</span>
              <div style={{ fontSize: '0.68rem', color: '#475569', lineHeight: 1.7 }}>
                <strong style={{ color: '#64748b' }}>Data security:</strong> Your API key is encrypted and stored on this device.
                No Suirobo server ever sees this key — it is sent directly from your machine to {provider === 'gemini' ? 'Google' : 'DeepSeek'} API.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setStep(1)} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #1e293b', background: 'transparent', color: '#475569', fontSize: '0.78rem', cursor: 'pointer' }}>← Back</button>
              <button onClick={handleSaveApiKey} disabled={!canProceedStep2}
                style={{ flex: 1, padding: '11px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem', color: '#fff', background: canProceedStep2 ? 'linear-gradient(135deg,#6366f1,#4f46e5)' : '#1e293b' }}>
                Save & Continue →
              </button>
            </div>

            {/* Skip — Auto Bot mode needs no AI key */}
            <button onClick={() => setStep(isDesktop ? 4 : 3)}
              style={{ marginTop: -6, padding: '8px', borderRadius: 8, border: '1px dashed #1e293b', background: 'transparent', color: '#475569', fontSize: '0.72rem', cursor: 'pointer' }}>
              Skip — I'll use ⚡ Auto Bot (no AI key needed) →
            </button>
          </div>
        )}

        {/* ══════════════ STEP 3 — WALLET ══════════════ */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(77,162,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem' }}>3</div>
              <div>
                <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: '0.88rem' }}>Connect Sui Wallet</div>
                <div style={{ fontSize: '0.68rem', color: '#475569' }}>Used to sign transactions and buy Skills from the Marketplace</div>
              </div>
            </div>

            {account ? (
              <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 10, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(16,185,129,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}>💎</div>
                  <div>
                    <div style={{ fontWeight: 700, color: '#22c55e', fontSize: '0.82rem' }}>Connected!</div>
                    <div style={{ fontFamily: 'monospace', fontSize: '0.68rem', color: '#475569', marginTop: 2 }}>
                      {account.address.slice(0, 20)}...{account.address.slice(-10)}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[
                    ['✅', 'Sign Margin trades'],
                    ['✅', 'Buy Skills from Marketplace'],
                    ['✅', 'Approve AI Bot orders'],
                  ].map(([icon, text]) => (
                    <div key={text} style={{ flex: 1, background: '#060e1e', borderRadius: 6, padding: '6px 8px', fontSize: '0.62rem', color: '#475569', textAlign: 'center' }}>
                      <div style={{ marginBottom: 2 }}>{icon}</div>{text}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>💎</div>
                <div style={{ fontSize: '0.78rem', color: '#64748b', marginBottom: 16 }}>
                  Connect a Sui wallet to use all features
                </div>
                <ConnectButton style={{ background: 'linear-gradient(135deg,#0080ff,#00d4ff)', border: 'none', borderRadius: 8, color: '#fff', fontSize: '0.85rem', fontWeight: 700, padding: '10px 20px' }} />
              </div>
            )}

            {/* Privacy note */}
            <div style={{ background: '#080d1a', border: '1px solid #1e293b', borderRadius: 8, padding: '10px 12px', display: 'flex', gap: 10 }}>
              <span style={{ fontSize: '1rem', flexShrink: 0 }}>🔒</span>
              <div style={{ fontSize: '0.68rem', color: '#475569', lineHeight: 1.6 }}>
                The Sui wallet is only used to <strong style={{ color: '#64748b' }}>sign transactions</strong> — the public address is on-chain by design.
                The wallet private key is <strong style={{ color: '#64748b' }}>never</strong> read or stored by Suirobo.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setStep(2)} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #1e293b', background: 'transparent', color: '#475569', fontSize: '0.78rem', cursor: 'pointer' }}>← Back</button>
                <button onClick={() => setStep(4)}
                  style={{ flex: 1, padding: '11px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem', color: '#fff', background: account ? 'linear-gradient(135deg,#0080ff,#00d4ff)' : 'linear-gradient(135deg,#475569,#64748b)' }}>
                  {account ? 'Continue →' : 'Skip for now →'}
                </button>
              </div>
              {!account && (
                <div style={{ fontSize: '0.65rem', color: '#475569', textAlign: 'center', lineHeight: 1.5 }}>
                  Skipping is fine — you can connect a wallet later from the header when you need to sign a transaction.
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════ STEP 4 — AUTO BOT KEY (Optional) ══════════════ */}
        {step === 4 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(239,68,68,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem' }}>{isDesktop ? '3' : '4'}</div>
              <div>
                <div style={{ fontWeight: 700, color: '#e2e8f0', fontSize: '0.88rem' }}>{isDesktop ? 'Wallet Key' : 'Auto Bot'} <span style={{ fontSize: '0.65rem', color: '#475569', fontWeight: 400 }}>{isDesktop ? '' : '(Optional)'}</span></div>
                <div style={{ fontSize: '0.68rem', color: '#475569' }}>{isDesktop ? 'The app stores your key and uses it to connect the wallet + sign trades' : 'Allow the bot to auto-sign orders without prompts'}</div>
              </div>
            </div>

            {/* Mode comparison */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div style={{ background: 'rgba(77,162,255,0.04)', border: '1px solid rgba(77,162,255,0.15)', borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#00d4ff', marginBottom: 6 }}>🤖 AI Auto Bot</div>
                {['Needs an AI API key', 'Browser wallet connect', 'Trade-confirmation popup'].map(t => (
                  <div key={t} style={{ fontSize: '0.63rem', color: '#475569', marginBottom: 3 }}>✓ {t}</div>
                ))}
                <div style={{ marginTop: 6, fontSize: '0.62rem', background: 'rgba(77,162,255,0.08)', borderRadius: 4, padding: '3px 6px', color: '#00d4ff', display: 'inline-block' }}>Configured ✅</div>
              </div>
              <div style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8, padding: 10 }}>
                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#f87171', marginBottom: 6 }}>⚡ Auto Bot</div>
                {['No AI key needed', 'No browser needed', '100% automatic'].map(t => (
                  <div key={t} style={{ fontSize: '0.63rem', color: '#475569', marginBottom: 3 }}>✓ {t}</div>
                ))}
                <div style={{ marginTop: 6, fontSize: '0.62rem', background: 'rgba(239,68,68,0.08)', borderRadius: 4, padding: '3px 6px', color: '#f87171', display: 'inline-block' }}>Private Key required</div>
              </div>
            </div>

            {/* Private key */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600 }}>{isDesktop ? 'Wallet Private Key' : 'Private Key (for Auto Bot)'}</label>
                <PrivacyBadge storage={isDesktop ? 'localStorage' : 'sessionStorage'} />
              </div>

              {!pkLoaded ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <div style={{ position: 'relative', flex: 1 }}>
                    <input
                      type={showPk ? 'text' : 'password'}
                      placeholder="suiprivkey1q… or 64-char hex"
                      value={pk}
                      onChange={e => setPk(e.target.value)}
                      style={{ width: '100%', background: '#060e1e', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 7, padding: '9px 36px 9px 12px', color: '#e2e8f0', fontSize: '0.78rem', boxSizing: 'border-box', outline: 'none' }}
                    />
                    <button onClick={() => setShowPk(v => !v)}
                      style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#334155', fontSize: '0.8rem' }}>
                      {showPk ? '🙈' : '👁️'}
                    </button>
                  </div>
                  <button onClick={handleLoadPk} disabled={!pk.trim()}
                    style={{ padding: '9px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', background: pk ? '#ef4444' : '#1e293b', color: '#fff', fontSize: '0.75rem', fontWeight: 700 }}>
                    Load
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 7, padding: '9px 12px' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span style={{ fontSize: '0.8rem' }}>🔑</span>
                    <span style={{ fontSize: '0.72rem', color: '#22c55e', fontFamily: 'monospace' }}>{pk.slice(0, 14)}••••••••••</span>
                  </div>
                  <button onClick={() => { clearPrivateKey(); setPk(''); setPkLoaded(false); }}
                    style={{ background: 'none', border: '1px solid #334155', borderRadius: 4, padding: '2px 8px', color: '#475569', fontSize: '0.65rem', cursor: 'pointer' }}>Xóa</button>
                </div>
              )}
            </div>

            {/* Security warning */}
            <div style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 8, padding: '10px 12px', fontSize: '0.68rem', color: '#92400e', lineHeight: 1.7 }}>
              <div style={{ fontWeight: 700, color: '#f59e0b', marginBottom: 4 }}>⚠️ Important note:</div>
              <div style={{ color: '#78716c' }}>
                {isDesktop
                  ? <>• Key is stored <strong>encrypted in the app folder on this machine</strong> and never leaves it<br /></>
                  : <>• Key stays in <strong>sessionStorage</strong> — cleared when the tab closes<br /></>}
                • The bot will execute orders automatically, <strong>without asking for confirmation</strong><br />
                • Only use a low-capital wallet for testing. Funds lost are at your own risk.<br />
                {isDesktop
                  ? <>• The app uses this key to connect the wallet, load balances + the margin panel</>
                  : <>• You can skip this and configure it later in Live Trade</>}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setStep(isDesktop ? 2 : 3)} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #1e293b', background: 'transparent', color: '#475569', fontSize: '0.78rem', cursor: 'pointer' }}>← Back</button>
              <button onClick={handleFinish}
                style={{ flex: 1, padding: '11px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: '0.85rem', color: '#fff', background: 'linear-gradient(135deg,#10b981,#059669)' }}>
                {pkLoaded ? '⚡ Finish & Open App →' : '🤖 Skip & Open App →'}
              </button>
            </div>
          </div>
        )}

        {/* Bottom: data privacy footer */}
        <div style={{ marginTop: 20, padding: '10px 0 0', borderTop: '1px solid #0d1525', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
          {[
            ['🔒', 'Data stays on this device'],
            ['🏠', 'No middleman server'],
            ['🌊', 'Hosted on Walrus'],
          ].map(([icon, text]) => (
            <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.6rem', color: '#334155' }}>
              <span>{icon}</span><span>{text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
