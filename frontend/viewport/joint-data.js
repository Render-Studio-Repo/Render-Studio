/** Pure joint metadata parsing shared by the viewport and tests. */
function vec3(raw, fallback = [0, 0, 0]) {
  if (typeof raw === "string") {
    const key = raw.trim().toLowerCase();
    if (key === "x" || key === "+x") return [1, 0, 0];
    if (key === "y" || key === "+y") return [0, 1, 0];
    if (key === "z" || key === "+z") return [0, 0, 1];
    if (key === "-x") return [-1, 0, 0];
    if (key === "-y") return [0, -1, 0];
    if (key === "-z") return [0, 0, -1];
  }
  if (Array.isArray(raw) && raw.length >= 3) {
    return [Number(raw[0]) || 0, Number(raw[1]) || 0, Number(raw[2]) || 0];
  }
  if (raw && typeof raw === "object") {
    return [Number(raw.x) || 0, Number(raw.y) || 0, Number(raw.z) || 0];
  }
  return fallback.slice();
}

function unit(v) {
  const n = Math.hypot(v[0], v[1], v[2]);
  if (n < 1e-9) return [0, 0, 1];
  return [v[0] / n, v[1] / n, v[2] / n];
}

export function parseHarnessJoints(payload) {
  if (!payload) return [];
  const list = Array.isArray(payload)
    ? payload
    : payload.joints || payload.assembly_constraints || [];
  if (!Array.isArray(list)) return [];
  return list
    .map((item, i) => {
      if (!item || typeof item !== "object") return null;
      const type = String(item.overlay_type || item.type || "fixed").toLowerCase();
      const anchor = vec3(item.anchor || item.anchor_mm || item.parent_anchor || item.origin || item.position);
      const childAnchorRaw = item.child_anchor;
      const childAnchor = childAnchorRaw != null ? vec3(childAnchorRaw, anchor) : null;
      const axis = unit(vec3(item.axis, [0, 0, 1]));
      return {
        id: String(item.id || item.name || `joint_${i + 1}`),
        type: type === "slider" ? "slider" : type,
        parent: String(item.parent || item.parent_link || "world"),
        child: String(item.child || item.child_link || ""),
        anchor,
        childAnchor,
        axis,
        limits: Array.isArray(item.limits) && item.limits.length >= 2
          ? [Number(item.limits[0]), Number(item.limits[1])]
          : null,
      };
    })
    .filter(Boolean);
}

