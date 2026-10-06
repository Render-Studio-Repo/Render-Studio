import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ROBOTICS_PROFILE, configUrlForTeleop, fetchRoboticsConfigFromLan, lanRoboticsConfigUrls, normalizeRoboticsProfile, persistRoboticsProfile, persistRoboticsProfileDurable, readRoboticsProfile, resetRoboticsProfileStorageForTests, isRoboticsStorageQuotaError, roboticsLaunchUrl, roboticsOwnsExternalSession, roboticsProfileSummary } from './robotics-profile.js?v=roboticsworkspace3-20260915-dimosvr1-landiscovery2';
const original = globalThis.localStorage;
afterEach(() => { globalThis.localStorage = original; resetRoboticsProfileStorageForTests(); });
function storage() {
  const rows = new Map();
  globalThis.localStorage = {
    getItem: k => rows.has(k) ? rows.get(k) : null,
    setItem: (k, v) => { rows.set(k, String(v)); },
    removeItem: k => { rows.delete(k); },
    get length() { return rows.size; },
    key(i) { return [...rows.keys()][i] || null; },
  };
  return rows;
}
function quotaError(key = "render3d:roboticsProfile:6500dec9-c06") {
  const error = new Error(`Failed to execute 'setItem' on 'Storage': Setting the value of '${key}' exceeded the quota.`);
  error.name = "QuotaExceededError";
  error.code = 22;
  return error;
}
test('supplied default preserves the Pi ownership and exact Y/trigger mapping', () => {
  storage(); const value=readRoboticsProfile();
  assert.equal(value.mode,'integrated');
  assert.equal(roboticsOwnsExternalSession(value),false);
  assert.equal(roboticsLaunchUrl(value),'');
  assert.equal(value.profile.controllers.buttons.left.Y.hold_ms,3000);
  assert.match(value.profile.controllers.buttons.right.trigger,/gripper/);
  assert.match(roboticsProfileSummary(value.profile),/Retired mapping: Hold X\+A/);
});
test('profile URLs accept pasted Markdown links and reject executable schemes', () => {
  const p=normalizeRoboticsProfile({...DEFAULT_ROBOTICS_PROFILE,ui:'[teleop](https://192.168.1.77:8443/teleop)',passthrough_ui:''});
  assert.equal(p.ui,'https://192.168.1.77:8443/teleop');
  assert.throws(()=>normalizeRoboticsProfile({...p,ui:'javascript:alert(1)'}));
  assert.throws(()=>normalizeRoboticsProfile({schema:'unknown'}));
});
test('Teleop IP fills discovery URL and persistence is scoped to each account', async () => {
  storage(); assert.equal(configUrlForTeleop('https://192.168.1.42:8443/teleop?autoconnect=1'),'http://192.168.1.42:8450/robotics/config');
  assert.deepEqual(lanRoboticsConfigUrls('https://192.168.1.77:8443/teleop'), {
    http: 'http://192.168.1.77:8450/robotics/config',
    https: 'https://192.168.1.77:8443/robotics/config',
    trust: 'https://192.168.1.77:8443/trust',
    trustHttp: 'http://192.168.1.77:8450/trust',
  });
  const loaded = await fetchRoboticsConfigFromLan('https://192.168.1.77:8443/teleop', {
    httpsPage: true,
    fetchFn: async (url) => {
      assert.equal(url, 'https://192.168.1.77:8443/robotics/config');
      return { ok: true, json: async () => DEFAULT_ROBOTICS_PROFILE };
    },
  });
  assert.equal(loaded.configUrl, 'https://192.168.1.77:8443/robotics/config');
  persistRoboticsProfile({mode:'studio'},{id:'one'},{notify:false});
  assert.equal(readRoboticsProfile({id:'one'}).mode,'studio');
  assert.equal(readRoboticsProfile({id:'two'}).mode,'integrated');
});

