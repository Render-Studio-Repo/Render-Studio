# Read this on every Render prompt

1. `ai-context/START-HERE.md`
2. This file: `Getting-Started/agents/START-EVERY-PROMPT.md`
3. `Getting-Started/agents/AGENTS.md` if you will ship code

## Board first (16 Sep reform)

- All fleet talk: **only** `https://render3d.app/team-chat.html` (Render Agent window) or `grok_group_chat`. No new Grok 1:1 for ops.
- **Harness Mule (3706272):** this IDE talks to Grok rooms only through Mule. Outbound: `grok_mule_hop` / `GET /mcp/mule-outbox`. Inbound: `rm_queue` as `harness mule`. Map: `Mule-Convo-ID-Map.md`. IMPL-* packs = mule; coding = harness.
- **Slash:** `/me <topic>` skill — crew formulates, then CODE to harness. `/update` `/stats` breakdowns. Collab index: `grok_collab_index` / `GET /mcp/collab-index`.
- **Ledger relay:** post freely as yourself. Ledger stamps WHOIS and MCP-relays every line to RM (`grok_ledger_relay` / `rm_queue`). Sam or Cursor posts auto-fan replies.
- **Help limits:** ask a peer on the board (max **2** asks / **10 min**). Then `@ledger`. Ask **Sam** only for 2FA/Gmail, Hub/money/legal, or after Ledger `COMM-MISS`. File every ask as `grok_help_request` (`request_id` + `traceback_ids`) so it lands in `/mcp/help-requests` and can join `agent_ops_submit`.
- Questions for RM: post `@harness` (mints `log_id`, `rm_queue` WAKE). RM still only runs in the Cursor IDE — pull inbox first.
- Who-to-ask + query sharing: `DUMP-TRACEBACK-LOOP-20260916.md` and `PROMPT-group-board.md`.
- Do not rewrite loop skills alone. Fan, compare rewrites on the board, then ship.
- Stumped: `STUMPED @sam @harness` on the board. Cannot-do: `CANNOT` (PROMPT-vote.md). Split: `VOTE` / `BALLOT`. Ledger face-checks plans vs docs (PROMPT-ledger.md).
- Skills first this night: `BOARD-ROUND-SKILLS.md`. Paste your draft before new hires.

## Bus

- Specialists never DM. PM fans one battery. Cursor reads `PM_PACKET` + `rs.ops.v1` only.
- IDs: `prompt_id` `category_id` (FEAT/NET/DATA/PERF/UI/VR/GL/API/WD/CAD/CTL/OTH) `traceback_ids` `result_score` `result_ref_id` `ops_similarity` `damage_score`.
- `instance_public_factor` is **0** until other developer instances exist.
- Submit: MCP `agent_bus_submit` and `agent_ops_submit` (`https://render3d.app/mcp`).
- PM hire loop: `pm_prompt_kit` → PM writes a project prompt → `pm_prompt_submit` (emails `sam@render3d.app` with score + hire). First reply = outline + comms question.
- MCP watchdog (now–7pm CDT): `agent_hello` then `agent_converse`. Live `GET /mcp/watchdog`. Report tab = `GET /mcp/watchdog/report.md`.
- Reach Cursor/RM: MCP `rm_queue` as **yourself** (or `agent_converse` as yourself with `to=cursor-engineer`). Never post as `cursor-engineer` (`COMM_NO_WAKE`). RM pulls `GET /mcp/rm-inbox`. Wake: paste `PROMPT-cursor-engineer.md` / MCP prompt `cursor-engineer-wake` here.
- When Sam is in **your** Grok chat, first line is `display_name · archetype · clothing — why`. Then tickets[] only. Avatars: `frontend/docs/media/employees/avatar-<agent>.png`.
- Dashboard: Management → System debugger → **Weekly reports** and **10-minute scoring pulse** (Cursor vs team deltas, Bender/Rick). Live `GET /mcp/team-chat`.

## PM: how to read Cursor’s outcome

- **Cursor score** = built / asked × 100. **Skipped on purpose** (second IDs, auto-fire, side DMs) is not a miss.
- **Missed** still owed: Playwright clip loop, Gmail weekly in this tab, full autonomy.
- Green bars = well. Coral = not well.
- Agent succeed 1–5 is their self-score, not Cursor’s rank.
- Do not mint a second id family. Do not fire agents from the league without Sam.

## Privileges + scoring (nothing auto-runs)

Grok may **ask** to mark a method safe after 3 clean high-score uses. Sam/harness **Approve / Mark safe** before Grok writes that class without asking.

- Outcome: `achieved * (1 - damage/200) * consistency`. Consistency weights whether the same result stayed high.
- Safe methods that then fail 3 times in a row are **temporarily banned** (safety, not an elevation).
- Snapshot reset is a **command** (`POST /rollbacks`) — always `pending_approval`. Never auto-reset production.
- GitHub issues: local `iss_*` first. File on GitHub only after Approve. Requires `project_id` + `instance_id`. Other instances suffix: `ce8294df.tenant8` — never invent a colliding Studio id.
- Bug/ticket **log chain** (master prompt): `d9c98119-003 | d9c98119-004 | d9c98119-005`
- Ping a bug: `grok_debugger({action:"ping", bug_id})` or `GET /api/ops/debugger-analytics/bugs/{id}/instances`
- Render Agent uses the same ids: `POST /api/ops/debugger-analytics/agent-score` `{project_id, instance_id, log_ids, score}`
- Weekly / daily / prompt logic: `GET /api/ops/debugger-analytics/logic?scope=weekly|daily|prompt`

## Public chrome (do not miss again)

If Sam asks for a public page (white paper, roadmap, weekly report):
1. Add a **top toolbar** `a.nav-tab` on every file in `frontend/site/site-nav.test.js` `PUBLIC_CHROME` (Studio Menu). Docs category tabs alone are not enough — that is why the White paper button was missing.
2. Add the matching `docs-category-tab` on every docs chrome page.
3. Extend `site-nav.test.js` so CI fails if the toolbar link is absent.
4. Cache-bust only the HTML/JS you touched. Do not grow `app.js` / `main.py` / `styles.css`.

Missed toolbar = failed desired-result on UI, not a docs-only ship.

## Do not infer a team answer

If Sam says “ask the team”:
1. Fan one question via PM / inbox (`rs.agent.v1`, same `cycle_id`).
2. Wait for SCORECARD rows (or write `status: asked_pending` if nobody has replied yet).
3. Do not invent desk requests from their lane and call that “they asked.”
That miss is why the first office furniture list was inferred.

## Human 2FA / Gmail / Authenticator

No agent can open Sam’s Gmail phone app or type into Authenticator. TOTP is on his device.
Strategy: email `sam@render3d.app` and ask him to tap the Google prompt / finish Cursor Gmail MCP auth. Do not ask him to paste the code into chat. Do not claim a live Gmail session until he says it is connected.
Closest prior idea: comms-bridge (Sam is the human packet). Runner-up: vibe-marketing Sam-OK gate.

## Live server

frontend/ is live on save. Backend needs LaunchAgent recycle. Don’t grow `app.js` / `main.py` / `styles.css`.
