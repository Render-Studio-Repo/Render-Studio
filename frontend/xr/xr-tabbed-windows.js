/** A shared VR viewport. Existing panels keep their own content and input handlers. */
import { xrHudCanvasBackingSize } from './xr-hot-path.js?v=xrperf3&uisharp=20260916-1&astra=20260916-5';

export const XR_TAB_DETACH_M = 0.07;
export const XR_TAB_STRIP_GAP_M = 0.014;
export const XR_TAB_STRIP_HEIGHT_M = 0.09;
export const XR_TAB_HIT_PAD_M = 0.02;
export const XR_TAB_HIT_DEPTH_M = 0.022;
export const XR_TAB_STRIP_LOGICAL = { w: 1536, h: 160 };
const _tabStripBacking = xrHudCanvasBackingSize(XR_TAB_STRIP_LOGICAL.w, XR_TAB_STRIP_LOGICAL.h);
export const XR_TAB_STRIP_CANVAS = { w: _tabStripBacking.width, h: _tabStripBacking.height };

const CONTROL_ACTIONS = new Set(['tab','close','undock','detach','dock','tidy','smaller','larger','next','previous']);

export function tabStripActionAt(cells, x, y) {
  const cell = (cells || []).find((c) => x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h);
  return cell?.action || 'move';
}

