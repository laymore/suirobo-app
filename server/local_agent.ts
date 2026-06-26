import 'dotenv/config';          // Load .env tự động
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { spawn } from 'child_process';
import { pathToFileURL } from 'url';
// @ts-ignore — selfsigned không có type
import * as selfsignedMod from 'selfsigned';
import { LlmAgent, Runner, InMemorySessionService } from '@google/adk';
import { deepbookV3Tools } from '../src/agent/tools/deepbookV3.js';
import { marginTools } from '../src/agent/tools/margin.js';
import { predictTools } from '../src/agent/tools/predict.js';
import { deeptradeXbtcTools } from '../src/agent/tools/deeptrade_xbtc.js';
import { agentSkills } from '../src/agent/skills/index.js';
import { getSuiBalance, getAllBalances, getTokenPrice, getRecentTransactions, sendToken } from '../src/agent/tools/sui.js';
import { liveBotControlTools } from '../src/agent/tools/liveBotControl.js';
import { readWalrusBlob, listSkills, getSkillDetail } from '../src/agent/tools/walrus.js';
import { SkillToolset, FunctionTool } from '@google/adk';
import { z } from 'zod';
import { memwalService, MEMWAL_EMPTY } from './memwal_service.js';

import { liveBotController } from './live_trade_agent.js';

const memwalTools = [
  new FunctionTool({
    name: 'memorize_info',
    description: 'Store important info into decentralized long-term memory (Walrus Memory) for later use. Call only when user asks Agent to "remember" something or there is important strategic info to retain (e.g. preferences, capital amount, trading strategies). The namespace is set automatically from the current user — do NOT pass it.',
    parameters: z.object({
      info: z.string().describe('Text describing info to remember. More detail is better.')
    }),
    // NOTE: handler MUST be the `execute` property (ADK ignores a 2nd positional arg).
    execute: async ({ info }: any) => {
      return await memwalService.memorize(info);
    }
  }),
  new FunctionTool({
    name: 'recall_memory',
    description: 'Search and retrieve info from decentralized long-term memory. Use when you need to recall rules, preferences, strategies, or info the user previously asked to remember. The namespace is set automatically — do NOT pass it.',
    parameters: z.object({
      query: z.string().describe('Short search query (e.g. "What are my trading preferences?")')
    }),
    execute: async ({ query }: any) => {
      return await memwalService.recall(query);
    }
  }),
  new FunctionTool({
    name: 'sync_memory',
    description: 'Synchronize / rebuild the long-term memory namespace (restore from Walrus, or report local memory count). Use when the user asks to sync, restore, or check how many memories are stored.',
    parameters: z.object({}),
    execute: async () => {
      const r = await memwalService.sync();
      return r.message;
    }
  })
];

// Global Registry for dynamic skills to access ADK and Zod without require()
(globalThis as any).__SUIROBO_REGISTRY__ = {
  FunctionTool: FunctionTool,
  z: z
};

const app = express();

// ── PNA Header (Chrome v98+ requires for HTTPS → localhost fetch) ───────────
// PHẢI đặt TRƯỚC cors() vì cors() tự handle OPTIONS preflight
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  next();
});

// ── CORS — only trusted origins (the agent signs real trades on this machine) ──
// Allow localhost (desktop + dev), the Walrus portal domains (the deployed web
// app talks to the user's local agent), and no-origin (same-origin / curl /
// desktop file://). A named malicious domain — incl. DNS-rebinding — is rejected.
const originAllowed = (origin?: string): boolean => {
  if (!origin || origin === 'null') return true;
  try {
    const h = new URL(origin).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.wal.app') || h.endsWith('.walrus.site');
  } catch { return false; }
};
app.use(cors({
  origin: (o, cb) => cb(null, originAllowed(o)),
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Wallet-Address'],
  maxAge: 86400, // Cache preflight 24h
}));

app.use(express.json({ limit: '10mb' }));

const SYSTEM_PROMPT = `You are SUIROBO — an expert AI assistant for DeFi on Sui Blockchain, focused on DeepBook V3.

## Networks:
- **Spot (DeepBook V3)**: Mainnet — real trades
- **Margin & Predict**: Testnet — safe testing

## Core Capabilities:
1. **DeepBook V3 Spot**: Pool info, swap quote, limit/market order, cancel order.
2. **DeepBook Margin**: Margin health, open/close position, list positions, adjust collateral.
3. **DeepBook Predict**: Oracle price, open/close binary, list positions.
4. **Auto Risk Management**: Risk warnings, automatic SL/TP.

## MANDATORY Rules:
- **Language**: Reply in the SAME language the user used. If user writes English → reply English. If Vietnamese → reply Vietnamese. Default English when ambiguous.
- Keep replies concise and precise.
- When a tool fits the request, ALWAYS call the tool — never guess.
- Every trade command returns serializedTx (Sui PTB base64) for the frontend to sign.
- Use proper crypto terminology (e.g. "swap", "long position", "stop loss", not translations).`;

const FACTORY_PROMPT = `You are SUIROBO Skill Factory — an expert code generator for new trading skills.
Use the \`create_skill_draft\` tool to save skill source code to the draft folder.

## Required Skill Structure:

### File 1: SKILL.md
\`\`\`
---
name: [skill_name_snake_case]
description: [short description]
version: 1.0.0
type: signal | guard | scanner
tags: ["tag1", "tag2"]
---
# Usage Guide
[Details]
\`\`\`

### File 2: index.js (MUST use FunctionTool from Registry)
\`\`\`javascript
const { FunctionTool, z } = globalThis.__SUIROBO_REGISTRY__;

export const skill = new FunctionTool({
  name: 'skill_name',
  description: 'What this skill does',
  parameters: z.object({
    targetAsset: z.string().describe('Target asset (e.g. SUI/USDC)'),
    // additional params...
  }),
  // IMPORTANT: the handler MUST be the \`execute\` property (NOT a 2nd argument).
  execute: async function skill_name(params) {
    // Real logic:
    // - Fetch price: const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd');
    // - Compute indicators
    // - Return structured result
    return { status: 'success', data: params };
  }
});

export default skill;
\`\`\`

## Existing Skills & Tools in DeepTrade Agent (avoid duplication):
- **margin_risk_guard**: Health Factor check, Liquidation warnings, safe Leverage suggestions
- **margin_entry_strategist**: Smart Margin entry points with auto SL/TP
- **margin_portfolio_guardian**: Continuous Margin portfolio monitoring
- **predict_opportunity_scanner**: Black-Scholes scanner for Binary Options
- **predict_position_monitor**: Real-time Predict position P&L tracking
- **predict_multi_asset_allocator**: Kelly Criterion multi-asset allocation
- **Trading tools**: get_pool_info, swap_quote, limit_order, market_order, margin_open_position, get_oracle_price, predict_open_binary
- **Memory**: memorize_info, recall_memory (Walrus Memory read/write)

## Rules:
1. **Language**: Reply in the SAME language the user used. Default English.
2. NEW skills should add logic that existing skills DON'T have — no duplication.
3. Can call fetch() to get price data, on-chain data, external APIs.
4. ALWAYS return a structured JSON object with clear fields.
5. Call \`create_skill_draft\` IMMEDIATELY after writing — don't explain at length.`;

