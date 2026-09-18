// Workshop layout uses real-world meters so a future passthrough / AR layer can
// load these placements directly. Within Workshop-authored space, one Three.js
// world unit equals one meter and yaw is stored in radians around +Z.

export const WORKSHOP_LAYOUT_VERSION = 1;
export const WORKSHOP_LINEAR_UNIT = "m";
export const WORKSHOP_ANGLE_UNIT = "rad";
export const WORKSHOP_SCENE_UNIT_METERS = 1;

export const WORKSHOP_DIMENSIONS_M = {
  warehouse: {
    width: 18,
    depth: 14,
    height: 4.8,
    wallThickness: 0.18,
    columnSize: 0.24,
  },
  desk: {
    width: 1.6,
    depth: 0.8,
    height: 0.74,
    topThickness: 0.04,
    legSize: 0.06,
  },
  cornerDesk: {
    width: 2.0,
    depth: 1.8,
    height: 0.76,
    returnWidth: 1.1,
    returnDepth: 0.7,
    topThickness: 0.04,
    legSize: 0.06,
  },
  tv: {
    width: 1.4,
    depth: 0.12,
    height: 0.86,
    standHeight: 1.45,
    standFootprint: 0.48,
  },
  deskMonitor: {
    width: 0.6,
    depth: 0.08,
    height: 0.34,
    standHeight: 1.08,
    standFootprint: 0.22,
  },
  ultrawideMonitor: {
    width: 1.18,
    depth: 0.09,
    height: 0.37,
    standHeight: 1.1,
    standFootprint: 0.26,
  },
  robotBay: {
    width: 4.2,
    depth: 3.0,
    markerHeight: 0.02,
  },
  wiringBay: {
    width: 2.6,
    depth: 1.6,
    markerHeight: 0.02,
  },
  djZone: {
    width: 2.2,
    depth: 1.8,
    markerHeight: 0.02,
  },
};

export const WORKSHOP_PARTNER_OPTIONS = [
  {
    id: "astra",
    label: "Astra",
    kind: "voice",
    summary: "Voice partner for live see-and-hear guidance.",
  },
  {
    id: "code-bot",
    label: "Code Bot",
    kind: "agent",
    summary: "Build partner for code and editor updates.",
  },
  {
    id: "sales",
    label: "Sales",
    kind: "agent",
    summary: "Tracks recent deals, outreach, and CRM follow-up.",
  },
  {
    id: "projects-manager",
    label: "Projects Manager",
    kind: "agent",
    summary: "Tracks next steps, handoffs, and room status.",
  },
  {
    id: "concrete-cad",
    label: "Concrete CAD",
    kind: "agent",
    summary: "Checks layouts, fits, and physical clearances.",
  },
  {
    id: "sam-seat",
    label: "Sam / user seat",
    kind: "human",
    summary: "Manual workstation for the person driving the room.",
  },
];

export const WORKSHOP_AGENT_SEATS = [
  {
    id: "sam-seat",
    label: "Sam / user seat",
    deskLabel: "Sam desk",
    role: "human",
    status: "Present",
  },
  {
    id: "astra",
    label: "Astra",
    deskLabel: "Astra voice desk",
    role: "voice",
    status: "Ready",
  },
  {
    id: "code-bot",
    label: "Code Bot",
    deskLabel: "Code Bot desk",
    role: "agent",
    status: "Ready",
  },
  {
    id: "sales",
    label: "Sales",
    deskLabel: "Sales desk",
    role: "agent",
    status: "Ready",
  },
  {
    id: "projects-manager",
    label: "Projects Manager",
    deskLabel: "Projects Manager desk",
    role: "agent",
    status: "Ready",
  },
  {
    id: "concrete-cad",
    label: "Concrete CAD",
    deskLabel: "Concrete CAD desk",
    role: "agent",
    status: "Ready",
  },
  {
    id: "open-seat-1",
    label: "Open seat 1",
    deskLabel: "Open seat 1",
    role: "placeholder",
    status: "Reserved",
  },
  {
    id: "open-seat-2",
    label: "Open seat 2",
    deskLabel: "Open seat 2",
    role: "placeholder",
    status: "Reserved",
  },
];

export const WORKSHOP_TV_STREAM_SLOTS = [
  {
    id: "openarm-telemetry",
    label: "OpenArm telemetry",
    summary: "Mock motion, load, and camera heartbeat feed.",
  },
  {
    id: "room-queue",
    label: "Room queue",
    summary: "Upcoming workshop tasks and approvals.",
  },
];

