# Ops + debugger root — **read this before any automation writes**

Cursor automations, watchdogs, PR bots, and agents **must read this file first**. Runtime notes live here. This is not a second Documents copy.

Root: `ai-context/ops/`

## How to upload / write

1. **Read this README.** Then open the matching folder README.
2. Write **one miniaturized note** (≤ 8 lines, ≤ 1.5 KB). No dumps, no full traces, no screenshots unless asked.
3. Filename: `YYYYMMDD-HHMM-<slug>.md` (UTC).
4. Put the file in the **correct folder** (table below). Activity / PR run logs go in that folder’s `logs/`.
5. Call prune after write (`ops_log_service.prune` or the skill). **Most logs are temp.**

**Do not write** unless it is:

- a **critical** issue the user named (bug, leak, crash, data loss), or
- a **disruptive** spike (perf, cost, failed generations), or
- something the **automation prompt** marked as important.

Skip chatter, healthy heartbeats, and routine “all clear.”

## Folder map

| Folder | Write when |
|--------|------------|
| `VR-Debuggers/` | Quest / WebXR **critical** only |
| `Editor-debugger/` | DESIGN / editor **critical** only |
| `Wiring-simulator-logs/` | Wiring sim **critical** only |
| `Activity-monitor/` | Disruptive activity; prune aggressively |
| `Activity-monitor/logs/` | Temp run ticks (auto-deleted) |
| `PR-automated-reviews/` | Accepted / rejected PR notes |
| `PR-automated-reviews/logs/` | Temp review ticks |
| `Possible-bugs/` | Confirmed or user-reported bugs |
| `Possible-virus-threat-files/` | Suspect files (name + why, not binaries) |
| `debugger/` | **Required on every GitHub push** — one short note if anything critical shipped; otherwise keep `.gitkeep` |

## Prune rules

- Temp (`logs/`, heartbeats): keep **20** newest, drop after **48 hours**.
- Activity / VR / editor / wiring notes: keep **30–40** newest; drop after **7 days** unless `keep: critical`.
- `keep: critical` skips the time prune but still counts toward the folder cap (noisy watchdogs cannot fill disk).
- Bugs / virus / debugger: keep until a human deletes, with a **safety cap** (80 / 40 / 40). Still **miniaturize**.
- Never grow a file in place — new file or replace a one-liner.
- App startup and the watchdog loop both call `prune_all`.

## Automations / watchdogs

Workspace **Automation** triggers write here (usually `Activity-monitor/` or `Possible-bugs/`). They must honor this README. See `SKILL.md` and `DEVELOPER.md`.

## Related

- [ACCEPTED-BETA.md](./ACCEPTED-BETA.md) — bot-accepted beta vs **master**
- [DEVELOPER.md](./DEVELOPER.md) — humans
- [SKILL.md](./SKILL.md) — agents + downloaded repos
- Backend skill copy: `backend/skills/ops-debuggers/SKILL.md`
