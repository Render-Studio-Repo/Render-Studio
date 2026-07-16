/**
 * Texture library panel — store rendered textures, favorites, sphere previews,
 * and apply to selected parts or faces.
 */

import * as THREE from "three";
import { authHeaders, getToken } from "./auth.js?v=20260715-auth-connect-social";

export function createTexturePanel({
  api,
  getProjectId = () => null,
  onStatus = null,
  onApply = null,
  onSaveRequest = null,
} = {}) {
  const overlay = document.createElement("div");
  overlay.className = "texture-panel-overlay hidden";
  overlay.innerHTML = `
    <div class="texture-panel" role="dialog" aria-label="Texture library">
      <div class="texture-panel-head">
        <div>
          <strong>Textures</strong>
          <span class="muted small">Save rendered looks, favorite them, and wrap onto any part or face.</span>
        </div>
        <button type="button" class="texture-panel-close" aria-label="Close textures">×</button>
      </div>
      <div class="texture-panel-toolbar">
        <div class="texture-panel-tabs" role="tablist">
          <button type="button" class="active" data-texture-filter="all">All</button>
          <button type="button" data-texture-filter="favorites">Favorites</button>
        </div>
        <div class="texture-panel-actions">
          <label class="btn secondary btn-compact texture-upload-btn">
            Upload
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden data-texture-upload />
          </label>
          <button type="button" class="btn accent btn-compact" data-texture-refresh>Refresh</button>
        </div>
      </div>
      <div class="texture-panel-status muted small"></div>
      <div class="texture-panel-body">
        <div class="texture-panel-grid" data-texture-grid></div>
        <aside class="texture-panel-profile hidden" data-texture-profile>
          <div class="texture-profile-sphere" data-texture-sphere-host>
            <img data-texture-sphere-img alt="Texture on sphere" />
          </div>
          <div class="texture-profile-source">
            <span class="muted small">Source render</span>
            <img data-texture-source-img alt="Source texture" />
          </div>
          <label class="texture-profile-name">
            <span class="muted small">Name</span>
            <input type="text" maxlength="80" data-texture-name />
          </label>
          <p class="muted small" data-texture-meta></p>
          <div class="texture-profile-actions">
            <button type="button" class="btn secondary btn-compact" data-texture-favorite>Favorite</button>
            <button type="button" class="btn accent btn-compact" data-texture-apply-part>Apply to part</button>
            <button type="button" class="btn accent btn-compact" data-texture-apply-faces>Apply to faces</button>
            <button type="button" class="btn secondary btn-compact" data-texture-apply-object>Apply to object</button>
            <button type="button" class="btn danger btn-compact" data-texture-delete>Delete</button>
          </div>
        </aside>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const statusEl = overlay.querySelector(".texture-panel-status");
  const gridEl = overlay.querySelector("[data-texture-grid]");
  const profileEl = overlay.querySelector("[data-texture-profile]");
  const filterBtns = [...overlay.querySelectorAll("[data-texture-filter]")];

  let textures = [];
  let filter = "all";
  let selectedId = null;
  let authBlobUrls = [];

  function setStatus(text, kind = "") {
    statusEl.textContent = text || "";
    statusEl.className = `texture-panel-status small ${kind}`;
    onStatus?.(kind, text);
  }

  function revokeAuthBlobs() {
    authBlobUrls.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    });
    authBlobUrls = [];
  }

  async function authImageUrl(path) {
    if (!path) return "";
    if (path.startsWith("data:") || path.startsWith("blob:")) return path;
    const token = getToken?.();
    const headers = token ? { Authorization: `Bearer ${token}` } : { ...(authHeaders?.() || {}) };
    const res = await fetch(path, { headers });
    if (!res.ok) throw new Error("Could not load texture image");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    authBlobUrls.push(url);
    return url;
  }

  function selectedTexture() {
    return textures.find((t) => t.id === selectedId) || null;
  }

  async function renderProfile() {
    const texture = selectedTexture();
    if (!texture) {
      profileEl.classList.add("hidden");
      return;
    }
    profileEl.classList.remove("hidden");
    const nameInput = profileEl.querySelector("[data-texture-name]");
    const meta = profileEl.querySelector("[data-texture-meta]");
    const favBtn = profileEl.querySelector("[data-texture-favorite]");
    if (nameInput) nameInput.value = texture.name || "";
    if (meta) {
      const bits = [
        texture.favorite ? "Favorited" : "Not favorited",
        texture.source_label || null,
        texture.created_at ? `Saved ${new Date(texture.created_at).toLocaleString()}` : null,
      ].filter(Boolean);
      meta.textContent = bits.join(" · ");
    }
    if (favBtn) favBtn.textContent = texture.favorite ? "Unfavorite" : "Favorite";
    try {
      const sphereUrl = await authImageUrl(texture.sphere_url || texture.source_url);
      const sourceUrl = await authImageUrl(texture.source_url);
      const sphereImg = profileEl.querySelector("[data-texture-sphere-img]");
      const sourceImg = profileEl.querySelector("[data-texture-source-img]");
      if (sphereImg) sphereImg.src = sphereUrl;
      if (sourceImg) sourceImg.src = sourceUrl;
    } catch {
      /* keep previous images */
    }
  }

  function renderGrid() {
    const list =
      filter === "favorites" ? textures.filter((t) => t.favorite) : textures;
    if (!list.length) {
      gridEl.innerHTML = `
        <div class="texture-empty">
          <strong>No textures yet</strong>
          <span class="muted small">Save a rendered look from a render, or upload an image to start your library.</span>
        </div>`;
      return;
    }
    gridEl.innerHTML = "";
    for (const texture of list) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = `texture-card${texture.id === selectedId ? " active" : ""}${texture.favorite ? " is-favorite" : ""}`;
      card.dataset.textureId = texture.id;
      card.innerHTML = `
        <div class="texture-card-previews">
          <span class="texture-card-sphere"><img alt="" data-kind="sphere" /></span>
          <span class="texture-card-source"><img alt="" data-kind="source" /></span>
        </div>
        <div class="texture-card-meta">
          <strong>${escapeHtml(texture.name || "Texture")}</strong>
          <span class="muted small">${escapeHtml(texture.source_label || "Library texture")}</span>
        </div>
        <span class="texture-card-star" title="Favorite">${texture.favorite ? "★" : "☆"}</span>
      `;
      card.addEventListener("click", () => {
        selectedId = texture.id;
        renderGrid();
        void renderProfile();
      });
      card.querySelector(".texture-card-star")?.addEventListener("click", (e) => {
        e.stopPropagation();
        void toggleFavorite(texture.id, !texture.favorite);
      });
      gridEl.appendChild(card);
      void hydrateCardImages(card, texture);
    }
  }

  async function hydrateCardImages(card, texture) {
    try {
      const sphere = await authImageUrl(texture.sphere_url || texture.source_url);
      const source = await authImageUrl(texture.source_url);
      const sphereImg = card.querySelector('img[data-kind="sphere"]');
      const sourceImg = card.querySelector('img[data-kind="source"]');
      if (sphereImg) sphereImg.src = sphere;
      if (sourceImg) sourceImg.src = source;
    } catch {
      /* ignore */
    }
  }

  async function refresh() {
    if (!getToken?.()) {
      textures = [];
      selectedId = null;
      renderGrid();
      profileEl.classList.add("hidden");
      setStatus("Sign in to save and manage textures.", "error");
      return;
    }
    setStatus("Loading textures…");
    try {
      const data = await api("/api/users/me/textures");
      textures = data.textures || [];
      if (selectedId && !textures.some((t) => t.id === selectedId)) selectedId = null;
      if (!selectedId && textures[0]) selectedId = textures[0].id;
      revokeAuthBlobs();
      renderGrid();
      await renderProfile();
      setStatus(
        `${textures.length} texture${textures.length === 1 ? "" : "s"}${filter === "favorites" ? " · showing favorites" : ""}`,
        "ok",
      );
    } catch (err) {
      setStatus(err.message || "Could not load textures.", "error");
    }
  }

  async function toggleFavorite(id, favorite) {
    try {
      const data = await api(`/api/users/me/textures/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorite }),
      });
      const updated = data.texture;
      textures = textures.map((t) => (t.id === id ? updated : t));
      renderGrid();
      if (selectedId === id) await renderProfile();
      setStatus(favorite ? "Added to favorites." : "Removed from favorites.", "ok");
    } catch (err) {
      setStatus(err.message || "Could not update favorite.", "error");
    }
  }

  async function renameSelected() {
    const texture = selectedTexture();
    const nameInput = profileEl.querySelector("[data-texture-name]");
    const name = nameInput?.value?.trim();
    if (!texture || !name || name === texture.name) return;
    try {
      const data = await api(`/api/users/me/textures/${encodeURIComponent(texture.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      textures = textures.map((t) => (t.id === texture.id ? data.texture : t));
      renderGrid();
      await renderProfile();
      setStatus("Renamed texture.", "ok");
    } catch (err) {
      setStatus(err.message || "Could not rename.", "error");
    }
  }

  async function deleteSelected() {
    const texture = selectedTexture();
    if (!texture) return;
    if (!confirm(`Delete texture “${texture.name}”?`)) return;
    try {
      await api(`/api/users/me/textures/${encodeURIComponent(texture.id)}`, { method: "DELETE" });
      textures = textures.filter((t) => t.id !== texture.id);
      selectedId = textures[0]?.id || null;
      renderGrid();
      await renderProfile();
      setStatus("Texture deleted.", "ok");
    } catch (err) {
      setStatus(err.message || "Could not delete.", "error");
    }
  }

  async function applySelected(scope) {
    const texture = selectedTexture();
    if (!texture) return;
    if (!getProjectId?.()) {
      setStatus("Open a project before applying a texture.", "error");
      return;
    }
    try {
      setStatus(`Applying texture to ${scope}…`);
      await onApply?.(texture, scope);
      setStatus(`Applied “${texture.name}” to ${scope}.`, "ok");
    } catch (err) {
      setStatus(err.message || "Could not apply texture.", "error");
    }
  }

  async function uploadFile(file) {
    if (!file) return;
    try {
      setStatus("Creating sphere preview…");
      const sourceDataUrl = await fileToDataUrl(file);
      const sphereDataUrl = await renderTextureSpherePreview(sourceDataUrl);
      const form = new FormData();
      form.append("file", file, file.name || "texture.png");
      form.append("name", (file.name || "Texture").replace(/\.[^.]+$/, ""));
      form.append("source_label", "Uploaded image");
      if (getProjectId?.()) form.append("project_id", getProjectId());
      if (sphereDataUrl) form.append("sphere_data_url", sphereDataUrl);
      const data = await api("/api/users/me/textures/upload", { method: "POST", body: form });
      textures = [data.texture, ...textures.filter((t) => t.id !== data.texture.id)];
      selectedId = data.texture.id;
      renderGrid();
      await renderProfile();
      setStatus("Texture saved to library.", "ok");
    } catch (err) {
      setStatus(err.message || "Upload failed.", "error");
    }
  }

  function setFilter(next) {
    filter = next;
    filterBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.textureFilter === filter));
    renderGrid();
  }

  function open() {
    overlay.classList.remove("hidden");
    void refresh();
  }

  function close() {
    overlay.classList.add("hidden");
  }

  overlay.querySelector(".texture-panel-close")?.addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector("[data-texture-refresh]")?.addEventListener("click", () => void refresh());
  overlay.querySelector("[data-texture-upload]")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    void uploadFile(file);
  });
  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => setFilter(btn.dataset.textureFilter || "all"));
  });
  profileEl.querySelector("[data-texture-favorite]")?.addEventListener("click", () => {
    const texture = selectedTexture();
    if (texture) void toggleFavorite(texture.id, !texture.favorite);
  });
  profileEl.querySelector("[data-texture-name]")?.addEventListener("change", () => void renameSelected());
  profileEl.querySelector("[data-texture-delete]")?.addEventListener("click", () => void deleteSelected());
  profileEl.querySelector("[data-texture-apply-part]")?.addEventListener("click", () => void applySelected("part"));
  profileEl.querySelector("[data-texture-apply-faces]")?.addEventListener("click", () => void applySelected("faces"));
  profileEl.querySelector("[data-texture-apply-object]")?.addEventListener("click", () => void applySelected("object"));

  return {
    open,
    close,
    refresh,
    async saveFromRender({ sourceDataUrl, name, sourceLabel, favorite = false, projectId = null } = {}) {
      if (!sourceDataUrl) throw new Error("No texture image to save");
      const sphereDataUrl = await renderTextureSpherePreview(sourceDataUrl);
      const data = await api("/api/users/me/textures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || "Rendered texture",
          source_data_url: sourceDataUrl,
          sphere_data_url: sphereDataUrl,
          source_label: sourceLabel || "From render",
          project_id: projectId || getProjectId?.() || null,
          favorite: !!favorite,
        }),
      });
      textures = [data.texture, ...textures.filter((t) => t.id !== data.texture.id)];
      selectedId = data.texture.id;
      if (!overlay.classList.contains("hidden")) {
        renderGrid();
        await renderProfile();
      }
      onSaveRequest?.(data.texture);
      return data.texture;
    },
  };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not load texture image"));
    img.src = src;
  });
}

/** Offscreen sphere wrapped with the texture — saved as the library profile thumb. */
export async function renderTextureSpherePreview(sourceDataUrl, { size = 384 } = {}) {
  const image = await loadImage(sourceDataUrl);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setSize(size, size, false);
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d1117);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20);
  camera.position.set(0, 0.15, 2.55);
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.15);
  key.position.set(2.5, 3, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x88aacc, 0.35);
  fill.position.set(-3, -1, 2);
  scene.add(fill);
  const texture = new THREE.Texture(image);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 48),
    new THREE.MeshStandardMaterial({
      map: texture,
      metalness: 0.08,
      roughness: 0.42,
    }),
  );
  sphere.rotation.y = -0.55;
  sphere.rotation.x = 0.18;
  scene.add(sphere);
  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL("image/png");
  texture.dispose();
  sphere.geometry.dispose();
  sphere.material.dispose();
  renderer.dispose();
  renderer.forceContextLoss?.();
  return dataUrl;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
