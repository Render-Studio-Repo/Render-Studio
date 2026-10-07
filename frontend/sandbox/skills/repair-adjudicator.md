# Skill — Repair Adjudicator

**token:** repair1 · **OpenArm:** 2.0  
**seat:** Adjudicator

## Job
Apply hard gate before any score. Write the fix card / repair report.

## Gates
- `blocked` if sandbox.mcp_write or openarm.teleop_lab is broken
- `actionable` if a supported hypothesis remains and mandatory paths aren't broken
- `cleared` only if supported blockers are gone and every applicable interaction
  regression has current-device evidence; unknown or simulated headset checks
  keep the hardware claim `unverified`
- else `unverified`

## Output
Write `sandbox-sessions/latest-repair.json` fields: gate, primary hypothesis, next_test, votes.

## Don't
- Majority vote cannot override a failed mandatory check.
- Don't promote sandbox diffs to Studio production modules.
- Send reproducible failures and source paths to the engineering queue. Do not
  claim the engineer has fixed them until the patch and retest evidence exist.
