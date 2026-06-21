/**
 * Live Bot Control — tools the AI Assistant uses in AUTONOMOUS mode to drive
 * the Live Trade 24/7 bot on the user's behalf.
 *
 * Authorization model:
 *  - All four tools sit OUTSIDE the Manual-mode allowlist in local_agent.ts,
 *    so the LLM only sees them when the user has flipped the assistant into
 *    Autonomous. In Manual mode the AI literally cannot fire these calls.
 *  - Every tool is server-local (`http://localhost:3001`) so the agent can
 *    only steer the user's own machine — never a third party.
 *
 * Conversational flow expected from the LLM:
 *  1. User: "run a bot on SUI" → agent calls list_bot_skills.
 *  2. Agent shows the list, lets user pick one (by name).
 *  3. Agent calls start_auto_bot with the chosen skill.
 *  4. Agent polls get_auto_bot_status (or relies on user follow-ups).
 *  5. User: "stop the bot" → agent calls stop_auto_bot.
 *
 * Risk handling: start_auto_bot ALWAYS reads back the current bot state first
 * to refuse if a bot is already running, and validates that the requested
 * skill exists in the known set (presets + server-stored) before launching.
 */
import { FunctionTool } from '@google/adk';
import { z } from 'zod';
import { PRESET_SKILLS } from '../../types/botSkill';

const AGENT_BASE = 'http://localhost:3001';

// ── tool 1: list_bot_skills ──────────────────────────────────────────────────
export const listBotSkills = new FunctionTool({
  name: 'list_bot_skills',
  description:
    'List bot skills available to run in Live Trade. Returns both the curated AI-research presets ' +
    '(sui_alpha_m30, sui_ema_h1, ...) and any user-created skills stored on this machine. ' +
    'Call this FIRST when the user asks the assistant to run a bot — present the list and ask which one to use.',
  parameters: z.object({}) as any,
  execute: async () => {
    let server: any[] = [];
    try {
      const r = await fetch(`${AGENT_BASE}/api/skills/bot`);
      if (r.ok) {
        const j = await r.json() as any;
        server = Array.isArray(j.skills) ? j.skills : [];
      }
    } catch { /* server unreachable — fall back to presets only */ }

    // Merge: presets first, then any user skills (de-dupe by name)
    const byName = new Map<string, any>();
    for (const p of PRESET_SKILLS) byName.set(p.name, { ...p, source: 'preset' });
    for (const s of server) byName.set(s.name, { ...s, source: byName.has(s.name) ? 'preset+local' : 'local' });

    const skills = Array.from(byName.values()).map(s => ({
      name: s.name,
      description: s.description,
      signal: s.signal,
      timeframe: s.preferredTimeframe ?? s.lastStats?.timeframe ?? '?',
      asset: s.preferredAsset ?? s.lastStats?.asset ?? '?',
      leverage: s.leverage,
      tpPct: s.takeProfitPct,
      slPct: s.stopLossPct,
      direction: s.direction,
      lastBacktest: s.lastStats ? {
        netProfitPct: s.lastStats.netProfitPct,
        maxDrawdownPct: s.lastStats.maxDrawdownPct,
        winRate: s.lastStats.winRate,
        duration: s.lastStats.duration,
      } : undefined,
      source: s.source,
    }));

    return { status: 'success', count: skills.length, skills };
  },
});

