import { authHeaders } from "./auth.js";
import { mountModelFollowups } from "./model-followups.js?v=1";
import { supplierSearchUrl } from "../components/catalog-panel.js?v=vendorcompare1";

export const EDIT_EXAMPLES = [
  ["Fit the electronics", "Rearrange the selected internal mounting trays so the linked controller and motor driver fit with connector access. Preserve the enclosure exterior, battery bay, and existing joints. Use datasheet clearances; ask for any missing dimensions."],
  ["Make room for a sensor", "Add space for the linked sensor inside the selected case. Move nearby mounts only as needed, keep the sensor field of view clear, and preserve the outside dimensions. Show the affected faces and cable exit before editing."],
  ["Replace the controller", "Replace the Arduino mount with a mount for the linked Raspberry Pi. Use its verified hole pattern and board dimensions, update the selected mounting face and hole vertices, and keep connector clearance. Preserve unrelated fasteners and walls."],
  ["Shorten one feature", "Shorten the selected face by 5 mm along its normal. Preserve adjacent mounting holes, wall thickness and all unselected models. Confirm the selected face and direction before modifying it."],
  ["Route wiring", "Reroute the wiring between the linked controller, driver and motors. Add cable clips on the selected interior faces, leave service loops and connector access, and separate motor power wiring from signal wiring. Use confirmed wire sizes and bend radii."],
  ["Move a bracket", "Move the selected bracket 15 mm to the right along the model X axis while preserving its shape and mounting orientation. Update its fixed joint and connected mounting holes; leave other parts in place."],
];

export function inferEditIntents(text) {
  const rules = [["move", /\b(move|shift|translate)\b/i], ["rearrange", /\b(rearrange|fit|layout|make room|reorganize)\b/i],
    ["reroute wiring", /\b(wir(e|es|ing)|cables?|reroute)\b/i], ["micro edit", /\b(shorten|lengthen|face|edge|vertex|trim|small)\b/i],
    ["replace part", /\b(replace|swap|raspberry|arduino)\b/i]];
  return rules.filter(([, rule]) => rule.test(text || "")).map(([label]) => label);
}

export function filterParts(parts, tab, query, sort) {
  const q = String(query || "").toLowerCase();
  return [...parts].filter(p => (tab === "home" || p.category === tab)
    && [p.name, p.part_number, p.description, JSON.stringify(p.specs)].join(" ").toLowerCase().includes(q))
    .sort((a, b) => sort === "quantity" ? b.qty - a.qty : String(a[sort] || a.name).localeCompare(String(b[sort] || b.name)));
}

export const MOBILE_BASE_QUESTIONS = [
  { id: "base-battery", question: "What is the exact 24 V 50 Ah LiFePO₄ battery model or its case dimensions and terminal positions?", answer: "LiFePO₄; 24 V, 50 Ah, Group 24, 50 A BMS, 1280 Wh, low-temperature cutoff. Exact model/dimensions pending.", reason: "Battery tray, restraint and cable clearance depend on the physical case." },
  { id: "base-pdf", question: "Which reference PDF and target footprint/height should this mobile base match?", reason: "Attach the PDF through Reference Files so the dimensions can be verified." },
  { id: "base-payload", question: "What payload and total loaded mass should the base carry?", reason: "Required for frame, axle, bearing and motor sizing." },
  { id: "base-terrain", question: "Will it run indoors or outdoors, and what slopes and obstacles must it handle?", reason: "Determines wheel size, traction, clearance and weather protection." },
  { id: "base-speed", question: "What top speed, runtime and control method do you want?", reason: "Determines gearing, motor drivers, electronics and power budget." },
];

