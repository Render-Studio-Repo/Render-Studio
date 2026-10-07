/** Named CAD / URDF / STEP rigs on an already-created viewport model. Token rigqc1. */

export const RIGQC1_TOKEN = "rigqc1";
export const RIG_QC_AGENT = "clip-bot";
export const RIG_QC_AGENT_ALT = "vibe-rnd";
export const RIG_QC_PICK_LIMIT = 4;

export function slugRigId(name, fallback = "rig") {
  const slug = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return slug || fallback;
}

export function inferRigKind(text) {
  const p = String(text || "").toLowerCase();
  if (/\b(holonomic|mecanum|omni[\s-]?wheel|caster|wheel(?:s)?\s+drive|drive(?:n)?\s+wheels?|fix(?: the)? wheels|make the wheels)\b/.test(p)) {
    return "wheels";
  }
  if (/\b(assembl\w*|explode|step[\s-]?by[\s-]?step|come together|puts itself together)\b/.test(p)) {
    return "assemble";
  }
  if (/\b(vortex|tornado|whirl|spin(?:ning)?)\b/.test(p)) return "vortex";
  if (/\b(open|close|lid|hinge|purse|door|flap|clamshell)\b/.test(p)) return "open_close";
  if (/\b(urdf|srdf|sdrf|udrf|robot|joint limits|base_link)\b/.test(p)) return "urdf";
  return "custom";
}

export function rigKindLabel(kind) {
  return ({
    assemble: "Assembly",
    vortex: "Vortex",
    open_close: "Open / close",
    urdf: "URDF / SRDF",
    wheels: "Wheels",
    step: "STEP motion",
    joints: "Joints",
    custom: "Custom",
  })[String(kind || "").toLowerCase()] || "Rig";
}

export function normalizeRig(raw = {}, fallbackIndex = 0) {
  const id = slugRigId(raw.id || raw.name || raw.label, `rig_${fallbackIndex + 1}`);
  const kind = String(raw.kind || raw.type || "custom").toLowerCase();
  return {
    id,
    name: String(raw.name || raw.label || rigKindLabel(kind)).trim() || id,
    kind,
    source: String(raw.source || raw.filename || raw.urdfFile || raw.module || "").trim(),
    urdfFile: raw.urdfFile || null,
    srdfFile: raw.srdfFile || null,
    animationId: raw.animationId || raw.clip || null,
    joints: Array.isArray(raw.joints) ? raw.joints : [],
    prompt: String(raw.prompt || "").trim(),
  };
}

export function fileBaseName(name = "") {
  return String(name || "").split(/[/\\]/).pop() || "";
}

export function modelFileStem(name = "") {
  return fileBaseName(name).replace(/\.[^.]+$/, "");
}

export function urdfMatchesModel(urdfName, modelName) {
  const modelStem = modelFileStem(modelName).toLowerCase().replace(/_exploded$/i, "");
  const urdfStem = modelFileStem(urdfName).toLowerCase();
  if (!modelStem || !urdfStem) return false;
  if (urdfStem === modelStem) return true;
  if (urdfStem.startsWith(`${modelStem}.`) || urdfStem.startsWith(`${modelStem}_`)) return true;
  return modelStem.startsWith(`${urdfStem}.`) || modelStem.startsWith(`${urdfStem}_`);
}

export function pickSidecarName(stem, files = []) {
  const names = (files || []).map((n) => String(n || "")).filter(Boolean);
  const stemBase = modelFileStem(stem);
  return names.find((n) => n === `${stem}.rigs.json`)
    || names.find((n) => fileBaseName(n) === `${stemBase}.rigs.json`)
    || names.find((n) => /\.rigs\.json$/i.test(n));
}

export function jointTypeOf(joint) {
  return String(joint?.type || joint?.joint_type || joint?.kind || "").toLowerCase();
}

export function hasMovableJoint(joints = []) {
  return (joints || []).some((joint) => {
    const type = jointTypeOf(joint);
    return type && type !== "fixed";
  });
}

