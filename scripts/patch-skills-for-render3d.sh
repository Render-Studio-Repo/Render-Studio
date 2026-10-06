#!/usr/bin/env bash
# Append Render3D runtime notes to synced text-to-cad SKILL.md files.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SKILLS="${ROOT}/backend/skills"
MARKER="<!-- render3d-studio -->"
JAKE_VERSION="$(cat "${SKILLS}/.source_tag" 2>/dev/null || true)"
JAKE_VERSION="${JAKE_VERSION#v}"
JAKE_VERSION="${JAKE_VERSION:-0.7.15}"

# Render-local packs — never rewrite these into Jake's CAD 2.0 contract.
SKIP_SKILLS=(
  vibecad
  img2threejs
  architect
  blueprint-vision
  silicone-mold-generation
  wiring
  implicit-cad
  marketplace-robot-data-explorer
  micro-edit
  ops-debuggers
  parts-replacement
  _packages
)

should_skip() {
  local skill_id="$1"
  local skip
  for skip in "${SKIP_SKILLS[@]}"; do
    if [[ "${skill_id}" == "${skip}" ]]; then
      return 0
    fi
  done
  return 1
}

append_block() {
  local skill_dir="$1"
  local skill_id
  skill_id="$(basename "$skill_dir")"
  local skill_md="${skill_dir}/SKILL.md"
  [[ -f "${skill_md}" ]] || return 0
  if should_skip "${skill_id}"; then
    return 0
  fi

  if grep -qF "${MARKER}" "${skill_md}" 2>/dev/null; then
    return 0
  fi

  cat >>"${skill_md}" <<EOF

${MARKER}

## Render Studio

This skill is installed under the CAD 3.12 env (\`.venv-mac\`). Run tools from the **project directory**.

- **Jake text-to-cad ${JAKE_VERSION}:** author a cadgen model (\`from cadgen import step\` + \`@step\`, built with \`python <model>.py\`). Use the upstream \`cadgen\` commands documented by each synced skill. Render's \`python scripts/inspect\` and \`python scripts/snapshot\` shims remain available for the product validation loop.
- **Render compatibility shims:** \`python scripts/step\`, \`scripts/inspect\`, and \`scripts/snapshot\` support existing Render projects while new Jake models follow the synced upstream contract. Render's robot bridge may read legacy \`gen_urdf()\` / \`gen_srdf()\` projects, but new URDF and SRDF work follows the synced direct-XML source-of-truth rules.
- **Do not** emit Render3D JSON Feature Programs in CAD 2.0 / Fusion / Architect / Jake modes.
- **Standard mode only:** when the product asks for a Feature Program, emit Render3D JSON Feature Programs instead of Python.
- **Handoffs:** ignore \`\$cad-viewer\` / cross-skill CLI handoffs unless that skill is also enabled in Skills Library; Render Studio's own viewer loads the generated STEP/GLB.
- **Sync:** \`SKILLS_REF=v${JAKE_VERSION} scripts/sync-skills-from-text-to-cad.sh\`

The installed source tag is recorded in \`backend/skills/.source_tag\`.
EOF
  echo "[patch-skills] updated ${skill_id}"
}

for dir in "${SKILLS}"/*/; do
  [[ -d "${dir}" ]] || continue
  append_block "${dir}"
done

echo "[patch-skills] done"
