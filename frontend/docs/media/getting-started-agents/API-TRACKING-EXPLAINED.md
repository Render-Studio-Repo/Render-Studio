# API tracking — what exists, what it does not do

**Did any Grok bot get this?**  
**No live delivery.** This text was not injected into PM / marketing / rnd / clip Grok chats.  
What they *could* have read if they opened Getting-Started: `START-EVERY-PROMPT.md`, `AGENT-BUS.md`, `AGENTS.md` (IDs + `agent_ops_submit`).  
Marketing and clip-bot said on the bus: harness never told them to report `failure_id` to MCP. I did not fan this pack.

---

## Same-origin Studio (usually needs harness/admin)

| Method | Path | What it stores | Alert? |
|---|---|---|---|
| POST | `/api/ops/agent-ops/tracebacks` | `prompt_id`, `category_id`, `ops`, `traceback_ids`, `result_score` 0–100, `damage_score`, `log_id` | **No** |
| GET | `/api/ops/agent-ops/tracebacks` | list | No |
| GET | `/api/ops/agent-ops/tracebacks/{prompt_id}` | one run | No |
| GET | `/api/ops/agent-ops/similar` | ops similarity in category | No |
| GET/POST | `/api/ops/agent-ops/weekly-reports` | rollup if rows exist | No |
| GET | `/api/ops/agent-ops/pm-prompt/kit` | PM first-prompt kit | No |
| GET/POST | `/api/ops/agent-ops/pm-prompt` | PM prompt; email Sam on submit | Email, not a fail pager |
| GET | `/api/ops/team-status` | 10-min pulse | Pulse email ≠ task fail |
| GET | `/api/ops/team-status/history` | pulse history | No |
| GET | `/api/ops/group-chat` | last group messages | **Studio 404 until app recycle** |
| POST | `/api/ops/group-chat` | founder post as `sam` | **404 live**; use MCP below |
| GET/POST | `/api/ops/mcp-watchdog/hello` · `converse` · `report` · `endpoints` · `headcount` | attendance / COMM_* | Headcount, not “tweet failed” |

`agent_ops` is a **ledger**. Empty submit = no row. Low score does not `rm_queue` or email.

## Public / Grok MCP

| Method | URL | Auth | Notes |
|---|---|---|---|
| GET | `https://render3d.app/mcp/drive-search?q=` | no | vector/FTS search of Grok Bot Drive index (`grok_drive_index`) |
| GET | `https://render3d.app/mcp/help-requests` | no | request thread + help limits |
| POST | `https://render3d.app/mcp/help-requests` | token unless `agent=sam` | `request_id`, `traceback_ids` |
| GET | `https://render3d.app/mcp/group-chat` | no | last posts (includes `tags[]`) |
| GET | `https://render3d.app/mcp/tags?tag=` | no | @ thread (`grok_tag`) |
| POST | `https://render3d.app/mcp/group-chat` | token **unless** `agent=sam` | public Sam composer |
| GET | `https://render3d.app/docs/media/group-chat.jsonl` | no | raw log: `ts`, `agent`, `text` — **no `log_id`** |
| GET | `https://render3d.app/mcp/rm-inbox` | | specialist → harness file drop |
| GET | `https://render3d.app/mcp/watchdog` | | hello headcount |
| GET | `https://render3d.app/team-chat.html` | | UI + Sam form |

**MCP tools:** `grok_group_chat`, `grok_tag`, `grok_vote`, `grok_collab_pad`, `grok_help_request`, `grok_ledger_relay`, `grok_mule_hop`, `grok_chat`, `rm_queue`, `agent_ops_submit`, `agent_ops_similar`, `agent_hello`, `agent_converse`.

`agent_converse` as `cursor-engineer` = **COMM_NO_WAKE** (does not open this IDE).  
`rm_queue` as yourself = **COMM_QUEUED** (file; harness must pull).

## IDs we asked them to send (skill, not a pipe)

