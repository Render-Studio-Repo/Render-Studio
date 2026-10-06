/** Settings navigation and presentation. Existing controls keep their IDs and save handlers. */
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const SETTINGS_PAGES = [
  {id:'general', title:'General', group:'Studio', icon:'sliders', description:'Make Studio feel familiar. Start with your theme and helpful tips.', keywords:'appearance theme dark light reminders getting started quests tips loading screen splash boot startup gear', main:'general'},
  {id:'viewport', title:'Viewport & lighting', group:'Studio', icon:'cube', description:'Set how your models and workspace look.', keywords:'3d lighting background shadows grid layout model colors ai key', main:'viewport'},
  {id:'canvas', title:'Canvas', group:'Studio', icon:'canvas', description:'Choose how drawing and image tools behave.', keywords:'draw drawing image editing brush design', main:'canvas'},
  {id:'generation', title:'AI & generation', group:'Studio', icon:'spark', description:'Choose generation quality and what happens to your prompts and reference images.', keywords:'speed quality prompt improve spice images imagine dxf motion urdf srdf', advanced:'generation'},
  {id:'controllers', title:'Controls & VR', group:'Studio', icon:'controller', description:'Set up mouse navigation, headset controls and your VR printer.', keywords:'mouse shortcuts quest headset grip trigger mappings remap passthrough printer', main:'controllers'},
  {id:'profile', title:'Profile', group:'Account', icon:'person', description:'Choose how you appear to people in Studio.', keywords:'avatar photo picture display name handle username bio public profile', main:'profile'},
  {id:'authorized', title:'Connected apps', group:'Account', icon:'apps', description:'Connect your tools, or get the steps needed to set them up.', keywords:'authorized integrations oauth setup github discord stripe paypal phantom bitcoin ethereum twitch kick grok twitter x google drive calendar outlook developer harness', advanced:'authorized'},
  {id:'notifications', title:'Notifications', group:'Account', icon:'bell', description:'Choose which updates reach your inbox.', keywords:'email alerts reminders mentions messages invites', main:'notifications'},
  {id:'calendar', title:'Calendar & availability', group:'Account', icon:'calendar', description:'Set your status, meeting hours and calendar privacy.', keywords:'schedule meeting google outlook busy free hours status timezone', main:'calendar'},
  {id:'payments', title:'Payments', group:'Account', icon:'wallet', description:'Manage how you receive payments and what appears on your public profile.', keywords:'receive payouts wallet stripe paypal money credits', main:'payments'},
  {id:'store', title:'Public store', group:'Account', icon:'store', description:'Manage your storefront and the models you share or sell.', keywords:'shop marketplace publish sell price models', advanced:'store'},
  {id:'cad', title:'CAD & files', group:'Advanced', icon:'folder', description:'Choose import behavior, project defaults and CAD integrations.', keywords:'fusion mcmaster insert downloads workspace new projects render region files grid', advanced:'cad'},
  {id:'robotics', title:'Robotics connections', group:'Advanced', icon:'robot', description:'Configure the machines used by robotics and teleoperation.', keywords:'dimos robot ip host viser teleop cameras network', main:'robotics'},
  {id:'developer', title:'Developer tools', group:'Advanced', icon:'code', description:'Developer workspace options and your private notes.', keywords:'foundry dashboard pr notes developer harness', advanced:'developer'},
];
const PATHS = {
  sliders:'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
  cube:'m12 3 9 5v8l-9 5-9-5V8l9-5Zm0 9 9-4M12 12 3 8m9 4v9',
  canvas:'M4 4h16v16H4zM7 15l4-4 3 3 3-6', spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
  controller:'M7 7h10c3 0 5 12 2 12l-4-4H9l-4 4C2 19 4 7 7 7ZM6 11h4m-2-2v4m7-2h.01m3 2h.01',
  person:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-3a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v3',
  apps:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z',
  bell:'M5 17h14l-2-4V9a5 5 0 0 0-10 0v4l-2 4Zm5 3h4', calendar:'M4 5h16v16H4zM4 10h16M8 2v6m8-6v6',
  wallet:'M20 8H4V4h14v4m2 0v12H4V8m11 4h7v5h-7z', store:'M3 9l2-6h14l2 6M3 9v3h18V9M5 12v9h14v-9m-9 9v-6h4v6',
  folder:'M3 6h7l2 3h9v12H3V6Z', robot:'M5 7h14v13H5zM12 3v4M8 12h.01m8 0h.01M9 17h6M2 10v7m20-7v7', code:'m8 5-6 7 6 7m8-14 6 7-6 7m-3-16-2 18',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[name] || PATHS.sliders}"/></svg>`;
