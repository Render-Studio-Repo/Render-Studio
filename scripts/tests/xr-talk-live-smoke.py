"""Read-only Studio boot and signed-out Talk failure check; no provider calls."""
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'backups/xr-settings-voice-20260916/verification/live'

async def main():
    OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            headless=True, args=['--enable-unsafe-swiftshader'])
        page = await browser.new_page(viewport={'width': 1440, 'height': 1000})
        errors, failed = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('response', lambda response: failed.append(response.url)
                if response.status >= 400 and '/api/' not in response.url else None)
        await page.goto('http://127.0.0.1:8001/', wait_until='domcontentloaded', timeout=60000)
        await page.wait_for_function('!!window.Render3DXrAgent && !!window.__activateStudioVoiceAgent', timeout=60000)
        await page.locator('#viewport canvas').wait_for(timeout=60000)
        await page.keyboard.press('Escape')
        result = await page.evaluate('''async () => {
            let micRequests = 0;
            navigator.mediaDevices.getUserMedia = async () => { micRequests++; throw new Error('Unexpected microphone request in signed-out test'); };
            const result = await window.__activateStudioVoiceAgent({source:'order'});
            return {result, micRequests};
        }''')
        assert result['result']['ok'] is False, result
        assert 'Sign in' in result['result']['error'], result
        assert result['micRequests'] == 0, result
        await page.screenshot(path=str(OUT / 'studio.png'))
        await page.goto('http://127.0.0.1:8001/docs.html', wait_until='domcontentloaded', timeout=60000)
        public = await page.request.get('https://render3d.app/')
        assert public.status == 200
        assert 'settingsvoice=20260916-1' in await public.text()
        unexpected = [error for error in errors if not error.startswith('Not authenticated [trace #')]
        report = {'studioCanvas': True, 'signedOutTalk': result, 'docs': await page.title(),
                  'publicRelease': public.status, 'pageErrors': unexpected, 'failedAssets': failed}
        (OUT / 'report.json').write_text(json.dumps(report, indent=2))
        print(json.dumps(report), flush=True)
        await browser.close()
        assert not unexpected, unexpected
        assert not failed, failed

asyncio.run(main())
