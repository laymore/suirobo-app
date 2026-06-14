/**
 * i18n — English only (single-language UI)
 *
 * Web app hiển thị tiếng Anh duy nhất cho global users.
 * Agent phía server vẫn xử lý ngôn ngữ user nhập (English/Vietnamese/etc).
 */
import { useCallback } from 'react';
import { en } from './en';

export type Lang = 'en';

const DICTIONARIES = { en } as const;
export type Dict = typeof en;

// Hardcode English — không có store, không reactive
const currentLang: Lang = 'en';

if (typeof document !== 'undefined') {
  document.documentElement.lang = currentLang;
}

// ── Resolve nested key path: t('factory.tabs.market') ───────────────────────

function resolveKey(dict: any, path: string): string | undefined {
  return path.split('.').reduce((obj, key) => obj?.[key], dict);
}

export function translate(key: string, _lang: Lang = currentLang, vars?: Record<string, string | number>): string {
  let str = resolveKey(DICTIONARIES.en, key);
  if (typeof str !== 'string') return key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return str;
}

// Stub — giữ compatible API cho code đang import setLang
export function setLang(_lang: Lang) {}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useI18n() {
  const t = useCallback((key: string, vars?: Record<string, string | number>) =>
    translate(key, currentLang, vars), []);

  return { lang: currentLang, setLang, t };
}

// Helper exports
export { en };