export function settingsPageFromState({mainTab='general',advancedOpen=false,advancedTab='authorized'}={}) {
  // Old deep links to Advanced → Viewport now land on the main appearance page.
  const id = advancedOpen ? (advancedTab==='viewport'?'general':advancedTab) : mainTab;
  return SETTINGS_PAGES.find(page=>page.id===id) || SETTINGS_PAGES[0];
}
export function searchSettingsPages(query) {
  const words=String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  return words.length ? SETTINGS_PAGES.filter(page=>words.every(word=>`${page.title} ${page.description} ${page.keywords}`.toLowerCase().includes(word))) : [];
}
const drafts = new WeakMap();
const userSignature = user => JSON.stringify([user?.id || '',user?.display_name || '',user?.handle || '',user?.bio || '']);
export function rememberPreferencesDraft(panel) {
  const state=drafts.get(panel), name=panel?.querySelector('#pref-display-name');
  if(!state || !name)return;
  state.values={name:name.value,handle:panel.querySelector('#pref-handle')?.value || '',bio:panel.querySelector('#pref-bio')?.value || ''};
}
function navButton(page,current) {
  return `<button type="button" class="settings-nav-item${page.id===current?' is-current':''}" data-settings-page="${page.id}" ${page.id===current?'aria-current="page"':''}>${icon(page.icon)}<span>${page.title}</span></button>`;
}
function sectionWith(root,selector) {return root?.querySelector(selector)?.closest('.profile-pref-section');}
function takeSection(content,node) {if(node){node.classList.remove('hidden');content.append(node);}}

