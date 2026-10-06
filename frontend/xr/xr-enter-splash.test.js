import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  killBootSplashDomForXr,
  restoreBootSplashAfterXrFail,
  shouldRevealViewportBeforeXrSession,
  shouldSetXrEnterChosenBeforeSession,
  xrEnterFailMessage,
  freezeAnimatedSvgForTexture,
  shouldDismissXrEnterSplash,
  shouldShowXrEnterSplash,
  shouldUploadXrEnterSplashTexture,
  shouldInjectXrEnterDomOverlay,
  xrEnterSplashWorldPos,
  XR_ENTER_SPLASH_DISTANCE,
  XR_ENTER_SPLASH_OVERLAY_ID,
  XR_ENTER_SPLASH_SVG,
  XR_ENTER_SPLASH_TEX_SIZE,
} from "./xr-enter-splash.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoFrontend = join(here, "..");

test("desktop never shows the in-world enter splash", () => {
  assert.equal(shouldShowXrEnterSplash({ presenting: false }), false);
  assert.equal(shouldShowXrEnterSplash({}), false);
  assert.equal(shouldShowXrEnterSplash({ presenting: true }), true);
  assert.equal(shouldUploadXrEnterSplashTexture({ presenting: true }), false);
  assert.equal(shouldInjectXrEnterDomOverlay({ presenting: true }), false);
});

test("splash dismisses on scene-ready signals after a short pop", () => {
  assert.equal(shouldDismissXrEnterSplash({
    presenting: true,
    worldAnchored: true,
    shownMs: 100,
  }), false);
  assert.equal(shouldDismissXrEnterSplash({
    presenting: true,
    worldAnchored: true,
    shownMs: 500,
  }), true);
  assert.equal(shouldDismissXrEnterSplash({
    presenting: true,
    emptySceneReady: true,
    shownMs: 500,
  }), true);
  assert.equal(shouldDismissXrEnterSplash({
    presenting: true,
    pendingCleared: true,
    shownMs: 500,
  }), true);
  assert.equal(shouldDismissXrEnterSplash({
    presenting: true,
    shownMs: 9000,
  }), true);
  assert.equal(shouldDismissXrEnterSplash({
    presenting: false,
    shownMs: 50,
  }), true);
  assert.equal(shouldDismissXrEnterSplash({
    presenting: true,
    sessionEnded: true,
    shownMs: 50,
  }), true);
});

test("mark sits in front of the headset at a comfortable distance", () => {
  const pos = xrEnterSplashWorldPos({ x: 0, y: 1.6, z: 0 }, { x: 0, y: 0, z: -1 });
  assert.equal(pos.y, 1.6);
  assert.ok(Math.abs(pos.z + XR_ENTER_SPLASH_DISTANCE) < 1e-9);
  assert.ok(XR_ENTER_SPLASH_SVG.includes("render-vr-animated.svg"));
  const svgPath = join(
    repoFrontend,
    "media/images/render-animations/VR-Animations/render-vr-animated.svg",
  );
  assert.ok(existsSync(svgPath), svgPath);
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(xr.includes("xr-enter-splash.js?v=20260908-xr-set1"));
  assert.ok(xr.includes("20260909-xr-qfix1"));
  assert.ok(XR_ENTER_SPLASH_SVG.includes("v=20260908-vr-svg1"));
  assert.ok(xr.includes("xrEnterSplash.show"));
  assert.ok(xr.includes("xrEnterSplash.tick"));
  assert.ok(xr.includes("emptySceneReady"));
});

test("enter splash never keeps a live animated SVG as a WebGL texture", () => {
  const svg = `<svg width="1080" height="1080"><filter id="glow"></filter><g filter="url(#glow)"><animateTransform type="scale" dur="4s"/><animate attributeName="opacity" dur=".7s"/></g></svg>`;
  const frozen = freezeAnimatedSvgForTexture(svg);
  assert.equal(frozen.includes("animate"), false);
  assert.equal(frozen.includes("filter"), false);
  assert.ok(frozen.includes(`width="${XR_ENTER_SPLASH_TEX_SIZE}"`));
  const src = readFileSync(join(here, "xr-enter-splash.js"), "utf8");
  assert.equal(src.includes("TextureLoader"), false);
  assert.ok(src.includes("CanvasTexture"));
  assert.ok(src.includes("FrontSide"));
  assert.equal(shouldUploadXrEnterSplashTexture({ presenting: true }), false);
  assert.equal(shouldInjectXrEnterDomOverlay({ presenting: true }), false);
  assert.ok(src.includes("showLiveOverlay"));
  assert.ok(src.includes("shouldInjectXrEnterDomOverlay"));
  assert.ok(src.includes("xr-enter-splash-live"));
  assert.equal(XR_ENTER_SPLASH_OVERLAY_ID, "xr-enter-splash-overlay");
  assert.ok(src.includes("if (!shouldUploadXrEnterSplashTexture({ presenting: true })) return;"));
  assert.ok(src.includes("killBootSplashDomForXr"));
});

