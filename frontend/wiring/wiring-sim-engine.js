import { namedActuatorAnalysis } from './wiring-named-netlist.js?v=20260916-wiring-repair-2';
/**
 * Wiring simulation engine.
 *
 * Three responsibilities:
 *   1. analyzeCircuit() — build a netlist from the schematic, resolve which
 *      microcontroller pin drives each actuator (LED / motor / servo / stepper)
 *      and report wiring problems.
 *   2. generateCode()  — emit Arduino (C++) or MicroPython starter code that
 *      matches the resolved wiring.
 *   3. createExecutor() — a tolerant interpreter that runs a useful subset of
 *      Arduino/MicroPython and emits pin events the canvas can animate.
 *
 * This is intentionally a *behavioural* simulator, not SPICE: it tracks which
 * controller output is high / PWM and propagates that through transistors and
 * driver modules to spin a motor, glow an LED, sweep a servo, or step a motor.
 */

const CONTROLLER_TYPES = ["raspberry-pi", "arduino-uno", "arduino-mega"];
const ACTUATOR_TYPES = ["led", "motor", "servo-motor", "stepper"];

// A driver module exposes a controller-side input bank and a motor-side output
// bank. Legacy single-channel ids (in / mot_a / mot_b) are kept as aliases.
const DRIVER_INPUT_IDS = ["in1", "in2", "in3", "in4", "in"];
const DRIVER_OUTPUT_IDS = ["out1", "out2", "out3", "out4", "mot_a", "mot_b"];

/** Suggest the right driver chip for an actuator that is missing one. */
export function recommendDriver(comp, type) {
  const hay = `${comp?.label || ""} ${comp?.part?.kind || ""} ${comp?.part?.label || ""}`.toLowerCase();
  if (type === "stepper") {
    if (/nema|bipolar|a4988|drv8825/.test(hay))
      return { key: "a4988", name: "A4988 / DRV8825 stepper driver", channels: 2, query: "A4988 stepper driver" };
    return { key: "uln2003", name: "ULN2003 driver board", channels: 4, query: "ULN2003 stepper driver board" };
  }
  return { key: "l298n", name: "L298N motor driver", channels: 2, query: "L298N motor driver" };
}

const POWER_PIN_IDS = new Set(["5v", "3v3", "vcc"]);
const GND_PIN_IDS = new Set(["gnd", "minus", "-"]);

/* ── pin number ⇄ pin id mapping for controllers ───────────────────────── */

function pinNumberFor(type, pinId) {
  if (type === "raspberry-pi") {
    const m = /^gpio(\d+)$/.exec(pinId);
    return m ? Number(m[1]) : null;
  }
  // arduino
  const d = /^d(\d+)$/.exec(pinId);
  if (d) return Number(d[1]);
  const a = /^a(\d+)$/.exec(pinId);
  if (a) return 14 + Number(a[1]); // A0 => 14
  return null;
}

function pinIdForNumber(type, number) {
  if (type === "raspberry-pi") return `gpio${number}`;
  if (number >= 14) return `a${number - 14}`;
  return `d${number}`;
}

/* ── union-find netlist ─────────────────────────────────────────────────── */

function nodeKey(componentId, pinId) {
  return `${componentId}::${pinId}`;
}

function createNetlist(schematic) {
  const parent = new Map();
  const find = (k) => {
    if (!parent.has(k)) parent.set(k, k);
    let root = k;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(k) !== root) {
      const next = parent.get(k);
      parent.set(k, root);
      k = next;
    }
    return root;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  const components = schematic.components || [];
  const wires = schematic.wires || [];
  const byId = new Map(components.map((c) => [c.id, c]));

  // Explicit wires.
  for (const w of wires) {
    if (!w.from || !w.to) continue;
    union(nodeKey(w.from.componentId, w.from.pinId), nodeKey(w.to.componentId, w.to.pinId));
  }

  // Passive 2-terminal parts conduct (resistor, diode) — bridge their nets.
  for (const c of components) {
    if (c.type === "resistor") union(nodeKey(c.id, "a"), nodeKey(c.id, "b"));
    if (c.type === "diode") union(nodeKey(c.id, "anode"), nodeKey(c.id, "cathode"));
  }

  // Breadboard internal connectivity: power rails + grid columns (a-e / f-j).
  for (const c of components) {
    if (c.type !== "breadboard") continue;
    const plus = [];
    const minus = [];
    for (let i = 0; i < 15; i++) {
      plus.push(nodeKey(c.id, `t+_${i}`));
      minus.push(nodeKey(c.id, `t-_${i}`));
    }
    for (let i = 1; i < plus.length; i++) union(plus[0], plus[i]);
    for (let i = 1; i < minus.length; i++) union(minus[0], minus[i]);
    for (let col = 1; col <= 15; col++) {
      const top = ["a", "b", "c", "d", "e"].map((r) => nodeKey(c.id, `${r}${col}`));
      const bot = ["f", "g", "h", "i", "j"].map((r) => nodeKey(c.id, `${r}${col}`));
      for (let i = 1; i < top.length; i++) union(top[0], top[i]);
      for (let i = 1; i < bot.length; i++) union(bot[0], bot[i]);
      // Opposite terminal strips are isolated across the center gap.
    }
  }

  const net = (componentId, pinId) => find(nodeKey(componentId, pinId));

  // Classify nets that reach power / ground via any controller or supply pin.
  const powerNets = new Set();
  const gndNets = new Set();
  for (const c of components) {
    if (CONTROLLER_TYPES.includes(c.type)) {
      powerNets.add(net(c.id, "5v"));
      if (c.type === "raspberry-pi") powerNets.add(net(c.id, "3v3"));
      gndNets.add(net(c.id, "gnd"));
    }
  }

  return { net, byId, components, wires, powerNets, gndNets };
}

