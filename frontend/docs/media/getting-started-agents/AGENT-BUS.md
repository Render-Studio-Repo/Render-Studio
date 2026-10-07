# Agent bus

Public MCP: `https://render3d.app/mcp`  
Inbox files: `ai-context/agent-bus/inbox/`  
Harness inbox (TO Cursor/RM): `ai-context/agent-bus/harness-inbox/`  
Ops API: `POST /api/ops/agent-ops/tracebacks`

## Reach Cursor / Regional Manager

Do **not** `agent_converse` with `agent=cursor-engineer` unless you are the Cursor IDE harness. That posts **as** RM and does not wake this chat.

Correct: speak as yourself and set `to=cursor-engineer` (writes harness-inbox). Also `agent_bus_submit` a `PM_PACKET` (`tickets[]` + `engineer_asks`). Wake: paste `Getting-Started/agents/PROMPT-cursor-engineer.md` or MCP prompt `cursor-engineer-wake` **into the Cursor IDE session**. List: `agent_bus_inbox` or `GET /mcp/harness-inbox`.

## Commands (every specialist)

1. Answer the battery / vision question as JSON only.
2. **Submit packet:** `agent_bus_submit` `{agent, cycle_id, schema, packet}`.
3. **Submit ops stats (required when you used a technique):** `agent_ops_submit` with `rs.ops.v1` (below).
4. Never paste a transcript to Cursor.

### `rs.ops.v1` (fits the API)

```json
{
  "schema": "rs.ops.v1",
  "prompt_id": "prm_sample1",
  "category_id": "DATA",
  "cycle_id": "CYCLE-20260916-1618",
  "agent": "analytics",
  "ops": ["read_bus", "score_vision", "submit_inbox"],
  "traceback_ids": ["tb_read", "tb_score", "tb_submit"],
  "result_score": 72,
  "result_ref_id": "",
  "damage_score": 0.1,
  "instance_id": "local",
  "instance_public_factor": 0,
  "log_id": "",
  "project_id": ""
}
```

`instance_public_factor` is **0** on this host until other developers have public instances.

### MCP

```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"agent_ops_submit","arguments":{}}}
```

Fill `arguments` with the object above. List: `agent_ops_similar` `{category_id}` or `GET /api/ops/agent-ops/similar?category_id=DATA`.

## Same battery (PM fans this verbatim)

Q1–Q10 as in `PROMPT-project-manager.md`. Plus: attach `rs.ops.v1` for the steps you used to answer.

## PM first-prompt loop

Starter (Sam pastes this): MCP prompt `pm-first-loop` or tool `pm_prompt_kit`.
PM submits his project prompt: `pm_prompt_submit`. First submit emails `sam@render3d.app` with the prompt, score, and hire yes/no. First Cursor reply is the outline + team-comms question. Status: `pm_prompt_status`.

## MCP comms watchdog (now → 19:00 CDT)

Hello first: `agent_hello`. Then vote on `agent_converse` (`mcp_star` | `hybrid` | `slack`) with `conv_id=conv-CYCLE-20260916-WD1-comms`.
Live: `GET https://render3d.app/mcp/watchdog` · report `GET /mcp/watchdog/report.md`.
Prompt: `Getting-Started/agents/PROMPT-mcp-watchdog.md` / MCP prompt `mcp-watchdog-hello`.
10-min debugger pulse: `GET /mcp/team-chat` (Cursor/team deltas, per-agent scores, Bender=lowest / Rick=highest, running counts). History: `GET /mcp/team-chat/history`. Management → Debugger.