const factoryTools = [
  new FunctionTool({
    name: 'create_skill_draft',
    description: 'Save skill source code into the draft folder (draft_skills).',
    parameters: z.object({
      name: z.string().describe('Skill name (lowercase, snake_case)'),
      description: z.string().describe('Skill description'),
      skill_md: z.string().describe('SKILL.md content (including YAML metadata)'),
      index_js: z.string().describe('index.js content (must export FunctionTool object)')
    }),
    execute: async function create_skill_draft(args: any) {
      const { name, description, skill_md, index_js } = args;
      const safeName = name.replace(/[^a-z0-9_]/g, '');
      const draftDir = path.join(process.cwd(), '.local_skills', 'draft_skills', safeName);
      if (!fs.existsSync(draftDir)) {
        fs.mkdirSync(draftDir, { recursive: true });
      }
      fs.writeFileSync(path.join(draftDir, 'SKILL.md'), skill_md);
      fs.writeFileSync(path.join(draftDir, 'index.js'), index_js);
      return { success: true, message: `Skill "${safeName}" saved to draft folder successfully!` };
    }
  })
];

// Khi đóng gói thành exe, SUIROBO_DATA_DIR sẽ trỏ %LOCALAPPDATA%\Suirobo\data
// Khi chạy dev (npm run agent), fallback về cwd
const DATA_ROOT = process.env.SUIROBO_DATA_DIR || process.cwd();
const localSkillsDir = path.join(DATA_ROOT, '.local_skills');
if (!fs.existsSync(localSkillsDir)) fs.mkdirSync(localSkillsDir, { recursive: true });

const builtinSuiSkillsDir = path.join(process.cwd(), 'server', 'sui_official_skills');

const skillToolset = new SkillToolset({ dirs: [localSkillsDir, builtinSuiSkillsDir] });
const suiTools = [getSuiBalance, getAllBalances, getTokenPrice, getRecentTransactions, sendToken];
const walrusTools = [readWalrusBlob, listSkills, getSkillDetail];

// ─── Manual-mode tool allowlist ───────────────────────────────────────────────
// When the AI Assistant runs in "Manual sign" mode it can only:
//   • read/scan data, get prices, list orders, check balances, query history
//   • send a token to another wallet (the single write action)
// Anything that opens leverage positions, mints predict options, or places
// DeepBook orders is reserved for "Autonomous" mode.
const MANUAL_MODE_TOOL_ALLOWLIST = new Set<string>([
  // Sui chain — info + the one allowed write
  'get_sui_balance', 'get_all_balances', 'get_token_price', 'get_recent_transactions',
  'send_token',
  // DeepBook V3 — general market info only (no swap quotes, no order book queries
  // — user does any trade-prep manually in Manual Trade view)
  'get_pool_info',
  // Margin — health check only
  'get_margin_health',
  // Predict — read-only stats (NO position list — user manages positions manually)
  'get_oracle_price', 'get_vault_stats', 'predict_get_payout',
  // DeepTrade xBTC — market data only
  'deeptrade_xbtc_pool_info',
  // Walrus / registry — read-only
  'read_walrus_blob', 'list_skills', 'get_skill_detail', 'get_agent_identity',
  // Memory — always allowed
  'memorize', 'recall', 'memwal_remember', 'memwal_recall', 'memwal_forget',
]);
function filterToolsForMode(tools: any[], mode: 'manual' | 'autonomous'): any[] {
  if (mode === 'autonomous') return tools;
  return tools.filter(t => MANUAL_MODE_TOOL_ALLOWLIST.has(t.name) || /_analyz(er|e)$|_scanner$|_monitor$|_guardian$|_strategist$|_guard$|_allocator$/.test(t.name));
}

function dedupeTools(tools: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const t of tools) {
    const name = t?.name;
    if (!name) { out.push(t); continue; }
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(t);
  }
  return out;
}

// --- INJECT SUI OFFICIAL KNOWLEDGE SKILLS ---
const suiOfficialTools: any[] = [];
if (fs.existsSync(builtinSuiSkillsDir)) {
  const dirs = fs.readdirSync(builtinSuiSkillsDir, { withFileTypes: true });
  for (const dirent of dirs) {
    if (dirent.isDirectory()) {
      const mdPath = path.join(builtinSuiSkillsDir, dirent.name, 'SKILL.md');
      if (fs.existsSync(mdPath)) {
        const mdContent = fs.readFileSync(mdPath, 'utf8');
        const nameMatch = mdContent.match(/^name:\s*(.+)$/m);
        const descMatch = mdContent.match(/^description:\s*(.+)$/m);
        const rawName = nameMatch ? nameMatch[1].trim() : dirent.name;
        // Ensure name is compatible with Gemini/DeepSeek (a-zA-Z0-9_-)
        const safeName = rawName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
        const safeDesc = descMatch ? descMatch[1].trim() : `Read official Sui documentation about ${rawName}`;

        const tool = new FunctionTool({
          name: safeName,
          description: safeDesc,
          parameters: z.object({
            query: z.string().optional().describe('Specific detail you are looking for (optional)')
          }),
          execute: async () => {
            return {
              status: 'success',
              content: mdContent
            };
          }
        });
        suiOfficialTools.push(tool);
        MANUAL_MODE_TOOL_ALLOWLIST.add(safeName); // Enable in manual mode
      }
    }
  }
}

let allTools = dedupeTools([...deepbookV3Tools, ...marginTools, ...predictTools, ...deeptradeXbtcTools, ...suiTools, ...walrusTools, ...agentSkills, ...memwalTools, ...liveBotControlTools, ...skillToolset.tools, ...suiOfficialTools]);
let toolsVersion = 0; // To track when to rebuild DeepSeek config and Gemini Agent

const globalSessionService = new InMemorySessionService();
// We cache runners per session for Gemini
const geminiRunners = new Map<string, Runner>();

// In-memory chat history for DeepSeek
const deepseekSessions: Record<string, any[]> = {};

import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Recursively sanitize JSON Schema để compatible với OpenAI/DeepSeek strict validator:
 *  - exclusiveMinimum/Maximum: boolean → number (chuyển từ Draft 4 sang Draft 7+ format)
 *  - Remove các field non-standard ($schema, additionalProperties tại root nếu false)
 */
function sanitizeSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);

  const out: any = { ...schema };

  // Fix exclusiveMinimum/Maximum boolean → number
  if (out.exclusiveMinimum === true && typeof out.minimum === 'number') {
    delete out.exclusiveMinimum;
    out.exclusiveMinimum = out.minimum;
    delete out.minimum;
  } else if (out.exclusiveMinimum === false) {
    delete out.exclusiveMinimum;
  }
  if (out.exclusiveMaximum === true && typeof out.maximum === 'number') {
    delete out.exclusiveMaximum;
    out.exclusiveMaximum = out.maximum;
    delete out.maximum;
  } else if (out.exclusiveMaximum === false) {
    delete out.exclusiveMaximum;
  }

  // Remove $schema field (non-standard cho function schemas)
  delete out.$schema;

  // Recurse into properties / items
  if (out.properties) {
    out.properties = Object.fromEntries(
      Object.entries(out.properties).map(([k, v]) => [k, sanitizeSchema(v)])
    );
  }
  if (out.items) out.items = sanitizeSchema(out.items);
  if (out.anyOf) out.anyOf = out.anyOf.map(sanitizeSchema);
  if (out.oneOf) out.oneOf = out.oneOf.map(sanitizeSchema);
  if (out.allOf) out.allOf = out.allOf.map(sanitizeSchema);

  return out;
}

