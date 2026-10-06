/**
 * Quest / headset *browser* (2D site in Oculus Browser), not an active WebXR session.
 * `body.xr-presenting` means the user already entered VR/AR — do not use that to
 * decide welcome copy. Headset browsers skip first-run welcome so Enter AR/VR stays clear.
 */

export const HEADSET_UA_RE =
  /OculusBrowser|MetaBrowser|Horizon|Quest|XRBrowser|Mobile VR|Wolvic|Helio|Snapchat|Spectacles|PicoBrowser/i;

let webXrHeadsetLikely = false;
let chromeCloseReady = false;

export function isVrHeadsetUa(ua = navigator.userAgent || "") {
  return HEADSET_UA_RE.test(ua);
}

export function isXrPresenting() {
  try {
    return document.body.classList.contains("xr-presenting");
  } catch {
    return false;
  }
}

export function isVrHeadsetBrowser() {
  if (isVrHeadsetUa()) return true;
  if (webXrHeadsetLikely) return true;
  return false;
}

export function applyVrHeadsetClass(on = isVrHeadsetBrowser()) {
  try {
    document.documentElement.classList.toggle("vr-headset-browser", !!on);
    document.body?.classList.toggle("vr-headset-browser", !!on);
  } catch {
    /* ignore */
  }
  return !!on;
}

/**
 * Async WebXR probe. Desktop Chrome with a linked headset can report immersive-*.
 * Treat that as a headset browser only on Android-like UAs (Quest Browser).
 */
export async function probeVrHeadsetWebXr() {
  const ua = navigator.userAgent || "";
  if (isVrHeadsetUa(ua)) {
    webXrHeadsetLikely = true;
    applyVrHeadsetClass(true);
    return true;
  }
  try {
    if (!navigator.xr?.isSessionSupported) return isVrHeadsetBrowser();
    let arOk = false;
    let vrOk = false;
    try {
      arOk = !!(await navigator.xr.isSessionSupported("immersive-ar"));
    } catch {
      arOk = false;
    }
    try {
      vrOk = !!(await navigator.xr.isSessionSupported("immersive-vr"));
    } catch {
      vrOk = false;
    }
    const androidXr = /Android/i.test(ua) && (arOk || vrOk);
    if (androidXr) {
      webXrHeadsetLikely = true;
      applyVrHeadsetClass(true);
      return true;
    }
  } catch {
    /* ignore */
  }
  applyVrHeadsetClass(isVrHeadsetBrowser());
  return isVrHeadsetBrowser();
}

export function vrEnterLabel() {
  const btn = document.getElementById("btn-xr-vr");
  const text = (btn?.querySelector("span")?.textContent || btn?.textContent || "").trim().toUpperCase();
  if (text.includes("VR") && !text.includes("AR")) return "VR";
  if (text.includes("VR")) return "VR";
  return "AR";
}

function closeUserMenu() {
  document.getElementById("user-menu")?.classList.add("hidden");
}

function syncUserMenuBackdrop() {
  const menu = document.getElementById("user-menu");
  const backdrop = document.getElementById("user-menu-backdrop");
  const open = !!(menu && !menu.classList.contains("hidden"));
  // Desktop: no full-screen dimmer. Headset browsers still get a tap-catcher.
  const showBackdrop = open && isVrHeadsetBrowser();
  backdrop?.classList.toggle("hidden", !showBackdrop);
  if (backdrop) backdrop.hidden = !showBackdrop;
  document.body?.classList.toggle("user-menu-open", open);
}

function ensureUserMenuBackdrop() {
  let backdrop = document.getElementById("user-menu-backdrop");
  if (backdrop) return backdrop;
  backdrop = document.createElement("button");
  backdrop.type = "button";
  backdrop.id = "user-menu-backdrop";
  backdrop.className = "chrome-menu-backdrop hidden";
  backdrop.hidden = true;
  backdrop.setAttribute("aria-label", "Close account menu");
  document.body.appendChild(backdrop);
  const dismiss = (e) => {
    e?.preventDefault?.();
    e?.stopPropagation?.();
    closeUserMenu();
  };
  backdrop.addEventListener("click", dismiss);
  backdrop.addEventListener("pointerup", (e) => {
    if (e.pointerType === "mouse") return;
    dismiss(e);
  });
  return backdrop;
}

function ensureUserMenuCloseButton() {
  const menu = document.getElementById("user-menu");
  if (!menu) return;
  const header = menu.querySelector(".user-menu-header") || menu;
  let btn = menu.querySelector("#user-menu-close");
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "user-menu-close";
    btn.className = "user-menu-close";
    header.appendChild(btn);
  }
  btn.setAttribute("aria-label", "Close account menu");
  if (!btn.querySelector(".chrome-close-x")) {
    btn.innerHTML = `<span class="chrome-close-x" aria-hidden="true">×</span>`;
  }
  btn.querySelector(".chrome-close-label")?.remove();
  if (btn.dataset.bound === "1") return;
  btn.dataset.bound = "1";
  const dismiss = (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeUserMenu();
  };
  btn.addEventListener("click", dismiss);
  btn.addEventListener("pointerup", (e) => {
    if (e.pointerType === "mouse") return;
    dismiss(e);
  });
}

/** Large Close / backdrop / Escape for account menu (Quest Browser click-outside often misses). */
export function initVrChromeMenuClose() {
  if (chromeCloseReady) return;
  chromeCloseReady = true;
  ensureUserMenuBackdrop();
  ensureUserMenuCloseButton();
  const menu = document.getElementById("user-menu");
  if (menu && typeof MutationObserver !== "undefined") {
    new MutationObserver(syncUserMenuBackdrop).observe(menu, {
      attributes: true,
      attributeFilter: ["class"],
    });
  }
  syncUserMenuBackdrop();
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeUserMenu();
    window.Render3DMobileChrome?.closeToolbarNavMenu?.();
    window.Render3DMobileChrome?.closeMobileToolsPopup?.();
    window.Render3DMobileChrome?.closeMobileSelectPopup?.();
  });
}

applyVrHeadsetClass();
void probeVrHeadsetWebXr();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    applyVrHeadsetClass();
    initVrChromeMenuClose();
    void probeVrHeadsetWebXr();
  });
} else {
  initVrChromeMenuClose();
}