test("killBootSplashDomForXr is safe when there is no boot DOM", () => {
  assert.equal(typeof killBootSplashDomForXr, "function");
  killBootSplashDomForXr();
});

test("Enter VR failure stays on the splash, not the desktop viewport", () => {
  assert.equal(shouldRevealViewportBeforeXrSession(), false);
  assert.equal(shouldSetXrEnterChosenBeforeSession(), false);
  assert.ok(xrEnterFailMessage(new Error("NotSupportedError")).includes("immersive VR"));
  restoreBootSplashAfterXrFail("Could not start VR.");
  const html = readFileSync(join(repoFrontend, "index.html"), "utf8");
  const app = readFileSync(join(repoFrontend, "studio/app.js"), "utf8");
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const enterFn = html.slice(html.indexOf("function requestXrEnter"), html.indexOf("function bindBootXrBtn"));
  const bindFn = html.slice(html.indexOf("function bindBootXrBtn"), html.indexOf("bindBootXrBtn(document"));
  assert.equal(enterFn.includes("__studioXrEnterChosen = true"), false);
  assert.ok(enterFn.includes("Could not start VR"));
  assert.ok(bindFn.includes('addEventListener("click"'));
  assert.equal(/pointerup[\s\S]{0,180}go\(e\)/.test(bindFn), false);
  const bootEnter = app.slice(app.indexOf("window.__enterXrFromBoot"), app.indexOf("window.__openDeferredXrProject"));
  assert.equal(bootEnter.includes("revealViewportForXrEnter()"), false);
  assert.equal(bootEnter.includes("__studioXrEnterChosen = true"), false);
  assert.ok(bootEnter.includes("restoreBootSplashAfterXrFail"));
  assert.ok(xr.includes("xrEnterSessionMode"));
  assert.ok(xr.includes('fromBoot: !!bootEnter.fromBoot'));
  assert.ok(xr.includes("restoreBootSplashAfterXrFail"));
  assert.equal(xr.includes('killBootSplashDomForXr(); } catch (_) {}\n      return pending'), false);
});

test("headset boot uses the live SVG; desktop keeps gear collage", () => {
  const html = readFileSync(join(repoFrontend, "index.html"), "utf8");
  const css = readFileSync(join(repoFrontend, "studio/styles.css"), "utf8");
  assert.ok(html.includes("studio-boot-headset-live-svg"));
  assert.ok(html.includes("render-vr-animated.svg?v=20260908-vr-svg1"));
  assert.ok(html.includes("studio-boot-headset-live-svg"));
  const enterFn = html.slice(html.indexOf("function requestXrEnter"), html.indexOf("function bindBootXrBtn"));
  assert.equal(enterFn.includes('classList.add("xr-presenting")'), false);
  assert.equal(enterFn.includes("__studioXrEnterChosen = true"), false);
  assert.ok(enterFn.includes("removeAttribute"));
  assert.ok(enterFn.includes("studio-boot-headset-live-svg"));
  assert.ok(enterFn.includes("__studioXrEnterFailedKeepSplash"));
  assert.ok(html.includes("studio-boot-vr-collage"));
  assert.ok(html.includes("render-vr-logo"));
  assert.ok(html.includes("A148.0 148.0"));
  assert.ok(css.includes("html:not(.vr-headset-browser) .studio-boot-headset-live-svg"));
  assert.ok(css.includes("html.vr-headset-browser .studio-boot-vr-collage"));
  assert.ok(css.includes("body.xr-presenting .studio-boot-headset-live-svg"));
  assert.ok(css.includes(".xr-enter-splash-overlay"));
  assert.ok(css.includes("pointer-events: none"));
  const uaAt = html.indexOf("Desktop Chrome has navigator.xr");
  const uaScript = html.slice(uaAt, uaAt + 900);
  assert.ok(uaScript.includes("OculusBrowser|MetaBrowser|HorizonOS|XRBrowser|Mobile VR|Wolvic|Helio|PicoBrowser"));
  assert.match(uaScript, /var headset = \/OculusBrowser/);
});
