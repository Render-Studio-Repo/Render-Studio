/** 3D hangout on /opensource — prm_rnd_office_1. Three r172. No god-files. */
import * as THREE from "three";

const CREW = [
  { id: "sam", label: "Sam", color: 0xc9a227, ask: "A working X user-token slot so tweets actually send." },
  { id: "cursor", label: "Cursor", color: 0x58a6ff, ask: "A key-index board on this wall (names/last4 only)." },
  { id: "pm", label: "PM", color: 0x8b7355, ask: "A cycle scoreboard I can stamp without DMs." },
  { id: "rnd", label: "RnD", color: 0x3fb950, ask: "This room — one falsifiable 3D hangout, model upright." },
  { id: "auditor", label: "Auditor", color: 0x8b949e, ask: "A census clipboard that rejects a 13th category_id." },
  { id: "analytics", label: "Analytics", color: 0x79c0ff, ask: "A join-key rack: log_id / prompt_id / project_id." },
  { id: "mkt", label: "Marketing", color: 0xf0883e, ask: "A draft-only X hopper that cannot invent tweet URLs." },
  { id: "comms", label: "Comms", color: 0xd2a8ff, ask: "A Sam-sized packet slot (human tap, no TOTP in chat)." },
  { id: "sales", label: "Sales", color: 0xe3b341, ask: "A priced-ICP card — real URL only." },
  { id: "clip", label: "Clip-bot", color: 0xbc8cff, ask: "A verify window so I can slate a real clip contract." },
];

export function mountOffice(host) {
  if (!host || host.dataset.ready === "1") return;
  host.dataset.ready = "1";
  const w = Math.max(320, host.clientWidth || 640);
  const h = 360;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1117);
  const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 80);
  camera.position.set(0, 7, 14);
  camera.up.set(0, 1, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(w, h);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  host.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9);
  sun.position.set(6, 12, 4);
  scene.add(sun);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(9, 48),
    new THREE.MeshStandardMaterial({ color: 0x161b22, roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.2, 0.25, 32),
    new THREE.MeshStandardMaterial({ color: 0x30363d, metalness: 0.2, roughness: 0.4 }),
  );
  table.position.y = 0.7;
  scene.add(table);

  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  const desks = [];
  const n = CREW.length;
  CREW.forEach((c, i) => {
    const ang = (i / n) * Math.PI * 2;
    const desk = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 1.4, 1.1),
      new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.35 }),
    );
    desk.position.set(Math.cos(ang) * 5.2, 0.85, Math.sin(ang) * 5.2);
    desk.userData = c;
    scene.add(desk);
    desks.push(desk);
  });

  const hint = document.createElement("p");
  hint.className = "muted small";
  hint.textContent = "Click a desk. Orbit is automatic. RnD prompt: prm_rnd_office_1.";
  host.appendChild(hint);
  const card = document.createElement("p");
  card.className = "os-office-ask";
  host.appendChild(card);

  renderer.domElement.addEventListener("click", (ev) => {
    const box = renderer.domElement.getBoundingClientRect();
    mouse.x = ((ev.clientX - box.left) / box.width) * 2 - 1;
    mouse.y = -((ev.clientY - box.top) / box.height) * 2 + 1;
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObjects(desks)[0];
    if (!hit) return;
    const c = hit.object.userData;
    card.textContent = `${c.label}: “${c.ask}”`;
  });

  let t = 0;
  function tick() {
    t += 0.004;
    camera.position.x = Math.sin(t) * 14;
    camera.position.z = Math.cos(t) * 14;
    camera.lookAt(0, 0.8, 0);
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  tick();
}

const host = document.getElementById("os-office");
if (host) mountOffice(host);
