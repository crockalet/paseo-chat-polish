import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Readable, Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { htmlPage, themeCss } from "../shared/page.ts";

// A Chrome-family browser already on the daemon machine; without one, pages go out unchecked.
const BROWSERS =
  process.platform === "darwin"
    ? ["Google Chrome", "Chromium", "Microsoft Edge", "Brave Browser"].map((app) => `/Applications/${app}.app/Contents/MacOS/${app}`)
    : process.platform === "win32"
      ? [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].flatMap((root) =>
          root ? [join(root, "Google", "Chrome", "Application", "chrome.exe"), join(root, "Microsoft", "Edge", "Application", "msedge.exe")] : [],
        )
      : ["google-chrome-stable", "google-chrome", "chromium", "chromium-browser", "microsoft-edge"].flatMap((name) => [`/usr/bin/${name}`, `/snap/bin/${name}`]);
let browser: string | null | undefined;
const findBrowser = () => (browser ??= BROWSERS.find((path) => existsSync(path)) ?? null);

// The chat's column on desktop and on a phone. The theme only has to lay the page out as the chat does: same fonts, kit and boot script.
const WIDTHS = [700, 360] as const;
const THEME = themeCss(
  { surface0: "#1e1f22", surface1: "#2b2d31", border: "#3f4147", foreground: "#e6e6e6", foregroundMuted: "#9a9ca3", accent: "#5b8cff", accentForeground: "#ffffff", statusSuccess: "#3fb950", statusWarning: "#d29922", statusDanger: "#f85149" },
  { sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif', mono: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" },
  ["#5b8cff", "#3fb950", "#d29922", "#f85149", "#a371f7", "#39c5cf"],
);
const TIMEOUT_MS = 15_000;

interface Layout {
  wide: string[];
  overlaps: string[];
  cut: string[];
}

// The page's height as the boot script reports it to the chat.
const HEIGHT = `(() => { const root = document.documentElement; return Math.ceil(root.scrollHeight > root.clientHeight ? root.scrollHeight : root.getBoundingClientRect().height); })()`;
// Runs in the page: what a reader would see wrong, as short descriptions.
const MEASURE = `(() => {
  const W = innerWidth, out = { wide: [], overlaps: [], cut: [] }, root = document.documentElement;
  const name = (el) => "<" + el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\\s+/).join(".") : "") + ">";
  const quote = (text) => JSON.stringify(text.trim().replace(/\\s+/g, " ").slice(0, 40));
  if (root.scrollWidth > W + 1) {
    for (const el of document.body.querySelectorAll("*")) {
      const box = el.getBoundingClientRect(), parent = el.parentElement && el.parentElement.getBoundingClientRect();
      if (box.width && box.right > W + 1 && !(parent && parent.right > W + 1)) out.wide.push(name(el) + " reaches " + Math.round(box.right) + "px");
      if (out.wide.length >= 3) break;
    }
  }
  const boxes = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode()) && boxes.length < 1500; ) {
    const el = node.parentElement;
    if (!el || !node.data.trim() || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|TITLE)$/.test(el.tagName)) continue;
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    let rects = Array.from(range.getClientRects());
    if (!rects.length && el instanceof SVGElement) rects = [el.getBoundingClientRect()];
    for (const box of rects) if (box.width > 1 && box.height > 1) boxes.push({ box, node, el });
  }
  for (const { box, node, el } of boxes) {
    const svg = el instanceof SVGElement && el.ownerSVGElement;
    if (!svg || out.cut.length >= 3) continue;
    const frame = svg.getBoundingClientRect();
    if (box.left < frame.left - 1 || box.right > frame.right + 1 || box.top < frame.top - 1 || box.bottom > frame.bottom + 1) out.cut.push(quote(node.data));
  }
  outer: for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i], b = boxes[j];
      if (a.node === b.node) continue;
      const w = Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left), h = Math.min(a.box.bottom, b.box.bottom) - Math.max(a.box.top, b.box.top);
      if (w <= 2 || h <= 2 || w * h < 0.3 * Math.min(a.box.width * a.box.height, b.box.width * b.box.height)) continue;
      out.overlaps.push(quote(a.node.data) + " and " + quote(b.node.data));
      if (out.overlaps.length >= 5) break outer;
    }
  }
  return out;
})()`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// The DevTools protocol over --remote-debugging-pipe: NUL-separated JSON on fds 3 (in) and 4 (out), so no port and no WebSocket.
function launch(executable: string, profile: string) {
  // Chrome refuses to sandbox as root, the one case its sandbox has to go.
  const root = process.getuid?.() === 0 ? ["--no-sandbox"] : [];
  const child = spawn(executable, [...root, "--headless=new", "--remote-debugging-pipe", "--no-first-run", "--no-default-browser-check", "--disable-gpu", "--hide-scrollbars", "--mute-audio", `--user-data-dir=${profile}`, "about:blank"], {
    stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"],
  });
  const commands = child.stdio[3] as Writable;
  const events = child.stdio[4] as Readable;
  const waiting = new Map<number, (message: { result?: unknown; error?: { message: string } }) => void>();
  const listeners = new Set<(message: { method: string; params: Record<string, unknown>; sessionId?: string }) => void>();
  let id = 0;
  let buffer = "";
  events.setEncoding("utf8");
  events.on("data", (chunk: string) => {
    buffer += chunk;
    for (let at = buffer.indexOf("\0"); at >= 0; at = buffer.indexOf("\0")) {
      const message = JSON.parse(buffer.slice(0, at));
      buffer = buffer.slice(at + 1);
      if (message.id) waiting.get(message.id)?.(message);
      else for (const listener of listeners) listener(message);
    }
  });
  // A browser that quits (it can't start, or crashed) fails what it was asked, rather than leaving it to the timeout.
  child.once("exit", (code) => {
    for (const settle of waiting.values()) settle({ error: { message: `the browser exited (${code})` } });
  });
  const send = <T = Record<string, unknown>>(method: string, params: object = {}, sessionId?: string) =>
    new Promise<T>((resolve, reject) => {
      const n = ++id;
      waiting.set(n, (message) => {
        waiting.delete(n);
        if (message.error) reject(new Error(`${method}: ${message.error.message}`));
        else resolve(message.result as T);
      });
      commands.write(`${JSON.stringify({ id: n, method, params, sessionId })}\0`);
    });
  return { child, send, listeners };
}

async function inspect(html: string, executable: string) {
  const profile = await mkdtemp(join(tmpdir(), "chat-polish-check-"));
  const { child, send, listeners } = launch(executable, profile);
  try {
    const file = join(profile, "page.html");
    // Absolute image paths resolve against file:///, so local images load as they will in the chat.
    await writeFile(file, htmlPage(html, THEME));
    const { targetId } = await send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    const page = <T = Record<string, unknown>>(method: string, params: object = {}) => send<T>(method, params, sessionId);
    const errors: string[] = [];
    let loaded!: () => void;
    const load = new Promise<void>((resolve) => (loaded = resolve));
    listeners.add(({ method, params, sessionId: from }) => {
      if (from !== sessionId) return;
      if (method === "Page.loadEventFired") loaded();
      if (method === "Runtime.exceptionThrown") {
        const details = params.exceptionDetails as { text: string; lineNumber: number; exception?: { description?: string } };
        errors.push(`${(details.exception?.description ?? details.text).split("\n")[0]} (page line ${details.lineNumber + 1})`);
      }
      if (method === "Runtime.consoleAPICalled" && params.type === "error") {
        errors.push(`console.error: ${(params.args as Array<{ value?: unknown; description?: string }>).map((arg) => String(arg.value ?? arg.description ?? "")).join(" ")}`);
      }
    });
    await page("Runtime.enable");
    await page("Page.enable");
    const measure = async (width: number) => {
      await page("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await sleep(400);
      return (await page<{ result: { value: Layout } }>("Runtime.evaluate", { expression: MEASURE, returnByValue: true })).result.value;
    };
    await page("Emulation.setDeviceMetricsOverride", { width: WIDTHS[0], height: 900, deviceScaleFactor: 1, mobile: false });
    await page("Page.navigate", { url: pathToFileURL(file).href });
    await Promise.race([load, sleep(5000)]);
    const layouts: Array<[number, Layout]> = [];
    const heights: number[] = [];
    for (const width of WIDTHS) {
      const layout = await measure(width);
      layouts.push([width, layout]);
      // Heights while animations run, at one width: the chat's frame only grows, so a page that moves leaves gaps or a jump.
      for (let i = 0; width === WIDTHS[0] && i < 4; i++) {
        heights.push((await page<{ result: { value: number } }>("Runtime.evaluate", { expression: HEIGHT, returnByValue: true })).result.value);
        await sleep(250);
      }
    }
    return { errors, layouts, heights };
  } finally {
    child.kill();
    await rm(profile, { recursive: true, force: true }).catch(() => undefined);
  }
}

let queue: Promise<unknown> = Promise.resolve();

/**
 * What a reader would see wrong with a page, laid out as the chat lays it out at desktop and phone widths: script errors, overlapping
 * text, text cut off at its SVG's edge, a page wider than the column, a height that moves while it runs. Empty when it looks right;
 * undefined when it couldn't be checked (no browser, or it failed), so the page goes out as before.
 */
// ponytail: one browser at a time, launched per check (about 3s); keep one warm if agents publish often.
export function checkPage(html: string): Promise<string[] | undefined> {
  const executable = findBrowser();
  if (!executable) return Promise.resolve(undefined);
  const run = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const result = await Promise.race([inspect(html, executable), new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), TIMEOUT_MS)))]).finally(() => clearTimeout(timer));
    if (!result) return undefined;
    const problems = [...new Set(result.errors)].slice(0, 3).map((error) => `Script error: ${error}`);
    // The same finding at both widths is reported once, with both.
    const found = new Map<string, number[]>();
    for (const [width, layout] of result.layouts) {
      const add = (finding: string) => found.set(finding, [...(found.get(finding) ?? []), width]);
      if (layout.overlaps.length) add(`text overlaps: ${layout.overlaps.join("; ")}`);
      if (layout.cut.length) add(`text is cut off at the edge of its SVG: ${layout.cut.join(", ")}`);
      if (layout.wide.length) add(`the page is wider than the column: ${layout.wide.join(", ")}`);
    }
    for (const [finding, widths] of found) problems.push(`At ${widths.join(" and ")}px wide, ${finding}`);
    const low = Math.min(...result.heights);
    const high = Math.max(...result.heights);
    if (high - low > 24) problems.push(`The page's height changes while it runs (${low} to ${high}px); reserve the space up front`);
    return problems;
  };
  const next = queue.then(run, run).catch((error: unknown) => (console.warn("[chat-polish] couldn't check an html_render page", error), undefined));
  queue = next;
  return next;
}
