/**
 * Teach basic character moves, then agents self-learn new ones.
 * Uses teaching sessions (teach1). Not DIMOS. Not a second WebGL.
 */

export const CHARMOVE1_TOKEN = "charmove1";
export const BASIC_MOVES = Object.freeze([
  "idle",
  "approach_desk",
  "circle_table",
  "speak_pose",
  "return_home",
]);
export const SELF_LEARN_AFTER = 3;
export const MOVES_PATH = "sandbox-sessions/teaching/character-moves.json";

function nid() {
  return (globalThis.crypto?.randomUUID?.() || `m${Date.now()}`).toString(16).replace(/-/g, "").slice(0, 12);
}

export function planCharacterMoves(crew = []) {
  return (crew || []).map((c, i) => ({
    id: c.id || c,
    move: BASIC_MOVES[i % BASIC_MOVES.length],
    path: ["idle", BASIC_MOVES[i % BASIC_MOVES.length], "speak_pose", "return_home"],
    loop: true,
    workshop: "any workshop",
  }));
}

export function recordTaughtBasic({ move, trainee = "astra", note = "" } = {}) {
  const id = String(move || "").trim();
  if (!BASIC_MOVES.includes(id)) {
    return { ok: false, reason: "unknown_basic", allowed: [...BASIC_MOVES] };
  }
  return {
    ok: true,
    token: CHARMOVE1_TOKEN,
    kind: "taught_basic",
    teach_id: `tb_${nid()}`,
    move: id,
    trainee: String(trainee || "astra").slice(0, 40),
    note: String(note || `Sam taught ${id} in any workshop`).slice(0, 200),
    at: new Date().toISOString(),
  };
}

export function proposeSelfLearnedMoves(taught = []) {
  const have = new Set((taught || []).filter((t) => t.ok !== false).map((t) => t.move));
  const extras = [];
  if (have.has("approach_desk") && have.has("speak_pose")) {
    extras.push({ id: "desk_greet", from: ["approach_desk", "speak_pose"], line: "Approach a desk then speak" });
  }
  if (have.has("circle_table") && have.has("return_home")) {
    extras.push({ id: "orbit_then_home", from: ["circle_table", "return_home"], line: "Orbit then sit" });
  }
  if (have.has("idle") && have.has("approach_desk")) {
    extras.push({ id: "idle_to_desk", from: ["idle", "approach_desk"], line: "Leave idle and walk to a desk" });
  }
  if (have.size >= SELF_LEARN_AFTER && extras.length === 0) {
    extras.push({ id: "combo_watch", from: [...have], line: "Watched enough basics — propose a combo" });
  }
  return extras.map((e) => ({
    ...e,
    kind: "self_learned",
    token: CHARMOVE1_TOKEN,
    quiet: true,
    at: new Date().toISOString(),
  }));
}

export function selfLearnReady(taught = []) {
  const basics = new Set((taught || []).map((t) => t.move).filter((m) => BASIC_MOVES.includes(m)));
  return basics.size >= SELF_LEARN_AFTER;
}

export function buildMovesPayload(taught = [], learned = []) {
  return {
    kind: "character_moves_book",
    token: CHARMOVE1_TOKEN,
    workshop: "any workshop",
    at: new Date().toISOString(),
    basics: [...BASIC_MOVES],
    taught: (taught || []).slice(-40),
    self_learned: (learned || []).slice(-40),
    self_learn_after: SELF_LEARN_AFTER,
    ready: selfLearnReady(taught),
    path: MOVES_PATH,
  };
}

export async function persistMovesBook(book) {
  const text = JSON.stringify(book, null, 2);
  const res = await fetch("/mcp/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "write", agent: "sam", path: MOVES_PATH, text: text.slice(0, 80_000) }),
  }).catch(() => null);
  return { ok: !!(res && res.ok), path: MOVES_PATH, token: CHARMOVE1_TOKEN };
}

