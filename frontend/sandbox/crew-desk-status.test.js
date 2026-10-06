import test from "node:test";
import assert from "node:assert/strict";
import { OFFICE_AGENTS } from "./office-agents.js";
import {
  CREWDESK1_TOKEN,
  SEAT_AVATARS,
  KEEP_SHOP_REFS,
  crewSeatInventory,
  seatHasAvatar,
  deriveSeatStatus,
  marketingDeskWork,
  printerBotMonitor,
  inspectDesk,
} from "./crew-desk-status.js";

test("every seated agent has a distinct avatar", () => {
  assert.equal(CREWDESK1_TOKEN, "crewdesk1");
  const seats = crewSeatInventory();
  assert.ok(seats.length >= OFFICE_AGENTS.length);
  for (const a of OFFICE_AGENTS) {
    assert.equal(seatHasAvatar(a.id), true, `missing avatar for ${a.id}`);
    assert.ok(SEAT_AVATARS[a.id]?.glyph, `glyph for ${a.id}`);
  }
  const glyphs = seats.map((s) => s.avatar.glyph);
  assert.equal(new Set(glyphs).size, glyphs.length);
  assert.ok(seats.some((s) => s.id === "vibe-marketing" && s.desk === "walk-up"));
  assert.ok(seats.some((s) => s.id === "printer-bot" && s.desk === "printer"));
});

test("Marketing desk exposes shoot, music, shop-pack, findings", () => {
  const desk = marketingDeskWork({
    tasks: [{ agent_id: "vibe-marketing", title: "Shoot project files + pick music", status: "queued" }],
    files: [{ name: "intro.mp4" }, { name: "bed.mp3" }],
    findings: [{ text: "need louder bed" }],
  });
  assert.equal(desk.walk_up, true);
  assert.match(desk.shop_pack, /music|shoot/i);
  assert.ok(desk.shoot_files.includes("intro.mp4"));
  assert.ok(desk.music.includes("bed.mp3"));
  assert.equal(desk.findings[0].text, "need louder bed");
  assert.match(desk.copy, /any workshop/i);
});

test("other seats show idle/working/blocked/waiting-on-Sam", () => {
  assert.equal(deriveSeatStatus("comms", []).status, "idle");
  assert.equal(deriveSeatStatus("comms", [{ agent_id: "comms", title: "Draft emails", status: "queued" }]).status, "working");
  assert.equal(deriveSeatStatus("cursor-engineer", [{ agent_id: "cursor-engineer", title: "blocked on merge", status: "queued" }]).status, "blocked");
  assert.equal(deriveSeatStatus("ledger", [{ agent_id: "ledger", title: "waiting on Sam for sign-off", status: "queued" }]).status, "waiting-on-Sam");
  const other = inspectDesk("comms", { tasks: [{ agent_id: "comms", title: "Draft emails", status: "queued" }] });
  assert.equal(other.walk_up, false);
  assert.match(other.copy, /no second talk bar/i);
});

test("Print-bot monitor stays quiet unless jammed", () => {
  const ok = printerBotMonitor({ probe: { host: "192.168.1.20", name: "bambu" }, shopFiles: [{ name: "part.stl", size: 1000 }] });
  assert.equal(ok.agent_id, "printer-bot");
  assert.equal(ok.quiet, true);
  const jam = printerBotMonitor({ probe: { message: "jam on lane 2" } });
  assert.equal(jam.status, "waiting-on-Sam");
  assert.equal(jam.quiet, false);
  assert.ok(KEEP_SHOP_REFS.some((r) => r.name === "90576A119.glb"));
  assert.ok(KEEP_SHOP_REFS.some((r) => r.name === "parts_list.md"));
});
