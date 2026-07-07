/** Fusion 360-style project browser tree (components, sketches, wiring, drawings). */

import { recognizePart } from "./part-catalog.js?v=20260617-part-drag";
import { setExplorerDragData } from "./explorer-drag.js?v=20260618-multi-drag";

const SECTIONS = [
  { id: "components", label: "Components", icon: "cube" },
  { id: "drawings", label: "DXF Drawings", icon: "drawing" },
  { id: "sketches", label: "Sketches", icon: "sketch" },
  { id: "wiring", label: "Wiring", icon: "wire" },
];

function iconSvg(type) {
  if (type === "cube") {
    return '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M8 1 1 4.5v7L8 15l7-3.5v-7L8 1Zm0 1.3 5.5 2.75v5.9L8 13.7l-5.5-2.75v-5.9L8 2.3Z"/></svg>';
  }
  if (type === "drawing") {
    return '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.2" d="M3 2.5h10v11H3z"/><path fill="none" stroke="currentColor" stroke-width="1.2" d="M5 6h6M5 9h4"/></svg>';
  }
  if (type === "sketch") {
    return '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.2" d="M2 12 6 4l4 3 4-5"/></svg>';
  }
  return '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.2" d="M2 8h4l2-3 2 6 2-3h2"/></svg>';
}

function eyeSvg(hidden) {
  return hidden
    ? `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" d="M2 2l12 12M6.3 6.3A2.7 2.7 0 0 0 8 10.7c.7 0 1.3-.2 1.8-.7M4.8 4.1C2.9 4.9 1.3 6.4.3 8c1.7 2.6 4.5 5 7.7 5 1.2 0 2.3-.3 3.3-.8M7.4 3.1 8 3c3.5 0 6.3 2.4 8 5-.4.7-.9 1.3-1.5 1.9"/>
      </svg>`
    : `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
        <path fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" d="M.5 8C2.2 5.4 4.8 3 8 3s5.8 2.4 7.5 5c-1.7 2.6-4.3 5-7.5 5S2.2 10.6.5 8Z"/>
        <circle cx="8" cy="8" r="2.7" fill="none" stroke="currentColor" stroke-width="1.35"/>
      </svg>`;
}

function displayName(entry) {
  const formatLabel = (value = "") => String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
  if (entry.label) return formatLabel(entry.label);
  if (entry.format === "program") {
    return formatLabel(entry.stem || entry.name.replace(/\.program\.json$/i, ""));
  }
  if (entry.format === "wiring") return entry.name;
  const stem = entry.stem || entry.name.replace(/\.[^.]+$/, "");
  return formatLabel(stem);
}

