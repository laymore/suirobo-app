/**
 * Publish SUI Bot Skills lên Sui Mainnet Marketplace
 * Chạy: npx ts-node server/publish_bot_skills.ts
 *
 * Description format: [BOT|profit=X|maxdd=X|wr=X|pf=X|trades=X|tf=X|lev=X] <text>
 * Frontend sẽ parse prefix này để hiển thị stats riêng cho bot card.
 */
import { execSync } from 'child_process';

const PACKAGE_ID = '0xb54499501253333c25eadc6fe17def9cb6cfb5af81f265e9f9b0536ec92813bc';

const BOT_SKILLS = [
  {
    name: 'sui_alpha_m30',
    // [BOT|...] prefix → parsed as BotStats in SkillMarketplace.tsx
    description: '[BOT|profit=114.5|maxdd=12.7|wr=12.5|pf=2.86|trades=56|tf=M30|lev=5] SUI/USDC RSI+MACD M30 · Every month profitable Jan-Jun 2025 · Researched from 10,080 combos',
    blobId: 'walrus-sui-alpha-m30-v1',
    price: 0, // free — let community test it
  },
  {
    name: 'sui_ema_h1',
    description: '[BOT|profit=69.1|maxdd=17.7|wr=17.8|pf=2.52|trades=181|tf=H1|lev=2] SUI/USDC EMA Cross H1 · Conservative 2x leverage · +69.1% in 6m · Stable across all months',
    blobId: 'walrus-sui-ema-h1-v1',
    price: 0,
  },
  {
    name: 'sui_supertrend_m5',
    description: '[BOT|profit=1594.5|maxdd=15.0|wr=60.5|pf=3.17|trades=577|tf=M5|lev=5] SUI/USDT Supertrend Holy Grail M5 · Pullback & Tight Stoploss · Margin x5 Scalping',
    blobId: 'bXFZjXS946alX7zlJfaSYjmM6VmoznI2YUiMO0x_j1A',
    price: 0,
  },
];

function publishAll() {
  console.log('🤖 Publishing SUI Bot Skills to Mainnet Marketplace...\n');
  for (const s of BOT_SKILLS) {
    console.log(`📦 Publishing "${s.name}"...`);
    console.log(`   Description: ${s.description.substring(0, 80)}...`);
    try {
      const cmd = [
        'sui client call',
        `--package ${PACKAGE_ID}`,
        '--module suirobo_factory',
        '--function publish_skill',
        `--args "${s.name}" "${s.description}" "${s.blobId}" "1.0.0" ${s.price}`,
        '--gas-budget 50000000',
      ].join(' ');

      const out = execSync(cmd, { encoding: 'utf-8' });

      // Extract skill object ID from output
      const idMatch = out.match(/Created Objects:[\s\S]*?ID: (0x[a-f0-9]{64})/);
      const skillId = idMatch?.[1] ?? 'unknown';
      console.log(`   ✅ Published! Skill Object ID: ${skillId}`);
    } catch (e: any) {
      console.error(`   ❌ Failed: ${(e.message ?? e).toString().substring(0, 200)}`);
    }
    console.log();
  }
  console.log('Done!');
}

publishAll();
