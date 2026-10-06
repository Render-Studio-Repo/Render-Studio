"""Export incident packets to Grok, share links, local PDFs, debugger, or a MacBook."""
from __future__ import annotations

import html
import json
import re
import subprocess
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from backend.config import settings
from backend.services import incident_intelligence_service as ii
from backend.services.simple_pdf import pdf_bytes as _pdf_bytes

DESTINATIONS = {"grok", "share", "local", "debugger", "macbook"}
VOTES = {"up", "down", "none"}
SSH_RE = re.compile(r"^[A-Za-z0-9._-]+(@[A-Za-z0-9.-]+)?$")
CENTRAL = ZoneInfo("America/Chicago")


def _grok_inbox() -> Path:
    return ii.LOG_ROOT / "grok-inbox.jsonl"


def _debug_inbox() -> Path:
    return ii.LOG_ROOT / "inbox"


def _pdf_root() -> Path:
    return ii.LOG_ROOT / "pdf-exports"


def _central() -> dict[str, str]:
    now = datetime.now(CENTRAL)
    hour12 = now.strftime("%I").lstrip("0") or "12"
    ampm = now.strftime("%p")
    return {
        "date_folder": f"{now.month}-{now.day}-{now.year}",
        "time_folder": f"{hour12}-{now.minute:02d}-{ampm}-central",
        "date_txt": f"{now.month}-{now.day}-{now.year}",
        "time_txt": f"{hour12}:{now.minute:02d} {ampm} Central",
        "iso": now.isoformat(),
    }



def list_exports(limit: int = 20) -> list[dict[str, Any]]:
    with ii._conn() as conn:
        rows = conn.execute("SELECT * FROM exports ORDER BY ts DESC LIMIT ?", (max(1, min(int(limit), 80)),)).fetchall()
    return [ii._row(row) for row in rows]


def pending_audits() -> list[dict[str, Any]]:
    with ii._conn() as conn:
        rows = conn.execute(
            "SELECT * FROM exports WHERE vote = 'up' AND id NOT IN (SELECT export_id FROM audits WHERE actor = 'grok') ORDER BY ts DESC LIMIT 30"
        ).fetchall()
    return [ii._row(row) for row in rows]


def public_share(token: str) -> dict[str, Any] | None:
    token = str(token or "").strip()
    if not re.fullmatch(r"[0-9a-f]{32}", token):
        return None
    with ii._conn() as conn:
        row = conn.execute("SELECT * FROM exports WHERE share_token = ?", (token,)).fetchone()
    if not row:
        return None
    data = ii._row(row)
    data.pop("remote_path", None)
    return data


def share_html(row: dict[str, Any]) -> str:
    packet = html.escape(str(row.get("packet") or ""))
    return f"""<!doctype html><meta charset="utf-8"><title>Incident {html.escape(row.get('feature') or '')}</title>
<body style="background:#0d1825;color:#e8f3fb;font:14px/1.45 ui-sans-serif,system-ui;max-width:760px;margin:32px auto;padding:0 16px">
<h1>Incident packet</h1>
<p>Feature <code>{html.escape(row.get('feature') or '')}</code> · traceback <code>{html.escape(row.get('traceback_id') or '')}</code></p>
<p>Vote {html.escape(row.get('vote') or 'none')} · confidence {html.escape(str(row.get('confidence')))}</p>
<pre style="white-space:pre-wrap;background:#111d2b;padding:12px;border-radius:8px">{packet}</pre>
</body>"""


def accuracy_chart(day: str | None = None) -> dict[str, Any]:
    stamp = _central()
    day = day or stamp["date_txt"]
    with ii._conn() as conn:
        rows = [ii._row(r) for r in conn.execute("SELECT * FROM audits ORDER BY ts DESC LIMIT 200").fetchall()]
        exports = [ii._row(r) for r in conn.execute("SELECT * FROM exports ORDER BY ts DESC LIMIT 80").fetchall()]
    today_exports = [row for row in exports if (row.get("fields") or {}).get("central_date") == day]
    export_ids = {row["id"] for row in today_exports}
    today = [row for row in rows if row.get("export_id") in export_ids]
    sam = [row for row in today if row.get("actor") == "sam"]
    bot = [row for row in today if row.get("actor") == "grok"]
    def tally(items: list[dict[str, Any]]) -> dict[str, int]:
        return {
            "correct": sum(1 for row in items if row.get("correct") is True or row.get("correct") == 1),
            "wrong": sum(1 for row in items if row.get("correct") is False or row.get("correct") == 0),
            "pending": sum(1 for row in items if row.get("correct") is None),
        }
    pending_ok = len(pending_audits())
    sam_tally = tally(sam)
    sam_tally["pending"] += pending_ok
    sam_tally["assumed_ok"] = sum(1 for row in today_exports if row.get("sam_claim") == "assumed_ok")
    return {
        "day": day,
        "timezone": "America/Chicago",
        "sam": sam_tally,
        "bot": tally(bot),
        "points": today[:40],
        "pending_audits": pending_ok,
    }