test('HTTPS Studio reads the supplied HTTP discovery endpoint instead of assuming teleop serves config', async () => {
  const calls=[];
  const url='http://192.168.1.77:8450/robotics/config';
  const result=await fetchRoboticsConfigFromLan(url, {httpsPage:true,fetchFn:async (target,options)=>{
    calls.push(target);assert.equal(options.credentials,'omit');assert.ok(options.signal);
    return {ok:true,json:async()=>DEFAULT_ROBOTICS_PROFILE};
  }});
  assert.deepEqual(calls,[url]);assert.equal(result.configUrl,url);
});

test('missing HTTPS config falls back to direct LAN HTTP without a cloud request', async () => {
  const calls=[];
  const result=await fetchRoboticsConfigFromLan('https://192.168.1.77:8443/robotics/config',{httpsPage:true,fetchFn:async url=>{
    calls.push(url);return url.startsWith('https:') ? {ok:false,status:404} : {ok:true,json:async()=>DEFAULT_ROBOTICS_PROFILE};
  }});
  assert.deepEqual(calls,['https://192.168.1.77:8443/robotics/config','http://192.168.1.77:8450/robotics/config']);
  assert.equal(result.configUrl,calls[1]);
});

test('discovery preserves explicitly supplied config path and port', async () => {
  const url='http://192.168.1.42:8451/config';
  const result=await fetchRoboticsConfigFromLan(url,{fetchFn:async target=>{
    assert.equal(target,url);return {ok:true,json:async()=>DEFAULT_ROBOTICS_PROFILE};
  }});
  assert.equal(result.configUrl,url);
  assert.equal(lanRoboticsConfigUrls('https://192.168.1.42:9443/config').https,'https://192.168.1.42:9443/config');
});

test('browser blocking and a missing endpoint explain JSON import without declaring teleop down', async () => {
  await assert.rejects(fetchRoboticsConfigFromLan(DEFAULT_ROBOTICS_PROFILE.paste_url,{httpsPage:true,fetchFn:async url=>{
    if(url.startsWith('http:'))throw new TypeError('Failed to fetch');return {ok:false,status:404};
  }}),error=>{
    assert.match(error.message,/import or paste its JSON/);assert.match(error.message,/HTTP 404/);
    assert.match(error.message,/does not mean teleop is down/);return true;
  });
});

test('discovery times out each unreachable endpoint and rejects invalid profiles', async () => {
  let aborted=0;
  await assert.rejects(fetchRoboticsConfigFromLan(DEFAULT_ROBOTICS_PROFILE.paste_url,{timeoutMs:5,fetchFn:async (url,{signal})=>new Promise((resolve,reject)=>{
    signal.addEventListener('abort',()=>{aborted++;reject(new Error('aborted'));},{once:true});
  })}),/timed out/);
  assert.equal(aborted,2);
  await assert.rejects(fetchRoboticsConfigFromLan(DEFAULT_ROBOTICS_PROFILE.paste_url,{fetchFn:async()=>({ok:true,json:async()=>({ok:true})})}),/Expected a render-studio-robotics/);
});

test('Enable Robotics hands external profiles off without opening a control socket', async () => {
  storage();
  persistRoboticsProfile({mode:'external',profile:DEFAULT_ROBOTICS_PROFILE},null,{notify:false});
  const {setDimosTeleopArmed,getDimosTeleopState} = await import('./xr-dimos-teleop.js?v=roboticsworkspace3-20260915-dimosvr1-20260915-dimosy1-picontrols1-pistopsave1-pitriggerviser2-20260916-yreset1-teleophud1&xrtalk=20260916-1&robotemote=20260916-1&astra=20260916-5&teleopfix=20260916-1&inputfix=20260916-1&yarm1=1');
  const oldDispatch=globalThis.dispatchEvent, oldSocket=globalThis.WebSocket;
  const events=[]; let sockets=0;
  globalThis.dispatchEvent=e=>events.push(e);
  globalThis.WebSocket=class {constructor(){sockets++;}};
  try {
    setDimosTeleopArmed(true,{inputSources:[]});
    assert.equal(sockets,0);
    assert.equal(getDimosTeleopState().armed,false);
    assert.equal(events.at(-1).type,'render3d:robotics-launch');
    assert.equal(events.at(-1).detail.url,DEFAULT_ROBOTICS_PROFILE.autoconnect);
  } finally {globalThis.dispatchEvent=oldDispatch;globalThis.WebSocket=oldSocket;}
});

