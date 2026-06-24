import express from 'express';
import cors from 'cors';
import { LlmAgent, Runner, InMemorySessionService } from '@google/adk';
import { deepbookV3Tools } from '../src/agent/tools/deepbookV3.js';
import { marginTools } from '../src/agent/tools/margin.js';
import { predictTools } from '../src/agent/tools/predict.js';
import { MemWal } from '@mysten-incubation/memwal';

const app = express();

// ── Hardening: only allow trusted origins to reach the local agent ──
// The agent runs on the user's machine and signs real trades. Any web page can
// otherwise fetch http://localhost:3001 (CORS was open + bound to 0.0.0.0). Allow
// only localhost, the Walrus portal domains, and no-origin (same-origin / curl /
// desktop file://). A named malicious domain (incl. DNS-rebinding) is rejected.
const originAllowed = (origin?: string): boolean => {
  if (!origin || origin === 'null') return true;
  try {
    const h = new URL(origin).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.wal.app') || h.endsWith('.walrus.site');
  } catch { return false; }
};
app.use(cors({ origin: (o, cb) => cb(null, originAllowed(o)) }));
app.use(express.json());

const globalSessionService = new InMemorySessionService();
let runner: Runner | null = null;
let currentProvider = 'gemini';
let deepseekApiKey = '';
import { agentSkills } from '../src/agent/skills/index.js';
const allTools = [...deepbookV3Tools, ...marginTools, ...predictTools, ...agentSkills];

// Global chat history for DeepSeek
const deepseekSessions: Record<string, any[]> = {};

const SYSTEM_PROMPT = `Bạn là SUIROBO — trợ lý AI chuyên gia về DeFi trên Sui Blockchain, tập trung vào DeepBook V3.

## Mạng lưới:
- **Spot (DeepBook V3)**: Mainnet — giao dịch thật
- **Margin & Predict**: Testnet — test an toàn

## Nhiệm vụ chính:
1. **DeepBook V3 Spot** (8 tools): Pool info, swap quote, limit/market order, cancel order, list orders, deposit/withdraw BalanceManager.
2. **DeepBook Margin** (7 tools): Margin health, open/close position, list positions, adjust collateral, borrow rate, liquidation price.
3. **DeepBook Predict** (8 tools): Oracle price, open/close binary, supply/withdraw vault, list positions, vault stats, payout calculator.

## Chế độ thực thi lệnh (executionMode):
1. **Quyền tự trị (autonomous)**: Nếu user yêu cầu "tự động thực thi", "không cần hỏi", hoặc "quyền tự trị", đặt \`executionMode = 'autonomous'\`. Lệnh sẽ được thực thi trực tiếp trả về txDigest.
2. **Ký duyệt lần cuối (require_approval)**: Mặc định nếu user không chỉ định. Trả về serializedTx (PTB base64) chờ user ký trong ví.

## Quy tắc bắt buộc:
- Margin/Predict: BẮT BUỘC ghi rõ rủi ro, tỷ lệ margin, ngưỡng thanh lý.
- Trước khi mở vị thế Margin: PHẢI gọi get_margin_health hoặc margin_liquidation_price.
- Trước khi swap: PHẢI gọi get_swap_quote.
- Trả lời bằng tiếng Việt, ngắn gọn và chính xác.
- Khi có tool phù hợp, LUÔN gọi tool thay vì đoán mò.
- Mỗi lệnh trả về serializedTx (Sui PTB base64) để frontend ký.`;

