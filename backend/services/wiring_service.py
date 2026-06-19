"""AI-assisted breadboard / Arduino wiring schematic generation."""

from __future__ import annotations

import json
from typing import Any

from backend.services.ai_service import AIService

WIRING_SYSTEM_PROMPT = """You are Render3D's wiring schematic engine for breadboard, Arduino, and Raspberry Pi projects.

Given a user brief (and optional reference photo of a circuit, breadboard, or schematic),
produce a complete 2D wiring diagram the Wiring Simulator can render.

Reply with ONE JSON object only — no markdown, no prose outside JSON.

Schema:
{
  "name": "short title",
  "description": "one sentence",
  "reference_image": null,
  "components": [
    {
      "id": "unique_id",
      "type": "raspberry-pi|arduino-uno|arduino-mega|breadboard|servo-motor|motor-driver|stepper|led|resistor|transistor|diode|button|sensor|motor",
      "label": "display name",
      "x": 80,
      "y": 120,
      "w": 168,
      "h": 104
    }
  ],
  "wires": [
    {
      "id": "w1",
      "from": { "componentId": "...", "pinId": "..." },
      "to": { "componentId": "...", "pinId": "..." },
      "color": "#58a6ff",
      "label": "optional note"
    }
  ],
  "notes": ["assembly tip 1", "assembly tip 2"]
}

Pin IDs:
- Raspberry Pi: 5v, 3v3, gnd, gpio18, gpio17, gpio27
- Arduino: 5v, gnd, d13, d12, d11, a0, a1
- Servo motor: signal, vcc, gnd
- Motor driver (ULN2003 / L298N / A4988): in1, in2, in3, in4 (controller-side inputs), out1, out2, out3, out4 (motor-side outputs), vcc, gnd
- Stepper motor (28BYJ-48): in1, in2, in3, in4 (coil wires — connect to driver out1–out4, or omit entirely for ULN2003 board with built-in white connector)
- DC motor: plus, minus (aliases a, b)
- Transistor (NPN): base, collector, emitter
- Diode: anode, cathode
- LED: anode, cathode
- Resistor: a, b
- Button: 1, 2
- Generic sensor: in, out
- Breadboard: t+_0…t+_14 (top + rail), t-_0…t-_14 (bottom − rail), a1…j15 grid holes

Wire colors (use consistently):
- #f85149 = 5V power
- #6e7681 = GND
- #58a6ff = digital / PWM signal
- #3fb950 = data / LED anode path
- #d29922 = auxiliary

Layout rules (left → center → right signal flow):
- Microcontroller/board on the LEFT (~x 32–80): Raspberry Pi or Arduino.
- Breadboard in the CENTER (~x 260–320, w 340, h 200) as the wiring hub.
- Actuators/sensors on the RIGHT (~x 640–720): servo, LED, motor, sensor.
- Route power: board 5V/GND → breadboard rails → peripheral power pins.
- Route signals: board GPIO/PWM → breadboard row → peripheral signal pin.
- Space parts so wire paths are readable; y between 96–280 on a ~900px canvas.
- Place resistors, transistor, and diode ON the breadboard area (not floating far away).
- Include ALL wires needed for the circuit to work; keep labels short (≤20 chars, e.g. "GPIO17 input").
- Wires auto-route above the breadboard — use breadboard grid holes (a1…j15) and rails for every junction.
- Physical routing must stay on the chosen board/face lane: keep wires short, anchored to pins/grid holes, and routed around component bounding boxes. Do NOT draw big decorative loops over electronics unless the user explicitly asks for wire loops, clips, or strain-relief hoops.
- If a user references a drawn path/face, treat it as a riveted route: follow those points exactly, snap the wire to that surface, and stop at the last referenced endpoint instead of continuing around nearby electronics.
- Add 2–4 brief notes (polarity, pin numbers, library name). Do NOT write code blocks or full sketches in notes — code is generated separately.

CRITICAL motor/stepper rule — controllers cannot supply coil/motor current:
- NEVER connect a DC motor's terminals or a stepper's coil wires (in1..in4) directly to controller GPIO/digital pins.
- ALWAYS insert a driver between the controller and the motor:
  - DC motor → L298N / MOSFET / transistor.
  - Unipolar stepper (28BYJ-48) → ULN2003 driver board.
  - Bipolar stepper (NEMA 17) → A4988 / DRV8825 driver.

Button → motor on Raspberry Pi (common pattern):
- GPIO input (e.g. gpio17) → breadboard row → push button → GND rail; add 10kΩ from 3v3 to same row (pull-up).
- GPIO output (e.g. gpio18) → 1kΩ base resistor → NPN transistor → motor on 5V rail; flyback diode across motor.
- Alternative: GPIO output → motor-driver in1 → motor on out1/out2; driver vcc/gnd from rails.

Stepper motor (REQUIRED pattern — controller → driver → motor):
- Always include a `motor-driver` component. Do NOT wire the stepper straight to the board.
- Power the driver: 5V rail → driver vcc, GND rail → driver gnd.
- Wire four controller outputs to the DRIVER control inputs:
    Arduino d13 → driver in1, d12 → in2, d11 → in3, d10 → in4  (or any four digital pins)
- ULN2003 + 28BYJ-48 (label driver "ULN2003"):
    The motor's 5-wire connector plugs into the white socket on the ULN2003 board — there is NO separate wire from out1/out2/out3/out4 to the motor.
    Only draw: 4 controller→in1–in4 wires + vcc + gnd. Do NOT draw any out→motor wires.
- A4988 / DRV8825 + NEMA-17 (label driver "A4988"):
    Use STEP and DIR pins only: controller d2 → driver in1 (STEP), controller d3 → driver in2 (DIR).
    Motor coil pairs connect to out1/out2 (1A/1B) and out3/out4 (2A/2B).
- L298N + DC or bipolar stepper (label driver "L298N"):
    Four controller pins → in1–in4; motor terminals → out1/out2 and out3/out4.
- The simulator generates a Stepper-library sketch and animates the rotor. Do NOT duplicate that code in notes.

If editing an existing schematic, preserve component ids when possible and adjust wires.

ULN2003 + 28BYJ-48 checklist (MUST pass before returning JSON):
- Include a motor-driver component labeled "ULN2003".
- Draw exactly six wires to the driver: 5V→VCC, GND→GND, and four controller pins→IN1–IN4.
- Default Arduino control pins: d13→IN1, d12→IN2, d11→IN3, a0→IN4.
- Place the stepper motor next to the driver for illustration only — the 5-wire harness plugs into the board socket.
- Do NOT draw wires to the stepper in1–in4 pins.
- Do NOT draw wires from driver out1–out4 to anything — those outputs are internal to the socket.
- Do NOT wire a stepper like a DC motor (one or two lines to O1/O2 only).
"""


