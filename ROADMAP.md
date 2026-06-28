# 🗺️ Autobots Roadmap

This document tracks the development path, shipped features, and upcoming goals of the **Autobots** ecosystem (built on the Suirobo stack: DeepBook V3 + Margin, Walrus, Pyth, SuiNS).

---

## ✅ Phase 1: Foundation (Completed)
- [x] Integrate the Google ADK framework for the Local Agent.
- [x] Basic Sui on-chain interaction (DeepBook, Margin, Predict).
- [x] Build the Web App (React + Vite) talking to the Local Agent over REST.
- [x] Wallet integration via `@mysten/dapp-kit`.

---

## ✅ Phase 2: Skill Factory fixes & enhancements (Completed)

### 🐛 Key bug fixes
- **[Fixed]** `Tool not found` when generating a skill with DeepSeek in `factory-session`.
- **[Fixed]** Auto `index.js` generation — switched to a `FunctionTool`-compatible format using `globalThis.__SUIROBO_REGISTRY__` so the agent can dynamic-import it successfully.
- **[Fixed]** The enable/disable skill toggle in "My Skills" (MySkillsPanel) now syncs correctly with the backend.
- **[Fixed]** The Visual Node Builder now exports valid, executable `FunctionTool` code instead of pseudo `agent.on()` code.
- **[Fixed]** Installing a skill from the Marketplace now downloads both `SKILL.md` and `index.js`, so installed skills carry real logic, not just metadata.
- **[Fixed]** Publishing to Walrus now packages and uploads the real source code.

### 🌟 Enhancements
- **Fork Skill**: a "🍴 Fork" button to clone an existing Marketplace skill into the Factory for free customization.
- **Real Test Sandbox**: the Test flow now calls `execute()` directly with sample data and returns real JSON output instead of just a syntax check.
- **Code Viewer**: a "📄 View Code" button in the Factory to inspect the source (`SKILL.md` & `index.js`) before publishing.
- **FACTORY_PROMPT upgrade**: the AI Factory now has full context of the system's existing tools (margin, predict, …) to generate smart, non-duplicated skill code.

---

## ✅ Phase 3: On-chain execution fee & leaderboard (Completed)

### 💰 Execution-fee system
- [x] **Smart contract**: `pay_execution_fee` charging **0.05 SUI** per trade
  - 0.025 SUI → Marketplace Treasury
  - 0.025 SUI → a random skill author the wallet owns (via the Sui Randomness Beacon)
  - Fallback: if the wallet owns no skill → the whole fee goes to Treasury
- [x] **`ExecutionFeePaid` event**: on-chain tracking with `payer`, `total_fee`, `platform_share`, `creator_reward`, `rewarded_creator`
- [x] **Fee injection into the PTB**: 6 trade tools auto-inject the fee into the Programmable Transaction Block
  - `margin_open_position`, `margin_close_position`
  - `predict_mint`, `predict_redeem`, `predict_mint_range`, `predict_redeem_range`
- [x] **Backend authors registry**: `/api/skills/authors` stores the skill-author list → passed into tools when building the PTB
- [x] **Fee shown in the UI**: TxConfirmModal displays "💰 Execution fee: 0.05 SUI" on fee-bearing transactions

### 📊 Realtime leaderboard
- [x] Removed all mock data → query on-chain `SkillPurchased` + `ExecutionFeePaid` events
- [x] Aggregate revenue per creator: skill sales + fee rewards = total revenue
- [x] Loading state + refresh button

---

## ✅ Phase 3.5: Advanced features (Completed)
- [x] **Redeploy the smart contract**: re-deployed `suirobo_factory` to Testnet (`0x0a75f0…`) with the 0.05 SUI fee mechanism.
- [x] **Walrus storage & skill sealing**: packaged and uploaded **11 core skills** to Walrus as Sealed Blobs with a 20:80 on-chain revenue split.
- [x] **Equipped 35+ skills**: the dev wallet (`0xafbc48fd…889c5`) was equipped with 35+ skills.
- [x] **Real trade test**: live mainnet trade — Tx Digest `5ecV5e63QJtJsHwDXWWgoZGZXfyrF1CiS5NPrDjGeZWA`.
- [x] **Dynamic marketplace**: wired to Walrus + Sui on-chain events.

