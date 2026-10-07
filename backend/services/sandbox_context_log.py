"""Append sandbox/VR context events to jsonl and optional Supabase. Token ctxlog1."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TOKEN = "ctxlog1"
ROOT = Path(__file__).resolve().parents[2]
LOCAL_LOG = ROOT / "frontend" / "sandbox" / "context-events.jsonl"
DATA_LOG = ROOT / "data" / "sandbox-context" / "events.jsonl"
TABLE = "sandbox_context_events"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(value: Any, n: int) -> str:
    return str(value or "").replace("\n", " ")[:n]


def normalize_event(body: dict[str, Any] | None = None) -> dict[str, Any]:
    src = body if isinstance(body, dict) else {}
    ctx = src.get("context") if isinstance(src.get("context"), dict) else {}
    # Never store poses, raw frames, prompt bodies, or audio.
    banned = {"pose", "poses", "frame", "frames", "audio", "prompt", "prompt_text", "transcript"}
    safe_ctx = {str(k)[:40]: str(v)[:120] for k, v in list(ctx.items())[:24] if str(k).lower() not in banned}
    return {
        "id": "ctx_" + uuid.uuid4().hex[:12],
        "token": TOKEN,
        "project_id": _clean(src.get("project_id") or "render-studio", 80),
        "session_id": _clean(src.get("session_id") or "local", 80),
        "source": _clean(src.get("source") or "sandbox-page", 40),
        "feature_id": _clean(src.get("feature_id") or src.get("feature") or "sandbox.ui.click", 80),
        "event_kind": _clean(src.get("event_kind") or src.get("kind") or "click", 40),
        "target_id": _clean(src.get("target_id") or src.get("target") or "", 80),
        "context": safe_ctx,
        "edge_summary": _clean(src.get("edge_summary") or src.get("edges") or "", 400),
        "tool_summary": _clean(src.get("tool_summary") or src.get("tools") or "", 400),
        "observed_at": _clean(src.get("observed_at") or _now(), 40),
        "reliability": "client_measurement",
    }


def _append_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, separators=(",", ":")) + "\n")


def _try_supabase(row: dict[str, Any]) -> dict[str, Any]:
    try:
        from backend.services import supabase_client as sbc

        if not sbc.configured():
            return {"ok": False, "reason": "supabase_disabled"}
        client = sbc.get_admin_client()
        if client is None:
            return {"ok": False, "reason": "no_client"}
        payload = {
            "project_id": row["project_id"],
            "session_id": row["session_id"],
            "source": row["source"],
            "feature_id": row["feature_id"],
            "event_kind": row["event_kind"],
            "target_id": row["target_id"] or None,
            "context": row["context"],
            "edge_summary": row["edge_summary"] or None,
            "tool_summary": row["tool_summary"] or None,
            "observed_at": row["observed_at"],
            "reliability": row["reliability"],
        }
        client.table(TABLE).insert(payload).execute()
        return {"ok": True, "table": TABLE}
    except Exception as exc:  # noqa: BLE001 — optional sink
        return {"ok": False, "reason": str(exc)[:160]}


def record_context_event(body: dict[str, Any] | None = None) -> dict[str, Any]:
    row = normalize_event(body)
    _append_jsonl(LOCAL_LOG, row)
    _append_jsonl(DATA_LOG, row)
    # Also mirror into XR control notes for existing readers.
    try:
        from backend.services import xr_control_live as live

        live.add_note({
            "feature": row["feature_id"][:32],
            "ok": True,
            "attempt": row["event_kind"],
            "note": f"target={row['target_id']};edges={row['edge_summary']};tools={row['tool_summary']}"[:390],
            "source": row["source"][:32],
            "agent": "sandbox",
        })
    except Exception:  # noqa: BLE001
        pass
    sb = _try_supabase(row)
    return {"ok": True, "token": TOKEN, "event": row, "supabase": sb}
