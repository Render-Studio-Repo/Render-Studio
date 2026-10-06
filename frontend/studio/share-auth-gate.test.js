import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bindSharedWorkspacePicker,
  gateRemixOrShare,
  inferPersonalTeamId,
  mustAuthBeforeRemixOrShare,
  peekPendingShareAction,
  readSharedWorkspacePicker,
  remixOpenBody,
  savePendingShareAction,
  sharedWorkspacePickerHtml,
  sharedWorkspacesFromTeams,
  studioViewportPath,
  takePendingShareAction,
  PENDING_SHARE_ACTION_KEY,
} from "./share-auth-gate.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../index.html"), "utf8");
const app = readFileSync(join(here, "app.js"), "utf8");
const shareHtml = readFileSync(join(here, "../pages/share.html"), "utf8");
const shareViewer = readFileSync(join(here, "../viewport/share-viewer.js"), "utf8");
const fileActions = readFileSync(join(here, "../components/file-actions.js"), "utf8");

function memoryStorage(seed = {}) {
  const data = { ...seed };
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(data, key) ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    removeItem: (key) => { delete data[key]; },
  };
}

test("remix and copy-share must auth when there is no token", () => {
  assert.equal(mustAuthBeforeRemixOrShare(""), true);
  assert.equal(mustAuthBeforeRemixOrShare("   "), true);
  assert.equal(mustAuthBeforeRemixOrShare(null), true);
  assert.equal(mustAuthBeforeRemixOrShare("jwt-token"), false);
  const blocked = gateRemixOrShare({
    token: "",
    action: { kind: "remix-share", token: "abc" },
    storage: memoryStorage(),
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.needsAuth, true);
  const allowed = gateRemixOrShare({ token: "jwt-token", action: { kind: "copy-share" } });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.needsAuth, false);
});

test("pending remix/share action survives login and is consumed once", () => {
  const storage = memoryStorage();
  assert.equal(savePendingShareAction({ kind: "copy-share", projectId: "p1", filename: "part.glb" }, storage), true);
  assert.equal(JSON.parse(storage.getItem(PENDING_SHARE_ACTION_KEY)).kind, "copy-share");
  assert.equal(peekPendingShareAction(storage).filename, "part.glb");
  const taken = takePendingShareAction(storage);
  assert.equal(taken.kind, "copy-share");
  assert.equal(taken.projectId, "p1");
  assert.equal(takePendingShareAction(storage), null);
});

test("new remix opens the studio viewport path, not a lingering share page", () => {
  assert.equal(studioViewportPath("firepit1"), "/?project=firepit1#viewport");
  assert.equal(studioViewportPath(""), "/#viewport");
});

test("shared workspace picker lists existing workspaces and can create a new one", () => {
  const teams = [
    { id: "p1", name: "Sam's Workspace", role: "owner", created_by: "u1", member_count: 1 },
    { id: "s1", name: "Render3D", role: "owner", created_by: "u1", member_count: 18 },
    { id: "s2", name: "Shop floor", role: "user", created_by: "u2", member_count: 3 },
  ];
  assert.equal(inferPersonalTeamId(teams, { currentUserId: "u1" }), "p1");
  const shared = sharedWorkspacesFromTeams(teams, { currentUserId: "u1" });
  assert.deepEqual(shared.map((row) => row.id), ["s1", "s2"]);
  const htmlPicker = sharedWorkspacePickerHtml({
    workspaces: shared,
    sharer: { id: "u9", display_name: "Alex" },
    prefix: "remix",
  });
  assert.match(htmlPicker, /Add to an existing shared workspace/);
  assert.match(htmlPicker, /Create a new shared workspace/);
  assert.match(htmlPicker, /Render3D/);
  assert.match(htmlPicker, /Invite Alex to the selected workspace/);
  assert.equal(remixOpenBody({ mode: "existing", teamId: "s1" }).team_id, "s1");
  assert.deepEqual(
    remixOpenBody({ mode: "new", workspaceName: "Pit collab", shareWithSharer: true }),
    { create_shared_workspace: true, workspace_name: "Pit collab", share_with_sharer: true },
  );
  assert.deepEqual(remixOpenBody({ mode: "new" }, { targetProjectId: "keep-me" }), { target_project_id: "keep-me" });
});

test("workspace picker read/sync keeps existing vs create controls in sync", () => {
  const documentRef = globalThis.document;
  if (typeof documentRef === "undefined") {
    const htmlPicker = sharedWorkspacePickerHtml({
      workspaces: [{ id: "s1", name: "Studio", member_count: 4 }],
      prefix: "t",
    });
    assert.match(htmlPicker, /data-share-ws-existing/);
    assert.match(htmlPicker, /data-share-ws-new-name/);
    return;
  }
  const root = documentRef.createElement("div");
  root.innerHTML = sharedWorkspacePickerHtml({
    workspaces: [{ id: "s1", name: "Studio", member_count: 4 }],
    prefix: "t",
  });
  bindSharedWorkspacePicker(root);
  assert.equal(readSharedWorkspacePicker(root).mode, "none");
  root.querySelector('[data-share-ws-mode="new"]').checked = true;
  root.querySelector('[data-share-ws-mode="none"]').checked = false;
  root.querySelector("[data-share-ws-new-name]").value = "Night shift";
  root.querySelector('[data-share-ws-mode="new"]').dispatchEvent(new documentRef.defaultView.Event("change"));
  const choice = readSharedWorkspacePicker(root);
  assert.equal(choice.mode, "new");
  assert.equal(choice.workspaceName, "Night shift");
});

test("studio and share pages wire remix1 auth gates, viewport redirect, and profile chrome", () => {
  assert.match(html, /20260909-remix1/);
  assert.match(html, /20260909-viewtabs/);
  assert.match(app, /share-auth-gate\.js\?v=20260909-remix1/);
  assert.match(app, /studioViewportPath/);
  assert.match(app, /enterRemixedProject/);
  assert.match(app, /mustAuthBeforeRemixOrShare/);
  assert.match(app, /#viewport/);
  assert.match(shareHtml, /share-remix-workspace-host/);
  assert.match(shareHtml, /id="share-auth-avatar"/);
  assert.match(shareHtml, /share-viewer\.js\?v=/);
  assert.match(shareViewer, /share-auth-gate\.js\?v=20260909-remix1/);
  assert.match(shareViewer, /studioViewportPath/);
  assert.match(shareViewer, /gateRemixOrShare/);
  assert.match(app, /share-history-profile/);
  assert.match(app, /location\.assign\(dest\)/);
  assert.match(fileActions, /mustAuthBeforeRemixOrShare/);
  assert.match(fileActions, /Share to workspace/);
  assert.equal(fileActions.includes("Share to Slack"), false);
  assert.equal(fileActions.includes("Share to Discord"), false);
  assert.match(fileActions, /file-export-share-gear/);
  assert.match(app, /join_project/);
  assert.match(app, /\/api\/projects\/join\//);
  assert.match(html, /STUDIO_OG_START/);
  assert.match(html, /STUDIO_OG_END/);
  assert.match(app, /applyLoadedRobotFileVisibility/);
  assert.match(app, /isRobotArtifactEntry/);
});
