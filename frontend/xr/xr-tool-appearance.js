/** Small, non-interactive tool silhouettes and stroke presets. Geometry is built once. */
export const BRUSH_TOOLS = [
  { id: "draw_brush_pen", label: "Pen", icon: "draw", color: 0x06b6d4 },
  { id: "draw_brush_brush", label: "Brush", icon: "draw", color: 0xa855f7 },
  { id: "draw_brush_highlighter", label: "Highlight", icon: "draw", color: 0xf59e0b },
];
export const SHAPE_TOOLS = [
  { id: "create_box", label: "Cube", icon: "box", color: 0xe85d4c },
  { id: "create_cylinder", label: "Cylinder", icon: "cyl", color: 0x3b82f6 },
  { id: "create_sphere", label: "Sphere", icon: "sphere", color: 0xf59e0b },
  { id: "create_cone", label: "Cone", icon: "cone", color: 0x22c55e },
  { id: "create_torus", label: "Ring", icon: "torus", color: 0xa855f7 },
  { id: "create_wall", label: "Wall", icon: "wall", color: 0xf8fafc },
  { id: "create_floor", label: "Floor", icon: "floor", color: 0x94a3b8 },
];
export function brushStyle(kind = "pen") {
  if (kind === "highlighter") return { kind, width: 1.8, opacity: 0.35, flatness: 0.25 };
  if (kind === "brush") return { kind, width: 1.35, opacity: 1, flatness: 0.6 };
  return { kind: "pen", width: 1, opacity: 1, flatness: 1 };
}
export function styleStrokeMaterial(material, kind) {
  const { opacity } = brushStyle(kind);
  material.opacity = opacity;
  material.transparent = opacity < 1;
  material.depthWrite = opacity === 1;
  material.needsUpdate = true;
}
export function strokeCrossSection(kind, index, count) {
  const style = brushStyle(kind);
  // Brush has a soft start/end taper; pen and marker keep a constant width.
  const taper = kind === "brush" ? Math.min(1, .45 + Math.min(index, count - 1 - index) * .18) : 1;
  return { width: style.width * taper, depth: style.width * style.flatness * taper };
}
export function createXrToolTip(THREE) {
  const group = new THREE.Group();
  group.name = "xrActiveToolTip";
  group.renderOrder = 45100;
  group.visible = false;
  group.userData.xrIgnoreBounds = true;
  const variants = {};
  const colored = [];
  const add = (parent, geometry, color, x, y, z, ink = false) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, toneMapped: false, depthTest: false, depthWrite: false, transparent: true }));
    mesh.position.set(x, y, z);
    mesh.renderOrder = 45100;
    mesh.raycast = () => {};
    mesh.userData.xrRaycast = false;
    mesh.userData.xrIgnoreBounds = true;
    mesh.frustumCulled = false;
    parent.add(mesh);
    if (ink) colored.push(mesh);
    return mesh;
  };
  for (const kind of ["pen", "brush", "highlighter", "eraser"]) {
    const g = new THREE.Group();
    variants[kind] = g; group.add(g);
    const shaft = add(g, new THREE.CylinderGeometry(.0025, .003, .028, 8), 0xd5dce7, 0, 0, .009);
    shaft.rotation.x = -Math.PI / 2;
    if (kind === "highlighter" || kind === "eraser") {
      add(g, new THREE.BoxGeometry(.009, .0035, .008), kind === "eraser" ? 0xf8fafc : 0xf59e0b, 0, 0, -.014, kind !== "eraser");
    } else {
      const nib = add(g, new THREE.ConeGeometry(kind === "brush" ? .005 : .003, .012, 10), 0x06b6d4, 0, 0, -.012, true);
      nib.rotation.x = -Math.PI / 2; // Actual working point is 18 mm along target ray.
    }
  }
  const geos = {
    box: new THREE.BoxGeometry(.012, .012, .012),
    cylinder: new THREE.CylinderGeometry(.006, .006, .014, 16),
    sphere: new THREE.SphereGeometry(.007, 16, 10),
    cone: new THREE.ConeGeometry(.007, .014, 16),
    torus: new THREE.TorusGeometry(.006, .002, 8, 20),
    wall: new THREE.BoxGeometry(.017, .013, .004),
    floor: new THREE.BoxGeometry(.017, .003, .017),
  };
  for (const [kind, geo] of Object.entries(geos)) {
    const g = new THREE.Group(); variants[kind] = g; group.add(g);
    const mesh = add(g, geo, 0x06b6d4, 0, 0, -.018, true);
    mesh.rotation.set(.18, .35, 0);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0xe8f5ff, transparent: true, opacity: .7, depthTest: false, depthWrite: false }));
    edges.renderOrder = 45101;
    edges.raycast = () => {}; edges.userData.xrRaycast = false;
    mesh.add(edges);
  }
  let signature = "";
  function update({ tool, brush = "pen", color = 0x06b6d4, size = "draw_size_m", eraser = false }) {
    const kind = tool === "draw" ? (eraser ? "eraser" : brushStyle(brush).kind) : String(tool).replace(/^create_/, "");
    const key = `${kind}|${color}|${size}`;
    if (key === signature) return;
    signature = key;
    for (const [id, node] of Object.entries(variants)) node.visible = id === kind;
    for (const mesh of colored) mesh.material.color.setHex(color);
    const scale = size === "draw_size_s" ? .75 : size === "draw_size_l" ? 1.3 : 1;
    for (const id of ["pen", "brush", "highlighter"]) variants[id].scale.set(scale, scale, 1);
    group.userData.toolKind = kind;
  }
  return { group, update };
}
