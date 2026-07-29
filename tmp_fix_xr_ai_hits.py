#!/usr/bin/env python3
from pathlib import Path
import re

xr = Path("/home/ubuntu/frontend/viewport-xr.js")
t = xr.read_text()

# --- 1) Replace ensureAiPanel with hit-mesh version ---
old = """  function ensureAiPanel() {
    if (aiPanel) return aiPanel;
    const canvas = drawAiPromptCanvas(readAiState());
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(AI_PLANE.w, AI_PLANE.h),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    plane.renderOrder = 2300;
    plane.frustumCulled = false;
    plane.userData.xrAiPanel = true;
    const titleBar = new THREE.Mesh(
      new THREE.PlaneGeometry(AI_PLANE.w, 0.055),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.001,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    titleBar.position.y = AI_PLANE.h / 2 - 0.028;
    titleBar.position.z = 0.002;
    titleBar.renderOrder = 2301;
    titleBar.frustumCulled = false;
    titleBar.userData.xrAiDrag = true;
    aiPanel = { group: new THREE.Group(), plane, titleBar, tex, canvas };
    aiPanel.group.add(plane);
    aiPanel.group.add(titleBar);
    aiPanel.group.visible = false;
    xrHud.add(aiPanel.group);
    return aiPanel;
  }"""

new = r"""  function aiCanvasToLocal(px, py) {
    return new THREE.Vector3(
      (px / AI_CANVAS.w - 0.5) * AI_PLANE.w,
      (0.5 - py / AI_CANVAS.h) * AI_PLANE.h,
      0.006,
    );
  }

  function makeAiHitTarget(id, px, py, pw, ph) {
    const w = (pw / AI_CANVAS.w) * AI_PLANE.w;
    const h = (ph / AI_CANVAS.h) * AI_PLANE.h;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(w, 0.025), Math.max(h, 0.025)),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.001,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.position.copy(aiCanvasToLocal(px + pw / 2, py + ph / 2));
    mesh.renderOrder = 2310;
    mesh.frustumCulled = false;
    mesh.userData.xrAiHit = id;
    return mesh;
  }

  function ensureAiPanel() {
    if (aiPanel) return aiPanel;
    const canvas = drawAiPromptCanvas(readAiState());
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.flipY = true;
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(AI_PLANE.w, AI_PLANE.h),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
      }),
    );
    plane.renderOrder = 2300;
    plane.frustumCulled = false;
    plane.userData.xrAiPanel = true;

    const hits = [];
    hits.push(makeAiHitTarget("hide", AI_CANVAS.w - 150, 16, 120, 64));
    hits.push(makeAiHitTarget("drag", 8, 8, AI_CANVAS.w - 170, AI_LAYOUT.headerEnd - 12));
    const mic = AI_LAYOUT.mic;
    hits.push(makeAiHitTarget(
      "mic",
      mic.cx - mic.r * 1.25,
      mic.cy - mic.r * 1.25,
      mic.r * 2.5,
      mic.r * 2.5 + 55,
    ));

    function addPillHits(y, ids) {
      const n = ids.length;
      const gap = 16;
      const bw = (AI_CANVAS.w - 96 - gap * (n - 1)) / n;
      ids.forEach((hid, i) => {
        hits.push(makeAiHitTarget(hid, 48 + i * (bw + gap), y, bw, 72));
      });
    }
    addPillHits(AI_LAYOUT.modeY, ["mode:render", "mode:v2", "mode:mesh"]);
    addPillHits(AI_LAYOUT.speedY, ["speed:fast", "speed:quality"]);
    addPillHits(AI_LAYOUT.targetY, ["target:new", "target:edit"]);
    hits.push(makeAiHitTarget("run", 48, AI_LAYOUT.run.y, AI_CANVAS.w - 96, AI_LAYOUT.run.h));

    const titleBar = new THREE.Mesh(
      new THREE.PlaneGeometry(AI_PLANE.w, 0.055),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.001,
        depthTest: false,
        side: THREE.DoubleSide,
      }),
    );
    titleBar.position.y = AI_PLANE.h / 2 - 0.028;
    titleBar.position.z = 0.007;
    titleBar.renderOrder = 2301;
    titleBar.frustumCulled = false;
    titleBar.userData.xrAiDrag = true;
    titleBar.userData.xrAiHit = "drag";

    aiPanel = { group: new THREE.Group(), plane, titleBar, tex, canvas, hits, status: "" };
    aiPanel.group.add(plane);
    aiPanel.group.add(titleBar);
    hits.forEach((h) => aiPanel.group.add(h));
    aiPanel.group.visible = false;
    xrHud.add(aiPanel.group);
    return aiPanel;
  }"""