CONTROLLER_TYPES = frozenset({"raspberry-pi", "arduino-uno", "arduino-mega"})
COIL_PIN_IDS = ("in1", "in2", "in3", "in4")
DRIVER_IN_PIN_IDS = ("in1", "in2", "in3", "in4", "in")
DRIVER_OUT_PIN_IDS = ("out1", "out2", "out3", "out4", "mot_a", "mot_b")
DEFAULT_ARDUINO_STEPPER_CTRL = ("d13", "d12", "d11", "a0")
WIRE_COLORS = {"power": "#f85149", "gnd": "#6e7681", "signal": "#58a6ff"}


def _normalize_schematic(raw: dict[str, Any]) -> dict[str, Any]:
    components = raw.get("components") or []
    wires = raw.get("wires") or []
    return {
        "name": raw.get("name") or "Wiring schematic",
        "description": raw.get("description") or "",
        "reference_image": raw.get("reference_image"),
        "components": components if isinstance(components, list) else [],
        "wires": wires if isinstance(wires, list) else [],
        "notes": raw.get("notes") if isinstance(raw.get("notes"), list) else [],
    }


def _new_component_id(prefix: str = "c") -> str:
    import uuid

    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def _new_wire_id(prefix: str = "w") -> str:
    import uuid

    return f"{prefix}_{uuid.uuid4().hex[:8]}"


def _is_controller(comp: dict[str, Any]) -> bool:
    return comp.get("type") in CONTROLLER_TYPES


def _is_stepper(comp: dict[str, Any]) -> bool:
    return comp.get("type") == "stepper"


