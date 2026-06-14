/**
 * Test Runner — khởi tạo server inline rồi chạy test
 */
import express from 'express';
import cors from 'cors';
import { LlmAgent, Runner, InMemorySessionService } from '@google/adk';
import { deepbookV3Tools } from '../src/agent/tools/deepbookV3.js';
import { marginTools } from '../src/agent/tools/margin.js';
import { predictTools } from '../src/agent/tools/predict.js';

const app = express();
app.use(cors());
app.use(express.json());

const allTools = [...deepbookV3Tools, ...marginTools, ...predictTools];
let deepseekApiKey = (process.env.DEEPSEEK_API_KEY || '');
const deepseekSessions: Record<string, any[]> = {};

const SYSTEM_PROMPT = `Bạn là SUIROBO — trợ lý AI DeFi trên Sui. 
Spot = Mainnet, Margin/Predict = Testnet.
Có 23 tools: 8 Spot + 7 Margin + 8 Predict.
executionMode: autonomous (tự động) hoặc require_approval (chờ ký).
Trả lời ngắn gọn, tiếng Việt. LUÔN gọi tool khi có tool phù hợp.
Margin/Predict: BẮT BUỘC ghi rủi ro.`;

function convertSchema(obj: any): any {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(convertSchema);
  const newObj: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'type' && typeof v === 'string') {
      // DeepSeek requires lowercase types: OBJECT→object, STRING→string, etc.
      newObj[k] = v.toLowerCase();
    } else if (k === 'anyOf' || k === 'allOf' || k === 'oneOf') {
      if (Array.isArray(v) && v.length > 0) Object.assign(newObj, convertSchema(v[0]));
    } else if (['default','nullable','exclusiveMinimum','exclusiveMaximum','$schema'].includes(k)) {
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
    const props = convertSchema(dec.parameters?.properties || {});
    return {
      type: 'function',
      function: { name: dec.name, description: dec.description,
        parameters: { type: 'object', properties: props, required: dec.parameters?.required || [] } }
    };
  });

  let finalText = '';
  let pendingTx = null;
  let toolCalls: string[] = [];

  while (true) {
    const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${deepseekApiKey}` },
      body: JSON.stringify({ model: 'deepseek-chat', messages, tools })
    });
    if (!res.ok) throw new Error(`DeepSeek API Error: ${await res.text()}`);
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
        toolCalls.push(`${tool.name}(${JSON.stringify(args)})`);
        let toolResult;
        try {
          toolResult = await tool.runAsync({ args, toolContext: {} as any });
          if (toolResult && (toolResult as any).status === 'pending_confirmation') pendingTx = toolResult;
          if (toolResult && (toolResult as any).status === 'executed_autonomous') pendingTx = toolResult;
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
  return { finalText, pendingTx, toolCalls };
}

// ═══════════════════ TEST RUNNER ═══════════════════
let passed = 0, failed = 0;

async function test(name: string, text: string) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`📋 ${name}`);
  console.log(`💬 "${text}"`);
  console.log('─'.repeat(70));
  try {
    const sid = `test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const { finalText, pendingTx, toolCalls } = await runDeepSeekChat(text, sid);
    
    if (toolCalls.length > 0) {
      console.log(`🔧 Tools gọi: ${toolCalls.join(' → ')}`);
    }
    
    const resp = (finalText || '').substring(0, 500);
    console.log(`🤖 ${resp}${finalText?.length > 500 ? '...' : ''}`);
    
    if (pendingTx) {
      const status = (pendingTx as any).status;
      const hasTx = !!(pendingTx as any).serializedTx;
      const network = (pendingTx as any).network;
      console.log(`📦 Status: ${status} | PTB: ${hasTx ? 'CÓ' : 'KHÔNG'} | Network: ${network || 'N/A'}`);
      if ((pendingTx as any).txDigest) {
        console.log(`🔗 TxDigest: ${(pendingTx as any).txDigest}`);
      }
    }
    
    console.log(`✅ PASSED`);
    passed++;
  } catch (e: any) {
    console.log(`❌ FAILED: ${e.message}`);
    failed++;
  }
}

async function runTests() {
  console.log('🚀 SUIROBO DeepTrade — Full Test Suite (23 Tools)');
  console.log(`📊 Tools loaded: ${allTools.length} (${allTools.map(t => t.name).join(', ')})`);
  console.log('═'.repeat(70));

  // ═══ MARGIN (Testnet) ═══
  console.log('\n\n🏦 ══════════ MARGIN TESTS (Testnet) ══════════');
  
  await test('MARGIN-1: Mở vị thế (Autonomous)',
    'Mở Margin pool SUI_USDC: vay 100 USDC, thế chấp 50 SUI. Tự động thực thi quyền tự trị.');

  await test('MARGIN-2: Mở vị thế (Require Approval)',
    'Mở Margin pool SUI_USDC: vay 200 USDC, thế chấp 80 SUI. Chuẩn bị cho tôi duyệt.');

  await test('MARGIN-3: Đóng vị thế (Autonomous)',
    'Đóng Margin SUI_USDC, trả nợ 100 USDC. Tự động thực thi.');

  await test('MARGIN-4: Đóng vị thế (Require Approval)',
    'Đóng Margin SUI_USDC, trả nợ 50 USDC. Gửi lệnh cho tôi duyệt.');

  await test('MARGIN-5: Tính giá thanh lý',
    'Tính giá thanh lý nếu thế chấp 100 SUI vay 200 USDC.');

  await test('MARGIN-6: Lãi suất vay',
    'Lãi suất vay pool SUI_USDC?');

  // ═══ PREDICT (Testnet) ═══
  console.log('\n\n🎯 ══════════ PREDICT TESTS (Testnet) ══════════');
  
  await test('PREDICT-1: Mở Binary UP (Autonomous)',
    'Mở Binary SUI UP, strike $4.0, expiry 2026-06-01T00:00:00Z, 50 USDC. Tự động.');

  await test('PREDICT-2: Mở Binary DOWN (Approval)',
    'Mở Binary SUI DOWN, strike $3.0, expiry 2026-06-01T00:00:00Z, 100 USDC. Chuẩn bị duyệt.');

  await test('PREDICT-3: Supply Vault (Autonomous)',
    'Nạp 500 USDC vào Predict Vault. Tự động.');

  await test('PREDICT-4: Withdraw Vault (Approval)',
    'Rút 200 PLP từ Predict Vault. Cho tôi duyệt.');

  await test('PREDICT-5: Giá Oracle',
    'Giá Oracle SUI?');

  await test('PREDICT-6: Vault Stats',
    'Thống kê Predict Vault?');

  // ═══ SPOT (Mainnet) ═══
  console.log('\n\n💱 ══════════ SPOT TESTS (Mainnet) ══════════');
  
  await test('SPOT-1: Pool Info',
    'Thông tin pool SUI/USDC?');

  await test('SPOT-2: Swap Quote',
    'Quote swap 10 SUI → USDC, slippage 0.5%.');

  await test('SPOT-3: Deposit BalanceManager (Autonomous)',
    'Nạp 100 SUI vào BalanceManager. Tự động.');

  await test('SPOT-4: Withdraw BalanceManager (Approval)',
    'Rút 50 USDC từ BalanceManager. Cho tôi duyệt.');

  // ═══ SUMMARY ═══
  console.log(`\n\n${'═'.repeat(70)}`);
  console.log(`📊 KẾT QUẢ TỔNG: ${passed}/${passed + failed} PASSED (${failed} FAILED)`);
  console.log('═'.repeat(70));
  
  process.exit(0);
}

runTests().catch(e => { console.error('FATAL:', e); process.exit(1); });
