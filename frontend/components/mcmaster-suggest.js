/** McMaster typeahead + quick-part families. mcmtype1 — no HTML scrape. */

export const MCMASTER_THUMB = (pn) =>
  `https://images.mcmaster.com/${String(pn || "").toUpperCase()}.png`;

const ALIAS = [
  ["scrw", "screw"],
  ["skt", "socket"],
  ["shcs", "socket head"],
  ["wshr", "washer"],
  ["hexnut", "hex nut"],
  ["brg", "bearing"],
  ["mm", "mm"],
];

/** Curated McMaster PNs already used in-studio, plus common fastener sizes. */
export const MCMASTER_SUGGEST_CATALOG = [
  { number: "91251A100", title: "Socket Head Screw", subtitle: "M3 × 8 mm", kind: "screw", keywords: "metric m3 3mm screw bolt shcs" },
  { number: "91251A102", title: "Socket Head Screw", subtitle: "M3 × 12 mm", kind: "screw", keywords: "metric m3 3mm screw bolt shcs" },
  { number: "91251A106", title: "Socket Head Screw", subtitle: "M3 × 16 mm", kind: "screw", keywords: "metric m3 3mm screw bolt shcs" },
  { number: "91251A146", title: "Socket Head Screw", subtitle: "M4 × 10 mm", kind: "screw", keywords: "metric m4 4mm 4 mm screw bolt shcs" },
  { number: "91251A148", title: "Socket Head Screw", subtitle: "M4 × 12 mm", kind: "screw", keywords: "metric m4 4mm 4 mm screw bolt shcs" },
  { number: "91251A152", title: "Socket Head Screw", subtitle: "M4 × 16 mm", kind: "screw", keywords: "metric m4 4mm 4 mm screw bolt shcs" },
  { number: "91251A154", title: "Socket Head Screw", subtitle: "M4 × 20 mm", kind: "screw", keywords: "metric m4 4mm 4 mm screw bolt shcs" },
  { number: "91251A194", title: "Socket Head Screw", subtitle: "M5 × 16 mm", kind: "screw", keywords: "metric m5 5mm screw bolt shcs" },
  { number: "91251A196", title: "Socket Head Screw", subtitle: "M5 × 20 mm", kind: "screw", keywords: "metric m5 5mm screw bolt shcs" },
  { number: "91251A268", title: "Socket Head Screw", subtitle: "M6 × 20 mm", kind: "screw", keywords: "metric m6 6mm screw bolt shcs" },
  { number: "91251A270", title: "Socket Head Screw", subtitle: "M6 × 25 mm", kind: "screw", keywords: "metric m6 6mm screw bolt shcs" },
  { number: "91292A126", title: "Socket Head Screw", subtitle: "#6-32 × 3/8 in", kind: "screw", keywords: "imperial #6 6-32 screw bolt shcs" },
  { number: "91292A144", title: "Socket Head Screw", subtitle: "#8-32 × 1/2 in", kind: "screw", keywords: "imperial #8 8-32 screw bolt shcs" },
  { number: "91290A194", title: "Socket Head Screw", subtitle: "#10-24 × 1/2 in", kind: "screw", keywords: "imperial #10 10-24 screw bolt shcs" },
  { number: "90592A085", title: "Hex Nut", subtitle: "M3", kind: "nut", keywords: "metric m3 3mm hex nut" },
  { number: "90592A013", title: "Hex Nut", subtitle: "M4", kind: "nut", keywords: "metric m4 4mm 4 mm hex nut" },
  { number: "90592A015", title: "Hex Nut", subtitle: "M5", kind: "nut", keywords: "metric m5 5mm hex nut" },
  { number: "90592A031", title: "Hex Nut", subtitle: "M6", kind: "nut", keywords: "metric m6 6mm hex nut" },
  { number: "92141A007", title: "Flat Washer", subtitle: "For M3", kind: "washer", keywords: "metric m3 3mm washer" },
  { number: "92141A009", title: "Flat Washer", subtitle: "For M4", kind: "washer", keywords: "metric m4 4mm 4 mm washer" },
  { number: "92141A011", title: "Flat Washer", subtitle: "For M5", kind: "washer", keywords: "metric m5 5mm washer" },
  { number: "92141A013", title: "Flat Washer", subtitle: "For M6", kind: "washer", keywords: "metric m6 6mm washer" },
  { number: "93475A250", title: "Flat Washer", subtitle: "#6 screw", kind: "washer", keywords: "imperial #6 washer" },
  { number: "7804K55", title: "Ball Bearing", subtitle: "608 · 8×22 mm", kind: "bearing", keywords: "608 skate bearing 8mm 22mm" },
  { number: "5972K91", title: "Ball Bearing", subtitle: "624 · 4×13 mm", kind: "bearing", keywords: "624 4mm 13mm bearing" },
  { number: "6384K33", title: "Ball Bearing", subtitle: "625 · 5×16 mm", kind: "bearing", keywords: "625 5mm 16mm bearing" },
];

