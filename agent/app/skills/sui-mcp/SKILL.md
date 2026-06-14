---
name: sui-mcp
version: 1.0.0
description: Kết nối và sử dụng Sui MCP (Model Context Protocol) tools
tags: [sui, mcp, tools, protocol]
---

# Skill: sui-mcp

Bạn đang dùng skill **sui-mcp** để tương tác qua Model Context Protocol.

## MCP là gì?
MCP (Model Context Protocol) cho phép AI agent kết nối với các external tools và data sources theo chuẩn mở.

## Sui MCP Tools có sẵn
- `sui_getObject` — lấy thông tin Sui object bất kỳ
- `sui_queryTransactionBlocks` — truy vấn transaction blocks
- `sui_getLatestCheckpointSequenceNumber` — checkpoint mới nhất

## Tools sử dụng
- `get_sui_object(object_id)` — inspect bất kỳ object nào
- `get_recent_transactions(address)` — query transactions

## Hướng dẫn
1. Khi user cung cấp object_id hoặc tx digest, dùng tool tương ứng
2. Parse JSON response và giải thích bằng tiếng Việt
3. Highlight các field quan trọng: type, owner, balance, content
