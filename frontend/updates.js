/** Recent Updates page — milestone features & tools. */

import { listMilestones } from "./docs/updates/milestones.js?v=20260715-updates";
import { authHeaders, createAuthUI } from "./auth.js?v=20260709-admin-matt";

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

function cardHtml(item) {
  const visual = item.visual
    ? `<div class="updates-visual">
         <img src="${esc(item.visual)}" alt="" loading="lazy" />
       </div>`
    : `<div class="updates-visual updates-visual--empty" aria-hidden="true"></div>`;
  const link = item.href
    ? `<a class="updates-more" href="${esc(item.href)}">See how it works</a>`
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

function mountList(kind = "all") {
  const host = document.getElementById("updates-list");
  if (!host) return;
  const rows = listMilestones().filter((item) => kind === "all" || item.kind === kind);
  if (!rows.length) {
    host.innerHTML = `<p class="updates-empty muted">No updates in this filter yet.</p>`;
    return;
  }
  host.innerHTML = rows.map(cardHtml).join("");
  host.querySelectorAll(".updates-visual img").forEach((img) => {
    img.addEventListener("error", () => {
      img.closest(".updates-visual")?.classList.add("updates-visual--empty");
      img.remove();
    });
  });
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
    mountList(btn.getAttribute("data-kind") || "all");
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
mountList("all");
createAuthUI({ api });
