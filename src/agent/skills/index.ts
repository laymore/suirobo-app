import { marginAnalyzerSkill } from './margin_analyzer.js';
import { tokenAnalyzerSkill } from './token_analyzer.js';
import { predictAnalyzerSkill } from './predict_analyzer.js';
import { marginRiskGuardSkill } from './margin_risk_guard.js';
import { marginEntryStrategistSkill } from './margin_entry_strategist.js';
import { predictOpportunityScannerSkill } from './predict_opportunity_scanner.js';
import { predictPositionMonitorSkill } from './predict_position_monitor.js';
import { marginPortfolioGuardianSkill } from './margin_portfolio_guardian.js';
import { predictMultiAssetAllocatorSkill } from './predict_multi_asset_allocator.js';
import { autoSlTpManagerSkill } from './auto_sl_tp_manager.js';
import { skillFactoryTool } from './skill_factory.js';
import { deepbookDataSkill } from './deepbook_data_skill.js';

export * from './margin_risk_guard.js';
export * from './margin_entry_strategist.js';
export * from './margin_portfolio_guardian.js';
export * from './auto_sl_tp_manager.js';

export const agentSkills = [
  // Core (Basic)
  marginAnalyzerSkill,
  tokenAnalyzerSkill,
  predictAnalyzerSkill,
  skillFactoryTool, // NEW: Skill Factory Tool
  deepbookDataSkill, // REPLACES MCP: Fetch real-time data as a skill
  // Advanced Margin Skills
  marginRiskGuardSkill,
  marginEntryStrategistSkill,
  marginPortfolioGuardianSkill,       // NEW: Giám sát danh mục liên tục
  // Advanced Predict Skills
  predictOpportunityScannerSkill,
  predictPositionMonitorSkill,
  predictMultiAssetAllocatorSkill,    // NEW: Phân bổ vốn Kelly Criterion
  // autoSlTpManagerSkill,               // Removed: Moved to Premium Marketplace
];
