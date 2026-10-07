"""Persist sandbox remix blueprints + merge health. Token remix1."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TOKEN = "remix1"
ROOT = Path(__file__).resolve().parents[2]
LOCAL_LOG = ROOT / "frontend" / "sandbox" / "remix-blueprints.jsonl"
DATA_LOG = ROOT / "data" / "sandbox-remix" / "blueprints.jsonl"
TABLE = "sandbox_remix_blueprints"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(value: Any, n: int) -> str:
    return str(value or "").replace("\n", " ")[:n]


def normalize_blueprint(body: dict[str, Any] | None = None) -> dict[str, Any]:
    src = body if isinstance(body, dict) else {}
    bp = src.get("blueprint") if isinstance(src.get("blueprint"), dict) else src
    health = bp.get("health") if isinstance(bp.get("health"), dict) else src.get("health")
    if not isinstance(health, dict):
        health = {}
    return {
        "id": "bp_" + uuid.uuid4().hex[:12],
        "token": TOKEN,
        "kind": _clean(src.get("kind") or bp.get("kind") or "blueprint", 40),
        "remix_id": _clean(bp.get("remix_id") or src.get("remix_id") or "", 80) or None,
        "session_id": _clean(bp.get("session_id") or src.get("session_id") or "local", 80),
        "source_project_id": _clean(bp.get("source_project_id") or src.get("source_project_id") or "", 80) or None,
        "safe_to_merge": bool(bp.get("safe_to_merge") if "safe_to_merge" in bp else src.get("safe_to_merge")),
        "restore_guide": bp.get("restore_guide") if isinstance(bp.get("restore_guide"), dict) else {},
        "health": {str(k)[:40]: str(v)[:160] for k, v in list(health.items())[:32] if k != "probes"},
        "probes": health.get("probes") if isinstance(health.get("probes"), list) else [],
        "repeat_steps": bp.get("repeat_steps") if isinstance(bp.get("repeat_steps"), list) else [],
        "observed_at": _clean(bp.get("created_at") or src.get("observed_at") or _now(), 40),
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
            "remix_id": row["remix_id"],
            "session_id": row["session_id"],
            "source_project_id": row["source_project_id"],
            "kind": row["kind"],
            "safe_to_merge": row["safe_to_merge"],
            "restore_guide": row["restore_guide"],
            "health": row["health"],
            "probes": row["probes"],
            "repeat_steps": row["repeat_steps"],
            "observed_at": row["observed_at"],
            "reliability": row["reliability"],
        }
        client.table(TABLE).insert(payload).execute()
        return {"ok": True, "table": TABLE}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "reason": str(exc)[:160]}


def record_blueprint(body: dict[str, Any] | None = None) -> dict[str, Any]:
    row = normalize_blueprint(body)
    _append_jsonl(LOCAL_LOG, row)
    _append_jsonl(DATA_LOG, row)
    sb = _try_supabase(row)
    return {"ok": True, "token": TOKEN, "blueprint": row, "supabase": sb}
