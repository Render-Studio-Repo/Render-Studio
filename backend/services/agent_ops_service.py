"""Prompt operation sets: taxonomy category, traceback order, similarity, damage.

Does not invent a second bug-id family. category_id is FEAT/NET/DATA/PERF/UI/VR/GL/API/WD/CAD/CTL/OTH.
instance_public_factor is 0 until other developer instances are public.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path
from typing import Any

from backend.database import get_conn
from backend.services import debugger_analytics_service as das

CATEGORIES = ("FEAT", "NET", "DATA", "PERF", "UI", "VR", "GL", "API", "WD", "CAD", "CTL", "OTH")
SCHEMA = "rs.ops.v1"
DB_HINT = Path(__file__).resolve().parents[2] / "data" / "agent-ops.sqlite"


def _now() -> str:
    return das.now()


def ensure_schema() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS agent_ops_runs (
                prompt_id TEXT PRIMARY KEY,
                ts TEXT NOT NULL,
                category_id TEXT NOT NULL,
                cycle_id TEXT,
                agent TEXT,
                ops_json TEXT NOT NULL,
                traceback_json TEXT NOT NULL,
                result_score INTEGER NOT NULL,
                result_ref_id TEXT,
                ops_similarity REAL NOT NULL,
                damage_score REAL NOT NULL,
                instance_id TEXT NOT NULL,
                instance_public_factor REAL NOT NULL,
                log_id TEXT,
                project_id TEXT
            )
            """
        )


def _ops_list(raw: Any) -> list[str]:
    if isinstance(raw, str):
        parts = [p.strip() for p in raw.replace(",", " ").split() if p.strip()]
        return parts[:24]
    if isinstance(raw, list):
        return [str(x).strip()[:48] for x in raw if str(x).strip()][:24]
    return []


def _tb_list(raw: Any, ops: list[str]) -> list[str]:
    ids = []
    if isinstance(raw, list):
        ids = [str(x).strip()[:64] for x in raw if str(x).strip()][:24]
    if ids:
        return ids
    return [f"tb_{i}_{op[:20]}" for i, op in enumerate(ops)]


def _jaccard(a: list[str], b: list[str]) -> float:
    sa, sb = set(a), set(b)
    if not sa and not sb:
        return 1.0
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def _lcs_ratio(a: list[str], b: list[str]) -> float:
    if not a and not b:
        return 1.0
    if not a or not b:
        return 0.0
    n, m = len(a), len(b)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if a[i - 1] == b[j - 1]:
                dp[i][j] = dp[i - 1][j - 1] + 1
            else:
                dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])
    return dp[n][m] / max(n, m)


def _similarity_to_category(conn: sqlite3.Connection, category_id: str, ops: list[str], skip_id: str) -> float:
    rows = conn.execute(
        "SELECT prompt_id, ops_json FROM agent_ops_runs WHERE category_id = ? AND prompt_id != ?",
        (category_id, skip_id),
    ).fetchall()
    if not rows:
        return 1.0
    scores = []
    for row in rows:
        try:
            other = json.loads(row["ops_json"] or "[]")
        except json.JSONDecodeError:
            other = []
        if not isinstance(other, list):
            other = []
        other_s = [str(x) for x in other]
        scores.append(0.5 * _jaccard(ops, other_s) + 0.5 * _lcs_ratio(ops, other_s))
    return round(sum(scores) / len(scores), 4)


