# Office — how to trace 4.5 vs 4.6 (no secrets in the command)
# This harness (Cursor chat) = Grok 4.6
# Specialists (grok_chat) = env XAI_MODEL or GROK_MODEL or default grok-4.5
# Today .env has XAI_MODEL=grok-4.5 so the PM was correct if he said 4.5.

# 1) What grok-bot thinks it is
curl -sS https://render3d.app/mcp \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $GROK_MCP_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"grok_status","arguments":{}}}'

# Expect JSON field model: "grok-4.5" (not 4.6)

# 2) What xAI actually ran (look at the response model, never log the key)
curl -sS https://api.x.ai/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -d '{"model":"grok-4.5","messages":[{"role":"user","content":"Reply with only the model id you are."}],"temperature":0}'

# 3) Local bus: who called grok_chat
#    rg '"name": "grok_chat"' ai-context/agent-bus/watchdog/events.jsonl

# 4) Prompt-trace (Studio loops, not this Cursor chat)
#    rg 'model|grok-4' data/prompt-trace/live-prompts.jsonl

# What went wrong: two processes. Cursor UI = 4.6. grok-bot DEFAULT + XAI_MODEL = 4.5.
# I told Sam both. If the PM told Sam 4.5, he told the correct specialist number.
