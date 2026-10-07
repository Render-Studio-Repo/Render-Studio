/** Lay out only the requested note page. Long regions never paint/layout all pages at once. */
export function createXrNotePages({ text = '', measure, width = 720, linesPerPage = 11 }) {
  const content = String(text), pages = [];
  let cursor = 0, complete = false;
  function nextLine() {
    let line = '';
    while (cursor < content.length) {
      if (content[cursor] === '\n') { cursor++; return line; }
      if (/\s/.test(content[cursor])) { cursor++; continue; }
      let end = cursor;
      while (end < content.length && !/\s/.test(content[end])) end++;
      const word = content.slice(cursor, end), candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= width) { line = candidate; cursor = end; continue; }
      if (line) return line;
      // Long identifiers/transcripts also remain readable; split at a measured
      // character boundary rather than clipping the tail of an unbroken word.
      let low = 1, high = word.length;
      while (low < high) { const mid = Math.ceil((low + high) / 2); if (measure(word.slice(0, mid)) <= width) low = mid; else high = mid - 1; }
      cursor += low;
      return word.slice(0, low);
    }
    return line;
  }
  function appendPage() {
    const lines = [];
    while (lines.length < linesPerPage && cursor < content.length) lines.push(nextLine());
    if (!lines.length && !pages.length) lines.push('');
    if (lines.length) pages.push(lines);
    complete = cursor >= content.length;
  }
  return {
    page(index = 0) {
      index = Math.max(0, Math.trunc(Number(index) || 0));
      // Callers advance one page at a time; even a malformed large index does
      // at most one page of font measurement on the current interaction.
      if ((!pages.length || index >= pages.length) && !complete) appendPage();
      if (index >= pages.length) index = complete ? 0 : pages.length - 1;
      return { index, lines: pages[index], total: complete ? pages.length : null };
    },
  };
}
