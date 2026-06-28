/**
 * Agent Bootstrap — Entry point cho .exe production
 *
 * Khi user double-click .exe, file này chạy đầu tiên:
 *  1. Detect lần cài đặt đầu tiên → setup auto-start, copy data dir
 *  2. Open browser tới wal.app (chỉ lần đầu)
 *  3. Spawn tray icon (nếu có)
 *  4. Khởi động Express + WebSocket
 *  5. Catch errors → ghi log + tray notification
 */
import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawn, exec } from 'child_process';

const HOME    = os.homedir();
const APPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const APP_DIR = path.join(APPDATA, 'Suirobo');
const DATA_DIR= path.join(APP_DIR, 'data');
const LOG_DIR = path.join(APP_DIR, 'logs');
const CONFIG_DIR = path.join(APP_DIR, 'config');
const CONFIG_FILE= path.join(CONFIG_DIR, 'user.json');
const VERSION_FILE = path.join(CONFIG_DIR, 'version.json');

// Version được inject lúc build qua esbuild --define BUILD_VERSION (identifier)
// Fallback về env var, sau cùng là '1.0.0'
declare const BUILD_VERSION: string;
const CURRENT_VERSION =
  (typeof BUILD_VERSION !== 'undefined' ? BUILD_VERSION : '') ||
  process.env.SUIROBO_VERSION ||
  '1.0.0';
const WEB_URL = process.env.SUIROBO_WEB_URL || 'http://localhost:5173';

// ─── 1. Setup directory structure (idempotent) ─────────────────────────────
function ensureDirs() {
  for (const dir of [APP_DIR, DATA_DIR, LOG_DIR, CONFIG_DIR,
                     path.join(DATA_DIR, '.local_skills')]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── 2. First-run detection ────────────────────────────────────────────────
function isFirstRun(): boolean {
  return !fs.existsSync(CONFIG_FILE);
}

function markFirstRunDone() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({
    installed_at: new Date().toISOString(),
    version: CURRENT_VERSION,
  }, null, 2));
}

// ─── 3. Auto-start on Windows boot ─────────────────────────────────────────
function registerAutoStart() {
  if (process.platform !== 'win32') return;
  const exePath = process.execPath; // path to autobots-agent.exe
  // Add to Windows registry Run key
  const regCmd = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "SuiroboAgent" /t REG_SZ /d "\\"${exePath}\\"" /f`;
  exec(regCmd, (err) => {
    if (err) console.error('Could not register auto-start:', err.message);
    else console.log('✅ Auto-start registered');
  });
}

function isAutoStartRegistered(): Promise<boolean> {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve(false);
    exec('reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "SuiroboAgent"',
      err => resolve(!err));
  });
}

// ─── 4. Open browser (chỉ lần đầu hoặc khi user click tray) ─────────────────
function openBrowser(url: string) {
  if (process.platform === 'win32') {
    exec(`start "" "${url}"`);
  } else if (process.platform === 'darwin') {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

// ─── 5. Setup logging ──────────────────────────────────────────────────────
function setupLogging() {
  const logFile = path.join(LOG_DIR, `agent-${new Date().toISOString().split('T')[0]}.log`);
  const stream = fs.createWriteStream(logFile, { flags: 'a' });
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    stream.write(`[${new Date().toISOString()}] [LOG] ${msg}\n`);
    origLog(...args);
  };
  console.error = (...args) => {
    const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    stream.write(`[${new Date().toISOString()}] [ERR] ${msg}\n`);
    origErr(...args);
  };
  // Crash handler
  process.on('uncaughtException', err => {
    fs.appendFileSync(path.join(LOG_DIR, 'crash.log'),
      `\n[${new Date().toISOString()}] ${err.stack || err.message}\n`);
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      origErr('❌ Port already in use — another Autobots (or another app) is running.');
      origErr('   Close the other agent window / end autobots-agent.exe in Task Manager,');
      origErr('   then open this file again.');
      origErr('\n   (this window closes in 15s)');
      setTimeout(() => process.exit(1), 15000);
      return;
    }
    origErr('FATAL:', err);
    origErr('\n   (this window closes in 15s — details saved to crash.log)');
    setTimeout(() => process.exit(1), 15000);
  });
}

// ─── 6. Show tray notification (Windows balloon tip) ───────────────────────
function showNotification(title: string, message: string) {
  if (process.platform !== 'win32') {
    console.log(`[${title}] ${message}`);
    return;
  }
  // Dùng PowerShell BurntToast / msg để hiển thị toast notification
  const ps = `
[reflection.assembly]::loadwithpartialname('System.Windows.Forms') | Out-Null
[reflection.assembly]::loadwithpartialname('System.Drawing') | Out-Null
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Information
$notify.Visible = $true
$notify.ShowBalloonTip(5000, '${title.replace(/'/g, "''")}', '${message.replace(/'/g, "''")}', [System.Windows.Forms.ToolTipIcon]::Info)
Start-Sleep -s 6
$notify.Dispose()
  `.trim();
  exec(`powershell -NoProfile -WindowStyle Hidden -Command "${ps.replace(/"/g, '\\"').replace(/\n/g, ';')}"`,
    () => {});
}

