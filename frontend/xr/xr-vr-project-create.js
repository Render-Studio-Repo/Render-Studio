/** VR HUD: name a new project, then optionally share it with people in the room. */

export const XR_VRPROJ1_CACHE = "vrproj1";

export function sanitizeProjectName(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function roomOthersForShare(users, meId) {
  const me = String(meId || "").trim();
  const seen = new Set();
  const out = [];
  for (const user of users || []) {
    const id = String(user?.id || "").trim();
    if (!id || (me && id === me) || seen.has(id)) continue;
    seen.add(id);
    out.push(user);
  }
  return out;
}

export function shouldAskShareWithRoom(others) {
  return Array.isArray(others) && others.length > 0;
}

export function workspaceCreatePromptLines({ name = "", shareAsk = false, othersCount = 0 } = {}) {
  if (shareAsk) {
    void othersCount;
    return [
      { id: "", label: "Share with people in this room?", kind: "hint", icon: "social" },
      { id: "ws-create-share-yes", label: "Yes", kind: "action", icon: "social" },
      { id: "ws-create-share-no", label: "No", kind: "action", icon: "workspace" },
    ];
  }
  const label = sanitizeProjectName(name);
  return [
    { id: "ws-create-name", label: label || "Type a name", kind: "field", icon: "workspace" },
    { id: "ws-create-go", label: "Create project", kind: "action", icon: "plus" },
    { id: "ws-create-cancel", label: "Cancel", kind: "action", icon: "undo" },
  ];
}

export function finishWorkspaceCreateName({ name, others } = {}) {
  const label = sanitizeProjectName(name);
  if (shouldAskShareWithRoom(others)) {
    return { name: label, shareAsk: true, create: false, shareRoom: false };
  }
  return { name: label, shareAsk: false, create: true, shareRoom: false };
}

export function workspaceCreateSharePayload({ name, shareRoom, users } = {}) {
  return {
    name: sanitizeProjectName(name),
    shareRoom: !!shareRoom,
    role: "editor",
    users: roomOthersForShare(users, ""),
  };
}
