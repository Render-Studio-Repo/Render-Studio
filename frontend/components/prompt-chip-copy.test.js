import { test } from "node:test";
import assert from "node:assert/strict";
import { copiedChipStatus, copyPayloadForPromptRef } from "./prompt-chip-copy.js";

test("URL / website chips copy the full URL as a link", () => {
  assert.deepEqual(
    copyPayloadForPromptRef({
      type: "url",
      token: "@allegromicro-c",
      label: "allegromicro.com/~/media/…",
      url: "https://www.allegromicro.com/~/media/Files/Datasheets/A4988-Datasheet.ashx",
      filename: "https://www.allegromicro.com/~/media/Files/Datasheets/A4988-Datasheet.ashx",
    }),
    {
      text: "https://www.allegromicro.com/~/media/Files/Datasheets/A4988-Datasheet.ashx",
      kind: "link",
    },
  );
  assert.deepEqual(
    copyPayloadForPromptRef({
      type: "link",
      url: "https://www.ti.com/lit/ds/symlink/drv8833.pdf",
    }),
    { text: "https://www.ti.com/lit/ds/symlink/drv8833.pdf", kind: "link" },
  );
  assert.equal(
    copyPayloadForPromptRef({ type: "document", url: "https://example.com/a.pdf" }).kind,
    "link",
  );
  assert.equal(copiedChipStatus("link"), "Copied link");
});

test("file / PDF / model / face chips copy path or useful id", () => {
  assert.deepEqual(
    copyPayloadForPromptRef({ type: "document", filename: "A4988-Datasheet.pdf", label: "A4988" }),
    { text: "A4988-Datasheet.pdf", kind: "path" },
  );
  assert.deepEqual(
    copyPayloadForPromptRef({ type: "spec", filename: "notes.md" }),
    { text: "notes.md", kind: "path" },
  );
  assert.deepEqual(
    copyPayloadForPromptRef({ type: "component", filename: "bracket.step", stem: "bracket" }),
    { text: "bracket.step", kind: "path" },
  );
  assert.deepEqual(
    copyPayloadForPromptRef({ type: "image", name: "hero.png" }),
    { text: "hero.png", kind: "path" },
  );
  assert.deepEqual(
    copyPayloadForPromptRef({ type: "face", token: "@face-12", label: "12.0, 4.0, 0.0 mm" }),
    { text: "12.0, 4.0, 0.0 mm", kind: "path" },
  );
  assert.equal(copiedChipStatus("path"), "Copied path");
});
