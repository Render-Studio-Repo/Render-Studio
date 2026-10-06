"""Workspace watchdogs — prompt + schedule + optional email-if. Not a second Zapier."""

from __future__ import annotations

import json
import logging
import os
import re
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any

import smtplib

from backend.config import settings
from backend.database import get_conn
from backend.services import ops_log_service, teams_service
from backend.services.sam_alert_email_service import SAM_EMAIL

logger = logging.getLogger("render3d.workspace_automation")

SCHEDULES = ("hourly", "weekly", "next_2_days", "custom")
EMAIL_CHIPS = ("bug", "users", "projects")
LOOP_SECONDS = 60
STARTUP_DELAY = 20

_loop_lock = threading.Lock()
_loop_started = False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def smtp_configured() -> bool:
    return bool(
        (settings.capacity_alert_smtp_user or "").strip()
        and (settings.capacity_alert_smtp_password or "").strip()
    )


def _ensure(conn) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS workspace_automations (
            id TEXT PRIMARY KEY,
            owner_id TEXT NOT NULL,
            prompt TEXT NOT NULL,
            team_ids TEXT NOT NULL DEFAULT '[]',
            schedule_kind TEXT NOT NULL DEFAULT 'hourly',
            interval_minutes INTEGER NOT NULL DEFAULT 60,
            expires_at TEXT,
            email_if INTEGER NOT NULL DEFAULT 0,
            email_chips TEXT NOT NULL DEFAULT '[]',
            email_scenario TEXT NOT NULL DEFAULT '',
            last_run_at TEXT,
            last_digest TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
        )
        """
    )


def parse_schedule(prompt: str, schedule_kind: str | None, interval_minutes: int | None) -> dict[str, Any]:
    text = f"{prompt or ''} {schedule_kind or ''}".lower()
    kind = (schedule_kind or "").strip().lower()
    if kind not in SCHEDULES:
        kind = "hourly"
        if "next 2 day" in text or "next two day" in text or "48 hour" in text:
            kind = "next_2_days"
        elif "weekly" in text or "every week" in text:
            kind = "weekly"
        elif "hourly" in text or "every hour" in text:
            kind = "hourly"
        elif re.search(r"every\s+\d+", text):
            kind = "custom"
    minutes = int(interval_minutes or 0)
    if kind == "hourly":
        minutes = 60
    elif kind == "weekly":
        minutes = 60 * 24 * 7
    elif kind == "next_2_days":
        minutes = minutes or 60
    elif minutes <= 0:
        match = re.search(r"every\s+(\d+)\s*(minute|min|hour|hr|day|week)", text)
        if match:
            n = max(1, int(match.group(1)))
            unit = match.group(2)
            minutes = n if unit.startswith("min") else n * 60 if unit.startswith("h") else n * 60 * 24 if unit.startswith("day") else n * 60 * 24 * 7
        else:
            minutes = 60
            kind = "hourly"
    expires = None
    if kind == "next_2_days":
        expires = (_now() + timedelta(days=2)).isoformat()
    return {"kind": kind, "interval_minutes": max(5, minutes), "expires_at": expires}


def _owned_team_ids(user_id: str) -> set[str]:
    return {
        t["id"]
        for t in teams_service.list_teams(user_id)
        if t.get("role") == "owner" or t.get("created_by") == user_id
    }


def create_automation(
    user: dict[str, Any],
    *,
    prompt: str,
    team_ids: list[str],
    schedule_kind: str | None = None,
    interval_minutes: int | None = None,
    email_if: bool = False,
    email_chips: list[str] | None = None,
    email_scenario: str = "",
) -> dict[str, Any]:
    text = (prompt or "").strip()
    if len(text) < 4:
        raise ValueError("Write a short prompt for this watchdog")
    owned = _owned_team_ids(user["id"])
    wanted = [tid for tid in (team_ids or []) if tid in owned]
    if not wanted:
        raise ValueError("Pick at least one workspace you own")
    sched = parse_schedule(text, schedule_kind, interval_minutes)
    chips = [c for c in (email_chips or []) if c in EMAIL_CHIPS]
    if "email me if" in text.lower() and not email_scenario:
        email_if = True
        rest = text.lower().split("email me if", 1)[-1].strip(" :.-")
        email_scenario = rest[:400] or email_scenario
    auto_id = str(uuid.uuid4())[:12]
    now = _now_iso()
    with get_conn() as conn:
        _ensure(conn)
        conn.execute(
            """
            INSERT INTO workspace_automations
            (id, owner_id, prompt, team_ids, schedule_kind, interval_minutes, expires_at,
             email_if, email_chips, email_scenario, last_run_at, last_digest, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '', ?)
            """,
            (
                auto_id,
                user["id"],
                text[:2000],
                json.dumps(wanted),
                sched["kind"],
                sched["interval_minutes"],
                sched["expires_at"],
                int(bool(email_if or chips or email_scenario)),
                json.dumps(chips),
                (email_scenario or "")[:800],
                now,
            ),
        )
    ops_log_service.write_note(
        "activity",
        f"watchdog-{auto_id}",
        f"Created. {sched['kind']} / {sched['interval_minutes']}m. teams={len(wanted)}",
        extra={"automation_id": auto_id},
    )
    return get_automation(auto_id, user["id"])


def _one_line(text: str, limit: int = 120) -> str:
    line = " ".join(str(text or "").split())
    if len(line) <= limit:
        return line
    return line[: limit - 1].rstrip() + "…"


def _note_body_line(preview: str) -> str:
    parts = []
    for ln in str(preview or "").splitlines():
        s = ln.strip()
        if not s or s.startswith("#") or s.startswith("date:") or s.startswith("keep:") or s.startswith("meta:"):
            continue
        parts.append(s)
    return _one_line(" · ".join(parts))


def _events_for(auto_id: str, notes: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    needle = str(auto_id or "")
    if not needle:
        return []
    rows = notes if notes is not None else ops_log_service.list_notes(limit=80)
    out: list[dict[str, Any]] = []
    for note in rows:
        blob = f"{note.get('name') or ''} {note.get('path') or ''} {note.get('preview') or ''}"
        if needle not in blob:
            continue
        text = _note_body_line(note.get("preview") or "") or _one_line(note.get("name") or "tick")
        out.append({"at": note.get("mtime") or "", "kind": note.get("kind") or "tick", "text": text})
        if len(out) >= 24:
            break
    return out


def _row(row: Any) -> dict[str, Any]:
    data = dict(row)
    try:
        data["team_ids"] = json.loads(data.get("team_ids") or "[]")
    except json.JSONDecodeError:
        data["team_ids"] = []
    try:
        data["email_chips"] = json.loads(data.get("email_chips") or "[]")
    except json.JSONDecodeError:
        data["email_chips"] = []
    data["email_if"] = bool(int(data.get("email_if") or 0))
    return data


def _enrich(auto: dict[str, Any], notes: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    preview = _one_line(auto.get("last_digest") or "")
    events = _events_for(auto.get("id") or "", notes)
    if not events and preview:
        events = [{"at": auto.get("last_run_at") or "", "kind": "tick", "text": preview}]
    auto["last_preview"] = preview
    auto["events"] = events
    return auto


def list_automations(user_id: str) -> list[dict[str, Any]]:
    with get_conn() as conn:
        _ensure(conn)
        rows = conn.execute(
            "SELECT * FROM workspace_automations WHERE owner_id=? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
    notes = ops_log_service.list_notes(limit=80)
    return [_enrich(_row(r), notes) for r in rows]


def get_automation(auto_id: str, user_id: str) -> dict[str, Any]:
    with get_conn() as conn:
        _ensure(conn)
        row = conn.execute(
            "SELECT * FROM workspace_automations WHERE id=? AND owner_id=?",
            (auto_id, user_id),
        ).fetchone()
    if not row:
        raise PermissionError("Watchdog not found")
    return _enrich(_row(row))


def delete_automation(auto_id: str, user_id: str) -> None:
    with get_conn() as conn:
        _ensure(conn)
        conn.execute(
            "DELETE FROM workspace_automations WHERE id=? AND owner_id=?",
            (auto_id, user_id),
        )


def _project_stats(team_ids: list[str]) -> list[dict[str, Any]]:
    from backend.services.ai_cost import entry_effective_cost
    from backend.services.prompt_history_service import HISTORY_FILE

    projects_dir = Path(settings.projects_dir)
    with get_conn() as conn:
        placeholders = ",".join("?" * len(team_ids)) or "''"
        rows = conn.execute(
            f"""
            SELECT pa.project_id, pa.team_id, t.name AS team_name
            FROM project_access pa
            JOIN teams t ON t.id = pa.team_id
            WHERE pa.team_id IN ({placeholders})
            """,
            tuple(team_ids),
        ).fetchall() if team_ids else []
    stats = []
    for row in rows:
        pid = row["project_id"]
        hist = projects_dir / pid / HISTORY_FILE
        prompts = 0
        cost = 0.0
        errors = 0
        if hist.is_file():
            try:
                entries = json.loads(hist.read_text(encoding="utf-8") or "[]")
            except Exception:
                entries = []
            if isinstance(entries, dict):
                entries = entries.get("entries") or []
            for entry in entries[-80:] if isinstance(entries, list) else []:
                if not isinstance(entry, dict):
                    continue
                prompts += 1
                cost += float(entry_effective_cost(entry) or 0)
                status = str(entry.get("status") or entry.get("error") or "").lower()
                if "error" in status or "fail" in status:
                    errors += 1
        stats.append(
            {
                "project_id": pid,
                "team_id": row["team_id"],
                "team_name": row["team_name"],
                "prompts": prompts,
                "cost_usd": round(cost, 4),
                "errors": errors,
            }
        )
    stats.sort(key=lambda s: (s["prompts"], s["cost_usd"]), reverse=True)
    return stats[:12]


def _activity_counts(team_ids: list[str], hours: int = 24) -> dict[str, int]:
    since = (_now() - timedelta(hours=hours)).isoformat()
    with get_conn() as conn:
        if not team_ids:
            return {"events": 0, "users": 0}
        placeholders = ",".join("?" * len(team_ids))
        row = conn.execute(
            f"""
            SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS users
            FROM workspace_activity
            WHERE team_id IN ({placeholders}) AND created_at >= ?
            """,
            (*team_ids, since),
        ).fetchone()
    return {"events": int(row["n"] or 0), "users": int(row["users"] or 0)}


def _digest(auto: dict[str, Any]) -> tuple[str, bool]:
    """Return (miniaturized digest, important)."""
    teams = auto.get("team_ids") or []
    stats = _project_stats(teams)
    activity = _activity_counts(teams)
    prompt = str(auto.get("prompt") or "").lower()
    chips = auto.get("email_chips") or []
    top = stats[0] if stats else None
    lines = [
        f"{auto.get('schedule_kind')} watchdog",
        f"activity 24h: {activity['events']} events / {activity['users']} users",
    ]
    if top:
        lines.append(f"top project {top['project_id']}: {top['prompts']} prompts · ${top['cost_usd']}")
    if len(stats) > 1:
        lines.append(
            "expense: "
            + ", ".join(f"{s['project_id']}=${s['cost_usd']}" for s in stats[:4])
        )
    err_n = sum(s["errors"] for s in stats)
    if err_n:
        lines.append(f"errors: {err_n}")
    important = False
    if err_n and ("bug" in chips or "error" in prompt or "bug" in prompt):
        important = True
    if "users" in chips and activity["users"] == 0 and "no user" in str(auto.get("email_scenario") or "").lower():
        important = True
    if "projects" in chips and top and top["cost_usd"] >= 1 and "cost" in prompt:
        important = True
    if any(w in prompt for w in ("leak", "crash", "spike", "outage")) and (err_n or activity["events"] == 0):
        important = True
    if auto.get("email_if") and auto.get("email_scenario"):
        scenario = str(auto.get("email_scenario") or "").lower()
        if "bug" in scenario and err_n:
            important = True
        if "no one" in scenario and activity["users"] == 0:
            important = True
        if "expensive" in scenario or "spend" in scenario:
            if top and top["cost_usd"] >= 0.5:
                important = True
    return ops_log_service.miniaturize("\n".join(lines)), important


def _send_mail(*, to: list[str], subject: str, text: str, attachments: list[dict[str, Any]] | None = None, from_address: str | None = None) -> dict[str, Any]:
    if not smtp_configured():
        return {"ok": False, "error": "smtp_not_configured"}
    recips = [e for e in to if e]
    if not recips:
        return {"ok": False, "error": "no_recipients"}
    msg = EmailMessage()
    msg["Subject"] = subject[:140]
    msg["From"] = (from_address or settings.capacity_alert_from or settings.capacity_alert_smtp_user).strip()
    msg["To"] = ", ".join(dict.fromkeys(recips))
    msg.set_content(text)
    for att in attachments or []:
        data = att.get("content")
        filename = str(att.get("filename") or "attachment")
        if not isinstance(data, (bytes, bytearray)) or not data:
            continue
        ctype = str(att.get("content_type") or "application/octet-stream").split(";")[0].strip().lower()
        if "/" in ctype:
            main, sub = ctype.split("/", 1)
        else:
            main, sub = "application", "octet-stream"
        msg.add_attachment(bytes(data), maintype=main or "application", subtype=sub or "octet-stream", filename=filename)
    host = (settings.capacity_alert_smtp_host or "smtp.gmail.com").strip()
    port = int(settings.capacity_alert_smtp_port or 587)
    with smtplib.SMTP(host, port, timeout=30) as smtp:
        smtp.ehlo()
        smtp.starttls()
        smtp.ehlo()
        smtp.login(settings.capacity_alert_smtp_user.strip(), settings.capacity_alert_smtp_password.strip())
        smtp.send_message(msg)
    return {"ok": True, "to": recips, "attachment_count": len(attachments or [])}


def _owner_email(user_id: str) -> str:
    with get_conn() as conn:
        row = conn.execute("SELECT email FROM users WHERE id=?", (user_id,)).fetchone()
    return str(row["email"] if row else "").strip().lower()


def run_due(*, now: datetime | None = None) -> dict[str, int]:
    stamp = now or _now()
    ran = 0
    mailed = 0
    expired = 0
    with get_conn() as conn:
        _ensure(conn)
        rows = conn.execute("SELECT * FROM workspace_automations").fetchall()
    for raw in rows:
        auto = _row(raw)
        exp = auto.get("expires_at")
        if exp:
            try:
                if datetime.fromisoformat(exp) <= stamp:
                    delete_automation(auto["id"], auto["owner_id"])
                    expired += 1
                    continue
            except ValueError:
                pass
        last = auto.get("last_run_at")
        due = True
        if last:
            try:
                due = stamp >= datetime.fromisoformat(last) + timedelta(minutes=int(auto["interval_minutes"] or 60))
            except ValueError:
                due = True
        if not due:
            continue
        digest, important = _digest(auto)
        kind = ops_log_service.route_kind(auto.get("prompt") or "", (auto.get("email_chips") or [None])[0])
        if important:
            ops_log_service.write_note(kind, f"watchdog-{auto['id']}", digest, keep=True, extra={"automation_id": auto["id"]})
        else:
            ops_log_service.write_note(
                "activity_logs",
                f"tick-{auto['id']}",
                digest,
                extra={"automation_id": auto["id"]},
            )
        if auto.get("email_if") and important:
            owner = _owner_email(auto["owner_id"])
            result = _send_mail(
                to=[owner, SAM_EMAIL],
                subject=f"Render Studio watchdog: {auto['prompt'][:60]}",
                text=f"{auto['prompt']}\n\n{digest}\n\nScenario: {auto.get('email_scenario') or '—'}",
            )
            if result.get("ok"):
                mailed += 1
        with get_conn() as conn:
            conn.execute(
                "UPDATE workspace_automations SET last_run_at=?, last_digest=? WHERE id=?",
                (stamp.isoformat(), digest[:500], auto["id"]),
            )
        ran += 1
    ops_log_service.prune_all()
    return {"ran": ran, "mailed": mailed, "expired": expired}


def run_one(auto_id: str, user_id: str) -> dict[str, Any]:
    auto = get_automation(auto_id, user_id)
    digest, important = _digest(auto)
    kind = ops_log_service.route_kind(auto.get("prompt") or "")
    note = ops_log_service.write_note(
        kind if important else "activity_logs",
        f"run-{auto_id}",
        digest,
        keep=important,
        extra={"automation_id": auto_id},
    )
    with get_conn() as conn:
        conn.execute(
            "UPDATE workspace_automations SET last_run_at=?, last_digest=? WHERE id=?",
            (_now_iso(), digest[:500], auto_id),
        )
    return {"digest": digest, "important": important, "note": note, "automation": get_automation(auto_id, user_id)}


def send_idea_email(user: dict[str, Any], title: str, body: str) -> dict[str, Any]:
    who = f"{user.get('display_name') or ''} <{user.get('email') or ''}>".strip()
    text = f"Foundry idea from {who}\n\n{title}\n\n{body}"
    result = _send_mail(to=[SAM_EMAIL], subject=f"Foundry idea: {title[:70]}", text=text)
    result["administrator"] = SAM_EMAIL
    return result


def send_user_debugger(user: dict[str, Any], title: str, body: str, *, send_bug_branch: bool = False) -> dict[str, Any]:
    note = ops_log_service.write_note("bugs", title or "user-debugger", f"{user.get('email')}: {body}", keep=True)
    mail = _send_mail(
        to=[SAM_EMAIL],
        subject=f"User debugger: {title[:70]}",
        text=f"{user.get('display_name')} ({user.get('email')})\n\n{body}",
    )
    gh: dict[str, Any] = {"ok": False, "skipped": True}
    if send_bug_branch:
        from backend.services import github_link_service

        gh = github_link_service.push_bug_note(title, ops_log_service.miniaturize(body))
    from backend.services import debug_training_service as dts

    training = dts.ingest_quietly(
        title=title or "user-debugger",
        traceback_text=body,
        source="foundry-debugger",
    )
    return {"note": note, "email": mail, "github": gh, "debug_training": training}


def start_background_loop() -> None:
    global _loop_started
    flag = os.environ.get("RENDER3D_WORKSPACE_AUTOMATION", "1").strip().lower()
    if flag in {"0", "false", "no", "off"}:
        logger.info("Workspace automation loop disabled")
        return
    with _loop_lock:
        if _loop_started:
            return
        _loop_started = True

    def _loop() -> None:
        time.sleep(STARTUP_DELAY)
        while True:
            try:
                run_due()
            except Exception:
                logger.warning("Watchdog loop failed", exc_info=True)
            time.sleep(LOOP_SECONDS)

    threading.Thread(target=_loop, name="workspace-automation", daemon=True).start()
    logger.info("Workspace automation loop started")
