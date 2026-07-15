/** Keep the sidebar quiet while the heavy editor boots — no project name dump. */
import { authHeaders, getToken } from "./auth.js";

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showBrowser(html) {
  const browser = document.getElementById("project-browser");
  if (browser && !window.__appProjectListReady) browser.innerHTML = html;
}

function bootSpinner(message = "Loading studio…") {
  return `<div class="browser-boot-spinner" role="status" aria-live="polite">
    <span class="studio-boot-spinner studio-boot-spinner--inline" aria-hidden="true"></span>
    <p class="muted small">${esc(message)}</p>
  </div>`;
}

function dismissStudioBoot() {
  document.body.classList.remove("studio-booting");
  const el = document.getElementById("studio-boot-screen");
  if (!el || el.classList.contains("is-done")) return;
  window.__setStudioBootProgress?.(100, "Studio ready.");
  el.classList.add("is-done");
  el.setAttribute("aria-busy", "false");
  window.setTimeout(() => el.remove(), 520);
}

window.__dismissStudioBoot = dismissStudioBoot;

async function loadProjects() {
  window.__setStudioBootProgress?.(18, "Preparing projects and editor...");
  showBrowser(bootSpinner("Loading studio…"));

  const token = getToken();
  if (!token) {
    window.__setStudioBootProgress?.(100, "Ready for sign in.");
    showBrowser('<p class="muted small browser-empty">Sign in to view your projects</p>');
    dismissStudioBoot();
    return;
  }

  try {
    const meRes = await fetch("/api/auth/me", { headers: authHeaders() });
    if (!meRes.ok) throw new Error("Session expired — sign in again from the account menu.");
    window.__setStudioBootProgress?.(42, "Authenticating workspace...");
    // Warm the projects API while the editor module loads — do not render names yet.
    const me = await meRes.json();
    const teams = me.teams || [];
    const saved = localStorage.getItem("render3d:lastWorkspaceId");
    const teamId =
      saved && teams.some((t) => t.id === saved) ? saved : teams[0]?.id || null;
    const qs = teamId ? `?team_id=${encodeURIComponent(teamId)}` : "";
    window.__setStudioBootProgress?.(64, "Preparing project list...");
    await fetch(`/api/projects${qs}`, { headers: authHeaders() }).catch(() => null);

    if (window.__appProjectListReady) return;
    window.__setStudioBootProgress?.(82, "Loading editor systems...");
    showBrowser(bootSpinner("Loading editor…"));
  } catch (err) {
    showBrowser(`<p class="status error browser-empty">${esc(err.message || "Could not load projects")}</p>`);
    dismissStudioBoot();
  }
}

window.addEventListener("error", (e) => {
  if (window.__appProjectListReady) return;
  const msg = e.message || "Unknown error";
  showBrowser(
    `<p class="status error browser-empty">Editor failed to start (${esc(msg)}). Hard refresh (Ctrl+Shift+R) or sign in again.</p>`
  );
  dismissStudioBoot();
});

window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled rejection:", e.reason);
});

loadProjects();
