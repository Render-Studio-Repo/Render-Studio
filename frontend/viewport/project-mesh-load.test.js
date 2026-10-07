import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assembledStemsFromEntries,
  isExplodedSidecarName,
  isInternalModelArtifactName,
  resolveViewportViewer,
  shouldSkipDuplicateExploded,
  startBlobPrefetch,
} from "./project-mesh-load.js";

const here = dirname(fileURLToPath(import.meta.url));

test("exploded sidecars are skipped when the assembled parent is already queued", () => {
  assert.equal(isExplodedSidecarName("Bracket_exploded.glb"), true);
  assert.equal(isExplodedSidecarName("Bracket.glb"), false);
  const stems = assembledStemsFromEntries([
    { stem: "Bracket", name: "Bracket.step" },
    { name: "Bracket_exploded.glb" },
  ]);
  assert.equal(stems.has("bracket"), true);
  assert.equal(shouldSkipDuplicateExploded("Bracket_exploded.glb", stems), true);
  assert.equal(shouldSkipDuplicateExploded("Bracket.glb", stems), false);
  assert.equal(shouldSkipDuplicateExploded("Orphan_exploded.glb", stems), false);
});

test("startBlobPrefetch starts every fetch before the first await", async () => {
  const order = [];
  const jobs = [
    { key: "a", fetch: () => { order.push("start-a"); return Promise.resolve("A"); } },
    { key: "b", fetch: () => { order.push("start-b"); return Promise.resolve("B"); } },
  ];
  const map = startBlobPrefetch(jobs);
  order.push("after-start");
  const a = await map.get("a");
  const b = await map.get("b");
  assert.equal(a, "A");
  assert.equal(b, "B");
  assert.deepEqual(order.slice(0, 3), ["start-a", "start-b", "after-start"]);
});

test("resolveViewportViewer prefers recovered Jake sidecar over a ghost public GLB", () => {
  assert.equal(
    resolveViewportViewer(
      { name: "follow_the_attached_dxf_reference_and_create_a_simple_phillips_s.glb" },
      [
        {
          name: "follow_the_attached_dxf_reference_and_create_a_simple_phillips_s.glb",
          viewer_filename: ".follow_the_attached_dxf_reference_and_create_a_simple_phillips_s.step.glb",
        },
        "box.glb",
      ],
    ),
    ".follow_the_attached_dxf_reference_and_create_a_simple_phillips_s.step.glb",
  );
});

test("resolveViewportViewer maps folder STEP names to the sibling GLB", () => {
  assert.equal(
    resolveViewportViewer({ name: "vibecad/Clamp.step" }, ["vibecad/Clamp.step", "vibecad/Clamp.glb", "OpenArm_2.0.glb"]),
    "vibecad/Clamp.glb",
  );
  assert.equal(
    resolveViewportViewer({ name: "vibecad/Clamp.step", viewer_filename: "vibecad/Clamp.glb" }, []),
    "vibecad/Clamp.glb",
  );
  assert.equal(resolveViewportViewer({ name: "part.step" }, ["part.step"]), null);
  assert.equal(resolveViewportViewer({ name: "_share_visible_ZbXNZ8z5.glb" }, ["_share_visible_ZbXNZ8z5.glb", "arm.glb"]), null);
  assert.equal(
    resolveViewportViewer({ name: "new assem_3.obj" }, ["new assem_3.obj", "new assem_3.glb", "new assem_3.stl"]),
    "new assem_3.glb",
  );
});

test("share-bake sidecars are internal and not prefetch viewable", () => {
  assert.equal(isInternalModelArtifactName("_share_visible_ZbXNZ8z5.glb"), true);
  assert.equal(isInternalModelArtifactName("mesh/_share_visible_abcd.glb"), true);
  assert.equal(isInternalModelArtifactName("_export_visible_assembly.glb"), true);
  assert.equal(isInternalModelArtifactName("Recreate_The_Referenced_Part_As_A_Parametric_STEP.glb"), false);
});

test("cache-bust 20260908-loadstall2 is wired on app and glb-json-finite", () => {
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.match(app, /project-mesh-load\.js\?v=20260908-loadstall2-shareskip1-projswap1/);
  assert.match(app, /glb-json-finite\.js\?v=20260908-loadstall1/);
  assert.match(html, /app\.js\?v=[^"\s]*modelload1-siteup1-jsbuf1-shareskip1-projswap1-clickwin1-sitefast1-shareskip1-loginclog1-loadhud1/);
  assert.match(app, /base\.startsWith\("_share_"\)/);
});


test("secondary prefetch rejection is observed even before the primary finishes", async () => {
  const failure = new Error("missing mesh");
  const map = startBlobPrefetch([
    { key: "primary", fetch: () => new Promise(() => {}) },
    { key: "secondary", fetch: () => Promise.reject(failure) },
    { key: "sync", fetch: () => { throw failure; } },
  ]);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await assert.rejects(map.get("secondary"), /missing mesh/);
  await assert.rejects(map.get("sync"), /missing mesh/);
});
