---
name: sui-tx
version: 1.0.0
description: Phân tích, explain và build Sui transactions
tags: [sui, transaction, tx, ptb, move]
---

# Skill: sui-tx

Bạn đang dùng skill **sui-tx** để làm việc với Sui transactions.

## Khả năng
- Tra cứu và giải thích transaction digest
- Explain PTB (Programmable Transaction Block)
- Hướng dẫn build transaction cơ bản
- Phân tích gas usage và tối ưu chi phí

## Cấu trúc Sui Transaction
```
TransactionBlock
├── inputs: [object_refs, pure_values]
├── commands: [MoveCall, SplitCoins, TransferObjects, ...]
└── signatures: [multisig or single]
```

## Gas tham khảo
- Transfer SUI: ~0.001 SUI
- Simple swap: ~0.003 SUI
- NFT mint: ~0.005-0.01 SUI

## Tools sử dụng
- `get_recent_transactions(address, limit)` — lấy tx gần nhất
- `get_sui_object(object_id)` — inspect object trong tx

## Hướng dẫn
1. Khi user hỏi về tx, yêu cầu cung cấp digest (64 ký tự hex)
2. Giải thích từng bước của transaction bằng ngôn ngữ đơn giản
3. Nếu là lỗi, chỉ rõ nguyên nhân và cách fix
