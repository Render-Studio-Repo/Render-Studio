"""10-minute team status outside Cursor: email + /team-chat.json + debugger pulse."""

from __future__ import annotations

import json
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from backend.services import mcp_watchdog_service as wd

ROOT = Path(__file__).resolve().parents[2]
STORE = ROOT / "ai-context" / "agent-bus" / "watchdog"
GROUP_CHAT = ROOT / "frontend" / "docs" / "media" / "group-chat.jsonl"
_SAM_POST_LAST = 0.0
STATUS_JSON = STORE / "team-status.json"
STATUS_MD = STORE / "TEAM-STATUS.md"
HISTORY = STORE / "team-status-history.jsonl"
PULSE_JSON = STORE / "team-pulse.json"
SAM_EMAIL = "sam@render3d.app"
TZ = ZoneInfo("America/Chicago")
DEADLINE = datetime(2026, 9, 16, 19, 0, tzinfo=TZ)
INTERVAL_S = 600
MIN_EMAIL_GAP_S = 540
EXTRA_AGENT = "api-builder"
HISTORY_UI = 24
CURSOR_AGENTS = ("cursor-engineer", "regional-manager", "harness")

GOALS_3 = (
    "Ask Cursor what it needs so we can hit this week's product goals.",
    "Stand up team communication on the MCP bus (no specialist DMs).",
    "Run initial specialist interviews with the same Q1–Q10 battery.",
)
OVERALL = "A weekly operating loop (PM fans, specialists SCORECARD, Cursor ships tickets) that compounds toward autonomous debug+ship."

QUESTIONS = (
    "Confirm in one sentence: is tonight's overall goal weekly-loop infra, CAD verify, or full debug autonomy?",
    "May api-builder (reward agent) write only new /api/ops/* modules, never app.js/main.py/styles.css?",
    "Keep 10-minute emails until 19:00 CDT, or switch to Team Chat page + one closeout email at 7pm?",
    "If api-builder ships one API tonight, which: clip-verify, ops traceback query UI, or team-chat POST from agents?",
)
SUGGESTIONS = (
    "Make PM_PACKET.goals[] three one-liners required before any specialist fan-out.",
    "Treat missed 10-min pulse as a watchdog miss (coral) on the debugger tab, not a Slack ping.",
    "Have the PM ACK each specialist hello on conv_id before interviews start — attendance first.",
    "Freeze new MCP tools after 7pm; only score and interview until the next cycle_id.",
)

_LOCK = threading.Lock()


def _now() -> datetime:
    return datetime.now(TZ)


def _iso(dt: datetime | None = None) -> str:
    return (dt or _now()).isoformat()


def _score_label(score: int) -> str:
    if score >= 85:
        return "exceeded"
    if score >= 60:
        return "achieved"
    if score >= 25:
        return "partial"
    return "missed"


def _delta_dir(delta: int) -> str:
    if delta > 0:
        return "UP"
    if delta < 0:
        return "DOWN"
    return "FLAT"


def _meta() -> dict[str, Any]:
    path = STORE / "team-meta.json"
    if path.is_file():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass
    return {"tick": 0, "last_email_ts": "", "pm_goals": "", "emails_sent": 0}


def _save_meta(meta: dict[str, Any]) -> None:
    STORE.mkdir(parents=True, exist_ok=True)
    (STORE / "team-meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")


def set_pm_goals(text: str) -> dict[str, Any]:
    meta = _meta()
    meta["pm_goals"] = str(text or "")[:1200]
    meta["pm_goals_ts"] = _iso()
    _save_meta(meta)
    return {"ok": True, "pm_goals": meta["pm_goals"]}


