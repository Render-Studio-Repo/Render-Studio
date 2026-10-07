/** Daily shared-key dollar limit picker — presets + custom amount. */

const PRESETS = [5, 10, 20];

function formatUsd(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "$0";
  return `$${n.toFixed(n >= 10 && Number.isInteger(n) ? 0 : 2)}`;
}

function limitButtonLabel(limit) {
  if (limit == null) return "No limit";
  return `${formatUsd(limit)}/day`;
}

function normalizeLimit(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return NaN;
  return n;
}

function selectionFromLimit(limit) {
  if (limit == null) return { mode: "none" };
  const preset = PRESETS.find((p) => Math.abs(p - limit) < 0.001);
  if (preset != null) return { mode: "preset", value: preset };
  return { mode: "custom", value: limit };
}

let modalEl = null;
let pending = null;

function ensureModal() {
  if (modalEl) return modalEl;
  modalEl = document.createElement("div");
  modalEl.id = "daily-limit-modal";
  modalEl.className = "auth-modal hidden";
  modalEl.setAttribute("role", "dialog");
  modalEl.setAttribute("aria-modal", "true");
  modalEl.setAttribute("aria-labelledby", "daily-limit-title");
  modalEl.innerHTML = `
    <div class="auth-backdrop" data-daily-limit-close></div>
    <div class="auth-card app-dialog-card daily-limit-card">
      <button type="button" class="auth-close" data-daily-limit-close aria-label="Close">&times;</button>
      <h2 id="daily-limit-title" class="app-dialog-title">Daily spend limit</h2>
      <p id="daily-limit-desc" class="daily-limit-desc muted small"></p>
      <p id="daily-limit-usage" class="daily-limit-usage hidden"></p>
      <div class="daily-limit-presets" role="group" aria-label="Preset daily limits">
        ${PRESETS.map((amount) => `
          <button type="button" class="daily-limit-preset" data-preset="${amount}">${formatUsd(amount)}</button>
        `).join("")}
      </div>
      <button type="button" class="daily-limit-none" data-preset="none">No limit</button>
      <label class="daily-limit-custom-label">
        <span>Custom amount</span>
        <div class="daily-limit-custom-wrap">
          <span class="daily-limit-currency">$</span>
          <input type="number" id="daily-limit-custom-input" min="0" step="0.01" inputmode="decimal" placeholder="Enter amount" />
          <span class="daily-limit-suffix">/ day</span>
        </div>
      </label>
      <p id="daily-limit-error" class="auth-error hidden"></p>
      <div class="app-dialog-actions">
        <button type="button" class="btn secondary" data-daily-limit-close>Cancel</button>
        <button type="button" class="btn accent" id="daily-limit-save">Save</button>
      </div>
    </div>`;
  document.body.appendChild(modalEl);

  const customInput = modalEl.querySelector("#daily-limit-custom-input");
  const errorEl = modalEl.querySelector("#daily-limit-error");

  modalEl.querySelectorAll("[data-daily-limit-close]").forEach((el) => {
    el.addEventListener("click", () => closeDailyLimitPicker());
  });

  modalEl.querySelectorAll(".daily-limit-preset, .daily-limit-none").forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = btn.dataset.preset;
      if (preset === "none") {
        pending = { ...(pending || {}), mode: "none", value: null };
      } else {
        pending = { ...(pending || {}), mode: "preset", value: Number(preset) };
      }
      syncDailyLimitPickerUI();
    });
  });

  customInput?.addEventListener("input", () => {
    pending = { ...(pending || {}), mode: "custom", value: customInput.value.trim() };
    syncDailyLimitPickerUI();
  });

  customInput?.addEventListener("focus", () => {
    pending = { ...(pending || {}), mode: "custom", value: customInput.value.trim() };
    syncDailyLimitPickerUI();
  });

  modalEl.querySelector("#daily-limit-save")?.addEventListener("click", async () => {
    if (!pending?.onSave) return;
    const value = resolvePendingLimit();
    if (Number.isNaN(value)) {
      if (errorEl) {
        errorEl.textContent = "Enter a valid positive amount, or choose No limit.";
        errorEl.classList.remove("hidden");
      }
      return;
    }
    const saveBtn = modalEl.querySelector("#daily-limit-save");
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
    }
    try {
      await pending.onSave(value);
      closeDailyLimitPicker();
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = err?.message || "Could not save daily limit";
        errorEl.classList.remove("hidden");
      }
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
      }
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modalEl && !modalEl.classList.contains("hidden")) {
      closeDailyLimitPicker();
    }
  });

  return modalEl;
}

function resolvePendingLimit() {
  if (!pending) return null;
  if (pending.mode === "none") return null;
  if (pending.mode === "preset") return pending.value;
  const raw = String(pending.value ?? "").trim();
  if (raw === "") return null;
  return normalizeLimit(raw);
}

function syncDailyLimitPickerUI() {
  if (!modalEl || !pending) return;
  const customInput = modalEl.querySelector("#daily-limit-custom-input");
  const errorEl = modalEl.querySelector("#daily-limit-error");
  errorEl?.classList.add("hidden");

  modalEl.querySelectorAll(".daily-limit-preset").forEach((btn) => {
    const amount = Number(btn.dataset.preset);
    const active = pending.mode === "preset" && pending.value === amount;
    btn.classList.toggle("active", active);
  });
  modalEl.querySelector(".daily-limit-none")?.classList.toggle("active", pending.mode === "none");
  modalEl.querySelector(".daily-limit-custom-label")?.classList.toggle("active", pending.mode === "custom");

  if (customInput && pending.mode === "custom") {
    if (document.activeElement !== customInput) {
      customInput.value = pending.value ?? "";
    }
  } else if (customInput && pending.mode !== "custom") {
    customInput.value = "";
  }
}

/**
 * @param {object} opts
 * @param {number|null} opts.currentLimit
 * @param {number} [opts.spentToday]
 * @param {string} [opts.title]
 * @param {string} [opts.description]
 * @param {(limit: number|null) => Promise<void>} opts.onSave
 */
export function openDailyLimitPicker(opts) {
  const modal = ensureModal();
  const selection = selectionFromLimit(opts.currentLimit ?? null);
  pending = {
    mode: selection.mode,
    value: selection.mode === "none" ? null : selection.value,
    onSave: opts.onSave,
  };

  const desc = modal.querySelector("#daily-limit-desc");
  const usage = modal.querySelector("#daily-limit-usage");
  const title = modal.querySelector("#daily-limit-title");
  if (title) title.textContent = opts.title || "Daily spend limit";
  if (desc) {
    desc.textContent = opts.description
      || "Cap estimated AI cost per day when using this shared key.";
  }
  if (usage) {
    const spent = Number(opts.spentToday || 0);
    const limit = opts.currentLimit;
    if (limit != null || spent > 0) {
      usage.textContent = limit != null
        ? `Today: ${formatUsd(spent)} of ${formatUsd(limit)} used`
        : `Today: ${formatUsd(spent)} used (no limit set)`;
      usage.classList.remove("hidden");
    } else {
      usage.classList.add("hidden");
    }
  }

  syncDailyLimitPickerUI();
  modal.classList.remove("hidden");
  const customInput = modal.querySelector("#daily-limit-custom-input");
  if (selection.mode === "custom" && customInput) customInput.focus();
}

export function closeDailyLimitPicker() {
  if (!modalEl) return;
  modalEl.classList.add("hidden");
  pending = null;
}

export { formatUsd, limitButtonLabel, PRESETS };
