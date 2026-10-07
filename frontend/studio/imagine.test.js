import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IMAGINE_FOLDER,
  IMAGINE_FETCHED_FOLDER,
  DXF_CONVERT_PREF_KEY,
  IMAGINE_IMPROVE_PREF_KEY,
  OPENAI_IMAGINE_MODELS,
  GROK_IMAGINE_MODELS,
  imagineFilenameFromPrompt,
  imagineFetchedFilename,
  isImagineRel,
  resolveImagineProvider,
  classifyImageForDxf,
  resolveDxfConvertDecision,
  persistDxfDontAskAgain,
  readDxfConvertPref,
  writeDxfConvertPref,
  readImagineImprovePref,
  writeImagineImprovePref,
  readImagineLibraryViewPref,
  writeImagineLibraryViewPref,
  IMAGINE_LIBRARY_VIEW_PREF_KEY,
  imagineDisplayName,
  filterImagineLibrary,
  parseImagineSlash,
  completeImagineSlash,
  fetchFormatsFromQuery,
  imagineEmptyStateMessage,
  imagineMarkupContextText,
  imagineHistoryEntryFromFile,
  isImagineReferenceFile,
  imagineReferenceKind,
  imagineReferenceToken,
  linkImagineReferenceInPrompt,
  unlinkImagineReferenceFromPrompt,
  isImagineComposePaneActive,
  imagineAttachmentsToRequest,
  imagineReferencePromptBlock,
  LS_IMAGINE_COMPOSE_DRAFT,
  readImagineComposeDrafts,
  writeImagineComposeDrafts,
} from "./imagine.js";

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, "../index.html"), "utf8");
const app = readFileSync(join(here, "app.js"), "utf8");
const css = readFileSync(join(here, "styles.css"), "utf8");
const imagineSrc = readFileSync(join(here, "imagine.js"), "utf8");

function memoryStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
}

test("Imagine tab is in the AI prompt chrome with a hover description", () => {
  assert.match(html, /class="prompt-tab"[^>]*data-pane="imagine"/);
  assert.match(html, /data-studio-panel="imagine"/);
  assert.match(html, />Imagine</);
  assert.match(html, /id="prompt-tab-imagine"/);
  assert.match(html, /connected API key/);
  assert.match(html, /send to CAD or Mesh/i);
  assert.match(html, /id="prompt-pane-imagine"/);
  assert.match(html, /id="imagine-input"/);
  assert.match(html, /id="imagine-gallery"/);
  assert.match(html, /id="imagine-history"/);
  assert.match(html, /id="imagine-search"/);
  assert.match(html, /data-imagine-library="list"/);
  assert.match(html, /data-imagine-library="grid"/);
  assert.match(html, /data-imagine-library="history"/);
  assert.match(html, /id="imagine-spice"/);
  assert.match(html, /id="imagine-key-picker-btn"/);
  assert.match(html, /id="imagine-fetch-formats"/);
  assert.match(html, /data-imagine-format="step"/);
  assert.match(html, /imagine1/);
  assert.match(html, /imagine2/);
  assert.match(html, /imagine3/);
  assert.match(html, /imagine4/);
  assert.match(html, /imagine5/);
  assert.match(html, /imageref1/);
  assert.match(html, /id="btn-render-agent"[^>]*workspace-feedback-btn--agent/);
  assert.match(html, /id="btn-project-chat"/);
  const chatAt = html.indexOf('id="btn-project-chat"');
  const agentAt = html.indexOf('id="btn-render-agent"');
  assert.ok(agentAt >= 0 && chatAt > agentAt, "Agent chrome sits left of Chat");
  assert.doesNotMatch(html, /id="btn-prompt-render-agent"/);
  assert.match(app, /showImaginePanel/);
  assert.match(app, /tabRoot:/);
  assert.match(app, /mode: "imagine"/);
  assert.match(app, /imagine-key-picker-btn/);
});

