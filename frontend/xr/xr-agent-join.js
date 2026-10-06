import { prefFor } from "../components/voice-agent-roster.js?v=va1";

export const XR_AGENT_JOIN_CHANNEL = "xr-agent-join-v1";
export const XR_AGENT_JOIN_CACHE = "agentjoin1";

export const XR_TEAM_AGENTS = Object.freeze([
  { id: "project-manager", name: "Projects Manager", role: "Keeps tickets honest", avatar: "robot", voice: "cedar", nation: "UK" },
  { id: "cursor-engineer", name: "Regional Manager", role: "Ships tickets", avatar: "robot", voice: "echo", nation: "US" },
  { id: "vibe-marketing", name: "Vibe Marketing", role: "Public proof", avatar: "orb", voice: "coral", nation: "US" },
  { id: "vibe-sales", name: "Vibe Sales", role: "Closer", avatar: "gem", voice: "verse", nation: "UK" },
  { id: "vibe-rnd", name: "Vibe R&D", role: "Experiments", avatar: "gem", voice: "ash", nation: "AU" },
  { id: "analytics", name: "Analytics", role: "Join keys", avatar: "orb", voice: "sage", nation: "IE" },
  { id: "clip-bot", name: "Clip Bot", role: "Print + generative CAD", avatar: "robot", voice: "ballad", nation: "US" },
]);

const CANVAS = { w: 900, h: 720 };
const PLANE = { w: 0.62, h: 0.50 };
const ROW_H = 72;
const LIST_TOP = 96;

export function voicePromptForAgent(agent = {}) {
  const name = String(agent.name || agent.id || "Agent").slice(0, 40);
  const id = String(agent.id || "agent").slice(0, 40);
  const role = String(agent.role || "Render Studio teammate").slice(0, 120);
  return `You are ${name} (bus id ${id}) standing in a shared VR room. Role: ${role}. Speak in first person as this agent. Keep answers under 20 seconds. Do not invent CAD edits.`;
}

export function spawnPoseForIndex(index, head = {}) {
  const i = Math.max(0, Number(index) || 0);
  const origin = Array.isArray(head.position) && head.position.length === 3 ? head.position : [0, 1.6, 0];
  const yaw = Number.isFinite(Number(head.yaw)) ? Number(head.yaw) : 0;
  const spread = (i - 1) * 0.38;
  const dist = 0.92;
  const dx = Math.sin(yaw + spread) * dist;
  const dz = Math.cos(yaw + spread) * dist;
  return {
    position: [origin[0] + dx, origin[1] - 0.18, origin[2] - dz],
    quaternion: [0, Math.sin((yaw + Math.PI + spread) / 2), 0, Math.cos((yaw + Math.PI + spread) / 2)],
  };
}

export function createXrAgentJoinPacket(action, agent, extra = {}) {
  const id = String(agent?.id || "").trim().slice(0, 40);
  if (!id || !["join", "leave", "focus", "sync"].includes(action)) return null;
  const avatar = ["orb", "robot", "gem"].includes(agent.avatar) ? agent.avatar : "orb";
  const pose = extra.pose && Array.isArray(extra.pose.position) && extra.pose.position.length === 3
    ? { position: extra.pose.position.map(Number), quaternion: Array.isArray(extra.pose.quaternion) ? extra.pose.quaternion.map(Number) : [0, 0, 0, 1] }
    : null;
  return {
    channel: XR_AGENT_JOIN_CHANNEL,
    kind: "agent-join",
    action,
    agent_id: id,
    name: String(agent.name || id).slice(0, 40),
    avatar,
    focused: action === "focus" || extra.focused === true,
    pose,
    voice: extra.voice === "live" ? "live" : "stub",
  };
}

export function rosterFromTeamStatus(payload) {
  const rows = Array.isArray(payload?.agents) ? payload.agents : [];
  const byId = new Map(XR_TEAM_AGENTS.map((row) => [row.id, row]));
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const id = String(row.agent || row.id || "").trim();
    if (!id || id === "sam" || seen.has(id)) continue;
    seen.add(id);
    const base = byId.get(id) || {
      id,
      name: id.replace(/-/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase()),
      role: "Teammate",
      avatar: "orb",
      voice: "marin",
    };
    out.push({ ...base, hello: row.hello === true, score: row.score });
  }
  if (out.length) return out;
  return XR_TEAM_AGENTS.map((row) => ({ ...row }));
}

