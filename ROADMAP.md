# 🗺️ Autobots Roadmap

Tài liệu này theo dõi lộ trình phát triển, các tính năng đã hoàn thành và những mục tiêu tiếp theo của hệ sinh thái **Autobots** (built on the Suirobo stack: DeepBook V3 + Margin, Walrus, Pyth, SuiNS).

---

## ✅ Giai đoạn 1: Xây dựng Nền tảng (Completed)
- [x] Tích hợp Google ADK framework cho Local Agent.
- [x] Giao tiếp cơ bản với blockchain Sui (DeepBook, Margin, Predict).
- [x] Xây dựng giao diện Web App (React + Vite) kết nối Local Agent qua REST API.
- [x] Tích hợp ví Sui qua `@mysten/dapp-kit`.

---

## ✅ Giai đoạn 2: Cải tiến & Sửa lỗi Skill Factory (Hoàn thành)

### 🐛 Bug Fixes Khóa
- **[Fixed]** Lỗi `Tool not found` khi dùng mô hình DeepSeek tạo skill trong `factory-session`.
- **[Fixed]** Logic tạo `index.js` tự động — đã chuyển sang định dạng tương thích `FunctionTool` sử dụng `globalThis.__SUIROBO_REGISTRY__` để Agent có thể nạp động (dynamic import) thành công.
- **[Fixed]** Nút Toggle Bật/Tắt skill trong "Kho Của Tôi" (MySkillsPanel) đã hoạt động chính xác với hệ thống backend.
- **[Fixed]** Trình kéo thả *Visual Node Builder* xuất code chuẩn `FunctionTool` thực thi được, thay vì mã giả `agent.on()`.
- **[Fixed]** Cài đặt Skill từ Marketplace giờ đây tải đầy đủ cả `SKILL.md` và `index.js`, đảm bảo skill có logic hoạt động thay vì chỉ là metadata.
- **[Fixed]** Tính năng Publish lên Walrus đã đóng gói và tải lên toàn bộ source code thực tế.

### 🌟 Tính năng Bổ sung (Enhancements)
- **Fork Skill**: Nút "🍴 Fork" cho phép người dùng nhân bản một skill có sẵn từ Marketplace vào Xưởng Tạo để tự do tuỳ chỉnh logic.
- **Test Sandbox Thực Tế**: Cải tiến luồng Test, gọi trực tiếp hàm `execute()` với dữ liệu mẫu và trả về kết quả JSON thật thay vì chỉ kiểm tra cú pháp (syntax check).
- **Trình Xem Code (Code Viewer)**: Thêm nút "📄 Xem Code" trong Xưởng Tạo để xem chi tiết mã nguồn (`SKILL.md` & `index.js`) trước khi publish.
- **Nâng cấp FACTORY_PROMPT**: AI Factory giờ đã nắm được toàn bộ context về các tools hiện có của hệ thống (margin, predict...) để sinh mã nguồn skill thông minh và không trùng lặp.

---

## ✅ Giai đoạn 3: Thu Phí Thực Thi On-chain & Bảng Xếp Hạng (Hoàn thành)

### 💰 Hệ thống Thu Phí Thực Thi (Execution Fee)
- [x] **Smart Contract**: `pay_execution_fee` nâng cấp lên **0.05 SUI** mỗi lệnh trade
  - 0.025 SUI → Marketplace Treasury
  - 0.025 SUI → Random 1 tác giả skill mà ví đó sở hữu (qua Sui Randomness Beacon)
  - Fallback: nếu chưa sở hữu skill → toàn bộ vào Treasury
- [x] **Event `ExecutionFeePaid`**: Tracking on-chain với `payer`, `total_fee`, `platform_share`, `creator_reward`, `rewarded_creator`
- [x] **Fee Injection vào PTB**: 6 tool trade tự động inject phí vào Programmable Transaction Block
  - `margin_open_position`, `margin_close_position`
  - `predict_mint`, `predict_redeem`, `predict_mint_range`, `predict_redeem_range`
