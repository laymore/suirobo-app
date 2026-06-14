/**
 * useADKAgent — Hook kết nối React frontend với WebGPU Worker (Client-side 100%)
 *
 * Loại bỏ toàn bộ giao tiếp backend (npx adk web / Python) hoặc Gemini Cloud.
 * Mọi thứ chạy trên Web Worker của trình duyệt.
 */
import { useState, useRef, useCallback, useEffect } from 'react';

export type AgentStatus = 'idle' | 'loading' | 'ready' | 'thinking' | 'error';
export type ApiProvider = 'ollama'; // Chỉ giữ lại alias cho WebGPU để tương thích App.tsx

export function useADKAgent() {
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  const workerRef = useRef<Worker | null>(null);
  const resolvePromiseRef = useRef<((val: string) => void) | null>(null);

  useEffect(() => {
    // Khởi tạo Web Worker
    workerRef.current = new Worker(new URL('../ai.worker.ts', import.meta.url), { type: 'module' });

    workerRef.current.onmessage = (e: MessageEvent) => {
      const { type, status, progress, message, text, tool, args, data } = e.data;

      if (type === 'STATUS') {
        setStatus(status);
        if (progress !== undefined) setProgress(progress);
      } else if (type === 'PROGRESS') {
        setProgress(progress);
      } else if (type === 'ERROR') {
        setStatus('error');
        setError(message);
        if (resolvePromiseRef.current) {
          resolvePromiseRef.current(`[Lỗi] ${message}`);
          resolvePromiseRef.current = null;
        }
      } else if (type === 'THINKING') {
        setStatus('thinking');
      } else if (type === 'TOOL_CALL') {
        // Thông báo ra console khi Agent quyết định gọi tool
        console.log(`[Agent] Calling tool: ${tool}`, args);
      } else if (type === 'TOOL_RESULT') {
        // Có thể emit event ra UI để hiển thị popup xác nhận giao dịch (Human-in-the-Loop)
        console.log(`[Agent] Tool Result (HitL pending):`, data);
        // Tương lai: emit event qua EventTarget hoặc context để App.tsx bắt
        window.dispatchEvent(new CustomEvent('AGENT_TOOL_HITL', { detail: data }));
      } else if (type === 'REPLY') {
        setStatus('ready');
        if (resolvePromiseRef.current) {
          resolvePromiseRef.current(text);
          resolvePromiseRef.current = null;
        }
      }
    };

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  const loadModel = useCallback(() => {
    if (status !== 'idle' && status !== 'error') return;
    setStatus('loading');
    setProgress(0);
    setError(null);
    workerRef.current?.postMessage({ type: 'LOAD_MODEL' });
  }, [status]);

  // Dummy activateApi để tương thích với App.tsx cũ (sẽ không thực hiện API Cloud)
  const activateApi = useCallback((provider: any, key: string) => {
    console.warn("Cloud API disabled. Using WebGPU only.");
  }, []);

  const generate = useCallback((userMessage: string, onReply: (text: string) => void) => {
    if (status !== 'ready') return;
    setStatus('thinking');
    
    // Lưu callback để gọi khi Worker trả lời
    resolvePromiseRef.current = (text) => {
      onReply(text);
    };

    workerRef.current?.postMessage({
      type: 'GENERATE',
      payload: { text: userMessage }
    });
  }, [status]);

  return {
    status,
    progress,
    error,
    apiProvider: 'ollama' as ApiProvider, // Fake ollama to keep App UI green
    loadModel,
    activateApi,
    generate,
  };
}
