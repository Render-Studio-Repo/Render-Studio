/** Floating Render Agent assistant for tooling questions and onboarding. */
import {
  ASTRA_MODEL_OPTIONS,
  CHEAP_CHAT_MODEL,
  CHEAP_CHAT_MODEL_LABEL,
} from "./ai-model-defaults.js?v=astra-default1&astraoffice=20260917-1&ramodel1&gpt61sol=20261001-1";
import {
  bumpTipForNewThread,
  bumpTipOnRefresh,
  getCurrentTip,
  tipTopicClass,
} from "../site/getting-started-tips.js?v=20260916-gifs40";
import { matchGettingStartedGuides, guideMediaPayload } from "../site/getting-started-guides.js?v=20261006-jake-parity1";
import { startShowMe } from "../site/show-me-tour.js?v=20260908-agent-tabs-logo-ko1-settings-redesign2&vrboard=20260915-spatial-draw4";
import { isVrHeadsetBrowser } from "../xr/vr-browser.js?v=20260907-desk-boot-acctovl1-acctui1";
import { stripOuterPromptQuotes } from "./prompt-ref.js?v=20260908-quotes1&gpt61sol=20261001-1";
import { isAdminUser } from "../studio/auth.js?v=20260908-profclick1-profopen1-acctfly1-dimospf1-acctovl1-setsearch1-acctui1";
import { isMarketplaceSearchQuestion, openMarketplaceDiscovery } from "../marketplace/marketplace-discovery.js?v=20260928-hey-ai-summary1";
import { parseAuthorizedAgents, agentsTabMarkup, parseAgentChat, agentChatMarkup, agentChatPostBody, RA_AGENT_CHAT_FEED, renderAgentTabView, selectedThreadRefreshId } from "./render-agent-agents-tab.js?v=20260923-harness-chat1";
import { bindVoiceAgentControls, loadVoiceAgentPrefs, voiceCatalog } from "./voice-agent-roster.js?v=va1";
import { analyzeCadQuality, cadQualityWatchdogPacket } from "./cad-quality-check.js?v=cadq2";
import { cadBotMechanismLines } from "../studio/cad-mechanism.js?v=mech1";
import { scoreCadBotTurn, ingestCadBotTraining } from "../studio/cad-bot-bench.js?v=cadbot1";
import { claimRenderAgentSubmitKey } from "./render-agent-keyboard.js?v=20260923-chat-keyboard2";
import { convertHeicFileToPng, isHeicFile } from "../media/heic-to-png.js?v=heicpng1";

const ONBOARDING_KEY_PREFIX = "render3d:renderAgentSeen:";
const PANEL_LAYOUT_KEY = "render3d:renderAgentPanel:v2";
const RENDER_AGENT_MODEL_KEY = "render3d:renderAgentModel:v1";
const RENDER_AGENT_MODEL_CHOICES = [
  { value: CHEAP_CHAT_MODEL, label: `${CHEAP_CHAT_MODEL_LABEL} (cheap)` },
  ...ASTRA_MODEL_OPTIONS,
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { value: "gpt-5.5", label: "GPT-5.5" },
];
const DOCS_PANEL_LAYOUT_KEY = "render3d:renderAgentPanelDocs:v9";
const PARTS_PANEL_LAYOUT_KEY = "render3d:renderAgentPanelParts:v1";
const RENDER3D_LOGO_URL = "/media/images/render-animations/VR-Animations/render-logo-gear-still.png?v=20260915-logo1";

const AGENT_CONTROL_SEL = [
  "#btn-render-agent",
  "#render-agent-fab",
  ".render-agent-fab",
  ".workspace-feedback-btn--agent",
].join(", ");
const PROMPT_CHROME_SEL = [
  ".prompt-panel",
  ".prompt-panel-tabs",
  "#prompt-tab-imagine",
  ".prompt-compose-toolbar",
  ".prompt-mode-row",
  ".prompt-skills-row",
  "#prompt-pane-compose",
  "#prompt-pane-history",
  "#prompt-pane-imagine",
  "#prompt-input",
  ".prompt-editor",
  ".prompt-editor-wrap",
  ".prompt-mention-menu",
  "#prompt-key-popup",
  "#prompt-cad-engine-popup",
  "#prompt-mesh-engine-popup",
  "#prompt-spice",
  "#prompt-spice-wrap",
  "#prompt-cad-debug",
  "#prompt-cad-debug-wrap",
  "#prompt-ai-gear",
  "#prompt-ai-gear-wrap",
  "#prompt-ai-gear-popup",
  ".prompt-spice-tip",
  ".prompt-skill-popup",
  ".prompt-skills-list-popup",
  "#knowledge-base-modal",
  "#context-lab-modal",
  "#prompt-spice-compare-modal",
  ".imagine-pane",
  "#imagine-input",
  "#imagine-spice",
  "#imagine-spice-wrap",
  ".imagine-library",
  ".wiring-prompt-panel",
  ".rigging-prompt-panel",
].join(", ");
const PROMPT_INTERACTIVE_SEL = [
  "button",
  "input",
  "select",
  "textarea",
  "a",
  "[contenteditable='true']",
  ".prompt-tab",
  "#prompt-tab-imagine",
  "#prompt-spice",
  "#prompt-spice-wrap",
  "#prompt-cad-debug",
  "#prompt-cad-debug-wrap",
  "#prompt-ai-gear",
  "#prompt-ai-gear-wrap",
  "#prompt-ai-gear-popup",
  "#btn-prompt",
  "#btn-generate",
  "#imagine-spice",
  "#imagine-spice-wrap",
  "#imagine-key-picker-btn",
  "#prompt-key-picker-btn",
  "#imagine-generate",
  "#imagine-search",
  ".imagine-library-tab",
  ".imagine-thumb",
  ".imagine-row",
  ".imagine-act",
  ".imagine-go",
  ".imagine-history-row",
  ".prompt-mode-btn",
  ".prompt-editor",
  "#prompt-input",
  "#imagine-input",
  ".prompt-skills-toggle",
  "#prompt-kb-icon-btn",
  "#prompt-ctx-icon-btn",
  ".prompt-mic-btn",
  "#btn-voice-order",
  ".prompt-voice-order",
  "[data-voice-order]",
  "#prompt-target-picker-btn",
  "#prompt-target-mode",
  "#prompt-speed",
  ".prompt-cad-engine-option",
  ".prompt-mesh-engine-option",
  ".prompt-mention-menu",
].join(", ");
const PROMPT_GESTURE_SUPPRESS_MS = 700;
let lastPromptChromeGestureAt = 0;

export function extractRenderPrompt(text = "") {
  const source = String(text || "");
  const tagged = source.match(/```render-prompt\s*\n([\s\S]*?)```/i);
  return String(tagged?.[1] || "").trim();
}

export function activeMachineDesignContext(machine = null) {
  if (!machine || typeof machine !== "object") return null;
  const specs = machine.specs && typeof machine.specs === "object" ? machine.specs : {};
  const text = (value, max = 240) => String(value ?? "").trim().slice(0, max);
  const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
  const numberList = (value, max = 3) => Array.isArray(value)
    ? value.slice(0, max).map(number).filter((item) => item != null)
    : [];
  const volume = numberList(specs.volume_mm);
  const axisVolume = [specs.build_volume_x_mm, specs.build_volume_y_mm, specs.build_volume_z_mm]
    .map(number).filter((item) => item != null);
  const bed = numberList(specs.bed_mm, 2);
  const buildVolume = axisVolume.length === 3
    ? `${axisVolume.join(" × ")} mm`
    : volume.length >= 2
    ? `${volume.join(" × ")} mm`
    : bed.length >= 2
      ? `${bed.join(" × ")} mm bed`
      : "";
  const toggles = machine.toggles && typeof machine.toggles === "object"
    ? Object.entries(machine.toggles).filter(([key, value]) => /^[a-z0-9_]{1,40}$/i.test(key) && typeof value === "boolean").slice(0, 16)
    : [];
  return {
    kind: text(machine.kind, 40),
    name: text(machine.name, 120),
    brand: text(machine.brand, 80),
    model: text(machine.model, 80),
    buildVolume,
    nozzleMm: number(specs.nozzle_mm),
    toolMm: number(specs.min_tool_mm),
    kerfMm: number(specs.kerf_mm),
    material: text(specs.material || specs.materials, 160),
    toleranceEnabled: Boolean(specs.printer_tolerance ?? machine.printer_tolerance),
    toleranceNotes: text(specs.tolerance_notes || specs.notes, 600),
    toggles,
  };
}

export function designConversationMessage(message, context = {}) {
  const selected = String(context.selected || "").trim() || "none";
  const targetMode = String(context.targetMode || "auto").trim() || "auto";
  const engine = String(context.engine || "CAD").trim() || "CAD";
  const draft = String(context.draft || "").trim().slice(0, 6000);
  let referenceContentBudget = 12000;
  const references = (context.references || []).slice(0, 24).map((ref) => {
    const label = ref.label || ref.token || ref.filename || ref.type || "reference";
    const content = String(ref.text_content || ref.text || "").trim();
    const included = content.slice(0, Math.min(8000, referenceContentBudget));
    referenceContentBudget -= included.length;
    return `- ${ref.type || "reference"}: ${label}${ref.filename ? ` (${ref.filename})` : ""}${included ? `\n  Contents:\n${included}` : ""}`;
  });
  const machine = activeMachineDesignContext(context.machine);
  const machineLabel = machine?.name || [machine?.brand, machine?.model].filter(Boolean).join(" ") || "the active machine";
  const machineLines = machine ? [
    `Kind: ${machine.kind || "other"}`,
    `Name: ${machine.name || "(unnamed)"}`,
    `Brand: ${machine.brand || "(unspecified)"}`,
    `Model: ${machine.model || "(unspecified)"}`,
    machine.buildVolume ? `Build volume: ${machine.buildVolume}` : "",
    machine.nozzleMm != null ? `Nozzle: ${machine.nozzleMm} mm` : "",
    machine.toolMm != null ? `Minimum tool: ${machine.toolMm} mm` : "",
    machine.kerfMm != null ? `Kerf: ${machine.kerfMm} mm` : "",
    machine.material ? `Material: ${machine.material}` : "",
    `Tolerance enabled: ${machine.toleranceEnabled ? "yes" : "no"}`,
    machine.toleranceNotes ? `Notes: ${machine.toleranceNotes}` : "",
    ...machine.toggles.map(([key, enabled]) => `Setting ${key}: ${enabled ? "on" : "off"}`),
  ].filter(Boolean) : [];
  return [
    "[AI CAD DESIGN CONVERSATION]",
    "Act as a collaborative CAD design partner, not general product support.",
    "Keep the design conversation compact. Ask at most one focused question in a reply, and only when the answer changes the fundamental topology or safety of the design.",
    "Research-first rule: when the user names publicly documented hardware or says to look it up, use official documentation, linked references, manufacturer drawings, and official CAD before asking the user for dimensions. Never ask them to upload public CAD you can identify. If exact mating geometry is not present in this chat context, produce a build-ready render-prompt that tells the CAD harness to retrieve the official CAD and inspect its interfaces. If the exact purchased component is still unidentified or marked TBD, require an adjustable parametric adapter with explicit ASSUMED_NOT_FIT_VERIFIED dimensions and continue generating the concept; never require exact manufacturer CAD and then leave generation blocked on the same missing selection.",
    "Once the machine, material, moving assembly, and intended motion are known, stop interviewing. Summarize the chosen layout briefly and include the render-prompt in the same reply. Do not keep generation pending for dimensions the CAD harness can inspect or for conservative values it can label as assumptions.",
    "Use the current selected part and draft as context. Do not claim to modify files from chat alone; generation starts only from an explicit CAD harness action.",
    "When the design is specific enough, include the exact proposed generation text in one fenced block labeled render-prompt.",
    machine
      ? `When the user mentions a 3D printer, CNC, laser, robot, or manufacturing target, assume ${machineLabel} is the intended target. If the user's message does not already explicitly identify that machine, explicitly confirm ${machineLabel} with the user before finalizing a render-prompt.`
      : "When the user mentions a 3D printer, CNC, laser, robot, or manufacturing target without naming the machine, ask which machine it must be made for before finalizing a render-prompt.",
    "Keep all ordinary explanation outside that block. The user can explicitly review the draft, build a new model, or iterate the selected model with the CAD harness.",
    `Current selected part: ${selected}`,
    `Current target mode: ${targetMode}`,
    `Current CAD engine: ${engine}`,
    `Active manufacturing machine:\n${machineLines.join("\n") || "(none selected in Context Lab)"}`,
    `Current linked references:\n${references.join("\n") || "(none)"}`,
    `Current draft prompt:\n${draft || "(empty)"}`,
    `User message:\n${String(message || "").trim()}`,
  ].join("\n\n");
}

export function shouldStartDesignChatOnFirstSubmit({ prompt = "", threadId = "", chatOpen = false } = {}) {
  return Boolean(String(prompt || "").trim())
    && !String(threadId || "").trim()
    && !chatOpen;
}

export function heyAiDesignChatSummary(handoff = {}) {
  const mode = String(handoff.modeLabel || "CAD").trim() || "CAD";
  const targetMode = handoff.targetMode === "edit" ? "edit" : "create";
  const selected = String(handoff.selectedFile || "a new model").trim() || "a new model";
  const transcript = (handoff.transcript || [])
    .filter((item) => item?.text)
    .slice(-12)
    .map((item) => `${item.role === "assistant" ? "AI" : "You"}: ${String(item.text).trim()}`)
    .join("\n");
  return [
    "Hey AI conversation summary",
    `Generation handoff: ${mode} · ${targetMode} ${selected}`,
    transcript ? `Conversation:\n${transcript}` : "Conversation: no transcript was captured.",
    `Submitted prompt:\n${String(handoff.prompt || "").trim() || "(empty)"}`,
  ].join("\n\n");
}

function isElementNode(node) {
  return !!node && (node.nodeType == null || node.nodeType === 1);
}

/** Ribbon Agent / Ask Agent FAB — the only controls that should open the panel. */
export function isRenderAgentControlNode(node) {
  if (!isElementNode(node)) {
    const id = node?.id || "";
    return id === "btn-render-agent"
      || id === "render-agent-fab";
  }
  if (typeof node.closest !== "function") {
    const id = node.id || "";
    return id === "btn-render-agent"
      || id === "render-agent-fab";
  }
  try {
    return !!node.closest(AGENT_CONTROL_SEL);
  } catch {
    return false;
  }
}

/** Prompt-bar widgets that must keep their own click (Generate, Improve, @, key, CAD…). */
export function isPromptInteractiveNotAgent(node) {
  if (!isElementNode(node) || isRenderAgentControlNode(node)) return false;
  if (!isPromptChromeNode(node)) return false;
  if (typeof node.closest !== "function") return false;
  try {
    return !!node.closest(PROMPT_INTERACTIVE_SEL);
  } catch {
    return false;
  }
}

/** Compose box, Improve, @ mentions, key gear, engine pickers, skills, Generate. */
export function isPromptChromeNode(node) {
  if (!isElementNode(node) || typeof node.closest !== "function") return false;
  if (isRenderAgentControlNode(node)) return false;
  try {
    if (node.closest("#render-agent-panel, .render-agent-panel, .render-agent-doit-modal, .render-agent-fab")) {
      return false;
    }
    return !!node.closest(PROMPT_CHROME_SEL);
  } catch {
    return false;
  }
}

function eventPathNodes(event) {
  if (!event) return [];
  try {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    if (Array.isArray(path) && path.length) return path.filter(isElementNode);
  } catch {
    /* ignore */
  }
  return [event.target, event.currentTarget].filter(isElementNode);
}

export function notePromptChromeGesture(event) {
  if (!event) return false;
  const path = eventPathNodes(event);
  if (path.some(isPromptChromeNode) && !path.some(isRenderAgentControlNode)) {
    lastPromptChromeGestureAt = Date.now();
    return true;
  }
  const x = Number(event.clientX);
  const y = Number(event.clientY);
  const hasPoint = Number.isFinite(x) && Number.isFinite(y) && (x !== 0 || y !== 0);
  if (hasPoint && typeof document !== "undefined" && typeof document.elementsFromPoint === "function") {
    try {
      const stack = document.elementsFromPoint(x, y) || [];
      if (stack.some(isPromptChromeNode)) {
        lastPromptChromeGestureAt = Date.now();
        return true;
      }
    } catch {
      /* ignore */
    }
  }
  return false;
}

/**
 * Prompt toolbar clicks (and leftover pointerup / overlapping chrome) must not
 * open Render Agent. Only an actual Agent control click may.
 */
export function shouldOpenRenderAgentFromEvent(event) {
  if (!event) return false;
  const path = eventPathNodes(event);
  const target = isElementNode(event.target) ? event.target : path[0];
  if (isPromptInteractiveNotAgent(target) || path.some(isPromptInteractiveNotAgent)) {
    if (!isRenderAgentControlNode(target)) return false;
  }
  const x = Number(event.clientX);
  const y = Number(event.clientY);
  const hasPoint = Number.isFinite(x) && Number.isFinite(y) && (x !== 0 || y !== 0);
  let stack = [];
  if (hasPoint && event.isTrusted !== false && typeof document !== "undefined" && typeof document.elementsFromPoint === "function") {
    try {
      stack = document.elementsFromPoint(x, y) || [];
    } catch {
      stack = [];
    }
  }
  // FAB / leftover overlay / bubbling hit-test: Improve, key, CAD, @, Skills, Generate win.
  if (stack.some(isPromptInteractiveNotAgent)) return false;
  const studio = isStudioAgentChrome();
  const hitsFab = isRenderAgentFabNode(target) || path.some(isRenderAgentFabNode) || stack.some(isRenderAgentFabNode);
  const hitsHeaderAgent = path.some((node) => {
    if (!isElementNode(node)) return false;
    return node.id === "btn-render-agent" || !!node.classList?.contains("workspace-feedback-btn--agent");
  }) || (isElementNode(target) && (target.id === "btn-render-agent" || !!target.classList?.contains("workspace-feedback-btn--agent")));
  // Studio already has header Agent. A leftover FAB over Improve must never open the panel.
  if (studio && hitsFab && !hitsHeaderAgent) return false;
  if (isRenderAgentControlNode(target) || path.some(isRenderAgentControlNode)) return true;
  if (path.some(isPromptChromeNode) || stack.some(isPromptChromeNode)) return false;
  return false;
}

function isStudioAgentChrome() {
  try {
    return !!document.getElementById("prompt-pane-compose")
      || !!document.getElementById("btn-render-agent");
  } catch {
    return false;
  }
}

