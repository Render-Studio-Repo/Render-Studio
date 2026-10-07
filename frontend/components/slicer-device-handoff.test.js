import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SLICER_HANDOFF_CLIENT_KEY,
  SLICER_HANDOFF_TTL_MS,
  detectSlicerHandoffOs,
  requestSlicerOnPersonalLaptop,
  shouldOfferSlicerHandoff,
  shouldPollSlicerHandoff,
  slicerHandoffClientId,
} from "./slicer-device-handoff.js";

test("a localhost source queues the handoff on the public artifact control plane", async () => {
  let requestUrl = "";
  const response = await requestSlicerOnPersonalLaptop({
    slicerId: "bambu",
    fileUrl: "https://render3d.app/api/share/public/files/part.3mf",
    filename: "part.3mf",
  }, async (url) => {
    requestUrl = url;
    return { ok: true, json: async () => ({ ok: true, id: "handoff-1" }) };
  });
  assert.equal(requestUrl, "https://render3d.app/api/xr-agent/open-slicer");
  assert.equal(response.id, "handoff-1");
});

test("a stable browser id is reused for cross-device handoff", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
  };
  const first = slicerHandoffClientId(storage);
  assert.equal(slicerHandoffClientId(storage), first);
  assert.equal(values.get(SLICER_HANDOFF_CLIENT_KEY), first);
});

test("only another recent desktop session receives the slicer request", () => {
  const now = 1_000_000;
  const request = {
    id: "req-1",
    at: now - 1000,
    slicer_id: "bambu",
    file_url: "https://studio.example/model.3mf",
    source_client_id: "source-mac",
  };
  assert.equal(shouldOfferSlicerHandoff(request, { clientId: "personal-laptop", now, userAgent: "Windows" }), true);
  assert.equal(shouldOfferSlicerHandoff(request, { clientId: "source-mac", now, userAgent: "Macintosh" }), false);
  assert.equal(shouldOfferSlicerHandoff(request, { clientId: "phone", now, userAgent: "iPhone" }), false);
  assert.equal(shouldOfferSlicerHandoff({ ...request, at: now - SLICER_HANDOFF_TTL_MS - 1 }, { clientId: "laptop", now, userAgent: "Windows" }), false);
});

test("the receiving laptop chooses its own operating system", () => {
  assert.equal(detectSlicerHandoffOs({ userAgent: "Mozilla/5.0 (Windows NT 10.0)", platform: "Win32" }), "windows");
  assert.equal(detectSlicerHandoffOs({ userAgent: "Mozilla/5.0 (Macintosh)", platform: "MacIntel" }), "macos");
});

test("a cookie-authenticated laptop polls while Render is visible or behind Bambu Studio", () => {
  assert.equal(shouldPollSlicerHandoff({ visibilityState: "visible" }), true);
  assert.equal(shouldPollSlicerHandoff({ visibilityState: "hidden" }), true);
  assert.equal(shouldPollSlicerHandoff({ visibilityState: "prerender" }), false);
});

test("the listener wakes after focus, page restore, and network reconnect", () => {
  const source = readFileSync(new URL("./slicer-device-handoff.js", import.meta.url), "utf8");
  assert.match(source, /addEventListener\("focus"/);
  assert.match(source, /addEventListener\("pageshow"/);
  assert.match(source, /addEventListener\("online"/);
});
