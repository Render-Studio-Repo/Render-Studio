"""Sandbox-backed Workshop conference room session and checkpoint helpers."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.services import project_store

STATE_META_KEY = "workshop_conference"
REPO_ROOT = Path(__file__).resolve().parents[2]
SANDBOX_ROOT = REPO_ROOT / "sandbox-sessions"
CONFERENCE_ROOT = SANDBOX_ROOT / "workshop-conference"
CONFERENCE_KB_ROOT = SANDBOX_ROOT / "Winstead-Fleet-KB" / "conference-room"
VALID_ATTENDEES = (
    "projects-manager",
    "code-bot",
    "cad",
    "harness",
    "rnd",
)
ATTENDEE_LABELS = {
    "projects-manager": "Projects Manager",
    "code-bot": "Code Bot",
    "cad": "CAD",
    "harness": "Harness",
    "rnd": "RnD",
}
SAFE_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None = None) -> str:
    return (value or _now()).isoformat()


def _slugify(value: str, *, fallback: str, max_length: int = 64) -> str:
    slug = SAFE_SLUG_RE.sub("-", str(value or "").strip().lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)
    slug = slug[:max_length].strip("-")
    return slug or fallback


def _project_label(project_path: Path, meta: dict[str, Any] | None = None) -> str:
    meta = meta if meta is not None else project_store.load_meta(project_path)
    return str(meta.get("name") or project_path.name).strip() or project_path.name


def _relative(path: Path | None) -> str | None:
    if path is None:
        return None
    try:
        return path.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def _ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def _write_json(path: Path, payload: Any) -> None:
    _ensure_dir(path.parent)
    path.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")


def _read_json(path: Path, fallback: Any) -> Any:
    if not path.is_file():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback


def _read_text(path: Path, fallback: str = "") -> str:
    if not path.is_file():
        return fallback
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return fallback


def _write_markdown(path: Path, lines: list[str]) -> None:
    _ensure_dir(path.parent)
    path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def _string(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def _bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    return bool(value)


def _clamp_int(value: Any, *, default: int, min_value: int, max_value: int) -> int:
    try:
        number = int(value)
    except Exception:
        return default
    return max(min_value, min(max_value, number))


def _who_payload(user: dict[str, Any] | None) -> dict[str, Any]:
    user = user or {}
    return {
        "user_id": _string(user.get("id")) or None,
        "display_name": _string(user.get("display_name")) or None,
        "email": _string(user.get("email")) or None,
    }


def _dedupe_attendees(values: Any) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in values if isinstance(values, list) else []:
        attendee_id = _string(raw).lower()
        if attendee_id not in VALID_ATTENDEES or attendee_id in seen:
            continue
        seen.add(attendee_id)
        out.append(attendee_id)
    return out


def _default_plugin_modules() -> dict[str, Any]:
    return {
        "tv_feed": {
            "enabled": True,
            "label": "TV feed stub",
            "stub": True,
            "source_note": "No live TV feed is wired yet; this room reserves the surface.",
        },
        "lighting": {
            "enabled": True,
            "label": "Lighting presets stub",
            "stub": True,
            "preset": "review",
            "preset_options": ["review", "standup", "focus"],
        },
        "timers": {
            "enabled": True,
            "label": "Conference timers",
            "stub": False,
            "duration_seconds": 900,
            "remaining_seconds": 900,
            "running": False,
            "started_at": None,
        },
        "shift_skills": {
            "enabled": True,
            "label": "Static shift + skills roster",
            "stub": False,
            "roster_source": "static",
        },
        "notes": {
            "enabled": True,
            "label": "Sandbox notes markdown",
            "stub": False,
            "notes_path": None,
            "kb_entry_path": None,
        },
        "free_reign": {
            "enabled": True,
            "label": "Sandbox checkpoint stub",
            "stub": True,
            "last_checkpoint_path": None,
        },
    }


def _normalize_plugin_modules(value: Any) -> dict[str, Any]:
    seed = _default_plugin_modules()
    data = value if isinstance(value, dict) else {}
    out = json.loads(json.dumps(seed))
    out["tv_feed"]["enabled"] = _bool((data.get("tv_feed") or {}).get("enabled"), True)
    out["lighting"]["enabled"] = _bool((data.get("lighting") or {}).get("enabled"), True)
    out["lighting"]["preset"] = _string((data.get("lighting") or {}).get("preset"), "review").lower()
    if out["lighting"]["preset"] not in {"review", "standup", "focus"}:
        out["lighting"]["preset"] = "review"
    timer_data = data.get("timers") if isinstance(data.get("timers"), dict) else {}
    out["timers"]["enabled"] = _bool(timer_data.get("enabled"), True)
    out["timers"]["duration_seconds"] = _clamp_int(
        timer_data.get("duration_seconds"),
        default=900,
        min_value=5,
        max_value=86_400,
    )
    out["timers"]["remaining_seconds"] = _clamp_int(
        timer_data.get("remaining_seconds"),
        default=out["timers"]["duration_seconds"],
        min_value=0,
        max_value=86_400,
    )
    running = _bool(timer_data.get("running"), False)
    started_at = _string(timer_data.get("started_at")) or None
    out["timers"]["running"] = bool(running and started_at)
    out["timers"]["started_at"] = started_at if out["timers"]["running"] else None
    out["shift_skills"]["enabled"] = _bool((data.get("shift_skills") or {}).get("enabled"), True)
    out["notes"]["enabled"] = _bool((data.get("notes") or {}).get("enabled"), True)
    out["notes"]["notes_path"] = _string((data.get("notes") or {}).get("notes_path")) or None
    out["notes"]["kb_entry_path"] = _string((data.get("notes") or {}).get("kb_entry_path")) or None
    out["free_reign"]["enabled"] = _bool((data.get("free_reign") or {}).get("enabled"), True)
    out["free_reign"]["last_checkpoint_path"] = _string((data.get("free_reign") or {}).get("last_checkpoint_path")) or None
    return out


def _seed_state(project_path: Path, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    project_label = _project_label(project_path, meta)
    return {
        "room_id": "conference-room-v1",
        "room_label": "Workshop conference room",
        "active_project_id": project_path.name,
        "project_label": project_label,
        "active_session_id": None,
        "topic": "",
        "attendees": [],
        "notes_markdown": "",
        "session_json_path": None,
        "latest_session_path": None,
        "notes_path": None,
        "kb_entry_path": None,
        "updated_at": None,
        "plugin_modules": _default_plugin_modules(),
    }


def _normalize_state(value: Any, project_path: Path, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    seed = _seed_state(project_path, meta)
    data = value if isinstance(value, dict) else {}
    plugin_modules = _normalize_plugin_modules(data.get("plugin_modules"))
    notes_path = _string(data.get("notes_path")) or None
    kb_entry_path = _string(data.get("kb_entry_path")) or None
    plugin_modules["notes"]["notes_path"] = notes_path
    plugin_modules["notes"]["kb_entry_path"] = kb_entry_path
    plugin_modules["free_reign"]["last_checkpoint_path"] = (
        _string(data.get("plugin_modules", {}).get("free_reign", {}).get("last_checkpoint_path"))
        or plugin_modules["free_reign"]["last_checkpoint_path"]
    )
    notes_markdown = ""
    if notes_path:
        notes_markdown = _read_text(REPO_ROOT / notes_path).strip()
    return {
        "room_id": _string(data.get("room_id"), seed["room_id"]),
        "room_label": _string(data.get("room_label"), seed["room_label"]),
        "active_project_id": _string(data.get("active_project_id"), project_path.name),
        "project_label": _string(data.get("project_label"), seed["project_label"]),
        "active_session_id": _string(data.get("active_session_id")) or None,
        "topic": _string(data.get("topic")),
        "attendees": _dedupe_attendees(data.get("attendees")),
        "notes_markdown": notes_markdown,
        "session_json_path": _string(data.get("session_json_path")) or None,
        "latest_session_path": _string(data.get("latest_session_path")) or None,
        "notes_path": notes_path,
        "kb_entry_path": kb_entry_path,
        "updated_at": _string(data.get("updated_at")) or None,
        "plugin_modules": plugin_modules,
    }


def _save_state(project_path: Path, state: dict[str, Any], *, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    meta = meta if meta is not None else project_store.load_meta(project_path)
    meta[STATE_META_KEY] = state
    project_store.save_meta(project_path, meta)
    project_store.touch_project(project_path)
    return state


def _session_paths(project_id: str, session_id: str) -> tuple[Path, Path, Path, Path]:
    session_dir = CONFERENCE_ROOT / project_id / "sessions" / session_id
    session_path = session_dir / "session.json"
    notes_path = session_dir / "notes.md"
    latest_path = CONFERENCE_ROOT / project_id / "latest.json"
    kb_entry_path = CONFERENCE_KB_ROOT / project_id / f"{session_id}.md"
    return session_dir, session_path, notes_path, latest_path, kb_entry_path


def _session_payload(
    *,
    session_id: str,
    project_path: Path,
    project_label: str,
    topic: str,
    attendees: list[str],
    plugin_modules: dict[str, Any],
    notes_path: str | None,
    kb_entry_path: str | None,
    updated_at: str,
    who: dict[str, Any],
) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "active_project_id": project_path.name,
        "project_label": project_label,
        "topic": topic,
        "attendees": attendees,
        "attendee_labels": [ATTENDEE_LABELS.get(attendee_id, attendee_id) for attendee_id in attendees],
        "plugin_modules": plugin_modules,
        "notes_path": notes_path,
        "kb_entry_path": kb_entry_path,
        "updated_at": updated_at,
        "who": who,
    }


def _write_kb_entry(
    *,
    path: Path,
    project_label: str,
    topic: str,
    attendees: list[str],
    updated_at: str,
    notes_markdown: str,
) -> None:
    attendee_labels = [ATTENDEE_LABELS.get(attendee_id, attendee_id) for attendee_id in attendees]
    lines = [
        f"# {project_label} conference room",
        "",
        f"- Topic: {topic or 'Untitled conference session'}",
        f"- Attendees: {', '.join(attendee_labels) if attendee_labels else 'none selected'}",
        f"- Updated: {updated_at}",
        "",
        "## Notes",
        "",
        notes_markdown.strip() or "_No notes saved yet._",
    ]
    _write_markdown(path, lines)


def get_state(project_path: Path) -> dict[str, Any]:
    meta = project_store.load_meta(project_path)
    normalized = _normalize_state(meta.get(STATE_META_KEY), project_path, meta)
    if meta.get(STATE_META_KEY) != normalized:
        _save_state(project_path, normalized, meta=meta)
    return normalized


def update_session(
    project_path: Path,
    *,
    topic: str,
    attendees: list[str],
    notes_markdown: str,
    plugin_modules: dict[str, Any] | None = None,
    user: dict[str, Any] | None = None,
) -> dict[str, Any]:
    meta = project_store.load_meta(project_path)
    current = _normalize_state(meta.get(STATE_META_KEY), project_path, meta)
    project_label = _project_label(project_path, meta)
    now = _now()
    updated_at = _iso(now)
    session_id = current.get("active_session_id") or (
        f"conference-{now.strftime('%Y%m%dT%H%M%SZ').lower()}-"
        f"{_slugify(project_label, fallback='project', max_length=32)}"
    )
    session_dir, session_path, notes_path, latest_path, kb_entry_path = _session_paths(project_path.name, session_id)
    normalized_plugins = _normalize_plugin_modules(plugin_modules or current.get("plugin_modules"))
    next_attendees = _dedupe_attendees(attendees)
    next_topic = _string(topic)[:200]
    next_notes = str(notes_markdown or "").strip()
    normalized_plugins["notes"]["notes_path"] = _relative(notes_path)
    normalized_plugins["notes"]["kb_entry_path"] = _relative(kb_entry_path)
    who = _who_payload(user)
    session_payload = _session_payload(
        session_id=session_id,
        project_path=project_path,
        project_label=project_label,
        topic=next_topic,
        attendees=next_attendees,
        plugin_modules=normalized_plugins,
        notes_path=_relative(notes_path),
        kb_entry_path=_relative(kb_entry_path),
        updated_at=updated_at,
        who=who,
    )
    _write_json(session_path, session_payload)
    _write_json(latest_path, session_payload)
    _write_markdown(
        notes_path,
        [
            f"# {project_label} conference notes",
            "",
            f"- Topic: {next_topic or 'Untitled conference session'}",
            f"- Attendees: {', '.join(ATTENDEE_LABELS.get(item, item) for item in next_attendees) if next_attendees else 'none selected'}",
            f"- Updated: {updated_at}",
            "",
            next_notes or "_No notes saved yet._",
        ],
    )
    _write_kb_entry(
        path=kb_entry_path,
        project_label=project_label,
        topic=next_topic,
        attendees=next_attendees,
        updated_at=updated_at,
        notes_markdown=next_notes,
    )
    next_state = {
        "room_id": current["room_id"],
        "room_label": current["room_label"],
        "active_project_id": project_path.name,
        "project_label": project_label,
        "active_session_id": session_id,
        "topic": next_topic,
        "attendees": next_attendees,
        "notes_markdown": next_notes,
        "session_json_path": _relative(session_path),
        "latest_session_path": _relative(latest_path),
        "notes_path": _relative(notes_path),
        "kb_entry_path": _relative(kb_entry_path),
        "updated_at": updated_at,
        "plugin_modules": normalized_plugins,
    }
    _save_state(project_path, next_state, meta=meta)
    return next_state


def write_checkpoint(
    project_path: Path,
    *,
    title: str,
    experiment_goal: str,
    safety_note: str,
    user: dict[str, Any] | None = None,
) -> dict[str, Any]:
    meta = project_store.load_meta(project_path)
    current = _normalize_state(meta.get(STATE_META_KEY), project_path, meta)
    if not current.get("active_session_id") or not current.get("session_json_path"):
        current = update_session(
            project_path,
            topic=current.get("topic") or "",
            attendees=list(current.get("attendees") or []),
            notes_markdown=current.get("notes_markdown") or "",
            plugin_modules=current.get("plugin_modules"),
            user=user,
        )
        meta = project_store.load_meta(project_path)
    session_path_rel = _string(current.get("session_json_path"))
    session_path = REPO_ROOT / session_path_rel
    session_dir = session_path.parent
    if not session_dir.is_dir():
        raise FileNotFoundError("Conference room session folder is missing.")
    checkpoint_title = _string(title)[:120]
    if not checkpoint_title:
        raise ValueError("Checkpoint title is required.")
    checkpoint_id = (
        f"{_now().strftime('%Y%m%dT%H%M%SZ').lower()}-"
        f"{_slugify(checkpoint_title, fallback='checkpoint', max_length=40)}"
    )
    checkpoint_path = session_dir / "checkpoints" / f"{checkpoint_id}.json"
    checkpoint_payload = {
        "kind": "workshop_conference_checkpoint",
        "stub": True,
        "checkpoint_id": checkpoint_id,
        "session_id": current["active_session_id"],
        "active_project_id": project_path.name,
        "project_label": _project_label(project_path, meta),
        "title": checkpoint_title,
        "experiment_goal": _string(experiment_goal)[:2000],
        "safety_note": _string(safety_note)[:2000],
        "created_at": _iso(),
        "who": _who_payload(user),
    }
    _write_json(checkpoint_path, checkpoint_payload)
    session_payload = _read_json(session_path, fallback={})
    if not isinstance(session_payload, dict):
        session_payload = {}
    checkpoints = session_payload.get("checkpoints") if isinstance(session_payload.get("checkpoints"), list) else []
    checkpoints = [entry for entry in checkpoints if isinstance(entry, dict) and entry.get("checkpoint_id") != checkpoint_id]
    checkpoints.insert(
        0,
        {
            "checkpoint_id": checkpoint_id,
            "title": checkpoint_title,
            "path": _relative(checkpoint_path),
            "created_at": checkpoint_payload["created_at"],
            "stub": True,
        },
    )
    session_payload["checkpoints"] = checkpoints
    free_reign = session_payload.get("plugin_modules") if isinstance(session_payload.get("plugin_modules"), dict) else {}
    if not isinstance(free_reign.get("free_reign"), dict):
        free_reign["free_reign"] = {}
    free_reign["free_reign"]["last_checkpoint_path"] = _relative(checkpoint_path)
    session_payload["plugin_modules"] = _normalize_plugin_modules(free_reign or current.get("plugin_modules"))
    _write_json(session_path, session_payload)
    latest_path_rel = _string(current.get("latest_session_path"))
    if latest_path_rel:
        _write_json(REPO_ROOT / latest_path_rel, session_payload)
    next_state = _normalize_state({**current, "plugin_modules": session_payload["plugin_modules"]}, project_path, meta)
    next_state["plugin_modules"]["free_reign"]["last_checkpoint_path"] = _relative(checkpoint_path)
    _save_state(project_path, next_state, meta=meta)
    return {
        "checkpoint_id": checkpoint_id,
        "checkpoint_path": _relative(checkpoint_path),
        "conference": next_state,
    }