test('previous external default migrates to Studio and explicit full-page choice persists', () => {
  storage(); localStorage.setItem('render3d:roboticsProfile:anon',JSON.stringify({mode:'external',profile:DEFAULT_ROBOTICS_PROFILE}));
  assert.equal(readRoboticsProfile().mode,'integrated');
  persistRoboticsProfile({mode:'external',profile:DEFAULT_ROBOTICS_PROFILE},null,{notify:false});
  assert.equal(readRoboticsProfile().mode,'external');
});

test('quota exceeded prunes bulky snapshots and still saves the active profile', () => {
  const rows = storage();
  rows.set('render3d:roboticsProfile:old-user', 'x'.repeat(80000));
  rows.set('render3d:xrEnvironments:v1', 'data:image/png;base64,' + 'A'.repeat(200000));
  rows.set('render3d:token', 'keep-me');
  let failNextProfile = true;
  const inner = globalThis.localStorage;
  const setItem = inner.setItem;
  globalThis.localStorage.setItem = (k, v) => {
    if (failNextProfile && k.startsWith('render3d:roboticsProfile:')) {
      failNextProfile = false;
      throw quotaError(k);
    }
    return setItem.call(inner, k, v);
  };
  persistRoboticsProfile({mode:'studio'},{id:'6500dec9-c06b-4f21-9e0a-test'},{notify:false});
  assert.equal(readRoboticsProfile({id:'6500dec9-c06b-4f21-9e0a-test'}).mode,'studio');
  assert.equal(rows.has('render3d:xrEnvironments:v1'), false);
  assert.equal(rows.has('render3d:roboticsProfile:old-user'), false);
  assert.equal(rows.get('render3d:token'), 'keep-me');
});

test('quota errors stay handled when localStorage cannot store the profile at all', async () => {
  const rows = storage();
  rows.set('render3d:wdbg:v1:huge', 'data:image/jpeg;base64,' + 'B'.repeat(250000));
  globalThis.localStorage.setItem = () => { throw quotaError(); };
  assert.equal(isRoboticsStorageQuotaError(quotaError()), true);
  persistRoboticsProfile({mode:'external',profile:DEFAULT_ROBOTICS_PROFILE},{id:'one'},{notify:false});
  const saved = readRoboticsProfile({id:'one'});
  assert.equal(saved.mode,'external');
  assert.equal(saved.profile.ui, DEFAULT_ROBOTICS_PROFILE.ui);
  const durable = await persistRoboticsProfileDurable({mode:'studio'},{id:'one'},{notify:false});
  assert.equal(durable.mode,'studio');
  assert.equal(readRoboticsProfile({id:'one'}).mode,'studio');
});

