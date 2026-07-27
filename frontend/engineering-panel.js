// Render Studio engineering output panel.
//
// Self-contained module: listens for the `render3d:model` event dispatched after
// a successful AI prompt / build and renders the engineering deliverables —
// intent, assembly/part tree with real masses, joints, manufacturability (DFM),
// and download buttons for every exported format (GLB / STEP / STL / sim.json /
// URDF / MJCF). Authenticated downloads reuse the app's auth headers.

import { authHeaders } from "./auth.js";

const STYLE = `
.eng-panel{margin-top:10px}
.eng-panel h2{display:flex;align-items:center;gap:8px}
.eng-badge{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;
  background:#2a3550;color:#9fc0ff;text-transform:capitalize}
.eng-empty{color:var(--muted,#8a93a6);font-size:13px}
.eng-block{margin:10px 0}
.eng-block h3{font-size:12px;text-transform:uppercase;letter-spacing:.04em;
  color:var(--muted,#8a93a6);margin:0 0 6px;display:flex;align-items:center;gap:6px}
.eng-row{display:flex;justify-content:space-between;gap:8px;font-size:13px;
  padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.eng-row .k{color:#cdd5e3}
.eng-row .v{color:#8a93a6;font-variant-numeric:tabular-nums}
.eng-pill{display:inline-block;font-size:11px;padding:1px 6px;border-radius:6px;
  background:#222a3a;color:#9aa6bd;margin-left:6px}
.eng-warn{font-size:12.5px;color:#ffcc77;background:#3a2f1c;border-radius:6px;
  padding:6px 8px;margin:4px 0}
.eng-ok{font-size:12.5px;color:#8fdca0}
.eng-downloads{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.eng-dl{font-size:12px;font-weight:600;padding:5px 10px;border-radius:7px;
  border:1px solid #34405c;background:#1c2638;color:#cfe0ff;cursor:pointer}
.eng-dl:hover{background:#26324a}
.eng-dl[data-fmt="step"]{border-color:#4a6b3f;color:#bfe7a8}
.eng-dl[data-fmt="stl"]{border-color:#6b5a3f;color:#e7d2a8}
/* checks panel */
.eng-checks-summary{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;margin-left:auto}
.eng-checks-pass{background:#1a3a22;color:#5de07a}
.eng-checks-warn{background:#3a2f1c;color:#ffcc77}
.eng-checks-fail{background:#3a1c1c;color:#ff7777}
.eng-check-item{display:flex;align-items:flex-start;gap:7px;font-size:12.5px;
  padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05)}
.eng-check-item:last-child{border-bottom:none}
.eng-check-icon{flex-shrink:0;font-size:13px;line-height:1.4}
.eng-check-body{flex:1;min-width:0}
.eng-check-label{color:#cdd5e3;line-height:1.4}
.eng-check-detail{color:#8a93a6;font-size:11.5px;margin-top:1px}
`;

function injectStyle() {
  if (document.getElementById("eng-panel-style")) return;
  const s = document.createElement("style");
  s.id = "eng-panel-style";
  s.textContent = STYLE;
  document.head.appendChild(s);
}

function ensurePanel() {
  let panel = document.getElementById("engineering-panel");
  if (panel) return panel;
  panel = document.createElement("section");
  panel.id = "engineering-panel";
  panel.className = "eng-panel hidden";
  panel.innerHTML = `<h2>Engineering <span id="eng-intent" class="eng-badge" hidden></span></h2>
    <div id="eng-body"></div>`;
  const right = document.querySelector(".sidebar.right");
  if (right) right.insertBefore(panel, right.firstChild);
  else document.body.appendChild(panel);
  return panel;
}

function fmtMass(g) {
  if (g == null) return "—";
  return g >= 1000 ? `${(g / 1000).toFixed(3)} kg` : `${g.toFixed(2)} g`;
}

