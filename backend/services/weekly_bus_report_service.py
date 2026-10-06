"""Weekly bus reports for the debugger dashboard (agent cycle + Cursor outcome)."""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.database import get_conn
from backend.services import debugger_analytics_service as das

ROOT = Path(__file__).resolve().parents[2]
REPORT_MD = ROOT / "ai-context" / "debugger" / "incident-intelligence" / "weekly"
INBOX = ROOT / "ai-context" / "agent-bus" / "inbox"
OPS_JSONL = ROOT / "ai-context" / "agent-bus" / "ops.jsonl"
SCHEMA = "rs.weekly.v1"

# Features Sam asked for across 16 Sep 2026 prompts (Cursor self-score).
CURSOR_FEATURES = [
    {"id": "x_webhook_crc", "asked": True, "status": "built", "note": "CRC + plus-safe query, live 200"},
    {"id": "x_keys_env", "asked": True, "status": "built", "note": "X_CONSUMER_* aliases"},
    {"id": "mcp_streamable_http", "asked": True, "status": "built", "note": "POST initialize / tools on /mcp"},
    {"id": "agent_star_bus", "asked": True, "status": "built", "note": "PM battery + SCORECARD + inbox"},
    {"id": "same_questions", "asked": True, "status": "built", "note": "Fan-out via grok_chat MCP"},
    {"id": "mcp_score_return", "asked": True, "status": "built", "note": "agent_bus_submit + agent_ops_submit"},
    {"id": "ops_ids", "asked": True, "status": "built", "note": "prompt_id category traceback result_ref similarity damage"},
    {"id": "instance_factor_zero", "asked": True, "status": "built", "note": "instance_public_factor=0"},
    {"id": "md_folder", "asked": True, "status": "built", "note": "Getting-Started/agents/"},
    {"id": "first_written_report", "asked": True, "status": "built", "note": "REPORT-CYCLE-20260916-1618.md"},
    {"id": "weekly_tab", "asked": True, "status": "built", "note": "Debugger Weekly reports tab"},
    {"id": "well_not_well_charts", "asked": True, "status": "built", "note": "green/coral charts"},
    {"id": "agent_headcount", "asked": True, "status": "built", "note": "keep 7, add 3 later"},
    {"id": "cursor_outcome_score", "asked": True, "status": "built", "note": "this inventory"},
    {"id": "pm_read_analytics", "asked": True, "status": "built", "note": "PROMPT-project-manager + START-EVERY-PROMPT"},
    {"id": "log_size_forecast", "asked": True, "status": "built", "note": "month/year guess"},
    {"id": "playwright_clip_loop", "asked": True, "status": "missed", "note": "agents flagged; not closed"},
    {"id": "gmail_weekly_stats", "asked": True, "status": "missed", "note": "grok_social_weekly exists; not wired to this tab"},
    {"id": "grok_imagine_renders", "asked": True, "status": "skipped", "note": "prompts only; no image gen from Cursor"},
    {"id": "x_webhook_env_register", "asked": True, "status": "skipped", "note": "no X_WEBHOOK_ENV; portal still human"},
    {"id": "auto_fire_agents", "asked": True, "status": "skipped", "note": "league stays pending_sam on purpose"},
    {"id": "second_id_family", "asked": True, "status": "skipped", "note": "bad idea — reuse taxonomy"},
    {"id": "specialist_side_dms", "asked": True, "status": "skipped", "note": "bad idea — star bus only"},
    {"id": "full_debug_autonomy", "asked": True, "status": "missed", "note": "instrumentation only"},
]

AGENTS_PLAN = {
    "keep": ["project-manager", "vibe-marketing", "vibe-sales", "vibe-rnd", "analytics", "clip-bot", "cursor-engineer"],
    "add_later": ["qa-verify", "docs", "xr-field"],
    "delta": 3,
    "now_count": 7,
    "later_count": 10,
}


