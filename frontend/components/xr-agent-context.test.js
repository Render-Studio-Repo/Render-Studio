import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compactXrAgentContext } from './xr-agent-context.js';

test('oversized wiring context retains project, target and selected model identity', () => {
  const context=compactXrAgentContext({projectId:'project-a',targetFile:'board.step',workspace:'wiring',generationModel:{model:'chosen-model',provider:'chosen-provider'},targetIds:['board1'],selection:{wireId:'W1',gauge:'22AWG',links:['https://maker.example/pins']},wiring:{parts:Array.from({length:80},()=>({notes:'大'.repeat(4000)}))}});
  assert.equal(context.projectId,'project-a');
  assert.equal(context.targetFile,'board.step');
  assert.equal(context.generationModel.model,'chosen-model');
  assert.deepEqual(context.targetIds,['board1']);
  assert.equal(context.selection.wireId,'W1');
  assert.ok(new TextEncoder().encode(JSON.stringify(context)).length<24000);
});

test('context excludes nonessential credentials and unrelated application state', () => {
  const context=compactXrAgentContext({projectId:'p',apiKey:'private',selection:{wireId:'W1',token:'private'},unrelated:'x'});
  assert.equal(context.apiKey,undefined);
  assert.equal(context.selection.token,undefined);
  assert.equal(context.unrelated,undefined);
});