test('integrated session uses one Pi socket, preserves menu triggers and forwards Y on the pose JSON socket', async () => {
  storage();
  const teleop = await import('./xr-dimos-teleop.js?v=roboticsworkspace3-20260915-dimosvr1-20260915-dimosy1-picontrols1-pistopsave1-pitriggerviser2-20260916-yreset1-teleophud1&xrtalk=20260916-1&robotemote=20260916-1&astra=20260916-5&teleopfix=20260916-1&inputfix=20260916-1&yarm1=1');
  const saved = {WebSocket:globalThis.WebSocket, fetch:globalThis.fetch, performance:globalThis.performance};
  const sockets=[], packets=[], requests=[]; let now=1000;
  class Socket {
    static OPEN=1; static CONNECTING=0;
    constructor(url) { this.url=url; this.readyState=1; sockets.push(this); }
    send(bytes) { packets.push(bytes); }
    close() { this.readyState=3; }
  }
  globalThis.WebSocket=Socket;
  globalThis.fetch=async (url, options = {}) => {
    const href = String(url);
    if (href.includes("/teleop/y")) {
      requests.push({endpoint:href,...JSON.parse(options.body || "{}")});
      return { ok: true, json: async () => ({armed:false,holding:true,y_map:'tap_pause_hold3_kill'}) };
    }
    throw new Error('Unexpected legacy coordinator request');
  };
  globalThis.performance={now:()=>now};
  teleop.configureDimosProfileTransport(async (url, options) => {
    throw new Error(`cloud proxy must not be used: ${url}`);
  });
  const pad=()=>({mapping:'xr-standard',axes:[0,0,.2,.3],buttons:Array.from({length:7},()=>({pressed:false,value:0}))});
  const left={handedness:'left',gamepad:pad(),gripSpace:{}}, right={handedness:'right',gamepad:pad(),gripSpace:{}};
  const session={inputSources:[right,{handedness:'left',hand:{}},left],addEventListener(){},removeEventListener(){}};
  const renderer={xr:{getReferenceSpace:()=>({}),getFrame:()=>({getPose:()=>({transform:{position:{x:0,y:1,z:0},orientation:{x:0,y:0,z:0,w:1}}})})}};
  try {
    teleop.setDimosTeleopArmed(true,session);
    teleop.setDimosTeleopArmed(true,session);
    assert.equal(sockets.length,1);
    assert.equal(sockets[0].url,'wss://192.168.1.77:8443/ws');
    assert.doesNotMatch(String(sockets[0].url),/\/api\/dimos\/ws/);
    sockets[0].onopen();
    sockets[0].onmessage({data:JSON.stringify({type:'teleop_status',y_map:'tap_pause_hold3_kill'})});
    left.gamepad.buttons[0]={pressed:true,value:1}; right.gamepad.buttons[0]={pressed:true,value:1};
    left.gamepad.buttons[5]={pressed:true,value:1};
    teleop.reserveDimosMenuTrigger('left');
    teleop.tickDimosTeleop({renderer,session});
    const joys=packets.filter(bytes=>new DataView(bytes.buffer).getBigUint64(0)===teleop.FP_JOY).map(bytes=>{
      const v=new DataView(bytes.buffer), n=v.getUint32(28), hand=new TextDecoder().decode(bytes.slice(32,32+n-1));
      let o=32+n; const count=v.getInt32(8);
      const axes=Array.from({length:count},(_,i)=>v.getFloat32(o+i*4)); o+=count*4;
      const buttons=Array.from({length:v.getInt32(12)},(_,i)=>v.getInt32(o+i*4));
      return {hand,axes,buttons};
    });
    assert.equal(joys.length,2,'duplicate hand sources must not overwrite controller Joy');
    assert.equal(joys.find(j=>j.hand==='left').axes[2],0);
    assert.equal(joys.find(j=>j.hand==='right').axes[2],1);
    assert.equal(joys.find(j=>j.hand==='left').buttons[5],0,'raw Y must not reach old firmware');
    now+=100; left.gamepad.buttons[5]={pressed:false,value:0};
    teleop.tickDimosTeleop({renderer,session});
    await Promise.resolve();
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.deepEqual(packets.filter(p=>typeof p==='string').map(JSON.parse),[{type:'y',action:'tap'}]);
    assert.deepEqual(requests,[],'open pose socket must not wait on HTTPS /teleop/y');
    teleop.setDimosTeleopArmed(false);
    assert.equal(sockets[0].readyState,3);
  } finally {
    teleop.resetDimosTeleopOnXrBoundary(); teleop.configureDimosProfileTransport(null);
    Object.assign(globalThis,saved);
  }
});
test('workspace updates re-check the robotics profile', async () => {
  storage();
  const { checkRoboticsProfileAfterWorkspaceUpdate } = await import('./robotics-profile.js?v=roboticsworkspace3-20260915-dimosvr1-landiscovery2');
  persistRoboticsProfile({ mode: 'studio' });
  const studio = await checkRoboticsProfileAfterWorkspaceUpdate({ id: 'anon' });
  assert.equal(studio.ok, true);
  assert.equal(studio.mode, 'studio');
  persistRoboticsProfile({ mode: 'integrated', version: 2, profile: DEFAULT_ROBOTICS_PROFILE });
  const lan = await checkRoboticsProfileAfterWorkspaceUpdate({ id: 'anon' }, {
    fetchFn: async () => ({ ok: true, json: async () => DEFAULT_ROBOTICS_PROFILE }),
  });
  assert.equal(lan.ok, true);
  assert.equal(lan.stale, false);
});
