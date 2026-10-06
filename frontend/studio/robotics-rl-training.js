const rewardLabels = { reach: "Reach cube", grasp: "Secure grasp", lift: "Lift height", success: "Sustained success", smoothness: "Smooth action", collision: "Collision", drop: "Dropped cube" };

export function mountRoboticsRlTraining(root, { api, getProjectId, onStatus = () => {} } = {}) {
  if (!root || !api || !getProjectId) return null;
  const q = (selector) => root.querySelector(selector);
  let profile = null;

  function readForm() {
    const rewardWeights = {};
    root.querySelectorAll("[data-rl-reward]").forEach((input) => { rewardWeights[input.dataset.rlReward] = Number(input.value); });
    return {
      bootstrapAct: q("[data-rl-bootstrap]").checked,
      domainRandomization: q("[data-rl-randomize]").checked,
      parallelEnvs: Number(q("[data-rl-envs]").value), totalTimesteps: Number(q("[data-rl-steps]").value),
      evaluationSeeds: Number(q("[data-rl-seeds]").value), learningRate: Number(q("[data-rl-rate]").value), rewardWeights,
    };
  }

  function renderProfile(next) {
    profile = next;
    q("[data-rl-bootstrap]").checked = profile.bootstrapAct;
    q("[data-rl-randomize]").checked = profile.domainRandomization;
    q("[data-rl-envs]").value = profile.parallelEnvs;
    q("[data-rl-steps]").value = profile.totalTimesteps;
    q("[data-rl-seeds]").value = profile.evaluationSeeds;
    q("[data-rl-rate]").value = profile.learningRate;
    Object.entries(profile.rewardWeights || {}).forEach(([name, value]) => { const input = q(`[data-rl-reward="${name}"]`); if (input) input.value = value; });
  }

  function renderGate(out) {
    q("[data-rl-state]").textContent = out.ok ? "READY" : "BLOCKED";
    q("[data-rl-state]").classList.toggle("is-ready", Boolean(out.ok));
    q("[data-rl-checks]").innerHTML = (out.checks || []).map((check) => `<li class="${check.ok ? "is-pass" : "is-fail"}"><span>${check.ok ? "PASS" : "FAIL"}</span>${check.label}</li>`).join("");
    q("[data-rl-message]").textContent = out.message || "Preflight complete.";
    q("[data-rl-start]").disabled = !out.ok;
  }

  async function load() {
    const projectId = getProjectId();
    if (!projectId) return;
    const out = await api(`/api/robotics/rl/profile?project_id=${encodeURIComponent(projectId)}`);
    renderProfile(out.profile);
  }

  q("[data-rl-save]").addEventListener("click", async () => {
    const projectId = getProjectId();
    const out = await api("/api/robotics/rl/profile", { method: "PUT", body: JSON.stringify({ projectId, profile: readForm() }) });
    renderProfile(out.profile); onStatus("ok", "RL training profile saved for this project.");
  });
  q("[data-rl-preflight]").addEventListener("click", async () => renderGate(await api("/api/robotics/rl/preflight", { method: "POST", body: JSON.stringify({ projectId: getProjectId() }) })));
  q("[data-rl-start]").addEventListener("click", async () => {
    const out = await api("/api/robotics/rl/start", { method: "POST", body: JSON.stringify({ projectId: getProjectId() }) });
    if (out.checks) renderGate(out);
    q("[data-rl-message]").textContent = out.run?.message || out.message;
    onStatus(out.ok ? "ok" : "error", out.run?.message || out.message);
  });
  load().catch((error) => { q("[data-rl-message]").textContent = error.message; });
  return { load, readForm, rewardLabels };
}
