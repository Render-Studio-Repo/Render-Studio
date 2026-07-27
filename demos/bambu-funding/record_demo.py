#!/usr/bin/env python3
"""Record a Render Studio platform tour MP4 for Bambu funding submission."""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "out"
OUT_DIR.mkdir(parents=True, exist_ok=True)

BASE = "http://127.0.0.1:8001"
# Showcase projects with rich content
PROJECT_CAD = "20069e9d"  # Arduino Stepper — CAD + wiring + architect
PROJECT_ARCH = "acb0570a"  # House Framing
PROJECT_ROBOT = "caeb7b19"  # Compact Robotic Cooking Workcell

VIEWPORT = {"width": 1440, "height": 900}


def mint_token() -> str:
    sys.path.insert(0, "/home/ubuntu")
    from backend.auth import create_access_token

    return create_access_token("6500dec9-c06")


CAPTION_JS = """
([title, subtitle]) => {
  let el = document.getElementById('r3d-demo-caption');
  if (!el) {
    el = document.createElement('div');
    el.id = 'r3d-demo-caption';
    el.style.cssText = `
      position: fixed; left: 28px; bottom: 28px; z-index: 2147483646;
      max-width: min(560px, 70vw); padding: 14px 18px; border-radius: 14px;
      background: rgba(8,12,20,0.82); border: 1px solid rgba(148,163,184,0.35);
      box-shadow: 0 16px 40px rgba(0,0,0,0.45); backdrop-filter: blur(10px);
      color: #f3f6fa; font-family: Inter, system-ui, sans-serif;
      pointer-events: none; transition: opacity .25s ease;
    `;
    el.innerHTML = '<div id="r3d-demo-title" style="font-size:18px;font-weight:800;letter-spacing:-0.02em"></div><div id="r3d-demo-sub" style="margin-top:4px;font-size:13px;color:#9fb0c3;line-height:1.35"></div>';
    document.body.appendChild(el);
  }
  el.style.opacity = '1';
  document.getElementById('r3d-demo-title').textContent = title || '';
  document.getElementById('r3d-demo-sub').textContent = subtitle || '';
}
"""

HIDE_CAPTION_JS = """
() => {
  const el = document.getElementById('r3d-demo-caption');
  if (el) el.style.opacity = '0';
}
"""

TITLE_CARD_JS = """
([title, subtitle]) => {
  let el = document.getElementById('r3d-demo-titlecard');
  if (!el) {
    el = document.createElement('div');
    el.id = 'r3d-demo-titlecard';
    el.style.cssText = `
      position: fixed; inset: 0; z-index: 2147483647; display: grid; place-items: center;
      background: radial-gradient(ellipse at 30% 20%, #1a2740 0%, #070b12 55%, #05070c 100%);
      color: #f3f6fa; font-family: Inter, system-ui, sans-serif; text-align: center;
      padding: 40px;
    `;
    el.innerHTML = `
      <div>
        <img src="/render3d-logo.png" alt="" style="width:72px;height:72px;border-radius:50%;margin-bottom:18px;box-shadow:0 0 28px rgba(88,166,255,.45)" />
        <div id="r3d-tc-title" style="font-size:42px;font-weight:800;letter-spacing:-0.03em"></div>
        <div id="r3d-tc-sub" style="margin-top:12px;font-size:18px;color:#9fb0c3;max-width:640px;margin-left:auto;margin-right:auto;line-height:1.4"></div>
        <div style="margin-top:28px;font-size:13px;color:#6e7f93;letter-spacing:.08em;text-transform:uppercase">render3d.app</div>
      </div>`;
    document.body.appendChild(el);
  }
  el.style.display = 'grid';
  document.getElementById('r3d-tc-title').textContent = title;
  document.getElementById('r3d-tc-sub').textContent = subtitle;
}
"""

HIDE_TITLE_JS = """
() => {
  const el = document.getElementById('r3d-demo-titlecard');
  if (el) el.style.display = 'none';
}
"""


async def caption(page, title: str, subtitle: str = "", hold: float = 2.2):
    await page.evaluate(CAPTION_JS, [title, subtitle])
    await page.wait_for_timeout(int(hold * 1000))


