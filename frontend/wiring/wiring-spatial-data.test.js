import test from 'node:test';
import assert from 'node:assert/strict';
import { physicalVector, physicalPin, documentationLinks, retainWiringMetadata, wireDetails } from './wiring-spatial-data.js';
test('physical coordinates convert explicit units and never use schematic pixel pin coordinates', () => {
  assert.deepEqual(physicalVector([1, 2, 3], 'm', 1), [1000, 2000, 3000]);
  assert.deepEqual(physicalVector([10, 20, 30], 'mm', 1000), [.01, .02, .03]);
  assert.equal(physicalVector([1, 2, 3], 'unknown', 1), null);
  assert.equal(physicalPin({ pins: [{ id: 'GPIO1', x: .5, y: .3 }] }, 'GPIO1').point, null);
  assert.deepEqual(physicalPin({ units: 'mm', pins: { p1: { position: [2, 3, 4], verification: 'verified' } } }, 'p1', 1000), { point: [.002, .003, .004], status: 'verified', pin: { position: [2, 3, 4], verification: 'verified' } });
});
test('evidence links retain exact sources, remove duplicate and unsafe links', () => {
  const links = documentationLinks({ sources: [{ url: 'https://example.com/manual.pdf', title: 'Board schematic', page: 4 }], datasheet: 'https://example.com/manual.pdf', pinout: 'javascript:alert(1)' });
  assert.equal(links.length, 1); assert.equal(links[0].page, 4); assert.equal(links[0].title, 'Board schematic');
});
test('schematic loads preserve physical anchors and wire metadata without widening to arbitrary fields', () => {
  assert.deepEqual(retainWiringMetadata({ pins: [{ id: 'A', position3d: [1, 2, 3] }], unexpected: 'discard' }), { pins: [{ id: 'A', position3d: [1, 2, 3] }] });
  const wire = { gauge: '22 AWG', route3d: [[0, 1, 2]], connectors: { from: 'JST XH' }, unsafe: true };
  assert.deepEqual(retainWiringMetadata(wire, 'wire'), { gauge: '22 AWG', connectors: { from: 'JST XH' }, route3d: [[0, 1, 2]] });
});
test('wire metadata never invents electrical specifications or source evidence', () => {
  const detail = wireDetails({ id: 'w', from: { componentId: 'a', pinId: 'OUT' }, to: { componentId: 'b', pinId: '17' } }, [{ id: 'a', label: 'Sensor' }, { id: 'b', label: 'Controller' }]);
  assert.equal(detail.gauge, null); assert.equal(detail.wireType, null); assert.equal(detail.cutLengthMm, null); assert.equal(detail.verification, 'unverified'); assert.deepEqual(detail.sources, []); assert.equal(detail.geometry.endpoints, 'approximate'); assert.equal(detail.from.component, 'Sensor');
});

test('verified identity, connectors, evidence, and electrical limits survive persistence', () => {
  const component = retainWiringMetadata({partIdentity:{manufacturer:'Acme',partNumber:'D1',revision:'A'},connectors:[{id:'J1'}],electrical:{supplyVoltage:{min:4.8,max:5.2}},evidence:[{url:'https://example.com/data.pdf'}]}, 'component');
  const wire = retainWiringMetadata({maxCurrentA:2,loadCurrentA:1.2,voltageDropV:.1}, 'wire');
  assert.equal(component.partIdentity.partNumber, 'D1');
  assert.equal(component.connectors[0].id, 'J1');
  assert.equal(component.electrical.supplyVoltage.max, 5.2);
  assert.equal(wire.maxCurrentA, 2);
  assert.equal(wire.voltageDropV, .1);
});
