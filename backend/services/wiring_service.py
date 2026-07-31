"""AI-assisted breadboard / Arduino wiring schematic generation."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request
from html import unescape
from typing import Any

from backend.services.ai_service import AIService

WIRING_SYSTEM_PROMPT = """You are Render Studio's wiring schematic engine for breadboard, Arduino, and Raspberry Pi projects.

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
- DRV8825/A4988 expansion shield extra header pin IDs: dir_v, dir_g, en_v, en_g. The simulator can draw short jumper wires whose from/to endpoints use the SAME driver componentId.
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
- For any motor-driver → motor/stepper connection, put the motor/stepper clearly to the RIGHT of the driver with at least 180 px of horizontal air gap; do not stack the motor above the driver or close enough that coil wires cross over the driver or motor labels.
- Route power: board 5V/GND → breadboard rails → peripheral power pins.
- Route signals: board GPIO/PWM → breadboard row → peripheral signal pin.
- Space parts so wire paths are readable; y between 96–280 on a ~900px canvas.
- Place resistors, transistor, and diode ON the breadboard area (not floating far away).
- Include ALL wires needed for the circuit to work; keep labels short (≤20 chars, e.g. "GPIO17 input").
- Keep the JSON compact: use the smallest correct component/wire set, 2–4 notes, and no repeated explanatory text.
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
    Shield/header jumpers are drawable: use same-component wires on the driver, e.g. driver in3 (EN S) → driver dir_g (DIR G) to hold enable low, and route 5V logic to driver en_v (EN V) when the expansion shield's V row is physically used.
    Do NOT omit these tiny jumpers just because both ends are on the same driver; same-component jumper wires are valid and render as short internal cables.
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

