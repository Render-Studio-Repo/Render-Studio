import test from "node:test";
import assert from "node:assert/strict";
import {answerSnapshot,followupDraftKey} from "./model-followups.js";

test("autosave snapshots cannot change while a request is in flight",()=>{
  const data={filename:"robot.glb",model_revision:"geometry-1",revision:2};
  const answers={q:"Move 10 mm"};
  const first=answerSnapshot(data,answers,"Keep holes");
  answers.q="Move 15 mm";data.revision=3;
  assert.equal(first.answers.q,"Move 10 mm");
  assert.equal(first.revision,2);
  assert.equal(answerSnapshot(data,answers,"").answers.q,"Move 15 mm");
});
test("drafts stay scoped to project and model",()=>{
  assert.notEqual(followupDraftKey("a","robot.glb"),followupDraftKey("b","robot.glb"));
  assert.notEqual(followupDraftKey("a","robot.glb"),followupDraftKey("a","tray.glb"));
});
