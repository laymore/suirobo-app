# 🔐 Security Policy — Suirobo Project

## Tóm Tắt Trạng Thái

✅ **KHÔNG có key nào bị leak ra public.** Audit đã được tiến hành toàn diện.

| Kênh Public | Tình trạng |
|-------------|-----------|
| `https://autobots.wal.app` (Walrus mainnet) | ✅ Bundle 0 key |
| `suirobo-agent.exe` (Walrus blob `xwXKOEL...`) | ✅ Binary 0 key |
| Git history | ✅ Chưa có git repo → chưa từng commit |
| GitHub remote | ✅ Chưa có remote → chưa từng push |

---

## Quy Tắc Quản Lý Secrets

### 1. Phân Loại Secrets

| Loại | Nơi lưu | Ghi disk? | Trong git? |
|------|---------|----------|-----------|
| **Dev Private Key** | `.env` → `SUIROBO_DEV_WALLET` | ✅ Local only | ❌ Ignored |
| **DeepSeek API Key** | `openclaw.json` → `apiKey` | ✅ Local only | ❌ Ignored |
| **User Private Key** (Auto Bot) | `sessionStorage` browser | ❌ RAM only | N/A |
| **User API Key** | `localStorage` browser (btoa) | ❌ Browser only | N/A |
| **Test Wallet Address** | `.env` → `SUIROBO_DEV_ADDRESS` | ✅ Public OK | ✅ OK (chỉ address) |

### 2. Files Bắt Buộc Trong `.gitignore`

```
# Sensitive — KHÔNG bao giờ commit
.env
.env.local
.env.production
openclaw.json
openclaw.local.json
*.pem
*.key
*.bak
server/bot_state.json
server/state.json

# Test files có chứa keys runtime (chỉ build local)
test-live-execute.ts
test-live-borrow.ts
test-live-repay.ts
```

### 3. Quy Tắc Code

❌ **TUYỆT ĐỐI KHÔNG** hardcode key/secret trong file `.ts`, `.tsx`, `.js`, `.cjs`, `.json` được track bởi git.

✅ **Luôn dùng** `process.env.<NAME>`:

```typescript
// ✅ Good
const apiKey = process.env.DEEPSEEK_API_KEY || '';
const privKey = process.env.SUIROBO_DEV_WALLET || '';

// ❌ Bad  
const apiKey = 'sk-REDACTED_EXAMPLE_DO_NOT_HARDCODE';
```

### 4. Setup Local Dev

```bash
# 1. Copy template
cp openclaw.json.example openclaw.json

# 2. Sửa openclaw.json — điền key thật

# 3. Tạo .env
cat > .env <<'EOF'
SUIROBO_DEV_WALLET=suiprivkey1q...
SUIROBO_DEV_ADDRESS=0x...
DEEPSEEK_API_KEY=sk-...
EOF
```

### 5. Multi-User Production (Walrus Deploy)

Khi user mới truy cập `https://autobots.wal.app`:

| Item | Cách user nhập | Nơi lưu |
|------|---------------|--------|
| AI API Key | Step 2 SetupWizard | `localStorage` browser (btoa encode) |
| Sui Ví (chính thức) | Connect wallet button | Trong dApp Kit wallet (Slush, Sui Wallet, etc.) |
| Auto Bot Private Key (tùy chọn) | Step 4 SetupWizard | `sessionStorage` browser (tự xóa khi đóng tab) |

→ **Không có secret nào của user gửi lên server Suirobo.** Mọi thứ chạy trên máy user.

---

## Vận Hành Bảo Mật

### Trước khi commit code

```bash
# Quét nhanh
grep -rn "sk-[a-zA-Z0-9]\{20,\}\|suiprivkey1[a-z0-9]\{50,\}" \
  --include="*.ts" --include="*.tsx" --include="*.js" --include="*.cjs" \
  --include="*.json" . | grep -v node_modules | grep -v dist
```

Nếu kết quả không trống → KHÔNG commit!

### Trước khi deploy lên Walrus

```bash
# Build trước
npm run build

# Verify bundle sạch
grep -c "sk-\|suiprivkey1" dist/assets/*.js
# Kết quả 0 = an toàn deploy

# Verify không có .env, openclaw.json
ls dist/ | grep -E "\.env|openclaw"
# Kết quả trống = an toàn
```

---

## Rotate Keys (Khi Lo Lắng)

### Rotate DeepSeek API Key

1. Vào https://platform.deepseek.com/api_keys
2. Tạo key mới
3. Update `openclaw.json` → `apiKey`
4. Update `.env` → `DEEPSEEK_API_KEY`
5. Restart agent (`npm run agent`)
6. Revoke key cũ trên DeepSeek dashboard

### Rotate Dev Wallet (Nếu chắc chắn lộ)

⚠️ Phải transfer assets trước!

```bash
# 1. Tạo wallet mới
sui client new-address ed25519

# 2. Transfer assets từ ví cũ → ví mới (qua Sui Wallet hoặc CLI)

# 3. Export private key mới
sui keytool export <new-address>

# 4. Update .env với key mới
```

---

## Báo Cáo Lỗ Hổng

Nếu phát hiện vulnerability, **không tạo issue public**. Email trực tiếp: security@suirobo.app
