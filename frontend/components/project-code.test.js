import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROJECT_CODE_FOLDER,
  isCodeFilename,
  isProjectCodeFolder,
  isCanvasBoardFolder,
  looksLikeCodeFileList,
  codeBundleName,
  folderShareEntry,
  codeTreeFromEntries,
  flattenFolderFiles,
} from "./project-code.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../index.html"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");
const tree = readFileSync(join(here, "./project-tree.js"), "utf8");
const browser = readFileSync(join(here, "../workspace/workspace-browser.js"), "utf8");
const refs = readFileSync(join(here, "./reference-files.js"), "utf8");

test("code detection treats js/ts/py/json and zips of those as project code", () => {
  assert.equal(isCodeFilename("app.ts"), true);
  assert.equal(isCodeFilename("main.py"), true);
  assert.equal(isCodeFilename("schema.json"), true);
  assert.equal(isCodeFilename("index.html"), true);
  assert.equal(isCodeFilename("styles.css"), true);
  assert.equal(isCodeFilename("shot.png"), false);
  assert.equal(isCodeFilename("part.step"), false);
  assert.equal(looksLikeCodeFileList([
    { name: "main.py", webkitRelativePath: "Robot/src/main.py" },
    { name: "icon.png", webkitRelativePath: "Robot/icon.png" },
  ]), true);
  assert.equal(looksLikeCodeFileList([{ name: "assembly.step" }]), false);
  assert.equal(looksLikeCodeFileList([{ name: "firmware.zip" }]), false);
  assert.equal(codeBundleName([
    { name: "main.py", webkitRelativePath: "Robot/src/main.py" },
  ]), "Robot");
  assert.equal(PROJECT_CODE_FOLDER, "Project Code");
});

test("canvas board folders and Project Code folders are distinct", () => {
  assert.equal(isCanvasBoardFolder({ folder: "Canvas/Canvas 2026-09-15 06.54" }), true);
  assert.equal(isCanvasBoardFolder({ folder: "Canvas" }), false);
  assert.equal(isProjectCodeFolder({ folder: "Project Code/Robot" }), true);
  assert.equal(isProjectCodeFolder({ folder: "Canvas/Board" }), false);
  const share = folderShareEntry({
    virtual_folder: true,
    children: [
      { name: "notes.txt", mtime: 2 },
      { name: "canvas.png", mtime: 1 },
    ],
  });
  assert.equal(share.name, "canvas.png");
});

test("code tree nests folder files without loading contents", () => {
  const treeNodes = codeTreeFromEntries([
    { path: "references/Project Code/Robot/src/main.py", name: "main.py" },
    { path: "references/Project Code/Robot/src/util.ts", name: "util.ts" },
    { path: "references/Project Code/Robot/README.md", name: "README.md" },
  ], "Project Code/Robot");
  assert.equal(treeNodes.name, "Robot");
  assert.equal(treeNodes.children.some((child) => child.name === "src" && child.children), true);
  assert.equal(flattenFolderFiles({
    virtual_folder: true,
    children: [{ name: "a.js" }, { virtual_folder: true, children: [{ name: "b.py" }] }],
  }).map((row) => row.name).join(","), "a.js,b.py");
});

test("folder 3-dot menus include canvas and project-code actions", () => {
  assert.match(tree, /Open canvas/);
  assert.match(tree, /Copy share link/);
  assert.match(tree, /Open in code editor/);
  assert.match(tree, /Open in video editor/);
  assert.match(tree, /onOpenCanvasBoard/);
  assert.match(tree, /onOpenCodeFolder/);
  assert.match(browser, /Open canvas/);
  assert.match(browser, /Copy share link/);
  assert.match(browser, /Open in code editor/);
  assert.match(browser, /Open in video editor/);
  assert.match(browser, /onOpenCodeFolder/);
  assert.match(refs, /openFolderWorkspace/);
  assert.match(refs, /data-ref-code-tree/);
  assert.match(app, /openCodeFolderWorkspace/);
  assert.match(app, /uploadCodeProjectFiles/);
  assert.match(app, /PROJECT_CODE_FOLDER/);
  assert.match(html, /foldcode1/);
  assert.match(html, /vidopen1/);
  assert.match(app, /project-tree\.js\?v=[^"']*foldcode1/);
  assert.match(app, /project-tree\.js\?v=[^"']*vidopen1/);
  assert.match(app, /workspace-browser\.js\?v=[^"']*foldcode1/);
  assert.match(app, /workspace-browser\.js\?v=[^"']*vidopen1/);
  assert.match(app, /reference-files\.js\?v=[^"']*foldcode1/);
  assert.match(app, /reference-files\.js\?v=[^"']*vidopen1/);
});

test("json/js/py drops land in Project Code dump or nested folders", () => {
  const src = readFileSync(join(here, "./project-code.js"), "utf8");
  assert.equal(looksLikeCodeFileList([{ name: "sketch.js" }]), true);
  assert.equal(looksLikeCodeFileList([{ name: "schema.json" }]), true);
  assert.equal(looksLikeCodeFileList([{ name: "main.py" }]), true);
  assert.match(src, /CODE_DUMP_FOLDER/);
  assert.match(src, /Dropped files/);
  assert.match(src, /collectDroppedCodeFiles/);
  assert.match(src, /entryMatchesNameAndType/);
  assert.match(app, /importDroppedCodeIfAny/);
  assert.match(app, /promptCodeShare/);
  assert.match(app, /setCodeSplit/);
  assert.match(app, /CODE_NEW_FILES_TAB/);
  assert.match(tree, /browser-think-overlay/);
  assert.match(tree, /Share/);
  assert.match(html, /code1/);
});
