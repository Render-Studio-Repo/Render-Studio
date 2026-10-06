CREATE TABLE IF NOT EXISTS public.prompt_learning_state (
  user_id text PRIMARY KEY,
  smart_learning_enabled boolean NOT NULL DEFAULT false,
  active_version text NOT NULL DEFAULT 'baseline',
  trial_version text,
  approval_rate double precision CHECK (approval_rate BETWEEN 0 AND 1),
  ratings integer NOT NULL DEFAULT 0,
  is_improving boolean NOT NULL DEFAULT false,
  metrics jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.prompt_learning_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.prompt_learning_state FROM anon, authenticated;
GRANT ALL ON public.prompt_learning_state TO service_role;
COMMENT ON TABLE public.prompt_learning_state IS 'Compact prompt experiment metrics; raw feedback is retained in the bounded server store. Not model-weight training.';
