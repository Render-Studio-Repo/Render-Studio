import { test } from "node:test";
import assert from "node:assert/strict";
import {
  shareTokenFromUrl,
  glbUrlFromShareMeta,
  newDropObjectId,
  isTextureAssetUrl,
  XR_PUBLIC_DROP_MAX,
} from "./xr-public-drops.js";

test("share token parses from lobby /share URLs", () => {
  assert.equal(shareTokenFromUrl("https://render3d.app/share/abc123"), "abc123");
  assert.equal(shareTokenFromUrl("/share/tok-1?x=1"), "tok-1");
  assert.equal(shareTokenFromUrl(""), "");
});

test("glb url prefers share metadata viewer_url", () => {
  assert.equal(
    glbUrlFromShareMeta({ viewer_url: "/api/share/t/files/part.glb" }),
    "/api/share/t/files/part.glb",
  );
  assert.match(
    glbUrlFromShareMeta({ viewer_filename: "mesh/a.glb", token: "zz" }),
    /\/api\/share\/zz\/files\//,
  );
});

test("drop ids are unique and visible room models are never evicted", () => {
  const a = newDropObjectId();
  const b = newDropObjectId();
  assert.notEqual(a, b);
  assert.match(a, /^drop-/);
  assert.equal(XR_PUBLIC_DROP_MAX, Infinity);
});

test("VR import skips image texture URLs", () => {
  assert.equal(isTextureAssetUrl("part.png"), true);
  assert.equal(isTextureAssetUrl("/maps/albedo.jpg?v=1"), true);
  assert.equal(isTextureAssetUrl("/api/share/t/files/bike.glb"), false);
});