export function applyJoinAction(joined, packet) {
  const next = new Map(joined instanceof Map ? joined : []);
  const id = String(packet?.agent_id || "").trim();
  if (!id) return next;
  if (packet.action === "leave") {
    next.delete(id);
    return next;
  }
  const current = next.get(id) || {};
  next.set(id, {
    ...current,
    id,
    name: String(packet.name || current.name || id).slice(0, 40),
    avatar: ["orb", "robot", "gem"].includes(packet.avatar) ? packet.avatar : current.avatar || "orb",
    pose: packet.pose || current.pose || null,
    live: packet.action === "focus" || packet.focused === true,
    visible: true,
    showToRoom: true,
    shareWithRoom: true,
    host: packet.host === true,
    voice: packet.voice || current.voice || "stub",
  });
  if (packet.action === "focus" || packet.focused === true) {
    for (const [key, value] of next) {
      if (key !== id) next.set(key, { ...value, live: false });
    }
  }
  return next;
}

function headYawFromForward(forward) {
  if (!forward) return 0;
  const x = Number(forward.x ?? forward[0]) || 0;
  const z = Number(forward.z ?? forward[2]) || 0;
  if (!x && !z) return 0;
  return Math.atan2(x, z);
}

export function createXrAgentJoin(THREE, options = {}) {
  const joined = new Map();
  let roster = XR_TEAM_AGENTS.map((row) => ({ ...row }));
  let focused = "";
  let voiceStatus = "";
  let hover = "";
  const avatars = new Map();
  const menu = THREE ? makeMenu(THREE, options.scene) : null;

  function head() {
    const pose = options.getHeadPose?.() || {};
    const position = Array.isArray(pose.position) ? pose.position : [pose.x, pose.y, pose.z];
    return {
      position: position?.every(Number.isFinite) ? position : [0, 1.6, 0],
      yaw: Number.isFinite(Number(pose.yaw)) ? Number(pose.yaw) : headYawFromForward(pose.forward),
    };
  }

  function snapshot() {
    return roster.map((row) => {
      const live = joined.get(row.id);
      return {
        ...row,
        joined: !!live,
        live: !!live?.live,
        voice: live?.voice || "off",
      };
    });
  }

  function announce(packet) {
    if (!packet) return;
    const peers = (options.getPeers?.() || []).map((peer) => String(peer.id || peer.user_id || peer)).filter(Boolean);
    const self = String(options.getUserId?.() || "");
    for (const peer of peers) {
      if (peer === self) continue;
      try { options.send?.(peer, packet); } catch { /* ignore */ }
    }
  }

  function ensureAvatar(row) {
    if (!THREE || !options.scene || avatars.has(row.id)) return avatars.get(row.id);
    const root = new THREE.Group();
    root.name = `xrJoinedAgent:${row.id}`;
    root.userData.xrUi = true;
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 1), new THREE.MeshBasicMaterial({ color: 0xa8dafa, depthTest: false }));
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.067), orb.material.clone());
    const robot = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.08, 0.07), orb.material.clone());
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const tex = new THREE.CanvasTexture(canvas);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.09), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthTest: false }));
    panel.position.set(0, -0.12, 0);
    root.add(orb, gem, robot, panel);
    root.traverse((o) => { o.renderOrder = 94000; o.frustumCulled = false; });
    options.scene.add(root);
    const item = { root, orb, gem, robot, panel, canvas, tex };
    avatars.set(row.id, item);
    return item;
  }

  function paintNametag(item, row) {
    const ctx = item.canvas.getContext("2d");
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = row.live ? "#14532d" : "#17344c";
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = "#e1f5ff";
    ctx.font = "28px sans-serif";
    ctx.fillText(String(row.name || row.id).slice(0, 28), 16, 42);
    ctx.font = "22px sans-serif";
    ctx.fillText(row.live ? "Talking · voice AI" : row.voice === "stub" ? "Joined · voice stub" : "Joined", 16, 88);
    item.tex.needsUpdate = true;
  }

  function syncAvatars(presenting) {
    const seen = new Set();
    for (const row of joined.values()) {
      seen.add(row.id);
      const item = ensureAvatar(row);
      if (!item) continue;
      item.root.visible = !!presenting;
      if (row.pose?.position) item.root.position.fromArray(row.pose.position);
      if (row.pose?.quaternion?.length === 4) item.root.quaternion.fromArray(row.pose.quaternion);
      const look = row.avatar || "orb";
      const voiceOnly = prefFor(row.id).form !== "avatar";
      item.panel.position.set(0, 0.16, 0);
      item.panel.visible = true;
      item.orb.visible = !voiceOnly && look === "orb";
      item.gem.visible = !voiceOnly && look === "gem";
      item.robot.visible = !voiceOnly && look === "robot";
      item.orb.scale.setScalar(row.live ? 1.18 : 1);
      paintNametag(item, row);
    }
    for (const id of [...avatars.keys()]) {
      if (seen.has(id)) continue;
      const item = avatars.get(id);
      item.root.removeFromParent();
      item.root.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
      avatars.delete(id);
    }
  }

  async function hookVoice(agent) {
    const pref = prefFor(agent.id);
    const settings = {
      name: agent.name,
      wakeName: agent.name,
      avatar: pref.form === "avatar" ? (agent.avatar || "orb") : "orb",
      prompt: voicePromptForAgent(agent),
      voice: pref.voice || agent.voice,
      showToRoom: true,
    };
    const bridge = options.voiceAgent?.();
    const live = !!bridge?.getState?.()?.live;
    try { await bridge?.action?.("agent:setting", settings); } catch { /* settings optional */ }
    if (live) return { ok: true, voice: "live", cloud: "one" };
    if (typeof options.startVoice !== "function") {
      return { ok: true, voice: "stub", error: "Voice starter is not wired yet." };
    }
    try {
      const result = await options.startVoice({
        greet: true,
        text: `Hey ${agent.name}. You just joined this VR room.`,
      });
      if (result?.ok === false) return { ok: false, voice: "stub", error: result.error || "Voice AI did not start." };
      return { ok: true, voice: result?.live ? "live" : "stub", error: result?.error || "" };
    } catch (error) {
      return { ok: false, voice: "stub", error: error.message || "Voice AI did not start." };
    }
  }

  async function join(id, { talk = false } = {}) {
    const agent = roster.find((row) => row.id === id) || XR_TEAM_AGENTS.find((row) => row.id === id);
    if (!agent) return { ok: false, error: "Unknown agent." };
    const existing = joined.get(id);
    const pose = existing?.pose || spawnPoseForIndex(existing ? [...joined.keys()].indexOf(id) : joined.size, head());
    let voice = existing?.voice || "stub";
    let error = "";
    if (talk) {
      focused = id;
      const hooked = await hookVoice(agent);
      voice = hooked.voice;
      error = hooked.error || "";
      voiceStatus = hooked.ok && hooked.voice === "live"
        ? `${agent.name} is on voice AI`
        : `${agent.name} joined. ${error || "Voice stays a stub until Realtime keys work."}`;
    } else {
      voiceStatus = `${agent.name} joined the room`;
    }
    const packet = createXrAgentJoinPacket(talk ? "focus" : "join", agent, { pose, voice, focused: talk });
    const next = applyJoinAction(joined, { ...packet, host: true });
    joined.clear();
    for (const [key, value] of next) joined.set(key, value);
    announce(packet);
    menu?.redraw();
    return { ok: true, voice, error, packet };
  }

  async function joinOne(id) {
    return join(id, { talk: false });
  }

  async function joinAll() {
    for (const row of roster) {
      await join(row.id, { talk: false });
    }
    const first = roster[0]?.id;
    if (first) await join(first, { talk: true });
    voiceStatus = "All agents joined. One voice session. Name who you mean.";
    menu?.redraw();
    return { ok: true, n: roster.length, cloud: "one" };
  }

  async function talkTo(id) {
    if (!joined.has(id)) {
      const spawned = await join(id, { talk: false });
      if (!spawned.ok) return spawned;
    }
    return join(id, { talk: true });
  }

  function leave(id) {
    const agent = joined.get(id) || roster.find((row) => row.id === id);
    const packet = createXrAgentJoinPacket("leave", agent || { id });
    const next = applyJoinAction(joined, packet);
    joined.clear();
    for (const [key, value] of next) joined.set(key, value);
    if (focused === id) focused = "";
    announce(packet);
    voiceStatus = `${agent?.name || id} left`;
    menu?.redraw();
    return { ok: true, packet };
  }

  function receive(peer, signal) {
    if (!signal || signal.channel !== XR_AGENT_JOIN_CHANNEL) return false;
    const next = applyJoinAction(joined, { ...signal, host: false });
    joined.clear();
    for (const [key, value] of next) joined.set(key, value);
    menu?.redraw();
    return true;
  }

  function action(tool) {
    const parts = String(tool || "").split(":");
    if (parts[0] !== "agent-join") return false;
    const verb = parts[1];
    const id = parts.slice(2).join(":");
    if (verb === "open") { menu?.open(); return true; }
    if (verb === "close") { menu?.close(); return true; }
    if (verb === "join") { void joinOne(id); return true; }
    if (verb === "all") { void joinAll(); return true; }
    if (verb === "talk") { void talkTo(id); return true; }
    if (verb === "leave") { leave(id); return true; }
    if (verb === "avatar") {
      const choices = ["orb", "robot", "gem"];
      roster = roster.map((row) => row.id === id
        ? { ...row, avatar: choices[(choices.indexOf(row.avatar) + 1) % choices.length] }
        : row);
      const current = joined.get(id);
      if (current) joined.set(id, { ...current, avatar: roster.find((row) => row.id === id)?.avatar || "orb" });
      menu?.redraw();
      return true;
    }
    return false;
  }

  function makeMenu(THREE, scene) {
    const group = new THREE.Group();
    group.name = "xrAgentJoinMenu";
    group.userData.xrUi = true;
    group.visible = false;
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS.w;
    canvas.height = CANVAS.h;
    const ctx = canvas.getContext("2d");
    const tex = new THREE.CanvasTexture(canvas);
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(PLANE.w, PLANE.h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
    );
    face.userData.xrUi = true;
    group.add(face);
    group.traverse((o) => { o.frustumCulled = false; o.renderOrder = 96000; });
    scene?.add(group);

    function redraw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, CANVAS.w, CANVAS.h);
      ctx.fillStyle = "#0f1720";
      ctx.fillRect(0, 0, CANVAS.w, CANVAS.h);
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 6;
      ctx.strokeRect(4, 4, CANVAS.w - 8, CANVAS.h - 8);
      ctx.fillStyle = "#1e293b";
      ctx.fillRect(0, 0, CANVAS.w, 72);
      ctx.fillStyle = "#f1f5f9";
      ctx.font = "700 30px system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText("Invite agents", 28, 46);
      ctx.fillStyle = "#22c55e";
      ctx.fillRect(CANVAS.w - 250, 16, 92, 40);
      ctx.fillStyle = "#0f172a";
      ctx.font = "700 22px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("All", CANVAS.w - 204, 43);
      ctx.textAlign = "left";
      ctx.fillStyle = "#94a3b8";
      ctx.font = "700 28px system-ui, sans-serif";
      ctx.fillText("×", CANVAS.w - 52, 48);
      ctx.font = "500 18px system-ui, sans-serif";
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(voiceStatus || "Select one at a time. Talk hooks the existing Astra voice session.", 28, 88, CANVAS.w - 56);
      snapshot().forEach((row, i) => {
        const y = LIST_TOP + i * ROW_H;
        const hot = hover === row.id;
        ctx.fillStyle = row.live ? "rgba(34,197,94,0.22)" : hot ? "rgba(125,211,252,0.16)" : (i % 2 ? "rgba(255,255,255,0.05)" : "rgba(15,23,42,0.28)");
        ctx.fillRect(20, y, CANVAS.w - 40, ROW_H - 8);
        ctx.fillStyle = "#f8fafc";
        ctx.font = "700 24px system-ui, sans-serif";
        ctx.fillText(row.name, 36, y + 28);
        ctx.font = "500 18px system-ui, sans-serif";
        ctx.fillStyle = "#cbd5e1";
        ctx.fillText(row.role, 36, y + 52);
        ctx.fillStyle = "#334155";
        ctx.fillRect(CANVAS.w - 290, y + 14, 104, 40);
        ctx.fillStyle = "#e2e8f0";
        ctx.font = "700 17px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(row.avatar || "orb", CANVAS.w - 238, y + 40);
        const btn = row.joined ? (row.live ? "Leave" : "Talk") : "Join";
        ctx.fillStyle = row.joined && !row.live ? "#0ea5e9" : row.live ? "#ef4444" : "#22c55e";
        ctx.fillRect(CANVAS.w - 168, y + 14, 128, 40);
        ctx.fillStyle = "#0f172a";
        ctx.font = "700 20px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(btn, CANVAS.w - 104, y + 41);
        ctx.textAlign = "left";
      });
      tex.needsUpdate = true;
    }

    function hit(uv) {
      if (!uv || !group.visible) return null;
      const px = uv.x * CANVAS.w;
      const py = (1 - uv.y) * CANVAS.h;
      if (py < 72 && px > CANVAS.w - 88) return { kind: "tool", tool: "agent-join:close" };
      if (py < 72 && px > CANVAS.w - 260 && px < CANVAS.w - 150) return { kind: "tool", tool: "agent-join:all" };
      if (py < 72) return { kind: "tool", tool: "agent-join:drag" };
      const idx = Math.floor((py - LIST_TOP) / ROW_H);
      const row = snapshot()[idx];
      if (!row) return { kind: "tool", tool: "agent-join:open" };
      hover = row.id;
      if (px > CANVAS.w - 290 && px <= CANVAS.w - 168) return { kind: "tool", tool: `agent-join:avatar:${row.id}` };
      if (px > CANVAS.w - 168) {
        const verb = row.joined ? (row.live ? "leave" : "talk") : "join";
        return { kind: "tool", tool: `agent-join:${verb}:${row.id}` };
      }
      return { kind: "tool", tool: `agent-join:${row.joined ? "talk" : "join"}:${row.id}` };
    }

    return {
      group,
      face,
      redraw,
      open() {
        group.visible = true;
        const pose = options.getHeadPose?.() || {};
        if (pose.position && pose.forward && THREE) {
          const p = new THREE.Vector3().fromArray(Array.isArray(pose.position) ? pose.position : [pose.x, pose.y, pose.z]);
          const f = new THREE.Vector3(pose.forward.x ?? pose.forward[0] ?? 0, 0, pose.forward.z ?? pose.forward[2] ?? -1);
          if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
          else f.normalize();
          group.position.copy(p).addScaledVector(f, 0.72);
          group.position.y -= 0.08;
          const toHead = p.clone().sub(group.position);
          toHead.y = 0;
          if (toHead.lengthSq() > 1e-6) group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), toHead.normalize());
        }
        redraw();
      },
      close() { group.visible = false; },
      pick(raycaster) {
        if (!group.visible) return null;
        group.updateMatrixWorld(true);
        const hitMesh = raycaster.intersectObject(face, false)[0];
        if (!hitMesh) return null;
        const picked = hit(hitMesh.uv);
        if (!picked) return null;
        return { ...picked, distance: hitMesh.distance, point: hitMesh.point, source: "agent-join" };
      },
    };
  }

  menu?.redraw?.();

  return {
    channel: XR_AGENT_JOIN_CHANNEL,
    menu,
    getPanel: () => menu?.group,
    snapshot,
    joined: () => [...joined.values()],
    join: joinOne,
    talkTo,
    leave,
    receive,
    action,
    openMenu: () => menu?.open(),
    closeMenu: () => menu?.close(),
    pick: (raycaster) => menu?.pick(raycaster) || null,
    update({ presenting = false } = {}) {
      syncAvatars(presenting);
      if (menu?.group?.visible) menu.redraw();
    },
    dispose() {
      for (const id of [...avatars.keys()]) {
        const item = avatars.get(id);
        item.root.removeFromParent();
        item.root.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
      }
      avatars.clear();
      menu?.group?.removeFromParent();
    },
  };
}
