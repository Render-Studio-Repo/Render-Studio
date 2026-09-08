# GitHub OAuth / backups

OAuth App credentials + linked token for Server Setup Connect and source-code backups.

## Keys in this folder

- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `GITHUB_OAUTH_REDIRECT_URI`
- `GITHUB_ACCESS_TOKEN`
- `GITHUB_LOGIN`

## How to update

1. Edit `secret.env` in this folder (one `KEY=value` per line), **or**
2. Upload a bulk settings `.txt` from Management → Server Setup → Secrets, **or**
3. Ask Render Agent (server-setup skill) to walk you through connecting this app.

Never commit real values. This folder lives under `data/` and is gitignored.

## Example `secret.env`

```env
GITHUB_OAUTH_CLIENT_ID=your-value-here
```
