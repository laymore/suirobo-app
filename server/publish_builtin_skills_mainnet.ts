import { execSync } from 'child_process';

const PACKAGE_ID = '0x888f919f64154138f6e21a2341515f68d472be54c45eb9c70e628cfb5458958a';
const MARKET_ID = '0x8a9b68ec257a515753f13f2b6582aa6e9bc8effe2d6c9731afdadd0411fa4d22';

const BUILTIN_SKILLS = [
  {
    name: 'auto_sl_tp_manager',
    description: 'Smart automatic take-profit & stop-loss. Self-adapts to actual asset volatility.',
    type: 'guard',
    price: 0,
    blobId: 'walrus-auto-sl-tp-blob'
  },
  {
    name: 'deepbook_data_skill',
    description: 'Scan SUI/USDC liquidity depth and calculate spread to suggest optimal trading strategy.',
    type: 'scanner',
    price: 1500000000,
    blobId: 'walrus-deepbook-data-blob'
  },
  {
    name: 'margin_analyzer',
    description: 'Evaluate leverage risk, warn on margin position liquidation, and calculate safe liquidation price.',
    type: 'signal',
    price: 500000000,
    blobId: 'walrus-margin-analyzer-blob'
  },
  {
    name: 'margin_entry_strategist',
    description: 'Find optimal entry points by analyzing supply/demand on DeepBook V3 limit order book.',
    type: 'signal',
    price: 2000000000,
    blobId: 'walrus-margin-entry-blob'
  },
  {
    name: 'margin_portfolio_guardian',
    description: 'Monitor all your Margin accounts and auto-rebalance collateral to prevent liquidation.',
    type: 'guard',
    price: 3500000000,
    blobId: 'walrus-portfolio-guardian-blob'
  },
  {
    name: 'margin_risk_guard',
    description: 'Smart leverage insurance. Auto-suggests reducing leverage or adding collateral when market drops sharply.',
    type: 'guard',
    price: 1000000000,
    blobId: 'walrus-risk-guard-blob'
  },
  {
    name: 'predict_analyzer',
    description: 'Evaluate price volatility chains to predict winning opportunities in Binary Options cycles.',
    type: 'signal',
    price: 0,
    blobId: 'walrus-predict-analyzer-blob'
  },
  {
    name: 'predict_multi_asset_allocator',
    description: 'Optimal multi-asset capital allocation using Kelly Criterion to maximize long-term account growth.',
    type: 'custom',
    price: 2500000000,
    blobId: 'walrus-multi-asset-blob'
  },
  {
    name: 'predict_opportunity_scanner',
    description: 'Auto-scan price discrepancies between Spot and Predict using Black-Scholes to find mispricing.',
    type: 'scanner',
    price: 3000000000,
    blobId: 'walrus-opportunity-scanner-blob'
  },
  {
    name: 'predict_position_monitor',
    description: 'Real-time P&L monitoring of Predict positions, auto-suggests early option sell-back to recover capital.',
    type: 'scanner',
    price: 1200000000,
    blobId: 'walrus-position-monitor-blob'
  },
  {
    name: 'token_analyzer',
    description: 'Analyze advanced momentum indicators (RSI, MACD, Volume) of SUI, CETUS, DEEP tokens on-chain.',
    type: 'signal',
    price: 0,
    blobId: 'walrus-token-analyzer-blob'
  }
];

function publishAll() {
  console.log("Starting publishing to Mainnet...");
  for (const s of BUILTIN_SKILLS) {
    console.log(`Publishing ${s.name}...`);
    try {
      const cmd = `sui client call --package ${PACKAGE_ID} --module suirobo_factory --function publish_skill --args "${s.name}" "${s.description}" "${s.blobId}" "1.0.0" ${s.price} --gas-budget 50000000`;
      const out = execSync(cmd, { encoding: 'utf-8' });
      console.log(`✅ Success: ${s.name}`);
    } catch (e) {
      console.error(`❌ Failed: ${s.name}`, e.message);
    }
  }
  console.log("All done!");
}

publishAll();