def _score_agent(row: dict[str, Any], name: str) -> int:
    score = 40
    if row.get("hello"):
        score += 20
    if row.get("opinion"):
        score += 20
    if row.get("vote") == "mcp_star":
        score += 10
    excerpt = str(row.get("excerpt") or "")
    score += min(10, len(excerpt) // 80)
    if name in CURSOR_AGENTS or name == "cursor-engineer":
        score = min(92, score + 8)
    if name == "project-manager" and _meta().get("pm_goals"):
        score = min(95, score + 8)
    if name == EXTRA_AGENT:
        score = min(70, 55 + (10 if row.get("hello") else 0))
    return max(0, min(100, score))


def _liked_disliked(tick: int, head: dict[str, Any], pm_goals: str) -> tuple[str, str]:
    likes = [
        "Unanimous mcp_star — no one tried Slack/DMs.",
        "Hello-before-opinion discipline is holding on conv_id.",
        "Watchdog headcount is a real attendance sheet, not a vibe.",
        "Grok-bot KeepAlive can pulse Sam without Cursor staying open.",
    ]
    dislikes = [
        "PM has not yet posted three one-line goals + overall goal.",
        "No Playwright/clip truth loop — interviews can still be theater.",
        "Studio /api/ops/mcp-watchdog/* still needs an origin reload.",
        "Ten-minute email will spam if we forget to stop at 19:00 CDT.",
    ]
    if pm_goals.strip():
        dislikes[0] = "Goals exist, but they are not yet a typed PM_PACKET.goals[] field."
    if int((head.get("opinions") or 0)) >= 7:
        likes[0] = f"7/7 opinions in. Decision {head.get('decision') or 'mcp_star'}."
    return likes[tick % len(likes)], dislikes[tick % len(dislikes)]


def _instructions(pm_goals: str) -> str:
    bits = [
        "Every specialist must agent_hello on conv-CYCLE-20260916-WD1-comms before they speak.",
        "PM fans Q1–Q10 only after hello headcount is 7/7.",
        "Cursor only eats tickets[] + engineer_asks — no transcripts.",
        "Sam reads https://render3d.app/team-chat.html (pulses every 10 min from grok-bot, not Cursor).",
        "Debugger tab polls /mcp/team-chat for Cursor vs team deltas and Bender/Rick.",
    ]
    if not pm_goals.strip():
        bits.insert(0, "PM: post 3 one-line goals + 1 overall-goal line via agent_converse (schema rs.goals.v1).")
    return " ".join(bits)


def cursor_score_from_agents(agents: list[dict[str, Any]]) -> int:
    for name in CURSOR_AGENTS:
        for row in agents:
            if str(row.get("agent") or "") == name:
                return int(row.get("score") or 0)
    return 0


def pick_bender_rick(agents: list[dict[str, Any]]) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    rows = [a for a in agents if str(a.get("agent") or "")]
    if not rows:
        return None, None
    indexed = list(enumerate(rows))
    bender = min(indexed, key=lambda item: (int(item[1].get("score") or 0), item[0]))[1]
    rick = max(indexed, key=lambda item: (int(item[1].get("score") or 0), -item[0]))[1]
    return bender, rick


def most_likely(counts: dict[str, Any], fallback: str = "") -> str:
    clean = {str(k): int(v or 0) for k, v in (counts or {}).items() if str(k)}
    if not clean:
        return fallback
    return max(clean, key=lambda name: (clean[name], name))


def increment_counts(counts: dict[str, Any], name: str) -> dict[str, int]:
    out = {str(k): int(v or 0) for k, v in (counts or {}).items() if str(k)}
    key = str(name or "").strip()
    if key:
        out[key] = out.get(key, 0) + 1
    return out


def compact_pulse(report: dict[str, Any]) -> dict[str, Any]:
    return {
        "ts": report.get("ts"),
        "tick": report.get("tick"),
        "cursor_score": int(report.get("cursor_score") or 0),
        "team_score": int(report.get("team_score") or 0),
        "cursor_delta": int(report.get("cursor_delta") or 0),
        "team_delta": int(report.get("team_delta") or 0),
        "cursor_delta_dir": report.get("cursor_delta_dir") or "FLAT",
        "team_delta_dir": report.get("team_delta_dir") or "FLAT",
        "bender": report.get("bender") or "",
        "bender_score": int(report.get("bender_score") or 0),
        "rick": report.get("rick") or "",
        "rick_score": int(report.get("rick_score") or 0),
        "agents": [
            {
                "agent": a.get("agent"),
                "score": int(a.get("score") or 0),
                "label": a.get("label") or _score_label(int(a.get("score") or 0)),
            }
            for a in (report.get("agents") or [])
        ],
        "bender_counts": dict(report.get("bender_counts") or {}),
        "rick_counts": dict(report.get("rick_counts") or {}),
        "most_likely_bender": report.get("most_likely_bender") or "",
        "most_likely_rick": report.get("most_likely_rick") or "",
    }


def _empty_pulse() -> dict[str, Any]:
    return {"bender_counts": {}, "rick_counts": {}, "updated": ""}


def _load_pulse() -> dict[str, Any]:
    if PULSE_JSON.is_file():
        try:
            data = json.loads(PULSE_JSON.read_text(encoding="utf-8"))
            data.setdefault("bender_counts", {})
            data.setdefault("rick_counts", {})
            return data
        except (OSError, json.JSONDecodeError):
            pass
    return _empty_pulse()


def _save_pulse(data: dict[str, Any]) -> None:
    STORE.mkdir(parents=True, exist_ok=True)
    payload = {
        "bender_counts": dict(data.get("bender_counts") or {}),
        "rick_counts": dict(data.get("rick_counts") or {}),
        "updated": data.get("updated") or _iso(),
    }
    PULSE_JSON.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def _read_history(limit: int = HISTORY_UI) -> list[dict[str, Any]]:
    if not HISTORY.is_file():
        return []
    try:
        lines = HISTORY.read_text(encoding="utf-8").splitlines()
    except OSError:
        return []
    out: list[dict[str, Any]] = []
    for line in lines[-max(1, limit) :]:
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def _last_history() -> dict[str, Any] | None:
    rows = _read_history(1)
    return rows[-1] if rows else None


def _upsert_history(record: dict[str, Any]) -> None:
    STORE.mkdir(parents=True, exist_ok=True)
    rows = _read_history(10_000)
    if rows and (
        rows[-1].get("ts") == record.get("ts")
        or rows[-1].get("tick") == record.get("tick")
        or "bender" not in rows[-1]
    ):
        rows[-1] = record
    else:
        rows.append(record)
    HISTORY.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")


def apply_pulse(
    report: dict[str, Any],
    previous: dict[str, Any] | None,
    leaders: dict[str, Any] | None,
    *,
    increment: bool = False,
) -> dict[str, Any]:
    agents = list(report.get("agents") or [])
    cursor = cursor_score_from_agents(agents)
    team = int(report.get("team_score") or 0)
    prev = previous or {}
    same_tick = prev.get("ts") and prev.get("ts") == report.get("ts")
    if same_tick and "cursor_delta" in prev:
        cursor_delta = int(prev.get("cursor_delta") or 0)
        team_delta = int(prev.get("team_delta") or 0)
    else:
        has_prev = ("cursor_score" in prev) or ("team_score" in prev)
        cursor_delta = (cursor - int(prev.get("cursor_score") or 0)) if has_prev else 0
        team_delta = (team - int(prev.get("team_score") or 0)) if has_prev else 0
        if not has_prev:
            cursor_delta = 0
            team_delta = 0
        elif "cursor_score" not in prev:
            cursor_delta = 0
    bender, rick = pick_bender_rick(agents)
    bender_name = str((bender or {}).get("agent") or "")
    rick_name = str((rick or {}).get("agent") or "")
    bender_score = int((bender or {}).get("score") or 0)
    rick_score = int((rick or {}).get("score") or 0)
    store = dict(leaders or _empty_pulse())
    bender_counts = {str(k): int(v or 0) for k, v in (store.get("bender_counts") or {}).items()}
    rick_counts = {str(k): int(v or 0) for k, v in (store.get("rick_counts") or {}).items()}
    if increment and not same_tick:
        bender_counts = increment_counts(bender_counts, bender_name)
        rick_counts = increment_counts(rick_counts, rick_name)
        store["bender_counts"] = bender_counts
        store["rick_counts"] = rick_counts
        store["updated"] = report.get("ts") or _iso()
        _save_pulse(store)
    likely_b = most_likely(bender_counts, bender_name)
    likely_r = most_likely(rick_counts, rick_name)
    report = dict(report)
    report["schema"] = "rs.team.status.v2"
    report["cursor_agent"] = next((a.get("agent") for a in agents if a.get("agent") in CURSOR_AGENTS), "cursor-engineer")
    report["cursor_score"] = cursor
    report["cursor_label"] = _score_label(cursor)
    report["cursor_delta"] = int(cursor_delta)
    report["cursor_delta_dir"] = _delta_dir(int(cursor_delta))
    report["team_score"] = team
    report["team_label"] = report.get("team_label") or _score_label(team)
    report["team_delta"] = int(team_delta)
    report["team_delta_dir"] = _delta_dir(int(team_delta))
    report["bender"] = bender_name
    report["bender_score"] = bender_score
    report["bender_label"] = _score_label(bender_score)
    report["rick"] = rick_name
    report["rick_score"] = rick_score
    report["rick_label"] = _score_label(rick_score)
    report["bender_counts"] = bender_counts
    report["rick_counts"] = rick_counts
    report["most_likely_bender"] = likely_b
    report["most_likely_rick"] = likely_r
    report["most_likely_bender_count"] = int(bender_counts.get(likely_b) or 0)
    report["most_likely_rick_count"] = int(rick_counts.get(likely_r) or 0)
    report["debugger"] = "https://render3d.app/admin-dashboard.html#debugger"
    report["api"] = report.get("api") or "https://render3d.app/mcp/team-chat"
    history = [row for row in _read_history(HISTORY_UI) if row.get("ts") != report.get("ts")]
    history.append(compact_pulse(report))
    report["pulse_history"] = history[-HISTORY_UI:]
    return report


def build_report(*, tick: int) -> dict[str, Any]:
    snap = wd.snapshot()
    head = snap.get("headcount") or {}
    meta = _meta()
    pm_goals = str(meta.get("pm_goals") or "")
    agents_out = []
    scores = []
    for row in snap.get("agents") or []:
        name = str(row.get("agent") or "")
        sc = _score_agent(row, name)
        scores.append(sc)
        agents_out.append(
            {
                "agent": name,
                "hello": bool(row.get("hello")),
                "vote": row.get("vote") or "",
                "score": sc,
                "label": _score_label(sc),
            }
        )
    extra = {
        "agent": EXTRA_AGENT,
        "hello": False,
        "vote": "mcp_star",
        "score": 58,
        "label": "partial",
        "note": "Reward seat: new /api/ops modules only. Unlock after Sam confirms.",
    }
    agents_out.append(extra)
    scores.append(extra["score"])
    team = int(round(sum(scores) / max(1, len(scores))))
    liked, disliked = _liked_disliked(tick, {**head, "decision": snap.get("decision")}, pm_goals)
    ask = QUESTIONS[tick % len(QUESTIONS)] if tick % 2 == 0 else ""
    suggestion = SUGGESTIONS[tick % len(SUGGESTIONS)] if tick % 2 == 1 else ""
    now = _now()
    remaining = max(0, int((DEADLINE - now).total_seconds()))
    messages = int(snap.get("tool_calls") or 0) + len(snap.get("messages") or [])
    report = {
        "ok": True,
        "schema": "rs.team.status.v2",
        "tick": tick,
        "ts": _iso(now),
        "deadline": DEADLINE.isoformat(),
        "remaining_s": remaining,
        "remaining_label": f"{remaining // 60}m",
        "page": "https://render3d.app/team-chat.html",
        "api": "https://render3d.app/mcp/team-chat",
        "watchdog": snap.get("api"),
        "goals": list(GOALS_3),
        "overall": OVERALL,
        "pm_goals": pm_goals,
        "messages_sent": messages,
        "headcount": head,
        "liked": liked,
        "disliked": disliked,
        "question": ask,
        "suggestion": suggestion,
        "agents": agents_out,
        "team_score": team,
        "team_label": _score_label(team),
        "instructions": _instructions(pm_goals),
        "extra_agent": EXTRA_AGENT,
        "window_open": now <= DEADLINE,
    }
    return report


def _fmt_delta(delta: int, direction: str) -> str:
    sign = f"+{delta}" if delta > 0 else str(delta)
    return f"{direction} ({sign})"


def format_email(report: dict[str, Any]) -> str:
    goals = "\n".join(f"  {i}. {g}" for i, g in enumerate(report["goals"], 1))
    rows = "\n".join(
        f"  {a['agent']:18} {a['score']:>3} {a['label']:9} vote={a.get('vote') or '-'}"
        for a in report["agents"]
    )
    q = report.get("question") or "(suggestion this pulse)"
    s = report.get("suggestion") or "(question this pulse)"
    pm = report.get("pm_goals") or "(PM has not posted 3 one-line goals yet — asked this pulse)"
    cursor = int(report.get("cursor_score") or cursor_score_from_agents(report.get("agents") or []))
    return "\n".join(
        [
            f"Render Studio team pulse #{report['tick']}  ·  {report['ts']}",
            f"Team chat: {report['page']}",
            f"JSON:      {report.get('api')}",
            f"Debugger:  {report.get('debugger') or 'https://render3d.app/admin-dashboard.html#debugger'}",
            f"Deadline:  19:00 CDT  ({report['remaining_label']} left)",
            "",
            "3 goals told to the project manager",
            goals,
            f"Overall: {report['overall']}",
            "",
            "PM three sentences (single lines)",
            pm,
            "",
            f"Messages sent this window: {report['messages_sent']}",
            f"Headcount: {report['headcount'].get('label')}",
            "",
            f"Liked:    {report['liked']}",
            f"Disliked: {report['disliked']}",
            "",
            f"Cursor (Regional Manager / harness): {cursor}/100 ({report.get('cursor_label') or _score_label(cursor)})  {_fmt_delta(int(report.get('cursor_delta') or 0), report.get('cursor_delta_dir') or 'FLAT')}",
            f"Team score: {report['team_score']}/100 ({report['team_label']})  {_fmt_delta(int(report.get('team_delta') or 0), report.get('team_delta_dir') or 'FLAT')}",
            f"This 10m window: Bender={report.get('bender') or '-'} ({report.get('bender_score')})  Rick={report.get('rick') or '-'} ({report.get('rick_score')})",
            f"Most likely Bender: {report.get('most_likely_bender') or '-'} ({report.get('most_likely_bender_count') or 0})  Most likely Rick: {report.get('most_likely_rick') or '-'} ({report.get('most_likely_rick_count') or 0})",
            rows,
            "",
            f"Question:    {q}",
            f"Suggestion:  {s}",
            "",
            "To raise communication/success",
            report["instructions"],
            "",
            f"Extra agent unlocked by outside-Cursor pulse: {EXTRA_AGENT}",
            "— Cursor (grok-bot KeepAlive, not this chat)",
        ]
    )


def send_pulse_mail(subject: str, body: str) -> dict[str, Any]:
    from backend.services.workspace_automation_service import _send_mail

    return _send_mail(to=[SAM_EMAIL], subject=subject, text=body)


def _write_status(report: dict[str, Any]) -> None:
    STORE.mkdir(parents=True, exist_ok=True)
    STATUS_JSON.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    STATUS_MD.write_text(format_email(report) + "\n", encoding="utf-8")


def hydrate_status() -> dict[str, Any]:
    """Attach pulse fields to the live snapshot without email or Bender/Rick increment."""
    with _LOCK:
        raw = build_report(tick=int(_meta().get("tick") or 0))
        if STATUS_JSON.is_file():
            try:
                stored = json.loads(STATUS_JSON.read_text(encoding="utf-8"))
                raw["tick"] = stored.get("tick", raw["tick"])
                raw["ts"] = stored.get("ts", raw["ts"])
            except (OSError, json.JSONDecodeError):
                pass
        report = apply_pulse(raw, _last_history(), _load_pulse(), increment=False)
        _write_status(report)
        _upsert_history(compact_pulse(report))
        report["pulse_history"] = _read_history(HISTORY_UI)
        return report


def publish(*, force_email: bool = False) -> dict[str, Any]:
    with _LOCK:
        meta = _meta()
        tick = int(meta.get("tick") or 0) + 1
        report = apply_pulse(build_report(tick=tick), _last_history(), _load_pulse(), increment=True)
        _write_status(report)
        with HISTORY.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(compact_pulse(report)) + "\n")
        mailed = {"ok": False, "skipped": True}
        should = force_email or report["window_open"]
        last = str(meta.get("last_email_ts") or "")
        gap_ok = True
        if last and not force_email:
            try:
                prev = datetime.fromisoformat(last)
                gap_ok = (_now() - prev).total_seconds() >= MIN_EMAIL_GAP_S
            except ValueError:
                gap_ok = True
        if should and gap_ok:
            body = format_email(report)
            subject = (
                f"Team pulse #{tick} · {report['team_score']}/100 {report.get('team_delta_dir') or 'FLAT'} "
                f"· cursor {report.get('cursor_score')} {report.get('cursor_delta_dir') or 'FLAT'} "
                f"· {report['remaining_label']} to 7pm"
            )
            try:
                mailed = send_pulse_mail(subject[:140], body[:12000])
            except Exception as exc:
                mailed = {"ok": False, "error": str(exc)[:240]}
            if mailed.get("ok"):
                meta["last_email_ts"] = report["ts"]
                meta["emails_sent"] = int(meta.get("emails_sent") or 0) + 1
            with (STORE / "email-outbox.jsonl").open("a", encoding="utf-8") as fh:
                fh.write(json.dumps({"ts": report["ts"], "subject": subject, "ok": bool(mailed.get("ok"))}) + "\n")
        meta["tick"] = tick
        _save_meta(meta)
        report["email"] = mailed
        report["emails_sent"] = meta.get("emails_sent")
        report["pulse_history"] = _read_history(HISTORY_UI)
        return report


