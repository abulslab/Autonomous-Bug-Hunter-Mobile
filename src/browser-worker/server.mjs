// Bug Hunter mobile & browser worker: owns Appium/ADB Android Emulator control plus mobile viewport sessions.
// Protocol (JSON over HTTP):
//   POST /sessions, POST /sessions/:id/snapshot, POST /sessions/:id/act, POST /sessions/:id/request, DELETE /sessions/:id
//   GET /device/status, POST /device/emulator/start, POST /device/emulator/show, POST /device/emulator/stop,
//   POST /device/appium/start, GET /device/stream, GET /healthz.
// Safety: per-session host allowlist (every other request is aborted), secrets substituted here and masked in everything returned.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { chromium, request as pwRequest } from "playwright";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const APK_DIR = path.join(REPO_ROOT, "android", "apks");

const PORT = Number(process.env.PORT ?? 5299);
const HOST = process.env.HOST ?? "127.0.0.1";
const TOKEN = process.env.WORKER_TOKEN ?? "";
const IDLE_MS = Number(process.env.SESSION_IDLE_MS ?? 10 * 60_000);
const MAX_SESSIONS = Number(process.env.MAX_SESSIONS ?? 4);
const MAX_ELEMENTS = 150;
const MAX_TEXT = 6000;
const MAX_BODY = 20_000;
const VIDEO_DIR = process.env.VIDEO_DIR ?? path.join(os.tmpdir(), "bughunter-mobile-videos");
const CURSOR_MS = Number(process.env.CURSOR_MS ?? 350);
const AVD_NAME = process.env.ANDROID_AVD ?? "Pixel_8";
const APPIUM_PORT = Number(process.env.APPIUM_PORT ?? 4723);
const APPIUM_URL = `http://127.0.0.1:${APPIUM_PORT}`;
const MOBILE_VIEWPORT = { width: 412, height: 915 };
const MOBILE_UA = "Mozilla/5.0 (Linux; Android 16; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36 Appium/UiAutomator2";

// The file's modification time identifies this build, so the API can replace a worker left running from older code.
const BUILD = String(Math.round(fs.statSync(new URL(import.meta.url)).mtimeMs));
const videos = new Map(); // session id -> { file, at } for recordings of closed sessions

const APK_CATALOG = [
  { app: "shop", name: "DemoShopMobile.apk", package: "com.bughunter.mobile.shop", activity: "com.bughunter.mobile.MainActivity", port: 5290 },
  { app: "hotel", name: "DemoHotelMobile.apk", package: "com.bughunter.mobile.hotel", activity: "com.bughunter.mobile.MainActivity", port: 5291 },
  { app: "voice", name: "VoiceAppointmentMobile.apk", package: "com.bughunter.mobile.voice", activity: "com.bughunter.mobile.MainActivity", port: 5299 }
];

