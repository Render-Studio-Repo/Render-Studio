import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("./render-agent.js", import.meta.url), "utf8");

test("switching projects closes Design Chat and resets its pop-out chrome", () => {
  const classes = new Set(["prompt-design-chat--popout"]);
  const attributes = {};
  const popout = { textContent: "Dock", setAttribute: (key, value) => { attributes[`popout:${key}`] = value; } };
  const host = {
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
    },
    querySelector: () => popout,
  };
  const toggle = { setAttribute: (key, value) => { attributes[`toggle:${key}`] = value; } };
  const badge = { setAttribute: (key, value) => { attributes[`badge:${key}`] = value; } };

  const context = {};
  vm.runInNewContext(`${topFunction("closeDesignChatForProjectChange").replace("export ", "")}; globalThis.close = closeDesignChatForProjectChange;`, context);
  context.close({ host, toggle, badge });

  assert.equal(classes.has("hidden"), true);
  assert.equal(classes.has("prompt-design-chat--popout"), false);
  assert.equal(popout.textContent, "Pop out");
  assert.deepEqual(attributes, {
    "popout:aria-pressed": "false",
    "toggle:aria-expanded": "false",
    "badge:aria-expanded": "false",
  });
});

test("Hey AI handoff summary records the conversation and selected generation route", () => {
  const context = {};
  vm.runInNewContext(`${topFunction("heyAiDesignChatSummary")}; globalThis.summary = heyAiDesignChatSummary;`, context);
  const summary = context.summary({
    sessionId: "voice-context:p1:1",
    transcript: [
      { role: "user", text: "Make the selected bracket stronger." },
      { role: "assistant", text: "I can thicken the mounting ribs." },
    ],
    prompt: "Thicken the selected bracket mounting ribs to 4 mm.",
    modeLabel: "Mesh",
    targetMode: "edit",
    selectedFile: "bracket.step",
  });
  assert.match(summary, /Hey AI conversation summary/);
  assert.match(summary, /Mesh/);
  assert.match(summary, /edit bracket\.step/);
  assert.match(summary, /Make the selected bracket stronger/);
  assert.match(summary, /Thicken the selected bracket mounting ribs to 4 mm/);
});

test("design conversation sends the contents of Hey AI context references", () => {
  const context = {};
  vm.runInNewContext(`${topFunction("activeMachineDesignContext")}; ${topFunction("designConversationMessage")}; globalThis.message = designConversationMessage;`, context);
  const message = context.message("Model what we discussed", {
    references: [{
      type: "document",
      label: "Hey AI context",
      filename: "hey-ai-session.json",
      text_content: "You: Make a 40 mm mounting bracket.\nAI: I will add two 4 mm holes.",
    }],
  });
  assert.match(message, /Hey AI context/);
  assert.match(message, /Make a 40 mm mounting bracket/);
  assert.match(message, /add two 4 mm holes/);
});

test("an explicit Generate click bypasses first-turn chat routing while Design Chat is open", () => {
  const context = {};
  vm.runInNewContext(`${topFunction("shouldStartDesignChatOnFirstSubmit")}; globalThis.route = shouldStartDesignChatOnFirstSubmit;`, context);

  assert.equal(context.route({ prompt: "Generate this mesh", threadId: "", chatOpen: false }), true);
  assert.equal(context.route({ prompt: "Generate this mesh", threadId: "", chatOpen: true }), false);
});

test("design conversation directs public hardware lookup instead of repeated dimension questions", () => {
  const context = {};
  vm.runInNewContext(`${topFunction("activeMachineDesignContext")}; ${topFunction("designConversationMessage")}; globalThis.message = designConversationMessage;`, context);
  const message = context.message("PETG, plus or minus 180 from center. Look up the OpenArm 2.0 base mount.", {
    machine: { kind: "fdm_printer", name: "Bambu P1S", brand: "Bambu Lab", model: "P1S", specs: { material: "PETG" } },
  });
  assert.match(message, /Ask at most one focused question/);
  assert.match(message, /official documentation, linked references, manufacturer drawings, and official CAD/);
  assert.match(message, /retrieve the official CAD and inspect its interfaces/);
  assert.match(message, /ASSUMED_NOT_FIT_VERIFIED/);
  assert.match(message, /stop interviewing/);
});

