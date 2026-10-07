/** Getting Started feature guides for Docs. */

import { GETTING_STARTED_GUIDES } from "./getting-started-guides.js?v=20261006-jake-parity1";
import {
  VR_CONTROLS_GUIDES,
  vrControlsDocsIntroHtml,
  bindVrControlsDocs,
} from "./vr-controls-docs.js?v=xrmap1-xrdbg1-xrdbg2-xrrest1-xrrest2-20260915-xrdispatch4-20260916-vrwalk1&inputfix=20260916-1";
import { GETTING_STARTED_TIPS } from "./getting-started-tips.js?v=20260916-gifs40";
import { authHeaders, createAuthUI, getStoredUser, getToken, isSuperAdminUser } from "../studio/auth.js?v=20260914-forgot-pw-sblogin1-sblogin2-loginlog1-loginfix1";
import { createRenderAgent } from "../components/render-agent.js?v=20261006-designchat-hey-ai1";
import { startShowMe } from "./show-me-tour.js?v=20260916-gifs40-settings-redesign2-docgif1";
import { enhanceDocsGifs } from "./docs-gif-expand.js?v=20260715-gif-expand";
import {
  applyOverrides,
  heroFields,
  heroFromForm,
  loadSitePages,
  openCmsEditor,
  pencilHtml,
  saveSitePages,
  setBannerImage,
  setHeroText,
  templateFields,
  templateFromForm,
} from "../admin/site-pages-cms.js?v=20260908-site-cms";

let FEATURES = [...GETTING_STARTED_GUIDES, ...VR_CONTROLS_GUIDES];
let cmsPages = {};
let cmsCanEdit = false;

const TOC_LABELS = {
  "ai-generate": "AI Generate",
  workspaces: "Workspaces",
  "share-folders": "Share folders",
  "reference-markup": "Reference markup",
  canvas: "Canvas",
  "viewport-finder": "Cmd/Ctrl+F finder",
  "pin-projects": "Pin projects",
  "clip-video-editor": "Video editor",
  "imagine-panel": "Imagine & /fetch",
  "prompt-persist": "Prompt drafts",
  "reference-folders": "Reference folders",
  "wiring-compose": "Wiring History",
  "parts-catalog": "Parts Catalog",
  picks: "Geometry picks",
  "select-object": "Select object & body",
  wiring: "Wiring",
  "source-parts": "Source parts",
  "cloud-sync": "Fusion / Onshape",
  "render-agent": "Render Agent",
  "link-to-prompt": "Link to prompt",
  "robotics-configuration": "Robotics config",
  "vr-controls": "VR Controls",
  "vr-enter": "Enter VR",
  "vr-laser": "Laser & Settings",
  "vr-debugger": "Debugger",
  "vr-restart": "Restart scene",
  "vr-remap": "Remap controls",
  "robotics-viser-lan": "Viser LAN proxy",
  "robotics-teleop-proxy": "Teleop HTTPS proxy",
  "robotics-wrist-cameras": "Wrist cameras",
  "tips-library": "Tips & tricks",
  preferences: "Preferences",
  "self-host": "Connect database",
  "viewport-split-layouts": "Split layouts",
  "public-pin": "Public pin",
  "film-edit": "AI film-edit",
  "native-joints": "Native joints",
  "code-workspace": "Code workspace",
  "settings-search": "Settings search",
  "mobile-studio": "Mobile studio",
  "share-remix": "Share & remix",
  "freecad-kernel": "FreeCAD kernel",
  "vr-menu": "VR menu",
  "public-room": "Public room",
  "document-tabs": "Document tabs",
  "dimos-enable": "Enable DIMOS",
  "kernel-measure": "Kernel measure",
  "send-to-wiring": "Send to wiring",
  "edit-selected": "Edit selected",
  "marketplace-layouts": "Marketplace layouts",
  "exploded-view": "Exploded view",
  "wiring-3d-ar": "Wiring 3D / AR",
  "vr-spatial-draw": "Spatial AI Draw",
};