---

## ✅ Phase 4: Skill Factory & Walrus/Memwal (Completed)
- [x] Skill Factory with a drag-and-drop Visual Node Builder exporting `FunctionTool`.
- [x] Walrus integration for skill storage & verification.
- [x] Marketplace to buy / rent skills.
- [x] Memwal as shared long-term memory across agents.
- [x] On-chain revenue sharing to skill authors via the smart contract.

---

## ✅ Phase 5: Pure-engine backtest (Completed)

### 🔧 MT5-style engine rebuild
- [x] **`backtestEngine.ts`** — pure function, zero React side effects, < 200 ms for 60k candles.
- [x] **`computeIndicators()`** — EMA 9/21, RSI 14, MACD(12,26,9), Bollinger Bands(20, 2σ).
- [x] **5 signal strategies**: EMA Cross, RSI, MACD Histogram, Bollinger Bands, RSI+MACD hybrid.
- [x] **`detectLiveSignal()`** — shared export used by both Backtest + Live Trade.
- [x] **`configFromBotSkill()`** — converter from Bot Skill → backtest config.

### 🎨 New UI — two TradingView-style modes
- [x] **⚡ Instant Mode** — one click → compute + render immediately (< 50 ms).
- [x] **▶ Visual Replay Mode** — replay candle-by-candle with a progress bar + adjustable speed.
- [x] **Canvas chart** instead of SVG — 10× faster, with EMA/Bollinger overlays.
- [x] **RSI subchart + MACD histogram** with green/red oversold/overbought zones.
- [x] **Accurate entry/exit markers** with dynamic TP/SL/Entry lines (replay mode).
- [x] **10 MT5-style metrics**: Net Profit, Profit Factor, Win Rate, Sharpe, Expectancy, Max Drawdown, Max Consecutive Wins/Losses, Total Commission, Long/Short trades.
- [x] **Realistic commission** — two-sided fee per trade.
- [x] **Direction filter** — Both / Long Only / Short Only.
- [x] **BTC 2025 historical data**: D1 / H4 / H1 / M30 / M15 / M5 (60k+ candles).

---

## ✅ Phase 6: Bot Skill system (Completed)

### 🤖 Bot Skill Builder — a new Factory tab
- [x] **Visual Form Builder** — a no-code UI to create a bot strategy.
- [x] **Realtime strategy preview**: R:R ratio, leverage, % capital, trade direction.
- [x] **Auto-generate `SKILL.md` + `index.js`** compatible with the ADK FunctionTool.
- [x] **Unified schema** (`types/botSkill.ts`) shared by Backtest + Live Trade + Marketplace.
- [x] **localStorage + Server API** (`/api/skills/bot` CRUD) two-way sync.
- [x] **Auto-save stats** — after a backtest, Win Rate / Profit Factor / Sharpe save into the Bot Skill.

### 🔗 Backtest ↔ Bot Skill integration
- [x] **Bot Skill selector** in Backtest — pick a skill → auto-fill the whole config.
- [x] **"⚡ Backtest Now"** from the Factory → auto-navigate to Backtest + preload the skill.
- [x] **Stats on the Skill Card** — Win Rate, Profit Factor, Drawdown after each test.

---

## ✅ Phase 7: Two-mode Live Trade Bot (Completed)

### 🤖 AI Auto Bot Mode (Agent + LLM)
- [x] **Bot Skill + DeepTrade Agent integration** — signal → agent builds the PTB → frontend signs.
- [x] **Realtime WebSocket** (`ws://localhost:8080`) for price/signal/position updates.
- [x] **Auto-confirm toggle** — auto-sign on signal.
- [x] **Multi-provider** — Gemini / DeepSeek / OpenClaw.

### ⚡ Auto Bot Mode (direct autonomous)
- [x] **Direct execution** without the AI agent — the bot builds the PTB via the DeepBook SDK.
- [x] **Server-side keypair signing** — executes `executeTransactionBlock` straight to Sui mainnet.
- [x] **2–3 s per order** (vs 5–10 s through the agent).
- [x] **Private key in RAM only** — never written to disk or a state file.
- [x] **REST endpoints**: `/api/livebot/start,stop,configure,state,clearkey`.