def _write_local_pdf(export_id: str, feature: str, packet: str, stamp: dict[str, str], extra: dict[str, Any]) -> dict[str, str]:
    folder = _pdf_root() / stamp["date_folder"] / stamp["time_folder"] / export_id
    folder.mkdir(parents=True, exist_ok=True)
    txt_path = folder / f"{export_id}.txt"
    pdf_path = folder / f"{export_id}.pdf"
    txt = "\n".join([
        f"date: {stamp['date_txt']}",
        f"time: {stamp['time_txt']}",
        f"traceback_id: {export_id}",
        f"feature: {feature}",
        f"log_id: {extra.get('log_id') or ''}",
        f"vote: {extra.get('vote') or 'none'}",
        f"confidence: {extra.get('confidence')}",
        f"sam_claim: {extra.get('sam_claim')}",
        "",
        packet,
        "",
    ])
    txt_path.write_text(txt, encoding="utf-8")
    pdf_path.write_bytes(_pdf_bytes(f"Incident {feature}", txt))
    return {
        "folder_path": str(folder.relative_to(ii.ROOT_DIR)),
        "pdf_path": str(pdf_path.relative_to(ii.ROOT_DIR)),
        "txt_path": str(txt_path.relative_to(ii.ROOT_DIR)),
    }


def _scp_downloads(local_pdf: Path) -> dict[str, Any]:
    target = str(getattr(settings, "incident_export_ssh", "") or "").strip()
    remote_dir = str(getattr(settings, "incident_export_ssh_dir", "") or "Downloads").strip() or "Downloads"
    if not target:
        return {"ok": False, "error": "Set INCIDENT_EXPORT_SSH=user@macbook-host in .env"}
    if not SSH_RE.fullmatch(target) or ".." in remote_dir or remote_dir.startswith("/"):
        return {"ok": False, "error": "Invalid SSH export target"}
    remote = f"{target}:~/{remote_dir.lstrip('~/')}/{local_pdf.name}"
    try:
        completed = subprocess.run(
            ["scp", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", str(local_pdf), remote],
            capture_output=True, text=True, timeout=20, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"ok": False, "error": str(exc)[:300], "remote": remote}
    if completed.returncode != 0:
        return {"ok": False, "error": (completed.stderr or completed.stdout or "scp failed")[:400], "remote": remote}
    return {"ok": True, "remote": remote}


def export_packet(data: dict[str, Any]) -> dict[str, Any]:
    destination = str(data.get("destination") or "").strip().lower()
    if destination not in DESTINATIONS:
        raise ValueError("destination must be grok, share, local, debugger, or macbook")
    feature = str(data.get("feature") or "").strip().lower()
    if feature == "all":
        overview = ii.overview()
        alerts = overview.get("alerts") or []
        if not alerts:
            raise ValueError("No active alerts to export")
        return {"ok": True, "exports": [export_packet({**data, "feature": row["feature"], "log_id": row.get("log_id")}) for row in alerts]}
    comparison = ii.compare(feature)
    packet = comparison.get("cursor_packet") or ii.cursor_packet(comparison)
    export_id = uuid.uuid4().hex
    stamp = _central()
    vote = "none"
    claim = "assumed_ok"
    confidence = 0.7
    log_id = str(data.get("log_id") or (comparison.get("first_failure") or {}).get("id") or "")
    row = {
        "id": export_id, "ts": ii.now(), "destination": destination, "feature": feature,
        "log_id": log_id, "traceback_id": export_id, "vote": vote, "confidence": confidence,
        "sam_claim": claim, "folder_path": "", "pdf_path": "", "txt_path": "",
        "share_token": "", "share_url": "", "grok_inbox": "", "remote_path": "",
        "note": str(data.get("note") or "")[:1500], "packet": packet,
        "fields": {"central_date": stamp["date_txt"], "central_time": stamp["time_txt"], **stamp},
    }
    if destination in {"local", "macbook"}:
        paths = _write_local_pdf(export_id, feature, packet, stamp, row)
        row.update(paths)
    if destination == "share" or destination == "local":
        token = uuid.uuid4().hex
        row["share_token"] = token
        base = str(getattr(settings, "public_base_url", "") or "https://render3d.app").rstrip("/")
        row["share_url"] = f"{base}/share/incident/{token}"
        if destination == "local" and not row.get("pdf_path"):
            row.update(_write_local_pdf(export_id, feature, packet, stamp, row))
    if destination == "debugger":
        DEBUG_INBOX = _debug_inbox()
        DEBUG_INBOX.mkdir(parents=True, exist_ok=True)
        path = DEBUG_INBOX / f"{stamp['date_folder']}-{export_id}.md"
        path.write_text(f"# {feature}\n\ntraceback_id: {export_id}\n{stamp['date_txt']} {stamp['time_txt']}\n\n```\n{packet}\n```\n", encoding="utf-8")
        row["folder_path"] = str(path.relative_to(ii.ROOT_DIR))
    if destination == "grok":
        inbox = _grok_inbox()
        inbox.parent.mkdir(parents=True, exist_ok=True)
        item = {"kind": "incident-export", "export_id": export_id, "feature": feature, "traceback_id": export_id,
                "packet": packet, "audit_required": False, "created_at": row["ts"]}
        with inbox.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(item, ensure_ascii=False) + "\n")
        row["grok_inbox"] = str(inbox.relative_to(ii.ROOT_DIR)) if str(inbox).startswith(str(ii.ROOT_DIR)) else str(inbox)
        ii.record_finding({"feature": feature, "hypothesis": "Packet exported to Grok bot", "steps": ["Read grok_incident inbox", "Compare snapshots"], "evidence": {"export_id": export_id}, "outcome": "unverified"})
    if destination == "macbook":
        pdf = ii.ROOT_DIR / row["pdf_path"] if row.get("pdf_path") else None
        scp = _scp_downloads(pdf) if pdf and pdf.is_file() else {"ok": False, "error": "PDF missing"}
        row["remote_path"] = scp.get("remote") or ""
        row["note"] = (row["note"] + " " + (scp.get("error") or "")).strip()
        row["fields"]["scp_ok"] = scp.get("ok")
        row["fields"]["scp_error"] = scp.get("error") or ""
    with ii._conn() as conn:
        conn.execute(
            "INSERT INTO exports VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (row["id"], row["ts"], row["destination"], row["feature"], row["log_id"], row["traceback_id"],
             row["vote"], row["confidence"], row["sam_claim"], row["folder_path"], row["pdf_path"], row["txt_path"],
             row["share_token"], row["share_url"], row["grok_inbox"], row["remote_path"], row["note"], row["packet"],
             ii._json(row["fields"])),
        )
    return row


