/**
 * Show the generation loader on the first Generate click (capture phase),
 * before async convert/spice/ensureProject work. Pairs with viewer-overlay
 * pendingHoldUntil so polls cannot tear the banner down mid-submit.
 */
const GENERATE_SELECTORS = "#btn-prompt, #btn-wiring-prompt, #btn-wiring-toolbelt-generate";

function flashLoader(message = "Preparing generation…") {
  const api = window.Render StudioViewerOverlay;
  if (!api?.setGenerating) return;
  api.clearError?.();
  api.setGenerating(true, message, { pendingStart: true, kind: "prompt" });
}

document.addEventListener(
  "click",
  (event) => {
    const btn = event.target?.closest?.(GENERATE_SELECTORS);
    if (!btn || btn.disabled) return;
    flashLoader("Preparing generation…");
  },
  true
);

document.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    const prompt = document.getElementById("prompt-input");
    if (!prompt || document.activeElement !== prompt) return;
    // Composer may submit on Enter — flash loader the same way.
    flashLoader("Preparing generation…");
  },
  true
);
