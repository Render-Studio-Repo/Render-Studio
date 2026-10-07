/** Recent Updates page — milestone features & tools. */

import { listMilestones } from "../docs/updates/milestones.js?v=20261006-2234";
import { enhanceDocsGifs } from "./docs-gif-expand.js?v=20260715-gif-expand";
import {
  bannerFields,
  collectBanners,
  esc,
  heroFields,
  heroFromForm,
  loadSitePages,
  mergeMilestonePosts,
  mergeShippedRegistry,
  openCmsEditor,
  pencilHtml,
  postFields,
  postFromForm,
  saveSitePages,
  setHeroText,
  upsertPost,
} from "../admin/site-pages-cms.js?v=20260916-gifs40-docgif1";

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
let cmsPages = {};
let cmsCanEdit = false;
let shippedItems = [];

const SHIPPED_URL = "/docs/updates/shipped.json?v=20261006-2234";

function builtinMilestones() {
  return mergeShippedRegistry(listMilestones(), shippedItems);
}

async function loadShippedRegistry() {
  try {
    const res = await fetch(SHIPPED_URL, { cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json();
    const rows = Array.isArray(data) ? data : data?.items || [];
    return rows.filter((row) => row && row.id);
  } catch (err) {
    console.warn("[updates] shipped.json unavailable", err);
    return [];
  }
}

const RELATED_TERMS = {
  bambu: ["3mf", "printer", "print", "plate", "studio", "export"],
  fusion: ["autodesk", "cloud", "step", "sync", "export", "import"],
  onshape: ["cloud", "step", "sync", "export", "import"],
  rigging: ["urdf", "srdf", "motion", "robot", "joints"],
  share: ["remix", "public", "link", "collaboration", "copy"],
  delete: ["right click", "context menu", "remove", "object"],
  prompt: ["ai", "generate", "refs", "components", "agent", "persist", "draft"],
  transparent: ["opacity", "see through", "viewport", "object"],
  freecad: ["extrude", "move", "delete", "kernel", "step", "pad", "pocket"],
  imagine: ["image", "fetch", "grid", "list", "panel"],
  mcmaster: ["catalog", "parts", "hardware", "insert"],
  catalog: ["mcmaster", "parts", "step", "insert"],
  clip: ["video", "editor", "timeline", "record"],
  finder: ["cmd", "ctrl", "search", "spotlight"],
  pin: ["star", "pinned", "projects"],
  viser: ["lan", "robotics", "cloud", "proxy"],
  camera: ["wrist", "usb", "arducam", "hand-cam"],
  dimos: ["robot", "teleop", "quest", "vr", "gated"],
  capture: ["reference", "folder", "screenshot", "recording"],
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
      ${cmsCanEdit ? pencilHtml("updates-post", item.id) : ""}
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
  const rows = mergeMilestonePosts(builtinMilestones(), cmsPages?.updates?.posts)
    .filter((item) => activeKind === "all" || item.kind === activeKind)
    .map((item) => ({ item, score: matchScore(item, query) }))
    .filter((row) => !query || row.score > 0)
    .sort((a, b) => (query ? b.score - a.score : String(b.item.date || "").localeCompare(String(a.item.date || ""))))
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

function bodyHtml(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${esc(para)}</p>`)
    .join("");
}

function renderBanners(banners) {
  const host = document.getElementById("updates-banners");
  if (!host) return;
  const rows = Array.isArray(banners) ? banners : [];
  host.hidden = rows.length === 0;
  host.classList.toggle("updates-social-images--multi", rows.length > 1);
  host.innerHTML = rows.map((item, index) => `
    <figure class="updates-banner${index === 0 || rows.length === 1 ? " updates-banner--hero" : ""}">
      <img src="${esc(item.src)}" alt="${esc(item.alt || item.title || "")}" loading="lazy" />
      ${item.title ? `<figcaption>${esc(item.title)}</figcaption>` : ""}
    </figure>
  `).join("");
}

function applyUpdatesPage() {
  const updates = cmsPages.updates || {};
  setHeroText(document.querySelector("[data-cms-root='updates-hero']"), updates.hero);
  const founder = document.querySelector("[data-cms-root='updates-founder']");
  if (founder && updates.founder) {
    setHeroText(founder, updates.founder);
    const body = founder.querySelector("[data-cms-body]");
    if (body && updates.founder.body) body.innerHTML = bodyHtml(updates.founder.body);
  }
  renderBanners(updates.banners);
  if (cmsCanEdit) {
    document.body.classList.add("is-site-cms");
    document.querySelectorAll("[data-cms-root='updates-hero'] > .site-cms-pencil, [data-cms-root='updates-founder'] > .site-cms-pencil").forEach((el) => el.remove());
    document.querySelector("[data-cms-root='updates-hero']")?.insertAdjacentHTML("afterbegin", pencilHtml("updates-hero"));
    document.querySelector("[data-cms-root='updates-founder']")?.insertAdjacentHTML("afterbegin", pencilHtml("updates-founder"));
  }
  mountList();
}

async function persist(patch) {
  cmsPages = await saveSitePages(patch);
  applyUpdatesPage();
}

function editHero() {
  const hero = cmsPages.updates?.hero || {};
  openCmsEditor({
    title: "Edit Recent Updates",
    html: heroFields(hero, { banner: false }),
    onSubmit: async (_values, form) => {
      await persist({ updates: { hero: await heroFromForm(form, hero) } });
    },
  });
}

function editFounder() {
  const founder = cmsPages.updates?.founder || {};
  const banners = cmsPages.updates?.banners || [];
  openCmsEditor({
    title: "Edit post & banners",
    html: `${heroFields({ kicker: founder.kicker, title: founder.title, lead: founder.body }, { banner: false })}
      ${bannerFields(banners)}`,
    onSubmit: async (_values, form) => {
      const next = await heroFromForm(form, founder);
      await persist({
        updates: {
          founder: { kicker: next.kicker, title: next.title, body: next.lead },
          banners: await collectBanners(form),
        },
      });
    },
  });
}

function editPost(id) {
  const current = mergeMilestonePosts(builtinMilestones(), cmsPages.updates?.posts).find((item) => item.id === id)
    || { id: id || `cms-${Date.now()}`, published: true, date: new Date().toISOString().slice(0, 10) };
  openCmsEditor({
    title: id && builtinMilestones().some((item) => item.id === id) || cmsPages.updates?.posts?.some((item) => item.id === id)
      ? "Edit update"
      : "Add update",
    html: postFields(current),
    onSubmit: async (_values, form) => {
      const next = await postFromForm(form, current);
      await persist({ updates: { posts: upsertPost(cmsPages.updates?.posts, next) } });
    },
  });
}

document.addEventListener("click", (event) => {
  const btn = event.target.closest?.(".site-cms-pencil");
  if (!btn) return;
  const kind = btn.getAttribute("data-cms-kind");
  if (kind === "updates-hero") editHero();
  if (kind === "updates-founder") editFounder();
  if (kind === "updates-post") editPost(btn.getAttribute("data-cms-id") || "");
});

const X_FEED_URL = "/api/updates/x-feed?v=xfeed3";
const X_FEED_PAGE = 40;
const X_FEED_MAX = 200;
let xFeedTimer = 0;
let xFeedOffset = 0;
let xFeedTotal = 0;
let xFeedHasMore = false;
let xFeedLoading = false;
let xFeedSeen = new Set();

function formatTweetTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const diff = Date.now() - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function tweetCardHtml(tweet) {
  const author = tweet.author || {};
  const username = String(author.username || "").replace(/^@/, "");
  const name = author.name || username;
  const avatar = author.avatar
    ? `<img class="updates-x-avatar" src="${esc(author.avatar)}" alt="" width="32" height="32" />`
    : `<span class="updates-x-avatar" aria-hidden="true"></span>`;
  const media = Array.isArray(tweet.media) ? tweet.media[0] : null;
  const mediaHtml = media?.src
    ? `<img class="updates-x-media" src="${esc(media.src)}" alt="${esc(media.alt || "")}" loading="lazy" />`
    : "";
  return `
    <a class="updates-x-card" href="${esc(tweet.url || `https://x.com/${username}`)}" target="_blank" rel="noopener noreferrer">
      <div class="updates-x-card-meta">
        ${avatar}
        <div>
          <strong>${esc(name)}</strong>
          <span>@${esc(username)} · ${esc(formatTweetTime(tweet.created_at))}</span>
        </div>
      </div>
      <p>${esc(tweet.text || "")}</p>
      ${mediaHtml}
    </a>
  `;
}

function xFeedMoreHtml() {
  if (!xFeedHasMore || xFeedOffset >= X_FEED_MAX) return "";
  return `<p class="updates-x-status updates-x-more muted">Loading more posts…</p>`;
}

function renderXFeed(data, { append = false } = {}) {
  const host = document.getElementById("updates-x-list");
  if (!host) return;
  const tweets = Array.isArray(data?.tweets) ? data.tweets : [];
  xFeedTotal = Number(data?.total || 0);
  xFeedHasMore = Boolean(data?.has_more) && xFeedOffset < X_FEED_MAX;
  if (!append) {
    xFeedSeen = new Set();
    host.innerHTML = "";
  }
  const fresh = tweets.filter((tweet) => {
    const id = String(tweet?.id || "");
    if (!id || xFeedSeen.has(id)) return false;
    xFeedSeen.add(id);
    return true;
  });
  if (fresh.length) {
    host.querySelector(".updates-x-more")?.remove();
    host.insertAdjacentHTML("beforeend", `${fresh.map(tweetCardHtml).join("")}${xFeedMoreHtml()}`);
    if (data.stale && !host.querySelector("[data-x-stale]")) {
      host.insertAdjacentHTML("afterbegin", `<p class="updates-x-status muted" data-x-stale>Showing last cached posts (X is rate-limited or unreachable).</p>`);
    }
    return;
  }
  if (append) {
    host.querySelector(".updates-x-more")?.remove();
    return;
  }
  const reason = data?.reason || "empty";
  const profiles = (data?.handles || ["A1_Projects", "winstead_works"])
    .map((handle) => `<a href="https://x.com/${esc(handle)}" target="_blank" rel="noopener noreferrer">@${esc(handle)}</a>`)
    .join(" · ");
  const copy = {
    not_configured: "X feed is not connected on the server yet.",
    rate_limited: "X rate-limited this request. Try again in a few minutes.",
    fetch_failed: "Could not load posts from X right now.",
    empty: "No recent posts yet.",
  }[reason] || "Could not load posts from X right now.";
  host.innerHTML = `<p class="updates-x-status muted">${esc(copy)} Follow ${profiles}</p>`;
}

function syncXFeedOpen() {
  const panel = document.querySelector(".updates-x-panel");
  if (!panel) return;
  panel.open = window.matchMedia("(min-width: 981px)").matches;
}

async function loadXFeed({ reset = false } = {}) {
  const host = document.getElementById("updates-x-list");
  if (!host || xFeedLoading) return;
  if (reset) {
    xFeedOffset = 0;
    xFeedHasMore = true;
    xFeedSeen = new Set();
  }
  if (!reset && !xFeedHasMore) return;
  xFeedLoading = true;
  try {
    const url = `${X_FEED_URL}&offset=${xFeedOffset}&limit=${X_FEED_PAGE}`;
    const res = await fetch(url, { cache: "no-store" });
    const data = res.ok ? await res.json() : { ok: false, reason: "fetch_failed", tweets: [] };
    const got = Array.isArray(data.tweets) ? data.tweets.length : 0;
    xFeedOffset += got;
    renderXFeed(data, { append: !reset && xFeedSeen.size > 0 });
    if (reset && xFeedHasMore) {
      requestAnimationFrame(() => {
        const scroller = document.querySelector(".updates-x-scroll");
        if (scroller && scroller.scrollHeight <= scroller.clientHeight + 24) {
          void loadXFeed();
        }
      });
    }
  } catch (err) {
    console.warn("[updates] x-feed unavailable", err);
    if (!xFeedSeen.size) renderXFeed({ ok: false, reason: "fetch_failed", tweets: [] });
  } finally {
    xFeedLoading = false;
  }
}

function onXFeedScroll(event) {
  const scroller = event.currentTarget;
  if (!scroller || xFeedLoading || !xFeedHasMore) return;
  if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 80) {
    void loadXFeed();
  }
}

function mountXFeed() {
  const host = document.getElementById("updates-x-list");
  if (!host) return;
  syncXFeedOpen();
  window.addEventListener("resize", syncXFeedOpen);
  host.addEventListener("scroll", onXFeedScroll, { passive: true });
  void loadXFeed({ reset: true });
  window.clearInterval(xFeedTimer);
  xFeedTimer = window.setInterval(() => loadXFeed({ reset: true }), 3 * 60 * 1000);
}

mountFilters();
mountSearch();
mountList();
mountXFeed();

void Promise.all([loadSitePages(), loadShippedRegistry()]).then(([{ pages, canEdit }, shipped]) => {
  shippedItems = shipped;
  cmsPages = pages || {};
  cmsCanEdit = canEdit;
  applyUpdatesPage();
}).catch((err) => {
  console.warn("[updates] CMS / shipped registry unavailable", err);
});
// Auth + Render Agent FAB are mounted by docs-agent.js on this page.
