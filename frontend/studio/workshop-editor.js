/** Lazy Workshop editor. Loaded only after the pinned Workshop tab is clicked. */

import {
  WORKSHOP_FEATURES,
  WORKSHOP_MONITORS,
  readWorkshopConfig,
  saveWorkshopConfig,
} from "./workshop-config.js?v=20260929-workshop-scene-v3";
import { generationPlacementFromSurface, normalizeGenerationPlacement } from "./generation-placement.js?v=20260923-spawn1";
import { WORKSPACE_WORLD_PIECES } from "../xr/xr-workspace-world.js?v=20260923-workshop1";
import { activeSceneSpawn, publishSceneToMarketplace } from "./scene-manifest.js?v=20260923-scene2";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>\"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));

function installStyles() {
  if (document.getElementById("workshop-editor-styles")) return;
  const style = document.createElement("style");
  style.id = "workshop-editor-styles";
  style.textContent = `.workshop-host{position:absolute;inset:36px 8px 8px auto;width:min(390px,42vw);z-index:48;border:1px solid var(--border,#30363d);border-radius:10px;background:#0d1117eF;color:var(--text,#e6edf3);overflow:auto;pointer-events:auto}.workshop-editor-head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #30363d;position:sticky;top:0;background:#0d1117;z-index:1}.workshop-editor-head strong{margin-right:auto}.workshop-editor-section{padding:12px;border-bottom:1px solid #21262d}.workshop-editor-section h3{margin:0 0 8px;font-size:12px;text-transform:uppercase;color:#8b949e}.workshop-editor-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.workshop-editor-row{display:grid;grid-template-columns:110px 1fr;gap:8px;align-items:center;margin:6px 0;font-size:12px}.workshop-editor-row input,.workshop-editor-row select{min-width:0;width:100%;box-sizing:border-box;background:#161b22;color:#e6edf3;border:1px solid #30363d;border-radius:6px;padding:6px}.workshop-editor-help{font-size:11px;color:#8b949e;margin:6px 0 0}.workshop-world-palette{display:flex;flex-wrap:wrap;gap:6px}`;
  document.head.appendChild(style);
}

