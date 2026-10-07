import { authHeaders } from "../studio/auth.js";

const form = document.getElementById("marketplace-inquiry-form");
const status = document.getElementById("marketplace-inquiry-status");
form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const message = String(data.get("message") || "").trim();
  if (message.length < 4) return;
  status.textContent = "Sending…";
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    const response = await fetch("/api/site/suggestions", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ kind: data.get("kind") || "idea", message: `[Marketplace roadmap] ${message}`, page_url: window.location.href }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.detail || result.error || "Could not send your message.");
    form.reset();
    status.textContent = "Sent to Render. Thank you.";
  } catch (error) {
    status.textContent = error.message || "Could not send your message.";
  } finally {
    if (button) button.disabled = false;
  }
});
