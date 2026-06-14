import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useCurrentAccount, useSuiClient, useSignTransaction } from '@mysten/dapp-kit';
import { useDeepTrade } from '../../hooks/useDeepTrade';
import { usePythOracle } from '../../hooks/usePythOracle';
import { Transaction } from '@mysten/sui/transactions';
import { DeepBookClient } from '@mysten/deepbook-v3';
import { SuiJsonRpcClient as SuiClient } from '@mysten/sui/jsonRpc';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { getMarginManagerDetail, pickBestSuiUsdcManager } from '../../utils/marginDetail';

// ── HELPERS ──

/** Mainnet types we care about for matching margin manager pool. */
const SUI_TYPE  = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
const USDC_TYPE = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

/**
 * Pick the margin manager that actually belongs to the SUI_USDC pool.
 *
 * Why: a wallet can own multiple `MarginManager<Base, Quote>` shared objects
 * (one per pool they've ever opened). Picking `managerIds[0]` blindly often
 * grabs a manager for a DIFFERENT pool (e.g. DEEP_USDC) — and then the deposit
 * moveCall fails on chain with `CommandArgumentError TypeMismatch` because
 * Move type-checks `MarginManager<SUI, USDC>` strictly.
 *
 * Strategy: query each shared object's type string and match the type params.
 * Returns the first manager whose type is `MarginManager<SUI, USDC>`, or null.
 */
async function pickSuiUsdcManager(
  suiClient: any,
  managerIds: string[],
): Promise<string | null> {
  for (const id of managerIds) {
    try {
      const obj = await suiClient.getObject({ id, options: { showType: true } });
      const type: string = obj?.data?.type ?? '';
      // Log every margin manager's type so we can see EXACTLY what Sui returns
      // when the user reports "not detected". Sui may use either canonical
      // 64-char or short-form addresses depending on the RPC / SDK.
      console.log('[pickSuiUsdcManager] candidate id=', id, 'type=', type);
      // Match by substring on type module names — works for BOTH canonical
      // and short-form addresses. SUI: `<...>::sui::SUI`. USDC native:
      // `<...>::usdc::USDC`. We additionally require it's a MarginManager
      // so we don't match other unrelated objects.
      const isMarginManager = /::margin_manager::MarginManager</.test(type);
      const hasSui  = /::sui::SUI[,>]/.test(type);
      const hasUsdc = /::usdc::USDC[,>]/.test(type);
      if (isMarginManager && hasSui && hasUsdc) {
        console.log('[pickSuiUsdcManager] ✓ MATCH', id);
        return normalizeSuiAddress(id);
      }
    } catch (e) {
      console.warn('[pickSuiUsdcManager] getObject failed for', id, e);
    }
  }
  console.warn('[pickSuiUsdcManager] no SUI/USDC manager matched among', managerIds.length, 'candidates');
  return null;
}

function formatCompact(n: number): string {
  if (!isFinite(n) || n === 0) return '0';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(2);
}

// ── TYPES & INTERFACES ──
interface Position {
  collateral: string;
  debt: string;
  ltv: string;
  healthFactor: string;
  action: string;
  type?: 'LONG' | 'SHORT';
  size?: string;
  entryPrice?: string;
  liqPrice?: string;
}

interface PredictPos {
  asset: string;
  direction: 'UP' | 'DOWN';
  positionId: string;
  capitalDUSDC: string;
  estimatedPnL: string;
  strikePrice: string;
  currentPrice: string;
  pnlStatus: string;
  daysRemaining: number;
  recommendation: string;
  // Real round identity — needed to rebuild the exact market_key on redeem.
  oracleId?: string;
  expiry?: number;
}

interface SpotOrder {
  id: string;
  symbol: string;
  type: 'BUY' | 'SELL';
  orderType: 'LIMIT' | 'MARKET';
  price: string;
  amount: string;
  total: string;
  status: 'PENDING' | 'FILLED';
  time: string;
}

// ── TOKEN COIN TYPES (Mainnet/Testnet) ──
const COIN_TYPES = {
  SUI: '0x2::sui::SUI',
  USDC: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  DEEP: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP',
  WAL: '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL',
  DUSDC: '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC',
  XBTC: '0x7a6bc6c6bdc0d17b4004d9fbc0f15d6eaebe86e02e82ee887ff8a0b204c3a5b4::xbtc::XBTC',
} as Record<string, string>;

const TOKEN_DECIMALS: Record<string, number> = {
  SUI: 9, USDC: 6, DEEP: 9, WAL: 9, DUSDC: 6, XBTC: 8,
};

const TOKEN_ICONS: Record<string, string> = {
  SUI: '💧', USDC: '💵', DEEP: '🌊', WAL: '🦭', DUSDC: '🏦', XBTC: '₿',
};

// ── MARGIN POOL PAIR CONFIGS ──
interface MarginPoolConfig {
  poolKey: string;
  base: string;
  quote: string;
  label: string;
  icon: string;
  basePrice: number; // approximate for display
}

const MARGIN_POOLS: MarginPoolConfig[] = [
  { poolKey: 'SUI_USDC', base: 'SUI', quote: 'USDC', label: 'SUI / USDC', icon: '💧', basePrice: 3.5 },
  { poolKey: 'XBTC_USDC', base: 'XBTC', quote: 'USDC', label: 'xBTC / USDC', icon: '₿', basePrice: 109000 },
];

// Testnet SuiClient for Predict (DUSDC)
const TESTNET_RPC = 'https://fullnode.testnet.sui.io';

// ── TOAST NOTIFICATION ──
function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error' | 'info'; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const bg = {
    success: 'linear-gradient(135deg, #10b981, #059669)',
    error: 'linear-gradient(135deg, #ef4444, #dc2626)',
    info: 'linear-gradient(135deg, #3b82f6, #2563eb)'
  }[type];

  return (
    <div style={{
      position: 'fixed', top: 24, right: 24, zIndex: 1000,
      background: bg, color: '#fff', padding: '14px 20px', borderRadius: 10,
      boxShadow: '0 10px 30px rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', gap: 12,
      fontFamily: 'sans-serif', fontWeight: 600, fontSize: '0.85rem',
      animation: 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards'
    }}>
      <span>{type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️'}</span>
      <span>{message}</span>
      <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1rem', marginLeft: 10 }}>×</button>
    </div>
  );
}

// ── STAT CARD ──
function StatCard({ label, value, sub, color = '#00d4ff' }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, #0f172a, #1e293b)', borderRadius: 12, padding: '16px',
      border: `1px solid ${color}22`, boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
      transition: 'transform 0.2s', position: 'relative', overflow: 'hidden'
    }}>
      <div style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: '1.4rem', fontWeight: 800, color, fontFamily: 'monospace' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: '#475569', marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ── INTERACTIVE SVG CHART ──
function PriceChart({ symbol, color = '#00d4ff', livePrice, onPriceTick }: { symbol: string; color?: string; livePrice?: number; onPriceTick?: (p: number) => void }) {
  // chart.deeptrade.io has no kline data for these pools (renders an empty chart),
  // so we chart the Binance market as a price proxy via TradingView's official embed.
  const tvSymbol = symbol === 'XBTC' ? 'BINANCE:BTCUSDT' : `BINANCE:${symbol}USDT`;

  return (
    <div style={{ background: '#090d16', borderRadius: 14, padding: 0, border: `1px solid ${color}33`, position: 'relative', overflow: 'hidden' }}>
      <iframe
        src={`https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(tvSymbol)}&interval=15&theme=dark&style=1&locale=en&hidesidetoolbar=1&hidetoptoolbar=0&saveimage=0&withdateranges=1`}
        width="100%"
        height="500px"
        frameBorder="0"
        allowFullScreen
        style={{ border: 'none', display: 'block' }}
        title="Price chart"
      />
    </div>
  );
}

