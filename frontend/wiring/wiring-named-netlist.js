/** Named industrial terminals can be inspected without inventing Arduino coil-pin code. */
export function namedActuatorAnalysis(schematic, component) {
  if (component.pin_layout_mode !== 'diagram') return null;
  const wires = (schematic.wires || []).filter(w => w.from?.componentId === component.id || w.to?.componentId === component.id);
  const parts = new Map((schematic.components || []).map(c => [c.id,c]));
  const peers = wires.map(w => parts.get(w.from.componentId === component.id ? w.to.componentId : w.from.componentId));
  const hasDriver = peers.some(c => c?.type === 'motor-driver');
  const connected = new Set(wires.map(w => (w.from.componentId === component.id ? w.from : w.to).pinId));
  const required = component.required_connections || (component.pin_layout || []).map(p => p.id);
  const missing = required.filter(id => !connected.has(id));
  const issues = missing.length ? [`Unconnected motor terminals: ${missing.join(', ')}.`] : [];
  if (schematic.blocker?.reason) issues.push(schematic.blocker.reason);
  issues.push('Named industrial terminals are shown as a connectivity diagram. This controller requires its own firmware configuration; Arduino/Pi GPIO motion simulation is unavailable.');
  return {id:component.id,label:component.label,type:'stepper',control:null,coilPins:[],via:hasDriver?'driver':null,wired:hasDriver&&!missing.length,needsDriver:!hasDriver,recommendedDriver:null,simulationSupported:false,issues};
}