export function ensurePlayableRigs(rigs = [], {
  joints = [],
  cadRigging = false,
  filename = "",
} = {}) {
  const out = (rigs || []).map((row, i) => normalizeRig(row, i));
  if (out.length && (hasMovableJoint(joints) || out.some((rig) => rig.kind !== "joints" || hasMovableJoint(rig.joints)))) {
    return out;
  }
  if (out.length || (joints || []).length || cadRigging) {
    if (!out.some((rig) => rig.id === "open_close" || rig.kind === "open_close")) {
      out.unshift(normalizeRig({
        id: "open_close",
        name: "Open / close",
        kind: "open_close",
        source: "fallback",
        joints,
        prompt: filename ? `Fallback hinge for ${fileBaseName(filename)}` : "Fallback hinge",
      }));
    }
  }
  return out;
}

export function mergeDiscoveredRigs({
  sidecar = null,
  files = [],
  urdfFiles = [],
  srdfFiles = [],
  stepAnimations = [],
  stepModule = "",
} = {}) {
  const out = [];
  const seen = new Set();
  const add = (raw, index) => {
    const rig = normalizeRig(raw, index);
    const key = `${rig.kind}:${rig.source || ""}:${rig.animationId || rig.urdfFile || rig.id}`;
    if (seen.has(key)) return;
    if (seen.has(`id:${rig.id}`)) rig.id = slugRigId(`${rig.id}_${rig.kind}`, `${rig.kind}_${index + 1}`);
    seen.add(key);
    seen.add(`id:${rig.id}`);
    out.push(rig);
  };
  const sidecarRigs = Array.isArray(sidecar?.rigs) ? sidecar.rigs : [];
  sidecarRigs.forEach((row, i) => add(row, i));
  (files || []).forEach((name, i) => {
    const file = String(name || "");
    if (/\.joints\.json$/i.test(file) || /^(r3d_joints|rigging)\.json$/i.test(fileBaseName(file))) {
      const idSource = file.replace(/\.joints\.json$/i, "").replace(/\.json$/i, "");
      add({ id: slugRigId(idSource, "joints"), name: file, kind: "joints", source: file }, 100 + i);
    }
    if (/\.rigs\.json$/i.test(file)) return;
  });
  (urdfFiles || []).forEach((name, i) => {
    const file = String(name || "");
    const stem = file.replace(/\.urdf$/i, "");
    const srdf = (srdfFiles || []).find((s) => String(s).replace(/\.srdf$/i, "") === stem) || srdfFiles?.[0] || null;
    add({
      id: slugRigId(stem, `urdf_${i + 1}`),
      name: srdf ? `${file} + SRDF` : file,
      kind: "urdf",
      source: file,
      urdfFile: file,
      srdfFile: srdf,
    }, 200 + i);
  });
  (stepAnimations || []).forEach((animId, i) => {
    add({
      id: slugRigId(animId, `clip_${i + 1}`),
      name: String(animId),
      kind: "step",
      source: stepModule || ".step.js",
      animationId: animId,
    }, 300 + i);
  });
  return out;
}

export function upsertNamedRig(rigs = [], next = {}) {
  const incoming = normalizeRig(next, rigs.length);
  const out = (rigs || []).map((row) => normalizeRig(row));
  const idx = out.findIndex((row) => row.id === incoming.id);
  if (idx >= 0) {
    out[idx] = { ...out[idx], ...incoming };
    return out;
  }
  out.push(incoming);
  return out;
}

export function filterRigs(rigs = [], query = "") {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return rigs.slice();
  return rigs.filter((rig) => {
    const hay = `${rig.name} ${rig.kind} ${rig.id} ${rig.source} ${rigKindLabel(rig.kind)}`.toLowerCase();
    return hay.includes(q);
  });
}

export function articulationGeneratePrefix({ kind, existingNames = [], filename = "" } = {}) {
  const names = existingNames.filter(Boolean).join(", ") || "(none yet)";
  const fileHint = filename ? ` Target file: ${filename}.` : "";
  const kindHint = {
    assemble: "Author an assembly animation: named bodies move from exploded/apart poses into the assembled pose, step by step.",
    vortex: "Author a vortex/spin clip: parts orbit or spin around the model up-axis without destroying geometry.",
    open_close: "Author open/close articulation (hinge, lid, purse, door) with a revolute or equivalent joint.",
    urdf: "Author or refresh URDF/SRDF joint motion on this model. Keep existing named rigs.",
    wheels: "Make the existing wheels drive: revolute or continuous wheel joints, not all-fixed mates, not dummy balls.",
    custom: "Author the requested motion as a named rig on this existing model.",
  }[kind] || "Author the requested motion as a named rig on this existing model.";
  return [
    "[CAD Rigging] Add animation to the EXISTING selected viewport model only. Do not invent a new part from scratch.",
    "Preserve geometry, scale, materials, and named bodies.",
    kindHint,
    `This model may already have named rigs: ${names}. Add a new named rig; do not replace the others.`,
    "Write or update <stem>.rigs.json listing every rig (id, name, kind, source).",
    "Also write the motion sidecar: <stem>.<rig_id>.joints.json, URDF/SRDF, or a .step.js clip as appropriate.",
    fileHint,
  ].filter(Boolean).join(" ");
}