/* ── circuit analysis ───────────────────────────────────────────────────── */

function controllerOutputForNet(nl, targetNet) {
  for (const c of nl.components) {
    if (!CONTROLLER_TYPES.includes(c.type)) continue;
    const pins =
      c.type === "raspberry-pi"
        ? ["gpio18", "gpio17", "gpio27"]
        : ["d13", "d12", "d11", "d10", "d9", "d8", "d7", "d6", "d5", "d4", "d3", "d2", "a0", "a1"];
    for (const pinId of pins) {
      if (nl.net(c.id, pinId) === targetNet) {
        return { component: c, pinId, number: pinNumberFor(c.type, pinId) };
      }
    }
  }
  return null;
}

function reaches(nl, theNet, kind) {
  return kind === "power" ? nl.powerNets.has(theNet) : nl.gndNets.has(theNet);
}

/** Find a driver whose OUTPUT bank touches any of the given nets (motor side). */
function driverDrivingNets(nl, drivers, targetNets) {
  for (const d of drivers) {
    for (const outId of DRIVER_OUTPUT_IDS) {
      if (targetNets.has(nl.net(d.id, outId))) return d;
    }
  }
  return null;
}

function isUln2003Driver(comp) {
  return /uln\s*2003/i.test(comp?.label || "");
}

function looksLike28Byj(comp) {
  const hay = `${comp?.label || ""}`.toLowerCase();
  if (/nema|bipolar|a4988|drv8825/.test(hay)) return false;
  return comp?.type === "stepper" && (/28byj|858|byj-48/.test(hay) || !hay.includes("nema"));
}

/** ULN2003 boards drive the 28BYJ-48 through an onboard socket — no OUT wires in the schematic. */
function uln2003SocketDriver(nl, drivers, stepperComp) {
  if (!stepperComp || !looksLike28Byj(stepperComp)) return null;
  for (const d of drivers) {
    if (!isUln2003Driver(d)) continue;
    const coilPins = [];
    for (const inId of ["in1", "in2", "in3", "in4"]) {
      const ctrl = controllerOutputForNet(nl, nl.net(d.id, inId));
      if (ctrl && !coilPins.includes(ctrl.number)) coilPins.push(ctrl.number);
    }
    if (coilPins.length >= 4) return { driver: d, coilPins };
  }
  return null;
}

/**
 * Returns an analysis object:
 * {
 *   controllers: [...], hasButton, actuators: [
 *     { id, label, type, control: {component,pinId,number} | null,
 *       wired: bool, issues: [string], coilPins?: number[] }
 *   ]
 * }
 */
