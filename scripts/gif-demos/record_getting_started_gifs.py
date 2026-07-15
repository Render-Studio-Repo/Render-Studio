#!/usr/bin/env python3
"""Record Getting Started demo GIFs with visible mouse cursor via Playwright."""

from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
from pathlib import Path

from playwright.async_api import async_playwright, Page, Browser

BASE = "https://render3d.app"
EMAIL = "demo.docs.gif@r3d-studios.com"
PASSWORD = "DemoGif2026!"
OUT = Path("/home/ubuntu/frontend/docs/media")
RAW = Path("/home/ubuntu/scripts/gif-demos/raw")
BLUEPRINT = Path("/home/ubuntu/scripts/gif-demos/demo-blueprint.png")

OUT.mkdir(parents=True, exist_ok=True)
RAW.mkdir(parents=True, exist_ok=True)

CURSOR_JS = r"""
(() => {
  if (document.getElementById('pw-demo-cursor')) return;
  const style = document.createElement('style');
  style.textContent = `
    #pw-demo-cursor {
      position: fixed; z-index: 2147483647; width: 18px; height: 18px;
      margin: -2px 0 0 -2px; border-radius: 50%; pointer-events: none;
      background: #f0883e; box-shadow: 0 0 0 4px rgba(240,136,62,.4), 0 2px 8px rgba(0,0,0,.45);
      left: 40px; top: 40px; transition: left .04s linear, top .04s linear;
    }
    #pw-demo-cursor.clicking { transform: scale(.75); background: #ff7b72; }
  `;
  document.documentElement.appendChild(style);
  const el = document.createElement('div');
  el.id = 'pw-demo-cursor';
  document.documentElement.appendChild(el);
  window.addEventListener('mousemove', (e) => {
    el.style.left = e.clientX + 'px';
    el.style.top = e.clientY + 'px';
  }, true);
  window.addEventListener('mousedown', () => el.classList.add('clicking'), true);
  window.addEventListener('mouseup', () => el.classList.remove('clicking'), true);
})();
"""


async def login_token(page: Page) -> str:
    resp = await page.request.post(
        f"{BASE}/api/auth/login",
        headers={"Content-Type": "application/json"},
        data=json.dumps({"email": EMAIL, "password": PASSWORD}),
    )
    if not resp.ok:
        raise RuntimeError(f"Login failed: {resp.status} {await resp.text()}")
    return (await resp.json())["token"]


async def move_to(page: Page, x: float, y: float, steps: int = 18):
    await page.mouse.move(x, y, steps=steps)
    await page.wait_for_timeout(80)


async def click_xy(page: Page, x: float, y: float):
    await move_to(page, x, y)
    await page.mouse.down()
    await page.wait_for_timeout(90)
    await page.mouse.up()
    await page.wait_for_timeout(180)


async def box_center(page: Page, selector: str):
    loc = page.locator(selector).first
    await loc.wait_for(state="visible", timeout=12000)
    box = await loc.bounding_box()
    if not box:
        raise RuntimeError(f"No box for {selector}")
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


async def click_sel(page: Page, selector: str):
    x, y = await box_center(page, selector)
    await click_xy(page, x, y)


async def type_text(page: Page, text: str, delay: int = 30):
    await page.keyboard.type(text, delay=delay)


async def open_project(page: Page):
    text = page.get_by_text("Getting Started Demo", exact=False).first
    if await text.count():
        box = await text.bounding_box()
        if box:
            await click_xy(page, box["x"] + 24, box["y"] + box["height"] / 2)
            await page.wait_for_timeout(1400)
            return
    proj = page.locator(".proj-item, .browser-project, [data-project-id]").first
    if await proj.count():
        box = await proj.bounding_box()
        if box:
            await click_xy(page, box["x"] + 40, box["y"] + box["height"] / 2)
            await page.wait_for_timeout(1400)


