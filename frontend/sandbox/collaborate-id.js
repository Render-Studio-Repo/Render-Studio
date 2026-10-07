/**
 * Collaborate ID — agent roster with icons + where each edited.
 * Replaces the old Collab index / solid-only hangout list. Token collabid1.
 */

import { CREW } from "./office.js?v=20260923-draw-recordings1";
import { REPAIR_AGENTS } from "./repair-table.js?v=repair1";
import { AGENT_VOICE } from "./tts-mutex.js?v=voice1&singlevoice1";
import { activeOfficeAgent, selectOfficeAgent, onOfficeAgentChange, agentById } from "./office-agents.js?v=office2-printer1&astraoffice=20260917-1";
import { adoptLive } from "./sandbox-live-instances.js?v=sblive1&teleop-y=20260922-poseconnect1&dimos-viser-local1&vrrobot=20260927-2";
import {
  crewSeatInventory,
  inspectDesk,
  avatarChipHtml,
} from "./crew-desk-status.js?v=20260923-draw-recordings1";
import { listTasks, assignTask, seedShopCrewTasks } from "./agent-tasks.js?v=20260923-draw-recordings1";
import { characterMoveMarkup, bindCharacterMoves } from "./character-moves.js?v=charmove1";
import { collabWorkbenchMarkup, bindCollabWorkbench } from "./collab-workbench.js?v=20260923-draw-recordings1&vrrobot=20260927-2";
import { lookdownMarkup, bindLookdown } from "./lookdown-map.js?v=20260923-draw-recordings1";
import { elRunMarkup, bindElRun } from "./electronics-virtual-run.js?v=20260923-draw-recordings1";
import { SKILL_LANES, skillFor, setSeatSkill } from "./crew-harness.js?v=harness2";
import { hearFlagsFor, setHearFlags, postCrewNote, notesForSeat } from "./crew-notes-bus.js?v=notesbus1";
import { forceOneSpeaker } from "./tts-mutex.js?v=cfgov1&singlevoice1";

export const COLLABID1_TOKEN = "collabid1";

const EXTRA = [
  { id: "astra", label: "Astra", color: 0xfacc15, ask: "Host — talk + point for reference." },
  { id: "cursor-engineer", label: "Cursor", color: 0x58a6ff, ask: "Sandbox file IDE." },
  { id: "project-manager", label: "PM", color: 0x8b7355, ask: "Ship gates." },
  { id: "vibe-rnd", label: "RnD", color: 0x3fb950, ask: "OpenArm / VR experiments." },
];

