# ruff: noqa
"""
Suirobo Agent Server — FastAPI :3002
ADK playground + 6 Skill Registry API endpoints + Skill Studio UI
"""

import os
import pathlib
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from google.adk.cli.fast_api import get_fast_api_app

from app.skill_registry import (
    create_skill,
    list_skills,
    get_skill,
    delete_skill,
    preview_skill,
)

# ── Constants ─────────────────────────────────────────────────────────────────
AGENT_DIR = pathlib.Path(__file__).parent.parent  # /suirobo-app/agent/
STUDIO_HTML = pathlib.Path(__file__).parent / "templates" / "studio.html"

# ── Pydantic Models ───────────────────────────────────────────────────────────
class CreateSkillRequest(BaseModel):
    name: str
    description: str
    content: str
    tags: list[str] = []
    user_id: str = "default"

class PreviewSkillRequest(BaseModel):
    name: str
    description: str
    capabilities: list[str]
    tools_used: list[str]

# ── App Factory ───────────────────────────────────────────────────────────────
# Lấy ADK FastAPI app (playground + chat API)
adk_app: FastAPI = get_fast_api_app(
    agents_dir=str(AGENT_DIR),
    web=True,
    session_service_uri=None,
    artifact_service_uri=None,
    allow_origins=["*"],
)
adk_app.title = "Suirobo Agent"
adk_app.description = "SUIROBO — AI Agent chuyên gia hệ sinh thái Sui blockchain"

# Thêm CORS
adk_app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Skill Registry API Endpoints ──────────────────────────────────────────────

@adk_app.get("/api/skills", tags=["Skills Registry"])
async def api_list_skills(user_id: str = "default"):
    """List built-in + user skills từ Walrus registry."""
    result = list_skills(user_id=user_id, include_builtin=True)
    return result


@adk_app.post("/api/skills/create", tags=["Skills Registry"])
async def api_create_skill(body: CreateSkillRequest):
    """Tạo skill mới và upload lên Walrus."""
    result = create_skill(
        name=body.name,
        description=body.description,
        content=body.content,
        tags=body.tags,
        user_id=body.user_id,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@adk_app.get("/api/skills/preview/generate", tags=["Skills Registry"])
async def api_preview_skill(
    name: str, description: str,
    capabilities: str = "", tools_used: str = ""
):
    """Preview SKILL.md trước khi tạo."""
    caps = [c.strip() for c in capabilities.split(",") if c.strip()]
    tools = [t.strip() for t in tools_used.split(",") if t.strip()]
    content = preview_skill(name, description, caps, tools)
    return {"preview": content}


@adk_app.get("/api/skills/{name}", tags=["Skills Registry"])
async def api_get_skill(name: str):
    """Xem nội dung đầy đủ của skill (built-in hoặc Walrus)."""
    result = get_skill(name)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@adk_app.delete("/api/skills/{name}", tags=["Skills Registry"])
async def api_delete_skill(name: str, user_id: str = "default"):
    """Xóa skill khỏi registry."""
    result = delete_skill(name, user_id=user_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


# ── Skill Studio UI ───────────────────────────────────────────────────────────
@adk_app.get("/studio", response_class=HTMLResponse, tags=["Studio"])
async def skill_studio():
    """Skill Studio — giao diện quản lý skills dark-theme."""
    if STUDIO_HTML.exists():
        return STUDIO_HTML.read_text(encoding="utf-8")
    return HTMLResponse("<h1>Studio template not found. Run setup first.</h1>", status_code=500)


# ── Health Check ──────────────────────────────────────────────────────────────
@adk_app.get("/health", tags=["System"])
async def health():
    return {"status": "ok", "agent": "suirobo", "version": "2.0.0"}


# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.getenv("PORT", 3002))
    print(f"\n🤖 SUIROBO Agent Server khởi động tại http://localhost:{port}")
    print(f"   📖 API Docs: http://localhost:{port}/docs")
    print(f"   🎨 Skill Studio: http://localhost:{port}/studio")
    print(f"   💬 Playground: http://localhost:{port}/\n")
    uvicorn.run(adk_app, host="0.0.0.0", port=port, reload=False)
