#!/usr/bin/env python3
"""Record Getting Started GIFs — dramatic cursor, agent forced closed, real tool flows.

Standalone path so parallel agents cannot clobber this file.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import shutil
import subprocess
import traceback
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[2]

from playwright.async_api import Browser, Page, async_playwright

BASE = "http://127.0.0.1:8001"
EMAIL = "demo.docs.gif@r3d-studios.com"
PASSWORD = "DemoGif2026!"
PROJECT_ID = "2a5e7651"  # fallback; record_demo prefers seeded Robot Arm
ROBOT_ARM_SOURCE = "505279e3"
OUT = _REPO_ROOT / "frontend" / "docs" / "media"
RAW = _REPO_ROOT / "scripts" / "gif-demos" / "raw-v2"
BLUEPRINT = _REPO_ROOT / "scripts" / "gif-demos" / "demo-blueprint.png"
USER_ID = "4d950fbd-b44"

OUT.mkdir(parents=True, exist_ok=True)
RAW.mkdir(parents=True, exist_ok=True)

CURSOR_JS = r"""
(() => {
  const ensure = () => {
    let style = document.getElementById('pw-demo-cursor-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'pw-demo-cursor-style';
      style.textContent = `
        #pw-demo-cursor {
          position: fixed; z-index: 2147483647; width: 0; height: 0;
          pointer-events: none; left: 40px; top: 40px;
          border-style: solid;
          border-width: 0 18px 30px 0;
          border-color: transparent #ff8a3d transparent transparent;
          transform: rotate(-15deg);
          filter: drop-shadow(2px 2px 0 #111) drop-shadow(0 0 8px rgba(255,120,40,.7));
        }
        #pw-demo-cursor::after {
          content: '';
          position: absolute; left: -2px; top: 22px;
          width: 14px; height: 22px;
          background: #ff8a3d;
          border: 2px solid #111;
          border-radius: 2px;
          transform: rotate(35deg);
          transform-origin: top left;
        }
        #pw-demo-cursor.clicking { transform: rotate(-15deg) scale(.82); }
        #pw-demo-ripple {
          position: fixed; z-index: 2147483646; width: 28px; height: 28px;
          margin: -14px 0 0 -14px; border-radius: 50%; pointer-events: none;
          border: 4px solid #ff7b39; box-shadow: 0 0 0 10px rgba(255,123,57,.4);
          opacity: 0; left: 0; top: 0;
        }
        #pw-demo-ripple.burst { animation: pwRipple .55s ease-out forwards; }
        @keyframes pwRipple {
          0% { opacity: 1; transform: scale(.3); }
          100% { opacity: 0; transform: scale(3.8); }
        }
        #activity-log, .activity-log { display: none !important; }
        html.pw-hide-agent #render-agent-panel {
          display: none !important; visibility: hidden !important; pointer-events: none !important;
        }
        *, *::before, *::after { cursor: none !important; }
      `;
      document.documentElement.appendChild(style);
    }
    document.documentElement.classList.add('pw-hide-agent');
    if (window.__pwAllowAgent) document.documentElement.classList.remove('pw-hide-agent');
    document.documentElement.style.cursor = 'none';
    if (document.body) document.body.style.cursor = 'none';
    let el = document.getElementById('pw-demo-cursor');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pw-demo-cursor';
      document.documentElement.appendChild(el);
    }
    let ripple = document.getElementById('pw-demo-ripple');
    if (!ripple) {
      ripple = document.createElement('div');
      ripple.id = 'pw-demo-ripple';
      document.documentElement.appendChild(ripple);
    }
    if (!window.__pwCursorBound) {
      window.__pwCursorBound = true;
      window.addEventListener('mousemove', (e) => {
        window.__pwLastMouse = { x: e.clientX, y: e.clientY };
        const c = document.getElementById('pw-demo-cursor');
        if (c) { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }
      }, true);
      window.addEventListener('mousedown', (e) => {
        const c = document.getElementById('pw-demo-cursor');
        c && c.classList.add('clicking');
        const r = document.getElementById('pw-demo-ripple');
        if (r) {
          r.style.left = e.clientX + 'px';
          r.style.top = e.clientY + 'px';
          r.classList.remove('burst');
          void r.offsetWidth;
          r.classList.add('burst');
        }
      }, true);
      window.addEventListener('mouseup', () => {
        document.getElementById('pw-demo-cursor')?.classList.remove('clicking');
      }, true);
      // Keep cursor alive if SPA nukes it
      const mo = new MutationObserver(() => {
        if (!document.getElementById('pw-demo-cursor')) ensure();
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    }
    const m = window.__pwLastMouse;
    if (m) { el.style.left = m.x + 'px'; el.style.top = m.y + 'px'; }
  };
  ensure();
  window.__pwEnsureCursor = ensure;
})();
"""


def auth_init(token: str, project_id: str | None = None) -> str:
    pid = project_id or PROJECT_ID
    return f"""
localStorage.setItem('render3d:token', {json.dumps(token)});
localStorage.setItem('render3d:lastProjectId', {json.dumps(pid)});
localStorage.setItem('render3d:demoRobotArmProjectId', {json.dumps(pid)});
localStorage.setItem('render3d:renderAgentSeen:anonymous', '1');
localStorage.setItem('render3d:renderAgentSeen:{USER_ID}', '1');
localStorage.setItem('render3d:skipStudioBootOnce:v1', '1');
localStorage.setItem('render3d:aiSetupIntroDismissed:v1', '1');
localStorage.setItem('render3d:aiSetupIntroDismissed:v1:{USER_ID}', '1');
{CURSOR_JS}
"""


async def ensure_robot_arm_project(page: Page, token: str) -> str:
    """Spin up (or reuse) the private Robot Arm demo for the GIF account."""
    resp = await page.request.post(
        f"{BASE}/api/demo/robot-arm",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    if not resp.ok:
        print(f"  robot-arm seed failed: {resp.status} {await resp.text()}", flush=True)
        return PROJECT_ID
    data = await resp.json()
    pid = data.get("project_id") or PROJECT_ID
    print(f"  robot-arm project: {pid} (created={data.get('created')})", flush=True)
    return pid


async def open_robot_arm(page: Page):
    title = page.get_by_text("Robot Arm", exact=False).first
    if await title.count():
        try:
            await title.click(timeout=4000)
            await page.wait_for_timeout(1600)
            return
        except Exception:
            pass
    # Fallback: click any project row that looks like the demo
    loc = page.locator(".proj-item, .project-item, [data-project-id]").first
    if await loc.count():
        try:
            await loc.click(timeout=3000)
            await page.wait_for_timeout(1200)
        except Exception:
            pass


async def ready_studio(page: Page, *, open_project: bool = True):
    page.set_default_timeout(8000)
    await page.wait_for_function(
        "() => !!document.querySelector('.prompt-editor') && !!document.getElementById('btn-render-agent')",
        timeout=35000,
    )
    await page.evaluate(CURSOR_JS)
    await force_close_agent(page)
    # Dismiss boot + AI setup intro so demos aren't blocked by modals.
    await page.evaluate(
        """() => {
          document.getElementById('studio-boot-screen')?.remove();
          document.body.classList.remove('studio-booting');
          document.getElementById('ai-setup-intro-modal')?.classList.add('hidden');
          document.getElementById('welcome-modal')?.classList.add('hidden');
          try {
            localStorage.setItem('render3d:aiSetupIntroDismissed:v1', '1');
            localStorage.setItem('render3d:aiSetupIntroDismissed:v1:4d950fbd-b44', '1');
          } catch (_) {}
        }"""
    )
    if open_project:
        await open_robot_arm(page)
        # Also try legacy Getting Started Demo name
        title = page.get_by_text("Getting Started Demo", exact=False).first
        if await title.count() and not await page.get_by_text("Robot Arm", exact=False).count():
            try:
                await title.click(timeout=2000)
                await page.wait_for_timeout(900)
            except Exception:
                pass
    await page.evaluate(CURSOR_JS)
    await force_close_agent(page)
    await page.locator(".prompt-editor").wait_for(state="visible", timeout=12000)


async def record_demo(browser: Browser, name: str, runner):
    frames_dir = RAW / name / "frames"
    if (RAW / name).exists():
        shutil.rmtree(RAW / name)
    frames_dir.mkdir(parents=True)

    boot = await browser.new_page()
    token = await login_token(boot)
    robot_pid = await ensure_robot_arm_project(boot, token)
    await boot.close()
    init = auth_init(token, robot_pid)

    # Warm without recording
    warm = await browser.new_context(viewport={"width": 1280, "height": 900})
    warm_page = await warm.new_page()
    await warm_page.add_init_script(init)
    await warm_page.goto(f"{BASE}/?project={robot_pid}", wait_until="domcontentloaded", timeout=45000)
    await ready_studio(warm_page)
    storage = await warm.storage_state()
    await warm.close()

    ctx = await browser.new_context(
        viewport={"width": 1280, "height": 900},
        storage_state=storage,
    )
    page = await ctx.new_page()
    page.set_default_timeout(8000)
    await page.add_init_script(init)
    print(f"Recording {name}...", flush=True)
    rec = FrameRecorder(page, frames_dir, fps=3.5 if name == "source-parts" else 6.0)
    try:
        await page.goto(f"{BASE}/?project={robot_pid}", wait_until="domcontentloaded", timeout=45000)
        await page.evaluate(CURSOR_JS)
        await ready_studio(page, open_project=True)
        await page.evaluate(CURSOR_JS)
        await force_close_agent(page)
        # Verify cursor is live before capturing
        ok = await page.evaluate("() => !!document.getElementById('pw-demo-cursor')")
        if not ok:
            await page.evaluate(CURSOR_JS)
        await rec.start()
        await page.mouse.move(600, 380, steps=10)
        await asyncio.wait_for(runner(page), timeout=150 if name == "source-parts" else 90)
        await page.wait_for_timeout(400)
    except Exception as exc:
        print(f"  WARN {name}: {exc}", flush=True)
        traceback.print_exc()
    n = await rec.stop()
    await page.close()
    await ctx.close()
    print(f"  captured {n} frames", flush=True)
    if n < 4:
        print(f"  FAIL too few frames for {name}", flush=True)
        return
    try:
        frames_to_gif(frames_dir, OUT / f"{name}.gif", fps=6, width=720)
    except Exception as exc:
        print(f"  FAIL gif convert {name}: {exc}", flush=True)
    # Free disk mid-run
    shutil.rmtree(RAW / name, ignore_errors=True)


class FrameRecorder:
    """JPEG frame capture — Playwright video does not include DOM cursor overlays."""

    def __init__(self, page: Page, out_dir: Path, fps: float = 6.0):
        self.page = page
        self.out_dir = out_dir
        self.fps = fps
        self._task = None
        self._n = 0
        self._running = False

    async def start(self):
        if self.out_dir.exists():
            shutil.rmtree(self.out_dir)
        self.out_dir.mkdir(parents=True)
        self._n = 0
        self._running = True
        self._task = asyncio.create_task(self._loop())

    async def _loop(self):
        interval = 1.0 / self.fps
        while self._running:
            t0 = asyncio.get_event_loop().time()
            try:
                await self.page.evaluate(
                    """() => {
                      if (window.__pwEnsureCursor) window.__pwEnsureCursor();
                      const el = document.getElementById('pw-demo-cursor');
                      const m = window.__pwLastMouse;
                      if (el && m) {
                        el.style.left = m.x + 'px';
                        el.style.top = m.y + 'px';
                        el.style.display = 'block';
                        el.style.opacity = '1';
                        el.style.visibility = 'visible';
                        el.style.zIndex = '2147483647';
                      }
                      return !!el;
                    }"""
                )
                exists = await self.page.evaluate("() => !!document.getElementById('pw-demo-cursor')")
                if not exists:
                    await self.page.evaluate(CURSOR_JS)
                path = self.out_dir / f"f{self._n:04d}.jpg"
                await self.page.screenshot(
                    path=str(path),
                    type="jpeg",
                    quality=62,
                    timeout=2500,
                    animations="disabled",
                )
                self._n += 1
            except Exception as exc:
                print(f"  screenshot warn: {exc}", flush=True)
            elapsed = asyncio.get_event_loop().time() - t0
            await asyncio.sleep(max(0.01, interval - elapsed))

    async def stop(self) -> int:
        self._running = False
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=6)
            except Exception:
                self._task.cancel()
        return self._n


def frames_to_gif(frames_dir: Path, gif: Path, *, fps: int = 6, width: int = 720):
    pattern = str(frames_dir / "f%04d.jpg")
    palette = frames_dir / "palette.png"
    n = len(list(frames_dir.glob("f*.jpg")))
    if n < 4:
        raise RuntimeError(f"too few frames: {n}")
    subprocess.run(
        [
            "ffmpeg", "-y", "-framerate", str(fps), "-i", pattern,
            "-vf", f"fps={fps},scale={width}:-1:flags=lanczos,palettegen=max_colors=80:stats_mode=diff",
            "-frames:v", "1", "-update", "1", str(palette),
        ],
        check=True,
        capture_output=True,
    )
    subprocess.run(
        [
            "ffmpeg", "-y", "-framerate", str(fps), "-i", pattern, "-i", str(palette),
            "-lavfi", f"fps={fps},scale={width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=4",
            "-loop", "0", str(gif),
        ],
        check=True,
        capture_output=True,
    )
    palette.unlink(missing_ok=True)
    print(f"  GIF {gif.name}: {gif.stat().st_size / 1024:.0f} KB ({n} frames)", flush=True)


async def login_token(page: Page) -> str:
    resp = await page.request.post(
        f"{BASE}/api/auth/login",
        headers={"Content-Type": "application/json"},
        data=json.dumps({"email": EMAIL, "password": PASSWORD}),
    )
    if not resp.ok:
        raise RuntimeError(f"Login failed: {resp.status} {await resp.text()}")
    return (await resp.json())["token"]


async def move_to(page: Page, x: float, y: float, steps: int = 32):
    await page.mouse.move(x, y, steps=max(12, steps))
    await page.wait_for_timeout(140)


async def click_xy(page: Page, x: float, y: float, *, hold_ms: int = 160):
    await move_to(page, x, y)
    await page.wait_for_timeout(200)
    await page.mouse.down()
    await page.wait_for_timeout(hold_ms)
    await page.mouse.up()
    await page.wait_for_timeout(280)


async def box_center(page: Page, selector: str, timeout: int = 8000):
    loc = page.locator(selector).first
    await loc.wait_for(state="visible", timeout=timeout)
    try:
        await loc.scroll_into_view_if_needed(timeout=2000)
    except Exception:
        pass
    await page.wait_for_timeout(80)
    box = await loc.bounding_box()
    if not box:
        raise RuntimeError(f"No box for {selector}")
    # If still below the fold, scroll window
    vp = page.viewport_size or {"width": 1280, "height": 900}
    cy = box["y"] + box["height"] / 2
    if cy > vp["height"] - 40 or box["y"] < 0:
        await page.evaluate(
            """([sel, vh]) => {
              const el = document.querySelector(sel);
              if (!el) return;
              el.scrollIntoView({ block: 'center', inline: 'nearest' });
              const panel = el.closest('.prompt-panel, #prompt-panel, .right-panel, #right-panel');
              if (panel) {
                const r = el.getBoundingClientRect();
                if (r.bottom > vh - 20) panel.scrollTop += (r.bottom - (vh - 40));
              }
            }""",
            [selector.split(",")[0].strip(), vp["height"]],
        )
        await page.wait_for_timeout(120)
        box = await loc.bounding_box()
        if not box:
            raise RuntimeError(f"No box for {selector} after scroll")
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


async def click_sel(page: Page, selector: str, timeout: int = 8000):
    x, y = await box_center(page, selector, timeout=timeout)
    await click_xy(page, x, y)


async def type_text(page: Page, text: str, delay: int = 40):
    await page.keyboard.type(text, delay=delay)


async def allow_agent(page: Page):
    await page.evaluate(
        """() => {
          window.__pwAllowAgent = true;
          document.documentElement.classList.remove('pw-hide-agent');
          const p = document.getElementById('render-agent-panel');
          if (p) { p.style.display = ''; p.style.visibility = ''; }
        }"""
    )


async def force_close_agent(page: Page):
    await page.evaluate(
        """() => {
          window.__pwAllowAgent = false;
          document.documentElement.classList.add('pw-hide-agent');
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('render3d:renderAgentSeen:')) localStorage.setItem(k, '1');
          }
          const p = document.getElementById('render-agent-panel');
          if (p) { p.classList.add('hidden'); }
          document.getElementById('render-agent-close')?.click();
        }"""
    )
    await page.wait_for_timeout(120)


async def clear_prompt(page: Page):
    await page.evaluate(
        """() => {
          const ed = document.querySelector('.prompt-editor');
          if (ed) {
            ed.innerHTML = '';
            ed.classList.add('is-empty');
            ed.dispatchEvent(new InputEvent('input', { bubbles: true }));
          }
          const ta = document.getElementById('prompt-input');
          if (ta) {
            ta.value = '';
            ta.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }"""
    )


async def focus_prompt(page: Page):
    # Make sure compose panel shows prompt + Generate above the fold
    await page.evaluate(
        """() => {
          const btn = document.getElementById('btn-prompt');
          const ed = document.querySelector('.prompt-editor');
          (btn || ed)?.scrollIntoView({ block: 'center' });
        }"""
    )
    await page.wait_for_timeout(150)
    editor = page.locator(".prompt-editor").first
    await editor.wait_for(state="visible", timeout=12000)
    box = await editor.bounding_box()
    if not box:
        raise RuntimeError("prompt editor missing box")
    await click_xy(page, box["x"] + min(48, box["width"] / 2), box["y"] + min(28, box["height"] / 2))
    await clear_prompt(page)


async def close_overlays(page: Page):
    await force_close_agent(page)
    for sel in ["#auth-modal .auth-close", "#folder-share-modal .app-dialog-close"]:
        loc = page.locator(sel).first
        try:
            if await loc.count() and await loc.is_visible():
                await loc.click(timeout=500)
        except Exception:
            pass
    try:
        await page.keyboard.press("Escape")
    except Exception:
        pass


async def demo_ai_generate(page: Page):
    await force_close_agent(page)
    await focus_prompt(page)
    await type_text(page, "Make an 80x40x12 mm phone stand with a 15 degree tilt.")
    await page.wait_for_timeout(400)
    x, y = await box_center(page, "#btn-prompt")
    await move_to(page, x, y, steps=36)
    await page.wait_for_timeout(450)
    await click_xy(page, x, y)
    await page.wait_for_timeout(1000)


async def demo_workspaces(page: Page):
    await force_close_agent(page)
    for sel in ["#team-select", "#workspace-name", "#btn-create-workspace"]:
        loc = page.locator(sel).first
        if not (await loc.count() and await loc.is_visible()):
            continue
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
            await page.wait_for_timeout(350)
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
    # Prefer folder chrome — not the activity-log "Created folder ..." label
    folder = page.locator(
        ".folder-zone:has-text('Demo Shared Folder'), "
        ".folder-header:has-text('Demo Shared Folder'), "
        "[data-folder-name='Demo Shared Folder']"
    ).first
    try:
        await folder.wait_for(state="visible", timeout=8000)
    except Exception:
        await page.evaluate(
            """() => {
              const nodes = [...document.querySelectorAll('.folder-zone, .folder-header, .folder-name')];
              const el = nodes.find((n) => (n.textContent || '').includes('Demo Shared Folder'));
              el?.scrollIntoView({ block: 'center' });
            }"""
        )
        await page.wait_for_timeout(400)
        await folder.wait_for(state="visible", timeout=8000)
    box = await folder.bounding_box()
    if box:
        await move_to(page, box["x"] + 40, box["y"] + box["height"] / 2, steps=28)
        await page.wait_for_timeout(300)
    menu_sel = (
        ".folder-zone:has-text('Demo Shared Folder') .btn-folder-menu, "
        ".folder-header:has-text('Demo Shared Folder') .btn-folder-menu"
    )
    menu = page.locator(menu_sel).first
    if await menu.count() and await menu.is_visible():
        await click_sel(page, menu_sel)
    elif box:
        await page.mouse.move(box["x"] + max(8, box["width"] - 18), box["y"] + box["height"] / 2)
        await page.wait_for_timeout(350)
        if await menu.count() and await menu.is_visible():
            await click_sel(page, menu_sel)
        else:
            await page.mouse.click(box["x"] + 28, box["y"] + box["height"] / 2, button="right")
    await page.wait_for_timeout(450)
    share = page.locator('[data-action="share"], button:has-text("Share folder")').first
    await share.wait_for(state="visible", timeout=6000)
    sbox = await share.bounding_box()
    await click_xy(page, sbox["x"] + 24, sbox["y"] + sbox["height"] / 2)
    await page.wait_for_timeout(600)
    email = page.locator("#folder-share-email").first
    if await email.count() and await email.is_visible():
        await click_sel(page, "#folder-share-email")
        await type_text(page, "teammate@company.com")
        await page.wait_for_timeout(350)
        submit = page.locator("#folder-share-submit").first
        if await submit.count() and await submit.is_visible():
            box = await submit.bounding_box()
            if box:
                await move_to(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=28)
                await click_xy(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                await page.wait_for_timeout(800)


async def demo_reference_markup(page: Page):
    """Upload a PDF → Docs-style tab opens → Pen markup → notes → Send to AI."""
    await force_close_agent(page)
    # Boot overlay can steal the first paint — clear it for this demo.
    await page.evaluate(
        """() => {
          const boot = document.getElementById('studio-boot-screen');
          if (boot) {
            boot.remove();
            document.body.classList.remove('studio-booting');
          }
        }"""
    )
    pdf_path = _REPO_ROOT / "scripts" / "gif-demos" / "demo-drawing.pdf"
    if not pdf_path.exists():
        pdf_path = BLUEPRINT

    # Upload via project file input (accepts PDF) so uploadReferenceProjectFile opens the tab.
    upload_input = page.locator("#file-upload").first
    if await upload_input.count():
        upload_btn = page.locator("#btn-upload, button:has-text('Upload CAD')").first
        if await upload_btn.count() and await upload_btn.is_visible():
            box = await upload_btn.bounding_box()
            if box:
                await move_to(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=22)
                await page.wait_for_timeout(250)
        await upload_input.set_input_files(str(pdf_path))
        await page.wait_for_timeout(700)
    else:
        print("  (#file-upload missing)", flush=True)

    # Confirm visible "Add to current project" (there can be duplicate modal nodes in DOM).
    dest = page.locator("#drop-destination-modal:not(.hidden) #drop-destination-current").first
    if await dest.count():
        try:
            await dest.wait_for(state="visible", timeout=4000)
            box = await dest.bounding_box()
            if box:
                await move_to(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=18)
                await click_xy(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        except Exception as exc:
            print(f"  dest modal: {exc}", flush=True)
            await page.evaluate(
                """() => {
                  const btn = document.querySelector('#drop-destination-modal:not(.hidden) #drop-destination-current');
                  btn?.click();
                }"""
            )
    await page.wait_for_timeout(1600)

    # If upload didn't auto-open the Docs tab, open the PDF from Reference Files.
    has_tab = await page.locator(".ref-viewer-toolbar, .ref-pdf-page, .dxf-tab.active").count()
    if not has_tab:
        await page.evaluate(
            """() => {
              const li = document.querySelector('.browser-item[data-filename$=".pdf"], .browser-item[data-filename*="demo-drawing"]');
              if (!li) return false;
              li.scrollIntoView({ block: 'center' });
              const btn = li.querySelector('button.browser-item-body');
              (btn || li).click();
              return true;
            }"""
        )
        await page.wait_for_timeout(1800)

    try:
        await page.wait_for_selector(".ref-viewer-toolbar, .ref-pdf-page", timeout=10000)
    except Exception as exc:
        print(f"  PDF tab wait: {exc}", flush=True)

    # Linger on the open PDF Docs tab.
    await page.wait_for_timeout(500)
    pdf_page = page.locator(".ref-pdf-page, .ref-viewer-stage").first
    if await pdf_page.count():
        box = await pdf_page.bounding_box()
        if box:
            await move_to(page, box["x"] + box["width"] * 0.45, box["y"] + box["height"] * 0.4, steps=14)
            await page.wait_for_timeout(200)

    # Pen tool (data-ref-tool, not data-ref-action).
    pen = page.locator("[data-ref-tool='pen']").first
    if await pen.count() and await pen.is_visible():
        box = await pen.bounding_box()
        if box:
            await move_to(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=12)
            await click_xy(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, hold_ms=100)
        await page.wait_for_timeout(180)

        stage = page.locator(".ref-pdf-page, [data-ref-image-stack], .ref-viewer-stage").first
        if await stage.count():
            box = await stage.bounding_box()
            if box:
                x0 = box["x"] + box["width"] * 0.28
                y0 = box["y"] + box["height"] * 0.35
                x1 = box["x"] + box["width"] * 0.62
                y1 = box["y"] + box["height"] * 0.58
                await move_to(page, x0, y0, steps=10)
                await page.mouse.down()
                await move_to(page, x1, y0 + 18, steps=8)
                await move_to(page, x1, y1, steps=8)
                await move_to(page, x0, y1, steps=6)
                await page.mouse.up()
                await page.wait_for_timeout(200)

    notes = page.locator("#ref-notes-input, [data-ref-notes]").first
    if await notes.count() and await notes.is_visible():
        await notes.click(timeout=2000)
        await notes.fill("Circle the M6 holes — keep 3 mm walls.")
        await page.wait_for_timeout(200)

    for sel in ["[data-ref-action='save']", "[data-ref-action='send-ai']"]:
        btn = page.locator(sel).first
        if await btn.count() and await btn.is_visible():
            box = await btn.bounding_box()
            if box:
                await move_to(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=12)
                await click_xy(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, hold_ms=100)
                await page.wait_for_timeout(400)

    await page.wait_for_timeout(600)


async def demo_canvas(page: Page):
    await force_close_agent(page)
    tab = page.locator("[data-design-tab='CANVAS']").first
    if await tab.count() and await tab.is_visible():
        await click_sel(page, "[data-design-tab='CANVAS']")
    else:
        loc = page.get_by_text("CANVAS", exact=True).first
        box = await loc.bounding_box()
        await click_xy(page, box["x"] + 10, box["y"] + box["height"] / 2)
    await page.wait_for_timeout(1100)
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
            await click_xy(page, x, y)
            await page.wait_for_timeout(700)
            break


async def demo_picks(page: Page):
    await force_close_agent(page)
    await open_robot_arm(page)
    await click_sel(page, "#btn-pick-face")
    await page.wait_for_timeout(400)
    vp = page.locator("#viewport").first
    if not await vp.count():
        vp = page.locator("canvas").first
    box = await vp.bounding_box()
    if box:
        for sx, sy in [(0.52, 0.40), (0.48, 0.48)]:
            await click_xy(page, box["x"] + box["width"] * sx, box["y"] + box["height"] * sy)
            await page.wait_for_timeout(350)
    await focus_prompt(page)
    await type_text(page, "Fillet @face-1 with a 2 mm radius.")
    await page.wait_for_timeout(350)
    x, y = await box_center(page, "#btn-prompt")
    await move_to(page, x, y, steps=30)
    await click_xy(page, x, y)
    await page.wait_for_timeout(700)


async def demo_select_object(page: Page):
    """Click whole robot arm, then double-click a body/part."""
    await force_close_agent(page)
    await open_robot_arm(page)
    await page.wait_for_timeout(800)
    # Activate Select tool
    for sel in ["#btn-pick-object", "button[data-mode='object']"]:
        loc = page.locator(sel).first
        if await loc.count() and await loc.is_visible():
            await click_sel(page, sel)
            break
    await page.wait_for_timeout(400)
    vp = page.locator("#viewport canvas, #viewport, canvas").first
    box = await vp.bounding_box()
    if not box:
        return
    # Single click — whole object
    cx = box["x"] + box["width"] * 0.52
    cy = box["y"] + box["height"] * 0.42
    await click_xy(page, cx, cy, hold_ms=180)
    await page.wait_for_timeout(700)
    # Double-click — part/body
    px = box["x"] + box["width"] * 0.58
    py = box["y"] + box["height"] * 0.34
    await move_to(page, px, py, steps=28)
    await page.wait_for_timeout(250)
    await page.mouse.dblclick(px, py)
    await page.wait_for_timeout(900)


async def demo_wiring(page: Page):
    await force_close_agent(page)
    # Switch workspace mode → Wiring Simulator
    mode_btn = page.locator("#workspace-mode-btn").first
    if await mode_btn.count() and await mode_btn.is_visible():
        await click_sel(page, "#workspace-mode-btn")
        await page.wait_for_timeout(400)
        wiring_item = page.get_by_text("Wiring Simulator", exact=False).first
        if await wiring_item.count() and await wiring_item.is_visible():
            box = await wiring_item.bounding_box()
            await click_xy(page, box["x"] + 20, box["y"] + box["height"] / 2)
            await page.wait_for_timeout(1100)
    # Fallback: right-panel Wiring tab
    tab = page.locator("button.right-panel-tab[data-right-tab='wiring']").first
    if await tab.count() and await tab.is_visible():
        await click_sel(page, "button.right-panel-tab[data-right-tab='wiring']")
        await page.wait_for_timeout(800)
    for sel in ["#btn-wiring-toolbelt-demo-blink", "button:has-text('Demo: Blink')"]:
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
                await click_xy(page, x, y)
                await page.wait_for_timeout(800)
                break
    else:
        await page.mouse.move(640, 360, steps=24)
        await page.wait_for_timeout(400)
        await page.mouse.move(900, 420, steps=20)
        await page.wait_for_timeout(700)


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
                await page.wait_for_timeout(400)
                await click_xy(page, box["x"] + 60, box["y"] + box["height"] / 2)
                await page.wait_for_timeout(500)
                await page.keyboard.press("Escape")
                await page.wait_for_timeout(250)
                menu = page.locator("#user-menu, .user-menu").first
                if not (await menu.count() and await menu.is_visible()):
                    await click_sel(page, "#btn-auth")
                    await page.wait_for_timeout(350)
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(250)
    for text in ["FUSION LIBRARY", "ONSHAPE LIBRARY"]:
        loc = page.get_by_text(text, exact=False).first
        if await loc.count() and await loc.is_visible():
            await loc.scroll_into_view_if_needed()
            box = await loc.bounding_box()
            if box:
                await move_to(page, box["x"] + 24, box["y"] + 10, steps=24)
                await click_xy(page, box["x"] + 24, box["y"] + 10)
                await page.wait_for_timeout(900)
            break


async def demo_agent(page: Page):
    await allow_agent(page)
    await page.evaluate(
        """() => {
          document.documentElement.classList.remove('pw-hide-agent');
          const p = document.getElementById('render-agent-panel');
          if (p) {
            p.classList.add('hidden');
            p.style.display = '';
            p.style.visibility = '';
          }
        }"""
    )
    await page.wait_for_timeout(300)
    await click_sel(page, "#btn-render-agent")
    await page.wait_for_timeout(500)
    # Force panel open if click didn't
    await page.evaluate(
        """() => {
          document.documentElement.classList.remove('pw-hide-agent');
          const p = document.getElementById('render-agent-panel');
          if (p) {
            p.classList.remove('hidden');
            p.style.display = 'flex';
            p.style.visibility = 'visible';
          }
        }"""
    )
    await page.wait_for_timeout(400)
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
            await click_xy(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            await page.wait_for_timeout(1200)


async def demo_preferences(page: Page):
    """Open Preferences from the account menu and show theme / mouse / simulated motion."""
    await force_close_agent(page)
    await page.evaluate(
        """() => {
          document.getElementById('ai-setup-intro-modal')?.classList.add('hidden');
          document.getElementById('welcome-modal')?.classList.add('hidden');
          document.getElementById('studio-boot-screen')?.remove();
          document.body.classList.remove('studio-booting');
        }"""
    )

    # Account menu
    auth = page.locator("#btn-auth").first
    if await auth.count() and await auth.is_visible():
        box = await auth.bounding_box()
        if box:
            await move_to(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=12)
            await click_xy(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, hold_ms=90)
    await page.wait_for_timeout(280)

    pref_btn = page.locator("#btn-preferences-menu").first
    if await pref_btn.count() and await pref_btn.is_visible():
        box = await pref_btn.bounding_box()
        if box:
            await move_to(page, box["x"] + 36, box["y"] + box["height"] / 2, steps=10)
            await click_xy(page, box["x"] + 36, box["y"] + box["height"] / 2, hold_ms=90)
    else:
        await page.evaluate("() => document.getElementById('btn-preferences-menu')?.click()")

    await page.evaluate(
        """() => {
          const panel = document.getElementById('profile-preferences-panel');
          if (panel) panel.classList.remove('hidden');
        }"""
    )
    try:
        await page.wait_for_selector(
            "#profile-preferences-panel:not(.hidden) #profile-preferences-title",
            timeout=6000,
        )
    except Exception as exc:
        print(f"  preferences panel wait: {exc}", flush=True)

    await page.wait_for_timeout(450)

    # Mouse controls — open select and pick SolidWorks if present
    mouse = page.locator("#pref-mouse-preset").first
    if await mouse.count() and await mouse.is_visible():
        await mouse.scroll_into_view_if_needed()
        box = await mouse.bounding_box()
        if box:
            await move_to(page, box["x"] + box["width"] * 0.55, box["y"] + box["height"] / 2, steps=8)
            await click_xy(page, box["x"] + box["width"] * 0.55, box["y"] + box["height"] / 2, hold_ms=80)
        try:
            vals = await mouse.evaluate(
                "el => [...el.options].map(o => o.value)"
            )
            pick = next((v for v in vals if v and v != (await mouse.input_value())), None)
            if pick:
                await mouse.select_option(pick)
        except Exception:
            pass
        await page.wait_for_timeout(350)

    # Appearance theme
    theme = page.locator("#pref-app-theme").first
    if await theme.count():
        try:
            await theme.scroll_into_view_if_needed()
        except Exception:
            pass
        if await theme.is_visible():
            box = await theme.bounding_box()
            if box:
                await move_to(page, box["x"] + box["width"] * 0.55, box["y"] + box["height"] / 2, steps=8)
                await click_xy(page, box["x"] + box["width"] * 0.55, box["y"] + box["height"] / 2, hold_ms=80)
            try:
                current = await theme.input_value()
                vals = await theme.evaluate("el => [...el.options].map(o => o.value)")
                pick = next((v for v in vals if v and v != current), None)
                if pick:
                    await theme.select_option(pick)
            except Exception:
                pass
            await page.wait_for_timeout(350)

    # Advanced → Simulated motion
    adv = page.locator("#pref-advanced-toggle").first
    if await adv.count() and await adv.is_visible():
        box = await adv.bounding_box()
        if box:
            await move_to(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=8)
            await click_xy(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, hold_ms=80)
        await page.wait_for_timeout(280)

    gen_tab = page.locator("[data-preferences-advanced-tab='generation']").first
    if await gen_tab.count() and await gen_tab.is_visible():
        box = await gen_tab.bounding_box()
        if box:
            await move_to(page, box["x"] + 24, box["y"] + box["height"] / 2, steps=8)
            await click_xy(page, box["x"] + 24, box["y"] + box["height"] / 2, hold_ms=80)
        await page.wait_for_timeout(250)

    motion = page.locator("#pref-advanced-sim-motion").first
    if await motion.count():
        try:
            await motion.scroll_into_view_if_needed()
        except Exception:
            pass
        if await motion.is_visible():
            box = await motion.bounding_box()
            if box:
                await move_to(page, box["x"] + box["width"] * 0.55, box["y"] + box["height"] / 2, steps=8)
                await click_xy(page, box["x"] + box["width"] * 0.55, box["y"] + box["height"] / 2, hold_ms=80)
            try:
                await motion.select_option("both")
            except Exception:
                try:
                    await motion.select_option(index=min(2, await motion.locator("option").count() - 1))
                except Exception:
                    pass
            await page.wait_for_timeout(500)

    await page.wait_for_timeout(650)


async def demo_source_parts(page: Page):
    """Click ⓘ on a component → source online → drag sourced part into Wiring AI prompt."""
    await force_close_agent(page)
    await page.evaluate(
        """() => {
          document.getElementById('ai-setup-intro-modal')?.classList.add('hidden');
          document.getElementById('welcome-modal')?.classList.add('hidden');
          document.getElementById('studio-boot-screen')?.remove();
          document.body.classList.remove('studio-booting');
        }"""
    )
    await open_robot_arm(page)
    await page.wait_for_timeout(600)

    # Expand Components and reveal the ⓘ profile button.
    await page.evaluate(
        """() => {
          const toggles = [...document.querySelectorAll('.browser-section-toggle')];
          for (const t of toggles) {
            if (/components/i.test(t.textContent || '')) {
              const section = t.closest('.browser-section');
              const list = section?.querySelector('.browser-item-list');
              if (list && getComputedStyle(list).display === 'none') t.click();
            }
          }
          const li = document.querySelector('.browser-item[data-section="components"]');
          li?.scrollIntoView({ block: 'center' });
        }"""
    )
    await page.wait_for_timeout(400)

    # Hover component row then click ⓘ
    row = page.locator('.browser-item[data-section="components"]').first
    info = page.locator('.browser-item[data-section="components"] .browser-action-profile').first
    if await row.count():
        box = await row.bounding_box()
        if box:
            await move_to(page, box["x"] + min(120, box["width"] * 0.55), box["y"] + box["height"] / 2, steps=14)
            await page.wait_for_timeout(250)
    if await info.count():
        try:
            await info.scroll_into_view_if_needed()
        except Exception:
            pass
        box = await info.bounding_box()
        if box:
            await move_to(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=12)
            await click_xy(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, hold_ms=100)
        else:
            await page.evaluate(
                """() => document.querySelector('.browser-item[data-section="components"] .browser-action-profile')?.click()"""
            )
    else:
        await page.evaluate(
            """() => document.querySelector('.browser-item[data-section="components"] .browser-action-profile')?.click()"""
        )

    try:
        await page.wait_for_selector(".comp-profile-overlay:not(.hidden)", timeout=8000)
    except Exception as exc:
        print(f"  profile overlay wait: {exc}", flush=True)
        return

    await page.wait_for_timeout(500)

    # Search catalog and Use this
    search = page.locator(".comp-profile-search").first
    if await search.count() and await search.is_visible():
        box = await search.bounding_box()
        if box:
            await move_to(page, box["x"] + 40, box["y"] + box["height"] / 2, steps=8)
            await click_xy(page, box["x"] + 40, box["y"] + box["height"] / 2, hold_ms=70)
        await search.fill("nema 17 stepper")
        await page.wait_for_timeout(200)
        search_btn = page.locator(".comp-profile-search-btn").first
        if await search_btn.count() and await search_btn.is_visible():
            box = await search_btn.bounding_box()
            if box:
                await move_to(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=8)
                await click_xy(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, hold_ms=70)
        # Wait for catalog results without burning the whole timeout on typing.
        try:
            await page.wait_for_selector(".comp-profile-use", timeout=12000)
        except Exception:
            await page.wait_for_timeout(1200)

    use_btn = page.locator(".comp-profile-use").first
    try:
        await use_btn.wait_for(state="visible", timeout=10000)
        box = await use_btn.bounding_box()
        if box:
            await move_to(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=12)
            await click_xy(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, hold_ms=100)
        await page.wait_for_timeout(1200)
    except Exception as exc:
        print(f"  use-this wait: {exc}", flush=True)

    save_btn = page.locator(".comp-profile-save").first
    if await save_btn.count() and await save_btn.is_visible():
        box = await save_btn.bounding_box()
        if box:
            await move_to(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=10)
            await click_xy(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, hold_ms=80)
        await page.wait_for_timeout(500)

    # Close profile
    close_btn = page.locator(".comp-profile-close, .comp-profile-cancel").first
    if await close_btn.count() and await close_btn.is_visible():
        box = await close_btn.bounding_box()
        if box:
            await move_to(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=8)
            await click_xy(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, hold_ms=80)
        await page.wait_for_timeout(350)
    else:
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(250)

    # Switch to Wiring Simulator
    mode_btn = page.locator("#workspace-mode-btn").first
    if await mode_btn.count() and await mode_btn.is_visible():
        await click_sel(page, "#workspace-mode-btn")
        await page.wait_for_timeout(300)
        wiring_item = page.get_by_text("Wiring Simulator", exact=False).first
        if await wiring_item.count() and await wiring_item.is_visible():
            box = await wiring_item.bounding_box()
            if box:
                await click_xy(page, box["x"] + 20, box["y"] + box["height"] / 2, hold_ms=90)
                await page.wait_for_timeout(900)
    tab = page.locator("button.right-panel-tab[data-right-tab='wiring']").first
    if await tab.count() and await tab.is_visible():
        await click_sel(page, "button.right-panel-tab[data-right-tab='wiring']")
        await page.wait_for_timeout(500)

    # Drag sourced component into the Wiring AI prompt
    src = page.locator('.browser-item[data-section="components"] .browser-item-body, .browser-item[data-section="components"]').first
    dest = page.locator("#wiring-prompt-input").first
    if await src.count() and await dest.count():
        try:
            await dest.scroll_into_view_if_needed()
        except Exception:
            pass
        sbox = await src.bounding_box()
        dbox = await dest.bounding_box()
        if sbox and dbox:
            await move_to(page, sbox["x"] + 40, sbox["y"] + sbox["height"] / 2, steps=12)
            await page.mouse.down()
            await move_to(
                page,
                dbox["x"] + dbox["width"] * 0.45,
                dbox["y"] + dbox["height"] * 0.45,
                steps=22,
            )
            await page.mouse.up()
            await page.wait_for_timeout(700)
            # Fallback: HTML5 drag_to if mouse drag didn't attach a chip
            chips = await page.locator("#wiring-prompt-input .prompt-ref-chip, .wiring-prompt-ref, [data-wiring-ref]").count()
            if chips == 0:
                try:
                    await src.drag_to(dest, force=True)
                    await page.wait_for_timeout(600)
                except Exception as exc:
                    print(f"  drag_to fallback: {exc}", flush=True)
                    # Last resort: synthesize drop via evaluate using explorer payload if present
                    await page.evaluate(
                        """() => {
                          const input = document.getElementById('wiring-prompt-input');
                          const li = document.querySelector('.browser-item[data-section="components"]');
                          if (!input || !li) return;
                          input.focus();
                          input.value = (input.value || '') + '\\n@component-1 (sourced part for wiring)';
                          input.dispatchEvent(new Event('input', { bubbles: true }));
                        }"""
                    )
                    await page.wait_for_timeout(400)

    await page.wait_for_timeout(800)


async def _click_workspace_tab(page: Page, label: str):
    tab = page.locator("#workspace-tabs button, .workspace-tabs button, .workspace-tab").filter(has_text=label).first
    if await tab.count() and await tab.is_visible():
        box = await tab.bounding_box()
        if box:
            await move_to(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=24)
            await page.wait_for_timeout(250)
        await tab.click(timeout=4000)
        await page.wait_for_timeout(700)
        return True
    return False


async def demo_multi_gen(page: Page):
    """Two quick Generate clicks so the viewport banner shows parallel rows."""
    await force_close_agent(page)
    await focus_prompt(page)
    await clear_prompt(page)
    await type_text(page, "Make a 40mm cube with 4mm fillets.")
    await page.wait_for_timeout(300)
    x, y = await box_center(page, "#btn-prompt")
    await move_to(page, x, y, steps=28)
    await click_xy(page, x, y)
    await page.wait_for_timeout(900)
    await focus_prompt(page)
    await clear_prompt(page)
    await type_text(page, "Make a 60mm cylinder stand next to it.")
    await page.wait_for_timeout(250)
    x, y = await box_center(page, "#btn-prompt")
    await move_to(page, x, y, steps=24)
    await click_xy(page, x, y)
    # Linger on the multi-gen banner if it appeared
    banner = page.locator("#canvas-generation-banner, .viewport-generation-banner, .gen-progress-row").first
    try:
        await banner.wait_for(state="visible", timeout=4000)
        box = await banner.bounding_box()
        if box:
            await move_to(page, box["x"] + min(120, box["width"] / 2), box["y"] + box["height"] / 2, steps=20)
    except Exception:
        pass
    await page.wait_for_timeout(1400)


async def demo_link_to_prompt(page: Page):
    """Shift-select project files and drag into the AI prompt."""
    await force_close_agent(page)
    await focus_prompt(page)
    await clear_prompt(page)
    files = page.locator(".proj-item, .proj-row, .project-file-row, .file-row").filter(has_text=re.compile(r"\.(glb|step|stl|obj)", re.I))
    if await files.count() < 1:
        files = page.locator(".proj-item, .proj-row").filter(has_text=re.compile(r".+", re.I))
    count = await files.count()
    if count < 1:
        await page.wait_for_timeout(800)
        return
    first = files.nth(0)
    await first.scroll_into_view_if_needed()
    box = await first.bounding_box()
    if not box:
        return
    await move_to(page, box["x"] + 28, box["y"] + box["height"] / 2, steps=22)
    await page.wait_for_timeout(200)
    await page.mouse.click(box["x"] + 28, box["y"] + box["height"] / 2)
    await page.wait_for_timeout(250)
    if count >= 2:
        second = files.nth(1)
        sbox = await second.bounding_box()
        if sbox:
            await page.keyboard.down("Shift")
            await move_to(page, sbox["x"] + 28, sbox["y"] + sbox["height"] / 2, steps=18)
            await page.mouse.click(sbox["x"] + 28, sbox["y"] + sbox["height"] / 2)
            await page.keyboard.up("Shift")
            await page.wait_for_timeout(300)
            start = sbox
        else:
            start = box
    else:
        start = box
    prompt = page.locator(".prompt-editor, #prompt-input, textarea.prompt-editor").first
    pbox = await prompt.bounding_box()
    if not pbox:
        return
    await page.mouse.move(start["x"] + 24, start["y"] + start["height"] / 2)
    await page.mouse.down()
    await move_to(page, pbox["x"] + pbox["width"] / 2, pbox["y"] + pbox["height"] / 2, steps=36)
    await page.mouse.up()
    await page.wait_for_timeout(1100)


async def demo_solid_tools(page: Page):
    await force_close_agent(page)
    await _click_workspace_tab(page, "SOLID")
    # Hover a few ribbon tools
    for sel in [
        ".ribbon-btn, .ribbon-tool, [data-ribbon-id]",
        "#btn-press-pull, #btn-transform, .tool-btn",
    ]:
        tools = page.locator(sel)
        n = min(await tools.count(), 4)
        for i in range(n):
            t = tools.nth(i)
            if not await t.is_visible():
                continue
            box = await t.bounding_box()
            if not box:
                continue
            await move_to(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=16)
            await page.wait_for_timeout(280)
        if n:
            break
    await page.wait_for_timeout(700)


async def demo_sketch(page: Page):
    await force_close_agent(page)
    await _click_workspace_tab(page, "SKETCH")
    await page.wait_for_timeout(500)
    # Hover sketch tools / plane picker if present
    for sel in [".ribbon-btn", ".sketch-tool", "#btn-sketch-line", ".ribbon-panel button"]:
        tools = page.locator(sel)
        n = min(await tools.count(), 3)
        for i in range(n):
            t = tools.nth(i)
            if not await t.is_visible():
                continue
            box = await t.bounding_box()
            if not box:
                continue
            await move_to(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=14)
            await page.wait_for_timeout(250)
        if n:
            break
    await page.wait_for_timeout(900)


async def demo_rigging_urdf(page: Page):
    await force_close_agent(page)
    await _click_workspace_tab(page, "RIGGING")
    await page.wait_for_timeout(500)
    urdf_btn = page.locator("[data-rigging-mode='urdf'], .rigging-mode-btn").filter(has_text=re.compile(r"URDF", re.I)).first
    if await urdf_btn.count() and await urdf_btn.is_visible():
        box = await urdf_btn.bounding_box()
        if box:
            await move_to(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=20)
            await page.wait_for_timeout(200)
        await urdf_btn.click(timeout=4000)
        await page.wait_for_timeout(700)
    for sel in ["#btn-rigging-author-jake", "#btn-rigging-generate-urdf", "#btn-rigging-open-motion"]:
        loc = page.locator(sel).first
        if await loc.count() and await loc.is_visible():
            box = await loc.bounding_box()
            if box:
                await move_to(page, box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, steps=18)
                await page.wait_for_timeout(350)
    await page.wait_for_timeout(900)


DEMOS = {
    "ai-generate": demo_ai_generate,
    "workspaces": demo_workspaces,
    "share-folder": demo_share_folders,
    "reference-markup": demo_reference_markup,
    "canvas": demo_canvas,
    "picks": demo_picks,
    "select-object": demo_select_object,
    "wiring": demo_wiring,
    "cloud-sync": demo_cloud,
    "render-agent": demo_agent,
    "preferences": demo_preferences,
    "source-parts": demo_source_parts,
    "multi-gen": demo_multi_gen,
    "link-to-prompt": demo_link_to_prompt,
    "solid-tools": demo_solid_tools,
    "sketch": demo_sketch,
    "rigging-urdf": demo_rigging_urdf,
}


async def main(only: list[str] | None = None):
    names = only or list(DEMOS.keys())
    async with async_playwright() as p:
        for name in names:
            runner = DEMOS.get(name)
            if not runner:
                print(f"Unknown demo: {name}", flush=True)
                continue
            browser = await p.chromium.launch(
                headless=True,
                args=["--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"],
            )
            try:
                await record_demo(browser, name, runner)
            finally:
                await browser.close()
            await asyncio.sleep(0.5)
    print("Done. GIFs in", OUT, flush=True)
    for g in sorted(OUT.glob("*.gif")):
        print(f" - {g.name} ({g.stat().st_size / 1024:.0f} KB)", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("demos", nargs="*", help="Optional demo names to record")
    args = parser.parse_args()
    asyncio.run(main(args.demos or None))
