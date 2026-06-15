/**
 * publishSkillToMarket — shared "publish a bot to the marketplace" flow.
 *
 * Uploads the skill (SKILL.md + index.js) to Walrus, then calls
 * `suirobo_factory::publish_skill` on the mainnet marketplace package with a
 * price. Used by both the Bot Skill Builder and the "My Bot" panel so the
 * publish logic lives in one place.
 */
import { Transaction } from '@mysten/sui/transactions';
import { generateSkillMd, generateIndexJs, type BotSkillConfig } from '../types/botSkill';

// Mainnet marketplace package (display / buy / publish_skill).
const FACTORY_PKG = '0xb54499501253333c25eadc6fe17def9cb6cfb5af81f265e9f9b0536ec92813bc';
const WALRUS_PUBLISHER = 'https://publisher.walrus-testnet.walrus.space/v1/store?epochs=5';

export async function publishSkillToMarket(
  skill: BotSkillConfig,
  priceInSui: number,
  signAndExecuteAsync: (args: { transaction: Transaction }) => Promise<{ digest: string }>,
): Promise<{ digest: string; blobId: string }> {
  // 1. Upload the skill bundle to Walrus.
  const payload = {
    name: skill.name,
    description: skill.description || 'Bot Skill',
    type: 'bot',
    version: skill.version || '1.0.0',
    source: 'suirobo-factory',
    files: {
      'SKILL.md': generateSkillMd(skill),
      'index.js': generateIndexJs(skill),
    },
  };
  const res = await fetch(WALRUS_PUBLISHER, { method: 'PUT', body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`Walrus upload failed (HTTP ${res.status})`);
  const data = await res.json();
  const blobId: string | undefined = data?.newlyCreated?.blobObject?.blobId || data?.alreadyCertified?.blobId;
  if (!blobId) throw new Error('Walrus did not return a blob ID');

  // 2. Register on-chain in the marketplace with the chosen price.
  const tx = new Transaction();
  tx.moveCall({
    target: `${FACTORY_PKG}::suirobo_factory::publish_skill`,
    arguments: [
      tx.pure.string(skill.name),
      tx.pure.string(skill.description || 'Skill on Walrus'),
      tx.pure.string(blobId),
      tx.pure.string(skill.version || '1.0.0'),
      tx.pure.u64(BigInt(Math.round(priceInSui * 1_000_000_000))),
    ],
  });
  const result = await signAndExecuteAsync({ transaction: tx });
  return { digest: result.digest, blobId };
}
