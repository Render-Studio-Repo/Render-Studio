/** Match CAD bodies to URDF links and judge open/shut, snap click, and pin fit. */

export const CAD_MECH_TOKEN = "cadmech1";

export function slugPartName(name = "") {
  return String(name || "")
    .toLowerCase()
    .split(/[/\\]/)
    .pop()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "_");
}

export function scoreLinkMatch(nodeName, linkName) {
  const n = slugPartName(nodeName);
  const l = slugPartName(linkName);
  if (!n || !l) return 0;
  if (n === l) return 100;
  if (n.endsWith(`_${l}`) || n.includes(`__${l}`) || /part_\d+_/.test(n) && n.includes(l)) return 90;
  if (n.includes(l) && !/matching_both$/.test(n)) return 40;
  return 0;
}

export function pickBestNodeForLink(nodes, linkName) {
  let best = null;
  let bestScore = 0;
  for (const node of nodes || []) {
    const score = scoreLinkMatch(node?.name || node?.filename || "", linkName);
    if (score > bestScore) {
      bestScore = score;
      best = node;
    }
  }
  return bestScore >= 40 ? best : null;
}

export function collectNamedCadNodes(roots = []) {
  const out = [];
  const seen = new Set();
  for (const root of roots || []) {
    if (!root) continue;
    const push = (node) => {
      if (!node || seen.has(node)) return;
      seen.add(node);
      out.push(node);
    };
    push(root);
    const kids = root.children || [];
    kids.forEach((child) => push(child));
    if (typeof root.traverse === "function") {
      root.traverse((node) => {
        if (node?.name) push(node);
      });
    }
  }
  return out;
}

export function pickOpenCloseNodes(roots = []) {
  const nodes = collectNamedCadNodes(roots);
  const lid = pickBestNodeForLink(nodes, "shell_lid")
    || nodes.find((n) => /lid|cover|flap|upper/i.test(String(n?.name || "")) && !/base/i.test(String(n?.name || "")));
  const base = pickBestNodeForLink(nodes, "shell_base")
    || nodes.find((n) => /base|bottom|lower/i.test(String(n?.name || "")));
  const pin = pickBestNodeForLink(nodes, "retained_pin")
    || pickBestNodeForLink(nodes, "hinge_pin")
    || nodes.find((n) => /pin|hinge/i.test(String(n?.name || "")));
  return { lid: lid || null, base: base || null, pin: pin || null };
}

function bodySize(body) {
  if (Array.isArray(body?.size_mm) && body.size_mm.length >= 3) {
    return { x: Number(body.size_mm[0]), y: Number(body.size_mm[1]), z: Number(body.size_mm[2]) };
  }
  const b = body?.bbox;
  if (Array.isArray(b) && b.length >= 6) {
    return { x: Math.abs(b[3] - b[0]), y: Math.abs(b[4] - b[1]), z: Math.abs(b[5] - b[2]) };
  }
  return null;
}

function minCrossSectionMm(size) {
  if (!size) return 0;
  const dims = [size.x, size.y, size.z].map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (dims.length < 2) return dims[0] || 0;
  return dims[0];
}

/**
 * CAD-bot verdict: will it open/shut, will a snap/clamp click, is pin clearance enough.
 */