test("design conversation includes the bounded active machine and requires target confirmation", () => {
  const context = {};
  vm.runInNewContext(`${topFunction("activeMachineDesignContext")}; ${topFunction("designConversationMessage")}; globalThis.message = designConversationMessage;`, context);
  const message = context.message("Make this for my 3D printer", {
    machine: {
      kind: "fdm_printer",
      name: "Shop X1C",
      brand: "Bambu Lab",
      model: "X1 Carbon",
      specs: {
        build_volume_x_mm: 256,
        build_volume_y_mm: 256,
        build_volume_z_mm: 256,
        nozzle_mm: 0.4,
        material: "PETG",
        printer_tolerance: true,
        notes: "0.2 mm sliding clearance",
        private_token: "must-not-leak",
      },
      toggles: { split_to_bed: true, no_supports: false, "unsafe key": true },
    },
  });
  assert.match(message, /Active manufacturing machine:\nKind: fdm_printer\nName: Shop X1C\nBrand: Bambu Lab\nModel: X1 Carbon/);
  assert.match(message, /Build volume: 256 × 256 × 256 mm/);
  assert.match(message, /Nozzle: 0\.4 mm/);
  assert.match(message, /Material: PETG/);
  assert.match(message, /Tolerance enabled: yes/);
  assert.match(message, /Notes: 0\.2 mm sliding clearance/);
  assert.match(message, /Setting split_to_bed: on/);
  assert.match(message, /Setting no_supports: off/);
  assert.doesNotMatch(message, /unsafe key/);
  assert.match(message, /explicitly confirm Shop X1C with the user before finalizing a render-prompt/);
  assert.doesNotMatch(message, /must-not-leak/);
});
function topFunction(name, text = source) {
  const start = text.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  return text.slice(start, text.indexOf("\n}", start) + 2);
}

class Element {
  children = [];
  dataset = {};
  attributes = {};
  _textContent = "";
  innerHTML = "";
  value = "";
  className = "";
  scrollTop = 0;
  scrollHeight = 1000;
  clientHeight = 400;
  listeners = {};
  classList = { add() {}, toggle() {} };
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.append(child); }
  replaceChildren(...children) { this.children = children; }
  querySelectorAll() { return []; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  dispatchEvent() {}
  focus() {}
  set textContent(value) { this._textContent = String(value ?? ""); }
  get textContent() { return this._textContent || this.children.map((child) => child?.textContent || "").join(""); }
}