assert old in t, "ensureAiPanel block missing"
t = t.replace(old, new, 1)

# --- 2) Rewrite pickAiFromLocalPoint → canvas px helper ---
old = """  function pickAiFromLocalPoint(local) {
    const halfW = AI_PLANE.w / 2;
    const halfH = AI_PLANE.h / 2;
    const u = (local.x + halfW) / AI_PLANE.w;
    const fromTop = (halfH - local.y) / AI_PLANE.h;
    if (u < 0 || u > 1 || fromTop < 0 || fromTop > 1) return null;
    const px = u * AI_CANVAS.w;
    const py = fromTop * AI_CANVAS.h;
    if (py < AI_LAYOUT.headerEnd) {
      if (px > AI_CANVAS.w - 160) return { kind: "ai-action", id: "hide" };
      return { kind: "ai-drag" };
    }
    const mic = AI_LAYOUT.mic;
    const dx = px - mic.cx;
    const dy = py - mic.cy;
    const micR = mic.r * 1.35;
    if (dx * dx + dy * dy <= micR * micR) return { kind: "ai-action", id: "mic" };
    // Label under mic is also a hit target
    if (py >= mic.cy + mic.r && py <= mic.cy + mic.r + 70 && Math.abs(dx) < 280) {
      return { kind: "ai-action", id: "mic" };
    }

    function pillHit(y, ids) {
      const n = ids.length;
      const gap = 16;
      const totalGap = gap * (n - 1);
      const bw = (AI_CANVAS.w - 96 - totalGap) / n;
      if (py < y || py > y + 64) return null;
      const i = Math.floor((px - 48) / (bw + gap));
      if (i < 0 || i >= n) return null;
      const x0 = 48 + i * (bw + gap);
      if (px < x0 || px > x0 + bw) return null;
      return ids[i];
    }
    let id = pillHit(AI_LAYOUT.modeY, ["mode:render", "mode:v2", "mode:mesh"]);
    if (id) return { kind: "ai-action", id };
    id = pillHit(AI_LAYOUT.speedY, ["speed:fast", "speed:quality"]);
    if (id) return { kind: "ai-action", id };
    id = pillHit(AI_LAYOUT.targetY, ["target:new", "target:edit"]);
    if (id) return { kind: "ai-action", id };
    const ry = AI_LAYOUT.run.y;
    if (py >= ry && py <= ry + AI_LAYOUT.run.h && px >= 48 && px <= AI_CANVAS.w - 48) {
      return { kind: "ai-action", id: "run" };
    }
    return null;
  }"""

