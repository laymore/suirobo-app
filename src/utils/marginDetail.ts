/**
 * marginDetail — read the REAL state of a DeepBook margin manager.
 *
 * Why this exists: the SDK's `getMarginManagerAssets()` (calculateAssets)
 * returns the TOTAL position valuation — including funds locked as collateral
 * against outstanding borrows. Displaying that as "balance" misleads users
 * into withdrawing amounts that abort on-chain with EBalanceTooLow (code 3),
 * because `withdraw` can only pull from the manager's internal BalanceManager
 * bag (the actually-liquid part).
 *
 * This helper reads the manager object directly and returns BOTH numbers:
 *   - withdrawable: per-coin liquid balance sitting in the internal bag
 *   - debt:         outstanding borrowed shares (base/quote)
 *   - totalAssets:  the calculateAssets valuation (for reference)
 */

export interface MarginManagerDetail {
  /** Liquid, withdrawable balances from the internal BalanceManager bag. */
  withdrawableSui: number;
  withdrawableUsdc: number;
  /** Outstanding borrow shares (raw, > 0 means there IS debt). */
  debtBaseShares: bigint;
  debtQuoteShares: bigint;
  /** Total position valuation incl. locked collateral (calculateAssets). */
  totalSui: number;
  totalUsdc: number;
}

const SUI_DECIMALS = 9;
const USDC_DECIMALS = 6;

/**
 * Pick the BEST SUI/USDC margin manager among all the wallet's managers.
 *
 * A wallet accumulates managers over time (one per create click) and may own
 * several for the SAME pool. Naively picking the first type-match grabs stale
 * accounts (e.g. an old one with locked collateral + dust debt) while the
 * user's freshly-funded account sits unused — exactly the "I deposited 10 USDC
 * but the UI shows 1 SUI and debt" bug.
 *
 * Selection: highest liquid balance (USDC + SUI), tie-broken by no-debt first,
 * then highest total. Returns null when no SUI/USDC manager exists.
 */
export async function pickBestSuiUsdcManager(
  suiClient: any,
  managerIds: string[],
): Promise<string | null> {
  type Cand = { id: string; liquid: number; total: number; hasDebt: boolean };
  const cands: Cand[] = [];

  for (const rawId of managerIds) {
    try {
      const obj = await suiClient.getObject({ id: rawId, options: { showType: true } });
      const t: string = obj?.data?.type ?? '';
      if (!/::margin_manager::MarginManager</.test(t) || !/::sui::SUI[,>]/.test(t) || !/::usdc::USDC[,>]/.test(t)) continue;
      const id = rawId;
      // Detail without a dbClient: read bag + debt directly (cheap — 2-3 RPC)
      const d = await getMarginManagerDetail(suiClient, null, id);
      cands.push({
        id,
        liquid: d.withdrawableUsdc + d.withdrawableSui,   // rough but monotone — enough to rank
        total:  d.totalUsdc + d.totalSui,
        hasDebt: d.debtBaseShares > 0n || d.debtQuoteShares > 0n,
      });
    } catch { /* skip unreadable */ }
  }
  if (!cands.length) return null;

  cands.sort((a, b) =>
    (b.liquid - a.liquid) ||                       // most liquid first
    (Number(a.hasDebt) - Number(b.hasDebt)) ||     // no-debt preferred
    (b.total - a.total)                            // then highest total
  );
  return cands[0].id;
}

/**
 * @param suiClient   SuiJsonRpcClient (any client with getObject / getDynamicFields)
 * @param dbClient    DeepBookClient already initialized WITH the marginManagers map
 *                    (pass null to skip the calculateAssets total — bag/debt still read)
 * @param managerId   margin manager object id
 */
export async function getMarginManagerDetail(
  suiClient: any,
  dbClient: any,
  managerId: string,
): Promise<MarginManagerDetail> {
  const detail: MarginManagerDetail = {
    withdrawableSui: 0, withdrawableUsdc: 0,
    debtBaseShares: 0n, debtQuoteShares: 0n,
    totalSui: 0, totalUsdc: 0,
  };

  // 1. Manager object → debt shares + internal bag id
  let bagId: string | null = null;
  try {
    const obj = await suiClient.getObject({ id: managerId, options: { showContent: true } });
    const f = obj?.data?.content?.fields;
    detail.debtBaseShares  = BigInt(f?.borrowed_base_shares  ?? 0);
    detail.debtQuoteShares = BigInt(f?.borrowed_quote_shares ?? 0);
    bagId = f?.balance_manager?.fields?.balances?.fields?.id?.id ?? null;
  } catch { /* leave defaults */ }

  // 2. Iterate the bag's dynamic fields → per-coin liquid balances
  if (bagId) {
    try {
      const fields = await suiClient.getDynamicFields({ parentId: bagId });
      for (const df of fields?.data ?? []) {
        try {
          const entry = await suiClient.getObject({ id: df.objectId, options: { showContent: true, showType: true } });
          const t: string = entry?.data?.type ?? '';
          const raw = BigInt(entry?.data?.content?.fields?.value ?? 0);
          if (/::sui::SUI/.test(t))       detail.withdrawableSui  = Number(raw) / 10 ** SUI_DECIMALS;
          else if (/::usdc::USDC/.test(t)) detail.withdrawableUsdc = Number(raw) / 10 ** USDC_DECIMALS;
        } catch { /* skip entry */ }
      }
    } catch { /* bag unreadable → withdrawable stays 0 */ }
  }

  // 3. Total valuation for reference (may exceed withdrawable when collateral is locked).
  //    Skipped when dbClient is null (ranking-only callers) — falls back to liquid.
  if (dbClient) {
    try {
      const assets = await dbClient.getMarginManagerAssets(managerId);
      detail.totalSui  = Number(assets.baseAsset)  || 0;
      detail.totalUsdc = Number(assets.quoteAsset) || 0;
    } catch { /* leave 0 */ }
  } else {
    detail.totalSui  = detail.withdrawableSui;
    detail.totalUsdc = detail.withdrawableUsdc;
  }

  return detail;
}
