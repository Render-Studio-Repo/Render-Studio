import {
  applyVrHeadsetClass,
  isVrHeadsetBrowser,
  probeVrHeadsetWebXr,
} from "../xr/vr-browser.js?v=20260907-desk-boot-acctovl1-acctui1";

const WELCOME_SEEN_KEY = "render3d:welcomeSeen:v1";
const SPOTLIGHT_SEEN_KEY = "render3d:vrEnterSpotlightSeen:v1";
const SPOTLIGHT_SESSION_KEY = "render3d:vrEnterSpotlightSession:v1";

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

function walkthroughQueued() {
  try {
    return sessionStorage.getItem("render3d:bootWalkthroughQueued:v1") === "1"
      || new URLSearchParams(window.location.search).has("showMe");
  } catch {
    return new URLSearchParams(window.location.search).has("showMe");
  }
}

function hideHeadsetLoadPopups() {
  document.getElementById("welcome-modal")?.classList.add("hidden");
  document.getElementById("ai-setup-intro-modal")?.classList.add("hidden");
  document.getElementById("trial-credits-modal")?.classList.add("hidden");
  const spotlight = document.getElementById("vr-enter-spotlight");
  spotlight?.classList.add("hidden");
  spotlight?.setAttribute("aria-hidden", "true");
  document.documentElement.classList.remove("vr-enter-spotlight-on");
  document.body?.classList.remove("vr-enter-spotlight-on");
  document.getElementById("btn-xr-vr")?.classList.remove("vr-enter-spotlight-target");
  storageSet(WELCOME_SEEN_KEY, "1");
  storageSet(SPOTLIGHT_SEEN_KEY, "1");
  try {
    sessionStorage.setItem(SPOTLIGHT_SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
}

function shouldShowWelcome() {
  if (isVrHeadsetBrowser()) return false;
  if (storageGet(WELCOME_SEEN_KEY) === "1") return false;
  if (walkthroughQueued()) return false;
  return true;
}

function openCreateAccount() {
  document.getElementById("welcome-modal")?.classList.add("hidden");
  storageSet(WELCOME_SEEN_KEY, "1");
  const authBtn = document.getElementById("btn-auth");
  if (authBtn && !authBtn.classList.contains("signed-in")) {
    authBtn.click();
  }
  requestAnimationFrame(() => {
    document.querySelector("#auth-modal .auth-tab[data-tab='register']")?.click();
    document.getElementById("register-name")?.focus();
  });
}

function bindPointerClose(el, handler) {
  if (!el) return;
  el.addEventListener("click", handler);
  el.addEventListener("pointerup", (event) => {
    if (event.pointerType === "mouse") return;
    event.preventDefault();
    handler(event);
  });
}

function openWelcomeModal(modal) {
  if (isVrHeadsetBrowser()) {
    hideHeadsetLoadPopups();
    return;
  }
  if (!modal || !shouldShowWelcome()) return;
  modal.classList.remove("hidden");
  document.getElementById("welcome-create-account")?.focus();
}

function initWelcomeModal() {
  applyVrHeadsetClass();
  void probeVrHeadsetWebXr().then(() => {
    if (isVrHeadsetBrowser()) hideHeadsetLoadPopups();
  });

  const modal = document.getElementById("welcome-modal");
  if (!modal) return;
  const dontShow = document.getElementById("welcome-dont-show");

  if (isVrHeadsetBrowser()) {
    hideHeadsetLoadPopups();
  }

  const close = ({ remember = true } = {}) => {
    modal.classList.add("hidden");
    if (remember || dontShow?.checked) storageSet(WELCOME_SEEN_KEY, "1");
  };

  modal.querySelectorAll("[data-welcome-close]").forEach((el) => {
    bindPointerClose(el, () => close({ remember: true }));
  });
  modal.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => close({ remember: true }));
  });
  document.getElementById("welcome-create-account")?.addEventListener("click", openCreateAccount);
  document.getElementById("welcome-logo-signup")?.addEventListener("click", openCreateAccount);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) close({ remember: true });
  });

  const wait = typeof window.__whenStudioReady === "function"
    ? window.__whenStudioReady
    : (cb) => window.setTimeout(cb, 800);
  wait(() => {
    if (document.body.classList.contains("studio-suggest-open")) {
      window.addEventListener("render3d:suggest-closed", () => openWelcomeModal(modal), { once: true });
      return;
    }
    openWelcomeModal(modal);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initWelcomeModal);
} else {
  initWelcomeModal();
}