def record_ops(data: dict[str, Any]) -> dict[str, Any]:
    ensure_schema()
    cat = str(data.get("category_id") or data.get("category") or "OTH").strip().upper()
    if cat not in CATEGORIES:
        raise ValueError("category_id must be one of " + ",".join(CATEGORIES))
    ops = _ops_list(data.get("ops") or data.get("operations"))
    if not ops:
        raise ValueError("ops is required (ordered action verbs)")
    tbs = _tb_list(data.get("traceback_ids"), ops)
    prompt_id = str(data.get("prompt_id") or "").strip() or ("prm_" + uuid.uuid4().hex[:10])
    result_score = int(data.get("result_score") if data.get("result_score") is not None else data.get("score") or 0)
    if result_score < 0 or result_score > 100:
        raise ValueError("result_score must be 0-100")
    damage = float(data.get("damage_score") if data.get("damage_score") is not None else data.get("damage") or 0)
    damage = max(0.0, min(1.0, damage))
    instance_id = str(data.get("instance_id") or "local")[:80]
    public_factor = float(data.get("instance_public_factor") if data.get("instance_public_factor") is not None else 0)
    public_factor = 0.0 if public_factor != public_factor else max(0.0, min(1.0, public_factor))
    result_ref = str(data.get("result_ref_id") or data.get("result_ref") or "").strip()
    if not result_ref:
        result_ref = "res_" + uuid.uuid4().hex[:10]
    with get_conn() as conn:
        sim = _similarity_to_category(conn, cat, ops, prompt_id)
        conn.execute(
            """
            INSERT OR REPLACE INTO agent_ops_runs (
                prompt_id, ts, category_id, cycle_id, agent, ops_json, traceback_json,
                result_score, result_ref_id, ops_similarity, damage_score,
                instance_id, instance_public_factor, log_id, project_id
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            (
                prompt_id,
                _now(),
                cat,
                str(data.get("cycle_id") or "")[:40],
                str(data.get("agent") or "")[:40],
                json.dumps(ops),
                json.dumps(tbs),
                result_score,
                result_ref,
                sim,
                damage,
                instance_id,
                public_factor,
                str(data.get("log_id") or "")[:80],
                str(data.get("project_id") or "")[:80],
            ),
        )
    row = get_ops(prompt_id)
    assert row
    return row


def get_ops(prompt_id: str) -> dict[str, Any] | None:
    ensure_schema()
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM agent_ops_runs WHERE prompt_id = ?", (prompt_id,)).fetchone()
    return _row(row) if row else None


def list_ops(limit: int = 40, category_id: str | None = None) -> list[dict[str, Any]]:
    ensure_schema()
    lim = max(1, min(int(limit or 40), 80))
    with get_conn() as conn:
        if category_id:
            rows = conn.execute(
                "SELECT * FROM agent_ops_runs WHERE category_id = ? ORDER BY ts DESC LIMIT ?",
                (str(category_id).upper(), lim),
            ).fetchall()
        else:
            rows = conn.execute("SELECT * FROM agent_ops_runs ORDER BY ts DESC LIMIT ?", (lim,)).fetchall()
    return [_row(r) for r in rows]


def similar(category_id: str, ops: list[str] | None = None, limit: int = 12) -> dict[str, Any]:
    cat = str(category_id or "").strip().upper()
    if cat not in CATEGORIES:
        raise ValueError("category_id required")
    rows = list_ops(limit=40, category_id=cat)
    probe = _ops_list(ops) if ops else (rows[0]["ops"] if rows else [])
    ranked = []
    for row in rows:
        ranked.append(
            {
                "prompt_id": row["prompt_id"],
                "ops_similarity": round(0.5 * _jaccard(probe, row["ops"]) + 0.5 * _lcs_ratio(probe, row["ops"]), 4),
                "result_score": row["result_score"],
                "result_ref_id": row["result_ref_id"],
                "agent": row["agent"],
            }
        )
    ranked.sort(key=lambda x: x["ops_similarity"], reverse=True)
    return {"schema": SCHEMA, "category_id": cat, "probe_ops": probe, "matches": ranked[: max(1, min(limit, 20))]}


def _row(row: Any) -> dict[str, Any]:
    ops = json.loads(row["ops_json"] or "[]")
    tbs = json.loads(row["traceback_json"] or "[]")
    return {
        "schema": SCHEMA,
        "prompt_id": row["prompt_id"],
        "category_id": row["category_id"],
        "cycle_id": row["cycle_id"],
        "agent": row["agent"],
        "ops": ops,
        "traceback_ids": tbs,
        "result_score": row["result_score"],
        "result_ref_id": row["result_ref_id"],
        "ops_similarity": row["ops_similarity"],
        "damage_score": row["damage_score"],
        "instance_id": row["instance_id"],
        "instance_public_factor": row["instance_public_factor"],
        "log_id": row["log_id"],
        "project_id": row["project_id"],
        "ts": row["ts"],
    }
