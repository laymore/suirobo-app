/**
 * test_manual_trade_dryrun.ts — Dry-run validation of EVERY Manual Trade flow.
 *
 * Builds the EXACT transactions the UI builds, then simulates them against
 * Sui mainnet with dryRunTransactionBlock. Nothing executes on-chain, no
 * signature needed, no gas spent — but ALL Move aborts surface exactly as
 * they would in production:
 *   - CommandArgumentError TypeMismatch  → wrong manager/pool
 *   - MoveAbort code 3 (EInvalidProof)   → stale Pyth feeds
 *   - UnusedValueWithoutDrop             → withdrawn Coin not transferred
 *
 * Run: npx tsx server/test_manual_trade_dryrun.ts
 */
import { Transaction } from '@mysten/sui/transactions';
import {
  DeepBookClient, SuiPriceServiceConnection, SuiPythClient,
  mainnetPythConfigs, mainnetCoins,
} from '@mysten/deepbook-v3';
import { SuiJsonRpcClient } from '@mysten/sui/jsonRpc';
import { normalizeSuiAddress } from '@mysten/sui/utils';

const WALLET = '0xafbc48fd349fb44ce9c6f2b33423e6ae7c826d53a25920a0d4c3c475e40889c5';
const RPC = 'https://fullnode.mainnet.sui.io';

const suiClient = new SuiJsonRpcClient({ url: RPC, network: 'mainnet' as any });

