/**
 * deepbookMarginIndexer — read REAL DeepBook margin orders for a wallet's
 * margin manager, straight from the public DeepBook V3 Indexer (no agent needed).
 *
 * Bot margin trades are placed via `pool_proxy`, so they land on the normal
 * SUI_USDC DeepBook pool and are indexed under the margin manager's INTERNAL
 * BalanceManager id. This lets the Margin Trading panel show the bot's open /
 * filled / canceled orders even while the local agent is offline.
 *
 * Verified live: GET /get_pools → SUI_USDC pool_id, and
 * /margin_manager_states?deepbook_pool_id=<pool> returns position state.
 */

export const DEEPBOOK_INDEXER = 'https://deepbook-indexer.mainnet.mystenlabs.com';

// Canonical mainnet SUI_USDC DeepBook pool (from the indexer's /get_pools — the
// app's old useDeepTrade constant `0xdeaaf02b…` is a different/stale id).
export const SUI_USDC_MARGIN_POOL_ID =
  '0xe05dafb5133bcffb8d59f4e12465dc0e9faeaa05e3e342a08fe135800e3e4407';

export interface MarginOrder {
  order_id: string;
  balance_manager_id: string;
  type: string;            // "buy" | "sell" (maker/taker side)
  current_status: string;  // "Placed" | "Filled" | "Canceled" | "Expired" …
  price: number;
  placed_at: number;       // ms epoch
  last_updated_at: number; // ms epoch
  original_quantity: number;
  filled_quantity: number;
  remaining_quantity: number;
}

/**
 * Orders for a balance manager on SUI_USDC (open + filled + canceled).
 * Pass the margin manager's INTERNAL balance-manager id (see
 * getInternalBalanceManagerId). Returns [] on any error so the UI degrades.
 */
export async function fetchMarginOrders(
  balanceManagerId: string,
  limit = 50,
): Promise<MarginOrder[]> {
  if (!balanceManagerId) return [];
  try {
    const url =
      `${DEEPBOOK_INDEXER}/orders/SUI_USDC/${balanceManagerId}` +
      `?status=Placed,Filled,Canceled&limit=${limit}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}

/**
 * A margin manager wraps an internal BalanceManager; DeepBook indexes the
 * manager's orders under THAT balance manager's id. Read it from the manager
 * object's content. Returns null if unreadable.
 */
export async function getInternalBalanceManagerId(
  suiClient: any,
  marginManagerId: string,
): Promise<string | null> {
  try {
    const o = await suiClient.getObject({ id: marginManagerId, options: { showContent: true } });
    const f = o?.data?.content?.fields;
    return f?.balance_manager?.fields?.id?.id ?? null;
  } catch {
    return null;
  }
}
