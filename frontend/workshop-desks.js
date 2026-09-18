export const WORKSHOP_SEAT_OPTIONS = [
  {
    id: "sam",
    label: "Sam",
    summary: "P0 approvals, receipt review, and merge sequencing.",
  },
  {
    id: "code-bot",
    label: "Code Bot",
    summary: "Patch queue, diffs, and follow-up fixes.",
  },
  {
    id: "projects-manager",
    label: "Projects Manager",
    summary: "Architecture trial queue and SketchUp to CAD teaching.",
  },
  {
    id: "concrete-cad",
    label: "Concrete CAD",
    summary: "Dimensional layouts, bays, and buildable clearances.",
  },
  {
    id: "sales",
    label: "Sales",
    summary: "Interactions rail, follow-ups, and deal status.",
  },
  {
    id: "astra",
    label: "Astra",
    summary: "Voice partner stub seat for spoken workshop prompts.",
  },
];

export const WORKSHOP_DESKS = [
  {
    id: "sam",
    label: "Sam",
    zone: "Front rail",
    desk: { kind: "straight", width: 1.6, depth: 0.8, height: 0.74 },
    pose: { x: -5.6, y: 2.3, z: 0, yaw: 0 },
    accent: "#60a5fa",
    monitorAccent: "#60a5fa",
    monitors: [
      {
        id: "sam-release-rail",
        title: "Release rail",
        size: { width: 0.56, height: 0.32 },
        offset: { x: 0, y: -0.21, z: 1.18 },
        lines: ["P0 receipt check", "Guard: waiting", "Merge order #11 > #9"],
      },
    ],
    panel: {
      eyebrow: "Approvals",
      title: "Sam review rail",
      bullets: [
        "Checks fleet receipts before anything is considered ready.",
        "Keeps merge order pinned: #11, then #9, then feature follow-ons.",
        "Owns the final read of red/yellow guard notes.",
      ],
    },
  },
  {
    id: "code-bot",
    label: "Code Bot",
    zone: "Front rail",
    desk: { kind: "straight", width: 1.6, depth: 0.8, height: 0.74 },
    pose: { x: -5.6, y: -0.1, z: 0, yaw: 0 },
    accent: "#22c55e",
    monitorAccent: "#22c55e",
    monitors: [
      {
        id: "code-bot-patch-queue",
        title: "Patch queue",
        size: { width: 0.54, height: 0.31 },
        offset: { x: 0, y: -0.2, z: 1.17 },
        lines: ["Ready: workshop desks", "Next: receipt wiring", "Focus: smallest diff"],
      },
    ],
    panel: {
      eyebrow: "Execution",
      title: "Code Bot patch queue",
      bullets: [
        "Carries additive modules and keeps the god-files thin.",
        "Ships receipt notes back to the desk roster after each pass.",
      ],
    },
  },
  {
    id: "projects-manager",
    label: "Projects Manager",
    zone: "Corner command",
    desk: { kind: "corner", width: 2.5, depth: 1.8, height: 0.74, returnWidth: 1.5, returnDepth: 0.8 },
    pose: { x: 4.85, y: 5.2, z: 0, yaw: Math.PI },
    accent: "#f59e0b",
    monitorAccent: "#f59e0b",
    monitors: [
      {
        id: "pm-architecture-queue",
        title: "Architecture trial queue",
        size: { width: 0.62, height: 0.35 },
        offset: { x: 0.18, y: -0.26, z: 1.22 },
        lines: ["3ft bay trials", "Pending: room paths", "Need: smoke check"],
      },
      {
        id: "pm-teach-board",
        title: "SketchUp -> CAD teach board",
        size: { width: 0.62, height: 0.35 },
        offset: { x: -0.56, y: -0.22, z: 1.2 },
        lines: ["Import flow", "Footprint clean-up", "Constraint handoff"],
      },
      {
        id: "pm-wrap-monitor",
        title: "Wrap monitor",
        size: { width: 0.62, height: 0.35 },
        offset: { x: 0.84, y: 0.34, z: 1.18 },
        yawOffset: -Math.PI / 2,
        lines: ["PR watch", "Guard notes", "Workshop blockers"],
      },
    ],
    panel: {
      eyebrow: "Planning",
      title: "PM command corner",
      bullets: [
        "Large corner desk anchors architecture planning and PR triage.",
        "Wrap monitors keep trials, teach-board notes, and blocker rails visible at once.",
      ],
    },
  },
  {
    id: "concrete-cad",
    label: "Concrete CAD",
    zone: "North wall",
    desk: { kind: "straight", width: 1.8, depth: 0.8, height: 0.74 },
    pose: { x: 0.4, y: 6.15, z: 0, yaw: Math.PI },
    accent: "#a78bfa",
    monitorAccent: "#a78bfa",
    monitors: [
      {
        id: "concrete-cad-layouts",
        title: "Bay layouts",
        size: { width: 0.58, height: 0.33 },
        offset: { x: 0, y: -0.2, z: 1.19 },
        lines: ["True scale meters", "Wall + aisle checks", "Export JSON ready"],
      },
    ],
    panel: {
      eyebrow: "CAD",
      title: "Concrete CAD desk",
      bullets: [
        "Keeps layouts meter-true and ready for downstream exports.",
        "Tracks fixture spacing, aisle clearances, and placement fidelity.",
      ],
    },
  },
  {
    id: "sales",
    label: "Sales",
    zone: "South wall",
    desk: { kind: "straight", width: 1.6, depth: 0.8, height: 0.74 },
    pose: { x: 4.2, y: -4.8, z: 0, yaw: Math.PI },
    accent: "#ec4899",
    monitorAccent: "#ec4899",
    monitors: [
      {
        id: "sales-interactions",
        title: "Sales interactions",
        size: { width: 0.6, height: 0.34 },
        offset: { x: 0, y: -0.2, z: 1.2 },
        lines: ["3 follow-ups today", "2 demos booked", "1 P0 escalation"],
      },
    ],
    panel: {
      eyebrow: "Revenue",
      title: "Sales interactions monitor",
      bullets: [
        "Shows mock interactions, demos, and escalations for the room.",
        "Acts as the handoff point when product requests become desk work.",
      ],
    },
  },
];

