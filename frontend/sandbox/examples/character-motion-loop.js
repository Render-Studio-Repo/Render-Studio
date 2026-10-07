/** Sandbox loop stub — character moves for any workshop. */
export const LOOP_TOKEN = "loop1";
export const BASIC_MOVES = Object.freeze([
  "idle",
  "approach_desk",
  "circle_table",
  "speak_pose",
  "return_home",
]);

export async function tick(ctx = {}) {
  return { ok: true, token: LOOP_TOKEN, at: new Date().toISOString(), ctx, workshop: "any workshop" };
}

export function planCharacterMoves(crew = []) {
  return crew.map((c, i) => ({
    id: c.id || c,
    move: BASIC_MOVES[i % BASIC_MOVES.length],
    path: ["idle", BASIC_MOVES[i % BASIC_MOVES.length], "speak_pose", "return_home"],
    loop: true,
    workshop: "any workshop",
  }));
}
