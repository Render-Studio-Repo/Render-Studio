export const WORKSHOP_CONFERENCE_SEATS = [
  {
    id: "projects-manager",
    label: "Projects Manager",
    summary: "Owns the topic, accept bars, and merge sequencing.",
    shift: "Control shift",
    skills: ["accept bars", "merge order", "notes triage"],
    accent: "#f59e0b",
    pose: { x: 4.8, y: 1.82, z: 0, yaw: Math.PI },
  },
  {
    id: "code-bot",
    label: "Code Bot",
    summary: "Keeps patches additive and the wiring thin.",
    shift: "Patch shift",
    skills: ["frontend wiring", "cache busts", "diff trim"],
    accent: "#22c55e",
    pose: { x: 2.92, y: 0.34, z: 0, yaw: Math.PI / 2 },
  },
  {
    id: "cad",
    label: "CAD",
    summary: "Checks true-scale layout, clearances, and fixtures.",
    shift: "Scale shift",
    skills: ["meters", "clearances", "placement fidelity"],
    accent: "#a78bfa",
    pose: { x: 3.64, y: -1.86, z: 0, yaw: 0.28 },
  },
  {
    id: "harness",
    label: "Harness",
    summary: "Tracks UPDATE_RECEIPT handoff and guard artifacts.",
    shift: "Guard shift",
    skills: ["UPDATE_RECEIPT", "receipt reads", "FAIL loops"],
    accent: "#ef4444",
    pose: { x: 5.96, y: -1.86, z: 0, yaw: -0.28 },
  },
  {
    id: "rnd",
    label: "RnD",
    summary: "Runs stubbed sandbox experiments and follow-up spikes.",
    shift: "Sandbox shift",
    skills: ["free-reign trials", "stubs", "follow-up spikes"],
    accent: "#38bdf8",
    pose: { x: 6.68, y: 0.34, z: 0, yaw: -Math.PI / 2 },
  },
];

const LIGHTING_PRESETS = [
  { id: "review", label: "Review focus", summary: "Warm front light, bright table." },
  { id: "standup", label: "Standup", summary: "Wide room wash for quick syncs." },
  { id: "focus", label: "Deep focus", summary: "Dim room, cool rack glow." },
];

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toBool(value, fallback = false) {
  return value == null ? fallback : !!value;
}

