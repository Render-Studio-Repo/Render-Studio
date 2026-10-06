/**
 * First-time AI key picker tip: recommend strong CAD models,
 * warn that GPT-5.5 is weak for modeling.
 */

const LS_KEY = "render3d:modelPickRecommendSeen:v2";
const MODAL_ID = "model-pick-recommend-modal";

function storageKey(userId) {
  return userId ? `${LS_KEY}:${userId}` : LS_KEY;
}

function $(id) {
  return document.getElementById(id);
}

function hasSeen(userId) {
  try {
    if (localStorage.getItem(LS_KEY) === "1") return true;
    if (userId && localStorage.getItem(storageKey(userId)) === "1") return true;
    return false;
  } catch {
    return false;
  }
}

function markSeen(userId) {
  try {
    // Write both keys so a pre-login dismiss still sticks after auth.
    localStorage.setItem(LS_KEY, "1");
    if (userId) localStorage.setItem(storageKey(userId), "1");
  } catch {
    /* ignore */
  }
}

export function closeModelPickRecommend({ remember = false, getUserId = null } = {}) {
  const modal = $(MODAL_ID);
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  if (remember) {
    const userId = typeof getUserId === "function" ? getUserId() : null;
    markSeen(userId);
  }
}

export function openModelPickRecommend({ force = false, getUserId = null } = {}) {
  const modal = $(MODAL_ID);
  if (!modal) return false;
  const userId = typeof getUserId === "function" ? getUserId() : null;
  if (!force && hasSeen(userId)) return false;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  requestAnimationFrame(() => {
    modal.querySelector("[data-model-pick-got-it]")?.focus();
  });
  return true;
}

export function maybeShowModelPickRecommend(opts = {}) {
  return openModelPickRecommend({ ...opts, force: false });
}

let bound = false;

export function bindModelPickRecommend(opts = {}) {
  if (bound) return;
  bound = true;
  const modal = $(MODAL_ID);
  if (!modal) return;

  const closeOpts = () => ({
    getUserId: opts.getUserId,
  });

  // Backdrop / X / Esc — dismiss this time only.
  modal.querySelectorAll("[data-model-pick-close]").forEach((el) => {
    el.addEventListener("click", () => closeModelPickRecommend({ ...closeOpts(), remember: false }));
  });
  // Acknowledge and continue — also stop showing the tip.
  modal.querySelector("[data-model-pick-got-it]")?.addEventListener("click", () => {
    closeModelPickRecommend({ ...closeOpts(), remember: true });
  });
  // Explicit permanent dismiss.
  modal.querySelector("[data-model-pick-dont-show]")?.addEventListener("click", () => {
    closeModelPickRecommend({ ...closeOpts(), remember: true });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (modal.classList.contains("hidden")) return;
    closeModelPickRecommend({ ...closeOpts(), remember: false });
  });
}
