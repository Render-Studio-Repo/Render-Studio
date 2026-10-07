---
name: api-tracking-explain
summary: Explain API tracking, last3 log_ids, privileges, cost reports, sandbox MCP. Read-only. Never write production Studio code.
---

# API + log tracking (harness explain)

Token: `harness1`. **Explain only.** Do not patch `frontend/studio/app.js`, `backend/main.py`, kernel, auth, or billing. Do not auto-apply to production Studio. Sandbox writes for Sam corrections are a different action (`grok_sandbox action=correct`).

Canonical doc: `Getting-Started/agents/API-TRACKING-EXPLAINED.md`

## How to ask

Voice / round table / team chat / `grok_debugger`:

- How do `log_id`s chain (`last3`)? Example prefix `d9c98119-*`
- Privileges, ask-safe, Approve
- Cost reports (`cost_*`, tokens/time, votes, `speak`)
- Project ids + tenant suffix `{project}.{instance8}`
- `/mcp/sandbox`, `/mcp/team-chat/feed`, control-config, voice, pitch, tasks

MCP:

```
grok_debugger({ "action": "explain_tracking", "q": "<topic>" })
grok_sandbox({ "action": "explain", "q": "<topic>" })
GET /mcp/sandbox/explain
```

Aliases: `explain_api` `explain_logs`.

## last3

`log_id` = `{chat8}-{n}` e.g. `d9c98119-004`. Footer:

```
last3: d9c98119-003 | d9c98119-004 | d9c98119-005
```

Broke? Set `blamed_log_id` to the prior prompt (usually last of `last3`). Team-chat posts are `msg_gc_*`. jsonl dump has no `log_id`.

## Privileges

Ask → queue (`ask-safe`) → Sam/harness **Approve** (`PUT /privileges/{method}`). 3 high-score low-damage uses may queue ask-safe. 3 bad outcomes → temporary ban. Forks / snapshot reset / GitHub issues never auto-run.

## Cost reports

`cost_*` after close/cede/confirm-fixed: tokens, time, damage vs outcome, YES/HOLD/NO, `speak`. No fake dollars.

## Sandbox vs production

Agents may write `frontend/sandbox/` only. Hot-refresh `GET /mcp/sandbox/rev`. VR simulate/listen ≠ wire-to-scene (Approve). Training: clip-bot CAD (`cede_example` apply=false), marketing pitch, RnD benches, analytics costs.

Sam: “That’s wrong, change X” → `grok_sandbox action=correct` → sandbox file + rev poll. Production waits for Approve.
