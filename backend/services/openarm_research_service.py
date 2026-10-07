"""Append-only OpenArm research events for CAD, calibration, and sim review.

The CAD path writes locally; Grok reads and records bounded evidence through MCP.
This module never sends motor commands or changes runtime settings.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[2]
DB_PATH = ROOT_DIR / "ai-context" / "openarm-research" / "events.sqlite3"
KINDS = frozenset({
    "cad_physics", "calibration", "trial", "evidence", "source_review",
    "diagnosis", "settings_proposal", "incident", "agent_job", "rig_audit",
})
_SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")


def _db(path: Path | None = None) -> sqlite3.Connection:
    db_path = path or DB_PATH
    db_path.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(db_path, timeout=10)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("""CREATE TABLE IF NOT EXISTS research_events (
        event_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        source_instance TEXT NOT NULL,
        source_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL
    )""")
    con.execute("CREATE INDEX IF NOT EXISTS research_events_kind_time ON research_events(kind, occurred_at DESC)")
    con.execute("CREATE INDEX IF NOT EXISTS research_events_project_time ON research_events(project_id, occurred_at DESC)")
    return con


def _id(value: Any, field: str) -> str:
    candidate = str(value or "").strip()
    if not _SAFE_ID.fullmatch(candidate):
        raise ValueError(f"{field} must be a short stable identifier")
    return candidate


def record_event(data: dict[str, Any], *, path: Path | None = None) -> dict[str, Any]:
    kind = str(data.get("kind") or "").strip()
    if kind not in KINDS:
        raise ValueError("unsupported OpenArm research event kind")
    source_instance = _id(data.get("source_instance") or "render-mac", "source_instance")
    source_id = _id(data.get("source_id"), "source_id")
    project_id = _id(data.get("project_id") or "openarm-2-calibration", "project_id")
    payload = data.get("payload")
    if not isinstance(payload, dict):
        raise ValueError("payload must be an object")
    body = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False)
    if len(body.encode("utf-8")) > 16_384:
        raise ValueError("payload exceeds 16 KiB; store large data separately and send its ID")
    digest = hashlib.sha256(body.encode("utf-8")).hexdigest()
    event_id = "oar_" + hashlib.sha256(
        f"{project_id}|{kind}|{source_instance}|{source_id}|{digest}".encode("utf-8")
    ).hexdigest()[:24]
    occurred_at = str(data.get("occurred_at") or datetime.now(timezone.utc).isoformat())
    # Require parseable UTC time. This is provenance, not a trusted sequence clock.
    parsed = datetime.fromisoformat(occurred_at.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("occurred_at needs a timezone")
    occurred_at = parsed.astimezone(timezone.utc).isoformat()
    with closing(_db(path)) as con, con:
        cursor = con.execute(
            """INSERT OR IGNORE INTO research_events
            (event_id, kind, source_instance, source_id, project_id, occurred_at, payload_json, payload_sha256)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (event_id, kind, source_instance, source_id, project_id, occurred_at, body, digest),
        )
    return {"ok": True, "event_id": event_id, "created": bool(cursor.rowcount), "kind": kind}


def list_events(*, kind: str | None = None, project_id: str | None = None,
                limit: int = 30, path: Path | None = None) -> dict[str, Any]:
    if kind is not None and kind not in KINDS:
        raise ValueError("unsupported kind")
    if project_id is not None:
        project_id = _id(project_id, "project_id")
    sql = "SELECT * FROM research_events WHERE 1=1"
    values: list[Any] = []
    if kind:
        sql += " AND kind=?"
        values.append(kind)
    if project_id:
        sql += " AND project_id=?"
        values.append(project_id)
    sql += " ORDER BY occurred_at DESC, event_id DESC LIMIT ?"
    values.append(max(1, min(int(limit), 100)))
    with closing(_db(path)) as con:
        rows = con.execute(sql, values).fetchall()
    events = [{**dict(row), "payload": json.loads(row["payload_json"])} for row in rows]
    for event in events:
        event.pop("payload_json", None)
    return {"ok": True, "count": len(events), "events": events}


def overview(*, path: Path | None = None) -> dict[str, Any]:
    with closing(_db(path)) as con:
        rows = con.execute("SELECT kind, count(*) AS n FROM research_events GROUP BY kind").fetchall()
        last = con.execute("SELECT event_id, kind, occurred_at FROM research_events ORDER BY occurred_at DESC LIMIT 1").fetchone()
    return {"ok": True, "counts": {row["kind"]: row["n"] for row in rows},
            "latest": dict(last) if last else None,
            "status": "local_event_index_only; no cross-instance sync or robot actuation"}


def record_cad_physics(*, sim: dict[str, Any], files: dict[str, Path],
                       project_path: Path, basename: str, path: Path | None = None) -> dict[str, Any]:
    """Index a small, uncertainty-marked summary after the existing sim export."""
    parts = sim.get("parts") or []
    payload = {
        "schema": sim.get("schema"),
        "name": sim.get("name"),
        "units": sim.get("units"),
        "total_mass_kg": sim.get("total_mass_kg"),
        "part_count": len(parts),
        "joint_count": len(sim.get("joints") or []),
        "materials": sorted({str(part.get("material")) for part in parts}),
        "artifact_names": {key: value.name for key, value in files.items() if key in {"sim", "mjcf", "urdf"}},
        "project_path": str(project_path),
        "evidence_status": "estimated_from_CAD_material_assumptions",
        "requires_measurement": ["printed_mass", "surface_friction", "mount_clearance", "controller_tracking_residual"],
    }
    # Source ID is tied to the actual physics sidecar, so a rebuild with new
    # estimates produces a distinct event while an exact retry is idempotent.
    sim_path = files.get("sim")
    if not sim_path:
        raise ValueError("sim sidecar missing")
    artifact_hash = hashlib.sha256(sim_path.read_bytes()).hexdigest()[:16]
    return record_event({"kind": "cad_physics", "source_instance": "render-mac",
                         "source_id": f"{basename}.{artifact_hash}", "payload": payload}, path=path)


def record_rig_audit(*, sim: dict[str, Any], files: dict[str, Path],
                     basename: str, path: Path | None = None) -> dict[str, Any]:
    """Check structural metadata on each CAD export; physical checks stay unknown."""
    from backend.services.openarm_rig_audit import audit

    sim_path = files.get("sim")
    if not sim_path:
        raise ValueError("sim sidecar missing")
    artifact_hash = hashlib.sha256(sim_path.read_bytes()).hexdigest()[:16]
    report = audit(sim)
    failures = [c for c in report["checks"] if c["status"] == "fail"]
    payload = {"artifact_sha256_prefix": artifact_hash, "part_count": len(sim.get("parts") or []),
               "joint_count": len(sim.get("joints") or []), "counts": report["counts"],
               "failures": failures[:30], "ready_for_physical_motion": False,
               "scope": "structural CAD metadata only; no dimensional spec or hardware evidence"}
    return record_event({"kind": "rig_audit", "source_instance": "render-mac",
                         "source_id": f"{basename}.{artifact_hash}", "payload": payload}, path=path)
