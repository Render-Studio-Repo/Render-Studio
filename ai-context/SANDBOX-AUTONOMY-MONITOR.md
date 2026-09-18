# Sandbox autonomy monitor

Job: `JOB-SANDBOX-AUTONOMY-MONITOR-20260918`

This repo now includes a file-backed sandbox autonomy monitor for Winstead Render Studio.

## Scope

- Default mode is **observe + receipt only**.
- The monitor never patches code, never opens a PR by itself, and never merges.
- When Sam explicitly enables `free_reign`, the monitor may write a **draft instruction file only** under `sandbox-sessions/autonomy/drafts/`.

No existing conference free-reign status surface or receipt tooling was present in this checkout, so this implementation is CLI-first and documents the operator path here instead of adding a new live UI surface.

## Source-of-record paths

- Config: `sandbox-sessions/autonomy/monitor.json`
- Hard stop file: `sandbox-sessions/autonomy/KILL`
- FAIL events: `sandbox-sessions/autonomy/events/<FAIL-id>.json`
- FIX receipts: `sandbox-sessions/receipts/FIX-<AREA>-YYYYMMDD-<slug>.json`
- Index: `sandbox-sessions/autonomy/fix-index.json`
- Draft instructions: `sandbox-sessions/autonomy/drafts/FIX-<AREA>-YYYYMMDD-<slug>.json`

## Guardrails

1. `KILL` present or `monitor.enabled=false` means **no-op**.
2. `monitor.free_reign=true` still never applies or merges anything. It only unlocks draft instruction file output.
3. The code can **create** `KILL`, but it never clears it. Reversal is manual: delete `sandbox-sessions/autonomy/KILL` yourself, then re-enable the monitor.

## CLI

```bash
node tools/autonomy/monitor-cli.mjs status
node tools/autonomy/monitor-cli.mjs init
node tools/autonomy/monitor-cli.mjs set-enabled true
node tools/autonomy/monitor-cli.mjs set-free-reign false
node tools/autonomy/monitor-cli.mjs trip-kill --reason "hard stop"
node tools/autonomy/monitor-cli.mjs inject-fail --input /tmp/fail.json
```

## Synthetic FAIL payload

```json
{
  "area": "workshop",
  "slug": "queue-desync",
  "symptom": "Queue row stays stuck in waiting after debug handoff.",
  "root_cause": "Queue state is not refreshed after local debug fallback.",
  "fix": "Candidate only - inspect backend/services/workshop_service.py refresh path.",
  "verify": "node --test tools/autonomy/monitor-smoke.test.mjs",
  "source": "autonomy-monitor"
}
```

## FIX receipt schema

```json
{
  "fix_id": "FIX-WORKSHOP-20260918-queue-desync",
  "was": "FAIL-WORKSHOP-20260918-queue-desync",
  "root_cause": "Queue state is not refreshed after local debug fallback.",
  "fix": "Candidate only - inspect backend/services/workshop_service.py refresh path.",
  "verify": "node --test tools/autonomy/monitor-smoke.test.mjs",
  "pointer": "sandbox-sessions/autonomy/events/FAIL-WORKSHOP-20260918-queue-desync.json",
  "source": "autonomy-monitor",
  "status": "candidate",
  "auto_eligible": false,
  "created_at": "2026-09-18T00:00:00.000Z"
}
```

## Smoke expectations

- `free_reign=false` + enabled monitor: FAIL event and FIX candidate are written, no draft instruction file is created.
- `KILL` present: no-op, no event, no receipt, no draft instruction.
- `free_reign=true`: still no patch and no merge; only a draft instruction file may be written.
