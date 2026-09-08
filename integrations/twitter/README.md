# Twitter / X

OAuth 2.0 + PKCE for **Connect X** and **Share to X** (viewport videos).

## Upstream

- [developer.x.com](https://developer.x.com)
- Runtime: `backend/services/twitter_link_service.py` (stays in core for auth safety)

## Env (repo-relative `.env`)

```bash
TWITTER_CLIENT_ID=
TWITTER_CLIENT_SECRET=
TWITTER_REDIRECT_URI=https://YOUR_HOST/oauth/twitter/callback
# Optional app-only bearer (not required for user Connect / Share to X)
TWITTER_BEARER_TOKEN=
```

Create an app with OAuth 2.0 User authentication; callback URL must match `TWITTER_REDIRECT_URI` exactly.

## Paths

No machine-specific roots. Configure via `.env` next to the repo root (`RENDER_STUDIO_ROOT`).
