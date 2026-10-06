import test from "node:test";
import assert from "node:assert/strict";
import {
  collectStudioProjectFiles,
  shopPrintFindings,
  shopStatusLine,
  createShopCrew,
  SHOPTASK1_TOKEN,
} from "./sandbox-shop-task.js";

test("collectStudioProjectFiles unions browser bags and latest", () => {
  const files = collectStudioProjectFiles({
    files: [],
    latest_file: "hero.stl",
    browser: {
      components: [{ filename: "arm.glb", size: 1200 }],
      references: [{ name: "notes.md" }],
    },
  });
  const names = files.map((f) => f.name).sort();
  assert.deepEqual(names, ["arm.glb", "hero.stl", "notes.md"]);
  assert.equal(SHOPTASK1_TOKEN, "shoptask1");
});

test("shop stays quiet when meshes look printable", () => {
  const out = shopPrintFindings([
    { name: "a.stl", size: 4000 },
    { name: "b.3mf", size: 8000 },
    { name: "c.stl", size: 2000 },
  ]);
  assert.equal(out.alerts.length, 0);
  assert.match(shopStatusLine(out), /quiet/);
});

test("shop alerts on non-slicer CAD and stays silent otherwise", async () => {
  const spoken = [];
  const crew = createShopCrew({
    speak: async (who, text) => { spoken.push({ who, text }); },
  });
  const ok = await crew.run([{ name: "ok.stl", size: 3000 }]);
  assert.equal(ok.alerts.length, 0);
  assert.equal(spoken.length, 0);
  const bad = await crew.run([{ name: "part.glb", size: 5000 }], { pick: ["part.glb"] });
  assert.ok(bad.alerts.length >= 1);
  assert.equal(spoken.length, 1);
  assert.equal(spoken[0].who, "astra");
});
