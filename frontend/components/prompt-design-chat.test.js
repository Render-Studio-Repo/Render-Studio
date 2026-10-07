import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "render-agent.js"), "utf8");
const css = readFileSync(join(here, "render-agent-agents.css"), "utf8");
const app = readFileSync(join(here, "../studio/app.js"), "utf8");

function appFunction(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} should exist`);
  const bodyStart = app.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < app.length; index += 1) {
    if (app[index] === "{") depth += 1;
    if (app[index] === "}" && --depth === 0) return app.slice(start, index + 1);
  }
  throw new Error(`Could not read ${name}`);
}

test("AI CAD Prompt mounts a conversational design chat", () => {
  assert.match(source, /data-prompt-design-chat/);
  assert.match(source, /Design conversation/);
  assert.match(source, /getSelectedFile\?\.\(\)/);
  assert.match(source, /fields\.model \|\| renderAgentModel/);
  assert.match(source, /project_id: projectId \|\| null/);
  assert.match(source, /getPromptReferences/);
  assert.match(source, /data-prompt-design-upload/);
  assert.match(source, /attachments: outgoingAttachments/);
  assert.match(source, /render3d:prompt-references-changed/);
});

test("Design Chat defaults to the active viewport CAD and excludes document entries", () => {
  const context = vm.createContext({
    selectedFile: "new-base.glb",
    projectTree: {
      getComponents: () => [
        { name: "electronics_build_sourcing.md" },
        { name: "old-arm.step", stem: "Old arm" },
        { name: "new-base.glb", stem: "New base" },
      ],
    },
    projectAssembly: { has: (name) => name === "new-base.glb" },
    isBrowserComponentHidden: () => false,
    isFixtureArtifactFilename: () => false,
    viewportViewerFor: (entry) => entry.name,
    isViewportViewableFilename: (name) => /\.glb$/i.test(name),
    selectedObjectFilename: () => "new-base.glb",
    promptTargetEntryLabel: (entry) => entry.stem || entry.name,
    promptTargetEntrySubtitle: () => "CAD",
    document: { getElementById: () => ({ value: "electronics_build_sourcing.md" }) },
  });
  vm.runInContext(`${appFunction("visiblePromptTargetEntries")}\n${appFunction("designModelState")}\nglobalThis.state = designModelState();`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.state)), {
    selectedFilename: "new-base.glb",
    targets: [
      { filename: "new-base.glb", label: "New base", subtitle: "CAD" },
      { filename: "old-arm.step", label: "Old arm", subtitle: "CAD" },
    ],
  });
});

test("Design Chat refreshes its working model when the viewport selection changes", () => {
  assert.match(source, /addEventListener\("render3d:active-model-changed"[\s\S]*renderDesignChat\(host\)/);
  assert.match(app, /selectedFile = catalogName;[\s\S]*dispatchEvent\(new CustomEvent\("render3d:active-model-changed"/);
});

test("pop-out is resizable and shares the same chat host", () => {
  assert.match(source, /host\.classList\.toggle\("prompt-design-chat--popout"\)/);
  assert.match(source, /data-prompt-design-popout/);
  assert.match(css, /\.prompt-design-chat--popout[\s\S]*resize: both/);
  assert.doesNotMatch(source, /window\.open\([^)]*prompt-design/i);
});

test("assistant proposals expose explicit review and CAD harness generation actions", () => {
  assert.match(source, /```render-prompt/);
  assert.match(source, /prompt\.value = proposed/);
  assert.match(source, /Draft copied to the CAD composer for review\./);
  assert.match(source, /apply\.dataset\.promptDesignApply = "1"/);
  assert.match(source, /Build a new part/);
  assert.match(source, /`Edit selected: \$\{selectedModelLabel\}`/);
  assert.match(source, /enqueueDesignGeneration\(host, designGenerationPacket\(\{[\s\S]*prompt: proposed,[\s\S]*targetMode,[\s\S]*selectedFilename/);
  assert.match(source, /onGenerateDesignPrompt\?\.\(packet\)/);
  assert.match(source, /promptDesignRetryGeneration/);
  assert.match(app, /onGenerateDesignPrompt:[\s\S]*await refreshPromptAiKeysFromServer\(\)[\s\S]*preparedReferences: packet\.references[\s\S]*preparedImages: packet\.images[\s\S]*preparedProjectId: packet\.projectId[\s\S]*preparedTarget: packet\.preparedTarget/);
  assert.doesNotMatch(source.slice(source.indexOf("const buildWithHarness"), source.indexOf("const build =", source.indexOf("const buildWithHarness"))), /dispatchEvent\(new Event\("change"/);
});

test("conversation contract researches public hardware and limits questions before a harness action", () => {
  assert.match(source, /Ask at most one focused question in a reply/);
  assert.match(source, /when the user names publicly documented hardware or says to look it up, use official documentation/);
  assert.match(source, /Never ask them to upload public CAD you can identify/);
  assert.match(source, /adjustable parametric adapter with explicit ASSUMED_NOT_FIT_VERIFIED dimensions/);
  assert.match(source, /never require exact manufacturer CAD and then leave generation blocked/);
  assert.match(source, /stop interviewing/);
  assert.match(source, /generation starts only from an explicit CAD harness action/i);
  assert.match(source, /build a new model, or iterate the selected model with the CAD harness/);
  assert.match(source, /localStorage\.setItem\(designChatStorageKey\(\), designChatThread\.id\)/);
});

test("CAD harness actions queue traced generations and wait for settlement", () => {
  assert.match(source, /designChatGenerationPending = true/);
  assert.match(source, /designChatGenerationQueue\.push\(item\)/);
  assert.match(source, /render3d:generation-settled/);
  assert.match(source, /active\.traceId !== settledTrace/);
  assert.match(source, /The design queue is paused/);
  assert.match(app, /traceId: data\.trace_id/);
  assert.match(app, /render3d:generation-settled/);
});

test("the first prompt submission becomes the first design-chat turn", () => {
  assert.match(source, /shouldStartDesignChatOnFirstSubmit/);
  assert.match(source, /document\.getElementById\("btn-prompt"\)\?\.addEventListener\("click"/);
  assert.match(source, /event\.stopImmediatePropagation\?\.\(\)/);
  assert.match(source, /chatInput\.value = initialPrompt/);
  assert.match(source, /await sendDesignChat\(host\)/);
  assert.match(source, /activeDesignChatThreadId\(\) \|\| storedDesignChatThreadId\(\)/);
  assert.match(source, /designChatThreadProjectId === String\(getProjectId\?\.\(\) \|\| ""\)/);
  assert.match(source, /data-prompt-design-badge/);
  assert.match(source, /Design chat active/);
  assert.doesNotMatch(source, /prompt-design-toggle/);
  assert.doesNotMatch(source, /badge\.hidden = true/);
  assert.match(source, /active[\s\S]*\? '<span aria-hidden="true"><\/span>Design chat active'[\s\S]*: "Design chat"/);
  assert.match(source, /badge\.addEventListener\("click", \(\) => host\.classList\.contains\("hidden"\) \? void open\(\) : closeChat\(\)\)/);
  assert.match(source, /syncDesignChatBadge/);
  assert.match(css, /\.prompt-design-badge/);
});

test("design chat permits guest fallback without weakening CAD generation routing", () => {
  assert.match(source, /speed: "fast",\s*allow_guest_fallback: true,\s*\.\.\.fields/);
  assert.doesNotMatch(app, /allow_guest_fallback/);
});

test("Enter in design chat cannot fall through to Generate", () => {
  assert.match(source, /data-prompt-design-input/);
  assert.match(source, /event\.key !== "Enter" \|\| event\.shiftKey \|\| event\.isComposing/);
  assert.match(source, /event\.stopPropagation\(\)/);
  assert.match(source, /void sendDesignChat\(host\)/);
});

test("design chat preserves pasted links and shows face and lasso references", () => {
  assert.match(source, /class="prompt-design-context"/);
  assert.match(source, /\["face", "edge", "corner", "lasso", "path"\]/);
  assert.match(source, /target="_blank" rel="noopener noreferrer"/);
});

test("design chat collapses connected context into a compact popover", () => {
  assert.match(source, /class="prompt-design-context-disclosure"/);
  assert.match(source, /\$\{chips\.length\} connected/);
  assert.match(source, /class="prompt-design-context-popover" role="list"/);
  assert.match(css, /\.prompt-design-context-popover[\s\S]*position: absolute/);
  assert.match(css, /\.prompt-design-context-popover[\s\S]*max-height: 210px/);
});

test("Design Chat converts HEIC and HEIF uploads to PNG for picker and drop attachments", () => {
  assert.match(source, /from "\.\.\/media\/heic-to-png\.js\?v=heicpng1"/);
  assert.match(source, /async function addDesignChatFiles[\s\S]{0,800}isHeicFile\(file\) \? await convertHeicFileToPng\(file\) : file/);
  assert.match(source, /accept="[^"]*image\/heic[^"]*\.heic,\.heif/);
  assert.match(source, /data-prompt-design-upload[\s\S]{0,300}addDesignChatFiles/);
  assert.match(source, /addEventListener\("drop"[\s\S]{0,300}addDesignChatFiles/);
});

test("Design Chat carries its uploaded references into every CAD and Mesh generation packet", () => {
  assert.match(source, /let designChatReferenceAttachments = \[\]/);
  assert.match(source, /function designChatGenerationImages\([\s\S]*designChatReferenceAttachments/);
  assert.match(source, /function designChatGenerationReferences\([\s\S]*designChatReferenceAttachments/);
  assert.match(source, /references: designChatGenerationReferences\(getPromptReferences\?\.\(\)\)/);
  assert.match(source, /images: designChatGenerationImages\(getPromptImages\?\.\(\)\)/);
  assert.match(source, /rememberDesignChatReferences\(outgoingAttachments\)/);
  assert.match(source, /designChatReferenceAttachments = \[\];[\s\S]*render3d:project-changed/);
});

test("Design Chat infers image MIME types when browsers omit the upload type", () => {
  assert.match(source, /function designAttachmentMediaType/);
  assert.match(source, /match\(\/\^data:image\\\//);
  assert.match(source, /media_type: designAttachmentMediaType\(ready, dataUrl\)/);
});

test("Hey AI freezes the selected generation route and sends its conversation to Design Chat", () => {
  assert.match(app, /const frozenMode = promptMode/);
  assert.match(app, /preparedTarget:\s*\{[\s\S]*promptMode: handoff\.promptMode[\s\S]*generationMode: handoff\.generationMode[\s\S]*targetMode: handoff\.targetMode/);
  assert.match(app, /stop_after_response: true/);
  assert.match(app, /showViewportOverlay\(projectId, `Starting \$\{modeLabel\} generation…`/);
  assert.match(app, /renderAgentUi\?\.appendHeyAiSummary\?\.\(handoff\)/);
  assert.match(source, /async function appendHeyAiSummary/);
  assert.match(source, /designChatVoiceSessions\.has\(sessionId\)/);
});

test("Design Chat places the shared Hey AI control under Upload refs and exposes bounded chat context", () => {
  assert.match(source, /class="prompt-design-input-tools"[\s\S]*prompt-design-upload[\s\S]*prompt-design-hey-ai/);
  assert.match(source, /prompt-design-hey-ai[^>]+data-voice-order="1"[^>]+data-voice-idle-label="Hey AI"/);
  assert.match(source, /function designConversationContext\(\)[\s\S]*\.slice\(-12\)[\s\S]*\.slice\(0, 2000\)/);
  assert.match(source, /getDesignConversationContext: designConversationContext/);
  assert.match(app, /design_conversation: renderAgentUi\?\.getDesignConversationContext\?\.\(\) \|\| null/);
  assert.match(css, /\.prompt-design-input-tools[^{]*\{[^}]*flex-direction:\s*column/);
});

test("rig generation preserves CAD unless Rigging was already selected", () => {
  assert.match(app, /const keepRiggingVisible = workspaceModes\?\.getDesignTab\?\.\(\) === "RIGGING"/);
  assert.match(app, /if \(keepRiggingVisible\) \{[\s\S]*workspaceModes\?\.setDesignTab\?\.\("RIGGING"\)/);
});
