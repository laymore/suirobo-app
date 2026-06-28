/**
 * Live Trade Agent — Bot Skill Engine
 *
 * Hai chế độ thực thi:
 *
 *  [A] AGENT MODE (mặc định)
 *      Signal → POST /api/chat → Agent xây PTB → broadcast WS → Frontend ký
 *
 *  [B] DIRECT AUTONOMOUS MODE (directMode: true + privateKey)
 *      Signal → xây PTB trực tiếp (DeepBook SDK) → ký keypair → execute Sui
 *      ✅ Không cần Agent, không cần Frontend, không cần confirm
 *      ⚠️  Private key phải được bảo vệ, KHÔNG lưu vào disk
 */

import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import fetch from 'node-fetch';
import * as fsMod from 'fs';
import * as pathMod from 'path';
import * as httpsMod from 'https';
import fs from 'fs';
import path from 'path';
import { Transaction } from '@mysten/sui/transactions';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { DeepBookClient } from '@mysten/deepbook-v3';
import { detectLiveSignal, manageExit, inSession, calcMargin, type Candle, type IndicatorType, type ExitReason, type FilterBlock } from '../src/agent/backtestEngine.js';
import { OnchainCandleFeed } from '../src/agent/deepbookTape.js';
import { injectExecutionFee, injectBotOpenFee } from '../src/agent/tools/executionFee.js';
import { buildOrderTx } from '../src/agent/tools/deeptrade_xbtc.js';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface LiveBotConfig {
  botSkillName:    string;
  signal:          IndicatorType;
  filters?:        FilterBlock[];
  direction:       'both' | 'long_only' | 'short_only';
  takeProfitPct:   number;
  stopLossPct:     number;
  trailingStopPct: number;
  enableTrailing:  boolean;
  enableDefense:   boolean;
  leverage:        number;
  orderPct:        number;
  commission:      number;
  timeframe:       string;
  pair:            string;
  capitalSUI:      number;   // vốn tính bằng SUI (để phù hợp với DeepBook margin)
  walletAddress:   string;
  // ── Agent mode ──
  apiKey?:         string;
  provider?:       'gemini' | 'deepseek' | 'openclaw';
  sessionId?:      string;
  // ── Direct autonomous mode ──
  directMode?:     boolean;
  privateKey?:     string;   // suiprivkey... hoặc hex — KHÔNG lưu disk
  // ── DeepTrade spot (xBTC/USDC) ──
  // Per-user objects from deeptrade_xbtc_setup. Required to place REAL DeepTrade orders.
  balanceManagerId?: string;
  feeManagerId?:     string;
  // ── Tunable entry-indicator inputs (EMA/MA/RSI/Bollinger) ──
  emaFast?: number; emaSlow?: number; maFast?: number; maSlow?: number;
  rsiPeriod?: number; rsiOversold?: number; rsiOverbought?: number;
  bbPeriod?: number; bbStdDev?: number;
  // ── Supertrend EA inputs (ATR period + multiplier) ──
  supertrendPeriod?: number;
  supertrendMult?:   number;
  // ── Range-breakout EA inputs ──
  breakoutPeriod?:   number;   // Donchian lookback bars (default 20)
  maxBarsInTrade?:   number;   // EA time-stop: force-close after N bars (0 = off)
  // ── MTF trend filter (HTF Supertrend gates entry direction) ──
  htfMinutes?:            number;   // e.g. 240 = H4
  htfSupertrendPeriod?:   number;
  htfSupertrendMult?:     number;
  // ── EA money-management module (mirrors BacktestConfig — same names) ──
  sizingMode?:          'fixed_pct' | 'risk_pct';
  riskPct?:             number;
  breakEvenTriggerPct?: number;
  cooldownBars?:        number;
  maxConsecLosses?:     number;
  maxDailyLossPct?:     number;
  sessionStartHour?:    number;
  sessionEndHour?:      number;
  // ── Liquidation guard (DeepBook margin) ──
  // Flatten the open position when the on-chain risk ratio drops below this, so the
  // protocol never force-liquidates the account (which costs a liquidation penalty).
  // undefined → default = liquidationRiskRatio + 0.10 ; 0 → guard disabled.
  liqGuardRatio?:       number;
  // ── Sui-Native Data Spine: candles from the DeepBook on-chain fill-tape ──
  // When true (SUI/USDC only), the bot builds candles from DeepBook fills instead of
  // Binance — no CEX REST in the critical path. Default off. (DA-3b)
  onchainCandles?:      boolean;
  // ── Order-book imbalance entry filter (live-only; DeepBook on-chain L2) ──
  // Require the order book to agree with the entry side: LONG only when OBI ≥ +t,
  // SHORT only when OBI ≤ −t (t = this fraction, e.g. 0.10). 0/undefined → off.
  // Not back-testable (book depth isn't in OHLC), so live-only.
  obiFilter?:           number;
  // ── Bot skill author wallet (receives the 0.005 SUI author share per OPEN) ──
  // No randomness — fee always goes to the author of the skill currently in use.
  // Omit / empty string → fee is skipped entirely (e.g. self-built unpublished skill).
  skillAuthor?: string;
  // ── Optional AI safety check (off by default, $0 cost when off) ──
  // When enabled, every bot signal is sent to an LLM for an extra approve/reject
  // verdict BEFORE the server signs and executes. The bot still computes its own
  // signal — the AI cannot create trades, only veto ones it considers unsafe.
  aiValidation?: {
    enabled:  boolean;
    provider: 'gemini' | 'deepseek' | 'openclaw';
    apiKey?:  string;     // openclaw reads from openclaw.json, no key needed here
  };
}

export interface ActivePosition {
  type:            'LONG' | 'SHORT';
  entryPrice:      number;
  entryTime:       string;
  tpPrice:         number;
  slPrice:         number;
  trailPeak:       number;
  beApplied?:      boolean;   // breakeven moved the SL to entry (EA module)
  borrowAsset:     string;
  borrowAmount:    number;
  unrealizedPnl:   number;
  unrealizedPct:   number;
}

export interface TradeLog {
  id:    number;
  time:  string;
  type:  'info' | 'signal' | 'trade' | 'error' | 'warning';
  msg:   string;
  price?: number;
  pnl?:   number;
  txDigest?: string;
}

interface BotState {
  active:         boolean;
  config:         Omit<LiveBotConfig, 'privateKey'> | null; // ← privateKey KHÔNG bao giờ lưu vào state
  position:       ActivePosition | null;
  currentPrice:   number;
  lastSignal:     'BUY' | 'SELL' | 'HOLD';
  lastIndicators: { rsi: number; ema9: number; ema21: number; macdHist: number; bbUpper: number; bbLower: number };
  tradeCount:     number;
  totalPnl:       number;
  logs:           TradeLog[];
  lastUpdate:     string;
  pollInterval:   number;
  mode:           'agent' | 'direct';
  riskRatio:      number | null;  // DeepBook margin risk ratio while in a position (null = flat/unknown)
  liqThreshold:   number;          // protocol liquidationRiskRatio for the pool (e.g. 1.1)
}

// ─── State ─────────────────────────────────────────────────────────────────────

const STATE_FILE = path.join(process.cwd(), 'server', 'bot_state.json');

const state: BotState = {
  active: false, config: null, position: null,
  currentPrice: 0, lastSignal: 'HOLD',
  lastIndicators: { rsi: 50, ema9: 0, ema21: 0, macdHist: 0, bbUpper: 0, bbLower: 0 },
  tradeCount: 0, totalPnl: 0, logs: [],
  lastUpdate: '', pollInterval: 30_000, mode: 'agent',
  riskRatio: null, liqThreshold: 0,
};

// Lưu riêng private key trong memory, không vào state
// Ưu tiên: 1) Env var (dev key) → 2) UI input → 3) null
let _cachedPrivateKey: string | null = process.env.SUIROBO_DEV_WALLET || null;

// Log dev key đã load (chỉ address, không log key)
if (_cachedPrivateKey) {
  const devAddr = process.env.SUIROBO_DEV_ADDRESS || '(unknown address)';
  console.log(`🔑 [Dev Wallet] Loaded from .env — Address: ${devAddr}`);
}

// Bump when the persisted shape changes incompatibly. On a version mismatch we
// keep the harmless counters but DROP any saved position — loading a stale/malformed
// position is the dangerous case (the bot would think it holds something it doesn't).
const STATE_VERSION = 2;
function isValidPosition(p: any): boolean {
  return !!p && typeof p === 'object'
    && (p.type === 'LONG' || p.type === 'SHORT')
    && typeof p.entryPrice === 'number' && isFinite(p.entryPrice)
    && typeof p.borrowAmount === 'number' && isFinite(p.borrowAmount);
}

