import { authHeaders } from "../studio/auth.js";
import { getSlicerById, slicerOpenUrls, canOpenRemoteSlicerUrl } from "./slicer-prefs.js?v=20260929-device-handoff1";

export const SLICER_HANDOFF_CLIENT_KEY = "render3d:xr-client-id:v1";
export const SLICER_HANDOFF_TTL_MS = 10 * 60 * 1000;

let fallbackClientId = "";
let listenerStarted = false;
let pollTimer = null;
let activeRequestId = "";

export function slicerHandoffClientId(storage = globalThis.localStorage) {
  try {
    let id = storage?.getItem?.(SLICER_HANDOFF_CLIENT_KEY) || "";
    if (!id) {
      id = `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      storage?.setItem?.(SLICER_HANDOFF_CLIENT_KEY, id);
    }
    return id;
  } catch {
    if (!fallbackClientId) fallbackClientId = `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    return fallbackClientId;
  }
}

export function detectSlicerHandoffOs(navigatorLike = globalThis.navigator) {
  const ua = String(navigatorLike?.userAgent || "");
  const platform = String(navigatorLike?.platform || "");
  if (/Mac|iPhone|iPad|iPod/i.test(ua) || /Mac/i.test(platform)) return "macos";
  if (/Win/i.test(ua) || /Win/i.test(platform)) return "windows";
  if (/Linux|X11|CrOS/i.test(ua)) return "linux";
  return "windows";
}

export function shouldOfferSlicerHandoff(request, {
  clientId,
  now = Date.now(),
  userAgent = globalThis.navigator?.userAgent || "",
} = {}) {
  if (!request || typeof request !== "object") return false;
  if (!request.id || !request.file_url || !request.slicer_id) return false;
  if (request.source_client_id && request.source_client_id === clientId) return false;
  if (/Android|iPhone|iPad|iPod|Quest|Oculus|Mobile VR/i.test(String(userAgent))) return false;
  const age = now - Number(request.at || 0);
  return Number.isFinite(age) && age >= 0 && age <= SLICER_HANDOFF_TTL_MS;
}

export function shouldPollSlicerHandoff({ visibilityState = globalThis.document?.visibilityState } = {}) {
  return visibilityState !== "prerender";
}

export async function requestSlicerOnPersonalLaptop({ slicerId, fileUrl, filename }, fetchImpl = fetch) {
  const artifactUrl = new URL(fileUrl);
  if (!/^https?:$/.test(artifactUrl.protocol)) throw new Error("Invalid public 3MF URL");
  const controlUrl = `${artifactUrl.origin}/api/xr-agent/open-slicer`;
  const response = await fetchImpl(controlUrl, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      slicer_id: slicerId,
      file_url: fileUrl,
      filename,
      source_client_id: slicerHandoffClientId(),
    }),
  });
  if (!response.ok) throw new Error(`Could not reach the other signed-in device (${response.status})`);
  return response.json();
}

async function acknowledgeRequest(id) {
  if (!id) return;
  try {
    await fetch(`/api/xr-agent/slicer-request/${encodeURIComponent(id)}/ack`, {
      method: "POST",
      headers: authHeaders(),
    });
  } catch {
    /* The local handled ID still prevents a prompt loop while offline. */
  }
}

function launchProtocol(url) {
  if (!url) return;
  window.location.href = url;
}

