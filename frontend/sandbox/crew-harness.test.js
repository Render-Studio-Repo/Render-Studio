import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HARNESS2_TOKEN,
  PERSONALITIES_PATH,
  ROUTES_PATH,
  SKILL_LANES,
  inventBetterTraining,
  onTeachOne,
  setSeatSkill,
  skillFor,
  routeForInterest,
} from "./crew-harness.js";
import { postCrewNote, hearFlagsFor, NOTESBUS1_TOKEN } from "./crew-notes-bus.js";
import { VIRTUAL_DEVICES, setDeviceStatus, ELRUN1_TOKEN } from "./electronics-virtual-run.js";
import { COLLABWB1_TOKEN, CAD_GLB } from "./collab-workbench.js";
import { LOOKDOWN1_TOKEN } from "./lookdown-map.js";

test("teach one move invents better training for both seats", () => {
  assert.equal(HARNESS2_TOKEN, "harness2");
  const ideas = inventBetterTraining({ move: "approach_desk", trainee: "astra", pair: "vibe-rnd" });
  assert.equal(ideas.length, 2);
  assert.ok(ideas.every((i) => i.quiet));
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v) };
  const out = onTeachOne({ move: "speak_pose", trainee: "astra", pair: "vibe-rnd" }, storage);
  assert.equal(out.quiet, true);
  assert.ok(out.personalities.agents.astra.interests.some((x) => /speak_pose/.test(x)));
  assert.ok(out.routes.routes.length >= 1);
  assert.equal(PERSONALITIES_PATH, "sandbox-sessions/personalities.json");
  assert.equal(ROUTES_PATH, "sandbox-sessions/harness-routes.json");
});

test("skill reassign and notes bus stay written not TTS", () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v) };
  assert.ok(SKILL_LANES.some((s) => s.id === "printer"));
  assert.equal(setSeatSkill("comms", "wiring", storage), "wiring");
  assert.equal(skillFor("comms", storage), "wiring");
  const note = postCrewNote({ from: "astra", to: "crew", text: "shared finding", storage });
  assert.equal(note.tts, false);
  assert.equal(NOTESBUS1_TOKEN, "notesbus1");
  assert.equal(hearFlagsFor("astra", storage).hear_crew_tts, false);
  assert.equal(hearFlagsFor("astra", storage).hear_sam, true);
  assert.equal(routeForInterest("printer jam").lane, "printer");
});

test("electronics virtual-run and collab workbench stay on one viewport", () => {
  assert.equal(ELRUN1_TOKEN, "elrun1");
  assert.ok(VIRTUAL_DEVICES.some((d) => /electronics_build_sourcing/.test(d.doc)));
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) || null, setItem: (k, v) => store.set(k, v) };
  const snap = setDeviceStatus("psu-rail", "simulating", storage);
  assert.equal(snap.devices.find((d) => d.id === "psu-rail").status, "simulating");
  assert.equal(COLLABWB1_TOKEN, "collabwb1");
  assert.equal(CAD_GLB, "90576A119.glb");
  assert.equal(LOOKDOWN1_TOKEN, "lookdown1");
  const collab = readFileSync(new URL("./collaborate-id.js", import.meta.url), "utf8");
  const office = readFileSync(new URL("./office.js", import.meta.url), "utf8");
  assert.match(collab, /collab-workbench|data-collab-workbench/);
  assert.match(collab, /lookdown|data-collab-lookdown/);
  assert.match(collab, /data-insp-skill|data-insp-reassign/);
  assert.match(office, /maxPolarAngle = 0\.22/);
  assert.match(office, /Look-down office/);
});
