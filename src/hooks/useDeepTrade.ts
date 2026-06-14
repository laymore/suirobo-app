// useDeepTrade.ts — DeepBook V3 SDK Integration (Correct browser approach)
// SuiGrpcClient không dùng được trong browser (chỉ cho Node.js gRPC).
// Thay enter đó, dùng SuiClient (JSON-RPC) + DeepBook reads qua RPC trực tiếp.
import { useState, useEffect, useCallback, useRef } from 'react';
import { useCurrentAccount } from '@mysten/dapp-kit';
import { useSignAndExecuteTransaction } from '@mysten/dapp-kit';
import { useSuiClient } from '@mysten/dapp-kit';
import { Transaction } from '@mysten/sui/transactions';
import { deepbook, DeepBookClient } from '@mysten/deepbook-v3';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface PoolInfo {
  poolKey: string;
  base: string;
  quote: string;
  baseIcon: string;
  quoteIcon: string;
  midPrice: number | null;
  takerFee: number | null;
  makerFee: number | null;
}

export interface SwapQuote {
  poolKey: string;
  fromToken: string;
  toToken: string;
  fromAmount: number;
  toAmount: number;
  deepRequired: number;
  priceImpact: number;
  isBaseToCoin: boolean;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
  side: 'bid' | 'ask';
}

export interface PriceCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type DeFiTab = 'swap' | 'spot' | 'margin' | 'options';
export type TxStatus = 'idle' | 'pending' | 'success' | 'error';

// ═══════════════════════════════════════════════════════════════
// DEEPBOOK MAINNET POOL CONFIG
// Địa chỉ pool chính thức từ @mysten/deepbook-v3 constants
// ═══════════════════════════════════════════════════════════════

export const DEEPBOOK_POOLS: PoolInfo[] = [
  { poolKey: 'SUI_USDC',  base: 'SUI',  quote: 'USDC', baseIcon: '💧', quoteIcon: '💵', midPrice: null, takerFee: null, makerFee: null },
  { poolKey: 'DEEP_SUI',  base: 'DEEP', quote: 'SUI',  baseIcon: '🌊', quoteIcon: '💧', midPrice: null, takerFee: null, makerFee: null },
  { poolKey: 'DEEP_USDC', base: 'DEEP', quote: 'USDC', baseIcon: '🌊', quoteIcon: '💵', midPrice: null, takerFee: null, makerFee: null },
  { poolKey: 'WETH_USDC', base: 'WETH', quote: 'USDC', baseIcon: '⚡', quoteIcon: '💵', midPrice: null, takerFee: null, makerFee: null },
];

// DeepBook mainnet pool object IDs (from official constants)
const POOL_IDS: Record<string, string> = {
  SUI_USDC:  '0xdeaaf02b5428e9ad2c25101a1bd9223b573d21f1e7cb32e9e38aab30e26f18c',
  DEEP_SUI:  '0x7f526b1263c4b91b43c9e646419b5696f424de28dda3c1e6658cc0a54558baa7',
  DEEP_USDC: '0xf948981b806057580f91622417534f491da5f61aeaf33d0ed8e69fd5691c95ce',
  WETH_USDC: '0x9c2f68a227a35e0547e88ada724eff09cc61f75cd9e8fa14bf8a11085e96e71',
};

// DeepBook package ID mainnet
const DEEPBOOK_PACKAGE = '0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809';

// Map a DeepBook pool → Binance spot symbol for REAL OHLC candles (null if unsupported).
function binanceSymbol(poolKey: string): string | null {
  const map: Record<string, string> = { SUI_USDC: 'SUIUSDT', WETH_USDC: 'ETHUSDT' };
  return map[poolKey] ?? null;
}

