/**
 * Quest Book — gamified learning map for Render3D.
 * Chapters from DOC_CATEGORIES; nodes from DOC_FEATURES + Welcome chapter.
 * Progress via feature-events.js (localStorage per user).
 */
import { DOC_CATEGORIES, DOC_FEATURES } from "./docs-features.js?v=20260716-source-parts";
import {
  emitFeatureUsed,
  getCompletedQuestIds,
  isQuestCompleted,
  onQuestProgress,
  setQuestUser,
} from "./feature-events.js?v=20260721-quest-progress";

const OVERLAY_ID = "quest-book-overlay";

const WELCOME_CHAPTER = {
  id: "welcome",
  title: "Welcome",
  blurb: "Your first steps in Render3D.",
};

const WELCOME_QUESTS = [
  {
    id: "welcome-account",
    title: "Create your account",
    summary: "Sign in so projects, prompts, and progress follow you.",
    where: "Top-right account button",
  },
  {
    id: "welcome-open-book",
    title: "Open the Quest Book",
    summary: "You are here. This book tracks everything you learn in Studio.",
    where: "Account menu → Quest Book",
  },
  {
    id: "welcome-walkthrough",
    title: "Take the Studio walkthrough",
    summary: "A guided tour of the viewport, AI prompt, and explorer.",
    where: "Account menu → Studio walkthrough",
  },
  {
    id: "welcome-first-project",
    title: "Create your first project",
    summary: "Projects hold your models, references, and prompt history.",
    where: "Left explorer → New project",
  },
  {
    id: "welcome-first-generate",
    title: "Generate your first part",
    summary: "Describe a simple part with sizes and units, then hit Generate.",
    where: "Right panel → AI → Compose",
  },
];

const CHAPTER_ICONS = {
  welcome: "M12 2l2.5 6.3L21 9.1l-5 4.4 1.5 6.6L12 16.6 6.5 20.1 8 13.5 3 9.1l6.5-.8L12 2z",
  "ai-cad": "M9 2l1.2 3.4L13 6.5l-2.8 1.1L9 11 7.8 7.6 5 6.5l2.8-1.1L9 2zm8 5l.9 2.4 2.1.8-2.1.8L17 13l-.9-2.4-2.1-.8 2.1-.8L17 7zM12 12.5l1.6 4.2 3.9 1.4-3.9 1.4L12 23l-1.6-3.5-3.9-1.4 3.9-1.4 1.6-4.2z",
  projects: "M3 5a2 2 0 012-2h4l2 2h8a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2V5z",
  modeling: "M12 2l8 4.5v9L12 20l-8-4.5v-9L12 2zm0 2.3L6.2 7.5 12 10.7l5.8-3.2L12 4.3zM6 9.3v5l5 2.8v-5L6 9.3zm12 0l-5 2.8v5l5-2.8v-5z",
  "sketch-canvas": "M3 17.2V21h3.8L17.8 10 14 6.2 3 17.2zM20.7 7.1a1 1 0 000-1.4l-2.4-2.4a1 1 0 00-1.4 0l-1.8 1.8 3.8 3.8 1.8-1.8z",
  rigging: "M7 4a2.5 2.5 0 11-.001 5.001A2.5 2.5 0 017 4zm10 11a2.5 2.5 0 11-.001 5.001A2.5 2.5 0 0117 15zM8.7 8.8l6.6 6.4 1.4-1.4-6.6-6.4-1.4 1.4z",
  wiring: "M13 2L4 14h6l-1 8 9-12h-6l1-8z",
  cloud: "M6.5 19a4.5 4.5 0 01-.4-8.98A6 6 0 0117.7 8.2 4.5 4.5 0 0117.5 19h-11z",
  architect: "M12 3l9 8h-3v9h-4v-6h-4v6H6v-9H3l9-8z",
  help: "M12 2a10 10 0 100 20 10 10 0 000-20zm.2 15.7a1.3 1.3 0 110 2.6 1.3 1.3 0 010-2.6zM12 5.8c2.2 0 4 1.5 4 3.6 0 1.5-.8 2.3-1.9 3-1 .7-1.3 1.1-1.3 2h-2c0-1.7.7-2.5 1.9-3.3.9-.6 1.3-1 1.3-1.7 0-1-.9-1.6-2-1.6-1.2 0-2 .7-2.1 1.8H8c.1-2.2 1.8-3.8 4-3.8z",
};

