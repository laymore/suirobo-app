/**
 * useUserConfig — Quản lý toàn bộ cấu hình người dùng
 *
 * Nguyên tắc bảo mật:
 *  - API Key     → localStorage  (persist, mã hóa nhẹ bằng btoa)
 *  - Private Key → sessionStorage (tự xóa khi đóng tab)
 *  - Không có gì được gửi lên server ngoài localhost:3001
 */
import { useState, useEffect, useCallback } from 'react';
import { AGENT_URL } from '../agent/agentUrl';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface UserConfig {
  // AI
  provider:    'gemini' | 'deepseek' | 'openclaw';
  apiKey:      string;     // lưu localStorage (btoa)
  // Auto Bot
  hasPrivateKey: boolean;  // chỉ lưu flag — key thực ở sessionStorage
  // Setup
  setupDone:   boolean;
  setupVersion:number;     // tăng khi có breaking change
  // Agent
  agentUrl:    string;
}

const SETUP_VERSION = 2;
const LS_KEY   = 'suirobo_user_config';
const SS_KEY   = 'suirobo_pk_session'; // sessionStorage — tự xóa khi đóng tab

const DEFAULT_CONFIG: UserConfig = {
  provider:      'gemini',
  apiKey:        '',
  hasPrivateKey: false,
  setupDone:     false,
  setupVersion:  0,
  agentUrl:      `${AGENT_URL}`,
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function loadConfig(): UserConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const saved = JSON.parse(raw) as Partial<UserConfig>;
    return { ...DEFAULT_CONFIG, ...saved };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

function saveConfig(cfg: UserConfig) {
  const toSave = { ...cfg };
  // Không lưu private key vào localStorage — chỉ lưu flag
  localStorage.setItem(LS_KEY, JSON.stringify(toSave));
}

/** Mã hóa nhẹ key trước khi lưu localStorage (obfuscation, không phải encryption) */
function encodeKey(key: string): string {
  return btoa(encodeURIComponent(key));
}
function decodeKey(encoded: string): string {
  try { return decodeURIComponent(atob(encoded)); } catch { return ''; }
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useUserConfig() {
  const [config, setConfig] = useState<UserConfig>(loadConfig);
  const [agentOnline, setAgentOnline] = useState<boolean | null>(null); // null = checking

  // Sync config → localStorage on change
  useEffect(() => { saveConfig(config); }, [config]);

  // Check agent connection
  const checkAgent = useCallback(async (url?: string) => {
    const base = url || config.agentUrl;
    setAgentOnline(null);
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(3000) });
      setAgentOnline(res.ok);
      return res.ok;
    } catch {
      setAgentOnline(false);
      return false;
    }
  }, [config.agentUrl]);

  // Auto-check on mount
  useEffect(() => { checkAgent(); }, []);

  // ── API Key ──────────────────────────────────────────────────────────────────

  const saveApiKey = useCallback((provider: UserConfig['provider'], apiKey: string) => {
    setConfig(prev => ({
      ...prev,
      provider,
      apiKey: encodeKey(apiKey),
    }));
  }, []);

  const getApiKey = useCallback((): string => {
    return config.apiKey ? decodeKey(config.apiKey) : '';
  }, [config.apiKey]);

  // ── Private Key (sessionStorage) ─────────────────────────────────────────────

  const savePrivateKey = useCallback((key: string) => {
    if (!key) return;
    sessionStorage.setItem(SS_KEY, encodeKey(key));
    setConfig(prev => ({ ...prev, hasPrivateKey: true }));
  }, []);

  const getPrivateKey = useCallback((): string => {
    const raw = sessionStorage.getItem(SS_KEY);
    return raw ? decodeKey(raw) : '';
  }, []);

  const clearPrivateKey = useCallback(() => {
    sessionStorage.removeItem(SS_KEY);
    setConfig(prev => ({ ...prev, hasPrivateKey: false }));
  }, []);

  const hasValidPrivateKey = useCallback((): boolean => {
    return !!sessionStorage.getItem(SS_KEY);
  }, []);

  // ── Setup ─────────────────────────────────────────────────────────────────────

  const completeSetup = useCallback(() => {
    setConfig(prev => ({ ...prev, setupDone: true, setupVersion: SETUP_VERSION }));
  }, []);

  const resetSetup = useCallback(() => {
    setConfig({ ...DEFAULT_CONFIG });
    sessionStorage.removeItem(SS_KEY);
  }, []);

  /** Kiểm tra có cần chạy setup không */
  const needsSetup = !config.setupDone || config.setupVersion < SETUP_VERSION;

  return {
    config,
    needsSetup,
    agentOnline,
    checkAgent,
    // API
    saveApiKey,
    getApiKey,
    // Private Key
    savePrivateKey,
    getPrivateKey,
    clearPrivateKey,
    hasValidPrivateKey,
    // Setup
    completeSetup,
    resetSetup,
    // Utils
    setAgentUrl: (url: string) => setConfig(prev => ({ ...prev, agentUrl: url })),
  };
}

export type UserConfigReturn = ReturnType<typeof useUserConfig>;
