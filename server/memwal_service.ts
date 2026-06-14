import { MemWal } from '@mysten-incubation/memwal';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
dotenv.config();

const ZERO_ID = '0x0000000000000000000000000000000000000000000000000000000000000000';
const MEMWAL_ACCOUNT_ID = process.env.MEMWAL_ACCOUNT_ID || ZERO_ID;
const MEMWAL_PRIVATE_KEY = process.env.MEMWAL_PRIVATE_KEY || '0000000000000000000000000000000000000000000000000000000000000000';
// Correct relayer hosts (the old relayer.staging.memwal.ai is deprecated):
//   prod    → https://relayer.memory.walrus.xyz        (mainnet)
//   staging → https://relayer-staging.memory.walrus.xyz (testnet)
const MEMWAL_SERVER_URL = process.env.MEMWAL_SERVER_URL || 'https://relayer-staging.memory.walrus.xyz';
// Explicit opt-in for the Walrus relayer. Default OFF → file-backed local store (no wasted
// relayer round-trips). Set MEMWAL_ENABLED=true once you have relayer-recognized credentials
// (e.g. from app.memwal.com or a self-hosted relayer) to switch to live Walrus Memory.
const MEMWAL_ENABLED = String(process.env.MEMWAL_ENABLED || '').toLowerCase() === 'true';

const DEFAULT_NS = 'suirobo-local-agent';
// Local persistent store root (file-backed fallback so memory survives restarts + syncs per wallet)
const STORE_ROOT = path.join(process.env.SUIROBO_DATA_DIR || process.cwd(), '.memwal_store');

// Sentinel phrases the caller (local_agent auto-RAG) checks for "no useful memory"
export const MEMWAL_EMPTY = 'No relevant memory found in long-term storage.';

interface LocalMemory { id: string; text: string; ts: number; }

/**
 * MemWal service.
 *  - If MEMWAL_ACCOUNT_ID is configured → real Walrus Memory (encrypted, on-chain, cross-device sync via relayer).
 *  - Otherwise → file-backed local persistent store (per-namespace JSON), so chat memory is genuinely
 *    stored and synced across agent restarts. This is NOT the Walrus network, but it is real persistence.
 */
class MemwalService {
  private memwal: MemWal | null = null;
  public readonly mode: 'walrus' | 'local';
  /** When true, the relayer is presumed reachable; flipped to false after an auth/network failure. */
  private walrusHealthy = true;
  /** Per-request default namespace (set by /api/chat to the user's wallet) so agent-invoked
   *  tools store/recall under the correct user even when the LLM omits the namespace arg. */
  private contextNs: string = DEFAULT_NS;

  setContext(namespace?: string) {
    this.contextNs = namespace || DEFAULT_NS;
  }
  private resolveNs(namespace?: string): string {
    return namespace || this.contextNs || DEFAULT_NS;
  }

  constructor() {
    if (MEMWAL_ENABLED && MEMWAL_ACCOUNT_ID !== ZERO_ID) {
      try {
        this.memwal = MemWal.create({
          key: MEMWAL_PRIVATE_KEY,
          accountId: MEMWAL_ACCOUNT_ID,
          serverUrl: MEMWAL_SERVER_URL,
          namespace: DEFAULT_NS,
        });
        this.mode = 'walrus';
        console.log('[MemWal] Connected to Walrus Memory relayer:', MEMWAL_SERVER_URL);
      } catch (e) {
        this.memwal = null;
        this.mode = 'local';
        console.error('[MemWal] Walrus init failed, falling back to local store:', e);
      }
    } else {
      this.mode = 'local';
      const why = MEMWAL_ACCOUNT_ID === ZERO_ID ? 'no MEMWAL_ACCOUNT_ID' : 'MEMWAL_ENABLED!=true';
      console.log(`[MemWal] Local memory store (${why}) at ${STORE_ROOT}`);
    }
    try { if (!fs.existsSync(STORE_ROOT)) fs.mkdirSync(STORE_ROOT, { recursive: true }); } catch {}
  }

