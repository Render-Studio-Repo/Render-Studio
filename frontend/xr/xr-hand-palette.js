/**
 * Gravity Sketch–style watch palette: compact 3×3 on the menu hand,
 * expandable capture folder plus Undo/Redo on the left wrist.
 */

import * as THREE from "three";
import { makeColoredPuckTexture } from "./xr-ui-tex.js?v=20260908-xr-robotics1-20260914-vrmenu1-20260914-vrshare1&wristfix=20260916-3";
import { dockHandLabel, normalizeDockHand } from "./xr-dock-hand.js?v=20260908-xr-robotics1";
import {
  WRIST_STATUS_TOOL_IDS,
  WRIST_RAIL_TOOL_IDS,
  crescentCaptureToolIds,
  formatXrRecordingClock,
  xrWristPlateDepthFlags,
  WRIST_PLATE_PAD_M,
  WRIST_PLATE_BORDER_EXTRA_M,
  WRIST_PLATE_HOVER_SCALE,
  wristPlateLayout,
  wristPlateCanvasSize,
} from "./xr-hot-path.js?v=roboticsworkspace3&xrtalk=20260916-1&lefthud1=1&astra=20260916-5";

export { WRIST_PLATE_PAD_M, WRIST_PLATE_BORDER_EXTRA_M, WRIST_PLATE_HOVER_SCALE, wristPlateLayout };

const TILE = 0.024;
const HIT = 0.013;
const COLS = 3;
const GAP_X = 0.046;
const GAP_Y = 0.026;
const TEX = 256;
const STATUS_TILE = 0.016;
const STATUS_GAP = 0.02;
const STATUS_TEX = 128;
export const WRIST_PLATE_LOGO = "/media/images/render-animations/VR-Animations/render-logo-gear-still.png?v=20260915-logo1";

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

function paintWristPlateTexture(plateW, plateH, { logo = true } = {}) {
  const canvas = document.createElement("canvas");
  const size = wristPlateCanvasSize(plateW, plateH);
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size.width, size.height);
  const inset = 6;
  const rw = size.width - inset * 2;
  const rh = size.height - inset * 2;
  const r = Math.min(rw, rh) * 0.08;
  roundRect(ctx, inset, inset, rw, rh, r);
  const g = ctx.createLinearGradient(0, 0, size.width, size.height);
  g.addColorStop(0, "rgba(8,47,73,0.94)");
  g.addColorStop(0.45, "rgba(11,18,32,0.9)");
  g.addColorStop(1, "rgba(15,23,42,0.92)");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.save();
  roundRect(ctx, inset, inset, rw, rh, r);
  ctx.clip();
  ctx.strokeStyle = "rgba(56,189,248,0.12)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 10; i += 1) {
    const px = inset + (i / 10) * rw;
    const py = inset + (i / 10) * rh;
    ctx.beginPath();
    ctx.moveTo(px, inset);
    ctx.lineTo(px, inset + rh);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(inset, py);
    ctx.lineTo(inset + rw, py);
    ctx.stroke();
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(125,211,252,0.42)";
  ctx.lineWidth = 4;
  roundRect(ctx, inset, inset, rw, rh, r);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  if (logo) {
    try {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        const iw = img.naturalWidth || img.width || 1;
        const ih = img.naturalHeight || img.height || 1;
        const max = Math.min(size.width, size.height) * 0.16;
        const s = Math.min(max / iw, max / ih);
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.drawImage(img, size.width / 2 - (iw * s) / 2, size.height / 2 - (ih * s) / 2, iw * s, ih * s);
        ctx.restore();
        tex.needsUpdate = true;
      };
      img.src = WRIST_PLATE_LOGO;
    } catch (_) {}
  }
  return tex;
}

function hideRaycast(mesh) {
  mesh.raycast = () => {};
  mesh.userData.xrRaycast = false;
}

