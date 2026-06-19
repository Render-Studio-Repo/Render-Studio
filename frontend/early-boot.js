/** Load projects before the heavy 3D editor — keeps sidebar usable if app.js fails. */
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

async function loadProjects() {
  showBrowser('<p class="muted small browser-empty">Loading projects…</p>');

  const token = getToken();
  if (!token) {
    showBrowser('<p class="muted small browser-empty">Sign in to view your projects</p>');
    return;
  }

  try {
    const meRes = await fetch("/api/auth/me", { headers: authHeaders() });
    if (!meRes.ok) throw new Error("Session expired — sign in again from the account menu.");
    const me = await meRes.json();
    const teams = me.teams || [];
    const saved = localStorage.getItem("render3d:lastWorkspaceId");
    const teamId =
      saved && teams.some((t) => t.id === saved) ? saved : teams[0]?.id || null;

    const qs = teamId ? `?team_id=${encodeURIComponent(teamId)}` : "";
    let res = await fetch(`/api/projects${qs}`, { headers: authHeaders() });
    if (!res.ok) throw new Error("Could not load projects");
    let data = await res.json();
    let projects = data.projects || [];

    if (!projects.length && teamId) {
      res = await fetch("/api/projects", { headers: authHeaders() });
      if (res.ok) {
        data = await res.json();
        projects = data.projects || [];
      }
    }

    if (window.__appProjectListReady) return;

    if (!projects.length) {
      showBrowser('<p class="muted small browser-empty">No projects yet — create one or upload a model.</p>');
      return;
    }

    const browser = document.getElementById("project-browser");
    if (!browser) return;

    const note = document.createElement("p");
    note.className = "muted small browser-boot-note";
    note.textContent = `${projects.length} project${projects.length === 1 ? "" : "s"} — loading editor…`;

    const ul = document.createElement("ul");
    ul.className = "project-list project-list-early";
    for (const p of projects) {
      const li = document.createElement("li");
      li.className = "proj-item";
      li.dataset.projectId = p.id;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "proj-row-body";
      btn.innerHTML =
        `<span class="proj-name">${esc(p.name || p.id)}</span>`;
      btn.addEventListener("click", () => {
        li.classList.add("proj-item--loading");
        btn.insertAdjacentHTML(
          "afterbegin",
          '<span class="proj-loading-spinner" aria-hidden="true"></span>'
        );
        if (typeof window.__openProject === "function") {
          window.__openProject(p.id);
          return;
        }
        try {
          localStorage.setItem("render3d:lastProjectId", p.id);
        } catch (_) {}
        location.reload();
      });
      li.appendChild(btn);
      ul.appendChild(li);
    }

    browser.innerHTML = "";
    browser.appendChild(note);
    browser.appendChild(ul);
  } catch (err) {
    showBrowser(`<p class="status error browser-empty">${esc(err.message || "Could not load projects")}</p>`);
  }
}

window.addEventListener("error", (e) => {
  if (window.__appProjectListReady) return;
  const msg = e.message || "Unknown error";
  const browser = document.getElementById("project-browser");
  if (browser?.querySelector(".proj-item, .project-list-early li")) {
    const note = document.createElement("p");
    note.className = "status error browser-empty";
    note.textContent = `Editor failed to start (${msg}). Projects are listed above — hard refresh (Ctrl+Shift+R) or sign in again.`;
    browser.appendChild(note);
    return;
  }
  showBrowser(
    `<p class="status error browser-empty">Editor failed to start (${esc(msg)}). Hard refresh (Ctrl+Shift+R) or sign in again.</p>`
  );
});

window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled rejection:", e.reason);
});

loadProjects();
