import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VR_GROUP_NAME,
  DEFAULT_VR_ROOM_NAME,
  VR_CREATIONS_FOLDER,
  VR_ROOM_ID,
  authorHighlightText,
  buildVrCreationEntries,
  emptyXrCreationsState,
  flattenVrExplorerItems,
  groupBodiesAsComponent,
  inferXrBodiesFromComponents,
  isFreecadPrimitiveFilename,
  isVrCreationEntry,
  nestXrCreationsInBrowser,
  nextBodyLabel,
  remapXrBodyFilename,
  sortXrCreationComponents,
  upsertXrBody,
} from "./xr-creations-browser.js";

test("VR solids get sequential body names, not a new component each", () => {
  assert.equal(nextBodyLabel("cylinder", []), "Cylinder");
  assert.equal(nextBodyLabel("cylinder", ["Cylinder"]), "Cylinder2");
  assert.equal(nextBodyLabel("box", ["Box", "Box2"]), "Box3");
});

test("ungrouped VR bodies live under VR Room inside VR Creations", () => {
  let state = emptyXrCreationsState();
  state = upsertXrBody(state, {
    filename: "xr_cylinder_1.glb",
    kind: "cylinder",
    authorName: "Ada",
    createdAt: 100,
  });
  state = upsertXrBody(state, {
    filename: "xr_box_2.glb",
    kind: "box",
    authorName: "Ada",
    createdAt: 200,
  });
  const nested = nestXrCreationsInBrowser(
    { components: [{ name: "xr_cylinder_1.glb" }, { name: "Openarm.glb" }], references: [{ name: "xr_creations.json" }] },
    state,
  );
  assert.equal(nested.components.some((c) => c.name === "Openarm.glb"), true);
  assert.equal(nested.components.some((c) => /xr_/.test(c.name)), false);
  assert.equal(nested.references.some((r) => r.name === "xr_creations.json"), false);
  assert.equal(nested.vr_creations.length, 1);
  assert.equal(nested.vr_creations[0].label, DEFAULT_VR_ROOM_NAME);
  assert.equal(nested.vr_creations[0].xr_headset, true);
  assert.equal(nested.vr_creations[0].children_label, "Bodies");
  assert.equal(nested.vr_creations[0].children.length, 2);
  assert.equal(nested.vr_creations[0].children[0].virtual_body, true);
  assert.match(authorHighlightText(nested.vr_creations[0].children[1]), /Ada/);
  assert.equal(VR_CREATIONS_FOLDER, "VR Creations");
});

test("group-select release names a component whose children are the selected bodies", () => {
  let state = emptyXrCreationsState();
  state = upsertXrBody(state, { id: "a", filename: "xr_a.glb", kind: "cylinder", createdAt: 1 });
  state = upsertXrBody(state, { id: "b", filename: "xr_b.glb", kind: "box", createdAt: 2 });
  state = upsertXrBody(state, { id: "c", filename: "xr_c.glb", kind: "sphere", createdAt: 3 });
  state = groupBodiesAsComponent(state, ["a", "b"], {
    name: DEFAULT_VR_GROUP_NAME,
    authorName: "Sam",
    createdAt: 9,
  });
  const entries = buildVrCreationEntries(state);
  const group = entries.find((e) => e.label === DEFAULT_VR_GROUP_NAME);
  const room = entries.find((e) => e.label === DEFAULT_VR_ROOM_NAME);
  assert.ok(group);
  assert.deepEqual(group.children.map((c) => c.label).sort(), ["Box", "Cylinder"]);
  assert.equal(room.children.length, 1);
  assert.equal(group.authorName, "Sam");
});

test("Group by newest is default; user / name / kind also sort", () => {
  const comps = [
    { id: "old", name: "Alpha", createdAt: 1, authorName: "Zoe", kind: "group" },
    { id: VR_ROOM_ID, name: DEFAULT_VR_ROOM_NAME, implicit: true, createdAt: 2, authorName: "Ada", kind: "room" },
    { id: "new", name: "Beta", createdAt: 9, authorName: "Ada", kind: "group" },
  ];
  const newest = sortXrCreationComponents(comps, [], "newest");
  assert.equal(newest[0].id, "new");
  const named = sortXrCreationComponents(comps, [], "name");
  assert.equal(named[0].name, "Alpha");
  const users = sortXrCreationComponents(comps, [], "user");
  assert.equal(users[0].authorName, "Ada");
  const kinds = sortXrCreationComponents(comps, [], "kind");
  assert.ok(kinds.find((c) => c.kind === "room"));
});

