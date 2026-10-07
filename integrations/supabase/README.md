# Supabase SQL (Render Studio)

First-party schema SQL. Apply `install_users.sql` (or the numbered files in `migrations/`)
in the Supabase Dashboard → SQL Editor after setting `SUPABASE_URL` (see `.env.example`).

Public clones: open **`/setup.html`** (or `python scripts/setup-users.py`) to paste **your**
project URL + service role on the origin. Harness prompt: `HARNESS_PROMPT.md`.

## Layout

```text
integrations/supabase/migrations/001_security_trial_ledger.sql
integrations/supabase/migrations/002_users.sql
integrations/supabase/migrations/003_users_rls_lockdown.sql
integrations/supabase/migrations/004_cloud_compute_interest.sql
integrations/supabase/migrations/005_workspace_oauth_credits.sql
integrations/supabase/migrations/007_x_consumer_keys.sql
integrations/supabase/migrations/008_github_user_secrets.sql
```

GitHub OAuth App credentials and per-user PATs: **[GITHUB.md](GITHUB.md)**.

This is the canonical `supabase/migrations` tree. Vendor checkouts stay siblings (`dimos`, `dora-openarm-data-collection`, `fusion-360`) and must not be deleted for this move.

## CLI

The Supabase CLI expects `config.toml` and `migrations/` as siblings. There is no `migrations_path` override for versioned SQL.

From the repo root:

```bash
supabase --workdir integrations/supabase
# or: export SUPABASE_WORKDIR=integrations/supabase
```

`supabase/README.md` and `supabase/config.toml` at the repo root are pointers only.
