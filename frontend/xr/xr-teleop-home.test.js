import test from 'node:test';
import assert from 'node:assert/strict';
import {runGuardedHome} from './xr-teleop-home.js';

const stopped = {armed: false, holding: false, pending_arm: false, homing: false};
const moving = {...stopped, homing: true, home_reached: false};
const reached = {...stopped, holding: true, home_reached: true, home_safe_hold: true,
  home_target_joint_count: 14, home_feedback_joint_count: 14};

test('Home waits for its reset ACK and only completes after settled full feedback', async () => {
  let reset;
  let state = 'reset pending';
  const paths = [];
  const job = runGuardedHome({
    wait: async () => {},
    request: async (path, options) => {
      paths.push(path);
      if (path === '/teleop/y') return new Promise(resolve => {reset = resolve;});
      if (path === '/teleop/home') {
        assert.equal(state, 'reset acknowledged');
        assert.deepEqual(options.body, {require_stationary: true, require_clear: true});
        state = 'homing';
        return moving;
      }
      state = 'home reached';
      return reached;
    },
  });
  await Promise.resolve();
  assert.equal(state, 'reset pending');
  state = 'reset acknowledged';
  reset(stopped);
  assert.deepEqual(await job, reached);
  assert.equal(state, 'home reached');
  assert.deepEqual(paths, ['/teleop/y', '/teleop/home', '/teleop/status']);
});

test('cancellation while reset is pending prevents a delayed Home command', async () => {
  const controller = new AbortController();
  let reset;
  const paths = [];
  const job = runGuardedHome({signal: controller.signal, request: path => {
    paths.push(path);
    return new Promise(resolve => {reset = resolve;});
  }});
  controller.abort();
  reset(stopped);
  await assert.rejects(job, /Home cancelled/);
  assert.deepEqual(paths, ['/teleop/y']);
});

test('reset rejection, missing feedback and Pi failure never report Home success', async () => {
  for (const [status, expected] of [
    [{...reached, home_feedback_joint_count: 13}, /completed safe Home/],
    [{...moving, home_failure: 'joint feedback lost'}, /joint feedback lost/],
  ]) {
    await assert.rejects(runGuardedHome({request: async path => path === '/teleop/y' ? stopped : status}), expected);
  }
  await assert.rejects(runGuardedHome({request: async () => ({...stopped, armed: true})}), /arms stopped/);
});

test('an ongoing Home times out without sending a second Home or reset', async () => {
  let clock = 0;
  const paths = [];
  await assert.rejects(runGuardedHome({
    now: () => clock, wait: async ms => {clock += ms;}, timeoutMs: 1000,
    request: async path => {paths.push(path); return path === '/teleop/y' ? stopped : moving;},
  }), /Timed out/);
  assert.deepEqual(paths, ['/teleop/y', '/teleop/home', '/teleop/status', '/teleop/status']);
});

test('VR Home action recovers after missing profile and shares an in-flight action', async () => {
  const {readFileSync} = await import('node:fs');
  const {runInNewContext} = await import('node:vm');
  const source = readFileSync(new URL('./xr-dimos-teleop.js', import.meta.url), 'utf8');
  const block = source.slice(source.indexOf('let homeAndDisarmPromise = null;'), source.indexOf('\nconst gripperPulseUntil'))
    .replace('export function', 'function');
  let profile = null;
  let finish;
  const events = [];
  const invoke = runInNewContext(block + '\nrequestDimosHomeAndDisarm;', {
    AbortController, Promise,
    roboticsIntegratedProfile: () => profile,
    profileStatusRevision: 0, yFollowActive: false, pendingYStart: false,
    startingPositionController: null, startingPositionTask: null, startingPositionReady: false,
    piRecordPulse: {clear() {}}, piSaveIntent: null, piQueuedStop: false,
    gripperPulseUntil: {left: 0, right: 0}, recordMode: 'idle',
    releaseStopRequest() {}, teleopStop: {clear() {}, request() {}},
    teleopHeading: {clear() {}},
    emitPiAction: event => events.push(event.action), setDimosTeleopArmed() {},
    runGuardedHome: () => new Promise(resolve => {finish = resolve;}),
  });
  await assert.rejects(invoke(), /Connect a Pi profile/);
  profile = {ui: 'https://192.168.1.77:8443/teleop'};
  const first = invoke();
  assert.equal(invoke(), first);
  await Promise.resolve();
  finish(reached);
  assert.deepEqual(await first, reached);
  assert.deepEqual(events, ['home_disarm_started', 'home_disarm_failed', 'home_disarm_started', 'home_disarm_complete']);
});
