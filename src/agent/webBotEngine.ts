/**
 * webBotEngine — browser-side trade execution for the "Web Bot" (no-install) mode.
 *
 * This is the in-browser twin of the agent's directOpen/directClose: it builds the
 * EXACT same on-chain transactions, but returns an UNSIGNED `Transaction` so the
 * user signs it with their own wallet (dApp-kit) instead of a server-held key.
 *
 *   SUI/USDC  → DeepBook margin: Pyth update + borrowBase/borrowQuote (open),
 *               repayBase/repayQuote (close). Mirrors live_trade_agent.directOpen/Close.
 *   xBTC/USDC → DeepTrade spot market order (DeepBook V3). Re-implemented here WITHOUT
 *               the @google/adk FunctionTool wrapper so the web bundle stays clean.
 *
 * Sizing (calcWebSize) reuses calcMargin from the shared backtest engine so the web
 * bot sizes positions identically to the backtester and the agent.
 */
import { Transaction } from '@mysten/sui/transactions';
import { DeepBookClient } from '@mysten/deepbook-v3';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { calcMargin } from './backtestEngine';
import { injectBotOpenFee } from './tools/executionFee';

const MAINNET_RPC = 'https://fullnode.mainnet.sui.io';

// ─── Position sizing (identical to live_trade_agent.calcSize) ─────────────────
export interface WebBotSize { marginSUI: number; borrowSUI: number; borrowUSDC: number; }

export function calcWebSize(
  skill: {
    sizingMode?: 'fixed_pct' | 'risk_pct'; riskPct?: number; orderPct: number;
    stopLossPct: number; leverage: number; enableDefense: boolean;
  },
  capitalSUI: number,
  price: number,
): WebBotSize {
  const marginSUI   = calcMargin(skill, capitalSUI);
  const positionSUI = marginSUI * skill.leverage;
  return {
    marginSUI,
    borrowSUI:  Math.round(positionSUI * 1000) / 1000,
    borrowUSDC: Math.round(positionSUI * price * 100) / 100,
  };
}

// ─── SUI/USDC DeepBook margin (open = borrow, close = repay) ───────────────────

/** DeepBookClient with the margin-manager map registered — borrow/repay throw
 *  MARGIN_MANAGER_NOT_FOUND without it (same pattern as LiveTradeDashboard). */
function dbWithManager(suiClient: any, address: string, managerKey: string): DeepBookClient {
  const key = normalizeSuiAddress(managerKey);
  return new DeepBookClient({
    client: suiClient, network: 'mainnet', address,
    marginManagers: { [key]: { marginManagerKey: key, address: key, poolKey: 'SUI_USDC' } } as any,
  });
}

export interface SuiTradeOpts {
  suiClient: any;
  address: string;
  managerKey: string;
  type: 'LONG' | 'SHORT';
  amount: number;                                           // borrow (open) / repay (close)
  injectPyth: (tx: Transaction, poolKey: string) => Promise<any>;
  skillAuthor?: string;                                     // 0.01 SUI author fee (open only)
}

/** Open a leveraged SUI/USDC position by borrowing against the margin account.
 *  LONG → borrow SUI (base); SHORT → borrow USDC (quote). */
export async function buildSuiOpenTx(o: SuiTradeOpts): Promise<Transaction> {
  const db = dbWithManager(o.suiClient, o.address, o.managerKey);
  const key = normalizeSuiAddress(o.managerKey);
  const tx = new Transaction();
  tx.setSender(o.address);
  // Pyth price update MUST precede borrow — the health check reads the feeds.
  await o.injectPyth(tx, 'SUI_USDC');
  if (o.type === 'LONG') db.marginManager.borrowBase(key, o.amount)(tx);
  else                   db.marginManager.borrowQuote(key, o.amount)(tx);
  // 0.01 SUI bot-open fee → 0.005 marketplace + 0.005 to the skill author (deterministic).
  if (o.skillAuthor) injectBotOpenFee(tx, [o.skillAuthor]);
  return tx;
}

/** Close a SUI/USDC position by repaying the borrow. Close is FREE (no bot fee). */
export async function buildSuiCloseTx(o: SuiTradeOpts): Promise<Transaction> {
  const db = dbWithManager(o.suiClient, o.address, o.managerKey);
  const key = normalizeSuiAddress(o.managerKey);
  const tx = new Transaction();
  tx.setSender(o.address);
  await o.injectPyth(tx, 'SUI_USDC');
  if (o.type === 'LONG') db.marginManager.repayBase(key, o.amount)(tx);
  else                   db.marginManager.repayQuote(key, o.amount)(tx);
  return tx;
}

