# Research method for debugging context

This design extends the existing Render Studio `incident-research`, `debug-self-improve`, and `prompt-trace` workflows. It specifies a research method and a monitor contract; installing the skill alone does **not** start a background monitor or change model weights.

## 1. Evidence model

Represent each observation as `{id, kind, observed_at, source_uri, source_hash, prompt_id, snapshot_id, commit, environment, feature_ids, payload_ref, reliability}`. Keep immutable raw prompts, tracebacks, snapshots, and VR traces in storage. Put only compact citations in model context. Separate a user's report, a client measurement, a server measurement, an agent hypothesis, and a confirmed test result; they have different reliability. `unknown` is a value, never an implicit `ok`.

The investigation is a graph:

- **Nodes:** prompts, commits, snapshots, feature checks, tracebacks, movement events, hypotheses, tests, fixes.
- **Edges:** `occurred_before`, `changed`, `tests`, `supports`, `contradicts`, `depends_on`, `reproduced_in`.
- IDs give identity; hashes detect changed content; timestamps place observations in a window. Embeddings nominate related text but cannot prove identity or causation.

For VR, record device ID, button edge (`down`/`up`), action dispatch, target object, tool mode, and pose change only when a threshold is crossed or at a low-rate keyframe. Quantize position and orientation to the precision needed for a repro. Preserve event order and monotonic timestamps. A raw 90 Hz movement stream is usually too costly for context and can hide the button-routing failure.

## 2. Context budget algorithm

First reserve tokens for the current request, feature contract, last observed `ok`, first observed failure, changed artifacts, and direct contradictions. These mandatory items cannot be displaced by a similarity score. Then select optional evidence items under remaining token budget `B`.

For candidate `i`, estimate:

- `r_i` = relevance to the specific question, 0–1, from keyword/vector retrieval followed by source verification.
- `p_i` = provenance quality, 0–1. Direct instrumented test > contemporaneous log > unverified memo.
- `t_i = exp(-|time_i - incident_window| / τ)` for events near the boundary; use `1` for timeless contracts. `τ` is tuned on held-out incidents.
- `n_i` = novelty, 0–1, reduced when nearly identical evidence is already selected.
- `d_i` = expected ability to distinguish current hypotheses, 0–1.
- `c_i` = token cost after safe summarization.

Greedily add the item with highest `U_i/c_i`, where `U_i = 0.25r_i + 0.25p_i + 0.15t_i + 0.15n_i + 0.20d_i`, until the budget is spent. Keep at least one item from each relevant source type to avoid all context coming from one log. These starting weights are design parameters, **not calibrated truth**; compare variants on held-out cases. Reopen cited originals whenever the compressed item is used to justify a conclusion.

After each new observation, update the graph and replace stale optional context. Do not repeatedly append summaries; that compounds omissions. The active context is a view over versioned records, while the full evidence ledger remains outside it.

For hypothesis `H` and evidence `E`, use a likelihood ratio only if empirical rates are available: `posterior_odds(H) = prior_odds(H) × Π P(E_j|H)/P(E_j|¬H)`. Correlated logs must not be multiplied as independent evidence. Without calibrated likelihoods, rank hypotheses qualitatively by predictions and discriminating tests; do not manufacture a posterior probability.

## 3. Iterative agent research loop

Roles can be concurrent agents if the environment allows, or distinct sequential passes with separate outputs:

| Role | Input | Output | Leakage boundary |
| --- | --- | --- | --- |
| Intake | Original request and log IDs | Atomic task/feature ledger with source spans | Does not see answer key |
| Investigator | Evidence ledger and last-good/first-bad window | Two or more hypotheses, predicted observations, next test | Does not see held-out outcome |
| Skeptic | Hypotheses and source citations | Missing evidence, alternative causes, collateral risk | Does not inherit investigator's confidence |
| Test runner | Patch or sandbox candidate and feature contract | Repro, targeted and full smoke results, environment | Records instrumented results, not prose grades |
| Adjudicator | All outputs plus sealed ground truth when available | Gate, score, errors, fix-card status | Does not edit the candidate answer |

Use a training set of historical incidents and synthetic counterexamples, then a separate held-out set by **incident family and time**. Do not place near-duplicate versions of the same VR trigger incident on both sides. Each iteration: sample an incident; freeze its evidence at the chosen time; run roles; collect observable decisions and timestamps; adjudicate; label the earliest wrong assumption; add a corrected fix card; revise retrieval, prompts, or tests; rerun the held-out set. Preserve the old scores so improvement is measurable. Retrieval and prompt revisions teach the workflow; fine-tuning is a separate process requiring an explicit training dataset and weight update.

Useful metrics: task omission rate, unsupported-cause rate, correct next-test rate, time to contradiction detection, time to verified recovery, false-confirmation rate, and new critical regressions. Report numerator, denominator, and excluded `unknown` cases. For a binomial pass rate, report a Wilson 95% interval rather than a bare percentage. A zero observed regression rate over `n` independent cases still has an approximate 95% upper bound of `3/n`; it is not proof of zero risk.

## 4. Fix validity score

Use **gates before scores**. A fix is `confirmed` only when:

