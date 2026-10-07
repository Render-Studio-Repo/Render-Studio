export const CLOUD_TRAINING_STORAGE_KEY = "render3d:roboticsCloudTraining:v1";
export const FOLDING_DATASET_REPO = "lerobot/high_quality_folding";
export const DGX_CLOUD_DOCS_URL = "https://docs.nvidia.com/dgx-cloud/lepton/reference/cli/get-started/";
export const DGX_CLOUD_CONSOLE_URL = "https://dashboard.dgxc-lepton.nvidia.com/";

const GPU_TYPES = new Set(["gpu.a10", "gpu.a100-40gb", "gpu.a100-80gb", "gpu.h100-sxm"]);
const SIMULATORS = new Set(["mujoco", "isaac"]);

function clean(value, max = 512) {
  return String(value || "").trim().slice(0, max);
}

function hubRepo(value, fallback = "") {
  const candidate = clean(value, 240);
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(candidate)
    ? candidate
    : fallback;
}

export function defaultCloudTrainingProfile() {
  return {
    schema: "render3d.robotics-cloud-training/v1",
    provider: "nvidia-dgx-cloud-lepton",
    workspaceId: "",
    workspaceUrl: "",
    datasetRepo: FOLDING_DATASET_REPO,
    datasetRevision: "main",
    policyName: "openarm-folding-act",
    policyType: "act",
    outputRepo: "",
    taskDescription: "fold the shirt",
    trainSteps: 10000,
    saveFreq: 2000,
    gpuType: "gpu.h100-sxm",
    simulator: "mujoco",
    isaacViewerUrl: "",
  };
}

export function normalizeCloudTrainingProfile(raw = {}) {
  const base = defaultCloudTrainingProfile();
  const simulator = clean(raw.simulator, 24).toLowerCase();
  const gpuType = clean(raw.gpuType, 40).toLowerCase();
  const workspaceUrl = clean(raw.workspaceUrl);
  const isaacViewerUrl = clean(raw.isaacViewerUrl);
  const safeHttp = (value) => {
    if (!value) return "";
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch { return ""; }
  };
  return {
    ...base,
    workspaceId: clean(raw.workspaceId, 160),
    workspaceUrl: safeHttp(workspaceUrl),
    datasetRepo: hubRepo(raw.datasetRepo, base.datasetRepo),
    datasetRevision: clean(raw.datasetRevision, 120) || "main",
    policyName: clean(raw.policyName, 120).replace(/[^a-zA-Z0-9._-]+/g, "-") || base.policyName,
    policyType: clean(raw.policyType, 40).toLowerCase() || "act",
    outputRepo: hubRepo(raw.outputRepo),
    taskDescription: clean(raw.taskDescription, 240) || base.taskDescription,
    trainSteps: Math.max(100, Math.min(10000000, Math.round(Number(raw.trainSteps) || base.trainSteps))),
    saveFreq: Math.max(100, Math.min(1000000, Math.round(Number(raw.saveFreq) || base.saveFreq))),
    gpuType: GPU_TYPES.has(gpuType) ? gpuType : base.gpuType,
    simulator: SIMULATORS.has(simulator) ? simulator : base.simulator,
    isaacViewerUrl: safeHttp(isaacViewerUrl),
  };
}

export function readCloudTrainingProfile(store = globalThis.localStorage) {
  try { return normalizeCloudTrainingProfile(JSON.parse(store?.getItem(CLOUD_TRAINING_STORAGE_KEY) || "null") || {}); }
  catch { return defaultCloudTrainingProfile(); }
}

export function saveCloudTrainingProfile(raw, store = globalThis.localStorage) {
  const profile = normalizeCloudTrainingProfile(raw);
  try { store?.setItem(CLOUD_TRAINING_STORAGE_KEY, JSON.stringify(profile)); } catch { /* private mode */ }
  return profile;
}

export function cloudTrainingManifest(raw) {
  const profile = normalizeCloudTrainingProfile(raw);
  return {
    schema: profile.schema,
    provider: profile.provider,
    workspace: { id: profile.workspaceId, url: profile.workspaceUrl },
    compute: { resource_shape: profile.gpuType, replicas: 1 },
    training: {
      command: "lerobot-train",
      dataset: { repo_id: profile.datasetRepo, revision: profile.datasetRevision },
      task: profile.taskDescription,
      policy: { name: profile.policyName, type: profile.policyType, device: "cuda", repo_id: profile.outputRepo },
      schedule: { steps: profile.trainSteps, save_freq: profile.saveFreq },
      secrets: ["HF_TOKEN"],
    },
    evaluation: {
      simulator: profile.simulator,
      isaac_webrtc_url: profile.simulator === "isaac" ? profile.isaacViewerUrl : "",
      status: profile.simulator === "mujoco" ? "adapter_required" : "stream_endpoint_required",
    },
    compatibility: {
      source_robot: "openarms_follower",
      target_robot: "openarm-2.0",
      validated: false,
      blockers: [
        "Train a checkpoint from the dataset before simulation playback",
        "Map source joint and gripper features to the target robot",
        "Provide a folding scene, cloth model, reset state, and task reward in the selected simulator",
      ],
    },
  };
}

export function lerobotTrainingCommand(raw) {
  const p = normalizeCloudTrainingProfile(raw);
  const args = [
    "lerobot-train",
    `--dataset.repo_id=${p.datasetRepo}`,
    `--dataset.revision=${p.datasetRevision}`,
    `--policy.type=${p.policyType}`,
    "--policy.device=cuda",
    `--output_dir=outputs/train/${p.policyName}`,
    `--steps=${p.trainSteps}`,
    `--save_freq=${p.saveFreq}`,
    "--wandb.enable=true",
  ];
  if (p.outputRepo) args.push(`--policy.repo_id=${p.outputRepo}`);
  return args.join(" \\\n  ");
}

export function huggingFaceDatasetUrl(raw) {
  const repo = normalizeCloudTrainingProfile(raw).datasetRepo;
  return `https://huggingface.co/datasets/${repo}`;
}
