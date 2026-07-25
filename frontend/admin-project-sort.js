/**
 * Sort helpers for Admin → Recent Projects.
 */

export const PROJECT_SORT_LS = "render3d:adminProjectSort:v1";

export const PROJECT_SORT_OPTIONS = [
  { value: "date-desc", label: "Date · newest" },
  { value: "date-asc", label: "Date · oldest" },
  { value: "name-asc", label: "Name · A–Z" },
  { value: "name-desc", label: "Name · Z–A" },
  { value: "person-asc", label: "Person · A–Z" },
  { value: "person-desc", label: "Person · Z–A" },
  { value: "cost-desc", label: "Cost · high→low" },
  { value: "files-desc", label: "Files · most" },
];

const VALID = new Set(PROJECT_SORT_OPTIONS.map((o) => o.value));

export function loadProjectSortMode() {
  try {
    const v = localStorage.getItem(PROJECT_SORT_LS) || "";
    return VALID.has(v) ? v : "date-desc";
  } catch {
    return "date-desc";
  }
}

export function saveProjectSortMode(mode) {
  try {
    localStorage.setItem(PROJECT_SORT_LS, VALID.has(mode) ? mode : "date-desc");
  } catch {
    /* ignore */
  }
}

function ownerKey(project = {}) {
  return String(project.owner_name || project.owner_email || "Unknown owner").trim().toLowerCase();
}

function nameKey(project = {}) {
  return String(project.name || project.id || "").trim().toLowerCase();
}

function dateKey(project = {}) {
  const t = Date.parse(project.updated_at || project.created_at || "");
  return Number.isFinite(t) ? t : 0;
}

function costKey(project = {}) {
  const n = Number(project.total_cost_usd);
  return Number.isFinite(n) ? n : 0;
}

function filesKey(project = {}) {
  const n = Number(project.file_count);
  return Number.isFinite(n) ? n : 0;
}

function cmpStr(a, b) {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

/**
 * @param {object[]} projects
 * @param {string} mode
 * @returns {object[]}
 */
export function sortProjects(projects = [], mode = "date-desc") {
  const list = [...projects];
  const m = VALID.has(mode) ? mode : "date-desc";
  list.sort((a, b) => {
    switch (m) {
      case "date-asc":
        return dateKey(a) - dateKey(b) || cmpStr(nameKey(a), nameKey(b));
      case "name-asc":
        return cmpStr(nameKey(a), nameKey(b)) || dateKey(b) - dateKey(a);
      case "name-desc":
        return cmpStr(nameKey(b), nameKey(a)) || dateKey(b) - dateKey(a);
      case "person-asc":
        return cmpStr(ownerKey(a), ownerKey(b)) || cmpStr(nameKey(a), nameKey(b));
      case "person-desc":
        return cmpStr(ownerKey(b), ownerKey(a)) || cmpStr(nameKey(a), nameKey(b));
      case "cost-desc":
        return costKey(b) - costKey(a) || dateKey(b) - dateKey(a);
      case "files-desc":
        return filesKey(b) - filesKey(a) || dateKey(b) - dateKey(a);
      case "date-desc":
      default:
        return dateKey(b) - dateKey(a) || cmpStr(nameKey(a), nameKey(b));
    }
  });
  return list;
}

export function projectSortSelectHtml(selected = "date-desc") {
  const current = VALID.has(selected) ? selected : "date-desc";
  const options = PROJECT_SORT_OPTIONS.map(
    (opt) =>
      `<option value="${opt.value}"${opt.value === current ? " selected" : ""}>${opt.label}</option>`,
  ).join("");
  return `
    <label class="admin-project-sort">
      <span class="admin-project-sort-label">Sort</span>
      <select id="admin-project-sort" aria-label="Sort recent projects">${options}</select>
    </label>
  `;
}