function isRenderAgentFabNode(node) {
  if (!isElementNode(node)) return false;
  const id = node.id || "";
  if (id === "render-agent-fab") return true;
  return !!node.classList?.contains("render-agent-fab");
}

function isPartsListAgentFab(node) {
  return isElementNode(node) && !!node.classList?.contains("render-agent-fab--parts");
}

function isPartsAgentSurfaceOpen() {
  try {
    const viewer = document.querySelector(".parts-list-viewer");
    if (viewer && !viewer.hidden && !viewer.classList.contains("hidden")) {
      const col = viewer.closest(".main-column");
      if (!col || col.getAttribute("data-shell-tab") === "parts") return true;
    }
    if (document.querySelector(".catalog-parts-list:not(.hidden)")) return true;
    return !!document.querySelector("dialog.assist-dialog[open]");
  } catch {
    return false;
  }
}

function promptChromeGestureBlocksOpen() {
  return !!(lastPromptChromeGestureAt && (Date.now() - lastPromptChromeGestureAt) < PROMPT_GESTURE_SUPPRESS_MS);
}

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function renderInlineMarkdown(value = "") {
  return esc(value)
    .replace(/\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)|(https:\/\/[^\s<]+)/gi, (match, label, markdownUrl, bareUrl) => {
      const href = markdownUrl || bareUrl;
      const text = label || bareUrl;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    })
    .replace(/``+\s*/g, "")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^A-Za-z0-9._-])@([A-Za-z0-9_-]{2,40})/g, '$1<span class="prompt-mention"><span class="prompt-mention-label">@$2</span></span>');
}

function lastQuotedPrompt(value = "") {
  const quotes = [];
  let cur = [];
  for (const raw of String(value || "").replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (/^>\s?/.test(line)) {
      cur.push(line.replace(/^>\s?/, ""));
    } else if (cur.length) {
      quotes.push(stripOuterPromptQuotes(cur.join(" ")));
      cur = [];
    }
  }
  if (cur.length) quotes.push(stripOuterPromptQuotes(cur.join(" ")));
  return quotes.filter(Boolean).at(-1) || "";
}

function redactSecretShaped(value = "") {
  return String(value || "")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[redacted]")
    .replace(/\b(?:sk-proj-|sk-ant-|sk-live-|sk_live_|sk_test_|rk_live_|ghp_|github_pat_)[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9._\-+/=]{12,}/gi, "Bearer [redacted]")
    .replace(/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|passwd|authorization|private[_-]?key|client[_-]?secret)\s*[:=]\s*\S+/gi, "$1=[redacted]");
}

