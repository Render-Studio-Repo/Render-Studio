/** Sandbox printer settings and read-only reachability. No print submission. */
import { applyPrinterConfigFields, printerConfigFromStorage, printerPrefsApiBody } from "../xr/xr-share-print.js?v=sandbox-printer-1";

async function api(path, options = {}) {
  let headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  try {
    const { authHeaders } = await import("../studio/auth.js?v=sandbox-printer-1");
    headers = authHeaders(headers);
  } catch { /* Cookie session may still be present. */ }
  const response = await fetch(path, { credentials: "same-origin", ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : `HTTP ${response.status}`);
  return data;
}

export function mountSandboxPrinter(host) {
  if (!host) return null;
  host.innerHTML = `
    <div class="sb-printer-panel">
      <header><span class="sb-kicker">3D PRINTER</span><strong>Printer connection</strong></header>
      <p>Save the same printer profile used by Studio and the headset. Probe checks network reachability only.</p>
      <form data-printer-form>
        <label>Printer LAN IP <input data-printer-host type="text" inputmode="decimal" autocomplete="off" placeholder="192.168.1.x" /></label>
        <label>Printer name <input data-printer-name type="text" autocomplete="off" placeholder="My printer" /></label>
        <label>Serial <input data-printer-serial type="text" autocomplete="off" placeholder="Optional" /></label>
        <label>Protocol <select data-printer-protocol><option>Bambu LAN</option><option>OctoPrint</option></select></label>
        <label class="sb-printer-check"><input data-printer-outline type="checkbox" /> Show printer boundary in VR</label>
        <label class="sb-printer-check"><input data-printer-model type="checkbox" /> Show printer model in VR</label>
        <div class="sb-printer-actions">
          <button type="submit" class="sb-agent-btn">Save profile</button>
          <button type="button" class="sb-agent-btn" data-printer-probe>Probe connection</button>
        </div>
      </form>
      <p data-printer-status role="status">Printer profile loading…</p>
      <p class="muted small">PIN binding and print submission stay in Studio’s Robotics → 3D Printer tab.</p>
    </div>
  `;
  const q = (sel) => host.querySelector(sel);
  const status = (message) => { if (q("[data-printer-status]")) q("[data-printer-status]").textContent = message; };
  const fill = (cfg) => {
    q("[data-printer-host]").value = cfg.lan_ip || "";
    q("[data-printer-name]").value = cfg.name || "";
    q("[data-printer-serial]").value = cfg.serial || "";
    q("[data-printer-outline]").checked = !!cfg.show_outline;
    q("[data-printer-model]").checked = !!cfg.show_model;
  };
  const storage = (() => { try { return localStorage; } catch { return null; } })();
  fill(printerConfigFromStorage(storage));

  const refresh = async () => {
    try {
      const remote = await api("/api/me/printer-share");
      applyPrinterConfigFields(storage, remote);
      fill(printerConfigFromStorage(storage));
      status(remote.lan_ip ? `Profile loaded · ${remote.name || remote.lan_ip}` : "No printer host saved yet");
    } catch (error) {
      status(`Local profile only · ${String(error?.message || error).slice(0, 90)}`);
    }
  };
  q("[data-printer-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const fields = {
      lan_ip: q("[data-printer-host]").value.trim(),
      name: q("[data-printer-name]").value.trim(),
      serial: q("[data-printer-serial]").value.trim(),
      show_outline: q("[data-printer-outline]").checked,
      show_model: q("[data-printer-model]").checked,
    };
    status("Saving printer profile…");
    try {
      const saved = await api("/api/me/printer-share", {
        method: "PUT", body: JSON.stringify(printerPrefsApiBody(fields)),
      });
      applyPrinterConfigFields(storage, { ...fields, ...saved });
      status("Printer profile saved for Studio and VR.");
    } catch (error) { status(`Save failed · ${String(error?.message || error).slice(0, 90)}`); }
  });
  q("[data-printer-probe]")?.addEventListener("click", async () => {
    const hostText = q("[data-printer-host]").value.trim();
    if (!hostText) { status("Enter the printer LAN IP first."); return; }
    status(`Probing ${hostText}…`);
    try {
      const result = await api("/api/robotics/printer/probe", {
        method: "POST", body: JSON.stringify({ host: hostText, protocol: q("[data-printer-protocol]").value }),
      });
      status(result.message || "Printer port reachable; print readiness unverified.");
    } catch (error) {
      status(`Probe unavailable · ${String(error?.message || error).slice(0, 100)}`);
    }
  });
  void refresh();
  return { refresh };
}
