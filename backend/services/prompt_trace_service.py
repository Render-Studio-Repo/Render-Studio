"""Prompt-trace store: Cursor chat outcomes + blame for destructive prompts."""

from __future__ import annotations

import csv
import json
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException, Request

from backend.config import settings

ROOT = Path(__file__).resolve().parents[2]
STORE = ROOT / "data" / "prompt-trace"
INDEX = STORE / "live-prompts.jsonl"
_LOCK = threading.Lock()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def api_key() -> str:
    return str(getattr(settings, "prompt_trace_api_key", "") or "").strip()


def require_agent_key(request: Request) -> None:
    import hmac

    key = api_key()
    if not key:
        raise HTTPException(503, "PROMPT_TRACE_API_KEY is not set")
    auth = str(request.headers.get("authorization") or "")
    token = auth[7:].strip() if auth.lower().startswith("bearer ") else ""
    if not token:
        token = str(request.headers.get("x-prompt-trace-key") or request.query_params.get("key") or "").strip()
    if not token or not hmac.compare_digest(token, key):
        raise HTTPException(401, "Invalid PROMPT_TRACE_API_KEY")


def _load_live() -> list[dict[str, Any]]:
    if not INDEX.is_file():
        return []
    rows = []
    for line in INDEX.read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return rows


def _append(row: dict[str, Any]) -> None:
    STORE.mkdir(parents=True, exist_ok=True)
    with INDEX.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def indexed_prompts() -> list[dict[str, Any]]:
    path = STORE / "prompts.json"
    if not path.is_file():
        return []
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def all_prompts() -> list[dict[str, Any]]:
    rows = indexed_prompts() + _load_live()
    try:
        from backend.services import cursor_transcript_index as cti

        return cti.merge_missing(rows)
    except Exception:
        return rows


def optional_user_id(body: dict[str, Any] | None) -> str:
    """Companion debug user only — never reads or writes auth `users`."""
    data = body or {}
    raw = data.get("user_id") or data.get("debug_user_id") or data.get("uid") or ""
    return re.sub(r"[^A-Za-z0-9._:-]", "", str(raw).strip())[:80]


def record(body: dict[str, Any]) -> dict[str, Any]:
    prompt = str(body.get("prompt") or body.get("excerpt") or "").strip()
    if not prompt:
        raise HTTPException(400, "prompt is required")
    last3 = body.get("last3_log_ids") or []
    if isinstance(last3, str):
        last3 = [p for p in last3.split("|") if p]
    result = str(body.get("result") or "unknown").lower()
    if result not in {"improved", "broke", "continued", "partial", "unknown"}:
        result = "unknown"
    blamed = str(body.get("blamed_log_id") or "").strip() or None
    if result == "broke" and not blamed and last3:
        blamed = str(last3[-1])
    row = {
        "log_id": str(body.get("log_id") or f"live-{uuid.uuid4().hex[:10]}"),
        "chat_id": str(body.get("chat_id") or "live"),
        "prompt_index": int(body.get("prompt_index") or 0),
        "timestamp": str(body.get("timestamp") or now_iso()),
        "project": str(body.get("project") or "render-studio"),
        "categories": body.get("categories") or [],
        "prompt": prompt[:800],
        "result": result,
        "blamed_log_id": blamed,
        "last3_log_ids": last3[-3:],
        "notes": str(body.get("notes") or ""),
        "source": "live",
    }
    uid = optional_user_id(body)
    if uid:
        row["user_id"] = uid
    with _LOCK:
        _append(row)
    result_row: dict[str, Any] = {"ok": True, "prompt": row}
    if any(key in body for key in ("score", "desired_score", "broken", "fixed", "steps", "system_check")):
        from backend.services import debugger_analytics_service as das

        payload = dict(body)
        payload.setdefault("log_id", row["log_id"])
        payload.setdefault("prompt_id", body.get("prompt_id") or row["log_id"])
        payload.setdefault("agent_id", body.get("agent_id") or "cursor")
        payload.setdefault("instance_id", body.get("instance_id") or "501")
        if uid:
            payload.setdefault("user_id", uid)
        result_row["score"] = das.record_score(payload)
    return result_row


def get_prompt(log_id: str) -> dict[str, Any]:
    for row in reversed(all_prompts()):
        if str(row.get("log_id")) == log_id:
            return {"ok": True, "prompt": row}
    raise HTTPException(404, "Unknown log_id")


def blame_chain(broken_log_id: str) -> dict[str, Any]:
    rows = {str(r.get("log_id")): r for r in all_prompts()}
    hit = rows.get(broken_log_id)
    if not hit:
        raise HTTPException(404, "Unknown log_id")
    blamed = rows.get(str(hit.get("blamed_log_id") or ""))
    last3 = [rows[i] for i in (hit.get("last3_log_ids") or []) if i in rows]
    return {"ok": True, "broken": hit, "blamed": blamed, "last3": last3}


def dashboard(project: str = "", result: str = "") -> dict[str, Any]:
    rows = all_prompts()
    if project:
        rows = [r for r in rows if r.get("project") == project]
    if result:
        rows = [r for r in rows if r.get("result") == result]
    broke = [r for r in rows if r.get("result") == "broke"]
    return {
        "ok": True,
        "count": len(rows),
        "broke": len(broke),
        "latest": list(reversed(rows[-40:])),
        "cheatsheet": str(STORE / "CHEATSHEET.md") if (STORE / "CHEATSHEET.md").is_file() else None,
        "readme": str(STORE / "README.md") if (STORE / "README.md").is_file() else None,
    }


def cheatsheet_text() -> str:
    path = STORE / "CHEATSHEET.md"
    if not path.is_file():
        return "Run python3 scripts/index-cursor-transcripts.py"
    return path.read_text(encoding="utf-8")
