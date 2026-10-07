export function desktopCanvasEvidence(state = {}, name = '') {
  let remaining = 4500;
  let omitted = 0;
  const elements = [];
  for (const row of state.elements || []) {
    const item = {};
    for (const key of ['id','type','kind','text','label','caption','name','x','y','width','height','rotation','fromId','toId','startId','endId','source_filename','sourceFilename','imageName','relation','memberIds','filename','points']) {
      const value = row[key];
      if (value == null) continue;
      item[key] = typeof value === 'string' ? value.slice(0, 500) : Array.isArray(value) ? value.slice(0, 24) : value;
    }
    const size = JSON.stringify(item).length;
    if (size > remaining || elements.length >= 32) { omitted++; continue; }
    remaining -= size;
    elements.push(item);
  }
  return { name, coordinateSystem: 'Canvas pixels, not model dimensions', elements,
    totalElements: (state.elements || []).length, omitted, truncated: omitted > 0 };
}

export async function generateDrawReferenceImage({ api, projectId, prompt, keyFields = {}, speed = 'fast' }) {
  if (!projectId) throw new Error('Open a project before generating an image.');
  const description = String(prompt || '').trim().slice(0, 8000);
  if (!description) throw new Error('Describe the reference image first.');
  const data = await api(`/api/projects/${encodeURIComponent(projectId)}/imagine`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...keyFields, prompt: description, original_prompt: description, count: 1, speed }),
  });
  const file = data?.files?.[0];
  const filename = file?.name;
  if (!filename) throw new Error('Image generation returned no saved project image.');
  return { kind: 'image', name: file.label || filename.split('/').pop(), source: {
    projectId, filename, description,
    url: `/api/projects/${encodeURIComponent(projectId)}/files/${filename.split('/').map(encodeURIComponent).join('/')}`,
  } };
}


export async function saveRecordedDesign({ api, projectId, viewport, canvas, draft = '' }) {
  if (!projectId) throw new Error('Open a project to save the recorded design context.');
  const capturedAt = new Date().toISOString();
  const name = `Draw recording ${capturedAt.replace(/[:.]/g, '-')}`;
  const spatialBoard = viewport?.getAiDrawWorkspace?.()?.board?.exportState?.() || null;
  const drawings = viewport?.exportSceneDrawingDocument?.() || null;
  const state = { title: name, elements: [], recorded_design: { version: 1, capturedAt, projectId,
    prompt: draft, canvas, spatialBoard, drawings, kind: 'design-context', robotTrainingEpisode: false } };
  await api(`/api/projects/${encodeURIComponent(projectId)}/canvas-board`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, state }),
  });
  return { name, capturedAt };
}
