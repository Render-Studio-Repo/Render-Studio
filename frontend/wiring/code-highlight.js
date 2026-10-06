/** Lightweight syntax highlighting shared with the Wiring Simulator editor. */

function escapeCode(s) {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

export function highlightJsonLine(line) {
  let html = escapeCode(line);
  html = html
    .replace(/("(?:\\.|[^"\\])*")(?=\s*:)/g, '<span class="tok-key">$1</span>')
    .replace(/:\s*("(?:\\.|[^"\\])*")/g, ': <span class="tok-string">$1</span>')
    .replace(/\b(true|false|null)\b/g, '<span class="tok-bool">$1</span>')
    .replace(/\b(-?\d+(?:\.\d+)?)\b/g, '<span class="tok-number">$1</span>');
  return html;
}

export function highlightCodeLine(line) {
  let code = escapeCode(line);
  let comment = "";
  const commentMatch = code.match(/(\/\/.*|#.*)$/);
  if (commentMatch) {
    code = code.slice(0, commentMatch.index);
    comment = commentMatch[0];
  }
  code = code
    .replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g, '<span class="tok-string">$1</span>')
    .replace(
      /\b(#include|const|let|var|function|class|new|int|float|double|void|for|while|if|else|return|def|import|from|Pin|PWM|Stepper|Servo|HIGH|LOW|OUTPUT|True|False|true|false|null|None|std|cout|endl|console|log|export|default|async|await|try|catch|finally|switch|case|break|continue|package|public|private|static|struct|enum|type|interface)\b/g,
      '<span class="tok-keyword">$1</span>',
    )
    .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-number">$1</span>');
  if (comment) code += `<span class="tok-comment">${comment}</span>`;
  return code;
}

export function highlightSource(src, { mode = "code", query = "" } = {}) {
  const q = String(query || "").trim().toLowerCase();
  const paint = mode === "json" ? highlightJsonLine : highlightCodeLine;
  return String(src ?? "")
    .split("\n")
    .map((line) => {
      const hit = q && line.toLowerCase().includes(q);
      return `<span class="ref-code-line${hit ? " is-hit" : ""}">${paint(line)}</span>`;
    })
    .join("\n");
}

export function lineMatchesQuery(text, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return String(text ?? "").toLowerCase().includes(q);
}
