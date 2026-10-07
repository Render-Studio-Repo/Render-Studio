/** First-run: connect YOUR Supabase or keep sqlite local. Never stores service_role in the browser. */

const statusEl = document.getElementById("setup-status");
const connectStatus = document.getElementById("connect-status");
const localStatus = document.getElementById("local-status");
const sqlBox = document.getElementById("setup-sql");
const promptBox = document.getElementById("setup-prompt");
const form = document.getElementById("setup-form");

function setStatus(el, text, kind) {
  if (!el) return;
  el.textContent = text || "";
  el.classList.remove("ok", "err");
  if (kind) el.classList.add(kind);
}

function token() {
  try {
    return localStorage.getItem("render3d:token") || "";
  } catch {
    return "";
  }
}

function headers(json = true) {
  const h = {};
  if (json) h["Content-Type"] = "application/json";
  const t = token();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

async function api(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { ...headers(Boolean(opts.body)), ...(opts.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || data.message || `HTTP ${res.status}`);
  return data;
}

function fillTelemetry(data) {
  const card = document.getElementById("setup-telemetry-card");
  const lead = document.getElementById("setup-telemetry-lead");
  const actions = document.getElementById("setup-telemetry-actions");
  const idEl = document.getElementById("setup-telemetry-id");
  const status = document.getElementById("telemetry-status");
  if (!card) return;
  const official = Boolean(data.is_official_hub) || /(?:^|\.)render3d\.app$/i.test(location.hostname);
  if (idEl && data.instance_id) {
    idEl.textContent = `Instance id: ${data.instance_id}`;
  }
  if (official) {
    if (lead) {
      lead.textContent = "This is the public Render hub. Bug reports stay on the debugger API, cluster by traceback + feature check, and train Grok to match the same scenario across servers.";
    }
    if (actions) actions.hidden = true;
    setStatus(status, "Public hub — similar submissions are counted automatically.", "ok");
    return;
  }
  if (data.telemetry_answered) {
    if (actions) actions.hidden = true;
    setStatus(status, data.telemetry_opt_in
      ? "Sharing that issue’s traceback + feature check with Render."
      : "Debug logs stay on this machine.", data.telemetry_opt_in ? "ok" : "");
    return;
  }
  if (data.telemetry_answered === false) {
    if (actions) actions.hidden = false;
    return;
  }
  if (actions) actions.hidden = true;
}

async function setTelemetry(optIn) {
  const status = document.getElementById("telemetry-status");
  setStatus(status, "Saving…");
  try {
    const data = await api("/api/setup/telemetry", {
      method: "POST",
      body: JSON.stringify({ opt_in: Boolean(optIn) }),
    });
    setStatus(status, data.telemetry_opt_in
      ? "Thanks. Only that issue’s traceback and a feature check will be sent."
      : "Kept on this machine. You can change this later on this setup page.", data.telemetry_opt_in ? "ok" : "");
    const actions = document.getElementById("setup-telemetry-actions");
    if (actions) actions.hidden = true;
  } catch (err) {
    setStatus(status, err.message || "Could not save that choice.", "err");
  }
}

function fillMeta(data) {
  const backend = document.getElementById("setup-backend");
  const count = document.getElementById("setup-count");
  const unlocked = document.getElementById("setup-unlocked");
  if (backend) backend.textContent = data.users_backend || "unset";
  if (count) count.textContent = data.users_count == null ? "—" : String(data.users_count);
  if (unlocked) unlocked.textContent = data.setup_unlocked ? "this machine / admin can save" : "locked (sign in as admin)";
  fillTelemetry(data);
  fillInstanceNetwork(data.instance_network || {});
}

function fillInstanceNetwork(data) {
  const name = document.getElementById("instance-network-name");
  const reporting = document.getElementById("instance-network-reporting");
  const publicNetwork = document.getElementById("instance-network-public");
  const ecosystem = document.getElementById("instance-network-ecosystem");
  const id = document.getElementById("instance-network-id");
  if (name && data.instance_name) name.value = data.instance_name;
  if (reporting) reporting.checked = Boolean(data.reporting_opt_in);
  if (publicNetwork) publicNetwork.checked = Boolean(data.public_network);
  if (ecosystem) ecosystem.checked = Boolean(data.ecosystem_opt_in);
  if (id) id.textContent = data.instance_id ? `Instance id: ${data.instance_id}` : "";
  const updates = document.getElementById("instance-update-notifications");
  if (updates) updates.checked = Boolean(data.update_notifications);
}

let pendingUpdate = null;

async function checkForUpdate() {
  const status = document.getElementById("instance-update-status");
  const apply = document.getElementById("btn-apply-update");
  setStatus(status, "Checking the official stable channel…");
  if (apply) apply.hidden = true;
  try {
    const data = await api("/api/setup/instance-updates/check");
    pendingUpdate = data.available ? data.release : null;
    if (apply) apply.hidden = !pendingUpdate;
    setStatus(status, !data.enabled
      ? "Update notices are off. Enable them and save the preference first."
      : data.available
        ? `${data.release.version} is available. ${data.release.notes || "Review and install when ready."}`
        : data.offline ? "The official update service is temporarily unavailable." : "This instance is current.",
    data.available || (!data.offline && data.enabled) ? "ok" : "");
  } catch (err) {
    setStatus(status, err.message || "Could not check for updates.", "err");
  }
}

async function loadStatus() {
  try {
    const data = await api("/api/setup/status");
    fillMeta(data);
    setStatus(statusEl, data.answered ? `Saved choice: ${data.users_backend}` : "Not configured yet — pick Supabase or local sqlite.", data.answered ? "ok" : "");
  } catch (err) {
    setStatus(statusEl, err.message || "Could not load setup status.", "err");
  }
}

async function chooseLocalSetup() {
  const modeStatus = document.getElementById("setup-mode-status");
  setStatus(modeStatus, "Preparing a private local installation…");
  try {
    await api("/api/setup/local", { method: "POST", body: "{}" });
    await api("/api/setup/instance-network", {
      method: "POST",
      body: JSON.stringify({
        instance_name: document.getElementById("instance-network-name")?.value || "Render Studio instance",
        reporting_opt_in: false,
        public_network: false,
        ecosystem_opt_in: false,
      }),
    });
    setStatus(modeStatus, "Local mode is ready. Create or sign in to a local account when you open Studio.", "ok");
    await loadStatus();
  } catch (err) {
    setStatus(modeStatus, err.message || "Could not enable local mode.", "err");
  }
}

async function chooseRenderEcosystem() {
  const modeStatus = document.getElementById("setup-mode-status");
  setStatus(modeStatus, "Checking Render’s account service…");
  try {
    const login = await api("/api/setup/render-login-status");
    if (!login.reachable) {
      throw new Error("Render’s login service is not reachable. You can continue locally and connect later.");
    }
    await api("/api/setup/local", { method: "POST", body: "{}" });
    await api("/api/setup/instance-network", {
      method: "POST",
      body: JSON.stringify({
        instance_name: document.getElementById("instance-network-name")?.value || "Render Studio instance",
        reporting_opt_in: false,
        public_network: false,
        ecosystem_opt_in: true,
      }),
    });
    setStatus(modeStatus, "Render login is available. Sign in in the new tab, then return here to finish local setup.", "ok");
    window.open(login.login_url, "render-account-login", "noopener,noreferrer");
    await loadStatus();
  } catch (err) {
    setStatus(modeStatus, err.message || "Could not connect to Render.", "err");
  }
}

document.getElementById("btn-private-local")?.addEventListener("click", chooseLocalSetup);
document.getElementById("btn-render-ecosystem")?.addEventListener("click", chooseRenderEcosystem);

async function loadSql() {
  const data = await api("/api/setup/sql");
  if (sqlBox) sqlBox.textContent = data.sql || "";
  const cmd = document.getElementById("setup-copy-cmd");
  if (cmd) cmd.textContent = data.copy_command || "";
}

async function loadPrompt() {
  const data = await api("/api/setup/harness-prompt");
  if (promptBox) promptBox.textContent = data.prompt || "";
}

async function copyFrom(el, btn) {
  const text = el?.textContent || "";
  await navigator.clipboard.writeText(text);
  const prev = btn?.textContent;
  if (btn) {
    btn.textContent = "Copied";
    setTimeout(() => { btn.textContent = prev; }, 1400);
  }
}

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fd = new FormData(form);
  setStatus(connectStatus, "Connecting…");
  try {
    const data = await api("/api/setup/supabase", {
      method: "POST",
      body: JSON.stringify({
        url: String(fd.get("url") || "").trim(),
        publishable_key: String(fd.get("publishable_key") || "").trim(),
        service_role_key: String(fd.get("service_role_key") || "").trim(),
        secret_key: String(fd.get("secret_key") || "").trim(),
        access_token: String(fd.get("access_token") || "").trim(),
        apply_schema: true,
      }),
    });
    form.querySelectorAll('input[type="password"]').forEach((input) => { input.value = ""; });
    setStatus(connectStatus, data.ok
      ? `Connected. users_backend=${data.users_backend}, Users count=${data.users_count ?? "—"}.`
      : (data.hint || "Saved, but Users is not reachable yet. Apply SQL, then Connect again."), data.ok ? "ok" : "err");
    loadStatus();
  } catch (err) {
    setStatus(connectStatus, err.message || "Connect failed.", "err");
  }
});

