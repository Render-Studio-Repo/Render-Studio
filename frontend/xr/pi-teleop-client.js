import { isPrivateLanHost } from './xr-dimos-lan.js?v=20260915-dimosvr1';

const endpoints = {
  '/teleop/y': 'y', '/teleop/home': 'home', '/teleop/status': 'status', '/emotes': 'emotes',
  '/emote/play': 'emote_play', '/emote/accept': 'emote_accept', '/emote/discard': 'emote_discard',
};

function forgetRejectedToken(token) {
  if (!token) return;
  for (const storage of [globalThis.localStorage, globalThis.sessionStorage]) {
    try {
      if (String(storage?.getItem?.('render3d:token') || '').trim() === token) {
        storage?.removeItem?.('render3d:token');
      }
    } catch { /* storage is optional in private browsing */ }
  }
}

function reportStudioAuthRequired(token, status, detail) {
  forgetRejectedToken(token);
  const message = 'Render sign-in expired on this headset. Sign in again, then reconnect VR controls.';
  try {
    globalThis.dispatchEvent?.(new CustomEvent('render3d:teleop-auth-required', {
      detail: {message, status, serverDetail: String(detail || '')},
    }));
  } catch { /* CustomEvent is optional in isolated tests */ }
  return message;
}

/** Validate the selected Pi target before asking the authenticated LAN relay to open it. */
export function piTeleopEndpoint(profile, path) {
  if (!Object.hasOwn(endpoints, path)) throw Error('Unknown Pi endpoint');
  const base = new URL(profile?.ui || profile?.passthrough_ui || profile?.url);
  const configured = profile?.controllers?.http_backups?.[endpoints[path]]?.url;
  const url = configured ? new URL(configured) : new URL(path, base);
  if (url.protocol !== 'https:' || !isPrivateLanHost(url.hostname) || url.hostname !== base.hostname
      || url.username || url.password || url.pathname !== path || url.search || url.hash) {
    throw Error('Pi controls require an HTTPS endpoint on the selected LAN host');
  }
  return url.href;
}

export async function openPiRelay(profile, signal) {
  const target = new URL(profile?.ui || profile?.passthrough_ui || profile?.url);
  let token = '';
  for (const storage of [globalThis.localStorage, globalThis.sessionStorage]) {
    try {
      token = String(storage?.getItem?.('render3d:token') || '').trim();
    } catch { /* storage is optional in private browsing */ }
    if (token) break;
  }
  const request = authorization => fetch('/api/teleop/open', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
    headers: {
      'Content-Type':'application/json',
      ...(authorization ? {Authorization:authorization} : {}),
    },
    body: JSON.stringify({url: target.href}),
  });
  const renewSession = async () => {
    const renewed = await fetch('/api/auth/refresh', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', signal,
      headers: token ? {Authorization:`Bearer ${token}`} : {},
    });
    const payload = await renewed.json().catch(()=>({}));
    if (!renewed.ok || !payload?.token) return '';
    token = String(payload.token);
    try {
      globalThis.localStorage?.setItem?.('render3d:token', token);
      if (payload.user) globalThis.localStorage?.setItem?.('render3d:user', JSON.stringify(payload.user));
    } catch { /* storage is optional in private browsing */ }
    return token;
  };
  let response = await request(token ? `Bearer ${token}` : '');
  let data = await response.json().catch(()=>({}));
  if (response.status === 401 || response.status === 403) {
    const renewedToken = await renewSession().catch(()=> '');
    if (renewedToken) {
      response = await request(`Bearer ${renewedToken}`);
      data = await response.json().catch(()=>({}));
    }
  }
  if (token && (response.status === 401 || response.status === 403)) {
    response = await request('');
    data = await response.json().catch(()=>({}));
    if (response.ok) forgetRejectedToken(token);
  }
  if (!response.ok) {
    const authRequired = response.status === 401 || response.status === 403;
    const message = authRequired
      ? reportStudioAuthRequired(token, response.status, data.detail)
      : (data.detail || `Could not open Pi relay (${response.status})`);
    const error = Error(message);
    error.status = response.status;
    error.code = authRequired ? 'studio_auth_required' : 'pi_relay_open_failed';
    throw error;
  }
  const match = String(data.iframe || '').match(/^(\/api\/teleop\/p\/[^/]+\/\d+)/);
  if (!match) throw Error('Pi relay did not return a usable route');
  return match[1];
}

/** Same-origin WebSocket URL backed by Studio's authenticated Pi relay. */
export async function openPiTeleopWebSocketRelay(profile, path = "/ws", signal) {
  const relay = await openPiRelay(profile, signal);
  const proto = globalThis.location?.protocol === "https:" ? "wss:" : "ws:";
  const host = globalThis.location?.host || "";
  if (!host) throw Error("Studio relay host is unavailable");
  return `${proto}//${host}${relay}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function requestPiTeleop(profile, path, { body, signal, timeoutMs = 8000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, {once:true});
  const timer = setTimeout(abort, timeoutMs);
  try {
    // Validate the configured endpoint, then relay through the authenticated
    // Studio host. Quest does not need to trust the Pi's self-signed cert.
    piTeleopEndpoint(profile, path);
    const relay = await openPiRelay(profile, controller.signal);
    const response = await fetch(`${relay}${path}`, {
      method: body === undefined ? 'GET' : 'POST', cache:'no-store', credentials:'same-origin',
      signal:controller.signal,
      ...(body === undefined ? {} : {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),
    });
    const data = await response.json();
    if (!response.ok || data.ok === false) {
      const error = Error(data.detail || data.error || `Pi request failed (${response.status})`);
      error.status = response.status; throw error;
    }
    return data;
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
  }
}

/** Both the newer hello and older teleop_status messages describe live controls. */
export function mergePiTeleopStatus(previous, message) {
  const next = {...previous};
  for (const key of ['armed','holding','homing','pending_arm','playing','mock','json_control','can','can_ok']) {
    if (typeof message?.[key] === 'boolean') next[key] = message[key];
  }
  for (const key of ['y_map','hardware','hardware_mode','adapter','adapter_type']) {
    if (typeof message?.[key] === 'string' && message[key]) next[key] = message[key];
  }
  return next;
}

/** One explicit UI Record/Save click becomes one A edge on the existing Joy stream. */
export function createPiRecordPulse() {
  let phase = -1, at = 0, awaiting = false, wanted = false, started = 0, latched = false;
  return {
    clear() { phase=-1; awaiting=false; latched=false; },
    busy() { return phase >= 0 || awaiting; },
    pending() { return awaiting ? (wanted ? 'starting' : 'stopping') : ''; },
    request(recording, now) {
      if (phase >= 0 || awaiting) return false;
      wanted=recording; started=now; phase=0; at=0; awaiting=true; latched=true; return true;
    },
    acknowledge(recording) { if (recording === wanted) awaiting=false; },
    sample(physical, now, sending) {
      if (phase < 0) {
        if (!physical) latched=false;
        return latched ? 0 : physical;
      }
      const value = phase === 1 ? 1 : 0;
      if (sending) {
        if (!at) at=now;
        if (now-at >= 90) { phase++; at=now; if (phase > 2) phase=-1; }
      }
      return value;
    },
    timedOut(now) { if (awaiting && now-started > 5000) { awaiting=false; phase=-1; return true; } return false; },
  };
}
