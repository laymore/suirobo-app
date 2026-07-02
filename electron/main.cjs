/**
 * Suirobo Desktop — Electron main process (Phase 1).
 *
 * Bundles everything into one local app:
 *   1. Forks the agent backend (dist-agent/agent-bundle.cjs) → opens the local
 *      HTTP/HTTPS/WS ports (3001/3002/8080/8081). The agent holds the key, signs
 *      trades, and connects to OpenClaw/Gemini/DeepSeek (reads openclaw.json).
 *   2. Serves the built React UI (dist/) from a tiny local static server and loads
 *      it in the window. A preload flag trims the UI to Trade + Backtest + My Bot.
 *   3. Auto-accepts the localhost self-signed cert so there's no manual step.
 */
const { app, BrowserWindow, shell, ipcMain, safeStorage } = require('electron');
const { fork } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

// Per-launch API token shared between the agent (env) and the renderer (preload).
// The agent rejects any /api or WS call that doesn't carry it, so a malicious web
// page can't drive the local bot (it can't read this value).
const AGENT_TOKEN = crypto.randomBytes(24).toString('hex');

// When packaged (portable .exe), app files live inside app.asar and the agent
// bundle is shipped unpacked under resources/. In dev (`npm run app`) everything
// is just the repo root. `app.isPackaged` is available right after require.
const PACKAGED = app.isPackaged;
const ROOT = path.join(__dirname, '..');                 // dev: repo root; packaged: inside app.asar
const RES = PACKAGED ? process.resourcesPath : ROOT;     // real on-disk dir for fork() targets
const DIST = path.join(__dirname, '..', 'dist');         // served via fs (Electron patches asar reads)
const AGENT_BUNDLE = path.join(RES, 'dist-agent', 'agent-bundle.cjs');
const STATIC_PORT = 4180;

let agentProc = null;
let staticServer = null;
let win = null;
let agentLogFd = null;

// ── Persistent wallet key, stored in the app's per-user data dir ──
// Encrypted at rest with Electron safeStorage (DPAPI on Windows / Keychain on
// macOS / libsecret on Linux) — a plaintext file with mode 0o600 is NOT enough
// on Windows, where any process running as the same user can read it. Legacy
// plaintext files are still readable and get re-encrypted on the next read.
function keyFile() { return path.join(app.getPath('userData'), 'wallet.key'); }

function encAvailable() {
  try { return !!(safeStorage && safeStorage.isEncryptionAvailable()); } catch { return false; }
}

function readStoredKey() {
  let buf;
  try { buf = fs.readFileSync(keyFile()); } catch { return null; }
  if (!buf || buf.length === 0) return null;
  // Try to decrypt (the normal path). If it isn't an encrypted blob (legacy
  // plaintext from an older build), decryptString throws → fall back to utf8.
  if (encAvailable()) {
    try {
      const dec = safeStorage.decryptString(buf).trim();
      return dec || null;
    } catch { /* legacy plaintext below */ }
  }
  const legacy = buf.toString('utf8').trim();
  if (!legacy) return null;
  // Migrate the legacy plaintext key to an encrypted file in place.
  if (encAvailable()) { try { writeStoredKey(legacy); } catch {} }
  return legacy;
}

function writeStoredKey(key) {
  const f = keyFile();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (encAvailable()) {
    fs.writeFileSync(f, safeStorage.encryptString(key), { mode: 0o600 });
  } else {
    // No OS encryption backend (rare) — fall back to a restricted plaintext file.
    fs.writeFileSync(f, key, { encoding: 'utf8', mode: 0o600 });
  }
}

// Derive the Sui address from the private key (so the agent + UI show the wallet).
async function deriveAddress(key) {
  try {
    const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
    const { decodeSuiPrivateKey } = await import('@mysten/sui/cryptography');
    const kp = key.startsWith('suiprivkey')
      ? Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(key).secretKey)
      : Ed25519Keypair.fromSecretKey(Buffer.from(key.replace('0x', ''), 'hex'));
    return kp.toSuiAddress();
  } catch (e) { console.error('[suirobo] deriveAddress failed', e?.message); return ''; }
}

