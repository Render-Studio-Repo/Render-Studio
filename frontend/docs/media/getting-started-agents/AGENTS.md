# Agent instructions — Render Studio workspace

**Folder:** `Getting-Started/agents/` (this file moved from `Getting-Started/AGENTS.md`).  
**Read `ai-context/START-HERE.md` first.**

Non-negotiables (details in `ai-context/`):

1. Live production (`render3d.service` / LaunchAgent, port 8001). `frontend/` edits go live on save.
2. New code in **new modules** + thin hooks. Do not grow `app.js`, `styles.css`, `backend/main.py`.
3. **Cache-bust** static assets (`?v=YYYYMMDD-slug`).
4. **Verify in a browser** before claiming UI done.
5. Don't touch auth, billing, admin, collab, OAuth, `backend/kernel/`, or `backend/render3d.db` unless asked.
6. Log finished work in `ai-context/worklog.md`.
7. **LOCKED — Cmd+Z after gizmo move** (`viewport-transform-undo.js`).
8. **LOCKED — model upright** (`ensureModelZUp` Jul 16 heuristic only).

Confirm-fixed IDs stay Debugger taxonomy: `PERF-07-00012`. Do not invent a second family.

## Tracking every operation set

When you create an **order of actions** (a technique), mint and return:

| Field | Meaning |
|--------|---------|
| `prompt_id` | Unique id for this prompt/run (`prm_…`) |
| `category_id` | Taxonomy code: `FEAT` `NET` `DATA` `PERF` `UI` `VR` `GL` `API` `WD` `CAD` `CTL` `OTH` |
| `traceback_ids` | Ordered step ids (`tb_…`) |
| `ops` | Ordered verb list, e.g. `["read","submit","score"]` |
| `result_score` | 0–100 desired-result after the prompt ran |
| `result_ref_id` | `res_…` from API (or empty until scored) |
| `ops_similarity` | 0–1 closeness of `ops` to other runs in the same `category_id` |
| `damage_score` | 0–1 harm vs goal (0 = clean) |
| `instance_id` | This Studio instance (local area). **Public/other-dev factor is 0 until we are public.** |
| `cycle_id` | `CYCLE-YYYYMMDD-HHMM` |

Upload via MCP `agent_ops_submit` or `POST /api/ops/agent-ops/tracebacks` (schema `rs.ops.v1`). Same body as debugger scores: join `log_id` / `project_id` when you have them.

Bus: `Getting-Started/agents/AGENT-BUS.md`. Every prompt: `START-EVERY-PROMPT.md`. Weekly tab: Management debugger.
