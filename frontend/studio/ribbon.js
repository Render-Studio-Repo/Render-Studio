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

import { getUnits, parseLength, displayValue } from "./units.js?v=20260908-units-bar";
import {
  openCreateTaskBanner,
  closeCreateTaskBanner,
} from "../components/create-task-banner.js?v=20260907-fc-pad-ok";

/** Primitives that support VibeCAD-style drag-to-draw in the viewport. */
const DRAWABLE_CREATE = new Set(["box", "cylinder", "sphere", "cone", "torus"]);

/** Shared placement fields (mm) — drag viewport to draw, or type. */
const PLACEMENT_FIELDS = [
  { name: "at_x", label: "Position X (mm)", type: "number", default: 0, step: 1 },
  { name: "at_y", label: "Position Y (mm)", type: "number", default: 0, step: 1 },
  { name: "at_z", label: "Position Z (mm)", type: "number", default: 0, step: 1 },
];

function _atFromValues(v) {
  return [+v.at_x || 0, +v.at_y || 0, +v.at_z || 0];
}

/** FreeCAD PartDesign Pad / Pocket task fields (no preset profile, no XYZ popup). */
function _padLikeFields({ combine = "join" } = {}) {
  return [
    { name: "length", label: "Length (mm)", type: "number", default: 10, min: 0.01, step: 1 },
    {
      name: "type",
      label: "Type",
      type: "select",
      default: "one",
      options: [
        { value: "one", label: "Dimension" },
        { value: "two", label: "Two dimensions" },
        { value: "symmetric", label: "Symmetric to plane" },
        { value: "through", label: "Through all" },
      ],
    },
    {
      name: "length2",
      label: "2nd length (mm)",
      type: "number",
      default: 10,
      min: 0,
      step: 1,
      visibleWhen: { type: "two" },
    },
    { name: "reversed", label: "Reversed", type: "checkbox", default: false },
    { name: "taper", label: "Taper angle", type: "number", default: 0, step: 1 },
    {
      name: "combine",
      label: "Operation",
      type: "select",
      default: combine,
      options: [
        { value: "join", label: "Fuse" },
        { value: "cut", label: "Cut" },
        { value: "new_body", label: "New body" },
      ],
    },
  ];
}

function _padLikeFeature(v, fallbackCombine = "add", profile = null, plane = "XY") {
  const height = Number(v.length ?? v.height);
  if (!Number.isFinite(height) || Math.abs(height) < 1e-9) {
    throw new Error("Length must be > 0");
  }
  let combine = String(v.combine || fallbackCombine || "add").toLowerCase();
  if (combine === "join") combine = "add";
  if (combine === "new_body") combine = "new";
  if (!profile?.length) {
    throw new Error("Select a face or a closed sketch, then click OK.");
  }
  return {
    op: "extrude",
    combine,
    profile,
    height: v.reversed ? -Math.abs(height) : Math.abs(height),
    plane: plane || "XY",
    at: [0, 0, 0],
  };
}

function _fieldDefaults(entry) {
  const out = {};
  for (const f of entry.fields || []) {
    out[f.name] = f.default;
  }
  return out;
}

// ─────────────────────────── catalog ───────────────────────────────────────

/**
 * Each entry defines one toolbar button.
 *
 * fields:  array of { name, label, type, default, min?, step?, options? }
 *   type = "number" | "select" | "checkbox"
 *
 * featureOf(values) → Feature dict to append.
 */
// Tool id → VibeCAD PartDesign icons (LGPL, copied from 10-X-eng/vibecad).
const PD = "/assets/icons/cad/vibecad/partdesign";
const ICON_SVG = {
  box:      `${PD}/PartDesign_AdditiveBox.svg`,
  cylinder: `${PD}/PartDesign_AdditiveCylinder.svg`,
  sphere:   `${PD}/PartDesign_AdditiveSphere.svg`,
  cone:     `${PD}/PartDesign_AdditiveCone.svg`,
  torus:    `${PD}/PartDesign_AdditiveTorus.svg`,
  extrude:  `${PD}/PartDesign_Pad.svg`,
  pad:      `${PD}/PartDesign_Pad.svg`,
  pocket:   `${PD}/PartDesign_Pocket.svg`,
  revolve:  `${PD}/PartDesign_Revolution.svg`,
  groove:   `${PD}/PartDesign_Groove.svg`,
  hole:     `${PD}/PartDesign_Hole.svg`,
  fillet:   `${PD}/PartDesign_Fillet.svg`,
  chamfer:  `${PD}/PartDesign_Chamfer.svg`,
  draft:    `${PD}/PartDesign_Draft.svg`,
  shell:    `${PD}/PartDesign_Thickness.svg`,
  thickness:`${PD}/PartDesign_Thickness.svg`,
  mirror:   `${PD}/PartDesign_Mirrored.svg`,
  boolean:  `${PD}/PartDesign_Boolean.svg`,
};

/** HTML for a tool's icon: an <img> when an icon exists, else the emoji glyph. */
function _iconMarkup(entry, cls) {
  const src = ICON_SVG[entry.id];
  if (src) {
    return `<img class="${cls}" src="${src}" alt="" draggable="false" />`;
  }
  if (entry.sketchTool || entry.sketchAction) {
    return `<span class="${cls} rb-icon-sketch">${entry.icon}</span>`;
  }
  return `<span class="${cls}">${entry.icon}</span>`;
}

