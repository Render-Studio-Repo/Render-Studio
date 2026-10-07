/**
 * Record Render Studio X/promo (1280×720 MP4).
 *
 * Beat: opener → login as a1projects → click project a52d4071 (CAD/mesh tools)
 * → wiring simulator on 20069e9d → public share link → collab/VR slide → end card.
 *
 * Usage: node record-x-showme.mjs [baseUrl]
 *
 * Logs in with a password from env/keychain when available. Otherwise mints a
 * local JWT for a1projects and still shows the signed-in account on camera.
 * Never prints secrets.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const HEALTH_PROMO = "/Users/sam/AutoPrep/scripts/promo-record";
const require = createRequire(path.join(HEALTH_PROMO, "package.json"));
const puppeteer = require("puppeteer");
const ffmpegPath = require("ffmpeg-static");

const OUT_DIR = path.join(ROOT, "static", "promo");
const FRAMES_DIR = path.join(OUT_DIR, "_frames");
const RAW_MP4 = path.join(OUT_DIR, "_raw-showme.mp4");
const GRADED_MP4 = path.join(OUT_DIR, "render-studio-x-showme.mp4");
const DESKTOP_MP4 = path.join(os.homedir(), "Desktop", "render-studio-x-showme.mp4");
const LOGO = path.join(ROOT, "frontend/assets/brand/render3d-logo-transparent.png");
const BASE_DEFAULT = "http://127.0.0.1:8001";
const SHARE_TOKEN = "9MyeAHY4yNH0_JzaZXxvISPp";
const SHARE_PROD = `https://render3d.app/share/${SHARE_TOKEN}`;
const PROJECT_CAD = "a52d4071";
const PROJECT_WIRING = "20069e9d";
const VIEWPORT = { width: 1280, height: 720 };
const FPS = 16;
const TITLE_FONT = "/System/Library/Fonts/Supplemental/DIN Alternate Bold.ttf";
const BODY_FONT = "/System/Library/Fonts/Helvetica.ttc";
const A1_EMAIL = "a1projects@protonmail.com";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rimraf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function ensureDirs() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  rimraf(FRAMES_DIR);
  fs.mkdirSync(FRAMES_DIR, { recursive: true });
}

function runFfmpeg(args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed (${code}): ${err.slice(-1600)}`));
    });
  });
}

function ffprobeDuration(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-i", file], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("close", () => {
      const m = err.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) return reject(new Error(`Could not read duration for ${file}`));
      resolve((+m[1]) * 3600 + (+m[2]) * 60 + +m[3]);
    });
  });
}

function escapeDrawtext(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/'/g, "’").replace(/:/g, "\\:");
}

function probeHttp(url) {
  try {
    const r = spawnSync("curl", ["-sS", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "4", url], {
      encoding: "utf8",
    });
    return (r.stdout || "").trim() === "200";
  } catch {
    return false;
  }
}

function resolveBase(cli) {
  if (cli) return cli.replace(/\/$/, "");
  if (probeHttp("http://127.0.0.1:8001/")) return "http://127.0.0.1:8001";
  if (probeHttp("https://render3d.app/")) return "https://render3d.app";
  return BASE_DEFAULT;
}

function mintA1Session() {
  const py = path.join(ROOT, ".venv/bin/python3");
  const script = `
import json, os, sys
os.chdir(${JSON.stringify(ROOT)})
sys.path.insert(0, ${JSON.stringify(ROOT)})
from backend.auth import create_access_token, get_user_by_email
user = get_user_by_email(${JSON.stringify(A1_EMAIL)}) or get_user_by_email("a1projects.usa@gmail.com") or {}
uid = user.get("id")
if not uid:
    raise SystemExit("a1projects user not found")
print(json.dumps({"token": create_access_token(uid), "user": {
  "id": user.get("id"),
  "email": user.get("email"),
  "display_name": user.get("display_name"),
  "handle": user.get("handle"),
}}))
`;
  const r = spawnSync(py, ["-c", script], {
    cwd: ROOT,
    env: { ...process.env, PYTHONPATH: ROOT },
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(`Could not mint a1projects session: ${(r.stderr || r.stdout || "").slice(-800)}`);
  }
  const data = JSON.parse((r.stdout || "").trim().split("\n").pop());
  if (!data?.token || !data?.user?.email) throw new Error("Minted session missing token/user");
  return data;
}

function readKeychainPassword(account) {
  const tries = [
    ["security", "find-internet-password", "-s", "render3d.app", "-a", account, "-w"],
    ["security", "find-internet-password", "-a", account, "-w"],
    ["security", "find-generic-password", "-a", account, "-w"],
    ["security", "find-generic-password", "-s", "render3d.app", "-a", account, "-w"],
  ];
  for (const args of tries) {
    const r = spawnSync(args[0], args.slice(1), { encoding: "utf8" });
    const pw = (r.stdout || "").trim();
    if (r.status === 0 && pw) return pw;
  }
  return "";
}

async function loginViaApi(base, email, password) {
  try {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.token) return null;
    return {
      token: data.token,
      user: data.user || {
        id: data.id,
        email: data.email,
        display_name: data.display_name,
        handle: data.handle,
      },
    };
  } catch {
    return null;
  }
}

async function resolveSession(base) {
  const envPass = process.env.RENDER3D_PASSWORD || process.env.RENDER_STUDIO_PASSWORD || "";
  const envEmail = process.env.RENDER3D_EMAIL || A1_EMAIL;
  const kcPass = readKeychainPassword(A1_EMAIL) || readKeychainPassword("a1projects.usa@gmail.com");
  const password = envPass || kcPass;
  if (password) {
    const viaApi = await loginViaApi(base, envEmail, password);
    if (viaApi) {
      console.log("Session: password login (a1projects)");
      return { ...viaApi, how: "password", password };
    }
  }
  const minted = mintA1Session();
  console.log("Session: minted local JWT for a1projects");
  return { ...minted, how: "minted", password: "" };
}

async function encodeRaw(frameCount) {
  await runFfmpeg([
    "-y",
    "-framerate", String(FPS),
    "-i", path.join(FRAMES_DIR, "frame-%06d.jpg"),
    "-frames:v", String(frameCount),
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "17",
    "-pix_fmt", "yuv420p",
    "-vf", "scale=1280:720:flags=lanczos",
    "-movflags", "+faststart",
    RAW_MP4,
  ], "raw mp4");
}

async function makeBrandedCard({ file, kicker, title, sub, hold, extra = "" }) {
  const fadeOut = Math.max(0.2, hold - 0.32).toFixed(2);
  const texts = [
    `drawtext=fontfile='${TITLE_FONT}':text='${escapeDrawtext(kicker)}':fontcolor=0xf5f0e6:fontsize=22:x=(w-text_w)/2:y=368`,
    `drawtext=fontfile='${TITLE_FONT}':text='${escapeDrawtext(title)}':fontcolor=0xfafafa:fontsize=44:x=(w-text_w)/2:y=408`,
    `drawtext=fontfile='${BODY_FONT}':text='${escapeDrawtext(sub)}':fontcolor=0xd4d4d8:fontsize=22:x=(w-text_w)/2:y=470`,
  ];
  if (extra) {
    texts.push(`drawtext=fontfile='${BODY_FONT}':text='${escapeDrawtext(extra)}':fontcolor=0xa1a1aa:fontsize=18:x=(w-text_w)/2:y=512`);
  }
  const vfCore = [
    `drawbox=x=0:y=64:w=1280:h=2:color=0xe7e5e4@0.85:t=fill`,
    `drawbox=x=0:y=654:w=1280:h=2:color=0xfb923c@0.9:t=fill`,
    ...texts,
    `fade=t=in:st=0:d=0.2,fade=t=out:st=${fadeOut}:d=0.28`,
  ].join(",");

  const hasLogo = fs.existsSync(LOGO);
  if (hasLogo) {
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", `color=c=0x121214:s=1280x720:d=${hold}:r=30`,
      "-i", LOGO,
      "-filter_complex",
      `[1:v]scale=168:-1:flags=lanczos,format=rgba[logo];[0:v][logo]overlay=(W-w)/2:168[base];[base]${vfCore}[v]`,
      "-map", "[v]",
      "-t", String(hold),
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an",
      file,
    ], path.basename(file));
    return;
  }
  await runFfmpeg([
    "-y", "-f", "lavfi", "-i", `color=c=0x121214:s=1280x720:d=${hold}:r=30`,
    "-vf", vfCore,
    "-t", String(hold),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an",
    file,
  ], path.basename(file));
}

async function cutAndSpeed(input, output, { startFrame, endFrame, targetSecs }) {
  const start = Math.max(0, startFrame) / FPS;
  const dur = Math.max(0.5, (Math.max(startFrame + 4, endFrame) - startFrame) / FPS);
  const rate = dur / targetSecs;
  await runFfmpeg([
    "-y",
    "-ss", start.toFixed(3),
    "-t", dur.toFixed(3),
    "-i", input,
    "-filter:v", [
      `setpts=${(1 / rate).toFixed(5)}*PTS`,
      "fps=30",
      "scale=1280:720:flags=lanczos",
      "eq=contrast=1.08:saturation=1.0:gamma=1.02:brightness=0.03",
    ].join(","),
    "-t", String(targetSecs),
    "-an",
    "-c:v", "libx264", "-pix_fmt", "yuv420p",
    output,
  ], path.basename(output));
}

async function flashWipe(a, b, out, offset, duration = 0.28) {
  await runFfmpeg([
    "-y", "-i", a, "-i", b,
    "-filter_complex",
    `[0:v][1:v]xfade=transition=fadewhite:duration=${duration}:offset=${offset}[v]`,
    "-map", "[v]",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an",
    out,
  ], "wipe");
}

async function concatList(files, out) {
  const list = path.join(OUT_DIR, "_concat.txt");
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
  await runFfmpeg([
    "-y", "-f", "concat", "-safe", "0", "-i", list,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
    out,
  ], "concat");
  fs.rmSync(list, { force: true });
}

async function brandLowerThirds(input, output, chapters, totalSecs) {
  const chapFilters = chapters.map((c) => (
    `drawtext=fontfile='${TITLE_FONT}':text='${escapeDrawtext(c.label)}':fontcolor=0xfafafa:fontsize=16:x=w-text_w-22:y=10:enable='between(t,${c.start.toFixed(2)},${c.end.toFixed(2)})'`
  ));
  const vf = [
    `drawbox=x=0:y=0:w=iw:h=36:color=0x121214@0.42:t=fill`,
    `drawbox=x=0:y=ih-38:w=iw:h=38:color=0x121214@0.46:t=fill`,
    `drawbox=x=0:y=36:w=iw:h=1:color=0xe7e5e4@0.55:t=fill`,
    `drawbox=x=0:y=ih-38:w=iw:h=1:color=0xfb923c@0.8:t=fill`,
    `drawtext=fontfile='${TITLE_FONT}':text='RENDER STUDIO':fontcolor=0xf5f0e6:fontsize=16:x=20:y=9`,
    `drawtext=fontfile='${BODY_FONT}':text='render3d.app':fontcolor=0xd4d4d8:fontsize=14:x=20:y=h-26`,
    ...chapFilters,
    `fade=t=in:st=0:d=0.14`,
  ].join(",");
  await runFfmpeg([
    "-y", "-i", input, "-vf", vf,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", "-t", String(totalSecs),
    output,
  ], "brand");
}

function injectHud() {
  const css = `
    #rs-x-hud{position:fixed;top:8px;right:12px;z-index:2147483640;pointer-events:none;font-family:Inter,system-ui,sans-serif}
    #rs-x-hud .rec{display:flex;align-items:center;gap:7px;padding:5px 9px 5px 7px;border-radius:999px;background:rgba(18,18,20,.55);color:#f87171;letter-spacing:.16em;font-weight:700;font-size:11px}
    #rs-x-hud .rec i{display:inline-block;width:7px;height:7px;border-radius:50%;background:#f87171;box-shadow:0 0 8px #f87171;animation:xrec 1s ease-in-out infinite}
    @keyframes xrec{0%,100%{opacity:1}50%{opacity:.35}}
  `;
  const boot = () => {
    if (!document.documentElement) return;
    if (!document.getElementById("rs-x-hud-style")) {
      const s = document.createElement("style");
      s.id = "rs-x-hud-style";
      s.textContent = css;
      document.documentElement.appendChild(s);
    }
    if (!document.body || document.getElementById("rs-x-hud")) return;
    const hud = document.createElement("div");
    hud.id = "rs-x-hud";
    hud.innerHTML = '<span class="rec"><i></i>REC</span>';
    document.body.appendChild(hud);
  };
  document.addEventListener("DOMContentLoaded", boot);
  setInterval(boot, 250);
}

async function dismissChrome(page) {
  await page.evaluate(() => {
    document.getElementById("welcome-modal")?.classList.add("hidden");
    document.getElementById("ai-setup-intro-modal")?.classList.add("hidden");
    document.getElementById("trial-credits-modal")?.classList.add("hidden");
    document.getElementById("mesh-intro-modal")?.classList.add("hidden");
    document.getElementById("mesh-beta-intro-modal")?.classList.add("hidden");
    document.getElementById("handle-claim-modal")?.classList.add("hidden");
    document.getElementById("show-me-overlay")?.classList.add("hidden");
    document.getElementById("show-me-summary")?.remove();
    document.getElementById("studio-boot-suggest")?.classList.remove("is-open");
  }).catch(() => {});
}

async function safeClick(page, selector, opts = {}) {
  const timeout = opts.timeout ?? 7000;
  try {
    const handle = await page.waitForSelector(selector, { timeout, visible: true });
    if (!handle) return false;
    await handle.click({ delay: 35 });
    return true;
  } catch {
    return false;
  }
}

async function typeSlow(page, selector, text, delay = 22) {
  const el = await page.waitForSelector(selector, { timeout: 10000 });
  await page.evaluate((sel) => {
    const node = document.querySelector(sel);
    if (!node) return;
    node.scrollIntoView({ block: "center" });
    node.focus();
    if ("value" in node) node.value = "";
  }, selector);
  await el.click({ delay: 20 }).catch(() => {});
  await page.type(selector, text, { delay });
}

async function waitForStudio(page, { projects = false } = {}) {
  await page.waitForFunction((needProjects) => {
    const boot = document.getElementById("studio-boot-screen");
    const booting = !!(boot && !boot.classList.contains("is-done") && boot.offsetParent);
    const canvas = document.querySelector("#viewport canvas");
    const hasCanvas = !!(canvas && (canvas.clientWidth > 40 || canvas.width > 40));
    const items = document.querySelectorAll(".proj-item[data-project-id]").length;
    if (needProjects) return items > 0 && !booting;
    return !booting && !!(document.querySelector("#workspace-mode-btn") && (hasCanvas || document.querySelector("#prompt-input")));
  }, { timeout: 25000, polling: 400 }, projects).catch(() => {});
  await dismissChrome(page);
  await sleep(400);
}

async function openProjectByClick(page, projectId, base) {
  await page.evaluate(() => {
    const el = document.querySelector(".project-search-input");
    if (!el) return;
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }).catch(() => {});
  const search = await page.$(".project-search-input");
  if (search) {
    await search.click({ clickCount: 3 }).catch(() => {});
    await page.type(".project-search-input", projectId, { delay: 16 });
    await sleep(800);
  }
  await page.evaluate((id) => {
    const row = document.querySelector(`.proj-item[data-project-id="${id}"]`);
    row?.scrollIntoView({ block: "center" });
    (row?.querySelector(".proj-row-body, .proj-item-name, button") || row)?.click();
    window.__openProject?.(id);
  }, projectId);
  await sleep(900);
  await gotoReady(page, `${base}/?project=${encodeURIComponent(projectId)}`);
  await waitForStudio(page, { projects: false });
  await page.waitForFunction((id) => {
    const sub = document.getElementById("viewport-browser-sub")?.textContent || "";
    return sub.includes(id);
  }, { timeout: 20000 }, projectId).catch(() => {});
  await sleep(2600);
}

async function installSession(page, session) {
  await page.evaluate((token, user) => {
    try {
      localStorage.setItem("render3d:token", token);
      localStorage.setItem("render3d:user", JSON.stringify(user));
      sessionStorage.setItem("render3d:skipStudioBootOnce:v1", "1");
      localStorage.setItem("render3d:aiSetupIntroDismissed:v1", "1");
      if (user?.id) {
        localStorage.setItem("render3d:renderAgentSeen:" + user.id, "1");
        localStorage.setItem("render3d:aiSetupIntroDismissed:v1:" + user.id, "1");
      }
    } catch { /* ignore */ }
  }, session.token, session.user);
}

