# ruff: noqa
"""
Suirobo Agent — Skills Architecture với Progressive Disclosure
3-layer context loading để tối ưu token usage
"""

import os
import json
import pathlib

from google.adk.agents import Agent
from google.adk.apps import App
from google.adk.models import Gemini
from google.genai import types

from app.tools import (
    get_sui_balance,
    get_all_balances,
    get_token_price,
    get_recent_transactions,
    get_sui_object,
    get_walrus_blob,
    analyze_suirobo_project,
    list_available_skills,
)

# ── Skills Directory ──────────────────────────────────────────────────────────
SKILLS_DIR = pathlib.Path(__file__).parent / "skills"

def _load_skill_content(skill_name: str) -> str:
    """Đọc SKILL.md của một skill cụ thể."""
    skill_path = SKILLS_DIR / skill_name / "SKILL.md"
    if skill_path.exists():
        return skill_path.read_text(encoding="utf-8")
    return f"Skill '{skill_name}' không tồn tại."

def _list_skills_summary() -> str:
    """Tạo summary ngắn (~100 tokens/skill) cho Progressive Disclosure L1."""
    lines = ["📚 Skills có sẵn (dùng load_skill để xem chi tiết):"]
    if SKILLS_DIR.exists():
        for skill_dir in sorted(SKILLS_DIR.iterdir()):
            if skill_dir.is_dir():
                skill_md = skill_dir / "SKILL.md"
                desc = "No description"
                if skill_md.exists():
                    content = skill_md.read_text(encoding="utf-8")
                    for line in content.splitlines():
                        if line.startswith("description:"):
                            desc = line.split(":", 1)[1].strip()
                            break
                lines.append(f"  • **{skill_dir.name}**: {desc}")
    return "\n".join(lines)


# ── Skill Tools (Progressive Disclosure L2) ───────────────────────────────────
def load_skill(skill_name: str) -> str:
    """Load hướng dẫn chi tiết của một skill theo tên.

    Args:
        skill_name: Tên skill cần load (vd: sui-balance, sui-swap, skill-creator).

    Returns:
        Nội dung SKILL.md đầy đủ của skill đó.
    """
    content = _load_skill_content(skill_name)
    if "không tồn tại" in content:
        available = _list_skills_summary()
        return f"Skill '{skill_name}' không tìm thấy.\n\n{available}"
    return content


def load_skill_resource(skill_name: str, resource_name: str) -> str:
    """Load tài liệu tham khảo chi tiết của một skill (Progressive Disclosure L3).

    Args:
        skill_name: Tên skill.
        resource_name: Tên file tài liệu (vd: examples.md, api-reference.md).

    Returns:
        Nội dung tài liệu, hoặc thông báo lỗi nếu không tìm thấy.
    """
    resource_path = SKILLS_DIR / skill_name / resource_name
    if resource_path.exists():
        return resource_path.read_text(encoding="utf-8")
    return f"Resource '{resource_name}' không tồn tại trong skill '{skill_name}'."


# ── Load User Skills từ Walrus Registry ───────────────────────────────────────
def _load_user_skills_from_registry() -> list:
    """Load user-created skills từ local registry (sync từ Walrus)."""
    registry_path = pathlib.Path(__file__).parent / "skill_registry.json"
    if not registry_path.exists():
        return []
    try:
        with open(registry_path, encoding="utf-8") as f:
            registry = json.load(f)
        return registry.get("skills", [])
    except Exception:
        return []


# ── SKILL_SUMMARY là L1 context (luôn inject vào system prompt) ───────────────
SKILL_SUMMARY = _list_skills_summary()
USER_SKILLS = _load_user_skills_from_registry()
USER_SKILLS_TEXT = ""
if USER_SKILLS:
    user_skill_lines = [f"\n🌐 User-created skills (từ Walrus):"]
    for s in USER_SKILLS:
        user_skill_lines.append(f"  • **{s['name']}**: {s.get('description', '?')}")
    USER_SKILLS_TEXT = "\n".join(user_skill_lines)

SYSTEM_INSTRUCTION = f"""Bạn là **SUIROBO** — trợ lý robot AI thông minh, chuyên gia hệ sinh thái Sui blockchain.
Phong cách: Thân thiện, ngắn gọn, chính xác. Dùng **TIẾNG VIỆT** làm ngôn ngữ chính. Emoji được phép.

## Kiến trúc Skills (Progressive Disclosure)
Bạn có quyền truy cập vào các skills chuyên biệt. Khi cần xử lý tác vụ phức tạp, hãy load skill phù hợp:
- **L1** (luôn có): Summary ngắn của mỗi skill bên dưới
- **L2** (load khi cần): Dùng `load_skill(name)` để xem hướng dẫn đầy đủ
- **L3** (nâng cao): Dùng `load_skill_resource(name, file)` để xem docs chi tiết

{SKILL_SUMMARY}{USER_SKILLS_TEXT}

## Nguyên tắc hoạt động
1. Với câu hỏi đơn giản → trả lời trực tiếp
2. Với tác vụ có domain skill → load skill trước, rồi thực hiện
3. Luôn confirm với user trước khi thực hiện giao dịch (swap, transfer)
4. Khi không chắc → hỏi user thay vì đoán
5. Với yêu cầu tạo skill mới → load `skill-creator` skill"""

# ── Build Root Agent ─────────────────────────────────────────────────────────
root_agent = Agent(
    name="suirobo_agent",
    model=Gemini(
        model="gemini-2.0-flash",
        retry_options=types.HttpRetryOptions(attempts=3),
    ),
    instruction=SYSTEM_INSTRUCTION,
    tools=[
        # Skill tools (Progressive Disclosure)
        load_skill,
        load_skill_resource,
        list_available_skills,
        # Sui blockchain tools
        get_sui_balance,
        get_all_balances,
        get_token_price,
        get_recent_transactions,
        get_sui_object,
        get_walrus_blob,
        analyze_suirobo_project,
    ],
)

app = App(
    root_agent=root_agent,
    name="suirobo_agent_app",
)