def ensure_schema() -> None:
    with get_conn() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS weekly_bus_reports (
                id TEXT PRIMARY KEY,
                ts TEXT NOT NULL,
                week_start TEXT NOT NULL,
                title TEXT NOT NULL,
                body_json TEXT NOT NULL
            )
            """
        )


def _now() -> str:
    return das.now()


def footprint() -> dict[str, Any]:
    """Bytes we created this session vs cold prompt-trace zip risk."""
    bus = 0
    for p in (ROOT / "ai-context" / "agent-bus").rglob("*"):
        if p.is_file():
            bus += p.stat().st_size
    worklog = ROOT / "ai-context" / "worklog.md"
    wl = worklog.stat().st_size if worklog.is_file() else 0
    db = ROOT / "data" / "render3d.db"
    dbn = db.stat().st_size if db.is_file() else 0
    # This period ≈ bus + new weekly md + ops rows (not the 8MB chat zip).
    period = bus + 12_000
    return {
        "period_bytes": period,
        "agent_bus_bytes": bus,
        "worklog_bytes": wl,
        "render3d_db_bytes": dbn,
        "month_guess_bytes": int(bus * 30 + 2_000_000),
        "year_guess_bytes": int(bus * 365 + 25_000_000),
        "scalable": True,
        "scalable_note": (
            "agent_ops sqlite + jsonl are fine at 1 cycle/day. "
            "Not scalable: duplicating XR jsonl under data/ and ai-context/, "
            "and unbounded prompt-trace zip (~8MB already). Rotate jsonl at 2MB; keep zip cold."
        ),
    }


def _cursor_outcome() -> dict[str, Any]:
    built = [f for f in CURSOR_FEATURES if f["status"] == "built"]
    missed = [f for f in CURSOR_FEATURES if f["status"] == "missed"]
    skipped = [f for f in CURSOR_FEATURES if f["status"] == "skipped"]
    asked = len(CURSOR_FEATURES)
    score = round(100 * len(built) / asked) if asked else 0
    return {
        "asked": asked,
        "built": len(built),
        "missed": len(missed),
        "skipped_on_purpose": len(skipped),
        "score": score,
        "label": "partial" if score < 80 else "achieved",
        "features": CURSOR_FEATURES,
        "how_to_read": (
            "score = built / asked × 100. skipped_on_purpose is not a miss "
            "(second IDs, auto-fire, side DMs). missed is still owed (clips, Gmail tab, autonomy)."
        ),
    }


def _agent_impressions() -> list[dict[str, Any]]:
    out = []
    if not INBOX.is_dir():
        return out
    for path in sorted(INBOX.glob("CYCLE-20260916-2113-*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        pkt = data.get("packet") if isinstance(data.get("packet"), dict) else data
        out.append(
            {
                "agent": data.get("agent") or pkt.get("agent"),
                "likelihood_succeed": pkt.get("likelihood_succeed"),
                "why": pkt.get("why"),
                "gap": pkt.get("gap"),
                "hate": pkt.get("hate"),
                "capability": {
                    "project-manager": "Route same battery; emit PM_PACKET",
                    "vibe-marketing": "Draft X/Discord from MARKETING.md",
                    "vibe-sales": "Talk tracks + real URLs",
                    "vibe-rnd": "Smallest experiment + verify plan",
                    "analytics": "Join log_id/project_id; rs.ops.v1",
                    "clip-bot": "Shot lists; no paid Generate",
                }.get(str(data.get("agent") or ""), ""),
            }
        )
    return out


def well_not_well() -> dict[str, Any]:
    return {
        "well": [
            {"key": "infra", "value": 5, "note": "Live /mcp + webhook CRC"},
            {"key": "comms", "value": 5, "note": "Star bus, no side DMs"},
            {"key": "taxonomy", "value": 5, "note": "No second id family"},
            {"key": "ops_ids", "value": 4, "note": "First prm_ops_bus_1 sample"},
        ],
        "not_well": [
            {"key": "clip_loop", "value": 2, "note": "Playwright clip still open"},
            {"key": "autonomy", "value": 2, "note": "Sam still in the loop"},
            {"key": "gmail_tab", "value": 1, "note": "Social weekly not in this dashboard"},
            {"key": "instances", "value": 1, "note": "public factor 0"},
        ],
    }


def first_body() -> dict[str, Any]:
    outcome = _cursor_outcome()
    return {
        "schema": SCHEMA,
        "title": "Week of 2026-09-15 · agent bus + debugger",
        "week_start": "2026-09-15",
        "cycle_id": "CYCLE-20260916-1618",
        "prompt_id": "prm_ops_bus_1",
        "category_id": "DATA",
        "published_at": _now(),
        "charts": well_not_well(),
        "agents": _agent_impressions(),
        "headcount": AGENTS_PLAN,
        "cursor": outcome,
        "logs": footprint(),
        "pm_read": (
            "1) Charts: green = well, coral = not well (1–5). "
            "2) Cursor outcome score is built/asked, not league credit. "
            "3) Agent likelihood 1–5 from CYCLE-20260916-2113. "
            "4) Tickets still only FEAT/NET/DATA/PERF/UI/VR/GL/API/WD/CAD/CTL/OTH. "
            "5) instance_public_factor stays 0 until other Studio instances exist."
        ),
    }


def publish(body: dict[str, Any] | None = None) -> dict[str, Any]:
    ensure_schema()
    payload = body or first_body()
    rid = str(payload.get("id") or "wk_" + uuid.uuid4().hex[:10])
    week = str(payload.get("week_start") or datetime.now(timezone.utc).date().isoformat())
    title = str(payload.get("title") or "Weekly bus")[:160]
    payload["id"] = rid
    payload["schema"] = SCHEMA
    REPORT_MD.mkdir(parents=True, exist_ok=True)
    md = REPORT_MD / f"bus-{week}.md"
    lines = [
        f"# {title}",
        f"id: {rid}",
        f"Cursor outcome: {payload.get('cursor', {}).get('score')} / 100 ({payload.get('cursor', {}).get('built')} built / {payload.get('cursor', {}).get('asked')} asked).",
        "",
        payload.get("pm_read") or "",
    ]
    md.write_text("\n".join(lines) + "\n", encoding="utf-8")
    with get_conn() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO weekly_bus_reports (id, ts, week_start, title, body_json) VALUES (?,?,?,?,?)",
            (rid, _now(), week, title, json.dumps(payload)),
        )
    try:
        payload["report_path"] = str(md.relative_to(ROOT))
    except ValueError:
        payload["report_path"] = str(md)
    return payload


def list_reports(limit: int = 12) -> list[dict[str, Any]]:
    ensure_schema()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, ts, week_start, title, body_json FROM weekly_bus_reports ORDER BY ts DESC LIMIT ?",
            (max(1, min(int(limit or 12), 30)),),
        ).fetchall()
    out = []
    for row in rows:
        try:
            body = json.loads(row["body_json"])
        except json.JSONDecodeError:
            body = {}
        body["id"] = row["id"]
        body["ts"] = row["ts"]
        out.append(body)
    return out


def latest() -> dict[str, Any] | None:
    rows = list_reports(1)
    return rows[0] if rows else None
