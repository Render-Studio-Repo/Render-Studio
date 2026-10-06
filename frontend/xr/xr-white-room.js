/**
 * Cheap opaque VR backdrop when headset passthrough is off.
 * No 1024/2048 canvases, no floor grid, no PBR, no extra WebGL context.
 * Not tagged as isFloor — hideSceneChrome must not strip it every XR frame.
 */

import * as THREE from "three";

function cheapGradientSkyGeometry() {
  const geo = new THREE.SphereGeometry(24, 16, 12);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0xb7c9dc);
  const bot = new THREE.Color(0xe9e4da);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / 24 * 0.5 + 0.5, 0, 1);
    c.copy(bot).lerp(top, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

/** Unlit gradient sky — occludes Quest passthrough without a walkable room. */
export function createXrCheapVrStage() {
  const group = new THREE.Group();
  group.name = "xrCheapVrStage";
  group.userData.xrCheapVrStage = true;
  group.userData.xrWhiteRoom = true;
  group.visible = false;

  const sky = new THREE.Mesh(
    cheapGradientSkyGeometry(),
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      depthWrite: true,
      fog: false,
    }),
  );
  sky.name = "xrCheapVrSky";
  sky.frustumCulled = false;
  sky.renderOrder = -2000;
  group.add(sky);

  return group;
}

/** Alias kept for old imports — same cheap stage, not the crashy grid room. */
export function createXrWhiteRoom() {
  return createXrCheapVrStage();
}

function warehouseSkyGeometry() {
  const geo = new THREE.SphereGeometry(28, 16, 12);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const top = new THREE.Color(0x3a4654);
  const bot = new THREE.Color(0x1e293b);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i += 1) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / 28 * 0.5 + 0.5, 0, 1);
    c.copy(bot).lerp(top, t);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geo;
}

/**
 * Quest-safe warehouse backdrop — unlit boxes only (no PBR / canvas grids).
 * Heavy MeshStandard warehouse stayed in archive / xr-dormant after Quest crashes.
 */
export function createXrCheapWarehouseStage() {
  const group = new THREE.Group();
  group.name = "xrCheapWarehouseStage";
  group.userData.xrCheapWarehouseStage = true;
  group.userData.xrWarehouseRoom = true;
  group.visible = false;

  const sky = new THREE.Mesh(
    warehouseSkyGeometry(),
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.BackSide,
      depthWrite: true,
      fog: false,
    }),
  );
  sky.name = "xrWarehouseSky";
  sky.frustumCulled = false;
  sky.renderOrder = -2000;
  group.add(sky);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(28, 40),
    new THREE.MeshBasicMaterial({ color: 0x64748b, side: THREE.DoubleSide }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.02;
  floor.raycast = () => {};
  group.add(floor);

  const lane = new THREE.Mesh(
    new THREE.PlaneGeometry(2.2, 36),
    new THREE.MeshBasicMaterial({ color: 0xfbbf24, side: THREE.DoubleSide }),
  );
  lane.rotation.x = -Math.PI / 2;
  lane.position.set(0, 0.002, 0);
  lane.raycast = () => {};
  group.add(lane);

  const rackMat = new THREE.MeshBasicMaterial({ color: 0x2a2a2e });
  const shelfMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8 });
  for (const side of [-1, 1]) {
    for (let z = -10; z <= 10; z += 5) {
      const rack = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.4, 0.6), rackMat);
      rack.position.set(side * 4.2, 1.2, z);
      rack.raycast = () => {};
      group.add(rack);
      for (const y of [0.5, 1.2, 1.9]) {
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.55), shelfMat);
        shelf.position.set(side * 4.2, y, z);
        shelf.raycast = () => {};
        group.add(shelf);
      }
    }
  }

  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(10, 0.12, 0.2),
    new THREE.MeshBasicMaterial({ color: 0x475569 }),
  );
  beam.position.set(0, 3.2, 0);
  beam.raycast = () => {};
  group.add(beam);

  return group;
}

/** Lightweight, unlit robotics workshop. Shared geometry/materials keep this Quest-safe. */
export function createXrWorkshopStage() {
  const group = new THREE.Group();
  group.name = "xrWorkshopStage";
  group.userData.xrWorkshopRoom = true;
  group.userData.anchors = {
    openarmTable: [0, 0.82, -1.8],
    viser: [0, 1.38, -1.92],
    ai: [1.45, 1.28, -1.45],
    avatar: [1.8, 0, -2.15],
  };
  group.visible = false;
  const addBox = (size, pos, color) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial({ color }));
    mesh.position.set(...pos); mesh.raycast = () => {}; group.add(mesh); return mesh;
  };
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshBasicMaterial({ color: 0x303944, side: THREE.DoubleSide }));
  floor.rotation.x = -Math.PI / 2; floor.raycast = () => {}; group.add(floor);
  addBox([12, 3.2, 0.12], [0, 1.6, -5.9], 0x17212b);
  addBox([0.12, 3.2, 12], [-5.9, 1.6, 0], 0x202b36);
  addBox([0.12, 3.2, 12], [5.9, 1.6, 0], 0x202b36);
  const desks = [[0,-1.8],[3,-1.45],[-3,-1.45]];
  for (const [x,z] of desks) {
    const desk = addBox([2.35,0.10,0.85],[x,0.78,z],0xb7793f);
    desk.name = x === 0 ? "Middle workshop desk" : `Workshop desk ${x}`;
    desk.userData.generationSurface = true;
    for (const dx of [-1,1]) addBox([0.09,0.76,0.09],[x+dx,0.38,z],0x64748b);
    addBox([1.15,0.68,0.07],[x,1.3,z-0.38],0x07131f);
    addBox([1.03,0.56,0.02],[x,1.3,z-0.425],0x38bdf8);
  }
  const plate = addBox([0.64,0.004,0.64],[0,0.832,-1.8],0x466c85);
  plate.name = "Middle desk generation plate";
  plate.userData.generationSurface = true;
  plate.userData.generationPlate = true;
  for (const x of [-3.8,0,3.8]) addBox([2.7,0.05,0.08],[x,2.75,-5.7],0xfbbf24);
  return group;
}
