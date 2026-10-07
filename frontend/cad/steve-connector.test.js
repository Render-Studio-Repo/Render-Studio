import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SteveConnector,
  classifySteveStatus,
  normalizeDesignName,
  signSteveSubmission,
  suggestedDesignName,
} from "./steve-connector.js";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../index.html"), "utf8");

test("CAD picker exposes STEVE status, recovery, destination, and editable name controls", () => {
  assert.match(html, /data-cad-engine="steve"/);
  assert.match(html, /data-steve-status-dot/);
  assert.match(html, /data-steve-connect/);
  assert.match(html, /data-steve-design-name/);
  assert.match(html, /Current Fusion project and folder/);
  assert.match(html, /Project and folder browsing is coming/);
  assert.match(html, /https:\/\/github\.com\/10-X-eng\/STEVE/);
});

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

test("status response maps into the explicit connection state machine", () => {
  assert.equal(classifySteveStatus({ version: "1.0.0", fusionRunning: false }), "unavailable");
  assert.equal(classifySteveStatus({ version: "1.0.0", fusionRunning: true }), "detected");
  assert.equal(classifySteveStatus({ version: "1.0.0", fusionRunning: true, pairingId: "p1" }), "pairing");
  assert.equal(classifySteveStatus({ version: "1.0.0", fusionRunning: true, connected: true }, { hasSecret: true }), "connected_not_ready");
  assert.equal(classifySteveStatus({ version: "1.0.0", fusionRunning: true, connected: true, providerReady: true, ready: true }, { hasSecret: true }), "ready");
  assert.equal(classifySteveStatus({ version: "1.0.0", fusionRunning: true, connected: true, providerReady: true, ready: true, queueDepth: 1 }, { hasSecret: true }), "busy");
  assert.equal(classifySteveStatus({ version: "2.0.0", fusionRunning: true }), "incompatible");
  assert.equal(classifySteveStatus({ version: "1.0.0", phase: "error", fusionRunning: true }), "error");
});

test("design name is editable-safe and predictably suggested", () => {
  assert.equal(normalizeDesignName("  Clamp / Bracket?!  "), "Clamp Bracket");
  assert.equal(suggestedDesignName("Create an adjustable desk clamp", new Date("2026-09-30T12:00:00Z")), "create-an-adjustable-desk-clamp-20260930");
});

test("submission signature uses the exact body and canonical protocol order", async () => {
  const body = '{"prompt":"make a bracket","designName":"bracket-1"}';
  const signature = await signSteveSubmission({
    secret: "test-secret",
    body,
    requestId: "request-1",
    timestamp: "1790800000",
    nonce: "00112233445566778899aabbccddeeff",
    cryptoApi: webcrypto,
  });
  assert.equal(signature, "a721318f883b141d03de7ffb0d25960937f230c0e5d98840b57e45da7475f893");
});

test("pairing waits for Fusion approval and stores the returned secret", async () => {
  const writes = [];
  const calls = [];
  const replies = [
    response(200, { pairingId: "pair-1" }),
    response(409, { code: "pairing_pending" }),
    response(200, { secret: "paired-secret" }),
    response(200, { version: "1.0.0", fusionRunning: true, connected: true, providerReady: true, ready: true }),
  ];
  const connector = new SteveConnector({
    fetchFn: async (url, options) => { calls.push([url, options]); return replies.shift(); },
    secretStore: { read: async () => null, write: async (value) => writes.push(value), clear: async () => {} },
    schedule: (fn) => { queueMicrotask(fn); return 1; },
    cancelSchedule: () => {},
  });
  connector.active = true;
  await connector.pair();
  connector.deactivate();
  assert.equal(connector.state, "ready");
  assert.deepEqual(writes, ["paired-secret"]);
  assert.equal(calls[0][0], "http://127.0.0.1:38173/v1/pairing/request");
  assert.equal(calls[1][1].body, '{"pairingId":"pair-1"}');
});

test("ready connector submits the exact compact payload with auth headers", async () => {
  let captured;
  const connector = new SteveConnector({
    fetchFn: async (url, options) => { captured = { url, options }; return response(202, { accepted: true }); },
    cryptoApi: {
      subtle: webcrypto.subtle,
      randomUUID: () => "request-fixed",
      getRandomValues: (bytes) => bytes.fill(1),
    },
    secretStore: { read: async () => "secret", write: async () => {}, clear: async () => {} },
    schedule: () => 1,
    cancelSchedule: () => {},
  });
  connector.secret = "secret";
  connector.state = "ready";
  const result = await connector.submit({
    prompt: "Make a hinge",
    projectId: "project-1",
    folderId: "folder-2",
    designName: "Hinge A",
  });
  assert.equal(result.requestId, "request-fixed");
  assert.equal(captured.url, "http://127.0.0.1:38173/v1/submissions");
  assert.equal(captured.options.body, '{"prompt":"Make a hinge","projectId":"project-1","folderId":"folder-2","designName":"Hinge A"}');
  assert.equal(captured.options.headers["X-Request-Id"], "request-fixed");
  assert.match(captured.options.headers["X-Steve-Signature"], /^[0-9a-f]{64}$/);
});