new = """  function pickAiFromCanvasPx(px, py) {
    if (!(px >= 0 && py >= 0 && px <= AI_CANVAS.w && py <= AI_CANVAS.h)) return null;
    if (py < AI_LAYOUT.headerEnd) {
      if (px > AI_CANVAS.w - 160) return { kind: "ai-action", id: "hide" };
      return { kind: "ai-drag" };
    }
    const mic = AI_LAYOUT.mic;
    const dx = px - mic.cx;
    const dy = py - mic.cy;
    const micR = mic.r * 1.4;
    if (dx * dx + dy * dy <= micR * micR) return { kind: "ai-action", id: "mic" };
    if (py >= mic.cy + mic.r && py <= mic.cy + mic.r + 70 && Math.abs(dx) < 280) {
      return { kind: "ai-action", id: "mic" };
    }
    function pillHit(y, ids) {
      const n = ids.length;
      const gap = 16;
      const bw = (AI_CANVAS.w - 96 - gap * (n - 1)) / n;
      if (py < y || py > y + 72) return null;
      for (let i = 0; i < n; i += 1) {
        const x0 = 48 + i * (bw + gap);
        if (px >= x0 && px <= x0 + bw) return ids[i];
      }
      return null;
    }
    let id = pillHit(AI_LAYOUT.modeY, ["mode:render", "mode:v2", "mode:mesh"]);
    if (id) return { kind: "ai-action", id };
    id = pillHit(AI_LAYOUT.speedY, ["speed:fast", "speed:quality"]);
    if (id) return { kind: "ai-action", id };
    id = pillHit(AI_LAYOUT.targetY, ["target:new", "target:edit"]);
    if (id) return { kind: "ai-action", id };
    const ry = AI_LAYOUT.run.y;
    if (py >= ry && py <= ry + AI_LAYOUT.run.h && px >= 48 && px <= AI_CANVAS.w - 48) {
      return { kind: "ai-action", id: "run" };
    }
    return null;
  }

  function pickAiFromLocalPoint(local) {
    const halfW = AI_PLANE.w / 2;
    const halfH = AI_PLANE.h / 2;
    const u = (local.x + halfW) / AI_PLANE.w;
    const fromTop = (halfH - local.y) / AI_PLANE.h;
    if (u < 0 || u > 1 || fromTop < 0 || fromTop > 1) return null;
    return pickAiFromCanvasPx(u * AI_CANVAS.w, fromTop * AI_CANVAS.h);
  }"""

assert old in t, "pickAiFromLocalPoint missing"
t = t.replace(old, new, 1)

# --- 3) AI pick in pickWithController ---
old = """    // Dedicated AI prompt panel (to the right) — always consume plane hits
    // so trigger never "falls through" and grabs the model behind the UI.
    if (aiPanel?.group.visible) {
      const titleHits = raycaster.intersectObject(aiPanel.titleBar, false);
      if (titleHits.length) return { kind: "ai-drag" };
      const ph = raycaster.intersectObject(aiPanel.plane, false);
      if (ph.length) {
        const local = aiPanel.plane.worldToLocal(ph[0].point.clone());
        return pickAiFromLocalPoint(local) || { kind: "ai-action", id: "noop" };
      }
    }"""

new = """    // Dedicated AI prompt panel — physical hit meshes first (reliable on Quest)
    if (aiPanel?.group.visible) {
      aiPanel.group.updateMatrixWorld(true);
      const hitMeshes = [aiPanel.titleBar, ...(aiPanel.hits || [])].filter(Boolean);
      const hh = raycaster.intersectObjects(hitMeshes, false);
      if (hh.length) {
        const id = hh[0].object.userData.xrAiHit;
        if (id === "drag") return { kind: "ai-drag", distance: hh[0].distance };
        if (id) return { kind: "ai-action", id, distance: hh[0].distance };
      }
      const ph = raycaster.intersectObject(aiPanel.plane, false);
      if (ph.length) {
        const uv = ph[0].uv;
        let mapped = null;
        if (uv) mapped = pickAiFromCanvasPx(uv.x * AI_CANVAS.w, (1 - uv.y) * AI_CANVAS.h);
        if (!mapped) {
          const local = aiPanel.plane.worldToLocal(ph[0].point.clone());
          mapped = pickAiFromLocalPoint(local);
        }
        return { ...(mapped || { kind: "ai-action", id: "noop" }), distance: ph[0].distance };
      }
    }"""

assert old in t, "AI pick block missing"
t = t.replace(old, new, 1)

# Also attach distance on menu hits for laser shortening
old = """      const titleHits = raycaster.intersectObject(explorerPanel.titleBar, false);
      if (titleHits.length) return { kind: "explorer-drag" };
      for (const tabHit of explorerPanel.tabHits || []) {
        if (raycaster.intersectObject(tabHit, false).length) {
          return { kind: "menu-tab", tab: tabHit.userData.xrMenuTab };
        }
      }
      const ph = raycaster.intersectObject(explorerPanel.plane, false);
      if (ph.length) {
        const local = explorerPanel.plane.worldToLocal(ph[0].point.clone());
        return pickMenuFromLocalPoint(local) || { kind: "menu-row", line: { kind: "hint" } };
      }
    }"""