// Convert ADK tool to OpenAI format for DeepSeek
let deepseekToolsConfig = allTools.map((t: any) => {
  const rawSchema: any = t.parameters ? zodToJsonSchema(t.parameters, { target: 'openApi3' }) : { type: 'object', properties: {} };
  const jsonSchema = sanitizeSchema(rawSchema);
  return {
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: jsonSchema.type || 'object',
        properties: jsonSchema.properties || {},
        required: jsonSchema.required || []
      },
    }
  };
});

function updateDeepSeekTools() {
  deepseekToolsConfig = allTools.map((t: any) => {
    const jsonSchema: any = sanitizeSchema(t.parameters ? zodToJsonSchema(t.parameters, { target: 'openApi3' }) : { type: 'object', properties: {} });
    return {
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: jsonSchema.type || 'object',
          properties: jsonSchema.properties || {},
          required: jsonSchema.required || []
        },
      }
    };
  });
}

app.post('/api/skills/load', async (req, res) => {
  try {
    const { code, password } = req.body;
    if (!password) return res.status(403).json({ error: 'Missing decryption key (Seal Password)' });

    // Expecting `code` to be a JSON string of { name, files: { 'SKILL.md': ..., 'index.js': ... } }
    const payload = JSON.parse(code);
    const skillName = payload.name;
    const skillDir = path.join(localSkillsDir, skillName);
    
    if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true });
    
    for (const [filename, content] of Object.entries(payload.files)) {
      fs.writeFileSync(path.join(skillDir, filename), content as string);
    }

    // Safe dynamic import instead of eval() — loads ESM module via file URL
    const indexPath = path.join(skillDir, 'index.js');
    if (fs.existsSync(indexPath)) {
      try {
        // Use cache-busting query param so re-loads pick up changes
        const moduleUrl = pathToFileURL(indexPath).href + `?t=${Date.now()}`;
        const skillModule = await import(moduleUrl);

        // Convention: module exports `default` or named `skill` as the FunctionTool
        const newSkill = skillModule.default || skillModule.skill || (globalThis as any).__NEW_SKILL__;

        if (newSkill && newSkill.name && !allTools.find(t => t.name === newSkill.name)) {
          allTools.push(newSkill);
          console.log(`[Dynamic Loader] Successfully injected tool function: ${newSkill.name}`);
        }
      } catch (importErr: any) {
        console.warn(`[Dynamic Loader] Could not import index.js for '${skillName}', registering from SKILL.md only: ${importErr.message}`);
      }
    }

    // If no tool was injected via index.js, try to register a stub tool from SKILL.md metadata
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    if (fs.existsSync(skillMdPath) && !allTools.find(t => t.name === skillName)) {
      const mdContent = fs.readFileSync(skillMdPath, 'utf8');
      const descMatch = mdContent.match(/^description:\s*(.+)$/m);
      const description = descMatch ? descMatch[1].trim() : `Skill: ${skillName}`;

      const stubTool = new FunctionTool({
        name: skillName,
        description,
        parameters: z.object({
          input: z.string().optional().describe('Input cho skill')
        }),
        execute: async function skillStubHandler(args: any) {
          return { message: `Skill '${skillName}' installed. See SKILL.md for usage details.`, input: args.input };
        }
      });
      allTools.push(stubTool);
      console.log(`[Dynamic Loader] Registered stub tool from SKILL.md for '${skillName}'`);
    }

    // Refresh tools
    toolsVersion++;
    updateDeepSeekTools();
    geminiRunners.clear();

    console.log(`[Dynamic Loader] Skill folder '${skillName}' installed successfully with SKILL.md!`);
    return res.json({ success: true, message: `Skill ${skillName} loaded successfully with SKILL.md format!` });

  } catch (error: any) {
    console.error('Skill load error:', error);
    return res.status(500).json({ error: 'Failed to inject skill: ' + error.message });
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const { text, sessionId: rawSessionId, provider = 'gemini', apiKey, walletAddress, mode } = req.body;
    // mode is 'manual' (default) or 'autonomous'. We bucket the runner cache per
    // mode so a user toggling the switch gets a fresh tool set without losing
    // their other-mode chat history.
    const safeMode: 'manual' | 'autonomous' = mode === 'autonomous' ? 'autonomous' : 'manual';
    const sessionId = `${rawSessionId}::${safeMode}`;
    // openclaw nạp apiKey từ openclaw.json nên không bắt buộc gửi apiKey
    if (!text || !rawSessionId || (!apiKey && provider !== 'openclaw')) {
      return res.status(400).json({ error: 'Missing text, sessionId or apiKey' });
    }

    const currentNamespace = walletAddress || rawSessionId;
    // Set per-request memory namespace so agent-invoked memorize/recall tools
    // store under the correct user even when the LLM omits the namespace arg.
    memwalService.setContext(currentNamespace);

    let finalProvider = provider;
    let finalApiKey = apiKey;
    let finalBaseUrl = '';

    if (provider === 'openclaw') {
      try {
        // Tìm openclaw.json ở nhiều nơi: DATA_ROOT, cwd, %USERPROFILE%, executable dir
        const possiblePaths = [
          path.join(DATA_ROOT, 'openclaw.json'),
          path.join(process.cwd(), 'openclaw.json'),
          path.join(process.env.USERPROFILE || process.env.HOME || '', 'openclaw.json'),
          path.join(process.env.USERPROFILE || process.env.HOME || '', 'Desktop', 'openclaw.json'),
          path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'openclaw.json'),
        ];
        const openclawPath = possiblePaths.find(p => fs.existsSync(p)) || possiblePaths[0];
        if (fs.existsSync(openclawPath)) {
          const data = JSON.parse(fs.readFileSync(openclawPath, 'utf8'));
          const deepseekConfig = data?.models?.providers?.deepseek;
          if (deepseekConfig) {
            finalProvider = 'deepseek';
            finalApiKey = deepseekConfig.apiKey;
            finalBaseUrl = deepseekConfig.baseUrl;
            console.log(`[OpenClaw Link] Loaded apiKey from openclaw.json: ${finalApiKey.slice(0, 8)}...`);
          } else {
            throw new Error('No deepseek config found in openclaw.json');
          }
        } else {
          throw new Error(
            `openclaw.json not found. Create it at one of these paths:\n` +
            possiblePaths.map(p => `  - ${p}`).join('\n') +
            `\n\nTemplate: { "models": { "providers": { "deepseek": { "apiKey": "sk-...", "baseUrl": "https://api.deepseek.com/v1" } } } }`
          );
        }
      } catch (err: any) {
        console.error('[OpenClaw Link Error]', err);
        return res.status(400).json({ error: `OpenClaw error: ${err.message}` });
      }
    }

    if (finalProvider === 'gemini') {
      // Gemini stricter về function schema — loại bỏ experimental SkillToolset meta-tools
      // (chúng có schema phức tạp gây empty response)
      const skillToolsetNames = new Set(skillToolset.tools.map((t: any) => t.name));
      let currentTools = allTools.filter((t: any) => !skillToolsetNames.has(t.name));
      let currentInstruction = SYSTEM_PROMPT;
      // Inject the connected wallet address so the LLM doesn't ask the user for it.
      if (walletAddress) {
        currentInstruction += `\n\nThe user's connected Sui wallet address is: ${walletAddress}. Use it automatically for any tool that requires walletAddress, address, or user. Do NOT ask the user for it.`;
      }
      if (rawSessionId === 'factory-session') {
        currentInstruction = FACTORY_PROMPT;
        currentTools = factoryTools;
      } else {
        // Apply Manual / Autonomous tool gate (research + send_token only vs. full DeepBook execution)
        currentTools = filterToolsForMode(currentTools, safeMode);
        currentInstruction += safeMode === 'manual'
          ? `\n\n[Mode: MANUAL SIGN] You can ONLY do market research (prices, pool TVL, oracle, vault stats), check wallet balances, read transaction history, run analyzer skills, and call send_token to move funds to another wallet. You CANNOT fetch swap quotes, list the user's open orders or positions, place any DeepBook order, open/close margin, mint Predict options, or any other trade action. If the user asks for trade prep or position info, tell them to use Manual Trade view themselves, or switch to Autonomous mode for AI-driven execution.`
          : `\n\n[Mode: AUTONOMOUS] You are the user's trading operator. Full Live Trade + Manual Trade execution available.\n\n` +
            `LIVE TRADE BOT CONTROL — when the user asks you to "run a bot", "trade SUI/BTC", "start trading", etc:\n` +
            `  1. Call list_bot_skills to fetch all bot skills the user owns.\n` +
            `  2. Present them as a numbered list with key stats (strategy, timeframe, leverage, last backtest profit).\n` +
            `  3. Ask the user which one to launch, and confirm pair (SUI_USDC or XBTC_USDC) + capital in USDC.\n` +
            `  4. Call start_auto_bot with the chosen skill — the bot then self-signs all subsequent trades.\n` +
            `  5. After launch, use get_auto_bot_status when the user asks how it's doing.\n` +
            `  6. Use stop_auto_bot to halt it (open positions stay open; tell the user to close manually).\n\n` +
            `MANUAL DEEPBOOK ORDERS — margin_open_position / margin_close_position / DeepTrade orders are available. ` +
            `Use require_approval executionMode so the user signs each trade in the wallet popup.\n\n` +
            `Always read get_auto_bot_status before suggesting a new bot — refuse to start a second one if one is already running.`;
      }

      // ADK 1.1.0 reads Gemini key từ env var GOOGLE_GENAI_API_KEY / GEMINI_API_KEY
      (globalThis as any).__GEMINI_API_KEY__ = finalApiKey;
      process.env.GOOGLE_GENAI_API_KEY = finalApiKey;
      process.env.GEMINI_API_KEY = finalApiKey;
      let runner = geminiRunners.get(sessionId);
      if (!runner) {
        const currentAgent = new LlmAgent({
          name: 'suirobo_deeptrade_local',
          model: 'gemini-flash-latest',
          description: 'SUIROBO DeepTrade Agent',
          instruction: currentInstruction,
          tools: currentTools,
        });
        runner = new Runner({
          agent: currentAgent,
          appName: 'suirobo',
          sessionService: globalSessionService,
        });
        geminiRunners.set(sessionId, runner);
      }

      const userId = 'user_001';
      let session = await globalSessionService.getSession({ appName: 'suirobo', userId, sessionId });
      if (!session) {
        await globalSessionService.createSession({ appName: 'suirobo', userId, sessionId });
      }

      let finalText = '';
      let pendingTx: any = null;

      // --- AUTO RAG ---
      let userContext = text;
      try {
        const memories = await memwalService.recall(text, currentNamespace);
        if (memories && memories !== MEMWAL_EMPTY) {
          userContext = `[System memory about the user (from MemWal)]\n${memories}\n\n[Current user message]\n${text}`;
          console.log(`[Auto-RAG Gemini] Injected memory into context.`);
        }
      } catch (e) {
        // Bỏ qua nếu lỗi kết nối Walrus
      }

      const userContent: any = { role: 'user', parts: [{ text: userContext }] };
      for await (const event of runner.runAsync({
        userId,
        sessionId,
        newMessage: userContent,
      })) {
        if (event.content?.parts) {
          for (const part of event.content.parts) {
            // Capture text từ model (author === 'model' hoặc agent name)
            if (part.text) {
              try {
                const parsed = JSON.parse(part.text);
                if (parsed?.status === 'pending_confirmation') {
                  pendingTx = parsed;
                }
              } catch {}
              finalText = part.text;
            }
            // Capture function response (tool result chứa pending tx)
            if ((part as any).functionResponse?.response) {
              const resp = (part as any).functionResponse.response;
              if (resp?.status === 'pending_confirmation') pendingTx = resp;
            }
          }
        }
        if (!event.partial && event.content?.parts?.[0]?.text) {
          finalText = event.content.parts[0].text;
        }
      }

      return res.json({ response: finalText, pendingTx });
    } 
    
    else if (finalProvider === 'deepseek') {
      let currentInstruction = SYSTEM_PROMPT;
      let currentDeepSeekTools = deepseekToolsConfig;
      // Inject the connected wallet address so the LLM doesn't ask the user for it.
      if (walletAddress) {
        currentInstruction += `\n\nThe user's connected Sui wallet address is: ${walletAddress}. Use it automatically for any tool that requires walletAddress, address, or user. Do NOT ask the user for it.`;
      }

      if (rawSessionId === 'factory-session') {
        currentInstruction = FACTORY_PROMPT;
        currentDeepSeekTools = factoryTools.map((t: any) => {
          const jsonSchema: any = sanitizeSchema(t.parameters ? zodToJsonSchema(t.parameters, { target: 'openApi3' }) : { type: 'object', properties: {} });
          return {
            type: 'function',
            function: {
              name: t.name,
              description: t.description,
              parameters: {
                type: jsonSchema.type || 'object',
                properties: jsonSchema.properties || {},
                required: jsonSchema.required || []
              },
            }
          };
        });
      } else {
        // Apply Manual / Autonomous tool gate for DeepSeek branch too
        const allowedNames = new Set(filterToolsForMode(allTools, safeMode).map((t: any) => t.name));
        currentDeepSeekTools = currentDeepSeekTools.filter((t: any) => allowedNames.has(t.function?.name));
        currentInstruction += safeMode === 'manual'
          ? `\n\n[Mode: MANUAL SIGN] You can ONLY do market research (prices, pool TVL, oracle, vault stats), check wallet balances, read transaction history, run analyzer skills, and call send_token to move funds to another wallet. You CANNOT fetch swap quotes, list the user's open orders or positions, place any DeepBook order, open/close margin, mint Predict options, or any other trade action. If the user asks for trade prep or position info, tell them to use Manual Trade view themselves, or switch to Autonomous mode for AI-driven execution.`
          : `\n\n[Mode: AUTONOMOUS] Full DeepBook execution available — margin positions, DeepTrade orders, Predict options.`;
      }

      if (!deepseekSessions[sessionId]) {
        deepseekSessions[sessionId] = [
          { role: 'system', content: currentInstruction }
        ];
      }
      
      // --- AUTO RAG ---
      let userContext = text;
      try {
        const memories = await memwalService.recall(text, currentNamespace);
        if (memories && memories !== MEMWAL_EMPTY) {
          userContext = `[System memory about the user (from MemWal)]\n${memories}\n\n[Current user message]\n${text}`;
          console.log(`[Auto-RAG DeepSeek] Injected memory into context.`);
        }
      } catch (e) {}

      const history = deepseekSessions[sessionId];
      history.push({ role: 'user', content: userContext });

      let finalText = '';
      let pendingTx: any = null;
      let turnCount = 0;

      const apiUrl = finalBaseUrl ? `${finalBaseUrl}/chat/completions` : 'https://api.deepseek.com/v1/chat/completions';

      while (turnCount < 5) {
        turnCount++;
        console.log(`[DeepSeek] Turn ${turnCount} - Calling API ${apiUrl}...`);
        const reqBody = JSON.stringify({
          model: 'deepseek-chat',
          messages: history,
          tools: currentDeepSeekTools,
          temperature: 0.2
        });
        // Retry transient network failures (ConnectTimeout / fetch failed) — DeepSeek's
        // endpoint can be slow/flaky from some regions; one hiccup shouldn't kill the chat.
        let response: any = null;
        let lastErr: any = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            response = await fetch(apiUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${finalApiKey}` },
              body: reqBody,
              signal: AbortSignal.timeout(60000), // overall 60s per attempt
            });
            break;
          } catch (e: any) {
            lastErr = e;
            const transient = /fetch failed|timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|network|aborted/i.test(String(e?.message || e?.cause?.code || e));
            console.warn(`[DeepSeek] attempt ${attempt}/3 failed: ${e?.cause?.code || e?.message}`);
            if (!transient || attempt === 3) throw new Error(`Cannot reach DeepSeek API (${e?.cause?.code || e?.message}). Check your network and retry.`);
            await new Promise(r => setTimeout(r, attempt * 1500)); // backoff 1.5s, 3s
          }
        }
        const data: any = await response.json();
        if (data.error) throw new Error(data.error.message);

        const message = data.choices[0].message;
        history.push(message);

        if (message.content) {
          finalText += message.content + '\n';
          try {
            const parsed = JSON.parse(message.content);
            if (parsed?.status === 'pending_confirmation') {
              pendingTx = parsed;
            }
          } catch {}
        }

        if (message.tool_calls && message.tool_calls.length > 0) {
          for (const toolCall of message.tool_calls) {
            const functionName = toolCall.function.name;
            const args = JSON.parse(toolCall.function.arguments);
            // Bug fix: In factory session, search factoryTools first
            const toolSearchPool = rawSessionId === 'factory-session' ? [...factoryTools, ...allTools] : allTools;
            const tool = toolSearchPool.find(t => (t as any).name === functionName || (t as any).definition?.name === functionName);
            
            if (!tool) {
              history.push({ role: 'tool', tool_call_id: toolCall.id, name: functionName, content: JSON.stringify({ error: 'Tool not found' }) });
              continue;
            }

            try {
              console.log(`[DeepSeek] Executing tool: ${functionName}`);
              const result = await (tool as any).execute(args);
              if (result && result.status === 'pending_confirmation') {
                pendingTx = result;
              }
              history.push({ role: 'tool', tool_call_id: toolCall.id, name: functionName, content: JSON.stringify(result) });
            } catch (err: any) {
              history.push({ role: 'tool', tool_call_id: toolCall.id, name: functionName, content: JSON.stringify({ error: err.message }) });
            }
          }
          // Loop continues
        } else {
          break; // No more tool calls
        }
      }

      return res.json({ response: finalText.trim(), pendingTx });
    } else {
      return res.status(400).json({ error: 'Invalid provider (gemini and deepseek are supported)' });
    }
  } catch (error: any) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Graceful shutdown — lets a newer agent .exe replace a running instance.
// Server binds localhost only, so this is not reachable from the network.
app.post('/api/shutdown', (req, res) => {
  res.json({ ok: true, message: 'Agent shutting down' });
  console.log('🔻 Shutdown requested (agent upgrade/replace) — exiting...');
  setTimeout(() => process.exit(0), 300);
});

// ============ SKILL FACTORY MANAGEMENT ENDPOINTS ============

// Helper: parse SKILL.md frontmatter for name & description
function parseSkillMd(mdPath: string): { name: string; description: string } {
  const defaults = { name: path.basename(path.dirname(mdPath)), description: '' };
  try {
    const content = fs.readFileSync(mdPath, 'utf8');
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    const descMatch = content.match(/^description:\s*(.+)$/m);
    return {
      name: nameMatch ? nameMatch[1].trim() : defaults.name,
      description: descMatch ? descMatch[1].trim() : defaults.description
    };
  } catch {
    return defaults;
  }
}

// 1. GET /api/skills/list — List all installed skills
app.get('/api/skills/list', (_req, res) => {
  try {
    // Các folder hệ thống — không phải skill
    const RESERVED_FOLDERS = new Set(['draft_skills', 'bot_skills']);

    const entries = fs.readdirSync(localSkillsDir, { withFileTypes: true });
    const skills = entries
      .filter(e => {
        if (!e.isDirectory()) return false;
        if (RESERVED_FOLDERS.has(e.name)) return false;
        // Phải có SKILL.md để được tính là skill hợp lệ
        return fs.existsSync(path.join(localSkillsDir, e.name, 'SKILL.md'));
      })
      .map(e => {
        const skillMdPath = path.join(localSkillsDir, e.name, 'SKILL.md');
        const meta = fs.existsSync(skillMdPath)
          ? parseSkillMd(skillMdPath)
          : { name: e.name, description: '' };

        // Determine source heuristic: check for .walrus marker or built-in
        let source: 'local' | 'walrus' | 'builtin' = 'local';
        if (fs.existsSync(path.join(localSkillsDir, e.name, '.walrus'))) source = 'walrus';

        // A skill is active if it has a registered tool
        const active = allTools.some(t => t.name === meta.name || t.name === e.name);

        return { name: meta.name, description: meta.description, source, active };
      });

    return res.json({ skills });
  } catch (error: any) {
    console.error('Skills list error:', error);
    return res.status(500).json({ error: 'Could not list skills: ' + error.message });
  }
});

// 2. GET /api/skills/drafts — List draft skills
app.get('/api/skills/drafts', (_req, res) => {
  try {
    const draftsDir = path.join(localSkillsDir, 'draft_skills');
    if (!fs.existsSync(draftsDir)) {
      fs.mkdirSync(draftsDir, { recursive: true });
      return res.json({ drafts: [] });
    }

    const entries = fs.readdirSync(draftsDir, { withFileTypes: true });
    const drafts = entries
      .filter(e => e.isDirectory())
      .map(e => {
        const draftPath = path.join(draftsDir, e.name);
        const skillMdPath = path.join(draftPath, 'SKILL.md');
        const meta = fs.existsSync(skillMdPath)
          ? parseSkillMd(skillMdPath)
          : { name: e.name, description: '' };

        // Collect all files in this draft
        const files = fs.readdirSync(draftPath).filter(f => fs.statSync(path.join(draftPath, f)).isFile());

        // Use directory stat for createdAt
        const stat = fs.statSync(draftPath);
        return { name: meta.name, description: meta.description, files, createdAt: stat.birthtime.toISOString() };
      });

    return res.json({ drafts });
  } catch (error: any) {
    console.error('Drafts list error:', error);
    return res.status(500).json({ error: 'Could not list drafts: ' + error.message });
  }
});

// 3. POST /api/skills/test — Test a draft skill by loading AND executing it with sample data
app.post('/api/skills/test', async (req, res) => {
  try {
    const { skillName } = req.body;
    if (!skillName) return res.status(400).json({ error: 'Missing skillName' });

    const draftDir = path.join(localSkillsDir, 'draft_skills', skillName);
    if (!fs.existsSync(draftDir)) {
      return res.status(404).json({ error: `Draft skill '${skillName}' does not exist` });
    }

    let toolName = skillName;
    let toolDescription = '';
    let testResult: any = null;

    // Read metadata from SKILL.md
    const skillMdPath = path.join(draftDir, 'SKILL.md');
    if (fs.existsSync(skillMdPath)) {
      const meta = parseSkillMd(skillMdPath);
      toolName = meta.name || skillName;
      toolDescription = meta.description;
    }

    // Try to dynamically import index.js to validate it loads without errors
    const indexPath = path.join(draftDir, 'index.js');
    if (fs.existsSync(indexPath)) {
      try {
        const moduleUrl = pathToFileURL(indexPath).href + `?t=${Date.now()}`;
        const skillModule = await import(moduleUrl);
        const testSkill = skillModule.default || skillModule.skill || (globalThis as any).__NEW_SKILL__;

        if (testSkill && testSkill.name) {
          toolName = testSkill.name;
          toolDescription = testSkill.description || toolDescription;

          // Actually execute the skill with sample data for a real test
          try {
            const sampleArgs = { targetAsset: 'SUI/USDC', input: 'test_run' };
            const execFn = testSkill.execute || testSkill.run;
            if (typeof execFn === 'function') {
              testResult = await Promise.race([
                execFn(sampleArgs),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out after 10 seconds')), 10000))
              ]);
            }
          } catch (execErr: any) {
            testResult = { warning: `Skill loaded but execution failed: ${execErr.message}` };
          }
        }
      } catch (importErr: any) {
        return res.status(422).json({
          success: false,
          error: `Could not load skill index.js: ${importErr.message}`
        });
      }
    }

    return res.json({ success: true, toolName, toolDescription, testResult });
  } catch (error: any) {
    console.error('Skill test error:', error);
    return res.status(500).json({ error: 'Skill test error: ' + error.message });
  }
});

// 3b. GET /api/skills/draft/:name/code — Read draft skill source code
app.get('/api/skills/draft/:name/code', (req, res) => {
  try {
    const skillName = req.params.name;
    const draftDir = path.join(localSkillsDir, 'draft_skills', skillName);
    if (!fs.existsSync(draftDir)) {
      return res.status(404).json({ error: `Draft '${skillName}' does not exist` });
    }

    const files: Record<string, string> = {};
    const entries = fs.readdirSync(draftDir).filter(f => fs.statSync(path.join(draftDir, f)).isFile());
    for (const f of entries) {
      files[f] = fs.readFileSync(path.join(draftDir, f), 'utf8');
    }

    return res.json({ name: skillName, files });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// 3c. POST /api/skills/fork — Fork a skill into draft_skills for modification
app.post('/api/skills/fork', (req, res) => {
  try {
    const { sourceName, sourceCode } = req.body;
    if (!sourceName) return res.status(400).json({ error: 'Missing sourceName' });

    const safeName = `forked_${sourceName}`.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
    const draftDir = path.join(localSkillsDir, 'draft_skills', safeName);
    if (!fs.existsSync(draftDir)) {
      fs.mkdirSync(draftDir, { recursive: true });
    }

    // If sourceCode is provided directly (from UI), write those files
    if (sourceCode && typeof sourceCode === 'object') {
      for (const [filename, content] of Object.entries(sourceCode)) {
        fs.writeFileSync(path.join(draftDir, filename), content as string);
      }
    } else {
      // Try to copy from installed skills or other drafts
      const sources = [
        path.join(localSkillsDir, sourceName),
        path.join(localSkillsDir, 'draft_skills', sourceName)
      ];
      let copied = false;
      for (const src of sources) {
        if (fs.existsSync(src)) {
          const files = fs.readdirSync(src).filter(f => fs.statSync(path.join(src, f)).isFile());
          for (const f of files) {
            let content = fs.readFileSync(path.join(src, f), 'utf8');
            // Update name in SKILL.md
            if (f === 'SKILL.md') {
              content = content.replace(/^name:\s*.+$/m, `name: ${safeName}`);
            }
            fs.writeFileSync(path.join(draftDir, f), content);
          }
          copied = true;
          break;
        }
      }
      if (!copied) {
        // Create a minimal stub
        fs.writeFileSync(path.join(draftDir, 'SKILL.md'), `---\nname: ${safeName}\ndescription: Forked from ${sourceName}\ntype: custom\n---\n# ${safeName}\nForked from ${sourceName}`);
      }
    }

    console.log(`[Skill Factory] Forked '${sourceName}' → '${safeName}'`);
    return res.json({ success: true, forkedName: safeName, message: `Forked! Draft '${safeName}' is ready to edit.` });
  } catch (error: any) {
    console.error('Skill fork error:', error);
    return res.status(500).json({ error: 'Skill fork error: ' + error.message });
  }
});

