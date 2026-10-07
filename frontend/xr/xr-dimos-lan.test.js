import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DIMOS_CLOUD_VIEWER_COPY,
  colocatedDimosHint,
  dimosConnectPolicy,
  dimosDirectLanWsUrl,
  hostnameOf,
  isCloudStudioOrigin,
  isPrivateLanHost,
  isPublicDimosHost,
  studioCanProxyDimos,
} from "./xr-dimos-lan.js";
import {
  DIMOS_WS_DEFAULT,
  dimosQuestWsUrl,
  normalizeDimosWsInput,
  persistDimosWsUrl,
  studioDimosPipeUrl,
} from "./xr-dimos-teleop.js?v=roboticsworkspace3-20260915-dimosvr1-20260915-dimosy1-picontrols1-pistopsave1-pitriggerviser2-20260916-yreset1-teleophud1&xrtalk=20260916-1&robotemote=20260916-1&astra=20260916-5&teleopfix=20260916-1&inputfix=20260916-1&yarm1=1";

const here = dirname(fileURLToPath(import.meta.url));

test("host pref normalizes to a direct Quest→Pi wss URL", () => {
  const prevLoc = globalThis.location;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { protocol: "https:", host: "render3d.app", hostname: "render3d.app", search: "" },
  });
  try {
    assert.equal(normalizeDimosWsInput("192.168.1.50"), "wss://192.168.1.50:8443/ws");
    assert.equal(dimosDirectLanWsUrl("192.168.1.50"), "wss://192.168.1.50:8443/ws");
    assert.equal(studioDimosPipeUrl("192.168.1.50"), "wss://192.168.1.50:8443/ws");
    assert.equal(dimosQuestWsUrl("192.168.1.50"), "wss://192.168.1.50:8443/ws");
    assert.doesNotMatch(studioDimosPipeUrl("192.168.1.50"), /\/api\/dimos\/ws/);
  } finally {
    if (prevLoc === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis, "location", { configurable: true, value: prevLoc });
  }
});

test("render3d.app still opens direct LAN wss, not a Cloudflare :8443 pipe", () => {
  const prevLoc = globalThis.location;
  Object.defineProperty(globalThis, "location", {
    configurable: true,
    value: { protocol: "https:", host: "render3d.app", hostname: "render3d.app", search: "" },
  });
  try {
    assert.equal(isCloudStudioOrigin(), true);
    assert.equal(studioCanProxyDimos({ upstream: DIMOS_WS_DEFAULT }), true);
    assert.equal(studioDimosPipeUrl(DIMOS_WS_DEFAULT), "wss://192.168.1.77:8443/ws");
    assert.equal(studioDimosPipeUrl("wss://8.8.8.8:8443/ws"), "");
    assert.equal(normalizeDimosWsInput("8.8.8.8:8443"), DIMOS_WS_DEFAULT);
    assert.equal(isPublicDimosHost("8.8.8.8"), true);
    assert.equal(isPublicDimosHost("render3d.app"), true);
    const policy = dimosConnectPolicy(globalThis.location, DIMOS_WS_DEFAULT);
    assert.equal(policy.cloud, true);
    assert.equal(policy.canProxy, true);
    assert.match(policy.cloudCopy, /opens wss:\/\/<robot-lan>:8443\/ws directly/);
    assert.equal(policy.cloudCopy, DIMOS_CLOUD_VIEWER_COPY);
  } finally {
    if (prevLoc === undefined) delete globalThis.location;
    else Object.defineProperty(globalThis, "location", { configurable: true, value: prevLoc });
  }
});

test("LAN Studio offers colocated :8443 hint", () => {
  const loc = { protocol: "http:", host: "192.168.1.83:8001", hostname: "192.168.1.83" };
  assert.equal(isPrivateLanHost("192.168.1.83"), true);
  assert.equal(isPrivateLanHost("169.254.1.20"), true);
  assert.equal(isPrivateLanHost("openarm.local"), true);
  assert.equal(isPrivateLanHost("169.254.169.254"), false);
  assert.equal(hostnameOf("10.0.0.9:8443"), "10.0.0.9");
  assert.equal(colocatedDimosHint(loc), "wss://192.168.1.83:8443/ws");
  assert.equal(studioCanProxyDimos({ location: loc, upstream: "wss://192.168.1.83:8443/ws" }), true);
});

test("persist rejects a public 8443 and keeps a LAN host", () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
  };
  try {
    persistDimosWsUrl("8.8.8.8:8443");
    assert.equal(store.get("render3d:dimosWs"), DIMOS_WS_DEFAULT);
    persistDimosWsUrl("10.0.0.4:8443");
    assert.equal(store.get("render3d:dimosWs"), "wss://10.0.0.4:8443/ws");
  } finally {
    delete globalThis.localStorage;
  }
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.match(html, /20260909-dimosui1/);
  assert.match(html, /20260914-lanpc1/);
  assert.match(html, /20260915-dimosvr1/);
  assert.match(html, /data-dimos-viewer/);
  assert.match(html, /data-dimos-connect-pc/);
});