try {
  if (fs.existsSync(STATE_FILE)) {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const compatible = saved.version === STATE_VERSION;
    state.position   = (compatible && isValidPosition(saved.position)) ? saved.position : null;
    state.tradeCount = Number.isFinite(saved.tradeCount) ? saved.tradeCount : 0;
    state.totalPnl   = Number.isFinite(saved.totalPnl)   ? saved.totalPnl   : 0;
    state.config     = saved.config ?? null;
    state.mode       = saved.mode   ?? 'agent';
    if (!compatible && saved.position) {
      console.log('[bot_state] schema changed — dropped a stale saved position (started flat)');
    }
  }
} catch { /* ignore */ }

function persistState() {
  try {
    // ⚠️  Never write the privateKey to disk.
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      version: STATE_VERSION,
      position: state.position, tradeCount: state.tradeCount,
      totalPnl: state.totalPnl, config: state.config, mode: state.mode,
    }));
  } catch { /* ignore */ }
}

// ─── Candles cache + Trade History ────────────────────────────────────────────
// candlesCache: the latest klines fetched by tradingTick — exposed to the UI so
// the Live Trade chart shows the EXACT data the bot trades on (no second feed).
let candlesCache: Candle[] = [];

export interface TradeRecord {
  id:        number;
  openTime:  string;        // ISO
  closeTime: string | null; // ISO — null while the position is still open
  side:      'LONG' | 'SHORT';
  pair:      string;
  entry:     number;
  exit:      number | null;
  pnlPct:    number | null; // leveraged %, set on close
  pnlVal:    number | null;
  reason:    string | null; // TP / SL / Trailing / Signal / Manual
  openTx:    string | null;
  closeTx:   string | null;
  skill:     string;
}

const HISTORY_FILE = path.join(process.cwd(), 'server', 'trade_history.json');
let tradeHistory: TradeRecord[] = [];
let tradeRecId = 0;
try {
  if (fs.existsSync(HISTORY_FILE)) {
    tradeHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    tradeRecId = tradeHistory.reduce((m, r) => Math.max(m, r.id), 0);
  }
} catch { /* start empty */ }

function persistHistory() {
  try {
    // Keep the file bounded — 500 most recent trades is plenty for the UI.
    if (tradeHistory.length > 500) tradeHistory.length = 500;
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(tradeHistory));
  } catch { /* ignore */ }
}

function recordOpen(side: 'LONG' | 'SHORT', entry: number, digest: string | null) {
  const cfg = state.config as LiveBotConfig | null;
  tradeHistory.unshift({
    id: ++tradeRecId,
    openTime: new Date().toISOString(), closeTime: null,
    side, pair: cfg?.pair ?? '?', entry, exit: null,
    pnlPct: null, pnlVal: null, reason: null,
    openTx: digest, closeTx: null,
    skill: cfg?.botSkillName ?? '?',
  });
  persistHistory();
}

function recordClose(exit: number, pnlPct: number, pnlVal: number, reason: string, digest: string | null) {
  // Close the most recent record that's still open (LIFO — bot holds 1 position at a time).
  const rec = tradeHistory.find(r => r.closeTime === null);
  if (rec) {
    rec.closeTime = new Date().toISOString();
    rec.exit = exit; rec.pnlPct = pnlPct; rec.pnlVal = pnlVal;
    rec.reason = reason; rec.closeTx = digest;
    persistHistory();
  }
}

let logId = 0;
function addLog(type: TradeLog['type'], msg: string, price?: number, pnl?: number, txDigest?: string) {
  const entry: TradeLog = { id: ++logId, time: new Date().toLocaleTimeString('en-GB'), type, msg, price, pnl, txDigest };
  state.logs.unshift(entry);
  if (state.logs.length > 300) state.logs.length = 300;
  console.log(`[LiveBot][${type.toUpperCase()}] ${msg}${txDigest ? ' | Tx: ' + txDigest.slice(0, 12) + '...' : ''}`);
  return entry;
}

// ─── WebSocket ─────────────────────────────────────────────────────────────────

// ws://127.0.0.1:8080 cho dev (HTTP web) — loopback only
const wss = new WebSocketServer({ port: 8080, host: '127.0.0.1' });
console.log('🔌 LiveBot WebSocket (ws)  on ws://127.0.0.1:8080  (dev)');

// WS control surface accepts SET_CONFIG / TOGGLE_BOT, so it gets the SAME guards
// as the HTTP /api: origin must be allow-listed, and — on desktop, where a token
// is provisioned — the connection must carry ?token=<token>.
const WS_TOKEN = process.env.SUIROBO_AGENT_TOKEN || '';
function wsOriginAllowed(origin?: string): boolean {
  if (!origin || origin === 'null') return true;
  try {
    const h = new URL(origin).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.wal.app') || h.endsWith('.walrus.site');
  } catch { return false; }
}

// wss://localhost:8081 cho Walrus HTTPS web — sync vì pkg không support dynamic import
(() => {
  const DATA_ROOT2 = process.env.SUIROBO_DATA_DIR || process.cwd();
  const certDir = pathMod.join(DATA_ROOT2, 'certs');
  const certPath = pathMod.join(certDir, 'localhost.crt');
  const keyPath = pathMod.join(certDir, 'localhost.key');

  function startWss() {
    if (!fsMod.existsSync(certPath) || !fsMod.existsSync(keyPath)) return false;
    try {
      const httpsServer = httpsMod.createServer({
        cert: fsMod.readFileSync(certPath),
        key:  fsMod.readFileSync(keyPath),
      });
      const wssSecure = new WebSocketServer({ server: httpsServer });
      wssSecure.on('connection', (...args: any[]) => (wss as any).emit('connection', ...args));
      httpsServer.listen(8081, '127.0.0.1', () => {
        console.log('🔒 LiveBot WebSocket (wss) on wss://localhost:8081 (HTTPS)');
      });
      return true;
    } catch (e: any) {
      console.warn('⚠️  WSS start failed:', e.message);
      return false;
    }
  }

  if (!startWss()) {
    // Cert chưa có → retry mỗi 3s, tối đa 10 lần
    let attempts = 0;
    const retry = setInterval(() => {
      if (startWss() || ++attempts >= 10) clearInterval(retry);
    }, 3000);
  }
})();

function broadcast(data: any) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(msg); });
}

function broadcastState() {
  broadcast({ type: 'BOT_STATE', ...state, logs: state.logs.slice(0, 80) });
}

wss.on('connection', (ws, req: any) => {
  // Reject cross-origin connections, and (desktop) those without the token.
  const origin = req?.headers?.origin as string | undefined;
  if (!wsOriginAllowed(origin)) { try { ws.close(1008, 'origin not allowed'); } catch {} return; }
  if (WS_TOKEN) {
    let tok = '';
    try { tok = new URL(req?.url || '/', 'http://localhost').searchParams.get('token') || ''; } catch {}
    if (tok !== WS_TOKEN) { try { ws.close(1008, 'invalid token'); } catch {} return; }
  }
  ws.send(JSON.stringify({ type: 'BOT_STATE', ...state, logs: state.logs.slice(0, 80) }));
  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'TOGGLE_BOT')  { msg.active ? liveBotController.start() : liveBotController.stop(); }
      if (msg.type === 'SET_CONFIG')  { liveBotController.configure(msg.config); }
      if (msg.type === 'GET_STATE')   { broadcastState(); }
      if (msg.type === 'TX_RESULT')   {
        if (msg.success) addLog('trade', `✅ Tx confirmed | ${(msg.digest || '').slice(0, 12)}...`, undefined, undefined, msg.digest);
        else { addLog('error', `❌ Tx failed: ${msg.error || 'unknown'}`); if (msg.intent === 'open') state.position = null; }
        broadcastState();
      }
    } catch { /* ignore */ }
  });
});

// ─── Binance Fetcher ──────────────────────────────────────────────────────────

