/** Auth token storage and login/register popup. */

const TOKEN_KEY = "render3d:token";
const USER_KEY = "render3d:user";
const SESSION_CACHE_KEY = "render3d:session:v1";
const PENDING_CONNECTION_PREFS_KEY = "render3d:pendingConnectionPrefs:v1";
const LOGOUT_RELOAD_KEY = "render3d:logoutReload:v1";
const FUSION_LINKED_CACHE_PREFIX = "render3d:fusionLinked:";

const ADMIN_EMAILS = new Set([
  "a1projects@protonmail.com",
  "a1projects.usa@gmail.com",
  "sam@render3d.app",
  "sam@smartcallusa.com",
  "samwins.stead@gmail.com",
  "mtgraytech@gmail.com",
]);

export function isAdminUser(user) {
  return ADMIN_EMAILS.has(String(user?.email || "").trim().toLowerCase());
}

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
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

function userInitial(user) {
  const name = user?.display_name?.trim() || user?.email?.trim() || "?";
  return name.charAt(0).toUpperCase();
}

function cacheSessionData(token, data = {}) {
  if (!token || !data?.user) return;
  try {
    localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({
      token,
      user: data.user,
      teams: Array.isArray(data.teams) ? data.teams : [],
      ai: data.ai || null,
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

function isInvalidSessionError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return /not authenticated|invalid or expired token|user not found|unauthorized|\b401\b/.test(msg);
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchSocialProviders() {
  try {
    const res = await fetch("/api/auth/social/providers", { headers: authHeaders() });
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
  const btnAuth = document.getElementById("btn-auth");
  const userMenu = document.getElementById("user-menu");
  const userLabel = document.getElementById("user-label");
  const userEmail = document.getElementById("user-email");
  const authAvatar = document.getElementById("auth-avatar");
  const authAvatarLg = document.getElementById("auth-avatar-lg");
  const authIcon = btnAuth?.querySelector(".auth-icon");
  const btnLogout = document.getElementById("btn-logout");
  const authError = document.getElementById("auth-error");
  const onshapeBadge = document.getElementById("onshape-badge");
  const fusionBadge = document.getElementById("fusion-badge");
  const adminDashboardLink = document.getElementById("btn-admin-dashboard");
  const adminDashboardToolbar = document.getElementById("btn-admin-dashboard-toolbar");
  const onshapeStatusEl = document.getElementById("onshape-connection-status");
  const fusionStatusEl = document.getElementById("fusion-connection-status");
  const fusionConnectBtn = document.getElementById("btn-fusion-connect");

  let loggedInUser = null;

  function setOnshapeBadge(show) {
    onshapeBadge?.classList.toggle("hidden", !show);
    if (onshapeStatusEl) onshapeStatusEl.textContent = show ? "Connected" : "Disconnected";
  }

  function setFusionBadge(show, account = null) {
    fusionBadge?.classList.toggle("hidden", !show);
    fusionConnectBtn?.classList.toggle("is-connected", !!show);
    fusionConnectBtn?.classList.toggle("is-disconnected", !show);
    if (fusionStatusEl) {
      if (!show) fusionStatusEl.textContent = "Click to connect";
      else {
        const label = account?.autodesk_email || account?.autodesk_name || "Connected";
        fusionStatusEl.textContent = label;
      }
    }
    fusionConnectBtn?.setAttribute(
      "title",
      show ? "Open Fusion Library" : "Connect Autodesk Fusion 360",
    );
    fusionConnectBtn?.setAttribute(
      "aria-label",
      show ? "Fusion 360 connected. Open Fusion Library." : "Fusion 360 disconnected. Click to connect.",
    );
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
      if (authError) authError.textContent = "";
      document.getElementById("login-email")?.focus();
      void refreshSocialProviders();
    }
  }

  function setLoggedOutUI() {
    loggedInUser = null;
    document.body.classList.remove("is-admin");
    btnAuth?.classList.remove("signed-in");
    authIcon?.classList.remove("hidden");
    authAvatar?.classList.add("hidden");
    userMenu?.classList.add("hidden");
    btnAuth?.setAttribute("title", "Sign in");
    btnAuth?.setAttribute("aria-label", "Sign in");
    setOnshapeBadge(false);
    setFusionBadge(false);
    adminDashboardLink?.classList.add("hidden");
    adminDashboardToolbar?.classList.add("hidden");
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
    btnAuth?.classList.add("signed-in");
    authIcon?.classList.add("hidden");
    if (authAvatar) {
      applyAvatarEl(authAvatar, user);
      authAvatar.classList.remove("hidden");
    }
    if (authAvatarLg) applyAvatarEl(authAvatarLg, user);
    if (userLabel) userLabel.textContent = user.display_name;
    if (userEmail) userEmail.textContent = user.email;
    btnAuth?.setAttribute("title", user.display_name);
    btnAuth?.setAttribute("aria-label", `Account: ${user.display_name}`);
    const isAdmin = isAdminUser(user);
    document.body.classList.toggle("is-admin", isAdmin);
    adminDashboardLink?.classList.toggle("hidden", !isAdmin);
    adminDashboardToolbar?.classList.toggle("hidden", !isAdmin);
    const cachedFusion = readCachedFusionAccount(user);
    if (cachedFusion) setFusionBadge(true, cachedFusion);
    else setFusionBadge(false);
  }

  function closeUserMenu() {
    userMenu?.classList.add("hidden");
  }

  function toggleUserMenu() {
    if (!loggedInUser) return;
    const opening = userMenu?.classList.contains("hidden");
    userMenu?.classList.toggle("hidden");
    if (opening) onUserMenuOpen?.();
  }

  function switchTab(tab) {
    modal?.querySelectorAll(".auth-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    formLogin?.classList.toggle("hidden", tab !== "login");
    formRegister?.classList.toggle("hidden", tab !== "register");
    if (authError) authError.textContent = "";
    const title = document.getElementById("auth-title");
    if (title) title.textContent = tab === "register" ? "Create account" : "Welcome back";
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
      setOnshapeBadge(os.linked === true);
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
        if (authError) authError.textContent = err.message || "Could not start Onshape connection.";
        watchOAuthPopup(openOAuthPopup("/oauth/start", "render3d-onshape-connect"));
      }
    }

    if (wantFusion) {
      try {
        const oauth = await api("/api/autodesk/oauth-url", { method: "POST" });
        if (!oauth?.url) throw new Error("Fusion OAuth URL missing");
        watchOAuthPopup(openOAuthPopup(oauth.url, "render3d-fusion-connect"));
      } catch (err) {
        if (authError) authError.textContent = err.message || "Could not start Fusion connection.";
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
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await api("/api/auth/me");
      } catch (err) {
        lastError = err;
        if (isInvalidSessionError(err) || attempt === 2) break;
        await delay(450 * (attempt + 1));
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

  document.addEventListener("click", () => closeUserMenu());
  userMenu?.addEventListener("click", (e) => e.stopPropagation());

  formLogin?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    const prefs = connectionPrefs();
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      await finishAuthSuccess(data, { connectPrefs: prefs });
    } catch (err) {
      if (authError) authError.textContent = err.message;
    }
  });

  formRegister?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("register-email").value.trim();
    const password = document.getElementById("register-password").value;
    const display_name = document.getElementById("register-name").value.trim();
    const prefs = connectionPrefs();
    try {
      const data = await api("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, display_name }),
      });
      await finishAuthSuccess(data, { connectPrefs: prefs });
    } catch (err) {
      if (authError) authError.textContent = err.message;
    }
  });

  btnLogout?.addEventListener("click", () => {
    try {
      sessionStorage.setItem(LOGOUT_RELOAD_KEY, "1");
    } catch {
      /* optional */
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
        if (authError) authError.textContent = `${label} sign-in is not configured yet.`;
        return;
      }
      btn.classList.add("is-loading");
      savePendingConnectionPrefs();
      window.location.href = `/oauth/${encodeURIComponent(provider)}/start`;
    });
  });

  document.getElementById("btn-onshape-connect")?.addEventListener("click", () => {
    closeUserMenu();
    if (onshapeBadge && !onshapeBadge.classList.contains("hidden")) {
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
        if (authError) authError.textContent = err.message || "Could not start Onshape connection.";
        else window.alert(err.message || "Could not start Onshape connection. Sign in first, then try again.");
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
      throw new Error("Sign in to Render3D first, then connect Autodesk Fusion 360.");
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
      if (authError) authError.textContent = err.message || "Could not start Fusion connection.";
    }
    return { linked: false, redirecting: false };
  }

  fusionConnectBtn?.addEventListener("click", () => {
    closeUserMenu();
    if (fusionBadge && !fusionBadge.classList.contains("hidden")) {
      openFusionLibraryPanel();
    } else {
      void startAutodeskConnect({ promptForCredentials: false }).catch((err) => {
        if (authError) authError.textContent = err.message || "Could not start Fusion connection.";
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
  setLoggedOutUI();

  return {
    openModal(opts = {}) {
      const email = String(opts?.email || "").trim();
      const tab = opts?.tab === "register" ? "register" : "login";
      if (email) {
        const loginEmail = document.getElementById("login-email");
        const registerEmail = document.getElementById("register-email");
        if (loginEmail) loginEmail.value = email;
        if (registerEmail) registerEmail.value = email;
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
        if (authError) authError.textContent = `${providerLabel} login failed: ${decodeURIComponent(socialError)}`;
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
          const data = await api("/api/auth/me");
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
        } catch {
          clearSession();
          setLoggedOutUI();
          if (inOAuthPopup) notifyOpenerAndClose(socialProvider, false, "session_failed");
          return null;
        }
      }

      if (autodeskError) {
        history.replaceState({}, "", window.location.pathname);
        if (authError) authError.textContent = `Fusion login failed: ${decodeURIComponent(autodeskError)}`;
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
          const data = await api("/api/auth/me");
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
        } catch {
          clearSession();
          setLoggedOutUI();
          if (inOAuthPopup) notifyOpenerAndClose("fusion", false, "session_failed");
          return null;
        }
      }

      if (oauthError) {
        history.replaceState({}, "", window.location.pathname);
        const detail = decodeURIComponent(oauthError);
        if (authError) authError.textContent = `Onshape login failed: ${detail}`;
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
        try {
          await refreshCloudBadges();
        } catch { /* non-critical */ }
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
          const data = await api("/api/auth/me");
          setSession(oauthToken, data.user);
          cacheSessionData(oauthToken, data);
          setUserUI(data.user);
          setOnshapeBadge(true);
          showModal(false);
          if (inOAuthPopup) notifyOpenerAndClose("onshape", true);
          return data;
        } catch {
          clearSession();
          setLoggedOutUI();
          if (inOAuthPopup) notifyOpenerAndClose("onshape", false, "session_failed");
          return null;
        }
      }

      const token = getToken();
      if (!token) {
        setLoggedOutUI();
        return null;
      }
      const cachedSession = getCachedSession(token);
      const storedUser = getStoredUser();
      const fallbackSession = cachedSession || (storedUser ? { user: storedUser, teams: [], ai: null, cached: true } : null);
      if (fallbackSession?.user) {
        setUserUI(fallbackSession.user);
        showModal(false);
      }
      try {
        const data = await fetchCurrentSessionWithRetry();
        setSession(token, data.user);
        cacheSessionData(token, data);
        setUserUI(data.user);
        showModal(false);
        await refreshCloudBadges();
        return data;
      } catch (err) {
        if (isInvalidSessionError(err)) {
          clearSession();
          setLoggedOutUI();
          return null;
        }
        if (fallbackSession?.user) {
          setUserUI(fallbackSession.user);
          showModal(false);
          return fallbackSession;
        }
        return null;
      }
    },
  };
}
