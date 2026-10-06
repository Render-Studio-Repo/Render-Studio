import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptKeyCandidates, pinnedPromptKey, subscriptionHydrateSelect } from './prompt-key-default.js';
const pinned = 'chatgpt:subscription';
test('account gets subscription by default; explicit unpin and other accounts are respected', () => {
  assert.equal(pinnedPromptKey({}, { email: ' A1PROJECTS@protonmail.com ' }), pinned);
  assert.equal(pinnedPromptKey({ pinned_prompt_key: '' }, { email: 'a1projects@protonmail.com' }), '');
  assert.equal(pinnedPromptKey({}, { email: 'another@example.com' }), '');
});
test('new project cannot inherit previous project key or override the account pin', () => {
  assert.equal(promptKeyCandidates({ pinned, previous: 'personal:old', projectStored: 'team:old', globalStored: 'personal:global' })[0], pinned);
});
test('pin beats last-used Claude/Fable in the same project', () => {
  const args = { pinned, previous: 'personal:chosen', sameContext: true, projectStored: 'team:claude', globalStored: 'personal:fable' };
  assert.equal(promptKeyCandidates(args)[0], pinned);
  assert.equal(promptKeyCandidates({ ...args, sameContext: false })[0], pinned);
  assert.equal(promptKeyCandidates({ ...args, preserveSelection: false })[0], pinned);
});
test('without a pin, same-project last-used still wins', () => {
  assert.equal(promptKeyCandidates({ previous: 'personal:chosen', sameContext: true, preserveSelection: true })[0], 'personal:chosen');
});
test('unavailable pinned subscription remains first instead of silently switching billing', () => {
  assert.equal(promptKeyCandidates({ pinned, fallback: 'platform:openai' })[0], pinned);
});
test('subscription hydrate never selects Claude when ChatGPT is pinned', () => {
  assert.deepEqual(
    subscriptionHydrateSelect({ pinned, chatgptReady: true, claudeReady: true, cursorReady: false }),
    { selectChatgpt: true, selectCursor: false, selectClaude: false },
  );
  assert.deepEqual(
    subscriptionHydrateSelect({ pinned: '', chatgptReady: true, claudeReady: true }),
    { selectChatgpt: true, selectCursor: false, selectClaude: false },
  );
});