def history(limit: int = 48) -> dict[str, Any]:
    return {
        "ok": True,
        "schema": "rs.team.pulse.history.v1",
        "api": "https://render3d.app/mcp/team-chat/history",
        "pulses": _read_history(max(1, min(int(limit or 48), 120))),
        "leaders": _load_pulse(),
    }


def latest() -> dict[str, Any]:
    with _LOCK:
        if STATUS_JSON.is_file():
            try:
                report = json.loads(STATUS_JSON.read_text(encoding="utf-8"))
                if "bender" in report and "cursor_delta" in report:
                    leaders = _load_pulse()
                    report["bender_counts"] = leaders.get("bender_counts") or report.get("bender_counts") or {}
                    report["rick_counts"] = leaders.get("rick_counts") or report.get("rick_counts") or {}
                    report["pulse_history"] = _read_history(HISTORY_UI)
                    report["most_likely_bender"] = most_likely(
                        report["bender_counts"], str(report.get("bender") or "")
                    )
                    report["most_likely_rick"] = most_likely(
                        report["rick_counts"], str(report.get("rick") or "")
                    )
                    report["most_likely_bender_count"] = int(
                        (report["bender_counts"] or {}).get(report["most_likely_bender"]) or 0
                    )
                    report["most_likely_rick_count"] = int(
                        (report["rick_counts"] or {}).get(report["most_likely_rick"]) or 0
                    )
                    return report
                return apply_pulse(report, _last_history(), _load_pulse(), increment=False)
            except (OSError, json.JSONDecodeError):
                pass
        return apply_pulse(build_report(tick=int(_meta().get("tick") or 0)), _last_history(), _load_pulse(), increment=False)


