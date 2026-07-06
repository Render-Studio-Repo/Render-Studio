/** Cursor-style @reference chips for the AI prompt */

import { removeReferenceMarker } from "./picking.js";

export function createPromptComposer({ textarea, chipsEl, refsListEl, onReferencesChange }) {
  const references = [];

  function notifyRefs() {
    onReferencesChange?.(getReferences());
  }

  function renderChips() {
    chipsEl.innerHTML = "";
    references.forEach((ref) => {
      const chip = document.createElement("span");
      chip.className = "ref-chip";
      chip.dataset.refId = ref.id;
      chip.innerHTML = `<span class="ref-type">${ref.type}</span><span class="ref-coords">${formatCoords(ref.position)}</span><button type="button" class="ref-remove" title="Remove">×</button>`;
      chip.querySelector(".ref-remove").addEventListener("click", () => removeRef(ref.id));
      chip.addEventListener("click", (e) => {
        if (e.target.classList.contains("ref-remove")) return;
        insertToken(ref.token);
      });
      chipsEl.appendChild(chip);
    });
    refsListEl.innerHTML = references.length
      ? references.map((r) => `<div class="ref-line"><code>${r.token}</code> → ${r.label}</div>`).join("")
      : '<span class="muted small">Click the model to pick; click again to deselect.</span>';
  }

  function formatCoords(pos) {
    return pos.map((v) => (v * 1000).toFixed(1)).join(", ") + " mm";
  }

  function addReference(ref) {
    if (!ref?.id) return;
    if (references.some((r) => r.id === ref.id)) return;
    if (ref.type === "face" && ref.planar_key) {
      const dup = references.find((r) => r.type === "face" && r.planar_key === ref.planar_key);
      if (dup) return;
    }
    if (ref.type === "face" && ref.face_key) {
      const dup = references.find((r) => r.type === "face" && r.face_key === ref.face_key);
      if (dup) return;
    }
    references.push(ref);
    renderChips();
    insertToken(ref.token);
    notifyRefs();
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
        label,
        local_point,
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
        label,
        local_point:
          local_point ||
          (localPoint ? [localPoint.x, localPoint.y, localPoint.z] : undefined),
      })
    );
  }

  function getPromptText() {
    return textarea.value.trim();
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

  renderChips();
  return {
    addReference,
    removeReference,
    getReferences,
    getPromptText,
    clearReferences,
    insertToken,
  };
}
