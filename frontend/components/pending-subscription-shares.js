function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function pendingSubscriptionShares(status = {}) {
  return [
    { id: "openai", key: "chatgpt", label: "ChatGPT" },
    { id: "claude", key: "claude", label: "Claude" },
  ].flatMap(({ id, key, label }) => {
    if (status[key]?.signed_in || status[`${key}_signed_in`]) return [];
    const shares = status[key]?.shares || status[`${key}_shares`] || {};
    const received = Array.isArray(shares)
      ? shares.filter((share) => !share.is_owner)
      : [...(shares.received || []), ...(shares.personal_received || (id === "openai" ? status.personal_received : []) || [])];
    const ownerNames = [...new Set(received
      .filter((share) => share.granted === true && !share.owner_signed_in)
      .map((share) => share.owner_name || "Your teammate"))];
    return ownerNames.length ? [{ id, label, ownerNames }] : [];
  });
}

export function pendingSubscriptionShareMarkup(status = {}) {
  return pendingSubscriptionShares(status).map(({ id, label, ownerNames }) => `
    <div class="prompt-key-popup-row" data-subscription-unavailable="${id}" aria-disabled="true">
      <div class="prompt-key-popup-info">
        <span class="prompt-key-popup-name">${label} · ${escapeHtml(ownerNames.join(", "))}</span>
        <small class="muted">Shared with you. The owner needs to reconnect before you can use it.</small>
      </div>
    </div>`).join("");
}