export const QUICK_FAMILIES = [
  {
    id: "screws",
    title: "Socket head screws",
    kind: "screw",
    sizeLabel: "Size",
    lengthLabel: "Length",
    sizes: [
      { id: "m3", label: "M3", lengths: [
        { id: "8", label: "8 mm", number: "91251A100" },
        { id: "12", label: "12 mm", number: "91251A102" },
        { id: "16", label: "16 mm", number: "91251A106" },
      ] },
      { id: "m4", label: "M4 / 4 mm", lengths: [
        { id: "10", label: "10 mm", number: "91251A146" },
        { id: "12", label: "12 mm", number: "91251A148" },
        { id: "16", label: "16 mm", number: "91251A152" },
        { id: "20", label: "20 mm", number: "91251A154" },
      ] },
      { id: "m5", label: "M5", lengths: [
        { id: "16", label: "16 mm", number: "91251A194" },
        { id: "20", label: "20 mm", number: "91251A196" },
      ] },
      { id: "m6", label: "M6", lengths: [
        { id: "20", label: "20 mm", number: "91251A268" },
        { id: "25", label: "25 mm", number: "91251A270" },
      ] },
      { id: "6-32", label: "#6-32", lengths: [
        { id: "375", label: "3/8 in", number: "91292A126" },
      ] },
      { id: "8-32", label: "#8-32", lengths: [
        { id: "500", label: "1/2 in", number: "91292A144" },
      ] },
      { id: "10-24", label: "#10-24", lengths: [
        { id: "500", label: "1/2 in", number: "91290A194" },
      ] },
    ],
  },
  {
    id: "nuts",
    title: "Hex nuts",
    kind: "nut",
    sizeLabel: "Thread",
    sizes: [
      { id: "m3", label: "M3", number: "90592A085" },
      { id: "m4", label: "M4 / 4 mm", number: "90592A013" },
      { id: "m5", label: "M5", number: "90592A015" },
      { id: "m6", label: "M6", number: "90592A031" },
    ],
  },
  {
    id: "washers",
    title: "Flat washers",
    kind: "washer",
    sizeLabel: "For screw",
    sizes: [
      { id: "m3", label: "M3", number: "92141A007" },
      { id: "m4", label: "M4 / 4 mm", number: "92141A009" },
      { id: "m5", label: "M5", number: "92141A011" },
      { id: "m6", label: "M6", number: "92141A013" },
      { id: "6", label: "#6", number: "93475A250" },
    ],
  },
  {
    id: "bearings",
    title: "Ball bearings",
    kind: "bearing",
    sizeLabel: "Size",
    sizes: [
      { id: "608", label: "608 · 8×22 mm", number: "7804K55" },
      { id: "624", label: "624 · 4×13 mm", number: "5972K91" },
      { id: "625", label: "625 · 5×16 mm", number: "6384K33" },
    ],
  },
];

export function normalizeSuggestQuery(raw) {
  let text = String(raw || "").toLowerCase().replace(/[^a-z0-9#.\-×x/ ]+/g, " ");
  for (const [from, to] of ALIAS) {
    text = text.replace(new RegExp(`\\b${from}\\b`, "g"), to);
  }
  return text.replace(/\s+/g, " ").trim();
}

function tokens(raw) {
  return normalizeSuggestQuery(raw).split(" ").filter(Boolean);
}

function editDistance(a, b) {
  const left = String(a || "");
  const right = String(b || "");
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > 2) return 9;
  const rows = Array.from({ length: left.length + 1 }, (_, i) => {
    const row = new Array(right.length + 1);
    row[0] = i;
    return row;
  });
  for (let j = 0; j <= right.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
    }
  }
  return rows[left.length][right.length];
}

function haystack(row) {
  return [row.number, row.title, row.subtitle, row.kind, row.keywords].filter(Boolean).join(" ").toLowerCase();
}

export function scoreMcMasterSuggestion(row, query) {
  const q = normalizeSuggestQuery(query);
  if (!q) return 0;
  const pn = String(row.number || "").toUpperCase();
  const compact = q.replace(/\s+/g, "").toUpperCase();
  if (pn.startsWith(compact) && compact.length >= 3) return 200 + compact.length;
  const blob = haystack(row);
  let score = 0;
  for (const tok of tokens(q)) {
    if (blob.includes(tok)) {
      score += tok.length >= 3 ? 12 : 6;
      continue;
    }
    const words = blob.split(/[^a-z0-9#]+/);
    if (words.some((w) => w.startsWith(tok) || (tok.length >= 3 && editDistance(tok, w) <= 1))) {
      score += 8;
    }
  }
  if (/\b4\b/.test(q) && /\bm4\b|4 mm|4mm/.test(blob)) score += 10;
  return score;
}

export function suggestMcMasterParts(query, { limit = 8, catalog = MCMASTER_SUGGEST_CATALOG } = {}) {
  const q = String(query || "").trim();
  if (q.length < 2) return [];
  return [...catalog]
    .map((row) => ({ ...row, score: scoreMcMasterSuggestion(row, q) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || String(a.number).localeCompare(String(b.number)))
    .slice(0, limit);
}

export function catalogRowByNumber(number, catalog = MCMASTER_SUGGEST_CATALOG) {
  const pn = String(number || "").toUpperCase();
  return catalog.find((row) => String(row.number).toUpperCase() === pn) || null;
}

export function familySelection(family, sizeId, lengthId) {
  if (!family) return null;
  const size = (family.sizes || []).find((s) => s.id === sizeId) || family.sizes?.[0];
  if (!size) return null;
  const length = (size.lengths || []).find((l) => l.id === lengthId) || size.lengths?.[0];
  const number = length?.number || size.number;
  const row = catalogRowByNumber(number);
  return {
    number,
    title: row?.title || family.title,
    subtitle: [size.label, length?.label].filter(Boolean).join(" · ") || row?.subtitle || "",
    kind: family.kind,
    sizeId: size.id,
    lengthId: length?.id || "",
  };
}
