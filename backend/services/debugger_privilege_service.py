"""Privilege, damage, fork, rollback, and issue layer for debugger analytics.

Does not replace debugger_analytics_service. Same sqlite. Sam still marks safe.
Never runs git reset. Snapshot rollback, privilege elevation, and GitHub filing
stay queued until an explicit approve path. Nothing auto-applies.
"""
from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from backend.services import debugger_analytics_service as das

PRIVILEGE_KEYS = (
    "ui.overlay",
    "settings.modify",
    "memory.leak",
    "watchdog.log",
    "cli.journalctl",
    "cli.readonly",
    "snapshot.reset",
    "github.issue",
)
PRIVILEGE_STATUSES = ("pending", "safe", "banned", "restricted")
SAFE_STREAK = 3
BAN_STREAK = 3
HIGH_SCORE = 85
LOW_DAMAGE = 15
FORMULA = (
    "outcome = achieved * (1 - damage/200) * consistency; "
    "damage = clamp(25*collateral + 30*throttle + 20*token_spike + 15*time_spike + 10*server_break, 0, 100); "
    "consistency = 0.7 + 0.3 * (high_score_hits / last_5_same_method)"
)
PATTERN_RE = re.compile(r"[^a-z0-9]+")
# Bare Studio project ids — other instances must suffix, never mint these as new ids.
STUDIO_PROJECT_IDS = frozenset({"ce8294df", "5bf8e783"})


