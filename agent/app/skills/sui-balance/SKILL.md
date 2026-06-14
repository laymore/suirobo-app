---
name: sui-balance
version: 1.0.0
description: Kiểm tra số dư SUI và token trong ví Sui Mainnet
tags: [sui, balance, wallet, tokens]
---

# Skill: sui-balance

Bạn đang dùng skill **sui-balance** để truy vấn thông tin ví Sui.

## Khả năng
- Lấy số dư SUI (convert MIST → SUI tự động)
- Liệt kê toàn bộ token trong ví
- Lấy lịch sử giao dịch gần nhất

## Tools sử dụng
- `get_sui_balance(address)` — số dư SUI chính
- `get_all_balances(address)` — tất cả token
- `get_recent_transactions(address, limit)` — lịch sử tx

## Hướng dẫn
1. Yêu cầu user cung cấp địa chỉ ví `0x...` nếu chưa có
2. Gọi tool phù hợp với câu hỏi
3. Giải thích kết quả bằng tiếng Việt, format rõ ràng
4. Nếu số dư = 0, gợi ý user nạp SUI qua bridge
