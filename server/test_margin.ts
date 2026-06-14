import fetch from 'node-fetch';
import { marginTools } from '../src/agent/tools/margin.js';

const allTools = [...marginTools];
const deepseekApiKey = (process.env.DEEPSEEK_API_KEY || '');
const deepseekSessions: Record<string, any[]> = {};

const SYSTEM_PROMPT = `Bạn là SUIROBO — trợ lý AI DeFi trên Sui.
Chuyên gia về thị trường ký quỹ (Margin) của DeepBook.
- Mạng lưới: Testnet
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

async function testMarginCommand(name: string, text: string) {
  console.log(`\n${'═'.repeat(75)}`);
  console.log(`🎯 TEST CASE: ${name}`);
  console.log(`💬 Yêu cầu: "${text}"`);
  console.log('─'.repeat(75));

  try {
    const sid = `margin_test_${Date.now()}`;
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
      if (pendingTx.position) console.log(`   - Chi tiết vị thế:`, JSON.stringify(pendingTx.position, null, 2));
      if (pendingTx.adjustment) console.log(`   - Chi tiết điều chỉnh collateral:`, JSON.stringify(pendingTx.adjustment, null, 2));
    }
    console.log(`✅ KẾT QUẢ: PASSED`);
  } catch (e: any) {
    console.log(`❌ KẾT QUẢ: FAILED - ${e.message}`);
  }
}

async function runAll() {
  console.log('🚀 Bắt đầu chạy testcase trên Margin Module với Agent DeepTrade...');
  
  // 1. Mở lệnh Margin (Chờ duyệt)
  await testMarginCommand(
    'MARGIN-1: Mở vị thế Margin (Require Approval)',
    'Hãy mở vị thế margin trên pool SUI_USDC, vay 100 USDC và thế chấp 50 SUI. Vui lòng tạo lệnh chờ xác nhận.'
  );

  // 2. Nạp thêm Collateral (Tự động)
  await testMarginCommand(
    'MARGIN-2: Nạp thêm Collateral vào vị thế (Autonomous)',
    'Tôi muốn nạp thêm 20 SUI làm tài sản thế chấp (collateral) vào pool SUI_USDC để giảm rủi ro thanh lý. Thực thi tự động giúp tôi.'
  );

  // 3. Đóng vị thế Margin (Chờ duyệt)
  await testMarginCommand(
    'MARGIN-3: Đóng vị thế Margin (Require Approval)',
    'Trả 100 USDC để đóng vị thế trên pool SUI_USDC và lấy lại collateral. Tạo lệnh chờ duyệt.'
  );

  console.log(`\n${'═'.repeat(75)}`);
  console.log('🏁 Hoàn thành các testcase Margin!');
}

runAll().catch(console.error);
