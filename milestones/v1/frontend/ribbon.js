/**
 * Fusion 360-style parametric ribbon toolbar.
 *
 * The ribbon lives below the main header and expands / collapses via a chevron.
 * It is organised into category tabs (Create · Modify · Pattern · Sketch) each
 * holding a row of icon-buttons.  Clicking a button opens a floating parameter
 * dialog; confirming appends a Feature to the active part's feature list and
 * fires a kernel build via POST /api/projects/{id}/build.
 *
 * The current feature program (parts + features) is kept in local state and
 * rendered as a small feature tree beneath the ribbon when it is open.
 */

// ─────────────────────────── catalog ───────────────────────────────────────

/**
 * Each entry defines one toolbar button.
 *
 * fields:  array of { name, label, type, default, min?, step?, options? }
 *   type = "number" | "select" | "checkbox"
 *
 * featureOf(values) → Feature dict to append.
 */
const CATALOG = {
  Create: [
    {
      id: "box",
      label: "Box",
      icon: "⬛",
      desc: "Rectangular solid",
      fields: [
        { name: "length", label: "Length (mm)", type: "number", default: 20, min: 0.1, step: 1 },
        { name: "width",  label: "Width (mm)",  type: "number", default: 20, min: 0.1, step: 1 },
        { name: "height", label: "Height (mm)", type: "number", default: 10, min: 0.1, step: 1 },
        { name: "combine", label: "Combine", type: "select", default: "new",
          options: ["new","add","cut","intersect"] },
      ],
      featureOf: v => {
        const length = parseFloat(v.length);
        const width = parseFloat(v.width);
        const height = parseFloat(v.height);
        if (![length, width, height].every((n) => Number.isFinite(n) && n > 0)) {
          throw new Error("Length, width, and height must be positive numbers");
        }
        return { op: "box", combine: v.combine, length, width, height };
      },
    },
    {
      id: "cylinder",
      label: "Cylinder",
      icon: "🔵",
      desc: "Cylinder / tube",
      fields: [
        { name: "radius", label: "Radius (mm)", type: "number", default: 10, min: 0.1, step: 0.5 },
        { name: "height", label: "Height (mm)", type: "number", default: 20, min: 0.1, step: 1 },
        { name: "combine", label: "Combine", type: "select", default: "new",
          options: ["new","add","cut","intersect"] },
      ],
      featureOf: v => ({ op:"cylinder", combine:v.combine,
        radius:+v.radius, height:+v.height }),
    },
    {
      id: "sphere",
      label: "Sphere",
      icon: "🟡",
      desc: "Sphere primitive",
      fields: [
        { name: "radius", label: "Radius (mm)", type: "number", default: 10, min: 0.1, step: 0.5 },
        { name: "combine", label: "Combine", type: "select", default: "new",
          options: ["new","add","cut","intersect"] },
      ],
      featureOf: v => ({ op:"sphere", combine:v.combine, radius:+v.radius }),
    },
    {
      id: "cone",
      label: "Cone",
      icon: "🔺",
      desc: "Cone / frustum",
      fields: [
        { name: "bottom_radius", label: "Base radius (mm)", type:"number", default:10, min:0.1, step:0.5 },
        { name: "top_radius",    label: "Top radius (mm)",  type:"number", default:0,  min:0,   step:0.5 },
        { name: "height",        label: "Height (mm)",      type:"number", default:20, min:0.1, step:1   },
        { name: "combine", label: "Combine", type: "select", default: "new",
          options: ["new","add","cut","intersect"] },
      ],
      featureOf: v => ({ op:"cone", combine:v.combine,
        bottom_radius:+v.bottom_radius, top_radius:+v.top_radius, height:+v.height }),
    },
    {
      id: "torus",
      label: "Torus",
      icon: "⭕",
      desc: "Torus (ring)",
      fields: [
        { name: "major_radius", label: "Major radius (mm)", type:"number", default:20, min:0.1, step:1 },
        { name: "minor_radius", label: "Minor (tube) (mm)", type:"number", default:5,  min:0.1, step:0.5 },
        { name: "combine", label: "Combine", type: "select", default: "new",
          options: ["new","add","cut","intersect"] },
      ],
      featureOf: v => ({ op:"torus", combine:v.combine,
        major_radius:+v.major_radius, minor_radius:+v.minor_radius }),
    },
    {
      id: "extrude",
      label: "Extrude",
      icon: "⬆",
      desc: "Extrude a 2D polygon profile",
      fields: [
        { name: "profile_preset", label: "Profile preset", type:"select", default:"square",
          options:["square","triangle","hexagon","L-shape"] },
        { name: "profile_size", label: "Profile size (mm)", type:"number", default:20, min:1, step:1 },
        { name: "height", label: "Height / depth (mm)", type:"number", default:15, min:0.1, step:1 },
        { name: "combine", label: "Combine", type: "select", default: "new",
          options: ["new","add","cut","intersect"] },
      ],
      featureOf: v => {
        const s = +v.profile_size;
        const profiles = {
          square:   [[-s/2,-s/2],[s/2,-s/2],[s/2,s/2],[-s/2,s/2]],
          triangle: [[0, s*0.577],[-s/2,-s*0.289],[s/2,-s*0.289]],
          hexagon:  [[s,0],[s/2,s*0.866],[-s/2,s*0.866],[-s,-0],[-s/2,-s*0.866],[s/2,-s*0.866]],
          "L-shape":[[0,0],[s,0],[s,s*0.33],[s*0.33,s*0.33],[s*0.33,s],[0,s]],
        };
        return { op:"extrude", combine:v.combine,
          profile: profiles[v.profile_preset] || profiles.square,
          height:+v.height };
      },
    },
    {
      id: "revolve",
      label: "Revolve",
      icon: "🔄",
      desc: "Revolve a profile around Z",
      fields: [
        { name: "profile_preset", label: "Profile", type:"select", default:"vase",
          options:["vase","L-profile","rectangle"] },
        { name: "scale", label: "Scale (mm)", type:"number", default:20, min:1, step:1 },
        { name: "angle", label: "Arc (°)", type:"number", default:360, min:1, max:360, step:15 },
        { name: "combine", label: "Combine", type: "select", default: "new",
          options: ["new","add","cut","intersect"] },
      ],
      featureOf: v => {
        const s = +v.scale;
        const profiles = {
          vase:        [[0,0],[s,0],[s*0.9,s*0.06],[s*0.8,s*0.7],[s*1.0,s],[s*0.92,s*0.995],[0,s*0.995]],
          "L-profile": [[0,0],[s,0],[s,s*0.2],[s*0.2,s*0.2],[s*0.2,s],[0,s]],
          rectangle:   [[s*0.4,0],[s,0],[s,s],[s*0.4,s]],
        };
        return { op:"revolve", combine:v.combine,
          profile: profiles[v.profile_preset] || profiles.rectangle,
          angle:+v.angle };
      },
    },
    {
      id: "hole",
      label: "Hole",
      icon: "🕳",
      desc: "Drill a hole in the running solid",
      fields: [
        { name: "diameter", label: "Diameter (mm)", type:"number", default:5, min:0.1, step:0.5 },
        { name: "depth",    label: "Depth (mm) — 0 = through", type:"number", default:0, min:0, step:1 },
        { name: "at_x",    label: "Position X (mm)", type:"number", default:0, step:1 },
        { name: "at_y",    label: "Position Y (mm)", type:"number", default:0, step:1 },
        { name: "at_z",    label: "Position Z (mm)", type:"number", default:0, step:1 },
      ],
      featureOf: v => {
        const through = +v.depth === 0;
        return { op:"hole", diameter:+v.diameter,
          through, depth: through ? undefined : +v.depth,
          at:[+v.at_x, +v.at_y, +v.at_z] };
      },
    },
  ],

  Modify: [
    {
      id: "fillet",
      label: "Fillet",
      icon: "🔵",
      desc: "Round edges",
      fields: [
        { name: "radius", label: "Radius (mm)", type:"number", default:2, min:0.01, step:0.5 },
        { name: "edges",  label: "Edges",       type:"select", default:"all",
          options:["all","vertical","horizontal","top","bottom","front","back","left","right"] },
      ],
      featureOf: v => ({ op:"fillet", radius:+v.radius, edges:v.edges }),
    },
    {
      id: "chamfer",
      label: "Chamfer",
      icon: "◆",
      desc: "Bevel edges",
      fields: [
        { name: "length", label: "Length (mm)", type:"number", default:1.5, min:0.01, step:0.25 },
        { name: "edges",  label: "Edges",       type:"select", default:"all",
          options:["all","vertical","horizontal","top","bottom","front","back","left","right"] },
      ],
      featureOf: v => ({ op:"chamfer", length:+v.length, edges:v.edges }),
    },
    {
      id: "shell",
      label: "Shell",
      icon: "🪣",
      desc: "Hollow out the solid",
      fields: [
        { name: "thickness", label: "Wall thickness (mm)", type:"number", default:2, min:0.1, step:0.5 },
        { name: "openings",  label: "Open face",           type:"select", default:"top",
          options:["top","bottom","front","back","left","right"] },
      ],
      featureOf: v => ({ op:"shell", thickness:+v.thickness, openings:v.openings }),
    },
    {
      id: "transform",
      label: "Move / Rotate",
      icon: "✥",
      desc: "Translate or rotate the body",
      fields: [
        { name: "tx", label: "Move X (mm)", type:"number", default:0, step:1 },
        { name: "ty", label: "Move Y (mm)", type:"number", default:0, step:1 },
        { name: "tz", label: "Move Z (mm)", type:"number", default:0, step:1 },
        { name: "rx", label: "Rot X (°)",   type:"number", default:0, step:5 },
        { name: "ry", label: "Rot Y (°)",   type:"number", default:0, step:5 },
        { name: "rz", label: "Rot Z (°)",   type:"number", default:0, step:5 },
        { name: "scale", label: "Scale",    type:"number", default:1, min:0.001, step:0.05 },
      ],
      featureOf: v => ({ op:"transform",
        translation:[+v.tx,+v.ty,+v.tz],
        rotation:[+v.rx,+v.ry,+v.rz],
        scale:+v.scale }),
    },
    {
      id: "mirror",
      label: "Mirror",
      icon: "↔",
      desc: "Mirror body across a plane",
      fields: [
        { name: "plane", label: "Mirror plane", type:"select", default:"YZ",
          options:["YZ","XZ","XY"] },
        { name: "keep_original", label: "Keep original", type:"select", default:"true",
          options:["true","false"] },
      ],
      featureOf: v => ({ op:"mirror", plane:v.plane,
        keep_original: v.keep_original !== "false" }),
    },
    {
      id: "loft",
      label: "Loft",
      icon: "🔷",
      desc: "Loft between two cross-sections",
      fields: [
        { name: "bottom_shape", label: "Bottom", type:"select", default:"circle",
          options:["circle","rectangle"] },
        { name: "bottom_size",  label: "Bottom size (mm)", type:"number", default:20, min:1, step:1 },
        { name: "top_shape",    label: "Top",    type:"select", default:"circle",
          options:["circle","rectangle"] },
        { name: "top_size",     label: "Top size (mm)",    type:"number", default:10, min:0, step:1 },
        { name: "height",       label: "Height (mm)",      type:"number", default:30, min:1, step:1 },
        { name: "combine",      label: "Combine",          type:"select", default:"new",
          options:["new","add","cut","intersect"] },
      ],
      featureOf: v => {
        const bSec = v.bottom_shape === "circle"
          ? { z:0, radius:+v.bottom_size/2 }
          : { z:0, width:+v.bottom_size, height:+v.bottom_size };
        const tSec = v.top_shape === "circle"
          ? { z:+v.height, radius:+v.top_size/2 }
          : { z:+v.height, width:+v.top_size, height:+v.top_size };
        return { op:"loft", combine:v.combine, sections:[bSec, tSec] };
      },
    },
  ],

  Pattern: [
    {
      id: "pattern_linear",
      label: "Linear",
      icon: "┼",
      desc: "Linear pattern / array",
      fields: [
        { name: "count",  label: "Count",           type:"number", default:3,  min:1,   step:1 },
        { name: "dx",     label: "Spacing X (mm)",  type:"number", default:20, step:1 },
        { name: "dy",     label: "Spacing Y (mm)",  type:"number", default:0,  step:1 },
        { name: "dz",     label: "Spacing Z (mm)",  type:"number", default:0,  step:1 },
      ],
      featureOf: v => ({
        op:"pattern", arrange:"linear",
        count:+v.count, spacing:[+v.dx,+v.dy,+v.dz],
      }),
    },
    {
      id: "pattern_polar",
      label: "Circular",
      icon: "↻",
      desc: "Circular / polar array",
      fields: [
        { name: "count",  label: "Count",              type:"number", default:6,   min:1, step:1 },
        { name: "angle",  label: "Arc (°)",             type:"number", default:360, min:1, step:15 },
        { name: "radius", label: "Array radius (mm)",   type:"number", default:30, min:0, step:1 },
        { name: "axis",   label: "Rotation axis",       type:"select", default:"[0,0,1]",
          options:["[0,0,1]","[0,1,0]","[1,0,0]"] },
      ],
      featureOf: v => ({
        op:"pattern", arrange:"polar",
        count:+v.count, angle:+v.angle, radius:+v.radius,
        axis: JSON.parse(v.axis),
      }),
    },
    {
      id: "mirror_body",
      label: "Mirror Body",
      icon: "⇔",
      desc: "Mirror the body symmetrically",
      fields: [
        { name: "plane", label: "Mirror plane", type:"select", default:"YZ",
          options:["YZ","XZ","XY"] },
      ],
      featureOf: v => ({ op:"mirror", plane:v.plane, keep_original:true }),
    },
  ],
};

