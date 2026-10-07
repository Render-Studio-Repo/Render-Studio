import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SUPER_IDE_LAYOUTS, setSuperIdeLayout, SANDBOX1_TOKEN } from "./super-ide.js";

test("super IDE exposes layui1 quad plus left/down splits", () => {
  assert.deepEqual([...SUPER_IDE_LAYOUTS], ["quad", "split-left", "split-down"]);
  const host = { dataset: {} };
  assert.equal(setSuperIdeLayout(host, "quad"), "quad");
  assert.equal(host.dataset.layout, "quad");
  assert.equal(SANDBOX1_TOKEN, "sandbox1");
});

test("sandbox page hosts the super IDE and only one WebGL mount", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  const boot = readFileSync(new URL("./boot.js", import.meta.url), "utf8");
  const office = readFileSync(new URL("./office.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("./sandbox.css", import.meta.url), "utf8");
  const superSrc = readFileSync(new URL("./super-ide.js", import.meta.url), "utf8");
  assert.match(html, /id="sb-super-ide"/);
  assert.match(html, /id="sb-teleop"/);
  assert.match(html, /id="sb-query-dashboard"/);
  assert.match(html, /sandbox\/team-chat\.html\?embed=1/);
  assert.match(html, /workspace3/);
  assert.match(boot, /mountSuperIde/);
  assert.match(boot, /enterSandboxWorkspace|mountTeleopLab/);
  assert.match(boot, /super-ide\.js/);
  assert.equal((office.match(/WebGLRenderer/g) || []).length, 1);
  assert.match(css, /sb-super-ide/);
  assert.match(css, /sb-teleop/);
  assert.match(css, /--sb-split-x/);
  assert.match(superSrc, /mountSupabaseSql/);
  assert.match(superSrc, /Supabase SQL/);
  assert.match(superSrc, /FILEIDE1|fileide1|Sandbox toggle/);
  assert.match(superSrc, /Debugger VR|dbgvr/);
  assert.match(superSrc, /Projects|sb-pane-projects|fileview1|FILEVIEW1/);
  assert.match(superSrc, /Photo|sb-pane-photo/);
  assert.match(superSrc, /sb-pane-draw/);
  const canvasBlock = html.match(/sb-workspace-canvas[\s\S]*?<\/section>/)?.[0] || "";
  assert.ok(canvasBlock.indexOf('id="sb-super-ide"') < canvasBlock.indexOf('id="sb-teleop"'));
  assert.match(html, /data-sb-enter-workspace/);
  assert.match(html, /data-sb-open-editor/);
});

test("super IDE source paints SQL + file IDE without a second WebGL", () => {
  const src = readFileSync(new URL("./super-ide.js", import.meta.url), "utf8");
  assert.match(src, /Pad/);
  assert.match(src, /sb-pane-sql/);
  assert.match(src, /Supabase SQL/);
  assert.match(src, /FILEIDE1|fileide1|Sandbox toggle/);
  assert.match(src, /Debugger VR|dbgvr/);
  assert.match(src, /Projects|FILEVIEW1|fileview1/);
  assert.match(src, /supasql1|SUPASQL1/);
  assert.match(src, /fileide1|FILEIDE1/);
  assert.match(src, /Agents/);
  assert.match(src, /Wiring \/ Parts \/ McMaster/);
  assert.match(src, /90576A119\.glb|electronics_build_sourcing/);
  assert.doesNotMatch(src, /WebGLRenderer/);
  assert.doesNotMatch(src, /Collab index/);
});
