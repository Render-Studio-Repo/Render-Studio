-- Lock secret columns on public."Users". Service role (origin) still has full access.
-- Anon / authenticated must not SELECT password_hash, ai_keys, or oauth_secrets.

revoke all on public."Users" from anon, authenticated, public;
revoke all on public.render_profiles from anon, authenticated, public;
revoke all on public.render_user_secrets from anon, authenticated, public;

grant all on public."Users" to service_role;
grant all on public.render_profiles to service_role;
grant all on public.render_user_secrets to service_role;

revoke select (password_hash, ai_keys, oauth_secrets) on public."Users" from anon, authenticated, public;

grant select (
  id, email, username, display_name, role, created_at, updated_at,
  last_login_at, last_seen_at, avatar_url, bio, stats,
  project_count, model_count, prompt_count, success_count, error_count,
  credits_balance_cents, total_spend_cents, last_model_created_at,
  owned_project_ids, ai_provider, ai_model
) on public."Users" to authenticated;

grant update (
  display_name, username, avatar_url, bio, last_seen_at, last_login_at
) on public."Users" to authenticated;

drop policy if exists users_anon_all on public."Users";
drop policy if exists "Enable read access for all users" on public."Users";
drop policy if exists users_select_all on public."Users";

drop policy if exists users_select_own on public."Users";
create policy users_select_own on public."Users"
  for select to authenticated
  using (
    supabase_user_id = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

drop policy if exists users_update_own on public."Users";
create policy users_update_own on public."Users"
  for update to authenticated
  using (
    supabase_user_id = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  with check (
    supabase_user_id = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
