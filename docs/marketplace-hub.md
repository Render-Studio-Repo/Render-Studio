# Render Marketplace Hub

## Do you need a folder or a repo?

**Neither for a single Render instance.** Listings live in this app’s SQLite database (`data/render3d.db`). Config lives in `data/marketplace_settings.json` (gitignored). There is no product-catalog git folder to create.

To **connect multiple instances** (self-hosted studios posting into Render’s public marketplace) you need a **Hub API**, not a shared folder:

| Option | What to host | When |
|--------|----------------|------|
| **A. This instance** | Already live at `/api/marketplace/hub/v1` | Official `render3d.app` (default) |
| **B. Separate service** | Extract `services/marketplace-hub/` into a new Git repo named **`render-marketplace-hub`** | If you want the hub on its own host (`marketplace.render3d.app`) |

Environment settings on each instance:

```
MARKETPLACE_HUB_URL=https://render3d.app
MARKETPLACE_HUB_TOKEN=          # optional legacy shared bearer
PUBLIC_BASE_URL=https://your-host
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
```

Each installation creates a stable instance ID and a private instance secret. Enrollment sends both values over HTTPS. The hub stores only the secret hash and binds it to the instance ID. Successful enrollment enables shared catalog reads and approved listing publication.

The setup page asks these questions:

1. Include marketplace on this instance?
2. Mode: **public** (pull the official catalog and publish approved public listings), **private** (local only), or **hybrid** (local now and connect later).

Only listings with an explicit `approved` status can publish. The hub also requires `visibility=public` in the sanitized listing payload. Drafts and private listings fail closed.

OpenAPI: `services/marketplace-hub/openapi.yaml`