new = """      const titleHits = raycaster.intersectObject(explorerPanel.titleBar, false);
      if (titleHits.length) return { kind: "explorer-drag", distance: titleHits[0].distance };
      for (const tabHit of explorerPanel.tabHits || []) {
        const th = raycaster.intersectObject(tabHit, false);
        if (th.length) {
          return { kind: "menu-tab", tab: tabHit.userData.xrMenuTab, distance: th[0].distance };
        }
      }
      const ph = raycaster.intersectObject(explorerPanel.plane, false);
      if (ph.length) {
        const local = explorerPanel.plane.worldToLocal(ph[0].point.clone());
        const mapped = pickMenuFromLocalPoint(local) || { kind: "menu-row", line: { kind: "hint" } };
        return { ...mapped, distance: ph[0].distance };
      }
    }"""
assert old in t
t = t.replace(old, new, 1)

# mesh hit distance
old = """        return { kind: "mesh", point: hit.point.clone() };
      }
    }
    return null;
  }"""
new = """        return { kind: "mesh", point: hit.point.clone(), distance: hit.distance };
      }
    }
    return null;
  }"""
assert old in t
t = t.replace(old, new, 1)

# --- 4) handleAiAction: status + immediate refresh ---
old = """  function handleAiAction(id) {
    if (!id || id === "noop") return;
    if (id === "hide") {
      closeAiPromptPanel();
      return;
    }
    if (id === "mic") {
      try {
        const result = onTranscribeToggle?.();
        Promise.resolve(result).then((res) => {
          if (res && res.ok === false && res.error) {
            menuFooterHint = String(res.error).slice(0, 72);
          }
          refreshAiPromptPanel();
          if (explorerPanel?.group.visible && menuTab === "ai") {
            openMenuConsole({ tab: "ai", keepPose: true });
          }
        }).catch((err) => console.warn("[viewport-xr] mic", err));
      } catch (err) {
        console.warn("[viewport-xr] mic", err);
      }
      setTimeout(() => refreshAiPromptPanel(), 250);
      return;
    }"""
new = """  function handleAiAction(id) {
    if (!id || id === "noop") return;
    if (id === "hide") {
      closeAiPromptPanel();
      return;
    }
    if (id === "mic") {
      if (aiPanel) aiPanel.status = "Starting mic…";
      refreshAiPromptPanel();
      try {
        const result = onTranscribeToggle?.();
        Promise.resolve(result).then((res) => {
          if (aiPanel) {
            if (res && res.ok === false && res.error) {
              aiPanel.status = String(res.error);
            } else if (res?.listening) {
              aiPanel.status = "Listening — speak now";
            } else {
              aiPanel.status = "";
            }
          }
          refreshAiPromptPanel();
          if (explorerPanel?.group.visible && menuTab === "ai") {
            openMenuConsole({ tab: "ai", keepPose: true });
          }
        }).catch((err) => {
          console.warn("[viewport-xr] mic", err);
          if (aiPanel) aiPanel.status = err?.message || "Mic failed";
          refreshAiPromptPanel();
        });
      } catch (err) {
        console.warn("[viewport-xr] mic", err);
        if (aiPanel) aiPanel.status = err?.message || "Mic failed";
        refreshAiPromptPanel();
      }
      return;
    }"""
assert old in t
t = t.replace(old, new, 1)

# --- 5) readAiState includes status overlay in draft when empty ---
old = """  function readAiState() {
    let state = {
      draft: "",
      listening: false,
      mode: "v2",
      speed: "fast",
      targetMode: "new",
      selectedLabel: "None",
    };
    try {
      const s = typeof getAiPromptState === "function" ? getAiPromptState() : null;
      if (s && typeof s === "object") state = { ...state, ...s };
    } catch (_) {}
    try {
      if (!state.draft && typeof getPromptDraft === "function") state.draft = String(getPromptDraft() || "");
    } catch (_) {}
    try {
      if (typeof isTranscribing === "function") state.listening = !!isTranscribing();
    } catch (_) {}
    return state;
  }"""
