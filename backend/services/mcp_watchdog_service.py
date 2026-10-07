"""MCP communication watchdog: hello → converse, headcount until 19:00 CDT."""

from __future__ import annotations

import json
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
STORE = ROOT / "ai-context" / "agent-bus" / "watchdog"
HARNESS_INBOX = ROOT / "ai-context" / "agent-bus" / "harness-inbox"
REPORT_MD = STORE / "REPORT-COMMS-20260916.md"
EVENTS = STORE / "events.jsonl"
STATE = STORE / "state.json"
WEBHOOKS = STORE / "webhooks.json"
BROADCAST = STORE / "broadcast.jsonl"
CURSOR_TO = ("cursor-engineer", "regional-manager", "harness")
SAM_EMAIL = "sam@render3d.app"
TZ = ZoneInfo("America/Chicago")
WATCHDOG_ID = "wd-mcp-comms-20260916"
CYCLE_ID = "CYCLE-20260916-WD1"
CONV_ID = "conv-CYCLE-20260916-WD1-comms"
WINDOW_END = datetime(2026, 9, 16, 19, 0, tzinfo=TZ)
REQUIRED = (
    "project-manager",
    "vibe-marketing",
    "vibe-sales",
    "vibe-rnd",
    "analytics",
    "clip-bot",
    "cursor-engineer",
)
VOTES = ("mcp_star", "slack", "hybrid")
COMM_CODES = {
    "COMM_QUEUED": "Wrote harness-inbox. Does not wake the Cursor IDE chat.",
    "COMM_NO_WAKE": "Posted as cursor-engineer. Bus row only. PM must not do this.",
    "COMM_FANOUT_OK": "Webhook POST 2xx.",
    "COMM_FANOUT_FAIL": "Webhook POST failed or timed out.",
    "COMM_BROADCAST": "Appended to broadcast.jsonl for every subscriber.",
    "COMM_STEP1": "commuhications successm step 1 complete.",
}
WATCHDOG_PROMPT = """You are {agent} for Render Studio. Do not ship code. Do not DM specialists.

A live watchdog (wd-mcp-comms-20260916) is counting MCP replies from now until 19:00 CDT on 16 Sep 2026.

conv_id={conv_id}
cycle_id=CYCLE-20260916-WD1
ref_id=INTRO-20260916

STEP 1 (required first): talk on MCP.
POST https://render3d.app/mcp  tools/call  name=agent_hello
arguments: {{"agent":"{agent}","conv_id":"{conv_id}"}}

STEP 2: vote how Grok-bot agents should talk, then post it on the same conv_id.
POST https://render3d.app/mcp  tools/call  name=agent_converse
arguments: {{
  "agent": "{agent}",
  "conv_id": "{conv_id}",
  "vote": "mcp_star",
  "text": "<6-10 sentences: conversation_id vs Slack; how PM fans Getting-Started skills; ACK path>"
}}

vote must be one of: mcp_star | hybrid | slack
mcp_star = keep the JSON-RPC bus (hello + converse + bus_submit), add conv_id/thread_id/msg_id.
hybrid = MCP for packets, a thin thread UI for humans.
slack = leave MCP; use Slack/DMs (this is the fail vote).

Watchdog API (live, no Studio reload): GET https://render3d.app/mcp/watchdog
Headcount: GET https://render3d.app/mcp/watchdog/headcount
Report: GET https://render3d.app/mcp/watchdog/report.md
"""

_LOCK = threading.Lock()

CURSOR_REC = (
    "Keep the MCP star bus. Add conversation_id (`conv-CYCLE-…-topic`), "
    "thread_id (`th-{conv}-{n}`), and msg_id (`msg-{agent}-{ts}`). "
    "Presence is `agent_hello`. Mailbox is `agent_converse`. "
    "Packets stay `agent_bus_submit`. No Slack, no specialist DMs. "
    "PM fans Getting-Started/agents/PROMPT-*.md with one ref_id. "
    "This watchdog is the attendance sheet until 19:00 CDT."
)


def _now() -> datetime:
    return datetime.now(TZ)


def _iso(dt: datetime | None = None) -> str:
    return (dt or _now()).isoformat()


def _redact(text: str) -> str:
    blob = str(text or "")[:4000]
    blob = re.sub(r"(?i)bearer\s+\S+", "Bearer [redacted]", blob)
    blob = re.sub(r"xai-[A-Za-z0-9_-]+", "xai-[redacted]", blob)
    return blob


def _empty_agent() -> dict[str, Any]:
    return {"hello": False, "hello_ts": "", "opinion": False, "vote": "", "excerpt": "", "msg_count": 0}


def _default_state() -> dict[str, Any]:
    return {
        "watchdog_id": WATCHDOG_ID,
        "cycle_id": CYCLE_ID,
        "conv_id": CONV_ID,
        "window_start": _iso(),
        "window_end": WINDOW_END.isoformat(),
        "agents": {name: _empty_agent() for name in REQUIRED},
        "messages": [],
        "tool_calls": 0,
        "votes": {k: 0 for k in VOTES},
        "decision": "pending",
        "cursor_rec": CURSOR_REC,
    }


