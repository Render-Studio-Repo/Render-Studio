# Push / PR hygiene (action playbook)

Read before pushing feature branches or opening PRs.

1. Start from `AGENTS.md` → `ai-context/START-HERE.md`.
2. Keep local server runtime under `data/server-config/` out of commits (already gitignored).
3. Do not commit secrets, ledgers, or private update drafts meant only for one machine.
4. Cache-bust every changed static asset (`?v=YYYYMMDD-slug`).
5. Prefer new modules + thin hooks over growing god-files.
6. If the change includes a product update meant for docs/Slack, append a `status: published` entry to the **local** `data/server-config/updates/UPDATE-LOG.md` (not the public template) and follow `PUBLISH-SERVER-UPDATES.md`.
