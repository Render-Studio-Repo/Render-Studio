/** FreeCAD/OCC kernel measure helpers (Studio + share viewer). */

export function normalizePickKind(type) {
  const kind = String(type || "").toLowerCase();
  if (kind === "corner" || kind === "vertex" || kind === "vert") return "vertex";
  if (kind === "edge") return "edge";
  if (kind === "face") return "face";
  return null;
}

export function refToKernelPick(ref) {
  if (!ref) return null;
  const kind = normalizePickKind(ref.type);
  if (kind === "face" && Number.isInteger(ref.kernel_face_index)) {
    return { kind: "face", index: ref.kernel_face_index };
  }
  if (kind === "edge" && Number.isInteger(ref.kernel_edge_index)) {
    return { kind: "edge", index: ref.kernel_edge_index };
  }
  if (kind === "vertex" && Number.isInteger(ref.kernel_vertex_index)) {
    return { kind: "vertex", index: ref.kernel_vertex_index };
  }
  return null;
}

export function kernelPicksFromRefs(refs = []) {
  return (refs || []).map(refToKernelPick).filter(Boolean);
}

function vec(arr) {
  if (!Array.isArray(arr) || arr.length < 3) return null;
  return [Number(arr[0]), Number(arr[1]), Number(arr[2])];
}

function dist(a, b) {
  if (!a || !b) return null;
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function closestPointsOnSegments(a0, a1, b0, b1) {
  const d1 = sub(a1, a0);
  const d2 = sub(b1, b0);
  const r = sub(a0, b0);
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s;
  let t;
  if (a <= 1e-18 && e <= 1e-18) {
    return { a: a0, b: b0, distance: dist(a0, b0) };
  }
  if (a <= 1e-18) {
    s = 0;
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = dot(d1, r);
    if (e <= 1e-18) {
      t = 0;
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom <= 1e-18 ? 0 : Math.max(0, Math.min(1, (b * f - c * e) / denom));
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }
  const pa = [a0[0] + d1[0] * s, a0[1] + d1[1] * s, a0[2] + d1[2] * s];
  const pb = [b0[0] + d2[0] * t, b0[1] + d2[1] * t, b0[2] + d2[2] * t];
  return { a: pa, b: pb, distance: dist(pa, pb) };
}

function closestPointOnSegment(p, a0, a1) {
  const d = sub(a1, a0);
  const len2 = dot(d, d);
  const t = len2 <= 1e-18 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a0), d) / len2));
  const q = [a0[0] + d[0] * t, a0[1] + d[1] * t, a0[2] + d[2] * t];
  return { point: q, distance: dist(p, q) };
}

function lookupTopo(topo, pick) {
  if (!topo || !pick) return null;
  const list = pick.kind === "face" ? topo.faces : pick.kind === "edge" ? topo.edges : topo.vertices;
  return (list || []).find((item) => Number(item?.index) === pick.index) || (list || [])[pick.index] || null;
}

function entityPoint(kind, entity) {
  if (!entity) return null;
  if (kind === "vertex") return vec(entity.position);
  if (kind === "edge") return vec(entity.mid) || (vec(entity.start) && vec(entity.end)
    ? [
        (entity.start[0] + entity.end[0]) / 2,
        (entity.start[1] + entity.end[1]) / 2,
        (entity.start[2] + entity.end[2]) / 2,
      ]
    : null);
  return vec(entity.center);
}