def _load() -> dict[str, Any]:
    STORE.mkdir(parents=True, exist_ok=True)
    if not STATE.is_file():
        state = _default_state()
        STATE.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")
        return state
    try:
        data = json.loads(STATE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = _default_state()
    agents = data.setdefault("agents", {})
    for name in REQUIRED:
        agents.setdefault(name, _empty_agent())
    data.setdefault("messages", [])
    data.setdefault("votes", {k: 0 for k in VOTES})
    data.setdefault("conv_id", CONV_ID)
    return data


def _save(state: dict[str, Any]) -> None:
    STORE.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, indent=2) + "\n", encoding="utf-8")


def _append_event(row: dict[str, Any]) -> None:
    STORE.mkdir(parents=True, exist_ok=True)
    with EVENTS.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row) + "\n")
        if EVENTS.stat().st_size > 2_000_000:
            EVENTS.replace(EVENTS.with_suffix(".jsonl.1"))


def window_status() -> dict[str, Any]:
    now = _now()
    remaining = max(0, int((WINDOW_END - now).total_seconds()))
    return {
        "open": now <= WINDOW_END,
        "now": _iso(now),
        "end": WINDOW_END.isoformat(),
        "remaining_s": remaining,
        "remaining_label": f"{remaining // 60}m {remaining % 60}s",
    }


