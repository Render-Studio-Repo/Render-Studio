"""Post-session debug cost reports: tokens/time, suggestions, risk/reward, team votes.

Never invents USD. Spend is stored only when the caller supplied a price field.
Snapshot rollback / GitHub / privilege elevation still require explicit approve.
"""
from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from typing import Any

from backend.services import debugger_analytics_service as das

YES_HOLD_NO = ("YES", "HOLD", "NO")
VOTE_MAP = {
    "yes": "YES", "y": "YES", "a": "YES", "agree": "YES",
    "hold": "HOLD", "h": "HOLD", "b": "HOLD", "abstain": "HOLD",
    "no": "NO", "n": "NO", "c": "NO", "disagree": "NO",
}
VOTE_RE = re.compile(r"\b(YES|HOLD|NO|AGREE|DISAGREE|ABSTAIN)\b", re.I)
MEDIA = Path(__file__).resolve().parents[2] / "frontend" / "docs" / "media"
BOARD_VOTES = MEDIA / "board-votes.jsonl"
GROUP_CHAT = MEDIA / "group-chat.jsonl"


def _ensure(conn) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS debug_sessions (
            id TEXT PRIMARY KEY, ts_start TEXT NOT NULL, ts_end TEXT,
            status TEXT NOT NULL, project_id TEXT, instance_id TEXT,
            log_ids_json TEXT, note TEXT
        );
        CREATE TABLE IF NOT EXISTS session_cost_reports (
            id TEXT PRIMARY KEY, ts TEXT NOT NULL, session_id TEXT,
            project_id TEXT, trigger TEXT, tokens_in INTEGER, tokens_out INTEGER,
            token_cost INTEGER, duration_s REAL, damage_avg REAL, outcome_avg REAL,
            methods_json TEXT, models_json TEXT, log_ids_json TEXT,
            spend REAL, currency TEXT, price_source TEXT, prompt_count INTEGER,
            suggestions_json TEXT, risk_json TEXT, votes_json TEXT,
            speak TEXT, team_line TEXT, note TEXT
        );
        """
    )


def _conn():
    conn = das._conn()
    _ensure(conn)
    return conn


def _spend(data: dict[str, Any]) -> tuple[float | None, str, str]:
    for key in ("spend", "cost_usd", "usd", "price_usd", "llm_spend"):
        raw = data.get(key)
        if raw is None or raw == "":
            continue
        try:
            return round(float(raw), 6), "USD", key
        except (TypeError, ValueError):
            continue
    in_rate = data.get("input_usd_per_mtok")
    out_rate = data.get("output_usd_per_mtok")
    tin = int(data.get("tokens_in") or 0)
    tout = int(data.get("tokens_out") or 0)
    if in_rate is not None and out_rate is not None and (tin or tout):
        try:
            spend = tin / 1e6 * float(in_rate) + tout / 1e6 * float(out_rate)
            return round(spend, 6), "USD", "unit_rates"
        except (TypeError, ValueError):
            pass
    return None, "unknown", "none"


def normalize_vote(choice: Any) -> str | None:
    raw = str(choice or "").strip()
    if not raw:
        return None
    mapped = VOTE_MAP.get(raw.lower())
    if mapped:
        return mapped
    hit = VOTE_RE.search(raw)
    if not hit:
        return None
    return VOTE_MAP.get(hit.group(1).lower())


def snapshot_votes(data: dict[str, Any] | None = None, *, limit: int = 24) -> dict[str, Any]:
    data = data or {}
    ballots: list[dict[str, str]] = []
    if isinstance(data.get("votes"), list):
        for item in data["votes"]:
            if not isinstance(item, dict):
                continue
            vote = normalize_vote(item.get("vote") or item.get("choice") or item.get("verdict"))
            if not vote:
                continue
            ballots.append({
                "agent": das._excerpt(item.get("agent") or item.get("voter") or "unknown", 40),
                "vote": vote,
                "vote_id": das._excerpt(item.get("vote_id") or item.get("id") or "", 40),
            })
    if not ballots:
        ballots.extend(_read_board_votes(limit))
    if not ballots:
        ballots.extend(_read_chat_votes(limit))
    seen: set[tuple[str, str]] = set()
    uniq: list[dict[str, str]] = []
    for row in ballots:
        key = (row["agent"], row.get("vote_id") or "")
        if key in seen:
            continue
        seen.add(key)
        uniq.append(row)
    tally = {label: 0 for label in YES_HOLD_NO}
    for row in uniq:
        tally[row["vote"]] = tally.get(row["vote"], 0) + 1
    majority = max(YES_HOLD_NO, key=lambda k: (tally[k], k == "HOLD"))
    if sum(tally.values()) == 0:
        majority = "HOLD"
    return {
        "source": "team-chat",
        "votes": uniq[:limit],
        "tally": tally,
        "majority": majority,
        "n": len(uniq),
    }


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    rows = []
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(rec, dict):
                rows.append(rec)
    except OSError:
        return []
    return rows


def _read_board_votes(limit: int) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for rec in _read_jsonl(BOARD_VOTES):
        if rec.get("kind") and rec.get("kind") != "ballot":
            continue
        vote = normalize_vote(rec.get("choice") or rec.get("vote") or rec.get("text"))
        if not vote:
            continue
        out.append({
            "agent": das._excerpt(rec.get("agent") or "unknown", 40),
            "vote": vote,
            "vote_id": das._excerpt(rec.get("vote_id") or rec.get("id") or "", 40),
        })
    return out[-limit:]


def _read_chat_votes(limit: int) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for rec in _read_jsonl(GROUP_CHAT):
        text = str(rec.get("text") or rec.get("body") or "")
        vote = normalize_vote(text)
        if not vote:
            continue
        out.append({
            "agent": das._excerpt(rec.get("agent") or rec.get("from") or "unknown", 40),
            "vote": vote,
            "vote_id": das._excerpt(rec.get("log_id") or rec.get("id") or "", 40),
        })
    return out[-limit:]


def open_session(data: dict[str, Any] | None = None) -> dict[str, Any]:
    data = data or {}
    sid = str(data.get("session_id") or "")[:40] or ("sess_" + uuid.uuid4().hex[:10])
    logs = das._ids(data.get("log_ids") or data.get("log_id") or [])
    row = {
        "id": sid,
        "ts_start": das.now(),
        "ts_end": "",
        "status": "open",
        "project_id": str(data.get("project_id") or "")[:80],
        "instance_id": str(data.get("instance_id") or "")[:80],
        "log_ids": logs,
        "note": das._excerpt(data.get("note"), 160),
    }
    with _conn() as conn:
        existing = conn.execute("SELECT * FROM debug_sessions WHERE id = ?", (sid,)).fetchone()
        if existing:
            return _session_row(dict(existing))
        conn.execute(
            "INSERT INTO debug_sessions VALUES (?,?,?,?,?,?,?,?)",
            (sid, row["ts_start"], "", "open", row["project_id"], row["instance_id"], das._json(logs), row["note"]),
        )
    return row


def latest_open(project_id: str = "") -> dict[str, Any] | None:
    with _conn() as conn:
        if project_id:
            row = conn.execute(
                "SELECT * FROM debug_sessions WHERE status = 'open' AND project_id = ? ORDER BY ts_start DESC LIMIT 1",
                (project_id,),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT * FROM debug_sessions WHERE status = 'open' ORDER BY ts_start DESC LIMIT 1"
            ).fetchone()
    return _session_row(dict(row)) if row else None


def _session_row(row: dict[str, Any]) -> dict[str, Any]:
    row["log_ids"] = json.loads(row.pop("log_ids_json") or "[]") if "log_ids_json" in row else row.get("log_ids") or []
    return row


def _collect(data: dict[str, Any], session: dict[str, Any] | None) -> dict[str, Any]:
    logs = das._ids(data.get("log_ids") or data.get("log_id") or (session or {}).get("log_ids") or [])
    project_id = str(data.get("project_id") or (session or {}).get("project_id") or "")[:80]
    since = str((session or {}).get("ts_start") or "")
    with _conn() as conn:
        if logs:
            qmarks = ",".join("?" * len(logs))
            scores = [dict(r) for r in conn.execute(f"SELECT * FROM scores WHERE log_id IN ({qmarks}) ORDER BY ts", logs)]
        elif project_id and since:
            scores = [dict(r) for r in conn.execute(
                "SELECT * FROM scores WHERE project_id = ? AND ts >= ? ORDER BY ts", (project_id, since)
            )]
        elif since:
            scores = [dict(r) for r in conn.execute("SELECT * FROM scores WHERE ts >= ? ORDER BY ts", (since,))]
        else:
            scores = [dict(r) for r in conn.execute("SELECT * FROM scores ORDER BY ts DESC LIMIT 12")]
            scores.reverse()
        try:
            latency = [dict(r) for r in conn.execute("SELECT * FROM latency_reads ORDER BY ts DESC LIMIT 24")]
        except Exception:
            latency = []
        try:
            uses = [dict(r) for r in conn.execute("SELECT * FROM privilege_uses ORDER BY ts DESC LIMIT 24")]
        except Exception:
            uses = []
    score_ids = {str(s.get("id") or "") for s in scores}
    if score_ids:
        latency = [r for r in latency if str(r.get("score_id") or "") in score_ids] or latency[: max(1, len(scores))]
        uses = [r for r in uses if str(r.get("score_id") or "") in score_ids] or uses[: max(1, len(scores))]
    tokens_in = sum(int(r.get("tokens_in") or 0) for r in latency)
    tokens_out = sum(int(r.get("tokens_out") or 0) for r in latency)
    token_cost = sum(int(s.get("token_cost") or 0) for s in scores) or (tokens_in + tokens_out)
    duration = sum(float(s.get("duration_s") or 0) for s in scores)
    if not duration:
        duration = sum(float(r.get("duration_s") or 0) for r in latency)
    damages = [float(u.get("damage") or 0) for u in uses]
    outcomes = [float(u.get("outcome") or 0) for u in uses] or [float(s.get("score") or 0) for s in scores]
    methods = []
    for u in uses:
        method = str(u.get("method") or "")
        if method and method not in methods:
            methods.append(method)
    for s in scores:
        extra = s.get("method") or ""
        if extra and extra not in methods:
            methods.append(str(extra))
    models = []
    for r in latency:
        model = str(r.get("model") or "")
        if model and model not in models:
            models.append(model)
    if data.get("tokens_in"):
        tokens_in = max(tokens_in, int(data.get("tokens_in") or 0))
    if data.get("tokens_out"):
        tokens_out = max(tokens_out, int(data.get("tokens_out") or 0))
    if data.get("token_cost"):
        token_cost = max(token_cost, int(data["token_cost"]))
    if data.get("duration_s"):
        duration = max(duration, float(data["duration_s"]))
    if data.get("log_id") and data["log_id"] not in logs:
        logs.append(str(data["log_id"]))
    for s in scores:
        lid = str(s.get("log_id") or "")
        if lid and lid not in logs:
            logs.append(lid)
    return {
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "token_cost": token_cost,
        "duration_s": round(duration, 2),
        "damage_avg": round(sum(damages) / len(damages), 2) if damages else float(data.get("damage") or data.get("damage_score") or 0),
        "outcome_avg": round(sum(outcomes) / len(outcomes), 2) if outcomes else float(data.get("score") or data.get("outcome") or 0),
        "methods": methods[:12],
        "models": models[:8],
        "log_ids": logs[:24],
        "prompt_count": max(1, len(scores) or int(data.get("prompt_count") or 1)),
        "project_id": project_id or str(data.get("project_id") or ""),
    }


def _suggestions(stats: dict[str, Any], votes: dict[str, Any]) -> list[dict[str, str]]:
    tips: list[dict[str, str]] = []
    if float(stats.get("damage_avg") or 0) >= 25:
        tips.append({"id": "narrow-fix", "text": "High damage — fix one feature vector; stop broad window rewrites."})
    if int(stats.get("token_cost") or 0) >= 400 or (int(stats.get("tokens_in") or 0) + int(stats.get("tokens_out") or 0)) >= 800:
        tips.append({"id": "token-cap", "text": "Token spend is heavy — reuse last3 log ids; skip full transcript dumps."})
    if float(stats.get("duration_s") or 0) >= 120:
        tips.append({"id": "time-box", "text": "Session ran long — cede a single ticket; do not loop the same method."})
    if float(stats.get("outcome_avg") or 0) < 60:
        tips.append({"id": "fork", "text": "Outcome is low — open a Sam fork_ instead of repeating the same privilege."})
    methods = stats.get("methods") or []
    if "memory.leak" in methods:
        tips.append({"id": "leak-pause", "text": "memory.leak is in play — confirm revoke/abort before another leak pass."})
    if votes.get("majority") == "NO":
        tips.append({"id": "peer-no", "text": "Team vote is NO — hold autonomous writes; wait for Sam approve."})
    elif votes.get("majority") == "HOLD":
        tips.append({"id": "peer-hold", "text": "Team vote is HOLD — keep drafting; do not apply to production."})
    if not tips:
        tips.append({"id": "keep", "text": "Scores are clean — ask Sam to mark the proven method safe before repeating it."})
    return tips[:6]


def _risk_reward(stats: dict[str, Any], votes: dict[str, Any]) -> dict[str, Any]:
    damage = float(stats.get("damage_avg") or 0)
    outcome = float(stats.get("outcome_avg") or 0)
    tokens = int(stats.get("token_cost") or 0) or (int(stats.get("tokens_in") or 0) + int(stats.get("tokens_out") or 0))
    duration = float(stats.get("duration_s") or 0)
    risk = round(min(100.0, damage * 0.5 + min(40.0, tokens / 50.0) + min(20.0, duration / 30.0)), 2)
    reward = round(min(100.0, outcome * 0.8 + (10.0 if votes.get("majority") == "YES" else 0.0)), 2)
    if reward > risk + 8:
        verdict = "reward"
    elif risk > reward + 8:
        verdict = "risk"
    else:
        verdict = "even"
    return {
        "risk": risk,
        "reward": reward,
        "verdict": verdict,
        "damage_avg": damage,
        "outcome_avg": outcome,
        "tokens": tokens,
        "duration_s": duration,
        "vote_majority": votes.get("majority") or "HOLD",
        "note": f"risk {risk} vs reward {reward} ({verdict}); peers {votes.get('majority') or 'HOLD'}",
    }


def _speak(report: dict[str, Any]) -> str:
    spend = "currency unknown" if report.get("currency") == "unknown" else f"spend {report.get('spend')} {report.get('currency')}"
    votes = report.get("votes") or {}
    tally = votes.get("tally") or {}
    tips = report.get("suggestions") or []
    tip = tips[0]["text"] if tips else "No extra suggestion."
    rr = report.get("risk_vs_reward") or {}
    return (
        f"Session {report.get('session_id')} used {report.get('tokens_in')}/{report.get('tokens_out')} tokens "
        f"in {report.get('duration_s')} seconds, {spend}. "
        f"Outcome {report.get('outcome_avg')} versus damage {report.get('damage_avg')}. "
        f"Risk {rr.get('risk')} versus reward {rr.get('reward')} is {rr.get('verdict')}. "
        f"Team votes YES {tally.get('YES', 0)}, HOLD {tally.get('HOLD', 0)}, NO {tally.get('NO', 0)}. "
        f"Suggestion: {tip}"
    )


def close_session(data: dict[str, Any] | None = None) -> dict[str, Any]:
    data = data or {}
    trigger = str(data.get("trigger") or data.get("action") or "close").strip().lower()
    if trigger in {"cede", "session_cede"}:
        trigger = "cede"
        status = "ceded"
    elif trigger in {"confirm_fixed", "confirm"}:
        trigger = "confirm_fixed"
        status = "closed"
    else:
        trigger = "close"
        status = "closed"
    sid = str(data.get("session_id") or "")[:40]
    session = None
    if sid:
        with _conn() as conn:
            row = conn.execute("SELECT * FROM debug_sessions WHERE id = ?", (sid,)).fetchone()
        session = _session_row(dict(row)) if row else None
    if not session:
        session = latest_open(str(data.get("project_id") or ""))
    if not session:
        session = open_session(data)
    stats = _collect(data, session)
    votes = snapshot_votes(data)
    suggestions = data.get("suggestions") if isinstance(data.get("suggestions"), list) else _suggestions(stats, votes)
    risk = _risk_reward(stats, votes)
    spend, currency, source = _spend(data)
    report = {
        "id": "cost_" + uuid.uuid4().hex[:10],
        "ts": das.now(),
        "session_id": session["id"],
        "project_id": stats["project_id"],
        "trigger": trigger,
        "tokens_in": stats["tokens_in"],
        "tokens_out": stats["tokens_out"],
        "token_cost": stats["token_cost"],
        "duration_s": stats["duration_s"],
        "damage_avg": stats["damage_avg"],
        "outcome_avg": stats["outcome_avg"],
        "methods": stats["methods"],
        "models": stats["models"],
        "log_ids": stats["log_ids"],
        "log_chain": " | ".join(stats["log_ids"]),
        "spend": spend,
        "currency": currency,
        "price_source": source,
        "prompt_count": stats["prompt_count"],
        "suggestions": suggestions,
        "risk_vs_reward": risk,
        "votes": votes,
        "note": das._excerpt(data.get("note"), 160),
        "auto_applied": False,
    }
    report["speak"] = das._excerpt(_speak(report), 400)
    report["team_line"] = das._excerpt(
        f"{report['id']} tok {report['tokens_in']}/{report['tokens_out']} t={report['duration_s']}s "
        f"out {report['outcome_avg']} dmg {report['damage_avg']} {risk['verdict']} "
        f"YES {votes['tally']['YES']} HOLD {votes['tally']['HOLD']} NO {votes['tally']['NO']} {currency}",
        200,
    )
    with _conn() as conn:
        conn.execute(
            "UPDATE debug_sessions SET ts_end = ?, status = ?, log_ids_json = ? WHERE id = ?",
            (report["ts"], status, das._json(stats["log_ids"]), session["id"]),
        )
        conn.execute(
            """INSERT INTO session_cost_reports VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                report["id"], report["ts"], report["session_id"], report["project_id"], trigger,
                report["tokens_in"], report["tokens_out"], report["token_cost"], report["duration_s"],
                report["damage_avg"], report["outcome_avg"], das._json(report["methods"]), das._json(report["models"]),
                das._json(report["log_ids"]), spend, currency, source, report["prompt_count"],
                das._json(suggestions), das._json(risk), das._json(votes), report["speak"], report["team_line"],
                report["note"],
            ),
        )
    return report


