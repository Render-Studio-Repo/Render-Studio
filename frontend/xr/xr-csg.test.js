import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptiveVoxelAxes,
  boxTriangles,
  cellCenterOccupancyCount,
  combineOpFromMode,
  csgTriangles,
  csgTwoSolids,
  CSG_BSP_MAX_TRIS,
  CSG_BSP_SAFE_TRIS,
  occupancyCount,
  padBounds,
  shouldPreferBsp,
  simplifyTriangles,
  triangleBounds,
  sliceTrianglesByPlane,
  triangleMeshVolume,
  unionBounds,
  voxelCsg,
  voxelizeTriangles,
} from "./xr-csg.js";
import { shouldRunCsgNow } from "./xr-hot-path.js?v=roboticsworkspace3";
import { studioAccessActionApi } from "./xr-collab-policy.js";

const here = dirname(fileURLToPath(import.meta.url));

test("combine modes map to real boolean ops", () => {
  assert.equal(combineOpFromMode("new"), "");
  assert.equal(combineOpFromMode("add"), "union");
  assert.equal(combineOpFromMode("cut"), "subtract");
  assert.equal(combineOpFromMode("intersect"), "intersect");
});

test("union subtract intersect of two overlapping boxes change volume", () => {
  const a = boxTriangles(0, 0, 0, 1, 1, 1);
  const b = boxTriangles(0.5, 0, 0, 1, 1, 1);
  const volA = triangleMeshVolume(a);
  assert.ok(Math.abs(volA - 1) < 0.08, `unit box volume ${volA}`);

  const union = csgTriangles(a, b, "union");
  const cut = csgTriangles(a, b, "subtract");
  const hit = csgTriangles(a, b, "intersect");
  const vu = triangleMeshVolume(union);
  const vc = triangleMeshVolume(cut);
  const vi = triangleMeshVolume(hit);

  assert.ok(union.length > 8, "union keeps a closed mesh");
  assert.ok(vu > volA + 0.2, `union volume ${vu} should grow`);
  assert.ok(vc < volA - 0.15, `cut volume ${vc} should shrink`);
  assert.ok(vi > 0.2 && vi < 0.8, `intersect volume ${vi} is the overlap`);
  assert.ok(vu > vc && vu > vi);
});

test("csgTwoSolids refuses empty cut and off mode", () => {
  const off = csgTwoSolids(
    { kind: "box", worldPosition: { x: 0, y: 0, z: 0 }, sizeM: { x: 0.2, y: 0.2, z: 0.2 } },
    { kind: "box", worldPosition: { x: 0.05, y: 0, z: 0 }, sizeM: { x: 0.2, y: 0.2, z: 0.2 } },
    "new",
  );
  assert.equal(off.ok, false);
  const far = csgTwoSolids(
    { kind: "box", worldPosition: { x: 0, y: 0, z: 0 }, sizeM: { x: 0.1, y: 0.1, z: 0.1 } },
    { kind: "box", worldPosition: { x: 4, y: 0, z: 0 }, sizeM: { x: 0.1, y: 0.1, z: 0.1 } },
    "intersect",
  );
  assert.equal(far.ok, false);
  const joined = csgTwoSolids(
    { kind: "box", worldPosition: { x: 0, y: 0, z: 0 }, sizeM: { x: 0.2, y: 0.2, z: 0.2 } },
    { kind: "box", worldPosition: { x: 0.05, y: 0, z: 0 }, sizeM: { x: 0.2, y: 0.2, z: 0.2 } },
    "add",
  );
  assert.equal(joined.ok, true);
  assert.equal(joined.op, "union");
  assert.ok(joined.volume > 0.004);
});