export function characterMoveMarkup() {
  return `
    <div class="sb-charmove" data-sb-charmove data-token="${CHARMOVE1_TOKEN}">
      <p class="muted small">Teach basics in any workshop. After ${SELF_LEARN_AFTER} taught moves, crew self-learns — quiet unless they need Sam. Same viewport (watch while you explain).</p>
      <label class="sb-dimos-field">
        <span>Basic move</span>
        <select data-cm-move>${BASIC_MOVES.map((m) => `<option value="${m}">${m}</option>`).join("")}</select>
      </label>
      <label class="sb-dimos-field">
        <span>Trainee</span>
        <input type="text" data-cm-trainee value="astra" maxlength="40" />
      </label>
      <div class="sb-dimos-actions">
        <button type="button" class="sb-agent-btn sb-agent-btn--astra" data-cm-teach>Teach this basic</button>
        <button type="button" class="sb-agent-btn" data-cm-learn>Self-learn from watched</button>
      </div>
      <p class="sb-dimos-status" data-cm-status role="status">No basics taught yet</p>
    </div>
  `;
}

export function bindCharacterMoves(root, { onBook } = {}) {
  if (!root) return null;
  const taught = [];
  let learned = [];
  const status = root.querySelector("[data-cm-status]");
  const setStatus = (m) => { if (status) status.textContent = m; };

  const publish = async (note) => {
    const book = buildMovesPayload(taught, learned);
    onBook?.(book);
    const saved = await persistMovesBook(book);
    try {
      globalThis.window?.dispatchEvent?.(new CustomEvent("render3d-sandbox-char-move", {
        detail: { book, token: CHARMOVE1_TOKEN },
      }));
    } catch { /* optional */ }
    setStatus(note || (saved.ok ? `Saved ${MOVES_PATH}` : `Local book · ${taught.length} basics`));
    return book;
  };

  root.querySelector("[data-cm-teach]")?.addEventListener("click", async () => {
    const move = root.querySelector("[data-cm-move]")?.value || "idle";
    const trainee = root.querySelector("[data-cm-trainee]")?.value || "astra";
    const rec = recordTaughtBasic({ move, trainee, note: `Sam demonstrated ${move} in any workshop` });
    if (!rec.ok) { setStatus(`Unknown basic — ${BASIC_MOVES.join(", ")}`); return; }
    taught.push(rec);
    try {
      globalThis.window?.dispatchEvent?.(new CustomEvent("render3d-sandbox-draw", {
        detail: { source: "character-moves", token: CHARMOVE1_TOKEN, x: 0, y: 0, mode: move },
      }));
    } catch { /* optional */ }
    let extra = "";
    if (selfLearnReady(taught)) {
      learned = proposeSelfLearnedMoves(taught);
      extra = ` · self-learn ready (${learned.length} proposals, quiet)`;
    }
    try {
      const { onTeachOne, persistHarness } = await import("./crew-harness.js?v=harness2");
      const pair = trainee === "astra" ? "vibe-rnd" : "astra";
      const out = onTeachOne({ move, trainee, pair, surroundings: { teaching: true, move } });
      await persistHarness(out.personalities, out.routes);
      extra += ` · ${out.ideas.length} train ideas (quiet notes)`;
    } catch { /* harness optional */ }
    await publish(`Taught ${move} · ${taught.length}/${SELF_LEARN_AFTER} basics${extra}`);
  });

  root.querySelector("[data-cm-learn]")?.addEventListener("click", async () => {
    if (!selfLearnReady(taught)) {
      setStatus(`Need ${SELF_LEARN_AFTER} basics first (${taught.length} so far)`);
      return;
    }
    learned = proposeSelfLearnedMoves(taught);
    await publish(`Self-learned ${learned.length} move(s) — crew stays quiet`);
  });

  return {
    token: CHARMOVE1_TOKEN,
    taught: () => taught.slice(),
    learned: () => learned.slice(),
    publish,
  };
}
