import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("early boot never requests and discards a second project list", async () => {
  const src = readFileSync(new URL("../boot/early-boot.js", import.meta.url), "utf8");
  const requests = [];
  const context = {
    window: { setTimeout() {} },
    getToken: () => "session", authHeaders: () => ({}), isTokenExpired: () => false,
    showBrowser() {}, bootSpinner() {}, dismissStudioBoot() {}, esc: String,
    fetch: async (path) => { requests.push(path); return { ok: true, json: async () => ({teams: []}) }; },
  };
  vm.createContext(context);
  vm.runInContext(src.slice(src.indexOf("async function loadProjects()"), src.indexOf('\nwindow.addEventListener("error"')), context);
  await context.loadProjects();
  assert.deepEqual(requests, ["/api/auth/me?lite=1"]);
});

test("slow member/invite services cannot hold up the project list", async () => {
  const src = readFileSync(new URL("./app.js", import.meta.url), "utf8");
  const calls = [];
  const context = {
    document: { getElementById: () => ({value: "workspace"}) },
    getSelectedWorkspaceId: () => "workspace", writeSavedWorkspaceId() {}, updateWorkspaceRenameButton() {},
    allProjects: [{id: "p"}], projectId: "p",
    fetchAllProjects: async () => { calls.push("projects"); },
    renderProjectList: () => calls.push("paint-list"),
    refreshTeamMembers: () => { calls.push("members"); return new Promise(() => {}); },
    refreshInviteCandidates: () => { calls.push("invites"); return new Promise(() => {}); },
    refreshWorkspaceHistory() {}, refreshWorkspaceAiUsage() {},
  };
  vm.createContext(context);
  vm.runInContext(src.slice(src.indexOf("  async function onWorkspaceChange("), src.indexOf("\n  function getActiveTeam()")), context);
  const outcome = await Promise.race([
    context.onWorkspaceChange({deferProjectPick: true}).then(() => "ready"),
    new Promise(resolve => setTimeout(() => resolve("blocked"), 50)),
  ]);
  assert.equal(outcome, "ready");
  assert.deepEqual(calls, ["projects", "paint-list", "members", "invites"]);
});
