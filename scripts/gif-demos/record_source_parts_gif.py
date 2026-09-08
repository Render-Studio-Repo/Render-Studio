#!/usr/bin/env python3
"""Keyframe GIF: source parts via ⓘ, then drag into Wiring AI prompt."""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]

from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:8001"
EMAIL = "demo.docs.gif@r3d-studios.com"
PASSWORD = "DemoGif2026!"
USER_ID = "4d950fbd-b44"
OUT = _REPO_ROOT / "frontend" / "docs" / "media" / "source-parts.gif"
RAW = _REPO_ROOT / "scripts" / "gif-demos" / "raw-v2" / "source-parts-kf"


CURSOR_JS = r"""
(() => {
  let style = document.getElementById('pw-demo-cursor-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'pw-demo-cursor-style';
    style.textContent = `
      #pw-demo-cursor {
        position: fixed; z-index: 2147483647; width: 0; height: 0;
        pointer-events: none; left: 40px; top: 40px;
        border-style: solid; border-width: 0 18px 30px 0;
        border-color: transparent #ff8a3d transparent transparent;
        transform: rotate(-15deg);
        filter: drop-shadow(2px 2px 0 #111) drop-shadow(0 0 8px rgba(255,120,40,.7));
      }
      #activity-log, .activity-log { display: none !important; }
      html.pw-hide-agent #render-agent-panel { display: none !important; }
      *, *::before, *::after { cursor: none !important; }
    `;
    document.documentElement.appendChild(style);
  }
  document.documentElement.classList.add('pw-hide-agent');
  let el = document.getElementById('pw-demo-cursor');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pw-demo-cursor';
    document.documentElement.appendChild(el);
  }
  if (!window.__pwCursorBound) {
    window.__pwCursorBound = true;
    window.addEventListener('mousemove', (e) => {
      window.__pwLastMouse = { x: e.clientX, y: e.clientY };
      const c = document.getElementById('pw-demo-cursor');
      if (c) { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }
    }, true);
  }
})();
"""


async def shot(page, frames_dir: Path, n: list[int], hold: int = 3):
    path = frames_dir / f"f{n[0]:04d}.jpg"
    try:
        await page.evaluate(
            """() => {
              const el = document.getElementById('pw-demo-cursor');
              const m = window.__pwLastMouse;
              if (el && m) { el.style.left = m.x + 'px'; el.style.top = m.y + 'px'; }
            }"""
        )
        await page.screenshot(path=str(path), type="jpeg", quality=68, timeout=12000)
        # Duplicate for hold duration at 4 fps
        for i in range(1, hold):
            shutil.copy(path, frames_dir / f"f{n[0] + i:04d}.jpg")
        n[0] += hold
        print(f"  frame {n[0]} (+{hold})", flush=True)
    except Exception as exc:
        print(f"  shot fail: {exc}", flush=True)


async def move_click(page, x, y, steps=10):
    await page.mouse.move(x, y, steps=max(6, steps))
    await page.wait_for_timeout(80)
    await page.mouse.down()
    await page.wait_for_timeout(80)
    await page.mouse.up()
    await page.wait_for_timeout(120)