function clampInt(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function defaultPluginModules() {
  return {
    tv_feed: {
      enabled: true,
      label: "TV feed stub",
      stub: true,
      source_note: "No live TV feed is wired yet; this is an explicit stub surface.",
    },
    lighting: {
      enabled: true,
      label: "Lighting presets stub",
      stub: true,
      preset: "review",
      preset_options: LIGHTING_PRESETS.map((entry) => entry.id),
    },
    timers: {
      enabled: true,
      label: "Conference timers",
      stub: false,
      duration_seconds: 900,
      remaining_seconds: 900,
      running: false,
      started_at: null,
    },
    shift_skills: {
      enabled: true,
      label: "Static shift + skills roster",
      stub: false,
      roster_source: "static",
    },
    notes: {
      enabled: true,
      label: "Sandbox notes markdown",
      stub: false,
      notes_path: null,
      kb_entry_path: null,
    },
    free_reign: {
      enabled: true,
      label: "Sandbox checkpoint stub",
      stub: true,
      last_checkpoint_path: null,
    },
  };
}

function normalizePluginModules(input = {}) {
  const seed = defaultPluginModules();
  const next = clone(seed);
  const data = input && typeof input === "object" ? input : {};
  const tv = data.tv_feed && typeof data.tv_feed === "object" ? data.tv_feed : {};
  const lighting = data.lighting && typeof data.lighting === "object" ? data.lighting : {};
  const timers = data.timers && typeof data.timers === "object" ? data.timers : {};
  const shiftSkills = data.shift_skills && typeof data.shift_skills === "object" ? data.shift_skills : {};
  const notes = data.notes && typeof data.notes === "object" ? data.notes : {};
  const freeReign = data.free_reign && typeof data.free_reign === "object" ? data.free_reign : {};
  next.tv_feed.enabled = toBool(tv.enabled, true);
  next.lighting.enabled = toBool(lighting.enabled, true);
  next.lighting.preset = LIGHTING_PRESETS.some((entry) => entry.id === lighting.preset) ? lighting.preset : "review";
  next.timers.enabled = toBool(timers.enabled, true);
  next.timers.duration_seconds = clampInt(timers.duration_seconds, 900, 5, 86400);
  next.timers.remaining_seconds = clampInt(
    timers.remaining_seconds,
    next.timers.duration_seconds,
    0,
    86400,
  );
  next.timers.running = toBool(timers.running, false) && !!timers.started_at;
  next.timers.started_at = next.timers.running ? String(timers.started_at) : null;
  next.shift_skills.enabled = toBool(shiftSkills.enabled, true);
  next.notes.enabled = toBool(notes.enabled, true);
  next.notes.notes_path = notes.notes_path ? String(notes.notes_path) : null;
  next.notes.kb_entry_path = notes.kb_entry_path ? String(notes.kb_entry_path) : null;
  next.free_reign.enabled = toBool(freeReign.enabled, true);
  next.free_reign.last_checkpoint_path = freeReign.last_checkpoint_path ? String(freeReign.last_checkpoint_path) : null;
  return next;
}

export function normalizeConferenceState(input = {}, { projectId = "", projectName = "Project" } = {}) {
  const value = input && typeof input === "object" ? input : {};
  const attendees = Array.isArray(value.attendees)
    ? value.attendees.filter((seatId) => WORKSHOP_CONFERENCE_SEATS.some((seat) => seat.id === seatId))
    : [];
  return {
    room_id: String(value.room_id || "conference-room-v1"),
    room_label: String(value.room_label || "Workshop conference room"),
    active_project_id: String(value.active_project_id || projectId || ""),
    project_label: String(value.project_label || projectName || "Project"),
    active_session_id: value.active_session_id ? String(value.active_session_id) : null,
    topic: String(value.topic || ""),
    attendees,
    notes_markdown: String(value.notes_markdown || ""),
    session_json_path: value.session_json_path ? String(value.session_json_path) : null,
    latest_session_path: value.latest_session_path ? String(value.latest_session_path) : null,
    notes_path: value.notes_path ? String(value.notes_path) : null,
    kb_entry_path: value.kb_entry_path ? String(value.kb_entry_path) : null,
    updated_at: value.updated_at ? String(value.updated_at) : null,
    plugin_modules: normalizePluginModules(value.plugin_modules),
  };
}

export function getConferenceSeats() {
  return WORKSHOP_CONFERENCE_SEATS.map((seat) => ({ ...seat, pose: { ...seat.pose }, skills: [...seat.skills] }));
}

function makeCanvasTexture(THREE, title, lines = [], accent = "#60a5fa") {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  grad.addColorStop(0, "rgba(17,24,39,0.98)");
  grad.addColorStop(1, "rgba(8,17,29,0.96)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, canvas.width, 20);
  ctx.strokeStyle = "rgba(148,163,184,0.32)";
  ctx.lineWidth = 4;
  ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);
  ctx.fillStyle = "#eff6ff";
  ctx.font = "700 62px Inter, Arial, sans-serif";
  ctx.fillText(String(title || ""), 52, 98);
  ctx.font = "500 32px Inter, Arial, sans-serif";
  lines.slice(0, 4).forEach((line, index) => {
    ctx.fillStyle = index === 0 ? "#dbeafe" : "#bfdbfe";
    ctx.fillText(String(line || ""), 52, 182 + index * 74);
  });
  return new THREE.CanvasTexture(canvas);
}

function buildLabel(THREE, width, height, title, lines, accent) {
  const texture = makeCanvasTexture(THREE, title, lines, accent);
  if (!texture) return null;
  texture.needsUpdate = true;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
  );
}

function buildChair(THREE, seat) {
  const group = new THREE.Group();
  const seatBase = new THREE.Mesh(
    new THREE.BoxGeometry(0.64, 0.6, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.76 }),
  );
  seatBase.position.z = 0.52;
  group.add(seatBase);
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(0.64, 0.08, 0.72),
    new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.72 }),
  );
  back.position.set(0, 0.26, 0.86);
  group.add(back);
  const cushion = new THREE.Mesh(
    new THREE.BoxGeometry(0.58, 0.54, 0.05),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(seat.accent), roughness: 0.58 }),
  );
  cushion.position.z = 0.59;
  group.add(cushion);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.06, 0.52),
        new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.82 }),
      );
      leg.position.set(sx * 0.25, sy * 0.22, 0.26);
      group.add(leg);
    }
  }
  const plaque = buildLabel(
    THREE,
    0.78,
    0.26,
    seat.label,
    [seat.shift, seat.skills.slice(0, 2).join(" · ")],
    seat.accent,
  );
  if (plaque) {
    plaque.position.set(0, -0.47, 1.18);
    plaque.rotation.x = -Math.PI / 6;
    group.add(plaque);
  }
  return group;
}

