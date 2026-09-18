# Branch rules for Render Studio

This repository should use **classic branch protection** on protected default branches.

## Why classic branch protection instead of rulesets?

On 2026-09-18, the repository rulesets API returned:

- `403 Upgrade to GitHub Pro or make this repository public to enable this feature.`

Because this is a **private** repository, the safe baseline here is classic branch protection on `master`, and on `main` if that branch is ever created later.

## Required protection settings

Apply these settings to `master` now, and to `main` if it exists:

- **Require a pull request before merging**
- **Require at least 1 approval**
- **Dismiss stale approvals when new commits are pushed**
- **Require conversation resolution before merging**
- **Require the `pr-guard` check to pass before merging**
- **Require branches to be up to date before merging**
- **Do not allow force pushes**
- **Do not allow branch deletion**
- **Restrict direct pushes to emergency break-glass only**

## Break-glass model

Classic branch protection cannot cleanly separate "direct push" from "merge to protected branch" the way repository rulesets can. For this repo, the safest admin-owned setup is:

- Restrict pushes on the protected branch to the admin user `wprojects`
- Treat that access as **break-glass only**
- Everyone else, including agents, must work through pull requests

That preserves an emergency escape hatch without letting normal work bypass review and CI.

## Required CI check

The repository includes `.github/workflows/pr-guard.yml`, which runs on pull requests targeting `master`.

It provides a lightweight `pr-guard` check that:

1. Runs top-level lint/test if a top-level package manager project exists
2. Falls back to a lightweight smoke guard when no top-level project exists
3. Ensures the repo still has key files and that core Python entrypoints compile

If GitHub shows a slightly different check context name on the first PR run (for example a workflow-prefixed variant), use the exact context name that GitHub surfaces when configuring required checks.

## Agent workflow rules

Agents and contributors must follow this flow:

1. Create a feature branch from `master`
2. Push only the feature branch
3. Open a pull request
4. Wait for `pr-guard` to pass
5. Resolve all review conversations
6. Merge only after checks are green
7. **Never push directly to `master` or `main`**

Sam's rule applies here: merges should happen **only after required checks pass**.

## Apply via GitHub UI

Use **Settings -> Branches -> Add classic branch protection rule** and configure:

- Branch name pattern: `master`
- Require a pull request before merging
- Required approvals: `1`
- Dismiss stale pull request approvals when new commits are pushed
- Require conversation resolution before merging
- Require status checks to pass before merging
- Required status check: `pr-guard` (or the exact first-run check context GitHub shows)
- Require branches to be up to date before merging
- Restrict who can push to matching branches: `wprojects`
- Do not allow force pushes
- Do not allow deletions

Repeat for `main` if that branch is created later.

## Apply via API

With an admin-authenticated GitHub CLI session:

```bash
bash scripts/github/apply-classic-branch-protection.sh
```

Optional overrides:

```bash
CHECK_CONTEXT="pr-guard" BREAK_GLASS_USER="wprojects" bash scripts/github/apply-classic-branch-protection.sh
```

The helper script skips `main` when it does not exist.
