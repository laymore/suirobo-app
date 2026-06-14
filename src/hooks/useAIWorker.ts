// Hook quản lý AI — Web Worker (local) + Gemini API (fallback)
import { useEffect, useRef, useState, useCallback } from 'react';

export type ApiProvider = 'gemini' | 'gpt' | 'deepseek';
export type AIStatus = 'idle' | 'loading' | 'ready' | 'thinking' | 'error' | 'api';

const SYSTEM_PROMPT = `Bạn là SUIROBO — trợ lý robot AI thông minh chuyên quản lý ví Sui blockchain.
Khả năng: theo dõi tài sản ví Sui, giải thích giao dịch, tư vấn Walrus/MemWal/SEAL/DeFi/NFT.
Phong cách: ngắn gọn, chính xác, thân thiện kiểu robot. Dùng tiếng Việt. Tối đa 3-4 câu.`;

async function callApi(text: string, apiKey: string, provider: ApiProvider, systemPrompt: string = SYSTEM_PROMPT): Promise<string> {
  if (provider === 'gemini') {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\nNgười dùng: ${text}` }] }],
          generationConfig: { maxOutputTokens: 300, temperature: 0.7 },
        }),
      }
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || 'Không nhận được phản hồi.';
  } else {
    const url = provider === 'deepseek' ? 'https://api.deepseek.com/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const model = provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        temperature: 0.7,
        max_tokens: 300
      })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content || 'Không nhận được phản hồi.';
  }
}

export function useAIWorker() {
  const workerRef = useRef<Worker | null>(null);
  const [status, setStatus] = useState<AIStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState<string>('');
  const [apiProvider, setApiProvider] = useState<ApiProvider | null>(null);
  const onReplyRef = useRef<((text: string) => void) | null>(null);
  const loadTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const worker = new Worker(
        new URL('../ai.worker.ts', import.meta.url),
        { type: 'module' }
      );
      workerRef.current = worker;

      worker.onmessage = (e) => {
        const { type, status: s, progress: p, text, message } = e.data;

        if (type === 'STATUS') {
          setStatus(s);
          if (p !== undefined) setProgress(p);
          if (s === 'ready' && loadTimeoutRef.current) {
            clearTimeout(loadTimeoutRef.current);
          }
        }
        if (type === 'PROGRESS') {
          setProgress(p);
        }
        if (type === 'THINKING') {
          setStatus('thinking');
        }
        if (type === 'REPLY') {
          setStatus(apiProvider ? 'api' : 'ready');
          onReplyRef.current?.(text);
        }
        if (type === 'ERROR') {
          console.warn('[AI Worker] Error:', message);
          setError(message);
          setStatus('error');
        }
      };

      worker.onerror = (e) => {
        console.warn('[AI Worker] Worker crashed:', e.message);
        setError(e.message);
        setStatus('error');
      };
    } catch (err: any) {
      console.warn('[AI Worker] Cannot create worker:', err);
      setStatus('error');
    }

    return () => {
      workerRef.current?.terminate();
      if (loadTimeoutRef.current) clearTimeout(loadTimeoutRef.current);
    };
  }, []);

  const hasRestored = useRef(false);

  const loadModel = useCallback(() => {
    setStatus('loading');
    setProgress(2);
    setError(null);
    setApiProvider(null);
    setApiKey('');
    localStorage.setItem('suirobo_ai_preference', 'local');
    workerRef.current?.postMessage({ type: 'LOAD_MODEL' });

    // Timeout 90 giây — nếu không xong, báo lỗi gợi ý dùng Gemini
    loadTimeoutRef.current = setTimeout(() => {
      setStatus(prev => {
        if (prev === 'loading') {
          setError('Tải model quá lâu. Hãy thử dùng Gemini API thay thế.');
          return 'error';
        }
        return prev;
      });
    }, 90000);
  }, []);

  const activateApi = useCallback((provider: ApiProvider, key: string) => {
    setApiProvider(provider);
    setApiKey(key);
    setStatus('api');
    setProgress(100);
    setError(null);
    localStorage.setItem('suirobo_ai_preference', 'api');
    localStorage.setItem('suirobo_api_provider', provider);
    localStorage.setItem('suirobo_api_key', key);
  }, []);

  // Auto-restore preference on mount
  useEffect(() => {
    if (hasRestored.current) return;
    hasRestored.current = true;
    
    const pref = localStorage.getItem('suirobo_ai_preference');
    if (pref === 'api' || pref === 'gemini') {
      const p = (localStorage.getItem('suirobo_api_provider') as ApiProvider) || 'gemini';
      const k = localStorage.getItem('suirobo_api_key') || localStorage.getItem('suirobo_gemini_key');
      if (k) activateApi(p, k);
    } else if (pref === 'local') {
      // Đợi worker init một chút rồi load
      setTimeout(() => loadModel(), 500);
    }
  }, [loadModel, activateApi]);

  const generate = useCallback((text: string, onReply: (t: string) => void, customPersona?: string) => {
    onReplyRef.current = onReply;
    const finalSystemPrompt = customPersona ? `${SYSTEM_PROMPT}\n\n${customPersona}` : SYSTEM_PROMPT;

    if (apiProvider && apiKey) {
      setStatus('thinking');
      callApi(text, apiKey, apiProvider, finalSystemPrompt)
        .then((reply) => {
          setStatus('api');
          onReply(reply);
        })
        .catch((err) => {
          setStatus('error');
          setError(err.message);
          onReply(`[Lỗi API ${apiProvider}] ${err.message}`);
        });
      return;
    }

    // Dùng local worker
    workerRef.current?.postMessage({ type: 'GENERATE', payload: { text, systemPrompt: finalSystemPrompt } });
  }, [apiProvider, apiKey]);

  return { status, progress, error, apiKey, apiProvider, loadModel, activateApi, generate };
}
