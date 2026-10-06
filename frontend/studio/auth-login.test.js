import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLoginDiagnosticText } from "./auth-login-diagnostics.js";

const here = dirname(fileURLToPath(import.meta.url));
const auth = readFileSync(join(here, "auth.js"), "utf8");
const app = readFileSync(join(here, "app.js"), "utf8");
const html = readFileSync(join(here, "../index.html"), "utf8");
const early = readFileSync(join(here, "../boot/early-boot.js"), "utf8");
const gs = readFileSync(join(here, "../site/getting-started.js"), "utf8");

test("studio login posts same-origin JSON to /api/auth/login, not the generation api() wrapper", () => {
  assert.match(auth, /postAuthJson\("\/api\/auth\/login"/);
  assert.match(auth, /export async function postAuthJson/);
  assert.match(auth, /new URL\(path, window\.location\.origin\)/);
  assert.doesNotMatch(auth, /api\("\/api\/auth\/login"/);
  assert.equal(auth.includes("supabase.co"), false);
  assert.equal(auth.includes("createClient"), false);
  assert.equal(auth.includes("/api/login\""), false);
});

test("HTTP login errors keep their status; network-only uses the reach message", () => {
  assert.match(auth, /function formatLoginError/);
  assert.match(auth, /if \(status === 401\) return raw \|\| "Invalid email or password"/);
  assert.match(auth, /if \(status > 0\) return raw \|\| `Login failed \(\$\{status\}\)`/);
  assert.match(auth, /Login did not reach the server/);
  assert.match(auth, /credentials:\s*"include"/);
  assert.match(app, /wrapped\.status = err\.status \|\| 0/);
});

test("cache-bust sblogin2 lands on shipped studio login modules", () => {
  assert.match(app, /auth\.js\?v=[^"']*sblogin2/);
  assert.match(early, /auth\.js\?v=[^"']*sblogin2/);
  assert.match(html, /app\.js\?v=[^"']*sblogin2/);
  assert.match(html, /early-boot\.js\?v=[^"']*sblogin2/);
  assert.match(gs, /auth\.js\?v=[^"']*sblogin2/);
});

test("cache-bust loginlog1 lands on shipped studio login modules", () => {
  assert.match(app, /auth\.js\?v=[^"']*loginlog1/);
  assert.match(early, /auth\.js\?v=[^"']*loginlog1/);
  assert.match(html, /app\.js\?v=[^"']*loginlog1/);
  assert.match(html, /early-boot\.js\?v=[^"']*loginlog1/);
  assert.match(html, /styles\.css\?v=[^"']*loginlog1/);
  assert.match(gs, /auth\.js\?v=[^"']*loginlog1/);
});

test("cache-bust loginfix1 lands on shipped studio login modules", () => {
  assert.match(app, /auth\.js\?v=[^"']*loginfix1/);
  assert.match(early, /auth\.js\?v=[^"']*loginfix1/);
  assert.match(html, /app\.js\?v=[^"']*loginfix1/);
  assert.match(html, /early-boot\.js\?v=[^"']*loginfix1/);
  assert.match(html, /styles\.css\?v=[^"']*loginfix1/);
  assert.match(gs, /auth\.js\?v=[^"']*loginfix1/);
});

test("login submit is single-flight and does not auto-retry POST", () => {
  assert.match(auth, /loginInFlight/);
  assert.match(auth, /e\.repeat/);
  assert.match(auth, /setLoginBusy/);
  const start = auth.indexOf('formLogin?.addEventListener("submit"');
  const end = auth.indexOf('formForgot?.addEventListener');
  assert.ok(start >= 0 && end > start);
  const loginBlock = auth.slice(start, end);
  assert.doesNotMatch(loginBlock, /isTransientAuthFailure/);
  assert.match(loginBlock, /if \(loginInFlight\) return/);
  assert.match(auth, /submit\.disabled = !!busy/);
});

test("login error banner exposes a clipboard icon and click-to-copy", () => {
  assert.match(auth, /auth-error-copy/);
  assert.match(auth, /AUTH_COPY_ICON/);
  assert.match(auth, /buildLoginDiagnosticText/);
  assert.match(auth, /Copied/);
});

test("clipboard payload omits password and includes status", () => {
  const text = buildLoginDiagnosticText(
    {
      timestamp: "2026-09-15T06:00:00.000Z",
      url: "https://studio.example/api/auth/login",
      status: 500,
      detail: "Login failed — the account service had an error.",
      request_id: "abc123def4",
      password: "super-secret-password",
      token: "eyJhbGciOiJIUzI1NiJ9.fake.jwt",
      authorization: "Bearer secret-token",
      cookie: "session=abc",
      body: { email: "sam@example.com", password: "super-secret-password" },
    },
    ["2026-09-15T06:00:00.000Z POST https://studio.example/api/auth/login → 500 abc123def4"],
  );
  assert.match(text, /http_status:\s*500/);
  assert.match(text, /request_id:\s*abc123def4/);
  assert.match(text, /https:\/\/studio\.example\/api\/auth\/login/);
  assert.match(text, /2026-09-15T06:00:00\.000Z/);
  assert.doesNotMatch(text, /super-secret-password/);
  assert.doesNotMatch(text, /eyJhbGciOiJIUzI1NiJ9/);
  assert.doesNotMatch(text, /secret-token/);
  assert.doesNotMatch(text, /session=abc/);
});
