const LOCAL_ZED_URL = "/api/robotics/zed.jpg";
export const ROBOT_CAMERA_WALL_PATH = "/api/robotics/camera-wall";

export function robotCameraWallFrameUrl(kind, tick = Date.now()) {
  const camera = ["left", "right", "zed"].includes(kind) ? kind : "left";
  return `${ROBOT_CAMERA_WALL_PATH}/${camera}.jpg?t=${tick}`;
}

export function robotCameraWallHeaders(token = "") {
  const value = String(token || "").trim();
  return value ? { Authorization: `Bearer ${value}` } : {};
}

export function robotPovDragPosition({ left = 0, top = 0, dx = 0, dy = 0, width = 480, height = 360, viewportWidth = globalThis.innerWidth || 1280, viewportHeight = globalThis.innerHeight || 720 } = {}) {
  return {
    left: Math.max(8, Math.min(left + dx, Math.max(8, viewportWidth - width - 8))),
    top: Math.max(8, Math.min(top + dy, Math.max(8, viewportHeight - height - 8))),
  };
}

async function fetchZedStatus(api) {
  try {
    const wall = await api(`${ROBOT_CAMERA_WALL_PATH}/status`);
    const top = wall?.cameras?.zed;
    if (top?.live) {
      return { ...top, usb: true, live: true, permission: "authorized", source: "raspberry-pi", model: top.label || "Top camera" };
    }
  } catch { /* Mac ZED remains a fallback */ }
  try {
    return await api("/api/robotics/zed/status");
  } catch {
    return null;
  }
}

function zedOfflineMessage(status) {
  if (!status?.usb) return "Top camera not detected";
  if (status?.permission === "denied" || status?.permission === "restricted") {
    return "Camera blocked — open System Settings → Privacy → Camera → enable ZEDCaptureDiagnostics";
  }
  if (status?.live) return "";
  if (status?.permission && status.permission !== "authorized") {
    return "Click Grant ZED camera access in Robotics Home";
  }
  return status?.reason || "Top camera offline";
}

