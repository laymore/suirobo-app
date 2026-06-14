/**
 * Execution Fee Injection Utility
 * Inject 0.05 SUI execution fee into any Programmable Transaction Block (PTB)
 * 
 * Fee split: 0.025 SUI → Marketplace Treasury, 0.025 SUI → Random skill creator
 */
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';

// Contract constants — Mainnet & Testnet
// Auto-detect dựa trên env var hoặc dùng Mainnet mặc định
const NETWORK = (process.env.SUI_NETWORK || 'mainnet').toLowerCase();

const CONTRACTS = {
  mainnet: {
    // v2 (upgraded 2026-06-12): 0.01 SUI fee, deterministic 0.005/0.005 split.
    // Original v1 package (0x888f919f…) is kept on-chain but has the old 0.05
    // SUI / random logic — calls MUST target this upgraded id for the new model.
    FACTORY: '0x02faed0dea5ebb13771a45169ffd11c54b1c77a53c5672b990ef1ca1453e9199',
    MARKETPLACE: '0x8a9b68ec257a515753f13f2b6582aa6e9bc8effe2d6c9731afdadd0411fa4d22',
  },
  testnet: {
    FACTORY: '0x0a75f0b57015f967e3cb336585695a5c2e89f5ec9a74fec711361b9453d71a10',
    MARKETPLACE: '0x2a0cd8d4b09602dcf2dba2b0a254c8f1de4a9ce9e69ad98368339e11b710e823',
  },
};

const FACTORY_PACKAGE = (CONTRACTS as any)[NETWORK]?.FACTORY || CONTRACTS.mainnet.FACTORY;
const MARKETPLACE_OBJ = (CONTRACTS as any)[NETWORK]?.MARKETPLACE || CONTRACTS.mainnet.MARKETPLACE;
const SUI_RANDOM_OBJ = '0x8'; // Sui Random object (system) — same on both networks

// Fee amount: 0.05 SUI = 50,000,000 MIST (LEGACY — generic execution fee, no longer used)
const EXECUTION_FEE_MIST = 50_000_000;

// Bot-skill open fee: 0.01 SUI = 10,000,000 MIST.
// Charged ONCE per OPEN trade (long or short) inside Live Trade Auto Bot.
// Split 50/50 by suirobo_factory::pay_execution_fee (v2) → 0.005 SUI marketplace
// treasury + 0.005 SUI deterministically to the author of the skill in use.
// No randomness. Close trades are FREE.
const BOT_OPEN_FEE_MIST = 10_000_000;

// Tools that require execution fee
export const FEE_REQUIRED_TOOLS = new Set([
  'margin_open_position',
  'margin_close_position',
  'predict_mint',
  'predict_redeem',
  'predict_mint_range',
  'predict_redeem_range',
]);

/**
 * Inject pay_execution_fee moveCall into an existing Transaction.
 *
 * ⚠️ DISABLED — the 0.05 SUI per-trade execution fee was removed by user
 * decision. Trades on margin / predict no longer charge a platform fee;
 * skill authors earn from marketplace skill purchases instead (handled
 * on-chain by suirobo_factory::buy_skill with its 20:80 split).
 *
 * Kept as a no-op so existing call sites continue to compile without
 * needing a sweep across the codebase. Safe to inline-remove call sites
 * during the next cleanup pass.
 */
export function injectExecutionFee(
  _tx: Transaction,
  _creatorAddresses: string[]
): void {
  // intentionally empty — generic per-trade fee removed
  void bcs; // keep import live for the constants export below
}

/**
 * Inject the 0.01 SUI bot-skill open fee into a Live Trade open-position tx.
 * Called ONLY on opens (long/short) — closes are free. The Move contract splits
 * the fee coin 50/50 between marketplace treasury and a random skill author.
 *
 * If creatorAddresses is empty (no installed bot-skill authors), no fee is
 * injected — keeps the tx valid for users running their own un-published skills.
 */
export function injectBotOpenFee(
  tx: Transaction,
  creatorAddresses: string[]
): void {
  // Filter to only well-formed 0x… 32-byte hex addresses (66 chars). Padded
  // shortform addresses from the marketplace UI are normalized to 66 here.
  const cleaned = (creatorAddresses || [])
    .filter(a => typeof a === 'string' && a.startsWith('0x'))
    .map(a => a.length === 66 ? a : a.padEnd(66, '0'))
    .filter(a => /^0x[0-9a-fA-F]{64}$/.test(a));
  if (cleaned.length === 0) return; // no eligible authors → skip fee entirely

  // 0.01 SUI fee. The upgraded contract splits it deterministically: 0.005 to
  // the marketplace treasury + 0.005 to creators[0] (the author of the skill in
  // use). The &Random arg is retained only for signature compatibility.
  const [feeCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(BOT_OPEN_FEE_MIST)]);
  const creatorVec = tx.pure(bcs.vector(bcs.Address).serialize(cleaned));
  tx.moveCall({
    target: `${FACTORY_PACKAGE}::suirobo_factory::pay_execution_fee`,
    arguments: [
      tx.object(MARKETPLACE_OBJ),  // &mut Marketplace
      feeCoin,                      // Coin<SUI> (0.01 SUI)
      creatorVec,                   // vector<address> — author of the skill in use
      tx.object(SUI_RANDOM_OBJ),   // &Random (unused by v2; kept for signature)
    ],
  });
}

/**
 * Check if a tool name requires execution fee
 */
export function requiresExecutionFee(toolName: string): boolean {
  return FEE_REQUIRED_TOOLS.has(toolName);
}

export { EXECUTION_FEE_MIST, BOT_OPEN_FEE_MIST, FACTORY_PACKAGE, MARKETPLACE_OBJ };
