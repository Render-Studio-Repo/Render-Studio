import test from "node:test";
import assert from "node:assert/strict";
import { voiceSpatialSelection } from "./voice-spatial-context.js";

test("voice spatial selection emits bounded world-space pointer and geometry vectors", () => {
  const result = voiceSpatialSelection({
    pointer: { kind: "point", world: [1.234567, 2, 3], object: "housing" },
    selectedFile: "housing.step",
    selection: { catalogName: "housing.step", label: "Housing" },
    references: [
      { id: "face-4", type: "face", mesh_uuid: "mesh-7", local_point: [1, 2, 3], normal: [0, 0, 1], face_indices: [4, 5] },
      { id: "path-5", type: "path", local_loop_points: [[0, 0, 0], [1, 1, 1]], surface_normals: [[0, 1, 0]] },
    ],
    toWorldPoint: ([x, y, z]) => [x + 10, y + 20, z + 30],
  });

  assert.deepEqual(result, {
    pointer: { kind: "point", world: [1.23457, 2, 3], object_id: "housing", file_id: "housing.step" },
    selected_object: { object_id: "housing.step", file_id: "housing.step", kind: "object" },
    references: [
      { id: "face-4", kind: "face", object_id: "mesh-7", file_id: "housing.step", world_position: [11, 22, 33], world_points: [], normal: [0, 0, 1], face_indices: [4, 5], edge_index: null, vertex_index: null },
      { id: "path-5", kind: "path", object_id: null, file_id: "housing.step", world_position: null, world_points: [[10, 20, 30], [11, 21, 31]], normal: null, face_indices: [], edge_index: null, vertex_index: null },
    ],
  });
});

test("voice spatial selection bounds references, vectors, and indices", () => {
  const references = Array.from({ length: 20 }, (_, index) => ({
    id: `lasso-${index}`,
    type: "lasso",
    loop_points: Array.from({ length: 70 }, (__, point) => [point, 0, 0]),
    face_indices: Array.from({ length: 120 }, (__, face) => face),
  }));
  const result = voiceSpatialSelection({ references });
  assert.equal(result.references.length, 16);
  assert.equal(result.references[0].id, "lasso-4");
  assert.equal(result.references[0].world_points.length, 40);
  assert.equal(result.references[0].face_indices.length, 40);
});
