import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isXrReferenceFilename,
  listProjectReferenceFiles,
  paintReferenceDocCard,
  referenceFileUrl,
  referenceKindFromName,
  shouldOpenReferenceInWindow,
  workspaceReferenceButtonLine,
  workspaceReferenceLines,
} from "./xr-reference-files.js";

const here = dirname(fileURLToPath(import.meta.url));

test("reference files list videos, PDFs, and photos", () => {
  assert.equal(referenceKindFromName("clip.webm"), "video");
  assert.equal(referenceKindFromName("notes.pdf"), "pdf");
  assert.equal(referenceKindFromName("shot.png"), "image");
  assert.equal(referenceKindFromName("readme.md"), "text");
  assert.equal(isXrReferenceFilename("part.step"), false);
  const listed = listProjectReferenceFiles([
    { name: "recordings/demo.mp4" },
    { name: "refs/spec.pdf" },
    { name: "mesh.glb" },
    { name: "refs/spec.pdf" },
  ]);
  assert.equal(listed.length, 2);
  assert.equal(listed[0].kind, "video");
  assert.equal(listed[1].kind, "pdf");
  const btn = workspaceReferenceButtonLine();
  assert.equal(btn.id, "ws-refs");
  assert.match(btn.label, /Reference files/i);
  const lines = workspaceReferenceLines([{ name: "photo.jpg" }]);
  assert.equal(lines[0].id, "ws-refs-back");
  assert.ok(lines.some((l) => l.id === "ws-ref:photo.jpg"));
  assert.equal(shouldOpenReferenceInWindow("pdf"), true);
  assert.equal(
    referenceFileUrl({ name: "a/b.pdf" }, "proj1"),
    "/api/projects/proj1/files/a/b.pdf",
  );
  const calls = [];
  const ctx = {
    fillRect: (...a) => calls.push(["fill", a]),
    fillText: (...a) => calls.push(["text", a]),
    strokeRect: () => {},
    createLinearGradient: () => ({ addColorStop() {} }),
    fillStyle: "",
    strokeStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
    lineWidth: 0,
  };
  paintReferenceDocCard(ctx, { title: "spec.pdf", kind: "pdf", body: "hello" });
  assert.ok(calls.some((c) => c[0] === "text" && String(c[1][0]).includes("spec.pdf")));
  const xr = readFileSync(join(here, "viewport-xr.js"), "utf8");
  const app = readFileSync(join(here, "../studio/app.js"), "utf8");
  assert.ok(xr.includes("workspaceReferenceButtonLine"));
  assert.ok(xr.includes("openWorkspaceReferenceFile"));
  assert.ok(app.includes("getReferenceFiles"));
});