function addPuck(parent, tool, x, y, buttons, {
  tile = TILE,
  iconOnly = false,
  texSize = TEX,
  duplicate = true,
} = {}) {
  const color = tool.color || 0xe85d4c;
  const map = makeColoredPuckTexture({
    label: tool.label,
    icon: tool.icon,
    color,
    size: texSize,
    iconOnly,
  });
  const activeMap = makeColoredPuckTexture({
    label: tool.label,
    icon: tool.icon,
    color,
    active: true,
    size: texSize,
    iconOnly,
  });
  const hit = new THREE.Mesh(
    new THREE.CircleGeometry(tile / 2, 28),
    new THREE.MeshBasicMaterial({
      map,
      transparent: true,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  hit.position.set(x, y, 0.008);
  hit.userData.xrTool = tool.id;
  hit.userData.xrIcon = tool.icon;
  hit.userData.xrLabel = tool.label;
  hit.renderOrder = 10080;
  hit.frustumCulled = false;
  parent.add(hit);

  if (duplicate) {
    const puck = new THREE.Mesh(
      new THREE.CircleGeometry(tile / 2 - 0.0004, 28),
      new THREE.MeshBasicMaterial({
        map,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    puck.position.copy(hit.position);
    puck.position.z += 0.002;
    puck.renderOrder = 10082;
    puck.frustumCulled = false;
    puck.userData.xrTool = tool.id;
    hideRaycast(puck);
    parent.add(puck);
    hit.userData.puck = puck;
  } else {
    hit.userData.puck = hit;
  }
  hit.userData.idleMap = map;
  hit.userData.activeMap = activeMap;
  buttons.push(hit);
  return hit;
}

function makeHandButtonTexture(hand, active = false) {
  return makeColoredPuckTexture({
    label: dockHandLabel(hand),
    icon: "sym",
    color: active ? 0x0f766e : 0x334155,
    active,
    size: TEX,
  });
}

function addPlate(group, plateW, plateH, plateX, plateY, name, { logo = true } = {}) {
  const plateMap = paintWristPlateTexture(plateW, plateH, { logo });
  const depth = xrWristPlateDepthFlags();
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(plateW + WRIST_PLATE_BORDER_EXTRA_M, plateH + WRIST_PLATE_BORDER_EXTRA_M),
    new THREE.MeshBasicMaterial({
      map: plateMap,
      color: 0xffffff,
      transparent: false,
      alphaTest: .1,
      side: THREE.DoubleSide,
      toneMapped: false,
      depthTest: depth.depthTest,
      depthWrite: depth.depthWrite,
    }),
  );
  plate.name = name;
  plate.position.set(plateX, plateY, 0.001);
  plate.renderOrder = 10070;
  plate.frustumCulled = false;
  plate.userData.xrUi = "chrome";
  plate.userData.xrWorldDepth = true;
  group.add(plate);
  return plate;
}

/**
 * Watch-face / palm-up: easier than a strict roll. Uses stick-face up OR local X up.
 */
export function leftWristRevealAmount(anchor) {
  if (!anchor) return 0;
  anchor.updateMatrixWorld?.(true);
  const x = new THREE.Vector3(1, 0, 0).transformDirection(anchor.matrixWorld);
  const y = new THREE.Vector3(0, 1, 0).transformDirection(anchor.matrixWorld);
  const lift = Math.max(Math.abs(x.y), y.y);
  return THREE.MathUtils.clamp((lift - 0.08) / 0.42, 0, 1);
}

/**
 * Tiny opposite-wrist 2×2: Eye, Mic / Record, Share. Clickable with the other laser.
 * Icon-only — leftover "Pass on" / "VR" labels stay off the pucks.
 */
export function buildStatusCluster(group, opts = {}) {
  const buttons = opts.buttons || [], statusHits=[];
  const popup=new THREE.Group();popup.name='xrCaptureOptions';popup.userData.xrUi=true;group.add(popup);
  let open=false,kind='capture',castFamily='none',recording=false,paused=false,clipReady=false;
  const add=(parent,id,label,icon,color,x,y,tile=.03)=>{
    const hit=addPuck(parent,{id,label,icon,color},x,y,buttons,{tile,texSize:128,duplicate:false});
    hit.userData.xrStatus=true;statusHits.push(hit);return hit;
  };
  addPlate(group,.13,.047,0,0,'xrStatusBand',{logo:false});
  const folder=add(group,'capture','Capture','folder',0x334e68,-.04,0,.035);
  add(group,'undo','Undo','undo',0x64748b,.006,0,.026);
  add(group,'redo','Redo','redo',0x64748b,.041,0,.026);
  const defs=[
    ['passthrough','Pass','eye',0x0891b2],['voice_toggle','Mic','mic',0x64748b],['share','Share','share',0x0284c7],
    ['screenshot','Shot','cam',0x0284c7],['record','Record','rec',0xb91c1c],['stream','Stream','stream',0x7c3aed],
    ['record_pause','Pause','pause',0xb45309],['record_stop','Stop','stop',0xb91c1c],
    ['shot_send_pc','Send PC','export',0x15803d],['shot_share_x','Share X','share',0x0284c7],
    ['stream_x_live','X Live','stream',0x0284c7],['stream_twitch','Twitch','stream',0x7c3aed],['stream_kick','Kick','stream',0x15803d],
    ['stream_browser','Browser','export',0x0284c7],['stream_send_pc','Send PC','export',0x15803d],
    ['stream_live','Stream','stream',0x7c3aed],['stream_cast_meta','Cast Meta','stream',0x2563eb],['stream_cast_apple','AirPlay','stream',0x64748b],
    ['capture_back','Back','undo',0x64748b],['capture','Close','x',0x475569],
  ];
  const hits=defs.map(d=>add(popup,...d,0,0,.034));
  const plate=addPlate(popup,.145,.18,0,0,'xrCaptureOptionsPlate',{logo:false});
  popup.position.set(-.14,.05,.012);
  const timerCanvas=document.createElement('canvas');timerCanvas.width=256;timerCanvas.height=64;
  const timerTexture=new THREE.CanvasTexture(timerCanvas);timerTexture.colorSpace=THREE.SRGBColorSpace;
  const timerMesh=new THREE.Mesh(new THREE.PlaneGeometry(.065,.016),new THREE.MeshBasicMaterial({map:timerTexture,transparent:true,depthTest:false,depthWrite:false,toneMapped:false,side:THREE.DoubleSide}));
  timerMesh.position.set(-.033,-.033,.012);timerMesh.renderOrder=10160;timerMesh.visible=false;hideRaycast(timerMesh);group.add(timerMesh);
  let timerLabel='',signature='';
  function refresh(){
    popup.visible=open;
    const modeIds=crescentCaptureToolIds({open:true,recording,clipReady,kind,castFamily});
    const ids=['passthrough','voice_toggle','share',...modeIds,...(kind==='capture'?[]:['capture_back']),'capture'];
    const sig=ids.join('|');if(sig===signature)return;signature=sig;
    let n=0;
    for(const hit of hits){
      const on=ids.includes(hit.userData.xrTool);hit.visible=on;
      if(on){hit.position.set((n%3-1)*.045,(Math.ceil(ids.length/3)-1)*.0225-Math.floor(n/3)*.045,.01);n++;}
    }
    plate.scale.y=(Math.ceil(ids.length/3)*.045+.02)/.18;
  }
  function setCrescentKind(next='capture',extra={}){kind=next;open=extra.open!==false;castFamily=extra.castFamily||castFamily;refresh();}
  function toggleCrescent(){open=!open;if(open)kind='capture';refresh();return open;}
  function tint(id,on,color){const hit=hits.find(h=>h.userData.xrTool===id);if(hit)hit.material.color.setHex(on?0xffffff:color);}
  return {buttons,statusHits,
    setReveal(){group.visible=true;refresh();},
    setMicLive(on){const hit=hits.find(h=>h.userData.xrTool==='voice_toggle');if(hit)hit.material.color.setHex(on?0x22c55e:0xef4444);},
    setPassThroughOn(on){tint('passthrough',on,0x64748b);},
    setCrescentKind,toggleCrescent,
    setRecordingState(state={}){
      const changed=recording!==!!state.recording || paused!==!!state.paused;
      recording=!!state.recording;paused=!!state.paused;clipReady=!!state.clipReady;
      timerMesh.visible=recording;
      const text=formatXrRecordingClock(Number(state.elapsedMs)||0,{paused});
      if(recording&&text!==timerLabel){timerLabel=text;const ctx=timerCanvas.getContext('2d');ctx.fillStyle='#491b22';ctx.fillRect(0,0,256,64);ctx.fillStyle='#ffe2e4';ctx.font='bold 36px Arial';ctx.textAlign='center';ctx.fillText(text,128,46);timerTexture.needsUpdate=true;}
      if(changed){folder.material.color.setHex(recording?0xf87171:0xffffff);
        const hit=hits.find(h=>h.userData.xrTool==='record_pause');
        if(hit.userData.dynamicMap)hit.userData.dynamicMap.dispose();
        hit.material.map=makeColoredPuckTexture({label:paused?'Resume':'Pause',icon:paused?'rec':'pause',color:0xb45309,size:128});
        hit.userData.dynamicMap=hit.material.map;hit.userData.idleMap=hit.material.map;hit.userData.activeMap=hit.material.map;
        hit.userData.xrLabel=paused?'Resume':'Pause';}
      refresh();
    },
    isOpen:()=>open,
  };
}

/**
 * @param {THREE.Group} group
 * @param {{ id: string, label: string, color?: number, icon: string }[]} tools
 * @param {{ dockHand?: string, statusGroup?: THREE.Group }} [opts]
 */
export function buildHandPalette(group, tools, opts = {}) {
  const buttons = [];
  const list = Array.isArray(tools) && tools.length ? tools : [];
  const rows = Math.max(1, Math.ceil(list.length / COLS));
  const layout = wristPlateLayout({
    cols: COLS,
    rows,
    tile: TILE,
    gapX: GAP_X,
    gapY: GAP_Y,
    pad: WRIST_PLATE_PAD_M,
    hoverScale: WRIST_PLATE_HOVER_SCALE,
  });
  const originX = layout.originX;
  const originY = layout.originY;
  const gridH = layout.spanY + TILE;
  let dockHand = normalizeDockHand(opts.dockHand);

  const plate = addPlate(group, layout.plateW, layout.plateH, layout.plateX, layout.plateY, "xrWristBand", { logo: true });

  list.forEach((tool, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x = originX + col * GAP_X;
    const y = originY - row * GAP_Y;
    addPuck(group, tool, x, y, buttons);
  });

  const status = opts.statusGroup
    ? buildStatusCluster(opts.statusGroup, { buttons })
    : buildStatusCluster(group, { buttons });

  const handY = originY - rows * GAP_Y;
  const handHit = new THREE.Mesh(
    new THREE.SphereGeometry(HIT, 12, 10),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.02,
      depthWrite: false,
    }),
  );
  handHit.position.set(0, handY, 0.008);
  handHit.userData.xrTool = "dock_hand";
  handHit.userData.xrLabel = dockHandLabel(dockHand);
  handHit.renderOrder = 10090;
  handHit.frustumCulled = false;
  group.add(handHit);
  const handIdleMap = makeHandButtonTexture(dockHand, false);
  const handActiveMap = makeHandButtonTexture(dockHand, true);
  const handPuck = new THREE.Mesh(
    new THREE.CircleGeometry(TILE / 2, 28),
    new THREE.MeshBasicMaterial({
      map: handIdleMap,
      side: THREE.DoubleSide,
      toneMapped: false,
      depthWrite: false,
    }),
  );
  handPuck.position.copy(handHit.position);
  handPuck.position.z += 0.002;
  handPuck.renderOrder = 10092;
  handPuck.frustumCulled = false;
  hideRaycast(handPuck);
  group.add(handPuck);
  handHit.userData.puck = handPuck;
  handHit.userData.idleMap = handIdleMap;
  handHit.userData.activeMap = handActiveMap;
  handHit.visible = false;
  handPuck.visible = false;

  function setReveal(_t) {
    plate.visible = true;
    handHit.visible = false;
    handPuck.visible = false;
    buttons.forEach((btn) => {
      if (btn.userData.xrCrescent) return;
      if (btn.userData.xrStatus && opts.statusGroup) return;
      btn.visible = true;
      if (btn.userData.puck && btn.userData.puck !== btn) btn.userData.puck.visible = true;
    });
    try { status.setReveal?.(1); } catch (_) {}
  }

  function paintPuck(btn, { hover = false, on = false } = {}) {
    const map = on ? btn.userData.activeMap : btn.userData.idleMap;
    if (map) {
      if (btn.userData.puck?.material) {
        btn.userData.puck.material.map = map;
        btn.userData.puck.material.needsUpdate = true;
      }
      if (btn.material && btn.userData.puck === btn) {
        btn.material.map = map;
        btn.material.needsUpdate = true;
      }
    }
    const s = hover ? 1.18 : on ? 1.1 : 1;
    btn.scale.setScalar(s);
    if (btn.userData.puck && btn.userData.puck !== btn) btn.userData.puck.scale.setScalar(s);
  }

  function setActive(id) {
    buttons.forEach((btn) => {
      const tool = btn.userData.xrTool;
      if (tool === "voice_toggle" || tool === "passthrough" || tool === "capture" || btn.userData.xrCrescent) return;
      btn.userData._activeOn = tool === id;
      paintPuck(btn, { on: tool === id, hover: false });
    });
  }

  function setHovered(id) {
    const hoverId = String(id || "");
    buttons.forEach((btn) => {
      const tool = btn.userData.xrTool;
      if (!tool) return;
      paintPuck(btn, {
        hover: hoverId !== "" && tool === hoverId,
        on: !!btn.userData._activeOn && tool !== hoverId,
      });
    });
  }

  function setDockHand(hand) {
    dockHand = normalizeDockHand(hand);
    handHit.userData.xrLabel = dockHandLabel(dockHand);
  }

  setReveal(1);

  return {
    buttons,
    sideButtons: [],
    plate,
    circle: null,
    band: plate,
    status,
    setReveal,
    setActive,
    setHovered,
    setPassThroughOn: (on) => status.setPassThroughOn?.(on),
    setMicLive: (on) => status.setMicLive?.(on),
    setDockHand,
    setRecordingState: (state) => status.setRecordingState?.(state),
    setCrescentKind: (kind, extra) => status.setCrescentKind?.(kind, extra),
    toggleCrescent: () => status.toggleCrescent?.(),
    puckR: TILE / 2,
    gap: GAP_Y,
    gridH,
  };
}

export const HAND_PALETTE = { TILE, HIT, COLS, GAP_X, GAP_Y, STATUS_TILE, STATUS_GAP };
