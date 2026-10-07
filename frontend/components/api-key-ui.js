/** Per-user OpenAI API key — account dropdown + modal. */

export function createApiKeyUI({ api, authApi, onStatusChange }) {
  const keyApi = api || authApi;
  if (typeof keyApi !== "function") {
    throw new Error("createApiKeyUI: missing api");
  }
  const modal = document.getElementById("api-key-modal");
  const form = document.getElementById("api-key-form");
  const formWrap = document.getElementById("api-key-form-wrap");
  const ownerNote = document.getElementById("api-key-owner-note");
  const input = document.getElementById("api-key-input");
  const errorEl = document.getElementById("api-key-error");
  const hintEl = document.getElementById("api-key-hint");
  const titleEl = document.getElementById("api-key-title");
  const subtitleEl = document.getElementById("api-key-subtitle");
  const btnRemove = document.getElementById("btn-api-key-remove");
  const btnMenu = document.getElementById("btn-api-key-menu");
  const menuKeyStatus = document.getElementById("user-menu-key-status");
  const userMenu = document.getElementById("user-menu");

  let status = null;

  function closeUserMenu() {
    userMenu?.classList.add("hidden");
  }

  function showModal(show, { required = false } = {}) {
    if (!modal) return;
    modal.classList.toggle("hidden", !show);
    modal.dataset.required = required ? "1" : "0";
    if (show) {
      if (errorEl) errorEl.textContent = "";
      const shared = status?.uses_shared_key;
      formWrap?.classList.toggle("hidden", !!shared);
      ownerNote?.classList.toggle("hidden", !shared);
      if (!shared) input?.focus();
    }
  }

  function applyStatus(next) {
    status = next;
    const shared = status?.uses_shared_key;
    const hasKey = status?.has_user_key;

    if (btnMenu) {
      const label = btnMenu.querySelector(".user-menu-item-label");
      if (label) {
        label.textContent = shared
          ? "OpenAI API key"
          : hasKey
            ? "Change OpenAI API key"
            : "Add OpenAI API key";
      }
    }
    if (menuKeyStatus && status) {
      if (shared) {
        menuKeyStatus.textContent = "Workspace key";
      } else if (hasKey && status.key_hint) {
        menuKeyStatus.textContent = status.key_hint;
      } else {
        menuKeyStatus.textContent = "Required for AI";
      }
    }
    if (btnRemove) {
      btnRemove.classList.toggle("hidden", !hasKey || shared);
    }
    if (hintEl && status) {
      if (shared) {
        hintEl.textContent = "This account uses the shared workspace API key.";
      } else if (hasKey && status.key_hint) {
        hintEl.textContent = `Saved key ${status.key_hint}`;
      } else {
        hintEl.textContent =
          "Your key is stored encrypted on this server and only used for your AI prompts.";
      }
    }
    if (titleEl) {
      titleEl.textContent = shared
        ? "Workspace API key"
        : hasKey
          ? "Change OpenAI API key"
          : "Add OpenAI API key";
    }
    if (subtitleEl) {
      subtitleEl.textContent = shared
        ? "Your account uses the built-in key — no setup needed."
        : "Required for AI generate. Get a key at platform.openai.com/api-keys";
    }
    onStatusChange?.(status);
  }

  async function refreshStatus() {
    const data = await keyApi("/api/user/openai-key/status");
    applyStatus(data);
    return data;
  }

  function needsKeyPrompt() {
    return status && status.needs_user_key && !status.ai_ready;
  }

  function openModal(opts = {}) {
    showModal(true, opts);
  }

  modal?.querySelectorAll("[data-api-key-close]").forEach((el) => {
    el.addEventListener("click", () => {
      if (modal?.dataset.required === "1" && needsKeyPrompt()) return;
      showModal(false);
    });
  });

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (status?.uses_shared_key) return;
    const api_key = input?.value?.trim();
    if (!api_key) return;
    try {
      const data = await keyApi("/api/user/openai-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key }),
      });
      applyStatus(data);
      if (input) input.value = "";
      showModal(false);
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message;
    }
  });

  btnRemove?.addEventListener("click", async () => {
    if (!confirm("Remove your saved API key? You will need to add it again to generate.")) return;
    try {
      const data = await keyApi("/api/user/openai-key", { method: "DELETE" });
      applyStatus(data);
    } catch (err) {
      if (errorEl) errorEl.textContent = err.message;
    }
  });

  btnMenu?.addEventListener("click", (e) => {
    e.stopPropagation();
    closeUserMenu();
    openModal();
  });

  return {
    applyStatus,
    refreshStatus,
    needsKeyPrompt,
    openModal,
    getStatus: () => status,
  };
}
