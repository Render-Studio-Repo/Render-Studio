# Workshop training capture wake note

The MVP training-capture path writes sandbox-only artifacts:

- session folders under `sandbox-sessions/training-captures/`
- fleet-compatible receipts under `sandbox-sessions/receipts/`
- KB mirror rows under `sandbox-sessions/Winstead-Fleet-KB/`

Use the existing `tools/receipts/update-receipt.js` shape when a PM or harness wants to re-materialize or inspect a receipt payload locally.

## Wake block

```text
HARNESS_WAKE TRAINING_CAPTURE
receipt_id=<RCPT-TRAIN-...>
kb_index_path=sandbox-sessions/Winstead-Fleet-KB/index/training-captures.json
media_pointer_path=sandbox-sessions/training-captures/<date>/<session-id>/media-pointer.json
```

## Notes

- This MVP does **not** invoke on-headset VLA or live arm control.
- The emitted media artifact is currently a sandbox **placeholder clip path** plus an `action-controller-log.json` stub.
- The latest receipt mirror is always `sandbox-sessions/receipts/latest.json`.
