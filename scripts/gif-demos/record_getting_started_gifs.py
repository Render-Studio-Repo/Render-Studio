#!/usr/bin/env python3
"""Record Getting Started demo GIFs with a dramatic visible cursor.

Uses Playwright video (memory-friendly) then ffmpeg → GIF.
Force-closes Render Agent onboarding so demos show the real tools.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import subprocess
from pathlib import Path

from playwright.async_api import Browser, Page, async_playwright

BASE = "http://127.0.0.1:8001"
EMAIL = "demo.docs.gif@r3d-studios.com"
PASSWORD = "DemoGif2026!"
OUT = Path("/home/ubuntu/frontend/docs/media")
RAW = Path("/home/ubuntu/scripts/gif-demos/raw")
BLUEPRINT = Path("/home/ubuntu/scripts/gif-demos/demo-blueprint.png")

OUT.mkdir(parents=True, exist_ok=True)
RAW.mkdir(parents=True, exist_ok=True)

# Large arrow + click ripple — readable at 720px GIF scale.
CURSOR_JS = r"""
(() => {
  if (document.getElementById('pw-demo-cursor')) return;
  const style = document.createElement('style');
  style.id = 'pw-demo-cursor-style';
  style.textContent = `
    #pw-demo-cursor {
      position: fixed; z-index: 2147483647; width: 48px; height: 48px;
      pointer-events: none; left: 40px; top: 40px;
      filter: drop-shadow(0 2px 5px rgba(0,0,0,.7));
      transition: transform .08s ease;
      will-change: left, top, transform;
    }
    #pw-demo-cursor svg { display: block; width: 48px; height: 48px; }
    #pw-demo-cursor.clicking { transform: scale(.8); }
    #pw-demo-ripple {
      position: fixed; z-index: 2147483646; width: 22px; height: 22px;
      margin: -11px 0 0 -11px; border-radius: 50%; pointer-events: none;
      border: 3px solid #ff7b39; box-shadow: 0 0 0 8px rgba(255,123,57,.35);
      opacity: 0; left: 0; top: 0;
    }
    #pw-demo-ripple.burst { animation: pwRipple .55s ease-out forwards; }
    @keyframes pwRipple {
      0% { opacity: 1; transform: scale(.35); }
      100% { opacity: 0; transform: scale(3.4); }
    }
    #activity-log, .activity-log { display: none !important; }
  `;
  document.documentElement.appendChild(style);
  const el = document.createElement('div');
  el.id = 'pw-demo-cursor';
  el.innerHTML = `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 4 L8 38 L17 29 L24 44 L31 41 L24 26 L38 26 Z"
      fill="#ff8a3d" stroke="#111" stroke-width="2.4" stroke-linejoin="round"/>
  </svg>`;
  document.documentElement.appendChild(el);
  const ripple = document.createElement('div');
  ripple.id = 'pw-demo-ripple';
  document.documentElement.appendChild(ripple);
  window.addEventListener('mousemove', (e) => {
    el.style.left = e.clientX + 'px';
    el.style.top = e.clientY + 'px';
  }, true);
  window.addEventListener('mousedown', (e) => {
    el.classList.add('clicking');
    ripple.style.left = e.clientX + 'px';
    ripple.style.top = e.clientY + 'px';
    ripple.classList.remove('burst');
    void ripple.offsetWidth;
    ripple.classList.add('burst');
  }, true);
  window.addEventListener('mouseup', () => el.classList.remove('clicking'), true);
})();
"""

FORCE_CLOSE_AGENT_JS = r"""
(() => {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('render3d:renderAgentSeen:')) localStorage.setItem(k, '1');
    }
    localStorage.setItem('render3d:renderAgentSeen:anonymous', '1');
    try {
      const t = localStorage.getItem('render3d:token') || '';
      const mid = t.split('.')[1];
      if (mid) {
        const payload = JSON.parse(atob(mid.replace(/-/g, '+').replace(/_/g, '/')));
        const id = payload.sub || payload.user_id || payload.id;
        if (id) localStorage.setItem('render3d:renderAgentSeen:' + id, '1');
      }
    } catch {}
  } catch {}
  const panel = document.getElementById('render-agent-panel');
  if (panel) {
    panel.classList.add('hidden');
    panel.style.display = 'none';
  }
  document.getElementById('render-agent-close')?.click();
})();
"""


def webm_to_gif(
    webm: Path,
    gif: Path,
    *,
    fps: int = 8,
    width: int = 720,
    start: float = 0.0,
    duration: float | None = None,
):
    palette = webm.with_suffix(".palette.png")
    trim: list[str] = []
    if start > 0:
        trim += ["-ss", str(start)]
    if duration:
        trim += ["-t", str(duration)]
    subprocess.run(
        [
            "ffmpeg", "-y", *trim, "-i", str(webm),
            "-vf", f"fps={fps},scale={width}:-1:flags=lanczos,palettegen=max_colors=96:stats_mode=diff",
            "-frames:v", "1", "-update", "1", str(palette),
        ],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        [
            "ffmpeg", "-y", *trim, "-i", str(webm), "-i", str(palette),
            "-lavfi", f"fps={fps},scale={width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5",
            "-loop", "0", str(gif),
        ],
        check=True,
        capture_output=True,
    )
    palette.unlink(missing_ok=True)
    print(f"  GIF {gif.name}: {gif.stat().st_size / 1024:.0f} KB", flush=True)


async def login_token(page: Page) -> tuple[str, str | None]:
    resp = await page.request.post(
        f"{BASE}/api/auth/login",
        headers={"Content-Type": "application/json"},
        data=json.dumps({"email": EMAIL, "password": PASSWORD}),
    )
    if not resp.ok:
        raise RuntimeError(f"Login failed: {resp.status} {await resp.text()}")
    data = await resp.json()
    token = data["token"]
    user = data.get("user") or {}
    user_id = None
    if isinstance(user, dict):
        user_id = user.get("id") or user.get("user_id")
    if not user_id:
        me = await page.request.get(
            f"{BASE}/api/auth/me",
            headers={"Authorization": f"Bearer {token}"},
        )
        if me.ok:
            body = await me.json()
            user_id = body.get("id") or body.get("user_id") or (body.get("user") or {}).get("id")
    return token, str(user_id) if user_id else None


async def move_to(page: Page, x: float, y: float, steps: int = 30):
    await page.mouse.move(x, y, steps=max(10, steps))
    await page.wait_for_timeout(140)


async def click_xy(page: Page, x: float, y: float, *, hold_ms: int = 150):
    await move_to(page, x, y)
    await page.wait_for_timeout(200)
    await page.mouse.down()
    await page.wait_for_timeout(hold_ms)
    await page.mouse.up()
    await page.wait_for_timeout(300)


async def box_center(page: Page, selector: str, timeout: int = 8000):
    loc = page.locator(selector).first
    await loc.wait_for(state="visible", timeout=timeout)
    box = await loc.bounding_box()
    if not box:
        raise RuntimeError(f"No box for {selector}")
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


async def click_sel(page: Page, selector: str, timeout: int = 8000):
    x, y = await box_center(page, selector, timeout=timeout)
    await click_xy(page, x, y)


async def type_text(page: Page, text: str, delay: int = 38):
    await page.keyboard.type(text, delay=delay)


async def force_close_agent(page: Page):
    await page.evaluate(FORCE_CLOSE_AGENT_JS)
    close = page.locator("#render-agent-close").first
    try:
        if await close.count() and await close.is_visible():
            await close.click(timeout=800)
    except Exception:
        pass
    await page.evaluate(
        """() => {
          const p = document.getElementById('render-agent-panel');
          if (p) { p.classList.add('hidden'); p.style.display = 'none'; }
        }"""
    )
    await page.wait_for_timeout(150)


async def allow_agent(page: Page):
    await page.evaluate(
        """() => {
          const p = document.getElementById('render-agent-panel');
          if (p) p.style.display = '';
        }"""
    )


async def close_overlays(page: Page):
    await force_close_agent(page)
    for sel in [
        "#auth-modal .auth-close",
        "#folder-share-modal .app-dialog-close",
        "#folder-share-modal button:has-text('Cancel')",
    ]:
        loc = page.locator(sel).first
        try:
            if await loc.count() and await loc.is_visible():
                await loc.click(timeout=600)
                await page.wait_for_timeout(120)
        except Exception:
            pass
    try:
        await page.keyboard.press("Escape")
    except Exception:
        pass
    await page.wait_for_timeout(100)


async def wait_logged_in(page: Page):
    await page.wait_for_function(
        """() => {
          const token = localStorage.getItem('render3d:token');
          const prompt = document.getElementById('prompt-input');
          const signIn = document.getElementById('btn-workspace-signin');
          const signedOut = signIn && !signIn.classList.contains('hidden') && signIn.offsetParent !== null;
          return !!token && !!prompt && !signedOut;
        }""",
        timeout=45000,
    )


async def open_demo_project(page: Page):
    text = page.get_by_text("Getting Started Demo", exact=False).first
    await text.wait_for(state="visible", timeout=12000)
    box = await text.bounding_box()
    if box:
        await click_xy(page, box["x"] + 28, box["y"] + box["height"] / 2)
        await page.wait_for_timeout(1600)


async def bootstrap_page(page: Page, token: str, user_id: str | None):
    page.set_default_timeout(8000)
    seen = ["render3d:renderAgentSeen:anonymous"]
    if user_id:
        seen.append(f"render3d:renderAgentSeen:{user_id}")
    stamp = ";".join(f"localStorage.setItem({json.dumps(k)}, '1')" for k in seen)
    await page.add_init_script(
        f"localStorage.setItem('render3d:token', {json.dumps(token)});\n{stamp};\n{CURSOR_JS}"
    )
    await page.goto(f"{BASE}/", wait_until="domcontentloaded", timeout=60000)
    await page.evaluate(CURSOR_JS)
    await wait_logged_in(page)
    await page.evaluate(FORCE_CLOSE_AGENT_JS)
    await force_close_agent(page)
    await open_demo_project(page)
    await force_close_agent(page)
    await page.locator("#prompt-input").wait_for(state="visible", timeout=15000)
    # Confirm agent is hidden before recording actions
    hidden = await page.evaluate(
        """() => {
          const p = document.getElementById('render-agent-panel');
          if (!p) return true;
          return p.classList.contains('hidden') || getComputedStyle(p).display === 'none';
        }"""
    )
    if not hidden:
        await force_close_agent(page)
    await page.wait_for_timeout(300)


async def record_demo(browser: Browser, name: str, runner):
    video_dir = RAW / name
    if video_dir.exists():
        shutil.rmtree(video_dir)
    video_dir.mkdir(parents=True)

    boot = await browser.new_page()
    token, user_id = await login_token(boot)
    await boot.close()

    ctx = await browser.new_context(
        viewport={"width": 1280, "height": 800},
        record_video_dir=str(video_dir),
        record_video_size={"width": 1280, "height": 800},
    )
    page = await ctx.new_page()
    print(f"Recording {name}...", flush=True)
    action_start = 0.0
    try:
        t0 = asyncio.get_event_loop().time()
        await bootstrap_page(page, token, user_id)
        action_start = asyncio.get_event_loop().time() - t0
        await page.mouse.move(220, 220, steps=6)
        await runner(page)
        await page.wait_for_timeout(600)
    except Exception as exc:
        print(f"  WARN {name}: {exc}", flush=True)
    await page.close()
    await ctx.close()

    webs = list(video_dir.glob("*.webm"))
    if not webs:
        print(f"  FAIL no video for {name}", flush=True)
        return
    webm = webs[0]
    start = max(0.0, action_start - 0.35)
    try:
        total = float(
            subprocess.run(
                [
                    "ffprobe", "-v", "error", "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1", str(webm),
                ],
                capture_output=True,
                text=True,
                check=True,
            ).stdout.strip()
            or 0
        )
    except Exception:
        total = 0.0
    duration = 16.0
    if total and total - start < duration:
        duration = max(4.0, total - start)
    print(f"  trim start={start:.1f}s duration={duration:.1f}s (total={total:.1f}s)", flush=True)
    try:
        webm_to_gif(webm, OUT / f"{name}.gif", start=start, duration=duration)
    except subprocess.CalledProcessError as exc:
        err = (exc.stderr or b"").decode()[-500:]
        print(f"  FAIL gif convert {name}: {err}", flush=True)


async def demo_ai_generate(page: Page):
    await force_close_agent(page)
    await click_sel(page, "#prompt-input")
    await page.locator("#prompt-input").fill("")
    await type_text(page, "Make an 80x40x12 mm phone stand with a 15 degree tilt.")
    await page.wait_for_timeout(400)
    x, y = await box_center(page, "#btn-prompt")
    await move_to(page, x, y, steps=36)
    await page.wait_for_timeout(450)
    await click_xy(page, x, y)
    await page.wait_for_timeout(900)


async def demo_workspaces(page: Page):
    await force_close_agent(page)
    for sel in ["#team-select", "#workspace-name", "#btn-create-workspace"]:
        loc = page.locator(sel).first
        if await loc.count() and await loc.is_visible():
            box = await loc.bounding_box()
            if not box:
                continue
            await move_to(page, box["x"] + min(48, box["width"] / 2), box["y"] + box["height"] / 2, steps=28)
            await page.wait_for_timeout(350)
            if sel == "#team-select":
                await click_xy(page, box["x"] + 24, box["y"] + box["height"] / 2)
                await page.wait_for_timeout(550)
                await page.keyboard.press("Escape")
                await page.wait_for_timeout(200)
    if await page.locator("#team-invite-email").count() and await page.locator("#team-invite-email").is_visible():
        await click_sel(page, "#team-invite-email")
        await type_text(page, "coworker@company.com")
        await page.wait_for_timeout(300)
        if await page.locator("#btn-team-invite").count():
            x, y = await box_center(page, "#btn-team-invite")
            await move_to(page, x, y, steps=28)
            await page.wait_for_timeout(400)
            await click_xy(page, x, y)
            await page.wait_for_timeout(700)
    if await page.locator("#btn-auth").count():
        await click_sel(page, "#btn-auth")
        await page.wait_for_timeout(450)
        if await page.locator("#btn-workspace-menu").count() and await page.locator("#btn-workspace-menu").is_visible():
            await click_sel(page, "#btn-workspace-menu")
            await page.wait_for_timeout(900)


async def demo_share_folders(page: Page):
    await force_close_agent(page)
    folder = page.get_by_text("Demo Shared Folder", exact=False).first
    await folder.wait_for(state="visible", timeout=10000)
    box = await folder.bounding_box()
    if box:
        await move_to(page, box["x"] + 40, box["y"] + box["height"] / 2, steps=28)
        await page.wait_for_timeout(300)
    menu = page.locator(
        ".folder-zone:has-text('Demo Shared Folder') .btn-folder-menu, "
        ".folder-header:has-text('Demo Shared Folder') .btn-folder-menu"
    ).first
    if await menu.count() and await menu.is_visible():
        await click_sel(
            page,
            ".folder-zone:has-text('Demo Shared Folder') .btn-folder-menu, "
            ".folder-header:has-text('Demo Shared Folder') .btn-folder-menu",
        )
    elif box:
        await page.mouse.click(box["x"] + 28, box["y"] + box["height"] / 2, button="right")
    await page.wait_for_timeout(450)
    share = page.locator('[data-action="share"], button:has-text("Share folder")').first
    await share.wait_for(state="visible", timeout=6000)
    sbox = await share.bounding_box()
    await click_xy(page, sbox["x"] + 24, sbox["y"] + sbox["height"] / 2)
    await page.wait_for_timeout(600)
    await click_sel(page, "#folder-share-email")
    await type_text(page, "teammate@company.com")
    await page.wait_for_timeout(350)
    if await page.locator("#folder-share-member").count() and await page.locator("#folder-share-member").is_visible():
        await click_sel(page, "#folder-share-member")
        await page.wait_for_timeout(350)
    submit = page.locator("#folder-share-submit").first
    if await submit.count() and await submit.is_visible():
        box = await submit.bounding_box()
        if box:
            await move_to(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=28)
            await page.wait_for_timeout(400)
            await click_xy(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            await page.wait_for_timeout(800)


async def demo_reference_markup(page: Page):
    await force_close_agent(page)
    for sel in [
        "button:has-text('Upload reference')",
        "button:has-text('Add reference')",
        "label[for='prompt-image-input']",
        "#btn-prompt-image",
    ]:
        loc = page.locator(sel).first
        if await loc.count() and await loc.is_visible():
            await click_sel(page, sel)
            await page.wait_for_timeout(350)
            break
    uploaded = False
    for sel in ["#prompt-image-input", "#prompt-kb-drop-input"]:
        loc = page.locator(sel).first
        if await loc.count():
            try:
                await loc.set_input_files(str(BLUEPRINT))
                uploaded = True
                await page.wait_for_timeout(2000)
                break
            except Exception:
                continue
    if not uploaded:
        print("  (upload skipped)", flush=True)
    pen = page.locator("[data-ref-action='pen'], button:has-text('Pen')").first
    if await pen.count() and await pen.is_visible():
        await click_sel(page, "[data-ref-action='pen'], button:has-text('Pen')")
        stage = page.locator(".ref-image-stack, .ref-viewer-main img, .ref-viewer-stage").first
        if await stage.count():
            box = await stage.bounding_box()
            if box:
                await move_to(page, box["x"] + 90, box["y"] + 90, steps=24)
                await page.mouse.down()
                await move_to(page, box["x"] + 210, box["y"] + 160, steps=16)
                await move_to(page, box["x"] + 150, box["y"] + 210, steps=12)
                await page.mouse.up()
        notes = page.locator("[data-ref-notes], textarea.ref-notes").first
        if await notes.count() and await notes.is_visible():
            await click_sel(page, "[data-ref-notes], textarea.ref-notes")
            await type_text(page, "Circle the mounting hole. Wall thickness 3 mm.")
        send = page.locator("[data-ref-action='send-ai'], button:has-text('Send to AI')").first
        if await send.count() and await send.is_visible():
            x, y = await box_center(page, "[data-ref-action='send-ai'], button:has-text('Send to AI')")
            await move_to(page, x, y, steps=26)
            await page.wait_for_timeout(350)
            await click_xy(page, x, y)
            await page.wait_for_timeout(700)
            return
    await click_sel(page, "#prompt-input")
    await type_text(page, "Use the uploaded blueprint — 3 mm walls, circle the mounting hole.")
    x, y = await box_center(page, "#btn-prompt")
    await move_to(page, x, y, steps=28)
    await page.wait_for_timeout(600)


async def demo_canvas(page: Page):
    await force_close_agent(page)
    tab = page.locator("[data-design-tab='CANVAS']").first
    if await tab.count() and await tab.is_visible():
        await click_sel(page, "[data-design-tab='CANVAS']")
    else:
        loc = page.get_by_text("CANVAS", exact=True).first
        await loc.wait_for(state="visible", timeout=5000)
        box = await loc.bounding_box()
        await click_xy(page, box["x"] + 10, box["y"] + box["height"] / 2)
    await page.wait_for_timeout(1100)
    for sel in ["button:has-text('Pen')", "[data-canvas-tool='pen']", ".canvas-tool"]:
        loc = page.locator(sel).first
        if await loc.count() and await loc.is_visible():
            await click_sel(page, sel)
            await page.wait_for_timeout(300)
            break
    canvas = page.locator(
        "#canvas-workspace canvas, #canvas-mode-container canvas, .canvas-workspace-wrap canvas"
    ).first
    if await canvas.count():
        box = await canvas.bounding_box()
        if box:
            await move_to(page, box["x"] + 140, box["y"] + 120, steps=28)
            await page.mouse.down()
            await move_to(page, box["x"] + 280, box["y"] + 90, steps=16)
            await move_to(page, box["x"] + 320, box["y"] + 240, steps=16)
            await move_to(page, box["x"] + 140, box["y"] + 120, steps=16)
            await page.mouse.up()
            await page.wait_for_timeout(450)
    for sel in ["#canvas-attach-prompt-btn", "button:has-text('Attach')", "button:has-text('Add to prompt')"]:
        loc = page.locator(sel).first
        if await loc.count() and await loc.is_visible():
            x, y = await box_center(page, sel)
            await move_to(page, x, y, steps=26)
            await page.wait_for_timeout(350)
            await click_xy(page, x, y)
            await page.wait_for_timeout(700)
            break


async def demo_picks(page: Page):
    await force_close_agent(page)
    if await page.locator("#btn-pick-orbit").count():
        await click_sel(page, "#btn-pick-orbit")
        await page.wait_for_timeout(300)
    await click_sel(page, "#btn-pick-face")
    await page.wait_for_timeout(400)
    vp = page.locator("#viewport").first
    if not await vp.count():
        vp = page.locator("canvas").first
    box = await vp.bounding_box()
    if box:
        for sx, sy in [(0.52, 0.40), (0.48, 0.48), (0.58, 0.44)]:
            await click_xy(page, box["x"] + box["width"] * sx, box["y"] + box["height"] * sy)
            await page.wait_for_timeout(320)
    await click_sel(page, "#prompt-input")
    await page.locator("#prompt-input").fill("")
    await type_text(page, "Fillet @face-1 with a 2 mm radius.")
    await page.wait_for_timeout(350)
    x, y = await box_center(page, "#btn-prompt")
    await move_to(page, x, y, steps=30)
    await page.wait_for_timeout(350)
    await click_xy(page, x, y)
    await page.wait_for_timeout(700)


async def demo_wiring(page: Page):
    await force_close_agent(page)
    await page.evaluate(
        """() => {
          const t = document.querySelector("button.right-panel-tab[data-right-tab='wiring']");
          if (t) { t.scrollIntoView({block:'center'}); }
        }"""
    )
    tab = page.locator("button.right-panel-tab[data-right-tab='wiring']").first
    if await tab.count() and await tab.is_visible():
        await click_sel(page, "button.right-panel-tab[data-right-tab='wiring']")
    else:
        await page.evaluate(
            """() => document.querySelector("button.right-panel-tab[data-right-tab='wiring']")?.click()"""
        )
    await page.wait_for_timeout(1000)
    for sel in ["#btn-wiring-toolbelt-demo-blink", "button:has-text('Demo: Blink')", "#btn-wiring-demo-blink"]:
        loc = page.locator(sel).first
        if await loc.count() and await loc.is_visible():
            await click_sel(page, sel)
            await page.wait_for_timeout(1000)
            break
    if await page.locator("#wiring-prompt-input").count() and await page.locator("#wiring-prompt-input").is_visible():
        await click_sel(page, "#wiring-prompt-input")
        await page.locator("#wiring-prompt-input").fill("")
        await type_text(page, "Arduino Uno blink LED on pin 13 with 220 ohm resistor.")
        await page.wait_for_timeout(300)
        for sel in ["#btn-wiring-prompt", "#btn-wiring-toolbelt-generate"]:
            loc = page.locator(sel).first
            if await loc.count() and await loc.is_visible():
                x, y = await box_center(page, sel)
                await move_to(page, x, y, steps=28)
                await page.wait_for_timeout(350)
                await click_xy(page, x, y)
                await page.wait_for_timeout(800)
                break


async def demo_cloud(page: Page):
    await force_close_agent(page)
    await click_sel(page, "#btn-auth")
    await page.wait_for_timeout(500)
    for sel in ["#btn-fusion-connect", "#btn-onshape-connect"]:
        loc = page.locator(sel).first
        if await loc.count() and await loc.is_visible():
            box = await loc.bounding_box()
            if box:
                await move_to(page, box["x"] + 60, box["y"] + box["height"] / 2, steps=26)
                await page.wait_for_timeout(450)
                await click_xy(page, box["x"] + 60, box["y"] + box["height"] / 2)
                await page.wait_for_timeout(600)
                await page.keyboard.press("Escape")
                await page.wait_for_timeout(250)
                menu = page.locator("#user-menu, .user-menu").first
                if not (await menu.count() and await menu.is_visible()):
                    await click_sel(page, "#btn-auth")
                    await page.wait_for_timeout(350)
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(250)
    for text in ["FUSION LIBRARY", "ONSHAPE LIBRARY", "Fusion library", "Onshape library"]:
        loc = page.get_by_text(text, exact=False).first
        if await loc.count() and await loc.is_visible():
            await loc.scroll_into_view_if_needed()
            box = await loc.bounding_box()
            if box:
                await move_to(page, box["x"] + 24, box["y"] + 10, steps=24)
                await page.wait_for_timeout(300)
                await click_xy(page, box["x"] + 24, box["y"] + 10)
                await page.wait_for_timeout(900)
            break


async def demo_agent(page: Page):
    await allow_agent(page)
    await page.evaluate(
        """() => {
          const p = document.getElementById('render-agent-panel');
          if (p) { p.classList.add('hidden'); p.style.display = ''; }
        }"""
    )
    await page.wait_for_timeout(300)
    await click_sel(page, "#btn-render-agent")
    await page.wait_for_timeout(800)
    await page.locator("#render-agent-input").wait_for(state="visible", timeout=8000)
    await click_sel(page, "#render-agent-input")
    await page.locator("#render-agent-input").fill("")
    await type_text(page, "How do I share a private folder with a teammate?")
    await page.wait_for_timeout(350)
    ask = page.locator(
        "#render-agent-form button[type='submit'], #render-agent-form button:has-text('Ask')"
    ).first
    if await ask.count():
        box = await ask.bounding_box()
        if box:
            await move_to(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=26)
            await page.wait_for_timeout(350)
            await click_xy(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            await page.wait_for_timeout(1200)


DEMOS = {
    "ai-generate": demo_ai_generate,
    "workspaces": demo_workspaces,
    "share-folder": demo_share_folders,
    "reference-markup": demo_reference_markup,
    "canvas": demo_canvas,
    "picks": demo_picks,
    "wiring": demo_wiring,
    "cloud-sync": demo_cloud,
    "render-agent": demo_agent,
}


async def main(only: list[str] | None = None):
    names = only or list(DEMOS.keys())
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
        )
        for name in names:
            runner = DEMOS.get(name)
            if not runner:
                print(f"Unknown demo: {name}", flush=True)
                continue
            await record_demo(browser, name, runner)
        await browser.close()
    print("Done. GIFs in", OUT, flush=True)
    for g in sorted(OUT.glob("*.gif")):
        print(f" - {g.name} ({g.stat().st_size / 1024:.0f} KB)", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("demos", nargs="*", help="Optional demo names to record")
    args = parser.parse_args()
    asyncio.run(main(args.demos or None))