- [x] **Backend Authors Registry**: API `/api/skills/authors` lưu danh sách tác giả skill → truyền vào tools khi build PTB
- [x] **Frontend hiển thị phí**: TxConfirmModal hiển thị "💰 Phí thực thi: 0.05 SUI" khi giao dịch có phí

### 📊 Bảng Xếp Hạng Realtime (Leaderboard)
- [x] Xóa toàn bộ mock data → Query on-chain events `SkillPurchased` + `ExecutionFeePaid`
- [x] Aggregate doanh thu theo creator: skill sales + fee rewards = total revenue
- [x] Loading state + nút Làm mới

---

## ✅ Giai đoạn 3.5: Tính năng Nâng cao (Hoàn thành)
- [x] **Deploy Smart Contract mới**: Re-deploy `suirobo_factory` lên Testnet (`0x0a75f0...`) với cơ chế phí 0.05 SUI.
- [x] **Walrus Storage & Skill Sealing**: Đóng gói và upload **11 skill cốt lõi** lên Walrus dưới dạng Sealed Blobs với chia sẻ doanh thu 20:80 on-chain.
- [x] **Trang bị 35+ Kỹ năng**: Ví dev `0xafbc48fd...889c5` đã được trang bị 35+ skills.
- [x] **Kiểm thử giao dịch thực tế**: Trade thật Mainnet — Tx Digest `5ecV5e63QJtJsHwDXWWgoZGZXfyrF1CiS5NPrDjGeZWA`.
- [x] **Marketplace động**: Kết nối Walrus + Sui on-chain events.

---

## ✅ Giai đoạn 4: Skill Factory & Walrus/Memwal (Hoàn thành)
- [x] Xưởng Sản Xuất Skill với Visual Node Builder kéo thả xuất `FunctionTool`.
- [x] Tích hợp Walrus lưu trữ & xác minh dữ liệu skill.
- [x] Marketplace mua bán / cho thuê Skill.
- [x] Memwal làm bộ nhớ dài hạn chia sẻ giữa các agent.
- [x] Cơ chế chia sẻ doanh thu cho tác giả Skill qua Smart Contract.

---

## ✅ Giai đoạn 5: Pure Engine Backtest (Hoàn thành — Cập nhật)

### 🔧 Rebuild MT5-style Engine
- [x] **`backtestEngine.ts`** — Pure function, zero React side effects, < 200ms cho 60k nến.
- [x] **`computeIndicators()`** — EMA 9/21, RSI 14, MACD(12,26,9), Bollinger Bands(20,2σ).
- [x] **5 chiến lược signal**: EMA Cross, RSI, MACD Histogram, Bollinger Bands, RSI+MACD Hybrid.
- [x] **`detectLiveSignal()`** — Export hàm dùng chung cho cả Backtest + Live Trade.
- [x] **`configFromBotSkill()`** — Converter từ Bot Skill → Backtest config.

### 🎨 UI Mới — 2 Mode TradingView-style
- [x] **⚡ Instant Mode** — Click 1 lần → tính toán + render hoàn thành ngay (< 50ms).
- [x] **▶ Visual Replay Mode** — Phát lại từng nến với progress bar + tốc độ điều chỉnh.
- [x] **Canvas chart** thay SVG — vẽ nhanh hơn 10x, có EMA/Bollinger overlay.
- [x] **RSI subchart + MACD histogram** với vùng oversold/overbought màu xanh/đỏ.
- [x] **Entry/Exit markers chính xác** với TP/SL/Entry lines động (replay mode).
- [x] **10 chỉ số MT5-style**: Net Profit, Profit Factor, Win Rate, Sharpe Ratio, Expectancy, Max Drawdown, Max Consecutive Wins/Losses, Total Commission, Long/Short trades.
- [x] **Commission realistic** — phí 2 chiều mỗi lệnh.
- [x] **Direction filter** — Both / Long Only / Short Only.
- [x] **BTC 2025 historical data**: D1 / H4 / H1 / M30 / M15 / M5 (60k+ nến).

---

## ✅ Giai đoạn 6: Bot Skill System (Hoàn thành)

