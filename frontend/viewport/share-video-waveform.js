/** SoundCloud-style share-video waveform: bars, playhead, comment avatars. */

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

/** Map comment.t (seconds) onto the waveform as a left % of duration. */
export function commentMarkerLeftPct(t, duration) {
  const dur = Math.max(0.001, Number(duration) || 0.001);
  const time = Math.max(0, Number(t) || 0);
  return Math.min(99.2, Math.max(0.8, (time / dur) * 100));
}

export function commentsDuration(comments, mediaDuration) {
  const media = Number(mediaDuration);
  if (Number.isFinite(media) && media > 0.05) return media;
  let maxT = 1;
  for (const row of Array.isArray(comments) ? comments : []) {
    const t = Number(row?.t ?? row?.time) || 0;
    if (t > maxT) maxT = t;
  }
  return Math.max(1, maxT);
}

export function formatCommentTimeLabel(t) {
  const sec = Math.max(0, Number(t) || 0);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const tenths = Math.floor((sec % 1) * 10);
  if (m > 0) return `${m}:${String(s).padStart(2, "0")}.${tenths}`;
  return `${s}.${tenths}s`;
}

export function playheadPlayedPct(currentTime, duration) {
  const dur = Number(duration);
  if (!Number.isFinite(dur) || dur <= 0) return 0;
  const t = Math.max(0, Number(currentTime) || 0);
  return Math.min(100, (t / dur) * 100);
}

export function seekTimeFromClientX(clientX, rect, duration) {
  const width = Math.max(1, Number(rect?.width) || 1);
  const left = Number(rect?.left) || 0;
  const x = Math.max(0, Math.min(1, (Number(clientX) - left) / width));
  return x * Math.max(0, Number(duration) || 0);
}

export function waveformBarHeights(count = 96, seed = 1) {
  const n = Math.max(24, Math.min(180, Math.round(Number(count) || 96)));
  const bars = [];
  let s = Math.max(1, Math.round(Number(seed) || 1)) * 9973;
  for (let i = 0; i < n; i += 1) {
    s = (s * 16807 + 11) % 2147483647;
    const envelope = 0.28 + 0.72 * Math.sin((i / n) * Math.PI);
    const jitter = 0.22 + ((s % 1000) / 1000) * 0.78;
    bars.push(Math.max(0.12, Math.min(1, envelope * jitter)));
  }
  return bars;
}

export function waveformBarsHtml(heights) {
  return (Array.isArray(heights) ? heights : [])
    .map((h) => `<span style="--h:${Number(h).toFixed(3)}"></span>`)
    .join("");
}

/** Samples inspected per waveform bar. Full-file scans of 44.1kHz PCM freeze Chrome. */
export const WAVEFORM_SAMPLES_PER_BAR = 48;
/** Skip decodeAudioData for huge drops — decoded PCM is ~10× the file and kills the tab. */
export const WAVEFORM_MAX_DECODE_BYTES = 8 * 1024 * 1024;

export function waveformSampleStride(len, count = 140, perBar = WAVEFORM_SAMPLES_PER_BAR) {
  const n = Math.max(1, Math.round(Number(count) || 1));
  const samples = Math.max(0, Number(len) || 0);
  const cap = Math.max(8, Number(perBar) || WAVEFORM_SAMPLES_PER_BAR);
  if (samples <= n * cap) return 1;
  return Math.ceil(samples / (n * cap));
}

