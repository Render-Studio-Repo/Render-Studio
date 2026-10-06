import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inviteStatusMessage,
  isInviteEmail,
  resolveInviteTeam,
  sendWorkspaceEmailInvite,
  teamAllowsInvite,
} from "./workspace-send-invite.js";

test("isInviteEmail accepts a normal address and rejects junk", () => {
  assert.equal(isInviteEmail("sam@render3d.app"), true);
  assert.equal(isInviteEmail("  Sam@Render3d.APP "), true);
  assert.equal(isInviteEmail("not-an-email"), false);
  assert.equal(isInviteEmail("@missing.local"), false);
  assert.equal(isInviteEmail(""), false);
});

test("resolveInviteTeam keeps the hovered workspace instead of swapping", () => {
  const teams = [
    { id: "ambots", name: "Ambots", can_invite: true, role: "owner" },
    { id: "fusion", name: "Fusion - Render", can_invite: true, role: "owner" },
  ];
  assert.equal(resolveInviteTeam(teams, "fusion").id, "fusion");
  assert.equal(resolveInviteTeam(teams, "fusion").name, "Fusion - Render");
});

test("teamAllowsInvite is owner/admin or can_invite, not a silent member grant", () => {
  assert.equal(teamAllowsInvite({ role: "owner" }), true);
  assert.equal(teamAllowsInvite({ role: "admin" }), true);
  assert.equal(teamAllowsInvite({ role: "user", can_invite: true }), true);
  assert.equal(teamAllowsInvite({ role: "user", can_invite: false }), false);
  assert.equal(teamAllowsInvite({ role: "manager", can_invite: false }), false);
});

test("inviteStatusMessage reports invited email", () => {
  assert.equal(inviteStatusMessage({ status: "invited", email: "a@b.com" }, "a@b.com"), "Invited a@b.com");
  assert.equal(
    inviteStatusMessage({ status: "added", user: { display_name: "Sam" } }, "sam@x.com"),
    "Added Sam to the workspace",
  );
});

test("sendWorkspaceEmailInvite posts to the team invite API", async () => {
  const calls = [];
  const api = async (path, opts) => {
    calls.push({ path, opts });
    return { status: "invited", email: "new@render3d.app" };
  };
  const result = await sendWorkspaceEmailInvite(api, "ws-1", "New@Render3d.app");
  assert.equal(result.status, "invited");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/teams/ws-1/invite");
  assert.equal(calls[0].opts.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].opts.body), {
    email: "new@render3d.app",
    confirm_new_collaborator: true,
  });
});

test("sendWorkspaceEmailInvite rejects invalid email before calling the API", async () => {
  let called = false;
  await assert.rejects(
    () => sendWorkspaceEmailInvite(async () => { called = true; }, "ws-1", "nope"),
    /valid email/i,
  );
  assert.equal(called, false);
});
