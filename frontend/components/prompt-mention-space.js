/**
 * Shared @/# mention insertion: one trailing space after the tag.
 * Call only when a mention is inserted (Tab, click, chip). Do not re-run on
 * every keystroke — if the user backspaces that space, leave it gone until
 * they insert another mention.
 */

export function insertMentionWithTrailingSpace(value, token, start, end = start) {
  const text = String(value ?? "");
  const tag = String(token || "").trim();
  const from = Math.max(0, Number.isFinite(Number(start)) ? Number(start) : text.length);
  const to = Math.max(from, Number.isFinite(Number(end)) ? Number(end) : from);
  if (!tag) return { value: text, caret: to, inserted: "" };
  const before = text.slice(0, from);
  const after = text.slice(to);
  const lead = before && !/[\s]$/.test(before) ? " " : "";
  const trail = /^[\s]/.test(after) ? "" : " ";
  const inserted = `${lead}${tag}${trail}`;
  return {
    value: `${before}${inserted}${after}`,
    caret: before.length + inserted.length,
    inserted,
  };
}

export function appendMentionWithTrailingSpace(value, token) {
  const text = String(value ?? "");
  return insertMentionWithTrailingSpace(text, token, text.length);
}
