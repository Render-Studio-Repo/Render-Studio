import { boundedVoiceContext } from './voice-agent-protocol.js?v=20260923-draw-recordings1&hey-ai-single=20260929-1';

/** Preserve project/model/target identity before optional wiring evidence fills the budget. */
export function compactXrAgentContext(value = {}) {
  const string = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
  const model = value.generationModel;
  const out = {
    projectId: string(value.projectId || value.project_id, 128),
    targetFile: string(value.targetFile, 2048),
    workspace: string(value.workspace, 40),
    vrPresenting: value.vrPresenting === true,
    generationModel: typeof model === 'string' ? string(model, 120) : model ? { model: string(model.model, 120), provider: string(model.provider, 80) } : '',
    targetIds: Array.isArray(value.targetIds) ? value.targetIds.slice(0, 24).map(x => string(x, 200)).filter(Boolean) : [],
  };
  const bytes = () => new TextEncoder().encode(JSON.stringify(out)).length;
  let truncated = false;
  // Keep the current guided connection even when the full harness exceeds the voice budget.
  if (value.wiring?.guide?.guided) out.wiring = boundedVoiceContext({value:{name:value.wiring.name,guide:value.wiring.guide,selection:value.wiring.selection}}).value;
  for (const key of ['spatialBoard', 'canvas', 'drawings3d', 'draftPrompt', 'slicerPlates', 'selected', 'selection', 'catalog', 'parts', 'wiring', 'label', 'projectRevision']) {
    if (value[key] == null) continue;
    const clean = boundedVoiceContext({ value: value[key] });
    const prior = out[key]; out[key] = clean.value;
    if(key==='wiring' && prior?.guide && out[key])out[key].guide=prior.guide;
    if (bytes() > 22000) { if(prior !== undefined)out[key]=prior;else delete out[key]; truncated = true; }
  }
  if (truncated) out.contextNote = 'Large optional scene details omitted; select a specific component or wire for more evidence.';
  return out;
}