def endpoints() -> list[dict[str, str]]:
    return [
        {"group": "watchdog", "method": "GET", "url": "https://render3d.app/mcp/watchdog", "note": "Live snapshot (headcount + votes + agents)"},
        {"group": "watchdog", "method": "GET", "url": "https://render3d.app/mcp/watchdog/headcount", "note": "Real-time reply headcount until 19:00 CDT"},
        {"group": "watchdog", "method": "GET", "url": "https://render3d.app/mcp/watchdog/report.md", "note": "Written comms decision (markdown tab)"},
        {"group": "watchdog", "method": "GET", "url": "https://render3d.app/mcp/watchdog/endpoints", "note": "This catalog"},
        {"group": "watchdog", "method": "GET", "url": "https://render3d.app/mcp/watchdog/events", "note": "Recent MCP comms events"},
        {"group": "watchdog", "method": "GET", "url": "http://127.0.0.1:8744/mcp/watchdog", "note": "Local grok-bot same payload"},
        {"group": "watchdog", "method": "GET", "url": "https://render3d.app/mcp/team-chat", "note": "10-min pulse: Cursor/team deltas, Bender/Rick, employee history"},
        {"group": "watchdog", "method": "GET", "url": "https://render3d.app/mcp/team-chat/history", "note": "Persisted pulse history + Bender/Rick counts"},
        {"group": "watchdog", "method": "GET", "url": "https://render3d.app/mcp/team-chat/pulse", "note": "Alias of /mcp/team-chat for the debugger tab"},
        {"group": "mcp-tool", "method": "tools/call", "url": "agent_hello", "note": "Required first talk. {agent, conv_id}"},
        {"group": "mcp-tool", "method": "tools/call", "url": "agent_converse", "note": "{agent, conv_id, text, vote, to?} — to=cursor-engineer → COMM_QUEUED. agent=cursor-engineer → COMM_NO_WAKE. Prefer rm_queue."},
        {"group": "mcp-tool", "method": "tools/call", "url": "rm_queue", "note": "PM send path. {agent: you, text, tickets?} → harness-inbox. Never agent=cursor-engineer."},
        {"group": "mcp-tool", "method": "tools/call", "url": "comms_webhook_register", "note": "Register POST webhook for every hello/converse/rm_queue. COMM_FANOUT_OK / COMM_FANOUT_FAIL."},
        {"group": "mcp-tool", "method": "tools/call", "url": "comms_broadcast", "note": "Fan text to broadcast.jsonl + webhooks"},
        {"group": "watchdog", "method": "GET", "url": "https://render3d.app/mcp/rm-inbox", "note": "Same as harness-inbox; RM pull path"},
        {"group": "watchdog", "method": "GET", "url": "https://render3d.app/mcp/comms-codes", "note": "COMM_* failure codes"},
        {"group": "watchdog", "method": "GET", "url": "https://render3d.app/mcp/comms-counts", "note": "Bus msg_count most-to-least"},
        {"group": "watchdog", "method": "POST", "url": "https://render3d.app/mcp/webhooks", "note": "Register webhook {url}"},
        {"group": "watchdog", "method": "POST", "url": "https://render3d.app/mcp/comms-hook", "note": "Inbound webhook listener (tracking, not a Cursor wake)"},
        {"group": "mcp-prompt", "method": "prompts/get", "url": "cursor-engineer-wake", "note": "Paste into THIS Cursor IDE chat to wake RM (pull inbox + harness-inbox)"},
        {"group": "watchdog", "method": "GET", "url": "https://render3d.app/mcp/harness-inbox", "note": "Pings addressed TO Cursor/RM (not posts AS cursor-engineer)"},
        {"group": "mcp-tool", "method": "tools/call", "url": "mcp_watchdog_status", "note": "Same snapshot as GET /mcp/watchdog"},
        {"group": "mcp-prompt", "method": "prompts/get", "url": "mcp-watchdog-hello", "note": "Paste to an agent to start talking"},
        {"group": "mcp-rpc", "method": "POST", "url": "https://render3d.app/mcp", "note": "JSON-RPC Streamable HTTP"},
        {"group": "mcp-tool", "method": "tools/call", "url": "pm_prompt_kit", "note": "PM hire-loop starter"},
        {"group": "mcp-tool", "method": "tools/call", "url": "pm_prompt_submit", "note": "PM first prompt → email hire score"},
        {"group": "mcp-tool", "method": "tools/call", "url": "pm_prompt_status", "note": "PM prompt submissions"},
        {"group": "mcp-tool", "method": "tools/call", "url": "agent_bus_submit", "note": "SCORECARD / PM_PACKET inbox"},
        {"group": "mcp-tool", "method": "tools/call", "url": "agent_bus_inbox", "note": "List inbox files"},
        {"group": "mcp-tool", "method": "tools/call", "url": "agent_ops_submit", "note": "rs.ops.v1 traceback ops"},
        {"group": "mcp-tool", "method": "tools/call", "url": "agent_ops_similar", "note": "Similar ops by category_id"},
        {"group": "mcp-tool", "method": "tools/call", "url": "agent_intro_pack", "note": "INTRO-20260916 pack path"},
        {"group": "mcp-tool", "method": "tools/call", "url": "agent_intro_handshake", "note": "Handshake phrase"},
        {"group": "studio", "method": "GET", "url": "/api/ops/mcp-watchdog/headcount", "note": "Studio alias (needs origin reload)"},
        {"group": "studio", "method": "GET", "url": "/api/ops/mcp-watchdog/report", "note": "Studio markdown alias"},
        {"group": "studio", "method": "GET", "url": "/api/ops/mcp-watchdog/endpoints", "note": "Studio catalog alias"},
        {"group": "studio", "method": "POST", "url": "/api/ops/mcp-watchdog/hello", "note": "Harness/admin hello"},
        {"group": "studio", "method": "POST", "url": "/api/ops/mcp-watchdog/converse", "note": "Harness/admin converse"},
        {"group": "studio", "method": "GET", "url": "/api/ops/agent-ops/pm-prompt/kit", "note": "PM starter kit"},
        {"group": "studio", "method": "POST", "url": "/api/ops/agent-ops/pm-prompt", "note": "PM submit"},
        {"group": "studio", "method": "GET", "url": "/api/ops/agent-ops/pm-prompt", "note": "PM status"},
        {"group": "studio", "method": "GET/POST", "url": "/api/ops/agent-ops/weekly-reports", "note": "Weekly bus report"},
        {"group": "studio", "method": "GET/POST", "url": "/api/ops/agent-ops/tracebacks", "note": "Ops traceback store"},
        {"group": "studio", "method": "GET", "url": "/api/ops/agent-ops/similar", "note": "Similar ops"},
        {"group": "studio", "method": "GET", "url": "/api/ops/team-status", "note": "Studio alias of the team pulse (harness/admin)"},
        {"group": "studio", "method": "GET", "url": "/api/ops/team-status/history", "note": "Studio pulse history"},
        {"group": "studio", "method": "GET", "url": "/api/ops/debugger-analytics/overview", "note": "Debugger viewer (this catalog is also a tab)"},
        {"group": "studio", "method": "GET/POST", "url": "/api/ops/debugger-analytics/watchdogs", "note": "Draft watchdogs Sam approves"},
        {"group": "studio", "method": "GET", "url": "/api/ops/agent-intro/pack", "note": "Intro pack"},
        {"group": "studio", "method": "POST", "url": "/api/ops/agent-intro/handshake", "note": "Handshake"},
        {"group": "local", "method": "GET", "url": "http://127.0.0.1:8001/mcp/watchdog", "note": "Studio proxy → :8744"},
    ]


def watchdog_prompt(agent: str = "project-manager") -> str:
    name = str(agent or "project-manager").strip().lower() or "project-manager"
    return WATCHDOG_PROMPT.format(agent=name, conv_id=CONV_ID)


def harness_message_text() -> str:
    """MCP prompt body: the new harness message and nothing else."""
    msg = latest_harness_message() or {}
    text = str(msg.get("text") or "").strip()
    if not text:
        return "No new message.\n"
    lines = []
    who = str(msg.get("from") or "").strip()
    if who:
        lines.append(who)
    tickets = [str(t) for t in (msg.get("tickets") or []) if str(t).strip()][:8]
    if tickets:
        lines.append("tickets: " + ", ".join(tickets))
    lines.append(text)
    return "\n".join(lines) + "\n"