function harness(messages = [], api = async () => ({}), {
  storedThreadId = "",
  onGenerateDesignPrompt = async () => ({ ok: true }),
  activeMachine = null,
  modelState = { selectedFilename: "part.glb", targets: [{ filename: "part.glb", label: "Part", subtitle: "GLB" }] },
  onSelectDesignModel = () => {},
  onOpenDesignAiPicker = null,
  references = [],
  images = [],
} = {}) {
  let projectId = "project-a";
  const elements = Object.fromEntries(["feed", "input", "status", "meta", "context"].map((name) => [name, new Element()]));
  const send = new Element();
  const newButton = new Element();
  const prompt = new Element();
  const host = {
    querySelector(selector) { return elements[selector.match(/data-prompt-design-([\w-]+)/)?.[1]] || null; },
    querySelectorAll() { return [send, newButton]; },
  };
  const document = {
    createElement: () => new Element(),
    createTextNode: (text) => ({ textContent: String(text) }),
    getElementById: (id) => id === "prompt-input" ? prompt : null,
    querySelector: () => null,
  };
  const context = vm.createContext({ document, api, onGenerateDesignPrompt, onSelectDesignModel, onOpenDesignAiPicker, getDesignModelState: () => modelState, getActiveMachine: () => activeMachine, getProjectId: () => projectId, getProjectName: () => "Robot", getCurrentUser: () => ({ id: "user", display_name: "Sam", avatar_url: "/sam.png" }), currentUserId: () => "user", RENDER3D_LOGO_URL: "/media/images/render-animations/VR-Animations/render-logo-gear-still.png", localStorage: { getItem() { return storedThreadId; }, setItem() {}, removeItem() {} }, renderAgentModel: "selected-model", getSelectedFile: () => "part.glb", getPromptReferences: () => references, getPromptImages: () => images, Event: class {} });
  const helpers = ["esc", "renderInlineMarkdown", "renderMessageText", "extractRenderPrompt", "activeMachineDesignContext", "designConversationMessage", "heyAiDesignChatSummary"].map((name) => topFunction(name)).join("\n");
  const quoteHelper = topFunction("stripOuterPromptQuotes", readFileSync(new URL("./prompt-ref.js", import.meta.url), "utf8"));
  const start = source.indexOf("  let designChatThread = null;");
  const end = source.indexOf("  function mountPromptDesignChat()", start);
  vm.runInContext(`${helpers}\n${quoteHelper}\nfunction renderAgentKeyFields() { return {}; }\n${source.slice(start, end)}\nglobalThis.chat = { renderDesignChat, sendDesignChat, loadDesignChat, appendHeyAiSummary, settleDesignGeneration: (host, detail) => settleDesignGeneration(host, detail), queue: () => designChatGenerationQueue, seed(messages) { designChatThread = { id: 'thread-a', messages }; designChatThreadProjectId = 'project-a'; }, reset() { designChatThread = null; designChatThreadProjectId = ''; } };`, context);
  context.chat.seed(messages);
  return { ...elements, send, newButton, prompt, host, chat: context.chat, setProject(value) { projectId = value; } };
}

const rows = (feed) => feed.children.filter((item) => item.className.startsWith("prompt-design-message "));

test("Design Chat shows the active Context Lab machine as context", () => {
  const h = harness([], async () => ({}), {
    activeMachine: { kind: "laser", name: "Shop Laser", brand: "Glowforge", model: "Pro", specs: { kerf_mm: 0.18 } },
  });
  h.chat.renderDesignChat(h.host);
  assert.match(h.context.innerHTML, /<small>machine<\/small>Shop Laser/);
  assert.match(h.meta.textContent, /Shop Laser/);
});

test("Hey AI summary persists when Design Chat has not been opened", async () => {
  const requests = [];
  const h = harness([], async (url, options = {}) => {
    requests.push({ url, body: options.body ? JSON.parse(options.body) : null });
    if (url === "/api/render-agent/threads") return { thread: { id: "thread-a", messages: [] } };
    return { thread: { id: "thread-a", messages: [] } };
  });
  const result = await h.chat.appendHeyAiSummary({
    sessionId: "voice-context:project-a:1",
    transcript: [{ role: "user", text: "Make a 40 mm mounting bracket." }],
    prompt: "Create the bracket with two 4 mm holes.",
    modeLabel: "CAD",
    targetMode: "new",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ok: true });
  const sent = requests.find((item) => item.url === "/api/render-agent/messages");
  assert.match(sent.body.message, /Make a 40 mm mounting bracket/);
  assert.match(sent.body.message, /Create the bracket with two 4 mm holes/);
});

