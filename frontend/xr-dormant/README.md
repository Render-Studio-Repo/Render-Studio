# XR dormant code (Quest native app)

These modules are **not imported** by the live Meta Browser / web XR build.

## Why parked
Full-body avatars, warehouse/studio spaces, blocks grids, and dense social meshes
pushed Quest Browser over GPU/memory limits when loading CAD mid-session.

## When to revive
- Native Quest app (App Lab / Store / SideQuest)
- Or a dedicated `?xrHeavy=1` flag after profiling

## Files
- `quest-heavy-avatar-spaces.js` — `buildAvatar`, spaces, blocks grid, social markers
  from `viewport-xr.js.bak-heavy-20260805`

## Live web substitute
`viewport-xr.js` uses official WebXR **controller models** + a **low-poly head**
(+ simple controller stubs for remote presence). Hand tracking uses light `boxes`
models instead of full skinned hand meshes.
