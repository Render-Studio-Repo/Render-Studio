"""AI Round Table chat, idea-toss loop, and harness-queued code. Token roundtbl1.

Never auto-applies production code. Cede stays pending_approval.
Never wipes last-* debugger files.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.config import ROOT_DIR
from backend.services import xr_debugger_service

TOKEN = "roundtbl1"
REQUEST_ID = "d9c98119-007"
LAST3 = "d9c98119-005 | d9c98119-006 | d9c98119-007"
TABLE_AGENTS = (
    "astra",
    "harness-mule",
    "ledger",
    "vibe-rnd",
    "vibe-marketing",
    "vibe-sales",
    "project-manager",
    "analytics",
    "clip-bot",
)
GROK_LOG_ROOTS = (
    ROOT_DIR / "mcp" / "grok-bot",
    ROOT_DIR / "ai-context" / "debugger",
)
TRIGGER_WORDS = ("trigger", "selectstart", "squeeze", "dimos", "xrctrl1", "xrctrl2", "quest")


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")


def idea_toss(topic: str, *, rounds: int = 3) -> dict[str, Any]:
    subject = str(topic or "headset work").strip()[:120]
    roster = [
        ("astra", "Astra"),
        ("vibe-rnd", "Vibe R&D"),
        ("project-manager", "Projects Manager"),
        ("analytics", "Analytics"),
    ]
    n = max(2, min(6, int(rounds or 3)))
    turns: list[dict[str, Any]] = []
    for i in range(n * 2):
        aid, name = roster[i % len(roster)]
        prior = turns[-1] if turns else None
        text = (
            f"{name} opens: {subject}. Keep tossing — do not one-shot."
            if not prior
            else f"{name} to {prior['agent_name']}: next angle on {subject}."
        )
        turns.append({
            "turn": i,
            "agent_id": aid,
            "agent_name": name,
            "reply_to": prior["agent_id"] if prior else "",
            "text": text[:180],
            "one_shot": False,
        })
    return {"ok": True, "loop": True, "topic": subject, "turns": turns, "token": TOKEN, "request_id": REQUEST_ID}


def post_table_lines(turns: list[dict[str, Any]]) -> dict[str, Any]:
    from backend.services import team_status_service

    posted = []
    for row in turns[:16]:
        who = str(row.get("agent_id") or "astra").strip().lower()
        if who not in TABLE_AGENTS or who in {"sam", "cursor-engineer"}:
            who = "astra"
        text = str(row.get("text") or "").strip()[:900]
        if not text:
            continue
        try:
            posted.append(team_status_service.post_round_table_line(who, text))
        except ValueError:
            continue
    return {"ok": True, "n": len(posted), "posted": posted, "simultaneous": True}


def write_code_draft(filename: str, code: str, *, agent: str = "astra") -> dict[str, Any]:
    name = Path(str(filename or "round-table-example.js")).name[:80] or "round-table-example.js"
    body = str(code or "")[:8000]
    return {
        "ok": True,
        "filename": name,
        "bytes": len(body),
        "agent": str(agent or "astra")[:40],
        "applied": False,
        "note": "Draft only — Studio/VR editor. Send to harness for pending_approval.",
        "token": TOKEN,
    }


def cede_code_to_harness(filename: str, code: str, *, agent: str = "astra", text: str = "") -> dict[str, Any]:
    from backend.services import mcp_watchdog_service

    draft = write_code_draft(filename, code, agent=agent)
    rec_text = (
        f"{text or 'Round table code example for harness update'}\n"
        f"token={TOKEN} request_id={REQUEST_ID} last3={LAST3} "
        f"file={draft['filename']} apply=false auto_apply=false status=pending_approval "
        "Do not production-reset. Wait for harness/user Approve."
    )
    queued = mcp_watchdog_service.rm_queue({
        "agent": "astra",
        "text": rec_text[:900],
        "tickets": ["ROUNDTBL-CODE"],
    })
    log = xr_debugger_service.write_xr_perf_log(
        {"id": "anon"},
        {
            "v": 1,
            "kind": "round-table",
            "auto": False,
            "manual": True,
            "filename": datetime.now(timezone.utc).strftime("%Y%m%d-%H%M-round-table.jsonl"),
            "description": "Round table code ceded pending_approval (roundtbl1)",
            "actions": [{"t": 0, "tool": "round-table-cede"}],
            "extra": {
                "request_id": REQUEST_ID,
                "last3": LAST3,
                "filename": draft["filename"],
                "apply": False,
                "status": "pending_approval",
            },
        },
    )
    return {
        "ok": True,
        "applied": False,
        "status": "pending_approval",
        "reset": False,
        "log": {"name": log.get("name"), "path": log.get("ai_path")},
        "rm": queued,
        "request_id": REQUEST_ID,
        "how": "Harness inbox only. Approve before any patch. Never auto-apply.",
    }


def _scan_logs() -> list[str]:
    hits: list[str] = []
    for root in GROK_LOG_ROOTS:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in {".md", ".jsonl", ".json", ".txt"}:
                continue
            if path.name.startswith(".") or "secret" in path.name.lower():
                continue
            try:
                text = path.read_text(encoding="utf-8", errors="ignore")[:80_000]
            except OSError:
                continue
            low = text.lower()
            if any(w in low for w in TRIGGER_WORDS):
                hits.append(str(path.relative_to(ROOT_DIR))[:120])
            if len(hits) >= 12:
                return hits
    return hits


def investigate_triggers() -> dict[str, Any]:
    from backend.services import debugger_analytics_service as das
    from backend.services import mcp_watchdog_service

    bugs = []
    try:
        bugs = das.list_bugs(20)
    except Exception:
        bugs = []
    related = [
        b for b in bugs
        if re.search(r"trigger|selectstart|squeeze|dimos|xr", str(b.get("name") or b.get("feature") or ""), re.I)
    ]
    ping = None
    bug_id = str((related[0] or {}).get("id") or "") if related else ""
    if bug_id:
        try:
            ping = das.ping_bug(bug_id)
        except Exception as exc:
            ping = {"ok": False, "error": str(exc)[:120]}
    logs = _scan_logs()
    options = [
        "Keep Studio trigger when DimOS is armed but the ray is not on a robotics-action (empty visor).",
        "pollGamepads must not continue past Studio handling unless DimOS actually owns the trigger.",
        "pickTriggerMoveMesh should not return null solely because DimOS is armed.",
        "Quest often skips selectstart — keep gamepad[0] poll; do not rewrite the controller stack.",
        "Feed compact xr-ctl ring to R&D via GET /api/ops/debugger-analytics/bugs/{id}/instances.",
    ]
    findings = {
        "request_id": REQUEST_ID,
        "last3": LAST3,
        "token": TOKEN,
        "obvious_miss": (
            "When isDimosTeleopArmed(), pollGamepads continues before Studio trigger. "
            "xrctrl1 astraTalk bypass in studioRoboticsInputAllowed never runs on that path. "
            "pickTriggerMoveMesh also returns null while armed."
        ),
        "rewrite": False,
        "options": options,
        "log_hits": logs,
        "bug_id": bug_id or None,
        "instances": ping,
    }
    log = xr_debugger_service.write_xr_perf_log(
        {"id": "anon"},
        {
            "v": 1,
            "kind": "round-table",
            "auto": False,
            "manual": True,
            "filename": datetime.now(timezone.utc).strftime("%Y%m%d-%H%M-round-table.jsonl"),
            "description": "Trigger R&D request — past instances + options (roundtbl1)",
            "actions": [{"t": 0, "tool": "trigger-rnd"}],
            "extra": findings,
        },
    )
    queued = mcp_watchdog_service.rm_queue({
        "agent": "astra",
        "text": (
            f"R&D: Quest trigger still broken. request_id={REQUEST_ID} last3={LAST3} "
            f"ping GET /api/ops/debugger-analytics/bugs/{{id}}/instances "
            f"log={log.get('name') or ''} obvious_miss=DimOS poll continue. No full rewrite."
        )[:900],
        "tickets": ["XR-TRIGGER-RND"],
    })
    return {
        "ok": True,
        "request_id": REQUEST_ID,
        "bug_id": bug_id or None,
        "instances": ping,
        "log": {"name": log.get("name"), "path": log.get("ai_path")},
        "findings": findings,
        "rm": queued,
        "token": TOKEN,
    }


def handle(action: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    args = body if isinstance(body, dict) else {}
    verb = str(action or args.get("action") or "").strip().lower()
    if verb in {"debugger", "debug", "debug_mode", "suggest"}:
        from backend.services import xr_control_live as live

        packet = live.debugger_packet(str(args.get("topic") or args.get("text") or "VR controls"))
        chat = post_table_lines([
            {
                "agent_id": row.get("agent") or "astra",
                "agent_name": row.get("agent") or "Astra",
                "text": str(row.get("text") or "")[:180],
            }
            for row in packet.get("suggestions") or []
        ])
        return {**packet, "chat": chat, "action": verb, "round_table": TOKEN}
    if verb in {"wire", "wire_scene", "ask_wire"}:
        from backend.services import xr_control_live as live

        queued = live.ask_wire(
            agent=str(args.get("agent") or "astra"),
            note=str(args.get("note") or args.get("text") or "Wire this to my scene"),
            config=args.get("config") if isinstance(args.get("config"), dict) else None,
        )
        return {**queued, "round_table": TOKEN}
    if verb in {"toss", "idea_toss", "listen"}:
        loop = idea_toss(str(args.get("topic") or args.get("text") or ""), rounds=int(args.get("rounds") or 3))
        chat = post_table_lines(loop["turns"])
        return {**loop, "chat": chat, "action": verb}
    if verb in {"write_code", "editor"}:
        return write_code_draft(str(args.get("filename") or ""), str(args.get("code") or args.get("text") or ""), agent=str(args.get("agent") or "astra"))
    if verb in {"cede_harness", "cede"}:
        return cede_code_to_harness(
            str(args.get("filename") or ""),
            str(args.get("code") or args.get("text") or ""),
            agent=str(args.get("agent") or "astra"),
            text=str(args.get("description") or ""),
        )
    if verb in {"investigate", "trigger_rnd"}:
        return investigate_triggers()
    if verb in {"pass_logs", "pass", "subscribe"}:
        return pass_live_logs(args)
    if verb in {"fix_wheels", "fix_rig", "wheels"}:
        return fix_wheels(args)
    if verb in {"qc_rig", "qc", "qc_fix"}:
        return qc_rig(args)
    raise ValueError("unknown round-table action")


def fix_wheels(args: dict[str, Any]) -> dict[str, Any]:
    from backend.services import rig_qc
    from backend.services import team_status_service

    names = args.get("filenames") or args.get("files") or []
    if isinstance(names, str):
        names = [names]
    packet = rig_qc.wheel_fix_packet(
        filenames=[str(n) for n in names if str(n).strip()],
        project_id=str(args.get("project_id") or args.get("project") or ""),
    )
    chat = post_table_lines([
        {
            "agent_id": "astra",
            "agent_name": "Astra",
            "text": f"Fix wheels on {', '.join(packet['filenames']) or 'picked Browser models'} — {packet['prompt'][:80]}",
        },
        {
            "agent_id": "clip-bot",
            "agent_name": "Clip-bot",
            "text": "QC seat ready after generate. Sidecars + Play clip, no dummy spheres. Token rigqc1.",
        },
    ])
    try:
        team_status_service.post_round_table_line(
            "vibe-rnd",
            "Holonomic example project 5bf8e783 — wheels must be revolute/continuous. auto_apply=false.",
        )
    except ValueError:
        pass
    return {**packet, "chat": chat, "action": "fix_wheels"}


def qc_rig(args: dict[str, Any]) -> dict[str, Any]:
    from backend.services import rig_qc

    filename = str(args.get("filename") or args.get("target_filename") or "")
    prompt = str(args.get("prompt") or args.get("text") or "make the wheels drive")
    project_path = args.get("project_path")
    if project_path:
        result = rig_qc.inspect_project(Path(str(project_path)), filename=filename, prompt=prompt)
    else:
        result = rig_qc.qc_rig_fix(
            sidecar=args.get("sidecar") if isinstance(args.get("sidecar"), dict) else None,
            urdf_text=str(args.get("urdf_text") or ""),
            joints=args.get("joints") if isinstance(args.get("joints"), list) else [],
            files=args.get("files") if isinstance(args.get("files"), list) else [],
            prompt=prompt,
            filename=filename,
        )
    return rig_qc.publish_qc(result, user=args.get("user") if isinstance(args.get("user"), dict) else {"id": "anon"})


def pass_live_logs(args: dict[str, Any]) -> dict[str, Any]:
    """Forward VR speech + AI chat now. Do not wait for the talk session to end."""
    voice = str(args.get("voice") or "").strip()[:400]
    draft = str(args.get("draft") or "").strip()[:240]
    chat = args.get("chat") if isinstance(args.get("chat"), list) else []
    lines = []
    for row in chat[-10]:
        if not isinstance(row, dict):
            continue
        text = str(row.get("text") or "").strip()[:180]
        if text:
            lines.append({"who": str(row.get("who") or "chat")[:24], "text": text})
    merged = " · ".join(
        part for part in [voice, draft, *(f"{r['who']}: {r['text']}" for r in lines)] if part
    )[:700]
    log = xr_debugger_service.write_xr_perf_log(
        {"id": "anon"},
        {
            "v": 1,
            "kind": "round-table",
            "auto": False,
            "manual": True,
            "filename": datetime.now(timezone.utc).strftime("%Y%m%d-%H%M-round-table.jsonl"),
            "description": (voice or draft or "VR+AI chat live pass")[:160],
            "actions": [{"t": 0, "tool": "round-table-pass"}],
            "extra": {
                "request_id": REQUEST_ID,
                "last3": LAST3,
                "wait_for_end": False,
                "live": True,
                "voice": voice,
                "draft": draft,
                "chat": lines,
                "merged": merged,
                "token": TOKEN,
            },
        },
    )
    chat_out = None
    if merged:
        try:
            chat_out = post_table_lines([{
                "agent_id": "astra",
                "agent_name": "Astra",
                "text": f"Live pass · {merged[:160]} · {REQUEST_ID}",
            }])
        except ValueError:
            chat_out = None
    return {
        "ok": True,
        "live": True,
        "wait_for_end": False,
        "request_id": REQUEST_ID,
        "last3": LAST3,
        "log": {"name": log.get("name"), "path": log.get("ai_path")},
        "merged": merged,
        "chat": chat_out,
        "token": TOKEN,
    }
