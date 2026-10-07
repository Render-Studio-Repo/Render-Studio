---
name: wiring
description: Breadboard and Arduino wiring schematics for the Wiring Simulator workspace.
---

# Wiring skill

Use when the user asks for circuit wiring, breadboard layout, Arduino hookups, or schematic edits in **Wiring Simulator** mode.

## Output

Return JSON only (see wiring_service.WIRING_SYSTEM_PROMPT):

- `components[]` with `id`, `type`, `label`, `x`, `y`, optional `w`, `h`
- `wires[]` with `from`/`to` pin references and `#hex` colors
- `notes[]` assembly tips
- Optional `reference_image` URL (usually null — client supplies schematic overlay)

## Component types

`arduino-uno`, `arduino-mega`, `breadboard`, `led`, `resistor`, `button`, `sensor`, `motor`, `stepper`, `motor-driver`, `servo-motor`

## 28BYJ-48 + ULN2003 (required pattern)

- Include `motor-driver` labeled **ULN2003**
- Wire **Arduino 5V → VCC**, **GND → GND**, **D13→IN1**, **D12→IN2**, **D11→IN3**, **A0→IN4**
- Motor plugs into board socket — **no wires** to stepper `in1`–`in4` or from driver `out1`–`out4`
- Never wire a stepper like a DC motor (one line to IN1 or O1/O2 only)

## Pin IDs

| Part | Pins |
|------|------|
| Arduino | `5v`, `gnd`, `d13`, `d12`, `d11`, `a0`, `a1` |
| LED | `anode`, `cathode` |
| Resistor | `a`, `b` |
| Breadboard | `t+_N`, `t-_N`, grid `a1`…`j15` |

## Colors

- `#f85149` — 5V
- `#6e7681` — GND  
- `#58a6ff` — digital signal
- `#3fb950` — data / LED path

## Images

When the user attaches a photo of a breadboard or schematic, infer component positions and net connections from visible wires and labels.

## Schematic sanity-check

Prefer Project parts, Links-section URLs, and already-fetched datasheet excerpts. Cross-check a second supplied source (datasheet vs typical hookup or another vendor page) when two exist. Call out pinout/voltage conflicts in notes or followup_questions — do not guess. Do not crawl the web unbounded.

<!-- render3d-studio -->