function buildPluginRack(THREE) {
  const group = new THREE.Group();
  const cabinet = new THREE.Mesh(
    new THREE.BoxGeometry(1.28, 0.54, 1.92),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.48, metalness: 0.18 }),
  );
  cabinet.position.z = 0.96;
  group.add(cabinet);
  const display = new THREE.Mesh(
    new THREE.BoxGeometry(1.76, 0.08, 0.98),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.34 }),
  );
  display.position.set(0, -0.35, 1.56);
  display.userData.workshopConferenceTarget = "rack";
  group.add(display);
  const screen = buildLabel(
    THREE,
    1.56,
    0.82,
    "Plugin rack",
    ["TV · lights · timers", "skills roster · notes", "free-reign stub"],
    "#38bdf8",
  );
  if (screen) {
    screen.position.set(0, -0.4, 1.56);
    group.add(screen);
  }
  for (const x of [-0.42, 0, 0.42]) {
    const lightBar = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.18, 0.64),
      new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0x78350f, emissiveIntensity: 0.48, roughness: 0.22 }),
    );
    lightBar.position.set(x, 0.24, 1.46);
    lightBar.userData.workshopConferenceTarget = "rack";
    group.add(lightBar);
  }
  return group;
}

export function createWorkshopConferenceScene(THREE) {
  const group = new THREE.Group();
  group.name = "workshop-conference-suite";
  const clickables = [];
  const seatHalos = new Map();

  const rug = new THREE.Mesh(
    new THREE.BoxGeometry(5.8, 4.6, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.96 }),
  );
  rug.position.set(4.8, -0.12, 0.015);
  rug.userData.workshopConferenceTarget = "room";
  group.add(rug);
  clickables.push(rug);

  const table = new THREE.Mesh(
    new THREE.BoxGeometry(3.26, 1.68, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x8b5e3c, roughness: 0.72 }),
  );
  table.position.set(4.8, -0.12, 0.78);
  table.userData.workshopConferenceTarget = "room";
  group.add(table);
  clickables.push(table);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.09, 0.09, 0.72),
        new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.78 }),
      );
      leg.position.set(4.8 + sx * 1.46, -0.12 + sy * 0.66, 0.36);
      leg.userData.workshopConferenceTarget = "room";
      group.add(leg);
    }
  }
  const tableLabel = buildLabel(
    THREE,
    1.3,
    0.42,
    "Conference room",
    ["3.3m x 1.7m table", "Five fixed agent seats"],
    "#f59e0b",
  );
  if (tableLabel) {
    tableLabel.position.set(4.8, -0.12, 1.26);
    tableLabel.rotation.x = -Math.PI / 2.4;
    group.add(tableLabel);
  }

  WORKSHOP_CONFERENCE_SEATS.forEach((seat) => {
    const chair = buildChair(THREE, seat);
    chair.position.set(seat.pose.x, seat.pose.y, seat.pose.z);
    chair.rotation.z = seat.pose.yaw;
    chair.userData.workshopConferenceTarget = "room";
    chair.userData.workshopConferenceSeatId = seat.id;
    chair.traverse((child) => {
      child.userData.workshopConferenceTarget = "room";
      child.userData.workshopConferenceSeatId = seat.id;
      child.castShadow = true;
      child.receiveShadow = true;
    });
    const halo = new THREE.Mesh(
      new THREE.RingGeometry(0.34, 0.48, 36),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(seat.accent),
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
      }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.set(seat.pose.x, seat.pose.y, 0.04);
    halo.visible = false;
    halo.userData.workshopConferenceTarget = "room";
    halo.userData.workshopConferenceSeatId = seat.id;
    seatHalos.set(seat.id, halo);
    group.add(halo);
    group.add(chair);
    clickables.push(chair);
  });

  const rackGroup = buildPluginRack(THREE);
  rackGroup.position.set(7.18, 1.86, 0);
  rackGroup.userData.workshopConferenceTarget = "rack";
  rackGroup.traverse((child) => {
    child.userData.workshopConferenceTarget = "rack";
    child.castShadow = true;
    child.receiveShadow = true;
  });
  group.add(rackGroup);
  clickables.push(rackGroup);

  const roomTarget = new THREE.Vector3(4.8, -0.12, 1.0);
  const rackTarget = new THREE.Vector3(7.1, 1.68, 1.24);

  return {
    group,
    clickables,
    focus: {
      room: {
        position: new THREE.Vector3(4.74, -4.9, 1.72),
        lookAt: roomTarget,
      },
      rack: {
        position: new THREE.Vector3(7.56, -1.26, 1.72),
        lookAt: rackTarget,
      },
    },
    setAttendees(attendeeIds = []) {
      const active = new Set(Array.isArray(attendeeIds) ? attendeeIds : []);
      seatHalos.forEach((halo, seatId) => {
        halo.visible = active.has(seatId);
      });
    },
  };
}

