"""Bounded debugger/analytics: search ids, draft watchdogs, scores, gated bug reports.

No arbitrary code execution. CLI and watchdogs stay drafts until Sam approves.
Scoring logs may write live (same key as prompt-trace). Skill-file edits stay pending.
"""
from __future__ import annotations

import json
import re
import sqlite3
import subprocess
import sys
import uuid
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from backend.config import ROOT_DIR, settings
from backend.services.simple_pdf import pdf_bytes

DB_PATH = Path(settings.data_dir) / "debugger_analytics.sqlite3"
WATCHDOG_ROOT = ROOT_DIR / "ai-context" / "debugger" / "incident-intelligence" / "tmp-watchdogs"
DATA_WATCHDOG_ROOT = ROOT_DIR / "data" / "debugger" / "tmp-watchdogs"
BUG_ROOT = ROOT_DIR / "ai-context" / "debugger" / "incident-intelligence" / "bug-reports"
NOTES_ROOT = ROOT_DIR / "ai-context" / "debugger" / "incident-intelligence" / "architecture-notes"
REPORTS_ROOT = ROOT_DIR / "ai-context" / "debugger" / "incident-intelligence" / "weekly"
SCORE_ROOT = ROOT_DIR / "data" / "debugger" / "scores"

WATCHDOG_STATUSES = ("pending_approval", "approved", "running", "throttled", "pruned", "retired")
CLI_STATUSES = ("pending_approval", "approved", "ran", "denied")
SKILL_THRESHOLD = 3
EXCERPT_CAP = 120
HIGH_SCORE = 85
MULTI_FEATURE = 2
BYTES_PER_SEC_LIMIT = 50_000
REQUESTS_PER_SEC_LIMIT = 10
TOKEN_SPIKE_RATIO = 2.0
TOKEN_DELTA = 0.30
MAX_LOG_BYTES = 1500
MAX_LOG_KEEP = 20
BROKEN = {"broken", "missing", "degraded"}
OK = {"ok"}
SCORE_LABELS = (
    (25, "missed"),
    (60, "partial"),
    (85, "achieved"),
    (101, "exceeded"),
)
MEMBER_KIND_RE = re.compile(r"^(project|log|tb|prompt|ref|res|instance|user|agent)$")
TRACKING_ID_CAP = 160
MEMBER_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,80}$")
KEY_RE = re.compile(r"^[a-z][a-z0-9_.-]{0,79}$")
FEATURE_STATUSES = {"ok", "degraded", "broken", "missing", "unknown"}
CLI_ALLOWLIST: dict[str, list[str] | None] = {
    "journalctl_render3d": ["journalctl", "-u", "render3d", "-n", "100", "--no-pager"],
    "list_debugger": None,
    "index_transcripts": [sys.executable or "python3", str(ROOT_DIR / "scripts" / "index-cursor-transcripts.py")],
}
SKILL_WRITE_ROOTS = (
    ROOT_DIR / "mcp" / "grok-bot" / "skills",
    ROOT_DIR / "ai-context" / "skills",
    ROOT_DIR / ".cursor" / "skills",
)


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), default=str)


def _object(value: Any, *, max_bytes: int = 8000) -> dict[str, Any]:
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ValueError("fields must be an object")
    if len(_json(value).encode()) > max_bytes:
        raise ValueError("payload is too large")
    return value


def _feature(value: Any) -> str:
    feature = str(value or "").strip().lower()
    if not KEY_RE.fullmatch(feature):
        raise ValueError("feature must be a short dotted identifier")
    return feature


def _excerpt(text: Any, cap: int = EXCERPT_CAP) -> str:
    return str(text or "").replace("\n", " ").strip()[:cap]


