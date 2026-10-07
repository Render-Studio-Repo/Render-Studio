"""Project-manager first-prompt loop: score, hire, email Sam, outline reply."""

from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
STORE = ROOT / "ai-context" / "agent-bus" / "pm-prompts"
OUTBOX = ROOT / "logs" / "Agent_Introductions" / "pm-prompts"
SAM_EMAIL = "sam@render3d.app"
SCHEMA = "rs.pm.prompt.v1"
DEFAULT_CYCLE = "CYCLE-20260916-PM1"
HIRE_SCORE = 70
HIRE_ASKS = 12
HIRE_COMMS = 10

MCP_TOOLS = ("pm_prompt_kit", "pm_prompt_submit", "pm_prompt_status")
MCP_PROMPTS = ("pm-first-loop", "pm-hire-screen")

STARTER_PROMPT = """You are Render Studio's project-manager. You do not ship code. You fan one battery, collect SCORECARDs, and return one PM_PACKET Cursor can eat (tickets[] + engineer_asks only).

Read only:
- Getting-Started/agents/START-EVERY-PROMPT.md
- Getting-Started/agents/AGENT-BUS.md
- Getting-Started/agents/PROMPT-project-manager.md
ref_id=INTRO-20260916 (logs/Agent_Introductions/). Specialists read their own PROMPT-*.md in that folder — never DMs.

Your first job this cycle (cycle_id={cycle_id}):
Write one project prompt to Cursor that asks what you need from Cursor to (1) hit this week's goals, (2) stand up team communication, and (3) run initial specialist interviews.

Then submit it — do not paste a transcript:

POST https://render3d.app/mcp  tools/call  name=pm_prompt_submit
arguments: {{
  "agent": "project-manager",
  "cycle_id": "{cycle_id}",
  "prompt": "<your project prompt to Cursor>"
}}

Cursor's first reply is an outline of what needs to be done, plus a question: how should we set up team communication so the other agents' Getting-Started skills fan out. Answer that next with the same tool and the same cycle_id.

Sam scores this first prompt (clarity, asking what Cursor needs, comms + interviews, bus/MCP, lane). Hire is yes/no on that first prompt only. instance_public_factor: 0.
"""

HIRE_SCREEN = """A passing first prompt asks Cursor what it needs (not a task dump), names this week's goals, proposes team comms + interviews, stays in the PM lane (tickets[] / engineer_asks, no shipping), and submits via pm_prompt_submit. Mention Getting-Started/agents/ + ref_id INTRO-20260916. Do not DM specialists."""

FIRST_REPLY = """OUTLINE (do this in order)

1. Read START-EVERY-PROMPT.md + AGENT-BUS.md. Mint cycle_id + prompt_id. category_id=DATA. instance_public_factor=0.
2. Propose a team-comms setup: one folder, one ref_id, no specialist DMs. Each agent reads only Getting-Started/agents/PROMPT-<role>.md.
3. Interview battery (same questions to every specialist):
   Q1 Lane this week (one sentence).
   Q2 What do you need from Cursor (tickets only)?
   Q3 Which Getting-Started file will you read, and how do you ACK the ref_id?
   Q4 Succeed 1–5 and one gap.
   Q5 Ops verbs you will submit.
   Q6 category_id you will use.
   Q7 Damage if we skip you this week.
   Q8 One engineer_ask for Cursor.
   Q9 Proof you will not DM.
   Q10 When your SCORECARD will hit the inbox.
4. Fan that battery on the bus (not chat). Collect SCORECARDs.
5. Return one PM_PACKET: tickets[] + engineer_asks only.
6. agent_ops_submit ops: ["fanout","collect","packet","submit"].

QUESTION
How do you want to set up team communication so we can distribute the other agents' Getting-Started skills (folder + ref_id only)? Reply with: channel, who fans, how specialists ACK, and the interview questions you will ask. Submit that plan with pm_prompt_submit using the same cycle_id.
"""

