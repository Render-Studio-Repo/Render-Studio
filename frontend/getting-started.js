/** Getting Started feature guides for Docs. */

import { GETTING_STARTED_GUIDES } from "./getting-started-guides.js?v=20260715-gs-guides";
import { authHeaders, createAuthUI, getStoredUser, getToken } from "./auth.js?v=20260709-admin-matt";
import { createRenderAgent } from "./render-agent.js?v=20260715-gs-sticky";

const FEATURES = GETTING_STARTED_GUIDES;

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function demoHtml(feature) {
  const kind = feature.demo || "generate";
  return `
    <div class="gs-demo" data-demo="${esc(kind)}" aria-hidden="true">
      <img class="gs-demo-gif" src="${esc(feature.gif)}" alt="" loading="lazy" />
      <div class="gs-demo-stage gs-demo-stage--${esc(kind)}">
        <div class="gs-demo-chrome">
          <span></span><span></span><span></span>
          <em>${esc(feature.title)}</em>
        </div>
        <div class="gs-demo-body">
          <div class="gs-demo-cursor"></div>
          <div class="gs-demo-panel"></div>
          <div class="gs-demo-viewport"></div>
          <div class="gs-demo-caption"></div>
        </div>
      </div>
    </div>
  `;
}

function featureCard(feature) {
  return `
    <section class="gs-feature info-section" id="${esc(feature.id)}">
      <div class="gs-feature-grid">
        <div class="gs-feature-media">
          ${demoHtml(feature)}
          <p class="muted small gs-demo-label">Quick demo (loops)</p>
        </div>
        <div class="gs-feature-copy">
          <h3>${esc(feature.title)}</h3>
          <p class="gs-summary">${esc(feature.summary)}</p>
          <h4 class="gs-detail-title">Step by step</h4>
          <ol class="gs-steps">
            ${(feature.steps || []).map((step) => `<li>${esc(step)}</li>`).join("")}
          </ol>
          <button type="button" class="btn accent gs-ask-btn" data-gs-ask="${esc(feature.ask)}">
            Ask Render Agent about this
          </button>
        </div>
      </div>
    </section>
  `;
}

async function api(path, options = {}, timeoutMs = 60000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      ...options,
      signal: ctrl.signal,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...authHeaders(options.headers || {}),
      },
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { detail: text };
    }
    if (!res.ok) {
      const err = new Error(data?.detail || data?.message || res.statusText || "Request failed");
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function mountFeatures() {
  const host = document.getElementById("gs-features");
  if (!host) return;
  host.innerHTML = FEATURES.map(featureCard).join("");
  host.querySelectorAll(".gs-demo-gif").forEach((img) => {
    img.addEventListener("error", () => {
      img.remove();
    });
    img.addEventListener("load", () => {
      img.closest(".gs-demo")?.classList.add("has-gif");
    });
  });
}

function mountAgent() {
  let currentUser = getStoredUser();
  const agent = createRenderAgent({
    api,
    getProjectId: () => null,
    getSelectedFile: () => null,
    getCurrentUser: () => currentUser,
    getTeams: () => [],
    getSelectedWorkspaceId: () => null,
    getSelectedAiKey: () => ({}),
    stickyNote: true,
    onRequireLogin: () => authUi?.openModal?.(),
    onStatus: () => {},
  });

  const authUi = createAuthUI({
    api,
    onReady: (data) => {
      currentUser = data.user;
      agent?.setUser?.(data.user);
      const pending = sessionStorage.getItem("render3d:gsPendingAsk");
      if (pending) {
        sessionStorage.removeItem("render3d:gsPendingAsk");
        setTimeout(() => void agent?.openWithQuestion?.(pending, { autoSend: true }), 250);
      }
    },
  });

  void authUi.bootstrap?.().then((data) => {
    if (data?.user) {
      currentUser = data.user;
      agent?.setUser?.(data.user);
      const pending = sessionStorage.getItem("render3d:gsPendingAsk");
      if (pending) {
        sessionStorage.removeItem("render3d:gsPendingAsk");
        setTimeout(() => void agent?.openWithQuestion?.(pending, { autoSend: true }), 400);
      }
    }
  });

  document.getElementById("gs-features")?.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-gs-ask]");
    if (!btn) return;
    const question = btn.getAttribute("data-gs-ask") || "";
    if (!getToken()) {
      sessionStorage.setItem("render3d:gsPendingAsk", question);
      authUi?.openModal?.();
      return;
    }
    void agent?.openWithQuestion?.(question, { autoSend: true });
  });

  document.getElementById("gs-ask-tour")?.addEventListener("click", (e) => {
    e.preventDefault();
    const question = "Give me a tour of Render3D for a new user";
    if (!getToken()) {
      sessionStorage.setItem("render3d:gsPendingAsk", question);
      authUi?.openModal?.();
      return;
    }
    void agent?.openWithQuestion?.(question, { autoSend: true });
  });

  return { agent, authUi };
}

mountFeatures();
mountAgent();