### 🤖 Bot Skill Builder — Tab mới trong Xưởng Kỹ Năng
- [x] **Visual Form Builder** — UI trực quan tạo bot strategy không cần code.
- [x] **Strategy Preview** realtime: R:R Ratio, đòn bẩy, % vốn, hướng giao dịch.
- [x] **Auto-generate `SKILL.md` + `index.js`** tương thích ADK FunctionTool.
- [x] **Schema thống nhất** (`types/botSkill.ts`) dùng chung cho Backtest + Live Trade + Marketplace.
- [x] **localStorage + Server API** (`/api/skills/bot` CRUD) đồng bộ 2 chiều.
- [x] **Stats auto-save** — Backtest xong tự lưu Win Rate / Profit Factor / Sharpe vào Bot Skill.

### 🔗 Tích Hợp Backtest ↔ Bot Skill
- [x] **Bot Skills selector** trong Backtest — chọn skill → auto-fill toàn bộ config.
- [x] **"⚡ Backtest Ngay"** từ Factory → tự navigate sang Backtest + preload skill.
- [x] **Stats hiển thị trên Skill Card** — WinRate, P.Factor, Drawdown sau mỗi lần test.

---

## ✅ Giai đoạn 7: Live Trade Bot 2-Mode (Hoàn thành)

### 🤖 AI Auto Bot Mode (Agent + LLM)
- [x] **Bot Skill + DeepTrade Agent integration** — Signal → Agent build PTB → Frontend ký.
- [x] **WebSocket realtime** (`ws://localhost:8080`) cho price/signal/position updates.
- [x] **Auto-confirm toggle** — Tự động ký giao dịch khi có tín hiệu.
- [x] **Multi-provider** — Gemini / DeepSeek / OpenClaw.

### ⚡ Auto Bot Mode (Direct Autonomous)
- [x] **Direct execution** không cần AI Agent — Bot tự build PTB qua DeepBook SDK.
- [x] **Sign keypair on server** — Execute thẳng `executeTransactionBlock` lên Sui Mainnet.
- [x] **Tốc độ 2-3 giây/lệnh** (so với 5-10s qua Agent).
- [x] **Private key in RAM only** — Không bao giờ ghi disk hay state file.
- [x] **REST endpoints**: `/api/livebot/start,stop,configure,state,clearkey`.

### 📊 Dashboard Realtime
- [x] **3 cards**: Price + Sparkline, Indicators (RSI/EMA/MACD), Active Position.
- [x] **TP/SL Progress bar** trực quan trong vị thế mở.
- [x] **Trade log** với 5 loại (info/signal/trade/error/warning) + icons.
- [x] **Persist state** (`server/bot_state.json`) qua restart.

---

## ✅ Giai đoạn 8: Multi-User Walrus Deploy (Hoàn thành)

### 🛡️ Setup Wizard cho User Mới
- [x] **`useUserConfig.ts`** — Hook quản lý API Key (localStorage) + Private Key (sessionStorage).
- [x] **4-step Onboarding**: Check Agent → API Key → Connect Wallet → Auto Bot Key (optional).
- [x] **Privacy badges** rõ ràng — localStorage / sessionStorage / memory.
- [x] **Auto-detect** dev wallet từ `.env` (server) → không cần nhập thủ công.

### 🌊 Walrus Sites Deploy
- [x] **`dist/ws-resources.json`** — SPA routing fallback + cache headers cho assets.
- [x] **`deploy-walrus.ps1`** — PowerShell script: publish / update / sitemap.
- [x] **`deploy-walrus.sh`** — Bash script tương đương cho Linux/Git Bash.
- [x] **`WALRUS_DEPLOY.md`** — Tài liệu chi tiết deploy qua Walgo GUI hoặc CLI.
- [x] **Build production** thành công: 1.25 MB (gzip 362 KB).
- [x] **Walgo Desktop verified** — Tools sẵn sàng: SUI CLI 1.71, WALRUS CLI 1.48, SITE BUILDER 2.8.0.