function resolveSdkRoot() {
  const candidates = [
    process.env.ANDROID_SDK_ROOT,
    process.env.ANDROID_HOME,
    process.platform === "win32" ? path.join(os.homedir(), "AppData", "Local", "Android", "Sdk") : null,
    process.platform === "darwin" ? path.join(os.homedir(), "Library", "Android", "sdk") : null,
    path.join(os.homedir(), "Android", "Sdk")
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[0] ?? "";
}

function sdkBin(tool) {
  const root = resolveSdkRoot();
  const ext = process.platform === "win32" ? ".exe" : "";
  if (tool === "adb") {
    const p = path.join(root, "platform-tools", `adb${ext}`);
    return fs.existsSync(p) ? p : "adb";
  }
  if (tool === "emulator") {
    const p = path.join(root, "emulator", `emulator${ext}`);
    return fs.existsSync(p) ? p : "emulator";
  }
  return tool;
}

function resolveAppiumCmd() {
  if (process.env.APPIUM_CMD) return process.env.APPIUM_CMD;
  if (process.platform === "win32") {
    const npmBin = path.join(os.homedir(), "AppData", "Roaming", "npm", "appium.cmd");
    if (fs.existsSync(npmBin)) return npmBin;
  }
  return "appium";
}

async function runAdb(args, timeout = 8000) {
  try {
    const { stdout } = await execFileAsync(sdkBin("adb"), args, { timeout, windowsHide: true });
    return String(stdout ?? "").trim();
  } catch {
    return "";
  }
}

async function detectEmulator() {
  const out = await runAdb(["devices"], 4000);
  const lines = out.split(/\r?\n/).slice(1);
  for (const line of lines) {
    const m = line.trim().match(/^(emulator-\d+)\s+(\S+)/);
    if (m) {
      const serial = m[1];
      const state = m[2];
      if (state !== "device") return { status: "booting", serial };
      const boot = await runAdb(["-s", serial, "shell", "getprop", "sys.boot_completed"], 3000);
      return { status: boot === "1" ? "running" : "booting", serial };
    }
  }
  return { status: "stopped", serial: null };
}

async function isAppiumRunning() {
  try {
    const res = await fetch(`${APPIUM_URL}/status`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function deviceStatus() {
  const [emu, appiumUp] = await Promise.all([detectEmulator(), isAppiumRunning()]);
  let installedPkgs = "";
  if (emu.status === "running" && emu.serial) {
    installedPkgs = await runAdb(["-s", emu.serial, "shell", "pm", "list", "packages", "com.bughunter.mobile"], 4000);
  }
  const apks = APK_CATALOG.map((item) => {
    const full = path.join(APK_DIR, item.name);
    const built = fs.existsSync(full);
    const sizeBytes = built ? fs.statSync(full).size : 0;
    const installed = installedPkgs.includes(`package:${item.package}`);
    return { ...item, built, sizeBytes, installed };
  });
  return {
    device: AVD_NAME,
    platform: "Android 16 (API 36)",
    driver: "UiAutomator2",
    emulator: emu.status,
    serial: emu.serial,
    appium: appiumUp ? "running" : "stopped",
    appiumUrl: APPIUM_URL,
    automation: emu.status === "running" && appiumUp ? "ready" : "simulator",
    apks
  };
}

async function startAppiumServer() {
  if (await isAppiumRunning()) return true;
  const cmd = resolveAppiumCmd();
  const child = spawn(cmd, ["--port", String(APPIUM_PORT), "--allow-insecure", "uiautomator2:chromedriver_autodownload"], {
    detached: true,
    stdio: "ignore",
    shell: process.platform === "win32",
    windowsHide: true
  });
  child.unref();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isAppiumRunning()) return true;
  }
  return false;
}

async function ensureEmulatorsAndApks({ app = "shop", showWindow = true } = {}) {
  let emu = await detectEmulator();
  if (emu.status === "stopped") {
    const args = ["-avd", AVD_NAME, "-no-snapshot-load", "-gpu", "swiftshader_indirect"];
    if (!showWindow) args.push("-qt-hide-window");
    const child = spawn(sdkBin("emulator"), args, {
      detached: true,
      stdio: "ignore",
      windowsHide: !showWindow
    });
    child.unref();
  }
  for (let i = 0; i < 60; i++) {
    emu = await detectEmulator();
    if (emu.status === "running" && emu.serial) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (emu.status === "running" && emu.serial) {
    const s = emu.serial;
    await Promise.all([
      runAdb(["-s", s, "reverse", "tcp:5290", "tcp:5290"]),
      runAdb(["-s", s, "reverse", "tcp:5291", "tcp:5291"]),
      runAdb(["-s", s, "reverse", "tcp:5299", "tcp:5299"]),
      runAdb(["-s", s, "forward", "tcp:18080", "tcp:8080"])
    ]);
    const installedPkgs = await runAdb(["-s", s, "shell", "pm", "list", "packages", "com.bughunter.mobile"], 5000);
    for (const item of APK_CATALOG) {
      const apkPath = path.join(APK_DIR, item.name);
      if (fs.existsSync(apkPath) && !installedPkgs.includes(`package:${item.package}`)) {
        await runAdb(["-s", s, "install", "-r", apkPath], 30_000);
      }
    }
    const target = APK_CATALOG.find((a) => a.app === app) ?? APK_CATALOG[0];
    await runAdb(["-s", s, "shell", "am", "start", "-n", `${target.package}/${target.activity}`], 6000);
  }
  await startAppiumServer();
  return deviceStatus();
}

async function showEmulatorWindow() {
  const emu = await detectEmulator();
  if (emu.status === "stopped") return ensureEmulatorsAndApks({ showWindow: true });
  if (process.platform === "win32") {
    const ps = `
      Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class Win32 {
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
      }
"@
      $procs = Get-Process | Where-Object { $_.ProcessName -match "qemu-system|emulator" -and $_.MainWindowHandle -ne 0 }
      foreach ($p in $procs) {
        [Win32]::ShowWindowAsync($p.MainWindowHandle, 9) | Out-Null
        [Win32]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
      }
    `;
    await execFileAsync("powershell", ["-NoProfile", "-Command", ps], { timeout: 5000, windowsHide: true }).catch(() => {});
  }
  return deviceStatus();
}

async function stopEmulatorDevice() {
  const emu = await detectEmulator();
  if (emu.serial) {
    await runAdb(["-s", emu.serial, "emu", "kill"], 5000);
    await new Promise((r) => setTimeout(r, 1000));
  }
  return deviceStatus();
}

function streamDevice(res) {
  res.writeHead(200, { "content-type": "multipart/x-mixed-replace; boundary=frame", "cache-control": "no-store", connection: "close" });
  let closed = false;
  res.on("close", () => { closed = true; });
  (async () => {
    while (!closed) {
      const emu = await detectEmulator();
      if (emu.status !== "running" || !emu.serial) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      try {
        const { stdout } = await execFileAsync(sdkBin("adb"), ["-s", emu.serial, "exec-out", "screencap", "-p"], {
          encoding: "buffer",
          maxBuffer: 15 * 1024 * 1024,
          timeout: 4000,
          windowsHide: true
        });
        if (stdout && stdout.length > 100 && !closed) {
          res.write(`--frame\r\nContent-Type: image/png\r\nContent-Length: ${stdout.length}\r\n\r\n`);
          res.write(stdout);
          res.write("\r\n");
        }
      } catch {
        // Retry next frame
      }
      await new Promise((r) => setTimeout(r, 450));
    }
  })();
}

function resolveTargetApkForUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.port === "5291" || u.pathname.includes("hotel")) return APK_CATALOG[1];
    if (u.pathname.includes("voice")) return APK_CATALOG[2];
    if (u.port === "5290" || u.pathname.includes("shop")) return APK_CATALOG[0];
  } catch { /* ignore */ }
  return APK_CATALOG[0];
}