export function analyzeCircuit(schematic) {
  const nl = createNetlist(schematic || {});
  const controllers = nl.components.filter((c) => CONTROLLER_TYPES.includes(c.type));
  const drivers = nl.components.filter((c) => c.type === "motor-driver");
  const transistors = nl.components.filter((c) => c.type === "transistor");
  const hasButton = nl.components.some((c) => c.type === "button");
  const actuators = [];

  const motorControlVia = (c) => {
    // Find which controller output ultimately drives this motor + circuit health.
    const issues = [];
    const termA = nl.net(c.id, "plus");
    const termB = nl.net(c.id, "minus");
    const termAalt = nl.net(c.id, "a");
    const termBalt = nl.net(c.id, "b");
    const termNets = new Set([termA, termB, termAalt, termBalt]);

    // Driver module path.
    for (const d of drivers) {
      const motA = nl.net(d.id, "mot_a");
      const motB = nl.net(d.id, "mot_b");
      if (termNets.has(motA) || termNets.has(motB)) {
        const control = controllerOutputForNet(nl, nl.net(d.id, "in"));
        if (!control) issues.push("Driver IN pin is not connected to a controller output.");
        if (!reaches(nl, nl.net(d.id, "vcc"), "power")) issues.push("Driver VCC has no power.");
        if (!reaches(nl, nl.net(d.id, "gnd"), "ground")) issues.push("Driver GND is not grounded.");
        return { control, issues, via: "driver" };
      }
    }

    // Transistor low-side switch path.
    for (const t of transistors) {
      const coll = nl.net(t.id, "collector");
      const emit = nl.net(t.id, "emitter");
      if (termNets.has(coll) || termNets.has(emit)) {
        const control = controllerOutputForNet(nl, nl.net(t.id, "base"));
        if (!control) issues.push("Transistor base is not driven by a controller output.");
        const powered = [...termNets].some((n) => reaches(nl, n, "power"));
        if (!powered) issues.push("Motor has no path to power (5V).");
        return { control, issues, via: "transistor" };
      }
    }

    // Direct path (works in sim, flagged as not recommended for real hardware).
    for (const n of termNets) {
      const control = controllerOutputForNet(nl, n);
      if (control) {
        issues.push("Motor wired directly to a GPIO pin — use a transistor or driver on real hardware.");
        return { control, issues, via: "direct" };
      }
    }
    issues.push("Motor is not connected to a transistor, driver, or controller output.");
    return { control: null, issues, via: null };
  };

  for (const c of nl.components) {
    if (!ACTUATOR_TYPES.includes(c.type)) continue;

    if (c.type === "led") {
      const anode = nl.net(c.id, "anode");
      const cathode = nl.net(c.id, "cathode");
      const control = controllerOutputForNet(nl, anode);
      const issues = [];
      if (!control) issues.push("LED anode is not connected (through a resistor) to a controller output.");
      if (!reaches(nl, cathode, "ground")) issues.push("LED cathode is not connected to ground.");
      actuators.push({ id: c.id, label: c.label || "LED", type: "led", control, wired: !!control && reaches(nl, cathode, "ground"), issues });
    } else if (c.type === "motor") {
      const r = motorControlVia(c);
      const needsDriver = r.via === "direct" || r.via === null;
      actuators.push({
        id: c.id,
        label: c.label || "DC motor",
        type: "motor",
        control: r.control,
        via: r.via,
        wired: !!r.control,
        needsDriver,
        recommendedDriver: needsDriver ? recommendDriver(c, "motor") : null,
        issues: r.issues,
      });
    } else if (c.type === "servo-motor") {
      const signal = nl.net(c.id, "signal");
      const control = controllerOutputForNet(nl, signal);
      const issues = [];
      if (!control) issues.push("Servo signal pin is not connected to a controller output.");
      if (!reaches(nl, nl.net(c.id, "vcc"), "power")) issues.push("Servo VCC has no power.");
      if (!reaches(nl, nl.net(c.id, "gnd"), "ground")) issues.push("Servo GND is not grounded.");
      actuators.push({ id: c.id, label: c.label || "Servo", type: "servo", control, wired: !!control, issues });
    } else if (c.type === "stepper") {
      const named = namedActuatorAnalysis(schematic, c);
      if (named) { actuators.push(named); continue; }
      const coilIds = ["in1", "in2", "in3", "in4"];
      const coilNets = new Set(coilIds.map((pid) => nl.net(c.id, pid)));
      const issues = [];
      const coilPins = [];
      let needsDriver = false;
      let via = null;

      const socketDrive = uln2003SocketDriver(nl, drivers, c);
      const driver = socketDrive?.driver || driverDrivingNets(nl, drivers, coilNets);
      if (socketDrive) {
        via = "driver";
        coilPins.push(...socketDrive.coilPins);
        if (!reaches(nl, nl.net(socketDrive.driver.id, "vcc"), "power"))
          issues.push("ULN2003 VCC has no power (Arduino 5V → driver VCC).");
        if (!reaches(nl, nl.net(socketDrive.driver.id, "gnd"), "ground"))
          issues.push("ULN2003 GND is not grounded.");
        // Warn if schematic incorrectly shows OUT→coil jumpers on a socket board.
        for (const outId of DRIVER_OUTPUT_IDS) {
          if (coilNets.has(nl.net(socketDrive.driver.id, outId))) {
            issues.push(
              "28BYJ-48 plugs into the ULN2003 white socket — remove jumper wires from O1–O4 to the motor."
            );
            break;
          }
        }
      } else if (driver) {
        via = "driver";
        for (const inId of DRIVER_INPUT_IDS) {
          const ctrl = controllerOutputForNet(nl, nl.net(driver.id, inId));
          if (ctrl && !coilPins.includes(ctrl.number)) coilPins.push(ctrl.number);
        }
        if (isUln2003Driver(driver)) {
          if (coilPins.length < 4)
            issues.push(
              "ULN2003 needs four control lines (IN1–IN4 from Arduino). Do not wire it like a DC motor with one or two inputs."
            );
          if (coilPins.length >= 4 && coilNets.size > 1) {
            const wiredCoils = coilIds.filter((pid) => {
              const ctrl = controllerOutputForNet(nl, nl.net(c.id, pid));
              return !!ctrl;
            });
            if (wiredCoils.length > 0) {
              issues.push(
                "28BYJ-48 uses the ULN2003 onboard socket — wire Arduino → IN1–IN4 only; no separate motor coil wires."
              );
            }
          }
        } else if (coilPins.length < 2) {
          issues.push("Stepper driver inputs are not connected to enough controller outputs (need at least 2).");
        }
        if (!reaches(nl, nl.net(driver.id, "vcc"), "power")) issues.push("Stepper driver VCC has no power.");
        if (!reaches(nl, nl.net(driver.id, "gnd"), "ground")) issues.push("Stepper driver GND is not grounded.");
      } else {
        for (const pid of coilIds) {
          const ctrl = controllerOutputForNet(nl, nl.net(c.id, pid));
          if (ctrl && !coilPins.includes(ctrl.number)) coilPins.push(ctrl.number);
        }
        needsDriver = true;
        if (coilPins.length >= 2) {
          via = "direct";
          issues.push(
            "Stepper coils are wired directly to the controller — a controller cannot supply coil current. Add a ULN2003 (28BYJ-48) or A4988/DRV8825 (NEMA) driver: controller → driver IN1–IN4; for 28BYJ-48 plug the motor into the ULN2003 socket (no OUT wires)."
          );
        } else {
          issues.push(
            "Stepper not driven. For 28BYJ-48: Arduino → ULN2003 IN1–IN4 + 5V/GND, motor plugs into board socket."
          );
        }
      }

      actuators.push({
        id: c.id,
        label: c.label || "Stepper",
        type: "stepper",
        control: null,
        coilPins,
        via,
        wired: coilPins.length >= 2,
        needsDriver,
        recommendedDriver: needsDriver ? recommendDriver(c, "stepper") : null,
        issues,
      });
    }
  }

  return { controllers, drivers, transistors, hasButton, actuators };
}

/* ── code generation ────────────────────────────────────────────────────── */

function controllerKind(analysis) {
  const c = analysis.controllers[0];
  if (!c) return "arduino-uno";
  return c.type;
}