// ── ORDERBOOK COMPONENT (real DeepBook V3 L2 depth) ──
type BookRow = { price: number; size: string; total: string };
function OrderBook({ symbol, currentPrice, pool }: { symbol: string; currentPrice: number; pool?: string }) {
  const poolKey = pool || `${symbol}_USDC`;
  const [book, setBook] = useState<{ bids: BookRow[]; asks: BookRow[]; spread: string }>({ bids: [], asks: [], spread: '' });

  useEffect(() => {
    let active = true;
    const mapRows = (rows: any[]): BookRow[] => rows.slice(0, 4).map((x: any) => {
      const price = Number(x[0]); const size = Number(x[1]);
      return { price, size: size.toFixed(1), total: (price * size).toFixed(0) };
    });
    const fetchBook = async () => {
      try {
        const r = await fetch(`https://deepbook-indexer.mainnet.mystenlabs.com/orderbook/${poolKey}?level=2&depth=8`, { signal: AbortSignal.timeout(6000) });
        const d = await r.json();
        if (!active || !Array.isArray(d?.bids) || !Array.isArray(d?.asks) || !d.bids.length || !d.asks.length) throw new Error('empty');
        const bestBid = Number(d.bids[0][0]); const bestAsk = Number(d.asks[0][0]);
        const spread = bestBid > 0 ? `$${(bestAsk - bestBid).toFixed(4)} (${(((bestAsk - bestBid) / bestBid) * 100).toFixed(2)}%)` : '—';
        setBook({ bids: mapRows(d.bids), asks: mapRows(d.asks).reverse(), spread });
      } catch {
        if (!active || !currentPrice) return; // keep last good data; no synthetic fabrication
      }
    };
    fetchBook();
    const t = setInterval(fetchBook, 5000);
    return () => { active = false; clearInterval(t); };
  }, [poolKey, currentPrice]);

  const asks = book.asks;
  const bids = book.bids;

  return (
    <div style={{
      background: '#0f172a', borderRadius: 14, border: '1px solid #1e293b',
      padding: '20px', display: 'flex', flexDirection: 'column', gap: 10,
      fontSize: '0.75rem', fontFamily: 'monospace'
    }}>
      <div style={{ fontWeight: 800, color: '#e2e8f0', fontSize: '0.8rem', borderBottom: '1px solid #1e293b', paddingBottom: 8 }}>
        📋 DEEPBOOK V3 ORDER BOOK
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontWeight: 700, paddingBottom: 4 }}>
        <span>Price (USDC)</span>
        <span>Size ({symbol})</span>
        <span>Total (USDC)</span>
      </div>

      {/* Asks */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {asks.map((ask, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: '#ef4444' }}>
            <span style={{ fontWeight: 600 }}>{ask.price.toFixed(3)}</span>
            <span style={{ color: '#94a3b8' }}>{ask.size}</span>
            <span style={{ color: '#475569' }}>{ask.total}</span>
          </div>
        ))}
      </div>

      <div style={{
        padding: '8px 0', borderTop: '1px solid #1e293b', borderBottom: '1px solid #1e293b',
        textAlign: 'center', fontWeight: 800, fontSize: '0.9rem', color: '#fff', background: '#090d16'
      }}>
        Spread: <span style={{ color: '#00d4ff' }}>{book.spread || '…'}</span>
      </div>

      {/* Bids */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {bids.map((bid, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: '#22c55e' }}>
            <span style={{ fontWeight: 600 }}>{bid.price.toFixed(3)}</span>
            <span style={{ color: '#94a3b8' }}>{bid.size}</span>
            <span style={{ color: '#475569' }}>{bid.total}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── MAIN MANUAL TRADE VIEW ──
interface ManualTradeViewProps {
  onAskAgent: (text: string) => void;
  disabled: boolean;
  dashboardData: any;
}

export const ManualTradeView: React.FC<ManualTradeViewProps> = ({ onAskAgent, disabled, dashboardData }) => {
  const [tab, setTab] = useState<'v3' | 'margin' | 'predict' | 'assets'>('v3');
  const account = useCurrentAccount();
  const suiClient = useSuiClient();
  const { mutateAsync: signTx } = useSignTransaction();
  const { livePrice, executeSwap, getSwapQuote, vaultManagerId, vaultBalances, depositToVault, executeLimitOrder, cancelLimitOrder } = useDeepTrade();
  const { fetchAndInjectVAA } = usePythOracle(suiClient as any);

  // Toast Notification state
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' | 'info') => {
    setToast({ message, type });
  };

  // Balances
  const [suiBalance, setSuiBalance] = useState<number>(0);
  const [usdcBalance, setUsdcBalance] = useState<number>(0);
  const [deepBalance, setDeepBalance] = useState<number>(0);
  const [walBalance, setWalBalance] = useState<number>(0);
  const [dusdcBalance, setDusdcBalance] = useState<number>(0);
  const [xbtcBalance, setXbtcBalance] = useState<number>(0);
  const [suiPrice, setSuiPrice] = useState(0);
  const [poolStats, setPoolStats] = useState<{ quoteVolume24h: number | null; change24hPct: number | null; bookDepthUsd: number | null }>({ quoteVolume24h: null, change24hPct: null, bookDepthUsd: null });

  // Live DeepBook V3 stats for the SUI/USDC pool (volume, 24h change, top-of-book USD depth)
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const [sumRes, bookRes] = await Promise.all([
          fetch('https://deepbook-indexer.mainnet.mystenlabs.com/summary', { signal: AbortSignal.timeout(7000) }),
          fetch('https://deepbook-indexer.mainnet.mystenlabs.com/orderbook/SUI_USDC?level=2&depth=20', { signal: AbortSignal.timeout(7000) }),
        ]);
        const summary = await sumRes.json();
        const book = await bookRes.json();
        const p = Array.isArray(summary) ? summary.find((x: any) => x?.trading_pairs === 'SUI_USDC') : null;
        const quoteVolume24h = p ? Number(p.quote_volume) : null;
        const change24hPct = p ? Number(p.price_change_percent_24h) : null;
        const sum = (rows: any[]) => rows.reduce((s, r) => s + Number(r[0]) * Number(r[1]), 0);
        const bookDepthUsd = (Array.isArray(book?.bids) && Array.isArray(book?.asks))
          ? sum(book.bids) + sum(book.asks) : null;
        if (active) setPoolStats({ quoteVolume24h, change24hPct, bookDepthUsd });
      } catch { /* keep last good values; no synthetic fallback */ }
    };
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => { active = false; clearInterval(t); };
  }, []);
  const [portfolioUSD, setPortfolioUSD] = useState(0);
  const testnetClientRef = useRef<any>(null);

  useEffect(() => {
    if (livePrice > 0) setSuiPrice(livePrice);
  }, [livePrice]);

  useEffect(() => {
    if (!account) {
       setSuiBalance(0);
       setUsdcBalance(0);
       setDeepBalance(0);
       setWalBalance(0);
       setDusdcBalance(0);
       setXbtcBalance(0);
       setPortfolioUSD(0);
       return;
    }
    const fetchBalances = async () => {
      try {
        // === MAINNET balances ===
        const allCoins = await suiClient.getAllBalances({ owner: account.address });

        // SUI
        const suiCoin = allCoins.find(c => c.coinType === COIN_TYPES.SUI);
        const suiBal = suiCoin ? Number(suiCoin.totalBalance) / 1e9 : 0;
        setSuiBalance(suiBal);

        // USDC
        const usdcCoin = allCoins.find(c => c.coinType.toLowerCase().includes('usdc') && !c.coinType.toLowerCase().includes('dusdc'));
        const usdcBal = usdcCoin ? Number(usdcCoin.totalBalance) / 1e6 : 0;
        setUsdcBalance(usdcBal);

        // DEEP
        const deepCoin = allCoins.find(c => c.coinType.toLowerCase().includes('deep::deep'));
        const deepBal = deepCoin ? Number(deepCoin.totalBalance) / 1e6 : 0;
        setDeepBalance(deepBal);

        // WAL
        const walCoin = allCoins.find(c => c.coinType.toLowerCase().includes('wal::wal'));
        const walBal = walCoin ? Number(walCoin.totalBalance) / 1e9 : 0;
        setWalBalance(walBal);

        // XBTC
        const xbtcCoin = allCoins.find(c => c.coinType.toLowerCase().includes('xbtc'));
        const xbtcBal = xbtcCoin ? Number(xbtcCoin.totalBalance) / 1e8 : 0;
        setXbtcBalance(xbtcBal);

        // === TESTNET DUSDC balance ===
        try {
          if (!testnetClientRef.current) {
            testnetClientRef.current = new SuiClient({ url: TESTNET_RPC, network: 'testnet' as any });
          }
          const testnetCoins = await testnetClientRef.current.getAllBalances({ owner: account.address });
          const dusdcCoin = testnetCoins.find((c: any) => c.coinType.toLowerCase().includes('dusdc'));
          const dusdcBal = dusdcCoin ? Number(dusdcCoin.totalBalance) / 1e6 : 0;
          setDusdcBalance(dusdcBal);
        } catch (e) {
          console.warn('Failed to fetch testnet DUSDC balance:', e);
        }

        // Total Portfolio (estimate) - mainnet only
        const deepPrice = 0.02;
        const walPrice = 0.5;
        const xbtcPrice = 109000;
        const total = suiBal * suiPrice + usdcBal + deepBal * deepPrice + walBal * walPrice + xbtcBal * xbtcPrice;
        setPortfolioUSD(total);
      } catch (e) {
        console.error("Failed to fetch balances", e);
      }
    };
    fetchBalances();
    const id = setInterval(fetchBalances, 10000);
    return () => clearInterval(id);
  }, [account, suiClient, suiPrice]);

  // Loading indicator for on-chain executions
  const [isExecuting, setIsExecuting] = useState(false);

  // States for lists
  const [spotOrders, setSpotOrders] = useState<SpotOrder[]>(() => {
    try {
      const saved = localStorage.getItem('suirobo_spot_orders');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch(e) {}
    return [];
  });

  useEffect(() => {
    localStorage.setItem('suirobo_spot_orders', JSON.stringify(spotOrders));
  }, [spotOrders]);

  const [marginPositions, setMarginPositions] = useState<Position[]>([]);
  const [predictPositions, setPredictPositions] = useState<PredictPos[]>([]);

  // ── LOAD INITIAL DATA ──
  useEffect(() => {
    if (dashboardData) {
      if (dashboardData.margin?.positions) {
        setMarginPositions(dashboardData.margin.positions);
      }
      // NOTE: Predict positions are intentionally NOT sourced from dashboardData.
      // Predict is an isolated TESTNET sandbox — its positions stay local and
      // never mix with mainnet/agent dashboard data.
    }
  }, [dashboardData]);


  // ── SPOT ORDER FORM STATES ──
  const [spotSide, setSpotSide] = useState<'BUY' | 'SELL'>('BUY');
  const [spotOrderType, setSpotOrderType] = useState<'LIMIT' | 'MARKET'>('LIMIT');
  const [spotPrice, setSpotPrice] = useState('');
  const [spotAmount, setSpotAmount] = useState('50');

  const spotTotal = useMemo(() => {
    const p = spotOrderType === 'LIMIT' ? parseFloat(spotPrice) || 0 : suiPrice;
    const a = parseFloat(spotAmount) || 0;
    return (p * a).toFixed(2);
  }, [spotOrderType, spotPrice, spotAmount, suiPrice]);

  // Auto fill spot price when live updates (also seed the LIMIT field once on first live tick)
  useEffect(() => {
    if (spotOrderType === 'MARKET') {
      setSpotPrice(suiPrice.toFixed(3));
    } else if (!spotPrice && suiPrice > 0) {
      setSpotPrice(suiPrice.toFixed(3));
    }
  }, [suiPrice, spotOrderType]);

  const handlePlaceSpotOrder = async () => {
    const amt = parseFloat(spotAmount);
    const tot = parseFloat(spotTotal);
    if (!amt || amt <= 0) return showToast('Order amount must be greater than 0!', 'error');

    if (spotOrderType === 'MARKET' || !vaultManagerId) {
      if (spotSide === 'BUY') {
        if (tot > usdcBalance) return showToast('Insufficient USDC balance in wallet', 'error');
      } else {
        if (amt > suiBalance) return showToast('Insufficient SUI balance in wallet', 'error');
      }
    }

    setIsExecuting(true);
    const poolKey = 'SUI_USDC';
    const isBid = spotSide === 'BUY';

    try {
      if (spotOrderType === 'LIMIT') {
        let currentVaultId = vaultManagerId;
        if (!currentVaultId) {
          showToast('No Vault yet. Initializing and depositing (Tx 1)...', 'info');
          const depositAmt = isBid ? tot : amt;
          const coinType = isBid ? 'USDC' : 'SUI';
          const depSuccess = await depositToVault(coinType, depositAmt);
          if (!depSuccess) {
            setIsExecuting(false);
            return;
          }
          currentVaultId = depSuccess;
          // The vault ID should be set now, but might need to re-click or wait for re-render
          // Wait briefly to let state update if needed, though react state batches
        }

        showToast(`Placing ${spotSide} limit order on DeepBook...`, 'info');
        const price = parseFloat(spotPrice);
        const success = await executeLimitOrder(poolKey, isBid, price, amt, currentVaultId);

        if (success) {
          showToast('Limit order placed!', 'success');
          
          const realOrderId = typeof success === 'string' ? success : ('0x' + Math.random().toString(16).slice(2, 10));
          
          setSpotOrders(prev => [{
            id: realOrderId,
            symbol: 'SUI',
            type: spotSide,
            orderType: 'LIMIT',
            price: price.toFixed(3),
            amount: amt.toFixed(1),
            total: spotTotal,
            status: 'PENDING',
            time: new Date().toLocaleTimeString()
          }, ...prev]);
        }
      } else {
        // MARKET SWAP
        showToast(`Fetching quote from DeepBook V3...`, 'info');
        const fromToken = isBid ? 'USDC' : 'SUI';
        const toToken = isBid ? 'SUI' : 'USDC';
        const amountToSwap = isBid ? tot : amt;

        const quote = await getSwapQuote(poolKey, fromToken, toToken, amountToSwap);
        if (!quote) {
          setIsExecuting(false);
          return showToast('Could not fetch rate from DeepBook', 'error');
        }

        showToast(`Submitting swap to Sui...`, 'info');
        const success = await executeSwap(quote);

        if (success) {
          showToast('Spot trade succeeded!', 'success');
          setSpotOrders(prev => [{
            id: '0x' + Math.random().toString(16).slice(2, 10),
            symbol: 'SUI',
            type: spotSide,
            orderType: 'MARKET',
            price: parseFloat(spotPrice).toFixed(3),
            amount: amt.toFixed(1),
            total: spotTotal,
            status: 'FILLED',
            time: new Date().toLocaleTimeString()
          }, ...prev]);
        }
      }
    } catch (e: any) {
      showToast(`Error: ${e.message}`, 'error');
    }
    
    setIsExecuting(false);
  };

  // ── MARGIN FORM STATES ──
  const [marginPoolKey, setMarginPoolKey] = useState<string>('SUI_USDC');
  const [marginSide, setMarginSide] = useState<'LONG' | 'SHORT'>('LONG');
  const [marginOrderType, setMarginOrderType] = useState<'LIMIT' | 'MARKET'>('MARKET');
  const [marginLimitPrice, setMarginLimitPrice] = useState('1.04');
  const [marginCollateral, setMarginCollateral] = useState('100');
  const [marginLeverage, setMarginLeverage] = useState(3);

  const currentMarginPool = MARGIN_POOLS.find(p => p.poolKey === marginPoolKey) || MARGIN_POOLS[0];
  const marginBasePrice = marginPoolKey === 'SUI_USDC' ? suiPrice : currentMarginPool.basePrice;
  const marginBaseBalance = marginPoolKey === 'SUI_USDC' ? vaultBalances.sui : 0;

  const marginDebt = useMemo(() => {
    const col = parseFloat(marginCollateral) || 0;
    return (col * marginBasePrice * (marginLeverage - 1)).toFixed(2);
  }, [marginCollateral, marginLeverage, marginBasePrice]);

  const marginLiqPrice = useMemo(() => {
    const lev = marginLeverage;
    const side = marginSide;
    if (side === 'LONG') {
      return (marginBasePrice * (1 - 1 / lev) * 1.1).toFixed(marginPoolKey === 'XBTC_USDC' ? 0 : 3);
    } else {
      return (marginBasePrice * (1 + 1 / lev) * 0.9).toFixed(marginPoolKey === 'XBTC_USDC' ? 0 : 3);
    }
  }, [marginSide, marginLeverage, marginBasePrice, marginPoolKey]);

  const handleOpenMarginPosition = async () => {
    const col = parseFloat(marginCollateral);
    if (!col || col <= 0) return showToast('Enter a valid collateral amount!', 'error');
    if (!account) return showToast('Connect your wallet first!', 'error');
    // depositBase pulls the collateral from the WALLET (via coinWithBalance),
    // so check the wallet balance — NOT the BalanceManager vault balance,
    // which is usually 0 and was blocking every open attempt.
    if (col > suiBalance) return showToast(`Wallet ${currentMarginPool.base} balance is insufficient (have ${suiBalance.toFixed(2)})`, 'error');

    setIsExecuting(true);
    showToast(`Preparing to open margin position ${currentMarginPool.base}...`, 'info');

    try {
      // First a plain client to discover whether a margin manager already exists.
      const discover = new DeepBookClient({
        client: suiClient as any, network: 'mainnet', address: account.address,
      });

      showToast(`Looking up Margin Account...`, 'info');
      let managerIds = await discover.getMarginManagerIdsForOwner(account.address);

      // If a manager exists, pick the one belonging to SUI_USDC pool (the
      // wallet may own managers from multiple pools — picking the wrong one
      // causes TypeMismatch on chain). Then re-init the client WITH the
      // marginManagers map so depositBase/borrowQuote/etc don't throw.
      let dbClient: DeepBookClient = discover;
      let resolvedManagerKey: string | null = null;
      if (managerIds.length > 0) {
        resolvedManagerKey = await pickBestSuiUsdcManager(suiClient, managerIds);
      }
      if (resolvedManagerKey) {
        const poolKey = 'SUI_USDC';
        dbClient = new DeepBookClient({
          client: suiClient as any, network: 'mainnet', address: account.address,
          marginManagers: { [resolvedManagerKey]: { marginManagerKey: resolvedManagerKey, address: resolvedManagerKey, poolKey } } as any,
        });
      }
      const tx = new Transaction();

      if (!resolvedManagerKey) {
        showToast(`No SUI/USDC margin account yet. Creating one and depositing ${col} ${currentMarginPool.base}...`, 'info');
        const { manager, initializer } = dbClient.marginManager.newMarginManagerWithInitializer(marginPoolKey)(tx);
        dbClient.marginManager.depositDuringInitialization({
          manager, poolKey: marginPoolKey, coinType: COIN_TYPES[currentMarginPool.base] || '0x2::sui::SUI', amount: col
        })(tx);
        dbClient.marginManager.shareMarginManager(marginPoolKey, manager, initializer)(tx);
      } else {
        const managerKey = resolvedManagerKey;

        // --- PYTH ORACLE — must come FIRST ---
        // Tx commands execute in insertion order. borrowQuote (and the margin
        // order placement) verify position health against the Pyth feeds, so
        // the price-update commands MUST precede them. Injecting after (the old
        // order) made borrow read a stale feed → MoveAbort EInvalidProof.
        showToast(`Updating Pyth Oracle price for ${marginPoolKey}...`, 'info');
        await fetchAndInjectVAA(tx, marginPoolKey);

        showToast(`Deposit ${col} ${currentMarginPool.base} collateral & borrow leveraged USDC...`, 'info');
        dbClient.marginManager.depositBase({ managerKey, amount: col })(tx);

        // Borrow the matching leveraged USDC amount (leverage - 1)
        const borrowAmt = col * marginBasePrice * (marginLeverage - 1);
        dbClient.marginManager.borrowQuote(managerKey, borrowAmt)(tx);

        // --- THỰC THI LỆNH TRADING ---
        const tradeQuantity = col * marginLeverage; // Tính theo BASE asset
        if (marginOrderType === 'MARKET') {
          dbClient.poolProxy.placeMarketOrder({
            poolKey: marginPoolKey,
            marginManagerKey: managerKey,
            clientOrderId: Date.now().toString(),
            quantity: tradeQuantity,
            isBid: marginSide === 'LONG',
            payWithDeep: false
          })(tx);
        } else {
          dbClient.poolProxy.placeLimitOrder({
            poolKey: marginPoolKey,
            marginManagerKey: managerKey,
            clientOrderId: Date.now().toString(),
            quantity: tradeQuantity,
            price: parseFloat(marginLimitPrice),
            isBid: marginSide === 'LONG',
            payWithDeep: false
          })(tx);
        }
      }

      showToast(`Please approve the Margin transaction in your wallet...`, 'info');
      const signed = await signTx({ transaction: tx });

      showToast(`Submitting transaction to Sui Mainnet...`, 'info');
      const result = await suiClient.executeTransactionBlock({
        transactionBlock: signed.bytes,
        signature: signed.signature,
        options: { showEffects: true }
      });

      if (result.effects?.status?.status === 'success') {
        showToast('Margin position opened successfully!', 'success');
        const newPos: Position = {
          collateral: col.toFixed(1),
          debt: marginDebt,
          ltv: `${((1 - 1 / marginLeverage) * 100).toFixed(0)}%`,
          healthFactor: 'Good (1.68)',
          action: 'Hold',
          type: marginSide,
          size: (col * marginLeverage).toFixed(marginPoolKey === 'XBTC_USDC' ? 6 : 1),
          entryPrice: marginBasePrice.toFixed(marginPoolKey === 'XBTC_USDC' ? 0 : 3),
          liqPrice: marginLiqPrice
        };
        setMarginPositions(prev => [newPos, ...prev]);
      } else {
        throw new Error(result.effects?.status?.error || 'Transaction failed');
      }
    } catch (e: any) {
      console.error(e);
      showToast(`Position open error: ${e.message || e}`, 'error');
    } finally {
      setIsExecuting(false);
    }
  };

  // ── PREDICT FORM STATES ──
  const [predictDir, setPredictDir] = useState<'UP' | 'DOWN'>('UP');
  const [predictAmount, setPredictAmount] = useState('50');
  // Real DeepBook Predict rounds (admin-scheduled, ~15-min cadence, BTC) from the
  // testnet predict-server. The user picks an ACTIVE round — there is no 5m/15m/1h.
  const [predictRounds, setPredictRounds] = useState<any[]>([]);
  const [selectedOracleId, setSelectedOracleId] = useState<string>('');
  const [predictStrike, setPredictStrike] = useState<string>('');
  const [btcPrice, setBtcPrice] = useState<number>(0);
  const [roundsLoading, setRoundsLoading] = useState(false);

  const selectedRound = useMemo(
    () => predictRounds.find(r => r.oracle_id === selectedOracleId) || null,
    [predictRounds, selectedOracleId],
  );

  const predictPayout = 1.92;
  const predictEstPayout = useMemo(() => {
    const amt = parseFloat(predictAmount) || 0;
    return (amt * predictPayout).toFixed(2);
  }, [predictAmount]);

  // Fetch the live list of active predict rounds (BTC) from the testnet server.
  const loadPredictRounds = useCallback(async () => {
    setRoundsLoading(true);
    try {
      const res = await fetch('https://predict-server.testnet.mystenlabs.com/oracles');
      const data = await res.json();
      const now = Date.now();
      const active = (Array.isArray(data) ? data : [])
        .filter((m: any) => m.status === 'active' && m.expiry > now + 60_000)
        .sort((a: any, b: any) => a.expiry - b.expiry);
      setPredictRounds(active);
      setSelectedOracleId(prev => (active.find((r: any) => r.oracle_id === prev) ? prev : (active[0]?.oracle_id || '')));
    } catch (e) {
      console.warn('predict rounds fetch failed', e);
    } finally {
      setRoundsLoading(false);
    }
  }, []);

  // Load rounds when the Predict tab opens; pull a BTC reference price for the
  // default strike (strikes are in USD, ≥ pool min, $1 tick).
  useEffect(() => {
    if (tab !== 'predict') return;
    loadPredictRounds();
    fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT')
      .then(r => r.json())
      .then(d => { const p = parseFloat(d.price); if (p > 0) { setBtcPrice(p); setPredictStrike(s => s || String(Math.round(p))); } })
      .catch(() => {});
  }, [tab, loadPredictRounds]);

  // ── PREDICT (DeepBook binary options) — TESTNET-ONLY sandbox ──
  // Fully isolated: stakes testnet DUSDC, signs + submits on a dedicated TESTNET
  // client, never touches the mainnet RPC, the agent, or the auto bots. Pure
  // manual feature for users to try the new DeepBook predict markets.
  const handlePlacePredict = async () => {
    const amt = parseFloat(predictAmount);
    if (!amt || amt <= 0) return showToast('Enter a valid amount!', 'error');
    if (!account) return showToast('Connect your wallet first!', 'error');
    if (amt > dusdcBalance) return showToast('Insufficient DUSDC (testnet). Get test DUSDC from the faucet first.', 'error');
    if (!selectedRound) return showToast('Select an active round first.', 'error');
    const strikeUsd = parseFloat(predictStrike);
    if (!strikeUsd || strikeUsd < (selectedRound.min_strike / 1e9)) {
      return showToast(`Strike must be ≥ $${(selectedRound.min_strike / 1e9).toLocaleString()}.`, 'error');
    }

    setIsExecuting(true);
    showToast(`Building ${selectedRound.underlying_asset} ${predictDir} predict order (testnet)…`, 'info');

    try {
      const PREDICT_PACKAGE = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
      const PREDICT_OBJ = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
      const SUI_CLOCK = '0x6';
      const DUSDC_TYPE = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
      const ORACLE_ID = selectedRound.oracle_id;
      const ROUND_EXPIRY = selectedRound.expiry;

      // Dedicated TESTNET client — Predict NEVER uses the mainnet suiClient.
      if (!testnetClientRef.current) testnetClientRef.current = new SuiClient({ url: TESTNET_RPC, network: 'testnet' as any });
      const tnet = testnetClientRef.current;

      showToast('Querying PredictManager (testnet)…', 'info');
      let predictManagerId = '';
      try {
        const res = await fetch('https://predict-server.testnet.mystenlabs.com/managers');
        const data = await res.json();
        const userManager = data.find((m: any) => m.owner === account.address);
        if (userManager) predictManagerId = userManager.manager_id;
      } catch (err) {
        console.warn('Failed to fetch predict manager', err);
      }

      // No manager yet → create it in its own tx, then ask the user to submit
      // again (the new manager id isn't known until after this tx is indexed).
      if (!predictManagerId) {
        showToast('No PredictManager — creating one. Sign on TESTNET…', 'info');
        const ctx = new Transaction();
        ctx.moveCall({ target: `${PREDICT_PACKAGE}::predict::create_manager`, arguments: [] });
        const signedC = await signTx({ transaction: ctx });
        const rc = await tnet.executeTransactionBlock({ transactionBlock: signedC.bytes, signature: signedC.signature, options: { showEffects: true } });
        if (rc.effects?.status?.status === 'success') showToast('PredictManager created — click Submit again to place your prediction.', 'success');
        else throw new Error(rc.effects?.status?.error || 'create_manager failed');
        return;
      }

      // Real round: oracle_id + expiry come from the chosen active market; strike
      // is the user's USD price (1e9-scaled, $1 tick-aligned).
      const strikePriceE9 = BigInt(Math.floor(strikeUsd)) * 1_000_000_000n;
      const quantityE6 = Math.floor(amt * 1e6); // DUSDC has 6 decimals

      const tx = new Transaction();
      const marketKey = tx.moveCall({
        target: `${PREDICT_PACKAGE}::market_key::${predictDir === 'UP' ? 'up' : 'down'}`,
        arguments: [tx.pure.id(ORACLE_ID), tx.pure.u64(ROUND_EXPIRY), tx.pure.u64(strikePriceE9)],
      });
      tx.moveCall({
        target: `${PREDICT_PACKAGE}::predict::mint`,
        typeArguments: [DUSDC_TYPE],
        arguments: [
          tx.object(PREDICT_OBJ),
          tx.object(predictManagerId),
          tx.object(ORACLE_ID),
          marketKey,
          tx.pure.u64(quantityE6),
          tx.object(SUI_CLOCK),
        ],
      });

      showToast('Sign on TESTNET in your wallet…', 'info');
      const signed = await signTx({ transaction: tx });
      showToast('Submitting to Sui Testnet…', 'info');
      const result = await tnet.executeTransactionBlock({
        transactionBlock: signed.bytes, signature: signed.signature, options: { showEffects: true },
      });

      if (result.effects?.status?.status === 'success') {
        showToast('Prediction placed (testnet)!', 'success');
        const newPredict: PredictPos = {
          asset: selectedRound.underlying_asset,
          direction: predictDir,
          positionId: result.digest || ('0x' + Math.random().toString(16).slice(2, 18)),
          capitalDUSDC: amt.toFixed(0),
          estimatedPnL: `+${(amt * (predictPayout - 1)).toFixed(2)} DUSDC if win`,
          strikePrice: `$${Math.floor(strikeUsd).toLocaleString()}`,
          currentPrice: btcPrice ? `$${btcPrice.toLocaleString()}` : '—',
          pnlStatus: 'PENDING',
          daysRemaining: 0,
          recommendation: `Settles ${new Date(ROUND_EXPIRY).toLocaleString()}`,
          oracleId: ORACLE_ID,
          expiry: ROUND_EXPIRY,
        };
        setPredictPositions(prev => [newPredict, ...prev]);
      } else {
        throw new Error(result.effects?.status?.error || 'Transaction failed');
      }
    } catch (e: any) {
      console.error(e);
      showToast(`Predict error (testnet): ${e.message || e}`, 'error');
    } finally {
      setIsExecuting(false);
    }
  };

  const handleCloseMarginPosition = async (pos: Position, idx: number) => {
    if (!account) return showToast('Connect your wallet first!', 'error');
    setIsExecuting(true);
    showToast(`Preparing to close margin position...`, 'info');

    try {
      // Discover the manager + its pool, then re-init the SDK client WITH the
      // marginManagers map populated. Required by the SDK so repayQuote/withdrawBase
      // don't throw MARGIN_MANAGER_NOT_FOUND (surfacing as on-chain TypeMismatch).
      const discover = new DeepBookClient({
        client: suiClient as any, network: 'mainnet', address: account.address,
      });

      showToast(`Looking up Margin Account...`, 'info');
      let managerIds = await discover.getMarginManagerIdsForOwner(account.address);
      if (managerIds.length === 0) {
        throw new Error('No Margin Account found');
      }
      const managerKey = await pickBestSuiUsdcManager(suiClient, managerIds);
      if (!managerKey) {
        throw new Error('No SUI/USDC margin account found in this wallet.');
      }
      const poolKey = 'SUI_USDC';
      const dbClient = new DeepBookClient({
        client: suiClient as any, network: 'mainnet', address: account.address,
        marginManagers: { [managerKey]: { marginManagerKey: managerKey, address: managerKey, poolKey } } as any,
      });
      const tx = new Transaction();

      // 0. Pyth price update FIRST — both repay-side health checks and
      //    withdraw_with_proof verify against fresh feeds (stale → abort code 3).
      showToast(`Refreshing Pyth oracle for SUI_USDC...`, 'info');
      await fetchAndInjectVAA(tx, 'SUI_USDC');

      // 1. Repay debt (USDC)
      const debtAmount = parseFloat(pos.debt);
      if (debtAmount > 0) {
        showToast(`Repaying ${debtAmount.toFixed(2)} USDC debt...`, 'info');
        dbClient.marginManager.repayQuote(managerKey, debtAmount)(tx);
      }

      // 2. Withdraw SUI collateral — capture returned Coin and transfer to user.
      const collateralAmount = parseFloat(pos.collateral);
      if (collateralAmount > 0) {
        showToast(`Withdrawing collateral ${collateralAmount.toFixed(2)} SUI...`, 'info');
        const coin = dbClient.marginManager.withdrawBase(managerKey, collateralAmount)(tx);
        tx.transferObjects([coin], tx.pure.address(account.address));
      }

      showToast(`Please sign the Margin close transaction in your wallet...`, 'info');
      const signed = await signTx({ transaction: tx });

      showToast(`Submitting transaction to Sui Mainnet...`, 'info');
      const result = await suiClient.executeTransactionBlock({
        transactionBlock: signed.bytes,
        signature: signed.signature,
        options: { showEffects: true }
      });

      if (result.effects?.status?.status === 'success') {
        showToast('Margin position closed and collateral recovered!', 'success');
        setMarginPositions(prev => prev.filter((_, i) => i !== idx));
      } else {
        throw new Error(result.effects?.status?.error || 'Transaction failed');
      }
    } catch (e: any) {
      console.error(e);
      showToast(`Margin close error: ${e.message || e}`, 'error');
    } finally {
      setIsExecuting(false);
    }
  };

  const handleRedeemPredict = async (pos: PredictPos, idx: number) => {
    if (!account) return showToast('Connect your wallet first!', 'error');
    setIsExecuting(true);
    showToast(`Preparing prediction redeem...`, 'info');

    if (!pos.oracleId || !pos.expiry) {
      setIsExecuting(false);
      return showToast('This position has no round info to redeem (created before the update).', 'error');
    }

    try {
      const PREDICT_PACKAGE = '0xf5ea2b3749c65d6e56507cc35388719aadb28f9cab873696a2f8687f5c785138';
      const PREDICT_OBJ = '0xc8736204d12f0a7277c86388a68bf8a194b0a14c5538ad13f22cbd8e2a38028a';
      const SUI_CLOCK = '0x6';
      const DUSDC_TYPE = '0xe95040085976bfd54a1a07225cd46c8a2b4e8e2b6732f140a0fc49850ba73e1a::dusdc::DUSDC';
      const ORACLE_ID = pos.oracleId;
      const ROUND_EXPIRY = pos.expiry;

      // Same dedicated TESTNET client — redeem never touches mainnet.
      if (!testnetClientRef.current) testnetClientRef.current = new SuiClient({ url: TESTNET_RPC, network: 'testnet' as any });
      const tnet = testnetClientRef.current;

      showToast(`Querying PredictManager (testnet)…`, 'info');
      let predictManagerId = '';
      try {
        const res = await fetch('https://predict-server.testnet.mystenlabs.com/managers');
        const data = await res.json();
        const userManager = data.find((m: any) => m.owner === account.address);
        if (userManager) predictManagerId = userManager.manager_id;
      } catch (err) {
        console.warn('Failed to fetch predict manager', err);
      }

      if (!predictManagerId) {
        throw new Error('PredictManager not found for this wallet');
      }

      const tx = new Transaction();
      // Rebuild the EXACT market_key the position was minted with (same oracle,
      // expiry, strike) — otherwise the redeem won't match the market.
      const strikePriceE9 = BigInt(Math.floor(parseFloat(pos.strikePrice.replace(/[$,]/g, '')))) * 1_000_000_000n;
      const quantityE6 = Math.floor(parseFloat(pos.capitalDUSDC) * 1e6);

      const marketKey = tx.moveCall({
        target: `${PREDICT_PACKAGE}::market_key::${pos.direction === 'UP' ? 'up' : 'down'}`,
        arguments: [
          tx.pure.id(ORACLE_ID),
          tx.pure.u64(ROUND_EXPIRY),
          tx.pure.u64(strikePriceE9)
        ]
      });

      tx.moveCall({
        target: `${PREDICT_PACKAGE}::predict::redeem`,
        typeArguments: [DUSDC_TYPE],
        arguments: [
          tx.object(PREDICT_OBJ),
          tx.object(predictManagerId),
          tx.object(ORACLE_ID),
          marketKey,
          tx.pure.u64(quantityE6),
          tx.object(SUI_CLOCK)
        ]
      });

      showToast(`Sign the Redeem on TESTNET…`, 'info');
      const signed = await signTx({ transaction: tx });

      showToast(`Submitting to Sui Testnet…`, 'info');
      const result = await tnet.executeTransactionBlock({
        transactionBlock: signed.bytes,
        signature: signed.signature,
        options: { showEffects: true }
      });

      if (result.effects?.status?.status === 'success') {
        showToast('Stake redeemed!', 'success');
        setPredictPositions(prev => prev.filter((_, i) => i !== idx));
      } else {
        throw new Error(result.effects?.status?.error || 'Transaction failed');
      }
    } catch (e: any) {
      console.error(e);
      showToast(`Error Redeem: ${e.message || e}`, 'error');
    } finally {
      setIsExecuting(false);
    }
  };

  // ── ASSET MANAGEMENT STATES ──
  const [assetAction, setAssetAction] = useState<'deposit' | 'withdraw'>('deposit');
  const [assetTarget, setAssetTarget] = useState<'balance_manager' | 'margin_pool'>('balance_manager');
  const [assetToken, setAssetToken] = useState<'SUI' | 'USDC' | 'DEEP'>('SUI');
  const [assetAmount, setAssetAmount] = useState('10');

  // ── MARGIN COLLATERAL MANAGEMENT STATES ──
  const [marginColAction, setMarginColAction] = useState<'deposit' | 'withdraw'>('deposit');
  const [marginColAmount, setMarginColAmount] = useState('10');
  const [marginColAsset, setMarginColAsset] = useState<'SUI' | 'USDC'>('USDC');

  // ── Live margin pool state (the SAME on-chain account used by Live Trade) ──
  // `marginPoolAssets` distinguishes:
  //   base/quote          → WITHDRAWABLE (liquid bag balance — what withdraw can actually pull)
  //   totalBase/totalQuote → total valuation incl. locked collateral (calculateAssets)
  //   hasDebt             → outstanding borrow shares exist
  // Displaying only calculateAssets (the old code) made users attempt withdrawals
  // that abort on-chain with EBalanceTooLow.
  const [suiUsdcManagerId, setSuiUsdcManagerId] = useState<string | null>(null);
  const [marginPoolAssets, setMarginPoolAssets] = useState<{
    base: number; quote: number; totalBase: number; totalQuote: number;
    hasDebt: boolean; debtBase: boolean; debtQuote: boolean;
  } | null>(null);
  const [marginPoolBusy,   setMarginPoolBusy]   = useState(false);

  const refreshMarginPool = React.useCallback(async () => {
    if (!account?.address) { setSuiUsdcManagerId(null); setMarginPoolAssets(null); return; }
    try {
      const discover = new DeepBookClient({ client: suiClient as any, network: 'mainnet', address: account.address });
      const ids = await discover.getMarginManagerIdsForOwner(account.address);
      const mgr = await pickBestSuiUsdcManager(suiClient, ids);
      if (!mgr) { setSuiUsdcManagerId(null); setMarginPoolAssets(null); return; }
      setSuiUsdcManagerId(mgr);
      const db = new DeepBookClient({
        client: suiClient as any, network: 'mainnet', address: account.address,
        marginManagers: { [mgr]: { marginManagerKey: mgr, address: mgr, poolKey: 'SUI_USDC' } } as any,
      });
      const d = await getMarginManagerDetail(suiClient, db, mgr);
      setMarginPoolAssets({
        base: d.withdrawableSui, quote: d.withdrawableUsdc,
        totalBase: d.totalSui, totalQuote: d.totalUsdc,
        hasDebt: d.debtBaseShares > 0n || d.debtQuoteShares > 0n,
        debtBase: d.debtBaseShares > 0n,
        debtQuote: d.debtQuoteShares > 0n,
      });
    } catch (e) {
      console.error('[ManualTrade·marginPool] refresh error:', e);
    }
  }, [account?.address, suiClient]);

  // Auto-refresh on wallet/component change
  useEffect(() => { refreshMarginPool(); }, [refreshMarginPool]);

  // ── HANDLER: Deposit/Withdraw to DeepBook BalanceManager ──
  const handleBalanceManagerAction = async () => {
    if (!account) return showToast('Connect your wallet first!', 'error');
    const amt = parseFloat(assetAmount);
    if (!amt || amt <= 0) return showToast('Enter a valid amount!', 'error');

    const tokenBalances: Record<string, number> = { SUI: suiBalance, USDC: usdcBalance, DEEP: deepBalance };
    if (assetAction === 'deposit' && amt > (tokenBalances[assetToken] ?? 0)) {
      return showToast(`Balance ${assetToken} is insufficient`, 'error');
    }

    setIsExecuting(true);
    const actionLabel = assetAction === 'deposit' ? 'Deposit' : 'Withdraw';
    showToast(`${actionLabel} ${amt} ${assetToken} to/from BalanceManager...`, 'info');

    try {
      const dbClient = new DeepBookClient({
        client: suiClient as any,
        network: 'mainnet',
        address: account.address
      });

      // Tìm BalanceManager IDs cho user
      showToast(`Looking up BalanceManager...`, 'info');
      let managerIds = await dbClient.getBalanceManagerIds(account.address);

      const tx = new Transaction();

      if (managerIds.length === 0 && assetAction === 'deposit') {
        // No BalanceManager → create one
        showToast(`Creating a new BalanceManager...`, 'info');
        dbClient.balanceManager.createAndShareBalanceManager()(tx);
        // After creation, run this TX before deposit
        const signed1 = await signTx({ transaction: tx });
        const result1 = await suiClient.executeTransactionBlock({
          transactionBlock: signed1.bytes,
          signature: signed1.signature,
          options: { showEffects: true }
        });
        if (result1.effects?.status?.status !== 'success') {
          throw new Error('Failed to create BalanceManager');
        }
        showToast(`BalanceManager created! Depositing...`, 'info');
        // Re-fetch manager IDs
        managerIds = await dbClient.getBalanceManagerIds(account.address);
      }

      if (managerIds.length === 0) {
        throw new Error('BalanceManager not found — deposit to create one');
      }

      // Re-init client with balanceManagers config
      const managerId = managerIds[0];
      const dbClient2 = new DeepBookClient({
        client: suiClient as any,
        network: 'mainnet',
        address: account.address,
        balanceManagers: {
          'MANAGER_1': {
            address: managerId,
          } as any
        }
      });

      const tx2 = new Transaction();
      if (assetAction === 'deposit') {
        (dbClient2.balanceManager as any).depositIntoManager('MANAGER_1', assetToken, amt)(tx2);
      } else {
        (dbClient2.balanceManager as any).withdrawFromManager('MANAGER_1', assetToken, amt, account.address)(tx2);
      }

      showToast(`Please sign the transaction in your wallet...`, 'info');
      const signed = await signTx({ transaction: tx2 });

      showToast(`Submitting transaction to Sui Mainnet...`, 'info');
      const result = await suiClient.executeTransactionBlock({
        transactionBlock: signed.bytes,
        signature: signed.signature,
        options: { showEffects: true }
      });

      if (result.effects?.status?.status === 'success') {
        showToast(`${actionLabel} ${amt} ${assetToken} succeeded! TX: ${result.digest?.slice(0, 16)}...`, 'success');
      } else {
        throw new Error(result.effects?.status?.error || 'Transaction failed');
      }
    } catch (e: any) {
      console.error(e);
      showToast(`Error ${actionLabel}: ${e.message || e}`, 'error');
    } finally {
      setIsExecuting(false);
    }
  };

  // ── HANDLER: Deposit/Withdraw Margin Collateral ──
  // Accept the action as a parameter so the button click doesn't race against
  // `setMarginColAction` (React state updates are async — reading state inside
  // the same tick still sees the OLD value, which made the Withdraw button
  // act like Deposit on the first click).
  const handleMarginCollateralAction = async (actionOverride?: 'deposit' | 'withdraw') => {
    if (!account) return showToast('Connect your wallet first!', 'error');
    const action = actionOverride ?? marginColAction;
    const amt = parseFloat(marginColAmount);
    if (!amt || amt <= 0) return showToast('Enter a valid amount!', 'error');

    if (action === 'deposit') {
      const bal = marginColAsset === 'SUI' ? suiBalance : usdcBalance;
      if (amt > bal) return showToast(`Balance ${marginColAsset} is insufficient`, 'error');
    } else {
      // Withdraw — cap at the LIQUID bag balance, not the total valuation.
      // Exceeding it aborts on-chain with EBalanceTooLow (code 3).
      const liquid = marginColAsset === 'SUI' ? (marginPoolAssets?.base ?? 0) : (marginPoolAssets?.quote ?? 0);
      if (amt > liquid) {
        return showToast(
          `Cannot withdraw ${amt} ${marginColAsset} — only ${liquid.toFixed(2)} is liquid. ` +
          (marginPoolAssets?.hasDebt ? 'The rest is locked as collateral for an open borrow.' : 'Click ↻ Refresh to update.'),
          'error'
        );
      }
    }

    setIsExecuting(true);
    const actionLabel = action === 'deposit' ? 'Add collateral' : 'Withdraw collateral';
    showToast(`${actionLabel} ${amt} ${marginColAsset}...`, 'info');

    try {
      // BUILD TAG — used to verify the latest bundle is loaded (not stale cache).
      console.log('[ManualTrade·deposit] build=2026-06-09e action=', action, 'asset=', marginColAsset, 'amt=', amt);

      // Discover the user's margin manager + its pool, then re-init the
      // DeepBookClient WITH the marginManagers map populated. The SDK's
      // depositBase/depositQuote/withdrawBase/withdrawQuote internally call
      // config.getMarginManager(managerKey) which THROWS if the map is empty,
      // surfacing as a CommandArgumentError TypeMismatch on chain.
      const discover = new DeepBookClient({
        client: suiClient as any, network: 'mainnet', address: account.address,
      });
      const managerIds = await discover.getMarginManagerIdsForOwner(account.address);
      console.log('[ManualTrade·deposit] managerIds=', managerIds);
      if (managerIds.length === 0) {
        throw new Error('No Margin Account yet — open a Margin position first');
      }
      // Pick the manager actually belonging to SUI_USDC pool — managerIds[0] may
      // be for a DIFFERENT pool (DEEP_USDC, etc.) and would trigger TypeMismatch.
      const managerKey = await pickBestSuiUsdcManager(suiClient, managerIds);
      if (!managerKey) {
        throw new Error(`Wallet has ${managerIds.length} margin accounts but none are for the SUI/USDC pool. Create one by opening a SUI/USDC margin position first.`);
      }
      const poolKey = 'SUI_USDC';
      console.log('[ManualTrade·deposit] managerKey=', managerKey, 'poolKey=', poolKey);

      const dbClient = new DeepBookClient({
        client: suiClient as any, network: 'mainnet', address: account.address,
        marginManagers: { [managerKey]: { marginManagerKey: managerKey, address: managerKey, poolKey } } as any,
      });
      const tx = new Transaction();

      if (action === 'deposit') {
        if (marginColAsset === 'SUI') {
          dbClient.marginManager.depositBase({ managerKey, amount: amt })(tx);
        } else {
          dbClient.marginManager.depositQuote({ managerKey, amount: amt })(tx);
        }
      } else {
        // Withdraw — must inject a fresh Pyth price update BEFORE the withdraw
        // moveCall. The margin manager calls `withdraw_with_proof` which checks
        // both coin price feeds against a max age; a stale feed aborts code 3
        // (`EInvalidProof`). Without this, a second withdraw in the same session
        // fails because the cached price object is too old.
        showToast(`Refreshing Pyth oracle for SUI_USDC...`, 'info');
        await fetchAndInjectVAA(tx, 'SUI_USDC');

        if (marginColAsset === 'SUI') {
          // withdrawBase/Quote returns the withdrawn Coin<T> — Move requires
          // it be consumed or transferred, else `UnusedValueWithoutDrop`.
          const coin = dbClient.marginManager.withdrawBase(managerKey, amt)(tx);
          tx.transferObjects([coin], tx.pure.address(account.address));
        } else {
          const coin = dbClient.marginManager.withdrawQuote(managerKey, amt)(tx);
          tx.transferObjects([coin], tx.pure.address(account.address));
        }
      }

      showToast(`Please sign the transaction in your wallet...`, 'info');
      const signed = await signTx({ transaction: tx });

      showToast(`Submitting transaction to Sui Mainnet...`, 'info');
      const result = await suiClient.executeTransactionBlock({
        transactionBlock: signed.bytes,
        signature: signed.signature,
        options: { showEffects: true }
      });

      if (result.effects?.status?.status === 'success') {
        showToast(`${actionLabel} ${amt} ${marginColAsset} succeeded!`, 'success');
        // Refresh on-chain margin pool balance so the UI updates immediately
        await refreshMarginPool();
      } else {
        throw new Error(result.effects?.status?.error || 'Transaction failed');
      }
    } catch (e: any) {
      console.error(e);
      showToast(`Error ${actionLabel}: ${e.message || e}`, 'error');
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', color: '#e2e8f0' }}>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* ── HEADER & WALLET STATS ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexWrap: 'wrap', gap: 16, marginBottom: 24, paddingBottom: 16,
        borderBottom: '1px solid #1e293b'
      }}>
        <div>
          <h2 style={{ color: '#fff', fontSize: '1.8rem', margin: '0 0 6px 0', fontWeight: 800 }}>MANUAL TRADING 📈</h2>
          <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: 0 }}>
            Decentralized trading platform with AI-powered risk management.
          </p>
        </div>

        {/* Real Wallet info indicator */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(77,162,255,0.05))',
          border: '1px solid rgba(77,162,255,0.3)', padding: '10px 16px', borderRadius: 12,
          display: 'flex', alignItems: 'center', gap: 14, fontSize: '0.8rem'
        }}>
          <div>
            <span style={{ color: '#00d4ff', fontWeight: 800 }}>⚡ ON-CHAIN MODE</span>
            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 2 }}>
              {account ? `Connected: ${account.address.slice(0, 6)}...${account.address.slice(-4)}` : 'Wallet not connected'}
            </div>
          </div>
          <div style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: 14, fontFamily: 'monospace' }}>
            <div>SUI: <strong style={{ color: '#00d4ff' }}>{suiBalance.toFixed(2)}</strong></div>
            <div>USDC: <strong style={{ color: '#22c55e' }}>{usdcBalance.toFixed(2)}</strong></div>
          </div>
          <div style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: 14, fontFamily: 'monospace' }}>
            <div>DEEP: <strong style={{ color: '#a78bfa' }}>{deepBalance.toFixed(2)}</strong></div>
            <div>DUSDC: <strong style={{ color: '#f59e0b' }}>{dusdcBalance.toFixed(2)}</strong></div>
          </div>
          <div style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: 14 }}>
            <div style={{ fontSize: '0.68rem', color: '#64748b' }}>TOTAL ASSETS</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#22c55e', fontFamily: 'monospace' }}>${portfolioUSD.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {/* ── TAB SELECTOR ── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, borderBottom: '1px solid #1e293b', paddingBottom: 12 }}>
        {[
          { id: 'v3', name: '📊 Spot (DeepBook V3)', color: '#00d4ff' },
          { id: 'margin', name: '⚡ Margin Trading', color: '#ef4444' },
          { id: 'predict', name: '🎯 Price Predict', color: '#a78bfa' },
          { id: 'assets', name: '💰 Asset Management', color: '#f59e0b' }
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as any)}
            style={{
              padding: '12px 24px', borderRadius: 10, border: 'none',
              background: tab === t.id ? 'rgba(30,41,59,0.6)' : 'transparent',
              color: tab === t.id ? t.color : '#64748b',
              borderBottom: tab === t.id ? `3px solid ${t.color}` : '3px solid transparent',
              fontWeight: 800, cursor: 'pointer', transition: 'all 0.2s', fontSize: '0.85rem'
            }}
          >
            {t.name}
          </button>
        ))}
      </div>

      {/* ── MAIN WORKSPACE (GRID 2 COLUMNS) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 24, alignItems: 'start' }}>
        
        {/* LEFT COLUMN: CHARTS, STATS */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {tab === 'v3' && (
            <>
              <PriceChart symbol="SUI" color="#00d4ff" livePrice={suiPrice} onPriceTick={setSuiPrice} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <StatCard label="SUI/USDC Last" value={`$${suiPrice.toFixed(3)}`} sub="Live Feed" color="#00d4ff" />
                <StatCard label="DeepBook Vol 24h"
                  value={poolStats.quoteVolume24h != null ? `$${formatCompact(poolStats.quoteVolume24h)}` : '…'}
                  sub={poolStats.change24hPct != null ? `${poolStats.change24hPct >= 0 ? '+' : ''}${poolStats.change24hPct.toFixed(2)}%` : ''}
                  color="#a78bfa" />
                <StatCard label="DeepBook Liquidity"
                  value={poolStats.bookDepthUsd != null ? `$${formatCompact(poolStats.bookDepthUsd)}` : '…'}
                  sub="Live book"
                  color="#22c55e" />
              </div>
              <OrderBook symbol="SUI" currentPrice={suiPrice} />

              {/* ── SPOT: QUẢN LÝ TÀI SẢN DEEPBOOK ── */}
              <div style={{
                background: 'linear-gradient(135deg, #0a0f1d, #0d1525)', borderRadius: 14,
                border: '1px solid rgba(77,162,255,0.15)', padding: '18px',
                boxShadow: '0 4px 16px rgba(0,0,0,0.2)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div style={{ fontWeight: 800, color: '#00d4ff', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {vaultManagerId ? '🏦 BalanceManager (Vault)' : '💰 Deposit funds into the DeepBook Vault'}
                  </div>
                  <span style={{ fontSize: '0.65rem', background: 'rgba(77,162,255,0.1)', color: '#00d4ff', padding: '3px 8px', borderRadius: 6, fontWeight: 700 }}>MAINNET</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 14 }}>
                  {[
                    { t: 'SUI', b: vaultManagerId ? vaultBalances.sui : 0, c: '#00d4ff' },
                    { t: 'USDC', b: vaultManagerId ? vaultBalances.usdc : 0, c: '#22c55e' },
                  ].map(tk => (
                    <div key={tk.t} style={{ background: '#090d16', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                      <div style={{ fontSize: '0.65rem', color: '#64748b' }}>{TOKEN_ICONS[tk.t as any] || ''} Vault {tk.t}</div>
                      <div style={{ fontWeight: 700, color: tk.c, fontFamily: 'monospace', fontSize: '1rem' }}>{tk.b.toFixed(2)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: '0.65rem', color: '#475569' }}>
                  {vaultManagerId ? (
                    <div style={{ marginTop: 4, color: '#00d4ff', fontWeight: 'bold' }}>
                      🔗 Vault ID: {vaultManagerId.slice(0, 8)}...{vaultManagerId.slice(-6)}
                    </div>
                  ) : (
                    "💡 The Vault holds and manages balances for your Limit orders automatically."
                  )}
                </div>
              </div>
            </>
          )}

          {tab === 'margin' && (
            <>
              {/* Pool Pair Selector */}
              <div style={{
                display: 'flex', gap: 8, padding: '12px 16px',
                background: 'linear-gradient(135deg, rgba(239,68,68,0.06), rgba(245,158,11,0.04))',
                borderRadius: 12, border: '1px solid rgba(239,68,68,0.15)'
              }}>
                {MARGIN_POOLS.map(pool => {
                  const isBlocked = pool.poolKey === 'XBTC_USDC';
                  return (
                    <button
                      key={pool.poolKey}
                      disabled={isBlocked}
                      onClick={() => setMarginPoolKey(pool.poolKey)}
                      style={{
                        flex: 1, padding: '10px 16px', borderRadius: 8,
                        border: marginPoolKey === pool.poolKey ? '1px solid #ef4444' : '1px solid #1e293b',
                        background: marginPoolKey === pool.poolKey ? 'rgba(239,68,68,0.15)' : 'transparent',
                        color: marginPoolKey === pool.poolKey ? '#ef4444' : '#64748b',
                        opacity: isBlocked ? 0.4 : 1,
                        fontWeight: 800, fontSize: '0.85rem', cursor: isBlocked ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                        transition: 'all 0.2s'
                      }}
                    >
                      <span style={{ fontSize: '1.2rem' }}>{pool.icon}</span>
                      {pool.label} {isBlocked && <span style={{ fontSize: '0.6rem', background: '#ef4444', color: '#fff', padding: '2px 4px', borderRadius: 4 }}>MAINTENANCE</span>}
                    </button>
                  );
                })}
              </div>

              <PriceChart symbol={currentMarginPool.base} color="#ef4444" livePrice={marginBasePrice} onPriceTick={marginPoolKey === 'SUI_USDC' ? setSuiPrice : undefined} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <StatCard label={`${currentMarginPool.label} Price`} value={`$${marginBasePrice.toFixed(marginPoolKey === 'XBTC_USDC' ? 0 : 3)}`} sub="Pyth Network" color="#ef4444" />
                <StatCard label="Base Utilization" value="84.2%" sub={`${currentMarginPool.base} Margin Pool`} color="#f59e0b" />
                <StatCard label="Health Factor" value="1.68" sub="Safe" color="#22c55e" />
              </div>

              {/* ── MARGIN: QUẢN LÝ THẾ CHẤP ── */}
              <div style={{
                background: 'linear-gradient(135deg, #0a0f1d, #0d1525)', borderRadius: 14,
                border: '1px solid rgba(239,68,68,0.15)', padding: '18px',
                boxShadow: '0 4px 16px rgba(0,0,0,0.2)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div style={{ fontWeight: 800, color: '#ef4444', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                    ⚡ Collateral Management — {currentMarginPool.label}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button onClick={refreshMarginPool} disabled={!account || marginPoolBusy}
                      style={{ padding: '3px 8px', borderRadius: 5, border: '1px solid #1e293b', background: 'transparent', color: '#64748b', fontSize: '0.62rem', cursor: 'pointer' }}>
                      ↻ Refresh
                    </button>
                    <span style={{ fontSize: '0.65rem', background: 'rgba(239,68,68,0.1)', color: '#ef4444', padding: '3px 8px', borderRadius: 6, fontWeight: 700 }}>MAINNET</span>
                  </div>
                </div>

                {/* Manager status — same shared account as Live Trade */}
                <div style={{ fontSize: '0.6rem', color: suiUsdcManagerId ? '#22c55e' : '#f59e0b', marginBottom: 8 }}>
                  {suiUsdcManagerId
                    ? <>✓ SUI/USDC Margin Account: <code style={{ color: '#94a3b8', fontFamily: 'monospace' }}>{suiUsdcManagerId.slice(0,8)}…{suiUsdcManagerId.slice(-6)}</code> (shared with Live Trade)</>
                    : '⚠️ No SUI/USDC margin account on this wallet yet.'}
                </div>

                {/* Pool balance — withdrawable (liquid) is the primary number; total
                    valuation incl. locked collateral shown as secondary. */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  {[
                    { t: 'SUI',  b: marginPoolAssets?.base  ?? 0, total: marginPoolAssets?.totalBase  ?? 0, c: '#ef4444', label: 'SUI — withdrawable' },
                    { t: 'USDC', b: marginPoolAssets?.quote ?? 0, total: marginPoolAssets?.totalQuote ?? 0, c: '#22c55e', label: 'USDC — withdrawable' },
                  ].map(tk => (
                    <div key={tk.t} style={{ background: '#090d16', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: '0.65rem', color: '#64748b', marginBottom: 2 }}>{tk.label}</div>
                      <div style={{ fontWeight: 700, color: marginPoolAssets ? tk.c : '#475569', fontFamily: 'monospace', fontSize: '0.95rem' }}>
                        {marginPoolAssets ? `${tk.b.toFixed(2)} ${tk.t}` : '—'}
                      </div>
                      {marginPoolAssets && tk.total > tk.b && (
                        <div style={{ fontSize: '0.58rem', color: '#475569', marginTop: 2 }}>
                          total incl. locked: {tk.total.toFixed(2)} {tk.t}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Debt warning + one-click full repayment */}
                {marginPoolAssets?.hasDebt && (
                  <div style={{
                    background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.3)',
                    borderRadius: 6, padding: '8px 10px', marginBottom: 12,
                    fontSize: '0.64rem', color: '#fbbf24', lineHeight: 1.5,
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
                  }}>
                    <span>
                      ⚠️ Outstanding borrow ({marginPoolAssets.debtBase ? 'SUI' : ''}{marginPoolAssets.debtBase && marginPoolAssets.debtQuote ? ' + ' : ''}{marginPoolAssets.debtQuote ? 'USDC' : ''}) —
                      part of the assets is locked as collateral until the debt is repaid.
                    </span>
                    <button onClick={async () => {
                      if (!account || !suiUsdcManagerId) return;
                      setMarginPoolBusy(true);
                      showToast('Repaying all outstanding debt...', 'info');
                      try {
                        const db = new DeepBookClient({
                          client: suiClient as any, network: 'mainnet', address: account.address,
                          marginManagers: { [suiUsdcManagerId]: { marginManagerKey: suiUsdcManagerId, address: suiUsdcManagerId, poolKey: 'SUI_USDC' } } as any,
                        });
                        const tx = new Transaction();
                        await fetchAndInjectVAA(tx, 'SUI_USDC');
                        // amount=undefined → SDK passes Option::none → contract repays FULL debt.
                        // Repay coins are pulled from the wallet automatically (coinWithBalance).
                        if (marginPoolAssets.debtBase)  db.marginManager.repayBase(suiUsdcManagerId, undefined as any)(tx);
                        if (marginPoolAssets.debtQuote) db.marginManager.repayQuote(suiUsdcManagerId, undefined as any)(tx);
                        const signed = await signTx({ transaction: tx });
                        const res = await suiClient.executeTransactionBlock({
                          transactionBlock: signed.bytes, signature: signed.signature, options: { showEffects: true },
                        });
                        if (res.effects?.status?.status === 'success') {
                          showToast('All debt repaid — collateral unlocked.', 'success');
                          await refreshMarginPool();
                        } else {
                          throw new Error(res.effects?.status?.error || 'tx failed');
                        }
                      } catch (e: any) {
                        showToast(`Repay failed: ${(e.message || e).toString().slice(0, 120)}`, 'error');
                      } finally { setMarginPoolBusy(false); }
                    }} disabled={marginPoolBusy}
                      style={{
                        flexShrink: 0, padding: '5px 10px', borderRadius: 6, border: '1px solid rgba(245,158,11,0.5)',
                        background: 'rgba(245,158,11,0.15)', color: '#fbbf24', fontWeight: 700,
                        fontSize: '0.64rem', cursor: marginPoolBusy ? 'not-allowed' : 'pointer',
                      }}>
                      {marginPoolBusy ? '…' : '💳 Repay all'}
                    </button>
                  </div>
                )}

                {/* Create SUI/USDC margin account button — shown when missing */}
                {account && !suiUsdcManagerId && (
                  <div style={{
                    background: 'rgba(77,162,255,0.06)', border: '1px solid rgba(77,162,255,0.3)',
                    borderRadius: 8, padding: '12px 14px', marginBottom: 12,
                  }}>
                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginBottom: 8, lineHeight: 1.5 }}>
                      You don't have a SUI/USDC margin account yet. Manual Trade and Live Trade share the SAME on-chain margin account — create one once here or in Live Trade.
                    </div>
                    <button onClick={async () => {
                      if (!account) return;
                      const amtStr = window.prompt('Deposit how many USDC into the new margin account?', '10');
                      const amt = parseFloat(amtStr || '0');
                      if (!amt || amt <= 0) return;
                      setMarginPoolBusy(true);
                      try {
                        const db = new DeepBookClient({ client: suiClient as any, network: 'mainnet', address: account.address });
                        const tx = new Transaction();
                        const { manager, initializer } = db.marginManager.newMarginManagerWithInitializer('SUI_USDC')(tx);
                        db.marginManager.depositDuringInitialization({ manager, poolKey: 'SUI_USDC', coinType: 'USDC', amount: amt })(tx);
                        db.marginManager.shareMarginManager('SUI_USDC', manager, initializer)(tx);
                        const signed = await signTx({ transaction: tx });
                        const res = await suiClient.executeTransactionBlock({ transactionBlock: signed.bytes, signature: signed.signature, options: { showEffects: true } });
                        if (res.effects?.status?.status === 'success') {
                          showToast(`Margin account created with ${amt} USDC.`, 'success');
                          await refreshMarginPool();
                        } else {
                          throw new Error(res.effects?.status?.error || 'tx failed');
                        }
                      } catch (e: any) {
                        showToast(`Create failed: ${e.message || e}`, 'error');
                      } finally { setMarginPoolBusy(false); }
                    }} disabled={marginPoolBusy}
                      style={{
                        padding: '8px 14px', borderRadius: 7, border: 'none', cursor: marginPoolBusy ? 'not-allowed' : 'pointer',
                        background: 'linear-gradient(135deg,#00d4ff,#0891b2)', color: '#fff', fontWeight: 700, fontSize: '0.74rem',
                      }}>
                      {marginPoolBusy ? 'Creating…' : '＋ Create SUI/USDC Margin Account + Deposit USDC'}
                    </button>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                  {(['SUI', 'USDC'] as const).map(t => (
                    <button key={t} onClick={() => setMarginColAsset(t)} style={{
                      flex: 1, padding: '5px', borderRadius: 6,
                      border: marginColAsset === t ? '1px solid #ef4444' : '1px solid #1e293b',
                      background: marginColAsset === t ? 'rgba(239,68,68,0.08)' : 'transparent',
                      color: marginColAsset === t ? '#ef4444' : '#475569', fontWeight: 700, fontSize: '0.68rem', cursor: 'pointer'
                    }}>{TOKEN_ICONS[t]} {t}</button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="number" value={marginColAmount} onChange={e => setMarginColAmount(e.target.value)}
                    placeholder="Amount" style={{
                      flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid #1e293b',
                      background: '#1e293b', color: '#fff', outline: 'none', fontFamily: 'monospace', fontSize: '0.8rem'
                    }}
                  />
                  <button onClick={() => { setMarginColAction('deposit'); handleMarginCollateralAction('deposit'); }} style={{
                    padding: '8px 14px', borderRadius: 8, border: 'none', background: '#22c55e',
                    color: '#000', fontWeight: 800, fontSize: '0.72rem', cursor: 'pointer'
                  }}>⬆️ Deposit</button>
                  <button onClick={() => { setMarginColAction('withdraw'); handleMarginCollateralAction('withdraw'); }} style={{
                    padding: '8px 14px', borderRadius: 8, border: 'none', background: '#ef4444',
                    color: '#fff', fontWeight: 800, fontSize: '0.72rem', cursor: 'pointer'
                  }}>⬇️ Withdraw</button>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  {[25, 50, 75, 100].map(pct => (
                    <button key={pct} onClick={() => {
                      // Deposit sizes against the WALLET balance; withdraw against
                      // the liquid pool balance (the bag) — using wallet balance for
                      // withdraw produced amounts that abort EBalanceTooLow.
                      const bal = marginColAction === 'withdraw'
                        ? (marginColAsset === 'SUI' ? (marginPoolAssets?.base ?? 0) : (marginPoolAssets?.quote ?? 0))
                        : (marginColAsset === 'SUI' ? suiBalance : usdcBalance);
                      setMarginColAmount((bal * pct / 100).toFixed(4));
                    }} style={{
                      flex: 1, padding: '4px', borderRadius: 4, border: '1px solid #1e293b',
                      background: 'transparent', color: '#475569', fontSize: '0.62rem', fontWeight: 700, cursor: 'pointer'
                    }}>{pct}%</button>
                  ))}
                </div>
                <div style={{ marginTop: 8, fontSize: '0.65rem', color: '#475569' }}>
                  💡 Add collateral to improve the Health Factor. Withdraw any excess.
                </div>
              </div>
            </>
          )}

          {tab === 'predict' && (
            <>
              <PriceChart symbol="SUI" color="#a78bfa" livePrice={suiPrice} onPriceTick={setSuiPrice} />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                <StatCard label="SUI Strike Price" value={`$${suiPrice.toFixed(3)}`} sub="Current epoch" color="#a78bfa" />
                <StatCard label="DUSDC Balance" value={`${dusdcBalance.toFixed(2)}`} sub="Testnet Predict" color="#00d4ff" />
              </div>

              {/* ── PREDICT: QUẢN LÝ DUSDC ── */}
              <div style={{
                background: 'linear-gradient(135deg, #0a0f1d, #0d1525)', borderRadius: 14,
                border: '1px solid rgba(167,139,250,0.15)', padding: '18px',
                boxShadow: '0 4px 16px rgba(0,0,0,0.2)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div style={{ fontWeight: 800, color: '#a78bfa', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                    🏦 Asset Management Predict
                  </div>
                  <span style={{ background: '#a78bfa', color: '#000', padding: '3px 8px', borderRadius: 6, fontWeight: 800, fontSize: '0.65rem' }}>TESTNET</span>
                </div>
                <div style={{
                  background: '#090d16', borderRadius: 10, padding: '16px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12
                }}>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: 4 }}>DUSDC balance (Testnet)</div>
                    <div style={{ fontWeight: 800, color: '#f59e0b', fontFamily: 'monospace', fontSize: '1.4rem' }}>
                      {dusdcBalance.toFixed(2)} <span style={{ fontSize: '0.8rem', color: '#64748b' }}>DUSDC</span>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: 4 }}>Estimated value</div>
                    <div style={{ fontWeight: 700, color: '#22c55e', fontFamily: 'monospace', fontSize: '1.1rem' }}>
                      ≈ ${dusdcBalance.toFixed(2)}
                    </div>
                  </div>
                </div>
                <div style={{
                  background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.12)',
                  borderRadius: 8, padding: '10px 12px', fontSize: '0.68rem', color: '#94a3b8', lineHeight: 1.5
                }}>
                  💡 DUSDC is a testnet token used for Predict. Get DUSDC from the faucet at <strong style={{ color: '#a78bfa' }}>deeptrade.io/predict</strong>.
                  Spot & Margin trade on <strong>Mainnet</strong>.
                </div>
              </div>
            </>
          )}

          {tab === 'assets' && (
            <>
              {/* Portfolio Overview Cards */}
              <div style={{
                background: 'linear-gradient(135deg, #0a0f1d, #1e293b)', borderRadius: 16,
                border: '1px solid rgba(245,158,11,0.2)', padding: '24px',
                boxShadow: '0 8px 32px rgba(0,0,0,0.3)'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <div>
                    <h3 style={{ margin: 0, color: '#f59e0b', fontWeight: 800, fontSize: '1.1rem' }}>💼 WALLET PORTFOLIO OVERVIEW</h3>
                    <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.75rem' }}>
                      {account ? `Wallet: ${account.address.slice(0, 8)}...${account.address.slice(-6)}` : 'Wallet not connected'}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '0.7rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>Total Value (USD)</div>
                    <div style={{ fontSize: '2rem', fontWeight: 800, color: '#22c55e', fontFamily: 'monospace' }}>${portfolioUSD.toFixed(2)}</div>
                  </div>
                </div>

                {/* Token Balances Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  {[
                    { token: 'SUI', bal: suiBalance, price: suiPrice, color: '#00d4ff', net: 'mainnet' },
                    { token: 'USDC', bal: usdcBalance, price: 1, color: '#22c55e', net: 'mainnet' },
                    { token: 'DEEP', bal: deepBalance, price: 0.02, color: '#a78bfa', net: 'mainnet' },
                    { token: 'xBTC', bal: xbtcBalance, price: 109000, color: '#f97316', net: 'mainnet' },
                    { token: 'WAL', bal: walBalance, price: 0.5, color: '#60a5fa', net: 'mainnet' },
                    { token: 'DUSDC', bal: dusdcBalance, price: 1, color: '#f59e0b', net: 'testnet' },
                  ].map(t => (
                    <div key={t.token} style={{
                      background: '#090d16', borderRadius: 12, padding: '14px 16px',
                      border: `1px solid ${t.color}15`, display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: '1.3rem' }}>{TOKEN_ICONS[t.token] || '🪙'}</span>
                        <div>
                          <div style={{ fontWeight: 800, color: '#fff', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                            {t.token}
                            {t.net === 'testnet' && (
                              <span style={{ background: '#a78bfa', color: '#000', padding: '1px 5px', borderRadius: 4, fontSize: '0.55rem', fontWeight: 800 }}>TESTNET</span>
                            )}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: '#64748b' }}>${t.price.toFixed(t.price < 1 ? 4 : t.price > 1000 ? 0 : 2)}</div>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: 700, color: t.color, fontFamily: 'monospace', fontSize: '0.95rem' }}>
                          {t.bal.toFixed(t.token === 'xBTC' ? 6 : t.token === 'WAL' || t.token === 'DEEP' ? 2 : t.token === 'USDC' || t.token === 'DUSDC' ? 2 : 4)}
                        </div>
                        <div style={{ fontSize: '0.7rem', color: '#475569', fontFamily: 'monospace' }}>
                          ≈ ${(t.bal * t.price).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Network Info */}
              <div style={{ display: 'flex', gap: 8 }}>
                <div style={{
                  flex: 1, background: 'rgba(77,162,255,0.04)', border: '1px solid rgba(77,162,255,0.15)',
                  borderRadius: 10, padding: '12px 14px', fontSize: '0.72rem'
                }}>
                  <div style={{ fontWeight: 800, color: '#00d4ff', marginBottom: 4 }}>MAINNET</div>
                  <div style={{ color: '#64748b' }}>Spot & Margin trade for real with real tokens.</div>
                </div>
                <div style={{
                  flex: 1, background: 'rgba(167,139,250,0.04)', border: '1px solid rgba(167,139,250,0.15)',
                  borderRadius: 10, padding: '12px 14px', fontSize: '0.72rem'
                }}>
                  <div style={{ fontWeight: 800, color: '#a78bfa', marginBottom: 4 }}>TESTNET</div>
                  <div style={{ color: '#64748b' }}>Predict uses testnet DUSDC. No real money at risk.</div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* RIGHT COLUMN: ORDER FORMS */}
        <div style={{
          background: 'linear-gradient(135deg, #0a0f1d, #0f172a)',
          borderRadius: 16, border: '1px solid #1e293b', padding: '24px',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)', position: 'relative'
        }}>
          {isExecuting && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(6,14,30,0.85)', borderRadius: 16, zIndex: 10,
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16
            }}>
              <div className="spinner" style={{
                width: 40, height: 40, border: '4px solid rgba(77,162,255,0.1)',
                borderTop: '4px solid #00d4ff', borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
              <style>{`
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
                @keyframes slideIn { 0% { transform: translateY(-20px); opacity: 0; } 100% { transform: translateY(0); opacity: 1; } }
              `}</style>
              <div style={{ fontSize: '0.9rem', color: '#00d4ff', fontWeight: 700 }}>SENDING TRANSACTION TO SUI...</div>
            </div>
          )}

          {/* SPOT ORDER FORM */}
          {tab === 'v3' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => setSpotSide('BUY')}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 10, border: 'none',
                    background: spotSide === 'BUY' ? '#22c55e' : '#1e293b',
                    color: spotSide === 'BUY' ? '#000' : '#94a3b8',
                    fontWeight: 800, cursor: 'pointer', transition: 'all 0.2s'
                  }}
                >
                  🟢 BUY
                </button>
                <button
                  onClick={() => setSpotSide('SELL')}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 10, border: 'none',
                    background: spotSide === 'SELL' ? '#ef4444' : '#1e293b',
                    color: spotSide === 'SELL' ? '#fff' : '#94a3b8',
                    fontWeight: 800, cursor: 'pointer', transition: 'all 0.2s'
                  }}
                >
                  🔴 SELL
                </button>
              </div>

              {/* Order Type Selector */}
              <div style={{ display: 'flex', background: '#090d16', padding: 4, borderRadius: 8 }}>
                {['LIMIT', 'MARKET'].map(t => (
                  <button
                    key={t}
                    onClick={() => setSpotOrderType(t as any)}
                    style={{
                      flex: 1, padding: '8px', border: 'none', borderRadius: 6,
                      background: spotOrderType === t ? '#1e293b' : 'transparent',
                      color: spotOrderType === t ? '#fff' : '#64748b',
                      fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer'
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Price Input (Only for limit) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>BUY PRICE (USDC)</label>
                <input
                  type="number"
                  disabled={spotOrderType === 'MARKET'}
                  value={spotPrice}
                  onChange={e => setSpotPrice(e.target.value)}
                  style={{
                    padding: '12px', borderRadius: 10, border: '1px solid #1e293b',
                    background: spotOrderType === 'MARKET' ? '#090d16' : '#1e293b',
                    color: spotOrderType === 'MARKET' ? '#475569' : '#fff',
                    outline: 'none', fontWeight: 'bold', fontFamily: 'monospace'
                  }}
                />
              </div>

              {/* Amount Input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                  <label style={{ color: '#64748b', fontWeight: 600 }}>QUANTITY (SUI)</label>
                  <span style={{ color: '#94a3b8' }}>
                    Balance: {spotSide === 'BUY' ? `${usdcBalance.toFixed(2)} USDC` : `${suiBalance.toFixed(2)} SUI`}
                  </span>
                </div>
                <input
                  type="number"
                  value={spotAmount}
                  onChange={e => setSpotAmount(e.target.value)}
                  style={{
                    padding: '12px', borderRadius: 10, border: '1px solid #1e293b',
                    background: '#1e293b', color: '#fff', outline: 'none',
                    fontWeight: 'bold', fontFamily: 'monospace'
                  }}
                />
              </div>

              {/* Percentages buttons */}
              <div style={{ display: 'flex', gap: 6 }}>
                {[25, 50, 75, 100].map(pct => (
                  <button
                    key={pct}
                    onClick={() => {
                      const maxAmt = spotSide === 'BUY'
                        ? usdcBalance / parseFloat(spotPrice)
                        : suiBalance;
                      if (maxAmt > 0) setSpotAmount((maxAmt * pct / 100).toFixed(2));
                    }}
                    style={{
                      flex: 1, padding: '6px', borderRadius: 6, border: '1px solid #1e293b',
                      background: 'transparent', color: '#64748b', fontSize: '0.72rem',
                      fontWeight: 700, cursor: 'pointer'
                    }}
                  >
                    {pct}%
                  </button>
                ))}
              </div>

              {/* Summary info */}
              <div style={{ background: '#090d16', borderRadius: 10, padding: 14, fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Trading fee (0.1%)</span>
                  <span>{(parseFloat(spotTotal) * 0.001).toFixed(3)} USDC</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                  <span style={{ color: '#64748b' }}>Total</span>
                  <span style={{ color: '#00d4ff' }}>{spotTotal} USDC</span>
                </div>
              </div>

              {/* AI Coprocessor Insight */}
              <div style={{
                background: 'rgba(77,162,255,0.05)', border: '1px solid rgba(77,162,255,0.2)',
                borderRadius: 10, padding: 12, fontSize: '0.75rem', display: 'flex', gap: 8, alignItems: 'center'
              }}>
                <span style={{ fontSize: '1rem' }}>🤖</span>
                <span style={{ color: '#94a3b8' }}>
                  <strong>AI co-pilot:</strong> DeepBook V3 has the deepest SUI/USDC liquidity. Your price is near mid.
                </span>
              </div>

              <button
                onClick={handlePlaceSpotOrder}
                style={{
                  padding: '14px', borderRadius: 10, border: 'none',
                  background: spotSide === 'BUY'
                    ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                    : 'linear-gradient(135deg, #ef4444, #dc2626)',
                  color: '#fff', fontWeight: 800, fontSize: '0.9rem', cursor: 'pointer'
                }}
              >
                Place {spotSide === 'BUY' ? 'BUY' : 'SELL'} SUI
              </button>
            </div>
          )}

          {/* MARGIN ORDER FORM */}
          {tab === 'margin' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Pool Pair Selector (compact in form) */}
              <div style={{ display: 'flex', gap: 6 }}>
                {MARGIN_POOLS.map(pool => {
                  const isBlocked = pool.poolKey === 'XBTC_USDC';
                  return (
                    <button
                      key={pool.poolKey}
                      disabled={isBlocked}
                      onClick={() => setMarginPoolKey(pool.poolKey)}
                      style={{
                        flex: 1, padding: '8px', borderRadius: 8,
                        border: marginPoolKey === pool.poolKey ? '1px solid #ef4444' : '1px solid #1e293b',
                        background: marginPoolKey === pool.poolKey ? 'rgba(239,68,68,0.1)' : 'transparent',
                        color: marginPoolKey === pool.poolKey ? '#ef4444' : '#475569',
                        opacity: isBlocked ? 0.4 : 1,
                        fontWeight: 700, fontSize: '0.72rem', cursor: isBlocked ? 'not-allowed' : 'pointer'
                      }}
                    >
                      {pool.icon} {pool.label}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => setMarginSide('LONG')}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 10,
                    background: marginSide === 'LONG' ? 'rgba(34,197,94,0.15)' : '#1e293b',
                    color: marginSide === 'LONG' ? '#22c55e' : '#94a3b8',
                    border: marginSide === 'LONG' ? '1px solid #22c55e' : '1px solid transparent',
                    fontWeight: 800, cursor: 'pointer'
                  }}
                >
                  🟢 OPEN LONG
                </button>
                <button
                  onClick={() => setMarginSide('SHORT')}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 10,
                    background: marginSide === 'SHORT' ? 'rgba(239,68,68,0.15)' : '#1e293b',
                    color: marginSide === 'SHORT' ? '#ef4444' : '#94a3b8',
                    border: marginSide === 'SHORT' ? '1px solid #ef4444' : '1px solid transparent',
                    fontWeight: 800, cursor: 'pointer'
                  }}
                >
                  🔴 OPEN SHORT
                </button>
              </div>

              {/* Order Type Selector */}
              <div style={{ display: 'flex', background: '#090d16', padding: 4, borderRadius: 8 }}>
                {['LIMIT', 'MARKET'].map(t => (
                  <button
                    key={t}
                    onClick={() => setMarginOrderType(t as any)}
                    style={{
                      flex: 1, padding: '8px', border: 'none', borderRadius: 6,
                      background: marginOrderType === t ? '#1e293b' : 'transparent',
                      color: marginOrderType === t ? '#fff' : '#64748b',
                      fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer'
                    }}
                  >
                    {t}
                  </button>
                ))}
              </div>

              {/* Limit Price Input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>PRICE (USDC)</label>
                <input
                  type="number"
                  disabled={marginOrderType === 'MARKET'}
                  value={marginOrderType === 'MARKET' ? marginBasePrice : marginLimitPrice}
                  onChange={e => setMarginLimitPrice(e.target.value)}
                  style={{
                    padding: '12px', borderRadius: 10, border: '1px solid #1e293b',
                    background: marginOrderType === 'MARKET' ? '#090d16' : '#1e293b',
                    color: marginOrderType === 'MARKET' ? '#475569' : '#fff',
                    outline: 'none', fontWeight: 'bold', fontFamily: 'monospace'
                  }}
                />
              </div>

              {/* Collateral Input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                  <label style={{ color: '#64748b', fontWeight: 600 }}>COLLATERAL ({currentMarginPool.base})</label>
                  <span style={{ color: '#94a3b8' }}>Bal: {marginBaseBalance.toFixed(marginPoolKey === 'XBTC_USDC' ? 6 : 2)} {currentMarginPool.base}</span>
                </div>
                <input
                  type="number"
                  value={marginCollateral}
                  onChange={e => setMarginCollateral(e.target.value)}
                  style={{
                    padding: '12px', borderRadius: 10, border: '1px solid #1e293b',
                    background: '#1e293b', color: '#fff', outline: 'none',
                    fontWeight: 'bold', fontFamily: 'monospace'
                  }}
                />
              </div>

              {/* Leverage Selector (Slider) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                  <label style={{ color: '#64748b', fontWeight: 600 }}>LEVERAGE</label>
                  <span style={{ color: '#ef4444', fontWeight: 800 }}>{marginLeverage}x</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={marginLeverage}
                  onChange={e => setMarginLeverage(parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: '#ef4444', cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: '#64748b' }}>
                  <span>1x</span>
                  <span>3x</span>
                  <span>5x</span>
                  <span>10x</span>
                </div>
              </div>

              {/* Margin Calculations */}
              <div style={{ background: '#090d16', borderRadius: 10, padding: 14, fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Total position size</span>
                  <span style={{ fontWeight: 'bold' }}>{(parseFloat(marginCollateral) * marginLeverage).toFixed(marginPoolKey === 'XBTC_USDC' ? 6 : 1)} {currentMarginPool.base}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Borrowed amount</span>
                  <span style={{ color: '#e2e8f0' }}>{marginDebt} USDC</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Projected LTV</span>
                  <span>{((1 - 1 / marginLeverage) * 100).toFixed(0)}%</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #1e293b', paddingTop: 8 }}>
                  <span style={{ color: '#64748b' }}>Estimated liquidation price</span>
                  <span style={{ color: '#ef4444', fontWeight: 'bold' }}>${marginLiqPrice} USDC</span>
                </div>
              </div>

              {/* AI Coprocessor Warning if high leverage */}
              <div style={{
                background: marginLeverage > 5 ? 'rgba(239,68,68,0.06)' : 'rgba(34,197,94,0.05)',
                border: marginLeverage > 5 ? '1px solid rgba(239,68,68,0.2)' : '1px solid rgba(34,197,94,0.2)',
                borderRadius: 10, padding: 12, fontSize: '0.75rem', display: 'flex', gap: 8, alignItems: 'center'
              }}>
                <span>🤖</span>
                <span style={{ color: '#94a3b8' }}>
                  {marginLeverage > 5 ? (
                    <span style={{ color: '#fca5a5' }}>
                      ⚠️ <strong>AI Guard alert:</strong> Leverage {marginLeverage}x is extremely risky. A move of only ~9% triggers liquidation. Consider lowering leverage.
                    </span>
                  ) : (
                    <span>
                      <strong>AI Analyst:</strong> Leverage {marginLeverage}x is relatively safe. Account health meets the minimum requirement.
                    </span>
                  )}
                </span>
              </div>

              <button
                onClick={handleOpenMarginPosition}
                style={{
                  padding: '14px', borderRadius: 10, border: 'none',
                  background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                  color: '#fff', fontWeight: 800, fontSize: '0.9rem', cursor: 'pointer'
                }}
              >
                Open {currentMarginPool.base} margin position {marginLeverage}x
              </button>
            </div>
          )}

          {/* PREDICT ORDER FORM */}
          {tab === 'predict' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* TESTNET-only isolation banner */}
              <div style={{
                borderRadius: 10, padding: '10px 14px', fontSize: '0.72rem', lineHeight: 1.5,
                background: 'rgba(167,139,250,0.08)', border: '1px solid rgba(167,139,250,0.35)', color: '#c4b5fd',
              }}>
                <strong style={{ color: '#a78bfa' }}>🧪 Testnet sandbox</strong> — DeepBook binary-options predict markets are testnet-only.
                This is a manual try-it feature, fully separate from the bots & agent. Switch your wallet to <strong>Sui Testnet</strong> and
                fund it with test SUI + DUSDC from the faucet. No mainnet funds are touched.
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => setPredictDir('UP')}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 10,
                    background: predictDir === 'UP' ? 'rgba(167,139,250,0.2)' : '#1e293b',
                    color: predictDir === 'UP' ? '#a78bfa' : '#94a3b8',
                    border: predictDir === 'UP' ? '1px solid #a78bfa' : '1px solid transparent',
                    fontWeight: 800, cursor: 'pointer'
                  }}
                >
                  📈 PREDICT UP
                </button>
                <button
                  onClick={() => setPredictDir('DOWN')}
                  style={{
                    flex: 1, padding: '12px', borderRadius: 10,
                    background: predictDir === 'DOWN' ? 'rgba(167,139,250,0.2)' : '#1e293b',
                    color: predictDir === 'DOWN' ? '#a78bfa' : '#94a3b8',
                    border: predictDir === 'DOWN' ? '1px solid #a78bfa' : '1px solid transparent',
                    fontWeight: 800, cursor: 'pointer'
                  }}
                >
                  📉 PREDICT DOWN
                </button>
              </div>

              {/* Round picker — real admin-scheduled rounds (~15-min cadence, BTC) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: 600 }}>
                    ROUND {selectedRound ? `· ${selectedRound.underlying_asset}` : ''}
                  </label>
                  <button onClick={loadPredictRounds} disabled={roundsLoading}
                    style={{ background: 'transparent', border: '1px solid #334155', borderRadius: 6, padding: '3px 8px', color: '#a78bfa', fontSize: '0.66rem', cursor: 'pointer' }}>
                    {roundsLoading ? '…' : '↻ Refresh'}
                  </button>
                </div>
                <select value={selectedOracleId} onChange={e => setSelectedOracleId(e.target.value)}
                  style={{ padding: '12px', borderRadius: 10, border: '1px solid #1e293b', background: '#1e293b', color: '#fff', outline: 'none', fontWeight: 600, fontSize: '0.8rem' }}>
                  {predictRounds.length === 0 && <option value="">{roundsLoading ? 'Loading rounds…' : 'No active rounds'}</option>}
                  {predictRounds.map(r => {
                    const mins = Math.max(0, Math.round((r.expiry - Date.now()) / 60000));
                    const t = new Date(r.expiry);
                    return (
                      <option key={r.oracle_id} value={r.oracle_id}>
                        {r.underlying_asset} · expires {String(t.getHours()).padStart(2,'0')}:{String(t.getMinutes()).padStart(2,'0')} (in {mins}m)
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Strike price (USD) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                  <label style={{ color: '#64748b', fontWeight: 600 }}>STRIKE (USD)</label>
                  {btcPrice > 0 && <span style={{ color: '#94a3b8' }}>BTC now: ${btcPrice.toLocaleString()}</span>}
                </div>
                <input type="number" value={predictStrike} onChange={e => setPredictStrike(e.target.value)}
                  placeholder={btcPrice ? String(Math.round(btcPrice)) : 'Strike price'}
                  style={{ padding: '12px', borderRadius: 10, border: '1px solid #1e293b', background: '#1e293b', color: '#fff', outline: 'none', fontWeight: 'bold', fontFamily: 'monospace' }} />
                <span style={{ fontSize: '0.66rem', color: '#475569' }}>
                  {predictDir === 'UP' ? 'Wins if settlement price is ABOVE this strike' : 'Wins if settlement price is BELOW this strike'}
                </span>
              </div>

              {/* Amount to Bid */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
                  <label style={{ color: '#64748b', fontWeight: 600 }}>STAKE AMOUNT (DUSDC)</label>
                  <span style={{ color: '#94a3b8' }}>Bal: {dusdcBalance.toFixed(2)} DUSDC</span>
                </div>
                <input
                  type="number"
                  value={predictAmount}
                  onChange={e => setPredictAmount(e.target.value)}
                  style={{
                    padding: '12px', borderRadius: 10, border: '1px solid #1e293b',
                    background: '#1e293b', color: '#fff', outline: 'none',
                    fontWeight: 'bold', fontFamily: 'monospace'
                  }}
                />
              </div>

              {/* Payout Calculations */}
              <div style={{ background: '#090d16', borderRadius: 10, padding: 14, fontSize: '0.78rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Payout ratio</span>
                  <span style={{ color: '#a78bfa', fontWeight: 'bold' }}>{predictPayout}x</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Reward if you win</span>
                  <span style={{ color: '#22c55e', fontWeight: 'bold' }}>{predictEstPayout} DUSDC</span>
                </div>
              </div>

              {/* AI Predictor Probabilities */}
              <button
                onClick={handlePlacePredict}
                style={{
                  padding: '14px', borderRadius: 10, border: 'none',
                  background: 'linear-gradient(135deg, #a78bfa, #8b5cf6)',
                  color: '#fff', fontWeight: 800, fontSize: '0.9rem', cursor: 'pointer'
                }}
              >
                Submit {selectedRound?.underlying_asset || 'BTC'} {predictDir} prediction
              </button>
            </div>
          )}

          {/* ASSETS TAB: Wallet Overview Info */}
          {tab === 'assets' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div style={{ fontWeight: 800, color: '#f59e0b', fontSize: '0.95rem', borderBottom: '1px solid #1e293b', paddingBottom: 10 }}>
                💼 WALLET OVERVIEW
              </div>

              <div style={{ fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.7 }}>
                <div style={{ background: '#090d16', borderRadius: 10, padding: 14, marginBottom: 12 }}>
                  <div style={{ fontSize: '0.7rem', color: '#64748b', marginBottom: 4 }}>Total asset value (USD)</div>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#22c55e', fontFamily: 'monospace' }}>${portfolioUSD.toFixed(2)}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #0d1525' }}>
                    <span>💧 SUI</span><span style={{ color: '#00d4ff', fontWeight: 700, fontFamily: 'monospace' }}>{suiBalance.toFixed(4)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #0d1525' }}>
                    <span>💵 USDC</span><span style={{ color: '#22c55e', fontWeight: 700, fontFamily: 'monospace' }}>{usdcBalance.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #0d1525' }}>
                    <span>🌊 DEEP</span><span style={{ color: '#a78bfa', fontWeight: 700, fontFamily: 'monospace' }}>{deepBalance.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #0d1525' }}>
                    <span>₿ xBTC</span><span style={{ color: '#f97316', fontWeight: 700, fontFamily: 'monospace' }}>{xbtcBalance.toFixed(6)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #0d1525' }}>
                    <span>🦭 WAL</span><span style={{ color: '#60a5fa', fontWeight: 700, fontFamily: 'monospace' }}>{walBalance.toFixed(2)}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      🏦 DUSDC
                      <span style={{ background: '#a78bfa', color: '#000', padding: '1px 4px', borderRadius: 3, fontSize: '0.5rem', fontWeight: 800 }}>TESTNET</span>
                    </span>
                    <span style={{ color: '#f59e0b', fontWeight: 700, fontFamily: 'monospace' }}>{dusdcBalance.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              <div style={{
                background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.12)',
                borderRadius: 10, padding: 12, fontSize: '0.72rem', color: '#64748b', lineHeight: 1.5
              }}>
                💡 To deposit or withdraw pool assets, switch to the matching tab:<br/>
                <strong style={{ color: '#00d4ff' }}>Spot</strong> → Deposit into the DeepBook BalanceManager<br/>
                <strong style={{ color: '#ef4444' }}>Margin</strong> → Deposit collateral per pool pair
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── BOTTOM SECTION: POSITIONS & ORDERS MANAGEMENT ── */}
      <div style={{ marginTop: 32 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            📂 POSITIONS & OPEN ORDERS
          </h3>
          <button
            onClick={() => onAskAgent('Analyze the risk of my current positions')}
            disabled={disabled}
            style={{
              background: 'transparent', border: '1px solid #334155', color: '#00d4ff',
              padding: '6px 12px', borderRadius: 8, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
              opacity: disabled ? 0.5 : 1
            }}
          >
            🤖 AI position risk analysis
          </button>
        </div>

        {/* SPOT ORDERS TABLE */}
        {tab === 'v3' && (
          <div style={{ background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b', overflow: 'hidden' }}>
            {spotOrders.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
                No open Spot orders or order history in this session.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1e293b', color: '#64748b', background: '#090d16' }}>
                    <th style={{ padding: 14 }}>Time</th>
                    <th style={{ padding: 14 }}>Pair</th>
                    <th style={{ padding: 14 }}>Side</th>
                    <th style={{ padding: 14 }}>Type</th>
                    <th style={{ padding: 14 }}>Price (USDC)</th>
                    <th style={{ padding: 14 }}>Size</th>
                    <th style={{ padding: 14 }}>Total</th>
                    <th style={{ padding: 14 }}>Status</th>
                    <th style={{ padding: 14 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {spotOrders.map((o) => (
                    <tr key={o.id} style={{ borderBottom: '1px solid #1e293b', color: '#e2e8f0' }}>
                      <td style={{ padding: 14, color: '#64748b' }}>{o.time}</td>
                      <td style={{ padding: 14, fontWeight: 'bold' }}>{o.symbol}/USDC</td>
                      <td style={{ padding: 14, color: o.type === 'BUY' ? '#22c55e' : '#ef4444', fontWeight: 'bold' }}>{o.type}</td>
                      <td style={{ padding: 14 }}>{o.orderType}</td>
                      <td style={{ padding: 14, fontFamily: 'monospace' }}>${o.price}</td>
                      <td style={{ padding: 14, fontFamily: 'monospace' }}>{o.amount}</td>
                      <td style={{ padding: 14, fontFamily: 'monospace' }}>${o.total}</td>
                      <td style={{ padding: 14 }}>
                        <span style={{
                          background: o.status === 'FILLED' ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                          color: o.status === 'FILLED' ? '#22c55e' : '#f59e0b',
                          padding: '2px 8px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 'bold'
                        }}>{o.status}</span>
                      </td>
                      <td style={{ padding: 14 }}>
                        {o.status === 'PENDING' ? (
                          <button
                            onClick={async () => {
                              if (o.orderType !== 'LIMIT') {
                                setSpotOrders(prev => prev.filter(x => x.id !== o.id));
                                showToast('Order cancelled!', 'success');
                                return;
                              }
                              setIsExecuting(true);
                              const success = await cancelLimitOrder('SUI_USDC', o.id);
                              setIsExecuting(false);
                              if (success) {
                                setSpotOrders(prev => prev.filter(x => x.id !== o.id));
                              }
                            }}
                            style={{
                              background: '#ef444422', border: '1px solid #ef4444', color: '#ef4444',
                              padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: '0.75rem'
                            }}
                          >
                            Cancel orders Limit
                          </button>
                        ) : <span style={{ color: '#64748b' }}>-</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* MARGIN POSITIONS TABLE */}
        {tab === 'margin' && (
          <div style={{ background: '#0f172a', borderRadius: 12, border: '1px solid #1e293b', overflow: 'hidden' }}>
            {marginPositions.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: '#64748b', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
                <span style={{ fontSize: '1.5rem' }}>ℹ️</span>
                <span>No margin positions open.</span>
                <div style={{ background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', padding: '12px', borderRadius: '8px', maxWidth: '400px', color: '#93c5fd' }}>
                  <strong>Note:</strong> DeepBook V3 is the canonical spot DEX on SUI. Margin positions created on <strong>deeptrade.io</strong> use their own smart contracts and liquidation engine, and are not yet synced into this open-source Local Client.
                </div>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #1e293b', color: '#64748b', background: '#090d16' }}>
                    <th style={{ padding: 14 }}>Pair</th>
                    <th style={{ padding: 14 }}>Type</th>
                    <th style={{ padding: 14 }}>Collateral</th>
                    <th style={{ padding: 14 }}>Size</th>
                    <th style={{ padding: 14 }}>Entry</th>
                    <th style={{ padding: 14 }}>Debt</th>
                    <th style={{ padding: 14 }}>Liq. price</th>
                    <th style={{ padding: 14 }}>Health</th>
                    <th style={{ padding: 14 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {marginPositions.map((pos, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #1e293b', color: '#e2e8f0' }}>
                      <td style={{ padding: 14, fontWeight: 'bold' }}>SUI/USDC</td>
                      <td style={{ padding: 14, color: pos.type === 'SHORT' ? '#ef4444' : '#22c55e', fontWeight: 'bold' }}>
                        {pos.type || 'LONG'}
                      </td>
                      <td style={{ padding: 14, fontFamily: 'monospace' }}>{pos.collateral} SUI</td>
                      <td style={{ padding: 14, fontFamily: 'monospace' }}>{pos.size || (parseFloat(pos.collateral) * 3).toFixed(1)} SUI</td>
                      <td style={{ padding: 14, fontFamily: 'monospace' }}>${pos.entryPrice || (suiPrice ? suiPrice.toFixed(3) : '—')}</td>
                      <td style={{ padding: 14, fontFamily: 'monospace' }}>{pos.debt} USDC</td>
                      <td style={{ padding: 14, color: '#ef4444', fontWeight: 600, fontFamily: 'monospace' }}>
                        ${pos.liqPrice || '2.530'}
                      </td>
                      <td style={{ padding: 14 }}>
                        <span style={{
                          background: 'rgba(34,197,94,0.1)', color: '#22c55e',
                          padding: '2px 8px', borderRadius: 6, fontSize: '0.7rem', fontWeight: 'bold'
                        }}>{pos.healthFactor}</span>
                      </td>
                      <td style={{ padding: 14, display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => handleCloseMarginPosition(pos, idx)}
                          style={{
                            background: '#ef444422', border: '1px solid #ef4444', color: '#ef4444',
                            padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: '0.75rem'
                          }}
                        >
                          Close
                        </button>
                        <button
                          onClick={() => onAskAgent(`Watch this SUI margin position closely (collateral ${pos.collateral} SUI)`)}
                          style={{
                            background: 'transparent', border: '1px solid #00d4ff', color: '#00d4ff',
                            padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: '0.75rem'
                          }}
                        >
                          AI monitor
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* PREDICT POSITIONS TABLE */}
        {tab === 'predict' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {predictPositions.length === 0 ? (
              <div style={{ background: '#0f172a', borderRadius: 12, padding: '24px', border: '1px solid #1e293b', textAlign: 'center', color: '#64748b', fontSize: '0.85rem' }}>
                No price predictions are running.
              </div>
            ) : (
              predictPositions.map((pos, idx) => (
                <div key={idx} style={{
                  background: 'linear-gradient(135deg, rgba(15,23,42,0.8), rgba(30,41,59,0.6))',
                  borderRadius: 14, padding: '16px', border: '1px solid #1e293b',
                  display: 'flex', flexDirection: 'column', gap: 12
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{
                        width: 44, height: 44, borderRadius: 10, background: 'rgba(167,139,250,0.1)',
                        border: '1px solid rgba(167,139,250,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '1.4rem'
                      }}>{pos.direction === 'UP' ? '📈' : '📉'}</div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontWeight: 800, color: '#fff', fontSize: '1.1rem' }}>{pos.asset}/USDC</span>
                          <span style={{
                            background: pos.direction === 'UP' ? '#22c55e' : '#ef4444',
                            color: '#000', padding: '2px 6px', borderRadius: 4, fontSize: '0.65rem', fontWeight: 800
                          }}>{pos.direction}</span>
                        </div>
                        <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 2 }}>Position ID: {pos.positionId.slice(0, 14)}...</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 800, color: '#fff', fontSize: '1.1rem', fontFamily: 'monospace' }}>
                        {pos.capitalDUSDC} <span style={{ fontSize: '0.8rem', color: '#64748b' }}>DUSDC</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#22c55e', marginTop: 2 }}>Reward: {pos.estimatedPnL}</div>
                    </div>
                  </div>

                  <div style={{ background: '#090d16', borderRadius: 8, padding: '12px', border: '1px solid #1e293b' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: 6 }}>
                      <span style={{ color: '#64748b' }}>Strike: <strong style={{ color: '#e2e8f0' }}>{pos.strikePrice}</strong></span>
                      <span style={{ color: '#64748b' }}>Current: <strong style={{ color: '#00d4ff' }}>${suiPrice.toFixed(3)}</strong></span>
                    </div>

                    <div style={{ height: 6, background: '#1e293b', borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
                      {/* Check if winning */}
                      {(() => {
                        const isUpWinning = pos.direction === 'UP' && suiPrice >= parseFloat(pos.strikePrice.replace('$', ''));
                        const isDownWinning = pos.direction === 'DOWN' && suiPrice <= parseFloat(pos.strikePrice.replace('$', ''));
                        const winning = isUpWinning || isDownWinning;
                        return (
                          <div style={{
                            position: 'absolute', top: 0, left: 0, height: '100%',
                            width: winning ? '100%' : '30%',
                            background: winning ? 'linear-gradient(90deg, #22c55e, #00d4ff)' : '#ef4444',
                            borderRadius: 3
                          }} />
                        );
                      })()}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', marginTop: 6, color: '#64748b' }}>
                      {(() => {
                        const isUpWinning = pos.direction === 'UP' && suiPrice >= parseFloat(pos.strikePrice.replace('$', ''));
                        const isDownWinning = pos.direction === 'DOWN' && suiPrice <= parseFloat(pos.strikePrice.replace('$', ''));
                        const winning = isUpWinning || isDownWinning;
                        return (
                          <span style={{ color: winning ? '#22c55e' : '#ef4444', fontWeight: 'bold' }}>
                            {winning ? 'WINNING (IN PROFIT)' : 'LOSING (NEEDS PRICE TO MOVE)'}
                          </span>
                        );
                      })()}
                      <span>Expires in {pos.daysRemaining} days</span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8', flex: 1, display: 'flex', alignItems: 'center' }}>
                      <span style={{ color: '#a78bfa', marginRight: 4 }}>💡</span> Assistant tip: {pos.recommendation}
                    </div>
                    <button
                      onClick={() => onAskAgent(`Alert me if Predict position ${pos.positionId} risks reversing`)}
                      style={{
                        background: 'transparent', border: '1px solid #1e293b', color: '#94a3b8',
                        padding: '6px 12px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 600, cursor: 'pointer'
                      }}
                    >
                      Enable AI watch
                    </button>
                    <button
                      onClick={() => handleRedeemPredict(pos, idx)}
                      style={{
                        background: '#ef444422', border: '1px solid #ef4444', color: '#ef4444',
                        padding: '6px 12px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer'
                      }}
                    >
                      Redeem early
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};
