#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const mapPath = join(root, "ai-context/feature-map.json");
const receiptDir = join(root, "ai-context/receipts");
const ZERO_SHA = /^0+$/;

export function readFeatureMap(path = mapPath) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (data.version !== 1 || !Array.isArray(data.features)) throw new Error("Unsupported feature map.");
  return data;
}

function normalizePath(path) {
  const absolute = resolve(root, path);
  return relative(root, absolute).replaceAll("\\", "/");
}

export function pathMatchesFeature(path, feature) {
  const candidate = normalizePath(path);
  return (feature.paths || []).some((owned) => {
    const rule = String(owned || "").replaceAll("\\", "/");
    return rule.endsWith("/") ? candidate.startsWith(rule) : candidate === rule;
  });
}

export function impactedFeatures(featureMap, paths, { all = false } = {}) {
  if (all) return featureMap.features.filter((feature) => feature.lock === "on");
  return featureMap.features.filter((feature) =>
    feature.lock === "on" && paths.some((path) => pathMatchesFeature(path, feature)));
}

export function unmappedPaths(featureMap, paths) {
  return paths
    .map(normalizePath)
    .filter((path) => !featureMap.features.some((feature) => pathMatchesFeature(path, feature)));
}

export function receiptExists(receiptId) {
  if (!receiptId) return false;
  if (existsSync(join(receiptDir, `${receiptId}.json`))) return true;
  const legacy = join(root, "frontend/sandbox/sandbox-sessions/knowledge/receipts.jsonl");
  if (!existsSync(legacy)) return false;
  return readFileSync(legacy, "utf8")
    .split("\n")
    .some((line) => line.includes(`\"receipt_id\":\"${receiptId}\"`) || line.includes(`\"receipt_id\": \"${receiptId}\"`));
}

export function auditFeature(feature) {
  const errors = [];
  if (!feature.id) errors.push("missing feature id");
  if (feature.lock !== "on") errors.push("feature is not locked on");
  if (!feature.receipt_ids?.length) errors.push("missing receipt id");
  for (const id of feature.receipt_ids || []) {
    if (!receiptExists(id)) errors.push(`receipt not found: ${id}`);
  }
  if (!(feature.checks || []).some((check) => check.mandatory && Array.isArray(check.argv) && check.argv.length)) {
    errors.push("missing mandatory executable check");
  }
  for (const interaction of feature.interaction_checks || []) {
    const label = interaction.id || "unnamed interaction";
    if (!interaction.selector) errors.push(`${label}: missing interaction selector`);
    if (!interaction.event) errors.push(`${label}: missing interaction event`);
    if (!interaction.expected) errors.push(`${label}: missing expected result`);
    if (!interaction.test) {
      errors.push(`${label}: missing interaction test`);
      continue;
    }
    if (!(feature.paths || []).includes(interaction.test)) {
      errors.push(`${label}: interaction test is not owned by feature: ${interaction.test}`);
    }
    const executable = (feature.checks || []).some((check) =>
      check.mandatory && (check.argv || []).includes(interaction.test));
    if (!executable) errors.push(`${label}: interaction test is not in a mandatory check: ${interaction.test}`);
  }
  return errors;
}

export function uniqueChecks(features) {
  const seen = new Set();
  const checks = [];
  for (const feature of features) {
    for (const check of feature.checks || []) {
      const key = JSON.stringify(check.argv || []);
      if (!check.mandatory || seen.has(key)) continue;
      seen.add(key);
      checks.push({...check, feature_id: feature.id});
    }
  }
  return checks;
}

function valuesAfterFlag(args, flag) {
  const start = args.indexOf(flag);
  if (start < 0) return [];
  const values = [];
  for (let index = start + 1; index < args.length && !args[index].startsWith("--"); index += 1) {
    values.push(args[index]);
  }
  return values;
}

function valueAfterFlag(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? String(args[index + 1] || "") : "";
}

export function gitDiffArgs(base, head = "HEAD") {
  if (!base || ZERO_SHA.test(base)) {
    return ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", "-z", head];
  }
  return ["diff", "--name-only", "-z", base, head];
}

export function changedPathsFromGit(base, head = "HEAD") {
  const result = spawnSync("git", gitDiffArgs(base, head), {cwd: root, encoding: "utf8"});
  if (result.status !== 0) throw new Error(result.stderr?.trim() || "Could not read changed paths from git.");
  return String(result.stdout || "").split("\0").filter(Boolean);
}