new = """  function readAiState() {
    let state = {
      draft: "",
      listening: false,
      mode: "v2",
      speed: "fast",
      targetMode: "new",
      selectedLabel: "None",
    };
    try {
      const s = typeof getAiPromptState === "function" ? getAiPromptState() : null;
      if (s && typeof s === "object") state = { ...state, ...s };
    } catch (_) {}
    try {
      if (!state.draft && typeof getPromptDraft === "function") state.draft = String(getPromptDraft() || "");
    } catch (_) {}
    try {
      if (typeof isTranscribing === "function") state.listening = !!isTranscribing();
    } catch (_) {}
    if (aiPanel?.status) {
      state.draft = state.draft
        ? `${state.draft}`
        : String(aiPanel.status);
      if (state.draft && aiPanel.status && !String(state.draft).includes(aiPanel.status) && state.listening) {
        /* keep live transcript; status shown via listening chrome */
      } else if (!state.listening && aiPanel.status && !state.draft) {
        state.draft = aiPanel.status;
      } else if (!state.listening && aiPanel.status && state.draft === aiPanel.status) {
        /* ok */
      } else if (state.listening && !state.draft) {
        state.draft = aiPanel.status || "Listening…";
      }
    }
    return state;
  }"""
assert old in t
t = t.replace(old, new, 1)

# --- 6) Laser shorten: updateControllerRays ---
old = """  function updateDockFollow() {
    attachDockToLeftGrip();
    const pointer = controllers.find((c) => c.userData.handedness === "right")
      || controllers[1]
      || controllers[0];
    if (!pointer) return;
    const hit = pickWithController(pointer);
    dockButtons.forEach((btn) => {
      const hover = hit?.kind === "tool" && hit.tool === btn.userData.xrTool;
      const on = btn.userData.xrTool === activeTool;
      btn.scale.setScalar(hover ? 1.25 : on ? 1.12 : 1);
      if (btn.userData.ring) btn.userData.ring.material.opacity = hover || on ? 1 : 0;
    });
  }"""
new = """  function updateControllerRays() {
    for (const controller of controllers) {
      if (!controller?.visible) continue;
      const ray = controller.getObjectByName("xrRay");
      const tip = controller.children.find((c) => c.isMesh && c.geometry?.type === "SphereGeometry");
      const hit = pickWithController(controller);
      const dist = hit?.distance && Number.isFinite(hit.distance)
        ? Math.min(Math.max(hit.distance, 0.05), 3.0)
        : 1.5;
      if (ray?.geometry?.setFromPoints) {
        ray.geometry.setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, 0, -dist),
        ]);
      }
      if (tip) tip.position.z = -dist;
      // Highlight AI hit targets under the laser
      if (aiPanel?.hits) {
        for (const h of aiPanel.hits) {
          const on = !!(hit?.kind === "ai-action" && hit.id && h.userData.xrAiHit === hit.id);
          h.material.opacity = on ? 0.22 : 0.001;
          h.material.color.setHex(on ? 0x38bdf8 : 0x38bdf8);
        }
      }
    }
  }

  function updateDockFollow() {
    attachDockToLeftGrip();
    updateControllerRays();
    const pointer = controllers.find((c) => c.userData.handedness === "right")
      || controllers[1]
      || controllers[0];
    if (!pointer) return;
    const hit = pickWithController(pointer);
    dockButtons.forEach((btn) => {
      const hover = hit?.kind === "tool" && hit.tool === btn.userData.xrTool;
      const on = btn.userData.xrTool === activeTool;
      btn.scale.setScalar(hover ? 1.25 : on ? 1.12 : 1);
      if (btn.userData.ring) btn.userData.ring.material.opacity = hover || on ? 1 : 0;
    });
  }"""
assert old in t
t = t.replace(old, new, 1)

# Faster refresh while listening
old = """    // Live transcript while AI panel is open (faster while mic is on)
    if (aiPanel?.group.visible) {
      const listening = !!(typeof isTranscribing === "function" && isTranscribing());
      const interval = listening ? 200 : 900;
      if (performance.now() - aiPanelRefreshAt > interval) {
        refreshAiPromptPanel();
        aiPanelRefreshAt = performance.now();
      }
    }"""
