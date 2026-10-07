---
name: context-research
description: Research long debugging histories, select evidence under a context budget, design competing tests, and score a proposed fix against feature regressions. Use for multi-step Render Studio incidents and post-prompt monitoring.
---

# Context research agent

Use this skill when an incident crosses prompts, snapshots, code changes, device movement, or multiple feature checks. This is the research layer for `incident-research`, `debug-self-improve`, and `prompt-trace`; use their existing APIs and logs. Read [the algorithm and record format](/Users/sam/Render-Studio/docs/context-research-method.md) when you need formulas, sample selection, or a score.

## Procedure

1. Fix the investigation question and name the failing feature, last observed working snapshot, first observed failing snapshot, and affected environment. Mark missing boundaries `unknown`.
2. Build an evidence ledger from prompt IDs, source spans, code commits, runtime and kernel IDs, feature checks, tracebacks, and compact movement events. Each item needs ID, time, provenance, reliability, and token cost. Preserve raw records outside the model context.
3. Select context with the budgeted evidence algorithm in the reference. Always include the user request, current feature contract, last working and first failing observations, the changed artifact list, and contradictions. Use vectors to nominate candidates; reopen source before citing them.
4. Write at least two causal hypotheses and what each predicts. Compare them using observed evidence and the cheapest discriminating sandbox test. Do not treat a prompt occurring before a failure as proof that it caused it.
5. Ask a separate review role to find unsupported assumptions and likely collateral effects. A test role runs the reproduction and impact-based feature checks. Roles may be separate agents when available, or sequential passes with separate records; never imply an independent check occurred if it did not.
6. Score only observed evidence using the reference gate and rubric. A passing claim requires the original failure reproduced before the fix, resolved after it, and no observed regression in mandatory checks. Unchecked features stay `unknown`; a high numeric score cannot override a failing gate.
7. Save a reproducible fix card: before/after version and snapshot IDs, exact reproduction, cause evidence, patch reference, tests and environments, feature matrix, unresolved risks, and rollback path. Feed confirmed cards into retrieval and future evaluation. Do not call this model training unless weights were actually updated.
8. On each new code-changing prompt, record its prompt ID and changed files, choose tests from the feature dependency graph, compare against the latest observed baseline, and raise an alert on a new `broken` or `missing` result. Run periodic full smoke checks to catch incomplete dependency mapping. Browser, WebGL, and VR checks require real client observations.

## Stop and report

Report `unverified` if you cannot reproduce or observe the relevant device/client state. Report `blocked` if a required test cannot run. Do not promote a fix card to confirmed from a written explanation alone. Never execute a proposed repair against production just to score it.
