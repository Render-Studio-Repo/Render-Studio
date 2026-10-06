export const HARDWARE_RUN_EVENT_SCHEMA = "render3d.hardware-run-events/v1";
export const MAX_HARDWARE_RUN_EVENTS = 120;

const clean = (value, limit = 500) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);

export function createHardwareRunEventJournal({ now = () => new Date(), limit = MAX_HARDWARE_RUN_EVENTS } = {}) {
  const events = [];
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener(snapshot()));
  const snapshot = () => events.map((event) => ({ ...event }));
  const add = (category, outcome, message, details = "") => {
    events.push({
      at: now().toISOString(),
      category: clean(category, 80),
      outcome: clean(outcome, 24).toUpperCase(),
      message: clean(message),
      details: clean(details, 1000),
    });
    if (events.length > limit) events.splice(0, events.length - limit);
    notify();
    return snapshot();
  };
  const clear = () => { events.length = 0; notify(); };
  const text = () => [
    `schema=${HARDWARE_RUN_EVENT_SCHEMA}`,
    `event_count=${events.length}`,
    ...events.map((event) => `${event.at} [${event.outcome}] ${event.category}: ${event.message}${event.details ? ` · ${event.details}` : ""}`),
  ].join("\n");
  const subscribe = (listener) => { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); };
  return { add, clear, snapshot, subscribe, text };
}

export function hardwareRunEventJournalMarkup() {
  return `<details class="robotics-step4-debug" data-step4-debug open>
    <summary>Step 4 debug logs</summary>
    <p class="muted small">Records controls, safety gates, camera and live-view attempts, Pi responses, completion, and operator review. This log cannot send robot commands.</p>
    <div class="robotics-run-debug-actions">
      <button type="button" class="btn secondary btn-compact" data-step4-debug-copy>Copy debug logs</button>
      <button type="button" class="btn secondary btn-compact" data-step4-debug-clear>Clear</button>
    </div>
    <pre data-step4-debug-output tabindex="0">No Step 4 events yet.</pre>
  </details>`;
}
