import { boardConnectedGraph } from './xr-ai-board-graph.js?v=20260923-draw-recordings1';
import { collectDrawEvidence, DRAW_DESIGN_DISCUSSION_INSTRUCTIONS } from './xr-draw-evidence.js?v=20260923-draw-evidence1';
/** Spatial annotations share the Draw command store. This module cannot run CAD generation. */
const short = (value, limit = 200) => String(value ?? '').trim().slice(0, limit);
const own = (map, id) => !!id && Object.prototype.hasOwnProperty.call(map || {}, id);
const id = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
const clone = value => JSON.parse(JSON.stringify(value));
export const DRAW_VOICE_CONTEXT_BYTES = 10500;

export function drawVoiceTools() {
  return [{ type: 'function', name: 'draw_board_command', description: 'Annotate the active spatial Draw board using stable IDs from get_design_context. Notes, links, naming and prompt organization only; never executes a model edit or generation. For a split annotation use annotate_split; its clarificationId binds the next answer to the original region.', parameters: {
    type: 'object', properties: {
      action: { type: 'string', enum: ['add_note', 'update_note', 'remove_note', 'annotate_split', 'answer_clarification', 'rename_node', 'add_link', 'update_link', 'remove_link', 'final_look', 'memo_transcript', 'organize_prompt'] },
      regionId: { type: 'string' }, nodeId: { type: 'string' }, noteId: { type: 'string' }, linkId: { type: 'string' }, fromId: { type: 'string' }, toId: { type: 'string' }, clarificationId: { type: 'string' },
      name: { type: 'string' }, text: { type: 'string' }, caption: { type: 'string' }, finalLook: { type: 'boolean' },
      printerModel: { type: 'string' }, jointStyle: { type: 'string' }, assembly: { type: 'string' }, intendedSplit: { type: 'string' },
    }, required: ['action'], additionalProperties: false,
  } }];
}

export const DRAW_VOICE_INSTRUCTIONS = `When spatialBoard.active is true, the user is planning on VR Draw's spatial canvas. Keep drawing and conversation independent. Read spatialBoard's selected region, pointed face, model identity, linked references and notes. IDs, not displayed names, identify targets. Use draw_board_command to add or edit an annotation, caption a link, rename a reference, mark an image Final look, or organize the draft. These operations do not edit CAD and never authorize generation. Never use propose_cad_change, apply_micro_edit or review_cad_changes for board planning. If asked to generate, organize the prompt and ask the user to review it and press Generate in Draw AI Prompt. No voice tool executes generation.
For a split note record the user's intended split and assembly requirements with annotate_split. Ask what kind of split is wanted when unclear. If the printer is only called Bambu, ask which Bambu model and which joint/connector style when unknown. Copy only details the user actually supplies into printerModel/jointStyle/assembly/intendedSplit; never invent printer dimensions, build plate limits or executed geometry. The returned clarificationId, noteId and regionId keep the original region as the target of answer_clarification even if the user looks elsewhere. Read pendingClarification before a follow-up. Ask remaining questions returned by the command. Do not claim an annotation is an executed CAD edit. Long notes stay editable callouts.
${DRAW_DESIGN_DISCUSSION_INSTRUCTIONS}`;