// Fetch REAL candles. Binance klines for supported markets; for tokens without a Binance
// market (e.g. DEEP) fall back to an honest flat line at the real current price — no fabricated history.
async function fetchRealCandles(poolKey: string, fallbackPrice = 0, count = 48): Promise<PriceCandle[]> {
  const sym = binanceSymbol(poolKey);
  if (sym) {
    try {
      const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=5m&limit=${count}`, { signal: AbortSignal.timeout(7000) });
      const rows = await r.json();
      if (Array.isArray(rows) && rows.length) {
        return rows.map((k: any) => ({ time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: Math.round(+k[5]) }));
      }
    } catch { /* fall through to flat line */ }
  }
  if (fallbackPrice > 0) {
    const now = Date.now();
    return Array.from({ length: count }, (_, i) => ({
      time: now - (count - 1 - i) * 300_000,
      open: fallbackPrice, high: fallbackPrice, low: fallbackPrice, close: fallbackPrice, volume: 0,
    }));
  }
  return [];
}

// ═══════════════════════════════════════════════════════════════
// DEEPBOOK RPC HELPER — gọi view function qua SuiClient
// ═══════════════════════════════════════════════════════════════

async function callDeepBookView(
  suiClient: any,
  poolId: string,
  funcName: string,
  args: any[] = []
): Promise<any> {
  try {
    const tx = new Transaction();
    tx.moveCall({
      target: `${DEEPBOOK_PACKAGE}::pool::${funcName}`,
      arguments: [tx.object(poolId), ...args.map(a => tx.pure.u64(a))],
    });
    const result = await suiClient.devInspectTransactionBlock({
      transactionBlock: tx,
      sender: '0x0000000000000000000000000000000000000000000000000000000000000000',
    });
    return result;
  } catch (e) {
    throw e;
  }
}

// Lấy mid price từ DeepBook pool object trực tiếp
async function fetchMidPriceFromObject(suiClient: any, poolId: string): Promise<number | null> {
  try {
    const obj = await suiClient.getObject({
      id: poolId,
      options: { showContent: true, showType: true },
    });
    const fields = obj?.data?.content?.fields;
    if (!fields) return null;

    // Thử lấy từ bids/asks dynamic fields
    const bids = fields.bids;
    const asks = fields.asks;

    // Lấy best_bid và best_ask từ fields
    const bestBid = fields.best_bid_price ? Number(fields.best_bid_price) : null;
    const bestAsk = fields.best_ask_price ? Number(fields.best_ask_price) : null;

    if (bestBid && bestAsk) {
      return (bestBid + bestAsk) / 2 / 1e9; // MIST → SUI
    }

    // Fallback: lấy từ tick_size và deep_price
    if (fields.deep_price) {
      const deepPriceFields = fields.deep_price?.fields;
      if (deepPriceFields?.price_conversion_decimal) {
        return Number(deepPriceFields.price_conversion_decimal) / 1e9;
      }
    }

    return null;
  } catch (e) {
    return null;
  }
}

// Lấy info pool qua devInspect
async function fetchPoolInfo(suiClient: any, poolId: string, poolKey: string): Promise<{
  midPrice: number | null;
  takerFee: number | null;
  makerFee: number | null;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
}> {
  try {
    // Lấy object pool
    const obj = await suiClient.getObject({
      id: poolId,
      options: { showContent: true, showDisplay: true },
    });
    const fields = obj?.data?.content?.fields;

    let midPrice: number | null = null;
    let takerFee: number | null = null;
    let makerFee: number | null = null;

    if (fields) {
      // Taker fee thường là fields.taker_fee hoặc fields.trade_params
      const tradeParams = fields.trade_params?.fields || fields;
      if (tradeParams.taker_fee) takerFee = Number(tradeParams.taker_fee) / 1_000_000;
      if (tradeParams.maker_fee) makerFee = Number(tradeParams.maker_fee) / 1_000_000;
    }

    // Thử lấy giá từ Coingecko/CoinMarketCap API (không cần auth)
    midPrice = await fetchPriceFromCG(poolKey);

    return { midPrice, takerFee, makerFee, bids: [], asks: [] };
  } catch (e) {
    const midPrice = await fetchPriceFromCG(poolKey);
    return { midPrice, takerFee: 0.001, makerFee: 0.0005, bids: [], asks: [] };
  }
}

// Lấy giá từ CoinGecko (không cần API key)
async function fetchPriceFromCG(poolKey: string): Promise<number | null> {
  const cgIdMap: Record<string, string> = {
    SUI_USDC:  'sui',
    DEEP_SUI:  'deep-book',
    DEEP_USDC: 'deep-book',
    WETH_USDC: 'ethereum',
  };
  const cgId = cgIdMap[poolKey];
  if (!cgId) return null;

  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data[cgId]?.usd ?? null;
  } catch {
    return null;
  }
}

// Dry run swap để lấy quote
async function getDryRunQuote(
  suiClient: any,
  poolKey: string,
  fromToken: string,
  amount: number,
  pools: PoolInfo[]
): Promise<{ toAmount: number; deepRequired: number } | null> {
  const pool = pools.find(p => p.poolKey === poolKey);
  if (!pool || !pool.midPrice) return null;

  const isBaseToCoin = fromToken === pool.base;
  const price = pool.midPrice;

  // Tính toán ước tính dựa trên price và fee
  const fee = (pool.takerFee ?? 0.001);
  const toAmount = isBaseToCoin
    ? amount * price * (1 - fee)
    : (amount / price) * (1 - fee);
  const deepRequired = amount * 0.001; // ~0.1% DEEP fees

  return { toAmount: Math.max(0, toAmount), deepRequired };
}

// ═══════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════

export function useDeepTrade(localAddress?: string | null, localKeypair?: any) {
  const suiClient = useSuiClient();
  const account = useCurrentAccount();
  const { mutateAsync: signAndExecuteTx } = useSignAndExecuteTransaction();
  const activeAddress = account?.address ?? localAddress;

  const [activeTab, setActiveTab] = useState<DeFiTab>('swap');
  const [pools, setPools] = useState<PoolInfo[]>(DEEPBOOK_POOLS);
  const [selectedPool, setSelectedPool] = useState<string>('SUI_USDC');
  const [candles, setCandles] = useState<PriceCandle[]>([]);
  const [livePrice, setLivePrice] = useState<number>(0);
  const [orderBook, setOrderBook] = useState<{ bids: OrderBookLevel[]; asks: OrderBookLevel[] }>({ bids: [], asks: [] });
  const [isLoadingPrice, setIsLoadingPrice] = useState(false);
  const [swapQuote, setSwapQuote] = useState<SwapQuote | null>(null);
  const [txStatus, setTxStatus] = useState<TxStatus>('idle');
  const [txMsg, setTxMsg] = useState('');
  const [dbReady, setDbReady] = useState(false);
  const dbClientRef = useRef<any>(null);

  // Load REAL OHLC candles (Binance) whenever the selected pool changes; refresh every 60s.
  useEffect(() => {
    let active = true;
    const load = async () => {
      const rows = await fetchRealCandles(selectedPool, livePrice);
      if (active && rows.length) setCandles(rows);
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { active = false; clearInterval(t); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPool]);

  // Vault state
  const [vaultManagerId, setVaultManagerId] = useState<string | null>(null);
  const [vaultBalances, setVaultBalances] = useState<{ sui: number, usdc: number }>({ sui: 0, usdc: 0 });

  const fetchBalanceManager = useCallback(async (addr: string) => {
    try {
      if (!dbClientRef.current) return;
      
      const structType = '0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809::balance_manager::BalanceManager';
      const res = await suiClient.getOwnedObjects({
        owner: addr,
        filter: { StructType: structType },
        options: { showContent: true }
      });
      
      const ids = res.data.map(obj => obj.data?.objectId).filter(Boolean) as string[];
      
      let selectedId = ids[0];
      let bestSui = 0;
      let bestUsdc = 0;

      // Find the vault with the most SUI (or just one with funds)
      for (const id of ids) {
        try {
          const suiBal = await dbClientRef.current.checkManagerBalanceWithAddress(id, 'SUI');
          const usdcBal = await dbClientRef.current.checkManagerBalanceWithAddress(id, 'USDC');
          const sui = suiBal?.balance || 0;
          const usdc = usdcBal?.balance || 0;
          
          if (sui > bestSui || (sui === bestSui && usdc > bestUsdc)) {
            selectedId = id;
            bestSui = sui;
            bestUsdc = usdc;
          }
        } catch(e) {
          console.warn('Error checking vault', id, e);
        }
      }

      if (selectedId) {
        setVaultManagerId(selectedId);
        if (dbClientRef.current?.config) {
          dbClientRef.current.config.balanceManagers = {
            'my_vault': { address: selectedId }
          };
        }
        
        setVaultBalances({
          sui: bestSui,
          usdc: bestUsdc
        });
      } else {
        setVaultManagerId(null);
        setVaultBalances({ sui: 0, usdc: 0 });
      }
    } catch(e: any) {
      console.warn('Failed to fetch Vault balances', e);
      setVaultBalances(prev => ({ ...prev, error: e.message || String(e) } as any));
    }
  }, [suiClient]);

  // Khởi tạo DeepBook client từ suiClient (dapp-kit cung cấp SuiClient)
  useEffect(() => {
    const addr = activeAddress ?? '0x0000000000000000000000000000000000000000000000000000000000000000';
    try {
      // Dapp-kit SuiClient không có property network, DeepBook SDK cần nó để map address
      (suiClient as any).network = 'mainnet';
      
      const dbConfig = deepbook({ address: addr });
      const extended = (suiClient as any).$extend?.(dbConfig);
      if (extended && extended.deepbook) {
        dbClientRef.current = extended.deepbook;
        setDbReady(true);
        console.log('[DeepBook] SDK initialized (mainnet):', addr.slice(0, 12) + '...');
        if (activeAddress) fetchBalanceManager(activeAddress);
        return;
      }
    } catch (e) {
      console.warn('[DeepBook] SDK init fallback mode:', (e as Error)?.message?.slice(0, 60));
    }
    // Fallback mode: dùng CoinGecko + RPC trực tiếp
    dbClientRef.current = { _suiClient: suiClient };
    setDbReady(true);
  }, [suiClient, activeAddress]);

  // Fetch live price và pool data
  const fetchPoolData = useCallback(async (poolKey: string) => {
    setIsLoadingPrice(true);
    try {
      const poolId = POOL_IDS[poolKey];
      if (!poolId) return;

      // Thử DeepBook SDK trước
      let midPrice: number | null = null;
      let takerFee: number | null = null;
      let makerFee: number | null = null;

      const db = dbClientRef.current;

      if (db?.deepbook) {
        // SDK đầy đủ — thử midPrice
        try {
          midPrice = await db.deepbook.midPrice(poolKey);
          console.log('[DeepBook SDK] midPrice:', midPrice);
        } catch (e) {
          console.warn('[DeepBook SDK] midPrice failed:', e);
        }

        try {
          const params = await db.deepbook.poolTradeParams(poolKey);
          takerFee = params?.takerFee ?? null;
          makerFee = params?.makerFee ?? null;
        } catch {
          // ignore
        }

        // Order book
        try {
          const l2 = await db.deepbook.getLevel2TicksFromMid(poolKey, 8);
          const bids: OrderBookLevel[] = (l2?.bid_prices ?? []).map((price: number, i: number) => ({
            price, quantity: l2.bid_quantities[i] ?? 0, side: 'bid' as const
          }));
          const asks: OrderBookLevel[] = (l2?.ask_prices ?? []).map((price: number, i: number) => ({
            price, quantity: l2.ask_quantities[i] ?? 0, side: 'ask' as const
          }));
          setOrderBook({ bids: bids.slice(0, 8), asks: asks.slice(0, 8) });
        } catch {
          // ignore
        }
      }

      // Fallback: CoinGecko nếu SDK không trả về giá
      if (!midPrice || midPrice <= 0) {
        midPrice = await fetchPriceFromCG(poolKey);
        console.log('[CoinGecko] price for', poolKey, ':', midPrice);
      }

      if (!takerFee) {
        // Default fee từ DeepBook V3 docs
        const feeMap: Record<string, { taker: number; maker: number }> = {
          SUI_USDC:  { taker: 0.001, maker: 0.0005 },
          DEEP_SUI:  { taker: 0.001, maker: 0.0005 },
          DEEP_USDC: { taker: 0.001, maker: 0.0005 },
          WETH_USDC: { taker: 0.001, maker: 0.0005 },
        };
        takerFee = feeMap[poolKey]?.taker ?? 0.001;
        makerFee = feeMap[poolKey]?.maker ?? 0.0005;
      }

      if (midPrice && midPrice > 0) {
        setLivePrice(midPrice);
        // Update the most recent candle's close with the real live price (no fabricated OHLC/volume).
        // Full real history is loaded separately from Binance by the candle-loader effect.
        setCandles(prev => {
          if (!prev.length) return prev;
          const last = { ...prev[prev.length - 1] };
          last.close = midPrice!;
          last.high = Math.max(last.high, midPrice!);
          last.low = Math.min(last.low, midPrice!);
          return [...prev.slice(0, -1), last];
        });

        setPools(prev => prev.map(p =>
          p.poolKey === poolKey
            ? { ...p, midPrice, takerFee, makerFee }
            : p
        ));
      }
    } catch (e) {
      console.error('[DeepBook] fetchPoolData error:', e);
    } finally {
      setIsLoadingPrice(false);
    }
  }, []);

  // Auto-refresh price mỗi 30 second
  useEffect(() => {
    if (!dbReady) return;
    fetchPoolData(selectedPool);
    const id = setInterval(() => fetchPoolData(selectedPool), 30_000);
    return () => clearInterval(id);
  }, [selectedPool, dbReady, fetchPoolData]);

  // (Real candles are loaded by the Binance-backed effect declared above.)

  // ─── GET SWAP QUOTE ──────────────────────────────────────────
  const getSwapQuote = useCallback(async (
    poolKey: string, fromToken: string, toToken: string, amount: number
  ): Promise<SwapQuote | null> => {
    if (amount <= 0) return null;
    const pool = pools.find(p => p.poolKey === poolKey);
    if (!pool) return null;

    const isBaseToCoin = fromToken === pool.base;
    let toAmount = 0;
    let deepRequired = 0;

    const db = dbClientRef.current;

    // Thử SDK
    if (db?.deepbook) {
      try {
        let result: any;
        const baseDecimals = 9;
        const quoteDecimals = 6;
        const fromDecimals = isBaseToCoin ? baseDecimals : quoteDecimals;
        const amountScaled = Math.floor(amount * (10 ** fromDecimals));

        if (isBaseToCoin) {
          result = await db.deepbook.getQuoteQuantityOut(poolKey, amountScaled);
          toAmount = (result?.quoteOut ?? 0) / (10 ** quoteDecimals);
        } else {
          result = await db.deepbook.getBaseQuantityOut(poolKey, amountScaled);
          toAmount = (result?.baseOut ?? 0) / (10 ** baseDecimals);
        }
        deepRequired = (result?.deepRequired ?? 0) / 1e9;
        console.log('[DeepBook SDK] Quote:', result);
      } catch (e) {
        console.warn('[DeepBook SDK] Quote failed, using price calc:', e);
      }
    }

    // Fallback: tính từ mid price
    if (toAmount <= 0 && pool.midPrice) {
      const fee = pool.takerFee ?? 0.001;
      toAmount = isBaseToCoin
        ? amount * pool.midPrice * (1 - fee)
        : (amount / pool.midPrice) * (1 - fee);
      deepRequired = amount * 0.001;
    }

    if (toAmount <= 0) return null;

    const rate = toAmount / amount;
    const expectedRate = isBaseToCoin ? (pool.midPrice ?? 1) : (1 / (pool.midPrice ?? 1));
    const priceImpact = expectedRate > 0 ? Math.abs((rate - expectedRate) / expectedRate) * 100 : 0;

    const q: SwapQuote = {
      poolKey, fromToken, toToken, fromAmount: amount,
      toAmount, deepRequired, priceImpact, isBaseToCoin,
    };
    setSwapQuote(q);
    return q;
  }, [pools]);

  // ─── EXECUTE SWAP ────────────────────────────────────────────
  const executeSwap = useCallback(async (quote: SwapQuote): Promise<boolean> => {
    if (!activeAddress) {
      setTxStatus('error');
      setTxMsg('Not connected ví!');
      return false;
    }

    setTxStatus('pending');
    setTxMsg('Đang xây dựng trade DeepBook V3...');

    try {
      const tx = new Transaction();
      const db = dbClientRef.current;

      if (!db?.deepBook) {
        throw new Error('DeepBook client chưa sẵn sàng. Thử lại sau.');
      }

      const minOut = quote.toAmount * 0.99; // 1% slippage
      setTxMsg('Calling DeepBook swap...');

      // TODO: Hardcode decimals for SUI/USDC for now, should be dynamic based on pool
      const fromDecimals = quote.isBaseToCoin ? 9 : 6;
      const toDecimals = quote.isBaseToCoin ? 6 : 9;

      // DeepBook SDK v3 automatically multiplies by the asset's scalar (decimals) via convertQuantity.
      // So we must pass the unscaled human-readable floats here.
      const amountFloat = quote.fromAmount;
      const minOutFloat = minOut;
      const deepAmountFloat = Math.max(quote.deepRequired, quote.fromAmount * 0.1, 0.05);

      let coinsToTransfer;
      if (quote.isBaseToCoin) {
        coinsToTransfer = db.deepBook.swapExactBaseForQuote({
          poolKey: quote.poolKey,
          amount: amountFloat,
          deepAmount: deepAmountFloat,
          minOut: minOutFloat,
        })(tx as any);
      } else {
        coinsToTransfer = db.deepBook.swapExactQuoteForBase({
          poolKey: quote.poolKey,
          amount: amountFloat,
          deepAmount: deepAmountFloat,
          minOut: minOutFloat,
        })(tx as any);
      }

      // We MUST transfer the returned coins (Base, Quote, DEEP) back to the user's wallet
      tx.transferObjects(coinsToTransfer as any, tx.pure.address(activeAddress));

      let result;
      if (localKeypair) {
        setTxMsg('Đang ký bằng Ví Local...');
        tx.setSender(activeAddress);
        const bytes = await tx.build({ client: suiClient as any });
        const signed = await localKeypair.signTransaction(bytes);
        result = await suiClient.executeTransactionBlock({
          transactionBlock: signed.bytes,
          signature: signed.signature,
          options: { showEffects: true },
        });
      } else {
        setTxMsg('Please sign trade trong ví...');
        result = await signAndExecuteTx({
          transaction: tx,
        });
      }

      let finalStatus = result.effects?.status?.status;
      let finalError = result.effects?.status?.error;
      if (!finalStatus) {
        setTxMsg('Confirming kết quả on-chain...');
        const txResult = await suiClient.waitForTransaction({ digest: result.digest, options: { showEffects: true } });
        finalStatus = txResult.effects?.status?.status;
        finalError = txResult.effects?.status?.error;
      }

      if (finalStatus === 'success') {
        setTxStatus('success');
        setTxMsg(`✓ Swap succeeded! TX: ${result.digest?.slice(0, 16)}...`);
        setTimeout(() => { setTxStatus('idle'); setTxMsg(''); }, 6000);
        fetchPoolData(quote.poolKey); // refresh price
        return true;
      } else {
        throw new Error(finalError ?? 'Transaction failed');
      }
    } catch (e: any) {
      console.error('[DeepBook] Swap error:', e);
      setTxStatus('error');
      const msg = e?.message ?? 'Transaction failed';
      setTxMsg(`✗ ${msg.slice(0, 80)}`);
      setTimeout(() => { setTxStatus('idle'); setTxMsg(''); }, 8000);
      return false;
    }
  }, [activeAddress, localKeypair, signAndExecuteTx, suiClient, fetchPoolData]);

  // ─── VAULT & LIMIT ORDERS ────────────────────────────────────────────
  const depositToVault = useCallback(async (coinType: string, amount: number): Promise<string | null> => {
    if (!activeAddress) return null;
    setTxStatus('pending');
    setTxMsg(`Depositing ${amount} ${coinType} enter Vault...`);

    try {
      const tx = new Transaction();
      const db = dbClientRef.current;
      const packageId = '0x0e735f8c93a95722efd73521aca7a7652c0bb71ed1daf41b26dfd7d1ff71f748';
      let currentVaultId = vaultManagerId;

      if (!currentVaultId) {
        setTxMsg('Initializing Vault mới...');
        const manager = tx.moveCall({
          target: `${packageId}::balance_manager::new`,
          arguments: []
        });
        tx.transferObjects([manager], tx.pure.address(activeAddress));
        
        // Cần submit trade này trước để lấy ID
        let result;
        if (localKeypair) {
          tx.setSender(activeAddress);
          const bytes = await tx.build({ client: suiClient as any });
          const signed = await localKeypair.signTransaction(bytes);
          result = await suiClient.executeTransactionBlock({
            transactionBlock: signed.bytes,
            signature: signed.signature,
            options: { showEffects: true, showObjectChanges: true }
          });
        } else {
          result = await signAndExecuteTx({
            transaction: tx,
          });
        }

        let resultObjectChanges = result.objectChanges;
        if (!resultObjectChanges) {
          setTxMsg('Fetching info Vault mới...');
          const txResult = await suiClient.waitForTransaction({
            digest: result.digest,
            options: { showEffects: true, showObjectChanges: true }
          });
          resultObjectChanges = txResult.objectChanges;
        }

        const created = resultObjectChanges?.find(c => c.type === 'created' && c.objectType.includes('BalanceManager'));
        if (created && 'objectId' in created) {
          currentVaultId = created.objectId;
          setVaultManagerId(currentVaultId);
          if (db?.config) db.config.balanceManagers = { 'my_vault': { address: currentVaultId } };
        } else {
          throw new Error('Cannot tạo Vault');
        }
        
        setTxStatus('success');
        setTxMsg(`Create Vault succeeded! Vui lòng nạp tiền lại.`);
        setTimeout(() => { setTxStatus('idle'); setTxMsg(''); }, 3000);
        return currentVaultId;
      }

      // Already exists Vault, tiến hành nạp
      const freshDb = new DeepBookClient({
        client: suiClient as any,
        network: 'mainnet',
        address: activeAddress,
        balanceManagers: { 'my_vault': { address: currentVaultId } }
      });
      freshDb.balanceManager.depositIntoManager('my_vault', coinType, amount)(tx as any);

      let result;
      if (localKeypair) {
        tx.setSender(activeAddress);
        const bytes = await tx.build({ client: suiClient as any });
        const signed = await localKeypair.signTransaction(bytes);
        result = await suiClient.executeTransactionBlock({
          transactionBlock: signed.bytes,
          signature: signed.signature,
          options: { showEffects: true }
        });
      } else {
        result = await signAndExecuteTx({
          transaction: tx,
        });
      }

      let finalStatus = result.effects?.status?.status;
      let finalError = result.effects?.status?.error;
      if (!finalStatus) {
        const txResult = await suiClient.waitForTransaction({ digest: result.digest, options: { showEffects: true } });
        finalStatus = txResult.effects?.status?.status;
        finalError = txResult.effects?.status?.error;
      }

      if (finalStatus === 'success') {
        setTxStatus('success');
        setTxMsg(`Deposit succeeded ${amount} ${coinType} enter Vault!`);
        setTimeout(() => { setTxStatus('idle'); setTxMsg(''); }, 3000);
        return currentVaultId;
      }
      throw new Error(finalError || 'Giao dịch nạp failed');
    } catch (e: any) {
      console.error(e);
      setTxStatus('error');
      const errStr = e?.message || String(e);
      setTxMsg(`✗ ${errStr.slice(0, 100)}`);
      setTimeout(() => { setTxStatus('idle'); setTxMsg(''); }, 5000);
      throw e;
    }
  }, [activeAddress, vaultManagerId, signAndExecuteTx, suiClient, localKeypair]);

  const executeLimitOrder = useCallback(async (
    poolKey: string,
    isBid: boolean,
    price: number,
    amount: number,
    overrideVaultId?: string
  ): Promise<string | boolean> => {
    if (!activeAddress) {
      setTxStatus('error');
      setTxMsg('Vui lòng kết nối ví trước khi trade.');
      setTimeout(() => { setTxStatus('idle'); setTxMsg(''); }, 3000);
      return false;
    }

    setTxStatus('pending');
    setTxMsg(`Preparing orders ${isBid ? 'Buy' : 'Sell'} Limit...`);

    try {
      const tx = new Transaction();
      let activeVaultId = overrideVaultId || vaultManagerId;
      const packageId = '0x0e735f8c93a95722efd73521aca7a7652c0bb71ed1daf41b26dfd7d1ff71f748';

      // 1. Auto tạo Vault nếu chưa có
      if (!activeVaultId) {
        setTxMsg('Initializing Vault mới (tự động)...');
        const manager = tx.moveCall({
          target: `${packageId}::balance_manager::new`,
          arguments: []
        });
        tx.transferObjects([manager], tx.pure.address(activeAddress));
        
        // Cần submit PTB này để lấy ID Vault trước khi Deposit
        // Khác với orders Market, Limit Order bắt buộc cần ID của Vault để truyền enter DeepBookClient
        // Vì DeepBookClient yêu cầu ID cứng dạng chuỗi (để wrap tx.object(id)).
        let initResult;
        if (localKeypair) {
          tx.setSender(activeAddress);
          const bytes = await tx.build({ client: suiClient as any });
          const signed = await localKeypair.signTransaction(bytes);
          initResult = await suiClient.executeTransactionBlock({
            transactionBlock: signed.bytes, signature: signed.signature,
            options: { showEffects: true, showObjectChanges: true }
          });
        } else {
          initResult = await signAndExecuteTx({
            transaction: tx
          });
        }

        const created = initResult.objectChanges?.find((c: any) => c.type === 'created' && c.objectType.includes('BalanceManager'));
        if (created && 'objectId' in created) {
          activeVaultId = created.objectId;
          setVaultManagerId(activeVaultId);
        } else {
          throw new Error('Cannot khởi tạo Vault. Hãy thử nạp tiền thủ công.');
        }
      }

      // 2. Auto nạp tiền (Auto-Deposit) nếu thiếu
      const txTrade = new Transaction();
      const db = new DeepBookClient({
        client: suiClient as any,
        network: 'mainnet',
        address: activeAddress,
        balanceManagers: { 'my_vault': { address: activeVaultId } }
      });

      if (isBid) { // Buy SUI with USDC
        const usdcNeeded = amount * price;
        const missingUsdc = usdcNeeded - vaultBalances.usdc;
        
        if (missingUsdc > 0.0001) {
          setTxMsg(`Fetching coin USDC từ ví để nạp...`);
          db.balanceManager.depositIntoManager('my_vault', 'USDC', missingUsdc)(txTrade as any);
        }
      } else { // Sell SUI
        const missingSui = amount - vaultBalances.sui;
        if (missingSui > 0.0001) {
          setTxMsg(`Fetching coin SUI từ ví để nạp...`);
          db.balanceManager.depositIntoManager('my_vault', 'SUI', missingSui)(txTrade as any);
        }
      }

      const expire = Date.now() + 1000 * 60 * 60 * 24 * 7; // 7 days

      db.deepBook.placeLimitOrder({
        poolKey,
        balanceManagerKey: 'my_vault',
        clientOrderId: Math.floor(Math.random() * 1000000).toString(),
        price,
        quantity: amount,
        isBid,
        expiration: expire,
        orderType: 0, // NO_RESTRICTION
        payWithDeep: false
      })(txTrade as any);

      setTxMsg(`Waiting for bạn xác nhận trên ví (Wallet)...`);
      let result;
      if (localKeypair) {
        txTrade.setSender(activeAddress);
        const bytes = await txTrade.build({ client: suiClient as any });
        const signed = await localKeypair.signTransaction(bytes);
        result = await suiClient.executeTransactionBlock({
          transactionBlock: signed.bytes,
          signature: signed.signature,
          options: { showEffects: true }
        });
      } else {
        result = await signAndExecuteTx({ 
          transaction: txTrade
        });
      }

      let finalStatus = result.effects?.status?.status;
      let finalError = result.effects?.status?.error;
      let realOrderId = '';
      
      if (!finalStatus) {
        setTxMsg('Confirming kết quả on-chain...');
        const txResult = await suiClient.waitForTransaction({ digest: result.digest, options: { showEffects: true, showEvents: true } });
        finalStatus = txResult.effects?.status?.status;
        finalError = txResult.effects?.status?.error;
        if (txResult.events) {
          const placedEvent = txResult.events.find(e => e.type.includes('::order_info::OrderPlaced'));
          if (placedEvent && (placedEvent.parsedJson as any).order_id) {
            realOrderId = (placedEvent.parsedJson as any).order_id;
          }
        }
      } else if (result.events) {
        const placedEvent = result.events.find((e: any) => e.type.includes('::order_info::OrderPlaced'));
        if (placedEvent && (placedEvent.parsedJson as any).order_id) {
          realOrderId = (placedEvent.parsedJson as any).order_id;
        }
      }

      if (finalStatus === 'success') {
        setTxStatus('success');
        setTxMsg(`Đặt orders Limit succeeded! TX: ${result.digest?.slice(0, 8)}...`);
        setTimeout(() => { setTxStatus('idle'); setTxMsg(''); }, 5000);
        return realOrderId || true;
      }
      throw new Error(finalError || 'Error hợp đồng khi đặt orders Limit');
    } catch (e: any) {
      console.error('Error chi tiết:', e);
      setTxStatus('error');
      const errStr = e?.message || String(e);
      setTxMsg(`✗ Error: ${errStr.slice(0, 100)}`);
      setTimeout(() => { setTxStatus('idle'); setTxMsg(''); }, 5000);
      throw e;
    }
  }, [activeAddress, vaultManagerId, signAndExecuteTx, suiClient, vaultBalances, localKeypair]);

  const cancelLimitOrder = useCallback(async (
    poolKey: string,
    orderId: string
  ): Promise<boolean> => {
    if (!activeAddress || !vaultManagerId) return false;
    setTxStatus('pending');
    setTxMsg(`Đang hủy orders Limit...`);

    // Nếu là orders mock cũ thì bỏ qua (do trước đó chưa parse đc order_id thực sự)
    if (orderId.startsWith('0x')) {
      setTimeout(() => {
        setTxStatus('success');
        setTxMsg('Cancel orders succeeded (Mock)!');
        setTimeout(() => { setTxStatus('idle'); setTxMsg(''); }, 3000);
      }, 1000);
      return true;
    }

    try {
      const tx = new Transaction();
      const db = new DeepBookClient({
        client: suiClient as any,
        network: 'mainnet',
        address: activeAddress,
        balanceManagers: {
          'my_vault': { address: vaultManagerId }
        }
      });

      // 1. Cancel lệnh
      db.deepBook.cancelOrder(poolKey, 'my_vault', orderId)(tx as any);
      
      // 2. Withdraw toàn bộ số dư (USDC và SUI) còn lại trong Vault trả về ví người dùng
      db.balanceManager.withdrawAllFromManager('my_vault', 'USDC', activeAddress)(tx as any);
      db.balanceManager.withdrawAllFromManager('my_vault', 'SUI', activeAddress)(tx as any);

      let result;
      if (localKeypair) {
        tx.setSender(activeAddress);
        const bytes = await tx.build({ client: suiClient as any });
        const signed = await localKeypair.signTransaction(bytes);
        result = await suiClient.executeTransactionBlock({
          transactionBlock: signed.bytes,
          signature: signed.signature,
          options: { showEffects: true }
        });
      } else {
        result = await signAndExecuteTx({
          transaction: tx
        });
      }

      let finalStatus = result.effects?.status?.status;
      let finalError = result.effects?.status?.error;
      if (!finalStatus) {
        setTxMsg('Confirming kết quả on-chain...');
        const txResult = await suiClient.waitForTransaction({ digest: result.digest, options: { showEffects: true } });
        finalStatus = txResult.effects?.status?.status;
        finalError = txResult.effects?.status?.error;
      }

      if (finalStatus === 'success') {
        setTxStatus('success');
        setTxMsg('Cancel orders succeeded!');
        setTimeout(() => { setTxStatus('idle'); setTxMsg(''); }, 3000);
        return true;
      }
      throw new Error(finalError || 'Error hủy lệnh');
    } catch (e: any) {
      console.error('Error chi tiết:', e);
      setTxStatus('error');
      const errStr = e?.message || String(e);
      setTxMsg(`✗ Error: ${errStr.slice(0, 100)}`);
      setTimeout(() => { setTxStatus('idle'); setTxMsg(''); }, 5000);
      throw e;
    }
  }, [activeAddress, vaultManagerId, signAndExecuteTx, suiClient, localKeypair]);

  const currentPool = pools.find(p => p.poolKey === selectedPool) ?? pools[0];

  return {
    activeTab, setActiveTab,
    pools, selectedPool, setSelectedPool,
    currentPool,
    candles, livePrice,
    orderBook,
    isLoadingPrice,
    dbReady,
    swapQuote,
    txStatus, txMsg,
    vaultManagerId,
    vaultBalances,
    getSwapQuote,
    executeSwap,
    depositToVault,
    executeLimitOrder,
    cancelLimitOrder,
    refreshPrice: () => fetchPoolData(selectedPool),
  };
}