def list_reports(limit: int = 12) -> list[dict[str, Any]]:
    with _conn() as conn:
        rows = [dict(r) for r in conn.execute(
            "SELECT * FROM session_cost_reports ORDER BY ts DESC LIMIT ?", (max(1, min(limit, 40)),)
        )]
    return [_report_row(r) for r in rows]


def get_report(rid: str) -> dict[str, Any] | None:
    with _conn() as conn:
        row = conn.execute("SELECT * FROM session_cost_reports WHERE id = ?", (rid,)).fetchone()
    return _report_row(dict(row)) if row else None


def latest() -> dict[str, Any] | None:
    rows = list_reports(1)
    return rows[0] if rows else None


def _report_row(row: dict[str, Any]) -> dict[str, Any]:
    row["methods"] = json.loads(row.pop("methods_json") or "[]")
    row["models"] = json.loads(row.pop("models_json") or "[]")
    row["log_ids"] = json.loads(row.pop("log_ids_json") or "[]")
    row["log_chain"] = " | ".join(row["log_ids"])
    row["suggestions"] = json.loads(row.pop("suggestions_json") or "[]")
    row["risk_vs_reward"] = json.loads(row.pop("risk_json") or "{}")
    row["votes"] = json.loads(row.pop("votes_json") or "{}")
    if row.get("spend") is None:
        row["currency"] = row.get("currency") or "unknown"
    return row