const CATALOG = {
  Create: [
    {
      id: "box",
      label: "Box",
      icon: "⬛",
      desc: "Drag base → height like VibeCAD Additive Box",
      viewportTool: "create_box",
      createPreview: true,
      fields: [
        { name: "length", label: "Length (mm)", type: "number", default: 20, min: 0.1, step: 1 },
        { name: "width",  label: "Width (mm)",  type: "number", default: 20, min: 0.1, step: 1 },
        { name: "height", label: "Height (mm)", type: "number", default: 10, min: 0.1, step: 1 },
        { name: "combine", label: "Type", type: "select", default: "new",
          options: ["new","add","cut","intersect"] },
        ...PLACEMENT_FIELDS,
      ],
      featureOf: v => {
        const length = parseFloat(v.length);
        const width = parseFloat(v.width);
        const height = parseFloat(v.height);
        if (![length, width, height].every((n) => Number.isFinite(n) && n > 0)) {
          throw new Error("Length, width, and height must be positive numbers");
        }
        return { op: "box", combine: v.combine, length, width, height, at: _atFromValues(v) };
      },
    },
    {
      id: "cylinder",
      label: "Cylinder",
      icon: "🔵",
      desc: "Cylinder / tube (VibeCAD Additive Cylinder)",
      viewportTool: "create_cylinder",
      createPreview: true,
      fields: [
        { name: "radius", label: "Radius (mm)", type: "number", default: 10, min: 0.1, step: 0.5 },
        { name: "height", label: "Height (mm)", type: "number", default: 20, min: 0.1, step: 1 },
        { name: "combine", label: "Type", type: "select", default: "new",
          options: ["new","add","cut","intersect"] },
        ...PLACEMENT_FIELDS,
      ],
      featureOf: v => ({ op:"cylinder", combine:v.combine,
        radius:+v.radius, height:+v.height, at: _atFromValues(v) }),
    },
    {
      id: "sphere",
      label: "Sphere",
      icon: "🟡",
      desc: "Sphere primitive (VibeCAD Additive Sphere)",
      viewportTool: "create_sphere",
      createPreview: true,
      fields: [
        { name: "radius", label: "Radius (mm)", type: "number", default: 10, min: 0.1, step: 0.5 },
        { name: "combine", label: "Type", type: "select", default: "new",
          options: ["new","add","cut","intersect"] },
        ...PLACEMENT_FIELDS,
      ],
      featureOf: v => ({ op:"sphere", combine:v.combine, radius:+v.radius, at: _atFromValues(v) }),
    },
    {
      id: "cone",
      label: "Cone",
      icon: "🔺",
      desc: "Cone / frustum (VibeCAD Additive Cone)",
      viewportTool: "create_cone",
      createPreview: true,
      fields: [
        { name: "bottom_radius", label: "Base radius (mm)", type:"number", default:10, min:0.1, step:0.5 },
        { name: "top_radius",    label: "Top radius (mm)",  type:"number", default:0,  min:0,   step:0.5 },
        { name: "height",        label: "Height (mm)",      type:"number", default:20, min:0.1, step:1   },
        { name: "combine", label: "Type", type: "select", default: "new",
          options: ["new","add","cut","intersect"] },
        ...PLACEMENT_FIELDS,
      ],
      featureOf: v => ({ op:"cone", combine:v.combine,
        bottom_radius:+v.bottom_radius, top_radius:+v.top_radius, height:+v.height,
        at: _atFromValues(v) }),
    },
    {
      id: "torus",
      label: "Torus",
      icon: "⭕",
      desc: "Torus / ring (VibeCAD Additive Torus)",
      viewportTool: "create_torus",
      createPreview: true,
      fields: [
        { name: "major_radius", label: "Major radius (mm)", type:"number", default:20, min:0.1, step:1 },
        { name: "minor_radius", label: "Minor (tube) (mm)", type:"number", default:5,  min:0.1, step:0.5 },
        { name: "combine", label: "Type", type: "select", default: "new",
          options: ["new","add","cut","intersect"] },
        ...PLACEMENT_FIELDS,
      ],
      featureOf: v => ({ op:"torus", combine:v.combine,
        major_radius:+v.major_radius, minor_radius:+v.minor_radius, at: _atFromValues(v) }),
    },
    {
      id: "extrude",
      label: "Extrude",
      icon: "⬆",
      desc: "Pad a face or sketch — set Length, then OK (FreeCAD PartDesign)",
      viewportTool: "presspull",
      liveViewport: true,
      liveApply: "presspull",
      createPreview: true,
      shortcut: "E / P",
      fields: _padLikeFields({ combine: "join" }),
      interactive: "drag_height",
      featureOf: (v) => _padLikeFeature(v, "add"),
    },
    {
      id: "revolve",
      label: "Revolve",
      icon: "🔄",
      desc: "Revolve a profile (VibeCAD / PartDesign Revolution)",
      createPreview: true,
      fields: [
        { name: "profile_preset", label: "Profile", type:"select", default:"vase",
          options:["vase","L-profile","rectangle"] },
        { name: "scale", label: "Scale (mm)", type:"number", default:20, min:1, step:1 },
        { name: "angle", label: "Angle (°)", type:"number", default:360, min:1, max:360, step:15 },
        { name: "combine", label: "Type", type: "select", default: "new",
          options: ["new","add","cut","intersect"] },
        ...PLACEMENT_FIELDS,
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
          angle:+v.angle, at: _atFromValues(v) };
      },
    },
    {
      id: "hole",
      label: "Hole",
      icon: "🕳",
      desc: "Cut a hole (VibeCAD / PartDesign Hole) — live Press-Pull cut or parametric",
      viewportTool: "presspull-cut",
      liveViewport: true,
      createPreview: true,
      shortcut: "O",
      fields: [
        { name: "diameter", label: "Diameter (mm)", type:"number", default:5, min:0.1, step:0.5 },
        { name: "depth",    label: "Depth (mm) — 0 = through", type:"number", default:0, min:0, step:1 },
        ...PLACEMENT_FIELDS,
      ],
      featureOf: v => {
        const through = +v.depth === 0;
        return { op:"hole", diameter:+v.diameter,
          through, depth: through ? undefined : +v.depth,
          at: _atFromValues(v) };
      },
    },
    {
      id: "pad",
      label: "Pad",
      icon: "⬆",
      desc: "Pad a face or sketch — set Length, then OK (FreeCAD PartDesign)",
      viewportTool: "presspull",
      liveViewport: true,
      liveApply: "presspull",
      createPreview: true,
      shortcut: "P",
      fields: _padLikeFields({ combine: "join" }),
      interactive: "drag_height",
      featureOf: (v) => _padLikeFeature(v, "add"),
    },
    {
      id: "pocket",
      label: "Pocket",
      icon: "⬇",
      desc: "Pocket a face or sketch — set Length, then OK (FreeCAD PartDesign)",
      viewportTool: "presspull-cut",
      liveViewport: true,
      liveApply: "presspull",
      createPreview: true,
      shortcut: "⇧P",
      fields: _padLikeFields({ combine: "cut" }),
      featureOf: (v) => _padLikeFeature(v, "cut"),
    },
  ],

  Modify: [
    {
      id: "fillet",
      label: "Fillet",
      icon: "◠",
      desc: "Round edges (VibeCAD PartDesign Fillet) — live or parametric",
      viewportTool: "fillet",
      liveViewport: true,
      shortcut: "⇧F",
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
      desc: "Bevel edges (VibeCAD PartDesign Chamfer) — live or parametric",
      viewportTool: "chamfer",
      liveViewport: true,
      shortcut: "⇧C",
      fields: [
        { name: "length", label: "Length (mm)", type:"number", default:1.5, min:0.01, step:0.25 },
        { name: "edges",  label: "Edges",       type:"select", default:"all",
          options:["all","vertical","horizontal","top","bottom","front","back","left","right"] },
      ],
      featureOf: v => ({ op:"chamfer", length:+v.length, edges:v.edges }),
    },
    {
      id: "thickness",
      label: "Thickness",
      icon: "🪣",
      desc: "Hollow / shell walls (VibeCAD PartDesign Thickness)",
      shortcut: "⇧T",
      fields: [
        { name: "thickness", label: "Wall thickness (mm)", type:"number", default:2, min:0.1, step:0.5 },
        { name: "openings",  label: "Open face",           type:"select", default:"top",
          options:["top","bottom","front","back","left","right"] },
      ],
      featureOf: v => ({ op:"shell", thickness:+v.thickness, openings:v.openings }),
    },
    {
      id: "boolean",
      label: "Boolean Cut",
      icon: "✂",
      desc: "Cut a face or sketch — set Length, then OK (FreeCAD PartDesign Pocket)",
      viewportTool: "presspull-cut",
      liveViewport: true,
      liveApply: "presspull",
      createPreview: true,
      shortcut: "B",
      fields: _padLikeFields({ combine: "cut" }),
      featureOf: (v) => _padLikeFeature(v, "cut"),
    },
    {
      id: "groove",
      label: "Groove",
      icon: "🔄",
      desc: "Revolve-cut a profile (VibeCAD PartDesign Groove)",
      shortcut: "⇧R",
      createPreview: true,
      fields: [
        { name: "profile_preset", label: "Profile", type:"select", default:"L-profile",
          options:["L-profile","rectangle","vase"] },
        { name: "scale", label: "Scale (mm)", type:"number", default:20, min:1, step:1 },
        { name: "angle", label: "Angle (°)", type:"number", default:360, min:1, max:360, step:15 },
        { name: "combine", label: "Type", type: "select", default: "cut",
          options: ["cut","add","intersect","new"] },
        ...PLACEMENT_FIELDS,
      ],
      featureOf: v => {
        const s = +v.scale;
        const profiles = {
          vase:        [[0,0],[s,0],[s*0.9,s*0.06],[s*0.8,s*0.7],[s*1.0,s],[s*0.92,s*0.995],[0,s*0.995]],
          "L-profile": [[0,0],[s,0],[s,s*0.2],[s*0.2,s*0.2],[s*0.2,s],[0,s]],
          rectangle:   [[s*0.4,0],[s,0],[s,s],[s*0.4,s]],
        };
        return { op:"revolve", combine:v.combine || "cut",
          profile: profiles[v.profile_preset] || profiles["L-profile"],
          angle:+v.angle, at: _atFromValues(v) };
      },
    },
    {
      id: "draft",
      label: "Draft",
      icon: "⟋",
      desc: "Taper faces (VibeCAD PartDesign Draft) — uses chamfer-style edge relief for now",
      shortcut: "⇧D",
      fields: [
        { name: "length", label: "Draft length (mm)", type:"number", default:1, min:0.01, step:0.25 },
        { name: "edges",  label: "Edges", type:"select", default:"vertical",
          options:["all","vertical","horizontal","top","bottom","front","back","left","right"] },
      ],
      featureOf: v => ({ op:"chamfer", length:+v.length, edges:v.edges }),
    },
    {
      id: "transform",
      label: "Move / Rotate",
      icon: "✥",
      desc: "Viewport transform gizmo with move arrows and rotation rings",
      viewportTool: "transform",
      shortcut: "G",
      createPreview: false,
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
      id: "measure",
      label: "Measure",
      icon: "📏",
      desc: "Measure selected objects, picked edges/faces, and reference distances",
      viewportTool: "measure",
      shortcut: "M",
    },
    {
      id: "mirror",
      label: "Mirror",
      icon: "↔",
      desc: "Viewport mirror plane with live preview (VibeCAD Mirrored)",
      viewportTool: "mirror",
      liveViewport: true,
      shortcut: "⇧M",
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
      createPreview: true,
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
        ...PLACEMENT_FIELDS,
      ],
      featureOf: v => {
        const bSec = v.bottom_shape === "circle"
          ? { z:0, radius:+v.bottom_size/2 }
          : { z:0, width:+v.bottom_size, height:+v.bottom_size };
        const tSec = v.top_shape === "circle"
          ? { z:+v.height, radius:+v.top_size/2 }
          : { z:+v.height, width:+v.top_size, height:+v.top_size };
        return { op:"loft", combine:v.combine, sections:[bSec, tSec], at: _atFromValues(v) };
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
      desc: "Viewport mirror plane with live preview",
      viewportTool: "mirror",
      fields: [
        { name: "plane", label: "Mirror plane", type:"select", default:"YZ",
          options:["YZ","XZ","XY"] },
      ],
      featureOf: v => ({ op:"mirror", plane:v.plane, keep_original:true }),
    },
  ],

  Export: [
    {
      id: "export_model",
      label: "Export",
      icon: "⬇",
      desc: "Download GLB, STL, STEP, or 3MF for the active model",
      exportAction: "current",
    },
  ],
};

