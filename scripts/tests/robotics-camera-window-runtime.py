import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright


OUT = Path("/private/tmp/render-camera-window")


async def main():
    OUT.mkdir(exist_ok=True)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            headless=True,
            args=["--enable-webgl", "--use-gl=angle", "--use-angle=swiftshader"],
        )
        page = await browser.new_page(viewport={"width": 1200, "height": 820})
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        html = """
          <link rel="stylesheet" href="/studio/styles.css">
          <style>
            body { margin: 0; min-height: 100vh; background: #0d1117; color: #e6edf3; font: 14px system-ui; }
            .hidden { display: none !important; }
          </style>
          <main id="viewport"></main>
          <section id="robotics"><input data-robot-pov-zed-url value="/api/robotics/zed.jpg"></section>
        """
        await page.route("**/__camera_window_test", lambda route: route.fulfill(status=200, content_type="text/html", body=html))
        await page.goto("http://127.0.0.1:8001/__camera_window_test")
        before = await page.evaluate("""async () => {
          const {mountRobotPov} = await import('/studio/robot-pov.js');
          const {createWristCamPopups} = await import('/viewport/wrist-cam-popups.js');
          const {createZedCamPopup} = await import('/viewport/zed-cam-popup.js');
          const {activateWristCameras, HAND_CAM_PRESENTATIONS} = await import('/xr/xr-hand-cams.js');
          const response = (data, blob = false) => ({
            ok: true,
            status: 200,
            headers: {get: () => '1'},
            json: async () => data,
            blob: async () => blob ? new Blob(['camera-frame-camera-frame-camera-frame-camera-frame-camera-frame'], {type:'image/jpeg'}) : new Blob(),
          });
          const fetchFn = async (url, options = {}) => {
            if (String(url).includes('/zed/status')) return response({usb:true, live:true, permission:'authorized', model:'ZED'});
            if (String(url).includes('/hand-cam/status')) return response({publish:true, leftLive:true, rightLive:true, devices:[]});
            if (String(url).includes('/hand-cam/') && String(options.method || 'GET') === 'GET') return response({}, true);
            return response({publish:true, ok:true});
          };
          const api = async (url, options) => (await fetchFn(url, options)).json();
          const wrist = createWristCamPopups({
            viewport: document.querySelector('#viewport'),
            document,
            fetchFn,
            storage: {getItem:()=>null,setItem:()=>{}},
            getCameraHost: () => '192.168.1.83',
          });
          const zed = createZedCamPopup({document, fetchFn});
          const pov = mountRobotPov({
            root: document.querySelector('#robotics'), api,
            getCameraHost: () => '192.168.1.83',
            onSplit: async () => { await Promise.all([wrist.show(), zed.show()]); return true; },
          });
          await activateWristCameras({fetchFn, restart:false, presentation:HAND_CAM_PRESENTATIONS.unified});
          await pov.open();
          await new Promise(resolve => setTimeout(resolve, 30));
          const before = {
            unified: document.querySelectorAll('.robot-pov-box').length,
            detached: document.querySelectorAll('.wrist-cam-popup').length,
            feeds: document.querySelectorAll('.robot-pov-box [data-pov-feed]').length,
          };
          window.__cameraTest = {wrist, zed, pov};
          return before;
        }""")
        await page.screenshot(path=str(OUT / "camera-window-unified.png"))
        after = await page.evaluate("""async () => {
          document.querySelector('[data-pov-split]').click();
          await new Promise(resolve => setTimeout(resolve, 80));
          return {
            unified: document.querySelectorAll('.robot-pov-box').length,
            detached: document.querySelectorAll('.wrist-cam-popup').length,
          };
        }""")
        result = {"before": before, "after": after}
        await page.screenshot(path=str(OUT / "camera-window-detached.png"))
        await browser.close()
        expected = {
            "before": {"unified": 1, "detached": 0, "feeds": 3},
            "after": {"unified": 0, "detached": 3},
        }
        assert result == expected, {"result": result, "expected": expected}
        assert not errors, errors
        print(json.dumps(result))


asyncio.run(main())
