import { createWiringGuide } from './wiring-guide.js?v=20260916-harness1-harness2-harness3';
/** Isolated wiring viewport: does not move the Design camera or require a CAD part. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const field = (title, value) => `<div><dt>${escape(title)}</dt><dd>${escape(value == null || value === '' ? 'Not specified' : typeof value === 'object' ? JSON.stringify(value) : value)}</dd></div>`;
export function wiringDetailMarkup(detail) {
  if (!detail) return '<div class="wiring-spatial-inspector-empty">Point to a wire to inspect its pins and specifications. Click to keep the details open.</div>';
  const endpoint = item => `${item?.component || 'Missing component'} · ${item?.pin || 'Unknown pin'}`;
  const geometry = Object.entries(detail.geometry || {}).filter(([key]) => key !== 'routeLengthMm').map(([key, value]) => `${key}: ${value}`).join(' · ');
  return `<div class="wiring-spatial-inspector-title"><span>${escape(detail.kind === 'wire' ? 'WIRE' : 'COMPONENT')}</span><strong>${escape(detail.label)}</strong></div>
    ${detail.kind === 'wire' ? `<div class="wiring-spatial-endpoints"><span>${escape(endpoint(detail.from))}</span><span aria-hidden="true">↓</span><span>${escape(endpoint(detail.to))}</span></div><dl>${field('Gauge', detail.gauge)}${field('Wire / insulation', detail.wireType)}${field('Source connector', detail.from?.connector || detail.connectors?.from)}${field('Destination connector', detail.to?.connector || detail.connectors?.to)}${field('Displayed route', detail.routeLengthMm != null ? `${detail.routeLengthMm.toFixed(1)} mm${detail.geometry?.route === 'approximate' ? ' · illustrative' : ''}` : null)}${field('Cut length', detail.cutLengthMm != null ? `${detail.cutLengthMm} mm` : null)}</dl>` : `<dl>${field('Type', detail.type)}${field('CAD file', detail.sourceFile)}</dl>`}
    <div class="wiring-spatial-evidence"><strong>${escape(typeof detail.verification === 'object' ? detail.verification.status || 'Unverified' : detail.verification)}</strong><p>${escape(geometry)}</p></div>
    <div class="wiring-spatial-docs"><strong>Sources &amp; schematics</strong>${detail.sources?.length ? detail.sources.map(source => `<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.title)}${source.page ? ` · p. ${escape(source.page)}` : ''} ↗</a>`).join('') : '<span>No documentation linked to this item.</span>'}</div>`;
}
export function createWiringSpatialWorkspace({ root, spatial, getSchematic, onAr, onStatus, onModeChange, onConnect, onMove, getProjectId, onPlacePin, onRoute, onImportModels, onReloadModels } = {}) {
  if (!root || !spatial) return null;
  if (!document.querySelector('link[data-wiring-spatial-style]')) {
    const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = new URL('./wiring-spatial-workspace.css?v=20260916-wiring-repair-2-harness2-harness3', import.meta.url).href; style.dataset.wiringSpatialStyle = ''; document.head.append(style);
  }
  const view = document.createElement('section'); view.className = 'wiring-spatial-view'; view.hidden = true;
  view.setAttribute('aria-label', 'Interactive 3D wiring'); view.tabIndex = 0;
  view.innerHTML = `<div class="wiring-spatial-stage"></div><div class="wiring-spatial-heading"><strong>3D wiring</strong><span>Orbit · zoom · inspect connections</span><button type="button" data-wiring-wire aria-pressed="false">Connect pins</button><button type="button" data-wiring-move aria-pressed="false">Move parts</button><button type="button" data-wiring-pin aria-pressed="false">Place terminal</button><button type="button" data-wiring-route aria-pressed="false">Route wire</button><label class="wiring-route-option" hidden>Height mm <input data-route-height type="number" value="15" step="1"></label><label class="wiring-route-option" hidden>Bend radius mm <input data-route-radius type="number" value="5" min="0" step="1"></label><button type="button" data-route-finish hidden>Save route</button><button type="button" data-wiring-cad>Load manufacturer CAD</button><button type="button" data-wiring-top>Top</button><button type="button" data-wiring-fit title="Fit wiring in view">Fit view</button></div><div class="wiring-spatial-hint" role="status">Select a part or wire to inspect · illustrative layout</div><aside hidden class="wiring-spatial-inspector" aria-label="Wiring details"><button type="button" class="wiring-spatial-clear" title="Clear selected wire" hidden>×</button><div class="wiring-spatial-details"></div></aside><div class="wiring-spatial-empty" hidden>No circuit yet. Return to Schematic to add parts or generate wiring.</div>`;
  root.append(view);
  const tooltip=document.createElement("div");tooltip.className="wiring-wire-tooltip";tooltip.hidden=true;tooltip.setAttribute("role","tooltip");view.append(tooltip);
  const stage = view.querySelector('.wiring-spatial-stage'), inspector = view.querySelector('.wiring-spatial-details');
  let tool = 'orbit', wireStart = null, moving = null, pinTarget = null, routeTarget = null, routePoints = [];
  let routePreview = null;
  const plane = new THREE.Plane(new THREE.Vector3(0,1,0), 0);
  const hint = view.querySelector('.wiring-spatial-hint');
  let renderer, controls, camera, scene, clone, active = false, hoverId = '', down = null, frame = 0, grid, previousWidth = 0;
  const labels = new Map();
  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const guide = createWiringGuide({getProjectId, getContext:spatial.getContext, selectWire:id=>spatial.setFocusWire(id)});
  const ownApi = {
    guide,
    getSelection: spatial.getSelection, getContext: () => ({guide:guide.state(), ...spatial.getContext()}), getGroup: spatial.getGroup,
    pickRay: spatial.pickRay, detailForObject: spatial.detailForObject,
    setSelection(value) { const result = spatial.setSelection(value); paintDetails(result); repaintFocus(); return result; },
    requestedMode: null,
    get projectId() { return getProjectId?.(); },
    setActive: value => setActive(value),
    isActive: () => active,
    sync() { spatial.syncFromSchematic(getSchematic?.() || {}); if (active) refresh(); },
  };
  window.Render3DWiringContext = ownApi;
  const selectionListener = () => { paintDetails(spatial.getSelection()); repaintFocus(); };
  window.addEventListener('wiring-selection', selectionListener);
  window.addEventListener('render3d:wiring-open-source', event => {
    const detail = event.detail?.selection || spatial.getSelection();
    if (detail) ownApi.setSelection(detail);
    let dialog = document.querySelector('.wiring-spatial-source-dialog');
    if (!dialog) { dialog = document.createElement('dialog'); dialog.className = 'wiring-spatial-source-dialog'; document.body.append(dialog); }
    dialog.innerHTML = `<button type="button" class="wiring-spatial-source-close" aria-label="Close wiring sources">×</button><h2>Wiring sources</h2><p>Documents for the wire or component selected in AR.</p><div class="wiring-spatial-details">${wiringDetailMarkup(detail)}</div>`;
    dialog.querySelector('button').addEventListener('click', () => dialog.close());
    if (!dialog.open) dialog.showModal();
  });
  function paintDetails(detail) { view.querySelector('aside').hidden = !detail; inspector.innerHTML = wiringDetailMarkup(detail); view.querySelector('.wiring-spatial-clear').hidden = !spatial.getSelection(); }
  function repaintFocus() {
    const id = spatial.getFocusWireId();
    clone?.traverse(node => {
      if (!node.userData?.wiringWireId || !node.material) return;
      // Clones get their own materials to avoid mutating the shared XR view.
      const selected = String(node.userData.wiringWireId) === String(id);
      node.material.opacity = id && !selected ? .25 : 1; node.material.transparent = !!id;
      node.material.emissiveIntensity = selected ? .65 : .13;
    });
  }
  function init() {
    if (renderer) return;
    scene = new THREE.Scene(); scene.background = new THREE.Color('#101923');
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace; stage.append(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', '3D circuit. Drag to orbit, scroll to zoom; select wires with the mouse or the Next wire button.');
    camera = new THREE.PerspectiveCamera(42, 1, .001, 100000);
    controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true;
    scene.add(new THREE.HemisphereLight('#d9edff', '#253343', 2.6)); const light = new THREE.DirectionalLight('#ffffff', 2.6); light.position.set(120, 200, 160); scene.add(light);
    renderer.domElement.addEventListener('pointerdown', event => {
      down = { x: event.clientX, y: event.clientY }; const hit = pick(event);
      if (tool === 'move' && hit) {
        let node = hit.object; while (node.parent && node.parent !== clone) node = node.parent;
        if (node.userData.wiringComponentId) {
          plane.constant = -node.position.y;
          const origin = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
          if (origin) { moving = {node, origin:origin.clone(), start:node.position.clone()}; renderer.domElement.setPointerCapture(event.pointerId); }
        }
      }
    });
    renderer.domElement.addEventListener('pointermove', event => {
      const hit = pick(event);
      const hovered = hit ? spatial.detailForObject(hit.object) : null;
      tooltip.hidden = hovered?.kind !== 'wire' || !!moving;
      if (!tooltip.hidden) {
        tooltip.textContent = `${hovered.label} · ${hovered.from.component} [${hovered.from.pin}] → ${hovered.to.component} [${hovered.to.pin}]`;
        const rect=view.getBoundingClientRect();tooltip.style.left=`${Math.max(8,Math.min(event.clientX-rect.left+12,rect.width-280))}px`;tooltip.style.top=`${Math.max(8,Math.min(event.clientY-rect.top+14,rect.height-70))}px`;
      }
      if (moving) {
        const point = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
        if (point) moving.node.position.copy(moving.start).add(point.sub(moving.origin));
        return;
      }
      const detail = hit && spatial.detailForObject(hit.object); const key = detail ? `${detail.kind}:${detail.id}` : '';
      if (key !== hoverId) { hoverId = key; renderer.domElement.style.cursor = detail ? 'pointer' : 'grab'; if (!spatial.getSelection()) paintDetails(detail); }
    });
    renderer.domElement.addEventListener('pointerleave', () => { hoverId = ''; if (!spatial.getSelection()) paintDetails(null); });
    renderer.domElement.addEventListener('pointerleave', () => {tooltip.hidden=true;});
    renderer.domElement.addEventListener('pointercancel', () => { if (moving) moving.node.position.copy(moving.start); moving = null; down = null; });
    renderer.domElement.addEventListener('pointerup', event => {
      if (moving) {
        const {node, start} = moving; moving = null;
        if (node.position.distanceToSquared(start) > 1e-8) {
          const mm = spatial.getContext().mmPerUnit;
          onMove?.(node.userData.wiringComponentId, node.position.toArray().map(n => n*mm)); ownApi.sync();
        }
        down = null; return;
      }
      if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) { down = null; return; }
      down = null; const hit = pick(event); const detail = hit ? spatial.detailForObject(hit.object) : null;
      if (tool === 'pin') {
        if (detail?.kind === 'pin') { pinTarget=detail; hint.textContent=`Place ${detail.label}: click its terminal on the same component surface`; }
        else if(pinTarget && hit && detail?.kind === 'component' && detail.id === pinTarget.componentId) {
          let node=hit.object;while(node.parent && node.parent!==clone)node=node.parent;
          const local=node.worldToLocal(hit.point.clone());
          onPlacePin?.(pinTarget.componentId,pinTarget.pinId,local.toArray().map(n=>n*spatial.getContext().mmPerUnit));
          ownApi.sync();hint.textContent='Terminal position saved · user placed, confirm against the manufacturer pinout';pinTarget=null;
        } else hint.textContent='Select a terminal marker, then click the same component surface';
        return;
      }
      if(tool === 'route') {
        if(!routeTarget) {
          if(detail?.kind==='wire'){routeTarget=detail.id;ownApi.setSelection(detail);hint.textContent='Click routing waypoints; adjust height for each point. Save route when finished.';}
          return;
        }
        plane.constant=-Number(view.querySelector('[data-route-height]').value || 0)/spatial.getContext().mmPerUnit;
        const point=raycaster.ray.intersectPlane(plane,new THREE.Vector3());
        if(point) {routePoints.push(point.toArray().map(n=>n*spatial.getContext().mmPerUnit));paintRoutePreview();hint.textContent=`${routePoints.length} routing points · Save route to connect both terminals`;}
        return;
      }
      if (tool === 'wire' && detail?.kind === 'pin') {
        const endpoint = {componentId:detail.componentId, pinId:detail.pinId};
        if (!wireStart) { wireStart = endpoint; hint.textContent = `${detail.label} selected — choose the destination terminal`; }
        else {
          const added = onConnect?.(wireStart, endpoint); wireStart = null;
          hint.textContent = added ? 'Connection added · choose another terminal' : 'Connection already exists or terminals are invalid'; ownApi.sync();
        }
      }
      ownApi.setSelection(detail);
    });
  }

  function pick(event) {
    if (!clone || !camera) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(clone.children, true).find(hit => spatial.detailForObject(hit.object)) || null;
  }
  function resize() {
    if (!renderer || !active) return;
    const width = Math.max(1, stage.clientWidth), height = Math.max(1, stage.clientHeight);
    renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    const top=view.querySelector('.wiring-spatial-heading').offsetHeight+30;
    const aside=view.querySelector('aside');
    aside.style.top=width<650?'auto':`${top}px`;aside.style.bottom=width<650?'78px':'auto';
    aside.style.maxHeight=width<650?'40%':`calc(100% - ${top+65}px)`;
    if(previousWidth && Math.abs(previousWidth-width)>5)fit();previousWidth=width;
  }
  function fit() {
    if (!clone || !camera) return;
    const bounds = new THREE.Box3().setFromObject(clone); if (bounds.isEmpty()) return;
    const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
    const span = Math.max(size.x, size.y, size.z, 1); camera.near = Math.max(.00001, span / 10000); camera.far = span * 100;
    const direction = new THREE.Vector3(.18,1.35,1).normalize();
    camera.position.copy(center).add(direction); camera.lookAt(center);
    const inverse = camera.quaternion.clone().invert(); const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
    let distance = 0;
    for (const x of [bounds.min.x,bounds.max.x]) for (const y of [bounds.min.y,bounds.max.y]) for (const z of [bounds.min.z,bounds.max.z]) {
      const p = new THREE.Vector3(x,y,z).sub(center).applyQuaternion(inverse);
      distance = Math.max(distance, p.z + Math.max(Math.abs(p.x)/(tan*camera.aspect), Math.abs(p.y)/tan));
    }
    camera.position.copy(center).addScaledVector(direction,distance*1.28); controls.target.copy(center); controls.update(); camera.updateProjectionMatrix();
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
    grid = new THREE.GridHelper(span * 3, 60, '#243747', '#192b38'); grid.position.set(center.x, bounds.min.y - span * .035, center.z); grid.material.transparent = true; grid.material.opacity = .45; scene.add(grid);
  }
  function refresh({ fitView = false } = {}) {
    if (!renderer) return;
    if (clone) { scene.remove(clone); clone.traverse(node => { for (const mat of Array.isArray(node.material) ? node.material : [node.material]) mat?.dispose?.(); }); }
    clone = spatial.getGroup().clone(true); clone.position.set(0, 0, 0); clone.quaternion.identity(); clone.scale.set(1, 1, 1); clone.visible = true;
    clone.traverse(node => { if (node.material) node.material = Array.isArray(node.material) ? node.material.map(mat => mat.clone()) : node.material.clone(); });
    for (const item of labels.values()) item.element.remove(); labels.clear();
    for (const node of clone.children.filter(node => node.userData.wiringComponentId)) {
      const detail = spatial.detailForObject(node); const element = document.createElement('span');
      element.className = 'wiring-spatial-part-label'; element.textContent = detail.label;
      stage.append(element); const bounds = new THREE.Box3().setFromObject(node); const point = bounds.getCenter(new THREE.Vector3()); point.y = bounds.max.y + 4/spatial.getContext().mmPerUnit; point.sub(node.position); labels.set(detail.id, {element,node,point});
    }
    scene.add(clone); repaintFocus(); view.querySelector('.wiring-spatial-empty').hidden = clone.children.length > 0;
    paintDetails(spatial.getSelection()); resize(); if (fitView) fit();
  }
  function draw() {
    if (!active) return; frame = requestAnimationFrame(draw); controls?.update(); renderer?.render(scene, camera);
    for (const {element,node,point} of labels.values()) {
      const p = point.clone().add(node.position).project(camera);
      element.style.left = `${(p.x+1)*stage.clientWidth/2}px`; element.style.top = `${(1-p.y)*stage.clientHeight/2}px`;
      element.hidden = Math.abs(p.z)>1 || Math.abs(p.x)>1 || Math.abs(p.y)>1;
    }
  }
  function setActive(value) {
    active = !!value; view.hidden = !active; onModeChange?.(active);
    root.classList.toggle("wiring-spatial-active", active);
    document.getElementById("app")?.classList.toggle("wiring-inspect-3d", active);
    document.getElementById('wiring-viewport')?.classList.toggle('wiring-spatial-schematic-hidden', active);
    document.getElementById('btn-wiring-view-spatial')?.setAttribute('aria-pressed', String(active));
    document.getElementById('btn-wiring-view-spatial')?.classList.toggle('is-active', active);
    document.getElementById('btn-wiring-view-breadboard')?.classList.toggle('hidden', !active);
    document.getElementById('btn-wiring-spatial-next')?.classList.toggle('hidden', !active);
    spatial.setActive(active);
    cancelAnimationFrame(frame);
    if (active) {
      try { onReloadModels?.(); init(); spatial.syncFromSchematic(getSchematic?.() || {}); refresh({ fitView: true }); draw(); }
      catch (error) { active = false; view.hidden = true; root.classList.remove('wiring-spatial-active'); document.getElementById('app')?.classList.remove('wiring-inspect-3d'); onModeChange?.(false); spatial.setActive(false); document.getElementById('wiring-viewport')?.classList.remove('wiring-spatial-schematic-hidden'); onStatus?.('error', `Could not open 3D wiring: ${error.message}`); return false; }
    } else ownApi.requestedMode = null;
    return true;
  }
  const observer = new ResizeObserver(resize); observer.observe(stage);
  view.querySelector('[data-wiring-cad]').addEventListener('click',async event=>{
    event.currentTarget.disabled=true;hint.textContent='Importing sourced manufacturer STEP models…';
    try{const result=await onImportModels?.();hint.textContent=result?.failures?.length ? result.failures.map(f=>`${f.part}: ${f.error}`).join(' · ') : `${result?.models?.length||0} sourced CAD models · previews may take a minute; reopen 3D to reload. Add exact STEP URLs in Parts List if a model is missing.`;}
    catch(error){hint.textContent=error.message;}finally{view.querySelector('[data-wiring-cad]').disabled=false;}
  });
  view.querySelector('[data-wiring-fit]').addEventListener('click', fit);
  view.querySelector('[data-wiring-top]').addEventListener('click', () => {
    if (!camera) return; const distance = camera.position.distanceTo(controls.target);
    camera.position.copy(controls.target).add(new THREE.Vector3(0,distance,.001)); controls.update();
  });
  function paintRoutePreview() {
    if(routePreview){scene.remove(routePreview);routePreview.geometry.dispose();routePreview.material.dispose();routePreview=null;}
    if(routePoints.length){const points=routePoints.map(p=>new THREE.Vector3(...p).divideScalar(spatial.getContext().mmPerUnit));routePreview=new THREE.Points(new THREE.BufferGeometry().setFromPoints(points),new THREE.PointsMaterial({color:'#ffc96c',size:7,sizeAttenuation:false}));scene.add(routePreview);}
  }
  const setTool = next => {
    tool = tool === next ? 'orbit' : next; wireStart = null; pinTarget=null;routeTarget=null;routePoints=[];paintRoutePreview();
    if (controls) controls.enabled = tool === 'orbit';
    view.querySelector('[data-wiring-wire]').setAttribute('aria-pressed', String(tool === 'wire'));
    view.querySelector('[data-wiring-move]').setAttribute('aria-pressed', String(tool === 'move'));
    view.querySelector('[data-wiring-pin]').setAttribute('aria-pressed',String(tool==='pin'));
    view.querySelector('[data-wiring-route]').setAttribute('aria-pressed',String(tool==='route'));
    view.querySelectorAll('.wiring-route-option,[data-route-finish]').forEach(e=>e.hidden=tool!=='route');
    resize();
    hint.textContent = tool==='pin' ? 'Select a terminal marker, then click its CAD surface · Esc cancels' : tool==='route' ? 'Select a wire to route · Esc cancels' : tool === 'wire' ? 'Click a source terminal, then its destination · Esc cancels' : tool === 'move' ? 'Drag a part to move it · wires reconnect on release' : 'Select a part or wire to inspect · illustrative layout';
  };
  view.querySelector('[data-wiring-pin]').addEventListener('click',()=>setTool('pin'));
  view.querySelector('[data-wiring-route]').addEventListener('click',()=>setTool('route'));
  view.querySelector('[data-route-finish]').addEventListener('click',()=>{
    if(!routeTarget || !routePoints.length){hint.textContent='Choose a wire and add at least one waypoint first';return;}
    const radius=Number(view.querySelector('[data-route-radius]').value);
    if(onRoute?.(routeTarget,routePoints,radius)){ownApi.sync();setTool('route');hint.textContent='Route saved · inspect bend radius and packaging clearance in wire details';}
  });
  view.querySelector('[data-wiring-wire]').addEventListener('click', () => setTool('wire'));
  view.querySelector('[data-wiring-move]').addEventListener('click', () => setTool('move'));
  view.addEventListener('keydown', event => { if (event.key === 'Escape') {tool = ''; setTool('orbit'); ownApi.setSelection(null);} });
  view.querySelector('.wiring-spatial-clear').addEventListener('click', () => ownApi.setSelection(null));
  document.getElementById('btn-wiring-view-spatial')?.addEventListener('click', () => setActive(!active));
  document.getElementById('btn-wiring-view-breadboard')?.addEventListener('click', () => setActive(false));
  document.getElementById('btn-wiring-spatial-next')?.addEventListener('click', () => { spatial.focusNextWire(); });
  document.getElementById('btn-wiring-spatial-ar')?.addEventListener('click', () => {
    if (!active && !setActive(true)) return;
    if (!spatial.getGroup().children.length) { onStatus?.('error', 'Add circuit parts before opening wiring in AR.'); return; }
    ownApi.requestedMode = 'immersive-ar'; onAr?.();
  });
  paintDetails(null);
  return { setActive, isActive: () => active, refresh, sync: ownApi.sync, getContext: ownApi.getContext };
}