### 🔐 Bảo Mật Multi-User
| Dữ liệu | Nơi lưu | Thời hạn |
|---------|---------|---------|
| API Key | localStorage + btoa | Vĩnh viễn |
| Private Key (Auto Bot) | sessionStorage | Tự xóa khi đóng tab |
| Bot Config | localStorage | Vĩnh viễn |
| Profile | localStorage + Walrus sync | Vĩnh viễn |

→ **Không server trung gian** — mọi data stay-local trên thiết bị user.

---

## ✅ Giai đoạn 9: Sui Skills Integration (Hoàn thành)

### 📚 Knowledge Base cho Claude Code & Agent Runtime
- [x] **21 Sui Official Skills** (từ `docs.sui.io/skills`) đã add vào `.claude/skills/`:
  - **Get Started (3)**: sui-overview, sui-install, generate-sui-agent-config
  - **Build & Deploy (3)**: sui-build-test, move-unit-testing, sui-publish
  - **Move (6)**: sui-move, modern-move-syntax, sui-move-project, composable-move-functions, naming-conventions, object-model
  - **Transactions (2)**: accessing-data, ptbs
  - **CLI (2)**: sui-cli, sui-client
  - **Frontend & SDKs (5)**: frontend-apps, sui-sdks, walrus-sites, walrus-sites-portal, walrus-sites-publishing
- [x] **27 ADK Runtime Skills** trong `server/sui_official_skills/` cho Agent thực thi.
- [x] **Sync 2 locations** — Claude Code IDE skills + Agent runtime skills nhất quán.

---

## 📊 Tổng Quan Kiến Trúc Hiện Tại

```
┌────────────────────────────────────────────────────────────┐
│           🌊 WALRUS SITES (Frontend Hosting)                │
│           https://<base36>.wal.app                          │
└──────────────────────┬─────────────────────────────────────┘
                       │ Web App (React + Vite)
                       ▼
┌────────────────────────────────────────────────────────────┐
│  🛡️ SETUP WIZARD (Lần đầu mở app)                          │
│  Step 1: Check Local Agent → Step 2: API Key               │
│  Step 3: Connect Wallet → Step 4: Auto Bot Key (optional)  │
└──────────────────────┬─────────────────────────────────────┘
                       │ Local connection
                       ▼
┌────────────────────────────────────────────────────────────┐
│  💻 LOCAL AGENT (localhost:3001 + ws://localhost:8080)     │
│  • Google ADK + 27 Sui Skills + Skill Toolset              │
│  • DeepBook V3 (Margin/Spot) + Predict + Walrus + Memwal   │
│  • Live Bot: AI Auto Bot Mode + ⚡ Direct Autonomous Mode  │
└──────────────────────┬─────────────────────────────────────┘
                       │
            ┌──────────┴──────────┐
            ▼                      ▼
    🤖 AI Agent Path         ⚡ Direct Path
    Frontend wallet ký       Server keypair tự ký
    (browser secure)         (RAM-only key)
            │                      │
            └──────────┬───────────┘
                       ▼
              📈 SUI MAINNET
              DeepBook Margin / Spot / Predict
```

---

## ✅ Giai đoạn 10: Agent Distribution & Auto-Install (Hoàn thành)