const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const url = value => /^https:\/\//i.test(String(value || "")) ? String(value) : "";
export function imageUrl(value) {
  const text = String(value || "").trim();
  if (/mcmaster-carr(?:-masthead)?\.(?:svg|png)|\/favicon|google\.com\/s2\/favicons/i.test(text)) return "";
  if (/^https:\/\//i.test(text)) return text;
  if (/^\/(?!\/)/.test(text)) return text;
  return "";
}
export function mcmasterPartNumber(part = {}) {
  const direct = String(part.part_number || "").trim().toUpperCase();
  if (/^[0-9]{3,6}[A-Z][0-9A-Z]{1,8}$/.test(direct)) return direct;
  const href = url(part.url);
  try {
    const host = new URL(href).hostname.replace(/^www\./, "").toLowerCase();
    if (host === "mcmaster.com" || host.endsWith(".mcmaster.com")) {
      const seg = new URL(href).pathname.split("/").filter(Boolean)[0] || "";
      if (/^[0-9A-Za-z]{5,12}$/.test(seg) && /\d/.test(seg) && /[A-Za-z]/.test(seg)) return seg.toUpperCase();
    }
  } catch { /* ignore */ }
  return "";
}
export function partImageUrl(part = {}) {
  const direct = imageUrl(part.thumbnail_url) || imageUrl(part.png_url) || imageUrl(part.image);
  if (direct) return direct;
  const href = url(part.url);
  const adafruit = href.match(/adafruit\.com\/product\/(\d+)/i);
  if (adafruit) return `https://cdn-shop.adafruit.com/640x480/${adafruit[1]}-00.jpg`;
  return "";
}
/** amazon1: Amazon search in the user's own browser tab (cookies stay in Chrome). */
export function amazonSearchUrl(query = "") {
  const q = String(query || "").trim();
  return q ? `https://www.amazon.com/s?k=${encodeURIComponent(q)}` : "";
}
export function partShopQuery(part = {}) {
  return [part.name, part.part_number, part.kind, part.category === "electronics" ? "module" : ""]
    .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}
export function vendorPartQuery(part = {}) {
  const specs = Object.entries(part.specs || {}).filter(([, value]) => ["string", "number"].includes(typeof value)).slice(0, 6)
    .map(([key, value]) => `${key} ${value}`);
  return [part.name, part.part_number, ...specs].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 240);
}
export function partDescription(part = {}) {
  const specs = Object.entries(part.specs || {}).slice(0, 8)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).filter((row) => !/: $/.test(row));
  const bits = [part.description, part.compatibility, part.reason, specs.join("; ")].map((s) => String(s || "").trim()).filter(Boolean);
  if (bits.length) return bits.join(" — ");
  const label = part.name || part.kind || "Electronic part";
  return `${label}${part.part_number ? ` (${part.part_number})` : ""} is listed without a product URL. Search Amazon for a matching module and confirm pinout, voltage, and size against this project.`;
}
export function electronicsFitPrompt(part = {}) {
  const shop = amazonSearchUrl(partShopQuery(part));
  return [
    "Will this electronic work with the user's current project setup (power, controller, drivers, mounts, and wiring)?",
    `Part: ${part.name || "Unnamed"}`,
    part.part_number ? `Part number: ${part.part_number}` : "",
    `Description: ${partDescription(part)}`,
    shop ? `Amazon search: ${shop}` : "",
    "Answer the first line with exactly WILL WORK or WON'T WORK.",
    "If it will not work, suggest a better Amazon search query and 2–4 https://www.amazon.com/ search or product links (shopping-style suggestions). Do not invent non-Amazon checkout URLs.",
  ].filter(Boolean).join("\n");
}
// ragicon1: same Docs Render Agent fab (logo + Ask Agent), collapsed on Parts/BOM.
const RENDER_AGENT_LOGO = "/media/images/render-animations/VR-Animations/render-logo-gear-still.png?v=20260915-logo1";

function ensurePartsAgentFab(content, openRenderAgent) {
  const host = content?.closest?.(".parts-list-viewer, .assist-dialog, .catalog-parts-list") || content?.parentElement;
  if (!host) return;
  let fab = host.querySelector(":scope > .render-agent-fab--parts");
  if (!fab) {
    fab = document.createElement("button");
    fab.type = "button";
    fab.className = "render-agent-fab render-agent-fab--parts";
    fab.title = "Ask Render Agent";
    fab.setAttribute("aria-label", "Ask Render Agent");
    fab.setAttribute("aria-pressed", "false");
    fab.innerHTML = `<img src="${RENDER_AGENT_LOGO}" alt="" /><span>Ask Agent</span>`;
    host.append(fab);
  }
  fab.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (typeof openRenderAgent === "function") {
      openRenderAgent({ fromLauncher: true, partsList: true, force: true });
      return;
    }
    document.getElementById("btn-render-agent")?.click();
  };
}
let partsListAbort = null; // leakfix84
function beginPartsListFetch() {
  if (partsListAbort) {
    try { partsListAbort.abort(); } catch (_) { /* ignore */ }
  }
  const ctl = new AbortController();
  partsListAbort = ctl;
  return ctl;
}

