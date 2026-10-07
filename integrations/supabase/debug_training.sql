-- Optional hub mirror for opted-in Render Studio instances.
-- sqlite data/debug_training.sqlite3 is the source of truth.
-- Apply on the public hub's Supabase if you want SQL cross-exams.

CREATE TABLE IF NOT EXISTS public.debug_instances (
  instance_id uuid PRIMARY KEY,
  first_seen timestamptz,
  last_seen timestamptz,
  public_base_url text DEFAULT '',
  git_sha text DEFAULT '',
  active_user_count integer DEFAULT 0,
  users_backend text DEFAULT '',
  telemetry_opt_in boolean DEFAULT false
);

ALTER TABLE public.debug_instances ENABLE ROW LEVEL SECURITY;