### 📦 Đóng gói Agent
- [x] **`server/agent_bootstrap.ts`** — Entry point production: auto-start, tray notification, log rotation, crash handler, data dir tại `%LOCALAPPDATA%\Suirobo\`.
- [x] **`build_agent.cjs`** — Pipeline esbuild + pkg → `suirobo-agent.exe` 50 MB (Win-x64).
- [x] **`publish_agent.cjs`** — Auto upload .exe lên Walrus + sinh manifest có SHA-256.
- [x] **Auto-register Windows Run key** — Agent tự start khi reboot máy.
- [x] **`SUIROBO_DATA_DIR` env** — Override data path, hoạt động cả dev & production.

### 🌊 Public Distribution trên Walrus
- [x] **Agent .exe Blob ID**: `xwXKOELlOg0721nvQVG09UfNKw1X0KduAesKoT7KszM`
- [x] **Public download URL** (Cloudflare CDN cached, partial-range support):
  https://aggregator.walrus-testnet.walrus.space/v1/blobs/xwXKOELlOg0721nvQVG09UfNKw1X0KduAesKoT7KszM
- [x] **`public/agent-manifest.json`** — Web app fetch để hiển thị thông tin agent với SHA-256 verified.

### ✨ One-Click UX trong SetupWizard
- [x] **AgentDownloadPanel** — Detect agent offline → hiện nút "⬇ Tải Agent" với progress bar realtime.
- [x] **Streaming download** với progress %, lưu trực tiếp Downloads, prompt user double-click.
- [x] **Auto-poll** `/health` mỗi 2s sau download để detect agent online → tiếp Step 2 tự động.
- [x] **Fallback** hiển thị `npm run agent` cho dev mode khi manifest chưa có blob_id.

### 📚 Tài liệu
- [x] **`AGENT_AUDIT.md`** — Phân tích kiến trúc + roadmap đóng gói + security review.

### 🎯 UX Flow Final cho User Mới
```
1. Mở suirobo.wal.app
2. SetupWizard hiện → "Agent offline. Tải agent (50 MB)?"
3. Click → tải từ Walrus CDN (~15-30s với mạng 20 Mbps)
4. File suirobo-agent.exe trong Downloads → double-click
5. Agent tự install vào %LOCALAPPDATA%\Suirobo\ + register auto-start
6. SetupWizard tự detect agent online → tiếp Step 2 (API key)
→ TOTAL: ~2 phút từ click đầu đến trade-ready
```

---

## ✅ Giai đoạn 11: Domain SuiNS + Walrus Sites Mainnet (Hoàn thành)

### 🌐 Production URL
- [x] **URL chính thức**: https://autobots.wal.app
- [x] **SuiNS Domain**: `autobots.sui` (sở hữu bởi dev wallet, expires ~2027)
- [x] **Walrus Site Object**: `0xf070fa29afac7f54de6f849d6e4391b181ba511205e1e4474cf58bfa39537a81`
- [x] **Deploy Tx**: 13 quilt patches uploaded (HTML + JS + CSS + 6 BTC data files + manifests)
- [x] **Link Tx**: [`774fYWQR3J29kCZWdu9GXxfiCnooAsqEafGRVEQmxWCg`](https://suivision.xyz/txblock/774fYWQR3J29kCZWdu9GXxfiCnooAsqEafGRVEQmxWCg)

### 🔧 Technical Setup
- [x] **`link-suins-walrus.ts`** — Script tự động gọi `controller::set_user_data` của SuiNS package mới (`0x71af035...`).
- [x] **Key chuẩn `walrus_site_id`** — Walrus portal đọc field này để resolve domain.
- [x] **CDN Cloudflare** trước Walrus aggregator — load nhanh global.
- [x] **HTTPS** miễn phí, tự động.

### 📦 Stack Production
```
User → https://autobots.wal.app
       ↓ CDN Cloudflare
       ↓ wal.app portal
       ↓ SuiNS resolve "autobots" → walrus_site_id
       ↓ Walrus aggregator fetch quilt patches
       ↓ Serve as static site