/** Per-bar peak (max abs) from PCM so quiet vs loud (lyrics in) is visible. */
export function amplitudePeaksFromSamples(samples, count = 140) {
  const n = Math.max(24, Math.min(320, Math.round(Number(count) || 140)));
  const data = samples && typeof samples.length === "number" ? samples : [];
  const len = data.length;
  if (!len) return Array.from({ length: n }, () => 0.1);
  const raw = [];
  let globalMax = 0;
  const window = len / n;
  const stride = waveformSampleStride(len, n);
  for (let i = 0; i < n; i += 1) {
    const start = Math.floor(i * window);
    const end = Math.max(start + 1, Math.min(len, Math.floor((i + 1) * window)));
    let peak = 0;
    let sumSq = 0;
    let seen = 0;
    for (let j = start; j < end; j += stride) {
      const a = Math.abs(Number(data[j]) || 0);
      if (a > peak) peak = a;
      sumSq += a * a;
      seen += 1;
    }
    const rms = seen > 0 ? Math.sqrt(sumSq / seen) : 0;
    const mixed = peak * 0.72 + rms * 0.28;
    raw.push(mixed);
    if (mixed > globalMax) globalMax = mixed;
  }
  const scale = globalMax > 1e-6 ? 1 / globalMax : 1;
  return raw.map((p) => Math.max(0.08, Math.min(1, p * scale)));
}

export function placeholderAmplitudePeaks(count = 96) {
  const n = Math.max(24, Math.min(180, Math.round(Number(count) || 96)));
  return Array.from({ length: n }, () => 0.16);
}

export async function decodeAudioAmplitudePeaks(blob, { count = 160, signal } = {}) {
  const n = Math.max(24, Math.min(320, Math.round(Number(count) || 160)));
  if (signal?.aborted) return amplitudePeaksFromSamples([], n);
  if (!blob || typeof blob.arrayBuffer !== "function") return amplitudePeaksFromSamples([], n);
  if (Number(blob.size) > WAVEFORM_MAX_DECODE_BYTES) return placeholderAmplitudePeaks(n);
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioCtx) return amplitudePeaksFromSamples([], n);
  const ac = new AudioCtx();
  try {
    if (signal?.aborted) return amplitudePeaksFromSamples([], n);
    const copy = await blob.arrayBuffer();
    if (signal?.aborted) return amplitudePeaksFromSamples([], n);
    const decoded = await new Promise((resolve, reject) => {
      const fail = (err) => reject(err || new Error("decode failed"));
      try {
        const p = ac.decodeAudioData(copy, resolve, fail);
        if (p && typeof p.then === "function") p.then(resolve, fail);
      } catch (err) {
        fail(err);
      }
    });
    if (signal?.aborted) return amplitudePeaksFromSamples([], n);
    const ch = decoded?.getChannelData?.(0);
    return amplitudePeaksFromSamples(ch, n);
  } catch (_) {
    return amplitudePeaksFromSamples([], n);
  } finally {
    try { await ac.close?.(); } catch (_) { /* ignore */ }
  }
}

export const WAVE_CLUSTER_SEC = 0.35;
export const WAVE_MAX_FACES = 3;

export function commentAuthorKey(row = {}) {
  const id = String(row.author_id || row.user_id || row.authorId || "").trim();
  if (id) return `id:${id}`;
  const name = String(row.author_name || row.display_name || row.author || "Guest").trim().toLowerCase() || "guest";
  const avatar = String(row.avatar_url || row.user_avatar_url || row.avatarUrl || "").trim();
  return `name:${name}|${avatar}`;
}

function markerItemFromRow(row) {
  const kindRaw = String(row?.kind || "comment").toLowerCase();
  const tool = String(row?.tool || "").trim();
  const text = String(row?.text || "").trim() || (kindRaw === "markup" || tool ? (tool || "Markup") : "");
  if (!text) return null;
  const t = Math.max(0, Number(row.t ?? row.time) || 0);
  const author = String(row.author_name || row.display_name || "Guest").trim() || "Guest";
  const kind = kindRaw === "markup" || kindRaw === "pin" ? kindRaw : "comment";
  return {
    id: String(row.id || ""),
    t,
    author,
    authorKey: commentAuthorKey(row),
    text,
    kind,
    tool,
    avatarUrl: String(row.avatar_url || row.user_avatar_url || "").trim(),
    initial: (author.charAt(0) || "?").toUpperCase(),
    timeLabel: formatCommentTimeLabel(t),
  };
}

