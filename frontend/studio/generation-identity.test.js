import assert from "node:assert/strict";
import {
  collaboratorGeneratingPeople,
  generationAuthorKey,
  isOwnGeneration,
  mergeGenerationIdentity,
  resolveGenerationIdentity,
  sessionUserIdentity,
} from "./generation-identity.js";

const sam = {
  id: "u-sam",
  display_name: "Sam W",
  email: "sam@render3d.app",
  avatar_url: "/api/users/u-sam/avatar",
};

assert.deepEqual(sessionUserIdentity(sam), {
  by_user_id: "u-sam",
  by_user_name: "Sam W",
  by_user_email: "sam@render3d.app",
  by_avatar_url: "/api/users/u-sam/avatar",
});

assert.equal(isOwnGeneration({ by_user_id: "u-sam" }, sam), true);
assert.equal(isOwnGeneration({ by_user_id: "u-other" }, sam), false);
assert.equal(isOwnGeneration({}, sam), true, "unsigned job belongs to the signed-in session");
assert.equal(isOwnGeneration({}), false);

const overlayOnly = resolveGenerationIdentity(
  { status: "running" },
  { sessionUser: sam },
);
assert.equal(overlayOnly.by_user_name, "Sam W");
assert.equal(overlayOnly.by_avatar_url, "/api/users/u-sam/avatar");
assert.equal(overlayOnly.by_user_id, "u-sam");

const other = resolveGenerationIdentity(
  { by_user_id: "u-ada", by_user_name: "" },
  {
    sessionUser: sam,
    collaborator: { id: "u-ada", display_name: "Ada L", avatar_url: "/api/users/u-ada/avatar" },
  },
);
assert.equal(other.by_user_name, "Ada L");
assert.equal(other.by_avatar_url, "/api/users/u-ada/avatar");
assert.notEqual(other.by_user_name, "Someone");

const merged = mergeGenerationIdentity(
  { status: "running", by_user_name: "", progress: { pct: 40 } },
  { by_user_name: "Sam W", by_avatar_url: "/api/users/u-sam/avatar", by_user_id: "u-sam" },
);
assert.equal(merged.by_user_name, "Sam W");
assert.equal(merged.by_user_id, "u-sam");
assert.equal(merged.progress.pct, 40);

assert.equal(generationAuthorKey({ by_user_id: "u-ada", by_user_name: "Ada L" }, sam), "u-ada");

const adaJob = {
  status: "running",
  by_user_id: "u-ada",
  by_user_name: "Ada L",
  by_avatar_url: "/api/users/u-ada/avatar",
  progress: { pct: 40 },
  mode: "v2",
};
const samJob = {
  status: "running",
  by_user_id: "u-sam",
  by_user_name: "Sam W",
  progress: { pct: 50 },
  mode: "v2",
};
const leeJob = {
  status: "running",
  by_user_id: "u-lee",
  by_user_name: "Lee",
  by_avatar_url: "/api/users/u-lee/avatar",
  progress: { pct: 12 },
  mode: "mesh",
};

const ownOnly = collaboratorGeneratingPeople([samJob, { status: "running" }], sam);
assert.equal(ownOnly.length, 0, "own and unsigned jobs must not appear in the collaborator pill");

const oneOther = collaboratorGeneratingPeople([samJob, adaJob], sam);
assert.equal(oneOther.length, 1);
assert.equal(oneOther[0].by_user_id, "u-ada");
assert.equal(oneOther[0].by_user_name, "Ada L");
assert.equal(oneOther[0].pct, 40);

const adaLater = { ...adaJob, progress: { pct: 80 }, prompt: "thicker flange" };
const twoOthers = collaboratorGeneratingPeople([samJob, adaJob, adaLater, leeJob], sam);
assert.equal(twoOthers.length, 2);
assert.equal(twoOthers[0].by_user_id, "u-ada");
assert.equal(twoOthers[0].pct, 80);
assert.equal(twoOthers[0].job.prompt, "thicker flange");
assert.equal(twoOthers[1].by_user_id, "u-lee");
assert.equal(twoOthers.map((p) => p.by_user_id).includes("u-sam"), false);

console.log("generation-identity ok");
