/**
 * Suirobo Agent Bridge — Service Worker
 *
 * Vai trò: Proxy HTTP requests từ web HTTPS đến agent HTTP localhost.
 * Extension context có quyền truy cập cả 2, không bị Mixed Content block.
 *
 * API:
 *  - chrome.runtime.onMessage:
 *      { type: 'health' }       → trả status agent
 *      { type: 'fetch', url, method, body, headers } → proxy fetch
 *      { type: 'ws-connect' }   → bắt đầu WebSocket bridge
 *      { type: 'ws-send', data }→ gửi WS message
 *      { type: 'ws-close' }     → đóng WS
 */

const AGENT_HTTP  = 'http://localhost:3001';
const AGENT_WS    = 'ws://localhost:8080';

let wsBridge = null;
let wsClients = new Set(); // tabs subscribe WS messages

// ─── Health check helper ─────────────────────────────────────────────────
async function checkAgent() {
  try {
    const r = await fetch(`${AGENT_HTTP}/health`, { signal: AbortSignal.timeout(3000) });
    return { online: r.ok, status: r.status };
  } catch (e) {
    return { online: false, error: e.message };
  }
}

// ─── HTTP Proxy ─────────────────────────────────────────────────────────
async function proxyFetch({ url, method = 'GET', body, headers = {} }) {
  // Chỉ allow URLs đến localhost:3001 — bảo mật
  if (!url.startsWith(AGENT_HTTP)) {
    return { error: 'URL must start with ' + AGENT_HTTP, status: 403 };
  }

  try {
    const opts = { method, headers };
    if (body) {
      opts.body = typeof body === 'string' ? body : JSON.stringify(body);
      opts.headers = { 'Content-Type': 'application/json', ...headers };
    }
    const res = await fetch(url, opts);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { error: e.message, status: 0 };
  }
}

// ─── WebSocket Bridge ───────────────────────────────────────────────────
function ensureWs() {
  if (wsBridge && wsBridge.readyState === WebSocket.OPEN) return wsBridge;
  if (wsBridge && wsBridge.readyState === WebSocket.CONNECTING) return wsBridge;

  wsBridge = new WebSocket(AGENT_WS);

  wsBridge.onopen = () => {
    broadcastToClients({ type: 'WS_OPEN' });
  };
  wsBridge.onmessage = (evt) => {
    // Forward msg cho tất cả tabs
    try {
      const data = JSON.parse(evt.data);
      broadcastToClients({ type: 'WS_MESSAGE', payload: data });
    } catch {
      broadcastToClients({ type: 'WS_MESSAGE', payload: evt.data });
    }
  };
  wsBridge.onerror = () => broadcastToClients({ type: 'WS_ERROR' });
  wsBridge.onclose = () => {
    broadcastToClients({ type: 'WS_CLOSE' });
    wsBridge = null;
  };

  return wsBridge;
}

function broadcastToClients(message) {
  // Gửi message cho mọi tab đã connect
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach(tab => {
      if (tab.id && tab.url && (tab.url.includes('.wal.app') || tab.url.includes('localhost'))) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    });
  });
}

// ─── Message Handler từ web app ─────────────────────────────────────────
chrome.runtime.onMessageExternal.addListener(async (msg, sender, sendResponse) => {
  // Chỉ accept từ tab .wal.app
  const senderUrl = sender.url || '';
  if (!senderUrl.includes('.wal.app') && !senderUrl.includes('localhost')) {
    sendResponse({ error: 'Origin not allowed' });
    return;
  }

  try {
    if (msg.type === 'PING') {
      sendResponse({ pong: true, version: chrome.runtime.getManifest().version });

    } else if (msg.type === 'HEALTH') {
      sendResponse(await checkAgent());

    } else if (msg.type === 'FETCH') {
      sendResponse(await proxyFetch(msg));

    } else if (msg.type === 'WS_CONNECT') {
      wsClients.add(sender.tab?.id);
      ensureWs();
      sendResponse({ connecting: true });

    } else if (msg.type === 'WS_SEND') {
      if (wsBridge && wsBridge.readyState === WebSocket.OPEN) {
        wsBridge.send(typeof msg.data === 'string' ? msg.data : JSON.stringify(msg.data));
        sendResponse({ sent: true });
      } else {
        sendResponse({ error: 'WS not open' });
      }

    } else if (msg.type === 'WS_CLOSE') {
      if (wsBridge) wsBridge.close();
      wsBridge = null;
      sendResponse({ closed: true });
    }
  } catch (e) {
    sendResponse({ error: e.message });
  }
  return true; // async response
});

// Listen also from content scripts (same-extension)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Forward to externalListener logic
  chrome.runtime.onMessageExternal.dispatch?.(msg, sender, sendResponse);
  return true;
});

console.log('🌉 Suirobo Agent Bridge service worker started');