test("Imagine Improve pref defaults off and library search matches name or prompt", () => {
  assert.equal(IMAGINE_IMPROVE_PREF_KEY, "render3d:imagine-improve:v1");
  const store = memoryStorage();
  assert.equal(readImagineImprovePref(store), false);
  assert.equal(writeImagineImprovePref(true, store), true);
  assert.equal(readImagineImprovePref(store), true);
  const items = [
    { name: "imagine/kettle.png", label: "Kettle", prompt: "matte black kettle" },
    { name: "imagine/lamp.png", label: "Lamp", prompt: "brass desk lamp" },
  ];
  assert.equal(imagineDisplayName(items[0]), "Kettle");
  assert.equal(filterImagineLibrary(items, "brass").length, 1);
  assert.equal(filterImagineLibrary(items, "imagine/kettle").length, 1);
  assert.equal(filterImagineLibrary(items, "").length, 2);
  assert.match(css, /\.imagine-gallery--grid|\.imagine-gallery \{[\s\S]*grid-template-columns/);
  assert.match(css, /\.imagine-gallery--list/);
  assert.match(css, /\.imagine-row/);
  assert.match(css, /\.imagine-command/);
  assert.match(css, /\.workspace-feedback-btn--agent/);
  assert.match(css, /\.workspace-feedback-btn--agent \{[\s\S]*?#e3b341/);
  assert.doesNotMatch(css, /workspace-feedback-btn--agent[\s\S]{0,280}#8b5cf6/);
  assert.match(css, /\.imagine-history-row/);
});

test("Imagine library view pref remembers list vs grid", () => {
  assert.equal(IMAGINE_LIBRARY_VIEW_PREF_KEY, "render3d:imagine-library-view:v1");
  const store = memoryStorage();
  assert.equal(readImagineLibraryViewPref(store), "grid");
  assert.equal(writeImagineLibraryViewPref("list", store), "list");
  assert.equal(readImagineLibraryViewPref(store), "list");
  assert.equal(writeImagineLibraryViewPref("history", store), "grid");
  assert.match(html, /class="imagine-act"/);
  assert.match(html, /class="imagine-go"/);
});

test("Imagine folder and prompt-derived filenames", () => {
  assert.equal(IMAGINE_FOLDER, "imagine");
  assert.equal(IMAGINE_FETCHED_FOLDER, "imagine/fetched");
  const name = imagineFilenameFromPrompt("Open Arm 2.0 concept render!", { suffix: "ab12cd" });
  assert.match(name, /^open-arm-2-0-concept-render-ab12cd\.png$/);
  assert.ok(isImagineRel("imagine/open-arm-ab12cd.png"));
  assert.equal(isImagineRel("renders/x.png"), false);
  const fetched = imagineFetchedFilename("/fetch open arm 2.0 3d step model", ".step", { suffix: "zz9" });
  assert.match(fetched, /^open-arm-2-0-3d-step-model-zz9\.step$/);
});

test("Imagine provider routing uses OpenAI Image 2.5 or Grok Imagine", () => {
  assert.equal(OPENAI_IMAGINE_MODELS[0], "gpt-image-2.5-flare");
  assert.ok(GROK_IMAGINE_MODELS.includes("grok-imagine-image"));
  const openai = resolveImagineProvider({
    selectedProvider: "openai",
    keys: [{ provider: "openai" }, { provider: "xai" }],
  });
  assert.equal(openai.provider, "openai");
  assert.equal(openai.model, "gpt-image-2.5-flare");
  const grok = resolveImagineProvider({
    selectedProvider: "xai",
    keys: [{ provider: "openai" }, { provider: "grok" }],
  });
  assert.equal(grok.provider, "xai");
  assert.equal(grok.model, "grok-imagine-image");
  const onlyGrok = resolveImagineProvider({
    selectedProvider: "anthropic",
    keys: [{ provider: "xai" }],
  });
  assert.equal(onlyGrok.provider, "xai");
  const none = resolveImagineProvider({ selectedProvider: "openai", keys: [] });
  assert.equal(none.provider, null);
  assert.match(imagineEmptyStateMessage(), /AI & Billing/);
});

test("DXF intelligence keeps product photos and converts line drawings", () => {
  const photo = classifyImageForDxf({
    filenames: ["imagine/kettle-ab12.png"],
    prompt: "photoreal product shot of a kettle",
  });
  assert.equal(photo.action, "keep");
  const drawing = classifyImageForDxf({
    filenames: ["bracket-sketch.png"],
    prompt: "extrude this 2d profile logo",
  });
  assert.equal(drawing.action, "dxf");
  assert.deepEqual(resolveDxfConvertDecision("always_image", drawing), {
    convert: false,
    ask: false,
    pref: "always_image",
  });
  assert.equal(resolveDxfConvertDecision("auto", drawing).convert, true);
  assert.equal(resolveDxfConvertDecision("auto", photo).convert, false);
  assert.equal(resolveDxfConvertDecision("ask", photo).ask, true);
});

test("don't ask again writes the DXF pref key", () => {
  const storage = memoryStorage();
  persistDxfDontAskAgain("no", storage);
  assert.equal(storage.getItem(DXF_CONVERT_PREF_KEY), "always_image");
  persistDxfDontAskAgain("yes", storage);
  assert.equal(readDxfConvertPref(storage), "always_dxf");
  writeDxfConvertPref("auto", storage);
  assert.equal(readDxfConvertPref(storage), "auto");
  assert.match(html, /image-drawing-remember/);
  assert.match(html, /Preferences/);
  assert.match(app, /DXF_CONVERT_PREF_KEY|readDxfConvertPref|pref-dxf-convert/);
});

test("General is the first Preferences tab and AI Prompt preferences live there", () => {
  const start = app.indexOf("const PREFERENCES_MAIN_TABS");
  const block = app.slice(start, start + 400);
  assert.match(block, /\["general", "General"\]/);
  assert.ok(block.indexOf('["general", "General"]') < block.indexOf('["robotics", "Robotics"]'));
  assert.match(app, /AI Prompt preferences/);
  assert.match(app, /pref-dxf-convert/);
  assert.match(app, /pref-imagine-count/);
  assert.match(app, /profile-pref-section-title/);
  assert.match(css, /\.profile-pref-section-title/);
});

test("/fetch slash command defaults formats and honors mentioned STEP", () => {
  assert.deepEqual(parseImagineSlash("a red kettle").kind, "prompt");
  assert.equal(parseImagineSlash("/").kind, "slash-help");
  assert.equal(parseImagineSlash("/fet").kind, "slash-help");
  const fetch = parseImagineSlash("/fetch open arm 2.0 3d step model");
  assert.equal(fetch.kind, "fetch");
  assert.equal(fetch.query, "open arm 2.0 3d step model");
  assert.deepEqual(fetch.formats, { stl: false, glb: false, step: true, "3mf": false });
  assert.deepEqual(fetchFormatsFromQuery("robot arm"), { stl: true, glb: true, step: true, "3mf": false });
  assert.match(app, /imagine\/fetch/);
  assert.match(html, /id="imagine-slash"/);
  assert.match(html, /imagine-slash-icon/);
  assert.match(html, /imagine-slash-tab/);
  assert.match(html, /Public CAD/);
  assert.match(css, /\.imagine-slash-icon/);
  assert.match(css, /\.imagine-slash-tab/);
});

test("Tab completes partial Imagine slash commands to /fetch", () => {
  assert.equal(completeImagineSlash("/"), "/fetch ");
  assert.equal(completeImagineSlash("/fet"), "/fetch ");
  assert.equal(completeImagineSlash("/fet open arm"), "/fetch open arm");
  assert.equal(completeImagineSlash("/fetch"), "/fetch ");
  assert.equal(completeImagineSlash("/fetch "), null);
  assert.equal(completeImagineSlash("/fetch open arm"), null);
  assert.equal(completeImagineSlash("a kettle"), null);
  assert.equal(completeImagineSlash("/foo"), null);
});

test("imagine refresh aborts the previous library GET", () => {
  const src = readFileSync(join(here, "imagine.js"), "utf8");
  assert.match(src, /let imagineRefreshAbort = null; \/\/ leakfix66/);
  assert.match(src, /async function refresh\(\)[\s\S]{0,900}signal: ctl\.signal/);
});

test("Send to AI attaches Imagine chips instead of a raw markup path token", () => {
  const src = readFileSync(join(here, "imagine.js"), "utf8");
  assert.match(html, /id="imagine-image-list"/);
  assert.match(html, /id="imagine-history-summary"/);
  assert.match(css, /\.imagine-image-list/);
  assert.match(src, /renderImagineAttachments/);
  assert.match(src, /prompt-image-card/);
  assert.match(src, /prompt-image-remove/);
  assert.match(src, /prompt-history\?kind=imagine/);
  assert.match(src, /createPromptHistoryUI/);
  assert.match(src, /loadImagineHistoryEntry/);
  assert.doesNotMatch(src, /bits\.push\(`\[Imagine markup:/);
  assert.equal(imagineMarkupContextText({ strokeCount: 2 }), "Use 2 markup stroke(s) as edit intent.");
  const row = imagineHistoryEntryFromFile({
    name: "imagine/pan.png",
    prompt: "improved pan",
    original_prompt: "a pan",
    prompt_improved: true,
    cost_usd: 0.04,
    mtime: 1700000000,
  }, "proj-1");
  assert.equal(row.kind, "imagine");
  assert.equal(row.project_id, "proj-1");
  assert.equal(row.original_prompt, "a pan");
  assert.equal(row.prompt_improved, true);
  assert.equal(row.cost_usd, 0.04);
  assert.equal(row.images[0].source_filename, "imagine/pan.png");
  assert.match(row.images[0].url, /\/files\/imagine\/pan\.png$/);
  assert.match(app, /onViewPromptCompare/);
  assert.match(app, /eventHitsOpenRefViewer/);
  assert.match(app, /reuseUnifiedPromptHistoryEntry/);
  assert.match(app, /onHistoryChange/);
  assert.match(app, /projectHistoryApiPath\(pid, "prompt-history"\)\}`/);
  assert.doesNotMatch(app, /prompt-history"\)\}\?kind=cad/);
});

test("Imagine drops attach files as prompt references without leaving the tab", () => {
  assert.equal(isImagineReferenceFile({ name: "kettle.png", type: "image/png" }), true);
  assert.equal(isImagineReferenceFile({ name: "spec.pdf", type: "application/pdf" }), true);
  assert.equal(isImagineReferenceFile({ name: "notes.txt" }), true);
  assert.equal(isImagineReferenceFile({ name: "arm.step" }), false);
  assert.equal(isImagineReferenceFile({ name: "clip.mp4" }), true);
  assert.equal(imagineReferenceKind({ name: "clip.mp4" }), "video");
  assert.equal(imagineReferenceKind({ name: "hero.jpg" }), "image");
  assert.equal(imagineReferenceKind({ name: "brief.pdf" }), "document");
  assert.equal(imagineReferenceToken("Kettle Concept.png"), "@Kettle-Concept");
  assert.equal(linkImagineReferenceInPrompt("", "@kettle"), "@kettle ");
  assert.equal(linkImagineReferenceInPrompt("create a mug", "@kettle"), "create a mug @kettle ");
  assert.equal(linkImagineReferenceInPrompt("create a mug ", "@kettle"), "create a mug @kettle ");
  assert.equal(linkImagineReferenceInPrompt("see @kettle please", "@kettle"), "see @kettle please");
  assert.equal(unlinkImagineReferenceFromPrompt("create a mug @kettle ", "@kettle"), "create a mug");
  assert.equal(isImagineComposePaneActive({ className: "prompt-pane active" }), true);
  assert.equal(isImagineComposePaneActive({ className: "prompt-pane hidden" }), false);
  const payload = imagineAttachmentsToRequest([
    { id: "1", type: "image", name: "a.png", token: "@a", data_url: "data:image/png;base64,xx", media_type: "image/png" },
    { id: "2", type: "document", name: "spec.pdf", token: "@spec" },
  ]);
  assert.equal(payload.image.name, "a.png");
  assert.equal(payload.references.length, 2);
  assert.match(imagineReferencePromptBlock(payload.references), /Attached as reference/);
  assert.match(imagineReferencePromptBlock(payload.references), /@spec: document spec.pdf/);
  assert.match(html, /id="imagine-inline-ref-chips"/);
  assert.match(html, /imageref1/);
  assert.match(css, /imagine-compose\.dragging/);
  assert.match(imagineSrc, /attachDroppedFiles/);
  assert.match(imagineSrc, /convertHeicFileToPng/);
  assert.match(imagineSrc, /insertMention = false/);
  assert.match(imagineSrc, /return "video"/);
  assert.doesNotMatch(imagineSrc, /upsertAttachment\(att, \{ insertMention: !existing \}\)/);
  assert.match(html, /chipcopy1/);
  assert.match(app, /handleImagineComposeDrop/);
  assert.match(app, /routeDroppedFilesToImagine/);
  assert.match(app, /isImagineComposeTabActive\(\)/);
  const dropAt = app.indexOf("async function handlePromptComposeDrop");
  const imagineGuard = app.indexOf("isImagineComposeTabActive()", dropAt);
  const composeSwitch = app.indexOf("showAiComposePanel", dropAt);
  assert.ok(imagineGuard > dropAt && imagineGuard < dropAt + 500, "Imagine drop guard sits at the start of compose drop");
  assert.ok(composeSwitch === -1 || imagineGuard < composeSwitch);
});

test("Imagine compose chrome matches CAD prompt hierarchy and cache-busts imaghist1", () => {
  assert.match(html, /imaghist1/);
  assert.match(html, /class="prompt-compose-toolbar imagine-compose-toolbar"/);
  assert.match(html, /<h2>Imagine<\/h2>/);
  assert.match(html, /class="prompt-mode-row imagine-mode-row"/);
  assert.match(html, /id="imagine-input"[^>]*rows="6"/);
  assert.match(html, /Project history — CAD, Imagine, and Wiring/);
  assert.match(css, /\.imagine-input \{[\s\S]{0,120}min-height:\s*clamp\(148px/);
  assert.match(css, /\.imagine-compose-toolbar\.prompt-compose-toolbar/);
  assert.match(css, /\.ph-thumbs/);
  assert.match(css, /\.ph-kind--imagine/);
  assert.match(imagineSrc, /onHistoryChange/);
  assert.match(imagineSrc, /loadHistoryEntry: loadImagineHistoryEntry/);
  assert.match(imagineSrc, /refreshHistory: refreshImagineHistory/);
  assert.match(app, /kind === "imagine"/);
  assert.match(app, /kind === "wiring"/);
});

test("Imagine compose draft is a per-project map and ignores other ids", () => {
  assert.equal(LS_IMAGINE_COMPOSE_DRAFT, "render3d:imagineComposeDraft:v1");
  const storage = memoryStorage({
    [LS_IMAGINE_COMPOSE_DRAFT]: JSON.stringify({
      p1: { prompt: "kettle", project_id: "p1" },
      p2: { prompt: "fork", project_id: "p2" },
      stolen: { prompt: "nope", project_id: "p1" },
    }),
  });
  const map = readImagineComposeDrafts(storage);
  assert.equal(map.p1.prompt, "kettle");
  assert.equal(map.p2.prompt, "fork");
  assert.equal(map.stolen, undefined);
  writeImagineComposeDrafts({ p3: { prompt: "new", project_id: "p3" } }, storage);
  assert.match(storage.getItem(LS_IMAGINE_COMPOSE_DRAFT), /"p3"/);
  assert.match(imagineSrc, /resetForProjectSwitch: resetImagineForProjectSwitch/);
  assert.match(app, /imagineUi\?\.resetForProjectSwitch\?\.\(id\)/);
  assert.match(app, /allowLiveFallback: sameProjectReopen/);
  assert.match(app, /clearPromptHistoryDisplay\(\)/);
  assert.match(html, /promptdraft1/);
});
