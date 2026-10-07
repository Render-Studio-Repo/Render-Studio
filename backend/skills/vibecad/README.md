# VibeCAD skill (Render Studio)

Ported from [10-X-eng/vibecad](https://github.com/10-X-eng/vibecad) for Mode 2.0 → **VibeCAD** engine.

Vendor checkout: `vendor/vibecad` @ `.vendor_rev` (pulled 2026-09-04, `a779fc3`).
Upstream main no longer ships `build123d_worker.py` (FreeCADCmd / VibeScript instead).
Render Studio keeps the isolated build123d sidecar in `scripts/build123d_worker.py`.

## Generation stack

1. **Codex host** — one `codex exec` session writes `*.vibecad.py`. The in-process tool agent is `vibecad_agent` only; one-shot JSON is `vibecad_oneshot` only.
2. **FreeCAD engine** (preferred) — headless `FreeCADCmd` from `vendor/freecad/FreeCAD.app` via `backend/services/freecad_engine.py`.
3. **build123d sidecar** (fallback) — `scripts/build123d_worker.py` when FreeCAD is unavailable or authoring is build123d dialect.
4. Publish STEP → GLB into the Three.js viewport.

Jake Mode 2.0 (`mode=v2`) is unchanged. Select **VibeCAD** in the CAD engine dropdown (`mode=vibecad`).

## FreeCAD install (local)

```bash
# Already done on this host: DMG → vendor/freecad/FreeCAD.app
# Override binary:
export FREECADCMD=/path/to/freecadcmd
```

`vendor/` is gitignored — each machine needs its own FreeCAD.app (or system install).
