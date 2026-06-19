#!/usr/bin/env bash
# Append Render3D runtime notes to synced text-to-cad SKILL.md files.
set -euo pipefail

ROOT="/home/ubuntu"
SKILLS="${ROOT}/backend/skills"
MARKER="<!-- render3d-studio -->"

append_block() {
  local skill_dir="$1"
  local skill_id
  skill_id="$(basename "$skill_dir")"
  local skill_md="${skill_dir}/SKILL.md"
  [[ -f "${skill_md}" ]] || return 0

  if grep -qF "${MARKER}" "${skill_md}" 2>/dev/null; then
    return 0
  fi

  cat >>"${skill_md}" <<EOF

${MARKER}

## Render3D Studio

On the Render3D server this skill lives at \`backend/skills/${skill_id}/\`.

- **Python tools:** \`backend/skills/${skill_id}/scripts/\` (run from the **project directory**, not the skill folder)
- **References:** \`backend/skills/${skill_id}/references/\`
- **Prompts:** enabled skills inject guidance; emit Render3D JSON Feature Programs unless the user asks for Python source
- **Handoffs:** ignore \`\$cad-viewer\` / cross-skill CLI handoffs unless that skill is also enabled in Skills Library
- **Sync:** \`scripts/sync-skills-from-text-to-cad.sh\` then \`scripts/patch-skills-for-render3d.sh\`

See \`backend/skills/RENDER3D.md\` for full integration notes.
EOF
  echo "[patch-skills] updated ${skill_id}"
}

for dir in "${SKILLS}"/*/; do
  [[ -d "${dir}" ]] || continue
  append_block "${dir}"
done

echo "[patch-skills] done"