test("design turns have speaker labels and safe paragraphs, lists, emphasis and code", () => {
  const h = harness([{ role: "user", content: "[AI CAD DESIGN CONVERSATION]\nContext\nUser message: Keep my **mount**" }, { role: "assistant", content: "## Fit\n\nUse **New** with `part.glb`.\n\n- Keep the cradle\n- Check the fit\n\n```js\n<img src=x onerror=alert(1)>\n```\n\n<script>alert(1)</script>" }]);
  h.chat.renderDesignChat(h.host);
  const [user, assistant] = rows(h.feed);
  assert.equal(user.children[0].children[0].className, "prompt-design-message-avatar");
  assert.equal(user.children[0].children[0].src, "/sam.png");
  assert.equal(user.children[0].children[1].textContent, "You");
  assert.equal(user.children[1].innerHTML, "<p>Keep my <strong>mount</strong></p>");
  assert.match(assistant.children[0].children[0].src, /render-logo-gear-still\.png/);
  assert.equal(assistant.children[0].children[1].textContent, "Render Design Partner");
  assert.match(assistant.children[1].innerHTML, /<h3[^>]*>Fit<\/h3>/);
  assert.match(assistant.children[1].innerHTML, /<strong>New<\/strong> with <code>part.glb<\/code>/);
  assert.match(assistant.children[1].innerHTML, /<li>Keep the cradle<\/li><li>Check the fit<\/li>/);
  assert.match(assistant.children[1].innerHTML, /<pre[^>]*><code>&lt;img src=x onerror=alert\(1\)&gt;<\/code><\/pre>/);
  assert.match(assistant.children[1].innerHTML, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(assistant.children[1].innerHTML, /<script|<img/);
});

test("bare and Markdown links render as safe clickable links", () => {
  const h = harness([{ role: "user", content: "Use https://example.com/part and [datasheet](https://example.com/spec.pdf)" }]);
  h.chat.renderDesignChat(h.host);
  const html = rows(h.feed)[0].children[1].innerHTML;
  assert.match(html, /href="https:\/\/example\.com\/part" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, />datasheet<\/a>/);
});

test("sending displays the user turn and pending reply before a server response, then reconciles once", async () => {
  let resolve;
  const response = new Promise((done) => { resolve = done; });
  const h = harness([], () => response);
  h.input.value = "Make it smaller";
  const pending = h.chat.sendDesignChat(h.host);
  let messages = rows(h.feed);
  assert.equal(messages[0].children[0].children[1].textContent, "You");
  assert.equal(messages[0].children[1].innerHTML, "<p>Make it smaller</p>");
  assert.equal(messages[1].children[1].innerHTML, "<p>Thinking through your design…</p>");
  assert.equal(h.send.disabled, true);
  assert.equal(h.newButton.disabled, true);
  assert.equal(h.feed.scrollTop, 1000);
  resolve({ thread: { id: "thread-a", messages: [{ role: "user", content: "Make it smaller" }, { role: "assistant", content: "What width?" }] } });
  await pending;
  messages = rows(h.feed);
  assert.equal(messages.length, 2);
  assert.equal(messages[1].children[1].innerHTML, "<p>What width?</p>");
  assert.equal(h.send.disabled, false);
  assert.equal(h.feed.attributes["aria-busy"], "false");
});

test("failed send keeps the user message and draft, and retry success removes the failed duplicate", async () => {
  let attempts = 0;
  const h = harness([], async () => {
    if (++attempts === 1) throw new Error("Connection lost");
    return { thread: { id: "thread-a", messages: [{ role: "user", content: "Keep the base" }, { role: "assistant", content: "Understood." }] } };
  });
  h.input.value = "Keep the base";
  await h.chat.sendDesignChat(h.host);
  assert.equal(rows(h.feed)[0].children[1].innerHTML, "<p>Keep the base</p>");
  assert.equal(rows(h.feed)[0].children[2].textContent, "Reply failed. Your message is saved here; retry from the text box.");
  assert.equal(h.input.value, "Keep the base");
  assert.equal(h.status.textContent, "Connection lost");
  await h.chat.sendDesignChat(h.host);
  assert.equal(rows(h.feed).length, 2);
  assert.equal(rows(h.feed)[1].children[1].innerHTML, "<p>Understood.</p>");
});

test("reading older history preserves scroll when a reply arrives", async () => {
  let resolve;
  const h = harness([{ role: "assistant", content: "Earlier reply" }], () => new Promise((done) => { resolve = done; }));
  h.input.value = "Continue";
  const pending = h.chat.sendDesignChat(h.host);
  h.feed.scrollTop = 125;
  resolve({ thread: { id: "thread-a", messages: [{ role: "user", content: "Continue" }, { role: "assistant", content: "Latest reply" }] } });
  await pending;
  assert.equal(h.feed.scrollTop, 125);
  assert.equal(rows(h.feed)[1].children[1].innerHTML, "<p>Latest reply</p>");
});

test("applying an assistant proposal only updates the reviewable prompt", () => {
  const h = harness([{ role: "assistant", content: "Ready for review.\n\n```render-prompt\nMake a 20 mm cradle\n```" }]);
  h.chat.renderDesignChat(h.host);
  const actions = rows(h.feed)[0].children.find((item) => item.className === "prompt-design-message-actions");
  const apply = actions.children.find((item) => item.dataset.promptDesignApply);
  assert.equal(apply.textContent, "Review prompt");
  apply.listeners.click();
  assert.equal(h.prompt.value, "Make a 20 mm cradle");
  assert.equal(h.status.textContent, "Draft copied to the CAD composer for review.");
});

test("a ready proposal can invoke the CAD harness for a selected-model iteration", async () => {
  const calls = [];
  const h = harness([{ role: "assistant", content: "Ready.\n```render-prompt\nMake the cradle 8 mm thicker\n```" }], async () => ({}), {
    onGenerateDesignPrompt: async (payload) => { calls.push(payload); return { ok: true }; },
  });
  h.chat.renderDesignChat(h.host);
  const actions = rows(h.feed)[0].children.find((item) => item.className === "prompt-design-message-actions");
  const iterate = actions.children.find((item) => item.dataset.promptDesignGenerate === "edit");
  assert.equal(iterate.textContent, "Edit selected: Part");
  iterate.listeners.click();
  assert.equal(iterate.disabled, true);
  assert.equal(iterate.textContent, "Running…");
  iterate.listeners.click();
  assert.equal(calls.length, 1);
  assert.match(h.status.textContent, /Starting CAD harness iteration/);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(JSON.stringify(calls), JSON.stringify([{
    prompt: "Make the cradle 8 mm thicker",
    projectId: "project-a",
    targetMode: "edit",
    selectedFilename: "part.glb",
    references: [],
    images: [],
  }]));
  assert.match(h.status.textContent, /CAD harness started/);
});

test("a failed queued CAD command pauses and retries the frozen packet with every attachment", async () => {
  const calls = [];
  let attempts = 0;
  const references = [{ id: "ref-1", filename: "base.step", type: "component" }];
  const images = [{ id: "img-1", name: "sketch.png", data_url: "data:image/png;base64,AA==" }];
  const h = harness([{ role: "assistant", content: "Ready.\n```render-prompt\nBuild the saved base\n```" }], async () => ({}), {
    references,
    images,
    onGenerateDesignPrompt: async (payload) => {
      calls.push(structuredClone(payload));
      if (++attempts === 1) return { ok: false, error: "cadgen inspect exited 2: topology gate failed" };
      return { ok: true };
    },
  });
  h.chat.renderDesignChat(h.host);
  const actions = rows(h.feed)[0].children.find((item) => item.className === "prompt-design-message-actions");
  actions.children.find((item) => item.dataset.promptDesignGenerate === "new").listeners.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const queue = h.feed.children.find((item) => item.dataset.promptDesignQueue);
  assert.ok(queue);
  assert.match(queue.textContent, /cadgen inspect exited 2: topology gate failed/);
  assert.match(h.status.textContent, /queue is paused/i);
  references[0].filename = "changed.step";
  images.length = 0;
  queue.children[1].children[1].listeners.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(h.chat.queue()[0].status, "running");
});

test("Design Chat labels the AI and working models and switches among multiple CAD models", () => {
  const selected = [];
  const aiPickers = [];
  const modelState = {
      selectedFilename: "arm.glb",
      targets: [
        { filename: "arm.glb", label: "OpenArm", subtitle: "GLB" },
        { filename: "base.step", label: "Rotating base", subtitle: "STEP" },
      ],
    };
  const h = harness([{ role: "assistant", content: "Ready.\n```render-prompt\nStrengthen the selected mount.\n```" }], async () => ({}), {
    modelState,
    onSelectDesignModel: (filename) => { selected.push(filename); modelState.selectedFilename = filename; },
    onOpenDesignAiPicker: (anchor) => { aiPickers.push(anchor); },
  });
  h.chat.renderDesignChat(h.host);
  assert.match(h.meta.textContent, /AI model: selected-model/);
  const aiPicker = h.meta.children[0];
  assert.equal(aiPicker.className, "prompt-design-ai-picker");
  aiPicker.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(aiPickers, [aiPicker]);
  assert.match(h.meta.textContent, /Working model:/);
  const picker = h.meta.children[1].children[0];
  assert.equal(picker.value, "arm.glb");
  picker.value = "base.step";
  picker.listeners.change();
  assert.deepEqual(selected, ["base.step"]);
  const actions = rows(h.feed)[0].children.find((item) => item.className === "prompt-design-message-actions");
  const edit = actions.children.find((item) => item.dataset.promptDesignGenerate === "edit");
  assert.equal(edit.textContent, "Edit selected: Rotating base");
});

test("every proposal offers the selected model or a new part as explicit routes", async () => {
  const calls = [];
  const h = harness([{ role: "assistant", content: "Ready.\n```render-prompt\nUsing Jake, create a NEW simplified rotating-base assembly and replace the bulky enclosure.\n```" }], async () => ({}), {
    onGenerateDesignPrompt: async (payload) => { calls.push(payload); return { ok: true }; },
  });
  h.chat.renderDesignChat(h.host);
  const actions = rows(h.feed)[0].children.find((item) => item.className === "prompt-design-message-actions");
  const build = actions.children.find((item) => item.dataset.promptDesignGenerate === "new");
  const edit = actions.children.find((item) => item.dataset.promptDesignGenerate === "edit");
  assert.equal(build.textContent, "Build a new part");
  assert.equal(edit.textContent, "Edit selected: Part");
  edit.listeners.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls[0].targetMode, "edit");
  assert.equal(calls[0].selectedFilename, "part.glb");
});

