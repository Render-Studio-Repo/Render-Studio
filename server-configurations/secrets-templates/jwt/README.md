# JWT / session

Server session signing secret.

## Keys in this folder

- `JWT_SECRET`

## How to update

1. Edit `secret.env` in this folder (one `KEY=value` per line), **or**
2. Upload a bulk settings `.txt` from Management → Server Setup → Secrets, **or**
3. Ask Render Agent (server-setup skill) to walk you through connecting this app.

Never commit real values. This folder lives under `data/` and is gitignored.

## Example `secret.env`

```env
JWT_SECRET=your-value-here
```
