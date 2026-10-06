/** Robotic Simulator — catalog arms, URDF upload, work-cell environments, joint motion. */

import * as THREE from "three";

const ENV_KEY = "render3d:robotSimEnv:v1";

const CATALOG = [
  {
    id: "openarm-dimos",
    name: "Open Arm",
    tagline: "Live DIMOS teleop-quest-openarm. Mock on Mac (no CAN) is a connected robot.",
    badge: "Live",
    action: "dimos",
  },
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

function buildFloorSlab(kind) {
  const size = kind === "lab-bench" ? 5000 : 6500; // mm
  const group = new THREE.Group();
  group.name = "robotSimFloor";

  const baseColor =
    kind === "lab-bench" ? 0x2a3140 : kind === "warehouse" ? 0x2e2b26 : 0x3a4049;
  // Main slab — flat on XY (Z-up), reads as a real floor under the CAD grid.
  const slab = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    mat(baseColor, { basic: true }),
  );
  slab.position.z = -1;
  slab.receiveShadow = true;
  group.add(slab);

  // Soft outer apron so the slab doesn't hard-cut into the void
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(size * 1.35, size * 1.35),
    mat(0x12151a, { basic: true }),
  );
  apron.position.z = -2;
  group.add(apron);

  // Painted aisle cues as coplanar planes (not thick bars)
  if (kind === "shop-floor") {
    const tapeMat = mat(0xe3a812, { basic: true });
    const span = size * 0.7;
    const tapeW = 55;
    for (const y of [-size * 0.3, size * 0.3]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(span, tapeW), tapeMat);
      strip.position.set(0, y, -0.2);
      group.add(strip);
    }
  }

  if (kind === "lab-bench") {
    const zone = new THREE.Mesh(
      new THREE.PlaneGeometry(size * 0.5, size * 0.5),
      mat(0x243044, { basic: true }),
    );
    zone.position.z = -0.3;
    group.add(zone);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(size * 0.24, size * 0.255, 64),
      mat(0x58a6ff, { basic: true }),
    );
    ring.position.z = -0.15;
    group.add(ring);
  }

  if (kind === "warehouse") {
    const lane = new THREE.Mesh(
      new THREE.PlaneGeometry(size * 0.75, 90),
      mat(0x4a4450, { basic: true }),
    );
    lane.position.set(0, -size * 0.28, -0.2);
    group.add(lane);
  }

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
    const bench = box(1000, 520, benchH, 0x2b313a, { roughness: 0.78 });
    bench.position.set(2000, 150, benchH / 2);
    root.add(bench);
    const top = box(1040, 560, 24, 0x4a5562, { roughness: 0.55, metalness: 0.18 });
    top.position.set(2000, 150, benchH + 12);
    root.add(top);
  }

  if (kind === "lab-bench") {
    const h = 740;
    const table = box(1500, 750, 34, 0xc9d1d9, { roughness: 0.35, metalness: 0.22 });
    table.position.set(0, 350, h + 17);
    root.add(table);
    [[-650, 80], [650, 80], [-650, 620], [650, 620]].forEach(([x, y]) => {
      const leg = box(44, 44, h, 0x6e7681, { metalness: 0.35, roughness: 0.4 });
      leg.position.set(x, y, h / 2);
      root.add(leg);
    });
  }

  if (kind === "warehouse") {
    const pallet = box(1000, 800, 90, 0xa67c52, { roughness: 0.9 });
    pallet.position.set(1700, 250, 45);
    root.add(pallet);
    const crate = box(440, 360, 320, 0x8d6e4c, { roughness: 0.85 });
    crate.position.set(1700, 250, 260);
    root.add(crate);
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
    getDimosRobot,
    onSelectDimosRobot,
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

  function looksLikeOpenArmName(value) {
    return /open[\s_-]*arm/i.test(String(value || ""));
  }

  function bindOpenArmMeshes() {
    const scene = getScene?.();
    if (!scene) return 0;
    let n = 0;
    scene.traverse((obj) => {
      const name = `${obj.name || ""} ${obj.userData?.catalogFilename || ""} ${obj.userData?.filename || ""}`;
      if (!looksLikeOpenArmName(name)) return;
      obj.userData.dimosRobotId = "openarm";
      obj.userData.dimosBound = true;
      n += 1;
    });
    return n;
  }

  function liveDimos() {
    try {
      return getDimosRobot?.() || null;
    } catch {
      return null;
    }
  }

  function renderCatalog() {
    const { catalog } = els();
    if (!catalog) return;
    const live = liveDimos();
    catalog.innerHTML = CATALOG.map((item) => {
      const isLive = item.action === "dimos";
      const connected = isLive && !!live?.recognized;
      const mode = live?.hardwareMode === "can" ? "CAN" : "mock";
      const tagline = isLive && live?.armed
        ? `DimOS viewer on · ${connected ? `connected (${mode})` : "connecting"} · Enable Robotics is the same toggle as Activate.`
        : isLive && connected
        ? `Live DIMOS session · connected (${mode}). No URDF or CAN required.`
        : item.tagline;
      const badge = isLive && live?.armed ? "Viewer on" : isLive && connected ? "Connected" : item.badge;
      const actionLabel = isLive
        ? (live?.armed ? "DimOS viewer on" : connected ? "Use live session" : "Select Open Arm")
        : item.action === "seed-demo" ? "Load into project" : item.action === "store" ? "Open in store" : "Choose files";
      return `
      <article class="robotics-catalog-card${isLive && (live?.selectedRobot === "openarm" || connected) ? " is-selected" : ""}${connected ? " is-connected" : ""}" data-robot-catalog="${item.id}">
        <div class="robotics-catalog-card-head">
          <strong>${item.name}</strong>
          <span class="robotics-catalog-badge">${badge}</span>
        </div>
        <p>${tagline}</p>
        <button type="button" class="btn accent btn-compact" data-robot-catalog-action="${item.id}">
          ${actionLabel}
        </button>
      </article>`;
    }).join("");
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
      const live = liveDimos();
      if (live?.recognized) {
        const mode = live.hardwareMode === "can" ? "CAN" : "mock";
        artifacts.innerHTML = `<div class="robotics-artifact-summary">Open Arm · DIMOS ${mode} · hardware_id openarm · no project URDF required</div>`;
        return;
      }
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
    renderCatalog();
    renderArtifacts(data || getRobotState?.()?.artifacts || null);
    const state = getRobotState?.();
    const live = liveDimos();
    if (state?.loaded) {
      setPanelStatus(`Robot loaded · ${state.urdfFile || "URDF"}`);
    } else if (live?.recognized) {
      const mode = live.hardwareMode === "can" ? "CAN" : "mock";
      setPanelStatus(`Open Arm connected (${mode}) from the live DIMOS session.`);
    } else if (!quiet) {
      setPanelStatus("Ready — load a catalog arm or your URDF to simulate.");
    }
    syncPlayButton();
    return data;
  }

  async function handleCatalogAction(id) {
    const item = CATALOG.find((c) => c.id === id);
    if (!item) return;
    if (item.action === "dimos") {
      const bound = bindOpenArmMeshes();
      onSelectDimosRobot?.("openarm");
      const live = liveDimos();
      const mode = live?.hardwareMode === "can" ? "CAN" : "mock";
      renderCatalog();
      if (live?.recognized) {
        setPanelStatus(`Open Arm connected (${mode})${bound ? ` · ${bound} mesh(es) bound` : ""}.`);
        onStatus?.(true, `Open Arm recognized from DIMOS (${mode}).`);
      } else {
        setPanelStatus("Open Arm selected — waiting for the DIMOS coordinator…");
        onStatus?.(true, "Open Arm is the selected robot. Mock is OK if there is no CAN.");
      }
      return;
    }
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
    refreshLiveRobot: ({ network = false } = {}) => {
      renderCatalog();
      renderArtifacts(getRobotState?.()?.artifacts || null);
      if (!network) return null;
      return refreshPanel({ quiet: true });
    },
    applyEnvironment,
    clearEnvironment,
    syncPlayButton,
    bindOpenArmMeshes,
  };
}
