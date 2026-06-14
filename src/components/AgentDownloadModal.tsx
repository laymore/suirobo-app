/**
 * AgentDownloadModal — List of available agent versions
 * + Download trực tiếp từ Walrus
 * + Verify SHA-256
 * + Hướng dẫn cài đặt
 */
import React, { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────

interface AgentManifest {
  name: string;
  publisher?: string;
  version: string;
  built_at?: string;
  published_at?: string;
  size_bytes?: number;
  size_mb?: number;
  sha256?: string;
  platform?: string;
  node_version?: string;
  blob_id?: string;
  download_url?: string;
  epochs?: number;
  changelog?: string;
}

interface VersionInfo extends AgentManifest {
  isCurrent?: boolean;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

// ─── Helper ──────────────────────────────────────────────────────────────

const formatDate = (iso?: string) => {
  if (!iso) return 'N/A';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch { return 'N/A'; }
};

const copyToClipboard = (text: string) => {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {});
  } else {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch {}
    document.body.removeChild(ta);
  }
};

// ─── Main Component ───────────────────────────────────────────────────────

export const AgentDownloadModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [current,    setCurrent]    = useState<AgentManifest | null>(null);
  const [history,    setHistory]    = useState<VersionInfo[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [downloading,setDownloading]= useState<string | null>(null);  // version đang download
  const [progress,   setProgress]   = useState(0);
  const [copied,     setCopied]     = useState<string | null>(null);

  // ── Load current manifest + history ────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);

    // 1. Load current từ /agent-manifest.json
    fetch('/agent-manifest.json')
      .then(r => r.ok ? r.json() : null)
      .then(m => {
        if (m && m.blob_id) {
          setCurrent(m);
          // 2. Try load /agent-history.json (nếu admin có)
          return fetch('/agent-history.json')
            .then(r => r.ok ? r.json() : null)
            .then(h => {
              if (Array.isArray(h)) {
                // Sort newest first, mark current
                const sorted = h
                  .map(v => ({ ...v, isCurrent: v.version === m.version }))
                  .sort((a, b) => new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime());
                setHistory(sorted);
              } else {
                // Fallback: current version only
                setHistory([{ ...m, isCurrent: true }]);
              }
            })
            .catch(() => setHistory([{ ...m, isCurrent: true }]));
        } else {
          setHistory([]);
        }
      })
      .catch(() => setHistory([]))
      .finally(() => setLoading(false));
  }, [isOpen]);

  // ── Download với progress ───────────────────────────────────────────
  const handleDownload = useCallback(async (v: VersionInfo) => {
    if (!v.download_url) return;
    setDownloading(v.version);
    setProgress(0);

    try {
      // Direct download from GitHub Releases (reputable host) instead of a
      // page-generated blob — Chrome no longer flags/deletes the file.
      setProgress(100);
      const a = document.createElement('a');
      a.href = v.download_url;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();

      setTimeout(() => { setDownloading(null); setProgress(0); }, 1500);
    } catch (e: any) {
      alert('Download error: ' + e.message);
      setDownloading(null);
    }
  }, []);

  const handleCopySha = (sha: string) => {
    copyToClipboard(sha);
    setCopied(sha);
    setTimeout(() => setCopied(null), 1500);
  };

  if (!isOpen) return null;

  // ─────────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1500,
      background: 'rgba(3,7,18,0.92)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 16, fontFamily: "'Inter', sans-serif",
    }}>
      <div style={{
        background: 'linear-gradient(160deg, #080d1a 0%, #0a0f1d 100%)',
        border: '1px solid #1e293b',
        borderRadius: 16, padding: 0,
        width: '100%', maxWidth: 720, maxHeight: '90vh',
        overflow: 'hidden', display: 'flex', flexDirection: 'column',
        boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
      }}>

        {/* ── HEADER ── */}
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid #1e293b',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: 'linear-gradient(135deg, rgba(16,185,129,0.05), transparent)',
        }}>
          <div>
            <h3 style={{ margin: 0, color: '#e2e8f0', fontSize: '1.05rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
              ⬇️ Download Suirobo Agent
              <span style={{ fontSize: '0.65rem', background: 'rgba(16,185,129,0.15)', color: '#10b981', padding: '2px 7px', borderRadius: 4, fontWeight: 700 }}>
                FREE
              </span>
            </h3>
            <p style={{ margin: '4px 0 0', fontSize: '0.73rem', color: '#64748b' }}>
              Open Source · Self-Custody · Hosted on Walrus 🌊
            </p>
          </div>
          <button onClick={onClose} style={{
            width: 30, height: 30, borderRadius: 8, border: 'none', cursor: 'pointer',
            background: '#1e293b', color: '#94a3b8', fontSize: '1.1rem',
          }}>×</button>
        </div>

        {/* ── BODY ── */}
        <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1 }}>

          {loading && (
            <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
              Loading agent info...
            </div>
          )}

          {!loading && history.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
              ⚠️ No agents published yet. Contact the admin to configure.
            </div>
          )}

          {/* Current version banner */}
          {!loading && current && (
            <div style={{
              background: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(77,162,255,0.04))',
              border: '1px solid rgba(16,185,129,0.25)',
              borderRadius: 12, padding: 16, marginBottom: 16,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: '1.1rem' }}>🤖</span>
                    <span style={{ fontSize: '0.92rem', fontWeight: 800, color: '#e2e8f0' }}>
                      {current.name} <span style={{ color: '#10b981' }}>v{current.version}</span>
                    </span>
                    <span style={{ fontSize: '0.55rem', background: '#10b981', color: '#fff', padding: '2px 6px', borderRadius: 3, fontWeight: 700 }}>
                      LATEST
                    </span>
                  </div>
                  <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                    <strong style={{ color: '#10b981' }}>{current.publisher || 'Team Autobots'}</strong>
                    {' · '}{current.platform} · {current.size_mb} MB · {current.node_version}
                  </div>
                  <div style={{ fontSize: '0.62rem', color: '#475569', marginTop: 3 }}>
                    Release: {formatDate(current.published_at)}
                  </div>
                  {current.changelog && (
                    <div style={{ fontSize: '0.68rem', color: '#94a3b8', marginTop: 8, padding: '6px 10px', background: 'rgba(0,0,0,0.2)', borderRadius: 6, borderLeft: '2px solid #10b981' }}>
                      💡 {current.changelog}
                    </div>
                  )}
                </div>
              </div>

              {/* Download button */}
              {downloading === current.version ? (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: '#94a3b8', marginBottom: 6 }}>
                    <span>Downloading from Walrus...</span>
                    <span style={{ fontFamily: 'monospace', color: '#10b981' }}>{progress}%</span>
                  </div>
                  <div style={{ height: 6, background: '#1e293b', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${progress}%`,
                      background: 'linear-gradient(90deg, #10b981, #00d4ff)',
                      transition: 'width 0.3s',
                    }} />
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => handleDownload(current as VersionInfo)}
                  disabled={!current.download_url}
                  style={{
                    width: '100%', padding: '11px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: 'linear-gradient(135deg,#10b981,#059669)',
                    color: '#fff', fontWeight: 700, fontSize: '0.85rem',
                  }}
                >
                  ⬇️ Download v{current.version} ({current.size_mb} MB)
                </button>
              )}

              {/* SHA Verify */}
              {current.sha256 && (
                <div style={{ marginTop: 10, fontSize: '0.62rem', color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span>🔒 SHA-256:</span>
                  <code style={{ fontFamily: 'monospace', color: '#64748b' }}>
                    {current.sha256.slice(0, 24)}...
                  </code>
                  <button onClick={() => handleCopySha(current.sha256!)} style={{
                    background: 'none', border: '1px solid #1e293b', borderRadius: 4,
                    padding: '1px 6px', color: copied === current.sha256 ? '#10b981' : '#475569',
                    fontSize: '0.6rem', cursor: 'pointer',
                  }}>
                    {copied === current.sha256 ? '✓ Copied' : '📋 Copy'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Older versions */}
          {!loading && history.length > 1 && (
            <div>
              <div style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
                📜 Older versions
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {history.filter(v => !v.isCurrent).map(v => (
                  <div key={v.version} style={{
                    background: '#080d1a', border: '1px solid #1e293b', borderRadius: 10,
                    padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#94a3b8' }}>v{v.version}</span>
                        <span style={{ fontSize: '0.6rem', color: '#475569' }}>·</span>
                        <span style={{ fontSize: '0.62rem', color: '#475569' }}>{formatDate(v.published_at)}</span>
                        <span style={{ fontSize: '0.6rem', color: '#334155' }}>·</span>
                        <span style={{ fontSize: '0.62rem', color: '#475569' }}>{v.size_mb}MB</span>
                      </div>
                      {v.changelog && (
                        <div style={{ fontSize: '0.6rem', color: '#334155', marginTop: 3 }}>{v.changelog}</div>
                      )}
                    </div>
                    {downloading === v.version ? (
                      <div style={{ width: 120 }}>
                        <div style={{ height: 4, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${progress}%`, background: '#00d4ff' }} />
                        </div>
                        <div style={{ fontSize: '0.6rem', color: '#00d4ff', textAlign: 'right', marginTop: 2 }}>{progress}%</div>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleDownload(v)}
                        disabled={!v.download_url}
                        style={{
                          padding: '5px 10px', borderRadius: 5, border: '1px solid #334155',
                          background: 'transparent', color: '#94a3b8', fontSize: '0.68rem', cursor: 'pointer',
                          flexShrink: 0,
                        }}
                      >
                        ⬇ Download
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Install guide */}
          {!loading && current && (
            <div style={{ marginTop: 16, background: '#080d1a', border: '1px solid #1e293b', borderRadius: 10, padding: 12 }}>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700, marginBottom: 6 }}>
                📥 Installation
              </div>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: '0.7rem', color: '#475569', lineHeight: 1.8 }}>
                <li>Download <code style={{ color: '#94a3b8' }}>suirobo-agent-v{current.version}.zip</code> → <strong>Extract All</strong></li>
                <li>Double-click <code style={{ color: '#94a3b8' }}>suirobo-agent.exe</code> → SmartScreen → "More info" → "Run anyway"</li>
                <li>Console window opens: <strong style={{ color: '#10b981' }}>Suirobo Agent — Team Autobots</strong></li>
                <li>Agent installs to <code style={{ color: '#94a3b8' }}>%LOCALAPPDATA%\Suirobo</code> + auto-starts</li>
                <li>Refresh the page → the agent auto-connects</li>
              </ol>
            </div>
          )}

          {/* Security note */}
          {!loading && (
            <div style={{ marginTop: 12, fontSize: '0.62rem', color: '#334155', textAlign: 'center', lineHeight: 1.6 }}>
              🔒 SHA-256 matching the manifest = safe file · 🌊 Hosted on Walrus · 🛡️ Self-Custody
              <br/>Open source · Keys never leave your device · No middleman server
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
