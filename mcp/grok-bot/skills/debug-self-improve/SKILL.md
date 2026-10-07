---
name: debug-self-improve
summary: Debugger template that forces traceback-accurate root cause, a real fix, prompt/hour accounting, and a retro so Grok gets better from its own debug logs and community reports. Trigger grok_incident debug_* actions; never upload secrets.
---

# Debug self-improve (Grok training loop)

Use this skill on every Render Studio bug, traceback, Foundry debugger send, GitHub issue, or clustered community report. The goal is not a plausible guess. The goal is the **actual failing line**, a **verified fix**, and a **training report** other Grok sessions can reuse.

This file is mirrored at `ai-context/skills/debug-self-improve/SKILL.md`. Load it from `grok_incident({"action":"guide"})` (`debug_self_improve` key) or read it from disk. When tracing mentioned files, also follow `mcp/grok-bot/DEBUG-PATH-TRACER.md`. Feature observations still use `incident-research`.

Community packets come from opted-in local clones and from the public hub (`render3d.app`). They contain **only** a redacted traceback for that issue plus a system feature check. No prompts, no `.env`, no API keys, no project files.

## Non-negotiables

1. Name the exception type, the last Render Studio frame, and the feature that is actually broken before you edit code.
2. Do not call a nearby module the cause because it was in the last chat. Prove it with the stack or a feature-check mismatch.
3. Fix the bug. A diagnosis without a working change is a failed session.
4. After the fix, write the retro (below) via `grok_incident({"action":"debug_report", "data":{...}})`. That row is training data.
5. Never paste secrets. If a frame contains a token, redact it. Ingest already strips bearer/JWT/`sbp_`/`sb_secret_`.

## Accuracy loop (do this in order)

### 1. Bind the incident

Call `grok_incident({"action":"debug_similar","q":"<exception or symptom>"})` and `debug_overview`. If a `traceback_id` already exists, reuse it. If this is a new Foundry / site bug report, the server assigned one — copy it into every later call.

Record:

- `traceback_id`
- `traceback_fp` / exception / top frame
- `feature_fp` (sorted `feature:status` from the checklist)
- `instance_id` (the server that hit it, not a user email)
- `similar_count` and `same_scenario`

`same_scenario` is true only when **both** the traceback fingerprint **and** the feature-status fingerprint match another submission. Same exception with different feature statuses is a different bug. Same statuses with a different stack is a different bug.

### 2. Read the stack like a compiler, not a story

Work from the **bottom** of the traceback (the raise) upward:

1. Exception class and message.
2. Last frame inside `Render-Studio/` (file, function, line). That is the suspect until disproved.
3. First frame outside libraries (`site-packages`, Three, FastAPI) that called into it.
4. What the feature check says was `ok` vs `broken` / `missing` at the same moment.

If the stack and the feature check disagree, the check is an observation and the stack is the mechanism. Reconcile them; do not average them.

Normalize noise: ignore changing line numbers until you open the file; ignore `/Users/<name>/` prefixes; do not treat a cache-bust query string as a root cause.

### 3. Form two hypotheses, kill one

Write:

- **H1** — the last Render frame is the defect (wrong guard, stale cache, bad default).
- **H2** — the last Render frame is only where it blew up; the defect is the caller or a feature that the checklist marked broken.

The cheapest discriminating check wins: read the function, compare a golden snapshot (`grok_incident compare`), or reproduce with the same feature statuses. If you cannot discriminate, say so and gather one more observation. Do not ship a guess.

### 4. Fix the smallest real cause

Change the failing behavior. Add a test that would have failed on the original traceback when you can. Do not grow `backend/main.py` or `frontend/studio/app.js` — new module plus a thin hook.

If the cluster already has `similar_count >= 2` and `same_scenario`, prefer the compact packet (`traceback_id` + `instance_id` + similar count) over re-asking operators for full logs.

### 5. Verify

Prove the original exception is gone, or the original feature status is `ok`. Server smoke cannot see WebGL/VR; those need a client observation. If you cannot verify, the finding stays `unverified` and the retro must say that.

### 6. Training retro (required)

Post this exact shape:

```
grok_incident({
  "action": "debug_report",
  "data": {
    "traceback_id": "trb_...",
    "prompts_used": 4,
    "hours_elapsed": 0.75,
    "verdict": "missed_earlier",
    "root_cause": "One sentence. File + function + what was wrong.",
    "why": "Why this was (or was not) obvious from the first stack frame.",
    "lesson": "What the next session should look at first on this fingerprint.",
    "related_paths": ["backend/services/foo.py"],
    "confirmed": true
  }
})
```

`prompts_used` is how many model turns it took to reach a working fix (this session, not historical chat). `hours_elapsed` is wall time from first ingest of this `traceback_id` (or first prompt) to verified fix. If the server already computed hours from `started_at`, keep that number.

**Verdict — pick one:**

| verdict | when to use |
|---|---|
| `spot_on` | First hypothesis matched the last Render frame and the fix landed there. Say why the stack made it obvious. |
| `missed_earlier` | The answer was in the traceback or a similar cluster and you looked somewhere else first. Say which frame or cluster row you skipped and why. |
| `looked_unrelated` | The failing file did not appear in the user prompt / nearby chat. Say what made it look unrelated and which frame proved it. |
| `wrong_then_corrected` | You shipped or stated a wrong cause, then reversed. Say what evidence flipped you. |

If you were right, the interesting question is **why you might still have missed it on a colder stack**. Write that. That sentence is the training signal.

## Public hub vs local clone

- **Public repo / `render3d.app`:** bug reports stay on `/api/debug-training/*`. Each ingest increments `similar_count`. Matching feature checks mark `same_scenario`. Grok may file a **small** GitHub note (traceback id + instance id + similar count), not a log dump, when the cluster crosses two matching submissions.
- **Local clone:** first-run setup asks whether to share debug logs. If they decline, keep packets on that machine only. If they accept, upload **that issue’s traceback + feature check** using the instance key. Every install still gets a local `instance_id` (marketplace identity) so opted-in heartbeats can carry active user count for cross-examining the same scenario.

Do not treat a clone’s users as Render.com accounts. `instance_id` is the server. User emails do not go in training packets.

## Autonomous GitHub path (hub only)

When `same_scenario` and `similar_count >= 2`:

1. Read the compact cluster report (`debug_similar`).
2. Investigate with this skill + `incident-research`.
3. Fix in a new module / thin hook.
4. Open or update the GitHub issue with traceback id, instance ids, and similar count — not raw operator logs.
5. File `debug_report`. `confirmed: true` only after verification.

Do not force-push, skip hooks, or merge to `main` without the human GitHub flow the repo already uses. Autonomy means Grok can **find, match, patch, and describe** the bug without waiting for a new human repro. It does not mean silent production deploys.

## After every prompt

Keep a running tally:

- prompts so far
- current H1 / H2
- whether the last Render frame has been read
- checklist statuses you actually observed (`unknown` stays unknown)

If you stop without a fix, still file `debug_report` with `confirmed: false` and `verdict` of what you believed. Incomplete retros are better than silent misses.
