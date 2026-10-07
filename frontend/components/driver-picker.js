/**
 * Driver picker popup.
 *
 * Opens when an actuator (stepper / DC motor) needs a driver between it and the
 * controller. Lets the user pick a recommended driver or search the step.parts
 * catalog, then either drops a driver into the wiring (auto-wired) or downloads
 * the real STEP file into the project and sources it before wiring it in.
 */

const BUILTIN = {
  uln2003: {
    name: "ULN2003 driver board",
    query: "ULN2003 stepper driver board",
    blurb: "Darlington array for 28BYJ-48 unipolar steppers (4 inputs).",
    specs: ["5-12V motor supply", "4 phase outputs", "IN1-IN4 control", "28BYJ-48 match"],
    details: [
      "Best for the small Adafruit #858 / 28BYJ-48 style 5V unipolar stepper.",
      "Controller pins drive IN1-IN4; motor plugs into OUT1-OUT4 / JST header.",
      "Share GND with the controller. Do not power the motor coils from GPIO pins.",
    ],
    pinout: "VCC, GND, IN1-IN4, OUT1-OUT4",
    visual: "uln2003",
  },
  a4988: {
    name: "A4988 stepper driver",
    query: "A4988 stepper driver",
    blurb: "Microstepping driver for bipolar NEMA steppers.",
    specs: ["8-35V motor supply", "2 coil outputs", "STEP/DIR control", "current limit trim"],
    details: [
      "Use for bipolar steppers such as NEMA 17, not the 5-wire 28BYJ-48 unless modified.",
      "Controller uses STEP and DIR pins; coils connect to 1A/1B and 2A/2B.",
      "Set the current limit before running to protect the motor and driver.",
    ],
    pinout: "VMOT, GND, VDD, STEP, DIR, 1A/1B, 2A/2B",
    visual: "a4988",
  },
  l298n: {
    name: "L298N motor driver",
    query: "L298N motor driver",
    blurb: "Dual H-bridge for DC motors and small bipolar steppers.",
    specs: ["5-35V motor supply", "2 H-bridges", "IN1-IN4 control", "DC motor / small stepper"],
    details: [
      "Good for DC motors and some small bipolar steppers, but less efficient than modern MOSFET drivers.",
      "Controller drives IN1-IN4; motor outputs go to OUT1-OUT4.",
      "Use external motor power and common GND with the controller.",
    ],
    pinout: "12V/VMS, GND, 5V logic, IN1-IN4, OUT1-OUT4",
    visual: "l298n",
  },
};

let driverPickerAbort = null; // leakfix86
function beginDriverPickerFetch() {
  if (driverPickerAbort) {
    try { driverPickerAbort.abort(); } catch (_) { /* ignore */ }
  }
  const ctl = new AbortController();
  driverPickerAbort = ctl;
  return ctl;
}