const LEGACY_AGENT_IDS = new Set(["floor-lead", "printer-tech", "review-assistant"]);

export function workshopUsesLegacyAgents(agents = []) {
  if (!Array.isArray(agents) || !agents.length) return false;
  return agents.every((entry) => LEGACY_AGENT_IDS.has(String(entry?.id || "")));
}

export function workshopMockAgents() {
  return [
    {
      id: "sam",
      name: "Sam",
      status: "Reviewing",
      tasks: [
        { id: "sam-receipt", title: "Read the latest fleet receipt", status: "active" },
        { id: "sam-order", title: "Keep merge order pinned", status: "ready" },
      ],
    },
    {
      id: "code-bot",
      name: "Code Bot",
      status: "Patching",
      tasks: [
        { id: "code-bot-diff", title: "Wire the Workshop desk follow-up", status: "active" },
        { id: "code-bot-cache", title: "Bump cache-busts for touched assets", status: "queued" },
      ],
    },
    {
      id: "projects-manager",
      name: "Projects Manager",
      status: "Sequencing",
      tasks: [
        { id: "pm-queue", title: "Sort architecture trial queue", status: "active" },
        { id: "pm-teach", title: "Refresh SketchUp to CAD board", status: "queued" },
      ],
    },
    {
      id: "concrete-cad",
      name: "Concrete CAD",
      status: "Checking scale",
      tasks: [
        { id: "concrete-layout", title: "Verify meter-true desk layout", status: "active" },
      ],
    },
    {
      id: "sales",
      name: "Sales",
      status: "Following up",
      tasks: [
        { id: "sales-intake", title: "Watch sales interactions monitor", status: "active" },
      ],
    },
    {
      id: "astra",
      name: "Astra",
      status: "Stub voice seat",
      tasks: [
        { id: "astra-voice", title: "Stand by for spoken workshop prompts", status: "ready" },
      ],
    },
  ];
}

export function getWorkshopSeat(id) {
  return WORKSHOP_SEAT_OPTIONS.find((entry) => entry.id === id) || WORKSHOP_SEAT_OPTIONS[0];
}

