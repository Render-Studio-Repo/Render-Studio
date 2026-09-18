function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function statusLabel(status) {
  const key = String(status || "idle").trim().toLowerCase();
  if (key === "capturing") return "Capturing";
  if (key === "captured") return "Captured";
  if (key === "error") return "Error";
  return "Idle";
}

function helperText(state) {
  const status = String(state?.status || "idle").trim().toLowerCase();
  if (status === "capturing") {
    return "Sandbox session is open. Stop the capture to emit the receipt, KB row, and media pointer stub.";
  }
  if (status === "captured") {
    return "Latest capture wrote a fleet-compatible receipt and mirrored a slim KB entry under Winstead-Fleet-KB.";
  }
  if (status === "error") {
    return "The last capture hit an error. Start again to create a fresh sandbox session.";
  }
  return "Start a lightweight wiring demo capture. This MVP writes sandbox artifacts only — no on-headset VLA or live arm control.";
}

function compactPath(path) {
  const text = String(path || "").trim();
  return text || "—";
}

export function normalizeWorkshopTrainingCapture(input, projectName = "Project") {
  const value = input && typeof input === "object" ? input : {};
  return {
    project_label: String(value.project_label || projectName || "Project"),
    status: String(value.status || "idle").trim().toLowerCase() || "idle",
    source_ui: String(value.source_ui || "Workshop / Quest training"),
    capture_label: String(value.capture_label || `${projectName} wiring demo`),
    active_session_id: value.active_session_id || null,
    active_session_dir: value.active_session_dir || null,
    started_at: value.started_at || null,
    stopped_at: value.stopped_at || null,
    last_receipt_id: value.last_receipt_id || null,
    last_receipt_path: value.last_receipt_path || null,
    last_media_pointer_path: value.last_media_pointer_path || null,
    last_action_log_path: value.last_action_log_path || null,
    last_kb_entry_path: value.last_kb_entry_path || null,
    last_error: value.last_error || null,
  };
}

export function renderWorkshopTrainingCapture(input, projectName = "Project") {
  const state = normalizeWorkshopTrainingCapture(input, projectName);
  const capturing = state.status === "capturing";
  const btnLabel = capturing ? "Stop training capture" : "Capture training demo";
  return `
    <section class="workshop-training-capture">
      <div class="workshop-training-capture__head">
        <div>
          <span class="workshop-kicker">Quest Train lane</span>
          <h3>${esc(state.capture_label || `${projectName} wiring demo`)}</h3>
          <p>${esc(helperText(state))}</p>
        </div>
        <button
          type="button"
          class="btn ${capturing ? "secondary" : "accent"} btn-compact"
          data-workshop-training-toggle
        >${esc(btnLabel)}</button>
      </div>
      <div class="workshop-training-capture__grid">
        <div class="workshop-training-capture__cell">
          <span>Status</span>
          <strong class="workshop-pill workshop-pill--${esc(state.status)}">${esc(statusLabel(state.status))}</strong>
        </div>
        <div class="workshop-training-capture__cell">
          <span>Receipt id</span>
          <strong>${esc(state.last_receipt_id || "Pending")}</strong>
        </div>
        <div class="workshop-training-capture__cell">
          <span>Session folder</span>
          <code>${esc(compactPath(state.active_session_dir))}</code>
        </div>
        <div class="workshop-training-capture__cell">
          <span>Media pointer</span>
          <code>${esc(compactPath(state.last_media_pointer_path))}</code>
        </div>
        <div class="workshop-training-capture__cell">
          <span>Action/controller log</span>
          <code>${esc(compactPath(state.last_action_log_path))}</code>
        </div>
        <div class="workshop-training-capture__cell">
          <span>KB entry</span>
          <code>${esc(compactPath(state.last_kb_entry_path))}</code>
        </div>
      </div>
      ${state.last_error ? `<div class="workshop-inline-error">${esc(state.last_error)}</div>` : ""}
    </section>
  `;
}

export function bindWorkshopTrainingCapture(root, options = {}) {
  const {
    api,
    getProjectId,
    setStatus,
    replaceWorkshopState,
    getTrainingState,
  } = options;
  const toggle = root?.querySelector?.("[data-workshop-training-toggle]");
  if (!toggle) return;

  let busy = false;
  toggle.addEventListener("click", async () => {
    if (busy) return;
    const projectId = String(getProjectId?.() || "").trim();
    if (!projectId) {
      setStatus?.("error", "Open a project before capturing a training demo.");
      return;
    }
    const training = normalizeWorkshopTrainingCapture(getTrainingState?.());
    const action = training.status === "capturing" ? "stop" : "start";
    busy = true;
    toggle.disabled = true;
    try {
      const data = await api(`/api/projects/${encodeURIComponent(projectId)}/workshop/training-capture/${action}`, {
        method: "POST",
      });
      replaceWorkshopState?.(data?.workshop || {});
      if (action === "start") {
        setStatus?.("ok", "Training capture started.");
      } else {
        const receiptId = data?.result?.receipt_id ? ` ${data.result.receipt_id}` : "";
        setStatus?.("ok", `Training capture stopped.${receiptId}`.trim());
      }
    } catch (err) {
      setStatus?.("error", err?.message || "Could not update the training capture.");
    } finally {
      busy = false;
      toggle.disabled = false;
    }
  });
}
