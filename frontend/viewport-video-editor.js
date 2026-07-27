/**
 * Built-in clip editor for viewport recordings — audio keep/hide,
 * quick effects, and a natural-language prompt that maps to those tools.
 * All processing stays in the browser (canvas + MediaRecorder).
 */

const GRADES = {
  none: { filter: "none", label: "Original" },
  warm: { filter: "sepia(0.28) saturate(1.2) contrast(1.05) brightness(1.03)", label: "Warm" },
  cool: { filter: "hue-rotate(195deg) saturate(1.15) brightness(1.02)", label: "Cool" },
  vivid: { filter: "saturate(1.45) contrast(1.12) brightness(1.04)", label: "Vivid" },
  noir: { filter: "grayscale(1) contrast(1.2) brightness(0.95)", label: "Noir" },
};

const EFFECT_TOOLS = [
  { id: "fade", label: "Fade", hint: "Fade in & out" },
  { id: "vignette", label: "Vignette", hint: "Soft edge darken" },
  { id: "slow", label: "Slow‑mo", hint: "0.6× speed" },
  { id: "title", label: "Title", hint: "Opening title card" },
];

const HISTORY_MAX = 40;

function clamp01(n) {
  return Math.max(0, Math.min(1, Number(n) || 0));
}

function defaultState() {
  return {
    keepAudio: true,
    grade: "none",
    effects: { fade: false, vignette: false, slow: false, title: false },
    titleText: "loading Render Studio",
    baking: false,
  };
}

function cloneEditorState(state) {
  return {
    keepAudio: !!state.keepAudio,
    grade: state.grade || "none",
    effects: {
      fade: !!state.effects?.fade,
      vignette: !!state.effects?.vignette,
      slow: !!state.effects?.slow,
      title: !!state.effects?.title,
    },
    titleText: String(state.titleText || "loading Render Studio").slice(0, 80),
  };
}

function statesEqual(a, b) {
  if (!a || !b) return false;
  return a.keepAudio === b.keepAudio
    && a.grade === b.grade
    && a.titleText === b.titleText
    && a.effects.fade === b.effects.fade
    && a.effects.vignette === b.effects.vignette
    && a.effects.slow === b.effects.slow
    && a.effects.title === b.effects.title;
}

