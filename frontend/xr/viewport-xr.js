import { wiringGuideRows } from '../wiring/wiring-guide.js?v=20260916-harness1-harness2-harness3';
import { applyGenerationPlacement, generationSurfaceFromHit, usesWorkshopGenerationPlacement } from '../studio/generation-placement-three.js?v=20260923-spawn2';
import { canonicalCadPlacement, canonicalRoomTransform, canonicalWorkshopSpawn, isCanonicalWorkshopConfig, resolveCanonicalWorkshopLayout } from '../studio/workshop-scene-profile.js?v=20260929-workshop-scene-v3';
import { drawingWristHost, panelDragTranslatesOnly, liveVoiceXrSession } from './xr-interaction-state.js?v=20260916-repair1&astra=20260916-5';
import {createWristHistoryFlick, createStickHistoryFlick} from './xr-history-flick.js?v=wristfix1-xrtool1';
import {restoreControllerMaterial} from './xr-controller-material.js?v=wristfix1&astra=20260916-5';
import { createXrUiPressLatch } from './xr-ui-press-latch.js?v=20260916-settingsvoice1&settingsvoice=20260916-1';
import { captureVisibleWindowPoses, shouldRestoreWindowPoses } from './xr-window-resume.js?v=20260923-don-doff1';
import { clampWorkshopHeadToFloor, workshopAssetRotation, workshopStandingHead } from './workshop-desktop-navigation.js?v=20260923-workshop-upright1';
import { createXrTabbedWindows } from './xr-tabbed-windows.js?v=20260916-tabs1-xrperf3&vrtabs=20260916-1&compactwindows=20260916-2&tabface=20260916-2&uisharp=20260916-1&astra=20260916-5&xrwin1=1&dock1=1';
import { createHudRefreshGate, createMenuClarityControl } from './xr-hud-refresh.js?v=20260916-questperf1&uisharp=20260916-1';
import { createRoomInventory, INVENTORY_CHANNEL } from './xr-room-inventory.js?v=roomshare2';
import { createRoomCamera, CAMERA_CHANNEL } from './xr-room-camera.js?v=roomshare2&xrtalk=20260916-1&astra=20260916-5';
import { createRoomCameraView } from './xr-room-camera-view.js?v=roomshare2-vrnear1';
import { createXrRoboticsWorkspace } from './xr-robotics-workspace.js?v=20260930-right-save-picker1';
import { findWindowPlacement, windowFootprint, XR_WINDOW_SPAWN_DIST_M, windowFaceTowardHead, clampPanelNearHead } from "./xr-window-placement.js?v=vrnear1&tabface=20260916-2&roundtbl1=1";
import { studioRoboticsInputAllowed } from "./xr-robotics-input.js?v=roboticsworkspace3&teleopfix=20260916-1&inputfix=20260916-1&yarm1=1&menutrigger2=1";
import { roomFloorSeats, roomJoinSeat, floorRecenter, roomWalkAxes, roomStickAxes, stepRoomLocomotion, rightBHeld } from "./xr-room-navigation.js?v=roomfloor1-20260916-vrwalk1-xrtool1";
import { requestPiTeleop } from "./pi-teleop-client.js?v=20260927-teleop-auth2&devicesession=20260927-1&vrrobot=20260927-2";
import { readRoboticsProfile, roboticsOwnsExternalSession, roboticsIntegratedProfile, checkRoboticsProfileAfterWorkspaceUpdate } from "./robotics-profile.js?v=roboticsworkspace3&dimos-viser-local1";
import { createUiSurfaceRayPicker } from './xr-ui-surface-ray.js?v=20260916-inputfix1';
import { getDimosViewerSnapshot, startDimosHandCamPoll, stopDimosHandCamPoll } from "./xr-dimos-viewer.js?v=20260929-robot-overlays1";
import { createXrAiDrawWorkspace } from "./xr-ai-draw-workspace.js?v=20260923-draw-recordings1-spawn2";
import { collectSceneDrawingEvidence, exportSceneDrawingDocument } from './xr-scene-drawing-evidence.js?v=20260923-draw-evidence1';
import { createWorkspaceWorld } from "./xr-workspace-world.js?v=wsworld2";
import { createXrAgentAvatar } from "./xr-agent-avatar.js?v=20260915-xragent1-20260915-xragent3-20260916-voicewake1&vrtabs=20260916-1&settingsvoice=20260916-1&ctrlmic=20260916-1&voicesample=20260916-1&vrsave=20260916-1&xrtool1=1&astra=20260916-5&roundtbl1=1&desktop-wrist-hide=20261006-1";
import { createXrAgentPeers } from "./xr-agent-peers.js?v=20260915-xragent1-20260915-xragent3&astra=20260916-5";
import { createXrAgentJoin, XR_AGENT_JOIN_CHANNEL } from "./xr-agent-join.js?v=agentjoin1&workshop-agents=20260923-1";
import { createXrWiringView } from "./xr-wiring-view.js?v=20260915-xragent1-20260915-xragent3-vrnear1-harness2-harness3&vrtabs=20260916-1";
import { createXrToolTip, brushStyle } from "./xr-tool-appearance.js?v=20260915-toolcontext1";
import { getDimosControlPrefs, persistDimosControlPrefs } from "./xr-dimos-controls.js?v=sam-y-engage-v2";
/**
 * Quest AR/VR — Meta-style controllers + hand gestures (Quest 3 / Spectacles)
 *
 * Quest-lite (pinned): Jul 30 golden + crash-safe REAL CAD place/load.
 * No blue proxy cube. Tool dock follows a persisted left/right preference (default left). Capture strip kept.
 * Heavy Blocks/warehouse/full-body avatars parked in frontend/xr-dormant/
 * (revive for a native Quest app). Live person = shared-geometry humanoid +
 * device prop (hmd / visor / glasses / phone / none) + controllers.
 * Heavy Blocks/warehouse/CAD-create stay out — those crashed Quest.
 *
 * - Official XR controller models from @webxr-input-profiles (Quest, Vive, Index, Pico, …) + WebXR hand meshes
 * - Hand gestures: point (index ray), pinch click, pinch-hold grab, two-hand pinch resize
 * - xr-standard gamepad (select/squeeze/teleport/menu) on every HMD; hands-only on Quest 3 / Spectacles
 * - Tool dock follows a persisted left/right preference (default left; never auto-swaps on headset doff)
 * - Explorer opens a world-space panel you can grab and move
 * - AR passthrough kept clear (no black sky when looking around)
 * - NEVER scale=1 into a live Quest session; mid-XR soft project swap
 */

import * as THREE from "three";
import { xrPointerStyle, XR_POINTER_RADIUS_M, XR_POINTER_BEAM_RADIUS_M } from "./xr-pointer-style.js?v=20260915-finepointer2&astra=20260916-5&drawtip=20260916-1";
import { createXrWristPicker } from "./xr-wrist-picking.js?v=20260915-finepointer2";
import { createXrNearGrabPicker } from "./xr-near-grab.js?v=20260915-xrgrab1-xrgrab2-xrgrab3-xrgrab4-20260915-contact2-20260915-xrdispatch4";
import { hydrateXrSessionInputs } from "./xr-input-session.js?v=20260915-xrdispatch4";
import { refreshXrReferenceSpace } from "./xr-session-restart.js?v=20260915-xrdispatch4";
import { connectedSourceForSlot, controllerSlotForSource, controllerSlotForHand } from "./xr-input-binding.js?v=20260908-hand-lock1-rtrig2-20260914-vrfix1";
import { cachePresentationBounds, configurePromptTexture } from "./xr-presentation.js?v=20260908-presentation1-atrig1";
import { updateTeleopLabels } from "./xr-teleop-labels.js?v=20260929-y-calibrate1";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { XRControllerModelFactory } from "three/addons/webxr/XRControllerModelFactory.js";
import { XRHandModelFactory } from "three/addons/webxr/XRHandModelFactory.js";
import { nearestWorldEdgeFromHit } from "../viewport/picking.js?v=20260729-xr-edge&editctx=20260915-1&editscale=20260915-1";
import { createXrVoice } from "./xr-voice.js?v=20260908-xr-set1-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2&xrtalk=20260916-1&astra=20260916-5";
import { createXrPresence } from "./xr-presence.js?v=presence1-avatar1-golden1";
import {
  attachGltfTextureSkip,
  createXrPublicDrops,
  newDropObjectId,
} from "./xr-public-drops.js?v=20260908-xr-tex2-roomfloor1-20260916-vrsharemesh1-roomshare2";
import { createXrVoiceDraw } from "./xr-voice-draw.js?v=20260908-xr-set1-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2-20260915-toolcontext1&xrtalk=20260916-1&astra=20260916-5";
import { createXrDrawHud } from "./xr-draw-hud.js?v=20260908-xr-robotics1-wristrec1-keymap1-vrstudio1-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2-drawface1&xrtalk=20260916-1&lefthud1=1&astra=20260916-5";
import {
  aiHitBlockedByModelPicker,
  applyKeyboardKey,
  keyboardHit,
  keyboardLayout,
  loadingScreenHit,
  loadingScreenLayout,
  mcmasterThumbUrl,
  modelPickerHit,
  modelPickerLayout,
  progressHit,
  promptFieldHit,
  runRowHit,
  thumbRowHit,
} from "./xr-ai-compose.js?v=20260908-xr-ent4";
import {
  XR_VRPROJ1_CACHE,
  finishWorkspaceCreateName,
  roomOthersForShare,
  sanitizeProjectName,
  workspaceCreatePromptLines,
  workspaceCreateSharePayload,
} from "./xr-vr-project-create.js?v=vrproj1";
void XR_VRPROJ1_CACHE;
import { collapseRepeatedSpokenPrompt } from "../components/spoken-prompt.js?v=20260907-planetary-20";
import { buildHandPalette } from "./xr-hand-palette.js?v=20260909-xr-wm1-20260909-vrctrl1-20260909-xraim1-20260909-cast1-20260914-vrfix1-20260914-vrfreeze1-20260914-vrlaser1-20260914-vrmenu1-20260914-vrshare1-20260915-xrpoint1-20260915-xrperf2-xrclick1-20260915-xrctl1-logo1-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2&xrtalk=20260916-1&lefthud1=1&wristfix=20260916-3&ctrlmic=20260916-1&astra=20260916-5";
import {
  xrSharePanelLines,
  DISCORD_VR_HREF,
  xrShareXHref,
  readFlag,
  writeFlag,
  readPrinterLan,
  writePrinterLan,
  accessCodeIsSet,
  printerLanLabel,
  printSettingsLines,
  applyPrintSettingAction,
  printStartPayload,
  printerFencePointFromRay,
  printerFenceFromCorners,
  normalizePrinterFence,
  isLeftoverAutoPrinterFence,
  packPrinterBoxMessage,
  PRINTER_BOX_OBJECT_ID,
  readPrinterFence,
  writePrinterFence,
  applyPrinterConfigFields,
  printerConfigFromStorage,
  printerShareIconVisible,
  printerSendPcPayload,
  createBounderFence,
  fenceFromBounderMesh,
  PRINT_TAB_CACHE,
  PRINT_BOX2_CACHE,
} from "./xr-share-print.js?v=20260914-vrshare1-20260916-bambuip1-throwprint1-printbox1-xrperf3&printtab=20260916-1&printbox=20260916-2&bambu1=1&printerpin=20260923-1";
import {
  BAMBU1_CACHE,
  encodeProjectFilePath as encodeSlicerFilePath,
  parsePlateUtterance,
  partsInCircle,
  lassoToCircle,
  slicerVoiceContext,
  createXrSlicerPlatePreview,
  SLICER_MM_TO_M,
} from "./xr-slicer-plates.js?v=bambu1-xrctrl1";
import {
  createXrAiRoundTable,
  bindRoundTablePromptButtons,
  ideaTossLoop,
  mergeVoiceChatDebugPacket,
  collectAiChatLines,
  shouldPassLiveLogs,
  debuggerFixSuggestions,
  isMoveTableVoice,
  isEnableSandboxVoice,
  enableSandboxFromVoice,
  isTooMuchTalkVoice,
  isSamSuggestionVoice,
  applySamSuggestion,
  isSamCorrectionVoice,
  applySamSandboxCorrection,
  applyTooMuchTalk,
  laserTablePose,
  syncTopPromptSlot,
  toggleSandboxFromSlot,
  ROUNDTBL1_CACHE,
  ROUNDTBL2_CACHE,
  ROUNDTBL3_CACHE,
  ROUND_TABLE_LAST3,
  ROUND_TABLE_REQUEST_ID,
} from "./xr-ai-round-table.js?v=20260923-draw-recordings1&singlevoice1";
import { applyVoiceCommand, hydrateVoiceSelect, isVoiceExampleVoice, isVoiceSwapVoice } from "../sandbox/voice-select.js?v=singlevoice2";
import { createXrLiveControlClient } from "../sandbox/xr-control-live.js?v=xrctrl2&sbfix=20260917-2";
import { sandboxMenuProjects, openSandboxMenuFile, refreshSandboxProjectCache } from "../sandbox/vr-projects.js?v=sandbox2";
import { createSandboxViewportShapes, bindSandboxShapeVisibility } from "../sandbox/viewport-shapes.js?v=sandbox4";
void PRINT_TAB_CACHE;
void PRINT_BOX2_CACHE;
import {
  xrThumbstickClicked,
  shareThrowArmed,
  shareThrowWalkBlocked,
  isThrowPrintMesh,
  shareThrowNameplate,
  pickShareThrowTarget,
  shareThrowPoseAt,
  SHARE_THROW_ANIM_MS,
  SHARE_THROW_MIN_SPEED,
  printerVolumeFromProfile,
  printerBoxHit,
} from "./xr-share-throw.js?v=20260914-vrshare1-xrstick1-20260915-xrdbg2-throwprint1-printbox1-xrperf3";
import {
  bothThumbsticksClicked,
  debuggerEnterHeld,
  leftMenuOnlyHeld,
  leftMenuSourcesPosed,
  leftMenuHoldSource,
  tickStickRestart,
  tickLeftMenuRestart,
  tickExitVrHold,
  emptyStickRestartState,
  emptyLeftMenuRestartState,
  paintStickRestartHud,
  paintExitVrHoldCircle,
  offerXrSessionForSoftReload,
  xrIgnoreStickyPress,
  XR_DEBUGGER_HOLD_LABEL,
  XR_DEBUGGER_HOLD_MS,
  XR_LEFT_MENU_RESTART_HOLD_MS,
  XR_LEFT_MENU_RESTART_SETTLE_FRAMES,
  XR_LEFT_MENU_RESTART_SETTLE_MS,
  XR_ENTER_STICKY_IGNORE_MS,
  XR_STICK_RESTART_LABEL,
  XR_LEFT_MENU_RESTART_EVENT,
  XR_EXIT_VR_HOLD_MS,
  XR_EXIT_VR_HOLD_LABEL,
  XR_EXIT_VR_HOLD_EVENT,
} from "./xr-stick-restart.js?v=xrstick1-xrdbg1-xrdbg2-xrrest1-xrrest2-20260915-xrclick1-20260915-xrmenu2-20260915-xrdbg2-20260915-xrmenu3-20260915-xrdispatch4-xrgrab3&inputfix=20260916-1&exitvr=20260927-3";
import {
  paintDebuggerHud,
  compactHandsFromSources,
  debuggerActionFromCanvasPx,
  DEBUGGER_CANVAS,
} from "./xr-debugger-hud.js?v=xrdbg1-xrdbg2-20260915-xrdbg2-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2-20260915-toolcontext1&inputfix=20260916-1&teleop-y=20260922-poseconnect1&debugsend=20260927-1";
import {
  XR_CONTROL_HEADSETS,
  XR_CONTROL_MAP_EVENT,
  XR_LIVE_SAVE_EVENT,
  applyXrLiveControlDoc,
  activeXrHeadset,
  setXrControlHeadset,
  beginXrControlListen,
  tickXrControlListen,
  cancelXrControlListen,
  xrControlListenState,
  remapXrControlAction,
  resetXrControlMap,
  mappedButtonIndex,
  gamepadActionPressed,
  xrRestartIsLiveButton,
  vrControlsSettingsLines,
} from "./xr-control-map.js?v=xrmap1-xrdbg1-xrdbg2-xrrest1-xrrest2-20260915-xrclick1-20260915-xrmenu2-20260915-xrdbg2-20260915-xrmenu3-20260915-xrdispatch4&inputfix=20260916-1&xrctrl2=1";
import {
  drawFilledIcon,
  fillDarkMetalChrome,
  fillDarkMetalHeader,
  drawWindowCloseX,
  drawWindowOverflowDots,
  drawHudLabel,
  wrapHudCanvasText,
  hudTextMaxWidth,
  XR_HUD_TEXT_INSET,
} from "./xr-ui-tex.js?v=20260908-xr-robotics1-atrig1-20260914-vrmenu1&wristfix=20260916-3&uisharp=20260916-1&alltrans=20260916-1";
import {
  readPreferredDockHand,
  restorePreferredDockHand,
  seedDefaultDockHand,
  writePreferredDockHand,
  otherDockHand,
  normalizeDockHand,
  migrateMenuHandToLeft,
  xrDrawHand,
} from "./xr-dock-hand.js?v=20260908-xr-robotics1";
import {
  applyEquirectWrap,
  loadXrEnvironmentStore,
  loadXrEnvironmentListForMenu,
  upsertSavedEnvironment,
} from "./xr-environments.js?v=20260908-xr-set1-logo-ko1-logo1-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2&xrtalk=20260916-1&astra=20260916-5";
import {
  createXrEnterSplash,
  killBootSplashDomForXr,
  restoreBootSplashAfterXrFail,
  xrEnterFailMessage,
} from "./xr-enter-splash.js?v=20260908-xr-set1-20260909-xr-qfix1";
import { createXrToolWheel, mapWheelIntersection } from "./xr-tool-menu.js?v=20260909-xr-int1-20260909-xr-menu2-20260909-xr-vis1-20260914-vrlaser1";
import {
  isDimosStealingFaceButtons,
  isDimosStealingGrip,
  isDimosTeleopArmed,
  isDimosBlockingWalk,
  setDimosTeleopPresenting,
  tickDimosTeleop,
  pollDimosYControl,
  getDimosYControlDebug,
  getDimosNetworkDebug,
  getDimosControlDebug,
  setDimosTeleopArmed,
  getDimosTeleopState,
  getDimosRecordState,
  getDimosTeleopStats,
  startDimosRecord,
  stopDimosRecord,
  playDimosRecord,
  setDimosLoop,
  onDimosTeleopChange,
  resetDimosTeleopOnXrBoundary,
  ensureDimosCoordinatorIfDown,
  applyDimosRobotPcHost,
  setDimosStudioUiOverride,
  reserveDimosMenuTrigger,
  setDimosProfileUiState,
  releaseDimosMenuTrigger,
  requestDimosSafeHome,
  requestDimosHomeAndDisarm,
  requestDimosGripperClose,
} from "./xr-dimos-teleop.js?v=20260929-control-debug1";
import { createXrSolidDraw } from "./xr-solid-draw.js?v=20260908-xr-ent4-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2&xrtalk=20260916-1&astra=20260916-5&cubeturn=20260923-1";
import { createXrToolHand } from "./xr-tool-hand.js?v=20260909-xr-int1-20260909-xr-menu2-20260909-xr-vis1-20260909-vrctrl1-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2-20260915-toolcontext1-drawface1&xrtalk=20260916-1&lefthud1=1&wristfix=20260916-3&astra=20260916-5&cubeturn=20260923-1";
import {
  applyLayoutToPoseMap,
  layoutById,
  layoutNameSuggestions,
  layoutThumbCells,
  layoutThumbnailDataUrl,
  markLayoutUsed,
  mergeLayoutStores,
  nextLayoutName,
  parseLayoutStore,
  serializeOpenWindowsLayout,
  shouldAutoApplyLastLayout,
  stringifyLayoutStore,
  upsertNamedLayout,
  xrLayoutsStorageKey,
} from "./xr-window-layouts.js?v=20260907-xr-snap1";
import {
  bootEnterShouldCallSession,
  leftMonitorMenuPose,
  shouldReapplySavedMenuPoseOnBoot,
  xrEnterSessionMode,
  closestHudHit,
  commandCenterSlot,
  formatXrBattery,
  formatXrClock,
  hoverHighlightOn,
  hoverHighlightOpacity,
  panelDragEndsOnRelease,
  panelDragShouldDrop,
  panelChromeStartsDrag,
  panelGripTranslateOnly,
  clipViewerChromeLayout,
  clipViewerOverflowItems,
  pickClipViewerChrome,
  windowChromeTooltipForId,
  windowChromeHoverId,
  panelResizeScale,
  curvedScreenRadiusM,
  rankFriendsForClipSend,
  readClipSendRecents,
  writeClipSendRecent,
  clipFriendKeyLayout,
  applyClipFriendKey,
  roboticsBeatsStackedHud,
  selectPointerLengthM,
  selectPointerVisible,
  XR_SELECT_POINTER_M,
  shouldPersistPanelYaw,
  xrBatteryPercent,
  XR_SCENE_WIN_OS_LIMIT,
  XR_SCENE_WIN_CANVAS,
  XR_SCENE_WIN_PLANE,
  xrSceneWindowsDefaultState,
  xrSceneHtmlOverlayAllowed,
  xrSceneWindowWidthScale,
  nextXrSceneWindowWidthId,
  settingsWindowsTools,
  xrSceneWindowChromeRects,
  xrSceneUrlKeyLayout,
  applyXrSceneUrlKey,
  pickXrSceneWindowHit,
  isXrSceneWindowHitKind,
  normalizeXrSceneUrl,
  readXrSceneWindowUrl,
  writeXrSceneWindowUrl,
  readXrSceneWindowPrefs,
  writeXrSceneWindowPrefs,
} from "./xr-window-manager.js?v=20260909-xr-int1-20260909-xr-menu2-20260909-xr-vis1-20260909-xr-qfix1-20260909-vrctrl1-20260909-xraim1-xrwin1-20260915-contact2-20260915-xrdispatch4-passthrough2-menuroom1-vrnear1-xrperf3&vrsave=20260916-1";
import {
  listProjectReferenceFiles,
  paintReferenceDocCard,
  referenceFileUrl,
  referenceKindFromName,
  shouldOpenReferenceInWindow,
  workspaceReferenceButtonLine,
  workspaceReferenceLines,
} from "./xr-reference-files.js?v=20260909-xraim1";
import {
  assignRoundTableSeats,
  authorFromUserData,
  createXrBoard,
  defaultBoardPoseFromHead,
  formatAuthorChip,
  locomotionForMode,
  projectPointOnPlane,
  shouldShowAuthorChip,
  workspaceBoardLines,
} from "./xr-board.js?v=20260907-xr-prof1-roomfloor1";
import { createXrBuildTools, aabbCornersFromCenterSize } from "./xr-build-tools.js?v=20260908-xr-ent4-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2&xrtalk=20260916-1&astra=20260916-5";
import { createXrSocialCard } from "./xr-social-card.js?v=20260908-xr-ent4";
import { createXrStudioPanel, studioLinesForTab } from "./xr-studio-panel.js?v=noclose1-20260909-xr-wm1-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2-voiceactivate2-menutop2-vrnear1&xrtalk=20260916-1&uisharp=20260916-1&astra=20260916-5";
import { serializePromptBridge } from "./xr-prompt-bridge.js?v=20260907-xr-pin";
import {
  captureDockVisible,
  mapHistoryToStudioLines,
  poseMoved,
  poseSignature,
  publicProfileLinesForTab,
  publicProfileTabIds,
  publicProfileTabLabels,
  shouldApplyRemoteBoardLoco,
  shouldCheapMeshPick,
  shouldIncludeHeldPose,
  shouldPlaceCadThisFrame,
  shouldClearPendingCadPlace,
  XR_PENDING_PLACE_MAX,
  shouldUnhideXrCad,
  shouldBakeParkedXrCad,
  shouldMarkCadWorldAnchored,
  shouldKeepModelClearOfNearPlane,
  shouldRefreshXrContentBox,
  shouldSkipXrScaleBake,
  shouldReuseCachedXrBounds,
  shouldWalkXrPlaceAabb,
  shouldStopXrPlaceAabbWalk,
  xrWalkMeshesCapped,
  XR_PLACE_AABB_MESH_CAP,
  xrWorldBoxFromLocalBox,
  readXrLocalBox,
  stashXrLocalBox,
  stashXrLocalBoxFromOwnGeometry,
  shouldCloneXrPbrMaterials,
  shouldShareXrCadMaterial,
  shouldHideCadEdgesInXr,
  xrCadTreeCensus,
  xrCadUnhideUnits,
  xrUnhideFramePlan,
  shouldRevealXrHighPoly,
  shouldShowXrCadProxy,
  isXrCadGrabProxy,
  resolveStudioGripTarget,
  isStudioModelGrabMesh,
  studioAimHitsModel,
  studioTriggerMovesModel,
  XR_GRIP_MOVE_CACHE,
  viserRobotGripBlocked,
  shouldFlushDeferredXrProject,
  xrCadChildDrawLayer,
  XR_CAD_HOLD_LAYER,
  XR_UNHIDE_MESHES_PER_FRAME,
  XR_FIRST_FRAME_TRI_BUDGET,
  XR_MESH_TRI_HARD_CAP,
  XR_CAD_DRAW_MAX_PARTS,
  XR_CAD_DRAW_MAX_TRIS,
  shouldSkipWorldMeshPick,
  shouldExtraWorldPick,
  shouldTraverseCadForXrContentBox,
  applyXrRenderScale,
  XR_FRAMEBUFFER_SCALE,
  XR_FOVEATION,
  XR_PERF_CACHE,
  shouldSyncPrinterVisuals,
  shouldTickPrinterFencePreview,
  shouldPaintShareAimHud,
  shouldFollowHudThisFrame,
  shouldFormatXrClockHud,
  XR_HUD_CANVAS_SCALE,
  xrSessionFoveation,
  xrCadPaletteKey,
  xrCadPaletteHex,
  xrCadColorRgb,
  shouldRunXrEnterCanvasWork,
  shouldRunXrVoiceIceWork,
  xrAnnotateUnhideUnit,
  shouldSkipOverBudgetXrMesh,
  xrCadUnhideInProgress,
  shouldDisposeDesktopOnlyTarget,
  shouldKeepViewportVisibleWhilePresenting,
  applyXrPresentingViewportEl,
  shouldRebuildCaptureDock,
  shouldRebuildExplorerWhileBusy,
  shouldRebuildMenuHits,
  shouldRestoreSavedCadPoseOnEnter,
  shouldParkXrAssemblyAtTinyScale,
  shouldCloneCadGhostForAvatars,
  shouldRedrawXrConsole,
  shouldRelayerOverlays,
  applyOverlayMaterialFlags,
  applyWorldUiMaterialFlags,
  applyWorldUiPickMaterialFlags,
  isXrWorldPickMesh,
  skipXrInstancedPick,
  shouldCadTrianglePick,
  xrAiPanelSignature,
  xrGridPopupSignature,
  xrUiHoverSignature,
  shouldUpdateXrUiHover,
  shouldUploadXrVideoFrame,
  shouldTickXrPresence,
  shouldApplyOverlayRelayerFlags,
  shouldStopOverlayTraverse,
  XR_OVERLAY_RELAYER_MAX_MESHES,
  shouldBindSceneEnvironmentWhilePresenting,
  shouldApplyEnvironmentWrapNow,
  shouldApplyEquirectWrapToCadViewport,
  shouldHoverDrawablePick,
  shouldTickGuidesCanvas,
  shouldRunXrEnterDeferredWork,
  shouldDeferXrEnterWork,
  shouldHideCadOnXrEnter,
  shouldPrepareXrMeshesOnEnter,
  shouldSkipCadTrianglePick,
  shouldPickLiveCad,
  shouldCreateXrClipViewer,
  XR_ENTER_DEFER_MS,
  shouldPrepareXrMeshes,
  unbindMaterialWrapMaps,
  materialHasWrapMaps,
  disposeParkedWrapGpuFromObject,
  reviveParkedWrapGpuTextures,
  shouldSendXrPose,
  shouldTraverseSceneChrome,
  nametagBeatsDock,
  grabAttachesFromHit,
  xrConsoleSignature,
  xrFillLightsEnabled,
  XR_POSE_MIN_MS,
  headPoseFromDeviceOrientation,
  workspaceEnvironmentLines,
  workspaceSceneSettingsLines,
  PRINTER_ACCEPT_KEY,
  PRINTER_OUTLINE_KEY,
  PRINTER_MODEL_KEY,
  PRINTER_LAN_IP_KEY,
  PRINTER_SERIAL_KEY,
  PRINTER_NAME_KEY,
  PRINTER_ACCESS_KEY,
  BAMBU_DEFAULT_VOLUME_MM,
  PRINTER_LAN_IP_HINT,
  WORKSPACE_PANEL_TABS,
  WRIST_MENU_GRID_IDS,
  SETTINGS_PANEL_TAB_IDS,
  SETTINGS_PANEL_TAB_LABELS,
  roboticsSettingsLines,
  readRoboticsHudPrefs,
  ROBOTICS_PREFS_EVENT,
  XR_DEV_MODE_KEY,
  developerModeEnabled,
  shouldPostXrPerfSample,
  shouldUploadXrDebuggerLog,
  isFallbackXrManager,
  shouldSetupXrControllers,
  shouldRequestImmersiveArOnDesktop,
  desktopCameraArPlan,
  xrPassthroughShowsRealWorld,
  xrCheapVrStageVisible,
  shouldRebindXrDockHosts,
  shouldKeepFrozenDockPose,
  shouldRequireDockSideCheck,
  toolHandUiIds,
  createXrCreateHistory,
  parkXrObject,
  laserVisibleForHit,
  laserLengthM,
  laserVisibleForAim,
  laserLengthForAim,
  pointerTipOffsetM,
  pointerTipVisible,
  pointerVisibleWhilePresenting,
  controllerHidesDrawLaser,
  shouldOrbitGrabbedModel,
  reviveXrParkedMaterials,
  isXrSelectionAabb,
  hideXrSelectionAabbs,
  preferUiHoverHit,
  isXrUiHoverKind,
  laserPointerModeOn,
  presentingPickLasersOn,
  shouldDismissToolOnBPress,
  handheldToolHidesLaser,
  wristUiHitIsExclusive,
  closerUiHit,
  hudKindStaysWorldLocked,
  XR_LASER_MIN_M,
  applyXrClipViewerMaterialFlags,
  xrCaptureIsStillKind,
  xrMediaUrlWithToken,
  shouldResetStarterOnBHold,
  XR_STARTER_TOOL_ID,
  shouldTickDimosTeleop,
  shouldIngestDimosJpeg,
  shouldPollHandCamJpeg,
  shouldAttachDimosOnXrEnter,
  shouldEnsureDimosCoordinatorOnXrEnter,
  shouldRunStudioAHold,
  shouldRunStudioLaser,
  sourceOwnsStudioLaser,
  shouldRunStudioGripGrab,
  studioUiOverridesDimosSelect,
  sourceHasStudioFaceButtons,
  xrGamepadTriggerPressed,
  xrSelectDebounceBlocks,
  selectStartShouldCommit,
  xrSourceHandIndex,
  resolveSelectAim,
  resolvePosedAim,
  rayHitsAabb,
  xrPlaneWorldAabbFromMatrix,
  xrCircleWorldAabbFromMatrix,
  xrControlsUiTag,
  studioLeftMenuFacePressed,
  shouldToggleWristMenuOnLeftFace,
  XR_LASER_IDLE_STUB_M,
  shouldRestyleXrControllerOverlay,
  menuLaserRadiusM,
  applyXrSpacePoseToObject,
  xrAimPoseIsLive,
  xrMeshWorldAabbFromGeometry,
  XR_UI_PICK_CACHE,
  selectHitFromAimOrGrip,
  controllerOccludesWorldUi,
  controllerModelHiddenForUi,
  styleXrControllerOverlayMesh,
  disableXrPointerRaycast,
  preferHudHitOverCad,
  isXrChromeKind,
  isXrPanelGripHandleKind,
  hudHitStealsCad,
  isXrSqueezeOverlayKind,
  isExitVrHudHit,
  cadHoverGrabMesh,
  XR_CONTROLLER_OVER_UI_ORDER,
  XR_LASER_OVER_UI_ORDER,
  xrMeshIsWristOrHudUi,
  xrUiHitObjectIsLive,
  prepareXrUiRaycaster,
  restoreXrUiPickRaycast,
  preferHudActionHit,
  nearestDockToolId,
  laserPickNode,
  selectToolShowsPointer,
  sessionSelectEventShouldClick,
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
  wheelDismissLockActive,
  xrHudCanvasScale,
  xrHudCanvasBackingSize,
  uiPickBlocksGripGrab,
  nextToolAfterDimosArmChange,
  shouldKillBootSplashForXrPresent,
  shouldUseWindowRafWhileXrPresenting,
  shouldAllocateXrHudPanelOnSelectTick,
  shouldPaintXrHudPanelOnSelectTick,
  xrHudPanelNeedsDeferredPaint,
  shouldParseXrEnvironmentStoreOnSelectTick,
  shouldLetXrSelectReachDomTarget,
  shouldResizeXrUiCanvas,
  shouldUseLiteXrPanelChrome,
  shouldParseEnvironmentDataUrlsOnXrMenuOpen,
  shouldCreateWebglForXrSettings,
  shouldCaptureWebglFramebufferOnXrMenu,
  shouldAttachDrawHandToAimController,
  preferCrescentDockHit,
  xrViewToolIsCadHeavy,
  shouldRunCadHeavyXrViewTool,
  shouldSkipXrHudPanelPick,
  xrSpawnTargetM,
  xrSpawnInFrontOfHead,
  readXrComfortSizeM,
  writeXrComfortSizeM,
  readXrComfortDistM,
  writeXrComfortDistM,
  readXrVoicePrefs,
  writeXrVoicePrefs,
  XR_VOICE_PREFS_KEY,
  XR_VOICE_WANTED_KEY,
  xrSpectatorCaptureSize,
  shouldUseMenuAimTip,
  menuAimTipKind,
  controllerIsNearMenu,
  XR_MENU_AIM_NEAR_M,
  isXrWorldMenuHoverKind,
  wristYieldsToWorldMenu,
  xrUiPickBlocksDraw,
  detectHeadsetCastFamily,
  shouldOpenStreamCastPicker,
  streamCastFooterHint,
  stickHistoryFlickEnabled,
  xrHudClickStartsWindowDrag,
  panelWorldPoseIsKept,
} from "./xr-hot-path.js?v=roboticsworkspace3-presence1-20260916-visergrip1-drawface1-xrperf3-gripmove1-xrgrab2-xrgrab3-xrgrab4-xrtool1-xrwin1&xrtalk=20260916-1&lefthud1=1&vrsave=20260916-1&uisharp=20260916-1&astra=20260916-5&drawtip=20260916-1&alltrans=20260916-1&voice1=1&yarm1=1&cubeturn=20260923-1";
import {
  isXrHudLocked,
  writeXrHudLocked,
  toggleXrHudLocked,
  hudHeaderHitLayout,
  hudRotateHitLayout,
  hudOverflowMenuLayout,
  pickHudHeader,
  shouldFollowBeltHud,
} from "./xr-hud-lock.js?v=20260908-xr-robotics1-blaser1-atrig1-xr-wm1-voiceactivate2-menutop2";
import {
  ROBOTICS_CANVAS,
  ROBOTICS_PLANE,
  paintRoboticsHud,
  pickRoboticsHud,
  roboticsLayout,
  roboticsCanvasPxFromHit,
  isRoboticsHudKind,
  rightControllerRecordingUi,
} from "./xr-robotics-hud.js?v=20260930-right-save-picker1";
import {
  HAND_CAM_WRIST_SIZE,
  WRIST_CAM_HIDE_SIZE,
  ensureHandCamPublish,
  clampHandCamSize,
  handCamJpegUrl,
  isHandCamJpegLive,
  paintHandCamFrame,
  paintWristCamHideButton,
  persistHandCamMode,
  persistHandCamVrScene,
  readHandCamPrefs,
  restoreWristCamSize,
  shouldShowHandCamWindow,
  shouldShowWristCamHideButton,
  wristCamHideButtonLocal,
  wristCamHideHitFromLocal,
  wristCamHudPosition,
  wristCamPointerIsOtherHand,
} from "./xr-hand-cams.js?v=roboticsworkspace3&teleopperf=20260927-1";
import { createXrCheapVrStage, createXrCheapWarehouseStage } from "./xr-white-room.js?v=20260923-spawn1";
import { createXrDevStats } from "./xr-dev-stats.js?v=20260908-xr-ent4-20260914-foundry-logs1-xrctl1-20260915-xrdbg1-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2-20260915-toolcontext1-vrnear1&xrtalk=20260916-1&astra=20260916-5&inputfix=20260916-1-deskdbg1&teleop-y=20260922-poseconnect1";
import {
  xrSelectConsumeTarget,
  compactTalkControlsFeed,
  XRCTRL1_CACHE,
  XRCTRL2_CACHE,
} from "./xr-controls-debug.js?v=xrctl1-xrstick1-xrrest1-xrrest2-20260915-xrdbg1-20260915-xrdbg2-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2-20260915-toolcontext1&inputfix=20260916-1&xrctrl1=1&xrctrl2=1&teleop-y=20260922-poseconnect1";
import {
  GUIDES_CANVAS,
  GUIDES_PLANE,
  paintGuidesPanel,
  pickGuidesHit,
  wrapGuideClipIndex,
  swipeGuideFromDeltaX,
  guideCategoryById,
} from "./xr-guides.js?v=20260907-xr-guide1-keymap1-vrstudio1";
import {
  startWorkspacePassthrough,
  stopWorkspacePassthrough,
  isMobileLike,
} from "./mobile-ar.js?v=20260908-xr-ent4-20260915-contact2-20260915-xrdispatch4-20260915-finepointer2&xrtalk=20260916-1&astra=20260916-5";
import {
  readXrCollabSpace,
  writeXrCollabSpace,
  remoteHeldAffectsLocalMesh,
  remoteHeldShowsGhost,
} from "./xr-collab-policy.js?v=20260908-xr-ent4";
import {
  applyAvatarAction,
  avatarSettingsLines,
  buildProceduralHumanoid,
  canLinkHorizon,
  compactAvatarForPose,
  deviceLabelFromUser,
  HORIZON_AVATAR_NOTE,
  isXrStandardControllerProfile,
  loadAvatarSpec,
  saveAvatarSpec,
  tickAvatarPreview,
  xrHeadsetFromUa,
} from "./xr-avatar.js?v=avatar1-golden1";

const LS_POSE = "render3d:xr-room-pose";
const LS_SPAWN = "render3d:xr-spawn-preset";
const LS_VOICE = XR_VOICE_WANTED_KEY;
const LS_VOICE_PREFS = XR_VOICE_PREFS_KEY;
const LS_PASSTHROUGH = "render3d:xr-passthrough";

/** Characteristic size after project load / Fit — 12 cm in front of the user. */
const HANDHELD_SIZE_M = 0.12;
const ROOM_SIZE_MIN_M = 0.08;
const ROOM_SIZE_MAX_M = 1.35;
const TOSS_DELETE_SPEED_MPS = 2.4;
const TOSS_ANIM_MS = 520;

/** Hand pinch thresholds (meters between thumb tip and index tip). Hysteresis avoids flicker. */
const HAND_PINCH_START_M = 0.032;
const HAND_PINCH_RELEASE_M = 0.048;

const SPAWN_PRESETS = [
  { id: "eye", label: "In front of you", distance: 0.45, sizeM: HANDHELD_SIZE_M },
  { id: "near", label: "Near (arm)", distance: 0.42, sizeM: HANDHELD_SIZE_M },
  { id: "far", label: "Farther", distance: 0.85, sizeM: HANDHELD_SIZE_M },
  { id: "floor", label: "Lower / floor", distance: 0.55, sizeM: HANDHELD_SIZE_M, yMode: "floor" },
];

const DOCK_TOOLS = [
  { id: "menu", label: "Menu", color: 0x1c1917, icon: "menu" },
  { id: "ai", label: "AI", color: 0xe85d4c, icon: "ai" },
  { id: "draw", label: "Draw", color: 0x06b6d4, icon: "draw" },
  { id: "view", label: "View", color: 0x64748b, icon: "view" },
  { id: "tools", label: "Tools", color: 0x3b82f6, icon: "move" },
  { id: "social", label: "Social", color: 0x0ea5e9, icon: "social" },
  { id: "workspace", label: "Workspace", color: 0x0ea5e9, icon: "workspace" },
  { id: "robotics", label: "Robot", color: 0xf97316, icon: "robot" },
  { id: "exit", label: "Exit VR", color: 0x7f1d1d, icon: "exit" },
];
const DOCK_HIT_MAX_M = 1.45;

const MENU_TABS = [
  { id: "projects", label: "Projects" },
  { id: "parts", label: "Models" },
  { id: "files", label: "Files" },
  { id: "social", label: "Social" },
  { id: "ai", label: "AI" },
  { id: "tools", label: "Tools" },
  { id: "view", label: "View" },
];

const TOOL_ACTIONS = [
  { id: "front", label: "Place in front", section: "tools", icon: "front" },
  { id: "place", label: "Placement presets", section: "tools", icon: "place" },
  { id: "zoom_in", label: "Scale up", section: "tools", icon: "plus" },
  { id: "zoom_out", label: "Scale down", section: "tools", icon: "minus" },
  { id: "restore", label: "Restore saved pose", section: "tools", icon: "restore" },
  { id: "export", label: "Export model", section: "tools", icon: "export" },
  { id: "bambu", label: "Export to slicer", section: "tools", icon: "bambu" },
  { id: "voice_draw", label: "Draw · talk + sketch in 3D", section: "tools", icon: "draw" },
  { id: "draw_canvas", label: "Canvas · 2D design + AI", section: "tools", icon: "draw" },
  { id: "generation_surface", label: "New model · pick spawn face", section: "tools", icon: "move" },
  { id: "generation_size_small", label: "New model size · 0.3 m", section: "tools", icon: "minus" },
  { id: "generation_size_medium", label: "New model size · 0.6 m", section: "tools", icon: "move" },
  { id: "generation_size_large", label: "New model size · 1 m", section: "tools", icon: "plus" },
  { id: "voice_mold", label: "Voice mold · talk + point", section: "tools", icon: "mic" },
  { id: "voice_mold_model", label: "Voice model: Realtime Mini", section: "tools", icon: "ai" },
  { id: "fit", label: "Fit / recenter", section: "view", icon: "fit" },
  { id: "room_floor", label: "Recenter everyone on floor", section: "view", icon: "floor" },
  { id: "explode", label: "Toggle explode", section: "view", icon: "explode" },
  { id: "section", label: "Toggle section", section: "view", icon: "section" },
  { id: "wireframe", label: "Toggle wireframe", section: "view", icon: "wire" },
  { id: "units", label: "Cycle units", section: "view", icon: "units" },
  { id: "screenshot", label: "Screenshot → PC / Share to X", section: "view", icon: "cam" },
  { id: "shot_share_x", label: "Share last shot to X", section: "view", icon: "cam" },
  { id: "shot_send_pc", label: "Send last shot to computer", section: "view", icon: "cam" },
  { id: "studio", label: "Studio · history / access / keys", section: "tools", icon: "menu" },
  { id: "robotics", label: "Robotics · DIMOS teleop / record / loop", section: "tools", icon: "robot" },
  { id: "send_prompt_pc", label: "Send prompt + sketches to laptop", section: "tools", icon: "export" },
  { id: "snap", label: "Cycle snap grid", section: "tools", icon: "snap" },
  { id: "symmetry", label: "Cycle symmetry", section: "tools", icon: "sym" },
  { id: "combine", label: "Cycle boolean combine", section: "tools", icon: "box" },
  { id: "revolve", label: "Revolve last stroke", section: "tools", icon: "cyl" },
  { id: "loft", label: "Loft last two strokes", section: "tools", icon: "draw" },
  { id: "scale", label: "Scale · trigger and pull", section: "tools", icon: "move" },
  { id: "group_select", label: "Group · hold trigger to paint-select", section: "tools", icon: "group" },
  { id: "record", label: "Record (Stop on Capture puck)", section: "view", icon: "rec" },
];

const MENU_CANVAS = {
  // Keep under ~1MP — Meta Browser OOMs on 1400×980 redraws during project swaps.
  w: 1024,
  h: 720,
  headerEnd: 72,
  tabStart: 86,
  tabEnd: 136,
  listTop: 168,
  rowH: 58,
  footerTop: 660,
};
const MENU_PLANE = { w: 0.68, h: 0.48 };

const VIEW_TOOLS = [
  { id: "fit", label: "Fit", icon: "fit", color: 0xf59e0b },
  { id: "room_floor", label: "Recenter room", icon: "floor", color: 0x94a3b8 },
  { id: "explode", label: "Explode", icon: "explode", color: 0xec4899 },
  { id: "wireframe", label: "Wire", icon: "wire", color: 0x94a3b8 },
  { id: "section", label: "Section", icon: "section", color: 0x6366f1 },
  { id: "transparent", label: "Ghost", icon: "ghost", color: 0x22d3ee, split: "transparent_all" },
  { id: "screenshot", label: "Shot", icon: "cam", color: 0x38bdf8 },
  { id: "tree", label: "Tree", icon: "tree", color: 0x22c55e },
  { id: "agent", label: "Agent", icon: "agent", color: 0xe85d4c },
  { id: "knowledge", label: "Knowledge", icon: "knowledge", color: 0x0ea5e9 },
  { id: "units", label: "Units", icon: "units", color: 0xa855f7 },
  { id: "record", label: "Rec", icon: "rec", color: 0xef4444 },
];
const VIEW_CANVAS = { w: 720, h: 560, headerEnd: 68, cols: 3 };
const VIEW_PLANE = { w: 0.40, h: 0.31 };
const VIEW_TOOL_SPLIT_PX = 44;

const AI_HUB_TOOLS = [
  { id: "ai_panel", label: "Prompt", icon: "ai", color: 0xe85d4c },
  { id: "prompt", label: "Generate", icon: "run", color: 0x16a34a },
  { id: "draw", label: "Draw", icon: "draw", color: 0x06b6d4 },
  { id: "voice_mold", label: "Talk", icon: "mic", color: 0x8b5cf6 },
  { id: "send_prompt_pc", label: "To laptop", icon: "export", color: 0x0ea5e9 },
];
const TOOLS_POPUP_TOOLS = [
  { id: "grab", label: "Move", icon: "move", color: 0x64748b },
  { id: "measure", label: "Measure", icon: "measure", color: 0x14b8a6 },
  { id: "place", label: "Place", icon: "place", color: 0x3b82f6 },
  { id: "front", label: "In front", icon: "front", color: 0xf59e0b },
  { id: "zoom_in", label: "Bigger", icon: "plus", color: 0x22c55e },
  { id: "zoom_out", label: "Smaller", icon: "minus", color: 0x94a3b8 },
  { id: "undo", label: "Undo", icon: "undo", color: 0x94a3b8 },
  { id: "export", label: "Export", icon: "export", color: 0x0ea5e9 },
  { id: "wheel", label: "Wheel", icon: "wheel", color: 0xf59e0b },
  { id: "group_select", label: "Group", icon: "group", color: 0x38bdf8 },
  { id: "stamp", label: "Stamp", icon: "copy", color: 0x0ea5e9 },
  { id: "array", label: "Array", icon: "group", color: 0xf97316 },
  { id: "slice", label: "Slice", icon: "slice", color: 0xf43f5e },
  { id: "mirror", label: "Mirror", icon: "sym", color: 0xc084fc },
  { id: "studio", label: "Studio", icon: "menu", color: 0xf59e0b },
  { id: "restore", label: "Restore", icon: "restore", color: 0x64748b },
];
const SETTINGS_CONTROLLER_TOOLS = [
  { id: "hand_left", label: "Menu L", icon: "hand_left", color: 0x0f766e },
  { id: "hand_right", label: "Menu R", icon: "hand_right", color: 0x334155 },
  { id: "passthrough", label: "Pass", icon: "pass", color: 0x06b6d4 },
  { id: "board", label: "Board", icon: "floor", color: 0x0ea5e9 },
  { id: "walk", label: "Walk", icon: "front", color: 0x22c55e },
  { id: "teleport", label: "Teleport", icon: "place", color: 0xf59e0b },
  { id: "space_shared", label: "Shared", icon: "social", color: 0x22c55e },
  { id: "space_local", label: "My copy", icon: "move", color: 0x64748b },
  { id: "wheel", label: "Wheel", icon: "wheel", color: 0xf59e0b },
  { id: "guides", label: "Guides", icon: "knowledge", color: 0x8b5cf6 },
];
const SETTINGS_TOOLS = SETTINGS_CONTROLLER_TOOLS;
const DRAW_MENU_TOOLS = [
  { id: "draw_ai_prompt", label: "AI Prompt", icon: "ai", color: 0x8bbfc8 },
  { id: "color_e85d4c", label: "Red", icon: "draw", color: 0xe85d4c },
  { id: "color_f59e0b", label: "Amber", icon: "draw", color: 0xf59e0b },
  { id: "color_22c55e", label: "Green", icon: "draw", color: 0x22c55e },
  { id: "color_06b6d4", label: "Cyan", icon: "draw", color: 0x06b6d4 },
  { id: "color_3b82f6", label: "Blue", icon: "draw", color: 0x3b82f6 },
  { id: "color_f8fafc", label: "White", icon: "draw", color: 0xf8fafc },
  { id: "draw_size_s", label: "Fine", icon: "minus", color: 0x94a3b8 },
  { id: "draw_size_m", label: "Med", icon: "draw", color: 0x06b6d4 },
  { id: "draw_size_l", label: "Bold", icon: "plus", color: 0xe85d4c },
  { id: "draw_eraser", label: "Eraser", icon: "eraser", color: 0xf97316 },
];
const SOCIAL_HUB_TOOLS = [
  { id: "voice_toggle", label: "Mic", icon: "mic", color: 0x22c55e },
  { id: "public_join", label: "Room", icon: "room", color: 0x38bdf8 },
  { id: "team_join", label: "Agents", icon: "agent", color: 0xe85d4c },
  { id: "room_open", label: "People", icon: "social", color: 0xa855f7 },
  { id: "avatar", label: "Avatar", icon: "social", color: 0xa855f7 },
  { id: "social_more", label: "More", icon: "menu", color: 0x64748b },
  { id: "guides", label: "Guides", icon: "knowledge", color: 0x8b5cf6 },
];
const GRID_POPUP_SPECS = {
  aiHub: {
    title: "AI",
    subtitle: "PROMPT · GENERATE · DRAW · TALK",
    tools: AI_HUB_TOOLS,
    poseKind: "aiHub",
    defaultRight: 0.36,
  },
  tools: {
    title: "Tools",
    subtitle: "MOVE · MEASURE · PLACE · MORE",
    tools: TOOLS_POPUP_TOOLS,
    poseKind: "tools",
    defaultRight: 0.26,
  },
  settings: {
    title: "Settings",
    subtitle: "CTRL · VR · ENV · WINDOWS · ROBOTICS · DEV",
    footer: "Shared moves the model for everyone · My copy is local",
    tools: SETTINGS_TOOLS,
    poseKind: "settings",
    defaultRight: -0.34,
  },
  draw: {
    title: "Draw",
    subtitle: "COLOR · SIZE · ERASER",
    footer: "Strokes start at the controller tip",
    tools: DRAW_MENU_TOOLS,
    poseKind: "draw",
    defaultRight: 0.28,
  },
  social: {
    title: "Social",
    subtitle: "MIC · ROOM · AGENTS · PEOPLE · AVATAR",
    footer: "Mute keeps the headset stream — unmute flips the track back on",
    tools: SOCIAL_HUB_TOOLS,
    poseKind: "socialHub",
    defaultRight: -0.16,
  },
};

/** Canvas tab rectangles — must match drawConsoleCanvas exactly. */
function menuTabLayout(tabs = MENU_TABS) {
  const width = MENU_CANVAS.w;
  const list = Array.isArray(tabs) && tabs.length ? tabs : MENU_TABS;
  const n = Math.max(list.length, 1);
  const tabW = Math.min(200, (width - 72) / n - 10);
  return list.map((tab, i) => ({
    id: tab.id,
    x: 36 + i * (tabW + 10),
    w: tabW,
    y: MENU_CANVAS.tabStart,
    h: MENU_CANVAS.tabEnd - MENU_CANVAS.tabStart,
  }));
}

/** Canvas px → panel local (top of texture = +y). */
function menuCanvasToLocal(px, py, z = 0.006) {
  return new THREE.Vector3(
    (px / MENU_CANVAS.w - 0.5) * MENU_PLANE.w,
    (0.5 - py / MENU_CANVAS.h) * MENU_PLANE.h,
    z,
  );
}

function menuCanvasSizeToLocal(pw, ph) {
  return {
    w: (pw / MENU_CANVAS.w) * MENU_PLANE.w,
    h: (ph / MENU_CANVAS.h) * MENU_PLANE.h,
  };
}


const AI_CANVAS = { w: 1080, h: 1280 };
const AI_PLANE = { w: 0.42, h: 0.5 };
const AI_LAYOUT = {
  headerEnd: 88,
  mic: { cx: 140, cy: 198, r: 58 },
  tableBtn: { x: 214, y: 108, w: 236, h: 152 },
  transcript: { x: 464, y: 100, w: 576, h: 176 },
  thumbs: { y: 292, h: 92, n: 4 },
  keyY: 408,
  modelY: 494,
  modeY: 580,
  speedY: 666,
  targetY: 752,
  progress: { y: 840, h: 44 },
  historyY: 900,
  historyH: 40,
  historyN: 1,
  run: { y: 958, h: 78 },
  hide: { y: 1174, h: 46 },
};
const KB_CANVAS = { w: 1080, h: 420 };
const KB_PLANE = { w: 0.42, h: 0.164 };
const LOAD_CANVAS = { w: 1080, h: 1400 };
const LOAD_PLANE = { w: 0.42, h: 0.54 };
const _aiThumbImgs = new Map();
const _menuAvatarImgs = new Map();
let _onMenuAvatarLoad = null;
let _menuAvatarLoadTimer = 0;

function absAvatarUrl(url) {
  const s = String(url || "").trim();
  if (!s) return "";
  if (s.startsWith("data:") || s.startsWith("blob:") || /^https?:\/\//i.test(s)) return s;
  try { return new URL(s, location.origin).href; } catch { return s; }
}

function getMenuAvatarImg(src) {
  const url = absAvatarUrl(src);
  if (!url) return null;
  let img = _menuAvatarImgs.get(url);
  if (img) return img.complete && img.naturalWidth ? img : null;
  img = new Image();
  img.decoding = "async";
  if (/^https?:\/\//i.test(url) && !url.startsWith(location.origin)) {
    img.crossOrigin = "anonymous";
  }
  img.onload = () => {
    if (_menuAvatarLoadTimer) return;
    _menuAvatarLoadTimer = setTimeout(() => {
      _menuAvatarLoadTimer = 0;
      try { _onMenuAvatarLoad?.(url); } catch { /* ignore */ }
    }, 80);
  };
  img.src = url;
  _menuAvatarImgs.set(url, img);
  if (_menuAvatarImgs.size > 48) {
    const first = _menuAvatarImgs.keys().next().value;
    _menuAvatarImgs.delete(first);
  }
  return img.complete && img.naturalWidth ? img : null;
}

function getAiThumbImg(src) {
  const url = String(src || "");
  if (!url.startsWith("data:image") && !url.startsWith("blob:")) return null;
  let img = _aiThumbImgs.get(url);
  if (img) return img.complete && img.naturalWidth ? img : null;
  img = new Image();
  img.decoding = "async";
  img.src = url;
  _aiThumbImgs.set(url, img);
  if (_aiThumbImgs.size > 16) {
    const first = _aiThumbImgs.keys().next().value;
    _aiThumbImgs.delete(first);
  }
  return img.complete && img.naturalWidth ? img : null;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawGlyphIcon(ctx, icon, cx, cy, size, color = "#e2e8f0") {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2.5, size * 0.08);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const s = size * 0.32;
  if (icon === "menu") {
    for (const dy of [-s * 0.7, 0, s * 0.7]) {
      ctx.beginPath();
      ctx.moveTo(cx - s, cy + dy);
      ctx.lineTo(cx + s, cy + dy);
      ctx.stroke();
    }
  } else if (icon === "undo") {
    ctx.beginPath();
    ctx.arc(cx, cy, s, Math.PI * 0.2, Math.PI * 1.4, true);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.2, cy - s);
    ctx.lineTo(cx - s, cy - s * 0.35);
    ctx.lineTo(cx - s * 0.05, cy - s * 0.25);
    ctx.fill();
  } else if (icon === "redo") {
    ctx.beginPath();
    ctx.arc(cx, cy, s, Math.PI * 0.8, Math.PI * -0.4, false);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.2, cy - s);
    ctx.lineTo(cx + s, cy - s * 0.35);
    ctx.lineTo(cx + s * 0.05, cy - s * 0.25);
    ctx.fill();
  } else if (icon === "move") {
    ctx.beginPath();
    ctx.moveTo(cx - s, cy); ctx.lineTo(cx + s, cy);
    ctx.moveTo(cx, cy - s); ctx.lineTo(cx, cy + s);
    ctx.stroke();
  } else if (icon === "measure") {
    ctx.beginPath();
    ctx.moveTo(cx - s, cy + s * 0.4);
    ctx.lineTo(cx + s, cy - s * 0.4);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - s, cy + s * 0.4, s * 0.22, 0, Math.PI * 2);
    ctx.arc(cx + s, cy - s * 0.4, s * 0.22, 0, Math.PI * 2);
    ctx.fill();
  } else if (icon === "exit") {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.7, cy - s * 0.7);
    ctx.lineTo(cx + s * 0.7, cy + s * 0.7);
    ctx.moveTo(cx + s * 0.7, cy - s * 0.7);
    ctx.lineTo(cx - s * 0.7, cy + s * 0.7);
    ctx.stroke();
  } else if (icon === "draw") {
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.85, cy + s * 0.75);
    ctx.lineTo(cx - s * 0.15, cy - s * 0.85);
    ctx.lineTo(cx + s * 0.15, cy - s * 0.55);
    ctx.lineTo(cx - s * 0.55, cy + s * 1.05);
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.2, cy - s * 0.9);
    ctx.lineTo(cx + s * 0.55, cy - s * 0.5);
    ctx.stroke();
  } else if (icon === "mic") {
    roundRect(ctx, cx - s * 0.35, cy - s, s * 0.7, s * 1.2, s * 0.35);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy + s * 0.35, s * 0.7, 0, Math.PI, false);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 1.05); ctx.lineTo(cx, cy + s * 1.4);
    ctx.moveTo(cx - s * 0.45, cy + s * 1.4); ctx.lineTo(cx + s * 0.45, cy + s * 1.4);
    ctx.stroke();
  } else if (icon === "ai") {
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.85, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx - s * 0.3, cy - s * 0.1, s * 0.15, 0, Math.PI * 2);
    ctx.arc(cx + s * 0.3, cy - s * 0.1, s * 0.15, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // default diamond
    ctx.beginPath();
    ctx.moveTo(cx, cy - s);
    ctx.lineTo(cx + s, cy);
    ctx.lineTo(cx, cy + s);
    ctx.lineTo(cx - s, cy);
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

function makeIconTexture(glyph, bgHex, label, icon = null) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  // Brushed metal disc
  const g = ctx.createRadialGradient(90, 80, 10, 128, 128, 120);
  g.addColorStop(0, "#f8fafc");
  g.addColorStop(0.35, "#94a3b8");
  g.addColorStop(0.7, "#334155");
  g.addColorStop(1, "#0f172a");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(128, 128, 118, 0, Math.PI * 2);
  ctx.fill();
  const c = new THREE.Color(bgHex);
  ctx.strokeStyle = `#${c.getHexString()}`;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(128, 128, 112, 0, Math.PI * 2);
  ctx.stroke();
  drawGlyphIcon(ctx, icon || "move", 128, 118, 140, "#f8fafc");
  if (label) {
    ctx.fillStyle = "rgba(248,250,252,0.92)";
    ctx.font = "bold 28px Arial,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(label).slice(0, 8), 128, 200);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

function sharpenCanvasTex(tex, anisotropy = 4) {
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = Math.max(1, Math.min(8, Number(anisotropy) || 4));
  tex.needsUpdate = true;
  return tex;
}

function fitXrUiCanvas(el, width, height) {
  if (!el) return el;
  if (shouldResizeXrUiCanvas(el, width, height)) {
    el.width = width;
    el.height = height;
  }
  return el;
}

/** Logical HUD layout with a 2× (or DPR) backing store — Quest text stays sharp. */
let xrHudClockLabel = "--:--";
let xrHudBatteryLabel = "—";
let xrHudHoverId = "";
let xrNavigatorBattery = null;

function paintHudClockBattery(ctx, width, headerEnd) {
  if (!ctx) return;
  const y = Math.round((Number(headerEnd) || 68) * 0.42);
  const text = `⏱ ${xrHudClockLabel}   🔋 ${xrHudBatteryLabel}`;
  ctx.font = "800 20px Arial,sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#020617";
  ctx.fillStyle = "#e0f2fe";
  const x = Math.max(220, (Number(width) || 720) - 190);
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
}

function bindHudCanvas2d(canvas, logicalW, logicalH) {
  const scale = xrHudCanvasScale();
  const backing = xrHudCanvasBackingSize(logicalW, logicalH, scale);
  if (canvas.width !== backing.width) canvas.width = backing.width;
  if (canvas.height !== backing.height) canvas.height = backing.height;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = true;
  if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = "high";
  wrapHudCanvasText(ctx, logicalW, XR_HUD_TEXT_INSET);
  return ctx;
}

function drawPanelCanvas(title, lines, footer = "") {
  return drawConsoleCanvas({ title, tabs: [], activeTab: "", lines, footer });
}

function paintHudOverflowDropdown(ctx, width, headerEnd, { overflowOpen = false, locked = false } = {}) {
  if (!overflowOpen || !ctx) return;
  const menu = hudOverflowMenuLayout(width, headerEnd, { locked });
  ctx.fillStyle = "#0f172a";
  roundRect(ctx, menu.x, menu.y, menu.w, menu.h, 14);
  ctx.fill();
  ctx.strokeStyle = "#e2e8f0";
  ctx.lineWidth = 4;
  roundRect(ctx, menu.x + 2, menu.y + 2, menu.w - 4, menu.h - 4, 12);
  ctx.stroke();
  for (const cell of menu.rows || []) {
    const on = cell.id === "lock" || cell.id === "unlock";
    ctx.fillStyle = on && locked ? "#166534" : "#1e293b";
    roundRect(ctx, cell.x, cell.y, cell.w, cell.h, 10);
    ctx.fill();
    drawHudLabel(ctx, cell.label, cell.x + cell.w / 2, cell.y + cell.h / 2, {
      font: "800 20px Arial,sans-serif",
      align: "center",
      lineWidth: 6,
      maxWidth: cell.w - 16,
    });
  }
}

function drawConsoleCanvas({ title, tabs = [], activeTab = "", lines = [], footer = "", canvas: reuse = null, overflowOpen = false, locked = false } = {}) {
  const width = MENU_CANVAS.w;
  const height = MENU_CANVAS.h;
  const canvas = reuse && reuse.getContext ? reuse : document.createElement("canvas");
  const ctx = bindHudCanvas2d(canvas, width, height);

  fillDarkMetalChrome(ctx, width, height, 28);
  fillDarkMetalHeader(ctx, width, MENU_CANVAS.headerEnd, 28);
  drawWindowOverflowDots(ctx, width, MENU_CANVAS.headerEnd);
  drawWindowCloseX(ctx, width, MENU_CANVAS.headerEnd);
  paintHudClockBattery(ctx, width, MENU_CANVAS.headerEnd);
  paintHudOverflowDropdown(ctx, width, MENU_CANVAS.headerEnd, { overflowOpen, locked });

  drawHudLabel(ctx, String(title || "Render Studio").slice(0, 22), 36, Math.round(MENU_CANVAS.headerEnd * 0.42), {
    font: "800 42px Arial,sans-serif",
    lineWidth: 8,
    maxWidth: width - 168,
  });
  drawHudLabel(ctx, "SPATIAL WORKSPACE", 36, Math.round(MENU_CANVAS.headerEnd * 0.72), {
    font: "800 22px Arial,sans-serif",
    fill: "#7dd3fc",
    lineWidth: 6,
    maxWidth: width - 168,
  });

  if (tabs.length) {
    const tabW = Math.min(200, (width - 72) / tabs.length - 10);
    tabs.forEach((tab, i) => {
      const x = 36 + i * (tabW + 10);
      const on = tab.id === activeTab;
      const tg = ctx.createLinearGradient(x, MENU_CANVAS.tabStart, x, MENU_CANVAS.tabEnd);
      if (on) {
        tg.addColorStop(0, "#38bdf8");
        tg.addColorStop(1, "#0284c7");
      } else {
        tg.addColorStop(0, "#1e293b");
        tg.addColorStop(1, "#0f172a");
      }
      ctx.fillStyle = tg;
      roundRect(ctx, x, MENU_CANVAS.tabStart, tabW, MENU_CANVAS.tabEnd - MENU_CANVAS.tabStart, 14);
      ctx.fill();
      ctx.strokeStyle = on ? "#e0f2fe" : "rgba(148,163,184,0.85)";
      ctx.lineWidth = 4;
      roundRect(ctx, x, MENU_CANVAS.tabStart, tabW, MENU_CANVAS.tabEnd - MENU_CANVAS.tabStart, 14);
      ctx.stroke();
      ctx.fillStyle = on ? "#0f172a" : "#f8fafc";
      ctx.font = on ? "800 28px Arial,sans-serif" : "700 28px Arial,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(tab.label).slice(0, 12), x + tabW / 2, (MENU_CANVAS.tabStart + MENU_CANVAS.tabEnd) / 2);
    });
  }

  const listTop = tabs.length ? MENU_CANVAS.listTop : 150;
  lines.forEach((line, i) => {
    const y = listTop + i * MENU_CANVAS.rowH;
    if (y > MENU_CANVAS.footerTop - 20) return;
    const rowG = ctx.createLinearGradient(40, y - 30, width - 40, y + 30);
    if (line.active) {
      rowG.addColorStop(0, "rgba(56,189,248,0.32)");
      rowG.addColorStop(1, "rgba(14,165,233,0.16)");
    } else {
      rowG.addColorStop(0, i % 2 ? "rgba(15,23,42,0.92)" : "rgba(2,6,23,0.88)");
      rowG.addColorStop(1, "rgba(2,6,23,0.95)");
    }
    ctx.fillStyle = rowG;
    roundRect(ctx, 36, y - 30, width - 72, 64, 16);
    ctx.fill();
    ctx.strokeStyle = line.active ? "rgba(125,211,252,0.7)" : "rgba(148,163,184,0.42)";
    ctx.lineWidth = 2;
    roundRect(ctx, 36, y - 30, width - 72, 64, 16);
    ctx.stroke();
    // Icon badge
    const ig = ctx.createRadialGradient(78, y, 4, 78, y, 26);
    ig.addColorStop(0, "#e2e8f0");
    ig.addColorStop(1, "#334155");
    ctx.fillStyle = ig;
    ctx.beginPath();
    ctx.arc(78, y, 24, 0, Math.PI * 2);
    ctx.fill();
    const avatar = line.avatarUrl ? getMenuAvatarImg(line.avatarUrl) : null;
    if (avatar) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(78, y, 24, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(avatar, 54, y - 24, 48, 48);
      ctx.restore();
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(78, y, 24, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      drawGlyphIcon(ctx, line.icon || (line.kind === "project" ? "front" : line.kind === "part" ? "move" : "ai"), 78, y, 44, "#0f172a");
    }
    ctx.fillStyle = line.active ? "#ffffff" : "#f8fafc";
    ctx.font = line.active ? "bold 34px Arial,sans-serif" : "32px Arial,sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    const labelY = line.sub ? y - 10 : y + 2;
    ctx.fillText(String(line.label || "").slice(0, 46), 120, labelY);
    if (line.sub) {
      ctx.fillStyle = "#cbd5e1";
      ctx.font = "22px Arial,sans-serif";
      ctx.fillText(String(line.sub).slice(0, 52), 120, y + 16);
    }
  });

  if (footer) {
    const fg = ctx.createLinearGradient(0, height - 80, 0, height);
    fg.addColorStop(0, "#1e293b");
    fg.addColorStop(1, "#020617");
    ctx.fillStyle = fg;
    ctx.fillRect(0, height - 80, width, 80);
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "bold 28px Arial,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(footer).slice(0, 78), width / 2, height - 40);
  }
  return canvas;
}


function wrapTextLines(ctx, text, maxWidth, maxLines = 8) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return ["Draw sketches, talk it through, then Run once"];
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length >= maxLines) break;
    } else {
      cur = test;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (words.length && lines.length >= maxLines) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = last.slice(0, Math.max(0, last.length - 1)) + "…";
  }
  return lines;
}

// Reused across refreshes — avoids allocating a 1080×1280 canvas ~5×/sec in AR
let _aiPromptCanvas = null;

function drawAiPromptCanvas(state = {}, targetCanvas = null) {
  const width = AI_CANVAS.w;
  const height = AI_CANVAS.h;
  const canvas = targetCanvas || _aiPromptCanvas || document.createElement("canvas");
  const ctx = bindHudCanvas2d(canvas, width, height);
  if (!targetCanvas) _aiPromptCanvas = canvas;
  ctx.clearRect(0, 0, width, height);

  fillDarkMetalChrome(ctx, width, height, 32);
  fillDarkMetalHeader(ctx, width, AI_LAYOUT.headerEnd, 32);

  const titleMax = hudTextMaxWidth(40, width - 430, { inset: 16 });
  drawHudLabel(ctx, "AI Prompt", 40, Math.round(AI_LAYOUT.headerEnd * 0.38), {
    font: "800 40px Arial,sans-serif",
    lineWidth: 8,
    maxWidth: titleMax,
  });
  drawHudLabel(ctx, state.generating ? "GENERATING FOR THE ROOM" : "SKETCHES · VOICE · TALK · THEN RUN", 40, Math.round(AI_LAYOUT.headerEnd * 0.72), {
    font: "800 20px Arial,sans-serif",
    fill: "#7dd3fc",
    lineWidth: 6,
    maxWidth: titleMax,
  });

  const tableOn = !!state.roundTable;
  ctx.fillStyle = tableOn ? "#22c55e" : "#facc15";
  roundRect(ctx, width - 428, 14, 148, 58, 16);
  ctx.fill();
  ctx.strokeStyle = "#052e16";
  ctx.lineWidth = 4;
  roundRect(ctx, width - 428, 14, 148, 58, 16);
  ctx.stroke();
  ctx.fillStyle = "#052e16";
  ctx.font = "800 22px Arial,sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(tableOn ? "Sandbox" : "Round Table", width - 354, 50);
  ctx.fillStyle = "#0e7490";
  roundRect(ctx, width - 268, 18, 118, 50, 16);
  ctx.fill();
  ctx.fillStyle = "#e0f2fe";
  ctx.font = "bold 22px Arial,sans-serif";
  ctx.fillText("Send PC", width - 209, 43);
  drawWindowOverflowDots(ctx, width, AI_LAYOUT.headerEnd);
  drawWindowCloseX(ctx, width, AI_LAYOUT.headerEnd);
  paintHudOverflowDropdown(ctx, width, AI_LAYOUT.headerEnd, {
    overflowOpen: !!state.overflowOpen,
    locked: !!state.locked,
  });

  const mic = AI_LAYOUT.mic;
  const listening = !!state.listening;
  const mg = ctx.createRadialGradient(mic.cx - 18, mic.cy - 20, 6, mic.cx, mic.cy, mic.r);
  if (listening) {
    mg.addColorStop(0, "#fca5a5");
    mg.addColorStop(0.45, "#ef4444");
    mg.addColorStop(1, "#991b1b");
  } else {
    mg.addColorStop(0, "#ffffff");
    mg.addColorStop(0.55, "#e2e8f0");
    mg.addColorStop(1, "#94a3b8");
  }
  ctx.beginPath();
  ctx.arc(mic.cx, mic.cy, mic.r, 0, Math.PI * 2);
  ctx.fillStyle = mg;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = listening ? "#fecaca" : "#ffffff";
  ctx.stroke();
  ctx.fillStyle = listening ? "#ffffff" : "#0f172a";
  roundRect(ctx, mic.cx - 16, mic.cy - 32, 32, 48, 16);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(mic.cx - 26, mic.cy + 20);
  ctx.quadraticCurveTo(mic.cx, mic.cy + 42, mic.cx + 26, mic.cy + 20);
  ctx.lineWidth = 6;
  ctx.strokeStyle = listening ? "#ffffff" : "#0f172a";
  ctx.stroke();
  ctx.fillStyle = listening ? "#fecaca" : "#94a3b8";
  ctx.font = "bold 18px Arial,sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(listening ? "Stop" : "Mic", mic.cx, mic.cy + mic.r + 22);

  const tb = AI_LAYOUT.tableBtn;
  const sandboxOn = !!state.sandbox;
  ctx.fillStyle = tableOn ? (sandboxOn ? "#7dd3fc" : "#38bdf8") : "#facc15";
  roundRect(ctx, tb.x, tb.y, tb.w, tb.h, 22);
  ctx.fill();
  ctx.strokeStyle = "#052e16";
  ctx.lineWidth = 6;
  roundRect(ctx, tb.x, tb.y, tb.w, tb.h, 22);
  ctx.stroke();
  ctx.fillStyle = "#052e16";
  ctx.font = "800 34px Arial,sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(tableOn ? "Sandbox" : "Round Table", tb.x + tb.w / 2, tb.y + tb.h / 2 - 14);
  ctx.font = "800 18px Arial,sans-serif";
  ctx.fillText(
    tableOn ? (sandboxOn ? "ON · tap to hide" : "tap to simulate") : "tap to sit agents",
    tb.x + tb.w / 2,
    tb.y + tb.h / 2 + 22,
  );
  ctx.textBaseline = "alphabetic";

  const tr = AI_LAYOUT.transcript;
  ctx.fillStyle = "#020617";
  roundRect(ctx, tr.x, tr.y, tr.w, tr.h, 18);
  ctx.fill();
  ctx.strokeStyle = state.keyboardOpen ? "#22d3ee" : (listening ? "#38bdf8" : "#334155");
  ctx.lineWidth = state.keyboardOpen ? 5 : 3;
  roundRect(ctx, tr.x, tr.y, tr.w, tr.h, 18);
  ctx.stroke();
  ctx.fillStyle = "#64748b";
  ctx.font = "bold 18px Arial,sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("PROMPT", tr.x + 22, tr.y + 26);
  ctx.fillStyle = "#f1f5f9";
  ctx.font = "30px Arial,sans-serif";
  const draftLines = wrapTextLines(ctx, state.draft || "", tr.w - 44, 4);
  draftLines.forEach((line, i) => {
    ctx.fillText(line, tr.x + 22, tr.y + 58 + i * 30);
  });

  const thumbs = AI_LAYOUT.thumbs;
  const images = Array.isArray(state.composeImages) ? state.composeImages : [];
  ctx.fillStyle = "#94a3b8";
  ctx.font = "bold 18px Arial,sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("SKETCHES · TAP DRAW TO KEEP ANOTHER", 40, thumbs.y - 12);
  const tGap = 12;
  const tw = (width - 80 - tGap * (thumbs.n - 1)) / thumbs.n;
  for (let i = 0; i < thumbs.n; i += 1) {
    const x = 40 + i * (tw + tGap);
    const img = images[i];
    ctx.fillStyle = img ? "#0f172a" : "#111827";
    roundRect(ctx, x, thumbs.y, tw, thumbs.h, 12);
    ctx.fill();
    ctx.strokeStyle = img ? "#22d3ee" : "#334155";
    ctx.lineWidth = img ? 3 : 2;
    roundRect(ctx, x, thumbs.y, tw, thumbs.h, 12);
    ctx.stroke();
    const bmp = img ? getAiThumbImg(img.data_url) : null;
    if (bmp) {
      ctx.save();
      roundRect(ctx, x + 4, thumbs.y + 4, tw - 8, thumbs.h - 8, 8);
      ctx.clip();
      ctx.drawImage(bmp, x + 4, thumbs.y + 4, tw - 8, thumbs.h - 8);
      ctx.restore();
    } else {
      ctx.fillStyle = img ? "#67e8f9" : "#475569";
      ctx.font = "bold 20px Arial,sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(img ? `Sketch ${i + 1}` : "Empty", x + tw / 2, thumbs.y + thumbs.h / 2);
    }
  }

  function pillRow(y, label, options, activeId) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 18px Arial,sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(label, 40, y - 14);
    const n = Math.max(options.length, 1);
    const gap = 12;
    const bw = (width - 80 - gap * (n - 1)) / n;
    options.forEach((opt, i) => {
      const x = 40 + i * (bw + gap);
      const on = opt.id === activeId;
      const g = ctx.createLinearGradient(x, y, x, y + 56);
      if (on) {
        g.addColorStop(0, "#38bdf8");
        g.addColorStop(1, "#0284c7");
      } else {
        g.addColorStop(0, "#334155");
        g.addColorStop(1, "#1e293b");
      }
      ctx.fillStyle = g;
      roundRect(ctx, x, y, bw, 56, 14);
      ctx.fill();
      ctx.fillStyle = on ? "#0f172a" : "#e2e8f0";
      ctx.font = "bold 24px Arial,sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(opt.label).slice(0, 16), x + bw / 2, y + 28);
    });
  }

  function cycleRow(y, label, value) {
    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 18px Arial,sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(label, 40, y - 14);
    const g = ctx.createLinearGradient(40, y, 40, y + 56);
    g.addColorStop(0, "#334155");
    g.addColorStop(1, "#1e293b");
    ctx.fillStyle = g;
    roundRect(ctx, 40, y, width - 80, 56, 14);
    ctx.fill();
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "bold 22px Arial,sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("‹ ›", 56, y + 28);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 24px Arial,sans-serif";
    ctx.fillText(String(value || "Tap to choose").slice(0, 36), 110, y + 28);
  }

  const mode = state.mode || "v2";
  const speed = state.speed || "fast";
  const target = state.targetMode || "new";
  cycleRow(AI_LAYOUT.keyY, "AI KEY / SUBSCRIPTION", state.keyLabel || "No key");
  const modelOpen = !!state.modelPickerOpen;
  cycleRow(
    AI_LAYOUT.modelY,
    "MODEL",
    `${modelOpen ? "▲" : "▼"}  ${state.modelLabel || state.modelValue || "Tap to choose"}`,
  );
  pillRow(AI_LAYOUT.modeY, "TYPE", [
    { id: "render", label: "Render" },
    { id: "v2", label: "CAD" },
    { id: "mesh", label: "Mesh" },
  ], mode);
  pillRow(AI_LAYOUT.speedY, "SPEED", [
    { id: "fast", label: "Fast" },
    { id: "quality", label: "Quality" },
  ], speed);
  pillRow(AI_LAYOUT.targetY, "TARGET", [
    { id: "new", label: "New" },
    { id: "edit", label: target === "edit" ? "Edit…" : "Edit" },
  ], target);

  const pg = AI_LAYOUT.progress;
  const generating = !!state.generating;
  const pct = Math.max(0, Math.min(100, Number(state.genPct || 0)));
  ctx.fillStyle = "#020617";
  roundRect(ctx, 40, pg.y, width - 80, pg.h, 12);
  ctx.fill();
  if (generating) {
    ctx.fillStyle = "#14532d";
    roundRect(ctx, 40, pg.y, Math.max(24, ((width - 80) * pct) / 100), pg.h, 12);
    ctx.fill();
    const spinCx = 68;
    const spinCy = pg.y + pg.h / 2;
    const ang = ((Number(state.now) || 0) / 180) % (Math.PI * 2);
    ctx.strokeStyle = "#4ade80";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(spinCx, spinCy, 12, ang, ang + Math.PI * 1.35);
    ctx.stroke();
    ctx.fillStyle = "#bbf7d0";
    ctx.beginPath();
    ctx.arc(spinCx, spinCy, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = generating ? "#bbf7d0" : "#64748b";
  ctx.font = "bold 22px Arial,sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const genWho = String(state.byUserName || "").slice(0, 18);
  const genText = generating
    ? `${genWho ? `${genWho} · ` : ""}${String(state.genLabel || "Generating…").slice(0, 28)}${pct ? ` · ${pct}%` : ""} · tap`
    : "Room idle — generate to update everyone’s model";
  ctx.fillText(genText, width / 2 + (generating ? 18 : 0), pg.y + pg.h / 2);

  const history = Array.isArray(state.history) ? state.history : [];
  ctx.fillStyle = "#94a3b8";
  ctx.font = "bold 18px Arial,sans-serif";
  ctx.textAlign = "left";
  ctx.fillText("PROMPT HISTORY · TAP TO REUSE", 40, AI_LAYOUT.historyY - 14);
  for (let i = 0; i < AI_LAYOUT.historyN; i += 1) {
    const y = AI_LAYOUT.historyY + i * AI_LAYOUT.historyH;
    const row = history[i];
    ctx.fillStyle = row ? "#1e293b" : "#0f172a";
    roundRect(ctx, 40, y, width - 80, AI_LAYOUT.historyH - 6, 10);
    ctx.fill();
    ctx.fillStyle = row ? "#e2e8f0" : "#475569";
    ctx.font = "22px Arial,sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText(
      row ? String(row.prompt || "Prompt").slice(0, 48) : "No history yet",
      56,
      y + (AI_LAYOUT.historyH - 6) / 2,
    );
  }

  const ry = AI_LAYOUT.run.y;
  const gap = 12;
  const inner = width - 80;
  const bw = (inner - gap * 3) / 4;
  const drawing = !!state.drawing;
  const talking = !!state.talking;
  const talkConnecting = !!state.talkConnecting;
  const sketchN = images.length || Number(state.drawClips || 0) || 0;
  const liveN = Number(state.drawStrokes || 0) || 0;

  const dg = ctx.createLinearGradient(40, ry, 40, ry + AI_LAYOUT.run.h);
  if (drawing) {
    dg.addColorStop(0, "#22d3ee");
    dg.addColorStop(1, "#0e7490");
  } else {
    dg.addColorStop(0, "#334155");
    dg.addColorStop(1, "#1e293b");
  }
  ctx.fillStyle = dg;
  roundRect(ctx, 40, ry, bw, AI_LAYOUT.run.h, 18);
  ctx.fill();
  ctx.fillStyle = drawing ? "#082f49" : "#e2e8f0";
  ctx.font = "bold 24px Arial,sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const drawLabel = drawing
    ? (liveN ? `Keep · ${liveN}` : "Drawing…")
    : "Draw";
  ctx.fillText(drawLabel, 40 + bw / 2, ry + AI_LAYOUT.run.h / 2);

  const tg = ctx.createLinearGradient(40 + bw + gap, ry, 40 + bw + gap, ry + AI_LAYOUT.run.h);
  if (talking || talkConnecting) {
    tg.addColorStop(0, "#c4b5fd");
    tg.addColorStop(1, "#6d28d9");
  } else {
    tg.addColorStop(0, "#334155");
    tg.addColorStop(1, "#1e293b");
  }
  ctx.fillStyle = tg;
  roundRect(ctx, 40 + bw + gap, ry, bw, AI_LAYOUT.run.h, 18);
  ctx.fill();
  ctx.fillStyle = talking ? "#1e1b4b" : "#e2e8f0";
  ctx.font = "bold 24px Arial,sans-serif";
  ctx.fillText(talkConnecting ? "Connecting…" : talking ? "Talking…" : "Talk", 40 + bw + gap + bw / 2, ry + AI_LAYOUT.run.h / 2);

  const ug = ctx.createLinearGradient(40 + (bw + gap) * 2, ry, 40 + (bw + gap) * 2, ry + AI_LAYOUT.run.h);
  if (tableOn) {
    ug.addColorStop(0, "#4ade80");
    ug.addColorStop(1, "#15803d");
  } else {
    ug.addColorStop(0, "#facc15");
    ug.addColorStop(1, "#ca8a04");
  }
  ctx.fillStyle = ug;
  roundRect(ctx, 40 + (bw + gap) * 2, ry, bw, AI_LAYOUT.run.h, 18);
  ctx.fill();
  ctx.fillStyle = "#052e16";
  ctx.font = "800 22px Arial,sans-serif";
  ctx.fillText("Round Table", 40 + (bw + gap) * 2 + bw / 2, ry + AI_LAYOUT.run.h / 2);

  const rg = ctx.createLinearGradient(40 + (bw + gap) * 3, ry, 40 + (bw + gap) * 3, ry + AI_LAYOUT.run.h);
  if (generating) {
    rg.addColorStop(0, "#f87171");
    rg.addColorStop(1, "#b91c1c");
  } else {
    rg.addColorStop(0, "#4ade80");
    rg.addColorStop(1, "#16a34a");
  }
  ctx.fillStyle = rg;
  roundRect(ctx, 40 + (bw + gap) * 3, ry, bw, AI_LAYOUT.run.h, 18);
  ctx.fill();
  ctx.fillStyle = generating ? "#fef2f2" : "#052e16";
  ctx.font = "bold 24px Arial,sans-serif";
  ctx.fillText(generating ? "Stop" : "Run", 40 + (bw + gap) * 3 + bw / 2, ry + AI_LAYOUT.run.h / 2);

  if (state.talkStatus) {
    ctx.fillStyle = state.talkError ? "#fda4af" : "#c4b5fd";
    ctx.font = "22px Arial,sans-serif"; ctx.textAlign = "left";
    wrapTextLines(ctx, state.talkStatus, width - 80, 3).forEach((line, index) => ctx.fillText(line, 40, 1068 + index * 28));
  }

  ctx.fillStyle = "#64748b";
  ctx.font = "20px Arial,sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(
    drawing
      ? "Hold trigger to sketch — tap Keep, Talk, then Run once"
      : (sketchN
        ? `${sketchN} sketch${sketchN === 1 ? "" : "es"} ready · Talk to refine · Run to generate`
        : "Draw + voice first · Talk with AI · Run when the prompt is ready"),
    width / 2,
    AI_LAYOUT.hide.y,
  );

  if (modelOpen) {
    const layout = modelPickerLayout({
      width,
      height,
      modelY: AI_LAYOUT.modelY,
      rowH: 56,
      options: Array.isArray(state.modelOptions) ? state.modelOptions : [],
      scroll: Number(state.modelPickerScroll) || 0,
    });
    ctx.fillStyle = "rgba(2,6,23,0.88)";
    roundRect(ctx, layout.overlayX, layout.overlayY, layout.overlayW, layout.overlayH, 18);
    ctx.fill();
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 2;
    roundRect(ctx, layout.overlayX, layout.overlayY, layout.overlayW, layout.overlayH, 18);
    ctx.stroke();
    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 16px Arial,sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("SUBSCRIPTION MODELS · TAP ONE", layout.overlayX + 16, layout.overlayY + 8);
    if (!layout.rows.length) {
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 22px Arial,sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("No models for this key", width / 2, layout.overlayY + layout.overlayH / 2);
    }
    layout.rows.forEach((row) => {
      const on = String(row.value) === String(state.modelValue || "");
      const g = ctx.createLinearGradient(row.x, row.y, row.x, row.y + row.h);
      if (on) {
        g.addColorStop(0, "#38bdf8");
        g.addColorStop(1, "#0284c7");
      } else {
        g.addColorStop(0, "#334155");
        g.addColorStop(1, "#1e293b");
      }
      ctx.fillStyle = g;
      roundRect(ctx, row.x, row.y, row.w, row.h, 12);
      ctx.fill();
      ctx.fillStyle = on ? "#0f172a" : "#f8fafc";
      ctx.font = "bold 24px Arial,sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(String(row.label).slice(0, 28), row.x + 18, row.y + row.h / 2);
    });
    function navBtn(r, label) {
      if (!r) return;
      ctx.fillStyle = "#0ea5e9";
      roundRect(ctx, r.x, r.y, r.w, r.h, 10);
      ctx.fill();
      ctx.fillStyle = "#082f49";
      ctx.font = "bold 20px Arial,sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2);
    }
    navBtn(layout.up, "▲ More");
    navBtn(layout.down, "▼ More");
  }

  return canvas;
}

export function createViewportXR(opts) {
  const {
    renderer,
    scene,
    camera,
    controls,
    transformControls = null,
    getMeshRoot,
    getMmPerUnit,
    formatLength,
    onPresentingChange = null,
    fitCamera = null,
    buttonEl = null,
    spawnModalEl = null,
    hideSceneChrome = null,
    restoreSceneChrome = null,
    getPoseStorageKey = null,
    getProjectId = null,
    detachAssembly = null,
    attachAssembly = null,
    resetAssemblyXrSafe = null,
    getExplorerItems = null,
    onExplorerSelect = null,
    getProjects = null,
    getWorkspaceProjects = null,
    getWorkspaceLabel = null,
    onCreateWorkspaceProject = null,
    onDeleteWorkspaceProject = null,
    onFitView = null,
    onPlaceDesktop = null,
    onTossAway = null,
    onOpenProject = null,
    onSavePublicRoomProject = null,
    onInvitePublicRoomToProject = null,
    onRespondShareInvite = null,
    getToken = null,
    getProjectFiles = null,
    fetchWorkshopAsset = null,
    getDrawBoardAssets = null,
    getDrawBoardModel = null,
    drawBoardApi = null,
    onOrganizeDrawBoard = null,
    onGenerateDrawBoard = null,
    onGenerateDrawImage = null,
    onDrawBoardChange = null,
    getReferenceFiles = null,
    getSocialState = null,
    getSocialFriends = null,
    onSocialAction = null,
    getXrStudioState = null,
    onXrStudioAction = null,
    sendCollab = null,
    sendPublicXrPose = null,
    sendPublicXr = null,
    onPublishSceneMeshes = null,
    onBeforeEnterFromButton = null,
    getLocalUserId = null,
    onXrLayoutsLoad = null,
    onXrLayoutsSave = null,
    getPromptDraft = null,
    onSetPromptDraft = null,
    onPromptSubmit = null,
    onGenerateXrEnvironment = null,
    onToolAction = null,
    onCreateXrSolid = null,
    onPersistXrSolid = null,
    onGroupXrBodies = null,
    onUndo = null,
    onRedo = null,
    onUndoXrCreateCad = null,
    onRedoXrCreateCad = null,
    onMeshMoved = null,
    onTranscribeToggle = null,
    isTranscribing = null,
    getAiPromptState = null,
    setAiPromptSetting = null,
    getAiGenerationProgress = null,
    onStopGeneration = null,
    onTalkToAi = null,
    onAttachVoiceDrawClip = null,
    onRemoveComposeImage = null,
    getVoiceMoldState = null,
    onProjectOpened = null,
    launchMobileAr = null,
    launchDesktopAr = null,
    ribbonButtonEl = null,
    onStatus = null,
    onXrDebugLog = null,
    getSelectedFile = null,
  } = opts;

  let xrStudioStateAbort = null; // leakfix95
  let xrShareRosterAbort = null; // leakfix96
  let roboticsHudEmotesAbort = null; // leakfix109
  let supported = false; // WebXR immersive session available
  let mobileArAvailable = typeof launchMobileAr === "function";
  // Quest passthrough is immersive-ar (opaque immersive-vr hides the room).
  // Request only this mode on tap — do not try AR then VR (burns user-activation).
  let sessionMode = "immersive-ar";
  let session = null;
  let presenting = false;
  let xrPresentStartedAt = 0;
  let xrEnterIdleRaf = 0;
  let xrEnterIdleTimer = 0;
  const xrEnterIdleJobs = [];
  let workspaceJoin = false;
  let workspaceKeys = null;
  let workspaceOrient = null;
  let workspaceHud = null;
  let workspaceLook = { yaw: 0, pitch: 0, pl: false };
  let workspacePassOn = false;
  let workspaceSavedNear = null;
  let workspaceSavedFar = null;
  let xrCsgPending = false;
  let activeTool = "grab";
  let transparentAllActive = false;
  let toolBeforeDimos = "";
  let roboticsWasArmed = false;
  onDimosTeleopChange((snap) => {
    const newlyEnabled = !!snap?.armed && !roboticsWasArmed;
    roboticsWasArmed = !!snap?.armed;
    if (newlyEnabled) setPassthroughOn(true);
    try {
      if (newlyEnabled) {
        forgetRoboticsTransientWindows();
        if (handCamWindows) {
          for (const side of ["left", "right", "pov"]) if (handCamWindows[side]) handCamWindows[side].userHidden = false;
        }
        openRoboticsPanel({ forcePlace: true });
        void enableRoboticsWristCameras();
      } else if (!snap?.armed) {
        hideHandCamWindows();
        closeRoboticsPanel();
        roboticsWorkspace.close();
      }
    } catch (_) { /* wrist cams attach after HUD init */ }
    const next = nextToolAfterDimosArmChange({
      armed: !!snap?.armed,
      previousTool: toolBeforeDimos,
      currentTool: activeTool,
    });
    toolBeforeDimos = next.previousTool;
    if (next.tool !== activeTool) {
      activeTool = next.tool;
      try { syncDock(); } catch (_) {}
    }
    try {
      if (snap?.armed && session) openRoboticsPanel({ forcePlace: false });
      paintRoboticsPanel();
    } catch (_) { /* panel may not exist yet */ }
  });
  let passthroughOn = true;
  try {
    const storedPass = localStorage.getItem(LS_PASSTHROUGH);
    if (storedPass === "0" || storedPass === "false") passthroughOn = false;
  } catch { /* default on */ }
  let preferredDockHand = "left";
  try {
    migrateMenuHandToLeft(localStorage);
    seedDefaultDockHand(localStorage);
    preferredDockHand = restorePreferredDockHand(localStorage);
  } catch {
    preferredDockHand = "left";
  }
  let dockIgnoreGripsUntil = 0;
  let xrUiPrewarmed = false;
  let lastBlurXrDomAt = 0;
  let voiceMoldLive = false;
  let userZoom = 1;
  let baseScale = 1;
  let presentationScale = 1;
  /** After the initial place, CAD stays world-anchored (does not follow gaze). */
  let worldAnchored = false;
  /** Place CAD on XR frames — never block enter() on window rAF (Quest freezes). */
  let pendingInitialPlace = false;
  let xrPerfPosted = false;
  let placeAttempts = 0;
  let projectSwapActive = false;
  /** Size rescue window if a reload leaves the model at desktop mm-scale. */
  let sizeRescueUntil = 0;
  let lastSizeRescueAt = 0;
  let sizeRescueAttempts = 0;
  let placeAfterLoadTimer = 0;
  let placeAfterLoadGen = 0;
  const XR_DEPTH_NEAR = 0.01;
  // Wide far plane — tight far clipped controllers/docks when looking around in room-scale AR.
  const XR_DEPTH_FAR = 800;
  /** mm per CAD/model unit — captured at identity scale during placeInFront (not XR world size). */
  let xrMmPerUnit = 1;
  let activeSpawnId = "eye";
  let menuTab = "projects";
  let socialPane = "hub";
  let socialFocusId = "";
  let socialProfile = null;
  let socialProfileTab = "profile";
  let xrBoardUserArmed = false;
  let lastPlaceCadAt = 0;
  let lastRelayerFrame = 0;
  let overlayRelayerDirty = false;
  let guidesPanel = null;
  let guidesCatId = "move";
  let guidesClipIndex = 0;
  let guidesSwipe = null;
  let lastGuidePaintAt = 0;
  let lastSocialRosterKey = "";
  let menuScroll = 0;
  let menuLineTotal = 0;
  let menuStickCarry = 0;
  let lastMenuStickAt = 0;
  let menuFooterHint = "";
  let lastSelectAt = 0;
  const uiSelectPress = createXrUiPressLatch();
  let pickFrameGen = 0;
  let menuAabbGen = -1;
  let menuAabbCache = [];
  const pickCache = new Map();
  let scaleGrab = null;
  let oneHandScale = null;
  let gripGrab = null; // Gravity Sketch–style single-grip attach (move + rotate)
  let prevSqueeze = [false, false];
  let aiPanel = null;
  let aiKeyboardOpen = false;
  let aiKeyboardShift = false;
  let aiLoadingOpen = false;
  let aiLoadingScroll = 0;
  let aiModelPickerOpen = false;
  let aiModelPickerScroll = 0;
  let viewPanel = null;
  let groupNamePanel = null;
  let groupPaint = null;
  let groupNameDraft = "VR Group";
  let groupNameMicBase = "";
  let settingsPanel = null;
  let settingsTab = "controller";
  try {
    window.addEventListener(ROBOTICS_PREFS_EVENT, () => {
      if (settingsTab === "robotics") {
        try { refreshGridPopupSoon("settings"); } catch { /* ignore */ }
      }
    });
  } catch { /* ignore */ }
  let xrEnvListCache = null;
  let studioHudShown = false;
  const pendingGridRefresh = new Set();
  const sceneWindows = { browser: null, display: null };
  const sceneWinState = xrSceneWindowsDefaultState();
  try {
    const savedUrl = readXrSceneWindowUrl();
    if (savedUrl) sceneWinState.url = savedUrl;
    const winPrefs = readXrSceneWindowPrefs();
    sceneWinState.pinned = winPrefs.pinned;
    sceneWinState.widthId = winPrefs.widthId;
  } catch { /* private mode */ }
  sceneWinState.browserOn = false;
  sceneWinState.displayOn = false;
  sceneWinState.urlDraft = sceneWinState.url || "";
  let sceneWinKbOpen = false;
  let sceneWinHtmlOverlay = null;
  let developerMode = false;
  try {
    developerMode = developerModeEnabled(localStorage.getItem(XR_DEV_MODE_KEY));
  } catch {
    developerMode = false;
  }
  let lastXrConsume = "miss";
  let lastXrControlEv = "";
  let lastXrHand = "";
  let stickRestartState = emptyStickRestartState();
  let stickRestartHud = null;
  let stickRestartArmed = false;
  let tabbedWindows = null;
  let debuggerOpen = false;
  const debuggerRefresh = createHudRefreshGate(100);
  const updateMenuClarity = createMenuClarityControl(XR_FOVEATION);
  let debuggerHud = null;
  let prevBothStickClicks = false;
  let debuggerExitArmed = false;
  let prevRestartDown = true;
  let leftRestartHoldOpen = false;
  let leftRestartState = emptyLeftMenuRestartState();
  let exitVrHoldState = emptyStickRestartState();
  let exitVrHoldHand = -1;
  let exitVrHoldRing = null;
  let softRefreshArmed = false;

  try {
    window.addEventListener(XR_CONTROL_MAP_EVENT, () => {
      if (settingsTab === "controls" && settingsPanel?.group?.visible) {
        try { refreshGridPopupSoon("settings"); } catch { /* ignore */ }
      }
    });
  } catch { /* ignore */ }

  function noteSelectConsume(opts = {}) {
    lastXrConsume = xrSelectConsumeTarget({
      dimosArmed: opts.dimosArmed === true || isDimosTeleopArmed(),
      uiHit: opts.uiHit === true,
      nearMenu: opts.nearMenu === true || lastMenuAimNear,
      rayOnMenu: opts.rayOnMenu === true || lastRayOnMenu,
      hasPick: opts.hasPick === true,
      blocked: opts.blocked || "",
    });
    lastXrControlEv = String(opts.ev || "sel").slice(0, 8);
    lastXrHand = String(opts.h || "").slice(0, 2);
    try {
      xrDevStats.noteEvent?.(lastXrControlEv, {
        consume: lastXrConsume,
        h: opts.h || "",
        t: performance.now(),
      });
    } catch (_) {}
    return lastXrConsume;
  }
  let toolsPanel = null;
  let drawPanel = null;
  let aiHubPanel = null;
  let socialHubPanel = null;
  let roboticsPanel = null;
  let printerPlacement = null;
  const roboticsWorkspace = createXrRoboticsWorkspace({
    THREE, scene, getToken, getUserId: () => getLocalUserId?.() || '',
    getHeadPose: () => { getHeadPose(); return { position: _headPos.clone(), quaternion: _headQuat.clone() }; },
    getRightController: () => getRightGrip() || posedControllerForHand(1) || controllers[1] || null,
    getTeleop: getDimosTeleopState, getFeed: getDimosViewerSnapshot,
    getWorkshopAnchor: () => xrSceneKind === 'workshop' ? xrWorkshopProjectRoom?.userData?.workshopRobotAnchor : null,
    isJoined: () => !!getSocialState?.()?.publicJoined, onStatus,
    joinRoom: () => onSocialAction?.('public_join'),
    getPrinter: () => ({ ...printerPrefs, volume: printerVolumeM }),
    onPrinter: (action, value) => {
      if (action === 'refresh') return refreshShareRoster();
      if (action === 'placement') { applyPrinterFence(value, { persist: true, share: true }); return; }
      if (action === 'start_fence') { beginPrinterFencePlace(); return; }
      if (action === 'printer_bounder') { createOrShowPrinterBounder(); return; }
      if (action === 'printer_send_pc') { sendPrinterConfigToPc(); return; }
      if (action === 'printer_pin' || action === 'printer_ip' || action === 'printer_serial' || action === 'printer_name') {
        savePrinterConfig({
          access_code: action === 'printer_pin' ? value : undefined,
          lan_ip: action === 'printer_ip' ? value : undefined,
          serial: action === 'printer_serial' ? value : undefined,
          name: action === 'printer_name' ? value : undefined,
        });
        return;
      }
      return handleShareAction(action);
    },
    openConfig: () => window.__openRoboticsProfile?.(),
    openSlicer: () => onToolAction?.('bambu'), setPiUiState: setDimosProfileUiState,
  });
  let handCamWindows = null;
  let handCamPollAt = 0;
  let roboticsOverflowOpen = false;
  let roboticsHudTab = "pi-ui";
  const ROBOT_START_POSITION_KEY = "render3d:robot-start-position:v1";
  function readRobotStartPosition() {
    try { return JSON.parse(localStorage.getItem(ROBOT_START_POSITION_KEY) || "null") || {type:"home",id:"home",name:"Home"}; }
    catch (_) { return {type:"home",id:"home",name:"Home"}; }
  }
  function saveRobotStartPosition(position) {
    const value = position?.type === "emote" && position.id
      ? {type:"emote",id:String(position.id),name:String(position.name || position.id)}
      : {type:"home",id:"home",name:"Home"};
    try { localStorage.setItem(ROBOT_START_POSITION_KEY, JSON.stringify(value)); } catch (_) {}
    onStatus?.("ok", `${value.name} saved as the robot starting position`);
    paintRoboticsPanel();
  }
  let roboticsHudEmotes = [];
  let roboticsHudEmotePage = 0;
  let roboticsHudEmotesLoading = false;
  let roboticsHudEmotesError = "";
  let roboticsRightHandActivity = null;
  let roboticsRightHandStatus = null;
  let roboticsRightHandStatusSignature = "";
  const roboticsRightHandStatusPos = new THREE.Vector3();
  const roboticsRightHandStatusUp = new THREE.Vector3();
  const roboticsRightHandStatusRight = new THREE.Vector3();
  const roboticsRightHandStatusToward = new THREE.Vector3();
  const roboticsRightHandStatusQuat = new THREE.Quaternion();
  let roboticsWasRecording = false;
  let roboticsRecordFeedbackUntil = 0;
  let roboticsPrinterConfigOpen = false;
  let roboticsPaintAt = 0;
  const roboticsRecordingNamesKey = () => {
    let project = "global";
    try { project = new URLSearchParams(location.search).get("project") || "global"; } catch (_) {}
    return `render3d:robotics:recording-names:v1:${project}`;
  };
  const roboticsRecordingNames = () => { try { return JSON.parse(localStorage.getItem(roboticsRecordingNamesKey()) || "{}") || {}; } catch (_) { return {}; } };
  const hudOverflowOpen = Object.create(null);
  let collabSpace = "shared";
  try { collabSpace = readXrCollabSpace(); } catch { collabSpace = "shared"; }
  let drawSizeId = "draw_size_m";
  let drawBrush = "pen";
  let drawEraserOn = false;
  const drawPencils = [];
  let drawAuthorLabel = null;
  let workspacePanel = null;
  let avatarPanel = null;
  let localAvatarSpec = loadAvatarSpec("");
  let localXrDevice = "";
  let localXrMode = "";
  let localXrProp = "";
  let poseForceSend = false;
  let workspaceDeleteArmedId = "";
  let workspaceDeleteArmedAt = 0;
  let workspaceInvitePrompt = false;
  let workspaceInviteProjectId = "";
  let workspaceCreatePrompt = null;
  let wsKeyboardOpen = false;
  let wsKeyboardShift = false;
  let workspaceLayoutPrompt = null;
  let workspaceGallery = [];
  let layoutStore = parseLayoutStore(null);
  let layoutsHydrated = false;
  let layoutsHydratedUser = "";
  let shareInvitePanel = null;
  let shareInviteState = null;
  let sharePanel = null;
  let shareFriends = [];
  let shareSearchHits = [];
  let shareSearchDraft = "";
  let sharePrintTargets = [];
  let shareKbOpen = false;
  let printerPrefs = {
    accept_sends: readFlag(typeof localStorage !== "undefined" ? localStorage : null, PRINTER_ACCEPT_KEY, false),
    show_outline: readFlag(typeof localStorage !== "undefined" ? localStorage : null, PRINTER_OUTLINE_KEY, false),
    show_model: readFlag(typeof localStorage !== "undefined" ? localStorage : null, PRINTER_MODEL_KEY, false),
    ...printerConfigFromStorage(typeof localStorage !== "undefined" ? localStorage : null),
  };
  let printerBounderHit = null;
  let printerPinHit = null;
  let printerPinTextureState = "";
  let printerBounderHover = false;
  let printerVolumeM = null;
  let printerOutlineMesh = null;
  let printerModelMesh = null;
  let printerPreviewMesh = null;
  let shareThrowAnim = null;
  let shareAimTarget = null;
  let shareAimPlate = null;
  let printerRequestState = null;
  let printerFenceMode = 0;
  let printerFenceFirst = null;
  let printerFencePreview = null;
  let printerVisualsDirty = true;
  let lastClockHudAt = 0;
  let lastHudFollowAt = 0;
  let lastHudFollowX = 0;
  let lastHudFollowZ = 0;
  let lastShareAimKey = "";
  let lastShareAimPaintAt = 0;
  let lastDrawPencilSig = "";
  let printSettingsState = null;
  let printSettingsPanel = null;
  void XR_PERF_CACHE;
  {
    const stored = normalizePrinterFence(readPrinterFence(typeof localStorage !== "undefined" ? localStorage : null));
    if (stored && !isLeftoverAutoPrinterFence(stored)) printerPlacement = stored;
    else if (stored) writePrinterFence(typeof localStorage !== "undefined" ? localStorage : null, null);
  }
  let sharedVideo = null;
  let clipMenuOpen = false;
  let clipFriendOpen = false;
  let clipFriendSearch = "";
  let clipFriendPeople = [];
  let clipFriendKbOpen = false;
  let clipWindowCurved = false;
  let clipWindowHiddenFromOthers = false;
  let clipWindowTooltipId = "";
  let clipChromeHits = null;
  const tossSamples = [];
  let tossAnim = null;
  let aiPanelRefreshAt = 0;
  let editModelPickActive = false;
  const LS_PANEL_POSES = "render3d:xr-panel-layout:v2";

  function projectLayoutId() {
    try {
      const id = typeof getProjectId === "function" ? String(getProjectId() || "").trim() : "";
      if (id) return id;
    } catch (_) {}
    try {
      const k = typeof getPoseStorageKey === "function" ? String(getPoseStorageKey() || "") : "";
      const m = k.match(/:([^:]+)$/);
      if (m?.[1]) return m[1];
    } catch (_) {}
    return "none";
  }

  function panelPoseStorageKey() {
    return `${LS_PANEL_POSES}:${projectLayoutId()}`;
  }

  function loadAllPanelPoses() {
    try {
      const raw = localStorage.getItem(panelPoseStorageKey());
      if (raw) return JSON.parse(raw) || {};
    } catch (_) {}
    try {
      const legacyBase = (typeof getPoseStorageKey === "function" && getPoseStorageKey()) || LS_POSE;
      const legacy = localStorage.getItem(`${LS_PANEL_POSES}:${legacyBase}`);
      if (legacy) return JSON.parse(legacy) || {};
    } catch (_) {}
    return {};
  }

  function persistPanelLayout(all) {
    try {
      localStorage.setItem(panelPoseStorageKey(), JSON.stringify(all || {}));
    } catch (_) {}
  }

  function layoutUserId() {
    try { return String((typeof getLocalUserId === "function" && getLocalUserId()) || "").trim(); } catch { return ""; }
  }

  function loadLocalLayoutStore() {
    try {
      const raw = localStorage.getItem(xrLayoutsStorageKey(layoutUserId()));
      return parseLayoutStore(raw);
    } catch {
      return parseLayoutStore(null);
    }
  }

  function persistLayoutStore(store) {
    layoutStore = parseLayoutStore(store);
    try {
      localStorage.setItem(xrLayoutsStorageKey(layoutUserId()), stringifyLayoutStore(layoutStore));
    } catch (_) {}
    try { onXrLayoutsSave?.(layoutStore); } catch (_) {}
    return layoutStore;
  }

  function hydrateXrLayouts() {
    const uid = layoutUserId();
    layoutStore = loadLocalLayoutStore();
    if (layoutsHydrated && layoutsHydratedUser === uid) return layoutStore;
    layoutsHydrated = true;
    layoutsHydratedUser = uid;
    try {
      const res = onXrLayoutsLoad?.();
      Promise.resolve(res).then((data) => {
        if (!data) return;
        layoutStore = mergeLayoutStores(loadLocalLayoutStore(), data);
        try {
          localStorage.setItem(xrLayoutsStorageKey(layoutUserId()), stringifyLayoutStore(layoutStore));
        } catch (_) {}
        try { refreshWorkspacePanel(); } catch (_) {}
      }).catch(() => {});
    } catch (_) {}
    return layoutStore;
  }

  /** Save window pose relative to current head — survives headset off / new XR session origin. */
  function savePanelPose(kind, group) {
    if (!group) return;
    try {
      ensureXrHeadPose();
      const f = headForwardFlat(new THREE.Vector3());
      const right = headRightFlat();
      const world = group.getWorldPosition(new THREE.Vector3());
      const delta = world.clone().sub(_headPos);
      const all = loadAllPanelPoses();
      const wq = group.getWorldQuaternion(new THREE.Quaternion());
      all[kind] = {
        v: 2,
        visible: !!group.visible,
        forward: THREE.MathUtils.clamp(delta.dot(f), PANEL_FWD_MIN, PANEL_FWD_MAX),
        right: THREE.MathUtils.clamp(delta.dot(right), -PANEL_RIGHT_MAX, PANEL_RIGHT_MAX),
        up: THREE.MathUtils.clamp(world.y - _headPos.y, PANEL_UP_MIN, PANEL_UP_MAX),
        tab: kind === "menu" ? (menuTab || "projects") : undefined,
        wx: world.x,
        wy: world.y,
        wz: world.z,
        qx: wq.x,
        qy: wq.y,
        qz: wq.z,
        qw: wq.w,
        locked: isXrHudLocked(kind, hudStorage()),
        userRotated: !!group.userData?.xrUserRotated,
      };
      if (kind === "ai") all.aiOpen = !!group.visible;
      if (kind === "menu") {
        all.menuOpen = !!group.visible;
        all.menuTab = menuTab || "projects";
      }
      if (kind === "view") all.viewOpen = !!group.visible;
      if (kind === "settings") all.settingsOpen = !!group.visible;
      if (kind === "tools") all.toolsOpen = !!group.visible;
      if (kind === "aiHub") all.aiHubOpen = !!group.visible;
      if (kind === "socialHub") all.socialHubOpen = !!group.visible;
      if (kind === "workspace") all.workspaceOpen = !!group.visible;
      if (kind === "avatar") all.avatarOpen = !!group.visible;
      if (kind === "place") all.placeOpen = !!group.visible;
      if (kind === "studio") all.studioOpen = !!group.visible;
      if (kind === "social") all.socialOpen = !!group.visible;
      if (kind === "robotics") all.roboticsOpen = !!group.visible;
      persistPanelLayout(all);
    } catch (_) {}
  }

  function applySavedPanelPose(kind, group) {
    if (!group) return false;
    try {
      const data = loadAllPanelPoses()[kind];
      if (!savedPanelOffsetsSane(data)) return false;
      ensureXrHeadPose();
      ensureHudWorldParent(group);
      const f = headForwardFlat(new THREE.Vector3());
      const right = headRightFlat();
      const fwd = THREE.MathUtils.clamp(Number(data.forward) || PANEL_SPAWN_FWD, PANEL_FWD_MIN, PANEL_FWD_MAX);
      const rightOff = THREE.MathUtils.clamp(Number(data.right) || 0, -PANEL_RIGHT_MAX, PANEL_RIGHT_MAX);
      const up = THREE.MathUtils.clamp(
        Number.isFinite(data.up) ? data.up : PANEL_UP_DEFAULT,
        PANEL_UP_MIN,
        PANEL_UP_MAX,
      );
      const pos = _headPos.clone().addScaledVector(f, fwd).addScaledVector(right, rightOff);
      pos.y = _headPos.y + up;
      const locked = isXrHudLocked(kind, hudStorage()) || data.locked === true;
      if (locked && Number.isFinite(data.wx) && Number.isFinite(data.wy) && Number.isFinite(data.wz)) {
        pos.set(data.wx, data.wy, data.wz);
      } else {
        // Stale per-project poses can park windows in the sky (world-Y leftover).
        if (pos.y > _headPos.y + 0.28 || pos.y < _headPos.y - 0.7) return false;
        if (Math.hypot(pos.x - _headPos.x, pos.z - _headPos.z) > PANEL_RANGE_MAX) return false;
      }
      const quat = new THREE.Quaternion(
        Number(data.qx),
        Number(data.qy),
        Number(data.qz),
        Number(data.qw),
      );
      const hasQuat = quat.lengthSq() > 0.25;
      const keepYaw = shouldPersistPanelYaw({
        hasQuat,
        userRotated: data.userRotated === true || !!group.userData?.xrUserRotated,
        locked,
      });
      if (keepYaw) {
        try { group.userData.xrUserRotated = true; } catch (_) {}
      }
      setPanelWorldPose(group, pos, keepYaw ? quat.normalize() : null);
      if (!keepYaw) facePanelTowardHead(group, pos);
      if (locked) {
        try { group.userData.xrHudParked = true; } catch (_) {}
      }
      return panelWorldPosIsUsable(group) || (locked && Number.isFinite(pos.x));
    } catch {
      return false;
    }
  }

  function saveOpenWindowsLayout() {
    try {
      if (aiPanel?.group) savePanelPose("ai", aiPanel.group);
      if (explorerPanel?.group) savePanelPose("menu", explorerPanel.group);
      if (viewPanel?.group) savePanelPose("view", viewPanel.group);
      if (settingsPanel?.group) savePanelPose("settings", settingsPanel.group);
      if (toolsPanel?.group) savePanelPose("tools", toolsPanel.group);
      if (aiHubPanel?.group) savePanelPose("aiHub", aiHubPanel.group);
      if (socialHubPanel?.group) savePanelPose("socialHub", socialHubPanel.group);
      if (drawPanel?.group) savePanelPose("draw", drawPanel.group);
      if (workspacePanel?.group) savePanelPose("workspace", workspacePanel.group);
      if (avatarPanel?.group) savePanelPose("avatar", avatarPanel.group);
      if (placePanel?.group) savePanelPose("place", placePanel.group);
      if (xrStudio?.group) savePanelPose("studio", xrStudio.group);
      if (xrSocialCard?.group) savePanelPose("social", xrSocialCard.group);
      if (roboticsPanel?.group) savePanelPose("robotics", roboticsPanel.group);
      const again = loadAllPanelPoses();
      again.aiOpen = (tabbedWindows?.isOpen(aiPanel?.group) ?? !!aiPanel?.group?.visible);
      again.menuOpen = (tabbedWindows?.isOpen(explorerPanel?.group) ?? !!explorerPanel?.group?.visible);
      again.viewOpen = (tabbedWindows?.isOpen(viewPanel?.group) ?? !!viewPanel?.group?.visible);
      again.settingsOpen = (tabbedWindows?.isOpen(settingsPanel?.group) ?? !!settingsPanel?.group?.visible);
      again.toolsOpen = (tabbedWindows?.isOpen(toolsPanel?.group) ?? !!toolsPanel?.group?.visible);
      again.aiHubOpen = (tabbedWindows?.isOpen(aiHubPanel?.group) ?? !!aiHubPanel?.group?.visible);
      again.socialHubOpen = (tabbedWindows?.isOpen(socialHubPanel?.group) ?? !!socialHubPanel?.group?.visible);
      again.drawOpen = (tabbedWindows?.isOpen(drawPanel?.group) ?? !!drawPanel?.group?.visible);
      again.workspaceOpen = (tabbedWindows?.isOpen(workspacePanel?.group) ?? !!workspacePanel?.group?.visible);
      again.avatarOpen = (tabbedWindows?.isOpen(avatarPanel?.group) ?? !!avatarPanel?.group?.visible);
      again.placeOpen = (tabbedWindows?.isOpen(placePanel?.group) ?? !!placePanel?.group?.visible);
      again.studioOpen = (tabbedWindows?.isOpen(xrStudio?.group) ?? !!xrStudio?.isOpen?.());
      again.socialOpen = (tabbedWindows?.isOpen(xrSocialCard?.group) ?? !!xrSocialCard?.isOpen?.());
      again.roboticsOpen = (tabbedWindows?.isOpen(roboticsPanel?.group) ?? !!roboticsPanel?.group?.visible);
      again.menuTab = menuTab || "projects";
      persistPanelLayout(again);
    } catch (_) {}
  }

  function restoreOpenWindowsLayout() {
    const all = loadAllPanelPoses();
    if (all.menuTab) menuTab = all.menuTab;
    if (all.aiOpen === true) {
      openAiPromptPanel({ keepPose: true, forcePlace: !all.ai });
    } else if (aiPanel) {
      aiPanel.group.visible = false;
    }
    if (all.menuOpen === true) {
      openMenuConsole({ tab: menuTab || "projects", keepPose: true, forcePlace: !all.menu });
    } else if (explorerPanel) {
      explorerPanel.group.visible = false;
    }
    if (all.viewOpen === true) {
      openViewPanel({ keepPose: true, forcePlace: !all.view });
    } else if (viewPanel) {
      viewPanel.group.visible = false;
    }
    if (all.settingsOpen === true) {
      openGridPopup("settings", { keepPose: true, forcePlace: !all.settings });
    } else if (settingsPanel) {
      settingsPanel.group.visible = false;
    }
    if (all.toolsOpen === true) {
      openGridPopup("tools", { keepPose: true, forcePlace: !all.tools });
    } else if (toolsPanel) {
      toolsPanel.group.visible = false;
    }
    if (all.socialHubOpen === true) {
      openGridPopup("social", { keepPose: true, forcePlace: !all.socialHub });
    } else if (socialHubPanel) {
      socialHubPanel.group.visible = false;
    }
    if (all.drawOpen === true) {
      openGridPopup("draw", { keepPose: true, forcePlace: !all.draw });
    } else if (drawPanel) {
      drawPanel.group.visible = false;
    }
    if (all.workspaceOpen === true) {
      openWorkspacePanel({ keepPose: true, forcePlace: !all.workspace });
    } else if (workspacePanel) {
      workspacePanel.group.visible = false;
    }
    if (all.avatarOpen === true) {
      openAvatarPanel({ keepPose: true, forcePlace: !all.avatar });
    } else if (avatarPanel) {
      avatarPanel.group.visible = false;
    }
    if (all.aiHubOpen === true) {
      openGridPopup("aiHub", { keepPose: true, forcePlace: !all.aiHub });
    } else if (aiHubPanel) {
      aiHubPanel.group.visible = false;
    }
    if (all.placeOpen === true) {
      openPlacePanel({ keepPose: true, forcePlace: !all.place });
    } else if (placePanel) {
      placePanel.group.visible = false;
    }
    if (all.studioOpen === true) {
      if (!xrStudio.isOpen()) {
        ensureXrHeadPose();
        xrStudio.open(_headPos, headForwardFlat());
      }
      if (!applySavedPanelPose("studio", xrStudio.group)) {
        ensureHudWorldParent(xrStudio.group);
        if (!panelWorldPosIsUsable(xrStudio.group)) {
          const pos = defaultMenuWorldPos();
          pos.add(headRightFlat().multiplyScalar(0.18));
          setPanelWorldPose(xrStudio.group, pos);
          facePanelTowardHead(xrStudio.group, pos);
        }
      }
      void refreshStudioPanel();
    } else {
      if (xrStudioStateAbort) {
        try { xrStudioStateAbort.abort(); } catch (_) { /* ignore */ }
      }
      try { xrStudio.close(); } catch (_) {}
    }
    if (all.socialOpen === true && xrSocialCard?.group) {
      try {
        if (!xrSocialCard.isOpen?.()) {
          ensureXrHeadPose();
          xrSocialCard.open?.(null, _headPos, headForwardFlat());
        }
      } catch (_) {}
      try { applySavedPanelPose("social", xrSocialCard.group); } catch (_) {}
    } else {
      try { xrSocialCard?.close?.(); } catch (_) {}
    }
    if (all.roboticsOpen === true) {
      openRoboticsPanel({ keepPose: true, forcePlace: !all.robotics });
    } else if (roboticsPanel) {
      roboticsPanel.group.visible = false;
    }
    try { layoutOpenWindowsArc(); } catch (_) {}
  }

  function captureNamedLayout(name) {
    try { saveOpenWindowsLayout(); } catch (_) {}
    const all = loadAllPanelPoses();
    const id = `lay-${Date.now().toString(36)}`;
    const record = serializeOpenWindowsLayout(all, {
      name: name || nextLayoutName(layoutStore.layouts),
      id,
      sceneId: xrSceneKind,
    });
    try { record.thumb = layoutThumbnailDataUrl(record); } catch { record.thumb = ""; }
    layoutStore = persistLayoutStore(upsertNamedLayout(layoutStore, record));
    return record;
  }

  function applyNamedLayout(id, { userPicked = true } = {}) {
    if (!shouldAutoApplyLastLayout({ userPicked })) return false;
    const record = layoutById(layoutStore, id);
    if (!record) return false;
    if (record.sceneId) setXrSceneKind(record.sceneId);
    const mapped = applyLayoutToPoseMap(record);
    persistPanelLayout({ ...loadAllPanelPoses(), ...mapped });
    layoutStore = persistLayoutStore(markLayoutUsed(layoutStore, record.id));
    try { restoreOpenWindowsLayout(); } catch (_) {}
    overlayRelayerDirty = true;
    menuFooterHint = `Layout · ${record.name}`;
    try { refreshWorkspacePanel(); } catch (_) {}
    return true;
  }

  function showLayoutGalleryOnProjectEnter() {
    hydrateXrLayouts();
    if (!presenting) return;
    try { openWorkspacePanel({ keepPose: true, forcePlace: false }); } catch (_) {}
  }

  function reapplyOpenWindowPoses() {
    try {
      if (explorerPanel?.group?.visible) {
        if (
          shouldReapplySavedMenuPoseOnBoot({ fromBoot: bootMenuLeftMonitor })
          && applySavedPanelPose("menu", explorerPanel.group)
        ) {
          explorerPanel.worldPlaced = true;
        } else {
          placeMenuAtDefault(explorerPanel.group);
          explorerPanel.worldPlaced = true;
        }
      }
      if (aiPanel?.group?.visible) {
        if (!applySavedPanelPose("ai", aiPanel.group)) {
          const pos = spawnPanelWorldPos(0.28);
          setPanelWorldPose(aiPanel.group, pos);
          facePanelTowardHead(aiPanel.group, pos);
        }
        aiPanel.worldPlaced = true;
      }
      if (viewPanel?.group?.visible) {
        if (!applySavedPanelPose("view", viewPanel.group)) {
          const pos = spawnPanelWorldPos(-0.22);
          setPanelWorldPose(viewPanel.group, pos);
          facePanelTowardHead(viewPanel.group, pos);
        }
        viewPanel.worldPlaced = true;
      }
      if (settingsPanel?.group?.visible) {
        if (!applySavedPanelPose("settings", settingsPanel.group)) {
          const pos = spawnPanelWorldPos(-0.34);
          setPanelWorldPose(settingsPanel.group, pos);
          facePanelTowardHead(settingsPanel.group, pos);
        }
        settingsPanel.worldPlaced = true;
      }
      if (toolsPanel?.group?.visible) {
        if (!applySavedPanelPose("tools", toolsPanel.group)) {
          const pos = spawnPanelWorldPos(0.26);
          setPanelWorldPose(toolsPanel.group, pos);
          facePanelTowardHead(toolsPanel.group, pos);
        }
        toolsPanel.worldPlaced = true;
      }
      if (aiHubPanel?.group?.visible) {
        if (!applySavedPanelPose("aiHub", aiHubPanel.group)) {
          const pos = spawnPanelWorldPos(0.36);
          setPanelWorldPose(aiHubPanel.group, pos);
          facePanelTowardHead(aiHubPanel.group, pos);
        }
        aiHubPanel.worldPlaced = true;
      }
      if (socialHubPanel?.group?.visible) {
        if (!applySavedPanelPose("socialHub", socialHubPanel.group)) {
          const pos = spawnPanelWorldPos(-0.16);
          setPanelWorldPose(socialHubPanel.group, pos);
          facePanelTowardHead(socialHubPanel.group, pos);
        }
        socialHubPanel.worldPlaced = true;
      }
      if (drawPanel?.group?.visible) {
        if (!applySavedPanelPose("draw", drawPanel.group)) {
          const pos = spawnPanelWorldPos(0.28);
          setPanelWorldPose(drawPanel.group, pos);
          facePanelTowardHead(drawPanel.group, pos);
        }
        drawPanel.worldPlaced = true;
      }
      if (workspacePanel?.group?.visible) {
        if (!applySavedPanelPose("workspace", workspacePanel.group)) {
          const pos = spawnPanelWorldPos(0.22);
          setPanelWorldPose(workspacePanel.group, pos);
          facePanelTowardHead(workspacePanel.group, pos);
        }
        workspacePanel.worldPlaced = true;
      }
      if (avatarPanel?.group?.visible) {
        if (!applySavedPanelPose("avatar", avatarPanel.group)) {
          const pos = spawnPanelWorldPos(-0.28);
          setPanelWorldPose(avatarPanel.group, pos);
          facePanelTowardHead(avatarPanel.group, pos);
        }
        avatarPanel.worldPlaced = true;
      }
      if (placePanel?.group?.visible) {
        if (!applySavedPanelPose("place", placePanel.group) && !panelWorldPosIsUsable(placePanel.group)) {
          const pos = spawnPanelWorldPos(0.32);
          setPanelWorldPose(placePanel.group, pos);
          facePanelTowardHead(placePanel.group, pos);
        }
        placePanel.worldPlaced = true;
      }
      if (xrStudio?.isOpen?.()) {
        if (!applySavedPanelPose("studio", xrStudio.group) && !panelWorldPosIsUsable(xrStudio.group)) {
          const pos = defaultMenuWorldPos();
          setPanelWorldPose(xrStudio.group, pos);
          facePanelTowardHead(xrStudio.group, pos);
        }
      }
    } catch (_) {}
  }

  const xrHud = new THREE.Group();
  xrHud.name = "xrHud";
  xrHud.visible = false;
  xrHud.frustumCulled = false;
  scene.add(xrHud);

  // Dedicated lights so CAD PBR materials aren't black in AR
  const xrAmbient = new THREE.AmbientLight(0xffffff, 1.2);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x556677, 1.35);
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(0.4, 1.2, 0.6);
  const fill = new THREE.DirectionalLight(0xaaccff, 0.7);
  fill.position.set(-0.8, 0.4, -0.3);
  hemi.visible = false;
  key.visible = false;
  fill.visible = false;
  xrHud.add(xrAmbient, hemi, key, fill);
  const _keyOffset = new THREE.Vector3(0.5, 1.0, 0.4);

  const xrAimCursor = new THREE.Mesh(
    new THREE.RingGeometry(0.0025, 0.0033, 20),
    new THREE.MeshBasicMaterial({
      color: 0x7dd3fc,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
    }),
  );
  xrAimCursor.name = "xrAimCursor";
  xrAimCursor.renderOrder = 50020;
  xrAimCursor.visible = false;
  xrAimCursor.frustumCulled = false;
  disableXrPointerRaycast(xrAimCursor);
  xrHud.add(xrAimCursor);

  function updateAimCursor(hit, controller) {
    if ((!isUiPick(hit) && !isXrUiHoverKind(hit?.kind)) || !hit.point) {
      xrAimCursor.visible = false;
      return;
    }
    xrAimCursor.visible = true;
    xrAimCursor.position.copy(hit.point);
    getHeadPose();
    const toHead = _headPos.clone().sub(hit.point);
    if (toHead.lengthSq() > 1e-8) {
      xrAimCursor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), toHead.normalize());
    } else if (controller) {
      controller.getWorldQuaternion(xrAimCursor.quaternion);
    }
  }

  // Never allocate the old cyan 16 cm BoxGeometry (xrFaceProbe) — even hidden
  // it stole squeeze / AABB picks. Dummy only so capture stash stays safe.
  const faceProbe = { name: "xrFaceProbe", visible: false };

  const controllers = [];
  const grips = [];
  const hands = [];
  const pinchAnchors = [new THREE.Group(), new THREE.Group()];
  pinchAnchors.forEach((anchor, i) => {
    anchor.name = i === 0 ? "xrPinchLeft" : "xrPinchRight";
    anchor.userData.handedness = i === 0 ? "left" : "right";
    scene.add(anchor);
  });
  // Dock is NEVER parented to getControllerGrip/getHand — those Object3Ds are
  // rebound to inputSources[i] when Quest reorders, which parked the menu on
  // the other Touch. Copy the preferred hand's live pose onto this stable group.
  const dockAnchor = new THREE.Group();
  dockAnchor.name = "xrDockAnchor";
  dockAnchor.visible = false;
  scene.add(dockAnchor);
  const statusDockMatrix = new THREE.Matrix4();
  const statusAnchor = new THREE.Group();
  statusAnchor.name = "xrStatusAnchor";
  statusAnchor.visible = false;
  scene.add(statusAnchor);
  // Same idea for grab: stick the CAD to this group, copy the squeezing
  // hand's *grip* pose onto it so yaw/pitch follow the Touch, not a remapped ray.
  const gripGrabAnchor = new THREE.Group();
  gripGrabAnchor.name = "xrGripGrabAnchor";
  scene.add(gripGrabAnchor);
  let lastDockAt = 0;
  let dockHasPose = false;
  let lastStatusAt = 0;
  let statusHasPose = false;
  let dockMode = "";
  let lastSessionVisibility = "";
  let lastXrRefSpace = null;
  const raycaster = new THREE.Raycaster();
  const _uiPlane = new THREE.Plane();
  const _uiPlanePt = new THREE.Vector3();
  const _uiPlaneN = new THREE.Vector3();
  const _uiLocal = new THREE.Vector3();
  const _uiBtnWorld = new THREE.Vector3();
  const _headPos = new THREE.Vector3();
  const _eyeA = new THREE.Vector3();
  const _eyeB = new THREE.Vector3();
  const _headQuat = new THREE.Quaternion();
  const _fwd = new THREE.Vector3();
  const _v = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  const _mat = new THREE.Matrix4();
  const _grabNext = new THREE.Matrix4();
  const _grabWorld = new THREE.Matrix4();
  const _grabInv = new THREE.Matrix4();
  const _grabOne = new THREE.Vector3(1, 1, 1);
  const _panelNow = new THREE.Vector3();
  const _menuAimPos = new THREE.Vector3();
  const _dockGrip = new THREE.Vector3();
  const _dockToward = new THREE.Vector3();
  const _dockWorld = new THREE.Vector3();
  const _dockCapWorld = new THREE.Vector3();
  const _dockUp = new THREE.Vector3(0, 1, 0);
  const _dockLook = new THREE.Matrix4();
  const _dockWorldQ = new THREE.Quaternion();
  const _dockParentQ = new THREE.Quaternion();
  const _dockLocalQ = new THREE.Quaternion();
  const _dockFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const _faceWorldQ = new THREE.Quaternion();
  const _faceParentQ = new THREE.Quaternion();
  const _handTip = new THREE.Vector3();
  const _handProx = new THREE.Vector3();
  const _handDir = new THREE.Vector3();
  const _handInv = new THREE.Matrix4();
  const _handLocalO = new THREE.Vector3();
  const _handLocalT = new THREE.Vector3();
  const _handLocalD = new THREE.Vector3();
  const _handZNeg = new THREE.Vector3(0, 0, -1);
  const _posePos = new THREE.Vector3();
  const _poseQuat = new THREE.Quaternion();
  const _poseScl = new THREE.Vector3(1, 1, 1);
  const _poseWorld = new THREE.Matrix4();
  const _poseInv = new THREE.Matrix4();
  const _poseLocal = new THREE.Matrix4();
  const _sizeTmp = new THREE.Vector3();
  const _scalePosA = new THREE.Vector3();
  const _scalePosB = new THREE.Vector3();

  let saved = null; // { mesh, pos, quat, scale, parent }
  let grabState = null;
  let panelDrag = null;
  let placePanel = null;
  let beacon = null;
  let recordOverlay = null;
  let recordSpectator = null;
  let lastRecordPaintAt = 0;
  let recordSpectatorFailed = false;
  let savedBackground = null;
  let savedToneMapping = null;
  let savedToneExposure = null;
  let savedFog = null;
  let savedShadowMap = null;
  let savedPixelRatio = null;
  let savedNear = null;
  let savedFar = null;
  let frustumBackup = [];
  let faceProbeHideAt = 0;

  // Measure
  const measureGroup = new THREE.Group();
  xrHud.add(measureGroup);
  const measurePoints = [];
  const measureEdges = [];
  let measureLine = null;
  let measureLabel = null;
  let measureHoverEdge = null;

  // Gravity Sketch–style palette (pucks + captions on the non-drawing hand)
  const dock = new THREE.Group();
  dock.name = "xrToolDock";
  dock.visible = false;
  dock.frustumCulled = false;
  dock.renderOrder = 10000;
  const statusDock = new THREE.Group();
  const pickWristUi = createXrWristPicker(THREE);
  statusDock.name = "xrStatusDock";
  statusDock.visible = false;
  statusDock.frustumCulled = false;
  statusDock.renderOrder = 10000;
  const dockPalette = buildHandPalette(dock, DOCK_TOOLS, {
    dockHand: preferredDockHand,
    statusGroup: statusDock,
  });
  const dockButtons = dockPalette.buttons || [];
  try { dockPalette.setPassThroughOn?.(passthroughOn); } catch (_) {}
  try { dockPalette.setDockHand?.(preferredDockHand); } catch (_) {}
  const xrWhiteRoom = createXrCheapVrStage();
  xrWhiteRoom.visible = false;
  try { scene.add(xrWhiteRoom); } catch (_) {}
  const xrWarehouseRoom = createXrCheapWarehouseStage();
  xrWarehouseRoom.visible = false;
  try { scene.add(xrWarehouseRoom); } catch (_) {}
  // Workshop geometry is intentionally absent from boot. The pinned Workshop
  // tab is the sole allocation boundary for its room and desktop walk mode.
  let xrWorkshopRoom = null;
  const WORKSHOP_SCREEN_DEFAULTS = Object.freeze({
    screen_openarm_viser: "viser",
    screen_robotics_controls: "robotics",
    screen_robot_pov: "robot-pov",
    screen_task_queue: "tasks",
    screen_editor_ide: "editor",
    screen_training_data: "training",
    screen_success_statistics: "stats",
    screen_generated_files: "files",
    screen_zed_live_feed: "zed-pov",
    screen_render_manager: "render-manager",
  });
  let xrWorkshopProjectRoom = null;
  let xrWorkshopProjectPromise = null;
  let xrWorkshopAssetKey = "";
  let workshopColliders = [];
  let workshopViewMode = "first";
  const workshopPlayerHead = new THREE.Vector3();
  let workshopPlayerAvatar = null;
  let workshopExplicitlyRequested = false;
  let pendingWorkshopVrSpawn = null;
  let workshopConfig = null;
  let generationSurfacePick = null;
  let selectedGenerationSurface = null;
  let workshopKillButton = null;
  let workshopPrinterPreviousPlacement = null;
  let workshopPrinterTargetActive = false;
  const xrEnterSplash = createXrEnterSplash({ THREE, scene });
  try {
    renderer?.domElement?.addEventListener("webglcontextlost", (ev) => {
      try { ev.preventDefault(); } catch (_) {}
      console.warn("[viewport-xr] WebGL context lost during XR");
    });
  } catch (_) {}
  let xrSceneKind = "white";
  let xrWrapTexture = null;
  let xrEnvDirty = true;
  let workspaceSceneMenu = false;
  let workspaceRefsOpen = false;
  let workspaceTab = "projects";
  const toolWheel = createXrToolWheel();
  scene.add(toolWheel.group);
  let drawColor = 0x06b6d4;
  const xrSolidDraw = createXrSolidDraw({
    THREE,
    scene,
    getColor: () => drawColor,
  });
  const xrBuild = createXrBuildTools({ THREE, scene });
  const xrCreateHistory = createXrCreateHistory();
  const toolHand = createXrToolHand({ THREE });
  scene.add(toolHand.anchor);
  const xrSocialCard = createXrSocialCard({ THREE, scene });
  const xrStudio = createXrStudioPanel({ THREE, scene });
  try { markWorldUi(xrSocialCard?.group); } catch (_) {}
  try { markWorldUi(xrStudio?.group); } catch (_) {}
  let studioPayload = null;
  let lastShotAt = 0;
  let aButtonHeld = false;
  let bButtonHeld = false;
  let leftMenuBtnHeld = false;
  let bButtonDownAt = 0;
  let bHoldResetDone = false;
  let laserAimMode = false;
  let lastPointerHoverHit = null;
  let lastTableLaser = { point: null, origin: null, direction: null, kind: "", at: 0 };
  let lastMoveTableVoice = "";
  let lastTooMuchVoice = "";
  let lastSamSuggestVoice = "";
  let lastSamCorrectVoice = "";
  let lastSandboxVoice = "";
  let lastVoiceExample = "";
  let lastVoiceSwap = "";
  let tableMoveWatch = 0;
  let lastMenuAimNear = false;
  let lastRayOnMenu = false;
  const BTN_R = 0.018;
  const BTN_GAP = 0.042;
  let wristMenuLatched = false;
  let wristPinned = false;
  let wheelDismissedThisHold = false;
  let wristReveal = 0;
  xrHud.add(dock);
  xrHud.add(statusDock);
  const xrDevStats = createXrDevStats({ THREE, parent: xrHud });
  try { xrDevStats.setEnabled(developerMode); } catch (_) {}

  // Left-hand capture strip (screenshot / record / pause / stop)
  const captureDock = new THREE.Group();
  captureDock.name = "xrCaptureDock";
  captureDock.visible = false;
  captureDock.frustumCulled = false;
  captureDock.renderOrder = 10000;
  const captureDockButtons = [];
  let captureRecState = { recording: false, paused: false, elapsedMs: 0, clipReady: false };
  let pendingStreamProvider = "";
  let captureTimerMesh = null;
  let captureTimerTex = null;
  xrHud.add(captureDock);

  function currentHeadsetCastFamily() {
    const profiles = [];
    try {
      for (const src of session?.inputSources || []) {
        if (Array.isArray(src?.profiles)) profiles.push(...src.profiles);
      }
    } catch (_) {}
    const mm = typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? (q) => window.matchMedia(q)
      : null;
    return detectHeadsetCastFamily({
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      locationHref: typeof location !== "undefined" ? location.href : "",
      sessionMode: sessionMode || session?.mode || "",
      xrMode: sessionMode || "",
      profiles,
      presenting: !!presenting,
      matchMedia: mm,
    });
  }

  function captureToolDefs() {
    if (captureRecState.recording) {
      return [
        {
          id: "record_pause",
          label: captureRecState.paused ? "Resume" : "Pause",
          color: 0xfbbf24,
          glyph: captureRecState.paused ? "▶" : "❚❚",
          icon: "pause",
        },
        { id: "record_stop", label: "Stop", color: 0xef4444, glyph: "■", icon: "stop" },
      ];
    }
    if (captureRecState.clipReady) {
      return [
        { id: "shot_send_pc", label: "PC", color: 0x22c55e, glyph: "PC", icon: "export" },
        { id: "shot_share_x", label: "X", color: 0x0ea5e9, glyph: "X", icon: "cam" },
        { id: "screenshot", label: "Shot", color: 0x38bdf8, glyph: "▣", icon: "cam" },
      ];
    }
    return [
      { id: "screenshot", label: "Shot", color: 0x38bdf8, glyph: "▣", icon: "cam" },
      { id: "shot_send_pc", label: "PC", color: 0x22c55e, glyph: "PC", icon: "export" },
      { id: "shot_share_x", label: "X", color: 0x0ea5e9, glyph: "X", icon: "cam" },
      { id: "record", label: "Rec", color: 0xef4444, glyph: "●", icon: "rec" },
    ];
  }

  function clearCaptureDockButtons() {
    for (const btn of captureDockButtons.splice(0)) {
      const label = btn.userData.labelMesh;
      const ring = btn.userData.ring;
      captureDock.remove(btn);
      if (label) captureDock.remove(label);
      if (ring) captureDock.remove(ring);
      btn.geometry?.dispose?.();
      btn.material?.dispose?.();
      label?.geometry?.dispose?.();
      label?.material?.map?.dispose?.();
      label?.material?.dispose?.();
      ring?.geometry?.dispose?.();
      ring?.material?.dispose?.();
    }
  }

  function rebuildCaptureDock() {
    if (!shouldRebuildCaptureDock({
      visible: captureDockVisible({ presenting }),
      modeChanged: false,
      buttonCount: captureDockButtons.length,
    })) {
      syncCaptureDockVisibility();
      return;
    }
    clearCaptureDockButtons();
    const tools = captureToolDefs();
    tools.forEach((tool, i) => {
      const btn = new THREE.Mesh(
        new THREE.CircleGeometry(BTN_R, 32),
        new THREE.MeshBasicMaterial({
          color: tool.color,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
        }),
      );
      btn.position.set(0, ((tools.length - 1) / 2 - i) * BTN_GAP, 0);
      btn.userData.xrTool = tool.id;
      btn.renderOrder = 10060;
      btn.frustumCulled = false;
      captureDock.add(btn);
      captureDockButtons.push(btn);
      const label = new THREE.Mesh(
        new THREE.CircleGeometry(BTN_R * 0.9, 32),
        new THREE.MeshBasicMaterial({
          map: makeIconTexture(tool.glyph, tool.color, tool.label, tool.icon),
          transparent: true,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
        }),
      );
      label.position.copy(btn.position);
      label.position.z = 0.0015;
      label.renderOrder = 10062;
      label.frustumCulled = false;
      label.raycast = () => {};
      captureDock.add(label);
      btn.userData.labelMesh = label;
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(BTN_R + 0.0015, BTN_R + 0.004, 32),
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: captureRecState.recording && tool.id === "record_stop" ? 0.55 : 0,
          side: THREE.DoubleSide,
          depthTest: false,
        }),
      );
      ring.position.copy(btn.position);
      ring.position.z = 0.002;
      ring.renderOrder = 10063;
      ring.frustumCulled = false;
      captureDock.add(ring);
      btn.userData.ring = ring;
    });
    // Plate behind capture chips
    let plateMesh = captureDock.getObjectByName("xrCapturePlate");
    if (plateMesh) {
      captureDock.remove(plateMesh);
      plateMesh.geometry?.dispose?.();
      plateMesh.material?.dispose?.();
    }
    plateMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.07, tools.length * BTN_GAP + 0.03),
      new THREE.MeshBasicMaterial({
        color: captureRecState.recording ? 0x450a0a : 0x0f172a,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    plateMesh.name = "xrCapturePlate";
    plateMesh.position.z = -0.006;
    plateMesh.renderOrder = 10040;
    plateMesh.frustumCulled = false;
    plateMesh.userData.xrUi = "chrome";
    captureDock.add(plateMesh);
    syncCaptureTimer();
  }

  function syncCaptureTimer() {
    if (!captureRecState.recording) {
      if (captureTimerMesh) captureTimerMesh.visible = false;
      return;
    }
    const ms = captureRecState.elapsedMs || 0;
    const s = Math.max(0, Math.floor(ms / 1000));
    const text = `${captureRecState.paused ? "❚❚ " : "● "}${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 64;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "rgba(127,29,29,0.92)";
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = "#fecaca";
    ctx.font = "bold 36px Arial,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 128, 34);
    if (!captureTimerTex) {
      captureTimerTex = new THREE.CanvasTexture(c);
      captureTimerTex.colorSpace = THREE.SRGBColorSpace;
    } else {
      captureTimerTex.image = c;
      captureTimerTex.needsUpdate = true;
    }
    if (!captureTimerMesh) {
      captureTimerMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.09, 0.022),
        new THREE.MeshBasicMaterial({
          map: captureTimerTex,
          transparent: true,
          depthTest: false,
          side: THREE.DoubleSide,
        }),
      );
      captureTimerMesh.position.set(0, 0.085, 0.004);
      captureTimerMesh.renderOrder = 10070;
      captureTimerMesh.frustumCulled = false;
      captureTimerMesh.raycast = () => {};
      captureDock.add(captureTimerMesh);
    } else {
      captureTimerMesh.material.map = captureTimerTex;
      captureTimerMesh.material.needsUpdate = true;
    }
    captureTimerMesh.visible = true;
  }

  function syncCaptureDockVisibility() {
    if (!captureDock) return;
    captureDock.visible = false; // Capture lives in the expandable left-wrist folder.
  }

  function setCaptureState(state = {}) {
    const recording = !!state.recording;
    const next = {
      recording,
      paused: !!state.paused,
      elapsedMs: Number(state.elapsedMs) || 0,
      clipReady: recording ? false : !!state.clipReady,
    };
    const modeChanged =
      next.recording !== captureRecState.recording
      || next.paused !== captureRecState.paused
      || next.clipReady !== captureRecState.clipReady;
    captureRecState = next;
    if (shouldRebuildCaptureDock({
      visible: captureDockVisible({ presenting }),
      modeChanged,
      buttonCount: captureDockButtons.length,
    })) rebuildCaptureDock();
    else syncCaptureTimer();
    syncCaptureDockVisibility();
    try {
      dockPalette.setRecordingState?.({
        recording: next.recording,
        paused: next.paused,
        elapsedMs: next.elapsedMs,
        clipReady: next.clipReady,
      });
    } catch (_) {}
    for (const btn of captureDockButtons) {
      if (btn.userData.xrTool === "record_stop" && btn.userData.ring) {
        btn.userData.ring.material.opacity = next.recording ? 0.65 : 0;
      }
      if (btn.userData.xrTool === "record_pause" && btn.userData.ring) {
        btn.userData.ring.material.opacity = next.paused ? 0.5 : 0.15;
      }
    }
  }

  rebuildCaptureDock();

  let explorerPanel = null;
  let sessionIsPassthrough = false;

  const xrGltfLoader = new GLTFLoader();
  function indexWorkshopScreens(root) {
    const screens = {};
    root?.traverse?.((obj) => {
      if (obj?.name === "Collision" || obj?.userData?.role === "physics_only" || obj?.userData?.collision) obj.visible = false;
      if (Object.hasOwn(WORKSHOP_SCREEN_DEFAULTS, obj?.name)) {
        screens[obj.name] = obj;
        obj.userData.workshopFeature = WORKSHOP_SCREEN_DEFAULTS[obj.name];
        obj.userData.workshopPinnable = true;
      }
    });
    const virtualSlots = Object.keys(WORKSHOP_SCREEN_DEFAULTS);
    virtualSlots.forEach((name, index) => {
      if (screens[name]) return;
      const anchor = new THREE.Object3D();
      anchor.name = name;
      const column = index % 4;
      const row = Math.floor(index / 4);
      anchor.position.set(-2.7 + column * 1.8, 1.25 + row * 0.85, -3.72);
      anchor.userData.workshopFeature = WORKSHOP_SCREEN_DEFAULTS[name];
      anchor.userData.workshopPinnable = true;
      root.add(anchor);
      screens[name] = anchor;
    });
    root.userData.workshopProjectId = String(getProjectId?.() || "");
    root.userData.workshopScreens = screens;
    root.userData.workshopScreenDefaults = { ...WORKSHOP_SCREEN_DEFAULTS };
    return screens;
  }

  function addWorkshopPrinterStatus(root, printerBox) {
    if (root.getObjectByName("screen_printer_status")) return;
    const canvas = document.createElement("canvas");
    canvas.width = 768; canvas.height = 220;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0f172a"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 10; ctx.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
    ctx.fillStyle = "#f8fafc"; ctx.font = "800 54px system-ui"; ctx.textAlign = "center";
    ctx.fillText("3D PRINTER 1", canvas.width / 2, 88);
    ctx.fillStyle = "#7dd3fc"; ctx.font = "600 31px system-ui";
    ctx.fillText("Throw printable files into the marked volume", canvas.width / 2, 154);
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.30), new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide }));
    mesh.name = "screen_printer_status";
    mesh.position.set(printerBox.min.x + 0.32, Math.min(2.45, printerBox.max.y + 0.48), printerBox.getCenter(new THREE.Vector3()).z);
    mesh.rotation.y = Math.PI / 2;
    mesh.userData.workshopPinnable = true;
    mesh.userData.workshopFeature = "printer-status";
    root.add(mesh);
    root.userData.workshopScreens.screen_printer_status = mesh;
  }

  function configureWorkshopPrinterStation(root) {
    const printer = root?.getObjectByName?.("Printer_1");
    if (!printer) return false;
    root.updateMatrixWorld?.(true);
    const box = new THREE.Box3().setFromObject(printer);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    if (!workshopPrinterTargetActive) workshopPrinterPreviousPlacement = printerPlacement;
    workshopPrinterTargetActive = true;
    printerPlacement = {
      position: [center.x, center.y, center.z],
      size: [Math.max(0.2, size.x), Math.max(0.2, size.y), Math.max(0.2, size.z)],
      userDrawn: true,
      workshopProjectId: String(getProjectId?.() || ""),
      printerName: "3D Printer 1",
    };
    addWorkshopPrinterStatus(root, box);
    printerVisualsDirty = true;
    syncPrinterVisuals();
    return true;
  }

  function configureWorkshopRobotStation(root) {
    if (isCanonicalWorkshopConfig(workshopConfig)) {
      const layout = resolveCanonicalWorkshopLayout(workshopConfig, (name) => {
        const node = root.getObjectByName?.(name);
        if (!node) return null;
        root.updateMatrixWorld?.(true);
        const box = new THREE.Box3().setFromObject(node);
        if (box.isEmpty()) return null;
        const center = box.getCenter(new THREE.Vector3());
        center.y = box.max.y;
        return center.toArray();
      });
      const anchor = new THREE.Object3D();
      anchor.name = "OpenArm_Live_Network_Anchor";
      anchor.position.fromArray(layout.robot.position);
      root.worldToLocal?.(anchor.position);
      anchor.userData.canonicalWorkshopAnchor = true;
      root.add(anchor);
      root.userData.workshopRobotAnchor = anchor;
      workshopConfig.generationPlacement = canonicalCadPlacement(layout.cad.position);
      root.userData.workshopCadYaw = layout.cad.yaw;
      return;
    }
    if (root.getObjectByName("OpenArm_Network_Table")) return;
    const station = new THREE.Group(); station.name = "OpenArm_Network_Table";
    station.position.set(1.85, 0, -1.55);
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.055, 0.92), new THREE.MeshStandardMaterial({color:0x64748b,roughness:0.72}));
    top.position.y = 0.5334; station.add(top); // 21 inches exactly
    for (const [x,z] of [[-.39,-.39],[.39,-.39],[-.39,.39],[.39,.39]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(.055,.506,.055),new THREE.MeshStandardMaterial({color:0x334155}));
      leg.position.set(x,.253,z); station.add(leg);
    }
    const anchor = new THREE.Object3D(); anchor.name="OpenArm_Live_Network_Anchor"; anchor.position.set(0,.565,0); station.add(anchor);
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(.22,.12,.22),new THREE.MeshStandardMaterial({color:0x111827}));
    pedestal.position.set(.60,.59,0); station.add(pedestal);
    const kill = new THREE.Mesh(new THREE.CylinderGeometry(.085,.085,.055,28),new THREE.MeshStandardMaterial({color:0xdc2626,emissive:0x7f1d1d,emissiveIntensity:.8}));
    kill.position.set(.60,.68,0); kill.name="OpenArm_Emergency_Kill";
    kill.userData.xrRoboticsHit="workshop-kill"; station.add(kill); workshopKillButton=kill;
    root.add(station);
    root.userData.workshopRobotAnchor=anchor;
    root.userData.workshopCameraScreen=root.userData.workshopScreens?.screen_robot_pov || root.userData.workshopScreens?.screen_zed_live_feed || null;
  }

  function applyWorkshopAssetOrientation(root = xrWorkshopProjectRoom) {
    if (!root?.userData?.workshopAssetRotation) return;
    const canonical = canonicalRoomTransform(workshopConfig, {
      desktop: workspaceJoin && !presenting,
    });
    root.position.fromArray(canonical?.position || root.userData.workshopAssetPosition || [0, 0, 0]);
    root.rotation.fromArray(canonical?.rotation || workshopAssetRotation(root.userData.workshopAssetRotation, {
      desktop: workspaceJoin && !presenting,
    }));
    if (canonical) root.scale.fromArray(canonical.scale);
    root.updateMatrixWorld?.(true);
    if (!canonical) {
      const roomBounds = new THREE.Box3().setFromObject(root);
      if (!roomBounds.isEmpty() && Number.isFinite(roomBounds.min.y)) {
        root.position.y -= roomBounds.min.y;
        root.updateMatrixWorld?.(true);
      }
    }
  }

  async function ensureWorkshopProjectRoom() {
    if (!workshopExplicitlyRequested) return null;
    if (xrWorkshopProjectRoom) {
      await syncWorkshopSceneAsset();
      return xrWorkshopProjectRoom;
    }
    if (xrWorkshopProjectPromise) return xrWorkshopProjectPromise;
    xrWorkshopProjectPromise = Promise.resolve().then(() => {
      const root = new THREE.Group();
      root.name = "xrWorkshopProjectRoom";
      root.visible = xrSceneKind === "workshop" && (presenting || workspaceJoin);
      root.userData.xrWorkshopRoom = true;
      indexWorkshopScreens(root);
      configureWorkshopPrinterStation(root);
      configureWorkshopRobotStation(root);
      scene.add(root);
      xrWorkshopProjectRoom = root;
      // Keep the staging root empty. The old generated blue workshop must not
      // appear behind or instead of the user's configured scene asset.
      xrWorkshopRoom = root;
      void syncWorkshopSceneAsset();
      setTimeout(() => applyWorkshopMonitorPins(), 0);
      return root;
    }).catch((err) => {
      xrWorkshopProjectPromise = null;
      console.warn("[viewport-xr] workshop project", err);
      onStatus?.("error", `Workshop could not load: ${err?.message || err}`);
      return null;
    });
    return xrWorkshopProjectPromise;
  }

  function disposeWorkshopRoot(root) {
    root?.traverse?.((obj) => {
      obj.geometry?.dispose?.();
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const material of materials) {
        if (!material) continue;
        for (const value of Object.values(material)) value?.isTexture && value.dispose?.();
        material.dispose?.();
      }
    });
    root?.removeFromParent?.();
  }

  async function syncWorkshopSceneAsset() {
    const assets = workshopConfig?.manifest?.assets || [];
    const asset = assets[assets.length - 1];
    const key = asset ? `${asset.projectId}:${asset.filename}` : "";
    if (!xrWorkshopProjectRoom || !key || key === xrWorkshopAssetKey || typeof fetchWorkshopAsset !== "function") return;
    const requestKey = key;
    const selectedAssetKey = () => {
      const current = workshopConfig?.manifest?.assets || [];
      const selected = current[current.length - 1];
      return selected ? `${selected.projectId}:${selected.filename}` : "";
    };
    try {
      const blob = await fetchWorkshopAsset(asset);
      if (!(blob instanceof Blob) || requestKey !== selectedAssetKey()) return;
      const url = URL.createObjectURL(blob);
      let gltf;
      try { gltf = await xrGltfLoader.loadAsync(url); } finally { URL.revokeObjectURL(url); }
      if (requestKey !== selectedAssetKey()) {
        disposeWorkshopRoot(gltf?.scene);
        return;
      }
      const previous = xrWorkshopProjectRoom;
      const root = gltf.scene;
      root.name = "xrWorkshopProjectRoom";
      root.visible = previous.visible;
      root.userData.xrWorkshopRoom = true;
      const transform = asset.transform || {};
      root.userData.workshopAssetPosition = [...(transform.position || [0, 0, 0])];
      root.userData.workshopAssetRotation = [...(transform.rotation || [0, 0, 0])];
      root.scale.fromArray(transform.scale || [1, 1, 1]).multiplyScalar(Number(asset.metersPerUnit) || 1);
      applyWorkshopAssetOrientation(root);
      workshopColliders = [];
      root.traverse((obj) => {
        if (!obj?.isMesh || obj.userData?.xrNoCollision) return;
        const name = String(obj.name || "").toLowerCase();
        if (/floor|ceiling|screen|monitor|label|light/.test(name)) return;
        const box = new THREE.Box3().setFromObject(obj);
        const size = box.getSize(new THREE.Vector3());
        if (!box.isEmpty() && size.y > 0.35 && size.x > 0.04 && size.z > 0.04) workshopColliders.push(box);
      });
      indexWorkshopScreens(root);
      configureWorkshopPrinterStation(root);
      configureWorkshopRobotStation(root);
      scene.add(root);
      xrWorkshopProjectRoom = root;
      xrWorkshopRoom = root;
      xrWorkshopAssetKey = key;
      disposeWorkshopRoot(previous);
      applyWorkshopMonitorPins();
      if (isCanonicalWorkshopConfig(workshopConfig)) void roboticsWorkspace.ensureViser?.({ forceWorkshopAnchor: true }).catch(() => null);
      onStatus?.("ok", `Walkable Workshop loaded: ${asset.label || asset.filename}`);
    } catch (err) {
      console.warn("[viewport-xr] workshop scene asset", err);
      onStatus?.("error", `Workshop scene could not load: ${err?.message || err}`);
    }
  }

  function workshopScreen(name) {
    return xrWorkshopProjectRoom?.userData?.workshopScreens?.[name] || null;
  }

  function pinPanelToWorkshopScreen(panel, screenName) {
    const group = panel?.group || panel;
    const screen = workshopScreen(screenName);
    if (!group || !screen) return false;
    screen.updateWorldMatrix?.(true, false);
    screen.getWorldPosition(group.position);
    screen.getWorldQuaternion(group.quaternion);
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(group.quaternion);
    group.position.addScaledVector(normal, 0.025);
    group.userData.xrWorkshopScreen = screenName;
    group.userData.xrManagedWindow = true;
    group.updateMatrixWorld?.(true);
    return true;
  }

  function applyWorkshopMonitorPins() {
    if (xrSceneKind !== "workshop" || !xrWorkshopProjectRoom) return false;
    const defaults = {
      robotics: "screen_robotics_controls", tasks: "screen_render_manager",
      editor: "screen_editor_ide", stats: "screen_success_statistics",
      files: "screen_generated_files", training: "screen_training_data",
    };
    const pins = { ...defaults, ...(workshopConfig?.monitors || {}) };
    const refs = { robotics: roboticsPanel, tasks: workspacePanel, editor: xrStudio?.group, stats: debuggerHud, files: explorerPanel, training: aiPanel };
    for (const [feature, screenName] of Object.entries(pins)) pinPanelToWorkshopScreen(refs[feature], screenName);
    return true;
  }

  function pinWorkshopFeature(feature, screenName) {
    const allowed = new Set(Object.keys(WORKSHOP_SCREEN_DEFAULTS));
    if (!allowed.has(screenName)) return { ok: false, error: "Unknown Workshop monitor" };
    workshopConfig ||= { monitors: {} };
    workshopConfig.monitors ||= {};
    workshopConfig.monitors[String(feature || "")] = screenName;
    applyWorkshopMonitorPins();
    return { ok: true, feature, screenName };
  }
  const controllerModelFactory = new XRControllerModelFactory(xrGltfLoader);
  // Same CDN as three.module.js — Quest Browser can fetch Touch GLBs + button meshes.
  controllerModelFactory.setPath(
    "https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles",
  );
  const handModelFactory = new XRHandModelFactory(xrGltfLoader);
  handModelFactory.setPath?.(
    "https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles",
  );

  /**
   * Live teammate avatars (head + controllers from collab xr.pose).
   * Fallback orbit stubs if they are in the project but not in a headset.
   */
  const xrPresence = createXrPresence({
    THREE,
    scene,
    enterSettled: () => xrEnterWorkSettled(),
    avatarFxEnabled: () => false,
  });
  const dropGltfLoader = attachGltfTextureSkip(new GLTFLoader());
  const publicDrops = createXrPublicDrops({
    THREE,
    scene,
    loader: dropGltfLoader,
    getUserId: localSocialUserId,
    onGrabLost: id => {
      if (gripGrab?.target?.userData?.xrDropId === id) gripGrab = null;
      if (grabState?.target?.userData?.xrDropId === id) grabState = null;
      if (scaleGrab?.target?.userData?.xrDropId === id) scaleGrab = null;
      if (oneHandScale?.target?.userData?.xrDropId === id) oneHandScale = null;
    },
    onStatus: (kind, message) => {
      try { onStatus?.(kind, message); } catch { /* ignore */ }
    },
  });
  const roomInventory = createRoomInventory({drops:publicDrops,getPeers:()=>socialUsers().filter(u=>u.fromPublicRoom),
    getUserId:localSocialUserId,isJoined:publicRoomJoined,
    send:(peer,signal)=>sendPublicXr?.({type:'rtc.signal',target_user_id:peer,signal}),sendPose:msg=>sendPublicXr?.(msg),
    isHeld:root=>{const held=gripGrab?.target||grabState?.target||scaleGrab?.target;for(let o=root;o;o=o.parent)if(o===held)return true;return false;}});
  const workspaceWorld = createWorkspaceWorld({ THREE, scene, getProjectId });
  // Workshop/God View rebuild this only after the user explicitly opens one.
  // Keeping it dormant avoids allocating saved room meshes during normal boot.
  let lastDropSendAt = 0;
  let lastInteractedDropId = "";
  const xrVoice = createXrVoice();
  let roomCameraStatus = '';
  const roomCameraView = createRoomCameraView({THREE,scene,getUserId:localSocialUserId,
    getDefaultPose:frontDropPose,
    onPose:(owner,pose)=>roomCamera.setPose(owner,pose),onStop:()=>roomCamera.stop()});
  const roomCamera = createRoomCamera({getPeers:()=>socialUsers().filter(u=>u.fromPublicRoom),getUserId:localSocialUserId,isJoined:publicRoomJoined,
    getToken, getPose:frontDropPose,
    sendSignal:(peer,signal)=>sendPublicXr?.({type:'rtc.signal',target_user_id:peer,signal}),
    onStream:roomCameraView.setStream,onPose:roomCameraView.setPose,
    onStatus:(kind,text)=>{roomCameraStatus=text;onStatus?.(kind,text);menuFooterHint=text;paintRoboticsPanel();}});

  function primeAstraTalkMedia() {
    // The central voice starter reuses xrVoice.getMicStream(), or requests one microphone.
    try { void xrVoice.resumeAudio?.(); } catch { /* headset speakers */ }
  }
  async function beginAstraTalk({ toggle = false, text = "" } = {}) {
    primeAstraTalkMedia();
    const stream = xrVoice.getMicStream?.() || null;
    const host = typeof window !== "undefined" ? window.__activateStudioVoiceAgent : null;
    const agent = typeof window !== "undefined" ? window.Render3DXrAgent : null;
    let result;
    if (typeof host === "function") {
      result = await host({ source: "order", toggle, greet: true, text, stream });
    } else if (typeof agent?.action === "function") {
      result = await agent.action(toggle ? "agent:toggle" : "agent:talk", { greet: true, text, stream });
      const state = agent.getState?.() || {};
      result = result && typeof result === "object" ? result : { ok: state.live === true || state.connecting === true || toggle, live: state.live === true, connecting: state.connecting === true };
    } else {
      return { ok: false, live: false, error: "Astra voice is not ready. Reopen Studio and try Talk again." };
    }
    if (!result || typeof result !== "object") return { ok: false, live: false, error: "Astra voice is not ready. Try Talk again." };
    if (result.ok === false) return { ...result, live: false, connecting: false, error: result.error || "Astra could not connect. Try Talk again." };
    if (!result.live && !result.connecting && !toggle) return { ok: false, live: false, error: result.error || "Astra is not connected. Try Talk again." };
    try { agentAvatar.spawn?.(); } catch { /* avatar after init */ }
    if (result.live || result.connecting) {
      voiceMoldLive = true;
    startTalkControlFeed();
    startTableVoiceMoveWatch();
  }
    return { ...result, live: result.live === true, connecting: result.connecting === true };
  }
  const agentState = () => window.Render3DXrAgent?.getState?.() || {};
  const agentAvatar = createXrAgentAvatar(THREE, { scene, camera, getState:agentState,
    onAction:(id,payload)=>{
      if (id === "agent:round-table") { try { toggleAiRoundTable(); } catch { /* table not ready */ } return; }
      Promise.resolve(window.Render3DXrAgent?.action?.(id,payload)).catch(error=>onStatus?.("error",error.message));
    } });
  const agentPeers = createXrAgentPeers(THREE, {scene,getState:agentState});
  const agentJoin = createXrAgentJoin(THREE, {
    scene,
    getHeadPose: () => {
      getHeadPose();
      const forward = headForwardFlat(new THREE.Vector3());
      return {
        position: [_headPos.x, _headPos.y, _headPos.z],
        forward: { x: forward.x, y: forward.y, z: forward.z },
        yaw: Math.atan2(forward.x, forward.z),
      };
    },
    getPeers: () => socialUsers(),
    getUserId: localSocialUserId,
    send: (peer, signal) => {
      const payload = { type: "rtc.signal", target_user_id: peer, signal };
      try { sendPublicXr?.(payload); } catch { /* ignore */ }
      try { sendCollab?.(payload); } catch { /* ignore */ }
    },
    voiceAgent: () => (typeof window !== "undefined" ? window.Render3DXrAgent : null),
    startVoice: (opts) => beginAstraTalk({ toggle: false, text: opts?.text || "" }),
  });
  const xrWiringView = createXrWiringView(THREE, {scene,camera});
  const wiringHiddenCad = new Map();
  function syncWiringCadVisibility(active) {
    if (active) { const mesh=getLiveMesh(); if(mesh) { if(!wiringHiddenCad.has(mesh))wiringHiddenCad.set(mesh,mesh.visible); mesh.visible=false; } }
    else { for(const [mesh,visible] of wiringHiddenCad)mesh.visible=visible; wiringHiddenCad.clear(); }
  }

  xrVoice.setGpuBusy?.(() => {
    try {
      const mesh = getLiveMesh();
      if (!mesh || mesh.userData?._xrUnhideDone) return false;
      return xrCadUnhideInProgress(mesh.userData?._xrUnhide)
        || Number(mesh.userData?._xrUnhide?.revealedThisFrame || 0) > 0;
    } catch {
      return false;
    }
  });
  const voiceDraw = createXrVoiceDraw({ THREE, scene });
  const xrBoard = createXrBoard({ THREE, scene });
  let roomFloorJoined = false;
  let pendingRoomFloorSeat = null;
  let roomStickAt = 0;
  let roomTurnLatched = false;
  let roomWalkHeld = false;
  const roomHeadEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const drawHud = createXrDrawHud({ THREE });
  // Board previews share the existing scene and its combined CAD budget.
  const aiDrawWorkspace = createXrAiDrawWorkspace({ THREE, scene, camera, getProjectId, getToken,
    gridGeometry: xrBoard.group.children.find(object => object.type === "GridHelper")?.geometry,
    getAssets: () => getDrawBoardAssets?.() || [...(getProjectFiles?.() || []), ...(getReferenceFiles?.() || [])],
    getModel: filename => getDrawBoardModel?.(filename) || null,
    getPromptDraft, onSetPromptDraft, api: drawBoardApi,
    onOrganize: onOrganizeDrawBoard, onGenerate: onGenerateDrawBoard, onGenerateImage: onGenerateDrawImage,
    onTalk: () => beginAstraTalk({ toggle: false }),
    onContextChange: () => { window.Render3DXrAgent?.refreshDrawContext?.(); onDrawBoardChange?.(aiDrawWorkspace.board.getState()); },
    onStatus: text => { menuFooterHint = text; },
    blocked: () => isDimosTeleopArmed(),
    getBudget: () => {
      const mesh = getLiveMesh(); let triangles = 0, meshes = 0;
      if (mesh?.userData?._xrUnhide && !mesh.userData._xrUnhideDone) return { triangles: 0, meshes: 0 };
      mesh?.traverseVisible?.(object => {
        if (!object.isMesh || !object.geometry || (object.layers && !(object.layers.mask & 1))) return;
        const count = object.geometry.index?.count || object.geometry.attributes?.position?.count || 0;
        triangles += Math.ceil(count / 3); meshes += Array.isArray(object.material) ? object.material.length : 1;
      });
      return { triangles: Math.max(0, XR_CAD_DRAW_MAX_TRIS - triangles), meshes: Math.max(0, XR_CAD_DRAW_MAX_PARTS - meshes) };
    },
  });
  const slicerPreview = createXrSlicerPlatePreview({ THREE, scene, camera });
  let slicerLayoutBusy = false;

  const aiRoundTable = createXrAiRoundTable(THREE, {
    scene,
    onAction: (kind, payload) => { void roundTableCommand(kind, payload); },
  });
  const sandboxShapes = bindSandboxShapeVisibility(createSandboxViewportShapes(THREE, scene));
  let tablePassTimer = 0;
  let tablePassBusy = false;
  let tablePassSig = "";
  const xrLiveClient = createXrLiveControlClient({
    applyDoc: (doc) => {
      try { applyXrLiveControlDoc(doc); } catch { /* overlay optional */ }
    },
  });
  try {
    window.Render3DXrControls = {
      applyLive: applyXrLiveControlDoc,
      getSession: () => renderer.xr.getSession?.() || null,
      getActiveTool: () => activeTool,
      token: XRCTRL2_CACHE,
      start: () => xrLiveClient.start(),
      simulate: (on) => xrLiveClient.patch({ simulate: !!on, listen: !!on }),
    };
    window.addEventListener(XR_LIVE_SAVE_EVENT, (ev) => {
      const d = ev?.detail || {};
      void xrLiveClient.patch({
        headset: d.headset,
        profiles: d.profiles,
        simulate: d.simulate,
        listen: d.listen,
      });
    });
  } catch { /* tests */ }

  function slicerFilename() {
    try {
      const named = typeof getSelectedFile === "function" ? getSelectedFile() : "";
      if (named && named !== "none") return String(named);
    } catch { /* ignore */ }
    const mesh = getLiveMesh();
    return String(mesh?.userData?.catalogFilename || mesh?.userData?.filename || "") || "";
  }

  function slicerAuthHeaders() {
    const tok = typeof getToken === "function" ? String(getToken() || "") : "";
    return { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) };
  }

  function drawSelectedSlicerIds(layout) {
    try {
      const ctx = aiDrawWorkspace.getVoiceContext?.() || {};
      const regions = ctx.regions || [];
      const selected = new Set(ctx.selectedIds || []);
      const lassos = regions.filter((r) => r.kind === "lasso" && (selected.has(r.id) || selected.size === 0));
      const ids = [];
      for (const region of lassos) {
        const circle = lassoToCircle(region.points || region.worldPoints || []);
        if (circle) ids.push(...partsInCircle(layout?.parts || [], circle, layout?.plates || []));
      }
      return [...new Set(ids)];
    } catch {
      return [];
    }
  }

  async function postSlicerLayout(body) {
    const pid = typeof getProjectId === "function" ? String(getProjectId() || "") : "";
    const file = slicerFilename();
    if (!pid || pid === "none" || !file) return { ok: false, error: "Open a project model first." };
    const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/files/${encodeSlicerFilePath(file)}/slicer-layout`, {
      method: "POST",
      headers: slicerAuthHeaders(),
      body: JSON.stringify(body || {}),
    });
    let data = {};
    try { data = await res.json(); } catch { data = {}; }
    if (!res.ok) return { ok: false, error: data.detail || res.statusText || "slicer layout failed" };
    if (data.layout) slicerPreview.setLayout(data.layout);
    return data;
  }

  async function openSlicerPlatePreview() {
    const pid = typeof getProjectId === "function" ? String(getProjectId() || "") : "";
    const file = slicerFilename();
    menuFooterHint = "Loading Bambu plate preview…";
    if (!pid || pid === "none" || !file) {
      menuFooterHint = "Open a CAD model before Export to slicer.";
      return { ok: false, error: menuFooterHint };
    }
    if (slicerLayoutBusy) return slicerPreview.getLayout() ? { ok: true, layout: slicerPreview.getLayout() } : { ok: false, error: "busy" };
    slicerLayoutBusy = true;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/files/${encodeSlicerFilePath(file)}/slicer-layout`, {
        headers: slicerAuthHeaders(),
      });
      let data = {};
      try { data = await res.json(); } catch { data = {}; }
      if (!res.ok) {
        menuFooterHint = String(data.detail || "Could not load plate layout");
        return { ok: false, error: menuFooterHint };
      }
      slicerPreview.setLayout(data);
      menuFooterHint = `Plate preview · ${(data.plates || []).length} plate(s) · grab parts · talk to Astra (${BAMBU1_CACHE})`;
      return { ok: true, layout: data, token: BAMBU1_CACHE };
    } catch (err) {
      menuFooterHint = err?.message || "Plate preview failed";
      return { ok: false, error: menuFooterHint };
    } finally {
      slicerLayoutBusy = false;
    }
  }

  async function slicerPlateCommand(args = {}) {
    const layout = slicerPreview.getLayout() || (await openSlicerPlatePreview()).layout;
    if (!layout) return { ok: false, error: "Open Export to slicer in VR first." };
    const pointed = slicerPreview.getLayout()?.pointed_ids || [];
    const drawn = drawSelectedSlicerIds(layout);
    const parsed = parsePlateUtterance(args.text || args.description || "");
    const body = {
      ...args,
      action: args.action || parsed.action || "reorient",
      plate_id: args.plate_id || parsed.plate_id,
      orientation: args.orientation || parsed.orientation || "flat",
      pointed_ids: args.pointed_ids || pointed,
      draw_selected_ids: args.draw_selected_ids || drawn,
      ping_group: args.ping_group || args.action === "ping_group" || args.action === "confirm_oriented",
    };
    const result = await postSlicerLayout(body);
    if (result.ok !== false) {
      menuFooterHint = result.harness?.how || result.log?.name
        ? `Logged ${result.log?.name || "plate"} · ${result.harness ? "ceded to harness" : "Astra plate"}`
        : `Plate ${body.plate_id || ""} updated`;
    } else {
      menuFooterHint = result.error || "Plate command failed";
    }
    return result;
  }

  let talkFeedTimer = 0;
  let talkFeedBusy = false;

  function talkOverlayHit() {
    const kind = String(lastPointerHoverHit?.kind || lastXrControlEv || "");
    return kind.slice(0, 16);
  }

  function compactTalkFeed() {
    const snap = xrDevStats.snapshot?.({
      presenting,
      laser: laserPointerActive(),
      framebufferScale: XR_FRAMEBUFFER_SCALE,
      foveation: XR_FOVEATION,
      hudScale: XR_HUD_CANVAS_SCALE,
    }) || {};
    return compactTalkControlsFeed({
      controls: snap.controls,
      overlayHit: talkOverlayHit(),
      dimosArmed: isDimosTeleopArmed(),
      astraTalk: !!voiceMoldLive,
      triggerAllowed: studioRoboticsInputAllowed({
        armed: isDimosTeleopArmed(),
        control: "trigger",
        uiHit: false,
        astraTalk: !!voiceMoldLive,
      }),
    });
  }

  async function feedTalkControlDebugger({ pingGroup = true, description = "" } = {}) {
    if (talkFeedBusy || !onXrDebugLog) return { ok: false, error: "debugger unavailable" };
    talkFeedBusy = true;
    try {
      const feed = compactTalkFeed();
      const iso = new Date().toISOString().replace(/[-:TZ.]/g, "");
      const payload = {
        v: 1,
        kind: "bambu-plate",
        auto: false,
        manual: true,
        filename: `${iso.slice(0, 8)}-${iso.slice(8, 12)}-bambu-plate.jsonl`,
        description: String(description || "VR trigger/DimOS talk feed (xrctrl1)").slice(0, 160),
        actions: [{ t: 0, tool: "xr-ctl-talk" }],
        extra: { ...feed, last3: ROUND_TABLE_LAST3, table: !!aiRoundTable?.isVisible?.() },
      };
      const log = await onXrDebugLog(payload);
      try {
        void xrLiveClient.addNote({
          feature: feed.allowTr ? "trigger" : "trigger",
          ok: !!feed.allowTr,
          attempt: feed.ov ? "dimos-overlay" : "talk-feed",
          note: `allowTr=${feed.allowTr} dimos=${feed.dimos} ov=${feed.ov}`,
          source: "xr-ctl-talk",
          agent: "astra",
        });
      } catch { /* notes optional */ }
      let group = null;
      if (pingGroup) {
        try {
          const res = await fetch("/api/xr/slicer-ping", {
            method: "POST",
            headers: slicerAuthHeaders(),
            body: JSON.stringify({
              agent: "astra",
              text: `Astra · xrctrl1 talk feed · trigger allow=${feed.allowTr} dimos=${feed.dimos} ov=${feed.ov} log=${log?.name || ""} last3 ${ROUND_TABLE_LAST3}`,
            }),
          });
          group = await res.json();
        } catch { group = null; }
      }
      return { ok: true, feed, log, group, token: XRCTRL1_CACHE };
    } catch (err) {
      return { ok: false, error: err?.message || "talk feed failed" };
    } finally {
      talkFeedBusy = false;
    }
  }

  function startTalkControlFeed() {
    if (talkFeedTimer) return;
    void feedTalkControlDebugger({ pingGroup: true, description: "Astra live — first trigger/DimOS feed" });
    talkFeedTimer = setInterval(() => {
      if (!voiceMoldLive) {
        clearInterval(talkFeedTimer);
        talkFeedTimer = 0;
        return;
      }
      void feedTalkControlDebugger({ pingGroup: false, description: "Astra talk control ring" });
    }, 12000);
    startTableLogPass();
    startTableVoiceMoveWatch();
  }

  function liveTableSources() {
    const mold = (typeof window !== "undefined" && window.Render3DVoiceMold?.getState?.()) || {};
    const agent = (typeof window !== "undefined" && window.Render3DXrAgent?.getState?.()) || {};
    let draft = "";
    try { draft = String(getPromptDraft?.() || readAiState()?.draft || ""); } catch { draft = ""; }
    const voice = String(
      mold.lastTranscript || aiPanel?.talkStatus || draft || "",
    ).slice(0, 400);
    const chat = collectAiChatLines({
      mold,
      agentHistory: agent.history || [],
      draft,
      tableChat: aiRoundTable.chatLines?.() || [],
    });
    const spoken = `${voice} ${draft}`;
    if (isMoveTableVoice(spoken) && spoken !== lastMoveTableVoice) {
      lastMoveTableVoice = spoken;
      try { moveRoundTableToLaser(); } catch { /* laser optional */ }
    }
    if (isTooMuchTalkVoice(spoken) && spoken !== lastTooMuchVoice) {
      lastTooMuchVoice = spoken;
      try { aiRoundTable.tooMuchTalk?.(spoken) || applyTooMuchTalk(spoken); } catch { /* turn-taking */ }
    }
    if (isSamCorrectionVoice(spoken) && spoken !== lastSamCorrectVoice) {
      lastSamCorrectVoice = spoken;
      try { aiRoundTable.samCorrect?.(spoken) || applySamSandboxCorrection(spoken); } catch { /* sam correct */ }
    }
    if (isSamSuggestionVoice(spoken) && spoken !== lastSamSuggestVoice) {
      lastSamSuggestVoice = spoken;
      try { aiRoundTable.samSuggest?.(spoken) || applySamSuggestion(spoken); } catch { /* sam suggestion */ }
    }
    if (isEnableSandboxVoice(spoken) && spoken !== lastSandboxVoice) {
      lastSandboxVoice = spoken;
      try {
        const out = enableSandboxFromVoice();
        syncTopPromptSlot({ tableOn: !!aiRoundTable?.isVisible?.(), sandboxOn: !!out.visible });
        refreshAiPromptPanel();
      } catch { /* sandbox optional */ }
    }
    if ((isVoiceExampleVoice(spoken) || isVoiceSwapVoice(spoken)) && spoken !== lastVoiceExample && spoken !== lastVoiceSwap) {
      if (isVoiceSwapVoice(spoken)) lastVoiceSwap = spoken;
      else lastVoiceExample = spoken;
      try { void applyVoiceCommand(spoken); } catch { /* voice1 */ }
    }
    return mergeVoiceChatDebugPacket({
      voice,
      chat,
      draft,
      feed: compactTalkFeed(),
      last3: ROUND_TABLE_LAST3,
    });
  }

  async function passLiveTableLogs({ force = false } = {}) {
    if (tablePassBusy || !aiRoundTable.isVisible()) return { ok: false, skipped: "hidden" };
    const talking = !!voiceMoldLive || !!aiRoundTable.listening() || !!aiPanel?.talking;
    const packet = liveTableSources();
    const sig = `${packet.voice}|${packet.draft}|${packet.merged}`;
    const changed = sig !== tablePassSig;
    if (!shouldPassLiveLogs({
      tableVisible: true,
      listening: !!aiRoundTable.listening(),
      talking,
      newVoice: changed && !!packet.voice,
      newChat: changed && packet.chat.length > 0,
    }) && !force) {
      return { ok: false, skipped: "unchanged" };
    }
    tablePassSig = sig;
    tablePassBusy = true;
    try {
      for (const row of packet.chat.slice(-4)) {
        aiRoundTable.pushChat({ agent_id: row.who, agent_name: row.who, text: row.text });
      }
      if (packet.voice) aiRoundTable.setCallout("astra", packet.voice);
      const extra = { ...packet, wait_for_end: false };
      let log = null;
      if (onXrDebugLog) {
        const iso = new Date().toISOString().replace(/[-:TZ.]/g, "");
        log = await onXrDebugLog({
          v: 1,
          kind: "round-table",
          auto: false,
          manual: true,
          filename: `${iso.slice(0, 8)}-${iso.slice(8, 12)}-round-table.jsonl`,
          description: String(packet.voice || packet.draft || "VR+AI chat live pass").slice(0, 160),
          actions: [{ t: 0, tool: "round-table-pass" }],
          extra,
        });
      }
      let remote = null;
      try {
        const res = await fetch("/api/xr/round-table", {
          method: "POST",
          headers: slicerAuthHeaders(),
          body: JSON.stringify({
            action: "pass_logs",
            voice: packet.voice,
            draft: packet.draft,
            chat: packet.chat,
            wait_for_end: false,
          }),
        });
        remote = await res.json();
      } catch { remote = null; }
      return { ok: true, log, remote, packet, request_id: ROUND_TABLE_REQUEST_ID, token: ROUNDTBL1_CACHE };
    } finally {
      tablePassBusy = false;
    }
  }

  function startTableLogPass() {
    if (tablePassTimer) return;
    void passLiveTableLogs({ force: true });
    tablePassTimer = setInterval(() => {
      if (!aiRoundTable.isVisible() || !(voiceMoldLive || aiRoundTable.listening() || aiPanel?.talking)) {
        clearInterval(tablePassTimer);
        tablePassTimer = 0;
        return;
      }
      void passLiveTableLogs();
    }, 2500);
    startTableVoiceMoveWatch();
  }

  function rememberTableLaser(hit, aim) {
    try {
      const origin = { x: 0, y: 1.4, z: 0 };
      const direction = { x: 0, y: 0, z: -1 };
      if (aim?.matrixWorld) {
        aim.updateMatrixWorld?.(true);
        const e = aim.matrixWorld.elements;
        origin.x = e[12];
        origin.y = e[13];
        origin.z = e[14];
        direction.x = -e[8];
        direction.y = -e[9];
        direction.z = -e[10];
        const len = Math.hypot(direction.x, direction.y, direction.z) || 1;
        direction.x /= len;
        direction.y /= len;
        direction.z /= len;
      }
      const pt = hit?.point;
      lastTableLaser = {
        point: pt && Number.isFinite(pt.x) ? { x: pt.x, y: pt.y, z: pt.z, kind: String(hit.kind || "") } : null,
        kind: String(hit?.kind || ""),
        origin,
        direction,
        at: performance.now(),
      };
    } catch { /* keep last aim */ }
  }

  function moveRoundTableToLaser(payload = {}) {
    getHeadPose();
    const floorY = Math.max(-0.05, _headPos.y - 1.55);
    const hit = payload?.point || payload?.hit || lastTableLaser.point;
    const pose = laserTablePose({
      hit,
      origin: payload?.origin || lastTableLaser.origin,
      direction: payload?.direction || lastTableLaser.direction,
      head: _headPos,
      floorY,
    });
    if (!pose) return { ok: false, error: "point the laser first", token: ROUNDTBL2_CACHE };
    aiRoundTable.setVisible(true);
    const placed = aiRoundTable.placeAt(pose.x, pose.y, pose.z);
    startTableLogPass();
    startTableVoiceMoveWatch();
    try { refreshAiPromptPanel(); } catch { /* optional */ }
    return { ok: true, ...placed, pose, token: ROUNDTBL2_CACHE };
  }

  function startTableVoiceMoveWatch() {
    if (tableMoveWatch) return;
    tableMoveWatch = setInterval(() => {
      if (!voiceMoldLive && !aiRoundTable.listening() && !aiPanel?.talking) {
        clearInterval(tableMoveWatch);
        tableMoveWatch = 0;
        return;
      }
      try {
        const mold = (typeof window !== "undefined" && window.Render3DVoiceMold?.getState?.()) || {};
        const voice = String(mold.lastTranscript || "");
        if (isMoveTableVoice(voice) && voice !== lastMoveTableVoice) {
          lastMoveTableVoice = voice;
          moveRoundTableToLaser();
        }
        if (isTooMuchTalkVoice(voice) && voice !== lastTooMuchVoice) {
          lastTooMuchVoice = voice;
          aiRoundTable.tooMuchTalk?.(voice) || applyTooMuchTalk(voice);
        }
        if (isEnableSandboxVoice(voice) && voice !== lastSandboxVoice) {
          lastSandboxVoice = voice;
          const out = enableSandboxFromVoice();
          syncTopPromptSlot({ tableOn: !!aiRoundTable?.isVisible?.(), sandboxOn: !!out.visible });
          try { refreshAiPromptPanel(); } catch { /* */ }
        }
        if ((isVoiceExampleVoice(voice) || isVoiceSwapVoice(voice)) && voice !== lastVoiceExample && voice !== lastVoiceSwap) {
          if (isVoiceSwapVoice(voice)) lastVoiceSwap = voice;
          else lastVoiceExample = voice;
          void applyVoiceCommand(voice);
        }
        if (isSamCorrectionVoice(voice) && voice !== lastSamCorrectVoice) {
          lastSamCorrectVoice = voice;
          aiRoundTable.samCorrect?.(voice) || applySamSandboxCorrection(voice);
        }
        if (isSamSuggestionVoice(voice) && voice !== lastSamSuggestVoice) {
          lastSamSuggestVoice = voice;
          aiRoundTable.samSuggest?.(voice) || applySamSuggestion(voice);
        }
      } catch { /* transcript optional */ }
    }, 350);
  }

  function toggleAiRoundTable() {
    getHeadPose();
    const next = aiRoundTable.toggle();
    if (next.visible) {
      aiRoundTable.placeInFront(_headPos, headForwardFlat());
      startTableLogPass();
    }
    try {
      document.querySelectorAll("[data-round-table-toggle], #btn-round-table").forEach((btn) => {
        btn.setAttribute("aria-pressed", next.visible ? "true" : "false");
        btn.classList.toggle("is-active", next.visible);
      });
    } catch { /* desktop button optional */ }
    try {
      const sandboxOn = typeof window !== "undefined" && window.Render3DSandbox?.isOpen?.() === true;
      syncTopPromptSlot({ tableOn: next.visible, sandboxOn });
    } catch { /* desktop slot optional */ }
    try { refreshAiPromptPanel(); } catch { /* panel may be closed */ }
    return next;
  }

  async function roundTableCommand(kind, payload) {
    const action = String(kind || payload?.action || "");
    if (action === "toggle" || action === "round_table") return toggleAiRoundTable();
    if (action === "move" || action === "move_here" || action === "place" || action === "move_round_table") {
      return moveRoundTableToLaser(payload);
    }
    if (action === "too_much" || action === "take_turns" || action === "quiet") {
      return aiRoundTable.tooMuchTalk?.(payload?.text || action) || applyTooMuchTalk(action);
    }
    if (action === "enable_sandbox" || action === "toggle_sandbox") {
      const out = action === "toggle_sandbox" ? toggleSandboxFromSlot() : enableSandboxFromVoice();
      syncTopPromptSlot({ tableOn: !!aiRoundTable?.isVisible?.(), sandboxOn: !!out.visible });
      try { refreshAiPromptPanel(); } catch { /* */ }
      return out;
    }
    if (action === "voice_examples") {
      const text = String(payload?.text || payload?.phrase || "");
      return applyVoiceCommand(text || "sample other voices");
    }
    if (action === "listen") {
      aiRoundTable.setListening(true);
      aiRoundTable.setVisible(true);
      const talk = await beginAstraTalk({ toggle: false, text: "Round table listening. Agents follow the AI chat." });
      const topic = String(getPromptDraft?.() || payload?.text || "headset issue");
      const loop = ideaTossLoop(topic, { rounds: 2 });
      for (const turn of loop.turns) aiRoundTable.pushChat(turn);
      const brief = aiRoundTable.speakDecision?.(topic, "debug");
      try {
        await fetch("/mcp/sandbox/decision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic, kind: "debug", post: true }),
        });
      } catch { /* team chat optional */ }
      startTableLogPass();
      try {
        const res = await fetch("/api/xr/round-table", {
          method: "POST",
          headers: slicerAuthHeaders(),
          body: JSON.stringify({ action: "listen", topic, rounds: 2 }),
        });
        const data = await res.json();
        return { ok: true, talk, loop, brief, remote: data, token: ROUNDTBL1_CACHE };
      } catch (err) {
        return { ok: true, talk, loop, error: err?.message || "listen ping failed", token: ROUNDTBL1_CACHE };
      }
    }
    if (action === "seat") {
      const id = String(payload || "");
      aiRoundTable.setFocused(id);
      aiRoundTable.approach?.(id, _headPos);
      try {
        await fetch("/mcp/sandbox/voice", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent: id, approach: true }),
        });
      } catch { /* voice select optional */ }
      try { await agentJoin.talkTo?.(id); } catch { /* stub ok */ }
      return { ok: true, seat: id, approach: true };
    }
    if (action === "decide" || action === "decision") {
      const topic = String(payload?.topic || payload || getPromptDraft?.() || "sandbox decision");
      const kind = String(payload?.kind || "debug");
      const brief = aiRoundTable.speakDecision?.(topic, kind);
      try {
        await fetch("/mcp/sandbox/decision", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic, kind, post: true }),
        });
      } catch { /* team chat optional */ }
      return { ok: true, brief, token: "sandbox4" };
    }
    if (action === "chat" || action === "editor" || action === "slides" || action === "bench" || action === "tasks") {
      if (action === "bench") {
        aiRoundTable.setSurfaceMode("bench");
        return aiRoundTable.startVoiceBench?.() || { ok: true, mode: "bench", token: "rnddemo1" };
      }
      return aiRoundTable.setSurfaceMode(action);
    }
    if (action === "slide-point") {
      return aiRoundTable.pointAtSlide?.(payload?.uv || payload);
    }
    if (action === "cede") {
      const draft = payload || aiRoundTable.markHarnessQueued();
      try {
        const res = await fetch("/api/xr/round-table", {
          method: "POST",
          headers: slicerAuthHeaders(),
          body: JSON.stringify({ ...draft, action: "cede_harness" }),
        });
        return await res.json();
      } catch (err) {
        return { ok: false, applied: false, error: err?.message || "cede failed" };
      }
    }
    if (action === "fix_wheels" || action === "fix-wheels") {
      try { window.dispatchEvent(new CustomEvent("render-studio:fix-wheels", { detail: payload || {} })); } catch { /* studio optional */ }
      try {
        const res = await fetch("/api/xr/round-table", {
          method: "POST",
          headers: slicerAuthHeaders(),
          body: JSON.stringify({ action: "fix_wheels", auto_apply: false, ...(payload && typeof payload === "object" ? payload : {}) }),
        });
        const data = await res.json();
        aiRoundTable.pushChat({ agent_id: "astra", agent_name: "Astra", text: String(data?.prompt || "Fix wheels").slice(0, 160) });
        aiRoundTable.pushChat({ agent_id: "clip-bot", agent_name: "Clip-bot", text: "QC after generate. Token rigqc1. No dummy spheres." });
        return data;
      } catch (err) {
        return { ok: false, error: err?.message || "fix wheels failed", token: "rigqc1" };
      }
    }
    if (action === "qc_rig" || action === "qc-rig") {
      try { window.dispatchEvent(new CustomEvent("render-studio:qc-rig", { detail: payload || {} })); } catch { /* studio optional */ }
      try {
        const res = await fetch("/api/xr/round-table", {
          method: "POST",
          headers: slicerAuthHeaders(),
          body: JSON.stringify({ action: "qc_rig", auto_apply: false, ...(payload && typeof payload === "object" ? payload : {}) }),
        });
        const data = await res.json();
        const line = `${data?.pass ? "PASS" : "FAIL"} ${(data?.notes || []).slice(0, 2).join("; ")}`.slice(0, 160);
        aiRoundTable.pushChat({ agent_id: "clip-bot", agent_name: "Clip-bot", text: line });
        return data;
      } catch (err) {
        return { ok: false, error: err?.message || "qc failed", token: "rigqc1" };
      }
    }
    if (action === "debugger" || action === "debug") {
      aiRoundTable.setSurfaceMode("debug");
      try {
        const res = await fetch("/api/xr/round-table", {
          method: "POST",
          headers: slicerAuthHeaders(),
          body: JSON.stringify({ action: "debugger", topic: String(getPromptDraft?.() || payload?.text || "VR controls") }),
        });
        const data = await res.json();
        const rows = data.suggestions || debuggerFixSuggestions(data.notes || []);
        aiRoundTable.setSuggestions(rows.map((row) => ({
          agent_id: row.agent || row.agent_id,
          agent_name: row.agent || row.agent_name || "seat",
          text: row.text,
          keep: row.keep,
          feature: row.feature,
        })));
        for (const row of rows.slice(0, 6)) {
          aiRoundTable.pushChat({
            agent_id: row.agent || row.agent_id || "astra",
            agent_name: row.agent || row.agent_name || "Astra",
            text: row.text,
          });
        }
        return { ok: true, ...data, applied: false, token: XRCTRL2_CACHE };
      } catch (err) {
        const rows = debuggerFixSuggestions([]);
        aiRoundTable.setSuggestions(rows);
        return { ok: true, local: true, suggestions: rows, error: err?.message, token: XRCTRL2_CACHE };
      }
    }
    if (action === "wire" || action === "wire_scene") {
      const draft = payload || aiRoundTable.markWireQueued();
      try {
        const res = await fetch("/api/xr/round-table", {
          method: "POST",
          headers: slicerAuthHeaders(),
          body: JSON.stringify({ ...draft, action: "wire_scene", note: "Wire this to my scene" }),
        });
        return await res.json();
      } catch (err) {
        return { ok: false, applied: false, status: "pending_approval", error: err?.message || "wire queue failed", token: XRCTRL2_CACHE };
      }
    }
    return { ok: false, error: "unknown table action" };
  }

  try { bindRoundTablePromptButtons(() => toggleAiRoundTable()); } catch { /* desktop */ }
  try { void hydrateVoiceSelect(); } catch { /* voice1 persist optional */ }
  try {
    window.addEventListener("render3d-sandbox-toggle", () => {
      try {
        syncTopPromptSlot({
          tableOn: !!aiRoundTable?.isVisible?.(),
          sandboxOn: window.Render3DSandbox?.isOpen?.() === true,
        });
        refreshAiPromptPanel();
      } catch { /* slot paint optional */ }
    });
  } catch { /* desktop */ }

  let desktopDrawBound = false;
  let desktopDrawPointerId = null;
  let lastSocialPresenceSync = 0;
  let lastPoseSendAt = 0;
  let lastPoseSig = "";
  let lastPoseBroadcastAt = 0;
  let lastGhostMeshId = "";
  let lastVoicePeerKey = "";
  let voiceStarting = false;
  let voiceEnterRetryUntil = 0;
  let voicePrefs = readVoicePrefs();
  let voiceWanted = voicePrefs.wanted;

  function voiceStorage() {
    try { return localStorage; } catch { return null; }
  }

  function readVoicePrefs() {
    return readXrVoicePrefs(voiceStorage());
  }

  function writeVoicePrefs(patch = {}) {
    voicePrefs = writeXrVoicePrefs(voiceStorage(), { ...voicePrefs, ...patch });
    return voicePrefs;
  }

  function round3(n) {
    return Math.round(Number(n) * 1000) / 1000;
  }

  function packWorldPose(obj) {
    if (!obj) return null;
    try {
      obj.updateMatrixWorld?.(true);
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      obj.getWorldPosition(p);
      obj.getWorldQuaternion(q);
      if (!Number.isFinite(p.x)) return null;
      return {
        p: [round3(p.x), round3(p.y), round3(p.z)],
        q: [round3(q.x), round3(q.y), round3(q.z), round3(q.w)],
      };
    } catch {
      return null;
    }
  }

  function socialUsers() {
    try {
      const state = (typeof getSocialState === "function" && getSocialState()) || {};
      return Array.isArray(state.users) ? state.users : [];
    } catch {
      return [];
    }
  }

  function localSocialUserId() {
    try {
      return String((typeof getLocalUserId === "function" && getLocalUserId()) || "").trim();
    } catch {
      return "";
    }
  }

  /** Live headset teammates only — no dock-orbit stubs, no self ghost. */
  function socialUsersForAvatars() {
    const me = localSocialUserId();
    return socialUsers().filter((u) => {
      const id = String(u?.id || "");
      if (!id) return false;
      if (me && id === me) return false;
      return !!(u.xrPose || u.inXr);
    });
  }

  function syncSocialPresenceMarkers() {
    if (!presenting) return;
    if (!xrEnterWorkSettled()) return;
    getHeadPose();
    xrPresence.syncUsers(socialUsersForAvatars());
    lastSocialPresenceSync = performance.now();
    if (voiceWanted && xrVoice.isEnabled?.()) {
      try {
        xrVoice.syncPeers(socialUsers().map((u) => u.id).filter(Boolean));
      } catch (_) {}
    }
    if (explorerPanel?.group?.visible && menuTab === "social" && (socialPane === "room" || socialPane === "hub")) {
      const state = readSocialState();
      const users = Array.isArray(state.users) ? state.users : [];
      const key = `${!!state.publicJoined}:${users.map((u) => u.id).join(",")}`;
      if (key !== lastSocialRosterKey) {
        lastSocialRosterKey = key;
        openMenuConsole({ tab: "social", keepPose: true });
      }
    }
  }

  function socialDeviceFor(u) {
    if (u?.isSelf) {
      return deviceLabelFromUser({
        xr_device: localXrDevice || u?.xr_device,
        xr_mode: localXrMode || u?.xr_mode,
        inXr: presenting,
      });
    }
    return deviceLabelFromUser(u);
  }

  function sendLocalXrPose() {
    if (!presenting && !workspaceJoin) return;
    const now = performance.now();
    if (!shouldSendXrPose(now - lastPoseSendAt, XR_POSE_MIN_MS)) return;
    lastPoseSendAt = now;
    getHeadPose();
    const leftGrip = (typeof getLeftGrip === "function" && getLeftGrip()) || grips[0] || controllers[0];
    const rightGrip = (typeof getRightGrip === "function" && getRightGrip()) || grips[1] || controllers[1];
    const left = packWorldPose(leftGrip) || packWorldPose(controllers[0]);
    const right = packWorldPose(rightGrip) || packWorldPose(controllers[1]);
    let held = null;
    const grabbingNow = !!(gripGrab || scaleGrab || grabState || squeezeHeld[0] || squeezeHeld[1]);
    try {
      if (shouldIncludeHeldPose(grabbingNow)) {
        const mesh = activeGrabMesh();
        if (mesh) {
          mesh.updateMatrixWorld(true);
          mesh.matrixWorld.decompose(_v, _q, _s);
          const drawId = mesh.userData?.xrDrawId || "";
          held = {
            p: [round3(_v.x), round3(_v.y), round3(_v.z)],
            q: [round3(_q.x), round3(_q.y), round3(_q.z), round3(_q.w)],
            s: [round3(_s.x), round3(_s.y), round3(_s.z)],
            grabbing: true,
            object_id: mesh.userData?.xrDropId || (collabSpace === "shared" && !drawId ? "assembly" : null),
            draw_id: drawId || null,
            space: collabSpace,
          };
        }
      }
    } catch (_) {}
    let generating = null;
    try {
      const g = typeof getAiGenerationProgress === "function" ? getAiGenerationProgress() : null;
      const s = typeof getAiPromptState === "function" ? getAiPromptState() : null;
      const on = !!(g?.generating || s?.generating);
      if (on) {
        generating = {
          on: true,
          pct: Number(g?.pct ?? s?.genPct ?? 0) || 0,
          label: String(g?.label || s?.genLabel || "Generating…").slice(0, 36),
          by: String(g?.byUserName || s?.byUserName || "").slice(0, 24),
        };
      }
    } catch (_) {}
    if (xrEnterWorkSettled()) refreshLocalXrDevice();
    const pose = {
      head: { p: [round3(_headPos.x), round3(_headPos.y), round3(_headPos.z)], q: [round3(_headQuat.x), round3(_headQuat.y), round3(_headQuat.z), round3(_headQuat.w)] },
      left,
      right,
      held,
      generating,
      speaking: !!(voiceWanted && xrVoice.isEnabled() && xrVoice.tickSpeaking()),
      xr_device: localXrDevice || undefined,
      xr_mode: localXrMode || undefined,
      xr_prop: localXrProp || undefined,
      avatar: compactAvatarForPose(localAvatarSpec),
    };
    const sig = poseSignature(pose);
    // A newly joined/reconnected room needs a pose even when the headset is still.
    if (!poseMoved(lastPoseSig, sig) && !pose.held && !pose.generating && !poseForceSend && now - lastPoseBroadcastAt < 1000) return;
    lastPoseSig = sig;
    lastPoseBroadcastAt = now;
    poseForceSend = false;
    if (typeof sendCollab === "function") {
      sendCollab({ type: "xr.pose", pose });
    }
    try { sendPublicXrPose?.(pose); } catch (_) {}
  }

  function persistVoiceWanted() {
    writeVoicePrefs({ wanted: voiceWanted });
  }

  function micPromptEl() {
    return document.getElementById("xr-mic-prompt");
  }

  function syncMicPromptUi() {
    const el = micPromptEl();
    if (!el) return;
    const granted = !!(voicePrefs.granted || xrVoice.hasMic?.());
    const denied = !!xrVoice.isMicDenied?.();
    const show = !presenting && voiceWanted && isHeadsetBrowser() && !granted
      && (!voicePrefs.asked || denied);
    el.classList.toggle("hidden", !show);
    const title = el.querySelector("strong");
    const sub = el.querySelector("span");
    if (denied) {
      if (title) title.textContent = "Microphone blocked";
      if (sub) sub.textContent = "Allow the mic for this site in the browser, then tap here.";
    } else {
      if (title) title.textContent = "Talk in this room";
      if (sub) sub.textContent = "Allow microphone once — we will not ask again.";
    }
  }

  /**
   * Microphone is the only extra permission WebRTC needs (signaling rides the
   * existing collab socket). Ask the browser once, persist the result, then
   * reuse it silently on later visits.
   */
  function primeHeadsetMic({ force = false, enteringXr = false } = {}) {
    if (!voiceWanted && !force) {
      syncMicPromptUi();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) return;
    void (async () => {
      const state = await xrVoice.queryPermission?.() || "";
      if (state === "denied") {
        writeVoicePrefs({ asked: true, granted: false });
        syncMicPromptUi();
        return;
      }
      const granted = state === "granted" || voicePrefs.granted;
      if (!force && !enteringXr && voicePrefs.asked && !granted && !xrVoice.isPreparing?.()) {
        syncMicPromptUi();
        return;
      }
      if (granted && !presenting && !force && !enteringXr) {
        writeVoicePrefs({ asked: true, granted: true });
        syncMicPromptUi();
        return;
      }
      const ok = await xrVoice.prepareMic();
      if (ok) {
        writeVoicePrefs({ asked: true, granted: true, wanted: true });
        if (!presenting && !enteringXr) {
          try { xrVoice.releaseMic?.(); } catch { /* keep permission, drop the live track */ }
        } else if (voiceWanted) {
          void startHeadsetVoice();
        }
      } else if (state === "denied" || xrVoice.isMicDenied?.()) {
        writeVoicePrefs({ asked: true, granted: false });
      }
      syncMicPromptUi();
    })();
    void xrVoice.resumeAudio?.();
  }

  function bindMicAutoStart() {
    primeHeadsetMic();
    const prompt = micPromptEl();
    prompt?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      voiceWanted = true;
      persistVoiceWanted();
      try { xrVoice.clearMicBlock?.(); } catch { /* ignore */ }
      writeVoicePrefs({ asked: false });
      primeHeadsetMic({ force: true });
    });
    syncMicPromptUi();
  }

  async function startHeadsetVoice() {
    if (!voiceWanted || !presenting) return;
    if (!shouldRunXrVoiceIceWork({
      presenting,
      enterSettled: xrEnterWorkSettled(),
      unhideBusy: xrCadUnhideGpuBusy(),
      revealedThisFrame: Number(getLiveMesh()?.userData?._xrUnhide?.revealedThisFrame || 0),
    })) return;
    if (voicePrefs.asked && !voicePrefs.granted && !xrVoice.hasMic?.()) {
      menuFooterHint = xrVoice.isMicDenied?.()
        ? "Headset mic blocked — allow microphone for this site"
        : "Allow microphone to talk in the headset";
      syncMicPromptUi();
      return;
    }
    if (xrVoice.isMicDenied?.()) {
      menuFooterHint = "Headset mic blocked — allow microphone for this site";
      syncMicPromptUi();
      return;
    }
    const users = socialUsers();
    const peerIds = users.map((u) => u.id).filter(Boolean);
    const key = peerIds.slice().sort().join(",");
    if (xrVoice.isEnabled() && xrVoice.hasMic?.() && key === lastVoicePeerKey) {
      xrVoice.syncPeers(peerIds);
      return;
    }
    if (voiceStarting) return;
    voiceStarting = true;
    try {
      await xrVoice.start({
        userId: (typeof getLocalUserId === "function" && getLocalUserId()) || "",
        getToken: typeof getToken === "function" ? getToken : undefined,
        send: (payload) => {
          try { sendCollab?.(payload); } catch (_) {}
          try { sendPublicXr?.(payload); } catch (_) {}
        },
        peerIds,
      });
      xrVoice.setMuted(!!voicePrefs.muted);
      lastVoicePeerKey = key;
      writeVoicePrefs({ asked: true, granted: true });
      syncMicPromptUi();
      menuFooterHint = users.length
        ? "Voice on — talk in the headset"
        : "Voice on — waiting for a teammate in this project";
    } catch (err) {
      lastVoicePeerKey = "";
      if (err?.name === "XrVoiceDeferred") return;
      if (err?.name === "NotAllowedError" || err?.name === "SecurityError" || xrVoice.isMicDenied?.()) {
        writeVoicePrefs({ asked: true, granted: false });
      }
      menuFooterHint = xrVoice.isMicDenied?.()
        ? "Headset mic blocked — allow microphone for this site"
        : "Allow microphone to talk in the headset";
      console.warn("[viewport-xr] voice", err);
      syncMicPromptUi();
    } finally {
      voiceStarting = false;
    }
  }

  function stopHeadsetVoice() {
    lastVoicePeerKey = "";
    voiceStarting = false;
    try { xrVoice.stop(); } catch { /* ignore */ }
  }

  function isHeadsetMicLive() {
    return !!(
      voiceWanted
      && xrVoice.isEnabled()
      && xrVoice.hasMic?.()
      && !xrVoice.isLocalMuted?.()
    );
  }

  /** Belt icon: green = Talk on, red = off/muted. True before the track is up. */
  function isMicEnabledUi() {
    if (!voiceWanted) return false;
    try {
      if (xrVoice.isLocalMuted?.()) return false;
    } catch { /* treat as on */ }
    return true;
  }

  function paintMicChrome() {
    const on = isMicEnabledUi();
    try { dockPalette.setMicLive?.(on); } catch (_) {}
    try { agentAvatar.setMicLive?.(on); } catch (_) {}
    if (socialHubPanel?.group?.visible) refreshGridPopup("social");
    try { refreshWorkspacePanel(); } catch (_) {}
  }

  function forceMicOnForSession() {
    voiceWanted = true;
    writeVoicePrefs({ wanted: true });
    try { xrVoice.setMuted?.(!!voicePrefs.muted); } catch (_) {}
    paintMicChrome();
  }

  function headsetMicLabel(short = false) {
    if (isHeadsetMicLive()) return short ? "Mute" : "Mute my mic";
    return short ? "Unmute" : "Unmute my mic";
  }

  async function toggleHeadsetMic() {
    if (isHeadsetMicLive()) {
      try { xrVoice.setMuted?.(true); } catch (_) {}
      voiceWanted = true;
      writeVoicePrefs({ wanted: true, muted: true });
      menuFooterHint = "Mic muted";
      syncMicPromptUi();
      paintMicChrome();
      return { ok: true, muted: true };
    }
    voiceWanted = true;
    writeVoicePrefs({ wanted: true, muted: false });
    try { xrVoice.clearMicBlock?.(); } catch { /* ignore */ }
    if (xrVoice.isEnabled() && xrVoice.hasMic?.()) {
      try { xrVoice.setMuted?.(false); } catch (_) {}
      try { await xrVoice.resumeAudio?.(); } catch (_) {}
      menuFooterHint = "Mic on — talk in the headset";
      syncMicPromptUi();
      paintMicChrome();
      return { ok: true, muted: false };
    }
    if (!voicePrefs.granted) writeVoicePrefs({ asked: false });
    primeHeadsetMic({ force: !voicePrefs.granted, enteringXr: true });
    await startHeadsetVoice();
    try { xrVoice.setMuted?.(!!voicePrefs.muted); } catch (_) {}
    menuFooterHint = xrVoice.hasMic?.() && !xrVoice.isLocalMuted?.()
      ? "Mic on — talk in the headset"
      : (menuFooterHint || "Allow microphone to talk");
    syncMicPromptUi();
    paintMicChrome();
    return { ok: !!(xrVoice.hasMic?.() && !xrVoice.isLocalMuted?.()), muted: !!voicePrefs.muted };
  }

  // Gamepad / WebXR squeeze edge detection
  const prevTrigger = [false, false];
  const squeezeHeld = [false, false];
  const gripPressActive = [false, false];
  const handPinchLatched = [false, false];
  const gripScaleContact = [null, null];
  const lastNearGrip = [null, null];
  const pickNearSurface = createXrNearGrabPicker(THREE);

  function poseKey() {
    try {
      return (typeof getPoseStorageKey === "function" && getPoseStorageKey()) || LS_POSE;
    } catch {
      return LS_POSE;
    }
  }

  function saveRoomPose() {
    const mesh = getLiveMesh();
    if (!mesh || !presenting) return;
    const data = {
      position: mesh.position.toArray(),
      quaternion: mesh.quaternion.toArray(),
      scale: mesh.scale.toArray(),
      userZoom,
      activeSpawnId,
      at: Date.now(),
    };
    try {
      localStorage.setItem(poseKey(), JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }

  function loadRoomPose() {
    try {
      const raw = localStorage.getItem(poseKey());
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function getLiveMesh() {
    try {
      return getMeshRoot?.() || null;
    } catch {
      return null;
    }
  }

  function publicRoomJoined() {
    try {
      return !!getSocialState?.()?.publicJoined;
    } catch {
      return false;
    }
  }

  function projectSessionActive() {
    try {
      const s = getSocialState?.() || {};
      if (s.projectConnected) return true;
      return (s.users || []).some((u) => u?.fromProject || u?.fromPublicRoom);
    } catch {
      return false;
    }
  }

  function sharedXrSession() {
    return publicRoomJoined() || projectSessionActive();
  }

  function sendSharedXr(payload) {
    let sent = false;
    if (publicRoomJoined()) {
      try { sendPublicXr?.(payload); sent = true; } catch { /* ignore */ }
    }
    if (projectSessionActive() || !sent) {
      try { sendCollab?.(payload); } catch { /* ignore */ }
    }
  }

  function meshForCatalog(filename) {
    const want = String(filename || "").trim();
    const root = getLiveMesh();
    if (!root) return null;
    if (!want) return root;
    if (String(root.userData?.catalogFilename || "") === want) return root;
    let hit = null;
    root.traverse?.((o) => {
      if (!hit && String(o.userData?.catalogFilename || "") === want) hit = o;
    });
    return hit || root;
  }

  function applyRoomFloorSeat(seat) {
    if (!presenting || isDimosTeleopArmed()) {
      pendingRoomFloorSeat = seat;
      menuFooterHint = 'Room recenter queued until teleop is paused';
      return false;
    }
    getHeadPose();
    xrBoard.captureRefSpace(renderer);
    roomHeadEuler.setFromQuaternion(_headQuat, 'YXZ');
    const loco = floorRecenter({head:_headPos.toArray(),headYaw:roomHeadEuler.y,loco:xrBoard.state.loco,seat});
    xrBoard.setMode('walk'); xrBoard.setTeleport(false);
    const ok = xrBoard.applyLocomotion(renderer, loco);
    if (ok) { pendingRoomFloorSeat = null; poseForceSend = true; }
    return ok;
  }

  function recenterRoomFloor() {
    const ids = [localSocialUserId(), ...socialUsers().filter(u=>u.fromPublicRoom && u.xrPose?.head).map(u=>u.id)];
    const seats = roomFloorSeats(ids);
    const msg = {type:'xr.seat',action:'floor-recenter',seats};
    const seat = seats.find(s=>s.user_id===localSocialUserId());
    if (seat) applyRoomFloorSeat(seat);
    if (publicRoomJoined()) sendPublicXr?.(msg);
    menuFooterHint = pendingRoomFloorSeat ? 'Room recenter queued until teleop is paused' : 'Everyone on the room floor · hold B · left and right sticks walk';
    onStatus?.('ok',menuFooterHint);
  }

  function syncRoomFloor() {
    const joined = publicRoomJoined();
    if (joined && !roomFloorJoined) {
      pendingRoomFloorSeat = roomJoinSeat(localSocialUserId(),socialUsers().filter(u=>u.fromPublicRoom));
    }
    roomFloorJoined = joined;
    if (pendingRoomFloorSeat && !isDimosTeleopArmed()) applyRoomFloorSeat(pendingRoomFloorSeat);
  }

  function grippingThrowMesh() {
    const mesh = grabState?.target || gripGrab?.target;
    return isThrowPrintMesh(mesh);
  }

  function pollRoomLocomotion(sess, blocked = false) {
    const now = performance.now(), dt = roomStickAt ? (now-roomStickAt)/1000 : 0;
    roomStickAt = now;
    const busy = blocked || isDimosBlockingWalk() || debuggerOpen || stickRestartArmed || !!panelDrag;
    // Hold right B (buttons[5] / rightB) — analog extras and stick tilt are never B.
    const walkHeld = !busy && rightBHeld(sess?.inputSources) && !shareThrowWalkBlocked({ gripping: grippingThrowMesh() });
    roomWalkHeld = walkHeld;
    getHeadPose(); roomHeadEuler.setFromQuaternion(_headQuat, 'YXZ');
    const step = stepRoomLocomotion({loco:xrBoard.state.loco,head:_headPos.toArray(),headYaw:roomHeadEuler.y,
      axes:roomWalkAxes(sess?.inputSources,{walkHeld}),dt,turnLatched:roomTurnLatched,
      blocked:busy,walkHeld});
    roomTurnLatched = step.turnLatched;
    if (step.changed) {
      xrBoard.captureRefSpace(renderer);
      xrBoard.applyLocomotion(renderer,step.loco);
      poseForceSend = true;
    }
  }

  function activeGrabMesh() {
    return grabState?.target || gripGrab?.target || getLiveMesh();
  }

  function grabDropId() {
    return String(activeGrabMesh()?.userData?.xrDropId || "");
  }

  function worldPosOf(obj, out = new THREE.Vector3()) {
    try {
      obj.updateMatrixWorld?.(true);
      return obj.getWorldPosition(out);
    } catch {
      return out.set(0, 0, 0);
    }
  }

  function resolveAssemblyPart(obj) {
    const root = getLiveMesh();
    let o = obj;
    while (o && o !== root) {
      if (o.userData?.catalogFilename && o.parent === root) return o;
      o = o.parent;
    }
    return root;
  }

  function pickGrabMesh(controller) {
    try {
      const hit = pickWithController(controller);
      if (isUiPick(hit)) return null;
      if (isXrCadGrabProxy(hit?.object)) return null;
      const drawable = findDrawableRoot(hit?.object);
      if (drawable) return drawable;
      if (hit?.kind === "drop" && hit.root) return hit.root;
      if (grabAttachesFromHit(hit) && hit.object) {
        return resolveAssemblyPart(hit.object);
      }
    } catch { /* ignore */ }
    try {
      const nearDraw = nearestDrawable(worldPosOf(controller), 0.22);
      if (nearDraw) return nearDraw;
    } catch { /* ignore */ }
    if (publicRoomJoined()) {
      try {
        const near = publicDrops.nearest(worldPosOf(controller), 0.38);
        if (near?.root) return near.root;
      } catch { /* ignore */ }
    }
    return null;
  }

  function pickNearGrabMesh(controller) {
    if (!controller || !objectIsPosed(controller)) return null;
    const root = getLiveMesh();
    const candidates = [...allDrawables()];
    if (root) candidates.push(root);
    if (printerBounderHit?.visible) candidates.push(printerBounderHit);
    if (publicRoomJoined()) {
      for (const row of publicDrops.items.values()) candidates.push(row.root);
    }
    if (slicerPreview?.root?.visible) {
      for (const mesh of slicerPreview.grabCandidates()) candidates.push(mesh);
    }
    const hit = pickNearSurface(worldPosOf(controller), candidates);
    const hand = squeezeHandIndex(controller);
    if (hand >= 0) lastNearGrip[hand] = { near: hit ? "model" : "miss", distance: hit?.distance };
    if (!hit || isXrCadGrabProxy(hit.object) || isXrCadGrabProxy(hit.target)
      || isXrSelectionAabb(hit.object)) return null;
    if (hit.target === root) return resolveAssemblyPart(hit.object);
    return hit.target;
  }

  /** One-shot CAD / share triangle hit. Never AABB, floor, grid, or axes. */
  function pickTriggerMoveMesh(controller) {
    void XR_GRIP_MOVE_CACHE;
    if (!controller || !objectIsPosed(controller)) return null;
    if (isDimosTeleopArmed() && !voiceMoldLive) return null;
    controller.updateMatrixWorld?.(true);
    const handAim = controller.userData?.handAim;
    if (handAim?.origin && handAim?.direction) {
      raycaster.ray.origin.copy(handAim.origin);
      raycaster.ray.direction.copy(handAim.direction).normalize();
    } else {
      _mat.identity().extractRotation(controller.matrixWorld);
      raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(_mat);
    }
    const roots = [];
    const live = getLiveMesh();
    if (live) roots.push(live);
    for (const d of allDrawables()) if (d) roots.push(d);
    if (printerBounderHit?.visible) roots.push(printerBounderHit);
    if (publicRoomJoined()) {
      try {
        for (const row of publicDrops.items.values()) if (row?.root) roots.push(row.root);
      } catch { /* ignore */ }
    }
    let best = null;
    for (const root of roots) {
      const hit = studioAimHitsModel(raycaster, root);
      if (!hit || !isStudioModelGrabMesh(hit.object)) continue;
      if (!best || hit.distance < best.distance) best = { hit, root };
    }
    if (!best) return null;
    const drawable = findDrawableRoot(best.hit.object);
    if (drawable) return drawable;
    if (best.root?.userData?.xrDropId) return best.root;
    return resolveAssemblyPart(best.hit.object);
  }

  function pickScaleMesh() {
    if (scaleGrab?.target) return scaleGrab.target;
    const grab = grabState?.target || gripGrab?.target;
    if (grab) return grab;
    if (publicRoomJoined()) {
      try {
        const near = publicDrops.nearest(worldPosOf(controllers[0] || grips[0]), 0.55)
          || publicDrops.nearest(worldPosOf(controllers[1] || grips[1]), 0.55);
        if (near?.root) return near.root;
        const last = publicDrops.get(lastInteractedDropId) || publicDrops.latest?.();
        if (last?.root) return last.root;
      } catch { /* ignore */ }
    }
    return getLiveMesh();
  }

  function pickFitMesh() {
    const grab = grabState?.target || gripGrab?.target;
    if (grab) return grab;
    if (publicRoomJoined()) {
      getHeadPose();
      const last = publicDrops.get(lastInteractedDropId);
      if (last?.root) return last.root;
      const near = publicDrops.nearest(_headPos, 2.8);
      if (near?.root) return near.root;
      const latest = publicDrops.latest?.();
      if (latest?.root) return latest.root;
    }
    return getLiveMesh();
  }

  function noteDropInteract(mesh) {
    const id = mesh?.userData?.xrDropId;
    if (id) lastInteractedDropId = id;
  }

  function sampleTossPoint(mesh) {
    if (!mesh) return;
    const p = new THREE.Vector3();
    try { mesh.getWorldPosition(p); } catch { return; }
    tossSamples.push({ t: performance.now(), p: p.clone() });
    if (tossSamples.length > 8) tossSamples.shift();
  }

  function tossVelocityMps() {
    if (tossSamples.length < 2) return new THREE.Vector3();
    const a = tossSamples[0];
    const b = tossSamples[tossSamples.length - 1];
    const dt = (b.t - a.t) / 1000;
    if (!(dt > 0.03)) return new THREE.Vector3();
    return b.p.clone().sub(a.p).divideScalar(dt);
  }

  function catalogFromGrabMesh(mesh) {
    if (!mesh || mesh.userData?.xrDropId) return "";
    if (mesh.userData?.catalogFilename) return String(mesh.userData.catalogFilename);
    const root = getLiveMesh();
    if (mesh === root) {
      const child = (root?.children || []).find((c) => c?.userData?.catalogFilename);
      return child ? String(child.userData.catalogFilename) : "";
    }
    return "";
  }

  function maybeTossAway(mesh) {
    if (!mesh || mesh.userData?.xrDropId || tossAnim) return false;
    if (mesh.userData?.xrDrawable || mesh.userData?.xrDrawSolid || mesh.userData?.xrBuild || mesh.userData?.createPrimitive) {
      return false;
    }
    const vel = tossVelocityMps();
    if (vel.length() < TOSS_DELETE_SPEED_MPS) return false;
    const catalog = catalogFromGrabMesh(mesh);
    if (!catalog || catalog.startsWith("__create_") || /\.local$/i.test(catalog)) return false;
    tossAnim = {
      mesh,
      vel: vel.multiplyScalar(1.12),
      catalog,
      t0: performance.now(),
    };
    mesh.userData.xrTossing = true;
    menuFooterHint = "Tossed — removing…";
    return true;
  }

  function updateTossAway(dt) {
    if (!tossAnim) return;
    const t = (performance.now() - tossAnim.t0) / TOSS_ANIM_MS;
    const mesh = tossAnim.mesh;
    if (mesh) {
      try {
        mesh.position.addScaledVector(tossAnim.vel, dt);
        tossAnim.vel.y -= 6.8 * dt;
        mesh.scale.multiplyScalar(0.982);
        mesh.updateMatrixWorld(true);
      } catch (_) {}
    }
    if (t >= 1) {
      const catalog = tossAnim.catalog;
      tossAnim = null;
      try { onTossAway?.(catalog); } catch (_) {}
    }
  }

  function sendDropTransform(mesh, grabbing, force = false) {
    const id = mesh?.userData?.xrDropId;
    if (!id || !publicRoomJoined()) return;
    const now = performance.now();
    if (grabbing && !force && now - lastDropSendAt < 90) return;
    lastDropSendAt = now;
    const pose = publicDrops.packPose(mesh);
    if (!pose) return;
    try {
      sendSharedXr({
        type: "xr.object",
        object_id: id,
        pose,
        grabbing: !!grabbing,
      });
    } catch { /* ignore */ }
  }

  function frontDropPose() {
    getHeadPose();
    const fwd = headForwardFlat(new THREE.Vector3());
    const p = _headPos.clone().addScaledVector(fwd, 0.55);
    p.y = _headPos.y - 0.12;
    const toUser = fwd.clone().multiplyScalar(-1);
    toUser.y = 0;
    if (toUser.lengthSq() < 1e-6) toUser.set(0, 0, 1);
    else toUser.normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), toUser);
    return {
      p: [p.x, p.y, p.z],
      q: [q.x, q.y, q.z, q.w],
      s: [1, 1, 1],
    };
  }

  function ingestPublicDropMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "xr.objects.sync") {
      publicDrops.syncList(msg.objects || [], {merge:publicRoomJoined()});
      for (const row of msg.objects || []) {
        if (row?.type === "xr.printer" || row?.kind === "printer") applyRemotePrinterBox(row);
      }
      return;
    }
    if (msg.type === "xr.printer") {
      applyRemotePrinterBox(msg);
      return;
    }
    if (msg.type === "xr.drop") {
      publicDrops.upsert(msg);
      return;
    }
    if (msg.type === "xr.object") {
      publicDrops.applyObject(msg);
      return;
    }
    if (msg.type === "xr.fit") {
      if (msg.object_id) publicDrops.applyObject({ ...msg, type: "xr.object", grabbing: false });
      return;
    }
    if (msg.type === "xr.window") {
      applyRemoteWindowVisibility(msg);
      return;
    }
    if (msg.type === "xr.video") {
      let me = "";
      try { me = String((typeof getLocalUserId === "function" && getLocalUserId()) || ""); } catch { me = ""; }
      if (me && msg.user_id && String(msg.user_id) === me) return;
      openSharedVideo({
        url: msg.play_url || msg.file_url || msg.url || msg.video_url || "",
        title: msg.title || msg.filename || "Recording",
      });
      return;
    }
    ingestBoardMessage(msg);
  }

  function fitObjectInFront() {
    const mesh = pickFitMesh();
    const ok = placeInFront({
      mesh,
      spawnId: "eye",
      keepZoom: false,
      recaptureDesktop: !mesh?.userData?.xrDropId,
      force: true,
    });
    if (ok && mesh?.userData?.xrDropId) sendDropTransform(mesh, false);
    else {
      try { sendCollab?.({ type: "xr.fit", action: "recenter", size_m: 0.12 }); } catch { /* ignore */ }
    }
    try { onStatus?.("ok", "Fit — object in front of you"); } catch { /* ignore */ }
    return ok;
  }

  async function spawnPublicDrop(spec = {}) {
    const object_id = spec.object_id || newDropObjectId();
    const localMesh = spec.adoptLocal ? meshForCatalog(spec.filename) : null;
    const pose = spec.pose || (localMesh ? publicDrops.packPose(localMesh) : frontDropPose());
    let row = null;
    if (localMesh && (spec.kind === "scene" || spec.adoptLocal)) {
      row = publicDrops.adopt(object_id, localMesh, { ...spec, object_id, pose });
    } else {
      row = publicDrops.upsert({ ...spec, object_id, pose, lerp: 1 });
      if (row?.ready && !await row.ready) {
        publicDrops.remove(object_id);
        throw new Error(row.error || 'Could not load shared model');
      }
    }
    if (!sharedXrSession()) {
      if (!row?.adopted) publicDrops.remove(object_id);
      throw new Error('Join the public room or a shared project first');
    }
    publicDrops.setVisible(presenting);
    sendSharedXr({
      type: "xr.drop",
      object_id,
      project_id: spec.project_id || "",
      project_name: spec.project_name || "",
      share_url: spec.share_url || "",
      glb_url: spec.glb_url || "",
      filename: spec.filename || "",
      pose,
      kind: spec.kind || "drop",
      fit: spec.fit || "",
      share_mode: spec.share_mode || "",
    });
    noteDropInteract(row?.root);
    const verb = spec.kind === "import" ? "Imported" : "Dropped";
    try { onStatus?.("ok", `${verb} ${spec.project_name || "project"} into the room`); } catch { /* ignore */ }
    return row;
  }

  function setButtonUi(on) {
    if (!buttonEl) return;
    buttonEl.classList.toggle("active", !!on);
    buttonEl.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function syncDock() {
    const activeId = (dockButtons.find((b) => {
      const id = b.userData.xrTool;
      if (id === "passthrough" || id === "dock_hand" || id === "voice_toggle" || id === "capture") return false;
      if (id === "wheel" && toolWheel?.isVisible?.()) return true;
      if (id === "voice_mold" && voiceMoldLive) return true;
      if (id === "ai" && (aiHubPanel?.group?.visible || aiPanel?.group?.visible)) return true;
      if (id === "view" && viewPanel?.group?.visible) return true;
      if (id === "tools" && toolsPanel?.group?.visible) return true;
      if (id === "settings" && settingsPanel?.group?.visible) return true;
      if (id === "social" && socialHubPanel?.group?.visible) return true;
      if (id === "menu" && explorerPanel?.group?.visible) return true;
      if (id === "guides" && guidesPanel?.group?.visible) return true;
      if (id === "workspace" && workspacePanel?.group?.visible) return true;
      if ((id === "draw" || id === "voice_draw") && activeTool === "draw") return true;
      return id === activeTool;
    })?.userData.xrTool) || activeTool || "grab";
    try { dockPalette.setActive?.(activeId); } catch (_) {}
    try { toolWheel.setActive?.(activeId); } catch (_) {}
    try { toolWheel.setSnapOn?.(!!xrBuild.snapEnabled?.()); } catch (_) {}
    try { dockPalette.setMicLive?.(isMicEnabledUi()); } catch (_) {}
    try { agentAvatar.setMicLive?.(isMicEnabledUi()); } catch (_) {}
    try { syncToolHand(); } catch (_) {}
    dockButtons.forEach((btn) => {
      if (btn.userData.xrTool === "passthrough" || btn.userData.xrTool === "dock_hand" || btn.userData.xrTool === "voice_toggle" || btn.userData.xrTool === "capture") return;
      const on = btn.userData.xrTool === activeId;
      btn.scale.setScalar(on ? 1.12 : 1);
      btn.userData.puck?.scale.setScalar(on ? 1.12 : 1);
    });
  }

  function drawingHandHost() {
    const want = xrDrawHand(preferredDockHand);
    const hand = want === "right" ? getRightHand() : getLeftHand();
    const grip = want === "right" ? getRightGrip() : getLeftGrip();
    if (!shouldAttachDrawHandToAimController()) {
      let source=null;
      for(const candidate of renderer.xr.getSession?.()?.inputSources || []) {
        if(candidate.handedness!==want)continue;
        source=candidate;if(candidate.gamepad)break;
      }
      return drawingWristHost({source,grip,hand,wrist:hand ? getHandJoint(hand,"wrist") : null,posed:objectIsPosed});
    }
    const posed = posedControllerForHand(want === "right" ? 1 : 0);
    if (posed && objectIsPosed(posed)) return posed;
    if (grip && objectIsPosed(grip)) return grip;
    if (hand && objectIsPosed(hand)) return hand;
    return posed || grip || hand || null;
  }

  let lastToolHandSig = "";
  function syncToolHand() {
    const handTool = aiDrawWorkspace.isActive() ? `board:${aiDrawWorkspace.getTool()}` : activeTool;
    const chromeOn = !!presenting && (aiDrawWorkspace.isActive() || toolHandUiIds(handTool).length > 0);
    const host = drawingHandHost();
    const snap = !!xrBuild.snapEnabled?.();
    const histU = xrCreateHistory.canUndo();
    const histR = xrCreateHistory.canRedo();
    const liveHost = host && objectIsPosed(host) ? host : null;
    const sig = `${chromeOn}|${handTool}|${snap}|${drawColor}|${drawSizeId}|${drawBrush}|${preferredDockHand}|${histU}|${histR}|${liveHost?.uuid || ""}`;
    toolHand.setVisible?.(chromeOn && !!liveHost);
    if (sig !== lastToolHandSig) {
      lastToolHandSig = sig;
      try { toolHand.setVisible?.(chromeOn && !!liveHost); } catch (_) {}
      try { toolHand.setTool?.(handTool); } catch (_) {}
      try { toolHand.setColor?.(drawColor); } catch (_) {}
      try { toolHand.setSizeId?.(drawSizeId); toolHand.setBrush?.(drawBrush); } catch (_) {}
      try { toolHand.setHistoryState?.({ undo: histU, redo: histR }); } catch (_) {}
      try { toolWheel.setSnapOn?.(snap); } catch (_) {}
    }
    if (liveHost) {
      try { toolHand.attachTo?.(liveHost, { dockHand: preferredDockHand, headPosition: _headPos }); } catch (_) {}
    }

  }

  function getHeadPose() {
    const xrCam = renderer.xr.getCamera?.(camera);
    if (xrCam?.cameras?.length >= 2) {
      // Average both eyes — more stable than left-only on Quest
      xrCam.cameras[0].getWorldPosition(_eyeA);
      xrCam.cameras[1].getWorldPosition(_eyeB);
      _headPos.copy(_eyeA).add(_eyeB).multiplyScalar(0.5);
      xrCam.getWorldQuaternion(_headQuat);
      return true;
    }
    if (xrCam?.cameras?.[0]) {
      xrCam.cameras[0].getWorldPosition(_headPos);
      xrCam.getWorldQuaternion(_headQuat);
      return true;
    }
    if (xrCam) {
      xrCam.getWorldPosition(_headPos);
      xrCam.getWorldQuaternion(_headQuat);
      return true;
    }
    camera.getWorldPosition(_headPos);
    camera.getWorldQuaternion(_headQuat);
    return false;
  }

  /** Full gaze forward (includes pitch) — keeps model in your view. */
  function headForward(out = _fwd) {
    out.set(0, 0, -1).applyQuaternion(_headQuat).normalize();
    return out;
  }

  /** Horizontal gaze — place object directly in front at eye height. */
  function headForwardFlat(out = _fwd) {
    out.set(0, 0, -1).applyQuaternion(_headQuat);
    out.y = 0;
    if (out.lengthSq() < 1e-6) out.set(0, 0, -1);
    else out.normalize();
    return out;
  }

  function waitForXrFrame() {
    return new Promise((resolve) => {
      const sess = renderer.xr.getSession?.() || session;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      try {
        if (sess?.requestAnimationFrame) {
          sess.requestAnimationFrame(() => finish());
        } else {
          requestAnimationFrame(() => finish());
        }
      } catch {
        requestAnimationFrame(() => finish());
      }
      setTimeout(finish, 80);
    });
  }

  function captureDesktop(mesh) {
    if (saved?.mesh === mesh) return;
    saved = {
      mesh,
      pos: mesh.position.clone(),
      quat: mesh.quaternion.clone(),
      scale: mesh.scale.clone(),
      visible: mesh.visible !== false,
      parent: mesh.parent,
    };
  }

  function restoreDesktop() {
    if (!saved?.mesh) return;
    const { mesh, pos, quat, scale, visible } = saved;
    const marker = mesh.getObjectByName("xrModelMarker");
    if (marker) {
      mesh.remove(marker);
      marker.geometry?.dispose?.();
      marker.material?.dispose?.();
    }
    try { finishXrCadUnhide(mesh, { restore: true }); } catch (_) {}
    mesh.position.copy(pos);
    mesh.quaternion.copy(quat);
    mesh.scale.copy(scale);
    mesh.visible = true;
    mesh.updateMatrixWorld(true);
    for (const [obj, fc] of frustumBackup) {
      if (obj) obj.frustumCulled = fc;
    }
    frustumBackup = [];
    saved = null;
    void visible;
  }

  function getSharedXrCadMaterial() {
    if (!xrSharedCadMat) {
      xrSharedCadMat = new THREE.MeshBasicMaterial({
        color: 0xc4c9d4,
      });
    }
    return xrSharedCadMat;
  }

  function getXrCadPaletteMaterial(key) {
    const k = Number.isFinite(Number(key)) ? Number(key) : 13;
    let mat = xrCadPaletteMats.get(k);
    if (!mat) {
      mat = new THREE.MeshBasicMaterial({
        color: xrCadPaletteHex(k),
      });
      xrCadPaletteMats.set(k, mat);
    }
    return mat;
  }

  function hideXrCadEdges(mesh) {
    if (!mesh || !shouldHideCadEdgesInXr({ presenting })) return;
    if (mesh.userData?._xrEdgesHidden) return;
    try {
      let n = 0;
      const stack = [mesh];
      while (stack.length && n < 96) {
        const o = stack.pop();
        if (!o) continue;
        // Cheap LineSegments / isEdge stay — they are desktop Render outlines.
        // LineSegments2 froze Quest. Selection AABB is not the CAD.
        if (o.isLineSegments2 || isXrSelectionAabb(o)) {
          try { o.visible = false; } catch (_) {}
          n += 1;
        }
        const kids = o.children;
        if (!kids?.length) continue;
        for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
      }
      mesh.userData._xrEdgesHidden = true;
    } catch (_) {}
  }

  function setXrCadHoldLayer(obj, hold) {
    if (!obj?.layers?.set) return;
    try {
      obj.layers.set(hold ? XR_CAD_HOLD_LAYER : xrCadChildDrawLayer({
        enterSettled: xrEnterWorkSettled(),
      }));
    } catch (_) {}
  }

  function assignXrCadPalette(o) {
    if (!o?.isMesh || o.userData?.xrDrop || o.userData?.xrCadProxy) return;
    if (!o.userData._xrMatBak) o.userData._xrMatBak = o.material;
    const bak = o.userData._xrMatBak;
    if (bak && o.material !== bak) o.material = bak;
    void xrCadColorRgb;
    void getXrCadPaletteMaterial;
  }

  function ensureXrCadProxy(mesh) {
    // CAD bounds are not model geometry. Strip legacy stand-ins; reveal the
    // loaded project itself through the bounded visibility pass.
    try { removeXrCadProxy(mesh); } catch (_) {}
    return null;
  }

  function removeXrCadProxy(mesh) {
    if (!mesh) return;
    const proxy = mesh.getObjectByName("xrCadProxy");
    if (!proxy) return;
    try { proxy.parent?.remove(proxy); } catch (_) {}
    try { proxy.geometry?.dispose?.(); } catch (_) {}
    try { proxy.material?.dispose?.(); } catch (_) {}
  }

  function parkXrCadForEnter(mesh) {
    if (!mesh) return;
    try { hideXrCadEdges(mesh); } catch (_) {}
    const kids = mesh.children || [];
    if (!kids.length && (mesh.isMesh || mesh.isSkinnedMesh)) {
      setXrCadHoldLayer(mesh, true);
      return;
    }
    // Park budgeted bodies as well as their GLTF wrapper, so revealing one
    // body can open the wrapper without exposing every sibling at once.
    for (const unit of new Set([...kids, ...xrCadUnhideUnits(mesh)])) {
      if (!unit || unit.userData?.xrCadProxy || unit.name === "xrModelMarker" || unit.name === "xrCadProxy") continue;
      try {
        if (isXrSelectionAabb(unit) || unit.isLineSegments2) {
          unit.visible = false;
          continue;
        }
        if (unit.userData?.isEdge || unit.isLineSegments || unit.userData?.isSilhouette) {
          unit.visible = true;
          continue;
        }
        if (unit.userData._xrParkedVis == null) unit.userData._xrParkedVis = unit.visible !== false;
        unit.visible = false;
        setXrCadHoldLayer(unit, true);
      } catch (_) {}
    }
  }

  function beginXrCadProgressiveUnhide(mesh) {
    // No second GLB — park the live mesh and reveal parts over frames.
    if (!mesh || !presenting) return;
    if (mesh.userData?._xrUnhideDone) return;
    if (mesh.userData?._xrUnhide) return;
    try { stashXrLocalBoxFromOwnGeometry(mesh); } catch (_) {}
    parkXrCadForEnter(mesh);
    const units = xrCadUnhideUnits(mesh).map((obj) => xrAnnotateUnhideUnit(obj));
    try { mesh.userData._xrCadCensus = xrCadTreeCensus(mesh); } catch (_) {}
    mesh.userData._xrUnhide = {
      rest: units,
      skipped: [],
      triShown: 0,
      shown: 0,
      revealedThisFrame: 0,
      placedFrame: xrFrame,
    };
    try { removeXrCadProxy(mesh); } catch (_) {}
    // Do not retain a bounds box for parts omitted by the XR draw budget.
  }

  function revealXrCadUnit(unit, { enterSettled = true, root = null } = {}) {
    const obj = unit?.obj;
    if (!obj) return;
    if (unit.skipFull) return;
    if (
      shouldSkipOverBudgetXrMesh({ triangles: unit.triangles, hardCap: XR_MESH_TRI_HARD_CAP })
      && !unit.standIn
    ) return;
    try {
      // Opening a body without its parked GLTF wrapper left the real project
      // invisible. Reveal only this body's path; its siblings remain parked.
      const ancestors = [];
      for (let parent = obj.parent; parent && parent !== root; parent = parent.parent) {
        if (parent.userData?._xrParkedVis === false) return;
        ancestors.push(parent);
        if (ancestors.length >= 32) break;
      }
      if (obj.userData?._xrParkedVis === false) return;
      for (const parent of ancestors) {
        if (parent.userData?._xrParkedVis !== true) continue;
        parent.visible = true;
        setXrCadHoldLayer(parent, enterSettled !== true);
      }
      const standIn = unit.standIn;
      if (standIn?.geometry && standIn.swapGeometry && (obj.isMesh || obj.isSkinnedMesh)) {
        if (!obj.userData._xrFullGeometry) obj.userData._xrFullGeometry = obj.geometry;
        obj.geometry = standIn.geometry;
      }
      const showObj = standIn?.obj && standIn.obj !== obj ? standIn.obj : obj;
      try {
        const stack = [obj];
        let n = 0;
        while (stack.length && n < 32) {
          const o = stack.pop();
          if (!o) continue;
          if (o.isLineSegments2 || isXrSelectionAabb(o)) {
            o.visible = false;
            n += 1;
            continue;
          }
          if (o.userData?.isEdge || o.isLineSegments || o.userData?.isSilhouette) {
            o.visible = true;
            n += 1;
            continue;
          }
          for (const c of o.children || []) stack.push(c);
        }
      } catch (_) {}
      if (showObj !== obj) {
        obj.visible = true;
        setXrCadHoldLayer(obj, true);
        showObj.visible = true;
        setXrCadHoldLayer(showObj, enterSettled !== true);
        if (showObj.isMesh || showObj.isSkinnedMesh) assignXrCadPalette(showObj);
        return;
      }
      obj.visible = true;
      setXrCadHoldLayer(obj, enterSettled !== true);
      if (obj.isMesh || obj.isSkinnedMesh) assignXrCadPalette(obj);
      else {
        xrWalkMeshesCapped(obj, (o) => {
          assignXrCadPalette(o);
          return true;
        }, XR_PLACE_AABB_MESH_CAP);
      }
    } catch (_) {}
  }

  function stepXrCadUnhide(mesh) {
    if (!mesh || !presenting) return;
    if (mesh.userData?._xrUnhideDone) return;
    if (!mesh.userData?._xrUnhide) beginXrCadProgressiveUnhide(mesh);
    const state = mesh.userData._xrUnhide;
    if (!state) return;
    try { removeXrCadProxy(mesh); } catch (_) {}
    try { mesh.userData._xrProxyFromBox = true; } catch (_) {}
    const enterSettled = xrEnterWorkSettled();
    if (!enterSettled) {
      parkXrCadForEnter(mesh);
      return;
    }
    const delayHighPoly = !shouldRevealXrHighPoly({
      enterSettled,
      framesSincePlace: xrFrame - (Number(state.placedFrame) || xrFrame),
    });
    const sessionTri = Number(state.triShown) || 0;
    const boardUsage = (aiDrawWorkspace.view.root.visible && aiDrawWorkspace.view.getModelUsage?.()) || { triangles: 0, meshes: 0 };
    const sessionLeft = Math.max(0, XR_CAD_DRAW_MAX_TRIS - boardUsage.triangles - sessionTri);
    const plan = xrUnhideFramePlan({
      remaining: state.rest,
      meshesPerFrame: XR_UNHIDE_MESHES_PER_FRAME,
      triBudget: Math.min(XR_FIRST_FRAME_TRI_BUDGET, sessionLeft),
      triShown: 0,
      delayHighPoly,
      hardCap: XR_MESH_TRI_HARD_CAP,
      partsShown: Number(state.shown) || 0,
      maxParts: Math.max(1, XR_CAD_DRAW_MAX_PARTS - boardUsage.meshes),
      sessionTriShown: sessionTri,
    });
    for (const unit of plan.show) revealXrCadUnit(unit, { enterSettled: true, root: mesh });
    state.rest = plan.rest;
    state.skipped = (state.skipped || []).concat(plan.skip || []);
    state.triShown = sessionTri + (Number(plan.triShown) || 0);
    state.shown += plan.show.length;
    state.revealedThisFrame = plan.show.length;
    try { removeXrCadProxy(mesh); } catch (_) {}
    if (plan.done) finishXrCadUnhide(mesh, { restore: false });
  }

  function finishXrCadUnhide(mesh, { restore = false } = {}) {
    if (!mesh) return;
    const state = mesh.userData?._xrUnhide;
    try { removeXrCadProxy(mesh); } catch (_) {}
    if (restore) {
      try { removeXrCadProxy(mesh); } catch (_) {}
      const parked = new Set([...(mesh.children || []), ...xrCadUnhideUnits(mesh)]);
      setXrCadHoldLayer(mesh, false);
      for (const obj of parked) {
        if (!obj) continue;
        try {
          if (obj.userData._xrFullGeometry) {
            obj.geometry = obj.userData._xrFullGeometry;
            delete obj.userData._xrFullGeometry;
          }
          if (obj.userData._xrParkedVis != null) obj.visible = obj.userData._xrParkedVis;
          setXrCadHoldLayer(obj, false);
          delete obj.userData._xrParkedVis;
        } catch (_) {}
      }
      try {
        delete mesh.userData._xrUnhide;
        delete mesh.userData._xrUnhideDone;
        delete mesh.userData._xrEdgesHidden;
      } catch (_) {}
      return;
    }
    // Never dump remaining / over-budget BufferGeometry into XR.
    try {
      mesh.userData._xrUnhide = null;
      mesh.userData._xrUnhideDone = true;
      mesh.userData._xrUnhideSkipped = Number(state?.skipped?.length || 0);
    } catch (_) {}
  }

  function prepareMeshesForXr(mesh) {
    if (!mesh) return;
    if (presenting && !shouldPrepareXrMeshesOnEnter({ enterSettled: xrEnterWorkSettled() })) {
      try { parkXrCadForEnter(mesh); } catch (_) {}
      return;
    }
    try { hideXrCadEdges(mesh); } catch (_) {}
    try { hideXrSelectionAabbs(mesh, { max: 48, depth: 3 }); } catch (_) {}
    try { reviveXrParkedMaterials(mesh); } catch (_) {}
    const clone = shouldCloneXrPbrMaterials({ presenting });
    mesh.visible = true;
    if (!shouldPrepareXrMeshes({ prepared: !!mesh.userData._xrPrepared })) {
      try { beginXrCadProgressiveUnhide(mesh); } catch (_) {}
      if (!clone) {
        try { disposeParkedWrapGpuFromObject(mesh); } catch (_) {}
      }
      try { reviveXrParkedMaterials(mesh); } catch (_) {}
      return;
    }
    frustumBackup = [];
    mesh.userData._xrPrepared = true;
    try { beginXrCadProgressiveUnhide(mesh); } catch (_) {}
    try { disposeParkedWrapGpuFromObject(mesh); } catch (_) {}
    try { reviveXrParkedMaterials(mesh); } catch (_) {}
    try { liftXrCadMaterialsWithoutIbl(mesh); } catch (_) {}
    void shouldShareXrCadMaterial({ presenting });
    void getSharedXrCadMaterial;
  }

  /** Golden Aug 5: without RoomEnvironment IBL, high metalness reads black / mushy. */
  function liftXrCadMaterialsWithoutIbl(root) {
    if (!root) return;
    root.traverse((o) => {
      if (!o?.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        if (m.emissive && m.emissiveIntensity != null && !m.userData._xrEmissiveBak) {
          m.userData._xrEmissiveBak = {
            color: m.emissive.clone(),
            intensity: m.emissiveIntensity,
          };
          m.emissive.setHex(0x4a5563);
          m.emissiveIntensity = Math.max(m.emissiveIntensity || 0, 0.42);
        }
        if (m.metalness != null && m.metalness > 0.35 && m.userData._xrMetalBak == null) {
          m.userData._xrMetalBak = m.metalness;
          m.metalness = Math.min(m.metalness, 0.22);
        }
        if (m.roughness != null && m.roughness < 0.25 && m.userData._xrRoughBak == null) {
          m.userData._xrRoughBak = m.roughness;
          m.roughness = Math.max(m.roughness, 0.32);
        }
        if (m.envMapIntensity != null) {
          m.envMapIntensity = Math.max(m.envMapIntensity || 0, 0.8);
        }
        m.needsUpdate = true;
      }
    });
  }

  function restoreMeshMaterials() {
    if (!saved?.mesh) return;
    try { delete saved.mesh.userData._xrPrepared; } catch (_) {}
    saved.mesh.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData._xrFullGeometry) {
        o.geometry = o.userData._xrFullGeometry;
        delete o.userData._xrFullGeometry;
      }
      if (o.userData._xrMatBak) {
        o.material = o.userData._xrMatBak;
        const bakMats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of bakMats) reviveParkedWrapGpuTextures(m);
        delete o.userData._xrMatBak;
      }
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        const bak = m?.userData?._xrEmissiveBak;
        if (bak) {
          m.emissive.copy(bak.color);
          m.emissiveIntensity = bak.intensity;
          delete m.userData._xrEmissiveBak;
        }
        if (m?.userData?._xrMetalBak != null) {
          m.metalness = m.userData._xrMetalBak;
          delete m.userData._xrMetalBak;
        }
        if (m?.userData?._xrRoughBak != null) {
          m.roughness = m.userData._xrRoughBak;
          delete m.userData._xrRoughBak;
        }
        if (m?.userData?._xrColorBak) {
          m.color.copy(m.userData._xrColorBak);
          delete m.userData._xrColorBak;
        }
      }
    });
  }

  /**
   * Content-only world size (ignore markers / lights / non-mesh helpers).
   */
  const _meshBox = new THREE.Box3();
  const _meshBoxScratch = new THREE.Box3();
  const _fenceOrigin = new THREE.Vector3();
  const _fenceDir = new THREE.Vector3();
  const _fenceQuat = new THREE.Quaternion();
  const _placeInv = new THREE.Matrix4();
  let _meshBoxUuid = "";
  let _meshBoxAt = 0;
  let xrSharedCadMat = null;
  const xrCadPaletteMats = new Map();
  const _meshHit = new THREE.Vector3();
  const _rayPts = [new THREE.Vector3(), new THREE.Vector3()];
  const _placeSize = new THREE.Vector3();
  const _placeCenter = new THREE.Vector3();
  const _placeDelta = new THREE.Vector3();

  function applyCachedLocalBox(mesh) {
    const rec = readXrLocalBox(mesh);
    if (!rec) return null;
    try {
      const world = xrWorldBoxFromLocalBox(rec.min, rec.max, mesh.matrixWorld.elements);
      _meshBox.min.set(world.min[0], world.min[1], world.min[2]);
      _meshBox.max.set(world.max[0], world.max[1], world.max[2]);
      if (_meshBox.isEmpty()) return null;
      return _meshBox;
    } catch {
      return null;
    }
  }

  function captureLocalBoxFromWorld(mesh, worldBox) {
    if (!mesh || !worldBox || worldBox.isEmpty?.()) return;
    try {
      _placeInv.copy(mesh.matrixWorld).invert();
      stashXrLocalBox(
        mesh,
        [worldBox.min.x, worldBox.min.y, worldBox.min.z],
        [worldBox.max.x, worldBox.max.y, worldBox.max.z],
        _placeInv.elements,
      );
    } catch (_) {}
  }

  function contentBoxFromMesh(mesh, { force = false, skipMatrix = false, firstPlace = false } = {}) {
    if (!mesh) return new THREE.Box3();
    const now = performance.now();
    const grabbingNow = !!(gripGrab || scaleGrab || grabState);
    if (!readXrLocalBox(mesh)) {
      try { stashXrLocalBoxFromOwnGeometry(mesh); } catch (_) {}
    }
    const cached = readXrLocalBox(mesh);
    if (shouldReuseCachedXrBounds({ hasCached: !!cached }) && (firstPlace || !force)) {
      if (skipMatrix !== true) mesh.updateMatrixWorld(true);
      const hit = applyCachedLocalBox(mesh);
      if (hit) {
        _meshBoxUuid = mesh.uuid;
        _meshBoxAt = now;
        return hit;
      }
    }
    if (
      mesh.uuid === _meshBoxUuid
      && !_meshBox.isEmpty()
      && !shouldRefreshXrContentBox({
        grabbing: grabbingNow,
        worldAnchored,
        lastMs: _meshBoxAt,
        now,
        force: force && !firstPlace,
      })
    ) {
      return _meshBox;
    }
    const box = _meshBox;
    box.makeEmpty();
    let any = false;
    let visited = 0;
    const walk = shouldWalkXrPlaceAabb({
      hasCached: !!cached,
      firstPlace,
      force,
    });
    if (!walk) {
      if (skipMatrix !== true) mesh.updateMatrixWorld(true);
      const hit = applyCachedLocalBox(mesh);
      if (hit) {
        _meshBoxUuid = mesh.uuid;
        _meshBoxAt = now;
        return hit;
      }
    }
    if (skipMatrix !== true) mesh.updateMatrixWorld(true);
    const takeMesh = (o) => {
      if (!o?.isMesh || !o.geometry) return false;
      if (o.name === "xrModelMarker") return false;
      if (o.userData?.xrIgnoreBounds) return false;
      if (o.userData?.isEdge || o.userData?.isSilhouette) return false;
      if (!o.geometry.boundingBox) {
        try { o.geometry.computeBoundingBox(); } catch { /* ignore */ }
      }
      if (o.geometry.boundingBox) {
        _meshBoxScratch.copy(o.geometry.boundingBox);
        _meshBoxScratch.applyMatrix4(o.matrixWorld);
      } else {
        _meshBoxScratch.setFromObject(o);
      }
      if (_meshBoxScratch.isEmpty()) return false;
      if (!any) {
        box.copy(_meshBoxScratch);
        any = true;
      } else {
        box.union(_meshBoxScratch);
      }
      visited += 1;
      return true;
    };
    if (firstPlace || !shouldTraverseCadForXrContentBox({ presenting, hasCached: !!cached })) {
      xrWalkMeshesCapped(mesh, takeMesh, XR_PLACE_AABB_MESH_CAP);
    } else {
      mesh.traverse((o) => { takeMesh(o); });
    }
    if (!any) box.setFromObject(mesh);
    if (any && !box.isEmpty()) captureLocalBoxFromWorld(mesh, box);
    _meshBoxUuid = mesh.uuid;
    _meshBoxAt = now;
    return box;
  }

  /** Standing / seated headset pose — rejects desktop orbit camera leftovers. */
  function isReasonableXrHead() {
    if (!Number.isFinite(_headPos.x) || !Number.isFinite(_headPos.y) || !Number.isFinite(_headPos.z)) {
      return false;
    }
    // Viewer-space y can be ~0; local-floor is ~1.5m. Desktop orbit is often y>3 or xz>>room.
    if (_headPos.y < -0.2 || _headPos.y > 3.0) return false;
    if (Math.hypot(_headPos.x, _headPos.z) > 8) return false;
    if (_headQuat.lengthSq() < 0.5) return false;
    return true;
  }

  const PANEL_UP_DEFAULT = -0.14;
  const PANEL_UP_MIN = -0.62;
  const PANEL_UP_MAX = 0.22;
  const PANEL_FWD_MIN = 0.38;
  const PANEL_FWD_MAX = 1.2;
  const PANEL_RIGHT_MAX = 0.72;
  const PANEL_RANGE_MAX = 2.4;
  const PANEL_SPAWN_FWD = XR_WINDOW_SPAWN_DIST_M;
  let panelsAwaitingHead = false;
  let lastPanelRescueAt = 0;
  let visibilityWindowPoses = new Map();

  function worldWindowRows() {
    const entries = [
      ["ai", aiPanel?.group], ["menu", explorerPanel?.group], ["view", viewPanel?.group],
      ["settings", settingsPanel?.group], ["tools", toolsPanel?.group], ["aiHub", aiHubPanel?.group],
      ["socialHub", socialHubPanel?.group], ["draw", drawPanel?.group], ["workspace", workspacePanel?.group],
      ["avatar", avatarPanel?.group], ["place", placePanel?.group], ["studio", xrStudio?.group],
      ["social", xrSocialCard?.group], ["robotics", roboticsPanel?.group],
    ];
    return entries.flatMap(([id, group]) => {
      if (!group) return [];
      const position = group.getWorldPosition(new THREE.Vector3());
      const quaternion = group.getWorldQuaternion(new THREE.Quaternion());
      return [{
        id,
        group,
        visible: group.visible === true,
        pose: {x:position.x,y:position.y,z:position.z,qx:quaternion.x,qy:quaternion.y,qz:quaternion.z,qw:quaternion.w},
      }];
    });
  }

  function captureVisibilityWindowPoses() {
    visibilityWindowPoses = captureVisibleWindowPoses(worldWindowRows());
  }

  function restoreVisibilityWindowPoses(reason) {
    if (!shouldRestoreWindowPoses({
      presenting,
      becameVisible: reason === "visibility",
      referenceSpaceChanged: reason === "refspace",
      snapshot: visibilityWindowPoses,
    })) return false;
    const rows = new Map(worldWindowRows().map((row) => [row.id, row]));
    for (const [id, pose] of visibilityWindowPoses) {
      const group = rows.get(id)?.group;
      if (!group) continue;
      setPanelWorldPose(
        group,
        new THREE.Vector3(pose.x, pose.y, pose.z),
        new THREE.Quaternion(pose.qx, pose.qy, pose.qz, pose.qw),
      );
      group.visible = true;
    }
    return true;
  }

  function ensureXrHeadPose() {
    getHeadPose();
    if (!presenting) return isReasonableXrHead();
    if (isReasonableXrHead()) return true;
    _headPos.set(0, 1.55, 0);
    if (_headQuat.lengthSq() < 0.5) _headQuat.identity();
    return false;
  }

  function headRightFlat(out = new THREE.Vector3()) {
    out.set(1, 0, 0).applyQuaternion(_headQuat);
    out.y = 0;
    if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
    else out.normalize();
    return out;
  }

  function ensureHudWorldParent(group) {
    if (!group) return;
    if (group.parent === xrHud) return;
    group.updateMatrixWorld(true);
    xrHud.updateMatrixWorld(true);
    const wp = group.getWorldPosition(new THREE.Vector3());
    const wq = group.getWorldQuaternion(new THREE.Quaternion());
    try { group.parent?.remove(group); } catch (_) {}
    xrHud.add(group);
    xrHud.updateMatrixWorld(true);
    xrHud.worldToLocal(wp);
    group.position.copy(wp);
    const pq = xrHud.getWorldQuaternion(new THREE.Quaternion());
    group.quaternion.copy(pq.invert().multiply(wq));
  }

  function markWorldUi(root) {
    if (!root) return;
    root.userData.xrWorldDepth = true;
    root.traverse?.((o) => {
      if (!o) return;
      o.userData.xrWorldDepth = true;
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const pick = isXrWorldPickMesh(o);
      for (const m of mats) {
        if (pick) applyWorldUiPickMaterialFlags(m);
        else applyWorldUiMaterialFlags(m);
      }
    });
  }

  function setPanelWorldPose(group, worldPos, worldQuat) {
    if (!group || !worldPos) return;
    ensureHudWorldParent(group);
    xrHud.updateMatrixWorld(true);
    const local = worldPos.clone();
    xrHud.worldToLocal(local);
    group.position.copy(local);
    if (worldQuat) {
      const pq = xrHud.getWorldQuaternion(new THREE.Quaternion());
      group.quaternion.copy(pq.clone().invert().multiply(worldQuat));
    }
  }

  function facePanelTowardHead(group, worldPos) {
    if (!group || group.userData?.xrUserRotated) return;
    const pos = worldPos || group.getWorldPosition(_v);
    const q = windowFaceTowardHead(pos, _headPos);
    _faceWorldQ.set(q.x, q.y, q.z, q.w);
    const parent = group.parent;
    if (parent) {
      parent.updateMatrixWorld(true);
      parent.getWorldQuaternion(_faceParentQ);
      group.quaternion.copy(_faceParentQ.invert().multiply(_faceWorldQ));
    } else {
      group.quaternion.copy(_faceWorldQ);
    }
  }

  function savedPanelOffsetsSane(data) {
    if (!data || data.v !== 2 || !Number.isFinite(data.forward)) return false;
    const fwd = Number(data.forward);
    const right = Number(data.right);
    const up = Number(data.up);
    if (!Number.isFinite(fwd) || !Number.isFinite(right)) return false;
    if (fwd < 0.12 || fwd > 2.4) return false;
    if (Math.abs(right) > 1.6) return false;
    if (!Number.isFinite(up) || Math.abs(up) > 1.05) return false;
    if (Math.hypot(fwd, right) > 2.8) return false;
    return true;
  }

  function panelWorldPosIsUsable(group) {
    if (!group) return false;
    const p = group.getWorldPosition(new THREE.Vector3());
    // Keep user-placed / close windows. The old 18cm–2.4m band treated a
    // nearby panel as lost and re-spawned it at default Z on Join / Social / tabs.
    return panelWorldPoseIsKept(p);
  }

  /** Default spawn: ~0.55 m in front of the eyes, slightly below, facing the user. */
  function spawnPanelWorldPos(rightOff = 0, up = PANEL_UP_DEFAULT) {
    ensureXrHeadPose();
    const pos = _headPos.clone().addScaledVector(headForwardFlat(), PANEL_SPAWN_FWD);
    if (rightOff) pos.addScaledVector(headRightFlat(), rightOff);
    const near = clampPanelNearHead(pos, _headPos, { distance: PANEL_SPAWN_FWD, up });
    pos.set(near.x, near.y, near.z);
    return pos;
  }

  /** Fallback left-of-user chest pose — auto-open uses leftMonitorMenuPose instead. */
  function defaultMenuWorldPos() {
    return spawnPanelWorldPos(-0.38);
  }

  function cadOrStageAnchorForMenu() {
    const mesh = getLiveMesh();
    if (mesh && mesh.visible) {
      try {
        const box = contentBoxFromMesh(mesh);
        if (box && !box.isEmpty()) {
          const c = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          return { center: c, radius: 0.5 * Math.max(size.x, size.z, 0.12) };
        }
      } catch (_) { /* parked CAD — use the cheap in-front stage */ }
    }
    ensureXrHeadPose();
    const f = headForwardFlat(new THREE.Vector3());
    const c = _headPos.clone().addScaledVector(f, PANEL_SPAWN_FWD);
    c.y = _headPos.y - 0.12;
    return { center: c, radius: 0.2 };
  }

  function placeMenuAtDefault(group) {
    if (!group) return;
    ensureHudWorldParent(group);
    ensureXrHeadPose();
    const f = headForwardFlat(new THREE.Vector3());
    const right = headRightFlat();
    const anchor = cadOrStageAnchorForMenu();
    const pose = leftMonitorMenuPose({
      head: { x: _headPos.x, y: _headPos.y, z: _headPos.z },
      forward: { x: f.x, y: f.y, z: f.z },
      right: { x: right.x, y: right.y, z: right.z },
      cadCenter: { x: anchor.center.x, y: anchor.center.y, z: anchor.center.z },
      cadRadius: anchor.radius,
    });
    const pos = new THREE.Vector3(pose.x, pose.y, pose.z);
    setPanelWorldPose(group, pos);
    facePanelTowardHead(group, pos);
    try { group.rotateY(pose.yaw); } catch (_) {}
  }

  function cancelPlaceAfterProjectLoad() {
    placeAfterLoadGen += 1;
    if (placeAfterLoadTimer) {
      clearTimeout(placeAfterLoadTimer);
      placeAfterLoadTimer = 0;
    }
  }

  function stripCadHelpersForXr(root) {
    // Hide only — do NOT dispose geometries mid-XR session (that hard-crashed Quest).
    if (!root) return;
    root.traverse((c) => {
      if (c?.userData?.isSilhouette || c?.userData?.isObjectHighlight) {
        try { c.visible = false; } catch (_) {}
      }
    });
  }

  function beginProjectSwap() {
    cancelGenerationSurfacePick();
    selectedGenerationSurface = null;
    cancelPlaceAfterProjectLoad();
    if (!presenting && !workspaceJoin) {
      // Desktop: never inherit XR hide/park. Swap hide is headset-only.
      const desk = getLiveMesh();
      if (desk) {
        try { desk.visible = true; } catch (_) {}
        const sx = Math.abs(Number(desk.scale?.x) || 0);
        if (sx > 0 && sx < 0.05) {
          try { desk.scale.set(1, 1, 1); } catch (_) {}
        }
        try { desk.updateMatrixWorld?.(true); } catch (_) {}
      }
      try { onPlaceDesktop?.(); } catch (_) {}
      return;
    }
    projectSwapActive = true;
    worldAnchored = false;
    pendingInitialPlace = false;
    sizeRescueAttempts = 0;
    sizeRescueUntil = performance.now() + 4000;
    saved = null;
    try { voiceDraw.clear(); } catch (_) {}
    try {
      if (explorerPanel?.group) explorerPanel.group.visible = false;
      if (aiPanel?.group) aiPanel.group.visible = false;
    } catch (_) {}
    const mesh = getLiveMesh();
    if (mesh) {
      try { mesh.visible = false; } catch (_) {}
    }
    if (shouldParkXrAssemblyAtTinyScale()) {
      try { mesh?.scale?.setScalar?.(1e-6); } catch (_) {}
      try { resetAssemblyXrSafe?.(); } catch (_) {}
    }
  }

  function cancelGenerationSurfacePick() {
    generationSurfacePick?.finish(null);
  }

  function generationSurfaceFromRay(pickRay) {
    const hits = [];
    const visit = (root, onlyTagged = false) => {
      if (!root?.visible) return;
      root.updateWorldMatrix(true, true);
      root.traverse((object) => {
        if (!object.isMesh || !object.visible || (onlyTagged && !object.userData.generationSurface)) return;
        if (object.userData.isSilhouette || object.userData.isObjectHighlight) return;
        for (let parent = object.parent; parent; parent = parent.parent) if (!parent.visible) return;
        // Room furniture disables ordinary picking; explicit face selection opts in.
        THREE.Mesh.prototype.raycast.call(object, pickRay, hits);
      });
    };
    visit(xrWorkshopProjectRoom, true);
    visit(workspaceWorld?.root);
    visit(getLiveMesh());
    const hit = hits.sort((a, b) => a.distance - b.distance).find((row) => row.face?.normal);
    return generationSurfaceFromHit(THREE, hit);
  }

  function requestGenerationSurfacePick() {
    cancelGenerationSurfacePick();
    if (!presenting && !workspaceJoin) return Promise.resolve(null);
    if (isDimosTeleopArmed()) {
      onStatus?.("error", "Disable robot teleoperation before picking a model spawn face.");
      return Promise.resolve(null);
    }
    try { document.exitPointerLock?.(); } catch (_) {}
    const canvas = renderer.domElement;
    const project = String(getProjectId?.() || "");
    return new Promise((resolve) => {
      const finish = (surface) => {
        if (generationSurfacePick?.finish !== finish) return;
        clearTimeout(timeout);
        canvas.removeEventListener("pointerdown", pointer, true);
        canvas.removeEventListener("click", stopClick, true);
        document.removeEventListener("keydown", keydown, true);
        generationSurfacePick = null;
        if (String(getProjectId?.() || "") !== project) surface = null;
        if (surface) selectedGenerationSurface = surface;
        resolve(surface);
      };
      const stopClick = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
      const pointer = (event) => {
        if (event.button !== 0 || presenting) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const rect = canvas.getBoundingClientRect();
        const ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), camera);
        const surface = generationSurfaceFromRay(ray);
        if (surface) finish(surface);
        else onStatus?.("ok", "No surface hit. Select a table or model face, or press Escape to cancel.");
      };
      const keydown = (event) => { if (event.key === "Escape") { event.stopImmediatePropagation(); finish(null); } };
      const timeout = setTimeout(() => finish(null), 60_000);
      generationSurfacePick = { finish };
      canvas.addEventListener("pointerdown", pointer, true);
      canvas.addEventListener("click", stopClick, true);
      document.addEventListener("keydown", keydown, true);
      onStatus?.("ok", "Point and select a table or model face. Escape cancels surface picking.");
    });
  }

  function placeModelOnWorkshopTable(mesh) {
    if (!mesh || !usesWorkshopGenerationPlacement({ presenting, workspaceJoin, sceneKind: xrSceneKind })) return false;
    try {
      if (!saved || saved.mesh !== mesh) {
        saved = {
          mesh,
          pos: mesh.position.clone(),
          quat: mesh.quaternion.clone(),
          scale: mesh.scale.clone(),
          visible: mesh.visible,
        };
      }
      mesh.visible = true;
      if (isCanonicalWorkshopConfig(workshopConfig) && !mesh.userData.xrCanonicalWorkshopYaw) {
        mesh.rotateY(xrWorkshopProjectRoom?.userData?.workshopCadYaw || 0);
        mesh.userData.xrCanonicalWorkshopYaw = true;
      }
      const placed = applyGenerationPlacement(THREE, mesh, {
        placement: workshopConfig?.generationPlacement,
        sceneBounds: workshopConfig?.manifest?.bounds,
      });
      if (!placed) {
        onStatus?.("error", "New model placement is outside the scene. Choose another spawn surface or reduce its size.");
        return false;
      }
      worldAnchored = true;
      mesh.userData.xrWorkshopTablePreview = true;
      menuFooterHint = "AI render placed at the saved Workshop spawn surface";
      return true;
    } catch (err) {
      console.warn("[viewport-xr] workshop table placement", err);
      return false;
    }
  }

  function placeAfterProjectLoad({ attempts = 3, delayMs = 100 } = {}) {
    cancelPlaceAfterProjectLoad();
    worldAnchored = false;
    sizeRescueUntil = performance.now() + 4000;
    const gen = placeAfterLoadGen;
    let left = Math.max(1, attempts | 0);
    return new Promise((resolve) => {
      const finish = (ok) => {
        if (gen !== placeAfterLoadGen) return;
        if (ok && presenting) {
          bootEnter.emptyScene = false;
          bootEnter.projectId = String(getProjectId?.() || bootEnter.projectId || "");
          projectSwapActive = false;
        }
        resolve(!!ok);
      };
      const tryPlace = () => {
        placeAfterLoadTimer = 0;
        if (gen !== placeAfterLoadGen) {
          finish(false);
          return;
        }
        if (!presenting && !workspaceJoin) {
          const deskMesh = getLiveMesh();
          if (deskMesh) {
            let desk = false;
            try { desk = !!onPlaceDesktop?.(); } catch (_) { desk = false; }
            if (desk) {
              projectSwapActive = false;
              finish(true);
              return;
            }
          }
          left -= 1;
          if (left > 0 && gen === placeAfterLoadGen) {
            placeAfterLoadTimer = setTimeout(tryPlace, delayMs);
          } else {
            finish(false);
          }
          return;
        }
        const mesh = getLiveMesh();
        if (mesh) {
          let ok = false;
          try {
            ok = xrSceneKind === "workshop" ? placeModelOnWorkshopTable(mesh) : placeInFront({
              spawnId: "eye",
              keepZoom: false,
              recaptureDesktop: true,
              force: true,
            });
          } catch (err) {
            console.warn("[viewport-xr] placeAfterProjectLoad", err);
            ok = false;
          }
          if (ok) {
            projectSwapActive = false;
            try { showLayoutGalleryOnProjectEnter(); } catch (_) {}
            try { onPublishSceneMeshes?.(); } catch (_) {}
            finish(true);
            return;
          }
        }
        left -= 1;
        if (left > 0 && gen === placeAfterLoadGen && (presenting || workspaceJoin)) {
          placeAfterLoadTimer = setTimeout(tryPlace, delayMs);
        } else {
          if (xrSceneKind === "workshop") { finish(false); return; }
          // Last resort: don't leave the room blank — show a small mesh in front of the user.
          const fallbackMesh = getLiveMesh();
          if (fallbackMesh) {
            let forced = false;
            try {
              forced = placeInFront({
                spawnId: "eye",
                keepZoom: false,
                recaptureDesktop: true,
                force: true,
              });
            } catch (_) {
              forced = false;
            }
            if (forced) {
              menuFooterHint = "Project placed — pinch dock · Projects to switch";
              try { showLayoutGalleryOnProjectEnter(); } catch (_) {}
              finish(true);
              return;
            }
            try {
              fallbackMesh.visible = true;
              fallbackMesh.scale.setScalar(0.15);
              fallbackMesh.position.set(0, 1.3, -0.9);
              fallbackMesh.updateMatrixWorld(true);
              menuFooterHint = "Place failed — mesh shown small; use Grab / Scale";
            } catch (_) {}
          }
          finish(false);
        }
      };
      placeAfterLoadTimer = setTimeout(tryPlace, 80);
    });
  }

  function invalidateSavedDesktop() {
    saved = null;
    worldAnchored = false;
  }


  /**
   * Always put the CAD assembly directly in front of the headset at ~15 cm.
   * After the first successful place, the pose stays world-anchored unless opts.force.
   */
  function placeInFront(opts = {}) {
    const mesh = opts.mesh || getLiveMesh();
    if (!mesh) {
      console.warn("[viewport-xr] No CAD model loaded — load a model before entering AR");
      return false;
    }
    if (!presenting) {
      try { return !!onPlaceDesktop?.(); } catch (_) { return false; }
    }
    const isDrop = !!mesh.userData?.xrDropId;

    if ((worldAnchored && presenting && !opts.force) || (captureRecState?.recording && !opts.force)) {
      const sx = Math.abs(Number(mesh.scale?.x) || 0);
      // After a mid-XR load the mesh is hidden — must re-place, not early-return.
      if (mesh.visible && sx >= 1e-4) {
        try { prepareMeshesForXr(mesh); } catch (err) {
          console.warn("[viewport-xr] prepareMeshesForXr", err);
        }
        try { mesh.visible = true; } catch (_) {}
        return true;
      }
    }

    try {
    if (!isDrop && (!saved || saved.mesh !== mesh || opts.recaptureDesktop)) {
      saved = null;
      const sx = Math.abs(Number(mesh.scale?.x) || 0);
      if (sx > 0 && sx < 1e-4) {
        saved = {
          mesh,
          pos: new THREE.Vector3(),
          quat: new THREE.Quaternion(),
          scale: new THREE.Vector3(1, 1, 1),
          visible: true,
          parent: mesh.parent,
        };
      } else {
        captureDesktop(mesh);
      }
    }
    cachePresentationBounds(mesh);
    try { prepareMeshesForXr(mesh); } catch (err) {
      console.warn("[viewport-xr] prepareMeshesForXr", err);
    }

    const spawnId = opts.spawnId || activeSpawnId || "eye";
    const preset = SPAWN_PRESETS.find((p) => p.id === spawnId) || SPAWN_PRESETS[0];
    activeSpawnId = preset.id;
    if (!opts.keepZoom) userZoom = 1;

    const marker = mesh.getObjectByName("xrModelMarker");
    if (marker) marker.visible = false;

    // NEVER write scale=1 into a live Quest session — that is the hard crash.
    // One world AABB after pose. No second full traverse / updateMatrixWorld.
    const curScale = Math.max(Math.abs(Number(mesh.scale?.x) || 0), 1e-12);
    const store = typeof localStorage !== "undefined" ? localStorage : null;
    const lastComfort = readXrComfortSizeM(store, HANDHELD_SIZE_M);
    const wantM = xrSpawnTargetM({
      lastSizeM: lastComfort,
      presetSizeM: preset.sizeM,
      handheld: HANDHELD_SIZE_M,
    });
    const targetM = THREE.MathUtils.clamp(wantM, ROOM_SIZE_MIN_M, ROOM_SIZE_MAX_M);

    const poseOk = getHeadPose();
    if (!poseOk || (presenting && !isReasonableXrHead())) {
      _headPos.set(0, 1.55, 0);
      if (_headQuat.lengthSq() < 0.5) _headQuat.identity();
    }
    let forward = headForwardFlat();
    if (forward.lengthSq() < 0.5) forward.set(0, 0, -1);

    const dist = readXrComfortDistM(store, Number(preset.distance) > 0 ? preset.distance : 0.55);
    const spawnAt = xrSpawnInFrontOfHead({ head: _headPos, forward, distance: dist });
    const target = new THREE.Vector3(spawnAt.x, spawnAt.y, spawnAt.z);
    if (preset.yMode === "floor") target.y = Math.max(0.1, targetM * 0.45);
    else target.y = _headPos.y - 0.20;

    const zUpToYUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const toUser = forward.clone().multiplyScalar(-1);
    toUser.y = 0;
    if (toUser.lengthSq() < 1e-6) toUser.set(0, 0, 1);
    else toUser.normalize();
    const face = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), toUser);
    const worldQuat = face.clone().multiply(zUpToYUp);

    const parent = mesh.parent;
    mesh.position.set(0, 0, 0);
    if (parent) {
      parent.updateMatrixWorld(true);
      const pwq = parent.getWorldQuaternion(new THREE.Quaternion());
      mesh.quaternion.copy(pwq.clone().invert().multiply(worldQuat));
    } else {
      mesh.quaternion.copy(worldQuat);
    }
    mesh.updateMatrixWorld(true);

    let box = contentBoxFromMesh(mesh, { force: false, skipMatrix: true, firstPlace: true });
    let worldMax = box.isEmpty() ? 0 : Math.max(box.getSize(_placeSize).x, _placeSize.y, _placeSize.z, 0);
    const maxDim = Math.max(worldMax > 1e-8 ? worldMax / curScale : 0, 1e-4);
    let mmPer = 1;
    try {
      const fromApp = typeof getMmPerUnit === "function" ? Number(getMmPerUnit()) : NaN;
      mmPer = Number.isFinite(fromApp) && fromApp > 0 ? fromApp : (maxDim >= 1.0 ? 1 : 1000);
    } catch {
      mmPer = maxDim >= 1.0 ? 1 : 1000;
    }
    xrMmPerUnit = mmPer;
    let factor = THREE.MathUtils.clamp(targetM / maxDim, 1e-8, 50);
    const alreadyHandheld = shouldSkipXrScaleBake({ worldMax, targetM, minRatio: 0.999, maxRatio: 1.001 });
    if (!alreadyHandheld) {
      if (Number.isFinite(worldMax) && worldMax > 0) {
        mesh.scale.multiplyScalar(targetM / worldMax);
        factor = Math.abs(mesh.scale.x) || factor;
      } else {
        mesh.scale.setScalar(factor);
      }
      mesh.updateMatrixWorld(true);
      box = contentBoxFromMesh(mesh, { force: false, skipMatrix: true, firstPlace: true });
      worldMax = box.isEmpty() ? 0 : Math.max(box.getSize(_placeSize).x, _placeSize.y, _placeSize.z, 0);
    }

    const moveCenterTo = (want) => {
      box.getCenter(_placeCenter);
      _placeDelta.copy(want).sub(_placeCenter);
      if (parent) {
        const wp = mesh.getWorldPosition(_placeCenter).add(_placeDelta);
        mesh.position.copy(parent.worldToLocal(wp));
      } else {
        mesh.position.add(_placeDelta);
      }
      mesh.updateMatrixWorld(true);
      _meshBox.translate(_placeDelta);
      box = _meshBox;
    };
    moveCenterTo(target);

    presentationScale = Math.abs(mesh.scale.x) || factor;
    baseScale = presentationScale / Math.max(userZoom, 1e-6);

    if (!shouldSkipXrScaleBake({ worldMax, targetM })) {
      enforceHandheldSize(mesh, targetM, {
        pinFront: true,
        distance: dist,
        floor: preset.yMode === "floor",
        skipMatrix: true,
      });
    }

    if (marker) marker.visible = false;
    const mk = mesh.getObjectByName("xrModelMarker");
    if (mk) {
      mk.userData.xrIgnoreBounds = true;
      mk.visible = false;
    }

    const finalSize = contentBoxFromMesh(mesh, { firstPlace: true }).getSize(_placeSize);
    const finalMax = Math.max(...finalSize.toArray(), 0);
    if (!Number.isFinite(finalMax) || finalMax <= 0 || !Number.isFinite(mesh.scale.x) || mesh.scale.x <= 0) {
      console.warn("[viewport-xr] invalid place result — showing a small fallback in front");
      try {
        mesh.scale.setScalar(0.12);
        const fallback = xrSpawnInFrontOfHead({ head: _headPos, forward, distance: dist });
        mesh.position.set(fallback.x, fallback.y, fallback.z);
        mesh.updateMatrixWorld(true);
        mesh.visible = true;
      } catch (_) {}
      worldAnchored = true;
      pendingInitialPlace = false;
      return false;
    }
    try {
      writeXrComfortSizeM(store, finalMax);
      writeXrComfortDistM(store, dist);
    } catch (_) {}

    if (!isDrop) {
      worldAnchored = true;
      saveRoomPose();
    } else {
      noteDropInteract(mesh);
      sendDropTransform(mesh, false);
    }
    projectSwapActive = false;
    showBeacon(contentBoxFromMesh(mesh).getCenter(new THREE.Vector3()));
    try { mesh.visible = true; } catch (_) {}
    return true;
    } catch (err) {
      console.warn("[viewport-xr] placeInFront failed", err);
      try {
        getHeadPose();
        mesh.scale.setScalar(0.12);
        const fallback = xrSpawnInFrontOfHead({ head: _headPos, forward: headForwardFlat(), distance: 0.55 });
        mesh.position.set(fallback.x, fallback.y, fallback.z);
        mesh.updateMatrixWorld(true);
        mesh.visible = true;
      } catch (_) {}
      worldAnchored = true;
      pendingInitialPlace = false;
      return false;
    }
  }

  function enforceHandheldSize(mesh, targetMax = HANDHELD_SIZE_M, pin = {}) {
    if (pin.skipMatrix !== true) mesh.updateMatrixWorld(true);
    const marker = mesh.getObjectByName("xrModelMarker");
    if (marker) marker.visible = false;
    let box = contentBoxFromMesh(mesh, { force: pin.skipMatrix !== true && pin.forceBox === true });
    if (box.isEmpty()) return;
    const size = box.getSize(_placeSize);
    const maxD = Math.max(size.x, size.y, size.z);
    if (!(maxD > 1e-8)) return;
    if (shouldSkipXrScaleBake({ worldMax: maxD, targetM: targetMax })) {
      if (pin.pinFront === false) return;
    }
    const factor = targetMax / maxD;
    const parent = mesh.parent;
    if (
      !shouldSkipXrScaleBake({ worldMax: maxD, targetM: targetMax })
      && Number.isFinite(factor)
      && factor > 0
      && (factor < 0.97 || factor > 1.03)
    ) {
      mesh.scale.multiplyScalar(factor);
      presentationScale = Math.abs(mesh.scale.x) || presentationScale * factor;
      baseScale = presentationScale / Math.max(userZoom, 1e-6);
      mesh.updateMatrixWorld(true);
      box = contentBoxFromMesh(mesh, { force: false, skipMatrix: true, firstPlace: true });
    }
    if (pin.pinFront === false) return;
    getHeadPose();
    const f = headForwardFlat();
    const dist = pin.distance || 0.45;
    const want = _headPos.clone().addScaledVector(f, dist);
    if (pin.floor) want.y = Math.max(0.08, targetMax * 0.45);
    else want.y = _headPos.y - 0.20;
    const c2 = box.getCenter(new THREE.Vector3());
    const dlt = want.sub(c2);
    if (parent) {
      const worldPos = mesh.getWorldPosition(new THREE.Vector3()).add(dlt);
      mesh.position.copy(parent.worldToLocal(worldPos));
    } else {
      mesh.position.add(dlt);
    }
    mesh.updateMatrixWorld(true);
  }

  function applySavedPose() {
    const mesh = getLiveMesh();
    const data = loadRoomPose();
    if (!mesh || !data?.position) return placeInFront({ spawnId: "eye" });
    captureDesktop(mesh);
    try { prepareMeshesForXr(mesh); } catch (err) {
      console.warn("[viewport-xr] prepareMeshesForXr", err);
    }
    mesh.position.fromArray(data.position);
    mesh.quaternion.fromArray(data.quaternion);
    mesh.scale.fromArray(data.scale);
    userZoom = data.userZoom || 1;
    activeSpawnId = data.activeSpawnId || "eye";
    presentationScale = mesh.scale.x || 1;
    baseScale = presentationScale / Math.max(userZoom, 1e-6);
    mesh.updateMatrixWorld(true);
    const box = contentBoxFromMesh(mesh);
    const worldMax = Math.max(...box.getSize(new THREE.Vector3()).toArray(), 0);
    const center = box.getCenter(new THREE.Vector3());
    ensureXrHeadPose();
    const skyHigh = center.y > _headPos.y + 0.9 || center.y < _headPos.y - 1.6;
    if (!(worldMax > ROOM_SIZE_MIN_M * 0.5 && worldMax < ROOM_SIZE_MAX_M * 1.35) || skyHigh) {
      return placeInFront({ spawnId: "eye", keepZoom: false, recaptureDesktop: true });
    }
    mesh.visible = true;
    if (shouldMarkCadWorldAnchored({ restored: true })) worldAnchored = true;
    showBeacon(contentBoxFromMesh(mesh).getCenter(new THREE.Vector3()));
    return true;
  }

  function restoreRoomPoseAfterCadEdit() {
    if (!presenting) return false;
    const mesh = getLiveMesh();
    const data = loadRoomPose();
    if (!mesh || !data?.position) return false;
    mesh.position.fromArray(data.position);
    mesh.quaternion.fromArray(data.quaternion);
    mesh.scale.fromArray(data.scale);
    userZoom = data.userZoom || userZoom;
    presentationScale = Math.abs(mesh.scale.x) || presentationScale;
    baseScale = presentationScale / Math.max(userZoom, 1e-6);
    mesh.visible = true;
    mesh.updateMatrixWorld(true);
    return true;
  }

  function showBeacon(_worldPos) {
    // Placement ring used to sit under the model as a bright blue circle.
    if (beacon) beacon.visible = false;
  }

  function applyZoom(factor) {
    const mesh = getLiveMesh();
    if (!mesh || !presenting) return;
    userZoom = THREE.MathUtils.clamp(userZoom * factor, 0.35, 1.8);
    const next = baseScale * userZoom;
    const ratio = next / Math.max(presentationScale, 1e-9);
    presentationScale = next;
    mesh.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
    // Scale about center in parent space
    const localCenter = mesh.parent
      ? mesh.parent.worldToLocal(center.clone())
      : center.clone();
    mesh.scale.multiplyScalar(ratio);
    mesh.position.sub(localCenter).multiplyScalar(ratio).add(localCenter);
    mesh.updateMatrixWorld(true);
    saveRoomPose();
  }

  function showToolWheelInFront() {
    if (wheelDismissedThisHold) return;
    getHeadPose();
    const f = headForwardFlat();
    toolWheel.placeInFront(_headPos, f, _headPos.y);
    toolWheel.setColorSelected(`#${drawColor.toString(16).padStart(6, "0")}`);
    try { toolWheel.setActive?.(activeTool); } catch (_) {}
    try { toolWheel.setSnapOn?.(!!xrBuild.snapEnabled?.()); } catch (_) {}
    try { dockPalette.setActive?.("wheel"); } catch (_) {}
  }

  function hideToolWheel({ force = false } = {}) {
    if (!force && wristPinned) return;
    toolWheel.setVisible(false);
  }

  function dismissToolWheelAfterSelect() {
    wheelDismissedThisHold = true;
    wristPinned = false;
    wristMenuLatched = false;
    toolWheel.setVisible(false);
  }

  function toggleToolWheel() {
    if (toolWheel.isVisible()) {
      wristPinned = false;
      wristMenuLatched = false;
      wheelDismissedThisHold = true;
      toolWheel.setVisible(false);
    } else {
      wristPinned = false;
      wristMenuLatched = false;
      wheelDismissedThisHold = false;
      showToolWheelInFront();
    }
    syncDock();
  }

  function applyDrawColor(color) {
    let n = color;
    if (typeof color === "string") {
      n = parseInt(String(color).replace("#", ""), 16);
    }
    if (!Number.isFinite(n)) return;
    drawColor = n;
    try { voiceDraw.setColor?.(drawColor); } catch (_) {}
    try { toolWheel.setColorSelected?.(`#${drawColor.toString(16).padStart(6, "0")}`); } catch (_) {}
    paintDrawPencils();
    try { drawHud.setColor?.(drawColor); } catch (_) {}
    try { toolHand.setColor?.(drawColor); } catch (_) {}
    if (drawPanel?.group?.visible) refreshGridPopupSoon("draw");
  }

  function setDrawSize(id) {
    drawSizeId = id === "draw_size_s" || id === "draw_size_l" ? id : "draw_size_m";
    const radius = drawSizeId === "draw_size_s" ? 0.005 : drawSizeId === "draw_size_l" ? 0.018 : 0.009;
    try { voiceDraw.setRadius?.(radius); } catch (_) {}
    paintDrawPencils();
    try { toolHand.setSizeId?.(drawSizeId); } catch (_) {}
  }

  function setDrawEraser(on) {
    drawEraserOn = !!on;
    try { voiceDraw.setEraser?.(drawEraserOn); } catch (_) {}
    paintDrawPencils();
  }

  function setCollabSpace(mode) {
    collabSpace = writeXrCollabSpace(mode);
    menuFooterHint = collabSpace === "local"
      ? "My copy — others see a ghost of what you hold"
      : "Shared — everyone sees the same pose and size";
    try { onStatus?.("ok", menuFooterHint); } catch (_) {}
  }

  function localAuthor() {
    const me = readSocialState()?.me;
    return {
      id: String((typeof getLocalUserId === "function" && getLocalUserId()) || me?.id || ""),
      name: String(me?.display_name || "You"),
    };
  }

  function xrBodyId(mesh) {
    if (!mesh) return "";
    const u = mesh.userData || {};
    return String(u.xrDrawId || u.catalogName || u.catalogFilename || mesh.name || mesh.uuid || "");
  }

  function highlightGroupMesh(mesh, on) {
    if (!mesh) return;
    mesh.traverse?.((n) => {
      if (!n.isMesh || !n.material) return;
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      for (const mat of mats) {
        if (!mat) continue;
        if (on) {
          if (mat.userData?.xrGroupSaved) continue;
          mat.userData = mat.userData || {};
          mat.userData.xrGroupSaved = {
            transparent: mat.transparent,
            opacity: mat.opacity,
            depthWrite: mat.depthWrite,
          };
          mat.transparent = true;
          mat.opacity = 0.45;
          mat.depthWrite = false;
          mat.needsUpdate = true;
        } else if (mat.userData?.xrGroupSaved) {
          const s = mat.userData.xrGroupSaved;
          mat.transparent = s.transparent;
          mat.opacity = s.opacity;
          mat.depthWrite = s.depthWrite;
          delete mat.userData.xrGroupSaved;
          mat.needsUpdate = true;
        }
      }
    });
  }

  function clearGroupPaint({ keepHighlight = false } = {}) {
    const selected = groupPaint?.selected;
    if (!keepHighlight && selected) {
      for (const mesh of selected.values()) highlightGroupMesh(mesh, false);
    }
    groupPaint = null;
  }

  function sampleGroupSelect(pointer) {
    if (activeTool !== "group_select" || !pointer) return false;
    if (!groupPaint) groupPaint = { selected: new Map() };
    let mesh = null;
    try { mesh = pickGrabMesh(pointer); } catch { mesh = null; }
    if (!mesh) {
      try { mesh = nearestDrawable(worldPosOf(pointer), 0.12); } catch { mesh = null; }
    }
    if (!mesh) return true;
    const id = xrBodyId(mesh);
    if (!id || groupPaint.selected.has(id)) return true;
    groupPaint.selected.set(id, mesh);
    highlightGroupMesh(mesh, true);
    return true;
  }

  function finishGroupSelect() {
    const ids = [...(groupPaint?.selected?.keys?.() || [])];
    if (!ids.length) {
      clearGroupPaint();
      return;
    }
    groupNameDraft = "VR Group";
    openGroupNamePanel({ forcePlace: true });
  }

  const GROUP_NAME_CANVAS = { w: 640, h: 360 };
  const GROUP_NAME_PLANE = { w: 0.36, h: 0.2 };

  function drawGroupNameCanvas() {
    const canvas = document.createElement("canvas");
    canvas.width = GROUP_NAME_CANVAS.w;
    canvas.height = GROUP_NAME_CANVAS.h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 28px Arial,sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("Group as component", 28, 48);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "20px Arial,sans-serif";
    ctx.fillText("Default name — confirm or talk to rename", 28, 82);
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(28, 110, 584, 64);
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 3;
    ctx.strokeRect(28, 110, 584, 64);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 26px Arial,sans-serif";
    ctx.fillText(String(groupNameDraft || "VR Group").slice(0, 32), 44, 152);
    const listening = !!(typeof isTranscribing === "function" && isTranscribing());
    ctx.fillStyle = listening ? "#ef4444" : "#22c55e";
    ctx.fillRect(28, 200, 180, 64);
    ctx.fillStyle = "#052e16";
    ctx.font = "bold 22px Arial,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(listening ? "Stop mic" : "Mic", 118, 240);
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(228, 200, 180, 64);
    ctx.fillStyle = "#052e16";
    ctx.fillText("Confirm", 318, 240);
    ctx.fillStyle = "#334155";
    ctx.fillRect(428, 200, 184, 64);
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText("Cancel", 520, 240);
    ctx.fillStyle = "#64748b";
    ctx.font = "18px Arial,sans-serif";
    ctx.fillText(`${groupPaint?.selected?.size || 0} bodies selected`, 320, 300);
    return canvas;
  }

  function refreshGroupNamePanel() {
    if (!groupNamePanel?.group?.visible) return;
    if (typeof isTranscribing === "function" && isTranscribing()) {
      try {
        const live = String(getAiPromptState?.()?.draft || "");
        if (live && live !== groupNameMicBase) {
          const extra = groupNameMicBase && live.startsWith(groupNameMicBase)
            ? live.slice(groupNameMicBase.length)
            : live;
          const bit = extra.trim() || live.trim();
          if (bit) groupNameDraft = bit.slice(-48).trim() || "VR Group";
        }
      } catch { /* ignore */ }
    }
    const canvas = drawGroupNameCanvas();
    groupNamePanel.tex.image = canvas;
    groupNamePanel.tex.needsUpdate = true;
  }

  function ensureGroupNamePanel() {
    if (groupNamePanel) return groupNamePanel;
    const canvas = drawGroupNameCanvas();
    const tex = sharpenCanvasTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUP_NAME_PLANE.w, GROUP_NAME_PLANE.h),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    plane.renderOrder = 2080;
    plane.frustumCulled = false;
    plane.userData.xrGroupNamePanel = true;
    groupNamePanel = { group: new THREE.Group(), plane, tex };
    groupNamePanel.group.add(plane);
    groupNamePanel.group.visible = false;
    markWorldUi(groupNamePanel.group);
    xrHud.add(groupNamePanel.group);
    return groupNamePanel;
  }

  function openGroupNamePanel(opts = {}) {
    const panel = ensureGroupNamePanel();
    refreshGroupNamePanel();
    panel.group.visible = true;
    ensureHudWorldParent(panel.group);
    if (!opts.forcePlace && panel.worldPlaced && panelWorldPosIsUsable(panel.group)) return;
    const pos = spawnPanelWorldPos(0, -0.04);
    setPanelWorldPose(panel.group, pos);
    facePanelTowardHead(panel.group, pos);
    panel.worldPlaced = true;
  }

  function closeGroupNamePanel() {
    if (groupNamePanel) groupNamePanel.group.visible = false;
    clearGroupPaint();
  }

  function pickGroupNameFromLocal(local) {
    const halfW = GROUP_NAME_PLANE.w / 2;
    const halfH = GROUP_NAME_PLANE.h / 2;
    const u = (local.x + halfW) / GROUP_NAME_PLANE.w;
    const fromTop = (halfH - local.y) / GROUP_NAME_PLANE.h;
    if (u < 0 || u > 1 || fromTop < 0 || fromTop > 1) return null;
    const px = u * GROUP_NAME_CANVAS.w;
    const py = fromTop * GROUP_NAME_CANVAS.h;
    if (py >= 200 && py <= 264) {
      if (px >= 28 && px <= 208) return { kind: "group-action", id: "mic" };
      if (px >= 228 && px <= 408) return { kind: "group-action", id: "confirm" };
      if (px >= 428 && px <= 612) return { kind: "group-action", id: "cancel" };
    }
    return { kind: "group-chrome" };
  }

  async function handleGroupNameAction(id) {
    if (id === "cancel") {
      closeGroupNamePanel();
      return;
    }
    if (id === "mic") {
      groupNameMicBase = "";
      try { groupNameMicBase = String(getAiPromptState?.()?.draft || ""); } catch { groupNameMicBase = ""; }
      try { onTranscribeToggle?.(); } catch (_) {}
      refreshGroupNamePanel();
      return;
    }
    if (id === "confirm") {
      const ids = [...(groupPaint?.selected?.keys?.() || [])];
      const name = String(groupNameDraft || "VR Group").trim() || "VR Group";
      try { await onGroupXrBodies?.({ ids, name }); } catch (err) {
        console.warn("[viewport-xr] group bodies", err);
      }
      menuFooterHint = `Grouped ${ids.length} bodies as ${name}`;
      closeGroupNamePanel();
      try { openMenuConsole({ tab: "parts", keepPose: true }); } catch (_) {}
    }
  }

  function ensureDrawPencils() {
    if (drawPencils.length) return;
    for (let i = 0; i < 2; i += 1) {
      const toolTip = createXrToolTip(THREE);
      toolTip.group.userData.updateTool = toolTip.update;
      drawPencils.push(toolTip.group);
      (controllers[i] || xrHud).add(toolTip.group);
    }
  }

  function paintDrawPencils() {
    for (const tip of drawPencils) tip.userData.updateTool?.({
      tool: activeTool, brush: drawBrush, color: drawColor, size: drawSizeId, eraser: drawEraserOn,
    });
  }

  function updateDrawPencils() {
    ensureDrawPencils();
    const sig = `${activeTool}|${drawBrush}|${drawColor}|${drawSizeId}|${drawEraserOn}`;
    if (sig !== lastDrawPencilSig) {
      lastDrawPencilSig = sig;
      paintDrawPencils();
    }
    const drawHand = xrDrawHand(preferredDockHand);
    for (let i = 0; i < 2; i += 1) {
      const tip = drawPencils[i];
      const host = posedControllerForHand(i);
      if (host && tip.parent !== host) host.add(tip);
      const hand = sourceHandedness(host?.userData?.inputSource) || (i === 0 ? "left" : "right");
      tip.visible = presenting && !!host && objectIsPosed(host) && hand === drawHand
        && (activeTool === "draw" || String(activeTool).startsWith("create_"));
    }
  }

  function allDrawables() {
    const out = [];
    try { out.push(...(voiceDraw.listDrawables?.() || [])); } catch { /* ignore */ }
    try { out.push(...(xrSolidDraw.listDrawables?.() || [])); } catch { /* ignore */ }
    try { out.push(...(xrBuild.listDrawables?.() || [])); } catch { /* ignore */ }
    return out;
  }

  function findDrawableRoot(obj) {
    let o = obj;
    while (o) {
      if (o.userData?.xrDrawable || o.userData?.xrDrawSolid || o.userData?.xrBuild) return o;
      o = o.parent;
    }
    return null;
  }

  function nearestDrawable(origin, maxDist = 0.28) {
    if (!origin) return null;
    let best = null;
    let bestD = maxDist;
    for (const mesh of allDrawables()) {
      if (!mesh || skipXrInstancedPick(mesh)) continue;
      let d = maxDist + 1;
      try {
        mesh.updateMatrixWorld?.(true);
        const geo = mesh.geometry;
        if (geo?.boundingBox) {
          _meshBoxScratch.copy(geo.boundingBox).applyMatrix4(mesh.matrixWorld);
        } else if (geo) {
          try { geo.computeBoundingBox(); } catch { /* ignore */ }
          if (geo.boundingBox) _meshBoxScratch.copy(geo.boundingBox).applyMatrix4(mesh.matrixWorld);
          else _meshBoxScratch.setFromObject(mesh);
        } else {
          _meshBoxScratch.setFromObject(mesh);
        }
        d = _meshBoxScratch.isEmpty()
          ? origin.distanceTo(mesh.getWorldPosition(_v))
          : _meshBoxScratch.distanceToPoint(origin);
      } catch { continue; }
      if (d < bestD) {
        best = mesh;
        bestD = d;
      }
    }
    return best;
  }

  function packMeshPose(mesh) {
    if (!mesh) return null;
    mesh.updateMatrixWorld(true);
    mesh.matrixWorld.decompose(_v, _q, _s);
    return {
      p: [round3(_v.x), round3(_v.y), round3(_v.z)],
      q: [round3(_q.x), round3(_q.y), round3(_q.z), round3(_q.w)],
      s: [round3(_s.x), round3(_s.y), round3(_s.z)],
    };
  }

  function applyPackedPose(mesh, pose) {
    if (!mesh || !pose) return;
    const p = pose.p || pose.position;
    const q = pose.q || pose.quaternion;
    const s = pose.s || pose.scale;
    _posePos.set(0, 0, 0);
    _poseQuat.set(0, 0, 0, 1);
    _poseScl.set(1, 1, 1);
    if (Array.isArray(p) && p.length >= 3) _posePos.set(Number(p[0]), Number(p[1]), Number(p[2]));
    if (Array.isArray(q) && q.length >= 4) _poseQuat.set(Number(q[0]), Number(q[1]), Number(q[2]), Number(q[3]));
    if (Array.isArray(s) && s.length >= 3) _poseScl.set(Number(s[0]) || 1, Number(s[1]) || 1, Number(s[2]) || 1);
    _poseWorld.compose(_posePos, _poseQuat, _poseScl);
    if (mesh.parent) {
      _poseInv.copy(mesh.parent.matrixWorld).invert();
      _poseLocal.multiplyMatrices(_poseInv, _poseWorld).decompose(mesh.position, mesh.quaternion, mesh.scale);
    } else {
      mesh.position.copy(_posePos);
      mesh.quaternion.copy(_poseQuat);
      mesh.scale.copy(_poseScl);
    }
    mesh.updateMatrixWorld(true);
  }

  function applyRemoteDrawMessage(msg) {
    if (!msg) return;
    const author = {
      authorId: msg.author_id || msg.user_id || "",
      authorName: msg.author_name || msg.display_name || "",
      createdAt: Number(msg.created_at || msg.createdAt || Date.now()) || Date.now(),
    };
    if (msg.action === "solid" || (msg.kind && msg.sizeM && !msg.action)) {
      const wp = msg.worldPosition || msg.world_position;
      const pos = Array.isArray(wp)
        ? new THREE.Vector3(Number(wp[0]), Number(wp[1]), Number(wp[2]))
        : wp?.isVector3
          ? wp
          : null;
      if (pos && !xrSolidDraw.findDrawable?.(msg.draw_id || msg.drawId)) {
        xrSolidDraw.spawnCommitted({
          kind: msg.kind,
          sizeM: msg.sizeM || msg.size_m,
          worldPosition: pos,
          color: msg.color,
          drawId: msg.draw_id || msg.drawId,
          ...author,
        }, author);
      }
    }
    const drawId = msg.draw_id || msg.drawId;
    const pose = msg.pose;
    if (!drawId || !pose) return;
    const mesh = voiceDraw.findDrawable?.(drawId) || xrSolidDraw.findDrawable?.(drawId);
    if (mesh && mesh !== gripGrab?.target && mesh !== grabState?.target) {
      applyPackedPose(mesh, pose);
    }
  }

  function sendDrawPose(mesh, grabbing) {
    const drawId = mesh?.userData?.xrDrawId;
    if (!drawId) return;
    const pose = packMeshPose(mesh);
    if (!pose) return;
    const author = localAuthor();
    const payload = {
      type: "xr.draw",
      action: "pose",
      draw_id: drawId,
      pose,
      grabbing: !!grabbing,
      author_id: mesh.userData.xrAuthorId || author.id,
      author_name: mesh.userData.xrAuthorName || author.name,
    };
    try { sendCollab?.(payload); } catch { /* ignore */ }
    try { sendPublicXr?.(payload); } catch { /* ignore */ }
  }

  function ensureDrawAuthorLabel() {
    if (drawAuthorLabel) return drawAuthorLabel;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 40;
    const tex = new THREE.CanvasTexture(canvas);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.12, 0.022),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.renderOrder = 2600;
    mesh.visible = false;
    mesh.userData.canvas = canvas;
    mesh.userData.tex = tex;
    scene.add(mesh);
    drawAuthorLabel = mesh;
    return mesh;
  }

  function updateDrawAuthorLabel(target) {
    const label = ensureDrawAuthorLabel();
    const author = authorFromUserData(target);
    const me = localAuthor();
    if (!target?.userData?.xrDrawable || !shouldShowAuthorChip({ authorId: author.id, localId: me.id })) {
      label.visible = false;
      return;
    }
    const chip = formatAuthorChip({ name: author.name, at: author.at });
    const canvas = label.userData.canvas;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(15,23,42,0.55)";
    ctx.beginPath();
    ctx.roundRect?.(6, 8, canvas.width - 12, 24, 10);
    if (!ctx.roundRect) ctx.fillRect(6, 8, canvas.width - 12, 24);
    else ctx.fill();
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "600 16px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(chip.slice(0, 22), canvas.width / 2, canvas.height / 2);
    label.userData.tex.needsUpdate = true;
    const pos = new THREE.Vector3();
    try { target.getWorldPosition(pos); } catch { pos.copy(target.position); }
    if (target.userData?.lastHoverPoint?.isVector3) pos.copy(target.userData.lastHoverPoint);
    label.position.copy(pos);
    label.position.y += 0.03;
    getHeadPose();
    label.lookAt(_headPos);
    label.visible = true;
  }

  function openNametagCard(userId, controller) {
    const person = socialPersonById(userId);
    if (!person || person.isSelf) return;
    getHeadPose();
    const pos = new THREE.Vector3();
    try {
      controller?.getWorldPosition?.(pos);
    } catch {
      pos.copy(_headPos).addScaledVector(headForwardFlat(), 0.55);
    }
    pos.y += 0.12;
    xrSocialCard.open({
      ...person,
      muted: !!xrVoice.isPeerMuted?.(userId),
    }, pos, _headPos);
  }

  function handleSocialCardAction(action, user) {
    const uid = String(user?.id || "");
    if (action === "close" || !uid) {
      xrSocialCard.close();
      return;
    }
    if (action === "mute") {
      const next = !xrVoice.isPeerMuted?.(uid);
      xrVoice.setPeerMuted?.(uid, next);
      xrSocialCard.setUser({ muted: next });
      xrSocialCard.setFooter(next ? "Muted" : "Unmuted");
      return;
    }
    const map = {
      profile: `profile:${uid}`,
      friend: `user:${uid}`,
      file: `file:${uid}`,
      message: `message:${uid}`,
      meet: `meet:${uid}`,
    };
    const key = map[action];
    if (!key) return;
    xrSocialCard.setFooter("Working…");
    try {
      const res = onSocialAction?.(key);
      Promise.resolve(res).then((r) => {
        if (action === "profile" && r?.profile) {
          socialProfile = r.profile;
          socialFocusId = uid;
          socialPane = "profile";
          socialProfileTab = "profile";
          menuTab = "social";
          xrSocialCard.setFooter(r.profile.display_name || "Profile");
          openMenuConsole({ tab: "social", keepPose: true });
        } else {
          xrSocialCard.setFooter(r?.message || r?.error || "Done");
          if (action === "friend" && r?.ok) xrSocialCard.setUser({ is_friend: true });
        }
      });
    } catch (err) {
      xrSocialCard.setFooter(err?.message || "Failed");
    }
  }

  function toggleStudioPanel() {
    if (xrStudio.isOpen()) {
      if (xrStudioStateAbort) {
        try { xrStudioStateAbort.abort(); } catch (_) { /* ignore */ }
      }
      xrStudio.close();
      try { savePanelPose("studio", xrStudio.group); } catch (_) {}
      return;
    }
    const open = () => {
      studioHudShown = true;
      getHeadPose();
      xrStudio.open(_headPos, headForwardFlat());
      if (!applySavedPanelPose("studio", xrStudio.group)) {
        savePanelPose("studio", xrStudio.group);
      }
      void refreshStudioPanel();
    };
    if (deferHudOpenIfNeeded("studio", studioHudShown, open)) return;
    open();
  }

  window.addEventListener("render3d:xr-permissions", () => {
    if (xrStudio.isOpen()) void refreshStudioPanel();
  });

  function beginXrStudioStateFetch() {
    if (xrStudioStateAbort) {
      try { xrStudioStateAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    xrStudioStateAbort = ctl;
    return ctl;
  }

  async function refreshStudioPanel() {
    const ctl = beginXrStudioStateFetch();
    let data = studioPayload;
    try {
      data = (typeof getXrStudioState === "function" && await getXrStudioState({ signal: ctl.signal })) || data;
      if (ctl.signal.aborted) return;
      studioPayload = data;
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
      data = studioPayload || {};
    }
    const tab = xrStudio.getTab();
    const { lines, footer } = studioLinesForTab(tab, data);
    xrStudio.setContent({ nextTab: tab, nextLines: lines, nextFooter: footer, nextTitle: "Studio" });
  }

  function handleStudioRow(line) {
    const id = String(line?.id || "");
    if (!id) return;
    if (id.startsWith("hist:")) {
      try { onXrStudioAction?.({ type: "restore", index: Number(id.slice(5)) }); } catch (_) {}
      menuFooterHint = "Restoring history…";
      return;
    }
    if (id.startsWith("ws:")) {
      Promise.resolve(onXrStudioAction?.({ type: "move_workspace", team_id: id.slice(3) })).then((r) => {
        menuFooterHint = r?.message || r?.error || "Saved to workspace";
        void refreshStudioPanel();
      });
      return;
    }
    if (id.startsWith("unshare:")) {
      Promise.resolve(onXrStudioAction?.({ type: "unshare", user_id: id.slice(8) })).then(() => refreshStudioPanel());
      return;
    }
    if (id === "share_invite") {
      Promise.resolve(onXrStudioAction?.({ type: "share_invite" })).then((r) => {
        menuFooterHint = r?.message || "Invite from laptop Social if needed";
      });
      return;
    }
    if (id.startsWith("stream:")) {
      Promise.resolve(onXrStudioAction?.({ type: "stream_connect", provider: id.slice(7) })).then((r) => {
        menuFooterHint = r?.message || r?.error || "Stream connect";
        void refreshStudioPanel();
      });
      return;
    }
    if (id.startsWith("key:")) {
      const parts = id.split(":");
      Promise.resolve(onXrStudioAction?.({
        type: "key_grant",
        kind: parts[1],
        team_id: parts[2],
        key_id: parts[3],
        user_id: parts[4],
        granted: parts[5] === "1",
      })).then((r) => {
        menuFooterHint = r?.message || r?.error || "Permission updated";
        void refreshStudioPanel();
      });
    }
  }

  async function sendPromptToLaptop() {
    try {
      const snap = voiceDraw.snapshot?.({}) || {};
      const payload = serializePromptBridge(readAiState(), {
        clips: snap.clips || [],
        strokeCount: voiceDraw.strokeCount(),
        prompt: readAiState().draft,
      });
      const res = await onXrStudioAction?.({ type: "prompt_bridge", payload });
      menuFooterHint = res?.message || "Sent prompt + sketches to your laptop";
    } catch (err) {
      menuFooterHint = err?.message || "Could not send to laptop";
    }
  }

  function setTool(id) {
    if (id === 'draw_canvas') {
      if (activeTool === 'draw') setVoiceDraw(false);
      activeTool = 'grab'; laserAimMode = true; closeAiPromptPanel();
      void aiDrawWorkspace.open().then(opened => { if (opened && !aiDrawWorkspace.board.getState().canvas?.enabled) return aiDrawWorkspace.action('canvas'); });
      dismissToolWheelAfterSelect(); return;
    }
    if (id === 'room_floor') { recenterRoomFloor(); return; }
    if (id === "draw_ai_prompt") {
      if (activeTool === "draw") setVoiceDraw(false);
      activeTool = "grab"; laserAimMode = true;
      closeAiPromptPanel();
      void aiDrawWorkspace.open();
      dismissToolWheelAfterSelect();
      return;
    }
    if (String(id).startsWith("board:")) { void aiDrawWorkspace.action(id); return; }
    if (aiDrawWorkspace.isActive() && (id === "undo" || id === "redo")) { void aiDrawWorkspace.action(id); return; }

    if (String(id).startsWith("agent-ui:")) {
      const action = String(id).slice(9);
      if (action === "agent:mic" || action === "voice_toggle") {
        void toggleHeadsetMic();
        return;
      }
      if (action === "agent:toggle" || action === "agent:talk" || action === "agent:order" || action === "agent:bubble") {
        void beginAstraTalk({ toggle: action === "agent:toggle" });
        return;
      }
      if (action === "agent:round-table" || action === "round_table") {
        toggleAiRoundTable();
        return;
      }
      agentAvatar.action(action);
      return;
    }
    if (String(id).startsWith("agent-remote:")) { void window.Render3DXrAgent?.action?.(id); return; }
    if (String(id).startsWith("agent-join:")) {
      if (id !== "agent-join:drag") agentJoin.action(id);
      return;
    }
    if (id === "team_join") {
      agentJoin.openMenu();
      return;
    }

    if (String(id).startsWith("color_")) { applyDrawColor(`#${id.slice(6)}`); return; }
    if (["draw_size_s", "draw_size_m", "draw_size_l"].includes(id)) { setDrawSize(id); return; }
    if (String(id).startsWith("draw_brush_")) {
      drawBrush = brushStyle(id.slice(11)).kind;
      setDrawEraser(false);
      voiceDraw.setBrush?.(drawBrush);
      toolHand.setBrush?.(drawBrush);
      return;
    }

    if (id !== "wheel" && id !== "passthrough" && id !== "dock_hand") {
      dismissToolWheelAfterSelect();
    }
    if (handheldToolHidesLaser(id) || id === "draw" || id === "voice_draw") {
      laserAimMode = false;
    }
    try { xrDevStats?.noteAction?.(id); } catch (_) {}
    // World face/corner/move gizmos steal picks. Left-hand Face/Move pucks stay.
    try { xrSolidDraw.hideHandles?.(); } catch (_) {}
    if (xrViewToolIsCadHeavy(id) && !shouldRunCadHeavyXrViewTool({ presenting, toolId: id })) {
      menuFooterHint = "Explode, wire, tree, and section stay on the laptop in VR";
      return;
    }
    if (id === "dock_hand") {
      setPreferredDockHand(otherDockHand(preferredDockHand));
      return;
    }
    if (id === "passthrough") {
      setPassthroughOn(!passthroughOn);
      return;
    }
    if (id === "wheel") {
      toggleToolWheel();
      return;
    }
    if (id === "mic") {
      try { onTranscribeToggle?.(); } catch (_) {}
      try {
        const open = () => openAiPromptPanel({ forcePlace: true });
        if (deferHudOpenIfNeeded("ai", aiPanel, open)) return;
        open();
      } catch (_) {}
      return;
    }
    if (String(id).startsWith("create_")) {
      if (activeTool === "draw") setVoiceDraw(false);
      if (activeTool === "measure") clearMeasure();
      activeTool = id;
      try {
        if (xrSolidDraw.isActive?.() && !xrSolidDraw.isHandleDragging?.()) xrSolidDraw.cancel();
      } catch (_) {}
      try { xrSolidDraw.setEditMode?.(id === "create_box" ? (toolHand.boxMode?.() || "box_face") : (toolHand.primMode?.() || "prim_size")); } catch (_) {}
      syncDock();
      return;
    }
    if (id === "box_face" || id === "box_extrude" || id === "box_corner" || id === "box_move") {
      try { toolHand.setBoxMode?.(id); } catch (_) {}
      try { xrSolidDraw.setEditMode?.(id); } catch (_) {}
      menuFooterHint = id === "box_corner" ? "Join · snap corners to nearby solids" : id === "box_move" ? "Move box" : "Face · drag to extrude";
      return;
    }
    if (id === "box_turn_left" || id === "box_turn_right") {
      const degrees = id === "box_turn_left" ? -15 : 15;
      const mesh = xrSolidDraw.rotateSelectedY?.(degrees);
      if (mesh) {
        sendDrawPose(mesh, true);
        updateDrawAuthorLabel(mesh);
        menuFooterHint = `Cube turned ${degrees < 0 ? "left" : "right"} 15°`;
      } else {
        menuFooterHint = "Grip or create a cube first";
      }
      return;
    }
    if (id === "prim_size" || id === "prim_move") {
      try { toolHand.setPrimMode?.(id); } catch (_) {}
      try { xrSolidDraw.setEditMode?.(id); } catch (_) {}
      return;
    }
    if (id === "group_select") {
      if (activeTool === "draw") setVoiceDraw(false);
      if (activeTool === "measure") clearMeasure();
      activeTool = "group_select";
      menuFooterHint = "Group · hold trigger and paint bodies · release to name";
      syncDock();
      return;
    }
    if (id === "view") {
      toggleViewPanel();
      return;
    }
    if (id === "social") {
      toggleGridPopup("social");
      return;
    }
    if (id === "guides") {
      toggleGuidesPanel();
      return;
    }
    if (id === "workspace") {
      toggleWorkspacePanel();
      return;
    }
    if (id === "scenes") {
      workspaceTab = "scene";
      workspaceSceneMenu = true;
      openWorkspacePanel({ forcePlace: false });
      return;
    }
    if (id === "board" || id === "walk" || id === "teleport" || id === "round_table" || id === "set_floor") {
      handleBoardAction(id);
      return;
    }
    if (id === "voice_toggle") {
      void toggleHeadsetMic();
      return;
    }
    if (id === "avatar") {
      toggleAvatarPanel();
      return;
    }
    if (id === "fit") {
      fitObjectInFront();
      return;
    }
    if (id === "tools") {
      try { toggleGridPopup("tools"); } catch (err) { console.warn("[viewport-xr] tools", err); }
      return;
    }
    if (id === "settings") {
      try { toggleGridPopup("settings"); } catch (err) { console.warn("[viewport-xr] settings", err); }
      return;
    }
    if (id === "robotics") {
      if (debuggerOpen) {
        closeXrDebugger({ sendLog: false });
        try { xrDevStats.keepRecording?.(); } catch (_) {}
      }
      try { toggleRoboticsPanel(); } catch (err) { console.warn("[viewport-xr] robotics", err); }
      return;
    }
    if (id === "hand_left") {
      setPreferredDockHand("left");
      refreshGridPopupSoon("settings");
      return;
    }
    if (id === "hand_right") {
      setPreferredDockHand("right");
      refreshGridPopupSoon("settings");
      return;
    }
    if (id === "menu") {
      const open = () => openMenuConsole({ tab: "projects", force: true });
      if (deferHudOpenIfNeeded("menu", explorerPanel, open)) return;
      open();
      return;
    }
    if (id === "ai" || id === "ai_panel") {
      try {
        const already = !!aiPanel?.group?.visible;
        const open = () => openAiPromptPanel({ keepPose: already, forcePlace: !already });
        if (deferHudOpenIfNeeded("ai", aiPanel, open)) return;
        open();
      } catch (_) {}
      return;
    }
    if (id === "undo") {
      if (undoXrCreate()) return;
      try { onUndo?.(); } catch (err) { console.warn("[viewport-xr] undo", err); }
      return;
    }
    if (id === "duplicate") {
      const spec = xrBuild.duplicateLastSolid();
      if (!spec) {
        menuFooterHint = "Nothing to copy";
        return;
      }
      try { commitXrSolidSpec(spec); } catch (err) { console.warn("[viewport-xr] duplicate", err); }
      menuFooterHint = `Copied ${spec.kind}`;
      return;
    }
    if (id === "stamp") {
      const pointer = aimPointer(1) || aimPointer(0);
      const at = pointer ? worldPosOf(pointer) : null;
      const spec = xrBuild.stampLastSolid(at);
      if (!spec) {
        menuFooterHint = "Nothing to stamp";
        return;
      }
      try { commitXrSolidSpec(spec); } catch (err) { console.warn("[viewport-xr] stamp", err); }
      menuFooterHint = `Stamped ${spec.kind}`;
      return;
    }
    if (id === "array") {
      const specs = xrBuild.arrayLastSolid() || [];
      if (!specs.length) {
        menuFooterHint = "Nothing to array";
        return;
      }
      for (const spec of specs) {
        try { commitXrSolidSpec(spec); } catch (err) { console.warn("[viewport-xr] array", err); }
      }
      menuFooterHint = `Array ×${specs.length + 1}`;
      return;
    }
    if (id === "slice") {
      const s = xrBuild.lastSolid?.();
      if (!s) {
        menuFooterHint = "Nothing to slice";
        return;
      }
      const pointer = aimPointer(1) || aimPointer(0);
      const n = { x: 1, y: 0, z: 0 };
      if (pointer) {
        try {
          pointer.updateMatrixWorld?.(true);
          const e = pointer.matrixWorld?.elements;
          if (e) {
            n.x = -(Number(e[8]) || 0);
            n.z = -(Number(e[10]) || 0);
            const len = Math.hypot(n.x, n.z) || 1;
            n.x /= len;
            n.z /= len;
          }
        } catch { /* keep +X */ }
      }
      const origin = s.worldPosition || s.mesh?.position || { x: 0, y: 0, z: 0 };
      const out = xrBuild.sliceLastSolid({ origin, normal: n });
      if (!out?.ok) {
        menuFooterHint = "Slice missed — overlap the plane";
        return;
      }
      recordXrCreate({ type: "solid", kind: "slice", solid: xrBuild.lastSolid?.(), cad: false });
      menuFooterHint = "Sliced";
      return;
    }
    if (id === "mirror") {
      const spec = xrBuild.mirrorLastSolid();
      if (!spec) {
        menuFooterHint = "Nothing to mirror";
        return;
      }
      try { commitXrSolidSpec({ ...spec, skipMirror: true }); } catch (err) { console.warn("[viewport-xr] mirror", err); }
      menuFooterHint = `Mirrored ${spec.kind}`;
      return;
    }
    if (id === "layer") {
      menuFooterHint = `Layer · ${xrBuild.cycleLayer()}`;
      return;
    }
    if (id === "wall_height") {
      if (activeTool === "draw") setVoiceDraw(false);
      if (activeTool === "measure") clearMeasure();
      activeTool = "wall_height";
      menuFooterHint = xrBuild.lastWall()
        ? "Wall height · trigger and pull up"
        : "Draw a wall first, then Height";
      syncDock();
      return;
    }
    if (id === "redo") {
      if (redoXrCreate()) return;
      try { onRedo?.(); } catch (err) { console.warn("[viewport-xr] redo", err); }
      return;
    }
    if (id === "explorer") {
      openMenuConsole({ tab: "projects", force: true });
      return;
    }
    if (id === "front") {
      placeInFront({ spawnId: activeSpawnId || "eye", keepZoom: false });
      return;
    }
    if (id === "restore") {
      applySavedPose();
      return;
    }
    if (id === "zoom_in") {
      applyZoom(1.2);
      return;
    }
    if (id === "zoom_out") {
      applyZoom(1 / 1.2);
      return;
    }
    if (id === "place") {
      openPlacePanel();
      return;
    }
    if (id === "exit") {
      beginExitVrHold(exitVrHoldHand);
      return;
    }
    if (id === "screenshot" || id === "record" || id === "record_pause" || id === "record_stop"
      || id === "shot_share_x" || id === "shot_send_pc") {
      runHostTool(id);
      return;
    }
    if (id === "share") {
      toggleSharePanel();
      return;
    }
    if (id === "capture_back") { dockPalette.setCrescentKind?.("capture", {open:true}); return; }
    if (id === "capture") {
      const open = !!dockPalette.toggleCrescent?.();
      menuFooterHint = captureRecState.recording
        ? "Recording… Pause or Stop"
        : captureRecState.clipReady
          ? (open ? "Clip ready · Send to computer or Share to X" : "Clip ready — open Capture to send")
          : (open ? "Capture · Shot, Rec, or Stream" : "");
      return;
    }
    if (id === "stream") {
      const family = currentHeadsetCastFamily();
      if (shouldOpenStreamCastPicker(family)) {
        try { dockPalette.setCrescentKind?.("stream_pick", { open: true, castFamily: family }); } catch (_) {}
        menuFooterHint = streamCastFooterHint(family);
        return;
      }
      try { dockPalette.setCrescentKind?.("stream", { open: true }); } catch (_) {}
      menuFooterHint = "Stream · X Live, Twitch, or Kick";
      return;
    }
    if (id === "stream_live") {
      try { dockPalette.setCrescentKind?.("stream", { open: true }); } catch (_) {}
      menuFooterHint = "Stream · X Live, Twitch, or Kick";
      return;
    }
    if (id === "stream_cast_meta" || id === "stream_cast_apple") {
      const family = id === "stream_cast_apple" ? "apple" : "meta";
      runHostTool("stream_cast", { family });
      menuFooterHint = family === "apple"
        ? "Control Center → AirPlay / SharePlay / Share to Mac"
        : "Meta button → Quick controls → Cast";
      return;
    }
    if (id === "stream_x_live" || id === "stream_twitch" || id === "stream_kick") {
      pendingStreamProvider = id === "stream_x_live" ? "x_live" : id.replace(/^stream_/, "");
      try { dockPalette.setCrescentKind?.("link", { open: true }); } catch (_) {}
      runHostTool(id, { provider: pendingStreamProvider });
      menuFooterHint = "Open browser in headset or Send to PC";
      return;
    }
    if (id === "stream_browser" || id === "stream_send_pc") {
      runHostTool(id, { provider: pendingStreamProvider || "twitch" });
      return;
    }
    if (id === "transparent" || id === "transparent_all") {
      if (activeTool === "measure") clearMeasure();
      if (activeTool === "draw") setVoiceDraw(false);
      if (id === "transparent" && activeTool === "transparent") {
        activeTool = "grab";
        transparentAllActive = false;
        runHostTool("transparent_off");
        menuFooterHint = "Ghost off — solids restored";
        syncDock();
        return;
      }
      activeTool = "transparent";
      transparentAllActive = id === "transparent_all";
      runHostTool(transparentAllActive ? "transparent_all" : "transparent_on");
      menuFooterHint = transparentAllActive
        ? "Ghost all · unclick Ghost to restore"
        : "Ghost · trigger a part · ▾ All objects";
      syncDock();
      return;
    }
    if (id === "measure") {
      if (activeTool === "transparent") {
        transparentAllActive = false;
        runHostTool("transparent_off");
      }
      if (activeTool === "draw") setVoiceDraw(false);
      activeTool = "measure";
      syncDock();
      return;
    }
    if (id === "grab" || id === "rotate" || id === "scale") {
      if (activeTool === "measure") clearMeasure();
      if (activeTool === "transparent") {
        transparentAllActive = false;
        runHostTool("transparent_off");
      }
      if (activeTool === "draw") setVoiceDraw(false);
      activeTool = id;
      menuFooterHint = id === "scale" ? "Scale · trigger the model and pull" : "";
      syncDock();
      return;
    }
    if (id === "voice_draw" || id === "draw") {
      toggleVoiceDraw();
      return;
    }
    if (id === "voice_mold") {
      void beginAstraTalk({ toggle: true });
      return;
    }
    if (id === "studio") {
      toggleStudioPanel();
      return;
    }
    if (id === "snap") {
      const on = !xrBuild.snapEnabled?.();
      menuFooterHint = `Snap · ${xrBuild.setSnapEnabled?.(on) || xrBuild.cycleSnap()}`;
      try { toolWheel.setSnapOn?.(!!xrBuild.snapEnabled?.()); } catch (_) {}
      return;
    }
    if (id === "symmetry") {
      menuFooterHint = `Symmetry · ${xrBuild.cycleSymmetry()}`;
      return;
    }
    if (id === "combine") {
      const out = xrBuild.applyCombine({
        onDone: (result) => {
          xrCsgPending = false;
          menuFooterHint = result?.hint || menuFooterHint;
          if (result?.did && result.mesh) {
            persistXrCombinedMesh(result.mesh);
            recordXrCreate({ type: "solid", kind: "combine", solid: xrBuild.lastSolid?.(), cad: false });
          }
        },
      });
      xrCsgPending = !!out?.pending;
      menuFooterHint = out?.hint || `Combine · ${out?.mode || "off"}`;
      return;
    }
    if (id === "revolve") {
      const last = voiceDraw.lastStrokes?.(1)?.[0];
      if (!last) {
        menuFooterHint = "Draw a stroke first, then Revolve";
        return;
      }
      const revolved = xrBuild.revolveFromStroke(last.points, { color: last.color || drawColor });
      if (revolved) recordXrCreate({ type: "solid", kind: "revolve", solid: xrBuild.lastSolid?.(), cad: false });
      menuFooterHint = "Revolve committed";
      return;
    }
    if (id === "loft") {
      const pair = voiceDraw.lastStrokes?.(2) || [];
      if (pair.length < 2) {
        menuFooterHint = "Draw two strokes, then Loft";
        return;
      }
      const lofted = xrBuild.loftFromStrokes(pair[0].points, pair[1].points, { color: drawColor });
      if (lofted) recordXrCreate({ type: "solid", kind: "loft", solid: xrBuild.lastSolid?.(), cad: false });
      menuFooterHint = "Loft committed";
      return;
    }
    if (id === "send_prompt_pc") {
      void sendPromptToLaptop();
      return;
    }
    if (id === "shot_share_x" || id === "shot_send_pc") {
      runHostTool(id);
      return;
    }
    if (id === "prompt") {
      runHostTool("prompt");
      return;
    }
    // Forward console tool rows through host callbacks
    runHostTool(id);
  }

  function runHostTool(id, payload) {
    try {
      if (id === "prompt") {
        onPromptSubmit?.();
        return;
      }
      if ((id === "bambu" || id === "slicer") && presenting) {
        void openSlicerPlatePreview();
        try { agentAvatar.spawn?.(); } catch { /* ignore */ }
      }
      if (typeof onToolAction === "function") {
        onToolAction(id, payload);
        return;
      }
    } catch (err) {
      console.warn("[viewport-xr] tool", id, err);
    }
  }

  function isUiPick(hit) {
    if (!hit?.kind) return false;
    if (hit.kind === "robotics-workspace-action") return !!(hit.cell || hit.id);
    if (hit.kind === "robotics-chrome") return false;
    return [
      "viewport-tab", "tool", "ai-action", "ai-drag", "ai-rotate", "menu-row", "menu-tab", "menu-chrome", "menu-close",
      "menu-action", "menu-rotate",
      "explorer-drag", "place", "place-drag", "place-close", "explorer", "color", "wheel-drag",
      "nametag", "social-card", "studio-tab", "studio-row", "studio-drag", "studio-chrome",
      "studio-close", "studio-action", "studio-rotate", "view-action", "view-drag", "view-chrome", "view-rotate",
      "grid-action", "grid-drag", "grid-chrome", "grid-rotate",
      "robotics-workspace-action", "robotics-action", "robotics-drag", "robotics-rotate",
      "workspace-action", "workspace-drag", "workspace-chrome",
      "avatar-action", "avatar-drag", "avatar-chrome",
      "share-invite-action", "share-invite-drag", "share-invite-chrome",
      "print-settings-action", "print-settings-drag", "print-settings-chrome",
      "printer-fence",
      "printer-pin",
      "share-video-close", "share-video-drag", "share-video-toggle",
      "share-video-menu", "share-video-action", "share-video-hide", "share-video-curve",
      "share-video-anchor", "share-video-resize", "clip-friend-row", "clip-friend-key",
      "clip-friend-search", "clip-friend-close", "clip-friend-chrome",
      "guides-action", "guides-drag", "guides-clip", "guides-chrome",
      "howto-next", "howto-done", "howto-drag",
      "draw-hud-color", "draw-hud-size", "draw-hud-chrome",
      "scene-win-close", "scene-win-resize", "scene-win-drag",
      "scene-win-action", "scene-win-chrome", "scene-win-url",
      "debugger-chrome", "debugger-action",
      "hand-cam-hide", "hand-cam-hover", "hand-cam-drag", "hand-cam-resize",
    ].includes(hit.kind) || isXrSceneWindowHitKind(hit.kind);
  }

  /** Prefer a UI hit on this pointer. Never steal the other hand's wrist dock. */
  function firstUiPointer(preferred) {
    if (!preferred) return null;
    const prefHit = pickWithController(preferred);
    if (isUiPick(prefHit)) return preferred;
    if (!firstUiPointerMayUseOtherHand()) return null;
    const seen = new Set();
    seen.add(preferred.id || preferred.uuid || preferred);
    for (let i = 0; i < 2; i += 1) {
      const pointer = aimPointer(i);
      if (!pointer) continue;
      const id = pointer.id || pointer.uuid || pointer;
      if (seen.has(id)) continue;
      seen.add(id);
      if (isUiPick(pickWithController(pointer))) return pointer;
    }
    return null;
  }

  function controllerAimRay(controller, origin, dir) {
    if (!controller) return false;
    const handAim = controller.userData?.handAim;
    if (handAim?.origin && handAim?.direction) {
      origin.copy(handAim.origin);
      dir.copy(handAim.direction).normalize();
      return true;
    }
    try {
      controller.updateMatrixWorld?.(true);
      _mat.identity().extractRotation(controller.matrixWorld);
      origin.setFromMatrixPosition(controller.matrixWorld);
      dir.set(0, 0, -1).applyMatrix4(_mat).normalize();
      return true;
    } catch {
      return false;
    }
  }

  function controllerTipPoint(controller, out = new THREE.Vector3()) {
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3(0, 0, -1);
    if (controllerAimRay(controller, origin, dir)) {
      return out.copy(origin).addScaledVector(dir, pointerTipOffsetM());
    }
    const handIndex = squeezeHandIndex(controller);
    const idx = handIndex >= 0 ? handIndex : 1;
    return pointerWorldPos(idx, out);
  }

  function airDrawPoint(controller) {
    return controllerTipPoint(controller);
  }

  function drawPointFromController(controller) {
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const aimed = controllerAimRay(controller, origin, dir);
    if (xrBoard?.state?.active && xrBoard.state.mode === "god" && aimed) {
      const hit = projectPointOnPlane(origin, dir, xrBoard.state.board.p);
      if (hit?.p) {
        return {
          point: new THREE.Vector3(hit.p[0], hit.p[1] + 0.004, hit.p[2]),
          onModel: false,
          part: "board",
          hit: { kind: "board", point: new THREE.Vector3().fromArray(hit.p), distance: hit.t },
        };
      }
    }
    const hit = pickWithController(controller);
    const point = airDrawPoint(controller);
    let onModel = false;
    let part = "";
    if (hit?.kind === "board" && hit.point) {
      return { point: hit.point.clone(), onModel: false, part: "board", hit };
    }
    if (hit?.kind === "mesh" && hit.point && point.distanceTo(hit.point) < 0.06) {
      onModel = true;
      try { part = String(getLiveMesh()?.name || ""); } catch { part = ""; }
    }
    return { point, onModel, part, hit };
  }

  function commitLiveDrawClip() {
    try {
      if (!voiceDraw.hasLiveStrokes?.()) return null;
      const mesh = getLiveMesh();
      const hostState = (typeof getAiPromptState === "function" && getAiPromptState()) || {};
      const snap = voiceDraw.commitClip?.({
        formatLength,
        measureMm: measureDistanceMm,
        modelName: hostState.selectedLabel || mesh?.name || "",
      });
      if (snap?.imageDataUrl) {
        try { onAttachVoiceDrawClip?.(snap); } catch (_) {}
      }
      return snap || null;
    } catch {
      return null;
    }
  }

  function setVoiceDraw(on) {
    if (on) {
      if (activeTool === "measure") clearMeasure();
      try { xrSolidDraw.cancel(); } catch (_) {}
      laserAimMode = false;
      activeTool = "draw";
      try {
        if (shouldEnsureDimosCoordinatorOnXrEnter({ presenting: !!presenting })) {
          void ensureDimosCoordinatorIfDown({ session: session || renderer?.xr?.getSession?.() || null });
        }
      } catch (_) {}
      try { voiceDraw.setColor?.(drawColor); } catch (_) {}
      try { voiceDraw.setRadius?.(drawSizeId === "draw_size_s" ? 0.005 : drawSizeId === "draw_size_l" ? 0.018 : 0.009); } catch (_) {}
      try { voiceDraw.setEraser?.(drawEraserOn); } catch (_) {}
      try { closeGridPopup("draw"); } catch (_) {}
      const n = voiceDraw.liveStrokeCount?.() || voiceDraw.strokeCount();
      const kept = voiceDraw.clipCount?.() || 0;
      menuFooterHint = kept
        ? `Draw on · ${kept} sketch${kept === 1 ? "" : "es"} kept · hold trigger · tap Keep when done`
        : "Draw on · hold trigger toward the model or in space · tap Keep, then Talk or Run";
      bindDesktopDraw(true);
    } else {
      try { voiceDraw.end(); } catch (_) {}
      const snap = commitLiveDrawClip();
      if (activeTool === "draw") activeTool = "grab";
      try { closeGridPopup("draw"); } catch (_) {}
      try { drawHud.setVisible?.(false); } catch (_) {}
      bindDesktopDraw(false);
      const kept = voiceDraw.clipCount?.() || 0;
      if (!menuFooterHint || /Draw on/.test(menuFooterHint)) {
        menuFooterHint = kept
          ? `Sketch ${kept} kept · Draw again, Talk, or Run once`
          : (snap ? "Sketch kept — Talk or Run when ready" : "");
      }
    }
    syncDock();
    try { refreshAiPromptPanel(); } catch (_) {}
    if (presenting && explorerPanel?.group.visible && (menuTab === "tools" || menuTab === "ai")) {
      try { openMenuConsole({ tab: menuTab, keepPose: true }); } catch (_) {}
    }
  }

  function toggleVoiceDraw() {
    setVoiceDraw(activeTool !== "draw");
  }

  function desktopWorldPoint(ev) {
    const el = renderer?.domElement;
    if (!el || !camera) return null;
    const rect = el.getBoundingClientRect();
    const x = ((ev.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    const y = -((ev.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
    const mesh = getLiveMesh();
    if (mesh) {
      try {
        mesh.updateMatrixWorld(true);
        const hits = raycaster.intersectObject(mesh, true).filter((h) => h.object?.isMesh);
        if (hits[0]?.point) {
          return { point: hits[0].point.clone(), onModel: true, part: String(mesh.name || "") };
        }
      } catch (_) {}
    }
    const origin = new THREE.Vector3();
    const center = new THREE.Vector3();
    try {
      camera.getWorldPosition(origin);
      if (mesh) {
        new THREE.Box3().setFromObject(mesh).getCenter(center);
      } else {
        center.copy(origin).add(new THREE.Vector3(0, 0, -0.55).applyQuaternion(camera.quaternion));
      }
    } catch {
      return null;
    }
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(new THREE.Vector3()).negate(),
      center,
    );
    const out = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(plane, out)) return null;
    return { point: out, onModel: false, part: "" };
  }

  function bindDesktopDraw(on) {
    const el = renderer?.domElement;
    if (!el) return;
    if (on && !desktopDrawBound) {
      desktopDrawBound = true;
      el.addEventListener("pointerdown", onDesktopDrawDown);
      window.addEventListener("pointermove", onDesktopDrawMove);
      window.addEventListener("pointerup", onDesktopDrawUp);
      window.addEventListener("pointercancel", onDesktopDrawUp);
      try { el.style.cursor = "crosshair"; } catch (_) {}
      if (controls && !presenting) controls.enabled = false;
    }
    if (!on && desktopDrawBound) {
      desktopDrawBound = false;
      desktopDrawPointerId = null;
      try { voiceDraw.end(); } catch (_) {}
      el.removeEventListener("pointerdown", onDesktopDrawDown);
      window.removeEventListener("pointermove", onDesktopDrawMove);
      window.removeEventListener("pointerup", onDesktopDrawUp);
      window.removeEventListener("pointercancel", onDesktopDrawUp);
      try { el.style.cursor = ""; } catch (_) {}
      if (controls && !presenting) controls.enabled = true;
    }
  }

  function onDesktopDrawDown(ev) {
    if (presenting || activeTool !== "draw") return;
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    desktopDrawPointerId = ev.pointerId;
    try { ev.target?.setPointerCapture?.(ev.pointerId); } catch (_) {}
    const sample = desktopWorldPoint(ev);
    if (sample?.point) voiceDraw.begin(sample.point, sample);
  }

  function onDesktopDrawMove(ev) {
    if (presenting || activeTool !== "draw") return;
    if (desktopDrawPointerId == null || ev.pointerId !== desktopDrawPointerId) return;
    const sample = desktopWorldPoint(ev);
    if (sample?.point) voiceDraw.append(sample.point);
  }

  function onDesktopDrawUp(ev) {
    if (desktopDrawPointerId == null) return;
    if (ev && ev.pointerId != null && ev.pointerId !== desktopDrawPointerId) return;
    desktopDrawPointerId = null;
    try { voiceDraw.end(); } catch (_) {}
    refreshAiPromptPanel();
  }

  function sampleVoiceDraw(handIndex, controller) {
    if (activeTool !== "draw" || !controller) return false;
    const hit = pickControllerSelectHit(controller);
    if (isUiPick(hit) || xrUiPickBlocksDraw(hit)) return false;
    const sample = drawPointFromController(controller);
    if (!sample?.point) return true;
    const author = localAuthor();
    if (!voiceDraw.isDrawing()) {
      voiceDraw.begin(sample.point, { ...sample, authorId: author.id, authorName: author.name });
    } else {
      voiceDraw.append(sample.point);
    }
    return true;
  }

  function openPlacePanel(opts = {}) {
    if (!placePanel) {
      const canvas = drawPanelCanvas("Place model", [], "Trigger a row · grip to move");
      const tex = sharpenCanvasTex(new THREE.CanvasTexture(canvas));
      tex.colorSpace = THREE.SRGBColorSpace;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(0.5, 0.38),
        new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
        }),
      );
      plane.renderOrder = 2045;
      plane.userData.xrPlacePanel = true;
      const titleBar = new THREE.Mesh(
        new THREE.PlaneGeometry(0.42, 0.05),
        new THREE.MeshBasicMaterial({
          color: 0x7dd3fc,
          transparent: true,
          opacity: 0.001,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      titleBar.position.set(-0.02, 0.16, 0.006);
      titleBar.renderOrder = 2046;
      titleBar.userData.xrPlaceDrag = true;
      placePanel = { group: new THREE.Group(), plane, titleBar, tex, lines: [] };
      placePanel.group.add(plane);
      placePanel.group.add(titleBar);
      markWorldUi(placePanel.group);
      xrHud.add(placePanel.group);
    }
    const lines = SPAWN_PRESETS.map((p) => ({
      id: p.id,
      label: `${p.id === activeSpawnId ? "● " : "○ "}${p.label}`,
      active: p.id === activeSpawnId,
    }));
    lines.push({ id: "__saved__", label: "Last saved spot", active: false });
    placePanel.lines = lines;
    const canvas = drawPanelCanvas("Place model", lines, "Point + trigger · grip to move");
    placePanel.tex.image = canvas;
    placePanel.tex.needsUpdate = true;
    placePanel.group.visible = true;
    const forcePlace = opts.forcePlace === true;
    ensureHudWorldParent(placePanel.group);
    if (!forcePlace && opts.keepPose && panelWorldPosIsUsable(placePanel.group)) {
      placePanel.worldPlaced = true;
      return;
    }
    if (!forcePlace && applySavedPanelPose("place", placePanel.group)) {
      placePanel.worldPlaced = true;
      return;
    }
    const pos = spawnPanelWorldPos(0.32);
    setPanelWorldPose(placePanel.group, pos);
    facePanelTowardHead(placePanel.group, pos);
    placePanel.worldPlaced = true;
    savePanelPose("place", placePanel.group);
  }

  function closePlacePanel() {
    if (placePanel) {
      placePanel.group.visible = false;
      try { savePanelPose("place", placePanel.group); } catch (_) {}
    }
  }

  function readAiState() {
    let state = {
      draft: "",
      listening: false,
      mode: "v2",
      speed: "fast",
      targetMode: "new",
      selectedLabel: "None",
      keyLabel: "",
      keyValue: "",
      keyOptions: [],
      modelLabel: "",
      modelValue: "",
      modelOptions: [],
      modelPickerOpen: false,
      modelPickerScroll: 0,
      history: [],
      generating: false,
      genPct: 0,
      genLabel: "",
      byUserName: "",
      keyboardOpen: false,
      now: performance.now(),
    };
    try {
      const s = typeof getAiPromptState === "function" ? getAiPromptState() : null;
      if (s && typeof s === "object") state = { ...state, ...s };
    } catch (_) {}
    try {
      if (!state.draft && typeof getPromptDraft === "function") state.draft = String(getPromptDraft() || "");
    } catch (_) {}
    try {
      if (typeof isTranscribing === "function") state.listening = !!isTranscribing();
    } catch (_) {}
    try {
      const g = typeof getAiGenerationProgress === "function" ? getAiGenerationProgress() : null;
      if (g && typeof g === "object") {
        state.generating = !!(state.generating || g.generating);
        state.genPct = Number(g.pct ?? state.genPct ?? 0) || 0;
        state.genLabel = String(g.label || state.genLabel || "");
        state.byUserName = String(g.byUserName || state.byUserName || "");
        state.mcmasterParts = Array.isArray(g.mcmaster_parts) ? g.mcmaster_parts : (g.mcmasterParts || []);
        state.checklist = Array.isArray(g.checklist) ? g.checklist : [];
        state.activity = Array.isArray(g.activity) ? g.activity : [];
        state.thinking = String(g.thinking || "");
        state.improvedPrompt = String(g.improvedPrompt || g.improved_prompt || "");
        state.harness = String(g.harness || "");
        state.previewFilename = String(g.preview_filename || g.previewFilename || "");
        state.projectId = String(g.projectId || "");
      }
    } catch (_) {}
    if (aiPanel?.status) {
      if (!state.draft) state.draft = String(aiPanel.status);
      else if (state.listening && !String(state.draft).includes(aiPanel.status)) {
        /* keep live transcript */
      }
    }
    state.drawing = activeTool === "draw";
    state.drawStrokes = voiceDraw.liveStrokeCount?.() ?? voiceDraw.strokeCount();
    state.drawClips = voiceDraw.clipCount?.() || 0;
    state.talking = !!aiPanel?.talking;
    state.talkConnecting = !!aiPanel?.talkConnecting;
    state.talkStatus = aiPanel?.talkStatus || "";
    state.talkError = !!aiPanel?.talkError;
    if (!Array.isArray(state.composeImages)) state.composeImages = [];
    state.modelPickerOpen = !!aiModelPickerOpen;
    state.modelPickerScroll = Number(aiModelPickerScroll) || 0;
    state.keyboardOpen = !!aiKeyboardOpen;
    state.now = performance.now();
    state.overflowOpen = !!hudOverflowOpen.ai;
    state.locked = isXrHudLocked("ai", hudStorage());
    state.roundTable = !!aiRoundTable?.isVisible?.();
    try { state.sandbox = typeof window !== "undefined" && window.Render3DSandbox?.isOpen?.() === true; } catch { state.sandbox = false; }
    return state;
  }

  function aiCanvasToLocal(px, py, z = 0.006) {
    return new THREE.Vector3(
      (px / AI_CANVAS.w - 0.5) * AI_PLANE.w,
      (0.5 - py / AI_CANVAS.h) * AI_PLANE.h,
      z,
    );
  }

  function makeAiHitTarget(id, px, py, pw, ph, z = 0.006) {
    const w = (pw / AI_CANVAS.w) * AI_PLANE.w;
    const h = (ph / AI_CANVAS.h) * AI_PLANE.h;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(w, 0.025), Math.max(h, 0.025)),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.001,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.position.copy(aiCanvasToLocal(px + pw / 2, py + ph / 2, z));
    mesh.renderOrder = 2052;
    mesh.frustumCulled = false;
    mesh.userData.xrAiHit = id;
    return mesh;
  }

  function ensureAiPanel() {
    if (aiPanel) return aiPanel;
    const canvas = drawAiPromptCanvas(readAiState());
    const tex = configurePromptTexture(new THREE.CanvasTexture(canvas), renderer.capabilities.getMaxAnisotropy());
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(AI_PLANE.w, AI_PLANE.h),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    plane.renderOrder = 2050;
    plane.frustumCulled = false;
    plane.userData.xrAiPanel = true;

    const hits = [];
    hits.push(makeAiHitTarget("round_table", AI_CANVAS.w - 416, 16, 136, 64));
    hits.push(makeAiHitTarget("send_pc", AI_CANVAS.w - 278, 16, 128, 64));
    hits.push(makeAiHitTarget("hide", AI_CANVAS.w - 150, 16, 120, 64));
    hits.push(makeAiHitTarget("drag", 8, 8, AI_CANVAS.w - 430, AI_LAYOUT.headerEnd - 12));
    const mic = AI_LAYOUT.mic;
    hits.push(makeAiHitTarget(
      "mic",
      mic.cx - mic.r * 1.25,
      mic.cy - mic.r * 1.25,
      mic.r * 2.5,
      mic.r * 2.5 + 36,
    ));
    hits.push(makeAiHitTarget(
      "round_table",
      AI_LAYOUT.tableBtn.x,
      AI_LAYOUT.tableBtn.y,
      AI_LAYOUT.tableBtn.w,
      AI_LAYOUT.tableBtn.h,
    ));
    hits.push(makeAiHitTarget("key", 40, AI_LAYOUT.keyY, AI_CANVAS.w - 80, 56));
    hits.push(makeAiHitTarget("model", 40, AI_LAYOUT.modelY, AI_CANVAS.w - 80, 56));
    hits.push(makeAiHitTarget(
      "type",
      AI_LAYOUT.transcript.x,
      AI_LAYOUT.transcript.y,
      AI_LAYOUT.transcript.w,
      AI_LAYOUT.transcript.h,
    ));
    hits.push(makeAiHitTarget("progress", 40, AI_LAYOUT.progress.y, AI_CANVAS.w - 80, AI_LAYOUT.progress.h));

    function addPillHits(y, ids) {
      const n = ids.length;
      const gap = 12;
      const bw = (AI_CANVAS.w - 80 - gap * (n - 1)) / n;
      ids.forEach((hid, i) => {
        hits.push(makeAiHitTarget(hid, 40 + i * (bw + gap), y, bw, 56));
      });
    }
    addPillHits(AI_LAYOUT.modeY, ["mode:render", "mode:v2", "mode:mesh"]);
    addPillHits(AI_LAYOUT.speedY, ["speed:fast", "speed:quality"]);
    addPillHits(AI_LAYOUT.targetY, ["target:new", "target:edit"]);
    const tGap = 12;
    const tw = (AI_CANVAS.w - 80 - tGap * (AI_LAYOUT.thumbs.n - 1)) / AI_LAYOUT.thumbs.n;
    for (let i = 0; i < AI_LAYOUT.thumbs.n; i += 1) {
      hits.push(makeAiHitTarget(
        `thumb:${i}`,
        40 + i * (tw + tGap),
        AI_LAYOUT.thumbs.y,
        tw,
        AI_LAYOUT.thumbs.h,
      ));
    }
    for (let i = 0; i < AI_LAYOUT.historyN; i += 1) {
      hits.push(makeAiHitTarget(
        `hist:${i}`,
        40,
        AI_LAYOUT.historyY + i * AI_LAYOUT.historyH,
        AI_CANVAS.w - 80,
        AI_LAYOUT.historyH - 6,
      ));
    }
    const runGap = 12;
    const runW = (AI_CANVAS.w - 80 - runGap * 3) / 4;
    hits.push(makeAiHitTarget("draw", 40, AI_LAYOUT.run.y, runW, AI_LAYOUT.run.h));
    hits.push(makeAiHitTarget("talk", 40 + runW + runGap, AI_LAYOUT.run.y, runW, AI_LAYOUT.run.h));
    hits.push(makeAiHitTarget("round_table", 40 + (runW + runGap) * 2, AI_LAYOUT.run.y, runW, AI_LAYOUT.run.h));
    hits.push(makeAiHitTarget("run", 40 + (runW + runGap) * 3, AI_LAYOUT.run.y, runW, AI_LAYOUT.run.h));

    const titleBar = new THREE.Mesh(
      new THREE.PlaneGeometry(AI_PLANE.w, 0.055),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.001,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    titleBar.position.y = AI_PLANE.h / 2 - 0.028;
    titleBar.position.z = 0.007;
    titleBar.renderOrder = 2051;
    titleBar.frustumCulled = false;
    titleBar.userData.xrAiDrag = true;
    titleBar.userData.xrAiHit = "drag";

    aiPanel = { group: new THREE.Group(), plane, titleBar, tex, canvas, hits, pickerHits: [], status: "" };
    aiPanel.group.add(plane);
    aiPanel.group.add(titleBar);
    hits.forEach((h) => aiPanel.group.add(h));
    aiPanel.group.visible = false;
    markWorldUi(aiPanel.group);
    xrHud.add(aiPanel.group);
    return aiPanel;
  }

  function clearAiModelPickerHits() {
    if (!aiPanel?.pickerHits) return;
    for (const h of aiPanel.pickerHits) {
      try { aiPanel.group.remove(h); } catch (_) {}
      try { h.geometry?.dispose?.(); } catch (_) {}
      try { h.material?.dispose?.(); } catch (_) {}
    }
    aiPanel.pickerHits = [];
  }

  function currentModelPickerLayout() {
    const state = readAiState();
    return modelPickerLayout({
      width: AI_CANVAS.w,
      height: AI_CANVAS.h,
      modelY: AI_LAYOUT.modelY,
      rowH: 56,
      options: Array.isArray(state.modelOptions) ? state.modelOptions : [],
      scroll: Number(aiModelPickerScroll) || 0,
    });
  }

  function syncAiModelPickerHits() {
    clearAiModelPickerHits();
    if (!aiPanel || !aiModelPickerOpen) return;
    const layout = currentModelPickerLayout();
    const pickerHits = [];
    pickerHits.push(makeAiHitTarget(
      "model_chrome",
      layout.overlayX,
      layout.overlayY,
      layout.overlayW,
      layout.overlayH,
      0.011,
    ));
    layout.rows.forEach((row) => {
      pickerHits.push(makeAiHitTarget(`model:${row.value}`, row.x, row.y, row.w, row.h, 0.014));
    });
    if (layout.up) pickerHits.push(makeAiHitTarget("model_up", layout.up.x, layout.up.y, layout.up.w, layout.up.h, 0.014));
    if (layout.down) pickerHits.push(makeAiHitTarget("model_down", layout.down.x, layout.down.y, layout.down.w, layout.down.h, 0.014));
    pickerHits.forEach((h) => {
      h.renderOrder = 2068;
      aiPanel.group.add(h);
    });
    aiPanel.pickerHits = pickerHits;
  }

  function refreshAiPromptPanel() {
    if (!aiPanel?.group.visible) return;
    const state = readAiState();
    const nextSig = xrAiPanelSignature(state);
    if (shouldRedrawXrConsole({ lastSig: aiPanel.lastSig, nextSig })) {
      const canvas = drawAiPromptCanvas(state, aiPanel.canvas || null);
      aiPanel.canvas = canvas;
      if (aiPanel.tex.image !== canvas) aiPanel.tex.image = canvas;
      aiPanel.tex.needsUpdate = true;
      aiPanel.lastSig = nextSig;
    }
    syncAiModelPickerHits();
    refreshAiKeyboard();
    refreshAiLoading();
  }

  function openAiPromptPanel(opts = {}) {
    const panel = ensureAiPanel();
    panel.group.visible = true;
    refreshAiPromptPanel();
    const forcePlace = opts.forcePlace === true;
    ensureHudWorldParent(panel.group);
    panel.group.userData.xrHudParked = true;
    if (!forcePlace && panel.worldPlaced && panelWorldPosIsUsable(panel.group)) {
      aiPanelRefreshAt = performance.now();
      return;
    }
    if (!forcePlace) {
      if (opts.keepPose && panelWorldPosIsUsable(panel.group)) {
        panel.worldPlaced = true;
        aiPanelRefreshAt = performance.now();
        return;
      }
      if (applySavedPanelPose("ai", panel.group)) {
        panel.worldPlaced = true;
        aiPanelRefreshAt = performance.now();
        return;
      }
    }
    // Default placement (first open / explicit reset only)
    const pos = spawnPanelWorldPos(0.38);
    setPanelWorldPose(panel.group, pos);
    facePanelTowardHead(panel.group, pos);
    panel.worldPlaced = true;
    savePanelPose("ai", panel.group);
    aiPanelRefreshAt = performance.now();
  }

  function closeAiPromptPanel() {
    aiModelPickerOpen = false;
    aiModelPickerScroll = 0;
    aiKeyboardOpen = false;
    aiKeyboardShift = false;
    aiLoadingOpen = false;
    if (aiPanel) {
      aiPanel.group.visible = false;
      try { savePanelPose("ai", aiPanel.group); } catch (_) {}
      clearAiModelPickerHits();
      if (aiPanel.keyboard?.group) aiPanel.keyboard.group.visible = false;
      if (aiPanel.loading?.group) aiPanel.loading.group.visible = false;
    }
  }

  function kbCanvasToLocal(px, py, z = 0.006) {
    return new THREE.Vector3(
      (px / KB_CANVAS.w - 0.5) * KB_PLANE.w,
      (0.5 - py / KB_CANVAS.h) * KB_PLANE.h,
      z,
    );
  }

  function drawAiKeyboardCanvas(shift = false, targetCanvas = null) {
    const layout = keyboardLayout({ width: KB_CANVAS.w, height: KB_CANVAS.h, shift });
    const canvas = targetCanvas || document.createElement("canvas");
    canvas.width = KB_CANVAS.w;
    canvas.height = KB_CANVAS.h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, KB_CANVAS.w, KB_CANVAS.h);
    fillDarkMetalChrome(ctx, KB_CANVAS.w, KB_CANVAS.h, 22);
    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 18px Arial,sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("KEYBOARD · TAP KEYS TO TYPE THE PROMPT", 24, 8);
    for (const key of layout.keys) {
      const g = ctx.createLinearGradient(key.x, key.y, key.x, key.y + key.h);
      g.addColorStop(0, "#334155");
      g.addColorStop(1, "#1e293b");
      ctx.fillStyle = g;
      roundRect(ctx, key.x, key.y, key.w, key.h, 10);
      ctx.fill();
      ctx.fillStyle = "#f8fafc";
      ctx.font = key.key === "space" || key.key === "done" ? "bold 22px Arial,sans-serif" : "bold 26px Arial,sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(key.label), key.x + key.w / 2, key.y + key.h / 2);
    }
    return canvas;
  }

  function syncAiKeyboardHits() {
    if (!aiPanel?.keyboard) return;
    const kb = aiPanel.keyboard;
    for (const h of kb.hits || []) {
      try { kb.group.remove(h); } catch (_) {}
      try { h.geometry?.dispose?.(); } catch (_) {}
      try { h.material?.dispose?.(); } catch (_) {}
    }
    kb.hits = [];
    if (!aiKeyboardOpen) return;
    const layout = keyboardLayout({ width: KB_CANVAS.w, height: KB_CANVAS.h, shift: aiKeyboardShift });
    for (const key of layout.keys) {
      const w = (key.w / KB_CANVAS.w) * KB_PLANE.w;
      const h = (key.h / KB_CANVAS.h) * KB_PLANE.h;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.max(w, 0.018), Math.max(h, 0.018)),
        new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.001,
          depthTest: true,
          depthWrite: true,
          side: THREE.DoubleSide,
        }),
      );
      mesh.position.copy(kbCanvasToLocal(key.x + key.w / 2, key.y + key.h / 2, 0.008));
      mesh.renderOrder = 2054;
      mesh.frustumCulled = false;
      mesh.userData.xrAiHit = key.id;
      mesh.userData.xrWorldDepth = true;
      kb.group.add(mesh);
      kb.hits.push(mesh);
    }
    markWorldUi(kb.group);
  }

  function ensureAiKeyboard() {
    const panel = ensureAiPanel();
    if (panel.keyboard) return panel.keyboard;
    const canvas = drawAiKeyboardCanvas(false);
    const tex = sharpenCanvasTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(KB_PLANE.w, KB_PLANE.h),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: true,
      }),
    );
    plane.renderOrder = 2053;
    plane.frustumCulled = false;
    plane.userData.xrAiKeyboard = true;
    const group = new THREE.Group();
    group.add(plane);
    group.position.set(0, -AI_PLANE.h / 2 - KB_PLANE.h / 2 - 0.018, 0.01);
    group.visible = false;
    panel.group.add(group);
    panel.keyboard = { group, plane, tex, canvas, hits: [] };
    markWorldUi(group);
    return panel.keyboard;
  }

  function refreshAiKeyboard() {
    if (!aiPanel?.keyboard && !aiKeyboardOpen) return;
    const kb = ensureAiKeyboard();
    kb.group.visible = !!aiKeyboardOpen && !!aiPanel?.group?.visible;
    const hitsKey = `${kb.group.visible ? 1 : 0}|${aiKeyboardShift ? 1 : 0}`;
    if (!kb.group.visible) {
      if (kb.hitsKey !== hitsKey) {
        syncAiKeyboardHits();
        kb.hitsKey = hitsKey;
      }
      return;
    }
    const nextSig = aiKeyboardShift ? "1" : "0";
    if (shouldRedrawXrConsole({ lastSig: kb.lastSig, nextSig })) {
      const canvas = drawAiKeyboardCanvas(aiKeyboardShift, kb.canvas);
      kb.canvas = canvas;
      kb.tex.image = canvas;
      kb.tex.needsUpdate = true;
      kb.lastSig = nextSig;
    }
    if (kb.hitsKey !== hitsKey) {
      syncAiKeyboardHits();
      kb.hitsKey = hitsKey;
    }
  }

  function openAiKeyboard() {
    aiKeyboardOpen = true;
    ensureAiKeyboard();
    refreshAiPromptPanel();
    if (aiPanel) aiPanel.status = "Type on the keyboard";
  }

  function closeAiKeyboard() {
    aiKeyboardOpen = false;
    aiKeyboardShift = false;
    refreshAiKeyboard();
    refreshAiPromptPanel();
  }

  function loadCanvasToLocal(px, py, z = 0.006) {
    return new THREE.Vector3(
      (px / LOAD_CANVAS.w - 0.5) * LOAD_PLANE.w,
      (0.5 - py / LOAD_CANVAS.h) * LOAD_PLANE.h,
      z,
    );
  }

  function drawAiLoadingCanvas(state = {}, targetCanvas = null) {
    const parts = Array.isArray(state.mcmasterParts) ? state.mcmasterParts : [];
    const layout = loadingScreenLayout({
      width: LOAD_CANVAS.w,
      height: LOAD_CANVAS.h,
      scroll: aiLoadingScroll,
      parts,
    });
    const canvas = targetCanvas || document.createElement("canvas");
    canvas.width = LOAD_CANVAS.w;
    canvas.height = LOAD_CANVAS.h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, LOAD_CANVAS.w, LOAD_CANVAS.h);
    fillDarkMetalChrome(ctx, LOAD_CANVAS.w, LOAD_CANVAS.h, 28);
    fillDarkMetalHeader(ctx, LOAD_CANVAS.w, layout.headerEnd, 28);
    ctx.fillStyle = "#f1f5f9";
    ctx.font = "bold 34px Arial,sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Generate", 36, 36);
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "bold 18px Arial,sans-serif";
    ctx.fillText(String(state.harness || "Loading screen").slice(0, 42), 36, 66);
    drawWindowCloseX(ctx, LOAD_CANVAS.w, layout.headerEnd);

    const generating = !!state.generating;
    const pct = Math.max(0, Math.min(100, Number(state.genPct || 0)));
    ctx.fillStyle = "#020617";
    roundRect(ctx, 40, layout.progressY, LOAD_CANVAS.w - 80, layout.progressH, 12);
    ctx.fill();
    if (generating) {
      ctx.fillStyle = "#14532d";
      roundRect(ctx, 40, layout.progressY, Math.max(24, ((LOAD_CANVAS.w - 80) * pct) / 100), layout.progressH, 12);
      ctx.fill();
      const ang = ((Number(state.now) || 0) / 180) % (Math.PI * 2);
      ctx.strokeStyle = "#4ade80";
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(64, layout.progressY + layout.progressH / 2, 14, ang, ang + Math.PI * 1.35);
      ctx.stroke();
    }
    ctx.fillStyle = "#bbf7d0";
    ctx.font = "bold 22px Arial,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      `${String(state.genLabel || (generating ? "Generating…" : "Idle")).slice(0, 40)}${pct ? ` · ${pct}%` : ""}`,
      LOAD_CANVAS.w / 2,
      layout.progressY + layout.progressH / 2,
    );

    let y = layout.listY;
    const checklist = Array.isArray(state.checklist) ? state.checklist : [];
    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 18px Arial,sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("PIPELINE", 40, y - 10);
    y += 8;
    const pipe = checklist.slice(0, 8);
    if (!pipe.length) {
      ctx.fillStyle = "#64748b";
      ctx.font = "20px Arial,sans-serif";
      ctx.fillText("Waiting for generate steps…", 48, y + 18);
      y += 40;
    }
    pipe.forEach((item) => {
      const st = String(item.status || item.state || "pending");
      ctx.fillStyle = st === "done" || st === "complete" ? "#22c55e" : (st === "running" || st === "active" ? "#38bdf8" : "#334155");
      roundRect(ctx, 40, y, LOAD_CANVAS.w - 80, 36, 8);
      ctx.fill();
      ctx.fillStyle = "#f8fafc";
      ctx.font = "20px Arial,sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(`${st === "done" || st === "complete" ? "✓" : "·"}  ${String(item.label || item.id || "Step").slice(0, 48)}`, 56, y + 18);
      y += 42;
    });

    y += 16;
    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 18px Arial,sans-serif";
    ctx.fillText("MCMASTER PARTS", 40, y);
    y += 14;
    const start = layout.start;
    const slice = parts.slice(start, start + layout.visible);
    if (!slice.length) {
      ctx.fillStyle = "#64748b";
      ctx.font = "20px Arial,sans-serif";
      ctx.fillText("No catalog parts listed yet.", 48, y + 28);
      y += 56;
    }
    slice.forEach((row) => {
      ctx.fillStyle = "#0f172a";
      roundRect(ctx, 40, y, LOAD_CANVAS.w - 80, layout.rowH - 8, 12);
      ctx.fill();
      ctx.fillStyle = "#1e3a5f";
      roundRect(ctx, 52, y + 10, 72, 72, 10);
      ctx.fill();
      const url = mcmasterThumbUrl(row, { projectId: state.projectId });
      const bmp = url ? getAiThumbImg(url) : null;
      if (bmp) {
        ctx.drawImage(bmp, 52, y + 10, 72, 72);
      } else {
        ctx.fillStyle = "#7dd3fc";
        ctx.font = "bold 16px Arial,sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(row.part_number || "PN").slice(0, 8), 88, y + 46);
      }
      ctx.textAlign = "left";
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 22px Arial,sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText(String(row.description || row.part_number || "Part").slice(0, 36), 140, y + 14);
      ctx.fillStyle = "#67e8f9";
      ctx.font = "18px Arial,sans-serif";
      ctx.fillText(
        `${row.qty || "1"}×  ${String(row.part_number || "")}  ${String(row.status || "").slice(0, 14)}`,
        140,
        y + 44,
      );
      if (row.used_in) {
        ctx.fillStyle = "#94a3b8";
        ctx.fillText(String(row.used_in).slice(0, 40), 140, y + 66);
      }
      y += layout.rowH;
    });

    y += 8;
    ctx.fillStyle = "#94a3b8";
    ctx.font = "bold 18px Arial,sans-serif";
    ctx.fillText("UPDATES", 40, y);
    y += 18;
    const activity = Array.isArray(state.activity) ? state.activity.slice(-4) : [];
    if (!activity.length) {
      ctx.fillStyle = "#64748b";
      ctx.font = "20px Arial,sans-serif";
      ctx.fillText(String(state.thinking || "No updates yet.").slice(0, 60), 48, y + 8);
    } else {
      activity.forEach((row) => {
        const text = typeof row === "string" ? row : (row.text || "");
        ctx.fillStyle = "#cbd5e1";
        ctx.font = "20px Arial,sans-serif";
        ctx.fillText(String(text).slice(0, 58), 48, y);
        y += 26;
      });
    }
    if (state.improvedPrompt) {
      y += 10;
      ctx.fillStyle = "#94a3b8";
      ctx.font = "bold 18px Arial,sans-serif";
      ctx.fillText("IMPROVED PROMPT", 40, y);
      y += 22;
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "20px Arial,sans-serif";
      wrapTextLines(ctx, String(state.improvedPrompt), LOAD_CANVAS.w - 90, 3).forEach((line) => {
        ctx.fillText(line, 48, y);
        y += 24;
      });
    }

    ctx.fillStyle = "#334155";
    roundRect(ctx, layout.up.x, layout.up.y, layout.up.w, layout.up.h, 10);
    ctx.fill();
    roundRect(ctx, layout.down.x, layout.down.y, layout.down.w, layout.down.h, 10);
    ctx.fill();
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "bold 22px Arial,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("▲ Parts", layout.up.x + layout.up.w / 2, layout.up.y + layout.up.h / 2);
    ctx.fillText("▼ Parts", layout.down.x + layout.down.w / 2, layout.down.y + layout.down.h / 2);
    return canvas;
  }

  function syncAiLoadingHits() {
    if (!aiPanel?.loading) return;
    const load = aiPanel.loading;
    for (const h of load.hits || []) {
      try { load.group.remove(h); } catch (_) {}
      try { h.geometry?.dispose?.(); } catch (_) {}
      try { h.material?.dispose?.(); } catch (_) {}
    }
    load.hits = [];
    if (!aiLoadingOpen) return;
    const layout = loadingScreenLayout({
      width: LOAD_CANVAS.w,
      height: LOAD_CANVAS.h,
      scroll: aiLoadingScroll,
      parts: readAiState().mcmasterParts || [],
    });
    const specs = [
      ["load_close", layout.close],
      ["load_drag", { x: 8, y: 8, w: LOAD_CANVAS.w - 160, h: layout.headerEnd - 12 }],
      ["load_up", layout.up],
      ["load_down", layout.down],
    ];
    for (const [id, box] of specs) {
      const w = (box.w / LOAD_CANVAS.w) * LOAD_PLANE.w;
      const h = (box.h / LOAD_CANVAS.h) * LOAD_PLANE.h;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.max(w, 0.02), Math.max(h, 0.02)),
        new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.001,
          depthTest: true,
          depthWrite: true,
          side: THREE.DoubleSide,
        }),
      );
      mesh.position.copy(loadCanvasToLocal(box.x + box.w / 2, box.y + box.h / 2, 0.008));
      mesh.renderOrder = 2056;
      mesh.frustumCulled = false;
      mesh.userData.xrAiHit = id;
      mesh.userData.xrWorldDepth = true;
      load.group.add(mesh);
      load.hits.push(mesh);
    }
    markWorldUi(load.group);
  }

  function ensureAiLoading() {
    const panel = ensureAiPanel();
    if (panel.loading) return panel.loading;
    const canvas = drawAiLoadingCanvas(readAiState());
    const tex = sharpenCanvasTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(LOAD_PLANE.w, LOAD_PLANE.h),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: true,
      }),
    );
    plane.renderOrder = 2055;
    plane.frustumCulled = false;
    plane.userData.xrAiLoading = true;
    const group = new THREE.Group();
    group.add(plane);
    group.position.set(-AI_PLANE.w - 0.03, 0.02, 0.01);
    group.visible = false;
    panel.group.add(group);
    panel.loading = { group, plane, tex, canvas, hits: [] };
    markWorldUi(group);
    return panel.loading;
  }

  function refreshAiLoading() {
    if (!aiPanel?.loading && !aiLoadingOpen) return;
    const load = ensureAiLoading();
    load.group.visible = !!aiLoadingOpen && !!aiPanel?.group?.visible;
    const hitsKey = load.group.visible ? "1" : "0";
    if (!load.group.visible) {
      if (load.hitsKey !== hitsKey) {
        syncAiLoadingHits();
        load.hitsKey = hitsKey;
      }
      return;
    }
    const state = readAiState();
    const nextSig = xrAiPanelSignature(state);
    if (shouldRedrawXrConsole({ lastSig: load.lastSig, nextSig })) {
      const canvas = drawAiLoadingCanvas(state, load.canvas);
      load.canvas = canvas;
      load.tex.image = canvas;
      load.tex.needsUpdate = true;
      load.lastSig = nextSig;
    }
    if (load.hitsKey !== hitsKey) {
      syncAiLoadingHits();
      load.hitsKey = hitsKey;
    }
  }

  function openAiLoading() {
    aiLoadingOpen = true;
    ensureAiLoading();
    refreshAiPromptPanel();
  }

  function closeAiLoading() {
    aiLoadingOpen = false;
    refreshAiLoading();
  }

  function viewCanvasToLocal(px, py) {
    return new THREE.Vector3(
      (px / VIEW_CANVAS.w - 0.5) * VIEW_PLANE.w,
      (0.5 - py / VIEW_CANVAS.h) * VIEW_PLANE.h,
      0.006,
    );
  }

  function makeViewHitTarget(id, px, py, pw, ph) {
    const w = (pw / VIEW_CANVAS.w) * VIEW_PLANE.w;
    const h = (ph / VIEW_CANVAS.h) * VIEW_PLANE.h;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(w, 0.02), Math.max(h, 0.02)),
      new THREE.MeshBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.001,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.position.copy(viewCanvasToLocal(px + pw / 2, py + ph / 2));
    mesh.renderOrder = 2062;
    mesh.frustumCulled = false;
    mesh.userData.xrViewHit = id;
    return mesh;
  }

  function viewToolCell(index) {
    const cols = VIEW_CANVAS.cols;
    const col = index % cols;
    const row = Math.floor(index / cols);
    const pad = 28;
    const top = VIEW_CANVAS.headerEnd + 18;
    const cellW = (VIEW_CANVAS.w - pad * 2) / cols;
    const cellH = (VIEW_CANVAS.h - top - 36) / Math.ceil(VIEW_TOOLS.length / cols);
    return {
      x: pad + col * cellW + 8,
      y: top + row * cellH + 6,
      w: cellW - 16,
      h: cellH - 12,
    };
  }

  function drawViewPanelCanvas() {
    const width = VIEW_CANVAS.w;
    const height = VIEW_CANVAS.h;
    const canvas = viewPanel?.canvas || document.createElement("canvas");
    const ctx = bindHudCanvas2d(canvas, width, height);
    fillXrGridChrome(ctx, width, height, 24);
    fillDarkMetalHeader(ctx, width, VIEW_CANVAS.headerEnd, 24);
    drawHudLabel(ctx, "View", 28, Math.round(VIEW_CANVAS.headerEnd * 0.42), {
      font: "800 42px Arial,sans-serif",
      lineWidth: 8,
      maxWidth: width - 168,
    });
    drawHudLabel(ctx, "LEFT STICK MOVE · RIGHT STICK TURN", 28, Math.round(VIEW_CANVAS.headerEnd * 0.74), {
      font: "800 20px Arial,sans-serif",
      fill: "#7dd3fc",
      lineWidth: 6,
      maxWidth: width - 168,
    });
    drawWindowOverflowDots(ctx, width, VIEW_CANVAS.headerEnd);
    drawWindowCloseX(ctx, width, VIEW_CANVAS.headerEnd);
    paintHudOverflowDropdown(ctx, width, VIEW_CANVAS.headerEnd, {
      overflowOpen: !!hudOverflowOpen.view,
      locked: isXrHudLocked("view", hudStorage()),
    });
    VIEW_TOOLS.forEach((tool, i) => {
      const cell = viewToolCell(i);
      ctx.fillStyle = "rgba(15,23,42,0.28)";
      roundRect(ctx, cell.x, cell.y, cell.w, cell.h, 16);
      ctx.fill();
      const iconCx = tool.split ? cell.x + (cell.w - VIEW_TOOL_SPLIT_PX) / 2 : cell.x + cell.w / 2;
      const hex = `#${(tool.color >>> 0).toString(16).padStart(6, "0")}`;
      ctx.beginPath();
      ctx.arc(iconCx, cell.y + cell.h * 0.38, Math.min(cell.w, cell.h) * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = hex;
      ctx.fill();
      drawFilledIcon(ctx, tool.icon, iconCx, cell.y + cell.h * 0.38, Math.min(cell.w, cell.h) * 0.42, "#ffffff");
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 22px Arial,sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(tool.label, iconCx, cell.y + cell.h * 0.78);
      if (tool.split) {
        const sx = cell.x + cell.w - VIEW_TOOL_SPLIT_PX;
        ctx.fillStyle = "rgba(226,232,240,0.18)";
        ctx.fillRect(sx, cell.y + 10, 1, cell.h - 20);
        ctx.beginPath();
        ctx.moveTo(sx + VIEW_TOOL_SPLIT_PX * 0.38, cell.y + cell.h * 0.42);
        ctx.lineTo(sx + VIEW_TOOL_SPLIT_PX * 0.62, cell.y + cell.h * 0.42);
        ctx.lineTo(sx + VIEW_TOOL_SPLIT_PX * 0.5, cell.y + cell.h * 0.58);
        ctx.closePath();
        ctx.fillStyle = "#e2e8f0";
        ctx.fill();
      }
    });
    return canvas;
  }

  function ensureViewPanel() {
    if (viewPanel) return viewPanel;
    const canvas = drawViewPanelCanvas();
    const tex = sharpenCanvasTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(VIEW_PLANE.w, VIEW_PLANE.h),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    plane.renderOrder = 2060;
    plane.frustumCulled = false;
    plane.userData.xrViewPanel = true;
    const hits = [];
    hits.push(makeViewHitTarget("hide", VIEW_CANVAS.w - 88, 8, 80, VIEW_CANVAS.headerEnd - 12));
    hits.push(makeViewHitTarget("drag", 8, 8, VIEW_CANVAS.w - 100, VIEW_CANVAS.headerEnd - 12));
    VIEW_TOOLS.forEach((tool, i) => {
      const cell = viewToolCell(i);
      if (tool.split) {
        hits.push(makeViewHitTarget(tool.id, cell.x, cell.y, cell.w - VIEW_TOOL_SPLIT_PX, cell.h));
        hits.push(makeViewHitTarget(tool.split, cell.x + cell.w - VIEW_TOOL_SPLIT_PX, cell.y, VIEW_TOOL_SPLIT_PX, cell.h));
      } else {
        hits.push(makeViewHitTarget(tool.id, cell.x, cell.y, cell.w, cell.h));
      }
    });
    const titleBar = new THREE.Mesh(
      new THREE.PlaneGeometry(VIEW_PLANE.w - 0.07, 0.045),
      new THREE.MeshBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.001,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    titleBar.position.set(-0.018, VIEW_PLANE.h / 2 - 0.022, 0.007);
    titleBar.renderOrder = 2061;
    titleBar.frustumCulled = false;
    titleBar.userData.xrViewHit = "drag";
    viewPanel = { group: new THREE.Group(), plane, titleBar, tex, canvas, hits };
    viewPanel.group.add(plane);
    viewPanel.group.add(titleBar);
    hits.forEach((h) => viewPanel.group.add(h));
    viewPanel.group.visible = false;
    markWorldUi(viewPanel.group);
    xrHud.add(viewPanel.group);
    return viewPanel;
  }

  function refreshViewPanel() {
    if (!viewPanel) return;
    const canvas = drawViewPanelCanvas();
    viewPanel.canvas = canvas;
    viewPanel.tex.image = canvas;
    viewPanel.tex.needsUpdate = true;
  }

  function openViewPanel(opts = {}) {
    const panel = ensureViewPanel();
    refreshViewPanel();
    panel.group.visible = true;
    const forcePlace = opts.forcePlace === true;
    ensureHudWorldParent(panel.group);
    if (!forcePlace && panel.worldPlaced && panelWorldPosIsUsable(panel.group)) {
      return;
    }
    if (!forcePlace) {
      if (opts.keepPose && panelWorldPosIsUsable(panel.group)) {
        panel.worldPlaced = true;
        return;
      }
      if (applySavedPanelPose("view", panel.group)) {
        panel.worldPlaced = true;
        return;
      }
    }
    const pos = spawnPanelWorldPos(-0.22);
    setPanelWorldPose(panel.group, pos);
    facePanelTowardHead(panel.group, pos);
    panel.worldPlaced = true;
    savePanelPose("view", panel.group);
  }

  function closeViewPanel() {
    if (viewPanel) {
      viewPanel.group.visible = false;
      try { savePanelPose("view", viewPanel.group); } catch (_) {}
    }
  }

  function toggleViewPanel() {
    if (viewPanel?.group?.visible) {
      closeViewPanel();
      return;
    }
    if (deferHudOpenIfNeeded("view", viewPanel, () => openViewPanel({ forcePlace: false }))) return;
    openViewPanel({ forcePlace: false });
  }

  const WS_CANVAS = { w: 720, h: 640, headerEnd: 68, tabStart: 76, tabEnd: 122, rowH: 50, listTop: 154, footerTop: 600 };
  const WS_PLANE = { w: 0.40, h: 0.36 };
  const WS_SCENE_ROWS = [
    { id: "voice_toggle" },
    { id: "passthrough" },
    { id: "capture" },
    { id: "settings" },
  ];

  function publicRoomOthers() {
    try {
      const me = String((typeof getLocalUserId === "function" && getLocalUserId()) || "");
      const users = (typeof getSocialState === "function" && getSocialState()?.users) || [];
      return roomOthersForShare(users, me);
    } catch {
      return [];
    }
  }

  function workspaceLines() {
    if (workspaceCreatePrompt) {
      return workspaceCreatePromptLines({
        name: workspaceCreatePrompt.name || "",
        shareAsk: !!workspaceCreatePrompt.shareAsk,
        othersCount: publicRoomOthers().length,
      });
    }
    if (workspaceLayoutPrompt) {
      const names = workspaceLayoutPrompt.names || layoutNameSuggestions(layoutStore.layouts);
      return [
        { id: "", label: "Name this window layout", kind: "hint", icon: "workspace" },
        ...names.map((n) => ({ id: `ws-layout-save:${n}`, label: `Save as ${n}`, kind: "action", icon: "export" })),
        { id: "ws-layout-cancel", label: "Cancel", kind: "action", icon: "undo" },
      ];
    }
    if (workspaceInvitePrompt) {
      return [
        { id: "ws-invite-yes", label: "Invite everyone in the room", kind: "action", icon: "social" },
        { id: "ws-invite-no", label: "Not now", kind: "action", icon: "workspace" },
      ];
    }
    hydrateXrLayouts();
    let items = [];
    try { items = (typeof getWorkspaceProjects === "function" && getWorkspaceProjects()) || []; } catch { items = []; }
    const lines = [];
    if (workspaceTab === "scene" || workspaceSceneMenu) {
      const scenes = workspaceEnvironmentLines({
        saved: loadXrEnvironmentListForMenu(), sceneId: xrSceneKind, sceneMenu: true,
      }).filter(line => line.id !== "ws-env-back");
      if (!workspaceSceneMenu) lines.push(...scenes);
      else return [...scenes, {id:"ws-scene-settings-open",label:"Open Scene Settings",kind:"action",icon:"settings"}];
      const scene = workspaceSceneSettingsLines({
        micOn: isMicEnabledUi(),
        passthroughOn,
        recording: !!captureRecState.recording,
        acceptPrint: !!printerPrefs.accept_sends,
        printerOutline: !!printerPrefs.show_outline,
        printerModel: !!printerPrefs.show_model,
      });
      void WS_SCENE_ROWS;
      lines.push(...scene);
      lines.push(...workspaceEnvironmentLines({ sceneMenu: false }));
      return lines;
    }
    if (workspaceTab === "wiring" && globalThis.window?.Render3DWiringContext?.guide) return wiringGuideRows(window.Render3DWiringContext.guide, xrWiringView.isActive());
    if (workspaceRefsOpen) {
      let files = [];
      try { files = (typeof getReferenceFiles === "function" && getReferenceFiles()) || []; } catch { files = []; }
      if (!files.length) {
        try { files = (typeof getProjectFiles === "function" && getProjectFiles()) || []; } catch { files = []; }
      }
      return workspaceReferenceLines(files);
    }
    lines.push({id:"ws-wiring",label:"Wiring · 3D harness and guided assembly",kind:"action",icon:"model"});
    lines.push(workspaceReferenceButtonLine());
    lines.push({ id: "ws-save-layout", label: "Save menu placement", kind: "action", icon: "export" });
    if (layoutStore.lastId) {
      const last = layoutById(layoutStore, layoutStore.lastId);
      if (last) {
        lines.push({
          id: "ws-layout-last",
          label: `Use last · ${last.name}`,
          kind: "action",
          icon: "restore",
        });
      }
    }
    workspaceGallery = layoutStore.layouts.slice(0, 3);
    for (const row of workspaceGallery) {
      lines.push({
        id: `ws-layout:${row.id}`,
        label: row.name || "Layout",
        kind: "layout",
        icon: "workspace",
        layout: row,
        active: layoutStore.lastId === row.id,
      });
    }
    if (publicRoomJoined()) {
      let pid = "";
      try { pid = String((typeof getProjectId === "function" && getProjectId()) || ""); } catch { pid = ""; }
      if (pid) {
        lines.push({ id: "ws-save", label: "Save room to this project", kind: "action", icon: "export" });
      }
      lines.push({ id: "ws-save-new", label: "Save as a new project", kind: "action", icon: "plus" });
      for (const row of workspaceBoardLines({
        active: !!xrBoard?.state?.active,
        mode: xrBoard?.state?.mode || "god",
        teleport: !!xrBoard?.state?.teleport,
      })) {
        lines.push(row);
      }
    }
    lines.push({ id: "ws-add", label: "+ Add project", kind: "action", icon: "plus" });
    if (!items.length) {
      lines.push({ id: "", label: "No projects in this workspace", kind: "hint", icon: "workspace" });
      return lines;
    }
    for (const it of items.slice(0, 6)) {
      lines.push({
        id: it.id,
        label: it.label || it.name || it.id,
        active: !!it.active,
        kind: "project",
        icon: "front",
        deleteId: `ws-del:${it.id}`,
      });
    }
    return lines;
  }

  function workspaceShowsTabs() {
    return !workspaceLayoutPrompt && !workspaceInvitePrompt && !workspaceCreatePrompt;
  }

  function workspaceTabRects() {
    const tabs = WORKSPACE_PANEL_TABS;
    const tabW = 150;
    return tabs.map((tab, i) => ({
      id: tab.id,
      label: tab.label,
      x: 24 + i * (tabW + 10),
      w: tabW,
      y: WS_CANVAS.tabStart,
      h: WS_CANVAS.tabEnd - WS_CANVAS.tabStart,
    }));
  }

  function workspaceListTop() {
    return workspaceShowsTabs() ? WS_CANVAS.listTop : 108;
  }

  function drawWorkspaceCanvas() {
    const width = WS_CANVAS.w;
    const height = WS_CANVAS.h;
    const canvas = workspacePanel?.canvas || document.createElement("canvas");
    const ctx = bindHudCanvas2d(canvas, width, height);
    fillXrGridChrome(ctx, width, height, 24);
    fillDarkMetalHeader(ctx, width, WS_CANVAS.headerEnd, 24);
    ctx.fillStyle = "#f1f5f9";
    ctx.font = "bold 32px Arial,sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    let title = "Workspace";
    try { title = String(getWorkspaceLabel?.() || "Workspace"); } catch { /* ignore */ }
    ctx.fillText(title.slice(0, 22), 28, Math.round(WS_CANVAS.headerEnd * 0.45));
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "bold 15px Arial,sans-serif";
    const sub = workspaceCreatePrompt?.shareAsk
      ? "SHARE WITH PEOPLE IN THIS ROOM?"
      : workspaceCreatePrompt
        ? "NAME THIS PROJECT"
        : workspaceInvitePrompt
      ? "INVITE PEOPLE IN THIS ROOM?"
      : workspaceLayoutPrompt
        ? "NAME THIS WINDOW LAYOUT"
        : workspaceTab === "scene"
          ? "MIC · PASS · CAPTURE · SETTINGS"
          : "LAYOUTS · ADD · OPEN · REMOVE";
    ctx.fillText(sub, 28, Math.round(WS_CANVAS.headerEnd * 0.74));
    drawWindowCloseX(ctx, width, WS_CANVAS.headerEnd);
    if (workspaceShowsTabs()) {
      for (const tab of workspaceTabRects()) {
        const on = (workspaceTab === "scene" || workspaceSceneMenu) ? tab.id === "scene" : tab.id === "projects";
        ctx.fillStyle = on ? "rgba(14,165,233,0.38)" : "rgba(15,23,42,0.45)";
        roundRect(ctx, tab.x, tab.y, tab.w, tab.h, 12);
        ctx.fill();
        ctx.fillStyle = on ? "#e0f2fe" : "#94a3b8";
        ctx.font = "bold 20px Arial,sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(tab.label, tab.x + tab.w / 2, tab.y + tab.h / 2);
      }
    }
    const listTop = workspaceListTop();
    const lines = workspacePanel?.lines || workspaceLines();
    lines.forEach((line, i) => {
      const y = listTop + i * WS_CANVAS.rowH;
      if (y > WS_CANVAS.footerTop - 20) return;
      ctx.fillStyle = line.active ? "rgba(14,165,233,0.28)" : "rgba(15,23,42,0.32)";
      roundRect(ctx, 24, y - 24, width - 48, 48, 14);
      ctx.fill();
      if (line.kind === "layout") {
        const cells = layoutThumbCells(line.layout || {});
        cells.slice(0, 4).forEach((cell, ci) => {
          ctx.fillStyle = cell.color;
          ctx.fillRect(36 + ci * 14, y - 10, 12, 18);
        });
        ctx.fillStyle = "#e2e8f0";
        ctx.font = "bold 22px Arial,sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(String(line.label || "").slice(0, 22), 100, y);
      } else if (line.kind === "hint") {
        ctx.fillStyle = "#7dd3fc";
        ctx.font = "bold 20px Arial,sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(String(line.label || "").slice(0, 42), 40, y);
      } else if (line.kind === "field") {
        ctx.fillStyle = "rgba(14,165,233,0.22)";
        roundRect(ctx, 24, y - 24, width - 48, 48, 14);
        ctx.fill();
        ctx.fillStyle = "#e2e8f0";
        ctx.font = "bold 22px Arial,sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(String(line.label || "").slice(0, 28), 40, y);
      } else {
        ctx.fillStyle = "#e2e8f0";
        ctx.font = "bold 22px Arial,sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(String(line.label || "").slice(0, 28), 40, y);
      }
      if (line.deleteId) {
        ctx.fillStyle = workspaceDeleteArmedId === line.id ? "#f87171" : "rgba(248,113,113,0.85)";
        ctx.font = "bold 20px Arial,sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(workspaceDeleteArmedId === line.id ? "Tap again" : "✕", width - 40, y);
      }
    });
    ctx.fillStyle = "#94a3b8";
    ctx.font = "16px Arial,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(
      workspaceTab === "scene"
        ? "Grip the header to move · Scene settings for this room"
        : "Grip the header to move · pick a layout to place windows",
      width / 2,
      height - 28,
    );
    return canvas;
  }

  function ensureWorkspaceKeyboard() {
    const panel = ensureWorkspacePanel();
    if (panel.keyboard) return panel.keyboard;
    const canvas = drawAiKeyboardCanvas(false);
    const tex = sharpenCanvasTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(KB_PLANE.w, KB_PLANE.h),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: true,
        depthWrite: true,
      }),
    );
    plane.renderOrder = 2065;
    plane.frustumCulled = false;
    plane.userData.xrWorkspaceKeyboard = true;
    const group = new THREE.Group();
    group.add(plane);
    group.position.set(0, -WS_PLANE.h / 2 - KB_PLANE.h / 2 - 0.018, 0.01);
    group.visible = false;
    panel.group.add(group);
    panel.keyboard = { group, plane, tex, canvas, hits: [] };
    markWorldUi(group);
    return panel.keyboard;
  }

  function syncWorkspaceKeyboardHits() {
    const kb = workspacePanel?.keyboard;
    if (!kb) return;
    for (const h of kb.hits || []) {
      try { kb.group.remove(h); } catch (_) {}
      try { h.geometry?.dispose?.(); } catch (_) {}
      try { h.material?.dispose?.(); } catch (_) {}
    }
    kb.hits = [];
    if (!wsKeyboardOpen) return;
    const layout = keyboardLayout({ width: KB_CANVAS.w, height: KB_CANVAS.h, shift: wsKeyboardShift });
    for (const key of layout.keys) {
      const w = (key.w / KB_CANVAS.w) * KB_PLANE.w;
      const h = (key.h / KB_CANVAS.h) * KB_PLANE.h;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.max(w, 0.018), Math.max(h, 0.018)),
        new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.001,
          depthTest: true,
          depthWrite: true,
          side: THREE.DoubleSide,
        }),
      );
      mesh.position.copy(kbCanvasToLocal(key.x + key.w / 2, key.y + key.h / 2, 0.008));
      mesh.renderOrder = 2066;
      mesh.frustumCulled = false;
      mesh.userData.xrWorkspaceHit = key.id;
      mesh.userData.xrWorldDepth = true;
      kb.group.add(mesh);
      kb.hits.push(mesh);
    }
    markWorldUi(kb.group);
  }

  function refreshWorkspaceKeyboard() {
    if (!workspacePanel?.keyboard && !wsKeyboardOpen) return;
    const kb = ensureWorkspaceKeyboard();
    const naming = !!workspaceCreatePrompt && !workspaceCreatePrompt.shareAsk;
    kb.group.visible = !!wsKeyboardOpen && naming && !!workspacePanel?.group?.visible;
    const hitsKey = `${kb.group.visible ? 1 : 0}|${wsKeyboardShift ? 1 : 0}`;
    if (!kb.group.visible) {
      if (kb.hitsKey !== hitsKey) {
        syncWorkspaceKeyboardHits();
        kb.hitsKey = hitsKey;
      }
      return;
    }
    const nextSig = wsKeyboardShift ? "1" : "0";
    if (shouldRedrawXrConsole({ lastSig: kb.lastSig, nextSig })) {
      const canvas = drawAiKeyboardCanvas(wsKeyboardShift, kb.canvas);
      kb.canvas = canvas;
      kb.tex.image = canvas;
      kb.tex.needsUpdate = true;
      kb.lastSig = nextSig;
    }
    if (kb.hitsKey !== hitsKey) {
      syncWorkspaceKeyboardHits();
      kb.hitsKey = hitsKey;
    }
  }

  function openWorkspaceKeyboard() {
    wsKeyboardOpen = true;
    ensureWorkspaceKeyboard();
    refreshWorkspaceKeyboard();
  }

  function closeWorkspaceKeyboard() {
    wsKeyboardOpen = false;
    wsKeyboardShift = false;
    refreshWorkspaceKeyboard();
  }

  function ensureWorkspacePanel() {
    if (workspacePanel) return workspacePanel;
    workspacePanel = { group: new THREE.Group(), lines: [], canvas: null, tex: null, plane: null, worldPlaced: false };
    const canvas = drawWorkspaceCanvas();
    const tex = sharpenCanvasTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(WS_PLANE.w, WS_PLANE.h),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    plane.renderOrder = 2064;
    plane.frustumCulled = false;
    workspacePanel.canvas = canvas;
    workspacePanel.tex = tex;
    workspacePanel.plane = plane;
    workspacePanel.group.add(plane);
    markWorldUi(workspacePanel.group);
    xrHud.add(workspacePanel.group);
    workspacePanel.group.visible = false;
    return workspacePanel;
  }

  function refreshWorkspacePanel() {
    if (!workspacePanel?.group?.visible) return;
    const panel = workspacePanel;
    panel.lines = workspaceLines();
    const cvs = drawWorkspaceCanvas();
    panel.canvas = cvs;
    if (panel.tex.image !== cvs) panel.tex.image = cvs;
    panel.tex.needsUpdate = true;
    refreshWorkspaceKeyboard();
  }

  function openWorkspacePanel(opts = {}) {
    const panel = ensureWorkspacePanel();
    panel.group.visible = true;
    refreshWorkspacePanel();
    if (workspaceCreatePrompt && !workspaceCreatePrompt.shareAsk) openWorkspaceKeyboard();
    const forcePlace = opts.forcePlace === true;
    ensureHudWorldParent(panel.group);
    if (!forcePlace && panel.worldPlaced && panelWorldPosIsUsable(panel.group)) return;
    if (!forcePlace && opts.keepPose && panelWorldPosIsUsable(panel.group)) {
      panel.worldPlaced = true;
      return;
    }
    if (!forcePlace && applySavedPanelPose("workspace", panel.group)) {
      panel.worldPlaced = true;
      return;
    }
    const pos = spawnPanelWorldPos(0.22);
    setPanelWorldPose(panel.group, pos);
    facePanelTowardHead(panel.group, pos);
    panel.worldPlaced = true;
    savePanelPose("workspace", panel.group);
  }

  function closeWorkspacePanel() {
    closeWorkspaceKeyboard();
    if (workspacePanel) {
      workspacePanel.group.visible = false;
      try { savePanelPose("workspace", workspacePanel.group); } catch (_) {}
    }
  }

  function toggleWorkspacePanel() {
    if (workspacePanel?.group?.visible) closeWorkspacePanel();
    else if (!deferHudOpenIfNeeded("workspace", workspacePanel, () => openWorkspacePanel({ forcePlace: false }))) {
      openWorkspacePanel({ forcePlace: false });
    }
  }

  const AV_CANVAS = { w: 720, h: 640, headerEnd: 68, rowH: 52, listTop: 118, footerTop: 590 };
  const AV_PLANE = { w: 0.42, h: 0.36 };

  function persistLocalAvatar(next, note = "") {
    const uid = localSocialUserId();
    localAvatarSpec = saveAvatarSpec(uid, next);
    poseForceSend = true;
    lastPoseSig = "";
    if (note) menuFooterHint = String(note).slice(0, 72);
    try { refreshAvatarPanel(); } catch (_) {}
  }

  function refreshLocalXrDevice() {
    const sess = session || renderer.xr.getSession?.();
    const profiles = [];
    try {
      for (const src of sess?.inputSources || []) {
        for (const p of src.profiles || []) profiles.push(p);
      }
    } catch { /* ignore */ }
    const blend = sess?.environmentBlendMode || "";
    const mode = workspaceJoin
      ? (workspacePassOn ? "ar" : "vr")
      : presenting
        ? ((sessionMode === "immersive-ar" || blend === "alpha-blend" || blend === "additive") ? "ar" : "vr")
        : "";
    const next = xrHeadsetFromUa({
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      profiles,
      xrMode: mode,
      presenting: presenting || workspaceJoin,
      hasXr: !!sess || workspaceJoin,
    });
    if (next.label !== localXrDevice || next.mode !== localXrMode || next.prop !== localXrProp) {
      localXrDevice = next.label;
      localXrMode = next.mode;
      localXrProp = next.prop;
      poseForceSend = true;
    }
  }

  function drawAvatarCanvas() {
    const width = AV_CANVAS.w;
    const height = AV_CANVAS.h;
    const canvas = avatarPanel?.canvas || document.createElement("canvas");
    const ctx = bindHudCanvas2d(canvas, width, height);
    fillDarkMetalChrome(ctx, width, height, 24);
    fillDarkMetalHeader(ctx, width, AV_CANVAS.headerEnd, 24);
    ctx.fillStyle = "#f1f5f9";
    ctx.font = "bold 32px Arial,sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Avatar", 28, Math.round(AV_CANVAS.headerEnd * 0.45));
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "bold 15px Arial,sans-serif";
    ctx.fillText("BODY · OUTFIT · HORIZON", 28, Math.round(AV_CANVAS.headerEnd * 0.74));
    drawWindowCloseX(ctx, width, AV_CANVAS.headerEnd);
    const lines = avatarPanel?.lines || avatarSettingsLines(localAvatarSpec, {
      quest: canLinkHorizon({ userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "", presenting }),
    });
    lines.forEach((line, i) => {
      const y = AV_CANVAS.listTop + i * AV_CANVAS.rowH;
      if (y > AV_CANVAS.footerTop - 20) return;
      ctx.fillStyle = line.active ? "rgba(14,165,233,0.28)" : "rgba(15,23,42,0.32)";
      roundRect(ctx, 24, y - 22, width - 48, 44, 14);
      ctx.fill();
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 20px Arial,sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(String(line.label || "").slice(0, 34), 40, y);
    });
    ctx.fillStyle = "#94a3b8";
    ctx.font = "15px Arial,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Turntable preview · others see this in the room", width / 2, height - 28);
    return canvas;
  }

  function ensureAvatarPreview(panel) {
    if (panel.preview) return panel.preview;
    const preview = new THREE.Group();
    preview.name = "xr-avatar-preview";
    preview.position.set(0.155, -0.02, 0.08);
    preview.scale.setScalar(0.42);
    const fig = buildProceduralHumanoid(THREE, localAvatarSpec, { prop: localXrProp || "none" });
    fig.position.y = -0.15;
    preview.add(fig);
    preview.userData.figure = fig;
    preview.traverse((o) => { if (o.isMesh) o.raycast = () => {}; });
    panel.group.add(preview);
    panel.preview = preview;
    return preview;
  }

  function refreshAvatarPreview() {
    if (!avatarPanel?.preview) return;
    const prev = avatarPanel.preview.userData.figure;
    if (prev) avatarPanel.preview.remove(prev);
    const fig = buildProceduralHumanoid(THREE, localAvatarSpec, { prop: localXrProp || "none" });
    fig.position.y = -0.15;
    avatarPanel.preview.add(fig);
    avatarPanel.preview.userData.figure = fig;
  }

  function ensureAvatarPanel() {
    if (avatarPanel) return avatarPanel;
    avatarPanel = { group: new THREE.Group(), lines: [], canvas: null, tex: null, plane: null, worldPlaced: false };
    const canvas = drawAvatarCanvas();
    const tex = sharpenCanvasTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(AV_PLANE.w, AV_PLANE.h),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    plane.renderOrder = 2065;
    plane.frustumCulled = false;
    avatarPanel.canvas = canvas;
    avatarPanel.tex = tex;
    avatarPanel.plane = plane;
    avatarPanel.group.add(plane);
    ensureAvatarPreview(avatarPanel);
    markWorldUi(avatarPanel.group);
    xrHud.add(avatarPanel.group);
    avatarPanel.group.visible = false;
    return avatarPanel;
  }

  function refreshAvatarPanel() {
    const panel = ensureAvatarPanel();
    panel.lines = avatarSettingsLines(localAvatarSpec, {
      quest: canLinkHorizon({ userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "", presenting }),
    });
    const cvs = drawAvatarCanvas();
    panel.canvas = cvs;
    panel.tex.image = cvs;
    panel.tex.needsUpdate = true;
    refreshAvatarPreview();
  }

  function openAvatarPanel(opts = {}) {
    const uid = localSocialUserId();
    localAvatarSpec = loadAvatarSpec(uid);
    const panel = ensureAvatarPanel();
    refreshAvatarPanel();
    panel.group.visible = true;
    const forcePlace = opts.forcePlace === true;
    ensureHudWorldParent(panel.group);
    if (!forcePlace && panel.worldPlaced && panelWorldPosIsUsable(panel.group)) return;
    if (!forcePlace && opts.keepPose && panelWorldPosIsUsable(panel.group)) {
      panel.worldPlaced = true;
      return;
    }
    if (!forcePlace && applySavedPanelPose("avatar", panel.group)) {
      panel.worldPlaced = true;
      return;
    }
    const pos = spawnPanelWorldPos(-0.28);
    setPanelWorldPose(panel.group, pos);
    facePanelTowardHead(panel.group, pos);
    panel.worldPlaced = true;
    savePanelPose("avatar", panel.group);
  }

  function closeAvatarPanel() {
    if (avatarPanel) {
      avatarPanel.group.visible = false;
      try { savePanelPose("avatar", avatarPanel.group); } catch (_) {}
    }
  }

  function toggleAvatarPanel() {
    if (avatarPanel?.group?.visible) closeAvatarPanel();
    else if (!deferHudOpenIfNeeded("avatar", avatarPanel, () => openAvatarPanel({ forcePlace: false }))) {
      openAvatarPanel({ forcePlace: false });
    }
  }

  function pickAvatarFromLocal(local) {
    if (!avatarPanel?.group?.visible) return null;
    const halfW = AV_PLANE.w / 2;
    const halfH = AV_PLANE.h / 2;
    const u = (local.x + halfW) / AV_PLANE.w;
    const fromTop = (halfH - local.y) / AV_PLANE.h;
    if (u < 0 || u > 1 || fromTop < 0 || fromTop > 1) return null;
    const px = u * AV_CANVAS.w;
    const py = fromTop * AV_CANVAS.h;
    if (py < AV_CANVAS.headerEnd) {
      if (px > AV_CANVAS.w - 88) return { kind: "avatar-action", id: "hide" };
      return { kind: "avatar-drag" };
    }
    const lines = avatarPanel.lines || [];
    const idx = Math.round((py - AV_CANVAS.listTop) / AV_CANVAS.rowH);
    if (idx < 0 || idx >= lines.length) return { kind: "avatar-chrome" };
    const line = lines[idx];
    return { kind: "avatar-action", id: line?.id || "", line };
  }

  function handleAvatarAction(id) {
    if (!id || id === "hide") {
      closeAvatarPanel();
      return;
    }
    const ctx = {
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
      presenting,
      requireQuest: id === "avatar-source-horizon",
    };
    const { spec, note } = applyAvatarAction(localAvatarSpec, id, ctx);
    persistLocalAvatar(spec, note || (id === "avatar-source-horizon" ? HORIZON_AVATAR_NOTE : ""));
  }

  function pickWorkspaceFromLocal(local) {
    if (!workspacePanel?.group?.visible) return null;
    const halfW = WS_PLANE.w / 2;
    const halfH = WS_PLANE.h / 2;
    const u = (local.x + halfW) / WS_PLANE.w;
    const fromTop = (halfH - local.y) / WS_PLANE.h;
    if (u < 0 || u > 1 || fromTop < 0 || fromTop > 1) return null;
    const px = u * WS_CANVAS.w;
    const py = fromTop * WS_CANVAS.h;
    if (py < WS_CANVAS.headerEnd) {
      if (px > WS_CANVAS.w - 88) return { kind: "workspace-action", id: "hide" };
      return { kind: "workspace-drag" };
    }
    if (workspaceShowsTabs() && py >= WS_CANVAS.tabStart && py < WS_CANVAS.tabEnd) {
      const tab = workspaceTabRects().find((t) => px >= t.x && px <= t.x + t.w);
      if (tab) return { kind: "workspace-action", id: `ws-tab:${tab.id}` };
      return { kind: "workspace-chrome" };
    }
    const listTop = workspaceListTop();
    const lines = workspacePanel.lines || [];
    const idx = Math.round((py - listTop) / WS_CANVAS.rowH);
    if (idx < 0 || idx >= lines.length) return { kind: "workspace-chrome" };
    const line = lines[idx];
    if (line?.deleteId && px > WS_CANVAS.w - 120) {
      return { kind: "workspace-action", id: line.deleteId };
    }
    return { kind: "workspace-action", id: line?.id || "", line };
  }

  function roomUserIdsForSeats() {
    const me = localAuthor();
    const ids = [];
    if (me.id) ids.push(me.id);
    for (const u of socialUsers()) {
      const id = String(u?.id || "").trim();
      if (id && !ids.includes(id)) ids.push(id);
    }
    if (!ids.length) ids.push(me.id || "local");
    return ids;
  }

  function applyLocalSeatLoco(mode) {
    const me = localAuthor();
    const seat = xrBoard.seatForUser(me.id);
    const loco = locomotionForMode({
      mode: mode || xrBoard.state.mode,
      board: xrBoard.state.board,
      seat,
    });
    // Public workspaces share one physical floor, including board/table views.
    if (publicRoomJoined()) loco.p[1] = 0;
    xrBoard.applyLocomotion(renderer, loco);
    return loco;
  }

  function broadcastBoard(extra = {}) {
    try { sendPublicXr?.(xrBoard.packBoardMessage(extra)); } catch { /* ignore */ }
    try { sendCollab?.(xrBoard.packBoardMessage(extra)); } catch { /* ignore */ }
  }

  function confirmTeleportTo(point) {
    if (!point) return;
    const p = point.isVector3 ? point : new THREE.Vector3(point[0], point[1], point[2]);
    xrBoard.setMode("walk");
    xrBoard.captureRefSpace(renderer);
    xrBoard.applyLocomotion(renderer, { p: [p.x, 0, p.z], yaw: xrBoard.state.loco?.yaw || 0 });
    xrBoard.hideTeleportPreview();
    menuFooterHint = "Teleported";
  }

  function seatEveryoneAtRoundTable() {
    ensureXrHeadPose();
    const fwd = headForwardFlat(new THREE.Vector3());
    if (!xrBoard.state.active) {
      xrBoard.setBoardPose(defaultBoardPoseFromHead(_headPos, fwd, { table: true }));
    }
    const seats = assignRoundTableSeats(roomUserIdsForSeats(), xrBoard.state.board);
    xrBoard.applySeats(seats);
    xrBoard.setMode("god");
    xrBoard.setTeleport(false);
    xrBoard.captureRefSpace(renderer);
    applyLocalSeatLoco("god");
    const payload = xrBoard.packTableMessage(seats);
    try { sendPublicXr?.(payload); } catch { /* ignore */ }
    try { sendCollab?.(payload); } catch { /* ignore */ }
    broadcastBoard({ action: "table" });
    menuFooterHint = `Round table · ${seats.length} seat${seats.length === 1 ? "" : "s"}`;
    refreshWorkspacePanel();
    try { onStatus?.("ok", menuFooterHint); } catch (_) {}
  }

  function handleBoardAction(id) {
    const action = String(id || "");
    ensureXrHeadPose();
    const fwd = headForwardFlat(new THREE.Vector3());
    if (action === "ws-board" || action === "board" || action === "ws-walk" || action === "walk"
      || action === "ws-teleport" || action === "teleport" || action === "ws-round-table"
      || action === "round_table" || action === "ws-set-floor" || action === "set_floor") {
      xrBoardUserArmed = true;
    }
    if (action === "ws-board" || action === "board") {
      if (!xrBoard.state.active) {
        xrBoard.setBoardPose(defaultBoardPoseFromHead(_headPos, fwd, { table: true }));
      }
      xrBoard.setMode("god");
      xrBoard.setTeleport(false);
      xrBoard.captureRefSpace(renderer);
      applyLocalSeatLoco("god");
      try { setVoiceDraw(true); } catch (_) {}
      menuFooterHint = "Board · look down and draw · Walk to drop in";
      broadcastBoard({ action: "god" });
      refreshWorkspacePanel();
      syncDock();
      try { onStatus?.("ok", menuFooterHint); } catch (_) {}
      return true;
    }
    if (action === "ws-set-floor" || action === "set_floor") {
      xrBoard.setBoardPose(defaultBoardPoseFromHead(_headPos, fwd, { table: false }));
      xrBoard.setMode("god");
      xrBoard.captureRefSpace(renderer);
      applyLocalSeatLoco("god");
      menuFooterHint = "Floor set · draw on the plane";
      broadcastBoard({ action: "place" });
      refreshWorkspacePanel();
      try { onStatus?.("ok", menuFooterHint); } catch (_) {}
      return true;
    }
    if (action === "ws-walk" || action === "walk") {
      if (!xrBoard.state.active) {
        xrBoard.setBoardPose(defaultBoardPoseFromHead(_headPos, fwd, { table: false }));
      }
      xrBoard.setMode("walk");
      xrBoard.setTeleport(false);
      xrBoard.captureRefSpace(renderer);
      applyLocalSeatLoco("walk");
      activeTool = "grab";
      menuFooterHint = "Walk · Teleport to hop the floor";
      broadcastBoard({ action: "walk" });
      refreshWorkspacePanel();
      syncDock();
      try { onStatus?.("ok", menuFooterHint); } catch (_) {}
      return true;
    }
    if (action === "ws-teleport" || action === "teleport") {
      if (!xrBoard.state.active) {
        xrBoard.setBoardPose(defaultBoardPoseFromHead(_headPos, fwd, { table: false }));
      }
      xrBoard.setMode("walk");
      xrBoard.setTeleport(true);
      xrBoard.captureRefSpace(renderer);
      applyLocalSeatLoco("walk");
      activeTool = "teleport";
      menuFooterHint = "Teleport · aim at the floor and trigger";
      broadcastBoard({ action: "teleport" });
      refreshWorkspacePanel();
      syncDock();
      try { onStatus?.("ok", menuFooterHint); } catch (_) {}
      return true;
    }
    if (action === "ws-round-table" || action === "round_table") {
      seatEveryoneAtRoundTable();
      return true;
    }
    return false;
  }

  function ingestBoardMessage(msg) {
    if (!msg || typeof msg !== "object") return false;
    if (msg.type === 'xr.seat' && msg.action === 'floor-recenter') {
      const seat = msg.seats?.find(s=>s.user_id===localSocialUserId());
      if (seat?.p?.length === 3 && seat.p.every(Number.isFinite) && Number.isFinite(seat.yaw)) applyRoomFloorSeat(seat);
      return true;
    }
    if (msg.type === "xr.board") {
      if (msg.board) xrBoard.setBoardPose(msg.board, { activate: true });
      if (msg.mode === "walk" || msg.action === "walk") xrBoard.setMode("walk");
      else if (msg.action === "place" || msg.action === "god" || msg.mode === "god") xrBoard.setMode("god");
      if (msg.action === "teleport") xrBoard.setTeleport(true);
      refreshWorkspacePanel();
      return true;
    }
    if (msg.type === "xr.table" || msg.type === "xr.seat") {
      if (msg.board) xrBoard.setBoardPose(msg.board, { activate: true });
      const seats = msg.seats || (msg.seat ? [msg.seat] : []);
      if (seats.length) xrBoard.applySeats(seats);
      if (shouldApplyRemoteBoardLoco({ userArmed: xrBoardUserArmed })) {
        xrBoard.captureRefSpace(renderer);
        applyLocalSeatLoco(xrBoard.state.mode || "god");
      }
      refreshWorkspacePanel();
      return true;
    }
    return false;
  }

  function finishNamedWorkspaceCreate() {
    const others = publicRoomOthers();
    const next = finishWorkspaceCreateName({
      name: workspaceCreatePrompt?.name || "",
      others,
    });
    if (next.shareAsk) {
      workspaceCreatePrompt = { name: next.name, shareAsk: true };
      closeWorkspaceKeyboard();
      menuFooterHint = "Share with people in this room?";
      refreshWorkspacePanel();
      return;
    }
    void createNamedWorkspaceProject({ name: next.name, shareRoom: false });
  }

  function createNamedWorkspaceProject({ name = "", shareRoom = false } = {}) {
    const others = publicRoomOthers();
    const payload = workspaceCreateSharePayload({ name, shareRoom, users: others });
    workspaceCreatePrompt = null;
    closeWorkspaceKeyboard();
    menuFooterHint = payload.shareRoom ? "Creating shared project…" : "Creating project…";
    refreshWorkspacePanel();
    try {
      const res = onCreateWorkspaceProject?.(payload);
      Promise.resolve(res).then((r) => {
        menuFooterHint = r?.message || r?.error || (payload.shareRoom ? "Shared project created" : "Project created");
        refreshWorkspacePanel();
      }).catch((err) => {
        menuFooterHint = err?.message || "Could not create project";
        refreshWorkspacePanel();
      });
    } catch (err) {
      menuFooterHint = err?.message || "Could not create project";
    }
  }

  function handleWorkspaceAction(id) {
    if (String(id).startsWith("ws-wiring")) {
      const api=globalThis.window?.Render3DWiringContext, guide=api?.guide;
      const finish = result => { menuFooterHint=result?.error || result?.message || "Wiring ready"; guide?.setMessage(menuFooterHint); refreshWorkspacePanel(); };
      if(id==="ws-wiring" || id==="ws-wiring-load") {
        workspaceTab="wiring";workspaceRefsOpen=false;workspaceSceneMenu=false;
        Promise.resolve(onXrStudioAction?.({type:"wiring_open"})).then(finish).catch(error=>finish({error:error.message}));
      } else if(id==="ws-wiring-back") workspaceTab="projects";
      else if(id==="ws-wiring-close") {if(api)api.requestedMode=null;guide?.stop();}
      else if(id==="ws-wiring-isolate") guide?.toggleSchematicOnly();
      else if(id==="ws-wiring-guided") {if(guide?.state().guided)guide.stop();else guide?.start();}
      else if(id==="ws-wiring-next") guide?.next(1);
      else if(id==="ws-wiring-prev") guide?.next(-1);
      else if(id==="ws-wiring-done") guide?.markInstalled();
      else if(id==="ws-wiring-talk" && guide) {void beginAstraTalk({text:guide.voiceBrief()}).then(finish).catch(error=>finish({error:error.message}));}
      else if(id==="ws-wiring-check" && guide) {
        if(guide.reviewing)return;
        guide.reviewing=true;guide.setMessage("Opening outward camera for this step…");
        Promise.resolve(onXrStudioAction?.({type:"wiring_review"})).then(finish).catch(error=>finish({error:error.message})).finally(()=>{guide.reviewing=false;});
      }
      refreshWorkspacePanel();return;
    }
    if (!id || id === "hide") {
      closeWorkspacePanel();
      return;
    }
    if (id === "ws-tab:projects") {
      workspaceTab = "projects";
      workspaceSceneMenu = false;
      refreshWorkspacePanel();
      return;
    }
    if (id === "ws-tab:scene") {
      workspaceTab = "scene";
      workspaceRefsOpen = false;
      refreshWorkspacePanel();
      return;
    }
    if (id === "voice_toggle" || id === "passthrough" || id === "capture" || id === "settings") {
      setTool(id);
      refreshWorkspacePanel();
      return;
    }
    if (id === "printer_accept" || id === "printer_outline" || id === "printer_model" || id === "printer_vr_model" || id === "printer_fence") {
      handleShareAction(id);
      refreshWorkspacePanel();
      return;
    }
    if (id === "ws-refs") {
      workspaceRefsOpen = true;
      refreshWorkspacePanel();
      return;
    }
    if (id === "ws-refs-back") {
      workspaceRefsOpen = false;
      refreshWorkspacePanel();
      return;
    }
    if (String(id).startsWith("ws-ref:")) {
      const name = String(id).slice("ws-ref:".length);
      openWorkspaceReferenceFile(name);
      return;
    }
    if (id === "ws-env-generate") {
      workspaceSceneMenu = false;
      try { onGenerateXrEnvironment?.(); } catch (err) { console.warn("[xr] generate env", err); }
      try { openAiPromptPanel({ keepPose: true }); } catch (_) {}
      menuFooterHint = "Render · describe a 3D environment, then Talk or Run";
      refreshWorkspacePanel();
      return;
    }
    if (id === "ws-scene-settings-open") {
      settingsTab = "environment";
      openGridPopup("settings", { keepPose: true, forcePlace: true });
      menuFooterHint = "Scene Settings opened in a separate window";
      refreshWorkspacePanel();
      return;
    }
    if (id === "ws-env-menu") {
      workspaceSceneMenu = true;
      refreshWorkspacePanel();
      return;
    }
    if (id === "ws-env-back") {
      workspaceSceneMenu = false;
      refreshWorkspacePanel();
      return;
    }
    if (String(id).startsWith("ws-env:")) {
      setXrSceneKind(String(id).slice("ws-env:".length));
      workspaceSceneMenu = false;
      refreshWorkspacePanel();
      return;
    }
    if (handleBoardAction(id)) return;
    if (id === "ws-save-layout") {
      hydrateXrLayouts();
      workspaceLayoutPrompt = {
        names: layoutNameSuggestions(layoutStore.layouts),
      };
      menuFooterHint = "Name this window layout";
      refreshWorkspacePanel();
      return;
    }
    if (id === "ws-layout-cancel") {
      workspaceLayoutPrompt = null;
      refreshWorkspacePanel();
      return;
    }
    if (String(id).startsWith("ws-layout-save:")) {
      const name = String(id).slice("ws-layout-save:".length);
      workspaceLayoutPrompt = null;
      const rec = captureNamedLayout(name);
      menuFooterHint = rec ? `Saved · ${rec.name}` : "Could not save layout";
      refreshWorkspacePanel();
      return;
    }
    if (id === "ws-layout-last") {
      const lastId = layoutStore.lastId;
      if (lastId) applyNamedLayout(lastId, { userPicked: true });
      refreshWorkspacePanel();
      return;
    }
    if (String(id).startsWith("ws-layout:")) {
      applyNamedLayout(String(id).slice("ws-layout:".length), { userPicked: true });
      return;
    }
    if (id === "ws-invite-yes") {
      workspaceInvitePrompt = false;
      menuFooterHint = "Inviting everyone…";
      refreshWorkspacePanel();
      try {
        const res = onInvitePublicRoomToProject?.({ project_id: workspaceInviteProjectId });
        Promise.resolve(res).then((r) => {
          menuFooterHint = r?.message || r?.error || "Invites sent";
          refreshWorkspacePanel();
        }).catch((err) => {
          menuFooterHint = err?.message || "Could not invite";
          refreshWorkspacePanel();
        });
      } catch (err) {
        menuFooterHint = err?.message || "Could not invite";
      }
      return;
    }
    if (id === "ws-invite-no") {
      workspaceInvitePrompt = false;
      menuFooterHint = "Saved without inviting";
      refreshWorkspacePanel();
      return;
    }
    if (id === "ws-add") {
      workspaceCreatePrompt = { name: "", shareAsk: false };
      workspaceInvitePrompt = false;
      workspaceLayoutPrompt = null;
      menuFooterHint = "Name this project";
      openWorkspaceKeyboard();
      refreshWorkspacePanel();
      return;
    }
    if (id === "ws-create-cancel") {
      workspaceCreatePrompt = null;
      closeWorkspaceKeyboard();
      menuFooterHint = "";
      refreshWorkspacePanel();
      return;
    }
    if (id === "ws-create-name") {
      if (wsKeyboardOpen) closeWorkspaceKeyboard();
      else openWorkspaceKeyboard();
      refreshWorkspacePanel();
      return;
    }
    if (String(id).startsWith("kb:")) {
      if (!workspaceCreatePrompt || workspaceCreatePrompt.shareAsk) return;
      const next = applyKeyboardKey(workspaceCreatePrompt.name || "", id, { shift: wsKeyboardShift });
      wsKeyboardShift = !!next.shift;
      workspaceCreatePrompt = {
        ...workspaceCreatePrompt,
        name: sanitizeProjectName(String(next.draft || "").replace(/\n/g, " ")),
      };
      if (next.action === "done") {
        finishNamedWorkspaceCreate();
        return;
      }
      refreshWorkspacePanel();
      return;
    }
    if (id === "ws-create-go") {
      finishNamedWorkspaceCreate();
      return;
    }
    if (id === "ws-create-share-yes") {
      const name = sanitizeProjectName(workspaceCreatePrompt?.name || "");
      void createNamedWorkspaceProject({ name, shareRoom: true });
      return;
    }
    if (id === "ws-create-share-no") {
      const name = sanitizeProjectName(workspaceCreatePrompt?.name || "");
      void createNamedWorkspaceProject({ name, shareRoom: false });
      return;
    }
    if (id === "ws-save" || id === "ws-save-new") {
      menuFooterHint = id === "ws-save-new" ? "Saving as a new project…" : "Saving to your files…";
      refreshWorkspacePanel();
      try {
        const res = onSavePublicRoomProject?.({ forceNew: id === "ws-save-new" });
        Promise.resolve(res).then((r) => {
          menuFooterHint = r?.message || r?.error || "Saved";
          const others = publicRoomOthers();
          if (r?.ok !== false && (r?.invite || others.length)) {
            workspaceInvitePrompt = true;
            workspaceInviteProjectId = r.project_id || "";
          }
          refreshWorkspacePanel();
        }).catch((err) => {
          menuFooterHint = err?.message || "Could not save";
          refreshWorkspacePanel();
        });
      } catch (err) {
        menuFooterHint = err?.message || "Could not save";
      }
      return;
    }
    if (String(id).startsWith("ws-del:")) {
      const pid = String(id).slice(7);
      const now = performance.now();
      if (workspaceDeleteArmedId !== pid || now - workspaceDeleteArmedAt > 4000) {
        workspaceDeleteArmedId = pid;
        workspaceDeleteArmedAt = now;
        menuFooterHint = "Tap ✕ again to delete";
        refreshWorkspacePanel();
        return;
      }
      workspaceDeleteArmedId = "";
      try {
        const res = onDeleteWorkspaceProject?.({ id: pid });
        Promise.resolve(res).then((r) => {
          menuFooterHint = r?.message || r?.error || "Project removed";
          refreshWorkspacePanel();
        }).catch((err) => {
          menuFooterHint = err?.message || "Could not delete";
          refreshWorkspacePanel();
        });
      } catch (err) {
        menuFooterHint = err?.message || "Could not delete";
      }
      return;
    }
    if (id) {
      try {
        const maybe = onOpenProject?.(id);
        Promise.resolve(maybe).then(() => {
          refreshWorkspacePanel();
        }).catch(err=>{menuFooterHint=err?.message || "Could not open project";refreshWorkspacePanel();});
      } catch (_) {}
    }
  }

  const INVITE_CANVAS = { w: 640, h: 360, headerEnd: 72, rowH: 62, listTop: 128 };
  const INVITE_PLANE = { w: 0.38, h: 0.22 };

  function shareInviteLines() {
    if (shareInviteState?.printer || printerRequestState) {
      const who = String(shareInviteState?.by || printerRequestState?.from_name || "Someone").slice(0, 22);
      return [
        { id: "", label: `${who} sent a print request`, kind: "hint" },
        { id: "print-accept", label: "Send to my printer", kind: "action" },
        { id: "print-decline", label: "Decline", kind: "action" },
      ];
    }
    const name = String(shareInviteState?.project_name || "a project").slice(0, 28);
    const who = String(shareInviteState?.by || shareInviteState?.inviter_name || "Someone").slice(0, 22);
    if (shareInviteState?.printer || printerRequestState) {
      return [
        { id: "", label: `${who} sent ${name} to your printer`, kind: "hint" },
        { id: "print-accept", label: "Accept · send to Bambu", kind: "action" },
        { id: "print-decline", label: "Decline", kind: "action" },
      ];
    }
    return [
      { id: "", label: `${who} invited you to ${name}`, kind: "hint" },
      { id: "share-accept", label: "Accept", kind: "action" },
      { id: "share-decline", label: "Decline", kind: "action" },
    ];
  }

  function drawShareInviteCanvas() {
    const width = INVITE_CANVAS.w;
    const height = INVITE_CANVAS.h;
    const canvas = shareInvitePanel?.canvas || document.createElement("canvas");
    const ctx = bindHudCanvas2d(canvas, width, height);
    fillDarkMetalChrome(ctx, width, height, 22);
    fillDarkMetalHeader(ctx, width, INVITE_CANVAS.headerEnd, 22);
    ctx.fillStyle = "#f1f5f9";
    ctx.font = "bold 28px Arial,sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Project invite", 24, Math.round(INVITE_CANVAS.headerEnd * 0.52));
    drawWindowCloseX(ctx, width, INVITE_CANVAS.headerEnd);
    const lines = shareInvitePanel?.lines || shareInviteLines();
    lines.forEach((line, i) => {
      const y = INVITE_CANVAS.listTop + i * INVITE_CANVAS.rowH;
      if (line.kind === "hint") {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "18px Arial,sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(String(line.label || "").slice(0, 42), 28, y);
        return;
      }
      ctx.fillStyle = line.id === "share-accept" ? "rgba(34,197,94,0.28)" : "rgba(248,113,113,0.22)";
      roundRect(ctx, 24, y - 24, width - 48, 48, 14);
      ctx.fill();
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 22px Arial,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(line.label || ""), width / 2, y);
    });
    return canvas;
  }

  function ensureShareInvitePanel() {
    if (shareInvitePanel) return shareInvitePanel;
    shareInvitePanel = { group: new THREE.Group(), lines: [], canvas: null, tex: null, plane: null };
    const canvas = drawShareInviteCanvas();
    const tex = sharpenCanvasTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(INVITE_PLANE.w, INVITE_PLANE.h),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    plane.renderOrder = 2070;
    plane.frustumCulled = false;
    shareInvitePanel.canvas = canvas;
    shareInvitePanel.tex = tex;
    shareInvitePanel.plane = plane;
    shareInvitePanel.group.add(plane);
    markWorldUi(shareInvitePanel.group);
    xrHud.add(shareInvitePanel.group);
    shareInvitePanel.group.visible = false;
    return shareInvitePanel;
  }

  function refreshShareInvitePanel() {
    const panel = ensureShareInvitePanel();
    panel.lines = shareInviteLines();
    const cvs = drawShareInviteCanvas();
    panel.canvas = cvs;
    panel.tex.image = cvs;
    panel.tex.needsUpdate = true;
  }

  function closeShareInvitePanel({ decline = false } = {}) {
    if (decline && shareInviteState) {
      try {
        onRespondShareInvite?.({
          accept: false,
          token: shareInviteState.invite_token || shareInviteState.token,
          project_id: shareInviteState.project_id,
        });
      } catch (_) {}
    }
    shareInviteState = null;
    if (shareInvitePanel) shareInvitePanel.group.visible = false;
  }

  function openXrShareInviteFromEvent(msg = {}) {
    if (!msg || typeof msg !== "object") return;
    let me = "";
    try { me = String((typeof getLocalUserId === "function" && getLocalUserId()) || ""); } catch { me = ""; }
    if (me && (msg.user_id === me || msg.by_user_id === me)) return;
    shareInviteState = {
      project_id: msg.project_id || "",
      project_name: msg.project_name || "a project",
      invite_token: msg.invite_token || msg.token || "",
      by: msg.by || msg.inviter_name || msg.display_name || "Someone",
      inviter_name: msg.inviter_name || msg.by || "",
      printer: !!msg.printer,
    };
    const panel = ensureShareInvitePanel();
    refreshShareInvitePanel();
    panel.group.visible = true;
    ensureHudWorldParent(panel.group);
    const pos = spawnPanelWorldPos(0, PANEL_UP_DEFAULT + 0.04);
    setPanelWorldPose(panel.group, pos);
    facePanelTowardHead(panel.group, pos);
  }

  function pickShareInviteFromLocal(local) {
    if (!shareInvitePanel?.group?.visible) return null;
    const halfW = INVITE_PLANE.w / 2;
    const halfH = INVITE_PLANE.h / 2;
    const u = (local.x + halfW) / INVITE_PLANE.w;
    const fromTop = (halfH - local.y) / INVITE_PLANE.h;
    if (u < 0 || u > 1 || fromTop < 0 || fromTop > 1) return null;
    const px = u * INVITE_CANVAS.w;
    const py = fromTop * INVITE_CANVAS.h;
    if (py < INVITE_CANVAS.headerEnd) {
      if (px > INVITE_CANVAS.w - 88) return { kind: "share-invite-action", id: "hide" };
      return { kind: "share-invite-drag" };
    }
    const lines = shareInvitePanel.lines || [];
    const idx = Math.round((py - INVITE_CANVAS.listTop) / INVITE_CANVAS.rowH);
    if (idx < 0 || idx >= lines.length) return { kind: "share-invite-chrome" };
    const line = lines[idx];
    if (!line?.id) return { kind: "share-invite-chrome" };
    return { kind: "share-invite-action", id: line.id };
  }

  function handleShareInviteAction(id) {
    if (!id || id === "hide") {
      closeShareInvitePanel({ decline: false });
      return;
    }
    if (id === "print-accept" || id === "print-decline") {
      const req = printerRequestState || {};
      const accept = id === "print-accept";
      printerRequestState = null;
      closeShareInvitePanel({ decline: false });
      void Promise.resolve(onXrStudioAction?.({
        type: "printer_respond",
        request_id: req.request_id || shareInviteState?.invite_token,
        accept,
      })).then((r) => {
        menuFooterHint = r?.message || r?.error || (accept ? "Sending to your printer" : "Declined");
        if (accept) {
          nestModelInPrinter();
          try { onToolAction?.("bambu"); } catch (_) {}
        }
      });
      return;
    }
    if (id === "share-accept" || id === "share-decline") {
      const st = shareInviteState || {};
      const accept = id === "share-accept";
      closeShareInvitePanel({ decline: false });
      menuFooterHint = accept ? "Accepting invite…" : "Declining…";
      try {
        const res = onRespondShareInvite?.({
          accept,
          token: st.invite_token || st.token,
          project_id: st.project_id,
        });
        Promise.resolve(res).then((r) => {
          menuFooterHint = r?.message || r?.error || (accept ? "Joined shared project" : "Declined");
        }).catch((err) => {
          menuFooterHint = err?.message || "Invite failed";
        });
      } catch (err) {
        menuFooterHint = err?.message || "Invite failed";
      }
    }
  }

  const SHARE_CANVAS = { w: 720, h: 720, headerEnd: 68, rowH: 46, listTop: 96 };
  const SHARE_PLANE = { w: 0.40, h: 0.40 };

  function persistPrinterPref(key, on) {
    writeFlag(typeof localStorage !== "undefined" ? localStorage : null, key, on);
  }

  function savePrinterConfig(extra = {}) {
    const store = typeof localStorage !== "undefined" ? localStorage : null;
    const merged = applyPrinterConfigFields(store, {
      lan_ip: extra.lan_ip != null ? extra.lan_ip : printerPrefs.lan_ip,
      access_code: extra.access_code != null ? extra.access_code : printerPrefs.access_code,
      serial: extra.serial != null ? extra.serial : printerPrefs.serial,
      name: extra.name != null ? extra.name : printerPrefs.name,
      accept_sends: extra.accept_sends != null ? extra.accept_sends : printerPrefs.accept_sends,
      show_outline: extra.show_outline != null ? extra.show_outline : printerPrefs.show_outline,
      show_model: extra.show_model != null ? extra.show_model : printerPrefs.show_model,
      fence: extra.fence !== undefined ? extra.fence : printerPlacement,
    });
    printerPrefs = { ...printerPrefs, ...merged };
    void onXrStudioAction?.({
      type: "printer_prefs",
      accept_sends: printerPrefs.accept_sends,
      show_outline: printerPrefs.show_outline,
      show_model: printerPrefs.show_model,
      lan_ip: extra.lan_ip != null ? extra.lan_ip : printerPrefs.lan_ip,
      access_code: extra.access_code != null ? extra.access_code : undefined,
      serial: extra.serial != null ? extra.serial : printerPrefs.serial,
      name: extra.name != null ? extra.name : printerPrefs.name,
      fence: extra.fence !== undefined ? extra.fence : printerPlacement,
    });
    paintRoboticsPanel();
    return printerPrefs;
  }

  function sendPrinterConfigToPc(focus = "") {
    roboticsHudTab = "printer";
    roboticsPrinterConfigOpen = true;
    paintRoboticsPanel();
    void Promise.resolve(onXrStudioAction?.(printerSendPcPayload({ focus }))).then((r) => {
      menuFooterHint = r?.message || "Printer settings on the computer";
      try { onStatus?.("ok", menuFooterHint); } catch (_) {}
    });
  }

  function createOrShowPrinterBounder() {
    getHeadPose();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(_headQuat);
    const existing = isLeftoverAutoPrinterFence(printerPlacement) ? null : printerPlacement;
    const fence = createBounderFence({
      head: {
        x: _headPos.x,
        y: _headPos.y,
        z: _headPos.z,
        forwardX: fwd.x,
        forwardZ: fwd.z,
      },
      existing,
    });
    applyPrinterFence(fence, { persist: true, share: true });
    printerPrefs.show_outline = true;
    persistPrinterPref(PRINTER_OUTLINE_KEY, true);
    roboticsHudTab = "printer";
    menuFooterHint = existing
      ? "Hover the bounder · grip to move · two grips to stretch"
      : "Bounder created · hover it, grip to move, two grips to stretch over the printer";
    try { onStatus?.("ok", menuFooterHint); } catch (_) {}
    paintRoboticsPanel();
    return fence;
  }

  function persistPrinterBounderFromMesh(mesh) {
    if (!mesh?.userData?.xrPrinterBounder) return;
    const fence = fenceFromBounderMesh({ position: mesh.position, scale: mesh.scale });
    if (!fence) return;
    applyPrinterFence({
      ...fence,
      quaternion: mesh.quaternion.toArray(),
      pinned: printerPlacement?.pinned === true,
      userDrawn: true,
    }, { persist: true, share: true });
  }

  function togglePrinterPin() {
    if (!printerPlacement || !printerBounderHit) return;
    const pinned = printerPlacement.pinned !== true;
    persistPrinterBounderFromMesh(printerBounderHit);
    applyPrinterFence({ ...printerPlacement, pinned }, { persist: true, share: true });
    menuFooterHint = pinned
      ? "Print Box pinned for every scene and project"
      : "Print Box unlocked · grip to reposition and rotate";
    try { onStatus?.("ok", menuFooterHint); } catch (_) {}
  }

  function highlightPrinterBounder(on) {
    printerBounderHover = !!on;
    if (printerBounderHit?.material) {
      printerBounderHit.material.color.setHex(on ? 0xfbbf24 : 0x7dd3fc);
      printerBounderHit.material.opacity = on ? 0.22 : 0.08;
    }
    if (printerOutlineMesh?.material) {
      printerOutlineMesh.material.color.setHex(on ? 0xfbbf24 : 0x7dd3fc);
    }
  }

  function openVrBrowser(url) {
    const href = String(url || "").trim();
    if (!href) return;
    sceneWinState.url = href;
    sceneWinState.urlDraft = href;
    showXrSceneWindow("browser");
    openUrlInQuestBrowser(href);
  }

  function beginXrShareRosterFetch() {
    if (xrShareRosterAbort) {
      try { xrShareRosterAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    xrShareRosterAbort = ctl;
    return ctl;
  }

  async function refreshShareRoster() {
    const ctl = beginXrShareRosterFetch();
    try {
      const res = await onXrStudioAction?.({ type: "share_roster", signal: ctl.signal });
      if (ctl.signal.aborted) return;
      shareFriends = res?.friends || res?.people || [];
      shareSearchHits = res?.search || res?.hub || [];
      sharePrintTargets = (res?.print_targets || shareFriends.filter((p) => p.accept_sends)).slice(0, 6);
      if (res?.printer) {
        printerPrefs = { ...printerPrefs, ...res.printer };
        if (res.printer.fence) applyPrinterFence(res.printer.fence, { persist: true, share: false });
      }
      if (res?.volume_mm) printerVolumeM = printerVolumeFromProfile({ volume_mm: res.volume_mm, specs: { volume_mm: res.volume_mm } }) || printerVolumeM;
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
    }
    syncPrinterVisuals();
    if (sharePanel?.group?.visible) refreshSharePanel();
  }

  function sharePanelLines() {
    return xrSharePanelLines({
      friends: shareFriends,
      searchHits: shareSearchHits,
      roomPrintTargets: sharePrintTargets,
      searchDraft: shareSearchDraft,
      acceptSends: !!printerPrefs.accept_sends,
      showOutline: !!printerPrefs.show_outline,
      showVrModel: !!printerPrefs.show_model,
      includeDiscord: true,
      includeX: true,
    });
  }

  function drawSharePanelCanvas() {
    const width = SHARE_CANVAS.w;
    const height = SHARE_CANVAS.h;
    const canvas = sharePanel?.canvas || document.createElement("canvas");
    const ctx = bindHudCanvas2d(canvas, width, height);
    fillDarkMetalChrome(ctx, width, height, 22);
    fillDarkMetalHeader(ctx, width, SHARE_CANVAS.headerEnd, 22);
    ctx.fillStyle = "#f1f5f9";
    ctx.font = "bold 26px Arial,sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Share", 24, Math.round(SHARE_CANVAS.headerEnd * 0.52));
    drawWindowCloseX(ctx, width, SHARE_CANVAS.headerEnd);
    const lines = sharePanel?.lines || sharePanelLines();
    lines.forEach((line, i) => {
      const y = SHARE_CANVAS.listTop + i * SHARE_CANVAS.rowH;
      if (y > height - 36) return;
      if (line.kind === "hint" || line.kind === "section") {
        ctx.fillStyle = "#94a3b8";
        ctx.font = line.kind === "section" ? "800 16px Arial,sans-serif" : "16px Arial,sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(String(line.label || "").slice(0, 36), 28, y);
        return;
      }
      ctx.fillStyle = line.active ? "rgba(74,222,128,0.22)" : "rgba(30,41,59,0.92)";
      roundRect(ctx, 20, y - 18, width - 40, 36, 10);
      ctx.fill();
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 18px Arial,sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(String(line.label || "").slice(0, 34), 32, y);
    });
    if (shareKbOpen) {
      ctx.fillStyle = "#0f172a";
      roundRect(ctx, 16, height - 168, width - 32, 152, 12);
      ctx.fill();
      ctx.fillStyle = "#7dd3fc";
      ctx.font = "700 16px Arial,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`@${shareSearchDraft || "handle"} · Go`, width / 2, height - 92);
    }
    return canvas;
  }

  function ensureSharePanel() {
    if (sharePanel) return sharePanel;
    sharePanel = { group: new THREE.Group(), lines: [], canvas: null, tex: null, plane: null, worldPlaced: false };
    const canvas = drawSharePanelCanvas();
    const tex = sharpenCanvasTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(SHARE_PLANE.w, SHARE_PLANE.h),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    plane.renderOrder = 2068;
    plane.frustumCulled = false;
    sharePanel.canvas = canvas;
    sharePanel.tex = tex;
    sharePanel.plane = plane;
    sharePanel.group.name = "xrSharePanel";
    sharePanel.group.add(plane);
    markWorldUi(sharePanel.group);
    xrHud.add(sharePanel.group);
    sharePanel.group.visible = false;
    return sharePanel;
  }

  function refreshSharePanel() {
    const panel = ensureSharePanel();
    panel.lines = sharePanelLines();
    const cvs = drawSharePanelCanvas();
    panel.canvas = cvs;
    panel.tex.image = cvs;
    panel.tex.needsUpdate = true;
  }

  function openSharePanel(opts = {}) {
    const panel = ensureSharePanel();
    panel.group.visible = true;
    refreshSharePanel();
    void refreshShareRoster();
    ensureHudWorldParent(panel.group);
    if (!opts.forcePlace && panel.worldPlaced && panelWorldPosIsUsable(panel.group)) return;
    const pos = spawnPanelWorldPos(-0.18);
    setPanelWorldPose(panel.group, pos);
    facePanelTowardHead(panel.group, pos);
    panel.worldPlaced = true;
  }

  function closeSharePanel() {
    if (xrShareRosterAbort) {
      try { xrShareRosterAbort.abort(); } catch (_) { /* ignore */ }
    }
    if (sharePanel) sharePanel.group.visible = false;
    shareKbOpen = false;
  }

  function toggleSharePanel() {
    if (sharePanel?.group?.visible) closeSharePanel();
    else openSharePanel();
  }

  function pickShareFromLocal(local) {
    if (!sharePanel?.group?.visible) return null;
    const halfW = SHARE_PLANE.w / 2;
    const halfH = SHARE_PLANE.h / 2;
    const u = (local.x + halfW) / SHARE_PLANE.w;
    const fromTop = (halfH - local.y) / SHARE_PLANE.h;
    if (u < 0 || u > 1 || fromTop < 0 || fromTop > 1) return null;
    const px = u * SHARE_CANVAS.w;
    const py = fromTop * SHARE_CANVAS.h;
    if (py < SHARE_CANVAS.headerEnd) {
      if (px > SHARE_CANVAS.w - 88) return { kind: "share-sheet-action", id: "hide" };
      return { kind: "share-sheet-drag" };
    }
    const lines = sharePanel.lines || [];
    const idx = Math.round((py - SHARE_CANVAS.listTop) / SHARE_CANVAS.rowH);
    if (idx < 0 || idx >= lines.length) return { kind: "share-sheet-chrome" };
    const line = lines[idx];
    if (!line?.id) return { kind: "share-sheet-chrome" };
    return { kind: "share-sheet-action", id: line.id };
  }

  function handleShareAction(id) {
    if (!id || id === "hide") {
      closeSharePanel();
      return;
    }
    if (id === "share-search") {
      shareKbOpen = !shareKbOpen;
      if (!shareKbOpen && shareSearchDraft) {
        void Promise.resolve(onXrStudioAction?.({ type: "share_search", q: shareSearchDraft })).then((r) => {
          shareSearchHits = r?.people || r?.hits || [];
          refreshSharePanel();
        });
      }
      refreshSharePanel();
      return;
    }
    if (id === "share-discord") {
      void Promise.resolve(onXrStudioAction?.({ type: "share_discord" })).then((r) => {
        openVrBrowser(r?.href || DISCORD_VR_HREF);
        menuFooterHint = r?.message || "Discord opened in headset browser";
      });
      return;
    }
    if (id === "share-x") {
      void Promise.resolve(onXrStudioAction?.({ type: "share_x" })).then((r) => {
        openVrBrowser(r?.href || xrShareXHref({ title: "Render Studio" }));
        menuFooterHint = r?.message || "X opened in headset browser";
      });
      return;
    }
    if (id === "share-bambu") {
      try { onToolAction?.("bambu"); } catch (_) {}
      menuFooterHint = "Export to Bambu Studio";
      return;
    }
    if (id.startsWith("share-friend:") || id.startsWith("share-user:")) {
      const userId = id.slice(id.indexOf(":") + 1);
      void Promise.resolve(onXrStudioAction?.({ type: "share_invite_user", user_id: userId })).then((r) => {
        menuFooterHint = r?.message || r?.error || "Link sent";
      });
      return;
    }
    if (id.startsWith("print-send:")) {
      const userId = id.slice("print-send:".length);
      void Promise.resolve(onXrStudioAction?.({ type: "printer_send", user_id: userId })).then((r) => {
        menuFooterHint = r?.message || r?.error || "Print request sent";
      });
      return;
    }
    if (id === "printer_accept") {
      printerPrefs.accept_sends = !printerPrefs.accept_sends;
      persistPrinterPref(PRINTER_ACCEPT_KEY, printerPrefs.accept_sends);
      void onXrStudioAction?.({ type: "printer_prefs", accept_sends: printerPrefs.accept_sends });
      refreshSharePanel();
      refreshWorkspacePanel();
      return;
    }
    if (id === "printer_outline") {
      printerPrefs.show_outline = !printerPrefs.show_outline;
      persistPrinterPref(PRINTER_OUTLINE_KEY, printerPrefs.show_outline);
      void onXrStudioAction?.({ type: "printer_prefs", show_outline: printerPrefs.show_outline });
      if (printerPrefs.show_outline && !printerPlacement) beginPrinterFencePlace();
      else if (!printerPrefs.show_outline) printerFenceMode = 0;
      printerVisualsDirty = true;
      syncPrinterVisuals();
      refreshSharePanel();
      refreshWorkspacePanel();
      return;
    }
    if (id === "printer_fence") {
      printerPrefs.show_outline = true;
      persistPrinterPref(PRINTER_OUTLINE_KEY, true);
      void onXrStudioAction?.({ type: "printer_prefs", show_outline: true });
      beginPrinterFencePlace();
      refreshSharePanel();
      refreshWorkspacePanel();
      return;
    }
    if (id === "printer_model" || id === "printer_vr_model") {
      printerPrefs.show_model = !printerPrefs.show_model;
      persistPrinterPref(PRINTER_MODEL_KEY, printerPrefs.show_model);
      void onXrStudioAction?.({ type: "printer_prefs", show_model: printerPrefs.show_model });
      printerVisualsDirty = true;
      syncPrinterVisuals();
      refreshSharePanel();
      refreshWorkspacePanel();
      return;
    }
  }

  function printerWorldPos() {
    if (printerPlacement?.position) {
      const [x, y, z] = printerPlacement.position;
      return { x, y, z };
    }
    return null;
  }

  function ensurePrinterVolume() {
    if (printerVolumeM) return printerVolumeM;
    printerVolumeM = printerVolumeFromProfile({ volume_mm: BAMBU_DEFAULT_VOLUME_MM, specs: { volume_mm: BAMBU_DEFAULT_VOLUME_MM } });
    return printerVolumeM;
  }

  function printerBoxSize() {
    if (printerPlacement?.size) {
      const [x, y, z] = printerPlacement.size;
      if ([x, y, z].every((n) => Number(n) > 0)) return { x: Number(x), y: Number(y), z: Number(z) };
    }
    return null;
  }

  function makeDottedPrinterBox(size, { dashed = true } = {}) {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const mesh = new THREE.LineSegments(
      edges,
      dashed
        ? new THREE.LineDashedMaterial({
          color: 0x7dd3fc,
          dashSize: 0.018,
          gapSize: 0.012,
          transparent: true,
          opacity: 0.92,
          depthWrite: false,
        })
        : new THREE.LineBasicMaterial({
          color: 0x7dd3fc,
          transparent: true,
          opacity: 0.62,
          depthWrite: false,
        }),
    );
    if (dashed) mesh.computeLineDistances();
    mesh.scale.set(Math.max(0.02, size.x), Math.max(0.02, size.y), Math.max(0.02, size.z));
    mesh.name = "xrPrinterOutline";
    mesh.renderOrder = 40;
    mesh.frustumCulled = false;
    return mesh;
  }

  function applyPrinterFence(value, { persist = true, share = true } = {}) {
    if (value == null) {
      printerPlacement = null;
      printerVisualsDirty = true;
      if (persist) {
        writePrinterFence(typeof localStorage !== "undefined" ? localStorage : null, null);
        void onXrStudioAction?.({ type: "printer_prefs", fence: null });
      }
      syncPrinterVisuals();
      if (share) {
        try { sendSharedXr({ type: "xr.printer", object_id: PRINTER_BOX_OBJECT_ID, visible: false }); } catch (_) {}
      }
      return null;
    }
    if (isLeftoverAutoPrinterFence(value)) {
      return applyPrinterFence(null, { persist, share });
    }
    const fence = normalizePrinterFence(value);
    printerPlacement = fence;
    printerVisualsDirty = true;
    if (fence) {
      printerPrefs.show_outline = true;
      persistPrinterPref(PRINTER_OUTLINE_KEY, true);
    }
    if (persist) {
      writePrinterFence(typeof localStorage !== "undefined" ? localStorage : null, fence);
      void onXrStudioAction?.({ type: "printer_prefs", show_outline: true, fence });
    }
    syncPrinterVisuals();
    if (share && fence) {
      const payload = packPrinterBoxMessage(fence);
      if (payload) {
        try { sendSharedXr(payload); } catch (_) {}
      }
    }
    return fence;
  }

  function applyRemotePrinterBox(msg) {
    // A locally pinned box is a user preference, not a room-owned transform.
    if (printerPlacement?.pinned === true) return;
    if (msg?.visible === false) {
      applyPrinterFence(null, { persist: true, share: false });
      return;
    }
    if (isLeftoverAutoPrinterFence(msg)) return;
    const fence = normalizePrinterFence(msg);
    if (!fence) return;
    applyPrinterFence(fence, { persist: true, share: false });
  }

  function beginPrinterFencePlace() {
    if (isLeftoverAutoPrinterFence(printerPlacement)) {
      applyPrinterFence(null, { persist: true, share: true });
    }
    printerFenceMode = 1;
    printerFenceFirst = null;
    printerPrefs.show_outline = true;
    persistPrinterPref(PRINTER_OUTLINE_KEY, true);
    menuFooterHint = "Walk the controller to one corner of the printer you see, then trigger";
    try { onStatus?.("ok", menuFooterHint); } catch (_) {}
  }

  function hidePrinterFencePreview() {
    if (!printerFencePreview) return;
    printerFencePreview.visible = false;
  }

  function currentPrinterFenceRay() {
    try {
      for (let i = 0; i < 2; i += 1) {
        const c = renderer.xr.getController(i);
        if (!c) continue;
        const hand = String(c.userData?.handedness || "");
        if (hand && hand !== "right") continue;
        c.updateMatrixWorld?.(true);
        _fenceOrigin.setFromMatrixPosition(c.matrixWorld);
        c.getWorldQuaternion(_fenceQuat);
        _fenceDir.set(0, 0, -1).applyQuaternion(_fenceQuat);
        return { origin: _fenceOrigin, direction: _fenceDir };
      }
    } catch (_) {}
    return null;
  }

  function ensurePrinterFencePreview(size, pos) {
    if (!printerFencePreview) {
      printerFencePreview = makeDottedPrinterBox(size, { dashed: false });
      printerFencePreview.name = "xrPrinterFencePreview";
      printerFencePreview.material.opacity = 0.55;
      try { scene.add(printerFencePreview); } catch (_) {}
    }
    printerFencePreview.scale.set(Math.max(0.02, size.x), Math.max(0.02, size.y), Math.max(0.02, size.z));
    printerFencePreview.userData.boxX = size.x;
    printerFencePreview.userData.boxY = size.y;
    printerFencePreview.userData.boxZ = size.z;
    printerFencePreview.position.set(pos.x, pos.y, pos.z);
    printerFencePreview.visible = true;
  }

  function updatePrinterFencePreview() {
    if (!shouldTickPrinterFencePreview({ placing: !!printerFenceMode })) {
      hidePrinterFencePreview();
      return;
    }
    const ray = currentPrinterFenceRay();
    if (!ray) return;
    const pt = printerFencePointFromRay(ray);
    if (!pt) return;
    if (!printerFenceFirst) {
      ensurePrinterFencePreview({ x: 0.03, y: 0.03, z: 0.03 }, pt);
      return;
    }
    const fence = printerFenceFromCorners(printerFenceFirst, pt);
    if (!fence) {
      ensurePrinterFencePreview({ x: 0.03, y: 0.03, z: 0.03 }, printerFenceFirst);
      return;
    }
    ensurePrinterFencePreview(
      { x: fence.size[0], y: fence.size[1], z: fence.size[2] },
      { x: fence.position[0], y: fence.position[1], z: fence.position[2] },
    );
  }

  function selectPrinterFence(ray) {
    const pt = printerFencePointFromRay(ray);
    if (!pt) return;
    if (printerFenceMode === 1 || !printerFenceFirst) {
      printerFenceFirst = pt;
      printerFenceMode = 2;
      menuFooterHint = "Opposite corner of the printer you see — trigger when the box matches";
      try { onStatus?.("ok", menuFooterHint); } catch (_) {}
      return;
    }
    const fence = printerFenceFromCorners(printerFenceFirst, pt);
    if (!fence) {
      menuFooterHint = "Too close — mark a real opposite corner";
      try { onStatus?.("ok", menuFooterHint); } catch (_) {}
      return;
    }
    printerFenceMode = 0;
    printerFenceFirst = null;
    hidePrinterFencePreview();
    applyPrinterFence(fence, { persist: true, share: true });
    menuFooterHint = "Printer boundary set · visible to the room";
    try { onStatus?.("ok", menuFooterHint); } catch (_) {}
  }

  function syncPrinterBounderFollow(mesh) {
    if (!mesh?.userData?.xrPrinterBounder) return;
    if (!presenting) {
      if (printerOutlineMesh) printerOutlineMesh.visible = false;
      if (printerModelMesh) printerModelMesh.visible = false;
      if (printerBounderHit) printerBounderHit.visible = false;
      if (printerPinHit) printerPinHit.visible = false;
      return;
    }
    if (printerOutlineMesh) {
      printerOutlineMesh.position.copy(mesh.position);
      printerOutlineMesh.scale.copy(mesh.scale);
      printerOutlineMesh.quaternion.copy(mesh.quaternion);
      printerOutlineMesh.visible = true;
    }
    if (printerModelMesh) {
      printerModelMesh.position.copy(mesh.position);
      printerModelMesh.quaternion.copy(mesh.quaternion);
      printerModelMesh.visible = !!printerPrefs.show_model;
    }
    syncPrinterPinIcon(mesh);
  }

  function ensurePrinterPinIcon() {
    if (printerPinHit) return printerPinHit;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: texture, transparent: true, depthTest: false, depthWrite: false,
    }));
    sprite.name = "xrPrinterPin";
    sprite.userData.xrPrinterPin = true;
    sprite.userData.canvas = canvas;
    sprite.renderOrder = 12000;
    sprite.frustumCulled = false;
    sprite.scale.set(0.085, 0.085, 1);
    scene.add(sprite);
    printerPinHit = sprite;
    return sprite;
  }

  function paintPrinterPinIcon(pinned) {
    const icon = ensurePrinterPinIcon();
    const state = pinned ? "pinned" : "unlocked";
    if (printerPinTextureState === state) return;
    printerPinTextureState = state;
    const canvas = icon.userData.canvas;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = pinned ? "#0f766e" : "#334155";
    ctx.beginPath(); ctx.arc(64, 64, 54, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#e2e8f0"; ctx.lineWidth = 7; ctx.stroke();
    ctx.fillStyle = "#ffffff"; ctx.font = "72px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(pinned ? "📌" : "🔓", 64, 67);
    icon.material.map.needsUpdate = true;
  }

  function syncPrinterPinIcon(mesh = printerBounderHit) {
    if (!mesh?.visible || !presenting) {
      if (printerPinHit) printerPinHit.visible = false;
      return;
    }
    paintPrinterPinIcon(printerPlacement?.pinned === true);
    printerPinHit.position.copy(mesh.position);
    printerPinHit.position.y += Math.abs(mesh.scale.y) * 0.5 + 0.075;
    printerPinHit.visible = true;
  }

  function ensurePrinterBounderHit(vol, pos) {
    if (!printerBounderHit) {
      printerBounderHit = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({
          color: 0x7dd3fc,
          transparent: true,
          opacity: 0.08,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      printerBounderHit.name = "xrPrinterBounderHit";
      printerBounderHit.userData.xrPrinterBounder = true;
      printerBounderHit.renderOrder = 39;
      printerBounderHit.frustumCulled = false;
      try { scene.add(printerBounderHit); } catch (_) {}
    }
    if (gripGrab?.target === printerBounderHit || scaleGrab?.target === printerBounderHit) return printerBounderHit;
    printerBounderHit.scale.set(Math.max(0.05, vol.x), Math.max(0.05, vol.y), Math.max(0.05, vol.z));
    printerBounderHit.position.set(pos.x, pos.y, pos.z);
    const q = printerPlacement?.quaternion;
    if (Array.isArray(q) && q.length >= 4) printerBounderHit.quaternion.fromArray(q).normalize();
    else printerBounderHit.quaternion.identity();
    printerBounderHit.visible = true;
    syncPrinterPinIcon(printerBounderHit);
    highlightPrinterBounder(printerBounderHover);
    return printerBounderHit;
  }

  function syncPrinterVisuals() {
    const vol = printerBoxSize();
    // Printer placement is an immersive alignment aid, never desktop CAD
    // geometry. Keep the saved fence but hide every visual and hit target when
    // the WebXR session is not presenting.
    const immersive = presenting === true;
    const showBox = immersive && !!printerPrefs.show_outline && !!printerPlacement && !!vol;
    const showModel = immersive && !!printerPrefs.show_model && !!printerPlacement && !!vol;
    if (showBox || showModel) {
      const pos = printerWorldPos();
      if (!pos) {
        if (printerOutlineMesh) printerOutlineMesh.visible = false;
        if (printerModelMesh) printerModelMesh.visible = false;
        if (printerBounderHit) printerBounderHit.visible = false;
        if (printerPinHit) printerPinHit.visible = false;
        return;
      }
      ensurePrinterBounderHit(vol, pos);
      if (showBox) {
        if (!printerOutlineMesh) {
          printerOutlineMesh = makeDottedPrinterBox(vol, { dashed: true });
          try { scene.add(printerOutlineMesh); } catch (_) {}
        }
        printerOutlineMesh.scale.set(vol.x, vol.y, vol.z);
        printerOutlineMesh.userData.boxX = vol.x;
        printerOutlineMesh.userData.boxY = vol.y;
        printerOutlineMesh.userData.boxZ = vol.z;
        printerOutlineMesh.position.set(pos.x, pos.y, pos.z);
        printerOutlineMesh.quaternion.copy(printerBounderHit.quaternion);
        printerOutlineMesh.visible = true;
      } else if (printerOutlineMesh) {
        printerOutlineMesh.visible = false;
      }
      if (showModel) {
        if (!printerModelMesh) {
          const g = new THREE.Group();
          const bed = new THREE.Mesh(
            new THREE.BoxGeometry(vol.x, 0.012, vol.z),
            new THREE.MeshBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.55, depthWrite: false }),
          );
          bed.position.y = -vol.y / 2 + 0.006;
          const frame = new THREE.LineSegments(
            new THREE.EdgesGeometry(new THREE.BoxGeometry(vol.x, vol.y, vol.z)),
            new THREE.LineDashedMaterial({ color: 0x94a3b8, dashSize: 0.016, gapSize: 0.012, transparent: true, opacity: 0.7, depthWrite: false }),
          );
          frame.computeLineDistances();
          g.add(bed);
          g.add(frame);
          g.name = "xrPrinterModel";
          g.frustumCulled = false;
          printerModelMesh = g;
          try { scene.add(printerModelMesh); } catch (_) {}
        }
        printerModelMesh.position.set(pos.x, pos.y, pos.z);
        printerModelMesh.quaternion.copy(printerBounderHit.quaternion);
        printerModelMesh.visible = true;
      } else if (printerModelMesh) {
        printerModelMesh.visible = false;
      }
    } else {
      if (printerOutlineMesh) printerOutlineMesh.visible = false;
      if (printerModelMesh) printerModelMesh.visible = false;
      if (printerBounderHit) printerBounderHit.visible = false;
      if (printerPinHit) printerPinHit.visible = false;
    }
  }

  function ensureShareAimPlate() {
    if (shareAimPlate) return shareAimPlate;
    const canvas = document.createElement("canvas");
    bindHudCanvas2d(canvas, 512, 96);
    const tex = sharpenCanvasTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.32, 0.06),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
    );
    mesh.renderOrder = 80;
    mesh.frustumCulled = false;
    mesh.name = "xrShareAimPlate";
    const group = new THREE.Group();
    group.add(mesh);
    group.visible = false;
    xrHud.add(group);
    shareAimPlate = { group, mesh, canvas, tex };
    return shareAimPlate;
  }

  function paintShareAimPlate(target) {
    const plate = ensureShareAimPlate();
    const info = shareThrowNameplate({ name: target?.name, kind: target?.kind });
    const ctx = bindHudCanvas2d(plate.canvas, 512, 96);
    ctx.clearRect(0, 0, 512, 96);
    ctx.fillStyle = "rgba(15,23,42,0.82)";
    roundRect(ctx, 8, 12, 496, 72, 18);
    ctx.fill();
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.arc(56, 48, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f8fafc";
    ctx.font = "800 28px Arial,sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(info.title, 88, 48);
    plate.tex.needsUpdate = true;
  }

  function updateShareAimHud() {
    const plate = shareAimPlate;
    if (!shareAimTarget) {
      if (plate) plate.group.visible = false;
      lastShareAimKey = "";
      return;
    }
    const key = `${shareAimTarget.id || ""}:${shareAimTarget.name || shareAimTarget.kind || ""}`;
    const now = performance.now();
    if (shouldPaintShareAimHud({
      armed: true,
      targetKey: key,
      lastKey: lastShareAimKey,
      now,
      lastAt: lastShareAimPaintAt,
    })) {
      paintShareAimPlate(shareAimTarget);
      lastShareAimKey = key;
      lastShareAimPaintAt = now;
    }
    const host = plate || ensureShareAimPlate();
    const pos = spawnPanelWorldPos(0, 0.16);
    host.group.position.copy(pos);
    facePanelTowardHead(host.group, pos);
    host.group.visible = true;
  }

  function shareThrowCandidates() {
    const users = [];
    for (const [id, row] of xrPresence.avatars || []) {
      const head = row.head?.position || row.group?.position;
      if (!head) continue;
      const social = socialUsers().find((u) => String(u.id) === String(id));
      users.push({
        id,
        display_name: social?.display_name || row.display_name || id,
        pos: [head.x, head.y, head.z],
        accept_sends: social?.accept_sends === true || sharePrintTargets.some((p) => String(p.id) === String(id)),
      });
    }
    const printer = printerPlacement
      ? { id: "local-printer", name: "My printer", pos: (() => {
        const p = printerWorldPos();
        return p ? [p.x, p.y, p.z] : null;
      })() }
      : null;
    return { users, printer: printer?.pos ? printer : null };
  }

  function pollShareThrowAim() {
    if (!presenting || !grippingThrowMesh()) {
      if (shareAimTarget || shareAimPlate?.group?.visible) {
        shareAimTarget = null;
        updateShareAimHud();
      }
      return;
    }
    const sess = renderer.xr.getSession?.();
    let stickIn = false;
    let throwHeld = false;
    try {
      throwHeld = rightBHeld(sess?.inputSources) || !!bButtonHeld;
      for (const src of sess?.inputSources || []) {
        if (src.handedness !== "right" && src.handedness !== "") continue;
        if (gamepadActionPressed(src.gamepad, "stickClick") || xrThumbstickClicked(src.gamepad)) stickIn = true;
      }
    } catch (_) {}
    const squeezing = grippingThrowMesh();
    if (stickRestartArmed || bothThumbsticksClicked([...(sess?.inputSources || [])])) {
      shareAimTarget = null;
      updateShareAimHud();
      return;
    }
    if (!shareThrowArmed({ squeezing, throwHeld, thumbstickIn: stickIn })) {
      shareAimTarget = null;
      updateShareAimHud();
      return;
    }
    ensureXrHeadPose();
    const fwd = headForwardFlat();
    const { users, printer } = shareThrowCandidates();
    shareAimTarget = pickShareThrowTarget({
      origin: [_headPos.x, _headPos.y, _headPos.z],
      forward: [fwd.x, fwd.y, fwd.z],
      users,
      printer,
    });
    updateShareAimHud();
  }

  function beginShareThrow(mesh, target) {
    if (!mesh || !target || shareThrowAnim) return false;
    const from = new THREE.Vector3();
    try { mesh.getWorldPosition(from); } catch { return false; }
    const ghost = mesh.clone(true);
    ghost.traverse((o) => {
      if (o.material) {
        o.material = o.material.clone();
        o.material.transparent = true;
        o.material.depthWrite = false;
        o.material.opacity = 0.88;
      }
      o.raycast = () => {};
    });
    ghost.frustumCulled = false;
    try { scene.add(ghost); } catch (_) {}
    shareThrowAnim = {
      ghost,
      from: [from.x, from.y, from.z],
      to: target.pos || [target.x, target.y, target.z],
      t0: performance.now(),
      target,
    };
    return true;
  }

  function updateShareThrow() {
    if (!shareThrowAnim) return;
    const t = (performance.now() - shareThrowAnim.t0) / SHARE_THROW_ANIM_MS;
    const pose = shareThrowPoseAt(t, shareThrowAnim.from, shareThrowAnim.to);
    const g = shareThrowAnim.ghost;
    if (g) {
      g.position.set(pose.x, pose.y, pose.z);
      g.scale.setScalar(pose.scale);
    }
    if (t >= 1) {
      const target = shareThrowAnim.target;
      try { scene.remove(g); } catch (_) {}
      shareThrowAnim = null;
      shareAimTarget = null;
      updateShareAimHud();
      finishShareThrow(target);
    }
  }

  function finishShareThrow(target) {
    if (!target) return;
    if (target.kind === "printer" || target.id === "local-printer") {
      nestModelInPrinter();
      openPrintSettingsPopup();
      menuFooterHint = "In the printer · pick PETG or PLA";
      return;
    }
    void Promise.resolve(onXrStudioAction?.({ type: "printer_send", user_id: target.id })).then((r) => {
      menuFooterHint = r?.message || r?.error || "Print request sent";
    });
  }

  function maybeThrowAtPrinterBox(mesh) {
    if (!mesh || !isThrowPrintMesh(mesh)) return false;
    const pos = printerWorldPos();
    const size = printerBoxSize();
    if (!pos || !size) return false;
    const from = new THREE.Vector3();
    try { mesh.getWorldPosition(from); } catch { return false; }
    const vel = tossVelocityMps();
    const dir = vel.lengthSq() > 1e-6 ? vel.clone().normalize() : headForwardFlat();
    const hit = printerBoxHit({
      origin: [from.x, from.y, from.z],
      direction: [dir.x, dir.y, dir.z],
      center: [pos.x, pos.y, pos.z],
      size: [size.x, size.y, size.z],
    });
    if (!hit) return false;
    finishShareThrow({ kind: "printer", id: "local-printer", pos: [pos.x, pos.y, pos.z] });
    return true;
  }

  function nestModelInPrinter() {
    const live = getLiveMesh();
    const host = printerOutlineMesh || printerModelMesh;
    const vol = printerBoxSize();
    if (!live || !host || !vol) return;
    if (printerPreviewMesh) {
      try { printerPreviewMesh.parent?.remove(printerPreviewMesh); } catch (_) {}
      printerPreviewMesh = null;
    }
    const preview = live.clone(true);
    preview.traverse((o) => { if (o.isMesh) o.raycast = () => {}; });
    const maxD = Math.max(vol.x, vol.y, vol.z) * 0.72;
    const box = new THREE.Box3().setFromObject(preview);
    const size = box.getSize(new THREE.Vector3());
    const s = maxD / Math.max(size.x, size.y, size.z, 0.01);
    preview.scale.multiplyScalar(s);
    preview.position.set(0, 0, 0);
    host.add(preview);
    printerPreviewMesh = preview;
    printerVisualsDirty = true;
    syncPrinterVisuals();
  }

  function printSettingsPanelLines() {
    return printSettingsLines({
      filament: printSettingsState?.filament || "PETG",
      supports: !!printSettingsState?.supports,
    });
  }

  function drawPrintSettingsCanvas() {
    const width = INVITE_CANVAS.w;
    const height = INVITE_CANVAS.h + 80;
    const canvas = printSettingsPanel?.canvas || document.createElement("canvas");
    const ctx = bindHudCanvas2d(canvas, width, height);
    fillDarkMetalChrome(ctx, width, height, 22);
    fillDarkMetalHeader(ctx, width, INVITE_CANVAS.headerEnd, 22);
    ctx.fillStyle = "#f1f5f9";
    ctx.font = "bold 26px Arial,sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Start print", 24, Math.round(INVITE_CANVAS.headerEnd * 0.52));
    drawWindowCloseX(ctx, width, INVITE_CANVAS.headerEnd);
    const lines = printSettingsPanel?.lines || printSettingsPanelLines();
    lines.forEach((line, i) => {
      const y = INVITE_CANVAS.listTop + i * 48;
      if (line.kind === "hint") {
        ctx.fillStyle = "#94a3b8";
        ctx.font = "18px Arial,sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(String(line.label || "").slice(0, 42), 28, y);
        return;
      }
      ctx.fillStyle = line.id === "print-start"
        ? "rgba(34,197,94,0.28)"
        : (line.active ? "rgba(56,189,248,0.28)" : "rgba(51,65,85,0.7)");
      roundRect(ctx, 24, y - 20, width - 48, 40, 12);
      ctx.fill();
      ctx.fillStyle = "#e2e8f0";
      ctx.font = "bold 20px Arial,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(line.label || ""), width / 2, y);
    });
    return canvas;
  }

  function ensurePrintSettingsPanel() {
    if (printSettingsPanel) return printSettingsPanel;
    printSettingsPanel = { group: new THREE.Group(), lines: [], canvas: null, tex: null, plane: null };
    const canvas = drawPrintSettingsCanvas();
    const tex = sharpenCanvasTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(INVITE_PLANE.w, INVITE_PLANE.h + 0.06),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    plane.renderOrder = 2072;
    plane.frustumCulled = false;
    printSettingsPanel.canvas = canvas;
    printSettingsPanel.tex = tex;
    printSettingsPanel.plane = plane;
    printSettingsPanel.group.add(plane);
    markWorldUi(printSettingsPanel.group);
    xrHud.add(printSettingsPanel.group);
    printSettingsPanel.group.visible = false;
    return printSettingsPanel;
  }

  function refreshPrintSettingsPanel() {
    const panel = ensurePrintSettingsPanel();
    panel.lines = printSettingsPanelLines();
    const cvs = drawPrintSettingsCanvas();
    panel.canvas = cvs;
    panel.tex.image = cvs;
    panel.tex.needsUpdate = true;
  }

  function closePrintSettingsPanel() {
    printSettingsState = null;
    if (printSettingsPanel) printSettingsPanel.group.visible = false;
  }

  function openPrintSettingsPopup() {
    const live = getLiveMesh();
    printSettingsState = {
      filament: "PETG",
      supports: false,
      filename: String(live?.userData?.catalogFilename || live?.userData?.filename || ""),
    };
    const panel = ensurePrintSettingsPanel();
    refreshPrintSettingsPanel();
    panel.group.visible = true;
    ensureHudWorldParent(panel.group);
    const pos = spawnPanelWorldPos(0, PANEL_UP_DEFAULT + 0.04);
    setPanelWorldPose(panel.group, pos);
    facePanelTowardHead(panel.group, pos);
  }

  function pickPrintSettingsFromLocal(local) {
    if (!printSettingsPanel?.group?.visible) return null;
    const halfW = INVITE_PLANE.w / 2;
    const halfH = (INVITE_PLANE.h + 0.06) / 2;
    const u = (local.x + halfW) / INVITE_PLANE.w;
    const fromTop = (halfH - local.y) / (INVITE_PLANE.h + 0.06);
    if (u < 0 || u > 1 || fromTop < 0 || fromTop > 1) return null;
    const px = u * INVITE_CANVAS.w;
    const py = fromTop * (INVITE_CANVAS.h + 80);
    if (py < INVITE_CANVAS.headerEnd) {
      if (px > INVITE_CANVAS.w - 88) return { kind: "print-settings-action", id: "print-cancel" };
      return { kind: "print-settings-drag" };
    }
    const lines = printSettingsPanel.lines || [];
    const idx = Math.round((py - INVITE_CANVAS.listTop) / 48);
    if (idx < 0 || idx >= lines.length) return { kind: "print-settings-chrome" };
    const line = lines[idx];
    if (!line?.id) return { kind: "print-settings-chrome" };
    return { kind: "print-settings-action", id: line.id };
  }

  function handlePrintSettingsAction(id) {
    if (!id || id === "print-cancel" || id === "hide") {
      closePrintSettingsPanel();
      return;
    }
    if (id === "print-start") {
      const payload = printStartPayload({
        filament: printSettingsState?.filament || "PETG",
        supports: !!printSettingsState?.supports,
        filename: printSettingsState?.filename || "",
        project_id: typeof getProjectId === "function" ? String(getProjectId() || "") : "",
      });
      closePrintSettingsPanel();
      menuFooterHint = "Starting print…";
      void Promise.resolve(onXrStudioAction?.({ type: "printer_start", ...payload })).then((r) => {
        menuFooterHint = r?.message || r?.error || (r?.started ? "Print started" : "Print prepared");
        try { onStatus?.(r?.ok === false ? "error" : "ok", menuFooterHint); } catch (_) {}
      }).catch((err) => {
        menuFooterHint = err?.message || "Could not start print";
      });
      return;
    }
    printSettingsState = { ...printSettingsState, ...applyPrintSettingAction(printSettingsState, id) };
    refreshPrintSettingsPanel();
  }

  function openPrinterRequestPopup(msg = {}) {
    printerRequestState = msg;
    openXrShareInviteFromEvent({
      ...msg,
      printer: true,
      project_name: msg.filename || "a model",
      by: msg.from_name || "Someone",
      invite_token: msg.request_id || "",
    });
  }

  function disposeSharedVideo() {
    if (!sharedVideo) return;
    try { sharedVideo.video?.pause?.(); } catch (_) {}
    try {
      if (sharedVideo.video) {
        sharedVideo.video.removeAttribute("src");
        sharedVideo.video.src = "";
        sharedVideo.video.load?.();
      }
    } catch (_) {}
    try { sharedVideo.videoEl?.remove?.(); } catch (_) {}
    try {
      if (sharedVideo.objectUrl) URL.revokeObjectURL(sharedVideo.objectUrl);
    } catch (_) {}
    try { sharedVideo.tex?.dispose?.(); } catch (_) {}
    try { sharedVideo.plane?.geometry?.dispose?.(); } catch (_) {}
    try { sharedVideo.plane?.material?.dispose?.(); } catch (_) {}
    try { sharedVideo.closeHit?.geometry?.dispose?.(); } catch (_) {}
    try { sharedVideo.menuHit?.geometry?.dispose?.(); } catch (_) {}
    try { sharedVideo.overflowMesh?.geometry?.dispose?.(); } catch (_) {}
    try { sharedVideo.overflowTex?.dispose?.(); } catch (_) {}
    try { sharedVideo.friendMesh?.geometry?.dispose?.(); } catch (_) {}
    try { sharedVideo.friendTex?.dispose?.(); } catch (_) {}
    try { sharedVideo.group?.parent?.remove(sharedVideo.group); } catch (_) {}
    sharedVideo = null;
    clipMenuOpen = false;
    clipFriendOpen = false;
    clipFriendSearch = "";
    clipFriendPeople = [];
    clipFriendKbOpen = false;
  }

  function configureClipTexture(tex) {
    if (!tex) return tex;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  function makeClipChromePuck(kind) {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, 128, 128);
    ctx.beginPath();
    ctx.arc(64, 64, 52, 0, Math.PI * 2);
    ctx.fillStyle = "#4b5563";
    ctx.fill();
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 6;
    ctx.stroke();
    ctx.strokeStyle = "#f8fafc";
    ctx.fillStyle = "#f8fafc";
    ctx.lineCap = "round";
    ctx.lineWidth = 8;
    if (kind === "close") {
      ctx.beginPath();
      ctx.moveTo(42, 42);
      ctx.lineTo(86, 86);
      ctx.moveTo(86, 42);
      ctx.lineTo(42, 86);
      ctx.stroke();
    } else if (kind === "hide") {
      ctx.beginPath();
      ctx.arc(64, 58, 18, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(40, 88);
      ctx.lineTo(88, 40);
      ctx.stroke();
    } else if (kind === "curve") {
      ctx.beginPath();
      ctx.arc(64, 64, 28, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    } else if (kind === "anchor") {
      ctx.beginPath();
      ctx.moveTo(64, 36);
      ctx.lineTo(64, 92);
      ctx.moveTo(48, 52);
      ctx.lineTo(64, 36);
      ctx.lineTo(80, 52);
      ctx.stroke();
    } else if (kind === "resize") {
      ctx.beginPath();
      ctx.moveTo(46, 82);
      ctx.lineTo(82, 82);
      ctx.lineTo(82, 46);
      ctx.stroke();
    } else {
      for (const dy of [-18, 0, 18]) {
        ctx.beginPath();
        ctx.arc(64, 64 + dy, 6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const tex = configureClipTexture(new THREE.CanvasTexture(c));
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.036, 0.036),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    applyXrClipViewerMaterialFlags(mesh.material);
    mesh.renderOrder = 12084;
    mesh.frustumCulled = false;
    mesh.userData.xrClipViewer = true;
    return mesh;
  }

  function mountClipViewerGroup(title, local) {
    const group = new THREE.Group();
    group.name = "xrSharedVideo";
    group.userData.xrClipViewer = true;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      map: null,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    applyXrClipViewerMaterialFlags(mat);
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.30), mat);
    plane.renderOrder = 12080;
    plane.frustumCulled = false;
    plane.userData.xrSharedVideo = true;
    plane.userData.xrClipViewer = true;
    const chrome = clipViewerChromeLayout(0.52, 0.30);
    const closeHit = makeClipChromePuck("close");
    closeHit.position.set(chrome.close.x, chrome.close.y, 0.005);
    closeHit.userData.xrSharedVideoClose = true;
    const menuHit = makeClipChromePuck("menu");
    menuHit.position.set(chrome.menu.x, chrome.menu.y, 0.005);
    menuHit.userData.xrSharedVideoMenu = true;
    const hideHit = makeClipChromePuck("hide");
    hideHit.position.set(chrome.hide.x, chrome.hide.y, 0.005);
    hideHit.userData.xrWindowChrome = "hide";
    const curveHit = makeClipChromePuck("curve");
    curveHit.position.set(chrome.curve.x, chrome.curve.y, 0.005);
    curveHit.userData.xrWindowChrome = "curve";
    const anchorHit = makeClipChromePuck("anchor");
    anchorHit.position.set(chrome.anchor.x, chrome.anchor.y, 0.005);
    anchorHit.userData.xrWindowChrome = "anchor";
    const resizeHit = makeClipChromePuck("resize");
    resizeHit.position.set(chrome.resize.x, chrome.resize.y, 0.005);
    resizeHit.userData.xrWindowChrome = "resize";
    clipChromeHits = { hideHit, curveHit, anchorHit, resizeHit };
    const tipCanvas = document.createElement("canvas");
    tipCanvas.width = 512;
    tipCanvas.height = 96;
    const tipTex = configureClipTexture(new THREE.CanvasTexture(tipCanvas));
    const tipMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.28, 0.052),
      new THREE.MeshBasicMaterial({
        map: tipTex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    applyXrClipViewerMaterialFlags(tipMesh.material);
    tipMesh.position.set(0, chrome.close.y + 0.042, 0.008);
    tipMesh.renderOrder = 12090;
    tipMesh.visible = false;
    tipMesh.userData.xrClipViewer = true;
    const overflowCanvas = document.createElement("canvas");
    overflowCanvas.width = 512;
    overflowCanvas.height = 280;
    const overflowTex = configureClipTexture(new THREE.CanvasTexture(overflowCanvas));
    const overflowMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.26, 0.142),
      new THREE.MeshBasicMaterial({
        map: overflowTex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    applyXrClipViewerMaterialFlags(overflowMesh.material);
    overflowMesh.position.set(chrome.menu.x - 0.04, chrome.menu.y - 0.095, 0.006);
    overflowMesh.renderOrder = 12086;
    overflowMesh.visible = false;
    overflowMesh.userData.xrClipViewer = true;
    const friendCanvas = document.createElement("canvas");
    friendCanvas.width = 720;
    friendCanvas.height = 640;
    const friendTex = configureClipTexture(new THREE.CanvasTexture(friendCanvas));
    const friendMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.374),
      new THREE.MeshBasicMaterial({
        map: friendTex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    applyXrClipViewerMaterialFlags(friendMesh.material);
    friendMesh.position.set(0.38, 0.02, 0.01);
    friendMesh.renderOrder = 12088;
    friendMesh.visible = false;
    friendMesh.userData.xrClipViewer = true;
    group.add(plane);
    group.add(closeHit);
    group.add(menuHit);
    group.add(hideHit);
    group.add(curveHit);
    group.add(anchorHit);
    group.add(resizeHit);
    group.add(tipMesh);
    group.add(overflowMesh);
    group.add(friendMesh);
    xrHud.add(group);
    ensureHudWorldParent(group);
    const pos = spawnPanelWorldPos(0, PANEL_UP_DEFAULT + 0.02);
    setPanelWorldPose(group, pos);
    facePanelTowardHead(group, pos);
    overlayRelayerDirty = true;
    return {
      group,
      plane,
      closeHit,
      menuHit,
      overflowMesh,
      overflowTex,
      overflowCanvas,
      friendMesh,
      friendTex,
      friendCanvas,
      title,
      local,
      hideHit,
      curveHit,
      anchorHit,
      resizeHit,
      tipMesh,
      tipTex,
      tipCanvas,
    };
  }

  function paintClipOverflowMenu() {
    const panel = sharedVideo;
    if (!panel?.overflowCanvas || !panel.overflowTex) return;
    const ctx = panel.overflowCanvas.getContext("2d");
    const w = panel.overflowCanvas.width;
    const h = panel.overflowCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#0f172a";
    ctx.beginPath();
    ctx.roundRect?.(8, 8, w - 16, h - 16, 18);
    if (!ctx.roundRect) {
      ctx.rect(8, 8, w - 16, h - 16);
    }
    ctx.fill();
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 6;
    ctx.stroke();
    const rows = clipViewerOverflowItems();
    rows.forEach((row, i) => {
      const y = 22 + i * 80;
      ctx.fillStyle = "#1e293b";
      ctx.beginPath();
      ctx.roundRect?.(20, y, w - 40, 68, 12);
      if (!ctx.roundRect) ctx.rect(20, y, w - 40, 68);
      ctx.fill();
      ctx.fillStyle = "#f8fafc";
      ctx.font = "800 28px Arial,sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(row.label, w / 2, y + 34);
    });
    panel.overflowTex.needsUpdate = true;
    if (panel.overflowMesh) panel.overflowMesh.visible = !!clipMenuOpen;
  }

  function paintClipFriendPanel() {
    const panel = sharedVideo;
    if (!panel?.friendCanvas || !panel.friendTex) return;
    const ctx = panel.friendCanvas.getContext("2d");
    const w = panel.friendCanvas.width;
    const h = panel.friendCanvas.height;
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 6;
    ctx.strokeRect(3, 3, w - 6, h - 6);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "800 30px Arial,sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("Send to friend", 24, 36);
    ctx.fillStyle = "#4b5563";
    ctx.beginPath();
    ctx.arc(w - 36, 36, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#f8fafc";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(w - 44, 28);
    ctx.lineTo(w - 28, 44);
    ctx.moveTo(w - 28, 28);
    ctx.lineTo(w - 44, 44);
    ctx.stroke();
    ctx.fillStyle = clipFriendKbOpen ? "#1e3a5f" : "#1e293b";
    ctx.beginPath();
    ctx.roundRect?.(20, 64, w - 40, 52, 12);
    if (!ctx.roundRect) ctx.rect(20, 64, w - 40, 52);
    ctx.fill();
    ctx.fillStyle = clipFriendSearch ? "#f8fafc" : "#94a3b8";
    ctx.font = "700 22px Arial,sans-serif";
    ctx.fillText(clipFriendSearch || "Search friends…", 36, 90);

    const recents = readClipSendRecents();
    const ranked = rankFriendsForClipSend(clipFriendPeople, { query: clipFriendSearch, recents });
    const online = ranked.filter((p) => p.online === true);
    const recentPeople = ranked.filter((p) => recents.includes(String(p.id)) && p.online !== true);
    const rest = ranked.filter((p) => p.online !== true && !recents.includes(String(p.id)));
    const sections = [
      { title: "Online", rows: online },
      { title: "Recents", rows: recentPeople },
      { title: "Friends", rows: rest },
    ];
    let y = 136;
    const listBottom = clipFriendKbOpen ? 500 : 600;
    for (const sec of sections) {
      if (!sec.rows.length) continue;
      if (y > listBottom - 40) break;
      ctx.fillStyle = "#64748b";
      ctx.font = "800 18px Arial,sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(sec.title, 24, y);
      y += 28;
      for (const person of sec.rows) {
        if (y > listBottom - 48) break;
        ctx.fillStyle = "#1e293b";
        ctx.beginPath();
        ctx.roundRect?.(20, y, w - 40, 44, 10);
        if (!ctx.roundRect) ctx.rect(20, y, w - 40, 44);
        ctx.fill();
        ctx.fillStyle = person.online ? "#22c55e" : "#64748b";
        ctx.beginPath();
        ctx.arc(44, y + 22, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#f8fafc";
        ctx.font = "700 20px Arial,sans-serif";
        ctx.fillText(String(person.display_name || person.name || person.handle || "Friend").slice(0, 28), 64, y + 22);
        y += 50;
      }
    }
    if (clipFriendKbOpen) {
      for (const key of clipFriendKeyLayout(w)) {
        ctx.fillStyle = "#334155";
        ctx.beginPath();
        ctx.roundRect?.(key.x, key.y, key.w, key.h, 8);
        if (!ctx.roundRect) ctx.rect(key.x, key.y, key.w, key.h);
        ctx.fill();
        ctx.fillStyle = "#f8fafc";
        ctx.font = "800 16px Arial,sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(key.label, key.x + key.w / 2, key.y + key.h / 2);
      }
    }
    panel.friendTex.needsUpdate = true;
    if (panel.friendMesh) panel.friendMesh.visible = !!clipFriendOpen;
  }

  function pickClipFriendPanel(local) {
    if (!clipFriendOpen || !sharedVideo?.friendMesh) return null;
    const hw = 0.21;
    const hh = 0.187;
    const u = (local.x + hw) / (hw * 2);
    const v = (hh - local.y) / (hh * 2);
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const px = u * 720;
    const py = v * 640;
    if (px > 660 && py < 60) return { kind: "clip-friend-close" };
    if (py >= 64 && py <= 116) return { kind: "clip-friend-search" };
    if (clipFriendKbOpen) {
      for (const key of clipFriendKeyLayout(720)) {
        if (px >= key.x && px <= key.x + key.w && py >= key.y && py <= key.y + key.h) {
          return { kind: "clip-friend-key", id: key.id };
        }
      }
    }
    const recents = readClipSendRecents();
    const ranked = rankFriendsForClipSend(clipFriendPeople, { query: clipFriendSearch, recents });
    const sections = [
      ranked.filter((p) => p.online === true),
      ranked.filter((p) => recents.includes(String(p.id)) && p.online !== true),
      ranked.filter((p) => p.online !== true && !recents.includes(String(p.id))),
    ];
    let y = 136;
    const listBottom = clipFriendKbOpen ? 500 : 600;
    const titles = ["Online", "Recents", "Friends"];
    for (let s = 0; s < sections.length; s += 1) {
      const rows = sections[s];
      if (!rows.length) continue;
      if (y > listBottom - 40) break;
      y += 28;
      for (const person of rows) {
        if (y > listBottom - 48) break;
        if (px >= 20 && px <= 700 && py >= y && py <= y + 44) {
          return { kind: "clip-friend-row", userId: person.id, name: person.display_name || person.name };
        }
        y += 50;
      }
    }
    void titles;
    return { kind: "clip-friend-chrome" };
  }

  async function loadClipFriends() {
    let people = [];
    try {
      const res = await (typeof getSocialFriends === "function" ? getSocialFriends() : null);
      const payload = res && typeof res.then === "function" ? await res : res;
      people = payload?.people || payload?.friends || (Array.isArray(payload) ? payload : []);
    } catch (_) {}
    if (!people.length) {
      try {
        const state = (typeof getSocialState === "function" && getSocialState()) || {};
        people = (state.users || []).map((u) => ({
          ...u,
          online: u.online === true || u.inXr === true,
        }));
      } catch (_) {}
    }
    clipFriendPeople = Array.isArray(people) ? people : [];
    if (clipFriendOpen) paintClipFriendPanel();
  }

  function bindClipMap(plane, tex) {
    if (!plane?.material || !tex) return;
    plane.material.map = tex;
    plane.material.color.setHex(0xffffff);
    applyXrClipViewerMaterialFlags(plane.material);
    plane.material.needsUpdate = true;
  }

  function openSharedVideo({ url = "", title = "Recording", local = false, kind = "", blob = null } = {}) {
    if (!shouldCreateXrClipViewer({
      presenting,
      viewing: true,
      enterSettled: xrEnterWorkSettled(),
    })) {
      if (presenting) {
        const queued = { url, title, local, kind, blob };
        scheduleXrEnterIdle(() => openSharedVideo(queued));
      }
      return;
    }
    let src = String(url || "").trim();
    let objectUrl = "";
    if (blob && typeof URL !== "undefined" && URL.createObjectURL) {
      try {
        objectUrl = URL.createObjectURL(blob);
        src = objectUrl;
      } catch { objectUrl = ""; }
    }
    const docKind = String(kind || "") === "document" || String(kind || "") === "pdf" || String(kind || "") === "text";
    if (!src && !docKind) return;
    try {
      const tok = typeof getToken === "function" ? String(getToken() || "") : "";
      src = xrMediaUrlWithToken(src, tok);
    } catch { /* ignore */ }
    disposeSharedVideo();
    clipWindowHiddenFromOthers = false;
    const mounted = mountClipViewerGroup(title, local);
    try { applySavedClipPose(mounted.group); } catch (_) {}
    if (docKind) {
      sharedVideo = { ...mounted, tex: null, video: null, objectUrl };
      return;
    }
    const still = xrCaptureIsStillKind({
      kind,
      url: src,
      mime: blob?.type || "",
      filename: title,
    });
    if (still) {
      const img = new Image();
      img.decoding = "async";
      if (!objectUrl && src.startsWith("http")) img.crossOrigin = "anonymous";
      img.onload = () => {
        const tex = configureClipTexture(new THREE.Texture(img));
        tex.flipY = true;
        bindClipMap(mounted.plane, tex);
        if (sharedVideo) sharedVideo.tex = tex;
        const w = img.naturalWidth || img.width || 16;
        const h = img.naturalHeight || img.height || 9;
        if (h > 0) mounted.plane.scale.set(1, Math.max(0.4, Math.min(1.4, (h / w) / (0.30 / 0.52))), 1);
      };
      img.onerror = () => {
        try { onStatus?.("error", "Could not load still"); } catch (_) {}
      };
      img.src = src;
      sharedVideo = { ...mounted, tex: null, video: null, objectUrl, img };
      try { onStatus?.("ok", `Viewing ${String(title).slice(0, 28)}`); } catch (_) {}
      return;
    }
    const video = document.createElement("video");
    video.playsInline = true;
    video.loop = true;
    video.muted = true;
    video.autoplay = true;
    video.preload = "auto";
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
    video.setAttribute("muted", "");
    video.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:0;";
    if (!objectUrl && !src.startsWith("blob:") && !src.startsWith("data:") && !src.startsWith("/")) {
      video.crossOrigin = "anonymous";
    }
    try { document.body.appendChild(video); } catch (_) {}
    const tex = configureClipTexture(new THREE.VideoTexture(video));
    bindClipMap(mounted.plane, tex);
    const kickPlay = () => {
      tex.needsUpdate = true;
      void video.play?.().catch(() => {});
    };
    video.addEventListener("loadeddata", kickPlay);
    video.addEventListener("canplay", kickPlay);
    video.src = src;
    video.load?.();
    kickPlay();
    sharedVideo = { ...mounted, tex, video, videoEl: video, objectUrl };
    try { onStatus?.("ok", `Watching ${String(title).slice(0, 28)}`); } catch (_) {}
  }

  function clipWindowStorageKey() {
    let pid = "none";
    try { pid = String((typeof getProjectId === "function" && getProjectId()) || "none"); } catch { pid = "none"; }
    return `render3d:xr-clip-window:${pid}`;
  }

  function loadClipWindowState() {
    try {
      const raw = localStorage.getItem(clipWindowStorageKey());
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  function persistClipWindowState(extra = {}) {
    const group = sharedVideo?.group;
    const all = loadClipWindowState();
    const next = {
      ...all,
      hidden: extra.hidden === true || clipWindowHiddenFromOthers,
      curved: extra.curved === true || clipWindowCurved,
      anchored: extra.anchored === true || all.anchored === true,
    };
    if (group && extra.anchor === true) {
      try {
        const w = group.getWorldPosition(new THREE.Vector3());
        const q = group.getWorldQuaternion(new THREE.Quaternion());
        next.pose = { wx: w.x, wy: w.y, wz: w.z, qx: q.x, qy: q.y, qz: q.z, qw: q.w, scale: group.scale.x };
        next.anchored = true;
        savePanelPose("clip", group);
      } catch (_) {}
    }
    try { localStorage.setItem(clipWindowStorageKey(), JSON.stringify(next)); } catch (_) {}
    try {
      const pid = String((typeof getProjectId === "function" && getProjectId()) || "");
      if (pid && typeof getToken === "function" && getToken()) {
        const tok = String(getToken() || "");
        void fetch("/api/me/xr-window-visibility", {
          method: "PUT",
          headers: { "Content-Type": "application/json", Authorization: tok ? `Bearer ${tok}` : "" },
          body: JSON.stringify({
            projectId: pid,
            windows: { clip: { id: "clip", hidden: next.hidden, curved: next.curved, anchored: next.anchored, pose: next.pose || {} } },
          }),
        }).catch(() => {});
      }
    } catch (_) {}
    return next;
  }

  function broadcastClipWindowVisibility() {
    const payload = {
      type: "xr.window",
      window_id: "clip",
      hidden: clipWindowHiddenFromOthers,
    };
    try { sendCollab?.(payload); } catch (_) {}
    try { sendPublicXr?.(payload); } catch (_) {}
  }

  function applyRemoteWindowVisibility(msg) {
    if (!msg || msg.window_id !== "clip") return;
    let me = "";
    try { me = String((typeof getLocalUserId === "function" && getLocalUserId()) || ""); } catch { me = ""; }
    if (me && msg.user_id && String(msg.user_id) === me) return;
    if (!sharedVideo?.group) return;
    if (msg.hidden === true) sharedVideo.group.visible = false;
    else if (msg.hidden === false) sharedVideo.group.visible = true;
  }

  function applySavedClipPose(group) {
    if (!group) return;
    const saved = loadClipWindowState();
    if (saved.curved) {
      clipWindowCurved = true;
      applyClipWindowCurve(true);
    }
    if (saved.pose && Number.isFinite(Number(saved.pose.wx))) {
      try {
        group.position.set(Number(saved.pose.wx), Number(saved.pose.wy), Number(saved.pose.wz));
        if (Number.isFinite(Number(saved.pose.qx))) {
          group.quaternion.set(Number(saved.pose.qx), Number(saved.pose.qy), Number(saved.pose.qz), Number(saved.pose.qw));
        }
        const sc = Number(saved.pose.scale);
        if (Number.isFinite(sc) && sc > 0.2) group.scale.setScalar(sc);
        group.userData.xrHudParked = true;
        return;
      } catch (_) {}
    }
    if (applySavedPanelPose("clip", group)) {
      group.userData.xrHudParked = true;
    }
  }

  function paintClipWindowTooltip(id = "") {
    const panel = sharedVideo;
    if (!panel?.tipCanvas || !panel.tipMesh) return;
    clipWindowTooltipId = String(id || "");
    const text = windowChromeTooltipForId(clipWindowTooltipId);
    panel.tipMesh.visible = !!text;
    if (!text) return;
    const ctx = panel.tipCanvas.getContext("2d");
    const w = panel.tipCanvas.width;
    const h = panel.tipCanvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(8,15,28,0.92)";
    ctx.beginPath();
    ctx.roundRect?.(8, 8, w - 16, h - 16, 16);
    if (!ctx.roundRect) ctx.rect(8, 8, w - 16, h - 16);
    ctx.fill();
    ctx.fillStyle = "#e0f2fe";
    ctx.font = "700 28px Arial,sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text.slice(0, 42), w / 2, h / 2);
    panel.tipTex.needsUpdate = true;
  }

  function applyClipWindowCurve(on) {
    const panel = sharedVideo;
    if (!panel?.plane) return;
    clipWindowCurved = !!on;
    const w = 0.52;
    const h = 0.30;
    try { panel.plane.geometry?.dispose?.(); } catch (_) {}
    if (clipWindowCurved) {
      const theta = 0.72;
      const radius = curvedScreenRadiusM(w, theta);
      const geo = new THREE.CylinderGeometry(radius, radius, h, 24, 1, true, -theta / 2, theta);
      geo.rotateY(Math.PI / 2);
      geo.rotateZ(Math.PI / 2);
      panel.plane.geometry = geo;
    } else {
      panel.plane.geometry = new THREE.PlaneGeometry(w, h);
    }
    persistClipWindowState({ curved: clipWindowCurved });
  }

  function beginClipResize(controller) {
    const group = sharedVideo?.group;
    if (!group || !controller) return;
    beginPanelDrag(controller, group, { translateOnly: true });
    if (panelDrag) {
      panelDrag.resize = true;
      panelDrag.startScale = group.scale.x || 1;
      const corner = new THREE.Vector3();
      try {
        sharedVideo.resizeHit.getWorldPosition(corner);
        panelDrag.startCornerDist = controller.getWorldPosition(new THREE.Vector3()).distanceTo(corner);
      } catch {
        panelDrag.startCornerDist = 0.2;
      }
    }
  }

  function openWorkspaceReferenceFile(name) {
    let files = [];
    try { files = (typeof getReferenceFiles === "function" && getReferenceFiles()) || []; } catch { files = []; }
    if (!files.length) {
      try { files = (typeof getProjectFiles === "function" && getProjectFiles()) || []; } catch { files = []; }
    }
    const refs = listProjectReferenceFiles(files);
    const row = refs.find((r) => r.name === name) || { name, kind: referenceKindFromName(name) };
    if (!shouldOpenReferenceInWindow(row.kind)) {
      menuFooterHint = "That file type cannot open in a window";
      return;
    }
    let pid = "";
    try { pid = String((typeof getProjectId === "function" && getProjectId()) || ""); } catch { pid = ""; }
    const url = referenceFileUrl(row, pid);
    if (row.kind === "video" || row.kind === "image") {
      openSharedVideo({ url, title: row.label || row.name, local: true, kind: row.kind });
      return;
    }
    openSharedVideo({ url, title: row.label || row.name, local: true, kind: row.kind === "pdf" || row.kind === "text" ? row.kind : "document" });
    const paintCard = (body = "") => {
      if (!sharedVideo?.plane) return;
      const canvas = document.createElement("canvas");
      canvas.width = 720;
      canvas.height = 420;
      paintReferenceDocCard(canvas.getContext("2d"), {
        width: 720,
        height: 420,
        title: row.label || row.name,
        kind: row.kind,
        body,
      });
      const tex = configureClipTexture(new THREE.CanvasTexture(canvas));
      tex.flipY = true;
      bindClipMap(sharedVideo.plane, tex);
      sharedVideo.tex = tex;
    };
    if (row.kind === "text" && url) {
      void fetch(url).then((r) => r.text()).then((t) => paintCard(t)).catch(() => paintCard(""));
    } else if (row.kind === "pdf" || row.kind === "file") {
      paintCard("Trigger the window · PDF / document preview");
    }
  }

  function pickSharedVideo(ray) {
    if (!sharedVideo?.group?.visible) return null;
    sharedVideo.group.updateMatrixWorld(true);
    if (clipFriendOpen && sharedVideo.friendMesh?.visible) {
      const fh = ray.intersectObject(sharedVideo.friendMesh, false);
      if (fh.length) {
        const local = sharedVideo.friendMesh.worldToLocal(fh[0].point.clone());
        const mapped = pickClipFriendPanel(local);
        if (mapped) return { ...mapped, distance: fh[0].distance, point: fh[0].point?.clone?.() };
      }
    }
    if (sharedVideo.menuHit) {
      const mh = ray.intersectObject(sharedVideo.menuHit, false);
      if (mh.length) return { kind: "share-video-menu", distance: mh[0].distance };
    }
    const ch = ray.intersectObject(sharedVideo.closeHit, false);
    if (ch.length) return { kind: "share-video-close", distance: ch[0].distance };
    const chromeHits = [
      [sharedVideo.hideHit, "share-video-hide", "hide"],
      [sharedVideo.curveHit, "share-video-curve", "curve"],
      [sharedVideo.anchorHit, "share-video-anchor", "anchor"],
      [sharedVideo.resizeHit, "share-video-resize", "resize"],
    ];
    for (const [mesh, kind, id] of chromeHits) {
      if (!mesh) continue;
      const hh = ray.intersectObject(mesh, false);
      if (hh.length) return { kind, id, distance: hh[0].distance, point: hh[0].point?.clone?.() };
    }
    if (clipMenuOpen && sharedVideo.overflowMesh?.visible) {
      const oh = ray.intersectObject(sharedVideo.overflowMesh, false);
      if (oh.length) {
        const local = sharedVideo.overflowMesh.worldToLocal(oh[0].point.clone());
        const items = clipViewerOverflowItems();
        const u = (local.x + 0.13) / 0.26;
        const v = (0.071 - local.y) / 0.142;
        const idx = Math.floor(v * items.length);
        if (u >= 0 && u <= 1 && idx >= 0 && idx < items.length) {
          return { kind: "share-video-action", id: items[idx].id, distance: oh[0].distance };
        }
      }
    }
    const ph = ray.intersectObject(sharedVideo.plane, false);
    if (ph.length) {
      const local = sharedVideo.plane.worldToLocal(ph[0].point.clone());
      const chrome = pickClipViewerChrome(local, 0.52, 0.30, { menuOpen: clipMenuOpen });
      if (chrome) return { ...chrome, distance: ph[0].distance, point: ph[0].point?.clone?.() };
      return { kind: "share-video-toggle", distance: ph[0].distance };
    }
    return null;
  }

  function gridPanelRef(kind) {
    if (kind === "aiHub") return aiHubPanel;
    if (kind === "tools") return toolsPanel;
    if (kind === "settings") return settingsPanel;
    if (kind === "social") return socialHubPanel;
    if (kind === "draw") return drawPanel;
    return null;
  }

  function setGridPanelRef(kind, panel) {
    if (kind === "aiHub") aiHubPanel = panel;
    else if (kind === "tools") toolsPanel = panel;
    else if (kind === "settings") settingsPanel = panel;
    else if (kind === "social") socialHubPanel = panel;
    else if (kind === "draw") drawPanel = panel;
  }

  function settingsTabCell(i) {
    const n = SETTINGS_PANEL_TAB_IDS.length;
    const pad = 28;
    const gap = 8;
    const y = 76;
    const h = 36;
    const w = (960 - pad * 2 - gap * (n - 1)) / n;
    return { x: pad + i * (w + gap), y, w, h };
  }

  function settingsToolsForTab(tab) {
    if (tab === "environment") {
      let saved = [];
      const allowFat = shouldParseXrEnvironmentStoreOnSelectTick({ presenting })
        && shouldParseEnvironmentDataUrlsOnXrMenuOpen();
      if (workspaceSceneMenu && allowFat) {
        try { saved = loadXrEnvironmentStore(); xrEnvListCache = saved; } catch { saved = []; }
      } else if (workspaceSceneMenu) {
        if (!xrEnvListCache) {
          try { xrEnvListCache = loadXrEnvironmentListForMenu(); } catch { xrEnvListCache = []; }
        }
        saved = xrEnvListCache || [];
      }
      return workspaceEnvironmentLines({
        saved,
        sceneId: xrSceneKind,
        sceneMenu: !!workspaceSceneMenu,
      }).map((line) => ({
        id: line.id,
        label: line.label,
        icon: line.icon || "workspace",
        color: line.active ? 0x22c55e : 0x0ea5e9,
      }));
    }
    if (tab === "controls") {
      const listen = xrControlListenState();
      return vrControlsSettingsLines({
        headset: activeXrHeadset(),
        listenId: listen?.actionId || "",
        dockLeft: preferredDockHand === "left",
      }).map((line) => ({
        id: line.id,
        label: line.label,
        icon: line.icon || "settings",
        color: line.color || 0x64748b,
      }));
    }
    if (tab === "developer") {
      const rec = !!xrDevStats?.isRecording?.();
      return [
        { id: "dev_mode", label: developerMode ? "Dev on" : "Dev off", icon: "settings", color: developerMode ? 0x22c55e : 0x64748b },
        { id: "dev_stats", label: "FPS HUD", icon: "view", color: 0x38bdf8 },
        { id: "dev_record", label: rec ? "Stop ctl" : "XR Controls", icon: "rec", color: 0xef4444 },
        { id: "dev_send_pc", label: debuggerOpen ? "Send log" : "Send (hold sticks)", icon: "export", color: 0x0ea5e9 },
      ];
    }
    if (tab === "windows") {
      return settingsWindowsTools({
        browserOn: !!sceneWinState.browserOn,
        displayOn: !!sceneWinState.displayOn,
        pinned: sceneWinState.pinned !== false,
        widthId: sceneWinState.widthId || "m",
      });
    }
    if (tab === "robotics") {
      const stored = readRoboticsHudPrefs();
      let viserUrl = stored.viserUrl;
      let teleopUrl = stored.teleopUrl;
      try { viserUrl = document.querySelector("[data-viser-url], [data-viser-ribbon-url], #pref-viser-url")?.value || viserUrl; } catch { /* ignore */ }
      try { teleopUrl = document.querySelector("[data-teleop-url], [data-teleop-ribbon-url], #pref-teleop-url")?.value || teleopUrl; } catch { /* ignore */ }
      const cams = readHandCamPrefs();
      return roboticsSettingsLines({
        viserUrl,
        teleopUrl,
        cameraHost: cams.cameraHost || stored.cameraHost,
      }).map((line) => ({
        id: line.id,
        label: line.label,
        icon: line.icon || "robot",
        color: line.id === "rob_teleop" ? 0x22c55e : 0x38bdf8,
      }));
    }
    return SETTINGS_CONTROLLER_TOOLS;
  }

  function gridSpecTools(kind) {
    if (kind === "settings") return settingsToolsForTab(settingsTab);
    return GRID_POPUP_SPECS[kind]?.tools || [];
  }

  function gridLayout(kind) {
    const spec = GRID_POPUP_SPECS[kind];
    const tools = gridSpecTools(kind);
    const cols = 3;
    const rows = Math.max(1, Math.ceil((tools.length || spec?.tools?.length || 1) / cols));
    const footer = spec?.footer ? 44 : 20;
    const tabBar = kind === "settings";
    const tabH = tabBar ? 48 : 0;
    const h = Math.min(720, 76 + tabH + 28 + rows * 148 + footer);
    return {
      spec,
      tools,
      canvas: { w: 960, h, headerEnd: 76, cols, tabBar, tabH },
      plane: { w: 0.40, h: 0.40 * (h / 720) },
    };
  }

  function gridToolCell(kind, index) {
    const { spec, canvas, tools } = gridLayout(kind);
    const col = index % canvas.cols;
    const row = Math.floor(index / canvas.cols);
    const pad = 28;
    const top = canvas.headerEnd + (canvas.tabH || 0) + 16;
    const footer = spec?.footer ? 44 : 20;
    const n = Math.max(1, (tools || spec?.tools || []).length);
    const cellW = (canvas.w - pad * 2) / canvas.cols;
    const cellH = (canvas.h - top - footer) / Math.ceil(n / canvas.cols);
    return {
      x: pad + col * cellW + 8,
      y: top + row * cellH + 6,
      w: cellW - 16,
      h: cellH - 12,
    };
  }

  function gridToolIsOn(tool) {
    if (tool.id === "hand_left") return preferredDockHand === "left";
    if (tool.id === "hand_right") return preferredDockHand === "right";
    if (tool.id === "passthrough") return !!passthroughOn;
    if (tool.id === "grab" || tool.id === "measure") return activeTool === tool.id;
    if (tool.id === "place") return !!placePanel?.group?.visible;
    if (tool.id === "draw") return activeTool === "draw";
    if (tool.id === "voice_mold") return !!voiceMoldLive;
    if (tool.id === "ai_panel") return !!aiPanel?.group?.visible;
    if (tool.id === "studio") return !!xrStudio?.isOpen?.();
    if (tool.id === "wheel") return !!toolWheel?.isVisible?.();
    if (tool.id === "voice_toggle") return isHeadsetMicLive();
    if (tool.id === "workspace") return !!workspacePanel?.group?.visible;
    if (tool.id === "guides") return !!guidesPanel?.group?.visible;
    if (tool.id === "avatar") return !!avatarPanel?.group?.visible;
    if (tool.id === "public_join") return !!readSocialState()?.publicJoined;
    if (tool.id === "team_join") return !!agentJoin.getPanel()?.visible;
    if (tool.id === "space_shared") return collabSpace === "shared";
    if (tool.id === "space_local") return collabSpace === "local";
    if (tool.id === "draw_eraser") return !!drawEraserOn;
    if (tool.id === "draw_size_s" || tool.id === "draw_size_m" || tool.id === "draw_size_l") {
      return drawSizeId === tool.id;
    }
    if (tool.id === "win_browser") return !!sceneWinState.browserOn;
    if (tool.id === "win_display") return !!sceneWinState.displayOn;
    if (tool.id === "win_pin") return sceneWinState.pinned !== false;
    if (String(tool.id || "").startsWith("color_")) {
      const hex = `#${tool.color.toString(16).padStart(6, "0")}`;
      return `#${drawColor.toString(16).padStart(6, "0")}`.toLowerCase() === hex.toLowerCase();
    }
    return false;
  }

  function gridCanvasToLocal(kind, px, py) {
    const { canvas, plane } = gridLayout(kind);
    return new THREE.Vector3(
      (px / canvas.w - 0.5) * plane.w,
      (0.5 - py / canvas.h) * plane.h,
      0.006,
    );
  }

  function makeGridHitTarget(kind, id, px, py, pw, ph) {
    const { canvas, plane } = gridLayout(kind);
    const w = (pw / canvas.w) * plane.w;
    const h = (ph / canvas.h) * plane.h;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(w, 0.02), Math.max(h, 0.02)),
      new THREE.MeshBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.001,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.position.copy(gridCanvasToLocal(kind, px + pw / 2, py + ph / 2));
    mesh.renderOrder = 2062;
    mesh.frustumCulled = false;
    mesh.userData.xrGridHit = id;
    mesh.userData.xrGridKind = kind;
    return mesh;
  }

  function fillXrGridChrome(ctx, width, height, radius = 24) {
    if (shouldUseLiteXrPanelChrome({ presenting })) {
      ctx.fillStyle = "#1c2229";
      roundRect(ctx, 0, 0, width, height, radius);
      ctx.fill();
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 6;
      roundRect(ctx, 3, 3, width - 6, height - 6, Math.max(10, radius - 2));
      ctx.stroke();
      return;
    }
    fillDarkMetalChrome(ctx, width, height, radius);
  }

  function drawGridPopupCanvas(kind) {
    const { spec, canvas } = gridLayout(kind);
    const panel = gridPanelRef(kind);
    const width = canvas.w;
    const height = canvas.h;
    const el = panel?.canvas || document.createElement("canvas");
    const ctx = bindHudCanvas2d(el, width, height);
    fillXrGridChrome(ctx, width, height, 24);
    fillDarkMetalHeader(ctx, width, canvas.headerEnd, 24);
    drawHudLabel(ctx, spec.title, 28, Math.round(canvas.headerEnd * 0.42), {
      font: "800 42px Arial,sans-serif",
      lineWidth: 8,
      maxWidth: width - 168,
    });
    drawHudLabel(ctx, spec.subtitle, 28, Math.round(canvas.headerEnd * 0.74), {
      font: "800 22px Arial,sans-serif",
      fill: "#7dd3fc",
      maxWidth: width - 168,
      lineWidth: 6,
    });
    drawWindowOverflowDots(ctx, width, canvas.headerEnd);
    drawWindowCloseX(ctx, width, canvas.headerEnd);
    if (hudOverflowOpen[kind]) {
      const menu = hudOverflowMenuLayout(width, canvas.headerEnd, {
        locked: isXrHudLocked(spec.poseKind || kind, typeof localStorage !== "undefined" ? localStorage : null),
      });
      ctx.fillStyle = "#0f172a";
      roundRect(ctx, menu.x, menu.y, menu.w, menu.h, 14);
      ctx.fill();
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 4;
      roundRect(ctx, menu.x + 2, menu.y + 2, menu.w - 4, menu.h - 4, 12);
      ctx.stroke();
      ctx.fillStyle = isXrHudLocked(spec.poseKind || kind, typeof localStorage !== "undefined" ? localStorage : null)
        ? "#166534"
        : "#1e293b";
      roundRect(ctx, menu.lock.x, menu.lock.y, menu.lock.w, menu.lock.h, 10);
      ctx.fill();
      drawHudLabel(ctx, menu.lock.label, menu.lock.x + menu.lock.w / 2, menu.lock.y + menu.lock.h / 2, {
        font: "800 22px Arial,sans-serif",
        align: "center",
        lineWidth: 6,
      });
    }
    if (kind === "settings") {
      SETTINGS_PANEL_TAB_IDS.forEach((id, i) => {
        const cell = settingsTabCell(i);
        const on = settingsTab === id;
        ctx.fillStyle = on ? "#7dd3fc" : "#3f4854";
        roundRect(ctx, cell.x, cell.y, cell.w, cell.h, 10);
        ctx.fill();
        ctx.fillStyle = on ? "#0f172a" : "#e2e8f0";
        ctx.font = SETTINGS_PANEL_TAB_IDS.length > 3 ? "800 15px Arial,sans-serif" : "800 20px Arial,sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(SETTINGS_PANEL_TAB_LABELS[id] || id, cell.x + cell.w / 2, cell.y + cell.h / 2);
      });
    }
    const tools = gridSpecTools(kind);
    tools.forEach((tool, i) => {
      const cell = gridToolCell(kind, i);
      const on = gridToolIsOn(tool);
      ctx.fillStyle = on ? "rgba(14,116,144,0.38)" : "rgba(15,23,42,0.28)";
      roundRect(ctx, cell.x, cell.y, cell.w, cell.h, 16);
      ctx.fill();
      if (on) {
        ctx.strokeStyle = "rgba(125,211,252,0.95)";
        ctx.lineWidth = 5;
        roundRect(ctx, cell.x, cell.y, cell.w, cell.h, 16);
        ctx.stroke();
      }
      const hex = `#${(tool.color >>> 0).toString(16).padStart(6, "0")}`;
      ctx.beginPath();
      ctx.arc(cell.x + cell.w / 2, cell.y + cell.h * 0.38, Math.min(cell.w, cell.h) * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = hex;
      ctx.fill();
      drawFilledIcon(ctx, tool.icon, cell.x + cell.w / 2, cell.y + cell.h * 0.38, Math.min(cell.w, cell.h) * 0.42, "#ffffff");
      drawHudLabel(ctx, tool.label, cell.x + cell.w / 2, cell.y + cell.h * 0.78, {
        font: "800 24px Arial,sans-serif",
        align: "center",
        lineWidth: 6,
      });
    });
    if (spec.footer) {
      const footer = kind === "settings" && settingsTab === "windows"
        ? XR_SCENE_WIN_OS_LIMIT
        : spec.footer;
      ctx.fillStyle = "#94a3b8";
      ctx.font = kind === "settings" && settingsTab === "windows" ? "14px Arial,sans-serif" : "16px Arial,sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(footer, width / 2, height - 22);
    }
    return el;
  }

  function ensureGridPopup(kind) {
    let panel = gridPanelRef(kind);
    if (panel) return panel;
    const { spec, canvas, plane, tools } = gridLayout(kind);
    const cvs = drawGridPopupCanvas(kind);
    const tex = sharpenCanvasTex(new THREE.CanvasTexture(cvs));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(plane.w, plane.h),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    mesh.renderOrder = 2060;
    mesh.frustumCulled = false;
    mesh.userData.xrGridPanel = kind;
    mesh.userData.xrHudPlane = true;
    const hits = [];
    hits.push(makeGridHitTarget(kind, "hide", canvas.w - 88, 8, 80, canvas.headerEnd - 12));
    hits.push(makeGridHitTarget(kind, "overflow", canvas.w - 176, 8, 80, canvas.headerEnd - 12));
    hits.push(makeGridHitTarget(kind, "drag", 8, 8, canvas.w - 188, canvas.headerEnd - 12));
    hits.push(makeGridHitTarget(kind, "rotate", 0, canvas.headerEnd, 36, canvas.h - canvas.headerEnd));
    hits.push(makeGridHitTarget(kind, "rotate", canvas.w - 36, canvas.headerEnd, 36, canvas.h - canvas.headerEnd));
    if (kind === "settings") {
      SETTINGS_PANEL_TAB_IDS.forEach((id, i) => {
        const cell = settingsTabCell(i);
        hits.push(makeGridHitTarget(kind, `stab:${id}`, cell.x, cell.y, cell.w, cell.h));
      });
      for (let i = 0; i < 12; i += 1) {
        const cell = gridToolCell(kind, i);
        const tool = tools[i];
        const hit = makeGridHitTarget(kind, tool?.id || "noop", cell.x, cell.y, cell.w, cell.h);
        hit.visible = !!tool;
        hits.push(hit);
      }
    } else {
      spec.tools.forEach((tool, i) => {
        const cell = gridToolCell(kind, i);
        hits.push(makeGridHitTarget(kind, tool.id, cell.x, cell.y, cell.w, cell.h));
      });
    }
    const titleBar = new THREE.Mesh(
      new THREE.PlaneGeometry(plane.w - 0.07, 0.045),
      new THREE.MeshBasicMaterial({
        color: 0x7dd3fc,
        transparent: true,
        opacity: 0.001,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    titleBar.position.set(-0.018, plane.h / 2 - 0.022, 0.007);
    titleBar.renderOrder = 2061;
    titleBar.frustumCulled = false;
    titleBar.userData.xrGridHit = "drag";
    titleBar.userData.xrGridKind = kind;
    panel = { kind, group: new THREE.Group(), plane: mesh, titleBar, tex, canvas: cvs, hits };
    panel.group.add(mesh);
    panel.group.add(titleBar);
    hits.forEach((h) => panel.group.add(h));
    panel.group.visible = false;
    markWorldUi(panel.group);
    xrHud.add(panel.group);
    setGridPanelRef(kind, panel);
    panel.lastSig = xrGridPopupSignature({
      kind,
      tab: kind === "settings" ? settingsTab : "",
      tools: gridSpecTools(kind).map((tool) => ({
        id: tool.id,
        label: tool.label,
        color: tool.color,
        on: gridToolIsOn(tool),
      })),
    });
    return panel;
  }

  function refreshGridPopup(kind) {
    const panel = gridPanelRef(kind);
    if (!panel) return;
    if (kind === "social") {
      const social = readSocialState();
      const joined = !!social?.publicJoined;
      SOCIAL_HUB_TOOLS.forEach((tool) => {
        if (tool.id === "voice_toggle") {
          const on = isMicEnabledUi();
          tool.label = on ? "Mic on" : "Mic off";
          tool.color = on ? 0x22c55e : 0xef4444;
        }
        if (tool.id === "public_join") tool.label = joined ? "Leave" : social?.publicJoining ? "Joining…" : "Join";
      });
    }
    const tools = gridSpecTools(kind).map((tool) => ({
      id: tool.id,
      label: tool.label,
      color: tool.color,
      on: gridToolIsOn(tool),
    }));
    const nextSig = xrGridPopupSignature({
      kind,
      tab: kind === "settings" ? settingsTab : "",
      tools,
    });
    if (!shouldRedrawXrConsole({ lastSig: panel.lastSig, nextSig })) return;
    const cvs = drawGridPopupCanvas(kind);
    panel.canvas = cvs;
    panel.tex.image = cvs;
    panel.tex.needsUpdate = true;
    panel.lastSig = nextSig;
  }

  function openGridPopup(kind, opts = {}) {
    const spec = GRID_POPUP_SPECS[kind];
    if (!spec) return;
    const existed = !!gridPanelRef(kind);
    const panel = ensureGridPopup(kind);
    if (existed) {
      if (shouldPaintXrHudPanelOnSelectTick({ presenting })) refreshGridPopup(kind);
      else refreshGridPopupSoon(kind);
    }
    panel.group.visible = true;
    const forcePlace = opts.forcePlace === true;
    ensureHudWorldParent(panel.group);
    if (!forcePlace && panel.worldPlaced && panelWorldPosIsUsable(panel.group)) return;
    if (!forcePlace) {
      if (opts.keepPose && panelWorldPosIsUsable(panel.group)) {
        panel.worldPlaced = true;
        return;
      }
      if (applySavedPanelPose(spec.poseKind, panel.group)) {
        panel.worldPlaced = true;
        return;
      }
    }
    const pos = spawnPanelWorldPos(spec.defaultRight);
    setPanelWorldPose(panel.group, pos);
    facePanelTowardHead(panel.group, pos);
    panel.worldPlaced = true;
    savePanelPose(spec.poseKind, panel.group);
  }

  function closeGridPopup(kind) {
    const spec = GRID_POPUP_SPECS[kind];
    const panel = gridPanelRef(kind);
    if (panel) {
      panel.group.visible = false;
      try { savePanelPose(spec.poseKind, panel.group); } catch (_) {}
    }
  }

  function toggleGridPopup(kind) {
    try {
      const panel = gridPanelRef(kind);
      if (panel?.group?.visible) {
        closeGridPopup(kind);
        return;
      }
      const open = () => openGridPopup(kind, { forcePlace: false, keepPose: true });
      if (deferHudOpenIfNeeded(kind, panel, open)) return;
      open();
    } catch (err) {
      console.warn("[viewport-xr] grid popup", kind, err);
    }
  }

  function hudStorage() {
    try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
  }

  function beginRoboticsHudEmotesFetch() {
    if (roboticsHudEmotesAbort) {
      try { roboticsHudEmotesAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    roboticsHudEmotesAbort = ctl;
    return ctl;
  }
  async function loadRoboticsHudEmotes() {
    const profile = roboticsIntegratedProfile();
    if (!profile) {
      if (roboticsHudEmotesAbort) { try { roboticsHudEmotesAbort.abort(); } catch (_) { /* ignore */ } }
      roboticsHudEmotesAbort = null;
      roboticsHudEmotesLoading = false;
      roboticsHudEmotesError = "";
      roboticsHudEmotes = [];
      paintRoboticsPanel();
      return;
    }
    const ctl = beginRoboticsHudEmotesFetch();
    roboticsHudEmotesLoading = true;
    roboticsHudEmotesError = "";
    paintRoboticsPanel();
    try {
      const data = await requestPiTeleop(profile, "/emotes", { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      const names = roboticsRecordingNames();
      roboticsHudEmotes = [...(data.recordings || []), ...(data.loops || [])].map(item => ({
        ...item,
        name: names[String(item.id || "")] || item.name || item.label || item.id,
      }));
      const pages = Math.max(1, Math.ceil(roboticsHudEmotes.length / 7) || 1);
      roboticsHudEmotePage = Math.min(roboticsHudEmotePage, pages - 1);
    } catch (err) {
      if (ctl.signal.aborted) return;
      roboticsHudEmotesError = err?.message || "Could not load Pi emotes";
    } finally {
      if (roboticsHudEmotesAbort === ctl) {
        roboticsHudEmotesLoading = false;
        if (!ctl.signal.aborted) paintRoboticsPanel();
      }
    }
  }
  globalThis.addEventListener?.("render3d:robotics-recording-saved", () => {
    roboticsRecordFeedbackUntil = performance.now() + 2400;
    void loadRoboticsHudEmotes();
    paintRoboticsPanel();
  });

  async function playRoboticsHudEmote(emoteId) {
    const profile = roboticsIntegratedProfile();
    if (!profile || !emoteId) return;
    try {
      await requestPiTeleop(profile, "/emote/play", { body: { id: emoteId } });
      onStatus?.("ok", "Playing emote");
    } catch (err) {
      onStatus?.("error", err?.message || "Could not play emote");
    }
  }

  async function homeRoboticsHudRobot() {
    try {
      await requestDimosHomeAndDisarm();
      onStatus?.("ok", "Robot homed · arms down · controls disarmed");
    } catch (err) {
      onStatus?.("error", err?.message || "Robot home request failed");
    } finally {
      paintRoboticsPanel();
    }
  }

  function roboticsHudState() {
    const snap = getDimosTeleopState();
    const now = performance.now();
    if (roboticsWasRecording && !snap.recording && !snap.pendingIntent) roboticsRecordFeedbackUntil = now + 1800;
    roboticsWasRecording = !!snap.recording;
    return {
      armed: !!snap.armed,
      statusKey: snap.statusKey,
      label: snap.label,
      recording: !!snap.recording,
      pending: !!snap.pending,
      pendingIntent: snap.pendingIntent || "",
      recordFeedback: now < roboticsRecordFeedbackUntil ? "saved" : "",
      playing: !!snap.playing,
      looping: !!snap.looping,
      hasClip: !!snap.hasClip,
      overflowOpen: !!roboticsOverflowOpen,
      locked: isXrHudLocked("robotics", hudStorage()),
      clock: xrHudClockLabel,
      battery: xrHudBatteryLabel,
      hoverId: xrHudHoverId,
      terminalOpen: !document.getElementById("robotics-terminal-overlay")?.hidden,
      stats: snap.stats || getDimosTeleopStats(),
      robotName: snap.robotName || "Open Arm",
      hardwareMode: snap.hardwareMode || "mock",
      recognized: !!snap.recognized,
      showViewer: !!snap.showViewer,
      connected: !!snap.connected,
      wsUrl: snap.wsUrl,
      policy: snap.policy,
      viewer: snap.viewer,
      cameraHost: readHandCamPrefs().cameraHost,
      camMode: readHandCamPrefs().camMode,
      vrScene: !!readHandCamPrefs().vrScene,
      controlsOpen: roboticsControlsOpen,
      controlPrefs: getDimosControlPrefs(),
      roboticsProfile: readRoboticsProfile(),
      sharingCameraStatus: roomCameraStatus,
      sharingCamera: roomCamera.state().sharing,
      sharingCameraPending: roomCamera.state().pending,
      camerasStarting: roboticsCamerasStarting,
      cameraError: roboticsCameraError,
      roboticsTab: roboticsHudTab,
      startPosition: readRobotStartPosition(),
      emotes: roboticsHudEmotes,
      emotePage: roboticsHudEmotePage,
      emotesLoading: roboticsHudEmotesLoading,
      emotesError: roboticsHudEmotesError,
      teleop: snap.teleop || {},
      yHoldProgress: Number(snap.yHoldProgress) || 0,
      animationPhase: performance.now() / 180,
      printerConfigOpen: roboticsPrinterConfigOpen,
      printerShared: printerShareIconVisible({
        acceptSends: !!printerPrefs.accept_sends,
        printTargets: sharePrintTargets.length,
      }),
      printer: {
        ...printerPrefs,
        fence: printerPlacement,
        access_code_set: accessCodeIsSet(printerPrefs.access_code) || !!printerPrefs.access_code_set,
      },
    };
  }

  function paintRoboticsPanel() {
    const panel = roboticsPanel;
    if (!panel?.canvas) return;
    const ctx = bindHudCanvas2d(panel.canvas, ROBOTICS_CANVAS.w, ROBOTICS_CANVAS.h);
    const state = roboticsHudState();
    paintRoboticsHud(ctx, state);
    panel.hits?.forEach((h) => {
      const id = h.userData?.xrRoboticsHit;
      if (id === "connect") h.visible = !!state.showViewer && !state.controlsOpen;
      if (id === "config-engage") h.visible = !!state.controlsOpen;
      if (id === "config-gripper") h.visible = false;
      if (["record", "stop", "play", "loop"].includes(id)) h.visible = !state.controlsOpen && state.roboticsTab !== "emotes";
      if (String(id).startsWith("recent-recording")) {
        const index = Number(String(id).split(":")[1]);
        h.visible = !state.controlsOpen && state.roboticsTab === "pi-ui" && !!state.emotes[index];
      }
      if (id === "home") h.visible = true;
    });
    panel.tex.needsUpdate = true;
    roboticsPaintAt = performance.now();
  }

  function updateRoboticsRightHandActivity(now = performance.now()) {
    const snap = getDimosTeleopState();
    const activity = snap.pendingIntent || (snap.teleop?.homing ? "homing" : snap.recording && snap.teleop?.holding ? "paused" : snap.recording ? "recording" : "");
    const grip = getRightGrip() || posedControllerForHand(1) || controllers[1] || null;
    if (!roboticsRightHandActivity && grip) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.022, 0.0032, 8, 36, Math.PI * 1.6),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.9, depthTest: false }),
      );
      ring.name = "roboticsRightHandActivity";
      ring.position.set(0.045, 0.045, -0.035);
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 3000;
      grip.add(ring);
      roboticsRightHandActivity = ring;
    }
    if (!roboticsRightHandStatus && grip) {
      const canvas = document.createElement("canvas");
      canvas.width = 768;
      canvas.height = 288;
      const texture = sharpenCanvasTex(new THREE.CanvasTexture(canvas));
      texture.colorSpace = THREE.SRGBColorSpace;
      const card = new THREE.Mesh(
        new THREE.PlaneGeometry(0.22, 0.083),
        new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false }),
      );
      card.name = "roboticsRightControllerRecordingStatus";
      card.renderOrder = 3001;
      card.frustumCulled = false;
      card.userData.canvas = canvas;
      card.userData.texture = texture;
      // Keep this in world space so it can face the headset while following
      // the right controller across Quest grip/aim coordinate conventions.
      scene.add(card);
      roboticsRightHandStatus = card;
    }
    if (roboticsRightHandStatus) {
      roboticsRightHandStatus.visible = !!presenting && !!(
        snap.connected || snap.showViewer || isDimosTeleopArmed() || snap.armed || snap.teleop?.armed || snap.recording || snap.pendingIntent || Number(snap.yHoldProgress) > 0
      );
      if (roboticsRightHandStatus.visible) {
        if (grip) {
          grip.getWorldPosition(roboticsRightHandStatusPos);
          camera.getWorldQuaternion(roboticsRightHandStatusQuat);
          roboticsRightHandStatusUp.set(0, 1, 0).applyQuaternion(roboticsRightHandStatusQuat).multiplyScalar(0.12);
          roboticsRightHandStatusRight.set(1, 0, 0).applyQuaternion(roboticsRightHandStatusQuat).multiplyScalar(0.055);
          roboticsRightHandStatusToward.set(0, 0, 1).applyQuaternion(roboticsRightHandStatusQuat).multiplyScalar(0.035);
          roboticsRightHandStatus.position.copy(roboticsRightHandStatusPos)
            .add(roboticsRightHandStatusUp)
            .add(roboticsRightHandStatusRight)
            .add(roboticsRightHandStatusToward);
          roboticsRightHandStatus.quaternion.copy(roboticsRightHandStatusQuat);
        }
        const ui = rightControllerRecordingUi({
          ...snap,
          datasetFolder: snap.datasetFolder || getDimosViewerSnapshot()?.datasetFolder,
        });
        const signature = `${ui.state}|${ui.a}|${ui.b}|${ui.y}|${ui.folder}|${Math.round(ui.yHoldProgress * 20)}|${Math.floor(now / 250)}`;
        if (signature !== roboticsRightHandStatusSignature) {
          roboticsRightHandStatusSignature = signature;
          const canvas = roboticsRightHandStatus.userData.canvas;
          const ctx = canvas.getContext("2d");
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = "rgba(8,14,22,0.96)";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.strokeStyle = ui.state.includes("RECORD") ? "#ef4444" : "#64748b";
          ctx.lineWidth = 8;
          ctx.strokeRect(4, 4, canvas.width - 8, canvas.height - 8);
          ctx.textBaseline = "middle";
          ctx.textAlign = "left";
          ctx.font = "800 38px Arial,sans-serif";
          ctx.fillStyle = ui.stateColor;
          ctx.fillText(ui.state, 24, 39);
          ctx.font = "800 26px Arial,sans-serif";
          ctx.fillStyle = "#f8fafc";
          ctx.fillText(ui.a, 24, 94);
          ctx.fillText(ui.b, 390, 94);
          ctx.fillStyle = "#7dd3fc";
          ctx.fillText(ui.y, 24, 148);
          ctx.beginPath();
          ctx.arc(714, 148, 25, 0, Math.PI * 2);
          ctx.strokeStyle = "#334155";
          ctx.lineWidth = 7;
          ctx.stroke();
          if (ui.yHoldProgress > 0) {
            ctx.beginPath();
            ctx.arc(714, 148, 25, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ui.yHoldProgress);
            ctx.strokeStyle = "#38bdf8";
            ctx.lineWidth = 7;
            ctx.lineCap = "round";
            ctx.stroke();
          }
          ctx.fillStyle = "#cbd5e1";
          ctx.font = "700 24px Arial,sans-serif";
          ctx.fillText(ui.folder.slice(0, 50), 24, 202);
          ctx.fillStyle = "#94a3b8";
          ctx.font = "700 20px Arial,sans-serif";
          ctx.fillText("A records/saves · B discards · Y controls robot", 24, 252);
          roboticsRightHandStatus.userData.texture.needsUpdate = true;
        }
      }
    }
    if (!roboticsRightHandActivity) return;
    if (grip && roboticsRightHandActivity.parent !== grip) grip.add(roboticsRightHandActivity);
    roboticsRightHandActivity.visible = !!activity && !!presenting;
    if (!roboticsRightHandActivity.visible) return;
    roboticsRightHandActivity.rotation.z = now / 180;
    const color = activity === "recording" ? 0xef4444 : activity === "stopping" ? 0xf59e0b : activity === "paused" ? 0xfacc15 : 0x38bdf8;
    roboticsRightHandActivity.material.color.setHex(color);
    roboticsRightHandActivity.material.opacity = activity === "recording" ? 0.55 + 0.35 * Math.sin(now / 150) : 0.9;
  }

  function ensureRoboticsPanel() {
    if (roboticsPanel) return roboticsPanel;
    const canvas = document.createElement("canvas");
    bindHudCanvas2d(canvas, ROBOTICS_CANVAS.w, ROBOTICS_CANVAS.h);
    const tex = sharpenCanvasTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(ROBOTICS_PLANE.w, ROBOTICS_PLANE.h),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    mesh.renderOrder = 2064;
    mesh.frustumCulled = false;
    try { applyWorldUiPickMaterialFlags(mesh.material); } catch (_) {}
    const titleBar = new THREE.Mesh(
      new THREE.PlaneGeometry(ROBOTICS_PLANE.w * 0.78, 0.042),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.001,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    titleBar.position.set(-0.02, ROBOTICS_PLANE.h / 2 - 0.018, 0.007);
    titleBar.scale.set(1, 0.72, 1);
    titleBar.renderOrder = 2065;
    titleBar.frustumCulled = false;
    titleBar.userData.xrRoboticsDrag = true;
    const hits = [];
    const layout = roboticsLayout();
    const addRobotHit = (id, cell, kind = "robotics-action") => {
      if (!cell) return;
      const w = (cell.w / ROBOTICS_CANVAS.w) * ROBOTICS_PLANE.w;
      const h = (cell.h / ROBOTICS_CANVAS.h) * ROBOTICS_PLANE.h;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.max(w, 0.02), Math.max(h, 0.02)),
        new THREE.MeshBasicMaterial({
          color: 0xfbbf24,
          transparent: true,
          opacity: 0.001,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      plane.position.set(
        (cell.x / ROBOTICS_CANVAS.w - 0.5) * ROBOTICS_PLANE.w + w / 2,
        (0.5 - (cell.y + cell.h / 2) / ROBOTICS_CANVAS.h) * ROBOTICS_PLANE.h,
        0.01,
      );
      plane.renderOrder = 2066;
      plane.frustumCulled = false;
      plane.userData.xrRoboticsHit = id;
      plane.userData.xrRoboticsKind = kind;
      hits.push(plane);
    };
    for (const cell of layout.tabs) addRobotHit(cell.id, cell);
    addRobotHit("enable", layout.enable);
    addRobotHit("home", layout.home);
    addRobotHit("disable", layout.disable);
    addRobotHit("camera", layout.camera);
    addRobotHit("cam-wrist", layout.camWrist);
    addRobotHit("cam-move", layout.camMove);
    addRobotHit("cam-vr", layout.camVr);
    addRobotHit("terminal", layout.terminal);
    addRobotHit("config", layout.config);
    addRobotHit("config-engage", layout.engageConfig);
    addRobotHit("config-gripper", layout.gripperConfig);
    addRobotHit("connect", layout.connect);
    addRobotHit("record", layout.record);
    addRobotHit("stop", layout.stop);
    addRobotHit("play", layout.play);
    addRobotHit("loop", layout.loop);
    for (const cell of layout.recentRows || []) addRobotHit(cell.id, cell);
    for (const cell of layout.recentEdits || []) addRobotHit(cell.id, cell);
    addRobotHit("hide", layout.header?.close, "robotics-action");
    addRobotHit("overflow", layout.header?.overflow, "robotics-action");
    addRobotHit("drag", layout.header?.drag, "robotics-drag");
    const group = new THREE.Group();
    group.name = "xrRoboticsPanel";
    group.add(mesh);
    group.add(titleBar);
    hits.forEach((h) => group.add(h));
    group.visible = false;
    markWorldUi(group);
    xrHud.add(group);
    roboticsPanel = { group, plane: mesh, titleBar, tex, canvas, hits, worldPlaced: false };
    overlayRelayerDirty = true;
    paintRoboticsPanel();
    return roboticsPanel;
  }

  function closeRoboticsPanel() {
    if (roboticsHudEmotesAbort) {
      try { roboticsHudEmotesAbort.abort(); } catch (_) { /* ignore */ }
      roboticsHudEmotesAbort = null;
    }
    roboticsHudEmotesLoading = false;
    if (roboticsPanel?.group) roboticsPanel.group.visible = false;
    roboticsOverflowOpen = false;
    try { if (roboticsPanel?.group) savePanelPose("robotics", roboticsPanel.group); } catch (_) {}
  }

  function openRoboticsPanel(opts = {}) {
    const panel = ensureRoboticsPanel();
    paintRoboticsPanel();
    if (roboticsIntegratedProfile() && !roboticsHudEmotesLoading && !roboticsHudEmotes.length) void loadRoboticsHudEmotes();
    panel.group.visible = true;
    panel.group.userData.xrStayDocked = true;
    panel.group.userData.xrHudParked = false;
    panel.group.userData.xrUserRotated = false;
    ensureHudWorldParent(panel.group);
    const locked = isXrHudLocked("robotics", hudStorage());
    if (!opts.forcePlace && (locked || panel.worldPlaced) && panelWorldPosIsUsable(panel.group)) {
      if (locked && applySavedPanelPose("robotics", panel.group)) panel.worldPlaced = true;
    } else if (!opts.forcePlace && applySavedPanelPose("robotics", panel.group)) {
      panel.worldPlaced = true;
    } else {
      const pos = spawnPanelWorldPos(-0.22);
      setPanelWorldPose(panel.group, pos);
      if (!panel.group.userData?.xrUserRotated) facePanelTowardHead(panel.group, pos);
      panel.worldPlaced = true;
      savePanelPose("robotics", panel.group);
    }
    // Robotics is an independent HUD; opening it must not rearrange or
    // activate the existing docked-window stack.
  }

  function toggleRoboticsPanel() {
    if (roboticsPanel?.group?.visible) {
      closeRoboticsPanel();
      return;
    }
    const open = () => openRoboticsPanel({ forcePlace: false, keepPose: true });
    if (deferHudOpenIfNeeded("robotics", roboticsPanel, open)) return;
    open();
  }

  function handleRoboticsAction(id) {
    if (id === 'workshop-kill') {
      void requestDimosHomeAndDisarm()
        .then(()=>onStatus?.('ok','Workshop kill pressed · robot homed and disarmed'))
        .catch(error=>onStatus?.('error',`Robot disarmed; Home not confirmed: ${error?.message||error}`));
      return;
    }
    if (id === 'share-camera') {
      if (roomCamera.state().sharing || roomCamera.state().pending) roomCamera.stop();
      else void roomCamera.start().catch(error=>{roomCameraStatus=error.message;onStatus?.('error',error.message);menuFooterHint=error.message;paintRoboticsPanel();});
      return;
    }
    if (id === 'debug') {
      menuFooterHint = "Sending headset and robotics state to Robotics Home…";
      paintRoboticsPanel();
      void sendXrDebugLogToPc({ robotics: true });
      return;
    }
    if (['pi-ui','printer','viser','emotes','start'].includes(id)) {
      roboticsHudTab = id;
      roboticsPrinterConfigOpen = id === 'printer' ? roboticsPrinterConfigOpen : false;
      if (id === 'emotes' || id === 'start') {
        roboticsWorkspace.open('emotes');
        void loadRoboticsHudEmotes();
      } else {
        roboticsWorkspace.open(id);
      }
      paintRoboticsPanel();
      return;
    }
    if (id === "printer-config" || id === "printer-gear") {
      roboticsHudTab = "printer";
      roboticsPrinterConfigOpen = true;
      savePrinterConfig();
      roboticsWorkspace.open("printer");
      paintRoboticsPanel();
      return;
    }
    if (id === "printer-send-pc") {
      sendPrinterConfigToPc();
      return;
    }
    if (id === "printer-bounder") {
      createOrShowPrinterBounder();
      return;
    }
    if (id === "printer-share") {
      handleShareAction("printer_accept");
      paintRoboticsPanel();
      return;
    }
    if (id === "printer-ip") {
      roboticsWorkspace.open("printer");
      sendPrinterConfigToPc("lan_ip");
      return;
    }
    if (id === "printer-pin") {
      roboticsWorkspace.open("printer");
      sendPrinterConfigToPc("pin");
      return;
    }
    if (id === "printer-serial") {
      roboticsWorkspace.open("printer");
      sendPrinterConfigToPc("serial");
      return;
    }
    if (id === "printer-name") {
      roboticsWorkspace.open("printer");
      sendPrinterConfigToPc("name");
      return;
    }
    if (id === "printer_accept" || id === "printer_outline" || id === "printer_model") {
      handleShareAction(id);
      paintRoboticsPanel();
      return;
    }
    if (id === "config" && roboticsHudTab === "printer") {
      roboticsPrinterConfigOpen = true;
      savePrinterConfig();
      roboticsWorkspace.open("printer");
      paintRoboticsPanel();
      return;
    }
    if (id === 'home') {
      void homeRoboticsHudRobot();
      return;
    }
    if (id === 'start-home') {
      saveRobotStartPosition({type:'home'});
      return;
    }
    if (id === 'emote-prev') {
      roboticsHudEmotePage = Math.max(0, roboticsHudEmotePage - 1);
      paintRoboticsPanel();
      return;
    }
    if (id === 'emote-next') {
      roboticsHudEmotePage += 1;
      paintRoboticsPanel();
      return;
    }
    if (String(id).startsWith('emote:')) {
      const emoteId = String(id).slice(6);
      void playRoboticsHudEmote(emoteId);
      return;
    }
    if (String(id).startsWith('recent-recording-edit:')) {
      const item = roboticsHudEmotes[Number(String(id).split(':')[1])];
      if (item) roboticsWorkspace.renameRecording(item, (name) => {
        item.name = name;
        paintRoboticsPanel();
      });
      return;
    }
    if (String(id).startsWith('recent-recording:')) {
      const item = roboticsHudEmotes[Number(String(id).split(':')[1])];
      if (item) void playRoboticsHudEmote(String(item.id || item.name));
      return;
    }
    if (String(id).startsWith('start-emote:')) {
      const emoteId = String(id).slice(12);
      const emote = roboticsHudEmotes.find(item => String(item.id || item.name) === emoteId);
      saveRobotStartPosition({type:'emote', id:emoteId, name:emote?.name || emote?.label || emoteId});
      return;
    }
    if (!id || id === "noop" || id === "drag") return;
    if (id === "hide") {
      closeRoboticsPanel();
      return;
    }
    if (id === "terminal") {
      try { window.__openRoboticsTerminal?.(); } catch (err) { console.warn("[viewport-xr] robotics terminal", err); }
      paintRoboticsPanel();
      return;
    }
    if (id === "overflow") {
      roboticsOverflowOpen = !roboticsOverflowOpen;
      paintRoboticsPanel();
      return;
    }
    if (id === "lock" || id === "unlock") {
      writeXrHudLocked("robotics", id === "lock", hudStorage());
      roboticsOverflowOpen = false;
      if (roboticsPanel?.group) {
        roboticsPanel.worldPlaced = true;
        roboticsPanel.group.userData.xrHudParked = id === "lock";
        try { savePanelPose("robotics", roboticsPanel.group); } catch (_) {}
      }
      paintRoboticsPanel();
      return;
    }
    if (id === "enable") {
      const sess = session || renderer?.xr?.getSession?.() || null;
      setDimosTeleopArmed(true, sess);
      openRoboticsPanel({ forcePlace: false });
      scheduleXrHudOffSelectTick(() => paintRoboticsPanel());
      return;
    }
    if (id === "connect") {
      if (roboticsOwnsExternalSession()) { setDimosTeleopArmed(true, session); return; }
      applyDimosRobotPcHost();
      scheduleXrHudOffSelectTick(() => paintRoboticsPanel());
      return;
    }
    if (id === "camera") {
      try { window.__openRoboticsCameraPopup?.(); } catch (_) {}
      paintRoboticsPanel();
      return;
    }
    if (id === "config" && roboticsIntegratedProfile()) { roboticsWorkspace.open("controls"); return; }
    if (id === "config") {
      roboticsControlsOpen = !roboticsControlsOpen;
      paintRoboticsPanel();
      return;
    }
    if (id === "config-engage" || id === "config-gripper") {
      // Locked Sam Y-map: never toggle X+A / grip arm bindings.
      persistDimosControlPrefs({ engage: "y_map", gripper: "none" });
      if (id === "config-gripper") {
        onStatus?.("ok", "Gripper binding removed — trigger pinches jaw; grip is HUD only.");
      } else {
        onStatus?.("ok", "Engage is Y tap · Reset is Y hold 3s (locked profile).");
      }
      paintRoboticsPanel();
      return;
    }
    if (id === "cam-wrist") {
      persistHandCamMode("wrist");
      restoreHandCamWindowsToWrists();
      paintRoboticsPanel();
      return;
    }
    if (id === "cam-move") {
      persistHandCamMode("detach");
      placeHandCamWindowsInRoom();
      paintRoboticsPanel();
      return;
    }
    if (id === "cam-vr") {
      if (readHandCamPrefs().vrScene) {
        persistHandCamVrScene(false);
        stopDimosHandCamPoll();
        if (handCamWindows) {
          for (const side of ROBOT_CAMERA_SIDES) handCamWindows[side].userHidden = true;
        }
        hideHandCamWindows();
        paintRoboticsPanel();
        return;
      }
      void enableRoboticsWristCameras();
      return;
    }
    if (id === "disable") {
      if (readRoboticsProfile().mode !== 'integrated') stopDimosRecord();
      setDimosTeleopArmed(false);
      scheduleXrHudOffSelectTick(() => paintRoboticsPanel());
      return;
    }
    if (id === "record") {
      if (startDimosRecord() !== false) onStatus?.("ok", "Robot take recording requested · use Stop + Save or Discard on the HUD");
      paintRoboticsPanel();
      return;
    }
    if (id === "stop") {
      if (stopDimosRecord() !== false) onStatus?.("ok", "Stopping and saving robot take…");
      paintRoboticsPanel();
      return;
    }
    if (id === "play") {
      if (roboticsIntegratedProfile()) {
        roboticsHudTab = "emotes";
        roboticsWorkspace.open("emotes");
        void loadRoboticsHudEmotes();
        paintRoboticsPanel();
        return;
      }
      playDimosRecord({ loop: false });
      paintRoboticsPanel();
      return;
    }
    if (id === "loop") {
      const rec = getDimosRecordState();
      if (rec.looping) setDimosLoop(false);
      else playDimosRecord({ loop: true });
      paintRoboticsPanel();
    }
  }

  let roboticsControlsOpen = false;
  let roboticsCamerasStarting = false;
  let roboticsCameraError = "";
  const ROBOT_CAMERA_SIDES = ["left", "right", "pov"];

  async function enableRoboticsWristCameras() {
    if (!isDimosTeleopArmed()) return;
    if (roboticsCamerasStarting) return;
    roboticsCamerasStarting = true;
    roboticsCameraError = "";
    persistHandCamVrScene(true);
    persistHandCamMode("detach");
    if (handCamWindows) {
      for (const side of ROBOT_CAMERA_SIDES) handCamWindows[side].userHidden = false;
    }
    startDimosHandCamPoll();
    const wins = ensureHandCamWindows();
    placeHandCamWindowsInRoom();
    paintRoboticsPanel();
    try {
      const result = await ensureHandCamPublish({ fetchFn: globalThis.fetch?.bind(globalThis), on: true, restart: false });
      if (!result?.publish) roboticsCameraError = result?.error || "Camera stream unavailable";
    } catch (err) {
      roboticsCameraError = err?.message || "Camera stream unavailable";
    } finally {
      roboticsCamerasStarting = false;
      paintRoboticsPanel();
    }
  }

  function placeHandCamWindowsInRoom() {
    const wins = ensureHandCamWindows();
    getHeadPose();
    xrHud.updateWorldMatrix(true, false);
    const parentRotation = xrHud.getWorldQuaternion(new THREE.Quaternion()).invert();
    const slots = {
      left: { x: -0.58, y: 0.10 },
      right: { x: -0.58, y: -0.02 },
      pov: { x: -0.58, y: -0.14 },
    };
    for (const side of ROBOT_CAMERA_SIDES) {
      const win = wins[side];
      tabbedWindows?.forget(win.group);
      const slot = slots[side];
      const position = new THREE.Vector3(slot.x, slot.y, -PANEL_SPAWN_FWD)
        .applyQuaternion(_headQuat).add(_headPos);
      win.group.position.copy(xrHud.worldToLocal(position));
      win.group.quaternion.copy(parentRotation).multiply(_headQuat);
      win.group.userData.xrHandCamDetached = true;
    }
  }

  function forgetRoboticsTransientWindows() {
    if (!tabbedWindows) return;
    if (roboticsPanel?.group) tabbedWindows.forget(roboticsPanel.group);
    if (handCamWindows) {
      for (const side of ROBOT_CAMERA_SIDES) tabbedWindows.forget(handCamWindows[side]?.group);
    }
    for (const group of roboticsWorkspace.groups()) tabbedWindows.forget(group);
  }

  function ensureHandCamWindows() {
    if (handCamWindows) return handCamWindows;
    const make = (side) => {
      const size = restoreWristCamSize();
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 200;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(size.w, size.h),
        new THREE.MeshBasicMaterial({
          map: tex,
          transparent: true,
          side: THREE.DoubleSide,
          depthTest: false,
          depthWrite: false,
        }),
      );
      tex.flipY = true;
      mesh.renderOrder = 2070;
      mesh.frustumCulled = false;
      mesh.userData.xrHandCam = side;
      const handle = new THREE.Mesh(
        new THREE.PlaneGeometry(0.018, 0.018),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, depthTest: false, depthWrite: false }),
      );
      handle.position.set(size.w / 2 - 0.01, -size.h / 2 + 0.01, 0.004);
      handle.userData.xrHandCamResize = side;
      handle.visible = false;
      const hideCanvas = document.createElement("canvas");
      hideCanvas.width = 128;
      hideCanvas.height = 48;
      const hideIdle = hideCanvas.getContext("2d");
      paintWristCamHideButton(hideIdle, { hover: false });
      const hideTex = new THREE.CanvasTexture(hideCanvas);
      hideTex.colorSpace = THREE.SRGBColorSpace;
      hideTex.flipY = true;
      const hideHoverCanvas = document.createElement("canvas");
      hideHoverCanvas.width = 128;
      hideHoverCanvas.height = 48;
      paintWristCamHideButton(hideHoverCanvas.getContext("2d"), { hover: true });
      const hideHoverTex = new THREE.CanvasTexture(hideHoverCanvas);
      hideHoverTex.colorSpace = THREE.SRGBColorSpace;
      hideHoverTex.flipY = true;
      const hideLoc = wristCamHideButtonLocal(size);
      const hideBtn = new THREE.Mesh(
        new THREE.PlaneGeometry(WRIST_CAM_HIDE_SIZE.w, WRIST_CAM_HIDE_SIZE.h),
        new THREE.MeshBasicMaterial({
          map: hideTex,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      hideBtn.position.set(hideLoc.x, hideLoc.y, hideLoc.z);
      hideBtn.userData.xrHandCamHide = side;
      hideBtn.visible = false;
      hideBtn.renderOrder = 2072;
      hideBtn.frustumCulled = false;
      const group = new THREE.Group();
      group.name = `xrHandCam-${side}`;
      group.add(mesh);
      group.add(handle);
      group.add(hideBtn);
      group.visible = false;
      xrHud.add(group);
      const img = typeof Image !== "undefined" ? new Image() : null;
      const winRef = {
        side, group, mesh, handle, hideBtn, hideTex, hideHoverTex,
        canvas, tex, img, live: false, size: { ...size },
        userHidden: false, aimed: false, aimedBy: "",
      };
      if (img) {
        img.crossOrigin = "anonymous";
        img.onload = () => {
          winRef.live = isHandCamJpegLive(img);
        };
        img.onerror = () => {
          winRef.live = false;
        };
      }
      return winRef;
    };
    handCamWindows = { left: make("left"), right: make("right"), pov: make("pov") };
    return handCamWindows;
  }

  function restoreHandCamWindowsToWrists() {
    const wins = ensureHandCamWindows();
    const size = restoreWristCamSize();
    for (const side of ROBOT_CAMERA_SIDES) {
      const win = wins[side];
      tabbedWindows?.forget(win.group);
      win.size = { ...size };
      win.group.scale.set(1, 1, 1);
      win.handle.visible = false;
      win.group.userData.xrHandCamDetached = false;
    }
  }

  function hideHandCamWindows() {
    if (!handCamWindows) return;
    for (const side of ROBOT_CAMERA_SIDES) {
      const win = handCamWindows[side];
      win.group.visible = false;
      win.handle.visible = false;
      if (win.hideBtn) win.hideBtn.visible = false;
    }
  }

  function hideWristCamSide(side) {
    const win = handCamWindows?.[ROBOT_CAMERA_SIDES.includes(side) ? side : "left"];
    if (!win) return;
    win.userHidden = true;
    win.group.visible = false;
    win.handle.visible = false;
    if (win.hideBtn) win.hideBtn.visible = false;
  }

  function resetHandCamAimFlags() {
    if (!handCamWindows) return;
    for (const side of ROBOT_CAMERA_SIDES) {
      handCamWindows[side].aimed = false;
      handCamWindows[side].aimedBy = "";
    }
  }

  function applyHandCamHideHover(hoverHit) {
    if (!handCamWindows) return;
    const armed = isDimosTeleopArmed();
    for (const side of ROBOT_CAMERA_SIDES) {
      const win = handCamWindows[side];
      if (!win?.hideBtn) continue;
      const showBtn = shouldShowWristCamHideButton({
        roboticsEnabled: armed,
        windowVisible: !!win.group?.visible,
        aimingAtWindow: !!win.aimed,
        pointerHand: win.aimedBy,
        windowSide: side,
      });
      win.hideBtn.visible = showBtn;
      const hover = showBtn && hoverHit?.kind === "hand-cam-hide" && hoverHit?.side === side;
      const map = hover ? win.hideHoverTex : win.hideTex;
      if (win.hideBtn.material && win.hideBtn.material.map !== map) {
        win.hideBtn.material.map = map;
        win.hideBtn.material.needsUpdate = true;
      }
    }
  }

  function noteHandCamAimFromHit(hit, controller) {
    if (hit?.kind !== "hand-cam-hide" && hit?.kind !== "hand-cam-hover") return;
    const win = handCamWindows?.[hit.side];
    if (!win) return;
    win.aimed = true;
    const hi = squeezeHandIndex(controller);
    win.aimedBy = hi === 0 ? "left" : hi === 1 ? "right" : (hit.side === "left" ? "right" : "left");
  }

  function pickHandCamUi(raycaster, pointerHand) {
    if (!isDimosTeleopArmed() || !handCamWindows || !raycaster) return null;
    let best = null;
    for (const side of ROBOT_CAMERA_SIDES) {
      const win = handCamWindows[side];
      if (!win?.group?.visible || !win.mesh) continue;
      if (!wristCamPointerIsOtherHand(pointerHand, side)) continue;
      try {
        win.mesh.updateMatrixWorld?.(true);
        let hit = raycaster.intersectObject(win.mesh, false)[0];
        if (!hit) hit = geometricPlaneHit(win.mesh, raycaster);
        if (!hit) continue;
        const local = win.mesh.worldToLocal(hit.point.clone());
        const region = wristCamHideHitFromLocal(local, win.size);
        if (!region) continue;
        win.aimed = true;
        win.aimedBy = pointerHand;
        const mapped = {
          kind: region === "hide" ? "hand-cam-hide" : "hand-cam-hover",
          side,
          distance: hit.distance,
          point: hit.point?.clone?.() || hit.point,
        };
        if (!best || mapped.distance < best.distance) best = mapped;
      } catch (_) {}
    }
    return best;
  }

  function tickHandCamWindows() {
    const presenting = !!renderer?.xr?.isPresenting;
    const roboticsEnabled = isDimosTeleopArmed();
    const prefs = readHandCamPrefs();
    if (!presenting || !roboticsEnabled || !prefs.vrScene) {
      stopDimosHandCamPoll();
      hideHandCamWindows();
      return;
    }
    const wins = ensureHandCamWindows();
    const detach = prefs.camMode === "detach";
    if (detach && !wins.left.group.userData.xrHandCamDetached) placeHandCamWindowsInRoom();
    startDimosHandCamPoll();
    const feed = getDimosViewerSnapshot();
    ensureXrHeadPose();
    const headRight = headRightFlat();
    xrHud.updateWorldMatrix(true, false);
    for (const side of ROBOT_CAMERA_SIDES) {
      const win = wins[side];
      const image = side === "left" ? feed.videoImage : side === "right" ? feed.rightVideoImage : feed.povVideoImage;
      const sourceLive = side === "left" ? feed.leftLive : side === "right" ? feed.rightLive : feed.povLive;
      const decoded = sourceLive && isHandCamJpegLive(image);
      win.live = !!(sourceLive && (decoded || win.lastFrameSrc));
      if (decoded && image && win.lastFrameSrc !== image.src) {
        const ctx = win.canvas.getContext("2d");
        paintHandCamFrame(ctx, {x:0, y:0, w:win.canvas.width, h:win.canvas.height}, {side, image, host:prefs.cameraHost, live:true});
        win.tex.needsUpdate = true; win.lastFrameSrc = image.src;
      } else if (!win.lastFrameSrc) {
        const ctx = win.canvas.getContext("2d");
        paintHandCamFrame(ctx, {x:0, y:0, w:win.canvas.width, h:win.canvas.height}, {side, image, host:prefs.cameraHost, live:false});
        win.tex.needsUpdate = true;
        win.lastFrameSrc = "placeholder";
      }
    }
    for (const side of ROBOT_CAMERA_SIDES) {
      const win = wins[side];
      const show = shouldShowHandCamWindow({
        presenting: true,
        roboticsEnabled: true,
        vrScene: prefs.vrScene,
        hidden: !!win.userHidden,
      });
      if (!show || !tabbedWindows?.isOpen(win.group)) win.group.visible = show;
      win.handle.visible = show && detach;
      if (!show) {
        if (win.hideBtn) win.hideBtn.visible = false;
        continue;
      }
      if (detach && win.group.userData.xrHandCamDetached) continue;
      if (side === "pov") continue;
      const hand = xrNodeForHand(side, hands);
      const trackedWrist = hand?.visible && hand.userData?.inputSource?.hand ? getHandJoint(hand, "wrist") : null;
      const wrist = trackedWrist || xrNodeForHand(side, grips) || xrNodeForHand(side, controllers);
      if (!wrist) continue;
      wrist.updateWorldMatrix?.(true, false);
      _dockGrip.setFromMatrixPosition(wrist.matrixWorld);
      const world = wristCamHudPosition(side, _dockGrip, _headPos, headRight);
      _dockWorld.set(world.x, world.y, world.z);
      win.group.position.copy(xrHud.worldToLocal(_dockWorld));
      // Same as the controller HUD: lookAt the user, then 180° around Y so
      // PlaneGeometry +Z faces the viewer (horizontal, not into the wrist).
      _dockLook.lookAt(_dockWorld, _headPos, _dockUp);
      _dockWorldQ.setFromRotationMatrix(_dockLook);
      _dockWorldQ.multiply(_dockFlip);
      xrHud.getWorldQuaternion(_dockParentQ).invert();
      win.group.quaternion.copy(_dockParentQ).multiply(_dockWorldQ);
    }
  }

  function paintGuidesOntoPanel() {
    const panel = guidesPanel;
    if (!panel?.canvas) return;
    const ctx = bindHudCanvas2d(panel.canvas, GUIDES_CANVAS.w, GUIDES_CANVAS.h);
    paintGuidesPanel(ctx, {
      categoryId: guidesCatId,
      clipIndex: guidesClipIndex,
      timeSec: performance.now() / 1000,
    });
    panel.tex.needsUpdate = true;
    lastGuidePaintAt = performance.now();
  }

  function ensureGuidesPanel() {
    if (guidesPanel) return guidesPanel;
    const canvas = document.createElement("canvas");
    bindHudCanvas2d(canvas, GUIDES_CANVAS.w, GUIDES_CANVAS.h);
    const tex = sharpenCanvasTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(GUIDES_PLANE.w, GUIDES_PLANE.h),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    mesh.renderOrder = 2062;
    mesh.frustumCulled = false;
    const group = new THREE.Group();
    group.name = "xrGuidesPanel";
    group.add(mesh);
    group.visible = false;
    markWorldUi(group);
    xrHud.add(group);
    guidesPanel = { group, plane: mesh, tex, canvas };
    overlayRelayerDirty = true;
    paintGuidesOntoPanel();
    return guidesPanel;
  }

  function closeGuidesPanel() {
    if (guidesPanel?.group) guidesPanel.group.visible = false;
    guidesSwipe = null;
  }

  function openGuidesPanel(opts = {}) {
    const panel = ensureGuidesPanel();
    paintGuidesOntoPanel();
    panel.group.visible = true;
    ensureHudWorldParent(panel.group);
    if (!opts.forcePlace && panel.worldPlaced && panelWorldPosIsUsable(panel.group)) return;
    const pos = spawnPanelWorldPos(0.38);
    setPanelWorldPose(panel.group, pos);
    facePanelTowardHead(panel.group, pos);
    panel.worldPlaced = true;
  }

  function toggleGuidesPanel() {
    if (guidesPanel?.group?.visible) closeGuidesPanel();
    else if (!deferHudOpenIfNeeded("guides", guidesPanel, () => openGuidesPanel())) {
      openGuidesPanel();
    }
    syncDock();
  }

  function handleGuidesAction(id) {
    if (!id || id === "chrome" || id === "drag") return;
    if (id === "hide") {
      closeGuidesPanel();
      syncDock();
      return;
    }
    if (id === "prev" || id === "next") {
      const cat = guideCategoryById(guidesCatId);
      guidesClipIndex = wrapGuideClipIndex(cat, guidesClipIndex, id === "next" ? 1 : -1);
      paintGuidesOntoPanel();
      return;
    }
    if (String(id).startsWith("cat:")) {
      guidesCatId = String(id).slice(4);
      guidesClipIndex = 0;
      paintGuidesOntoPanel();
    }
  }

  function tickGuidesClip() {
    if (!shouldTickGuidesCanvas({
      visible: !!guidesPanel?.group?.visible,
      lastPaintAt: lastGuidePaintAt,
      now: performance.now(),
      enterSettled: xrEnterWorkSettled(),
    })) return;
    paintGuidesOntoPanel();
  }

  function finishGuidesSwipe(controller) {
    if (!guidesSwipe) return;
    let endX = guidesSwipe.lastX;
    try {
      const hit = pickWithController(controller);
      if (hit?.px != null) endX = hit.px;
    } catch (_) {}
    const dir = swipeGuideFromDeltaX(endX - guidesSwipe.startX, 36);
    guidesSwipe = null;
    if (!dir) return;
    const cat = guideCategoryById(guidesCatId);
    guidesClipIndex = wrapGuideClipIndex(cat, guidesClipIndex, dir);
    paintGuidesOntoPanel();
  }

  function pickGridFromCanvasPx(kind, px, py) {
    const { spec, canvas, tools } = gridLayout(kind);
    if (!(px >= 0 && py >= 0 && px <= canvas.w && py <= canvas.h)) return null;
    const poseKind = spec?.poseKind || kind;
    const headerHit = pickHudHeader(px, py, canvas.w, canvas.headerEnd, {
      overflowOpen: !!hudOverflowOpen[kind],
      locked: isXrHudLocked(poseKind, typeof localStorage !== "undefined" ? localStorage : null),
    });
    if (headerHit) {
      if (headerHit.id === "hide") return { kind: "grid-action", panel: kind, id: "hide" };
      if (headerHit.id === "lock" || headerHit.id === "unlock") {
        return { kind: "grid-action", panel: kind, id: headerHit.id };
      }
      if (headerHit.id === "overflow") return { kind: "grid-action", panel: kind, id: "overflow" };
      if (headerHit.id === "move-this" || headerHit.id === "move-set") {
        return { kind: "grid-action", panel: kind, id: headerHit.id };
      }
      if (headerHit.id === "rotate") return { kind: "grid-rotate", panel: kind };
      if (headerHit.id === "drag") return { kind: "grid-drag", panel: kind };
    }
    if (kind === "settings" && canvas.tabBar) {
      for (let i = 0; i < SETTINGS_PANEL_TAB_IDS.length; i += 1) {
        const cell = settingsTabCell(i);
        if (px >= cell.x && px <= cell.x + cell.w && py >= cell.y && py <= cell.y + cell.h) {
          return { kind: "grid-action", panel: kind, id: `stab:${SETTINGS_PANEL_TAB_IDS[i]}` };
        }
      }
    }
    const list = tools || spec.tools;
    for (let i = 0; i < list.length; i += 1) {
      const cell = gridToolCell(kind, i);
      if (px >= cell.x && px <= cell.x + cell.w && py >= cell.y && py <= cell.y + cell.h) {
        return { kind: "grid-action", panel: kind, id: list[i].id };
      }
    }
    return { kind: "grid-chrome", panel: kind };
  }

  function syncSettingsGridHits() {
    const panel = settingsPanel;
    if (!panel?.hits) return;
    const tools = settingsToolsForTab(settingsTab);
    const toolHits = panel.hits.filter((h) => {
      const id = String(h.userData?.xrGridHit || "");
      return id && id !== "hide" && id !== "drag" && !id.startsWith("stab:");
    });
    toolHits.forEach((hit, i) => {
      const tool = tools[i];
      hit.userData.xrGridHit = tool?.id || "noop";
      hit.visible = !!tool;
    });
  }

  function persistDeveloperMode(on) {
    developerMode = developerModeEnabled(on);
    try { localStorage.setItem(XR_DEV_MODE_KEY, developerMode ? "1" : "0"); } catch (_) {}
    try { xrDevStats.setEnabled(developerMode); } catch (_) {}
  }

  async function sendXrDebugLogToPc({ auto = false, exitFlush = false, robotics = false } = {}) {
    if (!robotics && !shouldUploadXrDebuggerLog({ debuggerOpen, explicit: true, auto, exitFlush })) {
      menuFooterHint = "Click both sticks in (L3+R3) to load debugger, then Send log";
      refreshGridPopupSoon("settings");
      return;
    }
    const payload = xrDevStats.snapshot?.({
      auto: false,
      presenting,
      laser: laserPointerActive(),
      framebufferScale: XR_FRAMEBUFFER_SCALE,
      foveation: XR_FOVEATION,
      hudScale: XR_HUD_CANVAS_SCALE,
    }) || {};
    if (payload && typeof payload === "object") {
      payload.auto = false;
      payload.manual = true;
      payload.debuggerOpen = 1;
      payload.robotics = {
        network: getDimosNetworkDebug(),
        controls: getDimosControlDebug(),
        teleop: getDimosTeleopState(),
        profile: readRoboticsProfile(),
        rightControllerHud: (() => {
          const card = roboticsRightHandStatus;
          const host = getRightGrip() || posedControllerForHand(1) || controllers[1] || null;
          const cardPos = new THREE.Vector3();
          const hostPos = new THREE.Vector3();
          if (card) card.getWorldPosition(cardPos);
          if (host) host.getWorldPosition(hostPos);
          return {
            created: !!card,
            visible: !!card?.visible,
            hostFound: !!host,
            parent: String(card?.parent?.name || card?.parent?.type || ""),
            state: rightControllerRecordingUi(getDimosTeleopState()),
            world: card ? cardPos.toArray().map(v => Math.round(v * 1000) / 1000) : null,
            hostWorld: host ? hostPos.toArray().map(v => Math.round(v * 1000) / 1000) : null,
            cameraDistanceM: card ? Math.round(cardPos.distanceTo(camera.getWorldPosition(new THREE.Vector3())) * 1000) / 1000 : null,
          };
        })(),
      };
      if (robotics) {
        payload.description = "Robotics headset debug · last minute";
        payload.kind = "robotics-xr-debug";
        payload.windowMs = 60000;
      }
    }
    try { xrDevStats.noteAction?.("debug_send_pc"); } catch (_) {}
    try {
      const res = await onXrDebugLog?.(payload);
      menuFooterHint = res?.message || "Sent XR log to your PC debugger";
    } catch (err) {
      menuFooterHint = err?.message || "Could not send debug log";
    }
    try { xrDevStats.keepRecording?.(); } catch (_) {}
    refreshGridPopupSoon("settings");
  }

  function questBrowserUa() {
    try {
      return /OculusBrowser|MetaBrowser|Horizon|Quest|XRBrowser|Mobile VR|Wolvic|Helio|PicoBrowser/i.test(navigator.userAgent || "");
    } catch {
      return false;
    }
  }

  function sceneWindowVisible(id) {
    return id === "display" ? !!sceneWinState.displayOn : !!sceneWinState.browserOn;
  }

  function setSceneWindowVisible(id, on) {
    if (id === "display") sceneWinState.displayOn = !!on;
    else sceneWinState.browserOn = !!on;
  }

  function applySceneWindowWidth(win) {
    if (!win?.group) return;
    const s = xrSceneWindowWidthScale(sceneWinState.widthId || "m");
    win.group.scale.setScalar(s);
  }

  function syncSceneWindowParked() {
    const parked = sceneWinState.pinned !== false;
    for (const id of ["browser", "display"]) {
      const g = sceneWindows[id]?.group;
      if (g) g.userData.xrHudParked = parked;
    }
  }

  function removeSceneWindowHtmlOverlay() {
    try { sceneWinHtmlOverlay?.remove?.(); } catch (_) {}
    sceneWinHtmlOverlay = null;
  }

  function syncSceneWindowHtmlOverlay() {
    const allow = xrSceneHtmlOverlayAllowed({
      presenting,
      questBrowser: questBrowserUa(),
    });
    const href = normalizeXrSceneUrl(sceneWinState.url);
    const win = sceneWindows.browser;
    if (!allow || !href || !win?.group?.visible) {
      removeSceneWindowHtmlOverlay();
      return;
    }
    if (!sceneWinHtmlOverlay) {
      const wrap = document.createElement("div");
      wrap.setAttribute("data-xr-scene-win", "browser");
      wrap.style.cssText = "position:fixed;z-index:48;width:min(420px,46vw);height:min(280px,38vh);border:1px solid #334155;border-radius:12px;overflow:hidden;background:#0f172a;box-shadow:0 12px 40px rgba(0,0,0,.45);";
      const iframe = document.createElement("iframe");
      iframe.title = "In-scene browser";
      iframe.referrerPolicy = "no-referrer";
      iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox");
      iframe.style.cssText = "width:100%;height:100%;border:0;background:#0f172a;";
      wrap.appendChild(iframe);
      document.body.appendChild(wrap);
      sceneWinHtmlOverlay = wrap;
    }
    const iframe = sceneWinHtmlOverlay.querySelector("iframe");
    if (iframe && iframe.getAttribute("data-src") !== href) {
      iframe.setAttribute("data-src", href);
      iframe.src = href;
    }
    try {
      const cam = renderer?.xr?.getCamera?.() || camera;
      if (!cam || !win.group) return;
      win.group.updateMatrixWorld(true);
      const pt = new THREE.Vector3();
      win.group.getWorldPosition(pt);
      pt.project(cam);
      const el = renderer?.domElement;
      const rect = el?.getBoundingClientRect?.();
      if (!rect) return;
      const x = rect.left + (pt.x * 0.5 + 0.5) * rect.width;
      const y = rect.top + (-pt.y * 0.5 + 0.5) * rect.height;
      sceneWinHtmlOverlay.style.left = `${Math.round(x - 210)}px`;
      sceneWinHtmlOverlay.style.top = `${Math.round(y - 40)}px`;
    } catch (_) {}
  }

  function openUrlInQuestBrowser(url) {
    const href = normalizeXrSceneUrl(url);
    if (!href) return;
    try { window.open(href, "_blank", "noopener,noreferrer"); } catch (_) {}
  }

  function paintXrSceneWindow(id) {
    const win = sceneWindows[id];
    if (!win?.canvas) return;
    const { w, h, headerEnd } = XR_SCENE_WIN_CANVAS;
    const ctx = bindHudCanvas2d(win.canvas, w, h);
    fillXrGridChrome(ctx, w, h, 22);
    fillDarkMetalHeader(ctx, w, headerEnd, 22);
    const title = id === "display" ? "Virtual display" : "Browser";
    drawHudLabel(ctx, title, 24, Math.round(headerEnd * 0.52), {
      font: "800 28px Arial,sans-serif",
      lineWidth: 7,
      maxWidth: w - 160,
    });
    drawWindowCloseX(ctx, w, headerEnd);
    const chrome = xrSceneWindowChromeRects(w, h, headerEnd);
    ctx.fillStyle = "#334155";
    roundRect(ctx, chrome.resize.x, chrome.resize.y, chrome.resize.w, chrome.resize.h, 8);
    ctx.fill();
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(chrome.resize.x + 10, chrome.resize.y + chrome.resize.h - 10);
    ctx.lineTo(chrome.resize.x + chrome.resize.w - 10, chrome.resize.y + chrome.resize.h - 10);
    ctx.lineTo(chrome.resize.x + chrome.resize.w - 10, chrome.resize.y + 10);
    ctx.stroke();
    if (id === "browser") {
      ctx.fillStyle = "#0f172a";
      roundRect(ctx, chrome.url.x, chrome.url.y, chrome.url.w, chrome.url.h, 10);
      ctx.fill();
      ctx.strokeStyle = sceneWinKbOpen ? "#7dd3fc" : "#64748b";
      ctx.lineWidth = 3;
      roundRect(ctx, chrome.url.x, chrome.url.y, chrome.url.w, chrome.url.h, 10);
      ctx.stroke();
      const shown = String(sceneWinState.url || sceneWinState.urlDraft || "Enter a URL");
      drawHudLabel(ctx, shown.slice(0, 42), chrome.url.x + 12, chrome.url.y + chrome.url.h / 2, {
        font: "700 18px Arial,sans-serif",
        fill: sceneWinState.url || sceneWinState.urlDraft ? "#e2e8f0" : "#64748b",
        align: "left",
        lineWidth: 5,
      });
      ctx.fillStyle = "#0ea5e9";
      roundRect(ctx, chrome.go.x, chrome.go.y, chrome.go.w, chrome.go.h, 10);
      ctx.fill();
      drawHudLabel(ctx, "Go", chrome.go.x + chrome.go.w / 2, chrome.go.y + chrome.go.h / 2, {
        font: "800 18px Arial,sans-serif",
        align: "center",
        lineWidth: 5,
      });
      ctx.fillStyle = "#334155";
      roundRect(ctx, chrome.open.x, chrome.open.y, chrome.open.w, chrome.open.h, 10);
      ctx.fill();
      drawHudLabel(ctx, "Open", chrome.open.x + chrome.open.w / 2, chrome.open.y + chrome.open.h / 2, {
        font: "800 16px Arial,sans-serif",
        align: "center",
        lineWidth: 5,
      });
      if (sceneWinKbOpen) {
        for (const key of xrSceneUrlKeyLayout(w, chrome.keysY)) {
          ctx.fillStyle = key.id === "go" ? "#0ea5e9" : "#1e293b";
          roundRect(ctx, key.x, key.y, key.w, key.h, 8);
          ctx.fill();
          drawHudLabel(ctx, key.label, key.x + key.w / 2, key.y + key.h / 2, {
            font: "800 14px Arial,sans-serif",
            align: "center",
            lineWidth: 4,
          });
        }
      } else {
        ctx.fillStyle = "#1e293b";
        roundRect(ctx, 16, 122, w - 32, h - 178, 14);
        ctx.fill();
        drawHudLabel(ctx, "In-scene web panel", 32, 168, {
          font: "800 24px Arial,sans-serif",
          align: "left",
          lineWidth: 6,
        });
        drawHudLabel(ctx, "Pages render here as a 3D plane. Use Open", 32, 208, {
          font: "600 18px Arial,sans-serif",
          fill: "#94a3b8",
          align: "left",
          lineWidth: 5,
        });
        drawHudLabel(ctx, "to view the site in Quest Browser.", 32, 236, {
          font: "600 18px Arial,sans-serif",
          fill: "#94a3b8",
          align: "left",
          lineWidth: 5,
        });
        const href = normalizeXrSceneUrl(sceneWinState.url);
        drawHudLabel(ctx, href ? href.slice(0, 48) : "No URL yet — Add URL in Settings → Windows", 32, 280, {
          font: "600 16px Arial,sans-serif",
          fill: "#7dd3fc",
          align: "left",
          lineWidth: 5,
        });
      }
    } else {
      ctx.fillStyle = "#0b1220";
      roundRect(ctx, 16, 70, 160, h - 126, 12);
      ctx.fill();
      ctx.fillStyle = "#111827";
      roundRect(ctx, 188, 70, w - 360, h - 126, 12);
      ctx.fill();
      ctx.fillStyle = "#0b1220";
      roundRect(ctx, w - 160, 70, 144, h - 126, 12);
      ctx.fill();
      drawHudLabel(ctx, "Tree", 32, 100, {
        font: "700 16px Arial,sans-serif",
        fill: "#94a3b8",
        align: "left",
        lineWidth: 4,
      });
      drawHudLabel(ctx, "3D Viewport", 208, 168, {
        font: "800 26px Arial,sans-serif",
        align: "left",
        lineWidth: 6,
      });
      drawHudLabel(ctx, "Studio chrome · not Horizon Virtual Display", 208, 208, {
        font: "600 16px Arial,sans-serif",
        fill: "#94a3b8",
        align: "left",
        lineWidth: 5,
      });
      drawHudLabel(ctx, "Chat", w - 148, 100, {
        font: "700 16px Arial,sans-serif",
        fill: "#94a3b8",
        align: "left",
        lineWidth: 4,
      });
      drawHudLabel(ctx, "Tools", w - 148, 132, {
        font: "700 16px Arial,sans-serif",
        fill: "#94a3b8",
        align: "left",
        lineWidth: 4,
      });
    }
    win.tex.needsUpdate = true;
  }

  function placeXrSceneWindow(id) {
    const win = sceneWindows[id];
    if (!win?.group) return;
    ensureXrHeadPose();
    const ids = ["browser", "display"].filter((k) => sceneWindowVisible(k) || k === id);
    const index = Math.max(0, ids.indexOf(id));
    const slot = commandCenterSlot(index, Math.max(1, ids.length));
    const f = headForwardFlat();
    const right = headRightFlat();
    const pos = _headPos.clone().addScaledVector(f, slot.forward).addScaledVector(right, slot.right);
    pos.y = _headPos.y + slot.up;
    setPanelWorldPose(win.group, pos);
    facePanelTowardHead(win.group, pos);
    win.worldPlaced = true;
    applySceneWindowWidth(win);
    syncSceneWindowParked();
  }

  function ensureXrSceneWindow(id) {
    const key = id === "display" ? "display" : "browser";
    if (sceneWindows[key]) return sceneWindows[key];
    const { w, h } = XR_SCENE_WIN_CANVAS;
    const plane = XR_SCENE_WIN_PLANE;
    const cvs = document.createElement("canvas");
    bindHudCanvas2d(cvs, w, h);
    const tex = sharpenCanvasTex(new THREE.CanvasTexture(cvs));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(plane.w, plane.h),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    mesh.renderOrder = 2068;
    mesh.frustumCulled = false;
    mesh.userData.xrSceneWindow = key;
    mesh.userData.xrHudPlane = true;
    const group = new THREE.Group();
    group.name = key === "display" ? "xrSceneVirtualDisplay" : "xrSceneBrowser";
    group.add(mesh);
    group.visible = false;
    markWorldUi(group);
    xrHud.add(group);
    const win = { id: key, group, plane: mesh, tex, canvas: cvs, worldPlaced: false };
    sceneWindows[key] = win;
    paintXrSceneWindow(key);
    return win;
  }

  function showXrSceneWindow(id) {
    const key = id === "display" ? "display" : "browser";
    setSceneWindowVisible(key, true);
    const win = ensureXrSceneWindow(key);
    win.group.visible = true;
    if (!win.worldPlaced) placeXrSceneWindow(key);
    applySceneWindowWidth(win);
    syncSceneWindowParked();
    const paint = () => {
      try { paintXrSceneWindow(key); } catch (_) {}
      if (key === "browser") syncSceneWindowHtmlOverlay();
    };
    if (shouldPaintXrHudPanelOnSelectTick({ presenting })) paint();
    else scheduleXrHudOffSelectTick(paint);
  }

  function hideXrSceneWindow(id) {
    const key = id === "display" ? "display" : "browser";
    setSceneWindowVisible(key, false);
    const win = sceneWindows[key];
    if (win?.group) win.group.visible = false;
    if (key === "browser") {
      sceneWinKbOpen = false;
      removeSceneWindowHtmlOverlay();
    }
  }

  function closeAllXrSceneWindows() {
    hideXrSceneWindow("browser");
    hideXrSceneWindow("display");
    sceneWinKbOpen = false;
  }

  function toggleXrSceneWindow(id) {
    const key = id === "display" ? "display" : "browser";
    const next = !sceneWindowVisible(key);
    if (!next) {
      hideXrSceneWindow(key);
      return;
    }
    const panel = sceneWindows[key];
    const open = () => showXrSceneWindow(key);
    if (deferHudOpenIfNeeded(`scene-${key}`, panel, open)) return;
    open();
  }

  function beginSceneWindowResize(controller, id) {
    const win = sceneWindows[id === "display" ? "display" : "browser"];
    const group = win?.group;
    if (!group || !controller) return;
    beginPanelDrag(controller, group, { translateOnly: true });
    if (panelDrag) {
      panelDrag.resize = true;
      panelDrag.startScale = group.scale.x || 1;
      panelDrag.startCornerDist = 0.2;
      try {
        const corner = new THREE.Vector3();
        win.plane.updateMatrixWorld(true);
        const { w, h } = XR_SCENE_WIN_PLANE;
        corner.set(w / 2, -h / 2, 0);
        win.plane.localToWorld(corner);
        panelDrag.startCornerDist = controller.getWorldPosition(new THREE.Vector3()).distanceTo(corner);
      } catch (_) {}
    }
  }

  function handleXrSceneWindowSelect(hit, controller) {
    const id = hit?.winId === "display" ? "display" : "browser";
    if (hit.kind === "scene-win-close") {
      hideXrSceneWindow(id);
      refreshGridPopupSoon("settings");
      return;
    }
    if (hit.kind === "scene-win-resize") {
      beginSceneWindowResize(controller, id);
      return;
    }
    if (hit.kind === "scene-win-drag" || hit.kind === "scene-win-chrome") {
      beginPanelDrag(controller, sceneWindows[id]?.group, { translateOnly: true });
      return;
    }
    if (hit.kind === "scene-win-url") {
      sceneWinKbOpen = !sceneWinKbOpen;
      if (sceneWinKbOpen && !sceneWinState.urlDraft) sceneWinState.urlDraft = String(sceneWinState.url || "");
      scheduleXrHudOffSelectTick(() => paintXrSceneWindow("browser"));
      return;
    }
    if (hit.kind !== "scene-win-action") return;
    const action = String(hit.id || "");
    if (action === "open") {
      openUrlInQuestBrowser(sceneWinState.url);
      return;
    }
    if (action === "go") {
      const href = writeXrSceneWindowUrl(sceneWinState.urlDraft || sceneWinState.url);
      sceneWinState.url = href;
      sceneWinKbOpen = false;
      scheduleXrHudOffSelectTick(() => {
        paintXrSceneWindow("browser");
        syncSceneWindowHtmlOverlay();
      });
      if (href) openUrlInQuestBrowser(href);
      return;
    }
    if (action.startsWith("key:")) {
      const keyId = action.slice(4);
      sceneWinState.urlDraft = applyXrSceneUrlKey(sceneWinState.urlDraft || sceneWinState.url || "", keyId);
      scheduleXrHudOffSelectTick(() => paintXrSceneWindow("browser"));
    }
  }

  function handleWindowsSettingsAction(id) {
    if (id === "win_browser") {
      toggleXrSceneWindow("browser");
      refreshGridPopupSoon("settings");
      return;
    }
    if (id === "win_display") {
      toggleXrSceneWindow("display");
      refreshGridPopupSoon("settings");
      return;
    }
    if (id === "win_add_url") {
      sceneWinKbOpen = true;
      if (!sceneWinState.urlDraft) sceneWinState.urlDraft = String(sceneWinState.url || "");
      const panel = sceneWindows.browser;
      const open = () => {
        showXrSceneWindow("browser");
      };
      if (deferHudOpenIfNeeded("scene-browser", panel, open)) {
        refreshGridPopupSoon("settings");
        return;
      }
      open();
      refreshGridPopupSoon("settings");
      return;
    }
    if (id === "win_close") {
      closeAllXrSceneWindows();
      refreshGridPopupSoon("settings");
      return;
    }
    if (id === "win_pin") {
      sceneWinState.pinned = sceneWinState.pinned === false;
      writeXrSceneWindowPrefs({ pinned: sceneWinState.pinned });
      syncSceneWindowParked();
      refreshGridPopupSoon("settings");
      return;
    }
    if (id === "win_width") {
      sceneWinState.widthId = nextXrSceneWindowWidthId(sceneWinState.widthId);
      writeXrSceneWindowPrefs({ widthId: sceneWinState.widthId });
      applySceneWindowWidth(sceneWindows.browser);
      applySceneWindowWidth(sceneWindows.display);
      refreshGridPopupSoon("settings");
    }
  }

  function handleGridAction(kind, id) {
    if (!id || id === "noop" || id === "drag") return;
    if (id === "hide") {
      closeGridPopup(kind);
      hudOverflowOpen[kind] = false;
      return;
    }
    if (id === "overflow") {
      hudOverflowOpen[kind] = !hudOverflowOpen[kind];
      refreshGridPopupSoon(kind);
      return;
    }
    if (id === "lock" || id === "unlock") {
      const spec = GRID_POPUP_SPECS[kind];
      const poseKind = spec?.poseKind || kind;
      writeXrHudLocked(poseKind, id === "lock", typeof localStorage !== "undefined" ? localStorage : null);
      hudOverflowOpen[kind] = false;
      const panel = gridPanelRef(kind);
      if (panel?.group) {
        panel.worldPlaced = true;
        panel.group.userData.xrHudParked = id === "lock";
        try { savePanelPose(poseKind, panel.group); } catch (_) {}
      }
      refreshGridPopupSoon(kind);
      return;
    }
    if (String(id).startsWith("stab:")) {
      const next = String(id).slice(5);
      if (SETTINGS_PANEL_TAB_IDS.includes(next) && next !== settingsTab) {
        settingsTab = next;
        if (next === "environment" && presenting && !xrEnvListCache && workspaceSceneMenu) {
          scheduleXrHudOffSelectTick(() => {
            try { xrEnvListCache = loadXrEnvironmentStore(); } catch { xrEnvListCache = []; }
            syncSettingsGridHits();
            refreshGridPopup("settings");
          });
          return;
        }
        syncSettingsGridHits();
        refreshGridPopupSoon("settings");
      }
      return;
    }
    if (String(id).startsWith("win_")) {
      handleWindowsSettingsAction(id);
      return;
    }
    if (id === "rob_viser") {
      try { window.__openRoboticsControlPopup?.(); } catch { /* ignore */ }
      return;
    }
    if (id === "rob_teleop") {
      try { window.__openRoboticsTeleop?.(); } catch { /* ignore */ }
      return;
    }
    if (id === "rob_cam") {
      try { window.__openRoboticsCameraPopup?.(); } catch { /* ignore */ }
      return;
    }
    if (id === "rob_server") {
      try { window.__openRoboticsCloud?.() || window.__openRoboticsServer?.(); } catch { /* ignore */ }
      return;
    }
    if (id === "xr_map_headset") {
      const ids = XR_CONTROL_HEADSETS.map((h) => h.id);
      const cur = activeXrHeadset();
      const i = Math.max(0, ids.indexOf(cur));
      setXrControlHeadset(ids[(i + 1) % ids.length]);
      refreshGridPopupSoon("settings");
      return;
    }
    if (String(id).startsWith("xr_map:")) {
      const actionId = String(id).slice(7);
      beginXrControlListen(actionId);
      refreshGridPopupSoon("settings");
      return;
    }
    if (id === "xr_map_reset") {
      resetXrControlMap();
      cancelXrControlListen();
      refreshGridPopupSoon("settings");
      return;
    }
    if (id === "xr_restart_now") {
      softRefreshVrStayInHeadset();
      return;
    }
    if (id === "dev_mode") {
      persistDeveloperMode(!developerMode);
      refreshGridPopupSoon("settings");
      return;
    }
    if (id === "dev_stats") {
      if (!developerMode) persistDeveloperMode(true);
      xrDevStats.toggleStats?.();
      refreshGridPopupSoon("settings");
      return;
    }
    if (id === "dev_record") {
      if (!developerMode) persistDeveloperMode(true);
      if (xrDevStats.isRecording?.()) xrDevStats.stopRecording?.();
      else xrDevStats.startRecording?.();
      refreshGridPopupSoon("settings");
      return;
    }
    if (id === "dev_send_pc") {
      void sendXrDebugLogToPc();
      return;
    }
    if (String(id).startsWith("ws-env:") || id === "ws-env-generate" || id === "ws-env-menu" || id === "ws-env-back") {
      handleWorkspaceAction(id);
      refreshGridPopupSoon("settings");
      return;
    }
    if (id === "hand_left") {
      setPreferredDockHand("left");
      refreshGridPopupSoon("settings");
      return;
    }
    if (id === "hand_right") {
      setPreferredDockHand("right");
      refreshGridPopupSoon("settings");
      return;
    }
    if (id === "passthrough") {
      setPassthroughOn(!passthroughOn);
      refreshGridPopupSoon("settings");
      return;
    }
    if (id === "voice_toggle") {
      void toggleHeadsetMic().finally(() => {
        if (socialHubPanel?.group?.visible) refreshGridPopupSoon("social");
      });
      return;
    }
    if (id === "team_join") {
      agentJoin.openMenu();
      if (socialHubPanel?.group?.visible) refreshGridPopupSoon("social");
      return;
    }
    if (id === "public_join" || id === "public_leave") {
      const joined = !!readSocialState()?.publicJoined;
      const action = joined ? "public_leave" : "public_join";
      try {
        const res = onSocialAction?.(action);
        onStatus?.('ok', joined ? 'Leaving public room…' : 'Connecting to public room…');
        menuFooterHint=joined?'Leaving public room…':'Connecting to public room…';
        if(socialHubPanel?.group?.visible)refreshGridPopupSoon('social');
        Promise.resolve(res).then(r => {
          if(r?.cancelled)return;
          onStatus?.(r?.ok===false?'error':'ok',r?.error||r?.message||'Room updated');
          menuFooterHint=r?.error||r?.message||'';
          if (socialHubPanel?.group?.visible) refreshGridPopupSoon("social");
        }).catch(e=>{menuFooterHint=e.message||'Public room failed';onStatus?.('error',menuFooterHint);if(socialHubPanel?.group?.visible)refreshGridPopupSoon('social');});
      } catch (e) {menuFooterHint=e.message||'Public room failed';onStatus?.('error',menuFooterHint);}
      return;
    }
    if (id === "room_open" || id === "social_more") {
      socialPane = id === "room_open" ? "room" : "hub";
      const open = () => openMenuConsole({ tab: "social", keepPose: true });
      if (deferHudOpenIfNeeded("menu", explorerPanel, open)) return;
      open();
      return;
    }
    if (id === "avatar") {
      toggleAvatarPanel();
      refreshGridPopupSoon("social");
      return;
    }
    if (id === "workspace") {
      toggleWorkspacePanel();
      refreshGridPopupSoon("settings");
      return;
    }
    if (id === "scenes") {
      workspaceTab = "scene";
      workspaceSceneMenu = true;
      if (!deferHudOpenIfNeeded("workspace", workspacePanel, () => openWorkspacePanel({ forcePlace: false }))) {
        openWorkspacePanel({ forcePlace: false });
      }
      refreshGridPopupSoon("settings");
      return;
    }
    if (id === "guides") {
      toggleGuidesPanel();
      return;
    }
    if (id === "board" || id === "walk" || id === "teleport") {
      handleBoardAction(id);
      refreshGridPopupSoon("settings");
      return;
    }
    if (id === "space_shared" || id === "space_local") {
      setCollabSpace(id === "space_local" ? "local" : "shared");
      refreshGridPopupSoon("settings");
      return;
    }
    if (String(id).startsWith("color_")) {
      applyDrawColor(`#${id.slice(6)}`);
      refreshGridPopupSoon("draw");
      return;
    }
    if (id === "draw_size_s" || id === "draw_size_m" || id === "draw_size_l") {
      setDrawSize(id);
      refreshGridPopupSoon("draw");
      return;
    }
    if (id === "draw_eraser") {
      setDrawEraser(!drawEraserOn);
      refreshGridPopupSoon("draw");
      return;
    }
    setTool(id);
    if (kind === "settings" || kind === "tools" || kind === "aiHub" || kind === "social" || kind === "draw") {
      refreshGridPopupSoon(kind);
    }
  }

  function pickViewFromCanvasPx(px, py) {
    if (!(px >= 0 && py >= 0 && px <= VIEW_CANVAS.w && py <= VIEW_CANVAS.h)) return null;
    const header = pickHudHeader(px, py, VIEW_CANVAS.w, VIEW_CANVAS.headerEnd, {
      overflowOpen: !!hudOverflowOpen.view,
      locked: isXrHudLocked("view", hudStorage()),
    });
    if (header) {
      if (header.id === "hide") return { kind: "view-action", id: "hide" };
      if (header.id === "rotate") return { kind: "view-rotate" };
      if (header.id === "overflow" || header.id === "lock" || header.id === "unlock") {
        return { kind: "view-action", id: header.id };
      }
      return { kind: "view-drag" };
    }
    if (py < VIEW_CANVAS.headerEnd) {
      if (px > VIEW_CANVAS.w - 88) return { kind: "view-action", id: "hide" };
      return { kind: "view-drag" };
    }
    for (let i = 0; i < VIEW_TOOLS.length; i += 1) {
      const cell = viewToolCell(i);
      if (px >= cell.x && px <= cell.x + cell.w && py >= cell.y && py <= cell.y + cell.h) {
        const tool = VIEW_TOOLS[i];
        if (tool.split && px >= cell.x + cell.w - VIEW_TOOL_SPLIT_PX) {
          return { kind: "view-action", id: tool.split };
        }
        return { kind: "view-action", id: tool.id };
      }
    }
    return { kind: "view-chrome" };
  }

  function handleViewAction(id) {
    if (!id || id === "noop") return;
    if (id === "hide") {
      closeViewPanel();
      hudOverflowOpen.view = false;
      return;
    }
    if (id === "overflow") {
      hudOverflowOpen.view = !hudOverflowOpen.view;
      try { viewPanel.tex.needsUpdate = true; drawViewPanelCanvas(); } catch (_) {}
      return;
    }
    if (id === "lock" || id === "unlock") {
      writeXrHudLocked("view", id === "lock", hudStorage());
      hudOverflowOpen.view = false;
      if (viewPanel?.group) {
        viewPanel.worldPlaced = true;
        viewPanel.group.userData.xrHudParked = id === "lock";
        try { savePanelPose("view", viewPanel.group); } catch (_) {}
      }
      try { drawViewPanelCanvas(); viewPanel.tex.needsUpdate = true; } catch (_) {}
      return;
    }
    if (id === "drag") return;
    setTool(id);
  }

  function pickAiFromCanvasPx(px, py) {
    if (!(px >= 0 && py >= 0 && px <= AI_CANVAS.w && py <= AI_CANVAS.h)) return null;
    if (py < AI_LAYOUT.headerEnd || hudOverflowOpen.ai) {
      const header = pickHudHeader(px, py, AI_CANVAS.w, AI_LAYOUT.headerEnd, {
        overflowOpen: !!hudOverflowOpen.ai,
        locked: isXrHudLocked("ai", hudStorage()),
      });
      if (header && (header.id === "overflow" || header.id === "lock" || header.id === "unlock")) {
        return { kind: "ai-action", id: header.id };
      }
      if (header?.id === "rotate") return { kind: "ai-rotate" };
    }
    if (py < AI_LAYOUT.headerEnd) {
      if (px > AI_CANVAS.w - 150) return { kind: "ai-action", id: "hide" };
      if (px > AI_CANVAS.w - 280) return { kind: "ai-action", id: "send_pc" };
      if (px > AI_CANVAS.w - 416) return { kind: "ai-action", id: aiRoundTable?.isVisible?.() ? "sandbox" : "round_table" };
      return { kind: "ai-drag" };
    }
    const tb = AI_LAYOUT.tableBtn;
    if (px >= tb.x && px <= tb.x + tb.w && py >= tb.y && py <= tb.y + tb.h) {
      return { kind: "ai-action", id: aiRoundTable?.isVisible?.() ? "sandbox" : "round_table" };
    }
    const mic = AI_LAYOUT.mic;
    const dx = px - mic.cx;
    const dy = py - mic.cy;
    const micR = mic.r * 1.35;
    if (dx * dx + dy * dy <= micR * micR) return { kind: "ai-action", id: "mic" };
    const thumbIdx = thumbRowHit(px, py, {
      width: AI_CANVAS.w,
      y: AI_LAYOUT.thumbs.y,
      h: AI_LAYOUT.thumbs.h,
      n: AI_LAYOUT.thumbs.n,
    });
    if (thumbIdx != null) return { kind: "ai-action", id: `thumb:${thumbIdx}` };
    if (aiModelPickerOpen) {
      const picked = modelPickerHit(px, py, currentModelPickerLayout());
      if (picked) return picked;
    }
    function cycleHit(y, id) {
      if (py >= y && py <= y + 56 && px >= 40 && px <= AI_CANVAS.w - 40) {
        return { kind: "ai-action", id };
      }
      return null;
    }
    let hit = cycleHit(AI_LAYOUT.keyY, "key");
    if (hit) return hit;
    hit = cycleHit(AI_LAYOUT.modelY, "model");
    if (hit) return hit;
    function pillHit(y, ids) {
      const n = ids.length;
      const gap = 12;
      const bw = (AI_CANVAS.w - 80 - gap * (n - 1)) / n;
      if (py < y || py > y + 56) return null;
      for (let i = 0; i < n; i += 1) {
        const x0 = 40 + i * (bw + gap);
        if (px >= x0 && px <= x0 + bw) return ids[i];
      }
      return null;
    }
    let id = pillHit(AI_LAYOUT.modeY, ["mode:render", "mode:v2", "mode:mesh"]);
    if (id) return { kind: "ai-action", id };
    id = pillHit(AI_LAYOUT.speedY, ["speed:fast", "speed:quality"]);
    if (id) return { kind: "ai-action", id };
    id = pillHit(AI_LAYOUT.targetY, ["target:new", "target:edit"]);
    if (id) return { kind: "ai-action", id };
    const typed = promptFieldHit(px, py, AI_LAYOUT.transcript);
    if (typed) return typed;
    const prog = progressHit(px, py, {
      x: 40,
      y: AI_LAYOUT.progress.y,
      w: AI_CANVAS.w - 80,
      h: AI_LAYOUT.progress.h,
    });
    if (prog) return prog;
    for (let i = 0; i < AI_LAYOUT.historyN; i += 1) {
      const y = AI_LAYOUT.historyY + i * AI_LAYOUT.historyH;
      if (py >= y && py <= y + AI_LAYOUT.historyH - 6 && px >= 40 && px <= AI_CANVAS.w - 40) {
        return { kind: "ai-action", id: `hist:${i}` };
      }
    }
    const ry = AI_LAYOUT.run.y;
    if (py >= ry && py <= ry + AI_LAYOUT.run.h && px >= 40 && px <= AI_CANVAS.w - 40) {
      const inner = AI_CANVAS.w - 80;
      const gap = 12;
      const bw = (inner - gap * 3) / 4;
      const slot = Math.max(0, Math.min(3, Math.floor((px - 40) / (bw + gap))));
      const ids = ["draw", "talk", "round_table", "run"];
      return { kind: "ai-action", id: ids[slot] };
    }
    return null;
  }

  function pickAiFromLocalPoint(local) {
    const halfW = AI_PLANE.w / 2;
    const halfH = AI_PLANE.h / 2;
    const u = (local.x + halfW) / AI_PLANE.w;
    const fromTop = (halfH - local.y) / AI_PLANE.h;
    if (u < 0 || u > 1 || fromTop < 0 || fromTop > 1) return null;
    return pickAiFromCanvasPx(u * AI_CANVAS.w, fromTop * AI_CANVAS.h);
  }

  function handleAiAction(id) {
    if (String(id).startsWith("board:")) { void aiDrawWorkspace.action(id); return; }
    if (!id || id === "noop") return;
    if (id === "hide") {
      closeAiPromptPanel();
      hudOverflowOpen.ai = false;
      return;
    }
    if (id === "overflow") {
      hudOverflowOpen.ai = !hudOverflowOpen.ai;
      refreshAiPromptPanel();
      return;
    }
    if (id === "lock" || id === "unlock") {
      writeXrHudLocked("ai", id === "lock", hudStorage());
      hudOverflowOpen.ai = false;
      if (aiPanel?.group) {
        aiPanel.worldPlaced = true;
        aiPanel.group.userData.xrHudParked = true;
        try { savePanelPose("ai", aiPanel.group); } catch (_) {}
      }
      refreshAiPromptPanel();
      return;
    }
    if (id === "type") {
      if (aiKeyboardOpen) closeAiKeyboard();
      else openAiKeyboard();
      return;
    }
    if (id === "progress") {
      if (aiLoadingOpen) closeAiLoading();
      else openAiLoading();
      return;
    }
    if (id === "kb_chrome") return;
    if (String(id).startsWith("kb:")) {
      const next = applyKeyboardKey(readAiState().draft || "", id, { shift: aiKeyboardShift });
      aiKeyboardShift = !!next.shift;
      if (next.action === "done") {
        closeAiKeyboard();
      }
      try { onSetPromptDraft?.(next.draft); } catch (_) {}
      if (aiPanel) aiPanel.status = "";
      refreshAiPromptPanel();
      return;
    }
    if (id === "load_close" || id === "load_chrome") {
      if (id === "load_close") closeAiLoading();
      return;
    }
    if (id === "load_drag") return;
    if (id === "load_up") {
      aiLoadingScroll = Math.max(0, aiLoadingScroll - 1);
      refreshAiLoading();
      return;
    }
    if (id === "load_down") {
      aiLoadingScroll += 1;
      refreshAiLoading();
      return;
    }
    if (id === "round_table") {
      toggleAiRoundTable();
      return;
    }
    if (id === "sandbox") {
      const out = toggleSandboxFromSlot();
      try { syncTopPromptSlot({ tableOn: true, sandboxOn: !!out.visible }); } catch { /* */ }
      try { refreshAiPromptPanel(); } catch { /* */ }
      return;
    }
    if (id === "send_pc" || id === "send_prompt_pc") {
      void sendPromptToLaptop();
      if (aiPanel) aiPanel.status = "Sending prompt + sketches to your laptop…";
      refreshAiPromptPanel();
      return;
    }
    if (id === "draw") {
      toggleVoiceDraw();
      if (aiPanel) {
        aiPanel.status = activeTool === "draw"
          ? "Draw on — hold trigger toward the model or in space"
          : (voiceDraw.clipCount?.()
            ? `Sketch ${voiceDraw.clipCount()} kept — Draw again, Talk, then Run`
            : "");
      }
      refreshAiPromptPanel();
      return;
    }
    if (id === "talk") {
      if (aiPanel?.talkPending) return;
      if (aiPanel) {
        aiPanel.status = aiPanel.talkStatus = "Connecting to Astra…";
        aiPanel.talking = false;
        aiPanel.talkConnecting = aiPanel.talkPending = true;
        aiPanel.talkError = false;
      }
      refreshAiPromptPanel();
      try {
        const result = beginAstraTalk({ toggle: false });
        Promise.resolve(result).then((res) => {
          if (aiPanel) {
            aiPanel.talkPending = false;
            aiPanel.talking = res?.ok !== false && res?.live === true;
            aiPanel.talkConnecting = res?.ok !== false && res?.connecting === true;
            aiPanel.talkError = !aiPanel.talking && !aiPanel.talkConnecting;
            aiPanel.status = aiPanel.talkStatus = aiPanel.talking
              ? "Astra is listening — she will talk in the headset"
              : aiPanel.talkConnecting ? "Connecting to Astra…"
                : String(res?.error || "Astra voice is not ready. Try Talk again.");
          }
          refreshAiPromptPanel();
        }).catch((err) => {
          if (aiPanel) {
            aiPanel.talking = false;
            aiPanel.talkConnecting = aiPanel.talkPending = false;
            aiPanel.talkError = true;
            aiPanel.status = aiPanel.talkStatus = err?.message || "Talk failed";
          }
          refreshAiPromptPanel();
        });
      } catch (err) {
        if (aiPanel) {
          aiPanel.talking = false;
          aiPanel.talkConnecting = aiPanel.talkPending = false;
          aiPanel.talkError = true;
          aiPanel.status = aiPanel.talkStatus = err?.message || "Talk failed";
        }
        refreshAiPromptPanel();
      }
      return;
    }
    if (String(id).startsWith("thumb:")) {
      const idx = Number(String(id).slice(6));
      const images = readAiState().composeImages || [];
      const img = images[idx];
      if (img?.id) {
        try { onRemoveComposeImage?.(img.id); } catch (_) {}
        try { voiceDraw.removeClip?.(img.id); } catch (_) {}
        if (aiPanel) aiPanel.status = "Removed sketch";
        refreshAiPromptPanel();
      }
      return;
    }
    if (id === "mic") {
      if (aiPanel) aiPanel.status = "Starting mic…";
      refreshAiPromptPanel();
      try {
        const result = onTranscribeToggle?.();
        Promise.resolve(result).then((res) => {
          if (aiPanel) {
            if (res && res.ok === false && res.error) {
              aiPanel.status = String(res.error);
            } else if (res?.listening) {
              aiPanel.status = "Listening — speak now";
            } else {
              aiPanel.status = "";
            }
          }
          refreshAiPromptPanel();
          if (explorerPanel?.group.visible && menuTab === "ai") {
            openMenuConsole({ tab: "ai", keepPose: true });
          }
        }).catch((err) => {
          console.warn("[viewport-xr] mic", err);
          if (aiPanel) aiPanel.status = err?.message || "Mic failed";
          refreshAiPromptPanel();
        });
      } catch (err) {
        console.warn("[viewport-xr] mic", err);
        if (aiPanel) aiPanel.status = err?.message || "Mic failed";
        refreshAiPromptPanel();
      }
      return;
    }
    if (id === "run") {
      const state = readAiState();
      if (state.generating) {
        try { onStopGeneration?.(); } catch (err) { console.warn("[viewport-xr] stop", err); }
        if (aiPanel) aiPanel.status = "Stopping…";
        refreshAiPromptPanel();
        return;
      }
      try { onPromptSubmit?.(); } catch (err) { console.warn("[viewport-xr] run", err); }
      return;
    }
    if (id === "key") {
      aiModelPickerOpen = false;
      try { setAiPromptSetting?.(id, "next"); } catch (_) {}
      refreshAiPromptPanel();
      return;
    }
    if (id === "model") {
      aiModelPickerOpen = !aiModelPickerOpen;
      if (!aiModelPickerOpen) aiModelPickerScroll = 0;
      refreshAiPromptPanel();
      return;
    }
    if (id === "model_chrome") return;
    if (id === "model_up") {
      aiModelPickerScroll = Math.max(0, (Number(aiModelPickerScroll) || 0) - 1);
      refreshAiPromptPanel();
      return;
    }
    if (id === "model_down") {
      aiModelPickerScroll = (Number(aiModelPickerScroll) || 0) + 1;
      refreshAiPromptPanel();
      return;
    }
    if (String(id).startsWith("model:")) {
      const value = String(id).slice(6);
      aiModelPickerOpen = false;
      aiModelPickerScroll = 0;
      try {
        const res = setAiPromptSetting?.("model", value);
        Promise.resolve(res).finally(() => refreshAiPromptPanel());
      } catch (_) {
        refreshAiPromptPanel();
      }
      return;
    }
    if (id.startsWith("hist:")) {
      const idx = Number(id.slice(5));
      try { setAiPromptSetting?.("history", idx); } catch (_) {}
      refreshAiPromptPanel();
      return;
    }
    if (id.startsWith("mode:")) {
      try { setAiPromptSetting?.("mode", id.slice(5)); } catch (_) {}
      refreshAiPromptPanel();
      return;
    }
    if (id.startsWith("speed:")) {
      try { setAiPromptSetting?.("speed", id.slice(6)); } catch (_) {}
      refreshAiPromptPanel();
      return;
    }
    if (id.startsWith("target:")) {
      const mode = id.slice(7) === "edit" ? "edit" : "new";
      try { setAiPromptSetting?.("targetMode", mode); } catch (_) {}
      if (mode === "edit") {
        openEditModelPicker();
      } else {
        editModelPickActive = false;
        if (aiPanel) aiPanel.status = "";
        refreshAiPromptPanel();
      }
      return;
    }
  }

  function openEditModelPicker() {
    let items = [];
    try { items = (typeof getExplorerItems === "function" && getExplorerItems()) || []; } catch { items = []; }
    if (!items.length) {
      if (aiPanel) aiPanel.status = "No models to edit — generate one first";
      menuFooterHint = "No models in this project to edit";
      refreshAiPromptPanel();
      openMenuConsole({ tab: "parts", keepPose: true, footerHint: "No models yet — generate one first" });
      return;
    }
    if (aiPanel) aiPanel.status = "Pick which model to edit";
    menuFooterHint = "Select the model you want to edit";
    editModelPickActive = true;
    openMenuConsole({ tab: "parts", forcePlace: false, footerHint: "Select a model to edit" });
    refreshAiPromptPanel();
  }

  function currentMenuTabs() {
    if (menuTab === "social" && socialPane === "profile") return publicProfileTabLabels();
    return MENU_TABS;
  }

  function currentMenuActiveTab() {
    if (menuTab === "social" && socialPane === "profile") {
      return publicProfileTabIds().includes(socialProfileTab) ? socialProfileTab : "profile";
    }
    return menuTab;
  }

  function syncMenuTabHits(panel) {
    if (!panel) return;
    for (const h of panel.tabHits || []) {
      panel.group.remove(h);
      h.geometry?.dispose?.();
      h.material?.dispose?.();
    }
    const tabHits = menuTabLayout(currentMenuTabs()).map((tab) => {
      const size = menuCanvasSizeToLocal(tab.w, tab.h);
      const hit = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.max(size.w, 0.02), Math.max(size.h, 0.02)),
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0.001,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      hit.position.copy(menuCanvasToLocal(tab.x + tab.w / 2, tab.y + tab.h / 2, 0.008));
      hit.renderOrder = 2042;
      hit.frustumCulled = false;
      hit.userData.xrMenuTab = tab.id;
      panel.group.add(hit);
      return hit;
    });
    panel.tabHits = tabHits;
  }

  function ensureMenuConsole() {
    if (explorerPanel) return explorerPanel;
    const canvas = drawConsoleCanvas({
      title: "Render Studio",
      tabs: MENU_TABS,
      activeTab: "projects",
      lines: [],
      footer: "Squeeze both grips to resize · grab title to move",
    });
    const tex = sharpenCanvasTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(MENU_PLANE.w, MENU_PLANE.h),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
      }),
    );
    plane.renderOrder = 2040;
    plane.frustumCulled = false;
    plane.userData.xrExplorerPanel = true;
    const titleSize = menuCanvasSizeToLocal(MENU_CANVAS.w, MENU_CANVAS.headerEnd);
    const titleBar = new THREE.Mesh(
      new THREE.PlaneGeometry(titleSize.w, titleSize.h),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.001,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    titleBar.position.copy(menuCanvasToLocal(MENU_CANVAS.w / 2, MENU_CANVAS.headerEnd / 2, 0.007));
    titleBar.renderOrder = 2041;
    titleBar.frustumCulled = false;
    titleBar.userData.xrExplorerDrag = true;
    const closeSize = menuCanvasSizeToLocal(80, MENU_CANVAS.headerEnd);
    const closeHit = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(closeSize.w, 0.03), Math.max(closeSize.h, 0.03)),
      new THREE.MeshBasicMaterial({
        color: 0xf87171,
        transparent: true,
        opacity: 0.001,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    closeHit.position.copy(menuCanvasToLocal(MENU_CANVAS.w - 40, MENU_CANVAS.headerEnd / 2, 0.009));
    closeHit.renderOrder = 2044;
    closeHit.frustumCulled = false;
    closeHit.userData.xrMenuClose = true;
    // Tab hit strips aligned to canvas tab row
    const tabHits = menuTabLayout().map((tab) => {
      const size = menuCanvasSizeToLocal(tab.w, tab.h);
      const hit = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.max(size.w, 0.02), Math.max(size.h, 0.02)),
        new THREE.MeshBasicMaterial({
          transparent: true,
          opacity: 0.001,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      hit.position.copy(menuCanvasToLocal(tab.x + tab.w / 2, tab.y + tab.h / 2, 0.008));
      hit.renderOrder = 2042;
      hit.frustumCulled = false;
      hit.userData.xrMenuTab = tab.id;
      return hit;
    });
    explorerPanel = {
      group: new THREE.Group(),
      plane,
      titleBar,
      closeHit,
      tabHits,
      tabHitsKey: MENU_TABS.map((t) => t.id).join(","),
      rowHits: [],
      rowHitsKey: "",
      canvas,
      lastSig: "",
      tex,
      lines: [],
      kind: "menu",
    };
    explorerPanel.group.add(plane);
    explorerPanel.group.add(titleBar);
    explorerPanel.group.add(closeHit);
    tabHits.forEach((h) => explorerPanel.group.add(h));
    markWorldUi(explorerPanel.group);
    xrHud.add(explorerPanel.group);
    return explorerPanel;
  }

  function readSocialState() {
    try { return (typeof getSocialState === "function" && getSocialState()) || {}; } catch { return {}; }
  }

  function socialPersonById(id, state) {
    const uid = String(id || "");
    if (!uid) return null;
    const st = state || readSocialState();
    if (st.me?.id && String(st.me.id) === uid) {
      return { ...st.me, isSelf: true };
    }
    const users = Array.isArray(st.users) ? st.users : [];
    const found = users.find((u) => String(u.id) === uid);
    return found ? { ...found, isSelf: false } : null;
  }

  function volumeLabel(uid) {
    const muted = !!xrVoice.isPeerMuted?.(uid);
    const pct = Math.round((xrVoice.getPeerVolume?.(uid) ?? 1) * 100);
    return muted ? "Muted" : `${pct}%`;
  }

  function menuSocialLines() {
    const state = readSocialState();
    const users = Array.isArray(state.users) ? state.users : [];
    const publicCount = Number(state.publicCount || 0);
    const publicJoined = !!state.publicJoined;
    const here = Math.max(publicCount, users.length + (state.me ? 1 : 0));
    const me = state.me || null;
    const meId = me?.id ? String(me.id) : "";

    if (!publicJoined && (socialPane === "room" || socialPane === "person")) {
      socialPane = "hub";
      socialFocusId = "";
    }

    if (socialPane === "profile") {
      const p = socialProfile || {};
      const uid = String(p.id || socialFocusId || "");
      const person = socialPersonById(uid, state);
      const tab = publicProfileTabIds().includes(socialProfileTab) ? socialProfileTab : "profile";
      const { lines } = publicProfileLinesForTab(tab, p, {
        userId: uid,
        isSelf: !!(person?.isSelf || (meId && uid === meId)),
        isFriend: !!(person?.is_friend || p.is_friend),
        muted: uid ? !!xrVoice.isPeerMuted?.(uid) : false,
        avatarUrl: absAvatarUrl(p.avatar_url || person?.avatar_url),
      });
      return lines;
    }

    if (publicJoined && socialPane === "person") {
      const person = socialPersonById(socialFocusId, state);
      const uid = String(person?.id || socialFocusId || "");
      const self = !!(person?.isSelf || (meId && uid === meId));
      const handle = person?.handle ? `@${String(person.handle).replace(/^@/, "")}` : "";
      const lines = [
        { id: "room_back", label: "← Back", active: false, kind: "social", icon: "undo" },
        {
          id: "",
          label: self ? `You · ${person?.display_name || me?.display_name || "You"}` : (person?.display_name || "Person"),
          sub: [handle, socialDeviceFor({ ...person, isSelf: self })].filter(Boolean).join(" · "),
          active: !!(person?.inXr || person?.xrPose),
          kind: "hint",
          icon: "move",
          avatarUrl: absAvatarUrl(person?.avatar_url || (self ? me?.avatar_url : "")),
        },
      ];
      if (!self && uid) {
        lines.push(
          {
            id: `room_vol_down:${uid}`,
            label: "Volume down",
            sub: volumeLabel(uid),
            active: false,
            kind: "social",
            icon: "undo",
          },
          {
            id: `room_vol_up:${uid}`,
            label: "Volume up",
            sub: volumeLabel(uid),
            active: false,
            kind: "social",
            icon: "ai",
          },
          {
            id: `room_mute:${uid}`,
            label: xrVoice.isPeerMuted?.(uid) ? "Unmute them" : "Mute them",
            active: !!xrVoice.isPeerMuted?.(uid),
            kind: "social",
            icon: "mic",
          },
          {
            id: `room_add:${uid}`,
            label: person?.is_friend ? "Friends" : "Add friend",
            active: !!person?.is_friend,
            kind: "social",
            icon: "front",
          },
          {
            id: `room_view:${uid}`,
            label: "View public profile",
            active: false,
            kind: "social",
            icon: "move",
          },
          {
            id: `room_file:${uid}`,
            label: "Send file",
            sub: "Share the open model",
            active: false,
            kind: "social",
            icon: "export",
          },
          {
            id: `room_msg:${uid}`,
            label: "Message",
            sub: "Invite them into this project",
            active: false,
            kind: "social",
            icon: "ai",
          },
        );
      } else {
        lines.push(
          {
            id: "voice_toggle",
            label: headsetMicLabel(false),
            active: isHeadsetMicLive(),
            kind: "social",
            icon: "mic",
          },
          {
            id: meId ? `room_view:${meId}` : "",
            label: "View my public profile",
            active: false,
            kind: "social",
            icon: "move",
          },
        );
      }
      return lines;
    }

    if (publicJoined && socialPane === "room") {
      const lines = [
        { id: "room_back", label: "← Back", active: false, kind: "social", icon: "undo" },
        {
          id: meId ? `room_user:${meId}` : "room_me",
          label: `You · ${me?.display_name || "You"}`,
          sub: [me?.handle ? `@${String(me.handle).replace(/^@/, "")}` : "", socialDeviceFor({ ...me, isSelf: true, inXr: presenting }), here ? `${here} in room` : "Public room"].filter(Boolean).join(" · "),
          active: true,
          kind: "social",
          icon: "move",
          avatarUrl: absAvatarUrl(me?.avatar_url),
        },
      ];
      users.forEach((u) => {
        if (meId && String(u.id) === meId) return;
        const handle = u.handle ? `@${String(u.handle).replace(/^@/, "")}` : "";
        lines.push({
          id: `room_user:${u.id}`,
          label: u.display_name || "Person",
          sub: `${handle}${u.is_friend ? " · friend" : ""}${socialDeviceFor(u) ? ` · ${socialDeviceFor(u)}` : (u.inXr || u.xrPose ? " · in VR" : "")}`.trim(),
          active: !!(u.inXr || u.xrPose || u.pickCount),
          kind: "social",
          icon: "move",
          avatarUrl: absAvatarUrl(u.avatar_url),
        });
      });
      if (!users.length) {
        lines.push({
          id: "",
          label: "Waiting for others…",
          active: false,
          kind: "hint",
          icon: "front",
        });
      }
      return lines;
    }

    const lines = [
      {
        id: publicJoined ? "public_leave" : "public_join",
        label: publicJoined
          ? (here ? `Leave public room · ${here} here` : "Leave public room")
          : state.publicJoining ? "Connecting to public room…" : "Join public room",
        active: publicJoined,
        kind: "social",
        icon: "front",
      },
    ];
    if (publicJoined) {
      lines.push({
        id: "room_open",
        label: "People in this room",
        active: false,
        kind: "social",
        icon: "move",
      });
    }
    lines.push(
      {
        id: "import_project",
        label: publicJoined ? "Import a project for both" : "Import a project",
        active: false,
        kind: "social",
        icon: "export",
      },
    );
    if (publicJoined) {
      lines.push({
        id: "drop_current",
        label: "Drop this project into the room",
        active: false,
        kind: "social",
        icon: "move",
      });
    }
    lines.push(
      {
        id: "voice_toggle",
        label: isHeadsetMicLive() ? "Mute headset talk" : "Unmute headset talk",
        active: isHeadsetMicLive(),
        kind: "social",
        icon: "mic",
      },
      {
        id: "avatar",
        label: "Avatar settings",
        sub: localAvatarSpec?.source === "horizon" ? "Horizon (Quest)" : "Skins and outfits",
        active: !!avatarPanel?.group?.visible,
        kind: "social",
        icon: "social",
      },
    );
    users.forEach((u) => {
      if (meId && String(u.id) === meId) return;
      const handle = u.handle ? ` @${String(u.handle).replace(/^@/, "")}` : "";
      const friend = u.is_friend ? " · friend" : " · tap to friend";
      lines.push({
        id: `user:${u.id}`,
        label: `${u.display_name || "Person"}${handle}${friend}${socialDeviceFor(u) ? ` · ${socialDeviceFor(u)}` : ""}`,
        active: !!(u.inXr || u.xrPose || u.pickCount),
        kind: "social",
        icon: "move",
        avatarUrl: absAvatarUrl(u.avatar_url),
      });
    });
    if (!users.length) {
      lines.push({
        id: "invite_copy",
        label: "Copy project invite",
        active: false,
        kind: "social",
        icon: "export",
      });
    }
    return lines;
  }

  function menuVisibleRowCount() {
    const top = MENU_CANVAS.listTop - 30;
    const bot = MENU_CANVAS.footerTop - 20;
    return Math.max(1, Math.floor((bot - top) / MENU_CANVAS.rowH));
  }

  function menuAllLinesForTab(tab) {
    if (tab === "projects") {
      try {
        const sandboxRows = sandboxMenuProjects();
        if (sandboxRows) {
          void refreshSandboxProjectCache();
          return sandboxRows;
        }
      } catch { /* sandbox menu optional */ }
      let items = [];
      try { items = (typeof getProjects === "function" && getProjects()) || []; } catch { items = []; }
      if (!items.length) return [{ id: "", label: "No projects yet", active: false, kind: "hint", icon: "front" }];
      return items.map((it) => ({
        id: it.id,
        label: it.label || it.name || it.id,
        active: !!it.active,
        kind: "project",
        icon: "front",
      }));
    }
    if (tab === "parts") {
      let items = [];
      try { items = (typeof getExplorerItems === "function" && getExplorerItems()) || []; } catch { items = []; }
      if (!items.length) return [{ id: "", label: "No models in this project", active: false, kind: "hint", icon: "move" }];
      return items.map((it) => ({
        id: it.id || it.name || "",
        label: it.label || it.name || it.id,
        sub: it.authorName ? `Made by ${it.authorName}` : "",
        active: !!it.active,
        kind: "part",
        icon: it.kind === "vr-body" || it.kind === "vr-component" ? "tree" : "move",
      }));
    }
    if (tab === "files") {
      let items = [];
      try { items = (typeof getProjectFiles === "function" && getProjectFiles()) || []; } catch { items = []; }
      if (!items.length) return [{ id: "", label: "No files — upload on desktop/mobile", active: false, kind: "hint", icon: "export" }];
      return items.map((it) => ({
        id: it.id || it.name || "",
        label: it.label || it.name || it.id,
        active: !!it.active,
        kind: "file",
        icon: "export",
      }));
    }
    if (tab === "social") {
      return menuSocialLines();
    }
    if (tab === "ai") {
      const listening = !!(typeof isTranscribing === "function" && isTranscribing());
      const state = readAiState();
      const hist = Array.isArray(state.history) ? state.history : [];
      const lines = [
        { id: "ai_panel", label: state.generating ? "AI window · generating" : "Open AI prompt window", active: !!aiPanel?.group?.visible, kind: "action", icon: "ai" },
        { id: "voice_draw", label: state.drawing
          ? (state.drawStrokes ? `Keep sketch · ${state.drawStrokes} stroke${state.drawStrokes === 1 ? "" : "s"}` : "Draw · live (stop)")
          : (state.drawClips ? `Draw another · ${state.drawClips} kept` : "Draw · keep sketches on the prompt"), active: !!state.drawing, kind: "action", icon: "draw" },
        { id: "transcribe", label: listening ? "Stop voice note" : "Record voice note", active: listening, kind: "action", icon: "mic" },
        { id: "talk", label: state.talking ? "Talking with AI…" : "Talk with AI (don't generate yet)", active: !!state.talking, kind: "action", icon: "ai" },
        { id: "prompt", label: state.generating ? "Stop generation" : "Run AI — generate now", active: !!state.generating, kind: "action", icon: "ai" },
        { id: "xr_key", label: `Key: ${String(state.keyLabel || "none").slice(0, 28)}`, active: false, kind: "action", icon: "ai" },
        { id: "xr_model", label: `Model: ${String(state.modelLabel || state.modelValue || "default").slice(0, 26)}`, active: false, kind: "action", icon: "ai" },
      ];
      hist.forEach((h, i) => {
        lines.push({
          id: `hist:${i}`,
          label: `History: ${String(h.prompt || "prompt").slice(0, 28)}`,
          active: false,
          kind: "action",
          icon: "undo",
        });
      });
      return lines;
    }
    if (tab === "tools") {
      const mold = (typeof getVoiceMoldState === "function" && getVoiceMoldState()) || {};
      return TOOL_ACTIONS.filter((a) => a.section === "tools").map((a) => {
        if (a.id === "voice_draw") {
          const n = voiceDraw.strokeCount();
          return {
            id: a.id,
            label: activeTool === "draw"
              ? (n ? `Keep sketch · ${n} stroke${n === 1 ? "" : "s"}` : "Draw · live (stop)")
              : "Draw · keep sketches, then Talk / Run",
            active: activeTool === "draw",
            kind: "action",
            icon: "draw",
          };
        }
        if (a.id === "voice_mold") {
          return {
            id: a.id,
            label: mold.live ? "Voice mold · live (stop)" : "Voice mold · talk + point",
            active: !!mold.live,
            kind: "action",
            icon: "mic",
          };
        }
        if (a.id === "voice_mold_model") {
          return {
            id: a.id,
            label: `Voice model: ${String(mold.modelLabel || "Realtime Mini").slice(0, 22)}`,
            active: false,
            kind: "action",
            icon: "ai",
          };
        }
        return { id: a.id, label: a.label, active: false, kind: "action", icon: a.icon || "move" };
      });
    }
    return TOOL_ACTIONS.filter((a) => a.section === "view").map((a) => ({
      id: a.id, label: a.label, active: false, kind: "action", icon: a.icon || "fit",
    }));
  }

  function menuLinesForTab(tab) {
    const all = menuAllLinesForTab(tab);
    menuLineTotal = all.length;
    const vis = menuVisibleRowCount();
    const max = Math.max(0, all.length - vis);
    menuScroll = THREE.MathUtils.clamp(menuScroll | 0, 0, max);
    return all.slice(menuScroll, menuScroll + vis);
  }

  function defaultMenuFooter() {
    if (menuFooterHint) return menuFooterHint;
    const canScroll = menuLineTotal > menuVisibleRowCount();
    const stick = canScroll ? " · thumbstick scrolls" : "";
    if (menuTab === "projects") return `Load any project · grab metal header to move${stick}`;
    if (menuTab === "parts") return `Switch models · grab header to move${stick}`;
    if (menuTab === "files") return `Open / link project files${stick}`;
    if (menuTab === "ai") return `Open AI window · mic · model type${stick}`;
    if (menuTab === "social") return socialPane === "room"
      ? "Tap someone · volume, mute, add, profile"
      : socialPane === "person"
        ? "Volume / mute / add / view profile"
        : socialPane === "profile"
          ? (socialProfileTab === "calendar"
            ? "Tap a slot or Request a meeting"
            : socialProfileTab === "settings"
              ? "Mute, friend, file, message"
              : socialProfileTab === "store"
                ? "Items they published on Render3D stores"
                : socialProfileTab === "activity"
                  ? "Recent public activity"
                  : "Handle · public profile")
          : "Voice is on when you enter VR · mute here if you want";
    if (menuTab === "view") return "Capture puck · crescent Shot / Rec / Stream";
    if (menuTab === "tools") return activeTool === "draw"
      ? "Draw · hold trigger to sketch · talk · point at the model · Run on AI"
      : "Tools · Draw sketches in 3D for AI · Voice mold keeps a socket open";
    return `Tools · grip moves/rotates (GS) · both grips resize${stick}`;
  }

  function syncMenuRowHits(panel, lines) {
    if (!panel) return;
    if (!panel.rowHits) panel.rowHits = [];
    // Remove old row hits
    for (const h of panel.rowHits) {
      panel.group.remove(h);
      h.geometry?.dispose?.();
      h.material?.dispose?.();
    }
    panel.rowHits = [];
    const maxRows = Math.min(9, lines?.length || 0);
    // Drawn rows are centered at listTop + i*rowH (see drawConsoleCanvas)
    const rowBoxH = Math.max(40, Math.round(MENU_CANVAS.rowH * 0.82));
    const rowBoxW = MENU_CANVAS.w - 72;
    for (let i = 0; i < maxRows; i += 1) {
      const yCanvas = MENU_CANVAS.listTop + i * MENU_CANVAS.rowH;
      const size = menuCanvasSizeToLocal(rowBoxW, rowBoxH);
      const h = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.max(size.w, 0.04), Math.max(size.h, 0.02)),
        new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          transparent: true,
          opacity: 0.001,
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      h.position.copy(menuCanvasToLocal(MENU_CANVAS.w / 2, yCanvas, 0.006));
      h.renderOrder = 2043;
      h.frustumCulled = false;
      h.userData.xrMenuRow = i;
      panel.group.add(h);
      panel.rowHits.push(h);
    }
  }

  function xrBusyState() {
    return {
      grabbing: !!(gripGrab || scaleGrab || grabState || oneHandScale),
      drawing: !!voiceDraw.isDrawing?.() || activeTool === "draw",
      creating: String(activeTool || "").startsWith("create_"),
      grouping: activeTool === "group_select" || !!groupPaint || !!groupNamePanel?.group?.visible,
      solidDraw: !!xrSolidDraw.isActive?.(),
      combining: xrCsgPending,
      tool: activeTool,
    };
  }

  function isInteractionBusy() {
    const s = xrBusyState();
    return !!(s.grabbing || s.drawing || s.creating || s.solidDraw || s.combining || s.grouping);
  }

  let lastTraverseFrame = 0;
  let xrChromeDirty = true;
  let xrFrame = 0;

  function syncXrBusyLights() {
    const on = xrFillLightsEnabled({
      ...xrBusyState(),
      enterSettled: xrEnterWorkSettled(),
    });
    xrAmbient.visible = true;
    key.visible = on;
    fill.visible = on;
    hemi.visible = on;
  }

  function openMenuConsole(opts = {}) {
    if (!opts.force && !shouldRebuildExplorerWhileBusy({
      ...xrBusyState(),
      enterSettled: xrEnterWorkSettled(),
      presenting,
      menuVisible: !!explorerPanel?.group?.visible || !!opts.tab || opts.forcePlace === true,
    })) return;
    if (opts.tab && opts.tab !== menuTab) {
      menuScroll = 0;
      menuStickCarry = 0;
    }
    if (opts.tab) menuTab = opts.tab;
    if (typeof opts.footerHint === "string") menuFooterHint = opts.footerHint;
    const panel = ensureMenuConsole();
    const lines = menuLinesForTab(menuTab);
    const tabs = currentMenuTabs();
    const title = menuTab === "social" && socialPane === "room"
      ? "PUBLIC ROOM"
      : menuTab === "social" && socialPane === "person"
        ? "IN ROOM"
        : menuTab === "social" && socialPane === "profile"
          ? "PROFILE"
          : "RENDER STUDIO";
    const footer = defaultMenuFooter();
    const tabsKey = tabs.map((t) => t.id).join(",");
    const nextSig = xrConsoleSignature({
      title,
      tab: currentMenuActiveTab(),
      tabsKey,
      lines,
      footer,
      overflow: !!hudOverflowOpen.menu,
      locked: isXrHudLocked("menu", hudStorage()),
    });
    panel.lines = lines;
    if (shouldRedrawXrConsole({ lastSig: panel.lastSig, nextSig, force: opts.forceRedraw === true || !!hudOverflowOpen.menu })) {
      const canvas = drawConsoleCanvas({
        title,
        tabs,
        activeTab: currentMenuActiveTab(),
        lines,
        footer,
        canvas: panel.canvas,
        overflowOpen: !!hudOverflowOpen.menu,
        locked: isXrHudLocked("menu", hudStorage()),
      });
      panel.canvas = canvas;
      if (panel.tex.image !== canvas) panel.tex.image = canvas;
      panel.tex.needsUpdate = true;
      panel.lastSig = nextSig;
    }
    panel.group.visible = true;
    const rowCount = Math.min(9, lines?.length || 0);
    if (shouldRebuildMenuHits({
      lastKey: panel.tabHitsKey,
      nextKey: tabsKey,
      lastCount: panel.tabHits?.length || 0,
      nextCount: tabs.length,
    })) {
      syncMenuTabHits(panel);
      panel.tabHitsKey = tabsKey;
    }
    if (shouldRebuildMenuHits({
      lastKey: panel.rowHitsKey,
      nextKey: String(rowCount),
      lastCount: panel.rowHits?.length || 0,
      nextCount: rowCount,
    })) {
      syncMenuRowHits(panel, lines);
      panel.rowHitsKey = String(rowCount);
    }
    const forcePlace = opts.forcePlace === true;
    ensureHudWorldParent(panel.group);
    // Clicks / tab switches must not re-park the window to the current head pose.
    if (!forcePlace && panel.worldPlaced && panelWorldPosIsUsable(panel.group)) return;
    if (!forcePlace && opts.keepPose && panelWorldPosIsUsable(panel.group)) {
      panel.worldPlaced = true;
      return;
    }
    if (!forcePlace && applySavedPanelPose("menu", panel.group)) {
      panel.worldPlaced = true;
      return;
    }
    placeMenuAtDefault(panel.group);
    panel.worldPlaced = true;
    savePanelPose("menu", panel.group);
  }

  function closeMenuConsole() {
    if (explorerPanel) {
      explorerPanel.group.visible = false;
      try { savePanelPose("menu", explorerPanel.group); } catch (_) {}
    }
  }

  _onMenuAvatarLoad = () => {
    if (presenting && explorerPanel?.group?.visible && menuTab === "social") {
      openMenuConsole({ tab: "social", keepPose: true });
    }
  };

  function openExplorerPanel() {
    openMenuConsole({ tab: "projects", force: true });
  }

  function clearMeasure() {
    measurePoints.length = 0;
    measureEdges.length = 0;
    measureHoverEdge = null;
    while (measureGroup.children.length) {
      const c = measureGroup.children[measureGroup.children.length - 1];
      measureGroup.remove(c);
      c.geometry?.dispose?.();
      if (c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        for (const mat of mats) {
          mat.map?.dispose?.();
          mat.dispose?.();
        }
      }
    }
    measureLine = null;
    measureLabel = null;
  }

  function pickMenuFromLocalPoint(local) {
    // Plane local: x in [-w/2, w/2], y in [-h/2, h/2]; top of panel = +y
    const halfW = MENU_PLANE.w / 2;
    const halfH = MENU_PLANE.h / 2;
    const u = (local.x + halfW) / MENU_PLANE.w;
    const fromTop = (halfH - local.y) / MENU_PLANE.h;
    if (u < 0 || u > 1 || fromTop < 0 || fromTop > 1) return null;

    const pxX = u * MENU_CANVAS.w;
    const pxY = fromTop * MENU_CANVAS.h;
    if (pxY < MENU_CANVAS.headerEnd || hudOverflowOpen.menu) {
      const header = pickHudHeader(pxX, pxY, MENU_CANVAS.w, MENU_CANVAS.headerEnd, {
        overflowOpen: !!hudOverflowOpen.menu,
        locked: isXrHudLocked("menu", hudStorage()),
      });
      if (header) {
        if (header.id === "hide") return { kind: "menu-close" };
        if (header.id === "rotate") return { kind: "menu-rotate" };
        if (header.id === "overflow" || header.id === "lock" || header.id === "unlock" || header.id === "move-this" || header.id === "move-set") {
          return { kind: "menu-action", id: header.id };
        }
        return { kind: "explorer-drag" };
      }
      if (pxY < MENU_CANVAS.headerEnd) {
        if (pxX > MENU_CANVAS.w - 88) return { kind: "menu-close" };
        return { kind: "explorer-drag" };
      }
    }
    if (pxY >= MENU_CANVAS.tabStart && pxY < MENU_CANVAS.tabEnd) {
      for (const tab of menuTabLayout(currentMenuTabs())) {
        if (pxX >= tab.x && pxX <= tab.x + tab.w) {
          return { kind: "menu-tab", tab: tab.id };
        }
      }
      return null;
    }
    // Rows are drawn centered on listTop + i*rowH (64px tall buttons)
    if (pxY >= MENU_CANVAS.listTop - 32 && pxY < MENU_CANVAS.footerTop) {
      const idx = Math.round((pxY - MENU_CANVAS.listTop) / MENU_CANVAS.rowH);
      if (idx < 0 || idx >= (explorerPanel?.lines?.length || 0)) return null;
      const center = MENU_CANVAS.listTop + idx * MENU_CANVAS.rowH;
      if (Math.abs(pxY - center) > 36) return null;
      return { kind: "menu-row", line: explorerPanel.lines[idx] };
    }
    return null;
  }

  function mapDockIntersection(hits, extraButtons = []) {
    if (!hits?.length) return null;
    const sorted = hits
      .filter((h) => {
        if (!h?.object) return false;
        restoreXrUiPickRaycast(h.object);
        return xrUiHitObjectIsLive(h);
      })
      .sort((a, b) => a.distance - b.distance);
    if (!sorted.length) return null;
    const toolHit = preferCrescentDockHit(sorted) || sorted.find((h) => h.object.userData?.xrTool);
    if (toolHit) {
      return {
        kind: "tool",
        tool: toolHit.object.userData.xrTool,
        distance: toolHit.distance,
        point: toolHit.point?.clone?.(),
        source: "wrist",
      };
    }
    const chrome = sorted.find((h) => h.object.userData?.xrUi || String(h.object.name || "").startsWith("xrWrist") || String(h.object.name || "").startsWith("xrStatus"));
    if (chrome?.point) {
      const buttons = extraButtons.length ? extraButtons : dockButtons;
      const tools = [];
      for (const btn of buttons) {
        if (!btn?.userData?.xrTool || btn.visible === false) continue;
        try {
          btn.getWorldPosition(_uiBtnWorld);
          tools.push({
            id: btn.userData.xrTool,
            x: _uiBtnWorld.x,
            y: _uiBtnWorld.y,
            z: _uiBtnWorld.z,
            visible: true,
          });
        } catch (_) {}
      }
      const id = nearestDockToolId(chrome.point, tools, 0.09);
      if (id) {
        return {
          kind: "tool",
          tool: id,
          distance: chrome.distance,
          point: chrome.point.clone?.() || chrome.point,
          source: "wrist",
        };
      }
    }
    return null;
  }

  function geometricPlaneHit(plane, rc) {
    if (!plane) return null;
    try {
      plane.updateMatrixWorld?.(true);
      _uiPlaneN.set(0, 0, 1).transformDirection(plane.matrixWorld);
      _uiPlanePt.setFromMatrixPosition(plane.matrixWorld);
      _uiPlane.setFromNormalAndCoplanarPoint(_uiPlaneN, _uiPlanePt);
      const pt = _uiPlanePt.clone();
      if (!rc.ray.intersectPlane(_uiPlane, pt)) {
        _uiPlane.negate();
        if (!rc.ray.intersectPlane(_uiPlane, pt)) return null;
      }
      const d = rc.ray.origin.distanceTo(pt);
      if (!(d >= 0) || d > (Number(rc.far) || 8)) return null;
      _uiLocal.copy(pt);
      plane.worldToLocal(_uiLocal);
      const params = plane.geometry?.parameters || {};
      const hw = Math.max(0.01, (Number(params.width) || 1) / 2);
      const hh = Math.max(0.01, (Number(params.height) || 1) / 2);
      if (Math.abs(_uiLocal.x) > hw * 1.08 || Math.abs(_uiLocal.y) > hh * 1.08) return null;
      return {
        object: plane,
        distance: d,
        point: pt.clone(),
        uv: new THREE.Vector2(_uiLocal.x / (hw * 2) + 0.5, _uiLocal.y / (hh * 2) + 0.5),
      };
    } catch {
      return null;
    }
  }

  function localOnHudPlane(plane, point) {
    if (!plane || !point) return null;
    try {
      plane.updateMatrixWorld?.(true);
      const local = plane.worldToLocal(point.clone());
      const params = plane.geometry?.parameters || {};
      const r = Number(params.radius) || 0;
      if (r > 0) return Math.hypot(local.x, local.y) <= r * 1.12 ? local : null;
      const hw = Math.max(0.01, (Number(params.width) || 0) / 2);
      const hh = Math.max(0.01, (Number(params.height) || 0) / 2);
      if (Math.abs(local.x) > hw * 1.08 || Math.abs(local.y) > hh * 1.08) return null;
      return local;
    } catch {
      return null;
    }
  }

  function mapHudPointToAction(point) {
    if (!point) return null;
    try {
      if (explorerPanel?.group?.visible && explorerPanel.plane) {
        const local = localOnHudPlane(explorerPanel.plane, point);
        if (local) {
          const mapped = pickMenuFromLocalPoint(local);
          if (mapped) return mapped;
        }
      }
      if (aiPanel?.group?.visible && aiPanel.plane) {
        const local = localOnHudPlane(aiPanel.plane, point);
        if (local) {
          const params = aiPanel.plane.geometry?.parameters || {};
          const hw = Math.max(0.01, (Number(params.width) || AI_PLANE.w) / 2);
          const hh = Math.max(0.01, (Number(params.height) || AI_PLANE.h) / 2);
          const uvx = local.x / (hw * 2) + 0.5;
          const uvy = local.y / (hh * 2) + 0.5;
          const mapped = pickAiFromCanvasPx(uvx * AI_CANVAS.w, (1 - uvy) * AI_CANVAS.h)
            || pickAiFromLocalPoint(local);
          if (mapped) return mapped;
        }
      }
      if (viewPanel?.group?.visible && viewPanel.plane) {
        const local = localOnHudPlane(viewPanel.plane, point);
        if (local) {
          const hw = Math.max(0.01, (Number(viewPanel.plane.geometry?.parameters?.width) || VIEW_PLANE.w) / 2);
          const hh = Math.max(0.01, (Number(viewPanel.plane.geometry?.parameters?.height) || VIEW_PLANE.h) / 2);
          const uvx = local.x / (hw * 2) + 0.5;
          const uvy = local.y / (hh * 2) + 0.5;
          const mapped = pickViewFromCanvasPx(uvx * VIEW_CANVAS.w, (1 - uvy) * VIEW_CANVAS.h);
          if (mapped) return mapped;
        }
      }
      if (xrStudio?.isOpen?.() && xrStudio.plane) {
        const local = localOnHudPlane(xrStudio.plane, point);
        if (local) {
          const hw = Math.max(0.01, (Number(xrStudio.plane.geometry?.parameters?.width) || 0.5) / 2);
          const hh = Math.max(0.01, (Number(xrStudio.plane.geometry?.parameters?.height) || 0.4) / 2);
          const uv = { x: local.x / (hw * 2) + 0.5, y: local.y / (hh * 2) + 0.5 };
          const mapped = xrStudio.pickFromUv?.(uv);
          if (mapped) return mapped;
        }
      }
      for (const kind of Object.keys(GRID_POPUP_SPECS)) {
        const panel = gridPanelRef(kind);
        if (!panel?.group?.visible || !panel.plane) continue;
        const local = localOnHudPlane(panel.plane, point);
        if (!local) continue;
        const { canvas } = gridLayout(kind);
        const hw = Math.max(0.01, (Number(panel.plane.geometry?.parameters?.width) || 0.42) / 2);
        const hh = Math.max(0.01, (Number(panel.plane.geometry?.parameters?.height) || 0.32) / 2);
        const uvx = local.x / (hw * 2) + 0.5;
        const uvy = local.y / (hh * 2) + 0.5;
        const mapped = canvas ? pickGridFromCanvasPx(kind, uvx * canvas.w, (1 - uvy) * canvas.h) : null;
        if (mapped) return mapped;
      }
    } catch (_) {}
    return null;
  }

  function dockToolWorldList(buttons) {
    const tools = [];
    for (const btn of buttons || []) {
      if (!btn?.userData?.xrTool || btn.visible === false) continue;
      try {
        restoreXrUiPickRaycast(btn);
        btn.updateMatrixWorld?.(true);
        btn.getWorldPosition(_uiBtnWorld);
        tools.push({
          id: btn.userData.xrTool,
          x: _uiBtnWorld.x,
          y: _uiBtnWorld.y,
          z: _uiBtnWorld.z,
          visible: true,
        });
      } catch (_) {}
    }
    return tools;
  }

  function mapWheelAabbHit(origin, dir) {
    if (!toolWheel?.group?.visible) return null;
    let best = null;
    let bestD = Infinity;
    const meshes = [...(toolWheel.buttons || []), ...(toolWheel.colorHits || [])];
    for (const mesh of meshes) {
      if (!mesh?.visible || !mesh.isMesh) continue;
      try {
        restoreXrUiPickRaycast(mesh);
        mesh.updateMatrixWorld?.(true);
        const box = xrMeshWorldAabbFromGeometry(mesh);
        if (!box) continue;
        const hit = rayHitsAabb(origin, dir, box, 1.6);
        if (!hit || !(hit.distance < bestD)) continue;
        const tool = mesh.userData?.xrTool;
        const color = mesh.userData?.xrColor;
        if (!tool && !color && !mesh.userData?.xrWheelDrag) continue;
        bestD = hit.distance;
        best = mesh.userData?.xrWheelDrag
          ? { kind: "wheel-drag", distance: hit.distance, point: new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z) }
          : color
            ? { kind: "color", color, colorNum: mesh.userData?.xrColorNum, distance: hit.distance, point: new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z) }
            : { kind: "tool", tool, distance: hit.distance, point: new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z) };
      } catch (_) {}
    }
    return best;
  }

  function mapWristAabbHit(root, origin, dir, buttons) {
    if (!root?.visible) return null;
    try {
      const plate = root.getObjectByName?.("xrWristBand")
        || root.getObjectByName?.("xrStatusBand")
        || root.getObjectByName?.("xrCapturePlate")
        || root.getObjectByName?.("xrCaptureDock");
      const mesh = plate?.isMesh ? plate : (plate?.isGroup ? plate.children?.find?.((c) => c?.isMesh && c.geometry?.parameters?.width) : null);
      if (!mesh?.isMesh) return null;
      mesh.updateMatrixWorld?.(true);
      const box = xrMeshWorldAabbFromGeometry(mesh);
      if (!box) return null;
      const hit = rayHitsAabb(origin, dir, box, DOCK_HIT_MAX_M);
      if (!hit) return null;
      const id = nearestDockToolId(hit.point, dockToolWorldList(buttons), 0.16);
      if (!id) return null;
      return {
        kind: "tool",
        tool: id,
        distance: hit.distance,
        point: new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z),
        source: "wrist",
      };
    } catch {
      return null;
    }
  }

  function worldMenuGroupsForAim() {
    const grids = Object.keys(GRID_POPUP_SPECS).map((kind) => gridPanelRef(kind)?.group);
    return [
      ...roboticsWorkspace.groups(),
      roboticsPanel?.group,
      explorerPanel?.group,
      aiPanel?.group,
      viewPanel?.group,
      workspacePanel?.group,
      avatarPanel?.group,
      placePanel?.group,
      guidesPanel?.group,
      howtoPanel?.group,
      xrStudio?.group,
      xrSocialCard?.group,
      shareInvitePanel?.group,
      printSettingsPanel?.group,
      sharedVideo?.group,
      sceneWindows.browser?.group,
      sceneWindows.display?.group,
      toolWheel?.group,
      debuggerHud?.group,
      ...grids,
    ].filter((g) => g?.visible);
  }

  function controllerNearWorldMenu(origin) {
    if (!origin) return false;
    for (const g of worldMenuGroupsForAim()) {
      try {
        g.updateMatrixWorld?.(true);
        _menuAimPos.setFromMatrixPosition(g.matrixWorld);
        if (controllerIsNearMenu(origin, _menuAimPos, XR_MENU_AIM_NEAR_M)) return true;
      } catch (_) {}
    }
    return false;
  }

  function mapRoboticsHitMeshes(raycaster) {
    const hits = roboticsPanel?.hits;
    if (!hits?.length || !roboticsPanel?.group?.visible) return null;
    try {
      roboticsPanel.group.updateMatrixWorld(true);
      const ih = raycaster.intersectObjects(hits, false);
      if (!ih.length) return null;
      const obj = ih[0].object;
      const id = obj?.userData?.xrRoboticsHit;
      const kind = obj?.userData?.xrRoboticsKind || (id === "drag" ? "robotics-drag" : "robotics-action");
      if (!id) return { kind: "robotics-chrome", distance: ih[0].distance, point: ih[0].point?.clone?.() };
      return { kind, id, distance: ih[0].distance, point: ih[0].point?.clone?.() };
    } catch {
      return null;
    }
  }

  function pickWithController(controller, { uiOnly = false } = {}) {
    if (!controller) return null;
    const id = controller.id || controller.uuid || "c";
    const cached = pickCache.get(id);
    if (cached && cached.gen === pickFrameGen) {
      noteHandCamAimFromHit(cached.hit, controller);
      if (uiOnly) return isUiPick(cached.hit) ? cached.hit : null;
      return cached.hit;
    }

    controller.updateMatrixWorld?.(true);
    const handAim = controller.userData?.handAim;
    if (handAim?.origin && handAim?.direction) {
      raycaster.ray.origin.copy(handAim.origin);
      raycaster.ray.direction.copy(handAim.direction).normalize();
    } else {
      _mat.identity().extractRotation(controller.matrixWorld);
      raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(_mat);
    }
    prepareXrUiRaycaster(raycaster);
    if (xrSceneKind === "workshop" && workshopKillButton?.visible) {
      workshopKillButton.updateMatrixWorld?.(true);
      const killHit = raycaster.intersectObject(workshopKillButton, false)[0];
      if (killHit) {
        const hit = {kind:"robotics-action",id:"workshop-kill",distance:killHit.distance,point:killHit.point?.clone?.()};
        pickCache.set(id,{gen:pickFrameGen,hit}); return hit;
      }
    }
    const tabHit = tabbedWindows?.pick(raycaster);
    if (tabHit) { pickCache.set(id, {gen:pickFrameGen,hit:tabHit}); return tabHit; }

    const nearMenu = controllerNearWorldMenu(raycaster.ray.origin);
    lastMenuAimNear = lastMenuAimNear || nearMenu;

    const rememberRaw = (hit) => {
      pickCache.set(id, { gen: pickFrameGen, hit });
      return hit;
    };
    let wristCandidate = null;
    const remember = (hit) => {
      if (hit && wristCandidate && hit !== wristCandidate) {
        if (wristYieldsToWorldMenu({ wristHit: wristCandidate, worldHit: hit, nearMenu })) {
          return rememberRaw(hit);
        }
        const wd = Number(wristCandidate.distance);
        const hd = Number(hit.distance);
        if (Number.isFinite(wd) && (!Number.isFinite(hd) || wd <= hd)) {
          return rememberRaw(wristCandidate);
        }
      }
      return rememberRaw(hit);
    };

    // Pick the actual pucks on either wrist. Overlay render layers and a world
    // menu behind the hand must not redirect a button click.
    try {
      wristCandidate = pickWristUi(raycaster, [
        ...dockButtons, ...captureDockButtons, ...(dockPalette.statusHits || []),
      ], DOCK_HIT_MAX_M);
    } catch (_) {}

    try {
      if (toolHand?.group && presenting) {
        toolHand.group.updateMatrixWorld?.(true);
        const mappedHand = pickWristUi(raycaster, toolHand.buttons, DOCK_HIT_MAX_M);
        if (mappedHand) {
          wristCandidate = closerUiHit(wristCandidate, mappedHand);
        }
      }
    } catch (_) {}

    try { wristCandidate = closerUiHit(wristCandidate, agentAvatar.pick(raycaster));
      wristCandidate = closerUiHit(wristCandidate, agentPeers.pick(raycaster));
      wristCandidate = closerUiHit(wristCandidate, agentJoin.pick(raycaster));
      wristCandidate = closerUiHit(wristCandidate, aiRoundTable.pick(raycaster)); } catch (_) {}

    try {
      const pointerHand = squeezeHandIndex(controller) === 0 ? "left"
        : squeezeHandIndex(controller) === 1 ? "right" : "";
      const camHit = pickHandCamUi(raycaster, pointerHand);
      if (camHit) wristCandidate = closerUiHit(wristCandidate, camHit);
    } catch (_) {}

    try {
      if (toolWheel?.group?.visible) {
        toolWheel.group.updateMatrixWorld?.(true);
        for (const mesh of [...(toolWheel.buttons || []), ...(toolWheel.colorHits || [])]) {
          restoreXrUiPickRaycast(mesh);
        }
        const wheelHits = raycaster
          .intersectObject(toolWheel.group, true)
          .filter((h) => {
            if (!(h.distance < 1.6) || !h.object) return false;
            restoreXrUiPickRaycast(h.object);
            return h.object?.userData?.xrRaycast !== false;
          });
        const mappedWheel = mapWheelIntersection(wheelHits);
        if (mappedWheel) return remember(mappedWheel);
        const origin = raycaster.ray.origin;
        const dir = raycaster.ray.direction;
        const aabbWheel = mapWheelAabbHit(origin, dir);
        if (aabbWheel) return remember(aabbWheel);
      }
    } catch (_) {}

    const skipHud = shouldSkipXrHudPanelPick({
      ...xrBusyState(),
      laserAim: laserPointerActive(),
      bHeld: !!bButtonHeld,
    });

    if (!skipHud) {
      const hudHits = [];
      const takePlane = (group, plane, mapFn) => {
        if (!group?.visible || !plane) return;
        try {
          group.updateMatrixWorld(true);
          plane.updateMatrixWorld?.(true);
          if (plane.userData) plane.userData.xrHudPlane = true;
          restoreXrUiPickRaycast(plane);
          let ih = raycaster.intersectObject(plane, false);
          if (!ih.length) {
            const geo = geometricPlaneHit(plane, raycaster);
            if (geo) ih = [geo];
          }
          if (!ih.length) return;
          const mapped = mapFn(ih[0]);
          if (mapped) hudHits.push({ ...mapped, distance: ih[0].distance, point: ih[0].point?.clone?.() });
        } catch (_) {}
      };
      const takeHits = (group, meshes, mapObj) => {
        if (!group?.visible || !meshes?.length) return;
        try {
          group.updateMatrixWorld(true);
          const live = [];
          for (const m of meshes) {
            if (!m) continue;
            restoreXrUiPickRaycast(m);
            live.push(m);
          }
          if (!live.length) return;
          const ih = raycaster.intersectObjects(live, false);
          for (const h of ih) {
            const mapped = mapObj(h);
            if (mapped) hudHits.push({ ...mapped, distance: h.distance, point: h.point?.clone?.() });
          }
        } catch (_) {}
      };
      const robotMesh = mapRoboticsHitMeshes(raycaster);
      if (robotMesh) hudHits.push(robotMesh);
      takePlane(roboticsPanel?.group, roboticsPanel?.plane, (h) => {
        let local = null;
        try {
          if (h.point && roboticsPanel?.plane) {
            local = roboticsPanel.plane.worldToLocal(h.point.clone());
          }
        } catch (_) {}
        const px = roboticsCanvasPxFromHit({ uv: h.uv, local }, ROBOTICS_PLANE, ROBOTICS_CANVAS);
        if (!px) return { kind: "robotics-chrome" };
        return pickRoboticsHud(px.x, px.y, roboticsHudState()) || { kind: "robotics-chrome" };
      });
      takePlane(explorerPanel?.group, explorerPanel?.plane, (h) => {
        const uv = h.uv;
        if (!uv) return { kind: "menu-chrome" };
        const local = new THREE.Vector3(
          (uv.x - 0.5) * MENU_PLANE.w,
          (0.5 - (1 - uv.y)) * MENU_PLANE.h,
          0,
        );
        return pickMenuFromLocalPoint(local) || { kind: "menu-chrome" };
      });
      takePlane(aiPanel?.group, aiPanel?.plane, (h) => {
        const uv = h.uv;
        if (!uv) return null;
        return pickAiFromCanvasPx(uv.x * AI_CANVAS.w, (1 - uv.y) * AI_CANVAS.h);
      });
      takePlane(viewPanel?.group, viewPanel?.plane, (h) => {
        const uv = h.uv;
        if (!uv) return { kind: "view-chrome" };
        return pickViewFromCanvasPx(uv.x * VIEW_CANVAS.w, (1 - uv.y) * VIEW_CANVAS.h) || { kind: "view-chrome" };
      });
      takePlane(workspacePanel?.group, workspacePanel?.plane, (h) => {
        const local = workspacePanel.plane.worldToLocal(h.point.clone());
        return pickWorkspaceFromLocal(local);
      });
      takePlane(sharePanel?.group, sharePanel?.plane, (h) => {
        const local = sharePanel.plane.worldToLocal(h.point.clone());
        return pickShareFromLocal(local);
      });
      takePlane(avatarPanel?.group, avatarPanel?.plane, (h) => {
        const local = avatarPanel.plane.worldToLocal(h.point.clone());
        return pickAvatarFromLocal(local);
      });
      takePlane(placePanel?.group, placePanel?.plane, (h) => {
        const local = placePanel.plane.worldToLocal(h.point.clone());
        const halfH = 0.19;
        const fromTop = (halfH - local.y) / 0.38;
        const u = (local.x + 0.25) / 0.5;
        if (fromTop < 0.16) {
          if (u > 0.82) return { kind: "place-close" };
          return { kind: "place-drag" };
        }
        return { kind: "place-drag" };
      });
      takePlane(guidesPanel?.group, guidesPanel?.plane, (h) => {
        const uv = h.uv;
        return uv ? pickGuidesHit(uv.x * GUIDES_CANVAS.w, (1 - uv.y) * GUIDES_CANVAS.h) : { kind: "guides-chrome" };
      });
      try {
        if (xrStudio?.isOpen?.()) {
          takePlane(xrStudio.group, xrStudio.plane, (h) => xrStudio.pickFromUv(h.uv));
        }
      } catch (_) {}
      takeHits(aiPanel?.group, [
        aiPanel?.titleBar,
        ...(aiPanel?.hits || []),
        ...(aiPanel?.pickerHits || []),
        ...(aiPanel?.keyboard?.hits || []),
        ...(aiPanel?.loading?.hits || []),
      ], (h) => {
        const id = h.object?.userData?.xrAiHit;
        if (aiHitBlockedByModelPicker(id, aiModelPickerOpen)) return null;
        if (id === "drag" || id === "load_drag") return { kind: "ai-drag" };
        if (id) return { kind: "ai-action", id };
        return null;
      });
      takeHits(viewPanel?.group, [viewPanel?.titleBar, ...(viewPanel?.hits || [])], (h) => {
        const id = h.object?.userData?.xrViewHit;
        if (id === "drag") return { kind: "view-drag" };
        if (id) return { kind: "view-action", id };
        return null;
      });
      takeHits(explorerPanel?.group, [
        explorerPanel?.closeHit,
        explorerPanel?.titleBar,
        ...(explorerPanel?.tabHits || []),
        ...(explorerPanel?.rowHits || []),
      ], (h) => {
        const obj = h.object;
        if (obj === explorerPanel.closeHit || obj?.userData?.xrMenuClose) return { kind: "menu-close" };
        if (obj === explorerPanel.titleBar || obj?.userData?.xrExplorerDrag) return { kind: "explorer-drag" };
        if (obj?.userData?.xrMenuTab) return { kind: "menu-tab", tab: obj.userData.xrMenuTab };
        if (obj?.userData?.xrMenuRow != null) {
          const line = explorerPanel.lines?.[obj.userData.xrMenuRow];
          if (line) return { kind: "menu-row", line };
        }
        return null;
      });
      for (const kind of Object.keys(GRID_POPUP_SPECS)) {
        const panel = gridPanelRef(kind);
        takeHits(panel?.group, [panel?.titleBar, ...(panel?.hits || [])], (h) => {
          const id = h.object?.userData?.xrGridHit;
          if (id === "drag") return { kind: "grid-drag", panel: kind };
          if (id === "rotate") return { kind: "grid-rotate", panel: kind };
          if (id) return { kind: "grid-action", panel: kind, id };
          return null;
        });
        takePlane(panel?.group, panel?.plane, (h) => {
          const uv = h.uv;
          const { canvas } = gridLayout(kind);
          if (!uv) return { kind: "grid-chrome", panel: kind };
          return pickGridFromCanvasPx(kind, uv.x * canvas.w, (1 - uv.y) * canvas.h) || { kind: "grid-chrome", panel: kind };
        });
      }
      for (const id of ["browser", "display"]) {
        const win = sceneWindows[id];
        takePlane(win?.group, win?.plane, (h) => {
          const uv = h.uv;
          if (!uv) return { kind: "scene-win-chrome", winId: id };
          const mapped = pickXrSceneWindowHit(uv.x * XR_SCENE_WIN_CANVAS.w, (1 - uv.y) * XR_SCENE_WIN_CANVAS.h, {
            kind: id,
            kbOpen: id === "browser" && !!sceneWinKbOpen,
          });
          return mapped ? { ...mapped, winId: id } : { kind: "scene-win-chrome", winId: id };
        });
      }
      if (debuggerOpen && debuggerHud?.group?.visible) {
        takePlane(debuggerHud.group, debuggerHud.mesh, (h) => {
          const uv = h.uv;
          if (uv) {
            const action = debuggerActionFromCanvasPx(
              uv.x * DEBUGGER_CANVAS.w,
              (1 - uv.y) * DEBUGGER_CANVAS.h,
            );
            if (action) return action;
          }
          return { kind: "debugger-chrome" };
        });
      }
      const bestHud = preferHudActionHit(hudHits) || closestHudHit(hudHits);
      const robotHit = hudHits.find((h) => String(h?.kind || "").startsWith("robotics"));
      if (robotHit && roboticsBeatsStackedHud(robotHit, hudHits.filter((h) => h !== robotHit))) {
        return remember(robotHit);
      }
      if (bestHud) return remember(bestHud);
    }

    if (!skipHud && shareInvitePanel?.group?.visible) {
      shareInvitePanel.group.updateMatrixWorld(true);
      const ih = raycaster.intersectObject(shareInvitePanel.plane, false);
      if (ih.length) {
        const local = shareInvitePanel.plane.worldToLocal(ih[0].point.clone());
        const mapped = pickShareInviteFromLocal(local);
        if (mapped) return remember({ ...mapped, distance: ih[0].distance, point: ih[0].point?.clone?.() });
      }
    }

    if (!skipHud && printSettingsPanel?.group?.visible) {
      printSettingsPanel.group.updateMatrixWorld(true);
      const ph = raycaster.intersectObject(printSettingsPanel.plane, false);
      if (ph.length) {
        const local = printSettingsPanel.plane.worldToLocal(ph[0].point.clone());
        const mapped = pickPrintSettingsFromLocal(local);
        if (mapped) return remember({ ...mapped, distance: ph[0].distance, point: ph[0].point?.clone?.() });
      }
    }

    if (!skipHud && sharedVideo?.group?.visible) {
      const mapped = pickSharedVideo(raycaster);
      if (mapped) {
        try {
          const tag = xrPresence.pickNametag?.(raycaster);
          if (tag && nametagBeatsDock(tag, mapped)) return remember(tag);
        } catch (_) {}
        return remember(mapped);
      }
    }

    if (!skipHud && wsKeyboardOpen && workspacePanel?.group?.visible && workspaceCreatePrompt && !workspaceCreatePrompt.shareAsk) {
      const kb = workspacePanel.keyboard;
      if (kb) {
        workspacePanel.group.updateMatrixWorld(true);
        const kbHits = [];
        if (kb.hits?.length) {
          const hh = raycaster.intersectObjects(kb.hits, false);
          for (const h of hh) {
            const kid = h.object?.userData?.xrWorkspaceHit;
            if (kid) kbHits.push({ kind: "workspace-action", id: kid, distance: h.distance, point: h.point?.clone?.() });
          }
        }
        if (kb.plane) {
          const kh = raycaster.intersectObject(kb.plane, false);
          if (kh.length) {
            const uv = kh[0].uv;
            const layout = keyboardLayout({ width: KB_CANVAS.w, height: KB_CANVAS.h, shift: wsKeyboardShift });
            const mapped = uv ? keyboardHit(uv.x * KB_CANVAS.w, (1 - uv.y) * KB_CANVAS.h, layout) : null;
            if (mapped?.id) {
              kbHits.push({ kind: "workspace-action", id: mapped.id, distance: kh[0].distance, point: kh[0].point?.clone?.() });
            }
          }
        }
        if (kbHits.length) {
          kbHits.sort((a, b) => a.distance - b.distance);
          return remember(kbHits[0]);
        }
      }
    }

    if (!skipHud && workspacePanel?.group?.visible) {
      workspacePanel.group.updateMatrixWorld(true);
      const wph = raycaster.intersectObject(workspacePanel.plane, false);
      if (wph.length) {
        const local = workspacePanel.plane.worldToLocal(wph[0].point.clone());
        const mapped = pickWorkspaceFromLocal(local);
        if (mapped) return remember({ ...mapped, distance: wph[0].distance, point: wph[0].point?.clone?.() });
      }
    }

    if (!skipHud && avatarPanel?.group?.visible) {
      avatarPanel.group.updateMatrixWorld(true);
      const aph = raycaster.intersectObject(avatarPanel.plane, false);
      if (aph.length) {
        const local = avatarPanel.plane.worldToLocal(aph[0].point.clone());
        const mapped = pickAvatarFromLocal(local);
        if (mapped) return remember({ ...mapped, distance: aph[0].distance, point: aph[0].point?.clone?.() });
      }
    }

    if (!skipHud && viewPanel?.group.visible) {
      viewPanel.group.updateMatrixWorld(true);
      const viewHits = [];
      const hitMeshes = [viewPanel.titleBar, ...(viewPanel.hits || [])].filter(Boolean);
      const vh = raycaster.intersectObjects(hitMeshes, false);
      for (const h of vh) {
        const id = h.object.userData.xrViewHit;
        const point = h.point?.clone?.();
        if (id === "drag") viewHits.push({ kind: "view-drag", distance: h.distance, point });
        else if (id) viewHits.push({ kind: "view-action", id, distance: h.distance, point });
      }
      const vph = raycaster.intersectObject(viewPanel.plane, false);
      if (vph.length) {
        const uv = vph[0].uv;
        let mapped = null;
        if (uv) mapped = pickViewFromCanvasPx(uv.x * VIEW_CANVAS.w, (1 - uv.y) * VIEW_CANVAS.h);
        if (mapped) viewHits.push({ ...mapped, distance: vph[0].distance, point: vph[0].point?.clone?.() });
      }
      if (viewHits.length) {
        viewHits.sort((a, b) => a.distance - b.distance);
        const best = viewHits[0];
        const action = viewHits.find((c) => c.kind === "view-action");
        if (action && action.distance <= best.distance + 0.05) return remember(action);
        return remember(best);
      }
    }

    if (!skipHud) for (const kind of Object.keys(GRID_POPUP_SPECS)) {
      const panel = gridPanelRef(kind);
      if (!panel?.group?.visible) continue;
      panel.group.updateMatrixWorld(true);
      const gridHits = [];
      const hitMeshes = [panel.titleBar, ...(panel.hits || [])].filter(Boolean);
      const gh = raycaster.intersectObjects(hitMeshes, false);
      for (const h of gh) {
        const id = h.object.userData.xrGridHit;
        const point = h.point?.clone?.();
        if (id === "drag") gridHits.push({ kind: "grid-drag", panel: kind, distance: h.distance, point });
        else if (id === "rotate") gridHits.push({ kind: "grid-rotate", panel: kind, distance: h.distance, point });
        else if (id) gridHits.push({ kind: "grid-action", panel: kind, id, distance: h.distance, point });
      }
      const gph = raycaster.intersectObject(panel.plane, false);
      if (gph.length) {
        const uv = gph[0].uv;
        const { canvas } = gridLayout(kind);
        let mapped = null;
        if (uv) mapped = pickGridFromCanvasPx(kind, uv.x * canvas.w, (1 - uv.y) * canvas.h);
        if (mapped) gridHits.push({ ...mapped, distance: gph[0].distance, point: gph[0].point?.clone?.() });
      }
      if (gridHits.length) {
        gridHits.sort((a, b) => a.distance - b.distance);
        const best = gridHits[0];
        const action = gridHits.find((c) => c.kind === "grid-action");
        if (action && action.distance <= best.distance + 0.05) return remember(action);
        return remember(best);
      }
    }

    // Dedicated AI prompt panel — closest hit among header / buttons (never drag a button click)
    if (!skipHud && aiPanel?.group.visible) {
      aiPanel.group.updateMatrixWorld(true);
      const aiHits = [];
      const hitMeshes = [
        aiPanel.titleBar,
        ...(aiPanel.hits || []),
        ...(aiPanel.pickerHits || []),
        ...(aiPanel.keyboard?.hits || []),
        ...(aiPanel.loading?.hits || []),
      ].filter(Boolean);
      const hh = raycaster.intersectObjects(hitMeshes, false);
      for (const h of hh) {
        const id = h.object.userData.xrAiHit;
        if (aiHitBlockedByModelPicker(id, aiModelPickerOpen)) continue;
        if (id === "drag" || id === "load_drag") aiHits.push({ kind: "ai-drag", distance: h.distance, point: h.point?.clone?.() });
        else if (id) aiHits.push({ kind: "ai-action", id, distance: h.distance, point: h.point?.clone?.() });
      }
      const ph = raycaster.intersectObject(aiPanel.plane, false);
      if (ph.length) {
        const uv = ph[0].uv;
        let mapped = null;
        if (uv) mapped = pickAiFromCanvasPx(uv.x * AI_CANVAS.w, (1 - uv.y) * AI_CANVAS.h);
        if (!mapped) {
          const local = aiPanel.plane.worldToLocal(ph[0].point.clone());
          mapped = pickAiFromLocalPoint(local);
        }
        if (mapped && mapped.kind && mapped.id !== "noop") {
          aiHits.push({ ...mapped, distance: ph[0].distance, point: ph[0].point?.clone?.() });
        } else {
          aiHits.push({ kind: "menu-chrome", distance: ph[0].distance, point: ph[0].point?.clone?.() });
        }
      }
      if (aiKeyboardOpen && aiPanel.keyboard?.plane) {
        const kh = raycaster.intersectObject(aiPanel.keyboard.plane, false);
        if (kh.length) {
          const uv = kh[0].uv;
          const layout = keyboardLayout({ width: KB_CANVAS.w, height: KB_CANVAS.h, shift: aiKeyboardShift });
          const mapped = uv ? keyboardHit(uv.x * KB_CANVAS.w, (1 - uv.y) * KB_CANVAS.h, layout) : null;
          if (mapped) aiHits.push({ ...mapped, distance: kh[0].distance, point: kh[0].point?.clone?.() });
        }
      }
      if (aiLoadingOpen && aiPanel.loading?.plane) {
        const lh = raycaster.intersectObject(aiPanel.loading.plane, false);
        if (lh.length) {
          const uv = lh[0].uv;
          const layout = loadingScreenLayout({
            width: LOAD_CANVAS.w,
            height: LOAD_CANVAS.h,
            scroll: aiLoadingScroll,
            parts: readAiState().mcmasterParts || [],
          });
          const mapped = uv ? loadingScreenHit(uv.x * LOAD_CANVAS.w, (1 - uv.y) * LOAD_CANVAS.h, layout) : null;
          if (mapped?.id === "load_drag") {
            aiHits.push({ kind: "ai-drag", distance: lh[0].distance, point: lh[0].point?.clone?.() });
          } else if (mapped) {
            aiHits.push({ ...mapped, distance: lh[0].distance, point: lh[0].point?.clone?.() });
          }
        }
      }
      if (aiHits.length) {
        aiHits.sort((a, b) => a.distance - b.distance);
        const best = aiHits[0];
        const action = aiHits.find((c) => c.kind === "ai-action");
        if (action && action.distance <= best.distance + 0.05) return remember(action);
        return remember(best);
      }
    }

    if (!skipHud && roboticsPanel?.group?.visible) {
      roboticsPanel.group.updateMatrixWorld(true);
      const meshHit = mapRoboticsHitMeshes(raycaster);
      if (meshHit && isRoboticsHudKind(meshHit.kind) && meshHit.kind !== "robotics-chrome") {
        return remember(meshHit);
      }
      const rph = raycaster.intersectObject(roboticsPanel.plane, false);
      if (rph.length) {
        let local = null;
        try { local = roboticsPanel.plane.worldToLocal(rph[0].point.clone()); } catch (_) {}
        const px = roboticsCanvasPxFromHit({ uv: rph[0].uv, local }, ROBOTICS_PLANE, ROBOTICS_CANVAS);
        const mapped = px ? pickRoboticsHud(px.x, px.y, roboticsHudState()) : { kind: "robotics-chrome" };
        if (mapped) {
          return remember({ ...mapped, distance: rph[0].distance, point: rph[0].point?.clone?.() });
        }
      }
      if (meshHit) return remember(meshHit);
      if (roboticsPanel.titleBar) {
        const rth = raycaster.intersectObject(roboticsPanel.titleBar, false);
        if (rth.length) {
          return remember({ kind: "robotics-drag", distance: rth[0].distance, point: rth[0].point?.clone?.() });
        }
      }
    }

    if (!skipHud && guidesPanel?.group?.visible) {
      guidesPanel.group.updateMatrixWorld(true);
      const gph = raycaster.intersectObject(guidesPanel.plane, false);
      if (gph.length) {
        const uv = gph[0].uv;
        const mapped = uv
          ? pickGuidesHit(uv.x * GUIDES_CANVAS.w, (1 - uv.y) * GUIDES_CANVAS.h)
          : null;
        if (mapped) {
          return remember({ ...mapped, distance: gph[0].distance, point: gph[0].point?.clone?.() });
        }
      }
    }

    if (!skipHud && howtoPanel?.group?.visible) {
      howtoPanel.group.updateMatrixWorld(true);
      const nextH = raycaster.intersectObject(howtoPanel.nextHit, false);
      if (nextH.length) {
        return remember({ kind: "howto-next", distance: nextH[0].distance, point: nextH[0].point?.clone?.() });
      }
      const doneH = raycaster.intersectObject(howtoPanel.doneHit, false);
      if (doneH.length) {
        return remember({ kind: "howto-done", distance: doneH[0].distance, point: doneH[0].point?.clone?.() });
      }
      const planeH = raycaster.intersectObject(howtoPanel.plane, false);
      if (planeH.length) {
        return remember({ kind: "howto-drag", distance: planeH[0].distance, point: planeH[0].point?.clone?.() });
      }
    }

    // XR console — closest of title / tabs / rows so a model click never starts a window drag
    if (!skipHud && explorerPanel?.group.visible) {
      explorerPanel.group.updateMatrixWorld(true);
      const candidates = [];
      if (explorerPanel.closeHit) {
        const ch = raycaster.intersectObject(explorerPanel.closeHit, false);
        if (ch.length) {
          candidates.push({ kind: "menu-close", distance: ch[0].distance, point: ch[0].point?.clone?.() });
        }
      }
      const titleHits = raycaster.intersectObject(explorerPanel.titleBar, false);
      if (titleHits.length) {
        candidates.push({ kind: "explorer-drag", distance: titleHits[0].distance, point: titleHits[0].point?.clone?.() });
      }
      for (const tabHit of explorerPanel.tabHits || []) {
        const th = raycaster.intersectObject(tabHit, false);
        if (th.length) {
          candidates.push({ kind: "menu-tab", tab: tabHit.userData.xrMenuTab, distance: th[0].distance });
        }
      }
      for (const rowHit of explorerPanel.rowHits || []) {
        const rh = raycaster.intersectObject(rowHit, false);
        if (rh.length) {
          const idx = rowHit.userData.xrMenuRow;
          const line = explorerPanel.lines?.[idx];
          if (line) candidates.push({ kind: "menu-row", line, distance: rh[0].distance });
        }
      }
      const ph = raycaster.intersectObject(explorerPanel.plane, false);
      if (ph.length) {
        const uv = ph[0].uv;
        let mapped = null;
        if (uv) {
          const local = new THREE.Vector3(
            (uv.x - 0.5) * MENU_PLANE.w,
            (0.5 - (1 - uv.y)) * MENU_PLANE.h,
            0,
          );
          mapped = pickMenuFromLocalPoint(local);
        }
        if (!mapped) {
          const local = explorerPanel.plane.worldToLocal(ph[0].point.clone());
          mapped = pickMenuFromLocalPoint(local);
        }
        if (mapped && mapped.kind === "menu-tab") {
          candidates.push({ ...mapped, distance: ph[0].distance });
        } else if (mapped && mapped.kind === "menu-row" && mapped.line?.id && mapped.line?.kind !== "hint") {
          candidates.push({ ...mapped, distance: ph[0].distance });
        } else if (mapped && mapped.kind === "explorer-drag") {
          candidates.push({ kind: "explorer-drag", distance: ph[0].distance, point: ph[0].point?.clone?.() });
        } else if (mapped && mapped.kind === "menu-close") {
          candidates.push({ kind: "menu-close", distance: ph[0].distance, point: ph[0].point?.clone?.() });
        } else if (mapped && (mapped.kind === "menu-action" || mapped.kind === "menu-rotate")) {
          candidates.push({ ...mapped, distance: ph[0].distance, point: ph[0].point?.clone?.() });
        } else {
          candidates.push({ kind: "menu-chrome", distance: ph[0].distance, point: ph[0].point?.clone?.() });
        }
      }
      if (candidates.length) {
        candidates.sort((a, b) => a.distance - b.distance);
        const best = candidates[0];
        const action = candidates.find((c) => c.kind === "menu-row" || c.kind === "menu-tab" || c.kind === "menu-close" || c.kind === "menu-action" || c.kind === "menu-rotate");
        if (action && action.distance <= best.distance + 0.05 && !isXrPanelGripHandleKind(best.kind)) return remember(action);
        return remember(best);
      }
    }

    try {
      if (!skipHud && xrStudio?.isOpen?.()) {
        xrStudio.group.updateMatrixWorld?.(true);
        const sh = raycaster.intersectObject(xrStudio.plane, false);
        if (sh.length) {
          const mapped = xrStudio.pickFromUv(sh[0].uv);
          if (mapped) return remember({ ...mapped, distance: sh[0].distance, point: sh[0].point?.clone?.() });
        }
      }
    } catch (_) {}

    try {
      if (!skipHud && xrSocialCard?.isOpen?.()) {
        xrSocialCard.group.updateMatrixWorld?.(true);
        const ch = raycaster.intersectObject(xrSocialCard.plane, false);
        if (ch.length) {
          const action = xrSocialCard.pickAction(ch[0].uv);
          if (action) return remember({ kind: "social-card", action: action.id, user: action.user, distance: ch[0].distance, point: ch[0].point?.clone?.() });
        }
      }
    } catch (_) {}

    try {
      const tag = xrPresence.pickNametag?.(raycaster);
      if (tag) return remember(tag);
    } catch (_) {}

    // Place panel
    if (!skipHud && placePanel?.group.visible) {
      const ph = raycaster.intersectObject(placePanel.plane, false);
      if (ph.length) {
        const local = placePanel.plane.worldToLocal(ph[0].point.clone());
        const halfH = 0.19;
        const fromTop = (halfH - local.y) / 0.38;
        const u = (local.x + 0.25) / 0.5;
        const point = ph[0].point?.clone?.();
        if (fromTop < 0.16) {
          if (u > 0.82) return remember({ kind: "place-close", distance: ph[0].distance, point });
          return remember({ kind: "place-drag", distance: ph[0].distance, point });
        }
        if (fromTop >= 0.16 && fromTop <= 0.9 && placePanel.lines?.length) {
          const idx = Math.floor(((fromTop - 0.16) / 0.74) * placePanel.lines.length);
          if (idx >= 0 && idx < placePanel.lines.length) {
            return remember({ kind: "place", line: placePanel.lines[idx], distance: ph[0].distance, point });
          }
        }
        return remember({ kind: "place-drag", distance: ph[0].distance, point });
      }
    }

    // AABB HUD / wheel before gizmos + CAD so a thin plane miss cannot fall
    // through to resize handles. Prefer mapped buttons over menu-chrome no-op.
    try {
      const origin = raycaster.ray.origin;
      const dir = raycaster.ray.direction;
      const wheelAabb = mapWheelAabbHit(origin, dir);
      if (wheelAabb) return remember(wheelAabb);
      const aabbHit = menuHitFromAabb(origin, dir);
      if (aabbHit) {
        const resolved = remapHudChromeHit(aabbHit) || mapHudPointToAction(aabbHit.point) || aabbHit;
        if (resolved && hudHitStealsCad(resolved)) {
          lastRayOnMenu = true;
          return remember(resolved);
        }
        if (wristCandidate && isUiPick(wristCandidate) && !isXrChromeKind(wristCandidate.kind)) {
          return rememberRaw(wristCandidate);
        }
        // Empty *-chrome AABB is a fat box around a thin HUD plane — fall through to CAD.
      }
    } catch (_) {}

    try {
      if (xrSolidDraw?.handles?.visible) {
        xrSolidDraw.handles.updateMatrixWorld?.(true);
        const hh = raycaster.intersectObject(xrSolidDraw.handles, true);
        const mappedH = xrSolidDraw.pickHandle?.(hh);
        if (mappedH) return remember(mappedH);
      }
    } catch (_) {}

    try {
      if (printerPinHit?.visible) {
        printerPinHit.updateMatrixWorld?.(true);
        const pinHit = raycaster.intersectObject(printerPinHit, false)[0];
        if (pinHit) return remember({
          kind: "printer-pin", pinned: printerPlacement?.pinned === true,
          distance: pinHit.distance, point: pinHit.point?.clone?.(), object: printerPinHit,
        });
      }
    } catch (_) {}

    const cameraUi = roomCameraView.pick(raycaster.ray);
    if (cameraUi) return rememberRaw(cameraUi);
    const roboticsUi = roboticsWorkspace.pick(raycaster.ray);
    if (roboticsUi) return rememberRaw(roboticsUi);
    if (printerFenceMode) {
      return rememberRaw({ kind: "printer-fence", fence: true, distance: 2, ray: raycaster.ray.clone() });
    }
    const spatialUi = aiDrawWorkspace.pickUI(controller);
    if (spatialUi) return remember(spatialUi);
    if (uiOnly) {
      if (wristCandidate && isUiPick(wristCandidate)) return rememberRaw(wristCandidate);
      return rememberRaw(null);
    }
    if (xrWiringView.isActive()) {
      const wiringHit = xrWiringView.pick(raycaster);
      return wristCandidate ? rememberRaw(wristCandidate) : rememberRaw(wiringHit);
    }
    const busyState = {
      grabbing: !!(gripGrab || scaleGrab || grabState || oneHandScale),
      drawing: !!voiceDraw.isDrawing?.(),
      creating: !!xrSolidDraw.isHandleDragging?.() || !!xrSolidDraw.isActive?.(),
      solidDraw: !!xrSolidDraw.isActive?.(),
      combining: xrCsgPending,
      tool: activeTool,
    };
    if (shouldSkipWorldMeshPick(busyState)) {
      return wristCandidate ? rememberRaw(wristCandidate) : rememberRaw(null);
    }
    const spatialHit = aiDrawWorkspace.isActive() ? aiDrawWorkspace.view.pickBounds?.(controller) : null;
    if (spatialHit) return wristCandidate ? rememberRaw(wristCandidate) : rememberRaw(spatialHit);
    const meshHit = cheapMeshPick(busyState);
    const uiKeep = wristCandidate && isUiPick(wristCandidate) ? wristCandidate : null;
    return remember(preferHudHitOverCad(uiKeep, meshHit));
  }

  function pickDrawablesAabb() {
    let best = null;
    let bestD = Infinity;
    for (const mesh of allDrawables()) {
      if (!mesh || skipXrInstancedPick(mesh)) continue;
      try { mesh.updateMatrixWorld?.(true); } catch { continue; }
      const geo = mesh.geometry;
      try {
        if (geo?.boundingBox) {
          _meshBoxScratch.copy(geo.boundingBox).applyMatrix4(mesh.matrixWorld);
        } else if (geo) {
          try { geo.computeBoundingBox(); } catch { /* ignore */ }
          if (geo.boundingBox) _meshBoxScratch.copy(geo.boundingBox).applyMatrix4(mesh.matrixWorld);
          else _meshBoxScratch.setFromObject(mesh);
        } else {
          _meshBoxScratch.setFromObject(mesh);
        }
      } catch { continue; }
      if (_meshBoxScratch.isEmpty()) continue;
      if (!raycaster.ray.intersectBox(_meshBoxScratch, _meshHit)) continue;
      const d = raycaster.ray.origin.distanceTo(_meshHit);
      if (!(d < bestD)) continue;
      const root = findDrawableRoot(mesh) || mesh;
      bestD = d;
      best = {
        kind: "mesh",
        object: root,
        point: _meshHit.clone(),
        distance: d,
        cheap: true,
      };
    }
    return best;
  }

  function pickDropsAabb() {
    if (!publicRoomJoined()) return null;
    let best = null;
    let bestD = Infinity;
    let rows;
    try { rows = publicDrops.items?.values?.(); } catch { return null; }
    if (!rows) return null;
    for (const row of rows) {
      const root = row?.root;
      if (!root) continue;
      try { root.updateMatrixWorld?.(true); } catch { continue; }
      try {
        _meshBoxScratch.setFromObject(root);
      } catch { continue; }
      if (_meshBoxScratch.isEmpty()) continue;
      if (!raycaster.ray.intersectBox(_meshBoxScratch, _meshHit)) continue;
      const d = raycaster.ray.origin.distanceTo(_meshHit);
      if (!(d < bestD)) continue;
      bestD = d;
      best = {
        kind: "drop",
        objectId: row.id,
        root,
        object: root,
        point: _meshHit.clone(),
        distance: d,
        cheap: true,
      };
    }
    return best;
  }

  function pickLiveCadAabb() {
    if (!shouldPickLiveCad({ enterSettled: xrEnterWorkSettled() })) return null;
    const mesh = getLiveMesh();
    if (!mesh) return null;
    const box = contentBoxFromMesh(mesh);
    if (box.isEmpty() || !raycaster.ray.intersectBox(box, _meshHit)) return null;
    return {
      kind: "mesh",
      object: mesh,
      point: _meshHit.clone(),
      distance: raycaster.ray.origin.distanceTo(_meshHit),
      cheap: true,
    };
  }

  function nearerHit(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return Number(b.distance) < Number(a.distance) ? b : a;
  }

  function cheapMeshPick(busyState = {}) {
    const cheap = shouldCheapMeshPick(busyState);
    const ink = pickDrawablesAabb();
    const drop = pickDropsAabb();
    if (cheap) {
      const world = nearerHit(nearerHit(ink, drop), pickLiveCadAabb());
      if (world) return world;
    } else {
      const world = nearerHit(ink, drop);
      if (world && world.kind === "drop") return world;
    }
    if (xrBoard?.state?.active && xrBoard.board) {
      try {
        xrBoard.board.updateMatrixWorld?.(true);
        const bh = raycaster.intersectObject(xrBoard.board, false);
        if (bh[0]?.point) {
          return {
            kind: "board",
            object: xrBoard.board,
            point: bh[0].point.clone(),
            distance: bh[0].distance,
          };
        }
      } catch { /* ignore */ }
    }
    if (!cheap && publicRoomJoined()) {
      try {
        const dropHit = publicDrops.pick(raycaster);
        if (dropHit) return dropHit;
      } catch { /* ignore */ }
    }
    if (cheap) return null;
    if (!shouldCadTrianglePick({
      tool: busyState.tool || activeTool,
      enterSettled: xrEnterWorkSettled(),
    })) {
      return nearerHit(ink, drop);
    }
    const mesh = getLiveMesh();
    if (!mesh) return nearerHit(ink, drop);
    const box = contentBoxFromMesh(mesh);
    if (box.isEmpty() || !raycaster.ray.intersectBox(box, _meshHit)) {
      return nearerHit(ink, drop);
    }
    const hits = raycaster.intersectObject(mesh, true).filter((h) => h.object.isMesh && !skipXrInstancedPick(h.object));
    if (!hits.length) return nearerHit(ink, drop);
    const hit = hits[0];
    if (activeTool === "measure") {
      try {
        const edge = nearestWorldEdgeFromHit(hit);
        if (edge && edge.pick_distance < Math.max(0.04, edge.length * 0.35)) {
          return { kind: "edge", edge, point: edge.closest.clone() };
        }
      } catch (err) {
        console.warn("[viewport-xr] edge snap", err);
      }
    }
    const cad = { kind: "mesh", object: hit.object, point: hit.point.clone(), distance: hit.distance };
    return nearerHit(nearerHit(ink, drop), cad);
  }

  function closestPointsOnSegments(a0, a1, b0, b1) {
    // Robust segment-segment closest points
    const u = a1.clone().sub(a0);
    const v = b1.clone().sub(b0);
    const w0 = a0.clone().sub(b0);
    const a = u.dot(u);
    const b = u.dot(v);
    const c = v.dot(v);
    const d = u.dot(w0);
    const e = v.dot(w0);
    const denom = a * c - b * b;
    let sc, tc;
    if (denom < 1e-12) {
      sc = 0;
      tc = (b > c ? d / b : e / c);
    } else {
      sc = (b * e - c * d) / denom;
      tc = (a * e - b * d) / denom;
    }
    sc = THREE.MathUtils.clamp(sc, 0, 1);
    tc = THREE.MathUtils.clamp(tc, 0, 1);
    const pa = a0.clone().addScaledVector(u, sc);
    const pb = b0.clone().addScaledVector(v, tc);
    return { pa, pb, dist: pa.distanceTo(pb) };
  }

  function addMeasureEdgeVisual(edge, color = 0xfbbf24) {
    const geo = new THREE.BufferGeometry().setFromPoints([edge.start, edge.end]);
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color, depthTest: false, linewidth: 2 }),
    );
    line.renderOrder = 2600;
    measureGroup.add(line);
    const ends = [edge.start, edge.end];
    for (const p of ends) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.008, 10, 8),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      );
      m.position.copy(p);
      m.renderOrder = 2601;
      measureGroup.add(m);
    }
  }

  /**
   * Convert two world-space points to millimetres using the CAD/model frame.
   * Do NOT use desktop currentMmPerModelUnit() here — after XR handheld scaling
   * the world bbox is ~0.1m so that heuristic wrongly returns 1000×.
   */
  function measureDistanceMm(worldA, worldB) {
    const mesh = getLiveMesh();
    if (mesh) {
      const a = mesh.worldToLocal(worldA.clone());
      const b = mesh.worldToLocal(worldB.clone());
      const localDist = a.distanceTo(b);
      const mmPer = Number.isFinite(xrMmPerUnit) && xrMmPerUnit > 0 ? xrMmPerUnit : 1;
      return localDist * mmPer;
    }
    // Fallback: treat world units as metres
    return worldA.distanceTo(worldB) * 1000;
  }

  function finishEdgeMeasure() {
    if (measureEdges.length < 2) return;
    const [e0, e1] = measureEdges;
    const { pa, pb, dist } = closestPointsOnSegments(e0.start, e0.end, e1.start, e1.end);
    measureLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([pa, pb]),
      new THREE.LineBasicMaterial({ color: 0x38bdf8, depthTest: false }),
    );
    measureLine.renderOrder = 2610;
    measureGroup.add(measureLine);
    const mm = measureDistanceMm(pa, pb);
    const text = typeof formatLength === "function" ? formatLength(mm) : `${mm.toFixed(2)} mm`;
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 140;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "rgba(15,23,42,0.92)";
    ctx.fillRect(0, 0, 640, 140);
    ctx.strokeStyle = "#38bdf8";
    ctx.lineWidth = 6;
    ctx.strokeRect(4, 4, 632, 132);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 54px Arial,sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(text, 320, 70);
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "bold 28px Arial,sans-serif";
    ctx.fillText("edge distance", 320, 112);
    const sp = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }),
    );
    sp.scale.set(0.32, 0.07, 1);
    sp.position.copy(pa).lerp(pb, 0.5);
    measureGroup.add(sp);
    measureLabel = sp;
  }

  function remapHudChromeHit(hit) {
    if (!hit || !hit.kind) return hit;
    const kind = String(hit.kind);
    if (!kind.endsWith("-chrome") && kind !== "menu-chrome") return hit;
    try {
      if ((kind === "menu-chrome" || kind === "explorer-chrome") && hit.point && explorerPanel?.plane) {
        const local = explorerPanel.plane.worldToLocal(hit.point.clone());
        const mapped = pickMenuFromLocalPoint(local);
        if (mapped?.kind) return { ...hit, ...mapped };
      }
      if (kind === "grid-chrome" && hit.point) {
        const panel = gridPanelRef(hit.panel);
        if (panel?.plane) {
          const uv = hit.uv;
          const { canvas } = gridLayout(hit.panel);
          if (uv && canvas) {
            const mapped = pickGridFromCanvasPx(hit.panel, uv.x * canvas.w, (1 - uv.y) * canvas.h);
            if (mapped) return { ...hit, ...mapped };
          }
        }
      }
      if (kind === "view-chrome" && hit.uv) {
        const mapped = pickViewFromCanvasPx(hit.uv.x * VIEW_CANVAS.w, (1 - hit.uv.y) * VIEW_CANVAS.h);
        if (mapped) return { ...hit, ...mapped };
      }
    } catch (_) {}
    return hit;
  }

  /** Resolve the same hand's displayed laser, including its geometric HUD fallback. */
  function pickControllerSelectHit(controller) {
    if (!controller || !objectIsPosed(controller)) return null;
    const boardHit = aiDrawWorkspace.pickUI(controller);
    let hit = pickWithController(controller, { uiOnly: false });
    if (hit?.kind === "wiring" || hit?.kind === "robotics-workspace-action") return hit;
    if (hit && isXrUiHoverKind(hit.kind)) return remapHudChromeHit(hit) || hit;
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3();
    let aabbHit = controllerAimRay(controller, origin, dir) ? menuHitFromAabb(origin, dir) : null;
    if (aabbHit?.point) {
      const mapped = mapHudPointToAction(aabbHit.point);
      if (mapped?.kind) aabbHit = { ...aabbHit, ...mapped };
    }
    if ((!hit || !isXrUiHoverKind(hit.kind)) && aabbHit) {
      hit = remapHudChromeHit(aabbHit) || aabbHit;
    } else if (hit) {
      hit = remapHudChromeHit(hit) || hit;
    }
    if (hit && aabbHit && hudHitStealsCad(aabbHit)) hit = preferUiHoverHit(hit, aabbHit);
    if (boardHit && (!hit || !isXrUiHoverKind(hit.kind))) return boardHit;
    return preferHudHitOverCad(
      (hit && hudHitStealsCad(hit) ? hit : null)
        || (aabbHit && hudHitStealsCad(aabbHit) ? aabbHit : null),
      hit && !isXrUiHoverKind(hit.kind) ? hit : null,
    );
  }

  function handleSelect(controller) {
    const now = performance.now();
    blurXrDom();

    const hand = squeezeHandIndex(controller);
    if (hand !== 0 && hand !== 1) return;
    if (uiSelectPress.held(hand)) return;
    // Native select events and the gamepad poll share this guard. Holding a
    // part already owns this hand; pressing trigger must not click through it.
    if (gripGrab?.hand === hand || (panelDrag?.input === "grip" && panelDrag.hand === hand)) return;
    const grip = hand === 0 ? getLeftGrip() : hand === 1 ? getRightGrip() : null;
    const aim = (hand === 0 || hand === 1)
      ? (aimPointer(hand) || posedControllerForHand(hand) || fallbackSelectPointer(hand))
      : (aimPointer(1) || fallbackSelectPointer(1));
    const laserCtrl = (hand === 0 || hand === 1)
      ? (posedControllerForHand(hand) || aim || controller)
      : (aim || controller);
    const pointer = resolveSelectAim({
      pointer: laserCtrl,
      grip,
      pointerPosed: objectIsPosed(laserCtrl),
      gripPosed: objectIsPosed(grip),
    }) || laserCtrl || aim || controller;
    const laserNode = laserPickNode({
      controller: laserCtrl,
      controllerPosed: objectIsPosed(laserCtrl),
      aim: pointer,
      aimPosed: objectIsPosed(pointer),
    }) || pointer;
    if (generationSurfacePick) {
      if (isDimosTeleopArmed()) { cancelGenerationSurfacePick(); return; }
      const origin = new THREE.Vector3();
      const direction = new THREE.Vector3();
      if (controllerAimRay(laserNode, origin, direction)) {
        const surface = generationSurfaceFromRay(new THREE.Raycaster(origin, direction));
        if (surface) generationSurfacePick.finish(surface);
      }
      return;
    }
    // Combined hover may belong to the other hand. A grip-space ray also has a
    // different direction from the visible target-ray, so neither can redirect a click.
    let hit = pickControllerSelectHit(laserNode);
    if (!studioRoboticsInputAllowed({armed:isDimosTeleopArmed(), control:"trigger", uiHit:isUiPick(hit), hit, astraTalk: !!voiceMoldLive})) return;
    if (isUiPick(hit)) reserveDimosMenuTrigger(hand === 0 ? "left" : hand === 1 ? "right" : "");
    if (laserNode) controller = laserNode;
    if (hit && !isUiPick(hit) && xrSelectDebounceBlocks({ hasHit: true, elapsedMs: now - lastSelectAt, windowMs: 180 })) {
      noteSelectConsume({
        uiHit: isUiPick(hit),
        hasPick: true,
        blocked: "debounce",
        ev: "sel",
        h: hand === 0 ? "l" : hand === 1 ? "r" : "u",
      });
      return;
    }
    if (hit) lastSelectAt = now;
    if (isUiPick(hit)) {
      uiSelectPress.commit(hand);
      prevTrigger[hand] = true;
    }
    // A new menu click ends this hand's old trigger drag. Debounce first so
    // duplicate native/polled events cannot cancel a deliberate Move press.
    if (isUiPick(hit) && panelDrag?.input !== "grip" && panelDrag?.hand === hand) panelDrag = null;
    // A button click parks the panel before any follow/face-head update can move it.
    if (isUiPick(hit)) {
      const clickedPanel = panelGroupFromHit(hit);
      if (clickedPanel) { clickedPanel.userData.xrHudParked = true; clickedPanel.userData.xrUserRotated = true; }
    }
    noteSelectConsume({
      uiHit: isUiPick(hit),
      nearMenu: isUiPick(hit),
      rayOnMenu: isUiPick(hit),
      hasPick: !!hit,
      ev: "sel",
      h: hand === 0 ? "l" : hand === 1 ? "r" : "u",
    });
    if (hit?.kind === "viewport-tab") {
      if (hit.action === "move") beginPanelDrag(controller, hit.group, { workspaceHandle: true });
      else tabbedWindows?.select(hit, controller);
      return;
    }
    if (hit?.kind === "ai-action" && String(hit.id).startsWith("board:")) { void aiDrawWorkspace.action(hit.id); return; }
    if (hit?.kind === "printer-fence") { selectPrinterFence(hit.ray); return; }
    if (hit?.kind === "printer-pin") { togglePrinterPin(); return; }
    if (hit?.kind === "robotics-workspace-action") { roboticsWorkspace.select(hit); return; }
    if (!isUiPick(hit) && aiDrawWorkspace.select(controller)) return;
    if (hit?.kind === "wiring") { xrWiringView.select(hit); return; }
    if (hit && !isUiPick(hit)) {
      const object = hit.object || hit.mesh;
      window.dispatchEvent(new CustomEvent("render3d:xr-selection", {detail:{kind:hit.kind,
        name:object?.name || "", targetFile:object?.userData?.catalogFilename || object?.userData?.filename || null, objectId:object?.userData?.partId || object?.userData?.catalogFilename || object?.name || "",
        point:hit.point?.toArray?.() || null, sources:object?.userData?.sources || [], metadata:object?.userData?.electronics || null}}));
    }
    const creating = String(activeTool || "").startsWith("create_");
    if ((activeTool === "teleport" || xrBoard?.state?.teleport) && hit?.kind === "board" && hit.point) {
      confirmTeleportTo(hit.point);
      return;
    }
    if ((activeTool === "draw" || creating) && hit && !isUiPick(hit) && !laserPointerActive()) {
      return;
    }
    if (!hit) {
      // Click in empty space: keep tools visible, but never reparent (that
      // used to slap the palette onto the right controller).
      try {
        if (dock) dock.visible = true;
        if (captureDock) syncCaptureDockVisibility();
      } catch (_) {}
      // Trigger-move is laser-on-mesh only. A miss (floor, empty, AABB near)
      // must not steal the CAD model.
      return;
    }
    if (hit.kind === "nametag") {
      openNametagCard(hit.userId, controller);
      return;
    }
    if (hit.kind === "hand-cam-hide") {
      hideWristCamSide(hit.side);
      return;
    }
    if (hit.kind === "hand-cam-hover") {
      return;
    }
    if (hit.kind === "social-card") {
      if (hit.action === "chrome") return;
      if (hit.action === "drag") {
        beginPanelDrag(controller, xrSocialCard.group, { translateOnly: true });
        return;
      }
      handleSocialCardAction(hit.action, hit.user);
      return;
    }
    if (hit.kind === "studio-close") {
      if (xrStudioStateAbort) {
        try { xrStudioStateAbort.abort(); } catch (_) { /* ignore */ }
      }
      xrStudio.close();
      try { savePanelPose("studio", xrStudio.group); } catch (_) {}
      return;
    }
    if (hit.kind === "studio-drag") {
      beginPanelDrag(controller, xrStudio.group, { translateOnly: true });
      return;
    }
    if (hit.kind === "studio-rotate") {
      beginPanelDrag(controller, xrStudio.group, { translateOnly: false });
      return;
    }
    if (hit.kind === "studio-action") {
      if (hit.id === "overflow") {
        xrStudio.toggleOverflow?.();
        return;
      }
      if (hit.id === "lock" || hit.id === "unlock") {
        writeXrHudLocked("studio", hit.id === "lock", hudStorage());
        xrStudio.setOverflowOpen?.(false);
        xrStudio.setLocked?.(hit.id === "lock");
        if (xrStudio?.group) xrStudio.group.userData.xrHudParked = hit.id === "lock";
        try { savePanelPose("studio", xrStudio.group); } catch (_) {}
        return;
      }
      if (handleWindowManagerAction("studio", hit.id, controller, xrStudio?.group)) return;
      return;
    }
    if (hit.kind === "studio-tab") {
      xrStudio.setTab(hit.tab);
      void refreshStudioPanel();
      return;
    }
    if (hit.kind === "studio-row") {
      handleStudioRow(hit.line);
      return;
    }
    if (panelChromeStartsDrag(hit.kind, hit) && hit.fromAabb !== true) {
      const group = panelGroupFromHit(hit);
      if (group) {
        beginPanelDrag(controller, group, { translateOnly: true });
        return;
      }
    }
    if (hit.kind === "studio-chrome") {
      return;
    }
    if (hit.kind === "solid-handle") {
      const pt = hit.point || solidDrawPoint(controller);
      try { xrSolidDraw.beginHandle?.(hit.handle, pt); } catch (_) {}
      return;
    }
    if (hit.kind === "color") {
      applyDrawColor(hit.colorNum || hit.color);
      dismissToolWheelAfterSelect();
      if (activeTool !== "draw" && !String(activeTool).startsWith("create_")) {
        setVoiceDraw(true);
      }
      return;
    }
    if (hit.kind === "tool") {
      if (String(hit.tool || "").startsWith("round-table:")) {
        aiRoundTable.action?.(hit.tool);
        if (hit.tool === "round-table:slide-point") aiRoundTable.pointAtSlide?.(hit.uv);
        return;
      }
      if (String(hit.tool) === "exit" || isExitVrHudHit(hit)) {
        beginExitVrHold(hand);
        return;
      }
      if (toolWheel.selectPage?.(hit.tool)) return;
      if (hit.tool) setTool(hit.tool);
      return;
    }
    if (hit.kind === "wheel-drag") {
      beginPanelDrag(controller, toolWheel.group);
      try { toolWheel.markMoved?.(); } catch (_) {}
      return;
    }
    if (hit.kind === "guides-drag") {
      beginPanelDrag(controller, guidesPanel?.group, { translateOnly: true });
      return;
    }
    if (hit.kind === "guides-clip") {
      guidesSwipe = { startX: hit.px || 0, lastX: hit.px || 0 };
      return;
    }
    if (hit.kind === "guides-action") {
      handleGuidesAction(hit.id);
      return;
    }
    if (hit.kind === "guides-chrome") {
      return;
    }
    if (hit.kind === "howto-next") {
      advanceHowtoTour();
      return;
    }
    if (hit.kind === "howto-done") {
      closeHowtoTour();
      return;
    }
    if (hit.kind === "howto-drag") {
      beginPanelDrag(controller, howtoPanel?.group, { translateOnly: true });
      return;
    }
    if (hit.kind === "debugger-chrome") {
      return;
    }
    if (hit.kind === "debugger-action") {
      if (hit.id === "send-log") void sendXrDebugLogToPc();
      return;
    }
    if (hit.kind === "menu-chrome") {
      const remapped = remapHudChromeHit(hit) || mapHudPointToAction(hit.point);
      if (remapped && remapped.kind && remapped.kind !== "menu-chrome") {
        hit = remapped;
      } else {
        return;
      }
    }
    if (hit.kind === "menu-action") {
      if (hit.id === "overflow") {
        hudOverflowOpen.menu = !hudOverflowOpen.menu;
        openMenuConsole({ keepPose: true, forceRedraw: true });
        return;
      }
      if (hit.id === "lock" || hit.id === "unlock") {
        writeXrHudLocked("menu", hit.id === "lock", hudStorage());
        hudOverflowOpen.menu = false;
        if (explorerPanel?.group) {
          explorerPanel.worldPlaced = true;
          explorerPanel.group.userData.xrHudParked = hit.id === "lock";
          try { savePanelPose("menu", explorerPanel.group); } catch (_) {}
        }
        openMenuConsole({ keepPose: true, forceRedraw: true });
        return;
      }
      if (handleWindowManagerAction("menu", hit.id, controller, explorerPanel?.group)) return;
      return;
    }
    if (hit.kind === "menu-rotate") {
      beginPanelDrag(controller, explorerPanel?.group, { translateOnly: false });
      return;
    }
    if (hit.kind === "ai-action" || hit.kind === "menu-row" || hit.kind === "menu-tab" || hit.kind === "view-action" || hit.kind === "grid-action" || hit.kind === "workspace-action" || hit.kind === "avatar-action" || hit.kind === "share-invite-action") {
      if (panelDrag?.input !== "grip" && panelDrag?.hand === hand) panelDrag = null;
    }
    if (hit.kind === "view-drag") {
      beginPanelDrag(controller, viewPanel?.group, { translateOnly: true });
      return;
    }
    if (hit.kind === "view-rotate") {
      beginPanelDrag(controller, viewPanel?.group, { translateOnly: false });
      return;
    }
    if (hit.kind === "view-action") {
      handleViewAction(hit.id);
      return;
    }
    if (hit.kind === "view-chrome") {
      return;
    }
    if (hit.kind === "workspace-drag") {
      beginPanelDrag(controller, workspacePanel?.group, { translateOnly: true });
      return;
    }
    if (hit.kind === "workspace-action") {
      handleWorkspaceAction(hit.id);
      return;
    }
    if (hit.kind === "share-sheet-drag") {
      beginPanelDrag(controller, sharePanel?.group, { translateOnly: true });
      return;
    }
    if (hit.kind === "share-sheet-action") {
      handleShareAction(hit.id);
      return;
    }
    if (hit.kind === "share-sheet-chrome") {
      return;
    }
    if (hit.kind === "workspace-chrome") {
      return;
    }
    if (hit.kind === "avatar-drag") {
      beginPanelDrag(controller, avatarPanel?.group, { translateOnly: true });
      return;
    }
    if (hit.kind === "avatar-action") {
      handleAvatarAction(hit.id);
      return;
    }
    if (hit.kind === "avatar-chrome") {
      return;
    }
    if (hit.kind === "share-invite-drag") {
      beginPanelDrag(controller, shareInvitePanel?.group, { translateOnly: true });
      return;
    }
    if (hit.kind === "share-invite-action") {
      handleShareInviteAction(hit.id);
      return;
    }
    if (hit.kind === "share-invite-chrome") {
      return;
    }
    if (hit.kind === "print-settings-drag") {
      beginPanelDrag(controller, printSettingsPanel?.group, { translateOnly: true });
      return;
    }
    if (hit.kind === "print-settings-action") {
      handlePrintSettingsAction(hit.id);
      return;
    }
    if (hit.kind === "print-settings-chrome") {
      return;
    }
    if (hit.kind === "printer-fence") {
      selectPrinterFence(hit.ray || raycaster.ray);
      return;
    }
    if (hit.kind === "share-video-close") {
      disposeSharedVideo();
      return;
    }
    if (hit.kind === "share-video-hide") {
      clipWindowHiddenFromOthers = !clipWindowHiddenFromOthers;
      persistClipWindowState({ hidden: clipWindowHiddenFromOthers });
      broadcastClipWindowVisibility();
      menuFooterHint = clipWindowHiddenFromOthers ? "Hidden from other users" : "Visible to others";
      return;
    }
    if (hit.kind === "share-video-curve") {
      applyClipWindowCurve(!clipWindowCurved);
      menuFooterHint = clipWindowCurved ? "Curved screen on" : "Flat screen";
      return;
    }
    if (hit.kind === "share-video-anchor") {
      persistClipWindowState({ anchor: true, anchored: true });
      menuFooterHint = "Anchored — this spot next session";
      return;
    }
    if (hit.kind === "share-video-resize") {
      beginClipResize(controller);
      return;
    }
    if (hit.kind === "share-video-menu") {
      clipMenuOpen = !clipMenuOpen;
      clipFriendOpen = false;
      if (sharedVideo?.friendMesh) sharedVideo.friendMesh.visible = false;
      paintClipOverflowMenu();
      return;
    }
    if (hit.kind === "share-video-action") {
      clipMenuOpen = false;
      paintClipOverflowMenu();
      if (hit.id === "share-x") {
        try { onSocialAction?.("clip-share-x"); } catch (_) {}
        return;
      }
      if (hit.id === "download") {
        try { onSocialAction?.("clip-download"); } catch (_) {}
        return;
      }
      if (hit.id === "send-friend") {
        clipFriendOpen = true;
        clipFriendKbOpen = false;
        if (sharedVideo?.friendMesh) sharedVideo.friendMesh.visible = true;
        paintClipFriendPanel();
        void loadClipFriends();
        return;
      }
      return;
    }
    if (hit.kind === "clip-friend-close" || hit.kind === "clip-friend-chrome") {
      if (hit.kind === "clip-friend-close") {
        clipFriendOpen = false;
        if (sharedVideo?.friendMesh) sharedVideo.friendMesh.visible = false;
      }
      return;
    }
    if (hit.kind === "clip-friend-search") {
      clipFriendKbOpen = !clipFriendKbOpen;
      paintClipFriendPanel();
      return;
    }
    if (hit.kind === "clip-friend-key") {
      clipFriendSearch = applyClipFriendKey(clipFriendSearch, hit.id);
      paintClipFriendPanel();
      return;
    }
    if (hit.kind === "clip-friend-row") {
      const uid = String(hit.userId || "");
      if (uid) {
        writeClipSendRecent(uid);
        try {
          const res = onSocialAction?.(`capture-file:${uid}`);
          Promise.resolve(res).then((r) => {
            menuFooterHint = r?.message || r?.error || `Sent to ${String(hit.name || "friend").slice(0, 22)}`;
          }).catch((err) => {
            menuFooterHint = err?.message || "Could not send";
          });
        } catch (err) {
          menuFooterHint = err?.message || "Could not send";
        }
      }
      clipFriendOpen = false;
      if (sharedVideo?.friendMesh) sharedVideo.friendMesh.visible = false;
      return;
    }
    if (hit.kind === "share-video-toggle") {
      const v = sharedVideo?.video;
      if (!v) return;
      if (v.muted) {
        v.muted = false;
        void v.play?.().catch(() => {});
      } else if (v.paused) {
        void v.play?.().catch(() => {});
      } else {
        v.pause?.();
      }
      return;
    }
    if (hit.kind === "share-video-drag") {
      beginPanelDrag(controller, sharedVideo?.group, { translateOnly: true });
      return;
    }
    if (isXrSceneWindowHitKind(hit.kind)) {
      handleXrSceneWindowSelect(hit, controller);
      return;
    }
    if (hit.kind === "grid-drag") {
      beginPanelDrag(controller, gridPanelRef(hit.panel)?.group, { translateOnly: true });
      return;
    }
    if (hit.kind === "grid-rotate") {
      beginPanelDrag(controller, gridPanelRef(hit.panel)?.group, { translateOnly: false });
      return;
    }
    if (hit.kind === "grid-action") {
      if (handleWindowManagerAction(hit.panel, hit.id, controller, gridPanelRef(hit.panel)?.group)) return;
      handleGridAction(hit.panel, hit.id);
      return;
    }
    if (hit.kind === "grid-chrome") {
      return;
    }
    if (hit.kind === "robotics-drag") {
      beginPanelDrag(controller, roboticsPanel?.group, { translateOnly: true });
      return;
    }
    if (hit.kind === "robotics-rotate") {
      beginPanelDrag(controller, roboticsPanel?.group, { translateOnly: false });
      return;
    }
    if (hit.kind === "robotics-action") {
      if (handleWindowManagerAction("robotics", hit.id, controller, roboticsPanel?.group)) return;
      handleRoboticsAction(hit.id);
      return;
    }
    if (hit.kind === "robotics-chrome") {
      return;
    }
    if (hit.kind === "menu-close") {
      closeMenuConsole();
      return;
    }
    if (hit.kind === "place-close") {
      closePlacePanel();
      return;
    }
    if (hit.kind === "place-drag") {
      beginPanelDrag(controller, placePanel?.group, { translateOnly: true });
      return;
    }
    if (hit.kind === "ai-drag") {
      beginPanelDrag(controller, aiPanel?.group, { translateOnly: true });
      return;
    }
    if (hit.kind === "ai-rotate") {
      beginPanelDrag(controller, aiPanel?.group, { translateOnly: false });
      return;
    }
    if (hit.kind === "ai-action") {
      handleAiAction(hit.id);
      return;
    }
    if (hit.kind === "explorer-drag") {
      beginPanelDrag(controller, explorerPanel.group, { translateOnly: true });
      return;
    }
    if (hit.kind === "menu-tab") {
      menuFooterHint = "";
      if (menuTab === "social" && socialPane === "profile" && publicProfileTabIds().includes(hit.tab)) {
        socialProfileTab = hit.tab;
        openMenuConsole({ tab: "social", keepPose: true, force: true });
        return;
      }
      // Explicit user input must not be discarded by the background repaint
      // throttle merely because Draw/Create or the other hand is active.
      openMenuConsole({ tab: hit.tab, keepPose: true, force: true });
      return;
    }
    if (hit.kind === "menu-row") {
      const line = hit.line;
      if (!line?.id && line?.kind === "hint") return;
      if (line?.kind === "sandbox-file") {
        try {
          openSandboxMenuFile(line.id);
          menuFooterHint = `Sandbox file ${String(line.label || line.id).slice(0, 48)}`;
        } catch (err) {
          menuFooterHint = err?.message || "Could not open sandbox file";
        }
        return;
      }
      if (line?.kind === "project") {
        if (line?.id) {
          if (publicRoomJoined()) {
            menuFooterHint = "Loading for everyone…";
            try {
              const res = onSocialAction?.(`import:${line.id}`);
              Promise.resolve(res).then((r) => {
                menuFooterHint = r?.message || r?.error || "Loaded for everyone";
                if (presenting) openMenuConsole({ tab: "projects", keepPose: true });
              });
            } catch (err) {
              menuFooterHint = err?.message || "Could not load project";
            }
            return;
          }
          try {
            const maybe = onOpenProject?.(line.id);
            Promise.resolve(maybe).then(() => {
              if (!presenting) return;
              try { onProjectOpened?.(line.id); } catch (_) {}
              menuFooterHint = "Project loaded";
              // Defer menu redraw one frame so place + GLB settle first (Quest OOM).
              setTimeout(() => {
                if (!presenting) return;
                try {
                  openMenuConsole({ tab: "parts", keepPose: true });
                } catch (_) {}
              }, 250);
            }).catch(err=>{menuFooterHint=err?.message || "Could not open project";});
          } catch (err) {
            console.warn("[viewport-xr] open project", err);
          }
        }
        return;
      }
      if (line?.kind === "social" || menuTab === "social") {
        if (line?.id === "room_back") {
          if (socialPane === "profile") socialPane = "person";
          else if (socialPane === "person") socialPane = "room";
          else socialPane = "hub";
          openMenuConsole({ tab: "social", keepPose: true });
          return;
        }
        if (line?.id === "room_open" || line?.id === "room_me") {
          socialPane = "room";
          socialFocusId = "";
          socialProfile = null;
          openMenuConsole({ tab: "social", keepPose: true });
          return;
        }
        if (String(line?.id || "").startsWith("room_user:")) {
          socialFocusId = String(line.id).slice(10);
          socialPane = "person";
          socialProfile = null;
          openMenuConsole({ tab: "social", keepPose: true });
          return;
        }
        if (String(line?.id || "").startsWith("room_vol_down:")) {
          const uid = String(line.id).slice(14);
          const cur = xrVoice.getPeerVolume?.(uid) ?? 1;
          xrVoice.setPeerVolume?.(uid, Math.max(0, cur - 0.15));
          menuFooterHint = `Volume ${volumeLabel(uid)}`;
          openMenuConsole({ tab: "social", keepPose: true });
          return;
        }
        if (String(line?.id || "").startsWith("room_vol_up:")) {
          const uid = String(line.id).slice(12);
          const cur = xrVoice.getPeerVolume?.(uid) ?? 1;
          xrVoice.setPeerVolume?.(uid, Math.min(1, cur + 0.15));
          menuFooterHint = `Volume ${volumeLabel(uid)}`;
          openMenuConsole({ tab: "social", keepPose: true });
          return;
        }
        if (String(line?.id || "").startsWith("room_mute:")) {
          const uid = String(line.id).slice(10);
          const next = !xrVoice.isPeerMuted?.(uid);
          xrVoice.setPeerMuted?.(uid, next);
          menuFooterHint = next ? "Muted" : "Unmuted";
          openMenuConsole({ tab: "social", keepPose: true });
          return;
        }
        if (String(line?.id || "").startsWith("room_add:")) {
          const uid = String(line.id).slice(9);
          try {
            const res = onSocialAction?.(`user:${uid}`);
            Promise.resolve(res).then((r) => {
              menuFooterHint = r?.message || r?.error || "Added";
              if (presenting) openMenuConsole({ tab: "social", keepPose: true });
            });
          } catch (err) {
            menuFooterHint = err?.message || "Could not add friend";
            openMenuConsole({ tab: "social", keepPose: true });
          }
          return;
        }
        if (String(line?.id || "").startsWith("room_file:")) {
          const uid = String(line.id).slice(10);
          menuFooterHint = "Sending file…";
          try {
            const res = onSocialAction?.(`file:${uid}`);
            Promise.resolve(res).then((r) => {
              menuFooterHint = r?.message || r?.error || "File sent";
              if (presenting) openMenuConsole({ tab: "social", keepPose: true });
            });
          } catch (err) {
            menuFooterHint = err?.message || "Could not send file";
            openMenuConsole({ tab: "social", keepPose: true });
          }
          return;
        }
        if (String(line?.id || "").startsWith("room_msg:")) {
          const uid = String(line.id).slice(9);
          menuFooterHint = "Sending message…";
          try {
            const res = onSocialAction?.(`message:${uid}`);
            Promise.resolve(res).then((r) => {
              menuFooterHint = r?.message || r?.error || "Message sent";
              if (presenting) openMenuConsole({ tab: "social", keepPose: true });
            });
          } catch (err) {
            menuFooterHint = err?.message || "Could not message";
            openMenuConsole({ tab: "social", keepPose: true });
          }
          return;
        }
        if (String(line?.id || "").startsWith("meet:") || String(line?.id || "").startsWith("meetslot:")) {
          menuFooterHint = "Sending meeting request…";
          openMenuConsole({ tab: "social", keepPose: true });
          try {
            const res = onSocialAction?.(line.id);
            Promise.resolve(res).then((r) => {
              menuFooterHint = r?.message || r?.error || (r?.ok === false ? "Could not request meeting" : "Meeting request sent");
              if (presenting) openMenuConsole({ tab: "social", keepPose: true });
            });
          } catch (err) {
            menuFooterHint = err?.message || "Could not request meeting";
            openMenuConsole({ tab: "social", keepPose: true });
          }
          return;
        }
        if (String(line?.id || "").startsWith("room_view:")) {
          const uid = String(line.id).slice(10);
          menuFooterHint = "Loading profile…";
          openMenuConsole({ tab: "social", keepPose: true });
          try {
            const res = onSocialAction?.(`profile:${uid}`);
            Promise.resolve(res).then((r) => {
              if (r?.profile) {
                socialProfile = r.profile;
                socialFocusId = uid;
                socialPane = "profile";
                socialProfileTab = "profile";
                menuFooterHint = "";
              } else {
                menuFooterHint = r?.error || "Could not load profile";
              }
              if (presenting) openMenuConsole({ tab: "social", keepPose: true });
            });
          } catch (err) {
            menuFooterHint = err?.message || "Could not load profile";
            openMenuConsole({ tab: "social", keepPose: true });
          }
          return;
        }
        if (line?.id === "drop_current") {
          menuFooterHint = "Dropping into the shared room…";
          try {
            const res = onSocialAction?.("drop_current");
            Promise.resolve(res).then((r) => {
              menuFooterHint = r?.message || r?.error || "Dropped into the room";
              if (presenting) openMenuConsole({ tab: "social", keepPose: true });
            });
          } catch (err) {
            menuFooterHint = err?.message || "Could not drop project";
            openMenuConsole({ tab: "social", keepPose: true });
          }
          return;
        }
        if (line?.id === "import_project") {
          menuFooterHint = publicRoomJoined()
            ? "Tap a project — both of you will see it"
            : "Tap a project to import it here";
          openMenuConsole({ tab: "projects", keepPose: true });
          return;
        }
        if (line?.id === "voice_toggle") {
          void toggleHeadsetMic().finally(() => {
            if (presenting) openMenuConsole({ tab: "social", keepPose: true });
          });
          return;
        }
        if (line?.id === "avatar") {
          toggleAvatarPanel();
          return;
        }
        if (line?.id === "public_join" || line?.id === "public_leave") {
          try {
            const res = onSocialAction?.(line.id);
            menuFooterHint=line.id==='public_join'?'Connecting to public room…':'Leaving public room…';
            if(presenting)openMenuConsole({tab:'social',keepPose:true});
            Promise.resolve(res).then((r) => {
              if(r?.cancelled)return;
              menuFooterHint = r?.message || r?.error || (line.id === "public_join" ? "Joined public room" : "Left public room");
              if (line.id === "public_join" && r?.ok !== false) {
                socialPane = "room";
                socialFocusId = "";
                socialProfile = null;
              }
              if (line.id === "public_leave") {
                socialPane = "hub";
                socialFocusId = "";
                socialProfile = null;
              }
              if (presenting) openMenuConsole({ tab: "social", keepPose: true });
            }).catch(err=>{menuFooterHint=err?.message||'Public room failed';onStatus?.('error',menuFooterHint);if(presenting)openMenuConsole({tab:'social',keepPose:true});});
          } catch (err) {
            menuFooterHint = err?.message || "Public room failed";
            openMenuConsole({ tab: "social", keepPose: true });
          }
          return;
        }
        if (line?.kind === "hint" || !line?.id || line.id === "social_status" || line.id === "public_status") {
            openMenuConsole({ tab: "social", keepPose: true });
            try { syncSocialPresenceMarkers(); } catch (_) {}
            return;
        }
        try {
          const res = onSocialAction?.(line.id);
          Promise.resolve(res).then((r) => {
            menuFooterHint = r?.message || r?.error || "";
            if (r?.switchTab) {
              openMenuConsole({ tab: r.switchTab, keepPose: true });
              return;
            }
            if (presenting) {
              openMenuConsole({ tab: "social", keepPose: true });
              try { syncSocialPresenceMarkers(); } catch (_) {}
            }
          });
        } catch (err) {
          menuFooterHint = err?.message || "Social action failed";
        }
        return;
      }
      if (line?.kind === "part" || menuTab === "parts") {
        if (line?.id) {
          try {
            onExplorerSelect?.(line.id);
          } catch (err) {
            console.warn("[viewport-xr] part select", err);
          }
          if (editModelPickActive) {
            editModelPickActive = false;
            try { setAiPromptSetting?.("targetMode", "edit"); } catch (_) {}
            if (aiPanel) aiPanel.status = `Editing: ${String(line.label || line.id).slice(0, 40)}`;
            menuFooterHint = `Edit target: ${String(line.label || line.id).slice(0, 36)}`;
            refreshAiPromptPanel();
            if (explorerPanel) explorerPanel.group.visible = false;
            if (aiPanel && !aiPanel.group.visible) openAiPromptPanel({ keepPose: true });
            else refreshAiPromptPanel();
            return;
          }
          openMenuConsole({ tab: "parts", keepPose: true });
        }
        return;
      }
      if (line?.kind === "file" || menuTab === "files") {
        if (line?.id) {
          try {
            onExplorerSelect?.(line.id);
            onToolAction?.("link_file", line.id);
          } catch (err) {
            console.warn("[viewport-xr] file select", err);
          }
          openMenuConsole({ tab: "files", keepPose: true });
        }
        return;
      }
      if (menuTab === "ai") {
        if (line?.id === "ai_panel") {
          openAiPromptPanel();
          return;
        }
        if (line?.id === "voice_draw") {
          toggleVoiceDraw();
          openMenuConsole({ tab: "ai", keepPose: true });
          refreshAiPromptPanel();
          return;
        }
        if (line?.id === "transcribe") {
          try { onTranscribeToggle?.(); } catch (err) { console.warn("[viewport-xr] mic", err); }
          setTimeout(() => {
            openMenuConsole({ tab: "ai", keepPose: true });
            refreshAiPromptPanel();
          }, 200);
          return;
        }
        if (line?.id === "talk") {
          handleAiAction("talk");
          openMenuConsole({ tab: "ai", keepPose: true });
          return;
        }
        if (line?.id === "prompt_clear") {
          try { onToolAction?.("prompt_clear"); } catch (_) {}
          openMenuConsole({ tab: "ai", keepPose: true });
          return;
        }
        if (line?.id === "link_part") {
          try { onToolAction?.("link_part"); } catch (_) {}
          openMenuConsole({ tab: "ai", keepPose: true });
          return;
        }
        if (line?.id === "prompt") {
          const state = readAiState();
          if (state.generating) {
            try { onStopGeneration?.(); } catch (_) {}
          } else {
            try { onPromptSubmit?.(); } catch (_) {}
          }
          openMenuConsole({ tab: "ai", keepPose: true });
          refreshAiPromptPanel();
          return;
        }
        if (line?.id === "xr_key") {
          try { setAiPromptSetting?.("key", "next"); } catch (_) {}
          openMenuConsole({ tab: "ai", keepPose: true });
          refreshAiPromptPanel();
          return;
        }
        if (line?.id === "xr_model") {
          aiModelPickerOpen = true;
          openAiPromptPanel({ keepPose: true });
          refreshAiPromptPanel();
          return;
        }
        if (String(line?.id || "").startsWith("hist:")) {
          try { setAiPromptSetting?.("history", Number(String(line.id).slice(5))); } catch (_) {}
          openAiPromptPanel({ keepPose: true });
          refreshAiPromptPanel();
          return;
        }
        return;
      }
      // tools / view actions stay inside the general Menu console
      if (line?.id === "front" || line?.id === "place" || line?.id === "zoom_in" || line?.id === "zoom_out" || line?.id === "restore" || line?.id === "voice_draw" || line?.id === "robotics") {
        setTool(line.id);
        return;
      }
      if (line?.id === "screenshot" || line?.id === "record" || line?.id === "stream") {
        if (line.id === "stream") {
          setTool("stream");
          return;
        }
        menuFooterHint = line.id === "record"
          ? "Recording… Pause/Stop on the capture crescent"
          : "Capturing POV… Share to X opens when you exit VR";
        openMenuConsole({ tab: "view", keepPose: true });
        runHostTool(line.id);
        return;
      }
      runHostTool(line?.id);
      return;
    }
    if (hit.kind === "explorer") {
      if (hit.line?.id) onExplorerSelect?.(hit.line.id);
      return;
    }
    if (hit.kind === "place") {
      if (hit.line?.id === "__saved__") applySavedPose();
      else if (hit.line?.id) placeInFront({ spawnId: hit.line.id, keepZoom: false });
      openPlacePanel();
      return;
    }
    if (activeTool === "transparent" && !transparentAllActive && hit.kind === "mesh" && hit.object) {
      try {
        onToolAction?.("transparent_pick", {
          mesh: hit.object,
          faceIndex: hit.faceIndex,
        });
      } catch (err) {
        console.warn("[viewport-xr] transparent pick", err);
      }
      return;
    }
    if (activeTool === "measure" && (hit.kind === "edge" || hit.kind === "mesh")) {
      if (measureEdges.length >= 2) clearMeasure();
      if (hit.kind === "edge" && hit.edge) {
        measureEdges.push(hit.edge);
        addMeasureEdgeVisual(hit.edge, measureEdges.length === 1 ? 0xfbbf24 : 0x38bdf8);
        if (measureEdges.length === 2) finishEdgeMeasure();
        return;
      }
      // Fallback: point pick if no edge snap
      if (measurePoints.length >= 2) clearMeasure();
      measurePoints.push(hit.point.clone());
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.01, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xfbbf24, depthTest: false }),
      );
      m.position.copy(hit.point);
      measureGroup.add(m);
      if (measurePoints.length === 2) {
        const [a, b] = measurePoints;
        measureLine = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([a, b]),
          new THREE.LineBasicMaterial({ color: 0xfbbf24, depthTest: false }),
        );
        measureGroup.add(measureLine);
        const mm = measureDistanceMm(a, b);
        const text = typeof formatLength === "function" ? formatLength(mm) : `${mm.toFixed(1)} mm`;
        const c = document.createElement("canvas");
        c.width = 512; c.height = 128;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "rgba(15,23,42,0.9)";
        ctx.fillRect(0, 0, 512, 128);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 56px Arial,sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(text, 256, 80);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
        sp.scale.set(0.28, 0.07, 1);
        sp.position.copy(a).lerp(b, 0.5);
        measureGroup.add(sp);
        measureLabel = sp;
      }
      return;
    }
    if ((hit.kind === "mesh" || hit.kind === "drop") && !isUiPick(hit)) {
      const hoverMesh = cadHoverGrabMesh(hit);
      const mesh = pickTriggerMoveMesh(controller) || hoverMesh;
      if (!studioTriggerMovesModel({
        teleopArmed: isDimosTeleopArmed(),
        uiHit: false,
        cheapHit: hit.cheap === true && !mesh,
        meshHit: !!mesh,
        hoverCad: !!hoverMesh,
      })) return;
      if (activeTool === "scale") {
        beginOneHandScale(controller);
        return;
      }
      if (activeTool === "grab" || activeTool === "rotate" || !activeTool) {
        beginGrab(controller, mesh);
        noteGrabDebug({
          ev: "tr",
          hand,
          hit,
          acquired: !!grabState,
          why: grabState ? "cad" : (hit?.kind || "miss"),
        });
      }
    }
  }

  function controllerNearMesh(controller, maxDist = 0.35) {
    const mesh = getLiveMesh();
    if (!mesh || !controller) return false;
    try {
      mesh.updateMatrixWorld(true);
      controller.updateMatrixWorld(true);
      const box = contentBoxFromMesh(mesh);
      if (box.isEmpty()) return false;
      const tip = _v.setFromMatrixPosition(controller.matrixWorld);
      const closest = box.clampPoint(tip, _meshHit);
      return tip.distanceTo(closest) < maxDist;
    } catch {
      try {
        globalThis.dispatchEvent?.(new CustomEvent("studio-credit-incident", {
          detail: { eventType: "controller.error", note: "controllerNearMesh failed" },
        }));
      } catch (_) { /* stamp only */ }
      return false;
    }
  }

  function beginOneHandScale(controller) {
    const mesh = pickScaleMesh();
    if (!mesh || !controller) return;
    if (mesh.userData?.xrDropId && !publicDrops.canGrab(mesh.userData.xrDropId)) return;
    mesh.updateMatrixWorld(true);
    controller.updateMatrixWorld(true);
    const origin = new THREE.Vector3();
    mesh.getWorldPosition(origin);
    const tip = _panelNow.setFromMatrixPosition(controller.matrixWorld);
    noteDropInteract(mesh);
    publicDrops.setLocalGrabId(mesh.userData?.xrDropId || "");
    if (mesh.userData?.xrDropId) sendDropTransform(mesh, true, true);
    oneHandScale = {
      controller,
      target: mesh,
      origin,
      startDist: Math.max(0.06, tip.distanceTo(origin)),
      startScale: Math.abs(mesh.scale.x) || 1,
    };
    menuFooterHint = "Scaling · pull away to grow";
  }

  function updateOneHandScale() {
    if (isDimosTeleopArmed()) { oneHandScale = null; return; }
    if (!oneHandScale) return;
    const mesh = oneHandScale.target || pickScaleMesh();
    const { controller, origin, startDist, startScale } = oneHandScale;
    if (!mesh || !controller) {
      oneHandScale = null;
      publicDrops.setLocalGrabId("");
      return;
    }
    controller.updateMatrixWorld(true);
    const tip = _v.setFromMatrixPosition(controller.matrixWorld);
    const dist = Math.max(0.06, tip.distanceTo(origin));
    const next = startScale * (dist / startDist);
    const cur = Math.abs(mesh.scale.x) || 1;
    mesh.scale.multiplyScalar(next / cur);
    if (mesh.userData?.xrDropId) sendDropTransform(mesh, true);
    else {
      presentationScale = Math.abs(mesh.scale.x);
      notifyMeshMoved(true);
    }
  }

  function beginGrab(controller, targetMesh = null) {
    if (gripGrab || scaleGrab || grabState || panelDrag) return;
    blurXrDom();
    const mesh = resolveStudioGripTarget({
      hitMesh: targetMesh || pickGrabMesh(controller),
      liveMesh: getLiveMesh(),
    });
    if (!mesh) return;
    if (mesh.userData?.xrPrinterBounder && printerPlacement?.pinned === true) {
      menuFooterHint = "Print Box is pinned · select the pin icon to unlock";
      return;
    }
    try { xrSolidDraw.selectDrawable?.(mesh); } catch (_) {}
    const pose = grabAttachObject(squeezeHandIndex(controller)) || controller;
    pose.updateWorldMatrix(true, false);
    mesh.updateWorldMatrix(true, false);
    _grabInv.copy(pose.matrixWorld).invert();
    _grabWorld.multiplyMatrices(_grabInv, mesh.matrixWorld).decompose(_v, _q, _s);
    const dropId = mesh.userData?.xrDropId || "";
    noteDropInteract(mesh);
    if (!publicDrops.setLocalGrabId(dropId)) { menuFooterHint = 'Someone is holding this model'; return; }
    if (dropId) sendDropTransform(mesh, true, true);
    tossSamples.length = 0;
    sampleTossPoint(mesh);
    grabState = {
      mode: "grab", // always attach — pull toward you + tumble with the controller
      controller,
      pose,
      target: mesh,
      dropId,
      worldScale: mesh.scale.clone(),
      offsetPos: _v.clone(),
      offsetQuat: _q.clone(),
      scale: presentationScale || Math.abs(mesh.scale.x) || 1,
    };
  }

  let lastMeshMovedAt = 0;
  function notifyMeshMoved(moving) {
    const now = performance.now();
    if (moving && now - lastMeshMovedAt < 90) return;
    lastMeshMovedAt = now;
    saveRoomPose();
    try { onMeshMoved?.({ moving: !!moving }); } catch (_) {}
  }

  function endGrab(controller, { input = "trigger" } = {}) {
    if (input === "trigger") tabbedWindows?.release(controller);
    if (oneHandScale && (!controller || oneHandScale.controller === controller)) {
      const scaled = oneHandScale.target;
      oneHandScale = null;
      publicDrops.setLocalGrabId('');
      if (scaled?.userData?.xrDropId) sendDropTransform(scaled, false);
      else { saveRoomPose(); notifyMeshMoved(false); }
    }
    if (grabState?.controller === controller) {
      const dropped = grabState.target;
      grabState = null;
      publicDrops.setLocalGrabId("");
      if (dropped && shareAimTarget) {
        const vel = tossVelocityMps();
        if (vel.length() >= SHARE_THROW_MIN_SPEED && beginShareThrow(dropped, shareAimTarget)) {
          /* share-throw ghost owns the flight */
        } else if (shareAimTarget.kind === "printer" || shareAimTarget.id === "local-printer") {
          finishShareThrow(shareAimTarget);
        }
      } else if (dropped && maybeThrowAtPrinterBox(dropped)) {
        /* printer box ate the toss */
      } else if (dropped && !dropped.userData?.xrDropId && !dropped.userData?.xrDrawable && maybeTossAway(dropped)) {
        /* toss animation owns the mesh */
      } else if (dropped?.userData?.xrDrawId) sendDrawPose(dropped, false);
      else if (dropped?.userData?.xrDropId) sendDropTransform(dropped, false);
      else {
        saveRoomPose();
        notifyMeshMoved(false);
      }
    }
    if (panelDrag && (!input || !panelDrag.input || panelDrag.input === input)) {
      const sameHand = panelDragEndsOnRelease({
        panelDrag,
        released: controller,
        releasedHand: squeezeHandIndex(controller),
      });
      if (sameHand) {
        const groups = panelDrag.moveSet && panelDrag.setGroups?.length
          ? panelDrag.setGroups
          : [panelDrag.group];
        for (const group of groups) {
          if (!group) continue;
          try { group.userData.xrHudParked = true; } catch (_) {}
          if (!panelDrag.translateOnly) {
            try { group.userData.xrUserRotated = true; } catch (_) {}
          }
        }
        if (panelDrag.group === aiPanel?.group) {
          if (aiPanel) aiPanel.worldPlaced = true;
          savePanelPose("ai", panelDrag.group);
        }
        if (panelDrag.group === explorerPanel?.group) {
          if (explorerPanel) explorerPanel.worldPlaced = true;
          savePanelPose("menu", panelDrag.group);
        }
        if (panelDrag.group === viewPanel?.group) {
          if (viewPanel) viewPanel.worldPlaced = true;
          savePanelPose("view", panelDrag.group);
        }
        if (panelDrag.group === workspacePanel?.group) {
          if (workspacePanel) workspacePanel.worldPlaced = true;
          savePanelPose("workspace", panelDrag.group);
        }
        if (panelDrag.group === socialHubPanel?.group) {
          if (socialHubPanel) socialHubPanel.worldPlaced = true;
          savePanelPose("socialHub", panelDrag.group);
        }
        if (panelDrag.group === drawPanel?.group) {
          if (drawPanel) drawPanel.worldPlaced = true;
          savePanelPose("draw", panelDrag.group);
        }
        if (panelDrag.group === placePanel?.group) {
          if (placePanel) placePanel.worldPlaced = true;
          savePanelPose("place", panelDrag.group);
        }
        if (panelDrag.group === xrStudio?.group) {
          savePanelPose("studio", panelDrag.group);
        }
        if (panelDrag.group === xrSocialCard?.group) {
          savePanelPose("social", panelDrag.group);
        }
        if (panelDrag.group === toolWheel?.group) {
          try { toolWheel.markMoved?.(); } catch (_) {}
        }
        if (panelDrag.group === roboticsPanel?.group) {
          if (roboticsPanel) roboticsPanel.worldPlaced = true;
          savePanelPose("robotics", panelDrag.group);
        }
        if (panelDrag.moveSet) {
          try { saveOpenWindowsLayout(); } catch (_) {}
        }
        panelDrag = null;
      }
    }
  }

  function beginPanelDrag(controller, group, opts = {}) {
    if (opts.input !== "grip" && !xrHudClickStartsWindowDrag()) return;
    if ((group?.userData?.xrManagedWindow || group === tabbedWindows?.root) && !opts.workspaceHandle && opts.input !== "grip") return;
    group = tabbedWindows?.windowFor(group) || group;
    if (!group || !controller || panelDrag || gripGrab || grabState || scaleGrab) return;
    group.updateMatrixWorld(true);
    const hand = squeezeHandIndex(controller);
    const aim = (hand === 0 || hand === 1)
      ? (posedControllerForHand(hand) || controller)
      : controller;
    const gripNode = hand === 0 ? getLeftGrip() : hand === 1 ? getRightGrip() : null;
    const handNode = hand === 0 ? getLeftHand() : hand === 1 ? getRightHand() : null;
    const posedAim = opts.pose && objectIsPosed(opts.pose) ? opts.pose : (aim && objectIsPosed(aim))
      ? aim
      : (gripNode && objectIsPosed(gripNode))
        ? gripNode
        : (objectIsPosed(controller) ? controller : null);
    if (!posedAim) return;
    posedAim.updateMatrixWorld(true);
    _poseInv.copy(posedAim.matrixWorld).invert();
    _poseWorld.multiplyMatrices(_poseInv, group.matrixWorld);
    const op = new THREE.Vector3();
    const oq = new THREE.Quaternion();
    const os = new THREE.Vector3();
    _poseWorld.decompose(op, oq, os);
    panelDrag = {
      controller: posedAim,
      grip: gripNode || controller,
      aim: posedAim,
      handObj: handNode || null,
      pinch: (hand === 0 || hand === 1) ? pinchAnchors[hand] : null,
      group,
      offsetPos: op,
      offsetQuat: oq,
      startWorld: new THREE.Vector3().setFromMatrixPosition(posedAim.matrixWorld),
      startAimQuat: posedAim.getWorldQuaternion(new THREE.Quaternion()),
      startGroupPos: group.position.clone(),
      frozenQuat: group.quaternion.clone(),
      frozenScale: group.scale.clone(),
      translateOnly: panelDragTranslatesOnly(opts.input, opts.translateOnly),
      input: opts.input || "trigger",
      moveSet: opts.moveSet === true,
      setGroups: [],
      setStarts: [],
      setQuats: [],
      armed: opts.input === "grip",
      hand,
      sawHeld: false,
    };
    if (panelDrag.moveSet) {
      const rows = visibleWindowGroups();
      panelDrag.setGroups = rows.map((r) => r.group);
      panelDrag.setStarts = rows.map((r) => r.group.position.clone());
      panelDrag.setQuats = rows.map((r) => r.group.quaternion.clone());
    }
    try { group.userData.xrHudParked = true; } catch (_) {}
    // Do not re-walk overlay materials on drag — flags are set at mesh create.
  }

  function updatePanelDrag() {
    if (!panelDrag?.group) return;
    const { controller, group } = panelDrag;
    if (!controller || !objectIsPosed(controller)) return;
    controller.updateMatrixWorld(true);
    _panelNow.setFromMatrixPosition(controller.matrixWorld);
    // Click vs drag: a trigger tap on a button must not slide the window.
    if (!panelDrag.armed) {
      const rotated = !panelDrag.translateOnly && panelDrag.startAimQuat.angleTo(controller.getWorldQuaternion(_q)) > 0.08;
      if (_panelNow.distanceTo(panelDrag.startWorld) < 0.03 && !rotated) return;
      panelDrag.startWorld.copy(_panelNow);
      panelDrag.startGroupPos.copy(group.position);
      panelDrag.frozenQuat.copy(group.quaternion);
      panelDrag.armed = true;
      try { group.userData.xrHudParked = true; } catch (_) {}
      if (!panelDrag.translateOnly) {
        try { group.userData.xrUserRotated = true; } catch (_) {}
      }
    }
    if (panelDrag.moveSet && panelDrag.setGroups?.length) {
      const delta = _panelNow.sub(panelDrag.startWorld);
      panelDrag.setGroups.forEach((g, i) => {
        if (!g) return;
        const start = panelDrag.setStarts[i];
        const quat = panelDrag.setQuats[i];
        if (start) g.position.copy(start).add(delta);
        if (quat) g.quaternion.copy(quat);
        g.scale.set(1, 1, 1);
        try { g.userData.xrHudParked = true; } catch (_) {}
      });
      return;
    }
    if (panelDrag.resize) {
      const nowDist = _panelNow.distanceTo(panelDrag.startWorld) + Number(panelDrag.startCornerDist || 0.2);
      const next = panelResizeScale({
        startScale: panelDrag.startScale,
        startCornerDist: panelDrag.startCornerDist,
        nowCornerDist: nowDist,
      });
      group.scale.setScalar(next);
      return;
    }
    if (panelDrag.translateOnly) {
      group.position.copy(panelDrag.startGroupPos).add(_panelNow.sub(panelDrag.startWorld));
      group.quaternion.copy(panelDrag.frozenQuat);
      group.scale.copy(panelDrag.frozenScale);
      return;
    }
    const { offsetPos, offsetQuat } = panelDrag;
    const next = _grabNext.compose(offsetPos, offsetQuat, _grabOne);
    const world = _grabWorld.multiplyMatrices(controller.matrixWorld, next);
    if (group.parent) {
      group.parent.updateWorldMatrix(true, false);
      _grabInv.copy(group.parent.matrixWorld).invert();
      _grabNext.multiplyMatrices(_grabInv, world).decompose(group.position, group.quaternion, _s);
    } else {
      world.decompose(group.position, group.quaternion, _s);
    }
  }

  function isTextEntryEl(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    const tag = String(el.tagName || "").toUpperCase();
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    return !!el.isContentEditable;
  }

  function blurXrDom() {
    const now = performance.now();
    if (now - lastBlurXrDomAt < 450) return;
    lastBlurXrDomAt = now;
    try {
      const el = document.activeElement;
      if (isTextEntryEl(el) && typeof el.blur === "function") el.blur();
      document.getElementById("prompt-input")?.blur?.();
      document.getElementById("wiring-prompt-input")?.blur?.();
      document.getElementById("prompt-image-drop")?.blur?.();
      window.getSelection?.()?.removeAllRanges?.();
      navigator.virtualKeyboard?.hide?.();
    } catch (_) {}
  }

  let xrDomFocusGuard = null;
  const xrLockedFields = [];

  function xrBlockDomTextTarget(el) {
    if (!el) return false;
    if (isTextEntryEl(el)) return true;
    return !!el.closest?.("input, textarea, select, [contenteditable='true'], #prompt-input, #prompt-pane-compose, .prompt-compose");
  }

  function xrIsCanvasTarget(el) {
    const canvas = renderer?.domElement;
    if (!canvas || !el) return false;
    try {
      return el === canvas || canvas.contains?.(el) === true;
    } catch {
      return false;
    }
  }

  function xrDomFocusGuardFn(e) {
    if (!presenting) return;
    const t = e.target;
    if (shouldLetXrSelectReachDomTarget({ presenting: true, isXrCanvas: xrIsCanvasTarget(t) })) return;
    try { e.stopImmediatePropagation?.(); } catch (_) {}
    try { t.blur?.(); } catch (_) {}
    blurXrDom();
  }

  function xrDomPointerGuardFn(e) {
    if (!presenting) return;
    if (shouldLetXrSelectReachDomTarget({
      presenting: true,
      isXrCanvas: xrIsCanvasTarget(e.target),
    })) return;
    try { e.preventDefault(); } catch (_) {}
    try { e.stopImmediatePropagation?.(); } catch (_) {}
    try { e.stopPropagation(); } catch (_) {}
    try { e.target?.blur?.(); } catch (_) {}
    blurXrDom();
  }

  let xrDomLocked = false;

  function installXrDomGuards() {
    if (xrDomFocusGuard) return;
    xrDomFocusGuard = true;
    document.addEventListener("focusin", xrDomFocusGuardFn, true);
    document.addEventListener("pointerdown", xrDomPointerGuardFn, true);
    document.addEventListener("mousedown", xrDomPointerGuardFn, true);
    document.addEventListener("click", xrDomPointerGuardFn, true);
    document.addEventListener("touchstart", xrDomPointerGuardFn, true);
  }

  function lockDomForXr() {
    if (xrDomLocked) return;
    xrDomLocked = true;
    blurXrDom();
    installXrDomGuards();
    xrLockedFields.length = 0;
    try {
      document.querySelectorAll("input, textarea, select, [contenteditable='true']").forEach((el) => {
        xrLockedFields.push({
          el,
          readOnly: el.readOnly,
          inputMode: el.inputMode,
          tabIndex: el.tabIndex,
          contentEditable: el.getAttribute("contenteditable"),
        });
        try {
          if ("readOnly" in el) el.readOnly = true;
          el.inputMode = "none";
          el.tabIndex = -1;
          if (el.isContentEditable) el.setAttribute("contenteditable", "false");
        } catch (_) {}
      });
    } catch (_) {}
  }

  function unlockDomForXr() {
    xrDomLocked = false;
    // CSS uses body.xr-presenting { #right-panel-stack { pointer-events: none } }.
    // If this class sticks after session end, Robot / Activate / Controls go dead on desktop.
    try { document.body.classList.remove("xr-presenting"); } catch (_) {}
    if (xrDomFocusGuard) {
      document.removeEventListener("focusin", xrDomFocusGuardFn, true);
      document.removeEventListener("pointerdown", xrDomPointerGuardFn, true);
      document.removeEventListener("mousedown", xrDomPointerGuardFn, true);
      document.removeEventListener("click", xrDomPointerGuardFn, true);
      document.removeEventListener("touchstart", xrDomPointerGuardFn, true);
      xrDomFocusGuard = null;
    }
    for (const rec of xrLockedFields) {
      const el = rec.el;
      if (!el) continue;
      try {
        if ("readOnly" in el) el.readOnly = rec.readOnly;
        el.inputMode = rec.inputMode;
        el.tabIndex = rec.tabIndex;
        if (rec.contentEditable != null) el.setAttribute("contenteditable", rec.contentEditable);
      } catch (_) {}
    }
    xrLockedFields.length = 0;
  }

  function xrIndexOf(obj) {
    if (!obj) return -1;
    const ci = controllers.indexOf(obj);
    if (ci >= 0) return ci;
    const gi = grips.indexOf(obj);
    if (gi >= 0) return gi;
    return hands.indexOf(obj);
  }

  function copyWorldPose(from, to) {
    if (!from || !to) return;
    from.updateMatrixWorld(true);
    from.getWorldPosition(to.position);
    from.getWorldQuaternion(to.quaternion);
    to.scale.set(1, 1, 1);
    to.updateMatrixWorld(true);
  }

  /**
   * Left/right from the *live* input source. Never treat array index 0 as left —
   * Quest reorders inputSources so the squeezing right Touch is often slot 0.
   */
  function squeezeHandIndex(target) {
    if (!target) return -1;
    bindHandednessFromSession();
    const live = liveHandednessAlong(target);
    if (live === "left") return 0;
    if (live === "right") return 1;
    if (target === pinchAnchors[0]) return 0;
    if (target === pinchAnchors[1]) return 1;
    const leftG = getLeftGrip();
    const rightG = getRightGrip();
    const leftH = getLeftHand();
    const rightH = getRightHand();
    if (target === leftG || target === leftH) return 0;
    if (target === rightG || target === rightH) return 1;
    let o = target;
    for (let n = 0; n < 8 && o; n += 1) {
      if (o === leftG || o === leftH) return 0;
      if (o === rightG || o === rightH) return 1;
      o = o.parent;
    }
    const i = xrIndexOf(target);
    if (i >= 0) {
      const sess = renderer.xr.getSession?.();
      const source = connectedSourceForSlot(controllers, i);
      let hasLeft = false;
      let hasRight = false;
      try {
        for (const s of sess?.inputSources || []) {
          if (s?.handedness === "left") hasLeft = true;
          if (s?.handedness === "right") hasRight = true;
        }
      } catch (_) {}
      const inferred = xrSourceHandIndex(source, {
        hasLeft,
        hasRight,
        fallback: unlabeledTriggerHandIndex({
          hasLabeledPhysicalLeft: hasLeft,
          hasLabeledPhysicalRight: hasRight,
        }),
      });
      if (inferred === 0 || inferred === 1) return inferred;
      // Connected XR node with dropped handedness — never leave the aiming Touch as -1.
      return 1;
    }
    const stamped = target.userData?.handedness;
    if (stamped === "left") return 0;
    if (stamped === "right") return 1;
    return -1;
  }

  function posedControllerForHand(handIndex) {
    bindHandednessFromSession();
    const want = handIndex === 0 ? "left" : "right";
    const idx = sessionIndexForHand(want);
    if (idx >= 0 && controllers[idx]) {
      syncControllerAimFromXrFrame(controllers[idx], idx);
      if (objectIsPosed(controllers[idx])) return controllers[idx];
    }
    return null;
  }

  /** Physical Touch: grip space (the handle you twist). Hands: pinch midpoint. */
  function grabAttachObject(handIndex, sampled) {
    if (handIndex !== 0 && handIndex !== 1) return null;
    bindHandednessFromSession();
    const s = sampled || sampleXrHands();
    const physical = !!s.hasController[handIndex];
    if (!physical) {
      const pinch = pinchAnchors[handIndex];
      if (pinch && pinch.visible && objectIsPosed(pinch)) return pinch;
      const hand = handIndex === 0 ? getLeftHand() : getRightHand();
      if (hand && objectIsPosed(hand)) {
        if (handIndex === 0 && isDefinitelyRight(hand)) return null;
        if (handIndex === 1 && liveHandednessAlong(hand) === "left") return null;
        return hand;
      }
    }
    const grip = handIndex === 0 ? getLeftGrip() : getRightGrip();
    if (grip && objectIsPosed(grip)) {
      if (handIndex === 0 && isDefinitelyRight(grip)) return null;
      if (handIndex === 1 && liveHandednessAlong(grip) === "left") return null;
      return grip;
    }
    const c = posedControllerForHand(handIndex);
    if (c && objectIsPosed(c)) {
      if (handIndex === 0 && isDefinitelyRight(c)) return null;
      if (handIndex === 1 && liveHandednessAlong(c) === "left") return null;
      return c;
    }
    return null;
  }

  function latchSqueeze(target, held) {
    if (!target) return;
    const hi = squeezeHandIndex(target);
    if (hi === 0 || hi === 1) squeezeHeld[hi] = !!held;
  }

  function panelGroupFromHit(hit) {
    if (!hit?.kind) return null;
    if (hit.source === "wrist") return null;
    if (hit.kind === "ai-drag" || hit.kind === "ai-action" || hit.kind === "ai-rotate") {
      return hit.id === "hide" ? null : aiPanel?.group;
    }
    if (hit.kind === "view-drag" || hit.kind === "view-action" || hit.kind === "view-chrome" || hit.kind === "view-rotate") {
      return hit.id === "hide" ? null : viewPanel?.group;
    }
    if (hit.kind === "workspace-drag" || hit.kind === "workspace-action" || hit.kind === "workspace-chrome") {
      return hit.id === "hide" ? null : workspacePanel?.group;
    }
    if (hit.kind === "share-sheet-drag" || hit.kind === "share-sheet-action" || hit.kind === "share-sheet-chrome") {
      return hit.id === "hide" ? null : sharePanel?.group;
    }
    if (hit.kind === "avatar-drag" || hit.kind === "avatar-action" || hit.kind === "avatar-chrome") {
      return hit.id === "hide" ? null : avatarPanel?.group;
    }
    if (hit.kind === "share-invite-drag" || hit.kind === "share-invite-action" || hit.kind === "share-invite-chrome") {
      return hit.id === "hide" ? null : shareInvitePanel?.group;
    }
    if (hit.kind === "print-settings-drag" || hit.kind === "print-settings-action" || hit.kind === "print-settings-chrome") {
      return hit.id === "print-cancel" ? null : printSettingsPanel?.group;
    }
    if (hit.kind === "wheel-drag") return toolWheel?.group;
    if (hit.kind === "share-video-drag" || hit.kind === "share-video-menu" || hit.kind === "share-video-action"
      || hit.kind === "share-video-hide" || hit.kind === "share-video-curve" || hit.kind === "share-video-anchor"
      || hit.kind === "share-video-resize") {
      return sharedVideo?.group;
    }
    if (isXrSceneWindowHitKind(hit.kind)) {
      return sceneWindows[hit.winId === "display" ? "display" : "browser"]?.group;
    }
    if (hit.kind === "grid-drag" || hit.kind === "grid-action" || hit.kind === "grid-chrome" || hit.kind === "grid-rotate") {
      return hit.id === "hide" ? null : gridPanelRef(hit.panel)?.group;
    }
    if (hit.kind === "robotics-drag" || hit.kind === "robotics-action" || hit.kind === "robotics-chrome" || hit.kind === "robotics-rotate") {
      return hit.id === "hide" ? null : roboticsPanel?.group;
    }
    if (hit.kind === "howto-drag" || hit.kind === "howto-next" || hit.kind === "howto-done") {
      return howtoPanel?.group;
    }
    if (hit.kind === "guides-drag" || hit.kind === "guides-action" || hit.kind === "guides-clip" || hit.kind === "guides-chrome") {
      return hit.id === "hide" ? null : guidesPanel?.group;
    }
    if (hit.kind === "explorer-drag" || hit.kind === "menu-row" || hit.kind === "menu-tab" || hit.kind === "menu-chrome" || hit.kind === "menu-action" || hit.kind === "menu-rotate") {
      return explorerPanel?.group;
    }
    if (hit.kind === "place" || hit.kind === "place-drag") return placePanel?.group;
    if (hit.kind === "studio-drag" || hit.kind === "studio-tab" || hit.kind === "studio-row" || hit.kind === "studio-chrome" || hit.kind === "studio-action" || hit.kind === "studio-rotate") {
      return xrStudio?.group;
    }
    if (hit.kind === "social-card" && hit.action !== "close") return xrSocialCard?.group;
    if (hit.kind === "hand-cam-drag" || hit.kind === "hand-cam-resize") {
      return handCamWindows?.[hit.side]?.group || null;
    }
    if (hit.kind === "hand-cam-hide" || hit.kind === "hand-cam-hover") return null;
    return null;
  }

  function handCamGroupFromPointer(pointer) {
    if (!handCamWindows) return null;
    if (readHandCamPrefs().camMode !== "detach") return null;
    const wins = handCamWindows;
    if (!pointer || typeof raycaster === "undefined") return null;
    try {
      pointer.updateMatrixWorld?.(true);
      raycaster.setFromXRController?.(pointer);
    } catch {
      return null;
    }
    const meshes = [wins.left.mesh, wins.right.mesh, wins.left.handle, wins.right.handle].filter(Boolean);
    const hits = raycaster.intersectObjects(meshes, true);
    const first = hits[0]?.object;
    if (!first) return null;
    const side = first.userData?.xrHandCam || first.userData?.xrHandCamResize;
    const win = side ? wins[side] : null;
    if (!win?.group?.visible) return null;
    if (win) win.group.userData.xrHandCamDetached = true;
    if (first.userData?.xrHandCamResize && win) {
      const next = clampHandCamSize(win.size.w + 0.02, win.size.h + 0.012);
      win.size = next;
      win.group.scale.set(next.w / HAND_CAM_WRIST_SIZE.w, next.h / HAND_CAM_WRIST_SIZE.h, 1);
    }
    return win?.group || null;
  }

  function noteGrabDebug({ ev = "sq", hand = -1, hit = null, acquired = false, why = "" } = {}) {
    const h = hand === 0 ? "l" : hand === 1 ? "r" : "u";
    const kind = String(hit?.kind || why || "miss").slice(0, 16);
    const consume = acquired ? "cad" : (isXrChromeKind(kind) || kind.endsWith("-chrome") ? "chrome" : kind);
    lastXrControlEv = String(ev || "sq").slice(0, 8);
    lastXrHand = h;
    lastXrConsume = consume;
    try {
      xrDevStats.keepRecording?.();
      xrDevStats.noteEvent?.(lastXrControlEv, {
        h,
        consume,
        t: performance.now(),
      });
    } catch (_) {}
    if (debuggerOpen) {
      try {
        if (debuggerHud?.group) debuggerHud.group.visible = true;
      } catch (_) {}
    }
  }

  function controlsInteractionDebug() {
    const pose = (node) => {
      if (!node || !objectIsPosed(node)) return null;
      node.updateWorldMatrix?.(true, false);
      const position = new THREE.Vector3();
      const rotation = new THREE.Quaternion();
      node.getWorldPosition(position);
      node.getWorldQuaternion(rotation);
      return [...position.toArray(), ...rotation.toArray()];
    };
    const detail = {};
    for (const hand of [0, 1]) {
      const aim = posedControllerForHand(hand);
      const grip = hand === 0 ? getLeftGrip() : getRightGrip();
      const cached = pickCache.get(aim?.id || aim?.uuid || "c");
      detail[hand === 0 ? "l" : "r"] = {
        aim: pose(aim), grip: pose(grip),
        hit: cached?.gen === pickFrameGen ? (xrControlsUiTag(cached.hit) || "miss") : "unposed",
        ...lastNearGrip[hand],
        held: panelDrag?.hand === hand ? "window" : gripGrab?.hand === hand ? "model" : "none",
      };
    }
    return detail;
  }

  function nearGripPanel(controller) {
    if (!controller || !objectIsPosed(controller)) return null;
    const windows = visibleWindowGroups().map((row) => row.group);
    if (tabbedWindows?.root.visible) windows.push(tabbedWindows.root);
    windows.push(sharePanel?.group, shareInvitePanel?.group, printSettingsPanel?.group, sharedVideo?.group,
      howtoPanel?.group, xrSocialCard?.group, toolWheel?.group);
    if (!debuggerOpen) windows.push(debuggerHud?.group);
    if (readHandCamPrefs().camMode === "detach") {
      windows.push(handCamWindows?.left?.group, handCamWindows?.right?.group);
    }
    const hit = pickNearSurface(worldPosOf(controller), windows.filter(Boolean));
    const hand = squeezeHandIndex(controller);
    if (hand >= 0) lastNearGrip[hand] = { near: hit ? "window" : "miss", distance: hit?.distance };
    return hit?.target || null;
  }

  function viserOpenArmGripAllowed() {
    return !viserRobotGripBlocked({ walkHeld: roomWalkHeld, hoverKind: lastPointerHoverHit?.kind });
  }

  function studioGripAim(controller, hand) {
    const pointer = posedControllerForHand(hand) || controller;
    const grip = grabAttachObject(hand) || controller;
    return resolveSelectAim({
      pointer,
      grip,
      pointerPosed: objectIsPosed(pointer),
      gripPosed: objectIsPosed(grip),
    }) || pointer || grip || controller;
  }

  function tryBeginPanelGrip(controller) {
    if (panelDrag || gripGrab || grabState || scaleGrab) return false;
    const hand = squeezeHandIndex(controller);
    const src = grabAttachObject(hand) || controller;
    const aim = studioGripAim(controller, hand);
    const hit = pickWithController(aim || posedControllerForHand(hand) || controller);
    // HUD planes / fat *-drag overlays in front of the model must not eat squeeze.
    const cad = pickNearGrabMesh(src) || pickTriggerMoveMesh(aim) || cadHoverGrabMesh(hit);
    if (cad) return false;
    const header = !isXrSqueezeOverlayKind(hit?.kind, hit) && (
      (hit?.kind === "viewport-tab" && hit.action === "move")
      || isXrPanelGripHandleKind(hit?.kind)
    );
    const group = header
      ? (hit?.group || panelGroupFromHit(hit))
      : nearGripPanel(src);
    if (!group?.visible) return false;
    // A squeeze while pressing a menu button must not acquire the whole workspace.
    if ((group.userData?.xrManagedWindow || group === tabbedWindows?.root) && !header) return false;
    beginPanelDrag(src, group, {
      translateOnly: panelGripTranslateOnly(),
      pose: src,
      input: "grip",
      workspaceHandle: hit?.kind === "viewport-tab" && hit.action === "move",
    });
    return !!panelDrag;
  }

  // Three dispatches the same squeeze on grip and target-ray nodes; polling
  // retries CAD while the grip is held. A first-frame miss must not AND-gate
  // squeeze behind a later trigger press.
  function startStudioGrip(controller) {
    const hand = squeezeHandIndex(controller);
    if (hand < 0) return;
    if (gripGrab?.hand === hand || (panelDrag?.input === "grip" && panelDrag.hand === hand)) {
      gripPressActive[hand] = true;
      return;
    }
    const already = !!gripPressActive[hand];
    gripPressActive[hand] = true;
    if (gripGrab && gripGrab.hand !== hand) {
      if (already) return;
      gripScaleContact[hand] = null;
      const src = grabAttachObject(hand) || controller;
      if (src && objectIsPosed(src)
        && (pickNearSurface(worldPosOf(src), [gripGrab.target])
          || pickTriggerMoveMesh(posedControllerForHand(hand) || controller) === gripGrab.target)) gripScaleContact[hand] = gripGrab.target;
      return;
    }
    if (already) {
      if (!panelDrag && !scaleGrab && !grabState) startGripGrabOn(controller);
      return;
    }
    gripScaleContact[hand] = null;
    if (agentAvatar.beginGrip(hand, grabAttachObject(hand) || controller)) return;
    if (roomCameraView.beginGrip(hand, grabAttachObject(hand) || controller, posedControllerForHand(hand) || controller)) return;
    if (tryBeginPanelGrip(controller)) return;
    const src = grabAttachObject(hand) || controller;
    const aim = posedControllerForHand(hand) || controller;
    if (roboticsWorkspace.beginGrip(hand, src, aim, {
      walkHeld: roomWalkHeld,
      allowRobot: viserOpenArmGripAllowed(),
      contactOrigin: src && objectIsPosed(src) ? worldPosOf(src) : null,
    })) return;
    if (xrWiringView.isActive() && xrWiringView.beginGrip(hand, grabAttachObject(hand) || controller)) return;
    if (panelDrag) return;
    if (aiDrawWorkspace.beginGrip(hand, grabAttachObject(hand) || controller)) return;
    startGripGrabOn(controller);
  }

  function finishStudioGrip(controller) {
    const hand = squeezeHandIndex(controller);
    if (hand < 0) return;
    gripPressActive[hand] = false;
    gripScaleContact[hand] = null;
    if (roomCameraView.endGrip(hand)) return;
    if (roboticsWorkspace.endGrip(hand)) return;
    if (agentAvatar.endGrip(hand)) return;
    if (xrWiringView.endGrip(hand)) return;
    if (aiDrawWorkspace.endGrip(hand)) return;
    if (panelDrag?.input === "grip") endGrab(controller, { input: "grip" });
    releaseGripGrab(controller);
  }

  function startGripGrabOn(obj) {
    blurXrDom();
    if (scaleGrab || gripGrab || grabState || panelDrag) return;
    const hand = squeezeHandIndex(obj);
    if (hand < 0) return;
    const src = grabAttachObject(hand) || obj;
    if (!src || !objectIsPosed(src)) return;
    const aim = studioGripAim(obj, hand);
    const hover = pickWithController(aim);
    const hoverMesh = cadHoverGrabMesh(hover);
    const mesh = resolveStudioGripTarget({
      hitMesh: pickNearGrabMesh(src) || pickTriggerMoveMesh(aim) || hoverMesh,
      liveMesh: getLiveMesh(),
    });
    noteGrabDebug({
      ev: "sq",
      hand,
      hit: hover,
      acquired: !!mesh,
      why: mesh ? "cad" : (hover?.kind ? String(hover.kind) : "miss"),
    });
    if (!mesh) return;
    if (mesh.userData?.xrPrinterBounder && printerPlacement?.pinned === true) {
      menuFooterHint = "Print Box is pinned · select the pin icon to unlock";
      return;
    }
    try { xrSolidDraw.selectDrawable?.(mesh); } catch (_) {}
    copyWorldPose(src, gripGrabAnchor);
    mesh.updateMatrixWorld(true);
    _grabInv.copy(gripGrabAnchor.matrixWorld).invert();
    _grabWorld.multiplyMatrices(_grabInv, mesh.matrixWorld).decompose(_v, _q, _s);
    grabState = null;
    const dropId = mesh.userData?.xrDropId || "";
    if (!publicDrops.setLocalGrabId(dropId)) { menuFooterHint = 'Someone is holding this model'; return; }
    if (dropId) sendDropTransform(mesh, true, true);
    tossSamples.length = 0;
    sampleTossPoint(mesh);
    gripGrab = {
      hand,
      controller: gripGrabAnchor,
      target: mesh,
      dropId,
      worldScale: mesh.scale.clone(),
      offsetPos: _v.clone(),
      offsetQuat: _q.clone(),
      scale: presentationScale || Math.abs(mesh.scale.x) || 1,
    };
  }

  function releaseGripGrab(obj) {
    if (!gripGrab) return;
    const hi = squeezeHandIndex(obj);
    if (obj && hi >= 0 && gripGrab.hand !== hi) return;
    const slicerId = slicerPreview?.partIdFromObject?.(gripGrab.target);
    if (slicerId) {
      const layout = slicerPreview.getLayout();
      const part = (layout?.parts || []).find((p) => p.id === slicerId);
      const mesh = gripGrab.target;
      if (part && mesh) {
        const plate = (layout.plates || []).find((p) => Number(p.id) === Number(part.plate_id));
        const ox = Number(plate?.origin_mm?.[0] || 0);
        const oy = Number(plate?.origin_mm?.[1] || 0);
        const old = part.center_mm || [128, 128, 5];
        const cx = mesh.position.x / SLICER_MM_TO_M - ox;
        const cy = mesh.position.z / SLICER_MM_TO_M - oy;
        void postSlicerLayout({
          action: "move",
          part_ids: [slicerId],
          dx_mm: cx - Number(old[0] || 0),
          dy_mm: cy - Number(old[1] || 0),
        }).catch(() => {});
      }
      gripGrab = null;
      return;
    }
    if (scaleGrab?.target === gripGrab.target) {
      // The scale transition transfers ownership to whichever hand remains
      // down. Releasing one resize hand is not a throw/drop of the model.
      gripGrab = null;
      return;
    }
    const dropped = gripGrab.target;
    persistPrinterBounderFromMesh(dropped);
    publicDrops.setLocalGrabId("");
    if (dropped && shareAimTarget) {
      const vel = tossVelocityMps();
      if (vel.length() >= SHARE_THROW_MIN_SPEED && beginShareThrow(dropped, shareAimTarget)) {
        /* share-throw ghost owns the flight */
      } else if (shareAimTarget.kind === "printer" || shareAimTarget.id === "local-printer") {
        finishShareThrow(shareAimTarget);
      }
    } else if (dropped && maybeThrowAtPrinterBox(dropped)) {
      /* printer box ate the toss */
    } else if (dropped && !dropped.userData?.xrDropId && !dropped.userData?.xrDrawable && maybeTossAway(dropped)) {
      /* toss animation owns the mesh */
    } else if (dropped?.userData?.xrDrawId) sendDrawPose(dropped, false);
    else if (dropped?.userData?.xrDropId) sendDropTransform(dropped, false);
    else saveRoomPose();
    gripGrab = null;
  }

  function pointerFromSessionSelect(ev) {
    const source = ev?.inputSource;
    if (!sessionSelectEventShouldClick({ hasSource: !!source })) return null;
    const sess = renderer.xr.getSession?.();
    let hasLeft = false;
    let hasRight = false;
    try {
      for (const s of sess?.inputSources || []) {
        if (s?.handedness === "left") hasLeft = true;
        if (s?.handedness === "right") hasRight = true;
      }
    } catch (_) {}
    const idx = controllerSlotForSource(controllers, source);
    const hi = xrSourceHandIndex(source, {
      hasLeft,
      hasRight,
      fallback: inferHandIndexForSource(source, idx),
    });
    const hand = hi >= 0 ? hi : (idx === 0 || idx === 1 ? idx : -1);
    if (hand === 0 || hand === 1) {
      return resolveSelectAim({
        pointer: posedControllerForHand(hand) || aimPointer(hand),
        grip: hand === 0 ? getLeftGrip() : getRightGrip(),
        pointerPosed: objectIsPosed(posedControllerForHand(hand) || aimPointer(hand)),
        gripPosed: objectIsPosed(hand === 0 ? getLeftGrip() : getRightGrip()),
      }) || aimPointer(hand) || fallbackSelectPointer(hand);
    }
    return posedControllerForHand(1) || aimPointer(1) || fallbackSelectPointer(1) || null;
  }

  function studioSelectEventAllowed(source, { start = false } = {}) {
    if (!isDimosTeleopArmed()) return !source?.gamepad || mappedButtonIndex("trigger") === 0;
    // Quest may synthesize WebXR select events for A/B. While DimOS owns the
    // face buttons, only a physically depressed xr-standard trigger may click
    // Studio UI. Release events remain allowed so grabs and UI latches clean up.
    return !start || xrGamepadTriggerPressed(source?.gamepad);
  }

  function onSessionSelectStart(ev) {
    if (!studioSelectEventAllowed(ev?.inputSource, { start: true })) return;
    const pointer = pointerFromSessionSelect(ev);
    if (!pointer) return;
    const hand = squeezeHandIndex(pointer);
    const grip = hand === 0 ? getLeftGrip() : hand === 1 ? getRightGrip() : null;
    const aimHit = pickWithController(pointer);
    const gripHit = grip && grip !== pointer ? pickWithController(grip) : null;
    const hit = selectHitFromAimOrGrip({ aimHit, gripHit });
    if (studioUiOverridesDimosSelect({
      uiHit: isUiPick(hit),
      nearMenu: false,
      rayOnMenu: isUiPick(hit),
    })) {
      // Claim this physical trigger before DimOS samples the next Joy frame.
      // Ownership remains per-hand until selectend/physical release.
      reserveDimosMenuTrigger(ev?.inputSource?.handedness);
      try { ev.stopImmediatePropagation?.(); } catch (_) {}
    }
    handleSelect(pointer);
  }

  function onSessionSelectEnd(ev) {
    if (!studioSelectEventAllowed(ev?.inputSource)) return;
    releaseDimosMenuTrigger(ev?.inputSource?.handedness);
    uiSelectPress.release(ev?.inputSource?.handedness === "left" ? 0 : ev?.inputSource?.handedness === "right" ? 1 : -1);
    const pointer = pointerFromSessionSelect(ev);
    if (!pointer) return;
    finishGuidesSwipe(pointer);
    endGrab(pointer);
  }

  function detachSessionSelect(sess) {
    try { sess?.removeEventListener("selectstart", onSessionSelectStart); } catch (_) {}
    try { sess?.removeEventListener("selectend", onSessionSelectEnd); } catch (_) {}
  }

  function bindSelectOn(obj) {
    if (!obj) return;
    obj.addEventListener("selectstart", (e) => {
      if (!studioSelectEventAllowed(e.data || e.target?.userData?.inputSource, { start: true })) return;
      const target = e.target;
      const hand = squeezeHandIndex(target);
      const pointer = (hand === 0 || hand === 1)
        ? resolveSelectAim({
            pointer: posedControllerForHand(hand) || aimPointer(hand),
            grip: hand === 0 ? getLeftGrip() : getRightGrip(),
            pointerPosed: objectIsPosed(posedControllerForHand(hand) || aimPointer(hand)),
            gripPosed: objectIsPosed(hand === 0 ? getLeftGrip() : getRightGrip()),
          }) || fallbackSelectPointer(hand) || target
        : target;
      const grip = hand === 0 ? getLeftGrip() : hand === 1 ? getRightGrip() : null;
      const aimHit = pickWithController(pointer);
      const gripHit = grip && grip !== pointer ? pickWithController(grip) : null;
      const hit = selectHitFromAimOrGrip({ aimHit, gripHit });
      if (selectStartShouldCommit({ isUi: isUiPick(hit) })) handleSelect(pointer);
    });
    obj.addEventListener("select", (e) => {
      if (!studioSelectEventAllowed(e.data || e.target?.userData?.inputSource)) return;
      // WebXR `select` fires on release (after selectend on Quest). Never
      // handleSelect here — that re-grabbed menus after the trigger was up.
      const hand = squeezeHandIndex(e.target);
      uiSelectPress.release(hand);
      const pointer = (hand === 0 || hand === 1)
        ? (posedControllerForHand(hand) || e.target)
        : e.target;
      finishGuidesSwipe(pointer);
      endGrab(pointer);
    });
    obj.addEventListener("selectend", (e) => {
      if (!studioSelectEventAllowed(e.data || e.target?.userData?.inputSource)) return;
      const hand = squeezeHandIndex(e.target);
      uiSelectPress.release(hand);
      releaseDimosMenuTrigger(hand === 0 ? "left" : hand === 1 ? "right" : "");
      const pointer = (hand === 0 || hand === 1)
        ? (posedControllerForHand(hand) || e.target)
        : e.target;
      finishGuidesSwipe(pointer);
      endGrab(pointer);
    });
  }

  function ensureControllerPickLaser(controller) {
    if (!controller) return { ray: null, tip: null };
    let ray = controller.getObjectByName("xrRay");
    let tip = controller.getObjectByName("xrRayTip");
    if (!ray) {
      const rayGeo = new THREE.CylinderGeometry(XR_POINTER_BEAM_RADIUS_M, XR_POINTER_BEAM_RADIUS_M, 1, 6);
      rayGeo.translate(0, 0.5, 0);
      rayGeo.rotateX(-Math.PI / 2);
      ray = new THREE.Mesh(
        rayGeo,
        new THREE.MeshBasicMaterial({
          color: 0xbae6fd,
          transparent: true,
          opacity: 0.92,
          depthTest: false,
          depthWrite: false,
        }),
      );
      ray.name = "xrRay";
      ray.renderOrder = XR_LASER_OVER_UI_ORDER;
      ray.frustumCulled = false;
      ray.visible = false;
      ray.scale.z = XR_LASER_MIN_M;
      try { disableXrPointerRaycast(ray); } catch (_) {}
      controller.add(ray);
    }
    if (!tip) {
      tip = new THREE.Mesh(
        new THREE.SphereGeometry(XR_POINTER_RADIUS_M, 10, 8),
        new THREE.MeshBasicMaterial({
          color: 0x7dd3fc,
          depthTest: false,
          depthWrite: false,
        }),
      );
      tip.name = "xrRayTip";
      tip.visible = false;
      tip.position.z = -XR_LASER_MIN_M;
      tip.renderOrder = XR_LASER_OVER_UI_ORDER + 1;
      tip.frustumCulled = false;
      try { disableXrPointerRaycast(tip); } catch (_) {}
      tip.userData.pointerDot = tip.geometry;
      tip.userData.pointerPoint = new THREE.ConeGeometry(XR_POINTER_RADIUS_M, 0.006, 8);
      tip.userData.pointerPoint.rotateX(-Math.PI / 2);
      controller.add(tip);
    }
    try { disableXrPointerRaycast(ray); } catch (_) {}
    try { disableXrPointerRaycast(tip); } catch (_) {}
    return { ray, tip };
  }

  function setupControllers() {
    if (!shouldSetupXrControllers(renderer)) return;
    for (let i = 0; i < 2; i += 1) {
      const controller = renderer.xr.getController(i);
      bindSelectOn(controller);
      controller.addEventListener("squeezestart", (e) => {
        // Physical contact chooses the window or part once for this grip press.
        if (!isDimosTeleopArmed() && mappedButtonIndex("squeeze") !== 1) return;
        latchSqueeze(e.target, true);
        startStudioGrip(e.target);
      });
      controller.addEventListener("squeezeend", (e) => {
        if (!isDimosTeleopArmed() && mappedButtonIndex("squeeze") !== 1) return;
        latchSqueeze(e.target, false);
        finishStudioGrip(e.target);
      });
      controller.addEventListener("connected", (e) => {
        controller.userData.handedness = e.data?.handedness || "";
        controller.userData.inputSource = e.data || null;
        controller.userData.hasHand = !!e.data?.hand;
        controller.userData.hasGamepad = !!e.data?.gamepad;
        controller.visible = presenting;
      });
      controller.addEventListener("disconnected", () => {
        const hi = squeezeHandIndex(controller);
        uiSelectPress.release(hi);
        aiDrawWorkspace.cancel();
        if (hi === 0 || hi === 1) prevTrigger[hi] = false;
        controller.visible = false;
        controller.userData.inputSource = null;
        controller.userData.hasHand = false;
        controller.userData.hasGamepad = false;
        if (hi === 0 || hi === 1) { squeezeHeld[hi] = false; gripPressActive[hi] = false; }
        if (panelDrag?.hand === hi) endGrab(panelDrag.controller, { input: null });
        releaseGripGrab(controller);
      });

      ensureControllerPickLaser(controller);
      controller.visible = false;
      scene.add(controller);
      controllers.push(controller);

      const grip = renderer.xr.getControllerGrip(i);
      // Official Quest / Oculus controller mesh from WebXR input profiles
      const model = controllerModelFactory.createControllerModel(grip);
      model.frustumCulled = false;
      grip.add(model);
      bindSelectOn(grip);
      grip.addEventListener("squeezestart", (e) => {
        if (!isDimosTeleopArmed() && mappedButtonIndex("squeeze") !== 1) return;
        latchSqueeze(e.target, true);
        startStudioGrip(e.target);
      });
      grip.addEventListener("squeezeend", (e) => {
        if (!isDimosTeleopArmed() && mappedButtonIndex("squeeze") !== 1) return;
        latchSqueeze(e.target, false);
        finishStudioGrip(e.target);
      });
      grip.addEventListener("connected", (e) => {
        const src = e.data || null;
        // Synthetic reconnect (no .hand) is only for XRControllerModelFactory.
        if (src && src.gamepad && !src.hand && grip.userData.inputSource) {
          const prev = grip.userData.handedness || "";
          const next = src.handedness || "";
          if (prev && next && prev === next) return;
        }
        grip.userData.handedness = src?.handedness || "";
        grip.userData.inputSource = src;
        grip.userData.hasHand = !!src?.hand;
        // Quest AR attaches Hand joints to Touch sources — still a controller.
        grip.visible = presenting && (isPhysicalControllerSource(src) || !isHandsOnlySource(src));
        if (gripHasOfficialControllerMesh(grip)) stripControllerFallback(grip);
        else ensureControllerFallback(grip);
        if (presenting && src?.handedness === preferredDockHand) updateDockAttachment();
        // three.js factory skips official Touch GLBs when inputSource.hand is set.
        if (src?.hand && src?.gamepad && (src.targetRayMode || "tracked-pointer") === "tracked-pointer") {
          grip.dispatchEvent({
            type: "connected",
            data: {
              handedness: src.handedness,
              profiles: src.profiles,
              gamepad: src.gamepad,
              targetRayMode: "tracked-pointer",
            },
          });
        }
      });
      grip.addEventListener("disconnected", () => {
        const hi = squeezeHandIndex(grip);
        grip.visible = false;
        grip.userData.inputSource = null;
        if (hi === 0 || hi === 1) { squeezeHeld[hi] = false; gripPressActive[hi] = false; }
        if (panelDrag?.hand === hi) endGrab(panelDrag.controller, { input: null });
        releaseGripGrab(grip);
        if (presenting) updateDockAttachment();
      });
      grip.visible = false;
      scene.add(grip);
      grips.push(grip);

      const hand = renderer.xr.getHand(i);
      // Skinned generic-hand GLB; spheres until the mesh finishes loading.
      const sphereHands = handModelFactory.createHandModel(hand, "spheres");
      sphereHands.name = "xrHandSpheres";
      const meshHands = handModelFactory.createHandModel(hand, "mesh");
      meshHands.name = "xrHandMesh";
      hand.add(sphereHands);
      hand.add(meshHands);
      // Hand pointing laser (Quest 3 / Spectacles) — updated from index tip each frame
      const handRayGeo = new THREE.CylinderGeometry(XR_POINTER_BEAM_RADIUS_M, XR_POINTER_BEAM_RADIUS_M, 1, 6);
      handRayGeo.translate(0, 0.5, 0);
      handRayGeo.rotateX(-Math.PI / 2);
      const handRay = new THREE.Mesh(
        handRayGeo,
        new THREE.MeshBasicMaterial({
          color: 0xa5f3fc,
          transparent: true,
          opacity: 0.9,
          depthTest: false,
          depthWrite: false,
        }),
      );
      handRay.name = "xrHandRay";
      handRay.renderOrder = XR_LASER_OVER_UI_ORDER;
      handRay.frustumCulled = false;
      handRay.visible = false;
      handRay.scale.z = XR_LASER_MIN_M;
      disableXrPointerRaycast(handRay);
      hand.add(handRay);
      const handTip = new THREE.Mesh(
        new THREE.SphereGeometry(XR_POINTER_RADIUS_M, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xa5f3fc, depthTest: false, depthWrite: false }),
      );
      handTip.name = "xrHandRayTip";
      handTip.renderOrder = XR_LASER_OVER_UI_ORDER + 1;
      handTip.frustumCulled = false;
      handTip.visible = false;
      disableXrPointerRaycast(handTip);
      hand.add(handTip);
      hand.addEventListener("selectstart", (e) => {
        const hi = squeezeHandIndex(e.target);
        const pointer = (hi === 0 || hi === 1)
          ? (posedControllerForHand(hi) || e.target)
          : e.target;
        const hit = pickWithController(pointer);
        if (selectStartShouldCommit({ isUi: isUiPick(hit) })) handleSelect(pointer);
      });
      hand.addEventListener("select", (e) => {
        const hi = squeezeHandIndex(e.target);
        uiSelectPress.release(hi);
        const pointer = (hi === 0 || hi === 1)
          ? (posedControllerForHand(hi) || e.target)
          : e.target;
        finishGuidesSwipe(pointer);
        endGrab(pointer);
      });
      hand.addEventListener("selectend", (e) => {
        const hi = squeezeHandIndex(e.target);
        uiSelectPress.release(hi);
        const pointer = (hi === 0 || hi === 1)
          ? (posedControllerForHand(hi) || e.target)
          : e.target;
        finishGuidesSwipe(pointer);
        endGrab(pointer);
      });
      hand.addEventListener("connected", (e) => {
        hand.userData.handedness = e.data?.handedness || "";
        hand.userData.inputSource = e.data || null;
        // Hands mesh only when this source is actually hands-only (controllers put down).
        hand.visible = presenting && isHandsOnlySource(e.data);
        if (presenting && e.data?.handedness === preferredDockHand) updateDockAttachment();
      });
      hand.addEventListener("disconnected", () => {
        uiSelectPress.release(squeezeHandIndex(hand));
        hand.visible = false;
        hand.userData.inputSource = null;
        if (presenting) updateDockAttachment();
      });
      hand.visible = false;
      scene.add(hand);
      hands.push(hand);
    }
  }

  function sourceHandedness(source) {
    const h = source?.handedness;
    return h === "left" || h === "right" ? h : "";
  }

  function liveHandednessAlong(obj) {
    let o = obj;
    for (let n = 0; n < 8 && o; n += 1) {
      const srcH = stickyXrHandedness(
        sourceHandedness(o.userData?.inputSource),
        o.userData?.handedness,
      );
      if (srcH) return srcH;
      o = o.parent;
    }
    return "";
  }

  function xrHandednessOf(obj) {
    const live = liveHandednessAlong(obj);
    if (live) return live;
    let o = obj;
    for (let n = 0; n < 5 && o; n += 1) {
      const h = o.userData?.handedness;
      if (h === "left" || h === "right") return h;
      o = o.parent;
    }
    return "";
  }

  function sessionIndexForHand(want) {
    return controllerSlotForHand(controllers, want);
  }

  function xrNodeForHand(want, nodes) {
    bindHandednessFromSession();
    const need = want === "right" ? "right" : "left";
    for (const obj of nodes) {
      const h = stickyXrHandedness(
        sourceHandedness(obj?.userData?.inputSource),
        obj?.userData?.handedness,
      );
      if (h === need) return obj;
    }
    const idx = sessionIndexForHand(need);
    if (idx >= 0 && nodes[idx]) return nodes[idx];
    return null;
  }

  function getLeftGrip() {
    return xrNodeForHand("left", grips);
  }

  function getRightGrip() {
    return xrNodeForHand("right", grips);
  }

  function bindHandednessFromSession() {
    const max = Math.max(controllers.length, grips.length, hands.length, 2);
    // Target-ray connected/disconnected events own the renderer slot binding.
    for (let idx = 0; idx < max; idx += 1) {
      const source = connectedSourceForSlot(controllers, idx);
      const live = sourceHandedness(source);
      if (controllers[idx]) {
        if (source) controllers[idx].userData.inputSource = source;
        const hand = stickyXrHandedness(live, controllers[idx].userData.handedness);
        if (hand) controllers[idx].userData.handedness = hand;
        const csrc = source || controllers[idx].userData.inputSource;
        controllers[idx].userData.hasHand = !!csrc?.hand;
        controllers[idx].userData.hasGamepad = !!csrc?.gamepad;
      }
      if (grips[idx]) {
        if (source) grips[idx].userData.inputSource = source;
        const hand = stickyXrHandedness(live, grips[idx].userData.handedness);
        if (hand) grips[idx].userData.handedness = hand;
        const gsrc = source || grips[idx].userData.inputSource;
        grips[idx].userData.hasHand = !!gsrc?.hand;
      }
      if (hands[idx]) {
        if (source?.hand) {
          hands[idx].userData.inputSource = source;
          const hand = stickyXrHandedness(live, hands[idx].userData.handedness);
          if (hand) hands[idx].userData.handedness = hand;
        }
      }
    }
  }

  function getLeftHand() {
    return xrNodeForHand("left", hands);
  }

  function getRightHand() {
    return xrNodeForHand("right", hands);
  }

  function getHandJoint(hand, jointName) {
    if (!hand?.joints) return null;
    const joints = hand.joints;
    if (typeof joints.get === "function") return joints.get(jointName) || null;
    return joints[jointName] || null;
  }

  function jointWorldPos(hand, jointName, out = new THREE.Vector3()) {
    const joint = getHandJoint(hand, jointName);
    if (!joint) return null;
    joint.updateWorldMatrix?.(true, false);
    return joint.getWorldPosition(out);
  }

  /** Thumb–index tip distance in meters, or null if joints unavailable. */
  function handPinchDistance(hand) {
    const thumb = jointWorldPos(hand, "thumb-tip", new THREE.Vector3());
    const index = jointWorldPos(hand, "index-finger-tip", new THREE.Vector3());
    if (!thumb || !index) return null;
    return thumb.distanceTo(index);
  }

  /** Latch pinch with hysteresis for Quest 3 + Spectacles hands-only. */
  function updateHandPinchLatch(handIndex, hand) {
    const dist = handPinchDistance(hand);
    if (dist == null || !Number.isFinite(dist)) {
      return !!handPinchLatched[handIndex];
    }
    if (handPinchLatched[handIndex]) {
      if (dist > HAND_PINCH_RELEASE_M) handPinchLatched[handIndex] = false;
    } else if (dist < HAND_PINCH_START_M) {
      handPinchLatched[handIndex] = true;
    }
    return !!handPinchLatched[handIndex];
  }

  function handIndexForSource(source, fallbackIndex) {
    if (source?.handedness === "left") return 0;
    if (source?.handedness === "right") return 1;
    return fallbackIndex;
  }

  /** Wait for explicit handedness; transient/unlabeled sources cannot swap hands. */
  function inferHandIndexForSource(source, idx) {
    return handIndexForSource(source, -1);
  }

  function isPhysicalControllerSource(source) {
    if (!source) return false;
    const profiles = Array.isArray(source.profiles) ? source.profiles.map(String) : [];
    const hasKnownController = profiles.some((p) => isXrStandardControllerProfile(p));
    const onlyHandProfile = profiles.length > 0
      && profiles.every((p) => /hand/i.test(p) && !isXrStandardControllerProfile(p));
    if (onlyHandProfile) return false;
    if (hasKnownController) return true;

    const gp = source.gamepad;
    const btnCount = gp?.buttons?.length || 0;
    const axisCount = gp?.axes?.length || 0;
    const xrStandard = String(gp?.mapping || "") === "xr-standard";
    // Real Touch/Index/Vive pads have a stick plus trigger/squeeze. Hand pinch
    // gamepads are 1–2 buttons and must not keep the controller GLB on-screen.
    // Quest AR often stamps `.hand` on a live Touch — still a physical pad.
    const looksLikeTouchPad = xrSourceLooksLikeTouchPad(source)
      || btnCount >= 4 || (btnCount >= 3 && axisCount >= 4) || (xrStandard && btnCount >= 2);
    if (source.hand && !looksLikeTouchPad) return false;
    if (looksLikeTouchPad) return true;
    if (source.targetRayMode === "tracked-pointer") {
      if (source.hand) return false;
      if (btnCount <= 1 && axisCount < 2) return false;
      return true;
    }
    if (gp && !source.hand) return true;
    return false;
  }

  function isHandsOnlySource(source) {
    return isHandTrackedSource(source) && !isPhysicalControllerSource(source);
  }

  function isHandTrackedSource(source) {
    return !!(source && source.hand);
  }

  function syncHandModelQuality(hand) {
    if (!hand) return;
    const mesh = hand.getObjectByName("xrHandMesh");
    const spheres = hand.getObjectByName("xrHandSpheres");
    let meshReady = false;
    try {
      meshReady = !!(mesh && mesh.children?.length);
    } catch (_) {}
    if (spheres) spheres.visible = !meshReady;
    if (mesh) mesh.visible = meshReady;
  }

  /** Keep controller grips / hand meshes / docks visible correctly on Quest AR. */
  function syncInputVisibility(sampled) {
    const s = sampled || sampleXrHands();
    bindHandednessFromSession();
    const sess = renderer.xr.getSession?.();
    for (let i = 0; i < 2; i += 1) {
      const c = controllers[i];
      const g = grips[i];
      const h = hands[i];
      const src = connectedSourceForSlot(controllers, i);
      const physical = isPhysicalControllerSource(src);
      const handOnly = isHandsOnlySource(src);

      if (c) c.visible = presenting;
      if (g) {
        const keepPad = presenting && (!handOnly || gripHasOfficialControllerMesh(g) || xrSourceLooksLikeTouchPad(src));
        g.visible = keepPad;
        if (g.visible) {
          if (gripHasOfficialControllerMesh(g)) stripControllerFallback(g);
          else ensureControllerFallback(g);
        }
      }
      if (h) {
        h.visible = presenting && handOnly;
        if (h.visible) syncHandModelQuality(h);
      }
    }

    // Live left/right hands (index != handedness after Quest reorders sources).
    const leftPhysical = !!s.hasController[0];
    const rightPhysical = !!s.hasController[1];
    if (presenting) {
      const leftG = getLeftGrip();
      const rightG = getRightGrip();
      if (leftG && leftPhysical) {
        leftG.visible = true;
        if (gripHasOfficialControllerMesh(leftG)) stripControllerFallback(leftG);
        else ensureControllerFallback(leftG);
      }
      if (rightG && rightPhysical) {
        rightG.visible = true;
        if (gripHasOfficialControllerMesh(rightG)) stripControllerFallback(rightG);
        else ensureControllerFallback(rightG);
      }
    }
    const leftH = getLeftHand();
    const rightH = getRightHand();
    if (presenting) {
      if (leftH && !leftPhysical) {
        leftH.visible = true;
        syncHandModelQuality(leftH);
      }
      if (rightH && !rightPhysical) {
        rightH.visible = true;
        syncHandModelQuality(rightH);
      }
    }

    try {
      if (dock?.parent && dock.parent !== xrHud) dock.parent.visible = true;
      if (captureDock?.parent && captureDock.parent !== xrHud) captureDock.parent.visible = true;
      if (presenting) {
        dock.visible = true;
        syncCaptureDockVisibility();
      }
    } catch {
      /* ignore */
    }
    return s;
  }

  /** Remove the white brick stand-in — official Quest Touch GLB is the only controller mesh. */
  function stripControllerFallback(grip) {
    if (!grip) return;
    const fb = grip.getObjectByName("xrControllerFallback");
    if (!fb) return;
    try {
      grip.remove(fb);
    } catch (_) {}
  }

  function gripHasOfficialControllerMesh(grip) {
    if (grip?.userData?.xrControllerOverlayReady) return true;
    let found = false;
    grip?.traverse((o) => {
      if (found || !o?.isMesh) return;
      if (o.userData?.xrFallback || String(o.name || "").startsWith("xrControllerFallback")) return;
      if (o === dock || o === captureDock) return;
      if (o.name === "xrRay" || o.name === "xrRayTip") return;
      found = true;
    });
    return found;
  }

  function ensureControllerFallback(grip) {
    if (!grip) return;
    let fb = grip.getObjectByName("xrControllerFallback");
    if (!fb) {
      fb = new THREE.Group();
      fb.name = "xrControllerFallback";
      fb.userData.xrFallback = true;
      fb.frustumCulled = false;
      fb.renderOrder = XR_CONTROLLER_OVER_UI_ORDER;
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(0.035, 0.025, 0.11),
        new THREE.MeshBasicMaterial({
          color: 0x1f2937,
          depthTest: false,
          depthWrite: false,
          transparent: true,
          toneMapped: false,
        }),
      );
      body.name = "xrControllerFallbackBody";
      body.userData.xrFallback = true;
      body.position.set(0, 0, 0.03);
      body.frustumCulled = false;
      body.renderOrder = XR_CONTROLLER_OVER_UI_ORDER;
      fb.add(body);
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.008, 10, 8),
        new THREE.MeshBasicMaterial({
          color: 0x38bdf8,
          depthTest: false,
          depthWrite: false,
          transparent: true,
          toneMapped: false,
        }),
      );
      tip.name = "xrControllerFallbackTip";
      tip.userData.xrFallback = true;
      tip.position.set(0, 0, -0.01);
      tip.frustumCulled = false;
      tip.renderOrder = XR_CONTROLLER_OVER_UI_ORDER + 1;
      fb.add(tip);
      grip.add(fb);
    }
    fb.visible = !gripHasOfficialControllerMesh(grip);
  }

  function gamepadTrigger(gp) {
    return xrGamepadTriggerPressed(gp);
  }

  function gamepadSqueeze(gp) {
    return xrGamepadSqueezePressed(gp);
  }

  function objectIsPosed(obj) {
    if (!obj) return false;
    try {
      obj.updateMatrixWorld(true);
      const p = new THREE.Vector3().setFromMatrixPosition(obj.matrixWorld);
      return xrAimPoseIsLive(p);
    } catch {
      return false;
    }
  }

  /** Quest often leaves the target-ray group at identity while grip is live. */
  function syncGripPosesFromXrFrame() {
    const frame=renderer.xr.getFrame?.(), ref=renderer.xr.getReferenceSpace?.();
    if(!frame||!ref)return;
    for(let i=0;i<controllers.length;i++){
      const source=connectedSourceForSlot(controllers,i);
      if(!source?.gripSpace||!grips[i])continue;
      try {const pose=frame.getPose(source.gripSpace,ref);if(pose)applyXrSpacePoseToObject(grips[i],pose.transform);}catch(_){}
    }
  }

  function syncControllerAimFromXrFrame(controller, slotIndex) {
    if (!controller) return false;
    const src = connectedSourceForSlot(controllers, slotIndex)
      || controller.userData?.inputSource
      || null;
    const frame = renderer.xr.getFrame?.();
    const ref = renderer.xr.getReferenceSpace?.();
    if (frame && ref && src?.targetRaySpace) {
      try {
        const pose = frame.getPose(src.targetRaySpace, ref);
        if (pose?.transform && applyXrSpacePoseToObject(controller, pose.transform)) {
          controller.visible = presenting;
          if (objectIsPosed(controller)) return true;
        }
      } catch (_) {}
    }
    const hi = squeezeHandIndex(controller);
    const grip = hi === 0 ? getLeftGrip() : hi === 1 ? getRightGrip() : (slotIndex === 0 || slotIndex === 1 ? grips[slotIndex] : null);
    if (grip && grip !== controller && objectIsPosed(grip)) {
      try {
        grip.updateMatrixWorld(true);
        controller.position.setFromMatrixPosition(grip.matrixWorld);
        controller.quaternion.setFromRotationMatrix(grip.matrixWorld);
        controller.scale.set(1, 1, 1);
        controller.updateMatrix();
        controller.updateMatrixWorld(true);
        controller.visible = presenting;
        return true;
      } catch (_) {}
    }
    return objectIsPosed(controller);
  }

  /**
   * Unified per-hand XR input for controllers + hands.
   * squeeze: xr-standard gamepad button 1 (grip) — Quest, Index, Vive, Pico, …
   * trigger: xr-standard button 0 OR hand pinch when hands-only
   */
  function sampleXrHands() {
    const sess = renderer.xr.getSession?.();
    const out = {
      squeezes: [false, false],
      triggers: [false, false],
      pinches: [false, false],
      hasHand: [false, false],
      hasController: [false, false],
      pointers: [null, null],
    };
    if (!sess) {
      out.squeezes[0] = squeezeHeld[0];
      out.squeezes[1] = squeezeHeld[1];
      out.pointers[0] = posedControllerForHand(0);
      out.pointers[1] = posedControllerForHand(1);
      return out;
    }

    bindHandednessFromSession();

    let hasLeft = false;
    let hasRight = false;
    let physicalLeft = false;
    let physicalRight = false;
    for (const source of sess.inputSources) {
      if (source?.handedness === "left") hasLeft = true;
      if (source?.handedness === "right") hasRight = true;
      if (source?.handedness === "left" && (isPhysicalControllerSource(source) || xrSourceLooksLikeTouchPad(source))) {
        physicalLeft = true;
      }
      if (source?.handedness === "right" && (isPhysicalControllerSource(source) || xrSourceLooksLikeTouchPad(source))) {
        physicalRight = true;
      }
    }

    for (const source of sess.inputSources) {
      const idx = controllerSlotForSource(controllers, source);
      const gp = source.gamepad;
      const physical = isPhysicalControllerSource(source);
      const triggerBtn = isDimosTeleopArmed() ? gamepadTrigger(gp) : gamepadActionPressed(gp, "trigger");
      const squeezeBtn = isDimosTeleopArmed() ? gamepadSqueeze(gp) : gamepadActionPressed(gp, "squeeze");
      let inferred = xrSourceHandIndex(source, {
        hasLeft,
        hasRight,
        fallback: inferHandIndexForSource(source, idx),
      });
      if (inferred < 0 && (physical || triggerBtn || squeezeBtn || xrSourceLooksLikeTouchPad(source))) {
        inferred = unlabeledTriggerHandIndex({
          hasLabeledPhysicalLeft: physicalLeft,
          hasLabeledPhysicalRight: physicalRight,
        });
      }
      const handIndex = inferred;
      if (handIndex < 0) continue;
      if (idx >= 0 && (handIndex === 0 || handIndex === 1)) {
        const stamp = handIndex === 0 ? "left" : "right";
        if (controllers[idx]) controllers[idx].userData.handedness = stamp;
        if (grips[idx]) grips[idx].userData.handedness = stamp;
      }
      const handObj = (idx >= 0 && hands[idx]) || null;

      if (isHandTrackedSource(source)) out.hasHand[handIndex] = true;

      if (physical) {
        out.hasController[handIndex] = true;
        if (idx >= 0 && controllers[idx]) out.pointers[handIndex] = controllers[idx];
        else if (idx >= 0 && grips[idx] && !out.pointers[handIndex]) out.pointers[handIndex] = grips[idx];
        out.triggers[handIndex] = out.triggers[handIndex] || triggerBtn;
        out.squeezes[handIndex] = out.squeezes[handIndex] || squeezeBtn;
      } else if (!out.hasController[handIndex]) {
        const jointPinch = handIndex === 0 ? getLeftHand() : getRightHand();
        const pinchHand = jointPinch || handObj;
        const pinched = pinchHand ? updateHandPinchLatch(handIndex, pinchHand) : false;
        out.pinches[handIndex] = pinched || out.pinches[handIndex];
        out.triggers[handIndex] = out.triggers[handIndex] || triggerBtn || pinched;
        // Pinch is the hand "trigger" (click UI). Grip-grab uses the squeeze button
        // / two-hand pinch scale — not a single pinch, or the left menu can never be clicked.
        out.squeezes[handIndex] = out.squeezes[handIndex] || squeezeBtn;
        if (!out.pointers[handIndex] && idx >= 0 && controllers[idx]) out.pointers[handIndex] = controllers[idx];
      } else {
        out.triggers[handIndex] = out.triggers[handIndex] || triggerBtn;
      }
    }

    for (let i = 0; i < 2; i += 1) {
      if (out.hasController[i] && (isDimosTeleopArmed() || mappedButtonIndex("squeeze") === 1)) {
        out.squeezes[i] = out.squeezes[i] || squeezeHeld[i];
      } else {
        squeezeHeld[i] = false;
      }
      if (!out.pointers[i]) out.pointers[i] = posedControllerForHand(i);
    }

    for (let i = 0; i < 2; i += 1) {
      const handObj = i === 0 ? getLeftHand() : getRightHand();
      if (!handObj || out.hasController[i]) continue;
      if (!out.hasHand[i] && !handObj.visible && !getHandJoint(handObj, "wrist")) continue;
      out.hasHand[i] = true;
      const jointPinch = updateHandPinchLatch(i, handObj);
      out.pinches[i] = jointPinch;
      out.triggers[i] = out.triggers[i] || jointPinch;
      out.squeezes[i] = out.squeezes[i] || false;
    }
    return out;
  }

  function pinchMidpoint(hand, out = new THREE.Vector3()) {
    const thumb = jointWorldPos(hand, "thumb-tip", new THREE.Vector3());
    const index = jointWorldPos(hand, "index-finger-tip", new THREE.Vector3());
    if (!thumb || !index) return null;
    return out.copy(thumb).lerp(index, 0.5);
  }

  function updatePinchAnchors() {
    for (let i = 0; i < 2; i += 1) {
      const anchor = pinchAnchors[i];
      if (!anchor) continue;
      const hand = i === 0 ? getLeftHand() : getRightHand();
      const mid = pinchMidpoint(hand);
      if (!hand || !mid) {
        anchor.visible = false;
        continue;
      }
      anchor.position.copy(mid);
      const wrist = jointWorldPos(hand, "wrist", new THREE.Vector3());
      if (wrist) {
        const dir = mid.clone().sub(wrist);
        if (dir.lengthSq() > 1e-8) {
          dir.normalize();
          anchor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), dir);
        }
      } else {
        try { hand.getWorldQuaternion(anchor.quaternion); } catch (_) {}
      }
      anchor.userData.handedness = i === 0 ? "left" : "right";
      anchor.visible = true;
      anchor.updateMatrixWorld(true);
    }
  }

  /** World position for grab/scale — pinch midpoint for hands, target ray for Touch. */
  function pointerWorldPos(handIndex, out = new THREE.Vector3()) {
    const want = handIndex === 0 ? "left" : "right";
    const sess = renderer.xr.getSession?.();
    let physical = false;
    if (sess) {
      for (const source of sess.inputSources) {
        if (source.handedness === want && isPhysicalControllerSource(source)) physical = true;
      }
    }
    if (!physical) {
      const hand = handIndex === 0 ? getLeftHand() : getRightHand();
      const mid = pinchMidpoint(hand, out);
      if (mid) return mid;
      const wrist = jointWorldPos(hand, "wrist", out);
      if (wrist) return wrist;
      if (pinchAnchors[handIndex]?.visible) {
        pinchAnchors[handIndex].getWorldPosition(out);
        return out;
      }
    }
    const pointer = posedControllerForHand(handIndex);
    if (pointer && objectIsPosed(pointer)) {
      pointer.updateMatrixWorld(true);
      return pointer.getWorldPosition(out);
    }
    const hand = handIndex === 0 ? getLeftHand() : getRightHand();
    if (hand) {
      hand.updateMatrixWorld(true);
      return hand.getWorldPosition(out);
    }
    return out.set(0, 0, 0);
  }

  function aimPointer(handIndex) {
    const pointer = posedControllerForHand(handIndex);
    const grip = handIndex === 0 ? getLeftGrip() : getRightGrip();
    const hand = handIndex === 0 ? getLeftHand() : getRightHand();
    const src = connectedSourceForSlot(controllers, sessionIndexForHand(handIndex === 0 ? "left" : "right"));
    return resolvePosedAim({
      pointer,
      grip,
      hand,
      pointerPosed: objectIsPosed(pointer),
      gripPosed: objectIsPosed(grip),
      handPosed: objectIsPosed(hand),
      physical: isPhysicalControllerSource(src) || objectIsPosed(grip),
    });
  }

  /** rtrig2: posed right node after Quest drops live "right" on the source. */
  function fallbackSelectPointer(handIndex) {
    const want = handIndex === 0 ? "left" : "right";
    const nodes = [];
    for (const c of controllers) nodes.push(c);
    for (const g of grips) nodes.push(g);
    for (const n of nodes) {
      if (!n || !objectIsPosed(n)) continue;
      const h = stickyXrHandedness(sourceHandedness(n.userData?.inputSource), n.userData?.handedness);
      if (h === want) return n;
    }
    const posed = controllers.filter((c) => objectIsPosed(c));
    if (handIndex === 1 && posed.length === 1) return posed[0];
    return null;
  }

  function updateHandRays({ pick = true } = {}) {
    for (let i = 0; i < hands.length; i += 1) {
      const hand = hands[i];
      if (!hand) continue;
      const ray = hand.getObjectByName("xrHandRay");
      const tipMesh = hand.getObjectByName("xrHandRayTip");
      const indexTip = getHandJoint(hand, "index-finger-tip");
      const indexProx = getHandJoint(hand, "index-finger-phalanx-proximal")
        || getHandJoint(hand, "index-finger-phalanx-intermediate");
      const sess = renderer.xr.getSession?.();
      const src = connectedSourceForSlot(controllers, i);
      const handTracked = isHandTrackedSource(src) || !!hand.userData.inputSource?.hand;
      const physical = isPhysicalControllerSource(src);
      const handOnly = isHandsOnlySource(src);
      const useHandLaser = presenting && hand.visible && handOnly && indexTip && handTracked;
      if (!useHandLaser || !indexTip) {
        if (ray) ray.visible = false;
        if (tipMesh) tipMesh.visible = false;
        if (controllers[i]) controllers[i].userData.handAim = null;
        continue;
      }

      const tipPos = indexTip.getWorldPosition(_handTip);
      _handDir.set(0, 0, -1);
      if (indexProx) {
        const proxPos = indexProx.getWorldPosition(_handProx);
        _handDir.copy(tipPos).sub(proxPos);
        if (_handDir.lengthSq() < 1e-8) _handDir.set(0, 0, -1);
        else _handDir.normalize();
      } else if (controllers[i]) {
        _mat.identity().extractRotation(controllers[i].matrixWorld);
        _handDir.set(0, 0, -1).applyMatrix4(_mat);
      }

      if (controllers[i]) {
        const aim = controllers[i].userData.handAim || { origin: new THREE.Vector3(), direction: new THREE.Vector3() };
        aim.origin.copy(tipPos);
        aim.direction.copy(_handDir);
        controllers[i].userData.handAim = aim;
      }

      if (!pick) continue;
      const hit = pickWithController(controllers[i] || hand, { uiOnly: false });
      const hideLaser = pointerHideLaserForHand(i);
      const style = xrPointerStyle({
        hit, ui: isUiPick(hit), presenting, posed: true,
        holding: gripGrab?.hand === i || panelDrag?.hand === i,
        hideLaser,
        tipOffsetM: pointerTipOffsetM(),
      });
      const tipM = style.distance;
      const beamM = style.beam ? style.distance : 0;
      hand.updateMatrixWorld(true);
      _handInv.copy(hand.matrixWorld).invert();
      _handLocalO.copy(tipPos).applyMatrix4(_handInv);
      _handLocalT.copy(tipPos).addScaledVector(_handDir, beamM > 0 ? beamM : tipM).applyMatrix4(_handInv);
      _handLocalD.copy(_handLocalT).sub(_handLocalO);
      const localLen = Math.max(_handLocalD.length(), tipM);
      _handLocalD.normalize();
      if (ray) {
        ray.visible = beamM > 0;
        if (beamM > 0) {
          ray.position.copy(_handLocalO);
          ray.scale.set(1, 1, localLen);
          ray.material.opacity = style.opacity;
          ray.material.color.setHex(style.color);
          ray.quaternion.setFromUnitVectors(_handZNeg, _handLocalD);
        }
      }
      if (tipMesh) {
        tipMesh.visible = style.visible && pointerTipVisible({
          presenting, useRay: style.beam, hideLaser,
        });
        tipMesh.position.copy(_handLocalT);
        tipMesh.scale.setScalar(1);
        tipMesh.material?.color?.setHex?.(style.color);
      }
    }
  }

  /** Head-locked tool dock — used when the preferred grip/hand isn't tracked yet. */
  function attachDockHeadLocked() {
    ensureXrHeadPose();
    if (!xrHud.visible) xrHud.visible = true;
    if (dock.parent !== xrHud) {
      if (dock.parent) dock.parent.remove(dock);
      xrHud.add(dock);
    }
    if (captureDock.parent !== xrHud) {
      if (captureDock.parent) captureDock.parent.remove(captureDock);
      xrHud.add(captureDock);
    }
    // Camera-local -X is the viewer's left. World -X with identity quat looks like
    // the right controller on first Quest enter.
    const xrCam = renderer.xr.getCamera?.(camera) || camera;
    try { xrCam.updateMatrixWorld?.(true); } catch (_) {}
    const camPos = new THREE.Vector3();
    const camQuat = new THREE.Quaternion();
    try {
      xrCam.getWorldPosition(camPos);
      xrCam.getWorldQuaternion(camQuat);
    } catch {
      camPos.copy(_headPos);
      camQuat.copy(_headQuat);
    }
    if (camPos.lengthSq() < 1e-8) camPos.copy(_headPos);
    if (camQuat.lengthSq() < 0.5) camQuat.copy(_headQuat);
    const left = new THREE.Vector3(-1, 0, 0).applyQuaternion(camQuat);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(camQuat);
    const sideSign = preferredDockHand === "right" ? -1 : 1;
    // Lower-left of the view — never 34 cm dead-ahead (that plate ate every laser).
    dock.position.copy(camPos)
      .addScaledVector(fwd, 0.18)
      .addScaledVector(left, 0.32 * sideSign)
      .addScaledVector(down, 0.24);
    dock.quaternion.copy(camQuat);
    dock.rotateX(-0.48);
    captureDock.position.copy(dock.position).addScaledVector(down, 0.08);
    captureDock.quaternion.copy(dock.quaternion);
    dock.scale.setScalar(1);
    captureDock.scale.setScalar(1);
    dock.visible = true;
    syncCaptureDockVisibility();
    attachStatusHeadLocked();
    return true;
  }

  function attachStatusHeadLocked() {
    ensureXrHeadPose();
    if (!xrHud.visible) xrHud.visible = true;
    if (statusDock.parent !== xrHud) {
      if (statusDock.parent) statusDock.parent.remove(statusDock);
      xrHud.add(statusDock);
    }
    const xrCam = renderer.xr.getCamera?.(camera) || camera;
    try { xrCam.updateMatrixWorld?.(true); } catch (_) {}
    const camPos = new THREE.Vector3();
    const camQuat = new THREE.Quaternion();
    try {
      xrCam.getWorldPosition(camPos);
      xrCam.getWorldQuaternion(camQuat);
    } catch {
      camPos.copy(_headPos);
      camQuat.copy(_headQuat);
    }
    if (camPos.lengthSq() < 1e-8) camPos.copy(_headPos);
    if (camQuat.lengthSq() < 0.5) camQuat.copy(_headQuat);
    const left = new THREE.Vector3(-1, 0, 0).applyQuaternion(camQuat);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camQuat);
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(camQuat);
    const sideSign = preferredDockHand === "right" ? -1 : 1;
    statusDock.position.copy(camPos)
      .addScaledVector(fwd, 0.34)
      .addScaledVector(left, 0.22 * -sideSign)
      .addScaledVector(down, 0.18);
    statusDock.quaternion.copy(camQuat);
    statusDock.rotateX(-0.48);
    statusDock.scale.setScalar(1);
    statusDock.visible = true;
    return true;
  }

  function isDefinitelyRight(obj) {
    if (!obj || obj === xrHud || obj === dockAnchor || obj === statusAnchor || obj === gripGrabAnchor) return false;
    if (liveHandednessAlong(obj) === "right") return true;
    const i = xrIndexOf(obj);
    if (i >= 0) {
      const sess = renderer.xr.getSession?.();
      if (connectedSourceForSlot(controllers, i)?.handedness === "right") return true;
    }
    const rightG = getRightGrip();
    const rightH = getRightHand();
    let o = obj;
    for (let n = 0; n < 8 && o; n += 1) {
      if (rightG && o === rightG) return true;
      if (rightH && o === rightH) return true;
      o = o.parent;
    }
    return false;
  }

  function isDefinitelyLeft(obj) {
    if (!obj || obj === xrHud || obj === dockAnchor || obj === statusAnchor || obj === gripGrabAnchor) return false;
    if (isDefinitelyRight(obj)) return false;
    if (liveHandednessAlong(obj) === "left") return true;
    const i = xrIndexOf(obj);
    if (i >= 0) {
      const sess = renderer.xr.getSession?.();
      if (connectedSourceForSlot(controllers, i)?.handedness === "left") return true;
    }
    const leftG = getLeftGrip();
    const leftH = getLeftHand();
    let o = obj;
    for (let n = 0; n < 8 && o; n += 1) {
      if (leftG && o === leftG) return true;
      if (leftH && o === leftH) return true;
      o = o.parent;
    }
    return false;
  }

  function isDefinitelyOtherDockHand(obj) {
    return preferredDockHand === "right" ? isDefinitelyLeft(obj) : isDefinitelyRight(obj);
  }

  function dockParentIsForbidden(obj) {
    if (!obj) return false;
    if (obj === xrHud || obj === dockAnchor || obj === statusAnchor) return false;
    if (isDefinitelyOtherDockHand(obj)) return true;
    if (controllers.includes(obj) || grips.includes(obj) || hands.includes(obj)) return true;
    let o = obj.parent;
    for (let n = 0; n < 8 && o; n += 1) {
      if (o === xrHud || o === dockAnchor || o === statusAnchor) return false;
      if (hands.includes(o) || grips.includes(o) || controllers.includes(o)) return true;
      if (isDefinitelyOtherDockHand(o)) return true;
      o = o.parent;
    }
    return false;
  }

  function peelDockOffHands() {
    if (dockParentIsForbidden(dock.parent)) {
      try {
        if (dock.parent) dock.parent.remove(dock);
        dockAnchor.add(dock);
      } catch (_) {}
    }
    if (dockParentIsForbidden(statusDock.parent)) {
      try {
        if (statusDock.parent) statusDock.parent.remove(statusDock);
        statusAnchor.add(statusDock);
      } catch (_) {}
    }
  }

  function ensureDockOnAnchor() {
    if (dock.parent !== dockAnchor) {
      if (dock.parent) dock.parent.remove(dock);
      dockAnchor.add(dock);
    }
    if (captureDock.parent !== dockAnchor) {
      if (captureDock.parent) captureDock.parent.remove(captureDock);
      dockAnchor.add(captureDock);
    }
    dockAnchor.visible = true;
    dock.visible = true;
    syncCaptureDockVisibility();
  }

  function ensureStatusOnAnchor() {
    if (statusDock.parent !== statusAnchor) {
      if (statusDock.parent) statusDock.parent.remove(statusDock);
      statusAnchor.add(statusDock);
    }
    statusAnchor.visible = true;
    statusDock.visible = true;
  }

  function applyStatusLocalOffsets(useWrist) {
    statusAnchor.updateMatrixWorld(true);
    ensureXrHeadPose();
    statusAnchor.getWorldPosition(_dockGrip);
    _dockToward.copy(_headPos).sub(_dockGrip);
    const dist = _dockToward.length();
    if (dist < 1e-4) {
      statusDock.position.set(-0.02, 0.03, 0.05);
      return;
    }
    _dockToward.multiplyScalar(1 / dist);
    const push = useWrist ? 0.05 : 0.058;
    _dockWorld.copy(_dockGrip).addScaledVector(_dockToward, push);
    _dockWorld.y += useWrist ? 0.02 : 0.026;
    _dockLook.lookAt(_dockWorld, _headPos, _dockUp);
    _dockWorldQ.setFromRotationMatrix(_dockLook);
    _dockWorldQ.multiply(_dockFlip);
    statusAnchor.getWorldQuaternion(_dockParentQ);
    _dockLocalQ.copy(_dockParentQ).invert().multiply(_dockWorldQ);
    statusAnchor.worldToLocal(_dockWorld);
    statusDock.position.copy(_dockWorld);
    statusDock.quaternion.copy(_dockLocalQ);
    statusDock.scale.setScalar(1);
  }

  function applyDockLocalOffsets(useWrist) {
    dockAnchor.updateMatrixWorld(true);
    ensureXrHeadPose();
    dockAnchor.getWorldPosition(_dockGrip);
    _dockToward.copy(_headPos).sub(_dockGrip);
    const dist = _dockToward.length();
    if (dist < 1e-4) {
      dock.position.set(0.02, 0.02, 0.08);
      captureDock.position.set(0.02, -0.14, 0.08);
      dockMode = useWrist ? "wrist" : "grip";
      return;
    }
    _dockToward.multiplyScalar(1 / dist);
    const push = useWrist ? 0.068 : 0.08;
    _dockWorld.copy(_dockGrip).addScaledVector(_dockToward, push);
    _dockWorld.y += useWrist ? 0.014 : 0.022;
    _dockLook.lookAt(_dockWorld, _headPos, _dockUp);
    _dockWorldQ.setFromRotationMatrix(_dockLook);
    _dockWorldQ.multiply(_dockFlip);
    dockAnchor.getWorldQuaternion(_dockParentQ);
    _dockLocalQ.copy(_dockParentQ).invert().multiply(_dockWorldQ);
    dockAnchor.worldToLocal(_dockWorld);
    dock.position.copy(_dockWorld);
    dock.quaternion.copy(_dockLocalQ);
    dock.scale.setScalar(1);

    _dockCapWorld.copy(_dockGrip).addScaledVector(_dockToward, push);
    _dockCapWorld.y += useWrist ? -0.13 : -0.155;
    dockAnchor.worldToLocal(_dockCapWorld);
    captureDock.position.copy(_dockCapWorld);
    captureDock.quaternion.copy(_dockLocalQ);
    captureDock.scale.setScalar(1);
    dockMode = useWrist ? "wrist" : "grip";
  }

  function nodeIsOnPreferredSide(obj, want) {
    if (!obj || !objectIsPosed(obj)) return false;
    if (!isReasonableXrHead()) return false;
    const p = new THREE.Vector3();
    try { obj.getWorldPosition(p); } catch { return false; }
    const to = p.sub(_headPos);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(_headQuat);
    if (right.lengthSq() < 1e-8) return false;
    right.normalize();
    const x = to.dot(right);
    return want === "right" ? x >= -0.04 : x <= 0.04;
  }

  function xrCadUnhideGpuBusy() {
    try {
      const mesh = getLiveMesh();
      if (!mesh || mesh.userData?._xrUnhideDone) return false;
      if (xrCadUnhideInProgress(mesh.userData?._xrUnhide)) return true;
      return Number(mesh.userData?._xrUnhide?.revealedThisFrame || 0) > 0;
    } catch {
      return false;
    }
  }

  function xrEnterWorkSettled() {
    return shouldRunXrEnterDeferredWork({
      presenting,
      now: performance.now(),
      presentStartedAt: xrPresentStartedAt,
      minMs: XR_ENTER_DEFER_MS,
    });
  }

  function armXrEnterIdleTimer(ms) {
    if (xrEnterIdleTimer) return;
    const wait = Math.max(16, Number(ms) || 80);
    try {
      xrEnterIdleTimer = window.setTimeout(() => {
        xrEnterIdleTimer = 0;
        flushXrEnterIdleJobs();
      }, wait);
    } catch (_) {}
  }

  function flushXrEnterIdleJobs() {
    xrEnterIdleRaf = 0;
    if (xrEnterIdleTimer) {
      try { clearTimeout(xrEnterIdleTimer); } catch (_) {}
      xrEnterIdleTimer = 0;
    }
    if (!presenting) {
      xrEnterIdleJobs.length = 0;
      return;
    }
    try { flushDeferredXrProject(); } catch (_) {}
    if (!xrEnterWorkSettled()) {
      if (shouldUseWindowRafWhileXrPresenting()) {
        try { xrEnterIdleRaf = requestAnimationFrame(flushXrEnterIdleJobs); } catch (_) {}
      } else {
        armXrEnterIdleTimer(80);
      }
      return;
    }
    const jobs = xrEnterIdleJobs.splice(0);
    for (const job of jobs) {
      try { job(); } catch (_) {}
    }
  }

  function scheduleXrEnterIdle(fn) {
    if (typeof fn !== "function") return;
    if (xrEnterWorkSettled()) {
      try { fn(); } catch (_) {}
      return;
    }
    xrEnterIdleJobs.push(fn);
    if (shouldUseWindowRafWhileXrPresenting()) {
      if (!xrEnterIdleRaf) {
        try { xrEnterIdleRaf = requestAnimationFrame(flushXrEnterIdleJobs); } catch (_) {}
      }
    } else {
      armXrEnterIdleTimer(80);
    }
    try { window.setTimeout(flushXrEnterIdleJobs, XR_ENTER_DEFER_MS + 16); } catch (_) {}
  }

  /** Never window.rAF or session rAF for HUD paint — both hitch the Quest compositor. */
  function scheduleXrHudOffSelectTick(fn) {
    if (typeof fn !== "function") return;
    if (!presenting) {
      try { fn(); } catch (_) {}
      return;
    }
    const run = () => {
      if (!presenting) return;
      try { fn(); } catch (_) {}
    };
    // Session rAF is still the compositor frame — HUD canvas paint hitchs Quest there.
    try { window.setTimeout(run, 48); } catch (_) { run(); }
  }

  function deferHudOpenIfNeeded(kind, panelReady, fn) {
    if (shouldAllocateXrHudPanelOnSelectTick({ presenting, panelReady: !!panelReady })) return false;
    if (!xrHudPanelNeedsDeferredPaint({ presenting, kind, panelReady: !!panelReady })) return false;
    scheduleXrHudOffSelectTick(fn);
    return true;
  }

  function refreshGridPopupSoon(kind) {
    if (shouldPaintXrHudPanelOnSelectTick({ presenting })) {
      refreshGridPopup(kind);
      return;
    }
    const key = String(kind || "");
    if (!key || pendingGridRefresh.has(key)) return;
    pendingGridRefresh.add(key);
    scheduleXrHudOffSelectTick(() => {
      pendingGridRefresh.delete(key);
      refreshGridPopup(key);
    });
  }

  function scheduleXrEnterCanvas(fn) {
    if (typeof fn !== "function") return;
    const kick = () => {
      if (!presenting) return;
      if (!shouldRunXrEnterCanvasWork({
        presenting,
        now: performance.now(),
        presentStartedAt: xrPresentStartedAt,
        unhideBusy: xrCadUnhideGpuBusy(),
        revealedThisFrame: Number(getLiveMesh()?.userData?._xrUnhide?.revealedThisFrame || 0),
      })) {
        if (shouldUseWindowRafWhileXrPresenting()) {
          try { requestAnimationFrame(kick); } catch (_) {}
        } else {
          try { window.setTimeout(kick, 120); } catch (_) {}
        }
        return;
      }
      try { fn(); } catch (_) {}
    };
    scheduleXrEnterIdle(kick);
  }

  function flushDeferredXrProject() {
    const opener = window.__openDeferredXrProject;
    if (!shouldFlushDeferredXrProject({
      presenting,
      hasOpener: typeof opener === "function",
    })) return;
    const id = String(window.__xrDeferredProjectId || "").trim();
    if (!id) return;
    window.__xrDeferredProjectId = "";
    try { opener(id); } catch (_) {}
  }

  function stopBootSplashForPresent() {
    try { document.body.classList.add("xr-presenting"); } catch (_) {}
    try { window.__studioXrEnterChosen = true; } catch (_) {}
    try { window.__studioXrEnterFailedKeepSplash = false; } catch (_) {}
    if (shouldKillBootSplashForXrPresent({ presenting: true })) {
      try { killBootSplashDomForXr(); } catch (_) {}
    }
    try { window.__dismissStudioBoot?.(); } catch (_) {}
  }

  function restoreDockHandFromSettings() {
    let next = "left";
    try {
      const store = typeof localStorage !== "undefined" ? localStorage : null;
      migrateMenuHandToLeft(store);
      seedDefaultDockHand(store);
      next = restorePreferredDockHand(store);
    } catch {
      next = "left";
    }
    preferredDockHand = next === "right" ? "right" : "left";
    try { dockPalette.setDockHand?.(preferredDockHand); } catch (_) {}
    return preferredDockHand;
  }

  function scheduleXrUiPrewarm() {
    // Do not allocate menu / settings / tools canvases on VR enter.
    // Quest freezes if those 1024px textures upload during the first seconds.
    if (xrUiPrewarmed) return;
    xrUiPrewarmed = true;
  }

  function preferredHandTarget(wantHand) {
    bindHandednessFromSession();
    const want = wantHand === "right" ? "right" : "left";
    const sess = renderer.xr.getSession?.();
    let wantPhysical = false;
    let wantHanded = false;
    if (sess) {
      for (const source of sess.inputSources) {
        if (source.handedness !== want) continue;
        if (isPhysicalControllerSource(source)) wantPhysical = true;
        if (isHandTrackedSource(source)) wantHanded = true;
      }
    }
    const wantHandNode = want === "right" ? getRightHand() : getLeftHand();
    const wantGrip = want === "right" ? getRightGrip() : getLeftGrip();
    const useWrist = wantHanded && !wantPhysical && wantHandNode;
    const parent = useWrist ? wantHandNode : wantGrip;
    let dockParent = parent;
    if (useWrist) {
      const wrist = getHandJoint(wantHandNode, "wrist");
      if (wrist) dockParent = wrist;
    }
    return { parent, dockParent, useWrist, wantPhysical, wantHanded, want };
  }

  function preferredDockTarget() {
    return preferredHandTarget(preferredDockHand);
  }

  function isDefinitelyMenuDockHand(obj) {
    return preferredDockHand === "right" ? isDefinitelyRight(obj) : isDefinitelyLeft(obj);
  }

  function attachStatusToLeftGrip() {
    const {dockParent,useWrist}=preferredHandTarget('left');
    if(!dockParent||!objectIsPosed(dockParent))return false;
    copyWorldPose(dockParent,statusAnchor);
    ensureStatusOnAnchor();
    // Match the menu plane with a compact row below it, all on the left hand.
    if(preferredDockHand==='left' && dockHasPose){
      dock.updateWorldMatrix(true,false);statusAnchor.updateWorldMatrix(true,false);
      const matrix=statusDockMatrix.copy(statusAnchor.matrixWorld).invert().multiply(dock.matrixWorld);
      matrix.decompose(statusDock.position,statusDock.quaternion,statusDock.scale);
      statusDock.translateY(-.12);
    } else applyStatusLocalOffsets(useWrist);
    lastStatusAt=performance.now();statusHasPose=true;return true;
  }

  function attachDockToPreferredGrip() {
    peelDockOffHands();
    const { parent, dockParent, useWrist } = preferredDockTarget();
    if (!parent || !dockParent) return false;
    const want = preferredDockHand === "right" ? "right" : "left";
    const live = sourceHandedness(parent.userData?.inputSource) || liveHandednessAlong(dockParent);
    if (live && live !== want) return false;
    // First Quest frame lists the right Touch first / unlabeled. Stay head-locked
    // until handedness matches Settings (default left).
    if (performance.now() < dockIgnoreGripsUntil && live !== want) return false;
    if (isDefinitelyOtherDockHand(parent) || isDefinitelyOtherDockHand(dockParent)) return false;
    if (liveHandednessAlong(dockParent) === otherDockHand(want)) return false;
    const posed = objectIsPosed(dockParent);
    if (!posed) return false;
    if (
      shouldRequireDockSideCheck({ liveHandedness: live, preferredHand: want })
      && isReasonableXrHead()
      && !nodeIsOnPreferredSide(dockParent, want)
    ) return false;

    copyWorldPose(dockParent, dockAnchor);
    lastDockAt = performance.now();
    dockHasPose = true;
    ensureDockOnAnchor();
    applyDockLocalOffsets(useWrist);
    return true;
  }

  function rebindXrInputHosts(reason = "") {
    if (!presenting) return;
    wristHistoryFlick.reset();
    if (reason === "visibility" || reason === "inputsources" || reason === "refspace" || reason === "document") {
      dockHasPose = false;
      lastToolHandSig = "";
      dockIgnoreGripsUntil = 0;
    }
    try { bindHandednessFromSession(); } catch (_) {}
    try { syncInputVisibility(); } catch (_) {}
    try { updateDockAttachment(); } catch (_) {}
    try { syncToolHand(); } catch (_) {}
  }

  function pollXrTrackingResume() {
    if (!presenting) return;
    const sess = renderer.xr.getSession?.();
    const vis = String(sess?.visibilityState || "");
    if (vis && vis !== lastSessionVisibility) {
      const becameVisible = vis === "visible" && lastSessionVisibility && lastSessionVisibility !== "visible";
      lastSessionVisibility = vis;
      if (shouldRebindXrDockHosts({ presenting: true, sessionBecameVisible: becameVisible })) {
        rebindXrInputHosts("visibility");
      }
    } else if (vis) {
      lastSessionVisibility = vis;
    }
    let space = null;
    try { space = renderer.xr.getReferenceSpace?.() || null; } catch (_) { space = null; }
    if (space && space !== lastXrRefSpace) {
      const restored = !!lastXrRefSpace;
      lastXrRefSpace = space;
      if (space !== xrBoard.state.appliedRefSpace && shouldRebindXrDockHosts({ presenting: true, referenceSpaceRestored: restored })) {
        rebindXrInputHosts("refspace");
      }
      if (restored) restoreVisibilityWindowPoses("refspace");
    }
  }

  function setPreferredDockHand(hand) {
    preferredDockHand = normalizeDockHand(hand);
    writePreferredDockHand(
      typeof localStorage !== "undefined" ? localStorage : null,
      preferredDockHand,
    );
    dockHasPose = false;
    statusHasPose = false;
    try { dockPalette.setDockHand?.(preferredDockHand); } catch (_) {}
    updateDockAttachment();
  }

  function updateDockAttachment() {
    peelDockOffHands();
    if (isDefinitelyOtherDockHand(dock.parent) || isDefinitelyOtherDockHand(captureDock.parent)) {
      try {
        if (dock.parent && dock.parent !== dockAnchor && dock.parent !== xrHud) {
          dock.parent.remove(dock);
          dockAnchor.add(dock);
        }
      } catch (_) {}
      try {
        if (captureDock.parent && captureDock.parent !== dockAnchor && captureDock.parent !== xrHud) {
          captureDock.parent.remove(captureDock);
          dockAnchor.add(captureDock);
        }
      } catch (_) {}
    }
    const dockLive = attachDockToPreferredGrip();
    const statusLive = attachStatusToLeftGrip();
    if (dockLive) {
      if (!statusLive) attachStatusHeadLocked();
      return true;
    }
    // Tracking gap: keep last pose only briefly, then head-lock — never freeze
    // the menu in world space after a headset don/doff.
    if (shouldKeepFrozenDockPose({
      attachedLive: false,
      lastDockAt,
      now: performance.now(),
      maxStaleMs: 400,
    }) && dockHasPose) {
      ensureDockOnAnchor();
      return true;
    }
    dockHasPose = false;
    return attachDockHeadLocked();
  }

  function attachHudToCamera() {
    updateDockAttachment();
    faceProbe.visible = false;
    faceProbeHideAt = 0;
  }

  function detachHudFromCamera() {
    if (dock.parent && dock.parent !== xrHud) {
      dock.parent.remove(dock);
      xrHud.add(dock);
    }
    if (captureDock.parent && captureDock.parent !== xrHud) {
      captureDock.parent.remove(captureDock);
      xrHud.add(captureDock);
    }
    if (statusDock.parent && statusDock.parent !== xrHud) {
      statusDock.parent.remove(statusDock);
      xrHud.add(statusDock);
    }
    dock.visible = false;
    statusDock.visible = false;
    syncCaptureDockVisibility();
    faceProbe.visible = false;
  }

  function paintWorldUiHover(hit) {
    try {
      const tipId = windowChromeHoverId(hit);
      if (tipId !== clipWindowTooltipId) paintClipWindowTooltip(tipId);
    } catch (_) {}
    const hoverSig = xrUiHoverSignature(hit);
    const robotId = hit?.kind === "robotics-action" ? String(hit.id || "") : "";
    if (robotId && hoverHighlightOn({ hitKind: hit.kind, hovered: true })) {
      if (xrHudHoverId !== robotId) {
        xrHudHoverId = robotId;
        try { paintRoboticsPanel(); } catch (_) {}
      }
    } else if (xrHudHoverId) {
      xrHudHoverId = "";
      try { paintRoboticsPanel(); } catch (_) {}
    }
    if (roboticsPanel?.hits) {
      for (const h of roboticsPanel.hits) {
        const on = hoverHighlightOn({
          hitKind: hit?.kind,
          hovered: !!(hit?.kind === "robotics-action" && hit.id && h.userData.xrRoboticsHit === hit.id),
        });
        if (h.material) h.material.opacity = hoverHighlightOpacity({ hovered: on });
      }
    }
    if (shouldUpdateXrUiHover({ lastSig: lastPointerHoverHit?.__hoverSig || "", nextSig: hoverSig })) {
      if (hit) hit.__hoverSig = hoverSig;
    }
    if (aiPanel?.hits) {
      for (const h of [...aiPanel.hits, ...(aiPanel.pickerHits || [])]) {
        const on = hoverHighlightOn({
          hitKind: hit?.kind,
          hovered: !!(hit?.kind === "ai-action" && hit.id && h.userData.xrAiHit === hit.id),
        });
        h.material.opacity = hoverHighlightOpacity({ hovered: on });
      }
    }
    if (viewPanel?.hits) {
      for (const h of viewPanel.hits) {
        const on = hoverHighlightOn({
          hitKind: hit?.kind,
          hovered: !!(hit?.kind === "view-action" && hit.id && h.userData.xrViewHit === hit.id),
        });
        h.material.opacity = hoverHighlightOpacity({ hovered: on });
      }
    }
    for (const kind of Object.keys(GRID_POPUP_SPECS)) {
      const panel = gridPanelRef(kind);
      if (!panel?.hits) continue;
      for (const h of panel.hits) {
        const on = hoverHighlightOn({
          hitKind: hit?.kind,
          hovered: !!(hit?.kind === "grid-action" && hit.panel === kind && hit.id && h.userData.xrGridHit === hit.id),
        });
        h.material.opacity = hoverHighlightOpacity({ hovered: on });
      }
    }
    if (explorerPanel?.group?.visible) {
      for (const h of explorerPanel.tabHits || []) {
        const on = hoverHighlightOn({
          hitKind: hit?.kind,
          hovered: hit?.kind === "menu-tab" && hit.tab === h.userData.xrMenuTab,
        });
        h.material.opacity = hoverHighlightOpacity({ hovered: on });
        h.material.color?.setHex?.(0x7dd3fc);
      }
      for (const h of explorerPanel.rowHits || []) {
        const on = hit?.kind === "menu-row" && explorerPanel.lines?.[h.userData.xrMenuRow] === hit.line;
        h.material.opacity = on ? 0.26 : 0.001;
      }
    }
    try {
      if (toolWheel?.isVisible?.()) {
        toolWheel.setHovered?.(hit?.kind === "tool" ? hit.tool : "");
      } else {
        toolWheel.setHovered?.("");
      }
    } catch (_) {}
    try { toolHand.setHovered?.(hit?.kind === "tool" ? hit.tool : ""); } catch (_) {}
    try { dockPalette.setHovered?.(hit?.kind === "tool" ? hit.tool : ""); } catch (_) {}
    dockButtons.forEach((btn) => {
      const hover = hit?.kind === "tool" && hit.tool === btn.userData.xrTool;
      const on = btn.userData.xrTool === activeTool
        || (btn.userData.xrTool === "voice_mold" && voiceMoldLive)
        || (btn.userData.xrTool === "ai" && (aiHubPanel?.group?.visible || aiPanel?.group?.visible))
        || (btn.userData.xrTool === "view" && viewPanel?.group?.visible)
        || (btn.userData.xrTool === "tools" && toolsPanel?.group?.visible)
        || (btn.userData.xrTool === "settings" && settingsPanel?.group?.visible)
        || (btn.userData.xrTool === "social" && socialHubPanel?.group?.visible)
        || (btn.userData.xrTool === "guides" && guidesPanel?.group?.visible)
        || (btn.userData.xrTool === "menu" && explorerPanel?.group?.visible)
        || (btn.userData.xrTool === "robotics" && roboticsPanel?.group?.visible)
        || (btn.userData.xrTool === "draw" && activeTool === "draw")
        || (btn.userData.xrTool === "voice_draw" && activeTool === "draw")
        || (btn.userData.xrTool === "wheel" && toolWheel.isVisible());
      const s = hover ? 1.16 : on ? 1.1 : 1;
      btn.scale.setScalar(s);
      btn.userData.puck?.scale.setScalar(s);
    });
    captureDockButtons.forEach((btn) => {
      const hover = hit?.kind === "tool" && hit.tool === btn.userData.xrTool;
      const hot = captureRecState.recording && (btn.userData.xrTool === "record_stop" || btn.userData.xrTool === "record_pause");
      btn.scale.setScalar(hover ? 1.28 : hot ? 1.1 : 1);
      if (btn.userData.ring) {
        btn.userData.ring.material.opacity = hover ? 1 : (hot ? 0.55 : 0);
      }
    });
  }

  function studioGripGrabOpts(extra = {}) {
    return {
      armed: isDimosStealingGrip(),
      uiHit: extra.uiHit === true || isUiPick(lastPointerHoverHit),
      nearMenu: extra.nearMenu === true || lastMenuAimNear,
    };
  }

  function publishDimosStudioUiOverride() {
    const leftPtr = aimPointer(0);
    const rightPtr = aimPointer(1);
    const leftHit = leftPtr ? pickControllerSelectHit(leftPtr) : null;
    const rightHit = rightPtr ? pickControllerSelectHit(rightPtr) : null;
    const leftUi = studioRoboticsInputAllowed({armed:isDimosTeleopArmed(),control:"trigger",uiHit:isUiPick(leftHit),hit:leftHit});
    const rightUi = studioRoboticsInputAllowed({armed:isDimosTeleopArmed(),control:"trigger",uiHit:isUiPick(rightHit),hit:rightHit});
    setDimosStudioUiOverride({
      uiHit: leftUi || rightUi,
      nearMenu: false,
      left: leftUi,
      right: rightUi,
      nearMenuLeft: false,
      nearMenuRight: false,
    });
  }

  const pickUiSurfaceRay = createUiSurfaceRayPicker(THREE);
  function menuHitFromAabb(origin, dir) {
    if (!origin || !dir) return null;
    let best = null;
    let bestD = Infinity;
    for (const box of worldMenuAabbs()) {
      if (!rayHitsAabb(origin, dir, box, 3.2)) continue;
      const hit = pickUiSurfaceRay(box.mesh, origin, dir, 3.2);
      if (!hit || !(hit.distance < bestD)) continue;
      best = hit;
      bestD = hit.distance;
    }
    if (!best) return null;
    return {
      kind: "menu-chrome",
      distance: best.distance,
      point: new THREE.Vector3(best.point.x, best.point.y, best.point.z),
      fromAabb: true,
    };
  }

  function updateControllerRays() {
    lastMenuAimNear = false;
    lastRayOnMenu = false;
    resetHandCamAimFlags();
    updateHandRays({ pick: true });
    let combined = null;
    let aimFrom = null;
    for (let i = 0; i < controllers.length; i += 1) {
      const controller = controllers[i];
      if (!controller || !presenting) {
        const ray = controller?.getObjectByName?.("xrRay");
        const tip = controller?.getObjectByName?.("xrRayTip");
        if (ray) ray.visible = false;
        if (tip) tip.visible = false;
        continue;
      }
      syncControllerAimFromXrFrame(controller, i);
      const hi = squeezeHandIndex(controller);
      const grip = hi === 0 ? getLeftGrip() : hi === 1 ? getRightGrip() : (grips[i] || null);
      const aim = (hi === 0 || hi === 1) ? (aimPointer(hi) || controller) : controller;
      const live = (aim && aim !== controller && objectIsPosed(aim))
        ? aim
        : (grip && grip !== controller && objectIsPosed(grip) ? grip : null);
      if (live && !objectIsPosed(controller)) {
        try {
          live.updateMatrixWorld(true);
          controller.position.setFromMatrixPosition(live.matrixWorld);
          controller.quaternion.setFromRotationMatrix(live.matrixWorld);
          controller.updateMatrixWorld(true);
        } catch (_) {}
      }
      const posed = objectIsPosed(controller);
      const { ray, tip } = ensureControllerPickLaser(controller);
      if (!presenting) {
        if (ray) ray.visible = false;
        if (tip) tip.visible = false;
        continue;
      }
      // Same node as xrRay: identity target-ray already copied from grip in sync.
      controller.visible = true;
      const pickAim = controller;
      if (!presentingPickLasersOn({ presenting, posed })) {
        if (ray) ray.visible = false;
        if (tip) tip.visible = false;
        continue;
      }
      const hit = pickControllerSelectHit(pickAim);
      if (hit && hudHitStealsCad(hit)) lastRayOnMenu = true;
      if (hit) {
        const next = preferUiHoverHit(combined, hit);
        if (next === hit) {
          combined = hit;
          aimFrom = pickAim;
        }
      }
      const uiHover = !!(hit && hudHitStealsCad(hit));
      const hideLaser = pointerHideLaserForHand(hi);
      const style = xrPointerStyle({
        hit, ui: uiHover, presenting, posed,
        bright: !!bButtonHeld && !hideLaser,
        holding: gripGrab?.hand === hi || panelDrag?.hand === hi
          || !!(grabState && squeezeHandIndex(grabState.controller) === hi),
        hideLaser,
        tipOffsetM: pointerTipOffsetM(),
      });
      const beamOn = style.beam && laserVisibleForAim(hit, { force: !hideLaser, hideLaser });
      if (ray) {
        ray.renderOrder = XR_LASER_OVER_UI_ORDER;
        ray.visible = beamOn;
        ray.scale.set(1, 1, beamOn ? style.distance : 0);
        if (ray.material) {
          ray.material.color?.setHex?.(style.color);
          ray.material.opacity = style.opacity;
          ray.material.depthTest = false;
          ray.material.depthWrite = false;
          ray.material.transparent = true;
        }
      }
      if (tip) {
        tip.renderOrder = XR_LASER_OVER_UI_ORDER + 1;
        tip.visible = style.visible && pointerTipVisible({
          presenting, useRay: beamOn, hideLaser,
        });
        tip.position.z = -(style.distance || pointerTipOffsetM());
        tip.scale.setScalar(1);
        tip.material?.color?.setHex?.(style.color);
        tip.geometry = beamOn ? tip.userData.pointerDot : tip.userData.pointerPoint;
      }
    }
    lastPointerHoverHit = combined;
    rememberTableLaser(combined, aimFrom || aimPointer(1) || aimPointer(0));
    highlightPrinterBounder(!!(
      printerBounderHit?.visible
      && (combined?.object === printerBounderHit
        || combined?.object?.userData?.xrPrinterBounder
        || combined?.kind === "printer-bounder")
    ));
    updateAimCursor(combined, aimFrom);
    if (presenting) paintWorldUiHover(combined);
    try { applyHandCamHideHover(combined); } catch (_) {}
    try { updateControllerUiOcclusion(); } catch (_) {}
    try { publishDimosStudioUiOverride(); } catch (_) {}
  }

  function worldMenuAabbs() {
    if (menuAabbGen === pickFrameGen) return menuAabbCache;
    const out = [];
    const panels = [
      explorerPanel, aiPanel, viewPanel, roboticsPanel, xrStudio,
      toolsPanel, settingsPanel, aiHubPanel, socialHubPanel, drawPanel,
      workspacePanel, avatarPanel, placePanel,
      guidesPanel, howtoPanel, xrSocialCard, shareInvitePanel, sharedVideo,
      sceneWindows.browser, sceneWindows.display, toolWheel, debuggerHud,
    ];
    for (const panel of panels) {
      const group = panel?.group;
      const plane = panel?.plane || panel?.mesh;
      if (!group?.visible) continue;
      if (plane?.isMesh) {
        try {
          plane.updateMatrixWorld?.(true);
          const box = xrMeshWorldAabbFromGeometry(plane)
            || xrPlaneWorldAabbFromMatrix(0.42, 0.32, plane.matrixWorld?.elements);
          if (box) out.push({...box, mesh:plane});
        } catch (_) { /* ignore a broken panel */ }
      }
      const extra = [...(panel.buttons || []), ...(panel.colorHits || [])];
      for (const mesh of extra) {
        if (!mesh?.isMesh || mesh.visible === false) continue;
        try {
          mesh.updateMatrixWorld?.(true);
          const box = xrMeshWorldAabbFromGeometry(mesh);
          if (box) out.push({...box, mesh});
        } catch (_) {}
      }
    }
    menuAabbGen = pickFrameGen;
    menuAabbCache = out;
    return out;
  }

  function setControllerMeshHidden(grip, hidden) {
    if (!grip) return;
    for (const child of [...(grip.children || [])]) {
      if (!child) continue;
      if (child === dock || child === captureDock || child === statusDock) continue;
      if (child.name === "xrRay" || child.name === "xrRayTip") continue;
      child.visible = !hidden;
    }
  }

  function isDockOrHudDescendant(o) {
    let n = o;
    for (let i = 0; i < 12 && n; i += 1) {
      if (n === dock || n === captureDock || n === statusDock || n === xrHud) return true;
      if (xrMeshIsWristOrHudUi(n)) return true;
      n = n.parent;
    }
    return false;
  }

  function styleControllerModelsInFront() {
    const now = performance.now();
    for (const grip of grips) {
      if (!grip) continue;
      grip.renderOrder = XR_CONTROLLER_OVER_UI_ORDER;
      if (!shouldRestyleXrControllerOverlay({
        overlayReady: !!grip.userData?.xrControllerOverlayReady,
        lastStyleAt: Number(grip.userData?._xrOverlayStyledAt) || 0,
        now,
      })) continue;
      grip.userData._xrOverlayStyledAt = now;
      let official = false;
      grip.traverse((o) => {
        if (o === dock || o === captureDock || o === statusDock) return;
        if (isDockOrHudDescendant(o)) return;
        if (styleXrControllerOverlayMesh(o)) {
          restoreControllerMaterial(o);
          if (o.isMesh && !o.userData?.xrFallback) official = true;
        }
      });
      if (official) {
        stripControllerFallback(grip);
        grip.userData.xrControllerOverlayReady = true;
      } else {
        ensureControllerFallback(grip);
      }
    }
    for (const c of controllers) {
      if (!c) continue;
      c.renderOrder = XR_LASER_OVER_UI_ORDER;
      const ray = c.getObjectByName("xrRay");
      const tip = c.getObjectByName("xrRayTip");
      if (ray) {
        ray.renderOrder = XR_LASER_OVER_UI_ORDER;
        if (ray.material) {
          ray.material.depthTest = false;
          ray.material.depthWrite = false;
          ray.material.transparent = true;
        }
      }
      if (tip) {
        tip.renderOrder = XR_LASER_OVER_UI_ORDER + 1;
        if (tip.material) {
          tip.material.depthTest = false;
          tip.material.depthWrite = false;
        }
      }
    }
  }

  function updateControllerUiOcclusion() {
    if (!presenting) return;
    // Hide is always false (controllerModelHiddenForUi). Skip Box3 menu
    // intersect; style overlay once, not every aim frame.
    styleControllerModelsInFront();
  }

  const wristHistoryFlick=createWristHistoryFlick();
  const stickHistoryFlick=createStickHistoryFlick();
  const flickForward=new THREE.Vector3(),flickRight=new THREE.Vector3(),flickHeadForward=new THREE.Vector3();
  function updateWristHistoryFlick(){
    const now=performance.now();
    const sess=renderer.xr.getSession?.();
    const sources=[...(sess?.inputSources||[])];
    const walkHeld=!!roomWalkHeld||!!bButtonHeld;
    const clicks=bothThumbsticksClicked(sources);
    const rightSrc=sources.find(s=>s.handedness==='right')||sources.find(s=>s.gamepad&&s.handedness!=='left');
    const rightStickClicked=!!(rightSrc&&(gamepadActionPressed(rightSrc.gamepad,'stickClick')||xrThumbstickClicked(rightSrc.gamepad)));
    const stickOn=stickHistoryFlickEnabled({
      presenting,
      dimosArmed:isDimosTeleopArmed(),
      walkHeld,
      bothSticksClicked:clicks,
      rightStickClicked,
      drawing:voiceDraw.isDrawing?.(),
      creating:xrSolidDraw.isActive?.(),
      aiBoard:aiDrawWorkspace.isActive(),
    });
    if(!stickOn)stickHistoryFlick.reset();
    else{
      const axes=roomStickAxes(sources);
      const stickAction=stickHistoryFlick.sample({x:axes.right[0],now});
      if(stickAction)setTool(stickAction);
    }
    const hand=getRightGrip(),source=hand?.userData?.inputSource;
    const buttons=source?.gamepad?.buttons || [];
    const enabled=presenting && (!session?.visibilityState || session.visibilityState==='visible') && !!source?.gamepad
      && objectIsPosed(hand) && !isDimosTeleopArmed()
      && !lastRayOnMenu && !isUiPick(lastPointerHoverHit)
      && !gripGrab && !panelDrag && !grabState && !scaleGrab && !oneHandScale
      && !voiceDraw.isDrawing?.() && !xrSolidDraw.isActive?.() && !aiDrawWorkspace.isActive()
      && !buttons.some(b=>b.pressed||b.value>.15);
    if(!enabled){wristHistoryFlick.reset();return;}
    hand.getWorldQuaternion(_q);flickForward.set(0,0,-1).applyQuaternion(_q);
    flickRight.set(1,0,0).applyQuaternion(_headQuat);flickHeadForward.set(0,0,-1).applyQuaternion(_headQuat);
    const action=wristHistoryFlick.sample({yaw:Math.atan2(flickForward.dot(flickRight),flickForward.dot(flickHeadForward)),now});
    if(action)setTool(action);
  }

  function updateWristMenu() {
    if (aButtonHeld && !wheelDismissedThisHold && !toolWheel.isVisible()) {
      showToolWheelInFront();
    }
    try { dockPalette.setReveal?.(1); } catch (_) {}
    syncCaptureDockVisibility();
  }

  function updateDockFollow() {
    updateDockAttachment();
    updateWristMenu();
    updateControllerRays();
    updateWristHistoryFlick();
    try { syncToolHand(); } catch (_) {}
    try { followUnlockedHudPanels(); } catch (_) {}
    try { syncSceneWindowHtmlOverlay(); } catch (_) {}
  }

  function allWindowGroups() {
    return [
      { kind: "menu", group: explorerPanel?.group },
      { kind: "view", group: viewPanel?.group },
      { kind: "ai", group: aiPanel?.group },
      { kind: "studio", group: xrStudio?.group },
      { kind: "settings", group: settingsPanel?.group },
      { kind: "tools", group: toolsPanel?.group },
      { kind: "aiHub", group: aiHubPanel?.group },
      { kind: "socialHub", group: socialHubPanel?.group },
      { kind: "draw", group: drawPanel?.group },
      { kind: "workspace", group: workspacePanel?.group },
      { kind: "avatar", group: avatarPanel?.group },
      { kind: "place", group: placePanel?.group },
      { kind: "guides", group: guidesPanel?.group },
      { kind: "scene-browser", group: sceneWindows.browser?.group },
      { kind: "scene-display", group: sceneWindows.display?.group },
      { kind: "social", group: xrSocialCard?.group },
      { kind: "share-invite", group: shareInvitePanel?.group },
      { kind: "print-settings", group: printSettingsPanel?.group },
      { kind: "howto", group: howtoPanel?.group },
      { kind: "share", group: sharePanel?.group },
      { kind: "debugger", group: debuggerHud?.group },
      { kind: "video", group: sharedVideo?.group },
      { kind: "agent", group: agentAvatar.getPanel() },
      { kind: "agent-join", group: agentJoin.getPanel() },
      { kind: "wiring", group: xrWiringView.getPanel() },
    ].filter((row) => row.group);
  }

  function visibleWindowGroups() {
    return allWindowGroups().filter(row => row.group.visible);
  }

  function layoutOpenWindowsArc() {
    if (!tabbedWindows) tabbedWindows = createXrTabbedWindows(THREE, {
      scene,
      place(root) {
        ensureXrHeadPose();
        const forward = headForwardFlat();
        const right = headRightFlat();
        root.position.copy(_headPos).addScaledVector(forward, .82).addScaledVector(right, -.42);
        root.position.y -= .12;
        root.updateMatrixWorld(true);
        root.userData.xrUserRotated = false;
        facePanelTowardHead(root, root.getWorldPosition(_v));
      },
      face(group) {
        if (!group) return;
        group.updateMatrixWorld(true);
        facePanelTowardHead(group, group.getWorldPosition(_v));
      },
      onClose(id) {
        if (id === 'debugger') closeXrDebugger();
        if (id === 'camera-left' || id === 'camera-right') hideWristCamSide(id.slice(7));
      },
    });
    const names = {video:'Video',agent:'Assistant','agent-join':'Agents',wiring:'Wiring',menu:'Menu',view:'View',ai:'AI Prompt',studio:'Studio',robotics:'Robotics',settings:'Settings',tools:'Tools',aiHub:'AI',socialHub:'Social',draw:'Draw',workspace:'Workspace',avatar:'Avatar',place:'Place',guides:'Guides',social:'People','scene-browser':'Browser','scene-display':'Display','share-invite':'Invite','print-settings':'Print','camera-left':'Left camera','camera-right':'Right camera',howto:'Help',share:'Share',debugger:'Debugger'};
    tabbedWindows.update(allWindowGroups().map(row => ({...row,label:row.label || names[row.kind] || row.kind})), presenting);
  }

  function handleWindowManagerAction(kind, id, controller, group) {
    if (id === "move-this") {
      beginPanelDrag(controller, group, { translateOnly: true, moveSet: false });
      return true;
    }
    if (id === "move-set") {
      beginPanelDrag(controller, group, { translateOnly: true, moveSet: true });
      return true;
    }
    if (id === "rotate") {
      beginPanelDrag(controller, group, { translateOnly: false });
      return true;
    }
    return false;
  }

  function followUnlockedHudPanels() {
    try { layoutOpenWindowsArc(); } catch (_) {}
    const now = performance.now();
    const headMoved = Math.hypot(_headPos.x - lastHudFollowX, _headPos.z - lastHudFollowZ) > 0.012;
    if (!shouldFollowHudThisFrame({
      now,
      lastAt: lastHudFollowAt,
      windowOpened: overlayRelayerDirty === true,
      headMoved,
    })) return;
    lastHudFollowAt = now;
    lastHudFollowX = _headPos.x;
    lastHudFollowZ = _headPos.z;
    const store = hudStorage();
    const draggingGroup = panelDrag?.armed ? panelDrag.group : null;
    const right = headRightFlat();
    const bump = {
      menu: -0.02, view: 0.04, ai: -0.08, studio: 0.08, robotics: 0.12,
      settings: -0.06, tools: 0.06, aiHub: -0.1, socialHub: 0.1, draw: 0.02,
      workspace: -0.12, avatar: 0.14, place: -0.14, guides: 0.16,
      "scene-browser": -0.2, "scene-display": 0.2,
    };
    const rows = [
      { kind: "menu", group: explorerPanel?.group },
      { kind: "view", group: viewPanel?.group },
      { kind: "ai", group: aiPanel?.group },
      { kind: "studio", group: xrStudio?.group },
      { kind: "robotics", group: roboticsPanel?.group },
      { kind: "settings", group: settingsPanel?.group },
      { kind: "tools", group: toolsPanel?.group },
      { kind: "aiHub", group: aiHubPanel?.group },
      { kind: "socialHub", group: socialHubPanel?.group },
      { kind: "draw", group: drawPanel?.group },
      { kind: "workspace", group: workspacePanel?.group },
      { kind: "avatar", group: avatarPanel?.group },
      { kind: "place", group: placePanel?.group },
      { kind: "guides", group: guidesPanel?.group },
      { kind: "scene-browser", group: sceneWindows.browser?.group },
      { kind: "scene-display", group: sceneWindows.display?.group },
    ];
    for (const row of rows) {
      if (!row.group?.visible || tabbedWindows?.isDocked(row.group)) continue;
      if (draggingGroup && draggingGroup === row.group) continue;
      if (row.group.userData?.xrHudParked) continue;
      if (hudKindStaysWorldLocked(row.kind)) continue;
      if (!shouldFollowBeltHud({
        locked: isXrHudLocked(row.kind, store),
        dragging: false,
        parked: !!row.group.userData?.xrHudParked,
        kind: row.kind,
        laserAim: laserPointerActive(),
      })) continue;
      const slot = row.group.userData?.xrWindowSlot;
      const pos = slot
        ? _headPos.clone().addScaledVector(headForwardFlat(), slot.forward).addScaledVector(right, slot.right)
        : defaultMenuWorldPos();
      if (slot) pos.y = _headPos.y + slot.up;
      else {
        const off = Number(bump[row.kind]) || 0;
        if (off) pos.addScaledVector(right, off);
      }
      setPanelWorldPose(row.group, pos);
      facePanelTowardHead(row.group, pos);
    }
  }

  function hitIsUiPanel(hit) {
    return !!hit && (
      hit.kind === "menu-row"
      || hit.kind === "menu-tab"
      || hit.kind === "explorer-drag"
      || hit.kind === "menu-chrome"
      || hit.kind === "ai-drag"
      || hit.kind === "ai-action"
      || hit.kind === "view-drag"
      || hit.kind === "view-action"
      || hit.kind === "view-chrome"
      || hit.kind === "workspace-drag"
      || hit.kind === "workspace-action"
      || hit.kind === "workspace-chrome"
      || hit.kind === "avatar-drag"
      || hit.kind === "avatar-action"
      || hit.kind === "avatar-chrome"
      || hit.kind === "share-invite-drag"
      || hit.kind === "share-invite-action"
      || hit.kind === "share-invite-chrome"
      || hit.kind === "print-settings-drag"
      || hit.kind === "print-settings-action"
      || hit.kind === "print-settings-chrome"
      || hit.kind === "share-video-close"
      || hit.kind === "share-video-drag"
      || hit.kind === "share-video-toggle"
      || hit.kind === "share-video-menu"
      || hit.kind === "share-video-action"
      || hit.kind === "share-video-hide"
      || hit.kind === "share-video-curve"
      || hit.kind === "share-video-anchor"
      || hit.kind === "share-video-resize"
      || isXrSceneWindowHitKind(hit.kind)
      || hit.kind === "clip-friend-row"
      || hit.kind === "clip-friend-key"
      || hit.kind === "clip-friend-search"
      || hit.kind === "clip-friend-close"
      || hit.kind === "clip-friend-chrome"
      || hit.kind === "grid-drag"
      || hit.kind === "grid-action"
      || hit.kind === "grid-chrome"
      || hit.kind === "guides-drag"
      || hit.kind === "guides-action"
      || hit.kind === "guides-clip"
      || hit.kind === "guides-chrome"
      || hit.kind === "menu-close"
      || hit.kind === "place-drag"
      || hit.kind === "place-close"
      ||       hit.kind === "studio-drag"
      || hit.kind === "studio-close"
      || hit.kind === "studio-action"
      || hit.kind === "studio-rotate"
      || hit.kind === "social-card"
      || hit.kind === "wheel-drag"
      || hit.kind === "tool"
      || hit.kind === "color"
      || hit.kind === "solid-handle"
      || hit.kind === "grid-rotate"
      || hit.kind === "robotics-drag"
      || hit.kind === "robotics-action"
      || hit.kind === "robotics-chrome"
      || hit.kind === "robotics-rotate"
      || hit.kind === "menu-action"
      || hit.kind === "menu-rotate"
      || hit.kind === "view-rotate"
      || hit.kind === "debugger-chrome"
    );
  }

  function pointerHitsMenuPlane(controller) {
    if (!controller) return false;
    try {
      controller.updateMatrixWorld?.(true);
      const handAim = controller.userData?.handAim;
      if (handAim?.origin && handAim?.direction) {
        raycaster.ray.origin.copy(handAim.origin);
        raycaster.ray.direction.copy(handAim.direction).normalize();
      } else {
        _mat.identity().extractRotation(controller.matrixWorld);
        raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
        raycaster.ray.direction.set(0, 0, -1).applyMatrix4(_mat);
      }
      if (explorerPanel?.group.visible) {
        explorerPanel.group.updateMatrixWorld(true);
        if (raycaster.intersectObject(explorerPanel.plane, false).length) return true;
      }
      if (aiPanel?.group.visible) {
        aiPanel.group.updateMatrixWorld(true);
        if (raycaster.intersectObject(aiPanel.plane, false).length) return true;
      }
      if (roboticsPanel?.group?.visible && roboticsPanel.plane) {
        roboticsPanel.group.updateMatrixWorld(true);
        if (raycaster.intersectObject(roboticsPanel.plane, false).length) return true;
      }
      if (toolWheel?.group?.visible) {
        toolWheel.group.updateMatrixWorld(true);
        if (raycaster.intersectObject(toolWheel.group, true).length) return true;
      }
    } catch (_) {}
    return false;
  }

  function stickAxisY(gp) {
    const ax = gp?.axes || [];
    if (ax.length >= 4) return Number(ax[3]) || 0;
    if (ax.length >= 2) return Number(ax[1]) || 0;
    return 0;
  }

  function gamepadForHand(handIndex) {
    const sess = renderer.xr.getSession?.();
    if (!sess) return null;
    const want = handIndex === 0 ? "left" : "right";
    for (const source of sess.inputSources) {
      if (source.handedness === want && isPhysicalControllerSource(source)) {
        return source.gamepad || null;
      }
    }
    return null;
  }

  /** Thumbstick Y scrolls the open menu when the laser is on it. Returns true to suppress CAD zoom. */
  function applyMenuStickScroll() {
    if (!explorerPanel?.group.visible && !aiPanel?.group.visible) return false;
    const sess = renderer.xr.getSession?.();
    if (!sess) return false;
    let hovered = false;
    for (let hand = 0; hand < 2; hand += 1) {
      const pointer = aimPointer(hand);
      if (pointerHitsMenuPlane(pointer) || hitIsUiPanel(pickWithController(pointer))) {
        hovered = true;
        break;
      }
    }
    if (!hovered) return false;
    let axisY = 0;
    for (let hand = 0; hand < 2; hand += 1) {
      const y = stickAxisY(gamepadForHand(hand));
      if (Math.abs(y) > Math.abs(axisY)) axisY = y;
    }
    if (!explorerPanel?.group.visible) {
      menuStickCarry = 0;
      return true;
    }
    if (Math.abs(axisY) < 0.28) {
      menuStickCarry *= 0.4;
      return true;
    }
    const now = performance.now();
    const dt = Math.min(0.05, (now - (lastMenuStickAt || now)) / 1000) || 0.016;
    lastMenuStickAt = now;
    menuStickCarry += axisY * 9 * dt;
    let stepped = 0;
    while (menuStickCarry >= 1) {
      menuScroll += 1;
      menuStickCarry -= 1;
      stepped += 1;
    }
    while (menuStickCarry <= -1) {
      menuScroll -= 1;
      menuStickCarry += 1;
      stepped += 1;
    }
    if (stepped) {
      const vis = menuVisibleRowCount();
      const max = Math.max(0, menuLineTotal - vis);
      menuScroll = THREE.MathUtils.clamp(menuScroll | 0, 0, max);
      openMenuConsole({ tab: menuTab, keepPose: true });
    }
    return true;
  }

  function overlayMappedHandButtons(inputSources, actionId) {
    const next = [false, false];
    for (const source of inputSources || []) {
      if (!gamepadActionPressed(source?.gamepad, actionId)) continue;
      const hi = source.handedness === "left" ? 0 : 1;
      next[hi] = true;
    }
    return next;
  }

  function pollXrControlListen(sess) {
    const live = xrControlListenState();
    if (!live) return;
    const pads = [];
    for (const src of sess?.inputSources || []) {
      if (src?.gamepad) pads.push(src.gamepad);
    }
    const result = tickXrControlListen({ gamepads: pads, now: performance.now() });
    if (result.mapped || result.expired) {
      if (result.mapped) {
        lastXrControlEv = "remap";
        try {
          xrDevStats.noteEvent?.("remap", { h: "lr", consume: result.actionId || "map" });
        } catch (_) {}
      }
      refreshGridPopupSoon("settings");
    }
  }

  function ensureStickRestartHud() {
    if (stickRestartHud) return stickRestartHud;
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const tex = sharpenCanvasTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.22),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    mesh.renderOrder = 50040;
    mesh.frustumCulled = false;
    const group = new THREE.Group();
    group.name = "xrStickRestartHud";
    group.add(mesh);
    group.visible = false;
    xrHud.add(group);
    stickRestartHud = { group, mesh, canvas, tex };
    return stickRestartHud;
  }

  function updateStickRestartHud(tick) {
    const hud = ensureStickRestartHud();
    if (!tick?.showing) {
      hud.group.visible = false;
      return;
    }
    const ctx = hud.canvas.getContext("2d");
    paintStickRestartHud(ctx, {
      progress: tick.progress,
      label: tick.label || XR_DEBUGGER_HOLD_LABEL,
      spin: (performance.now() / 280) % (Math.PI * 2),
    });
    hud.tex.needsUpdate = true;
    const pos = spawnPanelWorldPos(0, -0.04);
    hud.group.position.copy(pos);
    facePanelTowardHead(hud.group, pos);
    hud.group.visible = true;
  }

  async function restartVrSceneKeepSession() {
    const restartSession = renderer.xr.getSession?.();
    if (!presenting || !restartSession || restartSession.ended) return;
    lastXrControlEv = "restart";
    try {
      xrDevStats.noteEvent?.("restart", { h: "lr", consume: "restart", both: 1, st: 2 });
    } catch (_) {}
    try { restoreStarterControls(); } catch (_) {}
    for (const kind of Object.keys(GRID_POPUP_SPECS)) {
      try { closeGridPopup(kind); } catch (_) {}
    }
    try { hideToolWheel({ force: true }); } catch (_) {}
    try { closeMenuConsole(); } catch (_) {}
    try { endGrab(panelDrag?.controller, { input: null }); } catch (_) {}
    gripPressActive.fill(false);
    gripScaleContact.fill(null);
    lastNearGrip.fill(null);
    try { releaseGripGrab(getLeftGrip()); } catch (_) {}
    try { releaseGripGrab(getRightGrip()); } catch (_) {}
    grabState = null;
    gripGrab = null;
    scaleGrab = null;
    userZoom = 1;
    worldAnchored = false;
    pendingInitialPlace = true;
    stickRestartState = emptyStickRestartState();
    stickRestartArmed = false;
    leftRestartHoldOpen = false;
    leftRestartState = emptyLeftMenuRestartState();
    exitVrHoldState = emptyStickRestartState();
    exitVrHoldHand = -1;
    try { updateStickRestartHud({ showing: false }); } catch (_) {}
    try { updateExitVrHoldRing({ showing: false }); } catch (_) {}
    try {
      // Stay in this immersive-vr session — do not end it or navigate away.
      hydrateXrSessionInputs({ session: restartSession, controllers, force: true });
      const space = await refreshXrReferenceSpace({ xr: renderer.xr, session: restartSession });
      if (space) {
        lastXrRefSpace = space;
        xrBoard.captureRefSpace(renderer, {reset:true});
        roomFloorJoined = false;
      }
    } catch (_) {}
    if (!presenting || restartSession.ended || renderer.xr.getSession?.() !== restartSession) return;
    try { placeCadForSession({ force: true }); } catch (_) {}
    try {
      const lastId = String(
        window.__xrDeferredProjectId
        || window.__xrBootPreferredProjectId
        || window.__xrBootEnter?.projectId
        || "",
      ).trim();
      if (lastId) {
        window.__xrDeferredProjectId = lastId;
        flushDeferredXrProject();
      }
    } catch (_) {}
  }

  function softRefreshVrStayInHeadset({ ev = "restart" } = {}) {
    if (softRefreshArmed) return false;
    softRefreshArmed = true;
    lastXrControlEv = ev;
    try { xrDevStats.noteEvent?.(ev, { h: "l", consume: "soft", both: 0, st: ev === XR_LEFT_MENU_RESTART_EVENT ? 0 : 1 }); } catch (_) {}
    leftRestartHoldOpen = false;
    leftRestartState = emptyLeftMenuRestartState();
    exitVrHoldState = emptyStickRestartState();
    exitVrHoldHand = -1;
    try { updateStickRestartHud({ showing: false }); } catch (_) {}
    try { updateExitVrHoldRing({ showing: false }); } catch (_) {}
    void restartVrSceneKeepSession().catch((err) => {
      console.warn("[viewport-xr] scene restart", err);
    }).finally(() => {
      softRefreshArmed = false;
    });
    return true;
  }

  function findExitVrHudButton() {
    const lists = [dockButtons, captureDockButtons, dockPalette?.buttons, dockPalette?.statusHits, toolHand?.buttons];
    for (const list of lists) {
      if (!list?.length) continue;
      for (const btn of list) {
        if (btn?.userData?.xrTool === "exit") return btn;
      }
    }
    return null;
  }

  function ensureExitVrHoldRing() {
    if (exitVrHoldRing?.mesh) return exitVrHoldRing;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const tex = sharpenCanvasTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.036, 0.036),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    mesh.name = "xrExitVrHoldRing";
    mesh.renderOrder = 10140;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.raycast = () => {};
    try { disableXrPointerRaycast(mesh); } catch (_) {}
    exitVrHoldRing = { mesh, canvas, tex };
    return exitVrHoldRing;
  }

  function updateExitVrHoldRing(tick) {
    const hud = ensureExitVrHoldRing();
    const btn = findExitVrHudButton();
    if (!tick?.showing || !btn) {
      hud.mesh.visible = false;
      if (hud.mesh.parent) hud.mesh.parent.remove(hud.mesh);
      return;
    }
    if (hud.mesh.parent !== btn) {
      try { hud.mesh.parent?.remove(hud.mesh); } catch (_) {}
      btn.add(hud.mesh);
      hud.mesh.position.set(0, 0, 0.012);
    }
    const ctx = hud.canvas.getContext("2d");
    paintExitVrHoldCircle(ctx, { progress: tick.progress, size: 128 });
    hud.tex.needsUpdate = true;
    hud.mesh.visible = true;
    void XR_EXIT_VR_HOLD_LABEL;
  }

  function beginExitVrHold(hand = -1) {
    if (exitVrHoldState.started && !exitVrHoldState.fired) return;
    const hi = hand === 0 || hand === 1 ? hand : -1;
    exitVrHoldHand = hi;
    const now = performance.now();
    exitVrHoldState = { downAt: now > 0 ? now : 0.001, progress: 0, fired: false, started: true };
  }

  function cancelExitVrHold() {
    const was = exitVrHoldState.started && !exitVrHoldState.fired;
    exitVrHoldState = emptyStickRestartState();
    exitVrHoldHand = -1;
    try { updateExitVrHoldRing({ showing: false }); } catch (_) {}
    return was;
  }

  function pollExitVrHold(triggers = [false, false]) {
    if (!exitVrHoldState.started || exitVrHoldState.fired) {
      if (!exitVrHoldState.started) try { updateExitVrHoldRing({ showing: false }); } catch (_) {}
      return;
    }
    const hi = exitVrHoldHand;
    const held = hi === 0 || hi === 1
      ? !!(triggers[hi] || uiSelectPress.held(hi))
      : !!(triggers[0] || triggers[1] || uiSelectPress.held(0) || uiSelectPress.held(1));
    const tick = tickExitVrHold({
      held,
      now: performance.now(),
      state: exitVrHoldState,
      holdMs: XR_EXIT_VR_HOLD_MS,
    });
    exitVrHoldState = tick.next;
    if (tick.tap) {
      cancelExitVrHold();
      void exit();
      return;
    }
    if (tick.cancelled) {
      cancelExitVrHold();
      return;
    }
    if (tick.complete) {
      try { updateExitVrHoldRing({ showing: false }); } catch (_) {}
      softRefreshVrStayInHeadset({ ev: XR_EXIT_VR_HOLD_EVENT });
      return;
    }
    if (tick.showing) updateExitVrHoldRing({ ...tick, label: XR_EXIT_VR_HOLD_LABEL });
    else try { updateExitVrHoldRing({ showing: false }); } catch (_) {}
  }

  function toggleLeftMenuConsole() {
    if (explorerPanel?.group?.visible) closeMenuConsole();
    else openMenuConsole({ tab: menuTab || "projects", force: true });
  }

  function cancelLeftMenuRestart({ openMenu = false } = {}) {
    const wasHeld = leftRestartHoldOpen || leftRestartState.started || leftRestartState.downAt > 0;
    const sawRelease = !!leftRestartState.sawRelease;
    const settle = Number(leftRestartState.settle) || 0;
    leftRestartHoldOpen = false;
    leftRestartState = { ...emptyLeftMenuRestartState(), sawRelease, settle };
    try { updateStickRestartHud({ showing: false }); } catch (_) {}
    if (openMenu && wasHeld) {
      try { toggleLeftMenuConsole(); } catch (_) {}
    }
  }

  function ensureDebuggerHud() {
    if (debuggerHud) return debuggerHud;
    const canvas = document.createElement("canvas");
    canvas.width = DEBUGGER_CANVAS.w;
    canvas.height = DEBUGGER_CANVAS.h;
    const tex = sharpenCanvasTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.48, 0.32),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: false,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    mesh.renderOrder = 50050;
    mesh.frustumCulled = false;
    mesh.name = "xrDebuggerHudPlane";
    mesh.userData.xrDebuggerHud = true;
    mesh.userData.xrHudPlane = true;
    const group = new THREE.Group();
    group.name = "xrDebuggerHud";
    group.add(mesh);
    group.visible = false;
    xrHud.add(group);
    debuggerHud = { group, mesh, plane: mesh, canvas, tex };
    return debuggerHud;
  }

  function paintLiveDebuggerHud(sources) {
    const hud = ensureDebuggerHud();
    const state = {
      headset: activeXrHeadset(),
      hands: compactHandsFromSources(sources),
      robotics: getDimosNetworkDebug(),
      listenId: xrControlListenState()?.actionId || "",
    };
    if (debuggerRefresh.shouldPaint(performance.now(), JSON.stringify(state))) {
      paintDebuggerHud(hud.canvas.getContext("2d"), state);
      hud.tex.needsUpdate = true;
    }
    if (!hud.group.userData.xrManagedWindow) {
      const pos = spawnPanelWorldPos(0, -0.02);
      hud.group.position.copy(pos);
      facePanelTowardHead(hud.group, pos);
    }
  }

  function closeXrDebugger({ sendLog = false } = {}) {
    if (sendLog) {
      try { xrDevStats.keepRecording?.(); } catch (_) {}
      void sendXrDebugLogToPc({ exitFlush: true });
    }
    debuggerOpen = false;
    prevBothStickClicks = false;
    try { debuggerHud && (debuggerHud.group.visible = false); } catch (_) {}
    try { xrDevStats.noteEvent?.("dbg-end", { h: "lr", consume: "dbg" }); } catch (_) {}
  }

  function openXrDebugger(sess) {
    debuggerOpen = true;
    debuggerRefresh.reset();
    ensureDebuggerHud().group.visible = true;
    debuggerExitArmed = false;
    persistDeveloperMode(true);
    try { xrDevStats.keepRecording?.(); } catch (_) {}
    lastXrControlEv = "dbg";
    try { xrDevStats.noteEvent?.("dbg", { h: "lr", consume: "dbg", both: 1, st: 2 }); } catch (_) {}
    paintLiveDebuggerHud(sess?.inputSources || []);
    try { updateStickRestartHud({ showing: false }); } catch (_) {}
  }

  function leftRestartInputPosed(sources) {
    try {
      if (objectIsPosed(getLeftGrip())) return true;
    } catch (_) {}
    try {
      const frame = renderer.xr.getFrame?.();
      const ref = renderer.xr.getReferenceSpace?.();
      if (frame && ref) {
        for (const s of sources || []) {
          if (s?.handedness !== "left") continue;
          const space = s.gripSpace || s.targetRaySpace;
          if (!space) continue;
          try {
            if (frame.getPose(space, ref)) return true;
          } catch (_) {}
        }
      }
    } catch (_) {}
    return leftMenuSourcesPosed(sources);
  }

  function pollLeftMenuRestart(sess, sources) {
    const now = performance.now();
    if (xrIgnoreStickyPress({
      enteredAt: xrPresentStartedAt,
      now,
      ignoreMs: XR_ENTER_STICKY_IGNORE_MS,
    })) {
      leftRestartHoldOpen = false;
      try { updateStickRestartHud({ showing: false }); } catch (_) {}
      return false;
    }
    let source = "";
    for (const s of sources || []) {
      if (s?.handedness !== "left" || !s?.gamepad) continue;
      const next = leftMenuHoldSource(s.gamepad);
      if (next === "menu") {
        source = "menu";
        break;
      }
      if (next && !source) source = next;
    }
    const held = source === "menu" && leftMenuOnlyHeld(sources);
    const posed = leftRestartInputPosed(sources);
    const tick = tickLeftMenuRestart({
      held,
      posed,
      now,
      state: leftRestartState,
      holdMs: XR_LEFT_MENU_RESTART_HOLD_MS,
      settleFrames: XR_LEFT_MENU_RESTART_SETTLE_FRAMES,
      settleMs: XR_LEFT_MENU_RESTART_SETTLE_MS,
    });
    leftRestartState = tick.next;
    leftRestartHoldOpen = tick.showing === true;
    if (tick.cancelled) {
      try { updateStickRestartHud({ showing: false }); } catch (_) {}
      try { toggleLeftMenuConsole(); } catch (_) {}
      leftRestartHoldOpen = false;
      return false;
    }
    if (tick.showing && source !== "menu") {
      try { updateStickRestartHud({ showing: false }); } catch (_) {}
      leftRestartHoldOpen = false;
      return false;
    }
    if (tick.complete) {
      try { hideToolWheel({ force: true }); } catch (_) {}
      updateStickRestartHud({ showing: false });
      softRefreshVrStayInHeadset({ ev: XR_LEFT_MENU_RESTART_EVENT });
      return true;
    }
    if (tick.showing) {
      try { hideToolWheel({ force: true }); } catch (_) {}
      updateStickRestartHud({ ...tick, label: XR_STICK_RESTART_LABEL });
      return true;
    }
    try { updateStickRestartHud({ showing: false }); } catch (_) {}
    return false;
  }

  function pollStickDebugger(sess) {
    const sources = [...(sess?.inputSources || [])];
    const clicks = bothThumbsticksClicked(sources);
    const enterHeld = debuggerEnterHeld(sources);
    stickRestartArmed = clicks || enterHeld || leftRestartHoldOpen;
    if (debuggerOpen) {
      cancelLeftMenuRestart();
      paintLiveDebuggerHud(sources);
      if (!clicks) debuggerExitArmed = true;
      if (debuggerExitArmed && clicks && !prevBothStickClicks) {
        closeXrDebugger({ sendLog: true });
      }
      prevBothStickClicks = clicks;
      stickRestartState = emptyStickRestartState();
      return;
    }
    if (enterHeld) {
      cancelLeftMenuRestart();
      const tick = tickStickRestart({
        bothDown: true,
        now: performance.now(),
        state: stickRestartState,
        holdMs: XR_DEBUGGER_HOLD_MS,
      });
      stickRestartState = tick.next;
      updateStickRestartHud({ ...tick, label: XR_DEBUGGER_HOLD_LABEL });
      if (tick.complete) {
        openXrDebugger(sess);
      }
      prevBothStickClicks = clicks;
      return;
    }
    stickRestartState = emptyStickRestartState();
    if (pollLeftMenuRestart(sess, sources)) {
      prevBothStickClicks = clicks;
      return;
    }
    prevBothStickClicks = clicks;
  }

  function pollRemappedRestart(sess) {
    if (debuggerOpen || leftRestartHoldOpen || xrControlListenState() || !xrRestartIsLiveButton()) {
      prevRestartDown = true;
      return;
    }
    let down = false;
    for (const src of sess?.inputSources || []) {
      if (gamepadActionPressed(src?.gamepad, "restart")) {
        down = true;
        break;
      }
    }
    if (down && !prevRestartDown) softRefreshVrStayInHeadset();
    prevRestartDown = down;
  }

  function pollGamepads() {
    const sess = renderer.xr.getSession?.();
    if (!sess) return;

    // A/B first — Draw/Create/gizmo must not skip the tool wheel. sampleXrHands
    // throwing used to leave aButtonHeld stuck and lock the wheel after a tool pick.
    const roboticsOwnsControls = isDimosTeleopArmed();
    const roboticsClaimsFaceButtons = roboticsOwnsControls || !!roboticsIntegratedProfile();
    // L3+R3 stays available while Robotics owns the controllers so connection
    // failures can be inspected without disarming the robot first.
    try { pollStickDebugger(sess); } catch (_) {}
    if (roboticsOwnsControls) {
      aButtonHeld = false; bButtonHeld = false; leftMenuBtnHeld = false;

    }
    if (!roboticsOwnsControls) {
    if (!roboticsClaimsFaceButtons && shouldPollStudioFaceButtons()) {
      try { pollAbButtons(sess); } catch (_) {}
    }
    try { pollXrControlListen(sess); } catch (_) {}
    if (!roboticsClaimsFaceButtons) try { pollRemappedRestart(sess); } catch (_) {}
    }

    let sampled;
    try {
      sampled = sampleXrHands();
    } catch {
      sampled = {
        squeezes: [false, false],
        triggers: [false, false],
        pinches: [false, false],
        hasHand: [false, false],
        hasController: [false, false],
        pointers: [null, null],
      };
    }
    let squeezes = applySessionSqueezePoll(sampled.squeezes, sess.inputSources);
    let triggers = applySessionTriggerPoll(sampled.triggers, sess.inputSources);
    const mappedTrig = roboticsOwnsControls ? [false, false] : overlayMappedHandButtons(sess.inputSources, "trigger");
    triggers = [triggers[0] || mappedTrig[0], triggers[1] || mappedTrig[1]];
    if (!roboticsOwnsControls && mappedButtonIndex("trigger") !== 0) {
      triggers = mappedTrig.map((down, hand) => down || !!sampled.pinches?.[hand]);
    }
    if (!roboticsOwnsControls && mappedButtonIndex("squeeze") !== 1) {
      squeezes = overlayMappedHandButtons(sess.inputSources, "squeeze");
    }
    if (xrIgnoreStickyPress({
      enteredAt: xrPresentStartedAt,
      now: performance.now(),
      ignoreMs: XR_ENTER_STICKY_IGNORE_MS,
    })) {
      triggers = [false, false];
      squeezes = [false, false];
    }

    // Trigger / pinch edge: Quest AR often skips controller selectstart, so poll
    // gamepad button 0 for controllers as well as hands.
    for (let handIndex = 0; handIndex < 2; handIndex += 1) {
      const pressed = triggers[handIndex];
      if (!pressed) uiSelectPress.release(handIndex);
      const was = prevTrigger[handIndex];
      const grip = handIndex === 0 ? getLeftGrip() : getRightGrip();
      const aim = aimPointer(handIndex);
      const pointer = xrPollSelectPointer({
        triggerPressed: pressed,
        aim,
        aimPosed: objectIsPosed(aim),
        gripPosed: objectIsPosed(grip),
        grip,
        fallback: fallbackSelectPointer(handIndex),
      });
      const laserCtrl = posedControllerForHand(handIndex);
      const laser = laserPickNode({
        controller: laserCtrl,
        controllerPosed: objectIsPosed(laserCtrl),
        aim: pointer,
        aimPosed: objectIsPosed(pointer),
      }) || laserCtrl || pointer;
      if (xrTriggerRayMiss({ triggerPressed: pressed, wasPressed: was, pointer: laser || pointer })) {
        try {
          globalThis.dispatchEvent?.(new CustomEvent("studio-credit-incident", {
            detail: { eventType: "controller.trigger.miss", note: "trigger edge with no posed ray", hand: handIndex },
          }));
        } catch (_) { /* stamp only — do not break trigger */ }
      }
      if (roboticsOwnsControls) {
        const menuHit = (laser || pointer) ? pickControllerSelectHit(laser || pointer) : null;
        const studioMayUse = studioRoboticsInputAllowed({
          armed: true,
          control: "trigger",
          uiHit: isUiPick(menuHit),
          hit: menuHit,
          astraTalk: !!voiceMoldLive,
        });
        if (!studioMayUse) {
          if (!pressed && was && pointer) endGrab(pointer);
          prevTrigger[handIndex] = pressed;
          continue;
        }
        if (pressed && isUiPick(menuHit)) reserveDimosMenuTrigger(handIndex === 0 ? "left" : "right");
      }
      if (pressed && uiSelectPress.held(handIndex)) {
        prevTrigger[handIndex] = true;
        continue;
      }
      if ((activeTool === "teleport" || xrBoard?.state?.teleport) && pointer) {
        const hit = pickWithController(pointer);
        if (hit?.kind === "board" && hit.point) {
          xrBoard.previewTeleport(hit.point);
          if (pressed && !was) confirmTeleportTo(hit.point);
        } else {
          xrBoard.hideTeleportPreview();
        }
        if (pressed) {
          prevTrigger[handIndex] = pressed;
          continue;
        }
      }
      if ((gripGrab && gripGrab.hand === handIndex)
        || (panelDrag?.input === "grip" && panelDrag.hand === handIndex)) {
        prevTrigger[handIndex] = pressed;
        continue;
      }
      if (pressed && (laser || pointer)) {
        const selfHit = pickControllerSelectHit(laser || pointer);
        if (isUiPick(selfHit) || xrUiPickBlocksDraw(selfHit)) {
          if (!was) handleSelect(laser || pointer);
          prevTrigger[handIndex] = pressed;
          continue;
        }
      }
      if (aiDrawWorkspace.isActive() && (laser || pointer)) {
        if (aiDrawWorkspace.sample(handIndex, laser || pointer, pressed)) {
          prevTrigger[handIndex] = pressed;
          continue;
        }
        if (!pressed) aiDrawWorkspace.hover(laser || pointer);
      }
      if (activeTool === "draw" && pointer) {
        if (pressed) {
          const drawing = sampleVoiceDraw(handIndex, pointer);
          if (drawing) {
            prevTrigger[handIndex] = pressed;
            continue;
          }
        } else if (was) {
          try {
            const ended = voiceDraw.end();
            if (ended) {
              const main = voiceDraw.lastStroke?.() || null;
              const stroke = voiceDraw.serializeStroke?.();
              if (stroke && typeof sendCollab === "function") {
                const author = localAuthor();
                sendCollab({
                  type: "xr.stroke",
                  stroke: { ...stroke, authorId: author.id, authorName: author.name },
                });
              }
              try { sendPublicXr?.({ type: "xr.stroke", stroke }); } catch (_) {}
              const recs = main ? [main] : [];
              const mirrored = xrBuild.mirrorPoints(voiceDraw.lastStrokes?.(1)?.[0]?.points);
              if (mirrored) {
                voiceDraw.applyRemoteStroke?.("mirror", { points: mirrored, color: drawColor });
                const mirrorRec = voiceDraw.lastStroke?.();
                if (mirrorRec && mirrorRec !== main) recs.push(mirrorRec);
              }
              if (recs.length) recordXrCreate({ type: "stroke", recs });
            }
          } catch (_) {}
        }
      }
      if (activeTool === "wall_height" && pointer) {
        if (pressed) {
          const pt = solidDrawPoint(pointer);
          if (pt) {
            if (!xrBuild.isPullingHeight()) xrBuild.beginWallHeight(pt);
            else xrBuild.pullWallHeight(pt);
          }
          prevTrigger[handIndex] = pressed;
          continue;
        } else if (was) {
          xrBuild.finishWallHeight();
        }
      }
      if (activeTool === "group_select" && pointer) {
        if (groupNamePanel?.group?.visible) {
          refreshGroupNamePanel();
        } else if (pressed) {
          sampleGroupSelect(pointer);
          prevTrigger[handIndex] = pressed;
          continue;
        } else if (was) {
          finishGroupSelect();
        }
      }
      if (String(activeTool || "").startsWith("create_") && pointer) {
        if (pressed) {
          const drawing = sampleSolidDraw(handIndex, pointer);
          if (drawing) {
            prevTrigger[handIndex] = pressed;
            continue;
          }
        } else if (was) {
          try {
            if (xrSolidDraw.isHandleDragging?.()) {
              xrSolidDraw.finishHandle?.();
            } else {
            const author = localAuthor();
            const spec = xrSolidDraw.finish(author.id || author.name ? {
              authorId: author.id,
              authorName: author.name,
            } : {});
            if (spec) {
              commitXrSolidSpec(spec);
              if (spec.drawId) {
                const payload = {
                  type: "xr.draw",
                  action: "solid",
                  draw_id: spec.drawId,
                  kind: spec.kind,
                  sizeM: spec.sizeM,
                  worldPosition: spec.worldPosition
                    ? [round3(spec.worldPosition.x), round3(spec.worldPosition.y), round3(spec.worldPosition.z)]
                    : null,
                  color: spec.color,
                  author_id: spec.authorId,
                  author_name: spec.authorName,
                  created_at: Date.now(),
                };
                try { sendCollab?.(payload); } catch { /* ignore */ }
                try { sendPublicXr?.(payload); } catch { /* ignore */ }
              }
            }
            }
          } catch (err) {
            console.warn("[viewport-xr] solid draw", err);
          }
        }
      }
      if (pressed && !was) {
        if (laser || pointer) handleSelect(laser || pointer);
      }
      if (!pressed && was) {
        if (pointer) endGrab(pointer);
      }
      prevTrigger[handIndex] = pressed;
    }

    if (panelDrag && (panelDrag.hand === 0 || panelDrag.hand === 1)) {
      const hi = panelDrag.hand;
      if (triggers[hi] || squeezes[hi] || sampled.pinches?.[hi]) panelDrag.sawHeld = true;
    }
    if (panelDragShouldDrop({
      panelDrag,
      triggers,
      squeezes,
      pinches: sampled.pinches,
      requireSawHeld: true,
    })) {
      endGrab(panelDrag.controller || panelDrag.grip, { input: panelDrag.input });
    }

    for (let handIndex = 0; handIndex < 2; handIndex += 1) {
      const grip = handIndex === 0 ? getLeftGrip() : getRightGrip();
      const pointer = grip || posedControllerForHand(handIndex) || aimPointer(handIndex);
      if (squeezes[handIndex] && pointer) startStudioGrip(pointer);
      if (!squeezes[handIndex] && gripPressActive[handIndex]) {
        if (pointer) finishStudioGrip(pointer);
        else gripPressActive[handIndex] = false;
      }
    }
    try { pollExitVrHold(triggers); } catch (_) {}

    pollRoomLocomotion(sess, roboticsOwnsControls || applyMenuStickScroll());
    if (roboticsOwnsControls) return;

    prevSqueeze[0] = squeezes[0];
    prevSqueeze[1] = squeezes[1];
  }

  function gamepadFacePressed(gp, index) {
    return gp?.buttons?.[index]?.pressed === true;
  }

  function pollAbButtons(sess) {
    if (xrIgnoreStickyPress({
      enteredAt: xrPresentStartedAt,
      now: performance.now(),
      ignoreMs: XR_ENTER_STICKY_IGNORE_MS,
    })) {
      aButtonHeld = false;
      bButtonHeld = false;
      leftMenuBtnHeld = false;
      return;
    }
    const stealDimos = isDimosStealingFaceButtons();
    if (stealDimos && toolWheel?.group?.visible) {
      hideToolWheel({ force: true });
      wheelDismissedThisHold = true;
    }
    let a = false;
    let b = false;
    for (const source of studioAHoldGamepadSources(sess.inputSources || [])) {
      const gp = source.gamepad;
      if (!gp) continue;
      // DIMOS armed: A starts/stops+saves and B discards; neither reaches Studio.
      // Unlabeled Touch after a tool switch still counts (studioAHoldGamepadSources).
      if (shouldRunStudioAHold({ armed: stealDimos }) && (gamepadActionPressed(gp, "menu") || gamepadFacePressed(gp, mappedButtonIndex("menu")) || gamepadFacePressed(gp, 4))) a = true;
      if (shouldRunStudioLaser({ armed: stealDimos }) && sourceOwnsStudioLaser(source) && (gamepadActionPressed(gp, "laser") || gamepadFacePressed(gp, mappedButtonIndex("laser")))) b = true;
    }
    const wasA = aButtonHeld;
    const wasB = bButtonHeld;
    aButtonHeld = a;
    bButtonHeld = b;
    let leftMenu = false;
    for (const source of sess.inputSources || []) {
      if (!shouldToggleWristMenuOnLeftFace({
        handedness: source?.handedness,
        pressed: studioLeftMenuFacePressed(source?.gamepad),
      })) continue;
      leftMenu = true;
      break;
    }
    const wasLeftMenu = leftMenuBtnHeld;
    leftMenuBtnHeld = leftMenu;
    void wasLeftMenu;
    if (!a) wheelDismissedThisHold = false;
    if (a && !wasA && !leftRestartHoldOpen) {
      wheelDismissedThisHold = false;
      showToolWheelInFront();
    }
    if (!a && wasA) {
      hideToolWheel({ force: true });
      wheelDismissedThisHold = false;
      wristPinned = false;
      wristMenuLatched = false;
    }
    if (b && !wasB) {
      bButtonDownAt = performance.now();
      bHoldResetDone = false;
      wristPinned = false;
      wristMenuLatched = false;
      wheelDismissedThisHold = true;
      toolWheel.setVisible(false);
      if (shouldDismissToolOnBPress({ alreadyPointer: laserAimMode })) {
        restoreStarterControls();
        bHoldResetDone = true;
      } else if (String(activeTool).startsWith("create_") || activeTool === "wall_height") {
        try { xrSolidDraw.cancel(); } catch (_) {}
        try { xrBuild.finishWallHeight(); } catch (_) {}
        activeTool = XR_STARTER_TOOL_ID;
        syncDock();
      }
    }
    if (b && wasB && shouldResetStarterOnBHold({
      heldMs: performance.now() - bButtonDownAt,
      alreadyReset: bHoldResetDone,
    })) {
      bHoldResetDone = true;
      restoreStarterControls();
    }
    if (!b && wasB) {
      bButtonDownAt = 0;
      bHoldResetDone = false;
    }
  }

  function laserPointerActive() {
    return laserPointerModeOn({ bHeld: !!bButtonHeld, aimMode: !!laserAimMode, presenting: !!presenting });
  }

  function pointerToolId() {
    if (aiDrawWorkspace.isActive()) return `board:${aiDrawWorkspace.getTool()}`;
    return activeTool;
  }

  function pointerHideLaserForHand(handIndex) {
    return controllerHidesDrawLaser({
      tool: pointerToolId(),
      hand: handIndex === 0 ? "left" : "right",
      drawHand: xrDrawHand(preferredDockHand),
    });
  }

  function restoreStarterControls() {
    aiDrawWorkspace.cancel();
    try { xrSolidDraw.cancel(); } catch (_) {}
    try { xrBuild.finishWallHeight(); } catch (_) {}
    try { clearMeasure(); } catch (_) {}
    if (activeTool === "draw") {
      try { setVoiceDraw(false); } catch (_) {
        activeTool = XR_STARTER_TOOL_ID;
      }
    } else {
      activeTool = XR_STARTER_TOOL_ID;
    }
    laserAimMode = true;
    wristPinned = false;
    wristMenuLatched = false;
    wheelDismissedThisHold = true;
    try { toolWheel.setVisible(false); } catch (_) {}
    try { toolHand.setVisible?.(false); } catch (_) {}
    menuFooterHint = "Move · grab";
    syncDock();
  }

  function bumpToolHandHistory() {
    lastToolHandSig = "";
  }

  function recordXrCreate(entry) {
    if (!entry) return;
    xrCreateHistory.push(entry);
    bumpToolHandHistory();
  }

  function applyXrCreatePark(entry, parked) {
    if (!entry) return;
    if (entry.type === "stroke") {
      const recs = entry.recs || (entry.rec ? [entry.rec] : []);
      for (const rec of recs) {
        if (parked) voiceDraw.undo?.();
        else voiceDraw.redoStroke?.(rec);
      }
      return;
    }
    if (parked) {
      const last = xrBuild.lastSolid?.();
      if (last && (!entry.solid || last === entry.solid || last.mesh === entry.solid?.mesh)) {
        xrBuild.undoLastSolid?.();
      } else if (entry.solid?.mesh) {
        parkXrObject(entry.solid.mesh, true);
      }
      if (entry.preview) {
        try { xrSolidDraw.parkCommitted?.(entry.preview, true); } catch (_) {
          parkXrObject(entry.preview, true);
        }
      }
    } else {
      if (entry.solid) {
        try { xrBuild.redoSolid?.(entry.solid); } catch (_) {
          parkXrObject(entry.solid.mesh, false);
        }
      }
      if (entry.preview) {
        try { xrSolidDraw.parkCommitted?.(entry.preview, false); } catch (_) {
          parkXrObject(entry.preview, false);
        }
      }
    }
  }

  function undoXrCreateVisual() {
    return undoXrCreate({ skipCad: true });
  }

  function redoXrCreateVisual() {
    return redoXrCreate({ skipCad: true });
  }

  function undoXrCreate({ skipCad = false, fallback = !skipCad } = {}) {
    const entry = xrCreateHistory.undo();
    if (!entry) {
      if (!fallback) return false;
      const fallen = xrBuild.undoLastSolid?.();
      if (fallen) {
        menuFooterHint = `Undid ${fallen.kind || "solid"}`;
        bumpToolHandHistory();
        return true;
      }
      if (voiceDraw.undo?.()) {
        menuFooterHint = voiceDraw.hasStrokes()
          ? `Draw · ${voiceDraw.strokeCount()} stroke${voiceDraw.strokeCount() === 1 ? "" : "s"} · undo last`
          : "Draw · sketch cleared";
        refreshAiPromptPanel();
        bumpToolHandHistory();
        return true;
      }
      return false;
    }
    applyXrCreatePark(entry, true);
    menuFooterHint = entry.type === "stroke"
      ? (voiceDraw.hasStrokes()
        ? `Draw · ${voiceDraw.strokeCount()} stroke${voiceDraw.strokeCount() === 1 ? "" : "s"} · undo last`
        : "Draw · sketch cleared")
      : `Undid ${entry.kind || "solid"}`;
    if (entry.type === "stroke") refreshAiPromptPanel();
    bumpToolHandHistory();
    if (entry.cad && !skipCad) {
      try { (onUndoXrCreateCad || onUndo)?.(); } catch (err) { console.warn("[viewport-xr] undo cad", err); }
    }
    return true;
  }

  function redoXrCreate({ skipCad = false } = {}) {
    const entry = xrCreateHistory.redo();
    if (!entry) return false;
    applyXrCreatePark(entry, false);
    menuFooterHint = entry.type === "stroke" ? "Redo stroke" : `Redid ${entry.kind || "solid"}`;
    if (entry.type === "stroke") refreshAiPromptPanel();
    bumpToolHandHistory();
    if (entry.cad && !skipCad) {
      try { (onRedoXrCreateCad || onRedo)?.(); } catch (err) { console.warn("[viewport-xr] redo cad", err); }
    }
    return true;
  }

  function solidDrawPoint(controller) {
    if (!controller) return null;
    const tip = controllerTipPoint(controller);
    try {
      return xrBuild.snapPointWithJoin?.(tip) || xrBuild.snapPoint(tip);
    } catch {
      return xrBuild.snapPoint(tip);
    }
  }

  function commitXrSolidSpec(spec) {
    if (!spec?.kind) return;
    const mesh = getLiveMesh();
    let localPos = spec.worldPosition?.clone?.() || spec.worldPosition;
    let cad = spec.sizeM || { x: 0.04, y: 0.04, z: 0.04 };
    if (mesh && spec.worldPosition) {
      try {
        mesh.updateMatrixWorld(true);
        localPos = mesh.worldToLocal(spec.worldPosition.clone());
        const ws = Math.abs(mesh.getWorldScale(new THREE.Vector3()).x) || 1;
        cad = {
          x: spec.sizeM.x / ws,
          y: spec.sizeM.y / ws,
          z: spec.sizeM.z / ws,
        };
      } catch (_) {}
    } else {
      cad = {
        x: (spec.sizeM?.x || 0.04) * 1000,
        y: (spec.sizeM?.y || 0.04) * 1000,
        z: (spec.sizeM?.z || 0.04) * 1000,
      };
    }
    const values = { combine: spec.combine || xrBuild.combineMode() || "new" };
    const kind = spec.kind === "wall" || spec.kind === "floor" ? "box" : spec.kind;
    if (spec.kind === "box" || spec.kind === "wall" || spec.kind === "floor") {
      values.length = cad.x;
      values.width = cad.z;
      values.height = cad.y;
    } else if (spec.kind === "sphere") {
      values.radius = Math.max(cad.x, cad.y, cad.z) * 0.5;
    } else if (spec.kind === "torus") {
      values.major_radius = Math.max(cad.x, cad.z) * 0.5;
      values.minor_radius = Math.max(0.2, values.major_radius * 0.22);
    } else {
      values.radius = Math.max(cad.x, cad.z) * 0.5;
      values.bottom_radius = values.radius;
      values.top_radius = spec.kind === "cone" ? 0 : values.radius;
      values.height = cad.y;
    }
    try {
      const cadResult = onCreateXrSolid?.({
        kind,
        values,
        color: spec.color,
        localPos,
        drawId: spec.drawId,
        authorId: spec.authorId,
        authorName: spec.authorName,
        mesh: spec.mesh,
      });
      if (!spec.skipNote) xrBuild.commitSolid(spec);
      recordXrCreate({
        type: "solid",
        kind: spec.kind,
        solid: xrBuild.lastSolid?.(),
        preview: spec.mesh || null,
        cad: !!cadResult,
      });
      if (!spec.skipMirror) {
        const mirror = xrBuild.mirrorPoint(spec.worldPosition);
        if (mirror && spec.worldPosition) {
          try {
            commitXrSolidSpec({
              ...spec,
              worldPosition: mirror,
              combine: values.combine,
              skipMirror: true,
            });
          } catch (_) {}
        }
      }
    } catch (err) {
      console.warn("[viewport-xr] create solid", err);
    }
  }

  function sampleSolidDraw(handIndex, pointer) {
    if (!String(activeTool || "").startsWith("create_") || !pointer) return false;
    const hit = pickControllerSelectHit(pointer);
    if (hit?.kind !== "solid-handle" && (isUiPick(hit) || xrUiPickBlocksDraw(hit))) return false;
    const pt = solidDrawPoint(pointer);
    if (!pt) return true;
    const joinOn = !!xrBuild.snapEnabled?.();
    const joinCorners = [];
    if (joinOn) {
      try {
        const seen = new Set();
        const meshes = [
          ...(xrBuild.listDrawables?.() || []),
          ...(xrSolidDraw.listDrawables?.() || []),
        ];
        for (const mesh of meshes) {
          if (!mesh || seen.has(mesh)) continue;
          seen.add(mesh);
          try { mesh.updateMatrixWorld?.(true); } catch { /* ignore */ }
          const pos = mesh.getWorldPosition?.(new THREE.Vector3()) || mesh.position;
          const sc = mesh.getWorldScale?.(new THREE.Vector3()) || mesh.scale;
          joinCorners.push(...aabbCornersFromCenterSize(
            pos.x,
            pos.y,
            pos.z,
            Math.abs(sc?.x) || 0.04,
            Math.abs(sc?.y) || 0.04,
            Math.abs(sc?.z) || 0.04,
          ));
        }
      } catch { /* ignore */ }
    }
    if (xrSolidDraw.isHandleDragging?.() || hit?.kind === "solid-handle") {
      if (!xrSolidDraw.isHandleDragging?.() && hit?.handle) {
        xrSolidDraw.beginHandle?.(hit.handle, pt);
      }
      xrSolidDraw.updateHandle?.(pt, { joinCorners, join: joinOn });
      return true;
    }
    if (!xrSolidDraw.isActive()) xrSolidDraw.begin(activeTool, pt);
    else xrSolidDraw.update(pt, { joinCorners, join: joinOn });
    return true;
  }

  /**
   * Grip mapping (Quest / Vive / Index, DIMOS-off):
   * - Squeeze only (buttons[1]) — trigger is not required to move or resize.
   * - Both grips or both pinches: two-hand scale/resize (updateTwoHandScale).
   * - Single grip on a CAD surface: attach it with full hand rotation.
   * - Held miss does not acquire; the second hand must contact the held model
   *   or aim its laser at that mesh.
   */
  function updateGripGrab() {
    if (panelDrag || !gripGrab) return;

    if (scaleGrab) return;
    const sampled = sampleXrHands();
    const hand = gripGrab.hand;
    if (!renderer.xr.getSession?.() || !sampled.squeezes[hand]) {
      releaseGripGrab();
      return;
    }
    const src = grabAttachObject(hand, sampled);
    if (!src || !objectIsPosed(src)) return;
    copyWorldPose(src, gripGrabAnchor);
    const mesh = gripGrab.target;
    if (!mesh) return;
    mesh.updateMatrixWorld(true);

    const next = _grabNext.compose(
      gripGrab.offsetPos,
      gripGrab.offsetQuat,
      _grabOne,
    );
    const world = _grabWorld.multiplyMatrices(gripGrabAnchor.matrixWorld, next);
    if (mesh.parent) {
      const inv = _grabInv.copy(mesh.parent.matrixWorld).invert();
      _grabNext.multiplyMatrices(inv, world).decompose(mesh.position, mesh.quaternion, _s);
    } else {
      world.decompose(mesh.position, mesh.quaternion, _s);
    }
    if (mesh.userData?.xrDrawId) {
      if (gripGrab.worldScale) mesh.scale.copy(gripGrab.worldScale);
      sendDrawPose(mesh, true);
      updateDrawAuthorLabel(mesh);
    } else if (mesh.userData?.xrDropId) {
      if (gripGrab.worldScale) mesh.scale.copy(gripGrab.worldScale);
      sendDropTransform(mesh, true);
    } else {
      mesh.scale.copy(gripGrab.worldScale);
      if (mesh === getLiveMesh()) presentationScale = Math.abs(mesh.scale.x);
      notifyMeshMoved(true);
    }
    syncPrinterBounderFollow(mesh);
  }

  function updateGrab() {
    if (isDimosTeleopArmed()) { grabState = null; return; }
    if (!grabState || gripGrab) return;
    const mesh = grabState.target || getLiveMesh();
    if (!mesh) return;
    const { controller, offsetPos, offsetQuat } = grabState;
    const pose = grabState.pose || controller;
    if (!objectIsPosed(pose)) return;
    pose.updateWorldMatrix(true, false);
    const next = _grabNext.compose(offsetPos, offsetQuat, _grabOne);
    const world = _grabWorld.multiplyMatrices(pose.matrixWorld, next);
    if (mesh.parent) {
      const inv = _grabInv.copy(mesh.parent.matrixWorld).invert();
      _grabNext.multiplyMatrices(inv, world).decompose(mesh.position, mesh.quaternion, _s);
    } else {
      world.decompose(mesh.position, mesh.quaternion, _s);
    }
    if (mesh.userData?.xrDropId) {
      if (grabState.worldScale) mesh.scale.copy(grabState.worldScale);
      sendDropTransform(mesh, true);
      return;
    }
    mesh.scale.copy(grabState.worldScale);
    if (mesh === getLiveMesh()) presentationScale = Math.abs(mesh.scale.x);
    syncPrinterBounderFollow(mesh);
    notifyMeshMoved(true);
  }

  function controllerWorldPos(controller, out = new THREE.Vector3()) {
    controller.updateMatrixWorld(true);
    return controller.getWorldPosition(out);
  }

  /** Two-hand resize: Both grips or both pinches, then pull apart / together. */
  function updateTwoHandScale() {
    if (panelDrag) return;
    const sess = renderer.xr.getSession?.();
    if (!sess) {
      if (scaleGrab) {
        scaleGrab = null;
        saveRoomPose();
      }
      return;
    }
    if (!shouldRunStudioGripGrab(studioGripGrabOpts())) {
      if (scaleGrab) {
        scaleGrab = null;
        saveRoomPose();
      }
      return;
    }

    const sampled = sampleXrHands();
    const squeezes = sampled.squeezes;
    const pinches = sampled.pinches;
    const both = (squeezes[0] && squeezes[1]) || (pinches[0] && pinches[1]);
    if (!both) {
      if (scaleGrab) {
        const scaled = scaleGrab.target;
        persistPrinterBounderFromMesh(scaled);
        publicDrops.setLocalGrabId("");
        if (scaled?.userData?.xrDropId) sendDropTransform(scaled, false);
        else {
          saveRoomPose();
          notifyMeshMoved(false);
        }
        scaleGrab = null;
        const remainingHand = squeezes[0] || pinches[0] ? 0 : squeezes[1] || pinches[1] ? 1 : -1;
        if (remainingHand >= 0) {
          const src = grabAttachObject(remainingHand, sampled);
          if (src) {
            copyWorldPose(src, gripGrabAnchor);
            scaled.updateMatrixWorld(true);
            _grabInv.copy(gripGrabAnchor.matrixWorld).invert();
            _grabWorld.multiplyMatrices(_grabInv, scaled.matrixWorld).decompose(_v, _q, _s);
            gripGrab = {
              hand: remainingHand, controller: gripGrabAnchor, target: scaled,
              dropId: scaled.userData?.xrDropId || "",
              offsetPos: _v.clone(), offsetQuat: _q.clone(),
              worldScale: scaled.scale.clone(), scale: Math.abs(scaled.scale.x) || 1,
            };
            publicDrops.setLocalGrabId(gripGrab.dropId);
          }
        }
      }
      prevSqueeze[0] = squeezes[0];
      prevSqueeze[1] = squeezes[1];
      return;
    }

    const mesh = scaleGrab?.target || gripGrab?.target;
    if (!mesh) return;
    if (!scaleGrab) {
      const otherHand = gripGrab.hand === 0 ? 1 : 0;
      if (gripScaleContact[otherHand] !== mesh) return;
    }

    grabState = null;

    const left = grabAttachObject(0, sampled);
    const right = grabAttachObject(1, sampled);
    if (!left || !right || !objectIsPosed(left) || !objectIsPosed(right)) return;
    const a = worldPosOf(left, _scalePosA);
    const b = worldPosOf(right, _scalePosB);
    const dist = a.distanceTo(b);
    // Coincident / crossed hands have no stable scale ratio. Wait for a usable
    // span without imposing a per-gesture size limit on the model.
    if (dist < 0.01) return;
    const mid = a.clone().lerp(b, 0.5);

    if (!scaleGrab) {
      mesh.updateMatrixWorld(true);
      const center = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
      noteDropInteract(mesh);
      publicDrops.setLocalGrabId(mesh.userData?.xrDropId || "");
      scaleGrab = {
        target: mesh,
        startDist: dist,
        startScale: Math.abs(mesh.scale.x) || 1,
        startCenter: center.clone(),
        startMid: mid.clone(),
        startPos: mesh.position.clone(),
      };
      prevSqueeze[0] = true;
      prevSqueeze[1] = true;
      return;
    }

    const factor = dist / scaleGrab.startDist;
    const nextScale = scaleGrab.startScale * factor;
    const cur = Math.abs(mesh.scale.x) || 1;
    const ratio = nextScale / Math.max(cur, 1e-9);
    if (mesh === getLiveMesh()) {
      presentationScale = nextScale;
      baseScale = presentationScale / Math.max(userZoom, 1e-6);
    }

    mesh.updateMatrixWorld(true);
    const center = new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
    const parent = mesh.parent;
    const localCenter = parent ? parent.worldToLocal(center.clone()) : center.clone();
    mesh.scale.multiplyScalar(ratio);
    mesh.position.sub(localCenter).multiplyScalar(ratio).add(localCenter);

    const midDelta = mid.clone().sub(scaleGrab.startMid);
    if (parent) {
      const wp = mesh.getWorldPosition(new THREE.Vector3()).add(midDelta);
      mesh.position.copy(parent.worldToLocal(wp));
      scaleGrab.startMid.copy(mid);
    } else {
      mesh.position.add(midDelta);
      scaleGrab.startMid.copy(mid);
    }
    mesh.updateMatrixWorld(true);
    if (mesh.userData?.xrDropId) sendDropTransform(mesh, true);
    else notifyMeshMoved(true);
    syncPrinterBounderFollow(mesh);
  }

  async function requestXrSession(mode) {
    // hand-tracking is optional: Quest / Vision / Spectacles grant it; Vive/Index ignore it.
    // Do not require it — those HMDs keep xr-standard trigger/squeeze rays.
    const opts = {
      optionalFeatures: ["local-floor", "bounded-floor", "hand-tracking", "hit-test"],
    };
    const begin = (features) => {
      const pending = features
        ? navigator.xr.requestSession(mode, features)
        : navigator.xr.requestSession(mode);
      // Same turn, but AFTER requestSession so Quest keeps user-activation for XR.
      // Do not kill the splash or add xr-presenting until the session is granted —
      // a failed request must keep the headset on the Enter VR screen.
      forceMicOnForSession();
      primeHeadsetMic({ enteringXr: true, force: true });
      return pending;
    };
    const takeBootSession = async () => {
      const pending = window.__bootXrSessionPromise;
      if (!pending) return null;
      window.__bootXrSessionPromise = null;
      const sess = await pending;
      try { window.__bootXrSession = null; } catch (_) {}
      return sess || null;
    };
    try {
      const bootSess = window.__bootXrSessionPromise ? await takeBootSession() : null;
      if (bootSess) {
        forceMicOnForSession();
        primeHeadsetMic({ enteringXr: true, force: true });
        return bootSess;
      }
      return await begin(opts);
    } catch {
      // Same mode, no optional features — do NOT switch AR↔VR here (that burns
      // the Quest user-activation after the first failed requestSession).
      return begin(null);
    }
  }

  function applyPassthroughClear() {
    scene.background = null;
    scene.fog = null;
    renderer.setClearColor(0x000000, 0);
    renderer.setClearAlpha(0);
  }

  function setPassthroughOn(on) {
    if (on && presenting && !sessionIsPassthrough) {
      onStatus?.("error", "Passthrough requires AR support. Exit and re-enter VR Studio to use the updated session mode.");
      return;
    }
    passthroughOn = !!on;
    try {
      localStorage.setItem(LS_PASSTHROUGH, passthroughOn ? "1" : "0");
    } catch {
      /* ignore */
    }
    try { dockPalette.setPassThroughOn?.(passthroughOn); } catch (_) {}
    applyXrEnvironment();
    try { refreshWorkspacePanel(); } catch (_) {}
  }

  const _xrStudioBg = new THREE.Color(0xf7f4ee);
  const _xrWarehouseBg = new THREE.Color(0x1e293b);

  function setXrSceneKind(id) {
    const raw = String(id || "white");
    if (raw !== "workshop" && workshopPrinterTargetActive) {
      printerPlacement = workshopPrinterPreviousPlacement;
      workshopPrinterPreviousPlacement = null;
      workshopPrinterTargetActive = false;
      printerVisualsDirty = true;
      syncPrinterVisuals();
    }
    if (raw === "workshop") {
      workshopExplicitlyRequested = true;
      xrSceneKind = "workshop";
      try { localStorage.setItem("render3d:xrSceneKind", "workshop"); } catch (_) {}
      applyXrEnvironment();
      void ensureWorkshopProjectRoom().then(() => applyXrEnvironment());
      try { onStatus?.("ok", "Workshop · WASD to walk on desktop"); } catch (_) {}
      return;
    }
    if (raw === "white" || raw === "planetary") {
      xrSceneKind = "white";
      try {
        localStorage.setItem("render3d:xrSceneKind", "white");
      } catch (_) {}
      applyXrEnvironment();
      try { onStatus?.("ok", "White room"); } catch (_) {}
      return;
    }
    if (raw === "warehouse") {
      xrSceneKind = "warehouse";
      try {
        localStorage.setItem("render3d:xrSceneKind", "warehouse");
      } catch (_) {}
      applyXrEnvironment();
      try { onStatus?.("ok", "Warehouse"); } catch (_) {}
      return;
    }
    const saved = loadXrEnvironmentStore().find((row) => row.id === raw);
    if (!saved || !shouldApplyEnvironmentWrapNow({ userPickedScene: true, presenting })) {
      xrSceneKind = "white";
      applyXrEnvironment();
      try { onStatus?.("ok", "White room"); } catch (_) {}
      return;
    }
    xrSceneKind = raw;
    xrWrapTexture = applyEquirectWrap(scene, saved, xrWrapTexture, {
      presenting,
      applyToScene: presenting && !shouldApplyEquirectWrapToCadViewport({ presenting }),
    });
    applyXrEnvironment();
    try { onStatus?.("ok", "Environment wrap"); } catch (_) {}
  }

  function applyEnvironmentWrap(payload = {}) {
    const row = upsertSavedEnvironment({
      id: payload.id || `wrap-${Date.now().toString(36)}`,
      label: payload.label || payload.name || "Generated environment",
      url: payload.url || "",
      dataUrl: payload.dataUrl || payload.image_data_url || "",
    });
    const hit = row.find((r) => r.id === (payload.id || row[0]?.id)) || row[0];
    if (!hit) return { ok: false };
    try { refreshWorkspacePanel(); } catch (_) {}
    if (!shouldApplyEnvironmentWrapNow({ userPickedScene: false, presenting })) {
      try { onStatus?.("ok", "Environment saved · Change scene to apply"); } catch (_) {}
      return { ok: true, id: hit.id, applied: false };
    }
    xrSceneKind = hit.id;
    xrWrapTexture = applyEquirectWrap(scene, hit, xrWrapTexture, {
      presenting,
      applyToScene: presenting && !shouldApplyEquirectWrapToCadViewport({ presenting }),
    });
    applyXrEnvironment();
    return { ok: true, id: hit.id, applied: true };
  }

  function applyXrEnvironmentOnEnter() {
    let preferred = "clear";
    try {
      const saved = String(localStorage.getItem("render3d:xrSceneKind") || "").trim();
      // Workshop is a large project GLB. Never restore/load it merely because
      // it was used in a previous session; the current session must click it.
      if (workshopExplicitlyRequested && xrSceneKind === "workshop") preferred = "workshop";
      else if (saved === "warehouse") preferred = "warehouse";
      else if (saved === "white") preferred = "white";
    } catch (_) {}
    xrSceneKind = preferred === "clear" ? "clear" : preferred;
    xrEnvDirty = false;
    applyXrEnvironment();
  }

  function stripWrapFromCadViewport() {
    if (scene.environment === xrWrapTexture || (scene.environment && !scene.environment.isColor)) {
      scene.environment = null;
    }
    if (scene.background === xrWrapTexture) {
      const restored = savedBackground && savedBackground !== xrWrapTexture ? savedBackground : null;
      scene.background = restored;
    }
    if (scene.fog) scene.fog = null;
  }

  function applyXrEnvironment() {
    xrEnvDirty = false;
    if (!presenting && !workspaceJoin) {
      if (xrWhiteRoom) xrWhiteRoom.visible = false;
      if (xrWarehouseRoom) xrWarehouseRoom.visible = false;
      if (xrWorkshopRoom) xrWorkshopRoom.visible = false;
      if (xrWorkshopProjectRoom) xrWorkshopProjectRoom.visible = false;
      try { xrBuild.setSnapGridVisible?.(false); } catch (_) {}
      stripWrapFromCadViewport();
      return;
    }
    scene.environment = null;
    if (scene.background === xrWrapTexture) scene.background = null;
    scene.fog = null;
    const showPass = xrPassthroughShowsRealWorld({
      passthroughOn,
      sessionIsPassthrough,
    });
    const stageOn = xrCheapVrStageVisible({
      presenting: presenting || workspaceJoin,
      passthroughOn,
      sessionIsPassthrough,
    });
    const isWarehouse = xrSceneKind === "warehouse";
    const isWorkshop = xrSceneKind === "workshop";
    if (xrWhiteRoom) xrWhiteRoom.visible = stageOn && !isWarehouse && !isWorkshop;
    if (xrWarehouseRoom) xrWarehouseRoom.visible = stageOn && isWarehouse;
    if (xrWorkshopRoom) xrWorkshopRoom.visible = stageOn && isWorkshop && !xrWorkshopProjectRoom;
    if (xrWorkshopProjectRoom) xrWorkshopProjectRoom.visible = stageOn && isWorkshop;
    // The only load call lives in setXrSceneKind("workshop"), reached from an
    // explicit scene click. Keeping this branch render-only prevents duplicate
    // GLB requests and Chrome/Quest memory spikes during ordinary VR entry.
    if (showPass) {
      applyPassthroughClear();
      return;
    }
    if (isWarehouse || isWorkshop) {
      scene.background = _xrWarehouseBg;
      renderer.setClearColor(0x1e293b, 1);
      renderer.setClearAlpha(1);
      return;
    }
    scene.background = _xrStudioBg;
    renderer.setClearColor(0xf4f1ea, 1);
    renderer.setClearAlpha(1);
  }

  let bootEnter = { emptyScene: false, openMenu: false, tour: false, fromBoot: false, projectId: "" };
  let bootMenuLeftMonitor = false;
  const cadHiddenForEmpty = [];
  let howtoPanel = null;
  let howtoStep = 0;
  const HOWTO_TIPS = [
    {
      title: "Left-hand tools",
      body: "Your tool belt is on the left controller. Point with the other hand and tap Menu, AI, or Draw.",
    },
    {
      title: "This menu",
      body: "Grab the blue title bar to move the window. Pick a project or tap AI to generate a model — the room starts empty.",
    },
    {
      title: "You're in",
      body: "Settings can move the belt to the right hand. Squeeze both grips to resize windows. Tap Done to close these tips.",
    },
  ];

  function consumeBootEnterOpts() {
    const pending = window.__xrBootEnter || {};
    const projectId = String(pending.projectId || window.__xrBootPreferredProjectId || "").trim();
    const tour = !!pending.tour;
    bootEnter = {
      // Tour is the only empty-room override. A stale emptyScene:true with a
      // real lastProjectId used to hide CAD forever and skip the lite load.
      emptyScene: tour || !projectId,
      openMenu: !!pending.openMenu || !!pending.fromBoot,
      tour,
      fromBoot: !!pending.fromBoot,
      projectId,
    };
    window.__xrBootEnter = null;
    if (bootEnter.projectId && !bootEnter.emptyScene && !getLiveMesh()) {
      const already = String(window.__xrDeferredProjectId || "").trim();
      if (!already) {
        try { window.__xrDeferredProjectId = bootEnter.projectId; } catch (_) {}
      }
    }
    return bootEnter;
  }

  function hideCadForEmptyEnter() {
    cadHiddenForEmpty.length = 0;
    const mesh = getLiveMesh();
    if (!mesh) return;
    try {
      if (mesh.visible) {
        cadHiddenForEmpty.push(mesh);
        mesh.visible = false;
      }
    } catch (_) {}
    try { parkXrCadForEnter(mesh); } catch (_) {}
  }

  function restoreCadAfterEmptyEnter() {
    for (const mesh of cadHiddenForEmpty) {
      try { mesh.visible = true; } catch (_) {}
    }
    cadHiddenForEmpty.length = 0;
  }

  function drawHowtoCanvas(step) {
    const tip = HOWTO_TIPS[step] || HOWTO_TIPS[0];
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 320;
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, 512, 320);
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = "#7dd3fc";
    ctx.font = "700 28px Arial, Helvetica, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText("How to use VR", 24, 42);
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "800 32px Arial, Helvetica, sans-serif";
    ctx.fillText(String(tip.title).slice(0, 28), 24, 112);
    ctx.fillStyle = "#cbd5e1";
    ctx.font = "600 22px Arial, Helvetica, sans-serif";
    const words = String(tip.body).split(" ");
    let line = "";
    let y = 150;
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (ctx.measureText(next).width > 464) {
        ctx.fillText(line, 24, y);
        line = w;
        y += 30;
      } else line = next;
    }
    if (line) ctx.fillText(line, 24, y);
    const last = step >= HOWTO_TIPS.length - 1;
    ctx.fillStyle = "#0ea5e9";
    roundRect(ctx, 24, 248, 220, 52, 16);
    ctx.fill();
    ctx.fillStyle = "#1e293b";
    roundRect(ctx, 268, 248, 220, 52, 16);
    ctx.fill();
    ctx.fillStyle = "#f8fafc";
    ctx.font = "800 22px Arial, Helvetica, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(last ? "Done" : "Next", 134, 282);
    ctx.fillText("Close", 378, 282);
    return canvas;
  }

  function ensureHowtoPanel() {
    if (howtoPanel) return howtoPanel;
    const canvas = drawHowtoCanvas(0);
    const tex = sharpenCanvasTex(new THREE.CanvasTexture(canvas));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    const group = new THREE.Group();
    group.name = "xrHowtoTour";
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.44, 0.275),
      new THREE.MeshBasicMaterial({
        map: tex,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    plane.renderOrder = 2090;
    plane.frustumCulled = false;
    const nextHit = new THREE.Mesh(
      new THREE.PlaneGeometry(0.19, 0.05),
      new THREE.MeshBasicMaterial({ color: 0x0ea5e9, depthTest: false, depthWrite: true, toneMapped: false }),
    );
    nextHit.position.set(-0.1, -0.095, 0.004);
    nextHit.userData.xrHowto = "next";
    nextHit.renderOrder = 2092;
    const doneHit = new THREE.Mesh(
      new THREE.PlaneGeometry(0.19, 0.05),
      new THREE.MeshBasicMaterial({ color: 0x1e293b, depthTest: false, depthWrite: true, toneMapped: false }),
    );
    doneHit.position.set(0.1, -0.095, 0.004);
    doneHit.userData.xrHowto = "done";
    doneHit.renderOrder = 2092;
    group.add(plane, nextHit, doneHit);
    howtoPanel = { group, plane, tex, nextHit, doneHit };
    return howtoPanel;
  }

  function refreshHowtoTour() {
    const panel = ensureHowtoPanel();
    const canvas = drawHowtoCanvas(howtoStep);
    panel.tex.image = canvas;
    panel.tex.needsUpdate = true;
    panel.group.visible = true;
  }

  function openHowtoTour() {
    howtoStep = 0;
    const panel = ensureHowtoPanel();
    refreshHowtoTour();
    ensureHudWorldParent(panel.group);
    const pos = defaultMenuWorldPos();
    pos.x += 0.42;
    setPanelWorldPose(panel.group, pos);
    facePanelTowardHead(panel.group, pos);
    panel.group.visible = true;
  }

  function closeHowtoTour() {
    if (howtoPanel?.group) howtoPanel.group.visible = false;
  }

  function advanceHowtoTour() {
    if (howtoStep >= HOWTO_TIPS.length - 1) {
      closeHowtoTour();
      return;
    }
    howtoStep += 1;
    refreshHowtoTour();
  }

  function placeCadForSession({ force = true } = {}) {
    const mesh = getLiveMesh();
    if (!mesh) return false;
    if (worldAnchored && presenting) {
      const sx = Math.abs(Number(mesh.scale?.x) || 0);
      if (mesh.visible && sx >= 1e-4) {
        pendingInitialPlace = false;
        return true;
      }
    }
    try {
      if (shouldRestoreSavedCadPoseOnEnter() && loadRoomPose()?.position) {
        const restored = applySavedPose();
        if (restored) {
          try { mesh.visible = true; } catch (_) {}
          if (shouldMarkCadWorldAnchored({ restored: true })) {
            worldAnchored = true;
            pendingInitialPlace = false;
          }
          return true;
        }
      }
      const ok = placeInFront({
        spawnId: "eye",
        keepZoom: false,
        recaptureDesktop: true,
        force,
      });
      if (mesh) {
        try { mesh.visible = true; } catch (_) {}
      }
      if (ok && shouldMarkCadWorldAnchored({ placed: true })) {
        worldAnchored = true;
        pendingInitialPlace = false;
      }
      return !!ok;
    } catch (err) {
      console.warn("[viewport-xr] placeCadForSession", err);
      try { mesh.visible = true; } catch (_) {}
      return false;
    }
  }

  async function enter() {
    if (presenting) return;
    if (!navigator.xr || isFallbackXrManager(renderer?.xr) || !renderer?.xr) {
      throw new Error("WebXR unavailable");
    }
    consumeBootEnterOpts();
    try {
      navigator.getBattery?.()?.then?.((b) => { xrNavigatorBattery = b; }).catch?.(() => {});
    } catch (_) {}

    // Skip modal — always start in front of you. Place menu available in-session.
    activeSpawnId = "eye";
    try {
      localStorage.setItem(LS_SPAWN, "eye");
    } catch {
      /* ignore */
    }

    // CRITICAL (Quest): zero awaits before requestSession except the session call
    // itself. Use AR when supported; the saved toggle controls the virtual background.
    const mode = window.Render3DWiringContext?.requestedMode === "immersive-ar" ? "immersive-ar" : xrEnterSessionMode({
      fromBoot: !!bootEnter.fromBoot,
      probedMode: window.__bootXrSessionPromise ? window.__bootXrSessionMode : sessionMode,
    });

    renderer.xr.enabled = true;
    try { applyXrRenderScale(renderer.xr, { presenting: true }); } catch (_) {}
    savedBackground = scene.background;
    savedFog = scene.fog;
    savedToneMapping = renderer.toneMapping;
    savedToneExposure = renderer.toneMappingExposure;
    scene.fog = null;
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    renderer.setClearAlpha(0);
    // ACES + no IBL crushes CAD to black in passthrough (looks like "only controllers").
    try {
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.toneMappingExposure = 1;
    } catch (_) {}
    try { renderer.localClippingEnabled = false; } catch (_) {}

    try {
      session = await requestXrSession(mode);
    } catch (err) {
      renderer.xr.enabled = false;
      scene.background = savedBackground;
      scene.fog = savedFog;
      try {
        if (savedToneMapping != null) renderer.toneMapping = savedToneMapping;
        if (savedToneExposure != null) renderer.toneMappingExposure = savedToneExposure;
      } catch (_) {}
      if (bootEnter.fromBoot) {
        try { restoreBootSplashAfterXrFail(xrEnterFailMessage(err)); } catch (_) {}
      }
      throw err;
    }
    sessionMode = mode;
    try { localAvatarSpec = loadAvatarSpec(localSocialUserId()); } catch (_) {}
    try { refreshLocalXrDevice(); } catch (_) {}
    poseForceSend = true;

    try {
      const blend = session.environmentBlendMode || "";
      const passthrough = sessionMode === "immersive-ar" || blend === "alpha-blend" || blend === "additive";
      sessionIsPassthrough = !!passthrough;
      if (sessionIsPassthrough && passthroughOn) applyPassthroughClear();
      else {
        scene.background = new THREE.Color(0xf7f4ee);
        scene.fog = null;
        renderer.setClearColor(0xf4f1ea, 1);
        renderer.setClearAlpha(1);
      }
    } catch (_) {
      sessionIsPassthrough = sessionMode === "immersive-ar";
    }

    try { renderer.xr.setReferenceSpaceType?.("local-floor"); } catch (_) {}
    try { applyXrRenderScale(renderer.xr, { presenting: true }); } catch (_) {}
    try {
      await renderer.xr.setSession(session);
      hydrateXrSessionInputs({ session, controllers, force: true });
      if (pendingWorkshopVrSpawn && typeof XRRigidTransform !== "undefined") {
        const spawn = pendingWorkshopVrSpawn;
        const base = renderer.xr.getReferenceSpace?.();
        if (base?.getOffsetReferenceSpace) {
          const half = -spawn.yaw / 2;
          renderer.xr.setReferenceSpace(base.getOffsetReferenceSpace(new XRRigidTransform(
            { x: -spawn.x, y: 0, z: -spawn.z },
            { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) },
          )));
        }
        pendingWorkshopVrSpawn = null;
      }
    } catch (err) {
      try { await session.end(); } catch (_) {}
      renderer.xr.enabled = false;
      scene.background = savedBackground;
      scene.fog = savedFog;
      try {
        if (savedToneMapping != null) renderer.toneMapping = savedToneMapping;
        if (savedToneExposure != null) renderer.toneMappingExposure = savedToneExposure;
      } catch (_) {}
      if (bootEnter.fromBoot) {
        try { restoreBootSplashAfterXrFail(xrEnterFailMessage(err)); } catch (_) {}
      }
      throw err;
    }
    try { applyXrRenderScale(renderer.xr, { presenting: true }); } catch (_) {}
    try { xrSessionFoveation(session, { presenting: true }); } catch (_) {}
    if (sessionIsPassthrough && passthroughOn) applyPassthroughClear();
    else {
      scene.background = new THREE.Color(0xf7f4ee);
      renderer.setClearColor(0xf4f1ea, 1);
      renderer.setClearAlpha(1);
    }

    // Shadows + exotic depth paths are a common Quest "draw nothing" cause
    savedShadowMap = renderer.shadowMap?.enabled;
    if (renderer.shadowMap) renderer.shadowMap.enabled = false;
    try {
      savedPixelRatio = Number(renderer.getPixelRatio?.());
      if (!Number.isFinite(savedPixelRatio) || savedPixelRatio <= 0) savedPixelRatio = 1;
      renderer.setPixelRatio?.(1);
    } catch (_) {
      savedPixelRatio = null;
    }

    // CRITICAL: desktop CAD uses large near planes (often meters+). Three.js pushes
    // camera.near into XR session depthNear — that clips controllers + handheld models.
    try {
      savedNear = camera.near;
      savedFar = camera.far;
      camera.near = XR_DEPTH_NEAR;
      camera.far = XR_DEPTH_FAR;
      camera.updateProjectionMatrix();
    } catch (_) {}
    try {
      session.updateRenderState({ depthNear: XR_DEPTH_NEAR, depthFar: XR_DEPTH_FAR });
    } catch {
      /* ignore */
    }

    presenting = true;
    leftRestartHoldOpen = false;
    leftRestartState = emptyLeftMenuRestartState();
    xrPresentStartedAt = performance.now();
    try { flushDeferredXrProject(); } catch (_) {}
    try {
      applyXrPresentingViewportEl(
        renderer?.domElement?.parentElement || document.getElementById("viewport"),
        { presenting: true },
      );
    } catch (_) {}
    try {
      if (shouldDisposeDesktopOnlyTarget({
        presenting: true,
        recording: !!captureRecState?.recording,
      })) {
        disposeRecordSpectator();
      }
    } catch (_) {}
    stopBootSplashForPresent();
    try { installXrDomGuards(); } catch (_) {}
    try { xrBuild.setSnapGridVisible?.(false); } catch (_) {}
    try { restoreDockHandFromSettings(); } catch (_) {}
    dockHasPose = false;
    dockIgnoreGripsUntil = performance.now() + 1600;
    try { publicDrops.setVisible(false); } catch (_) {}
    try { applyXrEnvironmentOnEnter(); } catch (_) {}
    try { hemi.visible = false; key.visible = false; fill.visible = false; xrAmbient.visible = true; } catch (_) {}
    if (shouldHideCadOnXrEnter({ emptyScene: bootEnter.emptyScene })) {
      try { hideCadForEmptyEnter(); } catch (_) {}
    }
    pendingInitialPlace = !bootEnter.emptyScene;
    xrPerfPosted = false;
    placeAttempts = 0;
    voiceEnterRetryUntil = performance.now() + 10000;
    xrHud.visible = true;
    // Avatars, blink, HMD props, mic, layouts, DOM lock, CAD place — after first stable frames.
    scheduleXrEnterIdle(() => {
      if (!presenting) return;
      try { publicDrops.setVisible(presenting && sharedXrSession()); } catch (_) {}
      try { onPublishSceneMeshes?.(); } catch (_) {}
      try { xrBuild.setSnapGridVisible?.(true); } catch (_) {}
      if (!shouldRunXrVoiceIceWork({
        presenting,
        enterSettled: xrEnterWorkSettled(),
        unhideBusy: xrCadUnhideGpuBusy(),
      })) return;
      forceMicOnForSession();
      primeHeadsetMic({ enteringXr: true, force: true });
      void startHeadsetVoice();
    });
    scheduleXrEnterCanvas(() => {
      if (!presenting) return;
      try { hydrateXrLayouts(); } catch (_) {}
      try { lockDomForXr(); } catch (_) {}
    });
    // Controllers on immediately; hands only if this session is actually hands-only.
    controllers.forEach((c) => { if (c) c.visible = true; });
    grips.forEach((g) => {
      if (!g) return;
      g.visible = true;
      try { stripControllerFallback(g); } catch (_) {}
    });
    hands.forEach((h) => { if (h) h.visible = false; });
    try { attachHudToCamera(); } catch (_) {}
    try {
      syncInputVisibility();
      updateDockAttachment();
    } catch {
      controllers.forEach((c) => { if (c) c.visible = true; });
      grips.forEach((g) => {
        if (!g) return;
        g.visible = true;
        try { stripControllerFallback(g); } catch (_) {}
      });
      updateDockAttachment();
    }
    dock.visible = true;
    syncCaptureDockVisibility();
    if (controls) controls.enabled = false;
    if (transformControls) {
      transformControls.enabled = false;
      try { transformControls.detach?.(); } catch (_) {}
      try {
        const helper = transformControls.getHelper?.();
        if (helper) helper.visible = false;
      } catch (_) {}
    }
    try { xrSolidDraw.hideHandles?.(); } catch (_) {}
    try {
      hideSceneChrome?.({ force: true, skipByLayer: true });
      xrChromeDirty = false;
    } catch {
      /* ignore */
    }

    // One XR frame so the headset pose exists — never wait on window rAF (Quest freeze).
    try { await waitForXrFrame(); } catch (_) {}
    try { renderer.xr.updateCamera?.(camera); } catch (_) {}
    try { getHeadPose(); } catch (_) {}
    try { xrEnterSplash.show(); } catch (_) {}
    try { xrBoard.captureRefSpace(renderer, {reset:true}); roomFloorJoined = false; roomStickAt = 0; roomTurnLatched = false; roomWalkHeld = false; } catch (_) {}
    try { restoreDockHandFromSettings(); } catch (_) {}
    dockIgnoreGripsUntil = performance.now() + 900;
    try { updateDockAttachment(); } catch (_) {}
    // freeze2: no menu/canvas prewarm, no capture-dock rebuild, no restore-all-windows.
    // CAD place waits for enterSettled — desktop-scale GLB + material swap crashed Quest.

    userZoom = 1;
    saved = null;
    worldAnchored = false;
    sizeRescueAttempts = 0;
    sizeRescueUntil = performance.now() + 3000;
    // Do not restore every saved window on enter — that paints ~10 1024 canvases
    // and freezes Quest. Poses apply after the first-frame budget, once head is live.
    panelsAwaitingHead = true;

    toolBeforeDimos = "";
    try { resetDimosTeleopOnXrBoundary(); } catch (_) {}
    activeTool = "grab";
    try { syncDock(); } catch (_) {}
    try { setButtonUi(true); } catch (_) {}
    dock.visible = true;
    if (bootEnter.openMenu || bootEnter.fromBoot) {
      bootMenuLeftMonitor = true;
      scheduleXrEnterCanvas(() => {
        if (!presenting) return;
        try { openMenuConsole({ tab: "projects", forcePlace: true }); } catch (_) {}
      });
    }
    if (bootEnter.tour) {
      scheduleXrEnterCanvas(() => {
        if (!presenting) return;
        try { openHowtoTour(); } catch (_) {}
      });
    }
    try { blurXrDom(); } catch (_) {}
    try { onPresentingChange?.(true); } catch (err) {
      console.warn("[viewport-xr] onPresentingChange", err);
    }
    try {
      resetDimosTeleopOnXrBoundary();
      if (shouldAttachDimosOnXrEnter({ armed: isDimosTeleopArmed() })) {
        setDimosTeleopPresenting(true, session);
      }
      if (shouldEnsureDimosCoordinatorOnXrEnter({ presenting: true })) {
        scheduleXrEnterCanvas(() => {
          if (!presenting) return;
          void ensureDimosCoordinatorIfDown({ session: renderer?.xr?.getSession?.() || session });
        });
      }
    } catch (_) {}
    stopBootSplashForPresent();
    try { installXrDomGuards(); } catch (_) {}
    try { session.addEventListener("end", onSessionEnd); } catch (_) {}
    try {
      session.addEventListener("inputsourceschange", (ev) => {
      try {
        const removed = ev?.removed;
        if (removed && removed.length) {
          globalThis.dispatchEvent?.(new CustomEvent("studio-credit-incident", {
            detail: { eventType: "controller.miss", note: "XR input source removed", removed: removed.length },
          }));
        }
      } catch (_) { /* stamp only — do not break trigger */ }
      aiDrawWorkspace.cancel();
      uiSelectPress.reset();
      prevTrigger[0] = prevTrigger[1] = false;
      // Re-pose on the preferred hand only. Quest reorders inputSources on
      // headset doff/don — never change preferredDockHand here.
      try {
        restoreDockHandFromSettings();
        if (shouldRebindXrDockHosts({ presenting: true, inputSourcesChanged: true })) {
          rebindXrInputHosts("inputsources");
        }
        try { xrDevStats.noteSources?.(session.inputSources); } catch (_) {}
      } catch (_) {}
    });
    session.addEventListener("visibilitychange", () => {
      try {
        restoreDockHandFromSettings();
        const vis = session.visibilityState || "";
        const becameVisible = vis === "visible";
        aiDrawWorkspace.cancel();
        uiSelectPress.reset();
        prevTrigger[0] = prevTrigger[1] = false;
        if (!becameVisible) {
          captureVisibilityWindowPoses();
          aiDrawWorkspace.view.setVisible(false);
        }
        else if (aiDrawWorkspace.isActive()) aiDrawWorkspace.view.setVisible(true);
        lastSessionVisibility = vis;
        if (shouldRebindXrDockHosts({ presenting: true, sessionBecameVisible: becameVisible })) {
          rebindXrInputHosts("visibility");
        } else {
          updateDockAttachment();
        }
        if (becameVisible) restoreVisibilityWindowPoses("visibility");
      } catch (_) {}
    });
    session.addEventListener("selectstart", onSessionSelectStart);
    session.addEventListener("selectend", onSessionSelectEnd);
    try { xrLiveClient.start(); } catch (_) {}
    try {
      const ref = renderer.xr.getReferenceSpace?.();
      xrDevStats.noteSession?.({
        started: true,
        ended: false,
        mode: session.mode || "",
        ref: ref ? (session.interactionMode || "local-floor") : (session.mode || ""),
        blend: session.environmentBlendMode || "",
        nSrc: session.inputSources?.length || 0,
        t: performance.now(),
      });
      xrDevStats.noteSources?.(session.inputSources);
    } catch (_) {}
    } catch (_) {}
    try {
      lastSessionVisibility = session.visibilityState || "visible";
      lastXrRefSpace = renderer.xr.getReferenceSpace?.() || null;
    } catch (_) {}
  }

  function persistXrCombinedMesh(mesh) {
    if (!mesh || typeof onPersistXrSolid !== "function") return;
    try { onPersistXrSolid({ mesh, kind: "combine" }); } catch (err) {
      console.warn("[viewport-xr] persist combine", err);
    }
  }

  function postXrPerfSample({ force = false, explicit = false } = {}) {
    if (!shouldUploadXrDebuggerLog({ debuggerOpen, explicit, auto: false })) return;
    if (!onXrDebugLog) return;
    if (!force && xrPerfPosted) return;
    const snap = xrDevStats.snapshot?.({
      auto: false,
      presenting,
      laser: laserPointerActive(),
      framebufferScale: XR_FRAMEBUFFER_SCALE,
      foveation: XR_FOVEATION,
      hudScale: XR_HUD_CANVAS_SCALE,
    }) || {};
    const samples = Array.isArray(snap.samples) ? snap.samples : [];
    const ctlRows = Array.isArray(snap.controls?.rows) ? snap.controls.rows : [];
    if (!samples.length && !ctlRows.length) return;
    xrPerfPosted = true;
    const payload = {
      v: 3,
      kind: "xr-perf",
      filename: snap.filename,
      samples,
      actions: Array.isArray(snap.actions) ? snap.actions : [],
      controls: snap.controls && typeof snap.controls === "object" ? snap.controls : undefined,
      auto: false,
      manual: true,
      timestamp: snap.timestamp,
      description: snap.description,
      avgMs: snap.avgMs,
      p95Ms: snap.p95Ms,
      n: snap.n,
      memMb: snap.memMb,
      hitchCount: snap.hitchCount,
      maxDt: snap.maxDt,
      tag: snap.tag || (snap.hitchCount ? "spike" : "normal"),
      spikeTrace: snap.spikeTrace,
      spikes: snap.spikes,
      durationMs: snap.durationMs,
      presenting: 1,
      laser: snap.laser,
      framebufferScale: XR_FRAMEBUFFER_SCALE,
      foveation: XR_FOVEATION,
      hudScale: XR_HUD_CANVAS_SCALE,
    };
    void Promise.resolve(onXrDebugLog(payload)).catch(() => {});
  }

  function onSessionEnd() {
    cancelGenerationSurfacePick();
    uiSelectPress.reset();
    aiDrawWorkspace.close();
    roboticsWorkspace.close();
    try { detachSessionSelect(session); } catch (_) {}
    try { xrLiveClient.stop(); } catch (_) {}
    try { xrDevStats.noteSession?.({ started: false, ended: true, t: performance.now() }); } catch (_) {}
    try { xrEnterSplash.hide(); } catch (_) {}
    try {
      const combined = xrBuild.lastCombinedSolid?.();
      if (combined?.mesh) persistXrCombinedMesh(combined.mesh);
    } catch (_) {}
    try { cancelPlaceAfterProjectLoad(); } catch (_) {}
    try { saveOpenWindowsLayout(); } catch (_) {}
    saveRoomPose();
    worldAnchored = false;
    sizeRescueUntil = 0;
    presenting = false;
    tabbedWindows?.update([], false);
    agentAvatar.update({presenting:false}); agentPeers.update({presenting:false}); agentJoin.update({presenting:false});
    xrWiringView.update({presenting:false});
    syncWiringCadVisibility(false);
    if (window.Render3DWiringContext) window.Render3DWiringContext.requestedMode = null;
    void window.Render3DXrAgent?.stop?.();

    try { resetDimosTeleopOnXrBoundary(); } catch (_) {}
    xrPresentStartedAt = 0;
    xrEnterIdleJobs.length = 0;
    if (xrEnterIdleRaf) {
      try { cancelAnimationFrame(xrEnterIdleRaf); } catch (_) {}
      xrEnterIdleRaf = 0;
    }
    if (xrEnterIdleTimer) {
      try { clearTimeout(xrEnterIdleTimer); } catch (_) {}
      xrEnterIdleTimer = 0;
    }
    try { restoreCadAfterEmptyEnter(); } catch (_) {}
    try { closeHowtoTour(); } catch (_) {}
    try { xrBuild.setSnapGridVisible?.(false); } catch (_) {}
    dockHasPose = false;
    dockIgnoreGripsUntil = 0;
    lastSessionVisibility = "";
    lastXrRefSpace = null;
    visibilityWindowPoses = new Map();
    pendingInitialPlace = false;
    panelsAwaitingHead = false;
    placeAttempts = 0;
    session = null;
    try { unlockDomForXr(); } catch (_) {}
    try { stopHeadsetVoice(); } catch (_) {}
    try { voiceDraw.end(); } catch (_) {}
    try { xrSolidDraw.cancel(); } catch (_) {}
    try { xrSolidDraw.hideHandles?.(); } catch (_) {}
    try { toolHand.setVisible?.(false); } catch (_) {}
    lastToolHandSig = "";
    try { closeGroupNamePanel(); } catch (_) {}
    try { toolWheel.setVisible(false); } catch (_) {}
    try { if (xrAimCursor) xrAimCursor.visible = false; } catch (_) {}
    aButtonHeld = false;
    bButtonHeld = false;
    bButtonDownAt = 0;
    bHoldResetDone = false;
    laserAimMode = false;
    wristPinned = false;
    wristMenuLatched = false;
    wheelDismissedThisHold = false;
    socialPane = "hub";
    socialFocusId = "";
    socialProfile = null;
    socialProfileTab = "profile";
    xrBoardUserArmed = false;
    try { bindDesktopDraw(false); } catch (_) {}
    if (activeTool === "draw") activeTool = "grab";
    roomCamera.reset(); roomCameraView.clear();
    try { xrPresence.clear(); } catch (_) {}
    try { publicDrops.setLocalGrabId(""); publicDrops.setVisible(false); } catch (_) {}
    xrHud.visible = false;
    dock.visible = false;
    syncCaptureDockVisibility();
    setCaptureState({ recording: false, paused: false, elapsedMs: 0, clipReady: false });
    try { disposeSharedVideo(); } catch (_) {}
    try { closeAllXrSceneWindows(); } catch (_) {}
    try { closeShareInvitePanel({ decline: false }); } catch (_) {}
    if (placePanel) placePanel.group.visible = false;
    if (explorerPanel) {
      explorerPanel.group.visible = false;
      explorerPanel.worldPlaced = false;
    }
    if (aiPanel) aiPanel.worldPlaced = false;
    try { disposeRecordSpectator(); } catch (_) {}
    panelDrag = null;
    sessionIsPassthrough = false;
    if (xrWhiteRoom) xrWhiteRoom.visible = false;
    controllers.forEach((c) => {
      c.visible = false;
    });
    grips.forEach((g) => {
      g.visible = false;
    });
    hands.forEach((h) => {
      h.visible = false;
    });
    grabState = null;
    scaleGrab = null;
    gripGrab = null;
    gripPressActive.fill(false);
    gripScaleContact.fill(null);
    lastNearGrip.fill(null);
    handPinchLatched[0] = false;
    handPinchLatched[1] = false;
    closeAiPromptPanel();
    clearMeasure();
    restoreMeshMaterials();
    try { finishXrCadUnhide(getLiveMesh(), { restore: true }); } catch (_) {}
    restoreDesktop();
    scene.background = savedBackground;
    scene.fog = savedFog;
    try { stripWrapFromCadViewport(); } catch (_) {}
    if (scene.environment) scene.environment = null;
    try {
      if (savedToneMapping != null) renderer.toneMapping = savedToneMapping;
      if (savedToneExposure != null) renderer.toneMappingExposure = savedToneExposure;
    } catch (_) {}
    savedToneMapping = null;
    savedToneExposure = null;
    if (renderer.shadowMap) {
      renderer.shadowMap.enabled = false;
      renderer.shadowMap.autoUpdate = false;
    }
    if (savedPixelRatio != null) {
      try { renderer.setPixelRatio?.(savedPixelRatio); } catch (_) {}
      savedPixelRatio = null;
    }
    if (savedNear != null) {
      camera.near = savedNear;
      camera.far = savedFar ?? camera.far;
      camera.updateProjectionMatrix();
      savedNear = null;
      savedFar = null;
    }
    renderer.setClearColor(0x000000, 0);
    detachHudFromCamera();
    if (controls) controls.enabled = true;
    if (transformControls) transformControls.enabled = true;
    renderer.xr.enabled = false;
    setButtonUi(false);
    try {
      restoreSceneChrome?.();
    } catch {
      /* ignore */
    }
    onPresentingChange?.(false);
    try {
      fitCamera?.();
    } catch {
      /* ignore */
    }
  }

  async function exit() {
    if (workspaceJoin) exitWorkspaceJoin();
    if (session) {
      try {
        await session.end();
      } catch {
        onSessionEnd();
      }
    }
  }

  function toggle() {
    if (presenting || workspaceJoin) return exit();
    return enterWithCameraFallback();
  }

  function isHeadsetBrowser() {
    const ua = navigator.userAgent || "";
    // Quest Browser is Android-based; match broadly so we never route to Scene Viewer.
    if (/OculusBrowser|MetaBrowser|Horizon|Quest|XRBrowser|Mobile VR|Wolvic|Helio|Snapchat|Spectacles|PicoBrowser/i.test(ua)) {
      return true;
    }
    // Fallback: Android + WebXR immersive often means a headset browser.
    try {
      if (/Android/i.test(ua) && navigator.xr && supported) return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  function reportXrError(err) {
    const msg = err?.message || String(err) || "AR unavailable";
    console.warn("[viewport-xr]", msg);
    try {
      if (buttonEl) buttonEl.title = msg;
    } catch {
      /* ignore */
    }
    try {
      onStatus?.("error", msg);
    } catch {
      /* ignore */
    }
    return msg;
  }

  function disposeWorkspaceHud() {
    try { workspaceHud?.remove?.(); } catch (_) {}
    workspaceHud = null;
  }

  function workspaceHudSetActive(id, on) {
    workspaceHud?.querySelector?.(`[data-ws-tool="${id}"]`)?.classList.toggle("is-active", !!on);
  }

  function bindWorkspaceHud() {
    disposeWorkspaceHud();
    const host = document.getElementById("viewport") || document.body;
    const bar = document.createElement("div");
    bar.className = "xr-workspace-hud";
    bar.innerHTML = `
      <button type="button" data-ws-tool="voice_toggle">Mic</button>
      <button type="button" data-ws-tool="passthrough">Pass</button>
      <button type="button" data-ws-tool="workspace">Workspace</button>
      <button type="button" data-ws-tool="scenes">Scene</button>
      <button type="button" data-ws-tool="screenshot">Capture</button>
      <button type="button" data-ws-tool="board">Board</button>
      <button type="button" data-ws-tool="god">God</button>
      <button type="button" data-ws-tool="walk">Walk</button>
      <button type="button" data-ws-tool="view">1st person</button>
      <button type="button" data-ws-tool="agents">Agents</button>
      <button type="button" data-ws-tool="exit">Exit</button>
    `;
    const hint = document.createElement("div");
    hint.className = "xr-workspace-hint";
    hint.textContent = isMobileLike()
      ? "VR Workspace · tilt the phone to look · thumbs: tools below"
      : "VR Workspace · WASD move · click to look · Esc exits look";
    host.appendChild(hint);
    host.appendChild(bar);
    bar.addEventListener("click", (e) => {
      const id = e.target?.closest?.("[data-ws-tool]")?.dataset?.wsTool;
      if (!id) return;
      if (id === "exit") {
        exitWorkspaceJoin();
        return;
      }
      if (id === "passthrough") {
        void toggleWorkspacePass();
        return;
      }
      if (id === "god") {
        void enterGodView();
        return;
      }
      if (id === "view") {
        workshopViewMode = workshopViewMode === "first" ? "third" : "first";
        const button = bar.querySelector('[data-ws-tool="view"]');
        if (button) button.textContent = workshopViewMode === "first" ? "1st person" : "3rd person";
        syncWorkshopPlayerView();
        return;
      }
      if (id === "agents") {
        agentJoin.openMenu();
        return;
      }
      setTool(id);
      workspaceHudSetActive("passthrough", workspacePassOn);
    });
    workspaceHud = bar;
    bar._hint = hint;
    workspaceHudSetActive("passthrough", workspacePassOn);
  }

  function unbindWorkspaceLook() {
    if (!workspaceKeys) return;
    window.removeEventListener("keydown", workspaceKeys.down);
    window.removeEventListener("keyup", workspaceKeys.up);
    document.removeEventListener("pointerlockchange", workspaceKeys.pl);
    renderer?.domElement?.removeEventListener("click", workspaceKeys.click);
    window.removeEventListener("mousemove", workspaceKeys.move);
    window.removeEventListener("deviceorientation", workspaceKeys.orient);
    workspaceKeys = null;
    try { document.exitPointerLock?.(); } catch (_) {}
  }

  function applyWorkspaceLookQuat() {
    const eul = new THREE.Euler(workspaceLook.pitch, workspaceLook.yaw, 0, "YXZ");
    camera.quaternion.setFromEuler(eul);
    if (workspaceOrient?.q) {
      camera.quaternion.set(workspaceOrient.q[0], workspaceOrient.q[1], workspaceOrient.q[2], workspaceOrient.q[3]);
    }
  }

  function ensureWorkshopPlayerAvatar() {
    if (workshopPlayerAvatar) return workshopPlayerAvatar;
    workshopPlayerAvatar = buildProceduralHumanoid(THREE, localAvatarSpec, { prop: localXrProp || "none" });
    workshopPlayerAvatar.name = "workshop-local-avatar";
    workshopPlayerAvatar.scale.setScalar(1.68);
    scene.add(workshopPlayerAvatar);
    return workshopPlayerAvatar;
  }

  function syncWorkshopPlayerView() {
    const avatar = ensureWorkshopPlayerAvatar();
    avatar.visible = workspaceJoin && workshopViewMode === "third";
    avatar.position.copy(workshopPlayerHead);
    avatar.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), workspaceLook.yaw + Math.PI);
    if (workshopViewMode === "first") {
      camera.position.copy(workshopPlayerHead);
      return;
    }
    const behind = new THREE.Vector3(0, 0.38, 2.35).applyAxisAngle(new THREE.Vector3(0, 1, 0), workspaceLook.yaw);
    camera.position.copy(workshopPlayerHead).add(behind);
  }

  function moveWorkshopPlayer(delta) {
    const radius = 0.28;
    const candidate = workshopPlayerHead.clone().add(delta);
    const floorSafe = clampWorkshopHeadToFloor(candidate);
    candidate.set(floorSafe.x, floorSafe.y, floorSafe.z);
    const blocked = (point) => workshopColliders.some((box) => (
      point.y > box.min.y && point.y - 1.55 < box.max.y
      && point.x > box.min.x - radius && point.x < box.max.x + radius
      && point.z > box.min.z - radius && point.z < box.max.z + radius
    ));
    if (!blocked(candidate)) workshopPlayerHead.copy(candidate);
    else {
      const slideX = workshopPlayerHead.clone().add(new THREE.Vector3(delta.x, 0, 0));
      const slideZ = workshopPlayerHead.clone().add(new THREE.Vector3(0, 0, delta.z));
      if (!blocked(slideX)) workshopPlayerHead.x = slideX.x;
      if (!blocked(slideZ)) workshopPlayerHead.z = slideZ.z;
    }
  }

  function bindWorkspaceLook() {
    unbindWorkspaceLook();
    const held = new Set();
    workspaceKeys = {
      held,
      down: (e) => {
        const t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
        held.add(e.code);
        if (e.code === "Escape" && document.pointerLockElement) {
          try { document.exitPointerLock(); } catch (_) {}
        }
      },
      up: (e) => { held.delete(e.code); },
      click: () => {
        if (isMobileLike()) return;
        if (document.pointerLockElement === renderer.domElement && xrWorkshopProjectRoom) {
          const ray = new THREE.Raycaster();
          ray.setFromCamera(new THREE.Vector2(0, 0), camera);
          const hits = ray.intersectObjects(Object.values(xrWorkshopProjectRoom.userData?.workshopScreens || {}), true);
          const screen = hits[0]?.object;
          let target = screen;
          while (target && !target.userData?.workshopFeature) target = target.parent;
          if (target?.userData?.workshopFeature) {
            setTool(target.userData.workshopFeature);
            onStatus?.("ok", `Opened ${target.userData.workshopFeature} monitor`);
            return;
          }
        }
        try { renderer.domElement.requestPointerLock?.(); } catch (_) {}
      },
      pl: () => {
        workspaceLook.pl = document.pointerLockElement === renderer.domElement;
        if (controls) controls.enabled = !workspaceLook.pl;
      },
      move: (e) => {
        if (!workspaceLook.pl) return;
        workspaceLook.yaw -= e.movementX * 0.0022;
        workspaceLook.pitch -= e.movementY * 0.0022;
        workspaceLook.pitch = Math.max(-1.4, Math.min(1.4, workspaceLook.pitch));
      },
      orient: (ev) => {
        const screen = typeof window.orientation === "number" ? window.orientation : 0;
        camera.getWorldPosition(_headPos);
        workspaceOrient = headPoseFromDeviceOrientation(ev, {
          position: [_headPos.x, _headPos.y, _headPos.z],
          screenOrientDeg: screen,
        });
      },
    };
    window.addEventListener("keydown", workspaceKeys.down);
    window.addEventListener("keyup", workspaceKeys.up);
    document.addEventListener("pointerlockchange", workspaceKeys.pl);
    renderer?.domElement?.addEventListener("click", workspaceKeys.click);
    window.addEventListener("mousemove", workspaceKeys.move);
    if (isMobileLike()) {
      const startOrient = async () => {
        try {
          if (typeof DeviceOrientationEvent?.requestPermission === "function") {
            const p = await DeviceOrientationEvent.requestPermission();
            if (p !== "granted") return;
          }
          window.addEventListener("deviceorientation", workspaceKeys.orient, true);
        } catch (_) {}
      };
      void startOrient();
    }
  }

  async function toggleWorkspacePass() {
    try {
      if (workspacePassOn) {
        stopWorkspacePassthrough();
        workspacePassOn = false;
        scene.background = new THREE.Color(0xf7f4ee);
        renderer.setClearColor(0xf4f1ea, 1);
      } else {
        await startWorkspacePassthrough({ scene });
        workspacePassOn = true;
      }
    } catch (err) {
      reportXrError(err);
      workspacePassOn = false;
    }
    workspaceHudSetActive("passthrough", workspacePassOn);
    refreshLocalXrDevice();
    poseForceSend = true;
  }

  function stepWorkspaceJoin(dt) {
    const held = workspaceKeys?.held;
    const baseSpeed = Number(workshopConfig?.scene?.walkSpeed) || 1.35;
    if (held && !workspaceOrient) {
      const speed = (held.has("ShiftLeft") || held.has("ShiftRight") ? baseSpeed * 1.8 : baseSpeed) * dt;
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      f.y = 0;
      if (f.lengthSq() > 1e-6) f.normalize();
      const r = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      r.y = 0;
      if (r.lengthSq() > 1e-6) r.normalize();
      const delta = new THREE.Vector3();
      if (held.has("KeyW") || held.has("ArrowUp")) delta.addScaledVector(f, speed);
      if (held.has("KeyS") || held.has("ArrowDown")) delta.addScaledVector(f, -speed);
      if (held.has("KeyA") || held.has("ArrowLeft")) delta.addScaledVector(r, -speed);
      if (held.has("KeyD") || held.has("ArrowRight")) delta.addScaledVector(r, speed);
      moveWorkshopPlayer(delta);
    }
    try {
      const gp = navigator.getGamepads?.()?.[0];
      if (gp) {
        const lx = Number(gp.axes[0]) || 0;
        const ly = Number(gp.axes[1]) || 0;
        const rx = Number(gp.axes[2]) || 0;
        const ry = Number(gp.axes[3]) || 0;
        if (Math.abs(lx) > 0.15 || Math.abs(ly) > 0.15) {
          const f = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
          f.y = 0;
          if (f.lengthSq() > 1e-6) f.normalize();
          const r = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
          r.y = 0;
          if (r.lengthSq() > 1e-6) r.normalize();
          moveWorkshopPlayer(f.multiplyScalar(-ly * baseSpeed * 1.2 * dt).add(r.multiplyScalar(lx * baseSpeed * 1.2 * dt)));
        }
        if (Math.abs(rx) > 0.12 || Math.abs(ry) > 0.12) {
          workspaceLook.yaw -= rx * 1.8 * dt;
          workspaceLook.pitch -= ry * 1.4 * dt;
          workspaceLook.pitch = Math.max(-1.4, Math.min(1.4, workspaceLook.pitch));
        }
      }
    } catch (_) {}
    applyWorkspaceLookQuat();
    syncWorkshopPlayerView();
    camera.updateMatrixWorld(true);
    if (controls && controls.enabled && !workspaceLook.pl) {
      try { controls.update(); } catch (_) {}
    }
    getHeadPose();
    try { sendLocalXrPose(); } catch (_) {}
    try { xrPresence.setViewer?.(_headPos); } catch (_) {}
    try { xrPresence.tick?.(performance.now()); } catch (_) {}
    try { tickGuidesClip(); } catch (_) {}
    try {
      const now = performance.now();
      xrDevStats.tick?.(now);
      if (developerMode && xrEnterWorkSettled() && xrDevStats.isStatsOpen?.()) {
        xrDevStats.followHead?.(_headPos, _headQuat);
      }
    } catch (_) {}
  }

  function exitWorkspaceJoin() {
    cancelGenerationSurfacePick();
    if (!workspaceJoin) return;
    workspaceJoin = false;
    if (workshopPlayerAvatar) workshopPlayerAvatar.visible = false;
    unbindWorkspaceLook();
    disposeWorkspaceHud();
    try { stopWorkspacePassthrough(); } catch (_) {}
    workspacePassOn = false;
    workspaceOrient = null;
    if (controls) controls.enabled = true;
    if (transformControls) transformControls.enabled = true;
    setButtonUi(false);
    try { document.body.classList.remove("xr-workspace-join"); } catch (_) {}
    if (workspaceSavedNear != null) {
      camera.near = workspaceSavedNear;
      camera.far = workspaceSavedFar ?? camera.far;
      camera.updateProjectionMatrix();
      workspaceSavedNear = null;
      workspaceSavedFar = null;
    }
    applyXrEnvironment();
    try { onPresentingChange?.(false); } catch (_) {}
    try { onStatus?.("ok", "Left VR Workspace"); } catch (_) {}
  }

  function updateWorkshop(config = {}) {
    workshopConfig = config && typeof config === "object" ? config : workshopConfig;
    workshopExplicitlyRequested = true;
    if (/^#[0-9a-f]{6}$/i.test(workshopConfig?.scene?.background || "")) {
      _xrWarehouseBg.set(workshopConfig.scene.background);
    }
    setXrSceneKind(workshopConfig?.scene?.environment || "workshop");
    if (workshopConfig?.world) workspaceWorld?.rebuild?.(workshopConfig.world);
    void ensureWorkshopProjectRoom();
    applyWorkshopMonitorPins();
    return { ok: true, projectId: String(getProjectId?.() || "") };
  }

  async function enterWorkshop(config = {}) {
    updateWorkshop(config);
    await ensureWorkshopProjectRoom();
    if (isCanonicalWorkshopConfig(workshopConfig)) void roboticsWorkspace.ensureViser?.({ forceWorkshopAnchor: true }).catch(() => null);
    if (presenting) return { ok: true, mode: "immersive" };
    if (workspaceJoin) return { ok: true, mode: "desktop" };
    workspaceJoin = true;
    workspaceSavedNear = camera.near;
    workspaceSavedFar = camera.far;
    camera.near = 0.04;
    camera.far = Math.max(camera.far, 500);
    camera.updateProjectionMatrix();
    const spawn = workshopConfig?.scene?.spawn || {};
    const start = workshopStandingHead(spawn);
    workshopPlayerHead.set(start.x, start.y, start.z);
    workshopViewMode = "first";
    workspaceLook.yaw = start.yaw;
    workspaceLook.pitch = start.pitch;
    workspaceOrient = null;
    if (controls) controls.enabled = false;
    if (transformControls) transformControls.enabled = false;
    try { document.body.classList.add("xr-workspace-join"); } catch (_) {}
    bindWorkspaceLook();
    bindWorkspaceHud();
    applyXrEnvironment();
    applyWorkspaceLookQuat();
    syncWorkshopPlayerView();
    applyWorkshopAssetOrientation();
    camera.updateMatrixWorld(true);
    try { onPresentingChange?.(true); } catch (_) {}
    try { onStatus?.("ok", "Workshop · WASD move · click viewport to look · Esc releases mouse"); } catch (_) {}
    return { ok: true, mode: "desktop" };
  }

  function enterWorkshopVr(config = {}) {
    updateWorkshop(config);
    if (workspaceJoin) exitWorkspaceJoin();
    applyWorkshopAssetOrientation();
    pendingWorkshopVrSpawn = canonicalWorkshopSpawn(workshopConfig);
    if (isCanonicalWorkshopConfig(workshopConfig)) void roboticsWorkspace.ensureViser?.({ forceWorkshopAnchor: true }).catch(() => null);
    return startXrFromUserGesture();
  }

  async function enterGodView() {
    if (presenting) return { ok: false, mode: "immersive" };
    if (workspaceJoin) exitWorkspaceJoin();
    camera.position.set(0, 5.4, 0.04);
    camera.lookAt(0, 0, 0);
    if (controls) {
      controls.enabled = true;
      controls.target?.set?.(0, 0, 0);
      controls.update?.();
    }
    try { aiRoundTable?.setVisible?.(true); } catch (_) {}
    try { workspaceWorld?.rebuild?.(); } catch (_) {}
    try { onStatus?.("ok", "God view over the agents"); } catch (_) {}
    return { ok: true, mode: "god-view" };
  }

  async function enterWithCameraFallback() {
    const headset = isHeadsetBrowser();
    const hasRealXr = !isFallbackXrManager(renderer?.xr) && !!renderer?.xr;

    if (headset) {
      if (navigator.xr && hasRealXr) {
        try {
          return await enter();
        } catch (err) {
          reportXrError(err);
          if (bootEnter.fromBoot) {
            try { restoreBootSplashAfterXrFail(xrEnterFailMessage(err)); } catch (_) {}
          }
          throw new Error(
            /NotSupported|not supported|SecurityError|NotAllowed|not allowed/i.test(String(err?.name || err?.message || err))
              ? `Could not start immersive VR. Stay on this screen and tap Enter VR again.`
              : (err?.message || "Could not start AR/VR")
          );
        }
      }
      throw new Error("WebXR unavailable on this headset browser. Reload in Meta Quest Browser.");
    }

    // Same-turn as the AR click: do not await a chooser (burns getUserMedia / requestSession).
    const immersiveArSupported = !!(supported && sessionMode === "immersive-ar");
    if (shouldRequestImmersiveArOnDesktop({
      headset: false,
      hasRealXr,
      immersiveArSupported,
    })) {
      try {
        return await enter();
      } catch (err) {
        console.warn("[viewport-xr] WebXR AR fallback failed", err);
      }
    }

    const camPlan = desktopCameraArPlan({
      headset: false,
      hasDesktopAr: typeof launchDesktopAr === "function",
      hasMobileAr: typeof launchMobileAr === "function",
    });
    if (camPlan === "camera") return launchDesktopAr();
    if (camPlan === "mobile") {
      try {
        return await launchMobileAr();
      } catch (err) {
        if (String(err?.message || err) === "NO_XR_DEVICE") {
          throw new Error("No XR device found. Use a Quest headset or a laptop with a camera.");
        }
        throw err;
      }
    }
    throw new Error("No XR device found. Connect a Quest headset or use a laptop camera.");
  }

  const _nearCenter = new THREE.Vector3();
  const _nearSize = new THREE.Vector3();
  const _nearWp = new THREE.Vector3();

  function keepModelClearOfNearPlane() {
    const grabbing = !!(gripGrab || scaleGrab || grabState);
    if (!shouldKeepModelClearOfNearPlane({
      worldAnchored,
      grabbing,
      enterSettled: xrEnterWorkSettled(),
    })) return;
    const mesh = getLiveMesh();
    if (!mesh) return;
    if (squeezeHeld[0] || squeezeHeld[1]) return;
    getHeadPose();
    const box = contentBoxFromMesh(mesh);
    if (box.isEmpty()) return;
    const center = box.getCenter(_nearCenter);
    const size = box.getSize(_nearSize);
    const half = Math.max(size.x, size.y, size.z) * 0.5;
    const dist = center.distanceTo(_headPos);
    const minDist = Math.max(XR_DEPTH_NEAR + 0.08, half + 0.12);
    if (dist >= minDist || dist < 1e-4) return;
    _nearWp.copy(center).sub(_headPos).normalize().multiplyScalar(minDist - dist);
    const parent = mesh.parent;
    if (parent) {
      mesh.getWorldPosition(_v).add(_nearWp);
      mesh.position.copy(parent.worldToLocal(_v));
    } else {
      mesh.position.add(_nearWp);
    }
    mesh.updateMatrixWorld(true);
  }

  function relayerXrOverlays() {
    if (!presenting) return;
    if (!shouldRelayerOverlays({
      presenting: true,
      force: overlayRelayerDirty === "force",
      panelSetChanged: overlayRelayerDirty === true,
    })) return;
    lastRelayerFrame = xrFrame;
    overlayRelayerDirty = false;
    const roots = [xrHud, dock, captureDock, xrSocialCard?.group, xrStudio?.group].filter(Boolean);
    let visited = 0;
    for (const root of roots) {
      if (shouldStopOverlayTraverse(visited, XR_OVERLAY_RELAYER_MAX_MESHES)) break;
      root.traverse?.((o) => {
        if (shouldStopOverlayTraverse(visited, XR_OVERLAY_RELAYER_MAX_MESHES)) return;
        if (!o?.isMesh || !(o.renderOrder >= 2000)) return;
        if (o.userData?.xrBoardPlane || o.userData?.xrRoundTable || o.userData?.xrChair) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        if (o.userData?.xrWorldDepth) {
          const pick = isXrWorldPickMesh(o);
          for (const m of mats) {
            if (pick) applyWorldUiPickMaterialFlags(m);
            else applyWorldUiMaterialFlags(m);
          }
        } else if (shouldApplyOverlayRelayerFlags(o)) {
          for (const m of mats) applyOverlayMaterialFlags(m);
        } else {
          return;
        }
        visited += 1;
      });
    }
  }

  function update() {
    if (workspaceJoin && !presenting) {
      hideImmersiveUiForDesktop();
      try { stepWorkspaceJoin(1 / 60); } catch (err) { console.warn("[viewport-xr] workspace", err); }
      return;
    }
    if (!presenting) {
      hideImmersiveUiForDesktop();
      return;
    }
    try {
      updateXrFrame();
    } catch (err) {
      console.warn("[viewport-xr] update", err);
      try {
        controllers.forEach((c) => { if (c) c.visible = true; });
        grips.forEach((g) => { if (g) g.visible = true; });
        if (dock) dock.visible = true;
        xrHud.visible = true;
        updateDockAttachment();
      } catch (_) {}
    }
  }

  function hideImmersiveUiForDesktop() {
    // XR controls can be re-parented outside xrHud while a headset is active.
    // Hide every possible XR-only root on desktop so an async dock/status update
    // cannot leave wrist pucks floating over a normal CAD scene.
    xrHud.visible = false;
    dock.visible = false;
    statusDock.visible = false;
    captureDock.visible = false;
    dockAnchor.visible = false;
    statusAnchor.visible = false;
    try { toolHand.setVisible?.(false); } catch (_) {}
    try { toolWheel.setVisible?.(false); } catch (_) {}
    if (xrAimCursor) xrAimCursor.visible = false;
  }

  function updateXrFrame() {
    layoutOpenWindowsArc();
    if (!presenting) return;
    hydrateXrSessionInputs({ session: renderer.xr.getSession?.(), controllers });
    syncGripPosesFromXrFrame();
    if (shouldUploadXrVideoFrame({
      hasTex: !!(sharedVideo?.tex),
      isVideo: !!sharedVideo?.video,
      ready: (sharedVideo?.video?.readyState || 0) >= 2,
      paused: !!sharedVideo?.video?.paused,
    }) && !shouldDeferXrEnterWork({
      presenting,
      now: performance.now(),
      presentStartedAt: xrPresentStartedAt,
    })) {
      sharedVideo.tex.needsUpdate = true;
    }
    try { flushDeferredXrProject(); } catch (_) {}
    if (xrEnterWorkSettled()) {
      try { syncRoomFloor(); } catch (_) {}
      try { publicDrops.setVisible(presenting && sharedXrSession()); } catch (_) {}
    }
    pickFrameGen += 1;
    pickCache.clear();
    lastMenuAimNear = false;
    // A recording spectator pass can leave this false; CAD + docks vanish until it is on.
    if (renderer.xr && renderer.xr.enabled === false) renderer.xr.enabled = true;
    // Keep XR depth range every frame (desktop fitCamera can fight us)
    if (
      Math.abs(camera.near - XR_DEPTH_NEAR) > 1e-4
      || Math.abs(camera.far - XR_DEPTH_FAR) > 1e-3
    ) {
      camera.near = XR_DEPTH_NEAR;
      camera.far = XR_DEPTH_FAR;
      camera.updateProjectionMatrix();
      try {
        session?.updateRenderState?.({ depthNear: XR_DEPTH_NEAR, depthFar: XR_DEPTH_FAR });
      } catch {
        /* ignore */
      }
    }
    keepModelClearOfNearPlane();
    try { renderer.xr.updateCamera?.(camera); } catch (_) {}
    getHeadPose();
    if (shouldKeepViewportVisibleWhilePresenting({ presenting })) {
      try {
        const el = renderer?.domElement?.parentElement || document.getElementById("viewport");
        if (el && (el.hidden || el.style?.display === "none" || el.style?.visibility === "hidden")) {
          applyXrPresentingViewportEl(el, { presenting: true });
        }
      } catch (_) {}
    }
    if (panelsAwaitingHead && isReasonableXrHead() && !panelDrag && xrEnterWorkSettled()) {
      panelsAwaitingHead = false;
      try { reapplyOpenWindowPoses(); } catch (_) {}
    } else if (
      presenting
      && !panelDrag
      && isReasonableXrHead()
      && explorerPanel?.group?.visible
      && !panelWorldPosIsUsable(explorerPanel.group)
      && performance.now() - lastPanelRescueAt > 400
    ) {
      lastPanelRescueAt = performance.now();
      try { reapplyOpenWindowPoses(); } catch (_) {}
    }
    const liveMesh = getLiveMesh();
    if (liveMesh && !projectSwapActive && !bootEnter.emptyScene && worldAnchored) {
      try { liveMesh.visible = true; } catch (_) {}
      try { stepXrCadUnhide(liveMesh); } catch (_) {}
      if (shouldCloneCadGhostForAvatars() && liveMesh.uuid !== lastGhostMeshId) {
        lastGhostMeshId = liveMesh.uuid;
        try { xrPresence.setGhostSource(liveMesh); } catch (_) {}
      }
    }
    const grabbing = !!(gripGrab || scaleGrab || grabState);
    if (pendingInitialPlace && !grabbing && !worldAnchored) {
      const enterSettled = xrEnterWorkSettled();
      if (enterSettled) placeAttempts += 1;
      if (shouldPlaceCadThisFrame({
        pending: true,
        worldAnchored,
        lastPlaceAt: lastPlaceCadAt,
        now: performance.now(),
        attempts: placeAttempts,
        enterSettled,
      })) {
        try { renderer.xr.updateCamera?.(camera); } catch (_) {}
        lastPlaceCadAt = performance.now();
        placeCadForSession({ force: true });
        try { stepXrCadUnhide(getLiveMesh()); } catch (_) {}
      }
      if (shouldClearPendingCadPlace({
        worldAnchored,
        enterSettled,
        attempts: placeAttempts,
        maxAttempts: XR_PENDING_PLACE_MAX,
      })) {
        pendingInitialPlace = false;
      }
    } else {
      const live = getLiveMesh();
      const emptyScene = !!bootEnter.emptyScene;
      const sx = Math.abs(Number(live?.scale?.x) || 0);
      if (live && shouldUnhideXrCad({
        visible: live.visible,
        grabbing,
        emptyScene,
        projectSwap: projectSwapActive,
        enterSettled: xrEnterWorkSettled(),
      })) {
        try { live.visible = true; } catch (_) {}
        try { stepXrCadUnhide(live); } catch (_) {}
      }
      if (live && shouldBakeParkedXrCad({
        scaleX: sx,
        grabbing,
        emptyScene,
        projectSwap: projectSwapActive,
        attempts: sizeRescueAttempts,
        lastAt: lastSizeRescueAt,
        now: performance.now(),
      })) {
        sizeRescueAttempts += 1;
        lastSizeRescueAt = performance.now();
        placeCadForSession({ force: true });
        try { stepXrCadUnhide(getLiveMesh()); } catch (_) {}
      }
    }
    try {
      const clockNow = performance.now();
      if (shouldFormatXrClockHud({ now: clockNow, lastAt: lastClockHudAt })) {
        lastClockHudAt = clockNow;
        xrHudClockLabel = formatXrClock(new Date());
        const pct = xrBatteryPercent({
          xrSession: renderer.xr.getSession?.() || null,
          navigatorBattery: xrNavigatorBattery,
        });
        xrHudBatteryLabel = formatXrBattery(pct);
      }
    } catch (_) {}
    try {
      xrEnterSplash.tick({
        now: performance.now(),
        presenting,
        sessionEnded: false,
        worldAnchored,
        cadPlaced: worldAnchored,
        emptySceneReady: !!bootEnter.emptyScene,
        pendingCleared: !pendingInitialPlace && !bootEnter.emptyScene,
        headPos: _headPos,
        headQuat: _headQuat,
      });
    } catch (_) {}
    // Refresh teammate avatars + send local headset pose.
    const voiceIv = performance.now() < voiceEnterRetryUntil ? 350 : 900;
    if (xrEnterWorkSettled() && performance.now() - lastSocialPresenceSync > voiceIv) {
      try { syncSocialPresenceMarkers(); } catch (_) {}
      if (shouldRunXrVoiceIceWork({
        presenting,
        enterSettled: true,
        unhideBusy: xrCadUnhideGpuBusy(),
        revealedThisFrame: Number(getLiveMesh()?.userData?._xrUnhide?.revealedThisFrame || 0),
      })) {
        try { forceMicOnForSession(); } catch (_) {}
        void startHeadsetVoice();
      }
    }
    try { sendLocalXrPose(); } catch (_) {}
    try { tickHandCamWindows(); } catch (_) {}
    try { updateTossAway(1 / 72); } catch (_) {}
    try { pollShareThrowAim(); } catch (_) {}
    try { updateShareThrow(); } catch (_) {}
    try {
      if (shouldTickPrinterFencePreview({ placing: !!printerFenceMode })) updatePrinterFencePreview();
      else hidePrinterFencePreview();
    } catch (_) {}
    try {
      if (shouldSyncPrinterVisuals({ dirty: printerVisualsDirty })) {
        printerVisualsDirty = false;
        syncPrinterVisuals();
      }
    } catch (_) {}
    try { updateDrawPencils(); } catch (_) {}
    try {
      const headCamera = renderer.xr?.getCamera?.() || camera;
      agentAvatar.update({presenting,rightGrip:getRightGrip(),headCamera,level:agentState().level || 0, micLive: isMicEnabledUi()});
      agentPeers.update({presenting});
      agentJoin.update({presenting});
      aiRoundTable.update?.(_headPos);
      xrWiringView.update({presenting,headCamera});
      syncWiringCadVisibility(xrWiringView.isActive() && window.Render3DWiringContext?.guide?.schematicOnly !== false);
    } catch (_) {}

    const heldDraw = (gripGrab?.target || grabState?.target);
    let hoverDraw = heldDraw?.userData?.xrDrawable ? heldDraw : null;
    try { syncXrBusyLights(); } catch (_) {}
    try {
      xrFrame += 1;
      const chrome = {
        ...xrBusyState(),
        frame: xrFrame,
        lastTraverseFrame,
        dirty: xrChromeDirty,
        worldAnchored,
        enterSettled: xrEnterWorkSettled(),
      };
      const traverseChrome = shouldTraverseSceneChrome(chrome);
      if (traverseChrome) {
        lastTraverseFrame = xrFrame;
        xrChromeDirty = false;
      }
      try { hideSceneChrome?.({ skipTraverse: !traverseChrome, skipByLayer: true }); } catch (_) {}
      try { relayerXrOverlays(); } catch (_) {}
    } catch (_) {}
    try { xrPresence.setViewer?.(_headPos); } catch (_) {}
    try {
      if (shouldTickXrPresence({
        enterSettled: xrEnterWorkSettled(),
        busy: isInteractionBusy(),
        avatarCount: xrPresence.avatars?.size || 0,
      })) xrPresence.tick?.(performance.now());
    } catch (_) {}
    try { if (xrEnterWorkSettled() && avatarPanel?.group?.visible) tickAvatarPreview(avatarPanel.preview, 0.016); } catch (_) {}
    try { tickGuidesClip(); } catch (_) {}
    try {
      const now = performance.now();
      xrDevStats.tick?.(now);
      if (developerMode && xrEnterWorkSettled() && xrDevStats.isStatsOpen?.()) {
        xrDevStats.followHead?.(_headPos, _headQuat);
      }
    } catch (_) {}
    try {
      xrVoice.setListenerPose?.(_headPos, _headQuat);
      for (const [id, row] of xrPresence.avatars || []) {
        xrVoice.setPeerPose?.(id, row.head?.position);
      }
    } catch (_) {}
    // Size-only rescue: never re-pin to gaze
    if (
      !worldAnchored
      && performance.now() < sizeRescueUntil
      && performance.now() - lastSizeRescueAt > 800
      && !grabbing
    ) {
      const live = getLiveMesh();
      if (live) {
        const b = contentBoxFromMesh(live);
        if (!b.isEmpty()) {
          const maxD = Math.max(...b.getSize(_sizeTmp).toArray(), 0);
          if (maxD > ROOM_SIZE_MAX_M * 1.6) {
            lastSizeRescueAt = performance.now();
            enforceHandheldSize(live, ROOM_SIZE_MAX_M, { pinFront: true, distance: 1.45 });
            worldAnchored = true;
            saveRoomPose();
          }
        }
      }
    }
    // Keep AR passthrough clear, or the cream studio when the wrist toggle is off
    if (xrEnvDirty && xrEnterWorkSettled()) applyXrEnvironment();
    xrHud.visible = true;
    faceProbe.visible = false;
    try {
      pollXrTrackingResume();
      const sampled = syncInputVisibility();
      updateDockAttachment();
      // Hand index rays + aim must run before grab/scale picking
      updateHandRays({ pick: false });
      updatePinchAnchors();
      updateTwoHandScale();
      updateOneHandScale();
      updateGripGrab();
      updateGrab();
      void sampled;
    } catch (err) {
      console.warn("[viewport-xr] hand/controller update", err);
      try {
        // Last resort: keep something visible if sampling throws.
        controllers.forEach((c) => { if (c) c.visible = true; });
        grips.forEach((g) => { if (g) g.visible = true; });
        if (dock) dock.visible = true;
        if (captureDock) syncCaptureDockVisibility();
        updateDockAttachment();
      } catch {
        /* ignore */
      }
    }
    aiDrawWorkspace.update(performance.now());
    roomInventory.tick(performance.now());
    roomCamera.tick(performance.now());
    roomCameraView.tick(performance.now());
    roboticsWorkspace.tick({presenting, now:performance.now()});
    layoutOpenWindowsArc();
    updatePanelDrag();
    try { updateDockFollow(); } catch (err) { console.warn("[viewport-xr] dock follow", err); }
    if (!hoverDraw && shouldHoverDrawablePick({
      tool: activeTool,
      drawing: !!voiceDraw.isDrawing?.(),
      busy: isInteractionBusy(),
    }) && shouldExtraWorldPick({ busy: isInteractionBusy(), alreadyPicked: false })) {
      try {
        for (const row of pickCache.values()) {
          const hit = row?.hit;
          const root = findDrawableRoot(hit?.object) || (hit?.kind === "mesh" && hit.object?.userData?.xrDrawable ? hit.object : null);
          if (root?.userData?.xrDrawable) {
            if (hit.point) root.userData.lastHoverPoint = hit.point.clone();
            hoverDraw = root;
            break;
          }
        }
      } catch { /* ignore */ }
    }
    try { updateDrawAuthorLabel(hoverDraw); } catch (_) {}
    try { pollGamepads(); } catch (err) { console.warn("[viewport-xr] pollGamepads", err); }
    try {
      const sessNow = renderer.xr.getSession?.();
      const dtNow = Number(xrDevStats.dtMs?.()) || 0;
      xrDevStats.noteControlsFrame?.({
        now: performance.now(),
        dropped: dtNow > 22,
        throttle: !xrEnterWorkSettled() || (xrFrame - lastTraverseFrame > 1),
        inputSources: sessNow?.inputSources,
        interaction: controlsInteractionDebug(),
        teleopY: getDimosYControlDebug(),
        consume: lastXrConsume,
        ev: lastXrControlEv,
        hit: xrControlsUiTag(lastPointerHoverHit) || lastXrConsume || "miss",
        hand: lastXrHand,
        ov: {
          dimosArmed: isDimosTeleopArmed(),
          snapLaser: false,
          sticky: xrIgnoreStickyPress({
            enteredAt: xrPresentStartedAt,
            now: performance.now(),
            ignoreMs: XR_ENTER_STICKY_IGNORE_MS,
          }),
          laser: !!presenting,
        },
      });
      lastXrControlEv = "";
    } catch (_) {}
    updateTeleopLabels(grips, isDimosTeleopArmed());
    try {
      const rec = getDimosRecordState();
      if (shouldTickDimosTeleop({
        armed: isDimosTeleopArmed(),
        recording: !!rec.recording,
        playing: !!rec.playing,
      })) {
        // Refresh ownership immediately before sending Joy, including when
        // visual laser/dock updates were skipped or a panel just closed.
        publishDimosStudioUiOverride();
        tickDimosTeleop({ renderer, session: renderer.xr.getSession?.() });
      } else {
        pollDimosYControl({ renderer, session: renderer.xr.getSession?.() });
      }
    } catch (_) {}
    if (roboticsPanel?.group?.visible && performance.now() - roboticsPaintAt > 250) {
      roboticsPaintAt = performance.now();
      try { scheduleXrHudOffSelectTick(() => paintRoboticsPanel()); } catch (_) {}
    }
    updateRoboticsRightHandActivity(performance.now());
    // Clear one-frame finger aim after all picks
    for (const c of controllers) {
      if (c?.userData) c.userData.handAim = null;
    }
    // Live transcript while AI panel is open (fast while mic is on)
    if (aiPanel?.group.visible) {
      const listening = !!(typeof isTranscribing === "function" && isTranscribing());
      const generating = !!readAiState().generating;
      const interval = listening || generating ? 280 : 1400;
      if (performance.now() - aiPanelRefreshAt > interval) {
        refreshAiPromptPanel();
        aiPanelRefreshAt = performance.now();
      }
    }
    // Grid / floors stay off via hideSceneChrome (throttled traverse above)
    if (beacon?.visible && beacon.userData.born && performance.now() - beacon.userData.born > 5000) {
      beacon.visible = false;
    }
    getHeadPose();
    key.position.copy(_headPos).add(_keyOffset);
    try { updateMenuClarity(renderer.xr, tabbedWindows?.hasOpenWindows() || worldMenuGroupsForAim().length > 0); } catch (_) {}
  }

  function isPresenting() {
    return presenting || workspaceJoin || !!renderer.xr?.isPresenting;
  }

  let buttonBound = false;
  let lastStartAt = 0;
  function startXrFromUserGesture(opts = {}) {
    const fromBoot = opts.fromBoot === true;
    const now = performance.now();
    if (!bootEnterShouldCallSession({ lastStartAt, now, fromBoot, presenting })) {
      return Promise.resolve();
    }
    lastStartAt = now;
    // Same-turn call from the tap — no awaits before enter()/requestSession.
    // Do not getUserMedia / resumeAudio here on boot: that can consume Quest
    // user-activation. Mic is primed after requestSession starts.
    if (!fromBoot) void xrVoice.resumeAudio?.();
    if (typeof onBeforeEnterFromButton === "function" && !fromBoot) {
      try {
        if (onBeforeEnterFromButton() === false) return Promise.resolve();
      } catch (_) { /* fall through to enter */ }
    }
    if ((presenting || workspaceJoin) && !fromBoot) return exit();
    if (!getLiveMesh()) {
      const deferred = String(
        window.__xrDeferredProjectId || window.__xrBootEnter?.projectId || window.__xrBootPreferredProjectId || "",
      ).trim();
      if (!fromBoot && !isHeadsetBrowser() && !deferred) {
        reportXrError(new Error("Load a CAD model first, then tap AR"));
        return Promise.resolve();
      }
    }
    // Already on the desktop 3D shell (remix / document Viewport chip) still enters
    // immersive VR/AR — never treat the viewport hash as the session.
    return enterWithCameraFallback().catch((err) => {
      if (fromBoot) {
        try { restoreBootSplashAfterXrFail(xrEnterFailMessage(err)); } catch (_) {}
      }
      throw err;
    });
  }

  function enterFromBoot(opts = {}) {
    const pending = window.__xrBootEnter || {};
    const projectId = String(
      opts.projectId || pending.projectId || window.__xrBootPreferredProjectId || "",
    ).trim();
    const tour = !!opts.tour || !!pending.tour;
    window.__xrBootEnter = {
      emptyScene: tour || !projectId,
      openMenu: true,
      tour,
      fromBoot: true,
      projectId,
    };
    try { window.__studioXrBootReady = true; } catch (_) {}
    return startXrFromUserGesture({ fromBoot: true });
  }

  try { window.__enterXrFromBoot = enterFromBoot; } catch (_) {}
  try {
    const rawResume = sessionStorage.getItem("render3d:xrSoftResume");
    const resume = rawResume ? JSON.parse(rawResume) : null;
    if (resume?.reenter && Date.now() - Number(resume.t || 0) < 20000) {
      sessionStorage.removeItem("render3d:xrSoftResume");
      if (resume.projectId) window.__xrDeferredProjectId = String(resume.projectId);
      if (resume.sceneId) {
        try { localStorage.setItem("render3d:xrSceneKind", String(resume.sceneId)); } catch (_) {}
      }
      setTimeout(() => {
        Promise.resolve(enterFromBoot({ projectId: resume.projectId || "" })).catch(() => {
          // Browsers may require one confirmation after a full navigation.
          try { offerXrSessionForSoftReload(navigator.xr); } catch (_) {}
        });
      }, 350);
    }
  } catch (_) {}

  function bindArButton() {
    if (!buttonEl || buttonBound) return;
    buttonBound = true;
    buttonEl.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      Promise.resolve(startXrFromUserGesture()).catch((err) => reportXrError(err));
    });
    // Quest Browser sometimes delivers pointerup without a trusted click.
    buttonEl.addEventListener("pointerup", (e) => {
      if (e.pointerType === "mouse") return;
      if (presenting) return;
      e.preventDefault();
      e.stopPropagation();
      Promise.resolve(startXrFromUserGesture()).catch((err) => reportXrError(err));
    }, { passive: false });
    syncArButtonChrome();
  }

  function syncArButtonChrome() {
    // Always keep the viewport AR FAB visible — desktop uses webcam AR when WebXR is absent.
    const show = true;
    const label = sessionMode === "immersive-vr" ? "VR" : "AR";
    const title =
      sessionMode === "immersive-vr"
        ? "VR — enter immersive VR (AR not available on this browser)"
        : supported
          ? "AR — place the model in your room; falls back to VR if AR is unavailable"
          : typeof launchDesktopAr === "function" || mobileArAvailable
            ? "AR — view this model through your camera"
            : "AR/VR — open on a phone or Quest";
    const apply = (el) => {
      if (!el) return;
      el.hidden = !show;
      el.classList.toggle("hidden", !show);
      el.disabled = false;
      el.removeAttribute("hidden");
      el.style.display = "";
      el.title = title;
      const span = el.querySelector("span") || el.querySelector(".ribbon-view-label");
      if (span) span.textContent = label;
    };
    apply(buttonEl);
    apply(ribbonButtonEl || document.getElementById("btn-xr-vr-ribbon"));
  }

  async function probeSupport() {
    let arOk = false;
    let vrOk = false;
    try {
      if (navigator.xr) {
        try {
          arOk = !!(await navigator.xr.isSessionSupported("immersive-ar"));
        } catch {
          arOk = false;
        }
        try {
          vrOk = !!(await navigator.xr.isSessionSupported("immersive-vr"));
        } catch {
          vrOk = false;
        }
      }
    } catch {
      arOk = false;
      vrOk = false;
    }
    supported = arOk || vrOk || (!!navigator.xr && isHeadsetBrowser());
    try { window.__studioXrBootReady = true; } catch (_) {}
    // Passthrough requires immersive-ar. Only use VR if AR is unavailable.
    if (arOk) sessionMode = "immersive-ar";
    else if (vrOk) sessionMode = "immersive-vr";
    else sessionMode = "immersive-ar";
    mobileArAvailable = typeof launchMobileAr === "function";
    syncArButtonChrome();
    if (isHeadsetBrowser()) primeHeadsetMic();
    return supported || mobileArAvailable || typeof launchDesktopAr === "function";
  }

  function disposeRecordSpectator() {
    if (recordSpectator) {
      try { recordSpectator.renderer?.dispose?.(); } catch (_) {}
      try { recordSpectator.canvas?.remove?.(); } catch (_) {}
      recordSpectator = null;
    }
    try { recordOverlay?.target?.dispose?.(); } catch (_) {}
    recordOverlay = null;
    lastRecordPaintAt = 0;
  }

  /**
   * Offscreen WebGL canvas for POV capture. The live headset layer cannot be
   * copied (Quest compositor / alpha-clear canvas). Never created on the XR click tick.
   * Stills use XR framebuffer / recommended size — not a CSS-pixel 960×540.
   */
  function xrLayerCaptureSize(still = false) {
    let fw = 0;
    let fh = 0;
    try {
      const layer = renderer?.xr?.getSession?.()?.renderState?.baseLayer;
      fw = Number(layer?.framebufferWidth) || 0;
      fh = Number(layer?.framebufferHeight) || 0;
    } catch (_) {}
    return xrSpectatorCaptureSize({ framebufferWidth: fw, framebufferHeight: fh, still });
  }

  function ensureRecordSpectator(w, h, { antialias = true } = {}) {
    if (!globalThis.__studioMainWebGlReady) return null;
    if (recordSpectatorFailed) return null;
    const tw = Math.max(640, Math.min(2560, Math.round(w) || 1920));
    const th = Math.max(360, Math.min(1440, Math.round(h) || 1080));
    if (recordSpectator?.renderer && recordSpectator.w === tw && recordSpectator.h === th) {
      return recordSpectator;
    }
    disposeRecordSpectator();
    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    canvas.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none;";
    try { document.body.appendChild(canvas); } catch (_) {}
    let recRenderer = null;
    try {
      recRenderer = new THREE.WebGLRenderer({
        canvas,
        antialias: antialias !== false,
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
        depth: true,
        stencil: false,
      });
    } catch (err) {
      console.warn("[viewport-xr] record spectator GL unavailable", err);
      recordSpectatorFailed = true;
      try { canvas.remove?.(); } catch (_) {}
      return null;
    }
    recRenderer.setPixelRatio(1);
    recRenderer.setSize(tw, th, false);
    recRenderer.autoClear = true;
    recRenderer.outputColorSpace = renderer.outputColorSpace;
    recRenderer.toneMapping = THREE.NoToneMapping;
    recordSpectator = {
      renderer: recRenderer,
      canvas,
      cam: new THREE.PerspectiveCamera(70, tw / Math.max(1, th), XR_DEPTH_NEAR, XR_DEPTH_FAR),
      w: tw,
      h: th,
    };
    return recordSpectator;
  }

  function copyXrViewToSpectator(specCam, aspect) {
    let src = camera;
    try {
      const xrCam = renderer.xr?.getCamera?.(camera);
      if (xrCam?.cameras?.length) src = xrCam.cameras[0];
      else if (xrCam) src = xrCam;
    } catch (_) {}
    specCam.position.setFromMatrixPosition(src.matrixWorld);
    specCam.quaternion.setFromRotationMatrix(src.matrixWorld);
    const eyes=renderer.xr?.getCamera?.(camera)?.cameras;
    if(eyes?.length===2){
      specCam.position.setFromMatrixPosition(eyes[0].matrixWorld).add(new THREE.Vector3().setFromMatrixPosition(eyes[1].matrixWorld)).multiplyScalar(.5);
    }
    specCam.near = src.near || XR_DEPTH_NEAR;
    specCam.far = src.far || XR_DEPTH_FAR;
    specCam.aspect = aspect;
    if (src.projectionMatrix) {
      specCam.projectionMatrix.copy(src.projectionMatrix);
      // A mono video needs a centered frustum with its own aspect ratio.
      const p=specCam.projectionMatrix.elements;
      p[0]=p[5]/Math.max(.1,aspect);
      if(eyes?.length===2){p[8]=(eyes[0].projectionMatrix.elements[8]+eyes[1].projectionMatrix.elements[8])*.5;p[9]=(eyes[0].projectionMatrix.elements[9]+eyes[1].projectionMatrix.elements[9])*.5;}
      specCam.projectionMatrixInverse.copy(specCam.projectionMatrix).invert();
    } else {
      specCam.fov = src.fov || 70;
      specCam.updateProjectionMatrix();
    }
  }

  /**
   * Mono headset POV for video / deferred screenshot.
   * Quest compositor passthrough is not in the WebXR GL canvas — that canvas is
   * often alpha-cleared, so MediaRecorder(canvas) looks black. This paints the
   * 3D POV (models, hands, HUD) on a separate preserveDrawingBuffer canvas.
   * getUserMedia world camera is composited under it when available.
   * Never toDataURL / readPixels the headset framebuffer. Never on the click tick.
   */
  function paintRecordOverlayCanvas(w, h, opts = {}) {
    if (!renderer || !presenting) return recordSpectator?.canvas || null;
    const now = performance.now();
    const minMs = Number(opts.minIntervalMs) > 0 ? Number(opts.minIntervalMs) : 33;
    if (!opts.force && recordSpectator?.canvas && (now - lastRecordPaintAt) < minMs) {
      return recordSpectator.canvas;
    }
    const still = opts.still === true;
    const sized = (Number(w) > 0 && Number(h) > 0)
      ? { w: Number(w), h: Number(h) }
      : xrLayerCaptureSize(still);
    const spec = ensureRecordSpectator(sized.w, sized.h, { antialias: still || opts.antialias !== false });
    if (!spec?.renderer || !spec.canvas) return null;
    const prevBg = scene.background;
    try {
      copyXrViewToSpectator(spec.cam, spec.w / Math.max(1, spec.h));
      spec.cam.updateMatrixWorld?.(true);
      const passthrough = !!(sessionIsPassthrough && passthroughOn);
      if (passthrough) {
        scene.background = null;
        spec.renderer.setClearColor(0x000000, 0);
      } else {
        spec.renderer.setClearColor(0xe7e5e4, 1);
      }
      scene.updateMatrixWorld(true);
      spec.renderer.render(scene, spec.cam);
      lastRecordPaintAt = now;
      return spec.canvas;
    } catch (err) {
      console.warn("[viewport-xr] record overlay", err);
      return spec.canvas || null;
    } finally {
      scene.background = prevBg;
    }
  }

  function capturePovDataUrl() {
    const live = presenting || !!renderer?.xr?.isPresenting;
    if (!shouldCaptureWebglFramebufferOnXrMenu({ presenting: live })) return null;
    if (!shouldCreateWebglForXrSettings({ presenting: live })) return null;
    const hidePairs = [];
    const stash = (obj) => {
      if (!obj) return;
      hidePairs.push([obj, obj.visible]);
      obj.visible = false;
    };
    stash(dock);
    stash(captureDock);
    stash(toolWheel?.group);
    stash(explorerPanel?.group);
    stash(aiPanel?.group);
    stash(placePanel?.group);
    stash(measureGroup);
    stash(faceProbe);
    stash(beacon);
    try {
      // Prefer the live XR camera when presenting
      const xrCam = renderer.xr?.isPresenting ? renderer.xr.getCamera?.(camera) : null;
      renderer.render(scene, xrCam || camera);
      const url = renderer.domElement?.toDataURL?.("image/png");
      if (url && url.startsWith("data:image/") && url.length > 2000) return url;
    } catch (err) {
      console.warn("[viewport-xr] capture failed", err);
    } finally {
      for (const [obj, vis] of hidePairs) obj.visible = vis;
    }
    return null;
  }

  try {
    setupControllers();
  } catch (err) {
    console.warn("[viewport-xr] controller/hand setup failed", err);
  }
  bindArButton();
  bindMicAutoStart();
  window.addEventListener("pagehide", () => { try { saveRoomPose(); } catch (_) {} });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      try { saveRoomPose(); } catch (_) {}
    }
    if (presenting && document.visibilityState === "visible") {
      try {
        restoreDockHandFromSettings();
        if (shouldRebindXrDockHosts({ presenting: true, documentBecameVisible: true })) {
          rebindXrInputHosts("document");
        } else {
          updateDockAttachment();
        }
      } catch (_) {}
    }
  });
  void probeSupport();
  // Thin bindings to existing UI setters; the voice router validates and serializes commands.
  const voiceControlRows = [
    ['passthrough','Passthrough',()=>passthroughOn,setPassthroughOn],
    ['teleop','Teleop controls (Y still owns arm follow)',isDimosTeleopArmed,on=>{setDimosTeleopArmed(on,session);return {message:on?'Teleop controls enabled. Use Y to start arm follow.':'Teleop controls disabled; this is not a homing command.'};}],
    ['room_microphone','Room microphone',isHeadsetMicLive,()=>toggleHeadsetMic()],
    ['developer_mode','Developer mode',()=>developerMode,persistDeveloperMode],
    ['fps_hud','FPS statistics',()=>xrDevStats.isStatsOpen(),on=>{if(on&&!developerMode)persistDeveloperMode(true);xrDevStats.setStatsOpen(on);}],
    ['controller_logging','Controller diagnostic logging',()=>xrDevStats.isRecording(),on=>on?xrDevStats.startRecording():xrDevStats.stopRecording()],
    ['browser_window','Browser window',()=>!!sceneWinState.browserOn,on=>on?showXrSceneWindow('browser'):hideXrSceneWindow('browser')],
    ['display_window','Display window',()=>!!sceneWinState.displayOn,on=>on?showXrSceneWindow('display'):hideXrSceneWindow('display')],
    ['windows_pinned','Pin browser and display windows',()=>sceneWinState.pinned!==false,()=>handleWindowsSettingsAction('win_pin')],
    ['window_width','Browser and display width',()=>sceneWinState.widthId||'m',value=>{sceneWinState.widthId=value;writeXrSceneWindowPrefs({widthId:value});applySceneWindowWidth(sceneWindows.browser);applySceneWindowWidth(sceneWindows.display);},'string',['s','m','l']],
    ['menu_hand','Menu hand',()=>preferredDockHand,setPreferredDockHand,'string',['left','right']],
    ['collaboration_space','Shared scene or my local copy',()=>collabSpace,setCollabSpace,'string',['shared','local']],
    ['locomotion','Board, walking or teleport mode',()=>xrBoard.state.teleport?'teleport':xrBoard.state.mode==='god'?'board':'walk',handleBoardAction,'string',['board','walk','teleport']],
    ['tool_wheel','Tool wheel',()=>!!toolWheel?.isVisible?.(),()=>toggleToolWheel()],
    ['draw_eraser','Drawing eraser',()=>drawEraserOn,setDrawEraser],
    ['draw_size','Drawing size',()=>drawSizeId,setDrawSize,'string',['draw_size_s','draw_size_m','draw_size_l']],
    ['printer_accept','Accept print requests',()=>!!printerPrefs.accept_sends,()=>handleShareAction('printer_accept')],
    ['printer_outline','Printer boundary',()=>!!printerPrefs.show_outline,()=>handleShareAction('printer_outline')],
    ['printer_model','Printer model',()=>!!printerPrefs.show_model,()=>handleShareAction('printer_model')],
  ];
  return {
    enter,
    exit,
    getVoiceControlSession:()=>liveVoiceXrSession(presenting,session,renderer.xr),
    getVoiceControls:()=>voiceControlRows.map(([id,label,read,write,type='boolean',values])=>({id,label,read,write:async value=>{const result=await write(value);refreshGridPopupSoon('settings');refreshWorkspacePanel();return result;},type,values})),
    getVoiceActions:()=>[
      ...['screenshot_to_pc','start_recording','stop_recording','pause_recording','resume_recording'].map(id=>({id,label:id.replaceAll('_',' '),run:()=>opts.onVoiceCaptureAction?.(id)})),
      {id:'reset_scene',label:'Recenter VR scene and restore menus; keep project files and robot state',run:async()=>{const active=liveVoiceXrSession(presenting,session,renderer.xr);if(!active)return {ok:false,error:'No active headset session.'};await restartVrSceneKeepSession();return renderer.xr.getSession?.()===active?{ok:true,message:'VR scene recentered and menus restored. Project files were kept.'}:{ok:false,error:'VR session changed during reset.'};}},
      {id:'save_window_layout',label:'Save current window placement',run:()=>{saveOpenWindowsLayout();return {ok:true,message:'Window layout save requested.'};}},
      {id:'move_round_table',label:'Move the AI round table to the laser aim on the floor or scene',run:()=>moveRoundTableToLaser()},
      {id:'enable_sandbox',label:'Open the sandbox window',run:()=>roundTableCommand('enable_sandbox')},
      {id:'voice_examples',label:'Preview supported Hey AI voices one at a time',run:()=>roundTableCommand('voice_examples',{text:'sample other voices'})},
    ],
    toggle,
    enterWithCameraFallback,
    enterFromBoot,
    startFromUserGesture: startXrFromUserGesture,
    update,
    isPresenting: () => isPresenting(),
    isSupported: () => supported || mobileArAvailable || typeof launchDesktopAr === "function",
    probeSupport,
    setTool,
    openPrintRequest: openPrinterRequestPopup,
    setPrinterPrefs: (s) => {
      if (!s || typeof s !== "object") return;
      printerPrefs = {
        ...printerPrefs,
        accept_sends: s.accept_sends != null ? !!s.accept_sends : printerPrefs.accept_sends,
        show_outline: s.show_outline != null ? !!s.show_outline : printerPrefs.show_outline,
        show_model: s.show_model != null ? !!s.show_model : printerPrefs.show_model,
        lan_ip: s.lan_ip != null ? String(s.lan_ip || "") : printerPrefs.lan_ip,
        serial: s.serial != null ? String(s.serial || "") : printerPrefs.serial,
        name: s.name != null ? String(s.name || "") : printerPrefs.name,
        access_code_set: s.access_code_set != null ? !!s.access_code_set : printerPrefs.access_code_set,
        access_code: s.access_code != null ? String(s.access_code || "") : printerPrefs.access_code,
      };
      applyPrinterConfigFields(typeof localStorage !== "undefined" ? localStorage : null, {
        lan_ip: printerPrefs.lan_ip,
        serial: printerPrefs.serial,
        name: printerPrefs.name,
        access_code: s.access_code != null ? s.access_code : undefined,
        accept_sends: printerPrefs.accept_sends,
        show_outline: printerPrefs.show_outline,
        show_model: printerPrefs.show_model,
        fence: s.fence,
      });
      if (s.fence && !isLeftoverAutoPrinterFence(s.fence)) applyPrinterFence(s.fence, { persist: true, share: false });
      else if (s.fence && isLeftoverAutoPrinterFence(s.fence)) applyPrinterFence(null, { persist: true, share: false });
      else {
        printerVisualsDirty = true;
        syncPrinterVisuals();
      }
      paintRoboticsPanel();
    },
    createPrinterBounder: () => createOrShowPrinterBounder(),
    openPrinterConfig: (focus) => sendPrinterConfigToPc(focus),
    syncPrinterShareSettings: (s) => {
      if (!s || typeof s !== "object") return;
      printerPrefs = {
        accept_sends: !!s.accept_sends,
        show_outline: !!s.show_outline,
        show_model: !!s.show_model,
      };
      if (s.fence && !isLeftoverAutoPrinterFence(s.fence)) applyPrinterFence(s.fence, { persist: true, share: false });
      else if (s.fence && isLeftoverAutoPrinterFence(s.fence)) applyPrinterFence(null, { persist: true, share: false });
      else {
        printerVisualsDirty = true;
        syncPrinterVisuals();
      }
    },
    openPrinterRequestPopup,
    setPrinterVolumeMm: (mm) => {
      printerVolumeM = printerVolumeFromProfile({ volume_mm: mm, specs: { volume_mm: mm } }) || ensurePrinterVolume();
      syncPrinterVisuals();
    },
    getSessionMode: () => sessionMode,
    isPassthroughOn: () => !!passthroughOn,
    placeInFront,
    beginProjectSwap,
    placeAfterProjectLoad,
    cancelPlaceAfterProjectLoad,
    invalidateSavedDesktop,
    prepareLiveMeshesForXr: () => {
      const mesh = getLiveMesh();
      if (mesh) prepareMeshesForXr(mesh);
    },
    saveRoomPose,
    restoreRoomPoseAfterCadEdit,
    applySavedPose,
    capturePovDataUrl,
    paintRecordOverlayCanvas,
    openAgentReview: () => agentAvatar.openReview(),
    dismissAgent: () => agentAvatar.dismiss(),
    spawnAgent: () => agentAvatar.spawn?.(),
    getAgentPose: () => agentAvatar.getPose(),
    openSlicerPlatePreview,
    slicerPlateCommand,
    getSlicerPlateContext: () => slicerVoiceContext(slicerPreview.getLayout() || {}, {
      pointed_ids: slicerPreview.getLayout()?.pointed_ids || [],
      draw_selected_ids: drawSelectedSlicerIds(slicerPreview.getLayout() || {}),
    }),
    feedTalkControlDebugger,
    toggleAiRoundTable,
    roundTableCommand,
    passLiveTableLogs,
    disposeRecordSpectator,
    getVoiceMicStream: () => xrVoice.getMicStream?.() || null,
    setCaptureState,
    saveOpenWindowsLayout,
    restoreOpenWindowsLayout,
    applyNamedLayout,
    openMenuConsole,
    getAiDrawWorkspace: () => aiDrawWorkspace,
    openAiDrawWorkspace: () => { setTool("draw_ai_prompt"); },
    openDrawCanvas: () => { setTool('draw_canvas'); },
    getDrawBoardVoiceContext: () => aiDrawWorkspace.getVoiceContext(),
    getSceneDrawingEvidence: () => {
      const objects = [...voiceDraw.listDrawables(), ...xrSolidDraw.listDrawables()];
      objects.forEach(object => object.updateWorldMatrix?.(true, false));
      return collectSceneDrawingEvidence(objects, { maxBytes: 5500 });
    },
    exportSceneDrawingDocument: () => {
      const objects = [...voiceDraw.listDrawables(), ...xrSolidDraw.listDrawables()];
      objects.forEach(object => object.updateWorldMatrix?.(true, false));
      return exportSceneDrawingDocument(objects);
    },
    drawBoardVoiceCommand: args => aiDrawWorkspace.voiceCommand(args),
    openAiPromptPanel,
    closeAiPromptPanel,
    refreshAiPromptPanel,
    applyEnvironmentWrap,
    setXrSceneKind,
    getXrSceneKind: () => xrSceneKind,
    getWorkshopProject: () => ({
      projectId: String(getProjectId?.() || ""),
      model: getSelectedFile?.() || "",
      loaded: !!xrWorkshopProjectRoom,
      screens: Object.keys(WORKSHOP_SCREEN_DEFAULTS),
    }),
    enterWorkshop,
    enterWorkshopVr,
    exitWorkshop: exitWorkspaceJoin,
    updateWorkshop,
    pinWorkshopFeature,
    applyWorkshopMonitorPins,
    placeModelOnWorkshopTable: (mesh = getLiveMesh()) => placeModelOnWorkshopTable(mesh),
    isWorkshopActive: () => usesWorkshopGenerationPlacement({ presenting, workspaceJoin, sceneKind: xrSceneKind }),
    requestGenerationSurfacePick,
    pickGenerationSurface: requestGenerationSurfacePick,
    cancelGenerationSurfacePick,
    getSelectedGenerationSurface: () => selectedGenerationSurface ? structuredClone(selectedGenerationSurface) : null,
    setAiPanelStatus: (msg) => {
      if (aiPanel) aiPanel.status = String(msg || "");
      refreshAiPromptPanel();
    },
    setAiGenerating: (on, msg = "") => {
      if (aiPanel) {
        if (on) aiPanel.status = String(msg || "Generating…");
        else if (aiPanel.status && /generat/i.test(aiPanel.status)) aiPanel.status = "";
      }
      refreshAiPromptPanel();
      if (presenting && explorerPanel?.group.visible && menuTab === "ai") {
        openMenuConsole({ tab: "ai", keepPose: true });
      }
    },
    setMenuFooterHint: (hint) => {
      menuFooterHint = String(hint || "");
      if (presenting && explorerPanel?.group.visible) {
        openMenuConsole({ tab: menuTab, keepPose: true });
      }
    },
    setVoiceMoldLive: (on) => {
      voiceMoldLive = !!on;
      if (on) startTableVoiceMoveWatch();
      if (aiPanel?.talkStatus && !aiPanel.talkPending) {
        if (on) {
          aiPanel.talking = true; aiPanel.talkConnecting = false; aiPanel.talkError = false;
          aiPanel.status = aiPanel.talkStatus = "Astra is listening — she will talk in the headset";
        } else if (!aiPanel.talkConnecting && !aiPanel.talkError) {
          aiPanel.talking = false;
          aiPanel.status = aiPanel.talkStatus = "Astra is disconnected. Press Talk to reconnect.";
        }
        refreshAiPromptPanel();
      }
      syncDock();
      if (presenting && explorerPanel?.group.visible && menuTab === "tools") {
        openMenuConsole({ tab: "tools", keepPose: true });
      }
    },
    toggleVoiceDraw,
    isVoiceDrawOn: () => activeTool === "draw",
    snapshotVoiceDrawForPrompt: () => {
      try {
        commitLiveDrawClip();
        const mesh = getLiveMesh();
        const snap = voiceDraw.snapshot({
          formatLength,
          measureMm: measureDistanceMm,
          modelName: (typeof getAiPromptState === "function" && getAiPromptState()?.selectedLabel)
            || mesh?.name
            || "",
        }) || {};
        const solids = xrSolidDraw.toPromptAugment?.() || "";
        const draft = (() => {
          try {
            return String(getAiPromptState?.()?.draft || getPromptDraft?.() || "");
          } catch { return ""; }
        })();
        const extra = [
          solids,
        ].filter(Boolean).join("\n\n");
        const spoken = collapseRepeatedSpokenPrompt(draft);
        const promptAugment = [snap.promptAugment, extra].filter(Boolean).join("\n\n");
        const spokenAlready = spoken && String(promptAugment || "").includes(spoken);
        return {
          ...snap,
          promptAugment: spoken && !spokenAlready
            ? [promptAugment, spoken].filter(Boolean).join("\n\n")
            : promptAugment,
          strokeCount: snap.strokeCount || (solids ? 1 : 0),
          imageDataUrl: snap.imageDataUrl || "",
          clips: snap.clips || [],
          solids,
        };
      } catch {
        return null;
      }
    },
    commitVoiceDrawClip: () => commitLiveDrawClip(),
    removeVoiceDrawClip: (id) => {
      try { return voiceDraw.removeClip?.(id); } catch { return false; }
    },
    clearVoiceDraw: () => {
      try { voiceDraw.clear(); } catch (_) {}
    },
    undoVoiceDraw: () => {
      try { return undoXrCreate(); } catch { return false; }
    },
    undoXrCreateVisual: () => {
      try { return undoXrCreateVisual(); } catch { return false; }
    },
    redoXrCreateVisual: () => {
      try { return redoXrCreateVisual(); } catch { return false; }
    },
    handleRtcSignal: (msg) => msg?.signal?.channel === XR_AGENT_JOIN_CHANNEL
      ? agentJoin.receive(String(msg.user_id || ""), msg.signal)
      : msg?.signal?.channel === INVENTORY_CHANNEL
      ? roomInventory.receive(String(msg.user_id || ''),msg.signal)
      : msg?.signal?.channel === CAMERA_CHANNEL
      ? roomCamera.receive(String(msg.user_id || ''), msg.signal).catch(error=>onStatus?.('error',error.message))
      : xrVoice.handleSignal(msg),
    applyRemotePose: (msg) => {
      if (!presenting || !msg?.user_id) return;
      try {
        xrPresence.upsert({
          id: msg.user_id,
          display_name: msg.display_name,
          color: msg.color,
        });
      } catch (_) {}
      const held = msg.pose?.held;
      const showGhost = remoteHeldShowsGhost({
        remoteSpace: held?.space,
        hasHeldPose: !!(held && Array.isArray(held.p)),
      });
      const pose = msg.pose
        ? {
          ...msg.pose,
          held: held && !showGhost && !held.draw_id
            ? { ...held, object_id: held.object_id || "assembly" }
            : held,
        }
        : msg.pose;
      xrPresence.applyPose(msg.user_id, pose);
      if (!held) return;
      // Shared drops have their own geometry and transform stream; never move
      // this user's private CAD assembly when a peer holds a public object.
      if (held.object_id && held.object_id !== 'assembly') return;
      if (held.draw_id) {
        const drawMesh = voiceDraw.findDrawable?.(held.draw_id) || xrSolidDraw.findDrawable?.(held.draw_id);
        if (drawMesh && drawMesh !== gripGrab?.target && drawMesh !== grabState?.target) {
          applyPackedPose(drawMesh, held);
        }
        return;
      }
      if (remoteHeldAffectsLocalMesh({
        localSpace: collabSpace,
        remoteSpace: held.space,
        grabbingLocal: !!(gripGrab || scaleGrab || grabState),
      })) {
        const mesh = getLiveMesh();
        if (mesh && mesh !== gripGrab?.target && mesh !== grabState?.target) {
          applyPackedPose(mesh, held);
        }
      }
    },
    applyRemoteDraw: (msg) => {
      try { applyRemoteDrawMessage(msg); } catch (_) {}
    },
    applyPublicDrop: (msg) => ingestPublicDropMessage(msg),
    spawnPublicDrop,
    openSharedVideo,
    openShareInvite: openXrShareInviteFromEvent,
    openXrShareInviteFromEvent,
    clearPublicDrops: () => publicDrops.clear(),
    applyRemoteStroke: (msg) => {
      try {
        const stroke = { ...(msg.stroke || msg) };
        if (stroke.authorName && msg.display_name) stroke.authorName = stroke.authorName || msg.display_name;
        if (!stroke.authorName && msg.display_name) stroke.authorName = msg.display_name;
        if (!stroke.authorId && msg.user_id) stroke.authorId = msg.user_id;
        if (!stroke.createdAt && msg.created_at) stroke.createdAt = msg.created_at;
        voiceDraw.applyRemoteStroke?.(msg.user_id, stroke);
      } catch (_) {}
    },
    openStudio: () => toggleStudioPanel(),
    refreshStudio: () => refreshStudioPanel(),
    openRoboticsTerminal: () => {
      try { window.__openRoboticsTerminal?.(); } catch (_) {}
    },
    enterGodView,
    isDesktopVrWorkspace: () => !!workspaceJoin,
    placeWorkspacePiece: (kind, pose) => workspaceWorld?.addPiece?.(kind, pose),
    undoWorkspacePiece: () => workspaceWorld?.removeLast?.(),
    readWorkspaceWorld: () => workspaceWorld?.read?.(),
    rebuildWorkspaceWorld: () => workspaceWorld?.rebuild?.(),
  };
}
