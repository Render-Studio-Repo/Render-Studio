"""Latency, user-score companion, confirm-fixed taxonomy, suggestions, macro blacklist.

Does not replace debugger_analytics_service or mutate the users table.
Same sqlite. Drive archive is cold-path only — never on every prompt.
"""
from __future__ import annotations

import json
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.services import debugger_analytics_service as das

DRIVE_FOLDER_ID = "1AkXgL30YFnDG_T_2iOIyzbX4Z67A1KjS"
ARCHIVE_REL = Path("data") / "debugger" / "watchdog-archive"
ACTORS = ("grok", "harness", "api", "watchdog", "outcomes", "user")
LEAK_HITS = 3
HIGH_DAMAGE = 40
THREAT_RATIO = 1.5
THREAT_MIN = 40

# Enterprise-style category + individual ids: PERF-07-00012 or 4.07.0012
CATEGORIES: tuple[tuple[int, str, str], ...] = (
    (1, "feature_missing", "FEAT"),
    (2, "networking", "NET"),
    (3, "data", "DATA"),
    (4, "performance", "PERF"),
    (5, "ui", "UI"),
    (6, "vr", "VR"),
    (7, "webgl", "GL"),
    (8, "api", "API"),
    (9, "watchdog", "WD"),
    (10, "cad", "CAD"),
    (11, "controls", "CTL"),
    (12, "other", "OTH"),
)
SUBCATEGORIES: dict[str, dict[int, str]] = {
    "feature_missing": {1: "button", 2: "panel", 3: "model"},
    "networking": {1: "timeout", 2: "throttle", 3: "dns"},
    "data": {1: "sqlite", 2: "json", 3: "cache"},
    "performance": {1: "cpu", 2: "gpu", 3: "load", 7: "memory.leak"},
    "ui": {1: "overlay", 2: "layout", 3: "dead.button"},
    "vr": {1: "trigger", 2: "controller", 3: "hud"},
    "webgl": {1: "context", 2: "shader", 3: "buffer"},
    "api": {1: "route", 2: "auth", 3: "payload"},
    "watchdog": {1: "log", 2: "prune", 3: "throttle"},
    "cad": {1: "generate", 2: "mesh", 3: "orient"},
    "controls": {1: "gizmo", 2: "undo", 3: "hotkey"},
    "other": {1: "misc"},
}
SLUG_RE = re.compile(r"^([A-Z]{2,4})-(\d{2})-(\d{5})$")
DOTTED_RE = re.compile(r"^(\d{1,2})\.(\d{2})\.(\d{4})$")


