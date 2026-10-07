import { roboticsOwnsExternalSession, roboticsLaunchUrl, roboticsIntegratedProfile } from "../xr/robotics-profile.js?v=roboticsworkspace3&dimos-viser-local1";
/**
 * In-viewport Teleop tab: same-origin HTTPS proxy of DIMOS /teleop.
 * Persist LAN URLs with robotics prefs; auto-click Connect in Quest Browser.
 */

import { hostnameOf, isCloudStudioOrigin, isLoopbackHost, isPrivateLanHost } from "../xr/xr-dimos-lan.js?v=20260909-dimosui1-20260914-lanpc1-20260914-visersame1-20260914-teleop2-20260915-dimosvr1-20260915-dimosy1";
import { isSamCameraAccount, studioUserId } from "../xr/xr-hand-cams.js?v=roboticsworkspace3";

export const TELEOP_STORAGE_KEY = "render3d:teleopPrefs";
export const TELEOP_DEFAULT_URL = "https://127.0.0.1:8443/teleop";
export const TELEOP_DEFAULT_PORT = "8443";
export const SAM_TELEOP_EXAMPLE = "https://192.168.1.77:8443/teleop";
export const TELEOP_TAB_ID = "teleop:open";
export const TELEOP_DRAFT_DEBOUNCE_MS = 400;
export const TELEOP_URL_FIELD_SEL = "[data-teleop-url], [data-teleop-ribbon-url], [data-robotics-teleop-url], [data-ip-teleop], #pref-teleop-url";
export const ROBOTICS_PREFS_EVENT = "render3d:robotics-prefs";
export const ROBOTICS_DOCS_HREF = "/getting-started.html#robotics-configuration-20260915-xrdispatch4";

const LAYOUT_LISTENERS = new Set();

function storage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function teleopPrefsKey(user = null, projectId = "") {
  const base = `${TELEOP_STORAGE_KEY}:${studioUserId(user)}`;
  const pid = String(projectId || "").trim();
  return pid ? `${base}:project:${pid}` : base;
}

export function normalizeTeleopUrl(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  let candidate = s;
  if (/^ws:\/\//i.test(candidate)) candidate = `https://${candidate.slice(5)}`;
  else if (/^wss:\/\//i.test(candidate)) candidate = `https://${candidate.slice(6)}`;
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    candidate = `https://${candidate.replace(/^\[|\]$/g, "")}`;
  }
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    const host = String(u.hostname || "").toLowerCase();
    if (!isPrivateLanHost(host) && !isLoopbackHost(host)) return "";
    if (host === "169.254.169.254") return "";
    const port = u.port || TELEOP_DEFAULT_PORT;
    u.protocol = "https:";
    u.port = port;
    if (!u.pathname || u.pathname === "/" || u.pathname.replace(/\/$/, "") === "/ws") {
      u.pathname = "/teleop";
    }
    return u.toString();
  } catch {
    return "";
  }
}

export function defaultTeleopUrlsForUser(user = null) {
  if (isSamCameraAccount(user)) return [SAM_TELEOP_EXAMPLE, TELEOP_DEFAULT_URL];
  return [TELEOP_DEFAULT_URL];
}

export function teleopUnreachableMessage(url) {
  const target = normalizeTeleopUrl(url) || String(url || "").trim() || TELEOP_DEFAULT_URL;
  let host = "";
  try { host = new URL(target).hostname; } catch { host = ""; }
  if (isLoopbackHost(host)) {
    return (
      `Can't reach Teleop at ${target}. 127.0.0.1 is this computer, not the Pi. ` +
      `127.0.0.1 is this computer, not the Pi. Use https://192.168.1.77:8443/teleop. Quest on this Wi-Fi opens that host directly.`
    );
  }
  return `Can't reach Teleop at ${target}. Bind DIMOS on 0.0.0.0:8443 (HTTPS) or enter a LAN address.`;
}

export function shouldLoadTeleopIframe(payload = {}) {
  const error = String(payload?.error || payload?.detail || "");
  if (/cloud studio cannot reach/i.test(error)) return false;
  if (/teleop url must be/i.test(error)) return false;
  return true;
}

