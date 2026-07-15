/**
 * Electronic part recognition.
 *
 * Maps a CAD component file name (e.g. "adafruit_858_stepper_motor_5vdc",
 * "arduino_nano_r4") to a wiring-simulator component type with the correct
 * pin layout, plus a human label and a hint about where to source the
 * schematic / pinout. This is how the app "knows what it is looking at" when a
 * component is dragged from the project browser into the wiring viewport or the
 * chat.
 *
 * Rules are ordered most-specific first; the first match wins.
 * Cases / enclosures never auto-map — those stay electrically "none".
 */

const ENCLOSURE_RE = /\b(case|enclosure|housing|lid|cover|shell|chassis|bracket|holder|stand|bezel|faceplate)\b/;

const RULES = [
  {
    test: /(28byj|stepper|nema\s*\d|nema\d)/,
    wiringType: "stepper",
    kind: "Stepper motor",
    datasheet: "stepper motor coil pinout (e.g. 28BYJ-48 / NEMA-17) datasheet",
  },
  {
    test: /servo|sg90|mg996|mg90/,
    wiringType: "servo-motor",
    kind: "Servo motor",
    datasheet: "servo signal/VCC/GND pinout datasheet",
  },
  {
    test: /(l298|l293|uln2003|a4988|drv8825|tb6600|tb6612|motor[_\- ]?driver|h[_\- ]?bridge|stepper[_\- ]?driver)/,
    wiringType: "motor-driver",
    kind: "Motor driver",
    datasheet: "motor-driver module IN/OUT + VCC/GND pinout datasheet",
  },
  {
    test: /(dc[_\- ]?motor|gear[_\- ]?motor|\bmotor\b|tt[_\- ]?motor|brushed)/,
    wiringType: "motor",
    kind: "DC motor",
    datasheet: "DC motor terminal polarity datasheet",
  },
  {
    test: /arduino[_\- ]?mega|atmega2560|\bmega\b/,
    wiringType: "arduino-mega",
    kind: "Arduino Mega",
    datasheet: "Arduino Mega 2560 pinout",
  },
  {
    test: /arduino|atmega|\bnano\b|\buno\b|leonardo|pro[_\- ]?micro|atmega328|seeeduino/,
    wiringType: "arduino-uno",
    kind: "Arduino board",
    datasheet: "Arduino pinout (digital D-pins, analog A-pins, 5V, GND)",
  },
  {
    test: /raspberry|\brpi\b|\bpi[_\- ]?(zero|3|4|5|pico)\b|bcm283|rp2040/,
    wiringType: "raspberry-pi",
    kind: "Raspberry Pi",
    datasheet: "Raspberry Pi 40-pin GPIO header pinout",
  },
  {
    test: /(2n2222|bc547|bc548|tip120|mosfet|irf\d|irlz|npn|pnp|transistor)/,
    wiringType: "transistor",
    kind: "Transistor",
    datasheet: "transistor base/collector/emitter pinout datasheet",
  },
  {
    test: /(1n4148|1n400\d|schottky|flyback|\bdiode\b)/,
    wiringType: "diode",
    kind: "Diode",
    datasheet: "diode anode/cathode (band = cathode) datasheet",
  },
  {
    // Avoid bare "5R" / "UV-5R" model codes — require resistor / ohm wording.
    test: /(resistor|\b\d+(\.\d+)?\s*k?\s*ohms?\b|\bohm\b)/,
    wiringType: "resistor",
    kind: "Resistor",
    datasheet: "resistor value / colour-code reference",
  },
  {
    test: /(\bled\b|neopixel|ws2812|diffused|5mm[_\- ]?led)/,
    wiringType: "led",
    kind: "LED",
    datasheet: "LED forward voltage + anode/cathode reference",
  },
  {
    test: /(button|push[_\- ]?button|tactile|momentary|switch|\bspst\b)/,
    wiringType: "button",
    kind: "Push button",
    datasheet: "push button / switch contact pinout",
  },
  {
    test: /(sensor|hc[_\- ]?sr04|ultrasonic|\bpir\b|\bdht\d{2}\b|\bir\b|photo|ldr|potentiometer|\bpot\b|encoder|hall|imu|mpu6050|accel)/,
    wiringType: "sensor",
    kind: "Sensor / input module",
    datasheet: "sensor module pinout datasheet",
  },
  {
    test: /(breadboard|protoboard|perfboard)/,
    wiringType: "breadboard",
    kind: "Breadboard",
    datasheet: "breadboard rail / column connectivity",
  },
];

function normalize(name) {
  return String(name || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_\-]+/g, " ")
    .toLowerCase()
    .trim();
}

/** Extract a manufacturer + part number guess, e.g. "adafruit 858" → "Adafruit #858". */
function partNumberGuess(norm) {
  const mfr = norm.match(/\b(adafruit|sparkfun|seeed|pololu|dfrobot|arduino|raspberry|waveshare)\b/);
  const num = norm.match(/\b(\d{3,5})\b/);
  if (mfr && num) return `${cap(mfr[1])} #${num[1]}`;
  if (mfr) return cap(mfr[1]);
  return "";
}

function cap(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Title-case a normalized stem into a friendly label. */
export function prettyPartLabel(name) {
  const norm = normalize(name);
  return norm
    .split(" ")
    .filter(Boolean)
    .map((w) => (/^\d/.test(w) ? w.toUpperCase() : cap(w)))
    .join(" ");
}

/**
 * Recognize an electronic part from a file name / stem.
 * Returns null when nothing matches, and always null for cases/enclosures.
 *
 * @returns {{
 *   wiringType: string, kind: string, label: string,
 *   partNumber: string, datasheet: string, confidence: "high"|"low"
 * } | null}
 */
export function recognizePart(name) {
  const norm = normalize(name);
  if (!norm) return null;
  // Mechanical shells keep Electrical type = none even if the name mentions a board.
  if (ENCLOSURE_RE.test(norm)) return null;
  for (const rule of RULES) {
    if (rule.test.test(norm)) {
      const partNumber = partNumberGuess(norm);
      const pretty = prettyPartLabel(name) || rule.kind;
      // Use "Mfr #123 Kind" only when we found a real part number; otherwise the
      // prettified file name (e.g. "Arduino Nano R4") reads better than "Arduino Arduino board".
      const label = partNumber && /\d/.test(partNumber) ? `${partNumber} ${rule.kind}` : pretty;
      return {
        wiringType: rule.wiringType,
        kind: rule.kind,
        label,
        partNumber,
        datasheet: rule.datasheet,
        confidence: "high",
      };
    }
  }
  return null;
}
