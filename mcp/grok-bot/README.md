# Grok Bot — developer configuration

This is the wiring guide for the **Grok bot**: xAI chat, X (Twitter) posts and inbound Account Activity, Cursor MCP, and the GIF clip board. Use it to stand the stack up on a Mac that already runs Render Studio.

Do **not** put Consumer Key Secret, xAI keys, Bearer tokens, or `GROK_MCP_TOKEN` in git, `mcp.json`, logs, tweets, or this file. Copy names only.

**Product:** Render Studio (`https://render3d.app`)  
**Code:** `mcp/grok-bot/` (this folder)  
**Marketing copy for the bot:** [`MARKETING.md`](./MARKETING.md)

---

## What you are connecting

```text
Cursor  ──stdio──►  python3 mcp/grok-bot/server.py
Grok / Cursor remote  ──HTTPS──►  https://render3d.app/mcp
                                    │
                         FastAPI /mcp proxy  (uvicorn :8001)
                         and/or Cloudflare path /mcp
                                    │
                         LaunchAgent  com.render3d.grok-bot
                                    │
                         http://127.0.0.1:8744/mcp   (Streamable HTTP)

Studio UI  Preferences → Advanced → Authorized apps → Grok bot
                                    │
                         /api/integrations/grok-bot/*

X Account Activity  GET/POST  https://render3d.app/api/webhooks/x
                                    alias /api/x/webhook
                                    │
                         CRC + HMAC with Consumer Key Secret
                         drafts via Grok bot (live replies off by default)

Clip board  GET/POST  https://render3d.app/mcp/clips
            grab      POST /mcp/clips/{id}/grab
```

Two key sources (either is enough for chat):

| Source | When to use |
|--------|------------|
| Repo `.env` | Mac that hosts `:8744` and uvicorn. Bot process reads only Grok/X MCP keys from `.env`. |
| Studio Authorized apps | Per-user keys on the logged-in account (encrypted). MCP uses them when `RENDER_STUDIO_TOKEN` is set. |

---

## 1. Prerequisites