// ─────────────────────────── internal state ─────────────────────────────────

let _api = null;           // async fn(path, opts) — injected by init()
let _projectId = null;     // current project id
let _onBuilt = null;       // callback(filename, url) after successful build
let _partId = "part-1";    // active part id

// The live Feature Program (single-part for ribbon-built models)
let _program = null;

function _emptyProgram() {
  return {
    name: "ribbon-model",
    units: "mm",
    parts: [{ id: _partId, features: [], color: "#e0e0e0" }],
  };
}

function _part() {
  return _program.parts.find(p => p.id === _partId) || _program.parts[0];
}

// ─────────────────────────── DOM references ──────────────────────────────────

let _ribbonBar      = null;   // .ribbon-bar
let _ribbonBody     = null;   // .ribbon-body (the collapsible section)
let _chevron        = null;   // collapse button
let _tabBtns        = null;   // NodeList of .ribbon-tab
let _featureTree    = null;   // .feature-tree list
let _statusEl       = null;   // .ribbon-status span
let _statusCopyBtn  = null;   // copy error button
let _statusCopyText = "";     // full text for clipboard
let _dialog         = null;   // .ribbon-dialog overlay
let _collapsed      = false;
const LS_COLLAPSED  = "render3d:ribbonCollapsed";

// ─────────────────────────── build → API ─────────────────────────────────────

