/**
 * useDeepTradeAgent — Hook quản lý ADK Agent qua Backend API
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { LocalAgentService } from '../agent/LocalAgentService';
import { AGENT_URL } from '../agent/agentUrl';

export type LlmProvider = 'gemini' | 'deepseek' | 'openclaw';
export type AgentStatus = 'idle' | 'initializing' | 'ready' | 'thinking' | 'error';

export interface PendingTx {
  status: 'pending_confirmation';
  is_risky: boolean;
  riskType?: 'margin_liquidation' | 'predict_loss';
  [key: string]: any;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
  time: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

const now = () => new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

const DEFAULT_WELCOME_MESSAGE: ChatMessage = {
  id: '0',
  role: 'agent',
  text: '👋 Hi! I am SUIROBO — your DeepTrade AI assistant.\n\n' +
        'Enter a **Gemini** or **DeepSeek** API key in the top-right to get started (or choose **OpenClaw** for an auto-connect).\n\n' +
        'I can help you with:\n' +
        '• 📊 **V3**: Swap, Limit/Market orders on DeepBook\n' +
        '• ⚡ **Margin**: Leveraged trading, liquidation-risk checks\n' +
        '• 🎯 **Predict**: Binary predictions, Vault liquidity',
  time: now(),
};

export function useDeepTradeAgent() {
  const currentAccount = useCurrentAccount();
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [provider, setProvider] = useState<LlmProvider>('gemini');
  const [error, setError] = useState<string | null>(null);
  const [pendingTx, setPendingTx] = useState<PendingTx | null>(null);
  const apiKeyRef = useRef<string>('');

  // Sessions State
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    try {
      const saved = localStorage.getItem('deepTradeSessions');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [];
  });
  
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  // Lưu sessions vào localStorage mỗi khi có thay đổi
  useEffect(() => {
    localStorage.setItem('deepTradeSessions', JSON.stringify(sessions));
  }, [sessions]);

  // Khởi tạo session đầu tiên nếu trống
  useEffect(() => {
    if (sessions.length === 0) {
      createNewSession();
    } else if (!currentSessionId) {
      setCurrentSessionId(sessions[0].id);
    }
  }, [sessions.length, currentSessionId]);

  const currentSession = sessions.find(s => s.id === currentSessionId) || null;
  const messages = currentSession?.messages || [];

  const createNewSession = useCallback(() => {
    const newId = `session_${Date.now()}`;
    const newSession: ChatSession = {
      id: newId,
      title: 'New conversation',
      messages: [DEFAULT_WELCOME_MESSAGE],
      updatedAt: Date.now()
    };
    setSessions(prev => [newSession, ...prev]);
    setCurrentSessionId(newId);
  }, []);

  const switchSession = useCallback((id: string) => {
    setCurrentSessionId(id);
  }, []);

  const addAgentMessage = useCallback((text: string) => {
    setSessions(prev => prev.map(s => {
      if (s.id !== currentSessionId) return s;
      return {
        ...s,
        updatedAt: Date.now(),
        messages: [...s.messages, {
          id: Date.now().toString(),
          role: 'agent',
          text,
          time: now(),
        }]
      };
    }));
  }, [currentSessionId]);

  const initAgent = useCallback(async (prov: LlmProvider, apiKey: string) => {
    setStatus('initializing');
    setError(null);
    try {
      LocalAgentService.initAgent(apiKey, prov as any);
      apiKeyRef.current = apiKey;
      setProvider(prov);
      setStatus('ready');
      const provName = prov === 'gemini' ? 'Gemini 2.0 Flash' : prov === 'deepseek' ? 'DeepSeek' : 'OpenClaw Link 🐾';
      addAgentMessage(`✅ **${provName}** is connected to the Local Agent Daemon!`);
    } catch (err: any) {
      console.error('Agent Init Error:', err);
      setError(err.message);
      setStatus('error');
      addAgentMessage(`❌ Error: ${err.message}`);
    }
  }, [addAgentMessage]);

  const sendMessage = useCallback(async (text: string, apiKey?: string, prov?: LlmProvider, mode?: 'manual' | 'autonomous') => {
    if (status !== 'ready') return;
    if (!text.trim()) return;
    
    const providerToUse = prov || provider;
    const keyToUse = providerToUse === 'openclaw' ? (apiKey || apiKeyRef.current || 'openclaw') : (apiKey || apiKeyRef.current);
    
    if (!keyToUse) {
      addAgentMessage('❌ Please provide an API key to use the Agent.');
      return;
    }

    setSessions(prev => prev.map(s => {
      if (s.id !== currentSessionId) return s;
      
      // Set the conversation title from the first user message
      const isFirstUserMsg = s.messages.filter(m => m.role === 'user').length === 0;
      let newTitle = s.title;
      if (isFirstUserMsg) {
        newTitle = text.slice(0, 30) + (text.length > 30 ? '...' : '');
      }

      return {
        ...s,
        title: newTitle,
        updatedAt: Date.now(),
        messages: [...s.messages, {
          id: Date.now().toString(),
          role: 'user',
          text,
          time: now(),
        }]
      };
    }));
    setStatus('thinking');

    try {
      LocalAgentService.initAgent(keyToUse, providerToUse);
      const result = await LocalAgentService.runChat(text, currentSessionId || 'default', currentAccount?.address, mode || 'manual');
      
      addAgentMessage(result.finalText);
      
      if (result.pendingTx) {
        setPendingTx(result.pendingTx);
      }
      setStatus('ready');
    } catch (error: any) {
      console.error('Agent error:', error);
      setStatus('error');
      addAgentMessage(`❌ [Error]: ${error.message || 'Could not process the request.'}`);
    }
  }, [currentSessionId, addAgentMessage, status, provider, currentAccount?.address]);

  const confirmTx = useCallback(() => {
    setPendingTx(null);
    addAgentMessage('✅ Order sent to the Sui wallet for signing. Please confirm in the Sui Wallet extension.');
  }, [addAgentMessage]);

  const rejectTx = useCallback(() => {
    setPendingTx(null);
    addAgentMessage('❌ Trade cancelled.');
  }, [addAgentMessage]);

  const syncMemwal = useCallback(async (walletAddress: string) => {
    try {
      const res = await fetch(`${AGENT_URL}/api/memwal/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress })
      });
      const data = await res.json();
      if (data.success && data.memories && data.memories.length > 0) {
        addAgentMessage(`🧠 Synced memory from MemWal:\n- ${data.memories.join('\n- ')}`);
        // Also send quietly to chat so agent context is updated
        fetch(`${AGENT_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: `(System) Memory update from MemWal: ${data.memories.join('; ')}`,
            sessionId: currentSessionId || 'default'
          })
        }).catch(() => {});
      } else {
        addAgentMessage(`🧠 Wallet connected — no MemWal memories yet.`);
      }
    } catch (err: any) {
      console.error('MemWal Sync Error:', err);
    }
  }, [addAgentMessage]);

  // Sync skill author addresses to backend for execution fee distribution
  const syncSkillAuthors = useCallback(async (walletAddress: string, authors: string[]) => {
    try {
      await fetch(`${AGENT_URL}/api/skills/authors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, authors })
      });
      console.log(`[Fee] Synced ${authors.length} skill authors to backend`);
    } catch (err: any) {
      console.error('Sync skill authors error:', err);
    }
  }, []);

  return {
    status, provider, error,
    messages, pendingTx, sessions, currentSessionId,
    initAgent, sendMessage,
    confirmTx, rejectTx,
    syncMemwal, syncSkillAuthors, createNewSession, switchSession,
  };
}