def webm_to_gif(webm: Path, gif: Path, *, fps: int = 10, width: int = 720):
    palette = webm.with_suffix(".palette.png")
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(webm),
            "-vf", f"fps={fps},scale={width}:-1:flags=lanczos,palettegen=stats_mode=diff",
            str(palette),
        ],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(webm), "-i", str(palette),
            "-lavfi", f"fps={fps},scale={width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5",
            "-loop", "0",
            str(gif),
        ],
        check=True,
        capture_output=True,
    )
    palette.unlink(missing_ok=True)
    print(f"  GIF {gif.name}: {gif.stat().st_size / 1024:.0f} KB")


async def bootstrap_page(page: Page, token: str):
    await page.add_init_script(
        f"localStorage.setItem('render3d:token', {json.dumps(token)});\n{CURSOR_JS}"
    )
    await page.goto(f"{BASE}/", wait_until="domcontentloaded", timeout=60000)
    await page.wait_for_timeout(2200)
    await page.evaluate(CURSOR_JS)
    # Close auth modal if stuck
    close = page.locator("#auth-modal .auth-close, #auth-modal [data-close]").first
    if await page.locator("#auth-modal:not(.hidden)").count() and await close.count():
        try:
            await close.click(timeout=1000)
        except Exception:
            pass
    await open_project(page)
    await page.wait_for_timeout(700)


async def record_demo(browser: Browser, name: str, runner):
    video_dir = RAW / name
    if video_dir.exists():
        shutil.rmtree(video_dir)
    video_dir.mkdir(parents=True)

    # Get token with a throwaway page
    boot = await browser.new_page()
    token = await login_token(boot)
    await boot.close()

    ctx = await browser.new_context(
        viewport={"width": 1280, "height": 800},
        record_video_dir=str(video_dir),
        record_video_size={"width": 1280, "height": 800},
    )
    page = await ctx.new_page()
    print(f"Recording {name}...")
    try:
        await bootstrap_page(page, token)
        await runner(page)
    except Exception as exc:
        print(f"  WARN {name}: {exc}")
    await page.wait_for_timeout(700)
    await page.close()
    await ctx.close()

    webs = list(video_dir.glob("*.webm"))
    if not webs:
        print(f"  FAIL no video for {name}")
        return
    try:
        webm_to_gif(webs[0], OUT / f"{name}.gif")
    except subprocess.CalledProcessError as exc:
        print(f"  FAIL gif convert {name}: {exc.stderr[-400:] if exc.stderr else exc}")


async def demo_ai_generate(page: Page):
    for sel in [".prompt-editor", "#prompt-input", "textarea.prompt-input"]:
        if await page.locator(sel).count():
            try:
                await click_sel(page, sel)
                break
            except Exception:
                continue
    await page.wait_for_timeout(300)
    await type_text(page, "Make an 80x40x12 mm phone stand with a 15 degree tilt.")
    await page.wait_for_timeout(500)
    for sel in ["#prompt-submit", "button:has-text('Generate')"]:
        if await page.locator(sel).count():
            try:
                x, y = await box_center(page, sel)
                await move_to(page, x, y, steps=24)
                await page.wait_for_timeout(800)
            except Exception:
                pass
            break


async def demo_workspaces(page: Page):
    for sel in ["#btn-account", ".user-menu-btn", "#profile-btn", "button:has-text('Account')"]:
        if await page.locator(sel).count():
            try:
                await click_sel(page, sel)
                await page.wait_for_timeout(700)
                break
            except Exception:
                continue
    for label in ["Workspace", "Invite", "Team"]:
        loc = page.get_by_text(label, exact=False).first
        if await loc.count():
            box = await loc.bounding_box()
            if box:
                await move_to(page, box["x"] + 16, box["y"] + 8)
                await page.wait_for_timeout(450)
    await page.wait_for_timeout(700)