async function _buildProgram(label) {
  if (!_api || !_projectId) return;
  _setStatus("building…", "loading");
  try {
    const data = await _api(`/api/projects/${_projectId}/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(_program),
    });
    _program.name = data.program?.name || _program.name;
    _setStatus(`✓ ${data.filename}`, "ok");
    _renderTree();
    if (_onBuilt) _onBuilt(data.filename, data.url);
  } catch (err) {
    _setStatus("✗ " + (err.message || "build failed"), "error");
  }
}

// ─────────────────────────── dialog ──────────────────────────────────────────

function _openDialog(entry) {
  // Remove any existing dialog
  _closeDialog();

  const overlay = document.createElement("div");
  overlay.className = "ribbon-dialog-overlay";
  overlay.addEventListener("mousedown", e => { if (e.target === overlay) _closeDialog(); });

  const box = document.createElement("div");
  box.className = "ribbon-dialog";
  box.role = "dialog";
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", entry.label);

  box.innerHTML = `
    <div class="rdlg-header">
      <span class="rdlg-icon">${entry.icon}</span>
      <span class="rdlg-title">${entry.label}</span>
      <span class="rdlg-desc">${entry.desc}</span>
      <button class="rdlg-close" aria-label="Close">✕</button>
    </div>
    <form class="rdlg-form" id="rdlg-form"></form>
    <div class="rdlg-footer">
      <span class="rdlg-tip">Enter → OK &nbsp;·&nbsp; Esc → cancel</span>
      <button type="button" class="btn secondary rdlg-cancel">Cancel</button>
      <button type="button" class="btn primary rdlg-ok">OK &amp; Build</button>
    </div>`;

  const form = box.querySelector("#rdlg-form");
  for (const f of entry.fields) {
    const row = document.createElement("div");
    row.className = "rdlg-row";
    const label = document.createElement("label");
    label.textContent = f.label;
    label.htmlFor = `rdlg-${f.name}`;

    let input;
    if (f.type === "select") {
      input = document.createElement("select");
      for (const opt of f.options) {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        if (opt == f.default) o.selected = true;
        input.appendChild(o);
      }
    } else if (f.type === "checkbox") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!f.default;
    } else {
      input = document.createElement("input");
      input.type = "number";
      if (f.min !== undefined) input.min = f.min;
      if (f.max !== undefined) input.max = f.max;
      if (f.step !== undefined) input.step = f.step;
      input.value = f.default ?? 0;
    }
    input.id = `rdlg-${f.name}`;
    input.name = f.name;
    row.append(label, input);
    form.appendChild(row);
  }

  const ok = () => {
    const values = {};
    for (const f of entry.fields) {
      // Avoid form.elements["length"] — shadows the collection's .length property.
      const el = form.querySelector(`#rdlg-${f.name}`);
      if (!el) throw new Error(`Missing field: ${f.name}`);
      values[f.name] = f.type === "checkbox" ? el.checked : el.value;
    }
    try {
      const feat = entry.featureOf(values);
      _part().features.push(feat);
      _renderTree();
      _closeDialog();
      _buildProgram(entry.label);
    } catch (e) {
      _setStatus("✗ " + e.message, "error");
      _closeDialog();
    }
  };

  box.querySelector(".rdlg-ok").addEventListener("click", ok);
  box.querySelector(".rdlg-cancel").addEventListener("click", _closeDialog);
  box.querySelector(".rdlg-close").addEventListener("click", _closeDialog);
  box.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.tagName !== "SELECT") { e.preventDefault(); ok(); }
    if (e.key === "Escape") _closeDialog();
  });

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  _dialog = overlay;
  // Focus first input
  const first = form.querySelector("input, select");
  if (first) setTimeout(() => first.focus(), 30);
}