def _is_driver(comp: dict[str, Any]) -> bool:
    return comp.get("type") == "motor-driver"


def _is_uln2003(comp: dict[str, Any]) -> bool:
    if not _is_driver(comp):
        return False
    label = (comp.get("label") or "").lower()
    return "uln2003" in label or "uln 2003" in label


def _looks_like_28byj(comp: dict[str, Any]) -> bool:
    if not _is_stepper(comp):
        return False
    hay = (comp.get("label") or "").lower()
    if "nema" in hay or "bipolar" in hay or "a4988" in hay:
        return False
    return "28byj" in hay or "858" in hay or "byj" in hay or comp.get("type") == "stepper"


def _wire_endpoint(wire: dict[str, Any], side: str) -> tuple[str, str] | None:
    end = wire.get(side)
    if not isinstance(end, dict):
        return None
    cid = end.get("componentId")
    pid = end.get("pinId")
    if cid and pid:
        return str(cid), str(pid)
    return None


def _wire_touches(wire: dict[str, Any], comp_id: str, pin_ids: set[str] | None = None) -> bool:
    for side in ("from", "to"):
        end = _wire_endpoint(wire, side)
        if not end or end[0] != comp_id:
            continue
        if pin_ids is None or end[1] in pin_ids:
            return True
    return False


def _other_endpoint(wire: dict[str, Any], comp_id: str, pin_id: str) -> tuple[str, str, str] | None:
    """Return (side, componentId, pinId) for the opposite end of a wire."""
    for side in ("from", "to"):
        end = _wire_endpoint(wire, side)
        if end and end[0] == comp_id and end[1] == pin_id:
            other_side = "to" if side == "from" else "from"
            other = _wire_endpoint(wire, other_side)
            if other:
                return other_side, other[0], other[1]
    return None


def _has_wire(
    wires: list[dict[str, Any]],
    a_comp: str,
    a_pin: str,
    b_comp: str,
    b_pin: str,
) -> bool:
    for w in wires:
        f = _wire_endpoint(w, "from")
        t = _wire_endpoint(w, "to")
        if not f or not t:
            continue
        if (f == (a_comp, a_pin) and t == (b_comp, b_pin)) or (
            f == (b_comp, b_pin) and t == (a_comp, a_pin)
        ):
            return True
    return False


def _add_wire(
    wires: list[dict[str, Any]],
    *,
    from_comp: str,
    from_pin: str,
    to_comp: str,
    to_pin: str,
    color: str,
    label: str = "",
) -> None:
    if _has_wire(wires, from_comp, from_pin, to_comp, to_pin):
        return
    wires.append(
        {
            "id": _new_wire_id(),
            "from": {"componentId": from_comp, "pinId": from_pin},
            "to": {"componentId": to_comp, "pinId": to_pin},
            "color": color,
            "label": label,
        }
    )


def _remove_wires(
    wires: list[dict[str, Any]],
    predicate,
) -> int:
    before = len(wires)
    wires[:] = [w for w in wires if not predicate(w)]
    return before - len(wires)


def _controller_for_schematic(components: list[dict[str, Any]]) -> dict[str, Any] | None:
    for c in components:
        if _is_controller(c):
            return c
    return None


def _default_stepper_ctrl_pins(controller: dict[str, Any]) -> tuple[str, ...]:
    if controller.get("type") == "raspberry-pi":
        return ("gpio18", "gpio17", "gpio27", "gpio22")
    return DEFAULT_ARDUINO_STEPPER_CTRL


def _insert_uln2003_driver(
    components: list[dict[str, Any]],
    *,
    stepper: dict[str, Any],
    controller: dict[str, Any],
) -> dict[str, Any]:
    driver = {
        "id": _new_component_id("drv"),
        "type": "motor-driver",
        "label": "ULN2003",
        "x": max(8, int(stepper.get("x", 520)) - 140),
        "y": int(stepper.get("y", 170)),
        "w": 104,
        "h": 92,
    }
    components.append(driver)
    return driver