document.getElementById("btn-local")?.addEventListener("click", async () => {
  setStatus(localStatus, "Saving…");
  try {
    const data = await api("/api/setup/local", { method: "POST", body: "{}" });
    setStatus(localStatus, data.hint || "Using local sqlite.", "ok");
    loadStatus();
  } catch (err) {
    setStatus(localStatus, err.message || "Could not save local mode.", "err");
  }
});

document.getElementById("btn-copy-sql")?.addEventListener("click", (event) => copyFrom(sqlBox, event.currentTarget));
document.getElementById("btn-copy-prompt")?.addEventListener("click", (event) => copyFrom(promptBox, event.currentTarget));
document.getElementById("btn-copy-cmd")?.addEventListener("click", (event) => {
  const cmd = document.getElementById("setup-copy-cmd");
  copyFrom(cmd, event.currentTarget);
});

document.getElementById("btn-telemetry-yes")?.addEventListener("click", () => setTelemetry(true));
document.getElementById("btn-telemetry-no")?.addEventListener("click", () => setTelemetry(false));

document.getElementById("instance-network-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.getElementById("instance-network-status");
  setStatus(status, "Saving and testing the hub…");
  try {
    const data = await api("/api/setup/instance-network", {
      method: "POST",
      body: JSON.stringify({
        instance_name: document.getElementById("instance-network-name")?.value || "Render Studio instance",
        reporting_opt_in: Boolean(document.getElementById("instance-network-reporting")?.checked),
        public_network: Boolean(document.getElementById("instance-network-public")?.checked),
        ecosystem_opt_in: Boolean(document.getElementById("instance-network-ecosystem")?.checked),
      }),
    });
    fillInstanceNetwork(data);
    const registration = data.registration || {};
    const ecosystem = data.ecosystem_opt_in
      ? (data.ecosystem_registration?.ok
        ? " This instance ID is registered. Shared marketplace browsing is on, and publishing remains approval-gated for locally approved public items."
        : " Ecosystem access is saved, but the Render hub is offline. Registration will need to be retried.")
      : " Marketplace sharing is off.";
    setStatus(status, (data.reporting_opt_in
      ? (registration.ok ? "Connected. Aggregate health will refresh about every five minutes." : "Saved. The health hub is currently unreachable; reporting will retry automatically.")
      : "Saved. This instance will not report health to Render.") + ecosystem,
    registration.ok || !data.reporting_opt_in ? "ok" : "err");
  } catch (err) {
    setStatus(status, err.message || "Could not save instance settings.", "err");
  }
});