_ASKS = (
    "what do you need",
    "what you need",
    "need from you",
    "need from cursor",
    "what cursor needs",
    "engineer_asks",
    "ask you",
    "what i need from you",
    "what we need from you",
    "tickets[]",
    "tickets",
)
_GOALS = ("goal", "cycle", "weekly", "roadmap", "this week", "autonomy", "interview")
_COMMS = (
    "communicat",
    "interview",
    "fan-out",
    "fan out",
    "fanout",
    "getting-started",
    "getting started",
    "distribute",
    "team",
    "skill",
    "ref_id",
    "ack",
)
_MCP = ("agent_bus", "mcp", "pm_prompt_submit", "inbox", "pm_packet", "scorecard", "tools/call")
_LANE = ("do not ship", "don't ship", "not ship", "will not ship", "i do not ship", "tickets", "fan")
_IDS = ("prompt_id", "category_id", "cycle_id", "ref_id", "traceback", "intro-20260916")
_LANE_HIT = ("edit app.js", "i will code", "push to main", "ship the feature myself", "rewrite main.py")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _redact(text: str) -> str:
    blob = str(text or "")
    blob = re.sub(r"(?i)bearer\s+\S+", "Bearer [redacted]", blob)
    blob = re.sub(r"xai-[A-Za-z0-9_-]+", "xai-[redacted]", blob)
    blob = re.sub(r"(?i)(api[_-]?key|secret|password)\s*[:=]\s*\S+", r"\1=[redacted]", blob)
    return blob[:8000]


def _pts(hits: int, want: int, cap: int) -> int:
    if want <= 0:
        return 0
    return min(cap, int(round(cap * min(1.0, hits / want))))


def _count(hay: str, needles: tuple[str, ...]) -> int:
    return sum(1 for n in needles if n in hay)


def score_prompt(prompt: str) -> dict[str, Any]:
    raw = _redact(prompt).strip()
    hay = raw.lower()
    if not raw:
        return {
            "score": 0,
            "hire": "no",
            "factors": {
                "asks_cursor": 0,
                "goals": 0,
                "comms_interviews": 0,
                "mcp_bus": 0,
                "lane": 0,
                "ids": 0,
            },
            "reason": "empty prompt",
            "chars": 0,
        }
    asks = _pts(_count(hay, _ASKS), 3, 25)
    goals = _pts(_count(hay, _GOALS), 3, 15)
    comms = _pts(_count(hay, _COMMS), 4, 25)
    mcp = _pts(_count(hay, _MCP), 2, 15)
    lane = _pts(_count(hay, _LANE), 2, 10)
    ids = _pts(_count(hay, _IDS), 2, 10)
    if any(bad in hay for bad in _LANE_HIT):
        lane = max(0, lane - 8)
    total = asks + goals + comms + mcp + lane + ids
    if len(raw) < 40:
        total = min(total, 15)
    elif len(raw) < 120:
        total = int(total * 0.5)
    hire = "yes" if total >= HIRE_SCORE and asks >= HIRE_ASKS and comms >= HIRE_COMMS else "no"
    if hire == "yes":
        reason = "Asked what Cursor needs, named comms/interviews, stayed on the bus."
    else:
        missing = []
        if asks < HIRE_ASKS:
            missing.append("ask Cursor what it needs")
        if comms < HIRE_COMMS:
            missing.append("team comms + interviews")
        if total < HIRE_SCORE:
            missing.append(f"score {total}<{HIRE_SCORE}")
        reason = "First prompt missed: " + ", ".join(missing) + "."
    return {
        "score": int(total),
        "hire": hire,
        "factors": {
            "asks_cursor": asks,
            "goals": goals,
            "comms_interviews": comms,
            "mcp_bus": mcp,
            "lane": lane,
            "ids": ids,
        },
        "reason": reason,
        "chars": len(raw),
    }


def _cycle(raw: str | None) -> str:
    cycle = str(raw or "").strip()
    cycle = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in cycle)[:40]
    return cycle or DEFAULT_CYCLE


