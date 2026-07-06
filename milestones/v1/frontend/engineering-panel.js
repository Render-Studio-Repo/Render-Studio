// Render3D engineering output panel.
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
  color:var(--muted,#8a93a6);margin:0 0 6px}
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
  panel.className = "eng-panel";
  panel.innerHTML = `<h2>Engineering <span id="eng-intent" class="eng-badge" hidden></span></h2>
    <div id="eng-body"><p class="eng-empty">Generate a model to see parts, joints, mass properties, manufacturability checks, and CAD/sim downloads.</p></div>`;
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

  // Manufacturability.
  if (warnings.length) {
    blocks.push(`<div class="eng-block"><h3>Manufacturability${dfm.process ? ` · ${dfm.process}` : ""}</h3>` +
      warnings.map((w) => `<div class="eng-warn">⚠ ${w}</div>`).join("") + `</div>`);
  } else if (parts.length) {
    blocks.push(`<div class="eng-block"><h3>Manufacturability${dfm.process ? ` · ${dfm.process}` : ""}</h3><div class="eng-ok">✓ Watertight, wall thickness and feature checks passed.</div></div>`);
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

  body.innerHTML = blocks.join("") || `<p class="eng-empty">Model built. No engineering metadata available for this edit.</p>`;

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