export function measureFromKernelTopo(refs, topo) {
  const picks = kernelPicksFromRefs(refs);
  if (!picks.length || !topo || topo.kernel !== "freecad") return null;
  const aPick = picks[picks.length - (picks.length > 1 ? 2 : 1)];
  const bPick = picks.length > 1 ? picks[picks.length - 1] : null;
  const aEnt = lookupTopo(topo, aPick);
  const bEnt = bPick ? lookupTopo(topo, bPick) : null;
  if (!aEnt) return null;

  if (!bPick) {
    if (aPick.kind === "edge" && Number.isFinite(Number(aEnt.length))) {
      return {
        source: "freecad-topo",
        kind: "length",
        label: "Edge length",
        valueMm: Number(aEnt.length),
        point1: entityPoint("edge", aEnt),
        point2: null,
      };
    }
    if (aPick.kind === "face" && Number.isFinite(Number(aEnt.area))) {
      return {
        source: "freecad-topo",
        kind: "area",
        label: "Face area",
        valueMm: Number(aEnt.area),
        point1: entityPoint("face", aEnt),
        point2: null,
      };
    }
    if (aPick.kind === "vertex") {
      const p = entityPoint("vertex", aEnt);
      return {
        source: "freecad-topo",
        kind: "point",
        label: "Corner",
        valueMm: p ? Math.hypot(p[0], p[1], p[2]) : null,
        point1: p,
        point2: null,
        positionMm: p,
      };
    }
    return null;
  }
  if (!bEnt) return null;

  let point1 = entityPoint(aPick.kind, aEnt);
  let point2 = entityPoint(bPick.kind, bEnt);
  let distance = dist(point1, point2);

  if (aPick.kind === "edge" && bPick.kind === "edge" && vec(aEnt.start) && vec(aEnt.end) && vec(bEnt.start) && vec(bEnt.end)) {
    const closest = closestPointsOnSegments(vec(aEnt.start), vec(aEnt.end), vec(bEnt.start), vec(bEnt.end));
    point1 = closest.a;
    point2 = closest.b;
    distance = closest.distance;
  } else if (aPick.kind === "vertex" && bPick.kind === "edge" && vec(bEnt.start) && vec(bEnt.end)) {
    const closest = closestPointOnSegment(point1, vec(bEnt.start), vec(bEnt.end));
    point2 = closest.point;
    distance = closest.distance;
  } else if (bPick.kind === "vertex" && aPick.kind === "edge" && vec(aEnt.start) && vec(aEnt.end)) {
    const closest = closestPointOnSegment(point2, vec(aEnt.start), vec(aEnt.end));
    point1 = closest.point;
    distance = closest.distance;
  } else if (aPick.kind === "face" && bPick.kind === "face" && aEnt.planar && bEnt.planar) {
    const n1 = vec(aEnt.normal);
    const n2 = vec(bEnt.normal);
    const c1 = vec(aEnt.center);
    const c2 = vec(bEnt.center);
    if (n1 && n2 && c1 && c2) {
      const nlen = Math.hypot(...n1) || 1;
      const nn = [n1[0] / nlen, n1[1] / nlen, n1[2] / nlen];
      const align = Math.abs(dot(nn, [n2[0] / (Math.hypot(...n2) || 1), n2[1] / (Math.hypot(...n2) || 1), n2[2] / (Math.hypot(...n2) || 1)]));
      if (align > 0.985) {
        distance = Math.abs(dot(nn, sub(c2, c1)));
        point1 = c1;
        point2 = [c1[0] + nn[0] * distance, c1[1] + nn[1] * distance, c1[2] + nn[2] * distance];
      }
    }
  }

  const names = { vertex: "corner", edge: "edge", face: "face" };
  const label = aPick.kind === bPick.kind
    ? `${names[aPick.kind][0].toUpperCase()}${names[aPick.kind].slice(1)} distance`
    : `${names[aPick.kind][0].toUpperCase()}${names[aPick.kind].slice(1)} to ${names[bPick.kind]} distance`;
  return {
    source: "freecad-topo",
    kind: "length",
    label,
    valueMm: distance,
    point1,
    point2,
  };
}