export function generateCode(schematic, lang = "arduino") {
  const analysis = analyzeCircuit(schematic);
  if (analysis.actuators.some(a => a.simulationSupported === false)) {
    const prefix = lang === 'python' ? '# ' : '// ';
    return [ 'This circuit uses an external motion controller with named industrial terminals.', 'Finish the wiring questions and configure the controller firmware from its documentation.', 'GPIO motion code cannot be generated for this circuit by the breadboard simulator.' ].map(line => prefix + line).join('\n');
  }
  return lang === "python"
    ? generatePython(schematic, analysis)
    : generateArduino(schematic, analysis);
}

function generateArduino(schematic, analysis) {
  const name = schematic?.name || "Wiring schematic";
  const lines = [];
  const setup = [];
  const loop = [];
  const decls = [];
  const head = [`// Auto-generated from wiring schematic: ${name}`, `// Edit freely, then press Run to simulate.`, ""];

  const usesServo = analysis.actuators.some((a) => a.type === "servo" && a.control);
  const usesStepper = analysis.actuators.some((a) => a.type === "stepper" && a.wired);
  if (usesServo) head.push("#include <Servo.h>");
  if (usesStepper) head.push("#include <Stepper.h>");
  if (usesServo || usesStepper) head.push("");

  let servoIdx = 0;
  let ledIdx = 0;
  let motorIdx = 0;
  let stepperIdx = 0;

  for (const a of analysis.actuators) {
    if (a.type === "led" && a.control) {
      const v = `led${++ledIdx}`;
      decls.push(`const int ${v} = ${a.control.number};  // ${a.label}`);
      setup.push(`  pinMode(${v}, OUTPUT);`);
      loop.push(`  // ${a.label}: blink`);
      loop.push(`  digitalWrite(${v}, HIGH);`);
      loop.push(`  delay(500);`);
      loop.push(`  digitalWrite(${v}, LOW);`);
      loop.push(`  delay(500);`);
    } else if (a.type === "motor" && a.control) {
      const v = `motor${++motorIdx}`;
      decls.push(`const int ${v} = ${a.control.number};  // ${a.label}`);
      setup.push(`  pinMode(${v}, OUTPUT);`);
      if (analysis.hasButton) {
        loop.push(`  // ${a.label}: ramp speed up and down`);
      }
      loop.push(`  for (int s = 0; s <= 255; s += 5) { analogWrite(${v}, s); delay(20); }`);
      loop.push(`  for (int s = 255; s >= 0; s -= 5) { analogWrite(${v}, s); delay(20); }`);
    } else if (a.type === "servo" && a.control) {
      const v = `servo${++servoIdx}`;
      decls.push(`Servo ${v};  // ${a.label} on pin ${a.control.number}`);
      setup.push(`  ${v}.attach(${a.control.number});`);
      loop.push(`  // ${a.label}: sweep 0 → 180 → 0`);
      loop.push(`  for (int ang = 0; ang <= 180; ang += 2) { ${v}.write(ang); delay(15); }`);
      loop.push(`  for (int ang = 180; ang >= 0; ang -= 2) { ${v}.write(ang); delay(15); }`);
    } else if (a.type === "stepper" && a.wired) {
      const v = `stepper${++stepperIdx}`;
      const pins = a.coilPins.slice(0, 4).join(", ");
      decls.push(`const int stepsPerRev = 2048;`);
      decls.push(`Stepper ${v}(stepsPerRev, ${pins});  // ${a.label}`);
      setup.push(`  ${v}.setSpeed(10);`);
      loop.push(`  // ${a.label}: one revolution each way`);
      loop.push(`  ${v}.step(stepsPerRev);`);
      loop.push(`  delay(500);`);
      loop.push(`  ${v}.step(-stepsPerRev);`);
      loop.push(`  delay(500);`);
    }
  }

  if (!loop.length) {
    loop.push(`  // No driven actuators detected — wire an LED, motor, or servo`);
    loop.push(`  // to a controller output and press “Regenerate”.`);
    loop.push(`  delay(1000);`);
  }

  lines.push(...head, ...decls, "", "void setup() {", ...setup, "}", "", "void loop() {", ...loop, "}", "");
  return lines.join("\n");
}