async def demo_share_folders(page: Page):
    # Prefer API-created folder visible in UI after refresh folders — try New folder button
    created = False
    for sel in ["button:has-text('New folder')", "button:has-text('Folder')", "[title*='folder' i]"]:
        if await page.locator(sel).count():
            try:
                await click_sel(page, sel)
                await page.wait_for_timeout(350)
                await type_text(page, "Demo Shared Folder")
                await page.keyboard.press("Enter")
                await page.wait_for_timeout(900)
                created = True
                break
            except Exception:
                continue
    folder = page.get_by_text("Demo Shared Folder", exact=False).first
    if not await folder.count():
        folder = page.locator(".folder-row, .browser-folder, [data-folder-id]").first
    if await folder.count():
        box = await folder.bounding_box()
        if box:
            await move_to(page, box["x"] + 28, box["y"] + box["height"] / 2)
            await page.mouse.click(box["x"] + 28, box["y"] + box["height"] / 2, button="right")
            await page.wait_for_timeout(500)
            share = page.get_by_text("Share", exact=True).first
            if await share.count():
                sbox = await share.bounding_box()
                if sbox:
                    await click_xy(page, sbox["x"] + 18, sbox["y"] + sbox["height"] / 2)
                    await page.wait_for_timeout(800)
                    if await page.locator("#folder-share-email").count():
                        await click_sel(page, "#folder-share-email")
                        await type_text(page, "teammate@company.com")
                        await page.wait_for_timeout(600)
                        if await page.locator("#folder-share-member").count():
                            await click_sel(page, "#folder-share-member")
                            await page.wait_for_timeout(500)
    if not created:
        await page.wait_for_timeout(400)


async def demo_reference_markup(page: Page):
    # Upload via any file input
    uploaded = False
    inputs = page.locator("input[type=file]")
    for i in range(await inputs.count()):
        try:
            await inputs.nth(i).set_input_files(str(BLUEPRINT))
            uploaded = True
            await page.wait_for_timeout(2200)
            break
        except Exception:
            continue
    if not uploaded:
        print("  (no file input accepted upload)")
    for sel in ["[data-ref-action='pen']", "button:has-text('Pen')"]:
        if await page.locator(sel).count():
            await click_sel(page, sel)
            await page.wait_for_timeout(250)
            stage = page.locator(".ref-image-stack, .ref-viewer-main img, .ref-viewer-stage").first
            if await stage.count():
                box = await stage.bounding_box()
                if box:
                    await move_to(page, box["x"] + 90, box["y"] + 90)
                    await page.mouse.down()
                    await move_to(page, box["x"] + 200, box["y"] + 150, steps=16)
                    await page.mouse.up()
            break
    if await page.locator("[data-ref-notes]").count():
        await click_sel(page, "[data-ref-notes]")
        await type_text(page, "Circle the mounting hole. Wall thickness 3 mm.")
        await page.wait_for_timeout(350)
    for sel in ["[data-ref-action='send-ai']", "button:has-text('Send to AI')"]:
        if await page.locator(sel).count():
            x, y = await box_center(page, sel)
            await move_to(page, x, y)
            await page.wait_for_timeout(700)
            break


async def demo_canvas(page: Page):
    for sel in ["button:has-text('CANVAS')", "[data-design-tab='CANVAS']", "text=CANVAS"]:
        if await page.locator(sel).count():
            try:
                await click_sel(page, sel)
                await page.wait_for_timeout(1100)
                break
            except Exception:
                continue
    canvas = page.locator("#canvas-mode-container canvas").first
    if not await canvas.count():
        canvas = page.locator("canvas").nth(1)
    if await canvas.count():
        box = await canvas.bounding_box()
        if box:
            await move_to(page, box["x"] + 120, box["y"] + 110)
            await page.mouse.down()
            await move_to(page, box["x"] + 240, box["y"] + 90, steps=14)
            await move_to(page, box["x"] + 280, box["y"] + 200, steps=14)
            await move_to(page, box["x"] + 120, box["y"] + 110, steps=14)
            await page.mouse.up()
            await page.wait_for_timeout(500)
    for sel in ["#canvas-attach-prompt-btn", "button:has-text('Attach')"]:
        if await page.locator(sel).count():
            try:
                x, y = await box_center(page, sel)
                await move_to(page, x, y)
                await page.wait_for_timeout(650)
            except Exception:
                pass
            break


