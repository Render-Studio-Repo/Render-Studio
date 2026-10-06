import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nametagActionKeys,
  nametagSocialActions,
  resolveXrSendFilename,
  presenceSyncPoseMessages,
  publicLobbyRelayTypes,
  relayRecipientIds,
  shotDockToolIds,
  socialActionApi,
  studioAccessActionApi,
  twoPeerRoom,
  wheelBuildToolIds,
  xrCaptureOpensPcViewer,
  XR_ROOM_RELAY_TYPES,
  normalizeXrCollabSpace,
  readXrCollabSpace,
  writeXrCollabSpace,
  remoteHeldAffectsLocalMesh,
  remoteHeldShowsGhost,
  XR_COLLAB_SPACE_KEY,
} from "./xr-collab-policy.js";
import { createXrVoice } from "./xr-voice.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

test("two mock peers get each other's pose/stroke/rtc, never their own", () => {
  const peers = twoPeerRoom("ada", "sam");
  assert.deepEqual(relayRecipientIds(peers, "ada"), ["sam"]);
  assert.deepEqual(relayRecipientIds(peers, "sam", "ada"), ["ada"]);
  assert.deepEqual(relayRecipientIds(peers, "ada", "ghost"), []);
  for (const t of ["xr.pose", "xr.stroke", "xr.fit", "xr.draw", "xr.video", "xr.window", "xr.board", "xr.table", "xr.seat", "rtc.signal"]) {
    assert.ok(XR_ROOM_RELAY_TYPES.includes(t));
    assert.ok(publicLobbyRelayTypes().includes(t));
  }
  assert.ok(publicLobbyRelayTypes().includes("xr.prompt.bridge"));
  assert.ok(publicLobbyRelayTypes().includes("xr.draw"));
});

test("joining a room applies already-stored xrPose from presence.sync", () => {
  const msgs = presenceSyncPoseMessages([
    { id: "ada", display_name: "Ada", xrPose: { head: { p: [0, 1.6, 0] } } },
    { id: "idle", display_name: "Idle" },
    { user_id: "sam", pose: { head: { p: [1, 1.6, 0] } } },
  ]);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].user_id, "ada");
  assert.equal(msgs[0].type, "xr.pose");
  assert.ok(msgs[0].pose.head);
  assert.equal(msgs[1].user_id, "sam");
});

test("nametag social actions hit the real profile / friend / file / message APIs", () => {
  assert.deepEqual(nametagSocialActions(), ["profile", "friend", "file", "message", "meet", "mute"]);
  const keys = nametagActionKeys("peer-9");
  assert.deepEqual(socialActionApi(keys.profile), { method: "GET", path: "/api/users/peer-9/profile" });
  assert.deepEqual(socialActionApi(keys.friend), { method: "POST", path: "/api/social/friends", body: { user_id: "peer-9" } });
  assert.deepEqual(socialActionApi(keys.file), { method: "POST", path: "/api/social/send-file", body: { user_id: "peer-9" } });
  assert.deepEqual(socialActionApi(keys.message), { method: "POST", path: "/api/social/invite", body: { user_id: "peer-9" } });
  assert.deepEqual(socialActionApi(keys.meet), { method: "POST", path: "/api/users/peer-9/meeting-request", body: { channel: "calendar", send_email: true, proposed_time: "Next available" } });
  assert.equal(socialActionApi(keys.mute).localOnly, true);
  assert.equal(socialActionApi("follow:u1").path, null);
  const meet = socialActionApi("meet:peer-9");
  assert.equal(meet.method, "POST");
  assert.equal(meet.path, "/api/users/peer-9/meeting-request");
  const slot = socialActionApi("meetslot:peer-9|2026-09-08T18:00:00Z|2026-09-08T18:30:00Z");
  assert.equal(slot.path, "/api/users/peer-9/meeting-request");
  assert.equal(slot.body.starts_at, "2026-09-08T18:00:00Z");
});

test("nametag send-file picks the open model or latest project file", () => {
  assert.equal(resolveXrSendFilename({ selectedFile: "part.glb" }), "part.glb");
  assert.equal(
    resolveXrSendFilename({ files: [{ name: "notes.txt" }, { name: "assembly.step" }] }),
    "assembly.step",
  );
  assert.equal(resolveXrSendFilename({}), "");
});

