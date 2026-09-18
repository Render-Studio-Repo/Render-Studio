"""Sandbox-backed Workshop training capture receipts and KB mirror writes."""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.services import project_store

STATE_META_KEY = "workshop_training_capture"
REPO_ROOT = Path(__file__).resolve().parents[2]
SANDBOX_ROOT = REPO_ROOT / "sandbox-sessions"
CAPTURES_ROOT = SANDBOX_ROOT / "training-captures"
RECEIPTS_ROOT = SANDBOX_ROOT / "receipts"
RECEIPT_EXAMPLES_ROOT = RECEIPTS_ROOT / "examples"
KB_ROOT = SANDBOX_ROOT / "Winstead-Fleet-KB"
KB_INDEX_PATH = KB_ROOT / "index" / "training-captures.json"
VALID_CAPTURE_STATUSES = {"idle", "capturing", "captured", "error"}
SAFE_SLUG_RE = re.compile(r"[^a-z0-9]+")
SAFE_RECEIPT_RE = re.compile(r"^RCPT-[A-Za-z0-9-]+$")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime | None = None) -> str:
    return (value or _now()).isoformat()


def _slugify(value: str, *, fallback: str = "training-demo", max_length: int = 64) -> str:
    slug = SAFE_SLUG_RE.sub("-", str(value or "").strip().lower()).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)
    return (slug[:max_length].strip("-") or fallback)


def _project_label(project_path: Path, meta: dict[str, Any] | None = None) -> str:
    meta = meta if meta is not None else project_store.load_meta(project_path)
    return str(meta.get("name") or project_path.name).strip() or project_path.name


