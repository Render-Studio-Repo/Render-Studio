const sections = [
  ["Choose the source", "Simulation is a virtual robot. Shadow compares observations and predictions without applying those predictions. Hardware applies real commands. Viser displays state; its scene playback is not proof of executed robot actions."],
  ["Record complete episodes", "Capture synchronized cameras, measured joints, requested and applied commands, timestamps, control frequency, robot and camera calibrations, task and robot identity. Label success, failure and human interventions. Stop / Save leaves the outcome unlabeled."],
  ["Inspect current recordings", "Studio exports partial render-studio-recording/v1 data. MuJoCo has simulation snapshots; Viser has telemetry; DimOS has commanded end-effector poses. training_ready stays false and missing_fields explains what is absent. Saving alone does not train a policy."],
  ["Choose a training workflow", "LeRobot with ACT is a reasonable first candidate for a repeatable manipulation task after validating hardware support and complete data. Convert and validate the LeRobotDataset v3 schema. robomimic is another research workflow. If ROS 2 already supplies your robot topics, MCAP can retain raw streams."],
  ["Evaluate and improve", "Split by whole episodes and collection sessions. Keep held-out trials separate. Compare checkpoint completion, interventions and failures under the same conditions. Collect corrections, retrain a new checkpoint, compare again, then evaluate physical execution under supervision."],
];

const sources = [
  ["LeRobotDataset v3", "https://huggingface.co/docs/lerobot/lerobot-dataset-v3"],
  ["ACT policy", "https://huggingface.co/docs/lerobot/act"],
  ["Real-robot imitation learning", "https://huggingface.co/docs/lerobot/il_robots"],
  ["Viser state serializer", "https://viser.studio/main/api/advanced/state_serializer/"],
  ["robomimic datasets", "https://robomimic.github.io/docs/datasets/overview.html"],
  ["ROS 2 MCAP recording", "https://mcap.dev/guides/getting-started/ros-2"],
];

export function openRobotLearningGuide() {
  const existing = document.querySelector("[data-robot-learning-guide]");
  if (existing) { existing.focus(); return existing; }
  const dialog = document.createElement("dialog");
  dialog.dataset.robotLearningGuide = "";
  dialog.style.fontFamily = 'system-ui, sans-serif';
  dialog.setAttribute("aria-labelledby", "robot-learning-guide-title");
  Object.assign(dialog.style, { width: "min(720px, 90vw)", maxHeight: "85vh", overflow: "auto", padding: "24px", border: "1px solid #485466", borderRadius: "12px", background: "var(--panel, #171c24)", color: "var(--text, #eef2f7)", lineHeight: "1.5" });
  const title = document.createElement("h2");
  title.id = "robot-learning-guide-title";
  title.tabIndex = -1;
  title.textContent = "Record, inspect and train a robot";
  dialog.append(title);
  for (const [heading, text] of sections) {
    const label = document.createElement("h3");
    label.textContent = heading;
    const paragraph = document.createElement("p");
    paragraph.textContent = text;
    dialog.append(label, paragraph);
  }
  const links = document.createElement("nav");
  links.setAttribute("aria-label", "Official robot learning documentation");
  for (const [label, href] of sources) {
    const link = document.createElement("a");
    link.textContent = label;
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    Object.assign(link.style, { display: "block", color: "#80bfff", marginBottom: "6px" });
    links.append(link);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "Close guide";
  close.style.marginTop = "16px";
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());
  dialog.append(links, close);
  document.body.append(dialog);
  dialog.showModal();
  title.focus({ preventScroll: true });
  dialog.scrollTop = 0;
  return dialog;
}
