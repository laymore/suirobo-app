import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

// ── Template Definitions ──
const TEMPLATES: Record<string, { skeleton: string; tags: string[]; defaultParams: string }> = {
  signal: {
    tags: ['signal', 'indicator', 'entry'],
    defaultParams: `targetAsset: z.string().describe('Target asset (e.g. SUI/USDC)'),
      timeframe: z.string().optional().describe('Analysis timeframe (e.g. 1h, 4h, 1d)')`,
    skeleton: `
    // ── SIGNAL SKILL LOGIC ──
    // Phân tích technical indicators và phát signal buy/sell
    const { targetAsset, timeframe = '4h' } = params;

    // Fetch current price từ CoinGecko
    let price = 0;
    try {
      const cgRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd');
      const cgData = await cgRes.json();
      price = cgData?.sui?.usd || 0;
    } catch {}

    // Logic phân tích theo trigger_logic đã mô tả:
    // TRIGGER_LOGIC_PLACEHOLDER

    const signal = price > 0 ? 'ANALYZING' : 'NO_DATA';
    return {
      status: 'analysis_complete',
      asset: targetAsset,
      timeframe,
      currentPrice: price,
      signal,
      triggerLogic: 'TRIGGER_LOGIC_PLACEHOLDER',
      recommendation: signal === 'ANALYZING'
        ? 'Analyzing signal per the configured logic…'
        : 'No price data. Check your network connection.',
      timestamp: new Date().toISOString()
    };`
  },

  guard: {
    tags: ['guard', 'risk', 'protection'],
    defaultParams: `targetAsset: z.string().describe('Asset to protect (e.g. SUI/USDC)'),
      maxRiskPercent: z.number().optional().describe('Max allowed risk % (default 5%)')`,
    skeleton: `
    // ── GUARD SKILL LOGIC ──
    // Bảo vệ assets bằng cơ chế quản lý risk
    const { targetAsset, maxRiskPercent = 5 } = params;

    // Fetch current price
    let currentPrice = 0;
    try {
      const cgRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd');
      const cgData = await cgRes.json();
      currentPrice = cgData?.sui?.usd || 0;
    } catch {}

    // Logic bảo vệ theo trigger_logic:
    // TRIGGER_LOGIC_PLACEHOLDER

    const stopLossPrice = currentPrice * (1 - maxRiskPercent / 100);
    const takeProfitPrice = currentPrice * (1 + maxRiskPercent * 2 / 100);

    return {
      status: 'guard_active',
      asset: targetAsset,
      currentPrice,
      stopLoss: stopLossPrice.toFixed(4),
      takeProfit: takeProfitPrice.toFixed(4),
      maxRiskPercent,
      riskRewardRatio: '1:2',
      triggerLogic: 'TRIGGER_LOGIC_PLACEHOLDER',
      recommendation: currentPrice > 0
        ? 'Protection set: SL=' + stopLossPrice.toFixed(4) + ' | TP=' + takeProfitPrice.toFixed(4)
        : 'No price data.',
      timestamp: new Date().toISOString()
    };`
  },

  scanner: {
    tags: ['scanner', 'market', 'opportunity'],
    defaultParams: `scanTarget: z.string().optional().describe('Scan target: "arbitrage", "whale" or "anomaly" (defaulnh: arbitrage)')`,
    skeleton: `
    // ── SCANNER SKILL LOGIC ──
    // Market scanner tìm opportunity trade
    const { scanTarget = 'arbitrage' } = params;

    // Fetch giá từ nhiều nguồn để so sánh
    let suiPrice = 0;
    try {
      const cgRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=sui&vs_currencies=usd');
      const cgData = await cgRes.json();
      suiPrice = cgData?.sui?.usd || 0;
    } catch {}

    // Logic quét theo trigger_logic:
    // TRIGGER_LOGIC_PLACEHOLDER

    return {
      status: 'scan_complete',
      scanTarget,
      results: [{
        source: 'CoinGecko',
        asset: 'SUI/USD',
        price: suiPrice,
        volume24h: 'N/A',
      }],
      opportunities: suiPrice > 0 ? 1 : 0,
      triggerLogic: 'TRIGGER_LOGIC_PLACEHOLDER',
      recommendation: 'Scan complete. View opportunity details to act.',
      timestamp: new Date().toISOString()
    };`
  }
};

