import * as THREE from "three";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.172.0/examples/jsm/controls/OrbitControls.js";
import { createOfficeScene } from "./office-scene.js?v=office2&astraoffice=20260917-1";
import { OFFICE_AGENTS, activeOfficeAgent, selectOfficeAgent, onOfficeAgentChange, openOfficeAgent, officeModelLabel } from "./office-agents.js?v=office2-printer1&astraoffice=20260917-1";
import { inspectDesk } from "./crew-desk-status.js?v=20260923-draw-recordings1";
import { isMcpConnected, MCP_CONNECT_EVENT } from "./mcp-connect.js?v=mcplisten1";

export const CREW = OFFICE_AGENTS.map(a => ({ ...a, label: a.name, ask: a.role }));

export function mountOffice(host, { onDesk } = {}) {
  if (!host || host.dataset.ready === "1") return host?._officeApi || null;
  host.dataset.ready = "1"; host.classList.add("sb-office-experience");
  host.innerHTML = `<header class="sb-office-toolbar"><div><strong>Look-down office / <span data-office-name>Astra</span></strong><span data-office-model></span></div><div class="sb-office-actions"><select aria-label="Active office agent" data-office-agent>${CREW.map(a => `<option value="${a.id}">${a.label}</option>`).join("")}</select><button type="button" class="sb-agent-btn" data-office-open>Ask Astra</button><button type="button" class="sb-agent-btn" data-office-reset aria-label="Reset look-down" title="Reset look-down">↺</button></div></header><div class="sb-office-stage"></div><footer class="sb-office-caption"><span data-office-listen></span></footer>`;
  const stage = host.querySelector(".sb-office-stage");
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x263b38);
  scene.add(new THREE.HemisphereLight(0xf9fffb, 0x607b70, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4); sun.position.set(3, 9, 5); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(48, 1, .05, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  stage.appendChild(renderer.domElement);
  const office = createOfficeScene(THREE, { scene });
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = 0.22;
  controls.minPolarAngle = 0;
  controls.minDistance = 8;
  controls.maxDistance = 42;
  const reset = () => {
    camera.position.set(0, 22, 0.01);
    controls.target.set(0, 0.2, -3.2);
    controls.update();
  };
  let firstFit = true, previousAspect = 1;
  const fit = () => {
    const w = Math.max(160, stage.clientWidth), h = Math.max(200, stage.clientHeight);
    camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h, false);
    if (firstFit || Math.abs(camera.aspect - previousAspect) > .3) reset();
    previousAspect = camera.aspect; firstFit = false;
  };
  const observer = new ResizeObserver(fit); observer.observe(stage); fit();
  const paint = (agent = activeOfficeAgent()) => {
    office.select(agent.id);
    host.querySelector("[data-office-agent]").value = agent.id;
    host.querySelector("[data-office-name]").textContent = agent.name;
    host.querySelector("[data-office-model]").textContent = officeModelLabel(agent);
    host.querySelector("[data-office-open]").textContent = agent.id === "astra" ? "Ask Astra" : `Message ${agent.name}`;
    const desk = inspectDesk(agent.id, {});
    host.querySelector("[data-office-listen]").textContent = desk.walk_up
      ? `Marketing desk · ${desk.status} · ${desk.shop_pack || desk.line}`
      : `${desk.status} · ${desk.line} · ${isMcpConnected() ? "MCP on" : "MCP muted"}`;
  };
  const unsubscribe = onOfficeAgentChange(paint);
  window.addEventListener(MCP_CONNECT_EVENT, paintListening);
  window.addEventListener("render3d-astra-model", paintListening);
  function paintListening() { paint(); }
  host.querySelector("[data-office-agent]").onchange = e => selectOfficeAgent(e.target.value);
  host.querySelector("[data-office-open]").onclick = () => openOfficeAgent();
  host.querySelector("[data-office-reset]").onclick = reset;
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener("pointerdown", e => { down = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener("pointerup", e => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1);
    ray.setFromCamera(pointer, camera);
    const id = ray.intersectObjects(office.desks, true)[0]?.object.userData.agentId;
    if (id) { const agent = selectOfficeAgent(id); onDesk?.({ ...agent, label: agent.name }); }
  });
  let paused = false;
  renderer.setAnimationLoop(time => {
    if (paused) return;
    controls.update(); office.update(time / 1000); renderer.render(scene, camera);
  });
  paint();
  const api = {
    desks: office.desks, card: host.querySelector(".sb-office-caption"),
    highlight: id => office.select(id || activeOfficeAgent().id),
    pause() { paused = true; }, resume() { paused = false; fit(); paint(); },
    destroy() { renderer.setAnimationLoop(null); observer.disconnect(); unsubscribe(); window.removeEventListener(MCP_CONNECT_EVENT, paintListening); window.removeEventListener("render3d-astra-model", paintListening); controls.dispose(); office.dispose(); renderer.dispose(); host.dataset.ready = ""; delete host._officeApi; },
  };
  host._officeApi = api;
  return api;
}
