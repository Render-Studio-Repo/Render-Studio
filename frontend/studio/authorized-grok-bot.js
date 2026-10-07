/** Grok bot Authorized apps row + How to wire panel. */

export const GROK_BOT_KEY = "grok_bot";
export const GROK_BOT_ICON_HTML = `<img src="/assets/brands/grok-bot.svg?v=grokmcp-20260916-2-xwebhook1" width="16" height="16" alt="" />`;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function grokBotDetail(status = {}) {
  return String(status.detail || "Paste Consumer Key in Settings, optional xAI key for Grok chat");
}

export function authorizedRow(status = {}) {
  const connected = !!status.connected;
  const needsKeys = !!status.needs_keys;
  return {
    key: GROK_BOT_KEY,
    label: "Grok bot",
    iconHtml: GROK_BOT_ICON_HTML,
    detail: grokBotDetail(status),
    connected,
    action: connected ? "unlink-grok-bot" : "connect-grok-bot",
    cta: connected ? "Disconnect" : needsKeys ? "Connect" : "Connect",
    disabled: false,
  };
}

export function wiringSteps(status = {}) {
  const steps = status?.wiring?.steps;
  if (Array.isArray(steps) && steps.length) return steps;
  return [
    "Create or open your X developer app at https://developer.x.com (Keys and tokens).",
    "In Render Studio open Preferences → Connected apps → Grok bot.",
    "Click Connect. Paste Consumer Key if needed. Paste Consumer Key Secret in Settings only.",
    "Optional: paste an xAI API key (starts with xai-) or add Grok under AI & Billing.",
    "Add the Grok bot MCP to Cursor with the mcp.json snippet (no secrets in the file).",
    "LaunchAgent com.render3d.grok-bot keeps http://127.0.0.1:8744/mcp up across reboot and crash.",
    "Public MCP: https://render3d.app/mcp via Cloudflare. Authorization Bearer GROK_MCP_TOKEN.",
    "Inbound X mentions: https://render3d.app/api/webhooks/x (Account Activity CRC + HMAC).",
    "Reload Cursor and run grok_status, then grok_chat. Tweets stay drafts unless you confirm.",
  ];
}

export function mcpJsonSnippet() {
  return `{
  "mcpServers": {
    "grok-bot": {
      "command": "python3",
      "args": ["/Users/sam/Render-Studio/mcp/grok-bot/server.py"],
      "env": {
        "PYTHONPATH": "/Users/sam/Render-Studio",
        "RENDER_STUDIO_URL": "http://127.0.0.1:8001",
        "GROK_MODEL": "grok-4.5",
        "XAI_API_KEY": "",
        "X_CONSUMER_KEY": "",
        "X_CONSUMER_SECRET": ""
      }
    }
  }
}`;
}

export function wiringMarkup(status = {}) {
  const steps = wiringSteps(status)
    .map((step, i) => `<li><span>${i + 1}.</span> ${escapeHtml(step)}</li>`)
    .join("");
  const hint = status.x_consumer_key_hint
    ? `<p class="muted small">X Consumer Key on file: ${escapeHtml(status.x_consumer_key_hint)}</p>`
    : "";
  const grokHint = status.xai_key_hint
    ? `<p class="muted small">Grok / xAI key: ${escapeHtml(status.xai_key_hint)}</p>`
    : "";
  const showForm = !status.connected;
  return `
    <section class="grok-bot-wiring" data-grok-bot-wiring>
      <details class="grok-bot-wiring-details" ${showForm ? "open" : ""}>
        <summary>How to wire Grok bot</summary>
        <ol class="grok-bot-wiring-steps">${steps}</ol>
        <pre class="grok-bot-wiring-diagram" aria-label="Grok bot API wiring">${escapeHtml(status?.wiring?.diagram || `Cursor --stdio MCP--> grok-bot
        |                    |
     xAI API              X API
  XAI_API_KEY        Consumer Key + Secret`)}</pre>
        <p class="muted small">Cursor MCP JSON (no secrets — paste Consumer Key Secret in Settings or Cursor env, not this file):</p>
        <pre class="grok-bot-mcp-json">${escapeHtml(mcpJsonSnippet())}</pre>
        ${hint}${grokHint}
        ${showForm ? connectFormMarkup(status) : `<p class="muted small">Disconnect turns Grok bot off. It does not delete your stored X Consumer Key.</p>`}
        ${dimosLinkMarkup(status)}
      </details>
    </section>
  `;
}