def estimate_tokens(text: Any) -> int:
    raw = str(text or "")
    return max(1, len(raw) // 4) if raw else 0


def score_label(score: int) -> str:
    for ceiling, label in SCORE_LABELS:
        if score < ceiling:
            return label
    return "exceeded"


def encode_tracking_id(members: list[tuple[str, str]] | list[dict[str, str]]) -> str:
    parts: list[str] = []
    if not members:
        raise ValueError("tracking id needs at least one member")
    if len(members) > 24:
        raise ValueError("tracking id has too many members")
    for item in members:
        if isinstance(item, dict):
            kind, ident = str(item.get("kind") or ""), str(item.get("id") or "")
        else:
            kind, ident = str(item[0]), str(item[1])
        kind, ident = kind.strip().lower(), ident.strip()
        if not MEMBER_KIND_RE.fullmatch(kind) or not MEMBER_ID_RE.fullmatch(ident):
            raise ValueError("invalid tracking member")
        parts.append(f"{kind}:{ident}")
    return "+".join(parts)


def decode_tracking_id(composite: str) -> list[dict[str, str]]:
    text = str(composite or "").strip()
    if not text:
        raise ValueError("empty tracking id")
    out: list[dict[str, str]] = []
    for part in text.split("+"):
        if ":" not in part:
            raise ValueError("tracking segment needs kind:id")
        kind, ident = part.split(":", 1)
        if not MEMBER_KIND_RE.fullmatch(kind) or not MEMBER_ID_RE.fullmatch(ident):
            raise ValueError("invalid tracking segment")
        out.append({"kind": kind, "id": ident})
    return out


def jaccard(left: set[str], right: set[str]) -> float:
    if not left and not right:
        return 1.0
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def feature_sets(vector: dict[str, Any]) -> tuple[set[str], set[str], set[str]]:
    broken, ok, statuses = set(), set(), set()
    for key, value in (vector or {}).items():
        feature = _feature(key)
        status = str(value or "unknown").lower()
        if status not in FEATURE_STATUSES:
            raise ValueError(f"invalid status for {feature}")
        if status in BROKEN:
            broken.add(feature)
        if status in OK:
            ok.add(feature)
        if status != "unknown":
            statuses.add(f"{feature}:{status}")
    return broken, ok, statuses


def compare_feature_vectors(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    broken_a, ok_a, status_a = feature_sets(left)
    broken_b, ok_b, status_b = feature_sets(right)
    broken_j = jaccard(broken_a, broken_b)
    status_j = jaccard(status_a, status_b)
    ok_j = jaccard(ok_a, ok_b)
    similar = broken_j >= 0.75 and status_j >= 0.5
    return {
        "similar": similar,
        "similarity": round((broken_j + status_j) / 2, 3),
        "broken_jaccard": round(broken_j, 3),
        "status_jaccard": round(status_j, 3),
        "ok_jaccard": round(ok_j, 3),
        "threshold": {"broken_jaccard": 0.75, "status_jaccard": 0.5},
        "note": "viewport.boot+models-missing is not the same root as cad.generate+models-missing",
    }


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS watchdogs (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, status TEXT NOT NULL,
            title TEXT NOT NULL, kind TEXT NOT NULL, spec_json TEXT NOT NULL,
            folder TEXT NOT NULL, throttle_cause TEXT, helped INTEGER NOT NULL,
            note TEXT
        );
        CREATE TABLE IF NOT EXISTS cli_requests (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, status TEXT NOT NULL,
            command_key TEXT NOT NULL, argv_json TEXT NOT NULL, note TEXT,
            output_excerpt TEXT
        );
        CREATE TABLE IF NOT EXISTS analysis (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, worked TEXT, failed TEXT,
            method TEXT, feature TEXT, token_cost INTEGER, throttle INTEGER,
            watchdog_id TEXT
        );
        CREATE TABLE IF NOT EXISTS notes (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, audience TEXT NOT NULL,
            title TEXT NOT NULL, body TEXT NOT NULL, token_cost INTEGER,
            watchdog_id TEXT, bug_id TEXT, indexed TEXT
        );
        CREATE TABLE IF NOT EXISTS bugs (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, ts TEXT NOT NULL,
            feature TEXT NOT NULL, features_json TEXT NOT NULL, prompt TEXT,
            root_cause TEXT NOT NULL, solved INTEGER NOT NULL, breakage INTEGER NOT NULL,
            pdf_sam TEXT, pdf_grok TEXT, pdf_harness TEXT, watchdog_id TEXT,
            token_cost INTEGER
        );
        CREATE TABLE IF NOT EXISTS bug_instances (
            id TEXT PRIMARY KEY, bug_id TEXT NOT NULL, instance_id TEXT NOT NULL,
            ts TEXT NOT NULL, features_json TEXT NOT NULL, similar INTEGER,
            similarity REAL, prompt TEXT
        );
        CREATE TABLE IF NOT EXISTS skill_proposals (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, path TEXT NOT NULL,
            body TEXT NOT NULL, status TEXT NOT NULL, approval_count INTEGER NOT NULL,
            confirmed_solves INTEGER NOT NULL, breakage INTEGER NOT NULL, note TEXT
        );
        CREATE TABLE IF NOT EXISTS token_writes (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, kind TEXT NOT NULL,
            tokens INTEGER NOT NULL, spike INTEGER NOT NULL, note TEXT
        );
        CREATE TABLE IF NOT EXISTS scores (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, log_id TEXT, prompt_id TEXT,
            project_id TEXT, score INTEGER NOT NULL, label TEXT NOT NULL,
            features_json TEXT NOT NULL, broken_json TEXT NOT NULL, fixed_json TEXT NOT NULL,
            steps_json TEXT NOT NULL, tracking_id TEXT, result_ref TEXT,
            token_cost INTEGER, duration_s REAL, notes TEXT
        );
        CREATE TABLE IF NOT EXISTS refs (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, kind TEXT NOT NULL,
            composite TEXT NOT NULL, members_json TEXT NOT NULL, extra_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS usage (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, watchdog_id TEXT NOT NULL,
            bytes INTEGER NOT NULL, requests INTEGER NOT NULL, seconds REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS alerts (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, kind TEXT NOT NULL,
            priority TEXT NOT NULL, message TEXT NOT NULL, fields_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS patterns (
            method TEXT PRIMARY KEY, negative INTEGER NOT NULL, positive INTEGER NOT NULL, note TEXT
        );
        """
    )
    return conn


def _row(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    result = dict(row)
    for key in list(result):
        if key.endswith("_json"):
            try:
                result[key.removesuffix("_json")] = json.loads(result.pop(key) or "{}")
            except json.JSONDecodeError:
                result[key.removesuffix("_json")] = {}
    for flag in ("helped", "solved", "breakage", "throttle", "spike", "similar"):
        if flag in result:
            result[flag] = bool(result[flag])
    return result


def _features(value: Any) -> dict[str, str]:
    data = _object(value or {})
    out: dict[str, str] = {}
    for key, status in data.items():
        feature = _feature(key)
        item = str(status or "unknown").lower()
        if item not in FEATURE_STATUSES:
            raise ValueError(f"invalid status for {feature}")
        out[feature] = item
    return out


def _ids(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        value = [part.strip() for part in re.split(r"[|,]", value) if part.strip()]
    if not isinstance(value, list) or len(value) > 40:
        raise ValueError("id list is too large")
    out = []
    for item in value:
        text = str(item).strip()
        if text and MEMBER_ID_RE.fullmatch(text):
            out.append(text[:80])
    return out


def _steps(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        value = [line.strip() for line in value.splitlines() if line.strip()]
    if not isinstance(value, list) or len(value) > 12:
        raise ValueError("steps must be a short list")
    return [_excerpt(item, 80) for item in value if str(item).strip()]


def global_throttle_snapshot() -> dict[str, Any]:
    cutoff = (datetime.now(timezone.utc) - timedelta(seconds=30)).isoformat()
    with _conn() as conn:
        rows = conn.execute(
            "SELECT watchdog_id, SUM(bytes) AS b, SUM(requests) AS r, SUM(seconds) AS s FROM usage WHERE ts >= ? GROUP BY watchdog_id",
            (cutoff,),
        ).fetchall()
        throttled = [dict(x) for x in conn.execute("SELECT id, throttle_cause FROM watchdogs WHERE status = 'throttled'")]
    peers = []
    hottest = None
    for row in rows:
        seconds = max(float(row["s"] or 0), 1.0)
        bps = float(row["b"] or 0) / seconds
        rps = float(row["r"] or 0) / seconds
        peer = {"id": row["watchdog_id"], "bytes_per_sec": round(bps, 1), "requests_per_sec": round(rps, 2), "ok": bps <= BYTES_PER_SEC_LIMIT and rps <= REQUESTS_PER_SEC_LIMIT}
        peers.append(peer)
        if hottest is None or peer["bytes_per_sec"] > hottest["bytes_per_sec"]:
            hottest = peer
    return {
        "component": "global.watchdog.throttle",
        "network_ok": all(p["ok"] for p in peers),
        "peers": peers[:20],
        "hottest": hottest,
        "throttled": throttled,
        "limits": {"bytes_per_sec": BYTES_PER_SEC_LIMIT, "requests_per_sec": REQUESTS_PER_SEC_LIMIT},
    }


def _write_minilog(folder: Path, payload: dict[str, Any]) -> Path:
    logs = folder / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    payload = {**payload, "global_throttle": global_throttle_snapshot()}
    raw = _json(payload)
    if len(raw.encode()) > MAX_LOG_BYTES:
        payload = {"id": payload.get("id"), "ts": payload.get("ts"), "kind": payload.get("kind"), "note": _excerpt(payload.get("note"), 80), "global_throttle": payload["global_throttle"]}
        raw = _json(payload)
    path = logs / f"{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}.json"
    path.write_text(raw + "\n", encoding="utf-8")
    existing = sorted(logs.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    for stale in existing[MAX_LOG_KEEP:]:
        stale.unlink(missing_ok=True)
    return path


def _record_tokens(kind: str, tokens: int, note: str = "") -> dict[str, Any]:
    with _conn() as conn:
        rows = [int(r[0]) for r in conn.execute("SELECT tokens FROM token_writes WHERE kind = ? ORDER BY ts DESC LIMIT 20", (kind,)).fetchall()]
    avg = (sum(rows) / len(rows)) if rows else 0
    spike = bool(tokens > max(400, int((avg or 1) * TOKEN_SPIKE_RATIO)))
    row = {"id": uuid.uuid4().hex, "ts": now(), "kind": kind, "tokens": int(tokens), "spike": spike, "note": _excerpt(note, 160)}
    with _conn() as conn:
        conn.execute("INSERT INTO token_writes VALUES (?,?,?,?,?,?)", (row["id"], row["ts"], kind, row["tokens"], int(spike), row["note"]))
    if spike:
        _alert("log.throttle", "high", f"{kind} token write spiked ({tokens} vs avg {int(avg)})", {"kind": kind, "tokens": tokens, "avg": int(avg)})
    return row


def _alert(kind: str, priority: str, message: str, fields: dict[str, Any] | None = None) -> dict[str, Any]:
    row = {"id": uuid.uuid4().hex, "ts": now(), "kind": kind, "priority": priority, "message": _excerpt(message, 240), "fields": _object(fields or {})}
    with _conn() as conn:
        conn.execute("INSERT INTO alerts VALUES (?,?,?,?,?,?)", (row["id"], row["ts"], kind, priority, row["message"], _json(row["fields"])))
    return row


def search_ids(query: str, *, limit: int = 40) -> dict[str, Any]:
    needle = str(query or "").strip().lower()
    if len(needle) < 2:
        raise ValueError("q must be at least 2 characters")
    limit = max(1, min(int(limit), 80))
    hits: list[dict[str, Any]] = []
    try:
        from backend.services import incident_intelligence_service as incident

        wrapped = incident.search_chat_logs(query, limit=limit)
        for hit in wrapped.get("hits") or []:
            hits.append({
                "id": hit.get("log_id"),
                "source": "prompt-trace",
                "result": hit.get("result"),
                "excerpt": _excerpt(hit.get("prompt")),
                "blamed_log_id": hit.get("blamed_log_id"),
                "timestamp": hit.get("timestamp"),
            })
    except Exception:
        pass
    with _conn() as conn:
        for table, cols in (
            ("scores", "id, log_id, prompt_id, notes, label, ts"),
            ("bugs", "id, name, feature, prompt, root_cause, ts"),
            ("notes", "id, title, body, audience, ts"),
        ):
            rows = conn.execute(f"SELECT {cols} FROM {table} ORDER BY ts DESC LIMIT 200").fetchall()
            for row in rows:
                blob = " ".join(str(row[k]) for k in row.keys()).lower()
                if needle not in blob:
                    continue
                data = dict(row)
                hits.append({
                    "id": data.get("id") or data.get("log_id"),
                    "source": table,
                    "result": data.get("label") or data.get("feature") or data.get("audience"),
                    "excerpt": _excerpt(data.get("notes") or data.get("prompt") or data.get("title") or data.get("body")),
                    "blamed_log_id": data.get("prompt_id") or data.get("log_id"),
                    "timestamp": data.get("ts"),
                })
                if len(hits) >= limit:
                    break
            if len(hits) >= limit:
                break
    compact = hits[:limit]
    for hit in compact:
        if len(str(hit.get("excerpt") or "")) > EXCERPT_CAP:
            hit["excerpt"] = _excerpt(hit.get("excerpt"))
    return {"ok": True, "q": query, "count": len(compact), "hits": compact}


def request_cli(data: dict[str, Any]) -> dict[str, Any]:
    key = str(data.get("command_key") or data.get("command") or "").strip()
    if data.get("readonly") or key.startswith("ro_") or key.split()[0] in {"ls", "pwd", "date", "wc", "head"} if key else False:
        from backend.services import debugger_swarm_service as dss

        return dss.request_readonly_cli(data if isinstance(data, dict) else {"command": key})
    raw = key
    if re.search(r"\b(rm|sudo|git)\b|[|;&]", raw, re.I):
        raise ValueError("CLI rejects rm, sudo, git, and pipes")
    if key not in CLI_ALLOWLIST:
        raise ValueError(f"command_key must be one of: {', '.join(sorted(CLI_ALLOWLIST))} or a readonly ls/pwd/date/wc/head")
    argv = CLI_ALLOWLIST[key]
    row = {
        "id": uuid.uuid4().hex,
        "ts": now(),
        "status": "pending_approval",
        "command_key": key,
        "argv": argv or ["listdir", "ai-context/debugger"],
        "note": _excerpt(data.get("note"), 240),
        "output_excerpt": "",
    }
    with _conn() as conn:
        conn.execute("INSERT INTO cli_requests VALUES (?,?,?,?,?,?,?)", (row["id"], row["ts"], row["status"], key, _json(row["argv"]), row["note"], ""))
    return row


def approve_cli(cli_id: str, *, approve: bool = True) -> dict[str, Any]:
    row = get_cli(cli_id)
    if not row:
        raise ValueError("CLI request not found")
    status = "approved" if approve else "denied"
    with _conn() as conn:
        conn.execute("UPDATE cli_requests SET status = ? WHERE id = ?", (status, cli_id))
    row["status"] = status
    return row


def run_cli(cli_id: str) -> dict[str, Any]:
    row = get_cli(cli_id)
    if not row:
        raise ValueError("CLI request not found")
    if row["status"] != "approved":
        raise ValueError("CLI request is not approved")
    key = row["command_key"]
    excerpt = ""
    if str(key or "").startswith("ro_"):
        from backend.services import debugger_swarm_service as dss

        return dss.run_readonly_cli(cli_id)
    if key == "list_debugger":
        root = ROOT_DIR / "ai-context" / "debugger"
        names = sorted(p.name for p in root.iterdir())[:40] if root.is_dir() else []
        excerpt = _excerpt(", ".join(names), 240)
    else:
        argv = CLI_ALLOWLIST.get(key)
        if not argv:
            raise ValueError("command is not allowlisted")
        completed = subprocess.run(argv, cwd=str(ROOT_DIR), capture_output=True, text=True, timeout=15, check=False)
        excerpt = _excerpt((completed.stdout or completed.stderr or "")[:400], 240)
    with _conn() as conn:
        conn.execute("UPDATE cli_requests SET status = 'ran', output_excerpt = ? WHERE id = ?", (excerpt, cli_id))
    row["status"] = "ran"
    row["output_excerpt"] = excerpt
    return row


def get_cli(cli_id: str) -> dict[str, Any] | None:
    with _conn() as conn:
        return _row(conn.execute("SELECT * FROM cli_requests WHERE id = ?", (cli_id,)).fetchone())


def list_cli(limit: int = 30) -> list[dict[str, Any]]:
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM cli_requests ORDER BY ts DESC LIMIT ?", (max(1, min(limit, 80)),)).fetchall()
    return [_row(r) for r in rows]


def _watchdog_folder(wid: str) -> Path:
    folder = WATCHDOG_ROOT / wid
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "logs").mkdir(exist_ok=True)
    mirror = DATA_WATCHDOG_ROOT / wid
    mirror.mkdir(parents=True, exist_ok=True)
    return folder


def draft_watchdog(data: dict[str, Any]) -> dict[str, Any]:
    wid = uuid.uuid4().hex
    spec = _object(data.get("spec") or {"kind": data.get("kind") or "log", "paths": data.get("paths") or []})
    spec["pending_sam_approval"] = True
    spec["never_auto_run"] = True
    spec["prune"] = {"keep": MAX_LOG_KEEP, "max_bytes": MAX_LOG_BYTES}
    folder = _watchdog_folder(wid)
    row = {
        "id": wid,
        "ts": now(),
        "status": "pending_approval",
        "title": _excerpt(data.get("title") or "Temporary watchdog", 120),
        "kind": _excerpt(data.get("kind") or "log", 40),
        "spec": spec,
        "folder": str(folder.relative_to(ROOT_DIR)),
        "throttle_cause": "",
        "helped": False,
        "note": _excerpt(data.get("note"), 240),
    }
    (folder / "spec.json").write_text(json.dumps(row, indent=2) + "\n", encoding="utf-8")
    (folder / "README.md").write_text(
        f"# Draft watchdog {wid}\n\nStatus: **pending Sam approval**. Do not run. Do not install a systemd unit.\n",
        encoding="utf-8",
    )
    _write_minilog(folder, {"id": wid, "ts": row["ts"], "kind": "draft", "note": row["note"]})
    with _conn() as conn:
        conn.execute(
            "INSERT INTO watchdogs VALUES (?,?,?,?,?,?,?,?,?,?)",
            (wid, row["ts"], row["status"], row["title"], row["kind"], _json(spec), row["folder"], "", 0, row["note"]),
        )
    return row


def get_watchdog(wid: str) -> dict[str, Any] | None:
    with _conn() as conn:
        return _row(conn.execute("SELECT * FROM watchdogs WHERE id = ?", (wid,)).fetchone())


def list_watchdogs(limit: int = 40) -> list[dict[str, Any]]:
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM watchdogs ORDER BY ts DESC LIMIT ?", (max(1, min(limit, 80)),)).fetchall()
    return [_row(r) for r in rows]


def approve_watchdog(wid: str, *, approve: bool = True) -> dict[str, Any]:
    row = get_watchdog(wid)
    if not row:
        raise ValueError("watchdog not found")
    status = "approved" if approve else "retired"
    with _conn() as conn:
        conn.execute("UPDATE watchdogs SET status = ? WHERE id = ?", (status, wid))
    folder = ROOT_DIR / row["folder"]
    if folder.is_dir():
        readme = folder / "README.md"
        readme.write_text(f"# Watchdog {wid}\n\nStatus: **{status}**.\n", encoding="utf-8")
        _write_minilog(folder, {"id": wid, "ts": now(), "kind": "approval", "note": status})
    row["status"] = status
    return row


def start_watchdog(wid: str) -> dict[str, Any]:
    row = get_watchdog(wid)
    if not row:
        raise ValueError("watchdog not found")
    if row["status"] not in {"approved", "running"}:
        raise ValueError("draft watchdog cannot run until Sam approves it")
    with _conn() as conn:
        conn.execute("UPDATE watchdogs SET status = 'running' WHERE id = ?", (wid,))
    folder = ROOT_DIR / row["folder"]
    _write_minilog(folder, {"id": wid, "ts": now(), "kind": "start", "note": "running after approval"})
    row["status"] = "running"
    return row


def record_usage(wid: str, *, bytes_n: int, requests: int = 1, seconds: float = 1.0) -> dict[str, Any]:
    row = get_watchdog(wid)
    if not row:
        raise ValueError("watchdog not found")
    seconds = max(float(seconds or 1.0), 0.1)
    with _conn() as conn:
        conn.execute(
            "INSERT INTO usage VALUES (?,?,?,?,?,?)",
            (uuid.uuid4().hex, now(), wid, int(bytes_n), int(requests), seconds),
        )
    bps = int(bytes_n) / seconds
    rps = int(requests) / seconds
    if bps > BYTES_PER_SEC_LIMIT or rps > REQUESTS_PER_SEC_LIMIT:
        return throttle_watchdog(wid, cause=f"bytes/sec={bps:.0f} requests/sec={rps:.1f}")
    folder = ROOT_DIR / row["folder"]
    if folder.is_dir():
        _write_minilog(folder, {"id": wid, "ts": now(), "kind": "usage", "note": f"{int(bytes_n)}B/{seconds:.1f}s"})
    return {"ok": True, "id": wid, "bytes_per_sec": round(bps, 1), "throttled": False}


def throttle_watchdog(wid: str, *, cause: str) -> dict[str, Any]:
    row = get_watchdog(wid)
    if not row:
        raise ValueError("watchdog not found")
    note = _excerpt(cause, 240)
    with _conn() as conn:
        conn.execute("UPDATE watchdogs SET status = 'throttled', throttle_cause = ? WHERE id = ?", (note, wid))
    folder = ROOT_DIR / row["folder"]
    if folder.is_dir():
        spec_path = folder / "spec.json"
        spec = json.loads(spec_path.read_text(encoding="utf-8")) if spec_path.is_file() else {}
        offending = spec.pop("noisy_paths", None) or spec.pop("poll_ms", None)
        spec["optimized"] = True
        spec["removed"] = offending or "high-rate log writer"
        spec["throttle_cause"] = note
        spec_path.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
        _write_minilog(folder, {"id": wid, "ts": now(), "kind": "throttled", "note": note})
    analysis = post_analysis({
        "worked": "",
        "failed": "watchdog throttled the network",
        "method": "global.watchdog.throttle",
        "feature": "debugger.logs",
        "token_cost": 0,
        "throttle": True,
        "watchdog_id": wid,
    })
    _alert("log.throttle", "high", f"watchdog {wid} throttled: {note}", {"watchdog_id": wid})
    row["status"] = "throttled"
    row["throttle_cause"] = note
    row["analysis_id"] = analysis["id"]
    return row


def prune_watchdog(wid: str) -> dict[str, Any]:
    row = get_watchdog(wid)
    if not row:
        raise ValueError("watchdog not found")
    folder = ROOT_DIR / row["folder"] / "logs"
    removed = 0
    if folder.is_dir():
        files = sorted(folder.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        cutoff = datetime.now(timezone.utc) - timedelta(hours=48)
        keep: list[Path] = []
        for path in files:
            stale = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc) < cutoff
            if stale or len(keep) >= MAX_LOG_KEEP:
                path.unlink(missing_ok=True)
                removed += 1
            else:
                keep.append(path)
    with _conn() as conn:
        conn.execute("UPDATE watchdogs SET status = 'pruned' WHERE id = ? AND status IN ('retired','throttled')", (wid,))
    result = {"ok": True, "id": wid, "removed": removed}
    try:
        from backend.services import debugger_metrics_service as dms

        result["archive"] = dms.archive_watchdog(wid, worked=bool(row.get("helped")), upload_drive=False)
    except Exception:
        pass
    return result


def mark_watchdog_helped(wid: str) -> dict[str, Any]:
    row = get_watchdog(wid)
    if not row:
        raise ValueError("watchdog not found")
    with _conn() as conn:
        conn.execute("UPDATE watchdogs SET helped = 1 WHERE id = ?", (wid,))
    notes = write_architecture_notes(wid, row)
    row["helped"] = True
    row["architecture_notes"] = notes
    return row


def write_architecture_notes(wid: str, watchdog: dict[str, Any] | None = None) -> dict[str, Any]:
    watchdog = watchdog or get_watchdog(wid) or {}
    NOTES_ROOT.mkdir(parents=True, exist_ok=True)
    token_total = 0
    written = {}
    bodies = {
        "grok": f"Watchdog {wid} helped. Status {watchdog.get('status')}. Kind {watchdog.get('kind')}. Folder {watchdog.get('folder')}. Use search_ids, not full logs.",
        "harness": f"id:{wid} helped=1 kind:{watchdog.get('kind')} folder:{watchdog.get('folder')}",
        "human": f"Temporary watchdog {wid} ({watchdog.get('title')}) helped isolate the issue. Drafts still need Sam approval next time.",
    }
    for audience, body in bodies.items():
        nid = uuid.uuid4().hex
        tokens = estimate_tokens(body)
        token_total += tokens
        path = NOTES_ROOT / f"{wid}-{audience}.md"
        path.write_text(f"# {audience} · {wid}\n\n{body}\n", encoding="utf-8")
        with _conn() as conn:
            conn.execute(
                "INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?)",
                (nid, now(), audience, f"watchdog {wid}", body, tokens, wid, "", f"{audience}:{wid}"),
            )
        written[audience] = {"id": nid, "path": str(path.relative_to(ROOT_DIR)), "token_cost": tokens}
    _record_tokens("architecture", token_total, f"watchdog {wid}")
    return written


def post_analysis(data: dict[str, Any]) -> dict[str, Any]:
    tokens = int(data.get("token_cost") or estimate_tokens(_json(data)))
    row = {
        "id": uuid.uuid4().hex,
        "ts": now(),
        "worked": _excerpt(data.get("worked"), 240),
        "failed": _excerpt(data.get("failed"), 240),
        "method": _excerpt(data.get("method") or "unknown", 80),
        "feature": _excerpt(data.get("feature") or "debugger.logs", 80),
        "token_cost": tokens,
        "throttle": bool(data.get("throttle")),
        "watchdog_id": str(data.get("watchdog_id") or "")[:32],
    }
    with _conn() as conn:
        conn.execute(
            "INSERT INTO analysis VALUES (?,?,?,?,?,?,?,?,?)",
            (row["id"], row["ts"], row["worked"], row["failed"], row["method"], row["feature"], tokens, int(row["throttle"]), row["watchdog_id"]),
        )
        if row["failed"]:
            conn.execute(
                "INSERT INTO patterns(method,negative,positive,note) VALUES(?,?,?,?) ON CONFLICT(method) DO UPDATE SET negative = negative + 1",
                (row["method"], 1, 0, row["failed"]),
            )
        if row["worked"]:
            conn.execute(
                "INSERT INTO patterns(method,negative,positive,note) VALUES(?,?,?,?) ON CONFLICT(method) DO UPDATE SET positive = positive + 1",
                (row["method"], 0, 1, row["worked"]),
            )
    _record_tokens("analysis", tokens, row["method"])
    return row


def list_analysis(limit: int = 30) -> list[dict[str, Any]]:
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM analysis ORDER BY ts DESC LIMIT ?", (max(1, min(limit, 80)),)).fetchall()
    return [_row(r) for r in rows]


def post_note(data: dict[str, Any]) -> dict[str, Any]:
    body = _excerpt(data.get("body"), 400)
    tokens = estimate_tokens(body)
    row = {
        "id": uuid.uuid4().hex,
        "ts": now(),
        "audience": _excerpt(data.get("audience") or "grok", 20),
        "title": _excerpt(data.get("title") or "note", 80),
        "body": body,
        "token_cost": tokens,
        "watchdog_id": str(data.get("watchdog_id") or "")[:32],
        "bug_id": str(data.get("bug_id") or "")[:32],
        "indexed": _excerpt(data.get("indexed") or data.get("title"), 80),
    }
    with _conn() as conn:
        conn.execute("INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?)", (row["id"], row["ts"], row["audience"], row["title"], body, tokens, row["watchdog_id"], row["bug_id"], row["indexed"]))
    _record_tokens("note", tokens, row["title"])
    return row


def list_notes(limit: int = 30) -> list[dict[str, Any]]:
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM notes ORDER BY ts DESC LIMIT ?", (max(1, min(limit, 80)),)).fetchall()
    return [_row(r) for r in rows]


def _store_ref(kind: str, members: list[dict[str, str]], extra: dict[str, Any] | None = None) -> dict[str, Any]:
    composite = encode_tracking_id(members)
    prefix = "res_" if kind == "result" else "ref_"
    rid = prefix + uuid.uuid4().hex[:12]
    extra = extra or {}
    path = SCORE_ROOT
    path.mkdir(parents=True, exist_ok=True)
    packed = len(composite) > TRACKING_ID_CAP
    payload = {"id": rid, "kind": kind, "composite": composite, "members": members, "packed": packed, **extra}
    (path / f"{rid}.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    with _conn() as conn:
        conn.execute("INSERT INTO refs VALUES (?,?,?,?,?,?)", (rid, now(), kind, composite, _json(members), _json(extra)))
    return {"id": rid, "composite": rid if packed else composite, "full_composite": composite, "packed": packed, "members": members, **extra}


def get_ref(ref_id: str) -> dict[str, Any] | None:
    with _conn() as conn:
        row = _row(conn.execute("SELECT * FROM refs WHERE id = ?", (ref_id,)).fetchone())
    if row:
        row["extra"] = row.get("extra") or {}
        return row
    return None


def record_score(data: dict[str, Any]) -> dict[str, Any]:
    if data.get("score") is None and data.get("desired_score") is None:
        mapped = {"broke": 10, "partial": 40, "continued": 50, "improved": 75, "unknown": 50, "exceeded": 90}
        raw_score = mapped.get(str(data.get("result") or "").lower(), 50)
    else:
        raw_score = data.get("score") if data.get("score") is not None else data.get("desired_score")
    score = int(raw_score)
    if score < 0 or score > 100:
        raise ValueError("score must be 0-100")
    label = str(data.get("label") or score_label(score))
    if label not in {item[1] for item in SCORE_LABELS}:
        raise ValueError("label must be missed, partial, achieved, or exceeded")
    features = _features(data.get("features") or data.get("system_check") or {})
    broken = _ids(data.get("broken") or [k for k, v in features.items() if v in BROKEN])
    fixed = _ids(data.get("fixed") or [])
    steps = _steps(data.get("steps"))
    log_id = str(data.get("log_id") or "")[:80]
    prompt_id = str(data.get("prompt_id") or data.get("prompt") or "")[:80]
    project_id = str(data.get("project_id") or data.get("project") or "")[:80]
    instance_id = str(data.get("instance_id") or "")[:80]
    if project_id and instance_id:
        from backend.services.debugger_privilege_service import compose_project_id

        project_id = compose_project_id(project_id, instance_id)
    traceback_ids = _ids(data.get("traceback_ids"))
    token_cost = int(data.get("token_cost") or 0)
    duration_s = float(data.get("duration_s") or data.get("seconds") or 0)
    members: list[dict[str, str]] = []
    for pid in _ids(data.get("project_ids") or ([project_id] if project_id else [])):
        members.append({"kind": "project", "id": pid})
    if log_id and MEMBER_ID_RE.fullmatch(log_id):
        members.append({"kind": "log", "id": log_id})
    if prompt_id and MEMBER_ID_RE.fullmatch(prompt_id):
        members.append({"kind": "prompt", "id": prompt_id})
    for tb in traceback_ids:
        members.append({"kind": "tb", "id": tb})
    tracking_id = ""
    result_ref = ""
    extra_ref = None
    significant = score >= HIGH_SCORE or len(broken) >= MULTI_FEATURE or len(fixed) >= MULTI_FEATURE
    if significant and members:
        extra_ref = _store_ref("tracking", members, {"traceback_ids": traceback_ids, "log_ids": [log_id] if log_id else [], "prompt_ids": [prompt_id] if prompt_id else []})
        tracking_id = extra_ref["composite"]
    if token_cost or duration_s:
        with _conn() as conn:
            prev = conn.execute("SELECT token_cost, duration_s FROM scores ORDER BY ts DESC LIMIT 20").fetchall()
        token_avg = (sum(int(r["token_cost"] or 0) for r in prev) / len(prev)) if prev else 0
        time_avg = (sum(float(r["duration_s"] or 0) for r in prev) / len(prev)) if prev else 0
        token_delta = ((token_cost - token_avg) / token_avg) if token_avg else 0
        time_delta = ((duration_s - time_avg) / time_avg) if time_avg else 0
        if abs(token_delta) >= TOKEN_DELTA or abs(time_delta) >= TOKEN_DELTA:
            direction = "improved" if token_delta < 0 or time_delta < 0 else "damaged"
            result_ref = _store_ref("result", members or [{"kind": "log", "id": log_id or "live"}], {
                "direction": direction,
                "token_delta": round(token_delta, 3),
                "time_delta": round(time_delta, 3),
                "score": score,
            })["id"]
    sid = uuid.uuid4().hex
    row = {
        "id": sid,
        "ts": now(),
        "log_id": log_id,
        "prompt_id": prompt_id,
        "project_id": project_id,
        "score": score,
        "label": label,
        "features": features,
        "broken": broken,
        "fixed": fixed,
        "steps": steps,
        "tracking_id": tracking_id,
        "result_ref": result_ref,
        "token_cost": token_cost,
        "duration_s": duration_s,
        "notes": _excerpt(data.get("notes"), 240),
        "ref_id": (extra_ref or {}).get("id") or "",
    }
    SCORE_ROOT.mkdir(parents=True, exist_ok=True)
    (SCORE_ROOT / f"{sid}.json").write_text(_json({k: row[k] for k in row if k != "notes"}) + "\n", encoding="utf-8")
    with _conn() as conn:
        conn.execute(
            "INSERT INTO scores VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (sid, row["ts"], log_id, prompt_id, project_id, score, label, _json(features), _json(broken), _json(fixed), _json(steps), tracking_id, result_ref, token_cost, duration_s, row["notes"]),
        )
    if token_cost:
        _record_tokens("score", token_cost, log_id)
    try:
        from backend.services import debugger_privilege_service as dps

        row.update(dps.note_score(row, data))
    except Exception:
        pass
    try:
        from backend.services import debugger_metrics_service as dms

        row.update(dms.note_score(row, data))
    except Exception:
        pass
    try:
        from backend.services import debugger_swarm_service as dss

        row.update(dss.ingest_live_outcome(data, row))
    except Exception:
        pass
    try:
        from backend.services import debugger_cost_service as dcs

        closed = dcs.maybe_close_from_score(row, data)
        if closed:
            row["cost_report"] = closed
    except Exception:
        pass
    return row


def list_scores(limit: int = 40) -> list[dict[str, Any]]:
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM scores ORDER BY ts DESC LIMIT ?", (max(1, min(limit, 80)),)).fetchall()
    return [_row(r) for r in rows]


def get_score(score_id: str) -> dict[str, Any] | None:
    with _conn() as conn:
        return _row(conn.execute("SELECT * FROM scores WHERE id = ?", (score_id,)).fetchone())


def _collateral_breakage(before: dict[str, str], after: dict[str, str]) -> int:
    count = 0
    for feature, status in after.items():
        if status in BROKEN and before.get(feature) in OK:
            count += 1
    return count


def create_bug(data: dict[str, Any]) -> dict[str, Any]:
    solved = bool(data.get("solved"))
    root = _excerpt(data.get("root_cause") or data.get("root"), 400)
    features = _features(data.get("features") or {})
    before = _features(data.get("before_features") or {})
    after = _features(data.get("after_features") or features)
    breakage = int(data.get("breakage") if data.get("breakage") is not None else _collateral_breakage(before, after))
    if not solved or not root or breakage != 0:
        raise ValueError("Bug id is only published after a confirmed root cause with a verified fix and no collateral breakage")
    name = _excerpt(data.get("name") or data.get("title") or "confirmed-fix", 80)
    feature = _feature(data.get("feature") or next(iter(features), "debugger.logs"))
    bid = "bug_" + uuid.uuid4().hex[:10]
    folder = BUG_ROOT / bid
    folder.mkdir(parents=True, exist_ok=True)
    prompt = _excerpt(data.get("prompt"), 120)
    sam_body = "\n".join([
        f"Bug {bid} — {name}",
        f"Root cause: {root}",
        f"Feature: {feature}",
        f"Vector: {_json(features)}",
        f"Prompt excerpt: {prompt}",
        "Solved with no collateral breakage.",
        f"Watchdog: {data.get('watchdog_id') or 'none'}",
    ])
    grok_body = "\n".join([
        f"bug_id: {bid}",
        f"name: {name}",
        f"feature: {feature}",
        f"root: {root}",
        "actions: search_ids, ping, notes. Do not dump logs.",
    ])
    harness_body = "\n".join([
        f"id: {bid}",
        f"name: {name}",
        f"features: {_json(features)}",
        "ping: GET /api/ops/debugger-analytics/bugs/{id}/instances",
    ])
    (folder / "sam.pdf").write_bytes(pdf_bytes(f"Sam · {bid}", sam_body))
    (folder / "grok.pdf").write_bytes(pdf_bytes(f"Grok · {bid}", grok_body))
    (folder / "harness.pdf").write_bytes(pdf_bytes(f"Harness · {bid}", harness_body))
    tokens = estimate_tokens(sam_body + grok_body + harness_body)
    rel = str(folder.relative_to(ROOT_DIR))
    row = {
        "id": bid,
        "name": name,
        "ts": now(),
        "feature": feature,
        "features": features,
        "prompt": prompt,
        "root_cause": root,
        "solved": True,
        "breakage": 0,
        "pdf_sam": f"{rel}/sam.pdf",
        "pdf_grok": f"{rel}/grok.pdf",
        "pdf_harness": f"{rel}/harness.pdf",
        "watchdog_id": str(data.get("watchdog_id") or "")[:32],
        "token_cost": tokens,
    }
    with _conn() as conn:
        conn.execute(
            "INSERT INTO bugs VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (bid, name, row["ts"], feature, _json(features), prompt, root, 1, 0, row["pdf_sam"], row["pdf_grok"], row["pdf_harness"], row["watchdog_id"], tokens),
        )
    instance_id = str(data.get("instance_id") or _local_instance_id())
    report_instance(bid, {"instance_id": instance_id, "features": features, "prompt": prompt})
    if row["watchdog_id"]:
        try:
            mark_watchdog_helped(row["watchdog_id"])
        except ValueError:
            pass
    _record_tokens("bug", tokens, bid)
    return row


def get_bug(bug_id: str) -> dict[str, Any] | None:
    with _conn() as conn:
        return _row(conn.execute("SELECT * FROM bugs WHERE id = ?", (bug_id,)).fetchone())


def list_bugs(limit: int = 30) -> list[dict[str, Any]]:
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM bugs ORDER BY ts DESC LIMIT ?", (max(1, min(limit, 80)),)).fetchall()
    return [_row(r) for r in rows]


def _local_instance_id() -> str:
    try:
        from backend.services import debug_training_service as dts

        ident = dts.local_identity()
        return str((ident or {}).get("instance_id") or "local")
    except Exception:
        return "local"


def report_instance(bug_id: str, data: dict[str, Any]) -> dict[str, Any]:
    bug = get_bug(bug_id)
    if not bug:
        raise ValueError("bug not found")
    features = _features(data.get("features") or {})
    cmp = compare_feature_vectors(bug.get("features") or {}, features)
    row = {
        "id": uuid.uuid4().hex,
        "bug_id": bug_id,
        "instance_id": str(data.get("instance_id") or _local_instance_id())[:80],
        "ts": now(),
        "features": features,
        "similar": cmp["similar"],
        "similarity": cmp["similarity"],
        "prompt": _excerpt(data.get("prompt"), 120),
    }
    with _conn() as conn:
        conn.execute(
            "INSERT INTO bug_instances VALUES (?,?,?,?,?,?,?,?)",
            (row["id"], bug_id, row["instance_id"], row["ts"], _json(features), int(cmp["similar"]), cmp["similarity"], row["prompt"]),
        )
    return {**row, **cmp}


def ping_bug(bug_id: str) -> dict[str, Any]:
    bug = get_bug(bug_id)
    if not bug:
        raise ValueError("bug not found")
    with _conn() as conn:
        rows = [_row(r) for r in conn.execute("SELECT * FROM bug_instances WHERE bug_id = ? ORDER BY ts DESC", (bug_id,)).fetchall()]
    similar_rows = [r for r in rows if r.get("similar")]
    return {
        "ok": True,
        "bug_id": bug_id,
        "name": bug["name"],
        "feature": bug["feature"],
        "features": bug.get("features") or {},
        "instance_count": len({r["instance_id"] for r in rows}) or 1,
        "similar_instance_count": len({r["instance_id"] for r in similar_rows}),
        "instances": [{"instance_id": r["instance_id"], "similar": r.get("similar"), "similarity": r.get("similarity")} for r in rows[:20]],
        "note": "Count stays 1 until other Render instances report in.",
    }


def propose_skill(data: dict[str, Any]) -> dict[str, Any]:
    rel = str(data.get("path") or "").strip().lstrip("/")
    if ".." in rel or not rel.endswith("SKILL.md"):
        raise ValueError("skill path must be a SKILL.md under an allowlisted skills folder")
    target = (ROOT_DIR / rel).resolve()
    allowed = False
    for root in SKILL_WRITE_ROOTS:
        try:
            target.relative_to(root.resolve())
            allowed = True
            break
        except ValueError:
            continue
    if not allowed:
        raise ValueError("skill path is outside the allowlisted skills folders")
    body = str(data.get("body") or "")
    if len(body.encode()) > 20_000:
        raise ValueError("skill draft is too large")
    row = {
        "id": uuid.uuid4().hex,
        "ts": now(),
        "path": rel,
        "body": body,
        "status": "pending_approval",
        "approval_count": 0,
        "confirmed_solves": 0,
        "breakage": 0,
        "note": _excerpt(data.get("note"), 240),
    }
    with _conn() as conn:
        conn.execute(
            "INSERT INTO skill_proposals VALUES (?,?,?,?,?,?,?,?,?)",
            (row["id"], row["ts"], row["path"], body, row["status"], 0, 0, 0, row["note"]),
        )
    return {k: row[k] for k in row if k != "body"} | {"body_chars": len(body)}


def get_skill(sid: str) -> dict[str, Any] | None:
    with _conn() as conn:
        return _row(conn.execute("SELECT * FROM skill_proposals WHERE id = ?", (sid,)).fetchone())


def approve_skill(sid: str) -> dict[str, Any]:
    row = get_skill(sid)
    if not row:
        raise ValueError("skill proposal not found")
    count = int(row["approval_count"]) + 1
    with _conn() as conn:
        conn.execute("UPDATE skill_proposals SET approval_count = ? WHERE id = ?", (count, sid))
    row["approval_count"] = count
    return {k: row[k] for k in row if k != "body"}


def confirm_skill_solve(sid: str, *, breakage: int = 0) -> dict[str, Any]:
    row = get_skill(sid)
    if not row:
        raise ValueError("skill proposal not found")
    solves = int(row["confirmed_solves"]) + 1
    with _conn() as conn:
        conn.execute("UPDATE skill_proposals SET confirmed_solves = ?, breakage = breakage + ? WHERE id = ?", (solves, int(breakage), sid))
    row["confirmed_solves"] = solves
    row["breakage"] = int(row["breakage"]) + int(breakage)
    return {k: row[k] for k in row if k != "body"}


def apply_skill(sid: str) -> dict[str, Any]:
    row = get_skill(sid)
    if not row:
        raise ValueError("skill proposal not found")
    if int(row["approval_count"]) < SKILL_THRESHOLD or int(row["confirmed_solves"]) < SKILL_THRESHOLD or int(row["breakage"]) != 0:
        raise ValueError(f"skill stays pending until {SKILL_THRESHOLD} Sam approvals and {SKILL_THRESHOLD} confirmed no-breakage solves")
    path = ROOT_DIR / row["path"]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(row["body"], encoding="utf-8")
    with _conn() as conn:
        conn.execute("UPDATE skill_proposals SET status = 'applied' WHERE id = ?", (sid,))
    return {"ok": True, "id": sid, "path": row["path"], "status": "applied"}


def list_skill_proposals(limit: int = 20) -> list[dict[str, Any]]:
    with _conn() as conn:
        rows = conn.execute("SELECT id,ts,path,status,approval_count,confirmed_solves,breakage,note FROM skill_proposals ORDER BY ts DESC LIMIT ?", (max(1, min(limit, 40)),)).fetchall()
    return [dict(r) for r in rows]


def weekly_report(week_start: str | None = None) -> dict[str, Any]:
    if week_start:
        start = datetime.fromisoformat(week_start).replace(tzinfo=timezone.utc)
    else:
        today = datetime.now(timezone.utc)
        start = (today - timedelta(days=today.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    end = start + timedelta(days=7)
    since, until = start.isoformat(), end.isoformat()
    with _conn() as conn:
        scores = [dict(r) for r in conn.execute("SELECT * FROM scores WHERE ts >= ? AND ts < ?", (since, until))]
        analysis = [dict(r) for r in conn.execute("SELECT * FROM analysis WHERE ts >= ? AND ts < ?", (since, until))]
        patterns = [dict(r) for r in conn.execute("SELECT * FROM patterns")]
        bugs = [dict(r) for r in conn.execute("SELECT * FROM bugs WHERE ts >= ? AND ts < ?", (since, until))]
        tokens = [dict(r) for r in conn.execute("SELECT * FROM token_writes WHERE ts >= ? AND ts < ?", (since, until))]
    improved = sum(1 for s in scores if s["label"] in {"achieved", "exceeded"})
    slowed = sum(1 for s in scores if s["label"] == "missed")
    chart = [
        {"key": "improved", "value": improved},
        {"key": "slowed", "value": slowed},
        {"key": "bugs_published", "value": len(bugs)},
        {"key": "throttles", "value": sum(1 for a in analysis if a["throttle"])},
    ]
    avoid = [{"method": p["method"], "negative": p["negative"], "positive": p["positive"]} for p in patterns if p["negative"] >= 1]
    result = {
        "week_start": start.date().isoformat(),
        "week_end": end.date().isoformat(),
        "scores": len(scores),
        "improved": improved,
        "slowed": slowed,
        "bugs": len(bugs),
        "token_writes": len(tokens),
        "token_spikes": sum(1 for t in tokens if t["spike"]),
        "avg_score": round(sum(s["score"] for s in scores) / len(scores), 1) if scores else 0,
        "avoid_patterns": avoid,
        "chart": chart,
        "generated_at": now(),
    }
    REPORTS_ROOT.mkdir(parents=True, exist_ok=True)
    path = REPORTS_ROOT / f"week-{result['week_start']}.md"
    lines = [
        f"# Debugger analytics · week of {result['week_start']}",
        f"Improved outcomes: {improved}. Slowed / missed: {slowed}. Published bugs: {len(bugs)}.",
        f"Token spikes: {result['token_spikes']}.",
        "",
        "## Patterns to avoid",
    ]
    lines += [f"- {p['method']}: {p['negative']} negative / {p['positive']} positive" for p in avoid] or ["- none yet"]
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    result["report_path"] = str(path.relative_to(ROOT_DIR))
    try:
        from backend.services import debugger_privilege_service as dps

        extra = dps.weekly_addon()
        result.update(extra)
        safe = extra.get("proven_safe") or []
        bans = extra.get("privilege_bans") or []
        extra_lines = ["", "## Proven safe"]
        extra_lines += [f"- {p['method']} streak {p.get('good_streak')}" for p in safe] or ["- none"]
        extra_lines += ["", "## Privilege bans"]
        extra_lines += [f"- {p['method']}: {p.get('last_ban_reason')}" for p in bans] or ["- none"]
        extra_lines += ["", "## Logic", extra.get("logic", {}).get("proposal") or "- none"]
        extra_lines += ["", "## Daily vs prompt", f"daily {extra.get('daily', {}).get('avg_outcome')} · prompt {extra.get('prompt', {}).get('avg_outcome')}"]
        extra_lines += ["", "## Pending GitHub"]
        extra_lines += [f"- {i.get('id')} {i.get('project_id')} {i.get('log_chain')}" for i in extra.get("pending_github_issues") or []] or ["- none"]
        path.write_text(path.read_text(encoding="utf-8") + "\n".join(extra_lines) + "\n", encoding="utf-8")
    except Exception:
        pass
    try:
        from backend.services import debugger_metrics_service as dms

        extra = dms.weekly_addon()
        result.update(extra)
        extra_lines = ["", "## Suggestions"]
        extra_lines += [f"- {s.get('status')} {s.get('id')}: {s.get('proposal')}" for s in (extra.get("suggestions") or extra.get("suggestion_taken") or [])] or ["- none"]
        extra_lines += ["", "## Blacklist"]
        extra_lines += [f"- {b.get('method')} ({b.get('hits')})" for b in extra.get("blacklist") or []] or ["- none"]
        path.write_text(path.read_text(encoding="utf-8") + "\n".join(extra_lines) + "\n", encoding="utf-8")
    except Exception:
        pass
    try:
        from backend.services import debugger_cost_service as dcs

        extra = dcs.weekly_addon()
        result.update(extra)
        extra_lines = ["", "## Session cost"]
        extra_lines += [f"- {c.get('id')} tok {c.get('tokens_in')}/{c.get('tokens_out')} {c.get('duration_s')}s {c.get('currency')} vote {c.get('majority')}" for c in extra.get("cost_reports") or []] or ["- none"]
        path.write_text(path.read_text(encoding="utf-8") + "\n".join(extra_lines) + "\n", encoding="utf-8")
    except Exception:
        pass
    try:
        from backend.services import debugger_swarm_service as dss

        result["credit_rollups"] = dss.rollup_all_periods()
    except Exception:
        pass
    return result


def inbox(limit: int = 30) -> dict[str, Any]:
    payload = {
        "pending_watchdogs": [w for w in list_watchdogs(limit) if w["status"] == "pending_approval"],
        "pending_cli": [c for c in list_cli(limit) if c["status"] == "pending_approval"],
        "pending_skills": [s for s in list_skill_proposals(limit) if s["status"] == "pending_approval"],
        "alerts": list_alerts(limit),
        "allowlist": sorted(CLI_ALLOWLIST),
    }
    try:
        from backend.services import debugger_privilege_service as dps

        payload.update(dps.inbox_extra())
    except Exception:
        pass
    try:
        from backend.services import debugger_metrics_service as dms

        payload.update(dms.inbox_extra())
    except Exception:
        pass
    try:
        from backend.services import debugger_cost_service as dcs

        payload.update(dcs.inbox_extra())
    except Exception:
        pass
    return payload


def list_alerts(limit: int = 20) -> list[dict[str, Any]]:
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM alerts ORDER BY ts DESC LIMIT ?", (max(1, min(limit, 40)),)).fetchall()
    return [_row(r) for r in rows]


def _token_cost_overview() -> dict[str, Any]:
    with _conn() as conn:
        rows = conn.execute("SELECT * FROM token_writes ORDER BY ts DESC LIMIT 8").fetchall()
    return {
        "recent": [_row(r) for r in rows],
        "spikes": sum(1 for a in list_alerts(20) if a["kind"] == "log.throttle"),
    }


def overview() -> dict[str, Any]:
    weekly = weekly_report()
    scores = list_scores(8)
    result = {
        "pending": inbox(),
        "watchdogs": list_watchdogs(12),
        "cli": list_cli(8),
        "bugs": list_bugs(8),
        "scores": [{"id": s["id"], "log_id": s.get("log_id"), "score": s["score"], "label": s["label"], "tracking_id": s.get("tracking_id"), "result_ref": s.get("result_ref"), "outcome": s.get("outcome"), "damage_score": s.get("damage_score")} for s in scores],
        "alerts": list_alerts(8),
        "weekly": weekly,
        "token_cost": _token_cost_overview(),
        "allowlist": sorted(CLI_ALLOWLIST),
        "score_scale": {"min": 0, "max": 100, "labels": ["missed", "partial", "achieved", "exceeded"]},
        "similarity_threshold": {"broken_jaccard": 0.75, "status_jaccard": 0.5},
        "skill_threshold": SKILL_THRESHOLD,
        "metrics": {},
    }
    try:
        from backend.services import debugger_metrics_service as dms

        result["metrics"] = dms.overview_addon()
        result["taxonomy"] = dms.taxonomy()
    except Exception:
        pass
    try:
        from backend.services import debugger_swarm_service as dss

        result["swarm"] = dss.overview_addon()
    except Exception:
        pass
    return result