app.post('/api/init', async (req, res) => {
  const { provider, apiKey, memwalKey, memwalAccountId } = req.body;
  try {
    currentProvider = provider;
    
    if (memwalKey && memwalAccountId) {
      (globalThis as any).__MEMWAL_KEY__ = memwalKey;
      (globalThis as any).__MEMWAL_ACCOUNT_ID__ = memwalAccountId;
    }

    if (provider === 'deepseek') {
      deepseekApiKey = apiKey;
      res.json({ success: true, message: `✅ **DeepSeek** đã kết nối! Hỏi tôi bất cứ điều gì về DeepTrade.` });
      return;
    }

    (globalThis as any).__GEMINI_API_KEY__ = apiKey;

    const currentAgent = new LlmAgent({
      name: 'suirobo_deeptrade',
      model: 'models/gemini-2.0-flash',
      description: 'SUIROBO DeepTrade Agent — DeFi expert on Sui',
      instruction: SYSTEM_PROMPT,
      tools: allTools,
    });

    runner = new Runner({
      agent: currentAgent,
      appName: 'suirobo',
      sessionService: globalSessionService,
    });

    res.json({ success: true, message: `✅ **Gemini** đã kết nối! Hỏi tôi bất cứ điều gì về DeepTrade.` });
  } catch (err: any) {
    console.error('Init Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

function convertSchema(obj: any): any {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(convertSchema);

  const newObj: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'type' && typeof v === 'string') {
      newObj[k] = v.toLowerCase();
    } else if (k === 'anyOf' || k === 'allOf' || k === 'oneOf') {
      // Avoid anyOf/allOf which DeepSeek often rejects if not standard
      if (Array.isArray(v) && v.length > 0) {
        // just take the first type, simplify schema
        Object.assign(newObj, convertSchema(v[0]));
      }
    } else if (k === 'default' || k === 'nullable' || k === 'exclusiveMinimum' || k === 'exclusiveMaximum') {
      // Skip fields DeepSeek might complain about
      continue;
    } else {
      newObj[k] = convertSchema(v);
    }
  }
  return newObj;
}

async function runDeepSeekChat(text: string, sessionId: string) {
  if (!deepseekSessions[sessionId]) {
    deepseekSessions[sessionId] = [{ role: 'system', content: SYSTEM_PROMPT }];
  }
  const messages = deepseekSessions[sessionId];
  messages.push({ role: 'user', content: text });

  const tools = allTools.map((t: any) => {
    const dec = t._getDeclaration();
    // console.log(`Schema for ${dec.name}:`, JSON.stringify(dec.parameters, null, 2));
    
    // DeepSeek API fixes: Remove any unsupported schema fields like "default" if they are invalid
    const props = convertSchema(dec.parameters?.properties || {});
    
    return {
      type: 'function',
      function: {
        name: dec.name,
        description: dec.description,
        parameters: { 
          type: 'object', 
          properties: props, 
          required: dec.parameters?.required || [] 
        }
      }
    };
  });

  let finalText = '';
  let pendingTx = null;

  while (true) {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${deepseekApiKey}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages, tools })
    });

    if (!res.ok) {
      throw new Error(`DeepSeek API Error: ${await res.text()}`);
    }

    const data = await res.json();
    const msg = data.choices[0].message;
    messages.push(msg);

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const call of msg.tool_calls) {
        const tool = allTools.find(t => t.name === call.function.name);
        if (!tool) {
          messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: JSON.stringify({ error: 'Tool not found' }) });
          continue;
        }

        const args = JSON.parse(call.function.arguments);
        console.log(`DeepSeek Tool Call: ${tool.name}`, args);
        
        let toolResult;
        try {
          toolResult = await tool.runAsync({ args, toolContext: {} as any });
          if (toolResult && (toolResult as any).status === 'pending_confirmation') {
             pendingTx = toolResult;
          }
        } catch (e: any) {
          toolResult = { error: e.message };
        }

        messages.push({ role: 'tool', tool_call_id: call.id, name: call.function.name, content: JSON.stringify(toolResult) });
      }
    } else {
      finalText = msg.content;
      break;
    }
  }

  return { finalText, pendingTx };
}

