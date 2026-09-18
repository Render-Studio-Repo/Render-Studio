"""Workshop state helpers backed by project.json metadata."""

from __future__ import annotations

import os
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.services import history_service, project_store

META_KEY = "workshop"
DEBUG_HOOK_ENV_KEYS = (
    "RENDER_STUDIO_WORKSHOP_DEBUG_URL",
    "RENDER_WORKSHOP_DEBUG_URL",
    "WORKSHOP_DEBUG_HOOK_URL",
)
VALID_QUEUE_STATUSES = {"pass", "fail", "waiting"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _debug_hook_url() -> str:
    for key in DEBUG_HOOK_ENV_KEYS:
        value = str(os.getenv(key) or "").strip()
        if value:
            return value
    return ""


def _project_label(project_path: Path, meta: dict[str, Any] | None = None) -> str:
    meta = meta if meta is not None else project_store.load_meta(project_path)
    return str(meta.get("name") or project_path.name).strip() or project_path.name


def _seed_state(project_path: Path, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    label = _project_label(project_path, meta)
    return {
        "project_label": label,
        "agents_source": "mock",
        "agents": [
            {
                "id": "floor-lead",
                "name": "Floor lead",
                "status": "In room",
                "tasks": [
                    {"id": "prep-bay", "title": "Stage the print bay", "status": "active"},
                    {"id": "material-check", "title": "Check incoming materials", "status": "queued"},
                ],
            },
            {
                "id": "printer-tech",
                "name": "Printer tech",
                "status": "Watching",
                "tasks": [
                    {"id": "watch-queue", "title": "Watch overnight print queue", "status": "active"},
                    {"id": "plate-swap", "title": "Prepare next plate swap", "status": "queued"},
                ],
            },
            {
                "id": "review-assistant",
                "name": "Review assistant",
                "status": "Ready",
                "tasks": [
                    {"id": "qa-handoff", "title": "Collect approval notes", "status": "ready"},
                ],
            },
        ],
        "projects": {
            "create": [
                {
                    "id": "create-layout",
                    "title": f"{label} setup",
                    "summary": "Lay out the printer bay, prep cart, and handoff area for this build.",
                    "status": "upcoming",
                },
                {
                    "id": "create-fixture",
                    "title": "Fixture check",
                    "summary": "Place a simple fixture stand beside the active workbench for fast test fits.",
                    "status": "queued",
                },
            ],
            "train": [
                {
                    "id": "train-ops",
                    "title": "Operator walkthrough",
                    "summary": "Train the room on first article checks and next-step handoff language.",
                    "status": "upcoming",
                },
                {
                    "id": "train-review",
                    "title": "Review flow",
                    "summary": "Teach the room which jobs can ship and which need a second look.",
                    "status": "planned",
                },
            ],
        },
        "approvals": [
            {
                "id": "approve-voice-station",
                "title": "Voice prompt station",
                "summary": "Approve the live prompt desk so spoken requests can flow into the editor.",
                "status": "pending",
            },
            {
                "id": "approve-first-article",
                "title": "First article review",
                "summary": "Sign off the first workshop placement and motion check before the queue moves on.",
                "status": "pending",
            },
        ],
        "queue": [
            {
                "id": "queue-plate-a",
                "label": "Plate A · enclosure shells",
                "status": "waiting",
                "detail": "Waiting for the next open printer.",
            },
            {
                "id": "queue-brackets",
                "label": "Bracket print check",
                "status": "pass",
                "detail": "Recent placement and clearances passed.",
            },
            {
                "id": "queue-cable-guide",
                "label": "Cable guide fit",
                "status": "fail",
                "detail": "Needs a second review before release.",
            },
        ],
        "debug": {
            "hook_available": bool(_debug_hook_url()),
            "last_result": None,
        },
    }


def _normalize_project_entries(values: Any, fallback: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(values, list) or not values:
        return [dict(item) for item in fallback]
    out: list[dict[str, Any]] = []
    for item in values:
        if isinstance(item, dict):
            out.append(dict(item))
    return out or [dict(item) for item in fallback]


def _normalize_sandbox_session(value: Any) -> dict[str, Any]:
    data = value if isinstance(value, dict) else {}
    checkpoint_index = data.get("checkpoint_index")
    try:
        checkpoint_index = int(checkpoint_index)
    except (TypeError, ValueError):
        checkpoint_index = -1
    return {
        "active": bool(data.get("active")),
        "session_key": str(data.get("session_key") or "").strip(),
        "checkpoint_id": str(data.get("checkpoint_id") or "").strip(),
        "checkpoint_index": checkpoint_index,
        "checkpoint_label": str(data.get("checkpoint_label") or "").strip(),
        "checkpoint_filename": str(data.get("checkpoint_filename") or "").strip(),
        "checkpoint_entry_id": str(data.get("checkpoint_entry_id") or "").strip(),
        "entered_at": str(data.get("entered_at") or "").strip(),
        "last_action": str(data.get("last_action") or "").strip(),
        "last_action_at": str(data.get("last_action_at") or "").strip(),
        "last_restored_at": str(data.get("last_restored_at") or "").strip(),
    }


def _normalize_state(value: Any, project_path: Path, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    seed = _seed_state(project_path, meta)
    data = value if isinstance(value, dict) else {}
    projects = data.get("projects") if isinstance(data.get("projects"), dict) else {}
    debug = data.get("debug") if isinstance(data.get("debug"), dict) else {}
    return {
        "project_label": str(data.get("project_label") or seed["project_label"]),
        "agents_source": "live" if data.get("agents_source") == "live" else "mock",
        "agents": _normalize_project_entries(data.get("agents"), seed["agents"]),
        "projects": {
            "create": _normalize_project_entries(projects.get("create"), seed["projects"]["create"]),
            "train": _normalize_project_entries(projects.get("train"), seed["projects"]["train"]),
        },
        "approvals": _normalize_project_entries(data.get("approvals"), seed["approvals"]),
        "queue": _normalize_project_entries(data.get("queue"), seed["queue"]),
        "debug": {
            "hook_available": bool(_debug_hook_url()),
            "last_result": debug.get("last_result"),
        },
        "sandbox": _normalize_sandbox_session(data.get("sandbox")),
    }


def _save_state(project_path: Path, state: dict[str, Any]) -> dict[str, Any]:
    meta = project_store.load_meta(project_path)
    meta[META_KEY] = state
    project_store.save_meta(project_path, meta)
    project_store.touch_project(project_path)
    return state


def get_state(project_path: Path) -> dict[str, Any]:
    meta = project_store.load_meta(project_path)
    normalized = _normalize_state(meta.get(META_KEY), project_path, meta)
    if meta.get(META_KEY) != normalized:
        _save_state(project_path, normalized)
    return normalized


def _checkpoint_payload(project_path: Path, session: dict[str, Any]) -> dict[str, Any]:
    checkpoint_index = int(session.get("checkpoint_index", -1))
    timeline = history_service.timeline_summary(project_path)
    entries = timeline.get("entries") or []
    entry = entries[checkpoint_index] if 0 <= checkpoint_index < len(entries) else None
    return {
        "active": bool(session.get("active")),
        "session_key": session.get("session_key") or "",
        "checkpoint_id": session.get("checkpoint_id") or "",
        "checkpoint_index": checkpoint_index,
        "checkpoint_label": session.get("checkpoint_label") or "Restore point",
        "checkpoint_filename": session.get("checkpoint_filename") or "",
        "checkpoint_entry_id": session.get("checkpoint_entry_id") or "",
        "entered_at": session.get("entered_at") or "",
        "last_action": session.get("last_action") or "",
        "last_action_at": session.get("last_action_at") or "",
        "last_restored_at": session.get("last_restored_at") or "",
        "timeline_entries": len(entries),
        "current_index": timeline.get("current_index", -1),
        "changes_since_checkpoint": max(0, int(timeline.get("current_index", -1)) - checkpoint_index) if checkpoint_index >= 0 else max(0, len(entries) - 1),
        "current_label": str((entries[timeline.get("current_index", -1)] or {}).get("label") or "") if entries and 0 <= int(timeline.get("current_index", -1)) < len(entries) else "",
        "checkpoint_entry": entry,
    }


def _state_with_sandbox(project_path: Path, state: dict[str, Any]) -> dict[str, Any]:
    enriched = dict(state)
    enriched["sandbox"] = _checkpoint_payload(project_path, _normalize_sandbox_session(state.get("sandbox")))
    return enriched


def start_sandbox_session(project_path: Path, session_key: str | None = None) -> dict[str, Any]:
    state = get_state(project_path)
    current = _normalize_sandbox_session(state.get("sandbox"))
    desired_key = str(session_key or current.get("session_key") or secrets.token_hex(8)).strip()
    if current.get("active") and current.get("session_key") == desired_key:
        return _state_with_sandbox(project_path, state)

    timeline = history_service.timeline_summary(project_path)
    entries = timeline.get("entries") or []
    checkpoint_index = int(timeline.get("current_index", -1))
    checkpoint_entry = entries[checkpoint_index] if 0 <= checkpoint_index < len(entries) else {}
    state["sandbox"] = {
        "active": True,
        "session_key": desired_key,
        "checkpoint_id": secrets.token_hex(6),
        "checkpoint_index": checkpoint_index,
        "checkpoint_label": str(checkpoint_entry.get("label") or checkpoint_entry.get("filename") or "Starting point"),
        "checkpoint_filename": str(checkpoint_entry.get("filename") or ""),
        "checkpoint_entry_id": str(checkpoint_entry.get("id") or ""),
        "entered_at": _now_iso(),
        "last_action": "entered",
        "last_action_at": _now_iso(),
        "last_restored_at": "",
    }
    _save_state(project_path, state)
    return _state_with_sandbox(project_path, state)


def restore_sandbox_checkpoint(
    project_path: Path,
    *,
    user_id: str | None = None,
    user_name: str | None = None,
    end_session: bool = False,
) -> dict[str, Any]:
    state = get_state(project_path)
    session = _normalize_sandbox_session(state.get("sandbox"))
    checkpoint_index = int(session.get("checkpoint_index", -1))
    if checkpoint_index < 0:
        raise ValueError("This sandbox session does not have a saved restore point yet.")
    restore = history_service.restore_as_latest(
        project_path,
        checkpoint_index,
        user_id=user_id,
        user_name=user_name,
    )
    state["sandbox"] = {
        **session,
        "active": False if end_session else True,
        "last_action": "discarded" if end_session else "restored",
        "last_action_at": _now_iso(),
        "last_restored_at": _now_iso(),
    }
    if end_session:
        state["sandbox"]["session_key"] = ""
    _save_state(project_path, state)
    return {
        "restore": restore,
        "workshop": _state_with_sandbox(project_path, state),
        "timeline": history_service.timeline_summary(project_path),
    }


def publish_sandbox_session(project_path: Path) -> dict[str, Any]:
    state = get_state(project_path)
    session = _normalize_sandbox_session(state.get("sandbox"))
    if not session.get("active"):
        raise ValueError("Sandbox is not active for this project.")
    state["sandbox"] = {
        **session,
        "active": False,
        "session_key": "",
        "last_action": "pushed_live",
        "last_action_at": _now_iso(),
    }
    _save_state(project_path, state)
    return _state_with_sandbox(project_path, state)


def approve(project_path: Path, item_id: str) -> dict[str, Any]:
    state = get_state(project_path)
    for item in state["approvals"]:
        if str(item.get("id") or "") != str(item_id):
            continue
        item["status"] = "approved"
        item["approved_at"] = _now_iso()
        _save_state(project_path, state)
        return dict(item)
    raise ValueError("Approval item not found.")


async def run_debug(project_path: Path, row_id: str, *, label: str = "", detail: str = "") -> dict[str, Any]:
    state = get_state(project_path)
    row = next((entry for entry in state["queue"] if str(entry.get("id") or "") == str(row_id)), None)
    hook_url = _debug_hook_url()
    result: dict[str, Any]
    if hook_url:
        import httpx

        payload = {
            "project_id": project_path.name,
            "project_label": state.get("project_label") or project_path.name,
            "row": {
                "id": row_id,
                "label": label or (row or {}).get("label") or row_id,
                "detail": detail or (row or {}).get("detail") or "",
                "status": (row or {}).get("status") or "waiting",
            },
        }
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                resp = await client.post(hook_url, json=payload)
            resp.raise_for_status()
            try:
                body = resp.json() if resp.content else {}
            except ValueError:
                body = {}
            status = str(body.get("status") or "waiting").strip().lower()
            if status not in VALID_QUEUE_STATUSES:
                status = "waiting"
            result = {
                "sent": True,
                "transport": "hook",
                "status": status,
                "message": str(body.get("message") or "Sent to the connected debug harness."),
                "received_at": _now_iso(),
            }
        except Exception as exc:
            result = {
                "sent": False,
                "transport": "hook",
                "status": "waiting",
                "message": f"Could not reach the connected debug harness: {exc}",
                "received_at": _now_iso(),
            }
    else:
        result = {
            "sent": False,
            "transport": "local",
            "status": "waiting",
            "message": "No live debug harness is connected, so this row was saved for the next run.",
            "received_at": _now_iso(),
        }

    if row is not None:
        row["status"] = result["status"]
        row["last_debug_at"] = result["received_at"]
        row["last_debug_message"] = result["message"]
    state["debug"] = {
        "hook_available": bool(hook_url),
        "last_result": result,
    }
    _save_state(project_path, state)
    return result
