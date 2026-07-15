/** Getting Started feature guides for Docs. */

import { GETTING_STARTED_GUIDES } from "./getting-started-guides.js?v=20260715-link-prompt";
import { GETTING_STARTED_TIPS } from "./getting-started-tips.js?v=20260715-tips-tricks";
import { authHeaders, createAuthUI, getStoredUser, getToken } from "./auth.js?v=20260715-auth-connect-social";
import { createRenderAgent } from "./render-agent.js?v=20260715-docs-no-close-fab";
import { startShowMe } from "./show-me-tour.js?v=20260715-show-me-circle4";
import { enhanceDocsGifs } from "./docs-gif-expand.js?v=20260715-gif-expand";

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
  "link-to-prompt": "Link to prompt",
  "tips-library": "Tips & tricks",
};

const TOC_SECTIONS = [
  {
    title: "AI CAD & Prompting",
    ids: ["ai-generate", "link-to-prompt", "picks"],
  },
  {
    title: "Projects & Collaboration",
    ids: ["workspaces", "share-folders"],
  },
  {
    title: "Reference & Sketch",
    ids: ["reference-markup", "canvas"],
  },
  {
    title: "Tools & Integrations",
    ids: ["wiring", "cloud-sync", "render-agent"],
  },
];

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

function tipVisual(topic = "") {
  const key = String(topic).toLowerCase();
  if (key.includes("dxf") || key.includes("drawing")) return { cls: "drawing", label: "DXF", glyph: "2D" };
  if (key.includes("software")) return { cls: "software", label: "Mode", glyph: "2.0" };
  if (key.includes("project")) return { cls: "files", label: "Files", glyph: "REF" };
  if (key.includes("geometry")) return { cls: "geometry", label: "Pick", glyph: "@F" };
  if (key.includes("editing")) return { cls: "editing", label: "Edit", glyph: "REV" };
  if (key.includes("reference")) return { cls: "markup", label: "Markup", glyph: "PEN" };
  if (key.includes("canvas")) return { cls: "canvas", label: "Sketch", glyph: "SK" };
  if (key.includes("collab")) return { cls: "collab", label: "Team", glyph: "TM" };
  if (key.includes("cloud")) return { cls: "cloud", label: "CAD", glyph: "CAD" };
  if (key.includes("wiring")) return { cls: "wiring", label: "Wire", glyph: "IO" };
  return { cls: "prompt", label: "Prompt", glyph: "AI" };
}

function tipCard(tip, index) {
  const ask = tip.starter || `Tell me more about this Render3D tip: ${tip.title}`;
  const steps = Array.isArray(tip.steps) ? tip.steps : [];
  const visual = tipVisual(tip.topic);
  return `
    <article class="gs-tip-card gs-tip-card--${esc(visual.cls)}">
      <div class="gs-tip-thumb" aria-hidden="true">
        <span class="gs-tip-thumb-glyph">${esc(visual.glyph)}</span>
        <span class="gs-tip-thumb-label">${esc(visual.label)}</span>
      </div>
      <div class="gs-tip-content">
        <p class="gs-tip-topic">${esc(tip.topic || "Tip")} · ${String(index + 1).padStart(2, "0")}</p>
        <h4>${esc(tip.title)}</h4>
        <p>${esc(tip.body)}</p>
        ${steps.length ? `
          <ol class="gs-tip-steps">
            ${steps.map((step) => `<li>${esc(step)}</li>`).join("")}
          </ol>
        ` : ""}
      </div>
      <button type="button" class="gs-tip-ask" data-gs-ask="${esc(ask)}">
        <span>Ask about this tip</span>
        <small>Open Render Agent</small>
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
  const guidesById = new Map(FEATURES.map((guide) => [guide.id, guide]));
  const seen = new Set();
  const sectionHtml = TOC_SECTIONS.map((section) => {
    const links = section.ids
      .map((id) => guidesById.get(id))
      .filter(Boolean)
      .map((guide) => {
        seen.add(guide.id);
        return `<a href="#${esc(guide.id)}" data-gs-toc="${esc(guide.id)}">${esc(TOC_LABELS[guide.id] || guide.title)}</a>`;
      })
      .join("");
    return links
      ? `<div class="gs-toc-group"><p class="gs-toc-group-title">${esc(section.title)}</p>${links}</div>`
      : "";
  }).join("");
  const extraLinks = FEATURES
    .filter((guide) => !seen.has(guide.id))
    .map((guide) => `<a href="#${esc(guide.id)}" data-gs-toc="${esc(guide.id)}">${esc(TOC_LABELS[guide.id] || guide.title)}</a>`)
    .join("");
  host.innerHTML = `
    <p class="gs-toc-title">On this page</p>
    <a class="gs-toc-docs" href="/docs.html#complete-docs">Complete documentation</a>
    ${sectionHtml}
    ${extraLinks ? `<div class="gs-toc-group"><p class="gs-toc-group-title">More</p>${extraLinks}</div>` : ""}
    <div class="gs-toc-group">
      <p class="gs-toc-group-title">Extras</p>
      <a href="#tips-library" data-gs-toc="tips-library">${esc(TOC_LABELS["tips-library"])}</a>
    </div>
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
  enhanceDocsGifs(host);
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
  const tips = document.getElementById("tips-library");
  if (tips) io.observe(tips);
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

function syncDocsCategoryTabs() {
  const hash = String(location.hash || "").replace(/^#/, "");
  document.querySelectorAll(".docs-category-tabs .docs-category-tab").forEach((tab) => {
    const href = tab.getAttribute("href") || "";
    const isTips = href.includes("tips-library");
    const isGettingStarted = href.endsWith("getting-started.html") || href === "/getting-started.html";
    let active = false;
    if (hash === "tips-library") active = isTips;
    else if (!hash) active = isGettingStarted && !isTips;
    else active = false;
    if (isGettingStarted && !isTips && hash && hash !== "tips-library") {
      // Feature anchors still count as Getting Started.
      active = true;
    }
    tab.classList.toggle("active", active);
  });
  document.querySelectorAll(".toolbar-nav-menu .nav-tab").forEach((tab) => {
    const href = tab.getAttribute("href") || "";
    const isTips = href.includes("tips-library");
    const isDocs = href.endsWith("/docs.html") || href === "/docs.html";
    if (isTips) tab.classList.toggle("active", hash === "tips-library");
    if (isDocs) tab.classList.toggle("active", hash !== "tips-library");
  });
}
syncDocsCategoryTabs();
window.addEventListener("hashchange", syncDocsCategoryTabs);

mountAgent();
