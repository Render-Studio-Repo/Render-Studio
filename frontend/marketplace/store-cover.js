/** Owner banner add / show / remove for the public store. */

import { authHeaders } from "../studio/auth.js";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function coverApi(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { ...authHeaders(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "Could not update banner");
  return data;
}

function paintPreview(editor, cover) {
  const preview = editor.querySelector("[data-cover-preview]");
  const toggle = editor.querySelector("[data-cover-enabled]");
  const remove = editor.querySelector("[data-cover-remove]");
  const addLabel = editor.querySelector("[data-cover-add-label]");
  const hasImage = !!(cover && cover.image_url);
  if (preview) {
    preview.classList.toggle("has-image", hasImage);
    preview.style.backgroundImage = hasImage ? `url('${cover.image_url}')` : "";
  }
  if (toggle) {
    toggle.disabled = !hasImage;
    toggle.checked = !!(cover && cover.enabled && hasImage);
  }
  if (remove) remove.hidden = !hasImage;
  if (addLabel) addLabel.textContent = hasImage ? "Replace image" : "Add banner";
}

export function coverEditorHtml(cover = {}, { heading = true } = {}) {
  const hasImage = !!(cover.image_url);
  return `
    <div class="storefront-banner-edit" data-cover-editor>
      ${heading ? "<h3>Store banner</h3>" : ""}
      <p class="muted small">Visitors see a banner only when an image is uploaded and shown. An empty banner is never displayed.</p>
      <div class="storefront-banner-preview${hasImage ? " has-image" : ""}" data-cover-preview ${hasImage ? `style="background-image:url('${esc(cover.image_url)}')"` : ""}></div>
      <label class="storefront-banner-toggle">
        <input type="checkbox" data-cover-enabled ${cover.enabled && hasImage ? "checked" : ""} ${hasImage ? "" : "disabled"} />
        Show banner on public store
      </label>
      <div class="storefront-banner-actions">
        <label class="btn secondary storefront-banner-file">
          <span data-cover-add-label>${hasImage ? "Replace image" : "Add banner"}</span>
          <input type="file" accept="image/png,image/jpeg" data-cover-file />
        </label>
        <button type="button" class="btn secondary" data-cover-remove ${hasImage ? "" : "hidden"}>Remove banner</button>
      </div>
      <p class="muted small" data-cover-status></p>
    </div>`;
}

export function bindCoverEditor(root, { onChanged } = {}) {
  const editor = root?.querySelector?.("[data-cover-editor]") || root;
  if (!editor || editor.dataset.bound === "1") return;
  editor.dataset.bound = "1";
  const status = editor.querySelector("[data-cover-status]");
  const setStatus = (msg) => {
    if (status) status.textContent = msg || "";
  };

  editor.querySelector("[data-cover-file]")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    setStatus("Uploading banner…");
    try {
      const data = await coverApi("/api/marketplace/store/cover", { method: "POST", body: form });
      paintPreview(editor, data.cover || {});
      setStatus("Banner added. Visitors will see it on your store.");
      onChanged?.(data.cover || {});
    } catch (err) {
      setStatus(err.message || "Upload failed.");
    }
  });

  editor.querySelector("[data-cover-enabled]")?.addEventListener("change", async (e) => {
    const enabled = !!e.target.checked;
    setStatus(enabled ? "Showing banner…" : "Hiding banner…");
    try {
      const data = await coverApi("/api/marketplace/store/cover", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      paintPreview(editor, data.cover || {});
      setStatus(enabled ? "Banner is visible to visitors." : "Banner hidden. Image is kept until you remove it.");
      onChanged?.(data.cover || {});
    } catch (err) {
      e.target.checked = !enabled;
      setStatus(err.message || "Could not update banner.");
    }
  });

  editor.querySelector("[data-cover-remove]")?.addEventListener("click", async () => {
    setStatus("Removing banner…");
    try {
      const data = await coverApi("/api/marketplace/store/cover", { method: "DELETE" });
      paintPreview(editor, data.cover || {});
      setStatus("Banner removed.");
      onChanged?.(data.cover || {});
    } catch (err) {
      setStatus(err.message || "Could not remove banner.");
    }
  });
}

export default { coverEditorHtml, bindCoverEditor };
