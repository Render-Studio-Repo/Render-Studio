-- Example only. Apply to a staging Supabase project after review.
-- Private by default: no direct anon/authenticated grants or policies.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.research_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text NOT NULL,
  external_id text NOT NULL,
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_text text NOT NULL,
  source_kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, external_id, source_sha256)
);

CREATE TABLE IF NOT EXISTS public.research_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.research_documents(id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  start_char integer NOT NULL CHECK (start_char >= 0),
  end_char integer NOT NULL CHECK (end_char > start_char),
  content text NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  embedding_model text NOT NULL DEFAULT 'text-embedding-3-small',
  embedding vector(1536),
  fts tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  UNIQUE (document_id, ordinal),
  UNIQUE (document_id, start_char, end_char)
);

CREATE TABLE IF NOT EXISTS public.research_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id text NOT NULL,
  prompt_id text NOT NULL,
  commit_sha text,
  environment jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_paths jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, prompt_id)
);

CREATE TABLE IF NOT EXISTS public.research_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.research_runs(id),
  feature_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('ok','degraded','broken','missing','unknown')),
  snapshot_id text,
  environment jsonb NOT NULL DEFAULT '{}'::jsonb,
  observed_at timestamptz NOT NULL DEFAULT now(),
  source_kind text NOT NULL,
  source_ref text NOT NULL,
  source_sha256 text CHECK (source_sha256 IS NULL OR source_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS public.research_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.research_runs(id) ON DELETE CASCADE,
  document_id uuid REFERENCES public.research_documents(id),
  chunk_id uuid REFERENCES public.research_chunks(id),
  observation_id uuid REFERENCES public.research_observations(id),
  kind text NOT NULL,
  source_ref text NOT NULL,
  claim text,
  reliability numeric(4,3) CHECK (reliability BETWEEN 0 AND 1),
  observed_at timestamptz,
  CHECK (num_nonnulls(document_id, chunk_id, observation_id) >= 1)
);

CREATE TABLE IF NOT EXISTS public.research_hypotheses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.research_runs(id) ON DELETE CASCADE,
  statement text NOT NULL,
  prediction text NOT NULL,
  test_plan text NOT NULL,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','eliminated','supported','confirmed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.research_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hypothesis_id uuid NOT NULL REFERENCES public.research_hypotheses(id) ON DELETE CASCADE,
  agent_role text NOT NULL CHECK (agent_role IN ('intake','investigator','skeptic','test_runner','adjudicator')),
  vote text NOT NULL CHECK (vote IN ('support','reject','abstain')),
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  rationale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hypothesis_id, agent_role)
);

CREATE TABLE IF NOT EXISTS public.research_fix_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL UNIQUE REFERENCES public.research_runs(id),
  hypothesis_id uuid REFERENCES public.research_hypotheses(id),
  status text NOT NULL CHECK (status IN ('unverified','rejected','confirmed')),
  last_working_observation uuid REFERENCES public.research_observations(id),
  first_failing_observation uuid REFERENCES public.research_observations(id),
  patch_ref text,
  reproduction jsonb NOT NULL DEFAULT '[]'::jsonb,
  feature_checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  score numeric(5,2) CHECK (score BETWEEN 0 AND 100),
  rollback_ref text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.research_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.research_runs(id),
  feature_id text NOT NULL,
  priority text NOT NULL CHECK (priority IN ('low','medium','high','critical')),
  last_working_observation uuid REFERENCES public.research_observations(id),
  first_failing_observation uuid REFERENCES public.research_observations(id),
  log_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS research_chunks_fts_idx ON public.research_chunks USING gin (fts);
CREATE INDEX IF NOT EXISTS research_chunks_embedding_idx ON public.research_chunks USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS research_observations_feature_time_idx ON public.research_observations (feature_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS research_evidence_run_idx ON public.research_evidence (run_id);
CREATE INDEX IF NOT EXISTS research_alerts_open_idx ON public.research_alerts (priority, created_at DESC) WHERE resolved_at IS NULL;

DO $$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY[
    'research_documents','research_chunks','research_runs','research_observations',
    'research_evidence','research_hypotheses','research_votes','research_fix_cards','research_alerts'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', name);
  END LOOP;
END $$;

-- No anon/authenticated policies are created. Build a narrow authenticated server
-- API that checks project membership before using its privileged connection.
-- Validate source hashes/spans and evidence relationships in that API; SQL
-- CHECK constraints cannot prove content hashes match text or snapshot truth.