function generatePython(schematic, analysis) {
  const name = schematic?.name || "Wiring schematic";
  const isPi = controllerKind(analysis) === "raspberry-pi";
  const head = [
    `# Auto-generated from wiring schematic: ${name}`,
    `# MicroPython-style API (machine.Pin / PWM). Edit freely, then press Run.`,
    `from machine import Pin, PWM`,
    `import time`,
    ``,
  ];
  const decls = [];
  const loop = [];
  let idx = 0;

  for (const a of analysis.actuators) {
    idx++;
    if (a.type === "led" && a.control) {
      const v = `led${idx}`;
      decls.push(`${v} = Pin(${a.control.number}, Pin.OUT)  # ${a.label}`);
      loop.push(`    # ${a.label}: blink`);
      loop.push(`    ${v}.value(1)`);
      loop.push(`    time.sleep(0.5)`);
      loop.push(`    ${v}.value(0)`);
      loop.push(`    time.sleep(0.5)`);
    } else if (a.type === "motor" && a.control) {
      const v = `motor${idx}`;
      decls.push(`${v} = PWM(Pin(${a.control.number}))  # ${a.label}`);
      decls.push(`${v}.freq(1000)`);
      loop.push(`    # ${a.label}: ramp up and down`);
      loop.push(`    for s in range(0, 256, 5):`);
      loop.push(`        ${v}.duty(s)`);
      loop.push(`        time.sleep(0.02)`);
      loop.push(`    for s in range(255, -1, -5):`);
      loop.push(`        ${v}.duty(s)`);
      loop.push(`        time.sleep(0.02)`);
    } else if (a.type === "servo" && a.control) {
      const v = `servo${idx}`;
      decls.push(`${v} = PWM(Pin(${a.control.number}))  # ${a.label}`);
      decls.push(`${v}.freq(50)`);
      loop.push(`    # ${a.label}: sweep 0 -> 180 -> 0`);
      loop.push(`    for ang in range(0, 181, 2):`);
      loop.push(`        ${v}.servo(ang)`);
      loop.push(`        time.sleep(0.015)`);
      loop.push(`    for ang in range(180, -1, -2):`);
      loop.push(`        ${v}.servo(ang)`);
      loop.push(`        time.sleep(0.015)`);
    } else if (a.type === "stepper" && a.wired) {
      const v = `stepper${idx}`;
      const pinList = a.coilPins.slice(0, 4).map((p) => `Pin(${p}, Pin.OUT)`).join(", ");
      decls.push(`${v} = [${pinList}]  # ${a.label} coils`);
      loop.push(`    # ${a.label}: 512 steps each way`);
      loop.push(`    for step in range(512):`);
      loop.push(`        ${v}_step(${v}, step % 4)`);
      loop.push(`        time.sleep(0.002)`);
    }
  }

  // helper for stepper sequencing
  const helpers = [];
  if (analysis.actuators.some((a) => a.type === "stepper" && a.wired)) {
    helpers.push(
      ``,
      `def stepper${analysis.actuators.findIndex((a) => a.type === "stepper") + 1}_step(coils, phase):`,
      `    for i, c in enumerate(coils):`,
      `        c.value(1 if i == phase else 0)`,
      ``,
    );
  }

  if (!loop.length) {
    loop.push(`    # No driven actuators detected — wire something to a GPIO and regenerate.`);
    loop.push(`    time.sleep(1)`);
  }

  return [...head, ...decls, ...helpers, ``, `while True:`, ...loop, ``].join("\n");
}

/* ── tiny expression evaluator (numbers, ids, + - * / %, comparisons) ───── */

