/** Pure prompt link semantics, shared by every rich composer. */
export function linkDescriptionBefore(text) {
  // Permit blank lines between a colon-ended description and its link.
  const match = String(text || "").match(/(?:^|\n)([^\n]{1,240}:)[ \t]*(?:\n[ \t]*)*$/);
  if (!match || /https?:\/\//i.test(match[1])) return "";
  return match[1].trim().slice(0, -1).trim();
}

export function originalLink(ref) {
  for (const value of [ref?.original_url, ref?.pasted, ref?.url, ref?.href, ref?.filename]) {
    try {
      const url = new URL(/^www\./i.test(value || "") ? `https://${value}` : value);
      if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password) return url.href;
    } catch { /* non-URL reference */ }
  }
  return "";
}

export function expandReferenceTokens(text, refs) {
  const byToken = new Map(refs.filter(r => r.token).map(r => [r.token, originalLink(r) || r.filename || r.token]));
  const tokens = [...byToken.keys()].sort((a, b) => b.length - a.length);
  if (!tokens.length) return text;
  const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(text).replace(new RegExp(tokens.map(escape).join("|"), "g"), token => byToken.get(token));
}

export function clipboardNodeText(root, refs) {
  let text = "";
  const walk = node => {
    if (node.nodeType === 3) { text += node.textContent || ""; return; }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    const id = node.dataset?.refId;
    if (id) {
      const ref = refs.find(r => r.id === id);
      text += originalLink(ref) || ref?.filename || ref?.token || node.dataset.token || "";
      return;
    }
    if (node.tagName === "BUTTON") return;
    if (node.tagName === "BR") { text += "\n"; return; }
    if (["DIV", "P"].includes(node.tagName) && text && !text.endsWith("\n")) text += "\n";
    for (const child of node.childNodes || []) walk(child);
  };
  for (const child of root.childNodes || []) walk(child);
  return text.replace(/\u00a0/g, " ");
}