export function measureFromOccResult(result) {
  if (!result || result.kernel !== "freecad") return null;
  if (result.kind === "area" && Number.isFinite(Number(result.area_mm2))) {
    return {
      source: "occ",
      kind: "area",
      label: result.label || "Face area",
      valueMm: Number(result.area_mm2),
      point1: result.point1 || null,
      point2: null,
    };
  }
  if (result.kind === "point") {
    return {
      source: "occ",
      kind: "point",
      label: result.label || "Corner",
      valueMm: Array.isArray(result.position_mm) ? Math.hypot(...result.position_mm) : null,
      point1: result.position_mm || result.point1 || null,
      point2: null,
      positionMm: result.position_mm || result.point1 || null,
    };
  }
  const value = Number(result.distance_mm ?? result.length_mm);
  if (!Number.isFinite(value) && result.kind !== "length") return null;
  return {
    source: "occ",
    kind: "length",
    label: result.label || "Distance",
    valueMm: Number.isFinite(value) ? value : Number(result.length_mm),
    point1: result.point1 || null,
    point2: result.point2 || null,
  };
}

export function formatKernelSummary(measured, { formatLength, formatArea, fallback } = {}) {
  if (!measured) return fallback || { value: "—", meta: "Click a vertex, edge, or face" };
  if (measured.kind === "area") {
    return {
      value: formatArea ? formatArea(measured.valueMm) : `${measured.valueMm} mm²`,
      meta: measured.label || "Face area",
      measured,
    };
  }
  if (measured.kind === "point" && Array.isArray(measured.positionMm)) {
    const p = measured.positionMm;
    const fmt = formatLength || ((mm) => `${Number(mm).toFixed(2)} mm`);
    return {
      value: fmt(Math.hypot(p[0], p[1], p[2])),
      meta: `Corner · X ${fmt(p[0])} · Y ${fmt(p[1])} · Z ${fmt(p[2])}`,
      measured,
    };
  }
  if (Number.isFinite(measured.valueMm)) {
    return {
      value: formatLength ? formatLength(measured.valueMm) : `${measured.valueMm} mm`,
      meta: measured.label || "Distance",
      measured,
    };
  }
  return fallback || { value: "—", meta: measured.label || "Measure" };
}

export function snapPointToKernel(topo, point, normal, mode = "edge") {
  if (!topo || topo.kernel !== "freecad" || !point) return null;
  const px = point.x ?? point[0];
  const py = point.y ?? point[1];
  const pz = point.z ?? point[2];
  const want = normalizePickKind(mode) || "edge";
  if (want === "face") {
    const faces = topo.faces || [];
    let best = null;
    const nx = normal?.x ?? normal?.[0] ?? 0;
    const ny = normal?.y ?? normal?.[1] ?? 0;
    const nz = normal?.z ?? normal?.[2] ?? 0;
    const nlen = Math.hypot(nx, ny, nz) || 1;
    for (const face of faces) {
      const bb = face?.bbox;
      if (!Array.isArray(bb) || bb.length < 6) continue;
      if (!(bb[0] - 1.5 <= px && px <= bb[3] + 1.5 && bb[1] - 1.5 <= py && py <= bb[4] + 1.5 && bb[2] - 1.5 <= pz && pz <= bb[5] + 1.5)) {
        continue;
      }
      const c = face.center || [];
      const distC = Math.hypot(px - c[0], py - c[1], pz - c[2]);
      const fn = face.normal || [];
      const align = fn.length >= 3 ? Math.abs((fn[0] * nx + fn[1] * ny + fn[2] * nz) / nlen) : 0;
      const score = distC - 40 * align;
      if (!best || score < best.score) best = { face, score };
    }
    return best?.face ? { kind: "face", entity: best.face, index: best.face.index } : null;
  }
  if (want === "vertex") {
    let best = null;
    for (const vertex of topo.vertices || []) {
      const pos = vertex?.position;
      if (!Array.isArray(pos) || pos.length < 3) continue;
      const d = Math.hypot(px - pos[0], py - pos[1], pz - pos[2]);
      if (!best || d < best.d) best = { vertex, d };
    }
    return best?.vertex ? { kind: "vertex", entity: best.vertex, index: best.vertex.index } : null;
  }
  let best = null;
  for (const edge of topo.edges || []) {
    const start = edge?.start;
    const end = edge?.end;
    if (!Array.isArray(start) || !Array.isArray(end)) continue;
    const closest = closestPointOnSegment([px, py, pz], start, end);
    if (!best || closest.distance < best.d) best = { edge, d: closest.distance };
  }
  return best?.edge ? { kind: "edge", entity: best.edge, index: best.edge.index } : null;
}

