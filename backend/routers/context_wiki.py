"""Super-admin wiki-link docs + debugger send."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.auth import get_current_user
from backend.services import context_wiki_service, platform_roles_service

router = APIRouter()


def _require_super(user: dict[str, Any]) -> None:
    if not platform_roles_service.is_super_admin(user):
        raise HTTPException(403, "Workspace wiki docs are only available to the super admin.")


class DebuggerBody(BaseModel):
    paths: list[str] = Field(default_factory=list, max_length=24)
    path: str | None = Field(default=None, max_length=240)
    from_path: str = Field(default="", max_length=240)
    reason: str = Field(default="", max_length=800)
    status: str = Field(default="", max_length=20)
    selected_text: str = Field(default="", max_length=800)
    related: bool | None = None
    related_label: str = Field(default="", max_length=80)


@router.get("/api/ops/context-wiki/docs")
def context_wiki_docs(user: dict[str, Any] = Depends(get_current_user)):
    _require_super(user)
    return {"files": context_wiki_service.list_docs()}


@router.get("/api/ops/context-wiki/file")
def context_wiki_file(
    path: str,
    from_path: str | None = None,
    user: dict[str, Any] = Depends(get_current_user),
):
    _require_super(user)
    data = context_wiki_service.read_file(path, from_path=from_path)
    if not data:
        raise HTTPException(404, "File not found or blocked.")
    return {"file": data}


@router.post("/api/ops/context-wiki/related")
def context_wiki_related(body: DebuggerBody, user: dict[str, Any] = Depends(get_current_user)):
    _require_super(user)
    paths = list(body.paths or [])
    if body.path:
        paths.append(body.path)
    return context_wiki_service.relatedness(paths)


@router.post("/api/ops/context-wiki/issue-check")
def context_wiki_issue(body: DebuggerBody, user: dict[str, Any] = Depends(get_current_user)):
    _require_super(user)
    paths = list(body.paths or [])
    if body.path:
        paths.append(body.path)
    return context_wiki_service.issue_file_check(paths, f"{body.reason}\n{body.selected_text}")


@router.post("/api/ops/context-wiki/debugger")
def context_wiki_debugger(body: DebuggerBody, user: dict[str, Any] = Depends(get_current_user)):
    _require_super(user)
    try:
        return context_wiki_service.send_debugger(user, body.model_dump())
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
