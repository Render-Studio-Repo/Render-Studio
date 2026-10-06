/** Auth token storage and login/register popup. */

import { initCadAvatarBadges, syncCadAvatarBadges } from "../cad/cad-avatar-badges.js?v=20260908-profclick1";
import { buildLoginDiagnosticText } from "./auth-login-diagnostics.js?v=loginlog1-loginfix1";

export { buildLoginDiagnosticText };

const LOGIN_DEBUG_MAX = 50;
const loginDebugLines = [];
const AUTH_COPY_ICON = `<svg class="auth-error-copy-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M5.5 1A1.5 1.5 0 0 0 4 2.5V3H3.5A1.5 1.5 0 0 0 2 4.5v9A1.5 1.5 0 0 0 3.5 15h7A1.5 1.5 0 0 0 12 13.5V13h.5A1.5 1.5 0 0 0 14 11.5v-7A1.5 1.5 0 0 0 12.5 3H12v-.5A1.5 1.5 0 0 0 10.5 1h-5zM5 2.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5V3H5v-.5zM3.5 4h7A.5.5 0 0 1 11 4.5v9a.5.5 0 0 1-.5.5h-7a.5.5 0 0 1-.5-.5v-9A.5.5 0 0 1 3.5 4zm8.5 8.5V5h.5a.5.5 0 0 1 .5.5v7a.5.5 0 0 1-.5.5H12z"/></svg>`;

function pushLoginDebug(line) {
  const text = String(line || "").replace(/\s+/g, " ").trim();
  if (!text) return;
  loginDebugLines.push(`${new Date().toISOString()} ${text}`);
  if (loginDebugLines.length > LOGIN_DEBUG_MAX) {
    loginDebugLines.splice(0, loginDebugLines.length - LOGIN_DEBUG_MAX);
  }
}

function shortUserAgent() {
  try {
    return String(navigator.userAgent || "").replace(/\s+/g, " ").trim().slice(0, 160);
  } catch {
    return "";
  }
}

function headerGet(res, name) {
  try {
    return String(res?.headers?.get(name) || "").trim();
  } catch {
    return "";
  }
}

function pickPayloadRequestId(data) {
  if (!data || typeof data !== "object") return "";
  const detail = data.detail;
  if (detail && typeof detail === "object") {
    const nested = String(detail.request_id || detail.trace_id || "").trim();
    if (nested) return nested;
  }
  return String(data.request_id || data.trace_id || "").trim();
}

function payloadErrorText(data) {
  if (!data || typeof data !== "object") return "";
  if (typeof data.error === "string" && data.error.trim()) return data.error.trim();
  const detail = data.detail;
  if (detail && typeof detail === "object" && typeof detail.error === "string") {
    return detail.error.trim();
  }
  return "";
}

function attachAuthDiag(err, fields) {
  const status = Number(fields.status) || 0;
  err.authDiag = {
    timestamp: fields.timestamp || new Date().toISOString(),
    url: fields.url || "",
    status,
    reached_server: fields.reached_server !== false && status > 0,
    detail: fields.detail || "",
    error: fields.error || "",
    request_id: fields.request_id || "",
    trace_id: fields.trace_id || "",
    x_request_id: fields.x_request_id || "",
    x_trace_id: fields.x_trace_id || "",
    userAgent: shortUserAgent(),
  };
  pushLoginDebug(`POST ${err.authDiag.url} → ${status || "network"} ${err.authDiag.request_id || ""}`.trim());
  return err;
}

const TOKEN_KEY = "render3d:token";
const SESSION_RENEW_SKEW_SECONDS = 48 * 60 * 60;
const SESSION_RENEW_CHECK_MS = 60 * 60 * 1000;
let sessionRenewalStarted = false;
let sessionRenewalInFlight = null;
const USER_KEY = "render3d:user";
const SESSION_CACHE_KEY = "render3d:session:v1";
const PENDING_CONNECTION_PREFS_KEY = "render3d:pendingConnectionPrefs:v1";
const LOGOUT_RELOAD_KEY = "render3d:logoutReload:v1";
const FUSION_LINKED_CACHE_PREFIX = "render3d:fusionLinked:";

const FOUNDRY_TOOLBAR_KEY = "render3d:foundryToolbar:v1";

export function isAdminUser(user) {
  if (user?.platform_admin || user?.super_admin) return true;
  const role = String(user?.role || "").trim().toLowerCase();
  return role === "admin";
}

export function isSuperAdminUser(user) {
  return Boolean(user?.super_admin);
}

export function isManagementDashboardUser(user) {
  return isAdminUser(user);
}

export function isFoundryToolbarEnabled() {
  try {
    return localStorage.getItem(FOUNDRY_TOOLBAR_KEY) === "1";
  } catch {
    return false;
  }
}

