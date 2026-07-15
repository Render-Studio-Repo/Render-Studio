const WELCOME_SEEN_KEY = "render3d:welcomeSeen:v1";
const TOKEN_KEY = "render3d:token";

function storageGet(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function storageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore storage failures */
  }
}

function shouldShowWelcome() {
  if (storageGet(WELCOME_SEEN_KEY) === "1") return false;
  // Signed-in users have already crossed the first-run path.
  if (storageGet(TOKEN_KEY)) return false;
  return true;
}

function openCreateAccount() {
  document.getElementById("welcome-modal")?.classList.add("hidden");
  storageSet(WELCOME_SEEN_KEY, "1");
  document.getElementById("btn-auth")?.click();
  requestAnimationFrame(() => {
    document.querySelector("#auth-modal .auth-tab[data-tab='register']")?.click();
    document.getElementById("register-name")?.focus();
  });
}

function initWelcomeModal() {
  const modal = document.getElementById("welcome-modal");
  if (!modal) return;
  const dontShow = document.getElementById("welcome-dont-show");

  const close = ({ remember = true } = {}) => {
    modal.classList.add("hidden");
    if (remember || dontShow?.checked) storageSet(WELCOME_SEEN_KEY, "1");
  };

  modal.querySelectorAll("[data-welcome-close]").forEach((el) => {
    el.addEventListener("click", () => close({ remember: true }));
  });
  modal.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => close({ remember: true }));
  });
  document.getElementById("welcome-create-account")?.addEventListener("click", openCreateAccount);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) close({ remember: true });
  });

  if (shouldShowWelcome()) {
    window.setTimeout(() => {
      modal.classList.remove("hidden");
      document.getElementById("welcome-create-account")?.focus();
    }, 450);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initWelcomeModal);
} else {
  initWelcomeModal();
}
