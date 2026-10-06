/** Labels for Screen Recordings / Screenshots. New videos use the local AM/PM clock name. */

const KIND_LABELS = {
  viewport: { video: "Viewport recording", image: "Viewport screenshot" },
  "full-page": { video: "Full page recording", image: "Full page screenshot" },
  fullscreen: { video: "Fullscreen recording", image: "Fullscreen screenshot" },
  screenshot: { video: "Recording", image: "Screenshot" },
  "fullpage-screenshot": { video: "Full page recording", image: "Full page screenshot" },
  "fullscreen-screenshot": { video: "Fullscreen recording", image: "Fullscreen screenshot" },
  "cropped-screenshot": { video: "Recording", image: "Cropped screenshot" },
  ar: { video: "AR recording", image: "AR screenshot" },
  vr: { video: "VR recording", image: "VR screenshot" },
};

const STAMP_RE = /^(.+?)[-_](viewport|full-page|fullscreen|fullpage-screenshot|fullscreen-screenshot|cropped-screenshot|screenshot|ar|vr)(?:-(?:video|screenshot))?[-_](\d{8})[-_](\d{6})(?:_\d+)?$/i;
const KIND_STAMP_RE = /^(viewport|full-page|fullscreen|fullpage-screenshot|fullscreen-screenshot|cropped-screenshot|screenshot|ar|vr)(?:-(?:video|screenshot))?[-_](\d{8})[-_](\d{6})(?:_\d+)?$/i;
const PRETTY_FILE_RE = /^(Viewport-recording|Full-page-recording|Fullscreen-recording|AR-recording|VR-recording|Screenshot|Full-page-screenshot|Fullscreen-screenshot|Cropped-screenshot)(?:_\d+)?$/i;
/** `recording 3:30 PM 12.21.26` plus optional ` (2)` / `-2` / `_2` collision suffix. */
const RECORDING_CLOCK_RE = /^recording (\d{1,2}):(\d{2}) (AM|PM) (\d{2})\.(\d{2})\.(\d{2})(?: \((\d+)\)|[-_](\d+))?$/i;

function captureStem(value) {
  return String(value || "")
    .replace(/\.(webm|mp4|mov|m4v|png|jpe?g|gif|webp)$/i, "")
    .trim();
}

function isVideoEntry(entry) {
  const name = String(entry?.name || entry?.filename || "");
  const kind = String(entry?.kind || entry?.format || "");
  return /^(webm|mp4|mov|m4v|video)$/i.test(kind) || /\.(webm|mp4|mov|m4v)$/i.test(name);
}

function folderHint(entry) {
  return String(entry?.folder || entry?.parent_folder || "").toLowerCase();
}

export function parseRecordingClockStem(stem) {
  const match = captureStem(stem).match(RECORDING_CLOCK_RE);
  if (!match) return null;
  const hour12 = Number(match[1]);
  const minute = Number(match[2]);
  const period = String(match[3] || "").toUpperCase();
  const mo = Number(match[4]);
  const day = Number(match[5]);
  const yy = Number(match[6]);
  if (!hour12 || minute > 59 || mo < 1 || mo > 12 || day < 1 || day > 31) return null;
  let hour = hour12 % 12;
  if (period === "PM") hour += 12;
  const date = new Date(2000 + yy, mo - 1, day, hour, minute, 0);
  if (Number.isNaN(date.getTime())) return null;
  const collision = Number(match[7] || match[8] || 1);
  return { date, hour12, minute, period, collision };
}

export function isRecordingClockStem(stem) {
  return RECORDING_CLOCK_RE.test(captureStem(stem));
}

/** Local 12-hour clock name: `recording 3:30 PM 12.21.26` (system timezone, not UTC). */
export function formatRecordingClockName(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  const when = Number.isNaN(d.getTime()) ? new Date() : d;
  const hour24 = when.getHours();
  const hour12 = hour24 % 12 || 12;
  const minutes = String(when.getMinutes()).padStart(2, "0");
  const period = hour24 >= 12 ? "PM" : "AM";
  const mm = String(when.getMonth() + 1).padStart(2, "0");
  const dd = String(when.getDate()).padStart(2, "0");
  const yy = String(when.getFullYear()).slice(-2);
  return `recording ${hour12}:${minutes} ${period} ${mm}.${dd}.${yy}`;
}

