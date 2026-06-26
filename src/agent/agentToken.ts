/**
 * agentToken — desktop API-token plumbing for the local agent.
 *
 * The Electron main process generates a random per-launch token and hands the
 * SAME value to (a) the bundled agent (env SUIROBO_AGENT_TOKEN) and (b) this
 * renderer (preload → window.SUIROBO_AGENT_TOKEN). The agent then rejects any
 * /api/* call or WS connection that doesn't carry it.
 *
 * Why: the agent listens on 127.0.0.1 and its CORS allowlist necessarily permits
 * *.wal.app / *.walrus.site — but anyone can deploy a Walrus site, so origin
 * alone can't stop a malicious page from driving the bot. A page can't read the
 * token (it lives in the desktop renderer / agent env, not reachable cross-origin),
 * so requiring it closes that hole.
 *
 * On the web build there is no window token (and the standalone agent sets no env
 * token), so everything here is a no-op and the existing flow is unchanged.
 */

export function agentToken(): string {
  try { return (window as any).SUIROBO_AGENT_TOKEN || ''; } catch { return ''; }
}

/** Append ?token= to a ws(s):// agent URL when a token is present. */
export function withWsToken(url: string): string {
  const t = agentToken();
  if (!t) return url;
  return url + (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(t);
}

const isAgentUrl = (u: string) =>
  /^https?:\/\/(localhost|127\.0\.0\.1):(3001|3002)(\/|\?|$)/.test(u);

/** Patch window.fetch ONCE so every request aimed at the local agent carries the
 *  token header. Covers both raw fetch() calls and the agentFetch() direct path.
 *  No-op when there is no token (web build / standalone agent). */
let __installed = false;
export function installAgentTokenInterceptor(): void {
  if (__installed || typeof window === 'undefined') return;
  const token = agentToken();
  if (!token) return;
  __installed = true;

  const orig = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url = '';
    try {
      url = typeof input === 'string' ? input
          : input instanceof URL ? input.href
          : (input as Request).url;
    } catch { /* leave url empty */ }

    if (url && isAgentUrl(url)) {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined)
      );
      headers.set('X-Suirobo-Token', token);
      init = { ...init, headers };
    }
    return orig(input as any, init);
  };
}
