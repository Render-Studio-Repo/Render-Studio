import { test } from "node:test";
import assert from "node:assert/strict";
import { SANDBOX_PANES, panesForDock, togglePane, vrEnabledPanes, SBDBG1_TOKEN } from "./sandbox-layout.js";
import { HF_SKILL_CATALOG, setWielded, wieldedFor } from "./huggingface-skills.js";
import { placeSeats, stepWalk, skillRackPoint, planSkillSwap } from "./crew-walk.js";
import { benchAgents, BOTBENCH1_TOKEN } from "./agent-bench-board.js";
import { readMonitor } from "./voice-look.js";
import { ideTreeFiles, FILEIDE1_TOKEN } from "./ide.js";
import { enterSandboxWorkspace, exitSandboxWorkspace, isWorkspaceOpen, SBWS1_TOKEN } from "./sandbox-workspace-enter.js";

const mem = {
  store: {},
  getItem(k) { return this.store[k] ?? null; },
  setItem(k, v) { this.store[k] = String(v); },
};

test("panes are modular and VR-dockable", () => {
  assert.equal(SBDBG1_TOKEN, "sbdbg1");
  assert.ok(SANDBOX_PANES.every((p) => p.docks.includes("sandbox")));
  assert.ok(SANDBOX_PANES.some((p) => p.docks.includes("vr") && p.id === "viewport"));
  const off = togglePane("bench", mem);
  assert.equal(off.bench.on, false);
  assert.ok(vrEnabledPanes(mem).some((p) => p.id === "crew"));
  assert.ok(panesForDock("sandbox", mem).some((p) => p.id === "viewport"));
});

test("HF skill swap plans a walk to the rack", () => {
  assert.ok(HF_SKILL_CATALOG.some((s) => s.id === "ocr"));
  const skill = HF_SKILL_CATALOG[0];
  const held = setWielded("cad-bot", skill.id, mem);
  assert.equal(wieldedFor("cad-bot", mem).id, skill.id);
  const seats = placeSeats([{ id: "cad-bot", name: "CAD bot" }]);
  const mid = stepWalk(seats[0], skillRackPoint(), 0.5);
  assert.equal(mid.walking, true);
  const plan = planSkillSwap({ id: "cad-bot" }, held, { emote: "🔧" });
  assert.match(plan.path.join(","), /walk_to_rack/);
});

test("bot bench averages a few runs and names a best set", () => {
  const bench = benchAgents({ runs: 2, agents: [{ id: "cad-bot", name: "CAD bot" }, { id: "analytics", name: "Analytics" }] });
  assert.equal(bench.token, BOTBENCH1_TOKEN);
  assert.equal(bench.runs, 2);
  assert.ok(bench.rows.length === 2);
  assert.ok(bench.best_set.length >= 1);
});

test("live IDE tree skips mujoco mesh dumps", () => {
  assert.equal(FILEIDE1_TOKEN, "fileide1");
  const out = ideTreeFiles([
    "boot.js",
    "openarm-mujoco/v2/assets/collision/link1.stl",
    "openarm-mujoco/README.md",
    "examples/hello.md",
  ]);
  assert.deepEqual(out, ["boot.js", "openarm-mujoco/README.md", "examples/hello.md"]);
});

test("enter workspace opens Super IDE editor", () => {
  const html = { hidden: true };
  const grid = { hidden: false };
  const enter = { textContent: "Enter workspace", attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const editorBtn = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  const d = {
    documentElement: { classList: { _s: new Set(), contains(n) { return this._s.has(n); }, toggle(n, on) { if (on) this._s.add(n); else this._s.delete(n); } } },
    body: { classList: { _s: new Set(), contains(n) { return this._s.has(n); }, toggle(n, on) { if (on) this._s.add(n); else this._s.delete(n); } } },
    getElementById: (id) => (id === "sb-workspace-shell" ? html : id === "sb-collab-viewport" ? { id } : id === "sb-office" ? { id } : id === "sb-super-ide" ? { dataset: {}, scrollIntoView() {} } : null),
    querySelector: (sel) => {
      if (sel === ".sb-dbg-grid") return grid;
      if (sel === "[data-sb-enter-workspace]") return enter;
      if (sel === "[data-sb-open-editor]") return editorBtn;
      if (sel === "[data-workspace-docks]") return { appendChild() {} };
      if (sel === '[data-sb-tab="se"][data-tab="projects"]') return { click() {} };
      return null;
    },
    querySelectorAll: () => [],
  };
  assert.equal(SBWS1_TOKEN, "sbws1");
  const opened = enterSandboxWorkspace(d, { editor: true });
  assert.equal(opened.ok, true);
  assert.equal(html.hidden, false);
  assert.equal(grid.hidden, true);
  assert.equal(isWorkspaceOpen(d), true);
  const closed = exitSandboxWorkspace(d);
  assert.equal(closed.ok, true);
  assert.equal(html.hidden, true);
});

test("voice look reads the monitor", () => {
  const fake = {
    title: "Sandbox",
    querySelector: (sel) => {
      if (sel === "#sb-title") return { textContent: "Debugger viewport" };
      if (sel === "[data-sb-ide-path]") return { value: "examples/loop.js" };
      if (sel === "[data-sb-ide-status]") return { textContent: "Loaded" };
      return null;
    },
  };
  const snap = readMonitor(fake);
  assert.match(snap.text, /Debugger viewport/);
  assert.match(snap.text, /examples\/loop.js/);
});