export const WORKSHOP_PLACE_PRESETS = [
  {
    id: "desk",
    type: "desk",
    label: "Desk",
    summary: "Standard 1.6 m office desk.",
    dimensions: { ...WORKSHOP_DIMENSIONS_M.desk },
  },
  {
    id: "tv",
    type: "tv",
    label: "TV screen",
    summary: "1.4 m panel with a stream slot.",
    dimensions: { ...WORKSHOP_DIMENSIONS_M.tv },
    streamSlot: "room-queue",
  },
  {
    id: "robot-bay",
    type: "robot-bay",
    label: "Robotics sim bay",
    summary: "OpenArm / MuJoCo / Isaac anchor footprint.",
    dimensions: { ...WORKSHOP_DIMENSIONS_M.robotBay },
  },
  {
    id: "wiring-bay",
    type: "wiring-bay",
    label: "Wiring bay marker",
    summary: "Bench footprint for wiring and cable checks.",
    dimensions: { ...WORKSHOP_DIMENSIONS_M.wiringBay },
  },
  {
    id: "dj-zone",
    type: "dj-zone",
    label: "DJ handoff zone",
    summary: "Voice cue area for a future Spotify / DJ bridge.",
    dimensions: { ...WORKSHOP_DIMENSIONS_M.djZone },
  },
];

export function presetById(id = "") {
  return WORKSHOP_PLACE_PRESETS.find((preset) => preset.id === id) || WORKSHOP_PLACE_PRESETS[0];
}

export function nextWorkshopObjectId(type = "item", objects = []) {
  const count = objects.filter((item) => String(item?.type || "") === String(type)).length + 1;
  return `${type}-${count}`;
}

function roundNumber(value, digits = 4) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Number(num.toFixed(digits));
}

function normalizePose(pose = {}) {
  return {
    x: roundNumber(pose.x, 4),
    y: roundNumber(pose.y, 4),
    z: roundNumber(pose.z, 4),
    yaw: roundNumber(pose.yaw, 6),
  };
}

function normalizeDimensions(dimensions = {}, fallback = {}) {
  return {
    width: roundNumber(dimensions.width ?? fallback.width, 4),
    depth: roundNumber(dimensions.depth ?? fallback.depth, 4),
    height: roundNumber(dimensions.height ?? fallback.height, 4),
  };
}

export function createWorkshopObject({
  id = "",
  type = "desk",
  label = "Workshop item",
  pose = {},
  dimensions = {},
  streamSlot = "",
  seatId = "",
  metadata = {},
} = {}) {
  return {
    id: String(id || ""),
    type: String(type || "desk"),
    label: String(label || "Workshop item"),
    pose: normalizePose(pose),
    dimensions: normalizeDimensions(dimensions),
    streamSlot: String(streamSlot || ""),
    seatId: String(seatId || ""),
    metadata: metadata && typeof metadata === "object" ? { ...metadata } : {},
  };
}