export function buildWorkshopLayoutExport({
  projectId = "",
  projectName = "Project",
  partnerSeatId = "sam",
  voiceSeatId = "astra",
  placedItems = [],
}) {
  return {
    kind: "render-studio-workshop-layout",
    units: "meters",
    project_id: projectId || null,
    project_name: projectName || "Project",
    exported_at: new Date().toISOString(),
    session: {
      partner_seat_id: partnerSeatId,
      voice_seat_id: voiceSeatId,
    },
    room: {
      width_m: 18,
      depth_m: 18,
      wall_height_m: 4.6,
    },
    desks: WORKSHOP_DESKS.map((desk) => ({
      id: desk.id,
      label: desk.label,
      zone: desk.zone,
      kind: desk.desk.kind,
      pose: {
        x: desk.pose.x,
        y: desk.pose.y,
        z: desk.pose.z,
        yaw: desk.pose.yaw,
      },
      desk: { ...desk.desk },
      monitors: (desk.monitors || []).map((monitor) => ({
        id: monitor.id,
        title: monitor.title,
        size: { ...monitor.size },
        offset: { ...monitor.offset },
        yaw_offset: monitor.yawOffset || 0,
      })),
    })),
    placed_items: (placedItems || []).map((item) => ({
      id: item.id,
      preset_id: item.preset_id,
      label: item.label,
      position: item.position ? { ...item.position } : null,
      rotation: item.rotation ? { ...item.rotation } : null,
    })),
  };
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function makeScreenTexture(title, lines = [], accent = "#60a5fa") {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 576;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#08111d";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  grad.addColorStop(0, "rgba(96,165,250,0.22)");
  grad.addColorStop(1, "rgba(8,17,29,0.95)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, canvas.width, 18);
  ctx.fillStyle = "#dbeafe";
  ctx.font = "700 56px Inter, Arial, sans-serif";
  ctx.fillText(title, 52, 92);
  ctx.font = "500 34px Inter, Arial, sans-serif";
  lines.slice(0, 4).forEach((line, index) => {
    ctx.fillStyle = index === 0 ? "#eff6ff" : "#bfdbfe";
    ctx.fillText(String(line || ""), 52, 188 + index * 76);
  });
  ctx.strokeStyle = "rgba(191,219,254,0.36)";
  ctx.lineWidth = 4;
  ctx.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);
  return canvas;
}

function addLeg(group, THREE, x, y, height, color = 0x475569) {
  const leg = new THREE.Mesh(
    new THREE.BoxGeometry(0.07, 0.07, Math.max(0.2, height - 0.06)),
    new THREE.MeshStandardMaterial({ color, roughness: 0.74, metalness: 0.16 }),
  );
  leg.position.set(x, y, (height - 0.06) * 0.5);
  group.add(leg);
}

function buildDeskMesh(THREE, spec) {
  const root = new THREE.Group();
  const topMaterial = new THREE.MeshStandardMaterial({ color: 0x8b5e3c, roughness: 0.72, metalness: 0.06 });
  const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.74, metalness: 0.16 });
  const topThickness = 0.06;
  if (spec.kind === "corner") {
    const longTop = new THREE.Mesh(new THREE.BoxGeometry(spec.width, spec.depth, topThickness), topMaterial);
    longTop.position.set(0, 0, spec.height - topThickness * 0.5);
    root.add(longTop);
    const returnTop = new THREE.Mesh(new THREE.BoxGeometry(spec.returnWidth, spec.returnDepth, topThickness), topMaterial);
    returnTop.position.set((spec.width - spec.returnWidth) * 0.5, (spec.depth - spec.returnDepth) * 0.5, spec.height - topThickness * 0.5);
    root.add(returnTop);
    addLeg(root, THREE, -spec.width * 0.45, -spec.depth * 0.38, spec.height);
    addLeg(root, THREE, spec.width * 0.45, -spec.depth * 0.38, spec.height);
    addLeg(root, THREE, -spec.width * 0.45, spec.depth * 0.38, spec.height);
    addLeg(root, THREE, spec.width * 0.16, spec.depth * 0.38, spec.height);
    addLeg(root, THREE, spec.width * 0.46, spec.depth * 0.12, spec.height);
  } else {
    const top = new THREE.Mesh(new THREE.BoxGeometry(spec.width, spec.depth, topThickness), topMaterial);
    top.position.set(0, 0, spec.height - topThickness * 0.5);
    root.add(top);
    addLeg(root, THREE, -spec.width * 0.44, -spec.depth * 0.38, spec.height);
    addLeg(root, THREE, spec.width * 0.44, -spec.depth * 0.38, spec.height);
    addLeg(root, THREE, -spec.width * 0.44, spec.depth * 0.38, spec.height);
    addLeg(root, THREE, spec.width * 0.44, spec.depth * 0.38, spec.height);
  }
  const modesty = new THREE.Mesh(
    new THREE.BoxGeometry(Math.max(0.3, spec.width * 0.68), 0.03, 0.34),
    baseMaterial,
  );
  modesty.position.set(0, spec.depth * 0.3, 0.42);
  root.add(modesty);
  return root;
}

