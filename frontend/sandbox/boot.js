/** Sandbox debugger shell. One WebGL. Modular panes. Token sbdbg1. */
import { mountCollaborateId } from "./collaborate-id.js?v=20260923-draw-recordings1&singlevoice1&vrrobot=20260927-2";
import { adoptLive } from "./sandbox-live-instances.js?v=sblive1&teleop-y=20260922-poseconnect1&dimos-viser-local1&vrrobot=20260927-2";
import { mountVoiceBar, speak, probeSpeech } from "./voice.js?v=tokstat1-astravoice1-cfgov1&singlevoice1";
import { forceOneSpeaker } from "./tts-mutex.js?v=cfgov1&singlevoice1";
import { mountIde } from "./ide.js?v=20260923-draw-recordings1";
import { SANDBOX_PANES, loadPaneState, togglePane, SBDBG1_TOKEN } from "./sandbox-layout.js?v=sbdbg1";
import { mountCrewFloor } from "./sandbox-crew-floor.js?v=20260923-draw-recordings1";
import { mountBenchBoard } from "./sandbox-bench-ui.js?v=20260923-draw-recordings1";
import { mountArsenal } from "./sandbox-arsenal.js?v=kb1-fallback1&teleop-y=20260922-poseconnect1";
import { speakMonitor, listenAndLook } from "./voice-look.js?v=voicelook1";
import { enterSandboxVr } from "./sandbox-xr-enter.js?v=20260923-draw-recordings1&vrrobot=20260927-2";
import { vrEnabledPanes } from "./sandbox-layout.js?v=sbdbg1";
import { mountHfRack } from "./huggingface-skills.js?v=hfskill1";
import { mountSuperIde } from "./super-ide.js?v=20260923-draw-recordings1&singlevoice1&vrrobot=20260927-2";
import { mountTeleopLab } from "./teleop-panel.js?v=20260923-draw-recordings1&simrun=20260923-1&vrrobot=20260927-2";
import { mountSandboxAgentBar } from "./sandbox-agent-bar.js?v=20260923-draw-recordings1&simrun=20260923-1&vrrobot=20260927-2";
import {
  enterSandboxWorkspace,
  exitSandboxWorkspace,
  focusWorkspaceEditor,
  isWorkspaceOpen,
} from "./sandbox-workspace-enter.js?v=sbws1&teleop-y=20260922-poseconnect1&vrrobot=20260927-2";

function applyPaneVisibility() {
  const state = loadPaneState();
  document.querySelectorAll("[data-pane]").forEach((el) => {
    const id = el.getAttribute("data-pane");
    el.hidden = !(state[id]?.on);
  });
  document.querySelectorAll("[data-toggle-pane]").forEach((btn) => {
    const id = btn.getAttribute("data-toggle-pane");
    btn.setAttribute("aria-pressed", state[id]?.on ? "true" : "false");
  });
}

function mountPaneToggles(host) {
  if (!host) return;
  host.innerHTML = SANDBOX_PANES.map((p) =>
    `<button type="button" class="sb-agent-btn" data-toggle-pane="${p.id}" aria-pressed="true">${p.title}</button>`
  ).join("");
  host.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-toggle-pane]");
    if (!btn) return;
    togglePane(btn.getAttribute("data-toggle-pane"));
    applyPaneVisibility();
  });
}

