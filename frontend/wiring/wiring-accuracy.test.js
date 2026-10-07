import test from 'node:test';
import assert from 'node:assert/strict';
import { wiringAccuracy, wiringAccuracyLabel } from './wiring-accuracy.js';
const verified = {
  id:'driver', sourceFile:'driver.step', dimensions:[1,2,3],
  partIdentity:{manufacturer:'Acme',partNumber:'D1',revision:'B'},
  connectors:[{id:'J1',cavities:[{number:'1'}]}],
  pins:[{id:'PUL+',position3d:[1,2,3],verification:'verified'}]
};
test('verified physical parts and endpoints become wiring ready', () => {
  const result=wiringAccuracy({buildMode:'verified',components:[verified],wires:[{from:{componentId:'driver',pinId:'PUL+'},to:{componentId:'driver',pinId:'PUL+'}}]});
  assert.equal(result.readyForPhysicalWiring,true);
  assert.match(wiringAccuracyLabel({buildMode:'verified',components:[verified]}),/physical wiring ready/);
});
test('diagram-only components remain concept data', () => {
  const result=wiringAccuracy({components:[{id:'x',pin_layout:[{id:'1',x:0,y:0}]}]});
  assert.equal(result.readyForPhysicalWiring,false);
  assert.equal(result.exactGeometryPercent,0);
});