  // ── Local file-backed store helpers ──────────────────────────────────────
  private nsFile(ns: string): string {
    const safe = (ns || DEFAULT_NS).replace(/[^a-zA-Z0-9_.-]/g, '_');
    return path.join(STORE_ROOT, `${safe}.json`);
  }
  private loadLocal(ns: string): LocalMemory[] {
    try {
      const f = this.nsFile(ns);
      if (!fs.existsSync(f)) return [];
      return JSON.parse(fs.readFileSync(f, 'utf8')) as LocalMemory[];
    } catch { return []; }
  }
  private saveLocal(ns: string, mems: LocalMemory[]): void {
    fs.writeFileSync(this.nsFile(ns), JSON.stringify(mems, null, 2));
  }
  /** Lightweight token-overlap relevance score (semantic-ish without embeddings). */
  private score(query: string, text: string): number {
    const tok = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) || [];
    const q = new Set(tok(query));
    if (q.size === 0) return 0;
    const t = tok(text);
    let hits = 0;
    for (const w of t) if (q.has(w)) hits++;
    return hits / Math.sqrt(t.length || 1);
  }

  // ── Local store primitives (also used as fallback when relayer is unreachable) ──
  private memorizeLocal(ns: string, text: string): string {
    const mems = this.loadLocal(ns);
    const id = `loc_${ns.slice(0, 6)}_${mems.length + 1}_${(Math.abs(hashStr(text)) % 1e6)}`;
    mems.push({ id, text, ts: Date.now() });
    this.saveLocal(ns, mems);
    return `Stored to local memory (namespace: ${ns}, id: ${id}, total: ${mems.length}).`;
  }
  private recallLocal(ns: string, query: string, limit: number): string {
    const mems = this.loadLocal(ns);
    if (!mems.length) return MEMWAL_EMPTY;
    const ranked = mems
      .map(m => ({ m, s: this.score(query, m.text) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, limit);
    if (!ranked.length) return MEMWAL_EMPTY;
    return ranked.map(x => `- ${x.m.text}`).join('\n');
  }

  // ── Public API (string returns kept for tool/auto-RAG compatibility) ─────
  // Strategy: when a relayer is configured, try Walrus first; on ANY failure
  // (e.g. relayer 401 / network), transparently fall back to the local store so
  // the agent's memory keeps working. We also mirror writes locally as a cache.
  async memorize(text: string, namespace?: string): Promise<string> {
    const ns = this.resolveNs(namespace);
    if (this.memwal && this.walrusHealthy) {
      try {
        const r = await this.memwal.rememberAndWait(text, ns, { timeoutMs: 60000 });
        this.memorizeLocal(ns, text); // mirror as local cache
        return `Stored to Walrus Memory (namespace: ${ns}, blob: ${r.blob_id?.slice(0, 12)}...).`;
      } catch (error: any) {
        this.markWalrusDown('remember', error);
        // fall through to local
      }
    }
    try {
      return this.memorizeLocal(ns, text);
    } catch (e: any) {
      return `Could not store memory: ${e.message}`;
    }
  }

  async recall(query: string, namespace?: string, limit = 3): Promise<string> {
    const ns = this.resolveNs(namespace);
    if (this.memwal && this.walrusHealthy) {
      try {
        const res = await this.memwal.recall(query, limit, ns);
        if (res?.results?.length) return res.results.slice(0, limit).map((r: any) => `- ${r.text}`).join('\n');
        // empty from relayer — still check local cache before giving up
      } catch (error: any) {
        this.markWalrusDown('recall', error);
      }
    }
    return this.recallLocal(ns, query, limit);
  }

  /** After a relayer failure, log once and route subsequent calls to local store. */
  private markWalrusDown(op: string, error: any) {
    if (this.walrusHealthy) {
      console.warn(`[MemWal] ${op} via relayer failed (${error?.status || error?.message || 'error'}). ` +
        `Falling back to local store for this session.`);
      this.walrusHealthy = false;
    }
  }

  /** Sync / rebuild a namespace. Walrus: incremental restore from relayer. Local: report count. */
  async sync(namespace?: string): Promise<{ ok: boolean; mode: string; namespace: string; count: number; message: string }> {
    const ns = this.resolveNs(namespace);
    if (this.memwal && this.walrusHealthy) {
      try {
        const r = await this.memwal.restore(ns);
        return { ok: true, mode: 'walrus', namespace: ns, count: r.restored, message: `Restored ${r.restored} memories from Walrus.` };
      } catch (e: any) {
        this.markWalrusDown('restore', e);
      }
    }
    const mems = this.loadLocal(ns);
    return { ok: true, mode: this.memwal ? 'local (relayer unreachable)' : 'local', namespace: ns, count: mems.length, message: `${mems.length} memories present in local store.` };
  }

  /** Raw stats for a namespace (used by tests / UI). */
  stats(namespace?: string): { mode: string; namespace: string; count: number; file?: string } {
    const ns = this.resolveNs(namespace);
    const mems = this.loadLocal(ns);
    if (this.memwal && this.walrusHealthy) return { mode: 'walrus', namespace: ns, count: mems.length, file: this.nsFile(ns) };
    return { mode: this.memwal ? 'local (relayer unreachable)' : 'local', namespace: ns, count: mems.length, file: this.nsFile(ns) };
  }
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}

export const memwalService = new MemwalService();
