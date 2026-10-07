# Ask the harness about API + logs (`harness1`)

Say in voice, round table, or team chat:

- How do `last3` log_ids chain? (`d9c98119-003 | d9c98119-004 | d9c98119-005`)
- Privileges / ask-safe / Approve
- Cost reports (`cost_*`, tokens/time, votes, speak)
- Project ids + tenant suffix
- `/mcp/sandbox`, `/mcp/team-chat/feed`, controls, voice, pitch, tasks

MCP: `grok_debugger action=explain_tracking` or `GET /mcp/sandbox/explain`.

Doc: `Getting-Started/agents/API-TRACKING-EXPLAINED.md`

Sam corrections (“That’s wrong, change X”) write **this tree only**. Production waits for Approve.