function buildDeskLabel(THREE, desk) {
  const canvas = makeScreenTexture(desk.label, [desk.zone, `${desk.desk.width.toFixed(1)}m x ${desk.desk.depth.toFixed(1)}m`], desk.accent);
  if (!canvas) return null;
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 0.56), material);
  plane.position.set(0, desk.desk.depth * 0.6, 1.7);
  plane.rotation.x = Math.PI / 2;
  return plane;
}

function buildMonitor(THREE, desk, monitor) {
  const group = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(monitor.size.width + 0.06, 0.05, monitor.size.height + 0.06),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.46, metalness: 0.16 }),
  );
  group.add(shell);
  const screenCanvas = makeScreenTexture(monitor.title, monitor.lines || [], desk.monitorAccent);
  const screenTexture = screenCanvas ? new THREE.CanvasTexture(screenCanvas) : null;
  if (screenTexture) screenTexture.needsUpdate = true;
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(monitor.size.width, 0.012, monitor.size.height),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: screenTexture || null,
      emissive: 0x1d4ed8,
      emissiveMap: screenTexture || null,
      emissiveIntensity: 0.6,
      roughness: 0.3,
      metalness: 0.1,
    }),
  );
  screen.position.y = -0.03;
  group.add(screen);
  const stand = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.05, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7 }),
  );
  stand.position.set(0, 0, -monitor.size.height * 0.5 + 0.12);
  group.add(stand);
  const base = new THREE.Mesh(
    new THREE.BoxGeometry(0.22, 0.15, 0.025),
    new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.74 }),
  );
  base.position.set(0, 0.02, -monitor.size.height * 0.5 + 0.015);
  group.add(base);
  group.position.set(monitor.offset.x, monitor.offset.y, monitor.offset.z);
  group.rotation.y = monitor.yawOffset || 0;
  group.userData.workshopDeskId = desk.id;
  group.userData.workshopMonitorId = monitor.id;
  group.userData.workshopClickable = "monitor";
  group.traverse((child) => {
    child.userData.workshopDeskId = desk.id;
    child.userData.workshopMonitorId = monitor.id;
    child.userData.workshopClickable = "monitor";
    child.castShadow = true;
    child.receiveShadow = true;
  });
  return group;
}

export function createWorkshopDeskScene(THREE) {
  const root = new THREE.Group();
  root.name = "workshop-desk-layout";
  const clickables = [];
  const deskHighlights = new Map();
  WORKSHOP_DESKS.forEach((desk) => {
    const deskGroup = new THREE.Group();
    deskGroup.name = `workshop-desk-${desk.id}`;
    deskGroup.position.set(desk.pose.x, desk.pose.y, desk.pose.z);
    deskGroup.rotation.z = desk.pose.yaw;
    deskGroup.userData.workshopDeskId = desk.id;
    deskGroup.userData.workshopClickable = "desk";
    const deskMesh = buildDeskMesh(THREE, desk.desk);
    deskGroup.add(deskMesh);
    const label = buildDeskLabel(THREE, desk);
    if (label) deskGroup.add(label);
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.52, 0.74, 42),
      new THREE.MeshBasicMaterial({ color: desk.accent, transparent: true, opacity: 0.18, side: THREE.DoubleSide }),
    );
    halo.position.set(0, 0, 0.02);
    halo.rotation.x = Math.PI / 2;
    halo.visible = false;
    deskGroup.add(halo);
    (desk.monitors || []).forEach((monitor) => {
      const node = buildMonitor(THREE, desk, monitor);
      deskGroup.add(node);
      clickables.push(node);
    });
    deskGroup.traverse((child) => {
      child.userData.workshopDeskId = desk.id;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    clickables.push(deskGroup);
    deskHighlights.set(desk.id, halo);
    root.add(deskGroup);
  });
  const voiceBooth = new THREE.Group();
  voiceBooth.position.set(6.2, -0.3, 0);
  const stand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.28, 1.08, 24),
    new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.72, metalness: 0.16 }),
  );
  stand.position.z = 0.54;
  voiceBooth.add(stand);
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 24, 24),
    new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0e7490, emissiveIntensity: 0.7, roughness: 0.28 }),
  );
  orb.position.set(0, -0.05, 1.18);
  voiceBooth.add(orb);
  const label = buildDeskLabel(THREE, {
    label: "Astra",
    zone: "Voice booth",
    accent: "#22d3ee",
    desk: { width: 0.8, depth: 0.8 },
  });
  if (label) {
    label.position.set(0, 0.42, 1.6);
    voiceBooth.add(label);
  }
  root.add(voiceBooth);
  return {
    group: root,
    clickables,
    setActiveDesk(deskId = "") {
      deskHighlights.forEach((halo, id) => {
        halo.visible = id === deskId;
      });
    },
  };
}