test("persist remap keeps the body under the same component after FreeCAD save", () => {
  let state = upsertXrBody(emptyXrCreationsState(), {
    id: "__create_cylinder_1.local",
    filename: "__create_cylinder_1.local",
    kind: "cylinder",
  });
  state = remapXrBodyFilename(state, "__create_cylinder_1.local", "cylinder.glb");
  assert.equal(state.bodies[0].filename, "cylinder.glb");
  assert.equal(state.bodies[0].componentId, VR_ROOM_ID);
});

test("xr_ prefix files without metadata still nest as VR Room bodies", () => {
  const state = inferXrBodiesFromComponents(
    [{ name: "xr_combine_20260907.glb" }, { name: "fixture.glb" }],
    emptyXrCreationsState(),
  );
  assert.equal(state.bodies.length, 1);
  assert.equal(state.bodies[0].kind, "combine");
});

test("FreeCAD VR primitives nest under VR Room, not Components", () => {
  const nested = nestXrCreationsInBrowser({
    components: [
      { name: "box.step", stem: "box", freecad_primitive: true },
      { name: "box2.glb", stem: "box2", freecad_primitive: true },
      { name: "DJ Control Board.glb", stem: "DJ Control Board" },
    ],
  });
  assert.equal(nested.components.some((c) => c.name === "DJ Control Board.glb"), true);
  assert.equal(nested.components.some((c) => /^box/i.test(c.stem || c.name)), false);
  assert.equal(nested.vr_creations.length, 1);
  assert.equal(nested.vr_creations[0].label, DEFAULT_VR_ROOM_NAME);
  assert.deepEqual(nested.vr_creations[0].children.map((c) => c.label).sort(), ["Box", "Box2"]);
});

test("Box/Cone stems remapped without freecad_primitive flag", () => {
  assert.equal(isFreecadPrimitiveFilename("cone10.glb"), true);
  assert.equal(isFreecadPrimitiveFilename("Box4.step"), true);
  assert.equal(isVrCreationEntry({ name: "cone3.glb", stem: "cone3" }), true);
  const nested = nestXrCreationsInBrowser({
    components: [
      { name: "box.glb", stem: "box" },
      { name: "box2.glb", stem: "box2" },
      { name: "box3.glb", stem: "box3" },
      { name: "box4.glb", stem: "box4" },
      { name: "cone.glb", stem: "cone" },
      { name: "cone2.glb", stem: "cone2" },
      { name: "cone10.glb", stem: "cone10" },
      { name: "Openarm.glb", stem: "Openarm" },
    ],
  });
  assert.equal(nested.components.map((c) => c.name).join(","), "Openarm.glb");
  assert.equal(nested.vr_creations[0].children_label, "Bodies");
  const labels = nested.vr_creations[0].children.map((c) => c.label).sort();
  assert.deepEqual(labels, ["Box", "Box2", "Box3", "Box4", "Cone", "Cone10", "Cone2"]);
});

test("VR-generated prompt solids remapped as VR Room bodies, not Components", () => {
  const nested = nestXrCreationsInBrowser({
    components: [
      { name: "FollowingTheAttachedDxfReferenceAndCreated.glb", stem: "FollowingTheAttachedDxfReferenceAndCreated", vr_generation: true, client: "xr" },
      { name: "CreateASimplifiedParametric20OzSoda.glb", stem: "CreateASimplifiedParametric20OzSoda", xr_creation: true },
      { name: "Cart.glb", stem: "Cart" },
    ],
  });
  assert.equal(nested.components.some((c) => c.name === "Cart.glb"), true);
  assert.equal(nested.components.length, 1);
  const labels = nested.vr_creations[0].children.map((c) => c.label).sort();
  assert.ok(labels.some((l) => /FollowingTheAttached/.test(l)));
  assert.ok(labels.some((l) => /CreateASimplifiedParametric/.test(l)));
});

test("headset explorer flattens VR Room / body labels", () => {
  const nested = nestXrCreationsInBrowser(
    { components: [{ name: "xr_sphere_1.glb" }] },
    upsertXrBody(emptyXrCreationsState(), { filename: "xr_sphere_1.glb", kind: "sphere", label: "Sphere" }),
  );
  const items = flattenVrExplorerItems(nested.vr_creations, "xr_sphere_1.glb");
  assert.ok(items.some((it) => it.label.includes("VR Room / Sphere") && it.active));
});