### 📊 Realtime dashboard
- [x] **3 cards**: Price + sparkline, Indicators (RSI/EMA/MACD), Active Position.
- [x] **TP/SL progress bar** in the open position.
- [x] **Trade log** with 5 types (info/signal/trade/error/warning) + icons.
- [x] **Persisted state** (`server/bot_state.json`) across restarts.

---

## ✅ Phase 8: Multi-user Walrus deploy (Completed)

### 🛡️ Setup Wizard for new users
- [x] **`useUserConfig.ts`** — hook managing the API key (localStorage) + private key (sessionStorage).
- [x] **4-step onboarding**: Check Agent → API Key → Connect Wallet → Auto Bot Key (optional).
- [x] **Clear privacy badges** — localStorage / sessionStorage / memory.
- [x] **Auto-detect** the dev wallet from `.env` (server) → no manual entry.

### 🌊 Walrus Sites deploy
- [x] **`dist/ws-resources.json`** — SPA routing fallback + cache headers for assets.
- [x] **`deploy-walrus.ps1`** — PowerShell script: publish / update / sitemap.
- [x] **`deploy-walrus.sh`** — Bash equivalent for Linux/Git Bash.
- [x] **`WALRUS_DEPLOY.md`** — detailed deploy docs (Walgo GUI or CLI).
- [x] **Production build** succeeded: 1.25 MB (gzip 362 KB).
- [x] **Walgo Desktop verified** — tools ready: SUI CLI 1.71, WALRUS CLI 1.48, SITE BUILDER 2.8.0.

### 🔐 Multi-user security
| Data | Stored in | Lifetime |
|------|-----------|----------|
| API Key | localStorage + btoa | Permanent |
| Private Key (Auto Bot) | sessionStorage | Cleared on tab close |
| Bot Config | localStorage | Permanent |
| Profile | localStorage + Walrus sync | Permanent |

→ **No middleman server** — all data stays local on the user's device.

---

## ✅ Phase 9: Sui Skills integration (Completed)

### 📚 Knowledge base for Claude Code & the agent runtime
- [x] **21 official Sui skills** (from `docs.sui.io/skills`) added to `.claude/skills/`.
- [x] **27 ADK runtime skills** under `server/sui_official_skills/` for agent execution.
- [x] **Synced across both locations** — Claude Code IDE skills + agent runtime skills kept consistent.

---

## ✅ Phase 10: Agent distribution & auto-install (Completed)

