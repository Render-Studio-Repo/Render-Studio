/** Shared Render Agent FAB + panel mount for documentation pages. */

import { authHeaders, createAuthUI, getStoredUser } from "../studio/auth.js?v=20260914-forgot-pw-sblogin2-loginlog1-loginfix1";
import { createRenderAgent } from "../components/render-agent.js?v=20261006-designchat-hey-ai1";

const LOGO = "/media/images/render-animations/VR-Animations/render-logo-gear-still.png?v=20260915-logo1";

async function api(path, options = {}, timeoutMs = 60000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      ...options,
      signal: ctrl.signal,
      headers: {
        ...authHeaders(options.headers || {}),
        ...(options.body && !(options.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...(options.headers || {}),
      },
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { detail: text };
    }
    if (!res.ok) {
      const err = new Error(data?.detail || data?.message || res.statusText || "Request failed");
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function ensureAuthModal() {
  if (document.getElementById("auth-modal")) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = `
  <div id="auth-modal" class="auth-modal hidden" role="dialog" aria-modal="true" aria-labelledby="auth-title">
    <div class="auth-backdrop" data-auth-close></div>
    <div class="auth-card">
      <button type="button" class="auth-close" data-auth-close aria-label="Close">&times;</button>
      <div class="auth-card-header">
        <img class="auth-logo" src="${LOGO}" alt="" width="48" height="48" />
        <div>
          <h2 id="auth-title">Welcome back</h2>
          <p class="auth-subtitle">Sign in to ask Render Agent</p>
        </div>
      </div>
      <div class="auth-tabs">
        <button type="button" class="auth-tab active" data-tab="login">Log in</button>
        <button type="button" class="auth-tab" data-tab="register">Create account</button>
      </div>
      <p id="auth-error" class="auth-error"></p>
      <form id="auth-form-login" class="auth-form">
        <label>Email<input type="email" id="login-email" required autocomplete="username" placeholder="you@company.com" /></label>
        <label>Password<input type="password" id="login-password" required autocomplete="current-password" placeholder="••••••••" /></label>
        <p class="auth-forgot-row">
          <button type="button" class="auth-forgot-link" id="btn-forgot-password">Forgot password?</button>
        </p>
        <button type="submit" class="btn accent auth-submit">Log in</button>
      </form>
      <form id="auth-form-forgot" class="auth-form hidden">
        <p class="muted small">We’ll email a reset link if that address has an account.</p>
        <label>Email<input type="email" id="forgot-email" required autocomplete="username" placeholder="you@company.com" /></label>
        <button type="submit" class="btn accent auth-submit">Email reset link</button>
        <button type="button" class="btn secondary auth-submit" id="btn-forgot-back">Back to log in</button>
      </form>
      <form id="auth-form-reset" class="auth-form hidden">
        <p class="muted small">Choose a new password for your Render Studio account.</p>
        <label>New password<input type="password" id="reset-password" required minlength="6" autocomplete="new-password" placeholder="At least 6 characters" /></label>
        <label>Confirm password<input type="password" id="reset-password-confirm" required minlength="6" autocomplete="new-password" placeholder="Repeat new password" /></label>
        <button type="submit" class="btn accent auth-submit">Save new password</button>
      </form>
      <form id="auth-form-register" class="auth-form hidden">
        <label>Name<input type="text" id="register-name" required autocomplete="name" placeholder="Your name" /></label>
        <label>Email<input type="email" id="register-email" required autocomplete="email" placeholder="you@company.com" /></label>
        <label>Password<input type="password" id="register-password" required minlength="6" autocomplete="new-password" placeholder="At least 6 characters" /></label>
        <button type="submit" class="btn accent auth-submit">Create account</button>
      </form>
    </div>
  </div>`;
  document.body.appendChild(wrap.firstElementChild);
}

function ensureAgentMarkup() {
  if (!document.getElementById("render-agent-fab")) {
    const fab = document.createElement("button");
    fab.type = "button";
    fab.id = "render-agent-fab";
    fab.className = "render-agent-fab";
    fab.title = "Ask Render Agent";
    fab.setAttribute("aria-label", "Ask Render Agent");
    fab.setAttribute("aria-pressed", "false");
    fab.innerHTML = `<img src="${LOGO}" alt="" /><span>Ask Agent</span>`;
    document.body.appendChild(fab);
  }

  if (!document.getElementById("render-agent-panel")) {
    const section = document.createElement("section");
    section.id = "render-agent-panel";
    section.className = "render-agent-panel render-agent-panel--docs hidden";
    section.setAttribute("aria-label", "Render Agent assistant");
    section.innerHTML = `
    <header class="render-agent-head">
      <button type="button" id="render-agent-thread-menu" class="render-agent-menu-btn" aria-label="Open Render Agent threads" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
      <div class="render-agent-title">
        <strong>Render Agent</strong>
        <span id="render-agent-active-thread-label">Drag header to move · drag edges to resize</span>
      </div>
      <img class="render-agent-head-logo" src="${LOGO}" alt="Render Studio" />
      <button type="button" id="render-agent-close" class="render-agent-close" aria-label="Close Render Agent">&times;</button>
    </header>
    <div id="render-agent-thread-popover" class="render-agent-thread-popover hidden">
      <div id="render-agent-thread-list" class="render-agent-thread-list"></div>
      <button type="button" id="render-agent-new-thread" class="btn secondary btn-compact">New</button>
    </div>
    <div class="render-agent-people-row render-agent-people-row--docs">
      <div id="render-agent-members" class="render-agent-members" aria-label="Thread members"></div>
      <select id="render-agent-invite-select" class="render-agent-invite-select" aria-label="Invite teammate to thread">
        <option value="">Invite teammate…</option>
      </select>
      <button type="button" id="render-agent-invite-btn" class="btn secondary btn-compact">Invite</button>
    </div>
    <div id="render-agent-onboarding" class="render-agent-onboarding hidden">
      <strong>Need help?</strong>
      <span>Ask about any docs topic — matching demos appear as GIFs in the reply.</span>
    </div>
    <div id="render-agent-messages" class="render-agent-messages" aria-live="polite"></div>
    <div id="render-agent-attachments" class="render-agent-attachments"></div>
    <form id="render-agent-form" class="render-agent-form">
      <label class="render-agent-upload">
        Upload
        <input type="file" id="render-agent-file-input" multiple accept="image/png,image/jpeg,image/webp,.txt,.md,.csv,.json,.svg,.dxf,.step,.stp,.pdf" hidden />
      </label>
      <textarea id="render-agent-input" rows="2" placeholder="Ask about Generate, workspaces, folders, markup, Fusion…"></textarea>
      <button type="submit" class="btn accent btn-compact">Ask</button>
    </form>
    <p id="render-agent-status" class="render-agent-status muted small"></p>`;
    document.body.appendChild(section);
  } else {
    document.getElementById("render-agent-panel")?.classList.add("render-agent-panel--docs");
  }

  if (!document.getElementById("btn-auth")) {
    const toolbar = document.querySelector(".toolbar");
    if (toolbar && !toolbar.querySelector(".toolbar-spacer")) {
      const spacer = document.createElement("div");
      spacer.className = "toolbar-spacer";
      toolbar.appendChild(spacer);
    }
    if (toolbar) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = "btn-auth";
      btn.className = "btn-auth";
      btn.title = "Sign in";
      btn.setAttribute("aria-label", "Sign in");
      btn.innerHTML = `<span class="auth-icon" aria-hidden="true">👤</span><span id="auth-avatar" class="auth-avatar hidden" aria-hidden="true"></span>`;
      toolbar.appendChild(btn);
    }
  }
}

/**
 * @param {{ autoOpen?: boolean }} [opts]
 */
export function mountDocsRenderAgent({ autoOpen = false } = {}) {
  ensureAuthModal();
  ensureAgentMarkup();

  let currentUser = getStoredUser();
  const agent = createRenderAgent({
    api,
    getProjectId: () => null,
    getSelectedFile: () => null,
    getCurrentUser: () => currentUser,
    getTeams: () => [],
    getSelectedWorkspaceId: () => null,
    getSelectedAiKey: () => ({}),
    stickyNote: true,
    onRequireLogin: () => authUi?.openModal?.(),
    onStatus: () => {},
  });

  const authUi = createAuthUI({
    api,
    onReady: (data) => {
      currentUser = data.user;
      agent?.setUser?.(data.user, { suppressOnboarding: true });
    },
  });

  void authUi.bootstrap?.().then((data) => {
    if (data?.user) {
      currentUser = data.user;
      agent?.setUser?.(data.user, { suppressOnboarding: true });
    }
  });

  if (autoOpen) {
    agent?.open?.({ onboarding: true });
  }

  return { agent, authUi };
}

// Auto-mount when this file is loaded as a page entry script.
mountDocsRenderAgent({ autoOpen: false });
