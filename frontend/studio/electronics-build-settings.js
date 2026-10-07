/** CAD follow-up preference is captured in each request, so switching projects cannot retarget a job. */
const KEY = 'render3d:auto-wiring:v1';
export function automaticWiringEnabled(projectId) {
  try { return localStorage.getItem(`${KEY}:${projectId || 'new'}`) !== '0'; } catch { return true; }
}
export function mountElectronicsBuildSettings(getProjectId) {
  const toggle = document.getElementById('prompt-auto-wiring');
  const sync = () => { if (toggle) toggle.checked = automaticWiringEnabled(getProjectId()); };
  sync();
  toggle?.addEventListener('change', () => {
    try { localStorage.setItem(`${KEY}:${getProjectId() || 'new'}`, toggle.checked ? '1' : '0'); } catch {}
  });
  document.getElementById('prompt-ai-gear')?.addEventListener('click', sync);
  document.getElementById('prompt-parts-list')?.addEventListener('click', () => {
    document.dispatchEvent(new CustomEvent('render:open-parts', { detail: { tab: 'electronics' } }));
  });
}