def _ensure_driver_power(
    wires: list[dict[str, Any]],
    *,
    controller: dict[str, Any],
    driver: dict[str, Any],
) -> bool:
    changed = False
    if not _has_wire(wires, controller["id"], "5v", driver["id"], "vcc"):
        _add_wire(
            wires,
            from_comp=controller["id"],
            from_pin="5v",
            to_comp=driver["id"],
            to_pin="vcc",
            color=WIRE_COLORS["power"],
            label="5V",
        )
        changed = True
    if not _has_wire(wires, controller["id"], "gnd", driver["id"], "gnd"):
        _add_wire(
            wires,
            from_comp=controller["id"],
            from_pin="gnd",
            to_comp=driver["id"],
            to_pin="gnd",
            color=WIRE_COLORS["gnd"],
            label="GND",
        )
        changed = True
    return changed


def _ensure_four_driver_inputs(
    wires: list[dict[str, Any]],
    *,
    controller: dict[str, Any],
    driver: dict[str, Any],
) -> bool:
    changed = False
    ctrl_pins = _default_stepper_ctrl_pins(controller)
    for idx, in_pin in enumerate(COIL_PIN_IDS):
        ctrl_pin = ctrl_pins[idx] if idx < len(ctrl_pins) else ctrl_pins[-1]
        if not any(
            _wire_touches(w, driver["id"], {in_pin}) and _wire_touches(w, controller["id"])
            for w in wires
        ):
            _add_wire(
                wires,
                from_comp=controller["id"],
                from_pin=ctrl_pin,
                to_comp=driver["id"],
                to_pin=in_pin,
                color=WIRE_COLORS["signal"],
                label=in_pin.upper(),
            )
            changed = True
    return changed


