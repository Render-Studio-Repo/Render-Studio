import { test } from "node:test";
import assert from "node:assert/strict";
import { cloudTrainingManifest, FOLDING_DATASET_REPO, huggingFaceDatasetUrl, lerobotTrainingCommand, normalizeCloudTrainingProfile } from "./cloud-robotics-training.js";

test("folding profile produces a CUDA LeRobot training package without claiming compatibility", () => {
  const profile = normalizeCloudTrainingProfile({ simulator: "isaac", isaacViewerUrl: "https://isaac.example/viewer", outputRepo: "sam/folding-act", policyName: "Sam folding ACT", trainSteps: 12000, saveFreq: 3000 });
  const manifest = cloudTrainingManifest(profile);
  assert.equal(manifest.training.dataset.repo_id, FOLDING_DATASET_REPO);
  assert.equal(manifest.training.policy.device, "cuda");
  assert.equal(manifest.evaluation.isaac_webrtc_url, "https://isaac.example/viewer");
  assert.equal(manifest.compatibility.validated, false);
  assert.equal(manifest.training.policy.name, "Sam-folding-ACT");
  assert.deepEqual(manifest.training.schedule, { steps: 12000, save_freq: 3000 });
  assert.match(lerobotTrainingCommand(profile), /--dataset\.repo_id=lerobot\/high_quality_folding/);
  assert.match(lerobotTrainingCommand(profile), /--policy\.repo_id=sam\/folding-act/);
  assert.equal(huggingFaceDatasetUrl(profile), "https://huggingface.co/datasets/lerobot/high_quality_folding");
});

test("cloud profile rejects non-http simulator and workspace URLs", () => {
  const profile = normalizeCloudTrainingProfile({ workspaceUrl: "javascript:alert(1)", isaacViewerUrl: "file:///tmp/secret", gpuType: "gpu.fake" });
  assert.equal(profile.workspaceUrl, "");
  assert.equal(profile.isaacViewerUrl, "");
  assert.equal(profile.gpuType, "gpu.h100-sxm");
});

test("cloud profile rejects unsafe Hub repository identifiers", () => {
  const profile = normalizeCloudTrainingProfile({
    datasetRepo: "lerobot/folding; curl bad.example",
    outputRepo: "sam/policy && echo bad",
  });

  assert.equal(profile.datasetRepo, "lerobot/high_quality_folding");
  assert.equal(profile.outputRepo, "");
  assert.equal(huggingFaceDatasetUrl(profile), "https://huggingface.co/datasets/lerobot/high_quality_folding");
  assert.doesNotMatch(lerobotTrainingCommand(profile), /curl|echo/);
});