function _closeDialog() {
  if (_dialog) { _dialog.remove(); _dialog = null; }
}

// ─────────────────────────── feature tree ────────────────────────────────────

function _renderTree() {
  if (!_featureTree) return;
  _featureTree.innerHTML = "";
  const features = _part()?.features || [];
  if (!features.length) {
    const li = document.createElement("li");
    li.className = "ft-empty";
    li.textContent = "No features yet — use the toolbar above to add one";
    _featureTree.appendChild(li);
    return;
  }
  features.forEach((feat, idx) => {
    const li = document.createElement("li");
    li.className = "ft-item";
    li.dataset.index = idx;

    const icon = document.createElement("span");
    icon.className = "ft-icon";
    const entry = _findEntry(feat.op);
    icon.textContent = entry?.icon || "◦";

    const name = document.createElement("span");
    name.className = "ft-name";
    name.textContent = _featLabel(feat);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "ft-del";
    del.title = "Remove feature";
    del.innerHTML = "✕";
    del.addEventListener("click", () => {
      _part().features.splice(idx, 1);
      _renderTree();
      if (_part().features.length) _buildProgram("delete feat");
      else _setStatus("Feature removed", "ok");
    });

    li.append(icon, name, del);
    _featureTree.appendChild(li);
  });
}

function _findEntry(op) {
  for (const entries of Object.values(CATALOG)) {
    const found = entries.find(e => e.featureOf({ ...Object.fromEntries(e.fields.map(f => [f.name, f.default])) })?.op === op
      || e.id === op || e.id.startsWith(op));
    if (found) return found;
  }
  return null;
}

