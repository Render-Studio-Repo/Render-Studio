/** Robotic Simulator — catalog arms, URDF upload, work-cell environments, joint motion. */

import * as THREE from "three";

const ENV_KEY = "render3d:robotSimEnv:v1";

const CATALOG = [
  {
    id: "industrial-6axis",
    name: "Industrial 6-axis arm",
    tagline: "Full URDF + SRDF demo cell — seed into your workspace and simulate motion.",
    badge: "Demo",
    action: "seed-demo",
  },
  {
    id: "marketplace-arm",
    name: "Sam's Robot Arm",
    tagline: "Public robotics listing with GLB / STEP / URDF for remixing.",
    badge: "Store",
    action: "store",
    href: "/model-store.html?q=robot%20arm",
  },
  {
    id: "gripper-heads",
    name: "Gripper toolheads",
    tagline: "Swappable end-effectors for pick-and-place and cooking-tool experiments.",
    badge: "Store",
    action: "store",
    href: "/model-store.html?q=gripper",
  },
  {
    id: "upload-own",
    name: "Upload your robot",
    tagline: "Drop a URDF (and optional SRDF + STL/GLB meshes) into this project.",
    badge: "Yours",
    action: "upload",
  },
];

const ENVIRONMENTS = [
  {
    id: "empty",
    label: "Empty viewport",
    hint: "Robot only — no work-cell props.",
  },
  {
    id: "shop-floor",
    label: "Shop floor",
    hint: "Concrete slab with aisle tape and a side workbench.",
  },
  {
    id: "lab-bench",
    label: "Lab bench",
    hint: "Sealed epoxy floor and a cobot-height bench.",
  },
  {
    id: "warehouse",
    label: "Warehouse cell",
    hint: "Dock floor with pallet and rack bay.",
  },
];

function readEnv() {
  try {
    const id = localStorage.getItem(ENV_KEY) || "empty";
    return ENVIRONMENTS.some((e) => e.id === id) ? id : "empty";
  } catch {
    return "empty";
  }
}

function writeEnv(id) {
  try {
    localStorage.setItem(ENV_KEY, id);
  } catch {
    /* ignore */
  }
}

function mat(color, opts = {}) {
  if (opts.basic) {
    return new THREE.MeshBasicMaterial({
      color,
      map: opts.map || null,
      transparent: !!opts.transparent,
      opacity: opts.opacity ?? 1,
      side: opts.side ?? THREE.FrontSide,
    });
  }
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.72,
    metalness: opts.metalness ?? 0.08,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    map: opts.map || null,
    side: opts.side ?? THREE.FrontSide,
  });
}