let browser;
async function getBrowser() {
  if (!browser || !browser.isConnected()) browser = await chromium.launch({ headless: process.env.HEADED !== "1" });
  return browser;
}

const sessions = new Map();

function hostAllowed(s, raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol === "data:" || u.protocol === "blob:" || u.protocol === "about:") return true;
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  return s.allowed.has(u.hostname.toLowerCase());
}

// Secret values never leave the worker: anything returned has them replaced by their {{secret:name}} reference.
function mask(s, text) {
  if (typeof text !== "string" || !text) return text;
  for (const [name, value] of Object.entries(s.secrets)) if (value && value.length >= 3) text = text.split(value).join(`{{secret:${name}}}`);
  return text;
}

// Injected into every screen: a touch indicator, tap ripple and action label drawn inside a closed shadow root, so they
// appear in the live stream and the recording but never in the screen text or element list the hunter reads.
const CURSOR_SCRIPT = `(() => {
  if (window.__hh) return;
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  const root = host.attachShadow({ mode: "closed" });
  root.innerHTML = '<style>.c{position:fixed;left:0;top:0;width:22px;height:22px;transition:transform .3s ease;filter:drop-shadow(0 1px 2px rgba(0,0,0,.45))}' +
    '.r{position:fixed;width:36px;height:36px;margin:-18px 0 0 -18px;border:3px solid #6366f1;border-radius:50%;opacity:0}' +
    '.r.on{animation:p .6s ease-out}@keyframes p{0%{opacity:1;transform:scale(.4)}100%{opacity:0;transform:scale(1.8)}}' +
    '.b{position:fixed;outline:2px dashed #6366f1;outline-offset:2px;border-radius:4px;transition:all .3s ease;opacity:0}' +
    '.m{position:fixed;background:#1e1b4b;color:#c7d2fe;font:600 11px system-ui,sans-serif;display:flex;align-items:center;padding-left:8px;border-radius:4px}' +
    '.l{position:fixed;padding:3px 8px;border-radius:6px;background:#312e81;color:#fff;font:600 12px system-ui,sans-serif;white-space:nowrap;opacity:0;transition:opacity .2s}</style>' +
    '<div class="masks"></div><div class="b"></div><div class="r"></div><div class="l"></div>' +
    '<svg class="c" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="rgba(99,102,241,0.85)" stroke="#fff" stroke-width="2"/></svg>';
  const [box, ring, label, cur] = ["b", "r", "l", "c"].map((c) => root.querySelector("." + c));
  const mount = () => { if (!host.isConnected && document.documentElement) document.documentElement.appendChild(host); };
  mount(); document.addEventListener("DOMContentLoaded", mount);
  const masks = root.querySelector(".masks");
  const cover = () => {
    const els = document.querySelectorAll("[data-hh-secret]");
    masks.innerHTML = "";
    for (const e of els) {
      const r = e.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const m = document.createElement("div"); m.className = "m"; m.textContent = "secret";
      Object.assign(m.style, { left: r.x + "px", top: r.y + "px", width: r.width + "px", height: r.height + "px" });
      masks.appendChild(m);
    }
    requestAnimationFrame(cover);
  };
  requestAnimationFrame(cover);
  window.__hh = {
    point(r, text) {
      mount();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      cur.style.transform = "translate(" + (x - 11) + "px," + (y - 11) + "px)";
      Object.assign(box.style, { left: r.x + "px", top: r.y + "px", width: r.width + "px", height: r.height + "px", opacity: 1 });
      label.textContent = text; Object.assign(label.style, { left: Math.max(4, r.x) + "px", top: Math.max(4, r.y - 26) + "px", opacity: text ? 1 : 0 });
    },
    click(r) {
      Object.assign(ring.style, { left: r.x + r.width / 2 + "px", top: r.y + r.height / 2 + "px" });
      ring.classList.remove("on"); void ring.offsetWidth; ring.classList.add("on");
    },
    clear() { box.style.opacity = 0; label.style.opacity = 0; }
  };
})();`;

