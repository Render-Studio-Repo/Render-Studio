/** Public share viewer — rotate, section cut, mobile-friendly, downloads. */

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { applyViewportStyle, setupRenderer, setViewMode, setObjectTransparent as styleSetObjectTransparent } from "./scene-style.js?v=20260907-share-wf3-20260915-cadcolor2-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2&xrtalk=20260916-1&astra=20260916-5&webglrevert2&parametric-wire1";
import { createShareMeasure } from "./share-measure.js?v=20260909-measkeep1-measui1-measux1-measux2&editctx=20260915-1&editscale=20260915-1";
import {
  commentMarkerHtml,
  commentMarkerModels,
  playheadPlayedPct,
  seekTimeFromClientX,
  waveformBarHeights,
  waveformBarsHtml,
} from "./share-video-waveform.js?v=20260915-scwave1-sharemarkup1-20260915-sharelive1-trimwave1-clipperf1";
import { createUserProfileUI } from "../components/user-profile.js?v=20260909-measkeep1-shareov1-20260909-remix1-histprof1-settings-redesign2&leakfix75";
import { authHeaders, getToken, getStoredUser } from "../studio/auth.js?v=20260908-profclick1-profopen1";
import { triggerTrackedBlobDownload } from "./viewport-video-editor.js?v=leakfix7";

const shareDownloadCreated = [];
import {
  bindSharedWorkspacePicker,
  gateRemixOrShare,
  remixOpenBody,
  readSharedWorkspacePicker,
  savePendingShareAction,
  sharedWorkspacePickerHtml,
  sharedWorkspacesFromTeams,
  studioViewportPath,
} from "../studio/share-auth-gate.js?v=20260909-remix1";
import {
  SHARE_HISTORY_PROFILE_KIND,
  bindShareHistoryProfileClicks,
  shareHistoryAuthorId,
  shareHistoryCommentCardHtml,
  shareHistoryOwnerEntry,
  shareHistorySignInReturnTo,
  shareHistoryWhoRowHtml,
} from "./share-history-authors.js?v=20260915-histprof1-sharemarkup1-20260915-sharelive1";
import { layoutDiagramHtml, studioImportUrl } from "../studio/viewport-layout-saves.js?v=vplayout=20260916-1&layui1";
import {
  createShareVideoMarkup,
  shareFullscreenBlocked,
} from "./share-video-markup.js?v=20260915-sharemarkup1-20260915-sharelive1&leakfix34";
import { createUrdfRobotRuntime } from "../scripting/urdf-robot-runtime.js?v=20261001-articulated-integrity";
import { mergeDiscoveredRigs, filterRigs, rigKindLabel } from "../studio/cad-rigs.js?v=rig1-rigpick1";

/** Abort a hung GLB fetch if bytes stop arriving. Large downloads keep this timer reset. */
const SHARE_LOAD_STALL_MS = 45000;

const FORMAT_LABELS = {
  glb: "GLB",
  gltf: "GLTF",
  stl: "STL",
  step: "STEP",
  stp: "STEP",
  "3mf": "3MF",
  obj: "OBJ",
  ply: "PLY",
  mp4: "MP4",
  webm: "WebM",
  gif: "GIF",
};

const VIDEO_SHARE_FORMATS = ["mp4", "webm", "gif"];