async def drag_orbit(page, selector: str = "#viewport canvas", steps: int = 18):
    canvas = page.locator(selector).first
    if await canvas.count() == 0:
        canvas = page.locator("canvas").first
    box = await canvas.bounding_box()
    if not box:
        return
    x = box["x"] + box["width"] * 0.55
    y = box["y"] + box["height"] * 0.45
    await page.mouse.move(x, y)
    await page.mouse.down()
    for i in range(steps):
        await page.mouse.move(x + (i + 1) * 10, y + (i % 3) * 2)
        await page.wait_for_timeout(40)
    await page.mouse.up()
    await page.wait_for_timeout(400)


async def safe_click(page, selectors: list[str], timeout: int = 2500) -> bool:
    for sel in selectors:
        loc = page.locator(sel).first
        try:
            if await loc.count() == 0:
                continue
            await loc.click(timeout=timeout, force=True)
            await page.wait_for_timeout(500)
            return True
        except Exception:
            continue
    return False


async def soft(step_name: str, coro):
    try:
        await coro
    except Exception as exc:
        print(f"[demo] skip {step_name}: {exc}", flush=True)


async def dismiss_overlays(page):
    for sel in [
        "#render-agent-close",
        "#welcome-modal .welcome-close",
        "#welcome-modal button:has-text('Skip')",
        "#welcome-modal button:has-text('Close')",
        "#studio-walkthrough-skip",
        "button:has-text('Got it')",
        "button:has-text('Skip tour')",
        ".studio-boot-skip",
        "#btn-quest-dismiss",
    ]:
        try:
            loc = page.locator(sel).first
            if await loc.count() and await loc.is_visible():
                await loc.click(timeout=800)
                await page.wait_for_timeout(300)
        except Exception:
            pass
    # Force-hide sticky agent deck if it still covers the UI
    await page.evaluate(
        """() => {
          const panel = document.getElementById('render-agent-panel');
          if (panel) {
            panel.classList.add('hidden');
            panel.style.display = 'none';
          }
          document.getElementById('welcome-modal')?.classList?.add('hidden');
        }"""
    )
    await page.keyboard.press("Escape")
    await page.wait_for_timeout(200)


async def open_authenticated(page, path: str, token: str):
    # Seed auth once on about:blank-safe navigation
    cur = page.url or ""
    if "127.0.0.1:8001" not in cur and "localhost:8001" not in cur:
        await page.goto(f"{BASE}/", wait_until="domcontentloaded", timeout=90000)
        await page.evaluate(
            """(token) => {
              localStorage.setItem('render3d:token', token);
              localStorage.setItem('render3d:welcomeSeen', '1');
              localStorage.setItem('render3d:studioWalkthroughDone', '1');
              localStorage.setItem('render3d:questBookSeen', '1');
            }""",
            token,
        )
    try:
        await page.goto(f"{BASE}{path}", wait_until="domcontentloaded", timeout=90000)
    except Exception as exc:
        print(f"[demo] goto {path} failed: {exc}", flush=True)
        # Fallback: open project in-app without full reload
        import re

        m = re.search(r"project=([a-f0-9]+)", path)
        if m:
            await page.evaluate(
                """(id) => {
                  if (window.__openProject) return window.__openProject(id);
                  location.href = '/?project=' + id;
                }""",
                m.group(1),
            )
            await page.wait_for_timeout(4000)
    await page.wait_for_timeout(2000)
    await dismiss_overlays(page)
    await page.wait_for_timeout(600)
    await dismiss_overlays(page)


async def wait_viewport(page, ms: int = 8000):
    try:
        await page.wait_for_selector("#viewport canvas, canvas", timeout=ms)
    except Exception:
        pass
    await page.wait_for_timeout(1200)


