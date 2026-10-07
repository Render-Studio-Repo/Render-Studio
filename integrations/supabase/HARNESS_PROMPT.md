# Harness prompt — create Render Studio users DB on YOUR Supabase

Copy everything below into Cursor, Codex, or another coding agent. It uses placeholders only. Do **not** paste service_role keys, PATs, password hashes, or AI keys into the chat.

---

Set up Render Studio user storage on **my** Supabase project (not anyone else’s).

## Goal
Origin (Python FastAPI in this repo) must use Supabase table `public."Users"` as source of truth for logins, password hashes, and Fernet-encrypted personal AI keys. Teams, membership, `ProjectAccess`, team-shared keys, OAuth refresh tokens, and credit ledgers also live on Supabase (`Teams`, `TeamMembers`, `TeamKeys`, `OAuthTokens`, `CreditAccounts`, `CreditTransactions`). SQLite `data/render3d.db` stays on disk as a cold backup — do not delete local hashes/keys. When `SUPABASE_URL` + service role are set and `Users` is reachable, **do not verify passwords or decrypt personal AI keys from sqlite** (that hides a broken remote). Dual-write to sqlite as optional backup is OK.

## Env (gitignored `.env` on the origin only)
```
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
SUPABASE_SECRET_KEY=YOUR_SECRET_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
SUPABASE_KEY=YOUR_SERVICE_ROLE_KEY
SUPABASE_ACCESS_TOKEN=YOUR_OPTIONAL_MANAGEMENT_PAT
USERS_BACKEND=supabase
```
Never put `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_KEY`, or `SUPABASE_ACCESS_TOKEN` in frontend JS bundles, HTML, or client storage. Publishable/anon is the only key that may be discussed as “browser-safe,” and even then this app should keep it on the server `.env`.

## SQL
Apply `integrations/supabase/install_users.sql` in the Supabase Dashboard → SQL Editor (or `psql "$DATABASE_URL" -f integrations/supabase/install_users.sql`). Same create-table + RLS + grants as this repo: `Users`, `render_profiles`, `render_user_secrets`, trial ledger, plus `Teams`, `TeamMembers`, `TeamInvites`, `ProjectAccess`, `TeamKeys` (Fernet ciphertext, many keys per team), `TeamKeyGrants`, `UserTeamKeyOpts`, `OAuthTokens` (Onshape / Autodesk / Twitter/X / GitHub), `CreditAccounts`, `CreditTransactions`. Anon must not SELECT `password_hash`, `ai_keys`, `oauth_secrets`, `TeamKeys.api_key_enc`, or `OAuthTokens` ciphertext. Authenticated may only see non-secret profile columns for their own `Users` row. `service_role` is origin-only. Personal AI keys stay on `Users.ai_keys` jsonb (already multi-key). Do not delete local sqlite.

## App wiring (already in this repo)
- `backend/services/supabase_client.py` — server client
- `backend/services/supabase_users_store.py` — `Users` CRUD
- `backend/services/teams_service.py` — login/register
- `USERS_BACKEND=local` keeps the old sqlite users/passwords/AI keys method

## Dashboard (human) after SQL
1. Authentication → Providers: enable Email. Turn on leaked-password protection.
2. Authentication → Settings: JWT expiry you want (app sessions are origin JWTs; Auth is for password verify).
3. Authentication → MFA: enable TOTP if you want extra login factor (app still uses origin JWT after verify).
4. Project Settings → API: never expose service_role. Rotate any PAT that was pasted in chat.
5. Network restrictions / allowed URLs if the project is not meant to be world-writable.
6. Confirm REST as anon cannot read `Users.password_hash` or `Users.ai_keys`.

## Other databases
This app’s user store is sqlite (`backend/database.py`, `data/render3d.db`) or Supabase `Users`. There is no generic SQLAlchemy `DATABASE_URL` user table yet. To point at Postgres yourself: set `DATABASE_URL` in `.env` for your own tooling, then change `backend/services/supabase_users_store.py` / `backend/database.py` — do not put credentials in the frontend.

## Prove it
Origin `/api/health` should include `users_backend=supabase` (no PII). Login must log `auth_backend=supabase` without emails. Do not print secrets, tokens, JWTs, or hashes.

---