export function articulationImproveHint(kind) {
  return (
    "Rewrite as a CAD Rigging edit of the model already in the viewport. "
    + "Do not generate a new product. Preserve geometry. "
    + "Support whatever motion the user typed: open/close, assembly (parts assembling step by step), "
    + "vortex/spin, URDF/SRDF joints, or another named clip. "
    + `Inferred kind: ${rigKindLabel(kind)}. `
    + "Phrase as adding a named rig alongside any existing rigs on this model."
  );
}

export function wheelDriveGeneratePrefix({ filename = "", existingNames = [] } = {}) {
  return articulationGeneratePrefix({ kind: "wheels", existingNames, filename })
    + " Prefer Holonomic-base wheel links. Do not emit dummy URDF <sphere> visuals or placeholder balls."
    + " Include a Play clip whose keyframes actually rotate the wheels.";
}

export function pickCadModelsForAgentFix(entries = [], { limit = RIG_QC_PICK_LIMIT } = {}) {
  const cap = Math.max(1, Math.min(8, Number(limit) || RIG_QC_PICK_LIMIT));
  const out = [];
  const seen = new Set();
  for (const entry of entries || []) {
    const filename = String(
      entry?.filename || entry?.source_filename || entry?.viewer_filename || entry?.name || "",
    ).trim();
    if (!filename || seen.has(filename)) continue;
    const section = String(entry?.sectionId || entry?.browser_section || "");
    const looksCad = /\.(glb|gltf|stl|step|stp|obj|fbx|usd|usda|usdz)$/i.test(filename)
      || section === "components"
      || section === "bodies"
      || entry?.format === "cad"
      || entry?.virtual_body
      || entry?.viewer_filename;
    if (!looksCad) continue;
    seen.add(filename);
    out.push({
      filename,
      label: String(entry?.label || entry?.body_name || fileBaseName(filename)).slice(0, 80),
    });
    if (out.length >= cap) break;
  }
  return out;
}

function collectJoints(sidecar = null, joints = []) {
  const fromSidecar = [];
  for (const rig of sidecar?.rigs || []) {
    if (Array.isArray(rig?.joints)) fromSidecar.push(...rig.joints);
  }
  const fromDoc = Array.isArray(sidecar?.joints) ? sidecar.joints : [];
  return [...(joints || []), ...fromSidecar, ...fromDoc];
}

export function urdfHasDummySpheres(urdfText = "") {
  const xml = String(urdfText || "");
  if (!xml) return false;
  if (/<(?:visual|collision)[\s\S]{0,800}<sphere\b/i.test(xml)) return true;
  return /placeholder|dummy[\s_-]?ball|dummy[\s_-]?sphere/i.test(xml);
}

export function urdfHasEmptyLinks(urdfText = "") {
  return /<link\s+name="[^"]+"\s*>\s*<\/link>/i.test(String(urdfText || ""));
}

export function hasPlayableClip({ sidecar = null, rigs = [], animations = [], stepAnimations = [], urdfText = "", files = [] } = {}) {
  const listed = Array.isArray(sidecar?.rigs) ? sidecar.rigs : (rigs || []);
  const clips = Array.isArray(sidecar?.animations) ? sidecar.animations : (animations || []);
  if (clips.some((clip) => Array.isArray(clip?.keyframes) && clip.keyframes.length >= 2)) return true;
  if ((stepAnimations || []).length) return true;
  if (listed.some((rig) => rig?.animationId || rig?.clip)) return true;
  const namedMotion = listed.some((rig) => rig?.kind && rig.kind !== "joints" && rig.source !== "fallback");
  if (namedMotion) {
    const empty = urdfHasEmptyLinks(urdfText);
    const meshVisual = /<mesh\s+filename=/i.test(String(urdfText || ""));
    const canBind = (files || []).some((n) => /lid|cover|flap|wheel/i.test(String(n || "")));
    if (empty && !meshVisual && !canBind) return false;
    return true;
  }
  const active = sidecar?.activeAnimationId || "";
  return !!active;
}