def vote_export(export_id: str, vote: str) -> dict[str, Any]:
    vote = str(vote or "none").lower()
    if vote not in VOTES:
        raise ValueError("vote must be up, down, or none")
    if not re.fullmatch(r"[0-9a-f]{32}", export_id):
        raise ValueError("invalid export id")
    with ii._conn() as conn:
        row = conn.execute("SELECT * FROM exports WHERE id = ?", (export_id,)).fetchone()
        if not row:
            raise ValueError("export not found")
        data = ii._row(row)
        if vote == "up":
            claim, confidence = "ok", 0.9
        elif vote == "down":
            claim, confidence = "broken", 0.95
        else:
            claim, confidence = "assumed_ok", 0.7
        conn.execute("UPDATE exports SET vote=?, confidence=?, sam_claim=? WHERE id=?", (vote, confidence, claim, export_id))
    if data.get("txt_path"):
        txt = ii.ROOT_DIR / data["txt_path"]
        if txt.is_file():
            body = txt.read_text(encoding="utf-8")
            for old, new in (("vote: none", f"vote: {vote}"), ("vote: up", f"vote: {vote}"), ("vote: down", f"vote: {vote}")):
                if old in body:
                    body = body.replace(old, new, 1)
                    break
            else:
                body = f"vote: {vote}\n" + body
            txt.write_text(body, encoding="utf-8")
    if vote == "down":
        ii.record_event({"feature": data["feature"], "status": "broken", "kind": "export-vote", "source": "thumbs-down",
                         "prompt_id": "", "note": f"Export {export_id} marked bad", "fields": {"traceback_id": export_id}})
        liability = ii.record_event({
            "feature": "user.damage",
            "status": "broken",
            "kind": "export-vote",
            "source": "thumbs-down",
            "prompt_id": "",
            "note": f"Export {export_id} thumbs-down",
            "fields": {"export_id": export_id, "origin_feature": data.get("feature") or ""},
        })
        try:
            from backend.services import debugger_swarm_service as dss
            dss.ingest_thumb_down_liability({
                "event_id": liability.get("id"),
                "export_id": export_id,
                "note": f"thumbs-down {export_id}",
                "user_damage": 40,
            })
        except Exception:
            pass
        _record_audit({"export_id": export_id, "feature": data["feature"], "actor": "sam", "claimed": "broken", "verified": "broken", "correct": True, "note": "thumbs-down"})
    elif vote == "up":
        _queue_grok_audit(export_id, data["feature"], data.get("packet") or "")
        _record_audit({"export_id": export_id, "feature": data["feature"], "actor": "sam", "claimed": "ok", "verified": "pending", "correct": None, "note": "thumbs-up pending grok audit"})
    else:
        _record_audit({"export_id": export_id, "feature": data["feature"], "actor": "sam", "claimed": "assumed_ok", "verified": "pending", "correct": None, "note": "no vote, assumed ok at 70%"})
    with ii._conn() as conn:
        updated = conn.execute("SELECT * FROM exports WHERE id = ?", (export_id,)).fetchone()
    return ii._row(updated)