function downloadOnThisLaptop(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename || "model.3mf";
  link.rel = "noopener";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function ensurePromptStyles() {
  if (document.getElementById("slicer-device-handoff-styles")) return;
  const style = document.createElement("style");
  style.id = "slicer-device-handoff-styles";
  style.textContent = `
    .slicer-device-handoff{position:fixed;right:18px;bottom:18px;z-index:10050;width:min(390px,calc(100vw - 36px));padding:16px;border:1px solid #3b4654;border-radius:12px;background:#111820;color:#f3f6f8;box-shadow:0 18px 48px rgba(0,0,0,.48);font:14px/1.4 system-ui,sans-serif}
    .slicer-device-handoff h2{margin:0 28px 5px 0;font-size:16px}.slicer-device-handoff p{margin:5px 0;color:#aeb9c5}.slicer-device-handoff strong{color:#fff}.slicer-device-handoff-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px}.slicer-device-handoff button{border:1px solid #465363;border-radius:7px;padding:8px 11px;background:#1c2631;color:#eef3f7;cursor:pointer}.slicer-device-handoff button[data-open]{border-color:#00aeef;background:#006f99;color:#fff}.slicer-device-handoff button[data-dismiss]{position:absolute;right:9px;top:8px;border:0;background:transparent;font-size:20px;padding:2px 7px}
  `;
  document.head.appendChild(style);
}

function showLaptopPrompt(request) {
  if (activeRequestId === request.id || document.querySelector(`[data-slicer-handoff-id="${CSS.escape(request.id)}"]`)) return;
  const slicer = getSlicerById(request.slicer_id);
  if (!slicer) return;
  const urls = slicerOpenUrls(slicer, request.file_url);
  const os = detectSlicerHandoffOs();
  if (!canOpenRemoteSlicerUrl(slicer, os, urls)) return;
  const openUrl = (os === "macos" ? urls.macosEncoded : urls[`${os}Encoded`]) || urls[os] || urls.windows || urls.macos;
  ensurePromptStyles();
  document.querySelector(".slicer-device-handoff")?.remove();
  const prompt = document.createElement("section");
  prompt.className = "slicer-device-handoff";
  prompt.dataset.slicerHandoffId = request.id;
  prompt.setAttribute("role", "dialog");
  prompt.setAttribute("aria-live", "assertive");
  prompt.setAttribute("aria-label", `Open in ${slicer.name}`);
  const safeFilename = String(request.filename || "model.3mf").split(/[\\/]/).pop() || "model.3mf";
  const title = document.createElement("h2");
  title.textContent = `Open in ${slicer.name} on this device?`;
  const body = document.createElement("p");
  body.append("Render Studio sent ");
  const strong = document.createElement("strong");
  strong.textContent = safeFilename;
  body.append(strong, " from your other signed-in device.");
  const actions = document.createElement("div");
  actions.className = "slicer-device-handoff-actions";
  const open = document.createElement("button");
  open.type = "button";
  open.dataset.open = "1";
  open.textContent = `Import in ${slicer.shortName}`;
  const download = document.createElement("button");
  download.type = "button";
  download.dataset.download = "1";
  download.textContent = "Download 3MF";
  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.dataset.dismiss = "1";
  dismiss.setAttribute("aria-label", "Dismiss slicer import request");
  dismiss.textContent = "×";
  actions.append(open, download);
  prompt.append(title, body, actions, dismiss);
  activeRequestId = request.id;
  const finish = () => {
    activeRequestId = "";
    prompt.remove();
    void acknowledgeRequest(request.id);
  };
  open.addEventListener("click", () => { launchProtocol(openUrl); finish(); });
  download.addEventListener("click", () => { downloadOnThisLaptop(request.file_url, safeFilename); finish(); });
  dismiss.addEventListener("click", finish);
  document.body.appendChild(prompt);
}

async function pollSlicerRequest() {
  // Cookie-restored device sessions may be authenticated without a bearer token
  // in localStorage. Let the server session decide whether this poll is signed in.
  if (!shouldPollSlicerHandoff()) return;
  try {
    const response = await fetch("/api/xr-agent/state", { headers: authHeaders(), cache: "no-store" });
    if (!response.ok) return;
    const state = await response.json();
    const request = state?.slicerRequest;
    if (shouldOfferSlicerHandoff(request, { clientId: slicerHandoffClientId() })) showLaptopPrompt(request);
  } catch {
    /* A disconnected device will retry when Studio is visible again. */
  }
}

export function startSlicerDeviceHandoffListener({ intervalMs = 3000 } = {}) {
  if (listenerStarted || typeof window === "undefined" || typeof document === "undefined") return;
  listenerStarted = true;
  void pollSlicerRequest();
  pollTimer = window.setInterval(pollSlicerRequest, intervalMs);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void pollSlicerRequest();
  });
  window.addEventListener("focus", () => { void pollSlicerRequest(); });
  window.addEventListener("pageshow", () => { void pollSlicerRequest(); });
  window.addEventListener("online", () => { void pollSlicerRequest(); });
}

export function stopSlicerDeviceHandoffListener() {
  if (pollTimer != null) window.clearInterval(pollTimer);
  pollTimer = null;
  listenerStarted = false;
}
