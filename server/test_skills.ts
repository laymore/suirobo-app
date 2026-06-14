import { marginAnalyzerSkill } from '../src/agent/skills/margin_analyzer.js';
import { tokenAnalyzerSkill } from '../src/agent/skills/token_analyzer.js';
import { predictAnalyzerSkill } from '../src/agent/skills/predict_analyzer.js';

async function runSkillTests() {
  console.log("=================================================");
  console.log("🚀 Bắt đầu test Hệ Thống Skills của DeepTrade (ADK)");
  console.log("=================================================\n");

  // Test 1: Margin Analyzer Skill
  console.log("--- TEST 1: Phân tích Margin ---");
  console.log("Mục tiêu: Đánh giá khả năng mở lệnh Long/Short với SUI");
  const marginResult = await marginAnalyzerSkill.execute({
    asset: 'SUI',
    walletAddress: '0xafbc48fd349fb44ce9c6f2b33423e6ae7c826d53a25920a0d4c3c475e40889c5'
  });
  console.log(marginResult);
  console.log("\n");

  // Test 2: Token Analyzer Skill
  console.log("--- TEST 2: Phân tích Token ---");
  console.log("Mục tiêu: Kiểm tra thanh khoản của cặp SUI/USDC");
  const tokenResult = await tokenAnalyzerSkill.execute({
    poolId: 'SUI/USDC'
  });
  console.log(tokenResult);
  console.log("\n");

  // Test 3: Predict Analyzer Skill
  console.log("--- TEST 3: Phân tích Predict ---");
  console.log("Mục tiêu: Đề xuất chiến lược Predict cho BTC");
  const predictResult = await predictAnalyzerSkill.execute({
    asset: 'BTC'
  });
  console.log(predictResult);
  console.log("\n");
  
  console.log("✅ Hoàn tất bài test Skills System!");
}

runSkillTests().catch(console.error);
