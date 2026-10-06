/** Incognito project PIN setup / unlock dialogs */

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ensureStyles() {
  if (document.getElementById("incognito-modal-styles")) return;
  const style = document.createElement("style");
  style.id = "incognito-modal-styles";
  style.textContent = `
    .incognito-modal {
      position: fixed; inset: 0; z-index: 13000;
      display: flex; align-items: center; justify-content: center;
      padding: 20px; background: rgba(1,4,9,.58); backdrop-filter: blur(2px);
    }
    .incognito-modal.hidden { display: none; }
    .incognito-modal-card {
      width: min(400px, calc(100vw - 32px));
      border: 1px solid rgba(88,166,255,.28); border-radius: 14px;
      background: #161b22; box-shadow: 0 18px 48px rgba(0,0,0,.45);
      padding: 16px; color: #e6edf3;
    }
    .incognito-modal-head {
      display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-bottom: 10px;
    }
    .incognito-modal-head h3 { margin: 0; font-size: 1.05rem; }
    .incognito-modal-close {
      width: 28px; height: 28px; border-radius: 8px; border: 1px solid rgba(139,148,158,.35);
      background: transparent; color: #e6edf3; font-size: 1.1rem; cursor: pointer; line-height: 1;
    }
    .incognito-modal-close:hover { border-color: rgba(248,81,73,.55); color: #ffa198; }
    .incognito-modal p { margin: 0 0 12px; color: #9da7b3; font-size: .86rem; line-height: 1.45; }
    .incognito-modal label { display: block; font-size: .75rem; color: #8b949e; margin: 0 0 4px; }
    .incognito-modal input {
      width: 100%; box-sizing: border-box; margin-bottom: 10px;
      padding: 9px 11px; border-radius: 8px; border: 1px solid rgba(88,166,255,.28);
      background: #0d1117; color: #e6edf3; font-size: .95rem; letter-spacing: .12em;
    }
    .incognito-modal-error { color: #ffa198; font-size: .8rem; min-height: 1.1em; margin: 0 0 10px; }
    .incognito-modal-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    .incognito-modal-actions .btn { min-width: 88px; }
  `;
  document.head.appendChild(style);
}

/**
 * @param {{
 *   title: string,
 *   body: string,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 *   skipLabel?: string | null,
 *   requirePin?: boolean,
 *   confirmPin?: boolean,
 * }} opts
 * @returns {Promise<{pin: string|null, skipped?: boolean}|null>}
 */
export function promptIncognitoPin(opts = {}) {
  ensureStyles();
  const {
    title = "Incognito PIN",
    body = "Enter a PIN to keep this project private on this device.",
    confirmLabel = "Save PIN",
    cancelLabel = "Cancel",
    skipLabel = "Skip for now",
    requirePin = false,
    confirmPin = true,
  } = opts;

  return new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "incognito-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = `
      <div class="incognito-modal-card">
        <div class="incognito-modal-head">
          <h3>${escapeHtml(title)}</h3>
          <button type="button" class="incognito-modal-close" data-act="close" aria-label="Close">×</button>
        </div>
        <p>${escapeHtml(body)}</p>
        <label for="incognito-pin-input">PIN (4–32 characters)</label>
        <input id="incognito-pin-input" type="password" inputmode="numeric" autocomplete="off" maxlength="32" />
        ${confirmPin ? `
          <label for="incognito-pin-confirm">Confirm PIN</label>
          <input id="incognito-pin-confirm" type="password" inputmode="numeric" autocomplete="off" maxlength="32" />
        ` : ""}
        <div class="incognito-modal-error" data-error></div>
        <div class="incognito-modal-actions">
          ${skipLabel ? `<button type="button" class="btn secondary" data-act="skip">${escapeHtml(skipLabel)}</button>` : ""}
          <button type="button" class="btn secondary" data-act="cancel">${escapeHtml(cancelLabel)}</button>
          <button type="button" class="btn accent" data-act="confirm">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const pinEl = modal.querySelector("#incognito-pin-input");
    const confirmEl = modal.querySelector("#incognito-pin-confirm");
    const errEl = modal.querySelector("[data-error]");
    const finish = (value) => {
      modal.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(value);
    };
    const onKey = (event) => {
      if (event.key === "Escape") finish(null);
      if (event.key === "Enter") modal.querySelector('[data-act="confirm"]')?.click();
    };
    document.addEventListener("keydown", onKey, true);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) finish(null);
    });
    modal.querySelector('[data-act="close"]')?.addEventListener("click", () => finish(null));
    modal.querySelector('[data-act="cancel"]')?.addEventListener("click", () => finish(null));
    modal.querySelector('[data-act="skip"]')?.addEventListener("click", () => {
      if (requirePin) {
        errEl.textContent = "A PIN is required.";
        return;
      }
      finish({ pin: null, skipped: true });
    });
    modal.querySelector('[data-act="confirm"]')?.addEventListener("click", () => {
      const pin = String(pinEl?.value || "").trim();
      if (pin.length < 4 || pin.length > 32) {
        errEl.textContent = "PIN must be 4–32 characters.";
        return;
      }
      if (confirmPin && String(confirmEl?.value || "").trim() !== pin) {
        errEl.textContent = "PINs do not match.";
        return;
      }
      finish({ pin, skipped: false });
    });
    queueMicrotask(() => pinEl?.focus());
  });
}

/**
 * Unlock dialog — returns PIN string or null if cancelled.
 */
export async function promptIncognitoUnlock({ projectName = "this project" } = {}) {
  const result = await promptIncognitoPin({
    title: "Unlock Incognito",
    body: `Enter the PIN to open ${projectName}. Nothing from Incognito projects is shared with management.`,
    confirmLabel: "Unlock",
    cancelLabel: "Cancel",
    skipLabel: null,
    requirePin: true,
    confirmPin: false,
  });
  return result?.pin || null;
}

/**
 * Enable flow — optional PIN setup.
 * @returns {Promise<{enabled: boolean, pin: string|null}|null>}
 */
export async function promptEnableIncognito({ projectName = "this project" } = {}) {
  const result = await promptIncognitoPin({
    title: "Enable Incognito",
    body: `Keep ${projectName} completely private to you. Nothing is submitted to management or recorded for admins. Optionally set a PIN required to open it.`,
    confirmLabel: "Enable with PIN",
    cancelLabel: "Cancel",
    skipLabel: "Enable without PIN",
    requirePin: false,
    confirmPin: true,
  });
  if (!result) return null;
  return { enabled: true, pin: result.skipped ? null : result.pin };
}
