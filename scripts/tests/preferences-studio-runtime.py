"""Full Studio settings navigation and app guides. All API requests are mocked."""
import asyncio
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

OUT = Path('/private/tmp/preferences-redesign-20260916/studio-runtime')
OUT.mkdir(parents=True, exist_ok=True)

async def main():
    checks, errors, writes = [], [], []
    user = {'id': 'settings-qa', 'email': 'settings@example.test', 'display_name': 'Alex Morgan', 'handle': 'alexmaker', 'bio': 'Building useful things.', 'role': 'user'}
    statuses = {
        'marketplace/seller': {'seller': {'stripe_account_id': 'acct_qa_incomplete', 'stripe_ready': False}},
        'receive-payments/me': {'stripe_configured': True, 'paypal_oauth_configured': False, 'wallets': {}},
        'integrations/discord/status': {'configured': False, 'connected': False},
        'integrations/twitter/status': {'configured': True, 'connected': True, 'account': {'username': 'alexmaker'}},
        'integrations/github/status': {'configured': False, 'connected': False},
        'users/me/calendar-connections': {'connections': []},
        'integrations/stream/status': {'providers': [{'id': x, 'connected': x == 'x_live'} for x in ['x_live', 'twitch', 'kick']]},
        'users/me/drive/status': {'configured': True, 'connected': False},
        'integrations/grok-bot/status': {'connected': False},
    }
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(viewport={'width': 1440, 'height': 1000}, permissions=['clipboard-read', 'clipboard-write'])
        page = await context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.add_init_script('localStorage.setItem("render3d:token","qa-only");localStorage.setItem("render3d:user",' + json.dumps(json.dumps(user)) + ');')
        async def api(route):
            path = urlparse(route.request.url).path.removeprefix('/api/')
            method = route.request.method
            if method not in ['GET', 'HEAD', 'OPTIONS']:
                writes.append({'path': path, 'method': method, 'body': route.request.post_data})
            if path == 'users/me' and method == 'PATCH':
                user.update(route.request.post_data_json)
                return await route.fulfill(json={'user': user})
            if path == 'marketplace/seller/connect':
                return await route.fulfill(status=503, json={'detail': 'Stripe test provider is unavailable. Try again.'})
            value = {'user': user} if path == 'auth/me' else {'projects': []} if path == 'projects' else statuses.get(path, {})
            await route.fulfill(json=value)
        await page.route('**/api/**', api)
        await page.goto('http://127.0.0.1:8001/', wait_until='domcontentloaded')
        await page.wait_for_selector('#viewport canvas[data-engine]', state='attached', timeout=30000)
        await page.wait_for_timeout(3000)
        for selector in ['#ai-setup-intro-modal button[data-ai-setup-close]', '#welcome-modal button[data-welcome-close]']:
            if await page.locator(selector).is_visible(): await page.locator(selector).click()
        await page.evaluate("window.dispatchEvent(new CustomEvent('render3d:open-preferences-tab',{detail:{tab:'general'}}))")
        await page.wait_for_selector('.settings-v2 .settings-page-header')
        panel = page.locator('#profile-preferences-panel')
        nav = page.locator('.settings-navigation')
        async def go(key):
            if key in ['cad', 'robotics', 'developer']:
                await page.locator('.settings-advanced').evaluate('(el)=>el.open=true')
            await nav.locator(f'[data-settings-page="{key}"]').click()
        async def no_overflow(label):
            assert await panel.evaluate('(p)=>[p,...p.querySelectorAll(".settings-layout,.settings-main,.settings-content")].every(el=>el.scrollWidth<=el.clientWidth+1)'), label
        await no_overflow('desktop general')
        assert not await page.locator('#pref-advanced-toggle').count()
        assert await page.locator('.settings-advanced').get_attribute('open') is None
        await page.screenshot(path=str(OUT/'general-desktop.png'))
        checks.append('General shows first steps and clear navigation; Advanced is a lower collapsible group')
        await go('profile')
        await page.locator('#pref-display-name').fill('Alex draft')
        await page.locator('#pref-handle').fill('alexdraft')
        await page.locator('#pref-bio').fill('A draft that should survive switching pages.')
        await go('general'); await go('profile')
        assert await page.locator('#pref-display-name').input_value() == 'Alex draft'
        assert 'alexdraft (save to publish)' in await page.locator('#pref-profile-link').inner_text()
        assert await page.locator('#pref-bio').input_value() == 'A draft that should survive switching pages.'
        await page.locator('#pref-profile-save').click()
        await page.wait_for_function("document.querySelector('#profile-avatar-status')?.textContent==='Profile saved.'")
        assert user['display_name'] == 'Alex draft'
        checks.append('Unsaved profile values survive navigation; Save reaches the existing profile PATCH handler')
        await page.screenshot(path=str(OUT/'profile-desktop.png'))
        expected = {'generation': '#pref-imagine-count', 'cad': '#pref-new-project-workspace', 'developer': '#pref-foundry-toolbar', 'controllers': '#pref-printer-accept', 'viewport': '#pref-look-light', 'canvas': '[data-pref-main-pane]', 'notifications': '[data-email-pref="chat_alerts"]', 'calendar': '#pref-availability-editor', 'robotics': '#pref-dimos-ws-url', 'payments': '#pref-receive-payments-root', 'store': '[data-store-body]'}
        for key, selector in expected.items():
            await go(key)
            assert await page.locator(selector).count() == 1, (key, selector)
            assert not await page.locator('#pref-display-name').count(), key
            await no_overflow(key)
        checks.append('All 14 sections route to their existing controls without duplicate profile forms or overflowing pages')
        await page.locator('.settings-search input').fill('github')
        assert await page.locator('.settings-search-results [data-settings-page="authorized"]').is_visible()
        await page.locator('.settings-search input').press('Enter')
        await page.wait_for_selector('[data-authorized-app-key="paypal"]')
        assert await page.locator('.apps-card').count() == 15
        await page.wait_for_function("[...document.querySelectorAll('.apps-card img')].every(i=>i.complete&&i.naturalWidth>0)")
        checks.append('Settings search finds Connected apps by provider name; all 15 app cards have loaded logos')
        await page.screenshot(path=str(OUT/'connected-apps-desktop.png'))
        before = [w for w in writes if 'integrations/' in w['path'] or 'receive-payments/' in w['path'] or w['path']=='marketplace/seller/connect']
        keys = await page.locator('[data-authorized-app-key]').evaluate_all('(els)=>els.map(e=>e.dataset.authorizedAppKey)')
        for key in keys:
            await page.locator(f'[data-authorized-app-key="{key}"]').click()
            await page.locator('.apps-setup-overlay').wait_for(state='visible')
            assert await page.locator('.apps-setup-overlay [data-copy]').count() == 1, key
            await page.locator('.apps-setup-overlay [data-close]').first.click()
        after = [w for w in writes if 'integrations/' in w['path'] or 'receive-payments/' in w['path'] or w['path']=='marketplace/seller/connect']
        assert before == after
        checks.append('Every Connect/Setup/Manage button opens a guide with no account write just from opening')
        await page.locator('[data-authorized-app-key="paypal"]').click()
        await page.locator('.apps-setup-overlay [data-copy]').click()
        copied = await page.evaluate('navigator.clipboard.readText()')
        assert 'PAYPAL_CLIENT_ID=<set securely>' in copied and '/oauth/paypal/callback' in copied
        assert 'settings@example.test' not in copied and '/Users/sam' not in copied
        await page.screenshot(path=str(OUT/'paypal-setup-desktop.png'))
        await page.keyboard.press('Escape')
        assert await panel.is_visible() and not await page.locator('.apps-setup-overlay').count()
        checks.append('Missing-configuration setup is clickable and copies a portable developer task without profile data or secrets')
        assert await page.locator('[data-authorized-app-key="stripe"]').inner_text() == 'Finish setup'
        await page.locator('[data-authorized-app-key="stripe"]').click()
        await page.locator('.apps-setup-overlay [data-continue]').click()
        await page.wait_for_function("document.querySelector('.apps-setup-overlay [data-status]')?.textContent.includes('Stripe test provider')")
        assert any(w['path']=='marketplace/seller/connect' and w['method']=='POST' for w in writes)
        assert not any(w['method']=='DELETE' for w in writes)
        await page.keyboard.press('Escape')
        checks.append('Stripe Finish setup starts onboarding; provider failure stays visible inside dialog; no disconnect')
        await go('general'); await page.locator('#pref-app-theme').select_option('light')
        await page.wait_for_function("document.body.classList.contains('theme-light')")
        await page.screenshot(path=str(OUT/'general-light.png'))
        checks.append('Theme control still applies to Studio and the new settings shell')
        await page.set_viewport_size({'width':390,'height':844})
        mobile = page.locator('.settings-mobile-navigation select')
        await mobile.select_option('profile')
        await no_overflow('mobile profile')
        assert not await page.locator('#mobile-app-banner').is_visible()
        assert not await page.locator('#mobile-browser-fab').is_visible()
        await page.locator('#pref-profile-save').scroll_into_view_if_needed()
        assert await page.locator('#pref-profile-save').evaluate('(el)=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}')
        await page.locator('.settings-content').evaluate('(el)=>el.scrollTop=0')
        await page.screenshot(path=str(OUT/'profile-mobile.png'))
        await mobile.select_option('authorized')
        await page.wait_for_selector('[data-authorized-app-key="paypal"]')
        await no_overflow('mobile apps')
        await page.screenshot(path=str(OUT/'connected-apps-mobile.png'))
        await page.locator('[data-authorized-app-key="paypal"]').click()
        assert await page.locator('.apps-setup-dialog').evaluate('(e)=>e.getBoundingClientRect().width<=innerWidth')
        await page.screenshot(path=str(OUT/'paypal-setup-mobile.png'))
        await page.keyboard.press('Escape')
        await mobile.select_option('cad')
        assert await page.locator('#pref-mcmaster-insert-dest').is_visible()
        await mobile.select_option('developer')
        assert await page.locator('#pref-foundry-toolbar').is_visible()
        checks.append('Mobile section selector reaches Advanced pages; profile/apps/setup dialog fit 390px without overlap')
        await page.locator('[data-preferences-close]').click()
        assert not await panel.is_visible()
        assert await page.locator('#mobile-app-banner').is_visible()
        await page.evaluate("window.dispatchEvent(new Event('render3d:open-authorized-apps'))")
        await page.wait_for_selector('[data-authorized-app-key="paypal"]')
        assert await page.locator('#profile-preferences-title').inner_text() == 'Connected apps'
        checks.append('Existing Authorized apps deep link opens the new top-level page')
        await page.locator('[data-preferences-close]').click()
        await page.set_viewport_size({'width':1440,'height':1000})
        await page.evaluate("async()=>{const tour=await import('/site/show-me-tour.js?settings-qa=1');tour.startShowMe('preferences');}")
        await page.wait_for_selector('#user-menu:not(.hidden)')
        await page.locator('#show-me-next').click()
        await panel.wait_for(state='visible')
        await page.locator('#show-me-next').click()
        await page.wait_for_function("document.querySelector('.settings-navigation')?.classList.contains('show-me-target')")
        await page.locator('#show-me-next').click()
        await page.wait_for_function("document.querySelector('.settings-search input')?.classList.contains('show-me-target')")
        await page.locator('#show-me-overlay .show-me-close').click()
        checks.append('Preferences walkthrough anchors reach the new navigation and search instead of removed Advanced toggle')
        assert not errors, errors
        docs = await page.goto('http://127.0.0.1:8001/docs.html',wait_until='domcontentloaded')
        assert docs.status == 200
        (OUT/'report.json').write_text(json.dumps({'checks':checks,'pageErrors':errors,'mockWrites':writes},indent=2))
        print(json.dumps({'checks':checks,'pageErrors':errors},indent=2))
        await browser.close()

asyncio.run(main())