function renderMessageText(value = "") {
  const lines = String(value || "").replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let quote = [];
  let list = null;
  let fence = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" ").trim())}</p>`);
    paragraph = [];
  };

  const flushQuote = () => {
    if (!quote.length) return;
    const prompt = stripOuterPromptQuotes(quote.join(" "));
    blocks.push(`
      <details class="render-agent-prompt-card">
        <summary class="render-agent-prompt-card-kicker">Updated prompt example</summary>
        <p>${renderInlineMarkdown(prompt)}</p>
      </details>
    `);
    quote = [];
  };

  const flushList = () => {
    if (!list?.items?.length) {
      list = null;
      return;
    }
    const tag = list.type === "ol" ? "ol" : "ul";
    blocks.push(`<${tag} class="render-agent-rich-list">${list.items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</${tag}>`);
    list = null;
  };

  const flushAll = () => {
    flushParagraph();
    flushQuote();
    flushList();
  };

  for (const rawLine of lines) {
    const fenceOpen = rawLine.trim().match(/^```([\w.-]*)\s*$/);
    if (fenceOpen && !fence) {
      flushAll();
      fence = { lang: fenceOpen[1] || "", lines: [] };
      continue;
    }
    if (fence) {
      if (/^```\s*$/.test(rawLine.trim())) {
        blocks.push(`<pre class="render-agent-rich-pre"><code>${esc(fence.lines.join("\n"))}</code></pre>`);
        fence = null;
        continue;
      }
      fence.lines.push(rawLine.replace(/\t/g, "  "));
      continue;
    }
    const line = rawLine.trim();
    if (!line) {
      flushAll();
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length <= 2 ? "h3" : "h4";
      blocks.push(`<${level} class="render-agent-rich-heading">${renderInlineMarkdown(heading[2])}</${level}>`);
      continue;
    }

    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      flushList();
      quote.push(quoteMatch[1]);
      continue;
    }

    const cue = line.match(/^(?:-{0,2}>|=>|→|➜)\s+(.+)$/);
    if (cue) {
      flushAll();
      blocks.push(`
        <div class="render-agent-cue">
          <span class="render-agent-cue-icon" aria-hidden="true"></span>
          <span>${renderInlineMarkdown(cue[1])}</span>
        </div>
      `);
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      flushQuote();
      if (list?.type !== "ul") flushList();
      list ||= { type: "ul", items: [] };
      list.items.push(unordered[1]);
      continue;
    }

    const ordered = line.match(/^\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      flushQuote();
      if (list?.type !== "ol") flushList();
      list ||= { type: "ol", items: [] };
      list.items.push(ordered[1]);
      continue;
    }

    flushQuote();
    flushList();
    paragraph.push(line);
  }

  if (fence) {
    blocks.push(`<pre class="render-agent-rich-pre"><code>${esc(fence.lines.join("\n"))}</code></pre>`);
    fence = null;
  }
  flushAll();
  return blocks.join("");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Could not read file"));
    reader.readAsText(file);
  });
}

function isTextLike(file) {
  const name = (file.name || "").toLowerCase();
  return /^text\//i.test(file.type || "") || /\.(txt|md|csv|json|svg|dxf|step|stp)$/i.test(name);
}

function isImage(file) {
  return /^image\/(png|jpeg|jpg|webp)$/i.test(file.type || "");
}

export function closeDesignChatForProjectChange({ host, toggle, badge } = {}) {
  if (!host) return;
  host.classList.add("hidden");
  host.classList.remove("prompt-design-chat--popout");
  const popout = host.querySelector?.("[data-prompt-design-popout]");
  popout?.setAttribute("aria-pressed", "false");
  if (popout) popout.textContent = "Pop out";
  toggle?.setAttribute("aria-expanded", "false");
  badge?.setAttribute("aria-expanded", "false");
}

export function createRenderAgent({
  api,
  getProjectId,
  getProjects = () => [],
  getProjectName = () => "",
  getSelectedFile,
  getDesignModelState = () => ({ selectedFilename: "", targets: [] }),
  getPromptReferences = () => [],
  getPromptImages = () => [],
  getActiveMachine = () => null,
  getObjectChoices = () => [],
  getCurrentUser,
  getTeams,
  getSelectedWorkspaceId,
  getSelectedAiKey,
  onOpenProject,
  onCreateProject,
  onSelectObject,
  onRequireLogin,
  onStatus,
  stickyNote = true,
  onVideoEditPrompt = null,
  onRestoreImprovePrompt = null,
  onApplyContextSettings = null,
  onRoboticsPrompt = null,
  onGenerateDesignPrompt = null,
  onSelectDesignModel = null,
  onOpenDesignAiPicker = null,
} = {}) {
  let btn = document.getElementById("btn-render-agent");
  const panel = document.getElementById("render-agent-panel");
  const closeBtn = document.getElementById("render-agent-close");
  const threadMenuBtn = document.getElementById("render-agent-thread-menu");
  const threadPopover = document.getElementById("render-agent-thread-popover");
  const threadListEl = document.getElementById("render-agent-thread-list");
  const activeThreadLabel = document.getElementById("render-agent-active-thread-label");
  const newThreadBtn = document.getElementById("render-agent-new-thread");
  const membersEl = document.getElementById("render-agent-members");
  const inviteSelect = document.getElementById("render-agent-invite-select");
  const inviteBtn = document.getElementById("render-agent-invite-btn");
  const onboarding = document.getElementById("render-agent-onboarding");
  const messagesEl = document.getElementById("render-agent-messages");
  const attachmentsEl = document.getElementById("render-agent-attachments");
  const form = document.getElementById("render-agent-form");
  const input = document.getElementById("render-agent-input");
  const mentionMenu = document.getElementById("render-agent-mention-menu");
  const fileInput = document.getElementById("render-agent-file-input");
  const statusEl = document.getElementById("render-agent-status");
  const AT_ROSTER = [
    { handle: "astra", label: "Astra" },
    { handle: "grok-bot", label: "Grok bot" },
    { handle: "analytics", label: "analytics" },
    { handle: "project-manager", label: "project-manager" },
    { handle: "vibe-rnd", label: "vibe-rnd" },
    { handle: "vibe-marketing", label: "vibe-marketing" },
    { handle: "ledger", label: "ledger" },
    { handle: "instruction-auditor", label: "instruction-auditor" },
    { handle: "comms-bridge", label: "comms-bridge" },
    { handle: "clip-bot", label: "clip-bot" },
    { handle: "vibe-sales", label: "vibe-sales" },
    { handle: "cursor-engineer", label: "cursor-engineer" },
    { handle: "harness-mule", label: "harness-mule" },
    { handle: "pad", label: "code pad" },
    { handle: "code", label: "code request" },
  ];
  let mentionHits = [];
  let mentionIndex = 0;

  if (!panel || !form || !messagesEl) return null;

  let activeRaTab = "chat";

  function ensureAgentsUi() {
    if (!document.querySelector("link[data-ra-agents-css]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/components/render-agent-agents.css?v=20261006-designchat-hey-ai1";
      link.dataset.raAgentsCss = "1";
      document.head.append(link);
    }
    if (!panel.querySelector("[data-ra-tab]")) {
      const nav = document.createElement("div");
      nav.className = "ra-agent-tabs";
      nav.innerHTML = `<button type="button" data-ra-tab="chat" class="is-on">Chat</button><button type="button" data-ra-tab="agent-chat">Agent chat</button><button type="button" data-ra-tab="usage">Usage</button>`;
      panel.insertBefore(nav, messagesEl);
    }
    if (!panel.querySelector(".ra-agent-chat-host")) {
      const host = document.createElement("div");
      host.className = "ra-agent-chat-host";
      host.hidden = true;
      host.setAttribute("data-ra-pane", "agent-chat");
      host.innerHTML = `<div data-ra-agent-chat-feed><p class="muted small">Loading agent conversation…</p></div>
        <form class="ra-agent-chat-compose" data-ra-agent-chat-form>
          <textarea rows="3" maxlength="1500" data-ra-agent-chat-input placeholder="Message the harness as Sam. Enter adds a new line; Cmd/Ctrl+Enter sends."></textarea>
          <div><span class="muted small" data-ra-agent-chat-status>Live harness feed</span><button type="submit" class="btn accent btn-compact">Send to harness</button></div>
        </form>`;
      messagesEl.insertAdjacentElement("afterend", host);
      const harnessForm = host.querySelector("[data-ra-agent-chat-form]");
      const harnessInput = host.querySelector("[data-ra-agent-chat-input]");
      harnessForm?.addEventListener("submit", (event) => {
        event.preventDefault();
        void sendAgentChatMessage();
      });
      harnessInput?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.shiftKey || event.isComposing || (!event.metaKey && !event.ctrlKey)) return;
        event.preventDefault();
        event.stopPropagation();
        void sendAgentChatMessage();
      });
    }
    if (!panel.querySelector(".ra-harness-host")) {
      const host = document.createElement("div");
      host.className = "ra-harness-host";
      host.hidden = true;
      host.setAttribute("data-ra-pane", "usage");
      messagesEl.insertAdjacentElement("afterend", host);
    }
    panel.querySelectorAll("[data-ra-tab]").forEach((btnTab) => {
      if (btnTab.dataset.raBound === "1") return;
      btnTab.dataset.raBound = "1";
      btnTab.addEventListener("click", () => {
        const tab = btnTab.getAttribute("data-ra-tab") || "chat";
        showRaTab(tab);
      });
    });
  }

  let agentsPoll = 0;

  function showRaTab(tab) {
    activeRaTab = ["chat", "agent-chat", "usage"].includes(tab) ? tab : "chat";
    const view = renderAgentTabView(activeRaTab);
    panel.querySelectorAll("[data-ra-tab]").forEach((el) => {
      el.classList.toggle("is-on", el.getAttribute("data-ra-tab") === activeRaTab);
    });
    const chatOnly = [
      panel.querySelector(".render-agent-people-row"),
      onboarding,
      messagesEl,
      attachmentsEl,
      panel.querySelector(".render-agent-action-bar"),
      form,
      statusEl,
    ].filter(Boolean);
    chatOnly.forEach((el) => { el.hidden = !view.chat; });
    if (threadMenuBtn) threadMenuBtn.hidden = !view.chat;
    if (!view.chat) threadPopover?.classList.add("hidden");
    const agentChatHost = panel.querySelector(".ra-agent-chat-host");
    const usageHost = panel.querySelector(".ra-harness-host");
    if (agentChatHost) agentChatHost.hidden = !view.agentChat;
    if (usageHost) usageHost.hidden = !view.usage;
    clearInterval(agentsPoll);
    agentsPoll = 0;
    if (view.agentChat) {
      void refreshAgentChatTab();
      agentsPoll = setInterval(() => {
        if (panel.classList.contains("hidden") || activeRaTab !== "agent-chat") return;
        void refreshAgentChatTab({ quiet: true });
      }, 3000);
    }
    if (view.usage) void refreshUsageTab();
  }

  async function jsonGet(url) {
    const res = await fetch(url, { credentials: "same-origin" }).catch(() => null);
    if (!res || !res.ok) return {};
    return res.json().catch(() => ({}));
  }

  async function refreshUsageTab({ quiet = false } = {}) {
    const host = panel.querySelector(".ra-harness-host");
    if (!host) return;
    if (!quiet) host.innerHTML = `<p class="muted small">Loading authorized agents…</p>`;
    try {
      const [subRes, grokRes, whoRes] = await Promise.all([
        fetch("/api/ai-subscriptions?t=" + Date.now(), { credentials: "same-origin" }).catch(() => null),
        fetch("/api/integrations/grok-bot/status?t=" + Date.now(), { credentials: "same-origin" }).catch(() => null),
        fetch("/docs/media/ledger-whois.json?t=" + Date.now(), { credentials: "same-origin" }).catch(() => null),
      ]);
      const listing = subRes && subRes.ok ? await subRes.json().catch(() => ({})) : {};
      const grok = grokRes && grokRes.ok ? await grokRes.json().catch(() => ({})) : {};
      const who = whoRes && whoRes.ok ? await whoRes.json().catch(() => ({})) : {};
      const providers = await jsonGet("/api/voice-providers?t=" + Date.now());
      const roster = parseAuthorizedAgents({ listing, grok, who });
      host.innerHTML = agentsTabMarkup(roster, {
        prefs: loadVoiceAgentPrefs(),
        catalog: voiceCatalog({ openai: providers.openai !== false, elevenlabs: !!providers.elevenlabs }),
      });
      bindVoiceAgentControls(host);
    } catch (err) {
      host.innerHTML = `<p class="muted small">${esc(err?.message || "Could not load agents")}</p>`;
    }
  }

  async function refreshAgentChatTab({ quiet = false } = {}) {
    const host = panel.querySelector(".ra-agent-chat-host");
    if (!host) return;
    const feed = host.querySelector("[data-ra-agent-chat-feed]");
    if (!feed) return;
    const nearBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
    if (!quiet) feed.innerHTML = `<p class="muted small">Loading agent conversation…</p>`;
    try {
      const chat = await jsonGet(`${RA_AGENT_CHAT_FEED}&t=${Date.now()}`);
      feed.innerHTML = agentChatMarkup(parseAgentChat(chat));
      if (nearBottom || !quiet) feed.scrollTop = feed.scrollHeight;
    } catch (err) {
      feed.innerHTML = `<p class="muted small">${esc(err?.message || "Could not load agent conversation")}</p>`;
    }
  }

  async function sendAgentChatMessage() {
    const host = panel.querySelector(".ra-agent-chat-host");
    const inputEl = host?.querySelector("[data-ra-agent-chat-input]");
    const status = host?.querySelector("[data-ra-agent-chat-status]");
    const body = agentChatPostBody(inputEl?.value || "");
    if (!body.text) {
      if (status) status.textContent = "Type a harness message first.";
      inputEl?.focus?.();
      return false;
    }
    if (status) status.textContent = "Sending…";
    try {
      const response = await fetch("/mcp/group-chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) throw new Error(data.error || data.detail || `Harness ${response.status}`);
      if (inputEl) inputEl.value = "";
      if (status) status.textContent = "Sent. Waiting for harness replies…";
      await refreshAgentChatTab({ quiet: true });
      return true;
    } catch (error) {
      if (status) status.textContent = error?.message || "Could not send to harness.";
      return false;
    }
  }

  ensureAgentsUi();

  function hideStudioFabs() {
    if (!isStudioAgentChrome()) return;
    document.querySelectorAll("#render-agent-fab, .render-agent-fab").forEach((fab) => {
      if (fab.id === "btn-render-agent") return;
      // ragicon1: Parts List reuses the Docs fab; never strip it with the Improve leftover FAB.
      if (isPartsListAgentFab(fab)) return;
      fab.classList.add("hidden");
      fab.setAttribute("aria-hidden", "true");
      fab.tabIndex = -1;
      fab.style.pointerEvents = "none";
      fab.style.display = "none";
      fab.remove();
    });
  }
  const studioPrompt = document.getElementById("prompt-pane-compose");
  // Studio has explicit Agent controls. Never inject a fixed FAB over Improve / send / @ / mic.
  if (studioPrompt || btn) {
    hideStudioFabs();
  } else if (!btn && !document.getElementById("render-agent-fab") && !document.querySelector(AGENT_CONTROL_SEL)) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.id = "render-agent-fab";
    btn.className = "render-agent-fab";
    btn.title = "Ask Render Agent";
    btn.setAttribute("aria-label", "Ask Render Agent");
    btn.setAttribute("aria-pressed", "false");
    btn.innerHTML = `<img src="${RENDER3D_LOGO_URL}" alt="" /><span>Ask Agent</span>`;
    document.body.appendChild(btn);
  }

  let threads = [];
  let activeThread = null;
  let attachments = [];
  let teamMembers = [];
  let inviteOpen = false;
  let inviteQuery = "";
  let selectedInviteUserId = "";
  let renderAgentModel = CHEAP_CHAT_MODEL;
  try {
    const saved = localStorage.getItem(RENDER_AGENT_MODEL_KEY);
    if (saved && RENDER_AGENT_MODEL_CHOICES.some((row) => row.value === saved)) renderAgentModel = saved;
  } catch {
    /* ignore */
  }
  try {
    localStorage.removeItem("render3d:renderAgentKeyMode:v1");
  } catch {
    /* ignore */
  }
  let threadSearch = "";
  let busy = false;
  let invitePicker = null;
  let agentSourceRow = null;
  let pendingQuestionContext = "";
  let pendingMissingSetting = "";
  let debugImproveSession = false;
  let pendingDebugSelection = null;
  let doItWizard = null;
  let doItNote = null;

  function setStatus(message = "", isError = false) {
    if (statusEl) {
      statusEl.textContent = message;
      statusEl.classList.toggle("error", !!isError);
    }
    if (message) onStatus?.(isError ? "error" : "ok", message);
  }

  function currentUserId() {
    return getCurrentUser?.()?.id || "";
  }

  function avatarHtml(user = {}, className = "render-agent-avatar") {
    const name = user.display_name || user.name || user.email || "User";
    const initial = esc(String(name).trim().charAt(0).toUpperCase() || "U");
    const avatar = user.avatar_url || "";
    if (avatar) {
      return `<span class="${className} ${className}--image" style="background-image:url('${esc(avatar)}')" title="${esc(name)}"></span>`;
    }
    return `<span class="${className}" title="${esc(name)}">${initial}</span>`;
  }

  function agentLogoHtml(className = "render-agent-avatar") {
    return `<span class="${className} ${className}--image render-agent-logo-avatar" style="background-image:url('${RENDER3D_LOGO_URL}')" title="Render Agent"></span>`;
  }

  function isDesktopViewport() {
    // Match Studio mobile interaction breakpoint — auto-open is desktop-only.
    try {
      return !window.matchMedia("(max-width: 820px), (pointer: coarse) and (max-width: 1024px)").matches;
    } catch {
      return window.innerWidth > 820;
    }
  }

  function applyHeadsetAgentChrome() {
    const headset = isVrHeadsetBrowser();
    panel.classList.toggle("render-agent-panel--headset", headset);
    if (headset) {
      document.getElementById("render-agent-onboarding")?.classList.add("hidden");
    }
    return headset;
  }

  function onboardingKey() {
    return `${ONBOARDING_KEY_PREFIX}${currentUserId() || "anonymous"}`;
  }

  function shouldShowOnboarding() {
    if (!currentUserId()) return false;
    try {
      return localStorage.getItem(onboardingKey()) !== "1";
    } catch {
      return false;
    }
  }

  function markOnboardingSeen() {
    try {
      localStorage.setItem(onboardingKey(), "1");
    } catch {
      /* local storage is best-effort */
    }
  }

  function showWelcomeTip() {
    if (!messagesEl) return;
    const hasMessages = Boolean(activeThread?.messages?.length);
    if (hasMessages) {
      // Keep tip compact above existing history.
      renderMessages();
      return;
    }
    messagesEl.innerHTML = `
      <div class="render-agent-empty">
        <strong>Ask me anything about Render Studio.</strong>
        ${renderAgentTipCard()}
        <p class="muted small" style="margin-top:10px">
          New here? Read the
          <a href="/getting-started.html">Getting Started docs</a>
          for demos and walkthroughs.
        </p>
      </div>
    `;
    bindTipActions(messagesEl);
  }

  function ensureDocsMobileBackdrop() {
    let backdrop = document.getElementById("render-agent-backdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = "render-agent-backdrop";
      backdrop.className = "render-agent-backdrop hidden";
      backdrop.setAttribute("aria-hidden", "true");
      backdrop.addEventListener("click", () => close());
      document.body.appendChild(backdrop);
    }
    return backdrop;
  }

  function applyDocsMobileSheetLayout() {
    panel.classList.add("render-agent-panel--mobile-sheet");
    panel.style.left = "0";
    panel.style.right = "0";
    panel.style.top = "auto";
    panel.style.bottom = "0";
    panel.style.width = "100%";
    panel.style.height = `${Math.min(Math.round(window.innerHeight * 0.92), window.innerHeight - 8)}px`;
    panel.style.maxHeight = "none";
  }

  function clearDocsMobileSheetLayout() {
    panel.classList.remove("render-agent-panel--mobile-sheet");
  }

  function syncDocsPageLayout(openPanel) {
    if (!panel.classList.contains("render-agent-panel--docs")) return;
    const mobile = !isDesktopViewport();
    if (mobile) {
      document.body.classList.remove("gs-agent-open");
      document.body.classList.toggle("gs-agent-sheet-open", !!openPanel);
      document.body.style.overflow = openPanel ? "hidden" : "";
      ensureDocsMobileBackdrop()?.classList.toggle("hidden", !openPanel);
      return;
    }
    document.body.classList.remove("gs-agent-sheet-open");
    document.body.style.overflow = "";
    ensureDocsMobileBackdrop()?.classList.add("hidden");
    document.body.classList.toggle("gs-agent-open", !!openPanel);
  }

  function syncPartsListFab(isOpen) {
    document.querySelectorAll(".render-agent-fab--parts").forEach((fab) => {
      // Same Docs collapse: hide the gear fab while the panel is open; header × dismisses.
      fab.classList.toggle("hidden", !!isOpen);
      fab.classList.remove("is-open");
      fab.setAttribute("aria-pressed", isOpen ? "true" : "false");
      fab.setAttribute("aria-expanded", isOpen ? "true" : "false");
      fab.removeAttribute("aria-hidden");
      fab.tabIndex = isOpen ? -1 : 0;
      fab.style.pointerEvents = "";
      fab.style.display = "";
      fab.title = "Ask Render Agent";
      fab.setAttribute("aria-label", "Ask Render Agent");
      const label = fab.querySelector("span");
      if (label) label.textContent = "Ask Agent";
    });
  }

  function syncFabState(isOpen) {
    if (isStudioAgentChrome()) {
      hideStudioFabs();
      const header = document.getElementById("btn-render-agent");
      if (header) {
        header.classList.toggle("is-open", !!isOpen);
        header.setAttribute("aria-pressed", isOpen ? "true" : "false");
        header.setAttribute("aria-expanded", isOpen ? "true" : "false");
      }
      syncPartsListFab(isOpen);
      return;
    }
    const fab = document.getElementById("render-agent-fab");
    if (!fab) return;
    const docsPanel = panel.classList.contains("render-agent-panel--docs");
    if (docsPanel) {
      // Docs: hide the FAB while the agent is open so there is no "Close Agent"
      // button; the panel header × dismisses the agent.
      fab.classList.toggle("hidden", !!isOpen);
      fab.classList.remove("is-open");
      fab.setAttribute("aria-pressed", isOpen ? "true" : "false");
      fab.setAttribute("aria-expanded", isOpen ? "true" : "false");
      fab.title = "Ask Render Agent";
      fab.setAttribute("aria-label", "Ask Render Agent");
      const label = fab.querySelector("span");
      if (label) label.textContent = "Ask Agent";
      return;
    }
    fab.classList.remove("hidden");
    fab.classList.toggle("is-open", !!isOpen);
    fab.setAttribute("aria-pressed", isOpen ? "true" : "false");
    fab.setAttribute("aria-expanded", isOpen ? "true" : "false");
    fab.title = isOpen ? "Close Render Agent" : "Ask Render Agent";
    const label = fab.querySelector("span");
    if (label) label.textContent = isOpen ? "Close Agent" : "Ask Agent";
    if (isVrHeadsetBrowser()) {
      fab.classList.toggle("hidden", !!isOpen);
      fab.classList.remove("is-open");
      if (label) label.textContent = "Ask Agent";
    }
  }

  function open({
    onboarding: showOnboarding = false,
    question = "",
    debugImprove = false,
    fromLauncher = false,
    force = false,
    partsList = false,
    mini = false,
  } = {}) {
    // Same-gesture leftover pointerup / bubbled click / key-ready announce must
    // not steal the prompt toolbar. Explicit Agent control + scripted asks still open.
    if (
      !fromLauncher
      && !force
      && !showOnboarding
      && !debugImprove
      && !String(question || "").trim()
      && promptChromeGestureBlocksOpen()
    ) {
      return;
    }
    if (debugImprove) debugImproveSession = true;
    const docsPanel = panel.classList.contains("render-agent-panel--docs");
    if (!currentUserId() && !docsPanel) {
      onRequireLogin?.();
      return;
    }
    try {
      void import("./feature-events.js?v=20260721-quest-notify&vrboard=20260915-spatial-draw4").then((m) => {
        m.emitFeatureUsed?.("render-agent", { title: "Render Agent help chat" });
      });
    } catch {
      /* ignore */
    }
    applyHeadsetAgentChrome();
    panel.classList.remove("hidden");
    panel.classList.add("render-agent-panel--sticky");
    if (docsPanel) {
      panel.classList.add("render-agent-panel--popup");
    }
    panel.classList.toggle("render-agent-panel--parts", !docsPanel && (!!partsList || isPartsAgentSurfaceOpen()));
    panel.classList.toggle("render-agent-panel--mini", !!mini);
    showRaTab(activeRaTab);
    syncFabState(true);
    ensureStickyNoteControls();
    restoreStickyLayout();
    syncDocsPageLayout(true);
    if (showOnboarding && onboarding) {
      onboarding.classList.remove("hidden");
      showWelcomeTip();
      markOnboardingSeen();
    }
    const normalizedQuestion = String(question || "").trim();
    if (normalizedQuestion && input) {
      pendingQuestionContext = normalizedQuestion;
      const currentText = input.value.trim();
      if (!currentText) {
        input.value = normalizedQuestion;
      } else if (currentText !== normalizedQuestion && !currentText.includes(normalizedQuestion)) {
        input.value = `${normalizedQuestion}\n\n${currentText}`;
      }
    }
    if (currentUserId()) {
      void refreshThreads().then(() => {
        if (showOnboarding) showWelcomeTip();
        if (!docsPanel) {
          void import("../sandbox/render-agent-crew-score.js?v=20260923-draw-recordings1")
            .then((m) => m.maybePingDailyCrew({ announce, force: false }))
            .catch(() => {});
        }
      });
      void refreshTeamMembers();
    } else if (messagesEl && !(messagesEl.childElementCount)) {
      messagesEl.innerHTML = `
        <div class="render-agent-empty">
          <strong>Ask me anything about Render Studio.</strong>
          <p class="muted small">Sign in to send a question — demos from Getting Started appear in replies.</p>
          <p class="muted small"><a href="/getting-started.html">Getting Started docs</a></p>
        </div>
      `;
    }
    setTimeout(() => {
      const skipFocus = !isDesktopViewport()
        && docsPanel
        && !normalizedQuestion;
      if (!skipFocus) input?.focus();
      if (normalizedQuestion && input) {
        const len = input.value.length;
        input.setSelectionRange?.(len, len);
      }
    }, 50);
  }

  async function openFromAlert(msg = {}) {
    const preview = String(msg.preview || "").trim();
    announce(preview, {
      openPanel: false,
      ping: !!msg.ping || !!msg.open_agent,
      threadId: msg.thread_id,
    });
  }

  function pingFab() {
    const fab = document.getElementById("render-agent-fab") || btn;
    if (!fab) return;
    fab.classList.add("is-alerting");
    window.setTimeout(() => fab.classList.remove("is-alerting"), 4500);
  }

  function announce(preview, { openPanel = false, ping = true, threadId = "" } = {}) {
    const text = String(preview || "").trim();
    if (text) {
      pendingAnnounceText = text;
      setStatus(text.slice(0, 180));
    }
    if (openPanel) open();
    if (ping) pingFab();
    if (threadId) {
      void (async () => {
        try {
          await loadThread(threadId);
        } catch {
          renderMessages();
        }
      })();
    } else {
      renderMessages();
    }
  }

  async function openWithQuestion(question, { autoSend = false, missingSetting = false, mini = false, partsList = false } = {}) {
    const q = String(question || "").trim();
    if (missingSetting) pendingMissingSetting = q.replace(/^I'm looking for a setting:\s*"([^"]+)".*/i, "$1").trim() || q;
    open({ question: q, fromLauncher: true, force: true, mini, partsList: partsList || mini });
    if (!q || !autoSend || !currentUserId()) return;
    for (let i = 0; i < 24 && !activeThread?.id; i += 1) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (input) input.value = q;
    await sendMessage();
  }

  async function openWithDebug(payload = {}) {
    debugImproveSession = true;
    pendingDebugSelection = payload?.selection || payload || null;
    const prompt = String(payload?.prompt || payload?.question || "").trim();
    const bits = [];
    if (payload?.source) bits.push(`Source: ${payload.source}`);
    if (pendingDebugSelection?.label) bits.push(`Selection: ${pendingDebugSelection.label}`);
    if (pendingDebugSelection?.filename) bits.push(`File: ${pendingDebugSelection.filename}`);
    const seed = prompt
      || (bits.length
        ? `Debug this Improve Lab selection.\n${bits.join("\n")}\nWhat should change?`
        : "Analyze this Improve Lab compare and suggest improved prompts.");
    open({ debugImprove: true, question: seed });
    if (input && !input.value.trim()) input.value = seed;
  }

  function messageWithPendingContext(message) {
    const context = pendingQuestionContext.trim();
    const body = String(message || "").trim();
    if (!context || !body || body === context || body.includes(context)) return body;
    return `${context}\n\nAdditional question:\n${body}`;
  }

  function close() {
    clearInterval(agentsPoll);
    agentsPoll = 0;
    panel.classList.add("hidden");
    panel.classList.remove("render-agent-panel--parts", "render-agent-panel--mini");
    syncFabState(false);
    syncDocsPageLayout(false);
  }

  function toggle() {
    if (panel.classList.contains("hidden")) open({ fromLauncher: true });
    else close();
  }

  function layoutStorageKey() {
    if (panel.classList.contains("render-agent-panel--docs")) return DOCS_PANEL_LAYOUT_KEY;
    if (panel.classList.contains("render-agent-panel--parts")) return PARTS_PANEL_LAYOUT_KEY;
    return PANEL_LAYOUT_KEY;
  }

  function readStickyLayout() {
    try {
      const raw = JSON.parse(localStorage.getItem(layoutStorageKey()) || "null");
      return raw && typeof raw === "object" ? raw : null;
    } catch {
      return null;
    }
  }

  function writeStickyLayout(next) {
    try {
      localStorage.setItem(layoutStorageKey(), JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function restoreStickyLayout() {
    if (!stickyNote) return;
    panel.classList.add("render-agent-panel--sticky");
    const isDocs = panel.classList.contains("render-agent-panel--docs");
    const compact = isDocs || panel.classList.contains("render-agent-panel--parts");
    if (isDocs) {
      panel.classList.add("render-agent-panel--popup");
      panel.classList.remove("render-agent-panel--deck");
    }
    if (isDocs && !isDesktopViewport()) {
      applyDocsMobileSheetLayout();
      return;
    }
    if (applyHeadsetAgentChrome()) {
      clearDocsMobileSheetLayout();
      const w = Math.min(280, Math.max(220, window.innerWidth - 24));
      const h = Math.min(220, Math.max(168, Math.round(window.innerHeight * 0.28)));
      panel.style.left = "auto";
      panel.style.right = "10px";
      panel.style.top = "56px";
      panel.style.bottom = "auto";
      panel.style.width = `${w}px`;
      panel.style.height = `${h}px`;
      panel.style.maxHeight = `${h}px`;
      return;
    }
    clearDocsMobileSheetLayout();
    const saved = readStickyLayout();
    const maxPanelW = Math.min(compact ? 340 : 360, Math.max(260, window.innerWidth - 32));
    const minPanelW = Math.min(compact ? 300 : 280, maxPanelW);
    const defaultW = maxPanelW;
    // Docs / Parts List: bottom-right, shorter so the page can fill beside it.
    const defaultH = Math.min(
      compact ? 460 : 640,
      Math.max(280, window.innerHeight - (compact ? 120 : 112)),
    );
    const defaultTop = compact
      ? Math.max(72, window.innerHeight - defaultH - 24)
      : 72;
    if (!saved) {
      panel.style.left = "auto";
      panel.style.right = "16px";
      panel.style.width = `${defaultW}px`;
      panel.style.height = `${defaultH}px`;
      panel.style.maxHeight = "none";
      if (compact) {
        panel.style.top = "auto";
        panel.style.bottom = "24px";
      } else {
        panel.style.bottom = "auto";
        panel.style.top = `${defaultTop}px`;
      }
      return;
    }
    if (saved.width) panel.style.width = `${Math.min(maxPanelW, Math.max(minPanelW, saved.width))}px`;
    else panel.style.width = `${defaultW}px`;
    if (saved.height) panel.style.height = `${Math.max(compact ? 360 : 260, saved.height)}px`;
    else panel.style.height = `${defaultH}px`;
    panel.style.maxHeight = "none";
    if (Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      panel.style.right = "auto";
      panel.style.left = `${Math.max(8, Math.min(window.innerWidth - 80, saved.left))}px`;
      panel.style.bottom = "auto";
      panel.style.top = `${Math.max(8, Math.min(window.innerHeight - 80, saved.top))}px`;
    } else if (compact) {
      panel.style.left = "auto";
      panel.style.right = "16px";
      panel.style.top = "auto";
      panel.style.bottom = "24px";
    } else {
      panel.style.left = "auto";
      panel.style.right = "16px";
      panel.style.bottom = "auto";
      panel.style.top = `${defaultTop}px`;
    }
  }


  function enterPresentationDeck() {
    if (panel.classList.contains("render-agent-panel--docs") && !isDesktopViewport()) {
      applyDocsMobileSheetLayout();
      return;
    }
    clearDocsMobileSheetLayout();
    panel.classList.add("render-agent-panel--deck");
    const w = Math.min(760, Math.max(420, window.innerWidth - 48));
    const h = Math.min(820, Math.max(480, window.innerHeight - 48));
    panel.style.width = `${w}px`;
    panel.style.height = `${h}px`;
    panel.style.maxHeight = "none";
    panel.style.left = "auto";
    panel.style.right = "20px";
    panel.style.top = "64px";
  }

  function leavePresentationDeck() {
    panel.classList.remove("render-agent-panel--deck");
  }

  function ensureStickyNoteControls() {
    if (!stickyNote || panel.dataset.stickyReady === "1") return;
    panel.dataset.stickyReady = "1";
    panel.classList.add("render-agent-panel--sticky");
    const head = panel.querySelector(".render-agent-head");
    if (head && !head.querySelector(".render-agent-drag-hint")) {
      const hint = document.createElement("span");
      hint.className = "render-agent-drag-hint";
      hint.textContent = "⠿";
      hint.title = "Drag to move";
      head.insertBefore(hint, head.firstChild);
    }
    const edges = ["n", "s", "e", "w", "se", "sw", "ne", "nw"];
    for (const edge of edges) {
      if (panel.querySelector(`.render-agent-resize--${edge}`)) continue;
      const resize = document.createElement("div");
      resize.className = `render-agent-resize render-agent-resize--${edge}`;
      resize.dataset.edge = edge;
      resize.title = "Drag edge to resize";
      panel.appendChild(resize);
    }

    let drag = null;
    const onMove = (e) => {
      if (!drag) return;
      e.preventDefault();
      if (drag.mode === "move") {
        const left = Math.max(8, Math.min(window.innerWidth - 80, drag.startLeft + (e.clientX - drag.sx)));
        const top = Math.max(8, Math.min(window.innerHeight - 80, drag.startTop + (e.clientY - drag.sy)));
        panel.style.right = "auto";
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        return;
      }
      if (drag.mode !== "resize") return;
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      const edge = drag.edge || "se";
      let width = drag.startW;
      let height = drag.startH;
      let left = drag.startLeft;
      let top = drag.startTop;
      if (edge.includes("e")) width = drag.startW + dx;
      if (edge.includes("w")) {
        width = drag.startW - dx;
        left = drag.startLeft + dx;
      }
      if (edge.includes("s")) height = drag.startH + dy;
      if (edge.includes("n")) {
        height = drag.startH - dy;
        top = drag.startTop + dy;
      }
      width = Math.max(260, Math.min(window.innerWidth - 16, width));
      height = Math.max(260, Math.min(window.innerHeight - 16, height));
      if (edge.includes("w")) {
        left = Math.max(8, Math.min(drag.startLeft + drag.startW - 260, left));
        width = drag.startLeft + drag.startW - left;
      }
      if (edge.includes("n")) {
        top = Math.max(8, Math.min(drag.startTop + drag.startH - 260, top));
        height = drag.startTop + drag.startH - top;
      }
      panel.style.right = "auto";
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      panel.style.width = `${width}px`;
      panel.style.height = `${height}px`;
      panel.style.maxHeight = "none";
    };
    const onUp = () => {
      if (!drag) return;
      drag = null;
      panel.classList.remove("is-dragging");
      writeStickyLayout({
        left: parseFloat(panel.style.left) || panel.getBoundingClientRect().left,
        top: parseFloat(panel.style.top) || panel.getBoundingClientRect().top,
        width: panel.offsetWidth,
        height: panel.offsetHeight,
      });
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    head?.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      if (e.target.closest("button, a, input, select, textarea")) return;
      const rect = panel.getBoundingClientRect();
      drag = {
        mode: "move",
        sx: e.clientX,
        sy: e.clientY,
        startLeft: rect.left,
        startTop: rect.top,
      };
      panel.classList.add("is-dragging");
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });

    panel.querySelectorAll(".render-agent-resize").forEach((handle) => {
      handle.addEventListener("pointerdown", (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = panel.getBoundingClientRect();
        drag = {
          mode: "resize",
          edge: handle.dataset.edge || "se",
          sx: e.clientX,
          sy: e.clientY,
          startW: rect.width,
          startH: rect.height,
          startLeft: rect.left,
          startTop: rect.top,
        };
        panel.classList.add("is-dragging");
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      });
    });
  }

  function renderThreadMenu() {
    if (activeThreadLabel) {
      activeThreadLabel.textContent = activeThread?.title || "Ask about tools, projects, Fusion, files, and workflows";
    }
    if (!threadListEl) return;
    const folders = [...new Set(threads.map((thread) => thread.folder || "").filter(Boolean))].sort((a, b) => a.localeCompare(b));
    const query = threadSearch.trim().toLowerCase();
    const filtered = query
      ? threads.filter((thread) => `${thread.title || ""} ${thread.folder || ""}`.toLowerCase().includes(query))
      : threads;
    const grouped = new Map();
    filtered.forEach((thread) => {
      const folder = thread.folder || "Unfiled";
      grouped.set(folder, [...(grouped.get(folder) || []), thread]);
    });
    const folderOptions = (current = "") => `
      <option value="">Unfiled</option>
      ${folders.map((folder) => `<option value="${esc(folder)}"${folder === current ? " selected" : ""}>${esc(folder)}</option>`).join("")}
      <option value="__new__">+ New folder...</option>
    `;
    const iterations = activeThread?.iterations
      || threads.find((thread) => thread.id === activeThread?.id)?.iterations
      || [];
    threadListEl.innerHTML = `
      <div class="render-agent-thread-tools">
        <input type="search" class="render-agent-thread-search" placeholder="Search threads..." value="${esc(threadSearch)}" />
        <button type="button" class="btn secondary btn-compact" data-thread-new-folder>Folder</button>
      </div>
      ${iterations.length ? `
        <section class="render-agent-thread-folder">
          <div class="render-agent-thread-folder-title">
            <span>Iterations timeline</span>
            <small>${iterations.length}</small>
          </div>
          <div class="render-agent-iterations">
            ${[...iterations].reverse().map((it) => `
              <button type="button" class="render-agent-iteration" data-iteration-id="${esc(it.id)}">
                ${it.thumbnail
                  ? `<img src="${esc(it.thumbnail)}" alt="" />`
                  : `<span class="render-agent-iteration-ph" aria-hidden="true"></span>`}
                <span>
                  <strong>${esc(it.description || "Improve idea")}</strong>
                  <small>${esc(it.notes || "Click to restore this prompt")}</small>
                </span>
              </button>
            `).join("")}
          </div>
        </section>
      ` : ""}
      ${filtered.length ? [...grouped.entries()].map(([folder, items]) => `
        <section class="render-agent-thread-folder">
          <div class="render-agent-thread-folder-title">
            <span>${esc(folder)}</span>
            <small>${items.length}</small>
          </div>
          ${items.map((thread) => `
            <article class="render-agent-thread-card${activeThread?.id === thread.id ? " active" : ""}">
              <button type="button" class="render-agent-thread-item" data-thread-id="${esc(thread.id)}">
                <span>${esc(thread.title || "New thread")}</span>
                <small>${thread.message_count || 0} messages · ${(thread.members || []).length || 1} people</small>
              </button>
              <label class="render-agent-thread-folder-select">Move
                <select data-thread-folder="${esc(thread.id)}">${folderOptions(thread.folder || "")}</select>
              </label>
            </article>
          `).join("")}
        </section>
      `).join("") : `<p class="muted small">No threads match your search.</p>`}
    `;
    threadListEl.querySelector(".render-agent-thread-search")?.addEventListener("input", (event) => {
      threadSearch = event.target.value || "";
      renderThreadMenu();
      const search = threadListEl.querySelector(".render-agent-thread-search");
      search?.focus();
      search?.setSelectionRange?.(threadSearch.length, threadSearch.length);
    });
    threadListEl.querySelector("[data-thread-new-folder]")?.addEventListener("click", () => {
      const name = window.prompt("New Render Agent thread folder name")?.trim();
      if (!name) return;
      if (activeThread?.id) void moveThreadToFolder(activeThread.id, name);
    });
    threadListEl.querySelectorAll("[data-thread-id]").forEach((item) => {
      item.addEventListener("click", () => {
        threadPopover?.classList.add("hidden");
        threadMenuBtn?.setAttribute("aria-expanded", "false");
        void loadThread(item.dataset.threadId);
      });
    });
    threadListEl.querySelectorAll("[data-thread-folder]").forEach((select) => {
      select.addEventListener("change", () => {
        let folder = select.value || "";
        if (folder === "__new__") {
          folder = window.prompt("Move thread to new folder")?.trim() || "";
          if (!folder) {
            renderThreadMenu();
            return;
          }
        }
        void moveThreadToFolder(select.dataset.threadFolder, folder);
      });
    });
    threadListEl.querySelectorAll("[data-iteration-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const it = iterations.find((row) => String(row.id) === btn.getAttribute("data-iteration-id"));
        if (!it) return;
        const prompt = String(it.prompt || "").trim();
        if (prompt) onRestoreImprovePrompt?.(prompt);
        if (input && prompt) input.value = prompt;
        setStatus(`Restored iteration: ${it.description || "Improve idea"}`);
        closeThreadMenu();
      });
    });
  }

  function mentionRoster() {
    const people = [];
    const seen = new Set();
    const add = (handle, label) => {
      const h = String(handle || "").replace(/^@/, "").trim();
      if (!h || seen.has(h.toLowerCase())) return;
      seen.add(h.toLowerCase());
      people.push({ handle: h, label: label || h });
    };
    AT_ROSTER.forEach((row) => add(row.handle, row.label));
    (activeThread?.members || []).forEach((member) => {
      add(member.handle || member.display_name || member.id, candidateLabel(member));
    });
    return people;
  }

  function hideMentionMenu() {
    mentionMenu?.classList.add("hidden");
    mentionHits = [];
  }

  function insertMentionHandle(handle) {
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, start);
    const after = input.value.slice(start);
    const next = before.replace(/@([A-Za-z0-9_-]*)$/, `@${handle} `);
    input.value = next + after;
    const caret = next.length;
    input.setSelectionRange(caret, caret);
    hideMentionMenu();
    input.focus();
  }

  function renderMentionMenu() {
    if (!mentionMenu || !input) return;
    const start = input.selectionStart ?? input.value.length;
    const before = input.value.slice(0, start);
    const match = before.match(/@([A-Za-z0-9_-]*)$/);
    if (!match) {
      hideMentionMenu();
      return;
    }
    const q = (match[1] || "").toLowerCase();
    mentionHits = mentionRoster().filter((row) => {
      const hay = `${row.handle} ${row.label}`.toLowerCase();
      return !q || hay.includes(q) || row.handle.toLowerCase().startsWith(q);
    }).slice(0, 8);
    if (!mentionHits.length) {
      hideMentionMenu();
      return;
    }
    mentionIndex = Math.min(mentionIndex, mentionHits.length - 1);
    mentionMenu.innerHTML = mentionHits.map((row, i) => `
      <button type="button" class="prompt-mention-option${i === mentionIndex ? " is-active" : ""}" data-at="${esc(row.handle)}" role="option">
        <span class="prompt-mention-option-token">@${esc(row.handle)}</span>
        <span class="prompt-mention-option-kind">${esc(row.label)}</span>
      </button>
    `).join("");
    mentionMenu.classList.remove("hidden");
    mentionMenu.querySelectorAll("[data-at]").forEach((btn) => {
      btn.addEventListener("mousedown", (ev) => ev.preventDefault());
      btn.addEventListener("click", () => insertMentionHandle(btn.getAttribute("data-at")));
    });
  }

  function handleMentionKeys(event) {
    if (!mentionMenu || mentionMenu.classList.contains("hidden") || !mentionHits.length) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      mentionIndex = (mentionIndex + 1) % mentionHits.length;
      renderMentionMenu();
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      mentionIndex = (mentionIndex - 1 + mentionHits.length) % mentionHits.length;
      renderMentionMenu();
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      hideMentionMenu();
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      insertMentionHandle(mentionHits[mentionIndex]?.handle);
      return true;
    }
    return false;
  }

  function renderMembers() {
    if (!membersEl) return;
    const members = activeThread?.members?.length
      ? activeThread.members
      : [getCurrentUser?.()].filter(Boolean);
    membersEl.innerHTML = members
      .map((member) => {
        const handle = String(member.handle || member.display_name || member.id || "sam").replace(/\s+/g, "-");
        return `<button type="button" class="at-person" data-at="@${esc(handle)}" title="@${esc(handle)}">${avatarHtml(member, "render-agent-member-avatar")}</button>`;
      })
      .join("");
    membersEl.querySelectorAll("[data-at]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const at = btn.getAttribute("data-at") || "";
        if (input && at) input.value = `${input.value ? `${input.value.replace(/\s+$/, "")} ` : ""}${at} `;
        input?.focus();
      });
    });
  }

  function ensureAgentControls() {
    if (!agentSourceRow && membersEl?.parentElement) {
      agentSourceRow = document.createElement("div");
      agentSourceRow.className = "render-agent-source-row";
      membersEl.parentElement.insertAdjacentElement("afterend", agentSourceRow);
    }
    if (!invitePicker && inviteSelect?.parentElement) {
      inviteSelect.hidden = true;
      invitePicker = document.createElement("div");
      invitePicker.className = "render-agent-invite-picker";
      inviteSelect.insertAdjacentElement("afterend", invitePicker);
    }
  }

  function renderAgentKeyFields() {
    const fields = typeof getSelectedAiKey === "function" ? (getSelectedAiKey() || {}) : {};
    return fields && typeof fields === "object" ? fields : {};
  }

  function renderAgentBillingHint(fields = {}) {
    const source = String(fields.ai_key_source || "").toLowerCase();
    if (source === "chatgpt" || source === "subscription" || source === "codex") {
      return "Uses your ChatGPT subscription";
    }
    if (source === "cursor") return "Uses your Cursor subscription";
    if (source === "claude") return "Uses your Claude subscription";
    if (fields.ai_key_id) return "Uses your assigned API key";
    if (source === "platform") return "Uses Studio credits";
    return "Guest: cheap Luna (no ChatGPT login)";
  }

  let designChatThread = null;
  let designChatThreadProjectId = "";
  let designChatBusyProjectId = "";
  let designChatGenerationPending = false;
  let designChatFailedGeneration = null;
  let designChatGenerationQueue = [];
  let designChatActiveGeneration = null;
  let designChatLocalMessages = [];
  let designChatLoadEpoch = 0;
  let designChatAttachments = [];
  // References already sent in this design conversation remain part of the
  // eventual build. The chat composer and the main generation composer are
  // separate surfaces, so rebuilding the packet from only getPromptImages()
  // silently discarded uploads when the user pressed Build with Mesh/CAD.
  let designChatReferenceAttachments = [];
  const designChatVoiceSessions = new Set();
  const DESIGN_SURFACE_REFERENCE_TYPES = ["face", "edge", "corner", "lasso", "path"];

  function designModelState() {
    const raw = getDesignModelState?.() || {};
    const targets = Array.isArray(raw.targets)
      ? raw.targets.filter((item) => item?.filename).map((item) => ({
        filename: String(item.filename),
        label: String(item.label || item.filename),
        subtitle: String(item.subtitle || ""),
      }))
      : [];
    const selectedFilename = String(raw.selectedFilename || "");
    return {
      selectedFilename: targets.some((item) => item.filename === selectedFilename)
        ? selectedFilename
        : targets[0]?.filename || "",
      targets,
    };
  }

  function designChatStorageKey() {
    return `render3d:promptDesignChat:${currentUserId() || "anonymous"}:${getProjectId?.() || "none"}`;
  }

  function storedDesignChatThreadId() {
    try { return localStorage.getItem(designChatStorageKey()) || ""; } catch { return ""; }
  }

  function activeDesignChatThreadId() {
    return designChatThreadProjectId === String(getProjectId?.() || "") ? (designChatThread?.id || "") : "";
  }

  function designChatIsBusy() {
    return designChatBusyProjectId === String(getProjectId?.() || "");
  }

  function designConversationContext() {
    const projectId = String(getProjectId?.() || "");
    const messages = [
      ...(designChatThreadProjectId === projectId ? designChatThread?.messages || [] : []),
      ...designChatLocalMessages.filter((item) => item.projectId === projectId),
    ]
      .filter((item) => item?.role === "user" || item?.role === "assistant")
      .slice(-12)
      .map((item) => ({
        role: item.role,
        content: String(item.content || "").trim().slice(0, 2000),
      }))
      .filter((item) => item.content);
    if (!messages.length) return null;
    return {
      project_id: projectId,
      thread_id: activeDesignChatThreadId() || storedDesignChatThreadId(),
      messages,
    };
  }

  function promptDesignContext() {
    const target = document.getElementById("prompt-target-mode");
    const engine = document.getElementById("prompt-cad-engine");
    const references = (getPromptReferences?.() || []).filter((ref) => ref?.id).slice(0, 24);
    const surface = references.find((ref) => DESIGN_SURFACE_REFERENCE_TYPES.includes(String(ref.type || "").toLowerCase()));
    const models = designModelState();
    return {
      selected: surface?.label || models.selectedFilename || getSelectedFile?.() || "",
      models,
      targetMode: target?.value || "auto",
      engine: engine?.selectedOptions?.[0]?.textContent || engine?.value || "CAD",
      draft: document.getElementById("prompt-input")?.value || "",
      references,
      machine: getActiveMachine?.() || null,
    };
  }

  function renderDesignChatContext(host) {
    const contextEl = host?.querySelector("[data-prompt-design-context]");
    if (!contextEl) return;
    const context = promptDesignContext();
    const refs = context.references;
    const machine = activeMachineDesignContext(context.machine);
    const chips = [
      ...(machine ? [{ id: "machine:active", label: machine.name || [machine.brand, machine.model].filter(Boolean).join(" ") || machine.kind || "Active machine", kind: "machine" }] : []),
      ...refs.map((ref) => ({ id: `ref:${ref.id}`, label: ref.label || ref.token || ref.filename || ref.type, kind: ref.type || "reference" })),
      ...designChatAttachments.map((item) => ({ id: `attachment:${item.id}`, label: item.name, kind: "upload" })),
    ];
    contextEl.innerHTML = chips.length
      ? `<details class="prompt-design-context-disclosure">
          <summary aria-label="Show ${chips.length} connected design context items"><span aria-hidden="true">↗</span>${chips.length} connected</summary>
          <div class="prompt-design-context-popover" role="list" aria-label="Connected design context">
            ${chips.map((item) => `<span class="prompt-design-context-chip" data-context-id="${esc(item.id)}" role="listitem"><small>${esc(item.kind)}</small>${esc(item.label)}${item.id.startsWith("attachment:") ? '<button type="button" aria-label="Remove upload">×</button>' : ""}</span>`).join("")}
          </div>
        </details>`
      : '<span class="prompt-design-context-empty">Select a face or lasso, link project files in the CAD prompt, or upload references here.</span>';
    contextEl.querySelectorAll('[data-context-id^="attachment:"] button').forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.closest("[data-context-id]")?.dataset.contextId?.slice("attachment:".length);
        designChatAttachments = designChatAttachments.filter((item) => item.id !== id);
        renderDesignChatContext(host);
      });
    });
  }

  async function addDesignChatFiles(host, files) {
    for (const file of [...(files || [])]) {
      if (designChatAttachments.length >= 6) break;
      if (file.size > 8 * 1024 * 1024) {
        setDesignChatStatus(host, `${file.name} is too large. Use reference files under 8 MB.`, true);
        continue;
      }
      try {
        const ready = isHeicFile(file) ? await convertHeicFileToPng(file) : file;
        if (ready.size > 8 * 1024 * 1024) {
          setDesignChatStatus(host, `${ready.name} is too large after conversion. Use a photo under 8 MB.`, true);
          continue;
        }
        let dataUrl = isImage(ready) || /\.(png|jpe?g|webp)$/i.test(String(ready.name || ""))
          ? await fileToDataUrl(ready)
          : "";
        const inferredMediaType = designAttachmentMediaType(ready, dataUrl);
        if (dataUrl && !dataUrl.startsWith("data:image/") && inferredMediaType.startsWith("image/")) {
          dataUrl = dataUrl.replace(/^data:[^;,]*/, `data:${inferredMediaType}`);
        }
        const base = {
          id: `design-att-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          name: ready.name || "reference",
          media_type: designAttachmentMediaType(ready, dataUrl),
        };
        if (dataUrl) designChatAttachments.push({ ...base, data_url: dataUrl });
        else if (isTextLike(ready)) designChatAttachments.push({ ...base, text: (await fileToText(ready)).slice(0, 20000) });
        else designChatAttachments.push(base);
      } catch (error) {
        setDesignChatStatus(host, error?.message || `Could not convert ${file.name || "that HEIC photo"} to PNG.`, true);
      }
    }
    renderDesignChatContext(host);
  }

  function setDesignChatStatus(host, message = "", isError = false) {
    const el = host?.querySelector("[data-prompt-design-status]");
    if (!el) return;
    el.textContent = message;
    el.classList.toggle("error", !!isError);
  }

  function cloneDesignGenerationFiles(items = []) {
    try { return JSON.parse(JSON.stringify(items || [])); } catch { return []; }
  }

  function designAttachmentMediaType(file, dataUrl = "") {
    const explicit = String(file?.type || "").trim().toLowerCase();
    if (explicit && explicit !== "application/octet-stream") {
      return explicit === "image/jpg" ? "image/jpeg" : explicit;
    }
    const dataMatch = String(dataUrl || "").match(/^data:image\/(png|jpeg|jpg|webp);base64,/i);
    if (dataMatch) return dataMatch[1].toLowerCase() === "jpg" ? "image/jpeg" : `image/${dataMatch[1].toLowerCase()}`;
    const name = String(file?.name || "").toLowerCase();
    if (/\.png$/.test(name)) return "image/png";
    if (/\.jpe?g$/.test(name)) return "image/jpeg";
    if (/\.webp$/.test(name)) return "image/webp";
    return explicit || "application/octet-stream";
  }

  function rememberDesignChatReferences(items = []) {
    const byId = new Map(designChatReferenceAttachments.map((item) => [item.id, item]));
    for (const item of items || []) {
      if (item?.id) byId.set(item.id, cloneDesignGenerationFiles(item));
    }
    designChatReferenceAttachments = [...byId.values()].slice(-12);
  }

  function designChatGenerationImages(composerImages = []) {
    const chatImages = designChatReferenceAttachments.filter((item) =>
      String(item?.data_url || "").startsWith("data:image/") && item?.data_url?.includes(";base64,"));
    const merged = [...(composerImages || []), ...chatImages];
    const unique = new Map();
    for (const item of merged) {
      const key = String(item?.stored_name || item?.source_filename || item?.id || item?.name || "");
      if (key) unique.set(key, item);
    }
    return cloneDesignGenerationFiles([...unique.values()].slice(-8));
  }

  function designChatGenerationReferences(composerReferences = []) {
    const chatReferences = designChatReferenceAttachments
      .filter((item) => item?.text)
      .map((item) => ({
        id: `design-upload:${item.id}`,
        type: "spec",
        label: item.name,
        filename: item.name,
        text_content: item.text,
      }));
    return cloneDesignGenerationFiles([...(composerReferences || []), ...chatReferences]);
  }

  function designGenerationPacket({ prompt, targetMode, selectedFilename }) {
    return {
      prompt: String(prompt || ""),
      projectId: String(getProjectId?.() || ""),
      targetMode: String(targetMode || "new"),
      selectedFilename: String(selectedFilename || ""),
      references: designChatGenerationReferences(getPromptReferences?.()),
      images: designChatGenerationImages(getPromptImages?.()),
    };
  }

  function designGenerationQueueItem(packet) {
    return {
      id: `design-queue-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      projectId: packet.projectId,
      packet: cloneDesignGenerationFiles(packet),
      status: "queued",
      traceId: "",
      error: "",
      queuedAt: Date.now(),
    };
  }

  function designQueueForProject(projectId = String(getProjectId?.() || "")) {
    return designChatGenerationQueue.filter((item) => item.projectId === projectId);
  }

  function startNextDesignGeneration(host) {
    if (designChatGenerationPending || designChatActiveGeneration) return;
    const projectId = String(getProjectId?.() || "");
    const next = designChatGenerationQueue.find((item) => item.projectId === projectId && item.status === "queued");
    if (!next) return;
    designChatActiveGeneration = next;
    next.status = "starting";
    runDesignGeneration(host, next.packet, null, next);
  }

  function enqueueDesignGeneration(host, packet) {
    if (!packet?.prompt) return null;
    const item = designGenerationQueueItem(packet);
    designChatGenerationQueue.push(item);
    renderDesignChat(host, { scrollToLatest: true });
    startNextDesignGeneration(host);
    return item;
  }

  function settleDesignGeneration(host, detail = {}) {
    const active = designChatActiveGeneration;
    if (!active) return;
    if (String(detail.projectId || "") !== active.projectId) return;
    const settledTrace = String(detail.trace_id || detail.traceId || "");
    if (active.traceId && settledTrace && active.traceId !== settledTrace) return;
    if (detail.status === "complete") {
      designChatGenerationQueue = designChatGenerationQueue.filter((item) => item.id !== active.id);
      const latestFilename = String(detail.filename || "");
      if (latestFilename) {
        for (const item of designChatGenerationQueue) {
          if (item.projectId === active.projectId && item.packet.targetMode === "edit") {
            item.packet.selectedFilename = latestFilename;
          }
        }
      }
      designChatActiveGeneration = null;
      setDesignChatStatus(host, designQueueForProject(active.projectId).length
        ? "Improvement complete. Starting the next queued design…"
        : "Design queue complete. The latest model is ready.");
      renderDesignChat(host, { scrollToLatest: true });
      startNextDesignGeneration(host);
      return;
    }
    active.status = "failed";
    active.error = String(detail.error || `Generation ${detail.status || "failed"}.`);
    designChatActiveGeneration = null;
    setDesignChatStatus(host, "The design queue is paused. Retry the failed improvement to continue.", true);
    renderDesignChat(host, { scrollToLatest: true });
  }

  function runDesignGeneration(host, packet, sourceButton = null, queueItem = null) {
    if (!packet?.prompt || designChatGenerationPending) return;
    designChatGenerationPending = true;
    designChatFailedGeneration = null;
    if (sourceButton) {
      sourceButton.disabled = true;
      sourceButton.textContent = "Starting generation…";
    }
    const prompt = document.getElementById("prompt-input");
    if (prompt) {
      prompt.value = packet.prompt;
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const target = document.getElementById("prompt-target-mode");
    if (target) target.value = packet.targetMode;
    setDesignChatStatus(host, packet.targetMode === "edit"
      ? "Starting CAD harness iteration…"
      : "Starting CAD harness generation…");
    renderDesignChat(host);
    Promise.resolve(onGenerateDesignPrompt?.(packet))
      .then((result) => {
        if (result?.ok === false) throw new Error(result.error || "CAD harness did not start");
        if (queueItem) {
          queueItem.status = "running";
          queueItem.traceId = String(result?.traceId || result?.trace_id || "");
        }
        setDesignChatStatus(host, "CAD harness started. Follow live progress in the viewport; continue this conversation for the next iteration.");
      })
      .catch((error) => {
        if (queueItem) {
          queueItem.status = "failed";
          queueItem.error = String(error?.message || "CAD harness could not start.");
          designChatActiveGeneration = null;
          setDesignChatStatus(host, "The design queue is paused. Retry the failed improvement to continue.", true);
        } else {
          designChatFailedGeneration = {
            projectId: packet.projectId,
            packet,
            error: String(error?.message || "CAD harness could not start."),
          };
          setDesignChatStatus(host, designChatFailedGeneration.error, true);
        }
      })
      .finally(() => {
        designChatGenerationPending = false;
        renderDesignChat(host);
      });
  }

  function renderDesignChat(host, { scrollToLatest = false } = {}) {
    const feed = host?.querySelector("[data-prompt-design-feed]");
    if (!feed) return;
    const scrollTop = feed.scrollTop;
    const followLatest = scrollToLatest || feed.scrollHeight - feed.clientHeight - scrollTop < 48;
    const projectId = String(getProjectId?.() || "");
    const localMessages = designChatLocalMessages.filter((item) => item.projectId === projectId);
    const messages = [
      ...(designChatThreadProjectId === projectId ? designChatThread?.messages || [] : []),
      ...localMessages,
    ];
    if (localMessages.some((item) => item.delivery === "pending")) {
      messages.push({ role: "assistant", content: "Thinking through your design…", delivery: "pending" });
    }
    feed.setAttribute("aria-busy", String(designChatIsBusy()));
    feed.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement("div");
      empty.className = "prompt-design-empty";
      empty.textContent = "Talk through the design. I’ll ask for missing dimensions or fit details, then draft a prompt you can approve.";
      feed.appendChild(empty);
    }
    for (const item of messages) {
      const row = document.createElement("article");
      row.className = `prompt-design-message prompt-design-message--${item.role === "assistant" ? "assistant" : "user"}`;
      const label = document.createElement("strong");
      label.className = "prompt-design-message-heading";
      const avatar = document.createElement(item.role === "assistant" || getCurrentUser?.()?.avatar_url ? "img" : "span");
      avatar.className = "prompt-design-message-avatar";
      if (item.role === "assistant") {
        avatar.src = RENDER3D_LOGO_URL;
        avatar.alt = "";
      } else {
        const user = getCurrentUser?.() || {};
        if (user.avatar_url) {
          avatar.src = user.avatar_url;
          avatar.alt = "";
        } else {
          avatar.textContent = String(user.display_name || user.name || user.email || "U").trim().charAt(0).toUpperCase() || "U";
        }
      }
      const speaker = document.createElement("span");
      speaker.textContent = item.role === "assistant" ? "Render Design Partner" : "You";
      label.append(avatar, speaker);
      const body = document.createElement("div");
      const visible = item.role === "user"
        ? String(item.content || "").replace(/^\[AI CAD DESIGN CONVERSATION\][\s\S]*?User message:\s*/i, "")
        : String(item.content || "");
      body.className = "prompt-design-message-body";
      body.innerHTML = renderMessageText(visible);
      row.append(label, body);
      if (item.delivery === "pending" && item.role === "assistant") row.classList.add("prompt-design-message--pending");
      if (item.delivery === "failed") {
        const delivery = document.createElement("small");
        delivery.className = "prompt-design-delivery";
        delivery.textContent = "Reply failed. Your message is saved here; retry from the text box.";
        row.appendChild(delivery);
      }
      const proposed = item.role === "assistant" ? extractRenderPrompt(item.content) : "";
      if (proposed) {
        const actions = document.createElement("div");
        actions.className = "prompt-design-message-actions";
        const apply = document.createElement("button");
        apply.type = "button";
        apply.className = "btn accent btn-compact";
        apply.dataset.promptDesignApply = "1";
        apply.textContent = "Review prompt";
        apply.addEventListener("click", () => {
          const prompt = document.getElementById("prompt-input");
          if (!prompt) return;
          prompt.value = proposed;
          prompt.dispatchEvent(new Event("input", { bubbles: true }));
          prompt.focus();
          setDesignChatStatus(host, "Draft copied to the CAD composer for review.");
        });
        actions.appendChild(apply);
        const buildWithHarness = (targetMode, sourceButton) => {
          if (sourceButton?.disabled) return;
          const selectedFilename = designModelState().selectedFilename;
          if (targetMode === "edit" && !selectedFilename) {
            setDesignChatStatus(host, "Choose a working model before iterating.", true);
            return;
          }
          enqueueDesignGeneration(host, designGenerationPacket({
            prompt: proposed,
            targetMode,
            selectedFilename,
          }));
          sourceButton.disabled = true;
          sourceButton.textContent = designChatActiveGeneration?.packet?.prompt === proposed ? "Running…" : "Queued";
        };
        const build = document.createElement("button");
        build.type = "button";
        build.className = "btn accent btn-compact";
        build.dataset.promptDesignGenerate = "new";
        build.textContent = "Build a new part";
        build.addEventListener("click", () => buildWithHarness("new", build));
        actions.appendChild(build);
        const proposalModels = promptDesignContext().models;
        if (proposalModels.selectedFilename) {
          const selectedModel = proposalModels.targets.find((candidate) => candidate.filename === proposalModels.selectedFilename);
          const selectedModelLabel = selectedModel?.label || proposalModels.selectedFilename;
          const iterate = document.createElement("button");
          iterate.type = "button";
          iterate.className = "btn accent btn-compact";
          iterate.dataset.promptDesignGenerate = "edit";
          iterate.textContent = `Edit selected: ${selectedModelLabel}`;
          iterate.title = `Edit ${selectedModelLabel} with the CAD harness`;
          iterate.addEventListener("click", () => buildWithHarness("edit", iterate));
          actions.appendChild(iterate);
        }
        row.appendChild(actions);
      }
      feed.appendChild(row);
    }
    const projectQueue = designQueueForProject(projectId);
    if (projectQueue.length) {
      const queue = document.createElement("section");
      queue.className = "prompt-design-queue";
      queue.dataset.promptDesignQueue = "1";
      const heading = document.createElement("strong");
      heading.textContent = `Design queue · ${projectQueue.length}`;
      queue.appendChild(heading);
      projectQueue.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = `prompt-design-queue-item is-${item.status}`;
        const copy = document.createElement("span");
        const state = item.status === "running" || item.status === "starting"
          ? "Running"
          : item.status === "failed" ? "Paused" : `Queued ${index + 1}`;
        copy.textContent = `${state} · ${item.error || item.packet.prompt.slice(0, 96)}`;
        row.appendChild(copy);
        const action = document.createElement("button");
        action.type = "button";
        action.className = "btn btn-compact";
        if (item.status === "failed") {
          action.textContent = "Retry";
          action.addEventListener("click", () => {
            item.status = "queued";
            item.error = "";
            startNextDesignGeneration(host);
            renderDesignChat(host);
          });
        } else if (item.status === "queued") {
          action.textContent = "Remove";
          action.addEventListener("click", () => {
            designChatGenerationQueue = designChatGenerationQueue.filter((candidate) => candidate.id !== item.id);
            renderDesignChat(host);
          });
        } else {
          action.textContent = "In progress";
          action.disabled = true;
        }
        row.appendChild(action);
        queue.appendChild(row);
      });
      feed.appendChild(queue);
    }
    if (designChatFailedGeneration?.projectId === projectId) {
      const failure = designChatFailedGeneration;
      const row = document.createElement("article");
      row.className = "prompt-design-message prompt-design-message--assistant prompt-design-message--generation-failed";
      row.dataset.promptDesignGenerationFailure = "1";
      const label = document.createElement("strong");
      label.className = "prompt-design-message-heading";
      const avatar = document.createElement("img");
      avatar.className = "prompt-design-message-avatar";
      avatar.src = RENDER3D_LOGO_URL;
      avatar.alt = "";
      const speaker = document.createElement("span");
      speaker.textContent = "Render Design Partner";
      label.append(avatar, speaker);
      const body = document.createElement("div");
      body.className = "prompt-design-message-body";
      const summary = document.createElement("p");
      summary.textContent = "CAD harness command failed.";
      const command = document.createElement("pre");
      const code = document.createElement("code");
      code.textContent = failure.error;
      command.appendChild(code);
      const attachedCount = (failure.packet.references?.length || 0) + (failure.packet.images?.length || 0);
      const retrySummary = document.createElement("p");
      retrySummary.textContent = `Retry will resend the saved prompt and ${attachedCount} attached file${attachedCount === 1 ? "" : "s"}.`;
      body.append(summary, command, retrySummary);
      const actions = document.createElement("div");
      actions.className = "prompt-design-message-actions";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn accent btn-compact";
      retry.dataset.promptDesignRetryGeneration = "1";
      retry.textContent = designChatGenerationPending ? "Retrying…" : "Retry generation";
      retry.disabled = designChatGenerationPending;
      retry.addEventListener("click", () => runDesignGeneration(host, failure.packet, retry));
      actions.appendChild(retry);
      row.append(label, body, actions);
      feed.appendChild(row);
    }
    feed.scrollTop = followLatest ? feed.scrollHeight : scrollTop;
    host.querySelectorAll("button[type=submit], [data-prompt-design-new]").forEach((button) => {
      button.disabled = designChatIsBusy();
    });
    const meta = host.querySelector("[data-prompt-design-meta]");
    if (meta) {
      const fields = renderAgentKeyFields();
      const context = promptDesignContext();
      const machine = activeMachineDesignContext(context.machine);
      const aiModel = fields.model || renderAgentModel || "Selected AI";
      const selected = context.models.targets.find((item) => item.filename === context.models.selectedFilename);
      meta.replaceChildren();
      const ai = document.createElement(typeof onOpenDesignAiPicker === "function" ? "button" : "span");
      ai.textContent = `AI model: ${aiModel}`;
      if (typeof onOpenDesignAiPicker === "function") {
        ai.type = "button";
        ai.className = "prompt-design-ai-picker";
        ai.setAttribute("aria-label", `Change AI model. Current model ${aiModel}`);
        ai.title = "Change the AI key, model, or reasoning effort";
        ai.addEventListener("click", (event) => {
          event.preventDefault?.();
          event.stopPropagation?.();
          onOpenDesignAiPicker(ai);
        });
      }
      const working = document.createElement("label");
      working.textContent = "Working model: ";
      if (context.models.targets.length > 1) {
        const select = document.createElement("select");
        select.dataset.promptDesignModel = "1";
        select.setAttribute("aria-label", "Working model");
        for (const item of context.models.targets) {
          const option = document.createElement("option");
          option.value = item.filename;
          option.textContent = item.label;
          option.title = item.subtitle || item.filename;
          option.selected = item.filename === context.models.selectedFilename;
          select.appendChild(option);
        }
        select.value = context.models.selectedFilename;
        select.addEventListener("change", () => {
          const next = select.value;
          if (!context.models.targets.some((item) => item.filename === next)) return;
          onSelectDesignModel?.(next);
          renderDesignChat(host);
        });
        working.appendChild(select);
      } else {
        working.appendChild(document.createTextNode(selected?.label || "No model selected"));
      }
      meta.append(ai, working);
      if (machine) {
        const machineLabel = document.createElement("span");
        machineLabel.textContent = `Machine: ${machine.name || machine.model || machine.kind}`;
        meta.appendChild(machineLabel);
      }
    }
    renderDesignChatContext(host);
  }

  async function loadDesignChat(host) {
    if (designChatIsBusy()) {
      renderDesignChat(host);
      return;
    }
    const epoch = ++designChatLoadEpoch;
    const projectId = String(getProjectId?.() || "");
    const storageKey = designChatStorageKey();
    const storedId = storedDesignChatThreadId();
    const isCurrentLoad = () => epoch === designChatLoadEpoch
      && projectId === String(getProjectId?.() || "")
      && storageKey === designChatStorageKey();
    if (!storedId) {
      designChatThread = null;
      designChatThreadProjectId = projectId;
      renderDesignChat(host);
      return;
    }
    try {
      const data = await api(`/api/render-agent/threads/${encodeURIComponent(storedId)}`);
      if (!isCurrentLoad()) return;
      designChatThread = data.thread || null;
      designChatThreadProjectId = projectId;
    } catch {
      if (!isCurrentLoad()) return;
      designChatThread = null;
      designChatThreadProjectId = projectId;
      try { localStorage.removeItem(storageKey); } catch { /* best effort */ }
    }
    renderDesignChat(host);
  }

  async function sendDesignChat(host, message = "") {
    const inputEl = host?.querySelector("[data-prompt-design-input]");
    const raw = String(message || inputEl?.value || "").trim();
    if (!raw || designChatIsBusy()) return;
    if (!currentUserId()) {
      onRequireLogin?.();
      return;
    }
    const projectId = String(getProjectId?.() || "");
    const context = promptDesignContext();
    const fields = renderAgentKeyFields();
    const outgoingAttachments = designChatAttachments;
    rememberDesignChatReferences(outgoingAttachments);
    designChatAttachments = [];
    const outgoing = { role: "user", content: raw, delivery: "pending", projectId };
    ++designChatLoadEpoch;
    designChatLocalMessages = designChatLocalMessages.filter((item) =>
      !(item.projectId === projectId && item.delivery === "failed" && item.content === raw));
    designChatLocalMessages.push(outgoing);
    designChatBusyProjectId = projectId;
    if (inputEl) inputEl.value = "";
    setDesignChatStatus(host, "Thinking through the design…");
    renderDesignChat(host, { scrollToLatest: true });
    try {
      let thread = designChatThreadProjectId === projectId ? designChatThread : null;
      if (!thread?.id) {
        const storedId = storedDesignChatThreadId();
        if (storedId) thread = { id: storedId, messages: [] };
      }
      if (!thread?.id) {
        const created = await api("/api/render-agent/threads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: `Design: ${getProjectName?.() || "CAD prompt"}`.slice(0, 80) }),
        });
        thread = created.thread;
        if (String(getProjectId?.() || "") === projectId) {
          designChatThread = thread;
          designChatThreadProjectId = projectId;
          try { localStorage.setItem(designChatStorageKey(), designChatThread.id); } catch { /* best effort */ }
          document.querySelector("[data-prompt-design-badge]")?.removeAttribute("hidden");
        }
      }
      const data = await api("/api/render-agent/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: designConversationMessage(raw, context),
          thread_id: thread.id,
          project_id: projectId || null,
          attachments: outgoingAttachments,
          speed: "fast",
          allow_guest_fallback: true,
          ...fields,
          model: fields.model || renderAgentModel,
        }),
      }, 240000);
      designChatLocalMessages = designChatLocalMessages.filter((item) => item !== outgoing);
      if (String(getProjectId?.() || "") === projectId) {
        designChatThread = data.thread || {
          ...thread,
          messages: [...(thread.messages || []), { role: "user", content: raw }, ...(data.message ? [data.message] : [])],
        };
        designChatThreadProjectId = projectId;
        setDesignChatStatus(host, extractRenderPrompt(data.message?.content)
          ? "Draft ready. Use it when the design looks right."
          : "Reply with the missing detail, or keep exploring the design.");
      }
      return { ok: true };
    } catch (error) {
      outgoing.delivery = "failed";
      if (String(getProjectId?.() || "") === projectId) {
        if (inputEl && !inputEl.value.trim()) inputEl.value = raw;
        setDesignChatStatus(host, error?.message || "Could not continue the design conversation.", true);
      }
      return { ok: false, error: error?.message || "Could not continue the design conversation." };
    } finally {
      if (designChatBusyProjectId === projectId) designChatBusyProjectId = "";
      if (String(getProjectId?.() || "") === projectId) {
        renderDesignChat(host);
        inputEl?.focus?.();
      }
    }
  }

  async function appendHeyAiSummary(handoff = {}) {
    const sessionId = String(handoff.sessionId || "");
    if (sessionId && designChatVoiceSessions.has(sessionId)) return { ok: true, duplicate: true };
    const host = document.querySelector("[data-prompt-design-chat]");
    if (sessionId) designChatVoiceSessions.add(sessionId);
    try {
      const result = await sendDesignChat(host, heyAiDesignChatSummary(handoff));
      if (result?.ok === false) throw new Error(result.error);
      return result || { ok: true };
    } catch (error) {
      if (sessionId) designChatVoiceSessions.delete(sessionId);
      return { ok: false, error: error?.message || "Could not save the Hey AI summary." };
    }
  }

  function mountPromptDesignChat() {
    const compose = document.getElementById("prompt-pane-compose");
    const prompt = document.getElementById("prompt-input");
    const heading = compose?.querySelector(".prompt-compose-head");
    if (!compose || !prompt || !heading || document.querySelector("[data-prompt-design-chat]")) return;
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "prompt-design-badge";
    badge.dataset.promptDesignBadge = "1";
    badge.innerHTML = '<span aria-hidden="true"></span>Design chat active';
    badge.title = "Open Design Chat";
    const host = document.createElement("section");
    host.className = "prompt-design-chat hidden";
    host.dataset.promptDesignChat = "1";
    host.innerHTML = `
      <header class="prompt-design-header">
        <div><strong>Design conversation</strong><small data-prompt-design-meta></small></div>
        <div class="prompt-design-header-actions">
          <button type="button" class="btn secondary btn-compact" data-prompt-design-new title="Start a new design conversation">New</button>
          <button type="button" class="btn secondary btn-compact" data-prompt-design-popout aria-pressed="false" title="Open a resizable chat">Pop out</button>
          <button type="button" class="btn secondary btn-compact" data-prompt-design-close aria-label="Close design chat">×</button>
        </div>
      </header>
      <div class="prompt-design-feed" data-prompt-design-feed role="log" aria-label="Design conversation messages" aria-live="polite"></div>
      <div class="prompt-design-context" data-prompt-design-context aria-label="Design chat references"></div>
      <form class="prompt-design-form">
        <div class="prompt-design-input-tools">
          <label class="btn secondary btn-compact prompt-design-upload">Upload refs<input type="file" data-prompt-design-upload multiple accept="image/png,image/jpeg,image/webp,image/heic,image/heif,.heic,.heif,.txt,.md,.csv,.json,.svg,.dxf,.step,.stp,.pdf" hidden></label>
          <button type="button" class="prompt-voice-order prompt-design-hey-ai" data-voice-order="1" data-voice-idle-label="Hey AI" aria-label="Start Hey AI with this design conversation" aria-pressed="false" title="Continue this design conversation with Hey AI">
            <span class="prompt-voice-order-orb" aria-hidden="true"></span>
            <span class="prompt-voice-order-label">Hey AI</span>
          </button>
        </div>
        <textarea rows="3" data-prompt-design-input placeholder="Talk through the shape, dimensions, fit, motion, or what should change…"></textarea>
        <button type="submit" class="btn accent">Send</button>
      </form>
      <p class="prompt-design-status" data-prompt-design-status></p>`;
    heading.append(badge);
    document.body.appendChild(host);
    const syncDesignChatBadge = () => {
      const active = Boolean(activeDesignChatThreadId() || storedDesignChatThreadId());
      badge.innerHTML = active
        ? '<span aria-hidden="true"></span>Design chat active'
        : "Design chat";
      badge.setAttribute("aria-expanded", String(!host.classList.contains("hidden")));
    };
    const open = async () => {
      host.classList.remove("hidden");
      badge.setAttribute("aria-expanded", "true");
      await loadDesignChat(host);
      syncDesignChatBadge();
      host.querySelector("[data-prompt-design-input]")?.focus();
    };
    const closeChat = () => {
      closeDesignChatForProjectChange({ host, badge });
      syncDesignChatBadge();
    };
    badge.addEventListener("click", () => host.classList.contains("hidden") ? void open() : closeChat());
    host.querySelector("[data-prompt-design-close]")?.addEventListener("click", closeChat);
    window.addEventListener("render3d:generation-settled", (event) => {
      settleDesignGeneration(host, event?.detail || {});
    });
    host.querySelector("[data-prompt-design-popout]")?.addEventListener("click", (event) => {
      const popped = host.classList.toggle("prompt-design-chat--popout");
      event.currentTarget.setAttribute("aria-pressed", popped ? "true" : "false");
      event.currentTarget.textContent = popped ? "Dock" : "Pop out";
    });
    host.querySelector("[data-prompt-design-new]")?.addEventListener("click", () => {
      if (designChatIsBusy()) return;
      ++designChatLoadEpoch;
      designChatLocalMessages = designChatLocalMessages.filter((item) => item.projectId !== String(getProjectId?.() || ""));
      designChatThread = null;
      designChatThreadProjectId = String(getProjectId?.() || "");
      designChatAttachments = [];
      designChatReferenceAttachments = [];
      try { localStorage.removeItem(designChatStorageKey()); } catch { /* best effort */ }
      syncDesignChatBadge();
      renderDesignChat(host);
      setDesignChatStatus(host, "New conversation started. The current prompt and selection remain available as context.");
    });
    host.querySelector("form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      void sendDesignChat(host);
    });
    host.querySelector("[data-prompt-design-upload]")?.addEventListener("change", (event) => {
      void addDesignChatFiles(host, event.target.files).finally(() => { event.target.value = ""; });
    });
    host.querySelector("form")?.addEventListener("dragover", (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; });
    host.querySelector("form")?.addEventListener("drop", (event) => {
      event.preventDefault();
      void addDesignChatFiles(host, event.dataTransfer?.files);
    });
    host.querySelector("[data-prompt-design-input]")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      void sendDesignChat(host);
    });
    document.getElementById("btn-prompt")?.addEventListener("click", (event) => {
      const initialPrompt = String(prompt.value || "").trim();
      const threadId = activeDesignChatThreadId() || storedDesignChatThreadId();
      const chatOpen = !host.classList.contains("hidden");
      if (!shouldStartDesignChatOnFirstSubmit({ prompt: initialPrompt, threadId, chatOpen })) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      void (async () => {
        await open();
        const chatInput = host.querySelector("[data-prompt-design-input]");
        if (chatInput) chatInput.value = initialPrompt;
        setDesignChatStatus(host, "Starting a design conversation before generation…");
        await sendDesignChat(host);
        syncDesignChatBadge();
      })();
    }, true);
    renderDesignChat(host);
    syncDesignChatBadge();
    window.addEventListener("render3d:prompt-references-changed", () => {
      if (!host.classList.contains("hidden")) renderDesignChatContext(host);
    });
    window.addEventListener("render3d:active-model-changed", () => {
      if (!host.classList.contains("hidden")) renderDesignChat(host);
    });
    window.addEventListener("render3d:prompt-ai-selection-changed", () => {
      if (!host.classList.contains("hidden")) renderDesignChat(host);
    });
    window.addEventListener("render3d:project-changed", () => {
      ++designChatLoadEpoch;
      designChatThread = null;
      designChatThreadProjectId = String(getProjectId?.() || "");
      designChatAttachments = [];
      designChatReferenceAttachments = [];
      closeDesignChatForProjectChange({ host, badge });
      syncDesignChatBadge();
      renderDesignChat(host);
    });
  }

  mountPromptDesignChat();

  function renderAgentSource() {
    ensureAgentControls();
    if (!agentSourceRow) return;
    const fields = renderAgentKeyFields();
    const options = RENDER_AGENT_MODEL_CHOICES.map((row) => (
      `<option value="${esc(row.value)}"${row.value === renderAgentModel ? " selected" : ""}>${esc(row.label)}</option>`
    )).join("");
    agentSourceRow.innerHTML = `
      <span class="render-agent-source-label">Model</span>
      <select class="render-agent-source-select" id="render-agent-model" aria-label="Render Agent model">${options}</select>
      <span class="render-agent-source-hint">${esc(renderAgentBillingHint(fields))}</span>
    `;
    agentSourceRow.querySelector("#render-agent-model")?.addEventListener("change", (event) => {
      const next = String(event.target.value || "").trim();
      if (!RENDER_AGENT_MODEL_CHOICES.some((row) => row.value === next)) return;
      renderAgentModel = next;
      try { localStorage.setItem(RENDER_AGENT_MODEL_KEY, next); } catch { /* ignore */ }
    });
  }

  function candidateLabel(member = {}) {
    return member.display_name || member.email || member.id || "Teammate";
  }

  function candidateSubtitle(member = {}) {
    const team = member.team_name || "workspace";
    return member.source === "current_workspace" ? `Current workspace · ${team}` : `Other shared workspace · ${team}`;
  }

  function renderInviteOptions() {
    ensureAgentControls();
    if (!invitePicker || !inviteSelect) return;
    const existing = new Set((activeThread?.members || []).map((member) => member.id));
    const candidates = teamMembers.filter((member) => member.id && member.id !== currentUserId() && !existing.has(member.id));
    const selected = candidates.find((member) => member.id === selectedInviteUserId);
    if (selectedInviteUserId && !selected) selectedInviteUserId = "";
    const query = inviteQuery.trim().toLowerCase();
    const filtered = query
      ? candidates.filter((member) => `${candidateLabel(member)} ${member.email || ""} ${member.team_name || ""}`.toLowerCase().includes(query))
      : candidates;
    inviteSelect.value = selectedInviteUserId;
    const canInvite = !!activeThread?.id && candidates.length > 0;
    if (inviteBtn) inviteBtn.disabled = !canInvite || !selectedInviteUserId;
    invitePicker.innerHTML = `
      <button type="button" class="render-agent-invite-trigger" aria-expanded="${inviteOpen ? "true" : "false"}">
        <span>${selected ? esc(candidateLabel(selected)) : "Invite teammate or agent..."}</span>
        <small>${selected ? esc(candidateSubtitle(selected)) : `${candidates.length} people · ${AT_ROSTER.length} agents`}</small>
      </button>
      <div class="render-agent-invite-popover${inviteOpen ? "" : " hidden"}">
        <input type="search" class="render-agent-invite-search" placeholder="Search teammates..." value="${esc(inviteQuery)}" />
        <div class="render-agent-invite-list">
          ${filtered.length ? filtered.map((member) => `
            <button type="button" class="render-agent-invite-option${member.id === selectedInviteUserId ? " active" : ""}" data-user-id="${esc(member.id)}">
              ${avatarHtml(member, "render-agent-invite-avatar")}
              <span>
                <strong>${esc(candidateLabel(member))}</strong>
                <small>${esc(candidateSubtitle(member))}</small>
              </span>
            </button>
          `).join("") : `<p class="muted small">No inviteable people found.</p>`}
          <p class="muted small" style="margin:8px 0 4px">Agents in this thread</p>
          ${AT_ROSTER.map((row) => `
            <button type="button" class="render-agent-invite-option" data-agent-handle="${esc(row.handle)}">
              <span><strong>@${esc(row.handle)}</strong><small>${esc(row.label)}</small></span>
            </button>
          `).join("")}
        </div>
      </div>
    `;
    invitePicker.querySelector(".render-agent-invite-trigger")?.addEventListener("click", () => {
      inviteOpen = !inviteOpen;
      renderInviteOptions();
      if (inviteOpen) invitePicker.querySelector(".render-agent-invite-search")?.focus();
    });
    invitePicker.querySelector(".render-agent-invite-search")?.addEventListener("input", (event) => {
      inviteQuery = event.target.value || "";
      renderInviteOptions();
    });
    invitePicker.querySelectorAll("[data-user-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedInviteUserId = btn.dataset.userId || "";
        inviteOpen = false;
        renderInviteOptions();
      });
    });
    invitePicker.querySelectorAll("[data-agent-handle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const handle = btn.dataset.agentHandle || "";
        if (input && handle) {
          input.value = `${input.value ? `${input.value.replace(/\s+$/, "")} ` : ""}@${handle} `;
          input.focus();
        }
        inviteOpen = false;
        renderInviteOptions();
        setStatus(`@${handle} will be in this question.`);
      });
    });
  }

  bumpTipOnRefresh();

  function renderAgentTipCard({ compact = false } = {}) {
    const tip = getCurrentTip();
    if (!tip) return "";
    return `
      <div class="render-agent-tip${compact ? " render-agent-tip--compact" : ""}">
        <div class="render-agent-tip-head">
          <span class="render-agent-tip-badge ${tipTopicClass(tip.topic)}">${esc(tip.topic)}</span>
          <span class="render-agent-tip-label">Tip to get started</span>
        </div>
        <strong class="render-agent-tip-title">${esc(tip.title)}</strong>
        <p class="render-agent-tip-body">${esc(tip.body)}</p>
        <div class="render-agent-tip-actions">
          <button type="button" class="btn secondary btn-compact render-agent-tip-try" data-tip-starter="${esc(tip.starter)}">
            Ask this
          </button>
          <a class="btn secondary btn-compact" href="/getting-started.html">Getting Started docs</a>
        </div>
      </div>
    `;
  }

  function bindTipActions(root) {
    root?.querySelectorAll("[data-tip-starter]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        event.preventDefault();
        const starter = btn.getAttribute("data-tip-starter") || "";
        if (!starter) return;
        void openWithQuestion(starter, { autoSend: true });
      });
    });
    root?.querySelectorAll("[data-show-me]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-show-me") || "";
        const onDocs = panel.classList.contains("render-agent-panel--docs");
        startShowMe(id, { onDocsPage: onDocs });
      });
    });
  }

  let pendingAnnounceText = "";

  function consumePendingAnnounce() {
    const text = pendingAnnounceText;
    if (!text || !activeThread) return;
    const msgs = activeThread.messages || [];
    if (msgs.some((m) => m.role === "assistant" && String(m.content || "").trim() === text)) {
      pendingAnnounceText = "";
      return;
    }
    activeThread.messages = [
      ...msgs,
      {
        role: "assistant",
        content: text,
        created_at: new Date().toISOString(),
        sender: { id: "render-agent", display_name: "Render Agent" },
      },
    ];
  }

  function renderMessages() {
    consumePendingAnnounce();
    const messages = activeThread?.messages || [];
    if (!messages.length) {
      messagesEl.innerHTML = `
        <div class="render-agent-empty">
          <strong>Ask me anything about Render Studio.</strong>
          <p class="muted small">I can help with this project's CAD and Studio tools — not passwords, keys, or other accounts.</p>
          ${renderAgentTipCard()}
        </div>
      `;
      bindTipActions(messagesEl);
      return;
    }
    const tipHtml = renderAgentTipCard({ compact: true });
    messagesEl.innerHTML = `
      ${tipHtml}
      ${messages
      .map((msg, index) => {
        const fallbackSender = msg.role === "user" ? getCurrentUser?.() : { display_name: "Render Agent" };
        const sender = msg.sender || fallbackSender || {};
        const name = sender.display_name || (msg.role === "user" ? "You" : "Render Agent");
        const avatar = msg.role === "user" ? avatarHtml(sender) : agentLogoHtml();
        const prevUser = [...messages.slice(0, index)].reverse().find((m) => m.role === "user");
        const mediaHtml = renderMessageMedia(msg, prevUser?.content || "");
        return `
        <article class="render-agent-message render-agent-message--${esc(msg.role || "assistant")}">
          <header class="render-agent-message-head">
            ${avatar}
            <div>
              <strong>${esc(msg.role === "user" && sender.id === currentUserId() ? "You" : name)}</strong>
              <small>${esc(msg.created_at ? new Date(msg.created_at).toLocaleString([], { hour: "2-digit", minute: "2-digit" }) : "")}</small>
            </div>
          </header>
          ${mediaHtml}
          <div class="render-agent-message-content">${renderMessageText(msg.role === "assistant" ? redactSecretShaped(msg.content || "") : (msg.content || ""))}</div>
          ${msg.role === "assistant" && (msg.debug_improve || /Update this to your settings/i.test(msg.content || ""))
            ? `<button type="button" class="btn accent btn-compact render-agent-apply-settings" data-apply-settings="${index}">Update this to your settings</button>`
            : ""}
          ${msg.role === "assistant" && msg.offer_feature_request && isAdminUser(getCurrentUser?.())
            ? featureRequestCardHtml(msg, index)
            : ""}
        </article>
      `;
      })
      .join("")}
    `;
    bindTipActions(messagesEl);
    messagesEl.querySelectorAll(".render-agent-media img").forEach((img) => {
      img.addEventListener("error", () => img.closest(".render-agent-media")?.remove());
    });
    bindFeatureRequestCards(messagesEl);
    messagesEl.querySelectorAll("[data-apply-settings]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = Number(btn.getAttribute("data-apply-settings"));
        const msg = (activeThread?.messages || [])[idx];
        const prompt = lastQuotedPrompt(msg?.content || "");
        if (!prompt) {
          setStatus("No quoted prompt example to apply.", true);
          return;
        }
        try {
          if (typeof onApplyContextSettings === "function") {
            await onApplyContextSettings(prompt);
          }
          setStatus("Saved as a Context Lab custom Improve overlay.");
        } catch (err) {
          setStatus(err.message || "Could not update settings.", true);
        }
      });
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function featureRequestCardHtml(msg, index) {
    const query = msg.setting_query || pendingMissingSetting || "";
    if (msg.feature_request_done) {
      const url = msg.feature_request_url;
      return `<div class="render-agent-feature-request"><p>Feature request filed${url ? ` — <a href="${esc(url)}" target="_blank" rel="noopener">GitHub issue</a>` : ""}.</p></div>`;
    }
    return `
      <form class="render-agent-feature-request" data-feature-request="${index}">
        <p>This setting is not in Studio. Request it from the developers? That opens a GitHub issue labeled <code>feature-request</code> and emails sam@render3d.app.</p>
        <input name="title" maxlength="160" value="${esc(query ? `Setting: ${query}` : "Feature request")}" placeholder="Title" />
        <textarea name="body" rows="3" maxlength="4000" placeholder="What should the setting do?"></textarea>
        <input type="file" name="files" accept="image/*,.txt,.pdf" multiple />
        <div class="render-agent-feature-request-actions">
          <button type="submit" class="btn accent btn-compact">Request this feature</button>
        </div>
        <p class="render-agent-feature-status muted small"></p>
      </form>`;
  }

  function bindFeatureRequestCards(rootEl) {
    rootEl.querySelectorAll("[data-feature-request]").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const idx = Number(form.getAttribute("data-feature-request"));
        void submitFeatureRequest(form, idx);
      });
    });
  }

  async function submitFeatureRequest(form, index) {
    if (!isAdminUser(getCurrentUser?.())) {
      setStatus("Feature requests are admin-only.", true);
      return;
    }
    const status = form.querySelector(".render-agent-feature-status");
    const title = form.querySelector("[name=title]")?.value?.trim() || "Feature request";
    const body = form.querySelector("[name=body]")?.value?.trim() || "";
    const msg = (activeThread?.messages || [])[index] || {};
    const payload = new FormData();
    payload.set("title", title);
    payload.set("body", body);
    payload.set("setting_query", msg.setting_query || pendingMissingSetting || title);
    const files = form.querySelector("[name=files]")?.files || [];
    [...files].slice(0, 6).forEach((file) => payload.append("files", file));
    if (status) status.textContent = "Sending…";
    try {
      const data = await api("/api/admin/feature-requests", { method: "POST", body: payload });
      if (activeThread?.messages?.[index]) {
        activeThread.messages[index].feature_request_done = true;
        activeThread.messages[index].feature_request_url = data.github?.html_url || "";
      }
      renderMessages();
      setStatus(data.detail || "Feature request sent.");
    } catch (err) {
      if (status) status.textContent = err.message || "Could not send.";
      setStatus(err.message || "Could not send feature request.", true);
    }
  }

  function renderMessageMedia(msg, previousUserText = "") {
    let media = Array.isArray(msg?.media) ? [...msg.media] : [];
    const guides = Array.isArray(msg?.guides) ? msg.guides : [];
    if (!media.length && msg?.role === "assistant" && previousUserText) {
      media = matchGettingStartedGuides(previousUserText, { limit: 2 })
        .map(guideMediaPayload)
        .filter(Boolean)
        .filter((item) => item?.url);
    }
    if (media.length) {
      // Bigger PowerPoint-style window when GIF instructions render.
      enterPresentationDeck();
    }
    if (!media.length) return "";
    return `
      <div class="render-agent-media-list">
        ${media.map((item, idx) => {
          const guideId = item.id || guides[idx]?.id || guides[0]?.id || "";
          return `
          <figure class="render-agent-media render-agent-media--deck">
            <img src="${esc(item.url)}" alt="${esc(item.title || "Demo")}" loading="lazy" />
            <figcaption>
              <strong>${esc(item.title || "Getting Started demo")}</strong>
              ${item.summary ? `<span>${esc(item.summary)}</span>` : ""}
              <div class="render-agent-media-actions">
                ${guideId ? `<button type="button" class="btn accent btn-compact" data-show-me="${esc(guideId)}">Show me</button>` : ""}
                <a class="btn secondary btn-compact" href="/getting-started.html${guideId ? `#${esc(guideId)}` : ""}">Docs</a>
              </div>
            </figcaption>
          </figure>
        `;
        }).join("")}
      </div>
    `;
  }

  function renderAttachments() {
    if (!attachmentsEl) return;
    attachmentsEl.innerHTML = attachments
      .map((item) => `
        <button type="button" class="render-agent-attachment" data-id="${esc(item.id)}" title="Remove ${esc(item.name)}">
          <span>${esc(item.name)}</span>
          <small>${esc(item.media_type || "file")}</small>
        </button>
      `)
      .join("");
    attachmentsEl.querySelectorAll(".render-agent-attachment").forEach((el) => {
      el.addEventListener("click", () => {
        attachments = attachments.filter((item) => item.id !== el.dataset.id);
        renderAttachments();
      });
    });
  }

  let renderAgentThreadsAbort = null; // leakfix67
  function beginRenderAgentThreadsFetch() {
    if (renderAgentThreadsAbort) {
      try { renderAgentThreadsAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    renderAgentThreadsAbort = ctl;
    return ctl;
  }

  async function refreshThreads() {
    const ctl = beginRenderAgentThreadsFetch();
    try {
      const data = await api("/api/render-agent/threads", { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      threads = data.threads || [];
      if (!threads.length) {
        const created = await api("/api/render-agent/threads", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Getting started" }),
        });
        activeThread = created.thread;
        threads = [{ id: activeThread.id, title: activeThread.title, message_count: 0 }];
      } else {
        await loadThread(selectedThreadRefreshId(threads, activeThread?.id), { skipSelectRender: true });
      }
      renderThreadMenu();
      renderMessages();
      renderMembers();
      renderInviteOptions();
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
      setStatus(err.message || "Could not load Render Agent threads.", true);
    } finally {
      if (renderAgentThreadsAbort === ctl) renderAgentThreadsAbort = null;
    }
  }

  async function loadThread(threadId, { skipSelectRender = false } = {}) {
    if (!threadId) return;
    const data = await api(`/api/render-agent/threads/${encodeURIComponent(threadId)}`);
    activeThread = data.thread;
    if (!skipSelectRender) renderThreadMenu();
    renderMessages();
    renderMembers();
    renderInviteOptions();
  }

  function closeThreadMenu() {
    threadPopover?.classList.add("hidden");
    threadMenuBtn?.setAttribute("aria-expanded", "false");
  }

  async function createThread() {
    bumpTipForNewThread();
    closeThreadMenu();
    const data = await api("/api/render-agent/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "New question" }),
    });
    activeThread = data.thread;
    threads = [{ id: activeThread.id, title: activeThread.title, message_count: 0 }, ...threads];
    renderThreadMenu();
    renderMessages();
    renderMembers();
    renderInviteOptions();
    setTimeout(() => input?.focus(), 40);
  }

  async function moveThreadToFolder(threadId, folder) {
    if (!threadId) return;
    try {
      const data = await api(`/api/render-agent/threads/${encodeURIComponent(threadId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder }),
      });
      const updated = data.thread || {};
      threads = threads.map((thread) => thread.id === threadId ? { ...thread, folder: updated.folder || "" } : thread);
      if (activeThread?.id === threadId) activeThread = { ...activeThread, folder: updated.folder || "" };
      renderThreadMenu();
      setStatus(folder ? `Moved thread to ${folder}.` : "Moved thread to Unfiled.");
    } catch (err) {
      setStatus(err.message || "Could not move thread.", true);
    }
  }

  let renderAgentMembersAbort = null; // leakfix69
  function beginRenderAgentMembersFetch() {
    if (renderAgentMembersAbort) {
      try { renderAgentMembersAbort.abort(); } catch (_) { /* ignore */ }
    }
    const ctl = new AbortController();
    renderAgentMembersAbort = ctl;
    return ctl;
  }

  async function refreshTeamMembers() {
    const teamId = getSelectedWorkspaceId?.() || getTeams?.()?.[0]?.id || "";
    const ctl = beginRenderAgentMembersFetch();
    try {
      const path = teamId
        ? `/api/render-agent/invite-candidates?team_id=${encodeURIComponent(teamId)}`
        : "/api/render-agent/invite-candidates";
      const data = await api(path, { signal: ctl.signal });
      if (ctl.signal.aborted) return;
      teamMembers = data.candidates || data.members || [];
    } catch (err) {
      if (ctl.signal.aborted || err?.name === "AbortError") return;
      teamMembers = [];
    } finally {
      if (renderAgentMembersAbort === ctl) renderAgentMembersAbort = null;
    }
    renderInviteOptions();
  }

  async function inviteSelectedMember() {
    const userId = selectedInviteUserId || inviteSelect?.value;
    if (!userId || !activeThread?.id) return;
    const candidate = teamMembers.find((member) => member.id === userId);
    const teamId = candidate?.team_id || getSelectedWorkspaceId?.() || getTeams?.()?.[0]?.id || null;
    try {
      const data = await api(`/api/render-agent/threads/${encodeURIComponent(activeThread.id)}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, team_id: teamId }),
      });
      activeThread = data.thread;
      selectedInviteUserId = "";
      inviteQuery = "";
      await refreshThreads();
      setStatus("Teammate added to this thread.");
    } catch (err) {
      setStatus(err.message || "Could not invite teammate.", true);
    }
  }

  async function addFiles(files) {
    setStatus("");
    for (const file of [...files]) {
      if (attachments.length >= 6) break;
      const isVideo = (file.type || "").startsWith("video/") || /\.(webm|mp4|mov|m4v)$/i.test(file.name || "");
      const maxBytes = isVideo ? 40 * 1024 * 1024 : 8 * 1024 * 1024;
      if (file.size > maxBytes) {
        setStatus(`${file.name} is too large. Use files under ${isVideo ? "40" : "8"} MB.`, true);
        continue;
      }
      const base = {
        id: `att-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: file.name || "upload",
        media_type: file.type || "application/octet-stream",
      };
      try {
        if (isImage(file)) {
          attachments.push({ ...base, data_url: await fileToDataUrl(file) });
        } else if (isVideo) {
          attachments.push({ ...base });
        } else if (isTextLike(file)) {
          attachments.push({ ...base, text: (await fileToText(file)).slice(0, 20000) });
        } else {
          attachments.push({ ...base });
        }
      } catch (err) {
        setStatus(err.message || `Could not read ${file.name}.`, true);
      }
    }
    renderAttachments();
  }

  async function sendMessage() {
    const typedMessage = input?.value.trim() || "";
    const message = messageWithPendingContext(typedMessage);
    if (!message || busy) return;
    if (!debugImproveSession && !pendingMissingSetting && !attachments.length && isMarketplaceSearchQuestion(message)) {
      input.value = "";
      pendingQuestionContext = "";
      openMarketplaceDiscovery({ query: message, api });
      return;
    }
    if (!currentUserId()) {
      onRequireLogin?.();
      return;
    }
    try {
      if (typeof onRoboticsPrompt === "function") {
        const handled = await onRoboticsPrompt(message);
        if (handled?.handled) {
          input.value = "";
          setStatus(handled.ok === false ? (handled.error || "Robotics action failed.") : (handled.message || "Robotics Home handled the request."), handled.ok === false);
          return;
        }
      }
    } catch (error) {
      setStatus(error?.message || "Robotics action failed.", true);
      return;
    }
    // When Video Studio is open, apply edit commands locally (fade/music/assemble…).
    try {
      if (typeof onVideoEditPrompt === "function") {
        const lower = message.toLowerCase();
        const looksLikeVideoEdit = /\b(fade|music|crossfade|assemble|trim|split|vignette|slow[\s-]?mo|title|cinematic|mute|soundtrack|bgm|timeline|transition)\b/.test(lower);
        if (looksLikeVideoEdit) {
          const handled = await onVideoEditPrompt(message);
          if (handled?.ok) {
            input.value = "";
            setStatus(handled.message || "Applied in Video Studio.");
            return;
          }
        }
      }
    } catch (_) {
      /* fall through to normal agent */
    }
    busy = true;
    input.value = "";
    pendingQuestionContext = "";
    setStatus("Render Agent is thinking...");
    const optimistic = {
      ...(activeThread || { messages: [] }),
      messages: [...(activeThread?.messages || []), {
        role: "user",
        content: message,
        sender: getCurrentUser?.(),
        created_at: new Date().toISOString(),
      }],
    };
    activeThread = optimistic;
    renderMessages();
    try {
      const data = await api("/api/render-agent/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          thread_id: activeThread?.id || null,
          project_id: getProjectId?.() || null,
          attachments,
          selected_file: getSelectedFile?.() || null,
          debug_improve: debugImproveSession,
          debug_selection: debugImproveSession ? pendingDebugSelection : null,
          missing_setting_query: pendingMissingSetting || undefined,
          ...renderAgentKeyFields(),
          model: renderAgentModel,
        }),
      }, 240000);
      activeThread = data.thread;
      // Preserve media/guides if the API returned them on the latest assistant message
      if (data.message?.media?.length && activeThread?.messages?.length) {
        const last = activeThread.messages[activeThread.messages.length - 1];
        if (last?.role === "assistant" && !last.media?.length) {
          last.media = data.message.media;
          last.guides = data.message.guides || [];
        }
      }
      if (activeThread?.messages?.length && (data.offer_feature_request || data.message?.offer_feature_request)) {
        const last = activeThread.messages[activeThread.messages.length - 1];
        if (last?.role === "assistant") {
          last.offer_feature_request = true;
          last.setting_query = data.setting_query || data.message?.setting_query || pendingMissingSetting;
        }
      }
      pendingMissingSetting = "";
      attachments = [];
      renderAttachments();
      renderMessages();
      await refreshThreads();
      setStatus("");
    } catch (err) {
      setStatus(err.message || "Render Agent failed.", true);
      renderMessages();
    } finally {
      busy = false;
    }
  }

  function projectOptionsHtml(selectedId = getProjectId?.() || "") {
    const projects = [...(getProjects?.() || [])].filter((project) => project?.id);
    return projects.length
      ? projects.map((project) => `
        <option value="${esc(project.id)}"${String(project.id) === String(selectedId || "") ? " selected" : ""}>${esc(project.name || project.id)}</option>
      `).join("")
      : `<option value="">No projects yet</option>`;
  }

  function objectOptionsHtml(selectedName = getSelectedFile?.() || "") {
    const choices = [...(getObjectChoices?.() || [])].filter((item) => item?.id || item?.filename);
    return [
      `<option value="">No specific object / whole project</option>`,
      ...choices.map((item) => {
        const value = item.id || item.filename;
        const label = item.label || item.filename || value;
        const sub = item.kind ? ` (${item.kind})` : "";
        return `<option value="${esc(value)}"${String(value) === String(selectedName || "") ? " selected" : ""}>${esc(label + sub)}</option>`;
      }),
    ].join("");
  }

  function removeDoItWizard() {
    doItWizard?.remove();
    doItWizard = null;
  }

  function showDoItWizard() {
    if (!currentUserId()) {
      onRequireLogin?.();
      return;
    }
    open();
    removeDoItWizard();
    const currentProjectId = getProjectId?.() || "";
    const currentProjectName = getProjectName?.() || currentProjectId;
    doItWizard = document.createElement("div");
    doItWizard.className = "render-agent-doit-modal";
    doItWizard.setAttribute("role", "dialog");
    doItWizard.setAttribute("aria-modal", "true");
    doItWizard.setAttribute("aria-labelledby", "render-agent-doit-title");
    doItWizard.innerHTML = `
      <div class="render-agent-doit-backdrop" data-doit-close></div>
      <form class="render-agent-doit-card">
        <header>
          <p class="render-agent-doit-eyebrow">Guided automation</p>
          <h2 id="render-agent-doit-title">Do it for me</h2>
          <p>Describe the result you want. Render Agent will step through the setup with sticky notes, then hand the task to AI.</p>
        </header>
        <label class="render-agent-doit-field">
          <span>What do you want to do?</span>
          <textarea id="render-agent-doit-task" rows="4" required placeholder="Example: make the selected bracket stronger, add rounded corners, and keep the mounting holes aligned."></textarea>
        </label>
        <fieldset class="render-agent-doit-fieldset">
          <legend>Project</legend>
          <label class="render-agent-doit-radio">
            <input type="radio" name="render-agent-doit-project-mode" value="current" ${currentProjectId ? "checked" : "disabled"} />
            <span><strong>Use current project</strong><small>${currentProjectId ? esc(currentProjectName || currentProjectId) : "No project is open"}</small></span>
          </label>
          <label class="render-agent-doit-radio">
            <input type="radio" name="render-agent-doit-project-mode" value="existing" ${currentProjectId ? "" : "checked"} />
            <span><strong>Select project</strong><select id="render-agent-doit-project">${projectOptionsHtml(currentProjectId)}</select></span>
          </label>
          <label class="render-agent-doit-radio">
            <input type="radio" name="render-agent-doit-project-mode" value="new" />
            <span><strong>Create new project</strong><small>Render Agent will create and open a clean project first.</small></span>
          </label>
        </fieldset>
        <label class="render-agent-doit-field">
          <span>Object to edit, if applicable</span>
          <select id="render-agent-doit-object">${objectOptionsHtml()}</select>
          <small>Leave this as whole project when the task is not object-specific.</small>
        </label>
        <p class="render-agent-doit-status muted small" id="render-agent-doit-status"></p>
        <footer>
          <button type="button" class="btn secondary" data-doit-close>Cancel</button>
          <button type="submit" class="btn accent">Start guided steps</button>
        </footer>
      </form>
    `;
    document.body.appendChild(doItWizard);
    const task = doItWizard.querySelector("#render-agent-doit-task");
    const status = doItWizard.querySelector("#render-agent-doit-status");
    doItWizard.querySelectorAll("[data-doit-close]").forEach((el) => el.addEventListener("click", removeDoItWizard));
    doItWizard.addEventListener("change", (event) => {
      const mode = doItWizard.querySelector("input[name='render-agent-doit-project-mode']:checked")?.value || "current";
      doItWizard.querySelector("#render-agent-doit-project")?.toggleAttribute("disabled", mode !== "existing");
    });
    doItWizard.querySelector("form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const desired = task?.value?.trim() || "";
      if (!desired) {
        if (status) status.textContent = "Describe what you want Render Agent to do.";
        return;
      }
      const mode = doItWizard.querySelector("input[name='render-agent-doit-project-mode']:checked")?.value || "current";
      const selectedProjectId = mode === "existing"
        ? doItWizard.querySelector("#render-agent-doit-project")?.value || ""
        : currentProjectId;
      if (mode !== "new" && !selectedProjectId) {
        if (status) status.textContent = "Select a project or choose Create new project.";
        return;
      }
      const objectId = doItWizard.querySelector("#render-agent-doit-object")?.value || "";
      removeDoItWizard();
      void runDoItForMe({ desired, mode, projectId: selectedProjectId, objectId });
    });
    task?.focus();
  }

  function removeDoItNote() {
    doItNote?.remove();
    doItNote = null;
    document.querySelectorAll(".render-agent-doit-target").forEach((el) => el.classList.remove("render-agent-doit-target"));
  }

  function waitForDoItContinue(step) {
    removeDoItNote();
    const target = step.selector ? document.querySelector(step.selector) : null;
    target?.classList?.add("render-agent-doit-target");
    doItNote = document.createElement("div");
    doItNote.className = "render-agent-doit-note";
    doItNote.innerHTML = `
      <strong>${esc(step.title || "Render Agent")}</strong>
      <p>${esc(step.body || "")}</p>
      <button type="button" class="btn accent btn-compact">Continue</button>
    `;
    document.body.appendChild(doItNote);
    if (target) {
      const rect = target.getBoundingClientRect();
      doItNote.style.left = `${Math.min(window.innerWidth - 330, Math.max(14, rect.left))}px`;
      doItNote.style.top = `${Math.min(window.innerHeight - 170, Math.max(14, rect.bottom + 12))}px`;
      target.scrollIntoView?.({ behavior: "smooth", block: "center", inline: "nearest" });
    }
    return new Promise((resolve) => {
      doItNote.querySelector("button")?.addEventListener("click", () => {
        removeDoItNote();
        resolve();
      }, { once: true });
    });
  }

  async function runDoItForMe({ desired, mode, projectId: selectedProjectId, objectId }) {
    open();
    setStatus("Starting guided automation…");
    try {
      await waitForDoItContinue({
        selector: "#render-agent-panel",
        title: "1. I’m setting up the workspace",
        body: "I need a project first because every CAD edit, upload, and prompt result is saved into a Render Studio project.",
      });
      let targetProjectId = selectedProjectId || getProjectId?.() || "";
      if (mode === "new") {
        await waitForDoItContinue({
          selector: "#btn-projects-new, .btn-folder-new-project, #project-browser",
          title: "2. I’m creating a new project",
          body: "Click the + next to Projects in the left explorer. You chose a clean workspace, so I’ll create a project before asking AI to make changes.",
        });
        targetProjectId = await onCreateProject?.();
      } else if (targetProjectId && targetProjectId !== getProjectId?.()) {
        await waitForDoItContinue({
          selector: "#project-browser",
          title: "2. I’m opening the selected project",
          body: "I’m switching to the project you selected so the agent works against the right files and context.",
        });
        await onOpenProject?.(targetProjectId);
      }
      if (!targetProjectId) throw new Error("No project was selected or created.");

      const objectChoice = (getObjectChoices?.() || []).find((item) => String(item.id || item.filename) === String(objectId));
      if (objectChoice) {
        await waitForDoItContinue({
          selector: "#viewport, #design-browser",
          title: "3. I’m selecting the object",
          body: "This pins the task to the object you chose instead of editing the whole project by accident.",
        });
        await onSelectObject?.(objectChoice);
      } else {
        await waitForDoItContinue({
          selector: "#viewport, #prompt-input",
          title: "3. I’m using project-level context",
          body: "No specific object was required, so I’ll describe the request using the current project as context.",
        });
      }

      const objectLine = objectChoice
        ? `Target object: ${objectChoice.label || objectChoice.filename || objectChoice.id}`
        : "Target object: whole project / no specific object";
      const projectLine = `Project: ${getProjectName?.() || targetProjectId}`;
      const finalPrompt = [
        "Do it for me in Render Studio.",
        projectLine,
        objectLine,
        "",
        "Task:",
        desired,
        "",
        "Explain the buttons/actions you would use and why before any destructive step. If a model generation/edit is needed, produce the exact prompt or next command for the active project.",
      ].join("\n");
      await waitForDoItContinue({
        selector: "#render-agent-form",
        title: "4. I’m sending the task to Render Agent",
        body: "This asks the agent to plan or execute the next safe step using the selected project and object context.",
      });
      if (input) input.value = finalPrompt;
      await sendMessage();
      setStatus("Do it for me request sent.");
    } catch (err) {
      removeDoItNote();
      setStatus(err?.message || "Could not run Do it for me.", true);
    }
  }

  function bindExplicitAgentOpeners() {
    hideStudioFabs();
    document.querySelectorAll(AGENT_CONTROL_SEL).forEach((el) => {
      if (isStudioAgentChrome() && isRenderAgentFabNode(el)) return;
      if (el.dataset.raBound === "1") return;
      el.dataset.raBound = "1";
      el.addEventListener("click", (event) => {
        notePromptChromeGesture(event);
        if (event.target?.closest?.("#prompt-tab-imagine, #prompt-pane-imagine, .imagine-pane, [data-studio-panel='imagine']")) {
          return;
        }
        if (!shouldOpenRenderAgentFromEvent(event)) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
        if (el.id === "render-agent-fab" || el.classList.contains("render-agent-fab")) toggle();
        else open({ fromLauncher: true });
      });
    });
  }
  bindExplicitAgentOpeners();
  requestAnimationFrame(bindExplicitAgentOpeners);
  if (!window.__raPromptChromeGuard) {
    window.__raPromptChromeGuard = true;
    const mark = (event) => { notePromptChromeGesture(event); };
    document.addEventListener("pointerdown", mark, true);
    document.addEventListener("pointerup", mark, true);
    document.addEventListener("click", mark, true);
  }
  closeBtn?.addEventListener("click", close);
  closeBtn?.addEventListener("pointerup", (e) => {
    if (e.pointerType === "mouse") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  });
  syncFabState(!panel.classList.contains("hidden"));
  window.addEventListener("resize", () => {
    if (panel.classList.contains("hidden") || !panel.classList.contains("render-agent-panel--docs")) return;
    restoreStickyLayout();
    syncDocsPageLayout(true);
  });
  threadMenuBtn?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const openMenu = threadPopover?.classList.toggle("hidden") === false;
    threadMenuBtn.setAttribute("aria-expanded", openMenu ? "true" : "false");
  });
  newThreadBtn?.addEventListener("click", () => void createThread());
  inviteBtn?.addEventListener("click", () => void inviteSelectedMember());
  fileInput?.addEventListener("change", () => {
    void addFiles(fileInput.files || []);
    fileInput.value = "";
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void sendMessage();
  });
  input?.addEventListener("input", () => renderMentionMenu());
  input?.addEventListener("click", () => renderMentionMenu());
  input?.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (handleMentionKeys(event)) return;
    if (claimRenderAgentSubmitKey(event)) {
      hideMentionMenu();
      void sendMessage();
    }
  });
  document.addEventListener("click", (event) => {
    if (event.target?.closest?.("#render-agent-mention-menu, #render-agent-input")) return;
    hideMentionMenu();
  });
  renderAgentSource();
  renderInviteOptions();
  ensureStickyNoteControls();
  ensureAgentActionBar();
  bindThreadContextMenu();


  function ensureAgentActionBar() {
    if (panel.querySelector(".render-agent-action-bar")) return;
    const formEl = form;
    if (!formEl) return;
    const bar = document.createElement("div");
    bar.className = "render-agent-action-bar";
    bar.innerHTML = `
      <button type="button" class="btn accent btn-compact" data-ra-action="do-it">Do it for me</button>
      <button type="button" class="btn secondary btn-compact" data-ra-action="cad-sanity">CAD sanity</button>
      <button type="button" class="btn secondary btn-compact" data-ra-action="daily-scores">Daily scores</button>
      <button type="button" class="btn secondary btn-compact" data-ra-action="suggest">Suggest to developer</button>
      <button type="button" class="btn secondary btn-compact" data-ra-action="share">Copy share link</button>
      <a class="btn secondary btn-compact" href="/getting-started.html">Getting Started</a>
    `;
    formEl.insertAdjacentElement("beforebegin", bar);
    bar.hidden = activeRaTab !== "chat";
    bar.addEventListener("click", (event) => {
      const btn = event.target.closest?.("[data-ra-action]");
      if (!btn) return;
      const action = btn.getAttribute("data-ra-action");
      if (action === "do-it") showDoItWizard();
      if (action === "cad-sanity") void runCadSanityCheck();
      if (action === "daily-scores") {
        void import("../sandbox/render-agent-crew-score.js?v=20260923-draw-recordings1")
          .then((m) => m.maybePingDailyCrew({ announce, force: true }))
          .catch(() => setStatus("Daily crew score failed to load."));
      }
      if (action === "suggest") void suggestToDeveloper();
      if (action === "share") void copyShareLink();
    });
  }

  async function runCadSanityCheck() {
    const bodies = (getObjectChoices?.() || []).map((obj) => ({
      name: obj.name || obj.label || obj.id || "body",
      bbox: obj.bbox || obj.bounds || null,
      volume: obj.volume,
    }));
    const prompt = String(document.getElementById("prompt-input")?.value || input?.value || "").trim();
    const result = analyzeCadQuality({
      prompt,
      bodies,
      constraints: Number(document.getElementById("sketch-inspector-constraints")?.textContent || 0),
      joints: [],
      kind: /rig/i.test(prompt) ? "rigging" : "cad",
    });
    const packet = cadQualityWatchdogPacket(result);
    const mechLines = (result.cad_bot_lines || cadBotMechanismLines(result.mechanism || {})).map((row) => row.text);
    const text = [
      result.ok ? "CAD sanity passed." : "CAD sanity found issues on this viewport part.",
      result.checks.map((c) => `${c.ok ? "ok" : "need"} · ${c.label}: ${c.detail}`).join("\n"),
      result.mechanism?.summary || "",
      result.repair_edit,
      "@cad-bot @cursor-engineer @harness CAD bot — open/shut, clamp click, pin tolerance. Score every turn into the lake. If this prompt failed twice, stop looping.",
      ...mechLines,
    ].filter(Boolean).join("\n\n");
    if (input) input.value = text.slice(0, 4000);
    setStatus(result.ok ? "CAD sanity passed." : `CAD sanity score ${result.score} — repair edit in the box. Send to run.`);
    try {
      await fetch("/mcp/group-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "post",
          agent: "cad-bot",
          text: `@cad-bot @cursor-engineer CAD_QUALITY score=${result.score} prompt_working=${result.prompt_working} ${String(result.mechanism?.summary || result.repair_edit || "").slice(0, 400)}`,
        }),
      });
    } catch {
      /* board hop is best-effort */
    }
    try {
      const scored = scoreCadBotTurn(result.mechanism || {}, {});
      await ingestCadBotTraining({
        avg: scored.score,
        label: scored.label,
        beneficial: scored.beneficial,
        change: scored.change,
        rows: [{ case_id: "viewport", ...scored }],
      }, { log_id: packet.log_id || "", notes: scored.notes });
    } catch {
      /* training ingest best-effort */
    }
    void packet;
  }

  async function suggestToDeveloper() {
    if (!currentUserId()) {
      onRequireLogin?.();
      return;
    }
    const draft = (input?.value || "").trim()
      || window.prompt("What should we change or add?", "Please improve…")
      || "";
    if (!draft.trim()) return;
    setStatus("Sending suggestion…");
    try {
      const data = await api("/api/render-agent/suggest-to-developer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: draft.trim(),
          thread_id: activeThread?.id || null,
        }),
      });
      setStatus(data.detail || (data.sms_sent ? "Texted the developer." : "Saved for management."));
    } catch (err) {
      setStatus(err.message || "Could not send suggestion.", true);
    }
  }

  async function copyShareLink() {
    if (!currentUserId()) {
      onRequireLogin?.();
      return;
    }
    if (!activeThread?.id) {
      setStatus("Open or start a chat first.", true);
      return;
    }
    try {
      const data = await api(`/api/render-agent/threads/${encodeURIComponent(activeThread.id)}/share`, {
        method: "POST",
      });
      const url = data.url || `${window.location.origin}${data.url_path || ""}`;
      const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
      if (mobile && typeof navigator.share === "function") {
        try {
          await navigator.share({ title: "Render Studio chat", url, text: url });
          setStatus(`Share link ready (${data.share_id}).`);
          return;
        } catch (err) {
          if (err?.name === "AbortError") {
            setStatus("Share cancelled.");
            return;
          }
        }
      }
      if (navigator.clipboard?.writeText && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(url);
          setStatus(`Share link copied (${data.share_id}).`);
          return;
        } catch {
          /* fall through */
        }
      }
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, url.length);
      const ok = document.execCommand("copy");
      ta.remove();
      if (!ok) throw new Error("Clipboard copy was blocked on this device.");
      setStatus(`Share link copied (${data.share_id}).`);
    } catch (err) {
      setStatus(err.message || "Could not create share link.", true);
    }
  }

  async function copyChatId(threadId) {
    const id = String(threadId || activeThread?.id || "").trim();
    if (!id) return;
    try {
      // Prefer share id so anyone can open the preview.
      const data = await api(`/api/render-agent/threads/${encodeURIComponent(id)}/share`, { method: "POST" });
      const shareId = data.share_id || id;
      await navigator.clipboard.writeText(shareId);
      setStatus(`Copied chat id: ${shareId}`);
    } catch {
      try {
        await navigator.clipboard.writeText(id);
        setStatus(`Copied chat id: ${id}`);
      } catch (err) {
        setStatus(err.message || "Could not copy chat id.", true);
      }
    }
  }

  function bindThreadContextMenu() {
    if (threadListEl?.dataset.ctxBound === "1") return;
    if (!threadListEl) return;
    threadListEl.dataset.ctxBound = "1";
    threadListEl.addEventListener("contextmenu", (event) => {
      const row = event.target.closest?.("[data-thread-id]");
      if (!row) return;
      event.preventDefault();
      const id = row.getAttribute("data-thread-id");
      const existing = document.getElementById("render-agent-ctx");
      existing?.remove();
      const menu = document.createElement("div");
      menu.id = "render-agent-ctx";
      menu.className = "render-agent-ctx";
      menu.style.left = `${event.clientX}px`;
      menu.style.top = `${event.clientY}px`;
      menu.innerHTML = `
        <button type="button" data-ctx="copy-id">Copy chat id</button>
        <button type="button" data-ctx="share">Copy share link</button>
        <button type="button" data-ctx="open-preview">Open preview</button>
      `;
      document.body.appendChild(menu);
      const close = () => menu.remove();
      menu.addEventListener("click", async (e) => {
        const btn = e.target.closest?.("[data-ctx]");
        if (!btn) return;
        const act = btn.getAttribute("data-ctx");
        close();
        if (act === "copy-id") await copyChatId(id);
        if (act === "share") {
          activeThread = { ...(activeThread || {}), id };
          await copyShareLink();
        }
        if (act === "open-preview") {
          try {
            const data = await api(`/api/render-agent/threads/${encodeURIComponent(id)}/share`, { method: "POST" });
            window.open(data.url || data.url_path, "_blank", "noopener");
          } catch (err) {
            setStatus(err.message || "Could not open preview.", true);
          }
        }
      });
      setTimeout(() => document.addEventListener("click", close, { once: true }), 0);
    });
  }


  return {
    open,
    openFromAlert,
    announce,
    openWithQuestion,
    openWithDebug,
    close,
    toggle,
    suggestToDeveloper,
    copyShareLink,
    showDoItWizard,
    enterPresentationDeck,
    addFiles,
    appendHeyAiSummary,
    getDesignConversationContext: designConversationContext,
    setUser(user, { suppressOnboarding = false } = {}) {
      if (!user) return;
      if (suppressOnboarding) return;
      if (panel.classList.contains("render-agent-panel--docs")) return;
      const headset = applyHeadsetAgentChrome();
      if (!isDesktopViewport() && !headset) return;
      if (!shouldShowOnboarding()) return;
      if (headset) {
        open({ onboarding: false });
        markOnboardingSeen();
        return;
      }
      renderAgentSource();
      showWelcomeTip();
    },
  };
}
