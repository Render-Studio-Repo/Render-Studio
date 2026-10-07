# Character motion scope (sandbox whiteboard)

## Goal
Agents propose how each crew character moves in the Super IDE smart whiteboard / office hangout.

## Constraints
- Sandbox only — no prod Office mutation
- Any workshop (not a single Cursor "his" desk)
- One WebGL scene (shared viewport via sandbox-live-instances)
- Motion is visual / desk highlight — not DIMOS joint commands

## Move vocabulary
| move | meaning |
|------|---------|
| approach_desk | walk toward clicked desk |
| circle_table | orbit the round table |
| speak_pose | stop + face camera while TTS plays |
| return_home | lerp back to seat home |
| whiteboard_pin | highlight token on smart whiteboard |

## Agent asks
1. Cursor — file path + loop hook for each move
2. RnD — timing / ease / collision with desks
3. Analytics — which moves get used
4. Astra — who speaks while moving in any workshop (1 speaker)

## Files
- `examples/character-motion-loop.js` — `planCharacterMoves` + `tick`
- `examples/character-motion-plan.json` — saved from whiteboard **Save plan → MCP**