test("Design Chat queues improvements and retargets each edit to the latest completed model", async () => {
  const calls = [];
  const h = harness([
    { role: "assistant", content: "First.\n```render-prompt\nMake the base thinner\n```" },
    { role: "assistant", content: "Second.\n```render-prompt\nAdd mounting ears\n```" },
  ], async () => ({}), {
    onGenerateDesignPrompt: async (payload) => {
      calls.push(structuredClone(payload));
      return { ok: true, accepted: true, traceId: `trace-${calls.length}` };
    },
  });
  h.chat.renderDesignChat(h.host);
  const proposalRows = rows(h.feed);
  const firstEdit = proposalRows[0].children.find((item) => item.className === "prompt-design-message-actions")
    .children.find((item) => item.dataset.promptDesignGenerate === "edit");
  const secondEdit = proposalRows[1].children.find((item) => item.className === "prompt-design-message-actions")
    .children.find((item) => item.dataset.promptDesignGenerate === "edit");
  firstEdit.listeners.click();
  secondEdit.listeners.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 1);
  assert.equal(h.chat.queue().length, 2);
  h.chat.settleDesignGeneration(h.host, {
    projectId: "project-a",
    trace_id: "trace-1",
    status: "complete",
    filename: "base_iteration_1.glb",
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].selectedFilename, "base_iteration_1.glb");
  assert.equal(h.chat.queue().length, 1);
});