def _ensure(conn) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS privileges (
            method TEXT PRIMARY KEY, status TEXT NOT NULL,
            good_streak INTEGER NOT NULL, bad_streak INTEGER NOT NULL,
            damage_score REAL NOT NULL, consistency_score REAL NOT NULL,
            last_ban_reason TEXT, asked_safe INTEGER NOT NULL, note TEXT,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS privilege_uses (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, method TEXT NOT NULL,
            score_id TEXT, achieved INTEGER, damage INTEGER, outcome REAL,
            similar INTEGER, features_json TEXT
        );
        CREATE TABLE IF NOT EXISTS ask_safe (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, method TEXT NOT NULL,
            status TEXT NOT NULL, note TEXT
        );
        CREATE TABLE IF NOT EXISTS forks (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, parent_tracking_id TEXT,
            override_note TEXT, sam_steps TEXT, scores_before TEXT,
            scores_after TEXT, raised INTEGER, status TEXT
        );
        CREATE TABLE IF NOT EXISTS restrictions (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, pattern_hash TEXT NOT NULL,
            pattern TEXT NOT NULL, count INTEGER NOT NULL, status TEXT NOT NULL, note TEXT
        );
        CREATE TABLE IF NOT EXISTS rollbacks (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, snapshot_id TEXT NOT NULL,
            log_ids_json TEXT NOT NULL, status TEXT NOT NULL, note TEXT
        );
        CREATE TABLE IF NOT EXISTS da_issues (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, project_id TEXT NOT NULL,
            instance_id TEXT NOT NULL, title TEXT, log_ids_json TEXT,
            github_url TEXT, outcome_avg REAL, note TEXT, status TEXT
        );
        CREATE TABLE IF NOT EXISTS server_breaks (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, log_ids_json TEXT NOT NULL, note TEXT
        );
        CREATE TABLE IF NOT EXISTS logic_notes (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, scope TEXT NOT NULL,
            proposal TEXT NOT NULL, direction TEXT, evidence TEXT
        );
        """
    )
    cols = {str(r[1]) for r in conn.execute("PRAGMA table_info(da_issues)").fetchall()}
    if "status" not in cols:
        conn.execute("ALTER TABLE da_issues ADD COLUMN status TEXT")
    for method in PRIVILEGE_KEYS:
        conn.execute(
            "INSERT OR IGNORE INTO privileges VALUES (?,?,?,?,?,?,?,?,?,?)",
            (method, "pending", 0, 0, 0, 1.0, "", 0, "", das.now()),
        )


def _conn():
    conn = das._conn()
    _ensure(conn)
    return conn


def compose_project_id(project_id: str, instance_id: str | None = None) -> str:
    pid = re.sub(r"[^A-Za-z0-9]", "", str(project_id or ""))[:16]
    if not pid:
        raise ValueError("project_id is required")
    suf = re.sub(r"[^A-Za-z0-9]", "", str(instance_id or ""))[:8]
    if suf:
        # Tenant/instance suffix so other installs never collide with Studio ids like ce8294df.
        return f"{pid}.{suf}"
    return pid


def format_log_chain(log_ids: Any) -> str:
    ids = das._ids(log_ids)
    return " | ".join(ids)


def instance_project_member(project_id: str, instance_id: str | None = None) -> dict[str, str]:
    return {"kind": "project", "id": compose_project_id(project_id, instance_id)}


def compute_damage(
    *,
    collateral: int = 0,
    throttle: bool = False,
    token_spike: float = 0.0,
    time_spike: float = 0.0,
    server_break: bool = False,
) -> int:
    raw = (
        25 * max(0, int(collateral))
        + (30 if throttle else 0)
        + 20 * max(0.0, min(1.0, float(token_spike)))
        + 15 * max(0.0, min(1.0, float(time_spike)))
        + (10 if server_break else 0)
    )
    return int(max(0, min(100, round(raw))))


def consistency_factor(method: str) -> float:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT achieved FROM privilege_uses WHERE method = ? ORDER BY ts DESC LIMIT 5",
            (method,),
        ).fetchall()
    if not rows:
        return 1.0
    hits = sum(1 for r in rows if int(r["achieved"] or 0) >= HIGH_SCORE)
    return round(0.7 + 0.3 * (hits / len(rows)), 3)


def compute_outcome(achieved: int, damage: int, consistency: float) -> float:
    value = float(achieved) * (1.0 - float(damage) / 200.0) * float(consistency)
    return round(max(0.0, min(100.0, value)), 2)


def _privilege(method: str) -> dict[str, Any]:
    method = _method(method)
    with _conn() as conn:
        row = conn.execute("SELECT * FROM privileges WHERE method = ?", (method,)).fetchone()
    return dict(row) if row else {"method": method, "status": "pending", "good_streak": 0, "bad_streak": 0}


def _method(value: Any) -> str:
    method = str(value or "").strip().lower()
    if method not in PRIVILEGE_KEYS:
        raise ValueError(f"method must be one of: {', '.join(PRIVILEGE_KEYS)}")
    return method


def can_act(method: str) -> bool:
    row = _privilege(method)
    return row.get("status") == "safe"


def list_privileges() -> list[dict[str, Any]]:
    with _conn() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM privileges ORDER BY method")]


def list_ask_safe(status: str = "pending") -> list[dict[str, Any]]:
    with _conn() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM ask_safe WHERE status = ? ORDER BY ts DESC", (status,))]


def note_score(score_row: dict[str, Any], data: dict[str, Any] | None = None) -> dict[str, Any]:
    data = data or {}
    method = str(data.get("method") or data.get("privilege") or "").strip().lower()
    if method and method not in PRIVILEGE_KEYS:
        method = ""
    if not method:
        return {}
    before = das._features(data.get("before_features") or {})
    after = das._features(data.get("after_features") or data.get("features") or score_row.get("features") or {})
    collateral = das._collateral_breakage(before, after) if before else len(score_row.get("broken") or []) if int(score_row.get("score") or 0) < 40 else 0
    damage = compute_damage(
        collateral=int(data.get("collateral") if data.get("collateral") is not None else collateral),
        throttle=bool(data.get("throttle")),
        token_spike=float(data.get("token_spike") or 0),
        time_spike=float(data.get("time_spike") or 0),
        server_break=bool(data.get("server_break")),
    )
    achieved = int(score_row.get("score") or 0)
    consistency = consistency_factor(method)
    outcome = compute_outcome(achieved, damage, consistency)
    similar = False
    features = after or score_row.get("features") or {}
    with _conn() as conn:
        prior = conn.execute(
            "SELECT features_json, outcome FROM privilege_uses WHERE method = ? ORDER BY ts DESC LIMIT 8",
            (method,),
        ).fetchall()
    for row in prior:
        try:
            prev_features = json.loads(row["features_json"] or "{}")
        except json.JSONDecodeError:
            continue
        if prev_features and das.compare_feature_vectors(prev_features, features).get("similar"):
            similar = True
            if float(row["outcome"] or 0) >= HIGH_SCORE and outcome >= HIGH_SCORE:
                # historically high + same vector: count toward autonomy streak
                pass
            break
    good = outcome >= HIGH_SCORE and damage <= LOW_DAMAGE
    with _conn() as conn:
        priv = dict(conn.execute("SELECT * FROM privileges WHERE method = ?", (method,)).fetchone())
        good_streak = int(priv["good_streak"]) + 1 if good else 0
        bad_streak = int(priv["bad_streak"]) + 1 if not good and outcome < 50 else (0 if good else int(priv["bad_streak"]))
        status = priv["status"]
        reason = priv["last_ban_reason"] or ""
        if status == "safe" and bad_streak >= BAN_STREAK:
            status = "banned"
            reason = das._excerpt(data.get("ban_reason") or f"outcome {outcome} x{bad_streak}", 160)
        conn.execute(
            "UPDATE privileges SET good_streak=?, bad_streak=?, damage_score=?, consistency_score=?, status=?, last_ban_reason=?, updated_at=? WHERE method=?",
            (good_streak, bad_streak, damage, consistency, status, reason, das.now(), method),
        )
        conn.execute(
            "INSERT INTO privilege_uses VALUES (?,?,?,?,?,?,?,?,?)",
            (uuid.uuid4().hex, das.now(), method, score_row.get("id") or "", achieved, damage, outcome, int(similar), das._json(features)),
        )
    asked = None
    if good_streak >= SAFE_STREAK and status == "pending":
        asked = ask_to_mark_safe(method, note=f"{good_streak} clean high-score uses")
    if data.get("server_break"):
        record_server_break(data.get("log_ids") or [score_row.get("log_id")], note=str(data.get("notes") or "server break"))
    if data.get("prompt_text") and damage >= 40:
        note_prompt_pattern(str(data.get("prompt_text")), collateral=collateral or 1)
    return {
        "method": method,
        "damage_score": damage,
        "consistency_score": consistency,
        "outcome": outcome,
        "similar_privilege": similar,
        "ask_safe": asked,
        "privilege_status": status,
        "formula": FORMULA,
    }


def ask_to_mark_safe(method: str, *, note: str = "") -> dict[str, Any]:
    method = _method(method)
    with _conn() as conn:
        existing = conn.execute("SELECT * FROM ask_safe WHERE method = ? AND status = 'pending'", (method,)).fetchone()
        if existing:
            return dict(existing)
        row = {"id": uuid.uuid4().hex, "ts": das.now(), "method": method, "status": "pending", "note": das._excerpt(note, 160)}
        conn.execute("INSERT INTO ask_safe VALUES (?,?,?,?,?)", tuple(row.values()))
        conn.execute("UPDATE privileges SET asked_safe = 1 WHERE method = ?", (method,))
    return row


def mark_safe(method: str) -> dict[str, Any]:
    method = _method(method)
    with _conn() as conn:
        conn.execute("UPDATE privileges SET status = 'safe', last_ban_reason = '', updated_at = ? WHERE method = ?", (das.now(), method))
        conn.execute("UPDATE ask_safe SET status = 'approved' WHERE method = ? AND status = 'pending'", (method,))
    return _privilege(method)


def ban_privilege(method: str, *, reason: str = "") -> dict[str, Any]:
    method = _method(method)
    with _conn() as conn:
        conn.execute(
            "UPDATE privileges SET status = 'banned', last_ban_reason = ?, good_streak = 0, updated_at = ? WHERE method = ?",
            (das._excerpt(reason or "manual ban", 160), das.now(), method),
        )
    return _privilege(method)


def restrict_privilege(method: str, *, reason: str = "") -> dict[str, Any]:
    method = _method(method)
    with _conn() as conn:
        conn.execute(
            "UPDATE privileges SET status = 'restricted', last_ban_reason = ?, updated_at = ? WHERE method = ?",
            (das._excerpt(reason or "restricted", 160), das.now(), method),
        )
    return _privilege(method)


def create_fork(data: dict[str, Any]) -> dict[str, Any]:
    parent = str(data.get("parent_tracking_id") or data.get("tracking_id") or "")[:200]
    fid = "fork_" + uuid.uuid4().hex[:10]
    before = data.get("scores_before") or []
    row = {
        "id": fid,
        "ts": das.now(),
        "parent_tracking_id": parent,
        "override_note": das._excerpt(data.get("override_note") or data.get("note"), 240),
        "sam_steps": das._excerpt(data.get("sam_steps"), 240),
        "scores_before": das._json(before if isinstance(before, list) else [before]),
        "scores_after": "[]",
        "raised": 0,
        "status": "open",
    }
    with _conn() as conn:
        conn.execute("INSERT INTO forks VALUES (?,?,?,?,?,?,?,?,?)", tuple(row.values()))
    return {**row, "scores_before": before if isinstance(before, list) else [before]}


def evaluate_fork(fork_id: str, scores_after: list[Any] | None = None) -> dict[str, Any]:
    with _conn() as conn:
        row = conn.execute("SELECT * FROM forks WHERE id = ?", (fork_id,)).fetchone()
        if not row:
            raise ValueError("fork not found")
        after = scores_after if scores_after is not None else json.loads(row["scores_after"] or "[]")
        before = json.loads(row["scores_before"] or "[]")
        def _avg(items: list[Any]) -> float:
            nums = []
            for item in items:
                if isinstance(item, dict):
                    nums.append(float(item.get("outcome") or item.get("score") or 0))
                else:
                    nums.append(float(item or 0))
            return sum(nums) / len(nums) if nums else 0.0
        raised = _avg(after) > _avg(before)
        conn.execute("UPDATE forks SET scores_after = ?, raised = ?, status = ? WHERE id = ?", (das._json(after), int(raised), "improved" if raised else "open", fork_id))
    return {"id": fork_id, "raised": raised, "sam_improved": raised}


def list_forks(limit: int = 20) -> list[dict[str, Any]]:
    with _conn() as conn:
        return [dict(r) for r in conn.execute("SELECT * FROM forks ORDER BY ts DESC LIMIT ?", (max(1, min(limit, 40)),))]


def pattern_hash(text: str) -> str:
    slug = PATTERN_RE.sub(" ", str(text or "").lower()).strip()
    slug = " ".join(slug.split()[:6])
    return hashlib.sha256(slug.encode()).hexdigest()[:16], slug


def note_prompt_pattern(text: str, *, collateral: int = 1) -> dict[str, Any]:
    digest, slug = pattern_hash(text)
    if len(slug) < 6:
        return {"ok": False}
    with _conn() as conn:
        row = conn.execute("SELECT * FROM restrictions WHERE pattern_hash = ?", (digest,)).fetchone()
        if row:
            count = int(row["count"]) + max(1, int(collateral))
            status = "restricted" if count >= 2 else row["status"]
            conn.execute("UPDATE restrictions SET count = ?, status = ? WHERE id = ?", (count, status, row["id"]))
            ident = row["id"]
        else:
            ident = uuid.uuid4().hex
            count = max(1, int(collateral))
            status = "watching"
            conn.execute("INSERT INTO restrictions VALUES (?,?,?,?,?,?,?)", (ident, das.now(), digest, slug[:80], count, status, "user override pattern"))
    issue = None
    if status == "restricted" and count >= 3:
        try:
            # Local issues API only. GitHub stays pending until Sam/harness approve.
            issue = file_issue({
                "project_id": "pattern",
                "instance_id": "local",
                "title": f"restrict pattern: {slug[:40]}",
                "log_ids": [],
                "note": "Sam prompt pattern caused repeated collateral",
                "github": False,
                "approve": False,
            })
        except ValueError:
            pass
    return {"id": ident, "pattern": slug, "count": count, "status": status, "issue": issue}


def propose_rollback(data: dict[str, Any]) -> dict[str, Any]:
    snapshot_id = str(data.get("snapshot_id") or "").strip()
    if not snapshot_id:
        raise ValueError("snapshot_id is required")
    log_ids = das._ids(data.get("log_ids") or data.get("last_log_ids") or [])
    if not log_ids:
        with _conn() as conn:
            breaks = conn.execute("SELECT log_ids_json FROM server_breaks ORDER BY ts DESC LIMIT 1").fetchone()
        if breaks:
            log_ids = json.loads(breaks["log_ids_json"] or "[]")
    # Privilege only means Grok may *propose* without extra ask. Reset never auto-runs.
    row = {
        "id": "rb_" + uuid.uuid4().hex[:10],
        "ts": das.now(),
        "snapshot_id": snapshot_id[:80],
        "log_ids": log_ids,
        "status": "pending_approval",
        "note": das._excerpt(data.get("note") or "reset last prompts to earlier snapshot — not a git reset", 200),
        "log_chain": format_log_chain(log_ids),
        "auto_applied": False,
        "may_propose": can_act("snapshot.reset"),
    }
    with _conn() as conn:
        conn.execute(
            "INSERT INTO rollbacks VALUES (?,?,?,?,?,?)",
            (row["id"], row["ts"], row["snapshot_id"], das._json(log_ids), row["status"], row["note"]),
        )
    return row


def approve_rollback(rid: str, *, approve: bool = True) -> dict[str, Any]:
    with _conn() as conn:
        row = conn.execute("SELECT * FROM rollbacks WHERE id = ?", (rid,)).fetchone()
        if not row:
            raise ValueError("rollback not found")
        status = "approved" if approve else "denied"
        conn.execute("UPDATE rollbacks SET status = ? WHERE id = ?", (status, rid))
    data = dict(row)
    data["status"] = status
    data["log_ids"] = json.loads(data.pop("log_ids_json") or "[]")
    data["git_reset"] = False
    return data


def list_rollbacks(limit: int = 20) -> list[dict[str, Any]]:
    with _conn() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM rollbacks ORDER BY ts DESC LIMIT ?", (max(1, min(limit, 40)),))]
    for row in rows:
        row["log_ids"] = json.loads(row.pop("log_ids_json") or "[]")
    return rows


def record_server_break(log_ids: Any, *, note: str = "") -> dict[str, Any]:
    ids = das._ids(log_ids)
    row = {"id": uuid.uuid4().hex, "ts": das.now(), "log_ids": ids, "note": das._excerpt(note, 160)}
    with _conn() as conn:
        conn.execute("INSERT INTO server_breaks VALUES (?,?,?,?)", (row["id"], row["ts"], das._json(ids), row["note"]))
    return row


def last_server_breaks(limit: int = 5) -> list[dict[str, Any]]:
    with _conn() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM server_breaks ORDER BY ts DESC LIMIT ?", (max(1, min(limit, 10)),))]
    for row in rows:
        row["log_ids"] = json.loads(row.pop("log_ids_json") or "[]")
    return rows


def file_issue(data: dict[str, Any]) -> dict[str, Any]:
    project_id = str(data.get("project_id") or "").strip()
    instance_id = str(data.get("instance_id") or "").strip()
    if not project_id:
        raise ValueError("GitHub / debugger issue requires project_id")
    if not instance_id:
        raise ValueError("issue requires instance_id")
    if project_id == "pattern":
        composed = "pattern.local"
    else:
        composed = compose_project_id(project_id, instance_id)
    log_ids = das._ids(data.get("log_ids") or data.get("log_id"))
    title = das._excerpt(data.get("title") or "debugger issue", 80)
    with _conn() as conn:
        rows = conn.execute("SELECT outcome FROM privilege_uses ORDER BY ts DESC LIMIT 8").fetchall()
    avg = round(sum(float(r["outcome"] or 0) for r in rows) / len(rows), 2) if rows else 0.0
    want_github = data.get("github") is True
    approved = data.get("approve") is True or str(data.get("action") or "").lower() == "approve"
    github = {"ok": False, "skipped": "needs_approval" if want_github else "local_only"}
    status = "pending_github" if want_github and not approved else "local"
    if want_github and approved:
        github = _post_github_issue(composed, instance_id, log_ids, avg, title, data.get("note"))
        status = "filed" if github.get("ok") else "pending_github"
    row = {
        "id": "iss_" + uuid.uuid4().hex[:10],
        "ts": das.now(),
        "project_id": composed,
        "instance_id": instance_id[:80],
        "title": title,
        "log_ids": log_ids,
        "log_chain": format_log_chain(log_ids),
        "github_url": (github or {}).get("html_url") or "",
        "outcome_avg": avg,
        "note": das._excerpt(data.get("note"), 200),
        "status": status,
        "auto_applied": False,
    }
    with _conn() as conn:
        conn.execute(
            "INSERT INTO da_issues (id, ts, project_id, instance_id, title, log_ids_json, github_url, outcome_avg, note, status) VALUES (?,?,?,?,?,?,?,?,?,?)",
            (row["id"], row["ts"], composed, row["instance_id"], title, das._json(log_ids), row["github_url"], avg, row["note"], status),
        )
    row["github"] = {k: github.get(k) for k in ("ok", "html_url", "number", "error", "skipped") if k in (github or {})}
    return row


def _post_github_issue(composed: str, instance_id: str, log_ids: list[str], avg: float, title: str, note: Any) -> dict[str, Any]:
    try:
        from backend.services import github_issues_service as gh

        body = "\n".join([
            f"project_id: {composed}",
            f"instance_id: {instance_id}",
            f"log_ids: {format_log_chain(log_ids) or 'none'}",
            f"local_outcome_avg: {avg}",
            das._excerpt(note, 400),
        ])
        return gh.create_debugger_issue(title=title, body=body)
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:160]}


def approve_issue(issue_id: str, *, approve: bool = True, github: bool = True) -> dict[str, Any]:
    with _conn() as conn:
        row = conn.execute("SELECT * FROM da_issues WHERE id = ?", (issue_id,)).fetchone()
        if not row:
            raise ValueError("issue not found")
        data = dict(row)
        log_ids = json.loads(data.get("log_ids_json") or "[]")
        if not approve:
            conn.execute("UPDATE da_issues SET status = ? WHERE id = ?", ("denied", issue_id))
            data["status"] = "denied"
            data["log_ids"] = log_ids
            data["log_chain"] = format_log_chain(log_ids)
            data.pop("log_ids_json", None)
            data["github"] = {"ok": False, "skipped": "denied"}
            return data
        github_result = {"ok": False, "skipped": "local_only"}
        status = "local"
        url = data.get("github_url") or ""
        if github:
            github_result = _post_github_issue(
                data["project_id"], data["instance_id"], log_ids, float(data.get("outcome_avg") or 0), data.get("title") or "", data.get("note")
            )
            url = github_result.get("html_url") or url
            status = "filed" if github_result.get("ok") else "pending_github"
        conn.execute("UPDATE da_issues SET status = ?, github_url = ? WHERE id = ?", (status, url, issue_id))
    data["status"] = status
    data["github_url"] = url
    data["log_ids"] = log_ids
    data["log_chain"] = format_log_chain(log_ids)
    data.pop("log_ids_json", None)
    data["github"] = {k: github_result.get(k) for k in ("ok", "html_url", "number", "error", "skipped") if k in (github_result or {})}
    data["auto_applied"] = False
    return data


def list_issues(limit: int = 20) -> list[dict[str, Any]]:
    with _conn() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM da_issues ORDER BY ts DESC LIMIT ?", (max(1, min(limit, 40)),))]
    for row in rows:
        row["log_ids"] = json.loads(row.pop("log_ids_json") or "[]")
        row["log_chain"] = format_log_chain(row["log_ids"])
        row["status"] = row.get("status") or "local"
    return rows


def logic_report(scope: str = "weekly") -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    if scope == "daily":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif scope == "prompt":
        start = now - timedelta(hours=2)
    else:
        start = (now - timedelta(days=now.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    since = start.isoformat()
    with _conn() as conn:
        uses = [dict(r) for r in conn.execute("SELECT * FROM privilege_uses WHERE ts >= ? ORDER BY ts DESC", (since,))]
        privs = [dict(r) for r in conn.execute("SELECT * FROM privileges")]
        forks = [dict(r) for r in conn.execute("SELECT * FROM forks WHERE ts >= ?", (since,))]
    outcomes = [float(u["outcome"] or 0) for u in uses]
    avg = round(sum(outcomes) / len(outcomes), 2) if outcomes else 0.0
    hurting = [p["method"] for p in privs if p["status"] in {"banned", "restricted"} or float(p["damage_score"] or 0) >= 40]
    helping = [p["method"] for p in privs if p["status"] == "safe" or int(p["good_streak"] or 0) >= SAFE_STREAK]
    proposal = "Keep safe methods; drop banned methods from autonomous writes; prefer Sam forks that raised scores."
    if hurting and avg < 60:
        proposal = f"Logic is hurting debug score ({avg}). Pause {', '.join(hurting[:4])}."
    elif helping and avg >= 70:
        proposal = f"Logic is improving debug score ({avg}). Ask Sam to mark {', '.join(helping[:4])} safe if still pending."
    note = {
        "id": uuid.uuid4().hex,
        "ts": das.now(),
        "scope": scope,
        "proposal": proposal,
        "direction": "improving" if avg >= 65 else "hurting" if outcomes else "unknown",
        "evidence": das._json({"avg": avg, "n": len(uses), "hurting": hurting, "helping": helping, "forks": len(forks)}),
    }
    with _conn() as conn:
        conn.execute("INSERT INTO logic_notes VALUES (?,?,?,?,?,?)", (note["id"], note["ts"], scope, proposal, note["direction"], note["evidence"]))
    return {
        "scope": scope,
        "avg_outcome": avg,
        "count": len(uses),
        "direction": note["direction"],
        "proposal": proposal,
        "hurting": hurting,
        "helping": helping,
        "formula": FORMULA,
    }


def weekly_addon() -> dict[str, Any]:
    with _conn() as conn:
        safe = [dict(r) for r in conn.execute("SELECT method,status,good_streak,damage_score FROM privileges WHERE status = 'safe'")]
        banned = [dict(r) for r in conn.execute("SELECT method,last_ban_reason FROM privileges WHERE status IN ('banned','restricted')")]
        pending_safe = [dict(r) for r in conn.execute("SELECT * FROM ask_safe WHERE status = 'pending'")]
    weekly = logic_report("weekly")
    daily = logic_report("daily")
    prompt = logic_report("prompt")
    return {
        "proven_safe": safe,
        "privilege_bans": banned,
        "ask_safe": pending_safe,
        "forks": list_forks(8),
        "logic": weekly,
        "daily": daily,
        "prompt": prompt,
        "issues": list_issues(8),
        "pending_github_issues": [r for r in list_issues(8) if r.get("status") == "pending_github"],
        "rollbacks": [r for r in list_rollbacks(8) if r["status"] == "pending_approval"],
        "server_breaks": last_server_breaks(4),
        "formula": FORMULA,
    }


def inbox_extra() -> dict[str, Any]:
    return {
        "ask_safe": list_ask_safe(),
        "pending_rollbacks": [r for r in list_rollbacks(20) if r["status"] == "pending_approval"],
        "pending_issues": [r for r in list_issues(20) if r.get("status") == "pending_github"],
        "privileges": list_privileges(),
        "forks": list_forks(8),
    }