async function gotoReady(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await sleep(350);
  await dismissChrome(page);
}

async function clickProjectRow(page, projectId) {
  const sel = `.proj-item[data-project-id="${projectId}"]`;
  const found = await page.evaluate((id, selector) => {
    const row = document.querySelector(selector);
    if (!row) return false;
    row.scrollIntoView({ block: "center", inline: "nearest" });
    const body = row.querySelector(".proj-row-body, .proj-item-name, button, a") || row;
    body.click();
    return true;
  }, projectId, sel);
  if (found) {
    await sleep(400);
    return true;
  }
  return safeClick(page, sel, { timeout: 2500 });
}

async function orbitViewport(page) {
  const box = await page.evaluate(() => {
    const canvas = document.querySelector("#viewport canvas, #viewport, canvas");
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    if (r.width < 80 || r.height < 80) return null;
    return { x: r.x + r.width * 0.55, y: r.y + r.height * 0.48, w: r.width, h: r.height };
  });
  if (!box) return;
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  for (let i = 0; i < 18; i += 1) {
    await page.mouse.move(box.x + i * 14, box.y + Math.sin(i / 4) * 28, { steps: 3 });
    await sleep(40);
  }
  await page.mouse.up();
  await sleep(200);
  await page.mouse.move(box.x + 40, box.y - 20);
  await page.mouse.down({ button: "middle" }).catch(() => {});
  await page.mouse.move(box.x + 90, box.y + 30, { steps: 8 }).catch(() => {});
  await page.mouse.up({ button: "middle" }).catch(() => {});
}

