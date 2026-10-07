---
name: ops-debuggers
description: Write pruned debugger and activity notes into ai-context/ops. Travels with downloaded repos.
---

# Ops debuggers (shipped with the repo)

Read **`ai-context/ops/README.md`** before writing any log.

- Critical issues only, or what a watchdog prompt marked important.
- Miniaturized notes in `ai-context/ops/<folder>/`.
- Prune temp `logs/`. Do not clog memory.
- Every GitHub push includes `ai-context/ops/debugger/`.
- Watchdogs: workspace Automation prompt + schedule + optional email-if. SMTP is existing `info@render3d.app` → owner / `sam@render3d.app`.

Canonical copy: `ai-context/ops/SKILL.md`.
