---
name: bambu-labs
description: Send prints to Bambu Lab printers through Bambu Connect, Bambu Lab's official app for printing from other software, or Bambu Studio. Use when the user wants to print a sliced `.gcode.3mf`, a Bambu `.gcode` or an unsliced model on a Bambu Lab printer, over Bambu Cloud or LAN. The agent opens the file in the app; the user picks the printer and starts the print there.
license: MIT
---

# Bambu Labs

Provenance: maintained in [earthtojake/text-to-cad](https://github.com/earthtojake/text-to-cad).
Use the installed local skill files as the runtime source of truth; the
repository link is only for provenance and release review.

Bambu Lab printers take print jobs from other software only through Bambu
Connect, Bambu Lab's desktop app for third-party tools
(https://wiki.bambulab.com/en/software/third-party-integration). This skill
opens a file in Bambu Connect, or an unsliced model in Bambu Studio; the user
picks the printer and starts the print there. The agent never controls a
printer and never asks for access codes.

## Requirements

Bambu Connect (Windows 10 or later, macOS 13 or later), signed in to the user's
Bambu Lab account, with the printer on that account or reachable in LAN mode
(https://wiki.bambulab.com/en/software/bambu-connect). On Linux, where Bambu
Connect is still in development, use Bambu Studio.

## Choose the handoff

| What the user has | Handoff |
| --- | --- |
| A sliced `.gcode.3mf`, from `$gcode` or Bambu Studio's or OrcaSlicer's "Export plate sliced file" | Open it in Bambu Connect |
| A plain `.gcode` sliced with this printer's Bambu profile | Open it in Bambu Connect; if Bambu Connect refuses it, slice the model in Bambu Studio instead |
| A model with no slice: `.3mf`, `.stl` or `.step` | Open it in Bambu Studio, which slices it and sends it to the printer itself |

## Open a file in Bambu Connect

Bambu Connect imports a file from a `bambu-connect://import-file` link with
three parameters: `path`, the file's absolute path, and `name`, the name to
show, each percent-encoded the way JavaScript's `encodeURIComponent` does it
(Python: `urllib.parse.quote(value, safe="")`); and `version=1.0.0`. For
`/Users/me/prints/bracket.gcode.3mf`:

```text
bambu-connect://import-file?path=%2FUsers%2Fme%2Fprints%2Fbracket.gcode.3mf&name=bracket&version=1.0.0
```

Open the link with `open "<link>"` on macOS, or `Start-Process "<link>"` in
PowerShell on Windows. Bambu Connect comes forward with the file loaded.

## Open a model in Bambu Studio

On macOS run `open -a BambuStudio <file>` (some installs name the app
`Bambu Studio`). On Windows open the file from Bambu Studio's File menu, or run
`Start-Process <file>` when Bambu Studio is the file's default app. On Linux run
`bambu-studio <file>`, or open it from the AppImage or Flatpak.

## Finish in the app

Before the user presses Print, tell them what to check: the printer, plate
type, nozzle, filament and AMS mapping, a clear build plate, and someone nearby
for the first layer. Never report a print as started: the agent can't see the
printer, and the app shows the job and its progress.

## Out of scope

Starting, pausing or cancelling prints without the user, and reading printer
status: Bambu Lab's firmware takes those from other software only through Bambu
Connect, or in Developer Mode, which is LAN-only and disconnects the printer
from Bambu Cloud. For slicing, use `$gcode` or Bambu Studio.

<!-- render3d-studio -->

## Render Studio

This skill is installed under the CAD 3.12 env (`.venv-mac`). Run tools from the **project directory**.

- **Jake text-to-cad 0.7.15:** author a cadgen model (`from cadgen import step` + `@step`, built with `python <model>.py`). Use the upstream `cadgen` commands documented by each synced skill. Render's `python scripts/inspect` and `python scripts/snapshot` shims remain available for the product validation loop.
- **Render compatibility shims:** `python scripts/step`, `scripts/inspect`, and `scripts/snapshot` support existing Render projects while new Jake models follow the synced upstream contract. Render's robot bridge may read legacy `gen_urdf()` / `gen_srdf()` projects, but new URDF and SRDF work follows the synced direct-XML source-of-truth rules.
- **Do not** emit Render3D JSON Feature Programs in CAD 2.0 / Fusion / Architect / Jake modes.
- **Standard mode only:** when the product asks for a Feature Program, emit Render3D JSON Feature Programs instead of Python.
- **Handoffs:** ignore `$cad-viewer` / cross-skill CLI handoffs unless that skill is also enabled in Skills Library; Render Studio's own viewer loads the generated STEP/GLB.
- **Sync:** `SKILLS_REF=v0.7.15 scripts/sync-skills-from-text-to-cad.sh`

The installed source tag is recorded in `backend/skills/.source_tag`.
