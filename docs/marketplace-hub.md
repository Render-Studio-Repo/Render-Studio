# Render Marketplace Hub

## Do you need a folder or a repo?

**Neither for a single Render instance.** Listings live in this app’s SQLite database (`data/render3d.db`). Config lives in `data/marketplace_settings.json` (gitignored). There is no product-catalog git folder to create.

To **connect multiple instances** (self-hosted studios posting into Render’s public marketplace) you need a **Hub API**, not a shared folder:

| Option | What to host | When |
|--------|----------------|------|
| **A. This instance** | Already live at `/api/marketplace/hub/v1` | Official `render3d.app` (default) |
| **B. Separate service** | Extract `services/marketplace-hub/` into a new Git repo named **`render-marketplace-hub`** | If you want the hub on its own host (`marketplace.render3d.app`) |

Instance-side env (no secrets in git):

```
MARKETPLACE_HUB_URL=https://render3d.app
MARKETPLACE_HUB_TOKEN=          # optional shared bearer; set the same value on the hub
PUBLIC_BASE_URL=https://your-host
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
```

Install-time question (CLI or `/setup-marketplace.html`):

1. Include marketplace on this instance?
2. Mode: **public** (pull official catalog; optionally publish) / **private** (local only) / **hybrid** (local now, connect later).

OpenAPI: `services/marketplace-hub/openapi.yaml`
