# Premium Agent Service

This folder is the boundary for Render3D-hosted premium agent operations: paid app execution, billing checks, managed queues, provider credentials, and store fulfillment.

The open-source app store can run without this service. Self-hosters can keep premium apps disabled, or replace this service with their own billing and worker implementation.

## Responsibilities

- Verify purchases/subscriptions before premium app install or execution.
- Run managed agent apps in isolated workers.
- Keep provider keys, signing secrets, and billing webhooks out of the public frontend.
- Record fulfillment events back to the main Render3D API.
- Enforce per-user/team quotas for premium agent usage.

## Not Included

- Production secrets.
- Customer data.
- Payment provider private keys.
- Hosted marketplace database dumps.

## Environment

Copy `.env.example` to `.env` in your deployment environment and set real values there.

## Integration Points

- Main app store API: `/api/agent-apps`
- Purchase gate: premium listings return `402 Purchase is required before installing this app`
- Future fulfillment hook: mark a user entitled to install/use a premium `agent_app_listings.id`
