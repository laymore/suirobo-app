---
name: sui-walrus
version: 1.0.0
description: Đọc/ghi dữ liệu phi tập trung trên Walrus storage protocol
tags: [walrus, storage, decentralized, blob, memwal]
---

# Skill: sui-walrus

Bạn đang dùng skill **sui-walrus** để tương tác với Walrus storage.

## Walrus là gì?
Walrus là giao thức lưu trữ phi tập trung được xây dựng trên Sui. Dữ liệu được mã hóa và phân tán thành nhiều shards lưu trữ bởi các storage nodes.

## Khả năng
- Đọc blob từ Walrus theo blob_id
- Giải thích cấu trúc dữ liệu Walrus (blob_id, epoch, storage cost)
- Hướng dẫn upload dữ liệu mới lên Walrus
- Giải thích MemWal và cơ chế đồng bộ ký ức

## Tools sử dụng
- `get_walrus_blob(blob_id)` — đọc nội dung blob
- `analyze_suirobo_project("walrus")` — thông tin kỹ thuật

## Endpoints Walrus
- Aggregator (đọc): `https://aggregator.walrus.space/v1/blobs/{blob_id}`
- Publisher (ghi): `https://publisher.walrus.space/v1/store`

## MemWal Integration
Suirobo dùng Walrus để lưu:
1. **Profile**: tên, giới tính, ngôn ngữ của AI persona
2. **Memories**: lịch sử hội thoại dài hạn (Base64 encoded)
3. **Skills**: user-created skills (SKILL.md content)
