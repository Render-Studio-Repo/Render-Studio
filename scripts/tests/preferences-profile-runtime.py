"""Isolated profile/shell layout QA. Uses fixture users and never calls profile APIs."""
import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright

OUT = Path('/private/tmp/preferences-redesign-20260916/runtime')
OUT.mkdir(parents=True, exist_ok=True)
HTML = '''<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/studio/styles.css?profile-qa=1">
<link rel="stylesheet" href="/components/user-profile.css?profile-qa=1">
<link rel="stylesheet" href="/studio/preferences-shell.css?profile-qa=1" data-settings-shell-style>
<link rel="stylesheet" href="/studio/preferences-profile.css?profile-qa=1">
</head><body class="theme-dark"><div id="profile-preferences-panel" class="profile-preferences-panel"><div class="profile-preferences-card"></div></div></body></html>'''
SETUP = '''async () => {
  const {renderPreferencesProfile} = await import('/studio/preferences-profile.js?profile-qa=1');
  const {mountPreferencesShell} = await import('/studio/preferences-shell.js?profile-qa=1');
  const {createUserProfileUI} = await import('/components/user-profile.js?profile-qa=1');
  const user = {id:'layout-fixture',display_name:'Sam',handle:'sam_builds',bio:'Building robots and sharing what I learn along the way.'};
  const panel=document.querySelector('#profile-preferences-panel');
  panel.querySelector('.profile-preferences-card').innerHTML=renderPreferencesProfile({user});
  mountPreferencesShell(panel,{mainTab:'profile',user});
  window.qa={clicks:[],apiMode:'ok'};
  qa.publicProfile=createUserProfileUI({api:async(path)=>{
    if(!path.endsWith('/profile'))throw Error(`Unexpected fixture API: ${path}`);
    if(qa.apiMode==='error')throw Error('Profile unavailable (fixture)');
    if(qa.apiMode==='delayed')await new Promise(resolve=>qa.resolveProfile=resolve);
    return {profile:{...user,is_self:true,tabs:['profile','store'],projects:[],posts:[]}};
  }});
  panel.addEventListener('click',event=>{
    const button=event.target.closest('#pref-profile-save, #pref-profile-view');
    if(button)qa.clicks.push(button.id);
    if(button?.id==='pref-profile-view')qa.opening=qa.publicProfile.open({userId:user.id});
  });
}'''
PUBLIC = '''() => {
  document.querySelector('#profile-preferences-panel').remove();
  document.querySelector('#user-profile-overlay')?.remove();
  document.body.insertAdjacentHTML('beforeend',`<div class="user-profile-overlay"><div class="user-profile-card">
    <button class="user-profile-close" aria-label="Close">×</button>
    <div class="user-profile-head"><span class="user-profile-avatar">S</span><div>
      <h2 class="user-profile-name">SamWithAnExceptionallyLongDisplayNameForLayoutTesting</h2>
      <div class="user-profile-handle">@sam_builds_something_long</div>
      <div class="user-profile-link">render3d.app/u/sam_builds_something_long</div>
    </div></div><p class="user-profile-bio">Building robots and sharing what I learn.</p>
    <nav class="user-profile-tabs">${['Profile','Public store','Activity','Calendar','Settings'].map(x=>`<button class="user-profile-tab">${x}</button>`).join('')}</nav>
    <p class="user-profile-calendar-note">Calendar information is visible here.</p>
  </div></div>`);
}'''


