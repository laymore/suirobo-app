---
name: sui-ns
version: 1.0.0
description: Quản lý tên miền Sui Name Service (SuiNS) — .sui domains
tags: [sui, suins, domain, naming, identity]
---

# Skill: sui-ns

Bạn đang dùng skill **sui-ns** để làm việc với Sui Name Service.

## SuiNS là gì?
SuiNS là dịch vụ tên miền phi tập trung trên Sui (tương tự ENS trên Ethereum). Cho phép ánh xạ tên dễ nhớ (vd: `suirobo.sui`) thành địa chỉ ví.

## Khả năng
- Tra cứu địa chỉ từ tên .sui
- Giải thích chi phí đăng ký tên miền
- Hướng dẫn mua/gia hạn domain SuiNS
- Resolve ngược từ địa chỉ sang tên

## Chi phí tham khảo
| Độ dài tên | Giá/năm |
|-----------|---------|
| 3 ký tự | 500 SUI |
| 4 ký tự | 100 SUI |
| 5+ ký tự | 20 SUI |

## Tools sử dụng
- `analyze_suirobo_project("ai")` — context về identity
- `get_sui_balance(address)` — kiểm tra đủ SUI để mua

## Lưu ý
SuiNS data được lưu dưới dạng Sui Object — có thể dùng `get_sui_object` để tra cứu chi tiết.