/** Fusion-style sketch environment ribbon (visible when SKETCH workspace tab is active). */
const SKETCH_CATALOG = {
  Sketch: [
    {
      id: "create_sketch",
      label: "Create Sketch",
      icon: "✎",
      desc: "Start a new sketch (locks to 2D view)",
      sketchAction: "start",
      fields: [
        { name: "plane", label: "Plane", type: "select", default: "XY", options: ["XY", "XZ", "YZ", "Face"] },
      ],
      featureOf: () => null,
    },
    {
      id: "sketch_select",
      label: "Select",
      icon: "↖",
      desc: "Select sketch geometry",
      sketchTool: "select",
    },
    {
      id: "sketch_line",
      label: "Line",
      icon: "╱",
      desc: "Draw connected line segments",
      sketchTool: "line",
    },
    {
      id: "sketch_rectangle",
      label: "Rectangle",
      icon: "▭",
      desc: "Two-corner rectangle",
      sketchTool: "rectangle",
    },
    {
      id: "sketch_circle",
      label: "Circle",
      icon: "○",
      desc: "Center + radius",
      sketchTool: "circle",
    },
    {
      id: "sketch_arc",
      label: "Arc",
      icon: "◠",
      desc: "Three-point arc",
      sketchTool: "arc",
    },
    {
      id: "sketch_polygon",
      label: "Polygon",
      icon: "⬡",
      desc: "Inscribed hexagon",
      sketchTool: "polygon",
    },
    {
      id: "sketch_point",
      label: "Point",
      icon: "·",
      desc: "Place a point",
      sketchTool: "point",
    },
    {
      id: "sketch_spline",
      label: "Spline",
      icon: "∿",
      desc: "Fit-point spline (double-click finish)",
      sketchTool: "spline",
    },
  ],
  Modify: [
    {
      id: "sketch_fillet",
      label: "Fillet",
      icon: "◜",
      desc: "Fillet sketch corners",
      sketchTool: "fillet",
    },
    {
      id: "sketch_chamfer",
      label: "Chamfer",
      icon: "◢",
      desc: "Chamfer sketch corners",
      sketchTool: "chamfer",
    },
    {
      id: "sketch_trim",
      label: "Trim",
      icon: "✂",
      desc: "Click a segment to remove it",
      sketchTool: "trim",
    },
    {
      id: "sketch_extend",
      label: "Extend",
      icon: "↗",
      desc: "Extend curves",
      sketchTool: "extend",
    },
    {
      id: "sketch_offset",
      label: "Offset",
      icon: "⧈",
      desc: "Offset a line by 5 mm",
      sketchTool: "offset",
    },
    {
      id: "sketch_mirror",
      label: "Mirror",
      icon: "↔",
      desc: "Mirror sketch geometry",
      sketchTool: "mirror",
    },
    {
      id: "sketch_rect_pattern",
      label: "Rect Pattern",
      icon: "▦",
      desc: "Rectangular pattern",
      sketchTool: "rect_pattern",
    },
    {
      id: "sketch_circ_pattern",
      label: "Circ Pattern",
      icon: "◎",
      desc: "Circular pattern",
      sketchTool: "circ_pattern",
    },
  ],
  Constraints: [
    {
      id: "constraint_coincident",
      label: "Coincident",
      icon: "◎",
      desc: "Make two points coincident",
      sketchTool: "coincident",
    },
    {
      id: "constraint_collinear",
      label: "Collinear",
      icon: "—",
      desc: "Make lines collinear",
      sketchTool: "collinear",
    },
    {
      id: "constraint_concentric",
      label: "Concentric",
      icon: "◉",
      desc: "Share circle centers",
      sketchTool: "concentric",
    },
    {
      id: "constraint_parallel",
      label: "Parallel",
      icon: "∥",
      desc: "Parallel lines",
      sketchTool: "parallel",
    },
    {
      id: "constraint_perpendicular",
      label: "Perpendicular",
      icon: "⊥",
      desc: "Perpendicular lines",
      sketchTool: "perpendicular",
    },
    {
      id: "constraint_horizontal",
      label: "Horizontal",
      icon: "↔",
      desc: "Horizontal line",
      sketchTool: "horizontal",
    },
    {
      id: "constraint_vertical",
      label: "Vertical",
      icon: "↕",
      desc: "Vertical line",
      sketchTool: "vertical",
    },
    {
      id: "constraint_equal",
      label: "Equal",
      icon: "=",
      desc: "Equal length or radius",
      sketchTool: "equal",
    },
    {
      id: "constraint_tangent",
      label: "Tangent",
      icon: "⌒",
      desc: "Tangent constraint",
      sketchTool: "tangent",
    },
    {
      id: "constraint_fix",
      label: "Fix",
      icon: "🔒",
      desc: "Fix geometry in place",
      sketchTool: "fix",
    },
    {
      id: "constraint_dimension",
      label: "Dimension",
      icon: "📐",
      desc: "Driving dimension",
      sketchTool: "dimension",
    },
    {
      id: "constraint_angle",
      label: "Angle",
      icon: "∠",
      desc: "Angle between two lines (degrees)",
      sketchTool: "angle",
    },
  ],
  Finish: [
    {
      id: "finish_sketch",
      label: "Finish Sketch",
      icon: "✓",
      desc: "Exit 2D edit and keep profile",
      sketchAction: "finish",
    },
    {
      id: "stop_sketch",
      label: "Stop Sketch",
      icon: "✕",
      desc: "Cancel sketch without saving",
      sketchAction: "cancel",
    },
    {
      id: "extrude_sketch",
      label: "Extrude",
      icon: "⬆",
      desc: "Extrude the closed sketch profile with FreeCAD",
      sketchAction: "extrude",
      fields: [
        { name: "height", label: "Height (mm)", type: "number", default: 10, min: 0.1, step: 1 },
        { name: "combine", label: "Type", type: "select", default: "new", options: ["new", "add", "cut"] },
      ],
      featureOf: (v, ctx) => {
        if (!ctx?.profile?.length) throw new Error("Finish the sketch with a closed profile first");
        return {
          op: "extrude",
          combine: v.combine,
          profile: ctx.profile,
          height: +v.height,
          plane: ctx.plane || "XY",
        };
      },
    },
  ],
};

const SOLID_CATALOG = CATALOG;

/** SOLID design chrome: no Create / Modify / Pattern / Export tabs or Box…Pocket strip. Catalog APIs stay for shortcuts. */
const SOLID_RIBBON_UI_CATALOG = {};

/** Design WORKSPACE tab — enter the shared 3D room and build it. */
const WORKSPACE_CATALOG = {
  Enter: [
    {
      id: "ws_enter_vr",
      label: "Enter VR",
      icon: "◉",
      desc: "Enter the same workspace in a headset",
      workspaceAction: "enter-vr",
    },
    {
      id: "ws_god",
      label: "God view",
      icon: "↑",
      desc: "Fly above the agents and the room",
      workspaceAction: "god-view",
    },
  ],
  World: [
    { id: "ws_floor", label: "Floor", icon: "▬", desc: "Studio floor", workspaceAction: "place", piece: "floor" },
    { id: "ws_table", label: "Table", icon: "▤", desc: "Work table", workspaceAction: "place", piece: "table" },
    { id: "ws_round", label: "Round table", icon: "◎", desc: "Agent round table", workspaceAction: "place", piece: "round_table" },
    { id: "ws_wall", label: "Wall", icon: "▥", desc: "Partition wall", workspaceAction: "place", piece: "wall" },
    { id: "ws_pedestal", label: "Pedestal", icon: "▲", desc: "Arm pedestal", workspaceAction: "place", piece: "pedestal" },
    { id: "ws_lamp", label: "Lamp", icon: "✦", desc: "Area light", workspaceAction: "place", piece: "lamp" },
    { id: "ws_spawn", label: "Spawn", icon: "●", desc: "Entry mark", workspaceAction: "place", piece: "spawn" },
    { id: "ws_undo", label: "Undo piece", icon: "↶", desc: "Remove the last placed piece", workspaceAction: "undo-piece" },
    { id: "ws_editor", label: "World editor", icon: "✎", desc: "Open the world-building inspector", workspaceAction: "editor" },
  ],
};

