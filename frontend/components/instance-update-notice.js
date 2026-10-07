export function mountInstanceUpdateNotice({ api, documentRef = document, storage = window.localStorage } = {}) {
  if (typeof api !== "function") return;
  api("/api/setup/instance-updates/check").then((data) => {
    const release = data?.available ? data.release : null;
    if (!release?.commit_sha || storage?.getItem?.("render3d:dismissed-update") === release.commit_sha) return;
    const clean = (value) => String(value || "").replace(/[<>&]/g, "");
    const notice = documentRef.createElement("aside");
    notice.className = "instance-update-notice";
    notice.setAttribute("role", "dialog");
    notice.innerHTML = `<strong>Render ${clean(release.version || "update")} is available</strong><span>${clean(release.notes || "Install when you are ready.")} Your projects and instance data stay in place.</span><div><button type="button" data-update-later>Later</button><a href="/setup-instance.html#setup-updates-card">Review safe update</a></div>`;
    notice.querySelector("[data-update-later]")?.addEventListener("click", () => {
      storage?.setItem?.("render3d:dismissed-update", release.commit_sha);
      notice.remove();
    });
    documentRef.body.appendChild(notice);
  }).catch(() => {});

  api("/api/setup/instance-announcements").then((data) => {
    const announcement = (data?.announcements || []).find((item) => item?.id && storage?.getItem?.(`render3d:dismissed-announcement:${item.id}`) !== "1");
    if (!announcement) return;
    const notice = documentRef.createElement("aside");
    notice.className = `instance-update-notice instance-announcement instance-announcement--${announcement.kind || "whats_new"}`;
    notice.setAttribute("role", "dialog");
    notice.setAttribute("aria-label", announcement.title || "Render announcement");
    const eyebrow = documentRef.createElement("small");
    eyebrow.textContent = announcement.kind === "update" ? "Render update" : announcement.kind === "suggestion" ? "Render suggestion" : "What’s new";
    const title = documentRef.createElement("strong");
    title.textContent = String(announcement.title || "Render announcement");
    const message = documentRef.createElement("span");
    message.textContent = String(announcement.message || "");
    const actions = documentRef.createElement("div");
    const dismiss = documentRef.createElement("button");
    dismiss.type = "button";
    dismiss.textContent = "Dismiss";
    dismiss.addEventListener("click", () => {
      storage?.setItem?.(`render3d:dismissed-announcement:${announcement.id}`, "1");
      notice.remove();
    });
    actions.appendChild(dismiss);
    if (announcement.action_url && announcement.action_label) {
      const action = documentRef.createElement("a");
      action.href = announcement.action_url;
      action.textContent = announcement.action_label;
      actions.appendChild(action);
    }
    notice.append(eyebrow, title, message, actions);
    documentRef.body.appendChild(notice);
  }).catch(() => {});
}
