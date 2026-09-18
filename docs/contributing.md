# Contributing and deploy-sync notes

This page is for engineers working in the Render Studio repository. It focuses on what matters most when you are shipping changes into a live, multi-surface product.

## The big picture

Render Studio is not a static marketing repo. It is the source for a live product with:

- a static frontend served directly from `frontend/`
- a FastAPI backend in `backend/`
- a parametric CAD kernel in `backend/kernel/`
- several user-facing docs and onboarding surfaces that stay in sync with product behavior

## Understand the frontend contract

### There is no frontend build step

The app serves files directly from `frontend/`. That means:

- HTML, JS, and CSS changes affect the running product directly
- cache-busting matters for static assets
- docs references should stay aligned with the app's actual URLs and filenames

### The "thin hook" rule

Large files such as `frontend/app.js`, `frontend/styles.css`, and `backend/main.py` are load-bearing. New work should usually go into focused modules with minimal wiring into those entrypoints.

## Docs source-of-truth rules

One of the most important repo-specific rules is that user education is structured around a shared feature catalog.

### Canonical feature catalog

`frontend/docs-features.js` feeds:

- `docs.html`
- `getting-started.html`
- `quest-book.js`
- `show-me-tour.js`
- `render-agent.js`

If you change or add user-facing capabilities, that file is often the first place to reflect it.

### Server-side guide mirror

Some getting-started guidance is mirrored in:

- `backend/services/getting_started_guides.py`

If you update onboarding language or guide structure, keep the frontend and backend mirrors consistent.

## Cache-busting

When you change a static asset served from `frontend/`, update its `?v=YYYYMMDD-slug` references everywhere they appear.

Typical places to check:

- `frontend/index.html`
- dynamic `import(...)` calls in JS
- GIF references inside docs-related modules

## Verification expectations

### For docs-only changes

At minimum:

- read the generated markdown carefully
- verify relative links resolve to real files
- verify file names and product claims still match the codebase

### For UI or help-surface changes

Also verify in a real browser:

- `http://127.0.0.1:8000/`
- `http://127.0.0.1:8000/docs.html`
- `http://127.0.0.1:8000/getting-started.html`

## Runtime notes

### Development

- `python run.py` starts a reload-enabled dev server
- `.env.example` defaults to `HOST=127.0.0.1`, `PORT=8000`

### Production

- production runs through systemd and Caddy
- the deployed service uses port `8001`
- frontend files are served statically from the same repo checkout

## Deploy-sync notes

These repo relationships matter when shipping documentation or user-facing help changes:

| Area | What to keep in sync |
|------|-----------------------|
| `README.md` and `docs/` | High-level repo-facing story for GitHub readers |
| `frontend/docs-features.js` | Canonical product capabilities and help copy |
| `backend/services/getting_started_guides.py` | Backend mirror for onboarding/help flows |
| `frontend/docs/updates/` | Product updates and milestone content |
| `CHANGELOG.md` | Product-facing changelog consumed elsewhere in the product |
| `DEVELOPER_CHANGELOG.md` | Maintainer-facing counterpart |

## Safe language for external readers

When writing buyer-facing or founder-friendly docs:

- use confident plain English
- describe shipped capabilities, not internal debugging lore
- avoid claiming roadmap items as live
- be especially precise around robotics, teleop, collaboration depth, and manufacturing features

## Recommended contributor reading order

1. [Getting Started](getting-started.md)
2. [Architecture](architecture.md)
3. [Studio, workspaces, and XR](studio-and-xr.md)
4. [Robotics, motion, and teleop hooks](robotics-and-motion.md)
