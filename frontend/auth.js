/** Auth token storage and login/register popup. */

const TOKEN_KEY = "render3d:token";
const USER_KEY = "render3d:user";

const ADMIN_EMAILS = new Set([
  "a1projects@protonmail.com",
  "a1projects.usa@gmail.com",
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
}

export function authHeaders(extra = {}) {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

function userInitial(user) {
  const name = user?.display_name?.trim() || user?.email?.trim() || "?";
  return name.charAt(0).toUpperCase();
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

  let loggedInUser = null;

  function setOnshapeBadge(show) {
    onshapeBadge?.classList.toggle("hidden", !show);
    if (onshapeStatusEl) onshapeStatusEl.textContent = show ? "Connected" : "Disconnected";
  }

  function setFusionBadge(show, account = null) {
    fusionBadge?.classList.toggle("hidden", !show);
    if (fusionStatusEl) {
      if (!show) fusionStatusEl.textContent = "Disconnected";
      else {
        const label = account?.autodesk_email || account?.autodesk_name || "Connected";
        fusionStatusEl.textContent = label;
      }
    }
  }

  function showModal(show) {
    modal?.classList.toggle("hidden", !show);
    if (show) {
      authError.textContent = "";
      document.getElementById("login-email")?.focus();
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
    authError.textContent = "";
    document.getElementById("auth-title").textContent = tab === "register" ? "Create account" : "Welcome back";
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
    try {
      const data = await api("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      setSession(data.token, data.user);
      setUserUI(data.user);
      showModal(false);
      onReady?.(data);
    } catch (err) {
      authError.textContent = err.message;
    }
  });

  formRegister?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("register-email").value.trim();
    const password = document.getElementById("register-password").value;
    const display_name = document.getElementById("register-name").value.trim();
    try {
      const data = await api("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, display_name }),
      });
      setSession(data.token, data.user);
      setUserUI(data.user);
      showModal(false);
      onReady?.(data);
    } catch (err) {
      authError.textContent = err.message;
    }
  });

  btnLogout?.addEventListener("click", () => {
    clearSession();
    setLoggedOutUI();
    closeUserMenu();
    showModal(false);
    window.location.reload();
  });

  // "Sign in with Onshape" buttons (one inside the modal, one can be anywhere)
  document.querySelectorAll("[data-onshape-login]").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.location.href = "/oauth/start";
    });
  });

  document.querySelectorAll("[data-autodesk-login]").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.location.href = "/oauth/autodesk/start";
    });
  });

  // Cloud connection buttons in user menu
  document.getElementById("btn-onshape-connect")?.addEventListener("click", () => {
    closeUserMenu();
    if (onshapeBadge && !onshapeBadge.classList.contains("hidden")) {
      // Already connected — show status/disconnect option via onshape panel
      document.getElementById("btn-onshape-panel")?.click();
    } else {
      window.location.href = "/oauth/start";
    }
  });

function openFusionLibraryPanel() {
  window.dispatchEvent(new CustomEvent("render3d:open-fusion-library"));
}

  async function startAutodeskConnect({ promptForCredentials = true } = {}) {
    if (!loggedInUser) {
      showModal(true);
      switchTab("login");
      throw new Error("Sign in to Render3D first, then connect Autodesk Fusion 360.");
    }
    try {
      const status = await api("/api/autodesk/status");
      if (status?.linked) {
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
        window.location.href = oauth.url;
        return { linked: false, redirecting: true };
      }
    } catch (err) {
      if (promptForCredentials && /not configured|AUTODESK_CLIENT/i.test(err.message || "")) {
        throw err;
      }
    }
    window.location.href = "/oauth/autodesk/start";
    return { linked: false, redirecting: true };
  }

  document.getElementById("btn-fusion-connect")?.addEventListener("click", () => {
    closeUserMenu();
    if (fusionBadge && !fusionBadge.classList.contains("hidden")) {
      openFusionLibraryPanel();
    } else {
      void startAutodeskConnect({ promptForCredentials: false });
    }
  });

  window.addEventListener("render3d:autodesk-unlinked", () => {
    setFusionBadge(false);
  });

  window.addEventListener("render3d:autodesk-linked", async () => {
    try {
      const fs = await api("/api/autodesk/status");
      setFusionBadge(fs.linked === true, fs);
    } catch {
      setFusionBadge(true);
    }
  });

  setLoggedOutUI();

  return {
    openModal() {
      showModal(true);
      switchTab("login");
    },
    setUser(user) {
      if (user) setUserUI(user);
      else setLoggedOutUI();
    },
    startAutodeskConnect,
    async bootstrap() {
      // Handle redirect back from Onshape: /oauth/callback → /?onshape_token=JWT
      const params = new URLSearchParams(window.location.search);
      const oauthToken = params.get("onshape_token");
      const oauthError = params.get("onshape_error");
      const autodeskLinked = params.get("autodesk_linked");
      const autodeskError = params.get("autodesk_error");
      const renderToken = params.get("render3d_token");

      if (autodeskError) {
        history.replaceState({}, "", window.location.pathname);
        if (authError) authError.textContent = `Fusion login failed: ${decodeURIComponent(autodeskError)}`;
        showModal(true);
        return null;
      }

      if (autodeskLinked && renderToken) {
        history.replaceState({}, "", window.location.pathname);
        try {
          localStorage.setItem(TOKEN_KEY, renderToken);
          const data = await api("/api/auth/me");
          setSession(renderToken, data.user);
          setUserUI(data.user);
          setFusionBadge(true);
          showModal(false);
          try {
            const fs = await api("/api/autodesk/status");
            setFusionBadge(true, fs);
          } catch {
            setFusionBadge(true);
          }
          window.dispatchEvent(new CustomEvent("render3d:autodesk-linked"));
          return data;
        } catch {
          clearSession();
          setLoggedOutUI();
          return null;
        }
      }

      if (oauthError) {
        // Clean URL, show error
        history.replaceState({}, "", window.location.pathname);
        if (authError) authError.textContent = `Onshape login failed: ${oauthError}`;
        showModal(true);
        return null;
      }

      if (oauthToken) {
        // Store the token, then fetch user info
        history.replaceState({}, "", window.location.pathname);
        try {
          localStorage.setItem(TOKEN_KEY, oauthToken);
          const data = await api("/api/auth/me");
          setSession(oauthToken, data.user);
          setUserUI(data.user);
          setOnshapeBadge(true);
          showModal(false);
          return data;
        } catch {
          clearSession();
          setLoggedOutUI();
          return null;
        }
      }

      const token = getToken();
      if (!token) {
        setLoggedOutUI();
        return null;
      }
      try {
        const data = await api("/api/auth/me");
        setSession(token, data.user);
        setUserUI(data.user);
        showModal(false);
        // Check Onshape + Fusion connection status
        try {
          const os = await api("/api/onshape/status");
          setOnshapeBadge(os.linked === true);
        } catch { /* non-critical */ }
        try {
          const fs = await api("/api/autodesk/status");
          setFusionBadge(fs.linked === true, fs);
          if (fs.linked === true) {
            window.dispatchEvent(new CustomEvent("render3d:autodesk-linked"));
          }
        } catch { /* non-critical */ }
        return data;
      } catch {
        clearSession();
        setLoggedOutUI();
        return null;
      }
    },
  };
}
