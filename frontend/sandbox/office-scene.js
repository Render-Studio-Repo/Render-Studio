import { OFFICE_AGENTS } from "./office-agents.js?v=office2&astraoffice=20260917-1";

/** One reusable office model; its caller owns the renderer, camera and inputs. */
export function createOfficeScene(THREE, { scene, agents = OFFICE_AGENTS } = {}) {
  const root = new THREE.Group(); root.name = "sandbox-office"; scene.add(root);
  const desks = [], screens = [], textures = [];
  const materials = new Map();
  const material = color => {
    if (!materials.has(color)) materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: .68 }));
    return materials.get(color);
  };
  function box(parent, w, h, d, x, y, z, color) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material(color));
    mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  }
  function label(text, sub, color = "#7fe0c3", width = 1.18) {
    const canvas = document.createElement("canvas"); canvas.width = 768; canvas.height = 256;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#102522"; ctx.fillRect(0, 0, 768, 256);
    ctx.fillStyle = color; ctx.fillRect(24, 24, 8, 208);
    ctx.font = "bold 66px sans-serif"; ctx.fillText(text, 62, 115, 670);
    ctx.fillStyle = "#c5d4cf"; ctx.font = "32px sans-serif"; ctx.fillText(sub, 62, 178, 670);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; textures.push(texture);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width / 3), new THREE.MeshBasicMaterial({ map: texture }));
    return mesh;
  }
  // Open-front architectural room, with a clear aisle from the VR origin.
  box(root, 12, .12, 10, 0, -.09, -2.5, 0xc9d2cd);
  for (let x = -6; x <= 6; x++) box(root, .012, .008, 10, x, -.024, -2.5, 0xa8b9b0);
  for (let z = -7; z <= 2; z++) box(root, 12, .008, .012, 0, -.024, z, 0xa8b9b0);
  box(root, 12, 3.3, .15, 0, 1.6, -7.5, 0xe0e6e0);
  box(root, .12, 1.1, 10, -6, .5, -2.5, 0x829e98);
  box(root, .12, 1.1, 10, 6, .5, -2.5, 0x829e98);
  const title = label("SANDBOX OFFICE", "ASTRA + THE TEAM", "#7fe0c3", 4.4);
  title.position.set(0, 2.1, -7.4); root.add(title);
  for (const x of [-4.7, 4.7]) {
    box(root, 1.8, 1.5, .08, x, 2, -7.37, 0x90bdc8);
    for (const dx of [-.88, 0, .88]) box(root, .035, 1.5, .08, x + dx, 2, -7.3, 0x526e72);
    box(root, 1.8, .035, .08, x, 2, -7.3, 0x526e72);
  }
  box(root, 2.4, .1, 1.2, 0, .73, -3.4, 0xe7ece6);
  for (const x of [-.9, .9]) for (const z of [-3.8, -3]) box(root, .08, .7, .08, x, .32, z, 0x38514e);
  box(root, .85, .025, .55, 0, .795, -3.4, 0x35796a);
  // Small task board and storage keep the room legible without decorative clutter.
  const board = label("PROJECT BOARD", "References / review / next steps", "#e5c875", 2.3);
  board.position.set(-3.8, 1.9, -7.35); root.add(board);
  agents.forEach((agent, i) => {
    const station = new THREE.Group();
    const pos = i === 0 ? [0, -5.7] : [i % 2 ? -3.4 : 3.4, -6.2 + Math.floor((i - 1) / 2) * 1.65];
    station.position.set(pos[0], 0, pos[1]);
    station.userData = { ...agent, label: agent.name, home: station.position.clone() };
    root.add(station); desks.push(station);
    if (agent.id === "vibe-marketing") {
      box(station, 2.1, .08, 1.05, 0, .78, .15, 0x4a2030);
      box(station, .9, .02, .4, -.4, .88, .28, 0x2a1018);
    }
    const edge = box(station, 1.72, .06, .78, 0, .78, 0, agent.color);
    box(station, 1.68, .06, .74, 0, .82, 0, 0xe4e8e2);
    for (const x of [-.69, .69]) box(station, .07, .78, .6, x, .36, 0, 0x455e59);
    box(station, .65, .43, .07, 0, 1.12, -.18, 0x263b38);
    const sub = agent.id === "vibe-marketing"
      ? "DESK · shoot / music · walk up"
      : agent.id === "printer-bot"
        ? "Printer monitor · quiet unless jammed"
        : `${agent.role} · status seat`;
    const screen = label(agent.name, sub, `#${agent.color.toString(16).padStart(6, "0")}`, 1.26);
    screen.position.set(0, 1.46, -.1); screen.userData.agentId = agent.id; station.add(screen); screens.push(screen);
    box(station, .42, .02, .18, -.05, .87, .12, 0x61736e);
    box(station, .52, .08, .5, 0, .42, -.78, 0x465d59);
    box(station, .52, .55, .08, 0, .72, -1.01, 0x465d59);
    box(station, .08, .4, .08, 0, .18, -.78, 0x263b38);
    const avatar = new THREE.Group(); avatar.position.set(.56, 1.03, -.22); station.add(avatar);
    box(avatar, .19, .23, .15, 0, 0, 0, agent.color);
    box(avatar, .24, .17, .18, 0, .22, 0, 0xe2ece7);
    box(avatar, .18, .075, .015, 0, .23, .1, 0x183c38);
    for (const x of [-.045, .045]) box(avatar, .024, .026, .016, x, .23, .112, agent.color);
    station.userData.edge = edge; station.userData.avatar = avatar;
    station.traverse(mesh => { if (mesh.isMesh) mesh.userData.agentId = agent.id; });
  });
  let active = "astra";
  function select(id) { active = id; desks.forEach(d => {
    const on = d.userData.id === id;
    d.userData.edge.scale.set(on ? 1.06 : 1, on ? 2 : 1, on ? 1.06 : 1);
    d.userData.avatar.scale.setScalar(on ? 1.15 : 1);
  }); }
  select(active);
  return { root, desks, screens, select,
    update(time) { desks.forEach((d, i) => { d.userData.avatar.rotation.y = Math.sin(time * .7 + i) * .08; }); },
    dispose() { root.traverse(m => { m.geometry?.dispose(); if (m.material?.map) m.material.dispose(); }); textures.forEach(t => t.dispose()); materials.forEach(m => m.dispose()); root.removeFromParent(); },
  };
}
