/** Getting Started feature guides for Docs. */

import { GETTING_STARTED_GUIDES } from "./getting-started-guides.js?v=20260715-tips-tricks";
import { GETTING_STARTED_TIPS } from "./getting-started-tips.js?v=20260715-tips-tricks";
import { authHeaders, createAuthUI, getStoredUser, getToken } from "./auth.js?v=20260709-admin-matt";
import { createRenderAgent } from "./render-agent.js?v=20260715-gs-hero-free";
import { startShowMe } from "./show-me-tour.js?v=20260715-gs-deck";

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
  return `
    <section class="gs-feature" id="${esc(feature.id)}">
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
        <div class="gs-feature-actions">
          <button type="button" class="btn accent gs-ask-btn" data-gs-ask="${esc(feature.ask)}">
            Ask Agent
          </button>
          <button type="button" class="btn secondary gs-show-me-btn" data-gs-show-me="${esc(feature.id)}">
            Show me
          </button>
        </div>
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
    <a href="#create-guide" data-gs-toc="create-guide">Create a guide</a>
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
  const nodes = document.querySelectorAll(".gs-feature, .gs-tips-section, .gs-closing, .gs-hero, .gs-create");
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
  const create = document.getElementById("create-guide");
  if (create) io.observe(create);
  links[0]?.classList.add("is-active");
}

function askTour(agent, authUi, question) {
  if (!getToken()) {
    sessionStorage.setItem("render3d:gsPendingAsk", question);
    authUi?.openModal?.();
    return;
  }
  void agent?.openWithQuestion?.(question, { autoSend: true });
  agent?.enterPresentationDeck?.();
}

async function generateCustomGuide(agent, authUi, question) {
  if (!getToken()) {
    sessionStorage.setItem("render3d:gsPendingAsk", question);
    authUi?.openModal?.();
    return;
  }
  const status = document.getElementById("gs-create-status");
  if (status) status.textContent = "Generating GIF instructions…";
  try {
    agent?.open?.();
    agent?.enterPresentationDeck?.();
    const data = await api("/api/getting-started/generate-guide", {
      method: "POST",
      body: JSON.stringify({
        question,
        thread_id: null,
      }),
    }, 120000);
    const guide = data.guide || {};
    const media = data.media || [];
    const steps = (guide.steps || []).map((s, i) => `${i + 1}. ${s}`).join("\n");
    const reply = [
      `**${guide.title || "Custom guide"}**`,
      guide.summary || "",
      "",
      steps,
      "",
      data.matched_existing
        ? "This already exists in Getting Started — opening the matching demo."
        : "Queued for management approval to add to Getting Started.",
    ].filter(Boolean).join("\n");

    // Seed a local assistant-style card via asking the agent the guide ask, with deck open.
    await agent?.openWithQuestion?.(guide.ask || question, { autoSend: true });
    if (status) {
      status.textContent = data.matched_existing
        ? "Matched an existing Getting Started guide."
        : (data.detail || "Submitted for management approval.");
    }
    // Also surface generated steps under the form.
    const preview = document.getElementById("gs-create-preview");
    if (preview) {
      preview.classList.remove("hidden");
      preview.innerHTML = `
        <div class="gs-create-preview-card">
          ${media[0]?.url ? `<img src="${esc(media[0].url)}" alt="" />` : ""}
          <div>
            <strong>${esc(guide.title || "Guide")}</strong>
            <p>${esc(guide.summary || "")}</p>
            <ol>${(guide.steps || []).map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
            <div class="gs-feature-actions">
              <button type="button" class="btn accent btn-compact" data-gs-ask="${esc(guide.ask || question)}">Ask Agent</button>
              ${guide.id ? `<button type="button" class="btn secondary btn-compact" data-gs-show-me="${esc(String(guide.id).replace(/^user-.*/, "ai-generate"))}">Show me</button>` : ""}
            </div>
          </div>
        </div>
      `;
    }
    void reply;
  } catch (err) {
    if (status) status.textContent = err.message || "Could not generate guide.";
  }
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
    agent?.open?.({ onboarding: true });
  };

  // Compact sticky agent by default on Getting Started (drag edges to resize).
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
    const show = e.target.closest?.("[data-gs-show-me]");
    if (show) {
      startShowMe(show.getAttribute("data-gs-show-me") || "", { onDocsPage: true });
      return;
    }
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

  document.getElementById("gs-create-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = document.getElementById("gs-create-question")?.value?.trim() || "";
    if (!q) return;
    void generateCustomGuide(agent, authUi, q);
  });

  document.getElementById("gs-create-preview")?.addEventListener("click", (e) => {
    const show = e.target.closest?.("[data-gs-show-me]");
    if (show) {
      startShowMe(show.getAttribute("data-gs-show-me") || "", { onDocsPage: true });
      return;
    }
    const btn = e.target.closest?.("[data-gs-ask]");
    if (btn) askTour(agent, authUi, btn.getAttribute("data-gs-ask") || "");
  });

  return { agent, authUi };
}

mountToc();
mountFeatures();
mountTips();
mountReveal();
mountTocSpy();
mountAgent();
