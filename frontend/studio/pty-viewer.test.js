import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PTY_DEFAULT_HOST,
  PTY_DEFAULT_PORT,
  PTY_START_CMD,
  normalizePtyHost,
  normalizePtyPort,
  ptyProxyPath,
  ptyWsUrl,
  shouldUseStudioProxy,
} from "./pty-viewer.js";

const here = dirname(fileURLToPath(import.meta.url));

test("PTY defaults stay loopback and proxy is authenticated Studio path", () => {
  assert.equal(PTY_DEFAULT_HOST, "127.0.0.1");
  assert.equal(PTY_DEFAULT_PORT, 8765);
  assert.equal(normalizePtyHost("0.0.0.0"), "127.0.0.1");
  assert.equal(normalizePtyHost("localhost"), "127.0.0.1");
  assert.equal(normalizePtyPort("nope"), 8765);
  assert.equal(ptyProxyPath("127.0.0.1", 8765), "/api/pty/p/127.0.0.1/8765/");
  assert.equal(
    ptyWsUrl({ protocol: "https:", pageHost: "render3d.app", sidecarHost: "127.0.0.1", sidecarPort: 8765 }),
    "wss://render3d.app/api/pty/p/127.0.0.1/8765/",
  );
  assert.equal(shouldUseStudioProxy({ protocol: "https:" }), true);
  assert.equal(shouldUseStudioProxy({ protocol: "http:" }), false);
  assert.match(PTY_START_CMD, /scripts\/cursor-pty-bridge/);
});

test("Robotics tab has Local PTY chrome and cache-bust pty1", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const app = readFileSync(join(here, "app.js"), "utf8");
  assert.match(html, /id="robotics-pty"/);
  assert.match(html, /data-pty-connect/);
  assert.match(html, /python3 scripts\/cursor-pty-bridge/);
  assert.match(html, /pty1/);
  assert.match(app, /createPtyViewer/);
  assert.match(app, /pty-viewer\.js\?v=pty1/);
});
