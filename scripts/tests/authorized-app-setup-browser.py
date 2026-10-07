"""Isolated connected-app UI QA. All account APIs are mock functions; no writes leave the page."""
import asyncio
import json
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path('/private/tmp/preferences-redesign-20260916/apps-setup-qa')
OUT.mkdir(parents=True, exist_ok=True)

async def main():
    checks = []
    errors = []
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(viewport={'width': 1100, 'height': 900})
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.route('**/api/**', lambda route: route.abort())
        await page.route('**/__apps_setup_fixture', lambda route: route.fulfill(content_type='text/html', body='''<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root{--bg:#10151c;--panel:#171d25;--border:#303a46;--text:#edf1f5;--muted:#a4afbc;--accent:#f3a35f}body{background:var(--bg);color:var(--text);font:14px system-ui;margin:0}main{max-width:760px;margin:40px auto;padding:24px}h1{font-size:27px}button{font-family:inherit}</style></head><body><main><h1>Connected apps</h1><div id="pref-authorized-apps-list"></div></main></body></html>'''))
        await page.goto('http://127.0.0.1:8001/__apps_setup_fixture')
        await page.evaluate('''async () => {
          window.apps = await import('/studio/authorized-app-setup.js?v=setupqa1');
          window.calls = []; window.copies = []; window.navigations = []; window.fixture = { stripeConfigured: true, githubFail: false, writeError: '', xPin: false };
          window.apiMock = async (url, opts={}) => {
            calls.push({url, method:opts.method || 'GET', body:opts.body || ''});
            const gets = {
              '/api/marketplace/seller': { seller:{stripe_account_id:'acct_fixture', stripe_ready:false} },
              '/api/receive-payments/me': {stripe_configured:fixture.stripeConfigured, paypal_oauth_configured:false, wallets:{}},
              '/api/integrations/discord/status': {configured:false,connected:false},
              '/api/integrations/twitter/status': {configured:true,connected:false},
              '/api/integrations/github/status': {configured:true,connected:false},
              '/api/users/me/calendar-connections': {connections:[]},
              '/api/integrations/stream/status': {providers:[{id:'twitch',connected:true,configured:true}]},
              '/api/users/me/drive/status': {configured:false,connected:false},
              '/api/integrations/grok-bot/status': {connected:false}
            };
            if(url==='/api/integrations/github/status' && fixture.githubFail) throw Error('Fixture GitHub status failure');
            if(gets[url] && (!opts.method || opts.method==='GET')) return gets[url];
            if(fixture.writeError) throw Error(fixture.writeError);
            if(url==='/api/integrations/twitter/link-url' && fixture.xPin) return {url:'https://x.com/oauth/authorize?fixture=1',mode:'oob',state:'fixture-state'};
            return {url:'https://example.org/mock-authorization',ok:true};
          };
          window.refreshApps = () => apps.hydrateAuthorizedAppList({host:document.querySelector('#pref-authorized-apps-list'),api:apiMock,authenticated:true,refresh:refreshApps});
          window.openTest = (key, extra={}) => apps.openAuthorizedAppAction({host:document.querySelector('#pref-authorized-apps-list'), key, api:apiMock,refresh:refreshApps,navigate:(url)=>navigations.push(url),clipboard:(text)=>{copies.push(text);return Promise.resolve();}, ...extra});
          await refreshApps();
          document.querySelector('#pref-authorized-apps-list').addEventListener('click',(event)=>{const button=event.target.closest('[data-authorized-app-key]');if(button)openTest(button.dataset.authorizedAppKey,{action:button.dataset.authorizedAppAction});});
        }''')
        await page.locator('.apps-card').last.wait_for()
        assert await page.locator('.apps-card').count() == 15
        assert await page.locator('[data-authorized-app-action]:disabled').count() == 0
        await page.screenshot(path=str(OUT/'cards-desktop.png'), full_page=True)
        checks.append('All 15 provider cards render enabled actions and purpose groups')
        keys = await page.locator('[data-authorized-app-key]').evaluate_all('(nodes)=>nodes.map(n=>n.dataset.authorizedAppKey)')
        for key in keys:
            before = await page.evaluate('calls.filter(c=>c.method!=="GET").length')
            await page.locator(f'[data-authorized-app-key="{key}"]').click()
            await page.locator('.apps-setup-dialog').wait_for()
            await page.keyboard.press('Shift+Tab')
            assert await page.evaluate('document.querySelector(".apps-setup-dialog").contains(document.activeElement)')
            assert await page.locator('.apps-setup-steps, .apps-setup-body > p').count() > 0
            assert before == await page.evaluate('calls.filter(c=>c.method!=="GET").length')
            if not await page.locator('.apps-developer').evaluate('(el)=>el.open'):
                await page.locator('.apps-developer summary').click()
            await page.locator('[data-copy]').click()
            assert 'copied' in await page.locator('[data-status]').inner_text()
            await page.keyboard.press('Escape')
            assert await page.locator('.apps-setup-overlay').count() == 0
        checks.append('Every Connect/Manage/Setup guide opens and copies without account API writes; Escape closes')
        assert await page.evaluate('copies.every(s=>!s.includes("acct_fixture") && !s.includes("fixture-state"))')
        checks.append('Copied harness instructions omit fixture account data and OAuth state')
        await page.evaluate('fixture.githubFail=true; refreshApps()')
        await page.get_by_text('Fixture GitHub status failure', exact=True).wait_for()
        assert await page.locator('.apps-card').count() == 15
        await page.evaluate('fixture.githubFail=false')
        checks.append('A failed provider retains all cards and an actionable local error')
        await page.evaluate('openTest("stripe", {action:"connect-stripe"})')
        await page.locator('[data-continue]').click()
        await page.wait_for_function('navigations.length===1')
        assert await page.evaluate('calls.some(c=>c.url==="/api/marketplace/seller/connect" && c.method==="POST")')
        assert not await page.evaluate('calls.some(c=>c.method==="DELETE")')
        await page.keyboard.press('Escape')
        checks.append('Finish Stripe setup POSTs onboarding and never DELETEs account')
        await page.evaluate('fixture.stripeConfigured=false; openTest("stripe", {action:"connect-stripe"})')
        before = await page.evaluate('calls.filter(c=>c.url==="/api/marketplace/seller/connect").length')
        await page.locator('[data-continue]').click()
        await page.wait_for_function('document.querySelector("[data-status]").textContent.includes("not configured")')
        assert before == await page.evaluate('calls.filter(c=>c.url==="/api/marketplace/seller/connect").length')
        await page.keyboard.press('Escape')
        checks.append('Unconfigured Stripe stops before backend demo-account mutation')
        await page.evaluate('fixture.writeError="Fixture OAuth rejected. Register the callback."; openTest("github",{row:{configured:true}})')
        await page.locator('[data-continue]').click()
        await page.get_by_text('Fixture OAuth rejected. Register the callback.', exact=True).wait_for()
        assert await page.locator('[data-continue]').is_enabled()
        await page.screenshot(path=str(OUT/'oauth-error-desktop.png'))
        await page.keyboard.press('Escape')
        checks.append('OAuth errors stay visible inside dialog and allow retry')
        await page.evaluate('fixture.writeError=""; fixture.xPin=true; openTest("twitter")')
        await page.locator('[data-continue]').click()
        await page.locator('[data-x-open]').wait_for(state='visible')
        assert await page.locator('[data-x-open]').get_attribute('href') == 'https://x.com/oauth/authorize?fixture=1'
        await page.locator('[name="x_pin"]').fill('123456')
        await page.locator('[data-x-submit]').click()
        await page.wait_for_function('document.querySelector("[data-status]").textContent==="X connected."')
        await page.keyboard.press('Escape')
        checks.append('X PIN flow offers user-clicked authorization link and explicit PIN submit')
        await page.evaluate('openTest("wallet-eth")')
        await page.locator('[data-continue]').click()
        await page.get_by_text('Open this page in a browser with MetaMask or another Ethereum wallet, or paste a public address above.', exact=True).wait_for()
        await page.locator('[name="wallet_address"]').fill('0x1111111111111111111111111111111111111111')
        await page.locator('[data-save-address]').click()
        await page.wait_for_function('document.querySelector("[data-status]").textContent==="Wallet address saved."')
        await page.keyboard.press('Escape')
        checks.append('Missing wallet extension gives next steps; explicit manual address path saves via mock API')
        await page.set_viewport_size({'width':390,'height':844})
        await page.evaluate('openTest("paypal")')
        await page.screenshot(path=str(OUT/'paypal-setup-mobile.png'))
        assert await page.evaluate('document.querySelector(".apps-setup-dialog").getBoundingClientRect().width <= innerWidth')
        assert await page.locator('[data-recheck]').is_visible()
        await page.locator('[data-recheck]').click()
        await page.wait_for_function('document.querySelector("[data-status]").textContent.includes("Setup is still needed")')
        await page.keyboard.press('Escape')
        await page.evaluate('openTest("grok_bot",{clipboard:()=>Promise.reject(Error("denied"))})')
        await page.locator('.apps-developer summary').click()
        await page.locator('[data-copy]').click()
        assert await page.locator('[data-copy-fallback]').is_visible()
        await page.screenshot(path=str(OUT/'grok-setup-mobile.png'))
        checks.append('Mobile dialog fits, keeps actions reachable, and provides copy fallback when clipboard denied')
        await page.keyboard.press('Escape')
        await page.screenshot(path=str(OUT/'cards-mobile.png'),full_page=True)
        assert errors == [], errors
        await browser.close()
    report={'checks':checks,'count':len(checks),'page_errors':errors}
    (OUT/'report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))

asyncio.run(main())