def kit(cycle_id: str | None = None) -> dict[str, Any]:
    cycle = _cycle(cycle_id or DEFAULT_CYCLE)
    return {
        "schema": SCHEMA,
        "cycle_id": cycle,
        "ref_id": "INTRO-20260916",
        "email_to": SAM_EMAIL,
        "mcp": "https://render3d.app/mcp",
        "tools": list(MCP_TOOLS),
        "prompts": list(MCP_PROMPTS),
        "starter_prompt": STARTER_PROMPT.format(cycle_id=cycle),
        "hire_screen": HIRE_SCREEN,
        "first_reply_preview": FIRST_REPLY,
        "skills_folder": "Getting-Started/agents/",
        "prompt_files": [
            "PROMPT-project-manager.md",
            "PROMPT-vibe-marketing.md",
            "PROMPT-vibe-sales.md",
            "PROMPT-vibe-rnd.md",
            "PROMPT-analytics.md",
            "PROMPT-clip-bot.md",
        ],
        "cursor_prompt": "PROMPT-cursor-engineer.md",
        "cursor_wake": "Paste Getting-Started/agents/PROMPT-cursor-engineer.md (or MCP prompt cursor-engineer-wake) into the Cursor IDE chat. agent_converse agent=cursor-engineer does not wake RM; use to=cursor-engineer + PM_PACKET.",
    }


def mcp_prompts_list() -> list[dict[str, Any]]:
    return [
        {
            "name": "pm-first-loop",
            "description": "Starter prompt Sam pastes to the project-manager to open the hire/comms loop.",
            "arguments": [
                {
                    "name": "cycle_id",
                    "description": "CYCLE-YYYYMMDD-HHMM (default CYCLE-20260916-PM1)",
                    "required": False,
                }
            ],
        },
        {
            "name": "pm-hire-screen",
            "description": "What Cursor expects in the PM's first submitted prompt.",
            "arguments": [],
        },
    ]


def mcp_prompts_get(name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    args = arguments or {}
    key = str(name or "").strip()
    if key == "pm-first-loop":
        body = kit(str(args.get("cycle_id") or "") or None)
        return {
            "description": "Paste this to the project-manager to start the loop.",
            "messages": [{"role": "user", "content": {"type": "text", "text": body["starter_prompt"]}}],
        }
    if key == "pm-hire-screen":
        return {
            "description": "Hire screen for the PM first prompt.",
            "messages": [{"role": "user", "content": {"type": "text", "text": HIRE_SCREEN}}],
        }
    raise ValueError("unknown prompt: " + key)


def _load_all() -> list[dict[str, Any]]:
    if not STORE.is_dir():
        return []
    rows: list[dict[str, Any]] = []
    for path in sorted(STORE.glob("*.json")):
        try:
            rows.append(json.loads(path.read_text(encoding="utf-8")))
        except (OSError, json.JSONDecodeError):
            continue
    rows.sort(key=lambda r: str(r.get("ts") or ""))
    return rows


def _first_for_agent(agent: str) -> dict[str, Any] | None:
    for row in _load_all():
        if str(row.get("agent") or "") == agent and row.get("is_first"):
            return row
    return None


def _write_row(row: dict[str, Any]) -> Path:
    STORE.mkdir(parents=True, exist_ok=True)
    OUTBOX.mkdir(parents=True, exist_ok=True)
    path = STORE / f"{row['cycle_id']}-{row['prompt_id']}.json"
    blob = json.dumps(row, indent=2) + "\n"
    path.write_text(blob, encoding="utf-8")
    (OUTBOX / path.name).write_text(blob, encoding="utf-8")
    return path


def _email_sam(subject: str, body: str) -> dict[str, Any]:
    OUTBOX.mkdir(parents=True, exist_ok=True)
    line = {"ts": _now(), "to": SAM_EMAIL, "subject": subject[:140], "body": body[:12000]}
    with (OUTBOX / "email-outbox.jsonl").open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(line) + "\n")
    try:
        from backend.services.workspace_automation_service import _send_mail

        return _send_mail(to=[SAM_EMAIL], subject=subject[:140], text=body[:12000])
    except Exception as exc:
        return {"ok": False, "error": str(exc)[:240], "outbox": True}


def _mail_body(row: dict[str, Any], first: dict[str, Any]) -> str:
    scored = first.get("scoring") or {}
    factors = scored.get("factors") or {}
    factor_lines = "\n".join(f"  {k}: {v}" for k, v in factors.items())
    return (
        f"HIRE: {str(first.get('hire') or 'no').upper()}\n"
        f"FIRST_PROMPT_SCORE: {first.get('score')}/100\n"
        f"hire_reason: {scored.get('reason') or first.get('reason') or ''}\n"
        f"is_first_submit: {bool(row.get('is_first'))}\n"
        f"cycle_id: {row.get('cycle_id')}\n"
        f"prompt_id: {row.get('prompt_id')}\n"
        f"this_submit_id: {row.get('prompt_id')}\n\n"
        f"--- first prompt ---\n{first.get('prompt') or ''}\n\n"
        f"--- this submit ---\n{row.get('prompt') or ''}\n\n"
        f"--- scoring (frozen on first prompt) ---\n{factor_lines}\n"
    )


