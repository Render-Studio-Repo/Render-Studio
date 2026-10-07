import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../index.html"), "utf8");
const css = readFileSync(join(here, "styles.css"), "utf8");
const ribbonCss = readFileSync(join(here, "ribbon.css"), "utf8");
const socialJs = readFileSync(join(here, "../social/social-network-ui.js"), "utf8");

function rightPanelTabsBlock() {
  const start = html.indexOf('class="right-panel-tabs"');
  assert.ok(start >= 0, "right-panel-tabs exists");
  const end = html.indexOf("</div>", start);
  return html.slice(start, end);
}

test("Agent right panel keeps AI History Tools on one even row", () => {
  const block = rightPanelTabsBlock();
  const tabs = [...block.matchAll(/data-right-tab="([^"]+)"[^>]*>([^<]+)</g)].map((m) => ({
    id: m[1],
    label: m[2].trim(),
  }));
  const chrome = tabs.filter((t) => ["prompt", "social", "history", "tools"].includes(t.id));
  assert.deepEqual(
    chrome.map((t) => t.id),
    ["prompt", "social", "history", "tools"],
  );
  assert.equal(chrome[0].label, "AI");
  assert.equal(chrome[2].label, "History");
  assert.equal(chrome[3].label, "Tools");
  for (const gone of ["analytics", "architect", "electronics", "robotics", "social", "robot"]) {
    assert.match(css, new RegExp(`data-right-tab="${gone}"`));
  }
  const tabsStart = css.lastIndexOf("\n.right-panel-tabs {");
  const tabsCss = css.slice(tabsStart, css.indexOf("\n.right-panel-tab {", tabsStart));
  assert.match(tabsCss, /grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.right-panel-tab\[data-right-tab="social"\]/);
  assert.match(html, /\/studio\/styles\.css\?v=/);
  assert.match(html, /\/studio\/app\.js\?v=/);
  assert.match(html, /socialpop1/);
});

test("studio chrome is one row; Social popup stays beside Chat in the header", () => {
  const chromeAt = html.indexOf('id="studio-chrome-row"');
  const wsbarAt = html.indexOf('id="workspace-mode-bar"');
  const ribbonAt = html.indexOf('id="ribbon-desktop-anchor"');
  assert.ok(chromeAt >= 0 && wsbarAt > chromeAt && ribbonAt > wsbarAt);
  assert.match(html, /id="btn-project-chat"/);
  assert.match(html, /id="btn-social-network"/);
  assert.match(html, /workspace-social-switcher/);
  assert.match(html, /aria-controls="social-network-overlay"/);
  const chatAt = html.indexOf('id="btn-project-chat"');
  const socialAt = html.indexOf('id="btn-social-network"');
  assert.ok(socialAt > chatAt);
  assert.match(css, /grid-area:\s*chrome/);
  assert.match(css, /#studio-chrome-row:has\(\.ribbon-bar--no-tool-chrome\)/);
  assert.match(ribbonCss, /#studio-chrome-row:has\(\.ribbon-bar--no-tool-chrome\) \.ribbon-bar/);
  assert.match(socialJs, /social-network-overlay--popup/);
  assert.match(socialJs, /id="social-room-list"/);
  assert.match(socialJs, /function positionPopup/);
  assert.match(html, /app\.js\?v=20260908-.*profclick1/);
  assert.match(html, /app\.js\?v=20260908-.*fcdoc1/);
  assert.match(html, /app\.js\?v=20260908-.*chromeprof1/);
  assert.match(html, /app\.js\?v=20260908-.*profopen1/);
  assert.match(html, /mobile-app-chrome\.css\?v=20260908-iphone4-bugact1-chromeprof1/);
});

test("Report Bug, Activity, and Social chrome sit in the header left of the profile icon", () => {
  const headerStart = html.indexOf('<header class="toolbar">');
  const header = html.slice(headerStart, html.indexOf("</header>", headerStart));
  const chrome = html.slice(html.indexOf('id="studio-chrome-row"'), html.indexOf('id="ribbon-desktop-anchor"'));
  assert.match(header, /toolbar-account-actions/);
  assert.match(header, /id="btn-project-chat"/);
  assert.match(header, /id="btn-social-network"/);
  assert.match(header, /id="btn-suggestion"/);
  assert.match(header, /id="btn-report-bug"/);
  assert.match(header, /id="btn-instance-bug"/);
  assert.match(header, /id="btn-workspace-activity-toggle"/);
  assert.ok(header.indexOf("btn-project-chat") < header.indexOf("btn-report-bug"));
  assert.ok(header.indexOf("btn-social-network") < header.indexOf("btn-report-bug"));
  assert.ok(header.indexOf("btn-suggestion") < header.indexOf("btn-report-bug"));
  assert.ok(header.indexOf("btn-report-bug") < header.indexOf("btn-auth"));
  assert.ok(header.indexOf("btn-workspace-activity-toggle") < header.indexOf("btn-auth"));
  assert.equal(/id="btn-report-bug"/.test(chrome), false);
  assert.equal(/id="btn-workspace-activity-toggle"/.test(chrome), false);
  assert.equal(/id="btn-project-chat"/.test(chrome), false);
  assert.equal(/id="btn-social-network"/.test(chrome), false);
  assert.equal(/id="btn-suggestion"/.test(chrome), false);
  assert.match(css, /\.toolbar-account-actions/);
});