document.getElementById("btn-save-update-setting")?.addEventListener("click", async () => {
  const status = document.getElementById("instance-update-status");
  try {
    const enabled = Boolean(document.getElementById("instance-update-notifications")?.checked);
    await api("/api/setup/instance-updates", { method: "POST", body: JSON.stringify({ enabled }) });
    setStatus(status, enabled ? "Admin update notices are on." : "Update notices are off.", "ok");
  } catch (err) {
    setStatus(status, err.message || "Could not save the update preference.", "err");
  }
});

document.getElementById("btn-check-update")?.addEventListener("click", checkForUpdate);
document.getElementById("btn-apply-update")?.addEventListener("click", async () => {
  const status = document.getElementById("instance-update-status");
  if (!pendingUpdate?.commit_sha) return;
  setStatus(status, "Installing the verified fast-forward update…");
  try {
    const data = await api("/api/setup/instance-updates/apply", {
      method: "POST",
      body: JSON.stringify({ commit_sha: pendingUpdate.commit_sha }),
    });
    pendingUpdate = null;
    document.getElementById("btn-apply-update").hidden = true;
    setStatus(status, data.restart_required
      ? "Update installed. Restart this Render instance when you are ready. Projects, data, and credentials were untouched."
      : "Update installed.", "ok");
  } catch (err) {
    setStatus(status, err.message || "The update was refused. Nothing was overwritten.", "err");
  }
});

document.getElementById("instance-support-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.getElementById("instance-support-status");
  setStatus(status, "Sending…");
  try {
    const data = await api("/api/setup/instance-support", {
      method: "POST",
      body: JSON.stringify({
        kind: document.getElementById("instance-support-kind")?.value || "support",
        subject: document.getElementById("instance-support-subject")?.value || "",
        message: document.getElementById("instance-support-message")?.value || "",
        diagnostic: document.getElementById("instance-support-diagnostic")?.value || "",
      }),
    });
    if (!data.ok) throw new Error(data.detail || "The support hub is currently unreachable.");
    event.currentTarget.reset();
    setStatus(status, `Received as ${data.id || "a support request"}.`, "ok");
  } catch (err) {
    setStatus(status, err.message || "Could not send this request.", "err");
  }
});

loadStatus();
loadSql().catch(() => {});
loadPrompt().catch(() => {});
