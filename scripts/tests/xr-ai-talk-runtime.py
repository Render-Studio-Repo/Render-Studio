#!/usr/bin/env python3
"""Actual AI prompt Talk picking and dispatch; all APIs and voice startup mocked."""
import asyncio
import json
import re
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "backups/xr-ai-talk-20260916/verification"

async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    source = (ROOT / "frontend/xr/viewport-xr.js").read_text()
    marker = "  return {\n    enter,\n    exit,"
    assert source.count(marker) == 1
    source = source.replace(marker, """  return {
    __talkTest: { pick: pickControllerSelectHit, setTool, workspaceAction: handleWorkspaceAction, openWorkspace: () => openWorkspacePanel({forcePlace:true}),
      state: () => ({aiPanel, explorerPanel, viewPanel, workspacePanel, settingsPanel, dockButtons, prevTrigger, lastSelectAt, voiceDraw}) },
    enter,
    exit,""", 1)
    imports = re.search(r'<script type="importmap">(.*?)</script>', (ROOT / "frontend/index.html").read_text(), re.S).group(1)
    html = '<html><head><script type="importmap">' + imports + '</script></head><body style="margin:0"><div id="viewport"></div></body></html>'
    prefix = (ROOT / "scripts/tests/xr-scene-runtime.js").read_text().split("  await enter();", 1)[0]
    prefix = prefix.replace("  const api = createViewportXR({", """  const startupCalls = [];
  let startupResult = {ok:true,live:true}, micCalls = 0; const micCallStacks=[];
  window.__activateStudioVoiceAgent = options => { startupCalls.push(options); return Promise.resolve(startupResult); };
  navigator.mediaDevices.getUserMedia = async () => { micCalls++;micCallStacks.push(new Error().stack); throw new DOMException('Mock microphone is unavailable','NotFoundError'); };
  const api = createViewportXR({""")
    prefix = prefix.replace('    getXrStudioState: () => ({}), getToken: () => "",', '    getXrStudioState: () => ({}), getToken: () => "", getAiPromptState: () => ({draft:"Keep the existing CAD mounting holes."}),')
    # The shared fixture's enter helper exposes only normal production methods.
    program = prefix + (ROOT / "scripts/tests/xr-ai-talk-runtime.js").read_text()
    logs = []
    report = {"passed": False}
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--enable-webgl','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
        page = await browser.new_page(viewport={"width":1200,"height":900})
        page.on('pageerror', lambda error: logs.append(str(error)))
        await page.route('**/__xr-ai-talk', lambda route: route.fulfill(content_type='text/html',body=html))
        await page.route('**/xr/viewport-xr.js?runtime-smoke=*', lambda route: route.fulfill(content_type='application/javascript',body=source))
        await page.route('**/api/**', lambda route: route.fulfill(content_type='application/json',body='{}'))
        try:
            await page.goto('http://127.0.0.1:8001/__xr-ai-talk')
            report = await page.evaluate(program)
            await page.screenshot(path=str(OUT / 'talk.png'))
            assert not logs, logs
            report['passed'] = True
        except Exception as error:
            report['error'] = str(error)
            await page.screenshot(path=str(OUT / 'failure.png'))
            raise
        finally:
            report['checks'] = await page.evaluate('window.__xrRuntimeChecks || []')
            report['logs'] = logs
            (OUT / 'report.json').write_text(json.dumps(report,indent=2))
            await browser.close()
    print(json.dumps({"passed":report['passed'],"checks":len(report['checks']),"report":str(OUT / 'report.json')},indent=2))

asyncio.run(main())
