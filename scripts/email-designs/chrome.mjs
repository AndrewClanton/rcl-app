// Headless Chrome over the DevTools protocol, for turning the email
// designs into pictures (render.mjs) and checking the finished emails
// (check.mjs).
//
// One profile folder, reused on every run: %TEMP%\rcl-email-render-chrome.
// Windows locks Chrome's cache folders inside a profile (sandbox ACLs), so a
// fresh profile per run can't be deleted afterwards and they pile up (one
// session's leftovers once filled the C: drive). The disk cache is kept to
// almost nothing, and Chrome is always closed when the run ends, even after
// an error.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const PROFILE = join(tmpdir(), "rcl-email-render-chrome");
const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function withChrome(fn) {
  const exe = CANDIDATES.find((p) => existsSync(p));
  if (!exe) throw new Error("Chrome not found. Set CHROME_PATH.");
  mkdirSync(PROFILE, { recursive: true });
  const portFile = join(PROFILE, "DevToolsActivePort");
  rmSync(portFile, { force: true });
  const proc = spawn(
    exe,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-background-networking",
      "--disk-cache-size=1",
      "--allow-file-access-from-files",
      `--user-data-dir=${PROFILE}`,
      "--remote-debugging-port=0",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let ws = null;
  try {
    let port = null;
    for (let i = 0; i < 100 && !port; i++) {
      await sleep(100);
      if (existsSync(portFile)) port = Number(readFileSync(portFile, "utf8").split("\n")[0]) || null;
    }
    if (!port) throw new Error("Chrome didn't start.");
    let target = null;
    for (let i = 0; i < 50 && !target; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === "page");
      } catch {
        await sleep(100);
      }
    }
    if (!target) throw new Error("No page in Chrome.");
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = reject;
    });
    let id = 0;
    const pending = new Map();
    const waiters = [];
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(new Error(`${msg.error.message}`));
        else resolve(msg.result);
      } else if (msg.method) {
        for (const w of waiters.splice(0)) if (w.method === msg.method) w.resolve(msg.params);
          else waiters.push(w);
      }
    };
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const i = ++id;
        pending.set(i, { resolve, reject });
        ws.send(JSON.stringify({ id: i, method, params }));
      });
    const once = (method, ms = 20000) =>
      Promise.race([new Promise((resolve) => waiters.push({ method, resolve })), sleep(ms).then(() => null)]);
    await send("Page.enable");
    await send("Runtime.enable");

    const page = {
      send,
      async open(url, { width, height = 800, scale = 1, mobile = false } = {}) {
        await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile });
        const loaded = once("Page.loadEventFired");
        await send("Page.navigate", { url });
        await loaded;
        await page.eval("document.fonts.ready.then(() => true)");
        // Images that load late (decode) and fonts settling.
        await page.eval("Promise.all([...document.images].map((i) => i.complete ? 1 : new Promise((r) => { i.onload = i.onerror = r; })))");
        await sleep(300);
      },
      async eval(expression) {
        const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
        return r.result.value;
      },
      // A PNG of one rectangle of the page (CSS pixels), at the page's scale.
      async shot(clip, scale) {
        const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { ...clip, scale: scale ?? 1 } });
        return Buffer.from(r.data, "base64");
      },
    };
    return await fn(page);
  } finally {
    try {
      ws?.close();
    } catch {
      // closing anyway
    }
    proc.kill();
    await sleep(500);
    // Windows: the helper processes too (renderer, GPU, network).
    if (process.platform === "win32") {
      await new Promise((r) => spawn("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" }).on("exit", r).on("error", r));
    } else if (proc.exitCode === null && proc.signalCode === null) {
      try {
        process.kill(proc.pid);
      } catch {
        // already gone
      }
    }
  }
}