function faceHtml(item) {
  if (item?.avatarUrl) {
    return `<span class="share-wave-avatar" style="background-image:url('${escapeHtml(item.avatarUrl)}')"></span>`;
  }
  return `<span class="share-wave-avatar share-wave-avatar--initial">${escapeHtml(item?.initial || "?")}</span>`;
}

export function commentMarkerModels(comments, duration) {
  const rows = Array.isArray(comments) ? comments : [];
  const dur = commentsDuration(rows, duration);
  const items = rows.map(markerItemFromRow).filter(Boolean)
    .sort((a, b) => a.t - b.t || String(a.id).localeCompare(String(b.id)));
  const clusters = [];
  for (const item of items) {
    const last = clusters[clusters.length - 1];
    if (last && Math.abs(item.t - last.t) <= WAVE_CLUSTER_SEC) last.items.push(item);
    else clusters.push({ t: item.t, items: [item] });
  }
  return clusters.map((cluster) => {
    const seen = new Set();
    const seenName = new Set();
    const authors = [];
    for (const item of cluster.items) {
      const nameKey = String(item.author || "Guest").trim().toLowerCase();
      if (seen.has(item.authorKey) || seenName.has(nameKey)) continue;
      seen.add(item.authorKey);
      seenName.add(nameKey);
      authors.push(item);
    }
    const t = cluster.items[0].t;
    const leftPct = commentMarkerLeftPct(t, dur);
    const primary = authors[0] || cluster.items[0];
    return {
      id: cluster.items.map((item) => item.id).filter(Boolean).join("-") || `t${t}`,
      t,
      leftPct,
      author: primary.author,
      text: primary.text,
      kind: cluster.items.some((item) => item.kind === "pin" || item.kind === "markup") ? "pin" : "comment",
      avatarUrl: primary.avatarUrl,
      initial: primary.initial,
      timeLabel: formatCommentTimeLabel(t),
      edge: leftPct <= 8 ? "start" : leftPct >= 92 ? "end" : "",
      stack: 0,
      authors,
      items: cluster.items,
      visibleAuthors: authors.slice(0, WAVE_MAX_FACES),
      overflow: Math.max(0, authors.length - WAVE_MAX_FACES),
    };
  });
}

export function commentMarkerHtml(model) {
  if (!model) return "";
  const authors = Array.isArray(model.visibleAuthors) && model.visibleAuthors.length
    ? model.visibleAuthors
    : (Array.isArray(model.authors) && model.authors.length ? model.authors.slice(0, WAVE_MAX_FACES) : [model]);
  const overflow = Number(model.overflow) || Math.max(0, (model.authors?.length || authors.length) - WAVE_MAX_FACES);
  const faces = authors.map(faceHtml).join("");
  const more = overflow > 0 ? `<span class="share-wave-more" title="More comments">3+</span>` : "";
  const lines = (Array.isArray(model.items) && model.items.length ? model.items : [model])
    .map((item) => `<span><strong>${escapeHtml(item.author || "Guest")}</strong> · ${escapeHtml(item.timeLabel || model.timeLabel || "")} · ${escapeHtml(item.text || "")}</span>`)
    .join("");
  const edge = model.edge === "start" || model.edge === "end" ? ` is-${model.edge}` : "";
  const pin = model.kind === "pin" || model.kind === "markup" ? " is-pin" : "";
  const left = Number.isFinite(Number(model.leftPct)) ? Number(model.leftPct).toFixed(2) : "0.80";
  const t = Number(model.t) || 0;
  const who = escapeHtml(model.author || "Guest");
  const when = escapeHtml(model.timeLabel || "");
  return `<button type="button" class="share-wave-mark${pin}${edge}" style="left:${left}%" data-t="${t}" data-comment-id="${escapeHtml(model.id || "")}" aria-label="${who} at ${when}">
    <span class="share-wave-faces">${faces}${more}</span>
    <span class="share-wave-time">${when}</span>
    <span class="share-wave-pop" role="tooltip">${lines}</span>
  </button>`;
}
