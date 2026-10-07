# Repair Table curriculum

Sam removed **Round Table** from the AI CAD Prompt (viewport compose). Use **Repair** + **Sandbox** there instead.

## Goal
When Sam says “I can't …”, run the repair loop to find the cheapest falsifiable blocker for OpenArm 2.0 teleop / sandbox map / agent feed.

## Run
1. Open AI CAD Prompt → **Repair**
2. Type the symptom (or leave default)
3. **Run loop**
4. Read `sandbox-sessions/latest-repair.json`
5. Agents follow seat skills under `frontend/sandbox/skills/repair-*.md`

## Pass
- Round Table absent from `#prompt-pane-compose`
- Repair + Sandbox buttons present
- Loop posts gate + recommendation to team chat
- No production CAD writes
