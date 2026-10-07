"""Persistent hub registry for independently hosted Render Studio instances."""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from backend.config import settings
from backend.services import log_redact

_LOCK = threading.RLock()
_KINDS = {"support", "issue", "diagnostic", "bug", "suggestion"}
_SEVERITIES = {"low", "normal", "high", "critical"}
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$")
_NAMED_SECRET = re.compile(
    r"(?i)\b(token|api[_ -]?key|password|secret)\s*[:=]\s*([^\s,;]+)"
)


class InstanceAuthError(ValueError):
    pass


class UnknownInstanceError(LookupError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _db_path() -> Path:
    return Path(settings.data_dir).resolve() / "instance_network.sqlite3"


def _connect() -> sqlite3.Connection:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS instances (
            instance_id TEXT PRIMARY KEY,
            secret_hash TEXT NOT NULL,
            instance_name TEXT NOT NULL,
            public_network INTEGER NOT NULL DEFAULT 0,
            debug_opt_in INTEGER NOT NULL DEFAULT 0,
            user_count INTEGER NOT NULL DEFAULT 0,
            project_count INTEGER NOT NULL DEFAULT 0,
            storage_bytes INTEGER NOT NULL DEFAULT 0,
            users_backend TEXT NOT NULL DEFAULT '',
            git_sha TEXT NOT NULL DEFAULT '',
            runtime TEXT NOT NULL DEFAULT '',
            platform TEXT NOT NULL DEFAULT '',
            registered_at TEXT NOT NULL,
            last_seen TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS instance_daily (
            day TEXT NOT NULL,
            instance_id TEXT NOT NULL,
            user_count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (day, instance_id)
        );
        CREATE TABLE IF NOT EXISTS instance_submissions (
            id TEXT PRIMARY KEY,
            instance_id TEXT NOT NULL,
            client_token TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL,
            subject TEXT NOT NULL,
            message TEXT NOT NULL,
            severity TEXT NOT NULL,
            diagnostic TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            read_at TEXT,
            github_issue_number INTEGER,
            github_issue_url TEXT NOT NULL DEFAULT '',
            github_issue_state TEXT NOT NULL DEFAULT '',
            UNIQUE (instance_id, client_token)
        );
        CREATE INDEX IF NOT EXISTS idx_instance_submissions_created
            ON instance_submissions(created_at DESC);
        """
    )
    columns = {str(row[1]) for row in conn.execute("PRAGMA table_info(instance_submissions)")}
    for name, definition in (
        ("github_issue_number", "INTEGER"),
        ("github_issue_url", "TEXT NOT NULL DEFAULT ''"),
        ("github_issue_state", "TEXT NOT NULL DEFAULT ''"),
    ):
        if name not in columns:
            conn.execute(f"ALTER TABLE instance_submissions ADD COLUMN {name} {definition}")
    return conn


def _secret_hash(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def _identity(instance_id: str, instance_secret: str) -> tuple[str, str]:
    iid = str(instance_id or "").strip()
    secret = str(instance_secret or "").strip()
    if not _ID.fullmatch(iid) or len(secret) < 24 or len(secret) > 512:
        raise InstanceAuthError("Invalid instance credentials.")
    return iid, secret


def _text(value: Any, limit: int, *, one_line: bool = False) -> str:
    clean = log_redact.redact_text(str(value or "")).replace("\x00", "").strip()
    clean = _NAMED_SECRET.sub(r"\1=[redacted]", clean)
    if one_line:
        clean = " ".join(clean.split())
    return clean[:limit]


def _count(value: Any) -> int:
    try:
        return max(0, min(int(value or 0), 2_147_483_647))
    except (TypeError, ValueError):
        return 0


def _fields(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "instance_name": _text(payload.get("instance_name"), 80, one_line=True) or "Render Studio instance",
        "public_network": int(bool(payload.get("public_network"))),
        "debug_opt_in": int(bool(payload.get("debug_opt_in"))),
        "user_count": _count(payload.get("user_count")),
        "project_count": _count(payload.get("project_count")),
        "storage_bytes": _count(payload.get("storage_bytes")),
        "users_backend": _text(payload.get("users_backend"), 40, one_line=True),
        "git_sha": _text(payload.get("git_sha"), 40, one_line=True),
        "runtime": _text(payload.get("runtime"), 40, one_line=True),
        "platform": _text(payload.get("platform"), 20, one_line=True),
    }


def _authenticate(conn: sqlite3.Connection, instance_id: str, instance_secret: str) -> sqlite3.Row:
    iid, secret = _identity(instance_id, instance_secret)
    row = conn.execute("SELECT * FROM instances WHERE instance_id=?", (iid,)).fetchone()
    if row is None:
        raise UnknownInstanceError("Instance is not registered.")
    if not hmac.compare_digest(str(row["secret_hash"]), _secret_hash(secret)):
        raise InstanceAuthError("Invalid instance credentials.")
    return row


def _record_day(conn: sqlite3.Connection, instance_id: str, user_count: int, now: datetime) -> None:
    conn.execute(
        """INSERT INTO instance_daily(day, instance_id, user_count) VALUES(?,?,?)
        ON CONFLICT(day, instance_id) DO UPDATE SET user_count=excluded.user_count""",
        (now.date().isoformat(), instance_id, user_count),
    )


def register(payload: dict[str, Any]) -> dict[str, Any]:
    iid, secret = _identity(payload.get("instance_id", ""), payload.get("instance_secret", ""))
    values = _fields(payload)
    now = _now()
    stamp = now.isoformat()
    with _LOCK, _connect() as conn:
        existing = conn.execute("SELECT secret_hash, registered_at FROM instances WHERE instance_id=?", (iid,)).fetchone()
        if existing and not hmac.compare_digest(str(existing["secret_hash"]), _secret_hash(secret)):
            raise InstanceAuthError("Invalid instance credentials.")
        registered = str(existing["registered_at"]) if existing else stamp
        conn.execute(
            """INSERT OR REPLACE INTO instances(
                instance_id, secret_hash, instance_name, public_network, debug_opt_in,
                user_count, project_count, storage_bytes, users_backend, git_sha,
                runtime, platform, registered_at, last_seen
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (iid, _secret_hash(secret), *values.values(), registered, stamp),
        )
        _record_day(conn, iid, values["user_count"], now)
    return {"ok": True, "instance_id": iid, "registered_at": registered}


def heartbeat(payload: dict[str, Any]) -> dict[str, Any]:
    iid, secret = _identity(payload.get("instance_id", ""), payload.get("instance_secret", ""))
    values = _fields(payload)
    now = _now()
    with _LOCK, _connect() as conn:
        _authenticate(conn, iid, secret)
        conn.execute(
            """UPDATE instances SET instance_name=?, public_network=?, debug_opt_in=?,
            user_count=?, project_count=?, storage_bytes=?, users_backend=?, git_sha=?,
            runtime=?, platform=?, last_seen=? WHERE instance_id=?""",
            (*values.values(), now.isoformat(), iid),
        )
        _record_day(conn, iid, values["user_count"], now)
    return {"ok": True, "instance_id": iid, "last_seen": now.isoformat()}


def submit(payload: dict[str, Any]) -> dict[str, Any]:
    iid, secret = _identity(payload.get("instance_id", ""), payload.get("instance_secret", ""))
    kind = str(payload.get("kind") or "support").strip().lower()
    severity = str(payload.get("severity") or "normal").strip().lower()
    if kind not in _KINDS:
        raise ValueError("kind must be support, issue, diagnostic, bug, or suggestion")
    if severity not in _SEVERITIES:
        severity = "normal"
    subject = _text(payload.get("subject"), 160, one_line=True)
    message = _text(payload.get("message"), 8000)
    diagnostic = _text(payload.get("diagnostic"), 12000)
    if len(subject) < 3 or len(message) < 5:
        raise ValueError("subject and message are required")
    token = _text(payload.get("client_token"), 80, one_line=True)
    if not token:
        token = hashlib.sha256(f"{subject}:{message}".encode()).hexdigest()[:20]
    created = _now().isoformat()
    item_id = uuid.uuid4().hex
    with _LOCK, _connect() as conn:
        _authenticate(conn, iid, secret)
        existing = conn.execute(
            "SELECT id, created_at FROM instance_submissions WHERE instance_id=? AND client_token=?",
            (iid, token),
        ).fetchone()
        if existing:
            return {"ok": True, "submission_id": existing["id"], "created_at": existing["created_at"], "duplicate": True}
        conn.execute(
            """INSERT INTO instance_submissions(
            id, instance_id, client_token, kind, subject, message, severity, diagnostic, created_at
            ) VALUES(?,?,?,?,?,?,?,?,?)""",
            (item_id, iid, token, kind, subject, message, severity, diagnostic, created),
        )
    return {"ok": True, "submission_id": item_id, "created_at": created}


def overview(query: str = "") -> dict[str, Any]:
    search = _text(query, 120, one_line=True).lower()
    cutoff = (_now() - timedelta(minutes=10)).isoformat()
    with _LOCK, _connect() as conn:
        rows = conn.execute("SELECT * FROM instances ORDER BY last_seen DESC").fetchall()
        submissions = conn.execute(
            "SELECT id, instance_id, kind, subject, message, severity, diagnostic, created_at, read_at, "
            "github_issue_number, github_issue_url, github_issue_state "
            "FROM instance_submissions ORDER BY created_at DESC LIMIT 200"
        ).fetchall()
        history = conn.execute(
            "SELECT day, COUNT(*) AS instances, SUM(user_count) AS users FROM instance_daily "
            "WHERE day >= date('now', '-29 days') GROUP BY day ORDER BY day"
        ).fetchall()
    all_instances = [dict(row) for row in rows]
    visible = [row for row in all_instances if not search or search in " ".join((str(row["instance_name"]), str(row["instance_id"]), str(row["git_sha"]))).lower()]
    for row in visible:
        row.pop("secret_hash", None)
        row["status"] = "online" if str(row["last_seen"]) >= cutoff else "offline"
        row["public_network"] = bool(row["public_network"])
        row["debug_opt_in"] = bool(row["debug_opt_in"])
    unread = sum(1 for row in submissions if not row["read_at"])
    return {
        "ok": True,
        "privacy": "Stable IDs and aggregate metrics only. IP addresses, hostnames, and user identities are not stored.",
        "counts": {
            "instances": len(all_instances),
            "online": sum(1 for row in all_instances if str(row["last_seen"]) >= cutoff),
            "users": sum(_count(row["user_count"]) for row in all_instances),
            "projects": sum(_count(row["project_count"]) for row in all_instances),
            "debug_reports": sum(1 for row in submissions if row["kind"] in {"issue", "diagnostic"}),
            "unread": unread,
        },
        "instances": visible,
        "history": [dict(row) for row in history],
        "submissions": [dict(row) for row in submissions],
    }


def mark_read(submission_ids: list[str] | None = None) -> dict[str, Any]:
    ids = [str(value).strip() for value in (submission_ids or []) if str(value).strip()]
    stamp = _now().isoformat()
    with _LOCK, _connect() as conn:
        if ids:
            marks = ",".join("?" for _ in ids)
            cursor = conn.execute(
                f"UPDATE instance_submissions SET read_at=? WHERE read_at IS NULL AND id IN ({marks})",
                (stamp, *ids),
            )
        else:
            cursor = conn.execute("UPDATE instance_submissions SET read_at=? WHERE read_at IS NULL", (stamp,))
    return {"ok": True, "updated": max(0, cursor.rowcount), "read_at": stamp}


def submission(submission_id: str) -> dict[str, Any] | None:
    with _LOCK, _connect() as conn:
        row = conn.execute("SELECT * FROM instance_submissions WHERE id=?", (str(submission_id or "").strip(),)).fetchone()
    return dict(row) if row else None


def link_github_issue(submission_id: str, *, number: int, url: str, state: str = "open") -> dict[str, Any]:
    sid = str(submission_id or "").strip()
    with _LOCK, _connect() as conn:
        cursor = conn.execute(
            "UPDATE instance_submissions SET github_issue_number=?, github_issue_url=?, github_issue_state=? WHERE id=?",
            (int(number), _text(url, 500), _text(state, 20, one_line=True), sid),
        )
    if cursor.rowcount != 1:
        raise ValueError("Submission was not found.")
    return {"ok": True, "submission_id": sid, "github_issue_number": int(number), "github_issue_url": _text(url, 500), "github_issue_state": _text(state, 20, one_line=True)}


def update_linked_issue_state(number: int, state: str) -> int:
    with _LOCK, _connect() as conn:
        cursor = conn.execute(
            "UPDATE instance_submissions SET github_issue_state=? WHERE github_issue_number=?",
            (_text(state, 20, one_line=True), int(number)),
        )
    return max(0, cursor.rowcount)
