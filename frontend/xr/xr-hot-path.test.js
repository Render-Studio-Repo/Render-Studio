import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureDockVisible,
  resolveXrCaptureFileRel,
  grantNotifyUserIds,
  mapHistoryToStudioLines,
  studioLinesForTab,
  studioTabIds,
  shouldCheapMeshPick,
  shouldAllocGrabTransformTemps,
  shouldIncludeHeldPose,
  shouldSendXrPose,
  shouldSkipWorldUiPick,
  shouldSkipXrHudPanelPick,
  xrSpawnTargetM,
  xrSpawnInFrontOfHead,
  readXrComfortSizeM,
  writeXrComfortSizeM,
  clampXrComfortSizeM,
  readXrVoicePrefs,
  writeXrVoicePrefs,
  XR_VOICE_PREFS_KEY,
  XR_VOICE_WANTED_KEY,
  vrPermissionRows,
  iceRestartOfferOptions,
  iceServersFromApiPayload,
  xrIceFetchInit,
  shouldRestartIce,
  shouldSendIceCandidate,
  xrIceServers,
  xrIceServersHaveStun,
  xrIceServersHaveTurn,
  xrRelayTypes,
  downsampleStrokePoints,
  ingestPosePart,
  listenerAxesFromQuat,
  makePoseTrack,
  peerVoiceOutputGain,
  poseMoved,
  poseSampleAlpha,
  poseSignature,
  samplePoseTrack,
  shouldRunCsgNow,
  shouldRebuildTubeWhileDrawing,
  shouldAllocateLiveInkCylinderPerAppend,
  liveInkInstanceFromSegment,
  liveInkPoolCapacity,
  shouldRebuildExplorerWhileBusy,
  shouldTraverseSceneChrome,
  XR_SCENE_CHROME_CULL_FRAMES,
  xrFillLightsEnabled,
  nametagBeatsDock,
  grabAttachesFromHit,
  nametagHitSize,
  nametagPickFromHits,
  resolveNametagPerson,
  permissionRefreshSurfaces,
  shouldRefreshPermissionSurfaces,
  nextStrokeEvictIndex,
  XR_COMMIT_STROKE_MAX_POINTS,
  XR_LIVE_STROKE_MAX_POINTS,
  XR_NETWORK_STROKE_MAX_POINTS,
  XR_MAX_STROKES,
  XR_MAX_REMOTE_STROKES,
  shouldRelayerOverlays,
  applyOverlayMaterialFlags,
  applyWorldUiMaterialFlags,
  applyWorldUiPickMaterialFlags,
  isXrWorldPickMesh,
  skipXrInstancedPick,
  isXrCadGrabProxy,
  studioGripAllowsLiveMeshFallback,
  resolveStudioGripTarget,
  isStudioModelGrabMesh,
  studioAimHitsModel,
  studioTriggerMovesModel,
  viserRobotGripBlocked,
  shouldFlushDeferredXrProject,
  XR_GRAB_CACHE,
  XR_GRAB2_CACHE,
  XR_GRAB3_CACHE,
  XR_GRAB4_CACHE,
  XR_TOOL1_CACHE,
  XR_WIN1_CACHE,
  stickHistoryFlickEnabled,
  xrHudClickStartsWindowDrag,
  panelWorldPoseIsKept,
  shouldApplyDesktopCadFitDuringXr,
  isXrSqueezeOverlayKind,
  isExitVrHudHit,
  cadHoverGrabMesh,
  studioEitherButtonGrabsModel,
  VISER_GRIP_CACHE,
  XR_GRIP_MOVE_CACHE,
  isXrChromeKind,
  isXrPanelGripHandleKind,
  hudHitStealsCad,
  shouldCadTrianglePick,
  xrAiPanelSignature,
  xrGridPopupSignature,
  xrUiHoverSignature,
  shouldUpdateXrUiHover,
  shouldUploadXrVideoFrame,
  shouldTickXrPresence,
  shouldFaceNametag,
  shouldApplyOverlayRelayerFlags,
  shouldRebuildCaptureDock,
  shouldRebuildMenuHits,
  shouldRestoreSavedCadPoseOnEnter,
  shouldParkXrAssemblyAtTinyScale,
  shouldLoadXrAvatarMeshes,
  shouldCloneCadGhostForAvatars,
  shouldRedrawXrConsole,
  shouldPrepareXrMeshes,
  shouldKeepAuthoredTextureMaps,
  shouldApplyRenderedTextureWrap,
  materialHasWrapMaps,
  unbindMaterialWrapMaps,
  disposeParkedWrapGpuTextures,
  disposeParkedWrapGpuFromObject,
  reviveParkedWrapGpuTextures,
  shouldPlaceCadThisFrame,
  shouldClearPendingCadPlace,
  XR_PENDING_PLACE_MAX,
  shouldUnhideXrCad,
  shouldBakeParkedXrCad,
  shouldMarkCadWorldAnchored,
  shouldKeepModelClearOfNearPlane,
  shouldRefreshXrContentBox,
  shouldSkipXrScaleBake,
  shouldApplyRemoteBoardLoco,
  shouldRunXrChromeSideEffects,
  shouldSkipCadChromeTraverse,
  isDesktopSceneChrome,
  shouldStopOverlayTraverse,
  shouldBindSceneEnvironmentWhilePresenting,
  shouldRunBootSplashRaf,
  shouldMountBootHeadsetScene,
  shouldEnableXrRayFlashlight,
  shouldApplyEnvironmentWrapNow,
  shouldApplyEquirectWrapToCadViewport,
  xrPassthroughShowsRealWorld,
  xrCheapVrStageVisible,
  shouldRebindXrDockHosts,
  shouldKeepFrozenDockPose,
  shouldRequireDockSideCheck,
  shouldTickGuidesCanvas,
  shouldTickAvatarBlink,
  shouldRunXrEnterDeferredWork,
  shouldDeferXrEnterWork,
  shouldHideCadOnXrEnter,
  shouldPrepareXrMeshesOnEnter,
  shouldSkipCadTrianglePick,
  shouldPickLiveCad,
  shouldCreateXrClipViewer,
  shouldHoverDrawablePick,
  shouldReuseCachedXrBounds,
  shouldWalkXrPlaceAabb,
  shouldStopXrPlaceAabbWalk,
  xrWalkMeshesCapped,
  xrWorldBoxFromLocalBox,
  readXrLocalBox,
  stashXrLocalBox,
  shouldCloneXrPbrMaterials,
  shouldShareXrCadMaterial,
  xrMaterialSwapBudget,
  shouldSyncCadEdgesWhilePresenting,
  shouldHideCadEdgesInXr,
  shouldUploadXrWrapTexture,
  xrTextureMaxDim,
  shouldDisposeDesktopOnlyTarget,
  shouldResizeDesktopRenderer,
  shouldParkDesktopViewportForCanvasTab,
  shouldKeepViewportVisibleWhilePresenting,
  applyXrPresentingViewportEl,
  isWebglContextLost,
  tryRestoreWebglContext,
  reattachRendererCanvas,
  hideEditorCoveringViewport,
  XR_PLACE_AABB_MESH_CAP,
  XR_MAT_SWAP_CHUNK,
  xrMeshTriangleCount,
  xrCadTreeCensus,
  xrCadUnhideUnits,
  xrUnitTriangleCount,
  xrUnhideFramePlan,
  shouldDelayHighPolyXrPart,
  shouldRevealXrHighPoly,
  shouldShowXrCadProxy,
  stashXrLocalBoxFromOwnGeometry,
  xrGeometryLocalBox,
  xrCadPaletteKey,
  xrCadPaletteHex,
  shouldRunXrEnterCanvasWork,
  shouldRunXrVoiceIceWork,
  shouldSkipOverBudgetXrMesh,
  xrSimplifiedStandIn,
  xrAnnotateUnhideUnit,
  xrCadUnhideInProgress,
  XR_UNHIDE_MESHES_PER_FRAME,
  XR_FIRST_FRAME_TRI_BUDGET,
  XR_MESH_TRI_HARD_CAP,
  XR_CAD_DRAW_MAX_PARTS,
  XR_CAD_DRAW_MAX_TRIS,
  XR_FRAMEBUFFER_SCALE,
  XR_FOVEATION,
  XR_PERF_CACHE,
  shouldSyncPrinterVisuals,
  shouldTickPrinterFencePreview,
  shouldPaintShareAimHud,
  shouldFollowHudThisFrame,
  shouldFormatXrClockHud,
  shouldRebuildDashedPrinterBox,
  XR_HUD_CANVAS_SCALE,
  shouldCapXrCadSessionDraw,
  shouldSkipWorldMeshPick,
  shouldExtraWorldPick,
  shouldTraverseCadForXrContentBox,
  applyXrRenderScale,
  xrFoveationLevel,
  xrFramebufferScaleFactor,
  xrSessionFoveation,
  XR_ENTER_CANVAS_MS,
  XR_OVERLAY_RELAYER_MAX_MESHES,
  publicProfileTabIds,
  publicProfileLinesForTab,
  xrConsoleSignature,
  AR_CHOOSER_ACTION_IDS,
  isArChooserAction,
  isFallbackXrManager,
  shouldSetupXrControllers,
  shouldRequestImmersiveArOnDesktop,
  desktopCameraArPlan,
  headPoseFromDeviceOrientation,
  crescentCaptureToolIds,
  crescentMoonOffsets,
  formatXrRecordingClock,
  xrCaptureSendAction,
  xrCaptureIsStillKind,
  xrCaptureIsHeadsetMediaName,
  xrMediaUrlWithToken,
  applyXrClipViewerMaterialFlags,
  shouldResetStarterOnBHold,
  XR_B_HOLD_RESET_MS,
  XR_STARTER_TOOL_ID,
  shouldDismissToolOnBPress,
  laserPointerModeOn,
  presentingPickLasersOn,
  handheldToolHidesLaser,
  controllerHidesDrawLaser,
  laserVisibleForAim,
  laserLengthForAim,
  pointerTipOffsetM,
  pointerTipVisible,
  pointerVisibleWhilePresenting,
  shouldOrbitGrabbedModel,
  gripHoldIsTranslateOnly,
  reviveXrParkedMaterials,
  wrapReviveDisposesParkedMaps,
  isXrSelectionAabb,
  hideXrSelectionAabbs,
  wheelPageHasMeasure,
  preferUiHoverHit,
  isXrUiHoverKind,
  shouldUseMenuAimTip,
  menuAimTipKind,
  controllerIsNearMenu,
  XR_MENU_AIM_NEAR_M,
  isXrWorldMenuHoverKind,
  wristYieldsToWorldMenu,
  xrUiPickBlocksDraw,
  wristUiHitIsExclusive,
  XR_WRIST_UI_EXCLUSIVE_M,
  closerUiHit,
  hudKindStaysWorldLocked,
  pickXrRecordMimeType,
  wristRailToolOrder,
  captureIsCrescentNotStrip,
  developerModeEnabled,
  xrDebuggerLogFilename,
  shouldPostXrPerfSample,
  shouldUploadXrDebuggerLog,
  summarizeXrFrameTimes,
  summarizeXrHitchSpikes,
  WRIST_RAIL_TOOL_IDS,
  WRIST_MENU_GRID_IDS,
  SETTINGS_PANEL_TAB_IDS,
  SETTINGS_PANEL_TAB_LABELS,
  roboticsSettingsLines,
  readRoboticsHudPrefs,
  toolHandUiIds,
  xrSnapControlHand,
  createXrCreateHistory,
  parkXrObject,
  toolHandShowsCreateHistory,
  laserVisibleForHit,
  laserLengthM,
  XR_LASER_MIN_M,
  XR_LASER_MAX_M,
  XR_LASER_FALLBACK_M,
  headsetSpotlightTarget,
  BOOT_LAYOUT_CLASS_NAMES,
  BOOT_SPLASH_RENDER_ORDER,
  bootLogoPlacement,
  bootSplashLogoInFrontOfGear,
  flashlightFromRay,
  logoEasterEggShouldFire,
  environmentWrapPrompt,
  isEnvironmentWrapIntent,
  workspaceEnvironmentLines,
  GPT_IMAGE_MODEL_CANDIDATES,
  authorizedAppStreamProviderIds,
  authorizedAppStreamProviders,
  detectHeadsetCastFamily,
  shouldOpenStreamCastPicker,
  streamCastPickerToolIds,
  streamCastFooterHint,
  headsetCastHudCopy,
  headsetCastOpenUrl,
  startHeadsetCastSession,
  META_CAST_RECEIVER_URL,
  META_CAST_HELP_URL,
  shouldTickDimosTeleop,
  shouldAttachDimosOnXrEnter,
  shouldEnsureDimosCoordinatorOnXrEnter,
  shouldRunStudioAHold,
  shouldRunStudioLaser,
  sourceOwnsStudioLaser,
  shouldRunStudioGripGrab,
  studioUiOverridesDimosSelect,
  dimosShouldForwardSelect,
  nextToolAfterDimosArmChange,
  shouldRestyleCadMaterialsOnXrEnter,
  shouldStripCadExtrasOnXrEnter,
  shouldKillBootSplashForXrPresent,
  shouldOpenLastProjectOnXrEnterHotPath,
  shouldUseWindowRafWhileXrPresenting,
  shouldAllocateXrHudPanelOnSelectTick,
  shouldPaintXrHudPanelOnSelectTick,
  xrHudPanelNeedsDeferredPaint,
  XR_LAZY_HUD_PANEL_KINDS,
  shouldParseXrEnvironmentStoreOnSelectTick,
  shouldOpenDesktopPreferencesWhilePresenting,
  shouldLetXrSelectReachDomTarget,
  shouldRestyleCadOnXrMenuOpen,
  shouldStripCadOnXrMenuOpen,
  shouldOpenProjectOnXrMenuOpen,
  shouldCreateWebglForXrSettings,
  shouldParseEnvironmentDataUrlsOnXrMenuOpen,
  shouldUseLiteXrPanelChrome,
  shouldCaptureWebglFramebufferOnXrMenu,
  shouldHydrateDesktopPreferencesWhileXrPresenting,
  shouldResizeXrUiCanvas,
  xrMenuOpenForbiddenWork,
  xrViewToolIsCadHeavy,
  shouldRunCadHeavyXrViewTool,
  drawHandWristLocalOffset,
  DRAW_HAND_FACE_RX,
  shouldAttachDrawHandToAimController,
  shouldAttachSnapControlToAimController,
  snapControlLocalOffset,
  uiPickBlocksGripGrab,
  sourceHasStudioFaceButtons,
  xrGamepadTriggerPressed,
  xrSelectDebounceBlocks,
  selectStartShouldCommit,
  firstUiPointerMayUseOtherHand,
  shouldPollStudioFaceButtons,
  studioAHoldGamepadSources,
  applySessionTriggerPoll,
  applySessionSqueezePoll,
  xrGamepadSqueezePressed,
  unlabeledTriggerHandIndex,
  stickyXrHandedness,
  xrPollSelectPointer,
  xrTriggerRayMiss,
  xrSourceLooksLikeTouchPad,
  xrSourceHandIndex,
  resolveSelectAim,
  resolvePosedAim,
  rayHitsAabb,
  menuLaserRadiusM,
  applyXrSpacePoseToObject,
  xrAimPoseIsLive,
  XR_AIM_POSE_MIN_M,
  xrMeshWorldAabbFromGeometry,
  XR_UI_PICK_CACHE,
  selectHitFromAimOrGrip,
  controllerOccludesWorldUi,
  controllerModelHiddenForUi,
  styleXrControllerOverlayMesh,
  disableXrPointerRaycast,
  preferHudHitOverCad,
  XR_CONTROLLER_OVER_UI_ORDER,
  XR_LASER_OVER_UI_ORDER,
  xrMeshIsWristOrHudUi,
  xrUiHitObjectIsLive,
  prepareXrUiRaycaster,
  restoreXrUiPickRaycast,
  preferHudActionHit,
  isXrHudActionKind,
  nearestDockToolId,
  laserPickNode,
  xrPlaneWorldAabbFromMatrix,
  xrCircleWorldAabbFromMatrix,
  xrControlsUiTag,
  studioLeftMenuFacePressed,
  shouldToggleWristMenuOnLeftFace,
  XR_LASER_IDLE_STUB_M,
  XR_AABB_PAD_M,
  shouldRestyleXrControllerOverlay,
  xrWristPlateDepthFlags,
  WRIST_PLATE_PAD_M,
  WRIST_PLATE_BORDER_EXTRA_M,
  WRIST_PLATE_HOVER_SCALE,
  wristPlateLayout,
  wristPlateCanvasSize,
  xrHudPlateFromItems,
  shouldIngestDimosJpeg,
  shouldPollHandCamJpeg,
  shouldKeepXrCadLightRole,
  selectToolShowsPointer,
  sessionSelectEventShouldClick,
  wheelDismissLockActive,
  xrHudCanvasScale,
  xrHudCanvasBackingSize,
  xrHudTextureOpts,
  snapLaserHitIsPoke,
  shouldCaptureXrFramebufferOnSelectTick,
  xrSpectatorCaptureSize,
  xrScreenshotMimeType,
  xrRecordStartDeferMs,
  shouldBlitXrDomCanvasWhilePresenting,
  shouldOpenXrPassthroughCamera,
  preferCrescentDockHit,
  CRESCENT_HIT_LOCAL_Z,
} from "./xr-hot-path.js?v=roboticsworkspace3";
import {
  XR_GUIDE_CATEGORIES,
  wrapGuideClipIndex,
  swipeGuideFromDeltaX,
  guideCategoryById,
  pickGuidesHit,
} from "./xr-guides.js";
import {
  applyLayoutToPoseMap,
  layoutThumbCells,
  nextLayoutName,
  parseLayoutStore,
  serializeOpenWindowsLayout,
  shouldAutoApplyLastLayout,
  upsertNamedLayout,
  xrLayoutsStorageKey,
} from "./xr-window-layouts.js";
import {
  aabbCornersFromCenterSize,
  CORNER_JOIN_M,
  extrudeAabbFace,
  nearestCornerJoin,
  translatePointByJoin,
} from "./xr-build-tools.js";
import { xrSelectConsumeTarget } from "./xr-controls-debug.js";

const here = dirname(fileURLToPath(import.meta.url));

test("CSG never runs on the draw or move pick path", () => {
  assert.equal(shouldRunCsgNow({ drawing: true }), false);
  assert.equal(shouldRunCsgNow({ grabbing: true }), false);
  assert.equal(shouldRunCsgNow({ combining: true }), false);
  assert.equal(shouldRunCsgNow({}), true);
});

test("draw and grab never take the full CAD mesh raycast", () => {
  assert.equal(shouldCheapMeshPick({ drawing: true, tool: "grab" }), true);
  assert.equal(shouldCheapMeshPick({ grabbing: true, tool: "grab" }), true);
  assert.equal(shouldCheapMeshPick({ creating: true, tool: "create_box" }), true);
  assert.equal(shouldCheapMeshPick({ tool: "draw" }), true);
  assert.equal(shouldCheapMeshPick({ tool: "create_wall" }), true);
  assert.equal(shouldCheapMeshPick({ tool: "scale" }), true);
  assert.equal(shouldCheapMeshPick({ tool: "grab" }), true);
  assert.equal(shouldCheapMeshPick({ tool: "rotate" }), true);
  assert.equal(shouldCheapMeshPick({}), true);
  assert.equal(shouldCheapMeshPick({ tool: "measure" }), false);
  assert.equal(shouldAllocGrabTransformTemps(), false);
  const here = dirname(fileURLToPath(import.meta.url));
  const xrSrc = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(xrSrc.includes("_grabNext.compose"));
  assert.equal(/function updateGripGrab[\s\S]*new THREE\.Matrix4\(\)\.compose/.test(xrSrc), false);
  const cheapFn = xrSrc.slice(xrSrc.indexOf("function pickDrawablesAabb"), xrSrc.indexOf("function closestPointsOnSegments"));
  assert.ok(cheapFn.includes("skipXrInstancedPick"));
  assert.ok(cheapFn.includes("const cheap = shouldCheapMeshPick(busyState)"));
  assert.ok(cheapFn.includes("pickLiveCadAabb"));
  assert.ok(cheapFn.includes("pickDropsAabb"));
  const cheapIf = cheapFn.indexOf("if (cheap)");
  const triCad = cheapFn.indexOf("intersectObject(mesh");
  assert.ok(cheapIf >= 0 && triCad > cheapIf, "CAD triangle pick must sit behind the cheap AABB return");
  const pickGrab = xrSrc.slice(xrSrc.indexOf("function pickGrabMesh"), xrSrc.indexOf("function pickScaleMesh"));
  assert.ok(pickGrab.includes("grabAttachesFromHit"));
  assert.equal(pickGrab.includes("controllerNearMesh(controller, 0.18)"), false);
  assert.ok(pickGrab.includes("resolveAssemblyPart(hit.object)"));
  const gripFn = xrSrc.slice(xrSrc.indexOf("function updateGripGrab"), xrSrc.indexOf("function updateGrab"));
  assert.ok(gripFn.indexOf("squeezes") >= 0);
  assert.ok(gripFn.includes("if (panelDrag || !gripGrab) return"), "held grip must not acquire a new CAD target");
  assert.equal(gripFn.includes("pickGrabMesh"), false);
  const scaleFn = xrSrc.slice(xrSrc.indexOf("function updateTwoHandScale"), xrSrc.indexOf("async function requestXrSession"));
  assert.ok(scaleFn.indexOf("if (!both)") >= 0, "two-hand scale waits for both squeezes");
  assert.ok(scaleFn.indexOf("if (!both)") < 0 || scaleFn.indexOf("pickScaleMesh") < 0
    || scaleFn.indexOf("if (!both)") < scaleFn.indexOf("pickScaleMesh"), "two-hand scale must not pick before both squeezes");
  assert.equal(gripFn.includes("new THREE.Matrix4"), false);
  const poseFn = xrSrc.slice(xrSrc.indexOf("function applyPackedPose"), xrSrc.indexOf("function applyRemoteDrawMessage"));
  assert.equal(poseFn.includes("new THREE.Matrix4"), false, "remote held pose must reuse scratch matrices");
  const panelFn = xrSrc.slice(xrSrc.indexOf("function beginPanelDrag"), xrSrc.indexOf("function updatePanelDrag"));
  assert.equal(panelFn.includes("new THREE.Matrix4"), false);
  assert.equal(grabAttachesFromHit({ kind: "mesh", object: { uuid: "cad" } }), true);
  assert.equal(grabAttachesFromHit({ kind: "drop", root: { uuid: "d1" } }), true);
  assert.equal(grabAttachesFromHit({ kind: "tool", tool: "grab" }), false);
  assert.equal(shouldSkipWorldUiPick({ drawing: true }), true);
  assert.equal(shouldSkipWorldUiPick({ creating: true, tool: "create_box" }), true);
  assert.equal(shouldSkipWorldUiPick({ grabbing: false, drawing: false }), false);
  assert.equal(shouldSkipWorldUiPick({ drawing: true, uiHit: true }), false);
  assert.equal(shouldSkipWorldUiPick({ creating: true, tool: "create_box", nearMenu: true }), false);
});

test("Draw / Create rays skip floating HUD menus", () => {
  assert.equal(shouldSkipWorldUiPick({ drawing: true }), true);
  assert.equal(shouldSkipWorldUiPick({ creating: true, tool: "create_box" }), true);
  assert.equal(shouldSkipXrHudPanelPick({ drawing: true, tool: "draw" }), false);
  assert.equal(shouldSkipXrHudPanelPick({ tool: "grab" }), false);
  assert.equal(shouldSkipXrHudPanelPick({ drawing: true, tool: "draw", laserAim: true }), false);
  assert.equal(shouldSkipXrHudPanelPick({ creating: true, tool: "create_box", bHeld: true }), false);
  assert.equal(shouldCheapMeshPick({ drawing: true, tool: "draw" }), true);
  assert.equal(shouldCheapMeshPick({ tool: "create_box" }), true);
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const pickFn = xr.slice(xr.indexOf("function pickWithController"), xr.indexOf("function cheapMeshPick"));
  assert.ok(pickFn.includes("pickWristUi"));
  assert.ok(pickFn.includes("pickWristUi(raycaster, toolHand.buttons"));
  assert.ok(pickFn.includes("mapWheelIntersection"));
  const dockAt = pickFn.indexOf("pickWristUi");
  const wheelAt = pickFn.indexOf("mapWheelIntersection");
  const handleAt = pickFn.lastIndexOf("xrSolidDraw.pickHandle");
  const viewAt = pickFn.indexOf("viewPanel");
  const aiAt = pickFn.indexOf("aiPanel");
  assert.ok(dockAt >= 0 && wheelAt > dockAt);
  assert.ok(viewAt > wheelAt && aiAt > wheelAt);
  assert.ok(handleAt > viewAt && handleAt > aiAt, "solid handles must not steal menu picks");
  assert.equal(pickFn.includes("shouldSkipWorldUiPick(busyState)"), false);
  assert.ok(pickFn.includes("shouldSkipXrHudPanelPick"));
  assert.ok(pickFn.includes("closerUiHit(wristCandidate, mappedHand)"));
  assert.ok(pickFn.includes("laserPointerActive()"));
  const setAi = xr.slice(xr.indexOf('if (id === "ai"'), xr.indexOf('if (id === "undo")'));
  assert.ok(setAi.includes("openAiPromptPanel"));
  assert.equal(setAi.includes('toggleGridPopup("aiHub")'), false);
  const openAi = xr.slice(xr.indexOf("function openAiPromptPanel"), xr.indexOf("function closeAiPromptPanel"));
  const visAt = openAi.indexOf("panel.group.visible = true");
  const refreshAt = openAi.indexOf("refreshAiPromptPanel()");
  assert.ok(openAi.includes("xrHudParked = true"));
  assert.ok(openAi.includes("ensureHudWorldParent"));
  assert.equal(openAi.includes("camera.add"), false);
  assert.equal(openAi.includes(".hand.add"), false);
  assert.ok(xr.includes("function firstUiPointer"));
  assert.ok(xr.includes("const DOCK_HIT_MAX_M = 1.45"));
  assert.ok(xr.includes("aiModelPickerOpen"));
  assert.ok(xr.includes("modelPickerHit"));
  assert.ok(xr.includes("syncAiModelPickerHits"));
  assert.ok(xr.includes("openAiKeyboard"));
  assert.ok(xr.includes('id === "type"'));
  assert.ok(xr.includes('id === "progress"'));
  assert.ok(xr.includes("markWorldUi"));
  assert.ok(xr.includes("xrWorldDepth"));
  assert.ok(xr.includes("openAiLoading"));
  assert.ok(xr.includes('id.startsWith("model:")') || xr.includes('String(id).startsWith("model:")'));
  assert.equal(xr.includes('if (id === "key" || id === "model")'), false);
  assert.ok(xr.includes("function settingsTabCell"));
  assert.ok(xr.includes("function settingsToolsForTab"));
  assert.ok(xr.includes("function gridSpecTools"));
  const setSettings = xr.slice(xr.indexOf('if (id === "settings")'), xr.indexOf('if (id === "hand_left")'));
  assert.ok(setSettings.includes('toggleGridPopup("settings")'));
  assert.ok(xr.includes("SETTINGS_PANEL_TAB_IDS"));
  assert.ok(xr.includes('id: "settings"'));
});

