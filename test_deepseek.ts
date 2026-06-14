import { LlmAgent, Runner, InMemorySessionService } from '@google/adk';
import { marginTools } from './src/agent/tools/margin';
import { predictTools } from './src/agent/tools/predict';
import { deepbookV3Tools } from './src/agent/tools/deepbookV3';

// Setup DeepSeek OpenAI endpoints for ADK
process.env.OPENAI_API_KEY = (process.env.DEEPSEEK_API_KEY || '');
process.env.OPENAI_BASE_URL = "https://api.deepseek.com/v1";

const SYSTEM_PROMPT = `Bạn là SUIROBO — trợ lý AI chuyên gia về DeFi trên Sui Blockchain, tập trung vào DeepBook V3.

## Chế độ thực thi lệnh (executionMode):
1. **Quyền tự trị (autonomous)**: Nếu user yêu cầu "tự động thực thi", "không cần hỏi", hoặc "quyền tự trị", hãy đặt \`executionMode = 'autonomous'\` trong các tools (Margin/Predict). Lệnh sẽ được thực thi trực tiếp.
2. **Ký duyệt lần cuối (require_approval)**: Nếu user không chỉ định, hoặc yêu cầu "chuẩn bị lệnh", luôn đặt \`executionMode = 'require_approval'\` để trả về payload chờ user ký.

## Quy tắc bắt buộc:
- Với lệnh Margin/Predict: bắt buộc ghi rõ rủi ro.
- Trả lời bằng tiếng Việt, ngắn gọn và chính xác.
- Khi cần thông tin thị trường, hãy gọi đúng tool thay vì đoán mò.`;

const allTools = [...deepbookV3Tools, ...marginTools, ...predictTools];

const agent = new LlmAgent({
  name: 'suirobo_deeptrade_test',
  model: 'gemini-2.0-flash',
  description: 'SUIROBO DeepTrade Agent Test',
  instruction: SYSTEM_PROMPT,
  tools: allTools,
});

const sessionService = new InMemorySessionService();
const runner = new Runner({
  agent,
  appName: 'suirobo',
  sessionService,
});

async function runTest(message: string) {
  console.log(`\n\n[USER]: ${message}`);
  const userContent: any = {
    role: 'user',
    parts: [{ text: message }],
  };

  try {
    let sessId = 'test_session';
    const s = await sessionService.getSession(sessId);
    if (!s) {
      await sessionService.createSession({ appName: 'suirobo', userId: 'test_user', sessionId: sessId });
      console.log('Created session:', sessId);
    }

    for await (const event of runner.runAsync({
      userId: 'test_user',
      sessionId: sessId,
      newMessage: userContent,
    })) {
      if (event.content?.parts) {
        for (const part of event.content.parts) {
          if (part.text) {
            try {
              const parsed = JSON.parse(part.text);
              console.log(`[TOOL PAYLOAD]:`, parsed);
            } catch {
              if (!event.partial) {
                console.log(`[AGENT]: ${part.text}`);
              }
            }
          }
        }
      }
    }
  } catch (err: any) {
    console.error(`[ERROR]: ${err.message}`);
  }
}

async function main() {
  console.log('=== BẮT ĐẦU TEST AGENT DEEPSEEK (MARGIN & PREDICT) ===');
  
  // 1. Margin Open - Autonomous
  await runTest('Mở vị thế Margin USDC thế chấp bằng SUI, tôi muốn tự động thực thi không cần duyệt (quyền tự trị).');

  // 2. Margin Close - Require Approval
  await runTest('Bây giờ hãy đóng vị thế Margin trên lại nhưng tạo lệnh để tôi kí duyệt lần cuối.');

  // 3. Predict Open Binary - Autonomous
  await runTest('Mở vị thế Predict dự đoán SUI sẽ tăng giá lên 4.0 trước 2026-05-20, thực thi TỰ ĐỘNG bằng quyền tự trị.');

  // 4. Predict Supply - Autonomous
  await runTest('Cung cấp thanh khoản 100 USDC vào Vault Predict, tự động thực thi.');
}

main();