export function buildDefaultWorkshopLayout() {
  const desk = WORKSHOP_DIMENSIONS_M.desk;
  const cornerDesk = WORKSHOP_DIMENSIONS_M.cornerDesk;
  const tv = WORKSHOP_DIMENSIONS_M.tv;
  const deskMonitor = WORKSHOP_DIMENSIONS_M.deskMonitor;
  const ultrawideMonitor = WORKSHOP_DIMENSIONS_M.ultrawideMonitor;
  const robotBay = WORKSHOP_DIMENSIONS_M.robotBay;
  const wiringBay = WORKSHOP_DIMENSIONS_M.wiringBay;
  const djZone = WORKSHOP_DIMENSIONS_M.djZone;
  const seatLayoutById = {
    "sam-seat": { x: -6.2, y: -2.9, yaw: 0, type: "desk", dimensions: desk },
    astra: { x: -2.1, y: -2.9, yaw: 0, type: "desk", dimensions: desk },
    sales: { x: 2.1, y: -2.9, yaw: 0, type: "desk", dimensions: desk },
    "code-bot": { x: 6.2, y: -2.9, yaw: 0, type: "desk", dimensions: desk },
    "projects-manager": { x: -1.4, y: 3.15, yaw: Math.PI, type: "corner-desk", dimensions: cornerDesk },
    "concrete-cad": { x: 2.65, y: 2.95, yaw: Math.PI, type: "desk", dimensions: desk },
    "open-seat-1": { x: -6.2, y: 2.9, yaw: Math.PI, type: "desk", dimensions: desk },
    "open-seat-2": { x: 6.2, y: 2.9, yaw: Math.PI, type: "desk", dimensions: desk },
  };

  const objects = WORKSHOP_AGENT_SEATS.map((seat) => {
    const placement = seatLayoutById[seat.id] || { x: 0, y: 0, yaw: 0, type: "desk", dimensions: desk };
    const dimensions = placement.dimensions || desk;
    return createWorkshopObject({
      id: `desk-${seat.id}`,
      type: placement.type || "desk",
      label: seat.deskLabel,
      seatId: seat.id,
      pose: {
        x: placement.x,
        y: placement.y,
        z: (dimensions.height || desk.height) / 2,
        yaw: placement.yaw,
      },
      dimensions,
      metadata: {
        seatLabel: seat.label,
        role: seat.role,
      },
    });
  });

  objects.push(
    createWorkshopObject({
      id: "tv-pm-wrap",
      type: "tv",
      label: "PM wrap monitor",
      pose: { x: -1.4, y: 2.55, z: ultrawideMonitor.standHeight, yaw: Math.PI },
      dimensions: { width: ultrawideMonitor.width, depth: ultrawideMonitor.depth, height: ultrawideMonitor.height },
      streamSlot: "pm-trial-queue",
      metadata: { panelType: "pm-trial-queue", agentId: "projects-manager", mount: "desk", todo: "Hook up live project feed." },
    }),
    createWorkshopObject({
      id: "tv-pm-left",
      type: "tv",
      label: "PM queue side monitor",
      pose: { x: -1.98, y: 2.62, z: deskMonitor.standHeight, yaw: Math.PI + 0.42 },
      dimensions: { width: deskMonitor.width, depth: deskMonitor.depth, height: deskMonitor.height },
      streamSlot: "pm-cad-collab",
      metadata: { panelType: "pm-cad-collab", agentId: "projects-manager", mount: "desk", todo: "Hook up live project feed." },
    }),
    createWorkshopObject({
      id: "tv-pm-right",
      type: "tv",
      label: "PM teach assemble board",
      pose: { x: -0.82, y: 2.62, z: deskMonitor.standHeight, yaw: Math.PI - 0.42 },
      dimensions: { width: deskMonitor.width, depth: deskMonitor.depth, height: deskMonitor.height },
      streamSlot: "pm-teach-board",
      metadata: { panelType: "pm-teach-board", agentId: "projects-manager", mount: "desk", todo: "Hook up live project feed." },
    }),
    createWorkshopObject({
      id: "tv-concrete-link",
      type: "tv",
      label: "Concrete CAD handoff monitor",
      pose: { x: 2.65, y: 2.66, z: deskMonitor.standHeight, yaw: Math.PI },
      dimensions: { width: deskMonitor.width, depth: deskMonitor.depth, height: deskMonitor.height },
      streamSlot: "pm-cad-collab",
      metadata: { panelType: "pm-cad-collab", agentId: "concrete-cad", mount: "desk", todo: "Hook up live project feed." },
    }),
    createWorkshopObject({
      id: "tv-sales-desk",
      type: "tv",
      label: "Sales agent monitor",
      pose: { x: 2.1, y: -2.62, z: deskMonitor.standHeight, yaw: 0 },
      dimensions: { width: deskMonitor.width, depth: deskMonitor.depth, height: deskMonitor.height },
      streamSlot: "sales-interactions",
      metadata: { panelType: "sales-interactions", agentId: "sales", mount: "desk", todo: "Hook up HubSpot or live CRM feed." },
    }),
    createWorkshopObject({
      id: "robot-bay-main",
      type: "robot-bay",
      label: "Robotics sim bay",
      pose: { x: 0, y: 0.8, z: robotBay.markerHeight / 2, yaw: 0 },
      dimensions: robotBay,
      metadata: {
        anchors: ["OpenArm", "MuJoCo", "Isaac"],
      },
    }),
    createWorkshopObject({
      id: "wiring-bay-main",
      type: "wiring-bay",
      label: "Wiring bay",
      pose: { x: 6.2, y: 4.9, z: wiringBay.markerHeight / 2, yaw: 0 },
      dimensions: wiringBay,
    }),
    createWorkshopObject({
      id: "dj-zone-main",
      type: "dj-zone",
      label: "DJ handoff zone",
      pose: { x: -6.2, y: 4.9, z: djZone.markerHeight / 2, yaw: 0 },
      dimensions: djZone,
      metadata: {
        voiceCue: "Hey DJ",
      },
    }),
  );

  return {
    version: WORKSHOP_LAYOUT_VERSION,
    units: {
      linear: WORKSHOP_LINEAR_UNIT,
      angle: WORKSHOP_ANGLE_UNIT,
      scene_unit_m: WORKSHOP_SCENE_UNIT_METERS,
    },
    warehouse: { ...WORKSHOP_DIMENSIONS_M.warehouse },
    objects,
  };
}

