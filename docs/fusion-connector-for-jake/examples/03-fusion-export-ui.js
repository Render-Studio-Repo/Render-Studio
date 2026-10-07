/**
 * EXAMPLE COPY — Fusion Export UI (browser)
 * SOURCE: frontend/components/file-actions.js
 * PURPOSE: How Export menu calls POST /api/projects/{id}/push-to-autodesk
 *
 * Two paths:
 *   A) pushToOriginalFusion — reuse linked Autodesk source / mirror folder
 *   B) shared folder picker — user picks hub → project → folder, then upload
 */

// authHeaders() returns { Authorization: "Bearer <jwt>" } from the app session.

function fusionPushBody({
  fusionUploadFilename,
  allowFacetedStep = false,
  fusionStepMode = "part",
  visibleAllowList = [],
  isThreeMfFusionUpload = false,
}) {
  const body = {
    filename: fusionUploadFilename,
    allow_faceted_step: allowFacetedStep,
    step_mode: fusionStepMode || "part",
    // One STEP only — never companion .py (was creating 2 Fusion files).
    upload_source: false,
  };
  if (isThreeMfFusionUpload) {
    body.format = "3mf";
  }
  if (visibleAllowList.length) {
    body.allowed_filenames = visibleAllowList;
    body.visible_filenames = visibleAllowList;
  }
  return body;
}

/** A) Push updated Part STEP back to the original / linked Fusion folder */
async function pushToOriginalFusion({ projectId, authHeaders, fusionUploadFilename, menu }) {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/push-to-autodesk`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(fusionPushBody({ fusionUploadFilename })),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Fusion push failed (${res.status})`);
  }
  const data = await res.json();
  // data.name, data.item_id, data.web_url, data.open_instructions
  return data;
}

/**
 * B) Shared Fusion export — after user picks folder in the chooser UI.
 * conflict_mode: "replace" | "new" after asking if same name exists in folder.
 */
async function uploadToSelectedFusionFolder({
  projectId,
  authHeaders,
  hubId,
  apsProjectId,
  folderId,
  folderLabel,
  filename,
  uploadBaseName,
  conflictMode = "replace",
  stepMode = "part",
  allowFacetedStep = false,
  isThreeMf = false,
  allowedFilenames = [],
}) {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/push-to-autodesk`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({
      hub_id: hubId,
      aps_project_id: apsProjectId,
      folder_id: folderId,
      folder_label: folderLabel,
      filename,
      name: uploadBaseName,
      allow_faceted_step: allowFacetedStep,
      conflict_mode: conflictMode,
      step_mode: stepMode || "part",
      upload_source: false,
      ...(isThreeMf ? { format: "3mf" } : {}),
      ...(Array.isArray(allowedFilenames) && allowedFilenames.length
        ? { allowed_filenames: allowedFilenames, visible_filenames: allowedFilenames }
        : {}),
    }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Fusion export failed (${res.status})`);
  }
  return res.json();
}

/**
 * Folder browser helpers used by the chooser (same app):
 *   GET /api/autodesk/hubs
 *   GET /api/autodesk/hubs/{hubId}/projects
 *   GET /api/autodesk/projects/{projectId}/folders/{folderId}/contents
 *   GET /api/autodesk/status  — is Autodesk OAuth linked?
 */

export { fusionPushBody, pushToOriginalFusion, uploadToSelectedFusionFolder };
