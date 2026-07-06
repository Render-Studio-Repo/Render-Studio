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

import { getUnits, parseLength, displayValue } from "./units.js?v=20260610-direct";

// ─────────────────────────── catalog ───────────────────────────────────────

/**
 * Each entry defines one toolbar button.
 *
 * fields:  array of { name, label, type, default, min?, step?, options? }
 *   type = "number" | "select" | "checkbox"
 *
 * featureOf(values) → Feature dict to append.
 */
// Tool id -> icon image (served from frontend/assets/icons/cad/). Tools not
// listed here fall back to their emoji `icon` glyph.
const ICON_SVG = {
  box:      "/assets/icons/cad/box.png",
  cylinder: "/assets/icons/cad/cylinder.png",
  sphere:   "/assets/icons/cad/sphere.png",
  cone:     "/assets/icons/cad/cone.png",
  torus:    "/assets/icons/cad/torus.png",
  extrude:  "/assets/icons/cad/extrude.png",
  revolve:  "/assets/icons/cad/revolve.png",
  hole:     "/assets/icons/cad/hole.png",
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
      id: "create_sketch_solid",
      label: "Create Sketch",
      icon: "✎",
      desc: "New sketch on a plane (switches to Sketch tab)",
      sketchAction: "start_tab",
      fields: [
        { name: "plane", label: "Plane", type: "select", default: "XY", options: ["XY", "XZ", "YZ", "Face"] },
      ],
      featureOf: () => null,
    },
    {
      id: "box",
      label: "Box",
      icon: "⬛",
      desc: "Rectangular solid — click-drag in viewport",
      viewportTool: "create_box",
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
      desc: "Cylinder / tube — click-drag in viewport",
      viewportTool: "create_cylinder",
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
      desc: "Sphere primitive — click-drag in viewport",
      viewportTool: "create_sphere",
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
      desc: "Cone / frustum — click-drag in viewport",
      viewportTool: "create_cone",
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
      desc: "Torus (ring) — click-drag in viewport",
      viewportTool: "create_torus",
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
      desc: "Viewport Press-Pull: select a face and drag/enter distance",
      viewportTool: "presspull",
      fields: [
        { name: "profile_preset", label: "Profile preset", type:"select", default:"square",
          options:["square","triangle","hexagon","L-shape"] },
        { name: "profile_size", label: "Profile size (mm)", type:"number", default:20, min:1, step:1 },
        { name: "combine", label: "Combine", type: "select", default: "new",
          options: ["new","add","cut","intersect"] },
      ],
      interactive: "drag_height",
      featureOf: v => {
        const s = +v.profile_size;
        const profiles = {
          square:   [[-s/2,-s/2],[s/2,-s/2],[s/2,s/2],[-s/2,s/2]],
          triangle: [[0, s*0.577],[-s/2,-s*0.289],[s/2,-s*0.289]],
          hexagon:  [[s,0],[s/2,s*0.866],[-s/2,s*0.866],[-s,-0],[-s/2,-s*0.866],[s/2,-s*0.866]],
          "L-shape":[[0,0],[s,0],[s,s*0.33],[s*0.33,s*0.33],[s*0.33,s],[0,s]],
        };
        const height = +v.height;
        if (!Number.isFinite(height) || height <= 0) throw new Error("Extrude depth must be > 0");
        return { op:"extrude", combine:v.combine,
          profile: profiles[v.profile_preset] || profiles.square,
          height };
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
      desc: "Cut with Press-Pull from a selected face/region",
      viewportTool: "presspull-cut",
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
      desc: "Viewport transform gizmo with move arrows and rotation rings",
      viewportTool: "transform",
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
    },
    {
      id: "mirror",
      label: "Mirror",
      icon: "↔",
      desc: "Viewport mirror plane with live preview",
      viewportTool: "mirror",
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
      desc: "Extrude the closed sketch profile",
      sketchAction: "extrude",
      fields: [
        { name: "height", label: "Height (mm)", type: "number", default: 10, min: 0.1, step: 1 },
        { name: "combine", label: "Combine", type: "select", default: "new", options: ["new", "add", "cut"] },
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

/** Fusion-style rigging environment ribbon (visible when RIGGING workspace tab is active). */
const RIGGING_CATALOG = {
  Create: [
    {
      id: "rig_add_bone",
      label: "Add Bone",
      icon: "●",
      desc: "Click the model to place a new bone",
      rigAction: "add",
    },
    {
      id: "rig_auto",
      label: "Auto Rig",
      icon: "🦴",
      desc: "Generate a kinematic chain from model bounds",
      rigAction: "auto",
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
  Animation: [
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
    { id: "arch_room", label: "Room", icon: "▣", desc: "Generate a modular room bay", architectTool: "room" },
    { id: "arch_floor", label: "Floor", icon: "▤", desc: "Generate a grid floor slab with snap rails", architectTool: "floor" },
    { id: "arch_wall", label: "Wall", icon: "▥", desc: "Generate a modular wall panel", architectTool: "wall" },
    { id: "arch_window", label: "Window", icon: "▦", desc: "Generate a replaceable window insert", architectTool: "window" },
    { id: "arch_door", label: "Door", icon: "▯", desc: "Generate a modular door insert", architectTool: "door" },
    { id: "arch_roof", label: "Roof", icon: "⌂", desc: "Generate roof or ceiling modules", architectTool: "roof" },
  ],
  Customize: [
    { id: "arch_edit_window", label: "Add Window", icon: "▦", desc: "Edit selected wall/room to add or resize a window", architectEdit: "window" },
    { id: "arch_edit_door", label: "Add Door", icon: "▯", desc: "Edit selected wall/room to add a modular door", architectEdit: "door" },
    { id: "arch_materials", label: "Materials", icon: "◐", desc: "Color/style selected module like house materials", architectEdit: "materials" },
    { id: "arch_customize", label: "Customize", icon: "✦", desc: "Generative edit selected module", architectEdit: "customize" },
  ],
  Layout: [
    { id: "arch_snap_grid", label: "Snap Grid", icon: "⌗", desc: "Snap selected module to Architect grid", architectAction: "snap_grid" },
    { id: "arch_pattern", label: "Pattern", icon: "▦", desc: "Generate repeated wall/floor modules in a grid pattern", architectTool: "pattern" },
    { id: "arch_service", label: "Service Core", icon: "◫", desc: "Generate utility/service-core module", architectTool: "service" },
    { id: "arch_robot", label: "Robot Build", icon: "⚑", desc: "Generate robot assembly-friendly kit", architectTool: "robot" },
  ],
  References: [
    { id: "arch_image", label: "Image Ref", icon: "▧", desc: "Prompt from a house/reference image", architectTool: "image" },
    { id: "arch_blueprint", label: "Blueprint", icon: "⌑", desc: "Prompt from a floor plan or blueprint", architectTool: "blueprint" },
  ],
};

// ─────────────────────────── internal state ─────────────────────────────────

let _api = null;           // async fn(path, opts) — injected by init()
let _projectId = null;     // current project id
let _onBuilt = null;       // callback(filename, url, label) after successful build
let _onViewerToast = null; // optional viewer overlay toast
let _onGenerating = null;  // callback(active, message) during kernel build
let _onGenerationStarted = null; // callback(data) when build accepted as background job
let _onBuildError = null;
let _onExtrudeFaceDrag = null;
let _onExtrudeProfileDrag = null;
let _hasLoadedMesh = null;  // callback(message) on build failure
let _onViewportTool = null; // callback(toolId, entry) for direct modeling handoff

let _onSketchAction = null; // callback(action, entry, values?) for sketch workflow
let _onExportAction = null;
let _onRiggingAction = null;
let _onArchitectAction = null;
let _activeSketchTool = null;
let _isBusy = null;        // fn() → true when another build/prompt is running
let _designTab = "SOLID";
let _sketchContext = { profile: null, plane: "XY" };
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
let _panelsWrap     = null;   // .ribbon-panels container
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
  if (_isBusy?.()) return;
  _setStatus("building…", "loading");
  _onGenerating?.(true, "Building model…");
  let startedBackground = false;
  try {
    const data = await _api(`/api/projects/${_projectId}/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(_program),
    }, 120000);
    if (data.accepted || data.status === "running") {
      _setStatus("Building in background…", "loading");
      _onGenerationStarted?.(data);
      startedBackground = true;
      return;
    }
    _program.name = data.program?.name || _program.name;
    _setStatus(`✓ ${data.filename}`, "ok");
    _renderTree();
    if (_onBuilt) _onBuilt(data.filename, data.url);
  } catch (err) {
    const msg = err.message || "build failed";
    _setStatus("✗ " + msg, "error");
    _onBuildError?.(msg);
  } finally {
    if (!startedBackground) _onGenerating?.(false);
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
  if (_onViewerToast && msg) {
    const kind = cls === "loading" ? "loading" : cls === "error" ? "error" : "ok";
    const text = msg.replace(/^[✓✗]\s*/, "").trim() || msg;
    _onViewerToast(text, { kind, durationMs: kind === "loading" ? 0 : 3200 });
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

  for (const cat of Object.keys(catalog)) {
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
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ribbon-btn";
      btn.dataset.id = entry.id;
      btn.title = entry.desc;
      if (entry.sketchTool) btn.dataset.sketchTool = entry.sketchTool;
      if (entry.sketchAction === "finish") btn.classList.add("ribbon-btn--finish-sketch");
      if (entry.sketchAction === "cancel") btn.classList.add("ribbon-btn--cancel-sketch");
      btn.innerHTML = `${_iconMarkup(entry, "rb-icon")}<span class="rb-label">${entry.label}</span>`;
      btn.addEventListener("click", () => _onToolClick(entry));
      panel.appendChild(btn);
    }
    _panelsWrap.appendChild(panel);
  }
  _activateTab(Object.keys(catalog)[0]);
  if (_activeSketchTool) setActiveSketchTool(_activeSketchTool);
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
  if (entry.viewportTool && _onViewportTool?.(entry.viewportTool, entry) !== false) {
    return;
  }
  if (entry.fields && entry.featureOf) {
    _openDialog(entry, null, entry._cat);
  }
}

function _appendFeature(entry, feat) {
  _part().features.push({ ...feat, id: `f-${Date.now()}` });
  _renderTree();
  _buildProgram(entry.label);
}

function _setDesignTab(tab) {
  const next =
    tab === "SKETCH" ? "SKETCH" : tab === "RIGGING" ? "RIGGING" : tab === "ARCHITECT" ? "ARCHITECT" : "SOLID";
  if (_designTab === next) return;
  _designTab = next;
  const catalog =
    next === "SKETCH"
      ? SKETCH_CATALOG
      : next === "RIGGING"
      ? RIGGING_CATALOG
      : next === "ARCHITECT"
      ? ARCHITECT_CATALOG
      : SOLID_CATALOG;
  _mountCatalog(catalog);
  _ribbonBar?.classList.toggle("ribbon-bar--sketch", next === "SKETCH");
  _ribbonBar?.classList.toggle("ribbon-bar--rigging", next === "RIGGING");
  _ribbonBar?.classList.toggle("ribbon-bar--architect", next === "ARCHITECT");
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

  const viewBtns = [
    { id: "btn-gizmo",     label: "Gizmo",   title: "Move/rotate part in viewer (G)",                    svg: `<svg viewBox="0 0 20 20" width="13" height="13" fill="currentColor"><path d="M10 2l1.5 3h-3L10 2zm0 16l-1.5-3h3L10 18zM2 10l3-1.5v3L2 10zm16 0l-3 1.5v-3L18 10zm-8-3a3 3 0 100 6 3 3 0 000-6z"/></svg>` },
    { id: "btn-fit",       label: "Fit",     title: "Fit all in view (F)",                               svg: `<svg viewBox="0 0 20 20" width="13" height="13" fill="currentColor"><path d="M3 3h5v2H5v3H3V3zm9 0h5v5h-2V5h-3V3zM3 12h2v3h3v2H3v-5zm12 3h-3v2h5v-5h-2v3z"/></svg>` },
    { id: "btn-wireframe", label: "Wire",    title: "Toggle wireframe (W)",                              svg: `<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="6" width="14" height="10" rx="1"/><path d="M3 6l4-3h6l4 3"/><path d="M17 6l-4 3H7L3 6"/><path d="M7 9v7m6-7v7"/></svg>` },
    { id: "btn-section",   label: "Section", title: "Section view — cut model to see inside (Shift+X)",  svg: `<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="14" height="14" rx="1.5"/><path d="M3 10h14" stroke-dasharray="3 2"/><path d="M10 3v7" stroke-dasharray="3 2"/></svg>`, pressed: false },
    { id: "btn-grid",      label: "Grid",    title: "Toggle grid (Shift+G)",                             svg: `<svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7h14M3 13h14M7 3v14M13 3v14"/></svg>`, active: true, pressed: true },
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

  // Chevron
  const chev = document.createElement("button");
  chev.type = "button";
  chev.className = "ribbon-chevron";
  chev.setAttribute("aria-controls", "ribbon-body");
  toggleRow.append(tabs, statusWrap, viewControls, chev);

  // ── body ────────────────────────────────────────────────────────────────
  const body = document.createElement("div");
  body.className = "ribbon-body";
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
  _mountCatalog(SOLID_CATALOG);

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
  onGenerating,   // fn(active, message) — viewport spinner
  onGenerationStarted, // fn(data) — background build accepted
  onBuildError,   // fn(message) — viewport error banner
  onViewportTool, // fn(toolId, entry) — direct viewport tools
  onSketchAction, // fn(action, entry, data?) — sketch workflow
  onRiggingAction, // fn(action, entry, data?) — rigging workflow
  onArchitectAction, // fn(action, entry, data?) — architect workflow
  onExportAction, // fn(action, entry) — download/share menu
  isBusy,         // fn() → true when prompt/build already running
  projectId,
} = {}) {
  _api = apiFn;
  _onBuilt = onBuilt;
  _onGenerating = onGenerating;
  _onGenerationStarted = onGenerationStarted;
  _onBuildError = onBuildError;
  _onViewportTool = onViewportTool;
  _onSketchAction = onSketchAction;
  _onRiggingAction = onRiggingAction;
  _onArchitectAction = onArchitectAction;
  _onExportAction = onExportAction;
  _isBusy = isBusy;
  _projectId = projectId;
  _program = _emptyProgram();

  const bar = _buildRibbonDOM();

  // Mount inside the dedicated grid slot
  const target = container || document.getElementById("ribbon-container") || document.body;
  target.innerHTML = "";
  target.appendChild(bar);

  // Tab wiring handled in _mountCatalog

  // Chevron
  let saved = "0";
  try { saved = localStorage.getItem(LS_COLLAPSED) ?? "0"; } catch (_) {}
  _setCollapsed(saved === "1");
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
    /** Highlight active sketch tool in the ribbon. */
    setActiveSketchTool(tool) { setActiveSketchTool(tool); },
    /** Light/dark ribbon chrome while actively editing a sketch. */
    setSketchEditing(editing) {
      _ribbonBar?.classList.toggle("ribbon-bar--sketch-editing", !!editing);
    },
    /** Store closed sketch profile for extrude-from-sketch. */
    setSketchProfile(profile, plane = "XY") {
      _sketchContext = { profile, plane };
    },
    appendFeatureAndBuild(feat, label = "Feature") {
      _part().features.push({ ...feat, id: `f-${Date.now()}` });
      _renderTree();
      return _buildProgram(label);
    },
    appendFeatureAndBuild(feat, label = "Feature") {
      _part().features.push({ ...feat, id: `f-${Date.now()}` });
      _renderTree();
      return _buildProgram(label);
    },
    /** Reset features to empty (called when user creates a new project). */
    reset() { _program = _emptyProgram(); _renderTree(); _setStatus("", ""); _sketchContext = { profile: null, plane: "XY" }; },
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