COMMON_DRIVER_PROFILES: dict[str, dict[str, Any]] = {
    "drv8825": {
        "name": "DRV8825 stepper driver",
        "aliases": ("drv8825", "pololu drv8825"),
        "type": "bipolar_stepper_driver",
        "simulator_label": "DRV8825",
        "pin_map": {
            "in1": "STEP",
            "in2": "DIR",
            "in3": "EN/SLEEP/RESET optional enable control",
            "dir_v": "DIR header 5V jumper point",
            "dir_g": "DIR header ground jumper point",
            "en_v": "EN header 5V jumper point",
            "en_g": "EN header ground jumper point",
            "vcc": "logic VDD (3.3V/5V from controller)",
            "gnd": "common ground shared by controller and motor supply",
            "out1": "A1 / 1A coil",
            "out2": "A2 / 1B coil",
            "out3": "B1 / 2A coil",
            "out4": "B2 / 2B coil",
        },
        "wiring_guidance": [
            "Use a motor-driver component labeled DRV8825.",
            "Wire controller d2 (or a GPIO output) to driver in1 as STEP.",
            "Wire controller d3 (or a GPIO output) to driver in2 as DIR.",
            "Connect controller GND to driver GND and the motor power supply GND.",
            "Connect logic VDD from the controller 3.3V/5V rail to driver VCC/VDD.",
            "For the DAOKI/Arduino expansion shield style header, draw same-driver jumper wires: EN S (in3) to DIR G (dir_g), and 5V logic to EN V (en_v) when that is the physical V jumper point.",
            "Connect the bipolar stepper coil pairs to out1/out2 and out3/out4.",
            "Do not power a NEMA stepper from Arduino 5V. Use an external VMOT supply and set the current limit before powering the motor.",
        ],
    },
    "a4988": {
        "name": "A4988 stepper driver",
        "aliases": ("a4988",),
        "type": "bipolar_stepper_driver",
        "simulator_label": "A4988",
        "pin_map": {
            "in1": "STEP",
            "in2": "DIR",
            "in3": "EN optional enable control",
            "dir_v": "DIR header 5V jumper point",
            "dir_g": "DIR header ground jumper point",
            "en_v": "EN header 5V jumper point",
            "en_g": "EN header ground jumper point",
            "vcc": "logic VDD",
            "gnd": "common ground",
            "out1": "1A coil",
            "out2": "1B coil",
            "out3": "2A coil",
            "out4": "2B coil",
        },
        "wiring_guidance": [
            "Use STEP and DIR control lines; do not wire four phase inputs like ULN2003.",
            "Use an external motor supply for VMOT and common ground with the controller.",
            "For shield-style 3-pin S/V/G headers, draw same-component jumper wires when needed, including EN S (in3) to DIR G (dir_g) and 5V logic to EN V (en_v).",
            "Connect coil pairs to out1/out2 and out3/out4.",
        ],
    },
    "uln2003": {
        "name": "ULN2003 driver board",
        "aliases": ("uln2003", "28byj", "28byj-48"),
        "type": "unipolar_stepper_driver",
        "simulator_label": "ULN2003",
        "pin_map": {
            "in1": "IN1",
            "in2": "IN2",
            "in3": "IN3",
            "in4": "IN4",
            "vcc": "5V",
            "gnd": "GND",
        },
        "wiring_guidance": [
            "For 28BYJ-48, draw only controller IN1-IN4 plus VCC/GND.",
            "The motor plugs into the white onboard socket; do not draw OUT wires to the motor.",
        ],
    },
    "l298n": {
        "name": "L298N motor driver",
        "aliases": ("l298n", "l298"),
        "type": "dual_h_bridge_driver",
        "simulator_label": "L298N",
        "pin_map": {
            "in1": "IN1",
            "in2": "IN2",
            "in3": "IN3",
            "in4": "IN4",
            "vcc": "motor supply / logic supply depending module",
            "gnd": "common ground",
            "out1": "OUT1",
            "out2": "OUT2",
            "out3": "OUT3",
            "out4": "OUT4",
        },
        "wiring_guidance": [
            "Use IN1-IN4 for direction control and OUT pins for motor terminals or stepper coils.",
            "Use an external motor supply and common ground with the controller.",
        ],
    },
    "tb6600": {
        "name": "TB6600 stepper driver",
        "aliases": ("tb6600",),
        "type": "external_bipolar_stepper_driver",
        "simulator_label": "TB6600",
        "pin_map": {
            "in1": "PUL/STEP",
            "in2": "DIR",
            "in3": "ENA optional",
            "gnd": "controller signal ground / common reference",
            "out1": "A+",
            "out2": "A-",
            "out3": "B+",
            "out4": "B-",
        },
        "wiring_guidance": [
            "Wire STEP/PUL and DIR signals from the controller.",
            "Use the TB6600 external motor supply terminals for motor power.",
            "Connect motor coil pairs to A+/A- and B+/B-.",
        ],
    },
}


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


def _clean_url(url: str | None) -> str | None:
    text = (url or "").strip()
    if not text:
        return None
    try:
        parsed = urllib.parse.urlparse(text)
    except ValueError:
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None
    return urllib.parse.urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", parsed.query, ""))


def _urls_from_prompt(prompt: str) -> list[str]:
    try:
        from backend.services.url_document_service import urls_from_text

        return urls_from_text(prompt, limit=3)
    except Exception:
        urls = re.findall(r"https?://[^\s<>\]\)\"']+", prompt or "")
        cleaned: list[str] = []
        for url in urls:
            url = url.rstrip(".,;")
            clean = _clean_url(url)
            if clean and clean not in cleaned:
                cleaned.append(clean)
        return cleaned[:3]


def _fetch_product_page_text(url: str) -> tuple[str, str | None]:
    """Return (text, error). Supports HTML product pages and datasheet PDFs."""
    try:
        from backend.services.url_document_service import fetch_url_document

        doc = fetch_url_document(url)
        text = (doc.get("text") or "").strip()
        if doc.get("ok") and text:
            title = (doc.get("title") or "").strip()
            combined = f"{title}\n{text}".strip() if title else text
            return combined[:18_000], doc.get("error")
        return text[:2000], doc.get("error") or "Could not read product page."
    except Exception as exc:
        return "", str(exc)


