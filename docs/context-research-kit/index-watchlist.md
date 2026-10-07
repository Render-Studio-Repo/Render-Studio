# What to monitor while indexing the database

An index is useful only if it still points to the right source and the right version. Record these metrics per project, source kind, and embedding model.

| Check | Detection | Action |
| --- | --- | --- |
| Source integrity | Recompute SHA-256 of stored source and each chunk; verify exact `source[start:end] == content` | Quarantine the document version and reingest from the original source |
| Span coverage | Union of chunk spans covers every source character; overlap is allowed | Rechunk and investigate boundary logic |
| Version drift | Indexed version differs from current source version | Mark old hits historical; enqueue new version; never silently reuse old offsets |
| Duplicate ingestion | Same `(project, external_id, source_hash)` or same `(document, ordinal)` repeated | Deduplicate idempotently and count retries |
| Embedding compatibility | Model name and dimension match the index; vectors are non-null and finite | Reembed with the pinned model or route to a matching index |
| Retrieval quality | Sample known queries with adjudicated relevant chunks; measure recall@k and false positives | Tune chunk size, hybrid keyword/vector weights, or reranker on held-out samples |
| Freshness | Time from source change to indexed version and search visibility | Alert on queue lag and retry failures |
| Citation validity | Search hit resolves to stored text, hash, and version; agent opens source before claiming it | Suppress invalid hit; log an attribution error |
| Observation comparability | Snapshot status has environment, build, timestamp, and source; client-only checks use client traces | Mark mismatches `unknown`; schedule comparable checks |
| Feature coverage | Newly registered features have dependency edges and checks; known features do not disappear from current registry | Alert with last-good and first-bad IDs; add a check before promoting a baseline |
| Privacy and access | No `anon` or browser read access to raw prompts; privileged key stays server-side; redaction/retention applied | Stop ingestion/exposure, rotate leaked key, repair grants/policies |
| Data growth | Table size, HNSW build time, query p95, storage, and delete backlog | Partition/archive by project/time; test index changes on a copy |

Suggested ingestion state machine: `received → hashed → chunked → embedded → indexed → verified`. A failure creates a retryable state and error ID. Only `verified` chunks are eligible for agent retrieval. Watchdog checks should be scheduled on each ingestion and sampled again periodically, since later source edits or index migrations can invalidate earlier results.

For incident analysis, monitor a separate evidence-quality stream: count claims without source IDs, contradictions not retracted, tests whose environment differs from the failing one, mandatory features left `unknown`, and fixes later followed by a new regression. These are better learning signals than a raw count of agent votes.
