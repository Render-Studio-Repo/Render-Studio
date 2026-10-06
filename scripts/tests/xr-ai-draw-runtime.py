#!/usr/bin/env python3
"""Exercise spatial AI Draw in the real XR scene with synthetic controller poses.

Uses the already-running server. All API requests are intercepted. Inspection
hooks are injected into this isolated browser response, never production files.
No microphone, robot, paid AI call or persistent user project is used.
"""
import argparse
import asyncio
import json
import re
from pathlib import Path

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]


async def run(base_url, output_dir, baseline_only=False, assets_only=False):
    output_dir.mkdir(parents=True, exist_ok=True)
    source = (ROOT / "frontend/xr/viewport-xr.js").read_text()
    marker = "  return {\n    enter,\n    exit,"
    assert source.count(marker) == 1, "createViewportXR return hook changed"
    source = source.replace(marker, """  return {
    __runtimeTest: {
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
            + '</script></head><body style="margin:0;background:#17222e"><div id="viewport"></div></body></html>')
    program = (ROOT / "scripts/tests/xr-scene-runtime.js").read_text()
    options_marker = '    getXrStudioState: () => ({}), getToken: () => "",'
    assert program.count(options_marker) == 1, "XR fixture options hook changed"
    program = program.replace(options_marker, '''    getDrawBoardAssets: () => [{ filename: "fixture.glb", revision: "fixture-r1", units: "m", dimensions: [.2,.2,.2] }],
    getDrawBoardModel: () => assembly,
    drawBoardApi: async (_url, options = {}) => {
      if (options.method === "PUT") {
        window.__xrIntegratedSaved = JSON.parse(options.body).state;
        return { state: window.__xrIntegratedSaved, storage_revision: "integrated-saved" };
      }
      if (window.__xrIntegratedSaved) return { state: window.__xrIntegratedSaved, storage_revision: "integrated-saved" };
      throw Object.assign(new Error("404 canvas board not found"), { status: 404 });
    },
    getPromptDraft: () => window.__xrIntegratedDraft || "Integrated Draw planning draft",
    onSetPromptDraft: value => { window.__xrIntegratedDraft = value; },
    onOrganizeDrawBoard: result => { window.__xrIntegratedDraft = result.prompt; },
    onGenerateDrawBoard: snapshot => { (window.__xrIntegratedGenerations ||= []).push(snapshot); return { ok: true }; },
''' + options_marker)
    marker = '  return { checks, count: checks.length, referenceSpace: "local-floor", threeRevision: THREE.REVISION };'
    assert program.count(marker) == 1, "XR fixture return hook changed"
    program = program.replace(marker, """  window.__xrAiFixture = { THREE, scene, camera, renderer, manager,
    controllers, grips, sources, session, api, assembly, body,
    moveHand, pressHand, moveRight, button, wait, check, checks };
""" + marker)
    logs, requests = [], []
    report = {"passed": False}
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, args=[
            "--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader",
        ])
        page = await browser.new_page(viewport={"width": 1200, "height": 900})
        page.on("pageerror", lambda error: logs.append({"kind": "pageerror", "text": str(error)}))
        page.on("console", lambda message: logs.append({"kind": message.type, "text": message.text})
                if message.type in ("warning", "error") else None)
        await page.route("**/__xr-ai-draw-smoke", lambda route: route.fulfill(
            status=200, content_type="text/html", body=html))
        await page.route("**/xr/viewport-xr.js?runtime-smoke=*", lambda route: route.fulfill(
            status=200, content_type="application/javascript", body=source))

        async def api_stub(route):
            request = route.request
            requests.append({"method": request.method, "path": request.url.split("/api/", 1)[-1]})
            await route.fulfill(status=200, content_type="application/json", body="{}")

        await page.route("**/api/**", api_stub)
        try:
            await page.goto(base_url.rstrip("/") + "/__xr-ai-draw-smoke")
            baseline = await page.evaluate(program)
            report["baseline"] = baseline
            if not baseline_only:
                await page.evaluate("value => window.__xrAiAssetsOnly = value", assets_only)
                report["workspace"] = await page.evaluate(Path(__file__).with_suffix(".js").read_text())
            await page.screenshot(path=str(output_dir / "scene.png"))
            errors = [row for row in logs if row["kind"] == "pageerror"
                      or re.search(r"ReferenceError|TypeError|SyntaxError", row["text"])]
            assert not errors, json.dumps(errors, indent=2)
            report["passed"] = True
        except Exception as error:
            report["error"] = str(error)
            await page.screenshot(path=str(output_dir / "failure.png"))
            raise
        finally:
            report["checks"] = await page.evaluate("window.__xrRuntimeChecks || []")
            report["restoreDiff"] = await page.evaluate("window.__xrAiRestoreDiff || null")
            report["logs"], report["requests"] = logs, requests
            (output_dir / "report.json").write_text(json.dumps(report, indent=2))
            await browser.close()
    print(json.dumps({"passed": report["passed"], "checks": len(report["checks"]),
                      "report": str(output_dir / "report.json")}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://127.0.0.1:8001")
    parser.add_argument("--output-dir", type=Path,
                        default=ROOT / "backups/xr-ai-draw-20260915/verification/workflow")
    parser.add_argument("--baseline-only", action="store_true")
    parser.add_argument("--assets-only", action="store_true")
    args = parser.parse_args()
    asyncio.run(run(args.base_url, args.output_dir, args.baseline_only, args.assets_only))
