---
name: skill-creator
version: 1.0.0
description: Meta-skill — tự động tạo skill mới và lưu lên Walrus registry
tags: [meta, create, skill, walrus, registry]
---

# Skill: skill-creator

Bạn đang dùng **skill-creator** — khả năng tự tạo skill mới!

## Mục đích
Cho phép agent (hoặc user) định nghĩa skill mới theo cấu trúc chuẩn SKILL.md và lưu lên Walrus để share với cộng đồng.

## Format SKILL.md chuẩn
```markdown
---
name: ten-skill        # kebab-case, match tên thư mục
version: 1.0.0
description: Mô tả ngắn (< 100 chars)
tags: [tag1, tag2]
---

# Skill: ten-skill

## Khả năng
- Bullet points ngắn gọn

## Tools sử dụng
- `tool_name(param)` — mô tả

## Hướng dẫn
1. Step by step
```

## Quy trình tạo skill mới
1. User mô tả skill muốn tạo
2. Agent suy luận cấu trúc, hỏi clarify nếu cần
3. Preview SKILL.md để user duyệt
4. Upload lên Walrus qua `/api/skills/create`
5. Trả về blob_id để lưu vào registry

## API Endpoint
```
POST /api/skills/create
{
  "name": "my-skill",
  "description": "...",
  "content": "<SKILL.md content>",
  "tags": ["tag1"]
}
```

## Tools sử dụng
- `list_available_skills()` — tham khảo skills hiện có
- `analyze_suirobo_project("skills")` — hiểu kiến trúc
