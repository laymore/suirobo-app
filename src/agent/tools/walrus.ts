/**
 * Walrus & Skill Registry Tools — Đọc/ghi dữ liệu phi tập trung
 */
import {   FunctionTool   } from '@google/adk';
import { z } from 'zod';

const WALRUS_AGGREGATOR = 'https://aggregator.walrus-testnet.walrus.space';

// ── Tool: Đọc blob từ Walrus ──────────────────────────────────────────────────
export const readWalrusBlob = new FunctionTool({
  name: 'read_walrus_blob',
  description: 'Read blob content from Walrus decentralized storage by Blob ID.',
  parameters: z.object({
    blobId: z.string().describe('Walrus blob ID (base58 string)'),
  }) as any,
  execute: async ({ blobId }) => {
    try {
      const res = await fetch(`${WALRUS_AGGREGATOR}/v1/${blobId}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` };
      const text = await res.text();
      return { status: 'success', blobId, contentLength: text.length, full: text };
    } catch (e: any) {
      return { status: 'error', message: e.message };
    }
  },
});

// ── Tool: Liệt kê Skills ─────────────────────────────────────────
export const listSkills = new FunctionTool({
  name: 'list_skills',
  description: 'List all skills available on the interface (both Public and User-owned).',
  parameters: z.object({}) as any,
  execute: async () => {
    // Đọc từ localStorage (được quản lý bởi App.tsx)
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('suirobo_active_skills') : null;
    const skills = stored ? JSON.parse(stored) : [];
    return { status: 'success', total: skills.length, skills };
  },
});

// ── Tool: Đọc chi tiết một Skill ─────────────────────────────────────────────
export const getSkillDetail = new FunctionTool({
  name: 'get_skill_detail',
  description: 'Read detailed content of a skill by name.',
  parameters: z.object({
    skillName: z.string().describe('Skill name to read'),
  }) as any,
  execute: async ({ skillName }) => {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('suirobo_active_skills') : null;
    const skills = stored ? JSON.parse(stored) : [];
    const skill = skills.find((s: any) => s.name === skillName);
    if (!skill) return { status: 'error', message: `Skill ${skillName} not found` };
    
    if (skill.blobId) {
      // Fetch from Walrus
      const res = await fetch(`${WALRUS_AGGREGATOR}/v1/${skill.blobId}`);
      if (res.ok) {
        skill.content = await res.text();
      }
    }
    return { status: 'success', skill };
  },
});

// ── Tool: Agent Identity từ Walrus ────────────────────────────────────────────
export const getAgentIdentity = new FunctionTool({
  name: 'get_agent_identity',
  description:
    'Reads the agent identity profile from a Walrus blob (name, permissions). ' +
    'The blob ID is bound to the user wallet address.',
  parameters: z.object({
    walletAddress: z.string().describe('User Sui wallet address'),
  }) as any,
  execute: async ({ walletAddress }) => {
    // Trong thực tế: lookup blobId từ on-chain mapping
    // Tạm thời trả về identity mặc định
    const shortAddr = `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`;
    return {
      status: 'success',
      identity: {
        walletAddress: shortAddr,
        agentName: `SUIROBO-${walletAddress.slice(-6)}`,
        gender: 'female',
        language: 'vi',
        permissions: ['view_balance', 'prepare_trades', 'read_walrus'],
        restricted: ['auto_sign_tx'],
        note: 'The agent must NOT self-sign trades. The user confirms in their wallet.',
      },
    };
  },
});