def harness_wake_text() -> str:
    return harness_message_text()


def mcp_prompts_list() -> list[dict[str, Any]]:
    return [
        {
            "name": "mcp-watchdog-hello",
            "description": "Require an agent to hello on MCP, then vote how Grok-bot agents should talk.",
            "arguments": [{"name": "agent", "description": "project-manager | vibe-marketing | …", "required": False}],
        },
        {
            "name": "harness-message",
            "description": "The harness job. Body is only the newest message.",
            "arguments": [],
        },
        {
            "name": "cursor-engineer-wake",
            "description": "Same body as harness-message. Paste into this Cursor chat.",
            "arguments": [],
        },
    ]


def mcp_prompts_get(name: str, arguments: dict[str, Any] | None = None) -> dict[str, Any]:
    key = str(name or "").strip()
    args = arguments or {}
    if key == "mcp-watchdog-hello":
        return {
            "description": "Watchdog hello + comms vote",
            "messages": [{"role": "user", "content": {"type": "text", "text": watchdog_prompt(str(args.get("agent") or "project-manager"))}}],
        }
    if key in {"harness-message", "cursor-engineer-wake"}:
        return {
            "description": "Newest harness message",
            "messages": [{"role": "user", "content": {"type": "text", "text": harness_message_text()}}],
        }
    raise ValueError("unknown prompt: " + key)


LATEST_HARNESS = "latest.json"


def _drop_old_harness_files() -> None:
    if not HARNESS_INBOX.is_dir():
        return
    for path in HARNESS_INBOX.glob("*.json"):
        if path.name == LATEST_HARNESS:
            continue
        try:
            path.unlink()
        except OSError:
            pass


def notify_harness(row: dict[str, Any]) -> Path:
    """Replace the one harness message. Does not keep prior pings."""
    HARNESS_INBOX.mkdir(parents=True, exist_ok=True)
    blob = dict(row)
    blob.setdefault("ts", _iso())
    blob.setdefault("to", "cursor-engineer")
    path = HARNESS_INBOX / LATEST_HARNESS
    path.write_text(json.dumps(blob, indent=2) + "\n", encoding="utf-8")
    _drop_old_harness_files()
    return path


def latest_harness_message() -> dict[str, Any] | None:
    path = HARNESS_INBOX / LATEST_HARNESS
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            data = None
        if isinstance(data, dict):
            _drop_old_harness_files()
            return data
    if not HARNESS_INBOX.is_dir():
        return None
    files = [p for p in HARNESS_INBOX.glob("*.json") if p.is_file()]
    if not files:
        return None
    newest = max(files, key=lambda p: p.stat().st_mtime)
    try:
        data = json.loads(newest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    notify_harness(data)
    return data


def list_harness_inbox(limit: int = 20) -> dict[str, Any]:
    del limit
    msg = latest_harness_message()
    if not msg:
        return {"ok": True, "files": [], "message": None, "read": "message-only", "dir": str(HARNESS_INBOX)}
    return {
        "ok": True,
        "files": [LATEST_HARNESS],
        "message": {
            "from": msg.get("from") or msg.get("agent") or "",
            "text": str(msg.get("text") or ""),
            "tickets": msg.get("tickets") or [],
            "msg_id": msg.get("msg_id") or "",
        },
        "read": "message-only",
        "dir": str(HARNESS_INBOX),
    }


def message_counts() -> dict[str, Any]:
    state = _load()
    rows = []
    for name, rec in (state.get("agents") or {}).items():
        rows.append({"agent": name, "msg_count": int(rec.get("msg_count") or 0)})
    rows.sort(key=lambda r: (-r["msg_count"], r["agent"]))
    inbox = list_harness_inbox(50)
    return {
        "ok": True,
        "bus_most_to_least": rows,
        "harness_inbox_files": inbox.get("files") or [],
        "note": "cursor-engineer bus rows include impersonation (COMM_NO_WAKE). Those did not arrive in the live IDE.",
    }


def _webhook_urls() -> list[str]:
    if not WEBHOOKS.is_file():
        return []
    try:
        data = json.loads(WEBHOOKS.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    urls = data.get("urls") if isinstance(data, dict) else []
    return [str(u).strip() for u in (urls or []) if str(u).strip()][:12]


def register_webhook(url: str) -> dict[str, Any]:
    dest = str(url or "").strip()
    if not dest.startswith("http://") and not dest.startswith("https://"):
        raise ValueError("url must be http(s)")
    STORE.mkdir(parents=True, exist_ok=True)
    urls = _webhook_urls()
    if dest not in urls:
        urls.append(dest)
    WEBHOOKS.write_text(json.dumps({"urls": urls}, indent=2) + "\n", encoding="utf-8")
    return {"ok": True, "urls": urls, "code": "COMM_BROADCAST"}


def fanout_event(event: dict[str, Any]) -> dict[str, Any]:
    STORE.mkdir(parents=True, exist_ok=True)
    row = dict(event)
    row.setdefault("ts", _iso())
    with BROADCAST.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row) + "\n")
    delivered = 0
    failed: list[str] = []
    import urllib.request

    payload = json.dumps(row).encode("utf-8")
    for url in _webhook_urls():
        try:
            req = urllib.request.Request(url, data=payload, method="POST", headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=3) as resp:
                if 200 <= int(getattr(resp, "status", 200) or 200) < 300:
                    delivered += 1
                else:
                    failed.append(url)
        except Exception:
            failed.append(url[:120])
    code = "COMM_FANOUT_OK" if not failed else ("COMM_FANOUT_FAIL" if delivered == 0 else "COMM_FANOUT_OK")
    if not _webhook_urls():
        code = "COMM_BROADCAST"
    return {"ok": not failed or delivered > 0, "code": code, "delivered": delivered, "failed": failed, "broadcast": str(BROADCAST)}


