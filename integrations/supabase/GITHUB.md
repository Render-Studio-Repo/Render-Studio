# GitHub OAuth via Supabase (Render Studio)

Studio **login** stays email/password through Supabase Auth (`supabase_auth_service` / `/api/auth`). **Link GitHub** is an authorized app on that Studio account (Foundry + Preferences), not a second login identity.

Do not put real client secrets, PATs, or tokens in this file.

## Redirect URL

GitHub OAuth App (and Studio) land here after authorize:

`https://render3d.app/oauth/github/callback`

Alias: `https://render3d.app/oauth/github`. Local: `http://127.0.0.1:8001/oauth/github/callback`.

The FastAPI handler is `/oauth/github/callback` (also `/oauth/github`). It exchanges the code **on the server**, then stores the user token. If GitHub exchange fails (for example the code came from Supabase Auth PKCE), it tries `exchange_code_for_session` and keeps `provider_token`.

## Where the OAuth App credentials live

| Secret | Store | Who reads it |
| --- | --- | --- |
| GitHub OAuth **Client ID** + **Client Secret** | **Supabase Auth → GitHub provider** (Management API `external_github_*`) | Origin server only |
| Same pair, local runtime copy | repo `.env` (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`) — **not committed** | Origin server for GitHub token exchange |
| Redirect | `GITHUB_REDIRECT_URI` (default above) | Server + GitHub OAuth App settings |

Frontend JS never ships the client secret. Paste on Foundry → Pull requests (super admin) or:

```bash
GITHUB_CLIENT_ID=… GITHUB_CLIENT_SECRET=… python3 scripts/set-github-oauth-env.py
```

`save_oauth_app` writes `.env` **and** PATCHes the Auth GitHub provider. Restart `com.render3d.app` / `render3d.service` when idle so Settings pick up `.env`.

For **Login with GitHub** through GoTrue (optional, separate from Foundry link): GitHub’s OAuth App **Authorization callback URL** must be `https://<project-ref>.supabase.co/auth/v1/callback`. Keep `https://render3d.app/oauth/github/callback` on the Auth **additional redirect URLs** allow-list (this repo adds it when configuring the provider). Foundry linking still uses the GitHub authorize URL with the Studio callback so existing OAuth Apps keep working.

## Where user PATs / tokens live

| Secret | Column / table | RLS |
| --- | --- | --- |
| User GitHub PAT (and OAuth access token after Link GitHub) | `public."Users".github_pat` | Fernet **ciphertext**. `anon` / `authenticated` cannot SELECT or UPDATE. `service_role` only. |
| Same token, local cold copy | sqlite `github_tokens.access_token` | Origin disk, not PostgREST |
| Encrypted OAuth blobs (sync) | `public."Users".oauth_secrets` jsonb | Already revoked from anon/authenticated (`003_users_rls_lockdown.sql`) |

Migration: `integrations/supabase/migrations/008_github_user_secrets.sql`.

Users may update their own non-secret profile columns. They do **not** read `github_pat` through PostgREST. Studio APIs (`POST /api/foundry/github/pat`, Link GitHub callback) write via service role.

## Agent skill (pasted keys)

Project skill: `.cursor/skills/store-secrets-supabase/`.

When someone pastes a key / PAT / client secret in chat with intent to **store** it, the agent upserts it into Supabase (Users column or Auth provider). It must not commit the value, echo it, or leave it only in chat.

Helper (secret on stdin, never printed):

```bash
python3 scripts/store-user-secret.py --email you@example.com --kind github_pat
```

## Dashboard checklist (if Management API is blocked)

1. Authentication → Providers → **GitHub**: enable, paste Client ID + Secret.
2. Authentication → URL configuration: add `https://render3d.app/oauth/github/callback` (and the `/oauth/github` alias, plus local callback if you use it).
3. SQL Editor: run `008_github_user_secrets.sql`.
4. Confirm `.env` on the host has the same Client ID/Secret **without** committing it.