function box(w, d, h, color, opts = {}) {
  // Z-up: X=width, Y=depth, Z=height
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), mat(color, opts));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Concrete / epoxy floor texture — reads as a real slab, not a floating disk. */
function makeFloorTexture({ kind = "shop-floor", sizePx = 1024 } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = sizePx;
  canvas.height = sizePx;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const base = kind === "lab-bench" ? "#1e2430" : kind === "warehouse" ? "#2a2722" : "#2f343c";
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, sizePx, sizePx);

  for (let i = 0; i < 2800; i += 1) {
    const x = Math.random() * sizePx;
    const y = Math.random() * sizePx;
    const r = 0.6 + Math.random() * 3.2;
    const a = 0.015 + Math.random() * 0.05;
    ctx.fillStyle = Math.random() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.2})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (let i = 0; i < 18; i += 1) {
    const x = Math.random() * sizePx;
    const y = Math.random() * sizePx;
    const r = 40 + Math.random() * 120;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.03 + Math.random() * 0.04})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  ctx.strokeStyle = "rgba(0,0,0,0.22)";
  ctx.lineWidth = 2;
  for (let i = 1; i < 4; i += 1) {
    const p = (i / 4) * sizePx;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, sizePx); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(sizePx, p); ctx.stroke();
  }

  if (kind === "shop-floor") {
    ctx.fillStyle = "rgba(240, 180, 41, 0.9)";
    const tape = sizePx * 0.03;
    const inset = sizePx * 0.12;
    ctx.fillRect(inset, sizePx * 0.2 - tape / 2, sizePx - inset * 2, tape);
    ctx.fillRect(inset, sizePx * 0.8 - tape / 2, sizePx - inset * 2, tape);
    ctx.fillStyle = "rgba(240, 180, 41, 0.55)";
    const dashW = sizePx * 0.045;
    const gap = sizePx * 0.028;
    let x = inset;
    const y = sizePx * 0.5 - tape * 0.35;
    while (x < sizePx - inset) {
      ctx.fillRect(x, y, dashW, tape * 0.7);
      x += dashW + gap;
    }
  }

  if (kind === "lab-bench") {
    ctx.strokeStyle = "rgba(88, 166, 255, 0.35)";
    ctx.lineWidth = 5;
    ctx.strokeRect(sizePx * 0.18, sizePx * 0.18, sizePx * 0.64, sizePx * 0.64);
    ctx.fillStyle = "rgba(88, 166, 255, 0.06)";
    ctx.fillRect(sizePx * 0.18, sizePx * 0.18, sizePx * 0.64, sizePx * 0.64);
  }

  if (kind === "warehouse") {
    ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
    for (let i = 0; i < 7; i += 1) {
      const x = sizePx * 0.2 + i * sizePx * 0.09;
      ctx.beginPath();
      ctx.moveTo(x, sizePx * 0.72);
      ctx.lineTo(x + sizePx * 0.04, sizePx * 0.78);
      ctx.lineTo(x, sizePx * 0.84);
      ctx.closePath();
      ctx.fill();
    }
  }

  const vig = ctx.createRadialGradient(sizePx / 2, sizePx / 2, sizePx * 0.22, sizePx / 2, sizePx / 2, sizePx * 0.74);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(1, "rgba(0,0,0,0.4)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, sizePx, sizePx);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function buildFloorSlab(kind) {
  const size = kind === "lab-bench" ? 5200 : 7200; // mm
  const map = makeFloorTexture({ kind });
  // PlaneGeometry is XY with +Z normal — correct for Render3D's Z-up world.
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size, 1, 1),
    mat(0xffffff, { map, basic: true }),
  );
  mesh.position.z = -0.5;
  mesh.receiveShadow = true;
  mesh.name = "robotSimFloor";

  const skirt = box(size, size, 28, kind === "warehouse" ? 0x1c1a17 : 0x1a1e24, { basic: true });
  skirt.position.z = -15;
  skirt.receiveShadow = true;
  skirt.castShadow = false;

  const group = new THREE.Group();
  group.add(mesh);
  group.add(skirt);
  return group;
}

function buildEnvironment(kind) {
  const root = new THREE.Group();
  root.name = "robotSimEnvironment";
  root.userData.isRobotSimEnvironment = true;

  if (kind === "empty") return root;

  root.add(buildFloorSlab(kind));

  if (kind === "shop-floor") {
    const benchH = 720;
    const bench = box(1100, 600, benchH, 0x2b313a, { roughness: 0.78 });
    bench.position.set(2100, 200, benchH / 2);
    root.add(bench);
    const top = box(1140, 640, 22, 0x4a5562, { roughness: 0.55, metalness: 0.18 });
    top.position.set(2100, 200, benchH + 11);
    root.add(top);
    [[1650, -40], [2550, -40], [1650, 440], [2550, 440]].forEach(([x, y]) => {
      const p = box(120, 120, 18, 0x1f242b);
      p.position.set(x, y, 9);
      root.add(p);
    });
  }

  if (kind === "lab-bench") {
    const h = 760;
    const table = box(1600, 800, 36, 0xc9d1d9, { roughness: 0.35, metalness: 0.22 });
    table.position.set(0, 400, h + 18);
    root.add(table);
    [[-700, 120], [700, 120], [-700, 680], [700, 680]].forEach(([x, y]) => {
      const leg = box(48, 48, h, 0x6e7681, { metalness: 0.35, roughness: 0.4 });
      leg.position.set(x, y, h / 2);
      root.add(leg);
    });
    const plate = box(480, 360, 10, 0x58a6ff, { metalness: 0.45, roughness: 0.35 });
    plate.position.set(-200, 380, h + 41);
    root.add(plate);
  }

  if (kind === "warehouse") {
    const pallet = box(1100, 900, 100, 0xa67c52, { roughness: 0.9 });
    pallet.position.set(1800, 300, 50);
    root.add(pallet);
    for (let i = 0; i < 5; i += 1) {
      const s = box(1100, 80, 18, 0x8b6914);
      s.position.set(1800, -50 + i * 175, 110);
      root.add(s);
    }
    const crate = box(480, 400, 360, 0x8d6e4c, { roughness: 0.85 });
    crate.position.set(1800, 300, 290);
    root.add(crate);
    for (let i = 0; i < 3; i += 1) {
      const post = box(70, 70, 1800, 0x3d4450, { metalness: 0.4, roughness: 0.45 });
      post.position.set(-2000, -900 + i * 70, 900);
      root.add(post);
      const shelf = box(1200, 420, 28, 0x6e7681, { metalness: 0.25, roughness: 0.5 });
      shelf.position.set(-1600, -860, 400 + i * 480);
      root.add(shelf);
    }
  }

  return root;
}

