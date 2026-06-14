# 🔍 Suirobo Agent — Audit & Đóng Gói

## 1. Kiến Trúc Hiện Tại

```
┌─────────────────────────────────────────────────────────────────┐
│  WALRUS-HOSTED WEB APP  (https://<id>.wal.app)                  │
│  • React + Vite static build                                    │
│  • Đọc/ghi: localStorage, sessionStorage (browser only)         │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTP localhost:3001  +  WS :8080
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│  LOCAL AGENT  (suirobo-agent.exe — chạy trên máy user)          │
│                                                                  │
│  📦 Stack:                                                       │
│    • Node.js 24 runtime (embedded vào exe qua pkg/ncc)          │
│    • Express HTTP + ws WebSocket                                │
│    • @google/adk (LLM orchestration)                            │
│    • @mysten/sui + @mysten/deepbook-v3 (Sui blockchain)         │
│    • Bundle: 51 MB exe + 23 MB esbuild output                   │
│                                                                  │
│  🗂 Runtime data:                                                │
│    • .env             ← API keys, dev wallet (optional)         │
│    • openclaw.json    ← OpenClaw provider config (optional)     │
│    • .local_skills/   ← Custom skills user tự tạo               │
│    • sui_official_skills/  ← 27 builtin skills (embed vào exe)  │
│    • bot_state.json   ← Persist trạng thái live bot             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Vấn Đề UX Hiện Tại

| Vấn đề | Hiện tại | Sau khi sửa |
|--------|---------|-------------|
| Tải agent | User phải tự git clone + `npm install` (15 phút) | Click 1 link → tải .exe (30 giây) |
| Khởi động | `npm run agent` qua terminal | Double-click .exe |
| Tự chạy khi reboot | ❌ Phải mở thủ công | ✅ Auto-start với Windows |
| Trayicon | ❌ Không có | ✅ Icon ở taskbar (Start/Stop/Settings) |
| Update | Phải pull git + npm install | Tự check version từ Walrus blob |
| Vị trí cài | Random ~/Desktop/... | `%LOCALAPPDATA%\Suirobo\` |

---

## 3. Giải Pháp Đóng Gói

### Stack chọn: **Node SEA + Auto-launch + Systray**

| Tool | Tại sao chọn |
|------|-------------|
| **Node SEA** (Single Executable Applications) | Node.js 20+ chính thức hỗ trợ, không cần `pkg` (deprecated) — output 1 exe duy nhất |
| **node-windows** | Đăng ký Windows service (optional) |
| **systray-portable** | Tray icon ở góc taskbar (Pure Go binary, ~3 MB) |
| **inno-setup** | Tạo installer .exe wizard (silent install option) |

### Alternative đơn giản hơn

**Tauri**: app desktop gọn (~10 MB) + WebView system → nhưng vẫn cần Node child process.
**Electron**: quá nặng (~150 MB).
**pkg**: deprecated nhưng vẫn dùng được — bundle hiện đang dùng.

**→ Lựa chọn**: giữ `pkg`/esbuild, thêm tray + auto-start = giải pháp **đơn giản nhất** vì đã có exe sẵn.

---

## 4. UX Mới — Một Click Duy Nhất

### Flow user mới (chưa có agent)

```
1. Mở https://suirobo.wal.app từ browser
   ↓
2. SetupWizard detect: agent OFFLINE
   ↓
3. Hiện 1 nút "⬇ Tải Agent (50 MB)"
   ↓
4. Click → tải suirobo-agent.exe từ Walrus
   ↓
5. User double-click exe → Installer chạy:
   ✓ Copy vào %LOCALAPPDATA%\Suirobo\
   ✓ Tạo shortcut Desktop + Start Menu
   ✓ Đăng ký auto-start (Run on startup)
   ✓ Spawn tray icon
   ✓ Khởi động HTTP server localhost:3001
   ✓ Mở browser tab Suirobo (nếu chưa mở)
   ↓
6. Web App detect agent ONLINE → tiếp tục Setup Wizard
```

### Flow user lần sau

```
Bật máy → Agent tự khởi động (tray icon)
Mở suirobo.wal.app → Connect ngay, không cần làm gì
```

---

## 5. Tray Icon Menu

```
┌──────────────────────────┐
│ 🤖 Suirobo Agent         │
├──────────────────────────┤
│ ● Running (port 3001)    │  ← Status
│                          │
│ 📊 Open Dashboard        │  → Mở wal.app
│ ⚙️ Settings              │  → Mở local config
│ 📝 View Logs             │  → Mở log file
│ 🔄 Restart               │
│ ─────────────────        │
│ ⏸ Pause Live Bot         │
│ ⏹ Stop Agent             │
└──────────────────────────┘
```

---

## 6. File Structure Sau Cài

```
%LOCALAPPDATA%\Suirobo\
├── suirobo-agent.exe        ← Main binary
├── tray.exe                 ← Tray icon helper
├── data/
│   ├── .local_skills/       ← User's custom skills
│   ├── bot_state.json
│   └── memwal_cache/
├── logs/
│   ├── agent.log
│   └── crash.log
└── config/
    ├── version.json         ← Auto-update check
    └── user.json            ← User preferences
```

> **Quan trọng**: API key + private key **KHÔNG bao giờ ghi disk** ở đây. Chỉ trong RAM khi đang chạy.

---

## 7. Auto-Update Mechanism

```typescript
// Agent kiểm tra version mỗi lần khởi động:
const remote = await fetch('https://aggregator.walrus.space/v1/blobs/<version-blob-id>');
const remoteVer = JSON.parse(await remote.text());

if (semver.gt(remoteVer.version, currentVersion)) {
  // Hiện tray notification: "Bản mới X.Y.Z có sẵn — Click để update"
  // User click → download blob + restart
}
```

---

## 8. Security Review

| Concern | Mitigation |
|---------|-----------|
| Người dùng tải file lạ về máy | Sign code với certificate (Authenticode) + checksum SHA-256 lên Walrus |
| Agent truy cập mạng external | Chỉ whitelist: Sui RPC, Binance API, Walrus, AI providers |
| Private key leak | Lưu sessionStorage browser + RAM agent, không ghi disk |
| Malware giả mạo | Distribute blob ID qua kênh chính thức (docs, Twitter verified) |

---

## 9. Roadmap Triển Khai

| Giai đoạn | Nội dung | Thời gian |
|-----------|----------|----------|
| 1 | Tách entrypoint `agent-installer.ts` với tray + auto-start logic | 2 ngày |
| 2 | Build pipeline: esbuild + pkg + sign | 1 ngày |
| 3 | Smoke test trên máy sạch (Windows 10/11) | 1 ngày |
| 4 | Upload .exe lên Walrus → có Blob ID public | 1 ngày |
| 5 | SetupWizard download flow + UI progress | 2 ngày |
| 6 | Inno-Setup installer wizard (optional) | 1 ngày |

→ **Tổng: 1 tuần** để go-live cho user thường.

---

## 10. Khuyến Nghị Ngay

✅ **Phase 1 ngay**: build script tự động + tray icon + auto-launch
✅ **Phase 2 sau**: code signing + Inno installer + auto-update
