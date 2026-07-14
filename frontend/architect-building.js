/**
 * Architect building model — levels + 3 ft segments (in-memory).
 * Persistence is handled by the host via getSnapshot / loadSnapshot.
 */

import {
  SEGMENT_FT,
  bayKey,
  createEmptyBuilding,
  isValidBay,
} from "./architect-lattice.js?v=20260710-bay-lattice";

function uid(prefix = "seg") {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function createArchitectBuilding(initial) {
  let building = normalizeBuilding(initial || createEmptyBuilding());
  const listeners = new Set();

  function emit() {
    for (const fn of listeners) {
      try {
        fn(building);
      } catch (err) {
        console.warn("architect building listener", err);
      }
    }
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function getBuilding() {
    return building;
  }

  function getSnapshot() {
    return structuredClone
      ? structuredClone(building)
      : JSON.parse(JSON.stringify(building));
  }

  function loadSnapshot(data) {
    building = normalizeBuilding(data || createEmptyBuilding());
    emit();
    return building;
  }

  function reset() {
    return loadSnapshot(createEmptyBuilding());
  }

  function activeLevel() {
    return building.levels.find((l) => l.id === building.activeLevelId) || building.levels[0];
  }

  function setActiveLevel(levelId) {
    if (!building.levels.some((l) => l.id === levelId)) return false;
    building.activeLevelId = levelId;
    emit();
    return true;
  }

  function segmentsOnActiveLevel() {
    const lid = building.activeLevelId;
    return building.segments.filter((s) => s.levelId === lid);
  }

  function hasBay(a, b, levelId = building.activeLevelId) {
    const key = bayKey(a, b);
    if (!key) return false;
    return building.segments.some((s) => s.levelId === levelId && s.key === key);
  }

  function findBay(a, b, levelId = building.activeLevelId) {
    const key = bayKey(a, b);
    if (!key) return null;
    return building.segments.find((s) => s.levelId === levelId && s.key === key) || null;
  }

  /**
   * Place one 3 ft bay. Returns the segment or null if invalid/duplicate.
   */
  function placeSegment(a, b, { feature = "wall", thicknessFt = 0.5 } = {}) {
    if (!isValidBay(a, b)) return null;
    const key = bayKey(a, b);
    if (!key || hasBay(a, b)) return null;
    const level = activeLevel();
    const seg = {
      id: uid("seg"),
      levelId: level.id,
      a: [Number(a[0]), Number(a[1])],
      b: [Number(b[0]), Number(b[1])],
      key,
      thicknessFt,
      heightFt: level.heightFt ?? 9,
      feature: feature === "window" || feature === "door" ? feature : "wall",
    };
    building.segments.push(seg);
    emit();
    return seg;
  }

  function removeSegment(id) {
    const before = building.segments.length;
    building.segments = building.segments.filter((s) => s.id !== id);
    if (building.segments.length === before) return false;
    emit();
    return true;
  }

  function getSegment(id) {
    return building.segments.find((s) => s.id === id) || null;
  }

  function setFeature(id, feature) {
    const seg = getSegment(id);
    if (!seg) return null;
    seg.feature = feature === "window" || feature === "door" ? feature : "wall";
    emit();
    return seg;
  }

  return {
    SEGMENT_FT,
    onChange,
    getBuilding,
    getSnapshot,
    loadSnapshot,
    reset,
    activeLevel,
    setActiveLevel,
    segmentsOnActiveLevel,
    hasBay,
    findBay,
    placeSegment,
    removeSegment,
    getSegment,
    setFeature,
  };
}

function normalizeBuilding(raw) {
  const base = createEmptyBuilding();
  if (!raw || typeof raw !== "object") return base;
  const levels = Array.isArray(raw.levels) && raw.levels.length
    ? raw.levels.map((l, i) => ({
        id: String(l.id || `level_${i}`),
        name: String(l.name || `Level ${i}`),
        elevationFt: Number(l.elevationFt) || 0,
        heightFt: Number(l.heightFt) || 9,
      }))
    : base.levels;
  const activeLevelId = levels.some((l) => l.id === raw.activeLevelId)
    ? raw.activeLevelId
    : levels[0].id;
  const segments = Array.isArray(raw.segments)
    ? raw.segments
        .map((s) => {
          const a = [Number(s.a?.[0]), Number(s.a?.[1])];
          const b = [Number(s.b?.[0]), Number(s.b?.[1])];
          if (!isValidBay(a, b)) return null;
          const key = bayKey(a, b);
          return {
            id: String(s.id || uid("seg")),
            levelId: String(s.levelId || activeLevelId),
            a,
            b,
            key,
            thicknessFt: Number(s.thicknessFt) || 0.5,
            heightFt: Number(s.heightFt) || 9,
            feature: s.feature === "window" || s.feature === "door" ? s.feature : "wall",
          };
        })
        .filter(Boolean)
    : [];
  return {
    units: "ft",
    grid: { segmentFt: SEGMENT_FT },
    levels,
    activeLevelId,
    segments,
  };
}
