# Large-prompt intake: method, measurements, and accuracy audit

Date: 2026-09-17  
Source: `/Users/sam/.codex/attachments/b9688e8a-347b-42d1-a0aa-58dbb5dc6bb3/pasted-text.txt`  
Atomic request ledger: [large-prompt-intake-audit-2026-09-17.md](./large-prompt-intake-audit-2026-09-17.md)

## Direct answer

Yes, measure a prompt before deciding how to process it. Measure bytes, characters, token count with the *target model's tokenizer*, number of distinct requests, request density, and how much source space is available within the model's context budget. Size is a routing signal, not a guarantee of comprehension. A short, densely packed prompt can be harder to track than a much longer narrative.

## What I actually did for this prompt

1. Read the supplied text file in full.
2. Ran `wc` and a small Python check. The file has **5,192 characters**, **945 whitespace-delimited words**, **10 physical lines**, and **three substantive text blocks** on lines 1, 3, and 4. Line 7 is an incomplete sentence.
3. Read the blocks and manually separated requests from context, questions, policies, and the incomplete ending. I created **54 atomic request candidates**. This count depends on the splitting convention: a compound sentence may reasonably become one or several tasks.
4. Grouped those candidates into five audit sections and ten feature families. I wrote a source-line reference for each candidate and excluded the incomplete line.
5. Used a deterministic regex check to verify that IDs T01 through T54 appear exactly once and in order.
6. Separately inspected local Cursor transcript file metadata for a storage estimate. That was not used to extract the 54 tasks.

**I did not** calculate embeddings, create a vector store, compress the original into a replacement, delegate extraction to subagents, run a second independent model, or verify each task against exact character spans. The original file remains the source of truth. The audit document is a derived representation, not a lossless copy.

### Computed statistics

| Measure | Value | Interpretation |
| --- | ---: | --- |
| File characters | 5,192 | Exact Python `len()` of the text |
| Whitespace-delimited words | 945 | Exact `split()` count; not a tokenizer count |
| Complete substantive blocks | 3 | Lines 1, 3, 4 |
| Candidate atomic requests | 54 | Manual extraction convention |
| Candidate requests per 100 words | 5.71 | `54 / 945 × 100` |
| Average words per candidate | 17.5 | `945 / 54`; does not mean tasks are evenly distributed |
| Feature families | 10 | Broad architecture groupings |
| Distinct proposed capabilities | 28 | Enumerated below; excludes pure research questions and policy statements |
| Source-linked task IDs | 54/54 | Line-level only, not exact spans |
| Independent reviewer passes | 0 | No measured recall against a gold ledger |

## The 28 proposed capabilities

The counting rule here is: count a capability if it would require a persistent user-visible or agent-visible behavior, data model, or service. Do not count each research question or each implementation technique as a new feature.

1. **F01** Large-prompt intake skill.
2. **F02** Immutable prompt source store.
3. **F03** Persistent atomic task ledger.
4. **F04** Stable source/task/step provenance IDs.
5. **F05** Alias registry for names and references.
6. **F06** Hybrid keyword and semantic search.
7. **F07** Section-review and reconciliation workflow.
8. **F08** Interpretation scoring and voting.
9. **F09** Live Round Table prompt/task board.
10. **F10** Project-manager outcome alignment.
11. **F11** Conditional agent recruitment policy.
12. **F12** 2D/3D drawing reference store.
13. **F13** Viewport/browser-tree reference mapping.
14. **F14** Ordered file-search router.
15. **F15** Small/large incident recovery planner.
16. **F16** Analytics route-to-history predictor.
17. **F17** CPU, memory, and token telemetry.
18. **F18** AI report and bug-investigation log.
19. **F19** Fix-outcome knowledge base.
20. **F20** Approval and expected-accuracy feedback.
21. **F21** Project-manager watchdog audit.
22. **F22** Corpus storage and query-cost estimator.
23. **F23** Whiteboard error classification.
24. **F24** VR controller training traces.
25. **F25** Teleoperation observation mirror.
26. **F26** Open Arm 2.0 reach/constraint reference.
27. **F27** External research suggestion queue.
28. **F28** Observable conversation sentiment and reactions.

These are *proposed* capabilities found in the source; this audit does not claim they exist or were implemented.

## My accuracy score