const TOC_SECTIONS = [
  {
    title: "AI CAD & Prompting",
    ids: ["ai-generate", "link-to-prompt", "picks", "imagine-panel", "prompt-persist", "edit-selected"],
  },
  {
    title: "Projects & Collaboration",
    ids: ["workspaces", "share-folders", "pin-projects", "public-pin", "share-remix", "clip-video-editor", "film-edit", "reference-folders", "code-workspace"],
  },
  {
    title: "Modeling & Viewport",
    ids: ["select-object", "solid-tools", "viewport-finder", "viewport-split-layouts", "document-tabs", "freecad-kernel", "kernel-measure", "exploded-view", "marketplace-layouts"],
  },
  {
    title: "Reference & Sketch",
    ids: ["reference-markup", "canvas", "vr-spatial-draw"],
  },
  {
    title: "Tools & Integrations",
    ids: ["wiring", "wiring-compose", "send-to-wiring", "wiring-3d-ar", "source-parts", "parts-catalog", "cloud-sync", "render-agent", "robotics-configuration", "dimos-enable", "native-joints"],
  },
];

const RELATED_TERMS = {
  fusion: ["autodesk", "cloud", "step", "export", "sync"],
  onshape: ["cloud", "step", "export", "sync"],
  robot: ["rigging", "urdf", "srdf", "motion", "joints", "teleop", "viser", "openarm"],
  teleop: ["quest", "dimos", "openarm", "proxy", "8443"],
  viser: ["8095", "lan", "proxy"],
  share: ["folder", "remix", "public", "collaboration"],
  files: ["project", "reference", "drag", "component"],
  prompt: ["ai", "generate", "agent", "reference"],
  drawing: ["dxf", "sketch", "canvas", "markup"],
  pick: ["face", "edge", "geometry", "path", "body", "select", "double"],
  select: ["body", "object", "double", "click", "part", "robot"],
  finder: ["cmd", "ctrl", "search", "spotlight"],
  pin: ["star", "pinned", "favorites", "projects"],
  video: ["clip", "editor", "film", "record", "gif", "timeline"],
  imagine: ["image", "fetch", "product"],
  catalog: ["mcmaster", "parts", "insert", "step"],
};

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const LAN_IP_PLACEHOLDER = "YOUR_LAN_IP";
const LAN_IP_STORAGE_KEY = "render3d:docsLanIp";
const HOW_TO_GET_IP_QUESTION = [
  "How do I find my Raspberry Pi or computer LAN IPv4 so I can paste it into Render Studio Robotics Configuration?",
  "",
  "Explain practically for each OS — I need the LAN address (like 192.168.x.x, 10.x, or 172.16–31.x), not 127.0.0.1:",
  "- Windows: Settings → Network, or Command Prompt `ipconfig` (IPv4 Address on Wi-Fi / Ethernet).",
  "- macOS: System Settings → Network, or Terminal `ipconfig getifaddr en0` / `ifconfig`.",
  "- Linux: Settings → Network, or `ip addr` / `hostname -I`.",
  "- Raspberry Pi: the network icon, `hostname -I`, or `ip addr`.",
  "",
  "Then I will use https://YOUR_LAN_IP:8443/teleop and http://YOUR_LAN_IP:8095.",
].join("\n");

let docsLanIp = "";

function isRoboticsGuide(feature) {
  return String(feature?.category || "") === "robotics"
    || String(feature?.id || "").startsWith("robotics-");
}

function hostFromMaybeUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    const withProto = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `http://${s.replace(/^\[|\]$/g, "")}`;
    const host = new URL(withProto).hostname.replace(/^\[|\]$/g, "");
    if (!host || /^(localhost|127\.0\.0\.1|::1)$/i.test(host)) return "";
    return host;
  } catch {
    const host = s.replace(/^https?:\/\//i, "").split("/")[0].replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
    if (!host || /^(localhost|127\.0\.0\.1|::1)$/i.test(host)) return "";
    return host;
  }
}