def rm_queue(args: dict[str, Any]) -> dict[str, Any]:
    """Queue work INTO the harness. Never posts as cursor-engineer."""
    agent = str(args.get("agent") or args.get("from") or "").strip().lower()
    if not agent or agent == "cursor-engineer":
        raise ValueError("rm_queue as yourself, not as cursor-engineer")
    text = _redact(str(args.get("text") or "")).strip()
    if not text:
        raise ValueError("text is required")
    rec = {
        "msg_id": "rmq-" + str(int(_now().timestamp())),
        "from": agent,
        "to": "cursor-engineer",
        "kind": "rm-queue",
        "text": text[:1500],
        "tickets": args.get("tickets") or [],
        "ts": _iso(),
        "code": "COMM_QUEUED",
        "wake": False,
    }
    path = notify_harness(rec)
    fan = fanout_event({"kind": "rm_queue", "from": agent, "text": text[:400], "msg_id": rec["msg_id"]})
    return {
        "ok": True,
        "code": "COMM_QUEUED",
        "failure_code": None,
        "wake": False,
        "harness_inbox": str(path),
        "send_path": "MCP tools/call rm_queue {agent: <you>, text, tickets?}",
        "fanout": fan,
        "hint": "Queued for the live Cursor IDE. It still does not inject into the chat until Sam/RM opens this inbox.",
    }


def comms_codes() -> dict[str, Any]:
    return {"ok": True, "codes": COMM_CODES, "send_path": "rm_queue", "never": "agent_converse agent=cursor-engineer"}


def _tally(state: dict[str, Any]) -> dict[str, Any]:
    agents = state.get("agents") or {}
    hello_n = sum(1 for n in REQUIRED if agents.get(n, {}).get("hello"))
    opinion_n = sum(1 for n in REQUIRED if agents.get(n, {}).get("opinion"))
    missing_hello = [n for n in REQUIRED if not agents.get(n, {}).get("hello")]
    missing_opinion = [n for n in REQUIRED if not agents.get(n, {}).get("opinion")]
    votes = {k: 0 for k in VOTES}
    for name in REQUIRED:
        vote = str(agents.get(name, {}).get("vote") or "")
        if vote in votes:
            votes[vote] += 1
    winner = max(votes, key=votes.get) if any(votes.values()) else "pending"
    if not any(votes.values()):
        winner = "pending"
    elif list(votes.values()).count(max(votes.values())) > 1:
        winner = "tie"
    return {
        "required": len(REQUIRED),
        "hello": hello_n,
        "opinions": opinion_n,
        "missing_hello": missing_hello,
        "missing_opinion": missing_opinion,
        "votes": votes,
        "decision": winner,
        "all_hello": hello_n == len(REQUIRED),
        "all_opinions": opinion_n == len(REQUIRED),
    }


