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
}
