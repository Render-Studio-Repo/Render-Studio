# Public release diagnostics

Pre-push checks run the public release audit, installer contract, and backend import smoke test. Runtime diagnostics remain local and are excluded from Git.

## Required GitHub push path

Keep this folder in the tree. Agents and `scripts/git-hooks/pre-push` check it exists.

Write a one-liner here **only** for a critical ship note. Otherwise leave `.gitkeep`.
