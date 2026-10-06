export const PARTS_TAB = "__parts_list__";

export function createPartsListSurface({docTabs, mainColumnEl, getProjectId}) {
  const node = document.createElement("section"); node.className = "parts-list-viewer hidden"; node.hidden = true;
  node.setAttribute("aria-label", "Parts List shopping cart");
  mainColumnEl.append(node);
  let project = null;
  return {
    open() {
      project = getProjectId();
      node.innerHTML = '<header><h2>Parts List</h2><span>Project components, sources and approved replacements</span><button type="button" aria-label="Return to viewport">↗ Viewport</button></header><div class="assist-content"></div>';
      node.querySelector("button").onclick = () => docTabs.deactivate({notify:true});
      docTabs.upsert({id: PARTS_TAB, label: "Parts List", kind: "parts"});
      docTabs.setActive(PARTS_TAB); node.hidden = false; node.classList.remove("hidden");
      return {node: {close: () => docTabs.deactivate({notify:true})}, content: node.querySelector(".assist-content")};
    },
    activate() {
      if (project !== getProjectId() || !node.children.length) {
        document.dispatchEvent(new CustomEvent("render:open-parts", {detail:{tab:"home"}})); return;
      }
      node.hidden = false; node.classList.remove("hidden");
    },
    hide() {node.hidden = true; node.classList.add("hidden");},
    close() {this.hide(); docTabs.remove(PARTS_TAB);},
  };
}
