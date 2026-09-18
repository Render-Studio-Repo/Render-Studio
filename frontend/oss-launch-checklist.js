const FIRST_PARTY_HOSTS = new Set(["render3d.app", "www.render3d.app"]);
const CHECKLIST_SEEN_KEY = `render3d:ossLaunchChecklistSeen:v1:${window.location.host.toLowerCase()}`;
const WELCOME_SEEN_KEY = "render3d:welcomeSeen:v1";
const TOKEN_KEY = "render3d:token";

function esc(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function storageGet(storage, key) {
  try {
    return storage.getItem(key) || "";
  } catch {
    return "";
  }
}

function storageSet(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch {
    /* ignore storage failures */
  }
}

function isOssStudioHost() {
  return !FIRST_PARTY_HOSTS.has((window.location.hostname || "").toLowerCase());
}

function hasToken() {
  return !!storageGet(window.localStorage, TOKEN_KEY);
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fallbackPayload(message = "Could not inspect OSS launch state.") {
  return {
    knowledge_state: {
      kind: "inspection_error",
      status: "fail",
      fail_closed: true,
      summary: "FAIL — could not inspect knowledge storage, so OSS launch stays fail-closed.",
      details: [
        message,
        "Fix the KB database/storage issue before treating this as a first launch.",
      ],
      counts: {
        knowledge_bases: 0,
        knowledge_folders: 0,
        knowledge_items: 0,
        knowledge_skill_links: 0,
        knowledge_shares: 0,
        knowledge_user_dirs: 0,
        knowledge_kb_dirs: 0,
        knowledge_storage_files: 0,
        knowledge_storage_bytes: 0,
      },
    },
  };
}

function suppressDefaultWelcome() {
  storageSet(window.localStorage, WELCOME_SEEN_KEY, "1");
  document.getElementById("welcome-modal")?.classList.add("hidden");
}

function closeChecklist(modal) {
  modal?.classList.add("hidden");
}

function syncOptionalCopy(modal) {
  const toggle = modal?.querySelector("#oss-launch-ecosystem-sync");
  const note = modal?.querySelector("#oss-launch-sync-note");
  if (!toggle || !note) return;
  note.textContent = toggle.checked
    ? "If you create an account from here, Fusion 360 and Onshape will already be checked as optional follow-ups."
    : "Leave this unchecked for a simpler first launch.";
}

function renderChecklistState(modal, payload) {
  const state = payload?.knowledge_state || fallbackPayload().knowledge_state;
  const counts = state.counts || {};
  const clean = state.kind === "clean";
  const halfSeeded = state.kind === "half_seeded";

  modal?.querySelector("#oss-launch-checklist-summary")?.replaceChildren(
    document.createTextNode(state.summary || "Inspecting install state."),
  );

  const verdict = modal?.querySelector("#oss-launch-verdict");
  verdict?.classList.toggle("is-pass", clean);
  verdict?.classList.toggle("is-fail", !clean);

  const verdictBadge = modal?.querySelector("#oss-launch-verdict-badge");
  if (verdictBadge) verdictBadge.textContent = clean ? "PASS" : "FAIL";

  const verdictTitle = modal?.querySelector("#oss-launch-verdict-title");
  if (verdictTitle) {
    verdictTitle.textContent = clean
      ? "Knowledge storage is empty."
      : halfSeeded
        ? "Knowledge storage looks half-seeded."
        : "Knowledge storage already has data.";
  }

  const verdictText = modal?.querySelector("#oss-launch-verdict-text");
  if (verdictText) {
    verdictText.textContent = clean
      ? "This install matches the expected clean first-launch path."
      : "This install should not be treated as a clean first launch until KB storage is fixed.";
  }

  const kbChip = modal?.querySelector("#oss-launch-kb-chip");
  if (kbChip) {
    kbChip.textContent = clean ? "PASS" : "FAIL";
    kbChip.classList.toggle("is-pass", clean);
    kbChip.classList.toggle("is-fail", !clean);
  }

  const detailLines = [
    `DB: ${Number(counts.knowledge_bases || 0)} base(s) · ${Number(counts.knowledge_items || 0)} file(s) · ${Number(counts.knowledge_skill_links || 0)} skill link(s) · ${Number(counts.knowledge_shares || 0)} share row(s)`,
    `Disk: ${Number(counts.knowledge_kb_dirs || 0)} KB folder(s) · ${Number(counts.knowledge_storage_files || 0)} file(s) · ${formatBytes(counts.knowledge_storage_bytes || 0)}`,
    ...(Array.isArray(state.details) ? state.details : []),
  ];
  const detailList = modal?.querySelector("#oss-launch-kb-details");
  if (detailList) {
    detailList.innerHTML = detailLines.map((line) => `<li>${esc(line)}</li>`).join("");
  }
}

function openCreateAccount(modal) {
  const wantsSync = !!modal?.querySelector("#oss-launch-ecosystem-sync")?.checked;
  closeChecklist(modal);
  if (wantsSync) {
    const onshape = document.getElementById("auth-connect-onshape");
    const fusion = document.getElementById("auth-connect-fusion");
    if (onshape instanceof HTMLInputElement) onshape.checked = true;
    if (fusion instanceof HTMLInputElement) fusion.checked = true;
  }
  document.getElementById("btn-auth")?.click();
  window.requestAnimationFrame(() => {
    document.querySelector("#auth-modal .auth-tab[data-tab='register']")?.click();
    document.getElementById("register-name")?.focus();
  });
}

async function initOssLaunchChecklist() {
  if (!isOssStudioHost()) return;
  suppressDefaultWelcome();
  if (storageGet(window.localStorage, CHECKLIST_SEEN_KEY) === "1") return;

  const modal = document.getElementById("oss-launch-checklist-modal");
  if (!modal) return;

  modal.querySelectorAll("[data-oss-launch-close]").forEach((el) => {
    el.addEventListener("click", () => closeChecklist(modal));
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !modal.classList.contains("hidden")) {
      closeChecklist(modal);
    }
  });
  modal.querySelector("#oss-launch-ecosystem-sync")?.addEventListener("change", () => {
    syncOptionalCopy(modal);
  });
  modal.querySelector("#oss-launch-create-account")?.addEventListener("click", () => {
    openCreateAccount(modal);
  });
  const createAccountBtn = modal.querySelector("#oss-launch-create-account");
  if (hasToken() && createAccountBtn instanceof HTMLButtonElement) {
    createAccountBtn.hidden = true;
  }
  modal.querySelectorAll(".oss-launch-actions a").forEach((el) => {
    el.addEventListener("click", () => closeChecklist(modal));
  });
  syncOptionalCopy(modal);

  let payload = fallbackPayload();
  try {
    const res = await fetch("/api/oss-launch-checklist", { credentials: "same-origin" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    payload = await res.json();
  } catch (err) {
    payload = fallbackPayload(err?.message || "Could not load /api/oss-launch-checklist.");
  }
  renderChecklistState(modal, payload);
  storageSet(window.localStorage, CHECKLIST_SEEN_KEY, "1");
  modal.classList.remove("hidden");
  const focusTarget = modal.querySelector("#oss-launch-create-account:not([hidden])")
    || modal.querySelector(".oss-launch-footer-actions .btn")
    || modal.querySelector(".oss-launch-actions .welcome-action");
  focusTarget?.focus();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initOssLaunchChecklist);
} else {
  void initOssLaunchChecklist();
}
