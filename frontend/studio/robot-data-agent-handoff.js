export async function handoffRobotDataAgent({ closeSurface, openSidePanel, question, autoSend = true } = {}) {
  const normalizedQuestion = String(question || '').trim();
  if (!normalizedQuestion || typeof openSidePanel !== 'function') return { opened: false };
  closeSurface?.();
  await openSidePanel({ question: normalizedQuestion, autoSend: Boolean(autoSend) });
  return { opened: true, question: normalizedQuestion, autoSend: Boolean(autoSend) };
}
