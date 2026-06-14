# ruff: noqa
"""
Suirobo Skill Registry — Walrus CRUD + local JSON index
Quản lý user-created skills lưu trên Walrus
"""

import json
import pathlib
import time
import urllib.request
import urllib.parse
import urllib.error
from typing import Optional

WALRUS_PUBLISHER = "https://publisher.walrus.space"
WALRUS_AGGREGATOR = "https://aggregator.walrus.space"
REGISTRY_FILE = pathlib.Path(__file__).parent / "skill_registry.json"


# ── Local Registry (JSON index) ───────────────────────────────────────────────
def _load_registry() -> dict:
    """Đọc local registry."""
    if REGISTRY_FILE.exists():
        try:
            with open(REGISTRY_FILE, encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {"version": "1.0", "skills": [], "updated_at": 0}


def _save_registry(registry: dict):
    """Ghi local registry."""
    registry["updated_at"] = int(time.time())
    with open(REGISTRY_FILE, "w", encoding="utf-8") as f:
        json.dump(registry, f, ensure_ascii=False, indent=2)


# ── Walrus I/O ─────────────────────────────────────────────────────────────────
def upload_to_walrus(content: str, content_type: str = "text/markdown") -> Optional[str]:
    """Upload content lên Walrus, trả về blob_id hoặc None nếu lỗi.
    
    Args:
        content: Nội dung cần upload (text).
        content_type: MIME type (mặc định text/markdown).
    
    Returns:
        blob_id string, hoặc None nếu lỗi.
    """
    try:
        data = content.encode("utf-8")
        # Walrus store: PUT /v1/store
        url = f"{WALRUS_PUBLISHER}/v1/store?epochs=5"
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": content_type},
            method="PUT"
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            resp = json.loads(r.read())
        # Parse response: {"newlyCreated": {"blobObject": {"blobId": "..."}}}
        if "newlyCreated" in resp:
            return resp["newlyCreated"]["blobObject"]["blobId"]
        elif "alreadyCertified" in resp:
            return resp["alreadyCertified"]["blobId"]
        return None
    except Exception as e:
        print(f"[SkillRegistry] Upload lỗi: {e}")
        return None


def download_from_walrus(blob_id: str) -> Optional[str]:
    """Download content từ Walrus theo blob_id.
    
    Args:
        blob_id: ID của blob.
    
    Returns:
        Nội dung text, hoặc None nếu lỗi.
    """
    try:
        url = f"{WALRUS_AGGREGATOR}/v1/blobs/{blob_id}"
        with urllib.request.urlopen(url, timeout=15) as r:
            return r.read().decode("utf-8", errors="replace")
    except Exception as e:
        print(f"[SkillRegistry] Download lỗi: {e}")
        return None


# ── CRUD Operations ────────────────────────────────────────────────────────────
def create_skill(name: str, description: str, content: str, tags: list[str], user_id: str = "default") -> dict:
    """Tạo skill mới: upload SKILL.md lên Walrus + ghi vào registry.
    
    Args:
        name: Tên skill (kebab-case).
        description: Mô tả ngắn.
        content: Nội dung SKILL.md đầy đủ.
        tags: Danh sách tags.
        user_id: ID người dùng (mặc định "default").
    
    Returns:
        Dict chứa thông tin skill đã tạo, hoặc lỗi.
    """
    # Validate
    if not name or not name.replace("-", "").replace("_", "").isalnum():
        return {"error": f"Tên skill không hợp lệ: '{name}'. Dùng kebab-case (vd: my-skill)."}
    
    registry = _load_registry()
    # Kiểm tra trùng tên
    if any(s["name"] == name for s in registry["skills"]):
        return {"error": f"Skill '{name}' đã tồn tại. Dùng tên khác hoặc xóa trước."}
    
    # Upload lên Walrus
    blob_id = upload_to_walrus(content, "text/markdown")
    if not blob_id:
        return {"error": "Không thể upload lên Walrus. Kiểm tra kết nối mạng."}
    
    # Ghi vào registry
    skill_entry = {
        "name": name,
        "description": description,
        "tags": tags,
        "blob_id": blob_id,
        "user_id": user_id,
        "created_at": int(time.time()),
    }
    registry["skills"].append(skill_entry)
    _save_registry(registry)
    
    return {"success": True, "skill": skill_entry}


def list_skills(user_id: str = "default", include_builtin: bool = True) -> dict:
    """Liệt kê tất cả skills (built-in + user skills từ Walrus registry).
    
    Args:
        user_id: Lọc theo user (mặc định "default" = tất cả).
        include_builtin: Bao gồm built-in skills không.
    
    Returns:
        Dict chứa danh sách skills.
    """
    registry = _load_registry()
    user_skills = [s for s in registry["skills"] if user_id == "all" or s.get("user_id") == user_id]
    
    result = {"user_skills": user_skills, "total_user": len(user_skills)}
    
    if include_builtin:
        skills_dir = pathlib.Path(__file__).parent / "skills"
        builtin = []
        if skills_dir.exists():
            for d in sorted(skills_dir.iterdir()):
                if d.is_dir():
                    skill_md = d / "SKILL.md"
                    desc = "Built-in skill"
                    tags = []
                    if skill_md.exists():
                        for line in skill_md.read_text(encoding="utf-8").splitlines():
                            if line.startswith("description:"):
                                desc = line.split(":", 1)[1].strip()
                            elif line.startswith("tags:"):
                                raw = line.split(":", 1)[1].strip()
                                tags = [t.strip().strip("[],'\"") for t in raw.split(",")]
                    builtin.append({"name": d.name, "description": desc, "tags": tags, "type": "builtin"})
        result["builtin_skills"] = builtin
        result["total_builtin"] = len(builtin)
    
    return result


def get_skill(name: str) -> dict:
    """Lấy nội dung đầy đủ của skill (ưu tiên built-in, fallback Walrus).
    
    Args:
        name: Tên skill.
    
    Returns:
        Dict chứa content SKILL.md.
    """
    # Thử built-in trước
    skill_path = pathlib.Path(__file__).parent / "skills" / name / "SKILL.md"
    if skill_path.exists():
        return {"name": name, "type": "builtin", "content": skill_path.read_text(encoding="utf-8")}
    
    # Tìm trong registry (Walrus)
    registry = _load_registry()
    entry = next((s for s in registry["skills"] if s["name"] == name), None)
    if not entry:
        return {"error": f"Skill '{name}' không tìm thấy."}
    
    content = download_from_walrus(entry["blob_id"])
    if not content:
        return {"error": f"Không thể tải skill '{name}' từ Walrus (blob: {entry['blob_id'][:12]}...)."}
    
    return {"name": name, "type": "user", "blob_id": entry["blob_id"], "content": content}


def delete_skill(name: str, user_id: str = "default") -> dict:
    """Xóa skill khỏi registry (không xóa khỏi Walrus — immutable).
    
    Args:
        name: Tên skill.
        user_id: User ID (chỉ xóa skill của mình).
    
    Returns:
        Kết quả xóa.
    """
    registry = _load_registry()
    original_len = len(registry["skills"])
    registry["skills"] = [
        s for s in registry["skills"]
        if not (s["name"] == name and s.get("user_id") == user_id)
    ]
    if len(registry["skills"]) == original_len:
        return {"error": f"Skill '{name}' không tìm thấy hoặc bạn không có quyền xóa."}
    
    _save_registry(registry)
    return {"success": True, "message": f"Skill '{name}' đã xóa khỏi registry."}


def preview_skill(name: str, description: str, capabilities: list[str], tools_used: list[str]) -> str:
    """Tạo preview SKILL.md trước khi upload.
    
    Args:
        name: Tên skill.
        description: Mô tả.
        capabilities: Danh sách khả năng.
        tools_used: Danh sách tools sử dụng.
    
    Returns:
        Nội dung SKILL.md preview.
    """
    caps = "\n".join(f"- {c}" for c in capabilities)
    tools = "\n".join(f"- `{t}`" for t in tools_used)
    return f"""---
name: {name}
version: 1.0.0
description: {description}
tags: [user-created, sui]
---

# Skill: {name}

## Khả năng
{caps}

## Tools sử dụng
{tools}

## Hướng dẫn
1. [Điền hướng dẫn sử dụng skill này]
2. [Step 2]
3. [Step 3]
"""