export function getLightingPresets() {
  return LIGHTING_PRESETS.map((entry) => ({ ...entry }));
}

export function renderWorkshopConferencePanel({ state }) {
  const conference = normalizeConferenceState(state, {
    projectId: state?.active_project_id || "",
    projectName: state?.project_label || "Project",
  });
  const attendeeSet = new Set(conference.attendees);
  const pathRows = [
    ["session JSON", conference.session_json_path],
    ["latest JSON", conference.latest_session_path],
    ["notes .md", conference.notes_path],
    ["KB mirror", conference.kb_entry_path],
  ];
  return `
    <div class="workshop-conference-layout">
      <article class="workshop-card">
        <div class="workshop-card-head">
          <strong>Conference room session</strong>
          ${conference.active_session_id ? `<span class="workshop-pill">live sandbox</span>` : `<span class="workshop-pill workshop-pill--waiting">new session</span>`}
        </div>
        <label class="workshop-field-label" for="workshop-conference-topic">Topic</label>
        <input
          id="workshop-conference-topic"
          class="workshop-text-input"
          type="text"
          maxlength="200"
          placeholder="Big project topic..."
          value="${esc(conference.topic)}"
        />
        <p class="muted small workshop-soft-note">State persists to sandbox JSON and markdown only. No Google Docs handoff is used for v1.</p>
        <div class="workshop-inline-actions">
          <button type="button" class="btn accent btn-compact" data-workshop-conference-save>Save session</button>
          <button type="button" class="btn secondary btn-compact" data-workshop-conference-focus="room">Focus room</button>
          <button type="button" class="btn secondary btn-compact" data-workshop-conference-focus="rack">Focus plugin rack</button>
        </div>
        <div class="workshop-path-grid">
          ${pathRows.map(([label, value]) => `
            <div class="workshop-path-row">
              <span>${esc(label)}</span>
              <code>${esc(value || "will be written on first save")}</code>
            </div>
          `).join("")}
        </div>
      </article>
      <article class="workshop-card">
        <div class="workshop-card-head">
          <strong>Exact seats</strong>
          <span class="workshop-pill">${conference.attendees.length} attending</span>
        </div>
        <div class="workshop-conference-seat-grid">
          ${WORKSHOP_CONFERENCE_SEATS.map((seat) => `
            <button
              type="button"
              class="workshop-conference-seat${attendeeSet.has(seat.id) ? " active" : ""}"
              data-workshop-toggle-attendee="${esc(seat.id)}"
              aria-pressed="${attendeeSet.has(seat.id) ? "true" : "false"}"
            >
              <strong>${esc(seat.label)}</strong>
              <span>${esc(seat.summary)}</span>
            </button>
          `).join("")}
        </div>
      </article>
      <article class="workshop-card">
        <div class="workshop-card-head">
          <strong>Discussion notes</strong>
          ${conference.updated_at ? `<span class="workshop-pill">${esc(conference.updated_at.replace("T", " ").slice(0, 16))}</span>` : ""}
        </div>
        <textarea
          id="workshop-conference-notes"
          class="workshop-notes-input"
          rows="10"
          placeholder="Capture the discussion, guardrails, and follow-up notes..."
        >${esc(conference.notes_markdown)}</textarea>
      </article>
    </div>
  `;
}