/** Cache only plain metadata; no meshes, canvas encoding, audio buffers or animation-loop work. */
export function createXrDrawVoice({ getBoard, getProjectId, getPointedFace, onOrganizePrompt } = {}) {
  let pending = null, project = '', lastState = null, lastPointed = '', cached = null;
  function active() {
    const currentProject = short(getProjectId?.(), 128);
    if (currentProject !== project) { project = currentProject; pending = null; lastState = null; cached = null; }
    const board = getBoard?.();
    const state = board?.getState?.();
    if (!board || !state || !project || (state.projectId && state.projectId !== project)) return null;
    if (pending && (!own(state.regions, pending.regionId) || !own(state.notes, pending.noteId))) pending = null;
    return { board, state };
  }
  function getContext() {
    const current = active();
    if (!current) return null;
    const { state } = current;
    const pointed = getPointedFace?.() || null;
    const safePointed = pointed ? { nodeId: short(pointed.nodeId), faceId: short(pointed.faceId), meshId: short(pointed.meshId), triangleIndex: Number.isInteger(pointed.triangleIndex) ? pointed.triangleIndex : null, sourceRevision: short(pointed.sourceRevision), needsReattach: pointed.needsReattach === true } : null;
    const pointedKey = JSON.stringify(safePointed);
    if (lastState === state && lastPointed === pointedKey && cached) return cached;
    const selectedIds = (state.selectedIds || []).slice(0, 16);
    const selectedRegionId = selectedIds.find(value => own(state.regions, value)) || '';
    const graph = boardConnectedGraph(state, []);
    const ids = new Set([...graph.nodes, ...graph.regions, ...graph.notes].map(item => item.id));
    const regions = graph.regions.slice(0, 12);
    const notes = graph.notes.slice(0, 24);
    // Relevant references first. Small unselected index lets the agent resolve a named image or memo.
    const allNodes = Object.values(state.nodes || {});
    const nodes = [...allNodes.filter(item => ids.has(item.id)), ...allNodes.filter(item => !ids.has(item.id))].slice(0, 24);
    const context = {
      active: true, boardId: short(state.id || state.boardId), projectId: project, revision: state.revision,
      selectedIds, selectedRegionId, pointedFace: safePointed,
      evidence: collectDrawEvidence(state, { maxBytes: 5500 }),
      canvas: state.canvas || null,
      pendingClarification: pending ? clone(pending) : null,
      nodes: nodes.map(item => ({ id: item.id, name: short(item.name), kind: short(item.kind, 40), finalLook: item.finalLook === true,
        source: item.source ? { projectId: short(item.source.projectId, 128), filename: short(item.source.filename, 700), revision: short(item.source.revision), units: short(item.source.units, 30), dimensions: item.source.dimensions || null } : null,
        ...(item.kind === 'memo' ? { transcript: short(item.transcript, 1800) } : {}),
      })),
      regions: regions.map(item => ({ id: item.id, name: short(item.name), nodeId: item.nodeId || item.anchor?.nodeId, kind: short(item.kind, 40), anchor: item.anchor ? { nodeId: item.anchor.nodeId, instanceId: item.anchor.instanceId, sourceRevision: item.anchor.sourceRevision, faceId: item.anchor.faceId, meshId: item.anchor.meshId, triangleIndex: item.anchor.triangleIndex, needsReattach: item.anchor.needsReattach === true } : null })),
      notes: notes.map(item => ({ id: item.id, regionId: item.regionId, nodeId: item.nodeId, text: short(item.text, 2400), requirements: item.requirements || undefined })),
      links: graph.links.slice(0, 24).map(item => ({ id: item.id, fromId: item.fromId, toId: item.toId, caption: short(item.caption, 600) })),
      instructions: DRAW_DESIGN_DISCUSSION_INSTRUCTIONS,
    };
    const bytes = () => new TextEncoder().encode(JSON.stringify(context)).length;
    for (const key of ['nodes', 'links', 'notes', 'regions']) {
      while (bytes() > DRAW_VOICE_CONTEXT_BYTES && context[key].length > (key === 'nodes' ? 1 : 0)) { context[key].pop(); context.truncated = true; }
    }
    lastState = state; lastPointed = pointedKey; cached = context;
    return context;
  }
  function regionTarget(state, args) {
    const target = short(args.regionId) || (state.selectedIds || []).find(value => own(state.regions, value));
    if (!own(state.regions, target)) throw new Error('Select a completed lasso or face region first.');
    return target;
  }
  function send(board, command) {
    const result = board.dispatch(command);
    if (result?.error) throw new Error(result.error);
    lastState = null;
    return { ok: true, generated: false, appliedTo: 'annotation-board', id: result?.id || command.id || command.note?.id || command.link?.id, changed: result?.changed !== false };
  }
  function splitNoteText(text, requirements) {
    const base = short(text, 3500);
    const details = [['Intended split', requirements.intendedSplit], ['Assembly requirements', requirements.assembly], ['Printer model (user supplied)', requirements.printerModel], ['Joint / connector style (user supplied)', requirements.jointStyle]].filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`);
    return `${base}${details.length ? `\n\n${details.join('\n')}` : ''}\n\nPlanning annotation only; no CAD edit has been applied.`;
  }
  async function command(args = {}) {
    const current = active();
    if (!current) return { ok: false, generated: false, error: 'Open Draw → AI Prompt in a project first.' };
    const { board, state } = current;
    try {
      const action = short(args.action, 60), text = short(args.text, 6000);
      if (action === 'organize_prompt') {
        if (!onOrganizePrompt) throw new Error('Use Smart Description in Draw AI Prompt to organize this board.');
        const organized = await onOrganizePrompt();
        if (organized?.ok === false) throw new Error(organized.error || 'The prompt could not be organized.');
        return { ok: true, generated: false, reviewRequired: true, message: 'Prompt organized. Review it and press Generate when ready.' };
      }
      if (action === 'annotate_split' || action === 'answer_clarification') {
        const answering = action === 'answer_clarification';
        if (answering && (!pending || short(args.clarificationId) !== pending.id)) throw new Error('Read pendingClarification and use its clarificationId before answering.');
        const regionId = answering ? pending.regionId : regionTarget(state, args);
        const noteId = answering ? pending.noteId : id('draw-note');
        const existing = answering ? state.notes[noteId] : null;
        const requirements = { ...(existing?.requirements || {}) };
        for (const field of ['printerModel', 'jointStyle', 'assembly', 'intendedSplit']) {
          if (short(args[field], 600)) requirements[field] = short(args[field], 600);
        }
        // A brand alone is not a printer model. No printer dimensions are inferred here.
        if (/^(bambu(?:\s+lab)?|bambu\s+printer)$/i.test(requirements.printerModel || '')) requirements.printerModel = '';
        const missing = ['printerModel', 'jointStyle'].filter(field => !requirements[field]);
        requirements.missingDetails = missing; requirements.pending = missing.length > 0;
        const body = answering ? `${short(existing.text, 4600)}${text ? `\nFollow-up: ${text}` : ''}` : splitNoteText(text || 'Split planning for this region. Requirements still need clarification.', requirements);
        const result = send(board, answering ? { type: 'note.update', id: noteId, patch: { text: answering ? splitNoteText(body.replace(/\n\nPlanning annotation only; no CAD edit has been applied\./g, ''), requirements) : body, requirements } } : { type: 'note.add', note: { id: noteId, regionId, text: body, name: 'Split and assembly plan', expanded: true, requirements } });
        pending = missing.length ? { id: answering ? pending.id : id('draw-clarification'), projectId: project, regionId, noteId, missingDetails: missing } : null;
        lastState = null;
        return { ...result, regionId, noteId, clarificationId: pending?.id || null, missingDetails: missing, question: missing.length === 2 ? 'Which Bambu printer model will you use, and what joint or connector style should join the pieces?' : missing[0] === 'printerModel' ? 'Which printer model will you use?' : missing[0] === 'jointStyle' ? 'What joint or connector style should join the pieces?' : '', annotationOnly: true };
      }
      if (action === 'add_note') {
        if (!text) throw new Error('The note text is empty.');
        const regionId = args.regionId ? regionTarget(state, args) : (state.selectedIds || []).find(value => own(state.regions, value));
        const nodeId = regionId ? undefined : short(args.nodeId) || (state.selectedIds || []).find(value => own(state.nodes, value));
        if (!regionId && !own(state.nodes, nodeId)) throw new Error('Select a region or reference for the note first.');
        return send(board, { type: 'note.add', note: { id: id('draw-note'), regionId, nodeId, text, name: short(args.name) || 'Note', expanded: true } });
      }
      if (action === 'update_note' || action === 'remove_note') {
        const noteId = short(args.noteId);
        if (!own(state.notes, noteId)) throw new Error('That note is no longer on the board.');
        if (action === 'update_note' && !text) throw new Error('The note text is empty.');
        return send(board, { type: action === 'remove_note' ? 'note.remove' : 'note.update', id: noteId, ...(action === 'update_note' ? { patch: { text } } : {}) });
      }
      if (['rename_node', 'final_look', 'memo_transcript'].includes(action)) {
        const nodeId = short(args.nodeId), node = state.nodes?.[nodeId];
        if (!own(state.nodes, nodeId)) throw new Error('That reference is no longer on the board.');
        if (action === 'final_look' && node.kind !== 'image') throw new Error('Only reference images can be marked Final look.');
        if (action === 'memo_transcript' && node.kind !== 'memo') throw new Error('Select a voice memo to edit its transcript.');
        if (action === 'rename_node' && !short(args.name)) throw new Error('A reference name is required.');
        return send(board, { type: 'node.update', id: nodeId, patch: action === 'rename_node' ? { name: short(args.name) } : action === 'final_look' ? { finalLook: args.finalLook === true } : { transcript: text } });
      }
      if (action === 'add_link') return send(board, { type: 'link.add', link: { id: id('draw-link'), fromId: short(args.fromId), toId: short(args.toId), caption: short(args.caption, 2000) } });
      if (action === 'update_link' || action === 'remove_link') {
        const linkId = short(args.linkId);
        if (!own(state.links, linkId)) throw new Error('That link is no longer on the board.');
        return send(board, { type: action === 'remove_link' ? 'link.remove' : 'link.update', id: linkId, ...(action === 'update_link' ? { patch: { caption: short(args.caption, 2000) } } : {}) });
      }
      throw new Error('This command is not available for board annotations. Generate requires the Draw Generate button.');
    } catch (error) { return { ok: false, generated: false, error: error.message || 'The board command could not be applied.' }; }
  }
  return { getContext, command, reset() { pending = null; lastState = null; cached = null; } };
}
