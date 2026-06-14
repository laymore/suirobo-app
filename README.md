# 🏭 Suirobo Skill Factory

**Suirobo Skill Factory** là một nền tảng **Hệ sinh thái AI Giao dịch Phi tập trung (Decentralized AI Agent Ecosystem)** đầu tiên trên mạng lưới Sui.

Thay vì cung cấp một con Bot cứng nhắc và nắm giữ Private Key của bạn trên Server, chúng tôi đi tiên phong với mô hình **Phần Cứng (Miễn phí) - Phần Mềm (Thu phí)**, định hình lại cách giao dịch thuật toán trên Web3.

---

## 🌟 Tầm Nhìn & Triết Lý (The Core Philosophy)

Khi trí tuệ nhân tạo (AI) trở nên phổ biến, giá trị cốt lõi không còn nằm ở bản thân con AI, mà nằm ở **Kiến thức chuyên ngành (Skills)** mà nó được trang bị.

Suirobo hoạt động dựa trên 3 trụ cột kiến trúc:

### 1. 🛡️ Local Agent (Phần mềm miễn phí)
- **Bảo mật tuyệt đối (100% Self-Custody):** Bạn tải về một file `.exe` mã nguồn mở và cài đặt trực tiếp trên máy cá nhân. Mọi thao tác ký ví và lưu trữ Private Key đều diễn ra cục bộ.
- **Vỏ bọc vững chắc:** Đây là "Bộ não trống rỗng" nhưng được trang bị khả năng giao tiếp Web3 cực mạnh nhờ framework **Google ADK**.
- **Miễn phí mãi mãi.** Bạn có thể tải ngay từ giao diện Web App.

### 2. 🏪 Decentralized Skill Marketplace (Chợ Kỹ Năng)
- Vì Agent cơ bản không biết giao dịch phức tạp, nó cần học. Và **Skill Marketplace** chính là nơi bạn trang bị tri thức cho nó.
- Mọi kỹ năng (như *Auto SL/TP*, *Arbitrage Scanner*) đều được chuẩn hóa theo định dạng **`SKILL.md` của ADK**, đóng gói (`.enc`) và lưu trữ vĩnh viễn trên mạng lưới **Walrus**.
- Bạn có thể mua hoặc thuê các kỹ năng này. Sau khi thanh toán, Smart Contract sẽ giải mã Blob ID và cài đặt trực tiếp vào Local Agent của bạn mà **không cần khởi động lại (Dynamic Runtime Injection)**.

### 3. 🛠️ Skill Factory & Nền Kinh Tế "Create-to-Earn" (C2E)
- Không chỉ là nơi mua bán, Suirobo còn là một **Công xưởng AI**.
- Bất kỳ người dùng nào cũng có thể trở thành **Creator** bằng cách nói với Agent: *"Hãy tạo một kỹ năng tự động Mua khi RSI < 30"*. Agent sẽ dùng kỹ năng `generate_new_skill` để tự sinh ra mã code chuẩn ADK (`SKILL.md` và `index.js`).
- Sau khi kiểm thử cục bộ, bạn có thể **Publish lên Walrus** và niêm yết lên Chợ. Khi người khác mua kỹ năng của bạn, lợi nhuận sẽ được chia sẻ tự động (Ví dụ: **80% cho Creator, 20% cho Nền tảng**).

---

## 🚀 Hướng Dẫn Sử Dụng (Quick Start)

### A. Đối với Trader (Người dùng bình thường)
1. Tải bộ cài **Local Agent** từ trang chủ (hoặc clone mã nguồn và chạy `npm run agent`).
2. Mở Web App tại `http://localhost:5173`.
3. Vào tab **Skill Factory**, tìm các kỹ năng phù hợp (Ví dụ: *Whale Tracker*).
4. Bấm **Mua**, hệ thống sẽ nạp kỹ năng vào não Agent của bạn.
5. Vào tab Chat và ra lệnh cho Agent làm việc!

### B. Đối với Creator (Nhà sáng tạo)
1. Kết nối Agent.
2. Tại tab Chat, nhập: *"Tạo cho tôi một chiến lược chênh lệch giá (Arbitrage) giữa Cetus và DeepBook."*
3. Chờ Agent sinh code, sau đó chuyển sang tab **Skill Factory**.
4. Tìm đến **Creator Studio**, xem danh sách Bản nháp (Drafts) và bấm **Publish lên Walrus**.
5. Theo dõi **Bảng Xếp Hạng (Leaderboard)** để xem mức thu nhập thụ động (SUI) mà bạn kiếm được.

---

## 💻 Tech Stack
- **AI Framework**: Google Agent Development Kit (ADK)
- **Blockchain**: Sui Network (@mysten/sui, DeepTrade, zkLogin)
- **Decentralized Storage**: Walrus (cho Skill Code & Agent Installer)
- **Frontend**: React + Vite
- **Backend/Daemon**: Node.js + Express (Localhost API)

**Chào mừng bạn đến với kỷ nguyên nơi AI viết AI, và con người hưởng lợi từ Trí tuệ Tập thể!**