function parseTeleopPrefs(raw, seeded) {
  const fallback = {
    urls: seeded,
    active: seeded[0] || TELEOP_DEFAULT_URL,
    draft: "",
  };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    const urls = Array.isArray(parsed?.urls)
      ? parsed.urls.map(normalizeTeleopUrl).filter(Boolean)
      : [];
    const merged = [...new Set([...urls, ...seeded])];
    const active = normalizeTeleopUrl(parsed?.active) || merged[0] || TELEOP_DEFAULT_URL;
    return {
      urls: merged,
      active,
      draft: parsed?.draft != null ? String(parsed.draft) : "",
    };
  } catch {
    return fallback;
  }
}

export function readTeleopPrefs(user = null, projectId = "") {
  const seeded = defaultTeleopUrlsForUser(user);
  try {
    const projectRaw = projectId ? storage()?.getItem(teleopPrefsKey(user, projectId)) : null;
    if (projectRaw) return parseTeleopPrefs(projectRaw, seeded);
    const userRaw = storage()?.getItem(teleopPrefsKey(user));
    return parseTeleopPrefs(userRaw, seeded);
  } catch {
    return parseTeleopPrefs(null, seeded);
  }
}

export function persistTeleopPrefs(partial = {}, user = null, projectId = "") {
  const prev = readTeleopPrefs(user, projectId);
  const urls = Array.isArray(partial.urls)
    ? partial.urls.map(normalizeTeleopUrl).filter(Boolean)
    : prev.urls;
  const unique = [...new Set(urls.length ? urls : defaultTeleopUrlsForUser(user))];
  const active = normalizeTeleopUrl(partial.active != null ? partial.active : prev.active) || unique[0] || TELEOP_DEFAULT_URL;
  const next = {
    urls: unique,
    active,
    draft: partial.draft != null ? String(partial.draft) : (prev.draft ?? ""),
  };
  try {
    const json = JSON.stringify(next);
    storage()?.setItem(teleopPrefsKey(user), json);
    if (projectId) storage()?.setItem(teleopPrefsKey(user, projectId), json);
  } catch { /* ignore */ }
  try {
    void import("../xr/xr-dimos-teleop.js?v=20260929-y-record1").then((m) => {
      m.persistDimosWsUrl?.(next.active);
    }).catch(() => {});
  } catch { /* ignore */ }
  LAYOUT_LISTENERS.forEach((fn) => {
    try { fn(next); } catch { /* ignore */ }
  });
  emitRoboticsPrefs({ teleopUrls: next.urls, teleopActive: next.active });
  return next;
}

export function addTeleopUrl(raw, user = null, projectId = "") {
  const url = normalizeTeleopUrl(raw);
  if (!url) return persistTeleopDraft(raw, user, projectId);
  const prev = readTeleopPrefs(user, projectId);
  return persistTeleopPrefs({
    urls: [...prev.urls, url],
    active: url,
    draft: String(raw ?? url),
  }, user, projectId);
}

export function persistTeleopDraft(raw, user = null, projectId = "") {
  const draft = String(raw ?? "");
  const url = normalizeTeleopUrl(draft);
  const prev = readTeleopPrefs(user, projectId);
  if (url) {
    return persistTeleopPrefs({
      urls: [...prev.urls, url],
      active: url,
      draft,
    }, user, projectId);
  }
  return persistTeleopPrefs({ draft }, user, projectId);
}

export function displayTeleopUrl(prefs = null, fallback = TELEOP_DEFAULT_URL) {
  const draft = String(prefs?.draft || "");
  if (draft) return draft;
  return prefs?.active || fallback;
}

export function teleopProxySrc(url) {
  const normalized = normalizeTeleopUrl(url);
  if (!normalized) return "";
  const u = new URL(normalized);
  const host = hostnameOf(u.hostname);
  const port = u.port || TELEOP_DEFAULT_PORT;
  const path = `${u.pathname || "/teleop"}${u.search || ""}`;
  const joined = path.startsWith("/") ? path : `/${path}`;
  return `/api/teleop/p/${encodeURIComponent(host)}/${encodeURIComponent(port)}${joined}`;
}

