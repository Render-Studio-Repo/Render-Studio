# Wiring component sources and link references

## Prompt links

The CAD and wiring composers share the same link UI. A colon-ended description
binds the following pasted URL, even across blank lines. The reference retains
the original URL (including product-variant parameters), its description, and a
stable token. Copy/cut expands selected chips back to URLs or file paths.

Hover or focus shows a compact preview. Right-click or Shift+F10 opens copy,
browser, native share, email, text, Discord (copy + launch), and Parts List actions.
These actions open local apps; they do not send messages automatically.
Preview titles/images come from Open Graph, product JSON-LD, or Amazon page
metadata. Blocked pages keep an explicit unavailable-preview fallback.

The preview endpoint requires authentication, blocks private hosts and credentials,
validates redirects, bounds downloads, and caches at most 256 results for 30 minutes.
Adding a link checks project write access and deduplicates the saved URL.

## Source priority

1. Preserve an existing explicit component/pin map when the model and source match.
2. Search the libraries below for the exact manufacturer/model/revision. Only
   exact token **and part-title** matches can be imported automatically. Users can
   choose a different exact variant from the component's **Pin map / Verify pins**
   source dialog.
3. Read the Fritzing `.fzp` connector-to-SVG mapping and the matching breadboard
   drawing (or `.fzpz` archive). Extract unique connectors and transformed physical
   coordinates. Unsupported paths/transforms stay unresolved, never guessed.
4. If no importable exact drawing exists, search product/datasheet references and
   provide those documents and available photos to the AI illustration pass.
   Its SVG is labeled **Illustration · pinout unverified**. Logical terminals remain
   separate from verified physical connectors. Missing specifications become
   project Follow-up questions.

SVG artwork extent is **not** a measured board envelope or a mounting-hole drawing.
Use manufacturer mechanical dimensions for CAD/mounts. A photo establishes
appearance, not electrical compatibility, winding ratings, or pin order.

## Reviewed sources (2026-09-15)

| Source | Useful material | Integration / terms |
|---|---|---|
| [Fritzing parts](https://github.com/fritzing/fritzing-parts) | Breadboard SVGs and `.fzp` connector metadata | Indexed and imported; [CC BY-SA 3.0](https://github.com/fritzing/fritzing-parts/blob/develop/LICENSE.txt) |
| [Adafruit](https://github.com/adafruit/Fritzing-Library) | Exact breakout/module `.fzpz` bundles | Indexed and imported; [CC BY-SA 3.0](https://github.com/adafruit/Fritzing-Library/blob/master/LICENSE) |
| [SparkFun](https://github.com/sparkfun/Fritzing_Parts) | Board graphics and connector files | Indexed and imported; hardware graphics [CC BY-SA 4.0](https://github.com/sparkfun/Fritzing_Parts/blob/main/License.md) |
| [Seeed Studio](https://github.com/Seeed-Studio/fritzing_parts) | Grove and XIAO board references | Indexed for discovery; individual asset terms must be reviewed before import |
| [DFRobot](https://github.com/DFRobot/Fritzing-library) | Robotics modules and sensor graphics | Indexed for discovery; individual asset terms must be reviewed before import |
| [Wokwi elements](https://github.com/wokwi/wokwi-elements) | SVG-based interactive electronic components | Indexed for discovery; [MIT](https://github.com/wokwi/wokwi-elements/blob/main/LICENSE). TypeScript elements are not imported as Fritzing bundles |
| [Wokwi AVR8js](https://github.com/wokwi/avr8js) | AVR execution/simulation engine | Evaluated for future MCU execution; not a physical board-graphics source |
| [CircuitJS](https://github.com/sharpie7/circuitjs1) | Circuit simulation and electrical models | Evaluated; no engine code copied into the existing simulator |
| [SimulIDE](https://github.com/SimulIDE/SimulIDE) | Desktop circuit/MCU simulation | Evaluated; no engine code copied |
| [KiCad libraries](https://github.com/KiCad/kicad-footprints) | Footprints and pad geometry | Reference for mechanical/pad data; not automatically treated as top-view graphics |
| [Fritzing graphic standards](https://fritzing.org/fritzings-graphic-standards) | Breadboard illustration conventions | Drawing/connector workflow reference |
| [Pololu DRV8825](https://www.pololu.com/product/2133), [A4988](https://www.pololu.com/product/1182) | Carrier documentation, pinouts, power requirements | Manufacturer references used to distinguish bare carriers from expansion shields |

Repository trees are cached for 24 hours, limited to 4 MB per source (six sources).
Imports use the indexed commit SHA; project metadata preserves the source URL,
license, attribution, connector IDs and coordinates. Imported SVGs are sanitized
and rendered as images, never inserted as executable SVG into the page DOM.
Retain ShareAlike attribution/terms when redistributing adapted drawings/diagrams.

## Limits

This adds source-backed drawings and pin mapping to the existing simulator. It does
not replace its physics engine or certify a real circuit. Missing/ambiguous pins
are flagged and unmatched wire endpoints need correction. Product-linked circuits
with unknown pinouts are marked incomplete. No claim of NEMA 34 motor/PSU
compatibility can be made from an ASIN and frame size alone.

Live checks loaded an Uno Rev3 graphic with 44 connector coordinates and indexed
all six libraries. Automated tests cover clipboard serialization, product metadata,
blocked redirects, Parts List deduplication, SVG sanitization, transformed pin
coordinates, missing-pin follow-ups, and AI illustration fallback.