export function qcRigFix({
  sidecar = null,
  urdfText = "",
  joints = [],
  files = [],
  animations = [],
  stepAnimations = [],
  prompt = "",
  filename = "",
} = {}) {
  const kind = inferRigKind(prompt);
  const names = (files || []).map((n) => String(n || ""));
  const sidecarHit = names.some((n) => /\.rigs\.json$/i.test(n)) || !!(sidecar && (sidecar.rigs || sidecar.animations));
  const urdfHit = names.some((n) => /\.urdf$/i.test(n)) || /<robot[\s>]/i.test(String(urdfText || ""));
  const jointList = collectJoints(sidecar, joints);
  const movable = hasMovableJoint(jointList);
  const dummy = urdfHasDummySpheres(urdfText);
  const playable = hasPlayableClip({ sidecar, animations, stepAnimations, urdfText, files: names });
  const emptyLinks = urdfHasEmptyLinks(urdfText);
  const canBindCad = names.some((n) => /lid|cover|flap|wheel/i.test(n));
  const fallbackOnly = (sidecar?.rigs || []).length
    ? (sidecar.rigs || []).every((rig) => rig?.source === "fallback")
    : false;
  const wheelNamed = jointList.some((joint) => {
    const hay = `${joint?.id || ""} ${joint?.name || ""} ${joint?.child || ""} ${joint?.parent || ""}`.toLowerCase();
    return /\b(wheel|caster|mecanum|omni|drive)\b/.test(hay) && jointTypeOf(joint) !== "fixed";
  });
  const checks = [
    { id: "sidecar", pass: sidecarHit || urdfHit || jointList.length > 0, note: sidecarHit ? "Found *.rigs.json / joints sidecar" : (urdfHit ? "Found URDF" : "No rig sidecar") },
    { id: "clip", pass: playable && !fallbackOnly, note: playable && !fallbackOnly ? "Play has a real clip" : "No playable clip (or only fallback hinge)" },
    { id: "movable", pass: movable, note: movable ? "Has revolute/continuous/prismatic joints" : "All-fixed mates — wheels will not spin" },
    { id: "geometry", pass: !dummy, note: dummy ? "Dummy URDF spheres / placeholder balls" : "No dummy sphere visuals" },
    {
      id: "cad_bind",
      pass: !emptyLinks || canBindCad || playable,
      note: emptyLinks
        ? (canBindCad ? "Empty URDF links — Play binds the named CAD lid" : "Empty URDF links with no lid/wheel mesh to bind")
        : "URDF visuals or a real clip",
    },
  ];
  if (kind === "wheels" || /\bwheel/i.test(String(prompt || filename || ""))) {
    checks.push({
      id: "wheels",
      pass: movable && (wheelNamed || kind === "wheels"),
      note: wheelNamed ? "Wheel links are not fixed" : (movable ? "Movable joints, but none named as wheels" : "Wheels are not driving"),
    });
  }
  const pass = checks.every((row) => row.pass);
  const notes = checks.filter((row) => !row.pass).map((row) => row.note);
  if (pass) notes.push("QC pass — Play in viewport; shareplay2 Play if a clip exists.");
  return {
    ok: true,
    pass,
    fail: !pass,
    checks,
    notes,
    kind,
    filename: String(filename || ""),
    agent: RIG_QC_AGENT,
    alt_agent: RIG_QC_AGENT_ALT,
    token: RIGQC1_TOKEN,
    auto_apply: false,
  };
}

export function rigQcChatLines(result = {}) {
  const verdict = result.pass ? "PASS" : "FAIL";
  const detail = (result.notes || []).slice(0, 3).join("; ") || "no notes";
  const file = result.filename ? ` ${result.filename}` : "";
  return [
    {
      agent_id: "astra",
      agent_name: "Astra",
      text: `Rigging generate done${file}. ${RIG_QC_AGENT} QC next — token ${RIGQC1_TOKEN}.`,
    },
    {
      agent_id: RIG_QC_AGENT,
      agent_name: "Clip-bot",
      text: `QC ${verdict}${file}: ${detail}`.slice(0, 180),
    },
  ];
}