async def main():
    results = {}
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch()
        for label, width, height, theme in [
            ('desktop-dark', 1240, 1000, 'dark'),
            ('desktop-light', 1240, 1000, 'light'),
            ('mobile-dark', 390, 844, 'dark'),
            ('mobile-light', 360, 780, 'light'),
        ]:
            page = await browser.new_page(viewport={'width':width,'height':height})
            errors = []
            page.on('pageerror',lambda error: errors.append(str(error)))
            await page.route('**/__preferences-profile-runtime', lambda route: route.fulfill(content_type='text/html',body=HTML))
            await page.goto('http://127.0.0.1:8001/__preferences-profile-runtime')
            await page.evaluate(SETUP)
            await page.evaluate('(theme)=>document.body.className=`theme-${theme}`',theme)
            await page.locator('#pref-display-name').fill('Sam Reader')
            await page.locator('#pref-bio').fill('Building robots and sharing what I learn along the way.')
            await page.locator('#pref-handle-status').evaluate("el=>{el.className='profile-handle-status is-error';el.textContent='This handle is already in use. Choose another handle to continue.'}")
            await page.locator('#profile-avatar-status').evaluate("el=>{el.className='muted small profile-preferences-note';el.textContent='Your changes will appear on your public profile.'}")
            await page.locator('#profile-avatar-input').focus()
            assert await page.evaluate("document.activeElement.id==='profile-avatar-input'")
            await page.locator('#pref-profile-view').click()
            await page.evaluate('qa.opening')
            assert await page.evaluate("document.activeElement.matches('#user-profile-overlay [data-profile-close]')")
            await page.keyboard.press('Tab')
            assert await page.evaluate("!!document.activeElement.closest('#user-profile-overlay')")
            await page.evaluate('''()=>{
              const nested=document.createElement('div');nested.id='nested-profile-dialog';nested.setAttribute('role','dialog');
              nested.innerHTML='<input aria-label="Nested dialog field"><button>Nested dialog action</button>';
              document.body.append(nested);nested.querySelector('input').focus();
            }''')
            await page.keyboard.press('Tab')
            assert await page.evaluate("document.activeElement.matches('#nested-profile-dialog button')")
            await page.locator('#nested-profile-dialog').evaluate('el=>el.remove()')
            await page.locator('#user-profile-overlay [data-profile-close]').focus()
            await page.keyboard.press('Shift+Tab')
            assert await page.evaluate("document.activeElement.matches('#user-profile-overlay [data-profile-tab=store]')")
            await page.keyboard.press('Tab')
            assert await page.evaluate("document.activeElement.matches('#user-profile-overlay [data-profile-close]')")
            await page.screenshot(path=str(OUT / f'{label}-preview-focus.png'))
            await page.keyboard.press('Escape')
            assert await page.evaluate("document.activeElement.id==='pref-profile-view'")
            await page.locator('#pref-profile-save').click()
            assert await page.evaluate('qa.clicks') == ['pref-profile-view','pref-profile-save']
            bounds = await page.evaluate('''()=>{
              const content=document.querySelector('.settings-content');
              const field=document.querySelector('#pref-handle').getBoundingClientRect();
              const save=document.querySelector('#pref-profile-save').getBoundingClientRect();
              return {viewportWidth:innerWidth,documentWidth:document.documentElement.scrollWidth,contentWidth:content.clientWidth,contentScrollWidth:content.scrollWidth,handleWidth:field.width,saveHeight:save.height};
            }''')
            assert bounds['documentWidth'] <= width, bounds
            assert bounds['contentScrollWidth'] <= bounds['contentWidth'] + 1, bounds
            assert bounds['handleWidth'] > 180, bounds
            if width <= 480:
                assert bounds['saveHeight'] >= 44, bounds
            await page.screenshot(path=str(OUT / f'{label}-footer.png'))
            await page.locator('.settings-content').evaluate('el=>el.scrollTop=0')
            await page.screenshot(path=str(OUT / f'{label}-top.png'))
            await page.evaluate("qa.apiMode='error'")
            await page.locator('#pref-profile-view').click()
            await page.evaluate('qa.opening')
            assert await page.evaluate("document.activeElement.matches('#user-profile-overlay [data-profile-close]')")
            await page.keyboard.press('Tab')
            assert await page.evaluate("document.activeElement.matches('#user-profile-overlay [data-profile-close]')")
            await page.locator('#user-profile-overlay [data-profile-close]').click()
            assert await page.evaluate("document.activeElement.id==='pref-profile-view'")
            await page.evaluate("qa.apiMode='delayed'")
            await page.locator('#pref-profile-view').click()
            assert await page.evaluate("document.activeElement.matches('#user-profile-overlay .user-profile-card')")
            await page.keyboard.press('Tab')
            assert await page.evaluate("document.activeElement.matches('#user-profile-overlay .user-profile-card')")
            await page.keyboard.press('Escape')
            await page.evaluate('async()=>{qa.resolveProfile();await qa.opening;}')
            assert await page.evaluate("document.activeElement.id==='pref-profile-view'")
            await page.evaluate(PUBLIC)
            public_bounds = await page.locator('.user-profile-card').evaluate('el=>({width:el.getBoundingClientRect().width,client:el.clientWidth,scroll:el.scrollWidth})')
            assert public_bounds['scroll'] <= public_bounds['client'] + 1, public_bounds
            await page.get_by_role('button',name='Settings',exact=True).click()
            await page.screenshot(path=str(OUT / f'{label}-public.png'))
            await page.locator('.user-profile-overlay').evaluate("el=>el.classList.add('user-profile-overlay--compact')")
            await page.locator('.user-profile-card').evaluate("el=>el.classList.add('user-profile-card--compact')")
            compact = await page.locator('.user-profile-card').evaluate('el=>el.getBoundingClientRect().width')
            assert abs(compact-280)<1, compact
            assert not errors, errors
            results[label] = {'profile':bounds,'public':public_bounds,'compactWidth':compact,'previewFocus':'success, error and dismissed loading states passed','errors':errors}
            await page.close()
        await browser.close()
    (OUT / 'report.json').write_text(json.dumps(results,indent=2))
    print(json.dumps(results,indent=2))


if __name__ == '__main__':
    asyncio.run(main())
