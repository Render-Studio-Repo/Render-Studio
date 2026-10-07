/** HTML measure labels: hidden until line hover, pin, rename, drag with dotted leader. */

import * as THREE from "three";

const LEADER_MIN_PX = 28;
const HOVER_STICK_MS = 220;
const toastTimers = new WeakMap();
const _world = new THREE.Vector3();

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function initial(name) {
  return String(name || "?").trim().charAt(0).toUpperCase() || "?";
}

function distToSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-8) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function offsetOf(item) {
  const x = Number(item?.labelOffset?.x);
  const y = Number(item?.labelOffset?.y);
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  };
}

function offsetDistance(item) {
  const o = offsetOf(item);
  return Math.hypot(o.x, o.y);
}

/** Temporary popup over the measure readout (not the viewport center). */
export function showMeasurePanelToast(readout, message, { ms = 2800 } = {}) {
  if (!readout) return;
  let el = readout.querySelector("[data-measure-toast]");
  if (!el) {
    el = document.createElement("div");
    el.className = "viewport-measure-toast";
    el.dataset.measureToast = "1";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    readout.prepend(el);
  }
  const text = String(message || "").trim();
  if (!text) {
    el.classList.add("hidden");
    return;
  }
  el.textContent = text;
  el.classList.remove("hidden");
  readout.classList.add("has-measure-toast");
  const prev = toastTimers.get(readout);
  if (prev) clearTimeout(prev);
  const timer = window.setTimeout(() => {
    el.classList.add("hidden");
    readout.classList.remove("has-measure-toast");
    toastTimers.delete(readout);
  }, Number(ms) || 2800);
  toastTimers.set(readout, timer);
}

export function showMeasureHudToast(host, message, opts = {}) {
  return showMeasurePanelToast(host, message, { ms: opts.duration ?? opts.ms ?? 2800 });
}