def _infer_driver_profile(text: str) -> dict[str, Any] | None:
    hay = (text or "").lower()
    for key, profile in COMMON_DRIVER_PROFILES.items():
        aliases = (key, *(profile.get("aliases") or ()))
        if any(alias.lower() in hay for alias in aliases):
            return {"key": key, **profile}
    return None


def analyze_driver_link(url: str | None) -> dict[str, Any] | None:
    clean = _clean_url(url)
    if not clean:
        return None
    parsed = urllib.parse.urlparse(clean)
    url_text = " ".join(
        [
            parsed.netloc,
            urllib.parse.unquote(parsed.path),
            urllib.parse.unquote(parsed.query),
        ]
    )
    page_text, fetch_error = _fetch_product_page_text(clean)
    profile = _infer_driver_profile(f"{url_text} {page_text}") or {}
    if not profile and not page_text:
        return {
            "url": clean,
            "fetch_error": fetch_error or "Could not read product page.",
            "summary": "Product link could not be identified. Ask the user for the driver chip name or datasheet.",
            "page_excerpt": "",
            "page_text": "",
            "title": "",
            "kind": "unknown",
        }
    title = ""
    first_line = (page_text or "").split("\n", 1)[0].strip()
    if first_line and len(first_line) < 160:
        title = first_line
    return {
        "url": clean,
        "title": title,
        "page_excerpt": page_text[:500] if page_text else "",
        "page_text": page_text[:12_000] if page_text else "",
        "fetch_error": fetch_error,
        "driver": profile or None,
        "kind": "pdf" if clean.lower().endswith(".pdf") else "html",
        "summary": (
            f"Identified {profile['name']} from product link."
            if profile
            else (
                f"Fetched datasheet/product page ({title or 'untitled'}) for wiring context."
                if page_text
                else "Read product page, but no known driver chip was identified."
            )
        ),
    }


def _driver_link_context(driver_links: list[str] | None, prompt: str) -> tuple[str | None, list[dict[str, Any]]]:
    urls: list[str] = []
    for url in driver_links or []:
        clean = _clean_url(url)
        if clean and clean not in urls:
            urls.append(clean)
    for url in _urls_from_prompt(prompt):
        if url not in urls:
            urls.append(url)
    analyses = [a for u in urls[:3] if (a := analyze_driver_link(u))]
    if not analyses:
        return None, []
    lines = ["\nRelevant product-link / datasheet facts:"]
    for idx, analysis in enumerate(analyses, 1):
        parsed = urllib.parse.urlparse(analysis["url"])
        compact_url = urllib.parse.urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", "", ""))
        lines.append(f"{idx}. URL: {compact_url}")
        if analysis.get("title"):
            lines.append(f"   Title: {analysis['title']}")
        if analysis.get("fetch_error"):
            lines.append(f"   Fetch note: {analysis['fetch_error']}")
        driver = analysis.get("driver")
        if driver:
            lines.append(f"   Identified driver: {driver['name']} ({driver['type']})")
            lines.append(f"   Simulator component: motor-driver labeled \"{driver['simulator_label']}\"")
            lines.append(f"   Pin mapping: {json.dumps(driver['pin_map'], separators=(',', ':'))}")
            guidance = driver.get("wiring_guidance", [])[:4]
            if guidance:
                lines.append("   Key wiring guidance:")
                lines.extend(f"   - {note}" for note in guidance)
        page_text = analysis.get("page_text") or analysis.get("page_excerpt") or ""
        if page_text:
            lines.append("   Extracted datasheet / page content (use for pinouts, voltages, connectors):")
            lines.append(page_text[:10_000])
            if len(page_text) > 10_000:
                lines.append("   …(truncated)")
    lines.append(
        "Prefer explicit facts from these linked documents for wiring. "
        "Do not invent pinouts that contradict the datasheet."
    )
    return "\n".join(lines), analyses


def _prompt_terms(prompt: str) -> set[str]:
    terms = set(re.findall(r"[a-z0-9]{3,}", (prompt or "").lower()))
    return terms - {
        "the", "this", "that", "with", "wire", "wiring", "schematic", "update",
        "based", "from", "into", "link", "driver", "motor",
    }


