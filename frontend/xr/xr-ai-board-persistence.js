/** Debounced project Canvas persistence. Never called from the XR animation loop. */
export const XR_AI_BOARD_STORE_NAME = "VR AI Draw";
export const XR_AI_BOARD_SAVE_DELAY = 1800;
const draftKey = (projectId) => `render3d:vr-ai-board-draft:v1:${projectId}`;
const isMissing = (error) => Number(error?.status || error?.statusCode) === 404 || /(?:404|canvas board not found)/i.test(error?.message || "");

export function createXrAiBoardPersistence({ board, api, getProjectId = () => "", onStatus = () => {},
  delay = XR_AI_BOARD_SAVE_DELAY, storage = globalThis.sessionStorage } = {}) {
  if (!board?.subscribe || typeof api !== "function") throw new Error("A Draw board and project API are required.");
  let projectId = "", token = 0, timer = null, pending = null, dirty = false, loading = false, disposed = false;
  let envelope = {}, storageRevision = "missing", blocked = false;
  const status = (phase, detail = {}) => { try { onStatus({ phase, projectId, dirty, ...detail }); } catch { /* UI only */ } };
  function stash() {
    if (!dirty || !projectId) return;
    try { storage?.setItem(draftKey(projectId), JSON.stringify({ baseRevision: storageRevision, board: board.exportState() })); } catch { /* Current board still retains edits. */ }
  }
  function schedule() {
    if (timer != null) clearTimeout(timer);
    if (disposed || loading || blocked || !projectId) return;
    timer = setTimeout(() => { timer = null; void flush(); }, Math.max(0, delay));
  }
  const unsubscribe = board.subscribe((_state, event) => {
    if (event.command.type === "load" || event.persistent === false) return;
    dirty = true;
    if (!projectId) { status("unsaved", { message: "Select a project to save this Draw board." }); return; }
    schedule();
  });
  async function flush() {
    if (timer != null) { clearTimeout(timer); timer = null; }
    if (pending) return pending;
    if (!dirty || !projectId || loading || disposed || blocked) return !dirty;
    const saveProject = projectId, saveToken = token;
    pending = (async () => {
      try {
        while (dirty && !disposed && saveToken === token) {
          const snapshot = board.exportState();
          stash();
          status("saving");
          const nextState = { ...envelope, title: envelope.title || XR_AI_BOARD_STORE_NAME, spatial_board: snapshot };
          const result = await api(`/api/projects/${encodeURIComponent(saveProject)}/canvas-board`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: XR_AI_BOARD_STORE_NAME, state: nextState, expected_revision: storageRevision }),
          });
          if (disposed || saveToken !== token) return false;
          if (!result?.storage_revision) {
            blocked = true;
            status("error", { message: "The server needs the Draw board revision update before this board can save safely." });
            return false;
          }
          storageRevision = result.storage_revision;
          envelope = nextState;
          dirty = board.getState().revision !== snapshot.revision;
          if (!dirty) { try { storage?.removeItem(draftKey(saveProject)); } catch { /* optional recovery */ } }
          else stash();
        }
        status("saved");
        return true;
      } catch (error) {
        if (saveToken === token && !disposed) {
          const conflict = Number(error?.status || error?.statusCode) === 409 || /(?:409|changed in another session)/i.test(error?.message || "");
          blocked = conflict;
          stash();
          status(conflict ? "conflict" : "error", { message: error?.message || "Draw board save failed. Your edits are retained.", recoverable: true });
        }
        return false;
      } finally { pending = null; }
    })();
    return pending;
  }
  async function load(nextProjectId = getProjectId(), { discardLocal = false } = {}) {
    nextProjectId = String(nextProjectId || "");
    if (nextProjectId === projectId && !blocked && !discardLocal && !loading) return true;
    if (dirty && projectId) { await flush(); stash(); }
    if (timer != null) { clearTimeout(timer); timer = null; }
    const loadToken = ++token;
    loading = true; blocked = false; projectId = nextProjectId; dirty = false;
    const startingRevision = board.getState().revision;
    status("loading");
    try {
      let result = null;
      if (projectId) {
        try { result = await api(`/api/projects/${encodeURIComponent(projectId)}/canvas-board?name=${encodeURIComponent(XR_AI_BOARD_STORE_NAME)}`); }
        catch (error) { if (!isMissing(error)) throw error; }
      }
      if (disposed || loadToken !== token) return false;
      envelope = result?.state || {};
      storageRevision = result?.storage_revision || "missing";
      if (result && !result.storage_revision) throw new Error("The server needs the Draw board revision update before this board can load safely.");
      if (board.getState().revision !== startingRevision) {
        blocked = true; dirty = true;
        status("conflict", { message: "The board changed while its project was loading. Your edits are retained; reload before saving." });
        return false;
      }
      let recovery = null;
      try { recovery = projectId && !discardLocal ? JSON.parse(storage?.getItem(draftKey(projectId)) || "null") : null; } catch { /* malformed optional recovery */ }
      board.replaceState({ ...(recovery?.board || envelope.spatial_board || {}), projectId });
      dirty = !!recovery;
      if (recovery && recovery.baseRevision !== storageRevision) {
        blocked = true;
        status("conflict", { message: "Recovered local edits differ from the saved board. Your local board is retained; reload the saved board only after copying any notes you need." });
      } else status(dirty ? "unsaved" : "loaded");
      if (discardLocal) { try { storage?.removeItem(draftKey(projectId)); } catch { /* optional recovery */ } }
      return !blocked;
    } catch (error) {
      if (loadToken === token && !disposed) { blocked = true; status("error", { message: error?.message || "Could not load the Draw board." }); }
      return false;
    } finally {
      if (loadToken === token) { loading = false; if (dirty && !blocked) schedule(); }
    }
  }
  return { load, switchProject: load, flush, isDirty: () => dirty, isBlocked: () => blocked,
    getStorageRevision: () => storageRevision,
    dispose() { stash(); disposed = true; token += 1; unsubscribe(); if (timer != null) clearTimeout(timer); },
  };
}