export function createMeasureLabelOverlay({
  host,
  camera,
  renderer,
  onDelete,
  onRename,
  onPin,
  onMove,
  onOpenAuthor,
  getWorldAnchor,
  toWorld,
  onHover,
  pickId,
} = {}) {
  const root = document.createElement("div");
  root.className = "measure-label-layer";
  const leaders = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  leaders.setAttribute("class", "measure-label-leaders");
  leaders.setAttribute("aria-hidden", "true");
  root.appendChild(leaders);
  const mount = host || renderer?.domElement?.parentElement || document.body;
  mount.appendChild(root);

  let items = [];
  let openMenuId = null;
  let hoveredId = null;
  let labelHoverId = null;
  let hoverClearTimer = 0;
  let drag = null;

  function closeMenus() {
    openMenuId = null;
    root.querySelectorAll(".measure-label-menu").forEach((el) => el.classList.add("hidden"));
    root.querySelectorAll("[data-measure-kebab]").forEach((el) => el.setAttribute("aria-expanded", "false"));
  }

  function toWorldSpace(raw, item) {
    if (!Array.isArray(raw) || raw.length < 3) return null;
    if (item?.worldSpace) return raw;
    if (typeof toWorld === "function") {
      const mapped = toWorld(raw, item);
      if (Array.isArray(mapped) && mapped.length >= 3) return mapped;
    }
    return raw;
  }

  function worldOf(item) {
    if (!item) return null;
    if (typeof getWorldAnchor === "function") {
      const fromGroup = getWorldAnchor(item.id);
      if (Array.isArray(fromGroup) && fromGroup.length >= 3) return fromGroup;
    }
    return toWorldSpace(item.anchor, item);
  }

  function worldEnd(item, key, fallback) {
    return toWorldSpace(item?.[key], item) || fallback;
  }

  function project(world) {
    if (!Array.isArray(world) || world.length < 3 || !camera || !renderer?.domElement) return null;
    const canvas = renderer.domElement.getBoundingClientRect();
    const origin = root.getBoundingClientRect();
    _world.set(Number(world[0]), Number(world[1]), Number(world[2])).project(camera);
    if (!Number.isFinite(_world.x) || !Number.isFinite(_world.y) || !Number.isFinite(_world.z)) return null;
    return {
      left: (canvas.left - origin.left) + ((_world.x + 1) * 0.5) * canvas.width,
      top: (canvas.top - origin.top) + ((1 - _world.y) * 0.5) * canvas.height,
      clientX: canvas.left + ((_world.x + 1) * 0.5) * canvas.width,
      clientY: canvas.top + ((1 - _world.y) * 0.5) * canvas.height,
      visible: _world.z >= -1 && _world.z <= 1 && _world.x >= -1.35 && _world.x <= 1.35 && _world.y >= -1.35 && _world.y <= 1.35,
    };
  }

  function avatarHtml(author) {
    const name = author?.display_name || (author?.guest ? "Guest" : "User");
    const letter = initial(name);
    const url = author?.avatar_url || "";
    const guest = !author?.id || author?.guest;
    const title = guest ? "Guest" : name;
    if (url && !guest) {
      return `<button type="button" class="measure-label-avatar" data-measure-author title="${esc(title)}" aria-label="${esc(title)}">
        <span class="measure-label-avatar-img" style="background-image:url('${esc(url)}')"></span>
      </button>`;
    }
    return `<span class="measure-label-avatar measure-label-avatar--guest" title="${esc(title)}" aria-hidden="true">${esc(letter)}</span>`;
  }

  function isShown(item) {
    if (!item) return false;
    if (item.pinned || openMenuId === item.id || drag?.id === item.id) return true;
    return hoveredId === item.id || labelHoverId === item.id;
  }

  function showLeader(item) {
    if (!item || offsetDistance(item) < LEADER_MIN_PX) return false;
    if (item.pinned) return true;
    return isShown(item);
  }

  function render() {
    root.querySelectorAll(".measure-label").forEach((el) => el.remove());
    for (const item of items) {
      const text = item.label ? `${item.label}: ${item.value}` : (item.value || "Measure");
      const author = item.author || { guest: true, display_name: "Guest" };
      const pinLabel = item.pinned ? "Unpin" : "Pin";
      const el = document.createElement("div");
      el.className = "measure-label";
      el.dataset.measureId = item.id;
      el.innerHTML = `
        ${avatarHtml(author)}
        <span class="measure-label-text">${esc(text)}</span>
        <button type="button" class="measure-label-move" data-measure-move title="Move label" aria-label="Move label">✥</button>
        <button type="button" class="measure-label-x" data-measure-delete title="Delete measurement" aria-label="Delete measurement">×</button>
        <button type="button" class="measure-label-kebab" data-measure-kebab title="More" aria-label="Measurement menu" aria-expanded="false">⋯</button>
        <div class="measure-label-menu hidden" role="menu">
          <button type="button" role="menuitem" data-measure-rename>Rename</button>
          <button type="button" role="menuitem" data-measure-pin>${pinLabel}</button>
        </div>`;
      root.appendChild(el);
    }
    bind();
    update();
  }

  function bind() {
    root.querySelectorAll(".measure-label").forEach((el) => {
      const id = el.dataset.measureId;
      el.addEventListener("pointerdown", (e) => e.stopPropagation());
      el.addEventListener("pointerenter", () => {
        labelHoverId = id;
        hoveredId = id;
        update();
      });
      el.addEventListener("pointerleave", () => {
        if (labelHoverId === id) labelHoverId = null;
        update();
      });
      el.querySelectorAll("[data-measure-delete]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          closeMenus();
          onDelete?.(id);
        });
      });
      el.querySelector("[data-measure-kebab]")?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const menu = el.querySelector(".measure-label-menu");
        const open = openMenuId !== id;
        closeMenus();
        if (open) {
          openMenuId = id;
          menu?.classList.remove("hidden");
          e.currentTarget.setAttribute("aria-expanded", "true");
        }
        update();
      });
      el.querySelector("[data-measure-rename]")?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMenus();
        onRename?.(id);
      });
      el.querySelector("[data-measure-pin]")?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const item = items.find((it) => it.id === id);
        if (!item) return;
        item.pinned = !item.pinned;
        closeMenus();
        onPin?.(id, item.pinned);
        render();
      });
      el.querySelector("[data-measure-author]")?.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const item = items.find((it) => it.id === id);
        if (item?.author?.id) onOpenAuthor?.(item.author, e.currentTarget);
      });
      const startDrag = (e) => {
        if (e.button != null && e.button !== 0) return;
        const item = items.find((it) => it.id === id);
        if (!item) return;
        e.preventDefault();
        e.stopPropagation();
        closeMenus();
        const o = offsetOf(item);
        drag = {
          id,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          origX: o.x,
          origY: o.y,
        };
        try { el.setPointerCapture(e.pointerId); } catch { /* optional */ }
        update();
      };
      el.querySelector("[data-measure-move]")?.addEventListener("pointerdown", startDrag);
      el.querySelector(".measure-label-text")?.addEventListener("pointerdown", startDrag);
    });
  }

  function hitTest(clientX, clientY) {
    let best = null;
    for (const item of items) {
      const anchor = worldOf(item);
      const a = project(worldEnd(item, "p1", anchor));
      const b = project(worldEnd(item, "p2", anchor));
      if (!a && !b) continue;
      const ax = a?.clientX ?? b.clientX;
      const ay = a?.clientY ?? b.clientY;
      const bx = b?.clientX ?? a.clientX;
      const by = b?.clientY ?? a.clientY;
      const d = distToSeg(clientX, clientY, ax, ay, bx, by);
      const span = Math.hypot(bx - ax, by - ay);
      const thresh = span < 6 ? 26 : 16;
      if (d <= thresh && (best == null || d < best.d)) best = { id: item.id, d };
    }
    return best?.id || null;
  }

  function setHovered(id) {
    const next = id || null;
    clearTimeout(hoverClearTimer);
    onHover?.(next);
    if (next) {
      hoveredId = next;
      update();
      return;
    }
    hoverClearTimer = window.setTimeout(() => {
      if (!labelHoverId && !drag && !openMenuId) {
        hoveredId = null;
        onHover?.(null);
        update();
      }
    }, HOVER_STICK_MS);
  }

  function onPointerMove(e) {
    if (drag && drag.pointerId === e.pointerId) {
      const item = items.find((it) => it.id === drag.id);
      if (!item) return;
      item.labelOffset = {
        x: drag.origX + (e.clientX - drag.startX),
        y: drag.origY + (e.clientY - drag.startY),
      };
      update();
      return;
    }
    if (e.target?.closest?.(".measure-label")) return;
    if (openMenuId) return;
    setHovered(pickId?.(e) || hitTest(e.clientX, e.clientY) || null);
  }

  function onPointerUp(e) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const id = drag.id;
    const item = items.find((it) => it.id === id);
    drag = null;
    if (item) onMove?.(id, offsetOf(item));
    update();
  }

  function onPointerDown(e) {
    if (!root.contains(e.target)) {
      closeMenus();
      update();
    }
  }

  document.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);

  function update() {
    const lines = [];
    root.querySelectorAll(".measure-label").forEach((el) => {
      const item = items.find((it) => it.id === el.dataset.measureId);
      const pos = project(worldOf(item));
      const shown = isShown(item);
      el.classList.toggle("is-offscreen", !pos || !pos.visible);
      el.classList.toggle("is-visible", Boolean(shown && pos?.visible));
      el.classList.toggle("is-pinned", Boolean(item?.pinned));
      if (!pos || !pos.visible) return;
      const o = offsetOf(item);
      const x = Math.round(pos.left + o.x);
      const y = Math.round(pos.top + o.y);
      el.style.transform = `translate(-50%, -120%) translate(${x}px, ${y}px)`;
      if (shown && showLeader(item)) {
        lines.push({ x1: pos.left, y1: pos.top, x2: x, y2: y - 10 });
      }
    });
    leaders.innerHTML = lines.map((ln) => (
      `<line x1="${ln.x1.toFixed(1)}" y1="${ln.y1.toFixed(1)}" x2="${ln.x2.toFixed(1)}" y2="${ln.y2.toFixed(1)}" />`
    )).join("");
  }

  return {
    setItems(next) {
      items = Array.isArray(next) ? next.map((item) => ({
        ...item,
        pinned: Boolean(item?.pinned),
        labelOffset: offsetOf(item),
      })) : [];
      if (hoveredId && !items.some((it) => it.id === hoveredId)) hoveredId = null;
      if (openMenuId && !items.some((it) => it.id === openMenuId)) openMenuId = null;
      render();
    },
    setHovered,
    update,
    destroy() {
      clearTimeout(hoverClearTimer);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      root.remove();
    },
  };
}