new = """    // Live transcript while AI panel is open (fast while mic is on)
    if (aiPanel?.group.visible) {
      const listening = !!(typeof isTranscribing === "function" && isTranscribing());
      const interval = listening ? 100 : 800;
      if (performance.now() - aiPanelRefreshAt > interval) {
        refreshAiPromptPanel();
        aiPanelRefreshAt = performance.now();
      }
    }"""
assert old in t
t = t.replace(old, new, 1)

# Reduce debounce for UI clicks
old = """    if (now - lastSelectAt < 160) return;
    lastSelectAt = now;"""
new = """    if (now - lastSelectAt < 90) return;
    lastSelectAt = now;"""
assert old in t
t = t.replace(old, new, 1)

xr.write_text(t)
print("viewport-xr ok", t.count("{"), t.count("}"))

# --- app.js: keep mic stream open during dictation; expose live draft ---
app = Path("/home/ubuntu/frontend/app.js")
a = app.read_text()

old = """function stopPromptDictation() {
  const rec = promptDictation.rec;
  promptDictation.rec = null;
  if (rec) {
    try { rec.onresult = null; } catch (_) {}
    try { rec.onerror = null; } catch (_) {}
    try { rec.onend = null; } catch (_) {}
    try { rec.stop(); } catch (_) {}
    try { rec.abort(); } catch (_) {}
  }
  if (promptDictation.btn) {
    promptDictation.btn.classList.remove("mic-active");
    promptDictation.btn.title = "Dictate prompt (click to start/stop)";
    promptDictation.btn = null;
  }
  document.querySelectorAll(".prompt-mic-btn.mic-active").forEach((b) => {
    b.classList.remove("mic-active");
    b.title = "Dictate prompt (click to start/stop)";
  });
}"""
new = """function stopPromptDictation() {
  const rec = promptDictation.rec;
  promptDictation.rec = null;
  if (rec) {
    try { rec.onresult = null; } catch (_) {}
    try { rec.onerror = null; } catch (_) {}
    try { rec.onend = null; } catch (_) {}
    try { rec.stop(); } catch (_) {}
    try { rec.abort(); } catch (_) {}
  }
  if (promptDictation.stream) {
    try { promptDictation.stream.getTracks().forEach((tr) => tr.stop()); } catch (_) {}
    promptDictation.stream = null;
  }
  if (promptDictation.btn) {
    promptDictation.btn.classList.remove("mic-active");
    promptDictation.btn.title = "Dictate prompt (click to start/stop)";
    promptDictation.btn = null;
  }
  document.querySelectorAll(".prompt-mic-btn.mic-active").forEach((b) => {
    b.classList.remove("mic-active");
    b.title = "Dictate prompt (click to start/stop)";
  });
}"""
assert old in a
a = a.replace(old, new, 1)

old = """  // Prime mic permission (helps Quest Browser / XR sessions)
  try {
    if (navigator.mediaDevices?.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      try { stream.getTracks().forEach((tr) => tr.stop()); } catch (_) {}
    }
  } catch (err) {
    promptDictation.lastError = "Mic permission blocked — allow microphone for this site";
    console.warn("[mic] getUserMedia", err);
    return { ok: false, error: promptDictation.lastError };
  }

  const rec = new SpeechRecognition();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";

  const base = textarea.value || "";
  let committed = base;
  promptDictation.committed = committed;
  promptDictation.targetId = targetId;
  promptDictation.lastError = "";

  rec.onresult = (e) => {
    let interim = "";
    let finals = base;
    for (const r of e.results) {
      if (r.isFinal) finals += (finals && !finals.endsWith(" ") ? " " : "") + r[0].transcript;
      else interim += r[0].transcript;
    }
    committed = finals;
    promptDictation.committed = finals;
    writePromptMicTranscript(textarea, finals + (interim ? ` ${interim}` : ""));
    try {
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    } catch (_) {}
  };"""
