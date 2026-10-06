"""Capture the actual local browser animation as a review GIF, without Studio."""
import asyncio
import base64
import io
import json
from pathlib import Path

from PIL import Image
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent


async def capture():
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        )
        try:
            page = await browser.new_page(viewport={'width':760, 'height':740}, device_scale_factor=1)
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            await page.goto((ROOT / 'render-chrome-electric-matrix.html').as_uri())
            await page.wait_for_function('window.renderChromePreview?.ready')
            frames = []
            for i in range(121):
                await page.evaluate('(ms) => window.renderChromePreview.seek(ms)', i * 8000 / 120)
                png = await page.locator('canvas').screenshot()
                frames.append(Image.open(io.BytesIO(png)).convert('RGB'))
                if i % 30 == 0:
                    print(f'Captured {i}/120 animation frames', flush=True)
            sample = Image.new('RGB', (180 * 4, 130 * 4))
            for i, frame in enumerate(frames[::8][:16]):
                sample.paste(frame.resize((180, 130)), ((i % 4) * 180, (i // 4) * 130))
            palette = sample.quantize(colors=192)
            indexed = [frame.quantize(palette=palette, dither=Image.Dither.FLOYDSTEINBERG) for frame in frames]
            durations = [70 if i % 3 != 1 else 60 for i in range(len(indexed))]
            durations[-1] = 1000
            indexed[0].save(ROOT / 'animation-preview.gif', save_all=True, append_images=indexed[1:],
                            loop=0, duration=durations, disposal=1, optimize=False)
            await page.set_viewport_size({'width':1100, 'height':900})
            for name, ms in [('chrome', 3200), ('matrix', 6800)]:
                await page.evaluate('(ms) => window.renderChromePreview.seek(ms)', ms)
                await page.screenshot(path=str(ROOT / f'preview-{name}.png'))
            await page.get_by_role('button', name='Replay', exact=True).click()
            await page.wait_for_timeout(120)
            assert await page.evaluate('window.renderChromePreview.playing')
            await page.get_by_role('button', name='Pause animation').click()
            assert not await page.evaluate('window.renderChromePreview.playing')
            await page.set_viewport_size({'width':390, 'height':740})
            await page.evaluate('window.renderChromePreview.seek(6800)')
            await page.screenshot(path=str(ROOT / 'preview-mobile.png'))
            assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            await page.emulate_media(reduced_motion='reduce')
            await page.wait_for_timeout(60)
            assert not await page.evaluate('window.renderChromePreview.playing')
            assert await page.get_by_role('button', name='Play animation').is_disabled()
            await page.screenshot(path=str(ROOT / 'preview-reduced-motion.png'))
            result = {'page_errors': errors, 'frames': len(frames), 'duration_ms': sum(durations),
                      'gif_bytes': (ROOT / 'animation-preview.gif').stat().st_size,
                      'replay_pause': 'passed', 'mobile_overflow': 'none', 'reduced_motion': 'passed'}
            (ROOT / 'verification.json').write_text(json.dumps(result, indent=2) + '\n')
            print(json.dumps(result), flush=True)
            assert not errors
        finally:
            await browser.close()


if __name__ == '__main__':
    markup = (ROOT / 'index.html').read_text()
    script = (ROOT / 'animation.js').read_text()
    logo = base64.b64encode((ROOT / 'render-logo.png').read_bytes()).decode('ascii')
    script = script.replace("'render-logo.png?v=20260908-chrome-electric-matrix-1'", "'data:image/png;base64," + logo + "'")
    markup = markup.replace('<script src="animation.js?v=20260908-chrome-electric-matrix-2"></script>', '<script>\n' + script + '\n</script>')
    (ROOT / 'render-chrome-electric-matrix.html').write_text(markup)
    asyncio.run(capture())