async function api(path, body, method, extra) {
  const res = await fetch(`/api/design-assist${path}`, {
    method: method || (body ? "POST" : "GET"),
    headers: { ...authHeaders(), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: extra?.signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : `Request failed (${res.status})`);
  return data;
}
function dialog(title) {
  const node = document.createElement("dialog");
  node.className = "assist-dialog";
  node.innerHTML = `<header><h2>${esc(title)}</h2><button type="button" data-close aria-label="Close">×</button></header><div class="assist-content"></div>`;
  document.body.append(node);
  node.querySelector("[data-close]").onclick = () => node.close();
  node.addEventListener("close", () => node.remove(), { once: true });
  node.showModal();
  return { node, content: node.querySelector(".assist-content") };
}
function partCard(p) {
  const image = partImageUrl(p);
  const thumb = `<div class="assist-part-thumb${image ? "" : " assist-part-thumb--empty"}" data-thumb-state="${image ? "ready" : "missing"}">${image ? `<img src="${esc(image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="const b=this.closest('.assist-part-thumb');this.remove();if(b){b.classList.add('assist-part-thumb--empty');b.dataset.thumbState='missing'}">` : ""}<span class="assist-part-thumb-fallback" aria-hidden="true"></span></div>`;
  const linked = url(p.url);
  const desc = partDescription(p);
  const shop = amazonSearchUrl(partShopQuery(p));
  const noLink = !linked ? `<div class="assist-nolink-block" data-amazon-part="${esc(p.id)}">
      <span class="assist-nolink">No link</span>
      <p class="assist-part-blurb">${esc(desc)}</p>
      <div class="assist-shop-actions">
        <button type="button" class="assist-amazon-search" data-amazon-open="${esc(shop)}">Search on Amazon</button>
        <button type="button" class="assist-amazon-copy" data-amazon-copy="${esc(shop)}">Copy Amazon link</button>
        <button type="button" class="assist-amazon-fit" data-amazon-fit="${esc(p.id)}">Will this work?</button>
      </div>
    </div>` : "";
  const otherStores = p.category === "mcmaster" || mcmasterPartNumber(p) ? `<div class="assist-vendor-search"><label>Buy somewhere else
      <select data-part-vendor="${esc(p.id)}" aria-label="Choose a store for ${esc(p.name)}"><option value="amazon">Amazon</option><option value="walmart">Walmart</option><option value="newegg">Newegg</option><option value="digikey">DigiKey</option><option value="mouser">Mouser</option><option value="adafruit">Adafruit</option></select></label>
      <button type="button" data-vendor-open="${esc(p.id)}">Search exact part ↗</button><small>Check specifications and price before buying.</small></div>` : "";
  return `<article class="assist-part">${thumb}
    <h3>${esc(p.name)}</h3><p>${esc(p.part_number)} · Qty ${Number(p.qty) || 1} · ${esc(p.category || "electronics")}</p>${p.provenance?.status === "draft" ? '<small class="assist-draft">Draft from unfinished generation — verify before purchasing</small>' : ""}<p>${esc(linked ? (p.description || p.compatibility) : "")}</p>
    <dl>${Object.entries(p.specs || {}).map(([k,v]) => `<dt>${esc(k)}</dt><dd>${esc(typeof v === "object" ? JSON.stringify(v) : v)}</dd>`).join("")}</dl>
    ${linked ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${p.provenance?.status === 'draft' ? 'Reference source' : 'Product / source'} ↗</a>` : noLink}${otherStores}
    ${(p.docs || []).filter(d => url(d.url)).map(d => `<a href="${esc(d.url)}" target="_blank" rel="noopener noreferrer">${esc(d.label || "Datasheet")} ↗</a>`).join(" ")}</article>`;
}

export function mountDesignAssistance({ getProjectId, getContext, getPrompt, setPrompt, sendEdit, getSelectedModel, attachReference, openPartsSurface, onPartsChanged, bindPartTarget, openRenderAgent }) {
  if (document.documentElement.dataset.designAssistanceMounted) return;
  document.documentElement.dataset.designAssistanceMounted = "true";
  const modelQuestions = mountModelFollowups({getProjectId,getContext,getPrompt,getSelectedModel,attachReference});
  const sheet = document.createElement("link"); sheet.rel = "stylesheet"; sheet.href = "/studio/design-assistance.css?v=20260915-parts4-debugui3-dbgrow1-aigear1-ragicon1&catlists=20260916-1&partthumb=20260916-1&mcmthumb1&mcmtab1&amazon1&vendorcompare1"; document.head.append(sheet);
  document.addEventListener("render:open-parts", e => openParts(e.detail?.tab || "home", e.detail?.host || null));

  async function openParts(initialTab, host = null) {
    const pid = getProjectId();
    const { node, content } = host
      ? { node: { close() { host.dispatchEvent(new CustomEvent("catalog-parts-close", { bubbles: true })); } }, content: host }
      : (openPartsSurface?.() || dialog("Parts List"));
    ensurePartsAgentFab(content, openRenderAgent);
    if (!pid) { content.textContent = "Open or create a project first."; return; }
    let data, tab = initialTab, query = "", sort = "name", view = "list";
    const checked = new Set();
    const requestedThumbs = new Set();
    const ctl = beginPartsListFetch();
    if (typeof node.addEventListener === "function") {
      node.addEventListener("close", () => {
        if (partsListAbort === ctl) {
          try { partsListAbort.abort(); } catch (_) { /* ignore */ }
          partsListAbort = null;
        }
      }, { once: true });
    }
    if (!content.querySelector(".assist-tabs") && !content.querySelector(".assist-part")) {
      content.textContent = "Loading parts…";
    }
    try {
      data = await api(`/projects/${encodeURIComponent(pid)}/parts`, null, null, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
      content.textContent = err.message;
      return;
    }
    function render() {
      const pending = data.proposals.filter(p => p.status === "pending");
      content.innerHTML = `<nav class="assist-tabs" aria-label="Parts List tabs">${[["home","Home"],["electronics","Electronics"],["mcmaster","McMaster"],["mechanical","Mechanical"],["questions","Follow-up questions"]].map(([id,label]) => `<button data-tab="${id}" class="${tab === id ? "active" : ""}">${label}${id === "questions" ? "" : ` (${data.parts.filter(p => id === "home" || p.category === id).length})`}</button>`).join("")}</nav>
        <div class="assist-toolbar"><input type="search" placeholder="Search parts or specifications…" aria-label="Search parts" value="${esc(query)}"><select data-sort aria-label="Sort parts"><option value="name">Name</option><option value="category">Category</option><option value="quantity">Quantity</option></select><button data-view>${view === "grid" ? "List" : "Grid"}</button>
        <button data-catalog>Find STEP / electronics</button><button data-ask-part>Ask Render Agent: will it fit?</button><button data-review ${pending.length ? "" : "disabled"}>Review alternatives (${pending.length})</button><button data-generate ${data.changes.length ? "" : "disabled"}>Generate with AI</button></div>
        <div class="assist-parts-body"></div><p class="assist-status" role="status"></p>`;
      const status = content.querySelector(".assist-status");
      const body = content.querySelector(".assist-parts-body");
      if (tab === "questions") renderQuestions(body, status);
      else renderParts(body);
      content.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; render(); });
      content.querySelector("input[type=search]").oninput = e => { query = e.target.value; if (tab !== "questions") renderParts(body); };
      content.querySelector("[data-sort]").value = sort;
      content.querySelector("[data-sort]").onchange = e => { sort = e.target.value; if (tab !== "questions") renderParts(body); };
      content.querySelector("[data-view]").onclick = () => { view = view === "grid" ? "list" : "grid"; render(); };
      content.querySelector("[data-review]").onclick = () => review(pending, 0);
      content.querySelector("[data-catalog]").onclick = openCatalog;
      content.querySelector("[data-ask-part]").onclick = () => {
        const selected = data.parts.filter((part) => checked.has(part.id));
        if (!selected.length) { status.textContent = "Select one or more parts first, then ask Render Agent."; return; }
        const question = ["Will these exact parts work for my current build? Check dimensions, material, thread, voltage, mounting, and compatibility against my project before I buy.",
          ...selected.map((part) => `- ${vendorPartQuery(part)}${part.url ? ` | Source: ${part.url}` : ""}`)].join("\n");
        openRenderAgent?.({ question, autoSend: true, mini: true, fromLauncher: true, force: true, partsList: true });
      };
      content.querySelector("[data-generate]").onclick = async () => {
        try {
          if (getProjectId() !== pid) throw new Error("Return to this project before sending its edits.");
          const result = await api(`/projects/${encodeURIComponent(pid)}/parts/edit-brief`);
          await sendEdit(result.prompt, result.targets); node.close();
        } catch (err) { status.textContent = err.message; }
      };
      ensurePartsAgentFab(content, openRenderAgent);
    }
    function renderParts(body) {
      const items = filterParts(data.parts, tab, query, sort);
      body.innerHTML = items.length ? `<div class="assist-parts-${view}">${items.map(p => `<div class="assist-part-row" data-part-id="${esc(p.id)}"><label class="assist-check"><input type="checkbox" data-select="${esc(p.id)}" ${checked.has(p.id) ? "checked" : ""} aria-label="Select ${esc(p.name)}"><span class="assist-check-box" aria-hidden="true"></span></label>${partCard(p)}<div class="assist-part-actions"><button data-detail="${esc(p.id)}">Details / wiring docs</button><button data-bind="${esc(p.id)}">Link selected mount</button>${p.step_url ? `<button data-import="${esc(p.id)}">${p.model_filename ? "STEP imported" : "Import STEP"}</button>` : ""}</div></div>`).join("")}</div>` : '<p>No matching parts yet. Ask Render Agent to source components, or generate CAD with a parts list.</p>';
      body.querySelectorAll("[data-select]").forEach(el => el.onchange = () => el.checked ? checked.add(el.dataset.select) : checked.delete(el.dataset.select));
      body.querySelectorAll("[data-amazon-open]").forEach(el => el.onclick = (event) => {
        event.preventDefault();
        const href = el.getAttribute("data-amazon-open") || "";
        if (href) window.open(href, "_blank", "noopener,noreferrer");
      });
      body.querySelectorAll("[data-amazon-copy]").forEach(el => el.onclick = async (event) => {
        event.preventDefault();
        const href = el.getAttribute("data-amazon-copy") || "";
        try {
          if (href) await navigator.clipboard.writeText(href);
          content.querySelector(".assist-status").textContent = href ? "Amazon search link copied." : "Nothing to copy.";
        } catch {
          content.querySelector(".assist-status").textContent = "Could not copy the Amazon link.";
        }
      });
      body.querySelectorAll("[data-amazon-fit]").forEach(el => el.onclick = (event) => {
        event.preventDefault();
        const p = data.parts.find(row => row.id === el.dataset.amazonFit);
        if (!p) return;
        openRenderAgent?.({
          question: electronicsFitPrompt(p),
          autoSend: true,
          mini: true,
          fromLauncher: true,
          force: true,
          partsList: true,
        });
      });
      body.querySelectorAll("[data-vendor-open]").forEach(el => el.onclick = (event) => {
        event.preventDefault();
        const part = data.parts.find((row) => row.id === el.dataset.vendorOpen);
        const vendor = el.closest(".assist-vendor-search")?.querySelector("[data-part-vendor]")?.value || "amazon";
        const href = supplierSearchUrl(vendor, vendorPartQuery(part));
        if (host) document.dispatchEvent(new CustomEvent("render:compare-part", { detail: { query: vendorPartQuery(part), supplier: vendor } }));
        else if (href) window.open(href, "_blank", "noopener,noreferrer");
      });
      body.querySelectorAll("[data-detail]").forEach(el => el.onclick = () => {
        const p = data.parts.find(p => p.id === el.dataset.detail); const detail = dialog(p.name);
        detail.content.innerHTML = partCard(p) + `<h3>Mounting data</h3><pre>${esc(JSON.stringify(p.mounting || {}, null, 2))}</pre>`;
      });
      body.querySelectorAll("[data-bind]").forEach(el => el.onclick = async () => {
        try {
          if (getProjectId() !== pid) throw new Error("Return to this project first.");
          const target = await bindPartTarget();
          data = await api(`/projects/${encodeURIComponent(pid)}/parts/${encodeURIComponent(el.dataset.bind)}/target`, target, "PUT");
          content.querySelector(".assist-status").textContent = "Selected model and geometry references linked to this part’s mount.";
        } catch (err) { content.querySelector(".assist-status").textContent = err.message; }
      });
      body.querySelectorAll("[data-import]").forEach(el => el.onclick = async () => {
        el.disabled = true;
        try {
          if (getProjectId() !== pid) throw new Error("Return to this project first.");
          const result = await api(`/projects/${encodeURIComponent(pid)}/parts/import-model`, {part_id: el.dataset.import});
          await onPartsChanged?.(result); data = await api(`/projects/${encodeURIComponent(pid)}/parts`); render();
        } catch (err) { content.querySelector(".assist-status").textContent = err.message; el.disabled = false; }
      });
      void hydrateThumbs(body, items);
    }
    function applyThumb(box, src) {
      if (!box || !imageUrl(src)) return;
      let img = box.querySelector("img");
      if (!img) {
        img = document.createElement("img");
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";
        img.onerror = () => { const host = img.closest(".assist-part-thumb"); img.remove(); host?.classList.add("assist-part-thumb--empty"); };
        box.prepend(img);
      }
      img.src = src;
      box.classList.remove("assist-part-thumb--empty");
      box.dataset.thumbState = "ready";
    }
    function hydrateThumbs(body, items) {
      const missing = (items || []).filter(p => !partImageUrl(p) && url(p.url) && !requestedThumbs.has(p.id)).map(p => p.id);
      if (!missing.length) return;
      missing.forEach(id => requestedThumbs.add(id));
      api(`/projects/${encodeURIComponent(pid)}/parts/thumbnails`, { part_ids: missing }).then(result => {
        const thumbs = result.thumbnails || {};
        for (const part of data.parts) {
          if (thumbs[part.id]) part.thumbnail_url = thumbs[part.id];
        }
        for (const [id, src] of Object.entries(thumbs)) {
          applyThumb(body.querySelector(`[data-part-id="${CSS.escape(id)}"] .assist-part-thumb`), src);
        }
      }).catch(() => { missing.forEach(id => requestedThumbs.delete(id)); });
    }
    function openCatalog() {
      const catalog = dialog("Source electronics and STEP models");
      catalog.content.innerHTML = '<form class="assist-toolbar"><input type="search" aria-label="Catalog component search" placeholder="Exact component, e.g. Raspberry Pi 5" required><button>Search catalog first</button></form><p role="status"></p><div data-results></div>';
      catalog.content.querySelector("form").onsubmit = async event => {
        event.preventDefault(); const query = catalog.content.querySelector("input").value;
        const status = catalog.content.querySelector("[role=status]"); status.textContent = "Searching Parts Catalog, then external sources if needed…";
        try {
          const result = await api(`/parts/catalog/search?q=${encodeURIComponent(query)}&fallback=true`);
          status.textContent = result.errors.join(" · ") || `${result.sources.length} sources. Verify the exact variant before importing.`;
          catalog.content.querySelector("[data-results]").innerHTML = `<div class="assist-parts-grid">${result.sources.map((p, i) => `<div>${partCard({...p, name:p.name || p.title})}<button data-add="${i}">Add to review</button></div>`).join("")}</div>`;
          catalog.content.querySelectorAll("[data-add]").forEach(button => button.onclick = async () => {
            button.disabled = true;
            try {
              if (getProjectId() !== pid) throw new Error("Return to this project first.");
              data = await api(`/projects/${encodeURIComponent(pid)}/parts/catalog/propose`, {query, url: result.sources[Number(button.dataset.add)].url});
              render(); catalog.node.close(); review(data.proposals.filter(p => p.status === "pending"), 0);
            } catch (err) { status.textContent = err.message; button.disabled = false; }
          });
        } catch (err) { status.textContent = err.message; }
      };
    }
    function renderQuestions(body, status) {
      body.innerHTML = `<p>Answer what you know. Attach PDFs and photos through Reference Files; their filenames can be included in your answers.</p>
        <button data-mobile>Load mobile-base questions</button>
        <form class="assist-questions">${data.questions.map(q => `<label><strong>${esc(q.question)}</strong><small>${esc(q.reason)}</small><textarea data-q="${esc(q.id)}" rows="2" placeholder="Your answer…">${esc(q.answer || "")}</textarea></label>`).join("")}
        <button type="submit">Save answers</button></form>`;
      body.querySelector("[data-mobile]").onclick = async () => {
        try { data = await api(`/projects/${encodeURIComponent(pid)}/questions`, { questions: MOBILE_BASE_QUESTIONS.filter(q => !data.questions.some(saved => saved.id === q.id)) }, "PUT"); render(); }
        catch (err) { status.textContent = err.message; }
      };
      body.querySelector("form").onsubmit = async e => {
        e.preventDefault();
        try {
          data = await api(`/projects/${encodeURIComponent(pid)}/questions`, { questions: [...body.querySelectorAll("[data-q]")].map(el => ({ id: el.dataset.q, answer: el.value })) }, "PUT");
          status.textContent = "Answers saved. Analyze and CAD prompts will use them.";
        } catch (err) { status.textContent = err.message; }
      };
    }
    function review(rows, index) {
      const row = rows[index]; if (!row) return;
      const compare = dialog(`Review part ${index + 1} of ${rows.length}`);
      compare.content.innerHTML = `<div class="assist-compare"><section><h3>Current</h3>${row.before ? partCard(row.before) : "New addition"}</section><section><h3>Proposed</h3>${partCard(row.part)}</section></div>
        <p><strong>Mount / wiring changes:</strong> ${esc(row.part.mount_changes || "Verify fit before generation.")}</p><p role="status"></p>
        <footer><button data-deny>Deny</button><button data-approve>Approve replacement</button><button data-next>Skip / next</button></footer>`;
      const next = () => { compare.node.close(); if (index + 1 < rows.length) review(rows, index + 1); };
      compare.content.querySelector("[data-next]").onclick = next;
      for (const action of ["approve", "deny"]) compare.content.querySelector(`[data-${action}]`).onclick = async () => {
        compare.content.querySelectorAll("button").forEach(b => b.disabled = true);
        try { if (getProjectId() !== pid) throw new Error("Return to this project first."); data = await api(`/projects/${encodeURIComponent(pid)}/parts/${row.id}/decision`, { approve: action === "approve" }); render(); next(); void onPartsChanged?.(); }
        catch (err) { compare.content.querySelector("[role=status]").textContent = err.message; compare.content.querySelectorAll("button").forEach(b => b.disabled = false); }
      };
    }
    render();
  }

  const target = document.querySelector(".prompt-target-row");
  const help = document.createElement("button"); help.type = "button"; help.className = "assist-icon"; help.textContent = "?";
  help.title = "Edit selected examples: fit electronics, move a bracket, shorten a face, replace a controller, reroute wiring. Click to try one.";
  help.setAttribute("aria-label", "Edit selected examples"); target?.append(help);
  help.onclick = () => {
    const view = dialog("Ways to edit selected");
    const examples = [...EDIT_EXAMPLES].sort(() => Math.random() - 0.5).slice(0, 4);
    view.content.innerHTML = examples.map(([title, prompt], i) => `<article><button data-example="${i}">${esc(title)}</button><p data-preview="${i}" hidden>${esc(prompt)}<br><button data-try="${i}">Try it on my prompt</button></p></article>`).join("");
    view.content.querySelectorAll("[data-example]").forEach(b => b.onclick = () => { view.content.querySelector(`[data-preview="${b.dataset.example}"]`).hidden = false; });
    view.content.querySelectorAll("[data-try]").forEach(b => b.onclick = () => { setPrompt(examples[Number(b.dataset.try)][1]); view.node.close(); sync(); });
  };
  const gear = document.createElement("button"); gear.type = "button"; gear.className = "assist-icon"; gear.textContent = "⚙"; gear.title = "Smart learning settings"; gear.setAttribute("aria-label", "Smart learning settings"); target?.append(gear);
  gear.onclick = async () => {
    const view = dialog("Smart self-learning");
    try {
      const prefs = await api("/preferences");
      view.content.innerHTML = `<label><input data-experiments type="checkbox" ${prefs.enabled ? "checked" : ""}> Enable personal prompt experiments</label><p>Render can test short prompt-guidance versions on Analyze requests and promote one only after enough ratings show an improvement. This changes prompt guidance, not model weights.</p><label><input data-retention type="checkbox" ${prefs.retain_feedback ? "checked" : ""}> Retain my detailed feedback for improvement</label><p>When enabled, compact feedback events are stored privately for 90 days in your account's cloud record. Large files and images are not copied. Normal AI requests receive only the active guidance, capped at 2,400 characters, never the event history. A small 32 MB server queue is used only if cloud delivery is temporarily unavailable.</p><p role="status"></p>`;
      view.content.querySelector("[data-experiments]").onchange = async e => {
        try { await api("/preferences", { enabled: e.target.checked }, "PUT"); view.content.querySelector("[role=status]").textContent = "Experiment preference saved."; }
        catch (err) { e.target.checked = !e.target.checked; view.content.querySelector("[role=status]").textContent = err.message; }
      };
      view.content.querySelector("[data-retention]").onchange = async e => {
        try { await api("/preferences", { retain_feedback: e.target.checked }, "PUT"); view.content.querySelector("[role=status]").textContent = e.target.checked ? "Private 90-day feedback retention enabled." : "New detailed feedback will not be retained."; }
        catch (err) { e.target.checked = !e.target.checked; view.content.querySelector("[role=status]").textContent = err.message; }
      };
    } catch (err) { view.content.textContent = err.message; }
  };
  const tags = document.createElement("div"); tags.className = "assist-intents"; tags.setAttribute("aria-live", "polite");
  const input = document.getElementById("prompt-input"); input?.before(tags);
  const questions = document.createElement("button"); questions.type = "button"; questions.className = "assist-followup-link"; questions.textContent = "Follow-up questions"; questions.onclick = () => document.getElementById("prompt-target-mode")?.value === "edit" ? modelQuestions.open() : openParts("questions"); input?.after(questions);
  const resultFeedback = document.createElement("button"); resultFeedback.type = "button"; resultFeedback.className = "assist-followup-link"; resultFeedback.textContent = "Rate the selected model result";
  document.getElementById("prompt-image-drop")?.before(resultFeedback);
  resultFeedback.onclick = async () => {
    const view = dialog("Generated model feedback");
    try {
      const context = await getContext({ selectionRequired: true });
      view.content.innerHTML = `<p>Did <strong>${esc(context.base_filename)}</strong> meet your request?</p><textarea rows="3" placeholder="Optional: what should change?"></textarea><button data-good>👍 Works</button><button data-bad>👎 Needs changes</button><p role="status"></p>`;
      for (const [key, approve] of [["good", true], ["bad", false]]) view.content.querySelector(`[data-${key}]`).onclick = async () => {
        view.content.querySelectorAll("button").forEach(b => b.disabled = true);
        try {
          await api("/outcome", { project_id: context.project_id, filename: context.base_filename,
            event_id: "",
            prompt: getPrompt(), approve, comment: view.content.querySelector("textarea").value });
          view.content.querySelector("[role=status]").textContent = "Model-result feedback saved.";
        } catch (err) { view.content.querySelector("[role=status]").textContent = err.message; view.content.querySelectorAll("button").forEach(b => b.disabled = false); }
      };
    } catch (err) { view.content.textContent = err.message; }
  };
  function sync() {
    const edit = document.getElementById("prompt-target-mode")?.value === "edit";
    tags.hidden = !edit;
    tags.innerHTML = inferEditIntents(getPrompt()).map(t => `<span>Suggested: ${esc(t)}</span>`).join("");
  }
  input?.addEventListener("input", sync);
  document.getElementById("prompt-target-mode")?.addEventListener("change", sync);
  sync();
  return modelQuestions;
}
