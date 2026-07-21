# Product Quest Book — state, roadmap, and why it matters beyond onboarding

## Vision

An FTB-Quests / modded-Minecraft-style learning map: fun to browse, gives a sense of progression, teaches the platform quest by quest. Deliberately game-y (dark panel, gold accents) and distinct from the rest of the app — that contrast is intentional, keep it.

## Current state (updated 2026-07-21)

- **Entry / visual modal:** shipped (account menu → Learn → gold Quest Book).
- **Progress (checkpoint shipped):** `frontend/feature-events.js` + localStorage per user; Welcome chapter + a few high-value features instrumented; unlock by parent node; toast + node flash; Quest Book live-refreshes.
- **Still deferred:** backend persistence / analytics pipeline; remaining DOC_FEATURES instrumentation; CI smoke from Show Me tours.

Instrumented feature ids today: `welcome-account`, `welcome-open-book`, `welcome-walkthrough`, `welcome-first-project`, `welcome-first-generate`, `ai-generate`, `picks`, `preferences`, `render-agent`.

## Next stage: broaden instrumentation + optional backend

The key architectural insight: **making quests complete requires detecting feature usage, and that same event stream is product analytics.** The local event bus exists; next is more call sites, then a thin backend mirror.

## Development use cases unlocked by the catalog + event bus

`DOC_FEATURES` is a machine-readable manifest of every major app function. Uses beyond user education:

**Testing & QA**
- Generate a Playwright smoke suite from Show Me tours / quest steps (harness already exists in `scripts/gif-demos/`); a quest that can't complete headlessly = failing test.
- UI-drift detection in CI: walk the `where` paths and tour selectors; catch "moved the button, docs/tours now broken".
- Release QA matrix: one smoke pass per chapter before shipping.

**Telemetry & product**
- Feature discovery/usage rates, drop-off funnels, never-completed quests → roadmap prioritization signal.
- Welcome chapter = instrumented activation funnel (account → walkthrough → first project → first generate).

**Process**
- Definition of done for new features: add a `DOC_FEATURES` entry → auto-propagates to docs, Getting Started, Quest Book, Render Agent.
- Optional `modules` field mapping feature ids → source files for impact analysis and agent grounding.
- Changelog/social automation: new catalog entries can seed the existing update/social pipeline.
- GIF freshness: re-record demos per release from the same catalog.

## Guardrails

- Quest Book stays **read-only over the catalog** — never fork quest content away from `docs-features.js`.
- Event bus must be fire-and-forget: a broken emitter must never break the feature it instruments (wrap in try/catch, no awaits in hot paths).
- Progression data is per-user state — additive backend table/endpoint, nowhere near auth/billing code.
