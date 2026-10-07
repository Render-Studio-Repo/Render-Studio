/**
 * Little config-overlap check — duplicate Astra/voice controls + talk-over.
 * Token cfgov1.
 */

export const CFGOV1_TOKEN = "cfgov1";

function count(sel, root = globalThis.document) {
  try {
    if (!root?.querySelectorAll) return 0;
    return root.querySelectorAll(sel).length;
  } catch {
    return 0;
  }
}

export function checkConfigOverlap({ talkMode, floor, root = globalThis.document } = {}) {
  const talkGroups = count(".sb-talk-mode", root);
  const askWidgets = count("[data-sb-ask-astra]", root);
  // Navigation shortcuts share one chat; their count is not a second session.
  const askButtons = count("[data-sb-astra], [data-collab-astra], [data-office-open], [data-astra-open]", root);
  const voiceStarts = count("[data-sb-ask-voice], #sb-talk", root);
  const crewTalk = count("#sb-crew", root);
  const issues = [];

  if (talkGroups > 0) {
    issues.push(`${talkGroups} talk-mode bars (want 0 — one speaker is default)`);
  }
  if (askWidgets > 1) {
    issues.push(`${askWidgets} Ask Astra widgets (want 1)`);
  }
  if (voiceStarts > 1) {
    issues.push(`${voiceStarts} Voice / Talk starts`);
  }
  if (crewTalk) {
    issues.push("Crew talk button still mounted (overlap)");
  }
  if (talkMode === "both") {
    issues.push("talkMode=both — agents can overlap");
  }

  const ok = issues.length === 0;
  return {
    ok,
    token: CFGOV1_TOKEN,
    talkMode: talkMode || "?",
    floor: floor || "",
    talkGroups,
    askWidgets,
    askButtons,
    voiceStarts,
    crewTalk,
    issues,
    label: ok ? "overlap OK" : `overlap · ${issues[0]}`,
  };
}

export function overlapHtml(check) {
  const cls = check.ok ? "is-ok" : "is-bad";
  const extra = (check.issues || []).slice(1).join(" · ");
  return `<span class="sb-feed-k">config</span><span class="${cls}" data-sb-cfg-overlap title="${String(extra || check.label).replace(/"/g, "")}">${check.label}</span>`;
}