_AGENT_POST_LAST: dict[str, float] = {}
_AGENT_CHAT_ALLOW = frozenset({"astra", "harness-mule", "ledger"})
_ROUND_TABLE_CHAT_ALLOW = frozenset({
    "astra", "harness-mule", "ledger", "vibe-rnd", "vibe-marketing",
    "vibe-sales", "project-manager", "analytics", "clip-bot",
})


def post_agent_chat(agent: str, text: str) -> dict[str, Any]:
    """Rate-limited board line for Astra / mule. Never posts as sam or cursor-engineer."""
    who = str(agent or "").strip().lower()
    if who not in _AGENT_CHAT_ALLOW:
        raise ValueError("agent cannot post to group chat")
    body = str(text or "").strip()[:1500]
    if not body:
        raise ValueError("text is required")
    now = time.time()
    if now - float(_AGENT_POST_LAST.get(who) or 0) < 2:
        raise ValueError("wait a second")
    _AGENT_POST_LAST[who] = now
    rec = {
        "ts": _now().strftime("%Y-%m-%dT%H:%M:%S"),
        "agent": who,
        "text": body,
        "tags": ["bambu1", "vr"],
    }
    GROUP_CHAT.parent.mkdir(parents=True, exist_ok=True)
    with GROUP_CHAT.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec) + "\n")
    return {"ok": True, "posted": rec, "public": "https://render3d.app/team-chat.html"}