test("Quest wheel exposes Arkio/GS combine, revolve, loft, scale, wall/floor, copy, layer, height", () => {
  const src = readFileSync(join(here, "xr-tool-wheel.js"), "utf8");
  for (const id of wheelBuildToolIds()) {
    assert.ok(src.includes(`id: "${id}"`), `missing wheel tool ${id}`);
  }
});

test("mute stays on when headset volume is adjusted", () => {
  const src = readFileSync(join(here, "xr-voice.js"), "utf8");
  assert.equal(src.includes("if (next > 0.001) peerMuted.set"), false);
  assert.ok(src.includes("setPeerMuted"));
  assert.ok(src.includes("createPanner"));
  assert.ok(src.includes("HRTF"));
  assert.ok(src.includes("peerVoiceOutputGain"));
  const v = createXrVoice();
  v.setPeerMuted("u1", true);
  assert.equal(v.isPeerMuted("u1"), true);
  v.setPeerVolume("u1", 0.85);
  assert.equal(v.isPeerMuted("u1"), true);
  assert.equal(v.getPeerVolume("u1"), 0.85);
  assert.equal(v.hasPeerPanner("u1"), false);
  const ice = v.getIceServers();
  assert.ok(ice.some((s) => String(s.urls).includes("stun:stun.l.google.com")));
  assert.ok(src.includes("iceRestart"));
  assert.ok(src.includes("shouldRestartIce"));
  assert.ok(src.includes("pendingIce"));
  assert.ok(src.includes("XR_ICE_API"));
  assert.ok(src.includes("iceServersFromApiPayload"));
  assert.ok(src.includes("xr-hot-path.js?v=20260908-xr-robotics1"));
  assert.ok(src.includes("xrIceFetchInit"));
  assert.ok(src.includes("getToken"));
});

test("Studio Access save/unshare hit laptop Share endpoints", () => {
  const move = studioAccessActionApi({ type: "move_workspace", team_id: "team-2" }, "proj-1");
  assert.equal(move.method, "PATCH");
  assert.equal(move.path, "/api/projects/proj-1/workspace");
  const gone = studioAccessActionApi({ type: "unshare", user_id: "mate" }, "proj-1");
  assert.equal(gone.method, "DELETE");
  assert.equal(gone.path, "/api/projects/proj-1/shares/mate");
});

test("shared vs local collab space defaults to shared and ghosts local holds", () => {
  assert.equal(normalizeXrCollabSpace("local"), "local");
  assert.equal(normalizeXrCollabSpace("anything"), "shared");
  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
  };
  assert.equal(readXrCollabSpace(storage), "shared");
  assert.equal(writeXrCollabSpace("local", storage), "local");
  assert.equal(storage.getItem(XR_COLLAB_SPACE_KEY), "local");
  assert.equal(readXrCollabSpace(storage), "local");
  assert.equal(remoteHeldAffectsLocalMesh({ localSpace: "shared", remoteSpace: "shared" }), true);
  assert.equal(remoteHeldAffectsLocalMesh({ localSpace: "local", remoteSpace: "shared" }), false);
  assert.equal(remoteHeldAffectsLocalMesh({ localSpace: "shared", remoteSpace: "local" }), false);
  assert.equal(remoteHeldAffectsLocalMesh({ localSpace: "shared", remoteSpace: "shared", grabbingLocal: true }), false);
  assert.equal(remoteHeldShowsGhost({ remoteSpace: "local", hasHeldPose: true }), true);
  assert.equal(remoteHeldShowsGhost({ remoteSpace: "shared", hasHeldPose: true }), false);
});

test("Shot strip still has Shot, PC, and X; PC viewer opens on the laptop session", () => {
  assert.deepEqual(shotDockToolIds(), ["screenshot", "shot_send_pc", "shot_share_x"]);
  assert.equal(xrCaptureOpensPcViewer({ presenting: true, publishedReady: true }), false);
  assert.equal(xrCaptureOpensPcViewer({ presenting: false, publishedReady: true }), true);
});