function parseArgs(argv) {
  const [command = "preflight", ...rest] = argv;
  const changedAt = rest.indexOf("--changed");
  const featuresAt = rest.indexOf("--features");
  const summaryAt = rest.indexOf("--summary");
  return {
    command,
    all: rest.includes("--all"),
    changed: changedAt >= 0 ? valuesAfterFlag(rest, "--changed") : [],
    featureIds: featuresAt >= 0 ? String(rest[featuresAt + 1] || "").split(",").filter(Boolean) : [],
    summary: summaryAt >= 0 ? String(rest[summaryAt + 1] || "") : "",
    base: valueAfterFlag(rest, "--base"),
    head: valueAfterFlag(rest, "--head") || "HEAD",
  };
}

function showPreflight(features, {unknownIsOk = false} = {}) {
  if (!features.length) {
    const message = "FEATURE_MAP no locked features matched. Add a path owner and receipt before changing unmapped behavior.";
    if (unknownIsOk) console.log(message);
    else console.error(`BLOCKED: ${message}`);
    return unknownIsOk ? 0 : 2;
  }
  let failed = false;
  for (const feature of features) {
    const errors = auditFeature(feature);
    console.log(`FEATURE ${feature.id} lock=${feature.lock} criticality=${feature.criticality || "unknown"}`);
    console.log(`  receipts: ${(feature.receipt_ids || []).join(", ") || "MISSING"}`);
    for (const check of feature.checks || []) console.log(`  check: ${check.argv.join(" ")}`);
    for (const client of feature.client_checks || []) console.log(`  client: ${client}`);
    for (const error of errors) console.error(`  BLOCKED: ${error}`);
    failed ||= errors.length > 0;
  }
  return failed ? 2 : 0;
}

function verify(features, options) {
  const preflight = showPreflight(features, options);
  if (preflight) return preflight;
  for (const check of uniqueChecks(features)) {
    console.log(`RUN ${check.id} (${check.feature_id})`);
    const result = spawnSync(check.argv[0], check.argv.slice(1), {cwd: root, stdio: "inherit"});
    if (result.status !== 0) return result.status || 1;
  }
  console.log(`FEATURE_MAP verified ${features.length} locked feature(s).`);
  return 0;
}

function rejectUnmapped(featureMap, paths) {
  if (featureMap.policy?.unknown_is_ok === true) return 0;
  const unknown = unmappedPaths(featureMap, paths);
  for (const path of unknown) console.error(`BLOCKED: FEATURE_MAP has no owner for changed path: ${path}`);
  return unknown.length ? 2 : 0;
}

function mint(featureMap, featureIds, summary) {
  if (!featureIds.length || !summary) throw new Error("mint requires --features id,id --summary text");
  const selected = featureIds.map((id) => featureMap.features.find((feature) => feature.id === id));
  if (selected.some((feature) => !feature)) throw new Error("Unknown feature id in --features.");
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const slug = featureIds[0].replace(/[^a-z0-9]+/gi, "-").toUpperCase();
  const receiptId = `RCPT-${stamp}-${slug}`;
  const receipt = {
    receipt_id: receiptId,
    revision_id: `${receiptId}-REV-1`,
    at: now.toISOString(),
    author: process.env.USER || "agent",
    status: "unverified",
    summary,
    feature_ids: featureIds,
    feature_checks: {},
    evidence: [],
    rollback: "Required before confirmation.",
    token: "rcpt1"
  };
  writeFileSync(join(receiptDir, `${receiptId}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
  for (const feature of selected) feature.receipt_ids = [...new Set([...(feature.receipt_ids || []), receiptId])];
  featureMap.updated_at = now.toISOString();
  writeFileSync(mapPath, `${JSON.stringify(featureMap, null, 2)}\n`);
  console.log(receiptId);
  return 0;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const featureMap = readFeatureMap();
  if (args.command === "mint") return mint(featureMap, args.featureIds, args.summary);
  if (args.command === "verify-git") {
    const changed = changedPathsFromGit(args.base, args.head);
    if (!changed.length) {
      console.log("FEATURE_MAP no pushed file changes to verify.");
      return 0;
    }
    console.log(`FEATURE_MAP checking ${changed.length} pushed path(s).`);
    const unmapped = rejectUnmapped(featureMap, changed);
    if (unmapped) return unmapped;
    return verify(impactedFeatures(featureMap, changed), {unknownIsOk: featureMap.policy?.unknown_is_ok === true});
  }
  if (!args.all && !args.changed.length) {
    console.error("Use --changed <paths> or --all.");
    return 2;
  }
  const unmapped = rejectUnmapped(featureMap, args.changed);
  if (unmapped) return unmapped;
  const features = impactedFeatures(featureMap, args.changed, {all: args.all});
  const options = {unknownIsOk: featureMap.policy?.unknown_is_ok === true};
  return args.command === "verify" ? verify(features, options) : showPreflight(features, options);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