def _seed_state(project_path: Path, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    label = _project_label(project_path, meta)
    return {
        "project_label": label,
        "status": "idle",
        "source_ui": "Workshop / Quest training",
        "capture_label": f"{label} wiring demo",
        "active_session_id": None,
        "active_session_dir": None,
        "started_at": None,
        "stopped_at": None,
        "last_receipt_id": None,
        "last_receipt_path": None,
        "last_media_pointer_path": None,
        "last_action_log_path": None,
        "last_kb_entry_path": None,
        "last_error": None,
    }


def _normalize_state(value: Any, project_path: Path, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    seed = _seed_state(project_path, meta)
    data = value if isinstance(value, dict) else {}
    status = str(data.get("status") or seed["status"]).strip().lower()
    if status not in VALID_CAPTURE_STATUSES:
        status = seed["status"]
    return {
        "project_label": str(data.get("project_label") or seed["project_label"]),
        "status": status,
        "source_ui": str(data.get("source_ui") or seed["source_ui"]),
        "capture_label": str(data.get("capture_label") or seed["capture_label"]),
        "active_session_id": data.get("active_session_id") or None,
        "active_session_dir": data.get("active_session_dir") or None,
        "started_at": data.get("started_at") or None,
        "stopped_at": data.get("stopped_at") or None,
        "last_receipt_id": data.get("last_receipt_id") or None,
        "last_receipt_path": data.get("last_receipt_path") or None,
        "last_media_pointer_path": data.get("last_media_pointer_path") or None,
        "last_action_log_path": data.get("last_action_log_path") or None,
        "last_kb_entry_path": data.get("last_kb_entry_path") or None,
        "last_error": data.get("last_error") or None,
    }


def _save_state(project_path: Path, state: dict[str, Any], *, meta: dict[str, Any] | None = None) -> dict[str, Any]:
    meta = meta if meta is not None else project_store.load_meta(project_path)
    meta[STATE_META_KEY] = state
    project_store.save_meta(project_path, meta)
    project_store.touch_project(project_path)
    return state


def get_state(project_path: Path) -> dict[str, Any]:
    meta = project_store.load_meta(project_path)
    normalized = _normalize_state(meta.get(STATE_META_KEY), project_path, meta)
    if meta.get(STATE_META_KEY) != normalized:
        _save_state(project_path, normalized, meta=meta)
    return normalized


def _relative(path: Path) -> str:
    try:
        return path.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return path.as_posix()


def _ensure_folder(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path


def _load_json(path: Path, *, fallback: Any) -> Any:
    if not path.is_file():
        return fallback
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return fallback
    return data


def _write_json(path: Path, payload: Any) -> None:
    _ensure_folder(path.parent)
    path.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")


def _latest_receipt_id() -> str | None:
    data = _load_json(RECEIPTS_ROOT / "latest.json", fallback={})
    if not isinstance(data, dict):
        return None
    receipt_id = str(data.get("receipt_id") or "").strip()
    return receipt_id or None


def _who_payload(user: dict[str, Any] | None) -> dict[str, Any]:
    user = user or {}
    return {
        "user_id": str(user.get("id") or "").strip() or None,
        "display_name": str(user.get("display_name") or "").strip() or None,
        "email": str(user.get("email") or "").strip() or None,
    }


def _related_fail_ids(meta: dict[str, Any] | None) -> list[str]:
    workshop = meta.get("workshop") if isinstance(meta, dict) else {}
    queue = workshop.get("queue") if isinstance(workshop, dict) else []
    out: list[str] = []
    for row in queue if isinstance(queue, list) else []:
        if not isinstance(row, dict):
            continue
        if str(row.get("status") or "").strip().lower() != "fail":
            continue
        row_id = str(row.get("id") or "").strip()
        if row_id:
            out.append(row_id)
    return out


def _receipt_shape(value: dict[str, Any]) -> dict[str, Any]:
    receipt_id = str(value.get("receipt_id") or "").strip()
    if not SAFE_RECEIPT_RE.match(receipt_id):
        raise ValueError("receipt_id must start with RCPT-.")
    return {
        "receipt_id": receipt_id,
        "log_id": str(value.get("log_id") or "").strip(),
        "pr_url": str(value.get("pr_url") or "").strip() or None,
        "pr_number": int(value["pr_number"]) if value.get("pr_number") not in {None, ""} else None,
        "color": str(value.get("color") or "unset").strip().lower(),
        "guard_note": str(value.get("guard_note") or ""),
        "mule_hop": str(value.get("mule_hop") or ""),
        "rmq": str(value.get("rmq") or ""),
        "status": str(value.get("status") or "draft").strip().lower(),
        "failure_id": str(value.get("failure_id") or "").strip() or None,
        "payload": value.get("payload") if isinstance(value.get("payload"), dict) else {},
        "created_at": str(value.get("created_at") or _iso()),
    }


def _write_receipt(receipt: dict[str, Any]) -> tuple[Path, Path]:
    shaped = _receipt_shape(receipt)
    _ensure_folder(RECEIPTS_ROOT)
    _ensure_folder(RECEIPT_EXAMPLES_ROOT)
    receipt_path = RECEIPTS_ROOT / f"{shaped['receipt_id']}.json"
    latest_path = RECEIPTS_ROOT / "latest.json"
    _write_json(receipt_path, shaped)
    _write_json(latest_path, shaped)
    return receipt_path, latest_path


def _kb_index_entry(
    *,
    receipt_id: str,
    project_id: str,
    project_label: str,
    who: dict[str, Any],
    what: str,
    started_at: str,
    stopped_at: str,
    media_pointer_path: str,
    kb_entry_path: str,
    related_fail_ids: list[str],
    related_fix_ids: list[str],
    related_receipt_ids: list[str],
) -> dict[str, Any]:
    return {
        "receipt_id": receipt_id,
        "project_id": project_id,
        "project_label": project_label,
        "who": who,
        "what": what,
        "when": stopped_at,
        "started_at": started_at,
        "stopped_at": stopped_at,
        "media_pointer_path": media_pointer_path,
        "kb_entry_path": kb_entry_path,
        "related_fail_ids": related_fail_ids,
        "related_fix_ids": related_fix_ids,
        "related_receipt_ids": related_receipt_ids,
    }


def _write_kb_entry(
    *,
    receipt_id: str,
    project_label: str,
    who: dict[str, Any],
    what: str,
    started_at: str,
    stopped_at: str,
    media_pointer_path: str,
    related_fail_ids: list[str],
    related_fix_ids: list[str],
    related_receipt_ids: list[str],
) -> Path:
    day = datetime.fromisoformat(stopped_at).astimezone(timezone.utc)
    entry_path = (
        KB_ROOT
        / "training-captures"
        / f"{day.year:04d}"
        / f"{day.month:02d}"
        / f"{day.day:02d}"
        / f"{receipt_id}.md"
    )
    lines = [
        f"# {receipt_id}",
        "",
        f"- Who: {who.get('display_name') or who.get('email') or who.get('user_id') or 'Unknown'}",
        f"- What: {what}",
        f"- When: {started_at} -> {stopped_at}",
        f"- Receipt: {receipt_id}",
        f"- Media pointer: {media_pointer_path}",
        f"- Related FAIL ids: {', '.join(related_fail_ids) if related_fail_ids else 'none'}",
        f"- Related FIX ids: {', '.join(related_fix_ids) if related_fix_ids else 'none'}",
        f"- Related RCPT ids: {', '.join(related_receipt_ids) if related_receipt_ids else 'none'}",
    ]
    _ensure_folder(entry_path.parent)
    entry_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
    return entry_path


def _update_kb_index(entry: dict[str, Any]) -> None:
    current = _load_json(KB_INDEX_PATH, fallback={"entries": []})
    rows = current.get("entries") if isinstance(current, dict) else []
    if not isinstance(rows, list):
        rows = []
    next_rows = [row for row in rows if isinstance(row, dict) and row.get("receipt_id") != entry["receipt_id"]]
    next_rows.insert(0, entry)
    next_rows.sort(key=lambda row: str(row.get("when") or ""), reverse=True)
    _write_json(KB_INDEX_PATH, {"entries": next_rows})


def _session_payload(
    *,
    session_id: str,
    project_path: Path,
    project_label: str,
    who: dict[str, Any],
    started_at: str,
) -> dict[str, Any]:
    return {
        "session_id": session_id,
        "project_id": project_path.name,
        "project_label": project_label,
        "source_ui": "Workshop / Quest training",
        "capture_kind": "wiring-demo",
        "status": "capturing",
        "started_at": started_at,
        "stopped_at": None,
        "who": who,
        "artifacts": {},
    }


def start_capture(project_path: Path, *, user: dict[str, Any] | None = None) -> dict[str, Any]:
    meta = project_store.load_meta(project_path)
    state = _normalize_state(meta.get(STATE_META_KEY), project_path, meta)
    if state["status"] == "capturing" and state.get("active_session_id"):
        raise ValueError("Training capture is already running for this project.")

    now = _now()
    project_label = _project_label(project_path, meta)
    session_slug = _slugify(f"{project_label}-wiring-demo", fallback="wiring-demo", max_length=36)
    session_stamp = now.strftime("%Y%m%dT%H%M%S%fZ").lower()
    session_id = f"train-{session_stamp}-{session_slug}"
    session_dir = CAPTURES_ROOT / now.strftime("%Y%m%d") / session_id
    session_path = session_dir / "session.json"
    who = _who_payload(user)
    _write_json(
        session_path,
        _session_payload(
            session_id=session_id,
            project_path=project_path,
            project_label=project_label,
            who=who,
            started_at=_iso(now),
        ),
    )

    next_state = {
        **state,
        "project_label": project_label,
        "status": "capturing",
        "capture_label": f"{project_label} wiring demo",
        "active_session_id": session_id,
        "active_session_dir": _relative(session_dir),
        "started_at": _iso(now),
        "stopped_at": None,
        "last_error": None,
    }
    _save_state(project_path, next_state, meta=meta)
    return next_state


def stop_capture(project_path: Path, *, user: dict[str, Any] | None = None) -> dict[str, Any]:
    meta = project_store.load_meta(project_path)
    state = _normalize_state(meta.get(STATE_META_KEY), project_path, meta)
    session_id = str(state.get("active_session_id") or "").strip()
    session_dir_rel = str(state.get("active_session_dir") or "").strip()
    if state["status"] != "capturing" or not session_id or not session_dir_rel:
        raise ValueError("No active training capture is running for this project.")

    session_dir = REPO_ROOT / session_dir_rel
    if not session_dir.is_dir():
        raise FileNotFoundError("Training capture session folder is missing.")

    started_at = str(state.get("started_at") or _iso())
    stop_dt = _now()
    stopped_at = _iso(stop_dt)
    project_label = _project_label(project_path, meta)
    who = _who_payload(user)
    previous_receipt_id = _latest_receipt_id()
    related_fail_ids = _related_fail_ids(meta)
    related_fix_ids: list[str] = []
    related_receipt_ids = [previous_receipt_id] if previous_receipt_id else []

    media_pointer_path = session_dir / "media-pointer.json"
    media_pointer = {
        "session_id": session_id,
        "kind": "placeholder_clip_path",
        "created_at": stopped_at,
        "path": f"{_relative(session_dir)}/placeholder-wiring-demo.webm",
        "exists": False,
        "note": "MVP training capture records a sandbox media pointer only. No on-headset VLA or live arm control is invoked.",
    }
    _write_json(media_pointer_path, media_pointer)

    action_log_path = session_dir / "action-controller-log.json"
    action_log = {
        "session_id": session_id,
        "project_id": project_path.name,
        "project_label": project_label,
        "source_ui": "Workshop / Quest training",
        "capture_kind": "wiring-demo",
        "started_at": started_at,
        "stopped_at": stopped_at,
        "controllers": [
            {
                "id": "workshop-ui",
                "type": "mouse-keyboard",
                "note": "Stub controller record for MVP training capture.",
            }
        ],
        "actions": [
            {
                "at": started_at,
                "action": "capture.start",
                "controller_id": "workshop-ui",
                "note": "Capture started from the Workshop Train tab.",
            },
            {
                "at": stopped_at,
                "action": "capture.stop",
                "controller_id": "workshop-ui",
                "note": "Capture stopped and sandbox receipt artifacts were emitted.",
            },
        ],
    }
    _write_json(action_log_path, action_log)

    receipt_suffix = stop_dt.strftime("%H%M%S").lower()
    receipt_id = f"RCPT-TRAIN-{stop_dt.strftime('%Y%m%d')}-{_slugify(f'{project_label}-wiring-demo-{receipt_suffix}', max_length=56)}"
    what = "Workshop wiring demo training capture"
    receipt = {
        "receipt_id": receipt_id,
        "log_id": session_id,
        "pr_url": None,
        "pr_number": None,
        "color": "yellow",
        "guard_note": "Sandbox training capture saved. Wake PM/harness with the receipt id once a follow-up PR or review loop needs to consume it.",
        "mule_hop": f"render-studio://workshop/training-capture/{session_id}",
        "rmq": "rmq-1789710085",
        "status": "captured",
        "failure_id": None,
        "payload": {
            "kind": "training_capture",
            "source_ui": "Workshop / Quest training",
            "who": who,
            "what": what,
            "when": {
                "started_at": started_at,
                "stopped_at": stopped_at,
            },
            "project": {
                "id": project_path.name,
                "label": project_label,
            },
            "media_pointer_path": _relative(media_pointer_path),
            "action_controller_log_path": _relative(action_log_path),
            "related_fail_ids": related_fail_ids,
            "related_fix_ids": related_fix_ids,
            "related_receipt_ids": related_receipt_ids,
        },
        "created_at": stopped_at,
    }
    receipt_path, latest_path = _write_receipt(receipt)

    kb_entry_path = _write_kb_entry(
        receipt_id=receipt_id,
        project_label=project_label,
        who=who,
        what=what,
        started_at=started_at,
        stopped_at=stopped_at,
        media_pointer_path=_relative(media_pointer_path),
        related_fail_ids=related_fail_ids,
        related_fix_ids=related_fix_ids,
        related_receipt_ids=related_receipt_ids,
    )
    index_entry = _kb_index_entry(
        receipt_id=receipt_id,
        project_id=project_path.name,
        project_label=project_label,
        who=who,
        what=what,
        started_at=started_at,
        stopped_at=stopped_at,
        media_pointer_path=_relative(media_pointer_path),
        kb_entry_path=_relative(kb_entry_path),
        related_fail_ids=related_fail_ids,
        related_fix_ids=related_fix_ids,
        related_receipt_ids=related_receipt_ids,
    )
    _update_kb_index(index_entry)

    session_payload = _load_json(session_dir / "session.json", fallback={})
    if not isinstance(session_payload, dict):
        session_payload = {}
    session_payload.update(
        {
            "status": "captured",
            "stopped_at": stopped_at,
            "receipt_id": receipt_id,
            "artifacts": {
                "media_pointer_path": _relative(media_pointer_path),
                "action_controller_log_path": _relative(action_log_path),
                "receipt_path": _relative(receipt_path),
                "latest_receipt_path": _relative(latest_path),
                "kb_entry_path": _relative(kb_entry_path),
                "kb_index_path": _relative(KB_INDEX_PATH),
            },
        }
    )
    _write_json(session_dir / "session.json", session_payload)

    next_state = {
        **state,
        "project_label": project_label,
        "status": "captured",
        "active_session_id": None,
        "active_session_dir": None,
        "stopped_at": stopped_at,
        "last_receipt_id": receipt_id,
        "last_receipt_path": _relative(receipt_path),
        "last_media_pointer_path": _relative(media_pointer_path),
        "last_action_log_path": _relative(action_log_path),
        "last_kb_entry_path": _relative(kb_entry_path),
        "last_error": None,
    }
    _save_state(project_path, next_state, meta=meta)
    return {
        "receipt_id": receipt_id,
        "receipt_path": _relative(receipt_path),
        "latest_receipt_path": _relative(latest_path),
        "media_pointer_path": _relative(media_pointer_path),
        "action_controller_log_path": _relative(action_log_path),
        "kb_entry_path": _relative(kb_entry_path),
        "kb_index_path": _relative(KB_INDEX_PATH),
        "related_fail_ids": related_fail_ids,
        "related_fix_ids": related_fix_ids,
        "related_receipt_ids": related_receipt_ids,
    }
