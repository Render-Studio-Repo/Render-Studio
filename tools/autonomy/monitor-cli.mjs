#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  defaultRootDir,
  ensureMonitorLayout,
  getMonitorState,
  ingestFail,
  setEnabled,
  setFreeReign,
  tripKill,
} from "./monitor-lib.mjs";

function printUsage() {
  console.error(
    [
      "Usage:",
      "  node tools/autonomy/monitor-cli.mjs status [--root /workspace]",
      "  node tools/autonomy/monitor-cli.mjs init [--root /workspace]",
      "  node tools/autonomy/monitor-cli.mjs set-enabled <true|false> [--root /workspace]",
      "  node tools/autonomy/monitor-cli.mjs set-free-reign <true|false> [--root /workspace]",
      "  node tools/autonomy/monitor-cli.mjs trip-kill [--reason \"why\"] [--root /workspace]",
      "  node tools/autonomy/monitor-cli.mjs inject-fail --input fail.json [--root /workspace]",
    ].join("\n"),
  );
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseBoolean(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`Expected true or false, got: ${value}`);
}

function parseArgs(argv) {
  const out = {
    positionals: [],
    options: {},
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      out.positionals.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out.options[key] = true;
      continue;
    }
    out.options[key] = next;
    i += 1;
  }
  return out;
}

function loadPayload(inputPath) {
  if (!inputPath) throw new Error("inject-fail requires --input <path-to-json>.");
  const resolved = path.resolve(inputPath);
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

const args = parseArgs(process.argv.slice(2));
const command = args.positionals[0];
const rootDir = args.options.root ? path.resolve(String(args.options.root)) : defaultRootDir();

try {
  if (!command || command === "--help" || command === "help") {
    printUsage();
    process.exit(command ? 0 : 1);
  }

  if (command === "init") {
    const paths = ensureMonitorLayout(rootDir);
    console.log(JSON.stringify({ ok: true, paths }, null, 2));
    process.exit(0);
  }

  if (command === "status") {
    console.log(JSON.stringify(getMonitorState(rootDir), null, 2));
    process.exit(0);
  }

  if (command === "set-enabled") {
    const value = parseBoolean(String(args.positionals[1]));
    console.log(JSON.stringify(setEnabled(rootDir, value), null, 2));
    process.exit(0);
  }

  if (command === "set-free-reign") {
    const value = parseBoolean(String(args.positionals[1]));
    console.log(JSON.stringify(setFreeReign(rootDir, value), null, 2));
    process.exit(0);
  }

  if (command === "trip-kill") {
    const killPath = tripKill(rootDir, String(args.options.reason || ""));
    console.log(JSON.stringify({ ok: true, kill_path: killPath }, null, 2));
    process.exit(0);
  }

  if (command === "inject-fail") {
    const payload = loadPayload(String(args.options.input || ""));
    console.log(JSON.stringify(ingestFail(rootDir, payload), null, 2));
    process.exit(0);
  }

  printUsage();
  fail(`Unknown command: ${command}`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
