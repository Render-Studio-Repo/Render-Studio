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
    hint: "Hazard lanes, workbench, and floor plate for industrial arms.",
  },
  {
    id: "lab-bench",
    label: "Lab bench",
    hint: "Clean bench and fixture plate for cobot-style work.",
  },
  {
    id: "warehouse",
    label: "Warehouse cell",
    hint: "Pallet and rack silhouette for logistics pick-and-place.",
  },
];

function readEnv() {
  try {
    const id = localStorage.getItem(ENV_KEY) || "shop-floor";
    return ENVIRONMENTS.some((e) => e.id === id) ? id : "shop-floor";
  } catch {
    return "shop-floor";
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
  return new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.72,
    metalness: opts.metalness ?? 0.08,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
  });
}

function box(w, h, d, color, opts = {}) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildEnvironment(kind) {
  const root = new THREE.Group();
  root.name = "robotSimEnvironment";
  root.userData.isRobotSimEnvironment = true;

  if (kind === "empty") return root;

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(1800, 64),
    mat(kind === "lab-bench" ? 0x1c2330 : 0x161b22, { roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1;
  floor.receiveShadow = true;
  root.add(floor);

  if (kind === "shop-floor") {
    const lane = box(4200, 2, 180, 0xf0b429, { roughness: 0.55 });
    lane.position.set(0, 1, -520);
    root.add(lane);
    const lane2 = lane.clone();
    lane2.position.z = 520;
    root.add(lane2);
    const bench = box(900, 760, 520, 0x2d333b);
    bench.position.set(1100, 380, 0);
    root.add(bench);
    const top = box(920, 28, 540, 0x3d4450);
    top.position.set(1100, 770, 0);
    root.add(top);
    const tote = box(280, 160, 220, 0x238636);
    tote.position.set(950, 850, 40);
    root.add(tote);
  }

  if (kind === "lab-bench") {
    const table = box(1400, 40, 700, 0xd0d7de, { roughness: 0.45, metalness: 0.2 });
    table.position.set(0, 720, 200);
    root.add(table);
    const legL = box(50, 720, 50, 0x6e7681);
    legL.position.set(-620, 360, 80);
    root.add(legL);
    const legR = legL.clone();
    legR.position.x = 620;
    root.add(legR);
    const plate = box(420, 12, 320, 0x58a6ff, { metalness: 0.35, roughness: 0.4 });
    plate.position.set(-180, 746, 180);
    root.add(plate);
  }

  if (kind === "warehouse") {
    const pallet = box(1000, 90, 800, 0xb08968);
    pallet.position.set(900, 45, 200);
    root.add(pallet);
    const crate = box(420, 320, 360, 0x9e6a3a);
    crate.position.set(900, 250, 200);
    root.add(crate);
    for (let i = 0; i < 3; i += 1) {
      const post = box(60, 1600, 60, 0x484f58);
      post.position.set(-1100 + i * 80, 800, -700);
      root.add(post);
      const shelf = box(900, 24, 320, 0x6e7681);
      shelf.position.set(-900, 350 + i * 420, -700);
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

  function applyEnvironment(nextId = envId) {
    envId = ENVIRONMENTS.some((e) => e.id === nextId) ? nextId : "empty";
    writeEnv(envId);
    const scene = getScene?.();
    if (envRoot) {
      scene?.remove(envRoot);
      envRoot.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose?.();
        if (obj.material) {
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
          else obj.material.dispose?.();
        }
      });
      envRoot = null;
    }
    if (!scene) return;
    envRoot = buildEnvironment(envId);
    scene.add(envRoot);
    syncEnvUi();
  }

  function clearEnvironment() {
    const scene = getScene?.();
    if (envRoot) {
      scene?.remove(envRoot);
      envRoot = null;
    }
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
        applyEnvironment(envId === "empty" ? "shop-floor" : envId);
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
      applyEnvironment(envId);
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
    applyEnvironment(envId);
    await refreshPanel({ quiet: true });
    onStatus?.(true, "Robotic Simulator — shop catalog arms, upload URDF, simulate in a work cell.");
  }

  function hide() {
    // Keep environment if a robot is loaded; clear only when leaving and nothing playing.
    if (!isPlaying?.() && !getRobotState?.()?.loaded) clearEnvironment();
  }

  function bind() {
    if (bound) return;
    bound = true;
    renderCatalog();
    renderEnvironments();
    applyEnvironment(envId);

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
      applyEnvironment(envId);
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
