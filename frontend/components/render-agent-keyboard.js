/** Keep Render Agent submit keys inside the chat boundary. */
export function claimRenderAgentSubmitKey(event) {
  if (!event || event.isComposing || event.key !== "Enter" || event.shiftKey || (!event.metaKey && !event.ctrlKey)) return false;
  event.preventDefault?.();
  event.stopPropagation?.();
  event.stopImmediatePropagation?.();
  return true;
}
