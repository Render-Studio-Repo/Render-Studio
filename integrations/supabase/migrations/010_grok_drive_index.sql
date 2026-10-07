-- Grok Drive corpus for fleet search (offline vectors, not CAD hot path).
-- Folder: https://drive.google.com/drive/folders/1knAIlz5TwDWJReRt6QnaFJaV69EA5VmK

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.grok_drive_index (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id text NOT NULL DEFAULT '1knAIlz5TwDWJReRt6QnaFJaV69EA5VmK',
  file_id text NOT NULL,
  title text NOT NULL,
  layer text,
  url text,
  chunk_ix int NOT NULL DEFAULT 0,
  content text NOT NULL,
  embedding vector(1536),
  fts tsvector GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content, ''))
  ) STORED,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (file_id, chunk_ix)
);

CREATE INDEX IF NOT EXISTS grok_drive_index_fts ON public.grok_drive_index USING gin (fts);
CREATE INDEX IF NOT EXISTS grok_drive_index_title ON public.grok_drive_index (title);

ALTER TABLE public.grok_drive_index ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS grok_drive_index_read ON public.grok_drive_index;
CREATE POLICY grok_drive_index_read ON public.grok_drive_index
  FOR SELECT TO anon, authenticated USING (true);

REVOKE ALL ON public.grok_drive_index FROM PUBLIC;
GRANT SELECT ON public.grok_drive_index TO anon, authenticated;
GRANT ALL ON public.grok_drive_index TO service_role;

CREATE OR REPLACE FUNCTION public.match_grok_drive(
  query_embedding vector(1536),
  match_count int DEFAULT 8
)
RETURNS TABLE (
  id uuid,
  title text,
  layer text,
  url text,
  content text,
  similarity float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    g.id,
    g.title,
    g.layer,
    g.url,
    g.content,
    (1 - (g.embedding <=> query_embedding))::float AS similarity
  FROM public.grok_drive_index g
  WHERE g.embedding IS NOT NULL
  ORDER BY g.embedding <=> query_embedding
  LIMIT GREATEST(1, LEAST(match_count, 40));
$$;

GRANT EXECUTE ON FUNCTION public.match_grok_drive(vector, int) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.search_grok_drive(
  query_text text,
  match_count int DEFAULT 8
)
RETURNS TABLE (
  id uuid,
  title text,
  layer text,
  url text,
  content text,
  rank float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    g.id,
    g.title,
    g.layer,
    g.url,
    g.content,
    ts_rank(g.fts, websearch_to_tsquery('english', query_text))::float AS rank
  FROM public.grok_drive_index g
  WHERE g.fts @@ websearch_to_tsquery('english', query_text)
  ORDER BY rank DESC
  LIMIT GREATEST(1, LEAST(match_count, 40));
$$;

GRANT EXECUTE ON FUNCTION public.search_grok_drive(text, int) TO anon, authenticated, service_role;

COMMENT ON TABLE public.grok_drive_index IS 'Vector + FTS index of Render Grok Bot Drive (canon dump). Offline ingest.';
