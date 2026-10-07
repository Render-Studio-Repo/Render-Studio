/** Native Three renderer startup, with bounded recovery from GPU startup refusals. */
import { createSilentBootRenderer } from './webgl-renderer-fallback.js?v=webglboot1';
import { mountWebGlStartupPanel, takeWebGlCompatibilityRetry } from './webgl-startup-panel.js?v=20260916-startup-guard1&gpu=20260916-startup2&gpu=20260916-startup3&gpuhang1&gpuhang2';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function createNativeStudioRenderer(THREE, attributes, {
  compatibilityOnly = false,
  wait = pause,
  makeCanvas = () => document.createElement('canvas'),
} = {}) {
  const compatible = { ...attributes, antialias: false, preserveDrawingBuffer: false, stencil: false, powerPreference: 'default' };
  const profiles = [
    { name: compatibilityOnly ? 'compatible' : 'standard', attributes: compatibilityOnly ? compatible : attributes, delay: 0 },
    { name: 'compatible', attributes: compatible, delay: 0 },
    { name: 'compatible-retry', attributes: compatible, delay: 300 },
    { name: 'compatible-retry', attributes: compatible, delay: 900 },
  ];
  const attempts = [];
  for (const profile of profiles) {
    if (profile.delay) await wait(profile.delay);
    const canvas = makeCanvas();
    let browserReason = '';
    const onCreationError = event => { browserReason = event.statusMessage || ''; };
    canvas.addEventListener('webglcontextcreationerror', onCreationError);
    let renderer;
    try {
      // Three owns context creation and its native WebXRManager. Never pre-bind
      // a context or substitute a WebGL1 renderer for the WebGL2/XR renderer.
      renderer = new THREE.WebGLRenderer({ ...profile.attributes, canvas });
      if (renderer.getContext().isContextLost()) throw new Error('Graphics context was lost during startup.');
      return { renderer, profile: profile.name, attempts };
    } catch (error) {
      // Dispose only. Losing the context at boot fights Chrome's GPU process
      // (BindToCurrentSequence / GL_RENDERER=Disabled) and is banned on this path.
      renderer?.dispose();
      attempts.push({ profile: profile.name, reason: browserReason || error?.message || String(error) });
      // Chrome can briefly report Disabled / BindToCurrentSequence while its GPU
      // process restarts. Keep the delayed attempts below; the retry is bounded.
    } finally {
      canvas.removeEventListener('webglcontextcreationerror', onCreationError);
    }
  }
  const error = new Error(`WebGL2 could not start. ${attempts.at(-1)?.reason || 'No usable graphics context.'}`);
  error.webglDiagnostics = attempts;
  throw error;
}

export async function startStudioGraphics({ THREE, host, attributes, pixelRatio }) {
  try {
    const result = await createNativeStudioRenderer(THREE, attributes, { compatibilityOnly: takeWebGlCompatibilityRetry() });
    result.renderer.setPixelRatio(result.profile === 'standard' ? pixelRatio : 1);
    return { ...result, available: true };
  } catch (error) {
    console.warn('Studio graphics unavailable; account and project controls remain available.', error);
    mountWebGlStartupPanel(host, { error, probe: async () => {
      const { renderer } = await createNativeStudioRenderer(THREE, attributes, { compatibilityOnly: true });
      // Release only this disposable probe, never the live Studio/XR renderer.
      renderer.dispose();
      renderer.forceContextLoss();
      await pause(250);
    } });
    return { renderer: createSilentBootRenderer(), available: false, error };
  }
}
