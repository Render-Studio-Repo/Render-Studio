# Render Studio docs

This folder is the GitHub-friendly documentation layer for Render Studio. It complements the in-product guides and gives founders, engineers, and new contributors a fast way to understand what the product is, what ships today, and where to dig deeper.

## Start here

| Page | Best for |
|------|----------|
| [Getting Started](getting-started.md) | First-time engineers who want to run the app and understand the repo setup. |
| [Architecture](architecture.md) | Readers who want the system shape: frontend, backend, kernel, XR, docs, and integrations. |
| [Studio, workspaces, and XR](studio-and-xr.md) | Product-minded readers who want the main user workflows and workspace model. |
| [Robotics, motion, and teleop hooks](robotics-and-motion.md) | Teams evaluating rigging, URDF/SRDF, simulation, and motion-planning support. |
| [Roadmap](roadmap.md) | Anyone who wants the near-term Workshop/VR/robots direction and the longer-term product vision. |
| [Contributing and deploy-sync notes](contributing.md) | Engineers shipping changes into the live product without breaking docs or runtime assumptions. |

## Recommended reading paths

### If you are a founder or product lead

1. [README](../README.md)
2. [Studio, workspaces, and XR](studio-and-xr.md)
3. [Robotics, motion, and teleop hooks](robotics-and-motion.md)
4. [Roadmap](roadmap.md)

### If you are a new engineer

1. [Getting Started](getting-started.md)
2. [Architecture](architecture.md)
3. [Roadmap](roadmap.md)
4. [Contributing and deploy-sync notes](contributing.md)

### If you are updating help content

Read [Contributing and deploy-sync notes](contributing.md) first. The user-facing docs stack has a single source of truth in `frontend/docs-features.js`, and some onboarding content is mirrored server-side.

## In-product documentation

When the app is running locally, these pages are part of the product itself:

- `http://127.0.0.1:8000/getting-started.html`
- `http://127.0.0.1:8000/docs.html`
- `http://127.0.0.1:8000/roadmap.html`
- `http://127.0.0.1:8000/updates.html`

## Notes on scope

- These markdown docs describe what the repository demonstrably ships today.
- Planned items are marked as roadmap rather than presented as finished product.
- The repo uses **Studio** and **workspace modes** as the main user-facing mental model; there is no separate shipped surface named "Workshop" in the source tree.