1. The original failure was reproduced on a documented pre-fix version or a reliable failing snapshot exists.
2. The same feature passes in the same environment after the candidate fix, with an objective check.
3. All mandatory feature checks for the changed dependency area pass; no observed new `broken` or `missing` state is present.
4. The patch/version and test evidence are linked, and the test runner did not merely repeat the agent's assertion.

If a critical check fails, status is `rejected` regardless of numeric score. If a mandatory check cannot run, status is `unverified`. Passing checks can never prove all possible behavior; record test scope and environment.

For candidates that pass gates, define each component in `[0,1]`:

- `C` objective resolution of the original symptom across required reproductions.
- `R` proportion of required regression checks that pass, weighted by criticality; missing mandatory checks fail the gate.
- `H` causal support: prediction made before test and observed discriminating result, with alternative hypotheses considered.
- `P` reproducibility: another run/environment follows the recorded steps and gets the same result.
- `E` evidence quality: source-linked records, version IDs, independent measurements, and complete coverage.

`score = round(100 × (0.30C + 0.25R + 0.20H + 0.15P + 0.10E))`.

Show component values and evidence IDs. A `92` is a rubric score, **not a 92% probability of correctness**. Calibrate score bands by comparing historical scores with later regressions; if 80–89 candidates often fail, change the rubric or gate rather than relabeling failures. Use a separate safety summary: `critical_regressions=0 observed`, `checks_run=N`, `checks_unknown=M`, and the exact feature IDs.

## 5. Repeatable fix card

```json
{
  "incident_id": "inc-vr-001",
  "feature_id": "vr.controllers.trigger",
  "status": "unverified",
  "last_working": {"snapshot_id": "snap-123", "commit": "abc123", "time": "..."},
  "first_failing": {"snapshot_id": "snap-124", "commit": "def456", "time": "..."},
  "environment": {"browser": "...", "headset": "...", "kernel": "..."},
  "reproduction": ["Open build X", "Press right trigger with tool Y"],
  "expected": "button.action.select fires once",
  "observed_before": "input edge arrives; action does not fire",
  "cause_claim": "Overlay intercepts the dispatch path",
  "supporting_evidence_ids": ["trace-1", "test-overlay-off-1"],
  "rejected_hypotheses": [{"claim": "kernel changed", "contrary_ids": ["snap-123", "snap-124"]}],
  "patch_ref": "commit-or-diff-id",
  "observed_after": "...",
  "feature_checks": {"vr.controllers.trigger": "ok", "viewport.models": "unknown"},
  "score_components": {"C": 1, "R": 1, "H": 0.8, "P": 0.5, "E": 1},
  "rollback_ref": "snap-123",
  "unresolved": ["Standalone headset not checked"]
}
```

Store this card next to immutable test results, not as a replacement for them. Only confirmed cards become positive retrieval examples; rejected cards remain useful negative examples.

## 6. Monitoring after every new AI prompt

The monitoring contract is event-driven. A prompt or patch event carries `prompt_id`, `parent_snapshot_id`, `new_commit`, changed paths, changed runtime/config values, and task IDs. The monitor maps changed artifacts to feature IDs through a maintained dependency graph, runs targeted checks plus critical baseline checks, and writes status events. Compare only like environments and distinguish `viewport.boot`, `viewport.models`, `webgl.context`, `vr.controllers.trigger`, and `button.actions`.

`new failure = baseline(feature)=ok AND current(feature)∈{broken,missing}` with both statuses **observed**. Also alert on a previously known feature disappearing from the feature registry. Include last-good and first-bad snapshot IDs, the first failing prompt/commit window, and an exact log path in the alert. If a check is unavailable, emit `unknown` and schedule a client check; never silently carry forward `ok`.

Use a periodic full smoke suite to detect dependency-graph omissions. Update the baseline only from an explicitly accepted golden snapshot or verified green run. A prompt that changes no code can still affect configuration or data, so include those event types. A text-only prompt with no applied change does not itself prove a regression.

This contract can be implemented through the existing checklist, compare, prompt-trace, and debug-training endpoints. An always-on listener and client VR/WebGL harness require separate integration work; the skill cannot start them by itself.

Minimal listener logic:

```text
on applied_prompt_or_patch(event):
    before = load_last_observed_baseline(event.project_id, event.environment)
    impacted = dependency_graph.features_for(event.changed_paths,
                                             event.config_changes,
                                             event.data_changes)
    checks = impacted ∪ critical_smoke_checks
    after = run_available_checks(checks, event.new_commit, event.environment)
    for feature in checks:
        save_observation(event.prompt_id, feature, after[feature])
        if before[feature] == "ok" and after[feature] in {"broken", "missing"}:
            alert(feature, before.snapshot_id, after.snapshot_id,
                  event.prompt_id, exact_log_path)
        if after[feature] == "unknown":
            queue_required_client_check(feature)
    if all_mandatory_checks_observed_and_green(after):
        offer_verified_baseline(event.new_commit, after)
```

The listener should consume an **applied change** event, not every conversational message. A prompt ID still links the change to the chat. Checks must run against the same build and environment named in the event; otherwise the comparison is inconclusive.
