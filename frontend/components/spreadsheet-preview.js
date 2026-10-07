/** Lightweight CSV / XLSX table preview (read-only for binary sheets). */

function decodeXml(text) {
  return String(text || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function parseCsvText(text, { maxRows = 400, maxCols = 64 } = {}) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const src = String(text || "").replace(/^\uFEFF/, "");
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === "," || ch === "\t") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (ch === "\n" || (ch === "\r" && src[i + 1] !== "\n")) {
      row.push(cell);
      cell = "";
      if (row.some((c) => String(c).length)) rows.push(row.slice(0, maxCols));
      row = [];
      if (rows.length >= maxRows) break;
      continue;
    }
    if (ch !== "\r") cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row.slice(0, maxCols));
  }
  return rows;
}

function colLettersToIndex(letters) {
  let n = 0;
  for (const ch of String(letters || "").toUpperCase()) {
    if (ch < "A" || ch > "Z") break;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return Math.max(0, n - 1);
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("This browser cannot unpack XLSX");
  }
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  await writer.write(bytes);
  await writer.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

function readZipLocalFiles(buffer) {
  const view = new DataView(buffer);
  const files = {};
  let offset = 0;
  const bytes = new Uint8Array(buffer);
  while (offset + 30 <= bytes.length) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break;
    const method = view.getUint16(offset + 8, true);
    const flags = view.getUint16(offset + 6, true);
    let compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLen));
    let dataStart = offset + 30 + nameLen + extraLen;
    if ((flags & 0x8) && !compSize) {
      break;
    }
    const data = bytes.subarray(dataStart, dataStart + compSize);
    files[name] = { method, data };
    offset = dataStart + compSize;
  }
  return files;
}

async function unzipText(buffer, path) {
  const files = readZipLocalFiles(buffer);
  const entry = files[path];
  if (!entry) return "";
  if (entry.method === 0) return new TextDecoder().decode(entry.data);
  if (entry.method === 8) return new TextDecoder().decode(await inflateRaw(entry.data));
  throw new Error(`Unsupported ZIP method ${entry.method}`);
}

function parseSharedStrings(xml) {
  const out = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
  let m;
  while ((m = siRe.exec(xml))) {
    const texts = [...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((hit) => decodeXml(hit[1]));
    out.push(texts.join(""));
  }
  return out;
}

function parseSheetXml(xml, shared, { maxRows = 200, maxCols = 40 } = {}) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(xml)) && rows.length < maxRows) {
    const cells = [];
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/gi;
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowMatch[1]))) {
      const attrs = cellMatch[1];
      const ref = /(?:^|\s)r="([A-Z]+)(\d+)"/i.exec(attrs);
      const type = /(?:^|\s)t="([^"]+)"/i.exec(attrs)?.[1] || "";
      const col = ref ? colLettersToIndex(ref[1]) : cells.length;
      if (col >= maxCols) continue;
      const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/i.exec(cellMatch[2])?.[1] ?? "";
      let value = decodeXml(raw);
      if (type === "s") value = shared[Number(value)] ?? value;
      if (type === "b") value = value === "1" ? "TRUE" : "FALSE";
      if (type === "inlineStr") {
        const inline = [...cellMatch[2].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)]
          .map((hit) => decodeXml(hit[1]))
          .join("");
        value = inline;
      }
      cells[col] = value;
    }
    rows.push(cells);
  }
  const width = Math.min(maxCols, rows.reduce((w, row) => Math.max(w, row.length), 0));
  return rows.map((row) => {
    const next = [];
    for (let i = 0; i < width; i += 1) next[i] = row[i] ?? "";
    return next;
  });
}

export async function parseSpreadsheetBlob(blob, filename = "") {
  const name = String(filename || "").toLowerCase();
  const buffer = await blob.arrayBuffer();
  const head = new Uint8Array(buffer, 0, Math.min(8, buffer.byteLength));
  const ole = head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  if (ole || name.endsWith(".xls")) {
    throw new Error("Binary .xls preview isn’t available — download the file, or save as .xlsx / CSV.");
  }
  const sharedXml = await unzipText(buffer, "xl/sharedStrings.xml");
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];
  const sheetXml = await unzipText(buffer, "xl/worksheets/sheet1.xml");
  if (!sheetXml) throw new Error("Could not read the first worksheet.");
  return parseSheetXml(sheetXml, shared);
}

export function spreadsheetTableHtml(rows, { query = "" } = {}) {
  const q = String(query || "").trim().toLowerCase();
  const filtered = q
    ? rows.filter((row) => row.some((cell) => String(cell).toLowerCase().includes(q)))
    : rows;
  if (!filtered.length) {
    return `<div class="ref-viewer-empty">${q ? "No matching rows." : "Empty sheet."}</div>`;
  }
  const body = filtered.map((row) => {
    const cells = row.map((cell) => {
      const text = String(cell ?? "");
      const hit = q && text.toLowerCase().includes(q);
      return `<td class="${hit ? "is-hit" : ""}">${escapeCell(text)}</td>`;
    }).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  return `<div class="ref-sheet-wrap"><table class="ref-sheet-table">${body}</table></div>`;
}

function escapeCell(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
