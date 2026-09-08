/**
 * Applies public site branding (product name, logo, custom loading screen).
 * The boot-screen top-left attribution logo is always Render Studio → GitHub.
 */
const ATTRIBUTION_REPO = "https://github.com/wprojects/Render-Studio";
const ATTRIBUTION_LOGO = "/assets/loading-screen/render-studio-logo.png?v=20260908-branding";


const LOADING_SCREEN_PREF_KEY = "render3d:loadingScreenEnabled:v1";

function rememberLoadingScreenPref(enabled) {
  try {
    localStorage.setItem(LOADING_SCREEN_PREF_KEY, enabled ? "1" : "0");
  } catch (_) {
    /* ignore */
  }
}

let cachedBranding = null;

function isVideoUrl(url = "") {
  return /\.(mp4|webm)(?:$|\?)/i.test(String(url || ""));
}

export function getCachedBranding() {
  return cachedBranding;
}

export async function fetchBranding() {
  try {
    const res = await fetch("/api/branding", { cache: "no-store" });
    if (!res.ok) throw new Error("branding fetch failed");
    cachedBranding = await res.json();
  } catch {
    cachedBranding = {
      product_name: "Render Studio",
      logo_url: ATTRIBUTION_LOGO,
      loading_screen_url: "",
      loading_screen_builtin: true,
      loading_screen_enabled: true,
      loading_screen_duration_ms: 5000,
      attribution_logo_url: ATTRIBUTION_LOGO,
      attribution_repo_url: ATTRIBUTION_REPO,
    };
  }
  return cachedBranding;
}

function ensureAttributionLogo(boot) {
  if (!boot) return;
  let link = boot.querySelector("#studio-boot-attribution");
  if (!link) {
    link = document.createElement("a");
    link.id = "studio-boot-attribution";
    link.className = "studio-boot-attribution";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", "Open Render Studio on GitHub");
    link.innerHTML = `
      <img class="studio-boot-attribution-logo" src="${ATTRIBUTION_LOGO}" alt="Render Studio" width="36" height="36" />
      <span class="studio-boot-attribution-word">Render Studio</span>
    `;
    boot.appendChild(link);
  }
  link.href = (cachedBranding && cachedBranding.attribution_repo_url) || ATTRIBUTION_REPO;
  const img = link.querySelector(".studio-boot-attribution-logo");
  if (img) {
    img.src = (cachedBranding && cachedBranding.attribution_logo_url) || ATTRIBUTION_LOGO;
  }
}

function applyCustomLoadingScreen(boot, branding) {
  const stage = boot?.querySelector(".studio-boot-stage");
  if (!stage) return;
  const url = String(branding?.loading_screen_url || "").trim();
  const existing = stage.querySelector(".studio-boot-custom-media");
  if (!url) {
    stage.classList.remove("studio-boot-stage--custom");
    existing?.remove();
    return;
  }
  stage.classList.add("studio-boot-stage--custom");
  let media = existing;
  if (isVideoUrl(url)) {
    if (!media || media.tagName !== "VIDEO") {
      existing?.remove();
      media = document.createElement("video");
      media.className = "studio-boot-custom-media";
      media.autoplay = true;
      media.muted = true;
      media.loop = true;
      media.playsInline = true;
      stage.appendChild(media);
    }
  } else if (!media || media.tagName === "VIDEO") {
    existing?.remove();
    media = document.createElement("img");
    media.className = "studio-boot-custom-media";
    media.alt = "";
    stage.appendChild(media);
  }
  if (media.getAttribute("src") !== url) media.setAttribute("src", url);
}