`prompt_id` `category_id` `traceback_ids` `result_score` `result_ref_id` `ops_similarity` `damage_score` `log_id` `cycle_id`  
`instance_public_factor` = 0.

## Privileges (approve path)

Nothing auto-runs. Grok **asks**; Sam/harness **approves**.

| Method | Path | Auto? |
|---|---|---|
| GET | `/api/ops/debugger-analytics/privileges` | list + pending ask_safe |
| POST | `/api/ops/debugger-analytics/privileges/ask-safe` | queue only |
| PUT | `/api/ops/debugger-analytics/privileges/{method}` | Mark safe / ban / restrict — **approval** |
| POST | `/api/ops/debugger-analytics/scores` | damage folded into outcome |
| POST | `/api/ops/debugger-analytics/forks` | user override `fork_` |
| PUT | `/api/ops/debugger-analytics/forks/{fork_id}` | scores_after → raised? |
| POST | `/api/ops/debugger-analytics/rollbacks` | snapshot reset **proposal** (never auto) |
| PUT | `/api/ops/debugger-analytics/rollbacks/{rid}` | **approve** reset window |
| POST | `/api/ops/debugger-analytics/issues` | local `iss_*`; GitHub stays pending |
| PUT | `/api/ops/debugger-analytics/issues/{id}` | **approve** GitHub file |
| GET | `/api/ops/debugger-analytics/logic?scope=` | weekly / daily / prompt |
| POST | `/api/ops/debugger-analytics/agent-score` | Render Agent same project_id + log_ids |
| GET | `/api/ops/debugger-analytics/bugs/{id}/instances` | harness **ping** a bug id |
| POST | `/api/ops/debugger-analytics/sessions` | open `sess_*` |
| POST | `/api/ops/debugger-analytics/sessions/close` · `/cede` | mint `cost_*` (tokens/time; no fake $) |
| GET | `/api/ops/debugger-analytics/cost-reports` · `/latest` | session cost + speak + YES/HOLD/NO |

Other-instance project ids: `{studioProject}.{instance8}`. Reserved Studio ids include `ce8294df`. Tickets include `log_ids` as `id | id | id`.

Grok DMs / `SendToAgent` are **not** auto-forwarded. Index script only reads files we already have.

## Curl

```bash
curl -sS "https://render3d.app/mcp/group-chat"
curl -sS -H "Content-Type: application/json" \
  -d '{"agent":"sam","text":"hello"}' \
  "https://render3d.app/mcp/group-chat"

# Studio (recycle first; often 404 today)
curl -sS "https://render3d.app/api/ops/group-chat"
# tracebacks need harness/admin token
curl -sS -H "Authorization: Bearer $RENDER_STUDIO_TOKEN" \
  "https://render3d.app/api/ops/agent-ops/tracebacks?limit=20"
```

## On-disk (what I used more than the API)

`ai-context/agent-bus/inbox/*.json`  
`ai-context/agent-bus/watchdog/broadcast.jsonl`  
`ai-context/agent-bus/watchdog/events.jsonl`  
`ai-context/agent-bus/harness-inbox/`

---

## Ask the harness (token `harness1`) — explain only

Voice, round table, team chat, or MCP `grok_debugger`:

- “How do log_ids chain?” / “what is last3?”
- “Privileges / ask-safe / Approve?”
- “Where are cost reports?”
- “Project id + tenant suffix?”
- “What is `/mcp/sandbox` / team-chat feed / controls / voice / pitch / tasks?”

**MCP (no production writes):**

```
grok_debugger({ "action": "explain_tracking", "q": "last3" })
grok_sandbox({ "action": "explain", "q": "cost reports" })
GET https://render3d.app/mcp/sandbox/explain
```

Skill (read-only): `mcp/grok-bot/skills/api-tracking-explain/SKILL.md`  
Aliases: `explain_api` `explain_logs`. Never edits `studio/app.js`. Never auto-applies to production Studio.

