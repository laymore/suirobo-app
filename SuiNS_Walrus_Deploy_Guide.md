# Quy Trình Triển Khai App Lên Walrus & Link SuiNS

Để cập nhật và phát hành (deploy) phiên bản mới của ứng dụng `Suirobo App` lên hệ sinh thái **Walrus Sites** và liên kết với tên miền **SuiNS** (`autobots.sui`), hãy làm theo quy trình bài bản dưới đây.

## Bước 1: Build source code

Đảm bảo bạn đã lưu toàn bộ code. Chạy lệnh sau để build React app ra thư mục `dist`:

```bash
npm run build
```

*(Nếu báo lỗi `&&`, hãy chạy riêng `npx tsc -b` rồi `npx vite build`)*

## Bước 2: Publish bản build lên Walrus

Dùng công cụ `site-builder` do Sui cung cấp để đẩy thư mục `dist` lên Walrus (lưu trữ phi tập trung). Cấp cho nó thời hạn lưu trữ (VD: 50 epochs).

```bash
site-builder publish dist --epochs 50
```

> [!NOTE] 
> Chờ khoảng 1-2 phút. Lệnh này sẽ tạo ra một object mới trên mạng lưới Sui và lưu trữ toàn bộ các file (JS, CSS, HTML, JSON) lên Walrus. 

**Kết quả thành công sẽ có dạng:**
```
Created new site! 
New site object ID: 0xf793b13bcb434d1b2cb2381956b54cec6b1a28dbca040ee83b63953f54c8e2f1
```
👉 Hãy copy cái **New site object ID** này.

## Bước 3: Cập nhật Site ID vào Script liên kết

Mở file `link-suins-walrus.ts` nằm trong thư mục gốc. 
Tìm hằng số `WALRUS_SITE_ID` ở phần đầu file và thay bằng **Site Object ID** bạn vừa copy ở Bước 2.

```typescript
const WALRUS_SITE_ID = '0xf793b13...'; // <-- Thay bằng ID mới
```

## Bước 4: Liên kết Domain SuiNS với Site ID mới

Chạy script bằng tsx để gọi Smart Contract, thiết lập lại địa chỉ website cho tên miền `autobots.sui`:

```bash
npx tsx link-suins-walrus.ts
```

> [!SUCCESS] 
> Nếu xuất hiện `LINK THÀNH CÔNG!`, giao dịch của bạn đã được xác nhận trên mainnet.
> Bạn có thể truy cập ngay vào: **https://autobots.wal.app** (có thể mất 1-2 phút cho DNS portal cập nhật bộ đệm).
