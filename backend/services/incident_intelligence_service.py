"""Bounded, structured incident evidence for the management debugger.

Feature statuses are observations, not guesses. Unknown stays unknown until a
client smoke check, agent, or human reports a result. No arbitrary code runs.
"""
from __future__ import annotations

import json
import os
import re
import resource
import sqlite3
import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from backend.config import ROOT_DIR, settings

DB_PATH = Path(settings.data_dir) / "incident_intelligence.sqlite3"
LOG_ROOT = ROOT_DIR / "ai-context" / "debugger" / "incident-intelligence"
FEATURES = (
    "viewport.boot", "viewport.models", "viewport.duplicates", "webgl.context",
    "vr.controllers.trigger", "vr.controls", "rigging.models", "api.health",
    "network.latency", "system.cpu", "system.ram", "user.data", "feature.visibility",
    "button.actions",
)
STATUSES = {"ok", "degraded", "broken", "missing", "unknown"}
KEY_RE = re.compile(r"^[a-z][a-z0-9_.-]{0,79}$")


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, kind TEXT NOT NULL,
            feature TEXT NOT NULL, status TEXT NOT NULL, project_id TEXT,
            prompt_id TEXT, snapshot_id TEXT, note TEXT, source TEXT,
            fields_json TEXT NOT NULL, log_path TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_incident_feature_ts ON events(feature,ts);
        CREATE INDEX IF NOT EXISTS idx_incident_kind_ts ON events(kind,ts);
        CREATE TABLE IF NOT EXISTS snapshots (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, label TEXT NOT NULL,
            golden INTEGER NOT NULL, project_id TEXT, commit_sha TEXT,
            kernel TEXT, features_json TEXT NOT NULL, fields_json TEXT NOT NULL,
            note TEXT
        );
        CREATE TABLE IF NOT EXISTS fields (
            name TEXT PRIMARY KEY, type TEXT NOT NULL, description TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS findings (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, feature TEXT NOT NULL,
            hypothesis TEXT NOT NULL, evidence_json TEXT NOT NULL,
            steps_json TEXT NOT NULL, outcome TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS exports (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, destination TEXT NOT NULL,
            feature TEXT NOT NULL, log_id TEXT, traceback_id TEXT NOT NULL,
            vote TEXT NOT NULL, confidence REAL NOT NULL, sam_claim TEXT NOT NULL,
            folder_path TEXT, pdf_path TEXT, txt_path TEXT, share_token TEXT,
            share_url TEXT, grok_inbox TEXT, remote_path TEXT, note TEXT,
            packet TEXT NOT NULL, fields_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audits (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, export_id TEXT NOT NULL,
            feature TEXT NOT NULL, actor TEXT NOT NULL, claimed TEXT NOT NULL,
            verified TEXT NOT NULL, correct INTEGER, note TEXT
        );
    """)
    conn.executemany("INSERT OR IGNORE INTO fields(name,type,description,created_at) VALUES (?,?,?,?)", [
        ("user.id", "string", "User identifier for affected sessions", now()),
        ("model.count", "number", "Visible or expected model count", now()),
        ("duplicate.count", "number", "Duplicate model count", now()),
        ("network.rtt_ms", "number", "Measured network round trip in milliseconds", now()),
        ("api.latency_ms", "number", "API response time in milliseconds", now()),
        ("cpu.load_1m", "number", "Server one-minute load average", now()),
        ("ram.max_rss", "number", "Process maximum resident set size in native units", now()),
        ("cause.layer", "string", "kernel | code | data | network | device", now()),
        ("webgl.reset_count", "number", "WebGL context-loss / restore count", now()),
    ])
    return conn


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


def _object(value: Any, *, max_bytes: int = 12000) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("fields must be an object")
    if len(_json(value).encode()) > max_bytes:
        raise ValueError("fields are too large")
    return value


def _feature(value: Any) -> str:
    feature = str(value or "").strip().lower()
    if not KEY_RE.fullmatch(feature):
        raise ValueError("feature must be a short dotted identifier")
    return feature


def _row(row: sqlite3.Row) -> dict[str, Any]:
    result = dict(row)
    for key in ("fields_json", "features_json", "evidence_json", "steps_json"):
        if key in result:
            result[key.removesuffix("_json")] = json.loads(result.pop(key))
    if "golden" in result:
        result["golden"] = bool(result["golden"])
    return result


def get_event(event_id: str) -> dict[str, Any] | None:
    ident = str(event_id or "").strip()
    if not ident:
        return None
    with _conn() as conn:
        row = conn.execute("SELECT * FROM events WHERE id = ?", (ident,)).fetchone()
    return _row(row) if row else None


def latest(feature: str, *, status: str | None = None, before: str | None = None) -> dict[str, Any] | None:
    with _conn() as conn:
        clauses = ["feature = ?"]
        args: list[Any] = [_feature(feature)]
        if status:
            clauses.append("status = ?")
            args.append(status)
        if before:
            clauses.append("ts < ?")
            args.append(before)
        row = conn.execute(f"SELECT * FROM events WHERE {' AND '.join(clauses)} ORDER BY ts DESC, rowid DESC LIMIT 1", args).fetchone()
    return _row(row) if row else None


def record_event(data: dict[str, Any]) -> dict[str, Any]:
    feature = _feature(data.get("feature"))
    status = str(data.get("status") or "unknown").lower()
    if status not in STATUSES:
        raise ValueError("status must be ok, degraded, broken, missing, or unknown")
    fields = _object(data.get("fields") or {})
    kind = str(data.get("kind") or "observation")[:40]
    previous = latest(feature)
    event_id, ts = uuid.uuid4().hex, now()
    relative = f"{ts[:10]}/{event_id}.json"
    path = LOG_ROOT / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    row = {
        "id": event_id, "ts": ts, "kind": kind, "feature": feature, "status": status,
        "project_id": str(data.get("project_id") or "")[:100],
        "prompt_id": str(data.get("prompt_id") or "")[:100],
        "snapshot_id": str(data.get("snapshot_id") or "")[:100],
        "note": str(data.get("note") or "")[:1500],
        "source": str(data.get("source") or "api")[:80],
        "fields": fields, "log_path": str(path.relative_to(ROOT_DIR)),
    }
    path.write_text(json.dumps(row, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    with _conn() as conn:
        conn.execute("INSERT INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (
            event_id, ts, kind, feature, status, row["project_id"], row["prompt_id"],
            row["snapshot_id"], row["note"], row["source"], _json(fields), row["log_path"],
        ))
    if status in {"broken", "missing"} and previous and previous["status"] == "ok":
        row["alert"] = {"priority": "high", "last_working": previous["id"], "first_failure": event_id}
    return row


def record_snapshot(data: dict[str, Any]) -> dict[str, Any]:
    features = _object(data.get("features") or {})
    for key, value in features.items():
        _feature(key)
        if value not in STATUSES:
            raise ValueError(f"invalid status for {key}")
    fields = _object(data.get("fields") or {})
    sid, ts = uuid.uuid4().hex, now()
    row = {"id": sid, "ts": ts, "label": str(data.get("label") or "Snapshot")[:160],
           "golden": bool(data.get("golden")), "project_id": str(data.get("project_id") or "")[:100],
           "commit_sha": str(data.get("commit_sha") or "")[:80], "kernel": str(data.get("kernel") or "")[:120],
           "features": features, "fields": fields, "note": str(data.get("note") or "")[:1500]}
    with _conn() as conn:
        conn.execute("INSERT INTO snapshots VALUES (?,?,?,?,?,?,?,?,?,?)", (
            sid, ts, row["label"], int(row["golden"]), row["project_id"], row["commit_sha"],
            row["kernel"], _json(features), _json(fields), row["note"],
        ))
    for feature, status in features.items():
        record_event({"feature": feature, "status": status, "kind": "snapshot", "snapshot_id": sid,
                      "project_id": row["project_id"], "note": row["note"], "source": "golden" if row["golden"] else "snapshot",
                      "fields": {"commit_sha": row["commit_sha"], "kernel": row["kernel"], **fields}})
    return row


def register_field(data: dict[str, Any]) -> dict[str, Any]:
    name = _feature(data.get("name"))
    field_type = str(data.get("type") or "string")
    if field_type not in {"string", "number", "boolean"}:
        raise ValueError("type must be string, number, or boolean")
    row = {"name": name, "type": field_type, "description": str(data.get("description") or "")[:500], "created_at": now()}
    with _conn() as conn:
        conn.execute("INSERT INTO fields VALUES (?,?,?,?) ON CONFLICT(name) DO UPDATE SET type=excluded.type, description=excluded.description", tuple(row.values()))
    return row


def query_events(filters: dict[str, Any] | None = None, limit: int = 100) -> list[dict[str, Any]]:
    filters = filters or {}
    if not isinstance(filters, dict) or len(filters) > 20:
        raise ValueError("filters must be an object with at most 20 fields")
    limit = max(1, min(int(limit), 500))
    allowed = {"kind", "feature", "status", "project_id", "prompt_id", "snapshot_id", "source"}
    clauses, args = [], []
    with _conn() as conn:
        declared = {row[0] for row in conn.execute("SELECT name FROM fields")}
        for key, value in filters.items():
            if key in allowed:
                clauses.append(f"{key} = ?")
                args.append(str(value))
            elif key == "since":
                clauses.append("ts >= ?")
                args.append(str(value))
            elif key == "until":
                clauses.append("ts <= ?")
                args.append(str(value))
            elif key in declared:
                path = f'$."{key}"'
                if isinstance(value, dict):
                    if len(value) != 1:
                        raise ValueError("Field comparison needs one operator")
                    op, operand = next(iter(value.items()))
                    sql_op = {"eq": "=", "ne": "!=", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}.get(op)
                    if not sql_op or not isinstance(operand, (str, int, float, bool)):
                        raise ValueError("Unsupported field comparison")
                    clauses.append(f"json_extract(fields_json, ?) {sql_op} ?")
                    args.extend([path, operand])
                else:
                    clauses.append("json_extract(fields_json, ?) = ?")
                    args.extend([path, value])
            else:
                raise ValueError(f"Unknown query field: {key}; register it first")
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        rows = conn.execute(f"SELECT * FROM events{where} ORDER BY ts DESC, rowid DESC LIMIT ?", (*args, limit)).fetchall()
    return [_row(row) for row in rows]


def snapshots(limit: int = 60) -> list[dict[str, Any]]:
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM snapshots ORDER BY ts DESC, rowid DESC LIMIT ?", (max(1, min(limit, 200)),)).fetchall()
    return [_row(row) for row in rows]


def compare(feature: str) -> dict[str, Any]:
    feature = _feature(feature)
    events = list(reversed(query_events({"feature": feature}, 500)))
    latest_failure_index = next((i for i in range(len(events) - 1, -1, -1) if events[i]["status"] in {"broken", "missing", "degraded"}), None)
    last_working_index = next((i for i in range(latest_failure_index - 1, -1, -1) if events[i]["status"] == "ok"), None) if latest_failure_index is not None else None
    first_failure = next((event for event in events[(last_working_index + 1 if last_working_index is not None else 0):latest_failure_index + 1] if event["status"] in {"broken", "missing", "degraded"}), None) if latest_failure_index is not None else None
    last_working = events[last_working_index] if last_working_index is not None else None
    window = [event for event in events if last_working and first_failure and last_working["ts"] <= event["ts"] <= first_failure["ts"]]
    with _conn() as conn:
        before = conn.execute("SELECT * FROM snapshots WHERE ts <= ? AND json_extract(features_json, ?) = 'ok' ORDER BY ts DESC LIMIT 1", (first_failure["ts"] if first_failure else now(), f'$."{feature}"')).fetchone()
        after = conn.execute("SELECT * FROM snapshots WHERE ts >= ? AND ts <= ? AND json_extract(features_json, ?) IN ('broken','missing','degraded') ORDER BY ts ASC LIMIT 1", (last_working["ts"] if last_working else "", first_failure["ts"] if first_failure else now(), f'$."{feature}"')).fetchone()
    result = {
        "feature": feature, "last_working": last_working, "first_failure": first_failure,
        "last_working_snapshot": _row(before) if before else None,
        "first_failing_snapshot": _row(after) if after else None,
        "window": window, "prompt_ids": list(dict.fromkeys(x["prompt_id"] for x in window if x["prompt_id"])),
        "cause_hint": _cause_hint(_row(before) if before else None, _row(after) if after else None),
    }
    result["cursor_packet"] = cursor_packet(result)
    try:
        from backend.services import debugger_swarm_service as dss

        result["swarm"] = dss.ingest_from_compare(result)
    except Exception:
        pass
    return result


def _cause_hint(working: dict[str, Any] | None, failing: dict[str, Any] | None) -> str:
    if not working or not failing:
        return "unknown"
    wk, fk = str(working.get("kernel") or ""), str(failing.get("kernel") or "")
    if wk and fk and wk != fk:
        return "kernel-or-runtime-change"
    return "code-or-data-change"


def cursor_packet(comparison: dict[str, Any]) -> str:
    first_failure = comparison.get("first_failure") or {}
    last_working = comparison.get("last_working") or {}
    last_working_snapshot = comparison.get("last_working_snapshot") or {}
    first_failing_snapshot = comparison.get("first_failing_snapshot") or {}
    log_id = first_failure.get("id") or ""
    log_path = first_failure.get("log_path") or ""
    prompts = [p for p in (comparison.get("prompt_ids") or []) if p]
    return "\n".join([
        "CURSOR_FIX",
        f"feature: {comparison.get('feature')}",
        f"status: {first_failure.get('status') or 'unknown'}",
        f"log_id: {log_id}",
        f"log_path: {log_path}",
        f"GET /api/ops/incidents/logs/{log_id}",
        f"last_working_ts: {last_working.get('ts') or 'not recorded'}",
        f"first_failure_ts: {first_failure.get('ts') or 'not recorded'}",
        f"last_working_snapshot: {last_working_snapshot.get('label') or 'none'} @ {last_working_snapshot.get('ts') or '—'}",
        f"first_failing_snapshot: {first_failing_snapshot.get('label') or 'none'} @ {first_failing_snapshot.get('ts') or '—'}",
        f"cause_hint: {comparison.get('cause_hint') or 'unknown'}",
        f"prompt_ids: {', '.join(prompts) or 'none recorded'}",
        "Search chat logs: GET /api/ops/incidents/search?q=" + str(comparison.get("feature") or "").replace(".", "+"),
    ])


def record_checklist(data: dict[str, Any]) -> dict[str, Any]:
    features = _object(data.get("features") or {})
    if not features:
        raise ValueError("features map is required")
    prompt_id = str(data.get("prompt_id") or "")[:100]
    note = str(data.get("note") or "")[:1500]
    layer = str((data.get("fields") or {}).get("cause.layer") or data.get("cause_layer") or "")
    fields = _object(data.get("fields") or {})
    if layer:
        fields["cause.layer"] = layer
    events = []
    for feature, status in features.items():
        events.append(record_event({
            "feature": feature, "status": status, "kind": "checklist",
            "prompt_id": prompt_id, "note": note, "source": str(data.get("source") or "post-prompt"),
            "fields": fields, "project_id": str(data.get("project_id") or ""),
        }))
    out = {"ok": True, "prompt_id": prompt_id, "events": events, "counts": dict(Counter(e["status"] for e in events))}
    try:
        from backend.services import debugger_swarm_service as dss

        broken = [key for key, status in features.items() if str(status) in {"broken", "missing", "degraded"}]
        uid = str(data.get("user_id") or data.get("debug_user_id") or data.get("uid") or "")
        payload = {
            "user_id": uid,
            "project_id": data.get("project_id") or "",
            "agent_id": data.get("agent_id") or "cursor",
            "instance_id": data.get("instance_id") or dss.LOCAL_AREA,
            "broken": broken,
            "features": features,
            "log_id": prompt_id,
            "score": 20 if broken else 70,
        }
        if uid or data.get("ingest"):
            out["swarm"] = dss.ingest_live_outcome(payload, {"score": 20 if broken else 70, "broken": broken, "features": features})
        else:
            out["swarm"] = {
                "skipped": True,
                "credit_category": dss.infer_category(payload, {"broken": broken, "features": features}),
                "auto_fire": False,
            }
    except Exception:
        pass
    return out


def search_chat_logs(query: str, *, limit: int = 40) -> dict[str, Any]:
    needle = str(query or "").strip().lower()
    if len(needle) < 2:
        raise ValueError("q must be at least 2 characters")
    hits: list[dict[str, Any]] = []
    try:
        from backend.services import prompt_trace_service as trace
        rows = list(reversed(trace.all_prompts()))
    except Exception:
        rows = []
    for row in rows:
        blob = " ".join([
            str(row.get("prompt") or ""),
            str(row.get("excerpt") or ""),
            str(row.get("notes") or ""),
            str(row.get("result") or ""),
            str(row.get("blamed_log_id") or ""),
            " ".join(row.get("categories") or []) if isinstance(row.get("categories"), list) else "",
        ]).lower()
        if needle not in blob:
            continue
        excerpt = str(row.get("excerpt") or row.get("prompt") or "")[:120]
        hits.append({
            "log_id": row.get("log_id"),
            "chat_id": row.get("chat_id"),
            "result": row.get("result"),
            "blamed_log_id": row.get("blamed_log_id"),
            "project": row.get("project"),
            "prompt": excerpt,
            "excerpt": excerpt,
            "timestamp": row.get("timestamp"),
        })
        if len(hits) >= max(1, min(int(limit), 80)):
            break
    return {"ok": True, "q": query, "count": len(hits), "hits": hits, "excerpt_cap": 120}


def system_smoke() -> dict[str, Any]:
    """Server checks only. Browser, VR and model checks need client observations."""
    try:
        load = os.getloadavg()[0]
    except OSError:
        load = None
    usage = resource.getrusage(resource.RUSAGE_SELF)
    metrics = {"cpu.load_1m": load, "cpu_count": os.cpu_count(),
               "process_cpu_user_seconds": usage.ru_utime, "process_cpu_system_seconds": usage.ru_stime,
               "ram.max_rss": usage.ru_maxrss,
               "db_exists": Path(settings.data_dir).exists()}
    checks = {"api.health": "ok", "system.cpu": "unknown", "system.ram": "unknown",
              "viewport.boot": "unknown", "viewport.models": "unknown",
              "vr.controllers.trigger": "unknown", "webgl.context": "unknown"}
    # Only observed checks enter feature history. Unknown checks must not
    # clear an existing alert from a real browser or device observation.
    record_event({"feature": "api.health", "status": "ok", "kind": "smoke", "source": "server", "fields": metrics})
    return {"at": now(), "checks": checks, "metrics": metrics}


def record_finding(data: dict[str, Any]) -> dict[str, Any]:
    feature = _feature(data.get("feature"))
    evidence = _object(data.get("evidence") or {})
    steps = data.get("steps") or []
    if not isinstance(steps, list) or len(steps) > 30:
        raise ValueError("steps must be a list with at most 30 items")
    outcome = str(data.get("outcome") or "unverified")
    if outcome not in {"unverified", "confirmed", "rejected"}:
        raise ValueError("outcome must be unverified, confirmed, or rejected")
    row = {"id": uuid.uuid4().hex, "ts": now(), "feature": feature,
           "hypothesis": str(data.get("hypothesis") or "")[:2000], "evidence": evidence,
           "steps": [str(x)[:300] for x in steps], "outcome": outcome}
    with _conn() as conn:
        conn.execute("INSERT INTO findings VALUES (?,?,?,?,?,?,?)", (row["id"], row["ts"], feature, row["hypothesis"], _json(evidence), _json(row["steps"]), outcome))
    return row


def overview() -> dict[str, Any]:
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM events ORDER BY ts DESC, rowid DESC LIMIT 1000").fetchall()
        findings = conn.execute("SELECT * FROM findings ORDER BY ts DESC LIMIT 15").fetchall()
        fields = conn.execute("SELECT * FROM fields ORDER BY name").fetchall()
    events = [_row(row) for row in rows]
    latest_by_feature = {}
    for event in events:
        latest_by_feature.setdefault(event["feature"], event)
    alerts = []
    for feature, event in latest_by_feature.items():
        if event["status"] not in {"broken", "missing", "degraded"}:
            continue
        comparison = compare(feature)
        alerts.append({"feature": feature, "priority": "high" if event["status"] in {"broken", "missing"} else "medium",
                       "status": event["status"], "log_id": event["id"], "log_path": event["log_path"],
                       "last_working": comparison["last_working"], "first_failure": comparison["first_failure"],
                       "last_working_snapshot": comparison["last_working_snapshot"], "first_failing_snapshot": comparison["first_failing_snapshot"],
                       "cause_hint": comparison.get("cause_hint"), "cursor_packet": comparison.get("cursor_packet")})
    payload = {"features": {key: latest_by_feature.get(key, {"feature": key, "status": "unknown"}) for key in (*FEATURES, *latest_by_feature.keys())},
            "alerts": alerts, "counts": dict(Counter(x["status"] for x in latest_by_feature.values())),
            "bug_counts": dict(Counter(x["feature"] for x in events if x["status"] in {"broken", "missing"})),
            "recent": events[:30], "snapshots": snapshots(12), "fields": [dict(x) for x in fields],
            "findings": [_row(x) for x in findings], "weekly": weekly_report()}
    from backend.services import incident_export_service as exp
    payload["exports"] = exp.list_exports(20)
    payload["accuracy"] = exp.accuracy_chart()
    payload["pending_audits"] = exp.pending_audits()
    return payload


def weekly_report(week_start: str | None = None) -> dict[str, Any]:
    if week_start:
        start = datetime.fromisoformat(week_start).replace(tzinfo=timezone.utc)
    else:
        today = datetime.now(timezone.utc)
        start = (today - timedelta(days=today.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=7)
    events = query_events({"since": start.isoformat(), "until": end.isoformat()}, 500)
    failures = [e for e in events if e["status"] in {"broken", "missing"}]
    result = {"week_start": start.date().isoformat(), "week_end": end.date().isoformat(),
            "observations": len(events), "failures": len(failures),
            "by_feature": dict(Counter(e["feature"] for e in failures)),
            "affected_projects": len({e["project_id"] for e in failures if e["project_id"]}),
            "affected_users": len({e["fields"].get("user.id") for e in failures if e["fields"].get("user.id")}),
            "recent_failures": failures[:15], "generated_at": now()}
    reports = LOG_ROOT / "reports"
    reports.mkdir(parents=True, exist_ok=True)
    path = reports / f"week-{result['week_start']}.md"
    lines = [f"# Incident report: week of {result['week_start']}",
             f"Generated: {result['generated_at']}",
             f"Observations: {result['observations']}", f"Failures: {result['failures']}",
             f"Affected projects: {result['affected_projects']}", f"Affected users: {result['affected_users']}",
             "", "## Failure counts"]
    lines += [f"- {feature}: {count}" for feature, count in sorted(result["by_feature"].items())] or ["- None recorded"]
    lines += ["", "## Recent failures"]
    lines += [f"- {event['ts']} {event['feature']} {event['status']} — {event['log_path']}" for event in failures[:15]] or ["- None recorded"]
    lines += ["", "## Cursor packets"]
    for feature in sorted(result["by_feature"])[:8]:
        packet = compare(feature).get("cursor_packet") or ""
        if packet:
            lines += ["", f"### {feature}", "```", packet, "```"]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    result["report_path"] = str(path.relative_to(ROOT_DIR))
    return result


def read_log(log_id: str) -> dict[str, Any] | None:
    if not re.fullmatch(r"[0-9a-f]{32}", log_id):
        return None
    with _conn() as conn:
        row = conn.execute("SELECT * FROM events WHERE id = ?", (log_id,)).fetchone()
    return _row(row) if row else None