new = """  // Keep the mic stream open for the whole dictation (Quest often fails if we
  // release the track before SpeechRecognition starts).
  try {
    if (navigator.mediaDevices?.getUserMedia) {
      promptDictation.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    }
  } catch (err) {
    promptDictation.lastError = "Mic permission blocked — allow microphone for this site";
    console.warn("[mic] getUserMedia", err);
    return { ok: false, error: promptDictation.lastError };
  }

  const rec = new SpeechRecognition();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-US";
  try { rec.maxAlternatives = 1; } catch (_) {}

  const base = textarea.value || "";
  let committed = base;
  promptDictation.committed = committed;
  promptDictation.targetId = targetId;
  promptDictation.lastError = "";
  promptDictation.liveText = base;

  rec.onresult = (e) => {
    let interim = "";
    let finals = base;
    for (const r of e.results) {
      if (r.isFinal) finals += (finals && !finals.endsWith(" ") ? " " : "") + r[0].transcript;
      else interim += r[0].transcript;
    }
    committed = finals;
    promptDictation.committed = finals;
    const live = finals + (interim ? ` ${interim}` : "");
    promptDictation.liveText = live;
    writePromptMicTranscript(textarea, live);
    try {
      textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    } catch (_) {}
  };"""
assert old in a, "dictation start block missing"
a = a.replace(old, new, 1)

# getAiPromptState should prefer liveText while dictating
old = """  getAiPromptState: () => {
    try {
      const draft = document.getElementById("prompt-input")?.value || "";
      const listening = !!document.querySelector(".prompt-mic-btn.mic-active");
      const mode = (typeof promptMode !== "undefined" && promptMode) || "v2";
      const speed = typeof getPromptGenerationSpeed === "function"
        ? getPromptGenerationSpeed()
        : (document.getElementById("prompt-speed")?.value || "fast");
      const targetMode = typeof getPromptTargetMode === "function"
        ? getPromptTargetMode()
        : (document.getElementById("prompt-target-mode")?.value || "new");
      const selectedLabel = selectedFile || "None";
      return { draft, listening, mode, speed, targetMode, selectedLabel };
    } catch (err) {
      console.warn("[xr] getAiPromptState", err);
      return { draft: "", listening: false, mode: "v2", speed: "fast", targetMode: "new", selectedLabel: "None" };
    }
  },"""
new = """  getAiPromptState: () => {
    try {
      const listening = isPromptDictationActive() || !!document.querySelector(".prompt-mic-btn.mic-active");
      const draft = (listening && promptDictation?.liveText != null)
        ? String(promptDictation.liveText)
        : (document.getElementById("prompt-input")?.value || "");
      const mode = (typeof promptMode !== "undefined" && promptMode) || "v2";
      const speed = typeof getPromptGenerationSpeed === "function"
        ? getPromptGenerationSpeed()
        : (document.getElementById("prompt-speed")?.value || "fast");
      const targetMode = typeof getPromptTargetMode === "function"
        ? getPromptTargetMode()
        : (document.getElementById("prompt-target-mode")?.value || "new");
      const selectedLabel = selectedFile || "None";
      return { draft, listening, mode, speed, targetMode, selectedLabel };
    } catch (err) {
      console.warn("[xr] getAiPromptState", err);
      return { draft: "", listening: false, mode: "v2", speed: "fast", targetMode: "new", selectedLabel: "None" };
    }
  },"""
assert old in a
a = a.replace(old, new, 1)

# promptDictation init fields
old = """const promptDictation = {
  rec: null,
  btn: null,
  targetId: "prompt-input",
  committed: "",
  lastError: "",
};"""
new = """const promptDictation = {
  rec: null,
  btn: null,
  stream: null,
  targetId: "prompt-input",
  committed: "",
  liveText: "",
  lastError: "",
};"""
assert old in a
a = a.replace(old, new, 1)

a2, n = re.subn(
    r'import \{ createViewportXR \} from "\./viewport-xr\.js\?v=[^"]+";',
    'import { createViewportXR } from "./viewport-xr.js?v=20260729-xr-ai-hit";',
    a,
    count=1,
)
assert n == 1
app.write_text(a2)

html = Path("/home/ubuntu/frontend/index.html")
h = html.read_text()
h2, n2 = re.subn(r'app\.js\?v=[^"]+', "app.js?v=20260729-xr-ai-hit", h, count=1)
assert n2 == 1
html.write_text(h2)
print("app/html ok")
PY
