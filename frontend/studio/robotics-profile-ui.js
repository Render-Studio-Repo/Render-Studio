import { DEFAULT_ROBOTICS_PROFILE, readRoboticsProfile, persistRoboticsProfileDurable, normalizeRoboticsProfile, configUrlForTeleop, fetchRoboticsConfigFromLan, profileUrl, roboticsProfileSummary, isRoboticsStorageQuotaError } from '../xr/robotics-profile.js?v=roboticsworkspace3&dimos-viser-local1-20260915-dimosvr1-landiscovery2';
import { isLanStudioOrigin } from '../xr/xr-dimos-lan.js?v=20260915-dimosvr1';

if (typeof document !== "undefined" && !document.querySelector("[data-robotics-profile-style]")) {
  const css = document.createElement("link"); css.rel = "stylesheet";
  css.href = new URL("./robotics-profile.css?v=landiscovery2", import.meta.url).href;
  css.dataset.roboticsProfileStyle = "1"; document.head.append(css);
}

export function openRoboticsProfilePopup({ api, user, teleopUrl, onApply, onLegacy } = {}) {
  document.getElementById('robotics-profile-dialog')?.remove();
  let selection = readRoboticsProfile(user);
  let candidate = selection.profile || normalizeRoboticsProfile(DEFAULT_ROBOTICS_PROFILE);
  const dialog = document.createElement('dialog');
  dialog.id = 'robotics-profile-dialog';
  dialog.className = 'robotics-profile-dialog';
  dialog.innerHTML = `<header><strong>Robotics control configuration</strong><button type="button" data-close aria-label="Close">×</button></header>
    <label>Active controller profile<select data-mode><option value="integrated">DimOS Quest OpenArm — inside VR Studio</option><option value="external">Pi full-page passthrough UI</option><option value="studio">Studio controller bindings</option></select></label><p data-status role="status"></p>
    <section data-profile-fields><label>Discovery URL<input data-config type="url" spellcheck="false" placeholder="http://192.168.1.77:8450/robotics/config"></label>
    <div class="robotics-profile-actions"><button data-fill>Use Teleop IP</button><button data-load>Load from Pi</button><button data-default>Use supplied default</button></div>
    <p>Use a device on the Pi’s Wi-Fi. Allow local-network access if your browser asks. If loading is blocked, <a data-open-config target="_blank" rel="noopener noreferrer">open the config page</a> and import its JSON.</p>
    <p>For the Pi’s own immersive UI, <a data-open-teleop>open Pi teleop (leaves Studio)</a>, trust its certificate if prompted, then tap Connect. Close any other active teleop session first; the Pi accepts one controller connection.</p>
    <label class="robotics-profile-drop">Drop a JSON profile here, or click to browse<input data-file type="file" accept=".json,application/json"></label>
    <details><summary>Paste configuration JSON</summary><label>Pi configuration<textarea data-json rows="5" spellcheck="false" placeholder="Paste the JSON from /robotics/config"></textarea></label><button data-import-json>Use pasted JSON</button></details>
    <label>Setup <select data-setup><option value="pi">Raspberry Pi · OpenArm</option><option value="template">Shared OpenArm setup template</option></select></label><label>Setup ZIP URL<input data-bundle type="url" placeholder="Optional: http://Pi:8450/robotics/bundle.zip"></label><button data-install>Install configs and menus</button><pre data-summary></pre><a data-trust target="_blank" rel="noopener noreferrer">Open Pi certificate setup</a><p>Inside VR Studio, Enable Robotics turns on passthrough and routes controllers to the Pi. Menu trigger clicks stay available to disable robotics. The full-page option opens the Pi’s own UI.</p></section>
    <button data-legacy hidden>Edit Studio bindings</button>
    <footer><button data-save>Save and activate profile</button></footer>`;
  const q = s => dialog.querySelector(s);
  const status = message => { q('[data-status]').textContent = message; };
  const configLink = () => {
    const link = q('[data-open-config]');
    try { link.href = profileUrl(q('[data-config]').value); }
    catch { link.removeAttribute('href'); }
  };
  const preview = () => {
    q('[data-summary]').textContent = roboticsProfileSummary(candidate);
    const trust = candidate.trust_url || candidate.trust || candidate.trust_https_url;
    q('[data-trust]').hidden = !trust;
    if (trust) q('[data-trust]').href = profileUrl(trust);
    const teleop = new URL(profileUrl(candidate.ui));
    teleop.searchParams.delete('autoconnect');
    q('[data-open-teleop]').href = teleop.href;
    configLink();
  };
  const mode = q('[data-mode]'); mode.value = selection.mode;
  const showMode = () => { q('[data-profile-fields]').hidden = mode.value === 'studio'; q('[data-legacy]').hidden = mode.value !== 'studio'; };
  q('[data-config]').value = selection.configUrl || configUrlForTeleop(teleopUrl);
  preview(); showMode(); mode.onchange = showMode;
  q('[data-close]').onclick = () => dialog.close();
  dialog.onclose = () => dialog.remove();
  q('[data-config]').oninput = configLink;
  q('[data-fill]').onclick = () => { q('[data-config]').value = configUrlForTeleop(teleopUrl); configLink(); };
  q('[data-default]').onclick = () => { candidate = normalizeRoboticsProfile(DEFAULT_ROBOTICS_PROFILE); q('[data-config]').value = candidate.paste_url; preview(); status('Supplied Pi profile ready to save.'); };
  q('[data-load]').onclick = async () => {
    const button = q('[data-load]'); button.disabled = true; status('Reading Pi configuration from this device… Allow local-network access if prompted.');
    try {
      const url = profileUrl(q('[data-config]').value);
      const httpsPage = typeof location !== "undefined" && location.protocol === "https:";
      let loaded = null;
      try {
        loaded = await fetchRoboticsConfigFromLan(url, { httpsPage });
      } catch (directErr) {
        if (!isLanStudioOrigin()) throw directErr;
        loaded = await api('/api/robotics/config/discover', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({url}) });
      }
      candidate = normalizeRoboticsProfile(loaded.profile); q('[data-config]').value = loaded.configUrl; preview(); status('Loaded current controls and UI. Save to use this profile.');
    } catch (e) { status(e.message); } finally { button.disabled = false; }
  };
  q('[data-install]').onclick = async () => {
    const button=q('[data-install]');button.disabled=true;status('Installing controller map and Pi menus…');
    try {
      if (!isLanStudioOrigin()) throw new Error('ZIP installation needs a Render server on the Pi’s LAN. From this cloud page, use Load from Pi or import the configuration JSON; the cloud server cannot download from your private IP.');
      const loaded=await api('/api/robotics/setup/install',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:profileUrl(q('[data-config]').value),bundle_url:q('[data-bundle]').value.trim(),use_template:q('[data-setup]').value==='template'})});
      candidate=normalizeRoboticsProfile(loaded.profile);
      selection=await persistRoboticsProfileDurable(loaded,user);mode.value='integrated';
      await onApply?.(selection);preview();status('Installed. Enable Robotics uses these controls and menus.');
    } catch(error){status(error.message);} finally{button.disabled=false;}
  };
  const importJson = text => {
    if (text.length > 65536) throw new Error('Profile must be smaller than 64 KB.');
    candidate = normalizeRoboticsProfile(JSON.parse(text));
    q('[data-config]').value = candidate.paste_url || configUrlForTeleop(candidate.ui);
    preview(); status('JSON profile ready to save.');
  };
  q('[data-import-json]').onclick = () => {
    try { importJson(q('[data-json]').value); } catch (e) { status(e.message); }
  };
  const readFile = async file => {
    if (!file) return;
    try {
      if (file.size > 65536) throw new Error('Profile must be smaller than 64 KB.');
      importJson(await file.text());
    } catch(e) { status(e.message); }
  };
  q('[data-file]').onchange = e => readFile(e.target.files[0]);
  const drop = q('.robotics-profile-drop');
  drop.ondragover = e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; };
  drop.ondrop = e => { e.preventDefault(); void readFile(e.dataTransfer.files[0]); };
  q('[data-legacy]').onclick = () => { dialog.close(); onLegacy?.(); };
  q('[data-save]').onclick = async () => {
    const button = q('[data-save]'); button.disabled = true;
    try {
      const value = mode.value === 'studio' ? {mode:'studio'} : { mode:mode.value, profile:candidate, version:2, configUrl:profileUrl(q('[data-config]').value) };
      await api('/api/users/me/robotics-prefs', {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({roboticsProfile:value})});
      selection = await persistRoboticsProfileDurable(value, user);
      await onApply?.(selection); status('Saved. This profile is used when you enable robotics.');
    } catch(e) {
      status('Could not save: ' + (isRoboticsStorageQuotaError(e)
        ? 'browser storage is full. Large local snapshots were cleared so this profile can save — try again.'
        : e.message));
    } finally { button.disabled = false; }
  };
  document.body.append(dialog); dialog.showModal(); return dialog;
}
