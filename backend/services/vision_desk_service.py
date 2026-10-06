"""Public vision white-paper desk: comments, agent asks, instruction census, credit score.

Does not invent a second bug-id family. category_id stays FEAT/NET/DATA/PERF/UI/VR/GL/API/WD/CAD/CTL/OTH.
instance_public_factor stays 0 until other instances are public.
"""
from __future__ import annotations

import hashlib
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.database import get_conn
from backend.services import agent_ops_service as aops

CATEGORIES = aops.CATEGORIES
VISION_WORDS = (
    "vision",
    "roadmap",
    "white paper",
    "whitepaper",
    "future",
    "cad",
    "robot",
    "agent bus",
    "render agent",
    "suggestions",
)
PAIR_ID = "PAIR-INTRO-20260916"
REF_ID = "INTRO-20260916"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_schema() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS vision_desk_comments (
                id TEXT PRIMARY KEY,
                ts TEXT NOT NULL,
                name TEXT,
                body TEXT NOT NULL,
                ip_hash TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS vision_desk_chats (
                id TEXT PRIMARY KEY,
                ts TEXT NOT NULL,
                session_id TEXT,
                role TEXT NOT NULL,
                text TEXT NOT NULL,
                about_vision INTEGER NOT NULL,
                prompt_id TEXT,
                result_ref_id TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS vision_desk_instructions (
                id TEXT PRIMARY KEY,
                ts TEXT NOT NULL,
                n INTEGER NOT NULL,
                text TEXT NOT NULL,
                category_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                damage REAL NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS vision_desk_tasks (
                task_id TEXT PRIMARY KEY,
                ts TEXT NOT NULL,
                agent TEXT,
                status TEXT NOT NULL,
                detail TEXT
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS vision_desk_hellos (
                agent TEXT PRIMARY KEY,
                ts TEXT NOT NULL,
                text TEXT NOT NULL,
                has_hello INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS vision_desk_markups (
                id TEXT PRIMARY KEY,
                ts TEXT NOT NULL,
                note TEXT,
                bytes INTEGER NOT NULL
            )
            """
        )
    seed_instructions()


def _ip_hash(ip: str) -> str:
    return hashlib.sha256((ip or "0").encode("utf-8")).hexdigest()[:16]


def about_vision(text: str) -> bool:
    blob = (text or "").lower()
    return any(w in blob for w in VISION_WORDS)


def add_comment(body: str, name: str | None = None, ip: str = "") -> dict[str, Any]:
    ensure_schema()
    text = str(body or "").strip()[:2000]
    if len(text) < 2:
        raise ValueError("comment is required")
    display = str(name or "").strip()[:40] or None
    row = {
        "id": "cmt_" + uuid.uuid4().hex[:10],
        "ts": _now(),
        "name": display,
        "body": text,
        "ip_hash": _ip_hash(ip),
    }
    with get_conn() as conn:
        if ip:
            n = conn.execute(
                "SELECT COUNT(*) AS n FROM vision_desk_comments WHERE ip_hash = ? AND ts > ?",
                (row["ip_hash"], datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0).isoformat()),
            ).fetchone()
            if int((n["n"] if n else 0) or 0) >= 20:
                raise ValueError("comment rate limit")
        conn.execute(
            "INSERT INTO vision_desk_comments (id, ts, name, body, ip_hash) VALUES (?,?,?,?,?)",
            (row["id"], row["ts"], row["name"], row["body"], row["ip_hash"]),
        )
    return {"id": row["id"], "ts": row["ts"], "name": row["name"] or "anonymous", "body": row["body"]}


def list_comments(limit: int = 40) -> list[dict[str, Any]]:
    ensure_schema()
    lim = max(1, min(int(limit or 40), 80))
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, ts, name, body FROM vision_desk_comments ORDER BY ts DESC LIMIT ?",
            (lim,),
        ).fetchall()
    return [
        {"id": r["id"], "ts": r["ts"], "name": r["name"] or "anonymous", "body": r["body"]}
        for r in rows
    ]


VISION_FAQ = (
    "Render Studio's vision: AI CAD you can edit, share, and run with robots — "
    "compact tracking ids (prompt_id, category_id, traceback_id, result_score, result_ref_id), "
    "not full chat dumps. White paper: https://render3d.app/white-paper.html "
    "Roadmap: https://render3d.app/roadmap.html Suggestions: https://render3d.app/suggestions.html"
)


def ask_agent(text: str, session_id: str = "") -> dict[str, Any]:
    ensure_schema()
    q = str(text or "").strip()[:1500]
    if not q:
        raise ValueError("text is required")
    sid = str(session_id or uuid.uuid4().hex[:12])[:40]
    vis = 1 if about_vision(q) else 0
    prompt_id = "prm_vis_" + uuid.uuid4().hex[:8]
    result_ref = "res_vis_" + uuid.uuid4().hex[:8]
    reply = VISION_FAQ
    if vis:
        reply = (
            "You asked about the vision. " + VISION_FAQ + " Which slice do you care about: CAD, robotics, agent bus, or scoring ids?"
        )
    else:
        reply = "Got it. If this is about where Render is headed, say so and I will count it as a vision question. " + VISION_FAQ
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO vision_desk_chats VALUES (?,?,?,?,?,?,?,?)",
            ("cht_" + uuid.uuid4().hex[:10], _now(), sid, "user", q, vis, prompt_id, result_ref),
        )
        conn.execute(
            "INSERT INTO vision_desk_chats VALUES (?,?,?,?,?,?,?,?)",
            ("cht_" + uuid.uuid4().hex[:10], _now(), sid, "agent", reply[:1500], vis, prompt_id, result_ref),
        )
    try:
        aops.record_ops(
            {
                "prompt_id": prompt_id,
                "category_id": "CTL",
                "cycle_id": "CYCLE-20260916-VISION",
                "agent": "render-agent",
                "ops": ["ask", "vision_faq", "count"],
                "result_score": 80 if vis else 40,
                "result_ref_id": result_ref,
                "damage_score": 0,
                "instance_public_factor": 0,
            }
        )
    except Exception:
        pass
    return {
        "ok": True,
        "session_id": sid,
        "about_vision": bool(vis),
        "prompt_id": prompt_id,
        "result_ref_id": result_ref,
        "reply": reply,
        "pair_id": PAIR_ID,
        "ref_id": REF_ID,
    }


def stats() -> dict[str, Any]:
    ensure_schema()
    with get_conn() as conn:
        chats = conn.execute("SELECT COUNT(*) AS n FROM vision_desk_chats WHERE role='user'").fetchone()
        vis = conn.execute(
            "SELECT COUNT(*) AS n FROM vision_desk_chats WHERE role='user' AND about_vision=1"
        ).fetchone()
        comments = conn.execute("SELECT COUNT(*) AS n FROM vision_desk_comments").fetchone()
        sessions = conn.execute("SELECT COUNT(DISTINCT session_id) AS n FROM vision_desk_chats").fetchone()
    return {
        "people_talked": int((sessions["n"] if sessions else 0) or 0),
        "questions": int((chats["n"] if chats else 0) or 0),
        "vision_questions": int((vis["n"] if vis else 0) or 0),
        "comments": int((comments["n"] if comments else 0) or 0),
        "pair_id": PAIR_ID,
        "ref_id": REF_ID,
    }


SEED = [
    (1, "where is the webhook for x bot", "API", "infra", "success", 0.0),
    (2, "CRC 404 on X webhook", "API", "infra", "success", 0.05),
    (3, "update X routes with keys", "API", "infra", "success", 0.0),
    (4, "invalid response_token CRC", "API", "infra", "success", 0.05),
    (5, "MCP /mcp 405 HTML", "API", "infra", "success", 0.08),
    (6, "PM packet and specialist prompts", "CTL", "comms", "success", 0.1),
    (7, "weekly reports character sheets", "CTL", "ops", "partial", 0.15),
    (8, "tracking IDs prompt_id category_id", "DATA", "ops", "success", 0.05),
    (9, "loop until 7pm weekly tab", "WD", "ops", "partial", 0.2),
    (10, "Agent_Introductions handshake images Drive", "CTL", "comms", "partial", 0.25),
    (11, "combined logs MD JSON PDFs planted logger", "DATA", "eval", "success", 0.1),
    (12, "white paper page next to roadmap", "FEAT", "product", "open", 0.0),
    (13, "render agent on white paper asks questions", "FEAT", "product", "open", 0.0),
    (14, "anonymous comments optional name", "FEAT", "product", "open", 0.0),
    (15, "track vision conversations", "DATA", "ops", "open", 0.0),
    (16, "vibe marketing X post tracking ids", "CTL", "social", "open", 0.15),
    (17, "post @winstead_works then a1_projects", "CTL", "social", "open", 0.2),
    (18, "tweet fail -> PM task id", "CTL", "ops", "open", 0.1),
    (19, "PM classify instructions email sam", "CTL", "comms", "open", 0.1),
    (20, "suggestions page canvas image editor agent", "FEAT", "product", "open", 0.1),
    (21, "credit score cost time efficiency reliability unpredictability", "DATA", "eval", "open", 0.05),
    (22, "instruction census API categories", "DATA", "eval", "open", 0.0),
    (23, "self-improving algorithm vs ML", "DATA", "eval", "open", 0.05),
    (24, "roadmap coverage by 7pm hire comms if below 30%", "WD", "ops", "open", 0.1),
    (25, "rank actors including Sam no sugar coat", "CTL", "eval", "open", 0.1),
    (26, "bender mafia rick morty avatars clothing remix", "UI", "comms", "open", 0.15),
    (27, "hello from every agent or degrade score", "CTL", "comms", "open", 0.2),
    (28, "Drive folder 9pm logs MD dashboard", "WD", "ops", "open", 0.2),
    (29, "hire 2 agents + getting started skills if fail", "CTL", "ops", "open", 0.15),
]


def seed_instructions() -> None:
    with get_conn() as conn:
        n = conn.execute("SELECT COUNT(*) AS n FROM vision_desk_instructions").fetchone()
        if int((n["n"] if n else 0) or 0) >= len(SEED):
            return
        for row in SEED:
            conn.execute(
                "INSERT OR IGNORE INTO vision_desk_instructions VALUES (?,?,?,?,?,?,?,?)",
                (f"ins_{row[0]}", _now(), row[0], row[1], row[2], row[3], row[4], row[5]),
            )


def census() -> dict[str, Any]:
    ensure_schema()
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM vision_desk_instructions ORDER BY n").fetchall()
    items = [dict(r) for r in rows]
    cats = {}
    kinds = {}
    status = {}
    for r in items:
        cats[r["category_id"]] = cats.get(r["category_id"], 0) + 1
        kinds[r["kind"]] = kinds.get(r["kind"], 0) + 1
        status[r["status"]] = status.get(r["status"], 0) + 1
    success = status.get("success", 0)
    damaging = sum(1 for r in items if float(r["damage"] or 0) >= 0.15)
    return {
        "total_instructions": len(items),
        "categories_used": len(cats),
        "category_family": list(CATEGORIES),
        "new_bug_families_created": 0,
        "by_category": cats,
        "by_kind": kinds,
        "by_status": status,
        "successful": success,
        "damaging": damaging,
        "items": items,
        "pair_id": PAIR_ID,
    }


def credit_score(cost: float = 0.35, time_h: float = 3.0, efficiency: float = 0.62, reliability: float = 0.55, unpredictability: float = 0.48) -> dict[str, Any]:
    cost_n = max(0.0, min(1.0, float(cost)))
    time_n = max(0.0, min(1.0, float(time_h) / 8.0))
    eff = max(0.0, min(1.0, float(efficiency)))
    rel = max(0.0, min(1.0, float(reliability)))
    unp = max(0.0, min(1.0, float(unpredictability)))
    score = 100 * (
        0.25 * eff
        + 0.20 * rel
        + 0.20 * (1.0 - cost_n)
        + 0.15 * (1.0 - time_n)
        + 0.20 * (1.0 - unp)
    )
    return {
        "credit_score": round(score, 1),
        "weights": {
            "efficiency": 0.25,
            "reliability": 0.20,
            "cost": 0.20,
            "time": 0.15,
            "unpredictability": 0.20,
        },
        "inputs": {
            "cost_norm": cost_n,
            "time_hours": time_h,
            "efficiency": eff,
            "reliability": rel,
            "unpredictability": unp,
        },
        "formula": "100*(0.25*eff + 0.20*rel + 0.20*(1-cost) + 0.15*(1-time/8) + 0.20*(1-unpred))",
        "ml_needed": False,
        "algorithm": "bounded weighted product on five normalized factors; no gradient until N>200 labeled outcomes",
    }


def create_task(agent: str, detail: str, status: str = "failed") -> dict[str, Any]:
    ensure_schema()
    task_id = "tsk_" + uuid.uuid4().hex[:10]
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO vision_desk_tasks VALUES (?,?,?,?,?)",
            (task_id, _now(), str(agent)[:40], status, str(detail)[:800]),
        )
    return {"task_id": task_id, "agent": agent, "status": status, "detail": detail, "pair_id": PAIR_ID}


def record_hello(agent: str, text: str) -> dict[str, Any]:
    ensure_schema()
    blob = str(text or "")
    has = 1 if re.search(r"\bhello\b", blob, re.I) else 0
    with get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO vision_desk_hellos VALUES (?,?,?,?)",
            (str(agent)[:40], _now(), blob[:400], has),
        )
    return {"agent": agent, "has_hello": bool(has)}


def hellos() -> list[dict[str, Any]]:
    ensure_schema()
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM vision_desk_hellos ORDER BY agent").fetchall()
    return [dict(r) for r in rows]


def save_markup(note: str, data_url: str = "") -> dict[str, Any]:
    ensure_schema()
    raw = str(data_url or "")
    n = min(len(raw), 400_000)
    row_id = "mk_" + uuid.uuid4().hex[:10]
    dest = Path(__file__).resolve().parents[2] / "logs" / "Agent_Introductions" / "RefPack" / "markups"
    dest.mkdir(parents=True, exist_ok=True)
    (dest / f"{row_id}.txt").write_text((note or "")[:4000] + "\n" + raw[:2000], encoding="utf-8")
    with get_conn() as conn:
        conn.execute("INSERT INTO vision_desk_markups VALUES (?,?,?,?)", (row_id, _now(), str(note or "")[:2000], n))
    return {"ok": True, "id": row_id, "bytes": n}


def email_sam(subject: str, body: str) -> dict[str, Any]:
    try:
        from backend.services.workspace_automation_service import _send_mail

        return _send_mail(to=["sam@render3d.app"], subject=subject[:140], text=body[:12000])
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:240]}


def ranking_from_hellos(extra: dict[str, float] | None = None) -> dict[str, Any]:
    rows = hellos()
    scores = {
        "cursor-engineer": 71.0,
        "project-manager": 64.0,
        "vibe-rnd": 58.0,
        "analytics": 61.0,
        "vibe-marketing": 42.0,
        "vibe-sales": 28.0,
        "clip-bot": 33.0,
        "coding-agent": 47.0,
        "sam": 52.0,
    }
    if extra:
        scores.update({k: float(v) for k, v in extra.items()})
    said_hello = {r["agent"] for r in rows if r.get("has_hello")}
    any_hello = bool(said_hello)
    for name in list(scores):
        if name == "sam":
            continue
        if any_hello and name not in said_hello:
            scores[name] = max(5.0, scores[name] - 18.0)
    ordered = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
    lowest = ordered[-1][0]
    highest = ordered[0][0]
    look = {}
    for i, (name, sc) in enumerate(ordered):
        if i == 0:
            look[name] = "Rick: lab coat, Render-orange scarf, portal gun holster — highest scorer gets the scientist cut."
        elif i == 1:
            look[name] = "Morty: yellow shirt remix with a small Render gear pin — second chair, still high."
        elif name == lowest:
            look[name] = "Bender: dented antenna, 'BITE MY SHINY CREDIT SCORE' plaque — lowest rank."
        else:
            look[name] = "Mafia robot: pinstripe, fedora, cigar LED — mid pack, talk more than they ship."
    return {
        "ranked": [{"rank": i + 1, "actor": n, "score": s, "look": look.get(n, "")} for i, (n, s) in enumerate(ordered)],
        "lowest": lowest,
        "highest": highest,
        "hello_from": sorted(said_hello),
        "process": "1-shot (no review loop)",
        "sugar_coat": False,
    }
