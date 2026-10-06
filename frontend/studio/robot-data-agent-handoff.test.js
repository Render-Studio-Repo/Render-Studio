import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handoffRobotDataAgent } from './robot-data-agent-handoff.js';

test('robot data handoff closes the explorer before opening one side panel with setup guidance', async () => {
  const events = [];
  const result = await handoffRobotDataAgent({
    closeSurface: () => events.push(['closed']),
    openSidePanel: (payload) => events.push(['opened', payload]),
    question: '  Show the dataset import checklist.  ',
  });

  assert.deepEqual(events, [
    ['closed'],
    ['opened', { question: 'Show the dataset import checklist.', autoSend: true }],
  ]);
  assert.deepEqual(result, { opened: true, question: 'Show the dataset import checklist.', autoSend: true });
});

test('robot data handoff leaves the explorer open when no side-panel controller exists', async () => {
  let closed = false;
  const result = await handoffRobotDataAgent({ closeSurface: () => { closed = true; }, question: 'Help import data.' });
  assert.equal(closed, false);
  assert.deepEqual(result, { opened: false });
});