export function createXrTabbedWindows(THREE, { scene, place, face, onClose, onDetach } = {}) {
  const entries = new Map();
  const byGroup = new WeakMap();
  const pulls = new Map();
  const root = new THREE.Group();
  root.name = 'xrTabbedViewport';
  root.userData.xrUi = true;
  root.userData.xrHudParked = true;
  scene.add(root);
  const width = .60, height = .46, stripHeight = XR_TAB_STRIP_HEIGHT_M, pageSize = 4;
  let active = '', page = 0, placed = false, dirty = true, enabled = true, nextOrder = 0;
  const matrix = new THREE.Matrix4(), inverse = new THREE.Matrix4();
  const position = new THREE.Vector3(), quaternion = new THREE.Quaternion(), scale = new THREE.Vector3();
  const material = color => new THREE.MeshBasicMaterial({color, side:THREE.DoubleSide, depthTest:false, depthWrite:false, toneMapped:false});
  const back = new THREE.Mesh(new THREE.PlaneGeometry(width + .02, height + .01), material(0x14212f));
  back.position.z = -.012; back.renderOrder = 1900; back.visible = false; back.raycast = () => {};
  back.userData.xrDockBack = true;
  root.add(back);
  function makeStrip(parent) {
    const canvas = document.createElement('canvas');
    canvas.width = XR_TAB_STRIP_CANVAS.w;
    canvas.height = XR_TAB_STRIP_CANVAS.h;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.generateMipmaps = false;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = 4;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, stripHeight), material(0xffffff));
    mesh.material.map = texture; mesh.renderOrder = 51000; mesh.userData.xrUi = true;
    mesh.position.set(0, height / 2 + stripHeight / 2 + XR_TAB_STRIP_GAP_M, .012);
    parent.add(mesh);
    const gutter = new THREE.Mesh(
      new THREE.PlaneGeometry(width + .008, Math.max(.006, XR_TAB_STRIP_GAP_M * .55)),
      material(0x070d14),
    );
    gutter.position.set(0, height / 2 + XR_TAB_STRIP_GAP_M * .42, .006);
    gutter.renderOrder = 5000;
    gutter.userData.xrUi = true;
    parent.add(gutter);
    const hitMat = material(0x000000);
    hitMat.transparent = true;
    hitMat.opacity = 0;
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(width + XR_TAB_HIT_PAD_M * 2, stripHeight + XR_TAB_HIT_PAD_M * 2, XR_TAB_HIT_DEPTH_M),
      hitMat,
    );
    hit.position.copy(mesh.position);
    hit.renderOrder = 50990;
    hit.userData.xrUi = true;
    hit.userData.xrTabHitPad = true;
    parent.add(hit);
    return {canvas, texture, mesh, gutter, hit, cells:[]};
  }
  const strip = makeStrip(root);
  const docked = () => [...entries.values()].filter(row => row.open && !row.detached).sort((a,b)=>a.order-b.order);
  function activate(id) {
    const row = entries.get(id); if (!row) return;
    if (!row.open || !row.order) row.order = ++nextOrder;
    row.open = true;
    if (!row.detached) {
      active = id;
      page = Math.floor(docked().findIndex(item => item.id === id) / pageSize);
      row.bounds = null;
      // Parked / user-placed windows stay. Re-aligning on tab click shoved them to default Z.
      if (!row.group.userData?.xrHudParked && !row.group.userData?.xrUserRotated) row.aligned = false;
    }
    dirty = true;
  }
  function close(id) {
    const row = entries.get(id); if (!row) return;
    row.open = false;
    if (active === id) active = docked().at(-1)?.id || '';
    dirty = true;
  }
  function staysDocked(id, group) {
    return id === 'robotics' || group?.userData?.xrStayDocked === true;
  }
  function placeBesideDock(group, slot) {
    if (!group) return;
    root.updateWorldMatrix(true, false);
    const n = Math.max(1, Number(slot) || 1);
    const side = n % 2 ? 1 : -1;
    const step = Math.ceil(n / 2);
    const offset = new THREE.Vector3(side * (width + .08) * step, 0, .04);
    offset.applyQuaternion(root.quaternion);
    offset.multiplyScalar(Math.abs(Number(root.scale?.x) || 1) || 1);
    group.position.copy(root.position).add(offset);
    group.scale.set(1, 1, 1);
    faceGroup(group);
  }
  function register({kind:id, group, label}) {
    if (!group || byGroup.has(group)) return;
    const old = entries.get(id);
    if (old) forget(old.group);
    const stay = staysDocked(id, group);
    if (stay) {
      group.userData.xrHudParked = false;
      group.userData.xrUserRotated = false;
    }
    const row = {id, group, label:label || id, open:!!group.visible, detached:stay ? false : !!(group.userData?.xrHudParked || group.userData?.xrUserRotated), bounds:null, needsBeside:false};
    entries.set(id, row); byGroup.set(group, row); group.userData.xrTabbed = true; group.userData.xrManagedWindow = true;
    Object.defineProperty(group, 'visible', {
      configurable:true, enumerable:true,
      get:() => enabled && row.open && (row.detached || active === id),
      set:value => {
        if (value) {
          if (!row.open || (!row.detached && active !== id)) activate(id);
        } else if (row.open) close(id);
      },
    });
    if(row.detached) {
      group.userData.xrTabbed=false;
      row.dockedParent=group.parent;
      scene.attach(group);
      ensureDetachedChrome(row);
      row.needsBeside = true;
    }
    if (row.open) activate(id);
  }
  function ensureDetachedChrome(row) {
    if(row.strip)return;
    row.shell=new THREE.Group();row.shell.name=`xrDetachedTab:${row.id}`;
    scene.add(row.shell);row.strip=makeStrip(row.shell);paint(row.strip,[row],true);
  }
  function bounds(row) {
    if (row.bounds) return row.bounds;
    const cached = row.group.userData?.xrWindowSize;
    const plane = row.group.userData?.xrHudPlane
      || row.group.children?.find?.(c => c?.isMesh && c.geometry?.parameters?.width);
    const p = plane?.geometry?.parameters;
    const w = Number(cached?.x || p?.width) || 0.68;
    const h = Number(cached?.y || p?.height) || 0.48;
    row.bounds = {
      center: new THREE.Vector3(0, 0, 0),
      factor: Math.min(1, width / Math.max(w, .1), height / Math.max(h, .1)),
    };
    return row.bounds;
  }
  function align(row) {
    if (!row || row.detached) return;
    const {center, factor} = bounds(row);
    root.updateWorldMatrix(true, false);
    row.group.updateWorldMatrix(true,false);
    if (row.aligned && row.lastRoot?.equals(root.matrixWorld) && row.lastWorld?.equals(row.group.matrixWorld)) return;
    matrix.makeScale(factor, factor, factor).setPosition(-center.x*factor,-center.y*factor,-center.z*factor);
    matrix.premultiply(root.matrixWorld);
    if (row.group.parent) { row.group.parent.updateWorldMatrix(true,false); inverse.copy(row.group.parent.matrixWorld).invert(); matrix.premultiply(inverse); }
    matrix.decompose(row.group.position,row.group.quaternion,row.group.scale);
    row.group.updateWorldMatrix(false,true);
    row.aligned = true;
    (row.lastRoot ||= new THREE.Matrix4()).copy(root.matrixWorld);
    (row.lastWorld ||= new THREE.Matrix4()).copy(row.group.matrixWorld);
  }
  function labelText(ctx, text, x, y, maxW) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#020617';
    ctx.fillStyle = '#f8fafc';
    ctx.strokeText(text, x, y, maxW);
    ctx.fillText(text, x, y, maxW);
    ctx.restore();
  }
  function paint(target, rows, detached = false) {
    const ctx = target.canvas.getContext('2d');
    ctx.setTransform(XR_TAB_STRIP_CANVAS.w / XR_TAB_STRIP_LOGICAL.w, 0, 0, XR_TAB_STRIP_CANVAS.h / XR_TAB_STRIP_LOGICAL.h, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.fillStyle = '#0b1520'; ctx.fillRect(0,0,1536,160);
    ctx.fillStyle = '#070d14'; ctx.fillRect(0,150,1536,10);
    target.cells = [];
    ctx.font = '700 26px Arial,sans-serif';
    labelText(ctx, '⠿  Hold anywhere on this bar to move', 24, 35, 800);
    const cell = (x,y,cw,ch,label,action,id,selected=false) => {
      ctx.fillStyle = selected ? '#29445c' : '#1c2937'; ctx.fillRect(x,y,cw-5,ch-4);
      ctx.strokeStyle = selected ? '#7dd3fc' : '#334155';
      ctx.lineWidth = 3;
      ctx.strokeRect(x+1,y,cw-7,ch-6);
      ctx.font = '700 30px Arial,sans-serif';
      labelText(ctx, label, x+18, y+ch*.64, Math.max(32, cw-40));
      target.cells.push({x,y,w:cw,h:ch,action,id});
    };
    const undock = (x,y,cw,ch,id) => {
      ctx.fillStyle = '#1c2937'; ctx.fillRect(x,y,cw-5,ch-4);
      ctx.strokeStyle = '#64748b'; ctx.lineWidth = 3; ctx.strokeRect(x+1,y,cw-7,ch-6);
      const cx = x + cw * .46, cy = y + ch * .5;
      ctx.strokeStyle = '#f8fafc'; ctx.lineWidth = 3.4; ctx.lineCap = 'round';
      ctx.strokeRect(cx-11, cy-2, 14, 14);
      ctx.beginPath();
      ctx.moveTo(cx-2, cy-4); ctx.lineTo(cx+12, cy-16);
      ctx.moveTo(cx+3, cy-16); ctx.lineTo(cx+12, cy-16); ctx.lineTo(cx+12, cy-7);
      ctx.stroke();
      target.cells.push({x,y,w:cw,h:ch,action:'undock',id});
    };
    cell(835,0,110,52,'−','smaller',rows[0]?.id);
    cell(945,0,110,52,'+','larger',rows[0]?.id);
    if (detached) {
      cell(1070,0,290,52,'Dock','dock',rows[0].id);
      cell(1380,0,146,52,'×','close',rows[0].id);
      cell(12,60,1512,96,rows[0].label,'tab',rows[0].id,true);
    } else {
      cell(1070,0,220,52,'Pop out','detach',active);
      cell(1300,0,226,52,'Tidy','tidy');
      page = Math.min(Math.max(0,page),Math.max(0,Math.ceil(rows.length/pageSize)-1));
      if (page > 0) cell(0,60,90,96,'‹','previous');
      rows.slice(page*pageSize,(page+1)*pageSize).forEach((row,i) => {
        const x=100+i*334;
        cell(x,60,210,96,row.label,'tab',row.id,row.id===active);
        undock(x+210,60,54,96,row.id);
        cell(x+264,60,60,96,'×','close',row.id,row.id===active);
      });
      if ((page+1)*pageSize < rows.length) cell(1446,60,90,96,'›','next');
    }
    target.texture.needsUpdate = true;
  }
  function faceGroup(group) {
    if (!group || !face) return;
    const rotated = !!group.userData.xrUserRotated;
    group.userData.xrUserRotated = false;
    face(group);
    group.userData.xrUserRotated = rotated;
  }
  function disposeStrip(target) {
    if (!target) return;
    target.texture?.dispose?.();
    target.mesh?.geometry?.dispose?.();
    target.mesh?.material?.dispose?.();
    target.gutter?.geometry?.dispose?.();
    target.gutter?.material?.dispose?.();
    target.hit?.geometry?.dispose?.();
    target.hit?.material?.dispose?.();
  }
  function detach(id, opts = {}) {
    const row = entries.get(id); if (!row || row.detached) return row;
    align(row); row.detached = true; row.group.userData.xrTabbed = false;
    row.group.userData.xrHudParked = true;
    row.dockedParent = row.group.parent;
    scene.attach(row.group);
    if (opts.pull) {
      row.group.position.add(opts.pull);
    } else {
      const side = [...entries.values()].filter(item => item.detached && item.open).length;
      placeBesideDock(row.group, side);
      row.needsBeside = false;
    }
    row.group.userData.xrUserRotated = true;
    row.shell = new THREE.Group(); row.shell.name = `xrDetachedTab:${id}`;
    scene.add(row.shell); row.strip = makeStrip(row.shell);
    paint(row.strip,[row],true);
    active = docked().at(-1)?.id || ''; dirty = true;
    onDetach?.(row, opts);
    return row;
  }
  function dock(id) {
    const row = entries.get(id); if (!row) return;
    row.detached = false; row.needsBeside = false; row.group.userData.xrTabbed = true;
    row.group.userData.xrHudParked = false; row.group.userData.xrUserRotated = false;
    if (row.dockedParent) row.dockedParent.attach(row.group);
    row.dockedParent = null;
    if (row.shell) { row.shell.removeFromParent(); disposeStrip(row.strip); }
    row.shell = row.strip = null; activate(id);
  }
  function forget(group) {
    const row = byGroup.get(group); if (!row) return;
    if (row.detached) dock(row.id);
    const open = row.open;
    close(row.id); entries.delete(row.id); byGroup.delete(group);
    Object.defineProperty(group,'visible',{configurable:true,enumerable:true,writable:true,value:open});
    delete group.userData.xrTabbed; delete group.userData.xrManagedWindow;
  }
  function armPull(id, controller, point) {
    if (!controller || !id) return;
    const start = new THREE.Vector3();
    if (typeof controller.getWorldPosition === 'function') controller.getWorldPosition(start);
    else if (point) start.copy(point);
    else if (controller.position) start.copy(controller.position);
    pulls.set(controller, { id, start: start.clone(), detached: false });
  }
  function tickPulls() {
    for (const [controller, pull] of pulls) {
      if (pull.detached || !controller) continue;
      if (typeof controller.getWorldPosition === 'function') controller.getWorldPosition(position);
      else if (controller.position) position.copy(controller.position);
      else continue;
      if (position.distanceTo(pull.start) < XR_TAB_DETACH_M) continue;
      const delta = position.clone().sub(pull.start);
      detach(pull.id, { controller, pull: delta });
      pull.detached = true;
    }
  }
  function select(hit, controller) {
    if (hit?.kind !== 'viewport-tab') return false;
    if (hit.action === 'close') { close(hit.id); onClose?.(hit.id); }
    else if (hit.action === 'dock') dock(hit.id);
    else if (hit.action === 'detach' || hit.action === 'undock') detach(hit.id);
    else if (hit.action === 'tidy') {
      const selected=active;
      for (const row of entries.values()) if (row.detached && row.open) dock(row.id);
      if(selected)activate(selected);
      root.scale.setScalar(1); root.userData.xrUserRotated=false; place(root); dirty=true;
    }
    else if (hit.action === 'smaller' || hit.action === 'larger') {
      const group=hit.group || root;
      const row=byGroup.get(group), base=row ? bounds(row).factor : 1;
      group.scale.multiplyScalar(hit.action === 'smaller' ? .9 : 1.1);
      group.scale.clampScalar(base*.55,base*1.4);
    }
    else if (hit.action === 'next' || hit.action === 'previous') { page += hit.action === 'next' ? 1 : -1; dirty = true; }
    else if (hit.action === 'tab') {
      activate(hit.id);
      armPull(hit.id, controller, hit.point);
    }
    return true;
  }
  function release(controller) {
    if (controller) pulls.delete(controller);
  }
  function update(rows, presenting=true) {
    enabled = presenting;
    for (const row of entries.values()) if (!row.group.parent) forget(row.group);
    rows.forEach(register);
    if (!presenting) { root.visible=false; for (const row of entries.values()) if(row.shell)row.shell.visible=false; placed=false; pulls.clear(); return; }
    const tabs = docked();
    root.visible = tabs.length > 0;
    if (!root.visible) placed = false;
    if (!placed) { place(root); placed = true; }
    if (!root.visible) placed = false;
    let beside = 0;
    for (const row of entries.values()) {
      if (!row.detached || !row.open || !row.needsBeside) continue;
      beside += 1;
      placeBesideDock(row.group, beside);
      row.needsBeside = false;
    }
    tickPulls();
    if (dirty) { paint(strip,tabs); dirty = false; }
    const current = entries.get(active);
    if (current?.open && !current.detached) align(current);
    for (const row of entries.values()) if (row.shell) {
      row.shell.visible = row.open;
      if (!row.open) continue;
      row.group.getWorldPosition(position); row.group.getWorldQuaternion(quaternion); row.group.getWorldScale(scale);
      const {center, factor} = bounds(row);
      row.shell.position.copy(center).multiply(scale).applyQuaternion(quaternion).add(position);
      row.shell.quaternion.copy(quaternion); row.shell.scale.setScalar(scale.x/factor);
      row.shell.updateWorldMatrix(false,true);
    }
  }
  function pick(raycaster) {
    const targets = root.visible ? [{strip,group:root}] : [];
    for(const row of entries.values()) if(row.open && row.detached) targets.push({strip:row.strip,group:row.group});
    let best = null;
    for(const {strip:target,group} of targets) {
      if(!target?.mesh)continue;
      target.mesh.updateWorldMatrix(true,false);
      target.hit?.updateWorldMatrix?.(true,false);
      target.gutter?.updateWorldMatrix?.(true,false);
      const face = raycaster.intersectObject(target.mesh,false)[0];
      const pad = target.hit ? raycaster.intersectObject(target.hit,false)[0] : null;
      const gutter = target.gutter ? raycaster.intersectObject(target.gutter,false)[0] : null;
      const hit = [face, pad, gutter].filter(Boolean).sort((a,b)=>a.distance-b.distance)[0];
      if(!hit || (best && best.distance<hit.distance))continue;
      let action = 'move', id;
      if (face?.uv) {
        const x=face.uv.x*XR_TAB_STRIP_LOGICAL.w, y=(1-face.uv.y)*XR_TAB_STRIP_LOGICAL.h;
        const cell=target.cells.find(c=>x>=c.x && x<c.x+c.w && y>=c.y && y<c.y+c.h);
        action = tabStripActionAt(target.cells, x, y);
        if (CONTROL_ACTIONS.has(cell?.action)) id = cell.id;
      }
      best={kind:'viewport-tab',action,id,point:hit.point,distance:hit.distance,group};
    }
    return best;
  }
  return {root,update,pick,select,release,activate,close,detach,dock,forget,
    hasOpenWindows:()=>enabled && [...entries.values()].some(row=>row.open),
    windowFor:group => {const row=byGroup.get(group);return row?.open&&!row.detached?root:group;},
    isDocked:group=>!!byGroup.get(group)&&!byGroup.get(group).detached,
    isOpen:group=>byGroup.get(group)?.open ?? !!group?.visible,
    state:()=>({active,tabs:docked().map(row=>row.id),detached:[...entries.values()].filter(row=>row.open&&row.detached).map(row=>row.id)}),
    cells:()=>strip.cells,
  };
}
