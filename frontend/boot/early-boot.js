/** Keep the sidebar quiet while the heavy editor boots — no project name dump. */
/* xrenter1: headset Enter VR requestSession lives in index.html click, not after boot. */
import { authHeaders, getToken, isTokenExpired } from "../studio/auth.js?v=20260908-profclick1-profopen1-acctfly1-dimospf1-acctovl1-setsearch1-authfast2-loginclog1-acctui1-sblogin1-sblogin2-loginlog1-loginfix1";

/** Swap legacy SVG boot gear for the metal PNG + electricity overlay. */
function upgradeBootMetalGear() {
  if (document.documentElement.classList.contains("vr-headset-browser")) return;
  const gear = document.querySelector(".studio-boot-logo-gear");
  if (!gear || gear.querySelector(".studio-boot-logo-gear-img")) return;

  const percent = gear.querySelector(".studio-boot-logo-percent");
  const spin = document.createElement("span");
  spin.className = "studio-boot-logo-gear-spin";
  spin.innerHTML =
    '<img class="studio-boot-logo-gear-img" src="/assets/futuristic-gear-metal.png?v=20260715-metal-gear" alt="" width="72" height="72" />' +
    '<svg class="studio-boot-logo-gear-electric" viewBox="0 0 64 64" width="72" height="72" aria-hidden="true">' +
    '<defs><filter id="bootElecGlow" x="-60%" y="-60%" width="220%" height="220%">' +
    '<feGaussianBlur stdDeviation="1.35" result="blur"/>' +
    '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>' +
    "</filter></defs>" +
    '<g class="studio-boot-elec-arcs" filter="url(#bootElecGlow)" fill="none" stroke="#67e8f9" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">' +
    '<path class="studio-boot-elec-path studio-boot-elec-path--a" d="M32 18 L27 24 L33 28 L29 34 L32 40"/>' +
    '<path class="studio-boot-elec-path studio-boot-elec-path--b" d="M46 32 L40 27 L36 33 L42 37 L48 34"/>' +
    '<path class="studio-boot-elec-path studio-boot-elec-path--c" d="M32 46 L37 40 L31 36 L35 30 L32 24"/>' +
    '<path class="studio-boot-elec-path studio-boot-elec-path--d" d="M18 32 L24 37 L28 31 L22 27 L16 30"/>' +
    '<path class="studio-boot-elec-path studio-boot-elec-path--e" d="M42 20 L38 26 L44 30 L40 34"/>' +
    '<path class="studio-boot-elec-path studio-boot-elec-path--f" d="M22 44 L26 38 L20 34 L24 30"/>' +
    "</g>" +
    '<g class="studio-boot-elec-nodes" fill="#ecfeff" filter="url(#bootElecGlow)">' +
    '<circle class="studio-boot-elec-node" cx="27" cy="24" r="1.55"/>' +
    '<circle class="studio-boot-elec-node" cx="33" cy="28" r="1.35"/>' +
    '<circle class="studio-boot-elec-node" cx="40" cy="27" r="1.55"/>' +
    '<circle class="studio-boot-elec-node" cx="36" cy="33" r="1.35"/>' +
    '<circle class="studio-boot-elec-node" cx="37" cy="40" r="1.55"/>' +
    '<circle class="studio-boot-elec-node" cx="24" cy="37" r="1.55"/>' +
    '<circle class="studio-boot-elec-node" cx="38" cy="26" r="1.2"/>' +
    '<circle class="studio-boot-elec-node" cx="26" cy="38" r="1.2"/>' +
    "</g></svg>";

  gear.querySelectorAll(".studio-boot-logo-gear-svg").forEach((el) => el.remove());
  gear.insertBefore(spin, percent || null);
}

upgradeBootMetalGear();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", upgradeBootMetalGear, { once: true });
}

void import("./boot-chrome.js?v=20260909-suggest-mic1-20260916-macmic1&leakfix31&discord=20260930-1").catch((err) => console.warn("[boot] chrome", err));

// Quest: CSS logo only. Second WebGL (boot-headset-scene gear/headset) crashed present.

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showBrowser(html) {
  const browser = document.getElementById("project-browser");
  if (browser && !window.__appProjectListReady) browser.innerHTML = html;
}