def submit(args: dict[str, Any]) -> dict[str, Any]:
    prompt = _redact(str(args.get("prompt") or args.get("text") or ""))
    if not prompt.strip():
        raise ValueError("prompt is required")
    agent = str(args.get("agent") or "project-manager").strip().lower() or "project-manager"
    cycle = _cycle(str(args.get("cycle_id") or ""))
    prior = _first_for_agent(agent)
    is_first = prior is None
    scoring = score_prompt(prompt) if is_first else dict(prior.get("scoring") or {})
    if not is_first:
        scoring = {
            "score": int(prior.get("score") or 0),
            "hire": prior.get("hire") or "no",
            "factors": (prior.get("scoring") or {}).get("factors") or prior.get("factors") or {},
            "reason": (prior.get("scoring") or {}).get("reason") or prior.get("reason") or "",
            "chars": len(prompt),
            "frozen_from": prior.get("prompt_id"),
        }
    prompt_id = str(args.get("prompt_id") or f"prm_pm_{int(time.time())}")[:64]
    reply = FIRST_REPLY if is_first else (
        "Noted. Keep the same cycle_id. Next: fan Q1–Q10, collect SCORECARDs, "
        "agent_bus_submit PM_PACKET (tickets[] + engineer_asks). No specialist DMs."
    )
    row = {
        "schema": SCHEMA,
        "prompt_id": prompt_id,
        "cycle_id": cycle,
        "agent": agent,
        "ts": _now(),
        "prompt": prompt,
        "is_first": is_first,
        "score": int(scoring.get("score") or 0),
        "hire": scoring.get("hire") or "no",
        "reason": scoring.get("reason") or "",
        "scoring": scoring,
        "cursor_reply": reply,
        "ref_id": "INTRO-20260916",
    }
    path = _write_row(row)
    first = row if is_first else prior or row
    subject = (
        f"PM first prompt — HIRE {str(first.get('hire') or 'no').upper()} — {first.get('score')}/100"
        if is_first
        else f"PM prompt (follow-up) — hire still {str(first.get('hire') or 'no').upper()} from first {first.get('score')}/100"
    )
    mail = _email_sam(subject, _mail_body(row, first))
    row["email"] = {"ok": bool(mail.get("ok")), "error": mail.get("error") or "", "to": SAM_EMAIL}
    path.write_text(json.dumps(row, indent=2) + "\n", encoding="utf-8")
    inbox = ROOT / "ai-context" / "agent-bus" / "inbox"
    inbox.mkdir(parents=True, exist_ok=True)
    (inbox / f"{cycle}-project-manager.json").write_text(
        json.dumps(
            {
                "schema": SCHEMA,
                "cycle_id": cycle,
                "agent": "project-manager",
                "packet": {
                    "prompt_id": prompt_id,
                    "hire": row["hire"],
                    "score": row["score"],
                    "cursor_reply": reply,
                    "is_first": is_first,
                },
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return {
        "ok": True,
        "path": str(path),
        "prompt_id": prompt_id,
        "cycle_id": cycle,
        "is_first": is_first,
        "score": row["score"],
        "hire": row["hire"],
        "reason": row["reason"],
        "factors": scoring.get("factors") or {},
        "cursor_reply": reply,
        "email": row["email"],
        "next": "answer the team-comms question" if is_first else "emit PM_PACKET",
    }


def status(limit: int = 20) -> dict[str, Any]:
    rows = _load_all()
    n = max(1, min(int(limit or 20), 50))
    slim = [
        {
            "prompt_id": r.get("prompt_id"),
            "cycle_id": r.get("cycle_id"),
            "is_first": r.get("is_first"),
            "score": r.get("score"),
            "hire": r.get("hire"),
            "ts": r.get("ts"),
        }
        for r in rows[-n:]
    ]
    first = next((r for r in rows if r.get("is_first")), None)
    return {
        "ok": True,
        "count": len(rows),
        "first_hire": (first or {}).get("hire"),
        "first_score": (first or {}).get("score"),
        "items": slim,
    }
