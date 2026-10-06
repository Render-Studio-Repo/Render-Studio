# Large prompt intake audit

Source: `/Users/sam/.codex/attachments/b9688e8a-347b-42d1-a0aa-58dbb5dc6bb3/pasted-text.txt`

The source has 5,192 characters, 945 whitespace-delimited words, and three substantive text blocks (lines 1, 3, 4). Line 7, “im going to have you track the”, is incomplete and is excluded from the count. The 54 items below are **atomic request candidates**, not 54 commitments to build now. Counting changes if compound requests are grouped differently.

## Atomic request ledger: 54

### Intake and retrieval (T01–T14)

1. **T01** Count tasks in the prompt (L1).
2. **T02** Write a reusable large-context skill (L1).
3. **T03** Break prompts down without losing or overwriting objectives (L1).
4. **T04** Compare vectorization with other intake methods (L1).
5. **T05** Store vectorized prompt data for reruns (L1).
6. **T06** Assign stable IDs linking sentences, objectives, and steps (L1).
7. **T07** Save source references before deriving tasks and error records (L1).
8. **T08** Test whether pre-query vectorization lowers context cost (L3).
9. **T09** Split large prompts into approximately 12 source sections (L3).
10. **T10** Have reviewers extract structured outlines per section (L3).
11. **T11** Reconcile those outlines against the original prompt (L3).
12. **T12** Score or vote on competing interpretations (L3).
13. **T13** Explore aliases for related references and terms (L3).
14. **T14** Search files in a defined order of operations (L3).

### Team workflow and interface (T15–T24)

15. **T15** Build a task system with persistent status (L3).
16. **T16** Show live prompt and task intake in the Round Table UI (L3).
17. **T17** Have the project manager confirm intended outcomes with the user (L3).
18. **T18** Store 2D and 3D drawings as reference artifacts (L3).
19. **T19** Relate reference artifacts to the viewport/browser tree (L3).
20. **T20** Let the project manager propose small and large recovery options (L3).
21. **T21** Let the project manager recruit an agent only for instruction conflict (L3).
22. **T22** Also permit recruitment when condensing instructions saves time or cost (L3).
23. **T23** Split work into batches small enough to avoid overwrite or loop failure (L4).
24. **T24** Have Ledger monitor project-manager watchdog outcomes (L4).

### Diagnostics and learning (T25–T34)

25. **T25** Collect analytics samples for failures (L3).
26. **T26** Predict low-cost paths to linked history (L3).
27. **T27** Monitor CPU and memory spikes (L3).
28. **T28** Monitor token spikes (L3).
29. **T29** Experiment with database joins for investigation (L3).
30. **T30** Log AI-generated reports and bug investigations (L4).
31. **T31** Record which agent methods succeeded or failed (L4).
32. **T32** Store why a solution was attempted (L4).
33. **T33** Capture approval and disapproval against expected accuracy (L4).
34. **T34** Minimize unnecessary movement of existing features and behavior (L4).

### Research and sizing (T35–T44)

35. **T35** Research prompt compression and vectorization before building (L3).
36. **T36** Produce an MD or PDF research report in the editor (L3).
37. **T37** Research how models process books and video, without claiming access to Grok internals (L3).
38. **T38** Research public information about X/Twitter recommendation methods (L3).
39. **T39** Index two to three months of the user's text (L4).
40. **T40** Estimate raw and vector storage size (L4).
41. **T41** Assess whether Cursor logs fit in Supabase (L4).
42. **T42** Estimate embedding, storage, and query costs and alternatives (L4).
43. **T43** Document maximum data string sizes and API parameters (L4).
44. **T44** Test several small indexing approaches (L4).

### Knowledge and future integration (T45–T54)

45. **T45** Save prompt goals, must-haves, methods, and priority (L4).
46. **T46** Explore compact machine-readable agent communication and tradeoffs (L4).
47. **T47** Add a note to investigate Boardy AI or other external research paths (L4).
48. **T48** Consider asking external people or systems for ideas; posting requires a separate decision on content and destination (L4).
49. **T49** Track observable conversation sentiment and reactions, rather than claiming AI has feelings (L4).
50. **T50** Use a whiteboard to classify errors after the separately planned harness work exists (L4).
51. **T51** Compare controller training steps with robotics policies (L4).
52. **T52** Design debugger references around teleoperation observations (L4).
53. **T53** Define robot arm reach and constraints from the Open Arm 2.0 specifications and the user's measured setup (L4).
54. **T54** Create linked error records for failures discovered during task execution (L1).

## Feature inventory

1. Prompt intake, source preservation, and task ledger.
2. Stable reference IDs, aliases, and provenance graph.
3. Hybrid keyword, metadata, and semantic search.
4. Round Table task board and project-manager alignment.
5. Agent selection, reviewer votes, and watchdogs.
6. Incident reports, snapshots, and error classification.
7. Runtime cost and performance telemetry.
8. Knowledge base of attempted fixes and outcomes.
9. Drawing, viewport, VR, and robotics references.
10. Research and external feedback queue.

## Recommended execution order

**Phase 1: lossless intake.** Preserve the raw prompt and its hash. Extract tasks to a schema with `task_id`, `source_line`, `source_quote`, `intent_type`, `parent_goal`, `depends_on`, `status`, `acceptance_test`, and `owner`. Every task needs a source quote; every source request must map to a task or a documented exclusion. Confirm the total count before implementation.

**Phase 2: small batches.** Group tasks by dependency. Let each worker take three to seven tasks with the exact source references and acceptance tests. Require status `not_started | active | blocked | done | verified`. No worker may silently drop or renumber a task. The project manager reconciles the completed IDs after each batch.

**Phase 3: retrieval.** Start with exact ID, keyword, date, project, and feature filters. Add embeddings only for fuzzy discovery across old logs. Return short snippets with file, time, and message ID; fetch the original record before drawing a conclusion. Embeddings are a search index, not a compressed replacement for the source or the task ledger.

**Phase 4: verification.** For each task, record an observable test, evidence link, and result. Before closing a prompt, compare the original source spans with the ledger and count `verified + deferred + rejected + unresolved`; it must equal the extracted total. Audit any new tasks separately.

## Sizing from this machine

Read-only inventory on 2026-09-17 found 998 Cursor agent transcript JSONL files modified within 90 days, about 106.8 MB of raw files. Parsed message payloads were about 6.55 MB for 5,685 user rows and 100.3 MB for assistant rows. This is a local sample, not a complete inventory of every Cursor store or attachment.

At a rough 4 characters per token, 6.55 MB of user payload is around 1.6 million tokens before cleaning and chunk overlap. At 800 tokens per chunk, that is roughly 2,000 vectors. A 1,536-dimensional half precision vector is about 3 KB before database and index overhead, so vectors alone are roughly 6 MB. Embedding every assistant/tool transcript would be much larger and would add noise. Measure the cleaned corpus first.

For the first experiment, index only user requests, accepted decisions, golden snapshots, failure records, and final fixes. Keep raw JSONL in cheap source storage and structured metadata in SQLite or Postgres. Benchmark keyword-only, hybrid keyword + vectors, and a two-stage retrieval method against 30 real questions. Track recall of relevant source IDs, answer correctness, latency, token use, and cost.
