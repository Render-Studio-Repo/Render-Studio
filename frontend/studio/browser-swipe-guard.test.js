import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  VIEWPORT_MENU_SELECTOR,
  isHorizontalHistorySwipe,
  isViewportMenuSurface,
  shouldBlockViewportPageZoom,
  viewportMenuIsOpen,
  shouldBlockHistorySwipe,
  initBrowserSwipeGuard,
} from "./browser-swipe-guard.js";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "browser-swipe-guard.js"), "utf8");
const css = readFileSync(join(here, "styles.css"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");

function fakeTarget(matches) {
  return {
    closest(sel) {
      const needles = Array.isArray(matches) ? matches : [matches];
      return needles.some((id) => String(sel).includes(id)) ? {} : null;
    },
  };
}

function wheelEvent(partial) {
  return {
    cancelable: true,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    deltaX: 0,
    deltaY: 0,
    target: fakeTarget([]),
    ...partial,
  };
}

test("guard registers a non-passive capture wheel listener on document", () => {
  assert.match(src, /root\.addEventListener\(\s*"wheel"/);
  assert.match(src, /passive:\s*false/);
  assert.match(src, /capture:\s*true/);
  assert.match(src, /onHistorySwipeWheel/);
  assert.match(html, /browser-swipe-guard\.js\?v=[^"]*viewport-pinch=20261001-1/);
  assert.match(html, /styles\.css\?v=[^"]*viewport-pinch=20261001-1/);
});

test("initBrowserSwipeGuard attaches wheel preventDefault on the document", () => {
  const listeners = [];
  const root = {
    body: { classList: { contains: () => false } },
    getElementById(id) {
      return id === "app" ? { classList: { contains: () => false } } : null;
    },
    addEventListener(type, fn, opts) {
      listeners.push({ type, fn, opts });
    },
  };
  assert.equal(initBrowserSwipeGuard(root), true);
  assert.equal(listeners.length, 3);
  assert.equal(listeners[0].type, "wheel");
  assert.equal(listeners[0].opts.passive, false);
  assert.equal(listeners[0].opts.capture, true);
  let prevented = false;
  listeners[0].fn(wheelEvent({
    deltaX: 48,
    deltaY: 2,
    target: fakeTarget("#viewport"),
    preventDefault() { prevented = true; },
  }));
  assert.equal(prevented, true);
});

test("horizontal trackpad swipe over the video editor is blocked", () => {
  assert.match(VIEWPORT_MENU_SELECTOR, /#viewport-video-share-modal/);
  assert.match(VIEWPORT_MENU_SELECTOR, /#screenshot-markup-modal/);
  assert.match(VIEWPORT_MENU_SELECTOR, /#r3d-record-overlay/);
  assert.match(VIEWPORT_MENU_SELECTOR, /#ref-viewer/);
  assert.equal(isViewportMenuSurface(fakeTarget("#viewport-video-share-modal")), true);
  assert.equal(isHorizontalHistorySwipe(wheelEvent({ deltaX: 40, deltaY: 4 })), true);
  assert.equal(isHorizontalHistorySwipe(wheelEvent({ deltaX: 4, deltaY: 40 })), false);
  assert.equal(shouldBlockHistorySwipe(wheelEvent({
    deltaX: 32,
    deltaY: 3,
    target: fakeTarget("#viewport-video-share-modal"),
  }), { canScroll: () => false }), true);
  assert.equal(shouldBlockHistorySwipe(wheelEvent({
    deltaX: 8,
    deltaY: 1,
    target: fakeTarget("#viewport"),
  }), { canScroll: () => false }), true);
});

test("timeline overflow still scrolls and viewport pinch cannot zoom browser chrome", () => {
  assert.equal(shouldBlockHistorySwipe(wheelEvent({
    deltaX: 40,
    deltaY: 2,
    target: fakeTarget(".vtl-host"),
  }), { canScroll: () => true }), false);
  assert.equal(shouldBlockHistorySwipe(wheelEvent({
    ctrlKey: true,
    deltaX: 40,
    deltaY: 2,
    target: fakeTarget("#viewport"),
  }), { canScroll: () => false }), false);
  assert.equal(shouldBlockViewportPageZoom(wheelEvent({
    ctrlKey: true,
    deltaY: -12,
    target: fakeTarget("#viewport"),
  })), true);
  assert.equal(shouldBlockViewportPageZoom(wheelEvent({
    ctrlKey: true,
    deltaY: -12,
    target: fakeTarget([]),
  })), false);
  assert.equal(shouldBlockViewportPageZoom({
    type: "gesturechange",
    cancelable: true,
    target: fakeTarget("#viewport"),
  }), true);
  assert.equal(shouldBlockHistorySwipe(wheelEvent({
    deltaX: 4,
    deltaY: 40,
    target: fakeTarget("#viewport"),
  }), { canScroll: () => false }), false);
});

test("open overlay blocks swipe even when the pointer is outside the menu", () => {
  const root = { querySelector: (sel) => String(sel).includes("#viewport-video-share-modal") ? {} : null };
  assert.equal(viewportMenuIsOpen(root), true);
  assert.equal(shouldBlockHistorySwipe(wheelEvent({
    deltaX: 8,
    deltaY: 1,
    target: fakeTarget([]),
  }), { overlayOpen: true, canScroll: () => false }), true);
  assert.equal(shouldBlockHistorySwipe(wheelEvent({
    deltaX: 8,
    deltaY: 1,
    target: fakeTarget([]),
  }), { overlayOpen: false, canScroll: () => false }), false);
});

test("CSS kills x overscroll on html, viewport, and editor hosts", () => {
  assert.match(css, /html:has\(\s*>\s*body:not\(\.info-page\)\s*\)/);
  assert.match(css, /overscroll-behavior-x:\s*none/);
  assert.match(css, /Mac trackpad swipe-to-go-back/);
  assert.match(css, /#viewport \{\s*flex: 1 1 auto;[\s\S]*?overscroll-behavior-x:\s*none/);
  assert.match(css, /#viewport-video-share-modal/);
  assert.match(css, /#screenshot-markup-modal/);
  assert.match(css, /#r3d-record-overlay/);
  assert.match(css, /\.clip-editor-workspace/);
  assert.match(css, /\.vtl-host/);
});