export function createDriverPicker({ api, getProjectId, sim, onChange } = {}) {
  let actuator = null;

  const overlay = document.createElement("div");
  overlay.className = "driver-picker-overlay hidden";
  overlay.innerHTML = `
    <div class="driver-picker-modal" role="dialog" aria-label="Add a driver">
      <div class="driver-picker-head">
        <strong class="driver-picker-title">Add a driver</strong>
        <button type="button" class="driver-picker-close" aria-label="Close">✕</button>
      </div>
      <p class="driver-picker-intro muted small"></p>
      <div class="driver-picker-recommended"></div>
      <div class="driver-picker-section">
        <h4>Source a real driver online</h4>
        <div class="driver-picker-search-row">
          <input type="text" class="driver-picker-search" placeholder="Search step.parts" />
          <button type="button" class="btn secondary driver-picker-search-btn">Search</button>
        </div>
        <div class="driver-picker-results"></div>
      </div>
      <div class="driver-picker-foot">
        <span class="driver-picker-status muted small"></span>
        <button type="button" class="btn driver-picker-cancel">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const $ = (s) => overlay.querySelector(s);
  const titleEl = $(".driver-picker-title");
  const introEl = $(".driver-picker-intro");
  const recoEl = $(".driver-picker-recommended");
  const searchInput = $(".driver-picker-search");
  const resultsEl = $(".driver-picker-results");
  const statusEl = $(".driver-picker-status");

  function setStatus(text, kind = "") {
    statusEl.textContent = text || "";
    statusEl.className = `driver-picker-status small ${kind}`;
  }

  function channelsFor() {
    return actuator?.type === "stepper" ? 4 : 2;
  }

  function insertBuiltin(label) {
    if (!sim?.insertDriverForActuator || !actuator) return;
    sim.insertDriverForActuator(actuator.id, { label, channels: channelsFor() });
    setStatus(`Added ${label} and auto-wired it between the controller and ${actuator.label}.`, "ok");
    onChange?.({ imported: false });
    setTimeout(close, 850);
  }

  async function importAndInsert(candidate) {
    const pid = getProjectId?.();
    if (!pid || !actuator) return;
    setStatus(`Downloading STEP for ${candidate.name}…`);
    try {
      const res = await api(`/api/projects/${pid}/parts/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: candidate.name,
          step_url: candidate.step_url,
          glb_url: candidate.glb_url,
          png_url: candidate.png_url,
          page_url: candidate.page_url,
          source_id: candidate.id,
          wiring_type: "motor-driver",
          attributes: candidate.attributes || {},
        }),
      });
      sim.insertDriverForActuator(actuator.id, {
        label: candidate.name,
        channels: channelsFor(),
        sourceFile: res.filename,
        part: { kind: "Motor driver", sourceFile: res.filename, sourced: true, pageUrl: candidate.page_url },
        preview: candidate.png_url || null,
        modelUrl: candidate.glb_url || null,
      });
      onChange?.({ imported: true });
      setStatus("STEP imported to the project, sourced, and wired in.", "ok");
      setTimeout(close, 1100);
    } catch (err) {
      setStatus(err.message || "Could not import that part.", "error");
    }
  }

  async function runSearch() {
    const pid = getProjectId?.();
    if (!pid || !actuator) return;
    const q = searchInput.value.trim();
    const ctl = beginDriverPickerFetch();
    if (!resultsEl.querySelector(".driver-picker-result")) {
      resultsEl.innerHTML = `<p class="muted small">Searching catalog…</p>`;
    }
    try {
      const data = await api(
        `/api/projects/${pid}/parts/${encodeURIComponent(actuator.id)}/sources?q=${encodeURIComponent(q)}`,
        { signal: ctl.signal },
      );
      if (ctl.signal.aborted) return;
      renderResults(data.candidates || []);
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
      resultsEl.innerHTML = `<p class="status error">${escapeHtml(err.message || "Search failed.")}</p>`;
    }
  }

  function renderResults(candidates) {
    if (!candidates.length) {
      resultsEl.innerHTML = `<p class="muted small">No catalog matches. Try other keywords (e.g. "ULN2003").</p>`;
      return;
    }
    resultsEl.innerHTML = "";
    for (const c of candidates) {
      const card = document.createElement("div");
      card.className = "driver-picker-result";
      const attrs = Object.entries(c.attributes || {}).slice(0, 6)
        .map(([k, v]) => `${k}: ${v}`).join(" · ");
      card.innerHTML = `
        <div class="driver-picker-thumb">${c.png_url ? `<img src="${escapeAttr(c.png_url)}" alt="" loading="lazy" />` : ""}</div>
        <div class="driver-picker-result-main">
          <strong>${escapeHtml(c.name || c.id || "part")}</strong>
          <span class="muted small">${escapeHtml([c.category, c.family].filter(Boolean).join(" / "))}</span>
          ${attrs ? `<span class="muted small">${escapeHtml(attrs)}</span>` : ""}
        </div>
        <div class="driver-picker-result-actions">
          ${c.step_url ? `<button type="button" class="btn accent driver-picker-import">Add STEP + wire</button>` : ""}
          ${c.page_url ? `<a class="btn secondary driver-picker-page" href="${escapeAttr(c.page_url)}" target="_blank" rel="noreferrer">More info</a>` : ""}
          <button type="button" class="btn secondary driver-picker-use">Use (wire only)</button>
        </div>
      `;
      card.querySelector(".driver-picker-import")?.addEventListener("click", () => importAndInsert(c));
      card.querySelector(".driver-picker-use").addEventListener("click", () => insertBuiltin(c.name || "Driver"));
      resultsEl.appendChild(card);
    }
  }

  function renderRecommended() {
    const rec = actuator?.recommendedDriver;
    const key = rec?.key || (actuator?.type === "stepper" ? "uln2003" : "l298n");
    const primary = BUILTIN[key];
    const others = Object.keys(BUILTIN).filter((k) => k !== key);
    const order = [key, ...others];
    recoEl.innerHTML = `<h4>Recommended</h4>`;
    const wrap = document.createElement("div");
    wrap.className = "driver-picker-builtins";
    for (const k of order) {
      const b = BUILTIN[k];
      const el = document.createElement("div");
      el.className = `driver-picker-builtin${k === key ? " driver-picker-builtin--primary" : ""}`;
      el.innerHTML = `
        <div class="driver-picker-visual driver-picker-visual--${escapeAttr(b.visual)}" aria-hidden="true">
          <span class="driver-chip"></span>
          <span class="driver-terminal driver-terminal--left"></span>
          <span class="driver-terminal driver-terminal--right"></span>
          <span class="driver-pins"></span>
        </div>
        <div class="driver-picker-builtin-main">
          <strong>${escapeHtml(b.name)}${k === key ? " ★" : ""}</strong>
          <span class="muted small">${escapeHtml(b.blurb)}</span>
          <div class="driver-picker-specs">
            ${(b.specs || []).map((s) => `<span>${escapeHtml(s)}</span>`).join("")}
          </div>
          <div class="driver-picker-more hidden">
            <dl>
              <div><dt>Pinout</dt><dd>${escapeHtml(b.pinout)}</dd></div>
              ${(b.details || []).map((d) => `<div><dt>Note</dt><dd>${escapeHtml(d)}</dd></div>`).join("")}
            </dl>
          </div>
        </div>
        <div class="driver-picker-builtin-actions">
          <button type="button" class="btn ${k === key ? "accent" : "secondary"} driver-picker-add">Add &amp; wire</button>
          <button type="button" class="btn ghost driver-picker-more-btn">More info</button>
        </div>
      `;
      el.querySelector(".driver-picker-add").addEventListener("click", () => insertBuiltin(b.name));
      el.querySelector(".driver-picker-more-btn").addEventListener("click", () => {
        const more = el.querySelector(".driver-picker-more");
        const expanded = more.classList.toggle("hidden") === false;
        el.querySelector(".driver-picker-more-btn").textContent = expanded ? "Less info" : "More info";
      });
      wrap.appendChild(el);
    }
    recoEl.appendChild(wrap);
  }

  $(".driver-picker-close").addEventListener("click", close);
  $(".driver-picker-cancel").addEventListener("click", close);
  $(".driver-picker-search-btn").addEventListener("click", runSearch);
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runSearch();
    }
  });
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });

  function open(act) {
    actuator = act;
    if (!actuator) return;
    titleEl.textContent = `Add a driver for ${actuator.label}`;
    introEl.textContent =
      actuator.type === "stepper"
        ? "A controller can't power stepper coils directly. Pick a driver — it goes between the controller and the motor (controller → driver IN, driver OUT → coils)."
        : "A controller can't drive a motor directly. Pick a driver to place between the controller and the motor.";
    searchInput.value = actuator.recommendedDriver?.query || (actuator.type === "stepper" ? "ULN2003 stepper driver" : "L298N motor driver");
    resultsEl.innerHTML = "";
    setStatus("");
    renderRecommended();
    overlay.classList.remove("hidden");
  }

  function close() {
    if (driverPickerAbort) {
      try { driverPickerAbort.abort(); } catch (_) { /* ignore */ }
      driverPickerAbort = null;
    }
    overlay.classList.add("hidden");
  }

  return { open, close, isOpen: () => !overlay.classList.contains("hidden") };
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, "&#96;");
}
