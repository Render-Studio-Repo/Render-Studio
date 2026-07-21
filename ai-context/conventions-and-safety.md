# Conventions & safety — how not to break things

This is a live server with real users and no staging environment. These rules exist because breaking Design mode or shipping a stale-cache bug hits users immediately.

## The additive-module pattern (the single most important convention)

New features live in **new files**, lazy-imported from `app.js` with a thin hook. Example (Quest Book):

```js
// app.js — the ONLY thing added to the god-file:
document.getElementById("btn-quest-book")?.addEventListener("click", (e) => {
  e.stopPropagation();
  document.getElementById("user-menu")?.classList.add("hidden");
  void import("./quest-book.js?v=20260719-quest-book-2").then((mod) => {
    mod.openQuestBook?.();
  });
});
```

All logic, markup generation, and state live in `quest-book.js`. Follow this shape for anything new. Same idea backend-side: new service file in `backend/services/`, thin route in `main.py`.

## Cache-busting (mandatory)

- Every static reference carries `?v=YYYYMMDD-slug`: stylesheets and scripts in `index.html`, dynamic `import(...)` URLs in JS, GIF URLs in `docs-features.js`.
- **If you edit a file, bump the version everywhere it's referenced.** Search for the filename to find all references. A changed file with an unbumped version = users silently run stale code.
- `client-reload.js` shows users an update banner when versions change; it never force-reloads.

## CSS rules

- `styles.css` is ~37.7k lines. **Append** new scoped blocks with a clear comment header (see the `/* ── Quest Book modal ... */` block); never reorganize existing rules.
- Scope new styles under a feature-specific class prefix (`.quest-book-*`, `.architect-*`).
- Theme: dark is default; light theme overrides via `body.theme-light ...`. Core variables at `:root` (~line 498): `--bg`, `--panel`, `--border`, `--text`, `--muted`, `--accent`.
- Some surfaces intentionally ignore the light theme (Quest Book modal stays dark/gold by design).

## Edit-risk zones (generalized from `TODO/quest-book/progress/00-safe-edit-zones.md`)

**Green — prefer to touch**
- New `frontend/<feature>.js` modules; new `backend/services/<feature>_service.py`
- Appended, scoped CSS; new markup blocks in `index.html` for your feature
- `ai-context/`, `TODO/quest-book/**`, docs content files

**Yellow — touch carefully, minimal diffs**
- `app.js` (hooks only), `index.html` (don't disturb existing panels), `backend/main.py` (add routes, don't reshape existing ones)
- `ribbon.js`, `workspace-modes.js` — additive entries only
- Camera/orbit/grid code — must be branch-gated by mode

**Red — do not casually rewrite**
- Design prompt composer + generation flow, `backend/kernel/`, `backend/services/ai_service.py` core
- Auth, billing/credits, admin, collab
- Fusion 360 / Onshape / Autodesk OAuth flows
- Wiring simulator core
- `backend/render3d.db` (live user data — query via app code, never hand-edit)

## Deployment reality

- `frontend/` edits are **live on save** (static serving). There is no undo other than backups. Get it right, verify with screenshots, keep diffs small.
- `backend/` edits need `sudo systemctl restart render3d` to take effect. Restarting kills in-flight AI generations — restart only when needed, ideally verify by importing the changed module first (`.venv/bin/python -c "import backend.services.foo"`).
- Never `kill -9` uvicorn directly; there are cron guards (`cleanup-stale-render3d-processes.sh`) and a proper service unit.

## Backups & recovery

- Cron: `scripts/backup-code.sh` every 30 min → `backups/snapshots/<ts>-cron/`; validated (must contain `frontend/index.html` + `backend/main.py`), broken states quarantined; `backups/latest/` always points at the newest valid snapshot.
- Daily Drive backup at 3am; `milestones/` holds golden frontend snapshots.
- If you catastrophically break something: compare against `backups/latest/` and restore the specific file — don't blanket-restore.

## Smoke test after risky edits

Adapted from `TODO/quest-book/progress/smoke-checklist.md` — after touching yellow/red zones, verify in a browser:

1. App loads; viewport renders; no console errors on boot
2. Design mode: orbit/pan/zoom, object select, AI prompt panel visible
3. Workspace mode switching works (Design ↔ others), and switching back doesn't break the prompt panel
4. Whatever feature you touched, exercised end-to-end
5. One unrelated page (`docs.html` or `getting-started.html`) still loads

See [verify-and-test.md](./verify-and-test.md) for the Playwright recipe.

## Misc gotchas

- Workspace root is **not a git repo** — you cannot `git diff` your way out of a mistake; be deliberate.
- Plans from previous sessions live in `.cursor/plans/` — check them before re-planning something.
- `updates`/social pipeline is automated (cron posts to LinkedIn hourly from queue) — don't create update/social content unless asked.
- Demo GIFs are recorded, not hand-made: `scripts/gif-demos/record_getting_started_gifs.py` against a demo account (`demo.docs.gif@r3d-studios.com`) on the live server.
