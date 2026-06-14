const { execSync } = require('child_process');

const coreSkills = [
  { name: 'Margin Analyzer', desc: 'Phân tích Oracle, thanh khoản và vị thế Margin', blob: 'b1', price: 100000000 },
  { name: 'Token Analyzer', desc: 'Đánh giá thanh khoản và slippage của token', blob: 'b2', price: 150000000 },
  { name: 'Predict Analyzer', desc: 'Phân tích TVL Vault và Oracle để khuyến nghị UP/DOWN', blob: 'b3', price: 200000000 },
  { name: 'Margin Risk Guard', desc: 'Phân tích rủi ro sâu: Health Factor, LTV, giá thanh lý', blob: 'b4', price: 250000000 },
  { name: 'Margin Entry Strategist', desc: 'Tìm điểm vào lệnh thông minh với SL/TP tự động', blob: 'b5', price: 300000000 },
  { name: 'Margin Portfolio Guardian', desc: 'Giám sát liên tục toàn bộ danh mục Margin', blob: 'b6', price: 200000000 },
  { name: 'Predict Opportunity Scanner', desc: 'Black-Scholes scanner cho Binary Options', blob: 'b7', price: 500000000 },
  { name: 'Predict Position Monitor', desc: 'Theo dõi P&L vị thế Predict', blob: 'b8', price: 100000000 },
  { name: 'Predict Multi-Asset Allocator', desc: 'Phân bổ vốn Kelly Criterion đa tài sản', blob: 'b9', price: 400000000 },
  { name: 'Memorize Info', desc: 'Lưu thông tin vào bộ nhớ Walrus Memory', blob: 'b10', price: 0 },
  { name: 'Recall Memory', desc: 'Truy xuất ký ức từ bộ nhớ dài hạn', blob: 'b11', price: 0 }
];

console.log('Publishing 11 core skills...');
for (const skill of coreSkills) {
  const cmd = `sui client call --package 0x0a75f0b57015f967e3cb336585695a5c2e89f5ec9a74fec711361b9453d71a10 --module suirobo_factory --function publish_skill --args "${skill.name}" "${skill.desc}" "${skill.blob}" "1.0.0" ${skill.price} --gas-budget 50000000`;
  console.log('Running:', skill.name);
  try {
    execSync(cmd, { stdio: 'ignore' });
    console.log('-> Success:', skill.name);
  } catch(e) {
    console.error('-> Failed:', skill.name);
  }
}
console.log('Done!');