- macOS with Python 3.11+ (`/usr/bin/python3` is what LaunchAgent uses).
- Render Studio running locally: `http://127.0.0.1:8001` (uvicorn).
- An [xAI](https://console.x.ai) API key (`xai-…`) **or** a Grok key already saved in Studio **AI & Billing**.
- An [X developer app](https://developer.x.com) with Consumer Key + Consumer Key Secret if you want Share-to-X, Account Activity, or live `x_post`.
- Optional: Cloudflare tunnel for `render3d.app` (see `deploy/mac/cloudflare/config.yml`). If the public origin is uvicorn, `/mcp` is also proxied in `backend/main.py` to `:8744`.

---

## 2. Environment (repo `.env`)

Add these to the **repo root** `.env` (never commit real values). Names match `mcp/grok-bot/server.py` `DOTENV_KEYS` plus webhook vars used by Studio.

| Variable | Purpose |
|----------|---------|
| `XAI_API_KEY` | xAI Grok chat. Optional if the key lives in Studio. |
| `XAI_MODEL` / `GROK_MODEL` | Model id. Default `grok-4.5`. |
| `X_CONSUMER_KEY` | X developer Consumer Key (same as OAuth 1.0a API key). |
| `X_CONSUMER_SECRET` | Consumer Key Secret. CRC and webhook HMAC. Never log. |
| `TWITTER_CLIENT_ID` / `TWITTER_CLIENT_SECRET` | OAuth 2.0 app. Secret is CRC fallback if `X_CONSUMER_SECRET` is unset. |
| `TWITTER_BEARER_TOKEN` | App-only; optional for webhook register curl. |
| `TWITTER_ACCESS_TOKEN` + `TWITTER_ACCESS_TOKEN_SECRET` | Owner user-context. Needed for `scripts/register-x-webhook.py --register`. |
| `TWITTER_REDIRECT_URI` | Must match the X portal. Production: `https://render3d.app/oauth/twitter/callback`. |
| `XCHAT_BOT_TOKEN` | Optional tweet Bearer for live `x_post` without Studio. |
| `RENDER_STUDIO_URL` | Studio origin. Default `http://127.0.0.1:8001`. |
| `RENDER_STUDIO_TOKEN` or `RENDER3D_TOKEN` | Session/API token so MCP uses Studio-stored keys. |
| `GROK_MCP_HOST` / `GROK_MCP_PORT` | HTTP MCP bind. Default `127.0.0.1` / `8744`. |
| `GROK_MCP_TOKEN` | Optional Bearer for `/mcp`. A **wrong** Bearer is rejected. Initialize without a header is allowed (Grok’s remote connector cannot set it). |
| `GROK_MUSIC_API_KEY` | Bearer for `/api/marketing/v1` music + social check-ins. **Never commit.** Live value only in gitignored `Marketing/GROK.md`. |
| `X_WEBHOOK_PATH` | Default `/api/webhooks/x`. |
| `X_WEBHOOK_ENV` | Premium Account Activity **environment label** from developer.x.com (not the URL). |
| `X_WEBHOOK_AUTO_REPLY` | Default `false`. Mentions/DMs are **drafted** only unless you set this true. |
| `PUBLIC_BASE_URL` | Default `https://render3d.app`. Used when printing the webhook URL. |

The MCP loader **does not** ingest Stripe or other unrelated `.env` keys.

Commented templates also live in `deploy/migrate-8-2-2026/production-dotenv.example`.

---

## 3. Connect in Render Studio (per developer)

1. Create or open the X app at [developer.x.com](https://developer.x.com) → **Keys and tokens**.
2. In Studio: **Preferences → Advanced → Authorized apps → Grok bot**.
3. **Connect**. If Consumer Key is already on the user, that is enough to enable the bot. Otherwise paste Consumer Key, then paste Consumer Key Secret in Settings (it is never shown again).
4. Optional: paste an `xai-` key on the Grok bot form, or add Grok under **AI & Billing**.
5. Confirm Studio APIs (logged in):

```text
GET  /api/integrations/grok-bot/status
GET  /api/integrations/grok-bot/wiring
POST /api/integrations/grok-bot/connect
POST /api/integrations/grok-bot/chat
POST /api/integrations/grok-bot/x-post     body: { "text", "confirm" }
DELETE /api/integrations/grok-bot
```

`status` and `wiring` never return secrets — hints only (`…saved`).

---

## 4. Always-on HTTP MCP (LaunchAgent)

The bot must stay up as **HTTP**, not stdio. Stdio exits when Cursor closes stdin.

Repo files (edit **absolute paths** if your checkout is not `/Users/sam/Render-Studio`):

- `deploy/mac/com.render3d.grok-bot.plist`
- `deploy/mac/run-grok-bot.sh`

Install on this Mac:

```bash
REPO="$HOME/Render-Studio"   # change to your clone
mkdir -p "$HOME/Library/Application Support/Render3D/logs"
# Edit ROOT / WorkingDirectory / ProgramArguments in the plist and run-grok-bot.sh if needed
cp "$REPO/deploy/mac/com.render3d.grok-bot.plist" "$HOME/Library/LaunchAgents/com.render3d.grok-bot.plist"
launchctl unload "$HOME/Library/LaunchAgents/com.render3d.grok-bot.plist" 2>/dev/null || true
launchctl load -w "$HOME/Library/LaunchAgents/com.render3d.grok-bot.plist"
```

Manual run (same process LaunchAgent starts):

```bash
cd /path/to/Render-Studio
PYTHONPATH="$PWD" python3 mcp/grok-bot/server.py --http --host 127.0.0.1 --port 8744
```

| Check | URL |
|-------|-----|
| Health | `http://127.0.0.1:8744/health` |
| MCP | `http://127.0.0.1:8744/mcp` |
| Wiring JSON | `http://127.0.0.1:8744/mcp/wiring` |
| Clips | `http://127.0.0.1:8744/mcp/clips` |
| Marketing | `http://127.0.0.1:8744/mcp/marketing.md` |

Logs:

```text
~/Library/Application Support/Render3D/logs/grok-bot.log
~/Library/Application Support/Render3D/logs/grok-bot.err.log
```

`KeepAlive` + `RunAtLoad` restart on reboot and crash. `ThrottleInterval` is 15s.

---

## 5. Public URL (`https://render3d.app/mcp`)

Two hops; either is enough if the other is down:

1. **Cloudflare tunnel** (`deploy/mac/cloudflare/config.yml`): `path: ^/mcp` (and `/mcp.*`) → `http://127.0.0.1:8744` **before** the catch-all to `:8001`.
2. **FastAPI** (`backend/main.py`): `GET/POST/OPTIONS/DELETE /mcp` and `/mcp/{rest}` proxy to `http://127.0.0.1:8744` with CORS and MCP headers (`Authorization`, `Mcp-Session-Id`, `MCP-Protocol-Version`). If `:8744` is down, the API returns **502** “Grok bot MCP is not reachable on this host.”

Transport: **Streamable HTTP** MCP.

- `POST` JSON-RPC: `initialize`, `tools/list`, `tools/call`
- `GET` with `Accept: text/event-stream` is the optional SSE stream
- Optional header: `Authorization: Bearer <GROK_MCP_TOKEN>`

Grok’s remote MCP connector typically cannot send that header; initialize without it is allowed.

---

## 6. Cursor (`mcp.json`)

Copy [`mcp.json.example`](./mcp.json.example). Replace the checkout path. **Leave secret env values empty** — the HTTP server and Studio already have keys.

**Prefer public HTTP** (same process as LaunchAgent):

```json
{
  "mcpServers": {
    "grok-bot": {
      "url": "https://render3d.app/mcp"
    }
  }
}
```

Local HTTP (this Mac only):

```json
{
  "mcpServers": {
    "grok-bot": {
      "url": "http://127.0.0.1:8744/mcp"
    }
  }
}
```

Stdio (spawns a second process; does not replace LaunchAgent):

```json
{
  "mcpServers": {
    "grok-bot-stdio": {
      "command": "python3",
      "args": ["/ABS/PATH/Render-Studio/mcp/grok-bot/server.py"],
      "env": {
        "PYTHONPATH": "/ABS/PATH/Render-Studio",
        "RENDER_STUDIO_URL": "http://127.0.0.1:8001",
        "GROK_MODEL": "grok-4.5",
        "XAI_API_KEY": "",
        "X_CONSUMER_KEY": "",
        "X_CONSUMER_SECRET": ""
      }
    }
  }
}
```

Reload Cursor MCP. First calls: `grok_status`, then `grok_wiring`, then `grok_marketing`.

### MCP tools

| Tool | Role |
|------|------|
| `grok_status` | Connected? X app / Grok key hints. No secrets. |
| `grok_chat` | Chat via Studio token or `XAI_API_KEY`. |
| `grok_wiring` | Same numbered steps as this README. |
| `grok_marketing` | Load `MARKETING.md` (`section` / `query`). |
| `grok_incident` | Regressions. `guide` loads incident-research + debug-self-improve + `DEBUG-PATH-TRACER.md`. `debug_overview` / `debug_similar` / `debug_report` / `debug_instances` train traceback clustering. |
| `grok_debugger` | Analytics: `guide` first. Compact `search_ids`, draft watchdogs/CLI (Sam approves), scores, gated bug ids, harness `ping`. |
| `grok_request_clip` | Queue a GIF/clip. `live: true` = Playwright on this Mac. Optional `callback_url`, `wait`. |
| `grok_clip_status` | Poll one job. Prefer wait over rapid poll. |
| `grok_clip_wait` | Long-poll up to 120s. |
| `grok_clips` | List board (`ungrabbed: true` optional). |
| `grok_clip_grab` | Mark copied after the bot saved the file. |
| `x_post` | Draft unless `confirm=true`. Do not live-post from a test. |

---

## 7. X Account Activity webhook

Public inbound URLs:

- `https://render3d.app/api/webhooks/x`
- alias `https://render3d.app/api/x/webhook`

**CRC (X registers the webhook):** `GET ?crc_token=` → HMAC-SHA256 of the token with Consumer Secret → `{"response_token":"sha256=..."}`.

**Events:** `POST` with header `X-Twitter-Webhooks-Signature` = HMAC-SHA256 of the **raw body** with the same secret. Invalid signature → 403. Missing secret → 503.

Live reply tweets stay off unless `X_WEBHOOK_AUTO_REPLY=true`.

Print (does not call X):

```bash
python3 scripts/register-x-webhook.py
```

Register for real only when you mean it:

```bash
# Set X_WEBHOOK_ENV to the AAAPI environment label, then:
python3 scripts/register-x-webhook.py --register
```

Then subscribe the bot user in the X portal (Account Activity → subscriptions), or `POST .../account_activity/all/{env}/subscriptions.json`.

CRC uses `X_CONSUMER_SECRET`, else `TWITTER_CLIENT_SECRET`.

---

## 8. Clip board (GIFs for the X bot)

No **paid Generate**. Jobs: `data/grok-bot/clips/`. Guide GIFs: `frontend/docs/media/`. Live Playwright / MP4: `data/grok-bot/harness-inbox.md`.

| Method | URL | Body / notes |
|--------|------|----------------|
| Create | `POST https://render3d.app/mcp/clips` | `{ "title", "prompt" }`. `live: true` records real Studio UI. Optional `callback_url`. |
| List | `GET https://render3d.app/mcp/clips` | Every `url` + repo `path`. |
| Wait | `GET .../mcp/clips/{id}?wait=90` | Long-poll. Do not poll faster than 15s. |
| Grab | `POST .../mcp/clips/{id}/grab` | `{ "by": "grok-bot" }` after copy. |
| Wiring | `GET https://render3d.app/mcp/wiring` | Numbered steps JSON. |

Known `run` recorders: `sept`, `aug`, `getting-started`, `robotics`, `source-parts` (`scripts/gif-demos/`).

Live jobs stay `recording` until the GIF is a real capture (size threshold in `clip_harness.py`). Guide stubs are **not** marked ready for live jobs.

---

## 9. Verify

```bash
# LaunchAgent / local HTTP
curl -sS http://127.0.0.1:8744/health
curl -sS http://127.0.0.1:8744/mcp/wiring | python3 -m json.tool | head

# Public (needs tunnel or uvicorn + :8744)
curl -sS https://render3d.app/mcp/wiring | python3 -m json.tool | head

# CRC smoke (expects JSON response_token; not a live X register)
curl -sS "https://render3d.app/api/webhooks/x?crc_token=test"

# Unit tests (no live X, no paid Generate)
cd /path/to/Render-Studio
python3 -m unittest backend.tests.test_grok_bot
```

`grok_status` should show X app and/or Grok key **hints**. Tweets from tests must remain drafts (`confirm` false).

---

## 9b. Agent bus (PM → RM)

Specialists never DM this Cursor chat. To queue work for the live Regional Manager:

```text
MCP tools/call rm_queue
{ "agent": "project-manager", "text": "…", "tickets": ["T-…"] }
GET  https://render3d.app/mcp/rm-inbox
GET  https://render3d.app/mcp/comms-codes
```

`agent_converse` with `agent=cursor-engineer` is `COMM_NO_WAKE` (bus graffiti, no wake). Prompt: `Getting-Started/agents/PROMPT-comms-wiring.md`.

---

## 10. File map

| Path | Role |
|------|------|
| `mcp/grok-bot/server.py` | Stdio + HTTP MCP, clip routes, auth |
| `mcp/grok-bot/clip_harness.py` | GIF queue, live vs stub, grab |
| `mcp/grok-bot/MARKETING.md` | Features, assets, caption rules |
| `mcp/grok-bot/DEBUG-PATH-TRACER.md` | Debug sessions: mentioned-file status, relatedness, bot vs Sam, collateral |
| `mcp/grok-bot/skills/debug-self-improve/SKILL.md` | Traceback accuracy loop, prompt/hour retro, community clusters |
| `mcp/grok-bot/skills/debugger-analytics/SKILL.md` | Search ids, draft watchdogs, scores, gated bugs |
| `mcp/grok-bot/mcp.json.example` | Cursor snippet |
| `backend/services/grok_bot_service.py` | Studio Authorized app + wiring payload |
| `backend/services/x_webhook_service.py` | CRC + HMAC + inbound draft |
| `backend/routers/x_webhook.py` | Public GET/POST routes |
| `frontend/studio/authorized-grok-bot.js` | Preferences UI |
| `deploy/mac/com.render3d.grok-bot.plist` | launchd |
| `deploy/mac/run-grok-bot.sh` | Supervisor on `:8744` |
| `deploy/mac/cloudflare/config.yml` | `/mcp` before Studio `:8001` |
| `scripts/register-x-webhook.py` | Print / optional register |
| `backend/tests/test_grok_bot.py` | MCP, clips, CRC, Cloudflare order |

---

## 11. Troubleshooting

| Symptom | Check |
|--------|--------|
| `Editor` / Grok connector 502 | LaunchAgent not listening on `8744`. `lsof -nP -iTCP:8744 -sTCP:LISTEN`. Read grok-bot logs. |
| CRC 404 / invalid `response_token` | Public URL must be `/api/webhooks/x`. Secret must be **Consumer Key Secret**. Cloudflare must not strip query `crc_token`. |
| MCP `tools/list` 401 | Bearer does not match `GROK_MCP_TOKEN`. Omit the header or fix the token. |
| Chat “Set XAI_API_KEY” | Put `xai-` in `.env` **or** Connect Grok in Studio and set `RENDER_STUDIO_TOKEN` for stdio. |
| Live tweet from a test | Never pass `confirm=true`. Keep `X_WEBHOOK_AUTO_REPLY=false`. |
| Clip stays “recording” | Live job needs a real GIF (Playwright on this Mac). Stubs are not “done” for `live: true`. |
| Cloudflare hits Studio instead of MCP | `/mcp` ingress rules must be **above** the `:8001` catch-all. |

---

## 12. Rules the bot must follow

- Product name in copy: **Render Studio**. Domain: `https://render3d.app`.
- Caption footer: `Built in Render Studio https://render3d.app` (see `MARKETING.md`).
- Draft tweets first (`x_post` `confirm=false`).
- Never fire paid Generate to make promo assets.
- Never echo secrets in tool results or X posts.
- Music: `grok_music_request` then `grok_social_post` + check-ins. Prefer official/Topic/VEVO. Never clean/cover/instrumental. Weekly: `grok_social_weekly`. Taste: `grok_taste`. Management UI: Admin → Social media.


## Incident research

`grok_incident` exposes the super-admin `/api/ops/incidents/*` diagnostics API and `/api/debug-training/*` cluster/retros to Cursor/Grok. The workflow is in [`skills/incident-research/SKILL.md`](./skills/incident-research/SKILL.md) plus [`skills/debug-self-improve/SKILL.md`](./skills/debug-self-improve/SKILL.md) (traceback accuracy, prompt/hour retro, community packets). File-path tracing is [`DEBUG-PATH-TRACER.md`](./DEBUG-PATH-TRACER.md). `grok_debugger` is the compact analytics API (`skills/debugger-analytics/SKILL.md`). Set `RENDER_STUDIO_TOKEN` to a super-admin token for Studio incident history. Without it, `grok_incident` action `smoke` checks the local MCP host and returns `via=grok_mcp_local_host`; this does not prove the remote Studio instance is healthy. Management → Debugger shows alerts, weekly summaries, golden snapshot controls, pending watchdog/CLI approvals, scores, and bug ids. Client-side WebGL and VR checks must be submitted as observations; server smoke cannot verify them.