### 📦 Packaging
- [x] **`server/agent_bootstrap.ts`** — production entry point: auto-start, tray notification, log rotation, crash handler, data dir under `%LOCALAPPDATA%\Suirobo\`.
- [x] **`build_agent.cjs`** — esbuild + pkg pipeline → a single Win-x64 `.exe`.
- [x] **`publish_agent.cjs`** — auto-upload the `.exe` to Walrus + generate a SHA-256 manifest.
- [x] **Auto-register the Windows Run key** — the agent starts on reboot.

### 🌊 Public distribution
- [x] Agent `.exe` published as a downloadable artifact with a SHA-256-verified `public/agent-manifest.json` the web app reads.
- [x] **One-click download UX** with progress + auto-poll `/health` to detect the agent coming online.

---

## ✅ Phase 11: SuiNS domain + Walrus Sites mainnet (Completed)
- [x] **Official URL**: https://autobots.wal.app
- [x] **SuiNS domain**: `autobots.sui` (owned by the dev wallet)
- [x] **Walrus Site object**: `0xf070fa29afac7f54de6f849d6e4391b181ba511205e1e4474cf58bfa39537a81`
- [x] **`link-suins-walrus.ts`** — script that calls `controller::set_user_data` on the SuiNS package and sets the `walrus_site_id` field so the portal resolves the domain.
- [x] **Cloudflare CDN** in front of the Walrus aggregator for fast global loads + free automatic HTTPS.

---

## ✅ Phase 12: Desktop Pro app + Sui-native data + Autobots rebrand (Completed)

### 💻 Autobots Desktop — the full app is the product
- [x] **Electron desktop app** (`npm run app` / `dist:win` → `Autobots.exe`, ~112 MB portable) bundling the local agent + a trimmed UI; the key is entered locally and the bot self-signs 24/7, no browser wallet needed.
- [x] **EA pro toolkit** on desktop: a parameter Optimizer (sweep), a Robustness Lab (period stability + 1000-run Monte-Carlo), and anchored walk-forward (in-sample → out-of-sample).
- [x] **Hard safety interlocks**: kill-switch + max-daily-loss breaker (flatten + halt), a DeepBook liquidation guard, and TP/SL on every position — deterministic, never AI-gated.
- [x] **Unified Account strip + Preferences**; Marketplace browse/install on desktop.
- [x] **Agent API token hardening**: a per-launch random token guarding `/api/*` against unauthorized access.

### 🌊 Sui-native data spine (no CEX REST in the critical path)
- [x] **DA-1** `deepbookTape.ts`: build OHLC candles from the **DeepBook on-chain fill-tape** (`OrderFilled` events, type-origin package) instead of Binance.
- [x] **DA-2** the Backtest Simulator gets a "📡 On-chain" data source (DeepBook fills → candles → engine).
- [x] **DA-3** the live bot can use on-chain candles (opt-in, SUI/USDC): `OnchainCandleFeed` bootstraps once then accumulates new fills each tick — no Binance in the decision loop.
- [x] **Order-book imbalance**: an on-chain L2 DeepBook gauge + an OBI entry filter (live).
- [x] **Verified track record**: per-wallet on-chain bot results surfaced as Marketplace trust badges.

### 🪪 Autobots rebrand + wallet-only web
- [x] **Renamed the download/installer → "Autobots"**; pre-rebrand versions hidden, only Autobots builds listed.
- [x] **Web app refocus**: connecting a Slush wallet is enough to trade — **no key entry, no Setup Wizard**. A 3-rung ladder: Manual / Web Bot (you sign) / Client Bot (= the desktop-download landing). The "AI Agent" rung and the combined client+web mode were removed. The full desktop app is where you enter a key and run the bot 24/7.
- [x] **Home** reworded "agent" → "Autobots Desktop".

---

## 🔮 Phase 13: Autonomous network & native apps (Future Vision)
- [ ] **Move-enforced risk vault** — capability-typed authority (analyst / execute / lifecycle caps) so an automation trades within hard, on-chain-enforced limits it can never exceed.
- [ ] **DeepBook liquidator + cascade radar** — turn on-chain liquidation pressure into both a defensive guard and an opportunity signal.
- [ ] **Inter-agent communication** — agents share trade signals P2P.
- [ ] **Skill governance** — DAO voting to approve skills + automated quality scoring.
- [ ] **Multi-chain expansion** — bridges to other chains.
- [ ] **Bot Skill Marketplace v2** — sub-skill composition, on-chain-verifiable copy-trading.
- [ ] **Mobile companion app** — position monitoring + push notifications.

---

## 📦 Shipped — summary numbers

| Metric | Value |
|--------|-------|
| Smart contracts deployed | Testnet `0x0a75f0…` + Mainnet `0x888f919f…` |
| Skills on Walrus (sealed) | 11+ skills |
| Skills in the Marketplace | 35+ skills |
| Sui official skills (knowledge) | 21 skills × 2 locations |
| Backtest strategies | EMA / RSI / MACD / BB / Hybrid + EA-style engine |
| Backtest timeframes | D1 / H4 / H1 / M30 / M15 / M5 |
| Market-data sources | DeepBook on-chain fill-tape + Binance (web bot) |
| Live Trade clients | Autobots Desktop (24/7 self-sign) + web Web Bot (wallet-signed) |
| Production frontend | Walrus Sites at autobots.wal.app |

---

## 🚀 How to deploy production

```powershell
# Build & deploy to Walrus (first time) — run from the project directory
.\deploy-walrus.ps1 publish

# Update an existing site
.\deploy-walrus.ps1 update -SiteId 0x...
```

See [`WALRUS_DEPLOY.md`](./WALRUS_DEPLOY.md) for details.
