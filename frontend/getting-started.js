/** Getting Started feature guides for Docs. */

import { GETTING_STARTED_GUIDES } from "./getting-started-guides.js?v=20260715-real-gifs";
import { GETTING_STARTED_TIPS } from "./getting-started-tips.js?v=20260715-agent-tips-refresh";
import { authHeaders, createAuthUI, getStoredUser, getToken } from "./auth.js?v=20260709-admin-matt";
import { createRenderAgent } from "./render-agent.js?v=20260715-gs-autoopen";

const FEATURES = GETTING_STARTED_GUIDES;

const TOC_LABELS = {
  "ai-generate": "AI Generate",
  workspaces: "Workspaces",
  "share-folders": "Share folders",
  "reference-markup": "Reference markup",
  canvas: "Canvas",
  picks: "Geometry picks",
  wiring: "Wiring",
  "cloud-sync": "Fusion / Onshape",
  "render-agent": "Render Agent",
  "tips-tricks": "Tips & tricks",
};

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
        <div class="gs-demo-body"></div>
      </div>
    </div>
  `;
}

function featureCard(feature, index) {
  const n = String(index + 1).padStart(2, "0");
  const flip = index % 2 === 1 ? " gs-feature--flip" : "";
  return `
    <section class="gs-feature${flip}" id="${esc(feature.id)}">
      <div class="gs-feature-media">
        ${demoHtml(feature)}
        <p class="gs-demo-label">Live demo</p>
      </div>
      <div class="gs-feature-copy">
        <p class="gs-feature-index">${n}</p>
        <h3>${esc(feature.title)}</h3>
        <p class="gs-summary">${esc(feature.summary)}</p>
        <ol class="gs-steps">
          ${(feature.steps || []).map((step) => `<li>${esc(step)}</li>`).join("")}
        </ol>
        <button type="button" class="btn accent gs-ask-btn" data-gs-ask="${esc(feature.ask)}">
          Ask Render Agent about this
        </button>
      </div>
    </section>
  `;
}

function tipCard(tip, index) {
  const ask = tip.starter || `Tell me more about this Render3D tip: ${tip.title}`;
  const steps = Array.isArray(tip.steps) ? tip.steps : [];
  return `
    <article class="gs-tip-card">
      <p class="gs-tip-topic">${esc(tip.topic || "Tip")} · ${String(index + 1).padStart(2, "0")}</p>
      <h4>${esc(tip.title)}</h4>
      <p>${esc(tip.body)}</p>
      ${steps.length ? `
        <ol class="gs-tip-steps">
          ${steps.map((step) => `<li>${esc(step)}</li>`).join("")}
        </ol>
      ` : ""}
      <button type="button" class="btn secondary btn-compact gs-tip-ask" data-gs-ask="${esc(ask)}">
        Ask about this tip
      </button>
    </article>
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

function mountToc() {
  const host = document.getElementById("gs-toc");
  if (!host) return;
  host.innerHTML = `
    <p class="gs-toc-title">On this page</p>
    ${FEATURES.map((f) => `
      <a href="#${esc(f.id)}" data-gs-toc="${esc(f.id)}">${esc(TOC_LABELS[f.id] || f.title)}</a>
    `).join("")}
  `;
}

function mountFeatures() {
  const host = document.getElementById("gs-features");
  if (!host) return;
  host.innerHTML = FEATURES.map((f, i) => featureCard(f, i)).join("");
  host.querySelectorAll(".gs-demo-gif").forEach((img) => {
    img.addEventListener("error", () => {
      img.remove();
    });
    img.addEventListener("load", () => {
      img.closest(".gs-demo")?.classList.add("has-gif");
    });
    if (img.complete && img.naturalWidth) {
      img.closest(".gs-demo")?.classList.add("has-gif");
    }
  });
}

function mountTips() {
  const host = document.getElementById("gs-tips-grid");
  if (!host) return;
  host.innerHTML = GETTING_STARTED_TIPS.map((tip, i) => tipCard(tip, i)).join("");
}

function mountReveal() {
  const nodes = document.querySelectorAll(".gs-feature, .gs-tips-section, .gs-closing, .gs-hero");
  if (!("IntersectionObserver" in window)) {
    nodes.forEach((el) => el.classList.add("is-visible"));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
  );
  nodes.forEach((el) => io.observe(el));
}

function mountTocSpy() {
  const links = [...document.querySelectorAll("[data-gs-toc]")];
  if (!links.length || !("IntersectionObserver" in window)) return;
  const byId = new Map(links.map((a) => [a.getAttribute("data-gs-toc"), a]));
  const io = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const id = visible.target.id;
      links.forEach((a) => a.classList.toggle("is-active", a.getAttribute("data-gs-toc") === id));
    },
    { rootMargin: "-20% 0px -55% 0px", threshold: [0.2, 0.5, 0.8] }
  );
  FEATURES.forEach((f) => {
    const el = document.getElementById(f.id);
    if (el) io.observe(el);
  });
  byId.get(FEATURES[0]?.id)?.classList.add("is-active");
}

function askTour(agent, authUi, question) {
  if (!getToken()) {
    sessionStorage.setItem("render3d:gsPendingAsk", question);
    authUi?.openModal?.();
    return;
  }
  void agent?.openWithQuestion?.(question, { autoSend: true });
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

  const openDefault = () => {
    agent?.open?.();
  };

  // Expand agent panel by default on Getting Started
  openDefault();

  const authUi = createAuthUI({
    api,
    onReady: (data) => {
      currentUser = data.user;
      agent?.setUser?.(data.user);
      openDefault();
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
    }
    openDefault();
    const pending = sessionStorage.getItem("render3d:gsPendingAsk");
    if (pending && data?.user) {
      sessionStorage.removeItem("render3d:gsPendingAsk");
      setTimeout(() => void agent?.openWithQuestion?.(pending, { autoSend: true }), 400);
    }
  });

  const tourQ = "Give me a tour of Render3D for a new user";

  document.getElementById("gs-features")?.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-gs-ask]");
    if (!btn) return;
    askTour(agent, authUi, btn.getAttribute("data-gs-ask") || "");
  });

  document.getElementById("gs-tips-grid")?.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-gs-ask]");
    if (!btn) return;
    askTour(agent, authUi, btn.getAttribute("data-gs-ask") || "");
  });

  document.getElementById("gs-ask-tour")?.addEventListener("click", (e) => {
    e.preventDefault();
    askTour(agent, authUi, tourQ);
  });

  document.getElementById("gs-ask-again")?.addEventListener("click", () => {
    askTour(agent, authUi, tourQ);
  });

  return { agent, authUi };
}

mountToc();
mountFeatures();
mountTips();
mountReveal();
mountTocSpy();
mountAgent();