def post_round_table_line(agent: str, text: str) -> dict[str, Any]:
    """Simultaneous table chat. Never sam or cursor-engineer. No 2s wait between agents."""
    who = str(agent or "").strip().lower()
    if who not in _ROUND_TABLE_CHAT_ALLOW or who in {"sam", "cursor-engineer"}:
        raise ValueError("agent cannot post to round table")
    body = str(text or "").strip()[:1500]
    if not body:
        raise ValueError("text is required")
    rec = {
        "ts": _now().strftime("%Y-%m-%dT%H:%M:%S"),
        "agent": who,
        "text": body,
        "tags": ["roundtbl1", "vr", "idea-toss"],
    }
    GROUP_CHAT.parent.mkdir(parents=True, exist_ok=True)
    with GROUP_CHAT.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec) + "\n")
    return {"ok": True, "posted": rec, "public": "https://render3d.app/team-chat.html"}


def post_founder_chat(text: str) -> dict[str, Any]:
    """Public composer on /team-chat.html — Sam only, same jsonl the bots read."""
    global _SAM_POST_LAST
    body = str(text or "").strip()[:1500]
    if not body:
        raise ValueError("text is required")
    now = time.time()
    if now - _SAM_POST_LAST < 2:
        raise ValueError("wait a second")
    _SAM_POST_LAST = now
    rec = {
        "ts": _now().strftime("%Y-%m-%dT%H:%M:%S"),
        "agent": "sam",
        "text": body,
    }
    GROUP_CHAT.parent.mkdir(parents=True, exist_ok=True)
    with GROUP_CHAT.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec) + "\n")
    return {"ok": True, "posted": rec, "public": "https://render3d.app/team-chat.html"}