def _component_is_relevant(component: dict[str, Any], prompt_terms: set[str], driver_keys: set[str]) -> bool:
    ctype = str(component.get("type") or "").lower()
    label = str(component.get("label") or "").lower()
    cid = str(component.get("id") or "").lower()
    if ctype in {"arduino-uno", "arduino-mega", "raspberry-pi", "breadboard", "motor-driver", "stepper", "motor"}:
        return True
    if any(key and key in label for key in driver_keys):
        return True
    return any(term in label or term in cid or term in ctype for term in prompt_terms)


def _compact_current_schematic(
    current: dict[str, Any] | None,
    prompt: str,
    driver_link_analysis: list[dict[str, Any]],
) -> dict[str, Any] | None:
    if not current or not (current.get("components") or current.get("wires")):
        return None
    prompt_terms = _prompt_terms(prompt)
    driver_keys = {
        str((analysis.get("driver") or {}).get("key") or "").lower()
        for analysis in driver_link_analysis
    }
    components = [
        {
            "id": c.get("id"),
            "type": c.get("type"),
            "label": c.get("label"),
        }
        for c in (current.get("components") or [])
        if isinstance(c, dict) and _component_is_relevant(c, prompt_terms, driver_keys)
    ]
    relevant_ids = {str(c.get("id")) for c in components if c.get("id")}
    wires = []
    for wire in current.get("wires") or []:
        if not isinstance(wire, dict):
            continue
        from_id = str((wire.get("from") or {}).get("componentId") or "")
        to_id = str((wire.get("to") or {}).get("componentId") or "")
        if from_id not in relevant_ids and to_id not in relevant_ids:
            continue
        wires.append({
            "id": wire.get("id"),
            "from": wire.get("from"),
            "to": wire.get("to"),
            "label": wire.get("label"),
        })
        if len(wires) >= 24:
            break
    return {
        "name": current.get("name"),
        "description": current.get("description"),
        "components": components[:12],
        "wires": wires,
        "component_count": len(current.get("components") or []),
        "wire_count": len(current.get("wires") or []),
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


def _is_step_dir_driver(comp: dict[str, Any]) -> bool:
    if not _is_driver(comp):
        return False
    label = (comp.get("label") or "").lower()
    return any(token in label for token in ("drv8825", "a4988", "tb6600", "step/dir", "step dir", "expansion shield"))


STEP_DIR_PIN_LABELS = {
    "in1": "S",
    "in2": "DIR",
    "in3": "EN",
    "in4": "MS",
    "vcc": "V",
    "gnd": "G",
    "out1": "A1",
    "out2": "A2",
    "out3": "B1",
    "out4": "B2",
}


def _apply_step_dir_driver_metadata(components: list[dict[str, Any]], wires: list[dict[str, Any]]) -> list[str]:
    repairs: list[str] = []
    step_dir_drivers = [d for d in components if _is_step_dir_driver(d)]
    for driver in step_dir_drivers:
        labels = dict(driver.get("pin_labels") or {})
        changed_labels = False
        for pin, label in STEP_DIR_PIN_LABELS.items():
            if labels.get(pin) != label:
                labels[pin] = label
                changed_labels = True
        if changed_labels:
            driver["pin_labels"] = labels
            repairs.append("Applied DRV8825/A4988 shield pin labels: S/STEP, DIR, V, G, A1/A2/B1/B2.")

        for wire in wires:
            if not _wire_touches(wire, driver["id"]):
                continue
            if _wire_touches(wire, driver["id"], {"in1"}) and "step" not in str(wire.get("label") or "").lower():
                wire["label"] = "S (STEP)"
            elif _wire_touches(wire, driver["id"], {"in2"}) and "dir" not in str(wire.get("label") or "").lower():
                wire["label"] = "DIR"
            elif _wire_touches(wire, driver["id"], {"vcc"}) and str(wire.get("label") or "").lower() in {"vcc", "5v", "v"}:
                wire["label"] = "V (logic 5V)"
            elif _wire_touches(wire, driver["id"], {"gnd"}) and str(wire.get("label") or "").lower() in {"gnd", "g"}:
                wire["label"] = "G common GND"
    return repairs


def _ensure_step_dir_driver_jumpers(wires: list[dict[str, Any]], driver: dict[str, Any]) -> list[str]:
    """Add shield-style same-component jumpers for DRV8825/A4988 headers."""
    repairs: list[str] = []
    driver_id = str(driver.get("id") or "")
    if not driver_id:
        return repairs
    if not _has_wire(wires, driver_id, "in3", driver_id, "dir_g"):
        _add_wire(
            wires,
            from_comp=driver_id,
            from_pin="in3",
            to_comp=driver_id,
            to_pin="dir_g",
            color=WIRE_COLORS["gnd"],
            label="EN S->DIR G",
        )
        repairs.append("Added DRV8825/A4988 shield jumper: EN S to DIR G.")
    if not _has_wire(wires, driver_id, "vcc", driver_id, "en_v"):
        _add_wire(
            wires,
            from_comp=driver_id,
            from_pin="vcc",
            to_comp=driver_id,
            to_pin="en_v",
            color=WIRE_COLORS["power"],
            label="5V->EN V",
        )
        repairs.append("Added DRV8825/A4988 shield jumper: STEP V/5V to EN V.")
    return repairs


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
    drivers = [c for c in components if _is_driver(c)]
    repairs.extend(_apply_step_dir_driver_metadata(components, wires))
    for driver in [d for d in drivers if _is_step_dir_driver(d)]:
        repairs.extend(_ensure_step_dir_driver_jumpers(wires, driver))

    steppers = [c for c in components if _is_stepper(c)]
    if not steppers:
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
            return {
                **schematic,
                "components": components,
                "wires": wires,
                "notes": notes,
            }, repairs
        return schematic, repairs
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
    driver_links: list[str] | None = None,
    trace_id: str | None = None,
) -> tuple[dict[str, Any], dict[str, Any], str]:
    """Return (schematic, ai_trace, assistant_message)."""
    parts = [prompt.strip()]
    driver_context, driver_link_analysis = _driver_link_context(driver_links, prompt)
    if driver_context:
        parts.append(driver_context)
    if current and (current.get("components") or current.get("wires")):
        compact = _compact_current_schematic(current, prompt, driver_link_analysis)
        if compact:
            parts.append(
                "\nRelevant current schematic subset (preserve these IDs when editing):\n"
                f"{json.dumps(compact, separators=(',', ':'))}"
            )

    raw, trace = ai.generate_wiring(
        "\n".join(parts),
        trace_id=trace_id,
        images=images,
    )
    trace = {**trace, "prompt_chars": sum(len(p) for p in parts)}
    schematic = _normalize_schematic(raw)
    schematic, repairs = validate_and_repair_schematic(schematic)
    if repairs:
        trace = {**trace, "wiring_repairs": repairs}
    if driver_link_analysis:
        trace = {**trace, "driver_link_analysis": driver_link_analysis}
    message = raw.get("message") or schematic.get("description") or f"Generated {schematic['name']}."
    return schematic, trace, message