/** Cloud origin is not teleop transport. Quest on Wi-Fi opens the Pi directly. */
export function teleopIframeSrc(raw, loc = globalThis.location) {
  if (isCloudStudioOrigin(loc)) return "";
  return teleopProxySrc(raw);
}

export function isQuestBrowser(doc = typeof document !== "undefined" ? document : null, nav = typeof navigator !== "undefined" ? navigator : null) {
  try {
    if (doc?.documentElement?.classList?.contains("vr-headset-browser")) return true;
  } catch { /* ignore */ }
  const ua = String(nav?.userAgent || "");
  return /OculusBrowser|Quest|PicoBrowser|Helio/i.test(ua);
}

export function emitRoboticsPrefs(detail = {}) {
  try {
    window.dispatchEvent(new CustomEvent(ROBOTICS_PREFS_EVENT, { detail }));
  } catch { /* ignore */ }
}

export function applyRemoteTeleopPrefs(payload = {}, user = null, projectId = "") {
  const urls = Array.isArray(payload?.teleopUrls) ? payload.teleopUrls : null;
  const active = payload?.teleopActive;
  if (!urls && !active) return readTeleopPrefs(user, projectId);
  return persistTeleopPrefs({
    urls: urls || undefined,
    active: active || undefined,
  }, user, projectId);
}

function clickConnectInDoc(doc) {
  if (!doc) return false;
  const nodes = [...(doc.querySelectorAll?.("button, a, input[type=button], input[type=submit], [role=button]") || [])];
  for (const el of nodes) {
    const t = String(el.textContent || el.value || el.getAttribute?.("aria-label") || "").replace(/\s+/g, " ").trim();
    if (!/connect/i.test(t)) continue;
    if (el.disabled) continue;
    try { el.click(); return true; } catch { /* ignore */ }
  }
  return false;
}

export function autoClickTeleopConnect(iframe, { quest = null } = {}) {
  if (roboticsIntegratedProfile()) return false;
  const inQuest = quest == null ? isQuestBrowser() : !!quest;
  if (!inQuest || !iframe) return false;
  let clicked = false;
  try {
    clicked = clickConnectInDoc(iframe.contentDocument);
  } catch { /* cross-origin */ }
  try {
    iframe.contentWindow?.postMessage({ type: "studio-teleop-autoconnect" }, "*");
  } catch { /* ignore */ }
  return clicked;
}