function lanIpFromPrefsObject(prefs = {}) {
  const candidates = [
    prefs.teleopActive,
    prefs.viserActive,
    prefs.active,
    prefs.draft,
    ...(prefs.teleopUrls || []),
    ...(prefs.viserUrls || []),
    ...(prefs.urls || []),
  ];
  for (const item of candidates) {
    const host = hostFromMaybeUrl(item);
    if (host) return host;
  }
  return "";
}

function lanIpFromLocalStorage() {
  try {
    const store = localStorage;
    const remembered = String(store.getItem(LAN_IP_STORAGE_KEY) || "").trim();
    const fromRemembered = hostFromMaybeUrl(remembered) || (remembered && remembered !== LAN_IP_PLACEHOLDER ? remembered : "");
    if (fromRemembered) return fromRemembered;
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i) || "";
      if (!key.startsWith("render3d:teleopPrefs") && !key.startsWith("render3d:viserPrefs")) continue;
      let parsed = null;
      try { parsed = JSON.parse(store.getItem(key) || "null"); } catch { parsed = null; }
      const host = lanIpFromPrefsObject(parsed || {});
      if (host) return host;
    }
  } catch {
    /* ignore */
  }
  return "";
}

function displayLanIp(raw) {
  const s = String(raw || "").trim();
  if (!s || s === LAN_IP_PLACEHOLDER) return "";
  return hostFromMaybeUrl(s)
    || s.replace(/^https?:\/\//i, "").split("/")[0].replace(/:\d+$/, "").replace(/^\[|\]$/g, "")
    || "";
}

function applyRoboticsLanIp(raw) {
  const token = displayLanIp(raw) || LAN_IP_PLACEHOLDER;
  const examples = {
    teleop: `https://${token}:8443/teleop`,
    viser: `http://${token}:8095`,
    "teleop-proxy": `/api/teleop/p/${token}/8443/teleop`,
    "viser-proxy": `/api/viser/p/${token}/8095/`,
  };
  document.querySelectorAll("[data-lan-ip-example]").forEach((el) => {
    const key = el.getAttribute("data-lan-ip-example") || "";
    if (examples[key]) el.textContent = examples[key];
  });
  document.querySelectorAll("[data-lan-ip-slot]").forEach((el) => {
    const tmpl = el.getAttribute("data-lan-ip-slot") || "";
    el.textContent = tmpl.split(LAN_IP_PLACEHOLDER).join(token);
  });
}

function showRenderAgent(agent, question, { autoSend = false } = {}) {
  const q = String(question || "").trim();
  if (!q) {
    agent?.open?.({ question: "", force: true });
    return;
  }
  if (autoSend && getToken()) {
    void agent?.openWithQuestion?.(q, { autoSend: true });
    return;
  }
  agent?.open?.({ question: q, force: true });
}

function howToGetIpQuestion() {
  const typed = displayLanIp(document.querySelector("[data-robotics-lan-ip]")?.value || docsLanIp);
  if (!typed) return HOW_TO_GET_IP_QUESTION;
  return `${HOW_TO_GET_IP_QUESTION}\n\nMy Robotics Configuration IP field currently has: ${typed}`;
}

async function hydrateRoboticsLanIp() {
  const input = document.querySelector("[data-robotics-lan-ip]");
  if (!input) return;
  let ip = docsLanIp || lanIpFromLocalStorage();
  if (!ip && getToken()) {
    try {
      const data = await api("/api/users/me/robotics-prefs");
      ip = lanIpFromPrefsObject(data?.prefs || data || {});
    } catch {
      /* ignore */
    }
  }
  if (ip) {
    docsLanIp = ip;
    if (!input.value.trim()) input.value = ip;
  }
  applyRoboticsLanIp(input.value);
  if (input.dataset.lanBound === "1") return;
  input.dataset.lanBound = "1";
  input.addEventListener("input", () => {
    const next = displayLanIp(input.value);
    docsLanIp = next;
    if (next) {
      try { localStorage.setItem(LAN_IP_STORAGE_KEY, next); } catch { /* ignore */ }
    }
    applyRoboticsLanIp(input.value);
  });
}

function queryTokens(query) {
  const base = String(query || "").toLowerCase().match(/[a-z0-9.#+-]+/g) || [];
  const expanded = [...base];
  for (const token of base) {
    for (const [key, terms] of Object.entries(RELATED_TERMS)) {
      if (token.includes(key) || key.includes(token)) expanded.push(...terms);
    }
  }
  return [...new Set(expanded.filter((token) => token.length > 1))];
}

function matchScore(text, query) {
  const tokens = queryTokens(query);
  if (!tokens.length) return 1;
  const hay = String(text || "").toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (hay.includes(token)) score += 2;
    else if (token.length > 3 && hay.includes(token.slice(0, -1))) score += 1;
  }
  return score;
}

const searchStreakTimers = new WeakMap();

function triggerSearchStreak(input) {
  const shell = input?.closest?.(".docs-topic-search");
  if (!shell) return;
  shell.classList.remove("is-searching");
  void shell.offsetWidth;
  shell.classList.add("is-searching");
  window.clearTimeout(searchStreakTimers.get(shell));
  searchStreakTimers.set(shell, window.setTimeout(() => shell.classList.remove("is-searching"), 1000));
}

function guideSearchText(feature) {
  return [
    feature.id,
    feature.title,
    feature.summary,
    feature.ask,
    ...(feature.steps || []),
    ...(feature.keywords || []),
  ].filter(Boolean).join(" ");
}

function tipSearchText(tip) {
  return [
    tip.topic,
    tip.title,
    tip.body,
    tip.starter,
    ...(tip.steps || []),
  ].filter(Boolean).join(" ");
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
  const robotics = isRoboticsGuide(feature);
  const gifLeft = robotics || String(feature?.category || "") === "vr";
  return `
    <section class="gs-feature${gifLeft ? " gs-feature--gif-left" : ""}" id="${esc(feature.id)}" data-doc-text="${esc(guideSearchText(feature).toLowerCase())}">
      ${cmsCanEdit ? pencilHtml("gs-guide", feature.id) : ""}
      <div class="gs-feature-media">
        ${demoHtml(feature)}
        <p class="gs-demo-label">Live demo</p>
      </div>
      <div class="gs-feature-copy">
        <p class="gs-feature-index">${n}</p>
        <h3>${esc(feature.title)}</h3>
        <p class="gs-summary">${esc(feature.summary)}</p>
        <ol class="gs-steps">
          ${(feature.steps || []).map((step) => (
            robotics
              ? `<li data-lan-ip-slot="${esc(step)}">${esc(step)}</li>`
              : `<li>${esc(step)}</li>`
          )).join("")}
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
  if (key.includes("software")) return { cls: "software", label: "Mode", glyph: "CAD" };
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
  const ask = tip.starter || `Tell me more about this Render Studio tip: ${tip.title}`;
  const steps = Array.isArray(tip.steps) ? tip.steps : [];
  const visual = tipVisual(tip.topic);
  return `
    <article class="gs-tip-card gs-tip-card--${esc(visual.cls)}" data-doc-text="${esc(tipSearchText(tip).toLowerCase())}">
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
      credentials: "include",
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
      const detail = data?.detail;
      const detailText = typeof detail === "string"
        ? detail
        : (detail?.message || (Array.isArray(detail) ? detail.map((item) => item?.msg).filter(Boolean).join("; ") : ""));
      const fallback = res.status
        ? `Request failed (${res.status})`
        : "Cannot reach the server — is Studio running?";
      const err = new Error(detailText || data?.message || res.statusText || fallback);
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function visibleFeatures() {
  const hash = String(location.hash || "").replace(/^#/, "");
  if (hash === "robotics-configuration") {
    return FEATURES.filter((guide) => String(guide.category || "") === "robotics" || String(guide.id || "").startsWith("robotics-"));
  }
  if (hash === "vr-controls") {
    return FEATURES.filter((guide) => String(guide.category || "") === "vr" || String(guide.id || "").startsWith("vr-"));
  }
  return FEATURES.filter((guide) => guide.id !== "self-host" && String(guide.category || "") !== "vr");
}

function isRoboticsDocsTab() {
  return String(location.hash || "").replace(/^#/, "") === "robotics-configuration";
}

function isVrControlsDocsTab() {
  return String(location.hash || "").replace(/^#/, "") === "vr-controls";
}

function mountToc() {
  const host = document.getElementById("gs-toc");
  if (!host) return;
  const shown = visibleFeatures();
  if (isVrControlsDocsTab()) {
    host.innerHTML = `
      <p class="gs-toc-title">VR Controls</p>
      <a class="gs-toc-docs" href="/docs.html#complete-docs">Full Documentation</a>
      <div class="gs-toc-group"><p class="gs-toc-group-title">Headset</p>${shown.map((guide) => `<a href="#${esc(guide.id)}" data-gs-toc="${esc(guide.id)}">${esc(TOC_LABELS[guide.id] || guide.title)}</a>`).join("")}</div>
    `;
    return;
  }
  if (isRoboticsDocsTab()) {
    host.innerHTML = `
      <p class="gs-toc-title">Robotics</p>
      <a class="gs-toc-docs" href="/docs.html#cat-robotics">Full Documentation</a>
      <div class="gs-toc-group"><p class="gs-toc-group-title">How to connect</p>${shown.map((guide) => `<a href="#${esc(guide.id)}" data-gs-toc="${esc(guide.id)}">${esc(TOC_LABELS[guide.id] || guide.title)}</a>`).join("")}</div>
    `;
    return;
  }
  const guidesById = new Map(shown.map((guide) => [guide.id, guide]));
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
  const extraLinks = shown
    .filter((guide) => !seen.has(guide.id))
    .map((guide) => `<a href="#${esc(guide.id)}" data-gs-toc="${esc(guide.id)}">${esc(TOC_LABELS[guide.id] || guide.title)}</a>`)
    .join("");
  host.innerHTML = `
    <p class="gs-toc-title">On this page</p>
    <a class="gs-toc-docs" href="/docs.html#complete-docs">Full Documentation</a>
    ${sectionHtml}
    ${extraLinks ? `<div class="gs-toc-group"><p class="gs-toc-group-title">More</p>${extraLinks}</div>` : ""}
    <div class="gs-toc-group">
      <p class="gs-toc-group-title">Extras</p>
      <a href="#tips-library" data-gs-toc="tips-library">${esc(TOC_LABELS["tips-library"])}</a>
      <a href="/database.html">Database configuration</a>
    </div>
  `;
}

function mountFeatures() {
  const host = document.getElementById("gs-features");
  if (!host) return;
  const robotics = isRoboticsDocsTab();
  const vrTab = isVrControlsDocsTab();
  const intro = vrTab
    ? vrControlsDocsIntroHtml()
    : robotics
    ? `<header class="gs-robotics-head">
        <p class="gs-feature-index">Docs category</p>
        <h3>Robotics Configuration</h3>
        <p class="gs-summary">Viser is HTTP on the Pi. Teleop is HTTPS. Studio proxies both so https://render3d.app and Quest never hit mixed content or a self-signed cert. Account → Robotics and VR Settings stay in sync.</p>
        <div class="gs-robotics-ip">
          <label class="gs-robotics-ip-label" for="gs-robotics-lan-ip">Your Pi LAN IP</label>
          <div class="gs-robotics-ip-row">
            <input id="gs-robotics-lan-ip" class="gs-robotics-ip-input" type="text" spellcheck="false" autocomplete="off" placeholder="YOUR_LAN_IP" data-robotics-lan-ip />
            <button type="button" class="btn secondary gs-ip-help-btn" data-gs-ip-help>How do I get my IP?</button>
          </div>
          <p class="gs-robotics-ip-examples muted small">
            Teleop <code data-lan-ip-example="teleop">https://YOUR_LAN_IP:8443/teleop</code>
            · Viser <code data-lan-ip-example="viser">http://YOUR_LAN_IP:8095</code>
            · Studio proxies <code data-lan-ip-example="teleop-proxy">/api/teleop/p/YOUR_LAN_IP/8443/teleop</code>
            and <code data-lan-ip-example="viser-proxy">/api/viser/p/YOUR_LAN_IP/8095/</code>
          </p>
        </div>
      </header>`
    : "";
  host.innerHTML = intro + visibleFeatures().map((f, i) => featureCard(f, i)).join("");
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
  if (vrTab) bindVrControlsDocs(host);
  if (robotics) {
    applyRoboticsLanIp(docsLanIp);
    void hydrateRoboticsLanIp();
  }
}

function mountTips() {
  const host = document.getElementById("gs-tips-grid");
  if (!host) return;
  host.innerHTML = GETTING_STARTED_TIPS.map((tip, i) => tipCard(tip, i)).join("");
}

let revealObserver = null;
let tocSpyObserver = null;

function markVisible(el) {
  el?.classList.add("is-visible");
}

function mountReveal() {
  const nodes = [...document.querySelectorAll(".gs-feature, .gs-tips-section, .gs-closing, .gs-hero, .gs-create")];
  if (revealObserver) {
    revealObserver.disconnect();
    revealObserver = null;
  }
  if (!nodes.length) return;
  if (!("IntersectionObserver" in window)) {
    nodes.forEach(markVisible);
    return;
  }
  // Tall guide cards often never reach the old 12% threshold; any pixel in view is enough.
  revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting || entry.intersectionRatio > 0) {
          markVisible(entry.target);
          revealObserver?.unobserve(entry.target);
        }
      }
    },
    { threshold: 0, rootMargin: "80px 0px 40px 0px" }
  );
  const vh = window.innerHeight || 0;
  nodes.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < vh + 80) {
      markVisible(el);
      return;
    }
    revealObserver.observe(el);
  });
}

