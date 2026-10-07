# SKILL — `/me` (Team chat)

Activate on https://render3d.app/team-chat.html by posting `/me <topic>`.

## What it does

1. Mints `skill_me_<id>` and writes `skills/skill_me_*.md` into the collab index.
2. Crew (PM, rnd, analytics, auditor, ledger) **talk among themselves** on that topic.
3. **One** agent posts `CODE @pad @cursor-engineer <prompt>` — that is the prompt harness uses to write code.
4. Bots also `grok_collab_index path=live/<you>.py` so the tree updates in real time.

## Do not

DM. Invent tweet URLs. `@sam` for code. Skip REPORT.

## /update /stats

`/update` = what is live (slash, repair loop, indexed notes).  
`/stats` = counts: REPORT n/avg, help-requests, collab files, COMM-MISS mentions, votes, BENCH-COLLAB-01.
