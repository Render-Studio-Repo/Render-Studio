# Render3D Studio integration

These skills are synced from [text-to-cad](https://github.com/earthtojake/text-to-cad) into
`backend/skills/<skill-id>/` on the Render3D server.

## Paths

| What | Location |
|------|----------|
| Skill root | `backend/skills/<skill-id>/` |
| Python CLIs | `backend/skills/<skill-id>/scripts/<tool>` |
| Reference docs | `backend/skills/<skill-id>/references/` |
| Bundled packages | `backend/skills/<skill-id>/scripts/packages/` |

Run commands **from the project directory that owns the artifacts** (e.g. `projects/<id>/`),
not from the skill directory. Pass cwd-relative paths to STEP/STL/URDF files.

Example (CAD skill, from a project folder):

```bash
python backend/skills/cad/scripts/step my-part.step --kind part --force
python backend/skills/cad/scripts/inspect refs STEP/my-part.step --facts
```

The Render3D server runs these automatically after builds when the matching skill is enabled.

## Prompt behavior

In Studio, enabled skills inject guidance into the AI system prompt. The model emits Render3D
**JSON Feature Programs** (not raw Python) unless you explicitly ask for build123d source.

Ignore agent-only handoffs like `$cad-viewer` unless that skill is also enabled.

## Local-only skills

These skills live only in Render3D (not synced from text-to-cad) and are preserved across sync:

| Skill | Purpose |
|-------|---------|
| `blueprint-vision` | Schematic/image → structured CAD reasoning (preprocessor for CAD) |

Add new local skills to `LOCAL_SKILLS` in `scripts/sync-skills-from-text-to-cad.sh`.

## Sync updates

```bash
scripts/sync-skills-from-text-to-cad.sh
scripts/patch-skills-for-render3d.sh   # re-apply Render3D path notes after sync
```
