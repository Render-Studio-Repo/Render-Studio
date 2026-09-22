# Owner identity

Backup + admin identity gate (email / GitHub / token).

## Keys in this folder

- `OWNER_EMAIL`
- `OWNER_GITHUB`
- `BACKUP_OWNER_TOKEN`

## How to update

1. Edit `secret.env` in this folder (one `KEY=value` per line), **or**
2. Upload a bulk settings `.txt` from Management → Server Setup → Secrets, **or**
3. Ask Render Agent (server-setup skill) to walk you through connecting this app.

Never commit real values. This folder lives under `data/` and is gitignored.

## Example `secret.env`

```env
OWNER_EMAIL=your-value-here
```