// 4. DELETE /api/skills/:name — Remove an installed skill
app.delete('/api/skills/:name', (req, res) => {
  try {
    const skillName = req.params.name;
    if (!skillName) return res.status(400).json({ error: 'Missing skill name' });

    const skillDir = path.join(localSkillsDir, skillName);
    if (!fs.existsSync(skillDir)) {
      return res.status(404).json({ error: `Skill '${skillName}' does not exist` });
    }

    // Remove the tool from allTools (match by directory name or tool name)
    const beforeCount = allTools.length;
    allTools = allTools.filter(t => t.name !== skillName);

    // Also check SKILL.md for the registered name (it may differ from directory name)
    const skillMdPath = path.join(skillDir, 'SKILL.md');
    if (fs.existsSync(skillMdPath)) {
      const meta = parseSkillMd(skillMdPath);
      if (meta.name && meta.name !== skillName) {
        allTools = allTools.filter(t => t.name !== meta.name);
      }
    }

    const removedCount = beforeCount - allTools.length;

    // Remove the directory recursively
    fs.rmSync(skillDir, { recursive: true, force: true });

    // Refresh tools
    toolsVersion++;
    updateDeepSeekTools();
    geminiRunners.clear();

    console.log(`[Skill Factory] Removed skill '${skillName}' (${removedCount} tool(s) unregistered)`);
    return res.json({ success: true, message: `Skill '${skillName}' removed`, removedTools: removedCount });
  } catch (error: any) {
    console.error('Skill delete error:', error);
    return res.status(500).json({ error: 'Could not remove skill: ' + error.message });
  }
});