function _featLabel(feat) {
  const op = feat.op;
  const parts = [op.charAt(0).toUpperCase() + op.slice(1)];
  if (feat.combine && feat.combine !== "new") parts.push(`(${feat.combine})`);
  const dims = [];
  for (const k of ["length", "width", "height", "radius", "diameter", "thickness"]) {
    const n = Number(feat[k]);
    if (Number.isFinite(n)) {
      dims.push(`${k[0].toUpperCase()}${n}`);
      break;
    }
  }
  if (dims.length) parts.push(dims[0] + "mm");
  if (feat.plane) parts.push(feat.plane);
  return parts.join(" ");
}

// ─────────────────────────── status ──────────────────────────────────────────

async function _copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

async function _copyStatusError() {
  const text = _statusCopyText || _statusEl?.title || _statusEl?.textContent?.trim();
  if (!text) return;
  try {
    await _copyToClipboard(text);
    if (_statusCopyBtn) {
      const prev = _statusCopyBtn.textContent;
      _statusCopyBtn.textContent = "Copied";
      setTimeout(() => {
        if (_statusCopyBtn) _statusCopyBtn.textContent = prev;
      }, 1500);
    }
  } catch (_) {
    if (_statusCopyBtn) _statusCopyBtn.textContent = "Copy failed";
  }
}

