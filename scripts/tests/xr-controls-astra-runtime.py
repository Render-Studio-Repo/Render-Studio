#!/usr/bin/env python3
"""Focused XR window regression using real Three.js and synthetic controller poses.

Run against the existing server; no backend restart or project/account is used:
  .venv-mac/bin/python scripts/tests/xr-tabbed-windows-runtime.py

API requests are intercepted, and private inspection hooks are injected only in
the isolated browser response. Production source is never modified by this test.
"""
import argparse
import base64
import asyncio
import json
import re
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]


async def run(base_url, output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    source = (ROOT / "frontend/xr/viewport-xr.js").read_text()
    marker = "  return {\n    enter,\n    exit,"
    assert source.count(marker) == 1, "createViewportXR return hook changed"
    source = source.replace(marker, """  return {
    __runtimeTest: {
      tabs: () => tabbedWindows,
      agentAvatar,
      openGridPopup,
      openViewPanel,
      openAiPromptPanel,
      beginPanelDrag, updatePanelDrag,
      copyXrViewToSpectator,
      syncGripPosesFromXrFrame,
      endGrab,
      openDebugger: () => openXrDebugger(renderer.xr.getSession()),
      closeDebugger: () => closeXrDebugger(),
      debuggerHud: () => debuggerHud,
      selectPick: pickControllerSelectHit,
      restart: restartVrSceneKeepSession,
      setTool,
      state: () => ({ toolHand, drawBrush, drawColor, drawSizeId, drawPencils, voiceDraw, xrSolidDraw, lastXrConsume, lastSelectAt, prevTrigger, menuTab, explorerPanel, viewPanel, panelDrag, gripGrab, grabState, scaleGrab, passthroughOn, dockButtons, statusHits: dockButtons.filter((node) => node.userData.xrStatus), activeTool }),
    },
    enter,
    exit,""", 1)
    index = (ROOT / "frontend/index.html").read_text()
    import_map = re.search(r'<script type="importmap">(.*?)</script>', index, re.S)
    assert import_map, "Studio import map exists"
    html = ('<html><head><script type="importmap">' + import_map.group(1)
            + '</script></head><body><div id="viewport"></div></body></html>')
    program = (ROOT / "scripts/tests/xr-scene-runtime.js").read_text().split("  await enter();")[0] + "  await enter();\n"
    program = program.replace("setFoveation() {}", "setFoveation(value) { this.foveation = value; }")
    program = program.replace('getXrStudioState: () => ({}), getToken: () => "",', 'getXrStudioState: () => ({}), getToken: () => "", onUndo:()=>window.undoCalls=(window.undoCalls||0)+1, onRedo:()=>window.redoCalls=(window.redoCalls||0)+1,')
    program += (ROOT / "scripts/tests/xr-controls-astra-runtime.js").read_text()
    logs = []
    report = {}
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, args=[
            "--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
        ])
        page = await browser.new_page(viewport={"width": 1200, "height": 900})
        page.on("pageerror", lambda error: logs.append({"kind": "pageerror", "text": str(error)}))
        page.on("console", lambda message: logs.append({"kind": message.type, "text": message.text})
                if message.type in ("warning", "error") else None)
        await page.route("**/__xr-runtime-smoke", lambda route: route.fulfill(
            status=200, content_type="text/html", body=html))
        await page.route("**/xr/viewport-xr.js?runtime-smoke=*", lambda route: route.fulfill(
            status=200, content_type="application/javascript", body=source))
        await page.route("**/api/**", lambda route: route.fulfill(
            status=200, content_type="application/json", body="{}"))
        try:
            await page.goto(base_url.rstrip("/") + "/__xr-runtime-smoke")
            report = await page.evaluate(program)
            await page.screenshot(path=str(output_dir / "scene.png"))
            plate=await page.evaluate('window.__platePreview')
            if plate: (output_dir/'plate.png').write_bytes(base64.b64decode(plate.split(',')[1]))
            errors = [row for row in logs if row["kind"] == "pageerror"
                      or re.search(r"ReferenceError|TypeError|SyntaxError", row["text"])]
            assert not errors, json.dumps(errors, indent=2)
            report["passed"] = True
        except Exception as error:
            report["passed"] = False
            report["error"] = str(error)
            raise
        finally:
            if "checks" not in report:
                report["checks"] = await page.evaluate("window.__xrRuntimeChecks || []")
            report["logs"] = logs
            (output_dir / "report.json").write_text(json.dumps(report, indent=2))
            await browser.close()
    print(json.dumps({"passed": report["passed"], "checks": report["count"],
                      "report": str(output_dir / "report.json")}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8001")
    parser.add_argument("--output-dir", type=Path, default=Path("/private/tmp/xr-controller-ui"))
    args = parser.parse_args()
    asyncio.run(run(args.base_url, args.output_dir))