test("a slow history response cannot replace a newer sent turn", async () => {
  let resolveHistory;
  const h = harness([], (url) => url.includes("/threads/")
    ? new Promise((done) => { resolveHistory = done; })
    : Promise.resolve({ thread: { id: "thread-a", messages: [{ role: "user", content: "Keep this new turn" }, { role: "assistant", content: "New reply" }] } }), { storedThreadId: "thread-a" });
  const loading = h.chat.loadDesignChat(h.host);
  h.input.value = "Keep this new turn";
  await h.chat.sendDesignChat(h.host);
  resolveHistory({ thread: { id: "thread-a", messages: [{ role: "assistant", content: "Stale history" }] } });
  await loading;
  assert.equal(rows(h.feed).length, 2);
  assert.equal(rows(h.feed)[0].children[1].innerHTML, "<p>Keep this new turn</p>");
  assert.equal(rows(h.feed)[1].children[1].innerHTML, "<p>New reply</p>");
});

test("history loaded for the previous project is discarded after a project switch", async () => {
  let resolveHistory;
  const h = harness([], () => new Promise((done) => { resolveHistory = done; }), { storedThreadId: "thread-a" });
  const loading = h.chat.loadDesignChat(h.host);
  h.setProject("project-b");
  resolveHistory({ thread: { id: "thread-a", messages: [{ role: "assistant", content: "Private to project A" }] } });
  await loading;
  h.chat.renderDesignChat(h.host);
  assert.equal(rows(h.feed).length, 0);
  assert.equal(h.feed.children[0].textContent, "Talk through the design. I’ll ask for missing dimensions or fit details, then draft a prompt you can approve.");
});

