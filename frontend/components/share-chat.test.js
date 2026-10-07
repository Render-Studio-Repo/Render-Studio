import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  discordOpenHref,
  discordDesktopHref,
  confirmOpenDiscordApp,
  formatSocialShareMessage,
  openExternalShareTab,
  shareToDiscord,
  shareToSlack,
  slackShareHref,
} from "./share-chat.js";

const here = dirname(fileURLToPath(import.meta.url));
const shareChat = readFileSync(join(here, "./share-chat.js"), "utf8");
const fileActions = readFileSync(join(here, "./file-actions.js"), "utf8");
const referenceFiles = readFileSync(join(here, "./reference-files.js"), "utf8");
const projectTree = readFileSync(join(here, "./project-tree.js"), "utf8");
const workspaceBrowser = readFileSync(join(here, "../workspace/workspace-browser.js"), "utf8");
const projectShare = readFileSync(join(here, "../social/project-share.js"), "utf8");
const screenshotMarkup = readFileSync(join(here, "../viewport/screenshot-markup.js"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");

test("Slack and Discord helpers format the existing share URL without inventing a webhook", () => {
  const title = "Bracket assembly";
  const url = "https://render3d.app/share/abc123";
  assert.equal(formatSocialShareMessage({ title, url }), `${title}\n${url}`);
  const slack = slackShareHref({ title, url });
  assert.match(slack, /^https:\/\/slack\.com\/share\?/);
  assert.match(slack, /url=https%3A%2F%2Frender3d\.app%2Fshare%2Fabc123/);
  assert.match(slack, /text=Bracket(\+|%20)assembly/);
  assert.equal(discordOpenHref(), "https://discord.com/channels/@me");
  assert.equal(discordDesktopHref(), "discord://-/channels/@me");
  assert.equal(discordDesktopHref({ guildId: "1", channelId: "2" }), "discord://-/channels/1/2");
  assert.equal(discordDesktopHref({ channelId: "2" }), "discord://-/channels/@me/2");
  assert.equal(discordDesktopHref({ userId: "9" }), "discord://-/users/9");
  assert.equal(fileActions.includes("hooks.slack.com"), false);
  assert.equal(fileActions.includes("discord.com/api/webhooks"), false);
  assert.equal(projectShare.includes("hooks.slack.com"), false);
});

test("shareToSlack copies the message and opens Slack share with the same URL", async () => {
  const copied = [];
  const opened = [];
  const result = await shareToSlack("https://render3d.app/share/tok", {
    title: "Demo part",
    clipboard: { writeText: async (text) => { copied.push(text); } },
    openWindow: (href) => { opened.push(href); return { ok: true }; },
  });
  assert.equal(copied[0], "Demo part\nhttps://render3d.app/share/tok");
  assert.equal(result.method, "slack");
  assert.equal(opened[0], result.href);
  assert.match(opened[0], /^https:\/\/slack\.com\/share\?/);
  await assert.rejects(
    () => shareToSlack("", { clipboard: { writeText: async () => {} }, openWindow: () => null }),
    /No share link/,
  );
});

test("shareToDiscord copies the message and opens Discord DMs", async () => {
  const copied = [];
  const opened = [];
  const result = await shareToDiscord("https://render3d.app/share/tok", {
    title: "Demo part",
    clipboard: { writeText: async (text) => { copied.push(text); } },
    openWindow: (href) => { opened.push(href); return { ok: true }; },
  });
  assert.equal(copied[0], "Demo part\nhttps://render3d.app/share/tok");
  assert.equal(result.href, "https://discord.com/channels/@me");
  assert.equal(opened[0], result.href);
});

test("export share bar copies the link with view/remix/edit; Slack and Discord stay on other menus", () => {
  assert.equal(fileActions.includes("share-chat.js"), false);
  assert.equal(fileActions.includes("file-export-share-slack"), false);
  assert.equal(fileActions.includes("file-export-share-discord"), false);
  assert.equal(fileActions.includes("Share to Slack"), false);
  assert.equal(fileActions.includes("Share to Discord"), false);
  assert.equal(fileActions.includes("Message copied — Discord is open. Paste in a channel."), false);
  assert.match(fileActions, /preparedShareUrl/);
  assert.match(fileActions, /file-export-share-gear/);
  assert.match(fileActions, /share-fx-btn/);
  assert.match(fileActions, /View only/);
  assert.match(fileActions, /Remix only/);
  assert.match(fileActions, /Remix and edit/);
  assert.match(fileActions, /Anyone can join this project/);
  assert.match(fileActions, /Join-project link/);
  assert.match(fileActions, /patchShareSettings/);
  assert.match(fileActions, /Copy share link/);
  assert.match(fileActions, /Share to workspace/);

  const refMenu = referenceFiles.slice(
    referenceFiles.indexOf("function showReferenceContextMenu"),
    referenceFiles.indexOf("async function handleDownload"),
  );
  assert.match(refMenu, /data-ref-context="share-x"/);
  assert.match(refMenu, /data-ref-context="share-slack"/);
  assert.match(refMenu, /data-ref-context="share-discord"/);

  assert.match(projectTree, /action: "share-slack"/);
  assert.match(projectTree, /action: "share-discord"/);
  assert.match(projectTree, /Share to Slack/);
  assert.match(projectTree, /Share to Discord/);

  assert.match(workspaceBrowser, /data-action="share-slack"/);
  assert.match(workspaceBrowser, /data-action="share-discord"/);
  assert.equal(projectShare.includes("data-project-share-slack"), false);
  assert.equal(projectShare.includes("data-project-share-discord"), false);
  assert.equal(projectShare.includes("Share to Slack"), false);
  assert.equal(projectShare.includes("Share to Discord"), false);
  assert.equal(projectShare.includes("Workspace members appear as suggestions"), false);
  assert.equal(projectShare.includes("Message copied — Discord is open. Paste in a channel."), false);
  assert.match(projectShare, /Copy share link/);
  assert.match(projectShare, /data-project-share-copy/);
  assert.match(projectShare, /Who can use this link/);
  assert.match(projectShare, /data-share-mode="view"/);
  assert.match(projectShare, /data-share-mode="remix"/);
  assert.match(projectShare, /data-share-mode="edit"/);
  assert.match(projectShare, /Anyone can join this project/);
  assert.match(projectShare, /List on Public/);
  assert.match(projectShare, /patchShareSettings/);
  assert.match(projectShare, /reuse: true/);
  assert.match(projectShare, /data-project-share-video/);
  assert.match(projectShare, /data-video-format="mp4"/);
  assert.match(projectShare, /data-video-audio/);
  assert.match(projectShare, /data-video-markup/);
  assert.match(projectShare, /\/api\/projects\/\$\{encodeURIComponent\(project\.id\)\}\/public/);
  assert.match(projectShare, /let projectShareAbort = null; \/\/ leakfix79/);
  assert.match(workspaceBrowser, /project-share\.js\?.*leakfix79/);

  assert.match(app, /action === "share-slack"/);
  assert.match(app, /action === "share-discord"/);
  assert.match(app, /shareToSlack/);
  assert.match(app, /shareToDiscord/);
  assert.match(app, /share-chat\.js\?v=20260909-sharechat1/);
  assert.match(html, /sharechat1/);

  assert.match(screenshotMarkup, /share-chat\.js\?v=20260909-sharechat1/);
  assert.match(screenshotMarkup, /data-shot-share-target="slack"/);
  assert.match(screenshotMarkup, /data-shot-share-target="discord"/);
  assert.match(screenshotMarkup, /shareToSlack/);
  assert.match(screenshotMarkup, /shareToDiscord/);
});

test("Share to X and Discord open a new tab and never navigate Studio", () => {
  const opened = [];
  const win = openExternalShareTab("https://x.com/intent/post?text=hi", (href) => {
    opened.push(href);
    return { name: "tab" };
  });
  assert.equal(opened[0], "https://x.com/intent/post?text=hi");
  assert.equal(win.name, "tab");
  assert.match(shareChat, /export function openExternalShareTab/);
  assert.match(shareChat, /window\.open\(target, "_blank", "noopener,noreferrer"\)/);
  assert.equal(/window\.location\.href = url/.test(shareChat), false);
  const record = readFileSync(join(here, "../viewport/viewport-video-record.js"), "utf8");
  const shot = readFileSync(join(here, "../viewport/screenshot-markup.js"), "utf8");
  assert.match(record, /window\.open\(url, "_blank", "noopener,noreferrer"\)/);
  assert.equal(/if \(!win\) window\.location\.href = url/.test(record), false);
  assert.equal(/if \(!win\) window\.location\.href = url/.test(shot), false);
  assert.match(record, /openDiscord\(\{ skipWeb: true \}\)/);
  assert.match(html, /veditorhub1|sharexfull1/);
});

test("confirmOpenDiscordApp asks then uses the discord protocol without a web tab", () => {
  const asked = [];
  const result = confirmOpenDiscordApp({
    message: "Open the Discord app?",
    confirmFn: (msg) => { asked.push(msg); return true; },
    documentRef: { body: null },
    guildId: "g",
    channelId: "c",
  });
  assert.equal(asked[0], "Open the Discord app?");
  assert.equal(result.ok, true);
  assert.equal(result.href, "discord://-/channels/g/c");
  const canceled = confirmOpenDiscordApp({
    confirmFn: () => false,
    documentRef: { body: null },
  });
  assert.equal(canceled.ok, false);
});
