const CHATGPT_VOICE_MODEL = "gpt-6-astra";
const CLAUDE_VOICE_MODEL = "claude-opus-4-8";

function providerSignedIn(status, id) {
  const key = id === "openai" ? "chatgpt" : id;
  if (status?.[`${key}_signed_in`] || status?.[key]?.signed_in) return true;
  return !!status?.providers?.some((provider) => {
    if (String(provider?.id || "").toLowerCase() !== id) return false;
    return provider.signed_in === true
      || provider.connected === true
      || String(provider.auth_status || "").toLowerCase() === "signed_in";
  });
}

export function voiceSubscriptionAccess(status = {}, requestedModel = "") {
  const chatgpt = providerSignedIn(status, "openai");
  const claude = providerSignedIn(status, "claude");
  const requested = String(requestedModel || "").toLowerCase();

  if (!chatgpt && !claude) {
    return {
      allowed: false,
      provider: "",
      model: "",
      reason: "Connect a ChatGPT or Claude subscription that supports buffered Hey AI voice.",
    };
  }
  if (requested.startsWith("claude") && claude) {
    return { allowed: true, provider: "claude", model: requestedModel, reason: "" };
  }
  if (requested.startsWith("gpt-6-astra") && chatgpt) {
    return { allowed: true, provider: "chatgpt", model: requestedModel, reason: "" };
  }
  if (chatgpt) {
    return { allowed: true, provider: "chatgpt", model: CHATGPT_VOICE_MODEL, reason: "" };
  }
  return { allowed: true, provider: "claude", model: CLAUDE_VOICE_MODEL, reason: "" };
}

export function shouldAutoOpenSubscriptionPopup(viewportWidth = 0) {
  const width = Number(viewportWidth);
  return !Number.isFinite(width) || width <= 0 || width > 720;
}

export async function refreshedVoiceSubscriptionAccess({ status = {}, requestedModel = "", refresh } = {}) {
  const current = voiceSubscriptionAccess(status, requestedModel);
  if (current.allowed || typeof refresh !== "function") return current;
  const next = await refresh();
  return voiceSubscriptionAccess(next || status, requestedModel);
}