export function createRoboticSimulator(options = {}) {
  const {
    getProjectId,
    authHeaders,
    getScene,
    onStatus,
    seedDemoArm,
    openProject,
    refreshArtifacts,
    loadRobotScene,
    openPlayground,
    togglePlay,
    isPlaying,
    getRobotState,
    uploadFiles,
  } = options;

  let envId = readEnv();
  let envRoot = null;
  let bound = false;

  function els() {
    return {
      panel: document.getElementById("robotics-panel"),
      catalog: document.getElementById("robotics-catalog-list"),
      artifacts: document.getElementById("robotics-artifact-list"),
      envChoices: document.getElementById("robotics-env-choices"),
      status: document.getElementById("robotics-sim-status"),
      playBtn: document.getElementById("btn-robotics-play"),
      loadBtn: document.getElementById("btn-robotics-load-scene"),
      playgroundBtn: document.getElementById("btn-robotics-playground"),
      uploadBtn: document.getElementById("btn-robotics-upload"),
      uploadInput: document.getElementById("robotics-upload-input"),
      refreshBtn: document.getElementById("btn-robotics-refresh"),
    };
  }

  function setPanelStatus(msg) {
    const { status } = els();
    if (status) status.textContent = msg || "";
  }

  function clearEnvironment() {
    const scene = getScene?.();
    if (envRoot) {
      scene?.remove(envRoot);
      envRoot.traverse?.((obj) => {
        if (obj.geometry) obj.geometry.dispose?.();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
          else obj.material.dispose?.();
        }
      });
      envRoot = null;
    }
    // Sweep any leftover work-cell props from earlier bugs / hot reloads.
    if (scene) {
      const leftovers = [];
      scene.traverse((obj) => {
        if (obj?.userData?.isRobotSimEnvironment) leftovers.push(obj);
      });
      leftovers.forEach((obj) => {
        obj.parent?.remove(obj);
        obj.traverse?.((child) => {
          if (child.geometry) child.geometry.dispose?.();
          if (child.material) {
            if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose?.());
            else child.material.dispose?.();
          }
        });
      });
    }
  }

  function applyEnvironment(nextId = envId) {
    envId = ENVIRONMENTS.some((e) => e.id === nextId) ? nextId : "empty";
    writeEnv(envId);
    clearEnvironment();
    const scene = getScene?.();
    if (!scene || envId === "empty") {
      syncEnvUi();
      return;
    }
    envRoot = buildEnvironment(envId);
    scene.add(envRoot);
    syncEnvUi();
  }

  function syncEnvUi() {
    const { envChoices } = els();
    if (!envChoices) return;
    envChoices.querySelectorAll("[data-robot-env]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.robotEnv === envId);
    });
  }

  function renderCatalog() {
    const { catalog } = els();
    if (!catalog) return;
    catalog.innerHTML = CATALOG.map(
      (item) => `
      <article class="robotics-catalog-card" data-robot-catalog="${item.id}">
        <div class="robotics-catalog-card-head">
          <strong>${item.name}</strong>
          <span class="robotics-catalog-badge">${item.badge}</span>
        </div>
        <p>${item.tagline}</p>
        <button type="button" class="btn accent btn-compact" data-robot-catalog-action="${item.id}">
          ${item.action === "seed-demo" ? "Load into project" : item.action === "store" ? "Open in store" : "Choose files"}
        </button>
      </article>`,
    ).join("");
  }

  function renderEnvironments() {
    const { envChoices } = els();
    if (!envChoices) return;
    envChoices.innerHTML = ENVIRONMENTS.map(
      (env) => `
      <button type="button" class="robotics-env-btn${env.id === envId ? " active" : ""}" data-robot-env="${env.id}" title="${env.hint}">
        <strong>${env.label}</strong>
        <span>${env.hint}</span>
      </button>`,
    ).join("");
  }

  function renderArtifacts(data) {
    const { artifacts } = els();
    if (!artifacts) return;
    const list = Array.isArray(data?.artifacts) ? data.artifacts : [];
    const joints = Array.isArray(data?.joints) ? data.joints.filter((j) => String(j.type || "").toLowerCase() !== "fixed") : [];
    if (!list.length) {
      artifacts.innerHTML = `<div class="object-iteration-empty">No URDF/SRDF in this project yet. Pick a catalog arm or upload yours.</div>`;
      return;
    }
    artifacts.innerHTML = `
      <div class="robotics-artifact-summary">${list.length} robot file(s) · ${joints.length} movable joint(s)</div>
      <ul class="robotics-artifact-files">
        ${list.map((name) => `<li><code>${String(name)}</code></li>`).join("")}
      </ul>`;
  }

  function syncPlayButton() {
    const { playBtn } = els();
    if (!playBtn) return;
    const playing = !!isPlaying?.();
    playBtn.textContent = playing ? "Stop motion" : "Play work cycle";
    playBtn.classList.toggle("active", playing);
    playBtn.setAttribute("aria-pressed", playing ? "true" : "false");
  }

  async function refreshPanel({ quiet = false } = {}) {
    const data = await refreshArtifacts?.({ quiet: true });
    renderArtifacts(data || getRobotState?.()?.artifacts || null);
    const state = getRobotState?.();
    if (state?.loaded) {
      setPanelStatus(`Robot loaded · ${state.urdfFile || "URDF"}`);
    } else if (!quiet) {
      setPanelStatus("Ready — load a catalog arm or your URDF to simulate.");
    }
    syncPlayButton();
    return data;
  }

  async function handleCatalogAction(id) {
    const item = CATALOG.find((c) => c.id === id);
    if (!item) return;
    if (item.action === "store") {
      window.open(item.href || "/model-store.html", "_blank", "noopener");
      onStatus?.(true, "Opened Model Store robotics listings.");
      return;
    }
    if (item.action === "upload") {
      els().uploadInput?.click();
      return;
    }
    if (item.action === "seed-demo") {
      if (!getProjectId?.() && !seedDemoArm) {
        onStatus?.(false, "Sign in and open a workspace to load the demo arm.");
        return;
      }
      setPanelStatus("Seeding industrial robot arm project…");
      onStatus?.(true, "Loading industrial 6-axis demo…");
      try {
        const result = await seedDemoArm?.();
        const pid = result?.project_id;
        if (pid && openProject) await openProject(pid);
        await refreshPanel({ quiet: true });
        await loadRobotScene?.({ force: true });
        openPlayground?.({ forceRigging: false });
        setPanelStatus("Demo arm ready — play a work cycle or open the joint playground.");
        onStatus?.(true, "Industrial robot arm loaded into the simulator.");
      } catch (err) {
        setPanelStatus(err?.message || "Could not load demo arm.");
        onStatus?.(false, err?.message || "Could not load demo arm.");
      }
    }
  }

  async function handleUpload(fileList) {
    const pid = getProjectId?.();
    if (!pid) {
      onStatus?.(false, "Open a project before uploading a robot.");
      return;
    }
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const robotFiles = files.filter((f) => /\.(urdf|srdf|stl|obj|glb|gltf|dae|png|jpg|jpeg)$/i.test(f.name));
    if (!robotFiles.length) {
      onStatus?.(false, "Choose a .urdf (plus optional .srdf / mesh files).");
      return;
    }
    setPanelStatus(`Uploading ${robotFiles.length} robot file(s)…`);
    try {
      await uploadFiles?.(robotFiles);
      await refreshPanel({ quiet: true });
      await loadRobotScene?.({ force: true });
      openPlayground?.({ forceRigging: false });
      setPanelStatus("Upload complete — robot loaded in the work cell.");
      onStatus?.(true, `Uploaded ${robotFiles.length} robot file(s).`);
    } catch (err) {
      setPanelStatus(err?.message || "Upload failed.");
      onStatus?.(false, err?.message || "Upload failed.");
    } finally {
      const input = els().uploadInput;
      if (input) input.value = "";
    }
  }

  async function show() {
    const { panel } = els();
    if (!panel) return;
    // Do not inject props into the CAD viewport until the user picks a cell.
    clearEnvironment();
    syncEnvUi();
    await refreshPanel({ quiet: true });
    onStatus?.(true, "Robotic Simulator — shop catalog arms, upload URDF, simulate in a work cell.");
  }

  function hide() {
    clearEnvironment();
  }

  function bind() {
    if (bound) return;
    bound = true;
    // Reset buggy default that used to inject shop-floor into Design on boot.
    if (envId !== "empty") {
      envId = "empty";
      writeEnv("empty");
    }
    renderCatalog();
    renderEnvironments();
    // Critical: never add work-cell props on boot — that pollutes Design viewport.
    clearEnvironment();
    syncEnvUi();

    const {
      catalog,
      envChoices,
      playBtn,
      loadBtn,
      playgroundBtn,
      uploadBtn,
      uploadInput,
      refreshBtn,
      panel,
    } = els();

    catalog?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-robot-catalog-action]");
      if (!btn) return;
      void handleCatalogAction(btn.dataset.robotCatalogAction);
    });

    envChoices?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-robot-env]");
      if (!btn) return;
      applyEnvironment(btn.dataset.robotEnv);
      onStatus?.(true, `Work environment: ${ENVIRONMENTS.find((x) => x.id === envId)?.label || envId}`);
    });

    playBtn?.addEventListener("click", () => {
      const started = togglePlay?.();
      syncPlayButton();
      setPanelStatus(started ? "Playing work-cycle motion…" : "Motion stopped.");
      onStatus?.(true, started ? "Robot work cycle playing." : "Robot motion stopped.");
    });

    loadBtn?.addEventListener("click", async () => {
      await refreshPanel({ quiet: true });
      const state = await loadRobotScene?.({ force: true });
      if (state?.loaded) {
        setPanelStatus(`Loaded ${state.urdfFile}`);
        onStatus?.(true, `Loaded robot from ${state.urdfFile}`);
      } else {
        setPanelStatus("No usable URDF in this project yet.");
        onStatus?.(false, "No usable URDF found — pick a catalog arm or upload one.");
      }
      syncPlayButton();
    });

    playgroundBtn?.addEventListener("click", () => {
      openPlayground?.({ forceRigging: false });
      onStatus?.(true, "Joint playground open in the viewport.");
    });

    uploadBtn?.addEventListener("click", () => uploadInput?.click());
    uploadInput?.addEventListener("change", () => void handleUpload(uploadInput.files));

    refreshBtn?.addEventListener("click", () => void refreshPanel({ quiet: false }));

    panel?.addEventListener("dragover", (e) => {
      e.preventDefault();
      panel.classList.add("is-drop-target");
    });
    panel?.addEventListener("dragleave", () => panel.classList.remove("is-drop-target"));
    panel?.addEventListener("drop", (e) => {
      e.preventDefault();
      panel.classList.remove("is-drop-target");
      void handleUpload(e.dataTransfer?.files);
    });
  }

  return {
    bind,
    show,
    hide,
    refresh: refreshPanel,
    applyEnvironment,
    clearEnvironment,
    syncPlayButton,
  };
}
