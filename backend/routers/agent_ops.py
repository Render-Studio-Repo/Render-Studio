"""Prompt-ops traceback upload. Harness key or super-admin."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Request

from backend.auth import get_current_user_optional
from backend.routers.debugger_analytics import _harness_or_admin
from backend.services import agent_ops_service as ops
from backend.services import mcp_watchdog_service as mcp_watchdog
from backend.services import pm_prompt_service as pm_prompt
from backend.services import team_status_service as team_status
from backend.services import weekly_bus_report_service as weekly_bus

router = APIRouter()


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/api/ops/agent-ops/tracebacks")
def upload_traceback(
    request: Request,
    body: dict = Body(...),
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    _harness_or_admin(request, user)
    return _call(ops.record_ops, body)


@router.get("/api/ops/agent-ops/tracebacks")
def list_tracebacks(
    request: Request,
    category_id: str | None = None,
    limit: int = 40,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    _harness_or_admin(request, user)
    return {"runs": ops.list_ops(limit=limit, category_id=category_id)}


@router.get("/api/ops/agent-ops/similar")
def similar_ops(
    request: Request,
    category_id: str,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    _harness_or_admin(request, user)
    return _call(ops.similar, category_id)


@router.get("/api/ops/agent-ops/tracebacks/{prompt_id}")
def get_traceback(
    prompt_id: str,
    request: Request,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    _harness_or_admin(request, user)
    row = ops.get_ops(prompt_id)
    if not row:
        raise HTTPException(404, "prompt_id not found")
    return row


@router.get("/api/ops/agent-ops/weekly-reports")
def list_weekly(
    request: Request,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    _harness_or_admin(request, user)
    return {"reports": weekly_bus.list_reports(), "latest": weekly_bus.latest(), "preview": weekly_bus.first_body()}


@router.post("/api/ops/agent-ops/weekly-reports")
def publish_weekly(
    request: Request,
    body: dict | None = Body(None),
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    _harness_or_admin(request, user)
    return _call(weekly_bus.publish, body or None)


@router.get("/api/ops/agent-ops/pm-prompt/kit")
def pm_prompt_kit(
    request: Request,
    cycle_id: str | None = None,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    _harness_or_admin(request, user)
    return pm_prompt.kit(cycle_id)


@router.post("/api/ops/agent-ops/pm-prompt")
def pm_prompt_submit(
    request: Request,
    body: dict = Body(...),
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    _harness_or_admin(request, user)
    return _call(pm_prompt.submit, body)


@router.get("/api/ops/agent-ops/pm-prompt")
def pm_prompt_status(
    request: Request,
    limit: int = 20,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    _harness_or_admin(request, user)
    return pm_prompt.status(limit)


@router.get("/api/ops/mcp-watchdog/headcount")
def mcp_wd_headcount(
    request: Request,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    _harness_or_admin(request, user)
    return mcp_watchdog.headcount()


@router.get("/api/ops/mcp-watchdog/report")
def mcp_wd_report(
    request: Request,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    _harness_or_admin(request, user)
    return {"markdown": mcp_watchdog.report_md(), "path": str(mcp_watchdog.REPORT_MD)}


@router.get("/api/ops/mcp-watchdog/endpoints")
def mcp_wd_endpoints(
    request: Request,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    _harness_or_admin(request, user)
    return {"ok": True, "endpoints": mcp_watchdog.endpoints(), "api": "https://render3d.app/mcp/watchdog"}


@router.post("/api/ops/mcp-watchdog/hello")
def mcp_wd_hello(
    request: Request,
    body: dict = Body(...),
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    _harness_or_admin(request, user)
    return _call(mcp_watchdog.hello, body)


@router.post("/api/ops/mcp-watchdog/converse")
def mcp_wd_converse(
    request: Request,
    body: dict = Body(...),
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    _harness_or_admin(request, user)
    return _call(mcp_watchdog.converse, body)


@router.get("/api/ops/group-chat")
def group_chat_read(limit: int = 80):
    return team_status.read_group_chat(limit)


@router.post("/api/ops/group-chat")
def group_chat_sam(body: dict = Body(default={})):
    """Founder composer. Always stored as agent=sam. No harness token."""
    return _call(team_status.post_founder_chat, body.get("text") or body.get("message") or "")


@router.get("/api/ops/team-status")
def team_status_latest(
    request: Request,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    _harness_or_admin(request, user)
    return team_status.latest()


@router.get("/api/ops/team-status/history")
def team_status_history(
    request: Request,
    limit: int = 48,
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    _harness_or_admin(request, user)
    return team_status.history(limit)
