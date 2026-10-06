"""Bounded prompt feedback and opt-in, versioned prompt experiments.

This tunes prompt instructions, not model weights. Interpretation and CAD-result
feedback are separate metrics. Raw images, credentials and hidden reasoning are
never retained here.
"""
from __future__ import annotations

import json
import math
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from pathlib import Path
from datetime import datetime, timedelta, timezone

from backend.config import settings

MAX_LOG_BYTES = 32 * 1024 * 1024
EVENT_BUDGET = 24 * 1024 * 1024  # local fallback queue; durable events live in Supabase
RETENTION_DAYS = 90
_LOCK = threading.RLock()


@contextmanager
def connection():
    path = Path(settings.data_dir) / "prompt-learning.sqlite3"
    path.parent.mkdir(parents=True, exist_ok=True)
    with _LOCK:
        conn = sqlite3.connect(path, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA auto_vacuum=INCREMENTAL")
        conn.execute("PRAGMA journal_size_limit=1048576")
        page_size = conn.execute("PRAGMA page_size").fetchone()[0]
        conn.execute(f"PRAGMA max_page_count={(MAX_LOG_BYTES - 20 * 1024 * 1024) // page_size}")
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT NOT NULL,
            version TEXT NOT NULL, stage TEXT NOT NULL, created_at TEXT NOT NULL,
            payload TEXT NOT NULL, bytes INTEGER NOT NULL, vote INTEGER, comment TEXT DEFAULT '');
        CREATE INDEX IF NOT EXISTS events_user ON events(user_id, created_at);
        CREATE TABLE IF NOT EXISTS preferences (user_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0,
            active_version TEXT NOT NULL DEFAULT 'baseline', trial_version TEXT, last_compiled INTEGER DEFAULT 0);
        CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, rules TEXT NOT NULL,
            status TEXT NOT NULL, created_at TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '');
        CREATE TABLE IF NOT EXISTS scores (user_id TEXT NOT NULL, version TEXT NOT NULL, stage TEXT NOT NULL,
            approvals INTEGER NOT NULL DEFAULT 0, ratings INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(user_id,version,stage));
        """)
        columns = {row[1] for row in conn.execute("PRAGMA table_info(preferences)")}
        if "retain_feedback" not in columns:
            conn.execute("ALTER TABLE preferences ADD COLUMN retain_feedback INTEGER NOT NULL DEFAULT 0")
        try:
            yield conn
            conn.commit()
            conn.execute("PRAGMA incremental_vacuum(512)")
        except Exception:
            conn.rollback(); raise
        finally:
            conn.close()


def preferences(user_id):
    with connection() as conn:
        conn.execute("INSERT OR IGNORE INTO preferences(user_id) VALUES(?)", (user_id,))
        row = dict(conn.execute("SELECT * FROM preferences WHERE user_id=?", (user_id,)).fetchone())
    return {**row, "enabled": bool(row["enabled"]), "retain_feedback": bool(row.get("retain_feedback", 0))}


def set_enabled(user_id, enabled):
    preferences(user_id)
    with connection() as conn:
        conn.execute("UPDATE preferences SET enabled=? WHERE user_id=?", (int(enabled), user_id))
    sync_state(user_id)
    return preferences(user_id)


def set_feedback_retention(user_id, enabled):
    preferences(user_id)
    with connection() as conn:
        conn.execute("UPDATE preferences SET retain_feedback=? WHERE user_id=?", (int(enabled), user_id))
    sync_state(user_id)
    return preferences(user_id)


def should_retain_feedback(user_id):
    return bool(preferences(user_id)["retain_feedback"])


def _remote_client():
    try:
        from backend.services import supabase_client
        return supabase_client.get_admin_client()
    except Exception:
        return None


def _remote_event(row):
    client = _remote_client()
    if client is None:
        return False
    try:
        client.table("prompt_learning_events").upsert(row).execute()
        return True
    except Exception:
        return False


def _remote_events(user_id, *, limit=40):
    client = _remote_client()
    if client is None:
        return []
    try:
        result = (client.table("prompt_learning_events").select("*")
                  .eq("user_id", user_id).order("created_at", desc=True).limit(limit).execute())
        return list(result.data or [])
    except Exception:
        return []


def active_rules(user_id, *, experiment=False):
    prefs = preferences(user_id)
    if not prefs["enabled"]:
        return "baseline", ""
    version = prefs["active_version"]
    # An opt-in trial splits Analyze calls between the incumbent and candidate.
    if experiment and prefs["trial_version"] and uuid.uuid4().int % 2:
        version = prefs["trial_version"]
    with connection() as conn:
        row = conn.execute("SELECT rules FROM versions WHERE id=? AND user_id=?", (version, user_id)).fetchone()
    return version, row["rules"] if row else ""


def prune(conn, budget=EVENT_BUDGET):
    total = conn.execute("SELECT COALESCE(SUM(bytes),0) FROM events").fetchone()[0]
    while total > budget:
        rows = conn.execute("SELECT id,bytes FROM events ORDER BY created_at LIMIT 100").fetchall()
        if not rows:
            break
        conn.executemany("DELETE FROM events WHERE id=?", [(r["id"],) for r in rows])
        total -= sum(r["bytes"] for r in rows)
    # Compact version history; cumulative scores survive event pruning.
    conn.execute("""DELETE FROM versions WHERE id IN (
        SELECT id FROM versions WHERE status IN ('rejected','retired') ORDER BY created_at DESC LIMIT -1 OFFSET 1000)""")


def record(user_id, project_id, version, stage, payload):
    if not should_retain_feedback(user_id):
        return ""
    text = json.dumps(payload, ensure_ascii=False, allow_nan=False)
    if len(text.encode()) > 48000:
        raise ValueError("Feedback context is too large; link files instead of embedding content")
    event_id = uuid.uuid4().hex
    created_at = datetime.now(timezone.utc)
    remote = {
        "id": event_id, "user_id": user_id, "project_id": project_id,
        "version": version, "stage": stage, "created_at": created_at.isoformat(),
        "expires_at": (created_at + timedelta(days=RETENTION_DAYS)).isoformat(),
        "payload": payload, "payload_bytes": len(text.encode()),
    }
    if _remote_event(remote):
        return event_id
    with connection() as conn:
        conn.execute("INSERT INTO events(id,user_id,project_id,version,stage,created_at,payload,bytes) VALUES(?,?,?,?,?,?,?,?)",
                     (event_id, user_id, project_id, version, stage, created_at.isoformat(), text, len(text.encode()) + 4096))
        prune(conn)
    return event_id


def _interval(good, total):
    if not total:
        return 0, 1
    z = 1.96; p = good / total; d = 1 + z*z/total
    centre = (p + z*z/(2*total)) / d
    margin = z*math.sqrt(p*(1-p)/total + z*z/(4*total*total)) / d
    return centre-margin, centre+margin


def rate(user_id, event_id, approve, comment=""):
    with connection() as conn:
        row = conn.execute("SELECT * FROM events WHERE id=? AND user_id=?", (event_id, user_id)).fetchone()
        remote_row = None
        if not row:
            remote_row = next((item for item in _remote_events(user_id, limit=200) if item.get("id") == event_id), None)
        if not row and not remote_row:
            raise ValueError("Feedback entry is missing or belongs to another user")
        source = dict(row) if row else remote_row
        previous = source.get("vote")
        if row:
            conn.execute("UPDATE events SET vote=?,comment=? WHERE id=?", (int(approve), str(comment)[:3000], event_id))
        else:
            client = _remote_client()
            if client is None:
                raise ValueError("Feedback storage is temporarily unavailable")
            client.table("prompt_learning_events").update({"vote": int(approve), "comment": str(comment)[:3000]}).eq("id", event_id).eq("user_id", user_id).execute()
        conn.execute("INSERT OR IGNORE INTO scores(user_id,version,stage) VALUES(?,?,?)", (user_id, source["version"], source["stage"]))
        conn.execute("UPDATE scores SET approvals=approvals+?,ratings=ratings+? WHERE user_id=? AND version=? AND stage=?",
                     (int(approve) - (previous or 0), 1 if previous is None else 0, user_id, source["version"], source["stage"]))
    evaluate(user_id)
    sync_state(user_id)
    return {"ok": True, "event_id": event_id}


def evaluate(user_id):
    prefs = preferences(user_id)
    if not prefs["enabled"] or not prefs["trial_version"]:
        return
    with connection() as conn:
        scores = {r["version"]: dict(r) for r in conn.execute("SELECT * FROM scores WHERE user_id=? AND stage='interpretation'", (user_id,))}
        trial, base = scores.get(prefs["trial_version"]), scores.get(prefs["active_version"])
        if not trial or not base or min(trial["ratings"], base["ratings"]) < 20:
            return
        lo, hi = _interval(trial["approvals"], trial["ratings"])
        blo, bhi = _interval(base["approvals"], base["ratings"])
        if lo > bhi:
            conn.execute("UPDATE versions SET status='retired' WHERE id=?", (prefs["active_version"],))
            conn.execute("UPDATE versions SET status='active',reason='Higher interpretation approval; non-overlapping 95% intervals' WHERE id=?", (prefs["trial_version"],))
            conn.execute("UPDATE preferences SET active_version=trial_version,trial_version=NULL WHERE user_id=?", (user_id,))
        elif hi < blo:
            conn.execute("UPDATE versions SET status='rejected',reason='Lower interpretation approval than incumbent' WHERE id=?", (prefs["trial_version"],))
            conn.execute("UPDATE preferences SET trial_version=NULL WHERE user_id=?", (user_id,))


def compilation_context(user_id):
    with connection() as conn:
        rows = conn.execute("SELECT payload,vote,comment,version,stage FROM events WHERE user_id=? AND vote IS NOT NULL ORDER BY created_at DESC LIMIT 40", (user_id,)).fetchall()
    local = [{**dict(r), "payload": json.loads(r["payload"])} for r in rows]
    remote = [r for r in _remote_events(user_id, limit=40) if r.get("vote") is not None]
    combined = remote + local
    combined.sort(key=lambda row: str(row.get("created_at") or ""), reverse=True)
    return combined[:40]


def add_candidate(user_id, rules, reason):
    version = uuid.uuid4().hex[:12]
    prefs = preferences(user_id)
    with connection() as conn:
        if prefs["trial_version"]:
            conn.execute("UPDATE versions SET status='retired' WHERE id=?", (prefs["trial_version"],))
        conn.execute("INSERT INTO versions VALUES(?,?,?,?,?,?)", (version, user_id, str(rules)[:2400], "trial", datetime.now(timezone.utc).isoformat(), str(reason)[:2000]))
        count = conn.execute("SELECT COALESCE(SUM(ratings),0) FROM scores WHERE user_id=?", (user_id,)).fetchone()[0]
        conn.execute("UPDATE preferences SET trial_version=?,last_compiled=? WHERE user_id=?", (version, count, user_id))
    sync_state(user_id)
    return version


def should_compile(user_id):
    prefs = preferences(user_id)
    if not prefs["enabled"] or prefs["trial_version"]:
        return False
    with connection() as conn:
        count = conn.execute("SELECT COALESCE(SUM(ratings),0) FROM scores WHERE user_id=?", (user_id,)).fetchone()[0]
    return count - prefs["last_compiled"] >= 20


def report(user_id=None, *, limit=200):
    with connection() as conn:
        where, args = (" WHERE user_id=?", (user_id,)) if user_id else ("", ())
        events = [{**dict(r), "payload": json.loads(r["payload"])} for r in conn.execute("SELECT * FROM events" + where + " ORDER BY created_at DESC LIMIT ?", (*args, limit))]
        scores = [dict(r) for r in conn.execute("SELECT * FROM scores" + where, args)]
        versions = [dict(r) for r in conn.execute("SELECT * FROM versions" + where + " ORDER BY created_at DESC LIMIT 1000", args)]
        size = conn.execute("SELECT COALESCE(SUM(bytes),0) FROM events").fetchone()[0]
    return {"events": events, "scores": [{**r, "approval_rate": r["approvals"] / r["ratings"] if r["ratings"] else None} for r in scores],
            "versions": versions, "log_bytes": size, "max_log_bytes": MAX_LOG_BYTES,
            "note": "Detailed feedback expires after 90 days. Ordinary model requests receive only short active guidance, never this event history."}


def sync_state(user_id):
    # Only compact metrics/settings are mirrored. Detailed logs stay within the
    # bounded local store and admin export; no unbounded remote trace copies.
    try:
        from backend.services import supabase_client
        client = supabase_client.get_admin_client()
        if client is None:
            return
        prefs = preferences(user_id)
        data = report(user_id, limit=0)
        active = next((r for r in data["scores"] if r["version"] == prefs["active_version"] and r["stage"] == "interpretation"), {})
        client.table("prompt_learning_state").upsert({
            "user_id": user_id, "smart_learning_enabled": prefs["enabled"], "active_version": prefs["active_version"],
            "feedback_retention_enabled": prefs["retain_feedback"],
            "trial_version": prefs["trial_version"], "approval_rate": active.get("approval_rate"),
            "ratings": active.get("ratings", 0), "is_improving": prefs["active_version"] != "baseline",
            "metrics": data["scores"], "updated_at": datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception:
        # Local feedback is durable even when Supabase is offline/unmigrated.
        pass
