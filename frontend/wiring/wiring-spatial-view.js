import { harnessCurve } from './wiring-harness-route.js?v=20260916-harness1-harness2-harness3';
/** Shared physical wiring group; desktop and XR inspect the same IDs and evidence. */
import * as THREE from 'three';
import { componentMesh, wiringText } from './wiring-component-mesh.js?v=20260916-wiring-repair-2';
import { pinLayout } from './wiring-simulator.js?v=20260916-wiring-repair-2-harness2-harness3-gpu-recovery3-gpu-recovery4-gpu-recovery5-webglfb1&gpu=20260916-startup2&gpu=20260916-startup3';
import { physicalVector, physicalPin, wireDetails, documentationLinks } from './wiring-spatial-data.js?v=20260930-verified-wiring-1';
import { wiringAccuracyLabel } from './wiring-accuracy.js?v=20260930-verified-wiring-1';

const COLORS = { 'arduino-uno': '#00979d', 'raspberry-pi': '#b34561', 'motor-driver': '#b27040', motor: '#5c82b5', sensor: '#43877b' };
function stem(value) { return String(value || '').toLowerCase().replace(/\.[^.]+$/, '').replace(/_edited(?:_\d+)?$/, ''); }
function release(object) {
  object.traverse(node => {
    node.geometry?.dispose?.();
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (material?.map?.userData?.wiringOwned) material.map.dispose();
      material?.dispose?.();
    }
  });
}
export function createWiringSpatialView({ scene, getAssemblyRoot, getMmPerUnit = () => 1, getCadModel, onStatus, onSelection } = {}) {
  const group = new THREE.Group(); group.name = 'WiringSpatialOverlay';
  group.userData.wiringSpatial = true; group.userData.xrInclude = true; group.visible = false;
  let active = false; let schematic = {}; let selection = null; let focusWireId = null;
  const details = new Map(); const anchors = new Map(); const wireOrder = [];
  function clear({ keepFocus = false } = {}) {
    for (const child of [...group.children]) { group.remove(child); release(child); }
    details.clear(); anchors.clear(); wireOrder.length = 0;
    if (!keepFocus) { focusWireId = null; selection = null; schematic = {}; }
  }
  function attach() {
    const root = getAssemblyRoot?.() || scene;
    if (root && group.parent !== root) root.add(group);
    root?.updateWorldMatrix(true, true);
    return root === scene ? null : root;
  }
  function findCad(root, component) {
    if (!root) return null;
    const target = stem(component.sourceFile || component.part?.sourceFile); if (!target) return null;
    let found = null;
    root.traverse(node => {
      if (found || node === group || node.userData?.wiringSpatial || node.userData?.wiringComponentId) return;
      if ([node.name, node.userData?.catalogFilename, node.userData?.filename].some(value => stem(value) === target)) found = node;
    });
    return found;
  }
  function material(color) { return new THREE.MeshStandardMaterial({ color, metalness: .12, roughness: .68, emissive: color, emissiveIntensity: .06 }); }
  function styleFocus() {
    for (const node of group.children) {
      if (!node.userData.wiringWireId || !node.material) continue;
      const selected = String(node.userData.wiringWireId) === String(focusWireId);
      node.material.emissiveIntensity = selected ? .65 : .13;
      node.material.transparent = !!focusWireId; node.material.opacity = focusWireId && !selected ? .25 : 1;
    }
  }
  function syncFromSchematic(value = {}) {
    schematic = value; const oldSelection = selection;
    group.userData.wiringVersion = (group.userData.wiringVersion || 0) + 1;
    clear({ keepFocus: true }); if (!active) return;
    const root = attach(); const mm = Math.max(.000001, Number(getMmPerUnit?.()) || 1);
    const components = (value.components || []).filter(item => item?.id != null);
    const byId = new Map(components.map(item => [String(item.id), item])); const frames = new Map();
    const xs = components.map(item => (Number(item.x) || 0) + (Number(item.w) || 100)/2), ys = components.map(item => (Number(item.y) || 0) + (Number(item.h) || 70)/2);
    const cx = xs.length ? (Math.max(...xs) + Math.min(...xs)) / 2 : 0;
    const cy = ys.length ? (Math.max(...ys) + Math.min(...ys)) / 2 : 0;
    const layoutScale = .4;
    const worldToGroup = new THREE.Matrix4().copy(group.matrixWorld).invert();
    for (const component of components) {
      const cad = findCad(root, component) || getCadModel?.(component);
      const frame = new THREE.Matrix4(); let placement = 'approximate'; let dimensions = null;
      if (cad && !cad.userData.wiringDetachedCad && !component.position3d && !component.spatial?.position) { frame.multiplyMatrices(worldToGroup, cad.matrixWorld); placement = 'CAD linked'; }
      else {
        const position = physicalVector(component.position3d || component.spatial?.position, component.spatial?.units || component.units || 'mm', mm);
        const vector = position ? new THREE.Vector3(...position) : new THREE.Vector3(((Number(component.x) || 0) + (Number(component.w) || 100)/2 - cx) * layoutScale / mm, 0, ((Number(component.y) || 0) + (Number(component.h) || 70)/2 - cy) * layoutScale / mm);
        const quaternion = new THREE.Quaternion();
        if (Array.isArray(component.quaternion) && component.quaternion.length === 4 && component.quaternion.every(Number.isFinite)) quaternion.fromArray(component.quaternion).normalize();
        else if (Array.isArray(component.rotation3d) && component.rotation3d.length === 3 && component.rotation3d.every(Number.isFinite)) quaternion.setFromEuler(new THREE.Euler(...component.rotation3d));
        frame.compose(vector, quaternion, new THREE.Vector3(1, 1, 1)); placement = position ? 'provided' : 'approximate';
      }
      frames.set(String(component.id), { matrix: frame, placement });
      const dims = component.dimensions || component.profile?.dimensions || component.part?.dimensions;
      dimensions = physicalVector(dims?.size || dims, dims?.units || component.units || 'mm', mm);
      const fallbackSize = [(Number(component.w) || 100)*layoutScale, /stepper|power-supply/.test(component.type) ? 15 : 4, (Number(component.h) || 70)*layoutScale];
      const size = dimensions?.every(n => n > 0) ? dimensions : fallbackSize.map(n => n / mm);
      const node = new THREE.Group(); node.name = `wiring-component:${component.id}`; node.applyMatrix4(frame);
      // Reuse loaded CAD geometry without changing ownership, materials, or transforms.
      if (cad) {
        const clonePart = original => {
          if (original.userData?.wiringSpatial) return null;
          const result = original.clone(false);
          for (const child of original.children) { const item = clonePart(child); if (item) result.add(item); }
          return result;
        };
        const copy = clonePart(cad); copy.position.set(0, 0, 0); copy.quaternion.identity(); copy.scale.setScalar(cad.userData.wiringDetachedCad ? 1/mm : 1); copy.updateMatrix();
        copy.traverse(child => {
          if (child.userData?.wiringSpatial) { child.visible = false; return; }
          if (child.geometry) child.geometry = child.geometry.clone();
          if (child.material) child.material = Array.isArray(child.material) ? child.material.map(m => m.clone()) : child.material.clone();
          child.userData = { ...child.userData, wiringComponentId: String(component.id) };
        }); node.add(copy);
      } else node.add(componentMesh(component, size));
      node.userData.wiringComponentId = String(component.id);
      const layout = pinLayout(component);
      const physicalPins = component.pins || component.profile?.pins;
      const extra = Array.isArray(physicalPins) ? physicalPins.filter(pin => !layout.some(p => String(p.id) === String(pin.id))) : [];
      for (const pin of [...layout, ...extra]) {
        const physical = physicalPin(component, pin.id, mm);
        if (!physical.point && (!Number.isFinite(pin.x) || !Number.isFinite(pin.y))) continue;
        const local = new THREE.Vector3(...(physical.point || [(pin.x-.5)*size[0], size[1]/2 + .6/mm, (pin.y-.5)*size[2]]));
        const key = `${component.id}:${pin.id}`;
        const point = local.clone().applyMatrix4(frame);
        anchors.set(key, {point, status: physical.point && placement !== 'approximate' ? physical.status : 'approximate'});
        if (pin.alias) continue;
        const radius = (pin.hole ? .62 : .85)/mm;
        const marker = new THREE.Mesh(new THREE.CylinderGeometry(radius,radius,.65/mm,12), material(pin.rail === 'plus' ? '#dc645d' : pin.hole ? '#263a46' : '#e8c97c'));
        marker.position.copy(local); marker.userData.wiringPinKey = key; node.add(marker);
        details.set(`pin:${key}`, {kind:'pin', id:key, componentId:String(component.id), pinId:String(pin.id), label:`${component.label || component.type} · ${pin.label || pin.id}`, type:pin.title || 'Terminal', verification:physical.point ? physical.status : component.pin_verification?.status || 'diagram placement', geometry:{placement:physical.point ? physical.status : 'illustrative'}, sources:documentationLinks(component, component.profile)});
        if (!pin.hole && !pin.rail && pin.label) {
          const label = wiringText(pin.label, Math.min(size[0]*.22, 13/mm), {height:2.6/mm});
          label.position.copy(local); label.position.y += .5/mm;
          label.position.z += (pin.y < .5 ? 1 : -1) * 2.7/mm;
          node.add(label);
        }
      }
      group.add(node);
      const detail = { kind: 'component', id: String(component.id), label: component.label || component.type || String(component.id), type: component.type, manufacturer: component.manufacturer || component.part?.manufacturer || null, partNumber: component.partNumber || component.part?.partNumber || null, revision: component.revision || component.profile?.revision || null, specifications: component.profile || component.part || null, pins: component.pins || component.profile?.pins || null, sourceFile: component.sourceFile || null, geometry: { placement, dimensions: dimensions ? 'provided' : cad ? 'CAD linked' : 'approximate' }, verification: component.verification || 'unverified', sources: documentationLinks(component, component.part, component.profile) };
      details.set(`component:${component.id}`, detail);
    }
    const endpointPoint = endpoint => {
      const id = String(endpoint?.componentId); const component = byId.get(id); const frame = frames.get(id);
      if (!component || !frame) return null;
      return anchors.get(`${id}:${endpoint.pinId}`) || null;
    };
    for (const wire of value.wires || []) {
      if (wire?.id == null) continue;
      const a = endpointPoint(wire.from), b = endpointPoint(wire.to); if (!a || !b) {
        details.set(`wire:${wire.id}`, wireDetails(wire, byId, { endpoints: 'missing', route: 'missing' })); continue;
      }
      const route = wire.route3d || wire.spatial?.route || (wire.route?.points ? wire.route : null);
      const supplied = (Array.isArray(route) ? route : route?.points || []).map(point => physicalVector(point, route?.units || wire.spatial?.units || wire.units || 'mm', mm));
      const validRoute = supplied.length > 0 && supplied.every(Boolean);
      const points = validRoute ? [a.point, ...supplied.map(point => new THREE.Vector3(...point)), b.point] : [a.point, a.point.clone().lerp(b.point, .5).add(new THREE.Vector3(0, Math.max(8 / mm, a.point.distanceTo(b.point) * .18), 0)), b.point];
      const distinct = points.filter((point, index) => index === 0 || point.distanceToSquared(points[index - 1]) > 1e-12);
      if (distinct.length < 2) continue;
      const bendRadius = Number(wire.minBendRadiusMm);
      const routed = validRoute && bendRadius > 0 ? harnessCurve(distinct, bendRadius/mm) : null;
      const curve = routed?.curve || (validRoute ? new THREE.CurvePath() : new THREE.CatmullRomCurve3(distinct));
      if (validRoute && !routed) for (let i = 1; i < distinct.length; i++) curve.add(new THREE.LineCurve3(distinct[i - 1], distinct[i]));
      const diameter = Number(wire.outerDiameterMm || wire.diameterMm);
      const radius = (diameter > 0 ? diameter / 2 : .55) / mm;
      const color = /^#[0-9a-f]{3,8}$/i.test(String(wire.color || '')) ? wire.color : '#66baff';
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(24, Math.min(180, distinct.length * 12)), radius, 7, false), material(color));
      tube.name = `wiring-tube:${wire.id}`; tube.userData.wiringWireId = String(wire.id); group.add(tube); wireOrder.push(String(wire.id));
      const endpointStatus = a.status === 'verified' && b.status === 'verified' ? 'verified' : a.status === 'approximate' || b.status === 'approximate' ? 'approximate' : 'provided';
      const geometry = { endpoints: endpointStatus, from: a.status, to: b.status, route: validRoute ? 'provided' : 'approximate', diameter: diameter > 0 ? 'provided' : 'display default', bendRadius: !validRoute || !(bendRadius > 0) ? 'not specified' : routed.issues.length ? 'insufficient clearance' : `${bendRadius} mm · clearance unverified`, routeLengthMm: curve.getLength() * mm };
      details.set(`wire:${wire.id}`, wireDetails(wire, byId, geometry));
      tube.userData.wiringDetail = details.get(`wire:${wire.id}`);
      for (const point of [a.point, b.point]) {
        const marker = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.8, 8, 6), material(color));
        marker.position.copy(point); marker.userData.wiringWireId = String(wire.id); group.add(marker);
      }
    }
    if (focusWireId && !wireOrder.includes(String(focusWireId))) focusWireId = null;
    selection = oldSelection ? details.get(`${oldSelection.kind}:${oldSelection.id}`) || null : null;
    styleFocus();
    const approximate = [...details.values()].filter(item => Object.values(item.geometry || {}).includes('approximate')).length;
    onStatus?.(`3D wiring · ${components.length} parts · ${wireOrder.length} wires${approximate ? ` · ${approximate} items have approximate geometry` : ''} · ${wiringAccuracyLabel(value)}`);
  }
  function setSelection(value, { notify = true } = {}) {
    const kind = value?.kind || (value?.wireId ? 'wire' : value?.componentId ? 'component' : null);
    const id = value?.id ?? value?.wireId ?? value?.componentId;
    selection = kind && id != null ? details.get(`${kind}:${id}`) || null : null;
    focusWireId = selection?.kind === 'wire' ? selection.id : null; styleFocus();
    if (notify) {
      onSelection?.(selection);
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('wiring-selection', { detail: selection }));
    }
    return selection;
  }
  function detailForObject(object) {
    for (let node = object; node && node !== group.parent; node = node.parent) {
      if (node.userData?.wiringPinKey != null) return details.get(`pin:${node.userData.wiringPinKey}`) || null;
      if (node.userData?.wiringWireId != null) return details.get(`wire:${node.userData.wiringWireId}`) || null;
      if (node.userData?.wiringComponentId != null) return details.get(`component:${node.userData.wiringComponentId}`) || null;
    }
    return null;
  }
  function pickRay(raycaster) {
    if (!active) return null; group.updateWorldMatrix(true, true);
    for (const hit of raycaster.intersectObjects(group.children, true)) {
      const detail = detailForObject(hit.object); if (detail) return { ...hit, detail };
    }
    return null;
  }
  return {
    syncFromSchematic, clear, setSelection, detailForObject, pickRay,
    getAnchor: (componentId, pinId) => anchors.get(`${componentId}:${pinId}`)?.point.clone() || null,
    setActive(value) { active = !!value; group.visible = active; if (active) attach(); },
    isActive: () => active, getGroup: () => group, getSelection: () => selection,
    getContext: () => ({ name: schematic.name || 'Wiring', units: 'model', mmPerUnit: Math.max(.000001, Number(getMmPerUnit?.()) || 1), revision: schematic.revision || null, selection, components: [...details.values()].filter(item => item.kind === 'component'), wires: [...details.values()].filter(item => item.kind === 'wire') }),
    setFocusWire: id => setSelection({ kind: 'wire', id }),
    focusNextWire() { if (!wireOrder.length) return null; const id = wireOrder[(wireOrder.indexOf(String(focusWireId)) + 1) % wireOrder.length]; setSelection({ kind: 'wire', id }); return id; },
    getFocusWireId: () => focusWireId, getWireOrder: () => [...wireOrder],
  };
}
