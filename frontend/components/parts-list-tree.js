export const CART_ICON = '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M1 3h3l2 10h10l2-7H5M7 13l-1 3h11"/><circle cx="7" cy="18" r=".8"/><circle cx="16" cy="18" r=".8"/></svg>';

/** A visual parent only: source paths and project files are never moved. */
export function groupPartsList(groups, lists = []) {
  const old = groups.find(row => row.virtual_folder && row.folder === "McMaster");
  if (!old && !lists.length) return groups;
  const folder = (name, tab, children) => ({ id: `folder:Parts List/${name}`, name: `Parts List/${name}`,
    label: name, children_label: name, virtual_folder: true, parts_tab: tab, children });
  const children = [folder("Electronics", "electronics", lists.filter(r => r.parts_tab === "electronics")),
    folder("McMaster", "mcmaster", [...lists.filter(r => r.parts_tab === "mcmaster"), ...(old?.children || [])])];
  const mechanical = lists.filter(r => r.parts_tab === "mechanical");
  if (mechanical.length) children.push(folder("Mechanical", "mechanical", mechanical));
  return [{ id: "folder:Parts List", name: "Parts List", label: "Parts List", children_label: "Parts List",
    virtual_folder: true, parts_tab: "home", children }, ...groups.filter(row => row !== old)];
}

export function openPartsList(tab = "home") {
  document.dispatchEvent(new CustomEvent("render:open-parts", { detail: { tab } }));
}

export function syncPartsCartShortcut(available) {
  const title = document.getElementById("viewport-browser-title");
  if (!title) return;
  let button = document.getElementById("assist-parts-launch");
  if (!button) {
    button = document.createElement("button"); button.id = "assist-parts-launch";
    button.className = "browser-parts-cart"; button.type = "button";
    button.title = "Open Parts List shopping cart"; button.setAttribute("aria-label", button.title);
    button.innerHTML = CART_ICON; button.onclick = () => openPartsList(); title.after(button);
  }
  button.hidden = !available;
}
