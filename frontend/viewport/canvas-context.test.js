import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCanvasDrawingMetadata,
  canvasImageDisplayName,
  canvasLinkMentionNodes,
  canvasMentionToken,
  canvasPromptBoardKey,
  canvasPromptGraph,
  collectSmartDescriptionImages,
  collectCanvasInterviewItems,
  composeSmartDescriptionInterview,
  collectCanvasInterests,
  isCanvasGroupLink,
  canvasPromptHashToken,
  buildCanvasGoalMetadata,
  expandCanvasMentionText,
  formatCanvasLayoutNotes,
  formatCanvasInterestLine,
  formatSmartDescriptionDraft,
  isCanvasFinalExample,
  mergeSmartDescriptionPrompt,
  isCanvasReference,
  canvasBoardReference,
  canvasBoardFromBrowserEntry,
  mergeCanvasPromptImages,
  pickBrowserFolderImage,
  editableCanvasBoard,
  slugifyCanvasImageName,
  assignCanvasPromptToken,
  canvasPromptMentionPhrase,
  canvasPromptKind,
  formatCanvasPromptMentions,
  canvasRegionPromptReference,
} from "./canvas-context.js";
import { latestEditableTarget, mergePromptGeometryReferences, selectedGeometryPromptReferences } from "../studio/prompt-edit-context.js";
import { shouldHideViewportForShell } from "../studio/document-tabs.js";
import { shouldParkDesktopViewportForCanvasTab } from "../xr/xr-hot-path.js?v=roboticsworkspace3";

test("canvas metadata preserves labeled views, arrow direction and source image without image bytes", () => {
  const metadata = buildCanvasDrawingMetadata({ title: "Headset mount", width: 1200, height: 800, elements: [
    { id: "top", type: "text", text: "Top View", bounds: { x: 500, y: 220, w: 194, h: 60 } },
    { id: "photo", type: "image", sourceFilename: "headset-top.png", dataUrl: "data:image/png;base64,SECRET", bounds: { x: 510, y: 285, w: 234, h: 200 } },
    { id: "box", type: "rect", parentId: "photo", tag: "Extend mount", bounds: { x: 590, y: 415, w: 48, h: 30 } },
    { id: "arrow", type: "arrow", x1: 550, y1: 540, x2: 614, y2: 445, toId: "box" },
  ] });
  assert.equal(metadata.elements[0].text, "Top View");
  assert.equal(metadata.elements[2].parentId, "photo");
  assert.deepEqual(metadata.elements[3].end, { x: 614, y: 445 });
  assert.equal(metadata.elements[1].sourceFilename, "headset-top.png");
  assert.ok(!JSON.stringify(metadata).includes("SECRET"));
  assert.match(metadata.coordinate_system, /Not CAD millimetres/);
});