function hex(n) {
  return `#${(n >>> 0).toString(16).padStart(6, "0")}`;
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function collaborateRoster() {
  const byId = new Map();
  for (const row of [...EXTRA, ...CREW, ...REPAIR_AGENTS.map((a) => ({
    id: a.id,
    label: a.label,
    color: 0xef4444,
    ask: a.ask,
  }))]) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  return [...byId.values()];
}

function agentIcon(row) {
  const letter = String(row.label || row.id || "?").slice(0, 1).toUpperCase();
  const voice = AGENT_VOICE[row.id] || AGENT_VOICE[row.id?.replace?.(/-/g, "")] || "";
  return { letter, voice, fill: hex(row.color ?? 0x8b949e) };
}

async function fetchCodeUpdateHistory() {
  try {
    const res = await fetch("/mcp/sandbox/file?path=" + encodeURIComponent("live/code-updates-link.json") + "&t=" + Date.now()).catch(() => null);
    if (!res?.ok) return [];
    const data = await res.json().catch(() => ({}));
    const parsed = data.text ? JSON.parse(data.text) : {};
    return Array.isArray(parsed.history) ? parsed.history : [];
  } catch {
    return [];
  }
}

function mergeLiveHistory(log = [], codeHistory = [], local = []) {
  const rows = [
    ...log.map((item) => ({
      at: item.ts || item.at || "",
      agent: item.agent || "?",
      path: item.path || "",
      note: item.note || item.text || "collab edit",
      source: "collab",
    })),
    ...codeHistory.map((item) => ({
      at: item.at || "",
      agent: item.agent || "cursor",
      path: item.path || "",
      note: item.note || "code update",
      source: "push",
    })),
    ...local,
  ];
  rows.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return rows.slice(0, 40);
}

async function fetchCollabData() {
  const res = await fetch("/mcp/collab-index?t=" + Date.now()).catch(() => null);
  if (!res || !res.ok) return { files: [], log: [] };
  const wrapped = await res.json().catch(() => ({}));
  const data = wrapped.index || wrapped;
  return { files: Array.isArray(data.files) ? data.files : [], log: Array.isArray(data.log) ? data.log : [] };
}

function groupByAgent(files) {
  const map = new Map();
  for (const f of files) {
    const agent = String(f.agent || f.by || f.author || "?").trim() || "?";
    if (!map.has(agent)) map.set(agent, []);
    map.get(agent).push(f);
  }
  return map;
}

export function mountCollaborateId(host, { speak, onPoint, compact = false } = {}) {
  if (!host) return null;
  if (host.dataset.ready === "1") return host._collabApi || null;
  host.dataset.ready = "1";
  host.dataset.token = COLLABID1_TOKEN;
  host.classList.add("sb-collab-id");

  const roster = collaborateRoster();
  host.innerHTML = `
    ${compact ? `<div class="sb-collab-watch sb-collab-watch--solo">
      <div class="sb-live-slot sb-collab-viewport" id="sb-collab-viewport" data-sb-live-slot="viewport"></div>
    </div>` : `
    <header class="sb-collab-head">
      <div>
        <span class="sb-kicker">DEBUGGER VIEWPORT · ${COLLABID1_TOKEN}</span>
        <p class="muted small">One live Studio embed. Crew floor and chat live in their own panes.</p>
      </div>
      <div class="sb-collab-actions">
        <span class="muted small" data-collab-status role="status">Idle</span>
      </div>
    </header>
    <div class="sb-collab-watch">
      <div class="sb-live-slot sb-collab-viewport" id="sb-collab-viewport" data-sb-live-slot="viewport"></div>
      <aside class="sb-collab-inspect" data-collab-inspect></aside>
    </div>
    <div data-collab-workbench></div>
    <div data-collab-lookdown></div>
    <div data-collab-elrun></div>
    <div data-collab-charmove></div>
    <div class="sb-collab-grid" data-collab-roster></div>
    <div class="sb-collab-history">
      <h3 class="sb-collab-edits-title">Live history log</h3>
      <ul class="sb-collab-history-list" data-collab-history></ul>
    </div>
    <div class="sb-collab-edits">
      <h3 class="sb-collab-edits-title">Where they edited</h3>
      <ul class="sb-collab-edit-list" data-collab-edits></ul>
    </div>`}
  `;

  const status = host.querySelector("[data-collab-status]");
  const setStatus = (m) => { if (status) status.textContent = m; };
  let pointing = false;
  let selectedAgent = activeOfficeAgent().id;
  const syncSelected = agent => {
    selectedAgent = agent.id;
    host.querySelector("[data-collab-astra]") && (host.querySelector("[data-collab-astra]").textContent = "Open Astra");
    host.querySelectorAll("[data-collab-roster] [data-agent]").forEach(btn => btn.setAttribute("aria-pressed", String(btn.dataset.agent === agent.id)));
  };
  const unsubscribe = onOfficeAgentChange((agent) => {
    syncSelected(agent);
    paintInspect();
  });
  syncSelected(activeOfficeAgent());

  const paintInspect = () => {
    const inspect = host.querySelector("[data-collab-inspect]");
    if (!inspect) return;
    const desk = inspectDesk(selectedAgent, { tasks: listTasks() });
    const hear = hearFlagsFor(selectedAgent);
    const skill = skillFor(selectedAgent);
    const notes = notesForSeat(selectedAgent);
    inspect.innerHTML = `
      <p class="sb-kicker">${desk.walk_up ? "MARKETING DESK" : "SEAT"} · look-down</p>
      <strong>${esc(desk.name || selectedAgent)}</strong>
      <p>${esc(desk.status)} · ${esc(desk.line || desk.shop_pack || "")}</p>
      ${desk.walk_up ? `<p class="muted small">Shoot: ${esc((desk.shoot_files || []).join(", "))}<br>Music: ${esc((desk.music || []).join(", "))}</p>` : ""}
      <label class="sb-dimos-field"><span>Skill lane</span>
        <select data-insp-skill>${SKILL_LANES.map((s) => `<option value="${s.id}" ${s.id === skill ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select>
      </label>
      ${compact ? "" : `<div class="sb-dimos-actions">
        <button type="button" class="sb-agent-btn" data-insp-reassign="shop-pack">Shop pack</button>
        <button type="button" class="sb-agent-btn" data-insp-reassign="printer">Printer</button>
        <button type="button" class="sb-agent-btn" data-insp-reassign="wiring">Wiring</button>
        <button type="button" class="sb-agent-btn" data-insp-reassign="marketing-desk">Marketing desk</button>
      </div>`}
      <label class="sb-printer-check"><input type="checkbox" data-insp-hear-sam ${hear.hear_sam ? "checked" : ""} /> Can hear Sam</label>
      <label class="sb-printer-check"><input type="checkbox" data-insp-hear-notes ${hear.hear_crew_notes ? "checked" : ""} /> Hear crew notes (no TTS)</label>
      <button type="button" class="sb-agent-btn" data-insp-talk>Talk to this seat</button>
      <ul class="muted small">${notes.slice(-4).map((n) => `<li>${esc(n.from)}: ${esc(n.text)}</li>`).join("") || "<li>No crew notes yet</li>"}</ul>
    `;
    inspect.querySelector("[data-insp-skill]")?.addEventListener("change", (ev) => {
      setSeatSkill(selectedAgent, ev.target.value);
      assignTask(selectedAgent, `Skill lane → ${ev.target.value}`, { from: "lookdown" });
      setStatus(`${selectedAgent} skill → ${ev.target.value}`);
    });
    inspect.querySelectorAll("[data-insp-reassign]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const lane = btn.getAttribute("data-insp-reassign");
        setSeatSkill(selectedAgent, lane);
        if (lane === "shop-pack") seedShopCrewTasks({ from: "lookdown" });
        assignTask(selectedAgent, `Reassigned to ${lane}`, { from: "lookdown" });
        postCrewNote({ from: "sam", to: selectedAgent, kind: "reassign", text: `Go ${lane}` });
        paintInspect();
        setStatus(`Reassigned ${selectedAgent} → ${lane}`);
      });
    });
    inspect.querySelector("[data-insp-hear-sam]")?.addEventListener("change", (ev) => {
      setHearFlags(selectedAgent, { hear_sam: ev.target.checked });
    });
    inspect.querySelector("[data-insp-hear-notes]")?.addEventListener("change", (ev) => {
      setHearFlags(selectedAgent, { hear_crew_notes: ev.target.checked });
    });
    inspect.querySelector("[data-insp-talk]")?.addEventListener("click", async () => {
      if (!hearFlagsFor(selectedAgent).hear_sam) {
        setStatus(`${selectedAgent} cannot hear Sam (flag off)`);
        return;
      }
      forceOneSpeaker("collab-talk");
      postCrewNote({ from: "sam", to: selectedAgent, kind: "address", text: `Sam addressing ${selectedAgent}` });
      if (typeof speak === "function") {
        await speak("astra", `Sam to ${desk.name || selectedAgent}. Notes stay written.`, { force: true, topic: "collab-talk" });
      }
      setStatus(`Talked to ${selectedAgent} · one speaker`);
    });
  };

  host.querySelector("[data-collab-update-button]")?.addEventListener("click", (event) => {
    const wrap = event.currentTarget.closest(".sb-collab-update-wrap");
    const open = wrap?.classList.toggle("is-open") || false;
    event.currentTarget.setAttribute("aria-expanded", String(open));
  });

  const localHistory = [];
  const onAutoPush = (ev) => {
    const d = ev?.detail || {};
    localHistory.unshift({
      at: d.at || new Date().toISOString(),
      agent: d.agent || "cursor",
      path: d.path || "",
      note: d.note || "auto-push",
      source: "push",
    });
    if (localHistory.length > 30) localHistory.length = 30;
    void paint();
  };
  window.addEventListener("render3d-sandbox-autopush", onAutoPush);

  const paint = async () => {
    const [{ files, log }, codeHistory] = await Promise.all([
      fetchCollabData(),
      fetchCodeUpdateHistory(),
    ]);
    const byAgent = groupByAgent(files);
    const history = mergeLiveHistory(log, codeHistory, localHistory);
    const updates = log.slice(-6).reverse();
    const updateCount = host.querySelector("[data-collab-update-count]");
    if (updateCount) updateCount.textContent = String(Math.max(updates.length, history.length));
    const updateList = host.querySelector("[data-collab-update-list]");
    if (updateList) updateList.innerHTML = updates.length
      ? updates.map((item) => {
        const agent = String(item.agent || "unknown");
        const row = roster.find((r) => r.id === agent) || { label: agent, color: 0x8b949e };
        const icon = agentIcon(row);
        return `<li><span class="sb-collab-icon sb-collab-icon--sm" style="background:${icon.fill}">${esc(icon.letter)}</span><span><b>${esc(row.label)}</b><br><code>${esc(item.path || "unknown file")}</code><small>${esc(item.ts || "time unknown")}</small></span></li>`;
      }).join("")
      : "<li>No recorded edits yet.</li>";
    const historyEl = host.querySelector("[data-collab-history]");
    if (historyEl) {
      historyEl.innerHTML = history.length
        ? history.slice(0, 18).map((row) => {
          const agent = String(row.agent || "?");
          const meta = roster.find((r) => r.id === agent) || { label: agent, color: 0x8b949e };
          const icon = agentIcon(meta);
          return `<li class="sb-collab-history-row" data-source="${esc(row.source)}">
            <span class="sb-collab-icon sb-collab-icon--sm" style="background:${icon.fill}">${esc(icon.letter)}</span>
            <span><b>${esc(meta.label)}</b> · <code>${esc(row.path || "—")}</code>
            <small>${esc(row.note)} · ${esc(String(row.at).slice(0, 19))} · ${esc(row.source)}</small></span>
          </li>`;
        }).join("")
        : `<li class="muted small">Live history empty — Astra distribute / File IDE auto-push will land here.</li>`;
    }
    const rosterEl = host.querySelector("[data-collab-roster]");
    const editsEl = host.querySelector("[data-collab-edits]");
    if (!compact) paintInspect();
    if (rosterEl) {
      const seats = crewSeatInventory();
      rosterEl.innerHTML = roster.map((row) => {
        const seat = seats.find((s) => s.id === row.id) || { id: row.id, name: row.label, avatar: { glyph: agentIcon(row).letter, accent: agentIcon(row).fill } };
        const st = inspectDesk(row.id, { tasks: listTasks() });
        const n = (byAgent.get(row.id) || byAgent.get(row.label?.toLowerCase?.()) || []).length;
        return `
          <button type="button" class="sb-collab-card" data-agent="${esc(row.id)}" title="${esc(row.ask || "")}">
            ${avatarChipHtml(seat)}
            <span class="sb-collab-meta">
              <strong>${esc(row.label)}</strong>
              <span class="muted small">${esc(st.status)} · ${esc(st.line || row.id)}</span>
              <span class="sb-collab-count">${n} edit${n === 1 ? "" : "s"}</span>
            </span>
          </button>`;
      }).join("");
      rosterEl.querySelectorAll("[data-agent]").forEach((btn) => {
        btn.addEventListener("click", () => {
          selectedAgent = btn.getAttribute("data-agent") || "astra";
          if (agentById(selectedAgent)) selectOfficeAgent(selectedAgent);
          pointing = true;
          setStatus(`Pointing as ${selectedAgent} — click a file or say a reference`);
          onPoint?.({ agent: selectedAgent, kind: "select" });
          try {
            window.dispatchEvent(new CustomEvent("render3d-sandbox-collab-point", {
              detail: { agent: selectedAgent, token: COLLABID1_TOKEN },
            }));
          } catch { /* optional */ }
        });
      });
    }
    if (editsEl) {
      editsEl.innerHTML = files.length
        ? files.map((f) => {
          const agent = f.agent || "?";
          const path = f.path || f.file || "";
          const row = roster.find((r) => r.id === agent) || { label: agent, color: 0x8b949e };
          const icon = agentIcon(row);
          return `<li>
            <button type="button" class="sb-collab-edit" data-path="${esc(path)}" data-agent="${esc(agent)}">
              <span class="sb-collab-icon sb-collab-icon--sm" style="background:${icon.fill}">${esc(icon.letter)}</span>
              <span><code>${esc(path)}</code> · ${esc(agent)}</span>
            </button>
          </li>`;
        }).join("")
        : `<li class="muted small">No collab files yet — agents write under <code>live/</code> / <code>notes/</code>.</li>`;
      editsEl.querySelectorAll("[data-path]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const path = btn.getAttribute("data-path");
          const agent = btn.getAttribute("data-agent") || selectedAgent;
          setStatus(`Reference → ${path}`);
          onPoint?.({ agent, path, kind: "file" });
          try {
            const { addReferencePoint } = await import("./change-map.js?v=map1");
            addReferencePoint({ kind: "collab_file", label: path, note: `Pointed with ${agent}` });
          } catch { /* optional */ }
          try {
            window.dispatchEvent(new CustomEvent("render3d-sandbox-collab-point", {
              detail: { agent, path, token: COLLABID1_TOKEN },
            }));
          } catch { /* optional */ }
        });
      });
    }
    syncSelected(activeOfficeAgent());
    setStatus(`${files.length} files · ${history.length} history`);
  };

  host.querySelector("[data-collab-refresh]")?.addEventListener("click", () => { void paint(); });

  host.querySelector("[data-collab-astra]")?.addEventListener("click", () => {
    pointing = true;
    document.querySelector("[data-sb-astra]")?.click();
    setStatus("Astra chat opened");
  });

  const wbHost = host.querySelector("[data-collab-workbench]");
  if (wbHost && !wbHost.dataset.ready) {
    wbHost.dataset.ready = "1";
    wbHost.innerHTML = collabWorkbenchMarkup();
    bindCollabWorkbench(wbHost.querySelector("[data-collab-wb]"), { onStatus: setStatus });
  }
  const ldHost = host.querySelector("[data-collab-lookdown]");
  if (ldHost && !ldHost.dataset.ready) {
    ldHost.dataset.ready = "1";
    ldHost.innerHTML = lookdownMarkup();
    bindLookdown(ldHost.querySelector("[data-sb-lookdown]"), {
      onSelect: (seat) => {
        selectedAgent = seat.id;
        if (agentById(seat.id)) selectOfficeAgent(seat.id);
        paintInspect();
        setStatus(`Look-down · ${seat.name}`);
      },
    });
  }
  const elHost = host.querySelector("[data-collab-elrun]");
  if (elHost && !elHost.dataset.ready) {
    elHost.dataset.ready = "1";
    elHost.innerHTML = elRunMarkup();
    bindElRun(elHost.querySelector("[data-sb-elrun]"));
  }
  const cmHost = host.querySelector("[data-collab-charmove]");
  if (cmHost && !cmHost.dataset.ready) {
    cmHost.dataset.ready = "1";
    cmHost.innerHTML = characterMoveMarkup();
    bindCharacterMoves(cmHost.querySelector("[data-sb-charmove]"));
  }
  adoptLive("viewport", host.querySelector("#sb-collab-viewport") || host.querySelector("[data-sb-live-slot='viewport']"), { live: true });
  if (compact) {
    const inspect = host.querySelector("[data-collab-inspect]");
    if (inspect) inspect.remove();
  } else {
    paintInspect();
  }

  void paint();
  const timer = setInterval(() => { void paint(); }, 5000);
  const api = {
    token: COLLABID1_TOKEN,
    refresh: paint,
    destroy: () => {
      clearInterval(timer);
      unsubscribe();
      window.removeEventListener("render3d-sandbox-autopush", onAutoPush);
    },
    isPointing: () => pointing,
  };
  host._collabApi = api;
  return api;
}
