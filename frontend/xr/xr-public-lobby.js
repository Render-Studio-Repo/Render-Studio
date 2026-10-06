/** Public VR lobby: occupancy, profiles, friends, import a project, then enter XR. */

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function initial(name) {
  return String(name || "?").trim().charAt(0).toUpperCase() || "?";
}

export function createXrPublicLobby({
  api,
  getToken = () => "",
  getCurrentUser = () => null,
  getProjects = () => [],
  getProjectId = () => null,
  onImportProject = null,
  onEnterVr = null,
  onStatus = null,
  overlayEl = null,
  onXrPose = null,
  onRtcSignal = null,
  onStroke = null,
  onDraw = null,
  onFile = null,
  onPromptBridge = null,
  onDropProject = null,
  onPublicObject = null,
  onShareInvite = null,
  onVideoShare = null,
  onJoined = null,
} = {}) {
  let open = false;
  let wantedJoin = false;
  let joining = false;
  let joined = false;
  let room = { count: 0, users: [], friend_ids: [] };
  /** @type {Map<string, { id: string, display_name: string, handle?: string, color?: string, avatar_url?: string, xrPose?: object|null, inXr?: boolean, is_friend?: boolean, project_name?: string }>} */
  const occupants = new Map();
  let ws = null;
  let pollTimer = 0;
  let pingTimer = 0;
  let reconnectTimer = 0;
  let connectionTimer = 0;
  let connectionError = "";
  let joinTask = null;
  let joinGeneration = 0;
  let latestPose = null;
  let latestPoseAt = 0;
  let overlay = overlayEl || null;
  let overlayBuilt = false;
  let importInFlight = "";

  function setStatus(kind, message) {
    const el = overlay?.querySelector("[data-xr-lobby-status]");
    if (el) {
      el.textContent = message || "";
      el.dataset.kind = kind || "";
    }
    try { onStatus?.(kind, message); } catch { /* ignore */ }
  }

  function me() {
    return getCurrentUser?.() || null;
  }

  function occupantList() {
    const selfId = me()?.id;
    return [...occupants.values()].filter((u) => u.id && u.id !== selfId);
  }

  function ensureOverlay() {
    if (overlay && overlayBuilt) return overlay;
    overlay = overlay || document.getElementById("xr-public-lobby");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "xr-public-lobby";
      overlay.className = "xr-public-lobby hidden";
      const host = document.getElementById("viewport") || document.body;
      host.appendChild(overlay);
    }
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Public VR room");
    overlay.innerHTML = `
      <div class="xr-public-lobby-card">
        <header class="xr-public-lobby-head">
          <div>
            <h3 class="xr-public-lobby-title">Public room</h3>
            <p class="xr-public-lobby-sub">Join anyone in VR · import a project · add friends</p>
          </div>
          <span class="xr-public-lobby-count" data-xr-lobby-count>0 here</span>
        </header>
        <label class="xr-public-lobby-field">
          <span>People here</span>
          <select data-xr-lobby-profiles></select>
        </label>
        <div class="xr-public-lobby-row">
          <button type="button" class="btn accent" data-xr-lobby-add-friend>Add friend</button>
          <span class="xr-public-lobby-friend-state" data-xr-lobby-friend-state></span>
        </div>
        <label class="xr-public-lobby-field">
          <span>Import a project</span>
          <select data-xr-lobby-projects></select>
        </label>
        <div class="xr-public-lobby-row">
          <button type="button" class="btn secondary" data-xr-lobby-import>Import</button>
          <button type="button" class="btn accent" data-xr-lobby-drop>Drop into room</button>
        </div>
        <p class="xr-public-lobby-status" data-xr-lobby-status></p>
        <div class="xr-public-lobby-actions">
          <button type="button" class="btn" data-xr-lobby-cancel>Not now</button>
          <button type="button" class="btn accent" data-xr-lobby-signin>Sign in</button>
          <button type="button" class="btn accent" data-xr-lobby-enter>Enter VR</button>
        </div>
      </div>
    `;
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    overlay.querySelector("[data-xr-lobby-cancel]")?.addEventListener("click", (e) => {
      e.preventDefault();
      close();
    });
    overlay.querySelector("[data-xr-lobby-enter]")?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      enterVrFromGesture();
    });
    overlay.querySelector("[data-xr-lobby-signin]")?.addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById("btn-auth")?.click?.();
    });
    overlay.querySelector("[data-xr-lobby-add-friend]")?.addEventListener("click", (e) => {
      e.preventDefault();
      void addSelectedFriend();
    });
    overlay.querySelector("[data-xr-lobby-import]")?.addEventListener("click", (e) => {
      e.preventDefault();
      void importSelectedProject();
    });
    overlay.querySelector("[data-xr-lobby-drop]")?.addEventListener("click", (e) => {
      e.preventDefault();
      void dropSelectedProject();
    });
    overlay.querySelector("[data-xr-lobby-profiles]")?.addEventListener("change", syncFriendButton);
    overlayBuilt = true;
    return overlay;
  }

  function renderCount() {
    const n = Math.max(occupants.size, Number(room.count || 0));
    const el = overlay?.querySelector("[data-xr-lobby-count]");
    if (el) el.textContent = `${n} here`;
  }

  function renderProfiles() {
    const sel = overlay?.querySelector("[data-xr-lobby-profiles]");
    if (!sel) return;
    const prev = sel.value;
    const others = occupantList();
    if (!others.length) {
      sel.innerHTML = `<option value="">No one else here yet</option>`;
      syncFriendButton();
      return;
    }
    sel.innerHTML = others.map((u) => {
      const handle = u.handle ? ` @${String(u.handle).replace(/^@/, "")}` : "";
      const friend = u.is_friend ? " · friend" : "";
      const proj = u.project_name ? ` · ${u.project_name}` : "";
      return `<option value="${esc(u.id)}">${esc(u.display_name || "User")}${esc(handle)}${esc(friend)}${esc(proj)}</option>`;
    }).join("");
    if (prev && others.some((u) => u.id === prev)) sel.value = prev;
    syncFriendButton();
  }

  function renderProjects() {
    const sel = overlay?.querySelector("[data-xr-lobby-projects]");
    if (!sel) return;
    const prev = sel.value;
    let items = [];
    try { items = getProjects?.() || []; } catch { items = []; }
    if (!items.length) {
      sel.innerHTML = `<option value="">No projects yet</option>`;
      return;
    }
    const active = getProjectId?.() || "";
    sel.innerHTML = items.map((p) => {
      const id = p.id || p.project_id || "";
      const label = p.label || p.name || id;
      const here = id && id === active ? " · open" : "";
      return `<option value="${esc(id)}">${esc(label)}${esc(here)}</option>`;
    }).join("");
    if (prev && items.some((p) => (p.id || p.project_id) === prev)) sel.value = prev;
    else if (active) sel.value = active;
  }

  function syncFriendButton() {
    const sel = overlay?.querySelector("[data-xr-lobby-profiles]");
    const btn = overlay?.querySelector("[data-xr-lobby-add-friend]");
    const state = overlay?.querySelector("[data-xr-lobby-friend-state]");
    const uid = sel?.value || "";
    const user = occupants.get(uid);
    const isFriend = !!(user?.is_friend || (room.friend_ids || []).includes(uid));
    if (btn) btn.disabled = !uid || isFriend;
    if (state) state.textContent = !uid ? "" : isFriend ? "Already friends" : "";
  }

  function applyRoom(data) {
    if (!data || typeof data !== "object") return;
    room = data;
    const selfId = me()?.id;
    const seen = new Set();
    for (const u of data.users || []) {
      const id = String(u.id || "");
      if (!id) continue;
      seen.add(id);
      const prev = occupants.get(id) || {};
      occupants.set(id, {
        ...prev,
        ...u,
        id,
        xrPose: prev.xrPose || null,
        inXr: !!(prev.inXr || prev.xrPose),
      });
    }
    if (selfId) {
      const self = me();
      occupants.set(selfId, {
        id: selfId,
        display_name: self.display_name || self.email || "You",
        handle: self.handle,
        avatar_url: self.avatar_url,
        is_self: true,
        xrPose: occupants.get(selfId)?.xrPose || null,
        inXr: !!occupants.get(selfId)?.inXr,
      });
      seen.add(selfId);
    }
    for (const id of [...occupants.keys()]) {
      if (!seen.has(id) && !occupants.get(id)?.xrPose) occupants.delete(id);
    }
    renderCount();
    renderProfiles();
  }

  async function refreshHttp() {
    if (!api || !getToken?.()) return;
    try {
      const data = await api("/api/xr/public-room");
      applyRoom(data);
    } catch (err) {
      setStatus("error", err?.message || "Could not load public room");
    }
  }

  function wsUrl() {
    const token = encodeURIComponent(getToken?.() || "");
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${location.host}/api/ws/xr/public?token=${token}`;
  }

  function handleWsMessage(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "presence.sync") {
      window.clearTimeout(connectionTimer); connectionTimer=0;
      joining=false; joined=true; connectionError="";
      // Re-publish a recent headset sample after every room handshake. Do not
      // resurrect an old VR pose when joining later from the desktop.
      if (latestPose && Date.now() - latestPoseAt < 2500) send({ type: 'xr.pose', pose: latestPose });
      const self=occupants.get(me()?.id);occupants.clear();if(self)occupants.set(self.id,self);
      setStatus("ok", "Connected to public room");
      for (const u of msg.users || []) {
        if (!u?.id) continue;
        const prev = occupants.get(u.id) || {};
        occupants.set(u.id, { ...prev, ...u, id: u.id });
        if (u.xrPose) {
          try {
            onXrPose?.({
              type: "xr.pose",
              user_id: u.id,
              display_name: u.display_name,
              color: u.color,
              avatar_url: u.avatar_url,
              xr_device: u.xr_device || u.xrPose?.xr_device,
              xr_mode: u.xr_mode || u.xrPose?.xr_mode,
              xr_prop: u.xr_prop || u.xrPose?.xr_prop,
              pose: u.xrPose,
            });
          } catch { /* ignore */ }
        }
      }
      renderCount();
      renderProfiles();
      try { onJoined?.({ users: msg.users || [] }); } catch { /* ignore */ }
      return;
    }
    if (msg.type === "presence.join" && msg.user?.id) {
      const prev = occupants.get(msg.user.id) || {};
      occupants.set(msg.user.id, { ...prev, ...msg.user });
      renderCount();
      renderProfiles();
      return;
    }
    if (msg.type === "presence.leave" && msg.user_id) {
      occupants.delete(msg.user_id);
      renderCount();
      renderProfiles();
      return;
    }
    if (msg.type === "rtc.signal") {
      try { onRtcSignal?.(msg); } catch { /* ignore */ }
      return;
    }
    if (msg.type === "xr.stroke") {
      try { onStroke?.(msg); } catch { /* ignore */ }
      return;
    }
    if (msg.type === "xr.draw") {
      try { onDraw?.(msg); } catch { /* ignore */ }
      return;
    }
    if (msg.type === "xr.file") {
      try { onFile?.(msg); } catch { /* ignore */ }
      return;
    }
    if (msg.type === "xr.prompt.bridge") {
      try { onPromptBridge?.(msg); } catch { /* ignore */ }
      return;
    }
    if (msg.type === "xr.pose" && msg.user_id) {
      const prev = occupants.get(msg.user_id) || {
        id: msg.user_id,
        display_name: msg.display_name || "User",
        color: msg.color,
        avatar_url: msg.avatar_url,
      };
      occupants.set(msg.user_id, {
        ...prev,
        xrPose: msg.pose || null,
        inXr: true,
        color: msg.color || prev.color,
        xr_device: msg.xr_device || msg.pose?.xr_device || prev.xr_device,
        xr_mode: msg.xr_mode || msg.pose?.xr_mode || prev.xr_mode,
        xr_prop: msg.xr_prop || msg.pose?.xr_prop || prev.xr_prop,
      });
      try { onXrPose?.(msg); } catch { /* ignore */ }
      return;
    }
    if (
      msg.type === "xr.drop" || msg.type === "xr.object" || msg.type === "xr.objects.sync"
      || msg.type === "xr.fit" || msg.type === "xr.video"
      || msg.type === "xr.board" || msg.type === "xr.table" || msg.type === "xr.seat"
    ) {
      try { onPublicObject?.(msg); } catch { /* ignore */ }
      if (msg.type === "xr.drop" && open) {
        const who = msg.display_name || "Someone";
        const pname = msg.project_name || "a project";
        const verb = msg.kind === "import" ? "imported" : "dropped";
        setStatus("ok", `${who} ${verb} ${pname} into the room`);
      }
      return;
    }
    if (msg.type === "project.share.invite") {
      const selfId = me()?.id;
      if ((msg.user_id && selfId && msg.user_id === selfId)
        || (msg.by_user_id && selfId && msg.by_user_id === selfId)) {
        return;
      }
      try { onShareInvite?.(msg); } catch { /* ignore */ }
      return;
    }
    if (msg.type === "project.announce" && msg.user_id) {
      const prev = occupants.get(msg.user_id);
      if (prev) {
        occupants.set(msg.user_id, {
          ...prev,
          project_id: msg.project_id,
          project_name: msg.project_name,
        });
        renderProfiles();
      }
      const who = msg.display_name || "Someone";
      const pname = msg.project_name || "a project";
      if (open) setStatus("ok", `${who} imported ${pname}`);
      // Shared GLB drops carry their own access link. A peer's announcement
      // must not replace this user's project or request private project access.
    }
  }

  function startJoinPoll() {
    window.clearInterval(pollTimer);
    pollTimer = window.setInterval(() => {
      if (wantedJoin) {
        void refreshHttp();
        if (open) renderProjects();
      }
    }, 8000);
  }

  function connectWs() {
    const token = getToken?.();
    if (!token || joining) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    joining = true;
    connectionError="";
    try {
      ws = new WebSocket(wsUrl());
    } catch (err) {
      joining = false; wantedJoin=false;
      connectionError=err?.message || "Could not join public room";
      setStatus("error", connectionError);
      return;
    }
    const socket = ws;
    const fail = message => {
      if(ws!==socket)return;
      window.clearTimeout(connectionTimer);connectionTimer=0;
      joining=false;joined=false;ws=null;stopPing();connectionError=message;
      try{socket.close();}catch{}
      setStatus('error',message);
      if(joinTask)wantedJoin=false;
      else if(wantedJoin)scheduleReconnect();
    };
    connectionTimer=window.setTimeout(()=>fail('Public room timed out. Click Join to retry.'),8000);
    socket.addEventListener("open", () => {
      if(ws!==socket||!wantedJoin)return;
      const self = me();
      if (self?.id) {
        occupants.set(self.id, {
          id: self.id,
          display_name: self.display_name || self.email || "You",
          handle: self.handle,
          avatar_url: self.avatar_url,
          is_self: true,
        });
      }
      renderCount();
      startPing();
    });
    socket.addEventListener("message", (ev) => {
      if(ws!==socket||!wantedJoin)return;
      try {
        handleWsMessage(JSON.parse(ev.data));
      } catch { /* ignore */ }
    });
    socket.addEventListener("close", (event) => {
      if (ws !== socket) return;
      window.clearTimeout(connectionTimer);connectionTimer=0;
      joining = false; joined = false; ws = null; stopPing();
      if (event.code === 4409) {
        wantedJoin = false;
        connectionError="Public room opened on another device. Click Join to use this one.";
      } else if (event.code === 4401 || event.code === 4403) {
        wantedJoin = false;connectionError="Sign in again to join the public room.";
      } else if(joinTask){wantedJoin=false;connectionError='Public room could not connect. Click Join to retry.';}
      else if (wantedJoin) {connectionError="Room disconnected — reconnecting…"; scheduleReconnect();}
      if(connectionError)setStatus('error',connectionError);
    });
    socket.addEventListener("error", () => fail('Public room connection failed. Click Join to retry.'));
  }

  function startPing() {
    stopPing();
    pingTimer = window.setInterval(() => {
      send({ type: "ping", project_id: getProjectId?.() || undefined });
    }, 15000);
  }

  function stopPing() {
    window.clearInterval(pingTimer);
    pingTimer = 0;
  }

  function scheduleReconnect() {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer=0;
      if (wantedJoin) connectWs();
    }, 1200);
  }

  function disconnectWs() {
    joinGeneration++;joinTask=null;
    wantedJoin = false; joined = false;
    window.clearTimeout(reconnectTimer);
    reconnectTimer=0;window.clearTimeout(connectionTimer);connectionTimer=0;
    stopPing();
    joining = false;
    const sock = ws;
    ws = null;
    try { sock?.close(); } catch { /* ignore */ }
    occupants.clear();
    room = { count: 0, users: [], friend_ids: room.friend_ids || [] };
    if (!open) {
      window.clearInterval(pollTimer);
      pollTimer = 0;
    }
    renderCount();
    renderProfiles();
  }

  function send(payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(JSON.stringify(payload));
      return true;
    } catch {
      return false;
    }
  }

  function sendPose(pose) {
    if (!pose) return;
    latestPose = pose;
    latestPoseAt = Date.now();
    if (joined) send({ type: "xr.pose", pose });
  }

  async function addFriend(userId) {
    const uid = String(userId || "").trim();
    if (!uid) return { ok: false, error: "Pick someone" };
    const selfId = me()?.id;
    if (selfId && uid === selfId) return { ok: false, error: "That's you" };
    const existing = occupants.get(uid);
    if (existing?.is_friend || (room.friend_ids || []).includes(uid)) {
      return { ok: true, message: "Already friends" };
    }
    try {
      await api("/api/social/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: uid }),
      });
      if (existing) occupants.set(uid, { ...existing, is_friend: true });
      room.friend_ids = [...new Set([...(room.friend_ids || []), uid])];
      syncFriendButton();
      renderProfiles();
      return { ok: true, message: `Added ${existing?.display_name || "friend"}` };
    } catch (err) {
      return { ok: false, error: err?.message || "Could not add friend" };
    }
  }

  async function addSelectedFriend() {
    const uid = overlay?.querySelector("[data-xr-lobby-profiles]")?.value || "";
    const res = await addFriend(uid);
    setStatus(res.ok ? "ok" : "error", res.message || res.error || "");
    return res;
  }

  function projectName(id) {
    const items = getProjects?.() || [];
    const hit = items.find((p) => (p.id || p.project_id) === id);
    return hit?.label || hit?.name || "project";
  }

  async function importProject(id, { announce = true } = {}) {
    const pid = String(id || "").trim();
    if (!pid) return { ok: false, error: "No project" };
    if (importInFlight === pid) return { ok: true, skipped: true };
    if (announce && onDropProject) {
      importInFlight = pid;
      try {
        const result = await onDropProject(pid);
        setStatus(result?.ok === false ? 'error' : 'ok', result?.message || result?.error || 'Shared model loaded');
        return result || {ok:true};
      } catch (err) {
        setStatus('error',err?.message || 'Could not share model');
        return {ok:false,error:err?.message || 'Could not share model'};
      } finally { importInFlight = ''; }
    }
    const same = String(getProjectId?.() || "") === pid;
    if (same && announce) {
      send({ type: "project.announce", project_id: pid, project_name: projectName(pid) });
      return { ok: true, skipped: true };
    }
    importInFlight = pid;
    try {
      if (announce) {
        wantedJoin = true;
        connectWs();
        startJoinPoll();
        try { await waitForOpen(3500); } catch { /* ignore */ }
      }
      await onImportProject?.(pid);
      const name = projectName(pid);
      if (announce) send({ type: "project.announce", project_id: pid, project_name: name });
      setStatus("ok", `Imported ${name}`);
      renderProjects();
      return { ok: true, message: `Loaded ${name}` };
    } catch (err) {
      setStatus("error", err?.message || "Could not import project");
      return { ok: false, error: err?.message || "Could not import project" };
    } finally {
      if (importInFlight === pid) importInFlight = "";
    }
  }

  async function importSelectedProject() {
    const id = overlay?.querySelector("[data-xr-lobby-projects]")?.value || "";
    if (!id) {
      setStatus("error", "Pick a project to import");
      return;
    }
    return importProject(id, { announce: true });
  }

  async function dropSelectedProject() {
    const id = overlay?.querySelector("[data-xr-lobby-projects]")?.value || "";
    if (!id) {
      setStatus("error", "Pick a project to drop");
      return;
    }
    wantedJoin = true;
    connectWs();
    startJoinPoll();
    try {
      await onDropProject?.(id);
      const items = getProjects?.() || [];
      const hit = items.find((p) => (p.id || p.project_id) === id);
      setStatus("ok", `Dropped ${hit?.label || hit?.name || "project"} — both of you can pick it up`);
    } catch (err) {
      setStatus("error", err?.message || "Could not drop project");
    }
  }

  function enterVrFromGesture() {
    if (!getToken?.()) {
      setStatus("error", "Sign in to join the public room");
      document.getElementById("btn-auth")?.click?.();
      return;
    }
    close({ keepPresence: true });
    try {
      const maybe = onEnterVr?.();
      Promise.resolve(maybe).catch((err) => {
        setStatus("error", err?.message || "Could not start VR");
        openLobby();
      });
    } catch (err) {
      setStatus("error", err?.message || "Could not start VR");
      openLobby();
    }
  }

  function syncSignedInChrome() {
    const signedIn = !!getToken?.();
    overlay?.querySelector("[data-xr-lobby-enter]")?.classList.toggle("hidden", !signedIn);
    overlay?.querySelector("[data-xr-lobby-signin]")?.classList.toggle("hidden", signedIn);
    overlay?.querySelector("[data-xr-lobby-add-friend]")?.toggleAttribute("disabled", !signedIn);
    overlay?.querySelector("[data-xr-lobby-import]")?.toggleAttribute("disabled", !signedIn);
    overlay?.querySelector("[data-xr-lobby-drop]")?.toggleAttribute("disabled", !signedIn);
  }

  function openLobby() {
    ensureOverlay();
    open = true;
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("xr-public-lobby-open");
    renderProjects();
    renderCount();
    renderProfiles();
    syncSignedInChrome();
    if (!getToken?.()) {
      setStatus("error", "Sign in to join the public room");
      return;
    }
    wantedJoin = true;
    void refreshHttp();
    connectWs();
    startJoinPoll();
    setStatus("ok", "Connecting to public room…");
  }

  function close({ keepPresence = false } = {}) {
    open = false;
    overlay?.classList.add("hidden");
    overlay?.setAttribute("aria-hidden", "true");
    document.body.classList.remove("xr-public-lobby-open");
    if (!keepPresence) {
      window.clearInterval(pollTimer);
      pollTimer = 0;
      disconnectWs();
    }
  }

  function waitForOpen(timeoutMs = 3500) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        if (joined && ws && ws.readyState === WebSocket.OPEN) {
          resolve(true);
          return;
        }
        if(!wantedJoin){resolve(false);return;}
        if (Date.now() - t0 > timeoutMs) {
          resolve(false);
          return;
        }
        window.setTimeout(tick, 80);
      };
      tick();
    });
  }

  function getSocialUsers() {
    const selfId = me()?.id;
    return occupantList()
      .filter((u) => u.id !== selfId)
      .map((u) => ({
        id: u.id,
        display_name: u.display_name || "User",
        handle: u.handle || null,
        color: u.color || "#58a6ff",
        avatar_url: u.avatar_url || null,
        pickCount: 0,
        xrPose: u.xrPose || null,
        inXr: !!u.inXr,
        xr_device: u.xr_device || u.xrDevice || u.xrPose?.xr_device || null,
        xr_mode: u.xr_mode || u.xrMode || u.xrPose?.xr_mode || null,
        xr_prop: u.xr_prop || u.xrPose?.xr_prop || null,
        is_friend: !!u.is_friend,
        fromPublicRoom: true,
      }));
  }

  return {
    open: openLobby,
    close,
    join: () => {
      if (!getToken?.()) return {ok:false,error:"Sign in to join the public room"};
      if(joined&&ws?.readyState===WebSocket.OPEN)return Promise.resolve({ok:true,message:'Connected to public room'});
      if(joinTask)return joinTask;
      const generation=++joinGeneration;
      wantedJoin = true;
      setStatus('ok','Connecting to public room…');
      void refreshHttp();
      connectWs();
      startJoinPoll();
      const task=waitForOpen(8200).then(ok=>{
        if(generation!==joinGeneration)return {ok:false,cancelled:true,message:'Room join cancelled'};
        if(ok)return {ok:true,message:"Connected to public room"};
        const error=connectionError||'Public room timed out. Click Join to retry.';
        disconnectWs();setStatus('error',error);
        return {ok:false,error};
      }).finally(()=>{if(joinTask===task)joinTask=null;});
      joinTask=task;return task;
    },
    leave: () => disconnectWs(),
    isOpen: () => open,
    isJoined: () => joined,
    isJoining: () => joining || !!(wantedJoin&&!joined&&reconnectTimer),
    getConnectionError: () => connectionError,
    sendPose,
    send: (payload) => send(payload),
    whenOpen: (timeoutMs = 3500) => waitForOpen(timeoutMs),
    addFriend,
    importProject,
    getOccupants: () => getSocialUsers(),
    getCount: () => Math.max(occupants.size, Number(room.count || 0)),
    getFriendIds: () => room.friend_ids || [],
    refresh: refreshHttp,
  };
}
