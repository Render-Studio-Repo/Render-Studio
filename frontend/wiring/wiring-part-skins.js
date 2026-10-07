/** Pictorial electronics skins: Fritzing breadboard views + custom industrial boards. */

export const WIRING_PARTS_BASE = "/wiring-parts";
export const FRITZING_CREDIT =
  "Part outlines include Fritzing breadboard graphics (CC BY-SA 3.0).";

/**
 * First match wins. Keep order in sync with wiring-parts/catalog.json:
 * product-specific labels before generic Mega / driver / PSU types.
 */
const SKINS = [
  { id: "mks-gen-l", src: "custom/mks-gen-l.svg", labelRe: /mks\s*gen\s*l/i },
  { id: "cl86t", src: "custom/cl86t.svg", labelRe: /cl86/i },
  { id: "tb6600", src: "custom/tb6600.svg", labelRe: /tb6600/i },
  { id: "nema34", src: "custom/nema-34.svg", labelRe: /nema\s*34/i },
  { id: "psu-48", src: "custom/psu-48v.svg", type: "power-supply", labelRe: /\b48\s*v/i },
  { id: "robot-hat", src: "custom/robot-hat.svg", labelRe: /robot\s*hat/i },
  { id: "nano", src: "fritzing/arduino-nano.svg", labelRe: /arduino\s*nano(?:\s*3)?(?!\s*(?:33|esp|rp|every))\b/i },
  { id: "drv8825", src: "fritzing/drv8825.svg", labelRe: /drv8825/i },
  { id: "a4988", src: "fritzing/a4988.svg", labelRe: /a4988/i },
  { id: "uln2003", src: "fritzing/uln2003.svg", labelRe: /uln\s*2003/i },
  { id: "vnh2sp30", src: "fritzing/hbridge.svg", labelRe: /vnh2sp30/i },
  { id: "pi", src: "fritzing/raspberry-pi-4.svg", type: "raspberry-pi", labelRe: /raspberry\s*pi\s*4|\bpi\s*4b\b/i },
  { id: "mega", src: "fritzing/arduino-mega.svg", type: "arduino-mega" },
  { id: "uno", src: "fritzing/arduino-uno.svg", type: "arduino-uno" },
  { id: "breadboard", src: "fritzing/breadboard.svg", type: "breadboard" },
  { id: "stepper", src: "fritzing/stepper.svg", type: "stepper" },
  { id: "servo", src: "fritzing/servo.svg", type: "servo-motor" },
  { id: "motor", src: "fritzing/dc-motor.svg", type: "motor" },
  { id: "led", src: "fritzing/led.svg", type: "led" },
  { id: "resistor", src: "fritzing/resistor.svg", type: "resistor" },
  { id: "transistor", src: "fritzing/npn.svg", type: "transistor" },
  { id: "diode", src: "fritzing/diode.svg", type: "diode" },
  { id: "button", src: "fritzing/button.svg", type: "button" },
  { id: "psu", src: "fritzing/psu-lab.svg", type: "power-supply" },
  { id: "module", src: "custom/module.svg", type: "sensor" },
  { id: "driver", src: "custom/module.svg", type: "motor-driver" },
  { id: "pi-generic", src: "custom/module.svg", type: "raspberry-pi" },
];

export function resolveSkin(component) {
  if (component?.pin_layout_mode === "diagram") return {id:"module",src:"custom/module.svg"};
  const type = String(component?.type || "");
  const label = String(component?.label || "");
  for (const skin of SKINS) {
    const labelOk = skin.labelRe ? skin.labelRe.test(label) : true;
    const typeOk = skin.type ? skin.type === type : true;
    if (labelOk && typeOk && (skin.labelRe || skin.type)) return skin;
  }
  return null;
}

export function skinKind(component) {
  return resolveSkin(component)?.id || "";
}

export function partSkinHref(component) {
  const skin = resolveSkin(component);
  if (!skin) return "";
  return `${WIRING_PARTS_BASE}/${skin.src}`;
}

export function partSkinMarkup(component) {
  const skin = resolveSkin(component);
  if (!skin) return "";
  const href = `${WIRING_PARTS_BASE}/${skin.src}`;
  return `<div class="wiring-part-skin wiring-part-skin--${skin.id}" aria-hidden="true">
    <img class="wiring-part-skin-img" src="${href}" alt="" />
  </div>`;
}