// MemWal endpoints
app.post('/api/memwal/recall', async (req, res) => {
  const { walletAddress, query } = req.body;
  const key = (globalThis as any).__MEMWAL_KEY__;
  const accountId = (globalThis as any).__MEMWAL_ACCOUNT_ID__;

  if (!key || !accountId) {
    // Graceful fallback for testing
    return res.json({ success: true, memories: ["User is a VIP trader.", "Prefers USDC margins."] });
  }

  try {
    const memwal = MemWal.create({
      key, accountId,
      serverUrl: "https://relayer.dev.memwal.ai",
      namespace: walletAddress || "default"
    });
    const memories = await memwal.recall(query || "User preferences");
    res.json({ success: true, memories: memories.map((m: any) => m.content) });
  } catch (err: any) {
    console.error('MemWal Recall Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/memwal/remember', async (req, res) => {
  const { walletAddress, fact } = req.body;
  const key = (globalThis as any).__MEMWAL_KEY__;
  const accountId = (globalThis as any).__MEMWAL_ACCOUNT_ID__;

  if (!key || !accountId) {
    return res.json({ success: true, message: "Mock saved" });
  }

  try {
    const memwal = MemWal.create({
      key, accountId,
      serverUrl: "https://relayer.dev.memwal.ai",
      namespace: walletAddress || "default"
    });
    const job = await memwal.remember(fact);
    res.json({ success: true, jobId: job.job_id });
  } catch (err: any) {
    console.error('MemWal Remember Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/chat', async (req, res) => {
  const { text, sessionId } = req.body;
  const userId = 'user_001';

  try {
    if (currentProvider === 'deepseek') {
      const { finalText, pendingTx } = await runDeepSeekChat(text, sessionId);
      return res.json({ success: true, text: finalText, pendingTx });
    }

    if (!runner) return res.status(400).json({ success: false, message: 'Agent chưa khởi tạo' });

    let session = await globalSessionService.getSession({ appName: 'suirobo', userId, sessionId });
    if (!session) {
      await globalSessionService.createSession({ appName: 'suirobo', userId, sessionId });
    }

    const userContent: any = { role: 'user', parts: [{ text }] };
    let finalText = '';
    let pendingTx = null;

    for await (const event of runner.runAsync({
      userId,
      sessionId,
      newMessage: userContent,
    })) {
      if (event.content?.parts) {
        for (const part of event.content.parts) {
          if (part.text) {
            try {
              const parsed = JSON.parse(part.text);
              if (parsed?.status === 'pending_confirmation') {
                pendingTx = parsed;
              }
            } catch {
              // Not JSON
            }
            finalText = part.text;
          }
        }
      }

      if (!event.partial && event.content?.parts?.[0]?.text) {
        finalText = event.content.parts[0].text;
      }
    }

    res.json({ success: true, text: finalText, pendingTx });
  } catch (err: any) {
    console.error('Chat Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

import { marginPortfolioGuardianSkill } from '../src/agent/skills/margin_portfolio_guardian.js';
import { predictPositionMonitorSkill } from '../src/agent/skills/predict_position_monitor.js';

app.post('/api/dashboard', async (req, res) => {
  const { walletAddress } = req.body;
  if (!walletAddress) {
    return res.status(400).json({ success: false, message: 'Missing walletAddress' });
  }

  try {
    // 1. Fetch Margin Data
    let marginData: any = null;
    try {
      const mRaw = await (marginPortfolioGuardianSkill as any).execute({ walletAddress });
      marginData = JSON.parse(mRaw);
    } catch (e) {
      console.error('Margin Guardian Error:', e);
    }

    // 2. Fetch Predict Data (BTC is the main active asset for testing)
    let predictData: any = null;
    try {
      const pRaw = await (predictPositionMonitorSkill as any).execute({ walletAddress, asset: 'BTC' });
      predictData = JSON.parse(pRaw);
    } catch (e) {
      console.error('Predict Monitor Error:', e);
    }

    res.json({ success: true, data: { margin: marginData, predict: predictData } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const PORT = 3001;
// Bind to loopback only — the agent must never be reachable from other machines
// on the LAN. localhost/127.0.0.1 callers (desktop + the local cert-https proxy)
// still work.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 Suirobo Agent Server running on http://127.0.0.1:${PORT}`);
});
