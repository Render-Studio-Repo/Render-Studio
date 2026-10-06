import test from "node:test";
import assert from "node:assert/strict";
import { OFFICE_AGENTS, activeOfficeAgent, selectOfficeAgent, onOfficeAgentChange, officeModelLabel, selectedAstraModel } from "./office-agents.js";
import { isMcpConnected, MCP_CONNECT_KEY } from "./mcp-connect.js";

test("Astra is the first and default office agent", () => {
  assert.equal(OFFICE_AGENTS[0].id, "astra");
  assert.equal(activeOfficeAgent().id, "astra");
  assert.equal(new Set(OFFICE_AGENTS.map(a => a.id)).size, OFFICE_AGENTS.length);
});
test("agent switching preserves enabled and muted MCP preferences", () => {
  for (const value of ["1", "0"]) {
    const storage = { getItem: key => key === MCP_CONNECT_KEY ? value : null };
    const before = isMcpConnected(storage);
    selectOfficeAgent("cursor"); assert.equal(activeOfficeAgent().id, "cursor-engineer");
    assert.equal(isMcpConnected(storage), before);
  }
  selectOfficeAgent("astra");
});
test("selection notifications are shared and unknown agents cannot replace the active one", () => {
  const updates = []; const stop = onOfficeAgentChange(a => updates.push(a.id));
  selectOfficeAgent("rnd"); selectOfficeAgent("vibe-rnd"); selectOfficeAgent("unknown");
  assert.deepEqual(updates, ["vibe-rnd"]); stop(); selectOfficeAgent("astra");
});
test("model label distinguishes selected Astra model from unreported agents", () => {
  assert.equal(selectedAstraModel({ getItem: () => "gpt-6-astra-pro" }), "gpt-6-astra-pro");
  assert.equal(selectedAstraModel({ getItem: () => "invented" }), "gpt-6-astra");
  assert.match(officeModelLabel(OFFICE_AGENTS[0]), /selected/);
  assert.equal(officeModelLabel(OFFICE_AGENTS[1]), "Model not reported");
});
