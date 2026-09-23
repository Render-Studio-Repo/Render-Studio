# X auto-repost (Winstead → A1)

This is a cron-friendly poller that watches one connected X account and reposts
every newly detected post from another connected X account for the same Render
Studio user.

## Current intended setup

- **Source account:** `@Winstead_Works`
- **Repost account:** `@A1_Projects`
- **Render Studio user:** SamW (`a1projects@protonmail.com`)

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
- The repost runner expects **both** X accounts to already be connected in the
  multi-account vault for the same Render Studio user.
- OAuth1 access-token-secret material is kept Fernet-encrypted in the vault and
  decoded only at call time.
