-- Per-user X (Twitter) developer app consumer keys on public."Users".
-- Values are Fernet ciphertext written by origin (service_role). Never grant
-- these columns to anon/authenticated so public profiles and select * via
-- PostgREST cannot leak the secret.

alter table public."Users" add column if not exists x_consumer_key text;
alter table public."Users" add column if not exists x_consumer_secret text;

comment on column public."Users".x_consumer_key is
  'Fernet ciphertext of the user X developer-app consumer key (API key). Service role only.';
comment on column public."Users".x_consumer_secret is
  'Fernet ciphertext of the user X developer-app consumer secret. Service role only.';

revoke select (x_consumer_key, x_consumer_secret) on public."Users" from anon, authenticated, public;
revoke update (x_consumer_key, x_consumer_secret) on public."Users" from anon, authenticated, public;
