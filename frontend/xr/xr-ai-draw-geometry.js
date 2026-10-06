/** Small allocation-free distance checks for Draw's capped sampling loop. */
export function boardSampleDistanceSquared(previous, point, matrixElements) {
  const x = point.x - previous[0], y = point.y - previous[1], z = point.z - previous[2];
  if (!matrixElements) return x*x + y*y + z*z;
  const m = matrixElements;
  const a = m[0]*x + m[4]*y + m[8]*z, b = m[1]*x + m[5]*y + m[9]*z, c = m[2]*x + m[6]*y + m[10]*z;
  return a*a + b*b + c*c;
}

/** Actual triangle edge nearest the surface hit, in the model instance's coordinates. */
export function nearestBoardTriangleEdge(points, point) {
  if (!Array.isArray(points) || points.length !== 3 || !Array.isArray(point)) return null;
  let best = null, distance = Infinity;
  for (let i = 0; i < 3; i++) {
    const a = points[i], b = points[(i+1)%3];
    if (!Array.isArray(a) || !Array.isArray(b) || a.length < 3 || b.length < 3) return null;
    const d = b.map((value,j)=>value-a[j]), n = d[0]*d[0]+d[1]*d[1]+d[2]*d[2];
    if (!(n > 0)) continue;
    const t = Math.max(0,Math.min(1,((point[0]-a[0])*d[0]+(point[1]-a[1])*d[1]+(point[2]-a[2])*d[2])/n));
    const error = a.reduce((sum,value,j)=>sum+(point[j]-value-t*d[j])**2,0);
    if (error < distance) { distance = error; best = [a.slice(0,3), b.slice(0,3)]; }
  }
  return best;
}

/** Resolve only the display string. Editors retain @{stable-id} tokens internally. */
export function displayBoardEditorText(value, state = {}) {
  return String(value || '').replace(/@\{([\w.:-]+)\}/g, (_token, id) => {
    const item = state.nodes?.[id] || state.regions?.[id] || state.notes?.[id];
    return item ? `@${item.name || item.kind || 'Reference'}` : '@[reference unavailable]';
  });
}