async def run() -> Path:
    token = mint_token()
    video_dir = OUT_DIR / f"raw-{int(time.time())}"
    video_dir.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=[
                "--ignore-certificate-errors",
                "--use-gl=angle",
                "--enable-webgl",
                "--disable-dev-shm-usage",
            ],
        )
        context = await browser.new_context(
            viewport=VIEWPORT,
            device_scale_factor=1,
            record_video_dir=str(video_dir),
            record_video_size=VIEWPORT,
        )
        context.set_default_timeout(20000)
        page = await context.new_page()
        page.set_default_navigation_timeout(90000)

        # ── Opening title ──
        await page.goto(f"{BASE}/", wait_until="domcontentloaded")
        await page.evaluate(
            TITLE_CARD_JS,
            ["Render Studio", "AI CAD workspace — design, wire, architect, and simulate in one platform"],
        )
        await page.wait_for_timeout(3200)
        await page.evaluate(HIDE_TITLE_JS)

        # ── Auth into Studio ──
        await open_authenticated(page, f"/?project={PROJECT_CAD}", token)
        await wait_viewport(page)
        await caption(
            page,
            "Studio viewport",
            "Load assemblies, orbit the model, and iterate with AI in one workspace",
            2.4,
        )
        await drag_orbit(page)
        await page.wait_for_timeout(900)

        # Prompt / AI panel
        await safe_click(page, ["#btn-prompt", "[data-right-tab='prompt']", "button:has-text('AI')"])
        await caption(page, "AI CAD generate", "Describe parts in natural language — Mode 2.0, Fusion, Architect skills", 2.5)
        await safe_click(page, ["#prompt-mode-select", "[data-prompt-mode]", "#prompt-mode-btn", "button:has-text('2.0')", "button:has-text('Render')"])
        await page.wait_for_timeout(800)
        # Type a short prompt for visual (don't submit expensive gen)
        await page.evaluate(
            """() => {
              const text = 'Add a mounting bracket for the NEMA17 stepper';
              const editor = document.querySelector('.prompt-editor[contenteditable="true"], [aria-label="AI CAD prompt"]');
              if (editor) {
                editor.focus();
                editor.textContent = text;
                editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
                return;
              }
              const el = document.querySelector('#prompt-input:not(.prompt-input--mirror)') || document.querySelector('#prompt-input');
              if (el) {
                el.value = text;
                el.dispatchEvent(new Event('input', { bubbles: true }));
              }
            }"""
        )
        await page.wait_for_timeout(1200)

        # Project tree / bodies
        await caption(page, "Project browser", "Components, bodies, drawings, and history stay organized per project", 2.2)
        await safe_click(page, ["#project-tree", ".workspace-browser", ".browser-tree", "text=Bodies"])
        await page.wait_for_timeout(1000)

        # Wiring mode
        await caption(page, "Wiring Simulator", "Drag components, generate schematics with Wiring AI, then Code & Simulate", 2.0)
        opened = await safe_click(
            page,
            [
                "#workspace-mode-btn",
                "button:has-text('Design')",
                "[data-workspace-mode]",
                ".workspace-mode-btn",
            ],
        )
        await page.wait_for_timeout(400)
        await safe_click(
            page,
            [
                "button:has-text('Wiring')",
                "[data-mode='wiring']",
                "[data-workspace-mode='wiring']",
                "#workspace-mode-menu button:has-text('Wiring')",
            ],
        )
        await page.wait_for_timeout(1800)
        await safe_click(page, ["#btn-wiring-generate", "button:has-text('Generate')", "[data-right-tab='wiring']"])
        await page.wait_for_timeout(1000)
        # Demo schematic buttons if present
        await safe_click(page, ["button:has-text('Blink')", "button:has-text('Stepper')"])
        await page.wait_for_timeout(1500)
        await safe_click(page, ["button:has-text('Circuit layout')", "text=Circuit layout"])
        await page.wait_for_timeout(1200)

        # Architect
        await caption(page, "Architect Mode", "Paint wall bays, rooms, doors, and windows on a 3 ft lattice", 2.0)
        await safe_click(page, ["#workspace-mode-btn", ".workspace-mode-btn", "button:has-text('Wiring')"])
        await page.wait_for_timeout(300)
        await safe_click(
            page,
            [
                "button:has-text('Architect')",
                "[data-mode='architect']",
                "[data-workspace-mode='architect']",
                "[data-design-tab='ARCHITECT']",
                ".architect-mode-tab",
            ],
        )
        await page.wait_for_timeout(2200)
        await drag_orbit(page, steps=14)
        # Paint a short wall stroke if canvas present
        try:
            canvas = page.locator("#viewport canvas, canvas").first
            box = await canvas.bounding_box()
            if box:
                x0 = box["x"] + box["width"] * 0.35
                y0 = box["y"] + box["height"] * 0.55
                await page.mouse.move(x0, y0)
                await page.mouse.down()
                await page.mouse.move(x0 + 120, y0, steps=12)
                await page.mouse.up()
                await page.wait_for_timeout(800)
        except Exception:
            pass

        # Switch to house framing for stronger architect shot
        try:
            await open_authenticated(page, f"/?project={PROJECT_ARCH}", token)
            await wait_viewport(page)
            await safe_click(
                page,
                [
                    "button:has-text('Architect')",
                    "[data-design-tab='ARCHITECT']",
                    ".architect-mode-tab",
                ],
            )
            await page.wait_for_timeout(1800)
            await caption(page, "Architectural plans", "Floor plans become 3D wall meshes you can edit live", 2.4)
            await drag_orbit(page, steps=16)
        except Exception as exc:
            print(f"[demo] architect project skip: {exc}", flush=True)

        # Robot / cooking workcell
        try:
            await open_authenticated(page, f"/?project={PROJECT_ROBOT}", token)
            await wait_viewport(page, 12000)
            await caption(page, "Assemblies & robotics", "Multi-body assemblies, URDF/rigging, and workcell layouts", 2.5)
            await drag_orbit(page, steps=20)
            await safe_click(
                page,
                [
                    "button:has-text('Rigging')",
                    "[data-design-tab='RIGGING']",
                    "#workspace-mode-menu button:has-text('Rigging')",
                ],
            )
            await page.wait_for_timeout(1500)
        except Exception as exc:
            print(f"[demo] robot project skip: {exc}", flush=True)

        # Marketplace / Agent Store
        try:
            await caption(page, "Marketplace", "Browse models, agents, and boost apps across the community", 1.8)
            await page.goto(f"{BASE}/marketplace.html", wait_until="domcontentloaded", timeout=90000)
            await page.wait_for_timeout(2200)
            await page.mouse.wheel(0, 600)
            await page.wait_for_timeout(1000)
            await page.mouse.wheel(0, 600)
            await page.wait_for_timeout(1000)
        except Exception as exc:
            print(f"[demo] marketplace skip: {exc}", flush=True)

        # Docs / landing flavor
        try:
            await page.goto(f"{BASE}/docs.html", wait_until="domcontentloaded", timeout=90000)
            await caption(page, "Docs & APIs", "Ship automations with the Render Studio API and skills", 2.0)
            await page.wait_for_timeout(800)
        except Exception as exc:
            print(f"[demo] docs skip: {exc}", flush=True)

        # Closing card
        try:
            await page.goto(f"{BASE}/", wait_until="domcontentloaded", timeout=90000)
        except Exception:
            pass
        await page.evaluate(
            TITLE_CARD_JS,
            ["Build. Wire. Architect. Ship.", "Render Studio — the AI workspace for hardware teams · render3d.app"],
        )
        await page.wait_for_timeout(3600)

        await context.close()
        await browser.close()

    videos = list(video_dir.glob("*.webm"))
    if not videos:
        raise SystemExit("No video recorded")
    # Playwright names the file after the page; take the largest
    videos.sort(key=lambda p: p.stat().st_size, reverse=True)
    return videos[0]


def encode(webm: Path) -> tuple[Path, Path]:
    import subprocess

    mp4 = OUT_DIR / "Render Studio-Bambu-Platform-Tour.mp4"
    gif = OUT_DIR / "Render Studio-Bambu-Platform-Tour.gif"
    # High-quality H.264 for upload
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(webm),
            "-vf",
            "fps=30,scale=1440:-2:flags=lanczos",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-crf",
            "20",
            "-movflags",
            "+faststart",
            str(mp4),
        ],
        check=True,
    )
    # Compact GIF preview (~width 720)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(mp4),
            "-vf",
            "fps=12,scale=720:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=128[p];[s1][p]paletteuse=dither=bayer",
            "-loop",
            "0",
            str(gif),
        ],
        check=True,
    )
    return mp4, gif


if __name__ == "__main__":
    webm = asyncio.run(run())
    print("webm", webm, webm.stat().st_size)
    mp4, gif = encode(webm)
    print("mp4", mp4, mp4.stat().st_size)
    print("gif", gif, gif.stat().st_size)