// Parse a pair into base/quote + the Binance symbol used for the price feed.
// xBTC (DeepTrade wrapped BTC) tracks BTC price, so its feed maps to BTCUSDT.
function pairAssets(pair: string): { base: string; quote: string; binanceSymbol: string } {
  const norm = (pair || 'XBTC_USDC').toUpperCase().replace(/\//g, '_');
  const [base, quote] = norm.includes('_') ? norm.split('_') : [norm.replace(/USDT|USDC$/,''), 'USDC'];
  let feedBase = base;
  if (base === 'XBTC' || base === 'WBTC' || base === 'BTC') feedBase = 'BTC';
  // Binance price feed always quotes in USDT
  const binanceSymbol = `${feedBase}USDT`;
  return { base, quote, binanceSymbol };
}

// True for the xBTC/USDC market → routed to the real DeepTrade (DeepBook V3) order tool.
function isXbtcPair(pair: string): boolean {
  const { base, quote } = pairAssets(pair);
  return base === 'XBTC' && quote === 'USDC';
}

async function fetchCandles(pair: string, tf: string, limit = 120): Promise<Candle[]> {
  const symbol   = pairAssets(pair).binanceSymbol;
  const interval = tf || '15m';
  const url      = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res  = await (fetch as any)(url);
  const data = await res.json() as any[];
  if (!Array.isArray(data)) throw new Error('Binance data invalid');
  return data.map((k: any[]) => ({
    date: new Date(k[0]).toISOString(),
    open: parseFloat(k[1]), high: parseFloat(k[2]),
    low:  parseFloat(k[3]), close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

// ─── Candle source dispatcher (Binance vs DeepBook on-chain fill-tape) ─────────
// Default = Binance (unchanged). When cfg.onchainCandles is set AND the pair is
// SUI/USDC, candles come purely from the on-chain DeepBook fill-tape (no CEX REST):
// bootstrap once, then accumulate new fills each tick. Stays Binance-free even on a
// feed error (returns what it has → the tick's "not enough data" guard retries).
let _onchainFeed: OnchainCandleFeed | null = null;
async function getCandles(cfg: LiveBotConfig, limit: number): Promise<Candle[]> {
  const onSuiUsdc = (cfg.pair || '').toUpperCase().replace(/\//g, '_') === 'SUI_USDC';
  if (cfg.onchainCandles && onSuiUsdc) {
    try {
      if (!_onchainFeed) {
        _onchainFeed = new OnchainCandleFeed();
        const n = await _onchainFeed.bootstrap(getSuiClient(), 120);
        addLog('info', `📡 On-chain candle feed bootstrapped (${n} DeepBook fills, no Binance)`);
      } else {
        await _onchainFeed.update(getSuiClient());
      }
      return _onchainFeed.candles(cfg.timeframe);
    } catch (e: any) {
      addLog('warning', `📡 On-chain feed error: ${e?.message || e}`);
      return _onchainFeed ? _onchainFeed.candles(cfg.timeframe) : [];
    }
  }
  return fetchCandles(cfg.pair, cfg.timeframe, limit);
}

// ─── Sui Client (lazy-init) ───────────────────────────────────────────────────

const MAINNET_RPC = 'https://fullnode.mainnet.sui.io';
let _suiClient: SuiJsonRpcClient | null = null;
function getSuiClient() {
  if (!_suiClient) _suiClient = new SuiJsonRpcClient({ url: MAINNET_RPC, network: 'mainnet' as any });
  return _suiClient;
}

function getKeypair(privateKey: string): Ed25519Keypair {
  try {
    // suiprivkey... format
    return Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(privateKey).secretKey);
  } catch {
    // hex format
    return Ed25519Keypair.fromSecretKey(Buffer.from(privateKey.replace('0x', ''), 'hex'));
  }
}

// ─── Direct Execution (Mode B) ────────────────────────────────────────────────

async function signAndBroadcast(tx: Transaction, keypair: Ed25519Keypair): Promise<string> {
  const suiClient = getSuiClient();
  const gasPrice  = await suiClient.getReferenceGasPrice();
  tx.setGasPrice(gasPrice);
  tx.setGasBudget(60_000_000);
  const built = await tx.build({ client: suiClient });
  const { signature } = await keypair.signTransaction(built);
  const res = await suiClient.executeTransactionBlock({
    transactionBlock: built, signature,
    options: { showEffects: true, showEvents: true },
  });
  if (res.effects?.status?.status !== 'success') {
    throw new Error(`Tx failed: ${res.effects?.status?.error || 'unknown'}`);
  }
  return res.digest;
}

/**
 * Build a DeepBookClient that already knows about the user's first margin manager.
 * The SDK's marginManager.* helpers throw MARGIN_MANAGER_NOT_FOUND unless we
 * pre-populate the marginManagers map — that's why the plain `new DeepBookClient`
 * pattern fails on deposit/borrow/repay.
 */
async function getDbClientWithManager(address: string): Promise<{ dbClient: any; managerKey: string }> {
  const suiClient = getSuiClient();
  const discover = new DeepBookClient({ client: suiClient as any, network: 'mainnet', address });
  const managerIds = await discover.getMarginManagerIdsForOwner(address);
  if (!managerIds.length) throw new Error('No Margin Account on this wallet — create one first in Live Trade');

  // The wallet may own MULTIPLE SUI/USDC managers (one per create click).
  // Pick the BEST one — most liquid assets, no-debt preferred — instead of the
  // first type-match, which could grab a stale account with locked collateral
  // while the user's freshly-funded account sits unused.
  const { pickBestSuiUsdcManager } = await import('../src/utils/marginDetail.js');
  const managerKey = await pickBestSuiUsdcManager(suiClient, managerIds);
  if (!managerKey) throw new Error('No SUI/USDC margin account on this wallet. Open one in Live Trade first.');

  const poolKey = 'SUI_USDC';
  const dbClient = new DeepBookClient({
    client: suiClient as any, network: 'mainnet', address,
    marginManagers: { [managerKey]: { marginManagerKey: managerKey, address: managerKey, poolKey } } as any,
  });
  return { dbClient, managerKey };
}

// ── Liquidation-guard health reads (DeepBook margin risk ratio) ──
// getMarginManagerState returns the manager's live `riskRatio` (collateral vs debt,
// valued by Pyth); the protocol force-liquidates when it falls to liquidationRiskRatio
// (mainnet SUI/USDC = 1.1). We cache the client + threshold so each 10s read is a
// single simulateTransaction. Reset on configure() when the wallet may change.
let _liqThreshold = 0;
let _healthDbClient: any = null;
let _healthManagerKey = '';
function resetHealthCache() { _healthDbClient = null; _healthManagerKey = ''; }

async function readMarginHealth(address: string): Promise<{ riskRatio: number; liqThreshold: number } | null> {
  try {
    if (!address) return null;
    if (!_healthDbClient || !_healthManagerKey) {
      const r = await getDbClientWithManager(address);
      _healthDbClient = r.dbClient; _healthManagerKey = r.managerKey;
    }
    if (!_liqThreshold) {
      try { _liqThreshold = await _healthDbClient.getLiquidationRiskRatio('SUI_USDC'); }
      catch { _liqThreshold = 1.1; }   // mainnet SUI/USDC default
    }
    const st = await _healthDbClient.getMarginManagerState(_healthManagerKey);
    const riskRatio = Number(st?.riskRatio) || 0;
    return { riskRatio, liqThreshold: _liqThreshold };
  } catch {
    resetHealthCache();   // stale manager id → re-resolve next time
    return null;
  }
}

// Read the DeepBook SUI/USDC order-book imbalance (top 10 L2 levels). Read-only
// devInspect — no manager / key needed. Returns OBI ∈ [-1,1] or null on failure.
const OBI_READ_ADDR = '0x0000000000000000000000000000000000000000000000000000000000000001';
async function readOrderBookObi(): Promise<number | null> {
  try {
    const db = new DeepBookClient({ client: getSuiClient() as any, network: 'mainnet', address: OBI_READ_ADDR });
    const lvl: any = await db.getLevel2TicksFromMid('SUI_USDC', 10);
    const sum = (a: number[]) => (a || []).reduce((s, x) => s + (Number(x) || 0), 0);
    const bidVol = sum(lvl.bid_quantities), askVol = sum(lvl.ask_quantities);
    const tot = bidVol + askVol;
    return tot > 0 ? (bidVol - askVol) / tot : null;
  } catch { return null; }
}

/**
 * Inject a fresh Pyth price update into the tx BEFORE any margin moveCall.
 * borrow / withdraw verify position health against the SUI + USDC feeds and
 * abort with code 3 (EInvalidProof) when the on-chain price object is stale
 * (older than ~30s). Same fix as the frontend's usePythOracle hook.
 */
async function injectPythUpdate(tx: Transaction): Promise<void> {
  const { SuiPriceServiceConnection, SuiPythClient, mainnetPythConfigs, mainnetCoins } =
    await import('@mysten/deepbook-v3');
  const feeds = [(mainnetCoins as any).SUI.feed, (mainnetCoins as any).USDC.feed];
  const connection = new SuiPriceServiceConnection('https://hermes.pyth.network');
  const pythClient = new SuiPythClient(
    getSuiClient() as any,
    mainnetPythConfigs.pythStateId,
    mainnetPythConfigs.wormholeStateId,
  );
  const updates = await connection.getPriceFeedsUpdateData(feeds);
  if (!updates?.length) throw new Error('Pyth Hermes returned no price updates');
  await pythClient.updatePriceFeeds(tx, updates, feeds);
}

// Open a REAL directional leveraged position via DeepBook Margin (same proven
// path as ManualTradeView's margin order): the borrow alone is net-neutral, so
// we borrow AND swap in one atomic tx to create actual exposure.
//   LONG  = borrow USDC → market-BUY  `sizeBase` SUI  (profit when SUI ↑)
//   SHORT = borrow SUI  → market-SELL `sizeBase` SUI  (profit when SUI ↓)
// The borrow is exactly the amount spent on the swap, so the tx is self-balancing;
// leverage is set by how much collateral already sits in the manager (an
// over-leveraged size simply aborts the health check — no funds at risk).
async function directOpen(
  keypair: Ed25519Keypair,
  type: 'LONG' | 'SHORT',
  sizeBase: number,
  price: number,
  skillAuthor?: string,
): Promise<{ digest: string; qty: number }> {
  const address = keypair.toSuiAddress();
  const { dbClient, managerKey } = await getDbClientWithManager(address);

  // ── Health cap ──────────────────────────────────────────────────────────
  // This borrow-the-notional pattern is safe only up to ~1x: the order's
  // withdraw_with_proof aborts (code 3) when collateral can't back the borrow.
  // Read the real collateral and keep effective leverage ≤ ~0.9x, snapping to a
  // valid 1-SUI lot. Too little collateral → skip cleanly (never a mid-tx abort).
  let collateralSui = 0;
  try { collateralSui = Number((await dbClient.getMarginManagerAssets(managerKey)).baseAsset) || 0; } catch { /* leave 0 */ }
  const MIN_COLLATERAL = 1.2;
  if (collateralSui < MIN_COLLATERAL) {
    throw new Error(`Margin collateral too low (${collateralSui.toFixed(2)} SUI). Deposit ≥ ${MIN_COLLATERAL} SUI into the margin account so the bot can open the 1-SUI minimum position safely.`);
  }
  const maxQty = Math.floor(collateralSui * 0.9 * 10) / 10;     // ≤ ~0.9x leverage
  const qty = Math.min(lotSafe(sizeBase), Math.max(1, maxQty)); // ≥ 1-SUI lot

  const tx = new Transaction();
  tx.setSender(address);

  // Pyth price update MUST precede borrow + order (health checks read the feeds).
  await injectPythUpdate(tx);

  const cid = Date.now().toString();
  if (type === 'LONG') {
    // Borrow the USDC notional, then market-buy the SUI → long exposure.
    dbClient.marginManager.borrowQuote(managerKey, qty * price)(tx);
    dbClient.poolProxy.placeMarketOrder({
      poolKey: 'SUI_USDC', marginManagerKey: managerKey, clientOrderId: cid,
      quantity: qty, isBid: true, payWithDeep: false,
    })(tx);
  } else {
    // Borrow the SUI, then market-sell it for USDC → short exposure.
    dbClient.marginManager.borrowBase(managerKey, qty)(tx);
    dbClient.poolProxy.placeMarketOrder({
      poolKey: 'SUI_USDC', marginManagerKey: managerKey, clientOrderId: cid,
      quantity: qty, isBid: false, payWithDeep: false,
    })(tx);
  }

  // 0.01 SUI bot-skill open fee → 0.005 marketplace + 0.005 to the skill author.
  // Deterministic: fee goes to the author of the skill currently in use (no randomness).
  // Skipped if no author is set (e.g. self-built unpublished skill).
  if (skillAuthor) injectBotOpenFee(tx, [skillAuthor]);

  const digest = await signAndBroadcast(tx, keypair);
  return { digest, qty };
}

// Close a real directional position by swapping back to flat and repaying the
// FULL debt — sized from the manager's ACTUAL debt (not the position size) with
// an over-cover buffer, so the repay leaves ZERO residual. This matters: DeepBook
// margin forbids holding base AND quote debt at once, so a dust quote-debt left
// after a LONG close would abort the next SHORT's borrow_base (code 4). Mirrors
// ManualTradeView.handleMarginSwapClose (the proven on-chain path).
//   close LONG  = sell (quoteDebt/price)*1.5 SUI → withdraw → repay USDC
//   close SHORT = buy   baseDebt*1.05      SUI → withdraw → repay SUI
async function directClose(
  keypair: Ed25519Keypair,
  type: 'LONG' | 'SHORT',
  price: number,
): Promise<string> {
  const address = keypair.toSuiAddress();
  const { dbClient, managerKey } = await getDbClientWithManager(address);

  // Read the real outstanding debt so the closing swap over-covers it exactly.
  let baseDebt = 0, quoteDebt = 0;
  try {
    const d: any = await dbClient.getMarginManagerDebts(managerKey);
    baseDebt  = parseFloat(d?.baseDebt  ?? '0') || 0;
    quoteDebt = parseFloat(d?.quoteDebt ?? '0') || 0;
  } catch { /* fall back to a 1-lot close below */ }

  const tx = new Transaction();
  tx.setSender(address);

  // Pyth update first — order + repay-side health accounting read the feeds.
  await injectPythUpdate(tx);

  const cid = Date.now().toString();
  if (type === 'LONG') {
    const qty = lotSafe((quoteDebt / (price || 1)) * 1.5);   // sell enough SUI to clear USDC debt
    dbClient.poolProxy.placeMarketOrder({
      poolKey: 'SUI_USDC', marginManagerKey: managerKey, clientOrderId: cid,
      quantity: qty, isBid: false, payWithDeep: false,
    })(tx);
    dbClient.poolProxy.withdrawSettledAmounts(managerKey)(tx);
    dbClient.marginManager.repayQuote(managerKey, undefined as any)(tx);
  } else {
    const qty = lotSafe(baseDebt * 1.05);                    // buy enough SUI to clear SUI debt
    dbClient.poolProxy.placeMarketOrder({
      poolKey: 'SUI_USDC', marginManagerKey: managerKey, clientOrderId: cid,
      quantity: qty, isBid: true, payWithDeep: false,
    })(tx);
    dbClient.poolProxy.withdrawSettledAmounts(managerKey)(tx);
    dbClient.marginManager.repayBase(managerKey, undefined as any)(tx);
  }

  // Close is FREE — no bot-skill fee charged on exits.
  return signAndBroadcast(tx, keypair);
}

// ─── Direct xBTC/USDC spot order (DeepTrade) — server-signed, no AI ────────────
async function directXbtcOrder(
  keypair: Ed25519Keypair,
  side: 'buy' | 'sell',
  price: number,
  quantity: number,
  balanceManagerId: string,
  feeManagerId: string,
  isOpening: boolean = true,   // true → charge 0.01 SUI bot fee; false (close) → free
  skillAuthor?: string,        // who receives the 0.005 SUI author share
): Promise<string> {
  const address = keypair.toSuiAddress();
  // Build the same DeepTrade market order the agent path builds, but sign it here.
  const { tx } = await buildOrderTx({
    walletAddress: address, side, price, quantity,
    balanceManagerId, feeManagerId, marketOrder: true,
  });
  // Deterministic author fee: only when opening AND a skill author is set.
  if (isOpening && skillAuthor) injectBotOpenFee(tx, [skillAuthor]);
  return signAndBroadcast(tx, keypair);
}

// ─── Optional AI safety check ─────────────────────────────────────────────────
// Sends the bot's pre-computed signal to an LLM and asks for a binary verdict.
// The LLM cannot create or modify trades — only approve or reject. On any error
// (timeout / parse failure / no key) we default to APPROVE so the AI layer can
// never silently block trades the user already opted-in to.
async function aiValidateSignal(
  cfg: LiveBotConfig,
  type: 'LONG' | 'SHORT',
  price: number,
  indicators: any,
): Promise<{ approved: boolean; reason: string; confidence?: number }> {
  const v = cfg.aiValidation;
  if (!v?.enabled) return { approved: true, reason: 'AI check disabled' };

  const prompt =
    `You are a trading risk reviewer. The bot wants to open a ${type} position on ${cfg.pair} ` +
    `at $${price} using strategy "${cfg.signal}" (${cfg.leverage}x leverage, TP ${cfg.takeProfitPct}%, SL ${cfg.stopLossPct}%). ` +
    `Current indicators: RSI=${indicators?.rsi}, EMA9=${indicators?.ema9}, EMA21=${indicators?.ema21}, MACD_hist=${indicators?.macdHist}. ` +
    `Reply with EXACTLY ONE LINE of JSON: {"approved": true|false, "confidence": 0-100, "reason": "<one short sentence>"}. ` +
    `Approve unless you see a clear reason this trade is reckless given the indicators.`;

  try {
    const res = await (fetch as any)('http://localhost:3001/api/chat', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: prompt,
        sessionId: `aicheck-${Date.now()}`,
        provider: v.provider,
        apiKey:   v.apiKey || '',
        walletAddress: cfg.walletAddress,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { approved: true, reason: `AI API ${res.status} — defaulting to approve` };
    const body: any = await res.json();
    const text: string = body.response || body.text || '';
    const match = text.match(/\{[^}]*"approved"[^}]*\}/);
    if (!match) return { approved: true, reason: 'AI reply unparseable — defaulting to approve' };
    const verdict = JSON.parse(match[0]);
    return {
      approved:   !!verdict.approved,
      reason:     String(verdict.reason || (verdict.approved ? 'approved' : 'rejected')),
      confidence: typeof verdict.confidence === 'number' ? verdict.confidence : undefined,
    };
  } catch (e: any) {
    return { approved: true, reason: `AI check error (${e.message}) — defaulting to approve` };
  }
}

// ─── Agent Mode Caller (Mode A) ───────────────────────────────────────────────

async function callAgent(cfg: LiveBotConfig, text: string): Promise<{ response: string; pendingTx: any }> {
  const res = await (fetch as any)('http://localhost:3001/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text, sessionId: cfg.sessionId || 'livebot-session',
      provider: cfg.provider || 'gemini',
      apiKey:   cfg.apiKey   || '',
      walletAddress: cfg.walletAddress,
    }),
  });
  if (!res.ok) throw new Error(`Agent API ${res.status}`);
  return res.json() as any;
}

// ─── Position Size Calculator ─────────────────────────────────────────────────

function calcSize(cfg: LiveBotConfig, price: number) {
  // capitalSUI = SUI capital (VD: 0.5 SUI)
  // EA sizing: risk_pct mode sizes so a full SL hit costs exactly riskPct% of
  // capital; fixed_pct keeps the legacy capital × orderPct% margin. Shared
  // with the backtester (calcMargin) so both engines size identically.
  const marginSUI  = calcMargin(cfg, cfg.capitalSUI);
  const positionSUI = marginSUI * cfg.leverage;

  // LONG: borrow SUI, SHORT: borrow USDC (giá trị tương đương SUI * price)
  const borrowSUI  = Math.round(positionSUI  * 1000) / 1000;
  const borrowUSDC = Math.round(positionSUI  * price * 100) / 100;

  return { marginSUI, borrowSUI, borrowUSDC };
}

// Format a price with decimals suited to its magnitude. Sub-$1 assets (SUI ≈
// $0.8) must NOT be rounded to whole dollars, or TP/SL collapse onto the wrong
// side of the entry and the position closes the instant it opens.
function fmtPx(p: number): string {
  if (!Number.isFinite(p)) return '0';
  const dp = p >= 100 ? 0 : p >= 1 ? 2 : 4;
  return p.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

// DeepBook SUI_USDC has a 1-SUI minimum order and a 0.1-SUI lot step. A market
// order below that aborts in pool_proxy::calculate_effective_price (code 5), so
// every order quantity is snapped up to a valid lot.
function lotSafe(q: number): number {
  return Math.max(1, Math.round(q * 10) / 10);
}

let cfg_leverage_cache = 1; // updated on each position open

// Net PnL estimate for the open position at a given exit price. A market order
// pays spread + taker, and opening costs 0.01 SUI — so this reflects a real
// market round-trip rather than an ideal limit fill. Returns the value in the
// position's borrow-unit plus the leveraged % on margin.
function estPnl(pos: ActivePosition, exitPrice: number): { val: number; pct: number } {
  const cfg   = state.config as LiveBotConfig | null;
  const diff  = pos.type === 'LONG' ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice;
  const gross = pos.borrowAmount * (diff / pos.entryPrice);
  let cost = pos.borrowAmount * 0.0015;                               // ~0.15% spread+taker, round trip
  if (cfg && !isXbtcPair(cfg.pair) && cfg.skillAuthor) cost += 0.01;  // 0.01 SUI open fee (SUI-denominated path)
  const net = gross - cost;
  const marginUnit = pos.borrowAmount / (cfg_leverage_cache || 1);
  return {
    val: Math.round(net * 100) / 100,
    pct: marginUnit > 0 ? Math.round((net / marginUnit) * 1000) / 10 : 0,
  };
}

// ─── Open Position ────────────────────────────────────────────────────────────

async function openPosition(cfg: LiveBotConfig, type: 'LONG' | 'SHORT', price: number) {
  if (state.position) return;

  const { borrowSUI, borrowUSDC } = calcSize(cfg, price);
  cfg_leverage_cache = cfg.leverage;

  const tpPrice = type === 'LONG' ? price * (1 + cfg.takeProfitPct / 100) : price * (1 - cfg.takeProfitPct / 100);
  const slPrice = type === 'LONG' ? price * (1 - cfg.stopLossPct   / 100) : price * (1 + cfg.stopLossPct   / 100);

  addLog('signal', `📡 ${type} signal @ $${fmtPx(price)} | TP:$${fmtPx(tpPrice)} SL:$${fmtPx(slPrice)}`, price);
  broadcast({ type: 'SIGNAL_DETECTED', signalType: type, price, tpPrice, slPrice });

  const { base, quote } = pairAssets(cfg.pair);
  const pool = `${base}_${quote}`;
  const borrowAmt  = type === 'LONG' ? borrowSUI : borrowUSDC;
  const borrowAsset= type === 'LONG' ? base : quote;

  try {
    if (state.mode === 'direct') {
      if (!_cachedPrivateKey) {
        addLog('error', '❌ Auto Bot: private key missing. Reload it via the Setup Wizard.');
        state.position = null;
        broadcastState();
        return;
      }
      // ── Optional AI safety check (opt-in, $0 when off) ──
      if (cfg.aiValidation?.enabled) {
        addLog('info', `🤖 AI safety check: ${cfg.aiValidation.provider}...`);
        const verdict = await aiValidateSignal(cfg, type, price, state.lastIndicators);
        if (!verdict.approved) {
          addLog('warning', `🛑 AI VETOED ${type} @ $${price.toLocaleString()}: ${verdict.reason}`);
          broadcast({ type: 'AI_VETO', signalType: type, price, reason: verdict.reason });
          state.position = null;
          broadcastState();
          return;
        }
        addLog('info', `✅ AI approved ${type}${verdict.confidence !== undefined ? ` (conf ${verdict.confidence}%)` : ''}: ${verdict.reason}`);
      }

      // ── MODE B: Tự ký + execute thẳng (no AI, or AI-approved) ──
      const keypair = getKeypair(_cachedPrivateKey);
      let digest: string;
      let posBorrowAsset = borrowAsset;
      let posBorrowAmt   = borrowAmt;

      if (isXbtcPair(cfg.pair)) {
        // xBTC/USDC → DeepTrade spot market order, server-signed
        if (!cfg.balanceManagerId || !cfg.feeManagerId) {
          addLog('error', `❌ xBTC setup required: create a BalanceManager + FeeManager first (DeepTrade Account panel), then save the IDs. No trade placed.`);
          state.position = null; broadcastState(); return;
        }
        const side = type === 'LONG' ? 'buy' : 'sell';
        const qtyXbtc = Math.max(0, Math.round((borrowUSDC / price) * 1e8) / 1e8);
        addLog('info', `⚙️ [DIRECT] xBTC ${side.toUpperCase()} ${qtyXbtc} @ $${price.toLocaleString()}...`);
        digest = await directXbtcOrder(keypair, side, price, qtyXbtc, cfg.balanceManagerId, cfg.feeManagerId, true, cfg.skillAuthor);
        posBorrowAsset = 'XBTC'; posBorrowAmt = qtyXbtc;
      } else {
        // SUI/USDC → DeepBook margin: borrow + swap into a real position, server-signed.
        // directOpen caps the size to the manager's collateral and returns the exact
        // SUI quantity it traded — store THAT so directClose sells back the same and
        // PnL is measured on the real exposure.
        addLog('info', `⚙️ [DIRECT] Open ${type} ~${lotSafe(borrowSUI)} SUI — ${type === 'LONG' ? 'borrow USDC → buy SUI' : 'borrow SUI → sell SUI'}...`);
        const opened = await directOpen(keypair, type, borrowSUI, price, cfg.skillAuthor);
        digest = opened.digest;
        posBorrowAsset = base;
        posBorrowAmt   = opened.qty;
        if (opened.qty < lotSafe(borrowSUI)) addLog('info', `ℹ️ Size capped to ${opened.qty} SUI by available collateral (≤0.9x).`);
      }

      state.position = {
        type, entryPrice: price, entryTime: new Date().toISOString(),
        tpPrice, slPrice,
        trailPeak: price, borrowAsset: posBorrowAsset, borrowAmount: posBorrowAmt,
        unrealizedPnl: 0, unrealizedPct: 0,
      };
      state.tradeCount++;
      persistState();
      const feeNote = cfg.skillAuthor
        ? ` · 0.01 SUI fee → ${cfg.skillAuthor.slice(0, 6)}…${cfg.skillAuthor.slice(-4)} (0.005 author) + market (0.005)`
        : ' · no bot fee (skill has no author address)';
      addLog('trade', `✅ [DIRECT] Opened ${type} @ $${price.toLocaleString()}${feeNote}`, price, undefined, digest);
      recordOpen(type, price, digest);
      broadcast({ type: 'TRADE_OPENED', position: state.position, txDigest: digest });

    } else if (isXbtcPair(cfg.pair)) {
      // ── DeepTrade spot (xBTC/USDC): real DeepBook order via deeptrade_xbtc_order ──
      if (!cfg.balanceManagerId || !cfg.feeManagerId) {
        addLog('error', `❌ DeepTrade setup required: create a BalanceManager + FeeManager first (deeptrade_xbtc_setup), then save the IDs to the bot. No trade placed.`);
        state.position = null;
        broadcastState();
        return;
      }
      const side = type === 'LONG' ? 'buy' : 'sell';
      const notionalUSDC = borrowUSDC; // USDC notional for this entry
      const qtyXbtc = Math.max(0, Math.round((notionalUSDC / price) * 1e8) / 1e8);
      const command =
        `[BOT SKILL SIGNAL — ${type}] Signal "${cfg.signal}" triggered on xBTC/USDC @ $${price.toLocaleString()}.\n` +
        `Request: deeptrade_xbtc_order | side: ${side} | price: ${price} | quantity: ${qtyXbtc} | ` +
        `balanceManagerId: ${cfg.balanceManagerId} | feeManagerId: ${cfg.feeManagerId} | wallet: ${cfg.walletAddress} | executionMode: require_approval`;

      const { pendingTx } = await callAgent(cfg, command);

      state.position = {
        type, entryPrice: price, entryTime: new Date().toISOString(),
        tpPrice, slPrice,
        trailPeak: price, borrowAsset: 'XBTC', borrowAmount: qtyXbtc,
        unrealizedPnl: 0, unrealizedPct: 0,
      };
      persistState();
      addLog('trade', `⏳ [DEEPTRADE] Awaiting wallet signature: ${side.toUpperCase()} ${qtyXbtc} xBTC @ $${price.toLocaleString()}`, price);
      broadcast({ type: 'PENDING_TX', intent: 'open', pendingTx, position: state.position });

    } else {
      // ── MODE A: Qua Agent chat → frontend ký ──
      const command =
        `[BOT SKILL SIGNAL — ${type}] Signal "${cfg.signal}" triggered on ${cfg.pair} @ $${price.toLocaleString()}.\n` +
        `Request: margin_open_position | pool: ${pool} | ${type === 'LONG' ? `borrow ${borrowAmt} ${base}` : `borrow ${borrowAmt} ${quote}`} | wallet: ${cfg.walletAddress} | executionMode: require_approval`;

      const { pendingTx } = await callAgent(cfg, command);

      state.position = {
        type, entryPrice: price, entryTime: new Date().toISOString(),
        tpPrice, slPrice,
        trailPeak: price, borrowAsset, borrowAmount: borrowAmt,
        unrealizedPnl: 0, unrealizedPct: 0,
      };
      persistState();
      addLog('trade', `⏳ [AGENT] Waiting for the frontend to sign OPEN ${type} @ $${price.toLocaleString()}`, price);
      broadcast({ type: 'PENDING_TX', intent: 'open', pendingTx, position: state.position });
    }
  } catch (err: any) {
    addLog('error', `❌ Could not open ${type}: ${err.message}`);
    state.position = null;
  }

  broadcastState();
}

// ─── Close Position ───────────────────────────────────────────────────────────

async function closePosition(reason: ExitReason | 'Manual', exitPrice: number) {
  lastExitAt = Date.now();   // EA cooldownBars reference
  if (!state.position || !state.config) return;
  const pos = state.position;
  const cfg = state.config as LiveBotConfig;

  // Net of spread + taker + the 0.01 SUI open fee — a real market round-trip,
  // not an ideal limit fill.
  const { val: pnlApprox, pct: pnlPct } = estPnl(pos, exitPrice);

  addLog('signal', `🔔 ${reason} @ $${fmtPx(exitPrice)} | Est. PnL ${pnlApprox >= 0 ? '+' : ''}${pnlApprox} (net of fees) | ${pnlPct}%`, exitPrice, pnlApprox);

  try {
    if (state.mode === 'direct') {
      if (!_cachedPrivateKey) {
        addLog('error', '❌ Auto Bot: private key missing — cannot close. Position stays open.');
        return;
      }
      const keypair = getKeypair(_cachedPrivateKey);
      let digest: string;

      if (isXbtcPair(cfg.pair)) {
        // xBTC/USDC → close = opposite-side DeepTrade market order, server-signed
        if (!cfg.balanceManagerId || !cfg.feeManagerId) {
          addLog('error', `❌ xBTC setup required to close. Position kept open.`); return;
        }
        const side = pos.type === 'LONG' ? 'sell' : 'buy';
        addLog('info', `⚙️ [DIRECT] Close xBTC ${side.toUpperCase()} ${pos.borrowAmount} @ $${exitPrice.toLocaleString()}...`);
        // Close = free (isOpening: false)
        digest = await directXbtcOrder(keypair, side, exitPrice, pos.borrowAmount, cfg.balanceManagerId, cfg.feeManagerId, false);
      } else {
        // SUI/USDC → swap back to flat + repay borrow IN FULL (debt-sized), server-signed
        addLog('info', `⚙️ [DIRECT] Closing ${pos.type} — ${pos.type === 'LONG' ? 'sell SUI → repay USDC' : 'buy SUI → repay SUI'} (full debt clear)…`);
        digest = await directClose(keypair, pos.type, exitPrice);
      }

      // tradeCount was already +1 at open — a round-trip is ONE trade, not two.
      state.totalPnl   = Math.round((state.totalPnl + pnlApprox) * 100) / 100;
      addLog('trade', `✅ [DIRECT] Closed ${pos.type} | ${reason} | Est. PnL ${pnlApprox >= 0 ? '+' : ''}${pnlApprox}`, exitPrice, pnlApprox, digest);
      recordClose(exitPrice, pnlPct, pnlApprox, reason, digest);
      broadcast({ type: 'TRADE_CLOSED', reason, exitPrice, pnlApprox, pnlPct, txDigest: digest });

    } else if (isXbtcPair(cfg.pair)) {
      // ── DeepTrade spot close: opposite side of the entry ──
      if (!cfg.balanceManagerId || !cfg.feeManagerId) {
        addLog('error', `❌ DeepTrade setup required to close. Position kept open.`);
        return;
      }
      const side = pos.type === 'LONG' ? 'sell' : 'buy';
      const command =
        `[BOT SKILL — CLOSE POSITION] Reason: ${reason} | Price: $${exitPrice.toLocaleString()}\n` +
        `Request: deeptrade_xbtc_order | side: ${side} | price: ${exitPrice} | quantity: ${pos.borrowAmount} | ` +
        `balanceManagerId: ${cfg.balanceManagerId} | feeManagerId: ${cfg.feeManagerId} | wallet: ${cfg.walletAddress} | executionMode: require_approval`;

      const { pendingTx } = await callAgent(cfg as LiveBotConfig, command);

      state.totalPnl   = Math.round((state.totalPnl + pnlApprox) * 100) / 100;
      state.tradeCount++;
      addLog('trade', `⏳ [DEEPTRADE] Awaiting signature to close (${side.toUpperCase()} ${pos.borrowAmount} xBTC) | ${reason}`, exitPrice, pnlApprox);
      broadcast({ type: 'PENDING_TX', intent: 'close', pendingTx, pnlApprox, reason });

    } else {
      const closePool = `${pairAssets(cfg.pair).base}_${pairAssets(cfg.pair).quote}`;
      const command =
        `[BOT SKILL — CLOSE POSITION] Reason: ${reason} | Price: $${exitPrice.toLocaleString()}\n` +
        `Request: margin_close_position | pool: ${closePool} | repay ${pos.borrowAmount} ${pos.borrowAsset} | wallet: ${cfg.walletAddress} | executionMode: require_approval`;

      const { pendingTx } = await callAgent(cfg as LiveBotConfig, command);

      state.totalPnl   = Math.round((state.totalPnl + pnlApprox) * 100) / 100;
      state.tradeCount++;
      addLog('trade', `⏳ [AGENT] Waiting for the frontend to sign CLOSE ${pos.type} | ${reason}`, exitPrice, pnlApprox);
      broadcast({ type: 'PENDING_TX', intent: 'close', pendingTx, pnlApprox, reason });
    }
  } catch (err: any) {
    addLog('error', `❌ Could not close: ${err.message}`);
  }

  state.position = null;
  persistState();
  broadcastState();
}

// ─── Core Trading Loop ────────────────────────────────────────────────────────

let pollingTimer: ReturnType<typeof setTimeout> | null = null;
let manageTimer:  ReturnType<typeof setInterval> | null = null;

// EA bookkeeping (per bot run)
let lastSignalBar = '';   // ISO date of the closed bar the last entry fired on
let lastExitAt    = 0;    // Date.now() of the last closed trade (cooldownBars)
let dailyLossTrippedDay = '';   // UTC date the daily-loss circuit breaker fired (one-shot/day)

/** Today's REALIZED P&L as a sum of closed-trade percents (UTC day).
 *  Matches the backtest convention (sum of per-trade pct, not compounded). */
function dailyRealizedPct(): number {
  const today = new Date().toISOString().slice(0, 10);
  return tradeHistory
    .filter(r => r.closeTime && r.closeTime.slice(0, 10) === today)
    .reduce((s, r) => s + (r.pnlPct ?? 0), 0);
}

const TF_MS: Record<string, number> = {
  '5m': 300_000, '15m': 900_000, '30m': 1_800_000, '1h': 3_600_000,
};

/** Adapter: run the SAME exit rules the backtester uses against a live tick. */
function liveManage(cfg: LiveBotConfig, price: number, opposite: { buy: boolean; sell: boolean }) {
  const pos = state.position!;

  // EA time-stop (maxTimeInPosition): bars elapsed since entry ≥ limit → close.
  if ((cfg.maxBarsInTrade ?? 0) > 0) {
    const tfMs = TF_MS[cfg.timeframe] || 900_000;
    const bars = (Date.now() - new Date(pos.entryTime).getTime()) / tfMs;
    if (bars >= cfg.maxBarsInTrade!) return { price, reason: 'Time' as const };
  }

  const managed = {
    type: pos.type, entryPrice: pos.entryPrice,
    tpPrice: pos.tpPrice, slPrice: pos.slPrice,
    peakPrice: pos.trailPeak, beApplied: pos.beApplied,
  };
  const exit = manageExit(cfg, managed, { high: price, low: price, close: price }, opposite);
  // Persist mutations (trailing peak + breakeven SL move) back onto the live position
  pos.trailPeak = managed.peakPrice;
  if (managed.beApplied && !pos.beApplied) {
    pos.beApplied = true;
    pos.slPrice   = managed.slPrice;
    addLog('info', `🛡️ Breakeven armed — SL moved to entry ($${pos.slPrice.toFixed(4)})`);
  }
  return exit;
}

/** EA entry filters: session window, cooldown, loss streak, daily loss cap.
 *  Returns a human-readable block reason, or null when entries are allowed. */
function entryBlockReason(cfg: LiveBotConfig): string | null {
  if (!inSession(Date.now(), cfg)) return `outside session ${cfg.sessionStartHour}–${cfg.sessionEndHour}h UTC`;

  const tfMs = TF_MS[cfg.timeframe] || 900_000;
  if ((cfg.cooldownBars ?? 0) > 0 && lastExitAt > 0 &&
      Date.now() - lastExitAt < cfg.cooldownBars! * tfMs) {
    return `cooldown (${cfg.cooldownBars} bars after last trade)`;
  }

  if ((cfg.maxConsecLosses ?? 0) > 0) {
    let streak = 0;
    for (const r of tradeHistory) {            // newest first
      if (r.closeTime === null) continue;
      if ((r.pnlVal ?? 0) < 0) streak++; else break;
    }
    if (streak >= cfg.maxConsecLosses!) return `${streak} consecutive losses — paused (EA stop)`;
  }

  if ((cfg.maxDailyLossPct ?? 0) > 0) {
    const dayPct = dailyRealizedPct();
    if (dayPct <= -cfg.maxDailyLossPct!) return `daily loss limit hit (${dayPct.toFixed(1)}%)`;
  }
  return null;
}

async function tradingTick() {
  if (!state.active || !state.config) return;
  const cfg = state.config as LiveBotConfig;

  try {
    // MTF filter needs a deep history so the HTF Supertrend has warmed up
    // (e.g. H4 ST(10) on M5 ⇒ ≥ 11 closed H4 buckets ⇒ ≥ 528 M5 bars).
    const lookback = cfg.htfMinutes ? 1000 : 121;
    const candles = await getCandles(cfg, lookback);
    candlesCache = candles; // expose to the UI chart — same data the bot trades on
    if (candles.length < 36) { addLog('warning', `Not enough data (${candles.length} candles)`); return; }

    // MT-style OnBar: signals are evaluated on CLOSED candles only (the last
    // Binance kline is still forming — using it repaints and double-fires).
    const closed   = candles.slice(0, -1);
    const price    = candles[candles.length - 1].close;   // live-ish price for management
    const lastBar  = closed[closed.length - 1].date;
    state.currentPrice = price;
    state.lastUpdate   = new Date().toLocaleTimeString('en-GB');

    const { buy, sell, lastValues } = detectLiveSignal(closed, cfg.signal, cfg.direction,
      { supertrendMult: cfg.supertrendMult, supertrendPeriod: cfg.supertrendPeriod, breakoutPeriod: cfg.breakoutPeriod,
        htfMinutes: cfg.htfMinutes, htfSupertrendPeriod: cfg.htfSupertrendPeriod, htfSupertrendMult: cfg.htfSupertrendMult,
        filters: cfg.filters,
        emaFast: cfg.emaFast, emaSlow: cfg.emaSlow, maFast: cfg.maFast, maSlow: cfg.maSlow,
        rsiPeriod: cfg.rsiPeriod, rsiOversold: cfg.rsiOversold, rsiOverbought: cfg.rsiOverbought,
        bbPeriod: cfg.bbPeriod, bbStdDev: cfg.bbStdDev });
    state.lastIndicators = lastValues;
    state.lastSignal     = buy ? 'BUY' : sell ? 'SELL' : 'HOLD';

    // ── Daily-loss circuit breaker (hard safety) ──
    // Unlike entryBlockReason (which only skips NEW entries), this flattens any
    // open position AND halts the bot for the rest of the UTC day. One-shot/day.
    const dailyCap = cfg.maxDailyLossPct ?? 0;
    if (dailyCap > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const dayPct = dailyRealizedPct();
      if (dailyLossTrippedDay !== today && dayPct <= -dailyCap) {
        dailyLossTrippedDay = today;
        addLog('error', `🛑 Daily loss limit hit (${dayPct.toFixed(1)}% ≤ -${dailyCap}%) — flattening & halting until tomorrow`);
        if (state.position) { try { await closePosition('Manual', price); } catch { /* logged in closePosition */ } }
        liveBotController.stop();
        return;
      }
    }

    // ── Manage the open position (shared EA rules) ──
    if (state.position) {
      const pos  = state.position;
      const u = estPnl(pos, price);
      pos.unrealizedPct = u.pct;
      pos.unrealizedPnl = u.val;

      const exit = liveManage(cfg, price, { buy, sell });
      if (exit) { await closePosition(exit.reason, exit.price); return; }

      broadcast({ type: 'POSITION_UPDATE', position: pos, price, indicators: lastValues, signal: state.lastSignal });

    } else if (buy || sell) {
      // One entry attempt per closed bar (EA new-bar gate), then risk filters.
      if (lastSignalBar === lastBar) {
        broadcast({ type: 'PRICE_UPDATE', price, indicators: lastValues, signal: state.lastSignal, lastUpdate: state.lastUpdate });
      } else {
        const block = entryBlockReason(cfg);
        if (block) {
          addLog('warning', `🚧 ${state.lastSignal} signal skipped — ${block}`);
          lastSignalBar = lastBar; // don't re-log every poll for the same bar
        } else {
          // ── Order-book imbalance gate (live-only): require the on-chain book to
          //    agree with the entry side before opening. ──
          const obiTh = cfg.obiFilter ?? 0;
          if (obiTh > 0) {
            const obi = await readOrderBookObi();
            if (obi !== null) {
              const side = buy ? 'LONG' : 'SHORT';
              const aligned = side === 'LONG' ? obi >= obiTh : obi <= -obiTh;
              if (!aligned) {
                addLog('warning', `🚧 ${side} skipped — order-book imbalance ${(obi * 100).toFixed(0)}% not aligned (need ${side === 'LONG' ? '≥ +' : '≤ −'}${Math.round(obiTh * 100)}%)`);
                lastSignalBar = lastBar;   // one attempt per bar
                broadcastState();
                return;
              }
              addLog('info', `📊 Order book confirms ${side} (OBI ${(obi * 100).toFixed(0)}%)`);
            }
          }
          lastSignalBar = lastBar;
          await openPosition(cfg, buy ? 'LONG' : 'SHORT', price);
        }
      }
    } else {
      addLog('info', `🔍 ${cfg.signal} @ $${price.toLocaleString()} | RSI:${lastValues.rsi} | HOLD`);
      broadcast({ type: 'PRICE_UPDATE', price, indicators: lastValues, signal: 'HOLD', lastUpdate: state.lastUpdate });
    }

  } catch (err: any) { addLog('error', `Poll error: ${err.message}`); }

  broadcastState();
}

// ─── Fast management sub-loop (10s) ──────────────────────────────────────────
// MT EAs manage stops on every tick. Between candle polls we fetch just the
// ticker price and run TP/SL/breakeven/trailing — never entries (those stay
// on closed bars). Keeps exits tight even on 30m/1h timeframes.
async function managementTick() {
  if (!state.active || !state.position || !state.config) return;
  const cfg = state.config as LiveBotConfig;
  try {
    const sym = pairAssets(cfg.pair).binanceSymbol;
    const res = await (fetch as any)(`https://api.binance.com/api/v3/ticker/price?symbol=${sym}`,
      { signal: AbortSignal.timeout(8_000) });
    const price = parseFloat(((await res.json()) as any).price);
    if (!Number.isFinite(price) || price <= 0) return;

    const pos  = state.position;
    state.currentPrice = price;
    const u = estPnl(pos, price);
    pos.unrealizedPct = u.pct;
    pos.unrealizedPnl = u.val;

    const exit = liveManage(cfg, price, { buy: false, sell: false });
    if (exit) { await closePosition(exit.reason, exit.price); return; }

    // ── Liquidation guard ── flatten before DeepBook force-liquidates the account.
    // Only in direct mode (the agent holds the margin account it can read + close).
    if (state.mode === 'direct' && cfg.walletAddress) {
      const h = await readMarginHealth(cfg.walletAddress);
      if (h && h.riskRatio > 0) {
        state.riskRatio = h.riskRatio;
        state.liqThreshold = h.liqThreshold;
        const guard = cfg.liqGuardRatio === 0 ? 0 : (cfg.liqGuardRatio || (h.liqThreshold + 0.10));
        if (guard > 0 && state.position && h.riskRatio < guard) {
          addLog('error', `🛟 Liquidation guard — risk ratio ${h.riskRatio.toFixed(3)} < ${guard.toFixed(2)} (liq ${h.liqThreshold}) → flattening to avoid liquidation`);
          await closePosition('Manual', price);
          broadcast({ type: 'LIQ_GUARD', riskRatio: h.riskRatio, guard, liqThreshold: h.liqThreshold });
          return;
        }
      }
    }

    broadcast({ type: 'POSITION_UPDATE', position: pos, price, indicators: state.lastIndicators, signal: state.lastSignal });
  } catch { /* transient ticker errors are fine — candle poll still manages */ }
}

// ─── Controller ───────────────────────────────────────────────────────────────

// Supported timeframes: 5m, 15m, 30m, 1h
const TF_INTERVALS: Record<string, number> = {
  '5m':  30_000,   // poll every 30s for M5
  '15m': 60_000,   // poll every 60s for M15
  '30m': 90_000,   // poll every 90s for M30
  '1h':  120_000,  // poll every 2min for H1
};

export const liveBotController = {
  configure(cfg: LiveBotConfig) {
    // ⚠️ Tách privateKey ra, lưu riêng trong memory
    const { privateKey, ...safeCfg } = cfg;
    if (privateKey) {
      _cachedPrivateKey = privateKey;
      addLog('info', '🔑 Private key loaded into memory (never written to disk)');
    }
    resetHealthCache();   // wallet/manager may have changed → re-resolve on next health read
    _onchainFeed = null;  // re-bootstrap the on-chain candle feed for the new run
    state.config       = safeCfg;
    // Direct mode if explicitly requested (fallback to agent if not requested).
    // We don't silently fallback to agent mode if a key is missing, because
    // it will cause a cryptic "Agent API 400" error for Auto Bots.
    state.mode         = cfg.directMode ? 'direct' : 'agent';
    if (state.mode === 'direct' && !privateKey && !_cachedPrivateKey) {
      addLog('error', '⚠️ ERROR: Auto Bot (direct mode) is on but the private key is missing! Update the config.');
    }
    state.pollInterval = TF_INTERVALS[cfg.timeframe] || 60_000;
    persistState();
    addLog('info', `⚙️ Config: ${cfg.botSkillName} | ${cfg.pair} | ${cfg.timeframe} | Mode: ${state.mode.toUpperCase()}`);
    broadcastState();
  },

  start() {
    if (state.active) return;
    if (!state.config) { addLog('error', 'No bot skill configured'); return; }
    state.active = true;
    lastSignalBar = '';   // reset EA new-bar gate per run
    dailyLossTrippedDay = '';   // a manual (re)start clears the daily-loss breaker
    addLog('info', `🚀 Bot started [${state.mode.toUpperCase()} MODE]: ${state.config.botSkillName}`);
    if (state.mode === 'direct') addLog('info', '⚡ DIRECT MODE — the bot signs and executes orders itself, no confirmation needed');
    broadcastState();
    tradingTick();
    const schedule = () => {
      pollingTimer = setTimeout(async () => {
        if (!state.active) return;
        await tradingTick();
        schedule();
      }, state.pollInterval);
    };
    schedule();
    // EA tick-level stop management between candle polls (no entries here)
    manageTimer = setInterval(managementTick, 10_000);
  },

  stop() {
    state.active = false;
    if (pollingTimer) { clearTimeout(pollingTimer); pollingTimer = null; }
    if (manageTimer)  { clearInterval(manageTimer); manageTimer = null; }
    addLog('info', '⏹ Bot stopped');
    broadcastState();
  },

  clearKey() {
    _cachedPrivateKey = null;
    addLog('info', '🗑️ Private key wiped from memory');
  },

  getState(): Omit<BotState, never> { return { ...state }; },

  /** Latest klines from the bot's own feed — same data its signals run on. */
  getCandles(): Candle[] { return candlesCache; },

  /** Persisted buy/sell records (newest first). */
  getHistory(): TradeRecord[] { return tradeHistory; },

  /** Manually close the open position at the current market price.
   *  Used by the UI "Close now" button — bypasses TP/SL/signal logic. */
  async closeNow(): Promise<{ ok: boolean; message: string }> {
    if (!state.position) return { ok: false, message: 'No open position to close.' };
    const price = state.currentPrice || state.position.entryPrice;
    addLog('warning', `✋ Manual close requested @ $${price.toLocaleString()}`);
    await closePosition('Manual', price);
    return state.position
      ? { ok: false, message: 'Close failed — see bot log for the on-chain error.' }
      : { ok: true,  message: 'Position closed manually.' };
  },

  /** KILL SWITCH — halt the bot AND flatten any open position at market, now.
   *  One call for the panic button: stops the loop first (no new entries), then
   *  closes the live position. Safe to call when flat (just stops). */
  async killSwitch(): Promise<{ ok: boolean; message: string; flattened: boolean }> {
    addLog('warning', '🛑 KILL SWITCH — stopping the bot and flattening all positions');
    this.stop();
    if (!state.position) return { ok: true, message: 'Bot stopped. No open position.', flattened: false };
    const price = state.currentPrice || state.position.entryPrice;
    try {
      await closePosition('Manual', price);
    } catch (e: any) {
      addLog('error', `Kill switch: position close failed — ${e?.message || e}`);
    }
    return state.position
      ? { ok: false, message: 'Bot stopped, but the position close FAILED — retry “Flatten” or close on-chain.', flattened: false }
      : { ok: true,  message: 'Bot stopped and all positions flattened.', flattened: true };
  },
};