// ── tool 2: start_auto_bot ───────────────────────────────────────────────────
export const startAutoBot = new FunctionTool({
  name: 'start_auto_bot',
  description:
    'Start the Live Trade 24/7 Auto Bot using a named bot skill. The bot then runs autonomously: ' +
    'it watches price feeds, fires its strategy signal, and self-signs every open/close trade on chain. ' +
    'Before calling: (1) confirm the skill name with the user via list_bot_skills, ' +
    '(2) confirm the trading pair and capital, (3) check status with get_auto_bot_status to make sure no bot is already running. ' +
    'The user already configured their private key in the Setup Wizard — the server uses that. ' +
    'Returns the running bot state on success.',
  parameters: z.object({
    skillName:    z.string().describe('Exact bot skill name from list_bot_skills (e.g. "sui_alpha_m30").'),
    pair:         z.enum(['SUI_USDC', 'XBTC_USDC']).describe('Trading pair. SUI_USDC uses DeepBook Margin; XBTC_USDC uses DeepTrade spot.'),
    capitalUSDC:  z.number().positive().describe('Capital allocated to the bot in USDC (e.g. 5). Each entry uses skill.orderPct of this.'),
    walletAddress:z.string().describe("User's Sui wallet address (provided in system context — pass it verbatim)."),
    timeframe:    z.enum(['5m', '15m', '30m', '1h']).optional().describe('Candle timeframe. Defaults to the skill\'s preferred timeframe.'),
  }) as any,
  execute: async ({ skillName, pair, capitalUSDC, walletAddress, timeframe }) => {
    // 1. Resolve the skill from presets (server-stored skills are pulled by list_bot_skills caller flow; presets cover both SUI bots).
    const preset = PRESET_SKILLS.find(s => s.name.toLowerCase() === skillName.toLowerCase());
    let skill: any = preset;
    if (!skill) {
      // Try server-stored bot skills
      try {
        const r = await fetch(`${AGENT_BASE}/api/skills/bot`);
        if (r.ok) {
          const j = await r.json() as any;
          skill = (j.skills || []).find((s: any) => s.name?.toLowerCase() === skillName.toLowerCase());
        }
      } catch { /* ignore */ }
    }
    if (!skill) {
      return { status: 'error', message: `Bot skill "${skillName}" not found. Use list_bot_skills to see available names.` };
    }

    // 2. Make sure no bot is already running
    try {
      const stateRes = await fetch(`${AGENT_BASE}/api/livebot/state`);
      if (stateRes.ok) {
        const state = await stateRes.json() as any;
        if (state?.active) {
          return {
            status: 'error',
            message: `A bot is already running (${state.config?.botSkillName ?? 'unknown'}). Call stop_auto_bot first if you want to swap to "${skillName}".`,
          };
        }
      }
    } catch { /* if state endpoint is unreachable, proceed and let start fail with a clearer error */ }

    // 3. Build LiveBotConfig
    const tfMap: Record<string, string> = { M5: '5m', M15: '15m', M30: '30m', H1: '1h' };
    const resolvedTF = timeframe || tfMap[skill.preferredTimeframe ?? ''] || '30m';
    const config = {
      botSkillName: skill.name, signal: skill.signal,
      filters: skill.filters,
      direction: skill.direction,
      takeProfitPct: skill.takeProfitPct, stopLossPct: skill.stopLossPct,
      trailingStopPct: skill.trailingStopPct || 0,
      enableTrailing: !!skill.enableTrailing, enableDefense: skill.enableDefense !== false,
      leverage: skill.leverage, orderPct: skill.orderPct, commission: skill.commission ?? 0.05,
      // EA money-management module — same fields the backtester validated with.
      // Without these, a v2 skill started via chat would silently drop its
      // breakeven/cooldown/risk rules and trade differently from its backtest.
      supertrendPeriod:    skill.supertrendPeriod,
      supertrendMult:      skill.supertrendMult,
      breakoutPeriod:      skill.breakoutPeriod,
      maxBarsInTrade:      skill.maxBarsInTrade,
      htfMinutes:          skill.htfMinutes,
      htfSupertrendPeriod: skill.htfSupertrendPeriod,
      htfSupertrendMult:   skill.htfSupertrendMult,
      sizingMode:          skill.sizingMode,
      riskPct:             skill.riskPct,
      breakEvenTriggerPct: skill.breakEvenTriggerPct,
      cooldownBars:        skill.cooldownBars,
      maxConsecLosses:     skill.maxConsecLosses,
      maxDailyLossPct:     skill.maxDailyLossPct,
      sessionStartHour:    skill.sessionStartHour,
      sessionEndHour:      skill.sessionEndHour,
      timeframe: resolvedTF, pair, capitalSUI: capitalUSDC,
      walletAddress,
      directMode: true,                                  // AI uses the server-cached key (.env or wizard-loaded via /api/livebot/setkey)
      skillAuthor: skill.authorAddress || undefined,    // 0.005 SUI per-open author share routing
    };

    // 4. Start
    try {
      const r = await fetch(`${AGENT_BASE}/api/livebot/start`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config }),
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => '');
        return { status: 'error', message: `Bot start failed: ${r.status} ${txt}` };
      }
      return {
        status: 'success',
        message: `🤖 Bot "${skill.name}" launched on ${pair} ${resolvedTF} with ${capitalUSDC} USDC. ` +
                 `It will self-sign every trade. Use get_auto_bot_status to monitor or stop_auto_bot to halt.`,
        skill: skill.name, pair, timeframe: resolvedTF, capitalUSDC,
      };
    } catch (e: any) {
      return { status: 'error', message: `Could not reach the Local Agent: ${e.message}` };
    }
  },
});

// ── tool 3: stop_auto_bot ────────────────────────────────────────────────────
export const stopAutoBot = new FunctionTool({
  name: 'stop_auto_bot',
  description:
    'Stop the currently running Live Trade Auto Bot. Pending open positions are NOT auto-closed — ' +
    'just the signal polling halts. To exit a position the user must close it manually in Manual Trade, ' +
    'or re-start the bot which will manage existing positions per its strategy.',
  parameters: z.object({}) as any,
  execute: async () => {
    try {
      const r = await fetch(`${AGENT_BASE}/api/livebot/stop`, { method: 'POST' });
      if (!r.ok) return { status: 'error', message: `Stop failed: ${r.status}` };
      return { status: 'success', message: '⏹ Bot stopped. Open positions (if any) are left as-is — manage them in Manual Trade.' };
    } catch (e: any) {
      return { status: 'error', message: `Could not reach the Local Agent: ${e.message}` };
    }
  },
});

// ── tool 4: get_auto_bot_status ──────────────────────────────────────────────
export const getAutoBotStatus = new FunctionTool({
  name: 'get_auto_bot_status',
  description:
    'Get the current Live Trade Auto Bot status — whether it is active, which skill is loaded, ' +
    'the open position (if any), unrealized PnL, last signal, and total trades since start.',
  parameters: z.object({}) as any,
  execute: async () => {
    try {
      const r = await fetch(`${AGENT_BASE}/api/livebot/state`);
      if (!r.ok) return { status: 'error', message: `State endpoint returned ${r.status}` };
      const s = await r.json() as any;
      return {
        status: 'success',
        active: !!s.active,
        mode: s.mode,
        skillName: s.config?.botSkillName ?? null,
        pair: s.config?.pair ?? null,
        timeframe: s.config?.timeframe ?? null,
        leverage: s.config?.leverage ?? null,
        currentPrice: s.currentPrice ?? null,
        lastSignal: s.lastSignal ?? null,
        position: s.position ?? null,
        tradeCount: s.tradeCount ?? 0,
        totalPnl: s.totalPnl ?? 0,
        lastUpdate: s.lastUpdate ?? null,
      };
    } catch (e: any) {
      return { status: 'error', message: `Could not reach the Local Agent: ${e.message}` };
    }
  },
});

export const liveBotControlTools = [listBotSkills, startAutoBot, stopAutoBot, getAutoBotStatus];
