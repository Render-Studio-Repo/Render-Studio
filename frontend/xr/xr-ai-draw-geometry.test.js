import test from 'node:test';
import assert from 'node:assert/strict';
import { boardSampleDistanceSquared, nearestBoardTriangleEdge, displayBoardEditorText } from './xr-ai-draw-geometry.js';

test('surface ink sample spacing uses world metres under CAD presentation scale', () => {
  const matrix=[.001,0,0,0,0,.001,0,0,0,0,.001,0,100,200,300,1];
  assert.equal(boardSampleDistanceSquared([0,0,0],{x:1,y:0,z:0},matrix),.000001);
  assert.equal(boardSampleDistanceSquared([0,0,0],{x:.001,y:0,z:0}),.000001);
  const rotated=[0,.001,0,0,-.002,0,0,0,0,0,.003,0,0,0,0,1];
  assert.ok(Math.abs(boardSampleDistanceSquared([0,0,0],{x:1,y:1,z:0},rotated)-.000005)<1e-15);
});
test('edge selection follows real triangle endpoints instead of a synthetic line', () => {
  const triangle=[[0,0,0],[10,0,0],[0,10,0]];
  assert.deepEqual(nearestBoardTriangleEdge(triangle,[8,.1,0]),[[0,0,0],[10,0,0]]);
  assert.deepEqual(nearestBoardTriangleEdge(triangle,[5.1,4.9,0]),[[10,0,0],[0,10,0]]);
  assert.equal(nearestBoardTriangleEdge([[0,0,0],[0,0,0],[0,0,0]],[0,0,0]),null);
});
test('editor shows current names while keeping input stable IDs untouched', () => {
  const draft='Apply @{photo} to @{region}';
  const state={nodes:{photo:{name:'Chrome finish'}},regions:{region:{name:'Split plane'}}};
  assert.equal(displayBoardEditorText(draft,state),'Apply @Chrome finish to @Split plane');
  state.nodes.photo.name='Satin finish';
  assert.equal(displayBoardEditorText(draft,state),'Apply @Satin finish to @Split plane');
  assert.equal(draft,'Apply @{photo} to @{region}');
});
