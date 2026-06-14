# 🌉 Suirobo Agent Bridge — Chrome Extension

Extension nhỏ giúp **trang Walrus HTTPS** giao tiếp với **Local Agent HTTP** mà không bị browser block.

## ❓ Tại sao cần?

- Web Suirobo deploy trên Walrus → URL HTTPS
- Local Agent chạy HTTP localhost:3001
- Chrome v133+ **block fetch HTTPS → HTTP** (Mixed Content + Private Network policy)
- Extension có quyền truy cập cả 2 protocol → proxy giúp

## 🚀 Cách Cài

### Option 1: Tải về & Load Unpacked (hiện tại)

1. Tải zip extension từ Walrus (link sẽ có trên SetupWizard)
2. Giải nén
3. Mở Chrome → `chrome://extensions/`
4. Bật **"Developer mode"** (góc phải trên)
5. Click **"Load unpacked"** → chọn thư mục `suirobo-extension/`
6. Refresh trang `autobots.wal.app` → bridge sẽ active

### Option 2: Chrome Web Store (sẽ có sau)

Cần phí $5 publishing fee + review process của Google.

## 🔧 Architecture

```
┌──────────────────────┐
│ autobots.wal.app     │
│ (HTTPS)              │
└──────────┬───────────┘
           │ chrome.runtime.sendMessage
           ▼
┌──────────────────────┐
│ Bridge Extension     │
│ (Service Worker)     │
└──────────┬───────────┘
           │ fetch (privileged)
           ▼
┌──────────────────────┐
│ Local Agent HTTP     │
│ localhost:3001       │
└──────────────────────┘
```

## 🛡️ Bảo mật

- **Whitelist URL**: Chỉ proxy đến `http://localhost:3001/*`
- **Origin check**: Chỉ accept request từ `*.wal.app` hoặc localhost
- **No data storage**: Không lưu API key, private key
- **Open source**: Code public ở [github.com/teamautobots/suirobo-bridge](https://github.com)

## 🔄 Auto-detect

Web app tự detect extension qua `window.__SUIROBO_EXT_ID__`. Nếu có → dùng bridge. Nếu không → fallback HTTPS direct (cần accept cert).

## 📂 Files

| File | Vai trò |
|------|---------|
| `manifest.json` | Cấu hình extension |
| `background.js` | Service worker, proxy fetch + WebSocket |
| `content.js` | Inject vào trang Walrus, advertise extensionId |
| `popup.html/js` | UI khi click icon extension |
| `icons/` | Logo 16/32/48/128 px |