async def main():
    if RAW.exists():
        shutil.rmtree(RAW)
    frames_dir = RAW / "frames"
    frames_dir.mkdir(parents=True)
    n = [0]

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
        )
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        page.set_default_timeout(12000)

        resp = await page.request.post(
            f"{BASE}/api/auth/login",
            headers={"Content-Type": "application/json"},
            data=json.dumps({"email": EMAIL, "password": PASSWORD}),
        )
        token = (await resp.json())["token"]
        arm = await page.request.post(
            f"{BASE}/api/demo/robot-arm",
            headers={"Authorization": f"Bearer {token}"},
        )
        pid = (await arm.json()).get("project_id")
        print("pid", pid, flush=True)

        await page.add_init_script(
            f"""
            localStorage.setItem('render3d:token', {json.dumps(token)});
            localStorage.setItem('render3d:lastProjectId', {json.dumps(pid)});
            localStorage.setItem('render3d:renderAgentSeen:anonymous', '1');
            localStorage.setItem('render3d:renderAgentSeen:{USER_ID}', '1');
            localStorage.setItem('render3d:skipStudioBootOnce:v1', '1');
            localStorage.setItem('render3d:aiSetupIntroDismissed:v1', '1');
            localStorage.setItem('render3d:aiSetupIntroDismissed:v1:{USER_ID}', '1');
            {CURSOR_JS}
            """
        )
        await page.goto(f"{BASE}/?project={pid}", wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_selector(".prompt-editor", timeout=45000)
        await page.evaluate(CURSOR_JS)
        await page.evaluate(
            """() => {
              document.getElementById('studio-boot-screen')?.remove();
              document.body.classList.remove('studio-booting');
              document.getElementById('ai-setup-intro-modal')?.classList.add('hidden');
              document.getElementById('welcome-modal')?.classList.add('hidden');
            }"""
        )
        await page.wait_for_timeout(1500)
        await shot(page, frames_dir, n, hold=4)

        # Open Robot Arm if needed
        title = page.get_by_text("Robot Arm", exact=False).first
        if await title.count():
            try:
                await title.click(timeout=3000)
                await page.wait_for_timeout(1000)
            except Exception:
                pass
        await shot(page, frames_dir, n, hold=3)

        # Reveal ⓘ and click
        await page.evaluate(
            """() => {
              const li = document.querySelector('.browser-item[data-section="components"]');
              li?.scrollIntoView({ block: 'center' });
            }"""
        )
        await page.wait_for_timeout(400)
        info = page.locator('.browser-item[data-section="components"] .browser-action-profile').first
        row = page.locator('.browser-item[data-section="components"]').first
        if await row.count():
            box = await row.bounding_box()
            if box:
                await page.mouse.move(box["x"] + 80, box["y"] + box["height"] / 2, steps=12)
                await page.wait_for_timeout(200)
        await shot(page, frames_dir, n, hold=3)

        if await info.count():
            box = await info.bounding_box()
            if box:
                await move_click(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            else:
                await page.evaluate(
                    """() => document.querySelector('.browser-item[data-section="components"] .browser-action-profile')?.click()"""
                )
        else:
            await page.evaluate(
                """() => document.querySelector('.browser-item[data-section="components"] .browser-action-profile')?.click()"""
            )

        await page.wait_for_selector(".comp-profile-overlay:not(.hidden)", timeout=10000)
        await page.wait_for_timeout(600)
        await shot(page, frames_dir, n, hold=5)

        # Search + Use this
        search = page.locator(".comp-profile-search").first
        await search.fill("nema 17 stepper")
        await shot(page, frames_dir, n, hold=3)
        await page.locator(".comp-profile-search-btn").click()
        await page.wait_for_selector(".comp-profile-use", timeout=20000)
        await page.wait_for_timeout(400)
        await shot(page, frames_dir, n, hold=4)

        use = page.locator(".comp-profile-use").first
        box = await use.bounding_box()
        if box:
            await move_click(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        await page.wait_for_timeout(1200)
        await shot(page, frames_dir, n, hold=5)

        save = page.locator(".comp-profile-save").first
        if await save.count() and await save.is_visible():
            box = await save.bounding_box()
            if box:
                await move_click(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            await page.wait_for_timeout(500)
            await shot(page, frames_dir, n, hold=3)

        # Close
        close = page.locator(".comp-profile-close").first
        if await close.count() and await close.is_visible():
            box = await close.bounding_box()
            if box:
                await move_click(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        else:
            await page.keyboard.press("Escape")
        await page.wait_for_timeout(400)
        await shot(page, frames_dir, n, hold=3)

        # Wiring mode
        mode = page.locator("#workspace-mode-btn").first
        if await mode.count() and await mode.is_visible():
            box = await mode.bounding_box()
            if box:
                await move_click(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            await page.wait_for_timeout(300)
            wiring_item = page.get_by_text("Wiring Simulator", exact=False).first
            if await wiring_item.count() and await wiring_item.is_visible():
                box = await wiring_item.bounding_box()
                if box:
                    await move_click(page, box["x"] + 24, box["y"] + box["height"] / 2)
                await page.wait_for_timeout(1000)
        tab = page.locator("button.right-panel-tab[data-right-tab='wiring']").first
        if await tab.count() and await tab.is_visible():
            box = await tab.bounding_box()
            if box:
                await move_click(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            await page.wait_for_timeout(500)
        await shot(page, frames_dir, n, hold=4)

        # Drag component into wiring prompt
        src = page.locator('.browser-item[data-section="components"] .browser-item-body').first
        if not await src.count():
            src = page.locator('.browser-item[data-section="components"]').first
        dest = page.locator("#wiring-prompt-input").first
        if await src.count() and await dest.count():
            try:
                await dest.scroll_into_view_if_needed()
            except Exception:
                pass
            sbox = await src.bounding_box()
            dbox = await dest.bounding_box()
            if sbox and dbox:
                await page.mouse.move(sbox["x"] + 40, sbox["y"] + sbox["height"] / 2, steps=10)
                await shot(page, frames_dir, n, hold=2)
                await page.mouse.down()
                await page.mouse.move(
                    dbox["x"] + dbox["width"] * 0.45,
                    dbox["y"] + dbox["height"] * 0.45,
                    steps=20,
                )
                await shot(page, frames_dir, n, hold=2)
                await page.mouse.up()
                await page.wait_for_timeout(500)
                try:
                    await src.drag_to(dest, force=True, timeout=5000)
                except Exception:
                    await page.evaluate(
                        """() => {
                          const input = document.getElementById('wiring-prompt-input');
                          if (!input) return;
                          input.focus();
                          const note = ' @component-1 (sourced part)';
                          if (!String(input.value || '').includes('@component')) {
                            input.value = (input.value || '') + note;
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                          }
                        }"""
                    )
                await page.wait_for_timeout(600)
        await shot(page, frames_dir, n, hold=6)

        await browser.close()

    count = len(list(frames_dir.glob("f*.jpg")))
    print(f"keyframes total {count}", flush=True)
    if count < 6:
        raise SystemExit("too few frames")

    palette = frames_dir / "palette.png"
    pattern = str(frames_dir / "f%04d.jpg")
    subprocess.run(
        [
            "ffmpeg", "-y", "-framerate", "4", "-i", pattern,
            "-vf", "fps=4,scale=720:-1:flags=lanczos,palettegen=max_colors=80:stats_mode=diff",
            "-frames:v", "1", "-update", "1", str(palette),
        ],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        [
            "ffmpeg", "-y", "-framerate", "4", "-i", pattern, "-i", str(palette),
            "-lavfi", "fps=4,scale=720:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4",
            "-loop", "0", str(OUT),
        ],
        check=True,
        capture_output=True,
    )
    print(f"GIF {OUT} {OUT.stat().st_size / 1024:.0f} KB", flush=True)
    shutil.rmtree(RAW, ignore_errors=True)


if __name__ == "__main__":
    asyncio.run(main())