def _queue_grok_audit(export_id: str, feature: str, packet: str) -> None:
    inbox = _grok_inbox()
    inbox.parent.mkdir(parents=True, exist_ok=True)
    item = {
        "kind": "audit-sam-ok",
        "export_id": export_id,
        "feature": feature,
        "traceback_id": export_id,
        "instruction": "Sam marked this OK. Do not take that at face value. Re-run compare, smoke, and a client check if needed.",
        "packet": packet,
        "audit_required": True,
        "created_at": ii.now(),
    }
    with inbox.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(item, ensure_ascii=False) + "\n")
    ii.record_finding({
        "feature": feature,
        "hypothesis": "Sam marked OK — Grok must audit before feature status becomes ok",
        "steps": ["grok_incident action=audit", "compare feature", "smoke", "reject if still broken"],
        "evidence": {"export_id": export_id, "audit_required": True},
        "outcome": "unverified",
    })


def _record_audit(data: dict[str, Any]) -> dict[str, Any]:
    row = {
        "id": uuid.uuid4().hex, "ts": ii.now(), "export_id": str(data.get("export_id") or ""),
        "feature": ii._feature(data.get("feature")), "actor": str(data.get("actor") or "sam")[:20],
        "claimed": str(data.get("claimed") or "")[:40], "verified": str(data.get("verified") or "pending")[:40],
        "correct": data.get("correct"), "note": str(data.get("note") or "")[:1500],
    }
    correct = row["correct"]
    flag = None if correct is None else int(bool(correct))
    with ii._conn() as conn:
        conn.execute("INSERT INTO audits VALUES (?,?,?,?,?,?,?,?,?)",
                     (row["id"], row["ts"], row["export_id"], row["feature"], row["actor"], row["claimed"], row["verified"], flag, row["note"]))
    row["correct"] = correct
    return row


def record_audit(data: dict[str, Any]) -> dict[str, Any]:
    verified = str(data.get("verified") or data.get("status") or "").lower()
    if verified not in {"ok", "broken", "missing", "degraded", "unknown"}:
        raise ValueError("verified status required")
    export_id = str(data.get("export_id") or "")
    with ii._conn() as conn:
        exported = conn.execute("SELECT * FROM exports WHERE id = ?", (export_id,)).fetchone()
    if not exported:
        raise ValueError("export not found")
    exported_row = ii._row(exported)
    claimed = exported_row.get("sam_claim") or "assumed_ok"
    sam_ok = claimed in {"ok", "assumed_ok"}
    actually_ok = verified == "ok"
    sam_correct = (sam_ok and actually_ok) or ((claimed == "broken") and verified in {"broken", "missing", "degraded"})
    grok_claim = str(data.get("grok_claim") or verified)
    grok_correct = grok_claim == verified or grok_claim == ("ok" if actually_ok else "broken")
    bot = _record_audit({"export_id": export_id, "feature": exported_row["feature"], "actor": "grok",
                         "claimed": grok_claim, "verified": verified, "correct": grok_correct,
                         "note": str(data.get("note") or "grok audit")})
    _record_audit({"export_id": export_id, "feature": data.get("feature") or exported_row["feature"], "actor": "sam",
                    "claimed": claimed, "verified": verified, "correct": sam_correct,
                    "note": "resolved after grok audit"})
    if verified in {"broken", "missing", "degraded"}:
        ii.record_event({"feature": exported_row["feature"], "status": verified, "kind": "grok-audit", "source": "grok",
                         "note": f"Grok audit rejected Sam OK on {export_id}", "fields": {"traceback_id": export_id}})
    elif verified == "ok" and grok_correct:
        ii.record_event({"feature": exported_row["feature"], "status": "ok", "kind": "grok-audit", "source": "grok",
                         "note": f"Grok confirmed OK for {export_id}", "fields": {"traceback_id": export_id}})
    return {"ok": True, "grok": bot, "sam_correct": sam_correct, "accuracy": accuracy_chart()}


def grok_inbox(limit: int = 30) -> dict[str, Any]:
    rows = []
    inbox = _grok_inbox()
    if inbox.is_file():
        for line in inbox.read_text(encoding="utf-8").splitlines()[-max(1, min(int(limit), 80)):]:
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return {"ok": True, "inbox": list(reversed(rows)), "pending_audits": pending_audits()}
