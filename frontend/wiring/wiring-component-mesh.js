/** Readable circuit models. Undimensioned parts use schematic proportions, not CAD measurements. */
import * as THREE from 'three';
export function wiringText(text, width, { color = '#e5eff7', background = '', height = width / 6, sprite = false } = {}) {
  const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, 768, 128); }
  ctx.fillStyle = color; ctx.font = '600 46px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(text), 384, 64, 740);
  const map = new THREE.CanvasTexture(canvas); map.colorSpace = THREE.SRGBColorSpace; map.userData.wiringOwned = true;
  const result = sprite ? new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: true })) : new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  if (sprite) result.scale.set(width, height, 1); else result.rotation.x = -Math.PI / 2;
  result.raycast = () => {}; return result;
}
export function componentMesh(component, size) {
  const [w, h, d] = size, type = component.type, label = String(component.label || '').toLowerCase();
  const group = new THREE.Group();
  const mat = color => new THREE.MeshStandardMaterial({ color, roughness: .65, metalness: .22 });
  const box = (x, y, z, color, px=0, py=0, pz=0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(x,y,z),mat(color)); m.position.set(px,py,pz); group.add(m); return m; };
  const cylinder = (r, height, color, x=0, y=0, z=0) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r,r,height,24),mat(color)); m.position.set(x,y,z); group.add(m); return m; };
  const breadboard = type === 'breadboard', motor = type === 'stepper' || type === 'motor', supply = /power-supply|battery/.test(type), external = /cl86|tb6600/.test(label);
  box(w,h,d,breadboard ? '#e2e5e3' : motor || supply ? '#9ca8b2' : external ? '#303b47' : '#137568');
  if (breadboard) {
    box(w*.94,.12,d*.052,'#3e4c52',0,h/2+.1,0);
    box(w*.93,.14,d*.012,'#db635c',0,h/2+.12,-d*.39);
    box(w*.93,.14,d*.012,'#519cce',0,h/2+.12,d*.39);
  } else if (motor) {
    box(w*.88,h*.4,d*.88,'#27323b',0,-h*.15,0);
    cylinder(Math.min(w,d)*.32,h*.13,'#c7d3de',0,h*.56);
    cylinder(Math.min(w,d)*.085,h*.8,'#dee7ed',0,h*.93);
  } else if (supply) {
    for(let i=0;i<10;i++) box(w*.045,.15,d*.6,'#384550',-w*.34+i*w*.075,h/2+.1,0);
  } else if (external) {
    for(let i=0;i<9;i++) box(w*.045,h*.2,d*.7,'#111a22',-w*.31+i*w*.078,h*.58,0);
  } else {
    box(w*.23,h*.45,d*.32,'#18232c',0,h*.72,0);
    box(w*.13,h*.6,d*.2,'#a9bdc7',-w*.41,h*.75,0);
    for (const x of [-.42,.42]) for (const z of [-.36,.36]) cylinder(Math.min(w,d)*.022,.2,'#d5be75',w*x,h/2+.15,d*z);
  }
  const text = wiringText(component.label || type, w*.88, { color: breadboard || supply ? '#253745' : '#e6f1f4', height: Math.min(d*.18,w*.15) });
  text.position.set(0,h*.52+.25,breadboard ? -d*.33 : d*.22); group.add(text);
  return group;
}
