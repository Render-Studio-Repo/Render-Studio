import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  reorderClips,
  defaultVideoAiKeyValue,
  keyFieldsFromPickerValue,
  filmEditPromptForGenerate,
  filmEditHasSpotifyUrl,
  extractSpotifyMusicUrls,
  filmKeyPillLabel,
  filmModelPillLabel,
  resolveFilmKeyDisplay,
  isVideoGenerationKind,
  videoJobFromGeneration,
  localImproveVideoPrompt,
  parseFilmEditPrompt,
  mediaKindFromFile,
  filesFromDropEvent,
  isMediaFileDrag,
  planDroppedMedia,
  bindMediaDropTarget,
  prettyAudioLabel,
  randomVideoEditorProjectName,
  toggleMutedFlag,
  musicTrackPlaybackState,
  splitClipAtPlayhead,
  playheadHitsClip,
  setClipEdgeTransition,
  clipContextMenuModel,
  muteButtonMarkup,
  removeButtonMarkup,
  clipSourceDuration,
  clipEffectiveDuration,
  clipTrimStatsText,
  timelineSpanSec,
  applyEdgeTrim,
  CLIP_SPLIT_SHORTCUT,
  CLIP_TRIM_SHORTCUT,
  CLIP_MUTE_SHORTCUT,
  CLIP_COPY_SHORTCUT,
  CLIP_PASTE_SHORTCUT,
  playheadPlaybackIntent,
  previewLoopRestartSec,
  previewPlaybackChromeMarkup,
  trimEdgeForPlayhead,
  clipPasteIndex,
  shortenAudioToClipEnd,
  videoClipsEndSec,
  followPlayheadScrollLeft,
  fitTimelinePxPerSec,
  editorAudioUploadName,
  audioPersistKey,
  editorSessionStorageKey,
  matchListedMediaFile,
  musicTrackSnapshot,
  serializeEditorTimeline,
  hydrateTimelineClips,
  applyMusicSnapshotOpts,
  SHORTEN_AUDIO_TO_CLIP_LABEL,
  TRIM_AUDIO_LABEL,
  AUDIO_TRIM_UPDATE_LABEL,
  AUDIO_TRIM_DONE_LABEL,
  AUDIO_TRIM_DONE_TITLE,
  CLIP_DOWNLOAD_FORMATS,
  nextVideoEditorPromptExample,
  VIDEO_EDITOR_PROMPT_EXAMPLES,
  VIDEO_EDITOR_AGENT_QUESTION,
  pauseAndDetachMedia,
  scheduleRevokeObjectURL,
  shouldLoadMediaElementOnDetachTick,
  shouldHeavyTeardownVideoEditorOnCloseTick,
  shouldRebuildCadOnVideoEditorCloseTick,
  clampMenuPosition,
  audioTrimBounds,
  audioTrimTimeFromClientX,
  audioTrimLoopRestart,
  slideAudioTrimWindow,
  rulerTickStepSec,
  videoEditorProjectNameFromSource,
  videoEditorFolderKey,
  shouldCopyBytesIntoVideoEditorFolder,
  mergeVideoEditorSourceRefs,
  videoEditorOpenLockKey,
  clipRangeIds,
  normalizeMarqueeRect,
  clipIdsIntersectingMarquee,
  isEditorPageZoomKey,
  isEditorPageZoomWheel,
  isEditorUndoKey,
  isEditorRedoKey,
  isEditorCopyKey,
  isEditorPasteKey,
  snapshotTimelineState,
  TIMELINE_CLIP_LOADING_STATUS,
  TIMELINE_LOADING_MAX_MS,
  clipNeedsTimelineSpinner,
  timelineLoadingShouldHide,
  projectMediaPlaybackUrl,
  shouldShowVideoLaneEmpty,
  previewMuteShouldBe,
  previewShowsTimelineClip,
  shouldStartBedAudio,
  clipSourceIdentityKey,
  findClipBySourceKey,
  clipsAfterOpenSource,
  audioDropShouldMutePreview,
  clipPreviewVolume,
  appendFilmEditHistory,
  filmEditHistoryById,
  makeFilmEditHistoryEntry,
  filmResultPlaybackUrl,
  filmJobIsReady,
  finiteAdoptDuration,
  MAX_CLIP_DURATION_SEC,
  shouldSeekUnknownMediaDuration,
  pauseOffscreenEditorMedia,
  stillPreviewSize,
  editorPageIsHidden,
  isVideoPlaybackShortcutBlockedTarget,
  videoPlaybackShortcutIntent,
  mediaSeekIsAtTarget,
} from "./video-timeline-editor.js";
import {
  videoBakeOutputSize,
  VIDEO_BAKE_FPS,
  VIDEO_BAKE_BITS,
  trackObjectUrl,
  revokeTrackedObjectUrls,
  attachPreviewObjectUrl,
  triggerTrackedBlobDownload,
} from "./viewport-video-editor.js";
import {
  convertProgressPercent,
  xShareBakePlan,
  xShareTrimWindow,
  xShareSongPreviewTime,
  xSharePreviewLoopRestart,
  xShareFallbackDuration,
  xShareTrackPct,
  xSharePlayheadPct,
  xShareExportPlan,
  normalizeXShareCaption,
  xComposeHref,
  X_SHARE_DEFAULT,
  X_SHARE_ATTRIBUTION_LINE,
} from "./viewport-video-record.js";

