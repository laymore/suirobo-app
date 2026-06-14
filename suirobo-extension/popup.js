(async () => {
  const statusEl = document.getElementById('status');
  const verEl = document.getElementById('ver');
  verEl.textContent = chrome.runtime.getManifest().version;

  try {
    const res = await fetch('http://localhost:3001/health', { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json();
      statusEl.className = 'status ok';
      statusEl.textContent = '✅ Agent đang chạy (' + JSON.stringify(data) + ')';
    } else {
      throw new Error('Status ' + res.status);
    }
  } catch (e) {
    statusEl.className = 'status err';
    statusEl.innerHTML = '❌ Agent offline<br/><small style="color:#94a3b8">Bật suirobo-agent.exe để kích hoạt</small>';
  }
})();
