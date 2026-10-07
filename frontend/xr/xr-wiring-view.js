/** Wiring-only XR assembly and native pin/evidence inspector. No electrical inference. */
import { createXrNearGrabPicker } from './xr-near-grab.js?v=20260915-wiring-agent1';
export function createXrWiringView(THREE, { scene, camera, getApi = () => globalThis.window?.Render3DWiringContext, onOpenSource } = {}) {
  const root = new THREE.Group(); root.name = 'XrWiringAssembly'; root.visible = false; root.userData.xrWiring = true;
  const panelRoot = new THREE.Group(); panelRoot.name = 'XrWiringInspector'; panelRoot.visible = false; panelRoot.userData.xrUi = true;
  scene?.add(root, panelRoot);
  let focusedId = null, selectedKey = '';
  let original = null, originalVisible = false, clone = null, version = null, mounted = false, hover = null, drag = null;
  const nearGrab = createXrNearGrabPicker(THREE);
  let panel, texture, canvas, context, docButtons = [], scaleFactor = 1, lastPaint = '', lastPaintScale = null;
  const worldPosition = new THREE.Vector3(), forward = new THREE.Vector3(), right = new THREE.Vector3();
  function releaseOwned(node) {
    node?.traverse(child => {
      child.geometry?.dispose?.();
      for (const material of Array.isArray(child.material) ? child.material : [child.material]) material?.dispose?.();
    });
  }
  function clearClone() { if (clone) { root.remove(clone); releaseOwned(clone); clone = null; } }
  function restoreOriginal() { if (original) original.visible = originalVisible && getApi?.()?.isActive?.() !== false; original = null; }
  function initPanel() {
    if (panel || typeof document === 'undefined') return;
    canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 950; context = canvas.getContext('2d');
    texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    panel = new THREE.Mesh(new THREE.PlaneGeometry(.34, .36), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, transparent: true, depthTest: false }));
    panel.renderOrder = 1250; panel.userData.xrUi = true; panel.userData.wiringInfoPanel = true; panelRoot.add(panel);
  }
  function textWrap(text, x, y, max = 820, line = 40, limit = 2) {
    if (!context) return y;
    const words = String(text ?? '').split(/\s+/); let row = '', rows = 0;
    for (const word of words) {
      const next = row ? `${row} ${word}` : word;
      if (row && context.measureText(next).width > max) { context.fillText(row, x, y); y += line; row = word; if (++rows >= limit) return y; }
      else row = next;
    }
    if (row && rows < limit) { context.fillText(row, x, y); y += line; }
    return y;
  }
  function paint(detail) {
    if (!context) return;
    if (detail === lastPaint && scaleFactor === lastPaintScale) return; lastPaint = detail; lastPaintScale = scaleFactor;
    context.clearRect(0, 0, 900, 950); context.fillStyle = '#142330'; context.fillRect(0, 0, 900, 950);
    context.strokeStyle = '#426277'; context.lineWidth = 4; context.strokeRect(2, 2, 896, 946);
    context.fillStyle = '#80c5e7'; context.font = '600 27px system-ui'; context.fillText('3D WIRING', 40, 55);
    context.fillStyle = '#f0f6fc'; context.font = '600 38px system-ui';
    let y = textWrap(detail?.label || 'Point to a wire', 40, 115, 820, 45, 2) + 20;
    context.font = '29px system-ui'; context.fillStyle = '#d0e0eb';
    if (detail?.kind === 'wire') {
      const endpoint = item => `${item?.component || 'Unknown'} · ${item?.pin || 'Unknown pin'}`;
      y = textWrap(`From: ${endpoint(detail.from)}`, 40, y, 820, 38, 2) + 12;
      y = textWrap(`To: ${endpoint(detail.to)}`, 40, y, 820, 38, 2) + 20;
      y = textWrap(`Gauge: ${detail.gauge || 'Not specified'}`, 40, y) + 8;
      y = textWrap(`Wire: ${typeof detail.wireType === 'object' ? JSON.stringify(detail.wireType) : detail.wireType || 'Not specified'}`, 40, y) + 8;
      const connector = value => typeof value === 'object' ? value.label || value.partNumber || JSON.stringify(value) : value;
      y = textWrap(`Connectors: ${connector(detail.from?.connector || detail.connectors?.from) || 'unknown'} → ${connector(detail.to?.connector || detail.connectors?.to) || 'unknown'}`, 40, y, 820, 38, 2) + 10;
    } else if (detail) y = textWrap(detail.sourceFile || detail.type || 'Component', 40, y) + 15;
    else y = textWrap('Select a cable or component to inspect its pins, specifications and linked documents.', 40, y, 800, 43, 4) + 20;
    context.fillStyle = '#d9bf87'; context.font = '25px system-ui';
    const geometry = detail?.geometry;
    const uncertain = geometry && Object.values(geometry).some(value => value === 'approximate' || value === 'missing');
    y = Math.min(y, 665);
    if (uncertain) textWrap('Approximate locations — verify physical pins before assembly.', 40, y, 800, 33, 2);
    else if (detail) textWrap(`Evidence: ${typeof detail.verification === 'object' ? detail.verification.status || 'unverified' : detail.verification || 'unverified'}`, 40, y, 800, 33, 2);
    const source = detail?.sources?.[0];
    docButtons.forEach(button => { panelRoot.remove(button); releaseOwned(button); }); docButtons = [];
    if (source) {
      context.fillStyle = '#254c65'; context.fillRect(35, 735, 830, 65); context.fillStyle = '#d2ecfb'; context.font = '28px system-ui';
      context.fillText(`Open sources on desktop (${detail.sources.length}) ↗`, 55, 778);
      const button = new THREE.Mesh(new THREE.PlaneGeometry(.314, .025), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
      button.position.set(0, .18 - (767.5 / 950) * .36, .002); button.userData.wiringSource = source; button.userData.xrUi = true; panelRoot.add(button); docButtons.push(button);
    }
    context.fillStyle = '#92abba'; context.font = '23px system-ui';
    const scaleText = Math.abs(scaleFactor - 1) < .001 ? 'Physical size · 1:1' : `Display scaled ${scaleFactor.toFixed(2)}× · not physical size`;
    context.fillText(scaleText, 40, 856);
    textWrap('Grip a component to move and rotate the whole circuit into alignment.', 40, 899, 820, 29, 2);
    texture.needsUpdate = true;
  }
  function refresh(source, api) {
    clearClone();
    if (original !== source) { restoreOriginal(); original = source; originalVisible = source.visible; }
    source.visible = false;
    clone = source.clone(true); clone.position.set(0, 0, 0); clone.quaternion.identity(); clone.scale.set(1, 1, 1); clone.visible = true;
    clone.traverse(node => {
      if (node.geometry) node.geometry = node.geometry.clone();
      if (node.material) node.material = Array.isArray(node.material) ? node.material.map(material => material.clone()) : node.material.clone();
      if (node.isSprite) node.raycast = () => {};
    });
    const mmPerUnit = Math.max(.000001, Number(api.getContext?.()?.mmPerUnit) || 1);
    clone.scale.setScalar(mmPerUnit / 1000); clone.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(clone), center = bounds.getCenter(new THREE.Vector3());
    // Assembly guidance always starts at supplied physical scale; never silently fit it.
    scaleFactor = 1;
    clone.scale.multiplyScalar(scaleFactor); clone.position.copy(center).multiplyScalar(-scaleFactor); root.add(clone);
    version = source.userData?.wiringVersion; focusedId = null; selectedKey = ''; hover = null; lastPaint = ''; paint(api.getSelection?.());
  }
  function place(headCamera) {
    const head = headCamera || camera; if (!head) return;
    head.getWorldPosition(worldPosition); head.getWorldDirection(forward); forward.y = 0;
    if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1); forward.normalize();
    right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    root.position.copy(worldPosition).addScaledVector(forward, .55); root.position.y -= .22;
    panelRoot.position.copy(root.position).addScaledVector(right, .35); panelRoot.position.y += .13;
    panelRoot.lookAt(worldPosition);
  }
  function update({ presenting = false, headCamera } = {}) {
    const api = getApi?.(), source = api?.getGroup?.();
    const enabled = presenting && ['immersive-ar','immersive-vr'].includes(api?.requestedMode) && source?.children?.length > 0;
    if (!enabled) {
      if (mounted) { restoreOriginal(); clearClone(); hover = null; lastPaint = ''; drag = null; }
      mounted = false; root.visible = false; panelRoot.visible = false; return;
    }
    initPanel();
    if (!mounted || source !== original || version !== source.userData?.wiringVersion) refresh(source, api);
    if (!mounted) { place(headCamera); panelRoot.visible = true; }
    mounted = true; root.visible = true;
    if (drag) {
      drag.host.updateWorldMatrix(true, false);
      root.matrix.copy(drag.host.matrixWorld).multiply(drag.offset);
      if (root.parent) { root.parent.updateWorldMatrix(true, false); root.matrix.premultiply(new THREE.Matrix4().copy(root.parent.matrixWorld).invert()); }
      root.matrix.decompose(root.position, root.quaternion, root.scale);
    }
    // Inspector follows placement while remaining upright and readable.
    const head = headCamera || camera;
    if (head && !panelRoot.userData.xrManagedWindow) {
      head.getWorldPosition(worldPosition);
      panelRoot.position.copy(root.position).addScaledVector(right, .35); panelRoot.position.y += .13;
      panelRoot.lookAt(worldPosition);
    }

    // Desktop refreshes can re-show the source, so maintain one visible XR copy.
    const selected = api.getSelection?.();
    const key = selected ? `${selected.kind}:${selected.id}` : '';
    if (key !== selectedKey) {selectedKey=key;hover=null;}
    const focus = selected?.kind === 'wire' ? selected.id : '';
    if (focus !== focusedId) {
      focusedId=focus;
      clone?.traverse(node=>{if(node.userData?.wiringWireId && node.material){const on=String(node.userData.wiringWireId)===String(focus);node.material.transparent=!!focus;node.material.opacity=focus&&!on? .22 : 1;if('emissiveIntensity' in node.material)node.material.emissiveIntensity=on? .65 : .13;}});
    }
    source.visible = false; paint(hover || selected);
    root.updateWorldMatrix(true, true); panelRoot.updateWorldMatrix(true, true);
  }
  function detailOf(object) {
    const api = getApi?.();
    const resolved = api?.detailForObject?.(object); if (resolved) return resolved;
    const context = api?.getContext?.();
    for (let node = object; node && node !== root; node = node.parent) {
      if (node.userData?.wiringWireId != null) return context?.wires?.find(item => String(item.id) === String(node.userData.wiringWireId)) || null;
      if (node.userData?.wiringComponentId != null) return context?.components?.find(item => String(item.id) === String(node.userData.wiringComponentId)) || null;
    }
    return null;
  }
  function pick(raycaster) {
    if (!mounted || !raycaster) return null;
    const hits = raycaster.intersectObjects([...root.children, ...docButtons], true);
    for (const hit of hits) {
      if (hit.object.userData?.wiringSource) return { kind: 'wiring', detail: hover || getApi?.()?.getSelection?.(), source: hit.object.userData.wiringSource, point: hit.point, distance: hit.distance };
      const detail = detailOf(hit.object);
      if (detail) { hover = detail; paint(detail); return { kind: 'wiring', detail, point: hit.point, distance: hit.distance }; }
    }
    return null;
  }
  function select(hit) {
    if (hit?.kind !== 'wiring') return false;
    if (hit.source) {
      if (onOpenSource) onOpenSource(hit.source, hit.detail);
      else globalThis.window?.dispatchEvent(new CustomEvent('render3d:wiring-open-source', { detail: { source: hit.source, selection: hit.detail } }));
      return true;
    }
    const detail = getApi?.()?.setSelection?.(hit.detail) || hit.detail; hover = detail; paint(detail);
    globalThis.window?.dispatchEvent(new CustomEvent('render3d:xr-selection', { detail: { ...detail, source: 'wiring', point: hit.point?.toArray?.() || null } }));
    return true;
  }
  function beginGrip(hand, host) {
    if (!mounted || !clone || drag || !host) return false;
    host.updateWorldMatrix(true, false); root.updateWorldMatrix(true, true);
    if (!nearGrab(host.getWorldPosition(new THREE.Vector3()), [clone])) return false;
    drag = { hand, host, offset: new THREE.Matrix4().copy(host.matrixWorld).invert().multiply(root.matrixWorld) };
    return true;
  }
  function endGrip(hand) {
    if (!drag || drag.hand !== hand) return false;
    drag = null; return true;
  }
  function dispose() {
    mounted = false; drag = null; restoreOriginal(); clearClone(); root.parent?.remove(root); panelRoot.parent?.remove(panelRoot);
    releaseOwned(panelRoot); texture?.dispose(); panel = null; texture = null; context = null; docButtons = [];
  }
  return { update, pick, select, beginGrip, endGrip, dispose, isActive: () => mounted, getGroup: () => root, getPanel: () => panelRoot };
}