def _write_report(state: dict[str, Any]) -> str:
    tally = _tally(state)
    win = tally["decision"]
    lines = [
        f"# MCP comms report — {WATCHDOG_ID}",
        "",
        f"- conv_id: `{CONV_ID}`",
        f"- cycle_id: `{CYCLE_ID}`",
        f"- window: {state.get('window_start')} → {state.get('window_end')} (America/Chicago)",
        f"- headcount: **{tally['hello']}/{tally['required']}** hello, **{tally['opinions']}/{tally['required']}** opinions",
        f"- decision: **{win}**",
        "",
        "## Cursor recommendation",
        "",
        CURSOR_REC,
        "",
        "## Votes",
        "",
    ]
    for key, n in tally["votes"].items():
        lines.append(f"- `{key}`: {n}")
    lines += ["", "## What this means", ""]
    if win == "mcp_star":
        lines.append("Keep MCP. Use conv_id / thread_id / msg_id. No Slack. PM fans PROMPT-*.md with one ref_id.")
    elif win == "hybrid":
        lines.append("MCP for packets + a thin human thread UI. Still no specialist DMs.")
    elif win == "slack":
        lines.append("Agents voted to leave MCP. Cursor still recommends mcp_star; treat slack as a miss.")
    elif win == "tie":
        lines.append("Tie. Default to Cursor recommendation: mcp_star until PM breaks the tie.")
    else:
        lines.append("No opinions yet. Default: mcp_star (conversation ids on the existing bus).")
    lines += ["", "## Per agent", ""]
    for name in REQUIRED:
        row = (state.get("agents") or {}).get(name) or _empty_agent()
        mark = "hello" if row.get("hello") else "silent"
        if row.get("opinion"):
            mark += f" · vote={row.get('vote') or '?'}"
        excerpt = str(row.get("excerpt") or "").replace("\n", " ")[:280]
        lines.append(f"- **{name}**: {mark}")
        if excerpt:
            lines.append(f"  - {excerpt}")
    lines += ["", "## Missing", ""]
    if tally["missing_hello"]:
        lines.append("Hello still owed: " + ", ".join(tally["missing_hello"]))
    if tally["missing_opinion"]:
        lines.append("Opinion still owed: " + ", ".join(tally["missing_opinion"]))
    if tally["all_opinions"]:
        lines.append("All required agents posted an opinion.")
    lines += ["", "## Endpoints", ""]
    for item in endpoints():
        lines.append(f"- `{item['method']}` `{item['url']}` — {item['note']}")
    text = "\n".join(lines) + "\n"
    REPORT_MD.parent.mkdir(parents=True, exist_ok=True)
    REPORT_MD.write_text(text, encoding="utf-8")
    return text


def snapshot() -> dict[str, Any]:
    with _LOCK:
        state = _load()
        tally = _tally(state)
        report = _write_report(state)
        win = window_status()
        roster = []
        for name in REQUIRED:
            row = dict(state["agents"][name])
            row["agent"] = name
            roster.append(row)
        return {
            "ok": True,
            "watchdog_id": WATCHDOG_ID,
            "conv_id": CONV_ID,
            "cycle_id": CYCLE_ID,
            "window": win,
            "headcount": {
                "hello": tally["hello"],
                "opinions": tally["opinions"],
                "required": tally["required"],
                "label": f"{tally['hello']}/{tally['required']} talking · {tally['opinions']}/{tally['required']} opinions",
            },
            "missing_hello": tally["missing_hello"],
            "missing_opinion": tally["missing_opinion"],
            "votes": tally["votes"],
            "decision": tally["decision"],
            "cursor_rec": CURSOR_REC,
            "agents": roster,
            "messages": list(state.get("messages") or [])[-40:],
            "tool_calls": int(state.get("tool_calls") or 0),
            "report_md": report,
            "report_path": str(REPORT_MD),
            "endpoints": endpoints(),
            "api": "https://render3d.app/mcp/watchdog",
        }


def headcount() -> dict[str, Any]:
    snap = snapshot()
    return {
        "ok": True,
        "api": snap["api"],
        "watchdog_id": WATCHDOG_ID,
        "conv_id": CONV_ID,
        "window": snap["window"],
        "headcount": snap["headcount"],
        "missing_hello": snap["missing_hello"],
        "missing_opinion": snap["missing_opinion"],
        "votes": snap["votes"],
        "decision": snap["decision"],
        "agents": snap["agents"],
    }


def report_md() -> str:
    with _LOCK:
        return _write_report(_load())


def note_tool(name: str, args: dict[str, Any] | None = None) -> None:
    agent = str((args or {}).get("agent") or "").strip().lower()
    with _LOCK:
        state = _load()
        state["tool_calls"] = int(state.get("tool_calls") or 0) + 1
        _save(state)
        _append_event({"ts": _iso(), "kind": "tool", "name": str(name or "")[:80], "agent": agent[:40]})


def hello(args: dict[str, Any]) -> dict[str, Any]:
    agent = str(args.get("agent") or "").strip().lower()
    if agent not in REQUIRED:
        raise ValueError("agent must be one of: " + ", ".join(REQUIRED))
    conv = str(args.get("conv_id") or CONV_ID).strip() or CONV_ID
    with _LOCK:
        state = _load()
        row = state["agents"][agent]
        row["hello"] = True
        row["hello_ts"] = row["hello_ts"] or _iso()
        row["msg_count"] = int(row.get("msg_count") or 0) + 1
        state["tool_calls"] = int(state.get("tool_calls") or 0) + 1
        _save(state)
        _append_event({"ts": _iso(), "kind": "hello", "agent": agent, "conv_id": conv})
        _write_report(state)
    fan = fanout_event({"kind": "hello", "agent": agent, "conv_id": conv})
    return {"ok": True, "agent": agent, "conv_id": conv, "hello": True, "watchdog_id": WATCHDOG_ID, "fanout": fan, **headcount()}


