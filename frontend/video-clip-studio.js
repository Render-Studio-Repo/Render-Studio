/**
 * Multi-track clip studio — viewport + webcam + upload + phone QR tracks,
 * labels for AI assembly, and timeline ordering.
 */

import { mountViewportVideoEditor, parseVideoEditPrompt } from "./viewport-video-editor.js?v=20260727-clip-studio";

function uid() {
  return `clip_${Math.random().toString(36).slice(2, 10)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Order clips from an assemble prompt by matching labels mentioned in order. */
export function parseAssembleOrder(prompt, clips = []) {
  const text = String(prompt || "").toLowerCase();
  if (!text.trim() || !clips.length) return clips.map((c) => c.id);

  const remaining = [...clips];
  const ordered = [];

  // Explicit "1. label / 2. label" or "first X then Y"
  const numbered = [...text.matchAll(/(?:^|\n|;|\.)\s*(\d+)[.)]\s*([^\n;]+)/g)];
  if (numbered.length) {
    const byNum = numbered
      .map((m) => ({ n: Number(m[1]), phrase: m[2].trim() }))
      .sort((a, b) => a.n - b.n);
    for (const item of byNum) {
      const hit = remaining.find((c) => item.phrase.includes(String(c.label || "").toLowerCase())
        || String(c.label || "").toLowerCase().includes(item.phrase.slice(0, 24)));
      if (hit) {
        ordered.push(hit.id);
        remaining.splice(remaining.indexOf(hit), 1);
      }
    }
  }

  // Mentions of labels in prompt order
  const positions = remaining
    .map((c) => {
      const label = String(c.label || "").toLowerCase().trim();
      if (label.length < 2) return null;
      const idx = text.indexOf(label);
      return idx >= 0 ? { id: c.id, idx, clip: c } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.idx - b.idx);

  for (const item of positions) {
    ordered.push(item.id);
    const i = remaining.findIndex((c) => c.id === item.id);
    if (i >= 0) remaining.splice(i, 1);
  }

  // Heuristics: "cad/3d/viewport first" then "printed/hand/phone"
  if (!ordered.length && /first|then|after|before|cut to|followed by/.test(text)) {
    const preferEarly = remaining.filter((c) => /viewport|3d|cad|model|orbit|tumble/i.test(c.label || c.source || ""));
    const preferLate = remaining.filter((c) => /print|hand|phone|hold|physical|part/i.test(c.label || c.source || ""));
    for (const c of preferEarly) {
      if (!ordered.includes(c.id)) ordered.push(c.id);
    }
    for (const c of preferLate) {
      if (!ordered.includes(c.id)) ordered.push(c.id);
    }
  }

  for (const c of remaining) {
    if (!ordered.includes(c.id)) ordered.push(c.id);
  }
  return ordered;
}

async function probeDuration(blob) {
  if (!blob) return 0;
  const url = URL.createObjectURL(blob);
  try {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.src = url;
    await new Promise((resolve) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => resolve();
      setTimeout(resolve, 2500);
    });
    const d = Number(video.duration);
    return Number.isFinite(d) && d > 0 ? d : 0;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sourceLabel(source) {
  if (source === "viewport") return "3D";
  if (source === "webcam") return "Cam";
  if (source === "upload") return "File";
  if (source === "phone") return "Phone";
  return "Clip";
}

/**
 * @param {HTMLElement} host
 * @param {{
 *   getPreviewEl: Function,
 *   getToken: Function,
 *   getProjectId?: Function,
 *   onOutputBlob: Function,
 *   onStatus: Function,
 *   onRequestViewportRecord?: Function,
 * }} opts
 */
export function mountVideoClipStudio(host, {
  getPreviewEl,
  getToken,
  getProjectId,
  isFreeTrialCredits,
  onOutputBlob,
  onStatus,
  onRequestViewportRecord,
} = {}) {
  if (!host) {
    return {
      destroy() {},
      setPrimaryClip() {},
      getOutputBlob() { return null; },
      needsBake() { return false; },
      ensureBaked: async () => null,
    };
  }

  /** @type {Array<{id:string,source:string,label:string,blob:Blob,url:string,duration:number,remote?:object}>} */
  let clips = [];
  let selectedId = null;
  let captureToken = null;
  let capturePoll = 0;
  let knownRemoteIds = new Set();
  let webcamStream = null;
  let webcamRecorder = null;
  let webcamChunks = [];
  let effectsEditor = null;

  host.innerHTML = `
    <section class="vcs" aria-label="Clip studio">
      <div class="vcs-head">
        <div>
          <p class="vcs-eyebrow">Video studio</p>
          <h3 class="vcs-title">Multi-track editor</h3>
        </div>
        <p class="vcs-meta muted small" data-vcs-meta>Add clips, label them, then assemble</p>
      </div>

      <div class="vcs-sources" role="toolbar" aria-label="Add clip">
        <button type="button" class="btn secondary vcs-src-btn" data-vcs-add="webcam">Webcam</button>
        <button type="button" class="btn secondary vcs-src-btn" data-vcs-add="upload">Upload</button>
        <button type="button" class="btn secondary vcs-src-btn" data-vcs-add="phone">Phone QR</button>
        <button type="button" class="btn secondary vcs-src-btn" data-vcs-add="viewport">+ 3D take</button>
        <input type="file" accept="video/*,video/mp4,video/webm,video/quicktime" data-vcs-file hidden />
      </div>

      <div class="vcs-webcam hidden" data-vcs-webcam>
        <video class="vcs-webcam-preview" data-vcs-webcam-preview playsinline muted autoplay></video>
        <div class="vcs-webcam-actions">
          <input type="text" data-vcs-webcam-label maxlength="80" placeholder="Label this take…" value="Webcam take" />
          <button type="button" class="btn accent" data-vcs-webcam-rec>Record</button>
          <button type="button" class="btn secondary hidden" data-vcs-webcam-stop>Stop</button>
          <button type="button" class="btn secondary" data-vcs-webcam-close>Close</button>
        </div>
      </div>

      <div class="vcs-phone hidden" data-vcs-phone>
        <div class="vcs-phone-grid">
          <img class="vcs-phone-qr" data-vcs-phone-qr alt="QR code to open phone capture" />
          <div>
            <p class="vcs-phone-title">Scan with iPhone or Android</p>
            <p class="muted small">Opens a capture page — record or pick from Photos, label it, and it lands on this timeline.</p>
            <a class="vcs-phone-link" data-vcs-phone-link href="#" target="_blank" rel="noopener">Open link</a>
            <p class="muted small" data-vcs-phone-status>Waiting for phone clips…</p>
            <button type="button" class="btn secondary btn-compact" data-vcs-phone-refresh>Refresh</button>
            <button type="button" class="btn secondary btn-compact" data-vcs-phone-close>Hide QR</button>
          </div>
        </div>
      </div>

      <div class="vcs-timeline" data-vcs-timeline></div>

      <div class="vcs-selected hidden" data-vcs-selected>
        <label class="vcs-label-field">
          <span>Clip label <em>(AI uses this to assemble)</em></span>
          <input type="text" maxlength="80" data-vcs-label />
        </label>
        <div class="vcs-selected-actions">
          <button type="button" class="btn secondary btn-compact" data-vcs-move="-1">← Earlier</button>
          <button type="button" class="btn secondary btn-compact" data-vcs-move="1">Later →</button>
          <button type="button" class="btn secondary btn-compact" data-vcs-preview-clip>Preview</button>
          <button type="button" class="btn secondary btn-compact" data-vcs-remove>Remove</button>
        </div>
      </div>

      <div class="vcs-assemble" data-vcs-assemble-panel>
        <label class="vcs-label-field">
          <span>Assemble prompt</span>
          <textarea data-vcs-assemble-prompt rows="2" maxlength="400" placeholder="Example: Start with the 3D model tumble, then cut to the printed part in hand."></textarea>
        </label>
        <button type="button" class="btn accent" data-vcs-assemble>Assemble timeline</button>
        <p class="muted small" data-vcs-assemble-hint>Uses labels + order. Leave blank to keep timeline order.</p>
      </div>

      <div data-vcs-effects-host></div>
    </section>
  `;

  const effectsHost = host.querySelector("[data-vcs-effects-host]");
  effectsEditor = mountViewportVideoEditor(effectsHost, {
    getPreviewEl,
    getSourceBlob: () => {
      const primary = clips[0]?.blob || null;
      return primary;
    },
    onOutputBlob: (blob) => {
      if (!blob) return;
      // Replace first/primary assembled clip or push as polished output
      onOutputBlob?.(blob);
      if (clips.length === 1) {
        void replaceClipBlob(clips[0].id, blob);
      }
    },
    onStatus,
  });

  function freeTrialBlocked() {
    try {
      return typeof isFreeTrialCredits === "function" ? !!isFreeTrialCredits() : !!isFreeTrialCredits;
    } catch {
      return false;
    }
  }

  function syncAssembleAvailability() {
    const blocked = freeTrialBlocked();
    const panel = host.querySelector("[data-vcs-assemble-panel]");
    const promptEl = host.querySelector("[data-vcs-assemble-prompt]");
    const btn = host.querySelector("[data-vcs-assemble]");
    const hint = host.querySelector("[data-vcs-assemble-hint]");
    if (promptEl) {
      promptEl.disabled = blocked;
      promptEl.placeholder = blocked
        ? "Assemble prompt isn’t available on free trial credits."
        : "Example: Start with the 3D model tumble, then cut to the printed part in hand.";
    }
    if (btn) {
      btn.disabled = blocked;
      btn.title = blocked
        ? "Buy credits or add your own API key to assemble clips for X."
        : "";
    }
    if (hint) {
      hint.textContent = blocked
        ? "Free trial credits can’t use Assemble for X sharing. Use a single clip, or buy credits / add your own key."
        : "Uses labels + order. Leave blank to keep timeline order.";
    }
    panel?.classList.toggle("vcs-assemble--blocked", blocked);
  }

  function selected() {
    return clips.find((c) => c.id === selectedId) || null;
  }

  function syncMeta() {
    const meta = host.querySelector("[data-vcs-meta]");
    if (meta) {
      meta.textContent = clips.length
        ? `${clips.length} clip${clips.length === 1 ? "" : "s"} on timeline`
        : "Add clips, label them, then assemble";
    }
  }

  function renderTimeline() {
    const el = host.querySelector("[data-vcs-timeline]");
    if (!el) return;
    if (!clips.length) {
      el.innerHTML = `<div class="vcs-empty">Timeline is empty — record 3D, webcam, upload, or scan Phone QR.</div>`;
      host.querySelector("[data-vcs-selected]")?.classList.add("hidden");
      syncMeta();
      return;
    }
    el.innerHTML = clips.map((c, i) => `
      <button type="button" class="vcs-clip${c.id === selectedId ? " is-selected" : ""}" data-vcs-clip="${escapeHtml(c.id)}">
        <span class="vcs-clip-ord">${i + 1}</span>
        <span class="vcs-clip-src">${escapeHtml(sourceLabel(c.source))}</span>
        <span class="vcs-clip-label">${escapeHtml(c.label || "Untitled")}</span>
        <span class="vcs-clip-dur">${c.duration ? `${c.duration.toFixed(1)}s` : "—"}</span>
      </button>
    `).join("");
    syncSelectedPanel();
    syncMeta();
  }

  function syncSelectedPanel() {
    const panel = host.querySelector("[data-vcs-selected]");
    const clip = selected();
    if (!panel) return;
    if (!clip) {
      panel.classList.add("hidden");
      return;
    }
    panel.classList.remove("hidden");
    const input = panel.querySelector("[data-vcs-label]");
    if (input && input.value !== clip.label) input.value = clip.label;
  }

  async function addClip({ blob, source, label, remote }) {
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    const duration = await probeDuration(blob);
    const clip = {
      id: uid(),
      source: source || "upload",
      label: String(label || sourceLabel(source) + " clip").slice(0, 80),
      blob,
      url,
      duration,
      remote: remote || null,
    };
    clips.push(clip);
    selectedId = clip.id;
    renderTimeline();
    previewClip(clip);
    // Keep effects source on first clip until assemble
    if (clips.length === 1) {
      effectsEditor?.setSource?.(blob);
      onOutputBlob?.(blob);
    }
    onStatus?.(`Added “${clip.label}”`);
    return clip;
  }

  async function replaceClipBlob(id, blob) {
    const clip = clips.find((c) => c.id === id);
    if (!clip || !blob) return;
    if (clip.url) URL.revokeObjectURL(clip.url);
    clip.blob = blob;
    clip.url = URL.createObjectURL(blob);
    clip.duration = await probeDuration(blob);
    renderTimeline();
  }

  function previewClip(clip) {
    const el = getPreviewEl?.();
    if (!el || !clip?.url) return;
    el.src = clip.url;
    el.muted = false;
    el.playbackRate = 1;
    el.style.filter = "none";
    el.classList.remove("vve-preview-vignette", "vve-preview-fade");
  }

  function removeSelected() {
    const clip = selected();
    if (!clip) return;
    if (clip.url) URL.revokeObjectURL(clip.url);
    clips = clips.filter((c) => c.id !== clip.id);
    selectedId = clips[0]?.id || null;
    renderTimeline();
    if (clips[0]) {
      previewClip(clips[0]);
      effectsEditor?.setSource?.(clips[0].blob);
      onOutputBlob?.(clips[0].blob);
    } else {
      onOutputBlob?.(null);
    }
    onStatus?.("Clip removed.");
  }

  function moveSelected(delta) {
    const idx = clips.findIndex((c) => c.id === selectedId);
    if (idx < 0) return;
    const next = idx + delta;
    if (next < 0 || next >= clips.length) return;
    const copy = clips.slice();
    const [item] = copy.splice(idx, 1);
    copy.splice(next, 0, item);
    clips = copy;
    renderTimeline();
  }

  async function closeWebcam() {
    try {
      webcamRecorder?.stop?.();
    } catch (_) {}
    webcamRecorder = null;
    webcamStream?.getTracks?.().forEach((t) => t.stop());
    webcamStream = null;
    host.querySelector("[data-vcs-webcam]")?.classList.add("hidden");
  }

  async function openWebcam() {
    await closeWebcam();
    try {
      webcamStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      });
    } catch (err) {
      onStatus?.(err?.message || "Webcam permission denied.", true);
      return;
    }
    const panel = host.querySelector("[data-vcs-webcam]");
    const video = host.querySelector("[data-vcs-webcam-preview]");
    panel?.classList.remove("hidden");
    if (video) {
      video.srcObject = webcamStream;
      video.muted = true;
      await video.play().catch(() => {});
    }
    onStatus?.("Webcam ready — record a labeled take.");
  }

  function pickMime() {
    const candidates = [
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp8,opus",
      "video/webm",
      "video/mp4",
    ];
    return candidates.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
  }

  function startWebcamRecord() {
    if (!webcamStream || webcamRecorder) return;
    webcamChunks = [];
    const mime = pickMime();
    try {
      webcamRecorder = mime
        ? new MediaRecorder(webcamStream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
        : new MediaRecorder(webcamStream, { videoBitsPerSecond: 8_000_000 });
    } catch (err) {
      onStatus?.(err?.message || "Could not record webcam.", true);
      return;
    }
    webcamRecorder.ondataavailable = (e) => {
      if (e.data?.size) webcamChunks.push(e.data);
    };
    webcamRecorder.onstop = () => {
      const type = webcamRecorder?.mimeType || mime || "video/webm";
      const blob = new Blob(webcamChunks, { type });
      webcamChunks = [];
      webcamRecorder = null;
      host.querySelector("[data-vcs-webcam-rec]")?.classList.remove("hidden");
      host.querySelector("[data-vcs-webcam-stop]")?.classList.add("hidden");
      const label = host.querySelector("[data-vcs-webcam-label]")?.value?.trim() || "Webcam take";
      if (blob.size) void addClip({ blob, source: "webcam", label });
    };
    webcamRecorder.start(250);
    host.querySelector("[data-vcs-webcam-rec]")?.classList.add("hidden");
    host.querySelector("[data-vcs-webcam-stop]")?.classList.remove("hidden");
    onStatus?.("Webcam recording…");
  }

  function stopWebcamRecord() {
    if (webcamRecorder && webcamRecorder.state !== "inactive") webcamRecorder.stop();
  }

  async function ensureCaptureSession() {
    const token = typeof getToken === "function" ? getToken() : null;
    if (!token) throw new Error("Sign in to link phone clips.");
    if (captureToken) return captureToken;
    const res = await fetch("/api/video/capture-sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        project_id: getProjectId?.() || null,
        hint: "Record the printed part (or any B-roll) and label it for the desktop editor.",
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.detail || "Could not start phone capture.");
    captureToken = data.token;
    knownRemoteIds = new Set((data.clips || []).map((c) => c.id));
    return captureToken;
  }

  async function showPhoneQr() {
    try {
      const token = await ensureCaptureSession();
      const panel = host.querySelector("[data-vcs-phone]");
      const img = host.querySelector("[data-vcs-phone-qr]");
      const link = host.querySelector("[data-vcs-phone-link]");
      const auth = typeof getToken === "function" ? getToken() : null;
      const sessionRes = await fetch(`/api/video/capture-sessions/${encodeURIComponent(token)}`, {
        headers: auth ? { Authorization: `Bearer ${auth}` } : {},
      });
      const session = await sessionRes.json().catch(() => ({}));
      const url = session.capture_url
        || `${location.origin}/capture.html?t=${encodeURIComponent(token)}`;
      if (img) img.src = `/api/video/capture-sessions/${encodeURIComponent(token)}/qr.png?t=${Date.now()}`;
      if (link) {
        link.href = url;
        link.textContent = url.replace(/^https?:\/\//, "");
      }
      panel?.classList.remove("hidden");
      startCapturePoll();
      onStatus?.("Scan the QR with your phone to add a labeled clip.");
    } catch (err) {
      onStatus?.(err?.message || "Could not open phone capture.", true);
    }
  }

  function stopCapturePoll() {
    if (capturePoll) {
      clearInterval(capturePoll);
      capturePoll = 0;
    }
  }

  function startCapturePoll() {
    stopCapturePoll();
    capturePoll = window.setInterval(() => { void pullRemoteClips(); }, 3000);
    void pullRemoteClips();
  }

  async function pullRemoteClips() {
    if (!captureToken) return;
    try {
      const res = await fetch(`/api/video/capture-sessions/${encodeURIComponent(captureToken)}`);
      if (!res.ok) return;
      const data = await res.json();
      const status = host.querySelector("[data-vcs-phone-status]");
      if (status) status.textContent = `${data.clip_count || 0} phone clip(s) on session`;
      for (const remote of data.clips || []) {
        if (knownRemoteIds.has(remote.id)) continue;
        knownRemoteIds.add(remote.id);
        const fileRes = await fetch(
          `/api/video/capture-sessions/${encodeURIComponent(captureToken)}/clips/${encodeURIComponent(remote.id)}`,
        );
        if (!fileRes.ok) continue;
        const blob = await fileRes.blob();
        await addClip({
          blob,
          source: remote.source || "phone",
          label: remote.label || "Phone clip",
          remote,
        });
      }
    } catch (_) {
      /* polling best-effort */
    }
  }

  async function assembleTimeline() {
    if (freeTrialBlocked()) {
      onStatus?.(
        "Assemble prompt isn’t available on free trial credits. Buy credits or add your own key to assemble clips for X.",
        true,
      );
      syncAssembleAvailability();
      return;
    }
    if (!clips.length) {
      onStatus?.("Add at least one clip first.", true);
      return;
    }
    const prompt = host.querySelector("[data-vcs-assemble-prompt]")?.value || "";
    const orderIds = parseAssembleOrder(prompt, clips);
    const ordered = orderIds.map((id) => clips.find((c) => c.id === id)).filter(Boolean);
    if (ordered.length === 1) {
      effectsEditor?.setSource?.(ordered[0].blob);
      onOutputBlob?.(ordered[0].blob);
      previewClip(ordered[0]);
      onStatus?.("Single clip — set as output. Polish below if needed.");
      return;
    }

    const auth = typeof getToken === "function" ? getToken() : null;
    if (!auth) {
      onStatus?.("Sign in to assemble multiple clips.", true);
      return;
    }

    const btn = host.querySelector("[data-vcs-assemble]");
    if (btn) btn.disabled = true;
    onStatus?.("Assembling timeline…");
    try {
      const form = new FormData();
      form.append("format", "webm");
      for (const clip of ordered) {
        const ext = (clip.blob.type || "").includes("mp4") ? "mp4" : "webm";
        form.append("clips", clip.blob, `${clip.id}.${ext}`);
      }
      const res = await fetch("/api/video/assemble", {
        method: "POST",
        headers: { Authorization: `Bearer ${auth}` },
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.detail || "Assemble failed.");
      }
      const blob = new Blob([await res.arrayBuffer()], {
        type: res.headers.get("content-type") || "video/webm",
      });
      // Replace timeline with assembled master + keep originals? Keep originals, set output.
      effectsEditor?.setSource?.(blob);
      onOutputBlob?.(blob);
      const preview = getPreviewEl?.();
      if (preview) {
        const url = URL.createObjectURL(blob);
        preview.src = url;
        preview.onloadeddata = () => setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      const hint = host.querySelector("[data-vcs-assemble-hint]");
      if (hint) {
        hint.textContent = `Assembled ${ordered.length} clips: ${ordered.map((c) => c.label).join(" → ")}`;
      }
      // Also offer the assembled result as a new timeline clip
      await addClip({
        blob,
        source: "viewport",
        label: prompt.trim() ? `Assembled: ${prompt.trim().slice(0, 48)}` : "Assembled master",
      });
      onStatus?.("Timeline assembled — polish or download.");
    } catch (err) {
      onStatus?.(err?.message || "Could not assemble.", true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  host.addEventListener("click", (e) => {
    const add = e.target.closest("[data-vcs-add]");
    if (add) {
      const kind = add.dataset.vcsAdd;
      if (kind === "webcam") void openWebcam();
      else if (kind === "upload") host.querySelector("[data-vcs-file]")?.click();
      else if (kind === "phone") void showPhoneQr();
      else if (kind === "viewport") onRequestViewportRecord?.();
      return;
    }
    const clipBtn = e.target.closest("[data-vcs-clip]");
    if (clipBtn) {
      selectedId = clipBtn.dataset.vcsClip;
      renderTimeline();
      const clip = selected();
      if (clip) previewClip(clip);
      return;
    }
    if (e.target.closest("[data-vcs-webcam-rec]")) {
      startWebcamRecord();
      return;
    }
    if (e.target.closest("[data-vcs-webcam-stop]")) {
      stopWebcamRecord();
      return;
    }
    if (e.target.closest("[data-vcs-webcam-close]")) {
      void closeWebcam();
      return;
    }
    if (e.target.closest("[data-vcs-phone-close]")) {
      host.querySelector("[data-vcs-phone]")?.classList.add("hidden");
      return;
    }
    if (e.target.closest("[data-vcs-phone-refresh]")) {
      void pullRemoteClips();
      return;
    }
    if (e.target.closest("[data-vcs-remove]")) {
      removeSelected();
      return;
    }
    if (e.target.closest("[data-vcs-preview-clip]")) {
      const clip = selected();
      if (clip) previewClip(clip);
      return;
    }
    const move = e.target.closest("[data-vcs-move]");
    if (move) {
      moveSelected(Number(move.dataset.vcsMove) || 0);
      return;
    }
    if (e.target.closest("[data-vcs-assemble]")) {
      void assembleTimeline();
    }
  });

  syncAssembleAvailability();

  host.querySelector("[data-vcs-file]")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const label = file.name.replace(/\.[^.]+$/, "") || "Uploaded clip";
    await addClip({ blob: file, source: "upload", label });
  });

  host.querySelector("[data-vcs-label]")?.addEventListener("input", (e) => {
    const clip = selected();
    if (!clip) return;
    clip.label = String(e.target.value || "").slice(0, 80) || "Untitled";
    renderTimeline();
  });

  renderTimeline();

  return {
    setPrimaryClip(blob, { label = "3D viewport", source = "viewport" } = {}) {
      // Reset studio around a new primary viewport recording
      for (const c of clips) {
        if (c.url) URL.revokeObjectURL(c.url);
      }
      clips = [];
      selectedId = null;
      effectsEditor?.setSource?.(blob);
      if (blob) {
        void addClip({ blob, source, label });
      } else {
        renderTimeline();
      }
    },
    addClip,
    getClips: () => clips.map((c) => ({ ...c })),
    syncAssembleAvailability,
    getOutputBlob: () => effectsEditor?.getOutputBlob?.() || clips[0]?.blob || null,
    needsBake: () => effectsEditor?.needsBake?.() || false,
    ensureBaked: async () => {
      if (effectsEditor?.needsBake?.()) return effectsEditor.ensureBaked();
      return effectsEditor?.getOutputBlob?.() || clips[0]?.blob || null;
    },
    getState: () => effectsEditor?.getState?.() || null,
    destroy() {
      stopCapturePoll();
      void closeWebcam();
      for (const c of clips) {
        if (c.url) URL.revokeObjectURL(c.url);
      }
      clips = [];
      effectsEditor?.destroy?.();
      host.innerHTML = "";
    },
  };
}

// re-export for convenience
export { parseVideoEditPrompt };
