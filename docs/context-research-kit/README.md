# Context research kit

This ZIP is a design and runnable local example. It does not install a live listener or apply SQL. Run SQL on a staging Supabase project first. The repository already has incident, prompt-trace, and debug-training endpoints; connect these examples to those APIs only after checking current auth and client test coverage.

## Contents

- `skills/`: Codex and Grok research agent instructions, plus the earlier prompt-vector skill.
- `research-method.md`: context selection, evidence graph, fix score, learning loop, and post-change monitoring contract.
- `prompt-vector-api.md`: chunking and vector search prototype guide.
- `schema.sql`: private-by-default Supabase tables for source documents, chunks, observations, evidence, hypotheses, votes, runs, fix cards, and alerts.
- `index-watchlist.md`: ingestion and retrieval integrity checks, thresholds to monitor, and actions when an index is stale or corrupt.
- `watchdogs.py`: pure-Python checks for hashes, spans, environment match, feature regressions, and stale or missing evidence.
- `five_agent_vote.py`: deterministic order, candidate elimination, evidence gates, and weighted votes. It does **not** call five LLMs; provide their structured outputs.
- `example_case.json`: synthetic VR trigger case. Nothing here operates on production.

## Local examples

```bash
python3 watchdogs.py example_case.json
python3 five_agent_vote.py example_case.json
```

For the live system, trigger the monitor from an **applied prompt/patch event**, not a chat message alone. Store `prompt_id`, commit, environment, last-good snapshot, first-bad snapshot, source hashes, and checked feature IDs. Treat WebGL, VR controls, and model visibility as separate client checks. If a required check cannot run, keep the candidate `unverified`.

The database schema uses 1536 dimensions to match this repository's current `text-embedding-3-small` usage. Vectors are for candidate retrieval; original text plus span/hash fields provide exact citations. Changing embedding model or dimensions requires reindexing. The SQL gives no direct access to `anon` or `authenticated`. Use a server-side privileged connection with a narrow API and explicit authorization checks; never put a privileged key in a browser.

## Five-agent order

1. **Intake:** identify failing feature and immutable evidence IDs; vote only on whether the question and boundaries are sufficiently defined.
2. **Investigator:** propose competing causes and a discriminating test.
3. **Skeptic:** find contradictions and likely collateral effects before seeing later votes.
4. **Test runner:** execute the reproduction and feature checks in a sandbox; emit observed results and environment.
5. **Adjudicator:** apply the hard gate, score the surviving proposal, and write the fix card.

Each role submits `support`, `reject`, or `abstain` with evidence IDs. The weighted tally is only a prioritization signal. A majority cannot override a failed mandatory test or absent before/after evidence. `five_agent_vote.py` demonstrates that rule with a planted, unsupported kernel hypothesis and a testable overlay hypothesis.

The example computes `V = Σ w_role × vote`, with vote values `+1, -1, 0` and weights `1, 1, 1, 2, 1` in role order. `V > 0` prioritizes a candidate only after its prediction is observed. A contradictory observation eliminates it regardless of `V`. The final status is confirmed only after independent before/after facts, a patch reference, all mandatory checks, and no critical watchdog finding. This is deterministic code; role prompts create candidate claims and evidence references, not the acceptance rule.

The synthetic example and its truth fixture are bundled for demonstration. During a real evaluation, keep the sealed truth file and adjudicator result outside the investigator's context. Record events with a separate harness, since self-reported timestamps and test results are easy to fabricate.

## Why elimination works

Begin with a set of hypotheses. For each, state an observation it predicts. Remove a hypothesis when a reliable observation contradicts that prediction; retain untested hypotheses without pretending they are false. In the example, a kernel-switch hypothesis predicts a K3 observation, but both snapshots say K2, so it is eliminated. The overlay hypothesis predicts a different action-routing result when the overlay is disabled; that remains testable. Votes identify which test to run first, while observations decide whether the hypothesis survives.