async def demo_picks(page: Page):
    for sel in ["button:has-text('Face')", "[title*='Face' i]", "button:has-text('Pick')"]:
        if await page.locator(sel).count():
            try:
                await click_sel(page, sel)
                await page.wait_for_timeout(450)
                break
            except Exception:
                continue
    vp = page.locator("#viewport").first
    if await vp.count():
        box = await vp.bounding_box()
        if box:
            await click_xy(page, box["x"] + box["width"] * 0.55, box["y"] + box["height"] * 0.45)
            await page.wait_for_timeout(400)
    if await page.locator(".prompt-editor, #prompt-input").count():
        try:
            await click_sel(page, ".prompt-editor, #prompt-input")
            await type_text(page, "Fillet @face-1 with 2 mm radius.")
            await page.wait_for_timeout(550)
        except Exception:
            pass


async def demo_wiring(page: Page):
    for sel in ["button:has-text('Wiring')", "text=Wiring Simulator"]:
        if await page.locator(sel).count():
            try:
                await click_sel(page, sel)
                await page.wait_for_timeout(1300)
                break
            except Exception:
                continue
    if await page.locator("button:has-text('Example')").count():
        try:
            await click_sel(page, "button:has-text('Example')")
            await page.wait_for_timeout(900)
        except Exception:
            pass
    ta = page.locator("#wiring-prompt, textarea").first
    if await ta.count() and await ta.is_visible():
        try:
            await click_sel(page, "#wiring-prompt, textarea")
            await type_text(page, "Arduino Uno blink LED on pin 13 with 220 ohm resistor.")
            await page.wait_for_timeout(650)
        except Exception:
            pass


async def demo_cloud(page: Page):
    for text in ["Fusion 360", "Fusion", "Onshape"]:
        loc = page.get_by_text(text, exact=False).first
        if await loc.count():
            try:
                await loc.scroll_into_view_if_needed()
                box = await loc.bounding_box()
                if box:
                    await move_to(page, box["x"] + 18, box["y"] + 10)
                    await page.wait_for_timeout(400)
                    await click_xy(page, box["x"] + 18, box["y"] + 10)
                    await page.wait_for_timeout(1000)
                break
            except Exception:
                continue
    await page.wait_for_timeout(700)


async def demo_agent(page: Page):
    for sel in ["#btn-render-agent", "button:has-text('Agent')"]:
        if await page.locator(sel).count():
            await click_sel(page, sel)
            await page.wait_for_timeout(1000)
            break
    if await page.locator("#render-agent-input").count():
        await click_sel(page, "#render-agent-input")
        await type_text(page, "How do I share a private folder with a teammate?")
        await page.wait_for_timeout(500)
        btn = page.locator("#render-agent-form button[type='submit']").first
        if await btn.count():
            box = await btn.bounding_box()
            if box:
                await move_to(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                await page.wait_for_timeout(700)


async def main():
    demos = [
        ("ai-generate", demo_ai_generate),
        ("workspaces", demo_workspaces),
        ("share-folder", demo_share_folders),
        ("reference-markup", demo_reference_markup),
        ("canvas", demo_canvas),
        ("picks", demo_picks),
        ("wiring", demo_wiring),
        ("cloud-sync", demo_cloud),
        ("render-agent", demo_agent),
    ]
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        for name, runner in demos:
            await record_demo(browser, name, runner)
        await browser.close()
    print("Done. GIFs in", OUT)
    for g in sorted(OUT.glob("*.gif")):
        print(f" - {g.name} ({g.stat().st_size/1024:.0f} KB)")


if __name__ == "__main__":
    asyncio.run(main())
