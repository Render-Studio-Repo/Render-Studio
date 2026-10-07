/** Never carry another project's visible key into this project. Pin beats last-used. */
export function promptKeyCandidates({ pinned = "", previous = "", sameContext = false, preserveSelection = true, projectStored = "", chatgpt = "", globalStored = "", fallback = "" } = {}) {
  return [...new Set([
    pinned,
    !pinned && preserveSelection && sameContext ? previous : "",
    !pinned ? projectStored : "",
    !pinned && !projectStored ? chatgpt : "",
    !pinned ? globalStored : "",
    fallback,
  ].filter(Boolean))];
}

export function pinnedPromptKey(status, user) {
  if (typeof status?.pinned_prompt_key === "string") return status.pinned_prompt_key;
  return String(user?.email || "").trim().toLowerCase() === "a1projects@protonmail.com"
    ? "chatgpt:subscription" : "";
}

/** Hydrate flags must not pick Claude/Fable over a ChatGPT (or other) pin. */
export function subscriptionHydrateSelect({ pinned = "", chatgptReady = false, cursorReady = false, claudeReady = false } = {}) {
  if (pinned === "chatgpt:subscription") {
    return { selectChatgpt: true, selectCursor: false, selectClaude: false };
  }
  if (pinned === "cursor:subscription") {
    return { selectCursor: true, selectChatgpt: false, selectClaude: false };
  }
  if (pinned === "claude:subscription") {
    return { selectClaude: true, selectChatgpt: false, selectCursor: false };
  }
  if (pinned) {
    return { selectChatgpt: false, selectCursor: false, selectClaude: false };
  }
  return {
    selectChatgpt: !!chatgptReady,
    selectCursor: !!cursorReady && !chatgptReady && !claudeReady,
    selectClaude: !!claudeReady && !chatgptReady && !cursorReady,
  };
}
