import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RECORD_DONE_HINT_KEY,
  STUDIO_REMINDER_KEY_PREFIXES,
  reminderHasSeen,
  reminderMarkSeen,
  restoreStudioReminders,
} from "./studio-reminders.js";

function memoryLocalStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    get length() { return store.size; },
    key(i) { return [...store.keys()][i] ?? null; },
  };
}

test("shared projects reminder is restorable from General prefs", () => {
  assert.ok(STUDIO_REMINDER_KEY_PREFIXES.includes("render3d:sharedProjectsHintSeen:v1"));
});

test("opt-out marks the recording popup seen and restore brings it back", () => {
  const prev = globalThis.localStorage;
  globalThis.localStorage = memoryLocalStorage();
  try {
    assert.equal(reminderHasSeen(RECORD_DONE_HINT_KEY, "u1"), false);
    reminderMarkSeen(RECORD_DONE_HINT_KEY, "u1");
    assert.equal(reminderHasSeen(RECORD_DONE_HINT_KEY, "u1"), true);
    assert.equal(reminderHasSeen(RECORD_DONE_HINT_KEY, "u2"), true, "unscoped key also skips the popup");
    const removed = restoreStudioReminders("u1");
    assert.ok(removed.includes(RECORD_DONE_HINT_KEY));
    assert.equal(reminderHasSeen(RECORD_DONE_HINT_KEY, "u1"), false);
  } finally {
    globalThis.localStorage = prev;
  }
});