export function createProjectTree(options = {}) {
  const {
    container,
    onOpenComponent,
    onOpenDrawing,
    onOpenSketch,
    onEditSketch,
    onOpenWiring,
    onToggleVisibility,
    onExport,
    onRename,
    onDelete,
    onDragComponent,
    onOpenProfile,
    getPartProfile,
    getProjectId,
  } = options;

  let partProfiles = new Map();
  const hidden = new Set();
  let browser = { components: [], drawings: [], sketches: [], wiring: [] };
  let selectedName = null;
  const selectedBrowserKeys = new Set();
  /** @type {Map<string, { entry: object, sectionId: string }>} */
  const browserEntryCache = new Map();
  let loading = false;
  let expanded = { components: true, drawings: true, sketches: true, wiring: true };
  const childGroupsExpanded = new Set();
  const childGroupsInitialized = new Set();
  let suppressBrowserClick = false;

  function clearBrowserClickSuppress() {
    window.setTimeout(() => {
      suppressBrowserClick = false;
    }, 0);
  }

  function renderLoading() {
    if (!container) return;
    container.innerHTML = "";
    container.classList.add("design-browser");
    const wrap = document.createElement("div");
    wrap.className = "design-browser-loading";
    wrap.innerHTML =
      '<span class="proj-loading-spinner" aria-hidden="true"></span>' +
      "<span>Loading project…</span>";
    container.appendChild(wrap);
  }

  function render() {
    if (!container) return;
    if (loading) {
      renderLoading();
      return;
    }
    browserEntryCache.clear();
    container.innerHTML = "";
    container.classList.add("design-browser");

    const header = document.createElement("div");
    header.className = "design-browser-header";
    header.innerHTML = "<span>BROWSER</span>";
    container.appendChild(header);

    for (const section of SECTIONS) {
      const items = browser[section.id] || [];
      const sectionEl = document.createElement("div");
      sectionEl.className = "browser-section";
      sectionEl.dataset.section = section.id;

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "browser-section-toggle";
      toggle.setAttribute("aria-expanded", expanded[section.id] ? "true" : "false");
      toggle.innerHTML = `
        <span class="browser-chevron">${expanded[section.id] ? "▾" : "▸"}</span>
        ${iconSvg(section.icon)}
        <span class="browser-section-label">${section.label}</span>
        <span class="browser-section-count">${items.length}</span>
      `;
      toggle.addEventListener("click", () => {
        expanded[section.id] = !expanded[section.id];
        render();
      });
      sectionEl.appendChild(toggle);

      if (expanded[section.id]) {
        const list = document.createElement("ul");
        list.className = "browser-item-list";
        if (!items.length) {
          const empty = document.createElement("li");
          empty.className = "browser-empty-item muted small";
          empty.textContent =
            section.id === "components"
              ? "Drop STEP or mesh files in the viewport"
              : section.id === "drawings"
                ? "Drop DXF files in the viewport"
                : section.id === "sketches"
                  ? "No sketches — Finish Sketch to save one"
                  : "Open Wiring Simulator to design a circuit";
          list.appendChild(empty);
        }
        for (const entry of items) {
          list.appendChild(renderItem(entry, section.id));
          if (section.id === "components" && entry.children?.length) {
            list.appendChild(renderChildGroup(entry, section.id));
          }
        }
        sectionEl.appendChild(list);
      }
      container.appendChild(sectionEl);
    }
  }

  function itemKey(entry, sectionId) {
    if (sectionId === "sketches") return entry.stem || entry.id || entry.name;
    return entry.name;
  }

  function browserSelectionKey(sectionId, entry) {
    const id =
      sectionId === "sketches"
        ? (entry.filename || entry.name || entry.id || entry.stem)
        : (entry.name || entry.id || entry.stem);
    return `${sectionId}:${id}`;
  }

  function componentPayload(entry, sectionId, { stem, stored, recognized, wiringType } = {}) {
    const safeStem = stem || entry.stem || entry.name.replace(/\.[^.]+$/, "");
    const safeStored = stored || (sectionId === "components" ? getPartProfile?.(safeStem) || partProfiles.get(safeStem) || null : null);
    const safeRecognized = recognized || (sectionId === "components" ? recognizePart(safeStem) : null);
    const safeWiringType = wiringType || safeStored?.wiring_type || safeRecognized?.wiringType || null;
    const pid = getProjectId?.() || null;
    if (sectionId === "components") {
      return {
        type: "component",
        projectId: pid,
        name: entry.name,
        filename: entry.source_filename || entry.filename || entry.name,
        stem: safeStem,
        format: entry.format,
        viewer_filename: entry.viewer_filename,
        body_index: Number.isInteger(entry.body_index) ? entry.body_index : null,
        body_name: entry.body_name || null,
        component_index: Number.isInteger(entry.component_index) ? entry.component_index : null,
        component_name: entry.component_name || entry.node_name || null,
        virtual_component: !!entry.virtual_component,
        virtual_body: !!entry.virtual_body,
        label: safeStored?.label || displayName(entry),
        wiringType: safeWiringType,
        part: safeStored
          ? { kind: safeStored.kind, label: safeStored.label, datasheet: safeStored.datasheet }
          : safeRecognized
          ? {
              kind: safeRecognized.kind,
              label: safeRecognized.label,
              partNumber: safeRecognized.partNumber,
              datasheet: safeRecognized.datasheet,
            }
          : null,
        profile: safeStored || null,
      };
    }
    const filename = entry.filename || entry.name;
    return {
      type: sectionId === "sketches" ? "sketch" : "wiring",
      projectId: pid,
      name: entry.name,
      filename,
      stem: safeStem,
      format: entry.format || sectionId,
      label: displayName(entry),
    };
  }

  function selectedBrowserPayloads(fallbackPayload) {
    const selected = [];
    for (const key of selectedBrowserKeys) {
      const cached = browserEntryCache.get(key);
      if (!cached) continue;
      const { entry, sectionId } = cached;
      const stem = entry.stem || entry.name?.replace(/\.[^.]+$/, "");
      const stored = sectionId === "components" ? (getPartProfile?.(stem) || partProfiles.get(stem) || null) : null;
      const recognized = sectionId === "components" ? recognizePart(stem) : null;
      const wiringType = stored?.wiring_type || recognized?.wiringType || null;
      selected.push(componentPayload(entry, sectionId, { stem, stored, recognized, wiringType }));
    }
    if (!selected.length && fallbackPayload) return [fallbackPayload];
    return selected;
  }

  function renderChildGroup(parentEntry, sectionId) {
    const li = document.createElement("li");
    li.className = "browser-child-group";
    const groupKey = `${sectionId}:${parentEntry.name}:children`;
    if (!childGroupsInitialized.has(groupKey)) {
      childGroupsInitialized.add(groupKey);
      childGroupsExpanded.add(groupKey);
    }
    const isOpen = childGroupsExpanded.has(groupKey);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "browser-child-group-toggle";
    btn.innerHTML = `
      <span class="browser-chevron">${isOpen ? "▾" : "▸"}</span>
      <span class="browser-section-label">${parentEntry.children_label || "Parts"}</span>
      <span class="browser-section-count">${parentEntry.children.length}</span>
    `;
    btn.addEventListener("click", () => {
      if (childGroupsExpanded.has(groupKey)) childGroupsExpanded.delete(groupKey);
      else childGroupsExpanded.add(groupKey);
      render();
    });
    li.appendChild(btn);
    if (isOpen) {
      const nested = document.createElement("ul");
      nested.className = "browser-item-list browser-item-list--children";
      for (const child of parentEntry.children || []) {
        nested.appendChild(renderItem(child, sectionId, { child: true }));
      }
      li.appendChild(nested);
    }
    return li;
  }

  function renderItem(entry, sectionId, { child = false } = {}) {
    const li = document.createElement("li");
    li.className = "browser-item";
    if (child) li.classList.add("browser-item--child");
    if (sectionId === "drawings") li.classList.add("browser-item--drawing");
    const selectionKey = browserSelectionKey(sectionId, entry);
    browserEntryCache.set(selectionKey, { entry, sectionId });
    if (entry.name === selectedName || entry.id === selectedName) {
      li.classList.add("active");
    }
    if (selectedBrowserKeys.has(selectionKey)) {
      li.classList.add("browser-item--selected");
    }
    li.dataset.filename = entry.name;
    li.dataset.section = sectionId;
    let recognized = null;
    let stored = null;
    if (sectionId === "components") {
      const stem = entry.stem || entry.name.replace(/\.[^.]+$/, "");
      recognized = recognizePart(stem);
      stored = (getPartProfile?.(stem)) || partProfiles.get(stem) || null;
      // A saved/sourced profile is authoritative over the filename heuristic.
      const wiringType = stored?.wiring_type || recognized?.wiringType || null;
      const kindLabel = stored?.kind || recognized?.kind || null;
      const sourced = !!stored?.source;
      li.classList.add("browser-item--draggable");
      li.draggable = true;
      li.title = entry.virtual_component
        ? `${displayName(entry)} — component inside ${entry.source_filename || entry.parent_filename || entry.viewer_filename || entry.name}. Click to select this component in the viewport.`
        : entry.virtual_body
        ? `${displayName(entry)} — generated body inside ${entry.source_filename || entry.parent_filename || entry.viewer_filename || entry.name}. Drag into the AI prompt to target this body.`
        : sourced
        ? `${entry.name} — sourced as "${stored.label || kindLabel}". Drag into the Wiring Simulator to drop the exact part with its pins & stats.`
        : kindLabel
        ? `${entry.name} — recognized as ${kindLabel}. Click the ⓘ profile to source it online. Drag into the AI prompt or Wiring Simulator.`
        : `${entry.name} — click the ⓘ profile to identify & source this part. Drag into the AI prompt or Wiring Simulator.`;
      li.addEventListener("dragstart", (e) => {
        suppressBrowserClick = true;
        if (!selectedBrowserKeys.has(selectionKey)) {
          selectedBrowserKeys.clear();
          selectedBrowserKeys.add(selectionKey);
          li.classList.add("browser-item--selected");
        }
        const payload = componentPayload(entry, sectionId, { stem, stored, recognized, wiringType });
        setExplorerDragData(e, selectedBrowserPayloads(payload));
        onDragComponent?.(entry);
      });
      li.addEventListener("dragend", clearBrowserClickSuppress);
    }

    const visKey = itemKey(entry, sectionId);
    const vis = document.createElement("button");
    vis.type = "button";
    vis.className = "browser-vis-btn";
    const isHidden = hidden.has(visKey);
    li.classList.toggle("hidden-component", isHidden);
    vis.classList.toggle("is-hidden", isHidden);
    vis.title = isHidden ? "Show component" : "Hide component";
    vis.setAttribute("aria-label", isHidden ? "Show component" : "Hide component");
    vis.setAttribute("aria-pressed", isHidden ? "true" : "false");
    vis.innerHTML = eyeSvg(isHidden);
    vis.addEventListener("click", (e) => {
      e.stopPropagation();
      if (hidden.has(visKey)) hidden.delete(visKey);
      else hidden.add(visKey);
      onToggleVisibility?.(entry, !hidden.has(visKey), sectionId);
      render();
    });

    const body = document.createElement("button");
    body.type = "button";
    body.className = "browser-item-body";
    body.innerHTML = `<span class="browser-item-name">${displayName(entry)}</span>`;
    body.title = sectionId === "sketches" ? `${entry.name} — double-click to edit` : entry.name;
    body.addEventListener("click", (e) => {
      if (suppressBrowserClick) return;
      if (sectionId === "components" && (e.shiftKey || e.metaKey || e.ctrlKey)) {
        if (selectedBrowserKeys.has(selectionKey)) selectedBrowserKeys.delete(selectionKey);
        else selectedBrowserKeys.add(selectionKey);
        render();
        return;
      }
      selectedBrowserKeys.clear();
      selectedName = entry.name;
      if (sectionId === "components" && hidden.has(visKey)) {
        render();
        return;
      }
      if (sectionId === "components") onOpenComponent?.(entry);
      else if (sectionId === "drawings") onOpenDrawing?.(entry);
      else if (sectionId === "sketches") onOpenSketch?.(entry);
      else onOpenWiring?.(entry);
      render();
    });
    if (sectionId === "sketches") {
      body.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        selectedName = entry.name;
        onEditSketch?.(entry);
        render();
      });
    }

    const actions = document.createElement("div");
    actions.className = "browser-item-actions";
    if (sectionId === "components") {
      actions.classList.add("browser-item-actions--profile-visible");
      if (entry.virtual_body || entry.virtual_component) {
        actions.classList.remove("browser-item-actions--profile-visible");
      } else {
        const prof = document.createElement("button");
        prof.type = "button";
        prof.className = "browser-action-btn browser-action-profile";
        prof.textContent = "ⓘ";
        prof.title = "View component ID, tags, part profile, and 3D preview";
        prof.addEventListener("click", (e) => {
          e.stopPropagation();
          onOpenProfile?.(entry);
        });
        const exp = document.createElement("button");
        exp.type = "button";
        exp.className = "browser-action-btn";
        exp.textContent = "Export";
        exp.disabled = isHidden;
        exp.title = isHidden ? "Show this component before exporting it" : "Export component";
        exp.addEventListener("click", (e) => {
          e.stopPropagation();
          if (isHidden) return;
          onExport?.(entry, exp);
        });
        const ren = document.createElement("button");
        ren.type = "button";
        ren.className = "browser-action-btn";
        ren.textContent = "Rename";
        ren.addEventListener("click", (e) => {
          e.stopPropagation();
          onRename?.(entry);
        });
        const del = document.createElement("button");
        del.type = "button";
        del.className = "browser-action-btn danger";
        del.textContent = "Delete";
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          onDelete?.(entry);
        });
        actions.append(prof, exp, ren, del);
      }
    } else if (sectionId === "drawings") {
      const ren = document.createElement("button");
      ren.type = "button";
      ren.className = "browser-action-btn";
      ren.textContent = "Rename";
      ren.addEventListener("click", (e) => {
        e.stopPropagation();
        onRename?.(entry);
      });
      const del = document.createElement("button");
      del.type = "button";
      del.className = "browser-action-btn danger";
      del.textContent = "Delete";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        onDelete?.(entry);
      });
      actions.append(ren, del);
    }

    if (sectionId === "drawings") {
      li.append(body, actions);
    } else {
      li.append(vis, body, actions);
    }
    return li;
  }

  return {
    render(data = browser) {
      loading = false;
      browser = {
        components: data.components || [],
        drawings: data.drawings || [],
        sketches: data.sketches || [],
        wiring: data.wiring || [],
      };
      render();
    },
    setLoading(on) {
      const next = !!on;
      if (loading === next) return;
      loading = next;
      render();
    },
    setSelected(name) {
      selectedName = name;
      selectedBrowserKeys.clear();
      render();
    },
    setSelectedMany(names = []) {
      selectedBrowserKeys.clear();
      const orderedNames = [...new Set((names || []).filter(Boolean).map(String))];
      selectedName = orderedNames[0] || null;
      for (const name of orderedNames) {
        const entry = (browser.components || []).find((item) => item?.name === name || item?.viewer_filename === name);
        if (entry) selectedBrowserKeys.add(browserSelectionKey("components", entry));
      }
      render();
    },
    setPartProfiles(map) {
      partProfiles = map instanceof Map ? map : new Map(Object.entries(map || {}));
      render();
    },
    ensureVisible(name) {
      const key = String(name || "");
      if (!key || !hidden.has(key)) return false;
      hidden.delete(key);
      render();
      return true;
    },
    getHidden() {
      return new Set(hidden);
    },
    getComponents() {
      return [...(browser.components || [])];
    },
    isHidden(name) {
      return hidden.has(name);
    },
    setHidden(names = []) {
      hidden.clear();
      for (const name of names) {
        if (name) hidden.add(String(name));
      }
      render();
    },
  };
}
