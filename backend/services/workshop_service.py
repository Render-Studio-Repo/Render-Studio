"""Workshop state helpers backed by project.json metadata."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.services import project_store, workshop_training_capture_service

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
    normalized["training_capture"] = workshop_training_capture_service.get_state(project_path)
    return normalized


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
