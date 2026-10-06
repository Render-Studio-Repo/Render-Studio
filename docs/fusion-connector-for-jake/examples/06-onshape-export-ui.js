/**
 * EXAMPLE COPY — Onshape Export UI (browser)
 * SOURCE: frontend/components/file-actions.js (+ frontend/cad/onshape-panel.js for import/push from panel)
 * PURPOSE: How Export menu calls Onshape push / export endpoints.
 */

async function onshapeAction(btn, endpoint, body, resetLabel, { authHeaders, menu, showExportError }) {
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.innerHTML = `Working…`;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      throw new Error(d.detail || `Failed (${res.status})`);
    }
    const data = await res.json();
    btn.innerHTML = `Opened in Onshape ✓`;
    // Onshape returns { url, document_name }
    window.open(data.url, "_blank", "noopener");
    return data;
  } catch (err) {
    btn.disabled = false;
    btn.innerHTML = original || resetLabel;
    showExportError?.(menu, err, {
      title: "Onshape action failed",
      onRetry: () => onshapeAction(btn, endpoint, body, resetLabel, { authHeaders, menu, showExportError }),
    });
    throw err;
  }
}

/** Export selected file → new Onshape document */
function wireExportToOnshape({ projectId, resolvedCloudFilename, resolvedCloudStepIsFaceted, onshapeBtn, ...ctx }) {
  onshapeBtn?.addEventListener("click", () =>
    onshapeAction(
      onshapeBtn,
      `/api/projects/${projectId}/files/${encodeURIComponent(resolvedCloudFilename)}/export-to-onshape`,
      { allow_faceted_step: resolvedCloudStepIsFaceted },
      "Export to Onshape",
      ctx,
    ),
  );
}

/** Push current project model → new Onshape document (edited name) */
function wirePushToOnshape({ projectId, resolvedCloudFilename, resolvedCloudStepIsFaceted, pushBtn, ...ctx }) {
  pushBtn?.addEventListener("click", () =>
    onshapeAction(
      pushBtn,
      `/api/projects/${projectId}/push-to-onshape`,
      { filename: resolvedCloudFilename, allow_faceted_step: resolvedCloudStepIsFaceted },
      "Push to Onshape",
      ctx,
    ),
  );
}

/**
 * Related OAuth / browse endpoints (onshape-panel.js):
 *   GET  /api/onshape/status
 *   POST /api/onshape/oauth-url
 *   GET  /api/onshape/documents?limit=30
 *   GET  /api/onshape/documents/{id}/elements?wid=...
 *   POST /api/onshape/import
 */

export { onshapeAction, wireExportToOnshape, wirePushToOnshape };