# ── Circuit photo diagnostic ───────────────────────────────────────────────────

CIRCUIT_DEBUG_SYSTEM_PROMPT = """You are an expert electronics engineer and circuit debugger for Render Studio's Wiring Simulator.

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
      "fix": "Insert a 220Ω–470Ω resistor between pin D13 and the LED anode (row 10).",
      "related_wire_ids": ["w1", "w2"]
    }
  ],
  "correct_wiring": ["GND rail is connected to Arduino GND", "5V rail tied correctly"],
  "overall": "One critical error must be fixed before powering on — the LED will likely burn out immediately.",
  "safe_to_power": false,
  "focus_diagram": {
    "title": "Missing resistor on D13 → LED",
    "caption": "Only the connections visible as wrong in the photo — not the whole circuit.",
    "schematic": {
      "name": "Photo focus",
      "components": [
        { "id": "board", "type": "arduino-uno", "label": "Arduino Uno", "x": 32, "y": 96, "w": 140, "h": 90 },
        { "id": "led1", "type": "led", "label": "Red LED", "x": 380, "y": 132, "w": 36, "h": 36 }
      ],
      "wires": [
        { "id": "w1", "from": { "componentId": "board", "pinId": "d13" }, "to": { "componentId": "led1", "pinId": "anode" }, "color": "#58a6ff", "label": "D13→LED (no R)", "status": "issue" },
        { "id": "w2", "from": { "componentId": "board", "pinId": "d13" }, "to": { "componentId": "led1", "pinId": "anode" }, "color": "#58a6ff", "label": "add 330Ω here", "status": "missing" }
      ]
    },
    "issue_wire_ids": ["w1", "w2"]
  }
}

CRITICAL — focus_diagram is a PHOTO-SPECIFIC highlight, NOT a full wiring diagram:
- schematic.wires must contain ONLY connections that are wrong, missing, or need changing based on what you see in the photo (typically 1–3 wires).
- Do NOT list correct signal lines, control pins, or rails that are already fine. If the problem is power (missing 5V, wrong GND, no VCC to driver), show ONLY those power wires — not D13/D12/IN1 control lines unless they are also wrong in the photo.
- Include the minimum components (usually 2–4) needed to show those bad connections. Omit breadboard "Rails" unless a rail junction is directly part of the fault.
- Set status "issue" | "missing" | "wrong" on every wire you include. Never include wires with status "correct".
- Set focus_diagram.issue_wire_ids to the same wire ids. Link each issue to its wires via issues[].related_wire_ids.

Use the same component types and pin IDs as the wiring generator (arduino-uno, breadboard, led, resistor, motor-driver, stepper, motor, etc.). Layout left → right: board on the left, driver/peripheral on the right; breadboard only when needed. Give each wire a short label (≤20 chars) such as "5V→VCC missing", "GND not connected". Use full component labels (e.g. "Arduino Uno R4 WiFi", "ULN2003", "28BYJ-48") — never truncate with "...".

Severity levels:
- "error"   — will cause immediate damage or complete circuit failure; fix before powering on
- "warning" — circuit may work but has reliability or safety issues
- "info"    — best-practice suggestion or minor improvement

Be specific about physical locations (breadboard rows, pin numbers, wire colors) when visible.
If the image is too blurry or a component is unclear, say so in the issue description rather than guessing.
If no issues are found, return an empty issues array and set safe_to_power: true.
Always return focus_diagram with at least two components and one wire when any issue exists; if the circuit is fully correct, return focus_diagram with an empty wires array and a caption explaining what looks good.
"""

