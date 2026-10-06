import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  additionalPendingBaseline,
  focusedJobIdAfterPending,
  keepPendingAdditionalGeneration,
  livePreviewShouldAppend,
  livePreviewSourceStem,
  overlayPreviewFields,
  sideBySideTranslation,
  shouldDeferCompletedJobViewport,
} from "./generation-preview.js";

test("generation-live sidecar shares a stem with the published GLB", () => {
  assert.equal(
    livePreviewSourceStem("NEMA_34_Offset_Bracket.generation-live.glb"),
    livePreviewSourceStem("NEMA_34_Offset_Bracket.glb"),
  );
  assert.equal(livePreviewSourceStem("jake/mount.glb"), "mount");
});

test("Generate another / Edit selected does not append a copy of the selected part", () => {
  const preview = "NEMA_34_Offset_Bracket.generation-live.glb";
  const assembly = ["NEMA_34_Offset_Bracket.glb", "5537T457.glb"];
  assert.equal(
    livePreviewShouldAppend({
      previewAppend: true,
      previewFilename: preview,
      livePreviewHasChildren: true,
      targetMode: "edit",
      assemblyFilenames: assembly,
    }),
    false,
  );
  assert.equal(
    livePreviewShouldAppend({
      previewAppend: true,
      previewFilename: preview,
      livePreviewHasChildren: true,
      targetMode: "new",
      assemblyFilenames: assembly,
    }),
    false,
  );
});

test("Add new object may append a draft that is not already in the assembly", () => {
  assert.equal(
    livePreviewShouldAppend({
      previewAppend: true,
      previewFilename: "support_gusset.generation-live.glb",
      livePreviewHasChildren: false,
      targetMode: "new",
      assemblyFilenames: ["NEMA_34_Offset_Bracket.glb"],
    }),
    true,
  );
  assert.equal(
    livePreviewShouldAppend({
      previewAppend: true,
      previewFilename: "support_gusset.glb",
      livePreviewHasChildren: false,
      targetMode: "new",
      assemblyFilenames: ["NEMA_34_Offset_Bracket.glb"],
    }),
    false,
  );
});

test("new previews and final parts move to the next free positive-X slot", () => {
  assert.deepEqual(
    sideBySideTranslation({
      newBounds: { min: [0, 0, 0], max: [100, 80, 60] },
      occupiedBounds: [
        { min: [-300, -100, 0], max: [300, 100, 400] },
        { min: [380, -40, 0], max: [480, 60, 90] },
      ],
    }),
    [588, 0, 0],
  );
  assert.equal(sideBySideTranslation({ newBounds: null, occupiedBounds: [] }), null);
});

test("project reopen restores missing generated siblings beside the primary model", () => {
  const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "app.js"), "utf8");
  const restoreStart = app.indexOf("async function ensureMissingBrowserComponentsLoaded");
  const restoreEnd = app.indexOf("\nasync function afterModelEdit", restoreStart);
  const restore = app.slice(restoreStart, restoreEnd);
  assert.match(restore, /const append = projectAssembly\.count\(\) > 0/);
  assert.match(restore, /autoGridPlace:\s*append && !hasBakedPlacement\(entry\)/);

  const openStart = app.indexOf("async function loadProject(id)");
  const openEnd = app.indexOf("\nasync function createProject", openStart);
  const openProject = app.slice(openStart, openEnd > openStart ? openEnd : undefined);
  assert.match(openProject, /ensureMissingBrowserComponentsLoaded\(\{\s*fitView:\s*true/);
});

test("Generate another overlay stays pending until a new server job appears", () => {
  assert.equal(additionalPendingBaseline(0), 1);
  assert.equal(additionalPendingBaseline(1), 1);
  assert.equal(additionalPendingBaseline(2), 2);
  assert.equal(keepPendingAdditionalGeneration({
    pendingStart: true,
    liveJobCount: 1,
    baseline: additionalPendingBaseline(0),
  }), true);
  assert.equal(keepPendingAdditionalGeneration({
    pendingStart: true,
    liveJobCount: 2,
    baseline: additionalPendingBaseline(1),
  }), false);
  assert.equal(
    focusedJobIdAfterPending({ keepPending: true, focusedJobId: "job-1", newestLiveId: "job-2" }),
    "pending",
  );
  assert.equal(
    focusedJobIdAfterPending({ keepPending: false, focusedJobId: "pending", newestLiveId: "job-2" }),
    "job-2",
  );
});

test("Generate another does not inherit the first job's live GLB while pending", () => {
  const fields = overlayPreviewFields({
    focusedIsPending: true,
    focusedProgress: { pct: 3, label: "Starting another generation…" },
    liveProgress: { preview_filename: "bracket.generation-live.glb", preview_seq: 4 },
    watchProgress: { pct: 3 },
  });
  assert.equal(fields.preview_filename, undefined);
  assert.equal(
    overlayPreviewFields({
      focusedIsPending: false,
      focusedProgress: { preview_filename: "bracket-b.generation-live.glb", preview_seq: 1 },
      liveProgress: { preview_filename: "bracket.generation-live.glb", preview_seq: 4 },
      watchProgress: {},
    }).preview_filename,
    "bracket-b.generation-live.glb",
  );
});

test("a completed sibling does not steal the viewport while Generate another is running", () => {
  assert.equal(shouldDeferCompletedJobViewport({
    completedTraceId: "job-1",
    runningJobs: [{ trace_id: "job-2", status: "running" }],
    pendingStart: false,
  }), true);
  assert.equal(shouldDeferCompletedJobViewport({
    completedTraceId: "job-1",
    runningJobs: [{ trace_id: "pending", status: "running" }],
    pendingStart: true,
    pendingBaselineCount: 1,
  }), true);
  assert.equal(shouldDeferCompletedJobViewport({
    completedTraceId: "job-1",
    runningJobs: [{ trace_id: "pending", status: "running" }],
    pendingStart: true,
    pendingBaselineCount: 0,
  }), false);
  assert.equal(shouldDeferCompletedJobViewport({
    completedTraceId: "job-1",
    runningJobs: [],
    pendingStart: false,
  }), false);
});

test("Generate another click is not blocked by an in-flight first POST", () => {
  const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "app.js"), "utf8");
  const start = app.indexOf("async function handlePromptGenerateClick");
  const end = app.indexOf("\n// ── Parametric ribbon", start);
  assert.ok(start >= 0 && end > start);
  const fn = app.slice(start, end);
  assert.match(fn, /if \(promptClickInFlight\) \{/);
  assert.doesNotMatch(fn, /if \(promptClickInFlight \|\| promptSubmitInFlight\)/);
  assert.doesNotMatch(fn, /return \{ ok: false, error: "pending" \}/);
  assert.match(fn, /additionalCad = cadPromptWatchIsLive\(submitProjectId\)/);
  assert.match(fn, /markAdditionalGenerationPending/);
  assert.match(fn, /if \(data\.accepted \|\| data\.status === "running"\) \{/);
  assert.match(fn, /generationWatchOverlay\.focusedJobId = data\.trace_id/);
  assert.match(fn, /keep the live overlay\/jobs/);
  assert.doesNotMatch(fn, /generationPollTimer/);
});