function evalExpr(expr, scope) {
  const tokens = tokenizeExpr(expr);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parsePrimary() {
    const t = peek();
    if (!t) return 0;
    if (t.type === "num") { next(); return t.value; }
    if (t.type === "id") {
      next();
      if (peek()?.value === "(") {
        // function call — consume args, return a simulated value
        const args = parseArgs();
        return callBuiltin(t.value, args, scope);
      }
      const v = scope[t.value];
      return typeof v === "number" ? v : 0;
    }
    if (t.value === "(") { next(); const v = parseExpr(); if (peek()?.value === ")") next(); return v; }
    if (t.value === "-") { next(); return -parsePrimary(); }
    if (t.value === "!") { next(); return parsePrimary() ? 0 : 1; }
    next();
    return 0;
  }
  function parseArgs() {
    next(); // (
    const args = [];
    if (peek()?.value !== ")") {
      args.push(parseExpr());
      while (peek()?.value === ",") { next(); args.push(parseExpr()); }
    }
    if (peek()?.value === ")") next();
    return args;
  }
  function parseMul() {
    let left = parsePrimary();
    while (["*", "/", "%"].includes(peek()?.value)) {
      const op = next().value;
      const right = parsePrimary();
      left = op === "*" ? left * right : op === "/" ? left / right : left % right;
    }
    return left;
  }
  function parseAdd() {
    let left = parseMul();
    while (["+", "-"].includes(peek()?.value)) {
      const op = next().value;
      const right = parseMul();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  }
  function parseExpr() {
    let left = parseAdd();
    while ([">", "<", ">=", "<=", "==", "!="].includes(peek()?.value)) {
      const op = next().value;
      const right = parseAdd();
      left = compare(op, left, right) ? 1 : 0;
    }
    return left;
  }
  return parseExpr();
}

function compare(op, a, b) {
  switch (op) {
    case ">": return a > b;
    case "<": return a < b;
    case ">=": return a >= b;
    case "<=": return a <= b;
    case "==": return a === b;
    case "!=": return a !== b;
    default: return false;
  }
}

function callBuiltin(name, args, scope) {
  switch (name) {
    case "map": {
      const [x, inMin, inMax, outMin, outMax] = args;
      if (inMax === inMin) return outMin;
      return ((x - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
    }
    case "constrain": return Math.max(args[1], Math.min(args[2], args[0]));
    case "random": return args.length === 1 ? Math.floor(Math.random() * args[0]) : Math.floor(Math.random() * (args[1] - args[0])) + args[0];
    case "digitalRead": return scope.__buttonPressed ? 1 : 0;
    case "analogRead": return 512;
    case "abs": return Math.abs(args[0]);
    default: return 0;
  }
}

function tokenizeExpr(str) {
  const tokens = [];
  const re = /\s*(\d+\.?\d*|[A-Za-z_]\w*|>=|<=|==|!=|[-+*/%()<>,!])/g;
  let m;
  while ((m = re.exec(str))) {
    const v = m[1];
    if (/^\d/.test(v)) tokens.push({ type: "num", value: Number(v) });
    else if (/^[A-Za-z_]/.test(v)) {
      if (v === "HIGH" || v === "true") tokens.push({ type: "num", value: 1 });
      else if (v === "LOW" || v === "false") tokens.push({ type: "num", value: 0 });
      else tokens.push({ type: "id", value: v });
    } else tokens.push({ type: "op", value: v });
  }
  return tokens;
}

/* ── compilers: source → instruction tree ──────────────────────────────── */
// Instruction nodes:
//  {op:'write', pin:<expr>, value:<expr>}
//  {op:'pwm', pin:<expr>, duty:<expr>}
//  {op:'servo', pin:<expr>, angle:<expr>}
//  {op:'step', stepperId, steps:<expr>}
//  {op:'wait', ms:<expr>}
//  {op:'for', init, cond, incr, body:[...]}
//  {op:'assign', name, value:<expr>}

function extractBlock(src, startIdx) {
  // startIdx points at the '{'; return [body, endIdx]
  let depth = 0;
  let i = startIdx;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return [src.slice(startIdx + 1, i), i];
    }
  }
  return [src.slice(startIdx + 1), src.length];
}

function compileArduino(code) {
  const symbols = {};
  const servos = {}; // varName -> pin number
  const steppers = {}; // varName -> {pins:[...]}
  // strip comments
  const src = code.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  // #define and const int NAME = N
  for (const m of src.matchAll(/#define\s+(\w+)\s+(\d+)/g)) symbols[m[1]] = Number(m[2]);
  for (const m of src.matchAll(/const\s+int\s+(\w+)\s*=\s*(\d+)/g)) symbols[m[1]] = Number(m[2]);

  // Servo / Stepper declarations
  for (const m of src.matchAll(/Servo\s+(\w+)\s*;/g)) servos[m[1]] = null;
  for (const m of src.matchAll(/Stepper\s+(\w+)\s*\(([^)]*)\)/g)) {
    const args = m[2].split(",").map((s) => s.trim());
    const pins = args.slice(1).map((a) => (symbols[a] != null ? symbols[a] : Number(a))).filter((n) => !Number.isNaN(n));
    steppers[m[1]] = { pins };
  }

  function parseStatements(body) {
    const instr = [];
    let i = 0;
    while (i < body.length) {
      // skip whitespace/semicolons
      while (i < body.length && /[\s;]/.test(body[i])) i++;
      if (i >= body.length) break;

      // for loop
      const forMatch = /^for\s*\(/.exec(body.slice(i));
      if (forMatch) {
        const parenStart = body.indexOf("(", i);
        let depth = 0;
        let j = parenStart;
        for (; j < body.length; j++) {
          if (body[j] === "(") depth++;
          else if (body[j] === ")") { depth--; if (depth === 0) break; }
        }
        const header = body.slice(parenStart + 1, j);
        const parts = header.split(";");
        // body
        let k = j + 1;
        while (k < body.length && /\s/.test(body[k])) k++;
        let loopBody, end;
        if (body[k] === "{") {
          [loopBody, end] = extractBlock(body, k);
          i = end + 1;
        } else {
          const semi = body.indexOf(";", k);
          loopBody = body.slice(k, semi + 1);
          i = semi + 1;
        }
        instr.push({
          op: "for",
          init: parseSimpleAssign(parts[0]),
          cond: parts[1]?.trim() || "1",
          incr: parts[2]?.trim() || "",
          body: parseStatements(loopBody),
        });
        continue;
      }

      // statement up to ; or {
      let semi = body.indexOf(";", i);
      if (semi === -1) semi = body.length;
      const stmt = body.slice(i, semi).trim();
      i = semi + 1;
      if (!stmt) continue;
      const node = parseArduinoStatement(stmt, servos, steppers);
      if (node) instr.push(node);
    }
    return instr;
  }

  function parseSimpleAssign(s) {
    const m = /^\s*(?:int\s+)?(\w+)\s*=\s*(.+)$/.exec(s);
    if (m) return { name: m[1], value: m[2].trim() };
    return null;
  }

  const setupMatch = /void\s+setup\s*\(\s*\)\s*\{/.exec(src);
  const loopMatch = /void\s+loop\s*\(\s*\)\s*\{/.exec(src);
  let setup = [];
  let loop = [];
  if (setupMatch) {
    const [b] = extractBlock(src, setupMatch.index + setupMatch[0].length - 1);
    setup = parseStatements(b);
  }
  if (loopMatch) {
    const [b] = extractBlock(src, loopMatch.index + loopMatch[0].length - 1);
    loop = parseStatements(b);
  }
  // .attach for servos in setup (resolve pins)
  for (const m of src.matchAll(/(\w+)\.attach\s*\(\s*([^)]+)\)/g)) {
    const pin = symbols[m[2].trim()] != null ? symbols[m[2].trim()] : Number(m[2]);
    if (m[1] in servos) servos[m[1]] = pin;
  }

  return { setup, loop, symbols, servos, steppers, forever: true };
}

function parseArduinoStatement(stmt, servos, steppers) {
  let m;
  if ((m = /^digitalWrite\s*\(\s*([^,]+),\s*(.+)\)$/.exec(stmt)))
    return { op: "write", pin: m[1].trim(), value: m[2].trim() };
  if ((m = /^analogWrite\s*\(\s*([^,]+),\s*(.+)\)$/.exec(stmt)))
    return { op: "pwm", pin: m[1].trim(), duty: m[2].trim() };
  if ((m = /^delayMicroseconds\s*\(\s*(.+)\)$/.exec(stmt)))
    return { op: "wait", ms: `(${m[1].trim()})/1000` };
  if ((m = /^delay\s*\(\s*(.+)\)$/.exec(stmt)))
    return { op: "wait", ms: m[1].trim() };
  if ((m = /^(\w+)\.write\s*\(\s*(.+)\)$/.exec(stmt)) && m[1] in servos)
    return { op: "servo", servoVar: m[1], angle: m[2].trim() };
  if ((m = /^(\w+)\.step\s*\(\s*(.+)\)$/.exec(stmt)) && m[1] in steppers)
    return { op: "step", stepperVar: m[1], steps: m[2].trim() };
  if ((m = /^(?:int\s+)?(\w+)\s*=\s*(.+)$/.exec(stmt)))
    return { op: "assign", name: m[1], value: m[2].trim() };
  if ((m = /^(\w+)\s*\+=\s*(.+)$/.exec(stmt)))
    return { op: "assign", name: m[1], value: `${m[1]}+(${m[2].trim()})` };
  return null; // pinMode, Serial, etc → ignored
}

function compilePython(code) {
  const symbols = {};
  const pins = {}; // varName -> {pin, kind:'pin'|'pwm'}
  const lines = code.replace(/#[^\n]*/g, "").split("\n");

  // declarations
  for (const line of lines) {
    let m;
    if ((m = /^\s*(\w+)\s*=\s*Pin\s*\(\s*(\d+)/.exec(line))) pins[m[1]] = { pin: Number(m[2]), kind: "pin" };
    else if ((m = /^\s*(\w+)\s*=\s*PWM\s*\(\s*Pin\s*\(\s*(\d+)/.exec(line))) pins[m[1]] = { pin: Number(m[2]), kind: "pwm" };
    else if ((m = /^\s*(\w+)\s*=\s*\[(.*Pin\s*\(.*)\]/.exec(line))) {
      const coilPins = [...m[2].matchAll(/Pin\s*\(\s*(\d+)/g)].map((x) => Number(x[1]));
      pins[m[1]] = { coils: coilPins, kind: "stepper" };
    }
  }

  const indentOf = (l) => l.match(/^\s*/)[0].replace(/\t/g, "    ").length;

  function parseBlock(start, baseIndent) {
    const instr = [];
    let i = start;
    while (i < lines.length) {
      const raw = lines[i];
      if (!raw.trim()) { i++; continue; }
      const ind = indentOf(raw);
      if (ind < baseIndent) break;
      if (ind > baseIndent) { i++; continue; } // handled by nested calls
      const line = raw.trim();
      let m;
      if (/^while\s+True\s*:/.test(line)) {
        const [body, ni] = collectChild(i, ind);
        instr.push({ op: "forever", body });
        i = ni;
        continue;
      }
      if ((m = /^for\s+(\w+)\s+in\s+range\s*\(([^)]*)\)\s*:/.exec(line))) {
        const args = m[2].split(",").map((s) => s.trim());
        const [body, ni] = collectChild(i, ind);
        instr.push({ op: "pyrange", var: m[1], args, body });
        i = ni;
        continue;
      }
      if (/^(if|elif|else|def|try|except)\b/.test(line)) {
        // skip control we don't model, but still walk its body
        const [, ni] = collectChild(i, ind);
        i = ni;
        continue;
      }
      const node = parsePythonStatement(line, pins);
      if (node) instr.push(node);
      i++;
    }
    return [instr, i];
  }

  function collectChild(headerIdx, headerIndent) {
    let i = headerIdx + 1;
    // find indent of first child
    while (i < lines.length && !lines[i].trim()) i++;
    if (i >= lines.length) return [[], i];
    const childIndent = indentOf(lines[i]);
    if (childIndent <= headerIndent) return [[], headerIdx + 1];
    const [body, ni] = parseBlock(i, childIndent);
    return [body, ni];
  }

  const [top] = parseBlock(0, 0);
  // The forever loop becomes our loop; statements before it are setup.
  let setup = [];
  let loop = [];
  let forever = false;
  for (const node of top) {
    if (node.op === "forever") { loop = node.body; forever = true; }
    else if (!forever) setup.push(node);
  }
  return { setup, loop, symbols, pins, forever: forever || true };
}

function parsePythonStatement(line, pins) {
  let m;
  if ((m = /^(\w+)\.value\s*\(\s*(.+)\)$/.exec(line)) && pins[m[1]]?.kind === "pin")
    return { op: "write", pin: String(pins[m[1]].pin), value: m[2].trim() };
  if ((m = /^(\w+)\.on\s*\(\s*\)$/.exec(line)) && pins[m[1]])
    return { op: "write", pin: String(pins[m[1]].pin), value: "1" };
  if ((m = /^(\w+)\.off\s*\(\s*\)$/.exec(line)) && pins[m[1]])
    return { op: "write", pin: String(pins[m[1]].pin), value: "0" };
  if ((m = /^(\w+)\.servo\s*\(\s*(.+)\)$/.exec(line)) && pins[m[1]])
    return { op: "servo", pin: String(pins[m[1]].pin), angle: m[2].trim() };
  if ((m = /^(\w+)\.duty(?:_u16)?\s*\(\s*(.+)\)$/.exec(line)) && pins[m[1]])
    return { op: "pwm", pin: String(pins[m[1]].pin), duty: m[2].trim() };
  if ((m = /^time\.sleep_ms\s*\(\s*(.+)\)$/.exec(line)))
    return { op: "wait", ms: m[1].trim() };
  if ((m = /^time\.sleep\s*\(\s*(.+)\)$/.exec(line)))
    return { op: "wait", ms: `(${m[1].trim()})*1000` };
  if ((m = /^(\w+)_step\s*\(\s*(\w+)\s*,\s*(.+)\)$/.exec(line)))
    return { op: "stepphase", stepperVar: m[2], phase: m[3].trim() };
  if ((m = /^(\w+)\s*=\s*(.+)$/.exec(line)) && !line.includes("Pin(") && !line.includes("PWM("))
    return { op: "assign", name: m[1], value: m[2].trim() };
  return null;
}

/* ── executor ───────────────────────────────────────────────────────────── */

export function createExecutor({ onEvent, onLog, onStateChange } = {}) {
  let running = false;
  let cancelToken = { cancelled: false };
  let speed = 1;
  let currentScope = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function exec(instrList, scope, token, depth = 0) {
    if (depth > 200) return;
    for (const node of instrList) {
      if (token.cancelled) return;
      await execNode(node, scope, token, depth);
    }
  }

  async function execNode(node, scope, token, depth) {
    if (token.cancelled) return;
    switch (node.op) {
      case "write": {
        const pin = Math.round(evalExpr(node.pin, scope));
        const value = evalExpr(node.value, scope) >= 1 ? 1 : 0;
        onEvent?.({ kind: "digital", pin, value });
        break;
      }
      case "pwm": {
        const pin = Math.round(evalExpr(node.pin, scope));
        const duty = evalExpr(node.duty, scope);
        onEvent?.({ kind: "pwm", pin, duty });
        break;
      }
      case "servo": {
        const pin = node.pin != null ? Math.round(evalExpr(node.pin, scope)) : scope.__servoPins?.[node.servoVar];
        const angle = evalExpr(node.angle, scope);
        onEvent?.({ kind: "servo", pin, angle });
        break;
      }
      case "step": {
        const steps = Math.round(evalExpr(node.steps, scope));
        onEvent?.({ kind: "step", stepperVar: node.stepperVar, steps });
        break;
      }
      case "stepphase": {
        onEvent?.({ kind: "stepphase", stepperVar: node.stepperVar, phase: Math.round(evalExpr(node.phase, scope)) });
        break;
      }
      case "wait": {
        let ms = evalExpr(node.ms, scope);
        if (!Number.isFinite(ms) || ms < 0) ms = 0;
        ms = Math.min(ms / speed, 2000);
        await sleep(ms);
        break;
      }
      case "assign": {
        scope[node.name] = evalExpr(node.value, scope);
        break;
      }
      case "for": {
        if (node.init) scope[node.init.name] = evalExpr(node.init.value, scope);
        let guard = 0;
        while (!token.cancelled && evalExpr(node.cond, scope) && guard++ < 100000) {
          await exec(node.body, scope, token, depth + 1);
          applyIncrement(node.incr, scope);
        }
        break;
      }
      case "pyrange": {
        const args = node.args.map((a) => evalExpr(a, scope));
        let [start, stop, stepv] = args.length === 1 ? [0, args[0], 1] : args.length === 2 ? [args[0], args[1], 1] : args;
        stepv = stepv || 1;
        let guard = 0;
        for (let v = start; (stepv > 0 ? v < stop : v > stop) && !token.cancelled && guard++ < 100000; v += stepv) {
          scope[node.var] = v;
          await exec(node.body, scope, token, depth + 1);
        }
        break;
      }
      case "forever": {
        while (!token.cancelled) {
          await exec(node.body, scope, token, depth + 1);
          await sleep(0);
        }
        break;
      }
      default:
        break;
    }
  }

  function applyIncrement(incr, scope) {
    if (!incr) return;
    let m;
    if ((m = /^(\w+)\s*\+\+$/.exec(incr)) || (m = /^\+\+(\w+)$/.exec(incr))) scope[m[1]] = (scope[m[1]] || 0) + 1;
    else if ((m = /^(\w+)\s*--$/.exec(incr)) || (m = /^--(\w+)$/.exec(incr))) scope[m[1]] = (scope[m[1]] || 0) - 1;
    else if ((m = /^(\w+)\s*\+=\s*(.+)$/.exec(incr))) scope[m[1]] = (scope[m[1]] || 0) + evalExpr(m[2], scope);
    else if ((m = /^(\w+)\s*-=\s*(.+)$/.exec(incr))) scope[m[1]] = (scope[m[1]] || 0) - evalExpr(m[2], scope);
    else if ((m = /^(\w+)\s*=\s*(.+)$/.exec(incr))) scope[m[1]] = evalExpr(m[2], scope);
  }

  async function run(code, lang, { buttonState } = {}) {
    stop();
    cancelToken = { cancelled: false };
    running = true;
    onStateChange?.(true);
    let compiled;
    try {
      compiled = lang === "python" ? compilePython(code) : compileArduino(code);
    } catch (err) {
      onLog?.(`Parse error: ${err.message}`, "error");
      running = false;
      onStateChange?.(false);
      return;
    }
    const scope = { ...(compiled.symbols || {}) };
    scope.__buttonPressed = !!buttonState;
    scope.__servoPins = compiled.servos || {};
    scope.__stepperPins = compiled.steppers || compiled.pins || {};
    currentScope = scope;

    const token = cancelToken;
    try {
      onLog?.("Running setup()…", "info");
      await exec(compiled.setup || [], scope, token);
      if (token.cancelled) return;
      onLog?.("Entering loop()…", "info");
      // top-level forever loop
      let guard = 0;
      while (!token.cancelled && guard++ < 100000) {
        await exec(compiled.loop || [], scope, token);
        if (!(compiled.loop || []).length) break;
        await sleep(0);
      }
    } catch (err) {
      onLog?.(`Runtime error: ${err.message}`, "error");
    } finally {
      running = false;
      onStateChange?.(false);
    }
  }

  function stop() {
    cancelToken.cancelled = true;
    if (running) {
      running = false;
      onStateChange?.(false);
    }
  }

  return {
    run,
    stop,
    setSpeed(s) { speed = Math.max(0.1, s); },
    setButton(v) { if (currentScope) currentScope.__buttonPressed = !!v; },
    isRunning() { return running; },
  };
}
