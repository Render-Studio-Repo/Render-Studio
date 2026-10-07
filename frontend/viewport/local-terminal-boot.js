/**
 * Always-on Terminal · local boot. Cached app.js still imported
 * local-terminal.js?v=…visersame1 which called showRemoteMessage on cloud.
 * This module (termbridge1) intercepts the ribbon and kills that Mini card.
 */

import { mountLocalTerminal } from "./local-terminal.js?v=termbridge1";

export const MINI_ONLY_DEAD_CARD =
  "Local terminal is only available when Render Studio is running on this computer.";

function termBtn(el) {
  return el?.closest?.(
    '[data-robotics-action="local-terminal"], .ribbon-btn--local-terminal, [data-id="local_terminal"]',
  );
}

function bind() {
  const viewport = typeof document !== "undefined" ? document.getElementById("viewport") : null;
  if (!viewport) return null;
  return mountLocalTerminal({
    viewport,
    getProjectId: () => "",
    getToken: () => "",
    isXrPresenting: () => document.body.classList.contains("xr-presenting"),
  });
}

let ui = null;

export function ensureLocalTerminalUi() {
  if (!ui) ui = bind();
  return ui;
}

export function scrubMiniOnlyDeadCard(root = typeof document !== "undefined" ? document : null) {
  if (!root) return 0;
  let n = 0;
  const cards = root.querySelectorAll?.(".local-terminal-permit, .local-terminal-panel");
  if (!cards) return 0;
  for (const card of cards) {
    const text = String(card.textContent || "");
    if (!text.includes(MINI_ONLY_DEAD_CARD)) continue;
    if (card.classList.contains("local-terminal-panel--bridge")) continue;
    card.remove();
    n += 1;
  }
  return n;
}

function onClick(e) {
  if (!termBtn(e.target)) return;
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
  const api = ensureLocalTerminalUi();
  api?.open?.() || api?.toggle?.();
}

if (typeof document !== "undefined") {
  document.addEventListener("click", onClick, true);
  const start = () => {
    ensureLocalTerminalUi();
    scrubMiniOnlyDeadCard();
    try {
      new MutationObserver(() => {
        if (scrubMiniOnlyDeadCard() && !ui?.isOpen?.()) ui?.open?.();
      }).observe(document.documentElement, { childList: true, subtree: true });
    } catch {
      /* ignore */
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
}
