# Verify & test — how to check your work

Never claim UI work is done without a screenshot. The tooling is already installed.

## The environment

- Server is **already running**: systemd `render3d.service` → `http://127.0.0.1:8001` (also public on 0.0.0.0). Check: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8001/`
- Python venv: `/home/ubuntu/.venv` (Python 3.13) — has Playwright + Chromium installed, plus the full backend stack (build123d, trimesh, fastapi, ...).
- Don't start a second server instance; cron guards kill strays.

## Playwright screenshot recipe

```python
# /tmp/shot.py — run with: /home/ubuntu/.venv/bin/python /tmp/shot.py
import asyncio
from playwright.async_api import async_playwright

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={"width": 1440, "height": 900})
        await page.goto("http://127.0.0.1:8001/", wait_until="networkidle")
        await page.keyboard.press("Escape")          # dismiss welcome modals
        # ... interact: page.click(), page.evaluate(), etc.
        await page.screenshot(path="/tmp/result.png")
        await browser.close()

asyncio.run(main())
```

Then Read `/tmp/result.png` and actually look at it before declaring success.

### Useful tricks

- **Test a lazy module without auth/menus:** `await page.evaluate("() => import('/quest-book.js?v=...').then(m => m.openQuestBook())")`
- **Preview auth-gated markup** (e.g. the user dropdown) without logging in: `page.evaluate` to remove the `hidden` class and fill placeholder text, then `element.screenshot()`.
- **Element-only screenshots:** `el = await page.query_selector('#user-menu'); await el.screenshot(path=...)`.
- Real logged-in flows: the GIF recorder scripts (`scripts/gif-demos/record_getting_started_gifs.py`) show the full pattern including the demo account (`demo.docs.gif@r3d-studios.com`) and login helpers — crib from them.

## Backend verification

- Import check before restarting: `/home/ubuntu/.venv/bin/python -c "import backend.main"` (catches syntax/import errors without touching the service).
- API probe: `curl -s http://127.0.0.1:8001/api/health`
- Logs: `journalctl -u render3d -n 100 --no-pager` (or `logs/` for cron jobs).
- Only restart (`sudo systemctl restart render3d`) after the import check passes.

## Frontend sanity without a browser

- Syntax check an ES module: `node --check` does not support ESM in older setups; prefer `node --input-type=module -e "import('/home/ubuntu/frontend/foo.js')"` — but the Playwright route is more trustworthy since files are served with query params and browser semantics.
- Check every reference got a cache-bust bump: `rg "foo.js\?v=" frontend/`

## Smoke checklist (after yellow/red-zone edits)

1. `http://127.0.0.1:8001/` loads, viewport renders, no boot errors in the Playwright console (`page.on("console", ...)`)
2. Design mode: orbit + object selection + AI panel present
3. Your feature end-to-end
4. Mode switch away and back
5. `docs.html` or `getting-started.html` loads

Architect-specific smoke: `TODO/quest-book/progress/smoke-checklist.md`.