// ─── xBTC/USDC DeepTrade spot (market order) — browser-only build ──────────────
// Verified mainnet constants (copied from src/agent/tools/deeptrade_xbtc.ts to
// avoid importing that module's @google/adk FunctionTool into the web bundle).

const DEEPTRADE_PKG      = '0xc10d536b6580d809711b9bb8eee3945d5e96f92a346c84d74ff7a0697e664695';
const TREASURY           = '0xb90e2d3de41817016b7d39f49c724c5b0616bd30f1d5e6383048efafabe6232b';
const TRADING_FEE_CONFIG = '0xcb757e55db3a502dc826c40b8ced507d017b41d926c5bf554e69855510bb855e';
const LOYALTY_PROGRAM    = '0x6a06100001533356fb2e9f68ee299c15565777dfb28c741ec440cb08b168cbff';
const XBTC_USDC_POOL     = '0x20b9a3ec7a02d4f344aa1ebc5774b7b0ccafa9a5d76230662fdc0300bb215307';
const XBTC_TYPE          = '0x876a4b7bce8aeaef60464c11f4026903e9afacab79b9b142686158aa86560b50::xbtc::XBTC';
const USDC_TYPE          = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

const BASE_DECIMALS = 8, QUOTE_DECIMALS = 6;
const BASE_SCALAR = 10 ** BASE_DECIMALS, QUOTE_SCALAR = 10 ** QUOTE_DECIMALS, FLOAT_SCALAR = 1e9;
const LOT_SIZE = 1000, MIN_SIZE = 1000, TICK_SIZE = 10_000_000;
const SELF_MATCHING_ALLOWED = 0, CLOCK_ID = '0x6';

function scalePrice(price: number): bigint {
  const raw = Math.round((price * FLOAT_SCALAR * QUOTE_SCALAR) / BASE_SCALAR);
  return BigInt(Math.max(TICK_SIZE, Math.round(raw / TICK_SIZE) * TICK_SIZE));
}
function scaleQty(qty: number): bigint {
  const raw = Math.floor(Math.round(qty * BASE_SCALAR) / LOT_SIZE) * LOT_SIZE;
  return BigInt(raw);
}
function scaleQuote(usdc: number): bigint { return BigInt(Math.round(usdc * QUOTE_SCALAR)); }

async function rpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(MAINNET_RPC, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return res.json();
}
async function getCoinObjects(owner: string, coinType: string): Promise<{ ids: string[]; total: bigint }> {
  const r = await rpc('suix_getCoins', [owner, coinType, null, 50]);
  const coins = (r?.result?.data ?? []) as any[];
  coins.sort((a, b) => (BigInt(b.balance) > BigInt(a.balance) ? 1 : -1));
  const total = coins.reduce((s, c) => s + BigInt(c.balance), BigInt(0));
  return { ids: coins.map((c) => c.coinObjectId), total };
}
function inputCoin(tx: Transaction, coinIds: string[]): any {
  const primary = tx.object(coinIds[0]);
  if (coinIds.length > 1) tx.mergeCoins(primary, coinIds.slice(1).map((id) => tx.object(id)));
  return primary;
}

export interface XbtcTradeOpts {
  address: string;
  side: 'buy' | 'sell';
  price: number;
  quantity: number;             // xBTC amount
  balanceManagerId: string;
  feeManagerId: string;
  isOpening: boolean;           // true → charge 0.01 SUI author fee; false (close) → free
  skillAuthor?: string;
}

/** Build a DeepTrade xBTC/USDC market order (immediate fill). buy spends USDC,
 *  sell delivers xBTC. Returns an unsigned Transaction for wallet signing. */