export function setFoundryToolbarEnabled(on) {
  try {
    localStorage.setItem(FOUNDRY_TOOLBAR_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent("render3d:foundry-toolbar"));
}

function tokenExpirySeconds(token) {
  try {
    const payload = String(token || "").split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    const exp = Number(json?.exp);
    return Number.isFinite(exp) ? exp : null;
  } catch {
    return null;
  }
}

/** True when JWT is missing exp or already past exp (with a small skew). */
export function isTokenExpired(token = getToken(), skewSeconds = 30) {
  if (!token) return true;
  const exp = tokenExpirySeconds(token);
  if (exp == null) return false;
  return Date.now() / 1000 >= exp - skewSeconds;
}

export function getToken() {
  try {
    const token = localStorage.getItem(TOKEN_KEY) || "";
    if (!token) return "";
    // Drop expired JWTs immediately so /api/projects doesn't 401 forever with a "signed in" UI.
    if (isTokenExpired(token, 0)) {
      try {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(SESSION_CACHE_KEY);
      } catch { /* ignore */ }
      return "";
    }
    return token;
  } catch {
    return "";
  }
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  ensureSessionRenewal();
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem(SESSION_CACHE_KEY);
}

export function authHeaders(extra = {}) {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

function userStubFromToken(token) {
  try {
    const payload = JSON.parse(atob(String(token || "").split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    const id = payload.sub || payload.user_id;
    if (!id) return null;
    return { id: String(id), email: payload.email || "", display_name: payload.name || payload.email || "Signed in" };
  } catch {
    return null;
  }
}

function userInitial(user) {
  const name = user?.display_name?.trim() || user?.email?.trim() || "?";
  return name.charAt(0).toUpperCase();
}

function cacheSessionData(token, data = {}) {
  if (!token || !data?.user) return;
  try {
    let ai = data.ai || null;
    if (ai?.deferred) {
      const prev = getCachedSession(token);
      ai = prev?.ai && !prev.ai.deferred ? prev.ai : null;
    }
    localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({
      token,
      user: data.user,
      teams: Array.isArray(data.teams) ? data.teams : [],
      ai,
      cached_at: Date.now(),
    }));
  } catch {
    /* cache is best-effort */
  }
}

function getCachedSession(token) {
  try {
    const data = JSON.parse(localStorage.getItem(SESSION_CACHE_KEY) || "null");
    if (!data || data.token !== token || !data.user) return null;
    return {
      user: data.user,
      teams: Array.isArray(data.teams) ? data.teams : [],
      ai: data.ai || null,
      cached: true,
    };
  } catch {
    return null;
  }
}

export async function refreshSessionIfNeeded({ force = false } = {}) {
  const token = getToken();
  if (!token && !force) return null;
  const expiresAt = tokenExpirySeconds(token);
  if (token && !force && expiresAt != null && Date.now() / 1000 < expiresAt - SESSION_RENEW_SKEW_SECONDS) {
    return null;
  }
  if (sessionRenewalInFlight) return sessionRenewalInFlight;
  sessionRenewalInFlight = (async () => {
    const response = await fetch("/api/auth/refresh", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.token || !data?.user) {
      const error = new Error(data?.detail || `Could not renew session (${response.status})`);
      error.status = response.status;
      throw error;
    }
    setSession(data.token, data.user);
    cacheSessionData(data.token, data);
    return data;
  })();
  try {
    return await sessionRenewalInFlight;
  } finally {
    sessionRenewalInFlight = null;
  }
}

function ensureSessionRenewal() {
  if (sessionRenewalStarted || typeof window === "undefined") return;
  sessionRenewalStarted = true;
  const renew = () => void refreshSessionIfNeeded().catch(() => {});
  const timer = window.setInterval(renew, SESSION_RENEW_CHECK_MS);
  timer?.unref?.();
  window.setTimeout(renew, 5000);
  document?.addEventListener?.("visibilitychange", () => {
    if (document.visibilityState === "visible") renew();
  });
}

function isInvalidSessionError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return /not authenticated|invalid or expired token|user not found|unauthorized/.test(msg);
}

function isTransientAuthFailure(err) {
  const status = Number(err?.status) || 0;
  if ([408, 429, 500, 502, 503, 504].includes(status)) return true;
  const msg = String(err?.message || err || "").toLowerCase();
  return /failed to fetch|networkerror|network error|load failed|aborterror|timeout|restarting or busy|account service is unavailable|cannot reach|bad gateway|service unavailable|gateway timeout|\b502\b|\b503\b|\b504\b/.test(msg);
}

function authApiUrl(path) {
  try {
    return new URL(path, window.location.origin).href;
  } catch {
    return path;
  }
}

function detailFromAuthPayload(data, status, statusText) {
  const detail = data?.detail;
  if (typeof detail === "string" && detail.trim()) return detail.trim();
  if (Array.isArray(detail)) {
    const parts = detail.map((item) => item?.msg || item?.message).filter(Boolean);
    if (parts.length) return parts.join("; ");
  }
  if (detail && typeof detail === "object" && (detail.message || detail.msg)) {
    return String(detail.message || detail.msg);
  }
  if (typeof data?.message === "string" && data.message.trim()) return data.message.trim();
  if (status === 401) return "Invalid email or password";
  if (status === 429) return "Too many login attempts. Try again in a minute.";
  if (status === 422) return "Check email and password, then try again.";
  if (status === 502 || status === 503 || status === 504) {
    return "Account service is unavailable. Wait a few seconds and try again.";
  }
  const text = (statusText || "").trim();
  if (text && !/^ok$/i.test(text)) return text;
  if (status) return `Login failed (${status})`;
  return "";
}

/** Same-origin POST for login/register. Does not use the generation `api()` wrapper. */
export async function postAuthJson(path, body, { timeoutMs = 25000 } = {}) {
  const url = authApiUrl(path);
  const timestamp = new Date().toISOString();
  pushLoginDebug(`POST ${url}`);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = detailFromAuthPayload(data, res.status, res.statusText) || `Login failed (${res.status})`;
      const requestId = pickPayloadRequestId(data) || headerGet(res, "x-request-id") || headerGet(res, "x-trace-id");
      const err = new Error(detail);
      err.status = res.status;
      attachAuthDiag(err, {
        timestamp,
        url,
        status: res.status,
        reached_server: true,
        detail,
        error: payloadErrorText(data),
        request_id: requestId,
        trace_id: typeof data?.trace_id === "string" ? data.trace_id : "",
        x_request_id: headerGet(res, "x-request-id"),
        x_trace_id: headerGet(res, "x-trace-id"),
      });
      throw err;
    }
    return data;
  } catch (err) {
    if (Number(err?.status) > 0) throw err;
    if (err?.name === "AbortError") {
      const out = new Error("Login timed out waiting for the account service. Try again.");
      out.status = 408;
      attachAuthDiag(out, {
        timestamp,
        url,
        status: 408,
        reached_server: false,
        detail: out.message,
      });
      throw out;
    }
    const out = new Error("Login did not reach the server. Check your connection, wait if Studio is updating, then try again.");
    out.status = 0;
    attachAuthDiag(out, {
      timestamp,
      url,
      status: 0,
      reached_server: false,
      detail: out.message,
    });
    throw out;
  } finally {
    window.clearTimeout(timer);
  }
}

function formatLoginError(err) {
  const status = Number(err?.status) || 0;
  const raw = String(err?.message || err || "").trim();
  if (status === 401) return raw || "Invalid email or password";
  if (status === 422) return raw || "Check email and password, then try again.";
  if (status === 429) return raw || "Too many login attempts. Try again in a minute.";
  if (
    status === 502 || status === 503 || status === 504
    || /account service is unavailable|restarting or busy/i.test(raw)
  ) {
    return "Cannot reach the account service — the server may be restarting. Wait a few seconds and try again.";
  }
  if (status === 408 || /timed out/i.test(raw)) {
    return "Login timed out waiting for the account service. Try again.";
  }
  if (status > 0) return raw || `Login failed (${status})`;
  if (!raw || /^request failed/i.test(raw) || raw === "Failed to fetch" || /networkerror|load failed|cannot reach/i.test(raw)) {
    return "Login did not reach the server. Check your connection, wait if Studio is updating, then try again.";
  }
  return raw;
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchSocialProviders() {
  try {
    const res = await fetch("/api/auth/social/providers", { headers: authHeaders(), credentials: "include" });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.providers) ? data.providers : [];
  } catch {
    return null;
  }
}

