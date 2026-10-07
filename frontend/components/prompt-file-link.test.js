import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const composer = readFileSync(join(here, "./prompt-composer.js"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");
const agent = readFileSync(join(here, "./render-agent.js"), "utf8");
const imagine = readFileSync(join(here, "../studio/imagine.js"), "utf8");

test("composer strips [Reference: filename] banners and does not mention-insert file types", () => {
  assert.match(composer, /export function stripPromptFileBanners/);
  assert.match(composer, /\\\[Reference:\\s\*/);
  assert.match(composer, /PROMPT_FILE_LINK_TYPES/);
  assert.match(composer, /if \(isPromptFileLinkType\(type\)\) return false/);
  assert.match(composer, /function shouldInsertPromptMention/);
  assert.match(composer, /textarea\.value = stripPromptFileBanners\(text \|\| ""\)/);
});

test("composer revokes blob chip URLs on remove and clip-to-chat tracks them", () => {
  assert.match(composer, /function revokePromptChipObjectUrl/);
  assert.match(composer, /revokePromptChipObjectUrl\(removed\); \/\/ leakfix21/);
  assert.match(app, /trackObjectUrl\(blob, composerClipCreated\)/);
  assert.match(app, /const composerClipCreated = \[\]; \/\/ leakfix21/);
});

test("studio links dropped videos and files instead of dumping banners into the prompt", () => {
  assert.match(app, /addPromptLinkedMediaFiles/);
  assert.match(app, /isPromptLinkedMediaFile/);
  assert.match(app, /type: "video"/);
  assert.match(app, /composer\.addReference\(ref, \{ insertMention: false \}\)/);
  assert.match(app, /stripPromptFileBanners/);
  assert.doesNotMatch(app, /\\\\\[Reference:\\s\*\$\{escaped\}/);
  assert.match(imagine, /insertMention = false/);
  assert.match(agent, /else if \(isVideo\) \{\s*attachments\.push\(\{ \.\.\.base \}\)/);
  assert.doesNotMatch(agent, /Video clip attached for editing context/);
});

test("canvas @/# tags render as orange in-prompt links and activate the node", () => {
  assert.match(composer, /export function promptLinkTokenAliases/);
  assert.match(composer, /export function isCanvasPromptLink/);
  assert.match(composer, /return \[`@\$\{stem\}`, `#\$\{stem\}`\]/);
  assert.match(composer, /prompt-mention--canvas/);
  assert.match(composer, /onMentionActivate/);
  assert.match(composer, /role", "link"/);
  assert.match(composer, /canvas_element_id/);
  assert.match(app, /onMentionActivate/);
  assert.match(app, /selectElement\?\.\(id\)/);
  const css = readFileSync(join(here, "../studio/styles.css"), "utf8");
  assert.match(css, /\.prompt-mention--canvas/);
  assert.match(css, /#ffa657/);
});