def converse(args: dict[str, Any]) -> dict[str, Any]:
    agent = str(args.get("agent") or "").strip().lower()
    if agent not in REQUIRED:
        raise ValueError("agent must be one of: " + ", ".join(REQUIRED))
    text = _redact(str(args.get("text") or args.get("prompt") or "")).strip()
    if not text:
        raise ValueError("text is required")
    vote = str(args.get("vote") or "mcp_star").strip().lower()
    if vote not in VOTES:
        raise ValueError("vote must be mcp_star | hybrid | slack")
    conv = str(args.get("conv_id") or CONV_ID).strip() or CONV_ID
    with _LOCK:
        state = _load()
        row = state["agents"][agent]
        if not row.get("hello"):
            row["hello"] = True
            row["hello_ts"] = _iso()
        row["opinion"] = True
        row["vote"] = vote
        row["excerpt"] = text[:400]
        row["msg_count"] = int(row.get("msg_count") or 0) + 1
        msg_id = f"msg-{agent}-{int(_now().timestamp())}"
        thread_id = f"th-{conv}-1"
        rec = {
            "msg_id": msg_id,
            "thread_id": thread_id,
            "conv_id": conv,
            "agent": agent,
            "vote": vote,
            "text": text[:1500],
            "ts": _iso(),
        }
        state.setdefault("messages", []).append(rec)
        state["messages"] = state["messages"][-80:]
        state["tool_calls"] = int(state.get("tool_calls") or 0) + 1
        dest = str(args.get("to") or "").strip().lower()
        harness_path = ""
        if dest in CURSOR_TO:
            harness_path = str(
                notify_harness(
                    {
                        **rec,
                        "from": agent,
                        "to": dest,
                        "kind": "harness-ping",
                    }
                )
            )
        _save(state)
        _append_event({"ts": rec["ts"], "kind": "converse", "agent": agent, "vote": vote, "msg_id": msg_id, "to": dest})
        _write_report(state)
    fan = fanout_event({"kind": "converse", "agent": agent, "to": dest, "msg_id": msg_id, "text": text[:400]})
    out = {
        "ok": True,
        "msg_id": msg_id,
        "thread_id": thread_id,
        "conv_id": conv,
        "agent": agent,
        "vote": vote,
        "wake": False,
        **headcount(),
    }
    if agent == "cursor-engineer":
        out["code"] = "COMM_NO_WAKE"
        out["failure_code"] = "COMM_NO_WAKE"
        out["hint"] = "This did not wake a live Cursor session. Use rm_queue as yourself."
    elif harness_path:
        out["code"] = "COMM_QUEUED"
        out["harness_inbox"] = harness_path
        out["to"] = dest
    else:
        out["code"] = "COMM_BROADCAST"
    out["fanout"] = fan
    return out


def events(limit: int = 40) -> dict[str, Any]:
    n = max(1, min(int(limit or 40), 80))
    rows: list[dict[str, Any]] = []
    if EVENTS.is_file():
        for line in EVENTS.read_text(encoding="utf-8").splitlines()[-n:]:
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return {"ok": True, "events": rows, "watchdog_id": WATCHDOG_ID}


def email_body() -> str:
    snap = snapshot()
    hc = snap["headcount"]
    win = snap["window"]
    lines = [
        "Render Studio — MCP communication watchdog",
        "==========================================",
        "",
        f"Watchdog: {WATCHDOG_ID}",
        f"API (live now): {snap['api']}",
        f"Headcount:      {snap['api']}/headcount",
        f"Report (md):    {snap['api']}/report.md",
        f"Endpoints:      {snap['api']}/endpoints",
        f"Window:         now → 19:00 CDT 16 Sep 2026 ({win.get('remaining_label')} left)",
        f"conv_id:        {CONV_ID}",
        "",
        "What I would do for communication",
        "---------------------------------",
        CURSOR_REC,
        "",
        "IDs",
        "---",
        "  conv_id    conv-{cycle}-{topic}     e.g. " + CONV_ID,
        "  thread_id  th-{conv_id}-{n}         one thread per topic",
        "  msg_id     msg-{agent}-{unix}",
        "",
        "Flow: agent_hello → agent_converse (vote) → agent_bus_submit (packets).",
        "Do not add Slack. Do not specialist-DM. PM fans Getting-Started/agents/PROMPT-*.md.",
        "",
        f"Live headcount: {hc.get('label')}",
        f"Decision so far: {snap.get('decision')}",
        "",
        "Every endpoint (also on the Debugger → MCP watchdog → Endpoints tab)",
        "-------------------------------------------------------------------",
    ]
    current = ""
    for item in snap["endpoints"]:
        if item["group"] != current:
            current = item["group"]
            lines.append("")
            lines.append(f"[{current}]")
        lines.append(f"  {item['method']:12} {item['url']}")
        lines.append(f"               {item['note']}")
    lines += [
        "",
        "Dashboard: Management → System debugger → MCP watchdog",
        "  tabs: Headcount (polls every 5s until 7pm) · Report · Endpoints",
        "",
        "Improved prompt to give each agent is MCP prompt mcp-watchdog-hello",
        "or Getting-Started/agents/PROMPT-mcp-watchdog.md",
        "",
        "— Cursor",
    ]
    return "\n".join(lines)


