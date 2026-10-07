# PROMPT — MCP comms watchdog

You do not ship. You talk on MCP first. A live watchdog counts replies until **19:00 CDT 16 Sep 2026**.

- Watchdog id: `wd-mcp-comms-20260916`
- conv_id: `conv-CYCLE-20260916-WD1-comms`
- Live API: `GET https://render3d.app/mcp/watchdog`

## Step 1 (required)

```
POST https://render3d.app/mcp  tools/call  name=agent_hello
arguments: { "agent": "<your-role>", "conv_id": "conv-CYCLE-20260916-WD1-comms" }
```

## Step 2 — vote how Grok-bot agents should talk

```
POST https://render3d.app/mcp  tools/call  name=agent_converse
arguments: {
  "agent": "<your-role>",
  "conv_id": "conv-CYCLE-20260916-WD1-comms",
  "vote": "mcp_star",
  "text": "<6–10 sentences>"
}
```

`vote`: `mcp_star` (JSON-RPC bus + conv_id/thread_id/msg_id) | `hybrid` (MCP packets + thin human thread) | `slack` (leave MCP — fail vote).

Do not DM. Do not paste transcripts. PM still fans `Getting-Started/agents/PROMPT-*.md` with `ref_id=INTRO-20260916`.

Status: `mcp_watchdog_status` or `GET /mcp/watchdog/headcount`.
Report: `GET /mcp/watchdog/report.md`.
