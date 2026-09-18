# Render QA loop — receipts, fail packs, and Harness wake

This workspace now emits fail-closed render QA receipts from the backend render paths.

## What is emitted

- `RCPT-RENDER-*` receipt JSON under `sandbox-sessions/receipts/`
- `sandbox-sessions/receipts/latest.json` updated on every render QA emit
- `sandbox-sessions/receipts/pm-chart-feed.json` with receipt-only facts (`receipts: []` when empty; never invent scores)
- `FAIL-RENDER-*` fail packs under `sandbox-sessions/render-qa/fail-packs/` when any gate blocks green
- per-log binding/evidence files under `sandbox-sessions/render-qa/logs/`

## Gate policy

Green requires every gate to pass:

1. `IDENTITY` — render artifact and source mesh/CAD hash are both bound
2. `UPRIGHT` — explicit Z-up evidence is present
3. `FRAMING` — request capture and render output both carry usable framing evidence
4. `USER` — explicit approval signal is present

The loop is intentionally fail-closed. Missing up-axis, framing, or user approval data blocks green rather than guessing.

## Repair loop shape

On failure the emitted fail pack declares this sequence:

1. structured FAIL pack for Code Bot
2. max 3 repair attempts
3. CAD re-gate after each attempt
4. escalate after attempt 3 or any still-missing evidence

Current status:

- emit path: implemented
- receipt/feed/fail-pack writes: implemented
- Workshop ingest hook POST: implemented when `RENDER_STUDIO_WORKSHOP_INGEST_URL` (or alias env) is set
- automated Code Bot submit: TODO
- automated CAD re-gate submit: TODO
- automated escalation transport: TODO

CAD does **not** write back into project render paths as part of the repair loop. Any follow-up notes belong in sandbox/KB artifacts only.

## Harness wake note

```text
HARNESS_WAKE UPDATE_RECEIPT
receipt_id=<RCPT-RENDER-*>
latest_path=sandbox-sessions/receipts/latest.json
chart_feed_path=sandbox-sessions/receipts/pm-chart-feed.json
fail_pack_path=sandbox-sessions/render-qa/fail-packs/<FAIL-RENDER-*>.json
rmq=rmq-1789711555
```
