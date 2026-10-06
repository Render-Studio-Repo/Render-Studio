# Live VR controls (`xrctrl2`)

Headset **does not restart the page**. While an XR session is up it polls:

- `GET /mcp/sandbox/controls`
- fallback `GET /api/xr/control-config`

Changing `profiles` / `simulate` / `listen` updates `selectstart`, squeeze, and UI bindings in the **current** session.

## Simulate sandbox controls

The Sandbox chrome button **Simulate sandbox controls** sets `simulate=true` (same idea as Enable swap). The session uses this sandbox profile immediately. With **listen** on (default), JSON edits apply on the next poll (~800ms).

This overlay does **not** write Sam’s production scene map.

## Wire to my scene

Round Table **Debugger** mode suggests fixes from control notes (trigger / squeeze / DimOS overlay / grab / window distance). **Wire scene** queues `xr.controls.wire_scene` as `pending_approval` — same Approve/queue as debugger `ask_safe`. Nothing auto-applies.

Sam Approves with `PUT /api/xr/control-wire/{id}` `{ "action": "approve" }`. Then the next poll sets `apply_scene` and persists the map.

## Notes

Success/fail attempts live in `frontend/sandbox/control-notes.jsonl` and `data/xr-control-live/notes.jsonl`. Prior: trigger miss (`selectstart`), DimOS overlay steal, grip-only, windows too far. Successes: poll `buttons[0]`, UI beats overlay, squeeze-or-trigger grab, near-head windows.
