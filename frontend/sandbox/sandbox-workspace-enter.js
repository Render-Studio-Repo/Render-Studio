/** Enter sandbox workspace + Super IDE editor. Token sbws1. One WebGL. */

import { adoptLive } from "./sandbox-live-instances.js?v=sblive1&teleop-y=20260922-poseconnect1&dimos-viser-local1&vrrobot=20260927-2";
import { workspaceEnabledPanes, SBDBG1_TOKEN } from "./sandbox-layout.js?v=sbdbg1";

export const SBWS1_TOKEN = "sbws1";
export const LS_SHELL = "render3d.sandbox.shell";

const parked = new Map();

function docOf(root) {
  return root?.ownerDocument || root || globalThis.document || null;
}

export function isWorkspaceOpen(root = globalThis.document) {
  const d = docOf(root);
  return !!(d?.documentElement?.classList?.contains("is-workspace") || d?.body?.classList?.contains("is-workspace"));
}

function setOpen(d, on) {
  d?.documentElement?.classList?.toggle("is-workspace", on);
  d?.body?.classList?.toggle("is-workspace", on);
  const shell = d?.getElementById?.("sb-workspace-shell");
  if (shell) shell.hidden = !on;
  const grid = d?.querySelector?.(".sb-dbg-grid");
  if (grid) grid.hidden = on;
  try { d?.defaultView?.localStorage?.setItem?.(LS_SHELL, on ? "workspace" : "debugger"); } catch { /* private */ }
}

function dockWorkspacePanes(d) {
  const host = d?.querySelector?.("[data-workspace-docks]");
  if (!host) return;
  const keep = new Set(["viewport"]);
  for (const pane of workspaceEnabledPanes()) {
    if (keep.has(pane.id)) continue;
    const el = d.querySelector(`[data-pane="${pane.id}"]`);
    if (!el) continue;
    if (!parked.has(pane.id)) parked.set(pane.id, { parent: el.parentNode, next: el.nextSibling });
    host.appendChild(el);
    el.hidden = false;
  }
}

function restorePanes(d) {
  for (const [id, slot] of parked) {
    const el = d.querySelector(`[data-pane="${id}"]`);
    if (!el || !slot?.parent) continue;
    if (slot.next && slot.next.parentNode === slot.parent) slot.parent.insertBefore(el, slot.next);
    else slot.parent.appendChild(el);
  }
  parked.clear();
}

export function focusWorkspaceEditor(root = globalThis.document) {
  const d = docOf(root);
  const ide = d?.getElementById?.("sb-super-ide");
  if (ide) {
    ide.dataset.layout = ide.dataset.layout || "split-left";
    ide.scrollIntoView?.({ block: "start" });
  }
  d?.querySelector?.('[data-sb-tab="se"][data-tab="projects"]')?.click?.();
  d?.querySelector?.("[data-sb-ide-editor]")?.focus?.();
  return { token: SBWS1_TOKEN, editor: true };
}

export function enterSandboxWorkspace(root = globalThis.document, { editor = false, onStatus } = {}) {
  const d = docOf(root);
  if (!d) return { ok: false, reason: "no-dom" };
  setOpen(d, true);
  dockWorkspacePanes(d);
  const nw = d.getElementById("sb-office") || d.querySelector("#sb-super-ide [data-sb-live-slot='viewport']");
  if (nw) adoptLive("viewport", nw, { live: true });
  if (editor) focusWorkspaceEditor(d);
  const docks = workspaceEnabledPanes().map((p) => p.id);
  onStatus?.(`Workspace · editor ${editor ? "on" : "ready"} · panes ${docks.join(",")}`);
  const enterBtn = d.querySelector("[data-sb-enter-workspace]");
  if (enterBtn) {
    enterBtn.setAttribute("aria-pressed", "true");
    enterBtn.textContent = "Exit workspace";
  }
  d.querySelector("[data-sb-open-editor]")?.setAttribute("aria-pressed", editor ? "true" : "false");
  return { ok: true, token: SBWS1_TOKEN, layout: SBDBG1_TOKEN, editor, docks };
}

export function exitSandboxWorkspace(root = globalThis.document, { onStatus } = {}) {
  const d = docOf(root);
  if (!d) return { ok: false };
  const slot = d.getElementById("sb-collab-viewport") || d.querySelector("[data-sb-live-slot='viewport']");
  if (slot) adoptLive("viewport", slot, { live: true });
  restorePanes(d);
  setOpen(d, false);
  const enterBtn = d.querySelector("[data-sb-enter-workspace]");
  if (enterBtn) {
    enterBtn.setAttribute("aria-pressed", "false");
    enterBtn.textContent = "Enter workspace";
  }
  d.querySelector("[data-sb-open-editor]")?.setAttribute("aria-pressed", "false");
  onStatus?.("Debugger viewport");
  return { ok: true, token: SBWS1_TOKEN, open: false };
}

export function toggleSandboxWorkspace(root = globalThis.document, opts = {}) {
  return isWorkspaceOpen(root) ? exitSandboxWorkspace(root, opts) : enterSandboxWorkspace(root, opts);
}
