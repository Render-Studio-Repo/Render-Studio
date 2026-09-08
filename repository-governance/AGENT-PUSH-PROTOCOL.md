# Agent push protocol — Repository Governance

**Before any `git add` / `git commit` / `git push` that may reach GitHub, complete this protocol.**

This is the enterprise **Secure Publish** gate. Do not skip it because a task says “push” or “create a PR”.

## 0. Stop conditions (abort immediately)

Abort the push if any of these are true:

- You have not read `repository-governance/README.md` in this session.
- Staged paths include `premium-features/` or anything in `off-limits.yaml` / `fence.yaml`.
- Diff contains values matching `secret-patterns.txt` (API keys, JWTs, private keys, connection strings with passwords).
- You cannot explain, in one sentence, why each path is on the publish allowlist.
- The change would upload user data (`projects/`, `data/`, `*.db`, backups, inbox).

## 1. Read the policy pack

```text
repository-governance/README.md
repository-governance/PUSH-CHECKLIST.md
repository-governance/publish-manifest.yaml
repository-governance/fence.yaml
repository-governance/off-limits.yaml
```

## 2. Run the automated gate

From the repo root:

```bash
python3 scripts/check-repository-governance.py
# or, for staged-only:
python3 scripts/check-repository-governance.py --staged
```

Exit code must be `0`. If it fails, fix fences / unstage files — do not `--force`.

## 3. Selective publish rules

- Engine/application trees are allowed; `premium-features/` is **never** allowed.
- Never use `git add -A` / `git add .` on this workspace.
- Prefer explicit pathspecs.
- Operator feedback in `repository-governance/notes/` is pushable (thumbs + issues).

## 4. Secrets hygiene

- `.env` is local-only. Update `.env.example` with **empty** placeholders when adding config keys.
- Do not paste real keys into markdown, changelogs, screenshots of admin panels, or PR bodies.
- If a secret was already exposed: **rotate it**, then continue — do not merely un-commit.

## 5. After a clean gate

1. Commit with a focused message.
2. Push the feature branch only.
3. Open/update the PR with ManagePullRequest (cloud agents) — never paste tokens into the PR text.

## 6. Management dashboard wiring

Super admins open this pack under **Management → Server Settings** (off-limits, AI explain, safeguard notes, thumbs/feedback).
Agents still run the script gate above — the UI does not replace it.
