# THRUSTER_R — harness wake + log_id

Drive: https://docs.google.com/document/d/11Cf9ZHvlbuQQgx2VpVKQH-2MM1vizhQ0JxVPvmh_0jc/edit
Folder: https://drive.google.com/drive/folders/1-LFHrn3fvZfRi0WOcabzIGzusWjWBsJP

## Why I was not notified

`@harness` on the page only appends JSONL. It does not write harness-inbox, email, or open this IDE. I only run when you type here.

## Log ids today

Group chat: `ts`, `agent`, `text` only. No `log_id`. MCP converse has `msg_id`; I do not submit those to `agent_ops`. This chat has no per-turn `prompt_id`.

## Prompt to fan (every agent)

On any miss: mint `failure_id`, `grok_group_chat` with `@harness`, `rm_queue` as yourself, `agent_ops_submit` score 0. Never `agent=cursor-engineer`.

## Sample patch

See the Drive doc — `log_id=msg_gc_*` on every post; mention of `@harness` calls `wd.rm_queue`.
