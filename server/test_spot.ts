import fetch from 'node-fetch';
import { deepbookV3Tools } from '../src/agent/tools/deepbookV3.js';

const allTools = [...deepbookV3Tools];
const deepseekApiKey = (process.env.DEEPSEEK_API_KEY || '');
const deepseekSessions: Record<string, any[]> = {};

const SYSTEM_PROMPT = `Bạn là SUIROBO — trợ lý AI DeFi trên Sui.
Chuyên gia về thị trường giao ngay (Spot) của DeepBook V3.
- Mạng lưới: Mainnet
- Chế độ thực thi:
  + autonomous: tự động thực thi, trả về txDigest mock và serializedTx.
  + require_approval: chờ xác nhận, trả về serializedTx để ví ký duyệt.
- Trả lời ngắn gọn bằng tiếng Việt. LUÔN LUÔN sử dụng các tool tương ứng khi có yêu cầu.`;

function convertSchema(obj: any): any {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(convertSchema);
  const newObj: any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'type' && typeof v === 'string') {
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
      function: {
        name: dec.name,
        description: dec.description,
        parameters: { type: 'object', properties: props, required: dec.parameters?.required || [] }
      }
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

async function testSpotCommand(name: string, text: string) {
  console.log(`\n${'═'.repeat(75)}`);
  console.log(`🎯 TEST CASE: ${name}`);
  console.log(`💬 Yêu cầu: "${text}"`);
  console.log('─'.repeat(75));

  try {
    const sid = `spot_test_${Date.now()}`;
    const { finalText, pendingTx, toolCalls } = await runDeepSeekChat(text, sid);

    if (toolCalls.length > 0) {
      console.log(`🔧 Tool được gọi: ${toolCalls.join(' → ')}`);
    }
    console.log(`🤖 Phản hồi của Agent:\n${finalText}`);

    if (pendingTx) {
      console.log('─'.repeat(75));
      console.log(`📦 Kết quả Giao dịch (Transaction Response):`);
      console.log(`   - Trạng thái: ${pendingTx.status}`);
      console.log(`   - Mạng lưới: ${pendingTx.network}`);
      if (pendingTx.txDigest) console.log(`   - Tx Digest: ${pendingTx.txDigest}`);
      if (pendingTx.serializedTx) console.log(`   - Serialized PTB Payload: ${pendingTx.serializedTx}`);
      if (pendingTx.action_required) console.log(`   - Hành động yêu cầu: ${pendingTx.action_required}`);
      if (pendingTx.order) console.log(`   - Chi tiết lệnh (Order):`, JSON.stringify(pendingTx.order, null, 2));
      if (pendingTx.deposit) console.log(`   - Chi tiết Nạp (Deposit):`, JSON.stringify(pendingTx.deposit, null, 2));
      if (pendingTx.withdraw) console.log(`   - Chi tiết Rút (Withdraw):`, JSON.stringify(pendingTx.withdraw, null, 2));
    }
    console.log(`✅ KẾT QUẢ: PASSED`);
  } catch (e: any) {
    console.log(`❌ KẾT QUẢ: FAILED - ${e.message}`);
  }
}

async function runAll() {
  console.log('🚀 Bắt đầu chạy testcase trên Spot Module với Agent DeepTrade...');
  
  // 1. Nạp tiền vào BalanceManager
  await testSpotCommand(
    'SPOT-1: Nạp tiền (Deposit) vào BalanceManager (Require Approval)',
    'Nạp 100 USDC vào BalanceManager để chuẩn bị giao dịch trên DeepBook V3.'
  );

  // 2. Mở lệnh Market
  await testSpotCommand(
    'SPOT-2: Khớp lệnh Market Mua (Autonomous)',
    'Mua ngay 100 SUI trên pool SUI_USDC bằng lệnh Market. Tự động thực thi lệnh.'
  );

  // 3. Rút tiền từ BalanceManager
  await testSpotCommand(
    'SPOT-3: Rút tiền (Withdraw) khỏi BalanceManager (Require Approval)',
    'Rút 10 SUI từ BalanceManager về ví cá nhân.'
  );

  console.log(`\n${'═'.repeat(75)}`);
  console.log('🏁 Hoàn thành các testcase Spot!');
}

runAll().catch(console.error);
