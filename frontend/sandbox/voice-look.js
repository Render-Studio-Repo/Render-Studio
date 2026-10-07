/** Voice agent reads the monitor and looks at what to edit. Token voicelook1. */

import { speak, listenOnce } from "./voice.js?v=tokstat1-astravoice1-cfgov1&singlevoice1";

export const VOICELOOK1_TOKEN = "voicelook1";

export function readMonitor(root = document) {
  const title = root.querySelector?.("#sb-title")?.textContent || root.title || "Sandbox debugger";
  const path = root.querySelector?.("[data-sb-ide-path]")?.value || "";
  const status = root.querySelector?.("[data-sb-ide-status]")?.textContent
    || root.querySelector?.("[data-collab-status]")?.textContent
    || "";
  const bench = root.querySelector?.("[data-bench-avg]")?.textContent || "";
  const look = root.querySelector?.("[data-look-file]")?.textContent || path;
  const lines = [
    `Monitor: ${String(title).slice(0, 80)}`,
    look ? `Looking at ${look}` : "No file in the live IDE yet",
    status ? `IDE: ${status}` : "",
    bench ? `Bench ${bench}` : "",
  ].filter(Boolean);
  return { token: VOICELOOK1_TOKEN, text: lines.join(". "), look, path, status };
}

export async function speakMonitor({ agentId = "astra", root = document } = {}) {
  const snap = readMonitor(root);
  await speak(agentId, snap.text);
  return snap;
}

export async function listenAndLook({ onLook } = {}) {
  const heard = await listenOnce();
  const want = String(heard || "").trim();
  onLook?.(want);
  return { heard: want, token: VOICELOOK1_TOKEN };
}
