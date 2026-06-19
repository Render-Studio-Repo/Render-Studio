/** Cursor-style @reference chips for the AI prompt */

import { removeReferenceMarker } from "./picking.js?v=20260618-path-remove-x";

export function createPromptComposer({ textarea, chipsEl, inlineChipsEl = null, refsListEl, onReferencesChange }) {
  const references = [];
  let inlineExpanded = false;
  const INLINE_VISIBLE_LIMIT = 3;

  function notifyRefs() {
    onReferencesChange?.(getReferences());
  }

  function attachChipHandlers(chip, ref) {
    chip.querySelector(".ref-remove")?.addEventListener("click", (e) => {
      e.stopPropagation();
      removeRef(ref.id);
    });
    chip.addEventListener("click", (e) => {
      if (e.target.classList.contains("ref-remove")) return;
      if (chip.classList.contains("ref-chip--inline")) {
        textarea.focus();
        return;
      }
      insertToken(ref.token);
    });
  }

  function createChipElement(ref, { inline = false } = {}) {
    const chip = document.createElement("span");
    chip.className = inline ? "ref-chip ref-chip--inline" : "ref-chip";
    chip.dataset.refId = ref.id;
    chip.innerHTML = `<span class="ref-token">${formatToken(ref)}</span><span class="ref-coords">${formatRefDetail(ref)}</span><button type="button" class="ref-remove" title="Remove">×</button>`;
    attachChipHandlers(chip, ref);
    return chip;
  }

  function renderChips() {
    chipsEl.innerHTML = "";
    if (inlineChipsEl) {
      inlineChipsEl.innerHTML = "";
      inlineChipsEl.classList.toggle("hidden", references.length === 0);
    }
    if (references.length <= INLINE_VISIBLE_LIMIT) inlineExpanded = false;

    const explorerRefs = references.filter(
      (ref) => ref.type === "component" || ref.type === "sketch" || ref.type === "wiring"
    );

    references.forEach((ref) => {
      chipsEl.appendChild(createChipElement(ref));
    });

    if (inlineChipsEl) {
      if (explorerRefs.length > 0) {
        const count = document.createElement("div");
        count.className = "prompt-ref-count";
        count.textContent =
          explorerRefs.length === 1
            ? "1 component referenced"
            : `${explorerRefs.length} components referenced`;
        inlineChipsEl.appendChild(count);
      }
      const inlineRefs = inlineExpanded ? references : references.slice(0, INLINE_VISIBLE_LIMIT);
      for (const ref of inlineRefs) {
        inlineChipsEl.appendChild(createChipElement(ref, { inline: true }));
      }
      const hiddenCount = references.length - INLINE_VISIBLE_LIMIT;
      if (hiddenCount > 0) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "ref-chip ref-chip--inline ref-chip--more";
        more.textContent = inlineExpanded
          ? "Show less"
          : `+${hiddenCount} more (${references.length} total)`;
        more.addEventListener("click", (e) => {
          e.stopPropagation();
          inlineExpanded = !inlineExpanded;
          renderChips();
        });
        inlineChipsEl.appendChild(more);
      }
    }

    const summary =
      references.length > INLINE_VISIBLE_LIMIT
        ? `<div class="ref-summary">${references.length} references active</div>`
        : "";
    refsListEl.innerHTML = references.length
      ? `${summary}${references.map((r) => `<div class="ref-line"><code>${r.token}</code> → ${r.label || formatRefDetail(r)}</div>`).join("")}`
      : '<span class="muted small">Click the model to pick; click again to deselect. Drag components from the explorer into the prompt.</span>';
  }

  function formatCoords(pos) {
    if (!Array.isArray(pos)) return "";
    return pos.map((v) => (v * 1000).toFixed(1)).join(", ") + " mm";
  }

  function formatRefDetail(ref) {
    if (ref.type === "component") return ref.label || ref.stem || ref.filename || "component";
    if (ref.type === "sketch") return ref.label || ref.stem || "sketch";
    if (ref.type === "wiring") return ref.label || ref.stem || "wiring";
    if (ref.type === "path") return ref.label || `${(ref.loop_points || []).length} pts`;
    return formatCoords(ref.position);
  }

  function formatToken(ref) {
    return ref.token || `@${ref.id}`;
  }

  function shouldSkipReference(ref) {
    if (!ref?.id) return true;
    if (references.some((r) => r.id === ref.id)) return true;
    if (ref.type === "face" && ref.planar_key) {
      if (references.some((r) => r.type === "face" && r.planar_key === ref.planar_key)) return true;
    }
    if (ref.type === "face" && ref.face_key) {
      if (references.some((r) => r.type === "face" && r.face_key === ref.face_key)) return true;
    }
    return false;
  }

  function addReference(ref) {
    if (shouldSkipReference(ref)) return;
    references.push(ref);
    renderChips();
    notifyRefs();
  }

  function addReferences(refs = []) {
    let added = 0;
    for (const ref of refs) {
      if (shouldSkipReference(ref)) continue;
      references.push(ref);
      added += 1;
    }
    if (!added) return 0;
    renderChips();
    notifyRefs();
    return added;
  }

  function removeRef(id) {
    const idx = references.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const token = references[idx].token;
    references.splice(idx, 1);
    removeReferenceMarker(id);
    textarea.value = textarea.value.replace(new RegExp(`\\s*${escapeReg(token)}\\s*`, "g"), " ").trim();
    renderChips();
    notifyRefs();
  }

  function escapeReg(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function insertToken(token) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const before = textarea.value.slice(0, start);
    const after = textarea.value.slice(end);
    const spacer = before && !before.endsWith(" ") ? " " : "";
    const insert = `${spacer}${token} `;
    textarea.value = before + insert + after;
    textarea.selectionStart = textarea.selectionEnd = start + insert.length;
    textarea.focus();
  }

  function getReferences() {
    return references.map(
      ({
        id,
        type,
        position,
        normal,
        face_index,
        face_indices,
        face_key,
        planar_key,
        mesh_uuid,
        vertex_index,
        selected_vertices,
        loop_points,
        surface_normals,
        surface_locked,
        label,
        token,
        filename,
        stem,
        format,
        viewer_filename,
        projectId,
        local_point,
        local_loop_points,
        localPoint,
      }) => ({
        id,
        type,
        position,
        normal,
        face_index,
        face_indices,
        face_key,
        planar_key,
        mesh_uuid,
        vertex_index,
        selected_vertices,
        loop_points,
        surface_normals,
        surface_locked,
        label,
        token,
        filename,
        stem,
        format,
        viewer_filename,
        projectId,
        local_point:
          local_point ||
          (localPoint ? [localPoint.x, localPoint.y, localPoint.z] : undefined),
        local_loop_points,
      })
    );
  }

  function getPromptText() {
    return textarea.value.trim();
  }

  function getRawPromptText() {
    return textarea.value;
  }

  function setPromptText(text = "") {
    textarea.value = text || "";
  }

  function clearReferences() {
    for (const r of references) {
      removeReferenceMarker(r.id);
    }
    references.length = 0;
    renderChips();
    notifyRefs();
  }

  function removeReference(id) {
    removeRef(id);
  }

  function enrichReference(ref) {
    if (!ref?.id) return null;
    const stem = ref.stem || ref.filename?.replace(/\.[^.]+$/, "") || ref.label || "component";
    const token = ref.token || (ref.type === "component" || ref.type === "sketch" || ref.type === "wiring"
      ? `@${String(stem).replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "component"}`
      : `@${ref.id}`);
    return { ...ref, token };
  }

  function replaceReferences(nextRefs = []) {
    for (const r of references) {
      removeReferenceMarker(r.id);
    }
    references.length = 0;
    for (const ref of nextRefs) {
      const enriched = enrichReference(ref);
      if (enriched?.id && !references.some((r) => r.id === enriched.id)) {
        references.push(enriched);
      }
    }
    renderChips();
    notifyRefs();
  }

  renderChips();
  return {
    addReference,
    addReferences,
    removeReference,
    replaceReferences,
    getReferences,
    getPromptText,
    getRawPromptText,
    setPromptText,
    clearReferences,
    insertToken,
  };
}