export function normalizeWorkshopLayout(input) {
  const fallback = buildDefaultWorkshopLayout();
  const value = input && typeof input === "object" ? input : {};
  const fallbackById = new Map(fallback.objects.map((item) => [item.id, item]));
  const inputObjects = Array.isArray(value.objects) ? value.objects : [];
  const objects = inputObjects.length
    ? inputObjects.map((item, index) => {
      const raw = item && typeof item === "object" ? item : {};
      const preset = WORKSHOP_PLACE_PRESETS.find((entry) => entry.type === raw.type) || null;
      const fallbackItem = fallbackById.get(String(raw.id || "")) || preset || fallback.objects[index] || fallback.objects[0];
      return createWorkshopObject({
        id: String(raw.id || fallbackItem.id || nextWorkshopObjectId(raw.type || preset?.type || "item", inputObjects)),
        type: String(raw.type || fallbackItem.type || preset?.type || "desk"),
        label: String(raw.label || fallbackItem.label || preset?.label || "Workshop item"),
        pose: raw.pose || fallbackItem.pose,
        dimensions: normalizeDimensions(raw.dimensions || fallbackItem.dimensions, fallbackItem.dimensions),
        streamSlot: raw.streamSlot || fallbackItem.streamSlot || preset?.streamSlot || "",
        seatId: raw.seatId || fallbackItem.seatId || "",
        metadata: raw.metadata || fallbackItem.metadata || {},
      });
    })
    : fallback.objects;
  const existingIds = new Set(objects.map((item) => item.id));
  const mergedObjects = [
    ...objects,
    ...fallback.objects.filter((item) => !existingIds.has(item.id)),
  ];

  return {
    version: WORKSHOP_LAYOUT_VERSION,
    units: {
      linear: WORKSHOP_LINEAR_UNIT,
      angle: WORKSHOP_ANGLE_UNIT,
      scene_unit_m: WORKSHOP_SCENE_UNIT_METERS,
    },
    warehouse: { ...WORKSHOP_DIMENSIONS_M.warehouse, ...(value.warehouse || {}) },
    objects: mergedObjects,
  };
}

export function buildDefaultWorkshopIde() {
  return {
    activeFileId: "room-notes",
    files: [
      {
        id: "room-notes",
        label: "room-notes.md",
        language: "markdown",
        content: "# Workshop room notes\n\n- Room starts in meters.\n- Update this file with placement notes and partner handoffs.\n",
      },
      {
        id: "handoff-log",
        label: "handoff-log.txt",
        language: "text",
        content: "Selected partner updates will land here.\n",
      },
      {
        id: "teach-assemble",
        label: "teach-assemble-from-sketchup.md",
        language: "markdown",
        content:
          "# Teach assemble from SketchUp\n\n"
          + "Collaborators: Projects Manager, Code Bot, Concrete CAD\n\n"
          + "## Prompt templates\n"
          + "- Import: Bring the SketchUp source in and label real reference edges.\n"
          + "- Constrain: Lock floor, bay, and desk clearances before edits.\n"
          + "- Redesign: Rewrite the assembly for a cleaner room-ready layout.\n"
          + "- Build export: Produce the handoff prompt and export package.\n",
      },
      {
        id: "sim-plan",
        label: "sim-plan.json",
        language: "json",
        content: JSON.stringify({
          robotBay: "OpenArm anchor",
          wiringBay: "Use Workshop > Wiring Sim",
        }, null, 2),
      },
    ],
  };
}

export function normalizeWorkshopIde(input) {
  const fallback = buildDefaultWorkshopIde();
  const value = input && typeof input === "object" ? input : {};
  const files = Array.isArray(value.files) && value.files.length
    ? value.files
      .filter((file) => file && typeof file === "object")
      .map((file, index) => ({
        id: String(file.id || `file-${index + 1}`),
        label: String(file.label || `file-${index + 1}.txt`),
        language: String(file.language || "text"),
        content: String(file.content || ""),
      }))
    : fallback.files;
  const byId = new Set(files.map((file) => file.id));
  const mergedFiles = [
    ...files,
    ...fallback.files.filter((file) => !byId.has(file.id)),
  ];
  const activeFileId = mergedFiles.some((file) => file.id === value.activeFileId)
    ? value.activeFileId
    : mergedFiles[0]?.id || fallback.activeFileId;
  return { activeFileId, files: mergedFiles };
}

export function exportWorkshopLayout(layout, extra = {}) {
  const normalized = normalizeWorkshopLayout(layout);
  return {
    version: WORKSHOP_LAYOUT_VERSION,
    exported_at: new Date().toISOString(),
    units: { ...normalized.units },
    warehouse: { ...normalized.warehouse },
    objects: normalized.objects.map((item) => ({
      id: item.id,
      type: item.type,
      label: item.label,
      pose: { ...item.pose },
      dimensions: { ...item.dimensions },
      seat_id: item.seatId || undefined,
      stream_slot: item.streamSlot || undefined,
      metadata: item.metadata && Object.keys(item.metadata).length ? { ...item.metadata } : undefined,
    })),
    ...extra,
  };
}
