-- Per-user X Chat bot token (xcbot_) on public."Users".
-- Fernet ciphertext written by origin (service_role). Never grant this
-- column to anon/authenticated.

alter table public."Users" add column if not exists x_bot_token text;

comment on column public."Users".x_bot_token is
  'Fernet ciphertext of the user X Chat bot token (xcbot_). Service role only.';

revoke select (x_bot_token) on public."Users" from anon, authenticated, public;
revoke update (x_bot_token) on public."Users" from anon, authenticated, public;