// ── Start the agent backend (same code as the .exe) in a child process ──
// The persisted key + its derived address are injected as SUIROBO_DEV_WALLET /
// SUIROBO_DEV_ADDRESS so the agent signs trades and exposes the wallet — no
// browser wallet extension required.
async function startAgent() {
  if (!fs.existsSync(AGENT_BUNDLE)) {
    console.error('[suirobo] agent bundle not found:', AGENT_BUNDLE);
    return;
  }
  const storedKey = readStoredKey();
  const addr = storedKey ? await deriveAddress(storedKey) : '';
  // Agent runs fully hidden: no console window (windowsHide) and its stdout/stderr
  // go to a rotating-ish log file under userData instead of a visible terminal.
  if (agentLogFd == null) {
    try {
      const logPath = path.join(app.getPath('userData'), 'agent.log');
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      agentLogFd = fs.openSync(logPath, 'a');
    } catch { agentLogFd = 'ignore'; }
  }
  // Dev run finds .env/openclaw.json at the repo root; the packaged portable build
  // ships no secrets (per policy) — it runs the agent from userData and relies on
  // the injected wallet key + safe defaults.
  const agentCwd = PACKAGED ? app.getPath('userData') : ROOT;
  agentProc = fork(AGENT_BUNDLE, [], {
    cwd: agentCwd,
    windowsHide: true,
    env: {
      ...process.env,
      SUIROBO_DESKTOP: '1',
      SUIROBO_AGENT_TOKEN: AGENT_TOKEN,
      ...(storedKey ? { SUIROBO_DEV_WALLET: storedKey, SUIROBO_DEV_ADDRESS: addr } : {}),
    },
    stdio: ['ignore', agentLogFd, agentLogFd, 'ipc'],
  });
  agentProc.on('exit', (code) => console.log('[suirobo] agent exited:', code));
}

function restartAgent() {
  return new Promise((resolve) => {
    const proc = agentProc;
    agentProc = null;
    const boot = () => { startAgent().finally(resolve); };
    if (proc) { proc.once('exit', boot); try { proc.kill(); } catch { boot(); } }
    else { boot(); }
  });
}

// ── Renderer ↔ main: persist the key + restart the agent with it ──
ipcMain.handle('suirobo:saveKey', async (_e, key) => {
  if (typeof key !== 'string' || key.trim().length < 10) return { ok: false, error: 'invalid key' };
  writeStoredKey(key.trim());
  await restartAgent();
  return { ok: true };
});
ipcMain.handle('suirobo:clearKey', async () => {
  try { fs.unlinkSync(keyFile()); } catch {}
  await restartAgent();
  return { ok: true };
});
ipcMain.handle('suirobo:hasKey', () => !!readStoredKey());
// Synchronous so the preload can expose it on window before the bundle runs.
ipcMain.on('suirobo:agentToken', (e) => { e.returnValue = AGENT_TOKEN; });

// ── Serve the built React app over loopback (absolute /assets paths work) ──
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.map': 'application/json',
};
function serveDist() {
  return new Promise((resolve, reject) => {
    staticServer = http.createServer((req, res) => {
      let p = decodeURIComponent((req.url || '/').split('?')[0]);
      if (p === '/') p = '/index.html';
      let fp = path.join(DIST, p);
      if (!fp.startsWith(DIST) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
        fp = path.join(DIST, 'index.html'); // SPA fallback
      }
      fs.readFile(fp, (err, buf) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    staticServer.on('error', reject);
    staticServer.listen(STATIC_PORT, '127.0.0.1', () => resolve(`http://127.0.0.1:${STATIC_PORT}/`));
  });
}

// Auto-trust the agent's localhost self-signed cert (no manual "Accept cert" step).
app.on('certificate-error', (event, _wc, url, _err, _cert, callback) => {
  if (url.startsWith('https://localhost') || url.startsWith('https://127.0.0.1')) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});

app.whenReady().then(async () => {
  await startAgent();
  let url = `http://127.0.0.1:${STATIC_PORT}/`;
  try { url = await serveDist(); } catch (e) { console.error('[suirobo] static server failed', e); }

  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1100, minHeight: 700,
    backgroundColor: '#060e1e',
    title: 'Autobots — Trade & Backtest',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // DevTools stay available in dev, but are disabled in the packaged app so
      // users can't be social-engineered into pasting scripts into the console.
      devTools: !PACKAGED,
    },
  });
  win.removeMenu();
  win.loadURL(url);

  // Only ever open http/https. External links go to the system browser; the app's
  // own localhost content stays in-app. Any other scheme (file:, javascript:,
  // app-protocol handlers like steam://, etc.) is denied outright.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!/^https?:\/\//i.test(url)) return { action: 'deny' };
    const isLocal = url.includes('127.0.0.1') || url.includes('localhost');
    if (!isLocal) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
});

function cleanup() {
  try { agentProc && agentProc.kill(); } catch {}
  try { staticServer && staticServer.close(); } catch {}
}
app.on('window-all-closed', () => { cleanup(); app.quit(); });
app.on('before-quit', cleanup);
