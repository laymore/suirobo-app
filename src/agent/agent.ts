/**
 * SUIROBO ADK TypeScript Agent
 * 
 * Chạy local với Gemma qua Ollama hoặc Gemini API Cloud.
 * Command:
 *   npx adk web src/agent/agent.ts        ← Web UI (:8000)
 *   npx adk run src/agent/agent.ts        ← CLI mode
 *
 * Yêu cầu: Node.js 18+, GEMINI_API_KEY hoặc Ollama đang chạy.
 */
import { LlmAgent } from '@google/adk';

// Import tools
import { getSuiBalance, getAllBalances, getTokenPrice, getRecentTransactions } from './tools/sui.js';
import {
  getSwapQuote,
  prepareLimitOrder,
  prepareReduceOnlyOrder,
  prepareBinaryPosition,
  getPoolInfo,
} from './tools/deeptrade.js';
import { readWalrusBlob, listSkills, getSkillDetail, getAgentIdentity } from './tools/walrus.js';

// Fully featured DeFi tools
import { marginTools } from './tools/margin.js';
import { predictTools } from './tools/predict.js';
import { deepbookV3Tools } from './tools/deepbookV3.js';

// ── Model Configuration ───────────────────────────────────────────────────────
const MODEL = process.env.USE_OLLAMA === 'true'
  ? 'ollama/gemma3'
  : 'gemini-2.0-flash';

// ── Agent Instructions ────────────────────────────────────────────────────────
const SUIROBO_INSTRUCTION = `
You are SUIROBO — an intelligent AI assistant specialized in the Sui blockchain and DeFi trading.

## IDENTITY
- Name: "SuiRobo" by Team Autobots
- Language: reply in the SAME language the user writes. Default to English when ambiguous.
- Style: friendly, professional, concise. Use fitting emoji sparingly.

## CAPABILITIES
1. **Wallet & assets**: SUI/WAL/DEEP balances, realtime token prices
2. **DeepBook V3 DeFi (Spot, Margin, Predict)**: advise on and prepare Limit, Reduce-Only and Binary Options orders; manage Margin pools, Vault, BalanceManager (deposit/withdraw).
3. **Walrus storage**: read and look up decentralized data
4. **Skills**: list and load skills from the Skill Registry

## IMPORTANT RULES
- ⚠️ Warn about liquidation risk on Margin orders, and total-loss risk on Predict binaries.
- For Margin and Predict, always remind the user to deposit/supply into the Margin Pool or Predict Vault before placing orders or borrowing.
- Before placing any order: ALWAYS call a tool to check pool or oracle state.
- Explain each step clearly, especially for financial trades.
- When the user executes an order, provide the prepared PTB so they can sign it easily.
`.trim();

// ── Export rootAgent ──────────────────────────────────────────────────────────
export const rootAgent = new LlmAgent({
  name: 'suirobo_ts_agent',
  model: MODEL,
  description: 'SUIROBO — AI agent managing Sui wallet, DeFi trading on DeepBook V3 (Spot, Margin, Predict), integrated with Walrus.',
  instruction: SUIROBO_INSTRUCTION,
  tools: [
    // Sui blockchain tools
    getSuiBalance,
    getAllBalances,
    getTokenPrice,
    getRecentTransactions,
    
    // Deeptrade mock/generic tools
    getSwapQuote,
    prepareLimitOrder,
    prepareReduceOnlyOrder,
    prepareBinaryPosition,
    getPoolInfo,
    
    // Core DeFi Implementation Tools (Margin, Predict, Spot)
    ...marginTools,
    ...predictTools,
    ...deepbookV3Tools,

    // Walrus & Skill tools
    readWalrusBlob,
    listSkills,
    getSkillDetail,
    getAgentIdentity,
  ],
});
