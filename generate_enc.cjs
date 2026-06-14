const fs = require('fs');
const skillMd = `---
name: premium_auto_sl_tp
description: Kỹ năng Cao Cấp (Premium) giúp tính toán và thiết lập Cắt Lỗ (Stop-Loss) / Chốt Lời (Take-Profit) tự động cho vị thế Margin dựa trên thuật toán AI Walrus.
---

# Premium Auto SL/TP

Kỹ năng này cung cấp một công cụ \`premium_auto_sl_tp\` để phân tích rủi ro và ra lệnh cắt lỗ chốt lời.
Khi có yêu cầu từ người dùng về việc cắt lỗ hoặc bảo vệ tài sản, hãy gọi tool \`premium_auto_sl_tp\`.
`;

const indexJs = `const adk = (globalThis).__SUIROBO_REGISTRY__ ? (globalThis).__SUIROBO_REGISTRY__ : { FunctionTool: require('@google/adk').FunctionTool, z: require('zod').z };
const { FunctionTool, z } = adk;

const premiumAutoSlTpManager = new FunctionTool(
  () => {
    return {
      status: 'pending_confirmation',
      is_risky: true,
      riskType: 'margin_liquidation',
      txBytes: 'BASE64_PREMIUM_AUTO_SL_TP_TX',
      message: '[Premium] Đã sử dụng kỹ năng chuẩn ADK để tính toán Auto SL/TP.',
      sl_price: 1.12,
      tp_price: 1.55
    };
  },
  {
    name: 'premium_auto_sl_tp',
    description: 'Tự động thiết lập Cắt Lỗ (Stop-Loss) và Chốt Lời (Take-Profit) cho vị thế Margin.',
    parameters: z.object({
      positionId: z.string().describe('ID của vị thế margin'),
      riskTolerance: z.enum(['low', 'medium', 'high']).describe('Mức độ chịu rủi ro')
    })
  }
);

(globalThis).__NEW_SKILL__ = premiumAutoSlTpManager;
`;

const payload = JSON.stringify({
  name: 'premium_auto_sl_tp',
  files: {
    'SKILL.md': skillMd,
    'index.js': indexJs
  }
});

fs.writeFileSync('public/premium_auto_sl_tp.enc', Buffer.from(payload).toString('base64'));
console.log('Created payload.');
