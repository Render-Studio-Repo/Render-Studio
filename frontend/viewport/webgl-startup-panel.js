/** Recoverable startup failure UI. Only an explicit click reloads Studio. */
export const WEBGL_COMPATIBILITY_KEY='render3d:webgl-compatible-retry:v1';

export function takeWebGlCompatibilityRetry(storage) {
  try {storage ??= globalThis.sessionStorage;const value=storage.getItem(WEBGL_COMPATIBILITY_KEY)==='1';storage.removeItem(WEBGL_COMPATIBILITY_KEY);return value;}catch{return false;}
}

function blobFromError(error) {
  return `${error?.message || ''} ${JSON.stringify(error?.webglDiagnostics || [])}`;
}

/** API presence + optional 1×1 probe. Never constructs a Three renderer. */
export function inspectWebGlApis(doc = globalThis.document) {
  const webgl2Api = typeof WebGL2RenderingContext !== 'undefined';
  const webgl1Api = typeof WebGLRenderingContext !== 'undefined';
  let webgl2Context = null;
  let webgl1Context = null;
  try {
    const canvas = doc?.createElement?.('canvas');
    if (canvas) {
      webgl2Context = !!canvas.getContext?.('webgl2');
      if (!webgl2Context) webgl1Context = !!canvas.getContext?.('webgl');
    }
  } catch { /* ignore */ }
  return {
    webgl2Api,
    webgl1Api,
    webgl2Context,
    webgl1Context,
    webgl1Only: webgl1Api && (webgl1Context === true) && webgl2Context === false,
  };
}

export function webGlRecoveryHelp(error, {
  userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  protocol = typeof location !== 'undefined' ? location.protocol : 'https:',
  hostname = typeof location !== 'undefined' ? location.hostname : '',
  apis = inspectWebGlApis(),
} = {}) {
  const quest = /OculusBrowser|Quest|MetaBrowser|Horizon|Mobile VR/i.test(userAgent);
  if (quest) return 'If retry still fails, fully quit and reopen the headset browser, then reopen this project. Robot Enable does not start WebGL.';
  const gpuDisabled = /(?:GL_VENDOR\s*=\s*Disabled|GL_RENDERER\s*=\s*Disabled|BindToCurrentSequence)/i.test(blobFromError(error));
  const lanHttp = protocol === 'http:' && /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  const lanHint = lanHttp
    ? ' Prefer https://render3d.app (same as a working Mac) over a raw http://LAN:8001 URL if the Mini works and this PC does not.'
    : '';
  if (apis.webgl1Only) {
    return `This browser can start WebGL1 but not WebGL2. Studio’s 3D view needs WebGL2 — Three.js r172 will not run on WebGL1. Enable hardware acceleration, fully quit the browser (not just this tab), keep one Studio tab, and open chrome://gpu. WebGL2 must read Hardware accelerated, not Disabled or Software only. Update GPU drivers. Refreshing the page is not enough.${lanHint} Robot Enable does not start WebGL.`;
  }
  if (gpuDisabled) {
    return `The browser GPU process is off (ANGLE reports Disabled / BindToCurrentSequence). Enable Settings → System → Use hardware acceleration when available. Fully quit Chrome/Edge (Cmd/Ctrl+Q or Exit), then reopen. Keep one Studio tab; close Onshape, Fusion, other 3D tabs, remote desktop, or a VM. Confirm chrome://gpu shows WebGL2 Hardware accelerated. Update NVIDIA/AMD/Intel drivers. Refreshing is not enough.${lanHint} Robot Enable does not start WebGL.`;
  }
  return `Studio needs WebGL2 (Three.js r172; WebGL1 is not enough). Enable hardware acceleration, fully quit the browser, reopen with one Studio tab, and check chrome://gpu for WebGL2 Hardware accelerated — not Disabled or Software only. Close extra 3D apps/tabs, avoid RDP/VM if those disable the GPU, and update GPU drivers. Refreshing this page is not enough.${lanHint} Signing in again will not repair graphics. Robot Enable does not start WebGL.`;
}

export function mountWebGlStartupPanel(host,{error,probe,reload=()=>location.reload(),storage,helpText}={}) {
  const panel=document.createElement('section');panel.className='studio-graphics-recovery';panel.setAttribute('role','status');
  const title=document.createElement('strong');title.textContent='3D graphics could not start';
  const summary=document.createElement('span');summary.textContent='The browser could not start WebGL2. Reduced graphics settings were also tried. Your project files and account are still available.';
  const retry=document.createElement('button');retry.type='button';retry.textContent='Retry 3D';retry.className='webgl-retry-button';
  const help=document.createElement('span');help.className='webgl-recovery-help';
  help.textContent=helpText || webGlRecoveryHelp(error);
  const details=document.createElement('details'),heading=document.createElement('summary'),diagnostics=document.createElement('pre');heading.textContent='Graphics diagnostics';
  const showError=err=>{
    const apis=inspectWebGlApis();
    diagnostics.textContent=JSON.stringify({message:err?.message,attempts:err?.webglDiagnostics || [],...apis},null,2);
  };
  showError(error);details.append(heading,diagnostics);
  retry.addEventListener('click',async()=>{
    retry.disabled=true;retry.textContent='Checking graphics…';
    try {await probe?.();try{(storage ?? globalThis.sessionStorage).setItem(WEBGL_COMPATIBILITY_KEY,'1');}catch{};summary.textContent='Graphics are available. Reloading the 3D workspace…';reload();}
    catch(err){showError(err);summary.textContent='3D graphics still could not start. Reduced graphics settings were also tried. Your project files are kept.';retry.disabled=false;retry.textContent='Retry 3D';}
  });
  panel.append(title,summary,retry,help,details);host.append(panel);
  if(!document.querySelector('link[data-webgl-recovery-style]')){const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./webgl-startup-panel.css?v=20260916-gpu3-gpu-recovery3-gpu-recovery4-gpu-recovery5-webglfb1&gpu=20260916-startup2&gpu=20260916-startup3&gpuhang1&gpuhang2',import.meta.url).href;link.dataset.webglRecoveryStyle='';document.head.append(link);}
  return panel;
}
