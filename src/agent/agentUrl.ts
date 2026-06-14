/**
 * Agent URL Resolver — 3 modes:
 *
 *  [A] Extension Bridge (Walrus HTTPS + có extension)
 *      → Proxy qua chrome.runtime sendMessage → HTTP localhost
 *      → Không cần cert, không Mixed Content
 *
 *  [B] Direct HTTPS (Walrus HTTPS + chưa cài extension)
 *      → fetch https://localhost:3002 — cần self-signed cert
 *
 *  [C] Direct HTTP (dev mode localhost:5173)
 *      → fetch http://localhost:3001
 */

const isHttps = typeof window !== 'undefined' && window.location.protocol === 'https:';

// Extension constants
const SUIROBO_EXT_GLOBAL_KEY = '__SUIROBO_EXT_ID__';

export const AGENT_HTTP_URL  = 'http://localhost:3001';
export const AGENT_HTTPS_URL = 'https://localhost:3002';

/** URL trực tiếp (không qua extension) */
export const AGENT_URL = isHttps ? AGENT_HTTPS_URL : AGENT_HTTP_URL;

/** WebSocket URL */
export const AGENT_WS_URL = isHttps ? 'wss://localhost:8081' : 'ws://localhost:8080';

/** URL accept cert first time */
export const AGENT_CERT_ACCEPT_URL = `${AGENT_HTTPS_URL}/health`;

// ─── Extension Bridge Detection ───────────────────────────────────────────────

let _extensionId: string | null = null;
let _bridgeReady = false;
const _bridgeListeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  // Listen for content-script announcement
  window.addEventListener('suirobo-bridge-ready', ((ev: CustomEvent) => {
    _extensionId = ev.detail?.extensionId || (window as any)[SUIROBO_EXT_GLOBAL_KEY] || null;
    _bridgeReady = true;
    _bridgeListeners.forEach(fn => fn());
  }) as any);

  // Check existing global (extension đã inject trước khi listener attach)
  setTimeout(() => {
    const existing = (window as any)[SUIROBO_EXT_GLOBAL_KEY];
    if (existing && !_extensionId) {
      _extensionId = existing;
      _bridgeReady = true;
      _bridgeListeners.forEach(fn => fn());
    }
  }, 100);
}

export function hasExtensionBridge(): boolean {
  return _bridgeReady && !!_extensionId;
}

export function getExtensionId(): string | null {
  return _extensionId;
}

export function onBridgeReady(callback: () => void): () => void {
  if (_bridgeReady) callback();
  else _bridgeListeners.add(callback);
  return () => _bridgeListeners.delete(callback);
}

// ─── Bridge Fetch — drop-in replacement cho window.fetch ──────────────────────

/**
 * Fetch wrapper:
 *  - HTTPS web + có extension → proxy qua chrome.runtime
 *  - Otherwise → fetch trực tiếp (HTTP localhost dev hoặc HTTPS localhost prod)
 */
export async function agentFetch(
  pathOrUrl: string,
  init?: RequestInit
): Promise<Response> {
  // Resolve full URL nếu chỉ path
  const url = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : `${AGENT_HTTP_URL}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;

  // Nếu có extension bridge → dùng nó
  if (isHttps && hasExtensionBridge() && _extensionId && (window as any).chrome?.runtime?.sendMessage) {
    try {
      const result = await new Promise<any>((resolve, reject) => {
        (window as any).chrome.runtime.sendMessage(
          _extensionId,
          {
            type: 'FETCH',
            url: url.replace(AGENT_HTTPS_URL, AGENT_HTTP_URL),
            method: init?.method || 'GET',
            body:    init?.body,
            headers: init?.headers,
          },
          (resp: any) => {
            const err = (window as any).chrome.runtime.lastError;
            if (err) reject(new Error(err.message));
            else if (resp?.error) reject(new Error(resp.error));
            else resolve(resp);
          }
        );
      });

      // Convert bridge response → standard Response
      const body = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
      return new Response(body, {
        status:  result.status || 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (e) {
      // Fallback to direct fetch nếu extension fail
      console.warn('Extension bridge failed, fallback to direct:', e);
    }
  }

  // Direct fetch (HTTP dev hoặc HTTPS prod with cert)
  const targetUrl = isHttps && url.startsWith(AGENT_HTTP_URL)
    ? url.replace(AGENT_HTTP_URL, AGENT_HTTPS_URL)
    : url;
  return fetch(targetUrl, init);
}