async function signedInEmail(page) {
  return page.evaluate(() => {
    try {
      const raw = localStorage.getItem("render3d:user");
      const user = raw ? JSON.parse(raw) : null;
      return String(user?.email || document.getElementById("user-email")?.textContent || "").trim();
    } catch {
      return "";
    }
  }).catch(() => "");
}

async function openAuthModal(page) {
  await page.evaluate(() => {
    const modal = document.getElementById("auth-modal");
    modal?.classList.remove("hidden");
    if (modal) {
      modal.style.display = "flex";
      modal.style.zIndex = "2147483646";
    }
    document.getElementById("user-menu")?.classList.add("hidden");
    document.getElementById("login-email")?.focus();
  }).catch(() => {});
  await sleep(250);
}

async function showSignedIn(page) {
  await page.evaluate(() => {
    document.getElementById("auth-modal")?.classList.add("hidden");
    document.getElementById("user-menu")?.classList.remove("hidden");
  }).catch(() => {});
  await page.waitForSelector("#user-menu:not(.hidden) #user-email, #user-label", { timeout: 6000 }).catch(() => {});
  await sleep(1200);
}

async function openWiringMode(page) {
  const opened = await page.evaluate(() => {
    const btn = document.getElementById("workspace-mode-btn");
    btn?.click();
    return !!btn;
  });
  await sleep(400);
  const hit = await page.evaluate(() => {
    const opt = [...document.querySelectorAll(".workspace-mode-option, [role='menuitem']")]
      .find((el) => /wiring/i.test(el.textContent || ""));
    opt?.click();
    return !!opt;
  });
  if (!hit && opened) {
    await page.goto(`${page.url().split("?")[0]}?project=${PROJECT_WIRING}&designTab=WIRING`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    }).catch(() => {});
  }
  await sleep(800);
  await dismissChrome(page);
}