const here = dirname(fileURLToPath(import.meta.url));
const timeline = readFileSync(join(here, "./video-timeline-editor.js"), "utf8");
const record = readFileSync(join(here, "./viewport-video-record.js"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");
const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
const ref = readFileSync(join(here, "../components/reference-files.js"), "utf8");
const tree = readFileSync(join(here, "../components/project-tree.js"), "utf8");
const editor = readFileSync(join(here, "./viewport-video-editor.js"), "utf8");
const browser = readFileSync(join(here, "../workspace/workspace-browser.js"), "utf8");

test("Share to X download converts a WebM recording when MP4 is selected", () => {
  assert.deepEqual(xShareExportPlan("video/webm", "mp4"), {
    format: "mp4",
    convert: true,
  });
  assert.deepEqual(xShareExportPlan("video/mp4", "mp4"), {
    format: "mp4",
    convert: false,
  });
  assert.deepEqual(xShareExportPlan("video/quicktime", "mp4"), {
    format: "mp4",
    convert: true,
  });
  assert.deepEqual(xShareExportPlan("video/mp4", "webm"), {
    format: "webm",
    convert: true,
  });
});

test("VID tab mounts timeline editor, not live looks chrome", () => {
  assert.match(ref, /mountVideoTimelineEditor/);
  assert.equal(ref.includes("mountViewportVideoEditor"), false);
  assert.match(timeline, /data-vtl-prompt/);
  assert.match(timeline, /data-vtl-improve/);
  assert.match(timeline, /data-vtl-gear/);
  assert.match(timeline, /data-vtl-transition="dissolve"/);
  assert.equal(ref.includes("Looks apply live"), false);
  assert.equal(record.includes("Looks apply live"), false);
});

test("reorderClips moves a clip by index", () => {
  const clips = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(reorderClips(clips, 0, 2).map((c) => c.id), ["b", "c", "a"]);
  assert.deepEqual(reorderClips(clips, 2, 0).map((c) => c.id), ["c", "a", "b"]);
  assert.deepEqual(reorderClips(clips, 1, 1).map((c) => c.id), ["a", "b", "c"]);
});

test("defaultVideoAiKeyValue keeps the actually selected key", () => {
  const options = [
    { value: "personal:abc", label: "Key" },
    { value: "chatgpt:subscription", label: "ChatGPT subscription" },
    { value: "claude:subscription", label: "Claude subscription" },
  ];
  assert.equal(defaultVideoAiKeyValue(options, "personal:abc"), "personal:abc");
  assert.equal(defaultVideoAiKeyValue(options, "chatgpt:subscription"), "chatgpt:subscription");
  assert.equal(defaultVideoAiKeyValue(options, ""), "chatgpt:subscription");
  assert.equal(defaultVideoAiKeyValue([{ value: "personal:abc" }], "personal:abc"), "personal:abc");
  assert.equal(filmModelPillLabel("gpt-6-astra"), "GPT-6 Astra");
  assert.equal(filmModelPillLabel("claude-fable-5"), "Fable 5");
  const display = resolveFilmKeyDisplay(
    { options, selected: "chatgpt:subscription" },
    { model: "gpt-6-astra", provider: "openai" },
    "chatgpt:subscription",
  );
  assert.equal(display.modelLabel, "GPT-6 Astra");
  assert.notEqual(display.modelLabel, "Fable 5");
  assert.equal(isVideoGenerationKind({ kind: "video" }), true);
  assert.equal(videoJobFromGeneration({
    jobs: [{ kind: "video", status: "running", model: "gpt-6-astra" }],
  })?.model, "gpt-6-astra");
});

test("improve prompt rewrites video-edit language, not CAD", () => {
  const improved = localImproveVideoPrompt("make it transition in");
  assert.match(improved, /make it transition in/i);
  assert.match(improved, /film edit/i);
  assert.equal(/shop-hex|build123d|STEP/i.test(improved), false);
  assert.match(timeline, /\/api\/video\/improve-prompt/);
  assert.match(timeline, /\/api\/video\/film-edit/);
});

test("parseFilmEditPrompt maps dissolve and zoom", () => {
  const plan = parseFilmEditPrompt("take these videos and make a single clip with cool video editing and zooms");
  assert.equal(plan.zoom, "in");
  const fade = parseFilmEditPrompt("make it transition in");
  assert.equal(fade.transition, "fade");
});

test("clip window keeps Share to X and Download with timeline prompt at bottom", () => {
  assert.match(record, /Timeline editor/);
  assert.match(record, /video-editor-window/);
  assert.match(record, /clip-editor-workspace/);
  assert.match(record, /data-video-new/);
  assert.match(record, /openEditorTab/);
  assert.match(record, /data-video-share-download/);
  assert.match(record, /data-video-share-post-x/);
  assert.match(record, /data-vtl-prompt/);
  assert.equal(html.includes('id="btn-video-editor"'), false);
  assert.match(css, /\.vtl-prompt/);
  assert.match(app, /CLIP_EDITOR_TAB_ID/);
  assert.match(app, /openProjectEditorTab/);
  assert.match(app, /vidtimeline1/);
  assert.match(html, /vidtimeline1/);
});

test("reference files expose hover Editor, Open editor, and image-only Add to editor", () => {
  assert.match(ref, /data-ref-mini-editor/);
  assert.match(ref, /Open editor/);
  assert.match(ref, /Add to editor/);
  assert.match(ref, /onOpenVideoEditor/);
  assert.match(ref, /onAddToVideoEditor/);
  assert.match(tree, /Open editor/);
  assert.match(tree, /Add to editor/);
  assert.match(tree, /browser-action-editor/);
});

test("legacy looks editor is no longer the VID chrome", () => {
  assert.match(editor, /Looks apply live/);
  assert.equal(ref.includes("data-vve-grade"), false);
  assert.equal(record.includes("Keep audio"), false);
});

test("mediaKindFromFile uses filename when MIME is empty", () => {
  assert.equal(mediaKindFromFile({ type: "", name: "bed.mp3" }), "audio");
  assert.equal(mediaKindFromFile({ type: "audio/mpeg", name: "x" }), "audio");
  assert.equal(mediaKindFromFile({ type: "audio/mp4", name: "song" }), "audio");
  assert.equal(mediaKindFromFile({ type: "video/mp4", name: "render3d-video-2026-09-23-1933" }), "video");
  assert.equal(mediaKindFromFile({ type: "application/mp4", name: "render3d-video-2026-09-23-1933.mp4" }), "video");
  assert.equal(mediaKindFromFile({ type: "", name: "take.MOV" }), "video");
  assert.equal(mediaKindFromFile({ type: "", name: "still.png" }), "image");
  assert.equal(mediaKindFromFile({ type: "image/jpeg", name: "" }), "image");
  assert.equal(mediaKindFromFile({ type: "", name: "notes.txt" }), "");
});

test("filesFromDropEvent and isMediaFileDrag read Files drags", () => {
  const file = { name: "bed.mp3", type: "", size: 12, lastModified: 1 };
  const e = { dataTransfer: { types: ["Files"], files: [file], items: [] } };
  assert.equal(isMediaFileDrag(e), true);
  assert.deepEqual(filesFromDropEvent(e).map((f) => f.name), ["bed.mp3"]);
  assert.equal(isMediaFileDrag({ dataTransfer: { types: ["text/plain"], files: [], items: [] } }), false);
});

test("clip editor and share popup accept audio/photo/video drops on clip and preview", () => {
  assert.match(timeline, /bindMediaDropTarget/);
  assert.match(timeline, /dragenter/);
  assert.match(timeline, /dropEffect = "copy"/);
  assert.match(timeline, /capture:\s*true/);
  assert.match(timeline, /function ingestFiles/);
  assert.match(timeline, /source: "still"/);
  assert.match(timeline, /accept="video\/\*,audio\/\*,image\/\*/);
  assert.match(timeline, /data-vtl-tool="add"/);
  assert.match(timeline, /data-vtl-tool="add-audio"/);
  assert.match(timeline, /openMediaPicker/);
  assert.match(timeline, /planDroppedMedia/);
  assert.match(record, /bindMediaDropTarget\(card/);
  assert.match(record, /data-video-preview-wrap/);
  assert.match(record, /ingestFiles/);
  assert.match(record, /Video Editor/);
  assert.match(ref, /bindMediaDropTarget/);
  assert.match(ref, /ref-viewer-stage-wrap--video/);
  assert.match(ref, /videoEditorApi\.ingestFiles/);
  assert.match(app, /clipdnd1/);
  assert.match(app, /clipmedia2/);
  assert.match(html, /clipdnd1/);
  assert.match(html, /clipmedia2/);
  assert.match(css, /vtl-clip\.is-drop-target/);
  assert.match(css, /pointer-events:\s*none/);
});

test("planDroppedMedia routes audio to A and images/videos to V", () => {
  const audio = { name: "bed.mp3", type: "" };
  const image = { name: "still.png", type: "image/png" };
  const video = { name: "take.webm", type: "video/webm" };
  const plan = planDroppedMedia([audio, image, video]);
  assert.deepEqual(plan.audio.map((f) => f.name), ["bed.mp3"]);
  assert.deepEqual(plan.image.map((f) => f.name), ["still.png"]);
  assert.deepEqual(plan.video.map((f) => f.name), ["take.webm"]);
  const forced = planDroppedMedia([{ name: "untitled", type: "" }], { overAudio: true });
  assert.equal(forced.audio.length, 1);
  assert.equal(mediaKindFromFile({ type: "", name: "LoveSickness.mp3.c4ea-8399-1941-41f2.part" }), "audio");
  assert.equal(mediaKindFromFile({ type: "video/mp4", name: "Love Sickness" }), "video");
  const picker = planDroppedMedia([{ name: "Love Sickness", type: "video/mp4" }], { forceAudio: true });
  assert.equal(picker.audio.length, 1);
  assert.equal(picker.video.length, 0);
});

test("bindMediaDropTarget drop calls onFiles with the audio fixture", () => {
  const listeners = {};
  const el = {
    addEventListener(type, fn, opts) {
      const key = `${type}:${opts?.capture ? "c" : "b"}`;
      (listeners[key] ||= []).push(fn);
    },
    removeEventListener() {},
    contains() { return false; },
  };
  let received = [];
  bindMediaDropTarget(el, { onFiles: (files) => { received = files; } });
  const file = { name: "bed.mp3", type: "audio/mpeg", size: 4, lastModified: 1 };
  const e = {
    preventDefault() {},
    stopPropagation() {},
    dataTransfer: { types: ["Files"], files: [file], items: [], dropEffect: "copy" },
  };
  listeners["dragover:c"][0](e);
  listeners["drop:c"][0](e);
  assert.equal(received[0]?.name, "bed.mp3");
});

test("bindMediaDropTarget still preventDefaults file drops when inactive so the page does not navigate", () => {
  const listeners = {};
  const el = {
    addEventListener(type, fn, opts) {
      const key = `${type}:${opts?.capture ? "c" : "b"}`;
      (listeners[key] ||= []).push(fn);
    },
    removeEventListener() {},
    contains() { return false; },
  };
  let received = 0;
  let prevented = 0;
  bindMediaDropTarget(el, { isActive: () => false, onFiles: () => { received += 1; } });
  const file = { name: "bed.mp3", type: "audio/mpeg", size: 4, lastModified: 1 };
  const e = {
    preventDefault() { prevented += 1; },
    stopPropagation() {},
    dataTransfer: { types: ["Files"], files: [file], items: [], dropEffect: "copy" },
  };
  listeners["dragover:c"][0](e);
  listeners["drop:c"][0](e);
  assert.ok(prevented >= 2);
  assert.equal(received, 0);
  assert.match(app, /isOsFileDrag/);
  assert.match(app, /clipauddrop1/);
  assert.match(html, /clipauddrop1/);
  assert.match(ref, /refreshBrowsable/);
  assert.match(ref, /renderMiniBrowserHtml/);
  assert.match(ref, /snapshotVideoEditor/);
  assert.match(ref, /blob === tab\.blob/);
  assert.match(record, /opts\.source !== "upload"/);
});

test("file picker + click path is wired for audio and stills", () => {
  assert.match(timeline, /data-vtl-tool="add"/);
  assert.match(timeline, /data-vtl-tool="add-audio"/);
  assert.match(timeline, /\[data-vtl-file\]/);
  assert.match(timeline, /addEventListener\("change"/);
  assert.match(timeline, /forceAudio/);
  assert.match(timeline, /vtl-file-input/);
  assert.match(timeline, /armPickerClickGuard/);
  assert.match(css, /\.vtl-file-input/);
  assert.match(html, /addaudio1/);
  assert.match(app, /addaudio1/);
});

test("prettyAudioLabel strips Safari part suffixes", () => {
  assert.equal(prettyAudioLabel("LoveSickness.mp3.c4ea-8399-1941-41f2.part"), "LoveSickness");
  assert.equal(prettyAudioLabel("bed.mp3"), "bed");
  assert.match(timeline, /data-vtl-music-icon/);
  assert.match(timeline, /isEditorTypingTarget/);
  assert.match(timeline, /togglePreviewPlayback/);
  assert.match(record, /data-clip-home/);
  assert.match(record, /Create project/);
  assert.match(record, /clip-editor-grid/);
  assert.match(record, /data-video-back/);
  assert.match(record, /← Back/);
  assert.match(record, /openEditorProject/);
  assert.match(record, /Loaded/);
  assert.match(record, /data-video-share-link/);
  assert.match(record, /clip-editor-ctx/);
  assert.match(app, /vidshare1/);
  assert.match(html, /vidshare1/);
  assert.match(html, /shared-projects-hint\.gif/);
  assert.match(html, /View more/);
  assert.match(record, /isEditorTypingTarget/);
  assert.match(app, /musicon1/);
  assert.match(html, /musicon1/);
});

test("clipcut1 removes editor caption and persists create-project folders", () => {
  assert.match(app, /clipcut1/);
  assert.match(html, /clipcut1/);
  assert.match(timeline, /data-vtl-updates/);
  assert.match(timeline, /data-vtl-avatar/);
  assert.match(timeline, /randomVideoEditorProjectName/);
  assert.match(record, /data-video-share-sheet/);
  assert.match(record, /\/api\/projects\/\$\{encodeURIComponent\(pid\)\}\/video-editor/);
  assert.match(record, /randomVideoEditorProjectName/);
  assert.match(record, /data-ctx="delete"/);
  assert.match(record, /data-video-share-link/);
  assert.match(record, /openEditorProjectSettings/);
  assert.match(record, /Create project/);
  assert.match(record, /isEditorTypingTarget/);
  const hostIdx = record.indexOf("data-video-editor-host");
  const capIdx = record.indexOf("Talk or type your X post");
  assert.ok(hostIdx > 0 && capIdx > hostIdx);
  assert.equal(record.includes("Drop audio, photos, or video onto the clip or timeline. Space plays and pauses."), false);
  const name = randomVideoEditorProjectName(["Harbor Cut"]);
  assert.ok(name && name !== "Harbor Cut");
});

test("recording chrome drops toolbar EDITOR, overlay Editor, done popup Open editor", () => {
  assert.equal(html.includes('id="btn-video-editor"'), false);
  assert.equal(html.includes("viewport-view-btn--clip-editor"), false);
  assert.equal(/data-r3d-rec="studio"[^>]*>Studio</.test(record), false);
  assert.match(record, /data-r3d-rec="editor"[^>]*>Editor</);
  assert.match(record, /openClipEditorFromChrome/);
  assert.match(record, /showRecordDonePopup/);
  assert.match(app, /recchrome1/);
  assert.match(html, /recchrome1/);
});

test("finished AI video edit notice offers Open editor and an accessible close button", () => {
  const start = app.indexOf("async function applyVideoGenerationComplete");
  const end = app.indexOf("async function openReadyVideoEditor", start);
  const completionNotice = app.slice(start, end);
  assert.match(completionNotice, /open\.textContent = "Open editor"/);
  assert.match(completionNotice, /close\.setAttribute\("aria-label", "Close video editor notification"\)/);
  assert.match(completionNotice, /close\.addEventListener\("click", \(\) => notice\.remove\(\)\)/);
  assert.match(completionNotice, /notice\.append\(label, open, close\)/);
});

test("after-recording popup uses reminder key, rich markup, and skips when opted out", () => {
  const reminders = readFileSync(join(here, "../studio/studio-reminders.js"), "utf8");
  assert.match(reminders, /export const RECORD_DONE_HINT_KEY = "render3d:recordDoneHintSeen:v1"/);
  assert.match(reminders, /render3d:recordDoneHintSeen:v1/);
  assert.match(html, /id="record-done-hint-modal"/);
  assert.match(html, /Don’t show this again/);
  assert.match(html, /data-boot-social="x"[^>]*href="https:\/\/x\.com\/A1_Projects"/);
  assert.match(html, /data-boot-social="discord"[^>]*href="https:\/\/discord\.gg\/kaPZRCk9c"/);
  assert.match(html, /record-done-hint\.gif\?v=20260915-gifbtn1/);
  assert.match(html, /record-done-hint-pin-icon/);
  assert.match(html, /record-done-hint-pin--share/);
  assert.match(html, /record-done-hint-pin--gif/);
  assert.equal(html.includes("record-done-hint-playhead"), false);
  assert.match(html, /How to edit prompts with AI/);
  assert.match(html, /edit with AI or by hand/);
  assert.match(html, /data-record-done-agent/);
  assert.match(html, /Ask Agent/);
  assert.match(html, />More info</);
  assert.match(html, /data-record-done-editor[^>]*>Open editor</);
  assert.match(html, /data-record-done-share-x/);
  assert.match(html, /data-record-done-dismiss[^>]*>Dismiss</);
  assert.match(record, /RECORD_DONE_HINT_KEY/);
  assert.match(record, /reminderHasSeen\(RECORD_DONE_HINT_KEY/);
  assert.match(record, /onAskRenderAgent\(\{ question, autoSend: true \}\)/);
  assert.match(record, /btn-render-agent/);
  assert.match(record, /RECORD_DONE_AGENT_QUESTION/);
  assert.match(record, /record-done-hint\.gif\?v=20260915-gifbtn1/);
  assert.match(css, /\.record-done-hint-actions \[data-record-done-dismiss\]/);
  assert.match(css, /\.record-done-hint-actions \[data-record-done-editor\]/);
  assert.match(css, /margin-left:\s*auto/);
  assert.match(css, /record-done-hint-pin-icon/);
  assert.match(html, /recdone1/);
  assert.match(html, /gifbtn1/);
  assert.match(app, /recdone1/);
  assert.match(app, /gifbtn1/);
  const actions = html.slice(html.indexOf("record-done-hint-actions"));
  const dismissAt = actions.indexOf("data-record-done-dismiss");
  const openAt = actions.indexOf("data-record-done-editor");
  const shareXAt = actions.indexOf("data-record-done-share-x");
  const agentAt = actions.indexOf("data-record-done-agent");
  assert.ok(dismissAt >= 0 && openAt > dismissAt && shareXAt > openAt && agentAt > shareXAt, "Share to X sits next to Open editor");
});

test("mute control exists and toggles muted state", () => {
  const clip = { id: "a", muted: false };
  assert.equal(toggleMutedFlag(clip), true);
  assert.equal(clip.muted, true);
  assert.equal(toggleMutedFlag(clip), false);
  assert.match(muteButtonMarkup({ muted: false, kind: "clip" }), /data-vtl-mute="clip"/);
  assert.match(muteButtonMarkup({ muted: true, kind: "audio" }), /data-vtl-mute="audio"/);
  assert.match(muteButtonMarkup({ muted: true }), /is-muted/);
  assert.match(timeline, /data-vtl-mute/);
  assert.match(timeline, /applyPreviewMute/);
  assert.match(timeline, /setMusicMuted/);
});

test("context menu offers transition at start, end, and split at playhead", () => {
  const clips = [{ id: "a", duration: 4, trimIn: 0, trimOut: null }];
  assert.equal(playheadHitsClip(clips, "a", 1.5), true);
  assert.equal(playheadHitsClip(clips, "a", 0), false);
  const model = clipContextMenuModel({ clip: clips[0], playheadHits: true });
  assert.deepEqual(model.transitionStart, ["cut", "fade", "dissolve"]);
  assert.deepEqual(model.transitionEnd, ["cut", "fade", "dissolve"]);
  assert.equal(model.split, true);
  assert.match(model.splitLabel, new RegExp(`Split clip \\(${CLIP_SPLIT_SHORTCUT}\\)`));
  const clip = { transitionIn: null, transitionOut: null };
  setClipEdgeTransition(clip, "start", "fade");
  setClipEdgeTransition(clip, "end", "dissolve");
  assert.equal(clip.transitionIn, "fade");
  assert.equal(clip.transitionOut, "dissolve");
  assert.match(timeline, /Transition at start/);
  assert.match(timeline, /Transition at end/);
  assert.match(timeline, /CLIP_SPLIT_SHORTCUT/);
  assert.equal(CLIP_SPLIT_SHORTCUT, "S");
  assert.match(timeline, /contextmenu/);
  assert.match(timeline, /splitSelectedAtPlayhead/);
});

test("splitClipAtPlayhead splits at the playhead", () => {
  const clips = [{ id: "a", duration: 4, trimIn: 0, trimOut: null, blob: "x", url: "u" }];
  const out = splitClipAtPlayhead(clips, 1.5, { makeId: () => "b" });
  assert.equal(out.length, 2);
  assert.equal(out[0].id, "a");
  assert.equal(out[0].trimOut, 1.5);
  assert.equal(out[1].id, "b");
  assert.equal(out[1].trimIn, 1.5);
  assert.equal(out[1].url, "u");
  assert.deepEqual(splitClipAtPlayhead(clips, 0).map((c) => c.id), ["a"]);
});

test("download format dropdown lives inside the download button", () => {
  assert.deepEqual(CLIP_DOWNLOAD_FORMATS, ["mp4", "webm", "gif"]);
  assert.match(timeline, /data-vtl-download/);
  assert.match(timeline, /data-vtl-download-menu/);
  assert.match(timeline, /download-toggle/);
  assert.match(record, /data-video-download-wrap/);
  assert.match(record, /data-video-download-menu/);
  assert.match(record, /data-video-download-format="mp4"/);
  assert.match(record, /data-video-download-format="webm"/);
  assert.match(record, /data-video-download-audio="1"/);
  assert.match(record, /data-video-download-quality="ultra"/);
  assert.match(record, /data-video-download-go/);
  assert.match(record, /function placeClipDownloadMenu/);
  assert.match(record, /Prefer opening upward into the editor/);
  assert.match(css, /\.viewport-video-download-menu/);
  assert.match(html, /cliplit1/);
  assert.match(app, /cliplit1/);
  assert.match(html, /clipshare1/);
  assert.match(app, /clipshare1/);
});

test("picking a download type exports the current timeline then downloads", () => {
  assert.match(record, /void downloadEdited\(selectedDownloadFormat\(\)\)/);
  assert.match(record, /async function resolveEditorExportBlob/);
  assert.match(record, /applyPrompt: false/);
  assert.match(record, /updatePreview: false/);
  assert.match(record, /onProgress: opts.onProgress/);
  assert.match(record, /if \(videoEditor\.needsBake\?\.\(\)\) return null/);
  assert.match(record, /setClipDownloadBusy\(true, \{ percent: 0 \}\)/);
  assert.match(record, /selectedDownloadAudio/);
  assert.match(record, /selectedDownloadQuality/);
  assert.match(timeline, /finishAudioTrim/);
  assert.match(timeline, /music_start_sec/);
  assert.match(html, /dledit1/);
  assert.match(app, /dledit1/);
});

test("Download button spins with convert and film-job percent", () => {
  assert.equal(convertProgressPercent({ stage: "upload", loaded: 50, total: 100 }), 20);
  assert.equal(convertProgressPercent({ stage: "encode" }), 42);
  assert.equal(convertProgressPercent({ stage: "encode", percent: 67 }), 67);
  assert.equal(convertProgressPercent({ stage: "download", loaded: 50, total: 100 }), 69);
  assert.equal(convertProgressPercent({ stage: "done" }), 100);
  assert.equal(convertProgressPercent({ pct: 81 }), 81);
  assert.equal(convertProgressPercent(0.4), 40);
  assert.match(record, /data-video-download-pct/);
  assert.match(record, /viewport-video-download-spinner/);
  assert.match(record, /function setClipDownloadBusy/);
  assert.match(record, /onProgress: report/);
  assert.match(record, /extras\.onProgress/);
  assert.match(timeline, /filmProgressListener/);
  assert.match(timeline, /onProgress: opts.onProgress/);
  assert.match(css, /\.viewport-video-download-btn\.is-loading/);
  assert.match(css, /\.viewport-video-download-spinner/);
  assert.equal(record.includes("showVideoDownloadPopup(`Preparing ${format.toUpperCase()}…`)"), false);
  assert.match(html, /dlprog1/);
  assert.match(app, /dlprog1/);
});

test("Escape deselects timeline objects and does not park the editor", () => {
  assert.match(timeline, /function clearEditorSelection/);
  assert.match(timeline, /e\.key === "Escape"/);
  assert.match(timeline, /clearEditorSelection\(\)/);
  assert.match(record, /if \(shareModalEl && !shareModalEl\.classList\.contains\("hidden"\)\) return;/);
  assert.equal(/if \(shareModalEl && !shareModalEl\.classList\.contains\("hidden"\)\) parkClipEditor\(\)/.test(record), false);
  assert.match(html, /escunsel1/);
  assert.match(app, /escunsel1/);
});

test("Trim length applies In then cuts audio to video duration", () => {
  assert.equal(AUDIO_TRIM_DONE_LABEL, "Trim length");
  assert.equal(AUDIO_TRIM_DONE_TITLE, "Set the song start, then cut the audio to the video length.");
  const boardAt = timeline.indexOf("data-vtl-audio-trim-board");
  const doneAt = timeline.indexOf("data-vtl-audio-trim-done");
  assert.ok(boardAt >= 0 && doneAt > boardAt, "Trim length sits after the green trim board");
  assert.match(timeline, /function finishAudioTrim/);
  assert.match(timeline, /applyAudioTrimInputs\(\)/);
  assert.match(timeline, /shortenAudioToClipEnd\(musicTrack, end\)/);
  assert.match(timeline, /exitAudioTrimMode\(\)/);
  assert.match(timeline, /title="\$\{AUDIO_TRIM_DONE_TITLE\}"/);
  assert.equal(timeline.includes('data-vtl-tool="trim-audio"'), false);
  const music = { duration: 198, trimIn: 53.9, trimOut: 192.69 };
  shortenAudioToClipEnd(music, 12);
  assert.equal(Number(music.trimOut.toFixed(2)), 65.9);
  assert.equal(videoClipsEndSec([{ duration: 12, trimIn: 0, trimOut: null }]), 12);
  const cut = shortenAudioToClipEnd({ duration: 198, trimIn: 53.9, trimOut: 192.69 }, videoClipsEndSec([{ duration: 12 }]));
  assert.equal(Number((cut.trimOut - cut.trimIn).toFixed(2)), 12);
  assert.match(css, /\.vtl-audio-trim-foot/);
  assert.match(html, /trimlen1/);
  assert.match(app, /trimlen1/);
});

test("Share to X chrome reuses postToX compose-and-attach", () => {
  assert.match(record, /async function openShareToXFromChrome/);
  assert.match(record, /await postToX\(\);/);
  assert.match(record, /data-record-done-share-x/);
  assert.match(record, /data-r3d-rec="share-x"/);
  assert.match(record, /action === "share-x"\) void openShareToXFromChrome/);
  assert.match(record, /await shareBlobToX\(blob, \{ inPlace: true \}\)/);
  const postFn = record.slice(record.indexOf("async function postToX"), record.indexOf("async function shareBlobToX"));
  assert.match(postFn, /await confirmShareToX\(\)/);
  assert.equal(postFn.includes("showXCaptionPopup"), false);
  assert.equal(postFn.includes("skipCaption: true"), false);
  assert.match(record, /async function shareViaComposeAttach/);
  assert.equal(record.includes('intent: fmt === "mp4" ? "x" : ""'), false);
  assert.match(record, /never call \/api\/video\/convert/);
  assert.match(record, /openXComposeOnce/);
  assert.match(record, /twitter.com\/intent\/tweet/);
  assert.match(css, /position:\s*static/);
  assert.match(html, /sharexsame1/);
  assert.match(app, /sharexsame1/);
});

test("cliptrim1 hover mute/X, full song ruler, and iMovie edge trim", () => {
  const clip = { duration: 0, trimIn: 0, trimOut: null };
  assert.equal(clipSourceDuration(clip), 0);
  assert.match(clipTrimStatsText(clip), /1\.00s used$/);
  clip.duration = 12.5;
  assert.equal(clipEffectiveDuration(clip).toFixed(1), "12.5");
  assert.match(clipTrimStatsText(clip), /12\.50s used of 12\.50s/);
  applyEdgeTrim(clip, "in", 2);
  applyEdgeTrim(clip, "out", 8);
  assert.equal(clip.trimIn, 2);
  assert.equal(clip.trimOut, 8);
  assert.equal(clipEffectiveDuration(clip), 6);

  const song = { duration: 180, trimIn: 0, trimOut: null };
  assert.ok(timelineSpanSec([{ duration: 1, trimIn: 0, trimOut: null }], song) >= 180);
  assert.equal(timelineSpanSec([], null), 4);

  const videoMenu = clipContextMenuModel({ clip: { muted: false }, playheadHits: false });
  assert.equal(videoMenu.mute, true);
  assert.equal(videoMenu.remove, true);
  assert.equal(videoMenu.duplicate, true);
  const audioMenu = clipContextMenuModel({ clip: song, kind: "audio" });
  assert.equal(audioMenu.kind, "audio");
  assert.equal(audioMenu.duplicate, false);
  assert.equal(audioMenu.removeLabel, "Remove audio");
  assert.deepEqual(audioMenu.transitionStart, []);

  assert.match(removeButtonMarkup({ kind: "clip" }), /data-vtl-clear="clip"/);
  assert.match(removeButtonMarkup({ kind: "audio" }), /data-vtl-music-clear/);
  assert.match(timeline, /data-vtl-clear/);
  assert.match(timeline, /applyEdgeTrim/);
  assert.match(timeline, /timelineSpanSec/);
  assert.match(timeline, /data-vtl-trim-target="audio"/);
  assert.match(timeline, /stopImmediatePropagation/);
  assert.match(css, /vtl-clip:hover \.vtl-clip-clear/);
  assert.match(css, /vtl-clip:hover \.vtl-mute/);
  assert.match(css, /vtl-host\.is-trimming/);
  assert.match(app, /clip-editor-workspace/);
  assert.match(app, /shouldSkipViewportMarkingMenu/);
  assert.match(html, /cliptrim1/);
  assert.match(app, /cliptrim1/);
});

test("dropped audio is attached to playback instead of ignored", () => {
  const silent = musicTrackPlaybackState(null);
  assert.equal(silent.attached, false);
  const track = { url: "blob:audio", blob: { name: "bed.mp3" }, volume: 0.35, muted: false };
  const live = musicTrackPlaybackState(track);
  assert.equal(live.attached, true);
  assert.equal(live.muted, false);
  assert.equal(live.volume, 0.35);
  track.muted = true;
  assert.equal(musicTrackPlaybackState(track).volume, 0);
  assert.match(timeline, /data-vtl-bed/);
  assert.match(timeline, /attachMusicToPlayback/);
  assert.match(timeline, /playBedAudio/);
  assert.match(timeline, /setMusicFromFile/);
  assert.match(timeline, /musicTrackPlaybackState/);
});

test("Play/Space unmutes the preview and starts A-track audio when not muted", () => {
  assert.equal(previewMuteShouldBe({ muted: false }), false);
  assert.equal(previewMuteShouldBe({ muted: true }), true);
  assert.equal(
    previewShowsTimelineClip({ src: "blob:preview-2" }, { url: "blob:clip-1", blob: {} }),
    true,
  );
  assert.equal(
    previewShowsTimelineClip(
      { src: "/api/projects/p/files/Screen%20Recordings/a.webm" },
      { sourcePath: "Screen Recordings/a.webm" },
    ),
    true,
  );
  assert.equal(shouldStartBedAudio({
    attached: true,
    musicMuted: false,
    previewShowsClip: true,
    previewPaused: false,
  }), true);
  assert.equal(shouldStartBedAudio({
    attached: true,
    musicMuted: false,
    previewShowsClip: true,
    previewPaused: false,
    autoplayKick: true,
    previewMuted: true,
    clipMuted: false,
  }), false);
  assert.equal(shouldStartBedAudio({
    attached: true,
    musicMuted: false,
    previewShowsClip: true,
    previewPaused: false,
    previewMuted: true,
    clipMuted: true,
  }), true);
  assert.equal(shouldStartBedAudio({ attached: true, musicMuted: true, previewShowsClip: true }), false);
  assert.match(timeline, /removeAttribute\("muted"\)/);
  assert.match(timeline, /previewMuteShouldBe/);
  assert.match(timeline, /previewShowsTimelineClip/);
  assert.match(timeline, /shouldStartBedAudio/);
  assert.match(timeline, /playBedAudio\(\{ autoplayKick: false \}\)/);
  assert.match(record, /removeAttribute\("muted"\)/);
  assert.match(html, /tlaudio1/);
  assert.match(app, /tlaudio1/);
  assert.match(html, /tlspin1/);
});

test("editor share row disconnects X and keeps Download plus Share to X", () => {
  assert.match(record, /Disconnect X/);
  assert.match(record, /data-video-share-post-x/);
  assert.match(record, /Share to X/);
  assert.equal(record.includes('data-video-share-discord title="Share to Discord"'), false);
  assert.equal(/<span>Share to Discord<\/span>/.test(record), false);
  assert.match(record, /\/api\/integrations\/twitter\/link/);
  assert.match(record, /method: "DELETE"/);
  assert.equal(record.includes('textContent = "Reconnect X"'), false);
  assert.match(record, /viewport-video-share-logo/);
  assert.match(css, /viewport-video-share-logo/);
  assert.match(html, /shareprompt1/);
  assert.match(app, /shareprompt1/);
  assert.match(html, /clipui1/);
  assert.match(app, /clipui1/);
});

test("random example cycles distinct editor prompts", () => {
  assert.ok(VIDEO_EDITOR_PROMPT_EXAMPLES.length >= 4);
  const unique = new Set(VIDEO_EDITOR_PROMPT_EXAMPLES);
  assert.equal(unique.size, VIDEO_EDITOR_PROMPT_EXAMPLES.length);
  let last = "";
  for (let i = 0; i < 16; i += 1) {
    const next = nextVideoEditorPromptExample(last, { random: () => 0 });
    assert.ok(next);
    assert.notEqual(next, last);
    last = next;
  }
  assert.match(timeline, /data-vtl-example/);
  assert.match(timeline, /Show me a random example/);
  assert.match(timeline, /nextVideoEditorPromptExample/);
});

test("Ask Render Agent opens the existing agent with editor-example context", () => {
  assert.match(timeline, /data-vtl-ask-agent/);
  assert.match(timeline, /Ask Render Agent/);
  assert.match(timeline, /onAskRenderAgent/);
  assert.match(timeline, /VIDEO_EDITOR_AGENT_QUESTION/);
  assert.match(VIDEO_EDITOR_AGENT_QUESTION, /in-depth example prompts/);
  assert.match(VIDEO_EDITOR_AGENT_QUESTION, /further questions or more examples/i);
  assert.match(record, /onAskRenderAgent/);
  assert.match(app, /onAskRenderAgent/);
  assert.match(app, /openWithQuestion/);
  assert.match(ref, /onAskRenderAgent/);
});

test("question-mark help exists on the prompt", () => {
  assert.match(timeline, /data-vtl-prompt-help/);
  assert.match(timeline, /role="tooltip"/);
  assert.match(timeline, /What this prompt does/);
  assert.match(css, /\.vtl-prompt-tip/);
  assert.match(css, /\.vtl-prompt-help/);
  assert.match(css, /vtl-prompt-scan/);
});

test("viewport recordings save under Reference Files Screen Recordings and reveal the folder", () => {
  assert.equal(record.includes('opensEditor ? "Video Editor"'), false);
  assert.match(record, /folder: xr \? undefined : "Screen Recordings"/);
  assert.match(record, /Reference Files → \$\{saved\?\.folder \|\| "Screen Recordings"\}/);
  assert.match(app, /revealSavedReferenceFolder/);
  assert.match(app, /projectTree\?\.revealReferenceFolder/);
  assert.match(tree, /revealReferenceFolder\(folderName\)/);
  assert.match(html, /refrec1/);
  assert.match(app, /refrec1/);
  assert.match(app, /viewport-video-record\.js\?v=.*refrec1/);
});

test("clip editor Space plays/pauses/restarts and letter keys copy mute trim delete", () => {
  assert.equal(playheadPlaybackIntent(0, 8, { playing: false }), "play");
  assert.equal(playheadPlaybackIntent(3, 8, { playing: true }), "pause");
  assert.equal(playheadPlaybackIntent(8, 8, { playing: false }), "restart");
  assert.equal(playheadPlaybackIntent(8, 8, { playing: false, ended: true }), "restart");
  // Scrubbed back: stale ended must not restart from 0 or no-op Play.
  assert.equal(playheadPlaybackIntent(1, 8, { playing: false, ended: true }), "play");
  assert.equal(playheadPlaybackIntent(3, 8, { playing: false, ended: true }), "play");
  assert.equal(trimEdgeForPlayhead(1, 0, 4), "in");
  assert.equal(trimEdgeForPlayhead(3, 0, 4), "out");
  assert.equal(trimEdgeForPlayhead(0, 0, 4), null);
  const clips = [{ id: "a", duration: 2, trimIn: 0, trimOut: null }, { id: "b", duration: 2, trimIn: 0, trimOut: null }];
  assert.equal(clipPasteIndex(clips, 0), 0);
  assert.equal(clipPasteIndex(clips, 1), 1);
  assert.equal(clipPasteIndex(clips, 5), 2);
  assert.equal(CLIP_TRIM_SHORTCUT, "T");
  assert.equal(CLIP_MUTE_SHORTCUT, "M");
  assert.equal(CLIP_COPY_SHORTCUT, "⌘C");
  assert.equal(CLIP_PASTE_SHORTCUT, "⌘V");
  const model = clipContextMenuModel({ clip: { muted: false }, playheadHits: false });
  assert.equal(model.copy, true);
  assert.equal(model.paste, true);
  assert.match(timeline, /playheadPlaybackIntent/);
  assert.match(timeline, /trimAtPlayhead/);
  assert.match(timeline, /muteSelected/);
  assert.match(timeline, /copySelected/);
  assert.match(timeline, /pasteClipboard/);
  assert.match(timeline, /data-vtl-menu-act="copy"/);
  assert.match(timeline, /data-vtl-menu-act="paste"/);
  assert.match(timeline, /isEditorTypingTarget/);
  assert.match(timeline, /consumeEditorKey/);
  assert.match(timeline, /addEventListener\("keydown", onEditorKeyDown, true\)/);
  assert.equal(timeline.includes("Place button"), false);
  assert.match(record, /trimAtPlayhead/);
  assert.match(record, /muteSelected/);
  assert.match(record, /copySelected/);
  assert.match(record, /pasteClipboard/);
  assert.match(app, /isClipEditorPointerTarget\(e\.target\) \|\| isClipEditorTabActive\(\)/);
  assert.match(html, /clipkeys1/);
  assert.match(app, /clipkeys1/);
});

test("Space toggles playback only for the selected video editor outside chat and controls", () => {
  const selectedEditor = {
    key: " ",
    code: "Space",
    editorVisible: true,
    editorSelected: true,
  };
  assert.equal(videoPlaybackShortcutIntent(selectedEditor), "toggle");
  assert.equal(videoPlaybackShortcutIntent({ ...selectedEditor, editorSelected: false }), null);
  assert.equal(videoPlaybackShortcutIntent({ ...selectedEditor, editorVisible: false }), null);
  assert.equal(videoPlaybackShortcutIntent({ ...selectedEditor, blockedTarget: true }), null);
  assert.equal(videoPlaybackShortcutIntent({ ...selectedEditor, repeat: true }), null);
  assert.equal(videoPlaybackShortcutIntent({ ...selectedEditor, key: "Enter", code: "Enter" }), null);

  const chatInput = { closest: (selector) => selector.includes("input") ? chatInput : null };
  const chatWindow = { closest: (selector) => selector.includes(".render-agent-panel") ? chatWindow : null };
  const editorCanvas = { closest: () => null };
  assert.equal(isVideoPlaybackShortcutBlockedTarget(chatInput), true);
  assert.equal(isVideoPlaybackShortcutBlockedTarget(chatWindow), true);
  assert.equal(isVideoPlaybackShortcutBlockedTarget(editorCanvas), false);
  assert.match(record, /isEditorSelected: \(\) =>/);
  assert.match(record, /active\?\.kind === "clip" \|\| active\?\.id === CLIP_EDITOR_TAB_ID/);
});

test("Space can play immediately when an unloaded preview is already at the playhead", () => {
  assert.equal(mediaSeekIsAtTarget(0, 0, { ended: false }), true);
  assert.equal(mediaSeekIsAtTarget(0.02, 0, { ended: false }), true);
  assert.equal(mediaSeekIsAtTarget(0, 0, { ended: true }), false);
  assert.equal(mediaSeekIsAtTarget(2, 0, { ended: false }), false);
});

test("dropped audio persists once, shortens to clip, follows playhead, and has a trim-audio panel", () => {
  const music = { duration: 198, trimIn: 0, trimOut: null };
  shortenAudioToClipEnd(music, 8);
  assert.equal(music.trimOut, 8);
  assert.equal(followPlayheadScrollLeft(400, 200, 0, { padding: 40 }), 240);
  assert.equal(followPlayheadScrollLeft(80, 200, 0, { padding: 40 }), 0);
  assert.ok(fitTimelinePxPerSec(198, 600) < 20);
  assert.match(editorAudioUploadName({ name: "LoveSickness.mp3" }), /\.mp3$/i);
  assert.equal(audioPersistKey({ name: "a.mp3", size: 2, lastModified: 9 }), "a.mp3|2|9");
  assert.equal(SHORTEN_AUDIO_TO_CLIP_LABEL, "Shorten auto length to clip");
  assert.equal(TRIM_AUDIO_LABEL, "Trim audio");
  assert.equal(AUDIO_TRIM_UPDATE_LABEL, "Update");
  const model = clipContextMenuModel({ clip: { muted: false }, playheadHits: false, kind: "audio" });
  assert.equal(model.shortenAudio, true);
  assert.equal(model.trimAudio, true);
  assert.equal(rulerTickStepSec(6, 14), 10);
  assert.deepEqual(audioTrimBounds({ duration: 20, trimIn: 2, trimOut: 8 }), { full: 20, tin: 2, tout: 8 });
  assert.equal(audioTrimTimeFromClientX(50, { left: 0, width: 100 }, 10), 5);
  assert.equal(audioTrimLoopRestart(7.99, { tin: 1, tout: 8 }), 1);
  assert.equal(audioTrimLoopRestart(4, { tin: 1, tout: 8 }), 4);
  const slid = slideAudioTrimWindow({ duration: 20, trimIn: 2, trimOut: 8 }, 3);
  assert.equal(slid.trimIn, 5);
  assert.equal(slid.trimOut, 11);
  const flipped = clampMenuPosition({ pointerX: 100, pointerY: 580, menuWidth: 200, menuHeight: 240, viewWidth: 800, viewHeight: 600 });
  assert.ok(flipped.top + 240 <= 600);
  assert.ok(flipped.flipped);
  assert.match(timeline, /onPersistMedia/);
  assert.match(timeline, /persistMusicOnce/);
  assert.match(timeline, /shortenAudioToClipEnd/);
  assert.match(timeline, /data-vtl-menu-act="shorten-audio"/);
  assert.match(timeline, /data-vtl-audio-trim/);
  assert.match(timeline, /data-vtl-audio-trim-update/);
  assert.match(timeline, /data-vtl-audio-trim-span/);
  assert.match(timeline, /followPlayheadIntoView/);
  assert.match(timeline, /enterAudioTrimMode/);
  assert.match(timeline, /commitAudioTrimUpdate/);
  assert.match(timeline, /startAudioTrimListen/);
  assert.match(timeline, /placeClipMenu/);
  assert.match(timeline, /position = "fixed"/);
  assert.match(timeline, /audioTrimLooping/);
  assert.match(record, /onPersistMedia/);
  assert.match(record, /restoreEditorMusic/);
  assert.match(record, /kind === "audio"/);
  assert.match(css, /\.vtl-audio-trim/);
  assert.match(css, /\.vtl-audio-trim-span/);
  assert.match(css, /\.vtl-menu \{\s*position: fixed/s);
  assert.match(html, /clipaud1/);
  assert.match(app, /clipaud1/);
  assert.match(timeline, /onTimelineChange/);
  assert.match(timeline, /onCacheMedia/);
  assert.match(timeline, /emitTimelineDraft/);
  assert.match(timeline, /serializeEditorTimeline/);
  assert.match(record, /writeEditorSession/);
  assert.match(record, /restoreEditorMusic/);
  assert.match(record, /restoreLastEditorSession/);
  assert.match(record, /cacheEditorMediaBlob/);
  assert.match(record, /timeline: draft/);
  assert.match(html, /clipaudsave1/);
  assert.match(app, /clipaudsave1/);
});

test("editor timeline snapshot restores audio filename, volume, trim, and offset", () => {
  const snap = musicTrackSnapshot({
    filename: "Video Editor/Amber Cut/bed.mp3",
    name: "bed.mp3",
    label: "bed",
    volume: 0.2,
    muted: true,
    trimIn: 1.5,
    trimOut: 9,
    startSec: 2,
    persistKey: "bed.mp3|4|1",
  });
  assert.equal(snap.volume, 0.2);
  assert.equal(snap.muted, true);
  assert.equal(snap.trimIn, 1.5);
  assert.equal(snap.startSec, 2);
  const opts = applyMusicSnapshotOpts(snap);
  assert.equal(opts.volume, 0.2);
  assert.equal(opts.startSec, 2);
  const draft = serializeEditorTimeline({
    clips: [{ id: "c1", label: "Take", filename: "take.webm", trimIn: 0 }],
    music: { filename: "bed.mp3", volume: 0.4, startSec: 1, muted: false },
    playheadSec: 3,
  });
  assert.equal(draft.music.filename, "bed.mp3");
  assert.equal(draft.clips[0].filename, "take.webm");
  assert.equal(editorSessionStorageKey("abc"), "render3d:video-editor-session:abc");
  const listed = [
    { filename: "Video Editor/Amber Cut/other.wav", name: "other.wav", kind: "audio" },
    { filename: "Video Editor/Amber Cut/bed.mp3", name: "bed.mp3", kind: "audio" },
  ];
  assert.equal(matchListedMediaFile(listed, "bed.mp3")?.name, "bed.mp3");
  assert.match(timeline, /startSec/);
  assert.match(record, /scheduleEditorAutosave/);
});

test("saved timeline edits restore trim, split order, mute, and volume", () => {
  const media = { name: "take.webm" };
  const loaded = [{
    id: "live",
    blob: media,
    filename: "Video Editor/Cut/take.webm",
    sourcePath: "Video Editor/Cut/take.webm",
    url: "blob:take",
    ownedUrl: true,
    trimIn: 0,
    trimOut: null,
    muted: false,
  }];
  const restored = hydrateTimelineClips(loaded, [
    { id: "second", filename: "take.webm", trimIn: 5, trimOut: 9, muted: true, volume: 0.25, order: 1 },
    { id: "first", filename: "take.webm", trimIn: 1, trimOut: 4, muted: false, volume: 0.8, order: 0 },
  ]);
  assert.deepEqual(restored.map(({ id, trimIn, trimOut, muted, volume }) => ({ id, trimIn, trimOut, muted, volume })), [
    { id: "first", trimIn: 1, trimOut: 4, muted: false, volume: 0.8 },
    { id: "second", trimIn: 5, trimOut: 9, muted: true, volume: 0.25 },
  ]);
  assert.equal(restored[0].blob, media);
  assert.equal(restored[0].ownedUrl, true);
  assert.equal(restored[1].ownedUrl, false);
  assert.match(record, /restoreTimelineDraft\?\.\(draft\)/);
});

test("current prompt model drives AI film edits and timeline changes remain undoable and saved", () => {
  assert.match(timeline, /fetch\("\/api\/video\/edit-prompt"/);
  assert.match(timeline, /resolveFilmEditPlan\(originalPrompt, fields\)/);
  assert.ok(timeline.indexOf("const fields = resolveKeyFields()") < timeline.indexOf("resolveFilmEditPlan(originalPrompt, fields)"));
  const applyFn = timeline.slice(timeline.indexOf("function applyPlan"), timeline.indexOf("function needsBake"));
  assert.match(applyFn, /pushUndo\(\)/);
  assert.match(applyFn, /emitTimelineDraft\(\{ immediate: true \}\)/);
  const settleFn = timeline.slice(timeline.indexOf("async function settleClipMedia"), timeline.indexOf("async function addClip"));
  assert.match(settleFn, /probeDuration\(clip\.blob\)/);
  assert.match(app, /filmapply=20261006-2/);
  assert.match(html, /editautosave=20261006-4/);
});

test("Generate applies the AI edit instead of stopping after prompt improvement", () => {
  const genStart = timeline.indexOf("async function generateEdit");
  const genFn = timeline.slice(genStart, genStart + 12000);
  assert.match(genFn, /extractSpotifyMusicUrls\(originalPrompt\)/);
  assert.equal(genFn.includes("extractSpotifyMusic(originalPrompt)"), false);
  assert.ok(genFn.indexOf("resolveFilmEditPlan(originalPrompt, fields)") > genFn.indexOf("extractSpotifyMusicUrls(originalPrompt)"));
  assert.ok(genFn.indexOf("fetch(\"/api/video/film-edit\"") > genFn.indexOf("resolveFilmEditPlan(originalPrompt, fields)"));
});

test("trim audio loops In/Out, clamps the menu, and shrinks the preview", () => {
  assert.equal(AUDIO_TRIM_UPDATE_LABEL, "Update");
  const bounds = audioTrimBounds({ duration: 20, trimIn: 2, trimOut: 8 });
  assert.equal(bounds.tin, 2);
  assert.equal(bounds.tout, 8);
  assert.equal(audioTrimLoopRestart(7.99, bounds), 2);
  assert.equal(audioTrimLoopRestart(4, bounds), 4);
  assert.equal(audioTrimLoopRestart(1, bounds), 2);
  const rect = { left: 0, width: 100 };
  assert.equal(audioTrimTimeFromClientX(50, rect, 10), 5);
  const slid = slideAudioTrimWindow({ duration: 20, trimIn: 2, trimOut: 8 }, 3);
  assert.equal(slid.trimIn, 5);
  assert.equal(slid.trimOut, 11);
  const flipped = clampMenuPosition({
    pointerX: 40,
    pointerY: 580,
    menuWidth: 200,
    menuHeight: 280,
    viewWidth: 400,
    viewHeight: 600,
  });
  assert.ok(flipped.top < 580);
  assert.ok(flipped.left + 200 <= 400);
  assert.match(timeline, /data-vtl-audio-trim-update/);
  assert.match(timeline, /data-vtl-audio-in/);
  assert.match(timeline, /data-vtl-audio-out/);
  assert.match(timeline, /data-vtl-audio-trim-span/);
  assert.match(timeline, /placeClipMenu/);
  assert.match(timeline, /setAudioTrimChrome/);
  assert.match(timeline, /startAudioTrimListen/);
  assert.match(timeline, /audioTrimLoopRestart/);
  assert.match(timeline, /slideAudioTrimWindow/);
  assert.match(timeline, /style\.position = "fixed"/);
  assert.match(css, /\.vtl-audio-trim-span/);
  assert.match(css, /viewport-video-share-preview\.is-audio-trim/);
  assert.match(css, /\.vtl-menu \{\s*position: fixed/s);
  assert.match(html, /clipaudtrim1/);
  assert.match(app, /clipaudtrim1/);
});

test("trim waveform uses amplitude peaks not a dummy repeating pattern", () => {
  assert.match(timeline, /hydrateAudioTrimWave/);
  assert.match(timeline, /paintAudioTrimWave/);
  assert.match(timeline, /amplitudePeaksFromSamples/);
  assert.match(timeline, /decodeAudioAmplitudePeaks/);
  assert.match(timeline, /placeholderAmplitudePeaks/);
  assert.match(css, /\.vtl-audio-trim-wave span/);
  const waveCssStart = css.indexOf(".vtl-audio-trim-wave {");
  const waveCss = css.slice(waveCssStart, waveCssStart + 620);
  assert.equal(waveCss.includes("repeating-linear-gradient"), false);
  assert.match(html, /trimwave1/);
  assert.match(app, /trimwave1/);
});

test("Share to X caption popup posts after encode with percent on the Share to X button", () => {
  assert.match(record, /data-video-x-caption-post/);
  assert.match(record, /data-video-x-caption-post-label>Post to X/);
  assert.match(record, /data-video-x-format/);
  assert.match(record, /data-video-x-quality/);
  assert.match(record, /function setShareXBusy/);
  assert.match(record, /viewport-video-share-x-spinner/);
  assert.match(record, /data-video-share-post-x-label/);
  assert.match(record, /function persistShareExportPrefs/);
  assert.match(record, /render3d:viewportVideo:v1/);
  assert.match(record, /shareFormat/);
  assert.match(record, /xhr\.upload/);
  assert.match(record, /function convertProgressPercent/);
  assert.match(record, /stage === "upload"/);
  assert.match(record, /openXComposeOnce/);
  assert.match(record, /downloadShareBlob/);
  assert.match(record, /twitter.com\/intent\/tweet/);
  assert.match(record, /async function postToX\(\)/);
  assert.match(record, /showXCaptionPopup\(\)/);
  assert.match(record, /Progress belongs on Share to X/);
  assert.match(css, /\.viewport-video-share-xbtn\.is-loading/);
  assert.match(css, /\.viewport-video-share-x-spinner/);
  assert.match(css, /\[data-video-x-caption-post\]\.is-loading \.viewport-video-share-logo/);
  assert.match(css, /\.viewport-video-x-caption/);
  assert.match(html, /xsharepct1/);
  assert.match(html, /xsharebtn1/);
  assert.match(app, /xsharepct1/);
  assert.match(app, /xsharebtn1/);
});

test("play after scrub seeks the playhead, then zoom and fit control the timeline", () => {
  assert.match(timeline, /seekTimelineTo\(intent === "restart" \? 0 : playheadSec\)/);
  assert.match(timeline, /await seekTimelineTo/);
  assert.match(timeline, /void seekTimelineTo\(Math.max\(0, x \/ pxPerSec\)\)/);
  assert.match(timeline, /stale ended flag/);
  assert.match(timeline, /scheduleTimelineZoom/);
  assert.match(timeline, /data-vtl-zoom="in"/);
  assert.match(timeline, /data-vtl-zoom="out"/);
  assert.match(timeline, /data-vtl-zoom="fit"/);
  assert.match(timeline, /data-vtl-zoom-slider/);
  assert.match(timeline, /scheduleTimelineZoom\(pxPerSec \* factor/);
  assert.match(css, /\.vtl-zoom-slider/);
  assert.match(timeline, /Resize to length of the total clips/);
  assert.match(timeline, /fitTimelineToClips/);
  assert.match(css, /\.vtl-zoom/);
  assert.match(record, /restoreEditorMusic/);
  assert.match(html, /clipplay1/);
  assert.match(app, /clipplay1/);
});

test("preview chrome sits under the video with Motion and a restart-loop circle", () => {
  assert.equal(previewLoopRestartSec(), 0);
  assert.match(previewPlaybackChromeMarkup(), /data-video-motion/);
  assert.match(previewPlaybackChromeMarkup(), /data-video-restart-loop/);
  assert.match(previewPlaybackChromeMarkup(), /Restart loop/);
  assert.match(record, /data-video-preview-chrome/);
  assert.match(record, /data-video-motion/);
  assert.match(record, /data-video-restart-loop/);
  assert.match(record, /title="Restart loop"/);
  assert.match(timeline, /function restartPreviewLoop/);
  assert.match(timeline, /seekTimelineTo\(previewLoopRestartSec\(\)\)/);
  assert.match(timeline, /previewLoopOn/);
  assert.match(timeline, /onPreviewEnded/);
  assert.match(timeline, /data-video-restart-loop/);
  assert.match(css, /\.video-editor-preview-chrome/);
  assert.match(css, /\.video-editor-chrome-circle/);
  assert.match(css, /\.clip-editor-workspace\.is-studio \.clip-editor-stage/);
  assert.match(css, /min-height:\s*clamp\(280px,\s*44vh,\s*520px\)/);
  assert.match(html, /cliploop1/);
  assert.match(app, /cliploop1/);
});

test("studio video preview expands to an inspectable height", () => {
  assert.match(css, /\.clip-editor-workspace\.is-studio \.clip-editor-stage/);
  assert.match(css, /\.clip-editor-workspace\.is-studio \.video-editor-preview-wrap/);
  assert.match(css, /min-height:\s*clamp\(280px,\s*44vh,\s*520px\)/);
});

test("Share to X keeps the open timeline and spins the button, not the video", () => {
  assert.match(record, /async function shareBlobToX/);
  assert.match(record, /keepSequence/);
  assert.match(record, /xShareInPlace/);
  assert.match(record, /pendingXShareBlob/);
  assert.match(record, /is-sheet-only/);
  assert.match(record, /applyPrompt: false/);
  assert.match(record, /updatePreview: false/);
  assert.match(timeline, /updatePreview !== false/);
  assert.match(ref, /shareOpenVideoToX/);
  assert.match(app, /shareBlobToX\?\.\(blob, \{\s*inPlace: true,\s*skipCaption: !!payload\.skipCaption,\s*\}\)/s);
  assert.equal(app.includes("openShareModal?.(blob, { autoPost: true })"), false);
  assert.match(css, /#viewport-video-share-modal\.is-sheet-only/);
});

test("file-list Share to X downloads then opens compose", () => {
  assert.match(record, /skipCaption = false/);
  assert.match(record, /await confirmShareToX\(\{ skipCaption: !!skipCaption \}\)/);
  assert.match(record, /opts\.skipCaption \? "" : shareModalEl\?\.querySelector\("\[data-video-share-text\]"\)\?\.value/);
  assert.match(record, /resolveOriginalShareBlob/);
  const originalFn = record.slice(record.indexOf("async function resolveOriginalShareBlob"), record.indexOf("function waitShareDownloadTick"));
  assert.equal(originalFn.includes("ensureBaked("), false);
  assert.equal(originalFn.includes("convertViaApi"), false);
  assert.match(app, /skipCaption: !!payload\.skipCaption/);
  assert.match(app, /skipCaption: !!extra\.skipCaption/);
  assert.equal(tree.includes("skipCaption: true"), false);
  assert.match(tree, /onReferenceShareAction\(entry, sectionId, "share-x"\)/);
  assert.match(html, /refsharex1/);
  assert.match(app, /viewport-video-record\.js\?v=.*refsharex1/);
  assert.match(css, /\.browser-action-share-x\.is-loading/);
});

test("Share to X caption honors the selected export format before opening compose", () => {
  assert.equal(X_SHARE_ATTRIBUTION_LINE, "Built in Render Studio https://render3d.app");
  assert.equal(normalizeXShareCaption(""), X_SHARE_DEFAULT);
  assert.match(X_SHARE_DEFAULT, /Built in Render Studio https:\/\/render3d\.app/);
  assert.equal(
    normalizeXShareCaption("testing this out"),
    "testing this out\n\nBuilt in Render Studio https://render3d.app",
  );
  const href = xComposeHref("hello");
  assert.match(href.caption, /Built in Render Studio https:\/\/render3d\.app/);
  assert.match(href.url, /x\.com\/intent\/post\?text=/);
  assert.match(href.prev, /twitter\.com\/intent\/tweet\?text=/);
  assert.equal(/[?&]url=/.test(href.url), false);
  const confirmFn = record.slice(record.indexOf("async function confirmShareToX"), record.indexOf("function isVideoEditorRefFolder"));
  assert.match(confirmFn, /selectedShareFormat\(\)/);
  const resolveFn = record.slice(record.indexOf("async function resolveShareBlob"), record.indexOf("async function resolveEditorExportBlob"));
  assert.match(resolveFn, /classList\.contains\("is-studio"\)/);
  assert.ok(resolveFn.indexOf("resolveEditorExportBlob") < resolveFn.indexOf("pendingXShareBlob"));
  assert.match(resolveFn, /videoEditor\.needsBake\?\.\(\)/);
  const attachFn = record.slice(record.indexOf("async function shareViaComposeAttach"), record.indexOf("async function postToX"));
  assert.ok(attachFn.indexOf("downloadShareBlob") < attachFn.indexOf("openXComposeOnce"));
  assert.match(attachFn, /blobForXShare/);
  assert.match(attachFn, /blobLooksLike\(xBlob, format\)/);
  assert.match(record, /function waitShareDownloadTick/);
  assert.match(app, /Built in Render Studio https:\/\/render3d\.app/);
});

test("video editor keeps export controls reachable and opens the recording share panel", () => {
  const postFn = record.slice(record.indexOf("async function postToX"), record.indexOf("async function shareBlobToX"));
  assert.match(postFn, /resolveShareBlob\(\)/);
  assert.match(postFn, /edited timeline could not be exported/);
  assert.match(postFn, /showXCaptionPopup\(\)/);
  assert.doesNotMatch(postFn, /confirmShareToX\(\)/);
  assert.match(record, /data-video-download-label>Export MP4</);
  assert.match(record, /data-video-download-format="mp4">MP4/);
  assert.match(record, /data-video-download-format="webm">WebM/);
  assert.match(record, /data-video-download-format="gif">GIF/);
  assert.match(record, /label\.textContent = `Export \$\{fmt\.toUpperCase\(\)\}`/);
  assert.match(css, /\.clip-editor-studio \{[\s\S]*?overflow-y: auto;/);
  assert.match(css, /\.clip-editor-export-dock \{[\s\S]*?position: sticky;[\s\S]*?bottom: 0;/);
});

test("Share to X caption popup posts once after export progress", () => {
  assert.match(record, /const X_SHARE_ATTRIBUTION = "Built in Render Studio"/);
  assert.match(record, /const X_SHARE_DEFAULT = `\\n\\n\$\{X_SHARE_ATTRIBUTION_LINE\}`/);
  assert.match(record, /https:\/\/render3d\.app/);
  assert.match(record, /data-video-x-caption-post/);
  assert.match(record, /data-video-x-format/);
  assert.match(record, /data-video-x-quality/);
  assert.match(record, /persistShareExportPrefs/);
  assert.match(record, /shareFormat/);
  assert.match(record, /LS_KEY/);
  assert.match(record, /xhr\.upload\.onprogress/);
  assert.match(record, /stage === "encode"/);
  assert.match(record, /setShareXBusy\(true/);
  assert.match(record, /viewport-video-share-x-spinner/);
  assert.match(record, /openXComposeOnce/);
  assert.match(record, /xComposeOpened/);
  assert.match(record, /downloadShareBlob\(xBlob\)/);
  assert.match(record, /X will open when the file is ready/);
  assert.equal(record.includes("Add a caption, then Share to X again"), false);
  const attachFn = record.slice(record.indexOf("async function shareViaComposeAttach"), record.indexOf("async function postToX"));
  assert.ok(attachFn.indexOf("downloadShareBlob") >= 0 && attachFn.indexOf("downloadShareBlob") < attachFn.indexOf("openXComposeOnce"));
  assert.match(attachFn, /blobForXShare/);
  assert.equal(attachFn.includes("if (!xComposeOpened) openXComposeOnce"), false);
  const xShareFn = record.slice(record.indexOf("async function blobForXShare"), record.indexOf("async function shareVideoViaWebShare"));
  assert.match(xShareFn, /convertViaApi/);
  assert.match(xShareFn, /intent: "x"/);
  assert.match(timeline, /data-video-x-caption/);
  assert.match(css, /\.viewport-video-x-caption/);
  assert.match(css, /\.viewport-video-share-xbtn\.is-loading/);
  assert.match(html, /sharexcap1-xsharepct1/);
  assert.match(html, /xsharebtn1/);
  assert.match(html, /xcap2/);
  assert.match(html, /xcap3/);
  assert.match(html, /xcap4/);
  assert.match(app, /sharexcap1-xsharepct1/);
  assert.match(app, /xsharebtn1/);
  assert.match(app, /xcap2/);
  assert.match(app, /xcap3/);
  assert.match(app, /xcap4/);
});

test("Share to X opens the saved caption before any edited-timeline bake", () => {
  const postStart = record.indexOf("async function postToX");
  const postEnd = record.indexOf("async function shareBlobToX", postStart);
  const postFn = record.slice(postStart, postEnd);
  assert.match(postFn, /showXCaptionPopup\(\)/);
  assert.equal(postFn.includes("resolveShareBlob"), false);
  const confirmStart = record.indexOf("async function confirmShareToX");
  const confirmEnd = record.indexOf("function isVideoEditorRefFolder", confirmStart);
  assert.match(record.slice(confirmStart, confirmEnd), /await resolveShareBlob\(\)/);
  assert.match(record, /data-video-share-text[^\n]*addEventListener\("input"[\s\S]*scheduleEditorAutosave\(\)/);
});

test("pauseAndDetachMedia drops src before a blob revoke", async () => {
  const calls = [];
  const el = {
    src: "blob:http://localhost/clip",
    srcObject: { id: "stream" },
    pause() { calls.push("pause"); },
    removeAttribute(name) {
      calls.push(`remove:${name}`);
      if (name === "src") this.src = "";
    },
    load() { calls.push("load"); },
  };
  pauseAndDetachMedia(el);
  assert.deepEqual(calls.slice(0, 2), ["pause", "remove:src"]);
  assert.equal(el.src, "");
  assert.equal(el.srcObject, null);
  assert.equal(calls.includes("load"), shouldLoadMediaElementOnDetachTick());
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(calls.includes("load"));
});

test("scheduleRevokeObjectURL waits a tick and ignores non-blob urls", async () => {
  const original = URL.revokeObjectURL;
  const revoked = [];
  URL.revokeObjectURL = (u) => revoked.push(u);
  try {
    scheduleRevokeObjectURL("https://example/not-a-blob");
    scheduleRevokeObjectURL("blob:http://localhost/clip");
    assert.deepEqual(revoked, []);
    await new Promise((r) => setTimeout(r, 15));
    assert.deepEqual(revoked, ["blob:http://localhost/clip"]);
  } finally {
    URL.revokeObjectURL = original;
  }
});

test("closing the video editor tab is cheap and sequenced", () => {
  assert.equal(shouldLoadMediaElementOnDetachTick(), false);
  assert.equal(shouldHeavyTeardownVideoEditorOnCloseTick(), false);
  assert.equal(shouldRebuildCadOnVideoEditorCloseTick(), false);

  const parkStart = app.indexOf("function parkCanvasOverlay()");
  const parkEnd = app.indexOf("function enterCanvasTab(", parkStart);
  const parkFn = app.slice(parkStart, parkEnd);
  assert.match(parkFn, /refreshList: false/);
  assert.equal(parkFn.includes("refreshFiles"), false);
  assert.equal(parkFn.includes("dispatchEvent"), false);
  assert.equal(parkFn.includes("resize"), false);

  const persistStart = app.indexOf("async function persistCanvasBoard");
  const persistEnd = app.indexOf("async function loadCanvasBoardIfAny", persistStart);
  assert.match(app.slice(persistStart, persistEnd), /refreshList = true/);

  const closeStart = ref.indexOf("function closeTab(filename)");
  const closeEnd = ref.indexOf("function hideViewerOnly()", closeStart);
  const closeFn = ref.slice(closeStart, closeEnd);
  assert.ok(closeFn.indexOf("pauseOpenMedia") < closeFn.indexOf("destroyVideoEditor"));
  assert.ok(closeFn.indexOf("destroyVideoEditor") < closeFn.indexOf("revokeBlob"));
  assert.equal(closeFn.includes("refreshFiles"), false);
  assert.equal(closeFn.includes("dispatchEvent"), false);
  assert.match(closeFn, /clearViewerHost/);
  assert.equal(closeFn.includes("viewerEl.innerHTML = \"\""), false);

  const hideStart = ref.indexOf("function hideViewerOnly()");
  const hideFn = ref.slice(hideStart, ref.indexOf("async function openTab", hideStart));
  assert.match(hideFn, /pauseOpenMedia|pauseAndDetachMedia/);
  assert.equal(hideFn.includes("refreshFiles"), false);
  assert.match(hideFn, /clearViewerHost/);

  const pauseStart = ref.indexOf("function pauseOpenMedia()");
  const pauseFn = ref.slice(pauseStart, ref.indexOf("const RENDER_EDIT_PREF_KEY", pauseStart));
  assert.ok(pauseFn.indexOf("pauseAndDetachMedia") < pauseFn.indexOf("park"));
  assert.match(pauseFn, /data-vtl-bed/);

  const destroyStart = timeline.indexOf("destroyed = true");
  const destroyFn = timeline.slice(timeline.lastIndexOf("destroy() {", destroyStart), timeline.indexOf("},\n  };", destroyStart));
  assert.match(destroyFn, /generateAbort\?\.abort/);
  assert.match(destroyFn, /decodeAbort\?\.abort/);
  assert.match(destroyFn, /unbindPreviewPlayback/);
  assert.match(destroyFn, /cancelAnimationFrame\(zoomRaf\)/);
  assert.match(destroyFn, /scheduleVideoEditorIdle/);
  assert.ok(destroyFn.indexOf("pauseAndDetachMedia") < destroyFn.indexOf("scheduleRevokeObjectURL"));
  assert.ok(destroyFn.indexOf("pauseAndDetachMedia") < destroyFn.indexOf("scheduleVideoEditorIdle"));
  assert.equal(/URL\.revokeObjectURL/.test(destroyFn), false);
  assert.match(destroyFn, /collectHistoryOwnedUrls\(\)[\s\S]{0,40}leakfix30/);
  assert.match(timeline, /function revokeDroppedTimelineUrls\(droppedSnaps\) \{ \/\/ leakfix30/);
  assert.match(timeline, /revokeDroppedTimelineUrls\(dropped\); \/\/ leakfix30/);
  assert.match(timeline, /leakfix32: do not createObjectURL when the clip already has a url/);
  assert.match(timeline, /const existing = findClipBySourceKey\(clips, \{ sourcePath, filename: sourcePath \}\);/);
  assert.equal(destroyFn.includes("refreshFiles"), false);
  assert.equal(destroyFn.includes("dispatchEvent"), false);
  assert.equal(destroyFn.includes("renderTimeline"), false);

  assert.match(timeline, /signal: generateAbort\.signal/);
  assert.match(timeline, /signal: generateAbort\.signal|decodeAudioAmplitudePeaks\(blob, \{ count: 160, signal \}\)/);
  assert.match(record, /videoEditor\?\.park\?\.\(\)/);
  assert.match(record, /videoEditor\?\.unpark\?\.\(\)/);
  const hideWindowStart = record.indexOf("hideEditorWindow() {");
  const hideWindowFn = record.slice(hideWindowStart, record.indexOf("addStill:", hideWindowStart));
  assert.ok(hideWindowFn.indexOf("pauseAndDetachMedia") < hideWindowFn.indexOf("classList.add(\"hidden\")"));
  assert.match(hideWindowFn, /classList\.add\("hidden"\)/);
  assert.match(hideWindowFn, /classList\.remove\("is-sheet-only"\)/);
  const closeShareStart = record.indexOf("function closeShareModal()");
  const closeShareFn = record.slice(closeShareStart, record.indexOf("async function openEditorTab", closeShareStart));
  assert.match(closeShareFn, /pauseAndDetachMedia/);
  assert.equal(closeShareFn.includes("preview.load"), false);

  const restoreStart = app.indexOf("function restoreStudioViewportAfterEditor()");
  const restoreFn = app.slice(restoreStart, app.indexOf("function restoreFullViewportAfterInteraction", restoreStart));
  assert.match(restoreFn, /shouldRebuildCadOnVideoEditorCloseTick/);
  assert.match(restoreFn, /requestAnimationFrame\(restoreCad\)/);
  assert.equal(restoreFn.includes("refreshFiles"), false);

  assert.match(app, /vidclose1/);
  assert.match(html, /vidclose1/);
  assert.match(app, /vidclose2=20260916-1/);
  assert.match(html, /vidclose2=20260916-1/);
  assert.match(app, /vpwhite1/);
});

test("second open reuses a Video Editor project folder and does not copy bytes", () => {
  assert.equal(
    videoEditorProjectNameFromSource("Screen Recordings/Fullscreen Recording-edited_2.webm"),
    "Fullscreen Recording",
  );
  assert.equal(
    videoEditorFolderKey(videoEditorProjectNameFromSource("Fullscreen Recording.webm")),
    "Video Editor/Fullscreen Recording",
  );
  assert.equal(
    shouldCopyBytesIntoVideoEditorFolder({
      kind: "video",
      sourcePath: "Screen Recordings/Fullscreen Recording.webm",
    }),
    false,
  );
  const refs = mergeVideoEditorSourceRefs(
    [{ path: "Screen Recordings/Fullscreen Recording.webm", kind: "video" }],
    [{ path: "Screen Recordings/Fullscreen Recording.webm", kind: "video" }],
  );
  assert.equal(refs.length, 1);
  assert.equal(
    videoEditorOpenLockKey({ filename: "Screen Recordings/a.webm", projectId: "p1" }),
    videoEditorOpenLockKey({ filename: "Screen Recordings/a.webm", projectId: "p1" }),
  );
  assert.match(record, /persistVideoEditorSourceRefs/);
  assert.match(record, /openRecordingInEditor/);
  assert.match(record, /shouldCopyBytesIntoVideoEditorFolder/);
  assert.match(record, /openEditorProject/);
  const saveStart = app.indexOf('if (payload.action === "save-edited-video")');
  const saveFn = app.slice(saveStart, saveStart + 400);
  assert.equal(saveFn.includes("uploadProjectCapture"), false);
  const refreshStart = app.indexOf("async function refreshFiles(opts");
  const refreshFn = app.slice(refreshStart, refreshStart + 1400);
  assert.equal(refreshFn.includes("openClipEditorForEntry"), false);
  assert.equal(refreshFn.includes("openEditorProject"), false);
  assert.match(app, /openRecordingInEditor/);
  assert.match(app, /clipEditorOpenLock/);
  assert.match(html, /vedir1/);
  assert.match(app, /vedir1/);
});

test("shift-click range, marquee, no page zoom, delete/copy/paste, and undo chrome", () => {
  const clips = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.deepEqual(clipRangeIds(clips, "a", "c"), ["a", "b", "c"]);
  assert.deepEqual(clipRangeIds(clips, "d", "b"), ["b", "c", "d"]);
  assert.deepEqual(clipRangeIds(clips, "c", "missing"), ["c"]);

  const box = normalizeMarqueeRect({ x: 120, y: 80 }, { x: 10, y: 20 });
  assert.deepEqual(box, { left: 10, top: 20, right: 120, bottom: 80, width: 110, height: 60 });
  assert.deepEqual(
    clipIdsIntersectingMarquee([
      { id: "hit", left: 15, top: 25, right: 40, bottom: 50 },
      { id: "miss", left: 200, top: 200, right: 240, bottom: 240 },
    ], box),
    ["hit"],
  );

  assert.equal(isEditorPageZoomKey({ metaKey: true, key: "+" }), true);
  assert.equal(isEditorPageZoomKey({ ctrlKey: true, code: "Minus" }), true);
  assert.equal(isEditorPageZoomKey({ metaKey: true, key: "0" }), true);
  assert.equal(isEditorPageZoomKey({ key: "+" }), false);
  assert.equal(isEditorPageZoomWheel({ ctrlKey: true, deltaY: -20 }), true);
  assert.equal(isEditorPageZoomWheel({ deltaY: -20 }), false);
  assert.equal(isEditorUndoKey({ metaKey: true, key: "z" }), true);
  assert.equal(isEditorRedoKey({ metaKey: true, shiftKey: true, key: "z" }), true);
  assert.equal(isEditorRedoKey({ ctrlKey: true, key: "y" }), true);
  assert.equal(isEditorCopyKey({ metaKey: true, key: "c" }), true);
  assert.equal(isEditorPasteKey({ metaKey: true, key: "v" }), true);
  assert.equal(isEditorCopyKey({ key: "c" }), false);

  const snap = snapshotTimelineState({
    clips: [{ id: "a", label: "A" }],
    selectedIds: ["a"],
    selectedId: "a",
    playheadSec: 1.5,
  });
  assert.equal(snap.clips[0].id, "a");
  assert.deepEqual(snap.selectedIds, ["a"]);
  assert.equal(snap.playheadSec, 1.5);

  assert.match(timeline, /e\.shiftKey && \(selectionAnchor \|\| selectedId\)/);
  assert.match(timeline, /clipRangeIds\(clips, selectionAnchor \|\| selectedId, id\)/);
  assert.match(timeline, /beginMarquee/);
  assert.match(timeline, /clipIdsIntersectingMarquee/);
  assert.match(timeline, /data-vtl-marquee/);
  assert.match(timeline, /data-vtl-undo/);
  assert.match(timeline, /data-vtl-redo/);
  assert.match(timeline, /isEditorPageZoomWheel/);
  assert.match(timeline, /gesturestart/);
  assert.match(timeline, /onEditorPageZoomWheel/);
  assert.match(timeline, /isEditorUndoKey/);
  assert.match(timeline, /isEditorCopyKey/);
  assert.match(timeline, /isEditorPasteKey/);
  assert.match(timeline, /e\.key === "Backspace" \|\| e\.key === "Delete"/);
  assert.match(timeline, /isEditorTypingTarget/);
  assert.match(timeline, /undoTimeline/);
  assert.match(timeline, /redoTimeline/);
  const wheelStart = timeline.indexOf("board?.addEventListener(\"wheel\"");
  const wheelFn = timeline.slice(wheelStart, wheelStart + 420);
  assert.equal(wheelFn.includes("scheduleTimelineZoom"), true);
  assert.match(css, /vtl-marquee/);
  assert.match(css, /touch-action: pan-x pan-y/);
  assert.match(html, /tlkeys2/);
  assert.match(app, /tlkeys2/);
  assert.match(record, /openRecordingInEditor/);
  assert.match(app, /openClipEditorForEntry/);
});

test("opening a recording places a V clip immediately with a spinner, not after probe", () => {
  assert.equal(TIMELINE_CLIP_LOADING_STATUS, "Loading clip onto timeline…");
  assert.equal(shouldShowVideoLaneEmpty([], { hydrating: true }), false);
  assert.equal(shouldShowVideoLaneEmpty([], { hydrating: false }), true);
  assert.equal(shouldShowVideoLaneEmpty([{ id: "a" }]), false);
  assert.equal(clipNeedsTimelineSpinner({ pending: true, duration: 0 }), true);
  assert.equal(clipNeedsTimelineSpinner({ pending: false, duration: 49 }), false);
  const addStart = timeline.indexOf("async function addClip(");
  const addFn = timeline.slice(addStart, addStart + 7200);
  const placed = addFn.indexOf("clips.push(clip)");
  const settled = addFn.indexOf("if (clip.pending) await settleClipMedia");
  assert.ok(placed > 0);
  assert.ok(settled > placed);
  assert.match(timeline, /setTimelineLoading/);
  assert.match(timeline, /data-vtl-lane-loading/);
  assert.match(timeline, /vtl-preview-loading/);
  assert.match(timeline, /previewAlreadyHasMedia/);
  assert.match(record, /setTimelineLoading\?\.\(true, TIMELINE_CLIP_LOADING_STATUS\)/);
  assert.match(record, /void persistVideoEditorSourceRefs/);
  assert.match(ref, /setTimelineLoading\?\.\(true, TIMELINE_CLIP_LOADING_STATUS\)/);
  assert.match(css, /vtl-spin/);
  assert.match(css, /@keyframes vtl-spin/);
  assert.match(html, /tlspin1/);
  assert.match(app, /tlspin1/);
});

test("spinner clears when a recording is opened with a path ref", () => {
  assert.equal(clipNeedsTimelineSpinner({ pending: false, duration: 0 }), false);
  assert.equal(clipNeedsTimelineSpinner({ pending: true, duration: 0 }), true);
  assert.equal(timelineLoadingShouldHide({
    clipExists: true,
    previewHasSrc: true,
  }), true);
  assert.equal(timelineLoadingShouldHide({
    clipExists: true,
    previewHasSrc: false,
    elapsedMs: 0,
  }), false);
  assert.equal(timelineLoadingShouldHide({
    clipExists: false,
    previewHasSrc: false,
    elapsedMs: TIMELINE_LOADING_MAX_MS,
  }), true);
  assert.equal(timelineLoadingShouldHide({ previewError: true }), true);
  assert.equal(TIMELINE_LOADING_MAX_MS, 1500);
  assert.equal(
    projectMediaPlaybackUrl("p1", "Screen Recordings/take.webm"),
    "/api/projects/p1/files/Screen%20Recordings/take.webm",
  );
  assert.match(record, /authenticated fetch/);
  const openStart = record.indexOf("async function openRecordingInEditor");
  const openFn = record.slice(openStart, openStart + 3600);
  const fetchIdx = openFn.indexOf("await fetchProjectVideo");
  const placeIdx = openFn.indexOf("await openShareModal(blob");
  assert.ok(fetchIdx > 0 && placeIdx > fetchIdx);
  assert.match(openFn, /path_ref: true/);
  assert.match(openFn, /await openShareModal\(blob/);
  assert.match(timeline, /TIMELINE_LOADING_MAX_MS/);
  assert.match(timeline, /timelineLoadingShouldHide/);
  assert.match(html, /tlinstant1/);
  assert.match(app, /tlinstant1/);
});

test("opening the same recording twice keeps one V clip and muted video still plays A-track", () => {
  assert.equal(
    clipSourceIdentityKey({ sourcePath: "Screen Recordings/take.webm" }),
    "screen recordings/take.webm",
  );
  const first = clipsAfterOpenSource([], {
    id: "a",
    sourcePath: "Screen Recordings/take.webm",
  });
  const again = clipsAfterOpenSource(first, {
    id: "b",
    sourcePath: "Screen Recordings/take.webm",
  });
  assert.equal(again.length, 1);
  assert.equal(again[0].id, "a");
  assert.ok(findClipBySourceKey(first, { filename: "Screen Recordings/take.webm" }));
  assert.equal(shouldStartBedAudio({
    attached: true,
    musicMuted: false,
    previewShowsClip: true,
    previewPaused: false,
    previewMuted: true,
    clipMuted: true,
  }), true);
  assert.match(timeline, /findClipBySourceKey/);
  assert.match(timeline, /clipsAfterOpenSource/);
  const addStart = timeline.indexOf("async function addClip(");
  const addFn = timeline.slice(addStart, addStart + 4200);
  assert.match(addFn, /findClipBySourceKey/);
  assert.match(record, /refresh: false/);
  assert.match(record, /if \(refresh\)/);
  assert.equal(/if \(refresh \|\| data\?\.created\)/.test(record), false);
  assert.match(ref, /Never remount the timeline editor/);
  assert.match(html, /tldupe1/);
  assert.match(app, /tldupe1/);
  assert.match(html, /tlaudio1/);
});

test("dropping A-track audio does not mute the preview or every V clip", () => {
  assert.equal(audioDropShouldMutePreview(), false);
  assert.equal(previewMuteShouldBe({ muted: false }), false);
  assert.equal(clipPreviewVolume({ muted: false, volume: 1 }), 1);
  assert.equal(clipPreviewVolume({ muted: true, volume: 1 }), 0);
  const dropFn = timeline.slice(timeline.indexOf("function setMusicFromFile"), timeline.indexOf("function clearMusic"));
  assert.match(dropFn, /audioDropShouldMutePreview/);
  assert.match(dropFn, /applyPreviewMute/);
  assert.equal(/preview\.muted\s*=\s*true/.test(dropFn), false);
  assert.equal(/clip\.muted\s*=\s*true/.test(dropFn), false);
  assert.match(html, /imovie1/);
  assert.match(app, /imovie1/);
});

test("film-edit history persists versions and restores one", () => {
  const a = makeFilmEditHistoryEntry({ id: "film_a", prompt: "jump cut" });
  const b = makeFilmEditHistoryEntry({ id: "film_b", prompt: "slow zoom" });
  const list = appendFilmEditHistory(appendFilmEditHistory([], a), b);
  assert.equal(list.length, 2);
  assert.equal(filmEditHistoryById(list, "film_a")?.prompt, "jump cut");
  assert.match(timeline, /function rememberFilmVersion/);
  assert.match(timeline, /function restoreFilmVersion/);
  assert.match(timeline, /data-vtl-film-restore/);
  assert.match(timeline, /data-vtl-film-use/);
  assert.match(timeline, /Improve prompt automatically/);
  assert.match(timeline, /filmHistory/);
  assert.match(record, /applyFilmHistoryMeta/);
  assert.match(css, /\.vtl-film-history-pop/);
});

test("after-record Share to X popup has mini timeline, song start, filter, loop, and audio toggles", () => {
  assert.match(record, /data-video-x-full/);
  assert.match(record, /data-video-x-preview/);
  assert.match(record, /data-video-x-mini-tl/);
  assert.match(record, /data-video-x-add-song/);
  assert.match(record, /data-video-x-song-start/);
  assert.match(record, /Drop an audio clip\. Click the ridges to set song start\. Space listens, looped/);
  assert.match(record, /data-video-x-grade/);
  assert.match(record, /data-video-x-apply-filter/);
  assert.match(record, /function loopXSharePreview/);
  assert.match(record, /data-video-x-audio/);
  assert.match(record, /data-video-x-overlay/);
  assert.match(record, /Overlay this song/);
  assert.equal(record.includes('aria-label="Share audio"'), false);
  assert.match(record, /window\.open\(url, "_blank", "noopener,noreferrer"\)/);
  assert.equal(/if \(!win\) window\.location\.href = url/.test(record), false);
  assert.match(html, /sharexfull1|veditorhub1|trimlen1/);
  assert.match(app, /trimlen1/);
});

test("after stop recording the Share to X profile popup includes Open in editor", () => {
  assert.match(record, /await shareBlobToX\(blob, \{ inPlace: true \}\)/);
  assert.match(record, /data-video-x-profile/);
  assert.match(record, /data-video-x-caption-editor[^>]*>Open in editor</);
  assert.match(record, /function openEditorFromSharePopup/);
  assert.equal(record.includes("Connected as ${handle || \"X account\"}. Share to X uses compose + attach"), false);
  assert.equal(timeline.includes("Edited clip ready — Save edit, Download, or Share."), false);
  assert.match(css, /\.viewport-video-x-profile/);
  assert.match(html, /sharexui1|imovie1/);
  assert.match(app, /imovie1/);
});

test("stop recording shows Share to X popup and does not auto-download or open X", () => {
  const onStop = record.slice(
    record.indexOf("recorder.onstop = () => {"),
    record.indexOf("Smaller timeslice keeps Quest MediaRecorder flushing chunks."),
  );
  assert.match(onStop, /await shareBlobToX\(blob, \{ inPlace: true \}\)/);
  assert.equal(onStop.includes("await confirmShareToX("), false);
  assert.equal(onStop.includes("downloadShareBlob"), false);
  assert.equal(onStop.includes("window.open"), false);
  assert.equal(onStop.includes("openXCompose"), false);

  const shareFn = record.slice(
    record.indexOf("async function shareBlobToX"),
    record.indexOf("async function confirmShareToX"),
  );
  assert.match(shareFn, /showXCaptionPopup\(\)/);
  assert.match(shareFn, /if \(skipCaption\)/);
  assert.match(shareFn, /await confirmShareToX\(\{ skipCaption: !!skipCaption \}\)/);
  assert.equal(shareFn.includes("downloadShareBlob"), false);
  assert.equal(shareFn.includes("window.open"), false);
  assert.equal(shareFn.includes("openXCompose"), false);
  assert.match(app, /stopshare=20260916-1/);
  assert.match(html, /stopshare=20260916-1/);
});

test("AI film edit key pill defaults to subscription and generate sends the prompt", () => {
  const options = [
    { value: "personal:abc", label: "Key" },
    { value: "chatgpt:subscription", label: "ChatGPT subscription" },
  ];
  assert.equal(defaultVideoAiKeyValue(options, ""), "chatgpt:subscription");
  assert.equal(keyFieldsFromPickerValue("chatgpt:subscription").ai_key_source, "chatgpt");
  assert.equal(filmKeyPillLabel("chatgpt:subscription"), "ChatGPT subscription");
  assert.equal(filmKeyPillLabel("personal:abc"), "API key");
  assert.equal(filmEditHasSpotifyUrl("https://spotify.link/GWJMsqNLr6b"), true);
  assert.deepEqual(extractSpotifyMusicUrls("cut https://spotify.link/GWJMsqNLr6b"), ["https://spotify.link/GWJMsqNLr6b"]);
  assert.equal(filmEditPromptForGenerate("https://spotify.link/GWJMsqNLr6b zoom in"), "zoom in");
  assert.match(timeline, /prompt-key-pill/);
  assert.match(timeline, /data-vtl-key-pill/);
  assert.match(timeline, /data-vtl-key-name/);
  assert.match(timeline, /data-vtl-key-model/);
  assert.match(timeline, /syncFilmKeyPill/);
  assert.match(timeline, /liveFilmKeyDisplay/);
  assert.match(timeline, /ChatGPT subscription/);
  assert.match(timeline, /waitForFilmJob/);
  assert.match(timeline, /resumeFilmJobFromProject/);
  assert.match(timeline, /status === 202/);
  assert.match(timeline, /Generating with/);
  assert.match(app, /isVideoGenerationKind/);
  assert.match(app, /emitVideoGeneration/);
  assert.match(timeline, /form\.append\("prompt"/);
  assert.match(timeline, /clip_path_/);
  assert.match(timeline, /clipBytesForGenerate/);
  assert.match(timeline, /appendFormBlob/);
  assert.match(timeline, /function isFormBlob/);
  assert.match(timeline, /ai_key_source/);
  assert.match(timeline, /filmEditPromptForGenerate/);
  assert.match(app, /data-vtl-key-name/);
  assert.match(html, /filmeditkey1/);
  assert.match(app, /filmeditkey1/);
  assert.match(html, /clipshare1/);
  assert.match(app, /clipshare1/);
  assert.match(html, /tlinstant1/);
  assert.match(html, /imovie1/);
});

test("share link shows a copied check and iMovie toolbelt has mix sliders", () => {
  assert.match(record, /data-video-share-copied/);
  assert.match(record, /function markShareLinkCopied/);
  assert.match(css, /\.clip-editor-share-copied/);
  assert.match(timeline, /data-vtl-toolbelt/);
  assert.match(timeline, /data-vtl-trans-toggle/);
  assert.match(timeline, /data-vtl-video-vol/);
  assert.match(timeline, /data-vtl-music-vol/);
  assert.match(timeline, /data-vtl-gen-spin/);
  assert.match(record, /clip-editor-gen-badge/);
  assert.match(record, /onFilmGenerating/);
  assert.match(css, /\.vtl-toolbelt/);
  assert.match(css, /flex: 0 0 auto !important/);
});

test("clip editor chrome overlays the preview and Share to X downloads then opens a tab", () => {
  assert.match(record, /clip-editor-overlays/);
  assert.match(record, /data-clip-overlays/);
  assert.match(record, /clip-editor-stage/);
  assert.match(record, /clip-editor-export-dock/);
  assert.match(record, /clip-editor-preview-sizer/);
  assert.match(css, /\.clip-editor-overlays/);
  assert.match(css, /\.clip-editor-studio \.vtl-prompt/);
  assert.match(css, /bottom:\s*auto/);
  assert.match(css, /\.clip-editor-preview-sizer/);
  assert.match(css, /aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(record, /twitter.com\/intent\/tweet/);
  assert.match(record, /if \(fmt === "mp4" && \(blobLooksLike\(blob, "mp4"\)/);
  assert.match(record, /openXCompose\(text/);
  assert.match(html, /clipui1/);
  assert.match(app, /clipui1/);
  assert.match(html, /xtab1/);
  assert.match(app, /xtab1/);
});

test("clip editor player is a 16:9 viewport stage not a skinny bar", () => {
  assert.match(css, /\.clip-editor-stage \{/);
  assert.match(css, /flex:\s*1 1 auto/);
  assert.match(css, /min-height:\s*240px/);
  assert.match(css, /\.clip-editor-studio \.viewport-video-share-preview\.is-loading/);
  assert.match(css, /max-height:\s*none/);
  assert.match(css, /\.clip-editor-export-dock/);
  assert.match(record, /studio \? false : !hasSrc/);
  assert.match(html, /vidlayout1/);
  assert.match(app, /vidlayout1/);
  assert.match(html, /vidzoom1/);
  assert.match(app, /vidzoom1/);
  assert.match(html, /vidmodel1/);
  assert.match(app, /vidmodel1/);
  assert.match(html, /vidjob1/);
  assert.match(app, /vidjob1/);
  assert.match(css, /max-height:\s*min\(38vh, 280px\)/);
  assert.match(css, /aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(css, /\.proj-gen-user--video/);
  assert.match(css, /\.proj-gen-video-icon/);
  assert.match(browser, /proj-gen-user--video/);
  assert.match(browser, /proj-gen-video-icon/);
  assert.match(browser, /kind === "video"/);
  assert.match(app, /emitVideoGeneration/);
  assert.match(app, /applyVideoGenerationComplete/);
  assert.match(app, /pinned && !getSelectedPromptAiKey\(\)/);
  assert.match(timeline, /function filmFileHref/);
  assert.match(timeline, /filmWaitPromise/);
  assert.match(timeline, /void resumeFilmJobFromProject\(\)/);
  const parkFn = timeline.slice(timeline.indexOf("park() {"), timeline.indexOf("unpark() {"));
  assert.equal(parkFn.includes("stopFilmPoll"), false);
  assert.match(record, /resumeFilmJob\(\)/);
});

test("film-edit generate applies the result URL to the timeline immediately", () => {
  assert.equal(filmJobIsReady({ status: "complete", url: "/api/projects/p/files/edit.mp4" }), true);
  assert.equal(filmJobIsReady({ status: "running" }), false);
  assert.match(filmResultPlaybackUrl("/api/projects/p/files/edit.mp4"), /[?&]t=\d+/);
  assert.match(timeline, /function applyFilmResultToTimeline/);
  assert.match(timeline, /leakfix33: do not createObjectURL on same-trace reuse/);
  assert.match(timeline, /function hideFilmGeneratingOverlay/);
  assert.match(timeline, /setInterval\(tick, 400\)/);
  assert.match(timeline, /form\.append\("format", "mp4"\)/);
  assert.match(timeline, /applyReadyFilmJob/);
  const genStart = timeline.indexOf("async function generateEdit");
  const genFn = timeline.slice(genStart, genStart + 12000);
  assert.match(genFn, /if \(pathRef\) \{/);
  assert.match(genFn, /clipBytesForGenerate/);
  assert.match(genFn, /rememberFilmVersion/);
  assert.ok(genFn.indexOf("rememberFilmVersion") < genFn.indexOf("waitForFilmJob"));
  assert.match(record, /is-film-generating/);
  assert.match(css, /:not\(\.is-film-generating\) > \[data-video-film-spin\]/);
  assert.match(html, /clipgen1/);
  assert.match(app, /clipgen1/);
  assert.match(html, /xcap1/);
  assert.match(app, /xcap1/);
  assert.match(html, /xcap2/);
  assert.match(app, /xcap2/);
  assert.match(html, /xcap3/);
  assert.match(app, /xcap3/);
  assert.match(html, /xcap4/);
  assert.match(app, /xcap4/);
  assert.match(html, /clipui1/);
  assert.match(app, /clipui1/);
});

test("X caption popup shows video, drop-audio, slider listen, mux trim, then X tab", () => {
  assert.match(record, /Drop audio here/);
  assert.match(record, /data-video-x-song-drop/);
  assert.match(record, /function isXCaptionOpen/);
  assert.match(record, /function toggleXSharePreview/);
  assert.match(record, /function previewFromSongOffset/);
  assert.match(record, /overlay_audio/);
  assert.match(record, /audio_start/);
  assert.match(record, /function xShareShouldOverlay/);
  assert.match(record, /full\.hidden = false/);
  assert.match(record, /showXCaptionPopup\(\)/);
  assert.equal(/#viewport-video-share-modal:not\(\.is-sheet-only\) \.viewport-video-x-full \{\s*display:\s*none/.test(css), false);
  assert.match(css, /\.viewport-video-x-song-drop/);
  const postFn = record.slice(record.indexOf("async function postToX"), record.indexOf("async function shareBlobToX"));
  assert.match(postFn, /resolveShareBlob\(\)/);
  assert.match(postFn, /showXCaptionPopup/);
  const confirmFn = record.slice(record.indexOf("async function confirmShareToX"), record.indexOf("function isVideoEditorRefFolder"));
  assert.equal(/if \(!opts\.opened\) \{\s*xComposeOpened = false;\s*openXCompose/.test(confirmFn), false);
  assert.match(confirmFn, /resolveShareBlob/);
  assert.equal(confirmFn.includes("resolveOriginalShareBlob"), false);
  assert.equal(confirmFn.includes("convertViaApi"), false);
  assert.equal(confirmFn.includes("bakeXShareClip"), false);
  assert.match(confirmFn, /shareViaComposeAttach/);
  assert.ok(confirmFn.indexOf("resolveShareBlob") < confirmFn.indexOf("shareViaComposeAttach"));
  assert.equal(tree.includes("skipCaption: true"), false);
  assert.equal(record.includes("data-hub-discord"), false);
  assert.match(html, /-xcap1/);
  assert.match(app, /-xcap1/);
  assert.match(html, /xcap2/);
  assert.match(app, /xcap2/);
  assert.match(html, /xcap3/);
  assert.match(app, /xcap3/);
  assert.match(html, /sharexedit1=20261006-1/);
  assert.match(app, /sharexedit1=20261006-1/);
  assert.match(html, /xcap4/);
  assert.match(app, /xcap4/);
});

test("Share to X footer download bakes settings and song ridges set start", () => {
  const actions = record.slice(
    record.indexOf("viewport-video-x-caption-actions"),
    record.indexOf("viewport-video-x-prep hidden"),
  );
  assert.ok(actions.indexOf("data-video-x-caption-cancel") >= 0);
  assert.ok(actions.indexOf("data-video-x-caption-editor") > actions.indexOf("data-video-x-caption-cancel"));
  assert.ok(actions.indexOf("data-video-x-download") > actions.indexOf("data-video-x-caption-editor"));
  assert.ok(actions.indexOf("data-video-x-caption-post") > actions.indexOf("data-video-x-download"));
  assert.match(actions, />Download</);
  assert.match(actions, /data-video-x-caption-post-label>Post to X/);
  assert.equal(actions.includes("viewport-video-share-logo"), false);
  const audioRow = record.slice(record.indexOf("viewport-video-x-audio-group"), record.indexOf("viewport-video-share-caption"));
  assert.equal(audioRow.includes("data-video-x-download"), false);
  assert.match(record, /async function downloadXShareClip/);
  const dlFn = record.slice(record.indexOf("async function downloadXShareClip"), record.indexOf("function setXShareSong(file)"));
  assert.match(dlFn, /bakeXShareClip/);
  assert.match(dlFn, /xShareExportPlan\(baked\.type, format\)/);
  assert.match(dlFn, /convertViaApi/);
  assert.match(dlFn, /downloadBlob\(output, exportPlan\.format\)/);
  assert.equal(dlFn.includes("openXCompose"), false);
  assert.equal(dlFn.includes("reserveXComposeTab"), false);
  assert.match(record, /function xShareTrimWindow/);
  assert.match(record, /data-video-x-trim="in"/);
  assert.match(record, /data-video-x-trim="out"/);
  assert.match(record, /data-video-x-song-wave/);
  assert.match(record, /peaksForAudioBlob/);
  assert.match(record, /waveformBarsHtml/);
  assert.match(record, /function reserveXComposeTab/);
  assert.match(record, /about:blank/);
  assert.match(record, /composeTab/);
  assert.match(record, /id="video-share-caption-title">Share to \$\{X_LOGO_TITLE_SVG\}/);
  assert.match(record, /viewport-video-x-title-logo/);
  assert.equal(record.includes('id="video-share-caption-title">Share to X<'), false);
  const mini = record.slice(record.indexOf("data-video-x-mini-tl"), record.indexOf("data-video-x-song-el"));
  assert.match(mini, /data-video-x-trim="in"/);
  assert.match(mini, /data-video-x-trim="out"/);
  assert.equal(mini.includes("data-video-x-song"), false);
  const bakeFn = record.slice(record.indexOf("async function bakeXShareClip"), record.indexOf("async function downloadXShareClip"));
  assert.match(bakeFn, /xShareSheet\.grade/);
  assert.match(bakeFn, /renderEditedClip/);
  assert.equal(bakeFn.includes("convertViaApi"), false);
  assert.match(record, /function triggerLocalDownload/);
  assert.match(record, /triggerTrackedBlobDownload\(blob, filename, downloadCreated\)/);
  const localDl = record.slice(record.indexOf("function triggerLocalDownload"), record.indexOf("function downloadExtForBlob"));
  assert.equal(localDl.includes("60_000"), false);
  assert.equal(localDl.includes("createObjectURL"), false);
  assert.match(html, /sharexfix=20260916-1/);
  assert.match(app, /sharexfix=20260916-1/);
  assert.match(html, /sharex=20260916-1/);
  assert.match(app, /sharex=20260916-1/);
  assert.match(css, /\.viewport-video-x-mini-handle/);
  assert.match(css, /\.viewport-video-x-song-wave/);
  assert.match(html, /xcap3/);
  assert.match(app, /xcap3/);
  assert.match(html, /xcap4/);
  assert.match(app, /xcap4/);
});


test("Share to X trims video in/out; audio muxes that length from song start", () => {
  const win = xShareTrimWindow(12, 2, 8);
  assert.equal(win.trimIn, 2);
  assert.equal(win.trimOut, 8);
  assert.equal(win.duration, 6);
  const plan = xShareBakePlan({
    audio: true,
    song: { blob: new Blob(["x"]), trimIn: 53.9 },
    duration: 12,
    trimIn: 2,
    trimOut: 8,
  });
  assert.equal(plan.music.trimIn, 53.9);
  assert.equal(plan.videoDuration, 6);
  assert.equal(plan.needsTrim, true);
  assert.equal(xShareSongPreviewTime(0, 53.9, 198), 53.9);
  assert.equal(Number(xShareSongPreviewTime(6, 53.9, 198).toFixed(1)), 59.9);
  assert.equal(xSharePreviewLoopRestart(8, 12, 2, 8), 2);
  assert.equal(xSharePreviewLoopRestart(4, 12, 2, 8), 4);
  assert.equal(xSharePreviewLoopRestart(1.4, 0), 1.4);
  assert.equal(xSharePreviewLoopRestart(2.2, Number.NaN), 2.2);
  assert.equal(xShareFallbackDuration({ duration: 0, currentTime: 1.2 }), 1.45);
  assert.equal(xShareFallbackDuration({ duration: 12 }), 12);
  assert.equal(xShareTrackPct(50, { left: 0, width: 100 }), 0.5);
  assert.ok(xSharePlayheadPct(1.2, 0) > 0);
  assert.equal(xSharePlayheadPct(6, 12), 50);
  assert.match(record, /function startXSharePlayheadClock/);
  assert.match(record, /requestAnimationFrame\(tick\)/);
  assert.match(record, /function setXShareTrimFromPct/);
  assert.match(record, /function refreshXShareDuration/);
  assert.match(record, /durationchange/);
  assert.match(html, /xcap4/);
  assert.match(app, /xcap4/);
  const bakeFn = record.slice(record.indexOf("async function bakeXShareClip"), record.indexOf("async function downloadXShareClip"));
  assert.equal(bakeFn.includes("convertViaApi"), false);
  assert.equal(bakeFn.includes("audioStart: plan.music.trimIn"), false);
  assert.match(record, /overlay_audio/);
  assert.equal(record.includes("data-video-x-audio-trim"), false);
});

test("film polling never substitutes a different job or a running output", () => {
  const old = { kind: "video", trace_id: "old", status: "complete", url: "/old.webm" };
  const active = { kind: "video", trace_id: "active", status: "running", url: "/old.webm" };
  assert.equal(videoJobFromGeneration({ jobs: [old, active] }, "active"), active);
  assert.equal(videoJobFromGeneration({ jobs: [old] }, "active"), null);
  assert.equal(filmJobIsReady(active), false);
});


test("reopening film editor restores newest completed edit", () => {
  const first = {kind:"video", status:"complete", trace_id:"first"};
  const latest = {kind:"video", status:"complete", trace_id:"latest"};
  assert.equal(videoJobFromGeneration({jobs:[first,latest]}), latest);
});

test("video editor caps 1e10 duration seeks, downsamples waveforms, and stays off WebGL", () => {
  assert.equal(finiteAdoptDuration(Infinity), 0);
  assert.equal(finiteAdoptDuration(Number.NaN), 0);
  assert.equal(finiteAdoptDuration(1e10), 0);
  assert.equal(finiteAdoptDuration(12.5), 12.5);
  assert.ok(MAX_CLIP_DURATION_SEC >= 3600);
  assert.equal(shouldSeekUnknownMediaDuration(Infinity, { tried: false }), true);
  assert.equal(shouldSeekUnknownMediaDuration(Infinity, { tried: true }), false);
  assert.equal(shouldSeekUnknownMediaDuration(8, { tried: false }), false);
  const ticks = Math.ceil(MAX_CLIP_DURATION_SEC / rulerTickStepSec(56, 1e10));
  assert.ok(ticks <= 80);
  assert.deepEqual(stillPreviewSize(4000, 3000, 1280), { width: 1280, height: 960, scale: 0.32 });
  assert.equal(pauseOffscreenEditorMedia(null, null), 0);
  assert.equal(typeof editorPageIsHidden(), "boolean");
  assert.equal(timeline.includes("WebGLRenderer"), false);
  assert.equal(timeline.includes("new THREE"), false);
  assert.equal(editor.includes("WebGLRenderer"), false);
  assert.match(timeline, /visibilitychange/);
  assert.match(timeline, /pauseOffscreenEditorMedia/);
  assert.match(timeline, /dataset\.vtlDurationSeek/);
  assert.match(timeline, /getContext\("2d"/);
  assert.match(record, /editorPageIsHidden/);
  assert.match(record, /pauseOffscreenEditorMedia\(shareModalEl/);
  assert.match(html, /clipperf1/);
  assert.match(app, /clipperf1/);
});

test("video bake caps resolution, fps, bitrate, and stops the rAF loop", () => {
  assert.deepEqual(videoBakeOutputSize(3840, 2160), { w: 1280, h: 720 });
  assert.deepEqual(videoBakeOutputSize(1280, 720), { w: 1280, h: 720 });
  assert.equal(VIDEO_BAKE_FPS, 30);
  assert.equal(VIDEO_BAKE_BITS, 8_000_000);
  assert.match(editor, /let settled = false/);
  assert.match(editor, /cancelAnimationFrame\(raf\)/);
  assert.match(editor, /capturedMedia\?\.getTracks/);
  assert.match(editor, /scope: "video-editor-bake"/);
  assert.match(editor, /shouldStampHeapJump/);
  assert.match(editor, /revokeTrackedObjectUrls\(createdUrls\)/);
  assert.match(editor, /trackObjectUrl\(still\?\.blob, createdUrls\)/);
  assert.match(timeline, /scope: "video-editor-export"/);
  assert.match(timeline, /layoutClipsLive\(\{ live: true \}\)/);
});

test("bake tracks and revokes object URLs it created", () => {
  const created = [];
  const revoked = [];
  const prev = globalThis.URL;
  globalThis.URL = {
    createObjectURL() {
      const url = `blob:test-${created.length + 1}`;
      created.push(url);
      return url;
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
  };
  const tracked = [];
  const url = trackObjectUrl({ size: 1 }, tracked);
  assert.equal(url, "blob:test-1");
  assert.deepEqual(tracked, ["blob:test-1"]);
  assert.equal(revokeTrackedObjectUrls(tracked), 1);
  assert.deepEqual(revoked, ["blob:test-1"]);
  assert.equal(tracked.length, 0);
  globalThis.URL = prev;
});

test("tracked blob download revokes previous URL if click never happens", () => {
  const revoked = [];
  const prev = globalThis.URL;
  const prevDoc = globalThis.document;
  let n = 0;
  let clicks = 0;
  globalThis.URL = {
    createObjectURL() {
      n += 1;
      return `blob:dl-${n}`;
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
  };
  globalThis.document = {
    createElement() {
      return {
        href: "",
        download: "",
        rel: "",
        click() {
          clicks += 1;
          if (clicks === 1) throw new Error("click skipped");
        },
      };
    },
    body: { appendChild() {} },
  };
  const created = [];
  const file = new Blob(["x"], { type: "video/webm" });
  assert.throws(() => triggerTrackedBlobDownload(file, "clip.webm", created), /click skipped/);
  assert.deepEqual(created, ["blob:dl-1"]);
  assert.equal(triggerTrackedBlobDownload(file, "clip.webm", created), "blob:dl-2");
  assert.ok(revoked.includes("blob:dl-1"));
  assert.deepEqual(created, ["blob:dl-2"]);
  assert.equal(revokeTrackedObjectUrls(created), 1);
  globalThis.URL = prev;
  globalThis.document = prevDoc;
});

test("bake preview attach revokes on replace, error, and abort — not 60s onloadeddata", () => {
  const revoked = [];
  const prev = globalThis.URL;
  let n = 0;
  globalThis.URL = {
    createObjectURL() {
      n += 1;
      return `blob:preview-${n}`;
    },
    revokeObjectURL(url) {
      revoked.push(url);
    },
  };
  const listeners = {};
  const el = {
    src: "",
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener(type, fn) { if (listeners[type] === fn) delete listeners[type]; },
  };
  const created = [];
  assert.equal(attachPreviewObjectUrl(el, { size: 1 }, created), "blob:preview-1");
  assert.equal(el.src, "blob:preview-1");
  attachPreviewObjectUrl(el, { size: 2 }, created);
  assert.deepEqual(revoked, ["blob:preview-1"]);
  assert.equal(el.src, "blob:preview-2");
  listeners.error();
  assert.ok(revoked.includes("blob:preview-2"));
  attachPreviewObjectUrl(el, { size: 3 }, created);
  listeners.abort();
  assert.ok(revoked.includes("blob:preview-3"));
  assert.match(editor, /attachPreviewObjectUrl\(el, blob, previewCreated\)/);
  assert.equal(editor.includes("60_000"), false);
  assert.equal(editor.includes("el.onloadeddata"), false);
  globalThis.URL = prev;
});

test("share preview uses attachPreviewObjectUrl — not 60s onloadeddata", () => {
  assert.match(record, /attachPreviewObjectUrl\(preview, blob, sharePreviewCreated\)/);
  assert.match(record, /revokeTrackedObjectUrls\(sharePreviewCreated\)/);
  assert.match(record, /function revokeXShareSheetUrls\(\) \{ \/\/ leakfix25/);
  assert.match(record, /revokeXShareSheetUrls\(\); \/\/ leakfix25/);
  const shareOpen = record.slice(record.indexOf("async function openShareModal"), record.indexOf("function unmutePreview") > 0 ? record.indexOf("const unmutePreview") : record.length);
  assert.match(shareOpen, /attachPreviewObjectUrl/);
  assert.equal(shareOpen.includes("60_000"), false);
});

test("film history restore uses attachPreviewObjectUrl — not 60s onloadeddata", () => {
  const restore = timeline.slice(timeline.indexOf("function restoreFilmVersion"), timeline.indexOf("function hideFilmHistoryPop"));
  assert.match(restore, /attachPreviewObjectUrl\(preview, row\.outputBlob, filmHistoryPreviewCreated\)/);
  assert.equal(restore.includes("60_000"), false);
  assert.equal(restore.includes("onloadeddata"), false);
  assert.match(timeline, /revokeTrackedObjectUrls\(filmHistoryPreviewCreated\)/);
});