FOCUS_COMPONENT_DEFAULTS: dict[str, tuple[int, int]] = {
    "raspberry-pi": (118, 88),
    "arduino-uno": (118, 78),
    "arduino-mega": (132, 86),
    "breadboard": (64, 40),
    "motor-driver": (96, 72),
    "stepper": (72, 72),
    "servo-motor": (72, 72),
    "motor": (56, 56),
    "led": (40, 40),
    "resistor": (56, 22),
    "transistor": (44, 52),
    "diode": (48, 20),
    "button": (40, 40),
    "sensor": (56, 48),
}


def _order_focus_components(
    components: list[dict[str, Any]],
    wires: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_id = {str(c.get("id")): c for c in components if c.get("id")}
    if not by_id:
        return components
    controller = next((c for c in components if c.get("type") in CONTROLLER_TYPES), components[0])
    start_id = str(controller.get("id"))
    visited: set[str] = set()
    ordered: list[dict[str, Any]] = []

    def visit(cid: str) -> None:
        if cid in visited or cid not in by_id:
            return
        visited.add(cid)
        ordered.append(by_id[cid])
        for wire in wires:
            for side in ("from", "to"):
                end = _wire_endpoint(wire, side)
                if not end or end[0] != cid:
                    continue
                other_side = "to" if side == "from" else "from"
                other = _wire_endpoint(wire, other_side)
                if other:
                    visit(other[0])

    visit(start_id)
    for comp in components:
        cid = str(comp.get("id") or "")
        if cid and cid not in visited:
            ordered.append(comp)
    return ordered or components


def _auto_layout_focus_schematic(schematic: dict[str, Any]) -> dict[str, Any]:
    components = [dict(c) for c in (schematic.get("components") or [])]
    wires = [dict(w) for w in (schematic.get("wires") or [])]
    if not components:
        return schematic

    ordered = _order_focus_components(components, wires)
    x = 20.0
    y = 36.0
    gap = 56.0
    for comp in ordered:
        ctype = str(comp.get("type") or "sensor")
        default_w, default_h = FOCUS_COMPONENT_DEFAULTS.get(ctype, (80, 48))
        comp["w"] = int(comp.get("w") or default_w)
        comp["h"] = int(comp.get("h") or default_h)
        comp["x"] = int(x)
        comp["y"] = int(y)
        if not comp.get("label"):
            comp["label"] = ctype.replace("-", " ")
        if not comp.get("id"):
            comp["id"] = _new_component_id("focus")
        x += comp["w"] + gap

    for wire in wires:
        if not wire.get("id"):
            wire["id"] = _new_wire_id("fw")
        if not wire.get("color"):
            wire["color"] = WIRE_COLORS["signal"]

    schematic["components"] = ordered
    schematic["wires"] = wires
    return schematic


_FOCUS_ISSUE_STATUSES = {"issue", "missing", "wrong", "error", "fix", "broken"}
_POWER_TERMS = ("5v", "vcc", "power", "gnd", "ground", "rail", "v+", "v-", "t+", "t-")
_SIGNAL_TERMS = ("d13", "d12", "d11", "d10", "in1", "in2", "in3", "in4", "a0", "sda", "scl", "out1", "out2")


def _issue_text_blob(issue: dict[str, Any]) -> str:
    return " ".join(
        str(issue.get(k) or "") for k in ("title", "description", "fix", "location")
    ).lower()


def _wire_pin_blob(wire: dict[str, Any]) -> str:
    label = str(wire.get("label") or "").lower()
    from_pin = str((wire.get("from") or {}).get("pinId") or "").lower()
    to_pin = str((wire.get("to") or {}).get("pinId") or "").lower()
    return f"{label} {from_pin} {to_pin}"


def _infer_issue_wires_from_issues(
    schematic: dict[str, Any],
    issues: list[dict[str, Any]],
) -> list[str]:
    """Guess issue wire ids from issue text when the model omitted related_wire_ids."""
    wires = schematic.get("wires") or []
    if not wires or not issues:
        return []
    inferred: set[str] = set()
    for issue in issues:
        text = _issue_text_blob(issue)
        is_power = any(t in text for t in _POWER_TERMS)
        is_signal = any(t in text for t in _SIGNAL_TERMS)
        for wire in wires:
            wid = wire.get("id")
            if not wid:
                continue
            blob = _wire_pin_blob(wire)
            if is_power and any(t in blob for t in _POWER_TERMS + ("vcc", "gnd", "5v")):
                inferred.add(str(wid))
            elif is_signal and any(t in blob for t in _SIGNAL_TERMS):
                inferred.add(str(wid))
    return sorted(inferred)


def _issue_wire_ids_from_focus(
    raw: dict[str, Any],
    schematic: dict[str, Any],
    issues: list[dict[str, Any]],
) -> list[str]:
    ids: set[str] = set()
    for wid in raw.get("issue_wire_ids") or []:
        if wid:
            ids.add(str(wid))
    for issue in issues:
        for wid in issue.get("related_wire_ids") or []:
            if wid:
                ids.add(str(wid))
    for wire in schematic.get("wires") or []:
        wid = wire.get("id")
        if not wid:
            continue
        status = str(wire.get("status") or "").lower()
        if wire.get("needs_fix") or wire.get("issue") is True or status in _FOCUS_ISSUE_STATUSES:
            ids.add(str(wid))
    if not ids:
        ids.update(_infer_issue_wires_from_issues(schematic, issues))
    return sorted(ids)


def _narrow_focus_schematic(
    schematic: dict[str, Any],
    issue_wire_ids: list[str],
) -> dict[str, Any]:
    """Keep only issue wires and the components they connect — drop correct context wires."""
    wires_all = [dict(w) for w in (schematic.get("wires") or [])]
    id_set = {str(i) for i in issue_wire_ids if i}

    if id_set:
        issue_wires = [w for w in wires_all if str(w.get("id")) in id_set]
    else:
        issue_wires = [
            w
            for w in wires_all
            if str(w.get("status") or "").lower() in _FOCUS_ISSUE_STATUSES
            or w.get("needs_fix")
            or w.get("issue") is True
        ]

    if not issue_wires:
        return schematic

    comp_ids: set[str] = set()
    for wire in issue_wires:
        for side in ("from", "to"):
            end = wire.get(side)
            if isinstance(end, dict) and end.get("componentId"):
                comp_ids.add(str(end["componentId"]))

    components = [
        dict(c) for c in (schematic.get("components") or []) if str(c.get("id")) in comp_ids
    ]
    if len(components) < 2:
        return {**schematic, "wires": issue_wires}

    return {**schematic, "components": components, "wires": issue_wires}


def _prepare_focus_diagram(
    raw: Any,
    *,
    issues: list[dict[str, Any]] | None = None,
) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    schematic_raw = raw.get("schematic")
    if not isinstance(schematic_raw, dict):
        return None
    schematic = _normalize_schematic(schematic_raw)
    if len(schematic.get("components") or []) < 2:
        return None
    schematic, _repairs = validate_and_repair_schematic(schematic)
    schematic = _auto_layout_focus_schematic(schematic)
    if len(schematic.get("components") or []) < 2:
        return None
    title = str(raw.get("title") or schematic.get("name") or "Signal path").strip()
    caption = str(raw.get("caption") or schematic.get("description") or "").strip()
    issue_list = issues if isinstance(issues, list) else []
    issue_wire_ids = _issue_wire_ids_from_focus(raw, schematic, issue_list)
    schematic = _narrow_focus_schematic(schematic, issue_wire_ids)
    schematic = _auto_layout_focus_schematic(schematic)
    issue_wire_ids = _issue_wire_ids_from_focus(raw, schematic, issue_list)
    return {
        "title": title,
        "caption": caption,
        "schematic": schematic,
        "issue_wire_ids": issue_wire_ids,
    }


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
        wires = (current_schematic.get("wires") or [])[:40]
        slim = {
            "name": current_schematic.get("name"),
            "components": [
                {"id": c.get("id"), "type": c.get("type"), "label": c.get("label")}
                for c in (current_schematic.get("components") or [])[:24]
            ],
            "wires": [
                {
                    "from": w.get("from"),
                    "to": w.get("to"),
                    "color": w.get("color"),
                    "label": w.get("label"),
                }
                for w in wires
            ],
        }
        parts.append(
            f"\nExpected schematic (compare the photo against this):\n{json.dumps(slim, separators=(',', ':'))}"
        )

    user_prompt = "\n".join(parts)
    raw, trace = ai.diagnose_wiring_photo(user_prompt, images=images, trace_id=trace_id)

    # Normalise / validate output
    issues = raw.get("issues") if isinstance(raw.get("issues"), list) else []
    focus_diagram = _prepare_focus_diagram(raw.get("focus_diagram"), issues=issues)
    return {
        "components_detected": raw.get("components_detected") or [],
        "summary": raw.get("summary") or f"{len(issues)} issue(s) found",
        "issues": issues,
        "correct_wiring": raw.get("correct_wiring") or [],
        "overall": raw.get("overall") or "",
        "safe_to_power": bool(raw.get("safe_to_power", len(issues) == 0)),
        "focus_diagram": focus_diagram,
    }, trace