export function kernelEntityToRef(snap, id) {
  if (!snap?.entity) return null;
  const entity = snap.entity;
  const kind = snap.kind;
  const type = kind === "vertex" ? "corner" : kind;
  const position = kind === "vertex"
    ? entity.position
    : kind === "edge"
      ? (entity.mid || [
          (entity.start[0] + entity.end[0]) / 2,
          (entity.start[1] + entity.end[1]) / 2,
          (entity.start[2] + entity.end[2]) / 2,
        ])
      : entity.center;
  return {
    id: id || `${type}-${snap.index}`,
    type,
    kernel: "freecad",
    position,
    normal: entity.normal || [0, 0, 1],
    kernel_face_index: kind === "face" ? snap.index : null,
    kernel_edge_index: kind === "edge" ? snap.index : null,
    kernel_vertex_index: kind === "vertex" ? snap.index : null,
    body_index: entity.body_index ?? null,
    face_area: kind === "face" ? entity.area : null,
    edge_length: kind === "edge" ? entity.length : null,
    edge_start: kind === "edge" ? entity.start : null,
    edge_end: kind === "edge" ? entity.end : null,
  };
}

export function glbEntityToRef(entity, id) {
  if (!entity) return null;
  const type = entity.type === "vertex" ? "corner" : entity.type;
  const position = entity.position
    ? [entity.position.x, entity.position.y, entity.position.z]
    : [0, 0, 0];
  return {
    id: id || `${type}-glb`,
    type,
    kernel: null,
    position,
    normal: entity.normal ? [entity.normal.x, entity.normal.y, entity.normal.z] : [0, 0, 1],
    face_area: entity.face?.area ?? null,
    face_indices: entity.face?.face_indices || null,
    mesh_uuid: entity.hit?.object?.uuid || entity.mesh_uuid || null,
    edge_length: entity.edge?.length ?? null,
    edge_start: entity.edge?.start ? [entity.edge.start.x, entity.edge.start.y, entity.edge.start.z] : null,
    edge_end: entity.edge?.end ? [entity.edge.end.x, entity.edge.end.y, entity.edge.end.z] : null,
  };
}

export function measureFromGlbRefs(refs) {
  const measured = (refs || []).filter((r) => ["corner", "edge", "face"].includes(r?.type) && Array.isArray(r.position));
  if (!measured.length) return null;
  if (measured.length === 1) {
    const r = measured[0];
    if (r.type === "edge" && Number.isFinite(r.edge_length)) {
      return { source: "glb", kind: "length", label: "Edge length", valueMm: r.edge_length, point1: r.position, point2: r.edge_end || null };
    }
    if (r.type === "face" && Number.isFinite(r.face_area)) {
      return { source: "glb", kind: "area", label: "Face area", valueMm: r.face_area, point1: r.position, point2: null };
    }
    return {
      source: "glb",
      kind: "point",
      label: "Corner",
      valueMm: Math.hypot(...r.position),
      point1: r.position,
      positionMm: r.position,
    };
  }
  const a = measured[measured.length - 2];
  const b = measured[measured.length - 1];
  if (a.type === "edge" && b.type === "edge" && a.edge_start && a.edge_end && b.edge_start && b.edge_end) {
    const closest = closestPointsOnSegments(a.edge_start, a.edge_end, b.edge_start, b.edge_end);
    return { source: "glb", kind: "length", label: "Edge distance", valueMm: closest.distance, point1: closest.a, point2: closest.b };
  }
  const distance = dist(a.position, b.position);
  return {
    source: "glb",
    kind: "length",
    label: `${a.type} to ${b.type} distance`,
    valueMm: distance,
    point1: a.position,
    point2: b.position,
  };
}

