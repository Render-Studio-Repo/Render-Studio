-- Sandbox / VR compact context log for click + tool transitions.
-- Apply on staging first. Private by default — service role only.
CREATE TABLE IF NOT EXISTS public.sandbox_context_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text NOT NULL DEFAULT 'render-studio',
  session_id text NOT NULL,
  source text NOT NULL CHECK (char_length(source) <= 40),
  feature_id text NOT NULL CHECK (char_length(feature_id) <= 80),
  event_kind text NOT NULL CHECK (char_length(event_kind) <= 40),
  target_id text CHECK (char_length(target_id) <= 80),
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  edge_summary text CHECK (char_length(edge_summary) <= 400),
  tool_summary text CHECK (char_length(tool_summary) <= 400),
  observed_at timestamptz NOT NULL DEFAULT now(),
  reliability text NOT NULL DEFAULT 'client_measurement'
    CHECK (reliability IN ('client_measurement','server_measurement','operator_label','unknown'))
);

CREATE INDEX IF NOT EXISTS sandbox_context_events_session_time_idx
  ON public.sandbox_context_events (session_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS sandbox_context_events_feature_time_idx
  ON public.sandbox_context_events (feature_id, observed_at DESC);

REVOKE ALL ON TABLE public.sandbox_context_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.sandbox_context_events TO service_role;
