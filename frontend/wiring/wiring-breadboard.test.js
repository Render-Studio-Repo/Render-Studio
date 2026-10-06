import test from "node:test";
import assert from "node:assert/strict";
import { physicalPins, breadboardImage, pinStatus } from "./wiring-breadboard.js";
import { resolveSkin } from "./wiring-part-skins.js";

test("drawing and pin coordinates share a normalized space", () => {
  const c = {breadboard:{status:"library"},pin_layout:[{id:"d13",x:.2,y:.3,label:"D13"},{id:"d13",x:.4,y:.3},{id:"bad",x:3,y:.2}]};
  assert.equal(physicalPins(c).length,1);
  assert.deepEqual([physicalPins(c)[0].x*300,physicalPins(c)[0].y*200],[60,60]);
  assert.equal(physicalPins({...c,breadboard:{status:"illustration"}}),null);
});
test("SVG is image-isolated and illustrations do not claim verification", () => {
  assert.ok(breadboardImage({svg:'<svg viewBox="0 0 10 10"/>'}).startsWith("data:image/svg+xml"));
  assert.match(pinStatus({}), /unverified/);
});
test("wrong board family never masquerades as exact electronics", () => {
  assert.equal(resolveSkin({type:"motor-driver",label:"L298N"}).id,"driver");
  assert.equal(resolveSkin({type:"motor-driver",label:"Unknown driver"}).src,"custom/module.svg");
  assert.equal(resolveSkin({type:"raspberry-pi",label:"Raspberry Pi 5"}).id,"pi-generic");
  assert.equal(resolveSkin({type:"raspberry-pi",label:"Raspberry Pi 4B"}).id,"pi");
});
