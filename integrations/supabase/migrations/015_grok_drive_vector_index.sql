-- Indexed cosine retrieval for the Grok Drive semantic-search corpus.
-- CONCURRENTLY keeps the searchable table available while the index builds.

CREATE INDEX CONCURRENTLY IF NOT EXISTS grok_drive_index_embedding_hnsw
  ON public.grok_drive_index
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64)
  WHERE embedding IS NOT NULL;

ANALYZE public.grok_drive_index;
