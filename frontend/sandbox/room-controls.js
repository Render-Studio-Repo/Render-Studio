import { OFFICE_AGENTS, activeOfficeAgent, selectOfficeAgent, officeModelLabel, openOfficeAgent } from "./office-agents.js?v=office2&astraoffice=20260917-1";
import { isMcpConnected } from "./mcp-connect.js?v=mcplisten1";

export function createRoomControls({ THREE, renderer, scene, camera, onExit, onRay }) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024; canvas.height = 640;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.875), new THREE.MeshBasicMaterial({ map: texture }));
  panel.position.set(0, 1.45, -0.85);
  scene.add(panel);
  let view = "home", buttons = [], lastPaint = 0, agentPage = 0;
  let observation = { session: false, trigger: "unknown", hands: [], lastAction: "", at: null };
  const raycaster = new THREE.Raycaster();
  const rotation = new THREE.Matrix4();
  const controllers = Array.from({ length: 2 }, (_, index) => {
    const controller = renderer.xr.getController(index);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -2)]), new THREE.LineBasicMaterial({ color: 0x65d8c1 }));
    controller.add(line); scene.add(controller);
    controller.addEventListener("connected", event => { controller.userData.inputSource = event.data; });
    controller.addEventListener("disconnected", () => { controller.userData.inputSource = null; });
    controller.addEventListener("selectstart", event => {
      const hand = (event.data || controller.userData.inputSource)?.handedness;
      observation = { ...observation, trigger: "ok", lastAction: `${hand || "unknown"} trigger observed`, at: new Date().toISOString() };
      controller.updateWorldMatrix(true, false);
      rotation.identity().extractRotation(controller.matrixWorld);
      raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      raycaster.ray.direction.set(0, 0, -1).applyMatrix4(rotation);
      const hit = raycaster.intersectObject(panel)[0];
      if (hit) activate(hit.uv); else onRay?.(raycaster);
    });
    return controller;
  });
  const editor = () => document.querySelector("[data-sb-ide-editor]");
  const path = () => document.querySelector("[data-sb-ide-path]")?.value || "No file selected";
  const voiceRoot = () => document.querySelector('[data-sb-ask-astra][data-voice-state="live"], [data-sb-ask-astra][data-voice-state="connecting"]') || document.querySelector("[data-sb-ask-astra]");
  const talk = () => {
    const root = voiceRoot();
    if (!root) { observation.lastAction = "Open Agents in the browser to initialize Astra"; return; }
    root.querySelector("[data-sb-ask-voice]")?.click();
  };
  const show = name => { view = name; paint(); };
  const returnToPage = async selector => {
    await onExit();
    const el = document.querySelector(selector);
    if (!el) return;
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      if (parent.dataset.sbPanel && parent.dataset.pane) {
        document.querySelector(`[data-sb-tab="${parent.dataset.sbPanel}"][data-tab="${parent.dataset.pane}"]`)?.click();
      }
    }
    el.scrollIntoView({ block: "center" }); el.focus();
  };
  const button = (label, x, y, action) => {
    ctx.fillStyle = "#24574f"; ctx.fillRect(x, y, 440, 70);
    ctx.fillStyle = "#ffffff"; ctx.font = "28px sans-serif"; ctx.fillText(label, x + 20, y + 45);
    buttons.push({ x, y, w: 440, h: 70, action, label });
  };
  function paint() {
    buttons = []; ctx.fillStyle = "#15201f"; ctx.fillRect(0, 0, 1024, 640);
    ctx.fillStyle = "#ffffff"; ctx.font = "bold 38px sans-serif";
    const agent = activeOfficeAgent();
    ctx.fillText(`${agent.name} / ${view === "home" ? "Sandbox Office" : view === "agents" ? "Agents" : view === "controls" ? "Quest controllers" : "Live editor"}`, 40, 55);
    ctx.font = "24px sans-serif"; ctx.fillStyle = "#bfcec9";
    ctx.fillText(officeModelLabel(agent), 40, 92);
    const voice = voiceRoot();
    ctx.fillText(voice?.dataset.voiceState === "live" || voice?.dataset.voiceState === "connecting" ? `Voice: Astra / ${voice.dataset.voiceModel} (${voice.dataset.voiceState})` : "Voice: off", 40, 126);
    if (view === "home") {
      button("Agents", 40, 190, () => show("agents"));
      button("Live editor", 540, 190, () => show("editor"));
      button(voice?.dataset.voiceState === "live" ? "Stop Astra voice" : voice?.dataset.voiceState === "connecting" ? "Cancel voice" : "Talk to Astra", 40, 290, talk);
      button("Quest controllers", 540, 290, () => show("controls"));
      button(`Open ${agent.name} chat`, 40, 390, async () => { await onExit(); openOfficeAgent(agent.id); });
      ctx.fillStyle = "#bfcec9"; ctx.font = "22px sans-serif";
      ctx.fillText((voice?.querySelector("[data-sb-ask-reply]")?.textContent || observation.lastAction || "").slice(0, 80), 40, 505);
    } else if (view === "agents") {
      OFFICE_AGENTS.slice(agentPage * 4, agentPage * 4 + 4).forEach((a, i) => {
        button(`${a.id === agent.id ? "> " : ""}${a.name}`, 40 + (i % 2) * 500, 180 + Math.floor(i / 2) * 85, () => { selectOfficeAgent(a.id); show("home"); });
      });
      button("Previous agents", 40, 360, () => { agentPage = Math.max(0, agentPage - 1); paint(); });
      button("Next agents", 540, 360, () => { agentPage = (agentPage + 1) % Math.ceil(OFFICE_AGENTS.length / 4); paint(); });
      ctx.fillStyle = "#bfcec9"; ctx.font = "22px sans-serif";
      ctx.fillText(isMcpConnected() ? "MCP listening enabled for the team" : "MCP listening muted", 40, 485);
    } else if (view === "controls") {
      ctx.fillText(`Connected: ${observation.hands.join(", ") || "none observed"}`, 40, 200);
      ctx.fillText(`Trigger: ${observation.trigger}`, 40, 250);
      ctx.fillText(observation.lastAction || "No input observed", 40, 300);
      ctx.fillText("Right A: agents / Left X: controllers / B,Y: back", 40, 350);
    } else {
      ctx.fillText(path().slice(0, 65), 40, 165);
      ctx.font = "20px monospace";
      const lines = (editor()?.value || "Open a file in the browser editor.").split("\n").slice(0, 7);
      lines.forEach((line, i) => ctx.fillText(line.slice(0, 75), 40, 200 + i * 25));
      button("Edit in browser", 40, 395, () => returnToPage("[data-sb-ide-editor]"));
      button("Save current file", 540, 395, () => {
        const save = document.querySelector("[data-sb-ide-save]");
        if (save && !save.disabled) save.click();
      });
      ctx.font = "20px sans-serif";
      ctx.fillStyle = "#bfcec9";
      ctx.fillText((document.querySelector("[data-sb-ide-status]")?.textContent || "").slice(0, 80), 40, 500);
    }
    button("Back", 40, 545, () => show("home"));
    button("Exit room", 540, 545, onExit);
    texture.needsUpdate = true;
  }
  function activate(uv) {
    if (!uv) return;
    const x = uv.x * canvas.width, y = (1 - uv.y) * canvas.height;
    const hit = buttons.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h);
    if (!hit) return;
    observation.lastAction = hit.label;
    Promise.resolve(hit.action()).catch(error => { observation.lastAction = error.message; });
    paint();
  }
  const pointer = event => {
    if (renderer.xr.isPresenting) return;
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    const hit = raycaster.intersectObject(panel)[0];
    if (hit) activate(hit.uv); else onRay?.(raycaster);
  };
  renderer.domElement.addEventListener("pointerdown", pointer);
  let previous = new WeakMap();
  function update() {
    const session = renderer.xr.getSession();
    observation.session = !!session;
    observation.hands = [...(session?.inputSources || [])].filter(s => s.gamepad).map(s => s.handedness);
    for (const source of session?.inputSources || []) {
      const buttons = source.gamepad?.buttons || [];
      const now = [!!buttons[4]?.pressed, !!buttons[5]?.pressed];
      const before = previous.get(source) || [false, false];
      if (now[0] && !before[0]) show(source.handedness === "right" ? "agents" : "controls");
      if (now[1] && !before[1]) show("home");
      previous.set(source, now);
    }
    if (performance.now() - lastPaint > 250) { lastPaint = performance.now(); paint(); }
  }
  paint();
  return { update, show, observation: () => ({ ...observation, view, selectedAgent: activeOfficeAgent().id, model: officeModelLabel(), hands: [...observation.hands] }),
    reset: () => { previous = new WeakMap(); observation = { session: false, trigger: "unknown", hands: [], lastAction: "", at: null }; show("home"); } };
}