function dimosLinkMarkup(status = {}) {
  const dimos = status.dimos || {};
  const host = escapeHtml(dimos.host || "");
  const linked = !!dimos.linked;
  return `
    <div class="grok-dimos-link" data-grok-dimos>
      <p class="grok-dimos-title"><b>Connect Grok bot to DIMOS</b></p>
      <p class="muted small">Robot PC LAN IP for OpenArm teleop (:8443). Saves for Grok MCP — does not arm joints.</p>
      <label>
        <b>DIMOS / robot PC IP</b>
        <small>Example 192.168.1.77 or 192.168.1.77:8443</small>
        <input name="dimos_host" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" placeholder="192.168.1.77" value="${host}" data-grok-dimos-host />
      </label>
      <div class="grok-dimos-actions">
        <button type="button" class="btn accent btn-compact" data-grok-dimos-connect>Connect to DIMOS</button>
        <button type="button" class="btn secondary btn-compact" data-grok-dimos-probe>Probe</button>
        ${linked ? `<button type="button" class="btn secondary btn-compact" data-grok-dimos-clear>Clear</button>` : ""}
      </div>
      <p class="muted small" data-grok-dimos-status role="status">${linked ? `Linked ${host}` : "Not linked"}</p>
      <p class="muted small">API: <code>GET/POST /api/integrations/grok-bot/dimos</code> · Studio pipe <code>/api/dimos/ws</code></p>
    </div>
  `;
}

function connectFormMarkup(status = {}) {
  const needX = !status.has_x_app;
  return `
    <form class="grok-bot-connect-form" data-grok-bot-form>
      <label>
        <b>X Consumer Key</b>
        <small>From developer.x.com → Keys and tokens. Already stored keys stay unless you paste new ones.</small>
        <input name="consumer_key" type="text" autocomplete="off" spellcheck="false" placeholder="${needX ? "Paste Consumer Key" : "Leave blank to keep stored key"}" />
      </label>
      <label>
        <b>Consumer Key Secret</b>
        <small>Paste Consumer Key Secret in Settings here. It is never shown after save.</small>
        <input name="consumer_secret" type="password" autocomplete="new-password" placeholder="Paste Consumer Key Secret in Settings" />
      </label>
      <label>
        <b>X chat bot token</b>
        <small>WW Bot for X. Starts with xcbot_. Used to post as the bot. Never shown after save.</small>
        <input name="bot_token" type="password" autocomplete="off" placeholder="xcbot_…" />
      </label>
      <label>
        <b>xAI / Grok API key</b>
        <small>Optional. Starts with xai-. Needed for grok_chat if you have not added Grok under AI &amp; Billing.</small>
        <input name="xai_api_key" type="password" autocomplete="off" placeholder="xai-…" />
      </label>
      <button type="submit" class="btn accent btn-compact" data-grok-bot-save>Save and connect</button>
    </form>
  `;
}

export function mountAfterList(host, status = {}, { api, setStatus, refresh } = {}) {
  if (!host) return;
  host.parentElement?.querySelector("[data-grok-bot-wiring]")?.remove();
  host.insertAdjacentHTML("afterend", wiringMarkup(status));
  const panel = host.parentElement;
  const form = panel?.querySelector("[data-grok-bot-form]");
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitConnect(form, { api, setStatus, refresh });
  });
  bindDimosLink(panel, { api, setStatus, refresh });
}