test("Settings and headset menu clicks defer HUD canvas off the XR select tick", () => {
  assert.equal(shouldAllocateXrHudPanelOnSelectTick({ presenting: true, panelReady: false }), false);
  assert.equal(shouldAllocateXrHudPanelOnSelectTick({ presenting: true, panelReady: true }), true);
  assert.equal(shouldAllocateXrHudPanelOnSelectTick({ presenting: false, panelReady: false }), true);
  assert.equal(shouldPaintXrHudPanelOnSelectTick({ presenting: true }), false);
  assert.equal(shouldPaintXrHudPanelOnSelectTick({ presenting: false }), true);
  assert.equal(xrHudPanelNeedsDeferredPaint({ presenting: true, kind: "settings", panelReady: false }), true);
  assert.equal(xrHudPanelNeedsDeferredPaint({ presenting: true, kind: "settings", panelReady: true }), false);
  assert.equal(xrHudPanelNeedsDeferredPaint({ presenting: false, kind: "settings", panelReady: false }), false);
  for (const kind of XR_LAZY_HUD_PANEL_KINDS) {
    assert.equal(xrHudPanelNeedsDeferredPaint({ presenting: true, kind, panelReady: false }), true, kind);
  }
  assert.equal(shouldParseXrEnvironmentStoreOnSelectTick({ presenting: true }), false);
  assert.equal(shouldParseXrEnvironmentStoreOnSelectTick({ presenting: false }), true);
  assert.equal(shouldOpenDesktopPreferencesWhilePresenting({ presenting: true }), false);
  assert.equal(shouldOpenDesktopPreferencesWhilePresenting({ presenting: false }), true);
  assert.equal(shouldLetXrSelectReachDomTarget({ presenting: true, isXrCanvas: false }), false);
  assert.equal(shouldLetXrSelectReachDomTarget({ presenting: true, isXrCanvas: true }), true);
  assert.equal(shouldLetXrSelectReachDomTarget({ presenting: false, isXrCanvas: false }), true);
  assert.equal(shouldRestyleCadOnXrMenuOpen(), false);
  assert.equal(shouldStripCadOnXrMenuOpen(), false);
  assert.equal(shouldOpenProjectOnXrMenuOpen(), false);
  assert.equal(shouldCreateWebglForXrSettings({ presenting: true }), false);
  assert.equal(shouldParseEnvironmentDataUrlsOnXrMenuOpen(), false);
  assert.equal(shouldUseLiteXrPanelChrome({ presenting: true }), true);
  assert.equal(shouldCaptureWebglFramebufferOnXrMenu({ presenting: true }), false);
  assert.equal(shouldHydrateDesktopPreferencesWhileXrPresenting({ presenting: true }), false);
  assert.equal(shouldResizeXrUiCanvas({ width: 720, height: 640 }, 720, 640), false);
  assert.equal(shouldResizeXrUiCanvas({ width: 64, height: 64 }, 720, 640), true);
  assert.equal(shouldRunCadHeavyXrViewTool({ presenting: true, toolId: "explode" }), false);
  assert.equal(xrViewToolIsCadHeavy("fit"), false);
  const forbidden = xrMenuOpenForbiddenWork({ presenting: true });
  assert.equal(forbidden.applyCadStyle, false);
  assert.equal(forbidden.stripCadExtras, false);
  assert.equal(forbidden.openProject, false);
  assert.equal(forbidden.extraWebgl, false);
  assert.equal(forbidden.envDataUrls, false);
  assert.equal(forbidden.webglCapture, false);

  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  const toggleFn = xr.slice(xr.indexOf("function toggleGridPopup"), xr.indexOf("function paintGuidesOntoPanel"));
  assert.ok(toggleFn.includes("deferHudOpenIfNeeded"));
  assert.ok(xr.includes("scheduleXrHudOffSelectTick"));
  assert.ok(toggleFn.includes("forcePlace: false"));
  assert.ok(toggleFn.includes("keepPose: true"));
  assert.equal(toggleFn.includes("forcePlace: !locked"), false);
  assert.equal(toggleFn.includes("applyCadStyle"), false);
  assert.equal(toggleFn.includes("openProject"), false);
  assert.equal(toggleFn.includes('getContext("webgl'), false);
  const sched = xr.slice(xr.indexOf("function scheduleXrHudOffSelectTick"), xr.indexOf("function deferHudOpenIfNeeded"));
  assert.ok(sched.includes("setTimeout"));
  assert.equal(sched.includes("window.requestAnimationFrame"), false);
  assert.equal(sched.includes("sess.requestAnimationFrame"), false);
  const openGrid = xr.slice(xr.indexOf("function openGridPopup"), xr.indexOf("function closeGridPopup"));
  assert.ok(openGrid.includes("existed"));
  assert.equal(openGrid.includes("applyCadStyle"), false);
  const toolsFn = xr.slice(xr.indexOf("function settingsToolsForTab"), xr.indexOf("function gridSpecTools"));
  assert.ok(toolsFn.includes("loadXrEnvironmentListForMenu"));
  assert.ok(toolsFn.includes("shouldParseEnvironmentDataUrlsOnXrMenuOpen"));
  assert.equal(toolsFn.includes("applyCadStyle"), false);
  const setTool = xr.slice(xr.indexOf("function setTool"), xr.indexOf("function runHostTool"));
  assert.ok(setTool.includes('toggleGridPopup("settings")'));
  assert.ok(setTool.includes('toggleGridPopup("tools")'));
  assert.ok(setTool.includes('toggleGridPopup("social")'));
  assert.ok(setTool.includes("xrViewToolIsCadHeavy"));
  assert.equal(setTool.includes("applyCadStyle"), false);
  assert.equal(setTool.includes("stripCadExtras"), false);
  assert.equal(setTool.includes("openProjectById"), false);
  assert.equal(setTool.includes('getContext("webgl'), false);
  assert.ok(xr.includes("shouldLetXrSelectReachDomTarget"));
  assert.ok(xr.includes("installXrDomGuards"));
  assert.ok(xr.includes("shouldParseXrEnvironmentStoreOnSelectTick"));
  assert.ok(xr.includes("loadXrEnvironmentListForMenu"));
  assert.ok(xr.includes("shouldUseLiteXrPanelChrome"));
  assert.ok(xr.includes("fitXrUiCanvas"));
  assert.ok(xr.includes("xrViewToolIsCadHeavy"));
  assert.ok(xr.includes("shouldCaptureWebglFramebufferOnXrMenu"));
  assert.ok(app.includes("shouldOpenDesktopPreferencesWhilePresenting"));
  assert.ok(app.includes("shouldCaptureWebglFramebufferOnXrMenu"));
  assert.ok(app.includes("shouldRunCadHeavyXrViewTool"));
  assert.ok(app.includes("function openPreferencesModal"));
  assert.ok(html.includes('id="btn-preferences-menu"'));
  assert.ok(css.includes("body.xr-presenting #profile-preferences-panel"));
});

test("Settings Windows tab: in-scene panels default off, no CAD restyle on create", () => {
  assert.ok(SETTINGS_PANEL_TAB_IDS.includes("windows"));
  assert.ok(SETTINGS_PANEL_TAB_IDS.includes("robotics"));
  assert.deepEqual(SETTINGS_PANEL_TAB_IDS, ["controller", "controls", "environment", "windows", "robotics", "developer"]);
  assert.equal(SETTINGS_PANEL_TAB_LABELS.controls, "VR");
  const rob = roboticsSettingsLines({
    viserUrl: "http://192.168.1.77:8095/",
    teleopUrl: "https://192.168.1.77:8443/teleop",
    cameraHost: "192.168.1.83",
  });
  assert.equal(rob[0].id, "rob_viser");
  assert.match(rob[0].label, /192\.168\.1\.77:8095/);
  assert.equal(rob[1].id, "rob_teleop");
  assert.match(rob[1].label, /8443\/teleop/);
  assert.equal(rob[2].id, "rob_cam");
  assert.equal(rob[3].id, "rob_server");
  assert.equal(typeof readRoboticsHudPrefs, "function");
  assert.equal(typeof readRoboticsHudPrefs().viserUrl, "string");
  assert.equal(xrHudPanelNeedsDeferredPaint({ presenting: true, kind: "scene-browser", panelReady: false }), true);
  assert.equal(xrHudPanelNeedsDeferredPaint({ presenting: true, kind: "scene-display", panelReady: false }), true);
  assert.ok(XR_LAZY_HUD_PANEL_KINDS.includes("scene-browser"));
  assert.ok(XR_LAZY_HUD_PANEL_KINDS.includes("scene-display"));
  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  assert.equal(SETTINGS_PANEL_TAB_LABELS.windows, "Win");
  assert.ok(xr.includes("handleWindowsSettingsAction"));
  assert.ok(xr.includes("toggleXrSceneWindow"));
  assert.ok(xr.includes("Cannot embed Meta Browser") || xr.includes("XR_SCENE_WIN_OS_LIMIT"));
  const createFn = xr.slice(xr.indexOf("function handleWindowsSettingsAction"), xr.indexOf("function handleGridAction"));
  assert.equal(createFn.includes("applyCadStyle"), false);
  const tog = xr.slice(xr.indexOf("function toggleXrSceneWindow"), xr.indexOf("function beginSceneWindowResize"));
  assert.equal(tog.includes("applyCadStyle"), false);
  assert.ok(tog.includes("deferHudOpenIfNeeded"));
  const show = xr.slice(xr.indexOf("function showXrSceneWindow"), xr.indexOf("function hideXrSceneWindow"));
  assert.equal(show.includes("applyCadStyle"), false);
  assert.ok(show.includes("scheduleXrHudOffSelectTick") || show.includes("shouldPaintXrHudPanelOnSelectTick"));
  assert.ok(xr.includes("pickXrSceneWindowHit"));
  assert.ok(xr.includes("isXrSceneWindowHitKind"));
  assert.ok(html.includes("xrwin1"));
  assert.ok(app.includes("xrwin1"));
});

test("environment menu listing drops equirect dataUrls", () => {
  const env = readFileSync(join(here, "xr-environments.js"), "utf8");
  assert.ok(env.includes("export function environmentStoreMetaRows"));
  assert.ok(env.includes("export function loadXrEnvironmentListForMenu"));
  assert.ok(env.includes("shouldParseEnvironmentDataUrlsOnXrMenuOpen"));
  assert.ok(env.includes("XR_ENV_META_KEY"));
  assert.ok(env.includes('dataUrl: ""'));
});

test("VR lasers show only when aiming at UI or world hits", () => {
  assert.equal(laserVisibleForHit(null), false);
  assert.equal(laserVisibleForHit(undefined), false);
  assert.equal(laserVisibleForHit({}), false);
  assert.equal(laserVisibleForHit({ kind: "" }), false);
  assert.equal(laserVisibleForHit({ kind: "menu-tab" }), true);
  assert.equal(laserVisibleForHit({ kind: "ai-action" }), true);
  assert.equal(laserVisibleForHit({ kind: "grid-action" }), true);
  assert.equal(laserVisibleForHit({ kind: "tool" }), true);
  assert.equal(laserVisibleForHit({ kind: "mesh", distance: 0.4 }), true);
  assert.equal(laserVisibleForHit({ kind: "board" }), true);
  assert.equal(laserVisibleForHit({ kind: "edge" }), true);
  assert.equal(laserLengthM(null), 0);
  assert.equal(laserLengthM({}), 0);
  assert.equal(laserLengthM({ kind: "mesh", distance: 0.42 }), 0.42);
  assert.equal(laserLengthM({ kind: "mesh", distance: 12 }), XR_LASER_MAX_M);
  assert.equal(laserLengthM({ kind: "mesh", distance: 0.01 }), XR_LASER_MIN_M);
  assert.equal(laserLengthM({ kind: "menu-chrome" }), XR_LASER_FALLBACK_M);
  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.ok(xr.includes("laserVisibleForHit"));
  assert.ok(xr.includes("laserLengthM"));
  assert.equal(xr.includes("Always show pointer rays"), false);
  assert.equal(xr.includes("HAND_RAY_MAX_M"), false);
  const rays = xr.slice(xr.indexOf("function updateControllerRays"), xr.indexOf("function updateWristMenu"));
  assert.ok(rays.includes("xrPointerStyle"));
  assert.ok(rays.includes("xrPointerStyle"));
  assert.ok(rays.includes("pickControllerSelectHit"));
  assert.ok(rays.includes("style.visible"));
  assert.ok(rays.includes("preferUiHoverHit"));
  assert.ok(rays.includes("paintWorldUiHover"));
  assert.equal(rays.includes("if (!controller?.visible) continue"), false);
  const hands = xr.slice(xr.indexOf("function updateHandRays"), xr.indexOf("function attachDockHeadLocked"));
  assert.ok(hands.includes("xrPointerStyle"));
  assert.ok(hands.includes("uiOnly: false"));
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.match(html, /app\.js\?v=[^"\s]*20260908-/);
  assert.equal(shouldSkipWorldUiPick({ drawing: true, tool: "draw" }), true);
});

test("pose sends stay throttled and omit held mesh unless grabbing", () => {
  assert.equal(shouldSendXrPose(40), false);
  assert.equal(shouldSendXrPose(90), true);
  assert.equal(shouldIncludeHeldPose(false), false);
  assert.equal(shouldIncludeHeldPose(true), true);
});

test("remote pose lerps between 90ms samples and extrapolates a short way", () => {
  const track = makePoseTrack();
  ingestPosePart(track, { p: [0, 1.6, 0], q: [0, 0, 0, 1] }, 0);
  ingestPosePart(track, { p: [0.9, 1.6, 0], q: [0, 0, 0, 1] }, 90);
  assert.equal(poseSampleAlpha(0, 90, 45), 0.5);
  const mid = samplePoseTrack(track, 45, [0, 0, 0], [0, 0, 0, 1]);
  assert.ok(Math.abs(mid.p[0] - 0.45) < 1e-6, `mid x ${mid.p[0]}`);
  assert.equal(mid.p[1], 1.6);
  const later = samplePoseTrack(track, 135, [0, 0, 0], [0, 0, 0, 1]);
  assert.ok(later.p[0] > 0.9 && later.p[0] < 1.4, `extrapolate x ${later.p[0]}`);
  const capped = samplePoseTrack(track, 400, [0, 0, 0], [0, 0, 0, 1]);
  assert.ok(capped.p[0] <= 0.9 + (0.9 * 120) / 90 + 1e-6, `cap x ${capped.p[0]}`);
  const jump = makePoseTrack();
  ingestPosePart(jump, { p: [0, 0, 0] }, 0);
  ingestPosePart(jump, { p: [8, 0, 0] }, 90);
  const snapped = samplePoseTrack(jump, 45, [0, 0, 0], [0, 0, 0, 1]);
  assert.equal(snapped.snapped, true);
  assert.equal(snapped.p[0], 8);
});

test("mute zeros spatial gain; listener looks down local -Z", () => {
  assert.equal(peerVoiceOutputGain(true, 1), 0);
  assert.equal(peerVoiceOutputGain(true, 0.8), 0);
  assert.equal(peerVoiceOutputGain(false, 0.5), 0.5);
  const ident = listenerAxesFromQuat({ x: 0, y: 0, z: 0, w: 1 });
  assert.ok(Math.abs(ident.fz + 1) < 1e-6, `identity forward z ${ident.fz}`);
  assert.ok(Math.abs(ident.uy - 1) < 1e-6);
});

test("PC viewer opens the folder-qualified capture path, not a basename 404", () => {
  assert.equal(
    resolveXrCaptureFileRel("/api/projects/p1/files/Screenshots%2Fquest-shot.png", "quest-shot.png"),
    "Screenshots/quest-shot.png",
  );
  assert.equal(resolveXrCaptureFileRel("", "shot.png"), "shot.png");
});

test("screenshot and record live on a capture crescent, not a vertical strip", () => {
  assert.equal(captureDockVisible({ presenting: true }), false);
  assert.equal(captureDockVisible({ presenting: true, sessionEnded: false }), false);
  assert.equal(captureDockVisible({ presenting: false, sessionEnded: true }), false);
  assert.equal(captureDockVisible({ presenting: false }), false);
  const here = dirname(fileURLToPath(import.meta.url));
  const rail = readFileSync(join(here, "xr-hand-palette.js"), "utf8");
  for (const id of WRIST_RAIL_TOOL_IDS) {
    assert.ok(
      rail.includes(`${id}:`) || rail.includes(`"${id}"`) || rail.includes(`WRIST_RAIL_TOOL_IDS`),
      `missing wrist rail tool ${id}`,
    );
  }
  assert.ok(rail.includes("WRIST_RAIL_TOOL_IDS"));
  assert.ok(rail.includes("voice_toggle"));
  assert.ok(rail.includes("0x22c55e") && rail.includes("0xef4444"));
  for (const id of ["screenshot", "record", "stream", "stream_live", "stream_cast_meta", "stream_cast_apple", "record_pause", "record_stop", "shot_send_pc", "shot_share_x"]) {
    assert.ok(rail.includes(`['${id}'`) || rail.includes(`"${id}"`), `missing capture tool ${id}`);
  }
  const hotPath = readFileSync(join(here, "xr-hot-path.js"), "utf8");
  assert.ok(hotPath.includes("Cast with Meta"));
  assert.ok(hotPath.includes("stream_pick"));
  assert.deepEqual(crescentCaptureToolIds({ open: true }), ["screenshot", "record", "stream"]);
  assert.deepEqual(crescentCaptureToolIds({ open: true, recording: true }), ["record_pause", "record_stop"]);
  assert.deepEqual(
    crescentCaptureToolIds({ open: true, clipReady: true }),
    ["shot_send_pc", "shot_share_x", "screenshot"],
  );
  assert.deepEqual(crescentCaptureToolIds({ open: false, recording: true }), ["record_pause", "record_stop"]);
  assert.deepEqual(crescentCaptureToolIds({ open: false, clipReady: true }), []);
  assert.equal(formatXrRecordingClock(125000), "● 2:05");
  assert.equal(formatXrRecordingClock(5000, { paused: true }), "❚❚ 0:05");
  assert.equal(xrCaptureSendAction({ hasLastCapture: true, toolId: "shot_send_pc" }), "send_last");
  assert.equal(xrCaptureSendAction({ hasLastCapture: false, toolId: "shot_send_pc" }), "capture");
  assert.equal(xrCaptureSendAction({ hasLastCapture: true, toolId: "screenshot" }), "capture");
  assert.ok(rail.includes("['shot_send_pc'") || rail.includes('"shot_send_pc"'));
  assert.ok(rail.includes("['shot_share_x'") || rail.includes('"shot_share_x"'));
  assert.ok(rail.includes("clipReady"));
  assert.deepEqual(crescentCaptureToolIds({ open: true, kind: "stream" }), ["stream_x_live", "stream_twitch", "stream_kick"]);
  assert.deepEqual(
    crescentCaptureToolIds({ open: true, kind: "stream_pick", castFamily: "meta" }),
    ["stream_live", "stream_cast_meta"],
  );
  assert.deepEqual(
    crescentCaptureToolIds({ open: true, kind: "stream_pick", castFamily: "apple" }),
    ["stream_live", "stream_cast_apple"],
  );
  const offs = crescentMoonOffsets(3);
  assert.equal(offs.length, 3);
  assert.ok(Math.abs(offs[0].x) > 0.01, "crescent sits beside the puck");
  const workspace = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(workspace.includes('id: "ws-save"'));
  assert.ok(workspace.includes('id: "ws-save-new"'));
  assert.ok(workspace.includes('id: "ws-invite-yes"'));
  assert.ok(workspace.includes("openSharedVideo"));
  assert.ok(workspace.includes("applyXrClipViewerMaterialFlags"));
  assert.ok(workspace.includes("generateMipmaps = false"));
  assert.ok(workspace.includes("restoreStarterControls"));
  assert.ok(workspace.includes("shouldResetStarterOnBHold"));
  const clipFn = workspace.slice(workspace.indexOf("function openSharedVideo"), workspace.indexOf("function pickSharedVideo"));
  assert.equal(clipFn.includes("markWorldUi(group)"), false);
  assert.ok(clipFn.includes("new THREE.Texture(img)"));
  assert.ok(clipFn.includes("new THREE.VideoTexture(video)"));
  assert.ok(workspace.includes('id: "group_select"'));
  assert.ok(workspace.includes("sampleGroupSelect"));
  const wheel = readFileSync(join(here, "xr-tool-wheel.js"), "utf8");
  assert.ok(wheel.includes('id: "group_select"'));
  assert.deepEqual(WRIST_RAIL_TOOL_IDS, ["passthrough", "voice_toggle", "capture", "share"]);
  const recOrder = Math.max(rail.indexOf("['record'"), rail.indexOf('id: "record"'));
  const capDef = Math.max(rail.indexOf("capture:"), rail.indexOf('id: "capture"'), rail.indexOf("'capture'"));
  assert.ok(capDef >= 0 && recOrder >= 0);
  assert.deepEqual(wristRailToolOrder(), ["passthrough", "voice_toggle", "capture", "share"]);
  assert.equal(captureIsCrescentNotStrip(), true);
  assert.equal(captureIsCrescentNotStrip(["screenshot", "record", "capture"]), false);
  const dockBlock = workspace.slice(workspace.indexOf("const DOCK_TOOLS"), workspace.indexOf("const DOCK_HIT"));
  for (const id of WRIST_MENU_GRID_IDS) {
    assert.ok(dockBlock.includes(`id: "${id}"`), `missing wrist menu ${id}`);
  }
  assert.equal(dockBlock.includes("guides"), false);
  assert.ok(workspace.includes("SETTINGS_PANEL_TAB_IDS") || workspace.includes("controller"));
  assert.ok(workspace.includes("dev_mode"));
});

test("developer mode flag and debugger log filename", () => {
  assert.equal(developerModeEnabled(true), true);
  assert.equal(developerModeEnabled("1"), true);
  assert.equal(developerModeEnabled("0"), false);
  assert.equal(developerModeEnabled(false), false);
  assert.deepEqual(SETTINGS_PANEL_TAB_IDS, ["controller", "controls", "environment", "windows", "robotics", "developer"]);
  assert.equal(SETTINGS_PANEL_TAB_LABELS.controls, "VR");
  assert.equal(
    xrDebuggerLogFilename(new Date(Date.UTC(2026, 8, 8, 12, 34))),
    "20260908-1234-xr-perf.jsonl",
  );
});

test("Stream picker offers Cast with Meta or AirPlay from headset UA", async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  assert.equal(detectHeadsetCastFamily({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64; Quest 3) OculusBrowser/36.0",
  }), "meta");
  assert.equal(detectHeadsetCastFamily({
    userAgent: "Mozilla/5.0 (Linux; Android 10) MetaBrowser/1.0",
  }), "meta");
  assert.equal(detectHeadsetCastFamily({
    userAgent: "Mozilla/5.0 Chrome/120",
    locationHref: "https://studio.xr.quest/",
  }), "meta");
  assert.equal(detectHeadsetCastFamily({
    userAgent: "Mozilla/5.0 (Macintosh) RealityApp apple-visor",
  }), "apple");
  assert.equal(detectHeadsetCastFamily({
    userAgent: "Mozilla/5.0 AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Vision Safari",
  }), "apple");
  assert.equal(detectHeadsetCastFamily({ userAgent: "AppleWebKit VisionOS" }), "apple");
  assert.equal(detectHeadsetCastFamily({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    matchMedia: (q) => ({ matches: String(q).includes("xr-spatial") }),
  }), "apple");
  assert.equal(detectHeadsetCastFamily({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
  }), "none");
  assert.equal(detectHeadsetCastFamily({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0",
  }), "none");
  assert.equal(detectHeadsetCastFamily({
    userAgent: "OculusBrowser Quest 3",
    profiles: ["apple-visor"],
  }), "ambiguous");
  assert.equal(shouldOpenStreamCastPicker("none"), false);
  assert.equal(shouldOpenStreamCastPicker("meta"), true);
  assert.equal(shouldOpenStreamCastPicker("apple"), true);
  assert.deepEqual(streamCastPickerToolIds("meta"), ["stream_live", "stream_cast_meta"]);
  assert.deepEqual(streamCastPickerToolIds("apple"), ["stream_live", "stream_cast_apple"]);
  assert.deepEqual(streamCastPickerToolIds("none"), []);
  assert.match(streamCastFooterHint("meta"), /Cast with Meta/);
  assert.match(headsetCastHudCopy("meta"), /no web JS API/i);
  assert.match(headsetCastHudCopy("apple"), /Control Center/);
  assert.equal(headsetCastOpenUrl("meta", { presenting: true, userAgent: "OculusBrowser" }), META_CAST_HELP_URL);
  assert.equal(headsetCastOpenUrl("meta", { presenting: false, userAgent: "Chrome" }), META_CAST_RECEIVER_URL);
  assert.equal(headsetCastOpenUrl("apple"), "");

  const opened = [];
  let presentationStarted = false;
  let displayCalled = false;
  const PresentationRequestCtor = class {
    constructor() {}
    start() { presentationStarted = true; return Promise.resolve(); }
  };
  const meta = await startHeadsetCastSession({
    family: "meta",
    href: "https://render3d.app/",
    userAgent: "OculusBrowser Quest 3",
    presenting: true,
    PresentationRequestCtor,
    getDisplayMedia: async () => { displayCalled = true; return { getTracks: () => [] }; },
    openUrl: (url) => { opened.push(url); return { ok: true }; },
    skipDisplayMedia: true,
  });
  assert.equal(meta.nativeCastApi, false);
  assert.equal(meta.presentation, true);
  assert.equal(meta.displayMedia, false);
  assert.equal(displayCalled, false);
  assert.equal(presentationStarted, true);
  assert.ok(opened.includes(META_CAST_HELP_URL));

  const apple = await startHeadsetCastSession({
    family: "apple",
    href: "https://render3d.app/",
    userAgent: "AppleWebKit VisionOS",
    presenting: false,
    PresentationRequestCtor: null,
    skipDisplayMedia: true,
    skipOpen: true,
  });
  assert.equal(apple.nativeCastApi, false);
  assert.match(apple.copy, /AirPlay/);

  const src = readFileSync(join(here, "xr-hot-path.js"), "utf8");
  const startFn = src.slice(src.indexOf("export async function startHeadsetCastSession"), src.indexOf("export function formatXrRecordingClock"));
  assert.equal(startFn.includes("toDataURL"), false);
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(html.includes('data-capture-crescent="stream"'));
  assert.ok(html.includes('data-stream-cast-pick="meta"'));
  assert.ok(html.includes("Cast with Meta"));
  assert.ok(html.includes("AirPlay / SharePlay"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(app.includes("shouldOpenStreamCastPicker"));
  assert.ok(app.includes("openLaptopStreamStudio"));
  assert.ok(app.includes('kind === "stream"'));
  assert.ok(app.includes("showStreamCastPicker"));
  assert.ok(app.includes("startHeadsetCastSession"));
  const streamAct = app.slice(app.indexOf("async function handleXrStreamAction"), app.indexOf("function openLaptopStreamStudio"));
  assert.equal(streamAct.includes("toDataURL"), false);
  assert.ok(streamAct.includes("nativeCastApi: false"));
  assert.ok(xr.includes('setCrescentKind?.("stream_pick"'));
  assert.ok(xr.includes("stream_cast_meta"));
  assert.ok(app.includes("rtrig2"));
});

test("authorized apps list X Live Twitch Kick stream providers", () => {
  assert.deepEqual(authorizedAppStreamProviderIds(), ["x_live", "twitch", "kick"]);
  const rows = authorizedAppStreamProviders({ twitch: { connected: true, handle: "ada" } });
  assert.equal(rows.length, 3);
  assert.equal(rows.find((p) => p.id === "twitch").connected, true);
  const keys = studioLinesForTab("keys", { streams: [{ id: "kick", connected: true, handle: "sam" }] });
  assert.ok(keys.lines.some((l) => l.id === "stream:kick"));
  const appJs = readFileSync(join(here, "../studio/app.js"), "utf8");
  const setup = readFileSync(join(here, "../studio/authorized-app-setup.js"), "utf8");
  assert.ok(setup.includes('row("github"') || setup.includes('key: "github"'));
  assert.ok(appJs.includes("/api/integrations/github/link-url"));
});

test("loading headset spotlight aims at the Render Studio wordmark", () => {
  const aim = headsetSpotlightTarget({ x: 0, y: 0.08, z: 0.42 }, { x: 0, y: -0.62, z: 0.05 });
  assert.ok(aim.dir.y < 0, "spotlight points down toward the logo");
  assert.ok(aim.distance > 0.5);
  const src = readFileSync(join(here, "../boot/boot-headset-scene.js"), "utf8");
  assert.ok(src.includes("SpotLight"));
  assert.ok(src.includes("bootQuestHeadset"));
  assert.ok(src.includes("flashlightFromRay"));
  assert.ok(src.includes("bootMetalGear"));
  assert.ok(src.includes("MeshStandardMaterial"));
  assert.ok(src.includes("bootGearElectricity"));
});

test("boot splash logo renderOrder is in front of the metal gear", () => {
  assert.equal(bootSplashLogoInFrontOfGear(), true);
  assert.ok(BOOT_SPLASH_RENDER_ORDER.logo > BOOT_SPLASH_RENDER_ORDER.gear);
  assert.ok(BOOT_SPLASH_RENDER_ORDER.electricity > BOOT_SPLASH_RENDER_ORDER.gear);
  assert.equal(bootSplashLogoInFrontOfGear(1, 10), false);
  const src = readFileSync(join(here, "../boot/boot-headset-scene.js"), "utf8");
  assert.ok(src.includes("BOOT_SPLASH_RENDER_ORDER.logo"));
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  assert.ok(css.includes(".studio-boot-vr-mark"));
  assert.match(css, /\.studio-boot-vr-mark[\s\S]{0,180}z-index:\s*5/);
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.ok(html.includes('id="studio-boot-logo-center"'));
});

test("boot layout class names place chrome word top-right and logo in the center", () => {
  assert.equal(BOOT_LAYOUT_CLASS_NAMES.chromeWord, "studio-boot-chrome-word");
  assert.equal(BOOT_LAYOUT_CLASS_NAMES.logoCenter, "studio-boot-logo-center");
  assert.equal(BOOT_LAYOUT_CLASS_NAMES.xrBtn, "studio-boot-xr-btn");
  const place = bootLogoPlacement();
  assert.equal(place.chromeWord, "top-right");
  assert.equal(place.mark, "center");
  assert.equal(place.headset, "behind-center");
  assert.equal(place.xrControls, "compact");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.ok(html.includes("studio-boot-chrome-word"));
  assert.ok(html.includes("studio-boot-logo-center"));
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  assert.ok(css.includes(".studio-boot-logo-center"));
  assert.ok(css.includes(".studio-boot-chrome-word"));
});

test("logo easter-egg and planetary wrap are removed", () => {
  assert.equal(logoEasterEggShouldFire({ aiming: true, held: true, holdMs: 900 }), false);
  assert.equal(logoEasterEggShouldFire(), false);
  const scenes = workspaceEnvironmentLines({ sceneMenu: true, sceneId: "white" });
  assert.ok(scenes.some((l) => l.id === "ws-env:white"));
  assert.ok(scenes.some((l) => l.id === "ws-env:warehouse"));
  assert.equal(scenes.some((l) => l.id === "ws-env:planetary"), false);
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.equal(xr.includes("createXrPlanetaryRoom"), false);
  assert.equal(xr.includes("createLogoEggPlayer"), false);
  assert.equal(xr.includes("playLogoEasterEgg"), false);
  const boot = readFileSync(join(here, "../boot/boot-headset-scene.js"), "utf8");
  assert.equal(boot.includes("armLogoEggPending"), false);
  assert.equal(boot.includes("logoEasterEggShouldFire"), false);
  assert.ok(boot.includes("cssOnly"));
  const ray = flashlightFromRay({ x: 0, y: 1.4, z: 0 }, { x: 0, y: 0, z: -1 }, { distance: 2 });
  assert.equal(ray.target.z, -2);
});

test("environment wrap prompt is a WebVR equirect skybox, not a dense mesh", () => {
  const prompt = environmentWrapPrompt("sunset over an ocean");
  assert.match(prompt, /webvr/i);
  assert.match(prompt, /equirect/i);
  assert.match(prompt, /sunset over an ocean/i);
  assert.match(prompt, /skybox|wrap/i);
  assert.equal(isEnvironmentWrapIntent("make a skybox wrap", { armed: false }), true);
  assert.equal(isEnvironmentWrapIntent("a steel bracket", { armed: false }), false);
  assert.equal(isEnvironmentWrapIntent("a steel bracket", { armed: true }), true);
  assert.ok(GPT_IMAGE_MODEL_CANDIDATES.includes("gpt-image-2"));
  assert.ok(GPT_IMAGE_MODEL_CANDIDATES.includes("gpt-image-1"));
  const lines = workspaceEnvironmentLines({ sceneMenu: false });
  assert.ok(lines.some((l) => l.id === "ws-env-generate"));
  assert.ok(lines.some((l) => l.id === "ws-env-menu"));
  const scenes = workspaceEnvironmentLines({ sceneMenu: true, sceneId: "white" });
  assert.ok(scenes.some((l) => l.id === "ws-env:white"));
  assert.ok(scenes.some((l) => l.id === "ws-env:warehouse"));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(xr.includes("ws-env-generate"));
  assert.ok(xr.includes("applyEquirectWrap"));
  assert.ok(xr.includes("createXrCheapWarehouseStage"));
  assert.ok(xr.includes('raw === "warehouse"'));
  assert.equal(shouldApplyEnvironmentWrapNow({ userPickedScene: false }), false);
  assert.equal(shouldApplyEnvironmentWrapNow({ userPickedScene: true }), false);
  assert.equal(shouldApplyEnvironmentWrapNow({ userPickedScene: true, presenting: true }), true);
  assert.equal(shouldApplyEquirectWrapToCadViewport({ presenting: false }), false);
  assert.equal(shouldApplyEquirectWrapToCadViewport({ presenting: true }), false);
  assert.ok(xr.includes("applied: false"));
  assert.ok(xr.includes("stripWrapFromCadViewport"));
  assert.equal(xr.includes("createXrPlanetaryRoom"), false);
  const env = readFileSync(join(here, "xr-environments.js"), "utf8");
  const logoFn = env.slice(env.indexOf("export function createXrStudioLogo"));
  assert.match(logoFn.slice(0, 420), /group\.visible = false/);
});

test("Studio Stats History Access Keys are never empty placeholders", () => {
  assert.deepEqual(studioTabIds(), ["stats", "history", "access", "keys"]);
  const stats = studioLinesForTab("stats", {
    usage: {
      queries: 4,
      tokens: 1200,
      by_user: [
        { name: "Ada", queries: 3, tokens: 900 },
        { name: "Sam", queries: 1, tokens: 300 },
      ],
    },
  });
  assert.match(stats.lines[0].label, /4 queries/);
  assert.match(stats.lines[0].label, /1200 tokens/);
  assert.equal(stats.lines[1].label.startsWith("Ada"), true);
  const empty = studioLinesForTab("keys", {});
  assert.ok(empty.lines.length >= 1);
  assert.match(empty.lines.map((l) => l.label).join(" | "), /No shared keys|Connect ·|Live ready/);
});

test("studio History matches laptop: newest first, restore only timeline rows", () => {
  const lines = mapHistoryToStudioLines([
    { label: "Old prompt", kind: "prompt", created_at: "2026-09-01T10:00:00", restorable: true, timeline_index: 0, user_name: "Sam" },
    { label: "Moved folder", kind: "project_moved", created_at: "2026-09-07T18:00:00", user_name: "Sam" },
    { label: "New build", kind: "build", created_at: "2026-09-07T19:00:00", restorable: true, timeline_index: 3, user_name: "Ada" },
  ]);
  assert.equal(lines[0].label, "New build");
  assert.equal(lines[0].id, "hist:3");
  assert.match(lines[0].sub, /Timeline #4/);
  assert.equal(lines[1].id, "");
  assert.match(lines[1].sub, /Log only/);
});

test("VR permission rows skip owners and stay keyed for laptop checkboxes", () => {
  const rows = vrPermissionRows(
    [{ id: "share-1", team_id: "team-a", team_name: "Studio" }],
    {
      "share-1": [
        { user_id: "host", display_name: "Host", granted: true, is_owner: true },
        { user_id: "mate", display_name: "Mate", granted: false, is_owner: false },
      ],
    },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, "mate");
  assert.equal(rows[0].granted, false);
  assert.deepEqual(grantNotifyUserIds("host", "mate"), ["mate", "host"]);
  assert.deepEqual(grantNotifyUserIds("host", "host"), ["host"]);
});

test("voice ICE keeps existing Google STUN and restarts a failed PC", () => {
  const servers = xrIceServers();
  assert.equal(xrIceServersHaveStun(servers), true);
  assert.ok(servers.some((s) => String(s.urls).includes("stun.l.google.com")));
  assert.equal(xrIceServersHaveTurn(servers), false);
  const withTurn = xrIceServers([{ urls: "turn:existing.example:3478", username: "ops" }]);
  assert.equal(xrIceServersHaveTurn(withTurn), true);
  assert.deepEqual(iceRestartOfferOptions(), { offerToReceiveAudio: true, iceRestart: true });
  assert.equal(shouldRestartIce({ iceConnectionState: "connected" }), "");
  assert.equal(shouldRestartIce({ iceConnectionState: "failed", now: 5000 }), "restart");
  assert.equal(shouldRestartIce({ iceConnectionState: "failed", lastRestartAt: 4800, now: 5000 }), "");
  assert.equal(shouldRestartIce({ iceConnectionState: "failed", now: 5000, gpuBusy: true }), "");
  assert.equal(shouldRestartIce({ connectionState: "closed" }), "recreate");
  assert.equal(shouldRestartIce({ iceConnectionState: "failed", restartCount: 4, now: 20000 }), "recreate");
  assert.equal(shouldSendIceCandidate(null), true);
  assert.equal(shouldSendIceCandidate({ candidate: "a", sdpMid: "0" }), true);
  const fromApi = iceServersFromApiPayload({
    iceServers: [{ urls: "turn:ops.example:3478", username: "ops" }],
  });
  const merged = xrIceServers(fromApi);
  assert.equal(xrIceServersHaveStun(merged), true);
  assert.equal(xrIceServersHaveTurn(merged), true);
  assert.equal(iceServersFromApiPayload({}).length, 0);
  assert.equal(iceServersFromApiPayload({ ice_servers: [{ urls: "stun:stun.l.google.com:19302" }] }).length, 1);
  assert.equal(iceServersFromApiPayload(null).length, 0);
  const authed = xrIceFetchInit("tok-1");
  assert.equal(authed.credentials, "same-origin");
  assert.equal(authed.headers.Authorization, "Bearer tok-1");
  assert.equal(xrIceFetchInit("").headers.Authorization, undefined);
  const xrSrc = readFileSync(join(here, "xr-voice.js"), "utf8");
  assert.ok(xrSrc.includes("xrIceFetchInit"));
  assert.ok(xrSrc.includes("getToken"));
});

test("public and project rooms relay the same XR voice/draw types", () => {
  assert.ok(xrRelayTypes().includes("rtc.signal"));
  assert.ok(xrRelayTypes().includes("xr.stroke"));
  assert.ok(xrRelayTypes().includes("xr.drop"));
  assert.ok(xrRelayTypes().includes("xr.object"));
  assert.ok(xrRelayTypes().includes("xr.printer"));
  assert.ok(xrRelayTypes().includes("xr.draw"));
  assert.ok(xrRelayTypes().includes("xr.video"));
  assert.ok(xrRelayTypes().includes("xr.fit"));
  assert.ok(xrRelayTypes().includes("xr.board"));
  assert.ok(xrRelayTypes().includes("xr.table"));
  const collab = readFileSync(join(here, "../social/collab.js"), "utf8");
  assert.ok(collab.includes("onXrPublicObject"));
  for (const t of ["xr.video", "xr.board", "xr.table", "xr.seat", "xr.drop", "xr.object"]) {
    assert.ok(collab.includes(`msg.type === "${t}"`), `collab must dispatch ${t}`);
  }
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  assert.ok(app.includes("onXrPublicObject"));
  assert.ok(app.includes("applyPublicDrop"));
});

test("stroke downsample caps network/geometry size but keeps ends", () => {
  const pts = Array.from({ length: 80 }, (_, i) => [i, 0, 0]);
  const slim = downsampleStrokePoints(pts, 16);
  assert.ok(slim.length <= 17);
  assert.deepEqual(slim[0], [0, 0, 0]);
  assert.deepEqual(slim[slim.length - 1], [79, 0, 0]);
});

test("live draw never rebuilds TubeGeometry and caps stay finite", () => {
  assert.equal(shouldRebuildTubeWhileDrawing(), false);
  assert.ok(XR_LIVE_STROKE_MAX_POINTS <= 64);
  assert.ok(XR_COMMIT_STROKE_MAX_POINTS <= 24);
  assert.ok(XR_NETWORK_STROKE_MAX_POINTS <= 32);
  const fat = Array.from({ length: 200 }, (_, i) => [i, 0, 0]);
  assert.ok(downsampleStrokePoints(fat, XR_COMMIT_STROKE_MAX_POINTS).length <= XR_COMMIT_STROKE_MAX_POINTS + 1);
});

test("live ink reuses a pool — no new cylinder mesh per sample", () => {
  assert.equal(shouldAllocateLiveInkCylinderPerAppend(), false);
  assert.ok(liveInkPoolCapacity() >= XR_LIVE_STROKE_MAX_POINTS);
  assert.equal(liveInkInstanceFromSegment(0, 0, 0, 0, 0, 0, 0.01), null);
  const pose = liveInkInstanceFromSegment(0, 0, 0, 0.1, 0, 0, 0.009);
  assert.ok(pose);
  assert.equal(pose.px, 0.05);
  assert.equal(pose.py, 0);
  assert.equal(pose.pz, 0);
  assert.equal(pose.sx, 0.009);
  assert.ok(Math.abs(pose.sy - 0.1) < 1e-9);
  const src = readFileSync(join(here, "xr-voice-draw.js"), "utf8");
  assert.equal(src.includes("new THREE.TubeGeometry"), false);
  assert.ok(src.includes("InstancedMesh"));
  assert.ok(XR_MAX_STROKES <= 16);
  assert.ok(XR_MAX_REMOTE_STROKES <= 8);
  assert.ok(src.includes("liveInkInstanceFromSegment"));
  assert.ok(src.includes("writeInkInstance"));
  assert.equal(/append[\s\S]*new THREE\.CylinderGeometry/.test(src), false);
});

test("grant notify always includes the laptop owner so Connect VR permissions can refresh", () => {
  const ids = grantNotifyUserIds("owner-1", "quest-2");
  assert.ok(ids.includes("owner-1"));
  assert.ok(ids.includes("quest-2"));
  assert.equal(ids.length, 2);
});

test("explorer canvas and extra fill lights stay off while drawing or grabbing", () => {
  assert.equal(shouldRebuildExplorerWhileBusy({ drawing: true }), false);
  assert.equal(shouldRebuildExplorerWhileBusy({ grabbing: true }), false);
  assert.equal(shouldRebuildExplorerWhileBusy({}), true);
  assert.equal(xrFillLightsEnabled({ drawing: true }), false);
  assert.equal(xrFillLightsEnabled({ grabbing: false, drawing: false }), false);
  assert.equal(xrFillLightsEnabled({ enterSettled: true }), false);
  assert.equal(shouldRebuildExplorerWhileBusy({ enterSettled: false }), false);
  assert.equal(shouldRebuildExplorerWhileBusy({ presenting: true }), false);
  assert.equal(shouldRebuildExplorerWhileBusy({ presenting: true, menuVisible: true }), true);
  assert.equal(shouldTraverseSceneChrome({ drawing: true }), false);
  assert.equal(shouldTraverseSceneChrome({ grabbing: true }), false);
  assert.equal(shouldTraverseSceneChrome({ creating: true }), false);
  assert.equal(shouldTraverseSceneChrome({ solidDraw: true }), false);
  assert.equal(shouldTraverseSceneChrome({ combining: true }), false);
  assert.equal(shouldTraverseSceneChrome({}), false);
  assert.ok(XR_SCENE_CHROME_CULL_FRAMES >= 8 && XR_SCENE_CHROME_CULL_FRAMES <= 15);
  assert.equal(shouldTraverseSceneChrome({ frame: 5, lastTraverseFrame: 0 }), false);
  assert.equal(shouldTraverseSceneChrome({ frame: XR_SCENE_CHROME_CULL_FRAMES, lastTraverseFrame: 0 }), false);
  assert.equal(shouldTraverseSceneChrome({ frame: 3, lastTraverseFrame: 0, dirty: true }), true);
  assert.equal(shouldTraverseSceneChrome({ frame: 3, lastTraverseFrame: 0, force: true }), true);
  assert.equal(shouldTraverseSceneChrome({ drawing: true, dirty: true, frame: 99, lastTraverseFrame: 0 }), false);
  assert.equal(shouldTraverseSceneChrome({ grabbing: true, frame: 99, lastTraverseFrame: 0 }), false);
  assert.equal(shouldTraverseSceneChrome({ worldAnchored: true, frame: 99, lastTraverseFrame: 0 }), false);
  assert.equal(shouldTraverseSceneChrome({ enterSettled: false, dirty: true }), false);
  assert.equal(shouldTraverseSceneChrome({ enterSettled: false, force: true }), true);
  const here = dirname(fileURLToPath(import.meta.url));
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(app.includes("shouldTraverseSceneChrome"));
  assert.ok(xr.includes("lastTraverseFrame"));
  assert.ok(xr.includes("xrChromeDirty"));
  assert.ok(xr.includes("isInteractionBusy"));
  assert.equal(shouldSkipCadChromeTraverse({ skipByLayer: true }), true);
  assert.equal(shouldSkipCadChromeTraverse({ skipByLayer: false }), false);
  assert.equal(isDesktopSceneChrome({ userData: { xrDesktopChrome: true } }), true);
  assert.equal(isDesktopSceneChrome({ userData: {}, isMesh: true, name: "cad-part" }), false);
  assert.ok(app.includes("shouldSkipCadChromeTraverse"));
  assert.ok(xr.includes("skipByLayer"));
});

test("nametag hit plane stays large enough to click in headset", () => {
  const hit = nametagHitSize();
  assert.ok(hit.w >= 0.7);
  assert.ok(hit.h >= 0.2);
  assert.ok(hit.d >= 0.06);
});

test("nametag selection remains available alongside exact wrist button picking", () => {
  const hits = [
    { distance: 0.11, object: { userData: { xrTool: "screenshot" } } },
    { distance: 1.35, object: { userData: { xrNametag: true, xrUserId: "peer-9" } } },
  ];
  const tag = nametagPickFromHits(hits);
  assert.equal(tag.kind, "nametag");
  assert.equal(tag.userId, "peer-9");
  assert.equal(nametagBeatsDock(tag, { kind: "tool", tool: "screenshot", distance: 0.11 }), true);
  assert.equal(nametagBeatsDock(tag, { kind: "menu-chrome", source: "wrist", distance: 0.08 }), true);
  assert.equal(nametagBeatsDock(null, { kind: "tool", tool: "screenshot" }), false);
  const xrSrc = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const pickFn = xrSrc.slice(xrSrc.indexOf("function pickWithController"), xrSrc.indexOf("function pickDrawablesAabb"));
  assert.ok(pickFn.includes("pickWristUi"));
  assert.ok(pickFn.includes("xrPresence.pickNametag"));
  const clipAt = pickFn.indexOf("pickSharedVideo");
  const clipTag = pickFn.indexOf("nametagBeatsDock(tag, mapped)", clipAt);
  assert.ok(clipAt >= 0 && clipTag > clipAt, "clip overlay must not steal nametag picks");
  const person = resolveNametagPerson("peer-9", { users: [], avatarName: "Ada" });
  assert.equal(person.isSelf, false);
  assert.equal(person.display_name, "Ada");
});

test("remote stroke flood evicts remotes first and stays under caps", () => {
  const local = Array.from({ length: 8 }, (_, i) => ({ id: `l${i}`, remote: false }));
  const remotes = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, remote: true }));
  const full = [...local, ...remotes];
  assert.equal(full.length, XR_MAX_STROKES);
  const dropRemote = nextStrokeEvictIndex(full, true);
  assert.equal(full[dropRemote].remote, true);
  const dropLocalAdd = nextStrokeEvictIndex(full, false);
  assert.equal(full[dropLocalAdd].remote, true);
  const onlyLocal = [...local];
  assert.equal(nextStrokeEvictIndex(onlyLocal, true), -1);
  const manyRemote = remotes;
  assert.ok(nextStrokeEvictIndex(manyRemote, true) >= 0);
  assert.ok(XR_MAX_REMOTE_STROKES <= 8);
});