test("a late failed history request cannot erase a newer conversation", async () => {
  let rejectHistory;
  const h = harness([], (url) => url.includes("/threads/")
    ? new Promise((resolve, reject) => { rejectHistory = reject; })
    : Promise.resolve({ thread: { id: "thread-a", messages: [{ role: "user", content: "Preserve me" }, { role: "assistant", content: "Current reply" }] } }), { storedThreadId: "thread-a" });
  const loading = h.chat.loadDesignChat(h.host);
  h.input.value = "Preserve me";
  await h.chat.sendDesignChat(h.host);
  rejectHistory(new Error("History unavailable"));
  await loading;
  assert.equal(rows(h.feed).length, 2);
  assert.equal(rows(h.feed)[1].children[1].innerHTML, "<p>Current reply</p>");
});


test("sending before history loads continues the stored thread", async () => {
  let resolveHistory;
  const requests = [];
  const h = harness([], (url, options) => {
    if (url.includes("/threads/")) return new Promise((done) => { resolveHistory = done; });
    requests.push({ url, body: JSON.parse(options.body) });
    return Promise.resolve({ thread: { id: "saved-thread", messages: [{ role: "assistant", content: "Earlier answer" }, { role: "user", content: "Continue my design" }, { role: "assistant", content: "Continuing" }] } });
  }, { storedThreadId: "saved-thread" });
  h.chat.reset();
  const loading = h.chat.loadDesignChat(h.host);
  h.input.value = "Continue my design";
  await h.chat.sendDesignChat(h.host);
  resolveHistory({ thread: { id: "saved-thread", messages: [{ role: "assistant", content: "Earlier answer" }] } });
  await loading;
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/api/render-agent/messages");
  assert.equal(requests[0].body.thread_id, "saved-thread");
  assert.equal(rows(h.feed).length, 3);
  assert.equal(rows(h.feed)[2].children[1].innerHTML, "<p>Continuing</p>");
});
