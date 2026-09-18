"""Workshop state helpers backed by project.json metadata."""

from __future__ import annotations

import copy
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.services import project_store

META_KEY = "workshop"
DEBUG_HOOK_ENV_KEYS = (
    "RENDER_STUDIO_WORKSHOP_DEBUG_URL",
    "RENDER_WORKSHOP_DEBUG_URL",
    "WORKSHOP_DEBUG_HOOK_URL",
)
AUDIO_BRIDGE_ENV_KEYS = (
    "RENDER_STUDIO_WORKSHOP_AUDIO_BRIDGE_URL",
    "RENDER_STUDIO_ASTRA_BRIDGE_URL",
    "RENDER_STUDIO_FLEET_BRIDGE_URL",
    "WORKSHOP_AUDIO_BRIDGE_URL",
)
VALID_QUEUE_STATUSES = {"pass", "fail", "waiting"}
WORKSHOP_LAYOUT_UNITS = {
    "linear": "m",
    "angle": "rad",
    "scene_unit_m": 1,
}
WORKSHOP_WAREHOUSE_M = {
    "width": 18,
    "depth": 14,
    "height": 4.8,
    "wallThickness": 0.18,
    "columnSize": 0.24,
}
WORKSHOP_PARTNER_OPTIONS = [
    {
        "id": "astra",
        "label": "Astra",
        "kind": "voice",
        "summary": "Voice partner for live see-and-hear guidance.",
    },
    {
        "id": "code-bot",
        "label": "Code Bot",
        "kind": "agent",
        "summary": "Build partner for code and editor updates.",
    },
    {
        "id": "sales",
        "label": "Sales",
        "kind": "agent",
        "summary": "Tracks recent deals, outreach, and CRM follow-up.",
    },
    {
        "id": "projects-manager",
        "label": "Projects Manager",
        "kind": "agent",
        "summary": "Tracks next steps, handoffs, and room status.",
    },
    {
        "id": "concrete-cad",
        "label": "Concrete CAD",
        "kind": "agent",
        "summary": "Checks layouts, fits, and physical clearances.",
    },
    {
        "id": "sam-seat",
        "label": "Sam / user seat",
        "kind": "human",
        "summary": "Manual workstation for the person driving the room.",
    },
]
WORKSHOP_AGENT_SEATS = [
    {
        "id": "sam-seat",
        "label": "Sam / user seat",
        "deskLabel": "Sam desk",
        "role": "human",
        "status": "Present",
    },
    {
        "id": "astra",
        "label": "Astra",
        "deskLabel": "Astra voice desk",
        "role": "voice",
        "status": "Ready",
    },
    {
        "id": "code-bot",
        "label": "Code Bot",
        "deskLabel": "Code Bot desk",
        "role": "agent",
        "status": "Ready",
    },
    {
        "id": "sales",
        "label": "Sales",
        "deskLabel": "Sales desk",
        "role": "agent",
        "status": "Ready",
    },
    {
        "id": "projects-manager",
        "label": "Projects Manager",
        "deskLabel": "Projects Manager desk",
        "role": "agent",
        "status": "Ready",
    },
    {
        "id": "concrete-cad",
        "label": "Concrete CAD",
        "deskLabel": "Concrete CAD desk",
        "role": "agent",
        "status": "Ready",
    },
    {
        "id": "open-seat-1",
        "label": "Open seat 1",
        "deskLabel": "Open seat 1",
        "role": "placeholder",
        "status": "Reserved",
    },
    {
        "id": "open-seat-2",
        "label": "Open seat 2",
        "deskLabel": "Open seat 2",
        "role": "placeholder",
        "status": "Reserved",
    },
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _configured_env_value(keys: tuple[str, ...]) -> str:
    for key in keys:
        value = str(os.getenv(key) or "").strip()
        if value:
            return value
    return ""


def _debug_hook_url() -> str:
    return _configured_env_value(DEBUG_HOOK_ENV_KEYS)


def _audio_bridge_live() -> bool:
    return bool(_configured_env_value(AUDIO_BRIDGE_ENV_KEYS))


def _project_label(project_path: Path, meta: dict[str, Any] | None = None) -> str:
    meta = meta if meta is not None else project_store.load_meta(project_path)
    return str(meta.get("name") or project_path.name).strip() or project_path.name


def _partner_option_map() -> dict[str, dict[str, Any]]:
    return {str(item["id"]): dict(item) for item in WORKSHOP_PARTNER_OPTIONS}


def _resolve_selected_partner(value: Any) -> dict[str, Any]:
    options = _partner_option_map()
    if isinstance(value, dict):
        partner_id = str(value.get("id") or "").strip()
    else:
        partner_id = str(value or "").strip()
    match = options.get(partner_id)
    if not match:
        return {"id": "", "label": "", "kind": "", "summary": ""}
    return match


def _bridge_state(selected_partner: dict[str, Any]) -> dict[str, Any]:
    live = _audio_bridge_live()
    partner_id = str(selected_partner.get("id") or "").strip()
    if not partner_id:
        return {
            "live_configured": live,
            "status": "not_connected",
            "label": "Not connected",
            "detail": "Choose a workshop partner to start the room session.",
        }
    if live:
        return {
            "live_configured": True,
            "status": "connected_live",
            "label": "Connected",
            "detail": "A live workshop audio bridge is configured for this room.",
        }
    return {
        "live_configured": False,
        "status": "connected_mock",
        "label": "Connected (mock)",
        "detail": "Live bridge credentials are missing, so Workshop is running in mock mode.",
    }


def _seed_agents() -> list[dict[str, Any]]:
    return [
        {
            "id": "sam-seat",
            "name": "Sam / user seat",
            "status": "Present",
            "tasks": [
                {"id": "sam-layout", "title": "Place desks and floor markers", "status": "active"},
            ],
        },
        {
            "id": "astra",
            "name": "Astra",
            "status": "Ready",
            "tasks": [
                {"id": "astra-voice", "title": "Listen for room edits and summarize them", "status": "ready"},
            ],
        },
        {
            "id": "code-bot",
            "name": "Code Bot",
            "status": "Ready",
            "tasks": [
                {"id": "code-bot-ide", "title": "Write notes into the collab editor", "status": "queued"},
            ],
        },
        {
            "id": "sales",
            "name": "Sales",
            "status": "Ready",
            "tasks": [
                {"id": "sales-contacts", "title": "Show recent deals and outreach follow-up", "status": "queued"},
            ],
        },
        {
            "id": "projects-manager",
            "name": "Projects Manager",
            "status": "Ready",
            "tasks": [
                {"id": "pm-queue", "title": "Track room queue and handoffs", "status": "queued"},
            ],
        },
        {
            "id": "concrete-cad",
            "name": "Concrete CAD",
            "status": "Ready",
            "tasks": [
                {"id": "cad-clearance", "title": "Review real-size clearances", "status": "queued"},
            ],
        },
    ]


def _seed_layout() -> dict[str, Any]:
    return {
        "version": 1,
        "units": dict(WORKSHOP_LAYOUT_UNITS),
        "warehouse": dict(WORKSHOP_WAREHOUSE_M),
        "objects": [],
    }


def _seed_ide() -> dict[str, Any]:
    return {
        "activeFileId": "room-notes",
        "files": [
            {
                "id": "room-notes",
                "label": "room-notes.md",
                "language": "markdown",
                "content": "# Workshop room notes\n",
            },
            {
                "id": "handoff-log",
                "label": "handoff-log.txt",
                "language": "text",
                "content": "Selected partner updates will land here.\n",
            },
        ],
    }


def _seed_state(project_path: Path, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    label = _project_label(project_path, meta)
    selected_partner = _resolve_selected_partner("")
    return {
        "project_label": label,
        "agents_source": "mock",
        "partner_options": copy.deepcopy(WORKSHOP_PARTNER_OPTIONS),
        "selected_partner": selected_partner,
        "bridge": _bridge_state(selected_partner),
        "agent_seats": copy.deepcopy(WORKSHOP_AGENT_SEATS),
        "agents": _seed_agents(),
        "projects": {
            "create": [
                {
                    "id": "create-layout",
                    "title": f"{label} workshop layout",
                    "summary": "Lay out the desks, TVs, robotics bay, and wiring bay in true-scale meters.",
                    "status": "upcoming",
                },
                {
                    "id": "create-streams",
                    "title": "Stream surfaces",
                    "summary": "Choose TV slots and connect a room partner for live updates.",
                    "status": "queued",
                },
            ],
            "train": [
                {
                    "id": "train-handoff",
                    "title": "Partner handoff",
                    "summary": "Teach the room which updates should be pushed into the collab editor.",
                    "status": "upcoming",
                },
            ],
        },
        "approvals": [
            {
                "id": "approve-voice-station",
                "title": "Voice partner station",
                "summary": "Confirm that the selected partner can watch the room and write notes.",
                "status": "pending",
            },
            {
                "id": "approve-layout-export",
                "title": "Passthrough export",
                "summary": "Confirm that the layout JSON is ready to load into a future AR pass.",
                "status": "pending",
            },
        ],
        "queue": [
            {
                "id": "queue-openarm",
                "label": "OpenArm sim bay check",
                "status": "waiting",
                "detail": "Waiting for the next robotics sim anchor review.",
            },
            {
                "id": "queue-wiring",
                "label": "Wiring bay review",
                "status": "pass",
                "detail": "Last saved wiring setup passed its room check.",
            },
            {
                "id": "queue-room-feed",
                "label": "Room feed summary",
                "status": "fail",
                "detail": "Needs a clearer note before the next handoff.",
            },
        ],
        "debug": {
            "hook_available": bool(_debug_hook_url()),
            "last_result": None,
        },
        "layout": _seed_layout(),
        "ide": _seed_ide(),
    }


def _normalize_project_entries(values: Any, fallback: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not isinstance(values, list) or not values:
        return [dict(item) for item in fallback]
    out: list[dict[str, Any]] = []
    for item in values:
        if isinstance(item, dict):
            out.append(dict(item))
    return out or [dict(item) for item in fallback]


def _normalize_layout(value: Any, fallback: dict[str, Any]) -> dict[str, Any]:
    data = value if isinstance(value, dict) else {}
    objects_in = data.get("objects")
    objects: list[dict[str, Any]] = []
    if isinstance(objects_in, list):
        for item in objects_in:
            if isinstance(item, dict):
                objects.append(copy.deepcopy(item))
    return {
        "version": 1,
        "units": dict(WORKSHOP_LAYOUT_UNITS),
        "warehouse": {**WORKSHOP_WAREHOUSE_M, **(data.get("warehouse") if isinstance(data.get("warehouse"), dict) else {})},
        "objects": objects if objects else copy.deepcopy(fallback.get("objects") or []),
    }


def _normalize_ide(value: Any, fallback: dict[str, Any]) -> dict[str, Any]:
    data = value if isinstance(value, dict) else {}
    fallback_files = list(fallback.get("files") or [])
    files_in = data.get("files")
    files: list[dict[str, Any]] = []
    if isinstance(files_in, list):
        for index, item in enumerate(files_in):
            if not isinstance(item, dict):
                continue
            files.append(
                {
                    "id": str(item.get("id") or f"file-{index + 1}"),
                    "label": str(item.get("label") or f"file-{index + 1}.txt"),
                    "language": str(item.get("language") or "text"),
                    "content": str(item.get("content") or ""),
                }
            )
    if not files:
        files = copy.deepcopy(fallback_files)
    active_file_id = str(data.get("activeFileId") or "").strip()
    if active_file_id and any(str(item.get("id")) == active_file_id for item in files):
        selected_file_id = active_file_id
    else:
        selected_file_id = str(files[0].get("id") or fallback.get("activeFileId") or "room-notes")
    return {
        "activeFileId": selected_file_id,
        "files": files,
    }


def _normalize_state(value: Any, project_path: Path, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    seed = _seed_state(project_path, meta)
    data = value if isinstance(value, dict) else {}
    projects = data.get("projects") if isinstance(data.get("projects"), dict) else {}
    debug = data.get("debug") if isinstance(data.get("debug"), dict) else {}
    selected_partner = _resolve_selected_partner(data.get("selected_partner") or data.get("selected_partner_id"))
    return {
        "project_label": str(data.get("project_label") or seed["project_label"]),
        "agents_source": "live" if data.get("agents_source") == "live" else "mock",
        "partner_options": copy.deepcopy(WORKSHOP_PARTNER_OPTIONS),
        "selected_partner": selected_partner,
        "bridge": _bridge_state(selected_partner),
        "agent_seats": copy.deepcopy(WORKSHOP_AGENT_SEATS),
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
        "layout": _normalize_layout(data.get("layout"), seed["layout"]),
        "ide": _normalize_ide(data.get("ide"), seed["ide"]),
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


def update_state(
    project_path: Path,
    *,
    selected_partner_id: str | None = None,
    layout: dict[str, Any] | None = None,
    ide: dict[str, Any] | None = None,
) -> dict[str, Any]:
    state = get_state(project_path)
    if selected_partner_id is not None:
        state["selected_partner"] = _resolve_selected_partner(selected_partner_id)
    if layout is not None:
        state["layout"] = _normalize_layout(layout, state.get("layout") or _seed_layout())
    if ide is not None:
        state["ide"] = _normalize_ide(ide, state.get("ide") or _seed_ide())
    normalized = _normalize_state(state, project_path)
    _save_state(project_path, normalized)
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
    _save_state(project_path, _normalize_state(state, project_path))
    return result
