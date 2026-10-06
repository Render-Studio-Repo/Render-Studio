/** Relocated. Sandbox scene is /sandbox/office.js — prod Office stays on opensource-office.js. */
console.warn("sandbox-office.js moved to /sandbox/office.js");
export async function mountOffice(host) {
  const m = await import("/sandbox/office.js?v=20260923-draw-recordings1");
  return m.mountOffice(host);
}