function applyProductName(branding) {
  const name = String(branding?.product_name || "Render Studio").trim() || "Render Studio";
  document.querySelectorAll("[data-brand-name]").forEach((el) => {
    el.textContent = name;
  });
  const titleMetal = document.querySelector(".studio-boot-title-metal");
  if (titleMetal) titleMetal.textContent = name;
  const logoWord = document.querySelector(".studio-boot-logo-word");
  if (logoWord) logoWord.textContent = name;
  document.querySelectorAll(".brand h1, .brand-link h1, h1.brand-title-metal").forEach((el) => {
    // Keep attribution wordmark separate; only replace primary brand titles.
    if (el.closest("#studio-boot-attribution")) return;
    el.textContent = name;
  });
  const title = document.querySelector("title");
  if (title && /Render(?:3D)?(?: Studio)?/i.test(title.textContent || "")) {
    title.textContent = title.textContent.replace(/Render(?:3D)?(?: Studio)?/gi, name);
  }
}

function applyProductLogo(branding) {
  const url = String(branding?.logo_url || "").trim();
  if (!url) return;
  document.querySelectorAll("[data-brand-logo], .brand .logo, .brand-link .logo").forEach((el) => {
    if (!(el instanceof HTMLImageElement)) return;
    if (el.closest("#studio-boot-attribution")) return;
    // Boot gear progress cluster keeps metal gear; only swap dedicated brand marks.
    if (el.closest(".studio-boot-logo-gear")) return;
    el.src = url;
    el.alt = String(branding?.product_name || "Studio");
  });
  const bootBrandImg = document.querySelector(".studio-boot-logo > img:not(.studio-boot-logo-gear-img)");
  if (bootBrandImg) {
    bootBrandImg.src = url;
    bootBrandImg.alt = String(branding?.product_name || "Studio");
  }
}

function applyLoadingScreenPolicy(branding) {
  const enabled = branding?.loading_screen_enabled !== false;
  rememberLoadingScreenPref(enabled);
  const durationMs = Math.max(
    0,
    Number(branding?.loading_screen_duration_ms ?? 5000) || 0,
  );
  const boot = document.getElementById("studio-boot-screen");
  // Capture before clearing the tentative-off markers.
  const wasPrefHidden =
    boot?.dataset.loadingPrefHidden === "1" ||
    document.body.classList.contains("studio-boot-pref-off");
  document.body.classList.remove("studio-boot-pref-off");
  if (!enabled) {
    window.__studioBootMinUntil = 0;
    document.documentElement.dataset.loadingScreen = "off";
    if (boot) {
      boot.classList.add("is-done");
      boot.setAttribute("aria-busy", "false");
      document.body.classList.remove("studio-booting");
      boot.remove();
    }
    try {
      window.__dismissStudioBoot?.();
    } catch (_) {
      /* ignore */
    }
    return;
  }
  document.documentElement.dataset.loadingScreen = "on";
  const holdFor = durationMs > 0 ? durationMs : 5000;
  if (boot) {
    delete boot.dataset.loadingPrefHidden;
    delete boot.dataset.dismissScheduled;
    boot.style.opacity = "";
    boot.style.pointerEvents = "";
    boot.classList.remove("is-done");
    boot.setAttribute("aria-busy", "true");
    document.body.classList.add("studio-booting");
  }
  const pageStarted = Number(window.__studioBootPageStartedAt || 0) || Date.now();
  window.__studioBootPageStartedAt = pageStarted;
  // Hold from first paint. If a stale "off" cache hid the splash, guarantee a full
  // visible duration once branding confirms it should be on.
  const fromStart = pageStarted + holdFor;
  const fromNow = Date.now() + holdFor;
  window.__studioBootMinUntil = wasPrefHidden ? fromNow : Math.max(fromStart, Date.now() + 250);
}

export function applyBranding(branding = cachedBranding) {
  if (!branding) return branding;
  cachedBranding = branding;
  const boot = document.getElementById("studio-boot-screen");
  ensureAttributionLogo(boot);
  applyCustomLoadingScreen(boot, branding);
  applyProductName(branding);
  applyProductLogo(branding);
  applyLoadingScreenPolicy(branding);
  document.documentElement.dataset.productName = branding.product_name || "Render Studio";
  return branding;
}

export async function initStudioBranding() {
  const branding = await fetchBranding();
  applyBranding(branding);
  return branding;
}

// Eager apply as soon as the module evaluates on pages that import it.
if (typeof document !== "undefined") {
  void initStudioBranding();
}
