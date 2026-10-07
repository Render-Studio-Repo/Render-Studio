"""Slicer plate layout API for VR Bambu preview. Token bambu1."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.auth import get_current_user, get_current_user_optional
from backend.services import slicer_plate_layout as plates

router = APIRouter()


class SlicerLayoutBody(BaseModel):
    action: str = Field(..., min_length=2, max_length=40)
    part_ids: list[str] = Field(default_factory=list)
    pointed_ids: list[str] = Field(default_factory=list)
    draw_selected_ids: list[str] = Field(default_factory=list)
    plate_id: int | None = None
    orientation: str | None = None
    mode: str | None = None
    dx_mm: float | None = None
    dy_mm: float | None = None
    filament: str | None = None
    supports_enabled: bool | None = None
    infill_pct: float | None = None
    ping_group: bool = False
    cede_harness: bool = False
    bug_id: str | None = None
    tickets: list[str] = Field(default_factory=list)
    text: str | None = None
    description: str | None = None


def _read_project(user: dict[str, Any], project_id: str):
    from backend.main import _require_project_read

    return _require_project_read(user, project_id)


def _filename(raw: str) -> str:
    from backend.services import cad_service

    name, suffix = cad_service.split_file_api_suffix(raw)
    if suffix and suffix != "slicer-layout":
        return name
    return name or raw


@router.post("/api/xr/round-table")
def round_table_action(body: dict = Body(default={}), user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import round_table_chat as table

    try:
        return table.handle(str(body.get("action") or "toss"), body)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/api/xr/trigger-investigate")
def trigger_investigate(user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import round_table_chat as table

    _ = user
    return table.investigate_triggers()


@router.get("/api/xr/control-config")
def get_xr_control_config():
    from backend.services import xr_control_live as live

    return {"ok": True, **live.load_config()}


@router.get("/api/xr/control-notes")
def get_xr_control_notes(limit: int = 40):
    from backend.services import xr_control_live as live

    return {"ok": True, "notes": live.list_notes(limit), "token": live.TOKEN}


@router.put("/api/xr/control-config")
def put_xr_control_config(body: dict = Body(default={}), user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import xr_control_live as live

    _ = user
    return {"ok": True, **live.patch_config(body)}


@router.post("/api/xr/control-config")
def post_xr_control_config(body: dict = Body(default={}), user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import xr_control_live as live

    _ = user
    try:
        return live.handle(str(body.get("action") or "get"), body)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/api/sandbox/context-log")
def post_sandbox_context_log(
    body: dict = Body(default={}),
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    """Compact click/context events → jsonl + optional Supabase sandbox_context_events."""
    from backend.services import sandbox_context_log as ctx

    payload = dict(body or {})
    if isinstance(user, dict) and user.get("id") and not payload.get("session_id"):
        payload["session_id"] = str(user["id"])[:80]
    return ctx.record_context_event(payload)


@router.get("/api/sandbox/token-status")
def get_sandbox_token_status(limit: int = 60):
    """Live token / prompt-trace lookback for sandbox charts. Local status only."""
    from backend.services import sandbox_token_status as sts

    return sts.token_status(limit=limit)


@router.post("/api/sandbox/remix-blueprint")
def post_sandbox_remix_blueprint(
    body: dict = Body(default={}),
    user: dict[str, Any] | None = Depends(get_current_user_optional),
):
    """Save remix restore pointers + merge health as a guided blueprint."""
    from backend.services import sandbox_remix_blueprint as remix

    payload = dict(body or {})
    if isinstance(user, dict) and user.get("id") and not payload.get("session_id"):
        payload["session_id"] = str(user["id"])[:80]
    return remix.record_blueprint(payload)


@router.get("/api/xr/control-wire")
def list_xr_control_wire(user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import xr_control_live as live

    _ = user
    return live.list_wire()


@router.put("/api/xr/control-wire/{wire_id}")
def decide_xr_control_wire(wire_id: str, body: dict = Body(default={}), user: dict[str, Any] = Depends(get_current_user)):
    from backend.services import xr_control_live as live

    _ = user
    try:
        return live.approve_wire(wire_id, action=str(body.get("action") or body.get("decision") or "approve"))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/api/xr/slicer-ping")
def slicer_group_ping(body: dict = Body(default={}), user: dict[str, Any] = Depends(get_current_user)):
    """Astra/VR board ping. Never production-reset. Token bambu1/xrctrl1."""
    text = str(body.get("text") or body.get("message") or "").strip()
    if not text:
        raise HTTPException(422, "text is required")
    try:
        return plates.ping_group(text, agent=str(body.get("agent") or "astra"))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/api/projects/{project_id}/files/{filename:path}/slicer-layout")
def get_slicer_layout(project_id: str, filename: str, user: dict[str, Any] = Depends(get_current_user)):
    path = _read_project(user, project_id)
    safe = _filename(filename)
    try:
        return plates.build_layout(path, safe)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.post("/api/projects/{project_id}/files/{filename:path}/slicer-layout")
def post_slicer_layout(
    project_id: str,
    filename: str,
    body: SlicerLayoutBody = Body(...),
    user: dict[str, Any] = Depends(get_current_user),
):
    path = _read_project(user, project_id)
    safe = _filename(filename)
    try:
        layout = plates.build_layout(path, safe)
        args = body.model_dump()
        if body.cede_harness and body.action not in {"cede_harness", "confirm_oriented", "ping_group"}:
            args["action"] = "cede_harness"
        layout = plates.apply_command(layout, args)
        plates.save_sidecar(path, layout.get("filename") or safe, layout)
        out: dict[str, Any] = {"ok": True, "layout": layout, "token": plates.TOKEN}
        action = str(args.get("action") or "")
        if action in {"confirm_oriented", "oriented", "cede_harness", "ping_group"} or body.ping_group or body.cede_harness:
            log = plates.write_plate_log(user, layout, args)
            out["log"] = {"ok": log.get("ok"), "name": log.get("name"), "path": log.get("ai_path")}
            if body.ping_group or action == "ping_group":
                plate_no = args.get("plate_id") or ""
                out["group"] = plates.ping_group(
                    args.get("text")
                    or f"Astra · VR plate {plate_no} oriented (bambu1). Building slicer preview in regular VR — no Bambu desktop window."
                )
            if body.cede_harness or action == "cede_harness":
                out["harness"] = plates.cede_harness(layout, args, log_name=str(log.get("name") or ""))
        return out
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
