/**
 * Desktop Robotics → 3D Printer tab + Config popup (same prefs VR reads).
 */
import {
  applyPrinterConfigFields,
  printerConfigFromStorage,
  printerPrefsApiBody,
  printerShareIconVisible,
  PRINT_TAB_CACHE,
} from "../xr/xr-share-print.js?v=20260914-vrshare1-20260916-bambuip1-throwprint1-printbox1-xrperf3&printtab=20260916-1&printbox=20260916-2";

void PRINT_TAB_CACHE;

const PANE = "printer";

function storage() {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
}

function fillForm(root, cfg = {}) {
  if (!root) return;
  const set = (sel, value) => {
    const el = root.querySelector(sel);
    if (el) el.value = value || "";
  };
  set("[data-printer-lan-ip]", cfg.lan_ip);
  set("[data-printer-pin]", cfg.access_code);
  set("[data-printer-serial]", cfg.serial);
  set("[data-printer-name]", cfg.name);
  const accept = root.querySelector("[data-printer-accept]");
  const outline = root.querySelector("[data-printer-outline]");
  const model = root.querySelector("[data-printer-model]");
  if (accept) accept.checked = !!cfg.accept_sends;
  if (outline) outline.checked = !!cfg.show_outline;
  if (model) model.checked = !!cfg.show_model;
  const share = root.querySelector("[data-printer-share-icon]");
  if (share) share.hidden = !printerShareIconVisible({ acceptSends: cfg.accept_sends });
}

function readForm(root) {
  return {
    lan_ip: root.querySelector("[data-printer-lan-ip]")?.value || "",
    access_code: root.querySelector("[data-printer-pin]")?.value || "",
    serial: root.querySelector("[data-printer-serial]")?.value || "",
    name: root.querySelector("[data-printer-name]")?.value || "",
    accept_sends: !!root.querySelector("[data-printer-accept]")?.checked,
    show_outline: !!root.querySelector("[data-printer-outline]")?.checked,
    show_model: !!root.querySelector("[data-printer-model]")?.checked,
  };
}

function formHtml({ popup = false } = {}) {
  return `
    <div class="robotics-printer-chrome">
      <div class="robotics-section-head">
        <strong>3D Printer</strong>
        <span class="robotics-printer-icons">
          <span data-printer-share-icon class="robotics-printer-share-icon" hidden title="Printer is shared with others" aria-label="Shared">👥</span>
          <button type="button" class="btn secondary btn-compact" data-printer-gear title="Printer settings">⚙</button>
        </span>
      </div>
      <p class="muted small">Config writes the same LAN IP, PIN, serial, and bounder VR reads. Shared printers show the people icon.</p>
      <label class="robotics-ip-field">Printer LAN IP
        <input data-printer-lan-ip class="profile-pretty-input" type="text" spellcheck="false" autocomplete="off" placeholder="192.168.1.x" />
      </label>
      <label class="robotics-ip-field">PIN / access code
        <input data-printer-pin class="profile-pretty-input" type="password" spellcheck="false" autocomplete="off" placeholder="Printer screen · Bind with PIN" />
      </label>
      <label class="robotics-ip-field">Serial
        <input data-printer-serial class="profile-pretty-input" type="text" spellcheck="false" autocomplete="off" placeholder="Optional" />
      </label>
      <label class="robotics-ip-field">Printer name
        <input data-printer-name class="profile-pretty-input" type="text" spellcheck="false" autocomplete="off" placeholder="Optional" />
      </label>
      <label class="robotics-printer-check"><input data-printer-accept type="checkbox" /> Accept print requests (share with others)</label>
      <label class="robotics-printer-check"><input data-printer-outline type="checkbox" /> Printer boundary</label>
      <label class="robotics-printer-check"><input data-printer-model type="checkbox" /> Printer model</label>
      <div class="robotics-quest-actions">
        <button type="button" class="btn accent btn-compact" data-printer-config>Config</button>
        <button type="button" class="btn secondary btn-compact" data-printer-bounder>Create bounder</button>
        ${popup ? "" : '<button type="button" class="btn secondary btn-compact" data-printer-open-popup>Open settings</button>'}
      </div>
      <p class="muted small" data-printer-status></p>
    </div>`;
}

async function persistConfig({ api, root, onApply, extra = {} } = {}) {
  const fields = { ...readForm(root), ...extra };
  if (!String(fields.access_code || "").trim()) delete fields.access_code;
  const savedLocal = applyPrinterConfigFields(storage(), fields);
  let saved = savedLocal;
  if (api) {
    saved = await api("/api/me/printer-share", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(printerPrefsApiBody(fields)),
    });
    applyPrinterConfigFields(storage(), {
      ...fields,
      lan_ip: saved.lan_ip ?? fields.lan_ip,
      serial: saved.serial ?? fields.serial,
      name: saved.name ?? fields.name,
      accept_sends: saved.accept_sends,
      show_outline: saved.show_outline,
      show_model: saved.show_model,
      fence: saved.fence ?? fields.fence,
    });
  }
  await onApply?.(saved);
  return saved;
}