test("grant WS refreshes Connect VR permissions and Studio Keys for granter and target", () => {
  const ids = grantNotifyUserIds("granter", "target");
  assert.deepEqual(ids, ["target", "granter"]);
  const msg = { type: "ai.keys.changed", reason: "chatgpt_granted" };
  assert.equal(shouldRefreshPermissionSurfaces(msg), true);
  assert.equal(shouldRefreshPermissionSurfaces({ type: "ai.keys.changed", reason: "other" }), false);
  assert.deepEqual(permissionRefreshSurfaces(), ["connect-vr-permissions", "studio-keys"]);
});

test("still poses do not need another network send", () => {
  const a = poseSignature({ head: { p: [1, 1.6, 0] }, left: { p: [0, 1, 0] }, right: { p: [0.2, 1, 0] } });
  const b = poseSignature({ head: { p: [1.001, 1.6, 0] }, left: { p: [0, 1, 0] }, right: { p: [0.2, 1, 0] } });
  const c = poseSignature({ head: { p: [1.2, 1.6, 0] }, left: { p: [0, 1, 0] }, right: { p: [0.2, 1, 0] } });
  assert.equal(poseMoved(a, b), false);
  assert.equal(poseMoved(a, c), true);
});

test("overlay relayer never runs every XR frame", () => {
  assert.equal(shouldRelayerOverlays({ frame: 90, lastRelayerFrame: 0 }), false);
  assert.equal(shouldRelayerOverlays({ frame: 3, lastRelayerFrame: 0 }), false);
  assert.equal(shouldRelayerOverlays({ poseChanged: true }), false);
  assert.equal(shouldRelayerOverlays({ panelMoved: true }), false);
  assert.equal(shouldRelayerOverlays({ dirty: true }), false);
  assert.equal(shouldRelayerOverlays({ force: true }), true);
  assert.equal(shouldRelayerOverlays({ panelSetChanged: true }), true);
  assert.equal(shouldRelayerOverlays({ presenting: false, force: true }), false);
  const mat = { transparent: true, depthTest: false, depthWrite: false, needsUpdate: false };
  assert.equal(applyOverlayMaterialFlags(mat), false);
  assert.equal(mat.needsUpdate, false);
  mat.depthTest = true;
  assert.equal(applyOverlayMaterialFlags(mat), true);
  assert.equal(mat.depthTest, false);
  assert.equal(mat.needsUpdate, true);
  const world = { transparent: true, depthTest: false, depthWrite: false, needsUpdate: false };
  assert.equal(applyWorldUiMaterialFlags(world), true);
  assert.equal(world.transparent, false);
  assert.equal(world.depthTest, true);
  assert.equal(world.depthWrite, true);
  const pick = { transparent: true, depthTest: false, depthWrite: true, needsUpdate: false };
  assert.equal(applyWorldUiPickMaterialFlags(pick), true);
  assert.equal(pick.depthWrite, false);
  assert.equal(isXrWorldPickMesh({ userData: { xrAiHit: "mic" }, material: { opacity: 1 } }), true);
  assert.equal(isXrWorldPickMesh({ userData: {}, material: { opacity: 1 } }), false);
  assert.equal(shouldApplyOverlayRelayerFlags({ isMesh: true, renderOrder: 2040, userData: {} }), true);
  assert.equal(shouldApplyOverlayRelayerFlags({ isMesh: true, renderOrder: 2040, userData: { xrWorldDepth: true } }), false);
  assert.equal(shouldApplyOverlayRelayerFlags({ isMesh: true, renderOrder: 12080, userData: { xrClipViewer: true } }), false);
  assert.equal(shouldApplyOverlayRelayerFlags({ isMesh: true, renderOrder: 12080, userData: { xrSharedVideo: true } }), false);
  const clipMat = { transparent: true, depthTest: true, depthWrite: true, needsUpdate: false };
  assert.equal(applyXrClipViewerMaterialFlags(clipMat), true);
  assert.equal(clipMat.transparent, false);
  assert.equal(clipMat.depthTest, false);
  assert.equal(clipMat.depthWrite, false);
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.equal(/shouldRelayerOverlays\(\{\s*frame:/.test(xr), false);
  assert.ok(xr.includes("shouldStopOverlayTraverse"));
  assert.ok(xr.includes("if (xrEnvDirty && xrEnterWorkSettled()) applyXrEnvironment"));
  assert.ok(xr.includes("shouldHoverDrawablePick"));
  const presence = readFileSync(join(here, "xr-presence.js"), "utf8");
  assert.ok(presence.includes("tickAvatarBlink"));
  assert.ok(presence.includes("shouldTickAvatarBlink"));
  assert.ok(presence.includes("xrShared"));
});

test("headset clip viewer maps stills vs video and hold-B restores grab", () => {
  assert.equal(xrCaptureIsStillKind({ kind: "screenshot" }), true);
  assert.equal(xrCaptureIsStillKind({ kind: "video" }), false);
  assert.equal(xrCaptureIsStillKind({ filename: "clip.webm" }), false);
  assert.equal(xrCaptureIsStillKind({ filename: "shot.png" }), true);
  assert.equal(xrCaptureIsHeadsetMediaName("Screen Recordings/a.webm"), true);
  assert.equal(xrCaptureIsHeadsetMediaName("part.glb"), false);
  assert.ok(xrMediaUrlWithToken("/api/projects/x/files/a.webm", "tok").includes("token=tok"));
  assert.equal(xrMediaUrlWithToken("blob:http://local/1", "tok"), "blob:http://local/1");
  assert.equal(shouldResetStarterOnBHold({ heldMs: 100 }), false);
  assert.equal(shouldResetStarterOnBHold({ heldMs: XR_B_HOLD_RESET_MS }), true);
  assert.equal(shouldResetStarterOnBHold({ heldMs: 900, alreadyReset: true }), false);
  assert.equal(shouldDismissToolOnBPress({}), true);
  assert.equal(laserPointerModeOn({ bHeld: true }), true);
  assert.equal(laserPointerModeOn({ aimMode: true }), true);
  assert.equal(laserPointerModeOn({}), false);
  assert.equal(handheldToolHidesLaser("draw"), true);
  assert.equal(handheldToolHidesLaser("grab"), false);
  assert.equal(XR_STARTER_TOOL_ID, "grab");
  assert.equal(pickXrRecordMimeType((t) => t.includes("vp8")), "video/webm;codecs=vp8,opus");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  assert.match(html, /app\.js\?v=[^"\s]*20260908-/);
  assert.ok(css.includes("body.xr-presenting #viewport"));
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  assert.ok(app.includes("playXrCaptureInHeadset"));
});

test("XR chrome side effects skip on throttled frames", () => {
  assert.equal(shouldRunXrChromeSideEffects({ skipTraverse: true }), false);
  assert.equal(shouldRunXrChromeSideEffects({ skipTraverse: false }), true);
  assert.equal(shouldRunXrChromeSideEffects({}), true);
});

test("Quest extra GPU work stays off the idle XR frame", () => {
  assert.equal(shouldStopOverlayTraverse(47, 48), false);
  assert.equal(shouldStopOverlayTraverse(48, XR_OVERLAY_RELAYER_MAX_MESHES), true);
  assert.equal(shouldBindSceneEnvironmentWhilePresenting({ presenting: true }), false);
  assert.equal(shouldBindSceneEnvironmentWhilePresenting({ presenting: false }), false);
  assert.equal(shouldRunBootSplashRaf({ splashHidden: true, presenting: false }), false);
  assert.equal(shouldRunBootSplashRaf({ splashHidden: false, presenting: true }), false);
  assert.equal(shouldRunBootSplashRaf({ splashHidden: false, presenting: false }), true);
  assert.equal(shouldEnableXrRayFlashlight({ presenting: true, aiming: false }), false);
  assert.equal(shouldEnableXrRayFlashlight({ presenting: true, aiming: true }), false);
  assert.equal(shouldEnableXrRayFlashlight({ presenting: true, aiming: true, passthrough: true }), false);
  assert.equal(shouldTickDimosTeleop({ armed: false }), false);
  assert.equal(shouldTickDimosTeleop({ armed: true }), true);
  assert.equal(shouldTickDimosTeleop({ armed: false, recording: true }), true);
  assert.equal(shouldTickDimosTeleop({ armed: false, playing: true }), true);
  assert.equal(shouldAttachDimosOnXrEnter({ armed: false }), false);
  assert.equal(shouldAttachDimosOnXrEnter({ armed: true }), false);
  assert.equal(shouldEnsureDimosCoordinatorOnXrEnter({ presenting: true }), true);
  assert.equal(shouldEnsureDimosCoordinatorOnXrEnter({ presenting: false }), false);
  assert.equal(shouldRunStudioAHold({ armed: false }), true);
  assert.equal(shouldRunStudioAHold({ armed: true }), false);
  assert.equal(shouldRunStudioLaser({ armed: false }), true);
  assert.equal(shouldRunStudioLaser({ armed: true }), false);
  assert.equal(sourceOwnsStudioLaser({ handedness: "right" }), true);
  assert.equal(sourceOwnsStudioLaser({ handedness: "left" }), false);
  assert.equal(shouldRunStudioGripGrab({ armed: false }), true);
  assert.equal(shouldRunStudioGripGrab({ armed: true }), true);
  assert.equal(shouldRunStudioGripGrab({ armed: true, uiHit: true }), true);
  assert.equal(shouldRunStudioGripGrab({ armed: true, nearMenu: true }), true);
  assert.equal(studioUiOverridesDimosSelect({ uiHit: true }), true);
  assert.equal(dimosShouldForwardSelect({ uiHit: true }), false);
  assert.equal(dimosShouldForwardSelect({ uiHit: false, nearMenu: false }), true);
  const saved = nextToolAfterDimosArmChange({ armed: true, previousTool: "", currentTool: "draw" });
  assert.equal(saved.previousTool, "draw");
  const restored = nextToolAfterDimosArmChange({ armed: false, previousTool: "draw", currentTool: "grab" });
  assert.equal(restored.tool, "draw");
  assert.equal(restored.previousTool, "");
  assert.equal(shouldRestyleCadMaterialsOnXrEnter(), false);
  assert.equal(shouldStripCadExtrasOnXrEnter(), false);
  assert.equal(shouldKillBootSplashForXrPresent({ presenting: false }), false);
  assert.equal(shouldKillBootSplashForXrPresent({ presenting: true }), true);
  assert.equal(shouldOpenLastProjectOnXrEnterHotPath(), false);
  assert.equal(shouldUseWindowRafWhileXrPresenting(), false);
  const splashSrc = readFileSync(join(here, "xr-enter-splash.js"), "utf8");
  assert.equal(splashSrc.includes("TextureLoader"), false);
  assert.ok(splashSrc.includes("shouldUploadXrEnterSplashTexture"));
  assert.ok(splashSrc.includes("xr-enter-splash-css"));
  assert.ok(splashSrc.includes("freezeAnimatedSvgForTexture"));
  const xrFrame = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(xrFrame.includes("shouldBindSceneEnvironmentWhilePresenting"));
  assert.ok(xrFrame.includes("shouldTickDimosTeleop({"));
  assert.ok(xrFrame.includes("recording: !!rec.recording"));
  assert.ok(xrFrame.includes("playing: !!rec.playing"));
  assert.ok(xrFrame.includes("resetDimosTeleopOnXrBoundary()"));
  assert.ok(xrFrame.includes("shouldAttachDimosOnXrEnter({ armed: isDimosTeleopArmed() })"));
  assert.ok(xrFrame.includes("shouldEnsureDimosCoordinatorOnXrEnter({ presenting: true })"));
  assert.ok(xrFrame.includes("ensureDimosCoordinatorIfDown"));
  assert.ok(xrFrame.includes("shouldRunStudioAHold({ armed: stealDimos })"));
  assert.ok(xrFrame.includes("shouldRunStudioLaser({ armed: stealDimos })"));
  assert.ok(xrFrame.includes("sourceOwnsStudioLaser(source)"));
  assert.ok(xrFrame.includes("shouldRunStudioGripGrab({ armed: isDimosStealingGrip()") || xrFrame.includes("shouldRunStudioGripGrab(studioGripGrabOpts()"));
  assert.ok(xrFrame.includes("nextToolAfterDimosArmChange"));
  assert.ok(xrFrame.includes("killBootSplashDomForXr"));
  assert.ok(xrFrame.includes("armXrEnterIdleTimer"));
  assert.ok(xrFrame.includes("flushDeferredXrProject"));
  assert.equal(xrFrame.includes("xrRayFlash"), false);
  assert.equal(shouldTickGuidesCanvas({ visible: false, now: 1000, lastPaintAt: 0 }), false);
  assert.equal(shouldTickGuidesCanvas({ visible: true, now: 50, lastPaintAt: 0, minMs: 160 }), false);
  assert.equal(shouldTickGuidesCanvas({ visible: true, now: 200, lastPaintAt: 0, minMs: 160 }), true);
  assert.equal(shouldTickAvatarBlink({ avatarCount: 0, now: 1000, lastBlinkAt: 0 }), false);
  assert.equal(shouldTickAvatarBlink({ avatarCount: 2, now: 40, lastBlinkAt: 0, minMs: 90 }), false);
  assert.equal(shouldTickAvatarBlink({ avatarCount: 2, now: 100, lastBlinkAt: 0, minMs: 90 }), false);
  assert.equal(shouldTickAvatarBlink({ avatarCount: 2, now: 100, lastBlinkAt: 0, minMs: 90, avatarFxEnabled: true }), true);
  assert.equal(shouldTickAvatarBlink({ avatarCount: 2, now: 100, lastBlinkAt: 0, minMs: 90, avatarFxEnabled: true, enterSettled: false }), false);
  assert.equal(shouldTickGuidesCanvas({ visible: true, now: 200, lastPaintAt: 0, minMs: 160, enterSettled: false }), false);
  assert.equal(shouldRunXrEnterDeferredWork({ presenting: true, now: 100, presentStartedAt: 0, minMs: 500 }), false);
  assert.equal(shouldRunXrEnterDeferredWork({ presenting: true, now: 500, presentStartedAt: 0, minMs: 500 }), true);
  assert.equal(shouldRunXrEnterDeferredWork({ presenting: false, now: 5000, presentStartedAt: 0 }), false);
  assert.equal(shouldDeferXrEnterWork({ presenting: true, now: 100, presentStartedAt: 0, minMs: 1400 }), true);
  assert.equal(shouldDeferXrEnterWork({ presenting: true, now: 1400, presentStartedAt: 0, minMs: 1400 }), false);
  assert.equal(shouldDeferXrEnterWork({ presenting: false, now: 5000, presentStartedAt: 0 }), false);
  assert.equal(shouldHideCadOnXrEnter({ emptyScene: false }), true);
  assert.equal(shouldHideCadOnXrEnter({ emptyScene: true }), true);
  assert.equal(shouldPrepareXrMeshesOnEnter({ enterSettled: false }), false);
  assert.equal(shouldPrepareXrMeshesOnEnter({ enterSettled: true }), true);
  assert.equal(shouldSkipCadTrianglePick({ enterSettled: false }), true);
  assert.equal(shouldSkipCadTrianglePick({ enterSettled: true }), false);
  assert.equal(shouldSkipCadChromeTraverse({ skipByLayer: true }), true);
  assert.equal(shouldPickLiveCad({ enterSettled: false }), false);
  assert.equal(shouldPickLiveCad({ enterSettled: true }), true);
  assert.equal(shouldCreateXrClipViewer({ presenting: true, viewing: true, enterSettled: false }), false);
  assert.equal(shouldCreateXrClipViewer({ presenting: true, viewing: true, enterSettled: true }), true);
  assert.equal(shouldCreateXrClipViewer({ presenting: false, viewing: true, enterSettled: true }), false);
  assert.equal(shouldHoverDrawablePick({ tool: "grab" }), false);
  assert.equal(shouldHoverDrawablePick({ tool: "draw" }), true);
  assert.equal(shouldHoverDrawablePick({ tool: "draw", busy: true }), false);
  assert.equal(shouldExtraWorldPick({ busy: true }), false);
  assert.equal(shouldExtraWorldPick({ alreadyPicked: true }), false);
  assert.equal(shouldSkipWorldMeshPick({ grabbing: true, tool: "grab" }), true);
  assert.equal(shouldSkipWorldMeshPick({ drawing: true, tool: "draw" }), false);
  assert.equal(shouldTraverseCadForXrContentBox({ presenting: true }), false);
  assert.equal(shouldTraverseCadForXrContentBox({ hasCached: true }), false);
  assert.equal(shouldTraverseCadForXrContentBox({ presenting: false, hasCached: false }), true);
  const boot = readFileSync(join(here, "../boot/boot-headset-scene.js"), "utf8");
  assert.ok(boot.includes("shouldRunBootSplashRaf"));
  const env = readFileSync(join(here, "xr-environments.js"), "utf8");
  assert.ok(env.includes("bindEnvironment"));
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  assert.ok(app.includes("shouldRunXrChromeSideEffects"));
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.match(html, /app\.js\?v=[^"\s]*20260908-/);
  assert.ok(html.includes("robotics=20260915-3"));
  assert.match(app, /viewport-xr\.js\?v=20260908-/);
  assert.match(app, /xr-hot-path\.js\?v=roboticsworkspace3/);
  assert.ok(app.includes("roboticsworkspace3"));
  assert.equal(isFallbackXrManager({ isFallbackStub: true }), true);
  assert.equal(isFallbackXrManager({ getController() {} }), false);
  assert.equal(shouldSetupXrControllers({ xr: { isFallbackStub: true, getController() {} } }), false);
  assert.equal(shouldSetupXrControllers({ xr: { getController() {} } }), true);
  assert.equal(shouldRequestImmersiveArOnDesktop({
    headset: false, hasRealXr: true, immersiveArSupported: true,
  }), true);
  assert.equal(shouldRequestImmersiveArOnDesktop({
    headset: false, hasRealXr: false, immersiveArSupported: true,
  }), false);
  assert.equal(shouldRequestImmersiveArOnDesktop({
    headset: true, hasRealXr: true, immersiveArSupported: true,
  }), false);
  assert.equal(desktopCameraArPlan({ hasDesktopAr: true }), "camera");
  assert.equal(desktopCameraArPlan({ headset: true, hasDesktopAr: true }), "none");
  assert.ok(xrFrame.includes("shouldRequestImmersiveArOnDesktop"));
  assert.ok(xrFrame.includes("desktopCameraArPlan"));
  assert.ok(xrFrame.includes("shouldSetupXrControllers"));
  assert.ok(!xrFrame.includes("showArVrWorkspaceChooser({ hasCamera: true })"));
  assert.equal(shouldPostXrPerfSample({ presenting: false, presentStartedAt: 0, now: 20000 }), false);
  assert.equal(shouldPostXrPerfSample({ presenting: true, posted: true, presentStartedAt: 0, now: 20000 }), false);
  assert.equal(shouldPostXrPerfSample({ presenting: true, presentStartedAt: 0, now: 5000 }), false);
  assert.equal(shouldPostXrPerfSample({ presenting: true, presentStartedAt: 0, now: 10000 }), false);
  assert.equal(shouldUploadXrDebuggerLog({ debuggerOpen: false, explicit: true }), false);
  assert.equal(shouldUploadXrDebuggerLog({ debuggerOpen: true, explicit: false }), false);
  assert.equal(shouldUploadXrDebuggerLog({ debuggerOpen: true, explicit: true, auto: true }), false);
  assert.equal(shouldUploadXrDebuggerLog({ debuggerOpen: true, explicit: true }), true);
  assert.equal(shouldUploadXrDebuggerLog({ debuggerOpen: false, explicit: true, exitFlush: true }), true);
  assert.equal(shouldUploadXrDebuggerLog({ debuggerOpen: false, explicit: true, exitFlush: false }), false);
  assert.equal(presentingPickLasersOn({ presenting: true, posed: true }), true);
  assert.equal(presentingPickLasersOn({ presenting: true, posed: false }), false);
  assert.equal(laserPointerModeOn({ presenting: true }), true);
  assert.equal(shouldPostXrPerfSample({
    presenting: true, debuggerOpen: true, explicit: true, presentStartedAt: 0, now: 10000,
  }), true);
  assert.deepEqual(summarizeXrFrameTimes([{ dt: 11 }, { dt: 12 }, { dt: 13 }, { dt: 40 }]), { avgMs: 19, p95Ms: 40, n: 4 });
  const hitches = summarizeXrHitchSpikes([{ t: 1, dt: 12, fps: 80 }, { t: 2, dt: 28, fps: 35, memMb: 70, where: "rightTrigger", stack: "tick | xr" }]);
  assert.equal(hitches.hitchCount, 1);
  assert.equal(hitches.spikes[0].dt, 28);
  assert.equal(hitches.spikes[0].where, "rightTrigger");
  assert.match(hitches.spikes[0].stack, /tick/);
  assert.ok(xrFrame.includes("postXrPerfSample"));
  assert.ok(xrFrame.includes("shouldPostXrPerfSample"));
  assert.ok(xrFrame.includes("shouldUploadXrDebuggerLog"));
  assert.ok(xrFrame.includes("debuggerOpen"));
  assert.ok(app.includes("payload?.auto"));
  assert.equal(shouldRestoreSavedCadPoseOnEnter(), false);
  assert.equal(shouldParkXrAssemblyAtTinyScale(), false);
  assert.equal(shouldLoadXrAvatarMeshes(), false);
  assert.equal(shouldCloneCadGhostForAvatars(), false);
  assert.ok(xrFrame.includes("createXrCheapVrStage()"));
  assert.ok(xrFrame.includes("shouldRestoreSavedCadPoseOnEnter()"));
  assert.ok(xrFrame.includes("placeAfterProjectLoad({ attempts = 3"));
  assert.ok(xrFrame.includes("shouldParkXrAssemblyAtTinyScale()"));
  assert.ok(xrFrame.includes("shouldCloneCadGhostForAvatars()"));
  assert.ok(xrFrame.includes("recaptureDesktop: true"));
  assert.ok(xrFrame.includes("placeCadForSession({ force: true })"));
  assert.ok(!xrFrame.includes("createXrWhiteRoom()"));
  assert.ok(xrFrame.includes("rebindXrInputHosts"));
  assert.ok(xrFrame.includes("pollXrTrackingResume"));
  assert.ok(app.includes("setCadOrbitLite"));
  assert.ok(app.includes("antialias: !mobileGl && !questGl"));
  assert.ok(xrFrame.includes("savedPixelRatio"));
  assert.ok(xrFrame.includes("setPixelRatio?.(1)"));
  const early = readFileSync(join(here, "../boot/early-boot.js"), "utf8");
  assert.match(early, /CSS logo/i);
  assert.equal(early.includes("mountBootHeadsetScene"), false);
  assert.equal(shouldMountBootHeadsetScene(), false);
  assert.equal(shouldMountBootHeadsetScene({ presenting: true }), false);
  assert.ok(xrFrame.includes("scheduleXrEnterIdle"));
  assert.ok(xrFrame.includes("applyXrEnvironmentOnEnter"));
  assert.ok(xrFrame.includes("stopBootSplashForPresent"));
  assert.ok(xrFrame.includes("Do not restore every saved window on enter"));
  const presence = readFileSync(join(here, "xr-presence.js"), "utf8");
  assert.ok(presence.includes("shouldLoadXrAvatarMeshes()"));
  assert.ok(presence.includes("shouldCloneCadGhostForAvatars()"));
  assert.ok(presence.includes("roboticsworkspace3"));
});

test("menu canvas and hit planes are not rebuilt when content is unchanged", () => {
  const a = xrConsoleSignature({ title: "RENDER STUDIO", tab: "projects", tabsKey: "projects,social", lines: [{ id: "p1", label: "A" }], footer: "ok" });
  const b = xrConsoleSignature({ title: "RENDER STUDIO", tab: "projects", tabsKey: "projects,social", lines: [{ id: "p1", label: "A" }], footer: "ok" });
  const c = xrConsoleSignature({ title: "RENDER STUDIO", tab: "social", tabsKey: "projects,social", lines: [{ id: "p1", label: "A" }], footer: "ok" });
  assert.equal(a, b);
  assert.equal(shouldRedrawXrConsole({ lastSig: a, nextSig: b }), false);
  assert.equal(shouldRedrawXrConsole({ lastSig: a, nextSig: c }), true);
  assert.equal(shouldRedrawXrConsole({ lastSig: a, nextSig: a, force: true }), true);
  assert.equal(shouldRebuildMenuHits({ lastKey: "projects,social", nextKey: "projects,social", lastCount: 6, nextCount: 6 }), false);
  assert.equal(shouldRebuildMenuHits({ lastKey: "projects,social", nextKey: "profile,store", lastCount: 6, nextCount: 5 }), true);
  assert.equal(shouldPrepareXrMeshes({ prepared: true }), false);
  assert.equal(shouldPrepareXrMeshes({ prepared: false }), true);
  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(xr.includes("function relayerXrOverlays"));
  assert.ok(xr.includes("shouldRedrawXrConsole"));
  assert.ok(xr.includes("shouldRebuildMenuHits"));
});

test("world UI dirty-only, stroke pick skip, and Measure triangle stay off idle XR frames", () => {
  assert.equal(shouldCadTrianglePick({ tool: "grab" }), false);
  assert.equal(shouldCadTrianglePick({ tool: "draw" }), false);
  assert.equal(shouldCadTrianglePick({ tool: "measure" }), true);
  assert.equal(shouldCadTrianglePick({ tool: "transparent" }), true);
  assert.equal(shouldCadTrianglePick({ tool: "measure", enterSettled: false }), false);
  const a = xrAiPanelSignature({ draft: "hi", generating: false });
  const b = xrAiPanelSignature({ draft: "hi", generating: false });
  const c = xrAiPanelSignature({ draft: "ho", generating: false });
  assert.equal(shouldRedrawXrConsole({ lastSig: a, nextSig: b }), false);
  assert.equal(shouldRedrawXrConsole({ lastSig: a, nextSig: c }), true);
  const g1 = xrGridPopupSignature({ kind: "tools", tools: [{ id: "grab", label: "Grab", color: 1, on: false }] });
  const g2 = xrGridPopupSignature({ kind: "tools", tools: [{ id: "grab", label: "Grab", color: 1, on: false }] });
  assert.equal(shouldRedrawXrConsole({ lastSig: g1, nextSig: g2 }), false);
  assert.equal(shouldUpdateXrUiHover({ lastSig: "mesh|", nextSig: "mesh|" }), false);
  assert.equal(shouldUpdateXrUiHover({ lastSig: "", nextSig: xrUiHoverSignature({ kind: "ai-action", id: "mic" }) }), true);
  assert.equal(skipXrInstancedPick({ isInstancedMesh: true }), true);
  assert.equal(skipXrInstancedPick({ userData: { xrLiveInk: true } }), true);
  assert.equal(skipXrInstancedPick({ isMesh: true, userData: {} }), false);
  assert.equal(shouldTickXrPresence({ avatarCount: 0 }), false);
  assert.equal(shouldTickXrPresence({ avatarCount: 1, busy: true }), false);
  assert.equal(shouldTickXrPresence({ avatarCount: 1 }), true);
  assert.equal(shouldFaceNametag({ headMoved: false, viewerMoved: false }), false);
  assert.equal(shouldFaceNametag({ headMoved: true }), true);
  assert.equal(shouldUploadXrVideoFrame({ hasTex: true, isVideo: true, ready: true, paused: true }), false);
  assert.equal(shouldUploadXrVideoFrame({ hasTex: true, isVideo: true, ready: true }), true);
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(xr.includes("xrAiPanelSignature"));
  assert.ok(xr.includes("xrGridPopupSignature"));
  assert.ok(xr.includes("shouldCadTrianglePick"));
  assert.ok(xr.includes("shouldTickXrPresence"));
  assert.ok(xr.includes("shouldUpdateXrUiHover"));
  const presence = readFileSync(join(here, "xr-presence.js"), "utf8");
  assert.ok(presence.includes("shouldFaceNametag"));
  const draw = readFileSync(join(here, "xr-voice-draw.js"), "utf8");
  assert.equal(draw.includes("new THREE.TubeGeometry"), false);
});

test("hidden capture dock is not rebuilt on VR enter", () => {
  assert.equal(shouldRebuildCaptureDock({ visible: false, buttonCount: 4 }), false);
  assert.equal(shouldRebuildCaptureDock({ visible: false, modeChanged: true, buttonCount: 0 }), false);
  assert.equal(shouldRebuildCaptureDock({ visible: true, buttonCount: 0 }), true);
  assert.equal(shouldRebuildCaptureDock({ visible: true, modeChanged: true, buttonCount: 4 }), true);
});

test("CAD place loop stops once the model is world-anchored", () => {
  assert.equal(shouldPlaceCadThisFrame({ pending: true, worldAnchored: false, attempts: 1 }), true);
  assert.equal(shouldPlaceCadThisFrame({ pending: true, worldAnchored: true, attempts: 4, now: 800, lastPlaceAt: 0 }), false);
  assert.equal(shouldPlaceCadThisFrame({ pending: true, worldAnchored: false, attempts: 4, now: 100, lastPlaceAt: 0 }), false);
  assert.equal(shouldPlaceCadThisFrame({ pending: true, worldAnchored: false, attempts: 4, now: 400, lastPlaceAt: 0 }), true);
  assert.equal(shouldPlaceCadThisFrame({ pending: true, worldAnchored: false, attempts: 1, enterSettled: false }), false);
  assert.equal(XR_PENDING_PLACE_MAX, 3);
  assert.equal(shouldClearPendingCadPlace({ worldAnchored: true, attempts: 0 }), true);
  assert.equal(shouldClearPendingCadPlace({ worldAnchored: false, enterSettled: false, attempts: 8 }), false);
  assert.equal(shouldClearPendingCadPlace({ worldAnchored: false, enterSettled: true, attempts: 2 }), false);
  assert.equal(shouldClearPendingCadPlace({ worldAnchored: false, enterSettled: true, attempts: 3 }), true);
  assert.equal(shouldUnhideXrCad({ visible: false }), true);
  assert.equal(shouldUnhideXrCad({ visible: false, enterSettled: false }), false);
  assert.equal(shouldUnhideXrCad({ visible: false, emptyScene: true }), false);
  assert.equal(shouldUnhideXrCad({ visible: false, grabbing: true }), false);
  assert.equal(shouldBakeParkedXrCad({ scaleX: 1e-6, attempts: 0 }), true);
  assert.equal(shouldBakeParkedXrCad({ scaleX: 1e-6, attempts: 2 }), false);
  assert.equal(shouldBakeParkedXrCad({ scaleX: 0.12, attempts: 0 }), false);
  assert.equal(shouldBakeParkedXrCad({ scaleX: 1e-6, attempts: 1, lastAt: 0, now: 100 }), false);
  assert.equal(shouldBakeParkedXrCad({ scaleX: 1e-6, attempts: 1, lastAt: 0, now: 800 }), true);
  assert.equal(shouldBakeParkedXrCad({ scaleX: 1e-6, projectSwap: true, attempts: 0 }), false);
  assert.equal(shouldMarkCadWorldAnchored({ restored: true }), true);
  assert.equal(shouldMarkCadWorldAnchored({ placed: true }), true);
  assert.equal(shouldMarkCadWorldAnchored({}), false);
  assert.equal(shouldKeepModelClearOfNearPlane({ worldAnchored: true }), false);
  assert.equal(shouldKeepModelClearOfNearPlane({ worldAnchored: false, grabbing: false }), true);
  assert.equal(shouldKeepModelClearOfNearPlane({ worldAnchored: false, grabbing: false, enterSettled: false }), false);
  assert.equal(shouldRefreshXrContentBox({ worldAnchored: true, lastMs: 100, now: 200 }), false);
  assert.equal(shouldRefreshXrContentBox({ worldAnchored: false, lastMs: 0, now: 400 }), true);
  assert.equal(shouldRefreshXrContentBox({ force: true, worldAnchored: true, lastMs: 100, now: 200 }), true);
  assert.equal(shouldSkipXrScaleBake({ worldMax: 0.12, targetM: 0.12 }), true);
  assert.equal(shouldSkipXrScaleBake({ worldMax: 0.11, targetM: 0.12 }), true);
  assert.equal(shouldSkipXrScaleBake({ worldMax: 2, targetM: 0.12 }), false);
  assert.equal(shouldSkipXrScaleBake({ worldMax: 1e-6, targetM: 0.12 }), false);
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(xr.includes("shouldMarkCadWorldAnchored({ restored: true })"));
  assert.ok(xr.includes("pendingInitialPlace = false"));
  assert.ok(xr.includes("shouldBakeParkedXrCad"));
  assert.ok(xr.includes("enterSettled"));
  assert.ok(xr.includes("shouldSkipXrScaleBake"));
  assert.ok(xr.includes("shouldDeferXrEnterWork"));
  assert.ok(xr.includes("shouldHideCadOnXrEnter"));
  assert.ok(xr.includes("shouldSkipCadTrianglePick"));
  assert.ok(xr.includes("shouldCreateXrClipViewer"));
  assert.ok(xr.includes("webglcontextlost"));
  const enterFn = xr.slice(xr.indexOf("async function enter()"), xr.indexOf("function persistXrCombinedMesh"));
  assert.equal(enterFn.includes("placeInFront("), false, "CAD place must wait until enterSettled");
  assert.ok(enterFn.includes("hideCadForEmptyEnter"));
  assert.ok(enterFn.includes("panelsAwaitingHead = true"));
  assert.ok(xr.includes("contentBoxFromMesh(mesh, { force: false, skipMatrix: true, firstPlace: true })"));
  assert.ok(xr.includes("alreadyHandheld"));
  assert.ok(xr.includes("_meshBox.translate"));
  assert.ok(xr.includes("skipMatrix !== true"));
  assert.ok(xr.includes("shouldPlaceCadThisFrame"));
  assert.ok(xr.includes("shouldClearPendingCadPlace"));
  assert.ok(!xr.includes("placeAttempts >= 45"));
  assert.ok(xr.includes("if (worldAnchored && presenting)"));
  assert.ok(xr.includes("CAD place waits for enterSettled"));
  assert.ok(xr.includes("unbindMaterialWrapMaps"));
  assert.ok(xr.includes("prepareMeshesForXr(mesh)"));
  assert.ok(xr.includes("shouldPrepareXrMeshesOnEnter"));
  assert.ok(!/_meshBoxScratch\.clone/.test(xr));
  assert.ok(xr.includes("boundingBox.clone()") === false);
  assert.ok(xr.includes("xrWalkMeshesCapped"));
  assert.ok(xr.includes("getSharedXrCadMaterial"));
  assert.ok(xr.includes("shouldCloneXrPbrMaterials"));
  assert.ok(xr.includes("applyXrPresentingViewportEl"));
  assert.ok(xr.includes("shouldDisposeDesktopOnlyTarget"));
});

test("XR first place reuses cached AABB, skips PBR clone, and keeps #viewport", () => {
  assert.equal(shouldReuseCachedXrBounds({ hasCached: true }), true);
  assert.equal(shouldReuseCachedXrBounds({ hasCached: false }), false);
  assert.equal(shouldWalkXrPlaceAabb({ hasCached: true, firstPlace: true }), false);
  assert.equal(shouldWalkXrPlaceAabb({ hasCached: false, firstPlace: true }), true);
  assert.equal(shouldStopXrPlaceAabbWalk({ firstPlace: true, visited: 8 }), true);
  assert.equal(shouldStopXrPlaceAabbWalk({ firstPlace: false, visited: 99 }), false);
  assert.equal(XR_PLACE_AABB_MESH_CAP, 8);
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const box = xrWorldBoxFromLocalBox([-1, -2, -3], [1, 2, 3], identity);
  assert.equal(box.min[0], -1);
  assert.equal(box.max[1], 2);
  const translated = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1];
  const moved = xrWorldBoxFromLocalBox([0, 0, 0], [1, 1, 1], translated);
  assert.equal(moved.min[0], 10);
  assert.equal(moved.max[0], 11);
  const mesh = { userData: {}, isMesh: true, geometry: {}, children: [] };
  stashXrLocalBox(mesh, [0, 0, 0], [2, 2, 2], identity);
  assert.deepEqual(readXrLocalBox(mesh).max, [2, 2, 2]);
  let visited = 0;
  const root = {
    isMesh: false,
    geometry: null,
    children: [
      { isMesh: true, geometry: {}, children: [] },
      { isMesh: true, geometry: {}, children: [] },
      { isMesh: true, geometry: {}, children: [] },
    ],
  };
  xrWalkMeshesCapped(root, () => { visited += 1; }, 2);
  assert.equal(visited, 2);
  assert.equal(shouldCloneXrPbrMaterials({ presenting: true }), false);
  assert.equal(shouldCloneXrPbrMaterials({ presenting: false }), true);
  assert.equal(shouldShareXrCadMaterial({ presenting: true }), true);
  assert.equal(xrMaterialSwapBudget({ remaining: 100, chunk: 24 }), 24);
  assert.equal(XR_MAT_SWAP_CHUNK, 24);
  assert.equal(shouldSyncCadEdgesWhilePresenting({ presenting: true }), false);
  assert.equal(shouldHideCadEdgesInXr({ presenting: true }), true);
  assert.equal(shouldUploadXrWrapTexture({ presenting: true, width: 4096, height: 4096 }), false);
  assert.equal(shouldUploadXrWrapTexture({ presenting: true, width: 512, height: 512 }), true);
  assert.equal(shouldUploadXrWrapTexture({ presenting: false, width: 4096, height: 4096 }), true);
  assert.equal(xrTextureMaxDim({ image: { width: 4096, height: 2048 } }), 4096);
  assert.equal(shouldDisposeDesktopOnlyTarget({ presenting: true, recording: false }), true);
  assert.equal(shouldDisposeDesktopOnlyTarget({ presenting: true, recording: true }), false);
  assert.equal(shouldResizeDesktopRenderer({ presenting: true }), false);
  assert.equal(shouldParkDesktopViewportForCanvasTab({ presenting: false, canvasTabActive: true }), true);
  assert.equal(shouldParkDesktopViewportForCanvasTab({ presenting: true, canvasTabActive: true }), false);
  assert.equal(shouldParkDesktopViewportForCanvasTab({ presenting: false, canvasTabActive: false }), false);
  assert.equal(shouldKeepViewportVisibleWhilePresenting({ presenting: true }), true);
  assert.equal(isWebglContextLost({ getContext: () => ({ isContextLost: () => true }) }), true);
  assert.equal(isWebglContextLost({ getContext: () => ({ isContextLost: () => false }) }), false);
  assert.equal(isWebglContextLost(null), false);
  let restored = 0;
  assert.equal(tryRestoreWebglContext({
    getContext: () => ({
      isContextLost: () => true,
      getExtension: () => ({ restoreContext: () => { restored += 1; } }),
    }),
  }), true);
  assert.equal(restored, 1);
  assert.equal(tryRestoreWebglContext({ getContext: () => ({ isContextLost: () => false }) }), false);
  const canvas = {
    style: { display: "none", visibility: "hidden" },
    classList: { remove() {} },
    parentElement: null,
  };
  const host = {
    appendChild(el) { el.parentElement = this; this.child = el; },
  };
  assert.equal(reattachRendererCanvas({ domElement: canvas }, host), true);
  assert.equal(host.child, canvas);
  assert.equal(canvas.style.display, "");
  assert.equal(reattachRendererCanvas({ domElement: canvas }, host), false);
  const ws = { classList: { added: [], add(name) { this.added.push(name); } } };
  const modal = {
    sheet: false,
    classList: {
      added: [],
      contains(name) { return name === "is-sheet-only" && modal.sheet; },
      add(name) { this.added.push(name); },
    },
  };
  const col = { classList: { removed: [], remove(...names) { this.removed.push(...names); } } };
  hideEditorCoveringViewport({ canvasWorkspace: ws, videoModal: modal, mainColumn: col });
  assert.deepEqual(ws.classList.added, ["hidden"]);
  assert.deepEqual(modal.classList.added, ["hidden"]);
  assert.ok(col.classList.removed.includes("viser-layout-viser"));
  modal.sheet = true;
  modal.classList.added = [];
  hideEditorCoveringViewport({ videoModal: modal });
  assert.deepEqual(modal.classList.added, []);
  const el = {
    hidden: true,
    classList: { remove() { this.removed = true; } },
    style: { display: "none", visibility: "hidden" },
    removeAttribute() { this.hidden = false; },
  };
  assert.equal(applyXrPresentingViewportEl(el, { presenting: true }), true);
  assert.equal(el.hidden, false);
  assert.equal(el.style.visibility, "visible");
  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const style = readFileSync(join(here, "../viewport/scene-style.js"), "utf8");
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  assert.ok(xr.includes("firstPlace: true"));
  assert.ok(xr.includes("shouldCloneXrPbrMaterials"));
  assert.ok(style.includes("shouldSyncCadEdgesWhilePresenting"));
  assert.ok(style.includes("shouldRestyleCadMaterialsOnXrEnter"));
  assert.ok(style.includes("parkWrapMaterialsForXr(object3d)"));
  assert.ok(style.includes("return object3d;"));
  assert.ok(app.includes("shouldStripCadExtrasOnXrEnter"));
  assert.ok(app.includes("restoreStudioViewportAfterEditor"));
  assert.ok(app.includes("refreshLiveWebglViewport"));
  assert.ok(app.includes("webglcontextrestored"));
  assert.ok(css.includes("body.xr-presenting #app.canvas-design-tab #viewport"));
  assert.ok(css.includes("body.xr-presenting #app.wiring-mode #viewport"));
  assert.ok(app.includes("stashXrLocalBox"));
  assert.ok(app.includes("shouldResizeDesktopRenderer"));
  assert.ok(app.includes("shouldParkDesktopViewportForCanvasTab"));
  assert.ok(app.includes("stripCadExtras(currentMesh"));
});

test("XR progressive unhide caps triangles and parks high-poly parts", () => {
  assert.equal(xrMeshTriangleCount({ index: { count: 9 } }), 3);
  assert.equal(xrMeshTriangleCount({ attributes: { position: { count: 12 } } }), 4);
  assert.equal(xrMeshTriangleCount(null), 0);
  const tree = {
    isMesh: false,
    children: [
      { isMesh: true, geometry: { index: { count: 300 } }, children: [] },
      { isMesh: true, geometry: { index: { count: 600 } }, children: [] },
      { isLineSegments: true, userData: { isEdge: true }, children: [] },
      { isSprite: true, children: [] },
    ],
  };
  const census = xrCadTreeCensus(tree);
  assert.equal(census.parts, 2);
  assert.equal(census.triangles, 300);
  assert.equal(census.lineSegments, 1);
  assert.equal(census.extras, 1);
  const units = xrCadUnhideUnits(tree);
  assert.equal(units.length, 3);
  assert.equal(xrUnitTriangleCount(units[0]), 100);
  assert.equal(shouldDelayHighPolyXrPart({ triangles: 12001 }), true);
  assert.equal(shouldDelayHighPolyXrPart({ triangles: 100 }), false);
  assert.equal(shouldRevealXrHighPoly({ enterSettled: false, framesSincePlace: 99 }), false);
  assert.equal(shouldRevealXrHighPoly({ enterSettled: true, framesSincePlace: 12 }), true);
  const cheap = { triangles: 1000 };
  const heavy = { triangles: 80000 };
  const first = xrUnhideFramePlan({
    remaining: [cheap, cheap, cheap, cheap, cheap, heavy],
    meshesPerFrame: 4,
    triBudget: 24000,
    triShown: 0,
    delayHighPoly: true,
  });
  assert.equal(first.show.length, 4);
  assert.equal(first.show.every((u) => u === cheap), true);
  assert.equal(first.rest.includes(heavy), true);
  assert.equal(first.done, false);
  const idleMid = { triangles: 12000 };
  const idle = xrUnhideFramePlan({
    remaining: [idleMid],
    meshesPerFrame: 4,
    triBudget: 24000,
    triShown: 0,
    delayHighPoly: false,
    maxParts: 99,
  });
  assert.equal(idle.show.length, 1);
  assert.equal(idle.done, true);
  assert.equal(shouldSkipOverBudgetXrMesh({ triangles: 40001 }), true);
  assert.equal(shouldSkipOverBudgetXrMesh({ triangles: 40000 }), false);
  assert.equal(XR_MESH_TRI_HARD_CAP, 40000);
  const giant = { triangles: 2_000_000 };
  const waiting = xrUnhideFramePlan({
    remaining: [giant],
    meshesPerFrame: 4,
    triBudget: 24000,
    delayHighPoly: true,
  });
  assert.equal(waiting.show.length, 0);
  assert.equal(waiting.rest.includes(giant), true);
  const idleGiant = xrUnhideFramePlan({
    remaining: [giant],
    meshesPerFrame: 4,
    triBudget: 24000,
    delayHighPoly: false,
  });
  assert.equal(idleGiant.show.length, 0);
  assert.equal(idleGiant.skip.length, 1);
  assert.equal(idleGiant.skip[0], giant);
  assert.equal(idleGiant.done, true);
  const liteGeo = { index: { count: 3000 } };
  const giantMesh = {
    isMesh: true,
    geometry: { index: { count: 9_000_000 } },
    userData: { simplifiedGeometry: liteGeo },
    children: [],
  };
  const stand = xrSimplifiedStandIn(giantMesh);
  assert.equal(stand.triangles, 1000);
  assert.equal(stand.swapGeometry, true);
  const annotated = xrAnnotateUnhideUnit(giantMesh);
  const idleLite = xrUnhideFramePlan({
    remaining: [annotated],
    meshesPerFrame: 4,
    triBudget: 24000,
    delayHighPoly: false,
  });
  assert.equal(idleLite.show.length, 1);
  assert.equal(idleLite.skip.length, 0);
  assert.equal(shouldShowXrCadProxy({ remaining: 0, shown: 0, skipped: 1 }), false);
  assert.equal(shouldShowXrCadProxy({ remaining: 0, shown: 4, skipped: 0 }), false);
  assert.equal(xrCadUnhideInProgress({ rest: [giant] }), true);
  assert.equal(xrCadUnhideInProgress({ rest: [] }), false);
  assert.equal(shouldRunXrVoiceIceWork({ presenting: true, enterSettled: true, unhideBusy: true }), false);
  assert.equal(shouldRunXrVoiceIceWork({ presenting: true, enterSettled: true, revealedThisFrame: 2 }), false);
  assert.equal(shouldRunXrVoiceIceWork({ presenting: true, enterSettled: true }), true);
  assert.equal(shouldRunXrEnterCanvasWork({
    presenting: true, now: 5000, presentStartedAt: 0, unhideBusy: true,
  }), false);
  assert.equal(shouldShowXrCadProxy({ remaining: 3, shown: 1 }), false);
  assert.equal(shouldShowXrCadProxy({ remaining: 0, shown: 4 }), false);
  const g = {
    geometry: { boundingBox: { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 2, z: 2 } } },
    userData: {},
  };
  assert.deepEqual(xrGeometryLocalBox(g.geometry).max, [2, 2, 2]);
  stashXrLocalBoxFromOwnGeometry(g);
  assert.deepEqual(g.userData._xrLocalBox.max, [2, 2, 2]);
  assert.equal(xrCadPaletteKey(1, 0, 0) !== xrCadPaletteKey(0, 0, 1), true);
  assert.equal(typeof xrCadPaletteHex(xrCadPaletteKey(1, 0, 0)), "number");
  assert.equal(shouldRunXrEnterCanvasWork({ presenting: true, now: 2200, presentStartedAt: 0 }), true);
  assert.equal(shouldRunXrEnterCanvasWork({ presenting: true, now: 1400, presentStartedAt: 0 }), false);
  assert.equal(shouldRunXrEnterCanvasWork({
    presenting: true, now: 2200, presentStartedAt: 0, revealedThisFrame: 1,
  }), false);
  assert.equal(XR_UNHIDE_MESHES_PER_FRAME, 2);
  assert.equal(XR_FIRST_FRAME_TRI_BUDGET, 6000);
  assert.equal(XR_CAD_DRAW_MAX_PARTS, 24);
  assert.equal(XR_CAD_DRAW_MAX_TRIS, 16000);
  assert.equal(shouldCapXrCadSessionDraw({ shown: 24 }), true);
  assert.equal(shouldCapXrCadSessionDraw({ triShown: 16000 }), true);
  assert.equal(shouldCapXrCadSessionDraw({ shown: 2, triShown: 1000 }), false);
  const parked = xrUnhideFramePlan({
    remaining: [cheap, cheap, cheap],
    meshesPerFrame: 4,
    triBudget: 24000,
    triShown: 0,
    sessionTriShown: 16000,
    partsShown: 24,
    delayHighPoly: false,
  });
  assert.equal(parked.show.length, 0);
  assert.equal(parked.skip.length, 3);
  assert.equal(parked.done, true);
  assert.equal(xrFoveationLevel({ presenting: true }), 0.35);
  assert.equal(xrFramebufferScaleFactor({ presenting: true }), 0.85);
  assert.equal(xrFramebufferScaleFactor({ presenting: false }), 1);
  const xrStub = { scale: 1, fov: 0, setFramebufferScaleFactor(v) { this.scale = v; }, setFoveation(v) { this.fov = v; } };
  assert.equal(applyXrRenderScale(xrStub, { presenting: true }), true);
  assert.equal(xrStub.scale, 0.85);
  assert.equal(xrStub.fov, 0.35);
  assert.equal(xrSessionFoveation({ renderState: { baseLayer: { fixedFoveation: 0 } } }, { presenting: true }), 0.35);
  assert.equal(XR_FRAMEBUFFER_SCALE, 0.85);
  assert.equal(XR_FOVEATION, 0.35);
  assert.equal(XR_HUD_CANVAS_SCALE, 2.2);
  assert.equal(XR_ENTER_CANVAS_MS, 2200);
  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(xr.includes("stepXrCadUnhide"));
  assert.ok(xr.includes("beginXrCadProgressiveUnhide"));
  assert.ok(xr.includes("xrCadProxy"));
  assert.ok(xr.includes("shouldRunXrEnterCanvasWork"));
  assert.ok(xr.includes("shouldRunXrVoiceIceWork"));
  assert.ok(xr.includes("XR_MESH_TRI_HARD_CAP"));
  assert.ok(xr.includes("XR_CAD_DRAW_MAX_PARTS"));
  assert.ok(xr.includes("XR_CAD_DRAW_MAX_TRIS"));
  assert.ok(xr.includes("applyXrRenderScale"));
  assert.ok(xr.includes("xrSessionFoveation"));
  assert.ok(xr.includes("shouldSkipWorldMeshPick"));
  assert.ok(xr.includes("shouldTraverseCadForXrContentBox"));
  assert.ok(xr.includes("updateHandRays({ pick: false })"));
  assert.ok(xr.includes("MeshBasicMaterial"));
  assert.equal(xr.includes("keepProxy"), false, "omitted geometry must not leave a bounds cube");
  assert.ok(xr.includes("xrAnnotateUnhideUnit"));
  assert.ok(xr.includes("stashXrLocalBoxFromOwnGeometry"));
  assert.ok(xr.includes("getXrCadPaletteMaterial"));
  assert.ok(xr.includes("No second GLB"));
  assert.ok(!xr.includes("for (const unit of state.rest) revealXrCadUnit"));
});

test("XR skips cover-wrap / render-insert PBR maps", () => {
  assert.equal(shouldKeepAuthoredTextureMaps({ presenting: true }), false);
  assert.equal(shouldKeepAuthoredTextureMaps({ skipCadExtras: true }), false);
  assert.equal(shouldKeepAuthoredTextureMaps({}), true);
  assert.equal(shouldApplyRenderedTextureWrap({ presenting: true }), false);
  assert.equal(shouldApplyRenderedTextureWrap({ presenting: false }), true);
  assert.equal(materialHasWrapMaps({ map: {} }), true);
  assert.equal(materialHasWrapMaps({ lightMap: {} }), true);
  assert.equal(materialHasWrapMaps({ specularMap: {} }), true);
  assert.equal(materialHasWrapMaps({ color: 1 }), false);
  const mat = { map: { id: 1 }, normalMap: { id: 2 }, needsUpdate: false };
  assert.equal(unbindMaterialWrapMaps(mat), true);
  assert.equal(mat.map, null);
  assert.equal(mat.normalMap, null);
  assert.equal(mat.needsUpdate, true);
  const style = readFileSync(join(here, "../viewport/scene-style.js"), "utf8");
  assert.ok(style.includes("parkWrapMaterialsForXr"));
  assert.ok(style.includes("rebind parked wrap") || style.includes("XR: CAD plastic only"));
  assert.ok(style.includes("aluminum #c0c6cc"));
  assert.ok(!style.includes("if (chroma < 0.08) return true;"));
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  assert.ok(app.includes("shouldApplyRenderedTextureWrap"));
  assert.ok(app.includes("Texture wrap stays on desktop"));
  let disposed = 0;
  const image = { w: 4 };
  const tex = {
    image,
    userData: {},
    dispose() { disposed += 1; },
  };
  const env = { image: {}, userData: {}, dispose() { disposed += 10; } };
  const bakMat = { map: tex, envMap: env };
  assert.equal(disposeParkedWrapGpuTextures(bakMat), 0);
  assert.equal(tex.image, image);
  assert.equal(tex.userData._xrGpuDisposed, undefined);
  assert.equal(disposed, 0);
  assert.equal(tex.dispose, bakMat.map.dispose);
  assert.equal(reviveParkedWrapGpuTextures(bakMat), 2);
  assert.equal(tex.needsUpdate, true);
  const root = {
    userData: { _xrMatBak: { map: { image, userData: {}, dispose() { disposed += 1; } } } },
    traverse(fn) { fn(this); },
  };
  assert.equal(disposeParkedWrapGpuFromObject(root), 0);
  assert.equal(disposed, 0);
  assert.ok(!readFileSync(join(here, "xr-hot-path.js"), "utf8").includes("tex.dispose()"));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(xr.includes("disposeParkedWrapGpuFromObject"));
  assert.ok(xr.includes("reviveParkedWrapGpuTextures"));
});

test("remote round-table does not seat you until Board / Table / Walk", () => {
  assert.equal(shouldApplyRemoteBoardLoco({ userArmed: false }), false);
  assert.equal(shouldApplyRemoteBoardLoco({}), false);
  assert.equal(shouldApplyRemoteBoardLoco({ userArmed: true }), true);
});

test("public profile tabs are Profile Store Activity Settings Calendar", () => {
  assert.deepEqual(publicProfileTabIds(), ["profile", "store", "activity", "settings", "calendar"]);
  const profile = publicProfileLinesForTab("profile", {
    id: "peer-9",
    display_name: "Ada",
    handle: "ada",
    bio: "Builds robots",
  });
  assert.ok(profile.lines.some((l) => l.label === "@ada"));
  const store = publicProfileLinesForTab("store", {
    store_items: [{ name: "Bracket v2", tagline: "Parametric clip" }],
  });
  assert.ok(store.lines.some((l) => /Bracket/.test(l.label)));
  const activity = publicProfileLinesForTab("activity", {
    activity: [{ kind: "cad", label: "generated a new CAD model", created_at: "2026-09-07" }],
  });
  assert.ok(activity.lines.some((l) => /CAD model/.test(l.label)));
  const settings = publicProfileLinesForTab("settings", { id: "peer-9" }, { muted: true, isFriend: false });
  assert.ok(settings.lines.some((l) => l.id === "room_mute:peer-9"));
  assert.ok(settings.lines.some((l) => l.id === "room_add:peer-9"));
  const cal = publicProfileLinesForTab("calendar", {
    id: "peer-9",
    suggested_slots: [{ starts_at: "2026-09-08T18:00:00Z", ends_at: "2026-09-08T18:30:00Z", label: "Tue 11:00" }],
  });
  assert.ok(cal.lines.some((l) => l.id === "meet:peer-9"));
  assert.ok(cal.lines.some((l) => String(l.id).startsWith("meetslot:peer-9|")));
});

test("Guides swipe and category helpers wrap clips on one panel", () => {
  const move = guideCategoryById("move");
  assert.ok(XR_GUIDE_CATEGORIES.some((c) => c.id === "draw"));
  assert.equal(wrapGuideClipIndex(move, 0, 1), 1);
  assert.equal(wrapGuideClipIndex(move, move.clips.length - 1, 1), 0);
  assert.equal(wrapGuideClipIndex(move, 0, -1), move.clips.length - 1);
  assert.equal(swipeGuideFromDeltaX(-80), 1);
  assert.equal(swipeGuideFromDeltaX(80), -1);
  assert.equal(swipeGuideFromDeltaX(4), 0);
  const catHit = pickGuidesHit(40, 80);
  assert.equal(catHit?.kind, "guides-action");
  assert.ok(String(catHit.id).startsWith("cat:"));
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "viewport-xr.js"), "utf8");
  const menuAt = src.indexOf('{ id: "menu"');
  const guidesAt = src.indexOf('{ id: "guides"');
  assert.ok(menuAt >= 0 && guidesAt > menuAt, "Guides puck is not left of Menu");
});

test("AR chooser action ids and phone head pose from orientation", () => {
  assert.deepEqual(AR_CHOOSER_ACTION_IDS, ["ar", "vr-workspace", "cancel"]);
  assert.equal(isArChooserAction("vr-workspace"), true);
  assert.equal(isArChooserAction("explode"), false);
  const pose = headPoseFromDeviceOrientation({ alpha: 0, beta: 90, gamma: 0 }, { position: [1, 1.6, 2] });
  assert.equal(pose.p[0], 1);
  assert.equal(pose.p[2], 2);
  const mag = Math.hypot(...pose.q);
  assert.ok(Math.abs(mag - 1) < 1e-6, `quat mag ${mag}`);
  const flat = headPoseFromDeviceOrientation({ alpha: 40, beta: 10, gamma: -8 });
  assert.notEqual(flat.q.join(","), pose.q.join(","));
});

test("named XR layouts serialize and apply across projects", () => {
  assert.equal(xrLayoutsStorageKey("user-9"), "render3d:xr-window-layouts:v1:user-9");
  assert.equal(shouldAutoApplyLastLayout({}), false);
  assert.equal(shouldAutoApplyLastLayout({ userPicked: true }), true);
  const snapped = serializeOpenWindowsLayout({
    menu: { v: 2, visible: true, forward: 0.7, right: -0.2, up: -0.08, tab: "projects" },
    ai: { v: 2, visible: true, forward: 0.72, right: 0.38, up: -0.05 },
    menuOpen: true,
    aiOpen: true,
    menuTab: "projects",
  }, { name: "", id: "lay-a" });
  assert.equal(snapped.name, "Layout 1");
  assert.equal(snapped.open.menuOpen, true);
  assert.equal(snapped.open.aiOpen, true);
  const applied = applyLayoutToPoseMap(snapped);
  assert.equal(applied.menuOpen, true);
  assert.equal(applied.aiOpen, true);
  assert.equal(applied.menu.forward, 0.7);
  assert.ok(layoutThumbCells(snapped).some((c) => c.kind === "menu"));
  let store = upsertNamedLayout(parseLayoutStore(null), snapped);
  assert.equal(nextLayoutName(store.layouts), "Layout 2");
  store = upsertNamedLayout(store, serializeOpenWindowsLayout({ viewOpen: true, view: { visible: true, forward: 0.6, right: 0, up: 0 } }, { name: "Desk", id: "lay-b" }));
  assert.equal(store.layouts.length, 2);
  assert.equal(store.lastId, "lay-b");
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(xr.includes('id: "ws-save-layout"'));
  assert.ok(xr.includes("Do not restore every saved window on enter"));
  assert.ok(xr.includes("hydrateXrLayouts"));
  assert.ok(xr.includes("applyNamedLayout"));
  assert.ok(!xr.includes("restoreOpenWindowsLayout();") || xr.includes("userPicked"));
});

test("Blocks-style corner join snaps a box onto an existing corner", () => {
  const existing = aabbCornersFromCenterSize(0, 1, 0, 0.2, 0.2, 0.2);
  const live = aabbCornersFromCenterSize(0.21, 1, 0, 0.2, 0.2, 0.2);
  const hit = nearestCornerJoin(live, existing, CORNER_JOIN_M);
  assert.ok(hit);
  assert.ok(hit.d <= CORNER_JOIN_M);
  const moved = translatePointByJoin({ x: 0.21, y: 1, z: 0 }, hit);
  assert.ok(Math.abs(moved.x - 0.2) < 1e-9);
  const far = nearestCornerJoin(
    aabbCornersFromCenterSize(2, 1, 0, 0.2, 0.2, 0.2),
    existing,
    CORNER_JOIN_M,
  );
  assert.equal(far, null);
  const extruded = extrudeAabbFace({ cx: 0, cy: 1, cz: 0, sx: 0.2, sy: 0.2, sz: 0.2 }, "x", 1, 0.25);
  assert.ok(Math.abs(extruded.sx - 0.35) < 1e-9);
  assert.ok(Math.abs(extruded.cx - 0.075) < 1e-9);
  const src = readFileSync(join(here, "xr-build-tools.js"), "utf8");
  assert.ok(src.includes("setSnapEnabled"));
  assert.ok(src.includes("snapPointWithJoin"));
});

test("drawing-hand UI ids follow the active tool; Snap lives on the A-wheel, not the left rail", () => {
  assert.deepEqual(toolHandUiIds("grab"), []);
  assert.ok(!toolHandUiIds("grab").includes("snap"));
  const draw = toolHandUiIds("draw");
  assert.ok(!draw.includes("snap"));
  assert.ok(draw.includes("pen"));
  assert.ok(draw.includes("color_06b6d4"));
  assert.ok(draw.includes("draw_size_m"));
  assert.ok(draw.includes("undo"));
  assert.ok(draw.includes("redo"));
  assert.equal(toolHandShowsCreateHistory("grab"), false);
  assert.ok(toolHandShowsCreateHistory("draw"));
  const box = toolHandUiIds("create_box");
  assert.deepEqual(box, ["box_face", "box_extrude", "box_corner", "box_move", "box_turn_left", "box_turn_right", "undo", "redo"]);
  const cyl = toolHandUiIds("create_cylinder");
  assert.ok(!cyl.includes("snap"));
  assert.ok(cyl.includes("prim_size"));
  assert.ok(cyl.includes("undo"));
  assert.ok(cyl.includes("redo"));
  assert.ok(toolHandUiIds("wall_height").includes("undo"));
  assert.equal(xrSnapControlHand("left"), "right");
  assert.equal(xrSnapControlHand("right"), "left");
  const rail = readFileSync(join(here, "xr-hand-palette.js"), "utf8");
  const snapOnRail = /railTools[\s\S]*id: "snap"/.test(rail);
  assert.equal(snapOnRail, false);
  const handUi = readFileSync(join(here, "xr-tool-hand.js"), "utf8");
  assert.ok(handUi.includes("export function createXrSnapControl"));
  assert.ok(handUi.includes("Snap on"));
  assert.ok(handUi.includes("Snap off"));
  assert.ok(!/addPuck\(group, \{ id: "snap"/.test(handUi));
  assert.ok(handUi.includes('id: "undo"'));
  assert.ok(handUi.includes('id: "redo"'));
  assert.ok(handUi.includes('label: "Undo"'));
  assert.ok(handUi.includes('label: "Redo"'));
  assert.ok(handUi.includes("setHistoryState"));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const menu = readFileSync(join(here, "xr-tool-menu.js"), "utf8");
  assert.equal(xr.includes("createXrSnapControl"), false);
  assert.equal(xr.includes("snapControlHost"), false);
  assert.ok(xr.includes("createXrToolHand"));
  assert.ok(xr.includes("setSnapEnabled"));
  assert.ok(xr.includes("toolWheel.setSnapOn"));
  assert.ok(menu.includes("setSnapOn"));
  assert.ok(menu.includes('id === "snap"'));
  const wheel = readFileSync(join(here, "xr-tool-wheel.js"), "utf8");
  assert.ok(wheel.includes('{ id: "snap", label: "Snap"'));
  assert.ok(wheel.includes("setSnapOn"));
  assert.ok(xr.includes("createXrCreateHistory"));
  assert.ok(xr.includes("undoXrCreate"));
  assert.ok(xr.includes("redoXrCreate"));
  assert.ok(xr.includes("recordXrCreate"));
  assert.ok(xr.includes("shouldRelayerOverlays"));
  assert.ok(xr.includes("shouldRebuildMenuHits"));
  assert.ok(xr.includes("skipTraverse"));
});

test("right-hand DRAW menu sits at the wrist, not in front of the controller", () => {
  const right = drawHandWristLocalOffset({ drawingIsRight: true });
  const left = drawHandWristLocalOffset({ drawingIsRight: false });
  assert.ok(right.z > 0.05, "wrist is behind the grip (+Z), not in front (-Z)");
  assert.ok(left.z > 0.05);
  assert.equal(right.rx, DRAW_HAND_FACE_RX);
  assert.ok(right.rx < -1.2 && right.rx > -1.8, "faces grip +Y toward the eyes, not the floor");
  assert.ok(left.rx < -1.2 && left.rx > -1.8);
  const bone = drawHandWristLocalOffset({ drawingIsRight: true, useWrist: true });
  assert.ok(bone.z > 0);
  assert.equal(bone.rx, DRAW_HAND_FACE_RX);
  assert.equal(shouldAttachDrawHandToAimController(), false);
  const handUi = readFileSync(join(here, "xr-tool-hand.js"), "utf8");
  assert.ok(handUi.includes("drawHandWristLocalOffset"));
  const attach = handUi.slice(handUi.indexOf("function attachTo"), handUi.indexOf("function pickFromHits"));
  assert.equal(attach.includes("-0.078"), false);
  assert.ok(attach.includes("off.z"));
  const hud = readFileSync(join(here, "xr-draw-hud.js"), "utf8");
  assert.ok(hud.includes("drawHandWristLocalOffset"));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(xr.includes("shouldAttachDrawHandToAimController"));
  assert.ok(xr.includes('getHandJoint(hand, "wrist")'));
});

test("Snap chip sits beside the grip, not in the aim laser", () => {
  const right = snapControlLocalOffset({ pointingIsRight: true });
  const left = snapControlLocalOffset({ pointingIsRight: false });
  assert.ok(right.z > 0, "snap +Z is toward the wrist, never in the -Z laser");
  assert.ok(left.z > 0);
  assert.equal(shouldAttachSnapControlToAimController(), false);
  assert.equal(uiPickBlocksGripGrab({ kind: "tool", tool: "snap" }), false);
  assert.equal(uiPickBlocksGripGrab({ kind: "tool", tool: "menu" }), false);
  assert.equal(uiPickBlocksGripGrab({ kind: "menu-chrome", source: "wrist" }), false);
  assert.equal(uiPickBlocksGripGrab({ kind: "menu-row" }), true);
  assert.equal(uiPickBlocksGripGrab({ kind: "robotics-action" }), true);
  assert.equal(sourceHasStudioFaceButtons({ gamepad: { buttons: [0, 1, 2, 3, 4] } }), true);
  assert.equal(sourceHasStudioFaceButtons({ gamepad: { buttons: [0] } }), false);
  const handUi = readFileSync(join(here, "xr-tool-hand.js"), "utf8");
  assert.ok(handUi.includes("snapControlLocalOffset"));
  assert.equal(handUi.includes("-0.054"), false);
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.equal(xr.includes("createXrSnapControl"), false);
  assert.ok(xr.includes("uiPickBlocksGripGrab"));
  assert.ok(xr.includes("sourceHasStudioFaceButtons"));
  const aHold = xr.slice(xr.indexOf("function pollAbButtons"), xr.indexOf("function restoreStarterControls"));
  assert.ok(aHold.includes("studioAHoldGamepadSources"));
  assert.ok(aHold.includes("shouldDismissToolOnBPress"));
  assert.ok(aHold.includes("restoreStarterControls()"));
  assert.equal(aHold.includes("isPhysicalControllerSource(source)"), false);
  const squeeze = xr.slice(xr.indexOf("function startStudioGrip"), xr.indexOf("function finishStudioGrip"));
  assert.equal(squeeze.includes("pickWithController"), false, "a distant wrist/menu ray must not block physical grip contact");
  assert.ok(squeeze.includes("tryBeginPanelGrip"));
  assert.equal(squeeze.includes("if (isUiPick(ui)) return"), false);
});

test("XR video record does not capture the framebuffer on the click tick", () => {
  assert.equal(shouldCaptureXrFramebufferOnSelectTick(), false);
  assert.equal(shouldBlitXrDomCanvasWhilePresenting({ presenting: true }), false);
  assert.equal(shouldBlitXrDomCanvasWhilePresenting({ presenting: false }), true);
  assert.ok(xrRecordStartDeferMs() >= 50);
  assert.equal(shouldOpenXrPassthroughCamera({
    presenting: true,
    passthroughOn: true,
    sessionMode: "immersive-ar",
  }), true);
  assert.equal(shouldOpenXrPassthroughCamera({ presenting: false, passthroughOn: true }), false);
  const rec = readFileSync(join(here, "../viewport/viewport-video-record.js"), "utf8");
  assert.ok(rec.includes("setTimeout"));
  assert.ok(rec.includes("shouldBlitXrDomCanvasWhilePresenting"));
  assert.ok(rec.includes("startXrPovCaptureStream"));
  assert.equal(rec.includes("renderer.xr.enabled = false"), false);
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const paint = xr.slice(xr.indexOf("function paintRecordOverlayCanvas"), xr.indexOf("function capturePovDataUrl"));
  assert.equal(paint.includes("xr.enabled"), false);
  assert.equal(paint.includes("readRenderTargetPixels"), false);
  assert.equal(paint.includes("toDataURL"), false);
  assert.ok(paint.includes("ensureRecordSpectator"));
  assert.ok(xr.includes("preserveDrawingBuffer: true"));
  assert.ok(xr.includes("ensureRecordSpectator"));
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const startRec = app.slice(app.indexOf("async function handleXrRecordAction"), app.indexOf("async function handleXrStreamAction"));
  assert.equal(startRec.includes("toDataURL"), false);
  assert.equal(startRec.includes("applyCadStyle"), false);
  const startStream = app.slice(app.indexOf("async function handleXrStreamAction"), app.indexOf("function openLaptopStreamStudio"));
  assert.equal(startStream.includes("toDataURL"), false);
  const shot = app.slice(app.indexOf("async function captureXrScreenshotForShare"), app.indexOf("async function flushPendingXrScreenshotShare"));
  assert.ok(shot.includes("xrRecordStartDeferMs"));
  assert.ok(shot.includes("setTimeout"));
  assert.ok(shot.includes("paintRecordOverlayCanvas"));
  assert.ok(shot.includes("still: true"));
  assert.ok(shot.includes("xrScreenshotMimeType"));
  assert.equal(shot.includes("image/jpeg"), false);
  assert.equal(xrSpectatorCaptureSize({ still: true }).w >= 1600, true);
  assert.equal(xrSpectatorCaptureSize({ framebufferWidth: 2880, framebufferHeight: 1440, still: true }).w >= 1440, true);
  assert.equal(xrScreenshotMimeType(), "image/png");
});

test("Stop and SC crescent hits win when they overlap the wrist grid", () => {
  const stop = preferCrescentDockHit([
    { distance: 0.10, object: { visible: true, userData: { xrTool: "draw" } } },
    { distance: 0.12, object: { visible: true, userData: { xrTool: "record_stop", xrCrescent: true } } },
  ]);
  assert.equal(stop.object.userData.xrTool, "record_stop");
  const sc = preferCrescentDockHit([
    { distance: 0.09, object: { visible: true, userData: { xrTool: "menu" } } },
    { distance: 0.11, object: { visible: true, userData: { xrTool: "screenshot", xrCrescent: true } } },
  ]);
  assert.equal(sc.object.userData.xrTool, "screenshot");
  assert.ok(CRESCENT_HIT_LOCAL_Z > 0.02);
  const rail = readFileSync(join(here, "xr-hand-palette.js"), "utf8");
  const hot = readFileSync(join(here, "xr-hot-path.js"), "utf8");
  assert.ok(hot.includes("CRESCENT_HIT_LOCAL_Z"));
  assert.ok(rail.includes("10160") || rail.includes("10150"));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(xr.includes("preferCrescentDockHit"));
});

test("XR create history undoes one step, redos it, and clears redo on a new create", () => {
  const hist = createXrCreateHistory({ max: 4 });
  assert.equal(hist.canUndo(), false);
  assert.equal(hist.canRedo(), false);
  hist.push({ type: "solid", kind: "box" });
  hist.push({ type: "stroke" });
  assert.equal(hist.undoCount(), 2);
  const a = hist.undo();
  assert.equal(a.type, "stroke");
  assert.equal(hist.canRedo(), true);
  const b = hist.redo();
  assert.equal(b.type, "stroke");
  hist.undo();
  hist.push({ type: "solid", kind: "sphere" });
  assert.equal(hist.canRedo(), false);
  assert.equal(hist.undo().kind, "sphere");
  const parked = parkXrObject({ visible: true, userData: { xrDrawable: true } }, true);
  assert.equal(parked.visible, false);
  assert.equal(parked.userData.xrParked, true);
  parkXrObject(parked, false);
  assert.equal(parked.visible, true);
});

test("headset boot Enter VR opens last project instead of a void session", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const boot = html.indexOf("if (headsetBoot)");
  const lastCopy = html.indexOf("Opening your last project.");
  const xrEnter = html.indexOf("function requestXrEnter");
  const pcNavXr = html.indexOf("navigator.xr");
  assert.ok(boot >= 0 && lastCopy > boot);
  assert.ok(html.includes("render3d:lastProjectId"));
  assert.ok(html.includes("__xrBootPreferredProjectId"));
  assert.ok(html.includes("emptyScene: !!tour || !lastId"));
  assert.ok(xrEnter > boot);
  assert.ok(app.includes("xrBootEnterPayload"));
  assert.ok(app.includes("prepareXrEnterLastProject"));
  assert.ok(app.includes("xrEnterNeedsDeferredOpen"));
  assert.ok(app.includes("isVrHeadsetBrowserUi()"));
  assert.ok(app.includes("__xrDeferredProjectId"));
  assert.ok(app.includes("__openDeferredXrProject"));
  assert.ok(app.includes("shouldOpenLastProjectOnXrEnterHotPath"));
  assert.match(app, /if \(shouldOpenLastProjectOnXrEnterHotPath\(\)\) \{\s*void Promise\.resolve\(\)\.then\(\(\) => openProjectById\(lastId\)\)/);
  assert.ok(app.includes("projectId: opts.projectId"));
  assert.equal(app.includes('emptyScene: true, openMenu: true, tour: !!opts.tour, fromBoot: true, projectId: ""'), false);
  assert.ok(xr.includes("flushDeferredXrProject"));
  assert.ok(xr.includes("tour || !projectId"));
  assert.ok(xr.includes("shouldUseWindowRafWhileXrPresenting"));
  assert.ok(app.includes("__xrBootPreferredProjectId"));
  assert.match(app, /viewport-xr\.js\?v=20260908-/);
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(app.includes("xrlastproj1"));
  assert.ok(html.includes("xrlastproj1"));
  assert.ok(app.includes("xrenter1"));
  assert.ok(html.includes("xrenter1"));
  assert.ok(xr.includes("__bootXrSessionPromise"));
  assert.ok(app.includes("revealViewportForXrEnter"));
  assert.ok(app.includes("xrEnterShouldNavigateToViewportHash"));
  const enterFn = html.slice(xrEnter, html.indexOf("function bindBootXrBtn"));
  assert.equal(/location\.hash\s*=/.test(enterFn), false);
  assert.equal(enterFn.includes("fab.click()"), false);
  assert.ok(enterFn.includes("startFromUserGesture({ fromBoot: true })"));
  assert.ok(enterFn.includes('requestSession(window.__bootXrSessionMode'));
  assert.equal(enterFn.includes("Studio is still loading"), false);
  assert.equal(html.includes("}, 90);"), false);
  assert.ok(xr.includes("pending.projectId"));
  assert.ok(xr.includes("tour || !projectId"));
  assert.ok(!xr.includes("emptyScene: true,\n      openMenu: true,\n      tour: !!opts.tour"));
  // PC Chrome WebXR is not a headset boot — Enter VR copy stays inside headsetBoot.
  assert.ok(pcNavXr < 0 || html.indexOf("headsetBoot") < pcNavXr || lastCopy < html.indexOf("navigator.xr.isSessionSupported"));
});

test("XR presenting hides TransformControls and solid-draw world handles", () => {
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const solid = readFileSync(join(here, "xr-solid-draw.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.ok(app.includes("function isXrObjectGizmoSuppressed()"));
  assert.ok(app.includes("renderer?.xr?.isPresenting"));
  assert.ok(app.includes("if (isXrObjectGizmoSuppressed())"));
  assert.ok(app.includes("if (!isXrObjectGizmoSuppressed()) {\n    showObjectGizmo(object, \"translate\", { switchTab: false });"));
  assert.ok(app.includes("cadSafeAttach"));
  assert.ok(xr.includes("xrSolidDraw.hideHandles?.()"));
  assert.equal(xr.includes("keepHandles"), false);
  assert.ok(xr.includes("transformControls.detach?.()"));
  assert.ok(xr.includes("helper.visible = false"));
  assert.ok(solid.includes("const SHOW_WORLD_HANDLES = false"));
  assert.ok(solid.includes("hideHandles();"));
  assert.ok(!/finish[\s\S]{0,900}layoutHandles\(lastBox\)/.test(solid));
  assert.ok(!/function begin[\s\S]{0,500}layoutHandles\(lastBox\)/.test(solid));
  assert.match(app, /viewport-xr\.js\?v=20260908-/);
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.match(html, /app\.js\?v=[^"\s]*20260908-/);
});

test("don/doff rebinds dock; Pass toggles cheap VR vs passthrough", () => {
  assert.equal(xrPassthroughShowsRealWorld({ passthroughOn: true, sessionIsPassthrough: true }), true);
  assert.equal(xrPassthroughShowsRealWorld({ passthroughOn: false, sessionIsPassthrough: true }), false);
  assert.equal(xrCheapVrStageVisible({ presenting: true, passthroughOn: false, sessionIsPassthrough: true }), true);
  assert.equal(xrCheapVrStageVisible({ presenting: true, passthroughOn: true, sessionIsPassthrough: true }), false);
  assert.equal(xrCheapVrStageVisible({ presenting: false, passthroughOn: false, sessionIsPassthrough: true }), false);
  assert.equal(shouldRebindXrDockHosts({ presenting: true, sessionBecameVisible: true }), true);
  assert.equal(shouldRebindXrDockHosts({ presenting: true, inputSourcesChanged: true }), true);
  assert.equal(shouldRebindXrDockHosts({ presenting: true, referenceSpaceRestored: true }), true);
  assert.equal(shouldRebindXrDockHosts({ presenting: false, sessionBecameVisible: true }), false);
  assert.equal(shouldKeepFrozenDockPose({ attachedLive: true, lastDockAt: 1, now: 50 }), false);
  assert.equal(shouldKeepFrozenDockPose({ attachedLive: false, lastDockAt: 100, now: 200, maxStaleMs: 400 }), true);
  assert.equal(shouldKeepFrozenDockPose({ attachedLive: false, lastDockAt: 100, now: 700, maxStaleMs: 400 }), false);
  assert.equal(shouldRequireDockSideCheck({ liveHandedness: "left", preferredHand: "left" }), false);
  assert.equal(shouldRequireDockSideCheck({ liveHandedness: "", preferredHand: "left" }), true);
  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const room = readFileSync(join(here, "xr-white-room.js"), "utf8");
  const palette = readFileSync(join(here, "xr-hand-palette.js"), "utf8");
  assert.ok(xr.includes("rebindXrInputHosts"));
  assert.ok(xr.includes("pollXrTrackingResume"));
  assert.ok(xr.includes("createXrCheapVrStage()"));
  assert.ok(xr.includes("createXrCheapWarehouseStage()"));
  assert.ok(!xr.includes("createXrWhiteRoom()"));
  assert.ok(xr.includes("xrPassthroughShowsRealWorld"));
  assert.ok(room.includes("createXrCheapVrStage"));
  assert.ok(room.includes("createXrCheapWarehouseStage"));
  assert.ok(!room.includes("canvas.width = 1024"));
  assert.ok(!room.includes("gridTexture"));
  assert.ok(!room.includes("MeshStandardMaterial"));
  assert.ok(!room.includes("MeshPhysicalMaterial"));
  assert.ok(palette.includes('"VR"') || palette.includes("Pass on") || palette.includes("iconOnly"));
  assert.equal(disposeParkedWrapGpuTextures({}), 0);
  assert.equal(disposeParkedWrapGpuFromObject({}), 0);
});

test("XR session graph shares xr-robotics1 cache-bust for hot-path and viewport", () => {
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const voice = readFileSync(join(here, "xr-voice.js"), "utf8");
  const presence = readFileSync(join(here, "xr-presence.js"), "utf8");
  const hand = readFileSync(join(here, "xr-tool-hand.js"), "utf8");
  const token = "roboticsworkspace3";
  assert.ok(/app\.js\?v=[^"\s]*20260908-xr-robotics1/.test(html));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(app.includes(`xr-hot-path.js?v=${token}`));
  assert.ok(xr.includes(`xr-hot-path.js?v=${token}`));
  assert.ok(voice.includes(`xr-hot-path.js?v=${token}`));
  assert.ok(presence.includes(`xr-hot-path.js?v=${token}`));
  assert.ok(hand.includes(`xr-hot-path.js?v=${token}`));
  for (const src of [html, app, xr, voice, presence, hand]) {
    assert.equal(src.includes("xr-hot-path.js?v=20260908-xr-clipb1"), false);
    assert.equal(src.includes("xr-hot-path.js?v=20260908-xr-see4"), false);
    assert.equal(src.includes("xr-hot-path.js?v=20260908-xr-fps2"), false);
    assert.equal(src.includes("xr-ai-compose.js?v=20260908-xr-kbui1"), false);
  }
  assert.ok(xr.includes("openSharedVideo"));
  assert.ok(xr.includes("restoreStarterControls"));
  assert.ok(xr.includes("openAiKeyboard"));
  assert.ok(xr.includes("shouldCheapMeshPick"));
  assert.ok(voice.includes("xrIceFetchInit"));
  assert.ok(voice.includes("setGpuBusy"));
  assert.ok(xr.includes("shouldRunXrVoiceIceWork"));
});

test("XR spawn uses last comfort size in front of the headset", () => {
  assert.equal(clampXrComfortSizeM(0.2), 0.2);
  assert.equal(clampXrComfortSizeM(9), 0.45);
  assert.equal(xrSpawnTargetM({ lastSizeM: 0.18, presetSizeM: 0.12 }), 0.18);
  assert.equal(xrSpawnTargetM({ presetSizeM: 0.12 }), 0.12);
  const store = {
    data: {},
    getItem(k) { return Object.prototype.hasOwnProperty.call(this.data, k) ? this.data[k] : null; },
    setItem(k, v) { this.data[k] = String(v); },
  };
  writeXrComfortSizeM(store, 0.16);
  assert.equal(readXrComfortSizeM(store), 0.16);
  writeXrVoicePrefs(store, { muted: true, wanted: true });
  assert.equal(readXrVoicePrefs(store).muted, true);
  assert.equal(readXrVoicePrefs(store).wanted, true);
  assert.equal(store.getItem(XR_VOICE_WANTED_KEY), "1");
  writeXrVoicePrefs(store, { muted: false });
  assert.equal(readXrVoicePrefs(store).muted, false);
  assert.ok(store.getItem(XR_VOICE_PREFS_KEY).includes("muted"));
  const pos = xrSpawnInFrontOfHead({ head: { x: 1, y: 1.6, z: 2 }, forward: { x: 0, y: 0, z: -1 }, distance: 0.55 });
  assert.equal(pos.x, 1);
  assert.ok(Math.abs(pos.z - (2 - 0.55)) < 1e-9);
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  assert.ok(xr.includes("xrSpawnInFrontOfHead"));
  assert.ok(xr.includes("xrSpawnTargetM"));
  assert.ok(app.includes("placeAfterProjectLoad"));
  assert.ok(XR_LAZY_HUD_PANEL_KINDS.includes("robotics"));
  assert.ok(WRIST_MENU_GRID_IDS.includes("robotics"));
  assert.ok(xr.includes('id: "robotics"'));
  assert.ok(xr.includes("toggleRoboticsPanel"));
  assert.ok(xr.includes("LS_XR_HUD_LOCKS") || xr.includes("isXrHudLocked"));
  assert.ok(xr.includes("window.setTimeout(run, 48)"));
});

test("B dismisses the tool, AI stays world-locked, trigger can hit HUD", () => {
  assert.equal(shouldDismissToolOnBPress({ alreadyPointer: false }), true);
  assert.equal(laserPointerModeOn({ bHeld: true, aimMode: false }), true);
  assert.equal(laserPointerModeOn({ bHeld: false, aimMode: true }), true);
  assert.equal(laserVisibleForAim(null, { force: true }), true);
  assert.ok(laserLengthForAim(null, { force: true }) > 0);
  assert.equal(laserVisibleForAim(null, { force: false }), false);
  assert.equal(pointerTipVisible({ presenting: true }), true);
  assert.equal(pointerTipVisible({ presenting: false }), false);
  assert.ok(pointerTipOffsetM() < 0.04);
  assert.equal(isXrUiHoverKind("robotics-action"), true);
  assert.equal(isXrUiHoverKind("mesh"), false);
  assert.equal(preferUiHoverHit({ kind: "mesh", distance: 0.2 }, { kind: "robotics-action", distance: 0.7 })?.kind, "robotics-action");
  assert.equal(preferUiHoverHit({ kind: "ai-action", distance: 0.5 }, null)?.kind, "ai-action");
  assert.ok(XR_WRIST_UI_EXCLUSIVE_M <= 0.16);
  assert.equal(wristUiHitIsExclusive({ kind: "tool", distance: 0.12 }), true);
  assert.equal(wristUiHitIsExclusive({ kind: "tool", distance: 0.22 }), false);
  assert.equal(wristUiHitIsExclusive({ kind: "menu-chrome", distance: 1.2 }), false);
  assert.equal(wristUiHitIsExclusive({ kind: "tool", distance: 1.2 }), false);
  assert.equal(wristUiHitIsExclusive({ kind: "tool", tool: "snap", distance: 0.12 }), false);
  assert.equal(snapLaserHitIsPoke({ kind: "tool", tool: "snap", distance: 0.04 }), true);
  assert.equal(snapLaserHitIsPoke({ kind: "tool", tool: "snap", distance: 0.4 }), false);
  const hud = { kind: "ai-action", distance: 0.55 };
  const dock = { kind: "tool", tool: "menu", distance: 1.1 };
  assert.equal(closerUiHit(dock, hud), hud);
  assert.equal(hudKindStaysWorldLocked("ai"), true);
  assert.equal(hudKindStaysWorldLocked("settings"), false);
  assert.equal(shouldSkipXrHudPanelPick({ tool: "draw", drawing: true, laserAim: true }), false);

  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const ab = xr.slice(xr.indexOf("function pollAbButtons"), xr.indexOf("function laserPointerActive"));
  assert.ok(ab.includes("shouldDismissToolOnBPress"));
  assert.ok(ab.includes("restoreStarterControls()"));
  const restore = xr.slice(xr.indexOf("function restoreStarterControls"), xr.indexOf("function bumpToolHandHistory"));
  assert.ok(restore.includes("laserAimMode = true"));
  assert.ok(restore.includes("toolHand.setVisible?.(false)"));
  assert.ok(xr.includes("xrPointerStyle"));
  assert.ok(xr.includes("hudKindStaysWorldLocked"));
  const follow = xr.slice(xr.indexOf("function followUnlockedHudPanels"), xr.indexOf("function hitIsUiPanel"));
  assert.ok(follow.includes("hudKindStaysWorldLocked"));
  assert.ok(follow.includes("laserAim: laserPointerActive()"));
  const openAi = xr.slice(xr.indexOf("function openAiPromptPanel"), xr.indexOf("function closeAiPromptPanel"));
  assert.ok(openAi.includes("xrHudParked = true"));
  assert.ok(openAi.includes("ensureHudWorldParent"));
  assert.equal(openAi.includes("camera.add"), false);
  assert.ok(xr.includes("xrHud.add(aiPanel.group)"));
  const firstUi = xr.slice(xr.indexOf("function firstUiPointer"), xr.indexOf("function controllerAimRay"));
  assert.ok(firstUi.includes("firstUiPointerMayUseOtherHand()"));
  const selectHead = xr.slice(xr.indexOf("function handleSelect"), xr.indexOf("function handleSelect") + 2200);
  assert.ok(selectHead.includes("pickControllerSelectHit"));
  assert.ok(!selectHead.includes("firstUiPointer"), "only the triggering hand's ray may choose a target");
  assert.ok(selectHead.includes("isUiPick(hit)"));
  assert.ok(selectHead.includes("xrSelectDebounceBlocks"));
  assert.ok(selectHead.includes("windowMs: 180"));
  assert.ok(selectHead.includes("noteSelectConsume"));
  assert.equal(selectHead.includes("if (now - lastSelectAt < 180) return"), false);
  const poll = xr.slice(xr.indexOf("function pollGamepads"), xr.indexOf("function gamepadFacePressed"));
  assert.ok(poll.includes("pickControllerSelectHit(laser || pointer)"));
  assert.ok(poll.includes("handleSelect(laser || pointer)"));
  assert.ok(poll.includes("applySessionTriggerPoll"));
  assert.ok(poll.includes("shouldPollStudioFaceButtons"));
  assert.ok(xr.includes("atrig1") || xr.includes("blaser1") || xr.includes("keymap1-vrstudio1"));
});

test("Quest trigger poll, A-wheel after tool, HUD backing store", () => {
  assert.equal(xrGamepadTriggerPressed({ buttons: [{ pressed: true }] }), true);
  assert.equal(xrGamepadTriggerPressed({ buttons: [{ pressed: false, value: 0.9 }] }), false);
  assert.equal(xrGamepadTriggerPressed({ buttons: [{ pressed: false, value: 0.1 }] }), false);
  assert.equal(xrGamepadTriggerPressed({ buttons: [{ pressed: false, value: 0.35 }] }), false);
  assert.equal(xrSelectDebounceBlocks({ hasHit: false, elapsedMs: 10 }), false);
  assert.equal(xrSelectDebounceBlocks({ hasHit: true, elapsedMs: 50 }), true);
  assert.equal(xrSelectDebounceBlocks({ hasHit: true, elapsedMs: 200 }), false);
  assert.equal(selectStartShouldCommit({ isUi: false }), false);
  assert.equal(selectStartShouldCommit({ isUi: true }), true);
  assert.equal(firstUiPointerMayUseOtherHand(), false);
  assert.equal(shouldPollStudioFaceButtons(), true);
  const gp = { buttons: [0, 1, 2, 3, 4, 5] };
  const srcs = studioAHoldGamepadSources([
    { handedness: "left", gamepad: gp },
    { handedness: "right", gamepad: gp },
  ]);
  assert.equal(srcs.length, 1);
  assert.equal(srcs[0].handedness, "right");
  const unlabeled = studioAHoldGamepadSources([{ handedness: "", gamepad: gp }]);
  assert.equal(unlabeled.length, 1);
  assert.deepEqual(applySessionTriggerPoll([false, false], [
    { handedness: "right", gamepad: { buttons: [{ pressed: true }] } },
  ]), [false, true]);
  assert.deepEqual(applySessionTriggerPoll([false, false], [
    { handedness: "", gamepad: { buttons: [{ pressed: true }] } },
  ]), [false, true]);
  assert.equal(xrSourceHandIndex({ handedness: "" }, { hasLeft: true, hasRight: false }), 1);
  assert.equal(xrSourceHandIndex({ handedness: "right" }), 1);
  assert.equal(wheelDismissLockActive({ aPressed: false, dismissedThisHold: true }), false);
  assert.equal(wheelDismissLockActive({ aPressed: true, dismissedThisHold: true }), true);
  assert.equal(xrHudCanvasScale({ dpr: 1 }), 2.2);
  assert.equal(xrHudCanvasBackingSize(1024, 720, 2).width, 2048);
  assert.equal(xrHudTextureOpts().minFilter, "LinearFilter");
  assert.equal(xrHudTextureOpts().generateMipmaps, false);
  assert.equal(shouldSkipXrHudPanelPick({ drawing: true, tool: "draw" }), false);

  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const menu = readFileSync(join(here, "xr-tool-menu.js"), "utf8");
  const pres = readFileSync(join(here, "xr-presentation.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.ok(xr.includes("bindHudCanvas2d"));
  assert.ok(xr.includes("xrHudCanvasScale"));
  assert.ok(xr.includes("applySessionTriggerPoll"));
  assert.ok(xr.includes("applySessionSqueezePoll"));
  assert.ok(xr.includes("studioAHoldGamepadSources"));
  assert.ok(xr.includes("if (!a) wheelDismissedThisHold = false"));
  assert.ok(xr.includes("selectStartShouldCommit"));
  assert.ok(xr.includes('addEventListener("select"'));
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.ok(xr.includes("atrig1"));
  assert.ok(app.includes("atrig1"));
  assert.ok(html.includes("atrig1"));
  assert.ok(menu.includes("256"));
  assert.ok(menu.includes("sharpTexture"));
  assert.equal(pres.includes("LinearMipmapLinearFilter"), false);
  assert.ok(pres.includes("generateMipmaps = false"));
  const ab = xr.slice(xr.indexOf("function pollAbButtons"), xr.indexOf("function laserPointerActive"));
  assert.ok(ab.includes("shouldRunStudioAHold({ armed: stealDimos })"));
  const setup = xr.slice(xr.indexOf("function setupControllers"), xr.indexOf("function sourceHandedness"));
  const bindSel = xr.slice(xr.indexOf("function bindSelectOn"), xr.indexOf("function setupControllers"));
  assert.ok(bindSel.includes("selectstart"));
  assert.ok(bindSel.includes("studioSelectEventAllowed(e.data || e.target?.userData?.inputSource, { start: true })"));
  assert.ok(bindSel.includes('addEventListener("select"'));
  assert.ok(setup.includes("bindSelectOn(controller)"));
  assert.ok(setup.includes("bindSelectOn(grip)"));
  assert.ok(xr.includes("selectHitFromAimOrGrip"));
  assert.ok(xr.includes("resolveSelectAim"));
  const selectGate = xr.slice(xr.indexOf("function studioSelectEventAllowed"), xr.indexOf("function onSessionSelectStart"));
  assert.ok(selectGate.includes("xrGamepadTriggerPressed(source?.gamepad)"));
  assert.ok(xr.includes("studioSelectEventAllowed(ev?.inputSource, { start: true })"));
});

test("right trigger click path uses posed aim or grip", () => {
  const pointer = { id: "aim" };
  const grip = { id: "grip" };
  assert.equal(resolveSelectAim({ pointer, grip, pointerPosed: true, gripPosed: true }), pointer);
  assert.equal(resolveSelectAim({ pointer, grip, pointerPosed: false, gripPosed: true }), grip);
  assert.equal(resolveSelectAim({ pointer, grip, pointerPosed: false, gripPosed: false }), null);
  assert.equal(selectHitFromAimOrGrip({
    aimHit: { kind: "mesh", distance: 0.2 },
    gripHit: { kind: "menu-tab", distance: 0.1 },
  })?.kind, "menu-tab");
  assert.equal(selectHitFromAimOrGrip({
    aimHit: { kind: "mesh", distance: 0.2 },
    gripHit: { kind: "mesh", distance: 0.4 },
  })?.kind, "mesh");
  assert.equal(selectHitFromAimOrGrip({
    aimHit: { kind: "robotics-action", id: "enable" },
    gripHit: { kind: "mesh" },
  })?.id, "enable");
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const bindSel = xr.slice(xr.indexOf("function bindSelectOn"), xr.indexOf("function setupControllers"));
  assert.ok(bindSel.includes("pickWithController(pointer)"));
  assert.ok(bindSel.includes("pickWithController(grip)"));
  assert.ok(bindSel.includes("selectStartShouldCommit"));
  const handle = xr.slice(xr.indexOf("function handleSelect"), xr.indexOf("function handleSelect") + 1600);
  assert.ok(handle.includes("pickControllerSelectHit"));
  assert.ok(handle.includes("getRightGrip"));
});

test("controller model hides only while occluding world UI", () => {
  assert.equal(controllerModelHiddenForUi({ occludes: true }), false);
  assert.equal(controllerModelHiddenForUi({ occludes: false }), false);
  assert.equal(controllerOccludesWorldUi({
    point: { x: 0, y: 1.4, z: -0.6 },
    menus: [{ minX: -0.2, maxX: 0.2, minY: 1.2, maxY: 1.6, minZ: -0.7, maxZ: -0.5 }],
  }), true);
  assert.equal(controllerOccludesWorldUi({
    tip: { x: 3, y: 0, z: 3 },
    menus: [{ minX: -0.2, maxX: 0.2, minY: 1.2, maxY: 1.6, minZ: -0.7, maxZ: -0.5 }],
  }), false);
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  assert.ok(xr.includes("updateControllerUiOcclusion"));
  assert.ok(xr.includes("styleControllerModelsInFront"));
  assert.ok(xr.includes("styleXrControllerOverlayMesh"));
  assert.ok(xr.includes("controllerModelHiddenForUi"));
  assert.ok(xr.includes("getRightGrip"));
});

test("Menu-aim tip, UI pick wins over draw, robotics kinds", () => {
  assert.equal(shouldUseMenuAimTip({ nearMenu: true, uiHit: true, tool: "draw" }), true);
  assert.equal(shouldUseMenuAimTip({ nearMenu: false, uiHit: true, tool: "create_box" }), true);
  assert.equal(shouldUseMenuAimTip({ nearMenu: true, uiHit: false, tool: "draw" }), false);
  assert.equal(shouldUseMenuAimTip({ nearMenu: false, uiHit: false, tool: "create_cylinder" }), false);
  assert.equal(menuAimTipKind("create_box"), "cube");
  assert.equal(menuAimTipKind("create_cylinder"), "cylinder");
  assert.equal(menuAimTipKind("create_sphere"), "sphere");
  assert.equal(menuAimTipKind("draw"), "cylinder");
  assert.ok(XR_MENU_AIM_NEAR_M >= 0.8 && XR_MENU_AIM_NEAR_M <= 1.2);
  assert.equal(controllerIsNearMenu({ x: 0, y: 0, z: 0 }, { x: 0.4, y: 0, z: 0 }), true);
  assert.equal(controllerIsNearMenu({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }), false);
  assert.equal(xrUiPickBlocksDraw({ kind: "robotics-action" }), true);
  assert.equal(xrUiPickBlocksDraw({ kind: "menu-tab" }), true);
  assert.equal(xrUiPickBlocksDraw({ kind: "mesh" }), false);
  assert.equal(xrUiPickBlocksDraw(null), false);
  assert.equal(shouldSkipWorldUiPick({ drawing: true, uiHit: true, tool: "draw" }), false);
  assert.equal(isXrWorldMenuHoverKind("robotics-action"), true);
  assert.equal(isXrWorldMenuHoverKind("tool"), false);
  assert.equal(wristYieldsToWorldMenu({
    wristHit: { kind: "tool", tool: "menu", distance: 0.22 },
    worldHit: { kind: "robotics-action", id: "enable", distance: 0.7 },
    nearMenu: true,
  }), false);
  assert.equal(wristYieldsToWorldMenu({
    wristHit: { kind: "tool", distance: 0.5 },
    worldHit: { kind: "ai-action", distance: 0.8 },
    nearMenu: false,
  }), false);
  assert.equal(preferUiHoverHit(
    { kind: "tool", tool: "menu", distance: 0.12 },
    { kind: "robotics-action", id: "enable", distance: 0.7 },
  )?.tool, "menu");

  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const poll = xr.slice(xr.indexOf("function pollGamepads"), xr.indexOf("function gamepadFacePressed"));
  const voice = xr.slice(xr.indexOf("function sampleVoiceDraw"), xr.indexOf("function openPlacePanel"));
  const solid = xr.slice(xr.indexOf("function sampleSolidDraw"), xr.indexOf("function updateGripGrab"));
  assert.ok(poll.includes("xrUiPickBlocksDraw"));
  assert.ok(poll.includes("handleSelect"));
  assert.ok(voice.includes("xrUiPickBlocksDraw"));
  assert.ok(solid.includes("xrUiPickBlocksDraw"));
  assert.ok(xr.includes("isRoboticsHudKind"));
  assert.ok(xr.includes("handleRoboticsAction"));
  assert.ok(xr.includes("mapRoboticsHitMeshes"));
  assert.ok(xr.includes("shouldUseMenuAimTip"));
  assert.ok(xr.includes("menuAimTipKind"));
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(xr.includes("roboticsworkspace3"));
});

test("Quest interaction: A-wheel Snap, tip-not-laser, window grip, robotics hover", () => {
  assert.equal(shouldSkipXrHudPanelPick({ drawing: true, tool: "draw" }), false);
  assert.equal(isXrUiHoverKind("robotics-action"), true);
  assert.equal(isXrUiHoverKind("menu-chrome"), true);
  assert.equal(preferUiHoverHit(
    { kind: "mesh", distance: 0.15 },
    { kind: "robotics-action", id: "enable", distance: 0.6 },
  )?.id, "enable");
  assert.equal(laserVisibleForHit({ kind: "robotics-action" }), true);
  assert.ok(laserLengthForAim(null, { force: true }) > 0);
  assert.ok(pointerTipOffsetM() <= 0.02);

  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const menu = readFileSync(join(here, "xr-tool-menu.js"), "utf8");
  const rail = readFileSync(join(here, "xr-hand-palette.js"), "utf8");
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.equal(xr.includes("createXrSnapControl"), false);
  assert.ok(xr.includes("toolWheel.setSnapOn"));
  assert.ok(menu.includes("setSnapOn"));
  assert.equal(/railTools[\s\S]*id: "snap"/.test(rail), false);
  const grip = xr.slice(xr.indexOf("function tryBeginPanelGrip"), xr.indexOf("function startGripGrabOn"));
  assert.ok(grip.includes("nearGripPanel"));
  assert.equal(grip.includes("lastPointerHoverHit"), false);
  assert.ok(grip.includes("panelGripTranslateOnly"));
  const begin = xr.slice(xr.indexOf("function beginPanelDrag"), xr.indexOf("function updatePanelDrag"));
  assert.ok(begin.includes("posedAim"));
  assert.ok(xr.includes("handleRoboticsAction"));
  assert.ok(xr.includes("pickRoboticsHud"));
  assert.ok(xr.includes("paintWorldUiHover"));
  assert.ok(xr.includes("lastPointerHoverHit"));
  const rays = xr.slice(xr.indexOf("function updateControllerRays"), xr.indexOf("function updateWristMenu"));
  assert.ok(rays.includes("controller.visible = true"));
  assert.ok(rays.includes("style.visible"));
  assert.ok(rays.includes("style.distance"));
});

test("XR vis1: pointer while presenting, measure on first wheel page, wrap revive no dispose", () => {
  assert.equal(pointerVisibleWhilePresenting({ presenting: true }), true);
  assert.equal(pointerVisibleWhilePresenting({ presenting: false }), false);
  assert.equal(pointerTipVisible({ presenting: true }), true);
  assert.equal(pointerTipVisible({ presenting: true, useRay: false }), false);
  assert.equal(shouldOrbitGrabbedModel({ gripping: true, triggerHeld: true }), true);
  assert.equal(shouldOrbitGrabbedModel({ gripping: true, triggerHeld: false }), true);
  assert.equal(shouldOrbitGrabbedModel({ gripping: false, triggerHeld: true }), false);
  assert.equal(gripHoldIsTranslateOnly({ triggerHeld: false }), false);
  assert.equal(gripHoldIsTranslateOnly({ triggerHeld: true }), false);
  assert.equal(wrapReviveDisposesParkedMaps(), false);
  assert.equal(wheelPageHasMeasure(["measure", "ai", "draw"]), true);
  assert.equal(wheelPageHasMeasure(["ai", "draw"]), false);

  const bak = { map: { image: { w: 4 }, dispose() { throw new Error("disposed"); } }, color: { r: 0.2, g: 0.4, b: 0.8 } };
  const mesh = { isMesh: true, material: { color: { r: 0.8, g: 0.8, b: 0.8 } }, userData: { _xrMatBak: bak } };
  const root = { traverse(fn) { fn(mesh); } };
  assert.equal(reviveXrParkedMaterials(root), 1);
  assert.equal(mesh.material, bak);
  assert.equal(bak.map.image.w, 4);

  const box = { isBoxHelper: true, type: "BoxHelper", userData: {}, visible: true, children: [] };
  assert.equal(isXrSelectionAabb(box), true);
  assert.equal(isXrSelectionAabb({ isMesh: true, userData: {} }), false);
  const scene = { children: [box], visible: true };
  box.parent = scene;
  scene.children = [box];
  const hidden = hideXrSelectionAabbs({ children: [box], userData: {} }, { max: 16, depth: 2 });
  assert.ok(hidden >= 1);
  assert.equal(box.visible, false);

  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const menu = readFileSync(join(here, "xr-tool-menu.js"), "utf8");
  const wheel = readFileSync(join(here, "xr-tool-wheel.js"), "utf8");
  const style = readFileSync(join(here, "../viewport/scene-style.js"), "utf8");
  const vis = "20260909-xr-vis1";
  assert.ok(html.includes(`app.js?v=`) && html.includes(vis));
  assert.ok(app.includes(`viewport-xr.js?v=`) && app.includes(vis));
  assert.ok(app.includes(vis));
  assert.ok(xr.includes(vis));
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(/WHEEL_INNER = \[[\s\S]*id: "measure"/.test(wheel));
  assert.ok(menu.includes('Tools: ["measure"'));
  assert.ok(menu.includes("wheelFirstPageHasMeasure"));
  assert.ok(menu.includes('id === "snap"'));
  assert.ok(xr.includes("pointerVisibleWhilePresenting"));
  assert.ok(xr.includes("shouldOrbitGrabbedModel"));
  assert.ok(xr.includes("reviveXrParkedMaterials"));
  assert.ok(xr.includes("c.visible = presenting"));
  assert.equal(xr.includes("c.visible = presenting && physical"), false);
  assert.ok(xr.includes("isHandsOnlySource(src)"));
  const gripFn = xr.slice(xr.indexOf("function updateGripGrab"), xr.indexOf("function updateGrab"));
  assert.ok(gripFn.includes("offsetQuat"));
  assert.equal(gripFn.includes("holdQuat"), false);
  const poll = xr.slice(xr.indexOf("function pollGamepads"), xr.indexOf("function gamepadFacePressed"));
  assert.ok(poll.includes("gripGrab.hand === handIndex"));
  assert.ok(style.includes("reviveXrParkedMaterials"));
  assert.ok(!style.includes("texture.dispose()"));
  assert.ok(app.includes("hideXrSelectionAabbs"));
  assert.ok(xr.includes("hideXrSelectionAabbs"));
});

test("vrctrl1: trigger session select, single grip, select stub, tight wrist, live dock hits", () => {
  assert.equal(controllerModelHiddenForUi({ occludes: true }), false);
  assert.equal(selectToolShowsPointer("grab"), true);
  assert.equal(selectToolShowsPointer("select"), true);
  assert.equal(selectToolShowsPointer("draw"), false);
  assert.equal(sessionSelectEventShouldClick({ hasSource: true }), true);
  assert.equal(sessionSelectEventShouldClick({ hasSource: false }), false);
  assert.ok(XR_CONTROLLER_OVER_UI_ORDER >= 20000);
  assert.ok(XR_LASER_OVER_UI_ORDER > XR_CONTROLLER_OVER_UI_ORDER);
  assert.equal(xrMeshIsWristOrHudUi({ userData: { xrTool: "menu" } }), true);
  assert.equal(xrMeshIsWristOrHudUi({ name: "xrWristBand", userData: {} }), true);
  assert.equal(styleXrControllerOverlayMesh({ isMesh: true, name: "xrWristBand", userData: { xrUi: "chrome" }, material: {} }), false);
  const mesh = { isMesh: true, name: "Touch", renderOrder: 0, frustumCulled: true, userData: {}, material: { depthTest: true, transparent: false, depthWrite: true } };
  assert.equal(styleXrControllerOverlayMesh(mesh), true);
  assert.ok(mesh.renderOrder >= XR_CONTROLLER_OVER_UI_ORDER);
  assert.equal(mesh.material.depthTest, true, "Touch GLB keeps depth; do not flatten to a white overlay");
  assert.equal(mesh.userData.xrControllerOverlayStyled, true);
  mesh.material.depthTest = true;
  assert.equal(styleXrControllerOverlayMesh(mesh), true);
  assert.equal(mesh.material.depthTest, true, "do not restyle overlay materials every frame");
  assert.equal(styleXrControllerOverlayMesh({ isMesh: true, name: "xrRay" }), false);
  assert.equal(xrUiHitObjectIsLive({ object: { visible: true, userData: {} } }), true);
  assert.equal(xrUiHitObjectIsLive({ object: { visible: false, userData: { xrTool: "screenshot" } } }), false);
  assert.equal(xrUiHitObjectIsLive({ object: { visible: true, userData: { xrRaycast: false } } }), false);
  assert.equal(uiPickBlocksGripGrab({ kind: "tool", tool: "menu" }), false);
  assert.equal(uiPickBlocksGripGrab({ kind: "robotics-chrome" }), true);
  assert.equal(uiPickBlocksGripGrab({ kind: "menu-chrome", source: "wrist" }), false);

  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const rail = readFileSync(join(here, "xr-hand-palette.js"), "utf8");
  const token = "20260909-vrctrl1";
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(xr.includes("onSessionSelectStart"));
  assert.ok(xr.includes('session.addEventListener("selectstart"'));
  assert.ok(xr.includes("xrUiHitObjectIsLive"));
  assert.ok(xr.includes("selectPointerLengthM"));
  assert.ok(xr.includes("selectToolShowsPointer"));
  assert.ok(xr.includes("xrPointerStyle"));
  assert.ok(xr.includes("hit.source === \"wrist\""));
  assert.ok(xr.includes("gripScaleContact"));
  assert.ok(rail.includes("WRIST_PLATE_PAD_M"));
  assert.ok(rail.includes("WRIST_PLATE_BORDER_EXTRA_M"));
  assert.equal(rail.includes("RAIL_X + TILE / 2 + 0.04 + pad"), false);
  const gripFn = xr.slice(xr.indexOf("function updateGripGrab"), xr.indexOf("function updateGrab"));
  assert.ok(gripFn.includes("gripGrab.hand"));
  assert.ok(gripFn.includes("if (scaleGrab) return"));
  const rays = xr.slice(xr.indexOf("function updateControllerRays"), xr.indexOf("function worldMenuAabbs"));
  assert.ok(rays.includes("style.distance"));
  assert.ok(xr.includes("styleControllerModelsInFront"));
});

test("xraim1: posed aim + menu AABB laser + DimOS does not steal menu trigger", () => {
  const pointer = { id: "ray" };
  const grip = { id: "grip" };
  const hand = { id: "hand" };
  assert.equal(resolvePosedAim({
    pointer, grip, hand, pointerPosed: false, gripPosed: true, handPosed: true, physical: true,
  }), grip);
  assert.equal(resolvePosedAim({
    pointer, grip, hand, pointerPosed: true, gripPosed: true, physical: true,
  }), pointer);
  assert.equal(resolvePosedAim({
    pointer, grip, hand, pointerPosed: false, gripPosed: false, handPosed: true, physical: false,
  }), hand);
  assert.equal(resolvePosedAim({
    pointer, grip, hand, pointerPosed: false, gripPosed: false, handPosed: false, physical: true,
  }), null);
  const box = { minX: -0.2, maxX: 0.2, minY: 1.2, maxY: 1.6, minZ: -0.8, maxZ: -0.5 };
  const hit = rayHitsAabb({ x: 0, y: 1.4, z: 0 }, { x: 0, y: 0, z: -1 }, box, 3);
  assert.ok(hit && hit.distance > 0.4 && hit.distance < 0.9);
  assert.equal(rayHitsAabb({ x: 3, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, box), null);
  assert.ok(menuLaserRadiusM({ uiHit: true }) > menuLaserRadiusM({ uiHit: false }));
  const obj = { position: { set() {} }, quaternion: { set() {} }, scale: { set() {} }, updateMatrix() {}, updateMatrixWorld() {} };
  let px = 0;
  obj.position.set = (x) => { px = x; };
  obj.quaternion.set = () => {};
  obj.scale.set = () => {};
  assert.equal(applyXrSpacePoseToObject(obj, { position: { x: 0.4, y: 1.2, z: -0.3 }, orientation: { x: 0, y: 0, z: 0, w: 1 } }), true);
  assert.equal(px, 0.4);
  assert.equal(studioUiOverridesDimosSelect({ rayOnMenu: true }), true);
  assert.equal(dimosShouldForwardSelect({ rayOnMenu: true }), false);
  assert.equal(dimosShouldForwardSelect({ uiHit: false, nearMenu: false, rayOnMenu: false }), true);
  assert.equal(shouldUseMenuAimTip({ rayOnMenu: true, uiHit: false }), true);
  assert.equal(shouldUseMenuAimTip({ nearMenu: true, uiHit: false }), false);

  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const token = "20260909-xraim1";
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(xr.includes("syncControllerAimFromXrFrame"));
  assert.ok(xr.includes("resolvePosedAim"));
  assert.ok(xr.includes("menuHitFromAabb"));
  assert.ok(xr.includes("rayOnMenu"));
  assert.ok(xr.includes("menuLaserRadiusM"));
  assert.ok(xr.includes("bindSelectOn(controller)"));
  assert.ok(xr.includes("bindSelectOn(grip)"));
  assert.ok(xr.includes("ws-refs"));
  assert.ok(xr.includes("openWorkspaceReferenceFile"));
  assert.ok(xr.includes("share-video-hide"));
  assert.ok(xr.includes("share-video-curve"));
  assert.ok(xr.includes("share-video-anchor"));
  assert.ok(xr.includes("share-video-resize"));
  const rail = readFileSync(join(here, "xr-hand-palette.js"), "utf8");
  assert.ok(rail.includes("render-logo-gear-still.png"));
  assert.ok(rail.includes("paintWristPlateTexture"));
  assert.ok(rail.includes("WRIST_PLATE_BORDER_EXTRA_M"));
  assert.ok(rail.includes("wristPlateCanvasSize"));
});

test("rtrig2: unlabeled right trigger is not swallowed after handedness drop", () => {
  const touch = { buttons: [{ pressed: true }, {}, {}, {}, {}, {}] };
  const handOnly = { buttons: [{ pressed: false }], mapping: "" };
  // Prior swallow: labeled right HAND + unlabeled Touch → xrSourceHandIndex fallback -1
  assert.equal(xrSourceHandIndex({ handedness: "" }, { hasLeft: true, hasRight: true, fallback: -1 }), -1);
  assert.equal(xrSourceLooksLikeTouchPad({ handedness: "right", gamepad: handOnly, hand: {} }), false);
  assert.equal(xrSourceLooksLikeTouchPad({ handedness: "", gamepad: touch }), true);
  assert.equal(unlabeledTriggerHandIndex({
    hasLabeledPhysicalLeft: true,
    hasLabeledPhysicalRight: false,
  }), 1);
  assert.deepEqual(applySessionTriggerPoll([false, false], [
    { handedness: "left", gamepad: { buttons: [{ pressed: false }, {}, {}, {}, {}] } },
    { handedness: "right", gamepad: handOnly, hand: {} },
    { handedness: "", gamepad: touch },
  ]), [false, true]);
  assert.deepEqual(applySessionTriggerPoll([false, false], [
    { handedness: "left", gamepad: { buttons: [{ pressed: false }, {}, {}, {}, {}] } },
    { handedness: "", gamepad: touch },
  ]), [false, true]);
  assert.equal(xrGamepadSqueezePressed({ buttons: [{}, { pressed: true }] }), true);
  assert.equal(xrGamepadSqueezePressed({ buttons: [{}, { pressed: false, value: 0.9 }] }), false);
  assert.deepEqual(applySessionSqueezePoll([false, false], [
    { handedness: "left", gamepad: { buttons: [{}, { pressed: false }, {}, {}, {}] } },
    { handedness: "", gamepad: { buttons: [{}, { pressed: true }, {}, {}, {}] } },
  ]), [false, true]);

  assert.equal(stickyXrHandedness("", "right"), "right");
  assert.equal(stickyXrHandedness("left", "right"), "left");
  assert.equal(stickyXrHandedness("", ""), "");

  const fallback = { id: "stamped-right" };
  assert.equal(xrPollSelectPointer({ triggerPressed: true, aim: null, gripPosed: false }), null);
  assert.equal(xrTriggerRayMiss({ triggerPressed: true, wasPressed: false, pointer: null }), true);
  assert.equal(xrTriggerRayMiss({ triggerPressed: true, wasPressed: false, pointer: { id: "ray" } }), false);
  assert.equal(xrTriggerRayMiss({ triggerPressed: true, wasPressed: true, pointer: null }), false);
  assert.equal(xrTriggerRayMiss({ triggerPressed: false, wasPressed: false, pointer: null }), false);
  assert.equal(xrPollSelectPointer({
    triggerPressed: true,
    aim: null,
    gripPosed: false,
    fallback,
  }), fallback);
  assert.equal(xrPollSelectPointer({
    triggerPressed: true,
    aim: { id: "aim" },
    aimPosed: true,
    gripPosed: true,
    grip: { id: "grip" },
    fallback,
  })?.id, "aim");
  assert.equal(xrPollSelectPointer({
    triggerPressed: true,
    aim: { id: "origin-aim" },
    aimPosed: false,
    gripPosed: false,
    fallback,
  }), fallback);
  assert.equal(xrPollSelectPointer({
    triggerPressed: true,
    aim: { id: "origin-aim" },
    aimPosed: false,
    gripPosed: true,
    grip: { id: "grip" },
    fallback,
  })?.id, "grip");

  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const poll = xr.slice(xr.indexOf("function pollGamepads"), xr.indexOf("function gamepadFacePressed"));
  const bind = xr.slice(xr.indexOf("function bindHandednessFromSession"), xr.indexOf("function getLeftHand"));
  assert.ok(poll.includes("xrPollSelectPointer"));
  assert.ok(xr.includes("xrTriggerRayMiss"));
  assert.ok(xr.includes("controller.trigger.miss"));
  assert.ok(poll.includes("aimPosed"));
  assert.ok(poll.includes("fallbackSelectPointer"));
  assert.ok(html.includes("xrctl1"));
  assert.ok(app.includes("xrctl1"));
  assert.ok(xr.includes("xrctl1"));
  assert.ok(poll.includes("applySessionSqueezePoll"));
  assert.ok(xr.includes("function fallbackSelectPointer"));
  assert.ok(bind.includes("stickyXrHandedness"));
  assert.ok(xr.includes("rtrig2"));
  assert.ok(app.includes("rtrig2"));
  assert.ok(html.includes("rtrig2"));
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(xr.includes("XR_LASER_OVER_UI_ORDER"));
  assert.ok(xr.includes("isDockOrHudDescendant"));
  assert.ok(xr.includes("ensureControllerFallback"));
  assert.ok(xr.includes("restoreControllerMaterial"));
  assert.ok(xr.includes("scheduleXrEnterCanvas"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(html.includes("loadquiet1"));
  assert.ok(html.includes("xrlastproj1"));
  assert.ok(app.includes("xrlastproj1"));
});

test("xrpoint1: laser pick hits wrist chrome and world HUD", () => {
  const rc = { near: 1, far: 0.2, layers: { enableAll() { this.all = true; } } };
  prepareXrUiRaycaster(rc, { far: 8 });
  assert.equal(rc.near, 0);
  assert.equal(rc.far, 8);
  assert.equal(rc.layers.all, true);

  const plate = {
    isMesh: true,
    userData: { xrUi: "chrome", xrRaycast: false },
    raycast() {},
  };
  assert.equal(restoreXrUiPickRaycast(plate), true);
  assert.equal(plate.userData.xrRaycast, true);
  assert.equal(plate.raycast, undefined);

  const id = nearestDockToolId(
    { x: 0.01, y: 0, z: 0 },
    [
      { id: "menu", x: 0, y: 0, z: 0, visible: true },
      { id: "ai", x: 1, y: 0, z: 0, visible: true },
    ],
    0.09,
  );
  assert.equal(id, "menu");
  assert.equal(nearestDockToolId({ x: 5, y: 0, z: 0 }, [{ id: "menu", x: 0, y: 0, z: 0 }], 0.09), "");

  const laser = { id: "ray" };
  const grip = { id: "grip" };
  assert.equal(laserPickNode({ controller: laser, controllerPosed: true, aim: grip, aimPosed: true }), laser);
  assert.equal(laserPickNode({ controller: laser, controllerPosed: false, aim: grip, aimPosed: true }), grip);

  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const rail = readFileSync(join(here, "xr-hand-palette.js"), "utf8");
  const token = "20260915-xrpoint1";
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(rail.includes("roboticsworkspace3"));
  assert.ok(xr.includes("prepareXrUiRaycaster"));
  assert.ok(xr.includes("geometricPlaneHit"));
  assert.ok(xr.includes("mapWristAabbHit"));
  assert.ok(xr.includes("laserPickNode"));
  assert.ok(xr.includes("dockPalette.setHovered"));
  assert.ok(rail.includes("function setHovered"));
  assert.equal(rail.includes("hideRaycast(plate)"), false);
  const pickFn = xr.slice(xr.indexOf("function pickWithController"), xr.indexOf("function cheapMeshPick"));
  assert.ok(pickFn.includes("prepareXrUiRaycaster"));
  assert.ok(pickFn.includes("pickWristUi"));
  assert.ok(pickFn.includes("geometricPlaneHit"));
  assert.ok(pickFn.includes("preferHudActionHit"));
  assert.ok(pickFn.includes("takeHits"));
  assert.ok(pickFn.includes("debuggerHud"));
});

test("xrclick1: trigger consume is ui when the ray hits a menu, not miss", () => {
  assert.equal(xrSelectConsumeTarget({ rayOnMenu: true, hasPick: false }), "ui");
  assert.equal(xrSelectConsumeTarget({ uiHit: true, dimosArmed: true }), "ui");
  assert.equal(xrSelectConsumeTarget({ dimosArmed: false, hasPick: false }), "miss");
  assert.equal(xrSelectConsumeTarget({ dimosArmed: true, uiHit: false, hasPick: true }), "dimos");
  assert.equal(isXrHudActionKind("grid-action"), true);
  assert.equal(isXrHudActionKind("menu-tab"), true);
  assert.equal(isXrHudActionKind("grid-chrome"), false);
  assert.equal(isXrHudActionKind("menu-chrome"), false);
  const chrome = { kind: "grid-chrome", distance: 0.40 };
  const action = { kind: "grid-action", id: "passthrough", distance: 0.41 };
  assert.equal(preferHudActionHit([chrome, action])?.kind, "grid-action");
  assert.equal(preferHudActionHit([
    { kind: "explorer-drag", distance: 0.40 },
    { kind: "menu-tab", tab: "projects", distance: 0.41 },
  ])?.kind, "explorer-drag");
  const plane = { isMesh: true, userData: { xrGridPanel: "settings", xrRaycast: false, xrControllerOverlayStyled: true }, raycast() {} };
  assert.equal(restoreXrUiPickRaycast(plane), true);
  assert.equal(plane.userData.xrRaycast, true);
  assert.equal(plane.userData.xrControllerOverlayStyled, false);
  assert.equal(xrMeshIsWristOrHudUi({ userData: { xrHudPlane: true } }), true);
  assert.equal(styleXrControllerOverlayMesh({
    isMesh: true,
    userData: { xrGridPanel: "settings" },
    material: { depthTest: true },
  }), false);
  assert.equal(preferHudHitOverCad({ kind: "menu-tab" }, { kind: "mesh" })?.kind, "menu-tab");
  const laser = { userData: {}, raycast() { return 1; } };
  assert.equal(disableXrPointerRaycast(laser), true);
  assert.equal(laser.userData.xrRaycast, false);
  assert.equal(laser.raycast.length, 0);

  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const token = "xrclick1";
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(html.includes("robotics=20260915-3"));
  const pickFn = xr.slice(xr.indexOf("function pickWithController"), xr.indexOf("function cheapMeshPick"));
  assert.ok(pickFn.includes("preferHudActionHit"));
  assert.ok(pickFn.includes("mapHudPointToAction"));
  assert.ok(pickFn.includes("menuHitFromAabb"));
  assert.ok(pickFn.includes("takeHits"));
  assert.ok(pickFn.includes("debugger-chrome"));
  const handleStart = xr.indexOf("  function handleSelect(");
  const handle = xr.slice(handleStart, xr.indexOf("\n  function ", handleStart + 1));
  assert.ok(handle.includes("noteSelectConsume"));
  assert.ok(handle.includes("pickControllerSelectHit(laserNode)"));
  assert.ok(!handle.includes("lastRayOnMenu || lastMenuAimNear"), "another hand's menu hover cannot redirect trigger");
  assert.ok(handle.includes("mapHudPointToAction"));
  assert.ok(handle.includes("hit.fromAabb !== true"));
  assert.ok(xr.includes("disableXrPointerRaycast"));
  assert.ok(xr.includes("panel?.plane || panel?.mesh"));
  assert.ok(xr.includes("plane: mesh"));
});

test("xrperf2: plane AABB, skip overlay restyle, wrist world-depth, DIMOS JPEG gate", () => {
  const e = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.4, -0.6, 1];
  const box = xrPlaneWorldAabbFromMatrix(0.68, 0.48, e);
  assert.ok(box && box.maxX > box.minX && box.maxY > box.minY);
  assert.equal(xrPlaneWorldAabbFromMatrix(0, 0.4, e), null);
  assert.equal(shouldRestyleXrControllerOverlay({ overlayReady: true }), false);
  assert.equal(shouldRestyleXrControllerOverlay({ overlayReady: false }), true);
  assert.equal(shouldRestyleXrControllerOverlay({
    overlayReady: false, lastStyleAt: 1, now: 100, retryMs: 400,
  }), false);
  assert.equal(shouldRestyleXrControllerOverlay({
    overlayReady: false, lastStyleAt: 1, now: 500, retryMs: 400,
  }), true);
  assert.equal(xrWristPlateDepthFlags().depthTest, true);
  assert.equal(xrWristPlateDepthFlags().depthWrite, true);
  assert.equal(shouldIngestDimosJpeg({ armed: false }), false);
  assert.equal(shouldIngestDimosJpeg({ armed: true }), true);
  assert.equal(shouldIngestDimosJpeg({ armed: false, recording: true }), true);
  assert.equal(shouldKeepXrCadLightRole({ role: "cavity", presenting: true }), false);
  assert.equal(shouldKeepXrCadLightRole({ role: "key", presenting: true }), true);
  assert.equal(shouldKeepXrCadLightRole({ role: "fill", presenting: false }), true);
  assert.equal(shouldPollHandCamJpeg({ presenting: false, wantScene: true }), false);
  assert.equal(shouldPollHandCamJpeg({ presenting: true, wantScene: true, lastPollMs: 0, now: 10 }), true);
  assert.equal(shouldPollHandCamJpeg({
    presenting: true, wantScene: true, live: false, lastPollMs: 10, now: 300, idleMs: 2500,
  }), false);
  assert.equal(shouldPollHandCamJpeg({
    presenting: true, wantScene: true, live: true, lastPollMs: 10, now: 300, liveMs: 280,
  }), true);

  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const rail = readFileSync(join(here, "xr-hand-palette.js"), "utf8");
  const dimos = readFileSync(join(here, "xr-dimos-teleop.js"), "utf8");
  const style = readFileSync(join(here, "../viewport/scene-style.js"), "utf8");
  const token = "20260915-xrperf2";
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(rail.includes("roboticsworkspace3"));
  assert.ok(xr.includes("xrPlaneWorldAabbFromMatrix"));
  assert.ok(xr.includes("shouldRestyleXrControllerOverlay"));
  assert.equal(xr.includes("new THREE.Box3().setFromObject(g)"), false);
  assert.ok(xr.includes("framebufferScale: XR_FRAMEBUFFER_SCALE"));
  assert.ok(rail.includes("xrWristPlateDepthFlags"));
  assert.ok(rail.includes("xrWorldDepth = true"));
  assert.ok(dimos.includes("shouldIngestDimosJpeg"));
  assert.ok(style.includes("trimViewportLightsForXr"));
  assert.ok(xr.includes("shouldPollHandCamJpeg"));
});

test("xrperf3: gate printer/HUD/share work and keep framebuffer 0.85", () => {
  assert.equal(XR_PERF_CACHE, "xrperf3");
  assert.equal(XR_FRAMEBUFFER_SCALE, 0.85);
  assert.equal(shouldSyncPrinterVisuals({ dirty: false }), false);
  assert.equal(shouldSyncPrinterVisuals({ dirty: true }), true);
  assert.equal(shouldTickPrinterFencePreview({ placing: false }), false);
  assert.equal(shouldTickPrinterFencePreview({ placing: true }), true);
  assert.equal(shouldPaintShareAimHud({ armed: false }), false);
  assert.equal(shouldPaintShareAimHud({ armed: true, targetKey: "a", lastKey: "b" }), true);
  assert.equal(shouldPaintShareAimHud({
    armed: true, targetKey: "a", lastKey: "a", now: 50, lastAt: 0, minMs: 140,
  }), false);
  assert.equal(shouldFollowHudThisFrame({ windowOpened: true }), true);
  assert.equal(shouldFollowHudThisFrame({ now: 10, lastAt: 0, headMoved: true, minMs: 48 }), false);
  assert.equal(shouldFormatXrClockHud({ now: 200, lastAt: 0, minMs: 1000 }), false);
  assert.equal(shouldRebuildDashedPrinterBox({ next: { x: 0.3, y: 0.3, z: 0.3 } }), true);
  assert.equal(shouldRebuildDashedPrinterBox({
    prev: { x: 0.3, y: 0.3, z: 0.3 }, next: { x: 0.301, y: 0.3, z: 0.3 },
  }), false);

  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const tabs = readFileSync(join(here, "xr-tabbed-windows.js"), "utf8");
  assert.ok(xr.includes("xrperf3"));
  assert.ok(app.includes("xrperf3"));
  assert.ok(html.includes("xrperf3"));
  assert.ok(xr.includes("shouldSyncPrinterVisuals"));
  assert.ok(xr.includes("isLeftoverAutoPrinterFence"));
  assert.ok(xr.includes("shouldFollowHudThisFrame"));
  assert.ok(tabs.includes("row.aligned"));
  assert.equal(tabs.includes("traverseVisible"), false);
  assert.equal(xr.includes("new THREE.Box3().setFromObject(group)"), false);
});

test("xrctl1: padded AABB hits, short laser, left menu, A-hold, consume tags", () => {
  const e = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1.4, -0.6, 1];
  const box = xrPlaneWorldAabbFromMatrix(0.68, 0.48, e);
  assert.ok(box && box.minX < -0.3 && box.maxX > 0.3);
  assert.ok((box.maxX - box.minX) > 0.68, "pad must thicken the cheap plane AABB");
  const circle = xrCircleWorldAabbFromMatrix(0.03, e);
  assert.ok(circle && circle.maxX > circle.minX);
  assert.equal(xrPlaneWorldAabbFromMatrix(0, 0.4, e), null);
  assert.ok(XR_AABB_PAD_M > 0.02 && XR_AABB_PAD_M < 0.05);

  assert.equal(xrControlsUiTag({ kind: "tool", source: "wrist" }), "dock");
  assert.equal(xrControlsUiTag({ kind: "tool", tool: "measure" }), "spinwheel");
  assert.equal(xrControlsUiTag({ kind: "color" }), "spinwheel");
  assert.equal(xrControlsUiTag({ kind: "menu-tab" }), "xrUi");
  assert.equal(xrControlsUiTag({ kind: "grid-action" }), "xrUi");
  assert.equal(xrControlsUiTag({ kind: "mesh" }), "cad");
  assert.equal(xrControlsUiTag({ kind: "edge" }), "cad");
  assert.equal(xrControlsUiTag(null), "");

  const leftGp = { buttons: [{}, {}, {}, {}, { pressed: true }, {}] };
  assert.equal(studioLeftMenuFacePressed(leftGp), true);
  assert.equal(studioLeftMenuFacePressed({ buttons: [{}, {}, { pressed: true }] }), true);
  assert.equal(studioLeftMenuFacePressed({ buttons: [{}, {}, {}, {}, { pressed: false }, {}] }), false);
  const analogExtras = [];
  for (let i = 0; i < 13; i += 1) analogExtras.push({ pressed: false, value: i >= 7 ? 0.9 : 0 });
  assert.equal(studioLeftMenuFacePressed({ buttons: analogExtras }), false);
  const menu7 = [];
  for (let i = 0; i < 8; i += 1) menu7.push({ pressed: i === 7, value: i === 7 ? 1 : 0 });
  assert.equal(studioLeftMenuFacePressed({ buttons: menu7 }), true);
  assert.equal(shouldToggleWristMenuOnLeftFace({ handedness: "left", pressed: true }), true);
  assert.equal(shouldToggleWristMenuOnLeftFace({ handedness: "right", pressed: true }), false);

  assert.ok(laserLengthForAim(null, { force: true }) <= XR_LASER_IDLE_STUB_M + 0.001);
  assert.ok(laserLengthForAim(null, { force: true }) >= XR_LASER_MIN_M);
  assert.ok(shouldRunStudioAHold({ armed: false }));
  assert.equal(shouldRunStudioAHold({ armed: true }), false);

  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const token = "20260915-xrctl1";
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.ok(html.includes("pubpin1"));
  assert.ok(html.includes("vidshare1"));
  assert.ok(html.includes("20260916-vrsharemesh1"));
  assert.ok(app.includes("20260916-vrsharemesh1"));
  assert.ok(app.includes("publishSceneMeshesToRoom"));
  assert.ok(xr.includes("20260916-vrsharemesh1"));
  assert.ok(xr.includes("sharedXrSession"));
  assert.ok(xr.includes("adoptLocal"));
  assert.ok(xr.includes("mapWheelAabbHit"));
  assert.ok(xr.includes("remapHudChromeHit"));
  assert.ok(xr.includes("studioLeftMenuFacePressed"));
  assert.ok(xr.includes("gamepadFacePressed(gp, 4)"));
  assert.ok(xr.includes("XR_LASER_IDLE_STUB_M"));
  assert.ok(xr.includes("keepRecording"));
  assert.ok(xr.includes("controls: snap.controls"));
  assert.ok(xr.includes("shouldUploadXrDebuggerLog"));
  assert.ok(!xr.includes("postXrPerfSample({ force: !xrPerfPosted })"));
  const pickFn = xr.slice(xr.indexOf("function pickWithController"), xr.indexOf("function cheapMeshPick"));
  assert.ok(pickFn.includes("mapWheelAabbHit"));
  assert.ok(pickFn.includes("restoreXrUiPickRaycast"));
  const rays = xr.slice(xr.indexOf("function updateControllerRays"), xr.indexOf("function worldMenuAabbs"));
  assert.ok(rays.includes("xrPointerStyle"));
  assert.ok(rays.includes("pickControllerSelectHit"));
  assert.ok(rays.includes("pickControllerSelectHit"));
  assert.ok(rays.includes("preferUiHoverHit"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.equal(XR_UI_PICK_CACHE, "20260915-xrui1");
  assert.equal(XR_GRAB_CACHE, "20260915-xrgrab1");
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.equal(xrAimPoseIsLive({ x: 0, y: 0, z: 0 }), false);
  assert.equal(xrAimPoseIsLive({ x: 0, y: XR_AIM_POSE_MIN_M, z: 0 }), true);
  const identE = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const puck = xrMeshWorldAabbFromGeometry({
    isMesh: true,
    geometry: { parameters: { radius: 0.04 } },
    matrixWorld: { elements: identE },
  });
  assert.ok(puck && puck.maxX > puck.minX);
  assert.equal(preferHudHitOverCad({ kind: "menu-tab" }, { kind: "mesh" })?.kind, "menu-tab");
  assert.equal(preferHudHitOverCad({ kind: "menu-chrome" }, { kind: "mesh" })?.kind, "mesh");
  assert.equal(preferHudHitOverCad({ kind: "studio-chrome" }, { kind: "mesh" })?.kind, "mesh");
  assert.equal(preferHudHitOverCad({ kind: "explorer-drag" }, { kind: "mesh" })?.kind, "explorer-drag");
  assert.equal(hudHitStealsCad({ kind: "menu-chrome" }), false);
  assert.equal(isXrPanelGripHandleKind("explorer-drag"), true);
  assert.equal(isXrChromeKind("robotics-chrome"), true);
  assert.ok(pickFn.includes("preferHudHitOverCad"));
  assert.ok(rays.includes("pickControllerSelectHit"));
  assert.ok(rays.includes("pickControllerSelectHit(pickAim"));
  assert.ok(xr.includes("xrAimPoseIsLive"));
  assert.ok(xr.includes("xrMeshWorldAabbFromGeometry"));
  assert.ok(xr.includes("dock.position.set(0.02, 0.02, 0.08)"));
  assert.equal(xr.includes("dock.position.set(0.02, 0.02, -0.06)"), false);
  const handle = xr.slice(xr.indexOf("function handleSelect"), xr.indexOf("function handleSelect") + 2200);
  assert.ok(handle.includes("resolveSelectAim"));
  assert.ok(xr.includes("selectHitFromAimOrGrip"));
  assert.ok(handle.includes("preferHudHitOverCad") || xr.includes("preferHudHitOverCad"));
});

test("xrgrab1: no AABB cube, last project waits for opener, grip needs hover/contact", () => {
  assert.equal(shouldShowXrCadProxy({ remaining: 8, shown: 0 }), false);
  assert.equal(shouldShowXrCadProxy({ skipped: 3 }), false);
  assert.equal(isXrCadGrabProxy({ name: "xrCadProxy", userData: { xrCadProxy: true } }), true);
  assert.equal(isXrCadGrabProxy({ name: "xrFaceProbe", userData: {} }), true);
  assert.equal(isXrCadGrabProxy({ name: "Part", userData: {} }), false);
  assert.equal(studioGripAllowsLiveMeshFallback(), false);
  assert.equal(resolveStudioGripTarget({ hitMesh: { id: "cad" }, liveMesh: { id: "live" } })?.id, "cad");
  assert.equal(resolveStudioGripTarget({ liveMesh: { id: "live" } }), null);
  assert.equal(shouldFlushDeferredXrProject({ presenting: true, hasOpener: false }), false);
  assert.equal(shouldFlushDeferredXrProject({ presenting: true, hasOpener: true }), true);
  assert.equal(shouldFlushDeferredXrProject({ presenting: false, hasOpener: true }), false);
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const ensure = xr.slice(xr.indexOf("function ensureXrCadProxy"), xr.indexOf("function removeXrCadProxy"));
  assert.ok(ensure.includes("removeXrCadProxy"));
  assert.equal(ensure.includes("BoxGeometry"), false);
  assert.equal(xr.includes("new THREE.BoxGeometry(0.16, 0.16, 0.16)"), false);
  const startGrab = xr.slice(xr.indexOf("function startGripGrabOn"), xr.indexOf("function releaseGripGrab"));
  assert.ok(startGrab.includes("resolveStudioGripTarget"));
  assert.ok(startGrab.includes("pickNearGrabMesh"));
  assert.equal(startGrab.includes("|| getLiveMesh()"), false);
  const gripFn = xr.slice(xr.indexOf("function updateGripGrab"), xr.indexOf("function updateGrab"));
  assert.ok(gripFn.includes("if (panelDrag || !gripGrab) return"));
  assert.equal(gripFn.includes("|| getLiveMesh()"), false);
  assert.ok(xr.includes("shouldFlushDeferredXrProject"));
  assert.ok(xr.includes("tryBeginPanelGrip"));
  assert.ok(html.includes("robotics=20260915-3"));
  assert.ok(app.includes("roboticsworkspace3"));
  assert.ok(xr.includes("roboticsworkspace3"));
  assert.ok(app.includes("xrlastproj1"));
  assert.ok(html.includes("view=open") || app.includes("view=open"));
});

test("visergrip1: OpenArm moves only on mesh; UI, CAD, empty, and B-walk win", () => {
  assert.equal(VISER_GRIP_CACHE, "20260916-visergrip1");
  assert.equal(viserRobotGripBlocked({}), false);
  assert.equal(viserRobotGripBlocked({ hoverKind: "" }), false);
  assert.equal(viserRobotGripBlocked({ hoverKind: "robotics-workspace-action" }), false);
  assert.equal(viserRobotGripBlocked({ walkHeld: true }), true);
  assert.equal(viserRobotGripBlocked({ hoverKind: "menu-tab" }), true);
  assert.equal(viserRobotGripBlocked({ hoverKind: "studio-chrome" }), true);
  assert.equal(viserRobotGripBlocked({ hoverKind: "mesh" }), true);
  assert.equal(viserRobotGripBlocked({ hoverKind: "drop" }), true);
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const workspace = readFileSync(join(here, "xr-robotics-workspace.js"), "utf8");
  const scene = readFileSync(join(here, "xr-viser-scene.js"), "utf8");
  const squeeze = xr.slice(xr.indexOf("function startStudioGrip"), xr.indexOf("function finishStudioGrip"));
  assert.ok(squeeze.includes("tryBeginPanelGrip"));
  assert.ok(squeeze.includes("viserOpenArmGripAllowed"));
  assert.ok(squeeze.includes("walkHeld: roomWalkHeld"));
  assert.equal(squeeze.includes("pickWithController"), false);
  assert.equal(squeeze.includes("lastPointerHoverHit"), false);
  assert.ok(squeeze.indexOf("tryBeginPanelGrip") < squeeze.indexOf("roboticsWorkspace.beginGrip"));
  assert.equal(workspace.includes("intersectObject(r.root,true)"), false);
  assert.ok(workspace.includes("pickMesh"));
  assert.ok(workspace.includes("isViserGrabMesh"));
  assert.ok(scene.includes("muteViserHelperRaycast"));
  assert.ok(scene.includes("viserAimHitsRobot"));
  assert.ok(xr.includes("20260916-visergrip1"));
  assert.ok(app.includes("20260916-visergrip1"));
  assert.ok(html.includes("20260916-visergrip1"));
});

test("lefthud1: left wrist plate covers hovered pucks; chrome canvas matches aspect", () => {
  assert.ok(WRIST_PLATE_PAD_M >= 0.012);
  assert.ok(WRIST_PLATE_BORDER_EXTRA_M >= 0.003);
  assert.ok(WRIST_PLATE_BORDER_EXTRA_M < 0.012, "no CAD-covering gutter");
  const layout = wristPlateLayout({ cols: 3, rows: 3, tile: 0.024, gapX: 0.046, gapY: 0.026 });
  const puckR = (0.024 / 2) * WRIST_PLATE_HOVER_SCALE;
  const halfW = layout.plateW / 2;
  const halfH = layout.plateH / 2;
  for (let col = 0; col < 3; col += 1) {
    for (let row = 0; row < 3; row += 1) {
      const x = layout.originX + col * 0.046;
      const y = layout.originY - row * 0.026;
      assert.ok(x - puckR >= -halfW + 1e-6, `left puck col=${col} row=${row} clipped`);
      assert.ok(x + puckR <= halfW - 1e-6, `right puck col=${col} row=${row} clipped`);
      assert.ok(y - puckR >= -halfH + 1e-6, `bottom puck col=${col} row=${row} clipped`);
      assert.ok(y + puckR <= halfH - 1e-6, `top puck col=${col} row=${row} clipped`);
    }
  }
  const tex = wristPlateCanvasSize(layout.plateW, layout.plateH);
  assert.ok(Math.abs(tex.width / tex.height - layout.plateW / layout.plateH) < 0.04);
  const oldSquare = wristPlateCanvasSize(1, 1);
  assert.equal(oldSquare.width, oldSquare.height);
  const tool = xrHudPlateFromItems([
    { x: -0.048, y: 0.096, r: 0.016 },
    { x: 0.048, y: -0.078, r: 0.016 },
  ], { pad: 0.02, hoverScale: 1.18 });
  assert.ok(tool.w > 0.15);
  assert.ok(-0.048 - 0.016 * 1.18 >= tool.x - tool.w / 2);
  assert.ok(0.048 + 0.016 * 1.18 <= tool.x + tool.w / 2);
  assert.ok(0.096 + 0.016 * 1.18 <= tool.y + tool.h / 2);
  assert.ok(-0.078 - 0.016 * 1.18 >= tool.y - tool.h / 2);
  const draw = xrHudPlateFromItems([
    { x: 0, y: 0.032, r: 0.052 },
    { x: -0.046, y: -0.062, r: 0.018 },
    { x: 0.046, y: -0.062, r: 0.018 },
  ], { pad: 0.022, hoverScale: 1.18 });
  assert.ok(0.032 + 0.052 * 1.18 <= draw.y + draw.h / 2);
  const here = dirname(fileURLToPath(import.meta.url));
  const rail = readFileSync(join(here, "xr-hand-palette.js"), "utf8");
  const hand = readFileSync(join(here, "xr-tool-hand.js"), "utf8");
  const hud = readFileSync(join(here, "xr-draw-hud.js"), "utf8");
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.ok(rail.includes("wristPlateCanvasSize"));
  assert.equal(rail.includes("void plateW"), false);
  assert.ok(hand.includes("xrHudPlateFromItems"));
  assert.ok(hud.includes("xrHudPlateFromItems"));
  assert.ok(xr.includes("lefthud1=1"));
  assert.ok(app.includes("lefthud1=1"));
  assert.ok(html.includes("lefthud1=1"));
  assert.ok(hand.includes("DRAW_HAND_FACE_RX") || hand.includes("off.rx"));
  assert.ok(hud.includes("off.rx"));
});

test("gripmove1: grip-only move/resize; trigger moves only on a real model mesh", () => {
  assert.equal(XR_GRIP_MOVE_CACHE, "gripmove1");
  assert.equal(studioTriggerMovesModel({ meshHit: true }), true);
  assert.equal(studioTriggerMovesModel({ meshHit: true, triggerHeld: true }), true);
  assert.equal(studioTriggerMovesModel({ meshHit: true, teleopArmed: true }), false);
  assert.equal(studioTriggerMovesModel({ meshHit: true, uiHit: true }), false);
  assert.equal(studioTriggerMovesModel({ cheapHit: true, meshHit: false }), false);
  assert.equal(studioTriggerMovesModel({}), false);
  assert.equal(studioTriggerMovesModel({ meshHit: false }), false);
  const part = {
    isMesh: true, visible: true, userData: {}, material: { colorWrite: true }, parent: null,
  };
  assert.equal(isStudioModelGrabMesh(part), true);
  assert.equal(isStudioModelGrabMesh({ isMesh: true, visible: true, type: "GridHelper", userData: {} }), false);
  assert.equal(isStudioModelGrabMesh({ isMesh: true, visible: true, type: "AxesHelper", userData: {} }), false);
  assert.equal(isStudioModelGrabMesh({ isMesh: true, visible: true, userData: { xrCadProxy: true } }), false);
  assert.equal(isStudioModelGrabMesh({ isMesh: true, visible: true, userData: { viserHelper: true } }), false);
  assert.equal(isStudioModelGrabMesh({ isMesh: true, visible: true, userData: { isFloor: true } }), false);
  assert.equal(isStudioModelGrabMesh({ isLine: true, isMesh: true, visible: true, userData: {} }), false);
  assert.equal(studioAimHitsModel(null, part), null);
  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const handle = xr.slice(xr.indexOf("function handleSelect"), xr.indexOf("function controllerNearMesh"));
  assert.equal(handle.includes("controllerNearMesh(controller"), false, "trigger miss must not steal CAD");
  assert.ok(handle.includes("pickTriggerMoveMesh"));
  assert.ok(handle.includes("studioTriggerMovesModel"));
  const startGrab = xr.slice(xr.indexOf("function startGripGrabOn"), xr.indexOf("function releaseGripGrab"));
  assert.ok(startGrab.includes("pickNearGrabMesh"));
  assert.ok(startGrab.includes("pickNearGrabMesh(src) || pickTriggerMoveMesh"));
  assert.equal(startGrab.includes("pickGrabMesh("), false, "grip move is contact or real laser-on-mesh, not cheap AABB");
  const gripFn = xr.slice(xr.indexOf("function updateGripGrab"), xr.indexOf("function updateGrab"));
  assert.ok(gripFn.includes("sampled.squeezes[hand]"));
  assert.equal(gripFn.includes("triggers["), false, "held grip must not also require trigger");
  const scaleFn = xr.slice(xr.indexOf("function updateTwoHandScale"), xr.indexOf("async function requestXrSession"));
  assert.ok(scaleFn.includes("squeezes[0] && squeezes[1]"));
  assert.equal(scaleFn.includes("triggers[0]"), false, "two-hand resize is grips only");
  assert.ok(xr.includes("function pickTriggerMoveMesh"));
  assert.ok(xr.includes("gripmove1"));
  assert.ok(app.includes("gripmove1"));
  assert.ok(html.includes("gripmove1"));
});

test("xrgrab2: chrome AABB yields to CAD; title grip rotates; right lasers stay", () => {
  assert.equal(XR_GRAB_CACHE, "20260915-xrgrab1");
  assert.equal(XR_GRAB2_CACHE, "xrgrab2");
  assert.equal(preferHudHitOverCad({ kind: "menu-chrome", fromAabb: true }, { kind: "mesh" })?.kind, "mesh");
  assert.equal(preferHudActionHit([
    { kind: "view-drag", distance: 0.5 },
    { kind: "view-action", id: "fit", distance: 0.52 },
  ])?.kind, "view-drag");
  assert.equal(xrSourceLooksLikeTouchPad({
    handedness: "right",
    hand: {},
    gamepad: { mapping: "xr-standard", buttons: [{}, {}, {}, {}, {}] },
  }), true);
  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const squeeze = xr.slice(xr.indexOf("function startStudioGrip"), xr.indexOf("function finishStudioGrip"));
  assert.equal(squeeze.includes("pickWithController"), false);
  assert.ok(squeeze.includes("tryBeginPanelGrip"));
  const panel = xr.slice(xr.indexOf("function tryBeginPanelGrip"), xr.indexOf("function startStudioGrip"));
  assert.ok(panel.includes("isXrPanelGripHandleKind"));
  assert.ok(panel.includes("nearGripPanel(src)"));
  assert.ok(panel.includes("panelGroupFromHit(hit)") === true);
  const pickFn = xr.slice(xr.indexOf("function pickWithController"), xr.indexOf("function cheapMeshPick"));
  assert.ok(pickFn.includes("hudHitStealsCad"));
  assert.ok(pickFn.includes("Empty *-chrome AABB"));
  const rays = xr.slice(xr.indexOf("function updateControllerRays"), xr.indexOf("function worldMenuAabbs"));
  assert.ok(rays.includes("bright: !!bButtonHeld"));
  assert.ok(rays.includes("grips[i]"));
  assert.ok(xr.includes("xrgrab1"));
  assert.ok(xr.includes("xrgrab2"));
  assert.ok(app.includes("xrgrab1"));
  assert.ok(app.includes("xrgrab2"));
  assert.ok(html.includes("xrgrab1"));
  assert.ok(html.includes("xrgrab2"));
  assert.ok(html.includes("xrrest2"));
  assert.ok(html.includes("xrdbg2"));
  assert.ok(html.includes("xrclick1"));
  assert.ok(html.includes("xrclick2"));
});

test("xrgrab3: HUD overlay yields squeeze to CAD; Exit VR hold reloads in-session", () => {
  assert.equal(XR_GRAB_CACHE, "20260915-xrgrab1");
  assert.equal(XR_GRAB2_CACHE, "xrgrab2");
  assert.equal(XR_GRAB3_CACHE, "xrgrab3");
  assert.equal(isXrSqueezeOverlayKind("menu-chrome"), true);
  assert.equal(isXrSqueezeOverlayKind("howto-drag"), true);
  assert.equal(isXrSqueezeOverlayKind("place-drag"), true);
  assert.equal(isXrSqueezeOverlayKind("explorer-drag", { fromAabb: true }), true);
  assert.equal(isXrSqueezeOverlayKind("explorer-drag"), false);
  assert.equal(isExitVrHudHit({ kind: "tool", tool: "exit" }), true);
  assert.equal(isExitVrHudHit({ kind: "tool", tool: "menu" }), false);
  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const restart = readFileSync(join(here, "xr-stick-restart.js"), "utf8");
  const panel = xr.slice(xr.indexOf("function tryBeginPanelGrip"), xr.indexOf("function startStudioGrip"));
  assert.ok(panel.includes("pickNearGrabMesh(src) || pickTriggerMoveMesh(aim)"));
  assert.ok(panel.includes("if (cad) return false"));
  assert.ok(panel.includes("isXrSqueezeOverlayKind"));
  const grabOn = xr.slice(xr.indexOf("function startGripGrabOn"), xr.indexOf("function releaseGripGrab"));
  assert.ok(grabOn.includes("studioGripAim"));
  assert.ok(grabOn.includes("pickTriggerMoveMesh(aim)"));
  assert.ok(xr.includes("beginExitVrHold"));
  assert.ok(xr.includes("pollExitVrHold"));
  assert.ok(xr.includes("paintExitVrHoldCircle"));
  assert.ok(xr.includes("softRefreshVrStayInHeadset({ ev: XR_EXIT_VR_HOLD_EVENT })"));
  assert.equal(xr.includes("beginExitVrHold") && xr.includes("session.end()"), true);
  const setToolExit = xr.slice(xr.indexOf('if (id === "exit")'), xr.indexOf('if (id === "screenshot"'));
  assert.ok(setToolExit.includes("beginExitVrHold"));
  assert.equal(setToolExit.includes("exit()"), false, "Exit VR hold must not end the session");
  assert.ok(restart.includes("XR_EXIT_VR_HOLD_MS = 2000"));
  assert.ok(xr.includes("if (tick.tap)"));
  assert.ok(restart.includes("function paintExitVrHoldCircle"));
  assert.ok(restart.includes("xrrest2"));
  assert.ok(xr.includes("xrgrab3"));
  assert.ok(app.includes("xrgrab3"));
  assert.ok(html.includes("xrgrab3"));
  assert.ok(app.includes("xrgrab1"));
  assert.ok(app.includes("xrgrab2"));
  assert.ok(html.includes("xrgrab1"));
  assert.ok(html.includes("xrgrab2"));
  assert.ok(html.includes("xrrest2"));
  assert.ok(html.includes("xrdbg2"));
});

test("xrgrab4: squeeze or trigger alone grabs CAD; both not required", () => {
  assert.equal(XR_GRAB_CACHE, "20260915-xrgrab1");
  assert.equal(XR_GRAB2_CACHE, "xrgrab2");
  assert.equal(XR_GRAB3_CACHE, "xrgrab3");
  assert.equal(XR_GRAB4_CACHE, "xrgrab4");
  assert.equal(cadHoverGrabMesh({ kind: "mesh", object: { id: "cad" } })?.id, "cad");
  assert.equal(cadHoverGrabMesh({ kind: "drop", root: { id: "drop" } })?.id, "drop");
  assert.equal(cadHoverGrabMesh({ kind: "menu-chrome" }), null);
  assert.equal(cadHoverGrabMesh({ kind: "explorer-drag" }), null);
  assert.equal(studioEitherButtonGrabsModel({ squeeze: true, cadHit: true }), true);
  assert.equal(studioEitherButtonGrabsModel({ trigger: true, cadHit: true }), true);
  assert.equal(studioEitherButtonGrabsModel({ squeeze: true, trigger: true, cadHit: true }), true);
  assert.equal(studioEitherButtonGrabsModel({ squeeze: true, trigger: false, cadHit: false }), false);
  assert.equal(studioEitherButtonGrabsModel({ squeeze: true, uiHit: true, cadHit: false }), false);
  assert.equal(studioTriggerMovesModel({ hoverCad: true, cheapHit: true }), true);
  assert.equal(studioTriggerMovesModel({ cheapHit: true, meshHit: false }), false);
  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const squeeze = xr.slice(xr.indexOf("function startStudioGrip"), xr.indexOf("function finishStudioGrip"));
  assert.equal(squeeze.includes("if (hand < 0 || gripPressActive[hand]) return"), false);
  assert.ok(squeeze.includes("if (already)"));
  assert.ok(squeeze.includes("startGripGrabOn(controller)"));
  assert.equal(squeeze.includes("pickWithController"), false);
  const grabOn = xr.slice(xr.indexOf("function startGripGrabOn"), xr.indexOf("function releaseGripGrab"));
  assert.ok(grabOn.includes("cadHoverGrabMesh"));
  assert.ok(grabOn.includes("noteGrabDebug"));
  assert.ok(xr.includes("if (squeezes[handIndex] && pointer) startStudioGrip"));
  assert.equal(xr.includes("squeezes[handIndex] && !gripPressActive[handIndex] && pointer"), false);
  assert.ok(xr.includes("debuggerHud.group.visible = true"));
  assert.ok(xr.includes("xrgrab4"));
  assert.ok(app.includes("xrgrab4"));
  assert.ok(html.includes("xrgrab4"));
  assert.ok(app.includes("xrgrab1"));
  assert.ok(app.includes("xrgrab2"));
  assert.ok(app.includes("xrgrab3"));
  assert.ok(html.includes("xrrest2"));
  assert.ok(html.includes("xrdbg2"));
});

test("xrtool1: right stick flick undo stays live in draw/create; L3+R3 stays click-only", () => {
  assert.equal(XR_TOOL1_CACHE, "xrtool1");
  assert.equal(XR_GRAB4_CACHE, "xrgrab4");
  assert.equal(stickHistoryFlickEnabled({ presenting: true, drawing: true, creating: true, aiBoard: true }), true);
  assert.equal(stickHistoryFlickEnabled({ presenting: true, walkHeld: true }), false);
  assert.equal(stickHistoryFlickEnabled({ presenting: true, bothSticksClicked: true }), false);
  assert.equal(stickHistoryFlickEnabled({ presenting: true, rightStickClicked: true }), false);
  assert.equal(stickHistoryFlickEnabled({ presenting: true, dimosArmed: true }), false);
  assert.equal(stickHistoryFlickEnabled({ presenting: false }), false);
  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const flick = readFileSync(join(here, "xr-history-flick.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const restart = readFileSync(join(here, "xr-stick-restart.js"), "utf8");
  assert.ok(flick.includes("createStickHistoryFlick"));
  assert.ok(xr.includes("createStickHistoryFlick"));
  assert.ok(xr.includes("stickHistoryFlickEnabled"));
  assert.ok(xr.includes("roomStickAxes"));
  assert.ok(xr.includes("axes.right[0]"));
  assert.ok(xr.includes("xrtool1"));
  assert.ok(app.includes("xrtool1"));
  assert.ok(html.includes("xrtool1"));
  assert.ok(app.includes("xrgrab4"));
  assert.ok(html.includes("xrgrab4"));
  assert.ok(html.includes("xrdbg2"));
  assert.ok(html.includes("xrrest2"));
  assert.ok(restart.includes("debuggerEnterHeld"));
  assert.ok(restart.includes("bothThumbsticksClicked"));
});

test("xrwin1: HUD clicks keep window pose; XR project load skips desktop fit", () => {
  assert.equal(XR_WIN1_CACHE, "xrwin1");
  assert.equal(XR_GRAB4_CACHE, "xrgrab4");
  assert.equal(XR_TOOL1_CACHE, "xrtool1");
  assert.equal(xrHudClickStartsWindowDrag(), false);
  assert.equal(shouldApplyDesktopCadFitDuringXr({ presenting: true }), false);
  assert.equal(shouldApplyDesktopCadFitDuringXr({ presenting: false }), true);
  assert.equal(panelWorldPoseIsKept({ x: 0.05, y: 1.5, z: -0.1 }), true, "close window is kept");
  assert.equal(panelWorldPoseIsKept({ x: 0.4, y: 1.4, z: -0.5 }), true);
  assert.equal(panelWorldPoseIsKept({ x: Number.NaN, y: 1, z: 0 }), false);
  assert.equal(panelWorldPoseIsKept({ x: 80, y: 1, z: 0 }), false);
  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const tabs = readFileSync(join(here, "xr-tabbed-windows.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  const begin = xr.slice(xr.indexOf("function beginPanelDrag"), xr.indexOf("function updatePanelDrag"));
  assert.ok(begin.includes("opts.input !== \"grip\""));
  assert.ok(xr.includes("panelWorldPoseIsKept"));
  assert.ok(xr.includes("forcePlace: false, keepPose: true"));
  assert.ok(xr.includes("keepPose: true"));
  assert.equal(xr.includes('openMenuConsole({ tab: "social", keepPose: false })'), false);
  assert.ok(tabs.includes("xrHudParked"));
  assert.ok(app.includes("xrLiveOpen"));
  assert.ok(app.includes("fitView && !(viewportXR?.isPresenting"));
  assert.ok(app.includes("const xrLiveOpen = !!(viewportXR?.isPresenting?.() || renderer?.xr?.isPresenting)"));
  assert.ok(app.includes("if (!xrLiveOpen)"));
  assert.ok(app.includes("applyHandheldDesktopPlacement"));
  assert.ok(xr.includes("xrwin1"));
  assert.ok(app.includes("xrwin1"));
  assert.ok(html.includes("xrwin1"));
  assert.ok(html.includes("vrproj1"));
  assert.ok(app.includes("xrgrab4"));
  assert.ok(app.includes("xrtool1"));
  assert.ok(html.includes("xrgrab4"));
  assert.ok(html.includes("xrtool1"));
  assert.ok(html.includes("xrrest2"));
});

test("tabface=20260916-2: windows face the head, undock, strip gap, foveation", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const tabs = readFileSync(join(here, "xr-tabbed-windows.js"), "utf8");
  const place = readFileSync(join(here, "xr-window-placement.js"), "utf8");
  const hud = readFileSync(join(here, "xr-hud-refresh.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.ok(place.includes("windowFaceTowardHead"));
  assert.ok(place.includes("windowLookAtQuaternion"));
  assert.ok(xr.includes("windowFaceTowardHead"));
  assert.ok(xr.includes("tabface=20260916-2"));
  assert.ok(xr.includes("createMenuClarityControl"));
  assert.ok(xr.includes("hasOpenWindows()"));
  assert.ok(hud.includes("createMenuClarityControl"));
  assert.ok(tabs.includes("XR_TAB_DETACH_M = 0.07"));
  assert.ok(tabs.includes("XR_TAB_STRIP_GAP_M"));
  assert.ok(tabs.includes("XR_TAB_HIT_PAD_M"));
  assert.ok(tabs.includes("action:'undock'"));
  assert.ok(tabs.includes("xrHudCanvasBackingSize"));
  assert.ok(app.includes("tabface=20260916-2"));
  assert.ok(html.includes("tabface=20260916-2"));
  assert.ok(app.includes("vrtabs=20260916-1"));
  assert.ok(html.includes("compactwindows=20260916-2"));
});

test("uisharp=20260916-1: sitting-distance HUD scale, padded labels, foveation off", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  assert.equal(XR_HUD_CANVAS_SCALE, 2.2);
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const tabs = readFileSync(join(here, "xr-tabbed-windows.js"), "utf8");
  const hud = readFileSync(join(here, "xr-hud-refresh.js"), "utf8");
  const tex = readFileSync(join(here, "xr-ui-tex.js"), "utf8");
  const studio = readFileSync(join(here, "xr-studio-panel.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.ok(xr.includes("wrapHudCanvasText"));
  assert.ok(xr.includes("uisharp=20260916-1"));
  assert.ok(xr.includes("imageSmoothingEnabled = true"));
  assert.ok(tabs.includes("uisharp=20260916-1"));
  assert.ok(hud.includes("fixedFoveation"));
  assert.ok(tex.includes("hudTextMaxWidth"));
  assert.ok(tex.includes("XR_HUD_TEXT_INSET"));
  assert.ok(tex.includes("wrapHudCanvasText"));
  assert.ok(studio.includes("wrapHudCanvasText"));
  assert.ok(app.includes("uisharp=20260916-1"));
  assert.ok(html.includes("uisharp=20260916-1"));
  assert.ok(app.includes("tabface=20260916-2"));
  assert.ok(app.includes("vrtabs=20260916-1"));
  assert.ok(app.includes("vrsave=20260916-1"));
  assert.ok(app.includes("voicesample=20260916-1"));
});

test("drawtip=20260916-1: handheld draw tools hide the long laser and keep a controller tip", () => {
  assert.equal(handheldToolHidesLaser("draw"), true);
  assert.equal(handheldToolHidesLaser("voice_draw"), true);
  assert.equal(handheldToolHidesLaser("pen"), true);
  assert.equal(handheldToolHidesLaser("brush"), true);
  assert.equal(handheldToolHidesLaser("ink"), true);
  assert.equal(handheldToolHidesLaser("highlighter"), true);
  assert.equal(handheldToolHidesLaser("eraser"), true);
  assert.equal(handheldToolHidesLaser("line"), true);
  assert.equal(handheldToolHidesLaser("arrow"), true);
  assert.equal(handheldToolHidesLaser("board:pen"), true);
  assert.equal(handheldToolHidesLaser("board:tool:pen"), true);
  assert.equal(handheldToolHidesLaser("draw_brush_brush"), true);
  assert.equal(handheldToolHidesLaser("grab"), false);
  assert.equal(handheldToolHidesLaser("menu"), false);
  assert.equal(handheldToolHidesLaser("select"), false);
  assert.equal(handheldToolHidesLaser("board:move"), false);

  assert.equal(controllerHidesDrawLaser({ tool: "draw", hand: "right", drawHand: "right" }), true);
  assert.equal(controllerHidesDrawLaser({ tool: "pen", hand: "left", drawHand: "right" }), false);
  assert.equal(controllerHidesDrawLaser({ tool: "grab", hand: "right", drawHand: "right" }), false);

  assert.equal(laserVisibleForAim({ kind: "mesh" }, { hideLaser: true }), false);
  assert.equal(laserLengthForAim({ kind: "mesh", distance: 1.2 }, { hideLaser: true }), 0);
  assert.equal(laserVisibleForAim({ kind: "menu-tab" }, { force: true }), true);
  assert.equal(pointerTipVisible({ presenting: true, hideLaser: true }), true);
  assert.equal(pointerTipVisible({ presenting: true, useRay: false }), false);
  assert.ok(pointerTipOffsetM() <= 0.02);

  const here = dirname(fileURLToPath(import.meta.url));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const style = readFileSync(join(here, "xr-pointer-style.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  const html = readFileSync(join(here, "../index.html"), "utf8");
  assert.ok(xr.includes("drawtip=20260916-1"));
  assert.ok(style.includes("drawtip=20260916-1"));
  assert.ok(app.includes("drawtip=20260916-1"));
  assert.ok(html.includes("drawtip=20260916-1"));
  const rays = xr.slice(xr.indexOf("function updateControllerRays"), xr.indexOf("function worldMenuAabbs"));
  assert.ok(rays.includes("hideLaser"));
  assert.ok(rays.includes("pointerHideLaserForHand"));
  assert.ok(rays.includes("pointerTipVisible"));
  assert.ok(xr.includes("controllerTipPoint"));
  assert.ok(xr.includes("pointerTipOffsetM()"));
});
