const LOCAL_ZED_URL = "/api/robotics/zed.jpg";

export function zedTopCamJpegUrl(tick = Date.now()) {
  return `${LOCAL_ZED_URL}?t=${tick}`;
}

export function mountZedTopCam({ api, root, onStatus } = {}) {
  const statusEl = root?.querySelector?.("[data-zed-top-status]");
  const permBtn = root?.querySelector?.("[data-zed-request-permission]");
  let pollTimer = 0;

  async function fetchStatus() {
    try {
      const data = await api("/api/robotics/zed/status");
      renderStatus(data);
      return data;
    } catch (error) {
      renderStatus({ usb: false, reason: error?.message || "ZED status unavailable" });
      return null;
    }
  }

  function renderStatus(data = {}) {
    if (!statusEl) return;
    const bits = [];
    if (data.usb) bits.push(`${data.model || "ZED"} · sn ${data.serial || "?"}`);
    else bits.push("ZED not detected on USB");
    if (data.mlxSdk === false) bits.push("zed-sdk-mlx missing");
    if (data.permission && data.permission !== "authorized" && !data.live) {
      bits.push(`camera ${data.permission}`);
    }
    if (data.live) bits.push("live");
    else if (data.reason) bits.push(data.reason);
    statusEl.textContent = bits.join(" · ");
    statusEl.classList.toggle("is-live", !!data.live);
    statusEl.classList.toggle("is-warn", !!data.usb && !data.live);
    if (permBtn) {
      const needsGrant = !!data.usb && !data.live && data.permission !== "authorized";
      permBtn.hidden = !needsGrant;
      permBtn.classList.toggle("hidden", !needsGrant);
    }
  }

  async function ensurePublish() {
    try {
      await api("/api/robotics/zed/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: true }),
      });
    } catch { /* local dev */ }
  }

  async function requestPermission() {
    try {
      const current = await fetchStatus();
      if (current?.live || current?.permission === "authorized") {
        await ensurePublish();
        onStatus?.("ok", "ZED camera already allowed — streaming.");
        return { ok: true, permission: current.permission || "authorized" };
      }
      const data = await api("/api/robotics/zed/request-permission", { method: "POST" });
      onStatus?.(data?.ok ? "ok" : "warn", data?.helper || data?.reason || "Check Camera permission for ZEDCaptureDiagnostics.");
      await fetchStatus();
      return data;
    } catch (error) {
      onStatus?.("error", error?.message || "Could not request ZED camera permission.");
      return null;
    }
  }

  async function activate() {
    await ensurePublish();
    const status = await fetchStatus();
    const zedInput = root?.querySelector?.("[data-robot-pov-zed-url]");
    if (zedInput && status?.usb && !String(zedInput.value || "").trim()) {
      zedInput.value = LOCAL_ZED_URL;
      zedInput.dispatchEvent(new Event("change", { bubbles: true }));
    }
    startPoll();
    return status;
  }

  function startPoll() {
    if (pollTimer) return;
    pollTimer = window.setInterval(() => { void fetchStatus(); }, 2500);
  }

  function stopPoll() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = 0;
  }

  permBtn?.addEventListener("click", () => { void requestPermission(); });
  void (async () => {
    const status = await fetchStatus();
    if (status?.usb && (status.permission === "authorized" || status.live)) {
      await activate();
    } else if (status?.usb) {
      startPoll();
    }
  })();

  return { fetchStatus, activate, requestPermission, startPoll, stopPoll, zedTopCamJpegUrl };
}

export function wireDimosZedPane(root) {
  if (!root) return null;
  const pane = root.querySelector("[data-dimos-pane='zed']");
  const img = root.querySelector("[data-dimos-video-zed]");
  const empty = root.querySelector("[data-dimos-no-feed='zed']");
  if (!img) return null;
  let timer = 0;

  function refresh() {
    if (!img.isConnected) return;
    img.hidden = false;
    img.src = zedTopCamJpegUrl();
  }

  function start() {
    refresh();
    if (!timer) timer = window.setInterval(refresh, 650);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = 0;
  }

  img.addEventListener("load", () => {
    empty?.classList.add("hidden");
    pane?.classList.remove("is-offline");
  });
  img.addEventListener("error", () => {
    empty?.classList.remove("hidden");
    pane?.classList.add("is-offline");
  });

  return { start, stop, refresh };
}
