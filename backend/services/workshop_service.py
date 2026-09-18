"""Workshop state helpers backed by project.json metadata."""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import settings
from backend.services import project_store

META_KEY = "workshop"
DEBUG_HOOK_ENV_KEYS = (
    "RENDER_STUDIO_WORKSHOP_DEBUG_URL",
    "RENDER_WORKSHOP_DEBUG_URL",
    "WORKSHOP_DEBUG_HOOK_URL",
)
CAPTURE_ROOT_ENV_KEYS = (
    "RENDER_STUDIO_SANDBOX_SESSIONS_DIR",
    "SANDBOX_SESSIONS_DIR",
    "RENDER_STUDIO_WORKSHOP_CAPTURE_ROOT",
)
SPOTIFY_ENV_KEYS = (
    "RENDER_STUDIO_SPOTIFY_ACCESS_TOKEN",
    "RENDER_STUDIO_SPOTIFY_REFRESH_TOKEN",
    "RENDER_STUDIO_SPOTIFY_DEVICE_ID",
    "SPOTIFY_ACCESS_TOKEN",
    "SPOTIFY_REFRESH_TOKEN",
)
CAPTURE_SCOPE_LABELS = {
    "office": "Office desk",
    "features": "Feature wall",
}
DJ_TRACK_LIBRARY = (
    {"title": "Desk check groove", "artist": "Workshop placeholder"},
    {"title": "Feature wall pulse", "artist": "Workshop placeholder"},
    {"title": "Late print loop", "artist": "Workshop placeholder"},
)
CAPTURE_LANE_DIR = "film-captures"
VALID_QUEUE_STATUSES = {"pass", "fail", "waiting"}
_SAFE_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _debug_hook_url() -> str:
    for key in DEBUG_HOOK_ENV_KEYS:
        value = str(os.getenv(key) or "").strip()
        if value:
            return value
    return ""


def _spotify_connected() -> bool:
    return any(str(os.getenv(key) or "").strip() for key in SPOTIFY_ENV_KEYS)


def _capture_root() -> Path | None:
    candidates: list[Path] = []
    for key in CAPTURE_ROOT_ENV_KEYS:
        value = str(os.getenv(key) or "").strip()
        if value:
            candidates.append(Path(value).expanduser())
    candidates.append(Path(settings.data_dir) / "sandbox-sessions")
    for candidate in candidates:
        try:
            candidate.mkdir(parents=True, exist_ok=True)
        except OSError:
            continue
        return candidate
    return None


def _safe_slug(value: str) -> str:
    text = _SAFE_SLUG_RE.sub("-", str(value or "").strip().lower()).strip("-")
    return text[:80] or "project"


def _capture_lane_root() -> Path | None:
    root = _capture_root()
    if root is None:
        return None
    lane_root = root / CAPTURE_LANE_DIR
    lane_root.mkdir(parents=True, exist_ok=True)
    return lane_root