async function download(url, filename) {
  try {
    const res = await fetch(url, { headers: authHeaders ? authHeaders() : {} });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (err) {
    console.error("download failed", err);
  }
}

/** Convert raw DFM data into a flat list of check items for display. */
function _buildCheckItems(dfmParts, globalWarnings) {
  const items = [];

  for (const [pid, p] of Object.entries(dfmParts)) {
    const label = pid.replace(/-/g, " ").replace(/_/g, " ");

    // Watertight / manifold
    if (p.watertight === true) {
      items.push({ status: "pass", label: `${label} — manifold (watertight)`, detail: "Solid is closed and valid for export" });
    } else if (p.watertight === false) {
      items.push({ status: "fail", label: `${label} — not manifold`, detail: "Open mesh: may fail STEP/STL slicing" });
    }

    // Wall thickness
    if (p.min_wall_mm != null) {
      if (p.min_wall_mm < 1.2) {
        items.push({ status: "warn", label: `${label} — thin wall`, detail: `min ~${p.min_wall_mm.toFixed(2)} mm (recommended ≥ 1.5 mm)` });
      } else {
        items.push({ status: "pass", label: `${label} — wall thickness`, detail: `min ${p.min_wall_mm.toFixed(2)} mm` });
      }
    }

    // Volume
    if (p.volume_cm3 != null) {
      if (p.volume_cm3 < 0.001) {
        items.push({ status: "fail", label: `${label} — near-zero volume`, detail: `${p.volume_cm3.toFixed(4)} cm³ — likely degenerate solid` });
      } else {
        items.push({ status: "pass", label: `${label} — volume`, detail: `${p.volume_cm3.toFixed(3)} cm³` });
      }
    }

    // Surface clearance
    if (p.min_surface_gap_mm != null && p.min_surface_gap_mm > 0 && p.min_surface_gap_mm < 0.1) {
      items.push({ status: "warn", label: `${label} — surface clearance`, detail: `gap ${(p.min_surface_gap_mm * 1000).toFixed(1)} µm — may cause boolean artifacts` });
    } else if (p.min_surface_gap_mm != null && p.min_surface_gap_mm >= 0.1) {
      items.push({ status: "pass", label: `${label} — surface clearance`, detail: `gap ${p.min_surface_gap_mm.toFixed(3)} mm` });
    }

    // Overhang (FDM)
    if (p.overhang_ratio != null) {
      const pct = (p.overhang_ratio * 100).toFixed(0);
      if (p.overhang_ratio > 0.20) {
        items.push({ status: "warn", label: `${label} — overhang ${pct}%`, detail: "Consider supports or geometry redesign" });
      } else {
        items.push({ status: "pass", label: `${label} — overhang ${pct}%`, detail: "Within printable limits" });
      }
    }
  }

  // Any remaining global warnings not yet covered
  for (const w of (globalWarnings || [])) {
    const alreadyCovered = items.some(it => w.includes(it.label.split(" — ")[0]));
    if (!alreadyCovered) {
      items.push({ status: "warn", label: w, detail: "" });
    }
  }

  return items;
}

function render(data) {
  injectStyle();
  const panel = ensurePanel();
  const body = panel.querySelector("#eng-body");
  const intentEl = panel.querySelector("#eng-intent");
  if (data.intent) {
    intentEl.hidden = false;
    intentEl.textContent = data.intent;
  } else {
    intentEl.hidden = true;
  }

  const sim = data.sim || {};
  const parts = sim.parts || [];
  const joints = sim.joints || [];
  const dfm = data.dfm || {};
  const warnings = data.warnings || dfm.warnings || [];
  const files = data.files || {};

  const blocks = [];

  // Parts / assembly tree with masses.
  if (parts.length) {
    const rows = parts
      .map((p) => {
        const mp = p.mass_properties || {};
        return `<div class="eng-row"><span class="k">${p.id}<span class="eng-pill">${p.material || "?"}</span></span>
          <span class="v">${fmtMass(mp.mass_g)}${mp.volume_cm3 != null ? ` · ${mp.volume_cm3} cm³` : ""}</span></div>`;
      })
      .join("");
    blocks.push(`<div class="eng-block"><h3>Assembly · ${parts.length} part${parts.length > 1 ? "s" : ""}` +
      (sim.total_mass_kg != null ? ` · ${(sim.total_mass_kg * 1000).toFixed(1)} g total` : "") +
      `</h3>${rows}</div>`);
  } else if (data.parts?.length) {
    blocks.push(`<div class="eng-block"><h3>Parts</h3>${data.parts.map((p) => `<div class="eng-row"><span class="k">${p}</span></div>`).join("")}</div>`);
  }

  // Joints (simulation kinematics).
  if (joints.length) {
    const rows = joints
      .map((j) => {
        const drive = j.drive && j.drive.torque_nm ? ` <span class="eng-pill">drive ${j.drive.torque_nm} N·m</span>` : "";
        return `<div class="eng-row"><span class="k">${j.id}${drive}</span>
          <span class="v">${j.type} · ${j.parent}→${j.child}</span></div>`;
      })
      .join("");
    blocks.push(`<div class="eng-block"><h3>Joints · simulation-ready</h3>${rows}</div>`);
  }

  // Manufacturability — per-check items like ForgeCAD CHECKS panel.
  {
    const dfmParts = dfm.parts || {};
    const checkItems = _buildCheckItems(dfmParts, warnings);
    const nPass = checkItems.filter(c => c.status === "pass").length;
    const nWarn = checkItems.filter(c => c.status === "warn").length;
    const nFail = checkItems.filter(c => c.status === "fail").length;
    const total = checkItems.length;

    if (total > 0) {
      const summaryClass = nFail > 0 ? "eng-checks-fail" : nWarn > 0 ? "eng-checks-warn" : "eng-checks-pass";
      const summaryText = nFail > 0
        ? `${nFail} FAILED`
        : nWarn > 0 ? `${nPass} PASSED · ${nWarn} WARN` : `${nPass} PASSED`;
      const procLabel = dfm.process ? ` · ${dfm.process}` : "";
      const rows = checkItems.map(c => {
        const icon = c.status === "pass" ? "✓" : c.status === "warn" ? "⚠" : "✕";
        const iconColor = c.status === "pass" ? "#5de07a" : c.status === "warn" ? "#ffcc77" : "#ff7777";
        return `<div class="eng-check-item">
          <span class="eng-check-icon" style="color:${iconColor}">${icon}</span>
          <div class="eng-check-body">
            <div class="eng-check-label">${c.label}</div>
            ${c.detail ? `<div class="eng-check-detail">${c.detail}</div>` : ""}
          </div>
        </div>`;
      }).join("");
      blocks.push(`<div class="eng-block">
        <h3>Checks${procLabel}<span class="eng-checks-summary ${summaryClass}">${summaryText}</span></h3>
        ${rows}
      </div>`);
    } else if (parts.length || Object.keys(dfmParts).length > 0) {
      blocks.push(`<div class="eng-block"><h3>Checks</h3><div class="eng-ok">✓ No geometry issues detected.</div></div>`);
    }
  }

  // Downloads.
  const order = ["glb", "step", "stl", "sim", "urdf", "mjcf"];
  const labels = { glb: "GLB", step: "STEP", stl: "STL", sim: "sim.json", urdf: "URDF", mjcf: "MJCF" };
  const dls = order
    .filter((f) => files[f])
    .map((f) => {
      const url = files[f];
      const name = url.split("/").pop();
      return `<button class="eng-dl" data-fmt="${f}" data-url="${url}" data-name="${name}">${labels[f]}</button>`;
    })
    .join("");
  if (dls) blocks.push(`<div class="eng-block"><h3>Downloads</h3><div class="eng-downloads">${dls}</div></div>`);

  if (!blocks.length) {
    body.innerHTML = "";
    panel.classList.add("hidden");
    return;
  }

  body.innerHTML = blocks.join("");
  panel.classList.remove("hidden");

  body.querySelectorAll(".eng-dl").forEach((btn) => {
    btn.addEventListener("click", () => download(btn.dataset.url, btn.dataset.name));
  });
}

window.addEventListener("render3d:model", (e) => {
  try {
    render(e.detail || {});
  } catch (err) {
    console.error("engineering panel render failed", err);
  }
});

document.addEventListener("DOMContentLoaded", () => {
  injectStyle();
  ensurePanel();
});
