import test from "node:test";
import assert from "node:assert/strict";

import {
  createMeshEditSession,
  meshArtifactIdentityFromFiles,
  meshReferenceMatchesTarget,
  scopeMeshReferences,
} from "./mesh-edit-session.js";

test("a project switch invalidates an in-flight edit and only the latest switch can complete", () => {
  let target = { projectId: "p1", catalogTarget: "part.glb", revision: "r1" };
  let request = 0;
  const session = createMeshEditSession({ getTarget: () => target, makeRequestId: () => `req-${++request}` });
  const ticket = session.begin("cleanup");
  const firstSwitch = session.beginProjectSwitch("p2");
  const secondSwitch = session.beginProjectSwitch("p3");

  assert.throws(() => session.assertCurrent(ticket), { code: "mesh_edit_stale" });
  target = { projectId: "p2", catalogTarget: "other.glb", revision: "r2" };
  assert.equal(session.completeProjectSwitch(firstSwitch, target), false);
  target = { projectId: "p3", catalogTarget: "next.glb", revision: "r3" };
  assert.equal(session.completeProjectSwitch(secondSwitch, target), true);
  assert.deepEqual(session.snapshot(), {
    phase: "idle",
    projectId: "p3",
    catalogTarget: "next.glb",
    viewerFilename: null,
    artifactHash: null,
    revision: "r3",
    parentRevision: null,
    requestId: null,
    operation: null,
  });
});

test("face references are scoped to the exact project, target, and artifact revision", () => {
  const target = { projectId: "p1", catalogTarget: "mount.glb", revision: "7-400" };
  const current = { type: "face", projectId: "p1", filename: "mount.glb", face_index: 4, artifact_revision: "7-400" };
  const stale = { ...current, id: "stale", artifact_revision: "6-390" };
  const wrongProject = { ...current, id: "other", projectId: "p2" };

  assert.equal(meshReferenceMatchesTarget(current, target), true);
  assert.deepEqual(scopeMeshReferences([stale, current, wrongProject], target), [current]);
  assert.equal(meshReferenceMatchesTarget({ ...current, artifact_revision: undefined }, target), false);
});

test("mutations require server history and reject a response for another parent", () => {
  const target = { projectId: "p1", catalogTarget: "mount.glb", viewerFilename: "mount_clean.glb", revision: "7-400" };
  const session = createMeshEditSession({ getTarget: () => target, makeRequestId: () => "req" });
  const missingHistory = session.begin("cleanup");
  assert.throws(
    () => session.acceptMutation(missingHistory, { filename: "next.glb", parent: "mount_clean.glb" }),
    { code: "mesh_history_missing" },
  );
  session.finish(missingHistory);

  const wrongParent = session.begin("cleanup");
  assert.throws(
    () => session.acceptMutation(wrongParent, { filename: "next.glb", parent: "other.glb", timeline_index: 8 }),
    { code: "mesh_parent_mismatch" },
  );
  session.finish(wrongParent);

  const acceptedTicket = session.begin("cleanup");
  const accepted = session.acceptMutation(acceptedTicket, {
    filename: "mount_cleaned.glb",
    parent: "mount_clean.glb",
    timeline_index: 9,
  });
  assert.equal(accepted.parent_revision, "7-400");
  assert.equal(accepted.artifact_identity.catalogTarget, "mount_cleaned.glb");
});

test("paid Mesh generation is single-flight until its accepted server job stops", () => {
  const target = { projectId: "p1", catalogTarget: "mount.glb", revision: "r1" };
  let request = 0;
  const session = createMeshEditSession({ getTarget: () => target, makeRequestId: () => `g-${++request}` });
  const ticket = session.beginPaidGeneration();
  assert.throws(() => session.beginPaidGeneration(), { code: "mesh_generation_busy" });
  assert.equal(session.reconcilePaidGeneration("p1", { status: "idle" }), false);
  assert.equal(session.isPaidGenerationActive("p1"), true);
  session.markPaidGenerationAccepted(ticket, "trace-1");
  assert.equal(session.reconcilePaidGeneration("p1", { status: "running" }), true);
  assert.equal(session.reconcilePaidGeneration("p1", { status: "complete" }), false);
  assert.equal(session.isPaidGenerationActive("p1"), false);
});

test("artifact identity uses the loaded viewer revision before the stable catalog revision", () => {
  const identity = meshArtifactIdentityFromFiles("p1", "mount.step", [
    { name: "mount.step", version: "old" },
    { name: "mount_pulled.glb", version: "new", sha256: "abc" },
  ], "mount_pulled.glb");
  assert.equal(identity.catalogTarget, "mount.step");
  assert.equal(identity.viewerFilename, "mount_pulled.glb");
  assert.equal(identity.revision, "new");
  assert.equal(identity.artifactHash, "abc");
});
