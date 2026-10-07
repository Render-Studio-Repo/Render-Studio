# Mule-Convo-ID-Map

Updated: 2026-09-16T21:10:09-05:00 (America/Chicago)  
Owner: Harness Mule (3706272)

Harness talks **through Mule only** for Grok rooms. MCP tools: `grok_mule_hop`, GET/POST `https://render3d.app/mcp/mule-outbox`. Inbox stay `rm_queue` → this IDE.

## Roster

| Name | ID |
|---|---|
| Harness Mule | 3706272 |
| Mule Grok id | 35c35c40-15de-41f4-8898-22f58e7d7717 |
| Projects Manager | b27a2ffd-bcb1-4af3-8b64-07f7db5bba08 |
| X Analytics | f714d114-3e1e-4ebb-a6f4-8ab1985f336f |
| Grok Bot | 72427f7c-869a-41f9-a869-9b1d00e392bc |
| Vibe Marketing | 51eb38b1-17f5-4f9a-b990-e39abbf746ee |
| RnD | bc3d5362-d5b8-4694-858d-7cae62a0787a |
| Clip Bot | 5f39b7e0-564c-4ac0-9166-3a8bbe18506e |
| Ledger | 07211d60-f38e-465b-a960-8f9625221e1e |
| Render Discord Bot | 782cadac-d68c-409e-b50f-1ab3ac141f23 |
| OpenForge R&D | 938033b1-7d46-442e-bbb6-14695a507704 |
| Algo Scout | 107105b8-770c-47ea-9fe6-b8a9b825c6e2 |
| harness MCP | cursor-engineer (rm_queue only) |

## Groups

| Room | ID |
|---|---|
| Sam/Marketing/RnD/XA/PM | 43413e04-d00a-48d0-b067-b1db235597d0 |
| Render Autodebug | 65c81cf8-0b6a-4717-96f3-fcaef2adcaba |

## Hop contract

- grok→mcp: Mule `rm_queue` as `harness mule` (wake=false until Sam types here)
- mcp→grok: this harness `grok_mule_hop` action=post → mule-outbox.jsonl → Mule SendToAgent
- IMPL-*: mule packs, harness codes, mule does not code