export function createAuthUI({ api, onReady, onUserMenuOpen }) {
  const modal = document.getElementById("auth-modal");
  const formLogin = document.getElementById("auth-form-login");
  const formRegister = document.getElementById("auth-form-register");
  const formForgot = document.getElementById("auth-form-forgot");
  const formReset = document.getElementById("auth-form-reset");
  const btnAuth = document.getElementById("btn-auth");
  const userMenu = document.getElementById("user-menu");
  const userLabel = document.getElementById("user-label");
  const userEmail = document.getElementById("user-email");
  const authAvatar = document.getElementById("auth-avatar");
  const authAvatarLg = document.getElementById("auth-avatar-lg");
  const authIcon = btnAuth?.querySelector(".auth-icon");
  const btnLogout = document.getElementById("btn-logout");
  const authError = document.getElementById("auth-error");
  const cadLinks = {
    onshape: { linked: false, account: "" },
    fusion: { linked: false, account: "" },
  };
  const adminDashboardLink = document.getElementById("btn-admin-dashboard");
  const adminDashboardToolbar = document.getElementById("btn-admin-dashboard-toolbar");
  const foundryLink = document.getElementById("btn-foundry-dashboard");
  const foundryDashboardToolbar = document.getElementById("btn-foundry-dashboard-toolbar");
  const onshapeStatusEl = document.getElementById("onshape-connection-status");
  const fusionStatusEl = document.getElementById("fusion-connection-status");
  const fusionConnectBtn = document.getElementById("btn-fusion-connect");

  initCadAvatarBadges();

  let loggedInUser = null;

  function paintCadAvatarBadges() {
    syncCadAvatarBadges(cadLinks);
  }

  function setOnshapeBadge(show, account = null) {
    const linked = !!show;
    const label = account?.onshape_email || account?.email || "";
    cadLinks.onshape = { linked, account: linked ? (label || "Connected") : "" };
    if (onshapeStatusEl) onshapeStatusEl.textContent = linked ? (label || "Connected") : "Disconnected";
    paintCadAvatarBadges();
  }

  function setFusionBadge(show, account = null) {
    const linked = !!show;
    const label = account?.autodesk_email || account?.autodesk_name || "";
    cadLinks.fusion = { linked, account: linked ? (label || "Connected") : "" };
    fusionConnectBtn?.classList.toggle("is-connected", linked);
    fusionConnectBtn?.classList.toggle("is-disconnected", !linked);
    if (fusionStatusEl) {
      if (!linked) fusionStatusEl.textContent = "Click to connect";
      else fusionStatusEl.textContent = label || "Connected";
    }
    fusionConnectBtn?.setAttribute(
      "title",
      linked ? "Open Fusion Library" : "Connect Autodesk Fusion 360",
    );
    fusionConnectBtn?.setAttribute(
      "aria-label",
      linked ? "Fusion 360 connected. Open Fusion Library." : "Fusion 360 disconnected. Click to connect.",
    );
    paintCadAvatarBadges();
  }

  function fusionCacheKey(user = loggedInUser) {
    const id = String(user?.id || user?.email || "").trim();
    return id ? `${FUSION_LINKED_CACHE_PREFIX}${id}` : "";
  }

  function readCachedFusionAccount(user = loggedInUser) {
    const key = fusionCacheKey(user);
    if (!key) return null;
    try {
      const data = JSON.parse(localStorage.getItem(key) || "null");
      return data?.linked ? data : null;
    } catch {
      return null;
    }
  }

  function cacheFusionAccount(linked, account = null, user = loggedInUser) {
    const key = fusionCacheKey(user);
    if (!key) return;
    try {
      if (!linked) {
        localStorage.removeItem(key);
        return;
      }
      localStorage.setItem(key, JSON.stringify({
        linked: true,
        autodesk_email: account?.autodesk_email || "",
        autodesk_name: account?.autodesk_name || "",
        cached_at: Date.now(),
      }));
    } catch {
      /* local storage is best-effort */
    }
  }

  function showModal(show) {
    modal?.classList.toggle("hidden", !show);
    if (show) {
      setAuthError("");
      document.getElementById("login-email")?.focus();
      void refreshSocialProviders();
    }
  }

  function syncToolbarDashboards() {
    try {
      const showManagement = isManagementDashboardUser(loggedInUser);
      const showFoundryToolbar = !!loggedInUser && isFoundryToolbarEnabled() && !showManagement;
      document.body.classList.toggle("is-admin", isAdminUser(loggedInUser));
      adminDashboardLink?.classList.toggle("hidden", !showManagement);
      adminDashboardToolbar?.classList.toggle("hidden", !showManagement);
      foundryDashboardToolbar?.classList.toggle("hidden", !showFoundryToolbar);
      foundryLink?.classList.toggle("hidden", !loggedInUser);
    } catch {
      /* ignore — never block editor boot on toolbar chrome */
    }
  }

  function setLoggedOutUI() {
    loggedInUser = null;
    document.body.classList.remove("is-admin", "is-signed-in");
    document.documentElement.classList.remove("has-session");
    btnAuth?.classList.remove("signed-in");
    authIcon?.classList.remove("hidden");
    authAvatar?.classList.add("hidden");
    userMenu?.classList.add("hidden");
    btnAuth?.setAttribute("title", "Sign in");
    btnAuth?.setAttribute("aria-label", "Sign in");
    btnAuth?.setAttribute("aria-expanded", "false");
    btnAuth?.removeAttribute("aria-haspopup");
    btnAuth?.removeAttribute("aria-controls");
    setOnshapeBadge(false);
    setFusionBadge(false);
    syncToolbarDashboards();
    try {
      window.dispatchEvent(new CustomEvent("render3d:auth-session", { detail: { user: null } }));
    } catch { /* ignore */ }
  }

  function applyAvatarEl(el, user) {
    if (!el || !user) return;
    const avatar = String(user.avatar_url || "").trim();
    const initial = userInitial(user);
    if (avatar) {
      el.textContent = "";
      el.classList.add("auth-avatar--image");
      el.style.backgroundImage = `url('${avatar.replace(/'/g, "%27")}')`;
      el.setAttribute("aria-label", user.display_name || "Account");
    } else {
      el.textContent = initial;
      el.classList.remove("auth-avatar--image");
      el.style.backgroundImage = "";
      el.removeAttribute("aria-label");
    }
  }

  function setUserUI(user) {
    loggedInUser = user;
    document.body.classList.add("is-signed-in");
    document.documentElement.classList.add("has-session");
    btnAuth?.classList.add("signed-in");
    authIcon?.classList.add("hidden");
    if (authAvatar) {
      applyAvatarEl(authAvatar, user);
      authAvatar.classList.remove("hidden");
    }
    if (authAvatarLg) applyAvatarEl(authAvatarLg, user);
    if (userLabel) userLabel.textContent = user.display_name;
    if (userEmail) userEmail.textContent = user.email;
    btnAuth?.setAttribute("title", `Account: ${user.display_name}`);
    btnAuth?.setAttribute("aria-label", `Account menu: ${user.display_name}`);
    btnAuth?.setAttribute("aria-haspopup", "menu");
    btnAuth?.setAttribute("aria-controls", "user-menu");
    btnAuth?.setAttribute("aria-expanded", "false");
    syncToolbarDashboards();
    const cachedFusion = readCachedFusionAccount(user);
    if (cachedFusion) setFusionBadge(true, cachedFusion);
    else setFusionBadge(false);
    try {
      window.dispatchEvent(new CustomEvent("render3d:auth-session", { detail: { user } }));
    } catch { /* ignore */ }
  }

  function closeUserMenu() {
    userMenu?.classList.add("hidden");
    btnAuth?.setAttribute("aria-expanded", "false");
    document.body?.classList.remove("user-menu-open");
    const backdrop = document.getElementById("user-menu-backdrop");
    if (backdrop) {
      backdrop.classList.add("hidden");
      backdrop.hidden = true;
    }
  }

  function toggleUserMenu() {
    if (!loggedInUser) return;
    const opening = userMenu?.classList.contains("hidden");
    userMenu?.classList.toggle("hidden");
    btnAuth?.setAttribute("aria-expanded", opening ? "true" : "false");
    document.body?.classList.toggle("user-menu-open", !!opening);
    if (opening) onUserMenuOpen?.();
    else closeUserMenu();
  }

  let lastAuthDiag = null;
  let copiedTimer = 0;

  function ensureAuthErrorCopyUi() {
    if (!authError) return null;
    let msg = authError.querySelector(".auth-error-msg");
    if (msg) {
      return {
        msg,
        btn: authError.querySelector(".auth-error-copy"),
        hint: authError.querySelector(".auth-error-copied"),
      };
    }
    authError.textContent = "";
    msg = document.createElement("span");
    msg.className = "auth-error-msg";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "auth-error-copy";
    btn.setAttribute("aria-label", "Copy logs");
    btn.title = "Copy logs";
    btn.innerHTML = AUTH_COPY_ICON;
    const hint = document.createElement("span");
    hint.className = "auth-error-copied";
    hint.hidden = true;
    hint.textContent = "Copied";
    authError.append(msg, btn, hint);
    authError.addEventListener("click", (e) => {
      if (!authError.classList.contains("has-copy")) return;
      e.preventDefault();
      void copyAuthLogs();
    });
    return { msg, btn, hint };
  }

  async function copyAuthLogs() {
    const diag = lastAuthDiag || {
      timestamp: new Date().toISOString(),
      url: authApiUrl("/api/auth/login"),
      status: "",
      detail: authError?.querySelector(".auth-error-msg")?.textContent || "",
      userAgent: shortUserAgent(),
    };
    const text = buildLoginDiagnosticText(diag, loginDebugLines);
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      /* fallback */
    }
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.cssText = "position:fixed;left:-9999px";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      } catch {
        ok = false;
      }
    }
    const ui = ensureAuthErrorCopyUi();
    if (!ui) return;
    ui.hint.textContent = ok ? "Copied" : "Copy failed";
    ui.hint.hidden = false;
    window.clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => {
      ui.hint.hidden = true;
    }, 1600);
  }

  function setAuthError(message, isOk = false, diag = null) {
    if (!authError) return;
    const ui = ensureAuthErrorCopyUi();
    ui.msg.textContent = message || "";
    authError.classList.toggle("is-ok", !!isOk && !!message);
    const canCopy = !!message && !isOk;
    authError.classList.toggle("has-copy", canCopy);
    lastAuthDiag = canCopy ? (diag || lastAuthDiag) : null;
    if (!canCopy) ui.hint.hidden = true;
  }

  function switchTab(tab) {
    const mode = tab === "register" || tab === "forgot" || tab === "reset" ? tab : "login";
    modal?.querySelectorAll(".auth-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === mode));
    formLogin?.classList.toggle("hidden", mode !== "login");
    formRegister?.classList.toggle("hidden", mode !== "register");
    formForgot?.classList.toggle("hidden", mode !== "forgot");
    formReset?.classList.toggle("hidden", mode !== "reset");
    const extrasHidden = mode === "forgot" || mode === "reset";
    modal?.querySelector(".auth-tabs")?.classList.toggle("hidden", extrasHidden);
    modal?.querySelector(".auth-connect-opts")?.classList.toggle("hidden", extrasHidden);
    modal?.querySelector(".auth-divider")?.classList.toggle("hidden", extrasHidden);
    modal?.querySelector(".auth-social-btns")?.classList.toggle("hidden", extrasHidden);
    setAuthError("");
    const title = document.getElementById("auth-title");
    const subtitle = modal?.querySelector(".auth-subtitle");
    if (title) {
      title.textContent = mode === "register"
        ? "Create account"
        : mode === "forgot"
          ? "Forgot password"
          : mode === "reset"
            ? "Set a new password"
            : "Welcome back";
    }
    if (subtitle) {
      subtitle.textContent = mode === "register"
        ? "Create an account to save projects and workspaces"
        : mode === "forgot"
          ? "We’ll email you a link to reset your password"
          : mode === "reset"
            ? "Pick a new password, then you’ll be signed in"
            : "Sign in to access your shared workspaces";
    }
  }

  async function refreshSocialProviders() {
    const buttons = [...document.querySelectorAll("[data-social-login]")];
    if (!buttons.length) return;
    buttons.forEach((btn) => {
      btn.disabled = true;
      btn.classList.add("is-loading");
      btn.title = "Checking sign-in provider...";
    });
    const providers = await fetchSocialProviders();
    if (!providers) {
      buttons.forEach((btn) => {
        const label = btn.dataset.socialLabel || btn.dataset.socialLogin || "provider";
        btn.disabled = false;
        btn.classList.remove("is-loading", "auth-social-btn--disabled");
        btn.title = `Sign in with ${label}`;
      });
      return;
    }
    const byProvider = new Map(providers.map((item) => [String(item.provider || "").toLowerCase(), item]));
    buttons.forEach((btn) => {
      const provider = String(btn.dataset.socialLogin || "").toLowerCase();
      const info = byProvider.get(provider);
      const configured = info?.configured === true;
      btn.disabled = !configured;
      btn.classList.remove("is-loading");
      btn.classList.toggle("auth-social-btn--disabled", !configured);
      btn.title = configured
        ? `Sign in with ${btn.dataset.socialLabel || info?.label || provider}`
        : `${btn.dataset.socialLabel || info?.label || provider} sign-in is not configured yet.`;
    });
  }

  function connectionPrefs() {
    return {
      onshape: !!document.getElementById("auth-connect-onshape")?.checked,
      fusion: !!document.getElementById("auth-connect-fusion")?.checked,
    };
  }

  function savePendingConnectionPrefs(prefs = connectionPrefs()) {
    try {
      if (prefs?.onshape || prefs?.fusion) {
        sessionStorage.setItem(PENDING_CONNECTION_PREFS_KEY, JSON.stringify({
          onshape: !!prefs.onshape,
          fusion: !!prefs.fusion,
          created_at: Date.now(),
        }));
      } else {
        sessionStorage.removeItem(PENDING_CONNECTION_PREFS_KEY);
      }
    } catch { /* best effort */ }
  }

  function consumePendingConnectionPrefs() {
    try {
      const raw = sessionStorage.getItem(PENDING_CONNECTION_PREFS_KEY);
      sessionStorage.removeItem(PENDING_CONNECTION_PREFS_KEY);
      if (!raw) return null;
      const prefs = JSON.parse(raw);
      if (!prefs || Date.now() - Number(prefs.created_at || 0) > 10 * 60 * 1000) return null;
      return { onshape: !!prefs.onshape, fusion: !!prefs.fusion };
    } catch {
      return null;
    }
  }

  function clearConnectionPrefs() {
    const onshape = document.getElementById("auth-connect-onshape");
    const fusion = document.getElementById("auth-connect-fusion");
    if (onshape) onshape.checked = false;
    if (fusion) fusion.checked = false;
  }

  function openOAuthPopup(url, name) {
    const width = 560;
    const height = 720;
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
    const features = `popup=yes,width=${width},height=${height},left=${left},top=${top}`;
    const popup = window.open(url, name, features);
    if (!popup) {
      window.location.href = url;
      return null;
    }
    return popup;
  }

  function watchOAuthPopup(popup) {
    if (!popup) return;
    const timer = window.setInterval(() => {
      if (!popup.closed) return;
      window.clearInterval(timer);
      void refreshCloudBadges();
    }, 800);
    window.setTimeout(() => window.clearInterval(timer), 10 * 60 * 1000);
  }

  async function refreshCloudBadges() {
    try {
      const os = await api("/api/onshape/status");
      setOnshapeBadge(os.linked === true, os);
    } catch { /* non-critical */ }
    try {
      const fs = await api("/api/autodesk/status");
      cacheFusionAccount(fs.linked === true, fs);
      setFusionBadge(fs.linked === true, fs);
      if (fs.linked === true) {
        window.dispatchEvent(new CustomEvent("render3d:autodesk-linked"));
      }
    } catch { /* non-critical */ }
  }

  async function openCheckedConnections(prefs) {
    const wantOnshape = !!prefs?.onshape;
    const wantFusion = !!prefs?.fusion;
    if (!wantOnshape && !wantFusion) return;

    if (wantOnshape) {
      try {
        const oauth = await api("/api/onshape/oauth-url", { method: "POST" });
        watchOAuthPopup(openOAuthPopup(oauth?.url || "/oauth/start", "render3d-onshape-connect"));
      } catch (err) {
        setAuthError(err.message || "Could not start Onshape connection.");
        watchOAuthPopup(openOAuthPopup("/oauth/start", "render3d-onshape-connect"));
      }
    }

    if (wantFusion) {
      try {
        const oauth = await api("/api/autodesk/oauth-url", { method: "POST" });
        if (!oauth?.url) throw new Error("Fusion OAuth URL missing");
        watchOAuthPopup(openOAuthPopup(oauth.url, "render3d-fusion-connect"));
      } catch (err) {
        setAuthError(err.message || "Could not start Fusion connection.");
      }
    }
  }

  function notifyOpenerAndClose(provider, ok, detail = "") {
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          { type: "render3d:oauth-done", provider, ok: !!ok, detail: String(detail || "") },
          window.location.origin,
        );
      }
    } catch { /* ignore */ }
    try {
      window.close();
    } catch { /* ignore */ }
  }

  async function finishAuthSuccess(data, { connectPrefs = null } = {}) {
    setSession(data.token, data.user);
    cacheSessionData(data.token, data);
    setUserUI(data.user);
    showModal(false);
    clearConnectionPrefs();
    onReady?.(data);
    if (connectPrefs && (connectPrefs.onshape || connectPrefs.fusion)) {
      window.setTimeout(() => {
        void openCheckedConnections(connectPrefs);
      }, 150);
    }
  }

  async function fetchCurrentSessionWithRetry() {
    let lastError = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        return await Promise.race([
          api("/api/auth/me?lite=1"),
          new Promise((_, reject) => {
            window.setTimeout(() => reject(new Error("Session check timed out")), 4000);
          }),
        ]);
      } catch (err) {
        lastError = err;
        // KeepAlive restart can 401/502 until the new process is up. Only give
        // up early when the JWT itself is past exp.
        if (isTokenExpired(getToken()) && isInvalidSessionError(err)) break;
        if (attempt === 5) break;
        await delay(400 * (attempt + 1));
      }
    }
    throw lastError || new Error("Could not validate session");
  }

  modal?.querySelectorAll(".auth-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  modal?.querySelectorAll("[data-auth-close]").forEach((el) => {
    el.addEventListener("click", () => showModal(false));
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && modal && !modal.classList.contains("hidden")) {
      showModal(false);
    }
  });

  btnAuth?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (loggedInUser) {
      toggleUserMenu();
    } else {
      showModal(true);
      switchTab("login");
    }
  });

  btnAuth?.addEventListener("contextmenu", (e) => {
    if (!loggedInUser) return;
    e.preventDefault();
    e.stopPropagation();
    toggleUserMenu();
  });

  document.addEventListener("click", () => closeUserMenu());
  userMenu?.addEventListener("click", (e) => e.stopPropagation());
  document.getElementById("user-menu-close")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeUserMenu();
  });

  let loginInFlight = false;

  function setLoginBusy(busy) {
    loginInFlight = !!busy;
    const submit = formLogin?.querySelector('button[type="submit"]');
    if (submit) {
      submit.disabled = !!busy;
      submit.setAttribute("aria-busy", busy ? "true" : "false");
    }
  }

  formLogin?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    if (e.repeat || loginInFlight) {
      e.preventDefault();
    }
  });

  formLogin?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (loginInFlight) return;
    setLoginBusy(true);
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const prefs = connectionPrefs();
    try {
      const data = await postAuthJson("/api/auth/login", { email, password });
      await finishAuthSuccess(data, { connectPrefs: prefs });
    } catch (err) {
      setAuthError(
        formatLoginError(err),
        false,
        err?.authDiag || {
          timestamp: new Date().toISOString(),
          url: authApiUrl("/api/auth/login"),
          status: Number(err?.status) || 0,
          reached_server: Number(err?.status) > 0,
          detail: String(err?.message || ""),
          userAgent: shortUserAgent(),
        },
      );
    } finally {
      setLoginBusy(false);
    }
  });

  document.getElementById("btn-forgot-password")?.addEventListener("click", () => {
    const loginEmail = document.getElementById("login-email")?.value?.trim();
    const forgotEmail = document.getElementById("forgot-email");
    if (forgotEmail && loginEmail) forgotEmail.value = loginEmail;
    switchTab("forgot");
  });
  document.getElementById("btn-forgot-back")?.addEventListener("click", () => switchTab("login"));

  formForgot?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("forgot-email")?.value?.trim();
    const submit = formForgot.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      const data = await postAuthJson("/api/auth/forgot-password", { email });
      setAuthError(data?.message || "If an account exists for that email, we sent a reset link.", true);
    } catch (err) {
      setAuthError(err.message || "Could not send reset email.", false, err?.authDiag || null);
    } finally {
      if (submit) submit.disabled = false;
    }
  });

  formReset?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = document.getElementById("reset-password")?.value || "";
    const confirm = document.getElementById("reset-password-confirm")?.value || "";
    if (password !== confirm) {
      setAuthError("Passwords do not match.");
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token") || formReset.dataset.resetToken || "";
    try {
      const data = await postAuthJson("/api/auth/reset-password", { token, password });
      history.replaceState({}, "", window.location.pathname === "/reset-password" ? "/" : window.location.pathname);
      await finishAuthSuccess(data);
    } catch (err) {
      setAuthError(err.message || "Could not reset password.", false, err?.authDiag || null);
    }
  });

  const HANDLE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,23}$/;
  let registerHandleTimer = null;
  let registerHandleSeq = 0;
  let registerHandleAvailable = false;

  function setRegisterHandleStatus(state, message) {
    const el = document.getElementById("register-handle-status");
    if (!el) return;
    el.className = `profile-handle-status is-${state}`;
    el.textContent = message;
    const submit = document.getElementById("register-submit");
    if (submit) {
      submit.disabled = state !== "ok";
    }
    registerHandleAvailable = state === "ok";
  }

  function validateHandleClient(raw) {
    const handle = String(raw || "").trim().replace(/^@+/, "");
    if (!handle) return "Enter a username";
    if (!HANDLE_RE.test(handle)) return "3–24 chars: letters, numbers, _ or -";
    return "";
  }

  function scheduleRegisterHandleCheck({ immediate = false } = {}) {
    window.clearTimeout(registerHandleTimer);
    const run = async () => {
      const input = document.getElementById("register-handle");
      const handle = (input?.value || "").trim().replace(/^@+/, "");
      const invalid = validateHandleClient(handle);
      if (invalid) {
        setRegisterHandleStatus(handle ? "error" : "idle", handle ? invalid : "@");
        return;
      }
      const seq = ++registerHandleSeq;
      setRegisterHandleStatus("checking", "…");
      try {
        const data = await api(`/api/auth/handle-availability?handle=${encodeURIComponent(handle)}`);
        if (seq !== registerHandleSeq) return;
        if (data.valid === false) {
          setRegisterHandleStatus("error", data.message || "Invalid");
        } else if (data.available) {
          setRegisterHandleStatus("ok", "✓");
        } else {
          setRegisterHandleStatus("error", "Taken");
        }
      } catch (err) {
        if (seq !== registerHandleSeq) return;
        setRegisterHandleStatus("error", err.message || "Could not check");
      }
    };
    registerHandleTimer = window.setTimeout(run, immediate ? 0 : 320);
  }

  document.getElementById("register-handle")?.addEventListener("input", (e) => {
    const el = e.target;
    el.value = String(el.value || "").replace(/[^A-Za-z0-9_-]/g, "");
    scheduleRegisterHandleCheck();
  });

  formRegister?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("register-email").value.trim();
    const password = document.getElementById("register-password").value;
    const display_name = document.getElementById("register-name").value.trim();
    const handle = (document.getElementById("register-handle")?.value || "").trim().replace(/^@+/, "");
    const prefs = connectionPrefs();
    const invalid = validateHandleClient(handle);
    if (invalid) {
      setAuthError(invalid);
      setRegisterHandleStatus("error", invalid);
      return;
    }
    if (!registerHandleAvailable) {
      setAuthError("Pick an available username first");
      scheduleRegisterHandleCheck({ immediate: true });
      return;
    }
    try {
      const data = await postAuthJson("/api/auth/register", { email, password, display_name, handle });
      await finishAuthSuccess(data, { connectPrefs: prefs });
    } catch (err) {
      setAuthError(err.message, false, err?.authDiag || null);
      scheduleRegisterHandleCheck({ immediate: true });
    }
  });

  btnLogout?.addEventListener("click", () => {
    try {
      sessionStorage.setItem(LOGOUT_RELOAD_KEY, "1");
    } catch {
      /* optional */
    }
    try {
      fetch("/api/auth/logout", { method: "POST", credentials: "include", headers: authHeaders() }).catch(() => {});
    } catch {
      /* cookie clear is best-effort */
    }
    clearSession();
    setLoggedOutUI();
    closeUserMenu();
    showModal(false);
    window.location.reload();
  });

  document.querySelectorAll("[data-onshape-login]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!loggedInUser) {
        showModal(true);
        switchTab("login");
        const box = document.getElementById("auth-connect-onshape");
        if (box) box.checked = true;
        return;
      }
      try {
        const oauth = await api("/api/onshape/oauth-url", { method: "POST" });
        watchOAuthPopup(openOAuthPopup(oauth?.url || "/oauth/start", "render3d-onshape-connect"));
      } catch {
        watchOAuthPopup(openOAuthPopup("/oauth/start", "render3d-onshape-connect"));
      }
    });
  });

  document.querySelectorAll("[data-autodesk-login]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!loggedInUser) {
        showModal(true);
        switchTab("login");
        const box = document.getElementById("auth-connect-fusion");
        if (box) box.checked = true;
        return;
      }
      void startAutodeskConnect({ promptForCredentials: true });
    });
  });

  document.querySelectorAll("[data-social-login]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const provider = String(btn.dataset.socialLogin || "").trim().toLowerCase();
      if (!provider) return;
      if (btn.disabled) {
        const label = btn.dataset.socialLabel || provider;
        setAuthError(`${label} sign-in is not configured yet.`);
        return;
      }
      btn.classList.add("is-loading");
      savePendingConnectionPrefs();
      window.location.href = `/oauth/${encodeURIComponent(provider)}/start`;
    });
  });

  document.getElementById("btn-onshape-connect")?.addEventListener("click", () => {
    closeUserMenu();
    if (cadLinks.onshape.linked) {
      document.getElementById("btn-onshape-panel")?.click();
      return;
    }
    if (!loggedInUser) {
      showModal(true);
      switchTab("login");
      const box = document.getElementById("auth-connect-onshape");
      if (box) box.checked = true;
      return;
    }
    void (async () => {
      try {
        const oauth = await api("/api/onshape/oauth-url", { method: "POST" });
        if (!oauth?.url) throw new Error("Onshape authorization URL was not returned.");
        watchOAuthPopup(openOAuthPopup(oauth.url, "render3d-onshape-connect"));
      } catch (err) {
        setAuthError(err.message || "Could not start Onshape connection.");
      }
    })();
  });

  function openFusionLibraryPanel() {
    window.dispatchEvent(new CustomEvent("render3d:open-fusion-library"));
  }

  async function startAutodeskConnect({ promptForCredentials = true } = {}) {
    if (!loggedInUser) {
      showModal(true);
      switchTab("login");
      const box = document.getElementById("auth-connect-fusion");
      if (box) box.checked = true;
      throw new Error("Sign in to Render Studio first, then connect Autodesk Fusion 360.");
    }
    try {
      const status = await api("/api/autodesk/status");
      if (status?.linked) {
        cacheFusionAccount(true, status);
        setFusionBadge(true, status);
        openFusionLibraryPanel();
        return status;
      }
    } catch {
      /* continue to OAuth */
    }
    try {
      const oauth = await api("/api/autodesk/oauth-url", { method: "POST" });
      if (oauth?.url) {
        watchOAuthPopup(openOAuthPopup(oauth.url, "render3d-fusion-connect"));
        return { linked: false, redirecting: true };
      }
    } catch (err) {
      if (promptForCredentials && /not configured|AUTODESK_CLIENT/i.test(err.message || "")) {
        throw err;
      }
      setAuthError(err.message || "Could not start Fusion connection.");
    }
    return { linked: false, redirecting: false };
  }

  fusionConnectBtn?.addEventListener("click", () => {
    closeUserMenu();
    if (cadLinks.fusion.linked) {
      openFusionLibraryPanel();
    } else {
      void startAutodeskConnect({ promptForCredentials: false }).catch((err) => {
        setAuthError(err.message || "Could not start Fusion connection.");
      });
    }
  });

  window.addEventListener("render3d:autodesk-unlinked", () => {
    cacheFusionAccount(false);
    setFusionBadge(false);
  });

  window.addEventListener("render3d:autodesk-linked", async () => {
    try {
      const fs = await api("/api/autodesk/status");
      cacheFusionAccount(true, fs);
      setFusionBadge(true, fs);
    } catch {
      cacheFusionAccount(true);
      setFusionBadge(true);
    }
  });

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.type !== "render3d:oauth-done") return;
    void refreshCloudBadges();
  });

  void refreshSocialProviders();
  window.addEventListener("render3d:foundry-toolbar", () => syncToolbarDashboards());
  setLoggedOutUI();

  return {
    openModal(opts = {}) {
      const email = String(opts?.email || "").trim();
      const tab = opts?.tab === "register" || opts?.tab === "forgot" || opts?.tab === "reset"
        ? opts.tab
        : "login";
      if (email) {
        const loginEmail = document.getElementById("login-email");
        const registerEmail = document.getElementById("register-email");
        const forgotEmail = document.getElementById("forgot-email");
        if (loginEmail) loginEmail.value = email;
        if (registerEmail) registerEmail.value = email;
        if (forgotEmail) forgotEmail.value = email;
      }
      showModal(true);
      switchTab(tab);
    },
    setUser(user) {
      if (user) setUserUI(user);
      else setLoggedOutUI();
    },
    startAutodeskConnect,
    async bootstrap() {
      const params = new URLSearchParams(window.location.search);
      const resetToken = params.get("token") || "";
      const onResetPage = window.location.pathname.replace(/\/+$/, "") === "/reset-password";
      if (onResetPage) {
        if (resetToken) formReset.dataset.resetToken = resetToken;
        showModal(true);
        switchTab("reset");
        if (!resetToken) setAuthError("This reset link is missing a token.");
      }
      const oauthToken = params.get("onshape_token");
      const oauthLinked = params.get("onshape_linked");
      const oauthError = params.get("onshape_error");
      const autodeskLinked = params.get("autodesk_linked");
      const autodeskError = params.get("autodesk_error");
      const renderToken = params.get("render3d_token");
      const socialToken = params.get("social_token");
      const socialProvider = params.get("social_provider") || "social";
      const socialNew = params.get("social_new") === "1";
      const socialError = params.get("social_error");
      const inOAuthPopup = !!(window.opener && !window.opener.closed);

      if (socialError) {
        history.replaceState({}, "", window.location.pathname);
        const providerLabel = socialProvider.charAt(0).toUpperCase() + socialProvider.slice(1);
        setAuthError(`${providerLabel} login failed: ${decodeURIComponent(socialError)}`);
        if (inOAuthPopup) {
          notifyOpenerAndClose(socialProvider, false, socialError);
          return null;
        }
        showModal(true);
        return null;
      }

      if (socialToken) {
        history.replaceState({}, "", window.location.pathname);
        const pendingConnectPrefs = consumePendingConnectionPrefs();
        try {
          localStorage.setItem(TOKEN_KEY, socialToken);
          let data;
          try {
            data = await fetchCurrentSessionWithRetry();
          } catch (err) {
            if (isTokenExpired(socialToken)) throw err;
            const fallbackUser = getStoredUser() || userStubFromToken(socialToken);
            if (!fallbackUser) throw err;
            data = { user: fallbackUser, teams: [], ai: null, cached: true };
          }
          data.social_provider = socialProvider;
          data.social_new = socialNew;
          setSession(socialToken, data.user);
          cacheSessionData(socialToken, data);
          setUserUI(data.user);
          showModal(false);
          onReady?.(data);
          if (pendingConnectPrefs && !inOAuthPopup) {
            window.setTimeout(() => {
              void openCheckedConnections(pendingConnectPrefs);
            }, 250);
          }
          if (inOAuthPopup) notifyOpenerAndClose(socialProvider, true);
          return data;
        } catch (err) {
          if (isTransientAuthFailure(err) && !isTokenExpired(socialToken)) {
            return null;
          }
          clearSession();
          setLoggedOutUI();
          if (inOAuthPopup) notifyOpenerAndClose(socialProvider, false, "session_failed");
          return null;
        }
      }

      if (autodeskError) {
        history.replaceState({}, "", window.location.pathname);
        setAuthError(`Fusion login failed: ${decodeURIComponent(autodeskError)}`);
        if (inOAuthPopup) {
          notifyOpenerAndClose("fusion", false, autodeskError);
          return null;
        }
        showModal(true);
        return null;
      }

      if (autodeskLinked && renderToken) {
        history.replaceState({}, "", window.location.pathname);
        try {
          localStorage.setItem(TOKEN_KEY, renderToken);
          const data = await fetchCurrentSessionWithRetry();
          setSession(renderToken, data.user);
          cacheSessionData(renderToken, data);
          setUserUI(data.user);
          setFusionBadge(true);
          showModal(false);
          try {
            const fs = await api("/api/autodesk/status");
            cacheFusionAccount(true, fs, data.user);
            setFusionBadge(true, fs);
          } catch {
            cacheFusionAccount(true, null, data.user);
            setFusionBadge(true);
          }
          window.dispatchEvent(new CustomEvent("render3d:autodesk-linked"));
          if (inOAuthPopup) notifyOpenerAndClose("fusion", true);
          return data;
        } catch (err) {
          if (isTransientAuthFailure(err) && !isTokenExpired(renderToken)) {
            return null;
          }
          clearSession();
          setLoggedOutUI();
          if (inOAuthPopup) notifyOpenerAndClose("fusion", false, "session_failed");
          return null;
        }
      }

      if (oauthError) {
        history.replaceState({}, "", window.location.pathname);
        const detail = decodeURIComponent(oauthError);
        setAuthError(`Onshape login failed: ${detail}`);
        if (inOAuthPopup) {
          notifyOpenerAndClose("onshape", false, detail);
          return null;
        }
        showModal(true);
        return null;
      }

      // Connect-after-login: tokens are already stored for this user — do not replace session.
      if (oauthLinked) {
        history.replaceState({}, "", window.location.pathname);
        setOnshapeBadge(true);
        if (inOAuthPopup) {
          notifyOpenerAndClose("onshape", true);
          return null;
        }
        void refreshCloudBadges();
        const token = getToken();
        if (!token) return null;
        try {
          const data = await fetchCurrentSessionWithRetry();
          setSession(token, data.user);
          cacheSessionData(token, data);
          setUserUI(data.user);
          return data;
        } catch {
          return null;
        }
      }

      if (oauthToken) {
        history.replaceState({}, "", window.location.pathname);
        // If this popup was opened while already signed in, keep that session and only mark linked.
        if (inOAuthPopup && getToken()) {
          setOnshapeBadge(true);
          notifyOpenerAndClose("onshape", true);
          return null;
        }
        try {
          localStorage.setItem(TOKEN_KEY, oauthToken);
          const data = await fetchCurrentSessionWithRetry();
          setSession(oauthToken, data.user);
          cacheSessionData(oauthToken, data);
          setUserUI(data.user);
          setOnshapeBadge(true);
          showModal(false);
          if (inOAuthPopup) notifyOpenerAndClose("onshape", true);
          return data;
        } catch (err) {
          if (isTransientAuthFailure(err) && !isTokenExpired(oauthToken)) {
            return null;
          }
          clearSession();
          setLoggedOutUI();
          if (inOAuthPopup) notifyOpenerAndClose("onshape", false, "session_failed");
          return null;
        }
      }

      const token = getToken();
      if (!token) {
        try {
          const recovered = await refreshSessionIfNeeded({ force: true });
          if (recovered?.user && recovered?.token) {
            setUserUI(recovered.user);
            showModal(false);
            void refreshCloudBadges();
            return recovered;
          }
        } catch {
          /* Fall through to the access-cookie bootstrap and login UI. */
        }
        try {
          const data = await api("/api/auth/me?lite=1");
          const nextToken = data?.token || "";
          if (data?.user && nextToken) {
            setSession(nextToken, data.user);
            cacheSessionData(nextToken, data);
            setUserUI(data.user);
            showModal(false);
            void refreshCloudBadges();
            return data;
          }
        } catch (err) {
          if (isTransientAuthFailure(err)) {
            return null;
          }
        }
        clearSession();
        setLoggedOutUI();
        return null;
      }
      const cachedSession = getCachedSession(token);
      const storedUser = getStoredUser();
      const stubUser = userStubFromToken(token);
      const fallbackSession = cachedSession
        || (storedUser ? { user: storedUser, teams: [], ai: null, cached: true } : null)
        || (stubUser ? { user: stubUser, teams: [], ai: null, cached: true } : null);
      if (fallbackSession?.user) {
        setUserUI(fallbackSession.user);
        showModal(false);
      }
      const sessionWork = (async () => {
        const data = await fetchCurrentSessionWithRetry();
        setSession(token, data.user);
        cacheSessionData(token, data);
        setUserUI(data.user);
        showModal(false);
        void refreshCloudBadges();
        return data;
      })();
      if (fallbackSession?.user) {
        void sessionWork.catch(() => {});
        return fallbackSession;
      }
      try {
        return await sessionWork;
      } catch (err) {
        // Only drop the local JWT when it is actually past exp. A 401/502
        // during uvicorn KeepAlive must not force a re-login.
        if (isTokenExpired(token)) {
          clearSession();
          setLoggedOutUI();
          showModal(true);
          setAuthError("Session expired — sign in again to load your projects.");
          return null;
        }
        showModal(false);
        return fallbackSession;
      }
    },
  };
}
