# Open-source rollout boundary

Render Studio installs are local-first. A clean clone resolves relative `PROJECTS_DIR` and `DATA_DIR` values beneath the repository root. The defaults are `projects/` and `data/`. An external disk is used only when the operator explicitly configures an absolute path or symlink.

## Installation modes

`private` keeps the marketplace local and makes no hub catalog requests.

`hybrid` keeps the local catalog and leaves hub pull and publish disabled until the operator enables them.

`public` pulls the official catalog from `https://render3d.app`. New public installations are pull-only. Publishing requires a hub-issued bearer credential and explicit approval. Paid hub listings redirect to the official Render product page. The official host owns checkout, entitlements, refunds, payouts, and platform fees.

Joining the ecosystem registers only the stable instance ID and operator-chosen instance name. A public base URL is included only when the operator says the instance has its own public HTTPS origin. Enrollment does not scan or upload projects.

## Authority boundary

The public repository owns the application shell, local viewer, local CAD tools, local projects, local marketplace listings, and the network clients.

The hosted Render control plane owns official listing approval, commerce, paid entitlements, premium delivery, instance credentials, revocation, rate limits, Render AI credits, platform keys, private operational telemetry, and the management inbox.

An independently hosted instance cannot create an official entitlement. A missing Stripe configuration may enable demo commerce only for that instance's local listings. It never grants access to a listing pulled from the Render hub.

## Instance reporting

Marketplace browsing and instance reporting are separate choices. Reporting is disabled until the operator opts in. Explicit support submissions are redacted before transmission. The client sends a stable instance ID, chosen instance name, version, and coarse aggregate counts. It does not send project files, prompts, credentials, hostnames, IP addresses, or user identities.

Marketplace publishing is also a separate boundary. Hub synchronization accepts metadata and public URLs only for listings with an explicit approved or published state. Draft listings, private projects, project folders, and raw project files fail closed and remain on the instance.

## Premium delivery contract

Premium downloads should be issued by the hosted control plane after it verifies the user, instance, listing, and entitlement. Delivery uses a short-lived, listing-specific grant and HTTP range support. Permanent object URLs and bucket credentials are never returned. Catalog responses contain metadata and bounded previews only.

## Release checklist

1. Leave `PROJECTS_DIR=projects` and `DATA_DIR=data` for a normal repository-local install.
2. Generate a unique `JWT_SECRET` and `SECRETS_FERNET_KEY` outside version control.
3. Choose private, local-first, or connected marketplace setup.
4. Keep `MARKETPLACE_HUB_TOKEN` empty unless Render has approved the instance for publishing.
5. Opt into health reporting separately from marketplace access.
6. Verify that a hub listing redirects checkout to `render3d.app`.
7. Verify that an unauthenticated hub publish returns HTTP 401.
8. Verify that local uploads remain beneath the configured projects directory.