// ============ END SKILL FACTORY ============

// ============ MEMWAL APIS ============

app.post('/api/memwal/recall', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    if (!walletAddress) return res.status(400).json({ error: 'Missing walletAddress' });
    
    // General query to surface overall memory for this wallet namespace
    const memoryString = await memwalService.recall('important info preferences strategy trading history', walletAddress, 10);
    let memories: string[] = [];

    if (memoryString && memoryString !== MEMWAL_EMPTY) {
       memories = memoryString.split('\n').map(m => m.replace(/^- /, '').trim()).filter(m => m.length > 0);
    }
    const stats = memwalService.stats(walletAddress);
    return res.json({ success: true, memories, mode: stats.mode, count: stats.count });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/memwal/memorize', async (req, res) => {
  try {
    const { walletAddress, info } = req.body;
    if (!walletAddress || !info) return res.status(400).json({ error: 'Missing walletAddress or info' });
    
    const result = await memwalService.memorize(info, walletAddress);
    return res.json({ success: true, message: result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// POST /api/memwal/sync — rebuild/restore a namespace (Walrus relayer restore, or local count)
app.post('/api/memwal/sync', async (req, res) => {
  try {
    const { walletAddress } = req.body;
    if (!walletAddress) return res.status(400).json({ error: 'Missing walletAddress' });
    const result = await memwalService.sync(walletAddress);
    return res.json({ success: result.ok, ...result });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/memwal/stats/:wallet — namespace stats (mode + memory count)
app.get('/api/memwal/stats/:wallet', (req, res) => {
  try {
    return res.json({ success: true, ...memwalService.stats(req.params.wallet) });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// ============ END MEMWAL APIS ============

// ============ EXECUTION FEE: SKILL AUTHORS REGISTRY ============

// In-memory store: walletAddress -> list of skill author addresses the user owns
const skillAuthorsRegistry = new Map<string, string[]>();

// Initialize global for tools to access
(globalThis as any).__SKILL_AUTHORS__ = [];

// POST /api/skills/authors — Frontend sends list of skill authors user owns
app.post('/api/skills/authors', (req, res) => {
  try {
    const { walletAddress, authors } = req.body;
    if (!walletAddress) return res.status(400).json({ error: 'Missing walletAddress' });
    
    const authorList: string[] = Array.isArray(authors) ? authors.filter((a: any) => typeof a === 'string' && a.startsWith('0x')) : [];
    
    // Store in registry
    skillAuthorsRegistry.set(walletAddress, authorList);
    
    // Update global for current active wallet
    (globalThis as any).__SKILL_AUTHORS__ = authorList;
    
    console.log(`[Fee] Updated skill authors for ${walletAddress.slice(0, 10)}...: ${authorList.length} authors`);
    return res.json({ success: true, count: authorList.length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/skills/authors/:wallet — Get stored authors for a wallet
app.get('/api/skills/authors/:wallet', (req, res) => {
  const authors = skillAuthorsRegistry.get(req.params.wallet) || [];
  return res.json({ authors, count: authors.length });
});

// ============ END EXECUTION FEE ============

// ============ BOT SKILLS API ============

const botSkillsDir = path.join(DATA_ROOT, '.local_skills', 'bot_skills');
if (!fs.existsSync(botSkillsDir)) fs.mkdirSync(botSkillsDir, { recursive: true });

/** GET /api/skills/bot — list tất cả bot skills */
app.get('/api/skills/bot', (_req, res) => {
  try {
    const dirs = fs.readdirSync(botSkillsDir);
    const skills = dirs
      .filter(d => fs.existsSync(path.join(botSkillsDir, d, 'config.json')))
      .map(d => {
        try {
          return JSON.parse(fs.readFileSync(path.join(botSkillsDir, d, 'config.json'), 'utf8'));
        } catch { return null; }
      })
      .filter(Boolean);
    return res.json({ skills, count: skills.length });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

/** POST /api/skills/bot — tạo/cập nhật bot skill + sinh SKILL.md + index.js */
app.post('/api/skills/bot', (req, res) => {
  try {
    const { name, config, skill_md, index_js } = req.body;
    if (!name || !config) return res.status(400).json({ error: 'Missing name or config' });

    const safeName = name.replace(/[^a-z0-9_]/g, '');
    const dir = path.join(botSkillsDir, safeName);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
    if (skill_md) fs.writeFileSync(path.join(dir, 'SKILL.md'),  skill_md);
    if (index_js) fs.writeFileSync(path.join(dir, 'index.js'),  index_js);

    // Cũng copy vào .local_skills để Agent có thể dùng
    const agentSkillDir = path.join(localSkillsDir, safeName);
    if (!fs.existsSync(agentSkillDir)) fs.mkdirSync(agentSkillDir, { recursive: true });
    if (skill_md) fs.writeFileSync(path.join(agentSkillDir, 'SKILL.md'), skill_md);
    if (index_js) fs.writeFileSync(path.join(agentSkillDir, 'index.js'), index_js);

    return res.json({ success: true, name: safeName });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

/** POST /api/skills/bot/:name/publish — đóng gói + upload lên Walrus qua CLI */
app.post('/api/skills/bot/:name/publish', async (req, res) => {
  try {
    const safeName = req.params.name.replace(/[^a-z0-9_]/g, '');
    const dir      = path.join(botSkillsDir, safeName);
    const { epochs = 5 } = req.body || {};

    if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Bot skill does not exist' });

    // Đóng gói SKILL.md + index.js + config.json → 1 JSON blob
    const bundle: any = { name: safeName, type: 'bot', files: {} };
    for (const f of ['SKILL.md', 'index.js', 'config.json']) {
      const p = path.join(dir, f);
      if (fs.existsSync(p)) bundle.files[f] = fs.readFileSync(p, 'utf8');
    }

    const tmpFile = path.join(dir, '_walrus_bundle.json');
    fs.writeFileSync(tmpFile, JSON.stringify(bundle, null, 2));

    // Gọi walrus CLI (đã có sẵn từ Walgo)
    const walrusBin = process.platform === 'win32'
      ? path.join(process.env.USERPROFILE || '', '.walgo', 'bin', 'walrus.exe')
      : path.join(process.env.HOME || '', '.walgo', 'bin', 'walrus');

    const child = spawn(walrusBin, ['store', tmpFile, '--epochs', String(epochs), '--json'], {
      shell: false, windowsHide: true,
    });

    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });

    child.on('close', code => {
      try { fs.unlinkSync(tmpFile); } catch {}

      if (code !== 0) {
        // Cố parse blob ID từ stderr nếu CLI in ra dưới dạng human-readable
        const blobMatch = stderr.match(/Blob ID:\s*([A-Za-z0-9_-]+)/);
        if (blobMatch) {
          return res.json({ success: true, blobId: blobMatch[1], raw: stderr.slice(-400) });
        }
        return res.status(500).json({ error: 'Walrus CLI failed', code, stderr: stderr.slice(-500) });
      }

      // Parse JSON output từ --json flag
      try {
        const lines = stdout.trim().split('\n');
        const lastJson = JSON.parse(lines[lines.length - 1]);
        const blob = lastJson?.[0]?.blobStoreResult || lastJson?.blobStoreResult || lastJson;
        const blobId = blob?.newlyCreated?.blobObject?.blobId
                    || blob?.alreadyCertified?.blobId
                    || blob?.blobId;
        return res.json({ success: true, blobId, raw: blob });
      } catch (e: any) {
        return res.json({ success: true, stdout: stdout.slice(-500), note: 'Parsed but no blobId field' });
      }
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

/** DELETE /api/skills/bot/:name — xóa bot skill */
app.delete('/api/skills/bot/:name', (req, res) => {
  try {
    const safeName = req.params.name.replace(/[^a-z0-9_]/g, '');
    const dir = path.join(botSkillsDir, safeName);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });

    // Xóa khỏi .local_skills nếu có
    const agentDir = path.join(localSkillsDir, safeName);
    if (fs.existsSync(agentDir)) fs.rmSync(agentDir, { recursive: true });

    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ============ END BOT SKILLS API ============

// ============ LIVE BOT REST API ============

/** GET /api/livebot/state */
app.get('/api/livebot/state', (_req, res) => {
  const s = liveBotController.getState();
  return res.json({
    active:      s.active,
    config:      s.config,
    position:    s.position,
    price:       s.currentPrice,
    signal:      s.lastSignal,
    indicators:  s.lastIndicators,
    tradeCount:  s.tradeCount,
    totalPnl:    s.totalPnl,
    logs:        s.logs.slice(0, 50),
    lastUpdate:  s.lastUpdate,
  });
});

/** POST /api/livebot/configure */
app.post('/api/livebot/configure', (req, res) => {
  try {
    const cfg = req.body;
    if (!cfg?.botSkillName || !cfg?.walletAddress)
      return res.status(400).json({ error: 'Missing botSkillName or walletAddress' });
    liveBotController.configure(cfg);
    return res.json({ success: true });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

/** POST /api/livebot/start */
app.post('/api/livebot/start', (req, res) => {
  if (req.body?.config) liveBotController.configure(req.body.config);
  liveBotController.start();
  return res.json({ success: true, active: true });
});

/** POST /api/livebot/stop */
app.post('/api/livebot/stop', (_req, res) => {
  liveBotController.stop();
  return res.json({ success: true, active: false });
});

/** POST /api/livebot/clearkey — xóa private key khỏi memory */
app.post('/api/livebot/clearkey', (_req, res) => {
  liveBotController.clearKey();
  return res.json({ success: true });
});

/** GET /api/livebot/candles — the bot's own kline feed (for the UI chart) */
app.get('/api/livebot/candles', (_req, res) => {
  return res.json({ candles: liveBotController.getCandles() });
});

/** GET /api/livebot/history — persisted buy/sell trade records (newest first) */
app.get('/api/livebot/history', (_req, res) => {
  return res.json({ history: liveBotController.getHistory() });
});

/** POST /api/livebot/closenow — manually close the open position at market */
app.post('/api/livebot/closenow', async (_req, res) => {
  try {
    const r = await liveBotController.closeNow();
    return res.status(r.ok ? 200 : 400).json(r);
  } catch (e: any) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

/** POST /api/livebot/killswitch — panic button: stop the bot AND flatten all positions */
app.post('/api/livebot/killswitch', async (_req, res) => {
  try {
    const r = await liveBotController.killSwitch();
    return res.status(r.ok ? 200 : 400).json(r);
  } catch (e: any) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

/** GET /api/dev/wallet — trả về thông tin ví dev (không trả private key) */
app.get('/api/dev/wallet', (_req, res) => {
  const hasKey     = !!process.env.SUIROBO_DEV_WALLET;
  const devAddress = process.env.SUIROBO_DEV_ADDRESS || '';
  return res.json({
    hasKey,
    address: devAddress,
    label:   'Suirobo Dev Wallet',
    note:    'Internal dev/test wallet. Not for mainnet production.',
  });
});

// ============ END LIVE BOT REST API ============

// ─── Multi-protocol listener ─────────────────────────────────────────────────
// HTTP (port 3001) — cho dev / local web (localhost:5173)
// HTTPS (port 3002) — cho Walrus web (https://autobots.wal.app)
//   Browser modern (Chrome v133+) block fetch HTTPS → HTTP, nên cần HTTPS local

const PORT      = 3001;
const HTTPS_PORT= 3002;
const CERT_DIR  = path.join(DATA_ROOT, 'certs');

// HTTP server — loopback only (never reachable from other machines on the LAN)
app.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 Suirobo Agent (HTTP)  on http://127.0.0.1:${PORT}  (dev mode)`);
});

// HTTPS server — generate self-signed cert nếu chưa có
async function startHttps() {
  try {
    if (!fs.existsSync(CERT_DIR)) fs.mkdirSync(CERT_DIR, { recursive: true });
    const certPath = path.join(CERT_DIR, 'localhost.crt');
    const keyPath  = path.join(CERT_DIR, 'localhost.key');

    let cert: string, key: string;
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
      cert = fs.readFileSync(certPath, 'utf8');
      key  = fs.readFileSync(keyPath, 'utf8');
      console.log('🔐 Loaded existing self-signed cert');
    } else {
      console.log('🔐 Generating self-signed cert (one-time setup)...');
      // Top-level static import — pkg/yao-pkg bundle được, dynamic import thì không
      const selfsigned: any = selfsignedMod;
      const attrs = [{ name: 'commonName', value: 'localhost' }];
      const pems = await selfsigned.generate(attrs, {
        days: 3650,
        algorithm: 'sha256',
        keySize: 2048,
        extensions: [
          { name: 'basicConstraints', cA: true },
          { name: 'subjectAltName', altNames: [
            { type: 2, value: 'localhost' },
            { type: 2, value: '*.localhost' },
            { type: 7, ip: '127.0.0.1' },
            { type: 7, ip: '::1' },
          ]},
        ],
      });
      cert = pems.cert; key = pems.private;
      fs.writeFileSync(certPath, cert);
      fs.writeFileSync(keyPath, key);
      console.log(`   ✓ Cert: ${certPath}`);
    }

    https.createServer({ cert, key }, app).listen(HTTPS_PORT, '127.0.0.1', () => {
      console.log(`🔒 Suirobo Agent (HTTPS) on https://localhost:${HTTPS_PORT} (Walrus web)`);
      console.log(`   ⚠️  First run: open https://localhost:${HTTPS_PORT}/health → click "Advanced" → "Proceed"`);
    });
  } catch (e: any) {
    console.error('⚠️  HTTPS server failed:', e.message);
    console.error('   (HTTP still runs — dev mode only)');
  }
}
startHttps();
