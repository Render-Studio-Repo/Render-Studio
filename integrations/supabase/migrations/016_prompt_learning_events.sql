-- Private, expiring feedback events for personal prompt guidance.
-- The application uses the service role; browser roles cannot read these rows.

ALTER TABLE public.prompt_learning_state
  ADD COLUMN IF NOT EXISTS feedback_retention_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.prompt_learning_events (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  project_id text NOT NULL,
  version text NOT NULL,
  stage text NOT NULL CHECK (stage IN ('interpretation', 'cad_result', 'micro_edit', 'model_rating')),
  payload jsonb NOT NULL,
  payload_bytes integer NOT NULL CHECK (payload_bytes BETWEEN 2 AND 48000),
  vote integer CHECK (vote IN (0, 1)),
  comment text NOT NULL DEFAULT '' CHECK (length(comment) <= 3000),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days')
);

CREATE INDEX IF NOT EXISTS prompt_learning_events_user_recent
  ON public.prompt_learning_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS prompt_learning_events_expiry
  ON public.prompt_learning_events (expires_at);

ALTER TABLE public.prompt_learning_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prompt_learning_events FROM anon, authenticated;
GRANT ALL ON public.prompt_learning_events TO service_role;

COMMENT ON TABLE public.prompt_learning_events IS
  'Opt-in, per-user prompt feedback. Expires after 90 days and is never inserted wholesale into ordinary model context.';

CREATE OR REPLACE FUNCTION public.prune_expired_prompt_learning_events()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE deleted_count integer;
BEGIN
  DELETE FROM public.prompt_learning_events WHERE expires_at < now();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_expired_prompt_learning_events() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_expired_prompt_learning_events() TO service_role;
