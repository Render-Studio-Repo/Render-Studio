# X auto-repost (Winstead → A1)

This is a cron-friendly poller that watches one connected X account and reposts
every newly detected post from another connected X account for the same Render
Studio user.

## Required flag

Set:

```bash
X_WW_TO_A1_REPOST_ENABLED=true
```

## Current intended setup

- **Source account:** `@Winstead_Works`
- **Repost account:** `@A1_Projects`
- **Render Studio user:** SamW (`a1projects@protonmail.com`)

## Connect X note

- Keep `@A1_Projects` as the **primary** connected X account.
- Connect `@Winstead_Works` as the **secondary/source** account.
- The multi-account vault is additive: connecting Winstead Works must not replace
  the existing A1 primary entry.

## Optional env placeholders

If you want the repost worker to use dedicated env credentials instead of the
connected A1 vault account, set placeholders only in local/server env:

```bash
X_A1_PROJECTS_APP_KEY=
X_A1_PROJECTS_APP_SECRET=
X_A1_PROJECTS_BEARER_TOKEN=
A1_PROJECTS_X_ACCESS_TOKEN=
A1_PROJECTS_X_ACCESS_TOKEN_SECRET=
```

- `X_A1_PROJECTS_BEARER_TOKEN` can also be used to poll public
  `@Winstead_Works` posts without a connected source token.
- If the A1 env write tokens are omitted, the worker falls back to the connected
  A1 primary vault account for repost/write actions.

## Command

```bash
cd /workspace
python3 scripts/x-auto-repost.py \
  --email a1projects@protonmail.com \
  --source Winstead_Works \
  --repost-as A1_Projects
```

## Dry run

```bash
cd /workspace
python3 scripts/x-auto-repost.py \
  --email a1projects@protonmail.com \
  --source Winstead_Works \
  --repost-as A1_Projects \
  --dry-run
```

## Cron example

Run every 5 minutes:

```cron
*/5 * * * * cd /workspace && python3 scripts/x-auto-repost.py --email a1projects@protonmail.com --source Winstead_Works --repost-as A1_Projects >> data/scheduled-social/x-auto-repost.log 2>&1
```

## Notes

- State is stored under `data/scheduled-social/` so the poller only reposts new
  tweets it has not seen before.
- The simplest path is to connect **both** X accounts in the multi-account vault
  for the same Render Studio user.
- OAuth1 access-token-secret material is kept Fernet-encrypted in the vault and
  decoded only at call time.
