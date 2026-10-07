const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

export function createRobotRunDiagnostics({ now = () => new Date() } = {}) {
  const runId = `robot-run-${now().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}`;
  const events = [];
  return {
    runId,
    add(step, outcome, detail = "") {
      events.push({ at: now().toISOString(), step: clean(step), outcome: clean(outcome), detail: clean(detail) });
    },
    clear() { events.length = 0; },
    snapshot() { return { runId, events: events.map((event) => ({ ...event })) }; },
    text(context = {}) {
      const header = [
        `Render Studio robot run debug ${runId}`,
        `target=${clean(context.target) || "missing"}`,
        `selection=${clean(context.selection) || "missing"}`,
      ];
      return [...header, ...events.map((event) => `${event.at} [${event.outcome}] ${event.step}${event.detail ? ` · ${event.detail}` : ""}`)].join("\n");
    },
  };
}

export function robotRunChecklist({
  demoLoaded = false,
  target = "",
  selectionType = "home",
  selectionName = "",
  macReachable = null,
  piReachable = null,
  piStatus = null,
  emoteAvailable = false,
  guardedHomeSupported = null,
} = {}) {
  const item = (id, label, state, detail) => ({ id, label, state, detail });
  return [
    item("demo", "Simulation scene", demoLoaded ? "pass" : "info", demoLoaded ? "MuJoCo scene is assigned for simulation." : "Optional. A saved VR recording can run without a MuJoCo scene."),
    item("target", "Hardware target", target ? "pass" : "fail", target || "Select the OpenArm Pi."),
    item("recording", "Runnable start action", selectionType === "home" || (selectionType === "emote" && emoteAvailable) ? "pass" : "fail",
      selectionType === "viser" ? "Viser positions are planning-only." : selectionType === "home" ? "Default action: guarded arms-down Home only." : `${selectionName || "Recording"} is not available on the Pi.`),
    item("mac", "Mac Studio service", macReachable === true ? "pass" : macReachable === false ? "fail" : "pending",
      macReachable === true ? "Render Studio API answered." : macReachable === false ? "Mac API health check failed." : "Not checked yet."),
    item("pi", "Pi bridge", piReachable === true ? "pass" : piReachable === false ? "fail" : "pending",
      piReachable === true ? "Pi status answered through the Mac proxy." : piReachable === false ? "Pi or teleop service did not answer." : "Not checked yet."),
    item("home", "Guarded Home program", guardedHomeSupported === true ? "pass" : guardedHomeSupported === false ? "fail" : "pending",
      guardedHomeSupported === true ? "Pi advertises feedback-checked arms-down Home." : guardedHomeSupported === false ? "Pi build does not advertise guarded Home. Update the Pi service before running." : "Not checked yet."),
    item("calibration", "Robot calibration", piStatus?.calibrated === true ? "pass" : piStatus?.calibrated === false ? "fail" : "pending",
      piStatus?.calibrated === true ? "Pi reports calibrated." : piStatus?.calibrated === false ? "Calibration is missing or invalid." : "Pi will validate calibration before Home."),
    item("estop", "Physical safety", "manual", "Clear the workspace and keep the physical E-stop reachable."),
  ];
}

export function checklistCanRun(items = []) {
  return items.every((row) => row.state !== "fail");
}