test("numbered dotted links and board description travel in canvas metadata", () => {
  const metadata = buildCanvasDrawingMetadata({
    title: "Bracket",
    description: "Left photo is the assembled bracket; right is the exploded hardware.",
    width: 800,
    height: 600,
    elements: [
      { id: "a", type: "image", sourceFilename: "assembled.jpg", bounds: { x: 10, y: 10, w: 120, h: 80 } },
      { id: "b", type: "image", sourceFilename: "exploded.jpg", bounds: { x: 200, y: 10, w: 120, h: 80 } },
      { id: "l1", type: "link", linkNumber: 1, fromId: "a", toId: "b", relation: "exploded view of the same bracket", x1: 130, y1: 50, x2: 200, y2: 50 },
    ],
  });
  assert.equal(metadata.description.startsWith("Left photo"), true);
  assert.equal(metadata.links[0].linkNumber, 1);
  assert.equal(metadata.links[0].relation, "exploded view of the same bracket");
  const notes = formatCanvasLayoutNotes(metadata);
  assert.match(notes, /Link #1/);
  assert.match(notes, /exploded view of the same bracket/);
  assert.match(notes, /Board description/);
});

test("renamed and project canvas attachments skip DXF classification", () => {
  for (const img of [{ name: "canvas-sketch.jpg" }, { name: "Headset.png", role: "canvas" },
    { source_filename: "references/Canvas/Headset/canvas.json" }, { drawing_metadata: { kind: "canvas" } }]) {
    assert.equal(isCanvasReference(img), true);
  }
  assert.equal(isCanvasReference({ name: "headset-product.jpg" }), false);
});

test("canvas references retain the named board path from the project browser", () => {
  assert.deepEqual(canvasBoardReference({ name: "canvas.json", folder: "Canvas/Headset mount" }),
    { name: "Headset mount", filename: "references/Canvas/Headset mount/canvas.json" });
  assert.equal(canvasBoardReference({ filename: "references/Canvas/Top%20View/canvas.json" }).name, "Top View");
  assert.equal(canvasBoardReference({ name: "settings.json" }), null);
});

test("canvas folder rows resolve to the saved board and prefer the canvas PNG", () => {
  const store = {
    virtual_folder: true,
    folder: "Canvas/Canvas 2026-09-15 05.41",
    name: "Canvas 2026-09-15 05.41",
    children: [
      { name: "drop.jpg", folder: "Canvas/Canvas 2026-09-15 05.41", mtime: 90 },
      { name: "preview.png", folder: "Canvas/Canvas 2026-09-15 05.41", mtime: 40 },
      { name: "canvas.json", folder: "Canvas/Canvas 2026-09-15 05.41", mtime: 80 },
    ],
  };
  assert.deepEqual(canvasBoardFromBrowserEntry(store), {
    name: "Canvas 2026-09-15 05.41",
    filename: "references/Canvas/Canvas 2026-09-15 05.41/canvas.json",
  });
  assert.equal(pickBrowserFolderImage(store).name, "preview.png");
  assert.equal(editableCanvasBoard(store)?.name, "Canvas 2026-09-15 05.41");
  assert.equal(
    editableCanvasBoard({ virtual_folder: true, folder: "Canvas", name: "Canvas", children: [store] }),
    null,
  );
  assert.deepEqual(
    canvasBoardFromBrowserEntry({ virtual_folder: true, folder: "Canvas", name: "Canvas", children: [store] }),
    canvasBoardFromBrowserEntry(store),
  );
});

test("newest editable entry uses timestamps instead of browser alphabetical order", () => {
  const entries = [{ name: "a-old.glb" }, { name: "z-new.glb" }];
  assert.equal(latestEditableTarget(entries, [{ name: "a-old.glb", mtime: 10 }, { name: "z-new.glb", mtime: 20 }]).name, "z-new.glb");
  assert.equal(latestEditableTarget([]), null);
});

test("all picked faces, edge geometry, models and documents survive target additions", () => {
  const refs = [{ id: "face1", type: "face", normal: [0, 1, 0] }, { id: "face2", type: "face" },
    { id: "edge", type: "edge", endpoints: [[0, 0, 0], [10, 0, 0]] }, { id: "doc", type: "document" }];
  const combined = mergePromptGeometryReferences(refs, [{ id: "model1", type: "component" }, { id: "face1" }, { id: "model2", type: "component" }]);
  assert.equal(combined.length, 6);
  assert.deepEqual(combined.slice(0, 4), refs);
});

test("canvas split exposes and renders CAD, closing split parks desktop only", () => {
  assert.equal(shouldHideViewportForShell("canvas", { canvasSplit: true }), false);
  assert.equal(shouldHideViewportForShell("canvas"), true);
  assert.equal(shouldParkDesktopViewportForCanvasTab({ canvasTabActive: true, canvasSplit: true }), false);
  assert.equal(shouldParkDesktopViewportForCanvasTab({ canvasTabActive: true }), true);
  assert.equal(shouldParkDesktopViewportForCanvasTab({ canvasTabActive: true, presenting: true }), false);
});

test("renamed canvas images drive @ mentions and AI layout notes", () => {
  const a = { id: "img-a", type: "image", imageName: "Front housing", sourceFilename: "drop.jpg" };
  const b = { id: "img-b", type: "image", sourceFilename: "exploded.png" };
  assert.equal(canvasImageDisplayName(a), "Front housing");
  assert.equal(canvasImageDisplayName(b), "exploded");
  assert.equal(slugifyCanvasImageName("  Left bracket  "), "Left bracket");
  assert.equal(expandCanvasMentionText(`make the box in ${canvasMentionToken("img-a")}`, [a, b]), "make the box in @Front housing");
  const nodes = canvasLinkMentionNodes({ fromId: "img-a", toId: "img-b" }, [a, b]);
  assert.deepEqual(nodes.map((el) => el.id), ["img-a", "img-b"]);
  const notes = formatCanvasLayoutNotes({
    links: [{ linkNumber: 1, fromId: "img-a", toId: "img-b", relation: `compare ${canvasMentionToken("img-a")} to ${canvasMentionToken("img-b")}` }],
    elements: [a, b],
  });
  assert.match(notes, /@Front housing/);
  assert.match(notes, /@exploded/);
});

test("smart description keeps the original prompt, link chain, and final example @ tags", () => {
  const a = { id: "img-a", type: "image", imageName: "example-edit", dataUrl: "data:image/png;base64,a" };
  const b = { id: "img-b", type: "image", imageName: "piece-example", dataUrl: "data:image/png;base64,b" };
  const c = { id: "img-c", type: "image", imageName: "side-view", dataUrl: "data:image/png;base64,c" };
  const look = { id: "img-d", type: "image", imageName: "finished-example", finalExample: true, dataUrl: "data:image/png;base64,d" };
  const elements = [
    a, b, c, look,
    { id: "l1", type: "link", linkNumber: 1, fromId: "img-a", toId: "img-b", relation: "make the box in the first image match @piece-example" },
    { id: "l2", type: "link", linkNumber: 2, fromId: "img-b", toId: "img-c", relation: "same part from the side" },
  ];
  assert.equal(isCanvasFinalExample(look), true);
  const graph = canvasPromptGraph(elements, { boardName: "Bracket" });
  assert.equal(graph.finalExample?.id, "img-d");
  assert.deepEqual(graph.linkedImages.map((img) => img.id).sort(), ["img-a", "img-b", "img-c"]);
  const ids = collectSmartDescriptionImages(elements).map((el) => el.id);
  assert.equal(ids.includes("img-c"), true);
  assert.equal(ids.includes("img-d"), true);
  const draft = formatSmartDescriptionDraft({
    originalPrompt: "build this bracket",
    elements,
    boardName: "Bracket",
  });
  assert.match(draft, /build this bracket/);
  assert.match(draft, /@example-edit/);
  assert.match(draft, /@piece-example/);
  assert.match(draft, /@side-view/);
  assert.match(draft, /@finished-example/);
  assert.match(draft, /make the box in the first image/);
  assert.match(draft, /Final look/);
  const merged = mergeSmartDescriptionPrompt("build this bracket", "A tidy CAD bracket using @example-edit.", elements, "Bracket");
  assert.match(merged, /build this bracket/);
  assert.match(merged, /@piece-example/);
  assert.match(merged, /@finished-example/);
});

test("Send to AI appends another canvas and only replaces the same board", () => {
  const first = { id: "c1", role: "canvas", source_filename: "references/Canvas/Top/canvas.json" };
  const photo = { id: "p1", name: "part.jpg", source_filename: "references/part.jpg" };
  const second = { id: "c2", role: "canvas", source_filename: "references/Canvas/Front/canvas.json" };
  const same = { id: "c1b", role: "canvas", source_filename: "references/Canvas/Top/canvas.json" };
  const merged = mergeCanvasPromptImages([first, photo], second);
  assert.equal(merged.length, 3);
  assert.equal(merged[0].id, "c1");
  assert.equal(merged[1].id, "p1");
  assert.equal(merged[2].id, "c2");
  const replaced = mergeCanvasPromptImages(merged, same);
  assert.equal(replaced.length, 3);
  assert.equal(replaced.some((img) => img.id === "c1"), false);
  assert.equal(replaced.at(-1).id, "c1b");
  assert.equal(canvasPromptBoardKey(first), "references/canvas/top/canvas.json");
});

test("viewport multi-selection includes every model/body and whole models do not imply body zero", () => {
  const refs = selectedGeometryPromptReferences({ selections: [
    { catalogName: "mount.glb", isRoot: true, bodyIndex: 0 },
    { catalogName: "clamp.glb", bodyIndex: 2, label: "Jaw" },
    { catalogName: "support.glb", faceIndex: 12, bodyIndex: 1 },
  ] }, "project1");
  assert.equal(refs.length, 3);
  assert.equal(refs[0].body_index, undefined);
  assert.equal(refs[1].body_index, 2);
  assert.equal(refs[2].face_index, 12);
});

test("faces of interest travel in canvas metadata and layout notes", () => {
  const metadata = buildCanvasDrawingMetadata({
    title: "Headset mount",
    width: 800,
    height: 600,
    elements: [
      {
        id: "face1",
        type: "face-mark",
        interestKind: "face",
        interestNumber: 1,
        viewName: "Top",
        action: "extrude",
        direction: "up",
        interestPrompt: "go outside and round the corners",
        bounds: { x: 40, y: 50, w: 80, h: 40 },
      },
      {
        id: "side1",
        type: "face-mark",
        interestKind: "face",
        interestNumber: 2,
        viewName: "Side",
        action: "extrude",
        direction: "right",
        interestPrompt: "go out 45 mm and curve to fit a Meta Quest headset",
        bounds: { x: 200, y: 50, w: 80, h: 40 },
      },
    ],
  });
  assert.equal(metadata.interests.length, 2);
  assert.equal(metadata.elements[0].interestPrompt.includes("round the corners"), true);
  assert.equal(collectCanvasInterests(metadata.elements).length, 2);
  const notes = formatCanvasLayoutNotes(metadata);
  assert.match(notes, /Face of interest #1/);
  assert.match(notes, /go outside and round the corners/);
  assert.match(notes, /45 mm/);
  assert.match(formatCanvasInterestLine(metadata.elements[1]), /Side view/);
});

test("canvas goal metadata json names references, links, and faces of interest", () => {
  const a = { id: "img-a", type: "image", imageName: "Front housing", sourceFilename: "front.jpg" };
  const b = { id: "img-b", type: "image", imageName: "Headset", sourceFilename: "quest.jpg", finalExample: true };
  const payload = buildCanvasGoalMetadata({
    boardName: "Mount",
    description: "Hold a Meta Quest headset",
    elements: [
      a, b,
      { id: "l1", type: "link", linkNumber: 1, fromId: "img-a", toId: "img-b", relation: "same part from another view" },
      {
        id: "face1", type: "face-mark", interestKind: "face", interestNumber: 1,
        viewName: "Top", action: "extrude", direction: "up",
        interestPrompt: "go out 45 mm and curve to fit a Meta Quest headset",
      },
    ],
  });
  assert.equal(payload.kind, "canvas-metadata");
  assert.equal(payload.goal, "Hold a Meta Quest headset");
  assert.equal(payload.final_example.token, "@Headset");
  assert.equal(payload.links[0].from, "@Front-housing");
  assert.match(payload.interests[0].prompt, /45 mm/);
  assert.equal(JSON.stringify(payload).includes("data:image"), false);
});

test("Send to AI assigns stable box: @box1 tokens and smart description adds colons", () => {
  const photo = { id: "photo", type: "image", imageName: "front housing", bounds: { x: 0, y: 0, w: 200, h: 200 } };
  const box = { id: "box", type: "rect", parentId: "photo", tag: "Extend mount", bounds: { x: 80, y: 100, w: 48, h: 30 } };
  const view = { id: "v1", type: "view-mark", interestKind: "view", viewName: "Top", bounds: { x: 10, y: 10, w: 40, h: 20 } };
  const link = { id: "l1", type: "link", linkNumber: 1, fromId: "photo", toId: "box" };
  assignCanvasPromptToken(box, [photo, box]);
  assert.equal(canvasPromptKind(box), "box");
  assert.equal(box.promptToken, "@box1");
  assert.equal(canvasPromptMentionPhrase(box), "box: @box1");
  assignCanvasPromptToken(box, [photo, box]);
  assert.equal(box.promptToken, "@box1");
  const box2 = { id: "box2", type: "rect", bounds: { x: 1, y: 1, w: 10, h: 10 } };
  assignCanvasPromptToken(box2, [photo, box, box2]);
  assert.equal(box2.promptToken, "@box2");
  assignCanvasPromptToken(view, [view]);
  assert.equal(canvasPromptMentionPhrase(view), "view: @top-view");
  assignCanvasPromptToken(photo, [photo, box]);
  assert.equal(photo.promptToken, "@image-front-housing");
  assignCanvasPromptToken(link, [link]);
  assert.equal(canvasPromptMentionPhrase(link), "link: #1");
  const original = "it needs to be atleast 70mm sticking out front in the highlighted box";
  const draft = formatSmartDescriptionDraft({ originalPrompt: original, elements: [photo, box] });
  assert.match(draft, /70mm/);
  assert.match(draft, /highlighted box: @box1/);
  assert.equal(draft.includes("LAYOUT DRAWING"), false);
  assert.equal(draft.includes("DXF"), false);
  const rewritten = formatCanvasPromptMentions("in the highlighted box box: @box1", [box]);
  assert.match(rewritten, /highlighted box: @box1/);
  assert.equal((rewritten.match(/@box1/g) || []).length, 1);
  const meta = buildCanvasGoalMetadata({
    boardName: "Mount",
    elements: [photo, box, view],
  });
  const boxRegion = meta.regions.find((row) => row.id === "box");
  assert.equal(boxRegion.token, "@box1");
  assert.equal(boxRegion.phrase, "box: @box1");
  assert.equal(boxRegion.parentId, "photo");
  const ref = canvasRegionPromptReference(box, { projectId: "p1", boardName: "Mount", elements: [photo, box] });
  assert.equal(ref.token, "@box1");
  assert.equal(ref.canvas_element_id, "box");
  assert.equal(ref.parent_id, "photo");
  const drawing = buildCanvasDrawingMetadata({ title: "Mount", elements: [box] });
  assert.equal(drawing.elements[0].promptToken, "@box1");
});

test("named group-links interview with @/# tags and fill-only draft", () => {
  const elements = [
    { id: "img", type: "image", imageName: "example-edit", sourceFilename: "edit.png" },
    { id: "box", type: "text", tag: "piece-example", text: "housing", bounds: { x: 10, y: 10, w: 80, h: 40 } },
    {
      id: "g1", type: "group-link", linkNumber: 1, linkName: "housing-pair",
      memberIds: ["img", "box"], relation: "same housing from two angles",
    },
  ];
  assert.equal(isCanvasGroupLink(elements[2]), true);
  assert.equal(canvasPromptHashToken("piece-example"), "#piece-example");
  const items = collectCanvasInterviewItems(elements);
  assert.equal(items.length, 1);
  assert.equal(items[0].linkName, "housing-pair");
  assert.ok(items[0].tokens.includes("@example-edit"));
  assert.ok(items[0].tokens.includes("#piece-example"));
  const meta = buildCanvasDrawingMetadata({ title: "Board", elements });
  assert.equal(meta.links[0].type, "group-link");
  assert.deepEqual(meta.links[0].memberIds, ["img", "box"]);
  const draft = composeSmartDescriptionInterview({
    originalPrompt: "make this mount",
    elements,
    boardName: "Board",
    answers: { editCurrent: "new", g1: "Keep @example-edit aligned with #piece-example" },
  });
  assert.match(draft, /Create a new object/);
  assert.match(draft, /#housing-pair/);
  assert.match(draft, /@example-edit/);
  assert.match(draft, /#piece-example/);
  assert.match(formatCanvasLayoutNotes({ elements, links: meta.links }), /Named link/);
});