def maybe_close_from_score(score_row: dict[str, Any], data: dict[str, Any] | None = None) -> dict[str, Any]:
    data = data or {}
    if not any(data.get(k) for k in ("close", "cede", "session_end", "end_session")):
        return {}
    payload = dict(data)
    payload.setdefault("log_id", score_row.get("log_id"))
    payload.setdefault("project_id", score_row.get("project_id"))
    payload.setdefault("token_cost", score_row.get("token_cost"))
    payload.setdefault("duration_s", score_row.get("duration_s"))
    payload.setdefault("score", score_row.get("score"))
    payload.setdefault("outcome", score_row.get("outcome") or score_row.get("score"))
    payload.setdefault("damage", score_row.get("damage_score") or data.get("damage"))
    if data.get("cede"):
        payload["trigger"] = "cede"
    return close_session(payload)


def weekly_addon() -> dict[str, Any]:
    rows = list_reports(8)
    tokens = sum(int(r.get("token_cost") or 0) for r in rows)
    duration = round(sum(float(r.get("duration_s") or 0) for r in rows), 2)
    priced = [r for r in rows if r.get("currency") != "unknown" and r.get("spend") is not None]
    spend = round(sum(float(r["spend"]) for r in priced), 6) if priced else None
    return {
        "cost_reports": [{"id": r["id"], "session_id": r["session_id"], "tokens_in": r["tokens_in"], "tokens_out": r["tokens_out"], "duration_s": r["duration_s"], "currency": r["currency"], "spend": r.get("spend"), "outcome_avg": r["outcome_avg"], "damage_avg": r["damage_avg"], "team_line": r.get("team_line"), "majority": (r.get("votes") or {}).get("majority")} for r in rows],
        "cost_totals": {
            "n": len(rows),
            "tokens": tokens,
            "duration_s": duration,
            "spend": spend,
            "currency": "USD" if priced and len(priced) == len(rows) else "unknown",
        },
        "cost_latest": latest(),
    }


def inbox_extra() -> dict[str, Any]:
    last = latest()
    return {"cost_latest": last, "cost_team_line": (last or {}).get("team_line") or ""}
