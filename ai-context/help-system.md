# Help & docs system — architecture

Render Studio's user education stack is mature and interconnected. **One catalog feeds everything** — understand this before touching any help surface.

## The canonical catalog

`frontend/docs-features.js` exports:

- `DOC_CATEGORIES` — 9 chapters: `ai-cad`, `projects`, `modeling`, `sketch-canvas`, `rigging`, `wiring`, `cloud`, `architect`, `help`
- `DOC_FEATURES` — ~31 feature entries, each: `{ id, category, title, summary, where, steps[], gif?, ask?, keywords[] }`

This is effectively a **machine-readable feature manifest** of the whole app. `where` is the real UI location; `steps` are reproduction steps; `ask` is a canned Render Agent question; `gif` points at recorded demos in `frontend/docs/media/`.

## Downstream consumers

```text
DOC_FEATURES (docs-features.js)
  ├─ docs.html + docs-catalog.js         full documentation catalog
  ├─ quest-book.js                       Quest Book chapters/nodes (visual)
  └─ getting-started-guides.js           17-guide subset (has a backend twin:
        │                                backend/services/getting_started_guides.py
        │                                — KEEP IN SYNC when editing guides)
        ├─ getting-started.html/.js      onboarding page
        ├─ show-me-tour.js               live spotlight tours (~15 tour ids,
        │                                launchable via /?showMe=<id>)
        └─ render-agent.js               floating help agent (matches guides,
                                         embeds GIFs + "Show me" buttons)

getting-started-tips.js                  ~32 tips, 12 topics → Tips library + agent
backend/services/onboarding_email_service.py  welcome email → GS links
frontend/docs/updates/                   milestones + shipped.json + social drafts
```

## Rules when editing help content

1. **Add features to `docs-features.js` first** — that's the registration point. Docs, Quest Book chapters, and search pick it up automatically.
2. Getting Started guides are duplicated server-side (`backend/services/getting_started_guides.py`) so the Render Agent can match them — sync both or the agent gives stale answers.
3. Show Me tours anchor to **real DOM selectors** in the Studio. If you move/rename UI elements, run the affected tour to check it still works (`/?showMe=<id>`).
4. GIFs are recorded by `scripts/gif-demos/record_getting_started_gifs.py`, not hand-edited. Bump the `?v=` param on GIF URLs when re-recording.
5. The `where` strings in the catalog describe menu paths — update them when UI moves, or docs/quest tooltips lie to users.

## Entry points users see

- Studio boot: welcome modal + first-project prompt-onboarding tour (localStorage-keyed per user)
- Account menu → **Learn** section: gold Quest Book button + Studio walkthrough (replays `prompt-onboarding` tour)
- Nav links to Getting Started / Tips / Docs on all doc pages
- Render Agent FAB on docs pages + Studio (first-visit onboarding behavior)
- `updates.html` milestone cards deep-link into Getting Started anchors

## Two different "Quest Books" — don't confuse them

| | Product Quest Book | Architect Quest Book |
|---|---|---|
| Location | `frontend/quest-book.js` | `TODO/quest-book/` |
| Audience | End users (in-app, gamified learning) | Us (PM/build plan for Architect Mode) |
| Data source | `DOC_FEATURES` | Hand-written chapter md files |
| Status | Visual shell shipped; progression not built | Ch 1–2 done, 3–6 locked |

Details and next stages: [quest-book-roadmap.md](./quest-book-roadmap.md).
