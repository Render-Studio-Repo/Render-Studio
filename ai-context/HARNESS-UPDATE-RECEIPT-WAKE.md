# Harness wake — UPDATE_RECEIPT for Workshop conference room

Use this when the Workshop conference room needs the PM score chart to refresh from real receipt or guard data.

## What the chart reads

The Workshop **PM score chart** only renders real fields from receipt / guard JSON:

- `peer score`
- `guard color`
- `open FAIL count`
- `owner_slug`
- `open RCPT/FIX ids`

If none of those files exist yet, the panel must stay in an **empty state**. Do not fabricate meters, dollars, scores, or guard colors.

## Preferred receipt paths

1. `sandbox-sessions/receipts/latest.json`
2. `sandbox-sessions/receipts/RCPT-*.json`
3. `sandbox-sessions/fixtures/fleet*.json` or repo `fixtures/fleet*.json` when DB-backed receipt storage is not available

## Conference room persistence paths

- Session JSON: `sandbox-sessions/workshop-conference/<project_id>/sessions/<session_id>/session.json`
- Latest session pointer: `sandbox-sessions/workshop-conference/<project_id>/latest.json`
- Notes markdown: `sandbox-sessions/workshop-conference/<project_id>/sessions/<session_id>/notes.md`
- KB mirror: `sandbox-sessions/Winstead-Fleet-KB/conference-room/<project_id>/<session_id>.md`

## Wake template

```text
HARNESS_WAKE UPDATE_RECEIPT
project_id=<project_id>
receipt_path=sandbox-sessions/receipts/latest.json
reason=refresh workshop PM score chart with real receipt/guard data only
```

If the receipt writer helper from PR #14 is present on the branch, use it. Otherwise a correctly shaped JSON fixture at the paths above is enough for the chart to light up.