test("sliceTrianglesByPlane keeps one half of a unit box and caps the cut", () => {
  const box = boxTriangles(0, 0, 0, 1, 1, 1);
  const vol0 = triangleMeshVolume(box);
  const sliced = sliceTrianglesByPlane(box, { x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  const vol = triangleMeshVolume(sliced);
  assert.ok(sliced.length > 8, "sliced mesh stays closed");
  assert.ok(vol < vol0 - 0.15, `slice volume ${vol} should drop from ${vol0}`);
  assert.ok(vol > 0.15, `slice volume ${vol} keeps a solid half`);
  const empty = sliceTrianglesByPlane(box, { x: 4, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  assert.equal(empty.length, 0);
});

function denseRevolveLike(seg = 48) {
  const tris = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    tris.push(...boxTriangles(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35, 0.08, 0.18, 0.08));
  }
  return tris;
}

function thinLoftWall(w = 1.2, h = 0.6, t = 0.002) {
  return boxTriangles(0, h * 0.5, 0, w, h, t);
}

function tessellatedThinLoft(w = 1.2, h = 0.6, t = 0.002, nx = 6, ny = 4) {
  const tris = [];
  const x0 = -w * 0.5;
  const z0 = -t * 0.5;
  for (let iy = 0; iy < ny; iy += 1) {
    for (let ix = 0; ix < nx; ix += 1) {
      const x1 = x0 + (ix / nx) * w;
      const x2 = x0 + ((ix + 1) / nx) * w;
      const y1 = (iy / ny) * h;
      const y2 = ((iy + 1) / ny) * h;
      const z1 = z0;
      const z2 = z0 + t;
      const a = [x1, y1, z1];
      const b = [x2, y1, z1];
      const c = [x2, y2, z1];
      const d = [x1, y2, z1];
      const e = [x1, y1, z2];
      const f = [x2, y1, z2];
      const g = [x2, y2, z2];
      const hh = [x1, y2, z2];
      tris.push([b, a, d], [b, d, c]);
      tris.push([e, f, g], [e, g, hh]);
    }
  }
  for (let ix = 0; ix < nx; ix += 1) {
    const x1 = x0 + (ix / nx) * w;
    const x2 = x0 + ((ix + 1) / nx) * w;
    tris.push(
      [[x1, 0, z0], [x2, 0, z0], [x2, 0, z0 + t]],
      [[x1, 0, z0], [x2, 0, z0 + t], [x1, 0, z0 + t]],
      [[x1, h, z0], [x1, h, z0 + t], [x2, h, z0 + t]],
      [[x1, h, z0], [x2, h, z0 + t], [x2, h, z0]],
    );
  }
  return tris;
}

test("thin 2mm loft over a large extent still booleans (adaptive voxels + BSP)", () => {
  const loft = tessellatedThinLoft();
  const cube = boxTriangles(0, 0.2, 0, 0.2, 0.2, 0.2);
  const bounds = padBounds(unionBounds(triangleBounds(loft), triangleBounds(cube)), 0.02);
  const naive = cellCenterOccupancyCount(loft, bounds, 20);
  assert.equal(naive, 0, `cubic 20³ cell centers should miss a 2mm wall (got ${naive})`);

  const adaptive = voxelizeTriangles(loft, bounds, "adaptive");
  assert.ok(occupancyCount(adaptive) > 0, "adaptive + expand + dilate occupies thin loft");
  const axes = adaptiveVoxelAxes(triangleBounds(loft));
  assert.ok(axes.nz >= 4, `thin axis keeps cells ${JSON.stringify(axes)}`);

  assert.equal(shouldPreferBsp(loft.length, cube.length), true);
  const union = csgTriangles(loft, cube, "union");
  const cut = csgTriangles(loft, cube, "subtract");
  const hit = csgTriangles(loft, cube, "intersect");
  assert.ok(union.length > 8 && triangleMeshVolume(union) > 1e-6, "thin union non-empty");
  assert.ok(cut.length > 8 && triangleMeshVolume(cut) > 1e-6, "thin cut non-empty");
  assert.ok(hit.length > 4 && triangleMeshVolume(hit) > 1e-8, "thin intersect non-empty");

  const voxelJoin = voxelCsg(loft, cube, "union");
  const voxelCut = voxelCsg(loft, cube, "subtract");
  const voxelHit = voxelCsg(loft, cube, "intersect");
  assert.ok(triangleMeshVolume(voxelJoin) > 1e-6 && voxelJoin.length > 8);
  assert.ok(triangleMeshVolume(voxelCut) > 1e-6 && voxelCut.length > 8);
  assert.ok(voxelHit.length > 4, "thin voxel intersect kept a shell");

  const compact = thinLoftWall();
  const forced = csgTriangles(compact, cube, "union", { forceVoxel: true });
  assert.ok(forced.length > 8 && triangleMeshVolume(forced) > 1e-6);

  assert.equal(shouldRunCsgNow({ drawing: true }), false);
  assert.equal(shouldRunCsgNow({ grabbing: true }), false);
  assert.equal(shouldRunCsgNow({ combining: true }), false);
});

test("medium meshes prefer simplify+BSP over voxel", () => {
  assert.equal(shouldPreferBsp(90, 90), true);
  assert.equal(shouldPreferBsp(CSG_BSP_SAFE_TRIS, CSG_BSP_SAFE_TRIS), true);
  assert.equal(shouldPreferBsp(CSG_BSP_SAFE_TRIS + 20, CSG_BSP_SAFE_TRIS + 20), false);
  const a = denseRevolveLike(8);
  const b = boxTriangles(0, 0, 0, 0.4, 0.2, 0.4);
  assert.ok(a.length > 80 && a.length < CSG_BSP_SAFE_TRIS * 2);
  const joined = csgTriangles(a, b, "union");
  assert.ok(joined.length > 12 && triangleMeshVolume(joined) > 0.02);
});

test("dense revolve-like meshes simplify and still boolean without empty results", () => {
  const revolve = denseRevolveLike(48);
  assert.ok(revolve.length > CSG_BSP_MAX_TRIS * 2, `dense input ${revolve.length}`);
  const simple = simplifyTriangles(revolve, CSG_BSP_MAX_TRIS);
  assert.ok(simple.length > 8);
  assert.ok(simple.length < revolve.length, `simplified ${simple.length} from ${revolve.length}`);
  const core = boxTriangles(0, 0, 0, 0.4, 0.2, 0.4);
  const joined = csgTriangles(revolve, core, "union");
  const cut = csgTriangles(revolve, core, "subtract");
  assert.ok(joined.length > 12, "dense union produced a mesh");
  assert.ok(triangleMeshVolume(joined) > 0.02);
  assert.ok(cut.length > 8, "dense cut produced a mesh");
  const voxelJoin = voxelCsg(revolve, core, "union");
  assert.ok(triangleMeshVolume(voxelJoin) > 0.02);
});

test("Quest Combine is wired to applyCombine, not a mode-only no-op", () => {
  const view = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(view.includes("applyCombine"));
  const build = readFileSync(join(here, "xr-build-tools.js"), "utf8");
  assert.ok(build.includes("csgTriangles"));
  assert.ok(build.includes("combineLastTwo"));
  assert.ok(build.includes("scheduleCombine"));
  assert.ok(view.includes("onPersistXrSolid"));
  assert.ok(view.includes("persistXrCombinedMesh"));
});

test("Studio Access uses the same Share APIs as the laptop", () => {
  assert.deepEqual(
    studioAccessActionApi({ type: "move_workspace", team_id: "t2" }, "p1"),
    { method: "PATCH", path: "/api/projects/p1/workspace", body: { team_id: "t2" } },
  );
  assert.deepEqual(
    studioAccessActionApi({ type: "unshare", user_id: "u2" }, "p1"),
    { method: "DELETE", path: "/api/projects/p1/shares/u2" },
  );
  const invite = studioAccessActionApi({ type: "share_invite", email: "a@b.com" }, "p1");
  assert.equal(invite.method, "POST");
  assert.equal(invite.path, "/api/projects/p1/shares");
  assert.equal(invite.opensLaptopShare, true);
});
