/**
 * WebBotPanel — the "Web Bot" (no-install) mode.
 *
 * Runs the ENTIRE bot loop inside the browser tab — no Local Agent required:
 *   • Streams candles from Binance over a WebSocket (event-driven, so a hidden/
 *     backgrounded tab keeps reacting even when Chrome throttles timers).
 *   • Detects entries with the shared detectLiveSignal (same engine as backtest).
 *   • Manages exits with the shared manageExit (TP / SL / trailing / breakeven).
 *   • On every entry/exit it builds the real on-chain tx and asks the user to sign
 *     with their own wallet (dApp-kit) — the private key never leaves the wallet.
 *
 * This is the self-custody / no-install tier: maximum key safety, but the user
 * must be present to approve each trade. The downloadable Agent is the hands-off
 * 24/7 tier (self-signs, survives tab close).
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useSignAndExecuteTransaction, useCurrentAccount, useSuiClient } from '@mysten/dapp-kit';
import { DeepBookClient } from '@mysten/deepbook-v3';
import {
  detectLiveSignal, manageExit,
  type Candle, type ManagedPosition, type ExitReason, type IndicatorType,
} from '../agent/backtestEngine';
import {
  calcWebSize, buildSuiOpenTx, buildSuiCloseTx, buildXbtcTx, XBTC_MIN_QTY,
  buildXbtcSetupTx, buildSuiMarginCreateTx, buildSuiDepositTx, USDC_TYPE_FULL,
} from '../agent/webBotEngine';
import { loadBotSkills, PRESET_SKILLS, SIGNAL_LABELS, type BotSkillConfig } from '../types/botSkill';
import { AGENT_URL } from '../agent/agentUrl';
import { usePythOracle } from '../hooks/usePythOracle';
import { pickBestSuiUsdcManager } from '../utils/marginDetail';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface WebPos extends ManagedPosition {
  entryTime: string;
  borrowAsset: string;   // SUI | USDC | XBTC
  borrowAmount: number;  // borrow (SUI) or qty (xBTC) — what the close tx repays/sells
}
interface LogEntry { id: number; time: string; type: 'info'|'signal'|'trade'|'error'|'warning'; msg: string; digest?: string; }
interface LiveInd { rsi: number; ema9: number; ema21: number; macdHist: number; bbUpper: number; bbLower: number; }

const TF_OPTIONS = ['5m', '15m', '30m', '1h'];
const TF_MIN: Record<string, number> = { '5m': 5, '15m': 15, '30m': 30, '1h': 60 };
const PAIRS = [
  { value: 'SUI_USDC',  label: 'SUI/USDC', venue: 'DeepBook', sym: 'SUIUSDT', color: '#00d4ff' },
  { value: 'XBTC_USDC', label: 'BTC/USDC', venue: 'DeepTrade', sym: 'BTCUSDT', color: '#f59e0b' },
];
const symbolOf = (pair: string) => PAIRS.find(p => p.value === pair)?.sym ?? 'SUIUSDT';
const isXbtc = (pair: string) => pair === 'XBTC_USDC';
const LOG_COLORS: Record<string,string> = { info:'#64748b', signal:'#00d4ff', trade:'#22c55e', error:'#ef4444', warning:'#f59e0b' };
const LOG_ICONS:  Record<string,string> = { info:'🔍', signal:'📡', trade:'✅', error:'❌', warning:'⚠️' };

const inp: React.CSSProperties = { background:'#0a0f1d', border:'1px solid #1e293b', borderRadius:6, padding:'7px 10px', color:'#e2e8f0', fontSize:'0.8rem', width:'100%', boxSizing:'border-box' };
const card: React.CSSProperties = { background:'#0f172a', border:'1px solid #1e293b', borderRadius:12, padding:16 };
const setupBtn: React.CSSProperties = { width:'100%', padding:'8px 12px', borderRadius:8, border:'1px solid #00d4ff', background:'rgba(0,212,255,0.08)', color:'#00d4ff', fontSize:'0.76rem', fontWeight:700, cursor:'pointer' };

// ─── REST seed of closed candles ───────────────────────────────────────────────
async function seedCandles(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const data = await fetch(url).then(r => r.json());
  if (!Array.isArray(data)) throw new Error('Binance klines unavailable');
  // Drop the last (still-forming) candle — keep only closed bars.
  return data.slice(0, -1).map((k: any[]) => ({
    date: new Date(k[0]).toISOString(),
    open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
  }));
}

// ─── Component ───────────────────────────────────────────────────────────────────
export const WebBotPanel: React.FC = () => {
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();
  const { fetchAndInjectVAA } = usePythOracle(suiClient);

  // Config
  const [botSkills, setBotSkills]         = useState<BotSkillConfig[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<BotSkillConfig | null>(null);
  const [pair, setPair]                   = useState('SUI_USDC');
  const [timeframe, setTimeframe]         = useState('15m');
  const [capitalSUI, setCapitalSUI]       = useState(0.5);

  // Runtime
  const [running, setRunning]     = useState(false);
  const [price, setPrice]         = useState(0);
  const [signal, setSignal]       = useState<'BUY'|'SELL'|'HOLD'>('HOLD');
  const [indicators, setIndicators] = useState<LiveInd>({ rsi:50, ema9:0, ema21:0, macdHist:0, bbUpper:0, bbLower:0 });
  const [position, setPosition]   = useState<WebPos | null>(null);
  const [logs, setLogs]           = useState<LogEntry[]>([]);
  const [tradeCount, setTradeCount] = useState(0);
  const [totalPnl, setTotalPnl]   = useState(0);
  const [busy, setBusy]           = useState(false);
  const [notifyOn, setNotifyOn]   = useState(false);
  const [lastUpdate, setLastUpdate] = useState('');   // wall-clock of last feed tick (liveness proof)

  // Managers
  const [suiManagerKey, setSuiManagerKey] = useState<string | null>(null);
  const [mgrChecking, setMgrChecking]     = useState(false);
  const [dtBalanceManager, setDtBalanceManager] = useState(() => localStorage.getItem('dt_balance_manager') || '');
  const [dtFeeManager,     setDtFeeManager]     = useState(() => localStorage.getItem('dt_fee_manager') || '');
  useEffect(() => { localStorage.setItem('dt_balance_manager', dtBalanceManager); }, [dtBalanceManager]);
  useEffect(() => { localStorage.setItem('dt_fee_manager', dtFeeManager); }, [dtFeeManager]);

  // One-time account setup (so Web users never need Client Mode)
  const [collateralUSDC, setCollateralUSDC] = useState(10);
  const [setupBusy, setSetupBusy]           = useState(false);

  // Refs (WS handler must read fresh values without re-subscribing)
  const candlesRef  = useRef<Candle[]>([]);
  const liveRef     = useRef<{ t: number; o: number; h: number; l: number; c: number } | null>(null);
  const posRef      = useRef<WebPos | null>(null);
  const busyRef     = useRef(false);
  const runningRef  = useRef(false);
  const oppRef      = useRef<{ buy: boolean; sell: boolean }>({ buy: false, sell: false });
  const lastEntryBarRef = useRef<string>('');
  const cfgRef      = useRef<any>(null);
  const wsRef       = useRef<WebSocket | null>(null);
  const lastMsgRef  = useRef(0);          // Date.now() of last WS frame — watchdog staleness ref
  const reconnectingRef = useRef(false);  // guards against overlapping reconnects
  const lastSecRef  = useRef('');         // throttle the "last update" clock to 1 render/sec
  const logIdRef    = useRef(0);
  const logsBoxRef  = useRef<HTMLDivElement>(null);

  const addLog = useCallback((type: LogEntry['type'], msg: string, digest?: string) => {
    setLogs(prev => [...prev.slice(-120), { id: ++logIdRef.current, time: new Date().toLocaleTimeString(), type, msg, digest }]);
  }, []);

  useEffect(() => { if (logsBoxRef.current) logsBoxRef.current.scrollTop = logsBoxRef.current.scrollHeight; }, [logs]);

  const notify = useCallback((title: string, body: string) => {
    try { if (notifyOn && typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(title, { body }); } catch { /* ignore */ }
  }, [notifyOn]);

  // ── Load skills (presets + local + agent store, deduped) ──
  useEffect(() => {
    const merge = (list: BotSkillConfig[]) => {
      const byName = new Map<string, BotSkillConfig>();
      for (const p of PRESET_SKILLS) byName.set(p.name, p);
      for (const s of list) byName.set(s.name, s);
      return Array.from(byName.values());
    };
    const pickDefault = (list: BotSkillConfig[]) =>
      list.find(s => /sui_supertrend_m5_v2/i.test(s.name)) || list.find(s => /sui_alpha_m30/i.test(s.name)) || list[0] || null;
    const local = merge(loadBotSkills());
    setBotSkills(local);
    setSelectedSkill(prev => prev || pickDefault(local));
    fetch(`${AGENT_URL}/api/skills/bot`).then(r => r.json())
      .then(d => { if (d.skills?.length) { const m = merge(d.skills); setBotSkills(m); } }).catch(() => {});
  }, []);

  // ── Auto-align pair + timeframe to the selected skill ──
  useEffect(() => {
    if (!selectedSkill) return;
    if (selectedSkill.preferredAsset === 'sui') setPair('SUI_USDC');
    else if (selectedSkill.preferredAsset === 'btc') setPair('XBTC_USDC');
    const tfMap: Record<string, string> = { M5:'5m', M15:'15m', M30:'30m', H1:'1h' };
    const pref = selectedSkill.preferredTimeframe;
    if (pref && tfMap[pref]) setTimeframe(tfMap[pref]);
  }, [selectedSkill]);

  // ── Discover the SUI/USDC margin manager when needed ──
  const discoverManager = useCallback(async () => {
    const addr = account?.address;
    if (!addr) { setSuiManagerKey(null); return; }
    setMgrChecking(true);
    try {
      const db = new DeepBookClient({ client: suiClient as any, network: 'mainnet', address: addr });
      const ids = await db.getMarginManagerIdsForOwner(addr);
      setSuiManagerKey(ids.length ? await pickBestSuiUsdcManager(suiClient, ids) : null);
    } catch { setSuiManagerKey(null); }
    finally { setMgrChecking(false); }
  }, [account, suiClient]);

  useEffect(() => { if (pair === 'SUI_USDC') discoverManager(); }, [pair, account, discoverManager]);

  // ── One-time setup: DeepTrade account (xBTC) — browser-signed, no agent ──
  const handleXbtcSetup = useCallback(async () => {
    const addr = account?.address;
    if (!addr) { alert('Connect your wallet first.'); return; }
    setSetupBusy(true);
    try {
      const tx = buildXbtcSetupTx(addr);
      const res = await signAndExecute({ transaction: tx });
      await suiClient.waitForTransaction({ digest: res.digest, timeout: 30_000 });
      const full = await suiClient.getTransactionBlock({ digest: res.digest, options: { showObjectChanges: true } });
      const changes: any[] = (full.objectChanges as any[]) || [];
      const bm = changes.find(c => c.type === 'created' && /::balance_manager::BalanceManager$/.test(c.objectType || ''));
      const fm = changes.find(c => c.type === 'created' && /::fee_manager::FeeManager$/.test(c.objectType || ''));
      if (bm?.objectId) setDtBalanceManager(bm.objectId);
      if (fm?.objectId) setDtFeeManager(fm.objectId);
      addLog('trade', `✅ DeepTrade account ready — BalanceManager + FeeManager created.`, res.digest);
    } catch (e: any) {
      addLog('error', `❌ DeepTrade setup failed: ${e?.message || e}`);
    } finally { setSetupBusy(false); }
  }, [account, signAndExecute, suiClient, addLog]);

  // ── One-time setup: SUI/USDC margin account + initial USDC collateral ──
  const handleSuiMarginSetup = useCallback(async () => {
    const addr = account?.address;
    if (!addr) { alert('Connect your wallet first.'); return; }
    if (collateralUSDC <= 0) { alert('Enter a collateral amount greater than 0.'); return; }
    setSetupBusy(true);
    try {
      const need = BigInt(Math.floor(collateralUSDC * 1e6));
      const bal  = await suiClient.getBalance({ owner: addr, coinType: USDC_TYPE_FULL });
      if (BigInt(bal.totalBalance || '0') < need)
        throw new Error(`Insufficient USDC: wallet has ${(Number(bal.totalBalance||'0')/1e6).toFixed(4)}, need ${collateralUSDC}.`);
      const tx = buildSuiMarginCreateTx(suiClient, addr, collateralUSDC);
      const res = await signAndExecute({ transaction: tx });
      await suiClient.waitForTransaction({ digest: res.digest, timeout: 30_000 });
      await discoverManager();
      addLog('trade', `✅ SUI/USDC margin account created + ${collateralUSDC} USDC deposited.`, res.digest);
    } catch (e: any) {
      const m = String(e?.message || e);
      addLog('error', `❌ Margin setup failed: ${/insufficient/i.test(m) ? m : m}`);
    } finally { setSetupBusy(false); }
  }, [account, signAndExecute, suiClient, collateralUSDC, discoverManager, addLog]);

  // ── Deposit more USDC into an existing SUI/USDC margin account ──
  const handleSuiDeposit = useCallback(async () => {
    const addr = account?.address;
    if (!addr || !suiManagerKey) { alert('No margin account to deposit into.'); return; }
    if (collateralUSDC <= 0) { alert('Enter a deposit amount greater than 0.'); return; }
    setSetupBusy(true);
    try {
      const need = BigInt(Math.floor(collateralUSDC * 1e6));
      const bal  = await suiClient.getBalance({ owner: addr, coinType: USDC_TYPE_FULL });
      if (BigInt(bal.totalBalance || '0') < need)
        throw new Error(`Insufficient USDC: wallet has ${(Number(bal.totalBalance||'0')/1e6).toFixed(4)}, need ${collateralUSDC}.`);
      const tx = buildSuiDepositTx(suiClient, addr, suiManagerKey, collateralUSDC);
      const res = await signAndExecute({ transaction: tx });
      await suiClient.waitForTransaction({ digest: res.digest, timeout: 30_000 });
      await discoverManager();
      addLog('trade', `✅ Deposited ${collateralUSDC} USDC into the margin account.`, res.digest);
    } catch (e: any) {
      addLog('error', `❌ Deposit failed: ${e?.message || e}`);
    } finally { setSetupBusy(false); }
  }, [account, signAndExecute, suiClient, suiManagerKey, collateralUSDC, discoverManager, addLog]);

  // ── Signal options pulled from the active skill ──
  const signalOpts = useCallback((s: BotSkillConfig) => ({
    supertrendMult: s.supertrendMult, supertrendPeriod: s.supertrendPeriod, breakoutPeriod: s.breakoutPeriod,
    htfMinutes: s.htfMinutes, htfSupertrendPeriod: s.htfSupertrendPeriod, htfSupertrendMult: s.htfSupertrendMult,
    filters: s.filters,
  }), []);

  // ── OPEN a position (build tx → wallet sign) ──
  const openTrade = useCallback(async (type: 'LONG'|'SHORT', entryPrice: number) => {
    const cfg = cfgRef.current; const addr = account?.address;
    if (!cfg || !addr || busyRef.current || posRef.current) return;
    busyRef.current = true; setBusy(true);

    const { borrowSUI, borrowUSDC } = calcWebSize(cfg.skill, cfg.capitalSUI, entryPrice);
    const tpPrice = type === 'LONG' ? entryPrice * (1 + cfg.skill.takeProfitPct/100) : entryPrice * (1 - cfg.skill.takeProfitPct/100);
    const slPrice = type === 'LONG' ? entryPrice * (1 - cfg.skill.stopLossPct/100)   : entryPrice * (1 + cfg.skill.stopLossPct/100);

    notify(`Suirobo: ${type} signal`, `${cfg.pair} @ $${entryPrice} — open your wallet to sign.`);
    addLog('signal', `📡 ${type} signal @ $${entryPrice} — building order, sign in wallet…`);

    try {
      let borrowAsset = 'USDC', borrowAmount = borrowUSDC, tx;
      if (isXbtc(cfg.pair)) {
        if (!dtBalanceManager || !dtFeeManager) throw new Error('DeepTrade account not set up (BalanceManager + FeeManager).');
        const qty = Math.max(0, Math.round((borrowUSDC / entryPrice) * 1e8) / 1e8);
        if (qty < XBTC_MIN_QTY) throw new Error(`Computed size ${qty} xBTC is below the ${XBTC_MIN_QTY} xBTC pool minimum — raise capital.`);
        tx = await buildXbtcTx({ address: addr, side: type === 'LONG' ? 'buy' : 'sell', price: entryPrice, quantity: qty,
          balanceManagerId: dtBalanceManager, feeManagerId: dtFeeManager, isOpening: true, skillAuthor: cfg.skill.authorAddress });
        borrowAsset = 'XBTC'; borrowAmount = qty;
      } else {
        if (!suiManagerKey) throw new Error('No SUI/USDC margin account — create one in Agent Mode first.');
        const amount = type === 'LONG' ? borrowSUI : borrowUSDC;
        borrowAsset  = type === 'LONG' ? 'SUI' : 'USDC'; borrowAmount = amount;
        tx = await buildSuiOpenTx({ suiClient, address: addr, managerKey: suiManagerKey, type, amount,
          injectPyth: fetchAndInjectVAA, skillAuthor: cfg.skill.authorAddress });
      }
      const res = await signAndExecute({ transaction: tx });
      const pos: WebPos = { type, entryPrice, tpPrice, slPrice, peakPrice: entryPrice, beApplied: false,
        entryTime: new Date().toISOString(), borrowAsset, borrowAmount };
      posRef.current = pos; setPosition(pos);
      setTradeCount(n => n + 1);
      const feeNote = cfg.skill.authorAddress ? ' · 0.01 SUI author fee' : '';
      addLog('trade', `✅ Opened ${type} @ $${entryPrice}${feeNote}`, res.digest);
    } catch (e: any) {
      const m = String(e?.message || e);
      addLog(/reject|denied|cancel/i.test(m) ? 'warning' : 'error', `${/reject|denied|cancel/i.test(m) ? '🛑 Sign cancelled' : '❌ Open failed'}: ${m}`);
    } finally { busyRef.current = false; setBusy(false); }
  }, [account, suiClient, suiManagerKey, dtBalanceManager, dtFeeManager, fetchAndInjectVAA, signAndExecute, notify, addLog]);

  // ── CLOSE the open position ──
  const closeTrade = useCallback(async (reason: ExitReason | 'Manual', exitPrice: number) => {
    const cfg = cfgRef.current; const addr = account?.address; const pos = posRef.current;
    if (!cfg || !addr || !pos || busyRef.current) return;
    busyRef.current = true; setBusy(true);

    const diff   = pos.type === 'LONG' ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice;
    const pnlPct = Math.round((diff / pos.entryPrice) * cfg.skill.leverage * 100 * 10) / 10;
    const pnlApprox = Math.round(pos.borrowAmount * (diff / pos.entryPrice) * 100) / 100;

    notify(`Suirobo: closing (${reason})`, `${cfg.pair} @ $${exitPrice} — sign to close.`);
    addLog('signal', `🔔 ${reason} @ $${exitPrice} — sign to close (PnL ≈ ${pnlApprox >= 0 ? '+' : ''}${pnlApprox})`);

    try {
      let tx;
      if (isXbtc(cfg.pair)) {
        tx = await buildXbtcTx({ address: addr, side: pos.type === 'LONG' ? 'sell' : 'buy', price: exitPrice,
          quantity: pos.borrowAmount, balanceManagerId: dtBalanceManager, feeManagerId: dtFeeManager, isOpening: false });
      } else {
        if (!suiManagerKey) throw new Error('Margin manager unavailable to close.');
        tx = await buildSuiCloseTx({ suiClient, address: addr, managerKey: suiManagerKey, type: pos.type,
          amount: pos.borrowAmount, injectPyth: fetchAndInjectVAA });
      }
      const res = await signAndExecute({ transaction: tx });
      posRef.current = null; setPosition(null);
      setTradeCount(n => n + 1);
      setTotalPnl(p => Math.round((p + pnlApprox) * 100) / 100);
      addLog('trade', `✅ Closed ${pos.type} | ${reason} | PnL ≈ ${pnlApprox >= 0 ? '+' : ''}${pnlApprox}`, res.digest);
    } catch (e: any) {
      const m = String(e?.message || e);
      addLog('error', `❌ Close failed (position kept open): ${m}`);
    } finally { busyRef.current = false; setBusy(false); }
  }, [account, suiClient, suiManagerKey, dtBalanceManager, dtFeeManager, fetchAndInjectVAA, signAndExecute, notify, addLog]);

  // ── On each CLOSED candle: detect entry / refresh opposite-signal cache ──
  const onClosedBar = useCallback(() => {
    const cfg = cfgRef.current; if (!cfg) return;
    const candles = candlesRef.current;
    if (candles.length < 32) return;
    const sig = detectLiveSignal(candles, cfg.skill.signal as IndicatorType, cfg.skill.direction, cfg.opts);
    oppRef.current = { buy: sig.buy, sell: sig.sell };
    setIndicators(sig.lastValues);
    setSignal(sig.buy ? 'BUY' : sig.sell ? 'SELL' : 'HOLD');

    const lastBar = candles[candles.length - 1].date;
    if (!posRef.current && !busyRef.current && (sig.buy || sig.sell) && lastEntryBarRef.current !== lastBar) {
      lastEntryBarRef.current = lastBar;
      openTrade(sig.buy ? 'LONG' : 'SHORT', candles[candles.length - 1].close);
    }
  }, [openTrade]);

  // ── On each price tick: manage the open position (TP/SL/trailing/BE/opposite) ──
  const manageTick = useCallback((tick: { high: number; low: number; close: number }) => {
    const cfg = cfgRef.current; const pos = posRef.current;
    if (!cfg || !pos || busyRef.current) return;
    const exit = manageExit(cfg.skill, pos, tick, oppRef.current);
    if (exit) closeTrade(exit.reason, exit.price);
    else setPosition({ ...pos });   // reflect peak/BE mutations in the UI
  }, [closeTrade]);

  // ── (Re)connect the Binance feed: re-seed closed bars (fills any gap missed
  //    while disconnected), then open the kline WebSocket. Reused by Start, the
  //    onclose retry, the visibility handler, and the staleness watchdog. ──
  const connectFeed = useCallback(async (reason?: string) => {
    const cfg = cfgRef.current; if (!cfg || !runningRef.current) return;
    if (reconnectingRef.current) return;
    reconnectingRef.current = true;
    try {
      const symbol = symbolOf(cfg.pair); const interval = cfg.timeframe;
      try { wsRef.current?.close(); } catch { /* ignore */ }
      wsRef.current = null;
      if (reason) addLog('info', `🔄 ${reason} — refreshing feed…`);
      // Re-seed: a fresh REST pull also recovers any bars (and signals) missed
      // while the socket was down/backgrounded, so we never skip an entry.
      try {
        const lookback = cfg.skill.htfMinutes ? 1000 : 250;
        candlesRef.current = await seedCandles(symbol, interval, lookback);
        onClosedBar();
      } catch (e: any) { addLog('error', `Seed failed: ${e?.message || e}`); }

      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`);
      wsRef.current = ws;
      lastMsgRef.current = Date.now();
      ws.onopen  = () => { lastMsgRef.current = Date.now(); addLog('info', `🔌 Live feed connected (${symbol} ${interval}). Bot is watching.`); };
      ws.onerror = () => { /* onclose will handle the retry */ };
      ws.onclose = () => { if (runningRef.current) setTimeout(() => connectFeed('Feed dropped'), 2000); };
      ws.onmessage = (evt) => {
        try {
          const k = JSON.parse(evt.data).k; if (!k) return;
          lastMsgRef.current = Date.now();
          const c = +k.c;
          liveRef.current = { t: k.t, o: +k.o, h: +k.h, l: +k.l, c };
          setPrice(c);
          // Liveness clock — throttled to one render/sec to avoid churn.
          const sec = new Date().toLocaleTimeString();
          if (sec !== lastSecRef.current) { lastSecRef.current = sec; setLastUpdate(sec); }
          manageTick({ high: +k.h, low: +k.l, close: c });   // intrabar TP/SL
          if (k.x) {
            const closed: Candle = { date: new Date(k.t).toISOString(), open: +k.o, high: +k.h, low: +k.l, close: c, volume: +k.v };
            const arr = candlesRef.current;
            if (!arr.length || arr[arr.length - 1].date !== closed.date) { arr.push(closed); if (arr.length > 1200) arr.shift(); }
            liveRef.current = null;
            onClosedBar();
          }
        } catch { /* ignore malformed frame */ }
      };
    } finally { reconnectingRef.current = false; }
  }, [onClosedBar, manageTick, addLog]);

  // ── Start ──
  const handleStart = useCallback(async () => {
    if (!account?.address) { alert('Connect your Sui wallet first — the Web Bot signs trades with your wallet.'); return; }
    if (!selectedSkill) { alert('Select a bot first.'); return; }
    if (isXbtc(pair)) {
      if (!dtBalanceManager || !dtFeeManager) { alert('BTC/USDC needs a DeepTrade account.\n\nClick "🔧 Set up DeepTrade Account" in the panel below first.'); return; }
    } else {
      if (!suiManagerKey) { alert('No SUI/USDC margin account found.\n\nClick "🔧 Create margin account" in the panel below first.'); return; }
    }
    // Notifications (best-effort)
    try { if (typeof Notification !== 'undefined' && Notification.permission === 'default') { const p = await Notification.requestPermission(); setNotifyOn(p === 'granted'); } else if (typeof Notification !== 'undefined') setNotifyOn(Notification.permission === 'granted'); } catch { /* ignore */ }

    // Freeze config for the loop
    cfgRef.current = { skill: selectedSkill, pair, timeframe, capitalSUI, opts: signalOpts(selectedSkill) };
    lastEntryBarRef.current = '';
    runningRef.current = true; setRunning(true);
    addLog('info', `▶ Web Bot started (${PAIRS.find(p=>p.value===pair)?.label} ${timeframe}) — keep this tab open (hidden is fine).`);
    await connectFeed();
  }, [account, selectedSkill, pair, timeframe, capitalSUI, suiManagerKey, dtBalanceManager, dtFeeManager, signalOpts, connectFeed, addLog]);

  // ── Stop ──
  const handleStop = useCallback(() => {
    runningRef.current = false; setRunning(false);
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
    addLog('warning', `⏹ Web Bot stopped.${posRef.current ? ' Position still OPEN — use "Close now" to exit.' : ''}`);
  }, [addLog]);

  // ── Resilience: reconnect on tab re-focus + a staleness watchdog ──
  // Background tabs can have their WebSocket frozen/closed by the browser. Relying
  // on `onclose` alone is unreliable, so we also (a) reconnect the moment the tab
  // becomes visible if the socket isn't OPEN, and (b) run a watchdog that forces a
  // reconnect if no frame has arrived in 90s.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && runningRef.current) {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) connectFeed('Tab active');
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [connectFeed]);

  useEffect(() => {
    if (!running) return;
    const iv = setInterval(() => {
      if (!runningRef.current) return;
      const ws = wsRef.current;
      const stale = Date.now() - lastMsgRef.current > 90_000;
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING || stale) {
        connectFeed('Watchdog: feed stale');
      }
    }, 20_000);
    return () => clearInterval(iv);
  }, [running, connectFeed]);

  useEffect(() => () => { runningRef.current = false; try { wsRef.current?.close(); } catch { /* ignore */ } }, []);

  const pairMeta = PAIRS.find(p => p.value === pair)!;
  const sizePreview = selectedSkill && price > 0 ? calcWebSize(selectedSkill, capitalSUI, price) : null;

  // ── Render ──
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.1fr)', gap: 16 }}>
      {/* LEFT: config + status */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Self-custody banner */}
        <div style={{ ...card, borderColor: 'rgba(0,212,255,0.3)', background: 'rgba(0,212,255,0.05)' }}>
          <div style={{ fontWeight: 800, color: '#00d4ff', fontSize: '0.9rem', marginBottom: 4 }}>🌐 Web Bot — No Install, Self-Custody</div>
          <div style={{ color: '#94a3b8', fontSize: '0.74rem', lineHeight: 1.5 }}>
            Runs in this tab. On every signal you sign with your own wallet — your key never leaves it.
            Keep the tab open (hidden is fine). For hands-off 24/7 trading, download the Agent.
          </div>
        </div>

        <div style={card}>
          <label style={{ color:'#64748b', fontSize:'0.7rem', fontWeight:700, textTransform:'uppercase' }}>Bot</label>
          <select value={selectedSkill?.name || ''} disabled={running}
            onChange={e => setSelectedSkill(botSkills.find(s => s.name === e.target.value) || null)}
            style={{ ...inp, marginTop: 6 }}>
            {botSkills.map(s => <option key={s.name} value={s.name}>{s.name} — {SIGNAL_LABELS[s.signal] || s.signal}</option>)}
          </select>
          {selectedSkill && (
            <div style={{ color:'#475569', fontSize:'0.7rem', marginTop:6, lineHeight:1.5 }}>
              {SIGNAL_LABELS[selectedSkill.signal] || selectedSkill.signal} · {selectedSkill.direction} · TP {selectedSkill.takeProfitPct}% / SL {selectedSkill.stopLossPct}% · {selectedSkill.leverage}x
            </div>
          )}

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:12 }}>
            <div>
              <label style={{ color:'#64748b', fontSize:'0.7rem', fontWeight:700, textTransform:'uppercase' }}>Pair</label>
              <select value={pair} disabled={running} onChange={e => setPair(e.target.value)} style={{ ...inp, marginTop:6 }}>
                {PAIRS.map(p => <option key={p.value} value={p.value}>{p.label} ({p.venue})</option>)}
              </select>
            </div>
            <div>
              <label style={{ color:'#64748b', fontSize:'0.7rem', fontWeight:700, textTransform:'uppercase' }}>Timeframe</label>
              <select value={timeframe} disabled={running} onChange={e => setTimeframe(e.target.value)} style={{ ...inp, marginTop:6 }}>
                {TF_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          <div style={{ marginTop:12 }}>
            <label style={{ color:'#64748b', fontSize:'0.7rem', fontWeight:700, textTransform:'uppercase' }}>Capital (SUI)</label>
            <input type="number" min={0.1} step={0.1} value={capitalSUI} disabled={running}
              onChange={e => setCapitalSUI(Math.max(0.1, +e.target.value || 0.1))} style={{ ...inp, marginTop:6 }} />
            {sizePreview && (
              <div style={{ color:'#475569', fontSize:'0.68rem', marginTop:6 }}>
                ≈ margin {sizePreview.marginSUI.toFixed(3)} SUI · position {isXbtc(pair) ? `${(sizePreview.borrowUSDC/price).toFixed(6)} xBTC` : `${sizePreview.borrowSUI} SUI`}
              </div>
            )}
          </div>

          {/* Prerequisite status + one-time setup (self-serve — no Client Mode needed) */}
          <div style={{ marginTop:12, padding:'10px 12px', borderRadius:8, background:'#0a0f1d', border:'1px solid #1e293b' }}>
            {!account?.address ? (
              <span style={{ color:'#f59e0b', fontSize:'0.74rem' }}>⚠ Connect your wallet to trade.</span>
            ) : isXbtc(pair) ? (
              dtBalanceManager && dtFeeManager ? (
                <span style={{ color:'#22c55e', fontSize:'0.74rem' }}>✓ DeepTrade account ready. Make sure your wallet holds USDC (to buy) / xBTC (to sell).</span>
              ) : (
                <div>
                  <div style={{ color:'#f59e0b', fontSize:'0.74rem', marginBottom:8 }}>⚠ One-time setup: create your DeepTrade account.</div>
                  <button onClick={handleXbtcSetup} disabled={setupBusy || running}
                    style={setupBtn}>{setupBusy ? 'Signing…' : '🔧 Set up DeepTrade Account'}</button>
                </div>
              )
            ) : mgrChecking ? (
              <span style={{ color:'#64748b', fontSize:'0.74rem' }}>Checking margin account…</span>
            ) : suiManagerKey ? (
              <div>
                <div style={{ color:'#22c55e', fontSize:'0.74rem', marginBottom:8 }}>✓ SUI/USDC margin account found.</div>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <input type="number" min={1} step={1} value={collateralUSDC} disabled={setupBusy || running}
                    onChange={e => setCollateralUSDC(Math.max(1, +e.target.value || 1))}
                    style={{ ...inp, width:90, padding:'6px 8px' }} />
                  <span style={{ color:'#64748b', fontSize:'0.7rem' }}>USDC</span>
                  <button onClick={handleSuiDeposit} disabled={setupBusy || running} style={{ ...setupBtn, width:'auto', flex:1 }}>
                    {setupBusy ? 'Signing…' : '＋ Deposit USDC'}
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ color:'#f59e0b', fontSize:'0.74rem', marginBottom:8 }}>⚠ One-time setup: create a SUI/USDC margin account + deposit USDC collateral.</div>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                  <input type="number" min={1} step={1} value={collateralUSDC} disabled={setupBusy || running}
                    onChange={e => setCollateralUSDC(Math.max(1, +e.target.value || 1))}
                    style={{ ...inp, width:90, padding:'6px 8px' }} />
                  <span style={{ color:'#64748b', fontSize:'0.7rem' }}>USDC</span>
                  <button onClick={handleSuiMarginSetup} disabled={setupBusy || running} style={{ ...setupBtn, width:'auto', flex:1 }}>
                    {setupBusy ? 'Signing…' : '🔧 Create margin account'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Start / Stop */}
          {!running ? (
            <button onClick={handleStart}
              style={{ width:'100%', marginTop:14, padding:'12px', borderRadius:10, border:'none', cursor:'pointer',
                fontWeight:800, fontSize:'0.9rem', color:'#031018', background:`linear-gradient(135deg, ${pairMeta.color}, #2563eb)` }}>
              ▶ Start Web Bot
            </button>
          ) : (
            <button onClick={handleStop}
              style={{ width:'100%', marginTop:14, padding:'12px', borderRadius:10, border:'1px solid #ef4444', cursor:'pointer',
                fontWeight:800, fontSize:'0.9rem', color:'#ef4444', background:'transparent' }}>
              ⏹ Stop
            </button>
          )}
        </div>

        {/* Live status */}
        <div style={card}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
            <span style={{ fontWeight:800, color:'#e2e8f0', fontSize:'0.85rem', display:'flex', alignItems:'center', gap:8 }}>
              {pairMeta.label}
              {running && (
                <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:'0.62rem', color:'#22c55e', fontWeight:600 }}>
                  <span style={{ width:7, height:7, borderRadius:'50%', background:'#22c55e', boxShadow:'0 0 6px #22c55e' }} />
                  live{lastUpdate ? ` · ${lastUpdate}` : ''}
                </span>
              )}
            </span>
            <span style={{ fontFamily:'monospace', fontSize:'1.1rem', fontWeight:800, color: pairMeta.color }}>
              {price > 0 ? `$${price.toLocaleString(undefined, { maximumFractionDigits: 4 })}` : '—'}
            </span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, fontSize:'0.72rem' }}>
            <Stat label="Signal" value={signal} color={signal==='BUY'?'#22c55e':signal==='SELL'?'#ef4444':'#64748b'} />
            <Stat label="Trades" value={String(tradeCount)} color="#e2e8f0" />
            <Stat label="PnL ≈" value={`${totalPnl>=0?'+':''}${totalPnl}`} color={totalPnl>=0?'#22c55e':'#ef4444'} />
            <Stat label="RSI" value={indicators.rsi.toFixed(1)} color="#00d4ff" />
            <Stat label="EMA9" value={indicators.ema9 ? indicators.ema9.toFixed(4) : '—'} color="#94a3b8" />
            <Stat label="Status" value={running ? (busy ? 'SIGNING' : 'WATCHING') : 'IDLE'} color={running ? (busy?'#f59e0b':'#22c55e') : '#64748b'} />
          </div>

          {position && (
            <div style={{ marginTop:12, padding:'10px 12px', borderRadius:8,
              background: position.type==='LONG' ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
              border: `1px solid ${position.type==='LONG' ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <span style={{ fontWeight:800, color: position.type==='LONG'?'#22c55e':'#ef4444', fontSize:'0.8rem' }}>
                  {position.type} OPEN
                </span>
                <button onClick={() => closeTrade('Manual', price)} disabled={busy}
                  style={{ padding:'4px 10px', borderRadius:6, border:'1px solid #f59e0b', background:'transparent',
                    color:'#f59e0b', fontSize:'0.7rem', fontWeight:700, cursor: busy?'not-allowed':'pointer' }}>
                  Close now
                </button>
              </div>
              <div style={{ color:'#94a3b8', fontSize:'0.7rem', marginTop:6, lineHeight:1.6 }}>
                Entry ${position.entryPrice.toLocaleString(undefined,{maximumFractionDigits:4})} ·
                TP ${position.tpPrice.toLocaleString(undefined,{maximumFractionDigits:4})} ·
                SL ${position.slPrice.toLocaleString(undefined,{maximumFractionDigits:4})}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: activity log */}
      <div style={{ ...card, display:'flex', flexDirection:'column', minHeight: 460 }}>
        <div style={{ fontWeight:800, color:'#e2e8f0', fontSize:'0.85rem', marginBottom:10 }}>Activity</div>
        <div ref={logsBoxRef} style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:6, fontSize:'0.74rem', fontFamily:'monospace' }}>
          {logs.length === 0 && <div style={{ color:'#334155', textAlign:'center', marginTop:40 }}>Start the bot to watch signals stream in…</div>}
          {logs.map(l => (
            <div key={l.id} style={{ display:'flex', gap:8, alignItems:'flex-start', color: LOG_COLORS[l.type] }}>
              <span style={{ color:'#334155', flexShrink:0 }}>{l.time}</span>
              <span style={{ flexShrink:0 }}>{LOG_ICONS[l.type]}</span>
              <span style={{ wordBreak:'break-word' }}>
                {l.msg}
                {l.digest && <a href={`https://suiscan.xyz/mainnet/tx/${l.digest}`} target="_blank" rel="noreferrer" style={{ color:'#00d4ff', marginLeft:6 }}>↗ tx</a>}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => (
  <div style={{ background:'#0a0f1d', borderRadius:8, padding:'8px 10px' }}>
    <div style={{ color:'#475569', fontSize:'0.62rem', textTransform:'uppercase' }}>{label}</div>
    <div style={{ color, fontWeight:800, fontFamily:'monospace', marginTop:2 }}>{value}</div>
  </div>
);
