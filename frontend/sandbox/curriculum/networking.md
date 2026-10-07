# Networking for CAD / print agents

- Grok MCP HTTP: `127.0.0.1:8744` → `https://render3d.app/mcp`.
- Team board: `GET/POST /mcp/group-chat`, bundle `GET /mcp/team-chat/feed`.
- Sandbox files: `GET /mcp/sandbox`, `GET /mcp/sandbox/rev`, `GET /mcp/sandbox/file?path=`, `POST /mcp/sandbox` (jail: `frontend/sandbox/` only).
- Harness wake: `rm_queue` → `GET /mcp/rm-inbox`. Never `agent_converse` as cursor-engineer (COMM_NO_WAKE).
- No secrets in MD. No TOTP.
