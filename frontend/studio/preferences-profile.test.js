import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderPreferencesProfile} from './preferences-profile.js';

test('profile settings retain all hooks used by existing save, avatar, and handle handlers', () => {
  const html=renderPreferencesProfile({user:{display_name:'Sam',handle:'@sam',bio:'CAD and robots'}});
  for(const id of ['profile-avatar-input','profile-avatar-remove','pref-display-name','pref-handle','pref-handle-status','pref-bio','pref-profile-save','pref-profile-view','pref-profile-link','profile-avatar-status']) {
    assert.equal(html.split(`id="${id}"`).length-1,1,`${id} is unique and present`);
  }
  assert.match(html, /id="pref-handle"[^>]*value="sam"/);
  assert.match(html, /render3d\.app\/u\/sam/);
  assert.match(html, /id="profile-avatar-input"[^>]*accept="image\/png,image\/jpeg"/);
  assert.doesNotMatch(html, /id="profile-avatar-input"[^>]*\shidden/);
  assert.match(html, /id="pref-bio"[^>]*maxlength="500"/);
  assert.match(html, /id="profile-avatar-status"[^>]*aria-live="polite"/);
});

test('profile fields and image attributes escape account content without creating markup', () => {
  const value='"><script>bad</script>&';
  const html=renderPreferencesProfile({user:{display_name:value,handle:value,bio:'</textarea>'+value,avatar_url:value}});
  assert.doesNotMatch(html,/<script>|src=""><|<\/textarea>"/);
  assert.match(html,/&lt;\/textarea&gt;/);
  assert.match(html,/src="&quot;&gt;&lt;script&gt;bad&lt;\/script&gt;&amp;"/);
  assert.doesNotMatch(html,/id="profile-avatar-remove"[^>]*disabled/);
});

test('empty profile supplies useful defaults without inventing user data', () => {
  const html=renderPreferencesProfile();
  assert.match(html,/id="profile-avatar-remove"[^>]*disabled/);
  assert.match(html,/Choose a handle to personalize your profile link/);
  assert.doesNotMatch(html,/src="|followers|projects completed/i);
});