function actionLabel(a) {
  const v = String(a.value ?? "");
  const shown = /^\{\{secret:/.test(v) ? "••••" : v.length > 30 ? v.slice(0, 30) + "…" : v;
  return { click: "Tap", fill: `Type "${shown}"`, select: `Select "${shown}"`, check: a.value === "false" ? "Uncheck" : "Check", press: `Key ${a.key || "Enter"}` }[a.type] ?? "";
}

async function startScreencast(s) {
  if (s.cdp || s.viewers.size === 0) return;
  const page = s.page;
  const cdp = await s.context.newCDPSession(page);
  s.cdp = cdp; s.cdpPage = page;
  cdp.on("Page.screencastFrame", ({ data, sessionId }) => {
    s.frame = Buffer.from(data, "base64");
    for (const v of s.viewers) writeFrame(v, s.frame);
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 65, maxWidth: 412, maxHeight: 915, everyNthFrame: 1 });
}

async function stopScreencast(s) {
  const cdp = s.cdp; s.cdp = null;
  if (cdp) { await cdp.send("Page.stopScreencast").catch(() => {}); await cdp.detach().catch(() => {}); }
}

function writeFrame(res, frame) {
  res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
  res.write(frame);
  res.write("\r\n");
}

function stream(s, res) {
  res.writeHead(200, { "content-type": "multipart/x-mixed-replace; boundary=frame", "cache-control": "no-store", connection: "close" });
  s.viewers.add(res);
  if (s.frame) writeFrame(res, s.frame);
  startScreencast(s).catch(() => {});
  res.on("close", () => { s.viewers.delete(res); if (s.viewers.size === 0) stopScreencast(s); });
}

const subst = (s, v) => String(v ?? "").replace(/\{\{secret:([\w.-]+)\}\}/g, (m, n) => (n in s.secrets ? s.secrets[n] : m));

function attach(s, page) {
  s.inflight = 0;
  const api = (r) => ["xhr", "fetch"].includes(r.resourceType());
  page.on("request", (r) => { if (api(r)) s.inflight++; });
  page.on("requestfinished", (r) => { if (api(r)) s.inflight = Math.max(0, s.inflight - 1); });
  page.on("framenavigated", (f) => { if (f === page.mainFrame() && s.cdp && s.cdpPage !== s.page) stopScreencast(s).then(() => startScreencast(s)); });
  page.on("console", (m) => { if (m.type() === "error") s.events.console.push({ kind: "console", text: mask(s, m.text()).slice(0, 500), url: page.url() }); });
  page.on("pageerror", (e) => s.events.console.push({ kind: "pageerror", text: mask(s, String(e?.message ?? e)).slice(0, 500), url: page.url() }));
  page.on("dialog", (d) => { s.events.dialogs.push({ type: d.type(), message: mask(s, d.message()).slice(0, 500) }); d.accept().catch(() => {}); });
  page.on("requestfailed", (r) => {
    if (api(r)) s.inflight = Math.max(0, s.inflight - 1);
    if (r.failure()?.errorText?.includes("BLOCKED")) return;
    s.events.network.push({ method: r.method(), url: r.url(), status: 0, resourceType: r.resourceType(), failed: r.failure()?.errorText ?? "failed" });
  });
  page.on("response", async (r) => {
    const req = r.request(), type = req.resourceType();
    if (!["xhr", "fetch", "document"].includes(type)) { if (r.status() >= 400) s.events.network.push({ method: req.method(), url: r.url(), status: r.status(), resourceType: type }); return; }
    const e = { method: req.method(), url: r.url(), status: r.status(), resourceType: type, at: Date.now() };
    if (type !== "document") {
      e.rid = ++s.rid;
      s.requests.set(e.rid, { method: req.method(), url: r.url(), headers: await req.allHeaders().catch(() => req.headers()), body: req.postData() ?? null });
      if (s.requests.size > 500) s.requests.delete(s.requests.keys().next().value);
    }
    const post = req.postData();
    if (post) e.requestBody = mask(s, post.slice(0, MAX_BODY));
    if ((r.headers()["content-type"] ?? "").includes("json")) {
      try { e.body = mask(s, (await r.text()).slice(0, MAX_BODY)); } catch { /* body unavailable after navigation */ }
    }
    s.events.network.push(e);
  });
}

function collect({ maxElements, maxText }) {
  const SEL = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=option],[role=switch],[contenteditable=""],[contenteditable=true],[onclick]';
  document.querySelectorAll("[data-hh-ref]").forEach((e) => e.removeAttribute("data-hh-ref"));
  const clean = (t) => (t ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const visible = (e) => {
    if (e.type === "hidden") return false;
    const r = e.getBoundingClientRect(), st = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && st.visibility !== "hidden" && st.display !== "none" && !e.closest("[hidden],[aria-hidden=true]");
  };
  const ROLE = { A: "link", BUTTON: "button", SELECT: "combobox", TEXTAREA: "textbox", SUMMARY: "button" };
  const INPUT_ROLE = { checkbox: "checkbox", radio: "radio", submit: "button", button: "button", reset: "button", image: "button", range: "slider", number: "spinbutton", search: "searchbox" };
  const roleOf = (e) => e.getAttribute("role") || ROLE[e.tagName] || (e.tagName === "INPUT" ? INPUT_ROLE[e.type] || "textbox" : "generic");
  const labelOf = (e) => {
    const by = e.getAttribute("aria-labelledby");
    if (by) return clean(by.split(/\s+/).map((id) => document.getElementById(id)?.innerText ?? "").join(" "));
    if (e.labels?.length) return clean(e.labels[0].innerText);
    return clean(e.closest("label")?.innerText);
  };
  const field = (e) => ["INPUT", "SELECT", "TEXTAREA"].includes(e.tagName);
  const nameOf = (e) => {
    const aria = clean(e.getAttribute("aria-label"));
    if (aria) return aria;
    if (field(e)) return labelOf(e) || clean(e.placeholder) || clean(e.title) || clean(e.name);
    return clean(e.innerText) || clean(e.value) || clean(e.title) || clean(e.querySelector("img")?.alt);
  };
  const out = [];
  let n = 0;
  for (const e of document.querySelectorAll(SEL)) {
    if (out.length >= maxElements) break;
    if (!visible(e)) continue;
    const ref = ++n;
    e.setAttribute("data-hh-ref", String(ref));
    const d = { ref, role: roleOf(e), name: nameOf(e), tag: e.tagName.toLowerCase() };
    if (e.type && field(e)) d.type = e.type;
    if (field(e)) {
      d.value = e.type === "password" ? (e.value ? "••••" : "") : String(e.value ?? "").slice(0, 80);
      const label = labelOf(e); if (label) d.label = label;
      if (e.placeholder) d.placeholder = clean(e.placeholder);
      if (e.required) d.required = true;
      if (e.willValidate && !e.checkValidity()) d.invalid = e.validationMessage;
      if (e.min !== undefined && e.min !== "") d.min = e.min;
      if (e.max !== undefined && e.max !== "") d.max = e.max;
    }
    if (e.tagName === "SELECT") d.options = [...e.options].slice(0, 15).map((o) => clean(o.text));
    if (e.type === "checkbox" || e.type === "radio") d.checked = e.checked;
    if (e.disabled) d.disabled = true;
    if (e.tagName === "A") { try { const u = new URL(e.href); d.href = u.origin === location.origin ? u.pathname + u.search + u.hash : u.href; } catch { /* malformed href */ } }
    const tid = e.getAttribute("data-testid"); if (tid) d.testid = tid;
    const form = e.form ?? e.closest("form"); if (form) d.form = [...document.forms].indexOf(form);
    out.push(d);
  }
  const headings = [...document.querySelectorAll("h1,h2,h3")].filter(visible).slice(0, 20).map((h) => clean(h.innerText));
  return { url: location.href, title: document.title, headings, elements: out, text: (document.body?.innerText ?? "").slice(0, maxText) };
}

async function harvestLogcatEvents(s) {
  if (!s.emulatorSerial) return;
  const out = await runAdb(["-s", s.emulatorSerial, "logcat", "-d", "-t", "60", "AndroidRuntime:E", "ActivityManager:E", "*:S"], 2000);
  if (!out) return;
  if (out.includes("FATAL EXCEPTION")) {
    const snippet = out.split(/\r?\n/).filter((l) => l.includes("FATAL EXCEPTION") || l.includes("Process:") || l.includes("Exception")).slice(0, 4).join(" | ");
    s.events.console.push({ kind: "logcat-crash", text: mask(s, snippet || "FATAL EXCEPTION in AndroidRuntime").slice(0, 500), url: s.page?.url() ?? "" });
    await runAdb(["-s", s.emulatorSerial, "logcat", "-c"], 1500);
  } else if (out.includes("ANR in ")) {
    const snippet = out.split(/\r?\n/).filter((l) => l.includes("ANR in ") || l.includes("Reason:")).slice(0, 3).join(" | ");
    s.events.console.push({ kind: "logcat-anr", text: mask(s, snippet || "Application Not Responding (ANR)").slice(0, 500), url: s.page?.url() ?? "" });
    await runAdb(["-s", s.emulatorSerial, "logcat", "-c"], 1500);
  }
}

async function snapshot(s, { screenshot = true } = {}) {
  const page = s.page;
  await harvestLogcatEvents(s);
  let snap;
  try { snap = await page.evaluate(collect, { maxElements: MAX_ELEMENTS, maxText: MAX_TEXT }); }
  catch (e) { snap = { url: page.url(), title: "", headings: [], elements: [], text: "", error: String(e?.message ?? e) }; }
  snap.text = mask(s, snap.text);
  for (const el of snap.elements) if (el.value) el.value = mask(s, el.value);
  s.elements = new Map(snap.elements.map((e) => [e.ref, e]));
  if (screenshot) {
    try {
      const shot = await page.screenshot({ type: "jpeg", quality: 60, fullPage: true, mask: [page.locator("input[type=password],[data-hh-secret]")] });
      snap.screenshot = shot.toString("base64");
    } catch { /* screen mid-navigation */ }
  }
  snap.console = s.events.console.splice(0);
  snap.network = s.events.network.splice(0);
  snap.dialogs = s.events.dialogs.splice(0);
  snap.blocked = s.events.blocked.splice(0);
  return snap;
}

async function settle(page, s) {
  await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(150);
  if (!s) return;
  for (let quiet = 0, waited = 0; quiet < 2 && waited < 3000; waited += 100) {
    quiet = (s.inflight ?? 0) === 0 ? quiet + 1 : 0;
    await page.waitForTimeout(100);
  }
}

async function act(s, a) {
  const page = s.page;
  const needsRef = ["click", "fill", "select", "check"].includes(a.type);
  const loc = a.ref != null ? page.locator(`[data-hh-ref="${Number(a.ref)}"]`) : null;
  if (needsRef && !loc) throw new Error(`Action '${a.type}' needs an element ref.`);
  if (loc && (await loc.count()) === 0) throw new Error(`Element [${a.ref}] is no longer on the screen.`);
  const target = loc ? s.elements.get(Number(a.ref)) ?? null : null;
  let box = null;
  if (loc) {
    await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    box = await loc.boundingBox().catch(() => null);
    if (box && !s.fast) {
      await page.evaluate(([r, text]) => window.__hh?.point(r, text), [box, actionLabel(a)]).catch(() => {});
      await page.waitForTimeout(CURSOR_MS);
      if (a.type === "click" || a.type === "check") await page.evaluate((r) => window.__hh?.click(r), box).catch(() => {});
    }
  }
  switch (a.type) {
    case "click": await loc.click({ timeout: 5000 }); break;
    case "fill": {
      const raw = String(a.value ?? ""), v = subst(s, raw);
      await loc.evaluate((e, secret) => secret ? e.setAttribute("data-hh-secret", "1") : e.removeAttribute("data-hh-secret"), v !== raw);
      await loc.fill(v, { timeout: 5000 });
      break;
    }
    case "select": await loc.selectOption({ label: String(a.value ?? "") }, { timeout: 5000 }).catch(() => loc.selectOption(String(a.value ?? ""), { timeout: 5000 })); break;
    case "check": await loc.setChecked(a.value !== "false", { timeout: 5000 }); break;
    case "press": if (loc) await loc.press(a.key || "Enter", { timeout: 5000 }); else await page.keyboard.press(a.key || "Enter"); break;
    case "navigate": {
      const u = new URL(String(a.url ?? ""), page.url()).href;
      if (!hostAllowed(s, u)) throw new Error(`Deep-link navigation to ${u} is outside the allowed hosts.`);
      await page.goto(u, { waitUntil: "domcontentloaded", timeout: 15000 });
      break;
    }
    case "back": await page.goBack({ timeout: 10000 }); break;
    case "reload": await page.reload({ timeout: 15000 }); break;
    case "scroll": await page.mouse.wheel(0, 700); break;
    case "wait": await page.waitForTimeout(Math.min(Number(a.value) || 1000, 5000)); break;
    default: throw new Error(`Unknown action '${a.type}'.`);
  }
  await settle(page, s);
  if (box) await s.page.evaluate(() => window.__hh?.clear()).catch(() => {});
  return target;
}

async function open(body) {
  if (sessions.size >= MAX_SESSIONS) throw Object.assign(new Error(`Worker is at its session limit (${MAX_SESSIONS}).`), { status: 429 });
  const start = new URL(String(body.url ?? ""));
  if (start.protocol !== "http:" && start.protocol !== "https:") throw Object.assign(new Error("Only http(s) endpoints can be opened."), { status: 400 });
  const allowed = new Set([start.hostname.toLowerCase(), ...(body.allowedHosts ?? []).map((h) => String(h).toLowerCase())]);
  if (allowed.has("localhost")) { allowed.add("127.0.0.1"); allowed.add("[::1]"); }
  if (allowed.has("127.0.0.1")) allowed.add("localhost");
  const id = randomUUID();
  const viewport = body.viewport ?? MOBILE_VIEWPORT;
  const fast = body.fast === true;

  // If the Android emulator is running, sync and launch the corresponding real APK on Pixel_8 as well.
  const targetApk = resolveTargetApkForUrl(start.href);
  const emu = await detectEmulator();
  let emulatorSerial = null;
  if (emu.status === "running" && emu.serial && !fast) {
    emulatorSerial = emu.serial;
    await runAdb(["-s", emulatorSerial, "logcat", "-c"], 1500);
    await runAdb(["-s", emulatorSerial, "reverse", `tcp:${targetApk.port}`, `tcp:${targetApk.port}`], 2000);
    await runAdb(["-s", emulatorSerial, "shell", "am", "start", "-n", `${targetApk.package}/${targetApk.activity}`], 4000);
  }

  const context = await (await getBrowser()).newContext({
    viewport,
    userAgent: MOBILE_UA,
    isMobile: true,
    hasTouch: true,
    ignoreHTTPSErrors: false,
    ...(fast ? {} : { recordVideo: { dir: path.join(VIDEO_DIR, id), size: viewport } })
  });
  await context.addInitScript(CURSOR_SCRIPT);
  const s = {
    id,
    context,
    page: null,
    allowed,
    secrets: body.secrets ?? {},
    elements: new Map(),
    requests: new Map(),
    rid: 0,
    fast,
    apkPackage: targetApk.package,
    emulatorSerial,
    lastUsed: Date.now(),
    viewers: new Set(),
    cdp: null,
    frame: null,
    events: { console: [], network: [], dialogs: [], blocked: [] }
  };
  await context.route("**/*", (route) => {
    const u = route.request().url();
    if (hostAllowed(s, u)) return route.continue();
    if (s.events.blocked.length < 50) s.events.blocked.push(u.slice(0, 200));
    return route.abort("blockedbyclient");
  });
  context.on("page", (p) => { attach(s, p); s.page = p; if (s.cdp) stopScreencast(s).then(() => startScreencast(s)); });
  s.page = await context.newPage();
  s.firstPage = s.page;
  sessions.set(s.id, s);
  try { await s.page.goto(start.href, { waitUntil: "domcontentloaded", timeout: 20000 }); await settle(s.page, s); }
  catch (e) { await close(s.id); throw Object.assign(new Error(`Could not open ${start.href}: ${e?.message ?? e}`), { status: 502 }); }
  return s;
}

const HOP = new Set(["host", "content-length", "connection", "accept-encoding", "cookie"]);
const AUTH = /authorization|session|token|csrf|xsrf|api-?key/i;
async function replay(s, b) {
  const base = s.requests.get(Number(b.rid));
  if (!base) throw Object.assign(new Error("No recorded request with that id."), { status: 404 });
  const url = b.url ? new URL(String(b.url), base.url).href : base.url;
  if (!hostAllowed(s, url)) throw Object.assign(new Error("That host is outside this hunt."), { status: 400 });
  const headers = Object.fromEntries(Object.entries(base.headers).filter(([k]) => !HOP.has(k.toLowerCase()) && !(b.dropAuth && AUTH.test(k))));
  if (!b.dropAuth)
    for (const r of [...s.requests.values()].reverse()) {
      const auth = Object.entries(r.headers).filter(([k]) => AUTH.test(k) && !HOP.has(k.toLowerCase()));
      if (auth.length) { for (const [k, v] of auth) headers[k] = v; break; }
    }
  const data = b.body === undefined ? base.body : b.body === null ? undefined : subst(s, typeof b.body === "string" ? b.body : JSON.stringify(b.body));
  const client = b.dropAuth ? await pwRequest.newContext() : s.context.request;
  try {
    const r = await client.fetch(url, { method: b.method ?? base.method, headers, data, timeout: 15000, failOnStatusCode: false, maxRedirects: 0 });
    const ct = r.headers()["content-type"] ?? "";
    const text = ct.includes("json") ? (await r.text()).slice(0, MAX_BODY) : null;
    const sent = data === undefined ? null : mask(s, String(data).slice(0, MAX_BODY));
    const e = { method: b.method ?? base.method, url: mask(s, url), status: r.status(), resourceType: "fetch", requestBody: sent, body: mask(s, text), at: Date.now() };
    e.rid = ++s.rid;
    s.requests.set(e.rid, { method: e.method, url, headers: base.headers, body: data ?? null });
    return e;
  } finally { if (b.dropAuth) await client.dispose(); }
}

async function close(id) {
  const s = sessions.get(id);
  if (!s) return false;
  sessions.delete(id);
  await stopScreencast(s);
  for (const v of s.viewers) v.end();
  const video = s.firstPage?.video();
  await s.context.close().catch(() => {});
  const file = await video?.path().catch(() => null);
  if (file && fs.existsSync(file)) videos.set(id, { file, at: Date.now() });
  return true;
}

setInterval(() => {
  for (const [id, s] of sessions) if (Date.now() - s.lastUsed > IDLE_MS && s.viewers.size === 0) close(id);
  for (const [id, v] of videos) if (Date.now() - v.at > IDLE_MS) { fs.rmSync(path.dirname(v.file), { recursive: true, force: true }); videos.delete(id); }
}, 30_000).unref();

function send(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > 1_000_000) throw Object.assign(new Error("Body too large."), { status: 413 }); chunks.push(c); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://worker");
    if (url.pathname === "/healthz") {
      return send(res, 200, { status: "ok", sessions: sessions.size, maxSessions: MAX_SESSIONS, browser: "appium-uiautomator2", device: AVD_NAME, build: BUILD });
    }
    if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: "Unauthorized." });
    if (req.method === "POST" && url.pathname === "/shutdown") {
      send(res, 202, {});
      for (const id of [...sessions.keys()]) await close(id);
      await browser?.close().catch(() => {});
      return process.exit(0);
    }

    // Android Emulator & Appium device endpoints
    if (url.pathname === "/device/status" && req.method === "GET") {
      return send(res, 200, await deviceStatus());
    }
    if (url.pathname === "/device/emulator/start" && req.method === "POST") {
      const body = await readJson(req);
      return send(res, 200, await ensureEmulatorsAndApks(body));
    }
    if (url.pathname === "/device/emulator/show" && req.method === "POST") {
      return send(res, 200, await showEmulatorWindow());
    }
    if (url.pathname === "/device/emulator/stop" && req.method === "POST") {
      return send(res, 200, await stopEmulatorDevice());
    }
    if (url.pathname === "/device/appium/start" && req.method === "POST") {
      await startAppiumServer();
      return send(res, 200, await deviceStatus());
    }
    if (url.pathname === "/device/stream" && req.method === "GET") {
      return streamDevice(res);
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (req.method === "GET" && parts[0] === "videos" && parts.length === 2) {
      const v = videos.get(parts[1]);
      if (!v) return send(res, 404, { error: "No recording for this session." });
      res.writeHead(200, { "content-type": "video/webm", "content-length": fs.statSync(v.file).size });
      return fs.createReadStream(v.file).pipe(res);
    }
    if (parts[0] !== "sessions") return send(res, 404, { error: "Not found." });
    if (req.method === "GET" && parts[2] === "stream") {
      const live = sessions.get(parts[1] ?? "");
      return live ? stream(live, res) : send(res, 404, { error: "Session not found or expired." });
    }
    if (req.method === "POST" && parts.length === 1) {
      const body = await readJson(req);
      const s = await open(body);
      return send(res, 201, { id: s.id, ...(await snapshot(s, { screenshot: body.screenshot !== false })) });
    }
    const s = sessions.get(parts[1] ?? "");
    if (req.method === "DELETE" && parts.length === 2) return send(res, (await close(parts[1])) ? 204 : 404, {});
    if (!s) return send(res, 404, { error: "Session not found or expired." });
    s.lastUsed = Date.now();
    const body = await readJson(req);
    if (req.method === "POST" && parts[2] === "touch") return send(res, 200, { ok: true });
    if (req.method === "POST" && parts[2] === "snapshot") return send(res, 200, await snapshot(s, body));
    if (req.method === "POST" && parts[2] === "request") return send(res, 200, await replay(s, body));
    if (req.method === "POST" && parts[2] === "act") {
      let target = null, error = null;
      try { target = await act(s, body); } catch (e) { error = mask(s, String(e?.message ?? e)).split("\n")[0].slice(0, 300); }
      return send(res, 200, { ok: !error, error, target, snapshot: body.snapshot === false ? null : await snapshot(s, body) });
    }
    return send(res, 404, { error: "Not found." });
  } catch (e) {
    send(res, e?.status ?? 500, { error: String(e?.message ?? e).split("\n")[0] });
  }
});

server.listen(PORT, HOST, () => console.log(`mobile-worker listening on http://${HOST}:${PORT}`));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { for (const id of [...sessions.keys()]) await close(id); await browser?.close().catch(() => {}); process.exit(0); });
