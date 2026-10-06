-- Per-user GitHub personal access token on public."Users".
-- Values are Fernet ciphertext written by origin (service_role). Never grant
-- this column to anon/authenticated so public profiles and select * via
-- PostgREST cannot leak the PAT.
-- GitHub OAuth App client ID / secret stay in Supabase Auth GitHub provider
-- (Management API), not on this row.

alter table public."Users" add column if not exists github_pat text;

comment on column public."Users".github_pat is
  'Fernet ciphertext of the user GitHub personal access token. Service role only.';

revoke select (github_pat) on public."Users" from anon, authenticated, public;
revoke update (github_pat) on public."Users" from anon, authenticated, public;