export function isCompleteMeasureRefs(refs = [], pickMode = "auto") {
  const measured = (refs || []).filter((r) => ["corner", "edge", "face"].includes(r?.type));
  if (measured.length >= 2) return true;
  if (measured.length !== 1) return false;
  const type = measured[0].type;
  const mode = normalizePickKind(pickMode);
  // Face mode stays live on the first pick (area in the readout) so a second
  // face can complete a face-to-face distance. Done / Enter persist the area.
  if (mode === "face") return false;
  if (mode === "edge") return type === "edge";
  if (mode === "vertex") return false;
  return type === "edge" || type === "face";
}

export function isInProgressMeasureRefs(refs = [], pickMode = null) {
  const measured = (refs || []).filter((r) => ["corner", "edge", "face"].includes(r?.type));
  return measured.length > 0 && !isCompleteMeasureRefs(refs, pickMode);
}

function mid3(a, b) {
  return [
    (Number(a[0]) + Number(b[0])) / 2,
    (Number(a[1]) + Number(b[1])) / 2,
    (Number(a[2]) + Number(b[2])) / 2,
  ];
}

/** Line/label geometry in the same model space as the dashed overlay (not kernel mm). */
export function measureOverlayAnchor(refs = [], measured = null) {
  const list = (refs || []).filter((r) => ["corner", "edge", "face"].includes(r?.type));
  if (list.length === 1) {
    const r = list[0];
    if (r.type === "edge" && Array.isArray(r.edge_start) && Array.isArray(r.edge_end)) {
      return {
        p1: r.edge_start.slice(0, 3),
        p2: r.edge_end.slice(0, 3),
        anchor: mid3(r.edge_start, r.edge_end),
      };
    }
    const p = Array.isArray(r.position)
      ? r.position.slice(0, 3)
      : (Array.isArray(measured?.point1) ? measured.point1.slice(0, 3) : null);
    return { p1: p, p2: p, anchor: p };
  }
  if (list.length >= 2) {
    const a = list[list.length - 2];
    const b = list[list.length - 1];
    const p1 = Array.isArray(a.position) ? a.position.slice(0, 3) : null;
    const p2 = Array.isArray(b.position) ? b.position.slice(0, 3) : null;
    if (p1 && p2) return { p1, p2, anchor: mid3(p1, p2) };
  }
  if (measured?.point1 && measured?.point2) {
    return {
      p1: measured.point1.slice(0, 3),
      p2: measured.point2.slice(0, 3),
      anchor: mid3(measured.point1, measured.point2),
    };
  }
  if (Array.isArray(measured?.point1) && measured.point1.length >= 3) {
    const p = measured.point1.slice(0, 3);
    return { p1: p, p2: p, anchor: p };
  }
  return { p1: null, p2: null, anchor: null };
}

export function measureWorldAnchor(refs = [], measured = null) {
  return measureOverlayAnchor(refs, measured).anchor;
}

export function measurementAuthorFromUser(user) {
  if (!user?.id) {
    return {
      id: null,
      display_name: "Guest",
      avatar_url: "",
      handle: "",
      guest: true,
    };
  }
  return {
    id: String(user.id),
    display_name: String(user.display_name || user.email || "You"),
    avatar_url: String(user.avatar_url || `/api/users/${encodeURIComponent(user.id)}/avatar`),
    handle: String(user.handle || ""),
    guest: false,
  };
}

let measureSeq = 0;

export function createSavedMeasurement({ refs, label, value, author, measured, pinned = false, labelOffset = null } = {}) {
  measureSeq += 1;
  const id = `meas-${Date.now().toString(36)}-${measureSeq}`;
  const ox = Number(labelOffset?.x);
  const oy = Number(labelOffset?.y);
  return {
    id,
    refs: (refs || []).map((r) => ({ ...r })),
    label: String(label || "").trim(),
    value: String(value || "").trim(),
    author: measurementAuthorFromUser(author?.guest ? null : author),
    savedAt: Date.now(),
    anchor: measureWorldAnchor(refs, measured),
    pinned: Boolean(pinned),
    labelOffset: {
      x: Number.isFinite(ox) ? ox : 0,
      y: Number.isFinite(oy) ? oy : 0,
    },
  };
}