```

---

## ✅ Giai đoạn 12: Desktop Pro App + Sui-Native Data + Autobots Rebrand (Hoàn thành)

### 💻 Autobots Desktop — bản full là sản phẩm chính
- [x] **Electron desktop app** (`npm run app` / `dist:win` → `Autobots`/`Suirobo.exe` ~112 MB portable) bundle local agent + UI rút gọn; key nhập cục bộ, tự ký 24/7, không cần ví trình duyệt.
- [x] **EA pro toolkit** trên desktop: Optimizer (parameter sweep), Robustness Lab (period stability + 1000-run Monte-Carlo), anchored walk-forward (in-sample → out-of-sample).
- [x] **Hard safety interlocks**: kill-switch + max-daily-loss breaker (flatten + halt), DeepBook liquidation guard, TP/SL mọi vị thế — deterministic, không phụ thuộc AI.
- [x] **Account strip + Preferences** hợp nhất; Marketplace browse/install trên desktop.
- [x] **Agent API token hardening**: token ngẫu nhiên mỗi lần chạy, chặn truy cập `/api/*` trái phép.

### 🌊 Sui-Native Data Spine (bỏ CEX REST khỏi critical path)
- [x] **DA-1** `deepbookTape.ts`: dựng nến OHLC từ **DeepBook on-chain fill-tape** (`OrderFilled` events, type-origin pkg) thay vì Binance.
- [x] **DA-2** Backtest Simulator có nguồn dữ liệu "📡 On-chain" (DeepBook fills → nến → engine).
- [x] **DA-3** Live bot dùng nến on-chain (opt-in, SUI/USDC): `OnchainCandleFeed` bootstrap + tích lũy fill mới mỗi tick — không Binance trong vòng quyết định.
- [x] **Order-book imbalance**: gauge L2 DeepBook on-chain + bộ lọc OBI cho entry (live).
- [x] **Verified track record**: kết quả bot on-chain theo ví → badge tin cậy trên Marketplace.

### 🪪 Autobots rebrand + web thuần ví
- [x] **Đổi tên bản cài đặt → "Autobots"**; ẩn hết version cũ ("Suirobo Agent"), chỉ hiện các bản Autobots.
- [x] **Web app refocus**: login ví Slush là trade ngay — **không hỏi key, không Setup Wizard**. Ladder 3 nấc: Manual / Web Bot (tự ký) / Client Bot (= trang giới thiệu tải bản desktop). Bỏ nấc AI Agent + chế độ chạy kết hợp client+web. Bản full desktop mới nhập key + auto 24/24.
- [x] **Home** đổi "agent" → "Autobots Desktop".

---

## 🔮 Giai đoạn 13: Mạng Lưới AI Tự Trị & Native App (Future Vision)
- [ ] **Inter-Agent Communication**: Các Suirobo Agent giao tiếp, chia sẻ tín hiệu giao dịch P2P.
- [ ] **Skill Governance**: DAO voting duyệt skill + đánh giá chất lượng tự động.
- [ ] **Multi-chain Expansion**: Bridge sang Aptos, Solana, EVM-compatible chains.
- [ ] **Tauri Desktop + llama.cpp**: Đóng gói desktop gọn nhẹ Windows/macOS, nạp model GGUF cục bộ (offline AI).
- [ ] **Bot Skill Marketplace v2**: Sub-skill composition, copy-trading verifiable on-chain.
- [ ] **Real-Time Strategy Sharing**: Subscribe to top performers, replicate trades với delay tối thiểu.
- [ ] **Mobile Companion App**: React Native cho theo dõi vị thế + push notification.

---

## 📦 Đã Hoàn Thành — Tổng Kết Numbers

| Chỉ số | Giá trị |
|--------|--------|
| Smart Contracts deployed | Testnet `0x0a75f0...` + Mainnet `0x888f919f...` |
| Skills trên Walrus (sealed) | 11+ skills |
| Skills trong Marketplace | 35+ skills |
| Sui Official Skills (knowledge) | 21 skills × 2 locations = 42 files |
| Backtest indicators | 5 strategies (EMA/RSI/MACD/BB/Hybrid) |
| Backtest timeframes | D1/H4/H1/M30/M15/M5 (BTC 2025) |
| Live Trade modes | 2 (AI Auto Bot + Direct Auto Bot) |
| AI Providers hỗ trợ | 3 (Gemini, DeepSeek, OpenClaw) |
| Bundle size production | 1.25 MB (gzip 362 KB) |
| Test wallet skills equipped | 35+ skills + 5.98 SUI + 51.98 WAL |

---

## 🚀 Cách Deploy Production

```powershell
# Build & deploy lên Walrus (lần đầu) — chạy từ thư mục dự án
.\deploy-walrus.ps1 publish

# Cập nhật site đã có
.\deploy-walrus.ps1 update -SiteId 0x...

# Hoặc dùng Walgo Desktop GUI: tab CREATE → Init Walgo → Launch to Walrus
```

Xem chi tiết tại [`WALRUS_DEPLOY.md`](./WALRUS_DEPLOY.md).