export function renderWorkshopDeskCards({ selectedDeskId = "", partnerSeatId = "sam", voiceSeatId = "astra" } = {}) {
  return WORKSHOP_DESKS.map((desk) => {
    const partnerTag = partnerSeatId === desk.id ? `<span class="workshop-pill">Partner seat</span>` : "";
    const voiceTag = voiceSeatId === desk.id ? `<span class="workshop-pill workshop-pill--approved">Voice seat</span>` : "";
    return `
      <article class="workshop-card workshop-desk-card${selectedDeskId === desk.id ? " workshop-desk-card--active" : ""}">
        <div class="workshop-card-head">
          <div>
            <strong>${esc(desk.label)}</strong>
            <p class="workshop-desk-meta">${esc(desk.zone)} · ${desk.desk.width.toFixed(1)}m x ${desk.desk.depth.toFixed(1)}m</p>
          </div>
          <div class="workshop-inline-actions">
            ${partnerTag}
            ${voiceTag}
            <button type="button" class="btn secondary btn-compact" data-workshop-focus-desk="${esc(desk.id)}">Focus</button>
          </div>
        </div>
        <p class="workshop-desk-eyebrow">${esc(desk.panel.eyebrow)}</p>
        <strong class="workshop-desk-title">${esc(desk.panel.title)}</strong>
        <ul class="workshop-desk-bullets">
          ${desk.panel.bullets.map((item) => `<li>${esc(item)}</li>`).join("")}
        </ul>
        <div class="workshop-monitor-list">
          ${(desk.monitors || []).map((monitor) => `
            <button type="button" class="workshop-monitor-chip" data-workshop-focus-desk="${esc(desk.id)}">
              <strong>${esc(monitor.title)}</strong>
              <span>${esc((monitor.lines || []).join(" · "))}</span>
            </button>
          `).join("")}
        </div>
      </article>
    `;
  }).join("");
}

export function renderWorkshopSeatPicker({ partnerSeatId = "sam", voiceSeatId = "astra" } = {}) {
  const seatButtons = (kind, currentId) => WORKSHOP_SEAT_OPTIONS.map((seat) => `
    <button
      type="button"
      class="workshop-seat-option${currentId === seat.id ? " active" : ""}"
      data-workshop-seat-kind="${esc(kind)}"
      data-workshop-seat-id="${esc(seat.id)}"
    >
      <strong>${esc(seat.label)}</strong>
      <span>${esc(seat.summary)}</span>
    </button>
  `).join("");
  return `
    <div class="workshop-seat-picker">
      <div class="workshop-seat-picker-card">
        <span class="workshop-kicker">On enter</span>
        <h3>Pick a partner seat and voice seat</h3>
        <p>Choose who owns the room and where spoken workshop prompts should land. Astra stays a stub voice seat for now.</p>
        <div class="workshop-seat-columns">
          <section>
            <strong class="workshop-seat-heading">Partner seat</strong>
            <div class="workshop-seat-grid">${seatButtons("partner", partnerSeatId)}</div>
          </section>
          <section>
            <strong class="workshop-seat-heading">Voice seat</strong>
            <div class="workshop-seat-grid">${seatButtons("voice", voiceSeatId)}</div>
          </section>
        </div>
        <div class="workshop-inline-actions">
          <button type="button" class="btn accent btn-compact" data-workshop-seat-confirm>Enter Workshop</button>
        </div>
      </div>
    </div>
  `;
}
