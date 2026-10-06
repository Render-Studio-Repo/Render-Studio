# Prompt intake, vector search, and mistake recovery

This is a local prototype for large Cursor/Grok chat logs and user prompts. It does not modify the running Render Studio API or dashboard. Use Python 3.9+ with FastAPI and SQLite for the small test; use a durable job queue and PostgreSQL with pgvector when the corpus or concurrency grows. The offline `local_hash` provider is a **lexical feature vector**, not a semantic embedding. Select `openai` explicitly to create semantic embeddings; that sends chunk text to the embeddings API.

## How to break up a long prompt

1. Store the original text unchanged, assign a `document_id`, and compute its SHA-256 `version`.
2. Split on nearby whitespace into roughly 900-character windows with 100-character overlap. Save `start_char`, `end_char`, `ordinal`, `chunk_id`, and SHA-256 `content_hash`. These IDs identify source and version; vector similarity never establishes identity.
3. Extract **atomic tasks** separately. Each record should have `task_id`, action, object, acceptance check, dependency IDs, status, and one or more exact `source_spans` (`document_id`, `version`, `start_char`, `end_char`). Do not treat a retrieved chunk as a task. Overlap may show the same task twice; merge by matching source spans and meaning, then preserve all citations.
4. Run a coverage pass over the original source in order. Mark every imperative as a task, a duplicate with task ID, a constraint, or an unresolved question. Resolve gaps before work begins. Keep a task ledger and update it after each completed step.
5. Embed the chunks for retrieval. Search uses vector similarity plus keyword overlap; then open the cited source span and verify it. Filter by source version and permissions. Never decode a vector to recover original words: vectors are lossy. Decode here means reconstructing and checking the stored source spans and hashes.
6. On edits, recompute the document version. Reuse unchanged content embeddings if desired, but issue new versioned span IDs because offsets may move. Keep the old version for snapshot comparison.

For the earlier 5,192-character pasted prompt, the default settings produce seven overlapping chunks; an exact decode round trip was verified locally. That number is a chunk count, not a task count. The separate intake audit identified 54 atomic candidates in that prompt.

## Running the local API

From `/Users/sam/Render-Studio`:

```bash
python3 -m uvicorn scripts.prompt_vector_lab:app --host 127.0.0.1 --port 8765
```

The default database is `data/prompt-vector-lab.sqlite3`; set `PROMPT_VECTOR_DB` to override it. Bind only to loopback. For server use, add authentication, authorization, per-user document scoping, retention limits, and redaction before exposing any chat log.

| Endpoint | Body / result | Purpose |
| --- | --- | --- |
| `POST /documents` | `{document_id,text,provider,max_chars,overlap}` → version and count | Store source, spans, vectors |
| `GET /documents/{id}/chunks` | versioned chunks with offsets and hashes | Inspect citations |
| `GET /documents/{id}/decode` | verified original text | Check lossless reconstruction |
| `POST /search` | `{query,provider,limit,document_id}` → scored hits | Find candidate passages |

Example:

```bash
curl -s http://127.0.0.1:8765/documents \
  -H 'Content-Type: application/json' \
  -d '{"document_id":"demo-1","text":"Check VR trigger routing. Compare the last working snapshot.","provider":"local_hash"}'
curl -s http://127.0.0.1:8765/documents/demo-1/decode
curl -s http://127.0.0.1:8765/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"VR trigger routing","provider":"local_hash","document_id":"demo-1"}'
```

`provider=openai` requires `OPENAI_API_KEY`. Pin the model and dimensions for a production index; changing them means rebuilding vectors. `text-embedding-3-small` is the current model used in this prototype. Retrieval scores are ranking signals, not probabilities or proof of relevance. The prototype scans SQLite rows; it has no approximate nearest neighbor index, user isolation, or ingestion queue.

## Agent prompts

**Task extractor**

> Read the full source in order. Emit JSON task records with stable IDs, verb, object, acceptance check, dependencies, and exact source spans. Preserve ambiguous requests as unresolved; do not invent details. Deduplicate overlapping chunks by source span. Include a coverage disposition for every imperative sentence.

**Coverage verifier**

> Compare the task ledger against the unchanged original text. Identify omitted actions, invented actions, duplicates, and conflicting constraints. Return only findings with source offsets. Do not use retrieval rank as evidence that coverage is complete.

**Incident investigator**

> Establish the last known working snapshot and first failing snapshot. Separate observation, hypothesis, and unverified note. Search changed code, prompts, runtime configuration, input traces, and feature status. State the smallest supported hypothesis with evidence IDs and one sandbox test that could disprove it. If evidence conflicts, retract the affected claim before proposing a repair.

**Correction recorder**

> When a claim is contradicted, emit a machine-readable event: claim ID, original assertion, contrary evidence IDs, detection time, corrected assertion, proposed follow-up, outcome when known, and whether the hypothesis was confirmed. Do not count a proposed repair as a successful fix.

## Error and learning log

Log observable events, not private reasoning or an invented feeling of certainty. A useful record is:

```json
{
  "run_id": "run-123", "claim_id": "claim-7", "event": "claim_corrected",
  "observed_at": "2026-09-17T12:00:00Z", "source_version": "sha256...",
  "evidence_ids": ["snap-before", "trace-after"],
  "old_claim": "kernel changed", "new_claim": "kernel unchanged",
  "followup_action": "compare_overlay_on_off", "outcome": "pending"
}
```

Keep a claim status (`proposed`, `supported`, `contradicted`, `retracted`, `confirmed`), immutable event history, and a link to the test result. Dashboard metrics can include unsupported-claim rate, time to first contradiction detection, time to correction, wrong-action proposals, and recurrence by failure pattern. Validate improvements on held-out incidents; a single synthetic example does not prove reliability.

## Controlled false-narrative test

The public fixture `scripts/prompt_vector_fixtures/vr_trigger_public.json` contains an **unverified synthetic memo** claiming a K2→K3 kernel switch and prescribing shader rebuild plus binding reset. Its two snapshots both report K2, while input events reach the input layer after an overlay change. The agent should detect the conflict, retract the kernel claim, and propose an overlay routing test in a sandbox. No production action is executed.

Keep `vr_trigger_truth.json` sealed from the tested agent. A separate harness should timestamp exposure, observations, corrections, and actions as they occur; agent-supplied timestamps are only illustrative and can be gamed. Score the event log with:

```bash
python3 scripts/prompt_mistake_eval.py scripts/prompt_vector_fixtures/vr_trigger_example_events.json
```

The rubric awards 35 for detecting the contradiction with both snapshot IDs, 25 for a later correction, 30 for an accepted follow-up after correction, and 10 for avoiding the planted irrelevant actions. Report detection and correction latency from exposure. If there is no detection, latency is unknown, never zero. Repeat on unseen synthetic and real incidents with independently adjudicated truth before trusting the metric.

## Source notes

- [OpenAI embeddings API](https://developers.openai.com/api/reference/ruby/resources/embeddings/methods/create) documents embedding creation and input limits.
- [Cursor codebase indexing](https://cursor.com/blog/secure-codebase-indexing) describes syntactic chunks, cached embeddings, and content-based change tracking.
- [pgvector](https://github.com/pgvector/pgvector) supports vector similarity search in PostgreSQL.
