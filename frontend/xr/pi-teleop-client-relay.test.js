import test from 'node:test';
import assert from 'node:assert/strict';
import {openPiRelay, requestPiTeleop} from './pi-teleop-client.js';

const profile = {
  ui: 'https://192.168.1.77:8443/teleop',
  controllers: {http_backups: {y: {url: 'https://192.168.1.77:8443/teleop/y'}}},
};

test('Pi Y fallback obtains a ticket and uses the authenticated Studio relay', async () => {
  const saved = globalThis.fetch;
  const savedStorage = globalThis.localStorage;
  const calls = [];
  globalThis.localStorage = {getItem:key => key === 'render3d:token' ? 'studio-token' : null};
  globalThis.fetch = async (url, options = {}) => {
    calls.push({url:String(url), options});
    if (url === '/api/teleop/open') {
      return {ok:true, status:200, json:async()=>({iframe:'/api/teleop/p/192.168.1.77/8443/teleop'})};
    }
    return {ok:true, status:200, json:async()=>({ok:true, armed:true})};
  };
  try {
    const out = await requestPiTeleop(profile, '/teleop/y', {body:{action:'tap'}});
    assert.equal(out.armed, true);
    assert.equal(calls[0].url, '/api/teleop/open');
    assert.equal(calls[0].options.credentials, 'same-origin');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer studio-token');
    assert.equal(calls[1].url, '/api/teleop/p/192.168.1.77/8443/teleop/y');
    assert.equal(calls[1].options.credentials, 'same-origin');
    assert.deepEqual(JSON.parse(calls[1].options.body), {action:'tap'});
  } finally {
    globalThis.fetch = saved;
    globalThis.localStorage = savedStorage;
  }
});

test('Pi relay reports Studio auth failures without authorizing a direct-LAN fallback', async () => {
  const saved = globalThis.fetch;
  const savedStorage = globalThis.localStorage;
  const rows = new Map([['render3d:token', 'expired-token']]);
  globalThis.localStorage = {
    getItem:key => rows.get(key) || null,
    removeItem:key => rows.delete(key),
  };
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    json: async () => ({detail: 'Not authenticated'}),
  });
  try {
    await assert.rejects(
      openPiRelay(profile),
      (error) => error.status === 401
        && error.code === 'studio_auth_required'
        && error.message.includes('Sign in again'),
    );
    assert.equal(rows.has('render3d:token'), false);
  } finally {
    globalThis.fetch = saved;
    globalThis.localStorage = savedStorage;
  }
});

test('Pi relay retries with the same-origin session cookie when the stored bearer expired', async () => {
  const savedFetch = globalThis.fetch;
  const savedStorage = globalThis.localStorage;
  const calls = [];
  const rows = new Map([['render3d:token', 'expired-token']]);
  globalThis.localStorage = {
    getItem:key => rows.get(key) || null,
    removeItem:key => rows.delete(key),
  };
  globalThis.fetch = async (url, options = {}) => {
    calls.push({url:String(url), options});
    if (url === '/api/auth/refresh') {
      return {ok:false, status:401, json:async()=>({detail:'No device session'})};
    }
    const relayCalls = calls.filter(call => call.url === '/api/teleop/open').length;
    if (relayCalls === 1) {
      return {ok:false, status:401, json:async()=>({detail:'Invalid or expired token'})};
    }
    return {ok:true, status:200, json:async()=>({iframe:'/api/teleop/p/192.168.1.77/8443/teleop'})};
  };
  try {
    assert.equal(await openPiRelay(profile), '/api/teleop/p/192.168.1.77/8443');
    assert.equal(calls.length, 3);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer expired-token');
    assert.equal(calls[1].url, '/api/auth/refresh');
    assert.equal(calls[2].options.headers.Authorization, undefined);
    assert.equal(calls[2].options.credentials, 'same-origin');
    assert.equal(rows.has('render3d:token'), false);
    await openPiRelay(profile);
    assert.equal(calls[3].options.headers.Authorization, undefined);
  } finally {
    globalThis.fetch = savedFetch;
    globalThis.localStorage = savedStorage;
  }
});

test('Pi relay rotates an expired access token through the HttpOnly device session', async () => {
  const savedFetch = globalThis.fetch;
  const savedStorage = globalThis.localStorage;
  const rows = new Map([['render3d:token', 'expired-token']]);
  const calls = [];
  globalThis.localStorage = {
    getItem:key => rows.get(key) || null,
    setItem:(key, value) => rows.set(key, value),
    removeItem:key => rows.delete(key),
  };
  globalThis.fetch = async (url, options = {}) => {
    calls.push({url:String(url), options});
    if (url === '/api/auth/refresh') {
      return {ok:true, status:200, json:async()=>({token:'renewed-token', user:{id:'user-1'}})};
    }
    if (calls.filter(call => call.url === '/api/teleop/open').length === 1) {
      return {ok:false, status:401, json:async()=>({detail:'Invalid or expired token'})};
    }
    return {ok:true, status:200, json:async()=>({iframe:'/api/teleop/p/192.168.1.77/8443/teleop'})};
  };
  try {
    assert.equal(await openPiRelay(profile), '/api/teleop/p/192.168.1.77/8443');
    assert.equal(calls[1].url, '/api/auth/refresh');
    assert.equal(calls[2].options.headers.Authorization, 'Bearer renewed-token');
    assert.equal(rows.get('render3d:token'), 'renewed-token');
  } finally {
    globalThis.fetch = savedFetch;
    globalThis.localStorage = savedStorage;
  }
});

test('guarded Home reaches the authenticated Pi endpoint and keeps its safety requirements', async () => {
  const saved = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({url: String(url), options});
    return {ok: true, status: 200, json: async () => url === '/api/teleop/open'
      ? {iframe: '/api/teleop/p/192.168.1.77/8443/teleop'}
      : {ok: true, homing: true, home_reached: false}};
  };
  try {
    const result = await requestPiTeleop(profile, '/teleop/home', {
      body: {require_stationary: true, require_clear: true},
    });
    assert.deepEqual(result, {ok: true, homing: true, home_reached: false});
    assert.equal(calls[1].url, '/api/teleop/p/192.168.1.77/8443/teleop/home');
    assert.deepEqual(JSON.parse(calls[1].options.body), {require_stationary: true, require_clear: true});
  } finally {
    globalThis.fetch = saved;
  }
});
