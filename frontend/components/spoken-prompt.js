/** Collapse duplicated voice / XR spoken-prompt blocks. */

const SPOKEN_SPLIT = /(?:^|\n)\s*Spoken\s*\/\s*transcribed\s+prompt:\s*/i;

export function collapseRepeatedSpokenPrompt(text) {
  const raw = String(text || "").replace(/\r/g, "").trim();
  if (!raw) return "";
  const pieces = SPOKEN_SPLIT.test(`\n${raw}`)
    ? raw.split(SPOKEN_SPLIT)
    : raw.split(/\n{2,}/);
  const unique = [];
  const seen = new Set();
  for (const piece of pieces) {
    const chunk = String(piece || "")
      .replace(/^\s*Spoken\s*\/\s*transcribed\s+prompt:\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!chunk) continue;
    const key = chunk.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(chunk);
  }
  return unique.join("\n");
}
