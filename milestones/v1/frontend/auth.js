/** Auth token storage and login/register popup. */

const TOKEN_KEY = "render3d:token";
const USER_KEY = "render3d:user";

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

export function createAuthUI({ api, onReady }) {
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

  let loggedInUser = null;

  function showModal(show) {
    modal?.classList.toggle("hidden", !show);
    if (show) {
      authError.textContent = "";
      document.getElementById("login-email")?.focus();
    }
  }

  function setLoggedOutUI() {
    loggedInUser = null;
    btnAuth?.classList.remove("signed-in");
    authIcon?.classList.remove("hidden");
    authAvatar?.classList.add("hidden");
    userMenu?.classList.add("hidden");
    btnAuth?.setAttribute("title", "Sign in");
    btnAuth?.setAttribute("aria-label", "Sign in");
  }

  function setUserUI(user) {
    loggedInUser = user;
    btnAuth?.classList.add("signed-in");
    authIcon?.classList.add("hidden");
    const initial = userInitial(user);
    if (authAvatar) {
      authAvatar.textContent = initial;
      authAvatar.classList.remove("hidden");
    }
    if (authAvatarLg) authAvatarLg.textContent = initial;
    if (userLabel) userLabel.textContent = user.display_name;
    if (userEmail) userEmail.textContent = user.email;
    btnAuth?.setAttribute("title", user.display_name);
    btnAuth?.setAttribute("aria-label", `Account: ${user.display_name}`);
  }

  function closeUserMenu() {
    userMenu?.classList.add("hidden");
  }

  function toggleUserMenu() {
    if (!loggedInUser) return;
    userMenu?.classList.toggle("hidden");
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

  setLoggedOutUI();

  return {
    openModal() {
      showModal(true);
      switchTab("login");
    },
    async bootstrap() {
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
        return data;
      } catch {
        clearSession();
        setLoggedOutUI();
        return null;
      }
    },
  };
}