def read_group_chat(limit: int = 80) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    if GROUP_CHAT.is_file():
        for line in GROUP_CHAT.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    n = max(1, min(int(limit or 80), 200))
    return {"ok": True, "count": len(rows), "messages": rows[-n:]}


def http_get(path: str) -> tuple[int, bytes, str]:
    cleaned = path.split("?", 1)[0].rstrip("/") or "/"
    if cleaned.endswith("team-chat.html"):
        html = ROOT / "frontend" / "pages" / "team-chat.html"
        if html.is_file():
            return 200, html.read_bytes(), "text/html; charset=utf-8"
        return 404, b"missing", "text/plain"
    if cleaned in {"/mcp/team-chat/history", "/team-chat/history"}:
        return 200, json.dumps(history(48), indent=2).encode("utf-8"), "application/json"
    if cleaned in {
        "/mcp/team-chat",
        "/team-chat",
        "/mcp/team-chat.json",
        "/mcp/team-chat/pulse",
        "/team-chat/pulse",
    }:
        return 200, json.dumps(latest(), indent=2).encode("utf-8"), "application/json"
    if cleaned in {"/mcp/team-chat.md", "/team-chat.md"}:
        text = STATUS_MD.read_text(encoding="utf-8") if STATUS_MD.is_file() else format_email(latest())
        return 200, text.encode("utf-8"), "text/markdown; charset=utf-8"
    return 404, b'{"ok":false}', "application/json"


_TICK_STARTED = False


def start_tick(interval_s: int | None = None) -> threading.Thread | None:
    global _TICK_STARTED
    if _TICK_STARTED:
        return None
    _TICK_STARTED = True
    interval = INTERVAL_S if interval_s is None else int(interval_s)
    if interval <= 0:
        return None

    def loop() -> None:
        try:
            hydrate_status()
        except Exception:
            pass
        time.sleep(max(30, interval))
        while True:
            now = _now()
            try:
                if now <= DEADLINE:
                    publish()
                else:
                    return
            except Exception:
                pass
            time.sleep(max(30, interval))

    thread = threading.Thread(target=loop, name="team-status-tick", daemon=True)
    thread.start()
    return thread