// ─── 7. Set agent runtime dirs (override default cwd-based paths) ──────────
function setAgentDataDirs() {
  process.env.SUIROBO_DATA_DIR  = DATA_DIR;
  process.env.SUIROBO_APP_DIR   = APP_DIR;
  process.env.SUIROBO_LOG_DIR   = LOG_DIR;
  // chdir cho relative paths trong local_agent.ts cũng work
  process.chdir(APP_DIR);
}

// ─── 8. Single-instance: detect + replace a running agent ──────────────────
const AGENT_PORT = 3001;

async function pingOldAgent(): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${AGENT_PORT}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch { return false; }
}

/** Pause so the console window doesn't flash-close before the user can read the error. */
function holdWindowOpen(seconds: number): Promise<void> {
  console.log(`\n   (this window closes in ${seconds}s)`);
  return new Promise(r => setTimeout(r, seconds * 1000));
}

/** Find the PID listening on the agent port and kill it — but ONLY if the
 *  process image is a suirobo agent, never an unrelated app. (Windows only.) */
function killOldAgentByPort(): Promise<boolean> {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve(false);
    exec(`netstat -ano -p tcp | findstr LISTENING | findstr :${AGENT_PORT}`, (err, out) => {
      const pid = out?.trim().split(/\s+/).pop();
      if (err || !pid || !/^\d+$/.test(pid) || +pid === process.pid) return resolve(false);
      exec(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, (err2, out2) => {
        if (err2 || !/autobots|suirobo/i.test(out2 || '')) return resolve(false);
        exec(`taskkill /PID ${pid} /F`, err3 => resolve(!err3));
      });
    });
  });
}

async function replaceOldInstance(): Promise<void> {
  if (!await pingOldAgent()) return; // ports free — nothing to do

  console.log('♻️  Another Autobots is already running — replacing it with this version...');
  try {
    await fetch(`http://localhost:${AGENT_PORT}/api/shutdown`, {
      method: 'POST',
      signal: AbortSignal.timeout(2000),
    });
  } catch { /* old versions (< v1.0.24) have no shutdown endpoint */ }

  // Wait up to 10s for the old process to release its ports.
  // Halfway through, fall back to force-killing the old suirobo-agent process
  // (pre-v1.0.24 builds don't understand the shutdown request).
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (!await pingOldAgent()) {
      console.log('✅ Old agent stopped — starting the new version.');
      await new Promise(r => setTimeout(r, 500)); // let the OS fully release sockets
      return;
    }
    if (i === 8 && await killOldAgentByPort()) {
      console.log('   (old agent did not respond — force-stopped it)');
    }
  }

  console.error('❌ Could not stop the running agent automatically.');
  console.error('   Please close the old "Autobots" window (or end autobots-agent.exe');
  console.error('   in Task Manager), then open this file again.');
  showNotification('❌ Autobots', 'Another agent is already running. Close it first, then reopen.');
  await holdWindowOpen(15);
  process.exit(1);
}

// ─── MAIN ──────────────────────────────────────────────────────────────────
async function bootstrap() {
  // Set console window title (hiển thị thay vì "node.exe" / random)
  try {
    process.title = `Autobots — Team Autobots`;
  } catch {}

  console.log('═══════════════════════════════════════════════════════');
  console.log(`  🤖 Autobots v${CURRENT_VERSION}`);
  console.log(`     by Team Autobots`);
  console.log(`     https://autobots.wal.app`);
  console.log('═══════════════════════════════════════════════════════');

  ensureDirs();
  setupLogging();
  setAgentDataDirs();

  // If an older agent is still running (auto-start or manual), stop it so this
  // version can take over its ports instead of flash-crashing with EADDRINUSE.
  await replaceOldInstance();

  const firstRun = isFirstRun();
  if (firstRun) {
    console.log('🎉 First run — setting up...');
    markFirstRunDone();
    showNotification(
      '🤖 Autobots installed',
      'Agent is running. Open the browser to start AI trading.'
    );
    setTimeout(() => openBrowser(WEB_URL), 2000);
  } else {
    console.log('✅ Agent restart (auto-start)');
  }
  // Always (re)point the Windows auto-start entry at THIS exe, so after an
  // update Windows boots the new version instead of the old downloaded file.
  registerAutoStart();

  // Save version
  fs.writeFileSync(VERSION_FILE, JSON.stringify({
    version: CURRENT_VERSION,
    last_started: new Date().toISOString(),
  }, null, 2));

  // Load main agent (static require — pkg/yao-pkg bundle được)
  console.log('⚙️  Loading agent core...');
  loadLocalAgent();
}

// Static require — esbuild + pkg bundle tốt
function loadLocalAgent() {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('./local_agent.js');
}

bootstrap().catch(err => {
  console.error('❌ Bootstrap failed:', err);
  showNotification('❌ Autobots error', String(err.message || err));
  process.exit(1);
});