let overlayApi = null;
let progressUnsub = null;

function chapters() {
  const cats = DOC_CATEGORIES.map((cat) => ({
    ...cat,
    quests: DOC_FEATURES.filter((f) => f.category === cat.id).map((f) => ({
      id: f.id,
      title: f.title,
      summary: f.summary,
      where: f.where,
      steps: f.steps || [],
    })),
  })).filter((c) => c.quests.length);
  return [{ ...WELCOME_CHAPTER, quests: WELCOME_QUESTS }, ...cats];
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function icon(chapterId, size = 16) {
  const d = CHAPTER_ICONS[chapterId] || CHAPTER_ICONS.help;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path fill="currentColor" d="${d}"/></svg>`;
}

function wobble(str, span) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return ((h % 1000) / 1000 - 0.5) * span;
}

function layoutChapter(chapter) {
  const NODE = 58;
  const X_STEP = 148;
  const X_START = 150;
  const Y_MID = 210;
  const nodes = [];
  let spineIndex = 0;
  let lastSpine = -1;

  chapter.quests.forEach((quest, i) => {
    const isBranch = i > 0 && i % 3 === 2 && chapter.quests.length > 3;
    if (isBranch && lastSpine >= 0) {
      const parent = nodes[lastSpine];
      nodes.push({
        quest,
        parentIndex: lastSpine,
        x: parent.x + X_STEP * 0.55 + wobble(quest.id, 30),
        y: parent.y + (spineIndex % 2 ? -125 : 125) + wobble(quest.id + "y", 40),
      });
      return;
    }
    const x = X_START + spineIndex * X_STEP;
    const y = Y_MID + (spineIndex % 2 ? -58 : 46) + wobble(quest.id, 44);
    nodes.push({ quest, parentIndex: lastSpine, x, y });
    lastSpine = nodes.length - 1;
    spineIndex += 1;
  });

  const width = Math.max(680, ...nodes.map((n) => n.x)) + NODE + 60;
  const height = Math.max(420, ...nodes.map((n) => n.y)) + NODE + 60;
  return { nodes, width, height };
}

/** completed | available | locked — locked only gates highlight; credit still applies. */
function computeStates(nodes) {
  const states = new Map();
  nodes.forEach((node) => {
    if (isQuestCompleted(node.quest.id)) {
      states.set(node.quest.id, "completed");
      return;
    }
    if (node.parentIndex < 0) {
      states.set(node.quest.id, "available");
      return;
    }
    const parent = nodes[node.parentIndex];
    const parentDone = parent && isQuestCompleted(parent.quest.id);
    states.set(node.quest.id, parentDone ? "available" : "locked");
  });
  return states;
}

function stateLabel(state) {
  if (state === "completed") return "Completed";
  if (state === "available") return "Ready to start";
  return "Locked — finish the previous quest";
}

function renderGraph(chapter, { flashId = null } = {}) {
  const { nodes, width, height } = layoutChapter(chapter);
  const states = computeStates(nodes);
  const links = nodes
    .map((node) => {
      if (node.parentIndex < 0) return "";
      const p = nodes[node.parentIndex];
      const done = states.get(node.quest.id) === "completed" && states.get(p.quest.id) === "completed";
      return `<line x1="${p.x}" y1="${p.y}" x2="${node.x}" y2="${node.y}" class="quest-link${done ? " quest-link--done" : ""}" />`;
    })
    .join("");

  const dots = nodes
    .map((node) => {
      const state = states.get(node.quest.id) || "locked";
      const flash = flashId === node.quest.id ? " quest-node--flash" : "";
      return `
        <button type="button"
          class="quest-node quest-node--${state}${flash}"
          style="left:${node.x}px; top:${node.y}px;"
          data-quest-id="${esc(node.quest.id)}"
          aria-label="${esc(node.quest.title)}">
          <span class="quest-node-icon">${icon(chapter.id, 20)}</span>
          ${state === "completed" ? `<span class="quest-node-check" aria-hidden="true"><svg viewBox="0 0 24 24" width="11" height="11"><path fill="currentColor" d="M9 16.2L4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2z"/></svg></span>` : ""}
          <span class="quest-node-tip">
            <strong>${esc(node.quest.title)}</strong>
            <span>${esc(node.quest.summary)}</span>
            <em>${esc(stateLabel(state))}</em>
          </span>
        </button>`;
    })
    .join("");

  return `
    <div class="quest-graph" style="width:${width}px; height:${height}px;">
      <svg class="quest-graph-links" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">${links}</svg>
      ${dots}
    </div>`;
}

function renderDetail(chapter, quest) {
  if (!quest) {
    return `<p class="quest-detail-empty">Select a quest node to preview it. Quests complete automatically as you use Studio.</p>`;
  }
  const { nodes } = layoutChapter(chapter);
  const states = computeStates(nodes);
  const state = states.get(quest.id) || "locked";
  const steps = (quest.steps || [])
    .map((s) => `<li><span class="quest-step-box${state === "completed" ? " quest-step-box--done" : ""}" aria-hidden="true"></span>${esc(s)}</li>`)
    .join("");
  return `
    <div class="quest-detail-head">
      <span class="quest-detail-icon quest-detail-icon--${state}">${icon(chapter.id, 18)}</span>
      <div>
        <strong>${esc(quest.title)}</strong>
        <span class="quest-detail-where">${esc(quest.where || "")}</span>
      </div>
      <span class="quest-detail-state quest-detail-state--${state}">${state === "completed" ? "Completed" : state === "available" ? "Ready" : "Locked"}</span>
    </div>
    <p class="quest-detail-summary">${esc(quest.summary)}</p>
    ${steps ? `<ul class="quest-detail-steps">${steps}</ul>` : ""}`;
}

function countProgress(allChapters) {
  const completed = getCompletedQuestIds();
  let total = 0;
  let done = 0;
  allChapters.forEach((c) => {
    c.quests.forEach((q) => {
      total += 1;
      if (completed.has(q.id)) done += 1;
    });
  });
  return { total, done };
}

function buildOverlay() {
  const allChapters = chapters();
  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.className = "quest-book-overlay hidden";
  overlay.innerHTML = `
    <div class="quest-book-backdrop" data-quest-close></div>
    <div class="quest-book" role="dialog" aria-modal="true" aria-label="Quest Book">
      <header class="quest-book-head">
        <span class="quest-book-head-icon" aria-hidden="true">${icon("welcome", 18)}</span>
        <div class="quest-book-head-titles">
          <strong>Quest Book</strong>
          <span>Learn Render3D quest by quest</span>
        </div>
        <div class="quest-book-progress" title="Quest completion">
          <span class="quest-book-progress-label" id="quest-book-progress-label">0 / 0 quests</span>
          <span class="quest-book-progress-track"><span class="quest-book-progress-fill" id="quest-book-progress-fill" style="width:0%"></span></span>
        </div>
        <button type="button" class="quest-book-close" data-quest-close aria-label="Close Quest Book">×</button>
      </header>
      <div class="quest-book-body">
        <nav class="quest-book-tabs" aria-label="Quest chapters" id="quest-book-tabs"></nav>
        <div class="quest-book-main">
          <div class="quest-book-chapter-head">
            <strong id="quest-chapter-title"></strong>
            <span id="quest-chapter-blurb" class="quest-chapter-blurb"></span>
          </div>
          <div class="quest-book-canvas" id="quest-book-canvas"></div>
          <footer class="quest-book-detail" id="quest-book-detail"></footer>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  let activeChapter = allChapters[0];
  let selectedQuest = null;
  let flashId = null;

  const canvas = overlay.querySelector("#quest-book-canvas");
  const detail = overlay.querySelector("#quest-book-detail");
  const tabsNav = overlay.querySelector("#quest-book-tabs");

  function renderTabs() {
    const completed = getCompletedQuestIds();
    tabsNav.innerHTML = allChapters
      .map((c) => {
        const done = c.quests.filter((q) => completed.has(q.id)).length;
        const clear = done === c.quests.length && c.quests.length > 0;
        return `
          <button type="button" class="quest-book-tab${clear ? " quest-book-tab--clear" : ""}" data-chapter-id="${esc(c.id)}" title="${esc(c.blurb || c.title)}">
            <span class="quest-book-tab-icon">${icon(c.id)}</span>
            <span class="quest-book-tab-title">${esc(c.title)}</span>
            <span class="quest-book-tab-count">${done}/${c.quests.length}</span>
          </button>`;
      })
      .join("");
    tabsNav.querySelectorAll(".quest-book-tab").forEach((tab) => {
      tab.classList.toggle("active", tab.dataset.chapterId === activeChapter.id);
    });
  }

  function syncProgressHeader() {
    const { total, done } = countProgress(allChapters);
    const label = overlay.querySelector("#quest-book-progress-label");
    const fill = overlay.querySelector("#quest-book-progress-fill");
    if (label) label.textContent = `${done} / ${total} quests`;
    if (fill) fill.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
  }

  function syncDetail() {
    detail.innerHTML = renderDetail(activeChapter, selectedQuest);
  }

  function showChapter(chapterId, { keepSelection = false } = {}) {
    activeChapter = allChapters.find((c) => c.id === chapterId) || allChapters[0];
    if (!keepSelection) selectedQuest = null;
    else if (selectedQuest && !activeChapter.quests.some((q) => q.id === selectedQuest.id)) {
      selectedQuest = null;
    }
    renderTabs();
    overlay.querySelector("#quest-chapter-title").textContent = activeChapter.title;
    overlay.querySelector("#quest-chapter-blurb").textContent = activeChapter.blurb || "";
    canvas.innerHTML = renderGraph(activeChapter, { flashId });
    if (selectedQuest) {
      canvas.querySelectorAll(".quest-node").forEach((n) => {
        n.classList.toggle("is-selected", n.dataset.questId === selectedQuest.id);
      });
    }
    syncDetail();
    syncProgressHeader();
    flashId = null;
  }

  function refresh({ flashFeatureId = null } = {}) {
    if (flashFeatureId) flashId = flashFeatureId;
    const selId = selectedQuest?.id || null;
    showChapter(activeChapter.id, { keepSelection: true });
    if (selId) {
      selectedQuest = activeChapter.quests.find((q) => q.id === selId) || selectedQuest;
      syncDetail();
    }
  }

  overlay.addEventListener("click", (e) => {
    if (e.target.closest("[data-quest-close]")) {
      closeQuestBook();
      return;
    }
    const tab = e.target.closest(".quest-book-tab");
    if (tab) {
      showChapter(tab.dataset.chapterId);
      return;
    }
    const node = e.target.closest(".quest-node");
    if (node) {
      const quest = activeChapter.quests.find((q) => q.id === node.dataset.questId) || null;
      selectedQuest = quest && quest === selectedQuest ? null : quest;
      canvas.querySelectorAll(".quest-node").forEach((n) => {
        n.classList.toggle("is-selected", n.dataset.questId === (selectedQuest?.id || ""));
      });
      syncDetail();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !overlay.classList.contains("hidden")) closeQuestBook();
  });

  showChapter(WELCOME_CHAPTER.id);
  return { overlay, refresh, showChapter };
}

function bindStoredUser() {
  try {
    const raw = localStorage.getItem("render3d_user") || localStorage.getItem("render3d:user");
    /* auth may store differently — app.js will call setQuestUser on login */
  } catch {
    /* ignore */
  }
}

export function openQuestBook() {
  bindStoredUser();
  if (!overlayApi) overlayApi = buildOverlay();
  if (!progressUnsub) {
    progressUnsub = onQuestProgress((detail) => {
      if (!overlayApi) return;
      const open = !overlayApi.overlay.classList.contains("hidden");
      if (open) overlayApi.refresh({ flashFeatureId: detail?.featureId || null });
    });
  }
  overlayApi.overlay.classList.remove("hidden");
  emitFeatureUsed("welcome-open-book", { title: "Open the Quest Book" });
  overlayApi.refresh();
}

export function closeQuestBook() {
  document.getElementById(OVERLAY_ID)?.classList.add("hidden");
}

/** Optional: app.js can push the signed-in user into quest storage. */
export { setQuestUser };
