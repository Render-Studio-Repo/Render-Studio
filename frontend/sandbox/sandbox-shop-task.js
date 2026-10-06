/**
 * Shop bench: bots work silently on Sam's real files.
 * They only stand up and alert (one speaker) when something is found.
 * Harness can retune the setup live. Token shoptask1.
 */

import { forceOneSpeaker } from "./tts-mutex.js?v=cfgov1&singlevoice1";

export const SHOPTASK1_TOKEN = "shoptask1";
export const PRINTABLE_RE = /\.(stl|3mf|obj|step|stp|glb|gltf|ply)$/i;
export const SLICER_RE = /\.(stl|3mf)$/i;

export function fileLabel(f) {
  if (typeof f === "string") return f.replace(/^\/+/, "");
  return String(f?.name || f?.filename || f?.viewer_filename || f?.path || f?.file || "").replace(/^\/+/, "");
}

/**
 * Collect Studio project files from a view=open (or lite) payload.
 * Union of files + browser bags — do not stop at the first empty array.
 */
export function collectStudioProjectFiles(data = {}) {
  const seen = new Set();
  const out = [];
  const push = (item, bag) => {
    const name = fileLabel(item);
    if (!name || seen.has(name)) return;
    seen.add(name);
    const rec = typeof item === "string" ? { name } : { ...item, name };
    rec.bag = bag;
    rec.size = Number(item?.size || item?.bytes || rec.size) || 0;
    rec.kind = String(rec.kind || rec.format || name.split(".").pop() || "").toLowerCase();
    out.push(rec);
  };
  const browser = data.browser || {};
  const bags = [
    ["files", data.files],
    ["models", data.models],
    ["components", browser.components],
    ["references", browser.references],
    ["renders", browser.renders],
    ["drawings", browser.drawings],
    ["robots", browser.robots],
    ["sketches", browser.sketches],
    ["wiring", browser.wiring],
    ["cad_files", data.cad_files],
    ["tree", data.tree],
    ["entries", data.timeline?.entries || data.entries],
  ];
  for (const [bag, list] of bags) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (item && typeof item === "object" && (item.filename || item.file) && !item.name) {
        push({ ...item, name: item.filename || item.file }, bag);
      } else {
        push(item, bag);
      }
    }
  }
  if (data.latest_file) push(data.latest_file, "latest");
  return out;
}

export function pickBenchFiles(files = [], { pick = [], limit = 3 } = {}) {
  const wanted = new Set((pick || []).map((n) => String(n).trim()).filter(Boolean));
  if (wanted.size) {
    return files.filter((f) => wanted.has(fileLabel(f)));
  }
  const meshes = files.filter((f) => PRINTABLE_RE.test(fileLabel(f)));
  return (meshes.length ? meshes : files).slice(0, Math.max(1, Number(limit) || 3));
}

/** Heuristic print-readiness — no second physics loop, no MCP write. */
export function shopPrintFindings(files = [], setup = {}) {
  const chosen = pickBenchFiles(files, setup);
  const findings = [];
  if (!chosen.length) {
    findings.push({
      level: "alert",
      file: "",
      text: "Bench is empty — no models to check for print.",
    });
    return { chosen, findings, alerts: findings, token: SHOPTASK1_TOKEN };
  }
  for (const f of chosen) {
    const n = fileLabel(f);
    if (!PRINTABLE_RE.test(n)) {
      findings.push({ level: "alert", file: n, text: `${n} is not a mesh — cannot confirm print.` });
      continue;
    }
    if (!SLICER_RE.test(n)) {
      findings.push({
        level: "alert",
        file: n,
        text: `${n} is ${f.kind || "cad"} — export STL/3MF before print.`,
      });
    }
    if (f.size > 80_000_000) {
      findings.push({
        level: "alert",
        file: n,
        text: `${n} is ${(f.size / 1_000_000).toFixed(0)} MB — check walls before slicing.`,
      });
    }
    if (/\.glb$/i.test(n) && f.size < 2048) {
      findings.push({ level: "alert", file: n, text: `${n} looks empty/tiny — regenerate before print.` });
    }
  }
  if (!findings.some((x) => x.level === "alert")) {
    findings.push({
      level: "ok",
      file: "",
      text: `${chosen.length} model(s) look printable from names/sizes — no standup.`,
    });
  }
  return {
    chosen,
    findings,
    alerts: findings.filter((x) => x.level === "alert"),
    token: SHOPTASK1_TOKEN,
  };
}

export function shopStatusLine(result) {
  const n = result?.chosen?.length || 0;
  const alerts = result?.alerts?.length || 0;
  if (!n) return "Shop idle · no files on the bench";
  if (!alerts) return `Shop quiet · ${n} model(s) under review · nothing to bother Sam`;
  return `Shop alert · ${alerts} finding(s) — one speaker`;
}

/**
 * Silent crew. Only Astra speaks when alerts exist (forceOneSpeaker).
 */
export function createShopCrew({ speak } = {}) {
  let setup = { task: "Analyze models for print", pick: [], limit: 3 };
  let last = null;

  const run = async (files, next = {}) => {
    setup = { ...setup, ...next };
    if (Array.isArray(next.pick)) setup.pick = next.pick;
    last = shopPrintFindings(files, setup);
    const line = shopStatusLine(last);
    if (last.alerts.length && typeof speak === "function") {
      forceOneSpeaker("shop-alert");
      const detail = last.alerts.slice(0, 3).map((a) => a.text).join(" ");
      await speak("astra", `Shop check. ${detail}`.slice(0, 280), { force: true, topic: "shop-alert" });
    }
    try {
      globalThis.window?.dispatchEvent?.(new CustomEvent("render3d-sandbox-shop", {
        detail: { setup, result: last, token: SHOPTASK1_TOKEN },
      }));
    } catch { /* optional */ }
    return { ...last, line, setup };
  };

  return {
    token: SHOPTASK1_TOKEN,
    getSetup: () => ({ ...setup }),
    last: () => last,
    adjust: (partial) => { setup = { ...setup, ...partial }; return setup; },
    run,
  };
}
