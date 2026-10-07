---
name: debugger-analytics-harness
summary: Skim ids only. Ping a bug id. Do not dump logs or secrets.
---

# Harness (skim)

Token: `PROMPT_TRACE_API_KEY` as `Authorization: Bearer` or `?key=`. Never echo it.

## Calls

- Search compact scores: `GET /api/ops/debugger-analytics/scores?key=`
- Ping: `GET /api/ops/debugger-analytics/bugs/{id}/instances?key=`
- Report this instance: `POST` same path `{instance_id, features}`
- Ref JSON: `GET /api/ops/debugger-analytics/refs/{ref_id}?key=`
- Render Agent score: `POST /api/ops/debugger-analytics/agent-score` `{project_id, instance_id, score, log_ids}`
- Rollback proposal: Grok `rollback` — always pending until Sam/harness `approve`. Not a git reset. Never auto-reset.
- GitHub issue: Grok `issue` writes local `iss_*`. File on GitHub only after `approve` `{kind:issue,id}`.
- Bug/ticket log chain on the master prompt: `last3: d9c98119-003 | d9c98119-004 | d9c98119-005`
- Explain API + logs (no prod writes): `grok_debugger action=explain_tracking` token `harness1`. Doc `Getting-Started/agents/API-TRACKING-EXPLAINED.md`. Skill `api-tracking-explain`. Ask: last3, privileges/ask-safe/Approve, `cost_*`, project suffix, `/mcp/sandbox`.

## Return shape

`{bug_id, name, instance_count, similar_instance_count, instances:[{instance_id,similar,similarity}]}`

Count stays **1** until other Render instances POST in. `similar=false` when surrounding feature statuses differ (viewport boot vs CAD generate). Other-instance project ids: `ce8294df.{instance8}` (never mint a bare colliding Studio id). Tickets must include `project_id`, `instance_id`, and a list of `log_ids` (`id | id | id`).

- Latency: `POST /api/ops/debugger-analytics/latency` `{actor, model, read_ms, tokens_in, tokens_out}`
- Confirm fixed: `POST /confirm-fixed` `{user_id, project_id, category}` → `{individual_id, dotted_id, prompt_count}`
- Taxonomy: `GET /taxonomy` (ids only)
- Metrics skim: `GET /metrics` (latency ids, confirm ids, blacklist methods)
- History ids: `GET /history?q=&limit=` → `{log_id, chat_id, timestamp, excerpt≤120}` (no bodies)
- History one: `GET /history/{log_id}`
- Credit: `GET /credit` (ids + scores, not logs)

## Do not

Dump transcripts. Ask for full logs. Write skill files. Run CLI. Start watchdogs. Upload Drive on the score path. Mutate `users`.