def validate_and_repair_schematic(schematic: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Programmatic sanity check + auto-repair for common AI wiring mistakes.

    Returns (repaired_schematic, list of human-readable repair notes).
    """
    components = [dict(c) for c in (schematic.get("components") or [])]
    wires = [dict(w) for w in (schematic.get("wires") or [])]
    notes = list(schematic.get("notes") or [])
    repairs: list[str] = []

    controller = _controller_for_schematic(components)
    steppers = [c for c in components if _is_stepper(c)]
    if not steppers:
        return schematic, repairs

    drivers = [c for c in components if _is_driver(c)]
    uln_drivers = [d for d in drivers if _is_uln2003(d)]
    # Treat unlabeled drivers paired with 28BYJ-style steppers as ULN2003 boards.
    if not uln_drivers and steppers and any(_looks_like_28byj(s) for s in steppers):
        for d in drivers:
            if not (d.get("label") or "").strip():
                d["label"] = "ULN2003"
                uln_drivers.append(d)
                repairs.append("Labeled motor driver as ULN2003 for 28BYJ-48 stepper.")
            elif _looks_like_28byj(steppers[0]) and "l298" not in (d.get("label") or "").lower():
                d["label"] = "ULN2003"
                uln_drivers.append(d)
                repairs.append("Relabeled motor driver as ULN2003 (28BYJ-48 uses socket board, not L298N).")

    for stepper in steppers:
        if not _looks_like_28byj(stepper):
            continue

        # Remove illegal OUT→stepper wires (socket board — motor harness is internal).
        removed_out = _remove_wires(
            wires,
            lambda w: _wire_touches(w, stepper["id"], set(COIL_PIN_IDS))
            and any(
                _wire_touches(w, d["id"], set(DRIVER_OUT_PIN_IDS)) for d in (uln_drivers or drivers)
            ),
        )
        if removed_out:
            repairs.append(
                "Removed driver OUT→stepper wires — 28BYJ-48 plugs into the ULN2003 white socket; O1–O4 are not jumpered."
            )

        # Rewire direct controller→stepper coil connections through a ULN2003 driver.
        direct_ctrl_wires = [
            w
            for w in wires
            if _wire_touches(w, stepper["id"], set(COIL_PIN_IDS))
            and controller
            and _wire_touches(w, controller["id"])
        ]
        if direct_ctrl_wires:
            driver = uln_drivers[0] if uln_drivers else None
            if not driver and controller:
                driver = _insert_uln2003_driver(components, stepper=stepper, controller=controller)
                uln_drivers.append(driver)
                drivers.append(driver)
                repairs.append("Inserted ULN2003 driver — stepper coils cannot connect directly to Arduino pins.")

            for w in direct_ctrl_wires:
                for side in ("from", "to"):
                    end = _wire_endpoint(w, side)
                    if not end:
                        continue
                    if end[0] == stepper["id"] and end[1] in COIL_PIN_IDS:
                        coil_idx = COIL_PIN_IDS.index(end[1])
                        in_pin = COIL_PIN_IDS[coil_idx]
                        other = _other_endpoint(w, end[0], end[1])
                        if other and driver:
                            other_comp, other_pin = other[1], other[2]
                            _add_wire(
                                wires,
                                from_comp=other_comp,
                                from_pin=other_pin,
                                to_comp=driver["id"],
                                to_pin=in_pin,
                                color=w.get("color") or WIRE_COLORS["signal"],
                                label=w.get("label") or in_pin.upper(),
                            )
            removed = _remove_wires(wires, lambda w: w in direct_ctrl_wires)
            if removed:
                repairs.append(
                    f"Moved {removed} direct controller→stepper wire(s) to ULN2003 IN1–IN4 inputs."
                )

        # Pick the ULN2003 that should drive this stepper.
        driver = uln_drivers[0] if uln_drivers else (drivers[0] if drivers else None)
        if not driver and controller:
            driver = _insert_uln2003_driver(components, stepper=stepper, controller=controller)
            uln_drivers.append(driver)
            drivers.append(driver)
            repairs.append("Added ULN2003 driver board between Arduino and 28BYJ-48 stepper.")

        if driver and controller:
            if _ensure_driver_power(wires, controller=controller, driver=driver):
                repairs.append("Added Arduino 5V/GND → ULN2003 VCC/GND power wires.")
            if _ensure_four_driver_inputs(wires, controller=controller, driver=driver):
                repairs.append(
                    "Wired four Arduino digital pins → ULN2003 IN1–IN4 "
                    "(default: D13, D12, D11, A0)."
                )

        # Flag DC-motor-style wiring: only one or two driver inputs used with no full set.
        if driver:
            wired_ins = sum(
                1
                for pin in COIL_PIN_IDS
                if any(_wire_touches(w, driver["id"], {pin}) for w in wires)
            )
            wired_outs = sum(
                1
                for pin in DRIVER_OUT_PIN_IDS
                if any(_wire_touches(w, driver["id"], {pin}) for w in wires)
            )
            if wired_ins < 4:
                repairs.append(
                    f"Warning: ULN2003 has only {wired_ins}/4 IN pins wired — steppers need IN1–IN4, not a single IN like a DC motor."
                )
            if wired_outs > 0 and _is_uln2003(driver):
                removed = _remove_wires(
                    wires,
                    lambda w, d=driver: _wire_touches(w, d["id"], set(DRIVER_OUT_PIN_IDS)),
                )
                if removed:
                    repairs.append(
                        "Removed external wires from ULN2003 OUT pins — motor connects via onboard socket only."
                    )

    if repairs:
        deduped: list[str] = []
        seen: set[str] = set()
        for r in repairs:
            if r not in seen:
                seen.add(r)
                deduped.append(r)
        for r in deduped:
            note = f"[Auto-repair] {r}"
            if note not in notes:
                notes.append(note)

    repaired = {
        **schematic,
        "components": components,
        "wires": wires,
        "notes": notes,
    }
    return repaired, repairs


def generate_wiring_schematic(
    ai: AIService,
    prompt: str,
    *,
    current: dict[str, Any] | None = None,
    images: list[dict[str, Any]] | None = None,
    trace_id: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any], str]:
    """Return (schematic, ai_trace, assistant_message)."""
    parts = [prompt.strip()]
    if current and (current.get("components") or current.get("wires")):
        slim = {
            "name": current.get("name"),
            "components": current.get("components"),
            "wires": current.get("wires"),
        }
        parts.append(f"\nCurrent schematic (edit/extend this):\n{json.dumps(slim, separators=(',', ':'))}")

    raw, trace = ai.generate_wiring(
        "\n".join(parts),
        trace_id=trace_id,
        images=images,
    )
    schematic = _normalize_schematic(raw)
    schematic, repairs = validate_and_repair_schematic(schematic)
    if repairs:
        trace = {**trace, "wiring_repairs": repairs}
    message = raw.get("message") or schematic.get("description") or f"Generated {schematic['name']}."
    return schematic, trace, message


# ── Circuit photo diagnostic ───────────────────────────────────────────────────

CIRCUIT_DEBUG_SYSTEM_PROMPT = """You are an expert electronics engineer and circuit debugger for Render3D's Wiring Simulator.

The user has uploaded a photo of their physical breadboard or circuit assembly and wants you to identify problems, misconnections, missing components, and potential damage risks.

Examine the image carefully:
1. Identify every visible component (microcontroller, breadboard, LEDs, resistors, capacitors, motors, wires, etc.)
2. Trace all wire connections you can see
3. Identify issues: wrong polarity, missing current-limiting resistors, direct motor connections without drivers, incorrect pin usage, floating inputs, missing pull-up/down resistors, short circuits, wrong voltage levels, improper ground connections
4. For 28BYJ-48 + ULN2003: flag wiring motor coils to O1/O2 like a DC motor, jumper wires from OUT pins to the motor (motor uses the white onboard socket), or fewer than four IN1–IN4 control lines from the microcontroller
5. If a reference schematic JSON is provided, compare the physical circuit to it and highlight discrepancies
6. Note what looks correct — not just problems

Reply with ONE JSON object only — no markdown fences, no prose outside the JSON.

Schema:
{
  "components_detected": ["Arduino Uno", "400-point breadboard", "red LED", "330Ω resistor"],
  "summary": "2 errors, 1 warning found",
  "issues": [
    {
      "severity": "error",
      "title": "LED connected without resistor",
      "description": "The LED's anode connects directly to pin D13 with no current-limiting resistor. Drawing ~40mA will damage the LED and potentially the Arduino output driver.",
      "location": "rows 10–12, right side of breadboard",
      "fix": "Insert a 220Ω–470Ω resistor between pin D13 and the LED anode (row 10)."
    }
  ],
  "correct_wiring": ["GND rail is connected to Arduino GND", "5V rail tied correctly"],
  "overall": "One critical error must be fixed before powering on — the LED will likely burn out immediately.",
  "safe_to_power": false
}

Severity levels:
- "error"   — will cause immediate damage or complete circuit failure; fix before powering on
- "warning" — circuit may work but has reliability or safety issues
- "info"    — best-practice suggestion or minor improvement

Be specific about physical locations (breadboard rows, pin numbers, wire colors) when visible.
If the image is too blurry or a component is unclear, say so in the issue description rather than guessing.
If no issues are found, return an empty issues array and set safe_to_power: true.
"""


def diagnose_circuit_photo(
    ai: "AIService",
    images: list[dict[str, Any]],
    *,
    description: str | None = None,
    current_schematic: dict[str, Any] | None = None,
    trace_id: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Analyse a photo of a physical circuit and return a structured diagnosis.

    Returns (diagnosis_dict, ai_trace).
    """
    parts: list[str] = []
    if description:
        parts.append(description.strip())
    else:
        parts.append("Please analyse this circuit photo and identify any wiring problems, errors, or safety issues.")

    if current_schematic and (current_schematic.get("components") or current_schematic.get("wires")):
        slim = {
            "name": current_schematic.get("name"),
            "components": [
                {"id": c.get("id"), "type": c.get("type"), "label": c.get("label")}
                for c in (current_schematic.get("components") or [])
            ],
            "wires": [
                {
                    "from": w.get("from"),
                    "to": w.get("to"),
                    "color": w.get("color"),
                    "label": w.get("label"),
                }
                for w in (current_schematic.get("wires") or [])
            ],
        }
        parts.append(
            f"\nExpected schematic (compare the photo against this):\n{json.dumps(slim, separators=(',', ':'))}"
        )

    user_prompt = "\n".join(parts)
    raw, trace = ai.diagnose_wiring_photo(user_prompt, images=images, trace_id=trace_id)

    # Normalise / validate output
    issues = raw.get("issues") if isinstance(raw.get("issues"), list) else []
    return {
        "components_detected": raw.get("components_detected") or [],
        "summary": raw.get("summary") or f"{len(issues)} issue(s) found",
        "issues": issues,
        "correct_wiring": raw.get("correct_wiring") or [],
        "overall": raw.get("overall") or "",
        "safe_to_power": bool(raw.get("safe_to_power", len(issues) == 0)),
    }, trace
