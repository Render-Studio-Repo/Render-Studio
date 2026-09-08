# Push checklist (Repository Governance)

Copy this into the agent scratchpad and check every box before `git push`.

## Policy

- [ ] Read `repository-governance/README.md` this session
- [ ] Read `AGENT-PUSH-PROTOCOL.md`
- [ ] Confirmed change is intentional for the public/partial remote (not a full host mirror)

## Secrets & data

- [ ] No `.env`, `*.pem`, `*.key`, credential JSON, or Fernet keys in the diff
- [ ] No `backend/render3d.db` / SQLite user DBs
- [ ] No `projects/`, `data/`, `backups/`, `inbox/`, `milestones/` payloads
- [ ] No live OAuth tokens, JWT secrets, Stripe/Discord/LinkedIn secrets
- [ ] New env vars documented in `.env.example` with empty values only
- [ ] Diff scanned against `secret-patterns.txt` (or gate script reported clean)

## Selective publish

- [ ] Did **not** run `git add -A` / `git add .`
- [ ] Every staged path matches `publish-manifest.yaml` allow rules
- [ ] No staged path matches `fence.yaml`
- [ ] Ran `python3 scripts/check-repository-governance.py --staged` → exit 0

## Product safety (Render Studio)

- [ ] Frontend cache-bust bumped for any changed static asset
- [ ] Did not casually rewrite red-zone auth/billing/kernel unless the task required it
- [ ] Worklog / changelog updated only with non-secret descriptions

## Remote

- [ ] Pushing a feature branch (`cursor/…`), not force-pushing `master`
- [ ] PR body contains no secrets, tokens, or internal host paths with credentials
