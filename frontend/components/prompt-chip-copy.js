/** Clipboard payload for @reference chips in AI prompt composers. */

function looksLikeHttpUrl(value = "") {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^https?:\/\//i.test(text) || /^www\./i.test(text)) return true;
  try {
    const u = new URL(text);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

/**
 * @param {object} ref
 * @returns {{ text: string, kind: "link" | "path" } | null}
 */
export function copyPayloadForPromptRef(ref = {}) {
  if (!ref || typeof ref !== "object") return null;
  const type = String(ref.type || "").toLowerCase();
  const url = firstNonEmpty(ref.original_url, ref.pasted, ref.url, ref.href, ref.link);
  const filename = firstNonEmpty(
    ref.filename,
    ref.viewer_filename,
    ref.source_filename,
    ref.path,
    ref.name,
  );

  if (type === "url" || type === "link" || looksLikeHttpUrl(url) || looksLikeHttpUrl(filename)) {
    const text = looksLikeHttpUrl(url) ? url : looksLikeHttpUrl(filename) ? filename : url || filename;
    if (text) {
      return { text: /^www\./i.test(text) ? `https://${text}` : text, kind: "link" };
    }
  }

  if (filename) return { text: filename, kind: "path" };
  const ident = firstNonEmpty(ref.label, ref.stem, ref.token, ref.id);
  if (!ident) return null;
  return { text: ident, kind: "path" };
}

export function copiedChipStatus(kind) {
  return kind === "link" ? "Copied link" : "Copied path";
}

export async function writeClipboardText(text) {
  const value = String(text || "");
  if (!value) return false;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return !!ok;
  } catch {
    return false;
  }
}

export async function copyPromptChipValue(ref) {
  const payload = copyPayloadForPromptRef(ref);
  if (!payload?.text) return null;
  const ok = await writeClipboardText(payload.text);
  return ok ? payload : null;
}
