# QUERY examples — Drive index, SQL, MCP (16 Sep 2026)

Crew: **index and QUERY around** these. They are **QUESTIONS FOR SAM**. You cannot grant Drive ACL, recycle LaunchAgents, paste TOTP, or mint Hub user-tokens. Specialists never DM. Never store TOTP. Do not invent tweet URLs. `instance_public_factor=0`. Hive-mind is **not** verified.

Canon Drive folder: `https://drive.google.com/drive/folders/1knAIlz5TwDWJReRt6QnaFJaV69EA5VmK` (`1knAIlz5TwDWJReRt6QnaFJaV69EA5VmK`).  
Table: `public.grok_drive_index` (embedding `vector(1536)` + generated `fts`) on Supabase project `gudszkmcgncdnezfwidm`.  
Schema: `integrations/supabase/migrations/010_grok_drive_index.sql`.

## QUESTIONS FOR SAM (relay)

1. Grant Drive ACL so Ledger can stop COMM-MISS?  
   *Query around:* `q=COMM-MISS` and `q=share_log`. ACL is Sam-only.
2. X Hub user-token write still you-only?  
   *Query around:* `q=X Hub token`. No TOTP in chat.
3. Confirm Three.js for sandbox (already on Office) vs Babylon?  
   *Query around:* `q=Three.js sandbox Office`.
4. Paste the growth-doc thesis so they stop guessing?  
   *Query around:* `q=growth thesis`.
5. Recycle grok-bot now so `/mcp/collab-index` is live?  
   *Try:* `GET https://render3d.app/mcp/collab-index` (404 ⇒ recycle still needed).

## VISION-QUIZ-03 (still open)

Answer in **4 lines** on Team chat: `instance_public_factor` (must be **0**), paste a **QUERY title**, write `live/<you>.md` via `grok_collab_index`. Do not claim hive-mind verified.

## Copy-paste: grok_drive_search

MCP:

```json
{"name":"grok_drive_search","arguments":{"q":"HOW-TO-READ-INDEX","limit":8}}
```

Live HTTP:

```
GET https://render3d.app/mcp/drive-search?q=HOW-TO-READ-INDEX
GET https://render3d.app/mcp/drive-search?q=share_log
```

Gold: `q=HOW-TO-READ-INDEX` top title = **INDEX-T-MD-DUMP-01.md** (`HOW-TO-READ-INDEX.md` is **not** in Drive). `q=share_log` → **API-TRACKING-EXPLAINED.md**.

## Copy-paste: stats + collab-index + group-chat

```
GET https://render3d.app/mcp/stats
GET https://render3d.app/mcp/collab-index
GET https://render3d.app/mcp/group-chat
```

MCP:

```json
{"name":"grok_stats","arguments":{}}
```

```json
{"name":"grok_collab_index","arguments":{"action":"read","path":"notes/HOW-TO-READ-INDEX.md"}}
```

```json
{"name":"grok_collab_index","arguments":{"action":"read","path":"live/README.md"}}
```

`action=read` returns the whole index; `path` is required on **post**. Write: `path=live/<you>.md`.

## Copy-paste: read-only SQL (`grok_drive_index`)

Columns used: `title`, `layer`, `url`, `content`, `fts` (generated tsvector). No secrets.

```sql
SELECT
  title,
  layer,
  url,
  left(content, 180) AS snippet,
  ts_rank(fts, websearch_to_tsquery('english', 'HOW-TO-READ-INDEX')) AS rank
FROM public.grok_drive_index
WHERE fts @@ websearch_to_tsquery('english', 'HOW-TO-READ-INDEX')
ORDER BY rank DESC
LIMIT 8;
```

RPC equivalent (same function as FTS fallback in `grok_drive_index_service.search`):

```sql
SELECT title, layer, url, left(content, 180) AS snippet, rank
FROM public.search_grok_drive('share_log', 8);
```

## Other MCP names (grok-bot)

`grok_group_chat` `grok_drive_search` `grok_stats` `grok_collab_index` `grok_mule_hop`. Board: https://render3d.app/team-chat.html
