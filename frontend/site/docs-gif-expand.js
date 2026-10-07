/** Expand GIFs in Getting Started / Docs / Updates into a larger popup. */

const GIF_IMG_SELECTORS = [
  "img.gs-demo-gif",
  "img.docs-feature-gif",
  ".updates-visual img",
  "img.docs-gif-expandable",
].join(",");

const FRAME_SELECTORS = ".gs-demo, .docs-feature-gif-wrap, .updates-visual, .docs-gif-frame";

function plusIconSvg() {
  return `
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M7.25 2.5h1.5v4.75H13.5v1.5H8.75V13.5h-1.5V8.75H2.5v-1.5h4.75V2.5z"/>
    </svg>
  `;
}

function closeIconSvg() {
  return `
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M3.2 3.2 4.26 2.14 8 5.88l3.74-3.74 1.06 1.06L9.06 6.94l3.74 3.74-1.06 1.06L8 8l-3.74 3.74-1.06-1.06L6.94 6.94 3.2 3.2z"/>
    </svg>
  `;
}

let escapeHandler = null;

export function closeGifExpandPopup() {
  document.getElementById("docs-gif-lightbox")?.remove();
  if (escapeHandler) {
    document.removeEventListener("keydown", escapeHandler);
    escapeHandler = null;
  }
  document.body.classList.remove("docs-gif-lightbox-open");
}

export function openGifExpandPopup(src, { alt = "Demo GIF", title = "Demo" } = {}) {
  if (!src) return;
  closeGifExpandPopup();
  const modal = document.createElement("div");
  modal.id = "docs-gif-lightbox";
  modal.className = "docs-gif-lightbox";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", title);
  modal.innerHTML = `
    <div class="docs-gif-lightbox-backdrop" data-gif-close tabindex="-1"></div>
    <div class="docs-gif-lightbox-card">
      <div class="docs-gif-lightbox-head">
        <p class="docs-gif-lightbox-title">${escapeHtml(title)}</p>
        <button type="button" class="docs-gif-lightbox-close" data-gif-close aria-label="Close">
          ${closeIconSvg()}
        </button>
      </div>
      <div class="docs-gif-lightbox-media">
        <img src="${escapeAttr(src)}" alt="${escapeAttr(alt)}" />
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.body.classList.add("docs-gif-lightbox-open");
  modal.addEventListener("click", (event) => {
    if (event.target.closest?.("[data-gif-close]")) closeGifExpandPopup();
  });
  escapeHandler = (event) => {
    if (event.key === "Escape") closeGifExpandPopup();
  };
  document.addEventListener("keydown", escapeHandler);
  modal.querySelector(".docs-gif-lightbox-close")?.focus?.();
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function escapeAttr(value = "") {
  return escapeHtml(value);
}

function frameTitle(frame, img) {
  const feature = frame.closest?.(".gs-feature, .docs-feature-card, .updates-card, article, section");
  const heading = feature?.querySelector?.("h3, h4, h2");
  return heading?.textContent?.trim() || img?.alt || "Demo GIF";
}

function attachExpandButton(frame, img) {
  if (!frame || !img?.getAttribute("src")) return;
  if (frame.classList.contains("docs-feature-gif-wrap--empty")) return;
  if (frame.classList.contains("updates-visual--empty")) return;
  if (frame.querySelector(":scope > .docs-gif-expand-btn")) return;

  frame.classList.add("docs-gif-frame");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "docs-gif-expand-btn";
  btn.title = "Expand GIF";
  btn.setAttribute("aria-label", "Expand GIF fullscreen");
  btn.innerHTML = plusIconSvg();
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openGifExpandPopup(img.currentSrc || img.src, {
      alt: img.alt || "Demo GIF",
      title: frameTitle(frame, img),
    });
  });
  frame.appendChild(btn);
}

/**
 * Add bottom-right expand (+) controls to GIF frames under `root`.
 * Safe to call after dynamic mounts; skips frames already wired.
 */
export function enhanceDocsGifs(root = document) {
  const scope = root?.querySelectorAll ? root : document;
  scope.querySelectorAll(GIF_IMG_SELECTORS).forEach((img) => {
    const frame =
      img.closest(FRAME_SELECTORS)
      || img.parentElement;
    if (!frame) return;
    if (frame.dataset.gifExpandReady === "1") {
      attachExpandButton(frame, img);
      return;
    }
    frame.dataset.gifExpandReady = "1";
    const ensure = () => attachExpandButton(frame, img);
    img.addEventListener("load", ensure, { once: true });
    img.addEventListener("error", () => {
      frame.querySelector(":scope > .docs-gif-expand-btn")?.remove();
    }, { once: true });
    if (img.complete && img.naturalWidth > 0) ensure();
    else ensure(); // still show control while lazy-loading
  });
}
