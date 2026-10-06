import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGenerationPlacement, generationPlacementFromSurface, resolveGenerationPlacement } from "./generation-placement.js";
import { normalizeWorkshopConfig } from "./workshop-config.js";

test("default generation sits above the center desk with a 0.6 metre longest side", () => {
  const result = resolveGenerationPlacement({ modelBounds: { min: [-500, 0, -500], max: [500, 1000, 500] } });
  assert.equal(result.scaleMultiplier, 0.0006);
  assert.deepEqual(result.center, [0, 1.135, -1.8]);
  assert.equal(result.center[1] - 0.3, 0.835);
});

test("custom faces support all bounding corners without rotating the model", () => {
  const placement = generationPlacementFromSurface({ position: [2, 1, 0], normal: [2, 0, 0], surfaceId: "table-face", label: "Table edge" }, { sizeMeters: 0.4 });
  const result = resolveGenerationPlacement({ placement, modelBounds: { min: [0, 0, 0], max: [1, 2, 1] } });
  assert.equal(result.scaleMultiplier, 0.2);
  assert.deepEqual(result.center, [2.105, 1, 0]);
  assert.equal("quaternion" in result, false);
});

test("desktop bypass and invalid bounds leave models untouched", () => {
  const modelBounds = { min: [0, 0, 0], max: [1, 1, 1] };
  assert.equal(resolveGenerationPlacement({ modelBounds, active: false }), null);
  assert.equal(resolveGenerationPlacement({ modelBounds: { min: [NaN, 0, 0], max: [1, 1, 1] } }), null);
  assert.equal(resolveGenerationPlacement({ modelBounds, sceneBounds: { width: 1, height: 1, depth: 1 } }), null);
  assert.equal(generationPlacementFromSurface({ position: [0, 0, 0], normal: [0, 0, 0] }), null);
});

test("canonical workshop configuration targets its named CAD worktop", () => {
  const config = normalizeWorkshopConfig({ generationPlacement: { target: "surface", position: [1, 0.8, -2], normal: [0, 2, 0], sizeMeters: 0.25 } }, "project-a");
  assert.equal(config.projectId, "project-a");
  assert.deepEqual(config.generationPlacement.normal, [0, 1, 0]);
  assert.deepEqual(config.generationPlacement.position, [4.13, 0.885, -4.8]);
  assert.equal(config.generationPlacement.surfaceId, "Composite_worktop_2");
  assert.equal(normalizeGenerationPlacement().target, "center-desk-plate");
});