function mountTocSpy() {
  if (tocSpyObserver) {
    tocSpyObserver.disconnect();
    tocSpyObserver = null;
  }
  const links = [...document.querySelectorAll("[data-gs-toc]")];
  if (!links.length || !("IntersectionObserver" in window)) return;
  tocSpyObserver = new IntersectionObserver(
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
    if (el) tocSpyObserver.observe(el);
  });
  const tips = document.getElementById("tips-library");
  if (tips) tocSpyObserver.observe(tips);
  links[0]?.classList.add("is-active");
}

function mountTopicSearch() {
  const input = document.getElementById("gs-topic-search");
  const status = document.getElementById("gs-topic-search-status");
  if (!input) return;
  const apply = () => {
    const q = input.value.trim();
    const featureCards = [...document.querySelectorAll(".gs-feature")];
    const tipCards = [...document.querySelectorAll(".gs-tip-card")];
    featureCards.forEach((card) => {
      const text = card.getAttribute("data-doc-text") || card.textContent || "";
      card.classList.toggle("is-hidden", !!q && matchScore(text, q) <= 0);
    });
    tipCards.forEach((card) => {
      const text = card.getAttribute("data-doc-text") || card.textContent || "";
      card.classList.toggle("is-hidden", !!q && matchScore(text, q) <= 0);
    });
    document.getElementById("tips-library")?.classList.toggle(
      "is-hidden",
      !!q && !tipCards.some((card) => !card.classList.contains("is-hidden"))
    );
    const count = [...featureCards, ...tipCards].filter((card) => !card.classList.contains("is-hidden")).length;
    if (status) {
      status.textContent = q
        ? `${count} matching guide${count === 1 ? "" : "s"} and tip${count === 1 ? "" : "s"} found for "${q}".`
        : "Type what you are trying to do and matching guides/tips stay visible.";
    }
  };
  input.addEventListener("input", () => {
    triggerSearchStreak(input);
    apply();
  });
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

  const authUi = createAuthUI({
    api,
    onReady: (data) => {
      currentUser = data.user;
      agent?.setUser?.(data.user, { suppressOnboarding: true });
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
      agent?.setUser?.(data.user, { suppressOnboarding: true });
    }
    const pending = sessionStorage.getItem("render3d:gsPendingAsk");
    if (pending && data?.user) {
      sessionStorage.removeItem("render3d:gsPendingAsk");
      setTimeout(() => void agent?.openWithQuestion?.(pending, { autoSend: true }), 400);
    }
  });

  const tourQ = "Give me a tour of Render Studio for a new user";

  document.getElementById("gs-features")?.addEventListener("click", (e) => {
    const show = e.target.closest?.("[data-gs-show-me]");
    if (show) {
      startShowMe(show.getAttribute("data-gs-show-me") || "", { onDocsPage: true });
      return;
    }
    const ipHelp = e.target.closest?.("[data-gs-ip-help]");
    if (ipHelp) {
      showRenderAgent(agent, howToGetIpQuestion(), { autoSend: false });
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
mountTopicSearch();
mountReveal();
mountTocSpy();

function syncDocsCategoryTabs() {
  const hash = String(location.hash || "").replace(/^#/, "");
  document.querySelectorAll(".docs-category-tabs .docs-category-tab").forEach((tab) => {
    const href = tab.getAttribute("href") || "";
    const isTips = href.includes("tips-library");
    const isGettingStarted = href.endsWith("getting-started.html") || href === "/getting-started.html";
    let active = false;
    const isAiCtx = href.includes("#ai-context") || href.includes("#start-here");
    if (hash === "tips-library") active = isTips;
    else if (hash === "robotics-configuration") active = href.includes("robotics-configuration");
    else if (hash === "vr-controls") active = href.includes("vr-controls");
    else if (hash === "ai-context" || hash === "start-here" || hash.startsWith("ai-context") || hash.startsWith("start-here")) active = isAiCtx;
    else if (!hash) active = isGettingStarted && !isTips && !href.includes("robotics-configuration") && !href.includes("vr-controls") && !isAiCtx;
    else active = false;
    if (isGettingStarted && !isTips && !href.includes("robotics-configuration") && !href.includes("vr-controls") && !isAiCtx && hash && hash !== "tips-library" && hash !== "robotics-configuration" && hash !== "vr-controls" && hash !== "ai-context" && hash !== "start-here") {
      active = true;
    }
    if (isAiCtx) tab.hidden = !isSuperAdminUser(getStoredUser());
    tab.classList.toggle("active", active);
  });
  document.body.classList.toggle("gs-tab-robotics", hash === "robotics-configuration");
  document.body.classList.toggle("gs-tab-vr", hash === "vr-controls");
  const aiCtx = hash === "ai-context" || hash === "start-here" || hash.startsWith("ai-context") || hash.startsWith("start-here");
  document.body.classList.toggle("gs-tab-ai-context", aiCtx);
  const hideStream = hash === "robotics-configuration" || hash === "vr-controls" || aiCtx;
  document.getElementById("tips-library")?.classList.toggle("hidden", hideStream);
  document.querySelector(".gs-closing")?.classList.toggle("hidden", hideStream);
  document.querySelectorAll(".toolbar-nav-menu .nav-tab").forEach((tab) => {
    const href = tab.getAttribute("href") || "";
    const isTips = href.includes("tips-library");
    const isDocs = href.includes("getting-started.html") || href.endsWith("/docs.html") || href === "/docs.html";
    if (isTips) tab.classList.toggle("active", hash === "tips-library");
    if (isDocs) tab.classList.toggle("active", hash !== "tips-library");
  });
}
function isAiContextDocsTab() {
  const hash = String(location.hash || "").replace(/^#/, "");
  return hash === "ai-context" || hash === "start-here" || hash.startsWith("ai-context") || hash.startsWith("start-here");
}

async function mountAiContextDocsTab() {
  const host = document.getElementById("ai-context-docs");
  if (!host) return;
  const show = isAiContextDocsTab();
  host.hidden = !show;
  if (!show) return;
  const { mountAiContextDocs } = await import("./ai-context-docs.js?v=ctxlink1");
  await mountAiContextDocs(host, {
    startPath: "ai-context/START-HERE.md",
    api: (path, options) => api(path, options),
  });
}

syncDocsCategoryTabs();
void mountAiContextDocsTab();
window.addEventListener("hashchange", () => {
  syncDocsCategoryTabs();
  mountFeatures();
  mountToc();
  mountReveal();
  mountTocSpy();
  void mountAiContextDocsTab();
});

function applyGsCms() {
  FEATURES = [...applyOverrides(GETTING_STARTED_GUIDES, cmsPages?.docs?.guides), ...VR_CONTROLS_GUIDES];
  const hero = cmsPages.docs?.getting_started || {};
  setHeroText(document.querySelector("[data-cms-root='gs-hero']"), hero);
  const photo = document.getElementById("gs-hero-photo");
  const visual = document.querySelector(".gs-hero-visual");
  setBannerImage(photo, hero.banner || "", hero.title || "");
  if (visual) visual.hidden = Boolean(hero.banner);
  document.querySelectorAll("[data-cms-root='gs-hero'] > .site-cms-pencil").forEach((el) => el.remove());
  if (cmsCanEdit) {
    document.body.classList.add("is-site-cms");
    document.querySelector("[data-cms-root='gs-hero']")?.insertAdjacentHTML("afterbegin", pencilHtml("gs-hero"));
  }
  mountFeatures();
  mountToc();
  // CMS remount replaces .gs-feature nodes; re-bind reveal/spy or they stay opacity:0.
  mountReveal();
  mountTocSpy();
}

async function persistGs(patch) {
  cmsPages = await saveSitePages(patch);
  applyGsCms();
}

document.addEventListener("click", (event) => {
  const btn = event.target.closest?.(".site-cms-pencil");
  if (!btn) return;
  const kind = btn.getAttribute("data-cms-kind");
  const id = btn.getAttribute("data-cms-id") || "";
  if (kind === "gs-hero") {
    const hero = cmsPages.docs?.getting_started || {};
    openCmsEditor({
      title: "Edit Getting Started",
      html: heroFields(hero),
      onSubmit: async (_values, form) => {
        await persistGs({ docs: { getting_started: await heroFromForm(form, hero) } });
      },
    });
  }
  if (kind === "gs-guide") {
    const item = FEATURES.find((row) => row.id === id) || {};
    openCmsEditor({
      title: "Edit guide",
      html: templateFields(item),
      onSubmit: async (_values, form) => {
        const next = await templateFromForm(form);
        await persistGs({ docs: { guides: { [id]: next } } });
      },
    });
  }
});

void loadSitePages().then(({ pages, canEdit }) => {
  cmsPages = pages || {};
  cmsCanEdit = canEdit;
  applyGsCms();
}).catch((err) => {
  console.warn("[docs] CMS unavailable", err);
});

mountAgent();
