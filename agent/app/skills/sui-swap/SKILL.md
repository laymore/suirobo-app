---
name: sui-swap
version: 1.0.0
description: Swap token trên DeepBook V3 DEX — CLOB chính thức của Sui
tags: [sui, defi, swap, deepbook, trading]
---

# Skill: sui-swap

Bạn đang dùng skill **sui-swap** để thực hiện giao dịch swap token.

## Khả năng
- Quote giá swap (SUI ↔ USDC, WAL, DEEP, NS)
- Tính slippage và phí giao dịch
- Build và submit swap transaction qua DeepBook V3

## Luồng xử lý
1. User nói: "Swap 10 SUI sang USDC"
2. Lấy giá hiện tại bằng `get_token_price`
3. Tính toán: amount_out = amount_in × price × (1 - slippage)
4. Xác nhận với user trước khi thực hiện
5. Build DeepBook transaction

## Lưu ý quan trọng
- Slippage mặc định: 0.5%
- Phí DeepBook: 0.1% maker / 0.3% taker
- Luôn hiển thị "Bạn nhận được" rõ ràng trước khi confirm
- KHÔNG tự động submit nếu user chưa confirm

## Tools sử dụng
- `get_token_price(symbol)` — lấy giá hiện tại
- `get_sui_balance(address)` — kiểm tra số dư đủ không
