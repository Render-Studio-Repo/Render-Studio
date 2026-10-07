import { test } from "node:test";
import assert from "node:assert/strict";
import {
  collectSceneShareItems,
  createSceneSharePublisher,
  isSceneShareId,
  isShareableSceneMeshName,
  sceneShareObjectId,
  shareModeFromRecord,
  shouldPublishSceneMeshes,
  XR_SCENE_SHARE_FIT,
  XR_SCENE_SHARE_KIND,
} from "./xr-scene-share.js";

test("scene share ids are stable per project file and stay under the wire cap", () => {
  const a = sceneShareObjectId({ projectId: "p1", filename: "folder/Bike.step" });
  const b = sceneShareObjectId({ projectId: "p1", filename: "Bike.step" });
  assert.equal(a, b);
  assert.equal(isSceneShareId(a), true);
  assert.ok(a.length <= 80);
  assert.equal(isShareableSceneMeshName("notes.txt"), false);
  assert.equal(isShareableSceneMeshName("part.glb"), true);
});

test("late joiners only get a snapshot when someone is presenting in a shared session", () => {
  assert.equal(shouldPublishSceneMeshes({ presenting: true, publicJoined: true }), true);
  assert.equal(shouldPublishSceneMeshes({ presenting: true, projectConnected: true }), true);
  assert.equal(shouldPublishSceneMeshes({ presenting: false, publicJoined: true }), false);
  assert.equal(shouldPublishSceneMeshes({ presenting: true }), false);
});

test("collects unique current project model files", () => {
  const items = collectSceneShareItems({
    projectId: "p1",
    projectName: "Bike",
    selectedFile: "frame.step",
    assemblyList: [["wheel.glb", {}], ["frame.step", {}], ["notes.md", {}]],
  });
  assert.equal(items.length, 2);
  assert.equal(items[0].kind, XR_SCENE_SHARE_KIND);
  assert.equal(items[0].fit, XR_SCENE_SHARE_FIT);
  assert.equal(items[0].object_id, sceneShareObjectId({ projectId: "p1", filename: "wheel.glb" }));
});

test("share mode follows view / remix / remix+edit and never invents edit", () => {
  assert.equal(shareModeFromRecord({ share_mode: "edit" }), "edit");
  assert.equal(shareModeFromRecord({ share_mode: "remix" }), "remix");
  assert.equal(shareModeFromRecord({ allow_remix: true }), "remix");
  assert.equal(shareModeFromRecord({}), "view");
});

test("publisher reuses the existing share token and instances the same GLB URL", async () => {
  const calls = [];
  const publish = createSceneSharePublisher({
    isSharedSession: () => true,
    shouldPublish: () => true,
    createShareRecord: async (pid, file, _ctx, extra) => {
      calls.push(["share", pid, file, extra]);
      return {
        share_url: "/share/tok-view",
        viewer_url: "/api/share/tok-view/files/frame.glb",
        share_mode: "view",
      };
    },
    getProjectId: () => "p1",
    getProjectName: () => "Bike",
    collectItems: () => collectSceneShareItems({
      projectId: "p1",
      projectName: "Bike",
      selectedFile: "frame.step",
    }),
    spawn: async (spec) => { calls.push(["spawn", spec]); },
  });
  const first = publish();
  const second = publish();
  assert.equal(first, second);
  const result = await first;
  assert.equal(result.ok, true);
  assert.equal(result.count, 1);
  assert.deepEqual(calls[0], ["share", "p1", "frame.step", { reuse: true }]);
  assert.equal(calls[1][1].glb_url, "/api/share/tok-view/files/frame.glb");
  assert.equal(calls[1][1].share_mode, "view");
  assert.equal(calls[1][1].adoptLocal, true);
  assert.equal(calls[1][1].fit, "world");
});

test('all twelve assembly models are offered to peers, including models after the eighth',()=>{
  const items=collectSceneShareItems({projectId:'robot',assemblyList:Array.from({length:12},(_,i)=>[`part-${i}.glb`,{}])});
  assert.equal(items.length,12);assert.equal(items.at(-1).filename,'part-11.glb');
});