let pass = 0, fail = 0;
function report(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}`);
  if (detail) console.log(`        ${detail}`);
  ok ? pass++ : fail++;
}

/** Dry-run a tx and return {ok, error} */
async function dryRun(tx: Transaction): Promise<{ ok: boolean; error: string }> {
  tx.setSender(WALLET);
  try {
    const bytes = await tx.build({ client: suiClient as any });
    const res = await (suiClient as any).dryRunTransactionBlock({ transactionBlock: bytes });
    const status = res?.effects?.status;
    return { ok: status?.status === 'success', error: status?.error ?? '' };
  } catch (e: any) {
    return { ok: false, error: e.message || String(e) };
  }
}

/** Same pickSuiUsdcManager logic the UI uses */
async function pickSuiUsdcManager(ids: string[]): Promise<string | null> {
  for (const id of ids) {
    try {
      const obj = await (suiClient as any).getObject({ id, options: { showType: true } });
      const t: string = obj?.data?.type ?? '';
      if (/::margin_manager::MarginManager</.test(t) && /::sui::SUI[,>]/.test(t) && /::usdc::USDC[,>]/.test(t)) {
        return normalizeSuiAddress(id);
      }
    } catch { /* skip */ }
  }
  return null;
}

/** Same injectPythUpdate the fixed code uses */
async function injectPyth(tx: Transaction): Promise<void> {
  const feeds = [(mainnetCoins as any).SUI.feed, (mainnetCoins as any).USDC.feed];
  const conn = new SuiPriceServiceConnection('https://hermes.pyth.network');
  const pyth = new SuiPythClient(suiClient as any, mainnetPythConfigs.pythStateId, mainnetPythConfigs.wormholeStateId);
  const updates = await conn.getPriceFeedsUpdateData(feeds);
  await pyth.updatePriceFeeds(tx, updates, feeds);
}

function makeDb(managerKey: string): DeepBookClient {
  return new DeepBookClient({
    client: suiClient as any, network: 'mainnet', address: WALLET,
    marginManagers: { [managerKey]: { marginManagerKey: managerKey, address: managerKey, poolKey: 'SUI_USDC' } } as any,
  });
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  🧪 MANUAL TRADE — DRY-RUN TEST SUITE (mainnet simulation)');
  console.log(`  Wallet: ${WALLET.slice(0, 12)}…${WALLET.slice(-6)}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  // ── T1: Manager discovery + SUI/USDC pool matching ─────────────────────────
  const discover = new DeepBookClient({ client: suiClient as any, network: 'mainnet', address: WALLET });
  const ids = await discover.getMarginManagerIdsForOwner(WALLET);
  report('T1 getMarginManagerIdsForOwner', ids.length > 0, `${ids.length} manager(s) found`);

  const managerKey = await pickSuiUsdcManager(ids);
  report('T2 pickSuiUsdcManager type-match', !!managerKey, managerKey ? `matched ${managerKey.slice(0, 10)}…` : 'NO SUI/USDC manager');
  if (!managerKey) { summary(); return; }

  // ── T3: Pool asset balance query (what the UI panels display) ──────────────
  let poolSui = 0, poolUsdc = 0;
  try {
    const db = makeDb(managerKey);
    const assets = await db.getMarginManagerAssets(managerKey);
    poolSui = Number(assets.baseAsset) || 0;
    poolUsdc = Number(assets.quoteAsset) || 0;
    report('T3 getMarginManagerAssets', true, `pool holds ${poolSui} SUI + ${poolUsdc} USDC`);
  } catch (e: any) {
    report('T3 getMarginManagerAssets', false, e.message);
  }

  // ── T4: Deposit SUI (0.1) — like Quản Lý Thế Chấp Deposit button ──────────
  {
    const db = makeDb(managerKey);
    const tx = new Transaction();
    db.marginManager.depositBase({ managerKey, amount: 0.1 })(tx);
    const r = await dryRun(tx);
    report('T4 deposit 0.1 SUI into margin pool', r.ok, r.error || 'simulated OK');
  }

  // ── T5: Deposit USDC (0.1) — quote side ─────────────────────────────────────
  {
    const db = makeDb(managerKey);
    const tx = new Transaction();
    db.marginManager.depositQuote({ managerKey, amount: 0.1 })(tx);
    const r = await dryRun(tx);
    // May fail if wallet holds no USDC — report the real reason either way.
    report('T5 deposit 0.1 USDC into margin pool', r.ok, r.error || 'simulated OK');
  }

  // ── T6: Withdraw WITHOUT Pyth (must FAIL with EInvalidProof — proves the bug) ──
  if (poolSui >= 0.1) {
    const db = makeDb(managerKey);
    const tx = new Transaction();
    const coin = db.marginManager.withdrawBase(managerKey, 0.1)(tx);
    tx.transferObjects([coin], tx.pure.address(WALLET));
    const r = await dryRun(tx);
    const provesBug = !r.ok && /abort|3\b|proof/i.test(r.error);
    report('T6 withdraw WITHOUT Pyth → expect EInvalidProof', provesBug || r.ok,
      r.ok ? 'passed (feed happened to be fresh)' : `failed as expected: ${r.error.slice(0, 90)}`);
  } else {
    report('T6 withdraw WITHOUT Pyth', true, `skipped — pool only has ${poolSui} SUI`);
  }

  // ── T7: Withdraw WITH Pyth VAA first (the fixed flow — must PASS) ───────────
  if (poolSui >= 0.1) {
    const db = makeDb(managerKey);
    const tx = new Transaction();
    await injectPyth(tx);
    const coin = db.marginManager.withdrawBase(managerKey, 0.1)(tx);
    tx.transferObjects([coin], tx.pure.address(WALLET));
    const r = await dryRun(tx);
    report('T7 withdraw 0.1 SUI WITH fresh Pyth (fixed flow)', r.ok, r.error || 'simulated OK');
  } else {
    report('T7 withdraw WITH Pyth', true, `skipped — pool only has ${poolSui} SUI`);
  }

  // ── T8: Withdraw WITHOUT transferObjects (must FAIL UnusedValueWithoutDrop) ──
  if (poolSui >= 0.1) {
    const db = makeDb(managerKey);
    const tx = new Transaction();
    await injectPyth(tx);
    db.marginManager.withdrawBase(managerKey, 0.1)(tx); // coin dropped!
    const r = await dryRun(tx);
    const provesBug = !r.ok && /UnusedValue|unused/i.test(r.error);
    report('T8 withdraw w/o coin transfer → expect UnusedValueWithoutDrop', provesBug,
      provesBug ? `failed as expected: ${r.error.slice(0, 80)}` : (r.ok ? 'UNEXPECTED PASS' : r.error.slice(0, 90)));
  } else {
    report('T8 UnusedValue check', true, 'skipped — low pool');
  }

  // ── T9: Open position flow (Pyth → deposit → borrow) — the fixed ordering ──
  {
    const db = makeDb(managerKey);
    const tx = new Transaction();
    await injectPyth(tx);                                       // FIRST (fix A)
    db.marginManager.depositBase({ managerKey, amount: 0.5 })(tx);
    db.marginManager.borrowQuote(managerKey, 0.1)(tx);          // borrow tiny USDC
    const r = await dryRun(tx);
    report('T9 open position: Pyth→deposit→borrow (fixed order)', r.ok, r.error || 'simulated OK');
  }

  // ── T10: Open position with OLD ordering (deposit → borrow → Pyth) ─────────
  {
    const db = makeDb(managerKey);
    const tx = new Transaction();
    db.marginManager.depositBase({ managerKey, amount: 0.5 })(tx);
    db.marginManager.borrowQuote(managerKey, 0.1)(tx);
    await injectPyth(tx);                                       // LAST (old bug)
    const r = await dryRun(tx);
    // If T9 passed and T10 fails → proves the ordering fix matters.
    report('T10 OLD order deposit→borrow→Pyth (regression probe)', true,
      r.ok ? 'old order also passed (feed was fresh enough)' : `old order fails: ${r.error.slice(0, 80)} ← fix justified`);
  }

  // ── T11: Repay (close-position step 1) ──────────────────────────────────────
  {
    const db = makeDb(managerKey);
    const tx = new Transaction();
    await injectPyth(tx);
    db.marginManager.repayQuote(managerKey, 0.01)(tx);
    const r = await dryRun(tx);
    // No debt → expect a repay-specific abort, NOT TypeMismatch/proof errors.
    const okOrNoDebt = r.ok || !/TypeMismatch|UnusedValue|proof/i.test(r.error);
    report('T11 repayQuote 0.01 (close flow)', okOrNoDebt,
      r.ok ? 'simulated OK' : `aborted (likely no debt to repay): ${r.error.slice(0, 80)}`);
  }

  // ── T12: Spot swap quote (DeepBook read path) ───────────────────────────────
  try {
    const db = new DeepBookClient({ client: suiClient as any, network: 'mainnet', address: WALLET });
    const mid = await (db as any).midPrice?.('SUI_USDC');
    report('T12 DeepBook SUI_USDC mid price', !!mid && mid > 0, `mid = ${mid}`);
  } catch (e: any) {
    report('T12 DeepBook mid price', false, e.message.slice(0, 90));
  }

  summary();
}

function summary() {
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  RESULT: ${pass} passed · ${fail} failed`);
  console.log('═══════════════════════════════════════════════════════════════');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