export function analyzeMechanismFit(snap = {}) {
  const prompt = String(snap.prompt || "").toLowerCase();
  const bodies = Array.isArray(snap.bodies) ? snap.bodies : [];
  const joints = Array.isArray(snap.joints) ? snap.joints : [];
  const files = (snap.files || []).map((n) => String(n || ""));
  const spec = snap.spec || {};
  const pinSpec = Number(spec.pin_diameter_mm ?? 4);
  const pinClear = Number(spec.pin_clearance_mm ?? 0.2);
  const boreSpec = Number(spec.bore_mm ?? (pinSpec + pinClear * 2));
  const snapSpec = Number(spec.snap_clearance_mm ?? 0.28);
  const stopDeg = Number(spec.open_stop_deg ?? 110);
  const checks = [];
  const edits = [];

  const lid = bodies.find((b) => scoreLinkMatch(b.name, "shell_lid") >= 40)
    || bodies.find((b) => /lid|cover|flap/i.test(String(b.name || "")));
  const pin = bodies.find((b) => /pin/i.test(String(b.name || "")));
  const clampHw = bodies.find((b) => /90576a119|clamp/i.test(String(b.name || "")));
  const revolute = joints.find((j) => {
    const t = String(j.type || j.joint_type || "").toLowerCase();
    return t === "revolute" || t === "continuous";
  });
  const lidFile = files.some((n) => /lid/i.test(n) && /\.(glb|gltf|step|stp)$/i.test(n));
  const emptyUrdf = /<link\s+name="[^"]+"\s*>\s*<\/link>/i.test(String(snap.urdfText || ""));

  const openRad = revolute ? Number(revolute.upper ?? revolute.limit_upper ?? 0) : 0;
  const openDeg = openRad * (180 / Math.PI);
  const lower = revolute ? Number(revolute.lower ?? 0) : null;
  const willOpen = !!(lid || lidFile) && !!revolute && openDeg >= 45;
  checks.push({
    id: "will_open",
    ok: willOpen,
    label: "Will open",
    detail: willOpen
      ? `Lid is a separate body; revolute stop ≈ ${openDeg.toFixed(0)}° (spec ${stopDeg}°).`
      : "No separate lid + revolute with a real open stop — Play cannot open a fused shell.",
  });
  if (!willOpen) {
    edits.push("Keep shell_lid as its own solid. Revolute on the pin axis (X at hinge origin) with 110° upper limit.");
  }

  const willShut = !!revolute && (lower === 0 || Math.abs(lower) < 0.05);
  checks.push({
    id: "will_shut",
    ok: willShut,
    label: "Will shut",
    detail: willShut
      ? "Hinge lower limit is closed (0). Lid can return to the assembled pose."
      : "Hinge never returns to 0 — it will not shut.",
  });
  if (!willShut) edits.push("Set revolute lower=0 so the lid shuts on the rim.");

  const pinSize = bodySize(pin);
  const pinDia = minCrossSectionMm(pinSize);
  const pinFits = pinDia > 0 ? pinDia <= boreSpec + 0.05 : null;
  if (pin && pinDia > 0) {
    checks.push({
      id: "pin_tolerance",
      ok: !!pinFits,
      label: "Pin / bore tolerance",
      detail: pinFits
        ? `Pin ≈ Ø${pinDia.toFixed(2)} mm fits modeled bore Ø${boreSpec.toFixed(2)} mm (${pinClear} mm/side).`
        : `Pin cross-section ≈ Ø${pinDia.toFixed(2)} mm vs bore Ø${boreSpec.toFixed(2)} mm (Ø${pinSpec} pin + ${pinClear} mm/side). It will bind, not spin.`,
    });
    if (!pinFits) {
      edits.push(`Scale retained_pin to Ø${pinSpec.toFixed(2)} mm; keep knuckle bore Ø${boreSpec.toFixed(2)} mm.`);
    }
  } else {
    checks.push({
      id: "pin_tolerance",
      ok: false,
      label: "Pin / bore tolerance",
      detail: "No pin body measured — cannot confirm running clearance.",
    });
  }

  const snapOk = snapSpec >= 0.15 && snapSpec <= 0.45;
  const clampMated = !!(clampHw && lid && scoreLinkMatch(clampHw.name, "shell_lid") >= 90);
  checks.push({
    id: "clamp_click",
    ok: snapOk && !clampMated,
    label: "Clamps / snap click",
    detail: clampHw && !clampMated
      ? `Integral PETG snap spec ${snapSpec} mm is in the click band (0.15–0.45 mm). Catalog clamp ${clampHw.name} sits at the origin and is not the clasp — it will not click the purse shut.`
      : (snapOk
        ? `Snap slip ${snapSpec} mm should click in PETG if the beads actually overlap that amount.`
        : `Snap clearance ${snapSpec} mm is outside 0.15–0.45 mm — too tight to assemble or too loose to click.`),
  });
  if (clampHw && !clampMated) {
    edits.push("Do not use McMaster 90576A119 as the clasp. Keep the integral bead-tab snap; delete or hide leftover catalog clamps.");
  }

  if (emptyUrdf) {
    checks.push({
      id: "cad_bind",
      ok: !!(lid || lidFile),
      label: "Play binds CAD",
      detail: (lid || lidFile)
        ? "URDF links have no meshes; Play must drive the named CAD lid (not empty robot groups)."
        : "Empty URDF links and no lid mesh — Play animates nothing.",
    });
  }

  const wants = /open|shut|hinge|purse|clamp|click|tolerance|lid/.test(prompt) || snap.kind === "rigging";
  const failed = checks.filter((c) => c.ok === false);
  const openShut = willOpen && willShut;
  const summary = [
    openShut ? "OPEN/SHUT: yes, if Play drives shell_lid around the pin (X at origin)." : "OPEN/SHUT: not as authored.",
    pinFits === false ? "TOLERANCE: pin is too fat for the bore." : (pinFits ? "TOLERANCE: pin/bore OK." : "TOLERANCE: pin not measured."),
    clampHw
      ? "CLICK: PETG snap spec is in range; leftover McMaster clamp is not the latch."
      : (snapOk ? "CLICK: snap spec in range." : "CLICK: snap clearance off spec."),
  ].join(" ");

  return {
    token: CAD_MECH_TOKEN,
    checks: wants || joints.length ? checks : [],
    edits,
    will_open: willOpen,
    will_shut: willShut,
    pin_fits: pinFits,
    snap_click_spec: snapOk,
    summary,
    cad_bot: "cad-bot",
    hop: ["cad-bot", "cursor-engineer", "harness-mule"],
  };
}

export function cadBotMechanismLines(result = {}) {
  const summary = String(result.summary || "No mechanism verdict.");
  const repair = (result.edits || []).slice(0, 3).map((e, i) => `${i + 1}. ${e}`).join(" ");
  return [
    {
      agent_id: "cad-bot",
      agent_name: "CAD bot",
      text: `CAD bot ${CAD_MECH_TOKEN}: ${summary}`.slice(0, 400),
    },
    {
      agent_id: "cursor-engineer",
      agent_name: "Cursor",
      text: repair
        ? `@cad-bot repair: ${repair}`.slice(0, 400)
        : "@cad-bot mechanism fit is OK — keep Play bound to named CAD bodies.",
    },
  ];
}
