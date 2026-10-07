import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cadBadgeLayout, liveCadConnections } from "./cad-avatar-badges.js";

test("live CAD chips require linked=true, not library-ready", () => {
  const rows = liveCadConnections({
    onshape: { linked: false },
    fusion: { linked: true, autodesk_email: "a@autodesk.example" },
    solidworks: { linked: true, count: 3 },
  });
  assert.deepEqual(rows.map((r) => r.id), ["fusion"]);
  assert.equal(rows[0].account, "a@autodesk.example");
});

test("Fusion account tooltip uses Autodesk email when passed as account", () => {
  const rows = liveCadConnections({
    fusion: { linked: true, account: "sam@autodesk.example" },
  });
  assert.equal(rows[0].account, "sam@autodesk.example");
});

test("1–2 connections: overlay on avatar, no toolbar chips, no multi glyph", () => {
  const two = cadBadgeLayout([
    { id: "onshape" },
    { id: "fusion" },
  ]);
  assert.equal(two.showMulti, false);
  assert.deepEqual(two.overlay.map((r) => r.id), ["onshape", "fusion"]);
  assert.equal(two.toolbar.length, 0);
  assert.equal(two.menu.length, 2);
});

test("3+ connections: overlay empty, no toolbar chips, menu chips + multi glyph", () => {
  const many = cadBadgeLayout([
    { id: "onshape" },
    { id: "fusion" },
    { id: "solidworks" },
    { id: "a" },
    { id: "b" },
    { id: "c" },
    { id: "d" },
  ]);
  assert.equal(many.showMulti, true);
  assert.equal(many.overlay.length, 0);
  assert.equal(many.toolbar.length, 0);
  assert.equal(many.menu.length, 6);
});

test("profile CAD overlays are decorative and sit inside the avatar button", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("./cad-avatar-badges.css", import.meta.url), "utf8");
  const js = readFileSync(new URL("./cad-avatar-badges.js", import.meta.url), "utf8");
  const btnStart = html.indexOf('id="btn-auth"');
  const btnEnd = html.indexOf("</button>", btnStart);
  const btn = html.slice(btnStart, btnEnd);
  assert.match(btn, /id="fusion-badge"/);
  assert.match(btn, /id="onshape-badge"/);
  assert.match(btn, /id="cad-avatar-multi"/);
  assert.match(btn, /id="collab-status"/);
  assert.match(html, /<span[^>]*id="cad-avatar-multi"/);
  assert.equal(/<button[^>]*id="cad-avatar-multi"/.test(html), false);
  assert.match(css, /pointer-events:\s*none\s*!important/);
  assert.match(css, /#cad-avatar-multi/);
  assert.match(css, /#collab-status/);
  assert.match(css, /\.auth-avatar-cluster\s*\{[^}]*z-index:\s*6/);
  assert.match(css, /\.toolbar-account-actions\s*\{[^}]*z-index:\s*1/);
  const init = js.slice(js.indexOf("export function initCadAvatarBadges"));
  assert.equal(/addEventListener\(\s*"click"/.test(init), false);
  assert.match(html, /cad-avatar-badges\.css\?v=20260908-profclick1/);
  assert.match(html, /app\.js\?v=20260908-.*profclick1/);
  assert.match(html, /app\.js\?v=20260908-.*profopen1/);
  assert.match(html, /app\.js\?v=20260908-.*acctfly1/);
  assert.match(html, /app\.js\?v=20260908-.*dimospf1/);
  assert.match(html, /app\.js\?v=20260908-.*acctovl1/);
  assert.equal(html.includes("btn-account-menu"), false);
});