function bindDimosLink(panel, { api, setStatus, refresh } = {}) {
  const root = panel?.querySelector("[data-grok-dimos]");
  if (!root) return;
  const hostInput = root.querySelector("[data-grok-dimos-host]");
  const statusEl = root.querySelector("[data-grok-dimos-status]");
  const setLine = (text) => {
    if (statusEl) statusEl.textContent = text;
  };
  const readHost = () => String(hostInput?.value || "").trim();

  root.querySelector("[data-grok-dimos-connect]")?.addEventListener("click", async () => {
    const host = readHost();
    if (!host) {
      setStatus?.("error", "Enter the robot PC LAN IP first.");
      setLine("Enter IP");
      return;
    }
    try {
      root.querySelector("[data-grok-dimos-connect]")?.setAttribute("disabled", "true");
      const data = await api("/api/integrations/grok-bot/dimos", {
        method: "POST",
        body: JSON.stringify({ host, probe: true }),
      });
      const probe = data?.probe || {};
      const ok = data?.reachable ?? probe?.ok;
      const msg = ok
        ? `DIMOS linked ${data.host || host}${probe.tcp_open ? " · port open" : ""}`
        : `Saved ${data.host || host} — ${probe.error || "probe failed (is DimOS on :8443?)"}`;
      setStatus?.(ok ? "ok" : "error", msg);
      setLine(msg);
      try {
        const { persistDimosWsUrl } = await import("../xr/xr-dimos-teleop.js?v=20260929-y-record1");
        if (data?.upstream) persistDimosWsUrl(data.upstream);
      } catch { /* optional sync */ }
      await refresh?.();
    } catch (err) {
      setStatus?.("error", err.message || "Could not link DIMOS.");
      setLine(err.message || "Link failed");
    } finally {
      root.querySelector("[data-grok-dimos-connect]")?.removeAttribute("disabled");
    }
  });

  root.querySelector("[data-grok-dimos-probe]")?.addEventListener("click", async () => {
    const host = readHost();
    try {
      const data = await api("/api/integrations/grok-bot/dimos/probe", {
        method: "POST",
        body: JSON.stringify({ host }),
      });
      const msg = data?.ok
        ? `Reachable ${data.host || host}${data.http_reachable ? " · /teleop up" : " · TCP only"}`
        : data?.error || "Unreachable";
      setStatus?.(data?.ok ? "ok" : "error", msg);
      setLine(msg);
    } catch (err) {
      setStatus?.("error", err.message || "Probe failed.");
      setLine(err.message || "Probe failed");
    }
  });

  root.querySelector("[data-grok-dimos-clear]")?.addEventListener("click", async () => {
    try {
      await api("/api/integrations/grok-bot/dimos", { method: "DELETE" });
      if (hostInput) hostInput.value = "";
      setStatus?.("ok", "DIMOS link cleared.");
      setLine("Not linked");
      await refresh?.();
    } catch (err) {
      setStatus?.("error", err.message || "Could not clear.");
    }
  });
}

async function submitConnect(form, { api, setStatus, refresh } = {}) {
  const body = {
    consumer_key: form.querySelector('[name="consumer_key"]')?.value || "",
    consumer_secret: form.querySelector('[name="consumer_secret"]')?.value || "",
    bot_token: form.querySelector('[name="bot_token"]')?.value || "",
    xai_api_key: form.querySelector('[name="xai_api_key"]')?.value || "",
  };
  try {
    form.querySelector("[data-grok-bot-save]")?.setAttribute("disabled", "true");
    await api("/api/integrations/grok-bot/connect", { method: "POST", body: JSON.stringify(body) });
    setStatus?.("ok", "Grok bot connected.");
    await refresh?.();
  } catch (err) {
    setStatus?.("error", err.message || "Could not connect Grok bot.");
  } finally {
    form.querySelector("[data-grok-bot-save]")?.removeAttribute("disabled");
  }
}

export async function handleAction(action, { api, setStatus, refresh } = {}) {
  if (action === "connect-grok-bot") {
    const form = document.querySelector("[data-grok-bot-form]");
    if (form) {
      form.closest("details")?.setAttribute("open", "");
      form.querySelector('[name="consumer_key"]')?.focus();
      const hasSecret = (form.querySelector('[name="consumer_secret"]')?.value || "").trim();
      const hasKey = (form.querySelector('[name="consumer_key"]')?.value || "").trim();
      const hasXai = (form.querySelector('[name="xai_api_key"]')?.value || "").trim();
      if (!hasSecret && !hasKey && !hasXai) {
        try {
          await api("/api/integrations/grok-bot/connect", { method: "POST", body: JSON.stringify({}) });
          setStatus?.("ok", "Grok bot connected.");
          await refresh?.();
          return true;
        } catch (_) {
          setStatus?.("ok", "Paste Consumer Key Secret in Settings, then Save and connect.");
          return true;
        }
      }
      await submitConnect(form, { api, setStatus, refresh });
      return true;
    }
    await api("/api/integrations/grok-bot/connect", { method: "POST", body: JSON.stringify({}) });
    setStatus?.("ok", "Grok bot connected.");
    await refresh?.();
    return true;
  }
  if (action === "unlink-grok-bot") {
    await api("/api/integrations/grok-bot", { method: "DELETE" });
    setStatus?.("ok", "Grok bot disconnected. Stored X Consumer Key was kept.");
    await refresh?.();
    return true;
  }
  return false;
}
