/**
 * Quest-safe collab / nametag / Shot rules. Testable without WebXR or two headsets.
 */

export const XR_ROOM_RELAY_TYPES = ["xr.pose", "xr.stroke", "xr.file", "xr.prompt.bridge", "xr.fit", "xr.draw", "xr.video", "xr.window", "xr.board", "xr.table", "xr.seat", "xr.drop", "xr.object", "xr.printer", "rtc.signal"];
export const XR_COLLAB_SPACE_KEY = "render3d:xr-collab-space";

export function normalizeXrCollabSpace(value) {
  return String(value || "").trim().toLowerCase() === "local" ? "local" : "shared";
}

export function readXrCollabSpace(storage = null) {
  try {
    const raw = (storage || (typeof localStorage !== "undefined" ? localStorage : null))?.getItem?.(XR_COLLAB_SPACE_KEY);
    return normalizeXrCollabSpace(raw);
  } catch {
    return "shared";
  }
}

export function writeXrCollabSpace(value, storage = null) {
  const next = normalizeXrCollabSpace(value);
  try {
    (storage || (typeof localStorage !== "undefined" ? localStorage : null))?.setItem?.(XR_COLLAB_SPACE_KEY, next);
  } catch { /* ignore */ }
  return next;
}

export function remoteHeldAffectsLocalMesh({ localSpace = "shared", remoteSpace = "shared", grabbingLocal = false } = {}) {
  if (grabbingLocal) return false;
  if (normalizeXrCollabSpace(localSpace) === "local") return false;
  return normalizeXrCollabSpace(remoteSpace) === "shared";
}

export function remoteHeldShowsGhost({ remoteSpace = "shared", hasHeldPose = false } = {}) {
  if (!hasHeldPose) return false;
  return normalizeXrCollabSpace(remoteSpace) === "local";
}

export function presenceSyncPoseMessages(users = []) {
  const out = [];
  for (const u of users || []) {
    const pose = u?.xrPose || u?.xr_pose || u?.pose;
    const id = String(u?.id || u?.user_id || "").trim();
    if (!id || !pose) continue;
    out.push({
      type: "xr.pose",
      user_id: id,
      display_name: u.display_name,
      color: u.color,
      pose,
    });
  }
  return out;
}

export function relayRecipientIds(peerIds = [], senderId = "", targetUserId = "") {
  const sender = String(senderId || "").trim();
  const others = (peerIds || []).map((id) => String(id || "").trim()).filter((id) => id && id !== sender);
  const target = String(targetUserId || "").trim();
  if (target) return others.includes(target) ? [target] : [];
  return others;
}

export function twoPeerRoom(a = "user-a", b = "user-b") {
  return [String(a), String(b)];
}

export function socialActionApi(action) {
  const raw = String(action || "");
  if (raw === "mute") return { localOnly: true, path: null };
  if (raw.startsWith("profile:")) {
    return { method: "GET", path: `/api/users/${raw.slice(8)}/profile` };
  }
  if (raw.startsWith("meetslot:")) {
    const rest = raw.slice(9);
    const [userId, startsAt, endsAt] = rest.split("|");
    if (!userId) return { method: null, path: null };
    return {
      method: "POST",
      path: `/api/users/${userId}/meeting-request`,
      body: {
        channel: "calendar",
        send_email: true,
        starts_at: startsAt || undefined,
        ends_at: endsAt || undefined,
      },
    };
  }
  if (raw.startsWith("meet:")) {
    const userId = raw.slice(5);
    if (!userId) return { method: null, path: null };
    return {
      method: "POST",
      path: `/api/users/${userId}/meeting-request`,
      body: { channel: "calendar", send_email: true, proposed_time: "Next available" },
    };
  }
  if (raw.startsWith("user:")) {
    return { method: "POST", path: "/api/social/friends", body: { user_id: raw.slice(5) } };
  }
  if (raw.startsWith("file:")) {
    return { method: "POST", path: "/api/social/send-file", body: { user_id: raw.slice(5) } };
  }
  if (raw.startsWith("message:")) {
    return { method: "POST", path: "/api/social/invite", body: { user_id: raw.slice(8) } };
  }
  return { method: null, path: null };
}

export function nametagSocialActions() {
  return ["profile", "friend", "file", "message", "meet", "mute"];
}

export function nametagActionKeys(userId) {
  const id = String(userId || "").trim();
  if (!id) return null;
  return {
    profile: `profile:${id}`,
    friend: `user:${id}`,
    file: `file:${id}`,
    message: `message:${id}`,
    meet: `meet:${id}`,
    mute: "mute",
  };
}

export function resolveXrSendFilename({ selectedFile, files = [], latestFile = "" } = {}) {
  const pick = (name) => String(name || "").trim();
  const selected = pick(selectedFile);
  if (selected && !selected.startsWith("__")) return selected;
  const latest = pick(latestFile);
  if (latest && !latest.startsWith("__")) return latest;
  const names = (files || []).map((f) => pick(f?.name || f?.filename || f)).filter(Boolean);
  const preferred = names.find((n) => /\.(glb|gltf|step|stp|stl|3mf|png|pdf)$/i.test(n));
  return preferred || names[0] || "";
}

export function publicLobbyRelayTypes() {
  return ["xr.pose", "xr.stroke", "xr.file", "xr.prompt.bridge", "xr.fit", "xr.draw", "xr.video", "xr.window", "xr.board", "xr.table", "xr.seat", "xr.drop", "xr.object", "xr.printer", "rtc.signal"];
}

export function wheelBuildToolIds() {
  return [
    "create_wall",
    "create_floor",
    "wall_height",
    "snap",
    "symmetry",
    "combine",
    "revolve",
    "loft",
    "scale",
    "duplicate",
    "stamp",
    "array",
    "slice",
    "mirror",
    "layer",
    "undo",
  ];
}

export function shotDockToolIds() {
  return ["screenshot", "shot_send_pc", "shot_share_x"];
}

export function xrCaptureOpensPcViewer({ presenting = false, publishedReady = false } = {}) {
  if (presenting) return false;
  return !!publishedReady;
}

/** Same endpoints as laptop Share (project-share.js). */
export function studioAccessActionApi(action = {}, projectId = "") {
  const id = String(projectId || action.project_id || "").trim();
  const type = String(action.type || "");
  if (type === "move_workspace") {
    const teamId = String(action.team_id || "").trim();
    if (!id || !teamId) return { method: null, path: null };
    return {
      method: "PATCH",
      path: `/api/projects/${id}/workspace`,
      body: { team_id: teamId },
    };
  }
  if (type === "unshare") {
    const userId = String(action.user_id || "").trim();
    if (!id || !userId) return { method: null, path: null };
    return {
      method: "DELETE",
      path: `/api/projects/${id}/shares/${userId}`,
    };
  }
  if (type === "share_invite") {
    if (!id) return { method: null, path: null, opensLaptopShare: true };
    const email = String(action.email || "").trim();
    if (email) {
      return {
        method: "POST",
        path: `/api/projects/${id}/shares`,
        body: { email },
        opensLaptopShare: true,
      };
    }
    return { method: null, path: null, opensLaptopShare: true };
  }
  return { method: null, path: null };
}
