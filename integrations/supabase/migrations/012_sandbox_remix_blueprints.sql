-- Stable sandbox remix blueprints + merge health. Apply after 011.
-- Service role only — guided restore pointers for repeatable results.
CREATE TABLE IF NOT EXISTS public.sandbox_remix_blueprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  remix_id text,
  session_id text NOT NULL,
  source_project_id text,
  kind text NOT NULL DEFAULT 'blueprint' CHECK (char_length(kind) <= 40),
  safe_to_merge boolean NOT NULL DEFAULT false,
  restore_guide jsonb NOT NULL DEFAULT '{}'::jsonb,
  health jsonb NOT NULL DEFAULT '{}'::jsonb,
  probes jsonb NOT NULL DEFAULT '[]'::jsonb,
  repeat_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  observed_at timestamptz NOT NULL DEFAULT now(),
  reliability text NOT NULL DEFAULT 'client_measurement'
    CHECK (reliability IN ('client_measurement','server_measurement','operator_label','unknown'))
);

CREATE INDEX IF NOT EXISTS sandbox_remix_blueprints_session_time_idx
  ON public.sandbox_remix_blueprints (session_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS sandbox_remix_blueprints_remix_time_idx
  ON public.sandbox_remix_blueprints (remix_id, observed_at DESC);

REVOKE ALL ON TABLE public.sandbox_remix_blueprints FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.sandbox_remix_blueprints TO service_role;
