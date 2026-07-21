# Product Quest Book — state, roadmap, and why it matters beyond onboarding

## Vision

An FTB-Quests / modded-Minecraft-style learning map: fun to browse, gives a sense of progression, teaches the platform quest by quest. Deliberately game-y (dark panel, gold accents) and distinct from the rest of the app — that contrast is intentional, keep it.

## Current state (shipped 2026-07-19)

- **Entry:** account menu → Learn section → gold shiny "Quest Book" button (`#btn-quest-book`, `.user-menu-item--quest` with animated shine sweep). "Studio walkthrough" sits next to it (replays the `prompt-onboarding` Show Me tour).
- **Modal:** `frontend/quest-book.js`, lazy-imported from `app.js`. Left sidebar = chapter tabs (Welcome + the 9 `DOC_CATEGORIES`); main panel = deterministic branching node graph per chapter (nodes from `DOC_FEATURES`, wobble-seeded layout, dashed gold connectors); footer = detail panel with steps as checkbox-style rows; header = gold progress bar ("2 / 36 quests").
- **CSS:** one appended block in `styles.css` (`/* ── Quest Book modal ... */`). Node states: gold `--completed` (check badge), pulsing blue `--available`, dimmed `--locked`. Responsive: tabs collapse to icons <860px.
- **Explicitly fake for now:** `COMPLETED` is a hard-coded set (`welcome-account`, `welcome-open-book`); first node per chapter is "available", rest "locked". No persistence, no unlock logic.
- Plan file: `.cursor/plans/quest_book_menu_entry_b3ec02ac.plan.md` (all todos completed).

## Next stage: real progression = the feature-usage event bus

The key architectural insight: **making quests complete requires detecting feature usage, and that same event stream is product analytics.** Build one primitive, get both.

Sketch (not yet built — design before implementing):

1. **Event emission:** a tiny module (e.g. `frontend/feature-events.js`) with `emitFeatureUsed(featureId, meta?)` — feature ids are the `DOC_FEATURES` ids. Instrument call sites incrementally (first generate, project created, folder shared, picks used, ...). Welcome-chapter quests map to auth/boot events that already exist.
2. **Persistence:** localStorage per user first (`render3d:questProgress:<userId>`), backend endpoint later so progress follows accounts (and so we get server-side analytics).
3. **Unlock rules:** chapter-internal ordering already implied by the graph (parent spine). Keep it forgiving — quests complete whenever the event fires, even if "locked" visually; locked only gates the *highlight*, not credit.
4. **Reward feel:** completion animation on the node, chapter completion state on the tab, maybe a toast. This is the "fun" the user asked for — don't skip it.
5. **Quest Book UI reads progress** instead of the `COMPLETED` constant; progress bar becomes real.

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
