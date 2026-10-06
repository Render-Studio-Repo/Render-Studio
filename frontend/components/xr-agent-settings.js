/** Desktop/companion settings and explicit review of voice-discussed CAD edits. */
import {
  XR_AGENT_HISTORY_LIMIT, XR_AGENT_THROW_AUDIO_SECONDS,
  saveXrAgentThrowSound, deleteXrAgentThrowSound, playXrAgentThrowSound,
} from "../xr/xr-agent-state.js?v=20260915-xragent1-20260915-xragent3&voicesample=20260916-1&vrsave=20260916-1&astra=20260916-5";
import { createVoiceSamplePlayer } from "./voice-sample.js?voicesample=20260916-1&voice-natural=20260918-1";

function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content != null) element.textContent = String(content);
  return element;
}

/**
 * createXrAgentSettings({store,onStart,onStop,onGenerate,onOpenPc})
 * onGenerate({mode:'one'|'all',changes:[snapshot]}) must execute through the
 * existing CAD generator and update each store change's execution status.
 * Returns open('settings'|'changes'|'history'), openChanges(), close(),
 * setStatus(message), dispose(). No CAD edits execute just by opening review.
 */
export function createXrAgentSettings({ store, onStart, onStop, onGenerate, onOpenPc, onThrowSound, samplePlayer } = {}) {
  if (!store?.getState) throw new Error("Agent settings require an agent store.");
  if (!document.querySelector("link[data-xr-agent-settings]")) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("./xr-agent-settings.css?v=20260915-xragent1-20260915-xragent3&voicesample=20260916-1&vrsave=20260916-1", import.meta.url).href;
    link.dataset.xrAgentSettings = "1";
    document.head.append(link);
  }
  const overlay = node("div", "xrag-settings-overlay");
  overlay.hidden = true;
  const panel = node("section", "xrag-settings-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  const titleId = `xrag-title-${Math.random().toString(36).slice(2)}`;
  panel.setAttribute("aria-labelledby", titleId);
  const header = node("header", "xrag-settings-header");
  const headingBlock = node("div");
  const eyebrow = node("div", "xrag-settings-eyebrow", "VR VOICE COMPANION");
  const heading = node("h2", "", "Astra settings");
  heading.id = titleId;
  headingBlock.append(eyebrow, heading);
  const closeButton = button("×", close, "xrag-close");
  closeButton.setAttribute("aria-label", "Close agent settings");
  header.append(headingBlock, closeButton);
  const search = node("input", "xrag-search");
  search.type = "search";
  search.placeholder = "Search settings, prompts, and changes…";
  search.setAttribute("aria-label", "Search agent settings and history");
  const navigation = node("nav", "xrag-tabs");
  navigation.setAttribute("aria-label", "Agent settings sections");
  const body = node("div", "xrag-settings-body");
  const status = node("div", "xrag-status");
  status.setAttribute("role", "status");
  const footer = node("footer", "xrag-settings-footer");
  const start = button("Start voice", () => run(onStart, "Voice enabled."), "xrag-primary");
  const stop = button("Turn off agent", () => run(onStop, "Agent turned off."));
  const pc = button("Open on my PC", () => run(onOpenPc, "Settings request sent to your connected desktop."));
  start.disabled = typeof onStart !== "function";
  stop.disabled = typeof onStop !== "function";
  pc.disabled = typeof onOpenPc !== "function";
  footer.append(start, stop, pc);
  panel.append(header, search, navigation, body, status, footer);
  overlay.append(panel);
  document.body.append(overlay);

  let currentTab = "settings";
  let query = "";
  let disposed = false;
  let priorFocus = null;
  let busy = false;
  let previewStop = null;
  const player = samplePlayer || createVoiceSamplePlayer({ getVolume: () => store.getState().settings.volume });
  let lastChangesSignature = "";
  let lastHistorySignature = "";
  const sections = new Map();
  const rows = [];
  const inputBindings = [];
  const tabs = new Map();
  for (const [id, label] of [["settings", "Settings"], ["changes", "Changes"], ["history", "Prompt history"]]) {
    const tabButton = button(label, () => { currentTab = id; render(); });
    tabs.set(id, tabButton);
    navigation.append(tabButton);
    const section = node("div", `xrag-pane xrag-pane-${id}`);
    sections.set(id, section);
    body.append(section);
  }

  const persistTimers = new Map();
  function persistField(key, value, delay = 0) {
    const write = () => {
      persistTimers.delete(key);
      store.updateSettings({ [key]: value });
      setStatus(store.getPersistenceError?.() || "Settings updated.");
    };
    clearTimeout(persistTimers.get(key));
    if (delay <= 0) { persistTimers.delete(key); write(); return; }
    persistTimers.set(key, setTimeout(write, delay));
  }
  function flushPersists() {
    for (const [key, timer] of persistTimers) {
      clearTimeout(timer);
      persistTimers.delete(key);
      const binding = inputBindings.find((row) => row.key === key);
      if (!binding) continue;
      const value = binding.type === "checkbox" ? binding.control.checked
        : binding.type === "range" ? Number(binding.control.value) : binding.control.value;
      store.updateSettings({ [key]: value });
    }
  }
  function button(label, action, className = "") {
    const element = node("button", `xrag-button ${className}`, label);
    element.type = "button";
    element.addEventListener("click", action);
    return element;
  }
  function setStatus(message) { status.textContent = message || ""; }
  async function run(handler, success) {
    if (!handler) return;
    try { await handler(); if (success) setStatus(success); }
    catch (error) { setStatus(error?.message || "The request could not be completed."); }
  }
  function group(title, description) {
    const element = node("section", "xrag-group");
    element.append(node("h3", "", title));
    if (description) element.append(node("p", "xrag-description", description));
    sections.get("settings").append(element);
    return element;
  }
  function field(parent, key, label, description, type = "text", options = null) {
    const row = node("label", `xrag-field${type === "checkbox" ? " xrag-toggle" : ""}`);
    const labelBlock = node("span", "xrag-field-label");
    labelBlock.append(node("strong", "", label));
    if (description) labelBlock.append(node("small", "", description));
    let control;
    if (options) {
      control = node("select");
      for (const [value, title] of options) {
        const option = node("option", "", title); option.value = value; control.append(option);
      }
    } else if (type === "textarea") control = node("textarea");
    else { control = node("input"); control.type = type; }
    control.name = key;
    control.setAttribute("aria-label", label);
    if (type === "range") { control.min = "0"; control.max = "1"; control.step = "0.05"; }
    if (type === "textarea") { control.rows = 5; control.maxLength = 8000; }
    if (type === "text") control.maxLength = 80;
    const event = type === "range" || type === "text" || type === "textarea" ? "input" : "change";
    const delay = type === "range" || type === "text" || type === "textarea" ? 150 : 0;
    control.addEventListener(event, () => {
      const value = type === "checkbox" ? control.checked : type === "range" ? Number(control.value) : control.value;
      persistField(key, value, delay);
    });
    row.append(labelBlock, control);
    parent.append(row);
    rows.push({ element: row, parent, match: `${label} ${description || ""} ${key}`.toLowerCase() });
    inputBindings.push({ key, control, type });
    return control;
  }
  const identity = group("Your companion", "Use its name to address it while voice is enabled. The microphone is active only after you start voice.");
  field(identity, "name", "Agent name", "Shown on the agent and in its history.");
  field(identity, "wakeName", "Wake name", "For example: “Hey Astra, explain this connection.”");
  field(identity, "avatar", "Low-poly appearance", "Choose the look of your voice companion.", "select", [["orb", "Voice bubble"], ["robot", "Small robot"], ["gem", "Faceted gem"]]);

  const voice = group("Voice and context", "The voice model is separate from your selected CAD model. CAD changes continue through the model selected in Studio.");
  const voiceModelSelect = field(voice, "voiceModel", "Voice model", "Realtime uses an OpenAI API key. Buffered Astra uses ChatGPT. Buffered Claude uses a connected Claude subscription. Microphone transcription and speech output remain separate provider settings.", "select", [
    ["gpt-realtime-mini", "Realtime Mini · OpenAI API key"],
    ["gpt-realtime", "Realtime · OpenAI API key"],
    ["gpt-realtime-1.5", "Realtime 1.5 · OpenAI API key"],
    ["gpt-6-astra", "Astra · buffered voice"],
    ["gpt-6-astra-pro", "Astra Pro · buffered voice"],
    ["claude-opus-4-8", "Claude Opus · buffered voice"],
  ]);
  function stopThrowPreview() { previewStop?.(); previewStop = null; }
  function stopVoicePreview() { player.stop(); }
  const voicePicker = node("div", "xrag-field xrag-voice-identity");
  const voiceLabelBlock = node("span", "xrag-field-label");
  voiceLabelBlock.append(node("strong", "", "Hey AI voice"));
  voiceLabelBlock.append(node("small", "", "Marin is the single voice used by every Hey AI session."));
  voicePicker.append(voiceLabelBlock);
  voice.append(voicePicker);
  rows.push({ element: voicePicker, parent: voice, match: "hey ai voice marin single" });
  field(voice, "volume", "My listening volume", "Affects how loudly you hear this agent.", "range");
  field(voice, "includeVisualContext", "Share viewport visuals", "Let the voice model inspect available rendered views. Headset passthrough camera access depends on device support.", "checkbox");
  field(voice, "includeSelectionMetadata", "Share pointed selection details", "Include selected objects, wires, pins, specifications, and sourced documentation links.", "checkbox");

  const networking = group("Room audio and access", "Room sharing is off by default. Realtime audio can be shared; buffered browser speech cannot. Other participants control their own volume or mute.");
  field(networking, "showToRoom", "Let the room see my agent", "Show Astra to other people in the VR room without sharing audio.", "checkbox");
  field(networking, "shareWithRoom", "Let the room hear my agent", "Shares an available Realtime output stream with participants in this room.", "checkbox");
  field(networking, "allowOtherUsersTrigger", "Let others address my agent", "Allow other participants in this room to call your agent by its wake name. Generation still requires your approval.", "checkbox");

  const prompting = group("Prompt configuration", "Instruction changes update the active voice session. Discussion proposes changes; your approval starts generation.");
  field(prompting, "prompt", "Agent instructions", "Describe your preferences, constraints, and how you want the agent to explain its proposals.", "textarea");

  const sound = group("Throw-to-dismiss sound", `Upload a local audio clip on your PC. Only the first ${XR_AGENT_THROW_AUDIO_SECONDS} seconds play when you throw the agent away.`);
  field(sound, "throwSoundEnabled", "Play dismissal sound", "Use your uploaded clip when the agent is thrown out.", "checkbox");
  const soundRow = node("div", "xrag-field");
  soundRow.append(node("strong", "", "Audio clip · up to 3 MB"));
  const soundName = node("small", "xrag-description");
  const upload = node("input"); upload.type = "file"; upload.accept = "audio/*";
  upload.setAttribute("aria-label", "Upload agent dismissal sound");
  upload.addEventListener("change", async () => {
    if (!upload.files?.[0]) return;
    try {
      const saved = await saveXrAgentThrowSound(upload.files[0]);
      store.updateSettings({ throwSoundName: saved.name });
      await onThrowSound?.(upload.files[0]);
      setStatus("Audio saved. Preview plays only the first three seconds.");
    } catch (error) { setStatus(error.message); }
    finally { upload.value = ""; }
  });
  const soundActions = node("div", "xrag-actions");
  soundActions.append(button("Preview", () => run(async () => {
    stopVoicePreview();
    stopThrowPreview();
    previewStop = await playXrAgentThrowSound({ volume: store.getState().settings.volume });
    if (!previewStop) setStatus("Upload an audio clip first.");
  })), button("Remove clip", () => run(async () => {
    stopThrowPreview(); await deleteXrAgentThrowSound(); store.updateSettings({ throwSoundName: "" }); await onThrowSound?.(null);
  }, "Local audio clip removed.")));
  soundRow.append(soundName, upload, soundActions);
  sound.append(soundRow);
  rows.push({ element: soundRow, parent: sound, match: "throw dismiss sound audio upload clip preview remove 3 mb" });
  const storage = group("History", `Keeps up to ${XR_AGENT_HISTORY_LIMIT} discussion entries and a bounded change history. API keys are managed separately from these settings.`);

  async function generate(changes, mode) {
    if (busy || !changes.length || !onGenerate) return;
    busy = true; renderChanges(); setStatus(mode === "all" ? "Generating the approved changes in order…" : "Generating this approved change…");
    try { await onGenerate({ mode, changes }); setStatus("Generation finished. Inspect each result and leave feedback below."); }
    catch (error) { setStatus(error?.message || "Generation failed. Your proposal is still in the list."); }
    finally { busy = false; renderChanges(); }
  }
  function matches(...values) { return !query || values.join(" ").toLowerCase().includes(query); }
  function empty(parent, message) { parent.append(node("p", "xrag-empty", message)); }
  function renderChanges() {
    const state = store.getState();
    const signature = JSON.stringify([state.changes, query, busy]);
    if (signature === lastChangesSignature) return;
    lastChangesSignature = signature;
    const pane = sections.get("changes"); pane.replaceChildren();
    const pending = state.changes.filter((change) => change.status === "pending");
    const toolbar = node("div", "xrag-review-toolbar");
    toolbar.append(node("p", "xrag-description", "Review the proposed edits. Generate one at a time to inspect and correct each result, or approve all pending changes."));
    const all = button(`Generate all (${pending.length})`, () => generate(pending, "all"), "xrag-primary");
    all.disabled = busy || !pending.length || !onGenerate;
    toolbar.append(all); pane.append(toolbar);
    const displayed = state.changes.filter((change) => matches(change.title, change.prompt, change.result, change.feedback, change.status));
    if (!displayed.length) empty(pane, query ? "No changes match your search." : "Discuss an edit with your agent, then ask it to review the changes before generating.");
    for (const change of [...displayed].reverse()) {
      const card = node("article", "xrag-change");
      card.dataset.changeId = change.id;
      const top = node("div", "xrag-change-heading");
      top.append(node("h3", "", change.title), node("span", `xrag-badge xrag-badge-${change.status}`, change.status));
      card.append(top, node("p", "xrag-change-prompt", change.prompt));
      if (change.result) card.append(node("p", "xrag-result", change.result));
      if (change.feedback) card.append(node("p", "xrag-description", `Feedback: ${change.feedback}`));
      const actions = node("div", "xrag-actions");
      if (["pending", "failed"].includes(change.status)) {
        const one = button(change.status === "failed" ? "Retry this change" : "Generate this change", () => generate([change], "one"), "xrag-primary");
        one.disabled = busy || !onGenerate;
        const skip = button("Reject", () => store.updateChange(change.id, { status: "rejected", feedback: "Rejected before generation." }));
        skip.disabled = busy;
        actions.append(one, skip);
      }
      if (change.status === "succeeded") {
        actions.append(button("👍 This is right", () => store.updateChange(change.id, { status: "accepted", feedback: "Approved the generated result." })));
        const correctionBox = node("div", "xrag-correction");
        correctionBox.hidden = true;
        const correction = node("textarea"); correction.rows = 3; correction.maxLength = 6000;
        correction.placeholder = "Optional: what did you want instead?";
        correction.setAttribute("aria-label", "Correction for this change");
        correctionBox.append(correction);
        correctionBox.append(button("Save feedback / queue correction", () => {
          const comment = correction.value.trim();
          store.updateChange(change.id, { status: "rejected", feedback: comment || "The generated result needs adjustment.", correction: comment });
          if (comment) {
            store.queueChange({ title: `Adjust: ${change.title}`, parentId: change.id, context: change.context, prompt: `Adjust the previous generated change.\nOriginal request: ${change.prompt}\nUser correction: ${comment}\nPreserve unrelated geometry. Inspect the current result before applying this correction.` });
            setStatus("Correction queued for review. Generate it when ready.");
          } else setStatus("Feedback saved. Explain the correction to your agent to prepare another proposal.");
        }));
        actions.append(button("👎 Needs adjustment", () => { correctionBox.hidden = !correctionBox.hidden; if (!correctionBox.hidden) correction.focus(); }));
        card.append(actions, correctionBox);
      } else card.append(actions);
      pane.append(card);
    }
  }
  function renderHistory() {
    const state = store.getState();
    const signature = JSON.stringify([state.history, state.settings.prompt, state.settings.name, query]);
    if (signature === lastHistorySignature) return;
    lastHistorySignature = signature;
    const pane = sections.get("history"); pane.replaceChildren();
    pane.append(node("p", "xrag-description", "Review your discussion and saved instructions here. Use Changes to review individual generated results."));
    if (state.settings.prompt && matches("current instructions prompt configuration", state.settings.prompt)) {
      const current = node("article", "xrag-history-entry");
      current.append(node("strong", "", "Current agent instructions"), node("p", "", state.settings.prompt)); pane.append(current);
    }
    const entries = state.history.filter((entry) => matches(entry.role, entry.text));
    if (!entries.length) empty(pane, query ? "No discussion matches your search." : "Your voice discussion appears here after you start a session.");
    for (const entry of [...entries].reverse()) {
      const row = node("article", "xrag-history-entry");
      const label = entry.role === "assistant" ? state.settings.name : entry.role === "user" ? "You" : "System";
      const date = new Date(entry.at);
      row.append(node("strong", "", label), node("time", "", Number.isNaN(date.getTime()) ? "" : date.toLocaleString()), node("p", "", entry.text));
      pane.append(row);
    }
  }
  function render() {
    const state = store.getState();
    if (![...voiceModelSelect.options].some((option) => option.value === state.settings.voiceModel)) {
      const saved = node("option", "", `${state.settings.voiceModel} · saved model`); saved.value = state.settings.voiceModel; voiceModelSelect.append(saved);
    }
    heading.textContent = `${state.settings.name} settings`;
    for (const [key, section] of sections) section.hidden = query ? false : currentTab !== key;
    for (const [key, tabButton] of tabs) {
      tabButton.classList.toggle("is-active", currentTab === key && !query);
      tabButton.setAttribute("aria-current", currentTab === key && !query ? "page" : "false");
    }
    for (const { key, control, type } of inputBindings) {
      if (document.activeElement === control) continue;
      if (type === "checkbox") control.checked = state.settings[key];
      else control.value = state.settings[key];
    }
    for (const row of rows) row.element.hidden = !matches(row.match);
    for (const element of sections.get("settings").children) element.hidden = !rows.some((row) => row.parent === element && !row.element.hidden);
    soundName.textContent = state.settings.throwSoundName || "No custom sound uploaded.";
    renderChanges(); renderHistory();
    if (query) {
      sections.get("changes").hidden = !state.changes.some(change => matches(change.title, change.prompt, change.result, change.feedback, change.status));
      sections.get("history").hidden = !state.history.some(entry => matches(entry.role, entry.text));
    }

  }
  function open(tab = "settings") {
    if (disposed) return;
    if (overlay.hidden) priorFocus = document.activeElement;
    currentTab = sections.has(tab) ? tab : "settings";
    query = ""; search.value = "";
    overlay.hidden = false; render(); search.focus();
  }
  function close() { flushPersists(); overlay.hidden = true; stopThrowPreview(); stopVoicePreview(); priorFocus?.focus?.(); }
  search.addEventListener("input", () => { query = search.value.trim().toLowerCase(); render(); });
  overlay.addEventListener("click", (event) => { if (event.target === overlay) close(); });
  function keydown(event) {
    if (overlay.hidden) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key !== "Tab") return;
    const controls = [...panel.querySelectorAll("button,input,select,textarea")].filter((element) => !element.disabled && element.getClientRects().length);
    const first = controls[0]; const last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  document.addEventListener("keydown", keydown, true);
  const unsubscribe = store.subscribe(() => { if (!overlay.hidden) render(); });
  const unsubscribeSample = () => {};
  render();
  return { open, openChanges: () => open("changes"), close, setStatus,
    dispose() { disposed = true; flushPersists(); stopThrowPreview(); stopVoicePreview(); unsubscribeSample(); unsubscribe(); document.removeEventListener("keydown", keydown, true); overlay.remove(); },
  };
}
