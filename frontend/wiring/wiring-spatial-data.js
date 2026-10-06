/** Physical wiring data is independent of schematic pixel coordinates. */
const COMPONENT_FIELDS = ['pin_layout_mode', 'required_connections', 'profile', 'partIdentity', 'connectors', 'electrical', 'evidence', 'pins', 'pin_positions', 'position3d', 'rotation3d', 'quaternion', 'dimensions', 'units', 'spatial', 'documentation', 'docs', 'reference_documents', 'model_source', 'sources', 'verification', 'revision', 'manufacturer', 'partNumber'];
const WIRE_FIELDS = ['gauge', 'awg', 'conductorAreaMm2', 'wireType', 'insulation', 'diameterMm', 'outerDiameterMm', 'minBendRadiusMm', 'connectors', 'route3d', 'route', 'units', 'lengthMm', 'cutLengthMm', 'maxCurrentA', 'loadCurrentA', 'voltageDropV', 'documentation', 'sources', 'verification', 'net', 'purpose', 'spatial'];
export function retainWiringMetadata(value = {}, kind = 'component') {
  return Object.fromEntries((kind === 'wire' ? WIRE_FIELDS : COMPONENT_FIELDS)
    .filter(key => value[key] != null).map(key => [key, value[key]]));
}
export function xyz(value) {
  if (Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every(n => Number.isFinite(Number(n)))) return value.slice(0, 3).map(Number);
  if (value && ['x', 'y', 'z'].every(key => value[key] != null && Number.isFinite(Number(value[key])))) return [Number(value.x), Number(value.y), Number(value.z)];
  return null;
}
export function unitToModel(units = 'mm', mmPerUnit = 1) {
  const u = String(units).toLowerCase();
  if (u === 'model' || u === 'model-unit') return 1;
  const mm = { mm: 1, millimeter: 1, cm: 10, m: 1000, meter: 1000, in: 25.4, inch: 25.4 }[u];
  return mm == null ? null : mm / Math.max(0.000001, Number(mmPerUnit) || 1);
}
export function physicalVector(value, units, mmPerUnit) {
  const position = xyz(value); const scale = unitToModel(value?.units || units, mmPerUnit);
  return position && scale != null ? position.map(n => n * scale) : null;
}
export function pinDefinition(component = {}, pinId) {
  const profile = component.profile || component.part?.profile || {};
  const pins = component.pins || component.pin_positions || component.spatial?.pins || profile.pins || profile.pin_positions || component.pin_layout;
  if (Array.isArray(pins)) return pins.find(pin => String(pin.id ?? pin.pinId ?? pin.number ?? pin.label) === String(pinId)) || null;
  const pin = pins?.[pinId];
  return Array.isArray(pin) ? { position3d: pin } : pin || null;
}
export function physicalPin(component, pinId, mmPerUnit = 1) {
  const pin = pinDefinition(component, pinId);
  // Schematic normalized x/y pins intentionally do not qualify as physical anchors.
  const value = pin?.position3d || pin?.position || pin?.coordinates || (pin?.z != null ? pin : null);
  const units = pin?.units || component.spatial?.units || component.units || component.profile?.units || 'mm';
  const point = physicalVector(value, units, mmPerUnit);
  return { point, pin, status: point ? (pin.verification === 'verified' || pin.verification?.status === 'verified' ? 'verified' : 'provided') : 'missing' };
}
export function documentationLinks(...records) {
  const output = []; const seen = new Set();
  const add = (raw, type = 'Documentation') => {
    if (!raw) return;
    if (Array.isArray(raw)) { raw.slice(0, 50).forEach(item => add(item, type)); return; }
    if (typeof raw === 'object' && !(raw.url || raw.href || raw.link)) {
      for (const [key, value] of Object.entries(raw).slice(0, 40)) add(value, key);
      return;
    }
    const href = typeof raw === 'string' ? raw : raw.url || raw.href || raw.link;
    if (typeof href !== 'string' || !/^https?:\/\//i.test(href) || href.length > 2048 || seen.has(href)) return;
    try { new URL(href); } catch { return; }
    seen.add(href); output.push({ url: href, title: String(raw.title || raw.label || type).slice(0, 180), type: String(raw.type || type).slice(0, 80), status: raw.status || raw.verification || 'source provided', page: raw.page || null });
  };
  for (const record of records) {
    if (!record) continue;
    for (const key of ['docs', 'reference_documents', 'documentation', 'sources', 'datasheet', 'datasheet_url', 'schematic', 'schematic_url', 'pinout', 'pinout_url', 'wiring_guide', 'source_url', 'product_url']) add(record[key], key.replaceAll('_', ' '));
  }
  return output.slice(0, 60);
}
export function wireDetails(wire, components, geometry = {}) {
  const items = components instanceof Map ? components : new Map((components || []).map(item => [String(item.id), item]));
  const endpoint = value => {
    const component = items.get(String(value?.componentId));
    const pin = pinDefinition(component, value?.pinId);
    return { componentId: value?.componentId || null, component: component?.label || component?.type || value?.componentId || 'Missing component', pinId: value?.pinId ?? null, pin: pin?.label || pin?.name || value?.pinId || 'Unknown pin', connector: value?.connector || pin?.connector || null };
  };
  const a = items.get(String(wire.from?.componentId)); const b = items.get(String(wire.to?.componentId));
  return {
    kind: 'wire', id: String(wire.id), label: wire.label || wire.net || `Wire ${wire.id}`,
    from: endpoint(wire.from), to: endpoint(wire.to), color: wire.color || null,
    gauge: wire.gauge || (wire.awg != null ? `${wire.awg} AWG` : wire.conductorAreaMm2 != null ? `${wire.conductorAreaMm2} mm²` : null),
    wireType: wire.wireType || wire.insulation || null, connectors: wire.connectors || null,
    routeLengthMm: geometry.routeLengthMm ?? wire.lengthMm ?? null, cutLengthMm: wire.cutLengthMm ?? null,
    verification: wire.verification || 'unverified', geometry: { endpoints: geometry.endpoints || 'approximate', route: geometry.route || 'approximate', ...geometry },
    sources: documentationLinks(wire, a, a?.part, a?.profile, b, b?.part, b?.profile),
  };
}
