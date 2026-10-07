/** Slack / Discord share — reuse the existing public preview URL (no re-export). */

export function formatSocialShareMessage({ title, url } = {}) {
  const name = String(title || "Render Studio").replace(/\s+/g, " ").trim() || "Render Studio";
  const shareUrl = String(url || "").trim();
  return shareUrl ? `${name}\n${shareUrl}` : name;
}

export function slackShareHref({ url, title } = {}) {
  const params = new URLSearchParams();
  const shareUrl = String(url || "").trim();
  if (shareUrl) params.set("url", shareUrl);
  const text = String(title || "").trim();
  if (text) params.set("text", text);
  return `https://slack.com/share?${params.toString()}`;
}

export function discordOpenHref() {
  return "https://discord.com/channels/@me";
}

export function discordDesktopHref(opts = {}) {
  const guild = String(opts.guildId || "").trim();
  const channel = String(opts.channelId || "").trim();
  const userId = String(opts.userId || "").trim();
  if (guild && channel) return `discord://-/channels/${guild}/${channel}`;
  if (channel) return `discord://-/channels/@me/${channel}`;
  if (userId) return `discord://-/users/${userId}`;
  return "discord://-/channels/@me";
}

function launchDiscordProtocol(desktop, doc) {
  if (!doc?.body || !desktop) return;
  try {
    const iframe = doc.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.cssText = "position:fixed;width:0;height:0;border:0;opacity:0;pointer-events:none";
    iframe.src = desktop;
    doc.body.appendChild(iframe);
    setTimeout(() => iframe.remove(), 1600);
  } catch {
    /* ignore */
  }
}

/** Open Discord in the desktop app when installed, then fall back to discord.com. */
export function openDiscord(opts = {}) {
  const web = discordOpenHref();
  const desktop = discordDesktopHref(opts);
  const doc = opts.documentRef || (typeof document !== "undefined" ? document : null);
  if (opts.skipDesktop !== true) launchDiscordProtocol(desktop, doc);
  if (opts.skipWeb === true) return { method: "desktop", href: desktop };
  return openExternalShareTab(web, opts.openWindow);
}

/** Ask, then open the Discord app via protocol — no extra web tab. */
export function confirmOpenDiscordApp(opts = {}) {
  const message = opts.message || "Open the Discord app to share this clip?";
  if (opts.confirm !== false) {
    const ask = opts.confirmFn || (typeof window !== "undefined" ? window.confirm.bind(window) : null);
    if (ask && !ask(message)) return { ok: false, href: "" };
  }
  const href = discordDesktopHref(opts);
  const doc = opts.documentRef || (typeof document !== "undefined" ? document : null);
  launchDiscordProtocol(href, doc);
  return { ok: true, href };
}

export async function copyShareText(text, { clipboard, documentRef } = {}) {
  const value = String(text || "");
  if (!value) throw new Error("Nothing to copy.");
  const nav = clipboard || (typeof navigator !== "undefined" ? navigator.clipboard : null);
  const secure = typeof window === "undefined" ? true : !!window.isSecureContext;
  if (nav?.writeText && secure) {
    try {
      await nav.writeText(value);
      return true;
    } catch {
      /* fall through to execCommand */
    }
  }
  const doc = documentRef || (typeof document !== "undefined" ? document : null);
  if (!doc?.body) throw new Error("Clipboard copy was blocked on this device.");
  const ta = doc.createElement("textarea");
  ta.value = value;
  ta.setAttribute("readonly", "");
  ta.setAttribute("aria-hidden", "true");
  ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;padding:0;margin:0;border:0;opacity:0;";
  doc.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, value.length);
  let ok = false;
  try {
    ok = doc.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  if (!ok) throw new Error("Clipboard copy was blocked on this device.");
  return true;
}

export function notifyShareStatus(kind, text) {
  const el = typeof document !== "undefined" ? document.getElementById("edit-status") : null;
  if (!el) return;
  el.className = `status ${kind || ""}`.trim();
  el.textContent = text || "";
}

/** Open X / Discord / Slack in a new tab. Never navigate the Studio tab. */
export function openExternalShareTab(href, openWindow) {
  const url = String(href || "").trim();
  if (!url) return null;
  const open = openWindow || ((target) => {
    if (typeof window === "undefined") return null;
    try {
      return window.open(target, "_blank", "noopener,noreferrer");
    } catch {
      return null;
    }
  });
  return open(url);
}

function openShareWindow(href, openWindow) {
  return openExternalShareTab(href, openWindow);
}

export async function shareToSlack(url, opts = {}) {
  const shareUrl = String(url || "").trim();
  const title = String(opts.title || "Render Studio share").replace(/\s+/g, " ").trim() || "Render Studio share";
  if (!shareUrl) throw new Error("No share link to send.");
  const message = formatSocialShareMessage({ title, url: shareUrl });
  await copyShareText(message, opts);
  const href = slackShareHref({ url: shareUrl, title });
  openShareWindow(href, opts.openWindow);
  return { method: "slack", href, message };
}

export async function shareToDiscord(url, opts = {}) {
  const shareUrl = String(url || "").trim();
  const title = String(opts.title || "Render Studio share").replace(/\s+/g, " ").trim() || "Render Studio share";
  if (!shareUrl) throw new Error("No share link to send.");
  const message = formatSocialShareMessage({ title, url: shareUrl });
  await copyShareText(message, opts);
  const href = discordOpenHref();
  openDiscord({ ...opts, skipDesktop: opts.skipDesktop });
  return { method: "discord", href, message };
}
