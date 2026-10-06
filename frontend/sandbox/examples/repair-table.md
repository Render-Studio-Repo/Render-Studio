# Repair Table — agent brief

**ref_id:** REPAIR-TABLE-20260917  
**token:** repair1 · **OpenArm:** 2.0

## Layout change
- **Removed:** Round Table from AI CAD Prompt (`#prompt-pane-compose`)
- **Added:** Repair button + Repair Table crew (Intake → Adjudicator)
- Round Table may remain on Render Agent / VR chrome; not on the CAD prompt

## Code
| file | role |
| --- | --- |
| `frontend/sandbox/repair-table.js` | seats, skills paths, button bind |
| `frontend/sandbox/repair-loop.js` | probes, hypotheses, votes, report |
| `frontend/sandbox/skills/repair-*.md` | per-seat instructions |
| `frontend/sandbox/curriculum/repair-loop.md` | how to run |

## When Sam says “I can't …”
1. Open Repair in AI CAD Prompt
2. Run loop
3. Act on `adjudication.recommendation`
4. Re-run until gate is `cleared` or Sam confirms the real blocker