function encodeProjectFilePath(filename) {
  return String(filename || "")
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function tokenFromPath() {
  const parts = location.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("share");
  return idx >= 0 ? decodeURIComponent(parts[idx + 1] || "") : "";
}

function isEmbedMode() {
  return new URLSearchParams(location.search).get("embed") === "1";
}

function isHeroEmbedMode() {
  const params = new URLSearchParams(location.search);
  return params.get("embed") === "1" && params.get("hero") === "1";
}

function $(id) {
  return document.getElementById(id);
}

function formatBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / (1024 * 1024)).toFixed(1)} MB`;
}

function createSectionController({ renderer, scene, getBounds }) {
  let active = false;
  let axis = "Y";
  let offset = 0.5;
  let flipped = false;
  const plane = new THREE.Plane();
  const meshSides = new Map();
  const meshVisibility = new Map();

  function planeNormal() {
    const n = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] }[axis] || [0, 1, 0];
    const s = flipped ? 1 : -1;
    return new THREE.Vector3(n[0] * s, n[1] * s, n[2] * s);
  }

  function apply() {
    if (!active) return;
    const box = getBounds();
    const mn = { X: box.min.x, Y: box.min.y, Z: box.min.z }[axis];
    const mx = { X: box.max.x, Y: box.max.y, Z: box.max.z }[axis];
    const pos = mn + offset * (mx - mn);
    const posVec = {
      X: new THREE.Vector3(pos, 0, 0),
      Y: new THREE.Vector3(0, pos, 0),
      Z: new THREE.Vector3(0, 0, pos),
    }[axis];
    plane.normal.copy(planeNormal());
    plane.constant = -plane.normal.dot(posVec);
    renderer.clippingPlanes = [plane];
    renderer.localClippingEnabled = true;
  }

  function setMeshSides(on) {
    scene.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      if (obj.userData?.isSilhouette) {
        if (on) {
          if (!meshVisibility.has(obj)) meshVisibility.set(obj, obj.visible);
          obj.visible = false;
        } else if (meshVisibility.has(obj)) {
          obj.visible = meshVisibility.get(obj);
        }
        return;
      }
      if (obj.userData?.isEdge) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      if (on) {
        if (!meshSides.has(obj)) meshSides.set(obj, mats.map((m) => m?.side));
        mats.forEach((m) => {
          if (!m) return;
          m.side = THREE.DoubleSide;
          m.needsUpdate = true;
        });
      } else if (meshSides.has(obj)) {
        const prev = meshSides.get(obj);
        mats.forEach((m, i) => {
          if (!m) return;
          m.side = prev[i] ?? THREE.FrontSide;
          m.needsUpdate = true;
        });
      }
    });
    if (!on) {
      meshSides.clear();
      meshVisibility.clear();
    }
  }

  return {
    isActive: () => active,
    activate() {
      if (active) return;
      active = true;
      setMeshSides(true);
      apply();
    },
    deactivate() {
      if (!active) return;
      active = false;
      renderer.clippingPlanes = [];
      renderer.localClippingEnabled = false;
      setMeshSides(false);
    },
    setAxis(next) {
      axis = String(next || "Y").toUpperCase();
      apply();
    },
    setOffset(t) {
      offset = Math.max(0, Math.min(1, Number(t) || 0));
      apply();
    },
    flip() {
      flipped = !flipped;
      apply();
    },
    refresh: apply,
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

async function main() {
  const token = tokenFromPath();
  const embed = isEmbedMode();
  const heroEmbed = isHeroEmbedMode();
  if (embed) {
    document.documentElement.classList.add("share-embed");
    document.body.classList.add("share-embed");
  }
  if (heroEmbed) {
    document.documentElement.classList.add("share-hero");
    document.body.classList.add("share-hero");
  }
  const titleEl = $("share-title");
  const subEl = $("share-subtitle");
  const statusEl = $("share-status");
  const downloadsEl = $("share-downloads");
  const downloadMenuEl = $("share-download-menu");
  const btnDownloadPopup = $("btn-share-download-menu");
  const timelineTrackEl = $("share-timeline-track");
  const viewerEl = $("share-viewer");
  const sectionPanel = $("share-section-panel");
  const btnSection = $("btn-share-section");
  const btnRotate = $("btn-share-rotate");
  const btnFit = $("btn-share-fit");
  const btnInspector = $("btn-share-inspector");
  const btnHistory = $("btn-share-history");
  const btnWireframe = $("btn-share-wireframe");
  const btnTransparent = $("btn-share-transparent");
  const btnOpen = $("btn-share-open");
  const btnDownloadMenu = $("btn-share-download");
  const btnMobileFullscreen = $("btn-share-mobile-fullscreen");
  const btnShareFullscreen = $("btn-share-fullscreen");
  const btnMobileTools = $("btn-share-mobile-tools");
  const btnMobileFit = $("btn-share-mobile-fit");
  if (shareFullscreenBlocked({
    ua: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    innerWidth: window.innerWidth,
    matchMedia: (query) => window.matchMedia(query),
  })) {
    document.documentElement.classList.add("share-no-fs");
    document.body.classList.add("share-no-fs");
  }
  const downloadSheet = $("share-download-sheet");
  const remixModal = $("share-remix-modal");
  const remixProjectSelect = $("share-remix-project-select");
  const remixWorkspaceHost = $("share-remix-workspace-host");
  const remixStatus = $("share-remix-status");
  const btnRemixConfirm = $("btn-share-remix-confirm");
  const inspectorPanel = $("share-inspector-panel");
  const inspectorTitle = $("share-inspector-title");
  const panelPartsEl = $("share-panel-parts");
  const panelHistoryEl = $("share-panel-history");
  const promptHistoryEl = $("share-prompt-history");
  const componentListEl = $("share-component-list");
  const transparentTip = $("share-transparent-tip");
  const btnTransparentTipClose = $("btn-share-transparent-tip-close");
  const motionCard = $("share-motion-card");
  const motionStatus = $("share-motion-status");
  const btnMotionPlay = $("btn-share-motion-play");
  const btnMotionReset = $("btn-share-motion-reset");
  const jointListEl = $("share-joint-list");
  const btnSharePlay = $("btn-share-play");
  const btnSharePlayMenu = $("btn-share-play-menu");
  const sharePlayWrap = $("share-play-wrap");
  const btnShareDrag = $("btn-share-drag-open");
  const shareRigPicker = $("share-rig-picker");
  const shareRigSearch = $("share-rig-picker-search");
  const shareRigList = $("share-rig-picker-list");
  let robotRuntime = null;
  let shareRigs = [];
  let shareActiveRigId = "";
  let shareDragOn = false;
  let shareDrag = null;
  let shareProcedural = null;
  let shareMixer = null;
  let shareGltfClips = [];
  let sharePlaying = false;
  const shareClock = new THREE.Clock();

  if (!token) {
    const copy = $("share-status-copy") || statusEl;
    if (copy) copy.textContent = "Invalid share link.";
    statusEl?.classList.remove("hidden");
    if (statusEl) statusEl.hidden = false;
    return;
  }

  const PRIMARY_SHARE_FORMATS = ["glb", "stl", "step", "3mf"];
  let exportItems = [];
  let exportsReady = false;
  let isVideoShare = false;
  let videoDownloadFormat = "mp4";
  let videoDownloadAudio = true;
  let videoDownloadMarkup = false;
  let videoDownloadBusy = false;
  let videoDownloadError = "";
  let videoDownloadPath = "";
  let videoSourceUrl = "";

  function absoluteFileUrl(pathOrUrl) {
    if (!pathOrUrl) return "";
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return `${window.location.origin}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
  }

  function detectClientOs() {
    const ua = navigator.userAgent || "";
    const platform = navigator.platform || "";
    if (/Mac|iPhone|iPad|iPod/i.test(ua) || /Mac/i.test(platform)) return "macos";
    if (/Win/i.test(ua) || /Win/i.test(platform)) return "windows";
    if (/Linux|X11|CrOS/i.test(ua)) return "linux";
    return "windows";
  }

  function bambuStudioOpenUrls(fileUrl) {
    // Encoded file= URLs are what Bambu imports on first open.
    const encoded = encodeURIComponent(fileUrl);
    return {
      windows: `bambustudio://open?file=${encoded}`,
      windowsEncoded: `bambustudio://open?file=${encoded}`,
      windowsPlain: `bambustudio://open?file=${fileUrl}`,
      linux: `bambustudio://open?file=${encoded}`,
      linuxEncoded: `bambustudio://open?file=${encoded}`,
      linuxPlain: `bambustudio://open?file=${fileUrl}`,
      macos: `bambustudioopen://${encoded}`,
      macosEncoded: `bambustudioopen://${encoded}`,
      macosPlain: `bambustudioopen://${fileUrl}`,
    };
  }

  function findThreeMfExport() {
    return exportItems.find((item) => String(item.format || "").toLowerCase() === "3mf")
      || exportItems.find((item) => /\.3mf$/i.test(item.name || ""));
  }

  function openInBambuStudio() {
    if (!exportsReady) {
      setStatus("Exports are still preparing…");
      return;
    }
    const threeMf = findThreeMfExport();
    if (!threeMf?.url) {
      setStatus("No 3MF export is available for Bambu Studio yet.");
      return;
    }
    const fileUrl = absoluteFileUrl(threeMf.url);
    const urls = bambuStudioOpenUrls(fileUrl);
    const os = detectClientOs();
    // Also download so the user can File→Import if Studio only focuses an empty window.
    const a = document.createElement("a");
    a.href = fileUrl;
    a.download = String(threeMf.name || "model.3mf").replace(/\.3MF$/i, ".3mf");
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.location.href = urls[os] || urls.windows;
    setStatus("Opening Bambu Studio… If the plate is empty, click Yes on the trust prompt, or import the downloaded 3MF.");
  }

  function videoDownloadUrl(format, withAudio) {
    const fmt = String(format || videoDownloadFormat || "mp4").toLowerCase();
    const keepAudio = fmt !== "gif" && withAudio !== false && videoDownloadAudio !== false;
    const base = String(videoDownloadPath || "").trim();
    if (!base) return "";
    const params = new URLSearchParams({
      format: fmt,
      audio: keepAudio ? "1" : "0",
    });
    if (videoDownloadMarkup) params.set("markup", "1");
    return `${base}?${params.toString()}`;
  }

  function shareDownloadExt(format) {
    const fmt = String(format || "mp4").toLowerCase();
    if (fmt === "gif") return "gif";
    if (fmt === "webm") return "webm";
    return "mp4";
  }

  function shareSourceLooksLikeMp4(url) {
    const path = String(url || "").split("?")[0].toLowerCase();
    return /\.(mp4|m4v|mov)$/.test(path);
  }

  function shareSourceFileName(url, format) {
    const ext = shareDownloadExt(format);
    try {
      const path = new URL(url, window.location.origin).pathname;
      const base = decodeURIComponent(path.split("/").filter(Boolean).pop() || "");
      const stem = base.replace(/\.[^.]+$/, "");
      if (stem && !stem.includes("..")) return `${stem}.${ext}`;
    } catch (_) { /* default name */ }
    return `render3d-video.${ext}`;
  }

  function withDownloadParam(url) {
    try {
      const parsed = new URL(url, window.location.origin);
      parsed.searchParams.set("download", "1");
      return `${parsed.pathname}${parsed.search}`;
    } catch (_) {
      const raw = String(url || "");
      return `${raw}${raw.includes("?") ? "&" : "?"}download=1`;
    }
  }

  function triggerDirectDownload(url, filename) {
    const a = document.createElement("a");
    a.href = withDownloadParam(url);
    a.download = filename || "render3d-video.mp4";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function shareDownloadLooksPlayable(blob, format) {
    if (!blob || !blob.size) return false;
    const type = String(blob.type || "").toLowerCase();
    if (type.includes("html") || type.includes("json") || type.startsWith("text/")) return false;
    const head = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    const ascii = String.fromCharCode(...head.slice(0, 15));
    if (ascii.startsWith("<!DOCTYPE") || ascii.startsWith("<html") || ascii.startsWith("{")) return false;
    const ext = shareDownloadExt(format);
    if (ext === "gif") return ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a");
    if (ext === "webm") return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
    if (head.length < 12 || head[4] !== 0x66 || head[5] !== 0x74 || head[6] !== 0x79 || head[7] !== 0x70) return false;
    const brands = String.fromCharCode(...head.slice(8, 32));
    return brands.includes("avc1") || brands.includes("avc3");
  }

  function typedShareDownloadBlob(blob, format) {
    const ext = shareDownloadExt(format);
    const type = ext === "gif" ? "image/gif" : ext === "webm" ? "video/webm" : "video/mp4";
    if (String(blob.type || "").toLowerCase() === type) return blob;
    return new Blob([blob], { type });
  }

  function triggerBlobDownload(blob, filename) {
    triggerTrackedBlobDownload(blob, filename || "render3d-video.mp4", shareDownloadCreated);
  }

  async function fetchShareVideoBlob(url, format) {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) {
      let detail = res.statusText || "Download failed.";
      try {
        const data = await res.json();
        detail = data?.detail || data?.message || detail;
      } catch (_) { /* keep status text */ }
      throw new Error(typeof detail === "string" ? detail : "Download failed.");
    }
    const type = String(res.headers.get("content-type") || "").toLowerCase();
    if (type.includes("html") || type.includes("json") || type.startsWith("text/")) {
      throw new Error("Download was not a playable video.");
    }
    const blob = await res.blob();
    if (!(await shareDownloadLooksPlayable(blob, format))) {
      throw new Error("Download was not a playable video.");
    }
    const ext = shareDownloadExt(format);
    const disp = res.headers.get("content-disposition") || "";
    const named = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(disp);
    const rawName = decodeURIComponent((named?.[1] || named?.[2] || "").trim());
    const filename = rawName.toLowerCase().endsWith(`.${ext}`) ? rawName : `render3d-video.${ext}`;
    return { blob: typedShareDownloadBlob(blob, format), filename };
  }

  function finishShareVideoDownload() {
    setDownloadMenuOpen(false);
    downloadSheet?.classList.add("hidden");
    btnDownloadMenu?.classList.remove("active");
  }

  async function downloadShareVideo(formatOverride) {
    if (!isVideoShare || videoDownloadBusy) return;
    const format = String(formatOverride || videoDownloadFormat || "mp4").toLowerCase();
    videoDownloadFormat = format;
    videoDownloadBusy = true;
    videoDownloadError = "";
    renderDownloadMenu(downloadMenuEl);
    renderDownloadMenu($("share-download-list"));
    placeShareDownloadMenu();
    try {
      const nativeMp4 = !videoDownloadMarkup && format === "mp4" && videoDownloadAudio && videoSourceUrl && shareSourceLooksLikeMp4(videoSourceUrl);
      if (nativeMp4) {
        triggerDirectDownload(videoSourceUrl, shareSourceFileName(videoSourceUrl, "mp4"));
        finishShareVideoDownload();
        return;
      }
      const convertUrl = videoDownloadUrl(format, videoDownloadAudio);
      if (convertUrl) {
        try {
          const packed = await fetchShareVideoBlob(convertUrl, format);
          triggerBlobDownload(packed.blob, packed.filename);
          finishShareVideoDownload();
          return;
        } catch (err) {
          if (!(format === "mp4" && videoSourceUrl)) throw err;
        }
      }
      if (!videoDownloadMarkup && format === "mp4" && videoSourceUrl) {
        triggerDirectDownload(videoSourceUrl, shareSourceFileName(videoSourceUrl, "mp4"));
        finishShareVideoDownload();
        return;
      }
      throw new Error(convertUrl ? "Download was not a playable video." : "This download format is not available yet.");
    } catch (err) {
      videoDownloadError = err?.message || "Download failed.";
    } finally {
      videoDownloadBusy = false;
      renderDownloadMenu(downloadMenuEl);
      renderDownloadMenu($("share-download-list"));
      if (downloadMenuEl && !downloadMenuEl.classList.contains("hidden")) placeShareDownloadMenu();
    }
  }

  function renderVideoDownloadMenu(into) {
    into.innerHTML = "";
    const formatHint = {
      mp4: "H.264",
      webm: "VP9",
      gif: "Silent animation",
    };
    for (const fmt of VIDEO_SHARE_FORMATS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `share-dl-menu-item${videoDownloadFormat === fmt ? " is-active" : ""}`;
      btn.dataset.shareVideoFormat = fmt;
      btn.setAttribute("role", "menuitemradio");
      btn.setAttribute("aria-checked", String(videoDownloadFormat === fmt));
      btn.innerHTML = `<strong>${FORMAT_LABELS[fmt] || fmt.toUpperCase()}</strong><span>${formatHint[fmt] || fmt}</span>`;
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        videoDownloadFormat = fmt;
        videoDownloadError = "";
        renderDownloadMenu(downloadMenuEl);
        renderDownloadMenu($("share-download-list"));
        setDownloadMenuOpen(true);
      });
      into.appendChild(btn);
    }
    const sep = document.createElement("div");
    sep.className = "share-dl-menu-sep";
    into.appendChild(sep);
    const gifLocked = videoDownloadFormat === "gif";
    for (const [keep, label, hint] of [
      [true, "With audio", "Keep soundtrack"],
      [false, "Without audio", "Silent video"],
    ]) {
      const btn = document.createElement("button");
      btn.type = "button";
      const active = gifLocked ? !keep : videoDownloadAudio === keep;
      btn.className = `share-dl-menu-item${active ? " is-active" : ""}${gifLocked ? " is-disabled" : ""}`;
      btn.dataset.shareVideoAudio = keep ? "1" : "0";
      btn.setAttribute("role", "menuitemradio");
      btn.setAttribute("aria-checked", String(active));
      btn.disabled = gifLocked;
      btn.innerHTML = `<strong>${label}</strong><span>${gifLocked ? "GIF has no audio" : hint}</span>`;
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (gifLocked) return;
        videoDownloadAudio = keep;
        videoDownloadError = "";
        renderDownloadMenu(downloadMenuEl);
        renderDownloadMenu($("share-download-list"));
        setDownloadMenuOpen(true);
      });
      into.appendChild(btn);
    }
    const markupSep = document.createElement("div");
    markupSep.className = "share-dl-menu-sep";
    into.appendChild(markupSep);
    const markupBtn = document.createElement("button");
    markupBtn.type = "button";
    markupBtn.className = `share-dl-menu-item${videoDownloadMarkup ? " is-active" : ""}`;
    markupBtn.dataset.shareVideoMarkup = videoDownloadMarkup ? "1" : "0";
    markupBtn.setAttribute("role", "menuitemcheckbox");
    markupBtn.setAttribute("aria-checked", String(videoDownloadMarkup));
    markupBtn.innerHTML = videoDownloadMarkup
      ? `<strong>Markups</strong><span>On · burn user drawings and avatars</span>`
      : `<strong>Markups</strong><span>Off · original video, no overlay</span>`;
    markupBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      videoDownloadMarkup = !videoDownloadMarkup;
      videoDownloadError = "";
      renderDownloadMenu(downloadMenuEl);
      renderDownloadMenu($("share-download-list"));
      setDownloadMenuOpen(true);
    });
    into.appendChild(markupBtn);
    const goSep = document.createElement("div");
    goSep.className = "share-dl-menu-sep";
    into.appendChild(goSep);
    const go = document.createElement("button");
    go.type = "button";
    go.className = "share-dl-menu-item share-dl-menu-item--go";
    go.setAttribute("role", "menuitem");
    go.disabled = videoDownloadBusy;
    const audioLabel = videoDownloadFormat === "gif" || !videoDownloadAudio ? "without audio" : "with audio";
    const markupLabel = videoDownloadMarkup ? "with markups" : "plain";
    go.innerHTML = videoDownloadBusy
      ? `<strong><span class="share-dl-spinner" aria-hidden="true"></span>Preparing ${FORMAT_LABELS[videoDownloadFormat] || "file"}…</strong><span>No sign-in needed</span>`
      : `<strong>Download</strong><span>${FORMAT_LABELS[videoDownloadFormat] || "MP4"} · ${audioLabel} · ${markupLabel}</span>`;
    go.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void downloadShareVideo(videoDownloadFormat);
    });
    into.appendChild(go);
    if (videoDownloadError) {
      const err = document.createElement("p");
      err.className = "share-dl-error";
      err.textContent = videoDownloadError;
      into.appendChild(err);
    }
  }

  function renderDownloadMenu(into) {
    if (!into) return;
    if (isVideoShare) {
      renderVideoDownloadMenu(into);
      return;
    }
    into.innerHTML = "";
    if (!exportsReady) {
      for (const fmt of PRIMARY_SHARE_FORMATS) {
        const row = document.createElement("div");
        row.className = "share-dl-menu-item is-preparing";
        row.setAttribute("aria-busy", "true");
        row.setAttribute("role", "menuitem");
        row.innerHTML = `<strong><span class="share-dl-spinner" aria-hidden="true"></span>${FORMAT_LABELS[fmt]}</strong><span>Preparing…</span>`;
        into.appendChild(row);
      }
      const sep = document.createElement("div");
      sep.className = "share-dl-menu-sep";
      into.appendChild(sep);
      const bambu = document.createElement("div");
      bambu.className = "share-dl-menu-item share-dl-menu-item--bambu is-preparing";
      bambu.setAttribute("aria-busy", "true");
      bambu.setAttribute("role", "menuitem");
      bambu.innerHTML = `<strong><span class="share-dl-spinner" aria-hidden="true"></span>Import to Bambu</strong><span>Preparing…</span>`;
      into.appendChild(bambu);
      return;
    }
    if (!exportItems.length) {
      into.innerHTML = `<p class="muted" style="padding:8px 10px">No downloadable formats yet.</p>`;
      return;
    }
    for (const item of exportItems) {
      const a = document.createElement("a");
      a.className = "share-dl-menu-item";
      a.href = item.url;
      a.download = item.name;
      a.rel = "noopener";
      a.setAttribute("role", "menuitem");
      const fmt = String(item.format || "").toLowerCase();
      const label = fmt === "step" || fmt === "stp"
        ? "STEP"
        : (FORMAT_LABELS[fmt] || String(item.format || "File").toUpperCase());
      const detail = item.convertible && !(item.size > 0)
        ? "Generated when downloaded"
        : (item.size != null ? formatBytes(item.size) : item.name);
      a.innerHTML = `<strong>${label}</strong><span>${detail}</span>`;
      into.appendChild(a);
    }
    const threeMf = findThreeMfExport();
    if (threeMf) {
      const sep = document.createElement("div");
      sep.className = "share-dl-menu-sep";
      into.appendChild(sep);
      const bambu = document.createElement("button");
      bambu.type = "button";
      bambu.className = "share-dl-menu-item share-dl-menu-item--bambu";
      bambu.setAttribute("role", "menuitem");
      bambu.innerHTML = `<strong>Import to Bambu</strong><span>Open 3MF in Bambu Studio</span>`;
      bambu.addEventListener("click", () => {
        setDownloadMenuOpen(false);
        openInBambuStudio();
      });
      into.appendChild(bambu);
    }
  }

  function placeShareDownloadMenu() {
    const menu = downloadMenuEl;
    const btn = btnDownloadPopup;
    if (!menu || !btn || menu.classList.contains("hidden")) return;
    const pad = 8;
    const gap = 8;
    const btnRect = btn.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(280, Math.max(196, vw - pad * 2));
    menu.style.position = "fixed";
    menu.style.width = `${width}px`;
    menu.style.right = "auto";
    menu.style.maxHeight = "none";
    menu.style.visibility = "hidden";
    const natural = Math.max(menu.scrollHeight, menu.offsetHeight);
    const spaceAbove = btnRect.top - pad;
    const spaceBelow = vh - btnRect.bottom - pad;
    const openBelow = spaceAbove < Math.min(natural, 320) + gap && spaceBelow >= spaceAbove;
    const avail = Math.max(140, (openBelow ? spaceBelow : spaceAbove) - gap);
    const height = Math.min(natural, avail);
    menu.style.maxHeight = `${height}px`;
    menu.style.overflowY = natural > height + 1 ? "auto" : "hidden";
    menu.style.overflowX = "hidden";
    let left = btnRect.right - width;
    left = Math.min(Math.max(pad, left), vw - width - pad);
    menu.style.left = `${Math.round(left)}px`;
    if (openBelow) {
      menu.classList.add("is-below");
      menu.style.top = `${Math.round(btnRect.bottom + gap)}px`;
      menu.style.bottom = "auto";
    } else {
      menu.classList.remove("is-below");
      menu.style.bottom = `${Math.round(vh - btnRect.top + gap)}px`;
      menu.style.top = "auto";
    }
    menu.style.visibility = "";
  }

  function setDownloadMenuOpen(open) {
    downloadMenuEl?.classList.toggle("hidden", !open);
    btnDownloadPopup?.setAttribute("aria-expanded", String(!!open));
    btnDownloadPopup?.classList.toggle("active", !!open);
    if (open) {
      requestAnimationFrame(() => {
        placeShareDownloadMenu();
        requestAnimationFrame(placeShareDownloadMenu);
      });
    } else if (downloadMenuEl) {
      downloadMenuEl.classList.remove("is-below");
      downloadMenuEl.style.position = "";
      downloadMenuEl.style.top = "";
      downloadMenuEl.style.bottom = "";
      downloadMenuEl.style.left = "";
      downloadMenuEl.style.right = "";
      downloadMenuEl.style.width = "";
      downloadMenuEl.style.maxHeight = "";
      downloadMenuEl.style.overflowY = "";
      downloadMenuEl.style.visibility = "";
    }
  }

  function renderDownloads(into) {
    renderDownloadMenu(into);
  }

  renderDownloadMenu(downloadMenuEl);
  renderDownloadMenu($("share-download-list"));
  if (downloadsEl) downloadsEl.innerHTML = "";

  btnDownloadPopup?.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = downloadMenuEl?.classList.contains("hidden");
    setDownloadMenuOpen(!!open);
  });
  document.addEventListener("click", (event) => {
    if (!downloadMenuEl || downloadMenuEl.classList.contains("hidden")) return;
    if (downloadMenuEl.contains(event.target) || btnDownloadPopup?.contains(event.target)) return;
    setDownloadMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setDownloadMenuOpen(false);
  });
  window.addEventListener("resize", () => {
    if (downloadMenuEl && !downloadMenuEl.classList.contains("hidden")) placeShareDownloadMenu();
  });
  window.addEventListener("scroll", () => {
    if (downloadMenuEl && !downloadMenuEl.classList.contains("hidden")) placeShareDownloadMenu();
  }, true);

  let meta;
  try {
    const res = await fetch(`/api/share/${encodeURIComponent(token)}`, {
      headers: authHeaders(),
      credentials: "same-origin",
    });
    if (!res.ok) throw new Error(res.status === 404 ? "Share link not found" : "Could not load share");
    meta = await res.json();
  } catch (err) {
    const copy = $("share-status-copy") || statusEl;
    if (copy) copy.textContent = err.message || "Share link not found";
    statusEl?.classList.remove("hidden");
    if (statusEl) statusEl.hidden = false;
    exportsReady = true;
    exportItems = [];
    renderDownloadMenu(downloadMenuEl);
    renderDownloadMenu($("share-download-list"));
    return;
  }

  const SITE_PREVIEW_TITLE = "Render Studio: All-in-one robotics collaborative workspace";
  document.title = meta.share_title
    || (meta.project_name ? `${meta.project_name} · ${SITE_PREVIEW_TITLE}` : SITE_PREVIEW_TITLE);
  titleEl.textContent = meta.project_name || meta.filename || "Shared model";
  const shareMode = String(meta.share_mode || (meta.allow_edit ? "edit" : (meta.allow_remix || meta.allow_download ? "remix" : "view")));
  const canRemixOrDownload = shareMode === "remix" || shareMode === "edit";
  const canEditShare = shareMode === "edit";
  isVideoShare = meta.kind === "video" || /\.(mp4|webm|mov|m4v|ogg)$/i.test(String(meta.filename || meta.viewer_filename || ""));
  const isLayoutShare = meta.kind === "viewport_layout";
  const canDownloadShare = canRemixOrDownload || isVideoShare;
  if (isLayoutShare) {
    document.body.classList.add("share-layout");
    document.documentElement.classList.add("share-layout");
    const stage = $("share-layout-stage");
    stage?.classList.remove("hidden");
    const tree = meta.layout?.tree || meta.layout;
    const diagram = $("share-layout-diagram");
    if (diagram) diagram.innerHTML = layoutDiagramHtml(tree);
    const layoutTitle = $("share-layout-title");
    if (layoutTitle) layoutTitle.textContent = meta.layout?.name || meta.project_name || "Viewport layout";
    const layoutDesc = $("share-layout-desc");
    if (layoutDesc) layoutDesc.textContent = meta.layout?.description || meta.share_description || "";
    if (titleEl) titleEl.textContent = meta.layout?.name || meta.project_name || "Viewport layout";
    if (btnOpen) {
      btnOpen.textContent = "Import to your workspace";
      btnOpen.classList.remove("hidden");
    }
    $("btn-share-import-layout")?.addEventListener("click", () => {
      location.href = getToken()
        ? studioImportUrl(token)
        : `/?import_viewport_layout=${encodeURIComponent(token)}&signin=1`;
    });
  }
  if (isVideoShare) {
    document.body.classList.add("share-video");
    document.documentElement.classList.add("share-video");
    const shareQs = new URLSearchParams(location.search);
    const qsFormat = String(shareQs.get("format") || "").toLowerCase();
    if (VIDEO_SHARE_FORMATS.includes(qsFormat)) videoDownloadFormat = qsFormat;
    if (shareQs.get("audio") === "0") videoDownloadAudio = false;
    if (shareQs.get("audio") === "1") videoDownloadAudio = true;
    if (shareQs.get("markup") === "1") videoDownloadMarkup = true;
    if (shareQs.get("markup") === "0") videoDownloadMarkup = false;
    videoDownloadPath = String(meta.video_download?.url || "").trim();
    videoSourceUrl = String(meta.viewer_url || "").trim()
      || (meta.viewer_filename
        ? `/api/share/${encodeURIComponent(token)}/files/${encodeProjectFilePath(meta.viewer_filename)}`
        : `/api/share/${encodeURIComponent(token)}/files/${encodeProjectFilePath(meta.filename)}`);
  }
  document.body.classList.toggle("share-view-only", !canRemixOrDownload);
  document.documentElement.classList.toggle("share-view-only", !canRemixOrDownload);

  function shareModeLabel(mode) {
    if (mode === "edit") return "Remix and edit";
    if (mode === "remix") return "Remix only";
    return "View only";
  }

  function applyLiveShareFlags(next = {}) {
    Object.assign(meta, next);
    const mode = String(meta.share_mode || (meta.allow_edit ? "edit" : (meta.allow_remix || meta.allow_download ? "remix" : "view")));
    const remix = mode === "remix" || mode === "edit";
    document.body.classList.toggle("share-view-only", !remix);
    document.documentElement.classList.toggle("share-view-only", !remix);
    if (btnOpen) btnOpen.classList.toggle("hidden", isLayoutShare ? false : !remix);
    $("btn-share-open-project")?.classList.toggle("hidden", mode !== "edit");
    if (subEl) {
      subEl.textContent = meta.filename
        ? `with Render Studio · ${meta.filename} · ${shareModeLabel(mode)}`
        : `with Render Studio · ${shareModeLabel(mode)}`;
    }
    const label = $("share-link-perms")?.querySelector("[data-share-perms-label]");
    if (label) label.textContent = shareModeLabel(mode);
    $("share-link-perms-pop")?.querySelectorAll("[data-share-live-mode]")?.forEach((input) => {
      input.checked = input.getAttribute("data-share-live-mode") === mode;
    });
    const join = $("share-link-perms-pop")?.querySelector("[data-share-live-join]");
    if (join) join.checked = !!meta.allow_join;
  }

  function bindShareLinkPerms() {
    const root = $("share-link-perms");
    const btn = $("btn-share-link-perms");
    const pop = $("share-link-perms-pop");
    if (!root || !btn || !pop || !meta.can_manage) return;
    root.classList.remove("hidden");
    applyLiveShareFlags(meta);
    const status = pop.querySelector("[data-share-live-status]");
    async function persist(patch) {
      if (status) status.textContent = "Saving…";
      const res = await fetch(`/api/share/${encodeURIComponent(token)}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Could not update link");
      applyLiveShareFlags(data);
      if (status) status.textContent = "Saved.";
      window.setTimeout(() => {
        if (status?.isConnected && status.textContent === "Saved.") status.textContent = "";
      }, 1400);
    }
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      const open = pop.classList.contains("hidden");
      pop.classList.toggle("hidden", !open);
      btn.setAttribute("aria-expanded", String(open));
    });
    pop.querySelectorAll("[data-share-live-mode]").forEach((input) => {
      input.addEventListener("change", () => {
        const mode = pop.querySelector("[data-share-live-mode]:checked")?.getAttribute("data-share-live-mode") || "view";
        void persist({ share_mode: mode }).catch((err) => {
          if (status) status.textContent = err.message || "Could not save permissions.";
          applyLiveShareFlags(meta);
        });
      });
    });
    pop.querySelector("[data-share-live-join]")?.addEventListener("change", (event) => {
      void persist({ allow_join: !!event.currentTarget.checked }).catch((err) => {
        if (status) status.textContent = err.message || "Could not save join link.";
        applyLiveShareFlags(meta);
      });
    });
    document.addEventListener("click", (event) => {
      if (root.contains(event.target)) return;
      pop.classList.add("hidden");
      btn.setAttribute("aria-expanded", "false");
    });
  }
  bindShareLinkPerms();
  const modeLabel = shareMode === "edit" ? " · Remix and edit" : shareMode === "remix" ? " · Remix only" : " · View only";
  subEl.textContent = meta.filename
    ? `with Render Studio · ${meta.filename}${modeLabel}`
    : `with Render Studio${modeLabel}`;
  if (btnOpen) {
    btnOpen.classList.toggle("hidden", !canRemixOrDownload);
    btnOpen.textContent = isVideoShare ? "Remix video" : "Remix model";
  }
  const btnOpenProject = $("btn-share-open-project");
  if (btnOpenProject) {
    btnOpenProject.classList.toggle("hidden", !canEditShare);
    btnOpenProject.addEventListener("click", () => {
      const join = String(meta.join_url || "").trim();
      const dest = join || `/?project=${encodeURIComponent(meta.project_id || "")}`;
      window.location.href = dest;
    });
  }
  if (btnDownloadMenu) btnDownloadMenu.classList.toggle("hidden", !canDownloadShare);

  exportItems = (Array.isArray(meta.exports) ? [...meta.exports] : []).filter((item) => {
    if (!item?.name) return false;
    if (!item.convertible && typeof item.size === "number" && item.size <= 0) return false;
    return true;
  });
  const seen = new Set(exportItems.map((e) => e.name));
  if (meta.filename && !seen.has(meta.filename)) {
    exportItems.unshift({
      name: meta.filename,
      format: (meta.filename.split(".").pop() || "file").toLowerCase(),
      url: `/api/share/${encodeURIComponent(token)}/files/${encodeProjectFilePath(meta.filename)}`,
      size: null,
    });
  }
  // One Fusion-ready STEP only (same as studio export / admin download).
  {
    const collapsed = [];
    let bestStep = null;
    for (const item of exportItems) {
      const fmt = String(item.format || item.name?.split(".").pop() || "").toLowerCase();
      if (fmt === "stp" || fmt === "step") {
        if (/__faceted/i.test(String(item.name || ""))) continue;
        const score =
          (item.fusion_editable || item.step_structure === "part" || /\.part\.step$/i.test(item.name || "") ? 4 : 0)
          + (item.step_kind === "editable_brep" ? 2 : 0);
        const prev = bestStep
          ? ((bestStep.fusion_editable || bestStep.step_structure === "part" ? 4 : 0)
            + (bestStep.step_kind === "editable_brep" ? 2 : 0))
          : -1;
        if (!bestStep || score >= prev) bestStep = { ...item, format: "step" };
        continue;
      }
      collapsed.push(item);
    }
    if (bestStep) {
      let url = bestStep.url
        || `/api/share/${encodeURIComponent(token)}/files/${encodeProjectFilePath(bestStep.name)}`;
      if (!/[?&]step_mode=/i.test(url)) url += `${url.includes("?") ? "&" : "?"}step_mode=part`;
      const stem = String(bestStep.download_name || bestStep.name || "model")
        .replace(/\.part\.step$/i, ".step")
        .replace(/\.fusionpart\.step$/i, ".step");
      const dlName = /\.ste?p$/i.test(stem) ? stem : `${stem.replace(/\.[^.]+$/, "")}.step`;
      collapsed.push({
        ...bestStep,
        format: "step",
        url,
        name: dlName,
        label: "STEP",
      });
    }
    exportItems = collapsed;
  }
  exportsReady = true;
  renderDownloadMenu(downloadMenuEl);
  renderDownloadMenu($("share-download-list"));

  function renderTimeline() {
    if (!timelineTrackEl) return;
    if (document.body.classList.contains("share-video")) return;
    const rows = Array.isArray(meta.prompt_history) ? [...meta.prompt_history] : [];
    rows.reverse();
    if (!rows.length) {
      timelineTrackEl.innerHTML = `<p class="share-timeline-empty">No timeline edits for this share yet.</p>`;
      return;
    }
    timelineTrackEl.innerHTML = rows.map((entry, index) => {
      const prompt = entry.original_prompt || entry.prompt || "Edit";
      const short = prompt.length > 42 ? `${prompt.slice(0, 42)}…` : prompt;
      const when = formatDateLabel(entry.created_at);
      const status = entry.success === false ? "Failed" : "Built";
      return `
        <button type="button" class="share-timeline-chip" data-prompt-id="${escapeHtml(entry.id || "")}" data-timeline-index="${index}">
          <strong>${escapeHtml(short)}</strong>
          <span>${escapeHtml(status)}${when ? ` · ${escapeHtml(when)}` : ""}</span>
        </button>
      `;
    }).join("");
  }

  const scene = new THREE.Scene();
  const heroEmbedActive = isHeroEmbedMode();
  // Match Getting Started / Docs page canvas (#0d1117) so the hero iframe
  // does not flash a lighter share-page background behind the arm.
  scene.background = new THREE.Color(heroEmbedActive ? 0x0d1117 : 0x070b12);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10000);
  // CAD / share meshes are Z-up — match the main studio.
  camera.up.set(0, 0, 1);
  const filenameHint = `${meta.filename || ""} ${meta.viewer_filename || ""}`;
  const meshAuthored = /(?:^|[\\/])mesh[\\/]/i.test(filenameHint) || /\.mesh\./i.test(filenameHint);
  // Log depth fights Mesh triangle wireframe (and studio already disables it on mobile).
  const needs3D = !isVideoShare && !isLayoutShare && meta.kind !== "code" && !meta.code_root;
  let renderer = null;
  let graphicsError = "";
  let controls = null;
  let shareMeasure = null;
  let shareMeasureAuthor = { id: null, display_name: "Guest", avatar_url: "", handle: "", guest: true };
  function initializeGraphics() {
  if (renderer) return true;
  try {
    renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    powerPreference: "high-performance",
    logarithmicDepthBuffer: !meshAuthored && window.innerWidth > 720,
  });
  } catch (error) {
    graphicsError = "3D preview unavailable in this browser. Downloads and share details are still available.";
    console.warn("Share graphics initialization failed", error);
  }
  if (renderer) {
  if (heroEmbedActive) {
    renderer.setClearColor(0x0d1117, 1);
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  setupRenderer(renderer);
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  if (heroEmbedActive) renderer.domElement.style.background = "#0d1117";
  viewerEl.appendChild(renderer.domElement);

  // Z-up Orbit with full polar range = true 360° tumble (no horizon clip, no trackball roll).
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.85;
  controls.zoomSpeed = 1.05;
  controls.panSpeed = 0.75;
  controls.enablePan = !heroEmbedActive;
  controls.enableZoom = !heroEmbedActive;
  controls.minPolarAngle = 0.001;
  controls.maxPolarAngle = Math.PI - 0.001;
  controls.autoRotate = true;
  controls.autoRotateSpeed = heroEmbedActive ? 0.85 : (isEmbedMode() ? 0.55 : 1.35);
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };

  } else {
    for (const id of ["btn-share-rotate", "btn-share-fit", "btn-share-wireframe", "btn-share-transparent", "btn-share-measure", "btn-share-section"]) {
      const button = $(id);
      if (button) button.disabled = true;
    }
  }

  return !!renderer;
  }
  if (needs3D) initializeGraphics();

  // Match studio balanced CAD lighting.
  scene.add(new THREE.HemisphereLight(0xf4f7fb, 0x556274, 0.88));
  scene.add(new THREE.AmbientLight(0xe6eef6, 0.48));
  const key = new THREE.DirectionalLight(0xfff5ec, 1.12);
  key.position.set(5, -5, 9);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd9e7ff, 0.74);
  fill.position.set(-6, 5, 5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xc5d6ea, 0.52);
  rim.position.set(1, 8, -7);
  scene.add(rim);
  const under = new THREE.DirectionalLight(0xe4eef8, 0.58);
  under.position.set(0, 0, -9);
  scene.add(under);

  const root = new THREE.Group();
  scene.add(root);
  let modelBox = new THREE.Box3();
  let orbitRadius = 2;
  let loadedScene = null;
  const objectsByName = new Map();
  const objectsById = new Map();
  let objectEntries = [];
  const transparentObjects = new Set();
  let wireframeEnabled = false;
  let transparentPickEnabled = false;
  let remixProjectsLoaded = false;
  let remixProjectsLoading = false;

  let section = createSectionController({
    renderer,
    scene,
    getBounds: () => modelBox.clone(),
  });

  function syncCameraClip() {
    if (!controls) return;
    const dist = camera.position.distanceTo(controls.target);
    const radius = Math.max(modelBox?.getSize?.(new THREE.Vector3()).length() * 0.5 || orbitRadius || 1, 0.05);
    const viewDir = camera.getWorldDirection(new THREE.Vector3()).normalize();
    let minDepth = Infinity;
    let maxDepth = -Infinity;
    if (modelBox && !modelBox.isEmpty()) {
      for (const x of [modelBox.min.x, modelBox.max.x]) {
        for (const y of [modelBox.min.y, modelBox.max.y]) {
          for (const z of [modelBox.min.z, modelBox.max.z]) {
            const depth = new THREE.Vector3(x, y, z).sub(camera.position).dot(viewDir);
            minDepth = Math.min(minDepth, depth);
            maxDepth = Math.max(maxDepth, depth);
          }
        }
      }
    }
    const margin = Math.max(radius * 0.08, 0.002);
    let near = Math.max(radius * 0.001, 0.0005);
    if (Number.isFinite(minDepth) && minDepth > 1e-4) {
      // Keep the near plane close to the nearest model surface when zoomed out.
      // A tiny near value plus a very distant far plane causes CAD colors and
      // overlays to z-fight, which looks like faces clipping through each other.
      if (minDepth > margin * 1.5) {
        near = Math.max(near, Math.min(minDepth * 0.9, minDepth - margin));
      } else {
        near = Math.min(near, minDepth * 0.35);
      }
    } else {
      near = Math.min(near, Math.max(dist * 0.00005, 0.00005));
    }
    let far = Math.max(
      Number.isFinite(maxDepth) ? maxDepth + margin * 4 : 0,
      Number.isFinite(minDepth) && minDepth > 1e-4 ? near + radius * 3 : 0,
      orbitRadius * 3,
      radius * 8,
      20,
    );
    const maxRatio = 5e4;
    if (far / Math.max(near, 1e-8) > maxRatio) {
      const cappedNear = far / maxRatio;
      if (Number.isFinite(minDepth) && minDepth > 1e-4) {
        near = Math.min(Math.max(near, cappedNear), minDepth * 0.95);
      } else {
        near = Math.max(near, cappedNear);
      }
    }
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  }

  function hardenShareDepthLayers(object) {
    object?.traverse?.((child) => {
      if (!child?.material) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      if (child.userData?.isSilhouette) {
        child.renderOrder = 0;
        materials.forEach((mat) => {
          if (!mat) return;
          mat.depthTest = true;
          mat.depthWrite = false;
          mat.polygonOffset = true;
          mat.polygonOffsetFactor = 1;
          mat.polygonOffsetUnits = 1;
          mat.needsUpdate = true;
        });
        return;
      }
      if (child.userData?.isEdge) {
        child.renderOrder = 4;
        materials.forEach((mat) => {
          if (!mat) return;
          mat.depthTest = true;
          mat.depthWrite = false;
          mat.needsUpdate = true;
        });
      }
    });
  }

  function frameBox(box, { pad = 1.32 } = {}) {
    if (!box || box.isEmpty()) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 1e-3);
    const fov = THREE.MathUtils.degToRad(camera.fov || 45);
    const aspect = Math.max(camera.aspect || 1, 0.1);
    const fitHeightDistance = radius / Math.sin(fov / 2);
    const fitWidthDistance = radius / Math.sin(Math.atan(Math.tan(fov / 2) * aspect));
    orbitRadius = Math.max(fitHeightDistance, fitWidthDistance) * pad;
    const yaw = Math.PI * 0.22;
    camera.up.set(0, 0, 1);
    camera.position.set(
      orbitRadius * Math.cos(yaw),
      -orbitRadius * Math.sin(yaw),
      orbitRadius * 0.32,
    );
    controls.target.copy(sphere.center);
    controls.minDistance = Math.max(radius * 0.25, 0.01);
    controls.maxDistance = Math.max(orbitRadius * 24, radius * 80, 50);
    syncCameraClip();
    controls.update();
    section.refresh();
  }

  function fitCamera() {
    root.position.set(0, 0, 0);
    modelBox.setFromObject(root);
    if (modelBox.isEmpty()) return;
    const center = modelBox.getCenter(new THREE.Vector3());
    // Center on origin so orbiting under the model stays stable.
    root.position.set(-center.x, -center.y, -center.z);
    modelBox.setFromObject(root);
    frameBox(modelBox, { pad: heroEmbedActive ? 1.08 : 1.38 });
    if (heroEmbedActive) {
      // Seat the arm lower in the frame so it reads as sitting in the page.
      controls.target.z -= orbitRadius * 0.04;
      camera.position.z *= 0.92;
      syncCameraClip();
      controls.update();
    }
  }

  function frameObject(obj) {
    if (!obj) return;
    const box = new THREE.Box3().setFromObject(obj);
    if (box.isEmpty()) return;
    frameBox(box, { pad: 1.6 });
  }

  function meshMaterials(mesh) {
    if (!mesh?.material) return [];
    if (!mesh.userData?._shareUniqueMaterial) {
      if (!mesh.userData) mesh.userData = {};
      mesh.material = Array.isArray(mesh.material)
        ? mesh.material.map((mat) => mat?.clone?.() || mat)
        : mesh.material?.clone?.() || mesh.material;
      mesh.userData._shareUniqueMaterial = true;
    }
    return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  }

  function objectMeshes(obj) {
    const meshes = [];
    obj?.traverse?.((child) => {
      if (!child.isMesh || child.userData?.isEdge || child.userData?.isSilhouette) return;
      meshes.push(child);
    });
    return meshes;
  }

  function syncObjectMaterialState(obj) {
    objectMeshes(obj).forEach((mesh) => meshMaterials(mesh));
    styleSetObjectTransparent(obj, transparentObjects.has(obj), { wireframe: wireframeEnabled });
  }

  function setObjectTransparent(obj, on) {
    if (!obj) return;
    if (on) transparentObjects.add(obj);
    else transparentObjects.delete(obj);
    syncObjectMaterialState(obj);
    renderComponentTree();
  }

  function clearTransparentObjects() {
    const targets = [...transparentObjects];
    transparentObjects.clear();
    targets.forEach(syncObjectMaterialState);
    renderComponentTree();
  }

  function syncWireframe() {
    // Clone shared mats once, then restyle whole tree and re-assert transparent roots.
    objectMeshes(root).forEach((mesh) => meshMaterials(mesh));
    setViewMode(wireframeEnabled ? "wireframe" : "solid", root);
    styleSetObjectTransparent(root, false, { wireframe: wireframeEnabled });
    for (const target of transparentObjects) {
      styleSetObjectTransparent(target, true, { wireframe: wireframeEnabled });
    }
    btnWireframe?.classList.toggle("active", wireframeEnabled);
    btnWireframe?.setAttribute("aria-pressed", String(wireframeEnabled));
  }

  function isDescendantOf(obj, target) {
    let cur = obj;
    while (cur) {
      if (cur === target) return true;
      cur = cur.parent;
    }
    return false;
  }

  function isolateObject(target) {
    objectMeshes(root).forEach((mesh) => {
      mesh.visible = !target || isDescendantOf(mesh, target);
    });
    if (target) frameObject(target);
  }

  function allPickableMeshes() {
    return objectMeshes(root).filter((mesh) => mesh.visible !== false);
  }

  function closestTransparentTarget(mesh) {
    let cur = mesh;
    while (cur && cur !== root) {
      if (objectEntries.some((entry) => entry.obj === cur) && objectMeshes(cur).length) return cur;
      cur = cur.parent;
    }
    return mesh;
  }

  function objectDepth(obj) {
    let depth = 0;
    let cur = obj?.parent;
    while (cur && cur !== root && cur !== loadedScene) {
      if (String(cur.name || "").trim()) depth += 1;
      cur = cur.parent;
    }
    return Math.min(depth, 5);
  }

  function parentLabel(obj) {
    let cur = obj?.parent;
    while (cur && cur !== root && cur !== loadedScene) {
      const label = String(cur.name || "").trim();
      if (label) return label;
      cur = cur.parent;
    }
    return meta.filename || "Shared model";
  }

  function resize() {
    const w = viewerEl.clientWidth || window.innerWidth;
    const h = viewerEl.clientHeight || Math.max(320, window.innerHeight - 120);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
    renderer?.setSize(w, h, false);
  }

  function setStatus(msg, { pct = null } = {}) {
    if (!statusEl) return;
    const copy = $("share-status-copy") || statusEl;
    const track = statusEl.querySelector(".share-load-track");
    const fill = statusEl.querySelector(".share-load-fill");
    if (!msg) {
      statusEl.classList.add("hidden");
      statusEl.hidden = true;
      if (copy && copy !== statusEl) copy.textContent = "";
      else statusEl.textContent = "";
      track?.setAttribute("hidden", "");
      if (fill) fill.style.width = "0%";
      return;
    }
    statusEl.hidden = false;
    statusEl.classList.remove("hidden");
    if (copy && copy !== statusEl) copy.textContent = msg;
    else statusEl.textContent = msg;
    const hasPct = pct != null && Number.isFinite(Number(pct)) && Number(pct) >= 0;
    if (hasPct && track && fill) {
      const clamped = Math.max(2, Math.min(100, Number(pct)));
      fill.style.width = `${clamped}%`;
      track.removeAttribute("hidden");
    } else {
      track?.setAttribute("hidden", "");
      if (fill) fill.style.width = "0%";
    }
  }

  function setMobileToolsOpen(open) {
    if (open && !document.body.classList.contains("share-viewer-expanded")) {
      document.body.classList.add("share-viewer-expanded");
      syncMobileFullscreenLabel();
    }
    document.body.classList.toggle("share-mobile-tools-open", !!open);
    btnMobileTools?.setAttribute("aria-expanded", String(!!open));
    btnMobileTools?.classList.toggle("active", !!open);
    for (const delay of [0, 80, 220]) {
      window.setTimeout(() => {
        resize();
        controls?.update();
      }, delay);
    }
  }

  function syncMobileFullscreenLabel() {
    const expanded = document.body.classList.contains("share-viewer-expanded");
    for (const btn of [btnMobileFullscreen, btnShareFullscreen]) {
      if (!btn) continue;
      btn.setAttribute("aria-pressed", String(expanded));
      btn.classList.toggle("active", expanded);
      btn.textContent = expanded ? "Exit full screen" : "Full screen";
    }
  }

  function setShareViewerExpanded(expanded) {
    document.body.classList.toggle("share-viewer-expanded", !!expanded);
    if (expanded) setMobileToolsOpen(false);
    syncMobileFullscreenLabel();
    for (const delay of [0, 80, 220]) {
      window.setTimeout(() => {
        resize();
        fitCamera();
      }, delay);
    }
  }

  function syncSectionAvailability() {
    const available = Boolean(loadedScene);
    if (btnSection) {
      btnSection.disabled = !available;
      btnSection.title = available
        ? "Cut through the loaded 3D preview"
        : "Section analysis is available after a GLB preview loads.";
      btnSection.classList.toggle("disabled", !available);
    }
    if (!available && section.isActive()) {
      section.deactivate();
      syncSectionUi(false);
    }
  }
  syncSectionAvailability();

  function setTransparentTipVisible(on) {
    transparentTip?.classList.toggle("hidden", !on);
  }

  function modelLabel(item = {}) {
    const provider = item.provider ? String(item.provider).toUpperCase() : "";
    const model = item.model || item.ai_model || "";
    return [provider, model].filter(Boolean).join(" · ") || "Model not recorded";
  }

  function formatDateLabel(raw) {
    if (!raw) return "";
    try {
      return new Date(raw).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch {
      return String(raw);
    }
  }

  function renderShareDetails() {
    if (!promptHistoryEl) return;
    const rows = Array.isArray(meta.prompt_history) ? meta.prompt_history : [];
    const owner = shareHistoryOwnerEntry(meta);
    const hasAuthors = rows.some((entry) => shareHistoryAuthorId(entry));
    const ownerRow = !hasAuthors && (owner.user_id || owner.user_name)
      ? `<article class="sv-history-card sv-history-owner">${shareHistoryWhoRowHtml(owner, { prefix: "Shared by" })}</article>`
      : "";
    if (!rows.length) {
      promptHistoryEl.innerHTML = `${ownerRow}<p class="sv-hint">No prompt history was recorded for this shared model.</p>`;
      return;
    }
    promptHistoryEl.innerHTML = ownerRow + rows.map((entry) => {
      const prompt = entry.original_prompt || entry.prompt || "Prompt unavailable";
      const file = entry.filename || entry.base_filename || "";
      const when = formatDateLabel(entry.created_at);
      const whoRow = shareHistoryWhoRowHtml(entry);
      const status = entry.success === false ? "Failed" : "Built";
      const fileUrl = file
        ? `/api/share/${encodeURIComponent(token)}/files/${encodeProjectFilePath(file)}`
        : "";
      return `
        <article class="sv-history-card" data-prompt-id="${escapeHtml(entry.id || "")}">
          ${whoRow}
          <strong>${escapeHtml(prompt)}</strong>
          <div class="sv-history-meta">${escapeHtml(modelLabel(entry))}${entry.speed ? ` · ${escapeHtml(entry.speed)}` : ""} · ${escapeHtml(status)}${when ? ` · ${escapeHtml(when)}` : ""}</div>
          ${fileUrl ? `
            <details class="sv-history-built">
              <summary>Built component</summary>
              <a href="${escapeHtml(fileUrl)}" download="${escapeHtml(file)}">${escapeHtml(file)}</a>
            </details>
          ` : ""}
        </article>
      `;
    }).join("");
  }

  resize();

  const viewerUrl = meta.viewer_url
    || (meta.viewer_filename
      ? `/api/share/${encodeURIComponent(token)}/files/${encodeProjectFilePath(meta.viewer_filename)}`
      : "");
  const canPreview = !!renderer && /\.glb$/i.test(meta.viewer_filename || viewerUrl || "");
  const isCodeShare = meta.kind === "code" || !!meta.code_root;
  let shareComments = Array.isArray(meta.comments) ? meta.comments : [];
  let markupRevisions = Array.isArray(meta.markup_revisions) ? meta.markup_revisions : [];
  let viewerMarkupsOn = true;
  let videoMarkup = null;
  const videoEl = $("share-video");
  const videoStage = $("share-video-stage");
  const commentForm = $("share-comment-form");
  const commentInput = $("share-comment-input");
  const commentHistoryEl = $("share-comment-history");

  function renderShareComments() {
    const showComments = $("share-hist-comments")?.checked !== false;
    const showPrompts = $("share-hist-prompts")?.checked !== false;
    if (promptHistoryEl) promptHistoryEl.classList.toggle("hidden", !showPrompts);
    if (commentHistoryEl) {
      commentHistoryEl.classList.toggle("hidden", !showComments);
      commentHistoryEl.innerHTML = showComments
        ? shareComments.map((row) => shareHistoryCommentCardHtml(row)).join("")
        : "";
    }
    const markersEl = $("share-waveform-markers");
    if (markersEl) {
      const models = viewerMarkupsOn ? commentMarkerModels(shareComments, videoEl?.duration) : [];
      markersEl.innerHTML = models.map(commentMarkerHtml).join("");
    }
    renderMarkupUndoStrip();
    if (videoStage) {
      videoStage.querySelectorAll(".share-video-pin").forEach((el) => el.remove());
    }
    videoMarkup?.paint?.();
  }

  $("share-hist-comments")?.addEventListener("change", renderShareComments);
  $("share-hist-prompts")?.addEventListener("change", renderShareComments);

  async function postShareComment(payload) {
    const res = await fetch(`/api/share/${encodeURIComponent(token)}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Could not comment");
    shareComments = data.comments || shareComments;
    if (Array.isArray(data.markup_revisions)) markupRevisions = data.markup_revisions;
    renderShareComments();
    videoMarkup?.paint?.();
  }

  function renderMarkupUndoStrip() {
    const strip = $("share-markup-undo");
    const track = $("share-markup-undo-track");
    if (!strip || !track) return;
    const rows = markupRevisions.length ? markupRevisions : shareComments.filter((row) => row?.tool || ["markup", "pin"].includes(String(row?.kind || "")));
    strip.classList.toggle("hidden", !rows.length);
    const dur = Math.max(0.001, Number(videoEl?.duration) || commentsDurationFallback(rows));
    track.innerHTML = rows.map((row) => {
      const t = Math.max(0, Number(row.t || 0));
      const left = Math.min(99.2, Math.max(0.8, (t / dur) * 100));
      const id = escapeHtml(row.id || "");
      return `<button type="button" class="share-markup-undo-pt" style="left:${left.toFixed(2)}%" data-revision-id="${id}" data-share-seek="${t}" title="Restore ${t.toFixed(1)}s"></button>`;
    }).join("");
  }

  function commentsDurationFallback(rows) {
    let maxT = 1;
    for (const row of rows || []) {
      const t = Number(row?.t || 0);
      if (t > maxT) maxT = t;
    }
    return maxT;
  }

  async function deleteShareComment(commentId) {
    const res = await fetch(`/api/share/${encodeURIComponent(token)}/comments/${encodeURIComponent(commentId)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Could not delete markup");
    shareComments = data.comments || shareComments.filter((row) => String(row.id) !== String(commentId));
    if (Array.isArray(data.markup_revisions)) markupRevisions = data.markup_revisions;
    renderShareComments();
    videoMarkup?.paint?.();
  }

  async function restoreShareRevision(revisionId, t) {
    const res = await fetch(`/api/share/${encodeURIComponent(token)}/comments/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ revision_id: revisionId || "", t }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Could not restore markups");
    shareComments = data.comments || shareComments;
    if (Array.isArray(data.markup_revisions)) markupRevisions = data.markup_revisions;
    renderShareComments();
    videoMarkup?.paint?.();
  }

  async function clearShareMarkups() {
    const res = await fetch(`/api/share/${encodeURIComponent(token)}/comments/clear-markups`, {
      method: "POST",
      headers: authHeaders(),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Could not reset markups");
    shareComments = data.comments || [];
    if (Array.isArray(data.markup_revisions)) markupRevisions = data.markup_revisions;
    renderShareComments();
    videoMarkup?.paint?.();
  }

  if (isVideoShare && videoEl && videoStage) {
    document.body.classList.add("share-video");
    document.documentElement.classList.add("share-video");
    videoStage.classList.remove("hidden");
    $("share-video-timeline")?.classList.remove("hidden");
    commentForm?.classList.remove("hidden");
    const waveformEl = $("share-video-waveform");
    const waveTrack = $("share-waveform-track");
    const waveBars = $("share-waveform-bars");
    const wavePlayed = $("share-waveform-played");
    const waveMarkers = $("share-waveform-markers");
    waveformEl?.classList.remove("hidden");
    const paintWaveBars = (seed = 1) => {
      const html = waveformBarsHtml(waveformBarHeights(96, seed));
      if (waveBars) waveBars.innerHTML = html;
      if (wavePlayed) wavePlayed.innerHTML = html;
    };
    paintWaveBars(1);
    const syncWavePlayhead = () => {
      const pct = playheadPlayedPct(videoEl.currentTime, videoEl.duration);
      if (waveTrack) {
        waveTrack.style.setProperty("--played", `${pct}%`);
        waveTrack.setAttribute("aria-valuenow", String(Math.round(Number(videoEl.currentTime) || 0)));
        waveTrack.setAttribute("aria-valuemax", String(Math.round(Number(videoEl.duration) || 0)));
      }
    };
    videoEl.src = viewerUrl || `/api/share/${encodeURIComponent(token)}/files/${encodeProjectFilePath(meta.filename)}`;
    statusEl?.classList.add("hidden");
    $("share-markup-tools")?.classList.remove("hidden");
    videoMarkup = createShareVideoMarkup({
      stage: videoStage,
      video: videoEl,
      overlay: $("share-video-markup"),
      svg: $("share-video-markup-svg"),
      notesLayer: $("share-video-markup-notes"),
      logosLayer: $("share-video-markup-logos"),
      toolsRoot: $("share-markup-tools"),
      noteDialog: $("share-markup-note"),
      noteInput: $("share-markup-note-text"),
      getComments: () => (viewerMarkupsOn ? shareComments : []),
      postComment: (payload) => postShareComment(payload),
      getAuthor: () => {
        const me = getStoredUser() || {};
        return {
          id: me.id || "",
          display_name: me.display_name || me.email || "Guest",
          avatar_url: me.avatar_url || (me.id ? `/api/users/${encodeURIComponent(me.id)}/avatar` : ""),
        };
      },
    });
    const markupViewBtn = $("btn-share-markup-view");
    const syncMarkupViewBtn = () => {
      document.body.classList.toggle("share-hide-markups", !viewerMarkupsOn);
      markupViewBtn?.classList.toggle("active", viewerMarkupsOn);
      markupViewBtn?.setAttribute("aria-pressed", String(viewerMarkupsOn));
      if (markupViewBtn) markupViewBtn.textContent = viewerMarkupsOn ? "Markups on" : "Markups off";
      renderShareComments();
    };
    syncMarkupViewBtn();
    markupViewBtn?.addEventListener("click", () => {
      viewerMarkupsOn = !viewerMarkupsOn;
      syncMarkupViewBtn();
    });
    $("share-markup-tools")?.addEventListener("click", () => {
      if (viewerMarkupsOn) return;
      viewerMarkupsOn = true;
      syncMarkupViewBtn();
    });
    videoStage.addEventListener("click", (event) => {
      const hit = event.target.closest?.("[data-markup-id]");
      if (hit) {
        videoMarkup?.selectMark?.(hit.getAttribute("data-markup-id"));
        const t = Number(hit.getAttribute("data-share-seek"));
        if (Number.isFinite(t)) videoEl.currentTime = t;
        return;
      }
      if (videoMarkup?.getTool?.() !== "select") return;
      if (!event.target.closest?.(".share-video-frame")) return;
      if (!viewerMarkupsOn) {
        viewerMarkupsOn = true;
        syncMarkupViewBtn();
      }
      const rect = (event.target.closest(".share-video-frame") || videoStage).getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)));
      const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height)));
      videoMarkup?.placeComment?.({ x, y }, Number(videoEl.currentTime) || 0);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Backspace") return;
      const tag = String(event.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || event.target?.isContentEditable) return;
      const id = videoMarkup?.getSelected?.();
      if (!id) return;
      event.preventDefault();
      void deleteShareComment(id).catch(() => {});
    });
    $("share-markup-undo-track")?.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      const pt = event.target.closest?.("[data-revision-id], [data-share-seek]");
      if (!pt) return;
      void restoreShareRevision(pt.getAttribute("data-revision-id"), Number(pt.getAttribute("data-share-seek"))).catch(() => {});
    });
    $("share-markup-undo-track")?.addEventListener("click", (event) => {
      const pt = event.target.closest?.("[data-share-seek]");
      if (!pt || !videoEl) return;
      const t = Number(pt.getAttribute("data-share-seek"));
      if (Number.isFinite(t)) videoEl.currentTime = t;
    });
    $("share-waveform-track")?.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (!window.confirm("Clear markup overlays from this timeline? The video file stays.")) return;
      void clearShareMarkups().catch(() => {});
    });
    panelHistoryEl?.addEventListener("click", (event) => {
      if (event.target.closest?.("[data-share-profile-id], [data-share-profile-handle]")) return;
      const seekEl = event.target.closest?.("[data-share-seek]");
      if (!seekEl || !videoEl) return;
      const t = Number(seekEl.getAttribute("data-share-seek"));
      if (Number.isFinite(t)) videoEl.currentTime = t;
    });
    commentForm?.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const text = String(commentInput?.value || "").trim();
      if (!text) return;
      void postShareComment({ text, t: videoEl.currentTime || 0, kind: "comment" }).then(() => {
        if (commentInput) commentInput.value = "";
      }).catch((err) => {
        if (commentInput) commentInput.placeholder = err.message || "Could not comment";
      });
    });
    videoEl.addEventListener("timeupdate", syncWavePlayhead);
    videoEl.addEventListener("seeked", syncWavePlayhead);
    videoEl.addEventListener("loadedmetadata", () => {
      paintWaveBars(Math.round((videoEl.duration || 1) * 10));
      syncWavePlayhead();
      renderShareComments();
    });
    let waveDragging = false;
    const seekWaveFromEvent = (event) => {
      if (event.target?.closest?.(".share-wave-mark")) return;
      if (!waveTrack) return;
      videoEl.currentTime = seekTimeFromClientX(event.clientX, waveTrack.getBoundingClientRect(), videoEl.duration);
      syncWavePlayhead();
    };
    waveTrack?.addEventListener("pointerdown", (event) => {
      if (event.target?.closest?.(".share-wave-mark")) return;
      waveDragging = true;
      waveTrack.setPointerCapture?.(event.pointerId);
      seekWaveFromEvent(event);
    });
    waveTrack?.addEventListener("pointermove", (event) => {
      if (!waveDragging) return;
      seekWaveFromEvent(event);
    });
    const endWaveDrag = () => { waveDragging = false; };
    waveTrack?.addEventListener("pointerup", endWaveDrag);
    waveTrack?.addEventListener("pointercancel", endWaveDrag);
    waveTrack?.addEventListener("keydown", (event) => {
      const dur = Number(videoEl.duration) || 0;
      const now = Number(videoEl.currentTime) || 0;
      if (event.key === "ArrowRight") {
        event.preventDefault();
        videoEl.currentTime = Math.min(dur, now + 2);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        videoEl.currentTime = Math.max(0, now - 2);
      } else if (event.key === "Home") {
        event.preventDefault();
        videoEl.currentTime = 0;
      } else if (event.key === "End") {
        event.preventDefault();
        videoEl.currentTime = dur;
      }
      syncWavePlayhead();
    });
    waveMarkers?.addEventListener("click", (event) => {
      const mark = event.target.closest(".share-wave-mark");
      if (!mark) return;
      event.preventDefault();
      event.stopPropagation();
      const t = Number(mark.dataset.t);
      if (Number.isFinite(t)) videoEl.currentTime = t;
      const opening = !mark.classList.contains("is-open");
      waveMarkers.querySelectorAll(".share-wave-mark.is-open").forEach((el) => el.classList.remove("is-open"));
      if (opening) mark.classList.add("is-open");
      syncWavePlayhead();
    });
    document.addEventListener("click", (event) => {
      if (event.target.closest?.(".share-wave-mark")) return;
      waveMarkers?.querySelectorAll(".share-wave-mark.is-open").forEach((el) => el.classList.remove("is-open"));
    });
    renderShareComments();
    syncWavePlayhead();
  }

  function renderComponentTree() {
    if (!componentListEl) return;
    const browserComponents = Array.isArray(meta.browser?.components) ? meta.browser.components : [];
    const visibleSet = new Set(
      (Array.isArray(meta.visible_filenames) ? meta.visible_filenames : [])
        .map((name) => String(name || "").split("#")[0].trim())
        .filter(Boolean)
        .map((name) => name.toLowerCase()),
    );
    const hiddenSet = new Set(
      (Array.isArray(meta.hidden_filenames) ? meta.hidden_filenames : [])
        .map((name) => String(name || "").split("#")[0].trim())
        .filter(Boolean)
        .map((name) => name.toLowerCase()),
    );
    const rows = [];
    objectsByName.clear();
    objectsById.clear();
    objectEntries = [];
    if (loadedScene) {
      loadedScene.traverse((obj) => {
        if (!obj.isMesh) return;
        const label = String(obj.name || "").trim();
        if (label && !objectsByName.has(label)) objectsByName.set(label, obj);
      });
    }
    let serial = 0;
    const addRow = (row) => {
      const id = row.obj ? `obj-${++serial}` : `meta-${++serial}`;
      const item = { ...row, id };
      rows.push(item);
      if (row.obj) {
        objectEntries.push(item);
        objectsById.set(id, row.obj);
      }
    };
    for (const item of browserComponents) {
      const name = item.name || item.filename || item.stem || item.label;
      if (!name) continue;
      const keys = [name, item.viewer_filename, item.source_filename, item.filename, item.stem]
        .map((v) => String(v || "").split("#")[0].trim())
        .filter(Boolean);
      const keyLower = keys.map((k) => k.toLowerCase());
      if (visibleSet.size && !keyLower.some((k) => visibleSet.has(k) || visibleSet.has(k.replace(/\.[^.]+$/, "")))) {
        // Also allow stem match against visible basenames.
        const stems = keyLower.map((k) => k.replace(/\.[^.]+$/, ""));
        const visibleStems = [...visibleSet].map((k) => k.replace(/\.[^.]+$/, ""));
        if (!stems.some((s) => visibleStems.includes(s))) continue;
      }
      if (hiddenSet.size && keyLower.some((k) => hiddenSet.has(k))) continue;
      const obj = objectsByName.get(name) || objectsByName.get(item.viewer_filename) || null;
      addRow({
        label: PathBasename(name),
        kind: "part",
        obj,
        depth: obj ? objectDepth(obj) : 0,
      });
    }
    if (!rows.length && loadedScene) {
      objectsByName.forEach((obj, label) => {
        const lower = String(label || "").toLowerCase();
        const stem = lower.replace(/\.[^.]+$/, "");
        if (hiddenSet.has(lower) || hiddenSet.has(stem)) return;
        if (visibleSet.size) {
          const visibleStems = [...visibleSet].map((k) => k.replace(/\.[^.]+$/, ""));
          if (![...visibleSet].includes(lower) && !visibleStems.includes(stem)) return;
        }
        addRow({
          label: PathBasename(label),
          kind: "part",
          obj,
          depth: objectDepth(obj),
        });
      });
    }
    const unique = [];
    const seenRows = new Set();
    for (const row of rows) {
      const key = row.label.toLowerCase();
      if (seenRows.has(key)) continue;
      seenRows.add(key);
      unique.push(row);
      if (unique.length >= 80) break;
    }
    if (!unique.length) {
      componentListEl.innerHTML = `<p class="sv-hint">No parts found in this share.</p>`;
      return;
    }
    componentListEl.innerHTML = unique.map((row) => {
      const canAct = !!row.obj;
      const isTransparent = canAct && transparentObjects.has(row.obj);
      const depth = Math.max(0, Math.min(5, Number(row.depth) || 0));
      return `
        <div class="sv-tree-node${isTransparent ? " is-transparent" : ""}" style="--depth:${depth}">
          <button type="button" class="sv-tree-btn" data-action="frame" data-target="${escapeHtml(row.id)}">
            <span class="sv-tree-glyph" aria-hidden="true">P</span>
            <span class="sv-tree-main">
              <strong>${escapeHtml(row.label)}</strong>
            </span>
          </button>
          ${canAct ? `
            <div class="sv-tree-actions">
              <button type="button" class="sv-mini-btn" data-action="only" data-target="${escapeHtml(row.id)}" title="Show only this part">Only</button>
              <button type="button" class="sv-mini-btn${isTransparent ? " active" : ""}" data-action="transparent" data-target="${escapeHtml(row.id)}" title="Toggle transparency">
                ${isTransparent ? "Solid" : "Fade"}
              </button>
            </div>
          ` : ""}
        </div>
      `;
    }).join("");
  }

  function PathBasename(name) {
    const raw = String(name || "");
    const parts = raw.split(/[\\/]/);
    return parts[parts.length - 1] || raw;
  }

  function renderJointSliders(runtime) {
    if (!jointListEl) return;
    const state = runtime?.getState?.();
    const joints = (state?.urdf?.joints || []).filter((joint) => {
      const type = String(joint.type || "").toLowerCase();
      return type === "revolute" || type === "continuous" || type === "prismatic";
    });
    if (!joints.length) {
      jointListEl.innerHTML = `<p class="sv-hint">No movable joints in this URDF.</p>`;
      return;
    }
    const values = state.jointValuesRad || {};
    jointListEl.innerHTML = joints.map((joint) => {
      const lower = Number.isFinite(Number(joint.lower)) ? Number(joint.lower) : -Math.PI;
      const upper = Number.isFinite(Number(joint.upper)) ? Number(joint.upper) : Math.PI;
      const value = Number.isFinite(Number(values[joint.name])) ? Number(values[joint.name]) : 0;
      const isPrism = String(joint.type || "").toLowerCase() === "prismatic";
      const display = isPrism ? value.toFixed(3) : `${((value * 180) / Math.PI).toFixed(0)}°`;
      return `
        <div class="sv-joint-row" data-joint="${escapeHtml(joint.name)}">
          <label>${escapeHtml(joint.name)} <small style="color:var(--muted)">${escapeHtml(joint.type || "")}</small></label>
          <input type="range" min="${lower}" max="${upper}" step="${isPrism ? 0.001 : 0.01}" value="${value}" data-joint-slider="${escapeHtml(joint.name)}" />
          <em data-joint-value>${display}</em>
        </div>
      `;
    }).join("");
  }

  renderShareDetails();
  renderTimeline();

  function shareFileUrl(name) {
    return `/api/share/${encodeURIComponent(token)}/files/${encodeProjectFilePath(name)}`;
  }

  function renderShareRigPicker() {
    if (!shareRigList) return;
    const q = shareRigSearch?.value || "";
    const rows = filterRigs(shareRigs, q);
    shareRigList.innerHTML = rows.length
      ? rows.map((rig) => `<button type="button" class="cad-rig-picker-item" data-rig-id="${escapeHtml(rig.id)}" aria-selected="${rig.id === shareActiveRigId ? "true" : "false"}"><strong>${escapeHtml(rig.name)}</strong><small>${escapeHtml(rigKindLabel(rig.kind))}${rig.source ? ` · ${escapeHtml(rig.source)}` : ""}</small></button>`).join("")
      : `<p class="sv-hint">No matching rigs.</p>`;
  }

  function setSharePlayingUi(playing) {
    sharePlaying = !!playing;
    if (btnSharePlay) {
      btnSharePlay.textContent = sharePlaying ? "Stop" : "Play";
      btnSharePlay.setAttribute("aria-pressed", sharePlaying ? "true" : "false");
    }
    if (btnMotionPlay) btnMotionPlay.textContent = sharePlaying ? "Stop" : "Play";
  }

  function revealSharePlayChrome({ many = false } = {}) {
    sharePlayWrap?.classList.remove("hidden");
    btnSharePlay?.classList.remove("hidden");
    btnShareDrag?.classList.remove("hidden");
    if (many) btnSharePlayMenu?.classList.remove("hidden");
    else btnSharePlayMenu?.classList.add("hidden");
  }

  function bindShareGltfClips(gltf, target) {
    shareGltfClips = Array.isArray(gltf?.animations) ? gltf.animations.filter((clip) => clip?.duration > 0) : [];
    if (shareMixer) {
      try { shareMixer.stopAllAction(); } catch (_) { /* ignore */ }
      shareMixer = null;
    }
    if (shareGltfClips.length && target) {
      shareMixer = new THREE.AnimationMixer(target);
    }
    return shareGltfClips.map((clip) => clip.name || "clip");
  }

  function stopShareMotion() {
    if (shareMixer) {
      try { shareMixer.stopAllAction(); } catch (_) { /* ignore */ }
    }
    if (robotRuntime?.isPlaying?.()) {
      try { robotRuntime.stopTrajectory?.(); } catch (_) { /* ignore */ }
    }
    shareProcedural = null;
    setSharePlayingUi(false);
  }

  function setShareDrag(on) {
    shareDragOn = !!on;
    btnShareDrag?.classList.toggle("active", shareDragOn);
    btnShareDrag?.setAttribute("aria-pressed", shareDragOn ? "true" : "false");
    if (controls) controls.enabled = !shareDragOn;
    if (shareDragOn) stopShareMotion();
  }

  function startShareProcedural(kind) {
    const target = loadedScene || root;
    if (!target) return false;
    const kids = [];
    target.traverse((node) => { if (node.isMesh && node !== target) kids.push(node); });
    if (!kids.length) return false;
    const bases = kids.slice(0, 24).map((node) => ({ node, quat: node.quaternion.clone(), pos: node.position.clone() }));
    shareProcedural = { kind: kind || "open_close", started: performance.now(), bases };
    return true;
  }

  function startShareGltfClip(name) {
    if (!shareMixer || !shareGltfClips.length) return false;
    const clip = shareGltfClips.find((c) => !name || c.name === name) || shareGltfClips[0];
    if (!clip) return false;
    try { shareMixer.stopAllAction(); } catch (_) { /* ignore */ }
    const action = shareMixer.clipAction(clip);
    action.reset();
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.play();
    return true;
  }

  function startShareMotion() {
    shareClock.getDelta();
    const rig = shareRigs.find((r) => r.id === shareActiveRigId) || shareRigs[0];
    if (shareMixer) {
      try { shareMixer.stopAllAction(); } catch (_) { /* ignore */ }
    }
    if (robotRuntime?.isPlaying?.()) {
      try { robotRuntime.stopTrajectory?.(); } catch (_) { /* ignore */ }
    }
    shareProcedural = null;
    if (rig?.kind === "mesh" || rig?.kind === "step") {
      if (startShareGltfClip(rig?.animationId || rig?.name)) {
        setSharePlayingUi(true);
        return;
      }
    }
    if (robotRuntime && (!rig || rig.kind === "urdf" || rig.urdfFile)) {
      if (robotRuntime.isPlaying?.()) robotRuntime.stopTrajectory?.();
      const playing = robotRuntime.togglePlay({ durationSec: 4.2 });
      setSharePlayingUi(!!playing);
      if (playing) return;
    }
    if (startShareProcedural(rig?.kind)) {
      setSharePlayingUi(true);
      return;
    }
    if (startShareGltfClip(null)) {
      setSharePlayingUi(true);
      return;
    }
    setSharePlayingUi(false);
  }

  function playShareRig() {
    if (sharePlaying) {
      stopShareMotion();
      return;
    }
    startShareMotion();
  }

  function updateShareMotion(now) {
    if (!sharePlaying) {
      if (shareMixer) shareMixer.update(0);
      return;
    }
    const dt = Math.min(shareClock.getDelta(), 0.05);
    if (shareMixer) shareMixer.update(dt);
    if (shareProcedural?.bases) {
      const t = (((now || performance.now()) - shareProcedural.started) % 3600) / 3600;
      const kind = shareProcedural.kind || "open_close";
      shareProcedural.bases.forEach((row, i) => {
        if (kind === "vortex") {
          row.node.quaternion.copy(row.quat);
          row.node.rotateOnWorldAxis(new THREE.Vector3(0, 0, 1), t * Math.PI * 2);
        } else if (kind === "assemble") {
          const from = 1 - (t < 0.5 ? t * 2 : (1 - t) * 2);
          row.node.position.copy(row.pos).add(new THREE.Vector3((i % 2 ? 1 : -1) * 12 * from, 0, 6 * from));
        } else {
          row.node.quaternion.copy(row.quat);
          row.node.rotateOnAxis(new THREE.Vector3(1, 0, 0), Math.sin(t * Math.PI * 2) * 0.7);
        }
      });
    }
  }

  function driveShareRig(dx) {
    const amount = dx * 0.012;
    if (robotRuntime?.isLoaded?.()) {
      const joints = (robotRuntime.getState?.()?.urdf?.joints || []).filter(
        (j) => ["revolute", "continuous", "prismatic"].includes(String(j.type || "").toLowerCase()),
      );
      const joint = joints[0];
      if (joint) {
        const cur = Number(robotRuntime.getState?.()?.jointValuesRad?.[joint.name] || 0);
        robotRuntime.setJointValue(joint.name, cur + amount);
        return;
      }
    }
    const target = loadedScene || root;
    target?.traverse((node) => {
      if (node.isMesh && node !== target) node.rotateOnAxis(new THREE.Vector3(1, 0, 0), amount);
    });
  }

  async function loadSharedRobot() {
    const artifacts = Array.isArray(meta.robot?.artifacts) ? meta.robot.artifacts : [];
    const names = artifacts.map((item) => item.name).filter(Boolean);
    let sidecar = null;
    const sidecarItem = artifacts.find((item) => /\.rigs\.json$/i.test(item.name || ""));
    if (sidecarItem?.url || sidecarItem?.name) {
      try {
        const res = await fetch(sidecarItem.url || shareFileUrl(sidecarItem.name));
        if (res.ok) sidecar = await res.json();
      } catch (_) { /* optional */ }
    }
    shareRigs = mergeDiscoveredRigs({
      sidecar,
      files: names,
      urdfFiles: names.filter((n) => /\.urdf$/i.test(n)),
      srdfFiles: names.filter((n) => /\.srdf$/i.test(n)),
      stepAnimations: shareGltfClips.map((clip) => clip.name || "clip"),
      stepModule: "gltf",
    });
    if (shareGltfClips.length && !shareRigs.some((r) => r.kind === "mesh" || r.kind === "step")) {
      shareGltfClips.forEach((clip, i) => {
        shareRigs.push({
          id: clip.name || `clip_${i + 1}`,
          name: clip.name || `Clip ${i + 1}`,
          kind: "mesh",
          source: "gltf",
          animationId: clip.name || null,
        });
      });
    }
    shareActiveRigId = shareRigs[0]?.id || "";
    const urdf = artifacts.find((item) => /\.urdf$/i.test(item.name || ""));
    const srdf = artifacts.find((item) => /\.srdf$/i.test(item.name || ""));
    const hasMotion = shareRigs.length > 0 || !!urdf || shareGltfClips.length > 0;
    if (hasMotion) {
      revealSharePlayChrome({ many: shareRigs.length > 1 || shareGltfClips.length > 1 });
      motionCard?.classList.remove("hidden");
      if (motionStatus) {
        motionStatus.textContent = shareRigs.length
          ? `${shareRigs.length} rig${shareRigs.length === 1 ? "" : "s"} — paused until Play`
          : "Motion available — paused until Play";
      }
    }
    if (!urdf && !shareRigs.length && !shareGltfClips.length) return;
    try {
      if (urdf) {
        if (motionStatus && !shareRigs.length) motionStatus.textContent = "Loading URDF motion…";
        robotRuntime = createUrdfRobotRuntime({ scene });
        await robotRuntime.loadFromUrls({
          urdfUrl: urdf.url,
          urdfFile: urdf.name,
          srdfUrl: srdf?.url || null,
          srdfFile: srdf?.name || null,
          resolveFileUrl: (name) => shareFileUrl(name),
        });
        const state = robotRuntime.getState();
        const movable = (state.urdf?.joints || []).filter((joint) => !/fixed/i.test(joint.type || "")).length;
        if (motionStatus && !shareRigs.length) motionStatus.textContent = `${state.urdf?.name || "Robot"} · ${movable} joints`;
        renderJointSliders(robotRuntime);
      }
      const onPlay = () => playShareRig();
      btnSharePlay?.addEventListener("click", onPlay);
      btnMotionPlay?.addEventListener("click", onPlay);
      btnSharePlayMenu?.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!shareRigPicker) return;
        const hidden = !shareRigPicker.classList.contains("hidden");
        shareRigPicker.classList.toggle("hidden", hidden);
        btnSharePlayMenu.setAttribute("aria-expanded", hidden ? "false" : "true");
        if (!hidden) {
          renderShareRigPicker();
          const rect = btnSharePlayMenu.getBoundingClientRect();
          shareRigPicker.style.left = `${Math.max(8, rect.left)}px`;
          shareRigPicker.style.top = `${rect.bottom + 8}px`;
          shareRigSearch?.focus();
        }
      });
      shareRigSearch?.addEventListener("input", renderShareRigPicker);
      shareRigList?.addEventListener("click", (event) => {
        const item = event.target.closest("[data-rig-id]");
        if (!item) return;
        shareActiveRigId = item.getAttribute("data-rig-id") || "";
        renderShareRigPicker();
        shareRigPicker?.classList.add("hidden");
        startShareMotion();
      });
      btnShareDrag?.addEventListener("click", () => setShareDrag(!shareDragOn));
      btnMotionReset?.addEventListener("click", () => {
        stopShareMotion();
        robotRuntime?.resetPose?.();
        renderJointSliders(robotRuntime);
      });
      jointListEl?.addEventListener("input", (event) => {
        const input = event.target.closest("[data-joint-slider]");
        if (!input || !robotRuntime) return;
        const name = input.getAttribute("data-joint-slider");
        const value = Number(input.value);
        robotRuntime.setJointValue(name, value);
        const row = input.closest(".sv-joint-row");
        const joint = (robotRuntime.getState()?.urdf?.joints || []).find((j) => j.name === name);
        const isPrism = String(joint?.type || "").toLowerCase() === "prismatic";
        const label = row?.querySelector("[data-joint-value]");
        if (label) label.textContent = isPrism ? value.toFixed(3) : `${((value * 180) / Math.PI).toFixed(0)}°`;
      });
      renderer?.domElement?.addEventListener("pointerdown", (event) => {
        if (!shareDragOn || event.button !== 0) return;
        shareDrag = { id: event.pointerId, x: event.clientX };
        controls.enabled = false;
        renderer.domElement.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      });
      renderer?.domElement?.addEventListener("pointermove", (event) => {
        if (!shareDrag || event.pointerId !== shareDrag.id) return;
        driveShareRig(event.clientX - shareDrag.x);
        shareDrag.x = event.clientX;
      });
      renderer?.domElement?.addEventListener("pointerup", (event) => {
        if (!shareDrag || event.pointerId !== shareDrag.id) return;
        shareDrag = null;
        controls.enabled = !shareDragOn;
      });
      stopShareMotion();
    } catch (err) {
      if (motionStatus) motionStatus.textContent = err?.message || "Could not load motion.";
    }
  }

  let glbLoadFinished = !canPreview || isCodeShare || isLayoutShare;
  if (isLayoutShare) {
    setStatus("");
    commentForm?.classList.remove("hidden");
    $("share-comment-history")?.classList.remove("hidden");
    renderShareComments();
    syncSectionAvailability();
  } else if (isVideoShare) {
    syncSectionAvailability();
  } else if (isCodeShare) {
    setStatus("");
    syncSectionAvailability();
  } else if (!canPreview) {
    setStatus(graphicsError || "3D preview needs a GLB. Use Download for available formats.");
    syncSectionAvailability();
  } else {
    setStatus("Loading model…");
    await new Promise((resolve) => {
      let done = false;
      let lastByteAt = Date.now();
      const complete = () => {
        if (done) return;
        done = true;
        window.clearInterval(stallTimer);
        resolve();
      };
      const applyLoadedGltf = (gltf) => {
        root.clear();
        loadedScene = gltf.scene;
        root.add(loadedScene);
        const styleName = meta.filename || meta.viewer_filename || viewerUrl || "";
        const meshAuthored = /(?:^|[\\/])mesh[\\/]/i.test(styleName) || /\.mesh\./i.test(styleName);
        applyViewportStyle(root, {
          filename: styleName,
          styleMode: meshAuthored ? "shaded" : "auto",
        });
        hardenShareDepthLayers(root);
        bindShareGltfClips(gltf, loadedScene);
        if (shareGltfClips.length) revealSharePlayChrome({ many: shareGltfClips.length > 1 });
        fitCamera();
        renderComponentTree();
        void Promise.resolve(loadSharedRobot()).then(() => {
          if (sharePlaying) stopShareMotion();
        });
        syncSectionAvailability();
        setStatus("");
      };
      const stallTimer = window.setInterval(() => {
        if (done) return;
        if (Date.now() - lastByteAt < SHARE_LOAD_STALL_MS) return;
        setStatus("Still preparing preview… if the model is visible you can rotate it.");
        complete();
      }, 1000);
      new GLTFLoader().load(
        viewerUrl,
        (gltf) => {
          glbLoadFinished = true;
          applyLoadedGltf(gltf);
          complete();
        },
        (progress) => {
          lastByteAt = Date.now();
          const total = Number(progress?.total) || 0;
          const loaded = Number(progress?.loaded) || 0;
          if (total > 0) {
            const pct = Math.min(99, Math.round((loaded / total) * 100));
            setStatus(`Loading model… ${pct}%`, { pct });
          } else if (loaded > 0) {
            setStatus(`Loading model… ${formatBytes(loaded)}`);
          }
        },
        (err) => {
          glbLoadFinished = true;
          if (!loadedScene) {
            const detail = String(err?.message || "").trim();
            setStatus(
              detail
                ? `Could not load the 3D model (${detail}). Downloads still work below.`
                : "Could not load the 3D model. Refresh, or use Download below.",
            );
            syncSectionAvailability();
          }
          complete();
        },
      );
    });
  }
  if (!loadedScene) {
    renderComponentTree();
    if (glbLoadFinished && !isCodeShare) loadSharedRobot();
  }

  if (isCodeShare) {
    document.body.classList.add("share-code-ide");
    const host = document.createElement("div");
    host.id = "share-code-host";
    viewerEl.appendChild(host);
    const tabBar = document.createElement("div");
    tabBar.id = "share-doc-tab-bar";
    tabBar.className = "dxf-tabs";
    viewerEl.prepend(tabBar);
    const [{ createDocumentTabBar }, { createProjectCodeEditor }] = await Promise.all([
      import("../studio/document-tabs.js?v=foldcode1-code1"),
      import("../code/project-code-editor.js?v=20260923-project-explorer1"),
    ]);
    const shareTabs = createDocumentTabBar({ tabBarEl: tabBar, mainColumnEl: viewerEl });
    const shareEditor = createProjectCodeEditor({
      host,
      docTabs: shareTabs,
      api: shareApi,
      rawFetch: (path, opts = {}) => fetch(path, { ...opts, headers: { ...(opts.headers || {}), ...authHeaders() } }),
      getProjectId: () => meta.project_id,
      allowSimulate: false,
      shareMode,
      baseUrl: () => `/api/share/${encodeURIComponent(token)}/code`,
      onOpenModel: (path) => {
        if (!renderer) {
          if (!initializeGraphics()) { setStatus(graphicsError); return; }
          section = createSectionController({ renderer, scene, getBounds: () => modelBox.clone() });
          initializeShareMeasure();
          controls.addEventListener("start", () => setAutoRotate(false));
          resize();
          tick();
        }
        document.body.classList.add("share-code-split");
        const file = String(path || "").split("/").pop();
        if (!/\.(glb|gltf)$/i.test(file)) {
          setStatus("Open a GLB or GLTF from this tree to view 3D. Other meshes stay as files.");
          return;
        }
        const url = `/api/share/${encodeURIComponent(token)}/files/${encodeProjectFilePath(path)}`;
        setStatus("Loading model…");
        new GLTFLoader().load(url, (gltf) => {
          root.clear();
          loadedScene = gltf.scene;
          root.add(loadedScene);
          syncSectionAvailability();
          applyViewportStyle(root, { filename: file, styleMode: "auto" });
          bindShareGltfClips(gltf, loadedScene);
          if (shareGltfClips.length) {
            revealSharePlayChrome({ many: shareGltfClips.length > 1 });
            stopShareMotion();
          }
          fitCamera();
          setStatus("");
        }, undefined, (err) => setStatus(err?.message || "Could not load 3D model."));
      },
    });
    await shareEditor.open({
      projectId: meta.project_id,
      folder: meta.folder_scope === "tree" ? "references" : (meta.code_root || "references"),
    });
  }


  let shareProfileUi = null;
  let lastShareProfileTarget = {};
  async function shareApi(path, opts = {}) {
    const headers = { ...(opts.headers || {}), ...authHeaders() };
    const res = await fetch(path, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.detail || data.error || res.statusText || "Request failed");
      err.status = res.status;
      throw err;
    }
    return data;
  }
  function promptShareSignIn({ userId, handle, intent } = {}) {
    const target = {
      userId: userId || lastShareProfileTarget.userId || "",
      handle: handle || lastShareProfileTarget.handle || "",
      intent: intent || "",
    };
    const returnTo = shareHistorySignInReturnTo({
      pathname: location.pathname,
      userId: target.userId,
      handle: target.handle,
      intent: target.intent,
    });
    savePendingShareAction({
      kind: SHARE_HISTORY_PROFILE_KIND,
      returnTo,
      userId: target.userId,
      handle: target.handle,
      intent: target.intent,
    });
    location.href = "/?signin=1";
    return true;
  }
  async function openShareCreatorMessages(profile) {
    const { openMarketplaceMessages } = await import("../marketplace/marketplace-messages.js?v=20260915-marketplace3");
    return openMarketplaceMessages({ recipient: profile });
  }
  function openShareHistoryProfile({ userId, handle, compact = true, anchor = null } = {}) {
    const uid = String(userId || "").trim();
    const h = String(handle || "").replace(/^@/, "").trim();
    if (!uid && !h) return;
    lastShareProfileTarget = { userId: uid, handle: h };
    try {
      shareProfileUi?.open?.({
        userId: uid || undefined,
        handle: h || undefined,
        compact,
        anchor,
      });
    } catch { /* optional */ }
  }
  shareProfileUi = createUserProfileUI({
    api: shareApi,
    onOpenChat: () => {},
    onNeedAuth: ({ reason, profile } = {}) => {
      if (getToken()) return false;
      return promptShareSignIn({
        userId: profile?.id,
        handle: profile?.handle,
        intent: reason === "friend" ? "friend" : "message",
      });
    },
    onMessageUser: (profile) => {
      if (!getToken()) {
        promptShareSignIn({ userId: profile?.id, handle: profile?.handle, intent: "message" });
        return;
      }
      void openShareCreatorMessages(profile);
    },
  });
  bindShareHistoryProfileClicks(panelHistoryEl, ({ userId, handle, anchor }) => {
    openShareHistoryProfile({ userId, handle, compact: true, anchor });
  });
  function paintShareAccount(user) {
    const avatarBtn = $("share-auth-avatar");
    const signinBtn = $("btn-share-signin");
    const loggedIn = !!(user?.id && getToken());
    signinBtn?.classList.toggle("hidden", loggedIn);
    if (!avatarBtn) return;
    avatarBtn.classList.toggle("hidden", !loggedIn);
    if (!loggedIn) return;
    const avatar = String(user.avatar_url || "").trim();
    if (avatar) {
      avatarBtn.textContent = "";
      avatarBtn.style.backgroundImage = `url('${avatar.replace(/'/g, "%27")}')`;
    } else {
      avatarBtn.style.backgroundImage = "";
      avatarBtn.textContent = String(user.display_name || user.email || "?").charAt(0).toUpperCase();
    }
    avatarBtn.title = user.display_name || "Account";
    avatarBtn.setAttribute("aria-label", `Account: ${user.display_name || "You"}`);
  }
  paintShareAccount(getStoredUser());
  $("btn-share-signin")?.addEventListener("click", () => {
    const gate = gateRemixOrShare({
      token: getToken(),
      action: { kind: "signin", returnTo: location.pathname },
    });
    if (gate.needsAuth) location.href = "/?signin=1";
  });
  $("share-auth-avatar")?.addEventListener("click", () => {
    const user = getStoredUser();
    if (!user?.id) return;
    try { shareProfileUi?.open?.({ userId: user.id, compact: true, anchor: $("share-auth-avatar") }); } catch { /* optional */ }
  });
  if (getToken()) {
    void shareApi("/api/users/me").then((me) => {
      if (me?.id) {
        shareMeasureAuthor = {
          id: me.id,
          display_name: me.display_name || me.email || "You",
          avatar_url: me.avatar_url || `/api/users/${encodeURIComponent(me.id)}/avatar`,
          handle: me.handle || "",
          guest: false,
        };
        paintShareAccount(me);
        if (!meta.can_manage) {
          void fetch(`/api/share/${encodeURIComponent(token)}`, {
            headers: authHeaders(),
            credentials: "same-origin",
          }).then((r) => r.ok ? r.json() : null).then((data) => {
            if (data?.can_manage) {
              meta.can_manage = true;
              Object.assign(meta, data);
              bindShareLinkPerms();
            }
          }).catch(() => {});
        }
      }
    }).catch(() => {});
  }

  function setAutoRotate(on) {
    if (!controls) return;
    controls.autoRotate = Boolean(on);
    btnRotate?.classList.toggle("active", controls.autoRotate);
    btnRotate?.setAttribute("aria-pressed", String(controls.autoRotate));
  }


  function initializeShareMeasure() {
    if (shareMeasure) return;
  shareMeasure = renderer ? createShareMeasure({
    scene,
    camera,
    renderer,
    getRoot: () => loadedScene || root,
    shareToken: token,
    controls,
    setAutoRotate,
    getAuthor: () => shareMeasureAuthor,
    onOpenAuthor: (author, el) => {
      if (!author?.id) return;
      try { shareProfileUi?.open?.({ userId: author.id, compact: true, anchor: el }); } catch { /* optional */ }
    },
    onStatus: (message) => {
      setStatus(message || "");
    },
    onActiveChange: (on) => {
      if (on) {
        transparentPickEnabled = false;
        renderer.domElement.style.cursor = "crosshair";
        btnTransparent?.classList.remove("active");
        btnTransparent?.setAttribute("aria-pressed", "false");
        setTransparentTipVisible(false);
      }
      setMobileToolsOpen(false);
    },
  }) : null;
  }
  initializeShareMeasure();

  btnRotate?.addEventListener("click", () => {
    if (!controls) return;
    setAutoRotate(!controls.autoRotate);
    setMobileToolsOpen(false);
  });
  setAutoRotate(true);

  btnFit?.addEventListener("click", () => {
    if (!renderer) return;
    fitCamera();
    setMobileToolsOpen(false);
  });
  btnMobileFit?.addEventListener("click", () => {
    fitCamera();
  });
  btnMobileTools?.addEventListener("click", () => {
    setMobileToolsOpen(!document.body.classList.contains("share-mobile-tools-open"));
  });
  async function toggleShareFullscreen() {
    if (document.documentElement.classList.contains("share-no-fs") || document.body.classList.contains("share-no-fs")) {
      return;
    }
    const nextExpanded = !document.body.classList.contains("share-viewer-expanded");
    setShareViewerExpanded(nextExpanded);
    if (nextExpanded && viewerEl.requestFullscreen && !document.fullscreenElement) {
      try {
        await viewerEl.requestFullscreen();
      } catch (_) {
        // Browser fullscreen is optional; the CSS viewport expansion still applies.
      }
    } else if (!nextExpanded && document.fullscreenElement && document.exitFullscreen) {
      try {
        await document.exitFullscreen();
      } catch (_) {
        // Ignore browsers that reject programmatic fullscreen exits.
      }
    }
  }
  btnMobileFullscreen?.addEventListener("click", () => { void toggleShareFullscreen(); });
  btnShareFullscreen?.addEventListener("click", () => { void toggleShareFullscreen(); });
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement && document.body.classList.contains("share-viewer-expanded")) {
      setShareViewerExpanded(false);
    }
  });
  syncMobileFullscreenLabel();

  btnWireframe?.addEventListener("click", () => {
    wireframeEnabled = !wireframeEnabled;
    syncWireframe();
    setMobileToolsOpen(false);
  });

  btnTransparent?.addEventListener("click", () => {
    if (!renderer) return;
    transparentPickEnabled = !transparentPickEnabled;
    if (transparentPickEnabled) shareMeasure.deactivate();
    controls.enabled = true;
    renderer.domElement.style.cursor = transparentPickEnabled ? "copy" : "";
    if (transparentPickEnabled) setAutoRotate(false);
    btnTransparent.classList.toggle("active", transparentPickEnabled);
    btnTransparent.setAttribute("aria-pressed", String(transparentPickEnabled));
    setTransparentTipVisible(transparentPickEnabled);
    setMobileToolsOpen(false);
  });
  btnTransparentTipClose?.addEventListener("click", () => setTransparentTipVisible(false));

  function setRemixStatus(message = "", cls = "") {
    if (!remixStatus) return;
    remixStatus.textContent = message;
    remixStatus.className = `share-remix-status${cls ? ` ${cls}` : ""}`;
  }

  function selectedRemixTarget() {
    return remixModal?.querySelector('input[name="share-remix-target"]:checked')?.value || "new";
  }

  function syncRemixTargetUi() {
    const existing = selectedRemixTarget() === "existing";
    if (remixProjectSelect) remixProjectSelect.disabled = !existing;
    remixWorkspaceHost?.classList.toggle("hidden", existing);
    if (btnRemixConfirm) {
      btnRemixConfirm.textContent = existing ? "Import into project" : "Create project & open editor";
    }
  }

  function renderRemixWorkspacePicker(teams = []) {
    if (!remixWorkspaceHost) return;
    const workspaces = sharedWorkspacesFromTeams(teams, { currentUserId: getStoredUser()?.id });
    remixWorkspaceHost.innerHTML = sharedWorkspacePickerHtml({
      workspaces,
      sharer: meta.shared_by,
      prefix: "share-remix",
    });
    bindSharedWorkspacePicker(remixWorkspaceHost);
  }

  async function loadRemixProjects() {
    if (remixProjectsLoaded || remixProjectsLoading || !remixProjectSelect) return;
    remixProjectsLoading = true;
    remixProjectSelect.innerHTML = `<option value="">Loading projects…</option>`;
    try {
      const [projectRes, teamRes] = await Promise.all([
        fetch("/api/projects", { headers: authHeaders() }),
        fetch("/api/teams", { headers: authHeaders() }),
      ]);
      const data = await projectRes.json().catch(() => ({}));
      const teamData = await teamRes.json().catch(() => ({}));
      if (!projectRes.ok) throw new Error(data.detail || "Could not load projects");
      const projects = (Array.isArray(data.projects) ? data.projects : [])
        .filter((p) => p?.id && p.folder_id !== "__public__");
      remixProjectSelect.innerHTML = projects.length
        ? `<option value="">Choose a project…</option>${projects.map((p) => `
          <option value="${escapeHtml(p.id)}">${escapeHtml(p.name || p.id)}${p.folder_name ? ` · ${escapeHtml(p.folder_name)}` : ""}</option>
        `).join("")}`
        : `<option value="">No editable projects found</option>`;
      renderRemixWorkspacePicker(Array.isArray(teamData.teams) ? teamData.teams : []);
      remixProjectsLoaded = true;
    } catch (err) {
      remixProjectSelect.innerHTML = `<option value="">Could not load projects</option>`;
      renderRemixWorkspacePicker([]);
      setRemixStatus(err?.message || "Could not load projects.", "error");
    } finally {
      remixProjectsLoading = false;
    }
  }

  function requireShareAuth(kind) {
    const gate = gateRemixOrShare({
      token: getToken(),
      action: { kind, token },
    });
    if (gate.needsAuth) {
      location.href = `/?open_share=${encodeURIComponent(token)}&signin=1`;
      return false;
    }
    return true;
  }

  function openRemixModal() {
    if (!requireShareAuth("remix-share")) return;
    setRemixStatus("");
    remixModal?.classList.remove("hidden");
    syncRemixTargetUi();
    void loadRemixProjects();
  }

  function closeRemixModal() {
    remixModal?.classList.add("hidden");
    setRemixStatus("");
  }

  remixModal?.querySelectorAll('input[name="share-remix-target"]').forEach((input) => {
    input.addEventListener("change", syncRemixTargetUi);
  });
  remixModal?.querySelectorAll("[data-remix-close]").forEach((btn) => {
    btn.addEventListener("click", closeRemixModal);
  });
  remixModal?.addEventListener("click", (event) => {
    if (event.target === remixModal) closeRemixModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !remixModal?.classList.contains("hidden")) {
      closeRemixModal();
    }
  });

  btnOpen?.addEventListener("click", () => {
    if (isLayoutShare) {
      location.href = getToken()
        ? studioImportUrl(token)
        : `/?import_viewport_layout=${encodeURIComponent(token)}&signin=1`;
      return;
    }
    if (document.body.classList.contains("share-view-only")) return;
    setMobileToolsOpen(false);
    openRemixModal();
  });

  btnRemixConfirm?.addEventListener("click", async () => {
    if (!requireShareAuth("remix-share")) return;
    const targetMode = selectedRemixTarget();
    const targetProjectId = targetMode === "existing" ? (remixProjectSelect?.value || "") : "";
    if (targetMode === "existing" && !targetProjectId) {
      setRemixStatus("Choose a project to import into.", "error");
      return;
    }
    const workspace = readSharedWorkspacePicker(remixWorkspaceHost);
    if (targetMode === "new" && workspace.mode === "existing" && !workspace.teamId) {
      setRemixStatus("Choose a shared workspace, or create a new one.", "error");
      return;
    }
    const originalText = btnRemixConfirm.textContent;
    btnRemixConfirm.disabled = true;
    btnRemixConfirm.textContent = targetMode === "existing" ? "Importing…" : "Opening editor…";
    setRemixStatus(targetMode === "existing" ? "Importing shared files into project…" : "Creating editable remix project…");
    try {
      const res = await fetch(`/api/share/${encodeURIComponent(token)}/open-in-project`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify(remixOpenBody(workspace, { targetProjectId })),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Could not remix project");
      closeRemixModal();
      location.href = data.url || studioViewportPath(data.project_id);
    } catch (err) {
      setRemixStatus(err?.message || "Could not remix this share into a project.", "error");
      btnRemixConfirm.disabled = false;
      btnRemixConfirm.textContent = originalText;
    }
  });

  function syncInspectorUi(on, focus = "components") {
    if (on) setMobileToolsOpen(false);
    btnInspector?.classList.toggle("active", on && focus === "components");
    btnInspector?.setAttribute("aria-pressed", String(on && focus === "components"));
    btnHistory?.classList.toggle("active", on && focus === "history");
    btnHistory?.setAttribute("aria-pressed", String(on && focus === "history"));
    inspectorPanel?.classList.toggle("hidden", !on);
    panelPartsEl?.classList.toggle("hidden", focus !== "components");
    panelHistoryEl?.classList.toggle("hidden", focus !== "history");
    if (inspectorTitle) inspectorTitle.textContent = focus === "history" ? "History" : "Part Tree";
    if (on) {
      if (focus === "history") {
        renderShareDetails();
        renderShareComments();
      } else {
        renderComponentTree();
      }
    }
  }

  btnInspector?.addEventListener("click", () => {
    const opening = inspectorPanel?.classList.contains("hidden") || !btnInspector.classList.contains("active");
    syncInspectorUi(opening, "components");
  });
  btnHistory?.addEventListener("click", () => {
    const opening = inspectorPanel?.classList.contains("hidden") || !btnHistory.classList.contains("active");
    syncInspectorUi(opening, "history");
  });
  inspectorPanel?.querySelector("#btn-share-inspector-close")?.addEventListener("click", () => syncInspectorUi(false));
  $("btn-share-show-all-parts")?.addEventListener("click", () => {
    isolateObject(null);
    fitCamera();
  });
  componentListEl?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    const action = btn.dataset.action || "frame";
    const obj = objectsById.get(btn.dataset.target);
    if (action === "all") {
      isolateObject(null);
      fitCamera();
      return;
    }
    if (!obj) return;
    if (action === "only") {
      isolateObject(obj);
      return;
    }
    if (action === "transparent") {
      setObjectTransparent(obj, !transparentObjects.has(obj));
      renderComponentTree();
      return;
    }
    frameObject(obj);
  });

  timelineTrackEl?.addEventListener("click", (event) => {
    const chip = event.target.closest(".share-timeline-chip");
    if (!chip) return;
    timelineTrackEl.querySelectorAll(".share-timeline-chip").forEach((el) => {
      el.classList.toggle("is-active", el === chip);
    });
    syncInspectorUi(true, "history");
    const promptId = chip.dataset.promptId || "";
    const card = promptId
      ? promptHistoryEl?.querySelector(`[data-prompt-id="${CSS.escape(promptId)}"]`)
      : null;
    card?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let transparentPointerStart = null;

  function rememberTransparentPointer(event) {
    if (!transparentPickEnabled || event.target !== renderer.domElement) return;
    if (event.button != null && event.button !== 0) return;
    transparentPointerStart = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      t: performance.now(),
    };
  }

  function pickTransparentObject(event) {
    if (!transparentPickEnabled || event.target !== renderer.domElement) return;
    if (event.button != null && event.button !== 0) return;
    const start = transparentPointerStart;
    transparentPointerStart = null;
    if (!start || start.id !== event.pointerId) return;
    const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
    const elapsed = performance.now() - start.t;
    // Treat a short, steady tap/click as selection; let drags continue to OrbitControls.
    if (moved > 10 || elapsed > 1200) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointerNdc.x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    pointerNdc.y = -(((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1);
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObjects(allPickableMeshes(), true);
    const hit = hits.find((item) => item?.object && objectMeshes(item.object).length) || hits[0];
    if (!hit?.object) return;
    event.preventDefault();
    const target = closestTransparentTarget(hit.object);
    setObjectTransparent(target, !transparentObjects.has(target));
  }

  function clearTransparentPointer(event) {
    if (transparentPointerStart?.id === event.pointerId) transparentPointerStart = null;
  }

  // Keep OrbitControls live in transparent mode: drags rotate; steady clicks toggle parts.
  viewerEl.addEventListener("pointerdown", rememberTransparentPointer, true);
  viewerEl.addEventListener("pointerup", pickTransparentObject, true);
  viewerEl.addEventListener("pointercancel", clearTransparentPointer, true);

  function syncSectionUi(on) {
    if (on) setMobileToolsOpen(false);
    btnSection?.classList.toggle("active", on);
    btnSection?.setAttribute("aria-pressed", String(on));
    sectionPanel?.classList.toggle("hidden", !on);
  }

  btnSection?.addEventListener("click", () => {
    if (!loadedScene) {
      setStatus("Section analysis is only available after a 3D GLB preview loads.");
      syncSectionAvailability();
      return;
    }
    if (section.isActive()) {
      section.deactivate();
      syncSectionUi(false);
    } else {
      section.activate();
      syncSectionUi(true);
    }
  });

  sectionPanel?.querySelectorAll("[data-axis]").forEach((btn) => {
    btn.addEventListener("click", () => {
      section.setAxis(btn.dataset.axis);
      sectionPanel.querySelectorAll("[data-axis]").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
    });
  });

  const slider = sectionPanel?.querySelector("#share-section-slider");
  const pct = sectionPanel?.querySelector("#share-section-pct");
  slider?.addEventListener("input", () => {
    section.setOffset(Number(slider.value) / 100);
    if (pct) pct.textContent = `${slider.value}%`;
  });
  sectionPanel?.querySelector("#btn-share-section-flip")?.addEventListener("click", () => section.flip());
  sectionPanel?.querySelector("#btn-share-section-close")?.addEventListener("click", () => {
    section.deactivate();
    syncSectionUi(false);
  });

  btnDownloadMenu?.addEventListener("click", () => {
    renderDownloadMenu($("share-download-list"));
    downloadSheet?.classList.toggle("hidden");
    if (!downloadSheet?.classList.contains("hidden")) setMobileToolsOpen(false);
    btnDownloadMenu.classList.toggle("active", !downloadSheet?.classList.contains("hidden"));
  });
  downloadSheet?.querySelector("[data-close-downloads]")?.addEventListener("click", () => {
    downloadSheet.classList.add("hidden");
    btnDownloadMenu?.classList.remove("active");
  });

  controls?.addEventListener("start", () => {
    if (!isEmbedMode()) setAutoRotate(false);
  });
  // Block browser gestures that steal the drag (scroll / pinch-zoom page).
  renderer?.domElement.addEventListener(
    "touchmove",
    (e) => {
      if (e.cancelable) e.preventDefault();
    },
    { passive: false },
  );

  window.addEventListener("resize", resize);
  resize();

  async function resumeShareHistoryProfile() {
    const params = new URLSearchParams(location.search);
    const openHistory = params.get("open_history") === "1";
    const userId = params.get("profile") || "";
    const handle = params.get("profile_handle") || "";
    const intent = params.get("profile_intent") || "";
    if (openHistory) syncInspectorUi(true, "history");
    if (!userId && !handle) return;
    lastShareProfileTarget = { userId, handle };
    await shareProfileUi?.open?.({
      userId: userId || undefined,
      handle: handle || undefined,
      compact: true,
    });
    if (getToken() && intent === "message") {
      await openShareCreatorMessages({ id: userId, handle, display_name: handle || "creator" });
    } else if (getToken() && intent === "friend" && userId) {
      try {
        await shareApi("/api/social/friends", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user_id: userId }),
        });
      } catch {
        /* Profile stays open if the request is already pending. */
      }
    }
    params.delete("open_history");
    params.delete("profile");
    params.delete("profile_handle");
    params.delete("profile_intent");
    const qs = params.toString();
    history.replaceState({}, "", `${location.pathname}${qs ? `?${qs}` : ""}${location.hash || ""}`);
  }
  void resumeShareHistoryProfile();

  function tick() {
    requestAnimationFrame(tick);
    updateShareMotion(performance.now());
    controls.update();
    syncCameraClip();
    renderer.render(scene, camera);
    try { shareMeasure.updateLabels?.(); } catch (_) {}
  }
  if (renderer) tick();
}

main().catch((err) => {
  const status = document.getElementById("share-status");
  if (status) {
    status.classList.remove("hidden");
    status.hidden = false;
    const copy = document.getElementById("share-status-copy") || status;
    copy.textContent = err?.message || "Something went wrong loading this share.";
    status.querySelector(".share-load-track")?.setAttribute("hidden", "");
  }
});
