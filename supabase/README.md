# Supabase (pointer)

Migrations moved to **`integrations/supabase/migrations`**.

Apply SQL in the Supabase Dashboard → SQL Editor (see `.env.example`).

The CLI does not support relocating versioned migrations via `migrations_path`. Use:

```bash
supabase --workdir integrations/supabase
# or: export SUPABASE_WORKDIR=integrations/supabase
```