def send_email() -> dict[str, Any]:
    body = email_body()
    subject = f"MCP watchdog {WATCHDOG_ID} — live API + comms plan + endpoints"
    outbox = STORE / "email-outbox.jsonl"
    STORE.mkdir(parents=True, exist_ok=True)
    with outbox.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps({"ts": _iso(), "to": SAM_EMAIL, "subject": subject, "body": body[:12000]}) + "\n")
    try:
        from backend.services.workspace_automation_service import _send_mail

        mail = _send_mail(to=[SAM_EMAIL], subject=subject[:140], text=body[:12000])
    except Exception as exc:
        mail = {"ok": False, "error": str(exc)[:240]}
    return {"ok": bool(mail.get("ok")), "email": mail, "to": SAM_EMAIL, "subject": subject}


def http_get(path: str) -> tuple[int, bytes, str]:
    cleaned = path.split("?", 1)[0].rstrip("/") or "/"
    if cleaned in {"/mcp/watchdog", "/watchdog"}:
        raw = json.dumps(snapshot(), indent=2).encode("utf-8")
        return 200, raw, "application/json"
    if cleaned in {"/mcp/watchdog/headcount", "/watchdog/headcount"}:
        raw = json.dumps(headcount(), indent=2).encode("utf-8")
        return 200, raw, "application/json"
    if cleaned in {"/mcp/watchdog/endpoints", "/watchdog/endpoints"}:
        raw = json.dumps({"ok": True, "endpoints": endpoints(), "api": "https://render3d.app/mcp/watchdog"}, indent=2).encode("utf-8")
        return 200, raw, "application/json"
    if cleaned in {"/mcp/watchdog/events", "/watchdog/events"}:
        raw = json.dumps(events(), indent=2).encode("utf-8")
        return 200, raw, "application/json"
    if cleaned in {"/mcp/harness-inbox", "/harness-inbox", "/mcp/rm-inbox", "/rm-inbox"}:
        raw = json.dumps(list_harness_inbox(), indent=2).encode("utf-8")
        return 200, raw, "application/json"
    if cleaned in {"/mcp/comms-codes", "/comms-codes"}:
        raw = json.dumps(comms_codes(), indent=2).encode("utf-8")
        return 200, raw, "application/json"
    if cleaned in {"/mcp/comms-counts", "/comms-counts"}:
        raw = json.dumps(message_counts(), indent=2).encode("utf-8")
        return 200, raw, "application/json"
    if cleaned in {"/mcp/watchdog/report.md", "/mcp/watchdog/report", "/watchdog/report.md"}:
        return 200, report_md().encode("utf-8"), "text/markdown; charset=utf-8"
    return 404, b'{"ok":false}', "application/json"


def http_post(path: str, body: dict[str, Any] | None) -> tuple[int, bytes, str]:
    cleaned = path.split("?", 1)[0].rstrip("/") or "/"
    data = body or {}
    if cleaned in {"/mcp/webhooks", "/webhooks"}:
        raw = json.dumps(register_webhook(str(data.get("url") or "")), indent=2).encode("utf-8")
        return 200, raw, "application/json"
    if cleaned in {"/mcp/broadcast", "/broadcast"}:
        raw = json.dumps(fanout_event({"kind": "broadcast", "text": str(data.get("text") or "")[:400]}), indent=2).encode("utf-8")
        return 200, raw, "application/json"
    if cleaned in {"/mcp/rm-queue", "/rm-queue"}:
        raw = json.dumps(rm_queue(data), indent=2).encode("utf-8")
        return 200, raw, "application/json"
    if cleaned in {"/mcp/comms-hook", "/comms-hook"}:
        raw = json.dumps(ingest_webhook(data), indent=2).encode("utf-8")
        return 200, raw, "application/json"
    return 404, b'{"ok":false}', "application/json"


def ingest_webhook(body: dict[str, Any]) -> dict[str, Any]:
    row = {"kind": "inbound-webhook", "body": dict(body or {}), "ts": _iso()}
    _append_event(row)
    fan = fanout_event({"kind": "inbound-webhook", "text": json.dumps(body or {})[:400]})
    return {"ok": True, "code": fan.get("code") or "COMM_BROADCAST", "fanout": fan}


def relay_tick() -> dict[str, Any]:
    inbox = list_harness_inbox(30)
    n = len(inbox.get("files") or [])
    _append_event({"ts": _iso(), "kind": "relay-tick", "code": "COMM_QUEUED", "inbox_n": n})
    return {"ok": True, "code": "COMM_QUEUED", "inbox_n": n, "wake": False}


_relay_started = False


def start_relay_tick(interval_s: int = 45) -> threading.Thread | None:
    global _relay_started
    if _relay_started:
        return None
    _relay_started = True
    delay = max(15, int(interval_s or 45))

    def loop() -> None:
        while True:
            try:
                relay_tick()
            except Exception:
                pass
            time.sleep(delay)

    thread = threading.Thread(target=loop, name="comms-relay-tick", daemon=True)
    thread.start()
    return thread
