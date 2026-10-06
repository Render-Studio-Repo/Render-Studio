const TOKEN_KEY = "render3d:token";
const state = { account: false, ai: false, subscription: false };

function token() {
  try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; }
}

function setToken(value) {
  localStorage.setItem(TOKEN_KEY, value);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers["Content-Type"] = "application/json";
  if (token()) headers.Authorization = `Bearer ${token()}`;
  const response = await fetch(path, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.detail || data.message || `Request failed (${response.status})`);
  return data;
}

function status(id, message, kind = "") {
  const element = document.getElementById(id);
  element.textContent = message;
  element.className = `status ${kind}`.trim();
}

function showStep(number) {
  document.querySelectorAll("[data-step]").forEach((panel) => panel.classList.toggle("active", panel.dataset.step === String(number)));
  document.querySelectorAll("[data-step-link]").forEach((button) => button.classList.toggle("active", button.dataset.stepLink === String(number)));
}

function completeAccount(user) {
  state.account = true;
  document.getElementById("account-forms").classList.add("hidden");
  const complete = document.getElementById("account-complete");
  complete.textContent = `Signed in as ${user.display_name || user.email}.`;
  complete.classList.remove("hidden");
  window.setTimeout(() => showStep(2), 350);
}

async function authenticate(path, form) {
  status("account-status", "Connecting…");
  const payload = Object.fromEntries(new FormData(form));
  try {
    const data = await api(path, { method: "POST", body: JSON.stringify(payload) });
    setToken(data.token);
    completeAccount(data.user || {});
  } catch (error) {
    status("account-status", error.message, "error");
  }
}

document.getElementById("register-form").addEventListener("submit", (event) => {
  event.preventDefault();
  authenticate("/api/auth/register", event.currentTarget);
});

document.getElementById("login-form").addEventListener("submit", (event) => {
  event.preventDefault();
  authenticate("/api/auth/login", event.currentTarget);
});

document.getElementById("key-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.account) return status("ai-status", "Create or sign in to your account first.", "error");
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  status("ai-status", "Saving your encrypted key…");
  try {
    await api("/api/user/ai-keys", { method: "POST", body: JSON.stringify(payload) });
    state.ai = true;
    event.currentTarget.querySelector('[name="api_key"]').value = "";
    status("ai-status", "API key saved and activated.", "success");
    window.setTimeout(() => showStep(3), 350);
  } catch (error) {
    status("ai-status", error.message, "error");
  }
});

document.getElementById("subscription-choice").addEventListener("click", () => {
  state.subscription = true;
  status("ai-status", "Subscription setup selected. AI & Billing will open after setup.", "success");
  document.getElementById("open-studio").href = "/?setup_ai=subscriptions";
  showStep(3);
});

document.getElementById("skip-ai").addEventListener("click", () => showStep(3));
document.querySelectorAll("[data-step-link]").forEach((button) => button.addEventListener("click", () => showStep(button.dataset.stepLink)));

function markCheck(id, ok, text) {
  const row = document.getElementById(id);
  row.classList.toggle("ok", ok);
  row.classList.toggle("warn", !ok);
  if (text) row.lastChild.textContent = text;
}

async function verify() {
  status("verify-status", "Checking this installation…");
  let server = false;
  let account = false;
  let ai = state.ai || state.subscription;
  try {
    const response = await fetch("/api/health");
    server = response.ok;
  } catch { server = false; }
  if (token()) {
    try {
      const data = await api("/api/auth/me");
      account = Boolean(data.user);
      const aiData = data.ai || {};
      ai = ai || Boolean(aiData.configured || aiData.has_key || aiData.provider);
    } catch { account = false; }
  }
  state.account = account;
  markCheck("check-server", server, server ? "Local Render server is running" : "Local Render server did not respond");
  markCheck("check-account", account, account ? "Render account is signed in" : "Create or sign in to a Render account");
  markCheck("check-ai", ai, ai ? (state.subscription ? "Subscription setup selected" : "AI access is configured") : "AI access can be added now or later");
  const ready = server && account;
  document.getElementById("open-studio").classList.toggle("hidden", !ready);
  status("verify-status", ready ? "Setup is ready. Open Render Studio to begin." : "Complete the required account step, then run the check again.", ready ? "success" : "error");
}

document.getElementById("verify-button").addEventListener("click", verify);

async function restoreSession() {
  if (!token()) return;
  try {
    const data = await api("/api/auth/me");
    if (data.user) completeAccount(data.user);
  } catch {
    localStorage.removeItem(TOKEN_KEY);
  }
}

restoreSession();