function bootSpinner(message = "Loading Render Studio…") {
  return `<div class="browser-boot-spinner" role="status" aria-live="polite">
    <span class="studio-boot-spinner studio-boot-spinner--inline" aria-hidden="true"></span>
    <p class="muted small">${esc(message)}</p>
  </div>`;
}

function dismissStudioBoot() {
  const el = document.getElementById("studio-boot-screen");
  if (!el || el.classList.contains("is-done") || el.dataset.dismissScheduled === "1") return;
  const tryGo = () => {
    if (typeof window.__studioBootCanDismiss === "function" && !window.__studioBootCanDismiss()) {
      window.setTimeout(tryGo, 200);
      return;
    }
    if (el.classList.contains("is-done") || el.dataset.dismissScheduled === "1") return;
    el.dataset.dismissScheduled = "1";
    window.__setStudioBootProgress?.(100, "Studio ready.");
    if (typeof window.__pinStudioSuggest === "function") {
      try { window.__pinStudioSuggest(); } catch (_) {}
    }
    const suggestOpen = document.body.classList.contains("studio-suggest-open")
      || (document.getElementById("studio-boot-suggest") && !document.getElementById("studio-boot-suggest").hidden);
    if (suggestOpen) {
      document.getElementById("studio-boot-suggest")?.classList.add("studio-boot-suggest--after-boot", "is-open");
      document.body.classList.add("studio-suggest-open");
    }
    if (typeof window.__completeStudioBootScreen === "function") {
      window.__completeStudioBootScreen(el, () => {
        window.__maybeStartStudioBootWalkthrough?.();
      });
      return;
    }
    el.classList.add("is-done");
    el.setAttribute("aria-busy", "false");
    document.body.classList.remove("studio-booting");
    window.setTimeout(() => {
      el.remove();
      window.__studioReady = true;
      try { window.dispatchEvent(new Event("render3d:studio-ready")); } catch (_) {}
      window.__maybeStartStudioBootWalkthrough?.();
    }, 160);
  };
  tryGo();
}

window.__dismissStudioBoot = dismissStudioBoot;

async function loadProjects() {
  window.__setStudioBootProgress?.(18, "Preparing projects and editor...");
  showBrowser(bootSpinner("Loading Render Studio…"));

  const token = getToken();
  if (!token) {
    window.__setStudioBootProgress?.(100, "Ready for sign in.");
    showBrowser('<p class="muted small browser-empty">Sign in to view your projects</p>');
    dismissStudioBoot();
    return;
  }

  try {
    let meRes = null;
    try {
      meRes = await Promise.race([
        fetch("/api/auth/me?lite=1", { headers: authHeaders(), credentials: "include" }),
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error("auth timeout")), 2500);
        }),
      ]);
    } catch {
      meRes = null;
    }
    window.__setStudioBootProgress?.(42, "Authenticating workspace...");
    if (meRes?.ok) {
      await meRes.json();
    } else if (isTokenExpired()) {
      throw new Error("Session expired — sign in again from the account menu.");
    }
    window.__setStudioBootProgress?.(64, "Preparing project list...");
    // app.js owns the project list and its account-scoped cache. A second
    // "warm" request here discarded its response and competed with the real
    // list for Supabase reads on every boot.

    if (window.__appProjectListReady) return;
    window.__setStudioBootProgress?.(82, "Loading editor systems...");
    showBrowser(bootSpinner("Loading editor…"));
  } catch (err) {
    showBrowser(`<p class="status error browser-empty">${esc(err.message || "Could not load projects")}</p>`);
    dismissStudioBoot();
  }
}

window.addEventListener("error", (e) => {
  if (window.__appProjectListReady) return;
  const msg = e.message || "Unknown error";
  if (/already been declared/i.test(msg)) {
    console.warn("[boot] ignored", msg, e.filename || "");
    return;
  }
  showBrowser(
    `<p class="status error browser-empty">Editor failed to start (${esc(msg)}). Hard refresh (Ctrl+Shift+R) or sign in again.</p>`
  );
  dismissStudioBoot();
});

window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled rejection:", e.reason);
});

loadProjects();
