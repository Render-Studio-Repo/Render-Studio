/** Transient notifications overlaid on the 3D viewport. */

const DEFAULT_MS = 3200;

export function createViewerToast(viewportEl) {
  if (!viewportEl) return { show: () => {}, dismiss: () => {} };

  const root = document.createElement("div");
  root.className = "viewer-toast-stack";
  root.setAttribute("aria-live", "polite");
  viewportEl.appendChild(root);

  let hideTimer = null;
  let current = null;

  function dismiss() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    if (current) {
      current.classList.add("viewer-toast--out");
      const el = current;
      setTimeout(() => el.remove(), 280);
      current = null;
    }
  }

  /**
   * @param {string} message
   * @param {{ kind?: 'info'|'loading'|'ok'|'error', durationMs?: number, icon?: string, copyable?: boolean, fullText?: string }} [opts]
   */
  function show(message, opts = {}) {
    const kind = opts.kind || "info";
    const copyable = opts.copyable ?? kind === "error";
    const fullText = opts.fullText || message;
    const durationMs =
      opts.durationMs ?? (kind === "loading" ? 0 : kind === "error" && copyable ? 0 : DEFAULT_MS);

    dismiss();

    const toast = document.createElement("div");
    toast.className = `viewer-toast viewer-toast--${kind}`;
    if (copyable) toast.classList.add("viewer-toast--copyable");

    const icon = opts.icon ?? iconForKind(kind);
    toast.innerHTML = `
      <span class="viewer-toast-icon" aria-hidden="true">${icon}</span>
      <span class="viewer-toast-body">
        <span class="viewer-toast-text">${escapeHtml(message)}</span>
        ${copyable ? '<span class="viewer-toast-copy-hint">Tap to copy</span>' : ""}
      </span>
      ${kind === "error" ? '<button type="button" class="viewer-toast-close" aria-label="Dismiss">×</button>' : ""}
    `;

    toast.querySelector(".viewer-toast-close")?.addEventListener("click", (e) => {
      e.stopPropagation();
      dismiss();
    });

    if (copyable && fullText) {
      toast.title = fullText;
      toast.addEventListener("click", async (e) => {
        if (e.target.closest(".viewer-toast-close")) return;
        const hint = toast.querySelector(".viewer-toast-copy-hint");
        try {
          await copyToClipboard(fullText);
          if (hint) hint.textContent = "Copied!";
          setTimeout(() => {
            if (hint) hint.textContent = "Tap to copy";
          }, 2000);
        } catch {
          if (hint) hint.textContent = "Copy failed";
        }
      });
    }

    root.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("viewer-toast--in"));
    current = toast;

    if (durationMs > 0) {
      hideTimer = setTimeout(dismiss, durationMs);
    }
    return { dismiss };
  }

  return { show, dismiss };
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

function iconForKind(kind) {
  if (kind === "loading") return "◌";
  if (kind === "ok") return "✓";
  if (kind === "error") return "✕";
  return "●";
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Brief green pulse on the viewport after a successful geometry update. */
export function flashViewport(viewportEl, kind = "ok") {
  if (!viewportEl) return;
  viewportEl.classList.remove("viewer-flash-ok", "viewer-flash-error");
  void viewportEl.offsetWidth;
  viewportEl.classList.add(kind === "error" ? "viewer-flash-error" : "viewer-flash-ok");
  setTimeout(() => {
    viewportEl.classList.remove("viewer-flash-ok", "viewer-flash-error");
  }, 650);
}
