function pins(component = {}) {
  const value = component.pins || component.profile?.pins || component.pin_layout;
  return Array.isArray(value) ? value : [];
}
export function wiringAccuracy(schematic = {}) {
  const components = (schematic.components || []).filter(Boolean);
  const wires = (schematic.wires || []).filter(Boolean);
  let exactGeometry = 0, verifiedComponents = 0, physicalEndpoints = 0;
  const byId = new Map(components.map(c => [String(c.id), c]));
  const details = components.map(component => {
    const identity = component.partIdentity || {};
    const identified = !!((identity.manufacturer || component.manufacturer) && (identity.partNumber || component.partNumber) && (identity.revision || component.revision));
    const exact = !!(component.sourceFile && component.dimensions);
    const terminals = pins(component);
    const anchored = terminals.filter(pin => pin.position3d || pin.coordinates).length;
    const evidenced = terminals.filter(pin => pin.evidence || pin.documentation || pin.verification === 'verified').length;
    const cavities = (component.connectors || []).reduce((sum, connector) => sum + (connector?.cavities?.length || 0), 0);
    const verified = identified && exact && terminals.length > 0 && anchored === terminals.length && evidenced === terminals.length && cavities > 0;
    if (exact) exactGeometry++;
    if (verified) verifiedComponents++;
    return { id:String(component.id), identified, exact, terminals:terminals.length, anchored, evidenced, cavities, verified };
  });
  for (const wire of wires) for (const side of ['from', 'to']) {
    const endpoint = wire[side] || {};
    const pin = pins(byId.get(String(endpoint.componentId))).find(item => String(item.id ?? item.pinId ?? item.number) === String(endpoint.pinId));
    if (pin?.position3d || pin?.coordinates) physicalEndpoints++;
  }
  const endpoints = wires.length * 2;
  return {
    mode:String(schematic.buildMode || schematic.accuracyMode || 'concept').toLowerCase(),
    components:details,
    exactGeometryPercent:components.length ? Math.round(100 * exactGeometry / components.length) : 0,
    physicalEndpointPercent:endpoints ? Math.round(100 * physicalEndpoints / endpoints) : 0,
    readyForPhysicalWiring:components.length > 0 && verifiedComponents === components.length && (!endpoints || physicalEndpoints === endpoints),
  };
}
export function wiringAccuracyLabel(schematic = {}) {
  const report = wiringAccuracy(schematic);
  const mode = report.mode === 'verified' || report.mode === 'verified-build' ? 'Verified build' : report.mode === 'guided' ? 'Guided' : 'Concept';
  return `${mode} · exact geometry ${report.exactGeometryPercent}% · physical terminals ${report.physicalEndpointPercent}%${report.readyForPhysicalWiring ? ' · physical wiring ready' : ' · verification required'}`;
}
