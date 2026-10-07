import { authHeaders } from "../studio/auth.js";
import { writeClipboardText } from "./prompt-chip-copy.js?v=20260915-links2";
import { originalLink } from "./prompt-link-data.js?v=1";

const previews = new Map();
let popup = null;
let closeTimer;
const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
async function request(path, body) {
  const response = await fetch(`/api/design-assist${path}`, {
    method: "POST", headers: { ...authHeaders(), "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Could not load link");
  return data;
}
function loadPreview(url) {
  if (!previews.has(url)) {
    previews.set(url, request("/link-preview", { url }).catch(() => ({
      title: new URL(url).hostname, description: "Preview unavailable. Open the website for product details.", url,
    })));
    if (previews.size > 128) previews.delete(previews.keys().next().value);
  }
  return previews.get(url);
}
function close() { popup?.remove(); popup = null; }
function deferClose() { clearTimeout(closeTimer); closeTimer = setTimeout(close, 220); }
function position(node, box) {
  node.style.left = `${Math.max(8, Math.min(box.left, window.innerWidth - 330))}px`;
  node.style.top = `${Math.max(8, Math.min(box.bottom + 6, window.innerHeight - node.offsetHeight - 8))}px`;
}
function button(parent, label, action) {
  const b = el("button", label);
  b.type = "button";
  b.addEventListener("click", action);
  parent.append(b);
  return b;
}

export function decoratePromptLink(node, ref, { getProjectId = () => null, onStatus } = {}) {
  const url = originalLink(ref);
  if (!url) return;
  if (!document.getElementById("prompt-link-css")) {
    const css = document.createElement("link");
    css.id = "prompt-link-css"; css.rel = "stylesheet"; css.href = "/components/prompt-link.css?v=1";
    document.head.append(css);
    document.addEventListener("pointerdown", event => { if (popup && !popup.contains(event.target)) close(); });
    document.addEventListener("keydown", event => { if (event.key === "Escape") close(); });
    window.addEventListener("scroll", close, true);
  }
  node.classList.add("prompt-link-chip");
  node.dataset.url = url;
  node.tabIndex = 0;
  node.title = `${ref.description ? `${ref.description}: ` : ""}${url}\nRight-click for link actions`;
  const icon = el("span", "↗", "prompt-link-favicon");
  node.prepend(icon);
  const label = node.querySelector(".ref-token,.prompt-mention-label");
  if (label) label.textContent = ref.label || new URL(url).hostname;
  const report = (kind, message) => onStatus?.(kind, message);

  async function show(menu = false, event) {
    clearTimeout(closeTimer); close();
    const box = event ? { left: event.clientX, bottom: event.clientY } : node.getBoundingClientRect();
    const card = el("div", "", "prompt-link-popover");
    card.setAttribute("role", "dialog"); card.setAttribute("aria-label", menu ? "Link actions" : "Link preview");
    popup = card;
    card.addEventListener("pointerenter", () => clearTimeout(closeTimer));
    card.addEventListener("pointerleave", deferClose);
    const title = el("strong", ref.description || ref.label || "Link");
    const description = el("p", "Loading preview…");
    card.append(title, description, el("small", new URL(url).hostname));
    const open = el("a", "Open website ↗"); open.href = url; open.target = "_blank"; open.rel = "noopener noreferrer";
    card.append(open);
    if (menu) {
      const actions = el("div", "", "prompt-link-actions");
      button(actions, "Copy link", async () => {
        const copied = await writeClipboardText(url);
        report(copied ? "ok" : "error", copied ? "Copied link" : "Could not copy link"); close();
      });
      button(actions, "Open link in new tab", () => { window.open(url, "_blank", "noopener,noreferrer"); close(); });
      button(actions, "Share link…", async () => {
        if (navigator.share) {
          try { await navigator.share({ title: title.textContent, url }); close(); }
          catch (error) { if (error.name !== "AbortError") report("error", "Use Email, Text, or Discord below."); }
        } else report("ok", "Choose Email, Text, or Discord below.");
      });
      for (const [name, scheme] of [["Email", "mailto:?body="], ["Text message", "sms:?body="]]) {
        const a = el("a", name); a.href = scheme + encodeURIComponent(`${title.textContent}\n${url}`); actions.append(a);
      }
      button(actions, "Discord (copy and open)", async () => {
        if (await writeClipboardText(url)) {
          window.location.href = "discord://";
          report("ok", "Link copied. Choose a Discord conversation and paste it."); close();
        } else report("error", "Could not copy the link.");
      });
      button(actions, "Add to project Parts List", async () => {
        const pid = getProjectId();
        if (!pid) { report("error", "Open a project before adding a part."); return; }
        try {
          const result = await request(`/projects/${encodeURIComponent(pid)}/parts/link`, { url, description: ref.description || "" });
          report("ok", result.added ? "Added to Parts List" : "Already in Parts List");
          window.dispatchEvent(new CustomEvent("render:parts-updated", { detail: { projectId: pid } })); close();
        } catch (error) { report("error", error.message); }
      });
      card.append(actions);
    }
    document.body.append(card); position(card, box);
    if (menu) card.querySelector("button")?.focus();
    const data = await loadPreview(url);
    if (popup !== card) return;
    title.textContent = data.title || ref.label || url;
    description.textContent = data.description || "No description was supplied by this website.";
    if (data.image) {
      const img = el("img", "", "prompt-link-preview-image"); img.src = data.image; img.referrerPolicy = "no-referrer";
      img.alt = data.title || "Product preview"; img.addEventListener("error", () => img.remove()); card.prepend(img);
    }
    if (data.favicon) {
      const img = el("img"); img.src = data.favicon; img.alt = ""; img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => img.replaceWith(document.createTextNode("↗")));
      icon.replaceChildren(img);
    }
    position(card, box);
  }
  node.addEventListener("pointerenter", () => { void show(); });
  node.addEventListener("pointerleave", deferClose);
  node.addEventListener("focus", () => { if (!popup) void show(); });
  node.addEventListener("contextmenu", event => { event.preventDefault(); event.stopPropagation(); void show(true, event); });
  node.addEventListener("keydown", event => {
    if (event.key === "Enter" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault(); event.stopPropagation(); void show(true);
    }
  });
  // Warm only a bounded number of links, and keep network work out of typing.
  if (previews.size < 24) void loadPreview(url).then(data => {
    if (data.favicon && node.isConnected) {
      const img = el("img"); img.src = data.favicon; img.alt = ""; img.referrerPolicy = "no-referrer";
      img.addEventListener("error", () => img.remove()); icon.replaceChildren(img);
    }
  });
}