def _ensure(conn) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS debug_user_scores (
            user_id TEXT PRIMARY KEY,
            outcome_avg REAL NOT NULL,
            user_damage REAL NOT NULL,
            grok_damage REAL NOT NULL,
            suggestions_helped INTEGER NOT NULL,
            suggestions_hurt INTEGER NOT NULL,
            risk REAL NOT NULL,
            helped_projects_json TEXT NOT NULL,
            hurt_projects_json TEXT NOT NULL,
            threat_flag INTEGER NOT NULL,
            confirm_count INTEGER NOT NULL,
            n INTEGER NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS actor_scores (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, actor TEXT NOT NULL,
            user_id TEXT, project_id TEXT, score_id TEXT,
            achieved INTEGER, damage INTEGER, outcome REAL,
            tokens_in INTEGER, tokens_out INTEGER, duration_s REAL,
            model TEXT, extra_json TEXT
        );
        CREATE TABLE IF NOT EXISTS latency_reads (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, score_id TEXT,
            actor TEXT, model TEXT, read_ms REAL,
            tokens_in INTEGER, tokens_out INTEGER, token_speed REAL,
            slowed_json TEXT, project_id TEXT
        );
        CREATE TABLE IF NOT EXISTS open_incidents (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, project_id TEXT NOT NULL,
            first_ts TEXT NOT NULL, prompt_count INTEGER NOT NULL,
            token_cost INTEGER NOT NULL, duration_s REAL NOT NULL,
            models_json TEXT NOT NULL, log_ids_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS confirm_fixed (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, user_id TEXT, project_id TEXT,
            category_id INTEGER NOT NULL, category_slug TEXT NOT NULL,
            individual_id TEXT NOT NULL, dotted_id TEXT NOT NULL,
            subcategory INTEGER NOT NULL, prompt_count INTEGER NOT NULL,
            time_to_solve_s REAL, cost_tokens INTEGER, model TEXT,
            log_ids_json TEXT, note TEXT
        );
        CREATE TABLE IF NOT EXISTS weekly_suggestions (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, proposal TEXT NOT NULL,
            status TEXT NOT NULL, fork_id TEXT, result_note TEXT, outcome_after REAL
        );
        CREATE TABLE IF NOT EXISTS method_blacklist (
            method TEXT PRIMARY KEY, ts TEXT NOT NULL, reason TEXT,
            hits INTEGER NOT NULL, damage_avg REAL NOT NULL, status TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS watchdog_archives (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, watchdog_id TEXT NOT NULL,
            local_path TEXT, drive_id TEXT, drive_folder TEXT, worked INTEGER,
            note TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_actor_scores_actor ON actor_scores(actor, ts);
        CREATE INDEX IF NOT EXISTS idx_latency_score ON latency_reads(score_id);
        CREATE INDEX IF NOT EXISTS idx_confirm_cat ON confirm_fixed(category_id, individual_id);
        CREATE INDEX IF NOT EXISTS idx_open_user ON open_incidents(user_id, project_id);
        """
    )


def _conn():
    conn = das._conn()
    _ensure(conn)
    return conn


def taxonomy() -> dict[str, Any]:
    cats = []
    for number, slug, code in CATEGORIES:
        cats.append({
            "id": number,
            "slug": slug,
            "code": code,
            "sub": SUBCATEGORIES.get(slug, {}),
            "example_dotted": f"{number}.07.0012" if slug == "performance" else f"{number}.01.0001",
            "example_slug": f"{code}-07-00012" if slug == "performance" else f"{code}-01-00001",
        })
    return {
        "format": "CODE-SS-NNNNN or C.SS.NNNN",
        "note": "Getting-Started master skill tracks category + individual id when the user confirms fixed.",
        "categories": cats,
    }


def _cat_by_slug(slug: str) -> tuple[int, str, str]:
    key = str(slug or "").strip().lower().replace("-", "_")
    aliases = {"perf": "performance", "gl": "webgl", "feat": "feature_missing", "mem": "performance", "leak": "performance"}
    key = aliases.get(key, key)
    for number, name, code in CATEGORIES:
        if key in {name, code.lower(), str(number)}:
            return number, name, code
    if key.isdigit():
        num = int(key)
        for number, name, code in CATEGORIES:
            if number == num:
                return number, name, code
    return 12, "other", "OTH"


def _sub_id(category_slug: str, subcategory: Any) -> int:
    table = SUBCATEGORIES.get(category_slug) or {1: "misc"}
    if subcategory is None or subcategory == "":
        return next(iter(table))
    if isinstance(subcategory, int) or str(subcategory).isdigit():
        num = int(subcategory)
        if num in table:
            return num
    wanted = str(subcategory).strip().lower()
    for num, name in table.items():
        if name == wanted or name.replace(".", "_") == wanted.replace(".", "_"):
            return num
    return next(iter(table))


def format_individual_id(category: int, subcategory: int, sequence: int) -> dict[str, str]:
    code = next((c for n, _s, c in CATEGORIES if n == category), "OTH")
    dotted = f"{category}.{subcategory:02d}.{sequence:04d}"
    slug = f"{code}-{subcategory:02d}-{sequence:05d}"
    return {"dotted": dotted, "slug": slug, "individual_id": slug, "category_id": category}


def parse_individual_id(value: str) -> dict[str, Any]:
    text = str(value or "").strip().upper()
    match = SLUG_RE.fullmatch(text)
    if match:
        code, sub, seq = match.group(1), int(match.group(2)), int(match.group(3))
        number = next((n for n, _s, c in CATEGORIES if c == code), 12)
        return {"ok": True, "code": code, "category_id": number, "subcategory": sub, "sequence": seq, **format_individual_id(number, sub, seq)}
    match = DOTTED_RE.fullmatch(str(value or "").strip())
    if match:
        number, sub, seq = int(match.group(1)), int(match.group(2)), int(match.group(3))
        return {"ok": True, "category_id": number, "subcategory": sub, "sequence": seq, **format_individual_id(number, sub, seq)}
    raise ValueError("individual id must look like PERF-07-00012 or 4.07.0012")


def _next_sequence(category_id: int, subcategory: int) -> int:
    with _conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS n FROM confirm_fixed WHERE category_id = ? AND subcategory = ?",
            (category_id, subcategory),
        ).fetchone()
    return int(row["n"] or 0) + 1


def record_latency(data: dict[str, Any], *, score_id: str = "") -> dict[str, Any]:
    actor = str(data.get("actor") or data.get("source") or "harness").strip().lower()
    if actor not in ACTORS:
        actor = "harness"
    read_ms = float(data.get("read_ms") or data.get("latency_ms") or data.get("log_read_ms") or 0)
    tokens_in = int(data.get("tokens_in") or data.get("input_tokens") or 0)
    tokens_out = int(data.get("tokens_out") or data.get("output_tokens") or 0)
    duration_s = float(data.get("duration_s") or data.get("seconds") or 0)
    token_speed = float(data.get("token_speed") or 0)
    if not token_speed and duration_s > 0 and (tokens_in or tokens_out):
        token_speed = round((tokens_in + tokens_out) / duration_s, 2)
    slowed = data.get("slowed") or []
    if isinstance(slowed, str):
        slowed = [part.strip() for part in slowed.split(",") if part.strip()]
    if not isinstance(slowed, list):
        slowed = []
    if data.get("projects_slow"):
        slowed.append("projects_loading")
    if data.get("token_increase"):
        slowed.append("token_increase")
    if data.get("prompt_longer"):
        slowed.append("prompt_longer")
    slowed = [das._excerpt(item, 40) for item in slowed][:8]
    row = {
        "id": uuid.uuid4().hex,
        "ts": das.now(),
        "score_id": score_id or str(data.get("score_id") or "")[:80],
        "actor": actor,
        "model": das._excerpt(data.get("model") or data.get("harness_model") or "", 80),
        "read_ms": round(read_ms, 2),
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "token_speed": token_speed,
        "slowed": slowed,
        "project_id": str(data.get("project_id") or "")[:80],
    }
    with _conn() as conn:
        conn.execute(
            "INSERT INTO latency_reads VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (row["id"], row["ts"], row["score_id"], actor, row["model"], row["read_ms"], tokens_in, tokens_out, token_speed, das._json(slowed), row["project_id"]),
        )
    return row


def list_latency(limit: int = 20) -> list[dict[str, Any]]:
    with _conn() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM latency_reads ORDER BY ts DESC LIMIT ?", (max(1, min(limit, 40)),))]
    for row in rows:
        row["slowed"] = json.loads(row.pop("slowed_json") or "[]")
    return rows


def _touch_user(user_id: str, *, achieved: int, damage: int, outcome: float, actor: str, project_id: str, confirmed: bool = False) -> dict[str, Any]:
    uid = str(user_id or "").strip()[:80]
    if not uid:
        raise ValueError("user_id is required")
    with _conn() as conn:
        existing = conn.execute("SELECT * FROM debug_user_scores WHERE user_id = ?", (uid,)).fetchone()
        if existing:
            row = dict(existing)
            n = int(row["n"]) + 1
            outcome_avg = round((float(row["outcome_avg"]) * int(row["n"]) + float(outcome)) / n, 2)
            user_damage = float(row["user_damage"])
            grok_damage = float(row["grok_damage"])
            if actor in {"user"}:
                user_damage = round(user_damage + float(damage), 2)
            else:
                grok_damage = round(grok_damage + float(damage), 2)
            helped = json.loads(row["helped_projects_json"] or "[]")
            hurt = json.loads(row["hurt_projects_json"] or "[]")
            confirm_count = int(row["confirm_count"]) + (1 if confirmed else 0)
        else:
            n = 1
            outcome_avg = float(outcome)
            user_damage = float(damage) if actor == "user" else 0.0
            grok_damage = float(damage) if actor != "user" else 0.0
            helped, hurt = [], []
            confirm_count = 1 if confirmed else 0
        if project_id:
            bucket = helped if outcome >= 70 and damage < HIGH_DAMAGE else hurt
            if project_id not in bucket:
                bucket.append(project_id[:80])
            helped, hurt = helped[-12:], hurt[-12:]
        risk = round(min(100.0, user_damage * 0.6 + (100 - outcome_avg) * 0.4), 2)
        threat = int(user_damage >= THREAT_MIN and user_damage > grok_damage * THREAT_RATIO)
        payload = (
            uid, outcome_avg, user_damage, grok_damage,
            0 if not existing else int(existing["suggestions_helped"]),
            0 if not existing else int(existing["suggestions_hurt"]),
            risk, das._json(helped), das._json(hurt), threat, confirm_count, n, das.now(),
        )
        conn.execute(
            """INSERT INTO debug_user_scores VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(user_id) DO UPDATE SET
                 outcome_avg=excluded.outcome_avg, user_damage=excluded.user_damage,
                 grok_damage=excluded.grok_damage, risk=excluded.risk,
                 helped_projects_json=excluded.helped_projects_json,
                 hurt_projects_json=excluded.hurt_projects_json,
                 threat_flag=excluded.threat_flag, confirm_count=excluded.confirm_count,
                 n=excluded.n, updated_at=excluded.updated_at""",
            payload,
        )
    return get_user_score(uid) or {}


def get_user_score(user_id: str) -> dict[str, Any] | None:
    with _conn() as conn:
        row = conn.execute("SELECT * FROM debug_user_scores WHERE user_id = ?", (str(user_id),)).fetchone()
    if not row:
        return None
    data = dict(row)
    data["helped_projects"] = json.loads(data.pop("helped_projects_json") or "[]")
    data["hurt_projects"] = json.loads(data.pop("hurt_projects_json") or "[]")
    data["threat_flag"] = bool(data["threat_flag"])
    data["threat_note"] = "derived flag only — not a ban; Sam decides"
    return data


def list_user_scores(limit: int = 20) -> list[dict[str, Any]]:
    with _conn() as conn:
        rows = conn.execute("SELECT user_id FROM debug_user_scores ORDER BY updated_at DESC LIMIT ?", (max(1, min(limit, 40)),)).fetchall()
    return [get_user_score(r["user_id"]) for r in rows if r["user_id"]]


def record_actor_score(data: dict[str, Any], *, score_id: str = "") -> dict[str, Any]:
    actor = str(data.get("actor") or data.get("source") or "outcomes").strip().lower()
    if actor not in ACTORS:
        actor = "outcomes"
    row = {
        "id": uuid.uuid4().hex,
        "ts": das.now(),
        "actor": actor,
        "user_id": str(data.get("user_id") or "")[:80],
        "project_id": str(data.get("project_id") or "")[:80],
        "score_id": score_id or str(data.get("score_id") or "")[:80],
        "achieved": int(data.get("score") or data.get("achieved") or 0),
        "damage": int(data.get("damage") or data.get("damage_score") or 0),
        "outcome": float(data.get("outcome") or 0),
        "tokens_in": int(data.get("tokens_in") or 0),
        "tokens_out": int(data.get("tokens_out") or 0),
        "duration_s": float(data.get("duration_s") or 0),
        "model": das._excerpt(data.get("model") or "", 80),
        "extra": {"label": data.get("label") or ""},
    }
    with _conn() as conn:
        conn.execute(
            "INSERT INTO actor_scores VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (row["id"], row["ts"], actor, row["user_id"], row["project_id"], row["score_id"], row["achieved"], row["damage"], row["outcome"], row["tokens_in"], row["tokens_out"], row["duration_s"], row["model"], das._json(row["extra"])),
        )
    return row


def list_actor_scores(actor: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
    with _conn() as conn:
        if actor:
            rows = conn.execute("SELECT * FROM actor_scores WHERE actor = ? ORDER BY ts DESC LIMIT ?", (actor, max(1, min(limit, 40))))
        else:
            rows = conn.execute("SELECT * FROM actor_scores ORDER BY ts DESC LIMIT ?", (max(1, min(limit, 40)),))
        out = [dict(r) for r in rows]
    for row in out:
        row["extra"] = json.loads(row.pop("extra_json") or "{}")
    return out


def _bump_open(user_id: str, project_id: str, data: dict[str, Any], score_row: dict[str, Any]) -> dict[str, Any]:
    uid = str(user_id or "").strip()[:80]
    pid = str(project_id or "").strip()[:80]
    if not uid or not pid:
        return {}
    log_id = str(score_row.get("log_id") or data.get("log_id") or "")[:80]
    tokens = int(data.get("token_cost") or score_row.get("token_cost") or 0)
    duration = float(data.get("duration_s") or score_row.get("duration_s") or 0)
    model = das._excerpt(data.get("model") or "", 80)
    with _conn() as conn:
        existing = conn.execute("SELECT * FROM open_incidents WHERE user_id = ? AND project_id = ?", (uid, pid)).fetchone()
        if existing:
            logs = json.loads(existing["log_ids_json"] or "[]")
            models = json.loads(existing["models_json"] or "[]")
            if log_id and log_id not in logs:
                logs.append(log_id)
            if model and model not in models:
                models.append(model)
            conn.execute(
                "UPDATE open_incidents SET prompt_count = prompt_count + 1, token_cost = token_cost + ?, duration_s = duration_s + ?, models_json = ?, log_ids_json = ? WHERE id = ?",
                (tokens, duration, das._json(models[-8:]), das._json(logs[-24:]), existing["id"]),
            )
            ident = existing["id"]
            count = int(existing["prompt_count"]) + 1
        else:
            ident = uuid.uuid4().hex
            conn.execute(
                "INSERT INTO open_incidents VALUES (?,?,?,?,?,?,?,?,?)",
                (ident, uid, pid, das.now(), 1, tokens, duration, das._json([model] if model else []), das._json([log_id] if log_id else [])),
            )
            count = 1
    return {"open_incident_id": ident, "prompt_count": count}


def confirm_fixed(data: dict[str, Any]) -> dict[str, Any]:
    uid = str(data.get("user_id") or "").strip()[:80]
    pid = str(data.get("project_id") or data.get("project") or "").strip()[:80]
    if not uid:
        raise ValueError("confirm-fixed needs user_id")
    if not pid:
        raise ValueError("confirm-fixed needs project_id")
    number, slug, _code = _cat_by_slug(str(data.get("category") or data.get("category_id") or "other"))
    sub = _sub_id(slug, data.get("subcategory") or data.get("sub"))
    sequence = _next_sequence(number, sub)
    ids = format_individual_id(number, sub, sequence)
    with _conn() as conn:
        open_row = conn.execute("SELECT * FROM open_incidents WHERE user_id = ? AND project_id = ?", (uid, pid)).fetchone()
    prompt_count = int(data.get("prompt_count") or (open_row["prompt_count"] if open_row else 1))
    time_s = float(data.get("time_to_solve_s") or (open_row["duration_s"] if open_row else 0) or 0)
    cost = int(data.get("cost_tokens") or (open_row["token_cost"] if open_row else 0) or 0)
    model = ""
    logs: list[str] = das._ids(data.get("log_ids") or [])
    if open_row:
        models = json.loads(open_row["models_json"] or "[]")
        model = models[-1] if models else ""
        if not logs:
            logs = json.loads(open_row["log_ids_json"] or "[]")
    row = {
        "id": "fix_" + uuid.uuid4().hex[:10],
        "ts": das.now(),
        "user_id": uid,
        "project_id": pid,
        "category_id": number,
        "category_slug": slug,
        "individual_id": ids["slug"],
        "dotted_id": ids["dotted"],
        "subcategory": sub,
        "prompt_count": prompt_count,
        "time_to_solve_s": round(time_s, 2),
        "cost_tokens": cost,
        "model": model or das._excerpt(data.get("model") or "", 80),
        "log_ids": logs,
        "note": das._excerpt(data.get("note") or "user confirmed fixed", 160),
    }
    with _conn() as conn:
        conn.execute(
            "INSERT INTO confirm_fixed VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (row["id"], row["ts"], uid, pid, number, slug, row["individual_id"], row["dotted_id"], sub, prompt_count, time_s, cost, row["model"], das._json(logs), row["note"]),
        )
        if open_row:
            conn.execute("DELETE FROM open_incidents WHERE id = ?", (open_row["id"],))
    user = _touch_user(uid, achieved=90, damage=0, outcome=90, actor="user", project_id=pid, confirmed=True)
    row["user"] = {"confirm_count": user.get("confirm_count"), "outcome_avg": user.get("outcome_avg")}
    try:
        from backend.services import debugger_swarm_service as dss

        sub_name = (SUBCATEGORIES.get(slug) or {}).get(sub) or str(data.get("subcategory") or sub)
        row["swarm"] = dss.ingest_live_outcome({
            "user_id": uid,
            "project_id": pid,
            "agent_id": data.get("agent_id") or "cursor",
            "instance_id": data.get("instance_id") or dss.LOCAL_AREA,
            "category": slug,
            "subcategory": sub_name,
            "score": 90,
            "fixed": [slug, str(sub_name)],
            "log_id": (logs[-1] if logs else row["individual_id"]),
        }, {"score": 90, "fixed": [slug, str(sub_name)], "label": "achieved"})
    except Exception:
        pass
    try:
        from backend.services import debugger_cost_service as dcs

        row["cost_report"] = dcs.close_session({
            **data,
            "trigger": "confirm_fixed",
            "project_id": pid,
            "log_ids": logs,
            "token_cost": cost,
            "duration_s": time_s,
            "prompt_count": prompt_count,
            "score": 90,
            "outcome": 90,
            "damage": 0,
        })
    except Exception:
        pass
    return row


def list_confirms(limit: int = 20) -> list[dict[str, Any]]:
    with _conn() as conn:
        rows = [dict(r) for r in conn.execute("SELECT * FROM confirm_fixed ORDER BY ts DESC LIMIT ?", (max(1, min(limit, 40)),))]
    for row in rows:
        row["log_ids"] = json.loads(row.pop("log_ids_json") or "[]")
    return rows


def create_suggestion(data: dict[str, Any] | str) -> dict[str, Any]:
    if isinstance(data, str):
        data = {"proposal": data}
    proposal = das._excerpt(data.get("proposal") or data.get("note") or "", 240)
    if not proposal:
        raise ValueError("suggestion needs a proposal")
    row = {
        "id": "sug_" + uuid.uuid4().hex[:10],
        "ts": das.now(),
        "proposal": proposal,
        "status": "pending",
        "fork_id": str(data.get("fork_id") or "")[:40],
        "result_note": "",
        "outcome_after": None,
    }
    with _conn() as conn:
        conn.execute(
            "INSERT INTO weekly_suggestions VALUES (?,?,?,?,?,?,?)",
            (row["id"], row["ts"], proposal, "pending", row["fork_id"], "", None),
        )
    return row


def decide_suggestion(sid: str, *, action: str, note: str = "", fork_id: str = "", outcome_after: float | None = None) -> dict[str, Any]:
    action = str(action or "").strip().lower()
    if action not in {"take", "taken", "override", "overridden"}:
        raise ValueError("action must be take or override")
    status = "taken" if action.startswith("take") else "overridden"
    with _conn() as conn:
        row = conn.execute("SELECT * FROM weekly_suggestions WHERE id = ?", (sid,)).fetchone()
        if not row:
            raise ValueError("suggestion not found")
        fid = fork_id or row["fork_id"] or ""
        if status == "overridden" and not fid:
            from backend.services import debugger_privilege_service as dps

            fork = dps.create_fork({"override_note": note or row["proposal"], "parent_tracking_id": sid})
            fid = fork["id"]
        conn.execute(
            "UPDATE weekly_suggestions SET status = ?, fork_id = ?, result_note = ?, outcome_after = ? WHERE id = ?",
            (status, fid, das._excerpt(note, 160), outcome_after, sid),
        )
        if status == "taken":
            conn.execute("UPDATE debug_user_scores SET suggestions_helped = suggestions_helped + 1")
        else:
            conn.execute("UPDATE debug_user_scores SET suggestions_hurt = suggestions_hurt + 1")
    data = dict(row)
    data["status"] = status
    data["fork_id"] = fid
    data["result_note"] = das._excerpt(note, 160)
    data["outcome_after"] = outcome_after
    return data


def list_suggestions(status: str | None = None, limit: int = 20) -> list[dict[str, Any]]:
    with _conn() as conn:
        if status:
            rows = conn.execute("SELECT * FROM weekly_suggestions WHERE status = ? ORDER BY ts DESC LIMIT ?", (status, max(1, min(limit, 40))))
        else:
            rows = conn.execute("SELECT * FROM weekly_suggestions ORDER BY ts DESC LIMIT ?", (max(1, min(limit, 40)),))
        return [dict(r) for r in rows]


def note_blacklist_hit(method: str, *, damage: int, leak: bool = False, reason: str = "") -> dict[str, Any]:
    method = str(method or "").strip().lower()[:80]
    if not method:
        return {}
    leak_like = leak or "leak" in method or "memory" in method
    if int(damage) < HIGH_DAMAGE:
        return {"method": method, "ignored": True}
    with _conn() as conn:
        existing = conn.execute("SELECT * FROM method_blacklist WHERE method = ?", (method,)).fetchone()
        if existing and existing["status"] == "restored":
            hits = 1
            avg = float(damage)
        elif existing:
            hits = int(existing["hits"]) + 1
            avg = round((float(existing["damage_avg"]) * int(existing["hits"]) + float(damage)) / hits, 2)
        else:
            hits = 1
            avg = float(damage)
        status = "banned" if hits >= LEAK_HITS else "watching"
        note = das._excerpt(reason or ("repeated leak-like damage" if leak_like else "macro loop never helped"), 160)
        conn.execute(
            """INSERT INTO method_blacklist VALUES (?,?,?,?,?,?)
               ON CONFLICT(method) DO UPDATE SET ts=excluded.ts, reason=excluded.reason,
                 hits=excluded.hits, damage_avg=excluded.damage_avg, status=excluded.status""",
            (method, das.now(), note, hits, avg, status),
        )
        if status == "banned":
            try:
                from backend.services import debugger_privilege_service as dps

                if method in dps.PRIVILEGE_KEYS:
                    dps.ban_privilege(method, reason=note)
            except Exception:
                pass
    return {"method": method, "hits": hits, "damage_avg": avg, "status": status, "restore_needs_sam": True}


def restore_blacklist(method: str) -> dict[str, Any]:
    method = str(method or "").strip().lower()
    with _conn() as conn:
        row = conn.execute("SELECT * FROM method_blacklist WHERE method = ?", (method,)).fetchone()
        if not row:
            raise ValueError("method is not blacklisted")
        conn.execute("UPDATE method_blacklist SET status = 'restored', hits = 0 WHERE method = ?", (method,))
    return {"method": method, "status": "restored", "restore_needs_sam": False, "note": "Sam restored; autonomous writes still need mark-safe"}


def list_blacklist(status: str | None = None) -> list[dict[str, Any]]:
    with _conn() as conn:
        if status:
            rows = conn.execute("SELECT * FROM method_blacklist WHERE status = ? ORDER BY ts DESC", (status,))
        else:
            rows = conn.execute("SELECT * FROM method_blacklist ORDER BY ts DESC")
        return [dict(r) for r in rows]


def macro_scan() -> dict[str, Any]:
    """Detect debug loops that never helped and auto-blacklist high-damage methods."""
    with _conn() as conn:
        uses = [dict(r) for r in conn.execute("SELECT method, damage, outcome FROM privilege_uses ORDER BY ts DESC LIMIT 40")]
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in uses:
        grouped.setdefault(row["method"], []).append(row)
    flagged = []
    for method, rows in grouped.items():
        recent = rows[:5]
        if len(recent) < LEAK_HITS:
            continue
        if all(float(r["outcome"] or 0) < 40 and float(r["damage"] or 0) >= HIGH_DAMAGE for r in recent[:LEAK_HITS]):
            existing = next((b for b in list_blacklist() if b["method"] == method), None)
            if existing:
                flagged.append(existing)
                continue
            leak = "leak" in method or "memory" in method
            flagged.append(note_blacklist_hit(method, damage=int(recent[0]["damage"] or HIGH_DAMAGE), leak=leak, reason="macro: loop never helped"))
    return {"flagged": flagged, "scanned": len(uses)}


def archive_watchdog(wid: str, *, worked: bool = False, upload_drive: bool = False, note: str = "") -> dict[str, Any]:
    watchdog = das.get_watchdog(wid) or {"id": wid}
    root = das.ROOT_DIR / ARCHIVE_REL
    root.mkdir(parents=True, exist_ok=True)
    payload = {
        "watchdog_id": wid,
        "ts": das.now(),
        "worked": bool(worked or watchdog.get("helped")),
        "kind": watchdog.get("kind"),
        "title": watchdog.get("title"),
        "status": watchdog.get("status"),
        "note": das._excerpt(note or watchdog.get("note") or "", 160),
        "drive_folder": DRIVE_FOLDER_ID,
    }
    path = root / f"{wid}.json"
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    folder = das.ROOT_DIR / str(watchdog.get("folder") or "")
    if folder.is_dir() and (folder / "spec.json").is_file():
        shutil.copy2(folder / "spec.json", root / f"{wid}.spec.json")
    drive_id = ""
    if upload_drive:
        drive_id = _try_drive_upload(path, title=f"watchdog-{wid}.json")
    row = {
        "id": uuid.uuid4().hex,
        "ts": das.now(),
        "watchdog_id": wid,
        "local_path": str(path.relative_to(das.ROOT_DIR)) if path.is_file() else "",
        "drive_id": drive_id,
        "drive_folder": DRIVE_FOLDER_ID,
        "worked": bool(payload["worked"]),
        "note": payload["note"],
    }
    with _conn() as conn:
        conn.execute(
            "INSERT INTO watchdog_archives VALUES (?,?,?,?,?,?,?,?)",
            (row["id"], row["ts"], wid, row["local_path"], drive_id, DRIVE_FOLDER_ID, int(row["worked"]), row["note"]),
        )
    return row


def finish_watchdog(wid: str, *, worked: bool = False) -> dict[str, Any]:
    """Prune tmp logs, archive the spec, delete the live folder. Drive stays cold-path."""
    pruned = das.prune_watchdog(wid)
    archived = pruned.get("archive") if isinstance(pruned, dict) else None
    if not archived:
        archived = archive_watchdog(wid, worked=worked, upload_drive=False)
    elif worked and isinstance(archived, dict):
        archived["worked"] = True
    watchdog = das.get_watchdog(wid)
    deleted = False
    if watchdog and watchdog.get("folder"):
        folder = das.ROOT_DIR / watchdog["folder"]
        if folder.is_dir():
            shutil.rmtree(folder, ignore_errors=True)
            deleted = True
    with _conn() as conn:
        conn.execute("UPDATE watchdogs SET status = 'retired' WHERE id = ?", (wid,))
    return {"ok": True, "id": wid, "pruned": pruned, "archive": archived, "deleted_tmp": deleted, "drive_hot_path": False}


def _try_drive_upload(path: Path, *, title: str) -> str:
    return ""


def note_score(score_row: dict[str, Any], data: dict[str, Any] | None = None) -> dict[str, Any]:
    data = data or {}
    extras: dict[str, Any] = {}
    has_latency = any(k in data for k in ("read_ms", "latency_ms", "log_read_ms", "model", "tokens_in", "tokens_out", "slowed", "projects_slow", "token_increase", "prompt_longer"))
    if has_latency:
        extras["latency"] = record_latency(data, score_id=str(score_row.get("id") or ""))
    actor = str(data.get("actor") or data.get("source") or "").strip().lower()
    if actor in ACTORS or has_latency:
        extras["actor_score"] = record_actor_score({**data, "score": score_row.get("score"), "damage": data.get("damage") or score_row.get("damage_score") or 0, "outcome": score_row.get("outcome") or score_row.get("score") or 0, "label": score_row.get("label")}, score_id=str(score_row.get("id") or ""))
    uid = str(data.get("user_id") or "").strip()
    pid = str(score_row.get("project_id") or data.get("project_id") or "")
    if uid:
        extras["user"] = _touch_user(
            uid,
            achieved=int(score_row.get("score") or 0),
            damage=int(data.get("damage") or score_row.get("damage_score") or 0),
            outcome=float(score_row.get("outcome") or score_row.get("score") or 0),
            actor=actor if actor in ACTORS else "grok",
            project_id=pid,
        )
        extras.update(_bump_open(uid, pid, data, score_row))
    method = str(data.get("method") or data.get("privilege") or "")
    damage = int(data.get("damage") or score_row.get("damage_score") or 0)
    leak = bool(data.get("leak") or "leak" in method or "memory" in method)
    if method and damage >= HIGH_DAMAGE:
        extras["blacklist"] = note_blacklist_hit(method, damage=damage, leak=leak)
    return extras


def weekly_addon() -> dict[str, Any]:
    scan = macro_scan()
    pending = list_suggestions("pending", 8)
    return {
        "suggestions": pending,
        "suggestion_taken": list_suggestions("taken", 6),
        "suggestion_overridden": list_suggestions("overridden", 6),
        "blacklist": list_blacklist("banned"),
        "confirms": [{"individual_id": c["individual_id"], "dotted_id": c["dotted_id"], "category": c["category_slug"]} for c in list_confirms(8)],
        "macro": scan,
        "drive_folder": DRIVE_FOLDER_ID,
        "drive_hot_path": False,
    }


def inbox_extra() -> dict[str, Any]:
    return {
        "pending_suggestions": list_suggestions("pending", 12),
        "blacklist": list_blacklist("banned"),
        "threat_users": [u for u in list_user_scores(12) if u and u.get("threat_flag")],
    }


def overview_addon() -> dict[str, Any]:
    latency = list_latency(8)
    return {
        "latency": [{"id": r["id"], "actor": r["actor"], "model": r["model"], "read_ms": r["read_ms"], "token_speed": r["token_speed"], "slowed": r.get("slowed") or []} for r in latency],
        "actors": {name: len(list_actor_scores(name, 40)) for name in ("grok", "harness", "api", "watchdog", "outcomes")},
        "users": [{"user_id": u["user_id"], "outcome_avg": u["outcome_avg"], "user_damage": u["user_damage"], "grok_damage": u["grok_damage"], "threat_flag": u["threat_flag"], "confirm_count": u["confirm_count"]} for u in list_user_scores(8) if u],
        "taxonomy": {"format": "PERF-07-00012 | 4.07.0012", "categories": [c[1] for c in CATEGORIES]},
        "blacklist": list_blacklist("banned"),
        "suggestions": list_suggestions("pending", 6),
        "confirms": list_confirms(6),
    }


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
