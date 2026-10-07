/** Profile settings markup. Existing Studio handlers own uploads and saves. */
const escapeText = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

export function renderPreferencesProfile({user = {}, escapeHtml = escapeText} = {}) {
  const avatar = String(user?.avatar_url || '');
  const name = String(user?.display_name || '');
  const handle = String(user?.handle || '').replace(/^@+/, '');
  const initial = (name || handle || user?.email || '?').trim().charAt(0).toUpperCase();
  return `<section class="profile-preferences-section profile-preferences-section--wide profile-pref-identity preferences-profile" aria-labelledby="preferences-profile-heading">
    <header class="preferences-profile-intro">
      <h3 id="preferences-profile-heading">Your profile</h3>
      <p>Make it easy for people to recognize you across Studio.</p>
    </header>
    <div class="preferences-profile-photo-row">
      <span class="profile-avatar-preview ${avatar ? 'profile-avatar-preview--image' : ''}" role="img" aria-label="Profile picture">
        ${avatar ? `<img src="${escapeHtml(avatar)}" alt="" />` : escapeHtml(initial)}
      </span>
      <div class="preferences-profile-photo-copy">
        <strong>Profile picture</strong>
        <p>Shown beside your name in projects and conversations.</p>
        <div class="profile-avatar-actions">
          <label class="btn secondary preferences-profile-upload">
            ${avatar ? 'Change picture' : 'Upload picture'}
            <input id="profile-avatar-input" class="preferences-profile-file-input" type="file" accept="image/png,image/jpeg" aria-label="${avatar ? 'Change' : 'Upload'} profile picture" aria-describedby="preferences-avatar-help" />
          </label>
          <button type="button" id="profile-avatar-remove" class="btn secondary preferences-profile-remove" ${avatar ? '' : 'disabled'}>Remove</button>
        </div>
        <small id="preferences-avatar-help">PNG or JPEG, under 1.5 MB.</small>
      </div>
    </div>
    <div class="preferences-profile-fields">
      <label class="preferences-profile-field" for="pref-display-name">
        <span>Display name</span>
        <input id="pref-display-name" class="profile-pretty-input" type="text" maxlength="80" value="${escapeHtml(name)}" placeholder="Your name" autocomplete="name" aria-describedby="preferences-name-help" />
        <small id="preferences-name-help">Your name in chat, projects, and your public profile.</small>
      </label>
      <div class="preferences-profile-field">
        <label for="pref-handle">Handle</label>
        <span class="profile-handle-input-wrap">
          <span class="profile-handle-field-prefix" aria-hidden="true">@</span>
          <input id="pref-handle" class="profile-pretty-input" type="text" maxlength="24" value="${escapeHtml(handle)}" placeholder="your-handle" autocomplete="off" autocapitalize="none" spellcheck="false" aria-describedby="preferences-handle-help pref-handle-status" />
        </span>
        <small id="preferences-handle-help">3–24 letters, numbers, underscores, or hyphens.</small>
        <span id="pref-handle-status" class="profile-handle-status is-idle" aria-live="polite"></span>
      </div>
      <label class="preferences-profile-field preferences-profile-field--bio" for="pref-bio">
        <span>Bio <small class="preferences-profile-optional">Optional</small></span>
        <textarea id="pref-bio" class="profile-pretty-input" maxlength="500" rows="4" placeholder="What do you like to design or build?" aria-describedby="preferences-bio-help">${escapeHtml(user?.bio || '')}</textarea>
        <small id="preferences-bio-help">A little about you, shown on your public profile. Up to 500 characters.</small>
      </label>
    </div>
    <div class="preferences-profile-public">
      <span class="preferences-profile-public-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c4 4.5 4 12.5 0 17-4-4.5-4-12.5 0-17Z"/></svg></span>
      <div><strong>Public profile</strong><small id="pref-profile-link">${handle ? escapeHtml(`render3d.app/u/${handle}`) : 'Choose a handle to personalize your profile link.'}</small></div>
      <button type="button" id="pref-profile-view" class="btn secondary">Preview<span aria-hidden="true"> ↗</span></button>
    </div>
    <footer class="preferences-profile-footer">
      <p id="profile-avatar-status" class="muted small profile-preferences-note" role="status" aria-live="polite"></p>
      <button type="button" id="pref-profile-save" class="btn accent">Save profile</button>
    </footer>
  </section>`;
}