def _display_path(path: Path | None) -> str:
    if path is None:
        return ""
    try:
        return str(path.resolve().relative_to(Path(settings.data_dir).resolve()))
    except Exception:
        return str(path)


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def _seed_capture_state(project_path: Path, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    del meta
    lane_root = _capture_lane_root()
    supported = lane_root is not None
    return {
        "supported": supported,
        "transport": "stub",
        "active": False,
        "scope": "office",
        "scope_label": CAPTURE_SCOPE_LABELS["office"],
        "allowed_scopes": [{"id": key, "label": label} for key, label in CAPTURE_SCOPE_LABELS.items()],
        "disallowed_scopes": [
            {
                "id": "warehouse",
                "label": "Warehouse floor",
                "reason": "Film capture is limited to office and feature spaces.",
            }
        ],
        "lane_label": "Film capture",
        "lane_path": _display_path(lane_root),
        "note": (
            "Start a simple stub capture for the office desk or feature wall. Warehouse capture stays off."
            if supported
            else "Film capture is not supported in this environment."
        ),
        "session_id": "",
        "session_dir": "",
        "started_at": None,
        "stopped_at": None,
        "receipt_path": "",
        "clip_stub_path": "",
        "latest_path": "",
        "last_receipt": None,
    }


def _seed_dj_state() -> dict[str, Any]:
    track = DJ_TRACK_LIBRARY[0]
    spotify_connected = _spotify_connected()
    return {
        "supported": True,
        "provider": "spotify-detected" if spotify_connected else "stub",
        "provider_label": "Spotify hook detected" if spotify_connected else "Stub deck",
        "connected": spotify_connected,
        "playing": False,
        "track_index": 0,
        "track_title": track["title"],
        "track_artist": track["artist"],
        "surface_label": "Monitor rack",
        "note": (
            "Spotify credentials are present, but this Workshop lane still uses safe stub controls."
            if spotify_connected
            else "Spotify is not connected here, so the monitor rack stays on labeled stub controls."
        ),
        "last_action_at": None,
    }


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


def _normalize_capture_state(value: Any, project_path: Path, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    seed = _seed_capture_state(project_path, meta)
    data = value if isinstance(value, dict) else {}
    scope = str(data.get("scope") or seed["scope"]).strip().lower()
    if scope not in CAPTURE_SCOPE_LABELS:
        scope = seed["scope"]
    last_receipt = data.get("last_receipt") if isinstance(data.get("last_receipt"), dict) else None
    return {
        **seed,
        "active": bool(data.get("active")) and bool(seed["supported"]),
        "scope": scope,
        "scope_label": CAPTURE_SCOPE_LABELS[scope],
        "session_id": str(data.get("session_id") or "")[:160],
        "session_dir": str(data.get("session_dir") or ""),
        "started_at": data.get("started_at"),
        "stopped_at": data.get("stopped_at"),
        "receipt_path": str(data.get("receipt_path") or ""),
        "clip_stub_path": str(data.get("clip_stub_path") or ""),
        "latest_path": str(data.get("latest_path") or ""),
        "last_receipt": dict(last_receipt) if last_receipt else None,
    }


def _normalize_dj_state(value: Any) -> dict[str, Any]:
    seed = _seed_dj_state()
    data = value if isinstance(value, dict) else {}
    try:
        track_index = int(data.get("track_index") or 0)
    except Exception:
        track_index = 0
    track_index %= len(DJ_TRACK_LIBRARY)
    track = DJ_TRACK_LIBRARY[track_index]
    return {
        **seed,
        "playing": bool(data.get("playing")),
        "track_index": track_index,
        "track_title": str(data.get("track_title") or track["title"]),
        "track_artist": str(data.get("track_artist") or track["artist"]),
        "last_action_at": data.get("last_action_at"),
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
        "capture": _normalize_capture_state(data.get("capture"), project_path, meta),
        "dj": _normalize_dj_state(data.get("dj")),
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


def start_capture(project_path: Path, scope: str) -> dict[str, Any]:
    lane_root = _capture_lane_root()
    if lane_root is None:
        raise RuntimeError("Film capture is not supported in this environment.")
    capture_scope = str(scope or "").strip().lower()
    if capture_scope not in CAPTURE_SCOPE_LABELS:
        raise ValueError("Film capture is only available for office desk or feature wall.")

    state = get_state(project_path)
    capture = state["capture"]
    if capture.get("active"):
        return capture

    started_at = _now_iso()
    session_id = f"{_safe_slug(project_path.name)}-{capture_scope}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    session_dir = lane_root / session_id
    session_payload = {
        "kind": "workshop-film-capture-session",
        "project_id": project_path.name,
        "project_label": state.get("project_label") or project_path.name,
        "scope": capture_scope,
        "scope_label": CAPTURE_SCOPE_LABELS[capture_scope],
        "status": "recording",
        "transport": "stub",
        "started_at": started_at,
        "note": "Stub session armed for Workshop film capture.",
    }
    _write_json(session_dir / "session.json", session_payload)
    latest_path = lane_root / "latest.json"
    _write_json(
        latest_path,
        {
            "kind": "workshop-film-capture-latest",
            "status": "recording",
            "session_id": session_id,
            "scope": capture_scope,
            "scope_label": CAPTURE_SCOPE_LABELS[capture_scope],
            "project_id": project_path.name,
            "updated_at": started_at,
            "session_path": _display_path(session_dir / "session.json"),
        },
    )

    state["capture"] = {
        **capture,
        "supported": True,
        "active": True,
        "scope": capture_scope,
        "scope_label": CAPTURE_SCOPE_LABELS[capture_scope],
        "session_id": session_id,
        "session_dir": _display_path(session_dir),
        "started_at": started_at,
        "stopped_at": None,
        "receipt_path": "",
        "clip_stub_path": "",
        "latest_path": _display_path(latest_path),
    }
    _save_state(project_path, state)
    return state["capture"]


def stop_capture(project_path: Path) -> dict[str, Any]:
    lane_root = _capture_lane_root()
    if lane_root is None:
        raise RuntimeError("Film capture is not supported in this environment.")

    state = get_state(project_path)
    capture = state["capture"]
    if not capture.get("active"):
        raise ValueError("No Workshop film capture session is active.")

    session_id = str(capture.get("session_id") or "").strip()
    capture_scope = str(capture.get("scope") or "office").strip().lower()
    if capture_scope not in CAPTURE_SCOPE_LABELS:
        capture_scope = "office"
    session_dir = lane_root / session_id
    stopped_at = _now_iso()
    clip_stub_path = session_dir / "clip-001.stub.json"
    receipt_path = session_dir / "receipt.json"
    clip_stub = {
        "kind": "workshop-film-capture-clip-stub",
        "clip_id": "clip-001",
        "label": f"{CAPTURE_SCOPE_LABELS[capture_scope]} take 1",
        "project_id": project_path.name,
        "scope": capture_scope,
        "scope_label": CAPTURE_SCOPE_LABELS[capture_scope],
        "status": "ready",
        "captured_at": stopped_at,
        "transport": "stub",
        "note": "Stub clip written for the next sandbox wake-up step.",
    }
    receipt = {
        "kind": "workshop-film-capture-receipt",
        "project_id": project_path.name,
        "project_label": state.get("project_label") or project_path.name,
        "scope": capture_scope,
        "scope_label": CAPTURE_SCOPE_LABELS[capture_scope],
        "status": "stopped",
        "transport": "stub",
        "session_id": session_id,
        "session_dir": _display_path(session_dir),
        "started_at": capture.get("started_at"),
        "stopped_at": stopped_at,
        "clip_stub": {
            "id": clip_stub["clip_id"],
            "label": clip_stub["label"],
            "path": _display_path(clip_stub_path),
        },
        "note": "Workshop film capture stopped and stub receipt saved.",
    }
    _write_json(clip_stub_path, clip_stub)
    _write_json(receipt_path, receipt)
    latest_path = lane_root / "latest.json"
    _write_json(
        latest_path,
        {
            "kind": "workshop-film-capture-latest",
            "status": "stopped",
            "session_id": session_id,
            "scope": capture_scope,
            "scope_label": CAPTURE_SCOPE_LABELS[capture_scope],
            "project_id": project_path.name,
            "updated_at": stopped_at,
            "receipt_path": _display_path(receipt_path),
        },
    )

    state["capture"] = {
        **capture,
        "supported": True,
        "active": False,
        "scope": capture_scope,
        "scope_label": CAPTURE_SCOPE_LABELS[capture_scope],
        "session_dir": _display_path(session_dir),
        "stopped_at": stopped_at,
        "receipt_path": _display_path(receipt_path),
        "clip_stub_path": _display_path(clip_stub_path),
        "latest_path": _display_path(latest_path),
        "last_receipt": receipt,
    }
    _save_state(project_path, state)
    return state["capture"]


def dj_action(project_path: Path, action: str) -> dict[str, Any]:
    action_name = str(action or "").strip().lower()
    if action_name not in {"play", "pause", "next"}:
        raise ValueError("Unknown DJ action.")

    state = get_state(project_path)
    dj = state["dj"]
    track_index = int(dj.get("track_index") or 0) % len(DJ_TRACK_LIBRARY)
    if action_name == "play":
        dj["playing"] = True
    elif action_name == "pause":
        dj["playing"] = False
    elif action_name == "next":
        track_index = (track_index + 1) % len(DJ_TRACK_LIBRARY)
    track = DJ_TRACK_LIBRARY[track_index]
    dj["track_index"] = track_index
    dj["track_title"] = track["title"]
    dj["track_artist"] = track["artist"]
    dj["last_action_at"] = _now_iso()
    state["dj"] = dj
    _save_state(project_path, state)
    return dj


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