/** Design ROBOTICS tab — Viser viewport + hand-cam window mode. */
const ROBOTICS_CATALOG = {
  Viser: [
    {
      id: "viser_open",
      label: "Viser",
      icon: "◎",
      desc: "Open the Viser web client in the robotics viewport",
      roboticsAction: "viser-open",
    },
    {
      id: "viser_add_ip",
      label: "Network",
      icon: "⌥",
      desc: "Viser, camera, and teleop IPs",
      roboticsAction: "viser-add-ip",
    },
    {
      id: "viser_connect",
      label: "Connect",
      icon: "→",
      desc: "Load the Viser server URL in the viewport",
      roboticsAction: "viser-connect",
    },
  ],
  MuJoCo: [
    {
      id: "sim_tab",
      label: "MuJoCo",
      icon: "△",
      desc: "OpenArm MuJoCo WASM sim — connect bundled or your own URL (not Quest / not DimOS)",
      roboticsAction: "sim-tab",
    },
    {
      id: "sim_scene",
      kind: "input",
      inputAttr: "data-simulation-ribbon-scene",
      label: "Scene",
      placeholder: "openarm_bimanual.xml",
      desc: "MJCF scene — openarm_bimanual.xml is arms only (no table)",
    },
    {
      id: "sim_connect",
      label: "Connect sim",
      icon: "▶",
      desc: "Load the sim URL into the viewer (bundled WASM or your local Mac dev server)",
      roboticsAction: "sim-connect",
    },
    {
      id: "sim_calibrate",
      label: "Snapshot run",
      icon: "●",
      desc: "Write end-of-run analysis to openarm-mujoco/runs/latest.json for MCP",
      roboticsAction: "sim-calibrate",
    },
  ],
  Worktop: [
    {
      id: "worktop_tab",
      label: "Worktop",
      icon: "◎",
      desc: "God view of the agent round table",
      roboticsAction: "worktop-tab",
    },
    {
      id: "god_view",
      label: "God view",
      icon: "↑",
      desc: "Fly above the agents at the round table",
      roboticsAction: "god-view",
    },
  ],
  Teleop: [
    { id: "robot_control_config", label: "Control configuration", icon: "⚙", desc: "Load a robotics profile from a LAN URL or JSON file and review controller mappings", roboticsAction: "control-config" },
    {
      id: "teleop_open",
      label: "Teleop",
      icon: "◉",
      desc: "Open the selected robotics profile’s Teleop UI",
      roboticsAction: "teleop-open",
    },
    {
      id: "teleop_url_field",
      kind: "input",
      inputAttr: "data-teleop-ribbon-url",
      label: "Teleop URL",
      placeholder: "https://192.168.1.77:8443/teleop",
      desc: "Teleop LAN URL. The selected profile determines whether its UI opens full-page.",
    },
    {
      id: "teleop_connect",
      label: "Connect",
      icon: "→",
      desc: "Open Teleop with the selected robotics profile",
      roboticsAction: "teleop-connect",
    },
    {
      id: "teleop_docs",
      label: "Teleop / Robotics setup",
      icon: "?",
      desc: "Open Robotics Configuration docs",
      roboticsAction: "teleop-docs",
    },
  ],
  Printer: [
    {
      id: "printer_tab",
      label: "3D Printer",
      icon: "▣",
      desc: "Printer LAN IP, PIN, bounder, and share settings",
      roboticsAction: "printer-tab",
    },
    {
      id: "printer_config",
      label: "Printer Config",
      icon: "⚙",
      desc: "Update printer IP, PIN, and VR settings",
      roboticsAction: "printer-config",
    },
  ],
  Cloud: [
    {
      id: "cloud_server",
      label: "Cloud",
      icon: "☁",
      desc: "Configure DGX Cloud training, folding data, and MuJoCo or Isaac Sim",
      roboticsAction: "viser-cloud",
    },
  ],
  Cameras: [
    {
      id: "cam_ip",
      label: "Cam IP",
      icon: "◎",
      desc: "Edit hand-camera host IP — opens a popup",
      roboticsAction: "cam-ip",
    },
    {
      id: "cam_enable",
      label: "Cam",
      icon: "▣",
      desc: "Open Left and Right wrist-camera overlays and publish the USB stream",
      roboticsAction: "cam-enable",
    },
    {
      id: "cam_wrist",
      label: "Wrist cams",
      icon: "◻",
      desc: "Desktop Left/Right camera overlays on the PC UI",
      roboticsAction: "cam-wrist",
    },
    {
      id: "cam_debug",
      label: "Debug",
      icon: "☰",
      desc: "Live wrist-camera list — plugged in, Left/Right, swap, rename",
      roboticsAction: "cam-debug",
    },
  ],
  Shell: [
    {
      id: "local_terminal",
      label: "Terminal",
      icon: ">_",
      desc: "Cursor / VS Code terminals on this computer (127.0.0.1:8765)",
      roboticsAction: "local-terminal",
    },
  ],
};

/** Fusion-style rigging environment ribbon (visible when RIGGING workspace tab is active). */
const RIGGING_CATALOG = {
  Control: [
    {
      id: "rig_keyframe",
      label: "Keyframe",
      icon: "◆",
      desc: "Insert keyframe at current time (K)",
      rigAction: "keyframe",
    },
    {
      id: "rig_play",
      label: "Play / Pause",
      icon: "▶",
      desc: "Play animation timeline (Space)",
      rigAction: "play",
    },
    {
      id: "rig_stop",
      label: "Stop",
      icon: "■",
      desc: "Stop and rewind animation",
      rigAction: "stop",
    },
  ],
  Hierarchy: [
    {
      id: "rig_connect",
      label: "Connect",
      icon: "⛓",
      desc: "Click parent bone, then child bone",
      rigAction: "connect",
    },
    {
      id: "rig_delete",
      label: "Delete Bone",
      icon: "⌫",
      desc: "Remove selected bone and its children",
      rigAction: "delete",
    },
    {
      id: "rig_clear",
      label: "Clear Rig",
      icon: "✕",
      desc: "Remove all bones",
      rigAction: "clear",
    },
  ],
  Tools: [
    {
      id: "rig_select",
      label: "Select",
      icon: "↖",
      desc: "Select bones",
      rigTool: "select",
    },
    {
      id: "rig_move",
      label: "Move",
      icon: "✥",
      desc: "Drag bones to reposition",
      rigTool: "move",
    },
    {
      id: "rig_rotate",
      label: "Rotate Joint",
      icon: "↻",
      desc: "Drag to rotate selected joint",
      rigTool: "rotate",
    },
  ],
  Export: [
    {
      id: "rig_export_urdf",
      label: "Export URDF",
      icon: "📄",
      desc: "Write robot.urdf to project",
      rigAction: "export_urdf",
    },
    {
      id: "rig_save",
      label: "Save Rig",
      icon: "💾",
      desc: "Save rigging.json to project",
      rigAction: "save",
    },
    {
      id: "rig_reload",
      label: "Reload",
      icon: "↻",
      desc: "Reload rig from disk",
      rigAction: "reload",
    },
  ],
};

/** Architect environment ribbon: modular house kit tools. */
const ARCHITECT_CATALOG = {
  Build: [
    { id: "arch_wall", label: "Wall", icon: "▥", desc: "Blank 3 ft wall bay (wireframe)", architectTool: "wall" },
    { id: "arch_door", label: "Door", icon: "▯", desc: "Same-size wall bay with a door", architectTool: "door" },
    { id: "arch_window", label: "Window", icon: "▦", desc: "Same-size wall bay with a window", architectTool: "window" },
  ],
  Later: [
    { id: "arch_design", label: "Design", icon: "✦", desc: "Styled kits & materials — in development", architectTool: "image" },
    { id: "arch_structure", label: "Structure", icon: "⌂", desc: "Floors, roofs, levels — in development", architectTool: "roof" },
    { id: "arch_comfort", label: "Comfort", icon: "◐", desc: "Daylight & comfort — in development", architectTool: "service" },
    { id: "arch_review", label: "Review", icon: "☑", desc: "Plan check & export prep — in development", architectTool: "robot" },
  ],
};

// ─────────────────────────── internal state ─────────────────────────────────

let _api = null;           // async fn(path, opts) — injected by init()
let _projectId = null;     // current project id
let _onBuilt = null;       // callback(filename, url, label) after successful build
let _onViewerToast = null; // optional viewer overlay toast
let _onStatus = null;      // fn(kind, message) → bottom #edit-status
let _onGenerating = null;  // callback(active, message) during kernel build
let _onGenerationStarted = null; // callback(data) when build accepted as background job
let _onBuildError = null;
let _onExtrudeFaceDrag = null;
let _onExtrudeProfileDrag = null;
let _hasLoadedMesh = null;  // callback(message) on build failure
let _onViewportTool = null; // callback(toolId, entry) for direct modeling handoff
let _onCreatePreview = null; // callback(action, entry, values?) → live ghost create tools

let _onSketchAction = null; // callback(action, entry, values?) for sketch workflow
let _onExportAction = null;
let _onRiggingAction = null;
let _onRoboticsAction = null;
let _onWorkspaceAction = null;
let _onArchitectAction = null;
let _activeSketchTool = null;
let _isBusy = null;        // fn() → true when another build/prompt is running
let _designTab = "SOLID";
let _sketchContext = { profile: null, plane: "XY" };
let _partId = "part-1";    // active part id

// The live Feature Program (single-part for ribbon-built models)
let _program = null;
let _getActiveModel = null; // fn() → { filename } | null

const MODIFIER_OPS = new Set([
  "fillet", "chamfer", "shell", "mirror", "transform", "hole", "thickness",
]);
const SOLID_OPS = new Set([
  "box", "cylinder", "sphere", "cone", "torus", "extrude", "revolve", "loft",
  "sweep", "wedge", "prism", "pad", "pocket",
]);

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

function _programHasSolid(prog = _program) {
  return (prog?.parts || []).some((p) =>
    (p.features || []).some((f) => SOLID_OPS.has(String(f.op || "").toLowerCase()))
  );
}

function _fileStem(name) {
  const base = String(name || "").split(/[\\/]/).pop() || "";
  return base.replace(/\.[^.]+$/, "").replace(/_part-\d+$/i, "");
}

/** Load the active model's .program.json into `_program` when modifiers need a solid base. */
async function _ensureSolidBaseForModifier(feat) {
  const op = String(feat?.op || "").toLowerCase();
  if (!MODIFIER_OPS.has(op)) return;
  if (_programHasSolid()) return;

  const model = typeof _getActiveModel === "function" ? _getActiveModel() : null;
  const filename = model?.filename || "";
  const stem = _fileStem(filename);
  if (!_api || !_projectId || !stem) {
    throw new Error(
      `${feat.op} needs an existing solid — create a Box/Cylinder first, or select a parametric model.`
    );
  }

  const candidates = [stem, filename.replace(/\.[^.]+$/, "")].filter(
    (s, i, arr) => s && arr.indexOf(s) === i
  );
  let loaded = null;
  for (const base of candidates) {
    try {
      const data = await _api(`/api/projects/${_projectId}/files/${encodeURIComponent(base + ".program.json")}`);
      if (data && Array.isArray(data.parts) && _programHasSolid(data)) {
        loaded = data;
        break;
      }
    } catch (_) {
      /* try next candidate */
    }
  }
  if (!loaded) {
    throw new Error(
      `${feat.op} needs the parametric history for "${stem}". ` +
        `Recreate the solid with Create → Box/Cylinder, then apply ${feat.op} again.`
    );
  }
  _program = {
    ...loaded,
    name: loaded.name || stem,
    units: loaded.units || "mm",
    parts: loaded.parts.map((p) => ({
      ...p,
      features: [...(p.features || [])],
    })),
  };
  _partId = _program.parts[0]?.id || "part-1";
  _renderTree();
}