export function uniqueRecordingClockName(baseName, existingNames = []) {
  const base = captureStem(baseName) || formatRecordingClockName();
  const taken = new Set(
    (existingNames || []).map((name) => captureStem(name).toLowerCase()).filter(Boolean),
  );
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base} (${Date.now()})`;
}

export function parseCaptureStamp(entry) {
  const stem = captureStem(entry?.stem || entry?.name || entry?.label || "");
  if (!stem) return null;
  const clock = parseRecordingClockStem(stem);
  if (clock) {
    const y = clock.date.getFullYear();
    const mo = String(clock.date.getMonth() + 1).padStart(2, "0");
    const d = String(clock.date.getDate()).padStart(2, "0");
    const hh = String(clock.date.getHours()).padStart(2, "0");
    const mm = String(clock.date.getMinutes()).padStart(2, "0");
    return { kind: "", date: clock.date, ymd: `${y}${mo}${d}`, hms: `${hh}${mm}00` };
  }
  let match = stem.match(KIND_STAMP_RE);
  let kind;
  let ymd;
  let hms;
  if (match) {
    [, kind, ymd, hms] = match;
  } else {
    match = stem.match(STAMP_RE);
    if (!match) return null;
    [, , kind, ymd, hms] = match;
  }
  const y = Number(ymd.slice(0, 4));
  const mo = Number(ymd.slice(4, 6)) - 1;
  const d = Number(ymd.slice(6, 8));
  const hh = Number(hms.slice(0, 2));
  const mm = Number(hms.slice(2, 4));
  const ss = Number(hms.slice(4, 6));
  const date = new Date(y, mo, d, hh, mm, ss);
  if (Number.isNaN(date.getTime())) return null;
  return { kind: String(kind || "").toLowerCase(), date, ymd, hms };
}

export function captureSortMs(entry) {
  const mtime = Number(entry?.mtime);
  if (Number.isFinite(mtime) && mtime > 0) {
    return mtime > 1e12 ? mtime : mtime * 1000;
  }
  const parsed = parseCaptureStamp(entry);
  return parsed ? parsed.date.getTime() : 0;
}

function formatCaptureDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatEntryCapturedAt(entry) {
  const mtime = Number(entry?.mtime);
  if (Number.isFinite(mtime) && mtime > 0) {
    const ms = mtime > 1e12 ? mtime : mtime * 1000;
    return formatCaptureDate(new Date(ms));
  }
  const parsed = parseCaptureStamp(entry);
  return parsed ? formatCaptureDate(parsed.date) : "";
}

function kindFromPrettyStem(stem) {
  const s = String(stem || "");
  if (/^Viewport-recording/i.test(s)) return "viewport";
  if (/^Full-page-recording/i.test(s)) return "full-page";
  if (/^Fullscreen-recording/i.test(s)) return "fullscreen";
  if (/^AR-recording/i.test(s)) return "ar";
  if (/^VR-recording/i.test(s)) return "vr";
  if (/^Full-page-screenshot/i.test(s)) return "fullpage-screenshot";
  if (/^Fullscreen-screenshot/i.test(s)) return "fullscreen-screenshot";
  if (/^Cropped-screenshot/i.test(s)) return "cropped-screenshot";
  if (/^Screenshot/i.test(s)) return "screenshot";
  return "";
}

export function friendlyCaptureLabel(entry) {
  const video = isVideoEntry(entry);
  const parsed = parseCaptureStamp(entry);
  const stem = captureStem(entry?.stem || entry?.name || "");
  if (isRecordingClockStem(stem)) return stem;
  let kind = parsed?.kind || "";
  if (!kind && PRETTY_FILE_RE.test(stem)) kind = kindFromPrettyStem(stem);
  if (kind) {
    const row = KIND_LABELS[kind] || KIND_LABELS.screenshot;
    return video ? row.video : row.image;
  }
  return "";
}

export function isCaptureBrowserEntry(entry) {
  const folder = folderHint(entry);
  if (/^(recordings|screen recordings|screenshots|ar|video editor)(\/|$)/i.test(folder)) return true;
  if (parseCaptureStamp(entry)) return true;
  const name = String(entry?.name || "");
  return /\.(webm|mp4|mov|m4v)$/i.test(name) && /recording|full-page|fullscreen|viewport/i.test(name);
}

export function friendlyCaptureDisplayName(entry, fallback = "") {
  return friendlyCaptureLabel(entry) || fallback;
}

export function captureHoverTitle(entry, displayName = "") {
  const label = displayName || friendlyCaptureDisplayName(entry) || String(entry?.name || "File");
  const when = formatEntryCapturedAt(entry);
  const filename = String(entry?.name || "").trim();
  if (when) return `${label} — ${when}`;
  return filename && filename !== label ? `${label} (${filename})` : label;
}

export function captureFileBaseName({
  kind = "screenshot",
  xr = false,
  page = false,
  fullscreen = false,
  crop = false,
  date = null,
  existingNames = [],
} = {}) {
  if (kind === "video") {
    return uniqueRecordingClockName(formatRecordingClockName(date || new Date()), existingNames);
  }
  if (crop) return "Cropped-screenshot";
  if (fullscreen) return "Fullscreen-screenshot";
  if (page) return "Full-page-screenshot";
  if (xr) return "AR-screenshot";
  return "Screenshot";
}

export function sortCaptureEntriesNewestFirst(entries) {
  return [...(entries || [])].sort((a, b) => captureSortMs(b) - captureSortMs(a));
}

function mediaBasename(value) {
  return String(value || "").replace(/\\/g, "/").split("/").filter(Boolean).pop() || "";
}

/** Family key for pretty / clock recording copies (`Fullscreen-recording_3`, `-edited_2`). */
export function captureRecordingFamilyKey(name) {
  const stem = captureStem(mediaBasename(name));
  if (!stem) return "";
  const pretty = stem.match(/^(Viewport|Full-page|Fullscreen|AR|VR)-recording/i);
  if (pretty) return `${String(pretty[1]).toLowerCase()}-recording`;
  const clock = stem.match(
    /^(recording \d{1,2}:\d{2} (?:AM|PM) \d{2}\.\d{2}\.\d{2})(?: \((\d+)\)|[-_]\d+)?(?:-edited(?:_\d+)?)?$/i,
  );
  return clock ? String(clock[1]).toLowerCase() : "";
}

export function isEditedCaptureCopy(name) {
  return /-edited(?:_\d+)?$/i.test(captureStem(mediaBasename(name)));
}

/**
 * Extra copies of the same recording (unique-suffix / -edited clones).
 * When `keepName` matches a family, keep that file and drop the siblings.
 * Otherwise keep the newest original and only delete obvious clones.
 */
export function duplicateCaptureNames(entries, { keepName = "" } = {}) {
  const groups = new Map();
  for (const entry of entries || []) {
    const disk = String(entry?.filename || entry?.name || "").trim();
    const base = mediaBasename(disk);
    if (!disk || !/\.(webm|mp4|mov|m4v)$/i.test(base)) continue;
    const key = captureRecordingFamilyKey(base);
    if (!key) continue;
    const list = groups.get(key) || [];
    list.push({
      disk,
      base,
      mtime: captureSortMs(entry),
      size: Number(entry?.size) || 0,
      edited: isEditedCaptureCopy(base),
    });
    groups.set(key, list);
  }

  const keepBase = mediaBasename(keepName);
  const keepKey = captureRecordingFamilyKey(keepBase);
  const extras = [];
  const seen = new Set();
  const pushExtra = (row) => {
    const id = row.disk.toLowerCase();
    if (seen.has(id) || seen.has(row.base.toLowerCase())) return;
    seen.add(id);
    seen.add(row.base.toLowerCase());
    extras.push(row.disk);
  };

  for (const [key, raw] of groups) {
    const uniq = [];
    const used = new Set();
    for (const row of raw) {
      const id = row.base.toLowerCase();
      if (used.has(id)) continue;
      used.add(id);
      uniq.push(row);
    }
    if (uniq.length < 2) continue;

    let keep = uniq.find((row) => (
      (keepBase && (row.base === keepBase || row.disk === keepName || row.disk.endsWith(`/${keepBase}`)))
    ));
    if (!keep && keepKey === key && keepBase) {
      keep = [...uniq].sort((a, b) => (b.mtime - a.mtime) || (b.size - a.size))
        .find((row) => !row.edited) || uniq[0];
    }
    if (keep) {
      for (const row of uniq) {
        if (row.base.toLowerCase() === keep.base.toLowerCase()) continue;
        pushExtra(row);
      }
      continue;
    }

    const originals = uniq.filter((row) => !row.edited);
    const edited = uniq.filter((row) => row.edited);
    for (const row of edited) pushExtra(row);
    if (originals.length >= 3) {
      const newest = [...originals].sort((a, b) => (b.mtime - a.mtime) || (b.size - a.size))[0];
      for (const row of originals) {
        if (row === newest) continue;
        pushExtra(row);
      }
    }
  }
  return extras;
}
