# Repository Governance (Secure Publish Policy Pack)

**Enterprise name:** Repository Governance / Secure Publish Policy  
**Former informal name:** System Settings notes folder

This pack is the **source of truth** for what may leave this machine for GitHub.
Cloud agents and humans **must read this folder before every push**.

## Goals

1. **Push the engine** — `frontend/`, `backend/`, scripts, plugins, docs, etc.
2. **Never push premium** — root `premium-features/` is host-only (fenced + gitignored).
3. **Operator off-limits** — Management → Server Settings can add more fenced folders/files.
4. **Feedback loop** — thumbs up/down + notes land in [`notes/README.md`](./notes/README.md) for the main GitHub repo.

## Read order (mandatory for agents)

1. [AGENT-PUSH-PROTOCOL.md](./AGENT-PUSH-PROTOCOL.md)
2. [PUSH-CHECKLIST.md](./PUSH-CHECKLIST.md)
3. [publish-manifest.yaml](./publish-manifest.yaml) — engine allowlist
4. [fence.yaml](./fence.yaml) + [off-limits.yaml](./off-limits.yaml)
5. [secret-patterns.txt](./secret-patterns.txt)

## Layers

| Layer | Purpose |
|-------|---------|
| `.gitignore` | Keeps `premium-features/`, `.env`, DBs, projects out of git |
| `fence.yaml` | Hard denylist |
| `off-limits.yaml` | Operator-managed extra fences (Server Settings) |
| `publish-manifest.yaml` | Allowlist for engine publication |
| `scripts/check-repository-governance.py` | Pre-push gate |
| `notes/README.md` | Operator thumbs + issue notes (pushable) |
| Management → **Server Settings** | UI to open this pack, edit off-limits, generate/safeguard notes, feedback |

## Default posture

- Publish **engine code**; fence **premium-features/** and secrets/user data.
- Never `git add -A`. Never stage `premium-features/`.
- When unsure: widen the fence, not the allowlist.