function bindForm(root, { api, onApply, onBounder, onGear } = {}) {
  const status = (msg) => {
    const el = root.querySelector("[data-printer-status]");
    if (el) el.textContent = msg || "";
  };
  const save = async (extra) => {
    try {
      await persistConfig({ api, root, onApply, extra });
      fillForm(root, printerConfigFromStorage(storage()));
      status("Saved. Headset and desktop use these printer settings.");
    } catch (err) {
      status(err?.message || "Could not save printer settings");
    }
  };
  root.querySelector("[data-printer-config]")?.addEventListener("click", () => void save());
  root.querySelector("[data-printer-gear]")?.addEventListener("click", () => {
    if (onGear) onGear();
    else void save();
  });
  root.querySelector("[data-printer-bounder]")?.addEventListener("click", async () => {
    try {
      const fields = readForm(root);
      fields.show_outline = true;
      const outline = root.querySelector("[data-printer-outline]");
      if (outline) outline.checked = true;
      await persistConfig({ api, root, onApply, extra: { show_outline: true } });
      await onBounder?.(fields);
      status("Bounder ready. In VR hover the box, grip to move, two grips to stretch.");
    } catch (err) {
      status(err?.message || "Could not create bounder");
    }
  });
  root.querySelector("[data-printer-open-popup]")?.addEventListener("click", () => {
    openRoboticsPrinterConfigPopup({ api, onApply, onBounder });
  });
  root.querySelectorAll("[data-printer-accept], [data-printer-outline], [data-printer-model]").forEach((el) => {
    el.addEventListener("change", () => void save());
  });
}

export function setRoboticsInnerTab(tab = "sim") {
  const id = tab === PANE ? PANE : "sim";
  document.querySelectorAll("[data-robotics-inner-tab]").forEach((btn) => {
    const on = btn.getAttribute("data-robotics-inner-tab") === id;
    btn.classList.toggle("active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll("[data-robotics-inner-pane]").forEach((pane) => {
    pane.hidden = pane.getAttribute("data-robotics-inner-pane") !== id;
  });
}

export function openRoboticsPrinterConfigPopup({ api, onApply, onBounder, focus = "" } = {}) {
  document.getElementById("robotics-printer-dialog")?.remove();
  const dialog = document.createElement("dialog");
  dialog.id = "robotics-printer-dialog";
  dialog.className = "robotics-profile-dialog robotics-printer-dialog";
  dialog.innerHTML = `<header><strong>3D Printer settings</strong><button type="button" data-close aria-label="Close">×</button></header>${formHtml({ popup: true })}`;
  document.body.append(dialog);
  fillForm(dialog, printerConfigFromStorage(storage()));
  bindForm(dialog, { api, onApply, onBounder, onGear: () => {} });
  dialog.querySelector("[data-close]")?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());
  try { dialog.showModal(); } catch { dialog.setAttribute("open", ""); }
  const focusSel = {
    lan_ip: "[data-printer-lan-ip]",
    pin: "[data-printer-pin]",
    access_code: "[data-printer-pin]",
    serial: "[data-printer-serial]",
    name: "[data-printer-name]",
  }[String(focus || "")];
  if (focusSel) dialog.querySelector(focusSel)?.focus();
  return dialog;
}

export function mountRoboticsPrinterTab({ api, onApply, onBounder } = {}) {
  const panel = document.getElementById("robotics-panel");
  if (!panel) return null;
  if (!panel.querySelector("[data-robotics-inner-tabs]")) {
    const tabs = document.createElement("div");
    tabs.className = "robotics-inner-tabs";
    tabs.setAttribute("data-robotics-inner-tabs", "1");
    tabs.setAttribute("role", "tablist");
    tabs.innerHTML = `
      <button type="button" class="robotics-inner-tab active" data-robotics-inner-tab="sim" role="tab" aria-selected="true">Robotics</button>
      <button type="button" class="robotics-inner-tab" data-robotics-inner-tab="printer" role="tab" aria-selected="false">3D Printer</button>`;
    const lead = panel.querySelector(".robotics-panel-lead") || panel.querySelector(".panel-section-head");
    lead?.after(tabs);
    tabs.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("[data-robotics-inner-tab]");
      if (btn) setRoboticsInnerTab(btn.getAttribute("data-robotics-inner-tab"));
    });
  }
  const existing = [...panel.children].filter((el) => (
    el.id !== "robotics-printer-pane"
    && !el.classList.contains("panel-section-head")
    && !el.classList.contains("robotics-panel-lead")
    && !el.classList.contains("robotics-inner-tabs")
    && el.id !== "dimos-viewer-robotics"
  ));
  if (!panel.querySelector("[data-robotics-inner-pane='sim']")) {
    const wrap = document.createElement("div");
    wrap.setAttribute("data-robotics-inner-pane", "sim");
    existing[0]?.before(wrap);
    existing.forEach((el) => wrap.append(el));
  }
  let pane = panel.querySelector("#robotics-printer-pane");
  if (!pane) {
    pane = document.createElement("div");
    pane.id = "robotics-printer-pane";
    pane.className = "robotics-panel-section robotics-printer-pane";
    pane.setAttribute("data-robotics-inner-pane", PANE);
    pane.hidden = true;
    pane.innerHTML = formHtml();
    panel.querySelector("[data-robotics-inner-pane='sim']")?.after(pane);
    bindForm(pane, {
      api,
      onApply,
      onBounder,
      onGear: () => openRoboticsPrinterConfigPopup({ api, onApply, onBounder }),
    });
  }
  fillForm(pane, printerConfigFromStorage(storage()));
  if (api) {
    void api("/api/me/printer-share").then((s) => {
      applyPrinterConfigFields(storage(), {
        lan_ip: s.lan_ip,
        serial: s.serial,
        name: s.name,
        accept_sends: s.accept_sends,
        show_outline: s.show_outline,
        show_model: s.show_model,
        fence: s.fence,
        ...(s.access_code ? { access_code: s.access_code } : {}),
      });
      fillForm(pane, printerConfigFromStorage(storage()));
      onApply?.(s);
    }).catch(() => {});
  }
  return pane;
}