async function main() {
  ensureDirs();
  const BASE = resolveBase(process.argv[2]);
  const session = await resolveSession(BASE);
  console.log(`Recording Render Studio promo from ${BASE}`);

  const localShare = `${BASE}/share/${SHARE_TOKEN}`;
  const shareUrl = probeHttp(localShare) ? localShare : SHARE_PROD;

  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: VIEWPORT,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--autoplay-policy=no-user-gesture-required",
      "--ignore-gpu-blocklist",
      "--enable-webgl",
      "--use-gl=angle",
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
    ],
  });

  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);
  page.setDefaultTimeout(18000);
  page.on("pageerror", (err) => {
    const msg = String(err?.message || err);
    if (/failed to start|startApp|Editor/i.test(msg)) console.log("pageerror:", msg.slice(0, 180));
  });
  await page.evaluateOnNewDocument(injectHud);
  await page.evaluateOnNewDocument(() => {
    try {
      sessionStorage.setItem("render3d:skipStudioBootOnce:v1", "1");
      localStorage.setItem("render3d:aiSetupIntroDismissed:v1", "1");
      localStorage.setItem("render3d:renderAgentSeen:anonymous", "1");
    } catch { /* ignore */ }
  });

  const chapters = [];
  let frameIndex = 0;
  let lastWrite = 0;
  const mark = (id, label) => {
    chapters.push({ id, label, frame: frameIndex });
    console.log(`chapter ${id} @ frame ${frameIndex}`);
  };

  const cdp = await page.createCDPSession();
  await cdp.send("Page.startScreencast", {
    format: "jpeg",
    quality: 90,
    maxWidth: VIEWPORT.width,
    maxHeight: VIEWPORT.height,
    everyNthFrame: 1,
  });
  cdp.on("Page.screencastFrame", async (frame) => {
    try {
      const now = Date.now();
      if (now - lastWrite >= Math.floor(1000 / FPS) - 4) {
        const file = path.join(FRAMES_DIR, `frame-${String(frameIndex).padStart(6, "0")}.jpg`);
        fs.writeFileSync(file, Buffer.from(frame.data, "base64"));
        frameIndex += 1;
        lastWrite = now;
        if (frameIndex % 24 === 0) process.stdout.write(`\rframes: ${frameIndex}`);
      }
      await cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
    } catch { /* ignore mid-shutdown */ }
  });

  const started = Date.now();

  // 1. Login (before any studio tour)
  mark("login", "SIGN IN");
  await gotoReady(page, `${BASE}/`);
  await waitForStudio(page, { projects: false });
  await dismissChrome(page);
  await sleep(500);
  await openAuthModal(page);
  try {
    await page.waitForSelector("#login-email", { timeout: 8000 });
    await typeSlow(page, "#login-email", A1_EMAIL, 26);
    await sleep(250);
    if (session.how === "password" && session.password) {
      await typeSlow(page, "#login-password", session.password, 16);
      await sleep(200);
      await safeClick(page, "#auth-form-login .auth-submit, #auth-form-login button[type='submit']");
      await sleep(1600);
    } else {
      await page.focus("#login-password").catch(() => {});
      await sleep(800);
    }
  } catch (err) {
    console.log("Login form interaction skipped:", err.message || "error");
  }
  await installSession(page, session);
  await page.evaluateOnNewDocument((token, user) => {
    try {
      localStorage.setItem("render3d:token", token);
      localStorage.setItem("render3d:user", JSON.stringify(user));
      sessionStorage.setItem("render3d:skipStudioBootOnce:v1", "1");
      localStorage.setItem("render3d:aiSetupIntroDismissed:v1", "1");
      if (user?.id) {
        localStorage.setItem("render3d:renderAgentSeen:" + user.id, "1");
        localStorage.setItem("render3d:aiSetupIntroDismissed:v1:" + user.id, "1");
      }
    } catch { /* ignore */ }
  }, session.token, session.user);
  await showSignedIn(page);
  const who = await signedInEmail(page);
  console.log(`Signed-in account visible: ${who ? "yes" : "unknown"}`);
  await sleep(1400);
  await page.mouse.click(24, 70).catch(() => {});
  await sleep(350);

  // 2. Brief docs establishing shot (not the meat)
  mark("docs", "DOCS");
  await gotoReady(page, `${BASE}/getting-started.html`);
  await page.waitForSelector(".gs-hero, .gs-page, h1", { timeout: 15000 }).catch(() => {});
  await sleep(1600);

  // 3. Open CAD/mesh project by clicking it (URL fallback if the list is still hydrating)
  mark("cad", "CAD + MESH");
  await installSession(page, session);
  await gotoReady(page, `${BASE}/`);
  await waitForStudio(page, { projects: false });
  await sleep(900);
  await openProjectByClick(page, PROJECT_CAD, BASE);
  await sleep(2200);
  await orbitViewport(page);
  await sleep(400);
  await safeClick(page, '[data-prompt-mode="v2"]');
  await sleep(400);
  try {
    await typeSlow(page, "#prompt-input", "90 mm mounting flange, 4 bolt holes, 3 mm wall, filleted edges", 16);
  } catch { /* ignore */ }
  await sleep(700);
  await page.hover("#btn-prompt").catch(() => {});
  await sleep(400);
  await safeClick(page, '[data-prompt-mode="mesh"]');
  await sleep(500);
  try {
    await page.click("#prompt-input", { clickCount: 3 });
    await page.keyboard.press("Backspace");
    await page.type("#prompt-input", "Photoreal enclosure mesh, keep overall proportions and port cutouts", { delay: 14 });
  } catch { /* ignore */ }
  await sleep(900);
  await page.hover("#btn-prompt").catch(() => {});
  await sleep(500);

  // 4. Wiring simulator — use the real UI
  mark("wiring", "WIRING SIMULATOR");
  await gotoReady(page, `${BASE}/`);
  await waitForStudio(page, { projects: false });
  await openProjectByClick(page, PROJECT_WIRING, BASE);
  await sleep(800);
  await openWiringMode(page);
  await page.waitForSelector(".wiring-part, #btn-wiring-code, .wiring-parts-layer", { timeout: 18000 }).catch(() => {});
  await sleep(2200);
  await page.evaluate(() => {
    const part = document.querySelector(".wiring-part, .wiring-part--arduino, .wiring-part--mcu");
    part?.scrollIntoView({ block: "center" });
    part?.click();
  });
  await sleep(1400);
  await safeClick(page, "#btn-wiring-code, #btn-wiring-code-panel");
  await sleep(1400);
  await safeClick(page, "#btn-wiring-run-schematic, button[title*='Simulat']");
  await sleep(1200);
  await page.evaluate(() => {
    document.querySelector(".wiring-part:nth-of-type(2), .wiring-part")?.click();
  });
  await sleep(800);

  // 5. Public share link
  mark("share", "SHARE LINK");
  await gotoReady(page, shareUrl);
  await page.waitForSelector("#share-title, #share-viewer, #btn-share-open", { timeout: 25000 }).catch(() => {});
  await sleep(1600);
  await orbitViewport(page);
  await safeClick(page, "#btn-share-inspector");
  await sleep(900);
  await safeClick(page, "#btn-share-open");
  await sleep(1400);
  await page.evaluate(() => {
    document.querySelector(".share-remix-collab, #share-remix-workspace-host")
      ?.scrollIntoView({ block: "center" });
  }).catch(() => {});
  await sleep(1000);

  // Brief collab chrome if still in remix modal / then studio collab if needed
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(300);

  await sleep(500);
  try { await cdp.send("Page.stopScreencast"); } catch { /* ignore */ }
  await browser.close();

  const elapsed = (Date.now() - started) / 1000;
  console.log(`\nCaptured ${frameIndex} frames in ${elapsed.toFixed(1)}s`);
  if (frameIndex < 40) throw new Error("Too few frames — is studio running?");

  console.log("Encoding raw capture…");
  await encodeRaw(frameIndex);

  const title = path.join(OUT_DIR, "_title.mp4");
  const collab = path.join(OUT_DIR, "_collab.mp4");
  const end = path.join(OUT_DIR, "_end.mp4");
  const titleHold = 2.7;
  const collabHold = 4.2;
  const endHold = 4.4;
  const wipe = 0.28;

  const bounds = chapters.map((c, i) => {
    const next = chapters[i + 1];
    return { ...c, startFrame: c.frame, endFrame: next ? next.frame : frameIndex - 1 };
  });

  const targets = {
    login: 7.5,
    docs: 1.8,
    cad: 22.0,
    wiring: 16.0,
    share: 14.0,
  };

  const cuts = [];
  for (const ch of bounds) {
    const secs = targets[ch.id];
    if (!secs || ch.endFrame - ch.startFrame < 6) continue;
    const file = path.join(OUT_DIR, `_ch-${ch.id}.mp4`);
    await cutAndSpeed(RAW_MP4, file, {
      startFrame: Math.max(0, ch.startFrame),
      endFrame: ch.endFrame,
      targetSecs: secs,
    });
    cuts.push({ ...ch, file, secs });
  }

  console.log("Building title / collab / end cards…");
  await Promise.all([
    makeBrandedCard({
      file: title,
      hold: titleHold,
      kicker: "RENDER STUDIO",
      title: "Open Source Project soon to be",
      sub: "render3d.app",
      extra: "AI CAD  ·  Wiring  ·  Collab  ·  VR Studio",
    }),
    makeBrandedCard({
      file: collab,
      hold: collabHold,
      kicker: "COLLABORATIVE FEATURES",
      title: "VR Studio",
      sub: "Live collab  ·  shared workspaces  ·  immersive VR",
      extra: "Design together in the browser and in headset",
    }),
    makeBrandedCard({
      file: end,
      hold: endHold,
      kicker: "GOING OPEN SOURCE",
      title: "A1_Projects",
      sub: "More info and early access to the repo",
      extra: "render3d.app",
    }),
  ]);

  if (!cuts.length) throw new Error("No chapter cuts produced");

  const pieces = [
    { file: title, secs: titleHold, label: "OPENER", kind: "card" },
    ...cuts.map((c) => ({ file: c.file, secs: c.secs, label: c.label, kind: "cut" })),
    { file: collab, secs: collabHold, label: "COLLAB + VR STUDIO", kind: "card" },
    { file: end, secs: endHold, label: "END", kind: "card" },
  ];

  let current = pieces[0].file;
  let acc = pieces[0].secs;
  const merged = [{ ...pieces[0], start: 0, end: acc }];
  for (let i = 1; i < pieces.length; i += 1) {
    const next = pieces[i];
    const out = path.join(OUT_DIR, `_mid-${i}.mp4`);
    await flashWipe(current, next.file, out, Math.max(0.2, acc - wipe), wipe);
    current = out;
    acc = acc + next.secs - wipe;
    merged.push({ ...next, start: acc - next.secs + wipe, end: acc });
  }

  const bodyTimed = path.join(OUT_DIR, "_body.mp4");
  fs.copyFileSync(current, bodyTimed);
  const bodyDur = await ffprobeDuration(bodyTimed);
  const hudChapters = merged.map((c) => ({
    label: c.label,
    start: Math.max(0, c.start),
    end: c.end,
  }));
  const finalDur = Math.min(90, bodyDur);
  await brandLowerThirds(bodyTimed, GRADED_MP4, hudChapters, finalDur);

  fs.copyFileSync(GRADED_MP4, DESKTOP_MP4);

  const extras = [RAW_MP4, title, collab, end, bodyTimed, ...cuts.map((c) => c.file)];
  for (const extra of extras) fs.rmSync(extra, { force: true });
  for (const f of fs.readdirSync(OUT_DIR).filter((n) => n.startsWith("_mid-") || n.startsWith("_ch-") || n.startsWith("_concat"))) {
    fs.rmSync(path.join(OUT_DIR, f), { force: true });
  }
  rimraf(FRAMES_DIR);

  const dur = await ffprobeDuration(GRADED_MP4);
  const stat = fs.statSync(GRADED_MP4);
  console.log("\nDone");
  console.log(`MP4  → ${GRADED_MP4}`);
  console.log(`Copy → ${DESKTOP_MP4}`);
  console.log(`Duration: ${dur.toFixed(2)}s`);
  console.log(`Size: ${(stat.size / (1024 * 1024)).toFixed(2)} MB`);
  console.log("Beat sheet:");
  for (const row of merged) {
    const mm = Math.floor(Math.max(0, row.start) / 60);
    const ss = Math.round(Math.max(0, row.start) % 60).toString().padStart(2, "0");
    console.log(`  ${mm}:${ss}  ${row.label}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