export function createTeleopViewer({
  viewerEl,
  docTabs,
  getUser,
  getProjectId,
  apiFn,
  onStatus,
} = {}) {
  function currentUser() {
    try { return getUser?.() || null; } catch { return null; }
  }

  function projectId() {
    try { return String(getProjectId?.() || "").trim(); } catch { return ""; }
  }

  function mainCol() {
    return document.querySelector(".main-column");
  }

  function frame() {
    return viewerEl?.querySelector("[data-teleop-frame]") || null;
  }

  function urlInputs() {
    return [...(document.querySelectorAll?.(TELEOP_URL_FIELD_SEL) || [])];
  }

  function input() {
    const focused = urlInputs().find((el) => el === document.activeElement);
    return focused || urlInputs()[0] || null;
  }

  function emptyEl() {
    return viewerEl?.querySelector("[data-teleop-empty]") || null;
  }

  function setEmpty(message) {
    const el = emptyEl();
    const msg = el?.querySelector("[data-teleop-empty-msg]");
    const show = !!message;
    if (msg && message) msg.textContent = message;
    el?.classList.toggle("hidden", !show);
    if (el) {
      el.hidden = !show;
      el.setAttribute("aria-hidden", show ? "false" : "true");
    }
    viewerEl?.classList.toggle("teleop-has-empty", show);
  }

  function syncList() {
    const prefs = readTeleopPrefs(currentUser(), projectId());
    urlInputs().forEach((field) => {
      if (field && document.activeElement !== field) field.value = displayTeleopUrl(prefs);
    });
    const hint = viewerEl?.querySelector("[data-teleop-proxy]");
    if (hint) hint.textContent = teleopProxySrc(prefs.active) || "/api/teleop/p/…";
    return prefs;
  }

  function revealPanel() {
    const prefs = readTeleopPrefs(currentUser(), projectId());
    docTabs?.upsert({ id: TELEOP_TAB_ID, label: "Teleop", kind: "teleop" });
    docTabs?.setActive(TELEOP_TAB_ID);
    const col = mainCol();
    col?.classList.add("teleop-layout-teleop");
    col?.classList.remove("viser-layout-split", "viser-layout-viser", "viser-layout-cad");
    viewerEl?.classList.remove("hidden");
    viewerEl?.setAttribute("aria-hidden", "false");
    syncList();
    return prefs;
  }

  let connectLock = false;

  async function connect(raw) {
    if (roboticsIntegratedProfile()) {
      window.dispatchEvent(new CustomEvent("render3d:robotics-enable"));
      onStatus?.("ok", "Robotics enabled inside VR Studio. Enter VR to connect your controllers.");
      return {integrated: true};
    }
    if (roboticsOwnsExternalSession()) {
      window.dispatchEvent(new CustomEvent("render3d:robotics-launch", {detail: {url: roboticsLaunchUrl()}}));
      return {external: true};
    }
    if (connectLock) return null;
    connectLock = true;
    try {
      return await connectNow(raw);
    } finally {
      connectLock = false;
    }
  }

  async function connectNow(raw) {
    const user = currentUser();
    const pid = projectId();
    revealPanel();
    const typed = raw || input()?.value || readTeleopPrefs(user, pid).active || TELEOP_DEFAULT_URL;
    const added = addTeleopUrl(typed, user, pid);
    const url = added.active || normalizeTeleopUrl(typed);
    if (!url) {
      const msg = "Teleop URL must be a private LAN host (192.168 / 10 / 172.16) or localhost.";
      setEmpty(msg);
      onStatus?.("error", msg);
      return null;
    }
    setEmpty(`Connecting to ${url}…`);
    let iframeSrc = teleopIframeSrc(url);
    let reachable = true;
    let errorText = "";
    if (!iframeSrc) {
      setEmpty(`Quest on this Wi-Fi talks to ${url} directly (like cameras). Enable Robotics in VR, then tap Y. Do not iframe through Cloudflare.`);
      onStatus?.("ok", `Teleop · ${url} · Quest→Pi direct. Tap Y in VR to start the arms.`);
      syncList();
      persistRemote();
      return { url, iframeSrc: "", direct: true };
    }
    if (apiFn) {
      try {
        const data = await apiFn("/api/teleop/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        if (data?.iframe) iframeSrc = String(data.iframe);
        if (data?.ok === false) {
          errorText = data?.error || teleopUnreachableMessage(url);
          reachable = shouldLoadTeleopIframe(data);
        }
      } catch (err) {
        errorText = err?.message || teleopUnreachableMessage(url);
        if (!/can't reach teleop|cloud studio cannot reach|private lan/i.test(errorText)) {
          errorText = teleopUnreachableMessage(url);
        }
        reachable = shouldLoadTeleopIframe({ error: errorText, detail: err?.detail });
        if (err?.status === 403 || err?.status === 400) reachable = false;
      }
    }
    const iframe = frame();
    if (!reachable) {
      if (iframe) iframe.src = "about:blank";
      setEmpty(errorText || teleopUnreachableMessage(url));
      syncList();
      persistRemote();
      onStatus?.("error", errorText || teleopUnreachableMessage(url));
      return null;
    }
    if (iframe) {
      iframe.src = iframeSrc;
      iframe.addEventListener("load", () => {
        autoClickTeleopConnect(iframe);
        window.setTimeout(() => autoClickTeleopConnect(iframe), 800);
        window.setTimeout(() => autoClickTeleopConnect(iframe), 2200);
        try {
          const doc = iframe.contentDocument;
          const text = String(doc?.body?.textContent || "");
          if (/can't reach teleop|open teleop from robotics first|cloud studio cannot reach/i.test(text)) {
            setEmpty(teleopUnreachableMessage(url));
          }
        } catch { /* cross-origin */ }
      }, { once: true });
    }
    setEmpty("");
    syncList();
    persistRemote();
    const questNote = isQuestBrowser()
      ? "Quest — auto-clicking Connect"
      : "Desktop Connect may stay grey (Quest Browser WebXR). Proxy still loads the page.";
    onStatus?.("ok", `Teleop · ${url} · ${questNote}`);
    return { url, iframeSrc };
  }

  function hideViewerOnly() {
    viewerEl?.classList.add("hidden");
    viewerEl?.setAttribute("aria-hidden", "true");
    mainCol()?.classList.remove("teleop-layout-teleop");
  }

  function closeTab() {
    const iframe = frame();
    if (iframe) iframe.src = "about:blank";
    hideViewerOnly();
    setEmpty("");
    docTabs?.remove(TELEOP_TAB_ID);
  }

  function activateFromShared() {
    const prefs = revealPanel();
    const iframe = frame();
    if (iframe && (!iframe.src || iframe.src === "about:blank" || iframe.src.endsWith("about:blank")) && prefs.active) {
      void connect(prefs.active);
    }
  }

  function persistRemote() {
    if (!apiFn) return;
    const teleop = readTeleopPrefs(currentUser(), projectId());
    void apiFn("/api/users/me/robotics-prefs", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        teleopUrls: teleop.urls,
        teleopActive: teleop.active,
      }),
    }).catch(() => {});
  }

  function openDocs() {
    try {
      window.open(ROBOTICS_DOCS_HREF, "_blank", "noopener");
    } catch {
      window.location.href = ROBOTICS_DOCS_HREF;
    }
  }

  viewerEl?.addEventListener("click", (e) => {
    if (e.target?.closest?.("[data-teleop-connect]")) {
      void connect(input()?.value || readTeleopPrefs(currentUser(), projectId()).active);
      return;
    }
    if (e.target?.closest?.("[data-teleop-docs]")) {
      openDocs();
    }
  });

  document.addEventListener("keydown", (e) => {
    const urlField = e.target?.closest?.(TELEOP_URL_FIELD_SEL);
    if (urlField && e.key === "Enter") {
      e.preventDefault();
      flushDraftFromTarget(urlField);
      void connect(urlField.value || "");
    }
  });

  let draftTimer = 0;
  let draftRaw = "";

  function commitDraft(raw) {
    persistTeleopDraft(raw, currentUser(), projectId());
    persistRemote();
    syncList();
  }

  function scheduleDraftPersist(raw) {
    draftRaw = raw;
    if (draftTimer) clearTimeout(draftTimer);
    draftTimer = setTimeout(() => {
      draftTimer = 0;
      commitDraft(raw);
    }, TELEOP_DRAFT_DEBOUNCE_MS);
  }

  function flushDraftFromTarget(target) {
    const field = target?.closest?.(TELEOP_URL_FIELD_SEL);
    if (!field) return;
    if (draftTimer) {
      clearTimeout(draftTimer);
      draftTimer = 0;
    }
    commitDraft(field.value);
  }

  document.addEventListener("input", (e) => {
    const field = e.target?.closest?.(TELEOP_URL_FIELD_SEL);
    if (field) scheduleDraftPersist(field.value);
  });
  document.addEventListener("change", (e) => {
    flushDraftFromTarget(e.target);
  });
  window.addEventListener("pagehide", () => {
    if (draftTimer) {
      clearTimeout(draftTimer);
      draftTimer = 0;
      commitDraft(draftRaw);
    }
  });
  window.addEventListener(ROBOTICS_PREFS_EVENT, (e) => {
    const detail = e?.detail || {};
    if (detail.teleopActive || detail.teleopUrls) {
      if (detail._fromRemote) applyRemoteTeleopPrefs(detail, currentUser(), projectId());
      syncList();
    }
  });

  syncList();

  window.addEventListener("render3d:robotics-enable", () => {
    const iframe = frame();
    if (iframe) iframe.src = "about:blank";
    hideViewerOnly();
  });

  return {
    connect,
    open: () => connect(),
    addUrl: (raw) => addTeleopUrl(raw, currentUser(), projectId()),
    hideViewerOnly,
    closeTab,
    activateFromShared,
    syncList,
    openDocs,
    isOpen: () => !viewerEl?.classList.contains("hidden"),
  };
}