export function mountRobotPov({ root, api, getCameraHost, getToken, fetchFn, onStatus, onSplit } = {}) {
  if (!root) return null;
  let box = null;
  let timer = 0;
  let refreshing = false;
  const frameUrls = new Map();
  const viewState = { mode: "unified", splitting: false };
  const zedInput = root.querySelector("[data-robot-pov-zed-url]");
  const cameraHost = () => String(getCameraHost?.() || "192.168.1.83").trim() || "192.168.1.83";

  function isOpen() {
    return !!box?.isConnected && !box.hidden;
  }

  function close() {
    if (timer) clearInterval(timer);
    timer = 0;
    for (const url of frameUrls.values()) URL.revokeObjectURL(url);
    frameUrls.clear();
    box?.remove();
    box = null;
  }

  async function loadPrefs() {
    try {
      const data = await api("/api/users/me/robotics-prefs");
      const status = await fetchZedStatus(api);
      const saved = String(data?.prefs?.zedCameraUrl || "").trim();
      if (zedInput) {
        zedInput.value = status?.usb ? LOCAL_ZED_URL : (saved || LOCAL_ZED_URL);
      }
    } catch {
      if (zedInput && !zedInput.value) zedInput.value = LOCAL_ZED_URL;
    }
  }

  async function saveZed() {
    const zedCameraUrl = String(zedInput?.value || "").trim();
    try {
      await api("/api/users/me/robotics-prefs", {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ zedCameraUrl }),
      });
      return zedCameraUrl;
    } catch (error) {
      onStatus?.("error", error?.message || "Could not save the ZED camera URL.");
      return zedCameraUrl;
    }
  }

  function updateZedPermButton(status) {
    const permBtn = box?.querySelector("[data-pov-zed-permission]");
    if (!permBtn) return;
    const needsGrant = status?.source !== "raspberry-pi" && !!status?.usb && !status?.live && status?.permission !== "authorized";
    permBtn.hidden = !needsGrant;
    permBtn.classList?.toggle?.("hidden", !needsGrant);
  }

  function setZedFigureStatus(status) {
    const fig = box?.querySelector(".robot-pov-zed");
    if (!fig) return;
    const msg = zedOfflineMessage(status);
    fig.dataset.offlineReason = msg;
    const cap = fig.querySelector("figcaption");
    if (cap && status && !status.live) cap.textContent = `Top camera · ${msg}`;
    else if (cap) cap.textContent = status?.model || "Top camera · robot POV";
    updateZedPermButton(status);
  }

  async function ensureZedAccess() {
    const status = await fetchZedStatus(api);
    if (status?.live || status?.permission === "authorized") {
      try {
        await api("/api/robotics/zed/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ on: true }),
        });
      } catch { /* ok */ }
      updateZedPermButton(status);
      refresh();
      onStatus?.("ok", "Top camera streaming.");
      return status;
    }
    const data = await api("/api/robotics/zed/request-permission", { method: "POST" });
    const next = await fetchZedStatus(api);
    setZedFigureStatus(next);
    refresh();
    onStatus?.(
      data?.ok ? "ok" : "warn",
      data?.helper || "Enable ZEDCaptureDiagnostics in System Settings → Privacy → Camera.",
    );
    return next;
  }

  async function refresh() {
    if (!box?.isConnected || refreshing) return;
    const request = fetchFn || globalThis.fetch?.bind(globalThis);
    if (!request) return;
    refreshing = true;
    const tick = Date.now();
    try {
      await Promise.all(["left", "right", "zed"].map(async (kind) => {
        const img = box?.querySelector(`[data-pov-feed="${kind}"]`);
        if (!img) return;
        try {
          const response = await request(robotCameraWallFrameUrl(kind, tick), {
            cache: "no-store",
            credentials: "same-origin",
            headers: robotCameraWallHeaders(getToken?.()),
          });
          if (!response?.ok) throw new Error(`HTTP ${response?.status || 0}`);
          const blob = await response.blob();
          if (!blob?.size) throw new Error("empty frame");
          const next = URL.createObjectURL(blob);
          const previous = frameUrls.get(kind);
          frameUrls.set(kind, next);
          img.src = next;
          if (previous) URL.revokeObjectURL(previous);
        } catch {
          img.closest("figure")?.classList.add("is-offline");
        }
      }));
    } finally {
      refreshing = false;
    }
  }

  async function open() {
    viewState.mode = "unified";
    if (box?.isConnected) { box.hidden = false; void refresh(); return; }
    const zedStatus = await fetchZedStatus(api);
    if (zedInput && zedStatus?.usb) zedInput.value = LOCAL_ZED_URL;
    await saveZed();
    if (zedStatus?.source !== "raspberry-pi") {
      try { await api("/api/robotics/zed/publish", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on: true }) }); } catch { /* ok */ }
    }
    box = document.createElement("section");
    box.className = "robot-pov-box";
    box.setAttribute("aria-label", "Robot POV cameras");
    box.innerHTML = `<header data-pov-drag title="Drag Robot POV"><span class="robot-pov-drag-handle" aria-hidden="true">⠿</span><strong>Robot POV</strong><span>Left wrist · Right wrist · Top camera</span><button type="button" data-pov-split aria-label="Split cameras into three windows" title="Split into three windows" style="margin-left:auto"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M6 3v10M10 3v10"/></svg></button><button type="button" data-pov-close aria-label="Close" style="margin-left:0">×</button></header>
      <div class="robot-pov-grid">
        <figure><img data-pov-feed="left" alt="Left wrist camera"><figcaption>Left wrist</figcaption></figure>
        <figure><img data-pov-feed="right" alt="Right wrist camera"><figcaption>Right wrist</figcaption></figure>
        <figure class="robot-pov-zed"><img data-pov-feed="zed" alt="Robot top camera"><figcaption>Top camera · robot POV</figcaption><button type="button" class="btn secondary btn-compact robot-pov-zed-perm" data-pov-zed-permission hidden>Grant camera access</button></figure>
      </div>`;
    document.body.appendChild(box);
    const dragHandle = box.querySelector("[data-pov-drag]");
    let drag = null;
    dragHandle?.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target?.closest?.("button")) return;
      const rect = box.getBoundingClientRect();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      box.classList.add("is-dragging");
      dragHandle.setPointerCapture?.(event.pointerId);
      event.preventDefault?.();
    });
    dragHandle?.addEventListener("pointermove", (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      const next = robotPovDragPosition({ left: drag.left, top: drag.top, dx: event.clientX - drag.x, dy: event.clientY - drag.y, width: box.offsetWidth, height: box.offsetHeight });
      Object.assign(box.style, { left: `${next.left}px`, top: `${next.top}px`, right: "auto", bottom: "auto", transform: "none" });
    });
    const endDrag = (event) => {
      if (!drag || event.pointerId !== drag.id) return;
      dragHandle.releasePointerCapture?.(event.pointerId);
      drag = null;
      box.classList.remove("is-dragging");
    };
    dragHandle?.addEventListener("pointerup", endDrag);
    dragHandle?.addEventListener("pointercancel", endDrag);
    const closeButton = box.querySelector("[data-pov-close]");
    const closeFromControl = (event) => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      close();
    };
    closeButton?.addEventListener("pointerdown", closeFromControl);
    closeButton?.addEventListener("click", closeFromControl);
    const splitButton = box.querySelector("[data-pov-split]");
    splitButton?.addEventListener("click", () => {
      if (viewState.splitting) return;
      if (typeof onSplit !== "function") {
        onStatus?.("error", "Camera splitting is unavailable.");
        return;
      }
      viewState.splitting = true;
      splitButton.disabled = true;
      void Promise.resolve().then(() => onSplit({
        feeds: ["left", "right", "zed"],
        cameraHost: cameraHost(),
        zedUrl: LOCAL_ZED_URL,
      })).then((result) => {
        if (result === false || result?.ok === false) {
          onStatus?.("error", result?.message || "Could not split the camera window.");
          return;
        }
        viewState.mode = "detached";
        close();
        onStatus?.("ok", "Cameras split into three windows.");
      }).catch((error) => {
        onStatus?.("error", error?.message || "Could not split the camera window.");
      }).finally(() => {
        viewState.splitting = false;
        if (splitButton.isConnected) splitButton.disabled = false;
      });
    });
    box.querySelectorAll("img").forEach((img) => {
      img.addEventListener("error", () => img.closest("figure")?.classList.add("is-offline"));
      img.addEventListener("load", () => img.closest("figure")?.classList.remove("is-offline"));
    });
    setZedFigureStatus(zedStatus);
    box.querySelector("[data-pov-zed-permission]")?.addEventListener("click", () => {
      void ensureZedAccess().catch((error) => onStatus?.("error", error?.message || "Permission request failed"));
    });
    await refresh();
    timer = setInterval(async () => {
      await refresh();
      const next = await fetchZedStatus(api);
      setZedFigureStatus(next);
    }, 1200);
    const zedHint = zedStatus?.live ? "Top camera live." : zedOfflineMessage(zedStatus);
    onStatus?.(zedStatus?.live ? "ok" : "warn", `Robot POV open — ${zedHint}`);
  }

  root.querySelector("[data-robot-pov-open]")?.addEventListener("click", () => void open());
  zedInput?.addEventListener("change", () => { void saveZed(); refresh(); });
  void loadPrefs();
  return {
    open,
    close,
    isOpen,
    refresh,
    get mode() { return viewState.mode; },
  };
}
