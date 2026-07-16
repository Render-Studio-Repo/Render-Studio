/** Recent Updates page — milestone features & tools. */

import { listMilestones } from "./docs/updates/milestones.js?v=20260716-no-tips-tricks";
import { authHeaders, createAuthUI } from "./auth.js?v=20260715-auth-connect-social";
import { enhanceDocsGifs } from "./docs-gif-expand.js?v=20260715-gif-expand";

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function kindLabel(kind) {
  if (kind === "tool") return "New tool";
  return "New feature";
}

let activeKind = "all";
let activeQuery = "";

const RELATED_TERMS = {
  bambu: ["3mf", "printer", "print", "plate", "studio", "export"],
  fusion: ["autodesk", "cloud", "step", "sync", "export", "import"],
  onshape: ["cloud", "step", "sync", "export", "import"],
  rigging: ["urdf", "srdf", "motion", "robot", "joints"],
  share: ["remix", "public", "link", "collaboration", "copy"],
  delete: ["right click", "context menu", "remove", "object"],
  prompt: ["ai", "generate", "refs", "components", "agent"],
  transparent: ["opacity", "see through", "viewport", "object"],
};

function searchableText(item) {
  return [
    item.id,
    item.kind,
    kindLabel(item.kind),
    item.title,
    item.summary,
    item.href,
    ...(item.keywords || []),
  ].filter(Boolean).join(" ").toLowerCase();
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

function matchScore(item, query) {
  const tokens = queryTokens(query);
  if (!tokens.length) return 1;
  const text = searchableText(item);
  let score = 0;
  for (const token of tokens) {
    if (text.includes(token)) score += 2;
    else if (token.length > 3 && text.includes(token.slice(0, -1))) score += 1;
  }
  return score;
}

function realHowToHref(item) {
  const href = String(item?.href || "").trim();
  if (!href || href === "/" || href === "/#" || href === "#") return "";
  return href;
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

function cardHtml(item) {
  const visual = item.visual
    ? `<div class="updates-visual">
         <img src="${esc(item.visual)}" alt="" loading="lazy" />
       </div>`
    : `<div class="updates-visual updates-visual--empty" aria-hidden="true"></div>`;
  const href = realHowToHref(item);
  const link = href
    ? `<a class="updates-more" href="${esc(href)}">See how it works</a>`
    : "";
  return `
    <article class="updates-card" id="${esc(item.id)}" data-kind="${esc(item.kind || "feature")}">
      ${visual}
      <div class="updates-copy">
        <div class="updates-meta">
          <span class="updates-kind">${esc(kindLabel(item.kind))}</span>
          <time datetime="${esc(item.date)}">${esc(formatDate(item.date))}</time>
        </div>
        <h3>${esc(item.title)}</h3>
        <p>${esc(item.summary)}</p>
        ${link}
      </div>
    </article>
  `;
}

function mountList() {
  const host = document.getElementById("updates-list");
  if (!host) return;
  const query = activeQuery.trim();
  const rows = listMilestones()
    .filter((item) => activeKind === "all" || item.kind === activeKind)
    .map((item) => ({ item, score: matchScore(item, query) }))
    .filter((row) => !query || row.score > 0)
    .sort((a, b) => (query ? b.score - a.score : 0))
    .map((row) => row.item);
  const status = document.getElementById("updates-search-status");
  if (status) {
    status.textContent = query
      ? `${rows.length} similar update${rows.length === 1 ? "" : "s"} found for "${query}".`
      : "Search by what you want to do; similar updates will rise to the top.";
  }
  if (!rows.length) {
    host.innerHTML = `<p class="updates-empty muted">No updates match that topic yet. Try Bambu, Fusion, rigging, share, prompt, or right-click.</p>`;
    return;
  }
  host.innerHTML = rows.map(cardHtml).join("");
  host.querySelectorAll(".updates-visual img").forEach((img) => {
    img.addEventListener("error", () => {
      img.closest(".updates-visual")?.classList.add("updates-visual--empty");
      img.remove();
    });
  });
  enhanceDocsGifs(host);
}

function mountFilters() {
  const bar = document.querySelector(".updates-filters");
  if (!bar) return;
  bar.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-kind]");
    if (!btn) return;
    bar.querySelectorAll(".updates-filter").forEach((el) => {
      const on = el === btn;
      el.classList.toggle("is-active", on);
      el.setAttribute("aria-selected", on ? "true" : "false");
    });
    activeKind = btn.getAttribute("data-kind") || "all";
    mountList();
  });
}

function mountSearch() {
  const input = document.getElementById("updates-search");
  if (!input) return;
  input.addEventListener("input", () => {
    triggerSearchStreak(input);
    activeQuery = input.value || "";
    mountList();
  });
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

mountFilters();
mountSearch();
mountList();
// Auth + Render Agent FAB are mounted by docs-agent.js on this page.