/** Reparents existing DOM before binding/hydration; never copies controls or their listeners. */
export function mountPreferencesShell(panel,{mainTab,advancedOpen,advancedTab,user,onNavigate}={}) {
  const card=panel?.querySelector('.profile-preferences-card');if(!card)return;
  const page=settingsPageFromState({mainTab,advancedOpen,advancedTab});
  const previous=drafts.get(panel), signature=userSignature(user);
  const state=previous?.signature===signature?previous:{signature,values:null};drafts.set(panel,state);
  panel.classList.add('settings-v2');
  const main=card.querySelector('[data-pref-main-pane]');
  const shared=card.querySelector('[data-settings-shared-pane]') || main;
  const profile=card.querySelector('.profile-pref-identity');
  const advanced=id=>card.querySelector(`[data-preferences-advanced-panel="${id}"]`);
  const content=document.createElement('div');content.className='settings-content';content.id='settings-page-content';
  if(page.id==='profile') {
    takeSection(content,profile);
    if(state.values){
      profile.querySelector('#pref-display-name').value=state.values.name;
      profile.querySelector('#pref-handle').value=state.values.handle;
      profile.querySelector('#pref-bio').value=state.values.bio;
      const handle=state.values.handle.trim().replace(/^@+/,''),saved=String(user?.handle || '').replace(/^@+/, '');
      profile.querySelector('#pref-profile-link').textContent=handle ? `render3d.app/u/${handle}${handle.toLowerCase()===saved.toLowerCase()?'':' (save to publish)'}` : 'Choose a handle to personalize your profile link.';
    }
  } else if(page.id==='general') {
    content.innerHTML=`<div class="settings-start"><span class="settings-eyebrow">NEW TO STUDIO?</span><h3>A few good places to start</h3><p>Set up your profile, connect your tools, and choose the controls you know.</p><div class="settings-start-links">${['profile','authorized','controllers'].map(id=>navButton(SETTINGS_PAGES.find(p=>p.id===id),'')).join('')}</div></div>`;
    takeSection(content,sectionWith(shared,'#pref-app-theme'));
    const reminders=sectionWith(shared,'#pref-restore-reminders');
    const quests=advanced('viewport')?.querySelector('#pref-advanced-quests-enabled')?.closest('label');
    if(reminders && quests)reminders.append(quests);
    takeSection(content,reminders);
  } else if(page.id==='generation') {
    takeSection(content,sectionWith(shared,'#pref-imagine-count'));
    const generation=advanced('generation');generation?.querySelector('#pref-advanced-spice-prompt')?.closest('label')?.remove();
    takeSection(content,generation);
  } else if(page.id==='cad') {
    takeSection(content,sectionWith(shared,'#pref-render-edit-mode'));
    const cad=advanced('cad');
    for(const id of ['pref-advanced-render-edit-mode','pref-advanced-new-project-workspace','pref-advanced-mcmaster-insert-dest'])cad?.querySelector(`#${id}`)?.closest('label')?.remove();
    takeSection(content,cad);
  } else if(page.id==='developer') {
    takeSection(content,sectionWith(shared,'#pref-foundry-toolbar'));
  } else if(page.advanced) {
    takeSection(content,advanced(page.advanced));
    if(page.id==='authorized'){
      content.querySelector('.profile-backup-storage-card')?.remove();
      content.querySelector('.profile-preferences-category > .profile-preferences-note')?.remove();
    }
  } else {
    takeSection(content,main);
    if(page.id==='controllers')takeSection(content,sectionWith(shared,'#pref-printer-accept'));
  }
  // A single page heading provides orientation without duplicate headings above every pane.
  for(const section of content.children)if(section.matches('.profile-preferences-category,[data-pref-main-pane],.profile-pref-identity'))section.querySelector(':scope > strong,:scope > h3')?.remove();
  const groups=['Studio','Account'];
  card.innerHTML=`<div class="settings-layout"><aside class="settings-sidebar"><div class="settings-brand">${icon('sliders')}<span>Preferences</span></div>
    <label class="settings-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg><input type="search" placeholder="Find a setting…" aria-label="Find a setting" autocomplete="off"/></label>
    <div class="settings-search-results" hidden aria-label="Matching settings"></div>
    <label class="settings-mobile-navigation"><span>Settings section</span><select aria-label="Settings section">${[...groups,'Advanced'].map(group=>`<optgroup label="${group}">${SETTINGS_PAGES.filter(p=>p.group===group).map(p=>`<option value="${p.id}"${p.id===page.id?' selected':''}>${p.title}</option>`).join('')}</optgroup>`).join('')}</select></label>
    <nav class="settings-navigation" aria-label="Preferences sections">${groups.map(group=>`<div class="settings-nav-group"><h3>${group}</h3>${SETTINGS_PAGES.filter(p=>p.group===group).map(p=>navButton(p,page.id)).join('')}</div>`).join('')}
      <details class="settings-advanced" ${page.group==='Advanced'?'open':''}><summary>Advanced<span>For specialized workflows</span></summary><div>${SETTINGS_PAGES.filter(p=>p.group==='Advanced').map(p=>navButton(p,page.id)).join('')}</div></details>
    </nav><a class="settings-help" href="/getting-started.html" target="_blank" rel="noopener">Getting started guide <span aria-hidden="true">↗</span></a></aside>
    <div class="settings-main"><header class="settings-page-header"><div><span class="settings-eyebrow">${page.group==='Advanced'?'Advanced settings':'Studio settings'}</span><h2 id="profile-preferences-title" tabindex="-1">${page.title}</h2><p>${page.description}</p></div><button type="button" class="profile-preferences-close" data-preferences-close aria-label="Close preferences">×</button></header></div></div>`;
  card.querySelector('.settings-main').append(content);
  const search=card.querySelector('.settings-search input'),results=card.querySelector('.settings-search-results'),nav=card.querySelector('.settings-navigation');
  const navigate=id=>{const next=SETTINGS_PAGES.find(p=>p.id===id);if(next)onNavigate?.(next);};
  card.addEventListener('click',event=>{const hit=event.target.closest('[data-settings-page]');if(hit){event.preventDefault();navigate(hit.dataset.settingsPage);}});
  card.querySelector('.settings-mobile-navigation select').addEventListener('change',event=>navigate(event.target.value));
  const searchChanged=()=>{
    const query=search.value.trim();results.hidden=!query;nav.hidden=!!query;
    results.innerHTML=query ? (searchSettingsPages(query).map(p=>`<button type="button" class="settings-search-hit" data-settings-page="${p.id}">${icon(p.icon)}<span><b>${p.title}</b><small>${p.group}</small></span></button>`).join('') || '<p class="settings-no-results">No matching section. Try “theme”, “GitHub” or “VR”.</p>') : '';
  };
  search.addEventListener('input',searchChanged);
  search.addEventListener('keydown',event=>{if(event.key==='Enter'){const first=results.querySelector('[data-settings-page]');if(first){event.preventDefault();navigate(first.dataset.settingsPage);}}if(event.key==='Escape' && search.value){event.preventDefault();event.stopPropagation();search.value='';searchChanged();}});
  // Keep keyboard focus in the open dialog. Escape remains owned by Studio's close handler.
  card.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const candidates=[...card.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex="0"]')].filter(el=>!el.disabled && el.getClientRects().length);
    const first=candidates[0],last=candidates.at(-1);
    if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
  });
  if(!document.querySelector('link[data-settings-shell-style]')){const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./preferences-shell.css?v=20260916-settings1-settings-redesign2&loadskip1',import.meta.url).href;link.dataset.settingsShellStyle='';document.head.append(link);}
  return page;
}