/** Map a freeform prompt to editor settings (local, instant). */
export function parseVideoEditPrompt(raw = "") {
  const text = String(raw || "").trim();
  const lower = text.toLowerCase();
  const plan = {
    keepAudio: null,
    grade: null,
    effects: {},
    titleText: null,
    summary: [],
  };
  if (!text) return plan;

  if (/\b(mute|silent|no audio|hide audio|without (audio|sound)|strip audio)\b/.test(lower)) {
    plan.keepAudio = false;
    plan.summary.push("hide audio");
  } else if (/\b(keep audio|with audio|with sound|unmute)\b/.test(lower)) {
    plan.keepAudio = true;
    plan.summary.push("keep audio");
  }

  if (/\b(warm|golden|sunset|amber)\b/.test(lower)) {
    plan.grade = "warm";
    plan.summary.push("warm grade");
  } else if (/\b(cool|blue|icy|cold)\b/.test(lower)) {
    plan.grade = "cool";
    plan.summary.push("cool grade");
  } else if (/\b(vivid|punchy|saturated|pop)\b/.test(lower)) {
    plan.grade = "vivid";
    plan.summary.push("vivid grade");
  } else if (/\b(noir|bw|b&w|black and white|monochrome|desaturat)\b/.test(lower)) {
    plan.grade = "noir";
    plan.summary.push("noir grade");
  } else if (/\b(original|reset color|no grade|natural)\b/.test(lower)) {
    plan.grade = "none";
    plan.summary.push("original color");
  }

  if (/\bfade\b/.test(lower)) {
    plan.effects.fade = true;
    plan.summary.push("fade");
  }
  if (/\bvignette\b/.test(lower)) {
    plan.effects.vignette = true;
    plan.summary.push("vignette");
  }
  if (/\b(slow[\s-]?mo|slow motion|slower|0\.5x|half speed)\b/.test(lower)) {
    plan.effects.slow = true;
    plan.summary.push("slow‑mo");
  }
  if (/\b(normal speed|1x|full speed)\b/.test(lower)) {
    plan.effects.slow = false;
    plan.summary.push("normal speed");
  }

  const titleQuoted = text.match(/\btitle\s*[:=]\s*["“']([^"”']+)["”']/i)
    || text.match(/\b(?:add|with)\s+title\s+["“']([^"”']+)["”']/i)
    || text.match(/\btitle\s*[:=]\s*([^,"”'\n]+)/i)
    || text.match(/\btitle\s+(.+)$/i);
  if (titleQuoted?.[1]) {
    plan.effects.title = true;
    plan.titleText = titleQuoted[1].trim().slice(0, 80);
    plan.summary.push(`title “${plan.titleText}”`);
  } else if (/\b(title card|add title|opening title)\b/.test(lower)) {
    plan.effects.title = true;
    plan.titleText = "loading Render Studio";
    plan.summary.push("title card");
  }

  if (/\b(cinematic|film look)\b/.test(lower)) {
    plan.grade = plan.grade || "warm";
    plan.effects.fade = true;
    plan.effects.vignette = true;
    plan.summary.push("cinematic");
  }

  return plan;
}

function cssFilterForState(state) {
  return GRADES[state.grade]?.filter || "none";
}

/**
 * Re-encode a blob through canvas with optional audio strip and effects.
 */
export async function renderEditedClip(sourceBlob, state = {}, { onProgress } = {}) {
  if (!sourceBlob) throw new Error("No clip to edit.");
  const keepAudio = state.keepAudio !== false;
  const grade = state.grade || "none";
  const effects = state.effects || {};
  const titleText = String(state.titleText || "loading Render Studio").slice(0, 80);
  const needsBake = !keepAudio
    || grade !== "none"
    || effects.fade
    || effects.vignette
    || effects.slow
    || effects.title;

  if (!needsBake) return sourceBlob;

  const url = URL.createObjectURL(sourceBlob);
  const video = document.createElement("video");
  video.src = url;
  video.playsInline = true;
  video.muted = true;
  video.preload = "auto";

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("Could not load clip for editing."));
  });

  const w = Math.max(2, video.videoWidth || 1280);
  const h = Math.max(2, video.videoHeight || 720);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas unavailable for video edit.");

  const playbackRate = effects.slow ? 0.6 : 1;
  video.playbackRate = playbackRate;

  const fps = 30;
  const outStream = canvas.captureStream(fps);
  const tracks = [...outStream.getVideoTracks()];

  if (keepAudio) {
    try {
      const captured = typeof video.captureStream === "function"
        ? video.captureStream()
        : (typeof video.mozCaptureStream === "function" ? video.mozCaptureStream() : null);
      const audioTracks = captured?.getAudioTracks?.() || [];
      for (const t of audioTracks) tracks.push(t);
    } catch {
      /* preview-only mute path if captureStream audio fails */
    }
  }

  const mimeCandidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm",
  ];
  const mimeType = mimeCandidates.find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || "";
  const mixed = new MediaStream(tracks);
  const recorder = mimeType
    ? new MediaRecorder(mixed, { mimeType, videoBitsPerSecond: 10_000_000 })
    : new MediaRecorder(mixed, { videoBitsPerSecond: 10_000_000 });

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data?.size) chunks.push(e.data);
  };

  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  const filter = cssFilterForState({ grade });

  const drawFrame = () => {
    const t = video.currentTime || 0;
    const dur = duration || Math.max(t, 0.001);
    ctx.filter = filter;
    ctx.drawImage(video, 0, 0, w, h);
    ctx.filter = "none";

    if (effects.vignette) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.72);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.55)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    if (effects.fade) {
      const fadeSecs = Math.min(0.85, dur * 0.12);
      let alpha = 0;
      if (t < fadeSecs) alpha = 1 - t / fadeSecs;
      else if (t > dur - fadeSecs) alpha = (t - (dur - fadeSecs)) / fadeSecs;
      if (alpha > 0) {
        ctx.fillStyle = `rgba(0,0,0,${clamp01(alpha)})`;
        ctx.fillRect(0, 0, w, h);
      }
    }

    if (effects.title && t < Math.min(2.2, dur * 0.35)) {
      const titleAlpha = t < 0.25 ? t / 0.25 : t > 1.7 ? clamp01((2.2 - t) / 0.5) : 1;
      ctx.fillStyle = `rgba(0,0,0,${0.42 * titleAlpha})`;
      ctx.fillRect(0, h * 0.62, w, h * 0.28);
      ctx.fillStyle = `rgba(255,255,255,${0.95 * titleAlpha})`;
      ctx.font = `600 ${Math.round(h * 0.055)}px "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(titleText, w / 2, h * 0.76, w * 0.86);
    }

    if (duration) onProgress?.(clamp01(t / duration));
  };

  const done = new Promise((resolve, reject) => {
    recorder.onerror = () => reject(new Error("Could not encode edited clip."));
    recorder.onstop = () => {
      const type = recorder.mimeType || mimeType || "video/webm";
      resolve(new Blob(chunks, { type }));
    };
  });

  recorder.start(200);
  video.currentTime = 0;
  await video.play().catch(() => {});

  await new Promise((resolve) => {
    const tick = () => {
      if (video.ended || video.paused) {
        drawFrame();
        resolve();
        return;
      }
      drawFrame();
      requestAnimationFrame(tick);
    };
    video.onended = () => resolve();
    requestAnimationFrame(tick);
    // Safety timeout for odd durations
    const ms = ((duration || 30) / playbackRate) * 1000 + 4000;
    setTimeout(resolve, ms);
  });

  try {
    video.pause();
  } catch (_) {}
  if (recorder.state !== "inactive") recorder.stop();
  const out = await done;
  URL.revokeObjectURL(url);
  outStream.getTracks().forEach((t) => t.stop());
  onProgress?.(1);
  if (!out.size) throw new Error("Edited clip was empty.");
  return out;
}

/**
 * Mount the editor UI into the share modal host element.
 */
export function mountViewportVideoEditor(host, {
  getPreviewEl,
  getSourceBlob,
  onOutputBlob,
  onStatus,
} = {}) {
  if (!host) return { destroy() {}, getState() { return null; }, bake() { return Promise.resolve(null); } };

  let state = defaultState();
  let sourceBlob = getSourceBlob?.() || null;
  let outputBlob = sourceBlob;
  const undoStack = [];
  const redoStack = [];

  host.innerHTML = `
    <section class="vve" aria-label="Clip editor">
      <div class="vve-head">
        <div>
          <p class="vve-eyebrow">AI clip editor</p>
          <h3 class="vve-title">Polish before you share</h3>
        </div>
        <div class="vve-head-actions">
          <div class="vve-history" role="group" aria-label="History">
            <button type="button" class="vve-history-btn" data-vve-undo title="Undo (Ctrl/⌘Z)" disabled>Undo</button>
            <button type="button" class="vve-history-btn" data-vve-redo title="Redo (Ctrl/⌘⇧Z)" disabled>Redo</button>
          </div>
          <span class="vve-live" data-vve-live>Live preview</span>
        </div>
      </div>

      <div class="vve-audio" role="group" aria-label="Audio">
        <span class="vve-label">Audio</span>
        <div class="vve-seg">
          <button type="button" class="vve-seg-btn is-active" data-vve-audio="keep">Keep audio</button>
          <button type="button" class="vve-seg-btn" data-vve-audio="hide">Hide audio</button>
        </div>
      </div>

      <div class="vve-block">
        <span class="vve-label">Look</span>
        <div class="vve-chips" data-vve-grades>
          ${Object.entries(GRADES).map(([id, meta]) => `
            <button type="button" class="vve-chip${id === "none" ? " is-active" : ""}" data-vve-grade="${id}">${meta.label}</button>
          `).join("")}
        </div>
      </div>

      <div class="vve-block">
        <span class="vve-label">Tools</span>
        <div class="vve-chips" data-vve-tools>
          ${EFFECT_TOOLS.map((t) => `
            <button type="button" class="vve-chip" data-vve-tool="${t.id}" title="${t.hint}">${t.label}</button>
          `).join("")}
        </div>
      </div>

      <label class="vve-title-field hidden" data-vve-title-wrap>
        <span>Title text</span>
        <input type="text" maxlength="80" data-vve-title-input value="loading Render Studio" />
      </label>

      <div class="vve-prompt">
        <div class="vve-prompt-row">
          <input type="text" data-vve-prompt placeholder='Try “cinematic, mute audio, title: Launch day”' maxlength="200" autocomplete="off" spellcheck="false" />
          <button type="button" class="btn accent vve-prompt-go" data-vve-prompt-go>Edit</button>
        </div>
        <p class="vve-prompt-hint muted small" data-vve-prompt-hint>Prompt applies tools instantly — then bake before download / X.</p>
      </div>

      <div class="vve-actions">
        <button type="button" class="btn secondary" data-vve-reset>Reset</button>
        <button type="button" class="btn accent" data-vve-bake>Apply to clip</button>
      </div>
      <div class="vve-progress hidden" data-vve-progress>
        <div class="vve-progress-bar" data-vve-progress-bar></div>
      </div>
    </section>
  `;

  const preview = () => getPreviewEl?.() || null;

  function syncHistoryUi() {
    const undoBtn = host.querySelector("[data-vve-undo]");
    const redoBtn = host.querySelector("[data-vve-redo]");
    if (undoBtn) undoBtn.disabled = undoStack.length === 0;
    if (redoBtn) redoBtn.disabled = redoStack.length === 0;
  }

  function pushHistory() {
    const snap = cloneEditorState(state);
    const last = undoStack[undoStack.length - 1];
    if (last && statesEqual(last, snap)) return;
    undoStack.push(snap);
    if (undoStack.length > HISTORY_MAX) undoStack.shift();
    redoStack.length = 0;
    syncHistoryUi();
  }

  function restoreSnapshot(snap) {
    if (!snap) return;
    state.keepAudio = !!snap.keepAudio;
    state.grade = snap.grade || "none";
    state.effects = {
      fade: !!snap.effects?.fade,
      vignette: !!snap.effects?.vignette,
      slow: !!snap.effects?.slow,
      title: !!snap.effects?.title,
    };
    state.titleText = String(snap.titleText || "loading Render Studio").slice(0, 80);
    syncUi();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(cloneEditorState(state));
    restoreSnapshot(undoStack.pop());
    syncHistoryUi();
    onStatus?.("Undid clip edit.");
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(cloneEditorState(state));
    restoreSnapshot(redoStack.pop());
    syncHistoryUi();
    onStatus?.("Redid clip edit.");
  }

  function syncPreview() {
    const el = preview();
    if (!el) return;
    el.style.filter = cssFilterForState(state);
    el.muted = !state.keepAudio;
    el.playbackRate = state.effects.slow ? 0.6 : 1;
    el.classList.toggle("vve-preview-vignette", !!state.effects.vignette);
    el.classList.toggle("vve-preview-fade", !!state.effects.fade);
  }

  function syncUi() {
    host.querySelectorAll("[data-vve-audio]").forEach((btn) => {
      const keep = btn.dataset.vveAudio === "keep";
      btn.classList.toggle("is-active", keep ? state.keepAudio : !state.keepAudio);
    });
    host.querySelectorAll("[data-vve-grade]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.vveGrade === state.grade);
    });
    host.querySelectorAll("[data-vve-tool]").forEach((btn) => {
      const id = btn.dataset.vveTool;
      btn.classList.toggle("is-active", !!state.effects[id]);
    });
    const titleWrap = host.querySelector("[data-vve-title-wrap]");
    titleWrap?.classList.toggle("hidden", !state.effects.title);
    const titleInput = host.querySelector("[data-vve-title-input]");
    if (titleInput && titleInput.value !== state.titleText) titleInput.value = state.titleText;
    syncPreview();
    syncHistoryUi();
  }

  function setOutput(blob) {
    outputBlob = blob;
    onOutputBlob?.(blob);
  }

  function applyPlan(plan, { recordHistory = true } = {}) {
    if (recordHistory) pushHistory();
    if (plan.keepAudio != null) state.keepAudio = !!plan.keepAudio;
    if (plan.grade) state.grade = plan.grade;
    if (plan.effects) {
      for (const [k, v] of Object.entries(plan.effects)) {
        if (v == null) continue;
        state.effects[k] = !!v;
      }
    }
    if (plan.titleText) state.titleText = plan.titleText;
    syncUi();
    const hint = host.querySelector("[data-vve-prompt-hint]");
    if (hint) {
      hint.textContent = plan.summary?.length
        ? `Applied: ${plan.summary.join(" · ")}. Click Apply to clip to bake.`
        : "No matching tools — try mute, warm, fade, vignette, slow‑mo, or title: …";
    }
  }

  async function bake() {
    sourceBlob = getSourceBlob?.() || sourceBlob;
    if (!sourceBlob) {
      onStatus?.("Record a clip first.", true);
      return null;
    }
    if (state.baking) return null;
    state.baking = true;
    const bakeBtn = host.querySelector("[data-vve-bake]");
    const progress = host.querySelector("[data-vve-progress]");
    const bar = host.querySelector("[data-vve-progress-bar]");
    if (bakeBtn) bakeBtn.disabled = true;
    progress?.classList.remove("hidden");
    if (bar) bar.style.width = "4%";
    onStatus?.("Baking edit…");
    try {
      const blob = await renderEditedClip(sourceBlob, state, {
        onProgress: (p) => {
          if (bar) bar.style.width = `${Math.round(clamp01(p) * 100)}%`;
        },
      });
      setOutput(blob);
      const el = preview();
      if (el) {
        const url = URL.createObjectURL(blob);
        el.src = url;
        el.onloadeddata = () => setTimeout(() => URL.revokeObjectURL(url), 60_000);
        el.style.filter = "none";
        el.classList.remove("vve-preview-vignette", "vve-preview-fade");
        el.muted = !state.keepAudio;
        el.playbackRate = 1;
      }
      // After bake, treat as new source baseline with effects visually applied
      pushHistory();
      sourceBlob = blob;
      state.grade = "none";
      state.effects = { fade: false, vignette: false, slow: false, title: false };
      // Audio already stripped into the baked blob when hidden.
      if (!state.keepAudio) state.keepAudio = true;
      syncUi();
      onStatus?.("Edit applied to clip.");
      return blob;
    } catch (err) {
      onStatus?.(err?.message || "Could not apply edit.", true);
      return null;
    } finally {
      state.baking = false;
      if (bakeBtn) bakeBtn.disabled = false;
      progress?.classList.add("hidden");
    }
  }

  host.addEventListener("click", (e) => {
    if (e.target.closest("[data-vve-undo]")) {
      undo();
      return;
    }
    if (e.target.closest("[data-vve-redo]")) {
      redo();
      return;
    }
    const audioBtn = e.target.closest("[data-vve-audio]");
    if (audioBtn) {
      const next = audioBtn.dataset.vveAudio === "keep";
      if (next === state.keepAudio) return;
      pushHistory();
      state.keepAudio = next;
      syncUi();
      onStatus?.(state.keepAudio ? "Audio kept for export." : "Audio will be hidden on Apply / share.");
      return;
    }
    const gradeBtn = e.target.closest("[data-vve-grade]");
    if (gradeBtn) {
      const next = gradeBtn.dataset.vveGrade || "none";
      if (next === state.grade) return;
      pushHistory();
      state.grade = next;
      syncUi();
      return;
    }
    const toolBtn = e.target.closest("[data-vve-tool]");
    if (toolBtn) {
      const id = toolBtn.dataset.vveTool;
      pushHistory();
      state.effects[id] = !state.effects[id];
      syncUi();
      return;
    }
    if (e.target.closest("[data-vve-prompt-go]")) {
      const input = host.querySelector("[data-vve-prompt]");
      applyPlan(parseVideoEditPrompt(input?.value || ""));
      return;
    }
    if (e.target.closest("[data-vve-reset]")) {
      pushHistory();
      state = defaultState();
      sourceBlob = getSourceBlob?.() || sourceBlob;
      setOutput(sourceBlob);
      const el = preview();
      if (el && sourceBlob) {
        const url = URL.createObjectURL(sourceBlob);
        el.src = url;
        el.onloadeddata = () => setTimeout(() => URL.revokeObjectURL(url), 60_000);
        el.style.filter = "none";
        el.classList.remove("vve-preview-vignette", "vve-preview-fade");
      }
      const prompt = host.querySelector("[data-vve-prompt]");
      if (prompt) prompt.value = "";
      const hint = host.querySelector("[data-vve-prompt-hint]");
      if (hint) hint.textContent = "Prompt applies tools instantly — then bake before download / X.";
      syncUi();
      onStatus?.("Editor reset.");
      return;
    }
    if (e.target.closest("[data-vve-bake]")) {
      void bake();
    }
  });

  host.querySelector("[data-vve-prompt]")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      host.querySelector("[data-vve-prompt-go]")?.click();
    }
  });

  let titleDebounce = 0;
  host.querySelector("[data-vve-title-input]")?.addEventListener("focus", () => {
    host.dataset.vveTitleBaseline = JSON.stringify(cloneEditorState(state));
  });
  host.querySelector("[data-vve-title-input]")?.addEventListener("input", (e) => {
    state.titleText = String(e.target.value || "").slice(0, 80) || "loading Render Studio";
    clearTimeout(titleDebounce);
    titleDebounce = window.setTimeout(() => {
      try {
        const baseline = JSON.parse(host.dataset.vveTitleBaseline || "null");
        if (baseline && !statesEqual(baseline, cloneEditorState(state))) {
          undoStack.push(baseline);
          if (undoStack.length > HISTORY_MAX) undoStack.shift();
          redoStack.length = 0;
          host.dataset.vveTitleBaseline = JSON.stringify(cloneEditorState(state));
          syncHistoryUi();
        }
      } catch (_) {}
    }, 400);
  });

  function onKeyDown(e) {
    if (host.closest(".hidden")) return;
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const target = e.target;
    if (target instanceof HTMLTextAreaElement) return;
    const key = String(e.key || "").toLowerCase();
    if (key === "z" && e.shiftKey) {
      e.preventDefault();
      redo();
      return;
    }
    if (key === "z") {
      e.preventDefault();
      undo();
      return;
    }
    if (key === "y") {
      e.preventDefault();
      redo();
    }
  }
  document.addEventListener("keydown", onKeyDown);

  syncUi();

  return {
    setSource(blob) {
      sourceBlob = blob;
      outputBlob = blob;
      state = defaultState();
      undoStack.length = 0;
      redoStack.length = 0;
      syncUi();
    },
    getState: () => ({ ...state, effects: { ...state.effects } }),
    getOutputBlob: () => outputBlob,
    needsBake() {
      return !state.keepAudio
        || state.grade !== "none"
        || Object.values(state.effects).some(Boolean);
    },
    async ensureBaked() {
      if (!this.needsBake()) return outputBlob || sourceBlob;
      return bake();
    },
    bake,
    undo,
    redo,
    destroy() {
      document.removeEventListener("keydown", onKeyDown);
      clearTimeout(titleDebounce);
      host.innerHTML = "";
    },
  };
}