export async function buildXbtcTx(o: XbtcTradeOpts): Promise<Transaction> {
  const isBid = o.side === 'buy';
  const scaledQty = scaleQty(o.quantity);
  if (scaledQty < BigInt(MIN_SIZE))
    throw new Error(`Quantity ${o.quantity} xBTC is below the pool minimum (${MIN_SIZE / BASE_SCALAR} xBTC).`);

  const tx = new Transaction();
  tx.setSender(o.address);

  const inType = isBid ? USDC_TYPE : XBTC_TYPE;
  const { ids } = await getCoinObjects(o.address, inType);
  if (ids.length === 0) throw new Error(`No ${isBid ? 'USDC' : 'xBTC'} coins found in wallet ${o.address}.`);

  let baseCoinArg: any, quoteCoinArg: any;
  if (isBid) {
    quoteCoinArg = inputCoin(tx, ids);
    baseCoinArg  = tx.moveCall({ target: '0x2::coin::zero', typeArguments: [XBTC_TYPE] });
  } else {
    baseCoinArg  = inputCoin(tx, ids);
    quoteCoinArg = tx.moveCall({ target: '0x2::coin::zero', typeArguments: [USDC_TYPE] });
  }

  // Market order_amount: QUOTE tokens for bids, BASE tokens for asks.
  const marketAmount = isBid ? scaleQuote(o.price * o.quantity) : scaleQty(o.quantity);
  const ret = tx.moveCall({
    target: `${DEEPTRADE_PKG}::order::create_market_order_input_fee`,
    typeArguments: [XBTC_TYPE, USDC_TYPE],
    arguments: [
      tx.object(TREASURY), tx.object(o.feeManagerId), tx.object(TRADING_FEE_CONFIG),
      tx.object(LOYALTY_PROGRAM), tx.object(XBTC_USDC_POOL), tx.object(o.balanceManagerId),
      baseCoinArg, quoteCoinArg,
      tx.pure.u64(marketAmount), tx.pure.bool(isBid),
      tx.pure.u8(SELF_MATCHING_ALLOWED), tx.pure.u64(BigInt(0)),
      tx.object(CLOCK_ID),
    ],
  });
  // ret = (OrderInfo, Coin<XBTC> leftover, Coin<USDC> leftover) — return leftovers.
  tx.transferObjects([ret[1], ret[2]], o.address);

  if (o.isOpening && o.skillAuthor) injectBotOpenFee(tx, [o.skillAuthor]);
  return tx;
}

// Re-exported scaling for the panel's pre-flight min-size hint.
export const XBTC_MIN_QTY = MIN_SIZE / BASE_SCALAR;

// ─── One-time account setup (browser-signed, no agent needed) ─────────────────
// These let a Web-Bot user create the on-chain accounts the bot trades through,
// without jumping to Client (Agent) Mode. Same txs as LiveTradeDashboard's setup.

const DEEPBOOK_PKG = '0x0e735f8c93a95722efd73521aca7a7652c0bb71ed1daf41b26dfd7d1ff71f748';
export const USDC_TYPE_FULL = USDC_TYPE;

/** xBTC/USDC (DeepTrade) bootstrap: create + share a DeepBook BalanceManager and
 *  a DeepTrade FeeManager. Parse objectChanges after signing to grab the IDs. */
export function buildXbtcSetupTx(address: string): Transaction {
  const tx = new Transaction();
  tx.setSender(address);
  const bm = tx.moveCall({ target: `${DEEPBOOK_PKG}::balance_manager::new` });
  tx.moveCall({
    target: '0x2::transfer::public_share_object',
    typeArguments: [`${DEEPBOOK_PKG}::balance_manager::BalanceManager`],
    arguments: [bm],
  });
  const fm = tx.moveCall({ target: `${DEEPTRADE_PKG}::fee_manager::new` });
  tx.moveCall({ target: `${DEEPTRADE_PKG}::fee_manager::share_fee_manager`, arguments: [fm[0], fm[2]] });
  tx.transferObjects([fm[1]], address);
  return tx;
}

/** Create a SUI/USDC DeepBook margin account and deposit initial USDC collateral. */
export function buildSuiMarginCreateTx(suiClient: any, address: string, collateralUSDC: number): Transaction {
  const db = new DeepBookClient({ client: suiClient, network: 'mainnet', address });
  const tx = new Transaction();
  tx.setSender(address);
  const { manager, initializer } = db.marginManager.newMarginManagerWithInitializer('SUI_USDC')(tx);
  db.marginManager.depositDuringInitialization({ manager, poolKey: 'SUI_USDC', coinType: 'USDC', amount: collateralUSDC })(tx);
  db.marginManager.shareMarginManager('SUI_USDC', manager, initializer)(tx);
  return tx;
}

/** Deposit more USDC collateral into an existing SUI/USDC margin account. */
export function buildSuiDepositTx(suiClient: any, address: string, managerKey: string, amountUSDC: number): Transaction {
  const key = normalizeSuiAddress(managerKey);
  const db = new DeepBookClient({
    client: suiClient, network: 'mainnet', address,
    marginManagers: { [key]: { marginManagerKey: key, address: key, poolKey: 'SUI_USDC' } } as any,
  });
  const tx = new Transaction();
  db.marginManager.depositQuote({ managerKey: key, amount: amountUSDC })(tx);
  return tx;
}