function _setStatus(msg, cls = "") {
  if (!_statusEl) return;
  const isError = cls === "error";
  _statusCopyText = isError ? msg.replace(/^\s*✗\s*/, "").trim() || msg : "";
  _statusEl.textContent = msg;
  _statusEl.title = isError && _statusCopyText ? _statusCopyText : "";
  _statusEl.className = `ribbon-status ${cls}`;
  if (_statusCopyBtn) {
    _statusCopyBtn.classList.toggle("ribbon-status-copy--hidden", !isError || !_statusCopyText);
    _statusCopyBtn.disabled = !isError || !_statusCopyText;
  }
}

// ─────────────────────────── collapse ────────────────────────────────────────

function _setCollapsed(val) {
  _collapsed = val;
  try { localStorage.setItem(LS_COLLAPSED, val ? "1" : "0"); } catch (_) {}
  _ribbonBody?.classList.toggle("ribbon-body--collapsed", _collapsed);
  if (_chevron) _chevron.textContent = _collapsed ? "▾" : "▴";
  if (_chevron) _chevron.setAttribute("aria-label", _collapsed ? "Open toolbar" : "Collapse toolbar");
}

// ─────────────────────────── build DOM ───────────────────────────────────────

function _buildRibbonDOM() {
  // Container lives above #app's grid content — injected just before <main>
  const bar = document.createElement("div");
  bar.className = "ribbon-bar";
  bar.id = "ribbon-bar";

  // ── toggle row ──────────────────────────────────────────────────────────
  const toggleRow = document.createElement("div");
  toggleRow.className = "ribbon-toggle-row";

  // Tabs
  const tabs = document.createElement("div");
  tabs.className = "ribbon-tabs";
  for (const cat of Object.keys(CATALOG)) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ribbon-tab";
    btn.dataset.cat = cat;
    btn.textContent = cat;
    tabs.appendChild(btn);
  }

  // Status
  const statusWrap = document.createElement("div");
  statusWrap.className = "ribbon-status-wrap";
  const statusSpan = document.createElement("span");
  statusSpan.className = "ribbon-status";
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "ribbon-status-copy ribbon-status-copy--hidden";
  copyBtn.textContent = "Copy";
  copyBtn.title = "Copy error to clipboard";
  copyBtn.setAttribute("aria-label", "Copy error to clipboard");
  copyBtn.addEventListener("click", () => _copyStatusError());
  statusSpan.addEventListener("dblclick", () => {
    if (_statusEl?.classList.contains("error")) _copyStatusError();
  });
  statusWrap.append(statusSpan, copyBtn);

  // Reset button
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.className = "btn secondary ribbon-reset";
  resetBtn.title = "Clear all features and start a new ribbon model";
  resetBtn.textContent = "New model";
  resetBtn.addEventListener("click", () => {
    if (_part().features.length &&
        !confirm("Clear all ribbon features and start fresh?")) return;
    _program = _emptyProgram();
    _renderTree();
    _setStatus("Cleared", "");
  });

  // Chevron
  const chev = document.createElement("button");
  chev.type = "button";
  chev.className = "ribbon-chevron";
  chev.setAttribute("aria-controls", "ribbon-body");
  toggleRow.append(tabs, statusWrap, resetBtn, chev);

  // ── body ────────────────────────────────────────────────────────────────
  const body = document.createElement("div");
  body.className = "ribbon-body";
  body.id = "ribbon-body";

  // Panels per category
  const panelsWrap = document.createElement("div");
  panelsWrap.className = "ribbon-panels";
  for (const [cat, entries] of Object.entries(CATALOG)) {
    const panel = document.createElement("div");
    panel.className = "ribbon-panel";
    panel.dataset.cat = cat;
    for (const entry of entries) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ribbon-btn";
      btn.dataset.id = entry.id;
      btn.title = entry.desc;
      btn.innerHTML = `<span class="rb-icon">${entry.icon}</span><span class="rb-label">${entry.label}</span>`;
      btn.addEventListener("click", () => _openDialog(entry));
      panel.appendChild(btn);
    }
    panelsWrap.appendChild(panel);
  }

  // Feature tree
  const treeWrap = document.createElement("div");
  treeWrap.className = "ribbon-tree-wrap";
  const treeLabel = document.createElement("span");
  treeLabel.className = "ribbon-tree-label";
  treeLabel.textContent = "Features";
  const tree = document.createElement("ul");
  tree.className = "feature-tree";
  treeWrap.append(treeLabel, tree);

  body.append(panelsWrap, treeWrap);
  bar.append(toggleRow, body);

  // ── store refs ───────────────────────────────────────────────────────────
  _ribbonBar   = bar;
  _ribbonBody  = body;
  _chevron     = chev;
  _tabBtns     = tabs.querySelectorAll(".ribbon-tab");
  _featureTree = tree;
  _statusEl       = statusSpan;
  _statusCopyBtn  = copyBtn;

  return bar;
}

