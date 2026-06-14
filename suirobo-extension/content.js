/**
 * Suirobo Content Script — Inject vào trang autobots.wal.app
 *
 * Đặt window.SUIROBO_BRIDGE để web app detect + dùng extension proxy.
 */
(function() {
  if (window.SUIROBO_BRIDGE) return; // đã inject

  // Tạo bridge object
  window.SUIROBO_BRIDGE = {
    version: chrome.runtime.getManifest?.()?.version || '1.0.0',
    extensionId: chrome.runtime.id,
    available: true,
  };

  // Inject script vào page context (chrome.runtime không available trong page directly)
  const script = document.createElement('script');
  script.textContent = `
    window.__SUIROBO_EXT_ID__ = '${chrome.runtime.id}';
    window.__SUIROBO_BRIDGE_VERSION__ = '${chrome.runtime.getManifest?.()?.version || '1.0.0'}';
    window.dispatchEvent(new CustomEvent('suirobo-bridge-ready', {
      detail: { extensionId: '${chrome.runtime.id}' }
    }));
  `;
  (document.head || document.documentElement).appendChild(script);
  script.remove();

  // Listen WS messages từ background → relay to page via postMessage
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type && msg.type.startsWith('WS_')) {
      window.postMessage({ source: 'suirobo-extension', ...msg }, '*');
    }
  });
})();
