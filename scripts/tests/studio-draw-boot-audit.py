import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright


async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, args=['--enable-webgl', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'])
        page = await browser.new_page(viewport={'width': 1440, 'height': 960})
        errors, console, failed = [], [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: console.append(message.text) if message.type == 'error' else None)
        page.on('requestfailed', lambda request: failed.append(request.url))

        async def route_request(route):
            url = route.request.url
            if url.startswith('http://127.0.0.1:8001/') or url.startswith('https://cdn.jsdelivr.net/'):
                if route.request.method not in ['GET', 'HEAD']:
                    await route.fulfill(status=503, content_type='application/json', body='{"error":"read-only boot audit"}')
                else:
                    await route.continue_()
            else:
                await route.abort()

        await page.route('**/*', route_request)
        await page.goto('http://127.0.0.1:8001/', wait_until='domcontentloaded', timeout=60000)
        await page.wait_for_timeout(20000)
        output = Path('/private/tmp/render-draw-recordings')
        output.mkdir(exist_ok=True)
        await page.screenshot(path=str(output / 'studio-boot-audit.png'))
        print(json.dumps({'errors': errors, 'consoleErrors': console[:35], 'failedRequests': failed[:20], 'title': await page.title(), 'body': (await page.locator('body').inner_text())[:1000]}))
        await browser.close()
        assert not errors, errors


asyncio.run(main())