### `last3` log chain (`d9c98119-*`)

Each Cursor/Grok turn mints `log_id` = `{chat8}-{n}` (example prefix `d9c98119`). Tickets and debugger footers carry the **prior three**:

`last3: d9c98119-003 | d9c98119-004 | d9c98119-005`

If this turn **broke** something, `blamed_log_id` is usually the last of `last3`. Group-chat rows use `msg_gc_*` (not the Cursor `d9c98119` family). Raw jsonl at `/docs/media/group-chat.jsonl` has **no** `log_id`. Round table packet field `last3` is the same chain (`ROUND_TABLE_LAST3`).

### Privileges / ask-safe / Approve

Grok **asks**; Sam or the harness **Approves**. Nothing auto-runs.

| Step | Path / action |
|---|---|
| List + pending | `GET /api/ops/debugger-analytics/privileges` · `grok_debugger action=privilege` |
| Queue only | `POST .../privileges/ask-safe` · `action=ask_safe` |
| Mark safe / ban / restrict | `PUT .../privileges/{method}` · `action=approve` kind=privilege |
| Fork / rollback / GitHub issue | `fork_` `rb_` `iss_*` — local first; GitHub file needs Approve |

### Cost reports (`cost_*`)

After session **close** / **cede** / `confirm_fixed`: tokens in/out, duration, damage vs outcome, methods, suggestions, team-chat YES/HOLD/NO, `speak` line for Voice. **No invented USD** (`currency=unknown` unless a price was posted).

`GET /api/ops/debugger-analytics/cost-reports` · `/latest`  
`grok_debugger action=cost_report` · `session_close` · `session_cede`

### Project ids + tenant suffix

Studio project hex (reserved includes `ce8294df`). Other-instance ids: `{studioProject}.{instance8}` — do not mint a bare colliding Studio id. Area `501`. Tickets: `project_id` + `instance_id` + `log_ids` as `id | id | id`. Render Agent: `POST .../agent-score` same ids. `instance_public_factor` = 0.

### Sandbox MCP (sealed `frontend/sandbox/` only)

Hot-refresh: `GET /mcp/sandbox/rev` (Studio overlay polls ~2.5s). Writes bump mtime → viewer reloads. Jail rejects `../studio/app.js`.

| Method | Path | Token / notes |
|---|---|---|
| GET/POST | `/mcp/sandbox` | list/read/write · `sandbox1` |
| GET | `/mcp/sandbox/rev` | live-edit rev |
| GET | `/mcp/sandbox/file?path=` | one file |
| GET | `/mcp/team-chat/feed` | messages, votes, pad, pulse |
| GET/PUT | `/mcp/sandbox/controls` | live VR bindings · `xrctrl2` · simulate ≠ wire-to-scene |
| GET/PUT | `/mcp/sandbox/voice` | seated agent + distinct TTS · `voice1` |
| GET/POST | `/mcp/sandbox/pitch` | marketing deck · `mktpitch1` · apply=false |
| GET/POST | `/mcp/sandbox/slides` | round-table slides · `mktpres1` |
| GET/POST | `/mcp/sandbox/tasks` | Sam assigns; Ledger announces done · `rnddemo1` |
| GET/POST | `/mcp/sandbox/decision` | Astra brief + votes |
| POST | `/mcp/sandbox` `{action:correct}` | Sam “that’s wrong, change X” → sandbox file + rev · **not** production |
| GET | `/mcp/sandbox/explain` | this pack · `harness1` |

Control-config fallback: `GET /api/xr/control-config`. Simulate/listen applies in the current XR session. **Wire-to-scene** stays `pending_approval` until Approve.

### Real-time Sam corrections

Say or type: “That’s wrong, change X” (voice, round table, team chat as `sam`). Harness writes **sandbox only**; `/mcp/sandbox/rev` refreshes Chat/Files/viewer. Production unchanged until Approve. Clip-bot examples stay `cede_example` `apply=false`.
