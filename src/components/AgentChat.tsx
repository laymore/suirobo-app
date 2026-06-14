/**
 * AgentChat — Giao diện chat với SUIROBO DeepTrade Agent
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage, AgentStatus, LlmProvider } from '../hooks/useDeepTradeAgent';
import { LogoMark } from './Logo';

interface Props {
  messages: ChatMessage[];
  status: AgentStatus;
  provider: LlmProvider;
  onSend: (text: string) => void;
}

const STATUS_CONFIG: Record<AgentStatus, { label: string; color: string }> = {
  idle:         { label: 'Not connected', color: '#64748b' },
  initializing: { label: 'Connecting...', color: '#f59e0b' },
  ready:        { label: 'Ready', color: '#22c55e' },
  thinking:     { label: 'Thinking...', color: '#00d4ff' },
  error:        { label: 'Error', color: '#ef4444' },
};

const QUICK_PROMPTS = [
  'SUI/USDC pool info?',
  'Quote swap 10 SUI → USDC',
  'Check Margin health',
  'Predict Vault stats',
  'Current SUI oracle price?',
];

// Inline formatting: **bold**, `code`
function inlineFmt(s: string): string {
  return s
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code style="background:#1e293b;padding:1px 5px;border-radius:4px;font-size:0.85em">$1</code>');
}

// Simple markdown-ish renderer with table support
function renderText(text: string) {
  const lines = text.split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Detect a markdown table: header row | sep row of dashes | body...
    const isTableRow = /^\s*\|.*\|\s*$/.test(line);
    const next = lines[i + 1] || '';
    const isSep = /^\s*\|?(\s*:?-+:?\s*\|)+\s*$/.test(next);
    if (isTableRow && isSep) {
      const headers = line.split('|').slice(1, -1).map(s => s.trim());
      let j = i + 2;
      const rows: string[][] = [];
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) {
        rows.push(lines[j].split('|').slice(1, -1).map(s => s.trim()));
        j++;
      }
      out.push(
        <table key={`t${i}`} style={{ borderCollapse: 'collapse', margin: '8px 0', fontSize: '0.85em', width: '100%' }}>
          <thead>
            <tr>
              {headers.map((h, hi) => (
                <th key={hi} style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #334155', color: '#e2e8f0', fontWeight: 700 }}
                    dangerouslySetInnerHTML={{ __html: inlineFmt(h) }} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td key={ci} style={{ padding: '5px 10px', borderBottom: '1px solid #1e293b', color: '#94a3b8' }}
                      dangerouslySetInnerHTML={{ __html: inlineFmt(c) }} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      );
      i = j;
      continue;
    }
    out.push(
      <div key={i} dangerouslySetInnerHTML={{ __html: inlineFmt(line) || '&nbsp;' }} />
    );
    i++;
  }
  return out;
}

export function AgentChat({ messages, status, provider, onSend }: Props) {
  const [input, setInput] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  const handleSend = useCallback(() => {
    const t = input.trim();
    if (!t || status === 'thinking' || status === 'initializing') return;
    onSend(t);
    setInput('');
  }, [input, status, onSend]);

  const cfg = STATUS_CONFIG[status];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Status bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 16px', borderBottom: '1px solid #1e293b',
        background: '#0a1628',
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: cfg.color, flexShrink: 0,
          boxShadow: status === 'ready' ? `0 0 6px ${cfg.color}` : 'none',
        }} />
        <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontFamily: 'monospace' }}>
          {status === 'ready' || status === 'thinking'
            ? `${provider === 'gemini' ? '🤖 Gemini' : '🔮 DeepSeek'} — ${cfg.label}`
            : cfg.label}
        </span>
        {status === 'thinking' && (
          <span style={{ marginLeft: 'auto', fontSize: '0.7rem', color: '#00d4ff', animation: 'pulse 1s infinite' }}>
            ⟳ Processing...
          </span>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {messages.map(msg => (
          <div key={msg.id} style={{
            display: 'flex',
            flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
            gap: 10, alignItems: 'flex-start',
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: msg.role === 'agent' ? 'var(--sui-blue)' : '#1e293b',
              fontSize: '0.9rem',
            }}>
              {msg.role === 'agent' ? '🤖' : '👤'}
            </div>
            <div style={{ maxWidth: '78%' }}>
              <div style={{
                background: msg.role === 'agent' ? '#1e293b' : 'linear-gradient(135deg, #0080ff22, #00d4ff11)',
                border: `1px solid ${msg.role === 'agent' ? '#334155' : '#0080ff44'}`,
                borderRadius: msg.role === 'user' ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                padding: '10px 14px',
                fontSize: '0.85rem', lineHeight: 1.6, color: '#e2e8f0',
              }}>
                {renderText(msg.text)}
              </div>
              <div style={{ fontSize: '0.65rem', color: '#475569', marginTop: 4, textAlign: msg.role === 'user' ? 'right' : 'left' }}>
                {msg.time}
              </div>
            </div>
          </div>
        ))}

        {status === 'thinking' && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <div style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><LogoMark size={30} bg='#060e1e' /></div>
            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '4px 16px 16px 16px', padding: '12px 16px', display: 'flex', gap: 5 }}>
              {[0, 1, 2].map(i => (
                <span key={i} style={{
                  width: 7, height: 7, borderRadius: '50%', background: '#00d4ff',
                  display: 'inline-block',
                  animation: `bounce 1.2s ${i * 0.2}s infinite`,
                }} />
              ))}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Quick prompts */}
      <div style={{ padding: '8px 16px', display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: '1px solid #1e293b' }}>
        {QUICK_PROMPTS.map(q => (
          <button key={q} onClick={() => onSend(q)}
            disabled={status !== 'ready'}
            style={{
              padding: '4px 10px', borderRadius: 12, border: '1px solid #334155',
              background: 'transparent', color: '#94a3b8', fontSize: '0.7rem',
              cursor: status === 'ready' ? 'pointer' : 'not-allowed', transition: 'all 0.2s',
            }}
            onMouseEnter={e => { if (status === 'ready') (e.target as HTMLElement).style.borderColor = '#00d4ff'; }}
            onMouseLeave={e => { (e.target as HTMLElement).style.borderColor = '#334155'; }}
          >
            {q}
          </button>
        ))}
      </div>

      {/* Input */}
      <div style={{
        padding: '12px 16px', borderTop: '1px solid #1e293b',
        background: '#0a1628', display: 'flex', gap: 10,
      }}>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder={status === 'ready' ? 'Ask SUIROBO about DeepTrade...' : 'Enter an API key to start...'}
          disabled={status === 'thinking' || status === 'initializing'}
          rows={1}
          style={{
            flex: 1, background: '#1e293b', border: '1px solid #334155', borderRadius: 10,
            color: '#e2e8f0', padding: '10px 14px', fontSize: '0.88rem', resize: 'none',
            fontFamily: 'inherit', outline: 'none', transition: 'border-color 0.2s',
          }}
          onFocus={e => { e.target.style.borderColor = '#00d4ff'; }}
          onBlur={e => { e.target.style.borderColor = '#334155'; }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || status !== 'ready'}
          style={{
            width: 44, height: 44, borderRadius: 10, border: 'none',
            background: status === 'ready' && input.trim()
              ? 'var(--sui-blue)'
              : '#1e293b',
            color: '#fff', fontSize: '1.1rem', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.2s', flexShrink: 0,
          }}
        >
          ➤
        </button>
      </div>
    </div>
  );
}