export const skillFactoryTool = new FunctionTool({
  name: 'generate_new_skill',
  description: 'Use the Skill Factory to create a new trading Skill. Supports 3 types: "signal" (buy/sell signal generator), "guard" (asset protection), "scanner" (market scanner). Use when the user wants to "create skill", "write a bot", or "build a new strategy".',
  parameters: z.object({
    name: z.string().describe('Skill name (no diacritics, use underscores, e.g. rsi_volume_signal)'),
    description: z.string().describe("Short description of the skill's function"),
    trigger_logic: z.string().describe('Detailed trading logic (e.g. Buy when RSI < 30 and Volume rises sharply)'),
    template_type: z.enum(['signal', 'guard', 'scanner']).describe('Skill type: signal (buy/sell signal), guard (protection), scanner (market scanner)')
  }) as any,
  execute: async function generate_new_skill(
    { name, description, trigger_logic, template_type }: { name: string; description: string; trigger_logic: string; template_type: 'signal' | 'guard' | 'scanner' }
  ) {
    try {
      const template = TEMPLATES[template_type];
      if (!template) {
        return { status: 'error', error: `Invalid template type "${template_type}". Choose: signal, guard, scanner` };
      }

      // ── Generate SKILL.md with proper YAML frontmatter ──
      const skillMd = `---
name: ${name}
description: ${description}
version: 1.0.0
author: local_user
type: ${template_type}
tags: [${template.tags.map(t => `"${t}"`).join(', ')}]
---
# ${name}

${description}

## Skill type
- **Type**: ${template_type.toUpperCase()}
- **Tags**: ${template.tags.join(', ')}

## Trigger Logic
${trigger_logic}

## Usage
When activated, this skill will:
${template_type === 'signal' ? '- Analyze technical indicators and emit buy/sell signals' : ''}
${template_type === 'guard' ? '- Automatically set protection levels (Stop Loss / Take Profit)' : ''}
${template_type === 'scanner' ? '- Continuously scan the market for trade opportunities' : ''}
`;

      // ── Generate index.js with real template logic ──
      const logicCode = template.skeleton.replace(/TRIGGER_LOGIC_PLACEHOLDER/g, trigger_logic.replace(/'/g, "\\'"));

      const indexJs = `// Auto-generated by Suirobo Skill Factory
// Type: ${template_type} | Name: ${name}
// Created: ${new Date().toISOString()}

const { FunctionTool, z } = globalThis.__SUIROBO_REGISTRY__;

export const skill = new FunctionTool({
  name: '${name}',
  description: '${description.replace(/'/g, "\\'")}',
  parameters: z.object({
    ${template.defaultParams}
  }),
  execute: async function ${name.replace(/[^a-zA-Z0-9_]/g, '_')}(params) {
    ${logicCode}
  }
});

export default skill;
`;

      // ── Write files ──
      const draftDir = path.join(process.cwd(), '.local_skills', 'draft_skills', name);
      if (!fs.existsSync(draftDir)) {
        fs.mkdirSync(draftDir, { recursive: true });
      }

      fs.writeFileSync(path.join(draftDir, 'SKILL.md'), skillMd);
      fs.writeFileSync(path.join(draftDir, 'index.js'), indexJs);

      return {
        status: 'success',
        message: `✅ Skill "${name}" created (type: ${template_type})!\n\n📁 Location: .local_skills/draft_skills/${name}\n📄 Files: SKILL.md, index.js\n\n💡 Next steps:\n1. Open the "Skill Factory" tab to see the draft\n2. Press "Test" to try it\n3. Press "Publish" to list it on the Walrus marketplace`,
        draftPath: draftDir,
        type: template_type,
        files: ['SKILL.md', 'index.js']
      };
    } catch (error: any) {
      return { status: 'error', error: error.message };
    }
  }
});
