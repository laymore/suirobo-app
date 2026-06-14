# 🌊 Deploy Suirobo lên Walrus Sites

## 🎯 Hai cách deploy

### A. Dùng Walgo Desktop (GUI - dễ nhất)

1. Mở Walgo Desktop App
2. Vào tab **CREATE** → **Init Walgo** (hoặc dùng menu **PROJECTS**)
3. Chọn thư mục: `C:\Users\admin\Desktop\Suirobo\suirobo-app\dist`
4. Vào **EDIT** → bấm **"⚡ Launch to Walrus"**
5. Walgo sẽ:
   - Đọc `ws-resources.json` đã có sẵn
   - Trừ WAL từ ví dev (đã có 51 WAL)
   - Trả về Site Object ID + URL `<id>.wal.app`

### B. Dùng CLI (script tự động)

#### Lần đầu publish:
```powershell
.\deploy-walrus.ps1 publish
```

#### Cập nhật site đã có:
```powershell
.\deploy-walrus.ps1 update -SiteId 0xABC123...
```

#### Kiểm tra hạn của blobs:
```powershell
.\deploy-walrus.ps1 sitemap -SiteId 0xABC123...
```

---

## 📁 Cấu Hình Đã Sẵn Sàng

| File | Mục đích |
|------|---------|
| `dist/ws-resources.json` | SPA routing — mọi route fallback về `index.html` |
| `deploy-walrus.ps1` | Windows PowerShell script |
| `deploy-walrus.sh` | Bash script (macOS/Linux/Git Bash) |

---

## 🔑 Ví Dev Đã Cấu Hình

| | |
|--|--|
| **Address** | `0xafbc48fd349fb44ce9c6f2b33423e6ae7c826d53a25920a0d4c3c475e40889c5` |
| **Network** | Mainnet |
| **SUI Balance** | ~5.98 SUI |
| **WAL Balance** | ~51.98 WAL |

Walgo Desktop tự nhận diện ví này (qua Sui CLI config).

---

## 💰 Chi Phí Deploy Tham Khảo

| Action | Cost |
|--------|------|
| Publish site mới (60 epochs ≈ 60 ngày) | ~1-3 WAL |
| Update site (60 epochs) | ~0.5-2 WAL |
| Mỗi MB blob × epochs = WAL cost | ~0.01 WAL/MB/epoch |

Bundle hiện tại: **1.25 MB** (gzip 362 KB) → rất nhẹ.

---

## ⚠️ Lưu Ý Production

### 1. Backend Local Agent
Web app chạy trên Walrus chỉ là **frontend**. User vẫn cần:
- Cài Local Agent (`.exe`) trên máy
- Agent chạy tại `localhost:3001` để xử lý ký giao dịch

### 2. SetupWizard tự kiểm tra Agent
Khi user mở app từ Walrus lần đầu:
- Step 1: Kiểm tra `http://localhost:3001/health` → hiện hướng dẫn cài Agent nếu chưa có
- Step 2-4: Cấu hình API key + ví + (tùy chọn) private key

### 3. Bảo Mật Multi-User
- API Key → `localStorage` (mã hóa nhẹ btoa)
- Private Key → `sessionStorage` (tự xóa khi đóng tab)
- **Không** có server trung gian — mọi thứ stay-local

### 4. Cập Nhật Định Kỳ
Blobs trên Walrus có thời hạn. Trước khi hết hạn:
```powershell
.\deploy-walrus.ps1 update -SiteId <existing-id> -Epochs 60
```

---

## 🐛 Troubleshooting

| Lỗi | Cách fix |
|-----|---------|
| `Insufficient WAL balance` | Mua WAL trên Cetus hoặc swap từ SUI |
| `Site object not found` | Kiểm tra đúng `SiteId` (chưa bị destroy) |
| `404 trên SPA routes` | Đảm bảo `ws-resources.json` có `"/*": "/index.html"` |
| `Bundle quá lớn` | Vite đã warning — nên code-split với `dynamic import()` |

---

## 🔗 Hữu ích

- Mainnet portal: https://wal.app
- Walrus Docs: https://docs.wal.app
- Walgo Desktop: đã cài tại `C:\Users\admin\AppData\Local\Programs\walgo\`
- Site Builder CLI: `~/.walgo/bin/site-builder` (v2.8.0)
