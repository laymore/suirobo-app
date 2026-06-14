import React from 'react';
import { AgentChat } from '../AgentChat';
import type { AgentStatus, LlmProvider, ChatSession } from '../../hooks/useDeepTradeAgent';

interface AgentViewProps {
  messages: any[];
  status: AgentStatus;
  provider: LlmProvider;
  onSend: (msg: string) => void;
  isAutonomous: boolean;
  onToggleAutonomous: () => void;
}

export const AgentView: React.FC<AgentViewProps> = ({
  messages, status, provider, onSend, isAutonomous, onToggleAutonomous
}) => {
  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      
      {/* ── Main Chat Area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
        <div style={{
          padding: '16px 24px', borderBottom: '1px solid #1e293b',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: '#0a101d'
        }}>
          <div>
            <h2 style={{ margin: 0, color: '#fff', fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: 8 }}>
              🤖 AI Assistant
            </h2>
            <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: 4 }}>
              Give natural-language commands. The agent will call Skills from your Local install.
            </div>
          </div>
          
          {/* Toggle Mode */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: '#1e293b', padding: '6px 12px', borderRadius: 20 }}>
            <span style={{ fontSize: '0.8rem', color: isAutonomous ? '#64748b' : '#22c55e', fontWeight: isAutonomous ? 'normal' : 'bold' }}>
              🛡️ Manual sign
            </span>
            
            <button 
              onClick={onToggleAutonomous}
              style={{
                width: 44, height: 24, borderRadius: 12, position: 'relative', border: 'none',
                background: isAutonomous ? '#ef4444' : '#334155', cursor: 'pointer', transition: 'background 0.3s'
              }}
            >
              <div style={{
                width: 20, height: 20, borderRadius: '50%', background: '#fff',
                position: 'absolute', top: 2, left: isAutonomous ? 22 : 2, transition: 'left 0.3s'
              }} />
            </button>
            
            <span style={{ fontSize: '0.8rem', color: isAutonomous ? '#ef4444' : '#64748b', fontWeight: isAutonomous ? 'bold' : 'normal' }}>
              ⚡ Autonomous
            </span>
          </div>
        </div>

        {/* Capability banner — different per mode */}
        {isAutonomous ? (
          <div style={{ background: 'rgba(239, 68, 68, 0.1)', padding: '10px 24px', borderBottom: '1px solid rgba(239, 68, 68, 0.2)', color: '#fca5a5', fontSize: '0.8rem', lineHeight: 1.6 }}>
            ⚠️ <strong>Autonomous mode:</strong> Full DeepBook execution available — margin positions, DeepTrade orders, Predict options. Each trade still pops up for your signature unless auto-confirm is on. Only use with safe stop-loss skills equipped.
          </div>
        ) : (
          <div style={{ background: 'rgba(34,197,94,0.08)', padding: '10px 24px', borderBottom: '1px solid rgba(34,197,94,0.2)', color: '#86efac', fontSize: '0.8rem', lineHeight: 1.6 }}>
            🛡️ <strong>Manual sign mode:</strong> AI can research prices, pool TVL, oracle data, wallet balances, transaction history, analyze tokens, and <strong>send tokens to another wallet</strong> (you sign in the wallet popup). It <strong>cannot</strong> fetch swap quotes, list your open orders/positions, or place any trade — manage all of that yourself in Manual Trade view.
          </div>
        )}

        <div style={{ flex: 1, overflow: 'hidden' }}>
          <AgentChat messages={messages} status={status} provider={provider} onSend={onSend} />
        </div>
      </div>
    </div>
  );
};
