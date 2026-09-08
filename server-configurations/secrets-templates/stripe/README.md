# Stripe

Billing, Connect, marketplace payouts.

## Keys in this folder

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PUBLISHABLE_KEY`

## How to update

1. Edit `secret.env` in this folder (one `KEY=value` per line), **or**
2. Upload a bulk settings `.txt` from Management → Server Setup → Secrets, **or**
3. Ask Render Agent (server-setup skill) to walk you through connecting this app.

Never commit real values. This folder lives under `data/` and is gitignored.

## Example `secret.env`

```env
STRIPE_SECRET_KEY=your-value-here
```
