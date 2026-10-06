import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

test('all production robotics imports share one transport module URL',()=>{
  const root=fileURLToPath(new URL('../',import.meta.url)), urls=new Map();
  for(const name of readdirSync(root,{recursive:true})){
    if (!name.endsWith('.js') || name.endsWith('.test.js')) continue;
    const source=readFileSync(join(root,name),'utf8');
    if (!source.includes('xr-dimos-teleop.js')) continue;
    for(const match of source.matchAll(/xr-dimos-teleop\.js(\?[^'"\s]*)?['"]/g)){
      const query=match[1]||'';
      urls.set(query,[...(urls.get(query)||[]),name]);
    }
  }
  assert.equal(urls.size,1,`Robotics state split across module URLs: ${JSON.stringify([...urls])}`);
});

test('desktop and XR module instances observe live remaps and storage changes', async () => {
  const oldWindow = globalThis.window, oldStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.window = new EventTarget();
  globalThis.localStorage = {getItem:key=>values.get(key)||null, setItem:(key,value)=>values.set(key,value)};
  try {
    const desktop = await import('./xr-control-map.js?test=desktop');
    const xr = await import('./xr-control-map.js?test=xr');
    assert.equal(xr.mappedButtonIndex('squeeze'),1);
    desktop.remapXrControlAction('squeeze',3);
    assert.equal(xr.mappedButtonIndex('squeeze'),3);
    xr.remapXrControlAction('laser',2);
    assert.equal(desktop.mappedButtonIndex('laser'),2);
    assert.equal(desktop.mappedButtonIndex('squeeze'),3);
    values.delete(desktop.XR_CONTROL_MAP_KEY);
    const event = new Event('storage'); event.key=desktop.XR_CONTROL_MAP_KEY;
    window.dispatchEvent(event);
    assert.equal(xr.mappedButtonIndex('squeeze'),1);
    const prefs = await import('./xr-dimos-controls.js?test=desktop');
    const runtime = await import('./xr-dimos-controls.js?test=xr');
    assert.equal(runtime.getDimosControlPrefs().gripper,'none');
    prefs.persistDimosControlPrefs({gripper:'trigger'});
    assert.equal(runtime.getDimosControlPrefs().gripper,'none');
    assert.equal(runtime.getDimosControlPrefs({id:'different-user'}).gripper,'none');
    assert.equal(runtime.getDimosControlPrefs().gripper,'none');
    prefs.persistDimosControlPrefs({start_pause:'A'});
    assert.equal(runtime.getDimosControlPrefs().start,'B');
    assert.equal(runtime.getDimosControlPrefs().pause,'A');
    assert.equal(runtime.getDimosControlPrefs().engage,'y_map');
  } finally { globalThis.window=oldWindow; globalThis.localStorage=oldStorage; }
});