function boot() {
  probeSpeech();
  forceOneSpeaker("sandbox-boot");
  mountPaneToggles(document.querySelector("[data-sb-pane-toggles]"));
  applyPaneVisibility();

  const safe = (label, fn) => {
    try { return fn(); } catch (err) {
      console.error(label, err);
      const pill = document.getElementById("sb-api-state");
      if (pill) pill.textContent = `${label}: ${err?.message || err}`;
    }
  };

  safe("viewport", () => mountCollaborateId(document.getElementById("sb-collab-ide"), { speak, compact: true }));
  safe("live", () => adoptLive("viewport", document.getElementById("sb-collab-viewport"), { live: true }));
  safe("ide", () => mountIde(document.getElementById("sb-live-ide")));
  safe("crew", () => mountCrewFloor(document.getElementById("sb-pane-crew")));
  safe("hf", () => mountHfRack(document.getElementById("sb-pane-hf")));
  safe("bench", () => mountBenchBoard(document.getElementById("sb-pane-bench")));
  void mountArsenal(document.getElementById("sb-pane-arsenal")).catch((err) => {
    const pill = document.getElementById("sb-api-state");
    if (pill) pill.textContent = `arsenal: ${err?.message || err}`;
  });

  mountVoiceBar(document.getElementById("sb-voice"), {
    async onCrewTalk() {
      await speak("astra", "Debugger viewport. One voice. Crew benches log to the knowledge lake.");
    },
    async onSamSpeech(text) {
      const look = document.querySelector("[data-look-file]");
      if (look) look.textContent = `Heard: ${text}`;
    },
  });

  document.querySelector("[data-sb-read-monitor]")?.addEventListener("click", () => {
    void speakMonitor({ agentId: "astra" });
  });
  document.querySelector("[data-sb-listen]")?.addEventListener("click", async () => {
    try {
      const out = await listenAndLook({
        onLook: (heard) => {
          const look = document.querySelector("[data-look-file]");
          if (look) look.textContent = heard;
        },
      });
      const pathEl = document.querySelector("[data-sb-ide-path]");
      if (pathEl && /example|loop|js|file/i.test(out.heard)) {
        pathEl.focus();
      }
    } catch (err) {
      const look = document.querySelector("[data-look-file]");
      if (look) look.textContent = err?.message || "Mic unavailable";
    }
  });
  document.querySelector("[data-sb-enter-vr]")?.addEventListener("click", () => {
    const docks = vrEnabledPanes().map((p) => p.id);
    void enterSandboxVr({
      onStatus: (m) => { const p = document.getElementById("sb-api-state"); if (p) p.textContent = `${m} · vr panes ${docks.join(",")}`; },
    });
  });

  let workspaceMounted = false;
  const statusPill = (m) => {
    const p = document.getElementById("sb-api-state");
    if (p) p.textContent = m;
  };
  const ensureWorkspace = () => {
    if (workspaceMounted) return;
    workspaceMounted = true;
    safe("super-ide", () => mountSuperIde(document.getElementById("sb-super-ide")));
    safe("agent-bar", () => mountSandboxAgentBar(document.getElementById("sb-agent-bar"), { speak }));
    safe("teleop", () => mountTeleopLab(document.getElementById("sb-teleop")));
  };
  const openWorkspace = (editor) => {
    ensureWorkspace();
    enterSandboxWorkspace(document, {
      editor,
      onStatus: (m) => {
        statusPill(m);
        const title = document.getElementById("sb-title");
        if (title) title.textContent = editor ? "Workspace editor" : "Workspace";
      },
    });
    if (editor) focusWorkspaceEditor(document);
  };
  document.querySelectorAll("[data-sb-enter-workspace]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (isWorkspaceOpen(document)) {
        exitSandboxWorkspace(document, {
          onStatus: (m) => {
            statusPill(m);
            const title = document.getElementById("sb-title");
            if (title) title.textContent = "Debugger viewport";
          },
        });
        return;
      }
      openWorkspace(false);
    });
  });
  document.querySelectorAll("[data-sb-open-editor]").forEach((btn) => {
    btn.addEventListener("click", () => openWorkspace(true));
  });
  document.querySelector("[data-sb-exit-workspace]")?.addEventListener("click", () => {
    exitSandboxWorkspace(document, {
      onStatus: (m) => {
        statusPill(m);
        const title = document.getElementById("sb-title");
        if (title) title.textContent = "Debugger viewport";
      },
    });
  });
  try {
    const q = new URLSearchParams(location.search || "");
    if (q.get("workspace") === "1" || q.get("editor") === "1" || location.hash === "#workspace" || location.hash === "#editor") {
      openWorkspace(q.get("editor") === "1" || location.hash === "#editor");
    }
  } catch { /* optional */ }

  const pill = document.getElementById("sb-api-state");
  fetch("/api/health?t=" + Date.now()).then((r) => {
    if (pill) {
      pill.textContent = r.ok ? "API up" : "API down";
      pill.classList.toggle("is-offline", !r.ok);
    }
  }).catch(() => { if (pill) { pill.textContent = "API down"; pill.classList.add("is-offline"); } });
}

boot();