export function createWorkshopEditor({ hostEl, getProjectId, viewportXR, apiFn, onStatus, onPickGenerationSurface, getSelectedGenerationSurface } = {}) {
  installStyles();
  let config = null;

  function projectId() { return String(getProjectId?.() || "anon"); }
  function render() {
    config = readWorkshopConfig(projectId());
    hostEl.innerHTML = `
      <div class="workshop-editor-head">
        <strong>${escapeHtml(config.scene.name)}</strong>
        <button class="dxf-viewer-btn" data-workshop-enter>Enter workshop</button>
        <button class="dxf-viewer-btn" data-workshop-vr>Enter VR</button>
      </div>
      <section class="workshop-editor-section">
        <h3>Scene</h3>
        <label class="workshop-editor-row">Name<input data-scene="name" value="${escapeHtml(config.scene.name)}"></label>
        <label class="workshop-editor-row">Environment<select data-scene="environment">${["workshop", "white", "warehouse"].map((id) => `<option value="${id}"${config.scene.environment === id ? " selected" : ""}>${id}</option>`).join("")}</select></label>
        <label class="workshop-editor-row">Walk speed<input data-scene="walkSpeed" type="number" min="0.4" max="4" step="0.05" value="${config.scene.walkSpeed}"></label>
        <label class="workshop-editor-row">Background<input data-scene="background" type="color" value="${config.scene.background}"></label>
        <p class="workshop-editor-help">This is your personal Workshop. Its scene and monitor settings are shared by desktop Workshop and VR; project assets remain linked to their source projects.</p>
      </section>
      <section class="workshop-editor-section"><h3>Scene settings</h3>
        <label class="workshop-editor-row">Load people at<select data-scene-spawn>${config.manifest.spawnPoints.map((spawn) => `<option value="${escapeHtml(spawn.id)}"${config.manifest.activeSpawnId === spawn.id ? " selected" : ""}>${escapeHtml(spawn.label)}</option>`).join("")}</select></label>
        <div class="workshop-editor-grid">
          ${["x", "y", "z", "yaw"].map((key, index) => `<label class="workshop-editor-row">${key.toUpperCase()}<input data-spawn-axis="${key}" type="number" step="0.05" value="${index < 3 ? activeSceneSpawn(config.manifest).position[index] : activeSceneSpawn(config.manifest).yaw}"></label>`).join("")}
        </div>
        <p class="workshop-editor-help">Avatar-fit bounds: ${config.manifest.bounds.width.toFixed(1)} × ${config.manifest.bounds.height.toFixed(1)} × ${config.manifest.bounds.depth.toFixed(1)} m · avatar ${config.manifest.bounds.avatarHeightM.toFixed(2)} m.</p>
        <h3>Life-size assets</h3>
        ${config.manifest.assets.length ? `<ul>${config.manifest.assets.map((asset) => `<li>${escapeHtml(asset.label)} · 1:1 meters</li>`).join("")}</ul>` : `<p class="workshop-editor-help">Right-click a project or model and choose Add to scene.</p>`}
        <button class="dxf-viewer-btn" data-scene-publish>Publish scene to profile / marketplace</button>
        <p class="workshop-editor-help">Publishes an installable scene manifest and adds the listing to your public profile. Marketplace review may still be required.</p>
      </section>
      <section class="workshop-editor-section"><h3>New model placement</h3>
        <p class="workshop-editor-help">${escapeHtml(config.generationPlacement.label)} · ${config.generationPlacement.position.map((n) => n.toFixed(3)).join(", ")} m</p>
        <label class="workshop-editor-row">Longest side (m)<input data-generation-size type="number" min="0.01" max="10" step="0.05" value="${config.generationPlacement.sizeMeters}"></label>
        <div class="workshop-world-palette">
          <button class="dxf-viewer-btn" data-generation-default>Middle desk plate</button>
          <button class="dxf-viewer-btn" data-generation-pick>Pick table / face</button>
          <button class="dxf-viewer-btn" data-generation-selected>Use last picked face</button>
        </div>
        <p class="workshop-editor-help">Every new model in VR or Workshop uses this project setting. Models keep their upright orientation and sit clear of the surface. The middle plate fits the available desk space. Desktop CAD placement is unchanged.</p>
      </section>
      <section class="workshop-editor-section"><h3>Monitor assignments</h3>
        ${WORKSHOP_FEATURES.map((feature) => `<label class="workshop-editor-row">${escapeHtml(feature.label)}<select data-monitor="${feature.id}">${WORKSHOP_MONITORS.map((screen) => `<option value="${screen.id}"${config.monitors[feature.id] === screen.id ? " selected" : ""}>${escapeHtml(screen.label)}</option>`).join("")}</select></label>`).join("")}
      </section>
      <section class="workshop-editor-section"><h3>Design world</h3><div class="workshop-world-palette">
        ${WORKSPACE_WORLD_PIECES.map((piece) => `<button class="dxf-viewer-btn" data-world-piece="${piece.id}" title="${escapeHtml(piece.desc)}">+ ${escapeHtml(piece.label)}</button>`).join("")}
        <button class="dxf-viewer-btn" data-world-undo>Undo</button>
      </div><p class="workshop-editor-help">${config.world.pieces.length} placed piece${config.world.pieces.length === 1 ? "" : "s"}</p></section>`;
  }

  function persist() {
    config = saveWorkshopConfig(config, projectId());
    viewportXR?.updateWorkshop?.(config);
  }

  hostEl.addEventListener("change", (event) => {
    const sceneKey = event.target?.dataset?.scene;
    const feature = event.target?.dataset?.monitor;
    if (event.target?.matches?.("[data-generation-size]")) config.generationPlacement.sizeMeters = Number(event.target.value);
    if (sceneKey) config.scene[sceneKey] = sceneKey === "walkSpeed" ? Number(event.target.value) : event.target.value;
    if (feature) config.monitors[feature] = event.target.value;
    if (event.target?.matches?.("[data-scene-spawn]")) config.manifest.activeSpawnId = event.target.value;
    const axis = event.target?.dataset?.spawnAxis;
    if (axis) {
      const spawn = activeSceneSpawn(config.manifest);
      if (axis === "yaw") spawn.yaw = Number(event.target.value) || 0;
      else spawn.position[{ x: 0, y: 1, z: 2 }[axis]] = Number(event.target.value) || 0;
      config.manifest.spawnPoints = config.manifest.spawnPoints.map((row) => row.id === spawn.id ? spawn : row);
    }
    persist();
  });
  hostEl.addEventListener("click", (event) => {
    if (event.target.closest("[data-generation-default]")) {
      config.generationPlacement = normalizeGenerationPlacement({ sizeMeters: config.generationPlacement.sizeMeters });
      persist(); render();
      onStatus?.("ok", "New models will spawn on the middle desk plate.");
      return;
    }
    const pickSurface = event.target.closest("[data-generation-pick]");
    const selectedSurface = event.target.closest("[data-generation-selected]");
    if (pickSurface || selectedSurface) {
      const targetProject = projectId();
      const callback = pickSurface ? onPickGenerationSurface : getSelectedGenerationSurface;
      if (typeof callback !== "function") { onStatus?.("error", "Surface selection is unavailable in this viewport."); return; }
      onStatus?.("ok", pickSurface ? "Select a table or model face in the viewport." : "Reading the selected face…");
      Promise.resolve().then(() => callback()).then((surface) => {
        if (projectId() !== targetProject) return;
        const placement = generationPlacementFromSurface(surface, config.generationPlacement);
        if (!placement) { onStatus?.("error", "No face selected. Pick a visible surface in the viewport."); return; }
        config.generationPlacement = placement;
        persist(); render();
        onStatus?.("ok", "New model spawn surface saved for this project.");
      }).catch((error) => onStatus?.("error", error?.message || "Could not select a spawn surface."));
      return;
    }
    if (event.target.closest("[data-workshop-enter]")) { void viewportXR?.enterWorkshop?.(config); return; }
    if (event.target.closest("[data-workshop-vr]")) { viewportXR?.updateWorkshop?.(config); void viewportXR?.enterWorkshopVr?.(config); return; }
    const publishButton = event.target.closest("[data-scene-publish]");
    if (publishButton) {
      publishButton.disabled = true;
      onStatus?.("ok", "Publishing scene to the marketplace…");
      void publishSceneToMarketplace(apiFn, config.manifest, {
        pinToProfile: async (listing) => {
          const { pinToPublicProfile } = await import("../marketplace/public-profile-showcase.js?v=20260915-marketplace3");
          await pinToPublicProfile({ kind: "model", listing_id: listing.id, category: "workshop-scenes" }, { api: apiFn });
        },
      }).then((listing) => {
        config.manifest.publication = { state: "exported", target: "profile_marketplace", exportedAt: new Date().toISOString(), listingId: listing.id };
        persist();
        onStatus?.("ok", listing.status === "approved" ? "Scene published to your profile and marketplace." : "Scene submitted to the marketplace and added to your public profile.");
        render();
      }).catch((error) => {
        publishButton.disabled = false;
        onStatus?.("error", error?.message || "Could not publish the scene.");
      });
      return;
    }
    if (event.target.closest("[data-world-undo]")) viewportXR?.undoWorkspacePiece?.();
    const kind = event.target.closest("[data-world-piece]")?.dataset?.worldPiece;
    if (kind) viewportXR?.placeWorkspacePiece?.(kind);
    if (kind || event.target.closest("[data-world-undo]")) {
      const world = viewportXR?.readWorkspaceWorld?.();
      if (world) config.world = world;
      persist(); render();
    }
  });

  return {
    open() {
      render();
      hostEl.classList.remove("hidden");
      hostEl.setAttribute("aria-hidden", "false");
      onStatus?.("ok", "Workshop ready · WASD walks at human height · walls and equipment have collision");
      void viewportXR?.enterWorkshop?.(config);
    },
    hide() { hostEl.classList.add("hidden"); hostEl.setAttribute("aria-hidden", "true"); },
  };
}