// ─────────────────────────── tab switching ───────────────────────────────────

function _activateTab(cat) {
  _tabBtns.forEach(b => b.classList.toggle("active", b.dataset.cat === cat));
  _ribbonBody.querySelectorAll(".ribbon-panel").forEach(p =>
    p.classList.toggle("ribbon-panel--active", p.dataset.cat === cat));
}

// ─────────────────────────── public API ──────────────────────────────────────

export function createRibbon({
  container,      // DOM element to append the ribbon into (#ribbon-container)
  apiFn,          // async fn(path, opts) → data
  onBuilt,        // fn(filename, url)
  projectId,
} = {}) {
  _api = apiFn;
  _onBuilt = onBuilt;
  _projectId = projectId;
  _program = _emptyProgram();

  const bar = _buildRibbonDOM();

  // Mount inside the dedicated grid slot
  const target = container || document.getElementById("ribbon-container") || document.body;
  target.appendChild(bar);

  // Tab wiring
  _tabBtns.forEach(b => b.addEventListener("click", () => _activateTab(b.dataset.cat)));
  _activateTab(Object.keys(CATALOG)[0]);

  // Chevron
  let saved = "0";
  try { saved = localStorage.getItem(LS_COLLAPSED) ?? "0"; } catch (_) {}
  _setCollapsed(saved === "1");
  _chevron.addEventListener("click", () => _setCollapsed(!_collapsed));

  _renderTree();

  return {
    /** Update the current project id (called when user switches projects). */
    setProjectId(id) { _projectId = id; },
    /** Reset features to empty (called when user creates a new project). */
    reset() { _program = _emptyProgram(); _renderTree(); _setStatus("", ""); },
    /** Expose the current program (for debugging / export). */
    getProgram() { return _program; },
  };
}