// ─────────────────────────── DOM references ──────────────────────────────────

let _ribbonBar      = null;   // .ribbon-bar
let _ribbonBody     = null;   // .ribbon-body (the collapsible section)
let _chevron        = null;   // collapse button
let _tabBtns        = null;   // NodeList of .ribbon-tab
let _panelsWrap     = null;   // .ribbon-panels container
let _featureTree    = null;   // .feature-tree list
let _statusEl       = null;   // .ribbon-status span
let _statusCopyBtn  = null;   // copy error button
let _statusCopyText = "";     // full text for clipboard
let _dialog         = null;   // .ribbon-dialog overlay
let _collapsed      = true;
const LS_COLLAPSED  = "render3d:ribbonCollapsed:v2";
const LS_COLLAPSED_LEGACY = "render3d:ribbonCollapsed";

export function isRibbonCollapsedPref() {
  try {
    const saved = localStorage.getItem(LS_COLLAPSED);
    if (saved === "0" || saved === "1") return saved === "1";
  } catch (_) {}
  return true;
}

// ─────────────────────────── build → API ─────────────────────────────────────

let _buildInFlight = false;

async function _buildProgram(label) {
  if (!_api || !_projectId) return;
  // Only block on our own in-flight CAD rebuild — never on AI "generating" state.
  if (_buildInFlight) {
    _setStatus("Wait for the current CAD rebuild to finish…", "error");
    throw new Error("A build is already running");
  }
  const toolLabel = String(label || "solid").trim() || "solid";
  _program.name = toolLabel;
  _program.description = `Ribbon ${toolLabel}`;
  _setStatus(`Building ${toolLabel}…`, "loading");
  // Sync CAD kernel rebuild — never open the AI "Generating…" overlay.
  _buildInFlight = true;
  try {
    const data = await _api(`/api/projects/${_projectId}/build?sync=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(_program),
    }, 120000);
    if (data.accepted || data.status === "running") {
      // Legacy async response — keep quiet watch without AI generate copy.
      _setStatus(`Building ${toolLabel}…`, "loading");
      _onGenerationStarted?.(data);
      return data;
    }
    _program.name = data.program?.name || _program.name;
    _setStatus(`✓ ${data.filename}`, "ok");
    _renderTree();
    if (_onBuilt) await _onBuilt(data.filename, data.url);
    return data;
  } catch (err) {
    const msg = err.message || "build failed";
    _setStatus("✗ " + msg, "error");
    _onBuildError?.(msg);
    throw err;
  } finally {
    _buildInFlight = false;
  }
}

// ─────────────────────────── dialog ──────────────────────────────────────────

function _openDialog(entry, onOk, cat) {
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
      ${_iconMarkup(entry, "rdlg-icon")}
      <span class="rdlg-title">${entry.label}</span>
      <span class="rdlg-desc">${entry.desc}</span>
      <button class="rdlg-close" aria-label="Close">✕</button>
    </div>
    <form class="rdlg-form" id="rdlg-form"></form>
    <div class="rdlg-footer">
      <span class="rdlg-tip">Enter → OK &nbsp;·&nbsp; Esc → cancel</span>
      <button type="button" class="btn secondary rdlg-cancel">Cancel</button>
      <button type="button" class="btn primary rdlg-ok">${(cat === "Modify" || cat === "Pattern") ? "Apply" : "OK &amp; Build"}</button>
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
    } else if (/\(mm\)/.test(f.label)) {
      // Length field: unit-aware text input ("25", "25mm", "1in", "0.5 in")
      input = document.createElement("input");
      input.type = "text";
      input.dataset.length = "1";
      input.spellcheck = false;
      input.value = String(displayValue(f.default ?? 0));
      label.textContent = f.label.replace("(mm)", `(${getUnits()})`);
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
      if (f.type === "checkbox") {
        values[f.name] = el.checked;
      } else if (el.dataset?.length) {
        const mm = parseLength(el.value);
        if (!Number.isFinite(mm)) throw new Error(`Invalid length for ${f.label}: "${el.value}"`);
        values[f.name] = mm; // featureOf consumes mm
      } else {
        values[f.name] = el.value;
      }
    }
    try {
      if (onOk) {
        onOk(values);
        _closeDialog();
        return;
      }
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

function _openExtrudeDragDialog(entry) {
  _closeDialog();
  const fields = entry.fields.filter((f) => f.name !== "height");
  const overlay = document.createElement("div");
  overlay.className = "ribbon-dialog-overlay";
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) _closeDialog(); });

  const box = document.createElement("div");
  box.className = "ribbon-dialog";
  box.innerHTML = `
    <div class="rdlg-header">
      ${_iconMarkup(entry, "rdlg-icon")}
      <span class="rdlg-title">${entry.label}</span>
      <span class="rdlg-desc">${entry.desc} — then drag depth in the viewport</span>
      <button class="rdlg-close" aria-label="Close">✕</button>
    </div>
    <form class="rdlg-form" id="rdlg-form"></form>
    <div class="rdlg-footer">
      <span class="rdlg-tip">Next step: drag arrow in viewport to set depth</span>
      <button type="button" class="btn secondary rdlg-cancel">Cancel</button>
      <button type="button" class="btn primary rdlg-ok">Continue &amp; drag</button>
    </div>`;

  const form = box.querySelector("#rdlg-form");
  for (const f of fields) {
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
    } else {
      input = document.createElement("input");
      input.type = "number";
      if (f.min !== undefined) input.min = f.min;
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
    for (const f of fields) {
      const el = form.querySelector(`#rdlg-${f.name}`);
      values[f.name] = el?.value;
    }
    _closeDialog();
    _onExtrudeProfileDrag?.(values, entry.featureOf);
  };

  box.querySelector(".rdlg-ok").addEventListener("click", ok);
  box.querySelector(".rdlg-cancel").addEventListener("click", _closeDialog);
  box.querySelector(".rdlg-close").addEventListener("click", _closeDialog);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  _dialog = overlay;
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
  // Keep the ribbon chrome clean — status/errors belong in #edit-status (bottom).
  if (_statusEl) {
    _statusEl.textContent = "";
    _statusEl.title = "";
    _statusEl.className = "ribbon-status";
  }
  _statusCopyText = "";
  if (_statusCopyBtn) {
    _statusCopyBtn.classList.add("ribbon-status-copy--hidden");
    _statusCopyBtn.disabled = true;
    if (_statusCopyBtn.textContent === "Copied" || _statusCopyBtn.textContent === "Copy failed") {
      _statusCopyBtn.textContent = "Copy";
    }
  }
  const text = String(msg || "").replace(/^[✓✗]\s*/, "").trim();
  if (!text) return;
  const kind = cls === "loading" ? "loading" : cls === "error" ? "error" : "ok";
  try {
    _onStatus?.(kind, text);
  } catch (_) {
    /* ignore */
  }
  try {
    _onViewerToast?.(text, { kind, durationMs: kind === "loading" ? 0 : 3200 });
  } catch (_) {
    /* ignore */
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

function setActiveSketchTool(tool) {
  _activeSketchTool = tool || null;
  if (!_ribbonBar) return;
  _ribbonBar.querySelectorAll(".ribbon-btn[data-sketch-tool]").forEach((btn) => {
    btn.classList.toggle("ribbon-btn--active", btn.dataset.sketchTool === tool);
  });
}

function _mountCatalog(catalog) {
  if (!_panelsWrap || !_ribbonBar) return;
  const tabsContainer = _ribbonBar.querySelector(".ribbon-tabs");
  if (!tabsContainer) return;
  tabsContainer.innerHTML = "";
  _panelsWrap.innerHTML = "";
  const cats = Object.keys(catalog || {});
  _ribbonBar.classList.toggle("ribbon-bar--no-tool-chrome", cats.length === 0);
  if (!cats.length) {
    _tabBtns = tabsContainer.querySelectorAll(".ribbon-tab");
    _activateTab(null);
    return;
  }

  for (const cat of cats) {
    const tabBtn = document.createElement("button");
    tabBtn.type = "button";
    tabBtn.className = "ribbon-tab";
    tabBtn.dataset.cat = cat;
    tabBtn.textContent = cat;
    tabBtn.addEventListener("click", () => _activateTab(cat));
    tabsContainer.appendChild(tabBtn);
  }
  _tabBtns = tabsContainer.querySelectorAll(".ribbon-tab");

  for (const [cat, entries] of Object.entries(catalog)) {
    const panel = document.createElement("div");
    panel.className = "ribbon-panel";
    panel.dataset.cat = cat;
    for (const entry of entries) {
      entry._cat = cat; // stash for dialog label
      if (entry.kind === "input") {
        const wrap = document.createElement("label");
        wrap.className = "ribbon-url-field";
        wrap.dataset.id = entry.id;
        wrap.innerHTML = `<span>${entry.label}</span><input type="text" spellcheck="false" autocomplete="off" ${entry.inputAttr || "data-viser-ribbon-url"} placeholder="${entry.placeholder || "http://127.0.0.1:8095"}" aria-label="${entry.label}" />`;
        panel.appendChild(wrap);
        continue;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ribbon-btn";
      btn.dataset.id = entry.id;
      btn.title = entry.shortcut ? `${entry.desc} (${entry.shortcut})` : entry.desc;
      if (entry.sketchTool) btn.dataset.sketchTool = entry.sketchTool;
      if (entry.roboticsAction) btn.dataset.roboticsAction = entry.roboticsAction;
      if (entry.roboticsAction === "teleop-connect") btn.setAttribute("data-teleop-connect", "");
      if (entry.roboticsAction === "teleop-docs") btn.setAttribute("data-teleop-docs", "");
      if (entry.sketchAction === "finish") btn.classList.add("ribbon-btn--finish-sketch");
      if (entry.sketchAction === "cancel") btn.classList.add("ribbon-btn--cancel-sketch");
      if (entry.id === "cam_wrist") btn.classList.add("ribbon-btn--wrist-cam");
      if (entry.id === "cam_debug") {
        btn.classList.add("ribbon-btn--cam-debug");
        btn.setAttribute("data-cam-debug", "");
      }
      if (entry.id === "cam_enable") {
        btn.classList.add("ribbon-btn--enable-cam");
        btn.setAttribute("data-wrist-cam-toggle", "");
        btn.setAttribute("aria-pressed", "false");
      }
      if (entry.id === "cam_wrist") {
        btn.setAttribute("data-wrist-cam-toggle", "");
        btn.setAttribute("aria-pressed", "false");
      }
      if (entry.id === "local_terminal") btn.classList.add("ribbon-btn--local-terminal");
      btn.innerHTML = `${_iconMarkup(entry, "rb-icon")}<span class="rb-label">${entry.label}</span>`;
      btn.addEventListener("click", () => _onToolClick(entry));
      panel.appendChild(btn);
    }
    _panelsWrap.appendChild(panel);
  }
  // Mounting the Robotics ribbon is presentation-only. The top-level Robotics
  // workspace owns navigation and opens Robotics Home; live tools launch only
  // after the user explicitly clicks their inner ribbon tab.
  _activateTab(Object.keys(catalog)[0], { notify: _designTab !== "ROBOTICS" });
  if (_activeSketchTool) setActiveSketchTool(_activeSketchTool);
}

function _openCreateTask(entry, cat) {
  closeCreateTaskBanner();
  const canLive = Boolean(entry.liveViewport && entry.viewportTool);
  const isFacePull =
    entry.viewportTool === "presspull" || entry.viewportTool === "presspull-cut";
  const isPadLike = entry.liveApply === "presspull";
  const isEdgeTool =
    entry.viewportTool === "fillet" || entry.viewportTool === "chamfer";
  // FreeCAD / VibeCAD: Extrude·Pad·Pocket·Fillet… start live face/edge pick
  // immediately. A parametric ghost must NOT run at the same time — it steals
  // clicks and makes the whole solid look selected instead of a face.
  const wantPreview =
    Boolean(entry.createPreview) &&
    typeof _onCreatePreview === "function" &&
    !canLive;

  if (wantPreview) {
    try {
      _onCreatePreview("start", entry, _fieldDefaults(entry));
    } catch (_) {
      /* preview is best-effort */
    }
  }

  const liveHint = isPadLike
    ? "Select a face or closed sketch · drag the arrow or type Length · OK applies"
    : isFacePull
      ? "Click a face · drag the arrow or type Length · OK applies"
      : isEdgeTool
        ? "Select edges in the viewport, set radius/length, then Apply"
        : entry.viewportTool === "mirror"
          ? "Pick / drag the mirror plane in the viewport"
          : "Use the live viewport tool · Done closes";

  const syncPressPull = (values) => {
    window.dispatchEvent(
      new CustomEvent("render3d:presspull-task-values", { detail: { values: values || {} } }),
    );
  };

  openCreateTaskBanner({
    entry: {
      ...entry,
      _iconHtml: _iconMarkup(entry, "ctb-icon"),
      // Live face tools don't place a new solid — hide X/Y/Z placement.
      fields: canLive
        ? (entry.fields || []).filter((f) => !/^at_/.test(f.name || ""))
        : entry.fields,
    },
    live: canLive,
    hideDone: isPadLike,
    okLabel: isPadLike || isFacePull ? "OK" : null,
    confirmOnEnter: isPadLike || isFacePull,
    kernelNote: isPadLike
      ? "OK pads/pockets the selected face in place (FreeCAD kernel)"
      : null,
    autoFocus: !(isPadLike || isFacePull),
    modeHint: canLive
      ? liveHint
      : wantPreview
        ? DRAWABLE_CREATE.has(entry.id)
          ? "Drag on the floor to draw size · then OK"
          : "Set sizes · click viewport to place · OK places instantly"
        : "Set parameters · OK applies with CAD kernel",
    stretchLabel: null,
    onStretch: null,
    getUnits,
    parseLength,
    displayValue,
    onChange: (values) => {
      if (isPadLike || isFacePull) {
        syncPressPull(values);
        return;
      }
      if (!wantPreview) return;
      try {
        _onCreatePreview("update", entry, values);
      } catch (_) {}
    },
    onCancel: () => {
      if (wantPreview) {
        try { _onCreatePreview("stop", entry); } catch (_) {}
      }
      if (canLive) {
        try { _onViewportTool?.("off", entry); } catch (_) {}
      }
    },
    onDone: async () => {
      if (isFacePull) {
        syncPressPull();
        await _onViewportTool?.("presspull-apply", entry);
      }
      try {
        _onViewportTool?.("off", entry);
      } catch (_) {}
    },
    onOk: async (values) => {
      if (isPadLike || isFacePull) {
        syncPressPull(values);
        try {
          await _onViewportTool?.("presspull-apply", entry);
          return;
        } catch (err) {
          if (isPadLike && _sketchContext.profile?.length) {
            await _appendFeature(
              entry,
              _padLikeFeature(
                values,
                entry.id === "pocket" || entry.id === "boolean" ? "cut" : "add",
                _sketchContext.profile,
                _sketchContext.plane,
              ),
            );
            return;
          }
          if (isPadLike) throw err;
          // Hole / other live tools: fall through to parametric OK if no face session.
        }
      }
      if (!entry.featureOf) return;
      const feat = entry.featureOf(values);
      if (!feat) return;
      // Drawable primitives: place the viewport ghost immediately (no generate/build wait).
      if (wantPreview && DRAWABLE_CREATE.has(entry.id) && String(feat.combine || "new") === "new") {
        try {
          const placed = _onCreatePreview("getAt", entry);
          const typed = Array.isArray(feat.at) ? feat.at : _atFromValues(values);
          const typedOrigin =
            Math.abs(+typed[0] || 0) < 1e-9 &&
            Math.abs(+typed[1] || 0) < 1e-9 &&
            Math.abs(+typed[2] || 0) < 1e-9;
          if (
            Array.isArray(placed) &&
            placed.length >= 3 &&
            typedOrigin &&
            (Math.abs(placed[0]) > 1e-6 || Math.abs(placed[1]) > 1e-6 || Math.abs(placed[2]) > 1e-6)
          ) {
            feat.at = placed;
            values = {
              ...values,
              at_x: placed[0],
              at_y: placed[1],
              at_z: placed[2],
            };
          }
          const instant = _onCreatePreview("commit", entry, values);
          if (instant?.object || instant?.ok) {
            _part().features.push({ ...feat, id: `f-${Date.now()}` });
            if (!_program.name || _program.name === "ribbon-model") {
              _program.name = entry.label || entry.id || "solid";
            }
            _renderTree();
            _setStatus(`✓ ${entry.label || entry.id}`, "ok");
            return;
          }
        } catch (err) {
          try { _onCreatePreview("stop", entry); } catch (_) {}
          throw err;
        }
      }
      if (wantPreview) {
        try {
          const placed = _onCreatePreview("getAt", entry);
          const typed = Array.isArray(feat.at) ? feat.at : _atFromValues(values);
          const typedOrigin =
            Math.abs(+typed[0] || 0) < 1e-9 &&
            Math.abs(+typed[1] || 0) < 1e-9 &&
            Math.abs(+typed[2] || 0) < 1e-9;
          if (
            Array.isArray(placed) &&
            placed.length >= 3 &&
            typedOrigin &&
            (Math.abs(placed[0]) > 1e-6 || Math.abs(placed[1]) > 1e-6 || Math.abs(placed[2]) > 1e-6)
          ) {
            feat.at = placed;
          }
          _onCreatePreview("stop", entry);
        } catch (_) {}
      }
      if (canLive) {
        try { _onViewportTool?.("off", entry); } catch (_) {}
      }
      await _appendFeature(entry, feat);
    },
  });

  // Start the live tool after Tasks is open so Press-Pull uses the panel, not a HUD popup.
  if (canLive) {
    try {
      _onViewportTool?.(entry.viewportTool, entry);
    } catch (_) {
      /* live tool is best-effort */
    }
  }
}

function _onToolClick(entry) {
  if (entry.exportAction) {
    _onExportAction?.(entry.exportAction, entry);
    return;
  }
  if (entry.architectTool) {
    _onArchitectAction?.("tool", entry, { tool: entry.architectTool });
    return;
  }
  if (entry.architectEdit) {
    _onArchitectAction?.("edit", entry, { edit: entry.architectEdit });
    return;
  }
  if (entry.architectAction) {
    _onArchitectAction?.(entry.architectAction, entry);
    return;
  }
  if (entry.rigTool) {
    _onRiggingAction?.("tool", entry, { tool: entry.rigTool });
    return;
  }
  if (entry.rigAction) {
    _onRiggingAction?.(entry.rigAction, entry);
    return;
  }
  if (entry.workspaceAction) {
    _onWorkspaceAction?.(entry.workspaceAction, entry);
    return;
  }
  if (entry.roboticsAction) {
    _onRoboticsAction?.(entry.roboticsAction, entry);
    return;
  }
  if (entry.sketchTool) {
    setActiveSketchTool(entry.sketchTool);
    _onSketchAction?.("tool", entry, { tool: entry.sketchTool });
    return;
  }
  if (entry.sketchAction === "start_tab") {
    if (entry.fields) {
      _openDialog(entry, (values) => _onSketchAction?.("start_tab", entry, values));
    } else {
      _onSketchAction?.("start_tab", entry, { plane: "XY" });
    }
    return;
  }
  if (entry.sketchAction === "start") {
    if (entry.fields) {
      _openDialog(entry, (values) => _onSketchAction?.("start", entry, values));
    } else {
      _onSketchAction?.("start", entry, { plane: "XY" });
    }
    return;
  }
  if (entry.sketchAction === "finish") {
    _onSketchAction?.("finish", entry);
    return;
  }
  if (entry.sketchAction === "cancel") {
    _onSketchAction?.("cancel", entry);
    return;
  }
  if (entry.sketchAction === "extrude") {
    _onSketchAction?.("extrude", entry);
    return;
  }
  // Transform: viewport gizmo only — Tasks panel steals focus and blocks Apply.
  if (entry.viewportTool === "transform") {
    closeCreateTaskBanner();
    _onViewportTool?.("transform", entry);
    return;
  }
  // Create / Modify / Pattern: VibeCAD-style Tasks panel (not modal overlay).
  if (
    (entry._cat === "Create" || entry._cat === "Modify" || entry._cat === "Pattern") &&
    entry.fields &&
    entry.featureOf &&
    !entry.sketchAction
  ) {
    _openCreateTask(entry, entry._cat);
    return;
  }
  if (entry.viewportTool && _onViewportTool?.(entry.viewportTool, entry) !== false) {
    return;
  }
  if (entry.fields && entry.featureOf) {
    _openDialog(entry, null, entry._cat);
  }
}

async function _extrudeProfileFreecad(feat, label) {
  if (!_api || !_projectId) {
    throw new Error("Open a project first.");
  }
  if (_buildInFlight) {
    _setStatus("Wait for the current CAD rebuild to finish…", "error");
    throw new Error("A build is already running");
  }
  let combine = String(feat.combine || "new").toLowerCase();
  if (combine === "add") combine = "join";
  if (combine === "pad") combine = "join";
  if (combine === "pocket") combine = "cut";
  const model = typeof _getActiveModel === "function" ? _getActiveModel() : null;
  const base = model?.filename || "";
  const needsBase = combine === "join" || combine === "cut" || combine === "intersect";
  if (needsBase && /\.local$/i.test(base)) {
    throw new Error("Solid is still saving — try Extrude again in a moment.");
  }
  if (needsBase && !base) {
    throw new Error("Select a FreeCAD solid to join or cut, or set Type to New body.");
  }
  const toolLabel = String(label || "Extrude").trim() || "Extrude";
  _buildInFlight = true;
  _setStatus(`Building ${toolLabel} with FreeCAD…`, "loading");
  try {
    const data = await _api(`/api/projects/${_projectId}/extrude-profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        profile: feat.profile,
        height_mm: feat.height,
        combine,
        plane: feat.plane || "XY",
        plane_ref: feat.plane_ref || null,
        at: Array.isArray(feat.at) ? feat.at : [0, 0, 0],
        base_filename: needsBase ? base : null,
      }),
    }, 120000);
    _setStatus(`✓ ${data.filename} (FreeCAD)`, "ok");
    _renderTree();
    if (_onBuilt) await _onBuilt(data.filename, data.url, data);
    return data;
  } catch (err) {
    const msg = err.message || "FreeCAD extrude failed";
    _setStatus("✗ " + msg, "error");
    _onBuildError?.(msg);
    throw err;
  } finally {
    _buildInFlight = false;
  }
}

async function _appendFeature(entry, feat) {
  try {
    await _ensureSolidBaseForModifier(feat);
  } catch (err) {
    const msg = err?.message || String(err);
    _setStatus("✗ " + msg, "error");
    _onBuildError?.(msg);
    throw err;
  }
  _part().features.push({ ...feat, id: `f-${Date.now()}` });
  _renderTree();
  const op = String(feat?.op || "").toLowerCase();
  if (op === "extrude" || op === "pad" || op === "pocket") {
    await _extrudeProfileFreecad(feat, entry.label || "Extrude");
    return;
  }
  // Keep the active model basename when applying modifiers (don't create fillet.glb).
  const buildName =
    MODIFIER_OPS.has(op) && _program?.name && _program.name !== "ribbon-model"
      ? _program.name
      : entry.label;
  await _buildProgram(buildName);
}

function _setDesignTab(tab) {
  const next =
    tab === "SKETCH" ? "SKETCH"
      : tab === "RIGGING" ? "RIGGING"
      : tab === "ARCHITECT" ? "ARCHITECT"
      : tab === "ROBOTICS" ? "ROBOTICS"
      : tab === "WORKSPACE" ? "WORKSPACE"
      : "SOLID";
  if (_designTab === next) return;
  _designTab = next;
  const catalog =
    next === "SKETCH"
      ? SKETCH_CATALOG
      : next === "RIGGING"
      ? RIGGING_CATALOG
      : next === "ARCHITECT"
      ? ARCHITECT_CATALOG
      : next === "ROBOTICS"
      ? ROBOTICS_CATALOG
      : next === "WORKSPACE"
      ? WORKSPACE_CATALOG
      : SOLID_RIBBON_UI_CATALOG;
  _mountCatalog(catalog);
  _ribbonBar?.classList.toggle("ribbon-bar--sketch", next === "SKETCH");
  _ribbonBar?.classList.toggle("ribbon-bar--rigging", next === "RIGGING");
  _ribbonBar?.classList.toggle("ribbon-bar--architect", next === "ARCHITECT");
  _ribbonBar?.classList.toggle("ribbon-bar--robotics", next === "ROBOTICS");
  _ribbonBar?.classList.toggle("ribbon-bar--workspace", next === "WORKSPACE");
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

  // Tabs (rebuilt by _mountCatalog)
  const tabs = document.createElement("div");
  tabs.className = "ribbon-tabs";

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

  // ── View controls (far-right of toggle row) ─────────────────────────────
  const viewControls = document.createElement("div");
  viewControls.className = "ribbon-view-controls";
  viewControls.style.marginLeft = "auto";

  const viewBtns = [
    { id: "btn-rig-play", label: "Play", title: "Play the selected rig", svg: `<svg viewBox="0 0 20 20" width="13" height="13" fill="currentColor"><path d="M6 4.5v11l10-5.5z"/></svg>` },
    { id: "btn-rig-play-menu", label: "▾", title: "Search and choose a rig (open/close, assemble, vortex, URDF/SRDF)", svg: ``, pressed: false },
    { id: "btn-urdf-visuals", label: "URDF", title: "Show or hide URDF/SRDF placeholder geometry (dummy spheres)", svg: `<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="5.5"/><path d="M4 16.5c2.2-3 9.8-3 12 0"/></svg>`, pressed: false },
    { id: "btn-joints",    label: "Joints",  title: "Toggle assembly joint overlays (VibeCAD LCS + axes)", svg: `<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="3"/><path d="M10 2v3M10 15v3M2 10h3M15 10h3"/><path d="M4.2 4.2l2.1 2.1M13.7 13.7l2.1 2.1M4.2 15.8l2.1-2.1M13.7 6.3l2.1-2.1"/></svg>`, pressed: false },
    { id: "btn-measure",   label: "Measure", title: "Measure vertices, edges, and faces (M)",           svg: `<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 17L17 3"/><path d="M5 17h4M11 11h4M3 15v2M17 3v2"/></svg>` },
    { id: "btn-fit",       label: "Fit",     title: "Fit all in view (F)",                               svg: `<svg viewBox="0 0 20 20" width="13" height="13" fill="currentColor"><path d="M3 3h5v2H5v3H3V3zm9 0h5v5h-2V5h-3V3zM3 12h2v3h3v2H3v-5zm12 3h-3v2h5v-5h-2v3z"/></svg>` },
    { id: "btn-wireframe", label: "Wire",    title: "Parametric wireframe for CAD/STEP (W) — feature edges, not triangles",                              svg: `<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="6" width="14" height="10" rx="1"/><path d="M3 6l4-3h6l4 3"/><path d="M17 6l-4 3H7L3 6"/><path d="M7 9v7m6-7v7"/></svg>` },
    { id: "btn-section",   label: "Section", title: "Section view — cut model to see inside (Shift+X)",  svg: `<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="14" height="14" rx="1.5"/><path d="M3 10h14" stroke-dasharray="3 2"/><path d="M10 3v7" stroke-dasharray="3 2"/></svg>`, pressed: false },
    { id: "btn-screenshot-toolbar", label: "Shot", title: "Download a screenshot of the viewport",       svg: `<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="6" width="14" height="10" rx="2"/><path d="M7 6l1.2-2h3.6L13 6"/><circle cx="10" cy="11" r="2.5"/></svg>` },
    { id: "btn-history-tree", label: "Tree", title: "Parametric parts & history tree",                  svg: `<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 3v5"/><path d="M6 8h8"/><path d="M4 8v3"/><path d="M10 8v3"/><path d="M16 8v3"/><path d="M2 14h4"/><path d="M8 14h4"/><path d="M14 14h4"/></svg>`, pressed: false },
  ];

  for (const def of viewBtns) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = def.id;
    btn.className = "ribbon-view-btn" + (def.active ? " active" : "");
    btn.title = def.title;
    if (def.pressed !== undefined) btn.setAttribute("aria-pressed", String(def.pressed));
    btn.innerHTML = def.svg + `<span class="ribbon-view-label">${def.label}</span>`;
    viewControls.appendChild(btn);
  }

  const knowledgeBtn = document.createElement("button");
  knowledgeBtn.type = "button";
  knowledgeBtn.id = "btn-knowledge-base";
  knowledgeBtn.className = "ribbon-view-btn ribbon-view-btn--knowledge";
  knowledgeBtn.title = "Knowledge bases — open library, upload files";
  knowledgeBtn.innerHTML = `
    <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4.5 3.5h8.2c.9 0 1.6.7 1.6 1.6v11.3c0-.8-.7-1.4-1.5-1.4H4.5V3.5z"/>
      <path d="M4.5 15h9.8c.8 0 1.5.6 1.5 1.4v.1H6A1.5 1.5 0 0 1 4.5 15z"/>
      <path d="M7 6.5h5M7 9.5h5"/>
    </svg>
    <span class="ribbon-view-label">Knowledge</span>
  `;
  viewControls.appendChild(knowledgeBtn);

  // Chevron
  const chev = document.createElement("button");
  chev.type = "button";
  chev.className = "ribbon-chevron";
  chev.setAttribute("aria-controls", "ribbon-body");
  chev.textContent = "▾";
  chev.setAttribute("aria-label", "Open toolbar");

  // Centered Pick toolbar on the Create / Modify tab row (all design viewport tabs).
  const pickHost = document.createElement("div");
  pickHost.className = "ribbon-pick-host";
  pickHost.id = "ribbon-pick-host";
  pickHost.setAttribute("aria-label", "Pick tools");

  toggleRow.append(tabs, statusWrap, pickHost, viewControls, chev);

  // ── body ────────────────────────────────────────────────────────────────
  const body = document.createElement("div");
  body.className = "ribbon-body ribbon-body--collapsed";
  body.id = "ribbon-body";

  // Panels (populated by _mountCatalog)
  const panelsWrap = document.createElement("div");
  panelsWrap.className = "ribbon-panels";

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

  _ribbonBar = bar;
  _ribbonBody = body;
  _chevron = chev;
  _featureTree = tree;
  _statusEl = statusSpan;
  _statusCopyBtn = copyBtn;
  _panelsWrap = panelsWrap;
  _mountCatalog(SOLID_RIBBON_UI_CATALOG);

  return bar;
}

// ─────────────────────────── tab switching ───────────────────────────────────

function _activateTab(cat, { notify = true } = {}) {
  _tabBtns?.forEach((b) => b.classList.toggle("active", b.dataset.cat === cat));
  _ribbonBody?.querySelectorAll(".ribbon-panel").forEach((p) =>
    p.classList.toggle("ribbon-panel--active", p.dataset.cat === cat));
  if (!notify) return;
  if (_designTab === "ROBOTICS" && cat === "Viser") {
    _onRoboticsAction?.("viser-tab", { id: "viser_tab", roboticsAction: "viser-tab" });
  }
  if (_designTab === "ROBOTICS" && cat === "Teleop") {
    _onRoboticsAction?.("teleop-tab", { id: "teleop_tab", roboticsAction: "teleop-tab" });
  }
  if (_designTab === "ROBOTICS" && cat === "Simulation") {
    _onRoboticsAction?.("sim-tab", { id: "sim_tab", roboticsAction: "sim-tab" });
  }
  if (_designTab === "ROBOTICS" && cat === "Worktop") {
    _onRoboticsAction?.("worktop-tab", { id: "worktop_tab", roboticsAction: "worktop-tab" });
  }
  if (_designTab === "WORKSPACE" && (cat === "Enter" || cat === "World")) {
    _onWorkspaceAction?.("editor", { id: "ws_editor", workspaceAction: "editor" });
  }
}

// ─────────────────────────── public API ──────────────────────────────────────

export function createRibbon({
  container,      // DOM element to append the ribbon into (#ribbon-container)
  apiFn,          // async fn(path, opts) → data
  onBuilt,        // fn(filename, url)
  onGenerating,   // fn(active, message) — viewport spinner
  onGenerationStarted, // fn(data) — background build accepted
  onBuildError,   // fn(message) — viewport error banner
  onStatus,       // fn(kind, message) — bottom edit-status (preferred over ribbon chrome)
  onViewerToast,  // optional toast mirror
  onViewportTool, // fn(toolId, entry) — direct viewport tools
  onCreatePreview, // fn(action, entry, values?) — live ghost for Create tools
  onSketchAction, // fn(action, entry, data?) — sketch workflow
  onRiggingAction, // fn(action, entry, data?) — rigging workflow
  onRoboticsAction, // fn(action, entry) — robotics / Viser / hand cams
  onWorkspaceAction, // fn(action, entry) — VR/PC workspace + world editor
  onArchitectAction, // fn(action, entry, data?) — architect workflow
  onExportAction, // fn(action, entry) — download/share menu
  isBusy,         // fn() → true when prompt/build already running
  getActiveModel, // fn() → { filename } for modifier hydration
  projectId,
} = {}) {
  _api = apiFn;
  _onBuilt = onBuilt;
  _onGenerating = onGenerating;
  _onGenerationStarted = onGenerationStarted;
  _onBuildError = onBuildError;
  _onStatus = onStatus || null;
  _onViewerToast = onViewerToast || null;
  _onViewportTool = onViewportTool;
  _onCreatePreview = onCreatePreview || null;
  _onSketchAction = onSketchAction;
  _onRiggingAction = onRiggingAction;
  _onRoboticsAction = onRoboticsAction;
  _onWorkspaceAction = onWorkspaceAction;
  _onArchitectAction = onArchitectAction;
  _onExportAction = onExportAction;
  _isBusy = isBusy;
  _getActiveModel = getActiveModel;
  _projectId = projectId;
  _program = _emptyProgram();

  const bar = _buildRibbonDOM();

  // Mount inside the dedicated grid slot
  const target = container || document.getElementById("ribbon-container") || document.body;
  target.innerHTML = "";
  target.appendChild(bar);

  // Relocate Pick tools into the Create-row center slot (keeps same button IDs).
  const pickBar = document.querySelector(".toolbar-pick");
  const pickHost = bar.querySelector("#ribbon-pick-host");
  if (pickBar && pickHost && pickBar.parentElement !== pickHost) {
    pickHost.appendChild(pickBar);
  }
  // Boot race: design-tab classes are sometimes applied before the ribbon exists
  // (or skipped when SOLID is already selected). Ensure Pick is visible on refresh.
  const appEl = document.getElementById("app");
  if (
    appEl
    && !appEl.classList.contains("wiring-mode")
    && !["solid-design-tab", "sketch-design-tab", "rigging-design-tab", "robotics-design-tab"].some((c) =>
      appEl.classList.contains(c)
    )
  ) {
    appEl.classList.add("solid-design-tab");
    document.body.classList.add("solid-design-tab");
  }

  // Tab wiring handled in _mountCatalog

  // Chevron — collapsed for new users and after the v2 reset.
  try { localStorage.removeItem(LS_COLLAPSED_LEGACY); } catch (_) {}
  _setCollapsed(isRibbonCollapsedPref());
  _chevron.addEventListener("click", () => _setCollapsed(!_collapsed));

  _renderTree();

  return {
    /** Update the current project id (called when user switches projects). */
    setProjectId(id) { _projectId = id; },
    /** Switch SOLID vs SKETCH ribbon (Fusion workspace tabs). */
    setDesignTab(tab) { _setDesignTab(tab); },
    /** Highlight active sketch tool in the ribbon. */
    setActiveSketchTool(tool) { setActiveSketchTool(tool); },
    /** Light/dark ribbon chrome while actively editing a sketch. */
    setSketchEditing(editing) {
      _ribbonBar?.classList.toggle("ribbon-bar--sketch-editing", !!editing);
    },
    /** Open a Create/Modify tool by id (keyboard shortcuts). */
    activateTool(toolId) {
      const id = String(toolId || "").trim();
      if (!id) return false;
      for (const [cat, tools] of Object.entries(SOLID_CATALOG)) {
        const entry = (tools || []).find((t) => t.id === id);
        if (entry) {
          if (_designTab !== "SOLID") _setDesignTab("SOLID");
          _activateTab(cat);
          _onToolClick({ ...entry, _cat: cat });
          return true;
        }
      }
      return false;
    },
    /** Store closed sketch profile for extrude-from-sketch. */
    setSketchProfile(profile, plane = "XY") {
      _sketchContext = { profile, plane };
    },
    appendFeatureAndBuild(feat, label = "Feature") {
      return _appendFeature({ label }, feat);
    },
    /** Reset features to empty (called when user creates a new project). */
    reset() { _program = _emptyProgram(); _renderTree(); _setStatus("", ""); _sketchContext = { profile: null, plane: "XY" }; },
    /** Replace in-memory FeatureProgram after a kernel rebuild (Pad/Pocket/Fillet). */
    setProgram(program) {
      if (!program || !Array.isArray(program.parts) || !program.parts.length) return false;
      _program = {
        ...program,
        name: program.name || _program.name,
        units: program.units || _program.units || "mm",
        parts: program.parts.map((p) => ({
          ...p,
          features: [...(p.features || [])],
        })),
      };
      _partId = _program.parts[0]?.id || _partId || "part-1";
      _renderTree();
      return true;
    },
    /** Expose the current program (for debugging / export). */
    getProgram() { return _program; },
    appendFeature(feat) {
      _part().features.push(feat);
      _renderTree();
    },
    async build(label) {
      await _buildProgram(label || "build");
    },
  };
}
