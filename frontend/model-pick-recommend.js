/**
 * First-time AI key picker tip: recommend strong CAD models,
 * warn that GPT-5.5 is weak for modeling.
 */

const LS_KEY = "render3d:modelPickRecommendSeen:v1";
const MODAL_ID = "model-pick-recommend-modal";

function storageKey(userId) {
  return userId ? `${LS_KEY}:${userId}` : LS_KEY;
}

function $(id) {
  return document.getElementById(id);
}

function hasSeen(userId) {
  try {
    return localStorage.getItem(storageKey(userId)) === "1";
  } catch {
    return false;
  }
}

function markSeen(userId) {
  try {
    localStorage.setItem(storageKey(userId), "1");
  } catch {
    /* ignore */
  }
}

export function closeModelPickRecommend({ remember = true, getUserId = null } = {}) {
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

  modal.querySelectorAll("[data-model-pick-close]").forEach((el) => {
    el.addEventListener("click", () => closeModelPickRecommend(opts));
  });
  modal.querySelector("[data-model-pick-got-it]")?.addEventListener("click", () => {
    closeModelPickRecommend(opts);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (modal.classList.contains("hidden")) return;
    closeModelPickRecommend(opts);
  });
}