**Provisional self-audit quality: 65/100.** This is a transparent process score, **not** a statistically measured probability that all 54 requests were found.

| Check | Earned / possible | Evidence |
| --- | ---: | --- |
| Raw source retained | 15/15 | Original attachment remains available |
| Size and density measured | 10/10 | Character, word, and density calculations recorded |
| Stable unique IDs | 15/15 | Regex verified T01–T54 exactly once |
| Semantic spot review | 15/20 | Manual reread; compound-item boundaries remain subjective |
| Source precision | 10/15 | Every item links to a line, none to an exact character span |
| Independent extraction | 0/15 | No separate reviewer or model |
| Gold-standard comparison | 0/10 | No user-confirmed exhaustive reference list |
| **Total** | **65/100** | Process quality only |

This score should not be called “65% extraction accuracy.” The true recall and precision are unknown. A clean sequence of 54 IDs proves only that the numbered output has no missing or duplicate ID numbers; it does not prove that the source had exactly 54 requests.

## A repeatable intake protocol for agents

### 1. Measure and preserve

Save the raw prompt with a cryptographic hash and immutable `prompt_id`. Count exact bytes, characters, target-model tokens, and source blocks. Do not replace the original with a summary.

### 2. Extract into a schema

```json
{
  "task_id": "T17",
  "prompt_id": "P20260917-001",
  "source": {"start_char": 1234, "end_char": 1289, "quote": "exact source excerpt"},
  "kind": "build|research|question|policy|future|incomplete",
  "capability_id": "F10",
  "parent_goal": "G03",
  "depends_on": [],
  "acceptance_test": "observable result",
  "status": "proposed",
  "owner": null
}
```

Require valid IDs, exact source substrings, and enumerated statuses. A structured schema prevents malformed records; it cannot prove semantic completeness.

### 3. Reconcile coverage

Review every clause of the raw source. For each clause, record one or more task IDs or an exclusion reason. Track overlap and duplicates explicitly. Do a second extraction pass that sees only the raw source, then compare the two ledgers. Human review settles disputed boundaries.

### 4. Batch work by dependency

Send three to seven independent tasks per worker with exact source excerpts, prerequisites, and acceptance tests. A worker returns completed IDs, evidence, questions, and new candidate IDs. The project manager merges results and checks the original ledger after each batch.

### 5. Retrieve evidence when needed

Use exact IDs, feature, date, project, and keyword filters first. Use embeddings for fuzzy historical discovery. Search results are pointers; fetch the original message before attributing a cause or marking a task done. For cross-sentence links, store explicit edges such as `depends_on`, `duplicates`, `contradicts`, and `proved_by`.

### 6. Verify closure

For each task, require evidence and an acceptance-test result. Compute:

```text
ledger_total = verified + deferred + rejected + unresolved
recall = correctly_extracted_gold_tasks / all_gold_tasks
precision = correctly_extracted_gold_tasks / all_extracted_tasks
F1 = 2 * precision * recall / (precision + recall)
```

The ledger-total equation catches dropped *known* tasks. Precision and recall require an independent gold ledger. Add new tasks under new IDs; never silently overwrite an old record.

## How to predict another model's performance

**Context-window size alone does not predict extraction accuracy.** For this source, request density and clause ambiguity are more likely bottlenecks than raw length. Long-context research also shows that relevant information can be missed depending on where it appears in the input.

To compare Grok or another model, run the same 30–50 annotated prompts at several lengths and densities. Put some requests near the beginning, middle, and end. Record per-task recall, precision, exact source-span match, dependency accuracy, latency, tokens, and cost. Fit a model only after collecting labels, using inputs such as:

- `input_tokens / usable_context_tokens`
- atomic requests per 100 words
- nested/dependent request count
- proportion of requests in the middle of the prompt
- chunk overlap and number of review passes
- use of retrieval and exact source references

Until such a benchmark exists, report an **uncalibrated risk estimate**, not a claimed accuracy percentage for another model. A model with a larger advertised context window may still miss a densely packed middle clause.

## Source material for the method

- [Lost in the Middle, original research](https://aclanthology.org/2024.tacl-1.9/)
- [RULER long-context benchmark](https://arxiv.org/abs/2404.06654)
- [OpenAI vector-store search API](https://developers.openai.com/api/reference/python/resources/vector_stores/methods/search)
- [Official OpenAI model guidance on structured output](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.5)
