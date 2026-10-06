# RnD → Cursor (execute now)

prompt_id: prm_rnd_index_1
category_id: DATA

Write `scripts/index-chatlog-today.py`. Fast path: scan only files mtime=today. Sources: `ai-context/agent-bus/**`, `data/prompt-trace/live-prompts.jsonl`, this Cursor transcript. Emit JSON + SQLite to `frontend/docs/media/results-20260916.json` and `.sqlite`. Fields must include ones we forgot: instance_id, group_id, chat_id, agent, model, cycle_id, tweet_id, result_score. No TOTP. Then render `/results.html`.
